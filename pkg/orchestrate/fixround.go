// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// FixRoundContextLimit is the context, in tokens, at or past which a task's review fix round goes to a fresh worker
// instead of the session that built it (spec 2026-11-17-worker-keeps-context-design), whatever its window.
const FixRoundContextLimit = 150_000

// workerContexts holds each agent block's latest context size in tokens, from the statusline usage its session
// reports (baseds.AgentUsage). wavesrv keeps no usage event (they publish Persist:0), so this is the only record, and
// it lives in memory: after a restart no figure is known and a fix round starts a fresh worker.
var workerContexts = struct {
	sync.Mutex
	byORef map[string]int64
}{byORef: map[string]int64{}}

// NoteWorkerContext records the context size a status event's usage snapshot carries, for its block. It runs on the
// publish path of every status event, so it does no I/O.
func NoteWorkerContext(ev *wps.WaveEvent) {
	if ev == nil || ev.Event != wps.Event_AgentStatus {
		return
	}
	var data baseds.AgentStatusData
	if utilfn.ReUnmarshal(&data, ev.Data) != nil || data.ORef == "" || data.Usage == nil {
		return
	}
	tokens, ok := contextTokens(data.Usage)
	if !ok {
		return
	}
	workerContexts.Lock()
	workerContexts.byORef[data.ORef] = tokens
	workerContexts.Unlock()
}

// contextTokens is a usage snapshot's context in tokens: ContextPct (a percentage) of ContextMax. A snapshot without
// both reports no figure.
func contextTokens(u *baseds.AgentUsage) (int64, bool) {
	if u.ContextPct <= 0 || u.ContextMax <= 0 {
		return 0, false
	}
	return int64(u.ContextPct / 100 * float64(u.ContextMax)), true
}

// workerContextTokens is the last context size the block reported, and whether it reported one.
func workerContextTokens(blockORef string) (int64, bool) {
	workerContexts.Lock()
	defer workerContexts.Unlock()
	tokens, ok := workerContexts.byORef[blockORef]
	return tokens, ok
}

// fixRoundNudge is the first turn of a worker reopened for its review fix round. It never restates the task: the
// session already holds it.
func fixRoundNudge(g *waveobj.TaskGroup, t *waveobj.TaskNode) string {
	var b strings.Builder
	fmt.Fprintf(&b, "A reviewer rejected your commit %s for this task:\n%s\n\n", t.ReviewCommit, t.ReviewNote)
	if t.LeadGuidance != "" {
		fmt.Fprintf(&b, "The lead's guidance: %s\n\n", t.LeadGuidance)
	}
	b.WriteString("Fix these on top of the lane's current commit; don't restart. Rerun the tests your task names")
	if g.Check != "" {
		fmt.Fprintf(&b, ", and `%s`,", g.Check)
	}
	reportPath := WorkerReportPath(g.OID, t.ID)
	fmt.Fprintf(&b, " and get them passing. Commit, write a new report to `%s` with the same five sections, then run `wsh jarvis complete --commit $(git rev-parse HEAD) --report %s`.", reportPath, reportPath)
	return b.String()
}

// sameSessionFixRound reopens, in its own tab, the session of the worker a reviewer just failed for the first time,
// with the findings as its first turn, and marks the task running on a new run row for that session: the reviewer,
// the digest and `wsh jarvis complete` then treat the round as they treat a fresh worker's. It returns why it did
// not, and the caller starts a fresh worker as before; "" when the session reopened. A session that reopens and
// later exits without a report goes through the stall handling like any worker.
//
// It runs in the tick, under the dag lock, and adds the reopened worker to spawned, so a tick that cannot commit stops
// it as it stops a dispatched worker. The reviewer whose verdict this applies has finished, so the worker takes the
// reviewer's place and claims no new worker slot.
func sameSessionFixRound(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, t *waveobj.TaskNode, owner, worker *waveobj.Run, now int64, spawned *[]spawnedWorkerInfo) string {
	tabID := runTabID(worker)
	if tabID == "" {
		return "the worker recorded no tab"
	}
	if worker.SessionId == "" {
		return "the worker recorded no session"
	}
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabID)
	if err != nil {
		return "reading the worker's tab: " + err.Error()
	}
	if tab == nil || len(tab.BlockIds) == 0 {
		return "the worker's tab is gone"
	}
	blockID := tab.BlockIds[0]
	tokens, known := workerContextTokens(waveobj.MakeORef(waveobj.OType_Block, blockID).String())
	if !known {
		return "the worker reported no context size"
	}
	if tokens >= FixRoundContextLimit {
		return fmt.Sprintf("the worker's context is %dk tokens", tokens/1000)
	}
	if runroute.DefaultRuntime(worker.Runtime) == "claude" && !claudeTranscriptFn(worker.SessionId) {
		return "the worker's Claude session has no transcript"
	}
	workerORef := waveobj.MakeORef(waveobj.OType_Tab, tabID).String()
	child := childRunFromSpec(g, t, owner, waveobj.RoutePin{Runtime: worker.Runtime, Model: worker.Model}, worker.ProjectPath, worker.BaseCommit, worker.Goal)
	child.SessionId = worker.SessionId
	child.Branch = worker.Branch
	phase := jarvis.RunningPhaseIndex(child)
	if phase < 0 {
		return "the new run has no running phase"
	}
	child.Phases[phase].WorkerOrefs = []string{workerORef}
	if err := appendChildRun(spawnCtx, g.ChannelId, child); err != nil {
		return "recording the round's run: " + err.Error()
	}
	runORef := waveobj.MakeORef(waveobj.OType_Run, child.ID).String()
	// the stamp is how `wsh jarvis complete` and the exit hook find the round's run: one left on the old run would
	// complete that, so a stamp that fails abandons the round
	if err := stampSpawnedWorker(spawnCtx, workerORef, runORef, waveobj.MakeORef(waveobj.OType_Channel, g.ChannelId).String()); err != nil {
		abandonUnstartedWorker(spawnCtx, g.ChannelId, child.ID, workerORef)
		return "stamping the worker's tab: " + err.Error()
	}
	if _, err := wstore.UpdateObjectMeta(spawnCtx, waveobj.MakeORef(waveobj.OType_Block, blockID), waveobj.MetaMapType{blockMetaRunID: child.ID}, false); err != nil {
		log.Printf("dag %s task %s: stamping the round's run on block %s: %v", g.OID, t.ID, blockID, err)
	}
	// the first round's report would pass for this round's
	if err := os.Remove(WorkerReportPath(g.OID, t.ID)); err != nil && !os.IsNotExist(err) {
		log.Printf("dag %s task %s: removing the first round's report: %v", g.OID, t.ID, err)
	}
	// the finished first round would otherwise be reaped, and its reap stops the shared tab under the reopened session
	dropFinishedSession(worker.ID)
	nudge := fixRoundNudge(g, t)
	if err := jarvis.ResumeRunWorker(spawnCtx, workerORef, worker.Runtime, worker.SessionId, nudge); err != nil {
		abandonUnstartedWorker(spawnCtx, g.ChannelId, child.ID, workerORef)
		return "reopening the session failed: " + err.Error()
	}
	// the transcript shows the findings as a typed prompt, and the told scan skips them as it skips a lead's `dag tell`:
	// they are the engine's words, not the human's
	t.LeadTold = append(t.LeadTold, nudge)
	*spawned = append(*spawned, spawnedWorkerInfo{childRun: child, oref: workerORef, taskID: t.ID, persisted: true})
	if err := MarkRunning(g, t.ID, child.ID); err != nil {
		// t is g's own task, so this cannot happen; the reopened worker is left to the commit's cleanup
		log.Printf("dag %s task %s: marking the fix round running: %v", g.OID, t.ID, err)
	}
	t.LastActivity = now
	return ""
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os/exec"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/dume"
	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// DUM-E's last status, written by its loop (dumeTick) and read by the command and the event.
var (
	dumeMu     sync.Mutex
	dumeStatus wshrpc.DumeStatusData
	dumeArmed  int64 // the 5h reset (epoch s) of the window DUM-E has started; 0 = none
)

const (
	dumeFirstTick = 3 * time.Minute
	dumeTickEvery = 5 * time.Minute
	dumeGitWait   = 30 * time.Second
)

// the side effects, as vars so tests script them
var (
	dumeQuota    = claudequota.Get
	dumePressure = jobqueue.ReadPressure
	dumeEfforts  = effortstore.GetAll
	dumeRuns     = dumeLiveRuns
	dumeAhead    = dumeBranchAhead
	dumeStartRun = dumeStartChunk
	dumeNote     = dumeWriteNote
	dumeDropTree = dumeDropTreeOf
	dumePublish  = func(s wshrpc.DumeStatusData) {
		wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_DumeChanged, Data: s})
	}
	dumeNow         = time.Now
	dumeIsEnabled   = dumeEnabled
	dumeProjectPath = effortProjectPath
)

func dumeEnabled() bool {
	v := wconfig.GetWatcher().GetFullConfig().Settings.DumeEnabled
	return v != nil && *v
}

func (ws *WshServer) DumeStatusCommand(ctx context.Context) (*wshrpc.DumeStatusData, error) {
	dumeMu.Lock()
	s := dumeStatus
	dumeMu.Unlock()
	s.Enabled = dumeEnabled() // live: the setting may have moved since the last tick
	return &s, nil
}

// StartDumeLoop runs DUM-E's tick until ctx ends: the first after three minutes, then every five.
func StartDumeLoop(ctx context.Context) {
	go func() {
		timer := time.NewTimer(dumeFirstTick)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			safeDumeTick(ctx)
			timer.Reset(dumeTickEvery)
		}
	}()
}

// safeDumeTick keeps a panic in one tick from ending the loop for good.
func safeDumeTick(ctx context.Context) {
	defer func() {
		panichandler.PanicHandler("dume-tick", recover())
	}()
	dumeTick(ctx)
}

type dumeChunkKey struct{ effortOID, chunk string }

// dumeTick is one pass: finish the chunks whose run ended, ask the gate, start the next chunk when it says so, and
// record what it decided.
func dumeTick(ctx context.Context) {
	now := dumeNow()
	if !dumeIsEnabled() {
		// off reads nothing else; the window DUM-E had started is forgotten with it
		dumeRecord(wshrpc.DumeStatusData{Reason: dume.Decide(dume.Inputs{Now: now}).Reason, DecidedTs: now.UnixMilli()}, 0)
		return
	}
	efforts, err := dumeEfforts(ctx)
	if err != nil {
		log.Printf("dume: reading the initiatives: %v", err)
		return
	}
	runs, err := dumeRuns(ctx)
	if err != nil {
		log.Printf("dume: reading the runs: %v", err)
		return
	}
	var live []*waveobj.Run
	for _, r := range runs {
		if r != nil && r.Status != jarvis.RunStatus_Done && r.Status != jarvis.RunStatus_Cancelled {
			live = append(live, r)
		}
	}
	slices.SortFunc(live, func(a, b *waveobj.Run) int { return strings.Compare(a.ID, b.ID) })
	runLive := func(id string) bool {
		return slices.ContainsFunc(live, func(r *waveobj.Run) bool { return r.ID == id })
	}

	sum := dumeFinish(ctx, dume.Summarize(efforts, runLive))

	// a chunk is DUM-E's by its owner, whatever its status: a start that crashed before its note leaves a pending
	// chunk with a live run, which is still DUM-E's run
	titles := map[dumeChunkKey]string{}
	for _, e := range efforts {
		if e == nil {
			continue
		}
		for _, c := range e.Chunks {
			if c.Owner == dume.Owner {
				titles[dumeChunkKey{e.OID, c.Label}] = e.Title
			}
		}
	}
	liveOn := map[dumeChunkKey]*waveobj.Run{} // DUM-E's chunk -> the live run working it
	var dumeLive []*waveobj.Run
	own := 0
	for _, r := range live {
		if r.EffortRef != nil {
			k := dumeChunkKey{r.EffortRef.EffortOID, r.EffortRef.ChunkLabel}
			if _, ok := titles[k]; ok {
				liveOn[k] = r
				dumeLive = append(dumeLive, r)
				continue
			}
		}
		if runqueue.TopLevel(r) {
			own++
		}
	}
	// the queue: a chunk of a project with a path, with no run already working it
	var pending []dume.Ref
	for _, ref := range sum.Waiting {
		if dumeProjectPath(ref.Project) == "" || liveOn[dumeChunkKey{ref.EffortOID, ref.Chunk}] != nil {
			continue
		}
		pending = append(pending, ref)
	}

	quota := dumeQuota(ctx)
	dumeMu.Lock()
	armed := dumeArmed
	dumeMu.Unlock()
	d := dume.Decide(dume.Inputs{
		Enabled: true, Quota: quota, Now: now, OwnRunsLive: own,
		DumeRunLive: len(dumeLive) > 0 || len(sum.Running) > 0,
		Pressure:    dumePressure(ctx), ArmedReset: armed, HasWork: len(pending) > 0,
	})

	reason := d.Reason
	waiting := len(pending)
	var started *wshrpc.DumeChunk
	if d.Start {
		ref := pending[0]
		waiting--
		runId, branch, err := dumeStartRun(ctx, ref)
		if err != nil {
			log.Printf("dume: could not start %q of %q: %v", ref.Chunk, ref.EffortTitle, err)
			if nerr := dumeNote(ctx, ref.EffortOID, ref.Chunk, "blocked", "DUM-E: could not start: "+err.Error()); nerr != nil {
				log.Printf("dume: noting the failed start on %q: %v", ref.Chunk, nerr)
			}
			reason = fmt.Sprintf("could not start %s: %v", ref.Chunk, err)
			sum.Blocked++
		} else {
			log.Printf("dume: started %q of %q: run %s on %s", ref.Chunk, ref.EffortTitle, runId, branch)
			// a failed note leaves the chunk pending with this run live on it: the next tick sees the run and does not
			// start it again
			if nerr := dumeNote(ctx, ref.EffortOID, ref.Chunk, "active", dume.StartedNote(runId, branch)); nerr != nil {
				log.Printf("dume: run %s is working %q but its note was not written: %v", runId, ref.Chunk, nerr)
			}
			ref.RunId, ref.Branch = runId, branch
			started = dumeChunkData(ref)
		}
	}

	s := wshrpc.DumeStatusData{
		Enabled: true, Reason: reason, DecidedTs: now.UnixMilli(),
		Waiting: waiting, Blocked: sum.Blocked, Done: sum.Done,
	}
	switch {
	case len(sum.Running) > 0:
		s.Running = dumeChunkData(sum.Running[0])
	case started != nil:
		s.Running = started
	case len(dumeLive) > 0:
		r := dumeLive[0]
		k := dumeChunkKey{r.EffortRef.EffortOID, r.EffortRef.ChunkLabel}
		s.Running = &wshrpc.DumeChunk{EffortOID: k.effortOID, Effort: titles[k], Chunk: k.chunk, RunId: r.ID}
	}
	for _, ref := range sum.ToLand {
		s.ToLand = append(s.ToLand, *dumeChunkData(ref))
	}
	if quota != nil {
		if quota.FiveHourPct != nil {
			v := *quota.FiveHourPct
			s.FiveHourPct = &v
		}
		if quota.FiveHourReset != nil {
			v := *quota.FiveHourReset
			s.FiveHourReset = &v
		}
	}
	dumeRecord(s, d.ArmedReset)
}

// dumeFinish settles each chunk whose run ended: commits on its branch make it ready to land (the status stays
// active, the note says what to merge), none block it. A chunk whose branch cannot be read stays as it was for the
// next tick. The summary it returns counts them as settled.
func dumeFinish(ctx context.Context, sum dume.Summary) dume.Summary {
	var left []dume.Ref
	for _, ref := range sum.Finished {
		path := dumeProjectPath(ref.Project)
		if path == "" {
			log.Printf("dume: %q finished, but project %q has no path to read %s in", ref.Chunk, ref.Project, ref.Branch)
			left = append(left, ref)
			continue
		}
		n, err := dumeAhead(ctx, path, ref.Branch)
		if err != nil {
			log.Printf("dume: reading %s for %q: %v", ref.Branch, ref.Chunk, err)
			left = append(left, ref)
			continue
		}
		key := strings.TrimPrefix(ref.Branch, "wave/")
		if n > 0 {
			if err := dumeNote(ctx, ref.EffortOID, ref.Chunk, "", dume.ToLandNote(ref.Branch, n)); err != nil {
				log.Printf("dume: noting %q ready to land: %v", ref.Chunk, err)
				left = append(left, ref)
				continue
			}
			log.Printf("dume: %q is ready to land: %d commits on %s", ref.Chunk, n, ref.Branch)
			if err := dumeDropTree(ctx, path, key, true); err != nil {
				log.Printf("dume: removing the tree of %s: %v", ref.Branch, err)
			}
			sum.ToLand = append(sum.ToLand, ref)
			continue
		}
		if err := dumeNote(ctx, ref.EffortOID, ref.Chunk, "blocked", dume.NothingNote(ref.Branch)); err != nil {
			log.Printf("dume: noting %q blocked: %v", ref.Chunk, err)
			left = append(left, ref)
			continue
		}
		log.Printf("dume: %q committed nothing on %s: blocked", ref.Chunk, ref.Branch)
		if err := dumeDropTree(ctx, path, key, false); err != nil {
			log.Printf("dume: removing the tree and branch %s: %v", ref.Branch, err)
		}
		sum.Blocked++
	}
	sum.Finished = left
	return sum
}

// dumeRecord stores the tick's status and the window it armed, and publishes the status when anything in it but the
// time it was decided moved.
func dumeRecord(s wshrpc.DumeStatusData, armed int64) {
	dumeMu.Lock()
	prev := dumeStatus
	dumeStatus = s
	dumeArmed = armed
	dumeMu.Unlock()
	a, b := prev, s
	a.DecidedTs, b.DecidedTs = 0, 0
	if !reflect.DeepEqual(a, b) {
		dumePublish(s)
	}
}

func dumeChunkData(r dume.Ref) *wshrpc.DumeChunk {
	return &wshrpc.DumeChunk{EffortOID: r.EffortOID, Effort: r.EffortTitle, Chunk: r.Chunk, RunId: r.RunId, Branch: r.Branch}
}

// dumeApplyNote is the edit of one DUM-E state change on an effort: a status change when status is set, then DUM-E's
// note. They are two ops, never setChunkStatus's own Note: that one reads "marked <status> · <note>", which
// dume.ClassifyChunk, looking for a note that starts "DUM-E: ", would never see.
func dumeApplyNote(e *waveobj.Effort, chunk, status, note string, nowMs int64) error {
	var ops []wshrpc.EffortOp
	if status != "" {
		ops = append(ops, wshrpc.EffortOp{Op: "setChunkStatus", Chunk: chunk, Status: status})
	}
	ops = append(ops, wshrpc.EffortOp{Op: "appendNote", Chunk: chunk, Note: note})
	return jarvis.ApplyEffortOpsAs(e, ops, "", nowMs, jarvis.NoteAuthor{Who: "agent"})
}

func dumeWriteNote(ctx context.Context, effortOID, chunk, status, note string) error {
	nowMs := dumeNow().UnixMilli()
	return effortstore.Update(ctx, effortOID, func(e *waveobj.Effort) error {
		return dumeApplyNote(e, chunk, status, note, nowMs)
	})
}

// dumeLiveRuns is the runs neither done nor cancelled, which is what the run queue loads without a run to wait after.
func dumeLiveRuns(ctx context.Context) ([]*waveobj.Run, error) {
	byID, err := runQueueLoadRuns(ctx, nil)
	if err != nil {
		return nil, err
	}
	runs := make([]*waveobj.Run, 0, len(byID))
	for _, r := range byID {
		runs = append(runs, r)
	}
	return runs, nil
}

// dumeBranchAhead is how many commits branch has that HEAD of the project's checkout lacks. A branch that is gone has
// none: whoever deleted it left the chunk nothing to land.
func dumeBranchAhead(ctx context.Context, projectPath, branch string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, dumeGitWait)
	defer cancel()
	err := exec.CommandContext(ctx, "git", "-C", projectPath, "show-ref", "--verify", "-q", "refs/heads/"+branch).Run()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && ee.ExitCode() == 1 {
			return 0, nil
		}
		return 0, fmt.Errorf("git show-ref %s in %s: %w", branch, projectPath, err)
	}
	out, err := exec.CommandContext(ctx, "git", "-C", projectPath, "rev-list", "--count", "HEAD.."+branch).Output()
	if err != nil {
		return 0, fmt.Errorf("git rev-list HEAD..%s in %s: %w", branch, projectPath, err)
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		return 0, fmt.Errorf("counting commits on %s: %w", branch, err)
	}
	return n, nil
}

// dumeDropTreeOf removes DUM-E's tree of key: keeping the branch for a chunk waiting to land, deleting it with the
// tree for one that committed nothing.
func dumeDropTreeOf(ctx context.Context, projectPath, key string, keepBranch bool) error {
	if keepBranch {
		return orchestrate.RemoveTreeKeepBranch(ctx, projectPath, key)
	}
	return orchestrate.RemoveRunWorktree(ctx, projectPath, key)
}

// dumeStartChunk makes a fresh tree on wave/dume-… from the project's HEAD and starts a sonnet quick run in it for the
// chunk. The run commits on that branch; nothing lands it.
func dumeStartChunk(ctx context.Context, ref dume.Ref) (runId, branch string, err error) {
	path := dumeProjectPath(ref.Project)
	if path == "" {
		return "", "", fmt.Errorf("project %q has no path", ref.Project)
	}
	key := dume.TreeKey(ref.EffortOID, dumeNow())
	wt, err := orchestrate.CreateRunWorktree(ctx, path, key, "")
	if err != nil {
		return "", "", err
	}
	drop := func(cause error) (string, string, error) {
		if derr := orchestrate.RemoveRunWorktree(context.WithoutCancel(ctx), path, key); derr != nil {
			log.Printf("dume: removing %s after a failed start: %v", key, derr)
		}
		return "", "", cause
	}
	setup, err := orchestrate.ProjectSetup(path)
	if err != nil {
		return drop(err)
	}
	if _, _, err := orchestrate.PrepareTree(ctx, wt, setup); err != nil {
		return drop(fmt.Errorf("preparing the tree: %w", err))
	}
	ws := &WshServer{}
	ch, err := ws.CreateChannelCommand(ctx, wshrpc.CommandCreateChannelData{Name: ref.Project, ProjectPath: path})
	if err != nil {
		return drop(err)
	}
	workspaceId, err := dumeWorkspaceId(ctx)
	if err != nil {
		return drop(err)
	}
	rtn, err := ws.createRun(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: workspaceId, Goal: dume.Goal(ref),
		Mode: jarvis.RunMode_Quick, Runtime: "claude", Model: "sonnet", Worktree: wt,
		EffortOID: ref.EffortOID, ChunkLabel: ref.Chunk,
	}, nil)
	if err != nil {
		return drop(err)
	}
	return rtn.Run.ID, "wave/" + key, nil
}

// dumeWorkspaceId is the first window's workspace, where a run's tabs go.
func dumeWorkspaceId(ctx context.Context) (string, error) {
	client, err := wcore.GetClientData(ctx)
	if err != nil {
		return "", err
	}
	if len(client.WindowIds) == 0 {
		return "", errors.New("no window to put the run's tab in")
	}
	win, err := wcore.GetWindow(ctx, client.WindowIds[0])
	if err != nil {
		return "", err
	}
	return win.WorkspaceId, nil
}

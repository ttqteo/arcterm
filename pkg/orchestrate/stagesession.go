// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// StageSession is one dag-level judging session (plan reviewer, final verifier): a fresh session that works
// no task, reads Tree, and ends with a verdict command its Prompt names.
type StageSession struct{ Role, Label, Tree, Prompt string }

// reviewerRoute is the route judging sessions run on: the group's reviewer route when it names one, else the
// lead's.
func reviewerRoute(owner *waveobj.Run, g *waveobj.TaskGroup) waveobj.RoutePin {
	if r := g.ReviewerRoute; r != nil && (r.Runtime != "" || r.Model != "") {
		return waveobj.RoutePin{Runtime: runroute.DefaultRuntime(r.Runtime), Model: r.Model}
	}
	return waveobj.RoutePin{Runtime: runroute.DefaultRuntime(owner.Runtime), Model: owner.Model}
}

// spawnStageSession starts s on the reviewer route, as a task reviewer is: the model picked for judgment. Its
// child run carries the dag, the session id and StageRole, and no task, so usage counts it under its role and
// a bare complete is not taken for a worker's.
func spawnStageSession(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, s StageSession) (string, error) {
	pin := reviewerRoute(owner, g)
	capability, err := runroute.Resolve(pin)
	if err == nil {
		err = validateLeadHarness(pin.Runtime)
	}
	if err != nil {
		return "", err
	}
	runID, sessionId := uuid.NewString(), jarvis.WorkerSessionId(pin.Runtime)
	oref, err := spawnWorker(spawnCtx, capability, owner.WorkspaceId, "", s.Tree, s.Prompt,
		jarvis.RunWorkerOptions{SessionId: sessionId, RunId: runID, Label: s.Label})
	if err != nil {
		return "", err
	}
	child := jarvis.NewRun(s.Prompt, owner.WorkspaceId, s.Tree, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), time.Now().UnixMilli())
	child.ID = runID
	child.Runtime, child.Model = pin.Runtime, pin.Model
	child.DagORef = g.OID
	child.SessionId = sessionId
	child.StageRole = s.Role
	for i := range child.Phases {
		if child.Phases[i].State == jarvis.PhaseState_Running {
			child.Phases[i].WorkerOrefs = []string{oref}
			break
		}
	}
	if err := appendChildRun(spawnCtx, g.ChannelId, child); err != nil {
		if serr := stopSpawnedWorker(spawnCtx, oref); serr != nil {
			log.Printf("dag %s: stopping unrecorded %s %s: %v", g.OID, s.Role, oref, serr)
		}
		return "", fmt.Errorf("recording the session: %w", err)
	}
	runORef := waveobj.MakeORef(waveobj.OType_Run, runID).String()
	channelORef := waveobj.MakeORef(waveobj.OType_Channel, g.ChannelId).String()
	if err := stampSpawnedWorker(spawnCtx, oref, runORef, channelORef); err != nil {
		log.Printf("dag %s: stamp %s %s: %v", g.OID, s.Role, oref, err)
	}
	if err := startWorker(spawnCtx, oref); err != nil {
		abandonUnstartedWorker(spawnCtx, g.ChannelId, runID, oref)
		return "", err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, runID))
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, g.ChannelId))
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindStageSessionStarted, nil, map[string]any{"role": s.Role, "runid": runID})
	return runID, nil
}

// stageSessionLost says why a stage session with no verdict is done for, or "" while it is still working. It
// is bounded like a task reviewer: judging a plan or a finished run takes minutes too.
func stageSessionLost(ctx context.Context, g *waveobj.TaskGroup, runID string, startedTs, now int64) string {
	if now-startedTs > ReviewTimeout.Milliseconds() {
		return fmt.Sprintf("it gave no verdict within %s", ReviewTimeout)
	}
	run, err := wstore.GetRun(ctx, g.ChannelId, runID)
	if err != nil {
		return "" // unreadable this tick; the timeout still bounds it
	}
	switch run.Status {
	case jarvis.RunStatus_Done, jarvis.RunStatus_Cancelled, jarvis.RunStatus_Blocked:
		return "it ended without a verdict"
	}
	if workerControllerGone(ctx, run) {
		return "it exited without a verdict"
	}
	return ""
}

// tendStageSession keeps a stage's one session going for a tick: it replaces a lost session, and starts the
// missing one, within MaxReviewRespawns. runID, startedTs and respawns are the stage's own bookkeeping. It
// returns why the stage gives up on its session, or "" while one is working or the next tick retries. The
// session is built only when one is spawned.
func tendStageSession(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, session func() StageSession, runID *string, startedTs *int64, respawns *int, now int64, afterCommit *[]func()) string {
	if *runID != "" {
		reason := stageSessionLost(ctx, g, *runID, *startedTs, now)
		if reason == "" {
			return ""
		}
		stopReviewer(ctx, g, *runID, afterCommit)
		*runID = ""
		if *respawns >= MaxReviewRespawns {
			return reason
		}
		*respawns++
	}
	id, err := spawnStageSession(ctx, spawnCtx, g, owner, session())
	if err != nil {
		if *respawns >= MaxReviewRespawns {
			return "it could not start: " + err.Error()
		}
		*respawns++
		return ""
	}
	*runID, *startedTs = id, now
	return ""
}

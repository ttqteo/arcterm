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
// no task, reads Tree, and ends with a verdict command its Prompt names. Lens names a plan reviewer's lens (empty
// for the final verifier); a zero Route runs it on reviewerRoute.
type StageSession struct {
	Role, Label, Tree, Prompt, Lens string
	Route                           waveobj.RoutePin
}

// reviewerRoute is the route judging sessions run on: the group's reviewer route when it names one, else the
// lead's.
func reviewerRoute(owner *waveobj.Run, g *waveobj.TaskGroup) waveobj.RoutePin {
	if r := g.ReviewerRoute; r != nil && (r.Runtime != "" || r.Model != "") {
		return waveobj.RoutePin{Runtime: runroute.DefaultRuntime(r.Runtime), Model: r.Model}
	}
	return waveobj.RoutePin{Runtime: runroute.DefaultRuntime(owner.Runtime), Model: owner.Model}
}

// lightReviewerRoute is the route the plan review's lens and follow-up reviewers run on: the group's Light
// reviewers route when it names one, else LightPickRoute on every runtime.
func lightReviewerRoute(g *waveobj.TaskGroup) waveobj.RoutePin {
	if r := g.LightReviewerRoute; r != nil && (r.Runtime != "" || r.Model != "") {
		return waveobj.RoutePin{Runtime: runroute.DefaultRuntime(r.Runtime), Model: r.Model}
	}
	return LightPickRoute
}

// spawnStageSession starts s on its route, by default the reviewer route, as a task reviewer is: the model picked
// for judgment. Its child run carries the dag, the session id and StageRole, and no task, so usage counts it under
// its role and a bare complete is not taken for a worker's.
func spawnStageSession(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, s StageSession) (string, error) {
	pin := s.Route
	if pin.Runtime == "" && pin.Model == "" {
		pin = reviewerRoute(owner, g)
	}
	runID, err := LaunchJudgingSession(spawnCtx, JudgingSession{
		ChannelId: g.ChannelId, WorkspaceId: owner.WorkspaceId, DagORef: g.OID,
		Role: s.Role, Label: s.Label, Tree: s.Tree, Prompt: s.Prompt, Route: pin,
	})
	if err != nil {
		return "", err
	}
	detail := map[string]any{"role": s.Role, "runid": runID}
	if s.Lens != "" {
		detail["lens"] = s.Lens
	}
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindStageSessionStarted, nil, detail)
	return runID, nil
}

// stageSessionLost is JudgingSessionLost for a session of the dag g.
func stageSessionLost(ctx context.Context, g *waveobj.TaskGroup, runID string, startedTs, now int64) (reason string, final bool) {
	return JudgingSessionLost(ctx, g.ChannelId, runID, startedTs, now)
}

// JudgingSession is one judging session outside any task: a fresh session that reads Tree and ends with a verdict
// command its Prompt names. DagORef is empty for a session no dag owns. Route must be resolved by the caller.
type JudgingSession struct {
	ChannelId, WorkspaceId, DagORef string
	Role, Label, Tree, Prompt       string
	Route                           waveobj.RoutePin
}

// LaunchJudgingSession starts s on its route and records its child run, which carries the session id and Role and
// no task, so usage counts it under its role and a bare complete is not taken for a worker's. It returns the run id.
func LaunchJudgingSession(ctx context.Context, s JudgingSession) (string, error) {
	pin := s.Route
	if pin.Runtime == "" && pin.Model == "" {
		return "", fmt.Errorf("judging session %s: no route", s.Role)
	}
	capability, err := runroute.Resolve(pin)
	if err == nil {
		err = validateLeadHarness(pin.Runtime)
	}
	if err != nil {
		return "", err
	}
	runID, sessionId := uuid.NewString(), jarvis.WorkerSessionId(pin.Runtime)
	oref, err := spawnWorker(ctx, capability, s.WorkspaceId, "", s.Tree, s.Prompt,
		jarvis.RunWorkerOptions{SessionId: sessionId, RunId: runID, Label: s.Label})
	if err != nil {
		return "", err
	}
	child := jarvis.NewRun(s.Prompt, s.WorkspaceId, s.Tree, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), time.Now().UnixMilli())
	child.ID = runID
	child.Runtime, child.Model = pin.Runtime, pin.Model
	child.DagORef = s.DagORef
	child.SessionId = sessionId
	child.StageRole = s.Role
	for i := range child.Phases {
		if child.Phases[i].State == jarvis.PhaseState_Running {
			child.Phases[i].WorkerOrefs = []string{oref}
			break
		}
	}
	if err := appendChildRun(ctx, s.ChannelId, child); err != nil {
		if serr := stopUnrecordedWorker(ctx, oref); serr != nil {
			log.Printf("channel %s: stopping unrecorded %s %s: %v", s.ChannelId, s.Role, oref, serr)
		}
		return "", fmt.Errorf("recording the session: %w", err)
	}
	runORef := waveobj.MakeORef(waveobj.OType_Run, runID).String()
	channelORef := waveobj.MakeORef(waveobj.OType_Channel, s.ChannelId).String()
	if err := stampSpawnedWorker(ctx, oref, runORef, channelORef); err != nil {
		log.Printf("channel %s: stamp %s %s: %v", s.ChannelId, s.Role, oref, err)
	}
	if err := startWorker(ctx, oref); err != nil {
		abandonUnstartedWorker(ctx, s.ChannelId, runID, oref)
		return "", err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, runID))
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, s.ChannelId))
	return runID, nil
}

// JudgingSessionLost says why a judging session with no verdict is done for, or "" while it is still working. It
// is bounded like a task reviewer: judging a plan or a finished run takes minutes too. final is set when its route
// refused it, which a replacement on the same route would meet too.
func JudgingSessionLost(ctx context.Context, channelId, runID string, startedTs, now int64) (reason string, final bool) {
	run, err := wstore.GetRun(ctx, channelId, runID)
	if err == nil {
		if failure, refused := routeRefused(run, now); refused {
			recordRefusedRoute(run, failure, now)
			return "its route refused it: " + failure.Text, true
		}
	}
	if now-startedTs > ReviewTimeout.Milliseconds() {
		return withSessionFailure(fmt.Sprintf("it gave no verdict within %s", ReviewTimeout), run), false
	}
	if err != nil {
		return "", false // unreadable this tick; the timeout still bounds it
	}
	switch run.Status {
	case jarvis.RunStatus_Done, jarvis.RunStatus_Cancelled, jarvis.RunStatus_Blocked:
		return withSessionFailure("it ended without a verdict", run), false
	}
	if workerControllerGone(ctx, run) {
		return withSessionFailure("it exited without a verdict", run), false
	}
	// run b4e4a19d's Final coverage reviewer wrote its verdict command as text and sat at its prompt until the timeout
	if idlePastGrace(ctx, run, now) {
		return withSessionFailure("it ended its turn without a verdict", run), false
	}
	return "", false
}

// tendStageSession keeps a stage's one session going for a tick: it replaces a lost session, and starts the
// missing one, within MaxReviewRespawns. runID, startedTs and respawns are the stage's own bookkeeping. It
// returns why the stage gives up on its session, or "" while one is working or the next tick retries. The
// session is built only when one is spawned; a builder error counts as a spawn failure.
func tendStageSession(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, session func() (StageSession, error), runID *string, startedTs *int64, respawns *int, now int64, afterCommit *[]func()) string {
	if *runID != "" {
		reason, final := stageSessionLost(ctx, g, *runID, *startedTs, now)
		if reason == "" {
			return ""
		}
		stopReviewer(ctx, g, *runID, afterCommit)
		*runID = ""
		if final || *respawns >= MaxReviewRespawns {
			return reason
		}
		*respawns++
	}
	s, err := session()
	id := ""
	if err == nil {
		id, err = spawnStageSession(ctx, spawnCtx, g, owner, s)
	}
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

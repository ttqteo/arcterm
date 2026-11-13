// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// run ca080f5c: every reviewer alive at a pause was judged lost on the first tick after the resume, because its
// timeout counted the paused span. A reviewer that ran 5 minutes before a 90-minute pause has run 5 minutes.
func TestResumeShiftsReviewerClocksByThePause(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	f.markPaused(t)
	now := time.Now().UnixMilli()
	pausedAt := now - (90 * time.Minute).Milliseconds()
	started := pausedAt - (5 * time.Minute).Milliseconds()
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.PausedTs = pausedAt
		g.PlanReview = &waveobj.PlanReviewStage{State: PlanReviewState_Reviewing, Round: 1, Reviewers: []waveobj.PlanReviewer{
			{Lens: "full", State: "reviewing", RunID: "missing-plan-reviewer", StartedTs: started},
		}}
		g.Tasks[0].ReviewRunID, g.Tasks[0].ReviewSpawnedTs = "missing-task-reviewer", started
		g.Final = &waveobj.FinalStage{State: FinalState_Verifying, Round: 1, VerifierRunID: "missing-verifier", StartedTs: started}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// unshifted, all three are past ReviewTimeout
	if reason, _ := JudgingSessionLost(f.ctx, f.channel, "missing-plan-reviewer", started, now); reason == "" {
		t.Fatal("the fixture's reviewer must read lost before the shift, or the test proves nothing")
	}
	if err := withDagMutation(f.dagID, func() error {
		_, err := unmarkDagPaused(f.ctx, f.dagID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	g := f.dag(t)
	later := now + (5 * time.Minute).Milliseconds()
	for name, ts := range map[string]int64{
		"plan reviewer":  g.PlanReview.Reviewers[0].StartedTs,
		"task reviewer":  g.Tasks[0].ReviewSpawnedTs,
		"final verifier": g.Final.StartedTs,
	} {
		ran := later - ts
		if ran < (9*time.Minute).Milliseconds() || ran > (11*time.Minute).Milliseconds() {
			t.Fatalf("%s: at T+95min it has run %s, want ~10min (5 before the pause, 5 after)", name, time.Duration(ran)*time.Millisecond)
		}
		if reason, _ := JudgingSessionLost(f.ctx, f.channel, "missing-"+name, ts, later); reason != "" {
			t.Fatalf("%s: judged lost after the resume: %s", name, reason)
		}
	}
	if reason, _ := reviewerLost(f.ctx, g, &g.Tasks[0], later); reason != "" {
		t.Fatalf("the task reviewer is judged lost after the resume: %s", reason)
	}
}

// reopenFixture is a pause fixture whose lead launches are captured: LaunchLeadHook stands in for the spawn, putting the
// new lead's tab on the running phase as spawnRunWorkersWithPrompt does.
func reopenFixture(t *testing.T) (*pauseFixture, *[]string) {
	t.Helper()
	f := newPauseFixture(t, "t-0")
	origWakes := wakes
	wakes = newWaker()
	var prompts []string
	oldHook := LaunchLeadHook
	LaunchLeadHook = func(ctx context.Context, channelId, runId, prompt string) error {
		prompts = append(prompts, prompt)
		return wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
			r.Phases[0].WorkerOrefs = append(r.Phases[0].WorkerOrefs, "tab:fresh-lead")
			return nil
		})
	}
	restoreAfterStages(t, func() { wakes, LaunchLeadHook = origWakes, oldHook })
	return f, &prompts
}

// run ca080f5c's lead was paused before Claude wrote its first turn, and every resume ran `claude --resume <id>` into
// "No conversation found" and exit 1. A session with no transcript is started fresh, on the text it never read.
func TestReopenWithoutTranscriptRelaunchesTheLead(t *testing.T) {
	cfg := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", cfg)
	sessionId := uuid.NewString()
	lead := waveobj.PausedSession{RunId: "", WorkerORef: "tab:lead", Runtime: "claude", SessionId: sessionId}

	t.Run("no transcript", func(t *testing.T) {
		f, prompts := reopenFixture(t)
		calls := stubResume(t, nil)
		claudeTranscriptFn = claudeTranscriptExists
		const launchText = "wake: the plan reviewer did not finish in round 1. Run `wsh jarvis dag submit` again."
		if _, err := wstore.AppendRunEvent(f.ctx, f.channel, f.ownerID, waveobj.RunEventKindLeadLaunched, nil, map[string]any{"text": "an older launch"}); err != nil {
			t.Fatal(err)
		}
		time.Sleep(2 * time.Millisecond) // rows are ordered by ts
		if _, err := wstore.AppendRunEvent(f.ctx, f.channel, f.ownerID, waveobj.RunEventKindLeadLaunched, nil, map[string]any{"text": launchText}); err != nil {
			t.Fatal(err)
		}
		s := lead
		s.RunId = f.ownerID
		if err := ReopenSession(f.ctx, s, "carry on"); err != nil {
			t.Fatal(err)
		}
		if len(*calls) != 0 {
			t.Fatalf("a session with no transcript was resumed: %+v", *calls)
		}
		if len(*prompts) != 1 || !strings.Contains((*prompts)[0], launchText) || strings.Contains((*prompts)[0], "an older launch") {
			t.Fatalf("want one fresh lead launched on the newest launch text, got %q", *prompts)
		}
		if got := f.run(t, f.ownerID).Phases[0].WorkerOrefs; len(got) != 1 || got[0] != "tab:fresh-lead" {
			t.Fatalf("the phase names %v, want only the fresh lead's tab", got)
		}

		// a task's worker is left to its stalled retry
		worker := waveobj.PausedSession{RunId: f.workers["t-0"], WorkerORef: "tab:w-t-0", Runtime: "claude", SessionId: uuid.NewString()}
		if err := ReopenSession(f.ctx, worker, "carry on"); err == nil || !strings.Contains(err.Error(), "no transcript to resume") {
			t.Fatalf("a task worker with no transcript: %v, want an error naming why", err)
		}
		if len(*calls) != 0 || len(*prompts) != 1 {
			t.Fatalf("a task worker with no transcript resumed or launched something: %+v %q", *calls, *prompts)
		}
	})

	t.Run("transcript present", func(t *testing.T) {
		f, prompts := reopenFixture(t)
		calls := stubResume(t, nil)
		claudeTranscriptFn = claudeTranscriptExists
		dir := filepath.Join(cfg, "projects", "D--proj")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, sessionId+".jsonl"), []byte("{}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		s := lead
		s.RunId = f.ownerID
		s.WorkerORef = insertTab(t, f.ctx)
		if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
			r.Phases[0].WorkerOrefs = []string{s.WorkerORef}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if err := ReopenSession(f.ctx, s, "carry on"); err != nil {
			t.Fatal(err)
		}
		if len(*calls) != 1 || (*calls)[0].session != sessionId || len(*prompts) != 0 {
			t.Fatalf("a session with a transcript resumes as before, got resumes %+v launches %q", *calls, *prompts)
		}
	})
}

// leadExitFixture is a dag run in plan review whose lead's tab is a real, stamped tab, so HandleRunWorkerExit
// resolves the exit to the run as it does live.
func leadExitFixture(t *testing.T, autonomous bool) (*fakeLead, *pauseFixture, string) {
	t.Helper()
	fake := newFakeLead(t)
	fake.state.Alive = false
	f := newPauseFixture(t, "t-0")
	leadTab := insertTab(t, f.ctx)
	runORef := waveobj.MakeORef(waveobj.OType_Run, f.ownerID).String()
	channelORef := waveobj.MakeORef(waveobj.OType_Channel, f.channel).String()
	if err := wstore.StampWorkerOwner(f.ctx, leadTab, runORef, channelORef); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		r.Phases[0].WorkerOrefs = []string{leadTab}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.Autonomous = autonomous
		g.PlanReview = &waveobj.PlanReviewStage{State: PlanReviewState_Failed, Round: 1, Findings: "it never finished"}
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	seedRunAsk(f.dag(t), "block:child-1", "a1")
	return fake, f, leadTab
}

// run ca080f5c: the lead's exit returned early for a dag run, and a dag waiting on a resubmit posts no wake, so
// nothing noticed it was gone and nothing offered Relaunch lead.
func TestDagLeadExitHandsOverToTheWaker(t *testing.T) {
	exit := jarvis.WorkerExit{ExitCode: 1, Output: "No conversation found with session ID"}

	t.Run("autonomous", func(t *testing.T) {
		fake, f, leadTab := leadExitFixture(t, true)
		calls := stubRelaunch(t, func() error { return nil })
		if err := HandleRunWorkerExit(f.ctx, leadTab, exit); err != nil {
			t.Fatal(err)
		}
		waitStages(t)
		if n := fake.countKind(waveobj.RunEventKindLeadWakeFailed); n != 1 || *calls != 1 {
			t.Fatalf("want one lead-wake-failed row and one relaunch, got %d rows and %d relaunches", n, *calls)
		}
		if p, _ := agentask.GlobalRegistry.Get("block:child-1"); p.Owner != agentask.AskOwner_Lead {
			t.Fatalf("the relaunched lead keeps its question, got %+v", p)
		}
	})

	t.Run("asking", func(t *testing.T) {
		fake, f, leadTab := leadExitFixture(t, false)
		calls := stubRelaunch(t, func() error { return nil })
		if err := HandleRunWorkerExit(f.ctx, leadTab, exit); err != nil {
			t.Fatal(err)
		}
		waitStages(t)
		if n := fake.countKind(waveobj.RunEventKindLeadWakeFailed); n != 1 || *calls != 0 {
			t.Fatalf("want the row and no relaunch, got %d rows and %d relaunches", n, *calls)
		}
		if p, _ := agentask.GlobalRegistry.Get("block:child-1"); p.Owner != agentask.AskOwner_User || p.Note != leadNotRunningNote {
			t.Fatalf("the lead's question goes to the human, got %+v", p)
		}
	})

	t.Run("dag done", func(t *testing.T) {
		fake, f, leadTab := leadExitFixture(t, true)
		calls := stubRelaunch(t, func() error { return nil })
		if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
			g.Status = DagStatus_Done
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if err := HandleRunWorkerExit(f.ctx, leadTab, exit); err != nil {
			t.Fatal(err)
		}
		waitStages(t)
		if n := fake.countKind(waveobj.RunEventKindLeadWakeFailed); n != 0 || *calls != 0 {
			t.Fatalf("a lead exiting after its dag is done changes nothing, got %d rows and %d relaunches", n, *calls)
		}
	})

	t.Run("paused", func(t *testing.T) {
		fake, f, leadTab := leadExitFixture(t, true)
		calls := stubRelaunch(t, func() error { return nil })
		f.markPaused(t)
		if err := HandleRunWorkerExit(f.ctx, leadTab, exit); err != nil {
			t.Fatal(err)
		}
		waitStages(t)
		if n := fake.countKind(waveobj.RunEventKindLeadWakeFailed); n != 0 || *calls != 0 {
			t.Fatalf("a lead the pause stopped is not dead, got %d rows and %d relaunches", n, *calls)
		}
	})

	t.Run("task worker", func(t *testing.T) {
		fake, f, _ := leadExitFixture(t, true)
		calls := stubRelaunch(t, func() error { return nil })
		workerTab := insertTab(t, f.ctx)
		runORef := waveobj.MakeORef(waveobj.OType_Run, f.workers["t-0"]).String()
		if err := wstore.StampWorkerOwner(f.ctx, workerTab, runORef, waveobj.MakeORef(waveobj.OType_Channel, f.channel).String()); err != nil {
			t.Fatal(err)
		}
		if err := wstore.UpdateRun(f.ctx, f.channel, f.workers["t-0"], func(r *waveobj.Run) error {
			r.Phases[0].WorkerOrefs = []string{workerTab}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		LeadExited(f.ctx, f.channel, f.workers["t-0"])
		if err := HandleRunWorkerExit(f.ctx, workerTab, exit); err != nil {
			t.Fatal(err)
		}
		waitStages(t)
		if n := fake.countKind(waveobj.RunEventKindLeadWakeFailed); n != 0 || *calls != 0 {
			t.Fatalf("a task worker's exit is not the lead's, got %d rows and %d relaunches", n, *calls)
		}
	})
}

func TestReplacementLeadWakeSaysWhatTheDagWaitsOn(t *testing.T) {
	running := "do not resubmit the plan"
	for name, c := range map[string]struct {
		g          *waveobj.TaskGroup
		want, flag string
	}{
		"no dag read": {nil, running, ""},
		"running":     {&waveobj.TaskGroup{Status: DagStatus_Running}, running, ""},
		"plan review failed": {
			&waveobj.TaskGroup{Status: DagStatus_PlanReview, PlanReview: &waveobj.PlanReviewStage{State: PlanReviewState_Failed, Round: 1}},
			"run `wsh jarvis dag submit` again", running,
		},
		"plan review failed, last round, autonomous": {
			&waveobj.TaskGroup{Status: DagStatus_PlanReview, Autonomous: true, PlanReview: &waveobj.PlanReviewStage{State: PlanReviewState_Failed, Round: MaxPlanReviewRounds}},
			"wsh jarvis dag planreview accept", running,
		},
		"plan review still reviewing": {
			&waveobj.TaskGroup{Status: DagStatus_PlanReview, PlanReview: &waveobj.PlanReviewStage{State: PlanReviewState_Reviewing, Round: 1}},
			running, "",
		},
		"final failed": {
			&waveobj.TaskGroup{Status: DagStatus_Blocked, RunID: "run-9", Final: &waveobj.FinalStage{State: FinalState_Failed, Round: 1, Detail: "the view never loads"}},
			"Write a fix plan", running,
		},
		"final killed": {
			&waveobj.TaskGroup{Status: DagStatus_Blocked, RunID: "run-9", Final: &waveobj.FinalStage{State: FinalState_Failed, Round: 1, Killed: true}},
			"wsh runs rerun-final run-9", running,
		},
	} {
		t.Run(name, func(t *testing.T) {
			got := replacementLeadWake(c.g, []string{"wake: task t-1 passed"})
			if !strings.HasPrefix(got, "You are a replacement lead") || !strings.Contains(got, c.want) {
				t.Fatalf("got %q, want it to say %q", got, c.want)
			}
			if c.flag != "" && strings.Contains(got, c.flag) {
				t.Fatalf("got %q, which must not say %q", got, c.flag)
			}
			if !strings.HasSuffix(got, "while no lead was running:\nwake: task t-1 passed") {
				t.Fatalf("the missed events must close the wake, got %q", got)
			}
		})
	}
}

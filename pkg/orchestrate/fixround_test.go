// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedFixRoundDag is seedReviewDag whose worker ran a claude session in a tab of its own, as a dispatched worker
// does. It returns the worker's tab oref and its block's oref.
func seedFixRoundDag(t *testing.T) (context.Context, *waveobj.TaskGroup, waveobj.Run, string, string) {
	t.Helper()
	ctx, dag, worker := seedReviewDag(t)
	tab := insertTab(t, ctx)
	tabRow, err := wstore.DBMustGet[*waveobj.Tab](ctx, strings.TrimPrefix(tab, "tab:"))
	if err != nil {
		t.Fatal(err)
	}
	block := waveobj.MakeORef(waveobj.OType_Block, tabRow.BlockIds[0]).String()
	if err := wstore.UpdateRun(ctx, dag.ChannelId, worker.ID, func(r *waveobj.Run) error {
		r.Runtime = "claude"
		r.SessionId = "sess-" + uuid.NewString()
		r.Branch = "wave/lane-0"
		r.Phases[0].WorkerOrefs = []string{tab}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	fresh, err := wstore.GetRun(ctx, dag.ChannelId, worker.ID)
	if err != nil {
		t.Fatal(err)
	}
	return ctx, dag, *fresh, tab, block
}

// noteContext publishes the context size a worker's statusline would report.
func noteContext(block string, pct float64, max int) {
	NoteWorkerContext(&wps.WaveEvent{Event: wps.Event_AgentStatus, Data: baseds.AgentStatusData{
		ORef: block, Usage: &baseds.AgentUsage{ContextPct: pct, ContextMax: max},
	}})
}

// failFirstReview starts the reviewer and records a failing verdict, then ticks so the verdict applies.
func failFirstReview(t *testing.T, ctx context.Context, dagID, note string) {
	t.Helper()
	schedule(t, ctx, dagID)
	reviewer := firstTask(t, ctx, dagID).ReviewRunID
	if reviewer == "" {
		t.Fatal("no reviewer was started")
	}
	if err := RecordReviewVerdict(ctx, dagID, reviewer, ReviewVerdict_Fail, note, "", "", nil); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dagID)
}

func fixRoundEvent(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup) map[string]any {
	t.Helper()
	events := runEventsOfKind(t, ctx, dag.ChannelId, dag.RunID, waveobj.RunEventKindTaskFixRound)
	if len(events) != 1 {
		t.Fatalf("want one task-fix-round event, got %d", len(events))
	}
	var d map[string]any
	if err := json.Unmarshal(events[0].Detail, &d); err != nil {
		t.Fatal(err)
	}
	return d
}

func TestFirstFailedReviewReopensTheWorkersSessionBelowTheContextLimit(t *testing.T) {
	ctx, dag, worker, tab, block := seedFixRoundDag(t)
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	resumes := stubResume(t, nil)
	// 1M window at 14%: 140k tokens, under the limit whatever the window
	noteContext(block, 14, 1_000_000)

	failFirstReview(t, ctx, dag.OID, "misses the empty-input case")

	task := firstTask(t, ctx, dag.OID)
	if task.State != TaskState_Running || task.ReviewRound != 1 || task.RunID == "" || task.RunID == worker.ID {
		t.Fatalf("want the task running on a new run, got state %s round %d run %q", task.State, task.ReviewRound, task.RunID)
	}
	if len(*calls) != 1 {
		t.Fatalf("only the reviewer may be spawned, got %d spawns", len(*calls))
	}
	if len(*resumes) != 1 {
		t.Fatalf("want one resume, got %d", len(*resumes))
	}
	r := (*resumes)[0]
	if r.tab != tab || r.session != worker.SessionId || r.runtime != "claude" {
		t.Fatalf("resume must reopen the worker's own session in its tab, got %+v", r)
	}
	for _, want := range []string{"rejected your commit work111", "misses the empty-input case", "on top of the lane's current commit", "wsh jarvis complete --commit $(git rev-parse HEAD) --report " + WorkerReportPath(dag.OID, "t-0")} {
		if !strings.Contains(r.nudge, want) {
			t.Fatalf("nudge %q lacks %q", r.nudge, want)
		}
	}
	round, err := wstore.GetRun(ctx, dag.ChannelId, task.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if round.SessionId != worker.SessionId || round.Branch != worker.Branch || round.BaseCommit != worker.BaseCommit || round.TaskId != "t-0" {
		t.Fatalf("the round's run must carry the worker's session, branch and base, got %+v", round)
	}
	if runTabID(round) != strings.TrimPrefix(tab, "tab:") {
		t.Fatalf("the round's run must name the worker's tab, got %v", round.Phases)
	}
	runORef, _, err := wstore.GetWorkerOwner(ctx, tab)
	if err != nil || runORef != waveobj.MakeORef(waveobj.OType_Run, round.ID).String() {
		t.Fatalf("the tab must be stamped with the round's run so complete reaches it, got %q (%v)", runORef, err)
	}
	if len(task.LeadTold) != 1 || task.LeadTold[0] != r.nudge {
		t.Fatalf("the told scan must skip the findings as the engine's words, got %q", task.LeadTold)
	}
	if d := fixRoundEvent(t, ctx, dag); d["samesession"] != true || d["taskid"] != "t-0" {
		t.Fatalf("want a same-session fix round event, got %v", d)
	}
}

func TestFixRoundFallsBackToAFreshWorker(t *testing.T) {
	cases := []struct {
		name  string
		setup func(t *testing.T, block string) // runs after stubResume
		tab   bool                             // false: the worker's tab was closed
		fail  error                            // the resume's error
		want  string
	}{
		{name: "no context figure", tab: true, setup: func(*testing.T, string) {}, want: "reported no context size"},
		{name: "context at the limit", tab: true, setup: func(_ *testing.T, b string) { noteContext(b, 75, 200_000) }, want: "context is 150k tokens"},
		{name: "no transcript", tab: true, setup: func(t *testing.T, b string) { noteContext(b, 10, 200_000); stubTranscripts(t, false) }, want: "has no transcript"},
		{name: "tab gone", tab: false, setup: func(*testing.T, string) {}, want: "tab is gone"},
		{name: "resume fails", tab: true, setup: func(_ *testing.T, b string) { noteContext(b, 10, 200_000) }, fail: errors.New("the worker was launched before resume support"), want: "reopening the session failed: the worker was launched before resume support"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, dag, worker, tab, block := seedFixRoundDag(t)
			if !c.tab {
				if err := wstore.DBDelete(ctx, waveobj.OType_Tab, strings.TrimPrefix(tab, "tab:")); err != nil {
					t.Fatal(err)
				}
			}
			stubReviewTree(t, worker.EndCommit)
			calls := captureSpawns(t)
			resumes := stubResume(t, func(context.Context, reopened) error { return c.fail })
			var stopped []string
			old := stopSpawnedWorker
			stopSpawnedWorker = func(_ context.Context, oref string) error { stopped = append(stopped, oref); return nil }
			restoreAfterStages(t, func() { stopSpawnedWorker = old })
			c.setup(t, block)

			failFirstReview(t, ctx, dag.OID, "misses the empty-input case")

			task := firstTask(t, ctx, dag.OID)
			if task.State != TaskState_Running || task.RunID == worker.ID {
				t.Fatalf("want a fresh worker running the round, got state %s run %q", task.State, task.RunID)
			}
			if len(*calls) != 2 || !strings.Contains((*calls)[1].prompt, "A reviewer rejected the previous attempt (commit work111): misses the empty-input case") {
				t.Fatalf("the fresh worker must get the findings, got %d spawns", len(*calls))
			}
			round, err := wstore.GetRun(ctx, dag.ChannelId, task.RunID)
			if err != nil {
				t.Fatal(err)
			}
			if round.SessionId == worker.SessionId {
				t.Fatal("a fresh worker must start a new session")
			}
			if c.fail == nil && len(*resumes) != 0 {
				t.Fatalf("no resume may be tried, got %d", len(*resumes))
			}
			if c.fail != nil && (len(stopped) != 1 || stopped[0] != tab) {
				t.Fatalf("a failed resume must disarm the worker's tab, got %v", stopped)
			}
			d := fixRoundEvent(t, ctx, dag)
			if d["samesession"] != false || !strings.Contains(d["reason"].(string), c.want) {
				t.Fatalf("want a fresh-worker event naming %q, got %v", c.want, d)
			}
		})
	}
}

func TestSecondFailedReviewAfterASameSessionRoundStillGoesToTheLead(t *testing.T) {
	ctx, dag, worker, _, block := seedFixRoundDag(t)
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	stubResume(t, nil)
	noteContext(block, 10, 200_000)
	f := newFakeLead(t)
	failFirstReview(t, ctx, dag.OID, "misses the empty-input case")
	round := firstTask(t, ctx, dag.OID).RunID
	// the reopened session finishes the round with a new commit
	if err := wstore.UpdateRun(ctx, dag.ChannelId, round, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Done
		r.EndCommit = worker.EndCommit
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	failFirstReview(t, ctx, dag.OID, "still misses it")
	task := firstTask(t, ctx, dag.OID)
	if task.State != TaskState_ReviewFailed || task.RunID != round {
		t.Fatalf("want review-failed on the round's run, got state %s run %q", task.State, task.RunID)
	}
	if !strings.Contains(strings.Join(f.sends, "\n"), "wake: review failed for task t-0: still misses it") {
		t.Fatalf("the lead must be woken, got %q", f.sends)
	}
}

// a reopened session's latest report is still the first round's Stop until its new turn reports: that idle is not
// the round's turn ending, or the round would stall before it starts
func TestTurnEndedIgnoresAnIdleFromBeforeTheRunStarted(t *testing.T) {
	block := uuid.NewString()
	prev := workerBlockFn
	workerBlockFn = func(context.Context, *waveobj.Run) (string, bool) { return block, true }
	t.Cleanup(func() { workerBlockFn = prev })
	run := jarvis.NewRun("round two", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 2_000)
	idleAt := func(ts int64) {
		oref := waveobj.MakeORef(waveobj.OType_Block, block).String()
		wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_AgentStatus, Scopes: []string{oref}, Persist: 1,
			Data: baseds.AgentStatusData{ORef: oref, State: baseds.AgentState_Idle, Ts: ts}})
	}
	idleAt(1_000)
	if got := workerTurnEndedAt(context.Background(), &run); got != 0 {
		t.Fatalf("an idle from before the run started reads as its turn ending at %d", got)
	}
	idleAt(3_000)
	if got := workerTurnEndedAt(context.Background(), &run); got != 3_000 {
		t.Fatalf("the run's own idle must read as its turn ending, got %d", got)
	}
}

func TestContextTokensNeedsBothFigures(t *testing.T) {
	if n, ok := contextTokens(&baseds.AgentUsage{ContextPct: 50, ContextMax: 200_000}); !ok || n != 100_000 {
		t.Fatalf("50%% of 200k = %d %v", n, ok)
	}
	for _, u := range []baseds.AgentUsage{{ContextPct: 50}, {ContextMax: 200_000}} {
		if _, ok := contextTokens(&u); ok {
			t.Fatalf("%+v must report no figure", u)
		}
	}
}

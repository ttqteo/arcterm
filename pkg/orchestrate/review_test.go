// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedReviewDag is a one-task dag whose worker has just finished with a commit: the state review starts from.
func seedReviewDag(t *testing.T) (context.Context, *waveobj.TaskGroup, waveobj.Run) {
	t.Helper()
	ctx, dag := seedPendingDag(t)
	worker := jarvis.NewRun("worker goal", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	worker.Status = jarvis.RunStatus_Done
	worker.BaseCommit = "base000"
	worker.EndCommit = "work111"
	worker.DagORef = dag.OID
	if err := wstore.AppendRun(ctx, dag.ChannelId, worker); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Running
		g.Tasks[0].RunID = worker.ID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return ctx, dag, worker
}

// stubReviewTree scripts the lane tree's HEAD and counts the resets a moved HEAD triggers.
func stubReviewTree(t *testing.T, head string) *int {
	t.Helper()
	resets := 0
	oldHead, oldReset := reviewTreeHead, resetReviewTree
	reviewTreeHead = func(context.Context, string) (string, error) { return head, nil }
	resetReviewTree = func(context.Context, string, string) error { resets++; return nil }
	restoreAfterStages(t, func() { reviewTreeHead, resetReviewTree = oldHead, oldReset })
	return &resets
}

type spawnCall struct {
	cap    runroute.Capability
	cwd    string
	prompt string
	opts   jarvis.RunWorkerOptions
}

// captureSpawns records every worker and reviewer the engine starts.
func captureSpawns(t *testing.T) *[]spawnCall {
	t.Helper()
	allowWorkerHarnessForTest(t)
	var calls []spawnCall
	old := spawnWorker
	spawnWorker = func(_ context.Context, cap runroute.Capability, _, _, cwd, prompt string, opts jarvis.RunWorkerOptions) (string, error) {
		calls = append(calls, spawnCall{cap: cap, cwd: cwd, prompt: prompt, opts: opts})
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })
	return &calls
}

func stubStopRunWorkers(t *testing.T) {
	t.Helper()
	old := stopRunWorkers
	stopRunWorkers = func(context.Context, *waveobj.Run) error { return nil }
	restoreAfterStages(t, func() { stopRunWorkers = old })
}

func firstTask(t *testing.T, ctx context.Context, dagID string) waveobj.TaskNode {
	t.Helper()
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		t.Fatal(err)
	}
	return g.Tasks[0]
}

func schedule(t *testing.T, ctx context.Context, dagID string) {
	t.Helper()
	if err := Schedule(ctx, dagID); err != nil {
		t.Fatal(err)
	}
}

func endRun(t *testing.T, ctx context.Context, channelId, runID string) {
	t.Helper()
	if err := wstore.UpdateRun(ctx, channelId, runID, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Cancelled
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// the reviewer works in the worker's tree, so a branch-landed dag's docs are the snapshot there
func TestReviewerReadsTheDocsInTheWorkersTree(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.PlanPath, g.SpecPath = "docs/superpowers/plans/p.md", "docs/superpowers/specs/s.md"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	if len(*calls) != 1 {
		t.Fatalf("want one reviewer spawned, got %d", len(*calls))
	}
	c := (*calls)[0]
	want := fmt.Sprintf("of the plan at %s (spec: %s).", filepath.Join(c.cwd, "docs/superpowers/plans/p.md"), filepath.Join(c.cwd, "docs/superpowers/specs/s.md"))
	if c.cwd != worker.ProjectPath || !strings.Contains(c.prompt, want) {
		t.Fatalf("reviewer in %q, want %q, with %q in its prompt: %q", c.cwd, worker.ProjectPath, want, c.prompt)
	}
}

func TestFinishedWorkerIsReviewedBeforeItCountsAsDone(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	task := firstTask(t, ctx, dag.OID)
	if task.State != TaskState_Reviewing || task.ReviewRunID == "" {
		t.Fatalf("want reviewing with a reviewer, got %s reviewer %q", task.State, task.ReviewRunID)
	}
	if len(*calls) != 1 {
		t.Fatalf("want one reviewer spawned, got %d", len(*calls))
	}
	p := (*calls)[0].prompt
	for _, want := range []string{"You are the reviewer for task t-0", "git diff base000..work111", "wsh jarvis dag review pass", "wsh jarvis dag review fail"} {
		if !strings.Contains(p, want) {
			t.Fatalf("reviewer prompt missing %q: %q", want, p)
		}
	}
	schedule(t, ctx, dag.OID)
	if len(*calls) != 1 {
		t.Fatalf("a second tick must not spawn another reviewer, got %d", len(*calls))
	}
}

func TestReviewerRunsOnTheLeadsRouteInTheLaneTree(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	if err := wstore.UpdateRun(ctx, dag.ChannelId, dag.RunID, func(r *waveobj.Run) error {
		r.Runtime, r.Model = "claude", "opus"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.WorkerRoute = &waveobj.RoutePin{Runtime: "claude", Model: "sonnet"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	if len(*calls) != 1 {
		t.Fatalf("want one reviewer, got %d", len(*calls))
	}
	c := (*calls)[0]
	if c.cap.Model != "opus" || c.cwd != worker.ProjectPath || c.opts.Label != "review t-0" || c.opts.TaskId != "t-0" {
		t.Fatalf("reviewer must run on the lead's route in the lane tree, got model %q cwd %q opts %+v", c.cap.Model, c.cwd, c.opts)
	}
}

// agy and codex are workers, not leads: a reviewer judges, so an agy or codex reviewer route fails with the
// capability's own message and spawns nothing.
func TestReviewerRouteLead(t *testing.T) {
	for _, runtime := range []string{"agy", "codex"} {
		t.Run(runtime, func(t *testing.T) {
			ctx, dag, worker := seedReviewDag(t)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.ReviewerRoute = &waveobj.RoutePin{Runtime: runtime}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			stubReviewTree(t, worker.EndCommit)
			calls := captureSpawns(t)
			capableLeadHarnessForTest(t)
			schedule(t, ctx, dag.OID)
			task := firstTask(t, ctx, dag.OID)
			if len(*calls) != 0 {
				t.Fatalf("a %s reviewer must not spawn, got %d spawns", runtime, len(*calls))
			}
			if !strings.Contains(task.ReviewNote, "cannot lead") {
				t.Fatalf("want the cannot-lead message in the review note, got %+v", task)
			}
		})
	}
}

func TestReviewWaitsForTheWorkersEvidence(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	if err := wstore.UpdateRun(ctx, dag.ChannelId, worker.ID, func(r *waveobj.Run) error {
		r.Phases[0].DoneTs = time.Now().UnixMilli()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	if len(*calls) != 0 {
		t.Fatal("a reviewer must wait for the worker's closing note while the seal is in flight")
	}
	if err := wstore.UpdateRun(ctx, dag.ChannelId, worker.ID, func(r *waveobj.Run) error {
		r.Evidence = &waveobj.RunEvidence{Summary: "Added fmtDate with tests."}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	if len(*calls) != 1 || !strings.Contains((*calls)[0].prompt, "The worker reported: Added fmtDate with tests.") {
		t.Fatalf("the reviewer must get the worker's note, got %d spawns", len(*calls))
	}
}

func TestReviewPassLandsTheTaskAndTellsTheLeadQuietly(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "adds fmtDate with tests", "", "", nil); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	if got := firstTask(t, ctx, dag.OID); got.State != TaskState_Done {
		t.Fatalf("a pass lands the task, got %s", got.State)
	}
	joined := strings.Join(f.sends, "\n")
	if !strings.Contains(joined, "Since your last wake:\nt-0 passed review: adds fmtDate with tests") {
		t.Fatalf("the run-finished wake must carry the quiet line, got %q", f.sends)
	}
	if f.countKind(waveobj.RunEventKindTaskReviewPassed) != 1 {
		t.Fatal("want one task-review-passed row")
	}
}

// the caveat is what the lead must act on, so it comes first and whole; only the note's recap is cut
func TestReviewPassPrintsTheUnverifiedCaveatWholeAheadOfTheNote(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	unverified := strings.Repeat("u", 1499) + "!"
	note := strings.Repeat("n", 1500)
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, note, "", unverified, nil); err != nil {
		t.Fatal(err)
	}
	if got := firstTask(t, ctx, dag.OID).ReviewUnverified; got != unverified {
		t.Fatalf("the caveat must be stored whole, got %d runes", utf8.RuneCountInString(got))
	}
	schedule(t, ctx, dag.OID)
	joined := strings.Join(f.sends, "\n")
	if want := "Unverified:\nt-0 reviewer: " + unverified; !strings.Contains(joined, want) {
		t.Fatalf("want the whole caveat under Unverified, got %q", f.sends)
	}
	if want := "t-0 passed review: " + strings.Repeat("n", handoffMaxSummaryLen) + "..."; !strings.Contains(joined, want) {
		t.Fatalf("want the recap with its note cut, got %q", f.sends)
	}
}

// with no task after it, a reviewer's note has nobody to reach but the lead
func TestReviewDownstreamWithNoLaterTaskWakesTheLead(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "adds fmtDate", "fmtDate lives in\nutil/date.go", "", nil); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	want := "wake: task t-0 passed review with a note for later tasks: fmtDate lives in util/date.go. wsh jarvis dag status"
	if !strings.Contains(strings.Join(f.sends, "\n"), want) {
		t.Fatalf("want the downstream wake %q, got %q", want, f.sends)
	}
}

func TestFirstFailedReviewSendsTheTaskBackWithFindings(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, "misses the empty-input case", "", "", nil); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	task := firstTask(t, ctx, dag.OID)
	if task.State != TaskState_Running || task.ReviewRound != 1 || task.RunID == worker.ID {
		t.Fatalf("a first fail re-dispatches a worker, got state %s round %d run %q", task.State, task.ReviewRound, task.RunID)
	}
	if len(*calls) != 2 || !strings.Contains((*calls)[1].prompt, "A reviewer rejected the previous attempt (commit work111): misses the empty-input case") {
		t.Fatalf("the next worker must get the findings, got %d spawns", len(*calls))
	}
}

func TestSecondFailedReviewGoesToTheLead(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].ReviewRound = 1
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, "still misses it", "", "", nil); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	task := firstTask(t, ctx, dag.OID)
	if task.State != TaskState_ReviewFailed || task.ReviewNote != "still misses it" || task.RunID != worker.ID {
		t.Fatalf("want review-failed keeping the findings and the worker run, got %+v", task)
	}
	if !strings.Contains(strings.Join(f.sends, "\n"), "wake: review failed for task t-0. wsh jarvis dag status") {
		t.Fatalf("the lead must be woken, got %q", f.sends)
	}
}

func TestVerdictsAreRefusedWhenTheyCannotApply(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Pending, Deps: []string{"t-0"}})
	cases := []struct {
		name, run, verdict, note, downstream, unverified string
		downstreamFor                                    []string
	}{
		{"not the reviewer", worker.ID, ReviewVerdict_Pass, "ok", "", "", nil},
		{"unknown verdict", reviewer, "maybe", "ok", "", "", nil},
		{"no note", reviewer, ReviewVerdict_Fail, "  ", "", "", nil},
		{"downstream on a fail", reviewer, ReviewVerdict_Fail, "bad", "later", "", nil},
		{"unverified on a fail", reviewer, ReviewVerdict_Fail, "bad", "", "x", nil},
		{"targets without a note", reviewer, ReviewVerdict_Pass, "ok", "", "", []string{"t-1"}},
		{"an unknown target", reviewer, ReviewVerdict_Pass, "ok", "later", "", []string{"t-9"}},
		{"the reviewed task as its own target", reviewer, ReviewVerdict_Pass, "ok", "later", "", []string{"t-0"}},
		{"a note over the limit", reviewer, ReviewVerdict_Fail, strings.Repeat("x", MaxReviewNoteLen+1), "", "", nil},
		{"a downstream note over the limit", reviewer, ReviewVerdict_Pass, "ok", strings.Repeat("x", MaxReviewNoteLen+1), "", []string{"t-1"}},
		{"an unverified note over the limit", reviewer, ReviewVerdict_Pass, "ok", "", strings.Repeat("x", MaxReviewNoteLen+1), nil},
	}
	for _, c := range cases {
		err := RecordReviewVerdict(ctx, dag.OID, c.run, c.verdict, c.note, c.downstream, c.unverified, c.downstreamFor)
		if err == nil {
			t.Fatalf("%s: want an error", c.name)
		}
		if c.name == "unverified on a fail" && !strings.Contains(err.Error(), "--unverified goes with a pass") {
			t.Fatalf("a fail's caveat must be refused with the reason, got %v", err)
		}
		if c.name == "targets without a note" && err.Error() != forLaterNoneRefusal {
			t.Fatalf("--for alone with no report to forward must say so, got %v", err)
		}
	}
	// the limit counts runes, not bytes, and a note at it is kept whole
	atLimit := strings.Repeat("é", MaxReviewNoteLen)
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, atLimit, "", "", nil); err != nil {
		t.Fatal(err)
	}
	if got := firstTask(t, ctx, dag.OID).ReviewNote; got != atLimit {
		t.Fatalf("a note at the limit must be stored whole, got %d runes", utf8.RuneCountInString(got))
	}
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Fail, "changed my mind", "", "", nil); err == nil {
		t.Fatal("a second verdict must be refused")
	}
}

func TestReviewerThatEndsWithoutAVerdictIsReplacedOnce(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	stubStopRunWorkers(t)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	endRun(t, ctx, dag.ChannelId, firstTask(t, ctx, dag.OID).ReviewRunID)
	schedule(t, ctx, dag.OID)
	task := firstTask(t, ctx, dag.OID)
	if len(*calls) != 2 || task.ReviewRespawns != 1 || task.State != TaskState_Reviewing {
		t.Fatalf("want one replacement reviewer, got %d spawns, %+v", len(*calls), task)
	}
	endRun(t, ctx, dag.ChannelId, task.ReviewRunID)
	schedule(t, ctx, dag.OID)
	task = firstTask(t, ctx, dag.OID)
	if task.State != TaskState_ReviewFailed || task.ReviewNote != "reviewer ended without a verdict" || len(*calls) != 2 {
		t.Fatalf("a second silent reviewer hands the task to the lead, got %+v after %d spawns", task, len(*calls))
	}
}

func TestReviewerThatCommittedIsOverruled(t *testing.T) {
	ctx, dag, _ := seedReviewDag(t)
	resets := stubReviewTree(t, "moved999")
	captureSpawns(t)
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "looks fine", "", "", nil); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	task := firstTask(t, ctx, dag.OID)
	if task.State != TaskState_ReviewFailed || !strings.Contains(task.ReviewNote, "reviewer modified the worktree") || *resets != 1 || task.ReviewVerdict != "" {
		t.Fatalf("a reviewer's commit discards its verdict and resets the tree, got %+v resets %d", task, *resets)
	}
}

func TestReviewerThatCannotStartIsRetriedOnce(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	allowWorkerHarnessForTest(t)
	stubSpawnWorker(t, "", errors.New("no tab"))
	schedule(t, ctx, dag.OID)
	task := firstTask(t, ctx, dag.OID)
	if task.State != TaskState_Reviewing || task.ReviewRespawns != 1 {
		t.Fatalf("a failed spawn spends the round's one retry, got %+v", task)
	}
	schedule(t, ctx, dag.OID)
	task = firstTask(t, ctx, dag.OID)
	if task.State != TaskState_ReviewFailed || !strings.Contains(task.ReviewNote, "reviewer could not start: no tab") {
		t.Fatalf("want review-failed with the spawn error, got %+v", task)
	}
}

func TestChildRunIDsIncludeReviewers(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{{ID: "t-0", RunID: "worker", ReviewRunID: "reviewer"}}}
	got := strings.Join(childRunIDs(g), ",")
	if got != "worker,reviewer" {
		t.Fatalf("cancel must reach a live reviewer, got %q", got)
	}
}

// a worker that reports no commit skips review and lands as done, so the lead hears it on its next wake: a task that did
// nothing and one that committed but never said so both read as done otherwise
func TestWorkerWithoutACommitTellsTheLeadQuietly(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	if err := wstore.UpdateRun(ctx, dag.ChannelId, worker.ID, func(r *waveobj.Run) error {
		r.EndCommit = ""
		r.Evidence = &waveobj.RunEvidence{Summary: "Nothing to change: fmtDate already exists."}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	calls := captureSpawns(t)
	f := newFakeLead(t)
	schedule(t, ctx, dag.OID)
	if got := firstTask(t, ctx, dag.OID); got.State != TaskState_Done || len(*calls) != 0 {
		t.Fatalf("no commit skips review, got state %s and %d spawns", got.State, len(*calls))
	}
	want := "Since your last wake:\nt-0 finished without reporting a commit: t-0 unstructured report: Nothing to change: fmtDate already exists."
	if !strings.Contains(strings.Join(f.sends, "\n"), want) {
		t.Fatalf("want the quiet line %q, got %q", want, f.sends)
	}
}

func TestNoCommitLineCarriesTheSectionsNotTheClippedSummary(t *testing.T) {
	long := strings.Repeat("x", handoffMaxSummaryLen+100)
	run := &waveobj.Run{Evidence: &waveobj.RunEvidence{Summary: structuredReport("Nothing to do.", "None", long, "None", "None")}}
	got := noCommitLine("t-0", run, true)
	if want := "t-0 Not verified: " + long; !strings.Contains(got, want) {
		t.Fatalf("want the whole section, got %q", got)
	}
	if strings.Contains(got, "Nothing to do.") || strings.Contains(got, "Differs") {
		t.Fatalf("only the lead's sections belong in the line, got %q", got)
	}
}

// structuredReport builds a report in the five-section format.
func structuredReport(done, differs, notVerified, forLater, foundNotFixed string) string {
	return "## Done\n" + done + "\n\n## Differs from plan\n" + differs + "\n\n## Not verified\n" + notVerified +
		"\n\n## For later tasks\n" + forLater + "\n\n## Found not fixed\n" + foundNotFixed
}

func TestReviewPassPostsTheWorkersSectionsWholeAndSkipsEmptyOnes(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	report := structuredReport("Added fmtDate.", "Used time.Format, not a table.", "The CDP shot.", "None", "None")
	if err := wstore.UpdateRun(ctx, dag.ChannelId, worker.ID, func(r *waveobj.Run) error {
		r.Evidence = &waveobj.RunEvidence{Summary: report}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "adds fmtDate", "", "no browser here", nil); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	joined := strings.Join(f.sends, "\n")
	want := "Unverified:\nt-0 Differs from plan: Used time.Format, not a table.\nt-0 Not verified: The CDP shot.\nt-0 reviewer: no browser here"
	if !strings.Contains(joined, want) {
		t.Fatalf("want the sections then the reviewer's line, got %q", f.sends)
	}
	if strings.Contains(joined, "Found not fixed") || strings.Contains(joined, "Added fmtDate") {
		t.Fatalf("a None section and Done are not posted, got %q", f.sends)
	}
}

func TestReviewPassPostsALegacyReportAsOneUnstructuredLine(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	if err := wstore.UpdateRun(ctx, dag.ChannelId, worker.ID, func(r *waveobj.Run) error {
		r.Evidence = &waveobj.RunEvidence{Summary: "Added fmtDate.\nDid not run the CDP shot."}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "adds fmtDate", "", "", nil); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
	if want := "Unverified:\nt-0 unstructured report: Added fmtDate. Did not run the CDP shot."; !strings.Contains(strings.Join(f.sends, "\n"), want) {
		t.Fatalf("want one unstructured line, got %q", f.sends)
	}
}

// addTask puts another task in a seeded dag.
func addTask(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup, task waveobj.TaskNode) {
	t.Helper()
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks = append(g.Tasks, task)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// passWithDownstream reviews t-0 and passes it with a note for the named tasks.
func passWithDownstream(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup, downstreamFor ...string) {
	t.Helper()
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "adds fmtDate", "fmtDate lives in util/date.go", "", downstreamFor); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
}

func taskNamed(t *testing.T, ctx context.Context, dagID, id string) waveobj.TaskNode {
	t.Helper()
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		t.Fatal(err)
	}
	return *taskByID(g, id)
}

// a note for a task that has not started goes into its prompt without the lead: in run ad78cbcb the lead knew what
// t-3 needed 14 minutes before t-3 started, and t-3 never heard it
func TestReviewDownstreamForAPendingTaskAmendsItWithoutWakingTheLead(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Pending, Deps: []string{"t-0"}})
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	passWithDownstream(t, ctx, dag, "t-1")
	if got := taskNamed(t, ctx, dag.OID, "t-1").LeadNotes; len(got) != 1 || got[0] != "t-0's reviewer: fmtDate lives in util/date.go" {
		t.Fatalf("want the note in t-1's prompt, got %q", got)
	}
	if strings.Contains(strings.Join(f.sends, "\n"), "note for later tasks") {
		t.Fatalf("a routed note must not wake the lead, got %q", f.sends)
	}
	if f.countKind(waveobj.RunEventKindTaskAmended) != 1 {
		t.Fatal("want one task-amended row")
	}
	PostWake(ctx, dag.ChannelId, dag.RunID, "wake: next")
	if want := "t-0's review note reached t-1 (added to its prompt): fmtDate lives in util/date.go"; !strings.Contains(strings.Join(f.sends, "\n"), want) {
		t.Fatalf("the lead's next wake must carry %q, got %q", want, f.sends)
	}
}

func TestReviewDownstreamForARunningTaskTypesItToTheWorker(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	other := jarvis.NewRun("other goal", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	other.DagORef = dag.OID
	if err := wstore.AppendRun(ctx, dag.ChannelId, other); err != nil {
		t.Fatal(err)
	}
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Running, RunID: other.ID})
	old := runBlockORefs
	runBlockORefs = func(_ context.Context, r *waveobj.Run) []string {
		if r.ID != other.ID {
			return nil
		}
		return []string{waveobj.MakeORef(waveobj.OType_Block, "11111111-1111-1111-1111-111111111111").String()}
	}
	restoreAfterStages(t, func() { runBlockORefs = old })
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	passWithDownstream(t, ctx, dag, "t-1")
	want := "t-0 passed review with a note for your task: fmtDate lives in util/date.go"
	if !strings.Contains(strings.Join(f.sends, "\n"), want) {
		t.Fatalf("want %q typed to t-1's worker, got %q", want, f.sends)
	}
	if got := taskNamed(t, ctx, dag.OID, "t-1").LeadTold; len(got) != 1 || got[0] != want {
		t.Fatalf("the typed note must not read as the human's, got %q", got)
	}
}

// a note the engine cannot deliver stays the lead's, as before
func TestReviewDownstreamForAFinishedTaskWakesTheLead(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Done})
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	passWithDownstream(t, ctx, dag, "t-1")
	want := "wake: task t-0 passed review with a note for later tasks (not delivered to t-1, which is done): fmtDate lives in util/date.go. wsh jarvis dag status"
	if !strings.Contains(strings.Join(f.sends, "\n"), want) {
		t.Fatalf("want %q, got %q", want, f.sends)
	}
}

// the worker's report is the reviewer's one account of the work, so it arrives whole, and the brief says when a
// pass carries a caveat
func TestReviewerBriefCarriesTheWholeReportAndTheUnverifiedFlag(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	report := strings.Repeat("did ", 374) + "end."
	if err := wstore.UpdateRun(ctx, dag.ChannelId, worker.ID, func(r *waveobj.Run) error {
		r.Evidence = &waveobj.RunEvidence{Summary: report}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	if len(*calls) != 1 {
		t.Fatalf("want the reviewer spawned, got %d spawns", len(*calls))
	}
	p := (*calls)[0].prompt
	if utf8.RuneCountInString(report) != 1500 || !strings.Contains(p, "The worker reported: "+report) {
		t.Fatalf("the brief must carry the whole %d-rune report, got %q", utf8.RuneCountInString(report), p)
	}
	if !strings.Contains(p, "`--unverified \"<what was not verified, and why>\"` only for a check the task asked for (a test, a screenshot, a live run) that Not verified omits") {
		t.Fatalf("the brief must say when to use --unverified, got %q", p)
	}
}

// the worker's sections reach the lead and later tasks without the reviewer, so it checks them instead of relaying
func TestReviewerBriefChecksTheReportAndDoesNotRelayIt(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Pending, Deps: []string{"t-0"}})
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	if len(*calls) != 1 {
		t.Fatalf("want the reviewer spawned, got %d spawns", len(*calls))
	}
	p := (*calls)[0].prompt
	for _, want := range []string{
		"Done matches the diff",
		"Differs from plan names every departure the diff shows",
		"Not verified names every check the task asked for that neither the diff nor Done shows done",
		"already reach the lead and later tasks whole",
		"`--downstream \"<what a later task must know>\"` only for what For later tasks omits or gets wrong",
		"`--for <task ids>` alone forwards the worker's For later tasks to the tasks you name",
		"Tasks not finished yet, which --for can name: t-1 (b).",
	} {
		if !strings.Contains(p, want) {
			t.Fatalf("reviewer brief missing %q:\n%s", want, p)
		}
	}
	if strings.Contains(p, "waits for the lead") {
		t.Fatalf("the brief must not ask the reviewer to relay through the lead:\n%s", p)
	}
}

func TestDescendantsWalksTheReverseClosureInDagOrder(t *testing.T) {
	diamond := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{
		{ID: "t-3", Deps: []string{"t-1", "t-2"}},
		{ID: "t-0"},
		{ID: "t-1", Deps: []string{"t-0"}},
		{ID: "t-2", Deps: []string{"t-0"}},
		{ID: "t-4"},
	}}
	if got := strings.Join(descendants(diamond, "t-0"), ","); got != "t-3,t-1,t-2" {
		t.Fatalf("diamond from t-0: got %q", got)
	}
	if got := strings.Join(descendants(diamond, "t-1"), ","); got != "t-3" {
		t.Fatalf("diamond from t-1: got %q", got)
	}
	chain := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{
		{ID: "t-0"},
		{ID: "t-1", Deps: []string{"t-0"}},
		{ID: "t-2", Deps: []string{"t-1"}},
	}}
	if got := strings.Join(descendants(chain, "t-0"), ","); got != "t-1,t-2" {
		t.Fatalf("chain from t-0: got %q", got)
	}
	if got := descendants(chain, "t-2"); len(got) != 0 {
		t.Fatalf("the last task has no descendants, got %q", got)
	}
}

func setWorkerReport(t *testing.T, ctx context.Context, channelId, runID, report string) {
	t.Helper()
	if err := wstore.UpdateRun(ctx, channelId, runID, func(r *waveobj.Run) error {
		r.Evidence = &waveobj.RunEvidence{Summary: report}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// addRunningTask puts a task with a live worker in a seeded dag and returns its worker's block.
func addRunningTask(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup, task waveobj.TaskNode) string {
	t.Helper()
	other := jarvis.NewRun("other goal", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	other.DagORef = dag.OID
	if err := wstore.AppendRun(ctx, dag.ChannelId, other); err != nil {
		t.Fatal(err)
	}
	task.State, task.RunID = TaskState_Running, other.ID
	addTask(t, ctx, dag, task)
	block := waveobj.MakeORef(waveobj.OType_Block, "11111111-1111-1111-1111-111111111111").String()
	old := runBlockORefs
	runBlockORefs = func(_ context.Context, r *waveobj.Run) []string {
		if r.ID != other.ID {
			return nil
		}
		return []string{block}
	}
	restoreAfterStages(t, func() { runBlockORefs = old })
	return block
}

// passPlain reviews t-0 and passes it with no note for later tasks, forwarding to the named tasks.
func passPlain(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup, downstreamFor ...string) {
	t.Helper()
	schedule(t, ctx, dag.OID)
	reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
	if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "adds fmtDate", "", "", downstreamFor); err != nil {
		t.Fatal(err)
	}
	schedule(t, ctx, dag.OID)
}

const forLaterText = "fmtDate lives in util/date.go"

func passedRow(t *testing.T, f *fakeLead) map[string]any {
	t.Helper()
	for _, r := range f.rows {
		if r["eventkind"] == waveobj.RunEventKindTaskReviewPassed {
			return r
		}
	}
	t.Fatalf("no task-review-passed row in %v", f.rows)
	return nil
}

// a task not started reads its ancestors' For later tasks at dispatch, so nothing is stored on it
func TestReviewPassLeavesForLaterTasksToPendingDescendantsDispatch(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Pending, Deps: []string{"t-0"}})
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-2", Label: "c", State: TaskState_Pending, Deps: []string{"t-1"}})
	setWorkerReport(t, ctx, dag.ChannelId, worker.ID, structuredReport("Added fmtDate.", "None", "None", forLaterText, "None"))
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	passPlain(t, ctx, dag)
	for _, id := range []string{"t-1", "t-2"} {
		if got := taskNamed(t, ctx, dag.OID, id).LeadNotes; len(got) != 0 {
			t.Fatalf("%s must read the section at dispatch, not hold a copy, got %q", id, got)
		}
	}
	if _, ok := passedRow(t, f)["forlead"]; ok {
		t.Fatal("a section that reached later tasks is not the lead's")
	}
	PostWake(ctx, dag.ChannelId, dag.RunID, "wake: next")
	joined := strings.Join(f.sends, "\n")
	if want := "t-0's For later tasks reached t-1 (at dispatch), t-2 (at dispatch)"; !strings.Contains(joined, want) {
		t.Fatalf("the lead's next wake must carry %q, got %q", want, f.sends)
	}
	if strings.Contains(joined, forLaterText) {
		t.Fatalf("the section itself must not reach the lead, got %q", f.sends)
	}
}

func TestReviewPassTypesForLaterTasksToARunningDescendant(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	addRunningTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", Deps: []string{"t-0"}})
	setWorkerReport(t, ctx, dag.ChannelId, worker.ID, structuredReport("Added fmtDate.", "None", "None", forLaterText, "None"))
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	passPlain(t, ctx, dag)
	want := "t-0 passed review; its worker's For later tasks: " + forLaterText
	if !strings.Contains(strings.Join(f.sends, "\n"), want) {
		t.Fatalf("want %q typed to t-1's worker, got %q", want, f.sends)
	}
	if got := taskNamed(t, ctx, dag.OID, "t-1").LeadTold; len(got) != 1 || got[0] != want {
		t.Fatalf("the typed section must be recorded as the engine's, got %q", got)
	}
}

func TestReviewPassForLaterTasksSkipsADescendantWaitingOnAQuestion(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	block := addRunningTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", Deps: []string{"t-0"}})
	setWorkerReport(t, ctx, dag.ChannelId, worker.ID, structuredReport("Added fmtDate.", "None", "None", forLaterText, "None"))
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	agentask.GlobalRegistry.Set(block, agentask.PendingAsk{AskId: "a1", BlockId: "11111111-1111-1111-1111-111111111111"})
	passPlain(t, ctx, dag)
	if got := taskNamed(t, ctx, dag.OID, "t-1").LeadTold; len(got) != 0 {
		t.Fatalf("nothing may be typed into a worker's open question, got %q", got)
	}
	joined := strings.Join(f.sends, "\n")
	want := "wake: task t-0 passed review; its worker's For later tasks (not delivered to t-1, which is waiting on a question): " + forLaterText + ". wsh jarvis dag status"
	if !strings.Contains(joined, want) {
		t.Fatalf("want %q, got %q", want, f.sends)
	}
}

// with no task after it the section is the lead's, beside the other sections it acts on
func TestReviewPassWithNoDescendantPostsForLaterTasksToTheLead(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Done})
	setWorkerReport(t, ctx, dag.ChannelId, worker.ID, structuredReport("Added fmtDate.", "Used time.Format.", "None", forLaterText, "None"))
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	passPlain(t, ctx, dag)
	if got := passedRow(t, f)["forlead"]; got != true {
		t.Fatalf("the pass row must say the section went to the lead, got %v", got)
	}
	want := "Unverified:\nt-0 Differs from plan: Used time.Format.\nt-0 For later tasks: " + forLaterText
	if !strings.Contains(strings.Join(f.sends, "\n"), want) {
		t.Fatalf("want %q, got %q", want, f.sends)
	}
}

// --for alone names tasks off the plan's edges; they get the worker's section through the same delivery
func TestReviewForAloneForwardsForLaterTasksToANonDescendant(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Pending})
	setWorkerReport(t, ctx, dag.ChannelId, worker.ID, structuredReport("Added fmtDate.", "None", "None", forLaterText, "None"))
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	passPlain(t, ctx, dag, "t-1")
	if got := taskNamed(t, ctx, dag.OID, "t-1").LeadNotes; len(got) != 1 || got[0] != "t-0's worker, For later tasks: "+forLaterText {
		t.Fatalf("want the section in t-1's prompt, got %q", got)
	}
	if _, ok := passedRow(t, f)["forlead"]; ok {
		t.Fatal("a section forwarded with --for is not the lead's")
	}
}

const forLaterNoneRefusal = "the worker's For later tasks is None; give --downstream with what they must know"
const forLaterUnstructuredRefusal = "the worker's report is unstructured, so it has no For later tasks to forward; give --downstream with what they must know"

// a no-commit worker's For later tasks is read at dispatch by a task after it; with none left it is the lead's
func TestNoCommitLineHandsForLaterToTheLeadOnlyWithNoTaskAfterIt(t *testing.T) {
	run := &waveobj.Run{Evidence: &waveobj.RunEvidence{Summary: structuredReport("Nothing to do.", "None", "None", "fmtDate lives in util/date.go", "None")}}
	want := "t-0 finished without reporting a commit: t-0 For later tasks: fmtDate lives in util/date.go"
	if got := noCommitLine("t-0", run, true); got != want {
		t.Fatalf("want %q, got %q", want, got)
	}
	if got := noCommitLine("t-0", run, false); strings.Contains(got, "For later tasks") {
		t.Fatalf("a later task reads the section at dispatch, got %q", got)
	}
}

func TestReviewForAloneIsRefusedWithNothingToForward(t *testing.T) {
	for _, c := range []struct{ name, report, want string }{
		{"a None section", structuredReport("Added fmtDate.", "None", "None", "None", "None"), forLaterNoneRefusal},
		{"a legacy report", "Added fmtDate; util/date.go has it.", forLaterUnstructuredRefusal},
	} {
		t.Run(c.name, func(t *testing.T) {
			ctx, dag, worker := seedReviewDag(t)
			addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Pending})
			setWorkerReport(t, ctx, dag.ChannelId, worker.ID, c.report)
			stubReviewTree(t, worker.EndCommit)
			captureSpawns(t)
			schedule(t, ctx, dag.OID)
			reviewer := firstTask(t, ctx, dag.OID).ReviewRunID
			err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "adds fmtDate", "", "", []string{"t-1"})
			if err == nil || err.Error() != c.want {
				t.Fatalf("want %q, got %v", c.want, err)
			}
			if err := RecordReviewVerdict(ctx, dag.OID, reviewer, ReviewVerdict_Pass, "adds fmtDate", "fmtDate lives in util/date.go", "", []string{"t-1"}); err != nil {
				t.Fatalf("--for with a note stands, got %v", err)
			}
		})
	}
}

// a reviewer's note follows the plan's edges like the worker's section; it no longer waits for the lead
func TestReviewDownstreamWithoutForReachesDescendants(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Pending, Deps: []string{"t-0"}})
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-2", Label: "c", State: TaskState_Pending})
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	passWithDownstream(t, ctx, dag)
	if got := taskNamed(t, ctx, dag.OID, "t-1").LeadNotes; len(got) != 1 || got[0] != "t-0's reviewer: fmtDate lives in util/date.go" {
		t.Fatalf("want the note in t-1's prompt, got %q", got)
	}
	if got := taskNamed(t, ctx, dag.OID, "t-2").LeadNotes; len(got) != 0 {
		t.Fatalf("a task off the plan's edges gets nothing, got %q", got)
	}
	if strings.Contains(strings.Join(f.sends, "\n"), "note for later tasks") {
		t.Fatalf("a note that reached a descendant must not wake the lead, got %q", f.sends)
	}
}

// the reviewer can only name a task it knows exists, so its brief lists the ones a note can still reach
func TestReviewerIsToldWhichTasksANoteCanReach(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Pending, Deps: []string{"t-0"}})
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-2", Label: "c", State: TaskState_Done})
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	if len(*calls) != 1 {
		t.Fatalf("want the reviewer spawned, got %d spawns", len(*calls))
	}
	p := (*calls)[0].prompt
	if !strings.Contains(p, "Tasks not finished yet, which --for can name: t-1 (b).") {
		t.Fatalf("the brief must list t-1 alone, got %q", p)
	}
}

// a worker waiting on its question has a picker open, which a typed note and its enter would answer
func TestReviewDownstreamSkipsAWorkerWaitingOnAQuestion(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	other := jarvis.NewRun("other goal", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	other.DagORef = dag.OID
	if err := wstore.AppendRun(ctx, dag.ChannelId, other); err != nil {
		t.Fatal(err)
	}
	addTask(t, ctx, dag, waveobj.TaskNode{ID: "t-1", Label: "b", State: TaskState_Running, RunID: other.ID})
	block := waveobj.MakeORef(waveobj.OType_Block, "11111111-1111-1111-1111-111111111111").String()
	old := runBlockORefs
	runBlockORefs = func(_ context.Context, r *waveobj.Run) []string {
		if r.ID != other.ID {
			return nil
		}
		return []string{block}
	}
	restoreAfterStages(t, func() { runBlockORefs = old })
	stubReviewTree(t, worker.EndCommit)
	captureSpawns(t)
	f := newFakeLead(t)
	agentask.GlobalRegistry.Set(block, agentask.PendingAsk{AskId: "a1", BlockId: "11111111-1111-1111-1111-111111111111"})
	passWithDownstream(t, ctx, dag, "t-1")
	joined := strings.Join(f.sends, "\n")
	if strings.Contains(joined, "a note for your task") {
		t.Fatalf("nothing may be typed into a worker's open question, got %q", f.sends)
	}
	if !strings.Contains(joined, "(not delivered to t-1, which is waiting on a question)") {
		t.Fatalf("the lead must be woken to route it, got %q", f.sends)
	}
}

// The worker was told more than the plan says: a note an earlier reviewer sent downstream, the lead's guidance,
// and text typed into its terminal. Its reviewer judges against all of it, or a requested change reads as scope
// creep. What was typed to another task's worker stays out.
func TestReviewerBriefCarriesWhatTheWorkerWasTold(t *testing.T) {
	ctx, dag, worker := seedReviewDag(t)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].LeadNotes = []string{"t-1's reviewer: install the latch only once the layout has loaded"}
		g.Tasks[0].LeadGuidance = "keep the skeleton card-shaped"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, ev := range []map[string]any{
		{"taskid": "t-0", "text": "also gate on the workspace atom"},
		{"taskid": "t-9", "text": "a note for someone else"},
	} {
		if _, err := wstore.AppendRunEvent(ctx, dag.ChannelId, dag.RunID, waveobj.RunEventKindTaskLeadTold, nil, ev); err != nil {
			t.Fatal(err)
		}
	}
	stubReviewTree(t, worker.EndCommit)
	calls := captureSpawns(t)
	schedule(t, ctx, dag.OID)
	if len(*calls) != 1 {
		t.Fatalf("want one reviewer, got %d", len(*calls))
	}
	p := (*calls)[0].prompt
	for _, want := range []string{
		"install the latch only once the layout has loaded",
		"keep the skeleton card-shaped",
		"also gate on the workspace atom",
	} {
		if !strings.Contains(p, want) {
			t.Fatalf("reviewer brief missing %q:\n%s", want, p)
		}
	}
	if strings.Contains(p, "a note for someone else") {
		t.Fatalf("reviewer brief carries another task's message:\n%s", p)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runstart"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// the suggestion RPC's gatherer and the queue's re-check (spec 2026-11-16-run-start-choice-design.md, Task 4 of its
// plan): which runs are live, the files each edits, and what Jarvis suggests for a run about to start

type gitCall struct {
	dir  string
	args string
}

// startWorld scripts what liveRunFiles reads outside the files themselves: the runs (the queue world's, so the cap
// counts them too), the dags, git and the quota. The spec and plan files are real ones in a temp dir.
type startWorld struct {
	q    *queueWorld
	proj string // the project's folder: a real temp dir, so paths under it are absolute on every OS

	mu    sync.Mutex
	dags  map[string]*waveobj.TaskGroup
	git   func(dir, args string) ([]string, error)
	calls []gitCall
	quota *wshrpc.CommandGetClaudeQuotaRtnData
	// the window tokens the seam answers, and the cutoffs it was asked for
	windowTokens int
	cutoffs      []time.Time
}

func useStartWorld(t *testing.T) *startWorld {
	t.Helper()
	q := useQueueWorld(t)
	swap(t, &runQueueRecheck, recheckQueuedEntry)
	w := &startWorld{q: q, proj: filepath.ToSlash(t.TempDir()), dags: map[string]*waveobj.TaskGroup{}, quota: &wshrpc.CommandGetClaudeQuotaRtnData{}}
	allRuns := func() []*waveobj.Run {
		q.mu.Lock()
		defer q.mu.Unlock()
		out := make([]*waveobj.Run, 0, len(q.runs))
		for _, r := range q.runs {
			out = append(out, r)
		}
		return out
	}
	swap(t, &runStartLoadRuns, func(context.Context) ([]*waveobj.Run, error) { return allRuns(), nil })
	swap(t, &runStartProjectRuns, func(context.Context, string) ([]*waveobj.Run, error) { return allRuns(), nil })
	swap(t, &runStartLoadRun, func(_ context.Context, id string) (*waveobj.Run, error) {
		q.mu.Lock()
		defer q.mu.Unlock()
		if r := q.runs[id]; r != nil {
			return r, nil
		}
		return nil, fmt.Errorf("run %s not found", id)
	})
	swap(t, &runStartLoadDag, func(_ context.Context, id string) (*waveobj.TaskGroup, error) {
		w.mu.Lock()
		defer w.mu.Unlock()
		if d := w.dags[id]; d != nil {
			return d, nil
		}
		return nil, fmt.Errorf("dag %s not found", id)
	})
	swap(t, &runStartGit, func(_ context.Context, dir string, args ...string) ([]string, error) {
		joined := strings.Join(args, " ")
		w.mu.Lock()
		w.calls = append(w.calls, gitCall{dir, joined})
		script := w.git
		w.mu.Unlock()
		if script == nil {
			return nil, nil
		}
		return script(dir, joined)
	})
	swap(t, &runStartQuota, func(context.Context) *wshrpc.CommandGetClaudeQuotaRtnData { return w.quota })
	swap(t, &runStartWindowTokens, func(cutoffs []time.Time) ([]int, error) {
		w.mu.Lock()
		defer w.mu.Unlock()
		w.cutoffs = append(w.cutoffs, cutoffs...)
		return []int{w.windowTokens}, nil
	})
	return w
}

// addRun stores a live top-level quick run of the project (n >= 100 keeps its id clear of the ones the fake create
// makes). Its CreatedTs follows n, so a later n is a later run.
func (w *startWorld) addRun(n int, goal string, edit func(*waveobj.Run)) *waveobj.Run {
	r := &waveobj.Run{ID: w.q.runId(n), Goal: goal, Status: jarvis.RunStatus_Executing, Mode: jarvis.RunMode_Quick, ProjectPath: w.proj, CreatedTs: int64(1000 + n)}
	if edit != nil {
		edit(r)
	}
	w.q.setRun(r)
	return r
}

func (w *startWorld) gitCalls() []gitCall {
	w.mu.Lock()
	defer w.mu.Unlock()
	return slices.Clone(w.calls)
}

// writeFile makes a real file under the project and returns its path.
func (w *startWorld) writeFile(t *testing.T, rel, text string) string {
	t.Helper()
	p := w.proj + "/" + rel
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func liveById(t *testing.T, live []runstart.LiveRun, id string) runstart.LiveRun {
	t.Helper()
	for _, l := range live {
		if l.Id == id {
			return l
		}
	}
	t.Fatalf("no live run %s in %+v", id, live)
	return runstart.LiveRun{}
}

func liveIds(live []runstart.LiveRun) []string {
	ids := make([]string, 0, len(live))
	for _, l := range live {
		ids = append(ids, l.Id)
	}
	return ids
}

func TestLiveRunFilesKeepsTheLiveTopLevelRunsOfTheProject(t *testing.T) {
	w := useStartWorld(t)
	w.addRun(101, "Fix the merge in land.go", nil)
	w.addRun(102, "done and landed in the checkout", func(r *waveobj.Run) { r.Status = jarvis.RunStatus_Done })
	w.addRun(103, "cancelled", func(r *waveobj.Run) { r.Status = jarvis.RunStatus_Cancelled })
	w.addRun(104, "a task worker", func(r *waveobj.Run) { r.TaskId = "t-1" })
	w.addRun(105, "a run of another project", func(r *waveobj.Run) { r.ProjectPath = w.proj + "-other" })
	w.addRun(106, "done, land pending", func(r *waveobj.Run) {
		r.Status = jarvis.RunStatus_Done
		r.LandPath = w.proj + "/wt"
		r.Land = &waveobj.RunLand{State: orchestrate.LandState_Pending}
	})
	w.addRun(107, "done, land held", func(r *waveobj.Run) {
		r.Status = jarvis.RunStatus_Done
		r.Land = &waveobj.RunLand{State: orchestrate.LandState_Held, Reason: "conflict in land.go"}
	})
	w.addRun(108, "done, held only by a dirty checkout", func(r *waveobj.Run) {
		r.Status = jarvis.RunStatus_Done
		r.Land = &waveobj.RunLand{State: orchestrate.LandState_Held, Dirty: true, Reason: "uncommitted changes"}
	})
	w.addRun(109, "done and landed", func(r *waveobj.Run) {
		r.Status = jarvis.RunStatus_Done
		r.Land = &waveobj.RunLand{State: orchestrate.LandState_Landed}
	})
	w.addRun(110, "done, its branch not landed yet", func(r *waveobj.Run) {
		r.Status = jarvis.RunStatus_Done
		r.LandPath = w.proj + "/wt"
	})
	w.addRun(111, "a lead's child run", func(r *waveobj.Run) { r.ParentLeadORef = "tab:lead" })

	live, err := liveRunFiles(context.Background(), w.proj)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{w.q.runId(101), w.q.runId(106), w.q.runId(107), w.q.runId(108), w.q.runId(110)}
	if got := liveIds(live); !slices.Equal(got, want) {
		t.Fatalf("live = %v, want the unfinished runs and the done ones still to land, oldest first: %v", got, want)
	}
	if h := liveById(t, live, w.q.runId(107)); !h.Held || h.HeldReason != "conflict in land.go" {
		t.Errorf("the held run = %+v, want Held with its reason", h)
	}
	if d := liveById(t, live, w.q.runId(108)); d.Held {
		t.Errorf("a land held only by a dirty checkout lands by itself: %+v", d)
	}
	if r := liveById(t, live, w.q.runId(101)); r.Held || r.Title != "Fix the merge in land.go" || r.CreatedTs != 1101 {
		t.Errorf("the executing run = %+v, want its goal's first line as the title, not held, created at its CreatedTs", r)
	}
}

func TestLiveRunFilesTitlesARunByTheFirstLineOfItsGoal(t *testing.T) {
	w := useStartWorld(t)
	w.addRun(101, "\n  Build the coupons spec  \nthe rest of the goal", nil)
	w.addRun(102, strings.Repeat("long ", 40), nil)
	w.addRun(103, "", nil)

	live, err := liveRunFiles(context.Background(), w.proj)
	if err != nil {
		t.Fatal(err)
	}
	if got := liveById(t, live, w.q.runId(101)).Title; got != "Build the coupons spec" {
		t.Errorf("title = %q, want the first non-blank line, trimmed", got)
	}
	if got := liveById(t, live, w.q.runId(102)).Title; len([]rune(got)) > 81 || !strings.HasSuffix(got, "…") {
		t.Errorf("title = %q, want a long first line cut short", got)
	}
	if got := liveById(t, live, w.q.runId(103)).Title; got != "" {
		t.Errorf("title = %q, want none for a run with no goal (the reason line falls back to its id)", got)
	}
}

func TestLiveRunFilesReadsTheGoalTheSpecAndTheDagTaskFiles(t *testing.T) {
	w := useStartWorld(t)
	spec := w.writeFile(t, "docs/a-design.md", "Touches pkg/orchestrate/land.go and the CHANGELOG.md line.")
	w.dags["dag-1"] = &waveobj.TaskGroup{ID: "dag-1", Tasks: []waveobj.TaskNode{
		{ID: "t-1", Description: "Do it.\n**Files:** `pkg/a/x.go`, `CHANGELOG.md`"},
		{ID: "t-2", Description: "A task with no files line."},
	}}
	w.addRun(101, "Build the coupons in frontend/coupons.tsx", func(r *waveobj.Run) { r.SpecPath = spec; r.DagORef = "dag-1" })

	live, err := liveRunFiles(context.Background(), w.proj)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"frontend/coupons.tsx", "pkg/orchestrate/land.go", "pkg/a/x.go"}
	if got := live[0].Files; !slices.Equal(got, want) {
		t.Errorf("files = %v, want the goal's, the spec's and the tasks' (hub files out): %v", got, want)
	}
}

func TestLiveRunFilesFallsBackToTheDagSpecAndResolvesItWhereTheRunLands(t *testing.T) {
	w := useStartWorld(t)
	wt := w.proj + "/wt-101"
	for _, p := range []string{wt + "/docs/spec.md", w.proj + "/docs/spec.md"} {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// a branch-landed dag keeps its spec repo-relative: the copy in the run's landing tree is the one to read
	if err := os.WriteFile(wt+"/docs/spec.md", []byte("It edits pkg/jarvis/plan.go."), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(w.proj+"/docs/spec.md", []byte("It edits pkg/wrong/checkout.go."), 0o644); err != nil {
		t.Fatal(err)
	}
	w.dags["dag-1"] = &waveobj.TaskGroup{ID: "dag-1", SpecPath: "docs/spec.md", PlanPath: "docs/plan.md"}
	w.addRun(101, "Branch-landed run", func(r *waveobj.Run) { r.DagORef = "dag-1"; r.LandPath = wt })
	// with no landing tree the project's copy is the one
	w.dags["dag-2"] = &waveobj.TaskGroup{ID: "dag-2", SpecPath: "docs/spec.md"}
	w.addRun(102, "Checkout-landed run", func(r *waveobj.Run) { r.DagORef = "dag-2" })
	// the run's own SpecPath wins over its dag's
	own := w.writeFile(t, "docs/own.md", "It edits pkg/own/thing.go.")
	w.dags["dag-3"] = &waveobj.TaskGroup{ID: "dag-3", SpecPath: "docs/spec.md"}
	w.addRun(103, "Run with its own spec", func(r *waveobj.Run) { r.DagORef = "dag-3"; r.SpecPath = own })

	live, err := liveRunFiles(context.Background(), w.proj)
	if err != nil {
		t.Fatal(err)
	}
	if got := liveById(t, live, w.q.runId(101)).Files; !slices.Equal(got, []string{"pkg/jarvis/plan.go"}) {
		t.Errorf("branch-landed run's files = %v, want its spec read in the landing tree", got)
	}
	if got := liveById(t, live, w.q.runId(102)).Files; !slices.Equal(got, []string{"pkg/wrong/checkout.go"}) {
		t.Errorf("checkout-landed run's files = %v, want its spec read in the project", got)
	}
	if got := liveById(t, live, w.q.runId(103)).Files; !slices.Equal(got, []string{"pkg/own/thing.go"}) {
		t.Errorf("own-spec run's files = %v, want Run.SpecPath to win over the dag's", got)
	}
}

func TestLiveRunFilesCountsAnOrchestratorRunsBranchAndEachLaneBranchDoneOrNot(t *testing.T) {
	w := useStartWorld(t)
	w.git = func(dir, args string) ([]string, error) {
		switch args {
		case "diff --name-only base1...wave/" + w.q.runId(101):
			return []string{"pkg/a.go", "CHANGELOG.md"}, nil
		case "diff --name-only base1...wave/lane-1":
			return []string{"pkg/b.go"}, nil
		case "diff --name-only base1...wave/lane-2":
			return []string{"pkg/c.go", "pkg/a.go"}, nil
		}
		return nil, fmt.Errorf("unscripted git %s", args)
	}
	w.dags["dag-1"] = &waveobj.TaskGroup{ID: "dag-1", Tasks: []waveobj.TaskNode{
		{ID: "t-1", State: "done", RunID: w.q.runId(201)},
		{ID: "t-2", State: "running", RunID: w.q.runId(202)},
		{ID: "t-3", State: "done", RunID: w.q.runId(203)}, // a worker that never committed: no branch
		{ID: "t-4", State: "pending"},                     // not spawned yet
	}}
	w.addRun(201, "worker one", func(r *waveobj.Run) { r.TaskId = "t-1"; r.Branch = "wave/lane-1"; r.Status = jarvis.RunStatus_Done })
	w.addRun(202, "worker two", func(r *waveobj.Run) { r.TaskId = "t-2"; r.Branch = "wave/lane-2" })
	w.addRun(203, "worker three", func(r *waveobj.Run) { r.TaskId = "t-3" })
	w.addRun(101, "Build it", func(r *waveobj.Run) {
		r.Mode = jarvis.RunMode_Orchestrator
		r.BaseCommit = "base1"
		r.LandPath = w.proj + "/wt"
		r.DagORef = "dag-1"
	})

	live, err := liveRunFiles(context.Background(), w.proj)
	if err != nil {
		t.Fatal(err)
	}
	if got := liveIds(live); !slices.Equal(got, []string{w.q.runId(101)}) {
		t.Fatalf("live = %v, want only the top-level run", got)
	}
	if got, want := live[0].Files, []string{"pkg/a.go", "pkg/b.go", "pkg/c.go"}; !slices.Equal(got, want) {
		t.Errorf("files = %v, want the run's branch and both lanes', each file once, hub files out: %v", got, want)
	}
	calls := w.gitCalls()
	if len(calls) != 3 {
		t.Fatalf("git calls = %+v, want one for the run's branch and one per lane that has a branch", calls)
	}
	for _, c := range calls {
		if c.dir != w.proj {
			t.Errorf("git ran in %q, want the project %q", c.dir, w.proj)
		}
	}
}

func TestLiveRunFilesDiffsAQuickOrCheckoutRunAgainstItsBase(t *testing.T) {
	w := useStartWorld(t)
	w.git = func(dir, args string) ([]string, error) { return []string{"in-" + filepath.Base(dir) + ".go"}, nil }
	w.addRun(101, "quick in the checkout", func(r *waveobj.Run) { r.BaseCommit = "b1" })
	w.addRun(102, "quick in a worktree", func(r *waveobj.Run) { r.BaseCommit = "b2"; r.LandPath = w.proj + "/wt-102" })
	w.addRun(103, "orchestrator landing in the checkout", func(r *waveobj.Run) { r.BaseCommit = "b3"; r.Mode = jarvis.RunMode_Orchestrator })
	w.addRun(104, "no repo", nil)

	live, err := liveRunFiles(context.Background(), w.proj)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]gitCall{}
	for _, c := range w.gitCalls() {
		got[c.args] = c
	}
	want := map[string]string{"diff --name-only b1": w.proj, "diff --name-only b2": w.proj + "/wt-102", "diff --name-only b3": w.proj}
	if len(got) != len(want) {
		t.Fatalf("git calls = %+v, want one per run with a base commit (a run with none has no repo to read)", w.gitCalls())
	}
	for args, dir := range want {
		if got[args].dir != dir {
			t.Errorf("%q ran in %q, want %q", args, got[args].dir, dir)
		}
	}
	if f := liveById(t, live, w.q.runId(102)).Files; !slices.Equal(f, []string{"in-wt-102.go"}) {
		t.Errorf("the worktree run's files = %v, want its diff", f)
	}
	if f := liveById(t, live, w.q.runId(104)).Files; len(f) != 0 {
		t.Errorf("a run with no base commit has files %v", f)
	}
}

func TestLiveRunFilesAFailedGitCallAddsNoFilesAndFailsNothing(t *testing.T) {
	w := useStartWorld(t)
	w.git = func(dir, args string) ([]string, error) {
		if strings.Contains(args, "bad") {
			return nil, errors.New("fatal: bad revision")
		}
		return []string{"pkg/ok.go"}, nil
	}
	w.addRun(101, "edits land.go", func(r *waveobj.Run) { r.BaseCommit = "bad" })
	w.addRun(102, "edits nothing named", func(r *waveobj.Run) { r.BaseCommit = "good" })

	live, err := liveRunFiles(context.Background(), w.proj)
	if err != nil {
		t.Fatalf("a failed git call failed the gatherer: %v", err)
	}
	if got := liveById(t, live, w.q.runId(101)).Files; !slices.Equal(got, []string{"land.go"}) {
		t.Errorf("failed run's files = %v, want only what its goal names", got)
	}
	if got := liveById(t, live, w.q.runId(102)).Files; !slices.Equal(got, []string{"pkg/ok.go"}) {
		t.Errorf("the other run's files = %v, want its diff", got)
	}
}

func TestLiveRunFilesAGitCallThatTimesOutStillAnswers(t *testing.T) {
	w := useStartWorld(t)
	swap(t, &runStartGitTimeout, 40*time.Millisecond)
	swap(t, &runStartGit, func(ctx context.Context, dir string, args ...string) ([]string, error) {
		<-ctx.Done() // a git that never returns: only its timeout ends it
		return nil, ctx.Err()
	})
	w.addRun(101, "edits land.go", func(r *waveobj.Run) { r.BaseCommit = "b1" })

	start := time.Now()
	live, err := liveRunFiles(context.Background(), w.proj)
	if err != nil {
		t.Fatalf("a timed-out git call failed the gatherer: %v", err)
	}
	if took := time.Since(start); took > 3*time.Second {
		t.Errorf("answered after %v, want it bounded by the git timeout", took)
	}
	if got := live[0].Files; !slices.Equal(got, []string{"land.go"}) {
		t.Errorf("files = %v, want the goal's mention alone", got)
	}
}

func TestLiveRunFilesRunsTheGitCallsAtOnce(t *testing.T) {
	w := useStartWorld(t)
	var mu sync.Mutex
	inflight, peak := 0, 0
	swap(t, &runStartGit, func(ctx context.Context, dir string, args ...string) ([]string, error) {
		mu.Lock()
		inflight++
		peak = max(peak, inflight)
		mu.Unlock()
		time.Sleep(60 * time.Millisecond)
		mu.Lock()
		inflight--
		mu.Unlock()
		return nil, nil
	})
	for n := 101; n <= 104; n++ {
		w.addRun(n, fmt.Sprintf("run %d", n), func(r *waveobj.Run) { r.BaseCommit = "b" })
	}
	if _, err := liveRunFiles(context.Background(), w.proj); err != nil {
		t.Fatal(err)
	}
	if peak < 2 {
		t.Errorf("at most %d git call ran at a time, want them concurrent", peak)
	}
}

func TestLiveRunFilesAnUnreadableDagOrSpecIsLoggedNotFatal(t *testing.T) {
	w := useStartWorld(t)
	w.addRun(101, "edits land.go", func(r *waveobj.Run) { r.DagORef = "dag-gone"; r.SpecPath = w.proj + "/no-such-spec.md" })

	live, err := liveRunFiles(context.Background(), w.proj)
	if err != nil {
		t.Fatalf("an unreadable dag or spec failed the gatherer: %v", err)
	}
	if got := live[0].Files; !slices.Equal(got, []string{"land.go"}) {
		t.Errorf("files = %v, want the goal's alone", got)
	}
}

func TestLiveRunFilesComparesProjectPathsAsPaths(t *testing.T) {
	w := useStartWorld(t)
	w.addRun(101, "trailing slash", func(r *waveobj.Run) { r.ProjectPath = w.proj + "/" })
	w.addRun(102, "same folder", nil)
	w.addRun(103, "dot segment", func(r *waveobj.Run) { r.ProjectPath = w.proj + "/sub/.." })
	live, err := liveRunFiles(context.Background(), w.proj)
	if err != nil {
		t.Fatal(err)
	}
	if got := liveIds(live); len(got) != 3 {
		t.Errorf("live = %v, want a trailing slash or a dot segment to name the same project", got)
	}
	if runtime.GOOS == "windows" {
		upper := strings.ToUpper(filepath.FromSlash(w.proj))
		live, err = liveRunFiles(context.Background(), upper)
		if err != nil {
			t.Fatal(err)
		}
		if len(live) != 3 {
			t.Errorf("live = %v, want a Windows path to match whatever its case and slashes", liveIds(live))
		}
	}
}

func TestLiveRunFilesFailsWhenTheRunsCannotBeRead(t *testing.T) {
	w := useStartWorld(t)
	w.addRun(101, "x", nil)
	swap(t, &runStartLoadRuns, func(context.Context) ([]*waveobj.Run, error) { return nil, errors.New("db is locked") })
	if _, err := liveRunFiles(context.Background(), w.proj); err == nil || !strings.Contains(err.Error(), "db is locked") {
		t.Fatalf("err = %v, want the store's", err)
	}
}

// ---- the suggestion ----

func suggest(t *testing.T, data wshrpc.CommandRunStartSuggestData) (*wshrpc.RunStartSuggestion, error) {
	t.Helper()
	return (&WshServer{}).RunStartSuggestCommand(context.Background(), data)
}

func TestRunStartSuggestWaitsForALiveRunWhoseGoalNamesTheSameFile(t *testing.T) {
	w := useStartWorld(t)
	w.addRun(101, "Fix the merge in land.go", nil)
	w.addRun(102, "Unrelated work in frontend/app/x.tsx", nil)

	got, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "Refactor land.go so a hold keeps its branch"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Choice != wshrpc.RunStartChoice_After || !slices.Equal(got.After, []string{w.q.runId(101)}) {
		t.Fatalf("suggestion = %+v, want After the run that edits land.go", got)
	}
	if got.Reason != "Edits land.go like Fix the merge in land.go" {
		t.Errorf("reason = %q", got.Reason)
	}
	if len(got.Live) != 2 {
		t.Fatalf("live = %+v, want every live run of the project for the After list", got.Live)
	}
	if l := got.Live[0]; l.RunId != w.q.runId(101) || !slices.Equal(l.Files, []string{"land.go"}) || l.Held || l.Title != "Fix the merge in land.go" {
		t.Errorf("live[0] = %+v, want the overlapping run with the file it shares", l)
	}
	if l := got.Live[1]; l.RunId != w.q.runId(102) || len(l.Files) != 0 {
		t.Errorf("live[1] = %+v, want the other run with no shared file", l)
	}
	if got.Active != 2 || got.MaxActive != 3 {
		t.Errorf("active = %d, maxactive = %d, want the queue's own count and cap", got.Active, got.MaxActive)
	}
}

func TestRunStartSuggestNeverWaitsForAHeldRun(t *testing.T) {
	w := useStartWorld(t)
	held := w.addRun(101, "Fix the merge in land.go", func(r *waveobj.Run) {
		r.Status = jarvis.RunStatus_Done
		r.Land = &waveobj.RunLand{State: orchestrate.LandState_Held, Reason: "merge conflict"}
	})

	got, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "Refactor land.go"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.After) != 0 || got.Choice == wshrpc.RunStartChoice_After {
		t.Fatalf("suggestion = %+v, want a held run never waited for: the queue would block the entry at once", got)
	}
	if len(got.Live) != 1 || got.Live[0].RunId != held.ID || !got.Live[0].Held || got.Live[0].HeldReason != "merge conflict" || !slices.Equal(got.Live[0].Files, []string{"land.go"}) {
		t.Errorf("live = %+v, want the held run listed as held, with its reason and the shared file", got.Live)
	}
	if !strings.Contains(got.Reason, "is held and edits land.go") {
		t.Errorf("reason = %q, want it to say the held run edits the file", got.Reason)
	}
}

func TestRunStartSuggestIgnoresAnotherProjectsRunButCountsItInActive(t *testing.T) {
	w := useStartWorld(t)
	w.addRun(101, "Fix the merge in land.go", func(r *waveobj.Run) { r.ProjectPath = w.proj + "-other" })
	w.addRun(102, "Something else in rules.go", nil)

	got, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "Refactor land.go"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Choice != wshrpc.RunStartChoice_Now || len(got.After) != 0 {
		t.Errorf("suggestion = %+v, want Run now: the run that edits land.go is in another repository", got)
	}
	if len(got.Live) != 1 || got.Live[0].RunId != w.q.runId(102) {
		t.Errorf("live = %+v, want only this project's run", got.Live)
	}
	if got.Active != 2 {
		t.Errorf("active = %d, want both runs: the cap counts every project", got.Active)
	}

	// the other project's run still fills the cap
	w.q.mu.Lock()
	w.q.maxActive = 2
	w.q.mu.Unlock()
	full, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "Refactor land.go"})
	if err != nil {
		t.Fatal(err)
	}
	if full.Choice != wshrpc.RunStartChoice_Queue || full.Reason != "2 runs are already active" || full.MaxActive != 2 {
		t.Errorf("suggestion = %+v, want Queue with no room under the cap", full)
	}
}

func TestRunStartSuggestReadsTheSpecAndAPlanRelativeToTheProject(t *testing.T) {
	w := useStartWorld(t)
	spec := w.writeFile(t, "docs/specs/x-design.md", "The change lives in pkg/runqueue/rules.go.")
	w.writeFile(t, "docs/plans/x.md", "# X\n\n### Task 1: Do it\n**Files:** `frontend/app/view/x.tsx`\n\nBody.\n")
	w.addRun(101, "A run that edits the plan's file", func(r *waveobj.Run) { r.BaseCommit = "b1" })
	w.git = func(dir, args string) ([]string, error) { return []string{"frontend/app/view/x.tsx"}, nil }

	fromPlan, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, PlanPath: "docs/plans/x.md"})
	if err != nil {
		t.Fatal(err)
	}
	if fromPlan.Choice != wshrpc.RunStartChoice_After || !slices.Equal(fromPlan.After, []string{w.q.runId(101)}) {
		t.Errorf("plan suggestion = %+v, want After the run whose diff names the plan's Files line", fromPlan)
	}

	fromSpec, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, SpecPath: spec, Goal: "Build the spec"})
	if err != nil {
		t.Fatal(err)
	}
	if fromSpec.Choice != wshrpc.RunStartChoice_Now {
		t.Errorf("spec suggestion = %+v, want Run now: no live run edits rules.go", fromSpec)
	}
	if !strings.Contains(fromSpec.Reason, "No live run edits the same files") {
		t.Errorf("reason = %q", fromSpec.Reason)
	}
}

func TestRunStartSuggestNamesTheSourceWhenItNamesNoFile(t *testing.T) {
	w := useStartWorld(t)
	spec := w.writeFile(t, "docs/specs/y.md", "Words, and no files at all.")
	w.writeFile(t, "docs/plans/y.md", "# Y\n\n### Task 1: Do it\n\nBody.\n")

	for name, tc := range map[string]struct {
		data wshrpc.CommandRunStartSuggestData
		want string
	}{
		"goal": {wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "Make it faster"}, "The goal names no files: only the run cap was checked"},
		"spec": {wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "Build the spec", SpecPath: spec}, "The spec names no files: only the run cap was checked"},
		"plan": {wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, PlanPath: "docs/plans/y.md"}, "The plan names no files: only the run cap was checked"},
	} {
		got, err := suggest(t, tc.data)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got.Reason != tc.want || got.Choice != wshrpc.RunStartChoice_Now {
			t.Errorf("%s: suggestion = %+v, want Run now with %q", name, got, tc.want)
		}
	}
}

func TestRunStartSuggestAnUnreadableSpecOrPlanIsAnError(t *testing.T) {
	w := useStartWorld(t)
	if _, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, SpecPath: w.proj + "/missing-spec.md"}); err == nil || !strings.Contains(err.Error(), "spec") {
		t.Errorf("err = %v, want the spec named", err)
	}
	if _, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, PlanPath: "docs/missing-plan.md"}); err == nil || !strings.Contains(err.Error(), "plan") {
		t.Errorf("err = %v, want the plan named", err)
	}
}

func TestRunStartSuggestNeedsAProjectAndTakesItFromTheChannelWhenGivenOnlyThat(t *testing.T) {
	w := useStartWorld(t)
	w.addRun(101, "Fix the merge in land.go", nil)
	if _, err := suggest(t, wshrpc.CommandRunStartSuggestData{Goal: "x"}); err == nil || !strings.Contains(err.Error(), "project") {
		t.Errorf("err = %v, want a refusal that names the project", err)
	}
	ch, err := wstore.CreateChannel(context.Background(), "runstart-suggest", w.proj)
	if err != nil {
		t.Fatal(err)
	}
	got, err := suggest(t, wshrpc.CommandRunStartSuggestData{ChannelId: ch.OID, Goal: "Refactor land.go"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Choice != wshrpc.RunStartChoice_After {
		t.Errorf("suggestion = %+v, want the channel's project read as the key", got)
	}
}

func TestRunStartSuggestLiveIsNeverNull(t *testing.T) {
	w := useStartWorld(t)
	got, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Live == nil {
		t.Error("live is nil: it reaches the launcher as null, not a list")
	}
}

func TestRunStartSuggestFailsWhenTheLiveRunsCannotBeRead(t *testing.T) {
	w := useStartWorld(t)
	swap(t, &runStartLoadRuns, func(context.Context) ([]*waveobj.Run, error) { return nil, errors.New("db is locked") })
	if _, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "x"}); err == nil {
		t.Error("an unreadable run list was answered with a suggestion")
	}
}

// ---- the quota note ----

func doneRunWithUsage(w *startWorld, n int, mode string, tokens int, doneTs int64) *waveobj.Run {
	return w.addRun(n, fmt.Sprintf("earlier run %d", n), func(r *waveobj.Run) {
		r.Status = jarvis.RunStatus_Done
		r.Mode = mode
		r.CompletedTs = doneTs
		r.Evidence = &waveobj.RunEvidence{Usage: []waveobj.UsageRow{{Role: "lead", Input: tokens / 2, Output: tokens / 2}}}
	})
}

func TestRunStartSuggestNotesAQuotaTheRunWouldNotFit(t *testing.T) {
	w := useStartWorld(t)
	reset := time.Now().Add(2 * time.Hour)
	pct := 60.0
	rst := reset.Unix()
	w.quota = &wshrpc.CommandGetClaudeQuotaRtnData{FiveHourPct: &pct, FiveHourReset: &rst}
	// 600 tokens seen at 60% size the window at 1000: three earlier runs of 500 are half of it, more than the 40% left
	w.windowTokens = 600
	for n := 101; n <= 103; n++ {
		doneRunWithUsage(w, n, jarvis.RunMode_Orchestrator, 500, int64(n))
	}
	doneRunWithUsage(w, 104, jarvis.RunMode_Quick, 5, 104) // another kind: not a sample

	got, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, SpecPath: w.writeFile(t, "docs/s.md", "no files here")})
	if err != nil {
		t.Fatal(err)
	}
	wantNote := "Quota at 40%: the run will pause until " + reset.Local().Format("15:04") + ", then carry on"
	if got.QuotaNote != wantNote {
		t.Errorf("quotanote = %q, want %q", got.QuotaNote, wantNote)
	}
	if got.Choice != wshrpc.RunStartChoice_Now {
		t.Errorf("choice = %q: a quota note never changes the choice", got.Choice)
	}
	w.mu.Lock()
	cutoffs := slices.Clone(w.cutoffs)
	w.mu.Unlock()
	if len(cutoffs) != 1 || !cutoffs[0].Equal(reset.Add(-5*time.Hour).Truncate(time.Second)) {
		t.Errorf("window tokens read since %v, want the 5-hour window's start (reset - 5h)", cutoffs)
	}
}

func TestRunStartSuggestNotesAQuotaNearlySpentWhenThereAreTooFewSamples(t *testing.T) {
	w := useStartWorld(t)
	reset := time.Now().Add(time.Hour)
	pct, rst := 90.0, reset.Unix()
	w.quota = &wshrpc.CommandGetClaudeQuotaRtnData{FiveHourPct: &pct, FiveHourReset: &rst}
	doneRunWithUsage(w, 101, jarvis.RunMode_Quick, 500, 101)

	got, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "Make it faster"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got.QuotaNote, "Quota at 10%: the run will pause until ") {
		t.Errorf("quotanote = %q, want the nearly-spent note with 10%% left", got.QuotaNote)
	}
	w.mu.Lock()
	asked := len(w.cutoffs)
	w.mu.Unlock()
	if asked != 0 {
		t.Errorf("the transcripts were summed %d times for an estimate nobody uses", asked)
	}
}

func TestRunStartSuggestHasNoQuotaNoteWithoutAReadingOrWithRoomLeft(t *testing.T) {
	w := useStartWorld(t)
	got, err := suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if got.QuotaNote != "" {
		t.Errorf("quotanote = %q with no reading", got.QuotaNote)
	}
	swap(t, &runStartQuota, func(context.Context) *wshrpc.CommandGetClaudeQuotaRtnData { return nil })
	if got, err = suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "x"}); err != nil || got.QuotaNote != "" {
		t.Errorf("suggestion = %+v, %v, want no note and no failure for a missing reading", got, err)
	}
	pct, rst := 20.0, time.Now().Add(time.Hour).Unix()
	w.quota = &wshrpc.CommandGetClaudeQuotaRtnData{FiveHourPct: &pct, FiveHourReset: &rst}
	swap(t, &runStartQuota, func(context.Context) *wshrpc.CommandGetClaudeQuotaRtnData { return w.quota })
	if got, err = suggest(t, wshrpc.CommandRunStartSuggestData{ProjectPath: w.proj, Goal: "x"}); err != nil || got.QuotaNote != "" {
		t.Errorf("suggestion = %+v, %v, want no note at 20%% used", got, err)
	}
}

func TestQuotaSamplesAreTheSummedUsageOfTheLastTenDoneRunsOfTheKind(t *testing.T) {
	proj := "/p"
	run := func(id string, edit func(*waveobj.Run)) *waveobj.Run {
		r := &waveobj.Run{ID: id, Status: jarvis.RunStatus_Done, Mode: jarvis.RunMode_Orchestrator, ProjectPath: proj, CompletedTs: 100,
			Evidence: &waveobj.RunEvidence{Usage: []waveobj.UsageRow{
				{Role: "lead", Input: 1, Output: 2, CacheRead: 4, CacheWrite: 8, CacheWrite1h: 16},
				{Role: "worker", Input: 100},
			}}}
		if edit != nil {
			edit(r)
		}
		return r
	}
	runs := []*waveobj.Run{
		run("counted", nil),
		run("quick", func(r *waveobj.Run) { r.Mode = jarvis.RunMode_Quick }),
		run("not-done", func(r *waveobj.Run) { r.Status = jarvis.RunStatus_Executing }),
		run("child", func(r *waveobj.Run) { r.TaskId = "t-1" }),
		run("other-project", func(r *waveobj.Run) { r.ProjectPath = "/q" }),
		run("no-evidence", func(r *waveobj.Run) { r.Evidence = nil }),
		run("no-usage", func(r *waveobj.Run) { r.Evidence = &waveobj.RunEvidence{} }),
	}
	if got := quotaSamples(runs, proj, true); !slices.Equal(got, []int64{131}) {
		t.Errorf("orchestrator samples = %v, want the one run's rows summed (input, output, both cache kinds)", got)
	}
	if got := quotaSamples(runs, proj, false); !slices.Equal(got, []int64{131}) {
		t.Errorf("quick samples = %v, want the quick run's alone: kinds are not mixed", got)
	}

	// the last ten by completion, the newest first
	var many []*waveobj.Run
	for i := 1; i <= 12; i++ {
		many = append(many, run(fmt.Sprintf("r%d", i), func(r *waveobj.Run) {
			r.CompletedTs = int64(i)
			r.Evidence = &waveobj.RunEvidence{Usage: []waveobj.UsageRow{{Input: i}}}
		}))
	}
	got := quotaSamples(many, proj, true)
	if len(got) != 10 || got[0] != 12 || got[9] != 3 {
		t.Errorf("samples = %v, want the ten most recently completed, newest first", got)
	}
}

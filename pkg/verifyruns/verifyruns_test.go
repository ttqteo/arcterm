// pkg/verifyruns/verifyruns_test.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package verifyruns

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func pass(step string) Step { return Step{Step: step, State: "pass"} }
func fail(step string) Step { return Step{Step: step, State: "fail"} }

func start(runId string, pid int, names ...string) Report {
	r := Report{RunId: runId, Phase: "start", Pid: pid, Command: "task verify:ui -- " + names[0]}
	for _, n := range names {
		r.Scenarios = append(r.Scenarios, Scenario{Name: n})
	}
	return r
}

func TestApplyStartThenEnd(t *testing.T) {
	bf := Apply(BlockFile{}, start("r1", 100, "a"), 1000)
	run, ok := bf.Runs["a"]
	if !ok || run.Started != 1000 || run.Pid != 100 || run.Ended {
		t.Fatalf("after start: %+v", bf.Runs)
	}
	end := Report{RunId: "r1", Phase: "end", Pid: 100, ShotsDir: "/shots", Scenarios: []Scenario{
		{Name: "a", Files: []string{"a-01.png"}, Steps: []Step{pass("1. x"), fail("2. y")}, Done: true},
	}}
	bf = Apply(bf, end, 5000)
	run = bf.Runs["a"]
	if !run.Ended || run.Updated != 5000 || run.Started != 1000 || run.ShotsDir != "/shots" {
		t.Errorf("after end: %+v", run)
	}
	if len(run.Scenarios) != 1 || !run.Scenarios[0].Done || len(run.Scenarios[0].Steps) != 2 || run.Scenarios[0].Files[0] != "a-01.png" {
		t.Errorf("scenario after end: %+v", run.Scenarios)
	}
}

func TestApplyProgressKeepsTheRunOpen(t *testing.T) {
	bf := Apply(BlockFile{}, start("r1", 100, "a", "b"), 1000)
	bf = Apply(bf, Report{RunId: "r1", Phase: "progress", Scenarios: []Scenario{
		{Name: "a", Steps: []Step{pass("1. x")}, Done: true},
	}}, 2000)
	for _, n := range []string{"a", "b"} {
		run := bf.Runs[n]
		if run.Ended || run.Updated != 2000 || len(run.Scenarios) != 2 {
			t.Fatalf("%s after progress: %+v", n, run)
		}
		if !run.Scenarios[0].Done || run.Scenarios[1].Done {
			t.Errorf("%s: only a is done: %+v", n, run.Scenarios)
		}
	}
}

func TestApplyRepeatStartOfOneRunKeepsFinalsPidAndCommand(t *testing.T) {
	// Final reports start before its app starts; the verify.mjs it runs reports start again with the same run id.
	final := Report{RunId: "r1", Phase: "start", Pid: 100, Cwd: "/w", Command: "node scripts/cdp/final-verify.mjs a b",
		Scenarios: []Scenario{{Name: "a"}, {Name: "b"}}}
	bf := Apply(BlockFile{}, final, 1000)
	child := Report{RunId: "r1", Phase: "start", Pid: 222, Command: "task verify:ui -- a b", ShotsDir: "/shots",
		Scenarios: []Scenario{{Name: "a"}, {Name: "b"}, {Name: "c"}}}
	bf = Apply(bf, child, 1500)
	for _, n := range []string{"a", "b", "c"} {
		run, ok := bf.Runs[n]
		if !ok {
			t.Fatalf("scenario %s missing: %+v", n, bf.Runs)
		}
		if run.Pid != 100 || run.Command != "node scripts/cdp/final-verify.mjs a b" || run.Started != 1000 {
			t.Errorf("%s keeps the first pid, command and start: %+v", n, run)
		}
		if run.ShotsDir != "/shots" || run.Cwd != "/w" || len(run.Scenarios) != 3 {
			t.Errorf("%s: shotsdir from the later report, cwd from the first, three scenarios: %+v", n, run)
		}
	}
}

func TestApplyEndFromAChildKeepsTheFirstPid(t *testing.T) {
	bf := Apply(BlockFile{}, Report{RunId: "r1", Phase: "start", Pid: 100, Scenarios: []Scenario{{Name: "a"}}}, 1000)
	bf = Apply(bf, Report{RunId: "r1", Phase: "end", Pid: 222, Scenarios: []Scenario{
		{Name: "a", Steps: []Step{pass("1. x")}, Done: true},
	}}, 2000)
	if run := bf.Runs["a"]; run.Pid != 100 || !run.Ended {
		t.Errorf("run = %+v, want pid 100 and ended", run)
	}
}

func TestApplyEndWithReasonKeepsTheReason(t *testing.T) {
	bf := Apply(BlockFile{}, start("r1", 100, "a"), 1000)
	bf = Apply(bf, Report{RunId: "r1", Phase: "end", Reason: "Could not start the dev app"}, 2000)
	if run := bf.Runs["a"]; !run.Ended || run.Reason != "Could not start the dev app" {
		t.Errorf("run = %+v", run)
	}
}

func TestApplyStaleReportFromAnOlderRunIsIgnored(t *testing.T) {
	bf := Apply(BlockFile{}, start("old", 100, "a"), 1000)
	bf = Apply(bf, start("new", 200, "a"), 3000)
	// the old run's end arrives late: it must not overwrite the newer run
	bf = Apply(bf, Report{RunId: "old", Phase: "end", Scenarios: []Scenario{
		{Name: "a", Steps: []Step{fail("1. x")}, Done: true},
	}}, 4000)
	run := bf.Runs["a"]
	if run.RunId != "new" || run.Ended || len(run.Scenarios[0].Steps) != 0 || run.Updated != 3000 {
		t.Errorf("newer run was overwritten by a stale report: %+v", run)
	}
}

func TestApplyStaleReportOfAnUnknownRunIsIgnored(t *testing.T) {
	// the old run's entries were all replaced, so its run id is no longer stored anywhere
	bf := Apply(BlockFile{}, start("new", 200, "a"), 3000)
	bf = Apply(bf, Report{RunId: "gone", Phase: "end", Scenarios: []Scenario{{Name: "a", Done: true}}}, 4000)
	if run := bf.Runs["a"]; run.RunId != "new" || run.Ended {
		t.Errorf("run = %+v, want the new run untouched", run)
	}
}

func TestApplyNewRunReplacesAnOlderRunOfTheScenario(t *testing.T) {
	bf := Apply(BlockFile{}, start("r1", 100, "a", "b"), 1000)
	bf = Apply(bf, Report{RunId: "r1", Phase: "end", Scenarios: []Scenario{
		{Name: "a", Steps: []Step{pass("1. x")}, Done: true}, {Name: "b", Steps: []Step{pass("1. x")}, Done: true},
	}}, 2000)
	bf = Apply(bf, start("r2", 300, "a"), 3000)
	if bf.Runs["a"].RunId != "r2" || bf.Runs["b"].RunId != "r1" {
		t.Errorf("a is the new run, b stays r1: %+v", bf.Runs)
	}
	// a late progress for r1 must not take scenario a back
	bf = Apply(bf, Report{RunId: "r1", Phase: "progress", Scenarios: []Scenario{{Name: "a", Done: true}}}, 3500)
	if bf.Runs["a"].RunId != "r2" {
		t.Errorf("r1's late progress took a back: %+v", bf.Runs["a"])
	}
}

func TestApplyProgressOfAnUnknownRunCreatesItWhenNothingConflicts(t *testing.T) {
	// the start report was lost: a progress for a run nobody stored still lands
	bf := Apply(BlockFile{}, Report{RunId: "r1", Phase: "progress", Pid: 7, Scenarios: []Scenario{
		{Name: "a", Steps: []Step{pass("1. x")}, Done: true},
	}}, 2000)
	if run, ok := bf.Runs["a"]; !ok || run.RunId != "r1" || run.Started != 2000 {
		t.Errorf("runs = %+v", bf.Runs)
	}
}

func TestApplyNewRunClearsTheScenariosSkip(t *testing.T) {
	bf := BlockFile{Skips: map[string]int64{"a": 500, "b": 600, "": 700}}
	bf = Apply(bf, start("r1", 100, "a"), 1000)
	if _, ok := bf.Skips["a"]; ok {
		t.Errorf("a's skip survived a new run: %+v", bf.Skips)
	}
	if bf.Skips["b"] != 600 || bf.Skips[""] != 700 {
		t.Errorf("other skips must stay: %+v", bf.Skips)
	}
}

func TestApplyDoesNotMutateItsInput(t *testing.T) {
	in := Apply(BlockFile{}, start("r1", 100, "a"), 1000)
	_ = Apply(in, Report{RunId: "r1", Phase: "end", Scenarios: []Scenario{{Name: "a", Done: true}}}, 2000)
	if in.Runs["a"].Ended || in.Runs["a"].Updated != 1000 {
		t.Errorf("Apply changed its input: %+v", in.Runs["a"])
	}
}

// ---- Store ----

func newTestStore(t *testing.T) (*Store, *int64) {
	t.Helper()
	s := NewStore(filepath.Join(t.TempDir(), "verify"))
	clock := int64(1_000_000)
	s.now = func() int64 { return clock }
	return s, &clock
}

func TestStoreReportWritesFileAndNotifies(t *testing.T) {
	s, _ := newTestStore(t)
	var mu sync.Mutex
	var notified []string
	s.SetOnChange(func(id string) {
		mu.Lock()
		defer mu.Unlock()
		notified = append(notified, id)
	})
	r := start("r1", os.Getpid(), "a")
	r.BlockId = "block-1"
	if err := s.Report(r); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "block-1.json")); err != nil {
		t.Fatalf("block file not written: %v", err)
	}
	if len(notified) != 1 || notified[0] != "block-1" {
		t.Errorf("notified = %v", notified)
	}
	bf, err := s.load("block-1")
	if err != nil || bf.Runs["a"].RunId != "r1" || bf.Runs["a"].Started != 1_000_000 {
		t.Errorf("reloaded = %+v, %v", bf, err)
	}
}

func TestStoreReportRejectsBadInput(t *testing.T) {
	s, _ := newTestStore(t)
	cases := map[string]Report{
		"no block":        {RunId: "r", Phase: "start"},
		"path block":      {BlockId: "../x", RunId: "r", Phase: "start"},
		"slash block":     {BlockId: "a/b", RunId: "r", Phase: "start"},
		"no run id":       {BlockId: "b", Phase: "start"},
		"unknown phase":   {BlockId: "b", RunId: "r", Phase: "later"},
		"backslash block": {BlockId: `a\b`, RunId: "r", Phase: "start"},
	}
	for name, r := range cases {
		if err := s.Report(r); err == nil {
			t.Errorf("%s: Report succeeded, want an error", name)
		}
	}
	if entries, _ := os.ReadDir(s.dir); len(entries) != 0 {
		t.Errorf("a rejected report wrote files: %v", entries)
	}
}

func TestStoreSkipAndUndo(t *testing.T) {
	s, clock := newTestStore(t)
	var notified int
	s.SetOnChange(func(string) { notified++ })
	r := start("r1", 1, "a")
	r.BlockId = "b1"
	if err := s.Report(r); err != nil {
		t.Fatal(err)
	}
	*clock = 2_000_000
	if err := s.Skip("b1", "a", false); err != nil {
		t.Fatal(err)
	}
	bf, _ := s.load("b1")
	if bf.Skips["a"] != 2_000_000 {
		t.Errorf("skips = %+v", bf.Skips)
	}
	if err := s.Skip("b1", "", false); err != nil { // the not-run warning
		t.Fatal(err)
	}
	if err := s.Skip("b1", "a", true); err != nil {
		t.Fatal(err)
	}
	bf, _ = s.load("b1")
	if _, ok := bf.Skips["a"]; ok || bf.Skips[""] != 2_000_000 {
		t.Errorf("after undo: %+v", bf.Skips)
	}
	if notified != 4 {
		t.Errorf("onChange ran %d times, want 4 (report, skip, skip, undo)", notified)
	}
}

func TestStoreSkipOfTheNotRunWarningNeedsNoRuns(t *testing.T) {
	s, clock := newTestStore(t)
	*clock = 5_000
	if err := s.Skip("fresh", "", false); err != nil {
		t.Fatal(err)
	}
	bf, err := s.load("fresh")
	if err != nil || bf.Skips[""] != 5_000 {
		t.Errorf("bf = %+v, %v", bf, err)
	}
	if err := s.Skip("never-written", "", true); err != nil { // undo on a block with no file: nothing to do
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "never-written.json")); !os.IsNotExist(err) {
		t.Errorf("an undo created a file: %v", err)
	}
}

func TestStoreForgetRemovesTheFile(t *testing.T) {
	s, _ := newTestStore(t)
	r := start("r1", 1, "a")
	r.BlockId = "b1"
	if err := s.Report(r); err != nil {
		t.Fatal(err)
	}
	if err := s.Forget("b1"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "b1.json")); !os.IsNotExist(err) {
		t.Errorf("file still there: %v", err)
	}
	if err := s.Forget("b1"); err != nil { // a second forget, or one for a block that never reported
		t.Errorf("Forget on a missing file = %v, want nil", err)
	}
}

func TestStoreSweepRemovesOnlyOldFiles(t *testing.T) {
	s, clock := newTestStore(t)
	for _, id := range []string{"old", "fresh"} {
		r := start("r1", 1, "a")
		r.BlockId = id
		if err := s.Report(r); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	*clock = now.UnixMilli()
	old := now.Add(-31 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(s.dir, "old.json"), old, old); err != nil {
		t.Fatal(err)
	}
	recent := now.Add(-29 * 24 * time.Hour)
	if err := os.Chtimes(filepath.Join(s.dir, "fresh.json"), recent, recent); err != nil {
		t.Fatal(err)
	}
	if err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "old.json")); !os.IsNotExist(err) {
		t.Errorf("old.json survived the sweep: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "fresh.json")); err != nil {
		t.Errorf("fresh.json was swept: %v", err)
	}
}

func TestStoreSweepOnAMissingDirIsNotAnError(t *testing.T) {
	s := NewStore(filepath.Join(t.TempDir(), "never-made"))
	if err := s.Sweep(); err != nil {
		t.Errorf("Sweep = %v", err)
	}
}

// A repo with no .arc/verify.json has no Verify at all, whatever the agent ran.
func TestStoreStateIsEmptyWithoutAConfig(t *testing.T) {
	s, _ := newTestStore(t)
	r := start("r1", os.Getpid(), "a")
	r.BlockId = "b1"
	if err := s.Report(r); err != nil {
		t.Fatal(err)
	}
	st, err := s.State(context.Background(), "b1", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Rows) != 0 || st.Verdict != "" || st.NotRun {
		t.Errorf("state = %+v, want empty", st)
	}
}

func TestStoreStateReadsTheRunsOfARepoWithAConfig(t *testing.T) {
	s, clock := newTestStore(t)
	repo := newRepo(t, `{ "watch": ["ui/**/*.tsx"], "rerun": "task verify:ui -- <name>" }`)
	*clock = time.Now().UnixMilli() + 60_000 // the runs happen after the repo's files were written
	r := start("r1", os.Getpid(), "a")
	r.BlockId = "b1"
	if err := s.Report(r); err != nil {
		t.Fatal(err)
	}
	st, err := s.State(context.Background(), "b1", repo)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Rows) != 1 || st.Rows[0].State != "running" || st.Verdict != "running" {
		t.Errorf("state = %+v, want one running row (this process's pid is alive)", st)
	}
	if st.Rerun != "task verify:ui -- <name>" || st.Branch != "main" || st.DefaultBranch != "main" {
		t.Errorf("rerun/branch/default = %q/%q/%q", st.Rerun, st.Branch, st.DefaultBranch)
	}
}

func TestStoreStateOfAGoneProcessIsNoResult(t *testing.T) {
	s, clock := newTestStore(t)
	repo := newRepo(t, `{ "watch": ["ui/**/*.tsx"] }`)
	*clock = time.Now().UnixMilli() + 60_000
	r := start("r1", 2_000_000_000, "a") // no such pid
	r.BlockId = "b1"
	if err := s.Report(r); err != nil {
		t.Fatal(err)
	}
	st, err := s.State(context.Background(), "b1", repo)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Rows) != 1 || st.Rows[0].State != "noresult" || st.Verdict != "amber" {
		t.Errorf("state = %+v, want no result / amber", st)
	}
}

func TestStoreStateNotRunWhenAWatchedFileChanged(t *testing.T) {
	s, _ := newTestStore(t)
	repo := newRepo(t, `{ "watch": ["ui/**/*.tsx"] }`)
	writeFile(t, repo, "ui/a.tsx", "changed\n")
	st, err := s.State(context.Background(), "no-reports", repo)
	if err != nil {
		t.Fatal(err)
	}
	if !st.NotRun || st.Verdict != "amber" || len(st.Changed) != 1 || st.Changed[0] != "ui/a.tsx" {
		t.Errorf("state = %+v, want not run / amber / ui/a.tsx", st)
	}
}

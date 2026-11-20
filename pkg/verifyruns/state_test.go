// pkg/verifyruns/state_test.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package verifyruns

import (
	"reflect"
	"testing"
)

// alivePid100 is the liveness probe the tests use: only pid 100 is a running process.
func alivePid100(pid int) bool { return pid == 100 }

// endedRun builds a finished run of the named scenarios, each with the same steps.
func endedRun(runId string, started, ended int64, steps []Step, names ...string) Run {
	run := Run{RunId: runId, Pid: 100, Command: "task verify:ui -- " + names[0], ShotsDir: "/shots", Started: started, Updated: ended, Ended: true}
	for _, n := range names {
		run.Scenarios = append(run.Scenarios, Scenario{Name: n, Files: []string{n + "-01.png", n + "-02.png"}, Steps: steps, Done: true})
	}
	return run
}

func blockOf(runs ...Run) BlockFile {
	bf := BlockFile{Runs: map[string]Run{}}
	for _, r := range runs {
		for _, s := range r.Scenarios {
			bf.Runs[s.Name] = r
		}
	}
	return bf
}

func rowOf(t *testing.T, st State, scenario string) Row {
	t.Helper()
	for _, r := range st.Rows {
		if r.Scenario == scenario {
			return r
		}
	}
	t.Fatalf("no row for %q in %+v", scenario, st.Rows)
	return Row{}
}

var (
	allPass  = []Step{pass("1. opens"), pass("2. shows")}
	someFail = []Step{pass("1. opens"), fail("2. shows the card"), pass("3. closes"), fail("4. reopens")}
)

func TestDeriveStatePerScenario(t *testing.T) {
	running := Run{RunId: "r", Pid: 100, Command: "cmd", Started: 1000, Updated: 1500,
		Scenarios: []Scenario{{Name: "a", Done: true}, {Name: "b"}, {Name: "c"}}}
	gone := Run{RunId: "r", Pid: 200, Started: 1000, Updated: 1500, Scenarios: []Scenario{{Name: "a"}}}
	reasoned := endedRun("r", 1000, 2000, nil, "a")
	reasoned.Reason = `Could not start the dev app: the "beforeDevCommand" terminated`
	noReason := endedRun("r", 1000, 2000, nil, "a")
	allSkipped := endedRun("r", 1000, 2000, []Step{{Step: "1. x", State: "skip"}}, "a")

	tests := []struct {
		name       string
		run        Run
		scenario   string
		wantState  string
		wantPassed int
		wantTotal  int
		wantFailed []string
	}{
		{"not ended and its pid alive is running", running, "b", "running", 0, 0, nil},
		{"not ended and its pid gone is no result", gone, "a", "noresult", 0, 0, nil},
		{"ended with a reason and no steps is no result", reasoned, "a", "noresult", 0, 0, nil},
		{"ended with no steps is no result", noReason, "a", "noresult", 0, 0, nil},
		{"ended with only skipped steps is no result", allSkipped, "a", "noresult", 0, 0, nil},
		{"ended with a failed step is failed", endedRun("r", 1000, 2000, someFail, "a"), "a", "failed", 2, 4, []string{"2. shows the card", "4. reopens"}},
		{"ended with every step passing is passed", endedRun("r", 1000, 2000, allPass, "a"), "a", "passed", 2, 2, nil},
		{"skipped steps are not counted", endedRun("r", 1000, 2000, []Step{pass("1. a"), {Step: "2. b", State: "skip"}, pass("3. c")}, "a"), "a", "passed", 2, 2, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := Derive(blockOf(tc.run), alivePid100, nil, "")
			row := rowOf(t, st, tc.scenario)
			if row.State != tc.wantState {
				t.Errorf("state = %q, want %q", row.State, tc.wantState)
			}
			if row.Passed != tc.wantPassed || row.Total != tc.wantTotal {
				t.Errorf("passed/total = %d/%d, want %d/%d", row.Passed, row.Total, tc.wantPassed, tc.wantTotal)
			}
			if !reflect.DeepEqual(row.Failed, tc.wantFailed) {
				t.Errorf("failed = %v, want %v", row.Failed, tc.wantFailed)
			}
		})
	}
}

func TestDeriveRowCarriesTheRunsFacts(t *testing.T) {
	run := endedRun("r", 1000, 2000, someFail, "a")
	run.Reason = "boom"
	row := rowOf(t, Derive(blockOf(run), alivePid100, nil, ""), "a")
	if row.Command != "task verify:ui -- a" || row.ShotsDir != "/shots" || row.Reason != "boom" || row.Shots != 2 {
		t.Errorf("row = %+v", row)
	}
	if row.Started != 1000 || row.Ended != 2000 {
		t.Errorf("started/ended = %d/%d, want 1000/2000 (an ended run's Updated is its end)", row.Started, row.Ended)
	}
}

func TestDeriveRunningRowsCountTheRunsFinishedScenarios(t *testing.T) {
	run := Run{RunId: "r", Pid: 100, Started: 1000, Updated: 1500,
		Scenarios: []Scenario{{Name: "a", Done: true}, {Name: "b", Done: true}, {Name: "c"}}}
	st := Derive(blockOf(run), alivePid100, nil, "")
	for _, n := range []string{"a", "b", "c"} {
		row := rowOf(t, st, n)
		if row.State != "running" || row.Done != 2 || row.Of != 3 || row.Ended != 0 {
			t.Errorf("%s: %+v, want running, 2 of 3, no end", n, row)
		}
	}
	if st.Verdict != "running" {
		t.Errorf("verdict = %q", st.Verdict)
	}
}

func TestDeriveOutOfDate(t *testing.T) {
	bf := blockOf(endedRun("r", 1000, 2000, allPass, "a"))
	changed := []Change{{Path: "ui/old.tsx", Mtime: 1500}, {Path: "ui/new.tsx", Mtime: 3000}, {Path: "ui/mid.tsx", Mtime: 2500}}
	st := Derive(bf, alivePid100, changed, "")
	row := rowOf(t, st, "a")
	if row.State != "outofdate" || row.ChangedFile != "ui/new.tsx" {
		t.Errorf("row = %+v, want out of date by ui/new.tsx", row)
	}
	// out of date alone: amber, and not also "not run", since a run exists
	if st.Verdict != "amber" || st.NotRun {
		t.Errorf("verdict = %q, notrun = %v, want amber and not not-run", st.Verdict, st.NotRun)
	}
	// the warning's files: those after the newest run (ended at 2000), newest first
	if want := []string{"ui/new.tsx", "ui/mid.tsx"}; !reflect.DeepEqual(st.Changed, want) {
		t.Errorf("changed = %v, want %v", st.Changed, want)
	}
}

func TestDeriveAPassedRunNewerThanTheChangeIsPassed(t *testing.T) {
	bf := blockOf(endedRun("r", 1000, 4000, allPass, "a"))
	st := Derive(bf, alivePid100, []Change{{Path: "ui/a.tsx", Mtime: 3000}}, "")
	if row := rowOf(t, st, "a"); row.State != "passed" || st.Verdict != "passed" || len(st.Changed) != 0 || st.NotRun {
		t.Errorf("state = %+v", st)
	}
}

func TestDeriveAFailedRunStaysFailedWhenFilesChangedAfterIt(t *testing.T) {
	bf := blockOf(endedRun("r", 1000, 2000, someFail, "a"))
	st := Derive(bf, alivePid100, []Change{{Path: "ui/a.tsx", Mtime: 3000}}, "")
	if row := rowOf(t, st, "a"); row.State != "failed" || st.Verdict != "red" {
		t.Errorf("state = %+v, want failed and red (out of date is only for a passed run)", st)
	}
}

func TestDeriveSkip(t *testing.T) {
	failedRun := endedRun("r", 1000, 2000, someFail, "a")
	noResult := endedRun("r", 1000, 2000, nil, "a")
	passedRun := endedRun("r", 1000, 2000, allPass, "a")
	tests := []struct {
		name      string
		run       Run
		skipAt    int64
		changes   []Change
		wantState string
		verdict   string
	}{
		{"a skip after the run sets a failed row aside", failedRun, 2500, nil, "skipped", "passed"},
		{"a skip after the run sets a no-result row aside", noResult, 2500, nil, "skipped", "passed"},
		{"a skip after the run and the change sets an out-of-date row aside", passedRun, 4000, []Change{{Path: "ui/a.tsx", Mtime: 3000}}, "skipped", "passed"},
		{"a skip expires when a watched file changes after it", failedRun, 2500, []Change{{Path: "ui/a.tsx", Mtime: 3000}}, "failed", "red"},
		{"an out-of-date skip expires on a newer change", passedRun, 3500, []Change{{Path: "ui/a.tsx", Mtime: 4000}}, "outofdate", "amber"},
		{"a skip from before the run's end does not count", failedRun, 1500, nil, "failed", "red"},
		{"a skip at the run's end does not count", failedRun, 2000, nil, "failed", "red"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			bf := blockOf(tc.run)
			bf.Skips = map[string]int64{"a": tc.skipAt}
			st := Derive(bf, alivePid100, tc.changes, "")
			if row := rowOf(t, st, "a"); row.State != tc.wantState {
				t.Errorf("state = %q, want %q", row.State, tc.wantState)
			}
			if st.Verdict != tc.verdict {
				t.Errorf("verdict = %q, want %q", st.Verdict, tc.verdict)
			}
		})
	}
}

func TestDeriveASkipHidesTheWarningFilesItCovers(t *testing.T) {
	bf := blockOf(endedRun("r", 1000, 2000, allPass, "a"))
	bf.Skips = map[string]int64{"a": 4000}
	st := Derive(bf, alivePid100, []Change{{Path: "ui/a.tsx", Mtime: 3000}}, "")
	if len(st.Changed) != 0 {
		t.Errorf("changed = %v, want none: the change is older than the skip", st.Changed)
	}
}

func TestDeriveNotRun(t *testing.T) {
	changes := []Change{{Path: "ui/a.tsx", Mtime: 3000}, {Path: "ui/b.tsx", Mtime: 2000}}
	t.Run("a watched change and no run at all", func(t *testing.T) {
		st := Derive(BlockFile{}, alivePid100, changes, "task verify:ui -- <name>")
		if !st.NotRun || st.NotRunSkipped || st.Verdict != "amber" || len(st.Rows) != 0 {
			t.Errorf("state = %+v", st)
		}
		if want := []string{"ui/a.tsx", "ui/b.tsx"}; !reflect.DeepEqual(st.Changed, want) {
			t.Errorf("changed = %v, want %v", st.Changed, want)
		}
		if st.Rerun != "task verify:ui -- <name>" {
			t.Errorf("rerun = %q", st.Rerun)
		}
	})
	t.Run("skipped when the skip is newer than the newest change", func(t *testing.T) {
		st := Derive(BlockFile{Skips: map[string]int64{"": 3500}}, alivePid100, changes, "")
		if !st.NotRun || !st.NotRunSkipped || st.Verdict != "" {
			t.Errorf("state = %+v, want not run, skipped, no verdict", st)
		}
	})
	t.Run("the skip expires on a newer change", func(t *testing.T) {
		st := Derive(BlockFile{Skips: map[string]int64{"": 2500}}, alivePid100, changes, "")
		if !st.NotRun || st.NotRunSkipped || st.Verdict != "amber" {
			t.Errorf("state = %+v, want not run, not skipped, amber", st)
		}
	})
	t.Run("no change and no run is nothing", func(t *testing.T) {
		st := Derive(BlockFile{}, alivePid100, nil, "")
		if st.NotRun || st.Verdict != "" || len(st.Rows) != 0 || len(st.Changed) != 0 {
			t.Errorf("state = %+v", st)
		}
	})
	t.Run("not run is false once any run exists", func(t *testing.T) {
		st := Derive(blockOf(endedRun("r", 1000, 4000, allPass, "a")), alivePid100, changes, "")
		if st.NotRun {
			t.Errorf("state = %+v", st)
		}
	})
}

func TestDeriveVerdict(t *testing.T) {
	failed := endedRun("f", 1000, 2000, someFail, "failed")
	nores := endedRun("n", 1000, 2000, nil, "nores")
	passed := endedRun("p", 1000, 2000, allPass, "passed")
	running := Run{RunId: "u", Pid: 100, Started: 1000, Updated: 1500, Scenarios: []Scenario{{Name: "running"}}}
	tests := []struct {
		name string
		runs []Run
		want string
	}{
		{"nothing", nil, ""},
		{"only passed", []Run{passed}, "passed"},
		{"running beats passed", []Run{passed, running}, "running"},
		{"no result beats running", []Run{nores, running, passed}, "amber"},
		{"failed beats every other state", []Run{failed, nores, running, passed}, "red"},
		{"failed alone", []Run{failed}, "red"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Derive(blockOf(tc.runs...), alivePid100, nil, "").Verdict; got != tc.want {
				t.Errorf("verdict = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestDeriveRowOrder(t *testing.T) {
	runs := []Run{
		endedRun("1", 1000, 2000, allPass, "passed-old"),
		endedRun("2", 1000, 5000, allPass, "passed-new"),
		endedRun("3", 1000, 3000, someFail, "failed-old"),
		endedRun("4", 1000, 6000, someFail, "failed-new"),
		endedRun("5", 1000, 4000, nil, "nores"),
		{RunId: "6", Pid: 100, Started: 7000, Updated: 7000, Scenarios: []Scenario{{Name: "running"}}},
		endedRun("7", 1000, 1200, allPass, "skipped"),
	}
	bf := blockOf(runs...)
	bf.Skips = map[string]int64{}
	// an out-of-date row: a passed run that ended before the change at 5500
	st := Derive(bf, alivePid100, []Change{{Path: "ui/x.tsx", Mtime: 5500}}, "")
	var got []string
	for _, r := range st.Rows {
		got = append(got, r.Scenario+":"+r.State)
	}
	// every passed run that ended before 5500 is out of date; passed-new ended at 5000, also before it
	want := []string{
		"failed-new:failed", "failed-old:failed",
		"nores:noresult",
		"running:running",
		"passed-new:outofdate", "passed-old:outofdate", "skipped:outofdate",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("order = %v\nwant    %v", got, want)
	}
}

func TestDeriveRowOrderPassedBeforeSkipped(t *testing.T) {
	bf := blockOf(endedRun("1", 1000, 2000, allPass, "passed"), endedRun("2", 1000, 2000, someFail, "skipme"))
	bf.Skips = map[string]int64{"skipme": 3000}
	st := Derive(bf, alivePid100, nil, "")
	var got []string
	for _, r := range st.Rows {
		got = append(got, r.Scenario+":"+r.State)
	}
	if want := []string{"passed:passed", "skipme:skipped"}; !reflect.DeepEqual(got, want) {
		t.Errorf("order = %v, want %v", got, want)
	}
	if st.Verdict != "passed" {
		t.Errorf("verdict = %q, a skipped row counts as passed", st.Verdict)
	}
}

func TestDeriveSortIsDeterministicOnTies(t *testing.T) {
	bf := blockOf(endedRun("1", 1000, 2000, allPass, "b", "a", "c"))
	st := Derive(bf, alivePid100, nil, "")
	var got []string
	for _, r := range st.Rows {
		got = append(got, r.Scenario)
	}
	if want := []string{"a", "b", "c"}; !reflect.DeepEqual(got, want) {
		t.Errorf("order = %v, want %v", got, want)
	}
}

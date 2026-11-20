// pkg/verifyruns/state.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package verifyruns

import "sort"

// A row's state, and a State's verdict. Red is only for a failed step; a run with no result, no run at all, or
// a run older than the change is amber: not known, not wrong.
const (
	StateRunning   = "running"
	StatePassed    = "passed"
	StateFailed    = "failed"
	StateNoResult  = "noresult"
	StateOutOfDate = "outofdate"
	StateSkipped   = "skipped"

	VerdictRunning = "running"
	VerdictPassed  = "passed"
	VerdictAmber   = "amber"
	VerdictRed     = "red"
)

// Row is one scenario's line in the Verify tile: the newest run that named it, judged.
type Row struct {
	Scenario string
	State    string // running | passed | failed | noresult | outofdate | skipped
	Passed   int    // steps that passed
	Total    int    // steps that were checked (a skipped step is not counted)
	Failed   []string
	// Done and Of: how many scenarios of its run have finished, of how many. Only a running row has them.
	Done, Of int
	Command  string
	ShotsDir string
	Reason   string
	Shots    int // how many screenshots this scenario took
	Started  int64
	// Ended is when an ended run ended (its last report), in ms; 0 for a run that has not.
	Ended int64
	// ChangedFile is, for an out-of-date row, the newest watched file that changed after the run.
	ChangedFile string
}

// Change is a watched file that differs from where the agent's branch started, and when it last changed (ms).
type Change struct {
	Path  string
	Mtime int64
}

// State is everything the cockpit and the merge gate need about one agent's Verify.
type State struct {
	// Rows is one row per scenario, worst first: failed, no result, running, out of date, passed, skipped, and
	// newest first within a kind.
	Rows []Row
	// Verdict is "" (nothing to say), running, passed, amber or red. Skipped rows and a skipped not-run warning
	// are left out of it: a skipped row counts as passed.
	Verdict string
	// NotRun is true when a watched file changed and the agent has run no scenario at all.
	NotRun bool
	// NotRunSkipped is true when the person set the not-run warning aside and nothing has changed since.
	NotRunSkipped bool
	// Changed is the warning's files, newest first: the watched files that changed after the newest run, or after
	// the newest skip when that is later (a skip sets a change aside); every changed file when nothing has run.
	Changed []string
	// Rerun is the project's rerun command from .arc/verify.json, e.g. "task verify:ui -- <name>".
	Rerun string
	// Branch and DefaultBranch are the checkout's branch and the project's default branch ("origin/" removed),
	// set by Store.State: the merge gate asks only when they are the same. Branch is "" on a detached HEAD.
	Branch, DefaultBranch string
}

// Derive judges one agent's stored runs. alive says whether a process id is still running; changed lists the
// watched files that differ from where the branch started. It reads nothing itself, so every state in the spec
// is a table test.
//
// A run that has not ended is running while its process lives and has no result once it is gone. An ended run
// with no checked step has no result, one with a failed step failed, else it passed; a passed run that ended
// before the newest watched change is out of date. A skip that is newer than both a row's run and the newest
// change sets that row aside; a newer change, or a new run, brings it back.
func Derive(bf BlockFile, alive func(pid int) bool, changed []Change, rerun string) State {
	st := State{Rerun: rerun}

	newest := newestFirst(changed)
	var newestChange Change
	if len(newest) > 0 {
		newestChange = newest[0]
	}

	for name, run := range bf.Runs {
		skipAt, skipped := bf.Skips[name]
		st.Rows = append(st.Rows, deriveRow(name, run, alive, newestChange, skipAt, skipped))
	}
	sortRows(st.Rows)

	// Which changes still want a run: the ones after every run and every skip.
	var covered int64
	for _, run := range bf.Runs {
		covered = max(covered, run.Updated)
	}
	for key, at := range bf.Skips {
		if _, ok := bf.Runs[key]; ok || key == "" {
			covered = max(covered, at)
		}
	}
	for _, c := range newest {
		if c.Mtime > covered {
			st.Changed = append(st.Changed, c.Path)
		}
	}

	if len(newest) > 0 && len(bf.Runs) == 0 {
		st.NotRun = true
		st.NotRunSkipped = bf.Skips[""] > newestChange.Mtime
	}

	st.Verdict = verdictOf(st)
	return st
}

func deriveRow(name string, run Run, alive func(pid int) bool, newest Change, skipAt int64, skipped bool) Row {
	var sc Scenario
	for _, s := range run.Scenarios {
		if s.Name == name {
			sc = s
			break
		}
	}
	row := Row{
		Scenario: name,
		Command:  run.Command,
		ShotsDir: run.ShotsDir,
		Reason:   run.Reason,
		Shots:    len(sc.Files),
		Started:  run.Started,
	}
	if run.Ended {
		row.Ended = run.Updated
	}
	for _, step := range sc.Steps {
		switch step.State {
		case StepFail:
			row.Total++
			row.Failed = append(row.Failed, step.Step)
		case StepPass:
			row.Total++
			row.Passed++
		}
	}

	switch {
	case !run.Ended && run.Pid > 0 && alive != nil && alive(run.Pid):
		row.State = StateRunning
		row.Of = len(run.Scenarios)
		for _, s := range run.Scenarios {
			if s.Done {
				row.Done++
			}
		}
	case !run.Ended, row.Total == 0:
		row.State = StateNoResult
	case len(row.Failed) > 0:
		row.State = StateFailed
	case newest.Mtime > row.Ended:
		row.State = StateOutOfDate
		row.ChangedFile = newest.Path
	default:
		row.State = StatePassed
	}

	switch row.State {
	case StateFailed, StateNoResult, StateOutOfDate:
		if skipped && skipAt > run.Updated && skipAt > newest.Mtime {
			row.State = StateSkipped
		}
	}
	return row
}

// newestFirst returns a copy of changed ordered by time, newest first, then by path.
func newestFirst(changed []Change) []Change {
	out := append([]Change(nil), changed...)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Mtime != out[j].Mtime {
			return out[i].Mtime > out[j].Mtime
		}
		return out[i].Path < out[j].Path
	})
	return out
}

var stateRank = map[string]int{
	StateFailed:    0,
	StateNoResult:  1,
	StateRunning:   2,
	StateOutOfDate: 3,
	StatePassed:    4,
	StateSkipped:   5,
}

func sortRows(rows []Row) {
	when := func(r Row) int64 {
		if r.Ended > 0 {
			return r.Ended
		}
		return r.Started
	}
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if stateRank[a.State] != stateRank[b.State] {
			return stateRank[a.State] < stateRank[b.State]
		}
		if when(a) != when(b) {
			return when(a) > when(b)
		}
		return a.Scenario < b.Scenario
	})
}

func verdictOf(st State) string {
	var failed, amber, running, any bool
	for _, row := range st.Rows {
		any = true
		switch row.State {
		case StateFailed:
			failed = true
		case StateNoResult, StateOutOfDate:
			amber = true
		case StateRunning:
			running = true
		}
	}
	switch {
	case failed:
		return VerdictRed
	case amber, st.NotRun && !st.NotRunSkipped:
		return VerdictAmber
	case running:
		return VerdictRunning
	case any:
		return VerdictPassed
	}
	return ""
}

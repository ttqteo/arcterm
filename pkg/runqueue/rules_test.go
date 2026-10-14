// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runqueue

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func mkRun(id, status string, mods ...func(*waveobj.Run)) *waveobj.Run {
	r := &waveobj.Run{ID: id, OID: id, Goal: "goal " + id, Status: status}
	for _, m := range mods {
		m(r)
	}
	return r
}

func withLand(state, reason string, dirty bool) func(*waveobj.Run) {
	return func(r *waveobj.Run) { r.Land = &waveobj.RunLand{State: state, Reason: reason, Dirty: dirty} }
}

func withGoal(goal string) func(*waveobj.Run) { return func(r *waveobj.Run) { r.Goal = goal } }

func runMap(runs ...*waveobj.Run) map[string]*waveobj.Run {
	m := map[string]*waveobj.Run{}
	for _, r := range runs {
		m[r.ID] = r
	}
	return m
}

func mkEntry(id, after string) wshrpc.RunQueueEntry {
	return wshrpc.RunQueueEntry{Id: id, After: after, Title: "plan " + id, State: wshrpc.RunQueueState_Waiting}
}

func blockedEntry(id, after, reason string) wshrpc.RunQueueEntry {
	e := mkEntry(id, after)
	e.State = wshrpc.RunQueueState_Blocked
	e.Reason = reason
	return e
}

// blockedOnRun is an entry blocked by the outcome of the run it waits After.
func blockedOnRun(id, after, reason string) wshrpc.RunQueueEntry {
	e := blockedEntry(id, after, reason)
	e.BlockedOn = after
	return e
}

func TestTopLevel(t *testing.T) {
	cases := []struct {
		name string
		mod  func(*waveobj.Run)
		want bool
	}{
		{"plain run", func(*waveobj.Run) {}, true},
		{"lead-spawned child", func(r *waveobj.Run) { r.ParentLeadORef = "tab:abc" }, false},
		{"task worker", func(r *waveobj.Run) { r.TaskId = "t-1" }, false},
		{"stage session", func(r *waveobj.Run) { r.StageRole = "verifier" }, false},
		{"task reviewer", func(r *waveobj.Run) { r.Review = true }, false},
	}
	for _, c := range cases {
		if got := TopLevel(mkRun("r", "executing", c.mod)); got != c.want {
			t.Errorf("%s: TopLevel = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestActive(t *testing.T) {
	runs := []*waveobj.Run{
		mkRun("planning", "planning"),
		mkRun("review", "awaiting-review"),
		mkRun("exec", "executing"),
		mkRun("blocked", "blocked"),
		mkRun("done", "done"),
		mkRun("done-held", "done", withLand("held", "conflict", false)),
		mkRun("cancelled", "cancelled"),
		mkRun("child", "executing", func(r *waveobj.Run) { r.ParentLeadORef = "tab:abc" }),
		mkRun("task", "executing", func(r *waveobj.Run) { r.TaskId = "t-1" }),
		mkRun("stage", "executing", func(r *waveobj.Run) { r.StageRole = "plan-reviewer" }),
		mkRun("reviewer", "executing", func(r *waveobj.Run) { r.Review = true }),
		nil,
	}
	if got := Active(runs); got != 4 {
		t.Errorf("Active = %d, want 4 (planning, awaiting-review, executing, blocked)", got)
	}
	if got := Active(nil); got != 0 {
		t.Errorf("Active(nil) = %d, want 0", got)
	}
}

func TestOutcome(t *testing.T) {
	cases := []struct {
		name       string
		run        *waveobj.Run
		final      bool
		landed     bool
		reason     string
		wantReason bool // whether reason is compared
	}{
		{"landed", mkRun("r", "done", withLand("landed", "", false)), true, true, "", true},
		{"held", mkRun("r", "done", withLand("held", "the final stage failed", false)), true, false, "the final stage failed", true},
		{"dirty hold lands by itself", mkRun("r", "done", withLand("held", "dirty checkout", true)), false, false, "", false},
		{"land pending", mkRun("r", "done", withLand("pending", "", false)), false, false, "", false},
		{"land queued behind another", mkRun("r", "done", withLand("queued", "", false)), false, false, "", false},
		{"land resolving a conflict", mkRun("r", "done", withLand("resolving", "", false)), false, false, "", false},
		{"done in the checkout", mkRun("r", "done"), true, true, "", true},
		{"done on a branch not yet landed", mkRun("r", "done", func(r *waveobj.Run) { r.LandPath = "/wt/wave-r" }), false, false, "", false},
		{"cancelled", mkRun("r", "cancelled"), true, false, "cancelled", true},
		{"running", mkRun("r", "executing"), false, false, "", false},
		{"planning", mkRun("r", "planning"), false, false, "", false},
		{"blocked mid-run", mkRun("r", "blocked"), false, false, "", false},
		{"nil", nil, false, false, "", false},
	}
	for _, c := range cases {
		final, landed, reason := Outcome(c.run)
		if final != c.final || landed != c.landed {
			t.Errorf("%s: Outcome = final %v landed %v, want final %v landed %v", c.name, final, landed, c.final, c.landed)
		}
		if c.wantReason && reason != c.reason {
			t.Errorf("%s: reason = %q, want %q", c.name, reason, c.reason)
		}
	}
}

func TestClampMaxActive(t *testing.T) {
	one, zero, neg := 1, 0, -2
	if got := ClampMaxActive(nil); got != 3 {
		t.Errorf("nil = %d, want the default 3", got)
	}
	if got := ClampMaxActive(&one); got != 1 {
		t.Errorf("1 = %d, want 1", got)
	}
	if got := ClampMaxActive(&zero); got != 0 {
		t.Errorf("0 = %d, want 0 (no cap)", got)
	}
	if got := ClampMaxActive(&neg); got != 0 {
		t.Errorf("-2 = %d, want 0", got)
	}
}

func execRuns(n int) []*waveobj.Run {
	var runs []*waveobj.Run
	for i := range n {
		runs = append(runs, mkRun("busy"+string(rune('a'+i)), "executing"))
	}
	return runs
}

func TestNext(t *testing.T) {
	landed := mkRun("landed", "done", withLand("landed", "", false), withGoal("Landed plan"))
	running := mkRun("running", "executing")
	held := mkRun("held", "done", withLand("held", "the final stage failed", false), withGoal("Learned additions"))
	dirty := mkRun("dirty", "done", withLand("held", "dirty checkout", true))
	cancelled := mkRun("cancelled", "cancelled", withGoal("Dropped plan"))
	checkout := mkRun("checkout", "done")

	cases := []struct {
		name      string
		entries   []wshrpc.RunQueueEntry
		runs      []*waveobj.Run
		maxActive int
		start     string
		block     map[string]string // entry id → reason
		blockOn   map[string]string // entry id → BlockedOn; an id left out must have none
		unblock   []string
	}{
		{
			name:      "under the cap starts the head",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", ""), mkEntry("q-b", "")},
			runs:      execRuns(2),
			maxActive: 3,
			start:     "q-a",
		},
		{
			name:      "cap reached starts nothing",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "")},
			runs:      execRuns(3),
			maxActive: 3,
			start:     "",
		},
		{
			name:      "no cap when maxActive is 0",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "")},
			runs:      execRuns(10),
			maxActive: 0,
			start:     "q-a",
		},
		{
			name:      "children do not count against the cap",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "")},
			runs:      append(execRuns(1), mkRun("t1", "executing", func(r *waveobj.Run) { r.TaskId = "t-1" }), mkRun("t2", "executing", func(r *waveobj.Run) { r.Review = true })),
			maxActive: 2,
			start:     "q-a",
		},
		{
			name:      "a done run with a held land holds no agents",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "")},
			runs:      []*waveobj.Run{held, dirty, running},
			maxActive: 2,
			start:     "q-a",
		},
		{
			name:      "after a landed run starts",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "landed")},
			runs:      []*waveobj.Run{landed},
			maxActive: 3,
			start:     "q-a",
		},
		{
			name:      "after a run done in the checkout starts",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "checkout")},
			runs:      []*waveobj.Run{checkout},
			maxActive: 3,
			start:     "q-a",
		},
		{
			name:      "after a landed run still waits for room",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "landed")},
			runs:      append(execRuns(3), landed),
			maxActive: 3,
			start:     "",
		},
		{
			name:      "after a running run is skipped and the next entry starts",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "running"), mkEntry("q-b", "")},
			runs:      []*waveobj.Run{running},
			maxActive: 3,
			start:     "q-b",
		},
		{
			name:      "after a held run is blocked with the hold's reason",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "held"), mkEntry("q-b", "")},
			runs:      []*waveobj.Run{held},
			maxActive: 3,
			start:     "q-b",
			block:     map[string]string{"q-a": "Learned additions was held: the final stage failed"},
			blockOn:   map[string]string{"q-a": "held"},
		},
		{
			name:      "after a dirty hold keeps waiting",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "dirty"), mkEntry("q-b", "")},
			runs:      []*waveobj.Run{dirty},
			maxActive: 3,
			start:     "q-b",
		},
		{
			name:      "after a cancelled run is blocked",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "cancelled")},
			runs:      []*waveobj.Run{cancelled},
			maxActive: 3,
			start:     "",
			block:     map[string]string{"q-a": "Dropped plan was cancelled"},
			blockOn:   map[string]string{"q-a": "cancelled"},
		},
		{
			name:      "after a queue entry is never ready",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-b", "q-a"), mkEntry("q-a", "running")},
			runs:      []*waveobj.Run{running},
			maxActive: 3,
			start:     "",
		},
		{
			name:      "after a queue entry does not hold up the entry behind it",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-b", "q-a"), mkEntry("q-a", ""), mkEntry("q-c", "")},
			maxActive: 3,
			start:     "q-a",
		},
		{
			name:      "after an unknown id is blocked",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "gone"), mkEntry("q-b", "")},
			maxActive: 3,
			start:     "q-b",
			block:     map[string]string{"q-a": "gone is not a run or a queued entry"},
		},
		{
			name:      "a blocked entry ahead is skipped and not blocked again",
			entries:   []wshrpc.RunQueueEntry{blockedEntry("q-a", "held", "kept"), mkEntry("q-b", "")},
			runs:      []*waveobj.Run{held},
			maxActive: 3,
			start:     "q-b",
		},
		{
			name:      "an entry blocked on a run that has landed since is unblocked",
			entries:   []wshrpc.RunQueueEntry{blockedOnRun("q-a", "landed", "Landed plan was held"), mkEntry("q-b", "")},
			runs:      []*waveobj.Run{landed},
			maxActive: 3,
			start:     "q-b", // q-a waits again; the caller evaluates once more to start it
			unblock:   []string{"q-a"},
		},
		{
			name:      "an entry blocked on a run done in the checkout is unblocked",
			entries:   []wshrpc.RunQueueEntry{blockedOnRun("q-a", "checkout", "kept")},
			runs:      []*waveobj.Run{checkout},
			maxActive: 3,
			unblock:   []string{"q-a"},
		},
		{
			name:      "an entry blocked on a run that is still held stays blocked",
			entries:   []wshrpc.RunQueueEntry{blockedOnRun("q-a", "held", "kept")},
			runs:      []*waveobj.Run{held},
			maxActive: 3,
		},
		{
			name:      "an entry blocked on a run whose land is queued or resolving stays blocked",
			entries:   []wshrpc.RunQueueEntry{blockedOnRun("q-a", "queued", "kept"), blockedOnRun("q-b", "resolving", "kept")},
			runs:      []*waveobj.Run{mkRun("queued", "done", withLand("queued", "", false)), mkRun("resolving", "done", withLand("resolving", "", false))},
			maxActive: 3,
		},
		{
			name:      "an entry blocked on a run that was cancelled stays blocked",
			entries:   []wshrpc.RunQueueEntry{blockedOnRun("q-a", "cancelled", "kept")},
			runs:      []*waveobj.Run{cancelled},
			maxActive: 3,
		},
		{
			name:      "an entry blocked on a run that cannot be read stays blocked",
			entries:   []wshrpc.RunQueueEntry{blockedOnRun("q-a", "gone", "kept")},
			maxActive: 3,
		},
		{
			// a start that failed, a plan that is gone or an entry that was removed has no BlockedOn: unblocking it
			// would start it, fail it and block it again on every pass
			name:      "an entry blocked for another reason is not unblocked when its After run landed",
			entries:   []wshrpc.RunQueueEntry{blockedEntry("q-a", "landed", "route unavailable")},
			runs:      []*waveobj.Run{landed},
			maxActive: 3,
		},
		{
			name:      "an unblocked entry is not also blocked again",
			entries:   []wshrpc.RunQueueEntry{blockedOnRun("q-a", "landed", "kept")},
			runs:      []*waveobj.Run{landed},
			maxActive: 3,
			unblock:   []string{"q-a"},
		},
		{
			name:      "a run's title falls back to its id",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "bare")},
			runs:      []*waveobj.Run{mkRun("bare", "cancelled", withGoal(""))},
			maxActive: 3,
			block:     map[string]string{"q-a": "bare was cancelled"},
			blockOn:   map[string]string{"q-a": "bare"},
		},
		{
			name:      "a run's title is its goal's first line",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "multi")},
			runs:      []*waveobj.Run{mkRun("multi", "cancelled", withGoal("  First line  \nsecond line"))},
			maxActive: 3,
			block:     map[string]string{"q-a": "First line was cancelled"},
			blockOn:   map[string]string{"q-a": "multi"},
		},
		{
			name:      "a hold with no reason is named plainly",
			entries:   []wshrpc.RunQueueEntry{mkEntry("q-a", "bare")},
			runs:      []*waveobj.Run{mkRun("bare", "done", withLand("held", "", false), withGoal("Bare"))},
			maxActive: 3,
			block:     map[string]string{"q-a": "Bare was held"},
			blockOn:   map[string]string{"q-a": "bare"},
		},
		{
			name:      "an empty queue starts nothing",
			maxActive: 3,
			start:     "",
		},
	}
	for _, c := range cases {
		start, block, unblock := Next(c.entries, runMap(c.runs...), c.maxActive)
		if start != c.start {
			t.Errorf("%s: start = %q, want %q", c.name, start, c.start)
		}
		if len(unblock) != len(c.unblock) {
			t.Errorf("%s: unblock = %v, want %v", c.name, unblock, c.unblock)
		} else {
			for i, id := range c.unblock {
				if unblock[i] != id {
					t.Errorf("%s: unblock = %v, want %v", c.name, unblock, c.unblock)
					break
				}
			}
		}
		if len(block) != len(c.block) {
			t.Errorf("%s: block = %v, want %v", c.name, block, c.block)
			continue
		}
		for id, reason := range c.block {
			if block[id].Reason != reason {
				t.Errorf("%s: block[%s].Reason = %q, want %q", c.name, id, block[id].Reason, reason)
			}
			if block[id].On != c.blockOn[id] {
				t.Errorf("%s: block[%s].On = %q, want %q", c.name, id, block[id].On, c.blockOn[id])
			}
		}
	}
}

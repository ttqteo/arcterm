package jobqueue

import (
	"context"
	"slices"
	"testing"
	"time"
)

// TestPlanProtect covers spec 2026-11-23-protect-job-design.md: Protect goes first, waits for running heavy jobs, then
// holds every other heavy job back (engine steps included), whatever the mode; Run now and NoCPU calls pass it.
func TestPlanProtect(t *testing.T) {
	old := t0.Add(-2 * RampUp)
	run := func(id string) Job {
		return Job{Id: id, Request: Request{Name: id, Bytes: gb}, Running: true, StartedAt: old}
	}
	wait := func(id string) Job { return Job{Id: id, Request: Request{Name: id, Bytes: gb}} }
	protect := func(id string, running bool) Job {
		j := Job{Id: id, Request: Request{Name: id, Bytes: gb, Protect: true}, Running: running}
		if running {
			j.StartedAt = old
		}
		return j
	}
	engine := Job{Id: "verify", Request: Request{Name: "verify", Bytes: gb, Engine: true}}
	seat := Job{Id: "seat", Request: Request{Name: "seat", Bytes: gb, NoCPU: true}}
	seatRunning := Job{Id: "seatr", Request: Request{Name: "seatr", Bytes: gb, NoCPU: true}, Running: true, StartedAt: old}
	forced := Job{Id: "f", Request: Request{Name: "f", Bytes: gb}, Forced: true}
	cases := []struct {
		name   string
		jobs   []Job
		mode   string
		start  []string
		reason string
	}{
		{"protect starts at once on an idle machine", []Job{protect("p", false), wait("a")}, ModeAuto, []string{"p"}, "protected: p is running"},
		{"protect waits for the running heavy jobs", []Job{run("r1"), run("r2"), protect("p", false), wait("a")}, ModeAuto, nil, "protected: p waits for 2 running jobs to finish"},
		{"protect waits with the queue off too", []Job{run("r"), protect("p", false), wait("a")}, ModeOff, nil, "protected: p waits for 1 running job to finish"},
		{"protect does not wait for a NoCPU call", []Job{seatRunning, protect("p", false)}, ModeSlots, []string{"p"}, ""},
		{"a running protect holds heavy jobs, engine steps included", []Job{protect("p", true), engine, wait("a")}, ModeAuto, nil, "protected: p is running"},
		{"a running protect holds even with the queue off", []Job{protect("p", true), wait("a")}, ModeOff, nil, "protected: p is running"},
		{"a second protect waits behind the first", []Job{protect("p", true), protect("p2", false)}, ModeAuto, nil, "protected: p is running"},
		{"run now passes a running protect", []Job{protect("p", true), forced, wait("a")}, ModeAuto, []string{"f"}, "protected: p is running"},
		{"a NoCPU call passes a running protect", []Job{protect("p", true), wait("a"), seat}, ModeAuto, []string{"seat"}, "protected: p is running"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			start, reason := plan(c.jobs, 1, manyCPUs, c.mode, 64*gb, PressureUnknown, t0)
			if !slices.Equal(start, c.start) {
				t.Fatalf("start = %v, want %v", start, c.start)
			}
			if reason != c.reason {
				t.Fatalf("reason = %q, want %q", reason, c.reason)
			}
		})
	}
}

// a Protect request is queued ahead of every job already waiting, behind an earlier Protect
func TestProtectGoesFirst(t *testing.T) {
	q := newTestQueue(1)
	ctx := context.Background()
	held, _ := q.Acquire(ctx, Request{Name: "held", Bytes: gb}, nil)
	queue := func(req Request) chan *Slot {
		got := make(chan *Slot, 1)
		n := len(q.Snapshot().Jobs)
		go func() { s, _ := q.Acquire(ctx, req, nil); got <- s }()
		waitFor(t, func() bool { return len(q.Snapshot().Jobs) == n+1 })
		return got
	}
	a := queue(Request{Name: "a", Bytes: gb})
	b := queue(Request{Name: "b", Bytes: gb, Engine: true})
	p1 := queue(Request{Name: "p1", Protect: true})
	p2 := queue(Request{Name: "p2", Protect: true})
	var names []string
	for _, j := range q.Snapshot().Jobs {
		names = append(names, j.Name)
	}
	if want := []string{"held", "p1", "p2", "a", "b"}; !slices.Equal(names, want) {
		t.Fatalf("order = %v, want %v", names, want)
	}
	if r := q.Snapshot().Jobs[1].Reason; r != "protected: p1 waits for 1 running job to finish" {
		t.Fatalf("reason = %q", r)
	}
	held.Release()
	s1 := <-p1
	// p1 runs: the rest wait on it, the second Protect included
	for _, ch := range []chan *Slot{p2, a, b} {
		select {
		case <-ch:
			t.Fatal("a job started beside a running Protect")
		case <-time.After(30 * time.Millisecond):
		}
	}
	for _, j := range q.Snapshot().Jobs[1:] {
		if j.Reason != "protected: p1 is running" {
			t.Fatalf("%s waits on %q", j.Name, j.Reason)
		}
	}
	s1.Release()
	(<-p2).Release()
	(<-a).Release()
	(<-b).Release()
}

// MaxHold never reclaims a Protect slot: it is held until its process exits
func TestReclaimKeepsAProtectSlot(t *testing.T) {
	now := t0
	q := New(Config{
		Slots:     func() int { return 1 },
		Available: func(context.Context) (uint64, error) { return 64 * gb, nil },
		Now:       func() time.Time { return now },
	})
	slot, err := q.Acquire(context.Background(), Request{Name: "p", Protect: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(3 * MaxHold)
	q.Reclaim()
	select {
	case <-slot.Reclaimed():
		t.Fatal("a Protect slot was reclaimed")
	default:
	}
	if n := len(q.Snapshot().Jobs); n != 1 {
		t.Fatalf("%d jobs, want the Protect job", n)
	}
	slot.Release()
}

// while a Protect job is queued or running, Off is false whatever jobs:mode and jobs:pauseuntil say
func TestOffIsFalseWhileProtecting(t *testing.T) {
	old := Default
	defer func() { Default = old }()
	Default = New(Config{Mode: func() string { return ModeOff }})
	if !Off() {
		t.Fatal("jobs:mode off is off")
	}
	slot, err := Default.Acquire(context.Background(), Request{Name: "p", Protect: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if Off() {
		t.Fatal("off while a Protect job runs")
	}
	slot.Release()
	if !Off() {
		t.Fatal("off came back once the Protect job ended")
	}
}

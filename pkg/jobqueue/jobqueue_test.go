package jobqueue

import (
	"context"
	"errors"
	"testing"
	"time"
)

const gb = uint64(1) << 30

var t0 = time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)

func TestPlan(t *testing.T) {
	run := func(id string, bytes uint64, started time.Time) Job {
		return Job{Id: id, Request: Request{Name: id, Bytes: bytes}, Running: true, StartedAt: started}
	}
	wait := func(id string, bytes uint64) Job { return Job{Id: id, Request: Request{Name: id, Bytes: bytes}} }
	old := t0.Add(-2 * RampUp)
	cases := []struct {
		name      string
		jobs      []Job
		slots     int
		available uint64
		start     []string
		reason    string
	}{
		{"empty", nil, 1, 8 * gb, nil, ""},
		{"head starts on a free slot", []Job{wait("a", gb)}, 1, 8 * gb, []string{"a"}, ""},
		{"slot busy", []Job{run("r", gb, old), wait("a", gb)}, 1, 8 * gb, nil, "slot busy"},
		{"two slots start two", []Job{wait("a", gb), wait("b", gb)}, 2, 8 * gb, []string{"a", "b"}, ""},
		{"RAM short", []Job{wait("a", 3*gb)}, 1, 2 * gb, nil, "needs 3 GB, 2 GB free"},
		{"no overtaking", []Job{wait("big", 6*gb), wait("small", gb)}, 2, 4 * gb, nil, "needs 6 GB, 4 GB free"},
		{"a ramping job counts its peak", []Job{run("r", 3*gb, t0), wait("a", 3*gb)}, 2, 6 * gb, nil, "needs 3 GB, 3 GB free"},
		{"a ramped job does not", []Job{run("r", 3*gb, old), wait("a", 3*gb)}, 2, 6 * gb, []string{"a"}, ""},
		{"forced starts past both gates", []Job{run("r", gb, old), {Id: "f", Request: Request{Name: "f", Bytes: 9 * gb}, Forced: true}}, 1, gb, []string{"f"}, ""},
		{"a forced start holds its slot against the next", []Job{{Id: "f", Request: Request{Name: "f", Bytes: gb}, Forced: true}, wait("a", gb)}, 1, 8 * gb, []string{"f"}, "slot busy"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			start, reason := plan(c.jobs, c.slots, c.available, t0)
			if len(start) != len(c.start) {
				t.Fatalf("start = %v, want %v", start, c.start)
			}
			for i := range start {
				if start[i] != c.start[i] {
					t.Fatalf("start = %v, want %v", start, c.start)
				}
			}
			if reason != c.reason {
				t.Fatalf("reason = %q, want %q", reason, c.reason)
			}
		})
	}
}

func newTestQueue(slots int) *Queue {
	return New(Config{
		Slots:     func() int { return slots },
		Available: func(context.Context) (uint64, error) { return 64 * gb, nil },
	})
}

func TestAcquireIsFIFOOneAtATime(t *testing.T) {
	q := newTestQueue(1)
	ctx := context.Background()
	first, err := q.Acquire(ctx, Request{Name: "a", Bytes: gb, Engine: true, Source: Source{RunId: "700db4a1-xx", Label: "Verify"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	waits := make(chan Wait, 4)
	got := make(chan *Slot, 1)
	go func() {
		s, _ := q.Acquire(ctx, Request{Name: "b", Bytes: gb}, func(w Wait) { waits <- w })
		got <- s
	}()
	w := <-waits
	if w.Position != 1 || w.Behind != "a" || w.For != "run 700db4" || w.Reason != "slot busy" {
		t.Fatalf("wait = %+v", w)
	}
	select {
	case <-got:
		t.Fatal("b started while a held the only slot")
	case <-time.After(50 * time.Millisecond):
	}
	first.Release()
	select {
	case s := <-got:
		s.Release()
	case <-time.After(time.Second):
		t.Fatal("b never started after a released")
	}
	if n := len(q.Snapshot().Jobs); n != 0 {
		t.Fatalf("%d jobs left", n)
	}
}

func TestSkipAndRunNow(t *testing.T) {
	q := newTestQueue(1)
	ctx := context.Background()
	held, _ := q.Acquire(ctx, Request{Name: "a", Bytes: gb}, nil)
	defer held.Release()
	errs := make(chan error, 2)
	ids := make(chan string, 2)
	for i, name := range []string{"b", "c"} {
		go func() {
			s, err := q.Acquire(ctx, Request{Name: name, Bytes: gb}, func(w Wait) {})
			if s != nil {
				ids <- name
				s.Release()
			}
			errs <- err
		}()
		// one at a time, so b is queued ahead of c
		waitFor(t, func() bool { return len(q.Snapshot().Jobs) == 2+i })
	}
	jobs := q.Snapshot().Jobs
	if !q.Skip(jobs[1].Id) || !q.RunNow(jobs[2].Id) {
		t.Fatal("skip or run now refused a queued job")
	}
	e1, e2 := <-errs, <-errs
	if !errors.Is(e1, ErrSkipped) && !errors.Is(e2, ErrSkipped) {
		t.Fatalf("errs = %v, %v; want one ErrSkipped", e1, e2)
	}
	if name := <-ids; name != "c" {
		t.Fatalf("started %q, want c", name)
	}
}

func TestSkipRefusesEngineAndRunning(t *testing.T) {
	q := newTestQueue(1)
	held, _ := q.Acquire(context.Background(), Request{Name: "a", Bytes: gb}, nil)
	defer held.Release()
	go q.Acquire(context.Background(), Request{Name: "v", Bytes: gb, Engine: true}, nil)
	waitFor(t, func() bool { return len(q.Snapshot().Jobs) == 2 })
	jobs := q.Snapshot().Jobs
	if q.Skip(jobs[0].Id) || q.Skip(jobs[1].Id) {
		t.Fatal("skipped a running job or an engine job")
	}
}

func TestCancelledWaiterLeaves(t *testing.T) {
	q := newTestQueue(1)
	held, _ := q.Acquire(context.Background(), Request{Name: "a", Bytes: gb}, nil)
	defer held.Release()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := q.Acquire(ctx, Request{Name: "b", Bytes: gb}, nil); done <- err }()
	waitFor(t, func() bool { return len(q.Snapshot().Jobs) == 2 })
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if n := len(q.Snapshot().Jobs); n != 1 {
		t.Fatalf("%d jobs, want 1", n)
	}
}

func TestReclaimFreesAnAgentSlotHeldTooLong(t *testing.T) {
	now := t0
	q := New(Config{
		Slots:     func() int { return 1 },
		Available: func(context.Context) (uint64, error) { return 64 * gb, nil },
		Now:       func() time.Time { return now },
	})
	engine, _ := q.Acquire(context.Background(), Request{Name: "v", Bytes: gb, Engine: true}, nil)
	agentCh := make(chan *Slot, 1)
	go func() { s, _ := q.Acquire(context.Background(), Request{Name: "a", Bytes: gb}, nil); agentCh <- s }()
	waitFor(t, func() bool { return len(q.Snapshot().Jobs) == 2 })
	q.RunNow(q.Snapshot().Jobs[1].Id)
	agent := <-agentCh
	now = now.Add(MaxHold + time.Second)
	q.Reclaim()
	select {
	case <-agent.Reclaimed():
	default:
		t.Fatal("agent slot not reclaimed")
	}
	select {
	case <-engine.Reclaimed():
		t.Fatal("engine slot reclaimed")
	default:
	}
	if n := len(q.Snapshot().Jobs); n != 1 {
		t.Fatalf("%d jobs, want the engine's alone", n)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition never held")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

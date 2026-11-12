package jobqueue

import (
	"context"
	"errors"
	"slices"
	"sync/atomic"
	"testing"
	"time"
)

const gb = uint64(1) << 30

var t0 = time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)

// manyCPUs leaves Auto's CPU cap (four at once) out of the cases that test the RAM, the pressure and the slots
const manyCPUs = 24

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
			start, reason := plan(c.jobs, c.slots, manyCPUs, ModeSlots, c.available, PressureUnknown, t0)
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

func TestPlanModes(t *testing.T) {
	run := func(id string, bytes uint64, started time.Time) Job {
		return Job{Id: id, Request: Request{Name: id, Bytes: bytes}, Running: true, StartedAt: started}
	}
	wait := func(id string, bytes uint64) Job { return Job{Id: id, Request: Request{Name: id, Bytes: bytes}} }
	old := t0.Add(-2 * RampUp)
	cases := []struct {
		name      string
		jobs      []Job
		mode      string
		available uint64
		start     []string
		reason    string
	}{
		{"auto starts past a full slot count", []Job{run("r", gb, old), wait("a", gb), wait("b", gb)}, ModeAuto, 8 * gb, []string{"a", "b"}, ""},
		{"auto still waits on RAM", []Job{run("r", gb, old), wait("a", 3*gb)}, ModeAuto, 2 * gb, nil, "needs 3 GB, 2 GB free"},
		{"auto counts a ramping job's peak", []Job{run("r", 3*gb, t0), wait("a", 3*gb)}, ModeAuto, 6 * gb, nil, "needs 3 GB, 3 GB free"},
		{"off starts every job, whatever runs and whatever RAM is free", []Job{run("r", gb, old), wait("a", 9*gb), wait("b", gb)}, ModeOff, gb, []string{"a", "b"}, ""},
		{"auto runs one e2e at a time though the RAM fits two", []Job{run("e2e script", 4*gb, old), wait("smoke script", gb)}, ModeAuto, 24 * gb, nil, ReasonBrowserRunBusy},
		{"auto starts one of two queued e2e runs, and the rest wait behind", []Job{wait("e2e script", 4*gb), wait("e2e script", 4*gb), wait("b", gb)}, ModeAuto, 24 * gb, []string{"e2e script"}, ReasonBrowserRunBusy},
		{"auto starts other work beside an e2e run", []Job{run("e2e script", 4*gb, old), wait("vitest (all)", 2*gb)}, ModeAuto, 24 * gb, []string{"vitest (all)"}, ""},
		{"off starts e2e runs side by side", []Job{run("e2e script", 4*gb, old), wait("smoke script", gb)}, ModeOff, gb, []string{"smoke script"}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// one slot throughout: neither mode reads it
			start, reason := plan(c.jobs, 1, manyCPUs, c.mode, c.available, PressureUnknown, t0)
			if !slices.Equal(start, c.start) {
				t.Fatalf("start = %v, want %v", start, c.start)
			}
			if reason != c.reason {
				t.Fatalf("reason = %q, want %q", reason, c.reason)
			}
		})
	}
}

// Auto runs at most one heavy job per CPUsPerJob CPUs: on a 12-thread Windows box with 9-19 GB free it started 3-4
// typechecks and verifies within minutes and the machine lagged (2026-11-11); the RAM never ran short there.
func TestPlanAutoCapsByCPU(t *testing.T) {
	run := func(id string, bytes uint64, started time.Time) Job {
		return Job{Id: id, Request: Request{Name: id, Bytes: bytes}, Running: true, StartedAt: started}
	}
	wait := func(id string, bytes uint64) Job { return Job{Id: id, Request: Request{Name: id, Bytes: bytes}} }
	council := func(j Job) Job { j.NoCPU = true; return j }
	old := t0.Add(-2 * RampUp)
	cases := []struct {
		name   string
		jobs   []Job
		cpus   int
		mode   string
		start  []string
		reason string
	}{
		{"12 CPUs run two at once though the RAM fits more", []Job{wait("a", 3*gb), wait("b", 3*gb), wait("c", 3*gb)}, 12, ModeAuto, []string{"a", "b"}, "CPU busy, 2 at a time"},
		{"12 CPUs: a third waits beside two running", []Job{run("r", 3*gb, old), run("s", 3*gb, old), wait("a", gb)}, 12, ModeAuto, nil, "CPU busy, 2 at a time"},
		{"8 CPUs run one at a time", []Job{run("r", 3*gb, old), wait("a", gb)}, 8, ModeAuto, nil, "CPU busy, 1 at a time"},
		{"few CPUs still start one", []Job{wait("a", gb), wait("b", gb)}, 4, ModeAuto, []string{"a"}, "CPU busy, 1 at a time"},
		{"no CPU reading still starts one", []Job{wait("a", gb), wait("b", gb)}, 0, ModeAuto, []string{"a"}, "CPU busy, 1 at a time"},
		{"24 CPUs run four", []Job{wait("a", gb), wait("b", gb), wait("c", gb), wait("d", gb), wait("e", gb)}, 24, ModeAuto, []string{"a", "b", "c", "d"}, "CPU busy, 4 at a time"},
		{"a council call waits on the network, not the CPU: it starts beside a full cap", []Job{run("r", 3*gb, old), council(wait("c", gb))}, 8, ModeAuto, []string{"c"}, ""},
		{"and running ones leave the cap to heavy jobs", []Job{council(run("c1", gb, old)), council(run("c2", gb, old)), wait("a", 3*gb)}, 8, ModeAuto, []string{"a"}, ""},
		{"the cap still keeps the queue in order", []Job{run("r", 3*gb, old), wait("a", gb), council(wait("c", gb))}, 8, ModeAuto, nil, "CPU busy, 1 at a time"},
		{"slots mode counts the slots, not the CPUs", []Job{wait("a", gb), wait("b", gb), wait("c", gb)}, 4, ModeSlots, []string{"a", "b", "c"}, ""},
		{"off starts every job", []Job{run("r", gb, old), wait("a", gb)}, 4, ModeOff, []string{"a"}, ""},
		{"run now starts past the cap", []Job{run("r", gb, old), {Id: "f", Request: Request{Name: "f", Bytes: gb}, Forced: true}}, 8, ModeAuto, []string{"f"}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			start, reason := plan(c.jobs, 3, c.cpus, c.mode, 64*gb, PressureUnknown, t0)
			if !slices.Equal(start, c.start) {
				t.Fatalf("start = %v, want %v", start, c.start)
			}
			if reason != c.reason {
				t.Fatalf("reason = %q, want %q", reason, c.reason)
			}
		})
	}
}

// The queue reads the CPU count it caps Auto by from its Config, the machine's own when none is given.
func TestAutoReadsTheCPUCount(t *testing.T) {
	q := New(Config{Mode: func() string { return ModeAuto }, CPUs: func() int { return 6 }})
	first, err := q.Acquire(context.Background(), Request{Name: "a", Bytes: gb}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	got := make(chan Wait, 4)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		if s, err := q.Acquire(ctx, Request{Name: "b", Bytes: gb}, func(w Wait) { got <- w }); err == nil {
			s.Release()
		}
	}()
	select {
	case w := <-got:
		if w.Position != 1 || w.Reason != "CPU busy, 1 at a time" {
			t.Fatalf("the second job's place = %+v, want #1 waiting on the CPU", w)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the second job started beside the first on 6 CPUs")
	}
	if n := New(Config{}).cpus(); n < 1 {
		t.Fatalf("an unset CPU count reads %d, want the machine's", n)
	}
}

// Where the OS reads its own memory pressure (macOS), the pressure decides instead of the free-RAM count, which leaves
// out the compressor and swap: these cases all have far too little "free" RAM for the free-RAM rule.
func TestPlanPressure(t *testing.T) {
	run := func(id string, bytes uint64, started time.Time) Job {
		return Job{Id: id, Request: Request{Name: id, Bytes: bytes}, Running: true, StartedAt: started}
	}
	wait := func(id string, bytes uint64) Job { return Job{Id: id, Request: Request{Name: id, Bytes: bytes}} }
	old := t0.Add(-2 * RampUp)
	// macOS's free count reads low on a machine that runs fine: the pressure decides
	low := uint64(512 << 20)
	cases := []struct {
		name      string
		jobs      []Job
		mode      string
		pressure  Pressure
		available uint64
		start     []string
		reason    string
	}{
		{"normal starts the head whatever the free count", []Job{wait("a", 3*gb)}, ModeAuto, PressureNormal, low, []string{"a"}, ""},
		{"normal starts no second job beside one ramping up when the RAM is short", []Job{wait("a", 3*gb), wait("b", 3*gb)}, ModeAuto, PressureNormal, low, []string{"a"}, "needs 3 GB, 0 GB free"},
		{"normal waits while a job ramps up and the RAM is short", []Job{run("r", 3*gb, t0), wait("a", 3*gb)}, ModeAuto, PressureNormal, low, nil, "needs 3 GB, 0 GB free"},
		{"normal starts beside a job ramping up when the RAM fits both", []Job{run("r", 3*gb, t0), wait("a", 3*gb)}, ModeAuto, PressureNormal, 8 * gb, []string{"a"}, ""},
		{"normal starts once the last start has ramped", []Job{run("r", 3*gb, old), wait("a", 3*gb)}, ModeAuto, PressureNormal, low, []string{"a"}, ""},
		{"warn starts one at a time", []Job{wait("a", 3*gb), wait("b", 3*gb)}, ModeAuto, PressureWarn, low, []string{"a"}, ReasonPressureHigh},
		{"warn waits while a job ramps up", []Job{run("r", gb, t0), wait("a", gb)}, ModeAuto, PressureWarn, low, nil, ReasonPressureHigh},
		// 2026-10-15: on an 8 GB Mac a third typecheck started a minute after the second, under warn, and the
		// three paged for 15 minutes
		{"warn waits while a job runs past its ramp-up", []Job{run("r", gb, old), wait("a", gb)}, ModeAuto, PressureWarn, 8 * gb, nil, ReasonPressureHigh},
		// 2026-11-04: critical starting nothing held every agent's e2e until the person paused the queue, which
		// then started them all at once
		{"critical starts one once nothing runs", []Job{wait("a", gb), wait("b", gb)}, ModeAuto, PressureCritical, low, []string{"a"}, ReasonPressureCritical},
		{"critical waits while a job runs", []Job{run("r", gb, old), wait("a", gb)}, ModeAuto, PressureCritical, 8 * gb, nil, ReasonPressureCritical},
		{"the slot count still caps", []Job{run("r", gb, old), wait("a", gb)}, ModeSlots, PressureNormal, low, nil, "slot busy"},
		{"off starts past critical", []Job{wait("a", gb)}, ModeOff, PressureCritical, low, []string{"a"}, ""},
		{"forced starts past critical", []Job{{Id: "f", Request: Request{Name: "f", Bytes: gb}, Forced: true}}, ModeAuto, PressureCritical, low, []string{"f"}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			start, reason := plan(c.jobs, 1, manyCPUs, c.mode, c.available, c.pressure, t0)
			if !slices.Equal(start, c.start) {
				t.Fatalf("start = %v, want %v", start, c.start)
			}
			if reason != c.reason {
				t.Fatalf("reason = %q, want %q", reason, c.reason)
			}
		})
	}
}

func TestPressureFromLevel(t *testing.T) {
	// kern.memorystatus_vm_pressure_level: 1 normal, 2 warn, 4 critical; anything else is no reading
	for level, want := range map[uint32]Pressure{0: PressureUnknown, 1: PressureNormal, 2: PressureWarn, 3: PressureUnknown, 4: PressureCritical} {
		if got := PressureFromLevel(level); got != want {
			t.Errorf("PressureFromLevel(%d) = %v, want %v", level, got, want)
		}
	}
}

func TestPressureFromCommit(t *testing.T) {
	cases := []struct {
		name                    string
		commit, phys, availPhys uint64
		want                    Pressure
	}{
		{"commit under the RAM: the free-RAM rule decides", 20 * gb, 32 * gb, 12 * gb, PressureUnknown},
		// a pagefile lets Windows commit past the RAM without paging: only RAM running out is pressure
		{"commit at the RAM, a quarter free", 32 * gb, 32 * gb, 8 * gb, PressureUnknown},
		{"well past the RAM but RAM still free", 46 * gb, 32 * gb, 10 * gb, PressureUnknown},
		{"past the RAM and under a tenth free: the machine pages", 36 * gb, 32 * gb, 3 * gb, PressureWarn},
		// 2026-10-14: 46 GB committed on 32 GB, 5.2 GB free, paging to a hard disk until Postgres stalled
		{"well past the RAM and little left", 46 * gb, 32 * gb, 5 * gb, PressureCritical},
		{"little RAM left but commit under 130%", 40 * gb, 32 * gb, 2 * gb, PressureWarn},
		{"no reading", 0, 0, 0, PressureUnknown},
	}
	for _, tc := range cases {
		if got := PressureFromCommit(tc.commit, tc.phys, tc.availPhys); got != tc.want {
			t.Errorf("%s: PressureFromCommit(%d, %d, %d) = %v, want %v", tc.name, tc.commit, tc.phys, tc.availPhys, got, tc.want)
		}
	}
}

func TestPauseStartsEveryJobUntilItEnds(t *testing.T) {
	var until atomic.Value
	until.Store(time.Now().Add(time.Hour))
	q := New(Config{
		PausedUntil: func() time.Time { return until.Load().(time.Time) },
		// no RAM at all: only the pause lets a job start
		Available: func(context.Context) (uint64, error) { return 0, nil },
	})
	ctx := context.Background()
	a, err := q.Acquire(ctx, Request{Name: "a", Bytes: gb}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Release()
	if p := q.Snapshot().PausedUntil; !p.Equal(until.Load().(time.Time)) {
		t.Fatalf("snapshot paused until %v, want %v", p, until.Load())
	}
	until.Store(time.Now().Add(-time.Second))
	q.evaluate(ctx)
	if p := q.Snapshot().PausedUntil; !p.IsZero() {
		t.Fatalf("an ended pause still shows: %v", p)
	}
	got := make(chan *Slot, 1)
	go func() { s, _ := q.Acquire(ctx, Request{Name: "b", Bytes: gb}, nil); got <- s }()
	waitFor(t, func() bool { return len(q.Snapshot().Jobs) == 2 })
	select {
	case <-got:
		t.Fatal("b started with no RAM after the pause ended")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestNormMode(t *testing.T) {
	for in, want := range map[string]string{"": ModeAuto, "slots": ModeSlots, "auto": ModeAuto, "off": ModeOff, "fast": ModeAuto} {
		if got := NormMode(in); got != want {
			t.Errorf("NormMode(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestModeIsReadOnEveryEvaluation(t *testing.T) {
	var mode atomic.Value
	mode.Store(ModeSlots)
	q := New(Config{
		Slots:     func() int { return 1 },
		Mode:      func() string { return mode.Load().(string) },
		Available: func(context.Context) (uint64, error) { return 64 * gb, nil },
		// past Auto's CPU cap: this machine's own count would hold b
		CPUs: func() int { return manyCPUs },
	})
	ctx := context.Background()
	held, _ := q.Acquire(ctx, Request{Name: "a", Bytes: gb}, nil)
	defer held.Release()
	got := make(chan *Slot, 1)
	go func() { s, _ := q.Acquire(ctx, Request{Name: "b", Bytes: gb}, nil); got <- s }()
	waitFor(t, func() bool { return len(q.Snapshot().Jobs) == 2 })
	if m := q.Snapshot().Mode; m != ModeSlots {
		t.Fatalf("snapshot mode = %q, want %q", m, ModeSlots)
	}
	select {
	case <-got:
		t.Fatal("b started on a full slot")
	case <-time.After(50 * time.Millisecond):
	}
	mode.Store(ModeAuto)
	q.evaluate(ctx)
	select {
	case s := <-got:
		s.Release()
	case <-time.After(time.Second):
		t.Fatal("b still queued after the mode turned auto")
	}
	if m := q.Snapshot().Mode; m != ModeAuto {
		t.Fatalf("snapshot mode = %q, want %q", m, ModeAuto)
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

func TestPokeAppliesAChangedSlotCountAtOnce(t *testing.T) {
	Poke() // no default queue: nothing to do
	var slots atomic.Int32
	slots.Store(1)
	Default = New(Config{
		Slots:     func() int { return int(slots.Load()) },
		Available: func(context.Context) (uint64, error) { return 64 * gb, nil },
	})
	t.Cleanup(func() { Default = nil })
	ctx := context.Background()
	held, _ := Default.Acquire(ctx, Request{Name: "a", Bytes: gb}, nil)
	defer held.Release()
	got := make(chan *Slot, 1)
	go func() { s, _ := Default.Acquire(ctx, Request{Name: "b", Bytes: gb}, nil); got <- s }()
	waitFor(t, func() bool { return len(Default.Snapshot().Jobs) == 2 })
	select {
	case <-got:
		t.Fatal("b started on a full slot")
	case <-time.After(50 * time.Millisecond):
	}
	slots.Store(2)
	Poke()
	select {
	case s := <-got:
		s.Release()
	case <-time.After(time.Second):
		t.Fatal("b still queued after Poke")
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

// Off is the person's "don't wait" switch, which the engine's worker gate obeys too: jobs:mode off, or a pause still
// ahead. With no default queue nothing is switched off.
func TestOff(t *testing.T) {
	old := Default
	defer func() { Default = old }()
	Default = nil
	if Off() {
		t.Fatal("no default queue must not read as off")
	}
	now := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	mode, until := ModeAuto, time.Time{}
	Default = New(Config{
		Mode:        func() string { return mode },
		PausedUntil: func() time.Time { return until },
		Now:         func() time.Time { return now },
	})
	if Off() {
		t.Fatal("auto with no pause is not off")
	}
	mode = ModeOff
	if !Off() {
		t.Fatal("jobs:mode off is off")
	}
	mode, until = ModeSlots, now.Add(time.Minute)
	if !Off() {
		t.Fatal("a pause still ahead is off")
	}
	until = now.Add(-time.Minute)
	if Off() {
		t.Fatal("a past pause is not off")
	}
}

// a command whose wsh jobslot stopped waiting ran without a slot: the count and the latest reach the cockpit
func TestNoteBypassReachesTheSnapshot(t *testing.T) {
	var snaps []Snapshot
	q := New(Config{
		Slots:     func() int { return 1 },
		Available: func(context.Context) (uint64, error) { return 64 * gb, nil },
		Now:       func() time.Time { return t0 },
		OnChange:  func(s Snapshot) { snaps = append(snaps, s) },
	})
	q.NoteBypass("task check:ts", Source{BlockId: "b1"})
	q.NoteBypass("npm test", Source{BlockId: "b2"})
	s := q.Snapshot()
	if s.Bypassed != 2 || s.LastBypass.Name != "npm test" || s.LastBypass.Source.BlockId != "b2" || !s.LastBypass.At.Equal(t0) {
		t.Fatalf("snapshot = %+v", s)
	}
	if len(s.Jobs) != 0 {
		t.Fatalf("a bypass queued %d jobs", len(s.Jobs))
	}
	if len(snaps) != 2 || snaps[1].Bypassed != 2 {
		t.Fatalf("OnChange got %d snapshots (%+v), want one per bypass", len(snaps), snaps)
	}
}

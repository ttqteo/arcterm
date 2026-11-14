// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jobqueue holds the heavy shell jobs of every agent and engine run on this machine (builds, the
// typecheck, whole test suites) to a few at a time, so concurrent runs stop starving each other of CPU and
// disk. One FIFO; no job overtakes another. By default (jobs:mode auto) the head starts as soon as its RAM peak
// fits, so a job waits only when running it would push the machine into swap; jobs:mode slots also caps how many
// run at once, and off never makes one wait. Where the OS reads its own memory pressure (macOS) that decides
// instead of the free-RAM count, and jobs:pauseuntil turns the queue off for a while.
package jobqueue

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"runtime"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memgate"
)

const (
	DefaultSlots = 1
	MaxSlots     = 4
	// CPUsPerJob is how many CPUs ModeAuto gives each heavy job: a typecheck, a build or a test suite takes several
	// cores and the disk, so 3-4 at once on a 12-thread machine saturated it while the RAM still fit (2026-11-11)
	CPUsPerJob = 6
	// RampUp is how long a started job counts its whole peak against the free RAM: one just started has not
	// reached its peak, so the reading still shows that RAM as free.
	RampUp = 60 * time.Second
	// MaxHold is how long an agent's job may hold a slot: past it the slot is taken back (a wsh that outlived
	// its command). Engine jobs live by their ctx and are never reclaimed.
	MaxHold = 60 * time.Minute
	// Tick paces Run: a fresh RAM reading and the reclaim check.
	Tick = 5 * time.Second
)

// Mode is how the queue starts its jobs, the jobs:mode setting.
const (
	ModeAuto  = "auto"  // no slot count: the head starts as soon as its peak fits the free RAM; the default
	ModeSlots = "slots" // the head starts while fewer than jobs:slots run and its peak fits the free RAM
	ModeOff   = "off"   // no wait: every job starts at once, and is still listed
)

// NormMode reads the jobs:mode setting: unset or unknown is ModeAuto.
func NormMode(m string) string {
	switch m {
	case ModeSlots, ModeOff:
		return m
	}
	return ModeAuto
}

// Pressure is the OS's own reading of memory pressure, where it has one (macOS, the one Activity Monitor draws).
// There it decides instead of the free-RAM count, which leaves out the compressor and swap and so reads low on a
// machine that still runs fine.
type Pressure int

const (
	PressureUnknown  Pressure = iota // no reading: the free-RAM rule decides
	PressureNormal                   // a job starts, beside one still ramping up only when the free RAM fits both
	PressureWarn                     // one at a time: a job starts once none runs
	PressureCritical                 // the machine is about to stall: one at a time, as warn, the head starting once none runs
)

// the log's word for each Pressure
var pressureNames = [...]string{PressureUnknown: "unknown", PressureNormal: "normal", PressureWarn: "warn", PressureCritical: "critical"}

// the reasons a queued job waits on the pressure, as the cockpit shows them
const (
	ReasonPressureHigh     = "memory pressure high, one at a time"
	ReasonPressureCritical = "memory pressure critical"
	// an e2e or smoke run waits on another (memgate.Solo): two at once saturate the CPU while the RAM still fits
	ReasonBrowserRunBusy = "an e2e or smoke run is running"
	// ModeAuto's CPU cap is full (autoCap), "CPU busy, 2 at a time"
	reasonCPUBusy = "CPU busy, %d at a time"
)

// autoCap is how many heavy jobs ModeAuto runs at once on cpus CPUs: one per CPUsPerJob, and always one.
func autoCap(cpus int) int {
	return max(1, cpus/CPUsPerJob)
}

// PressureFromLevel reads macOS's kern.memorystatus_vm_pressure_level: 1 normal, 2 warn, 4 critical.
func PressureFromLevel(level uint32) Pressure {
	switch level {
	case 1:
		return PressureNormal
	case 2:
		return PressureWarn
	case 4:
		return PressureCritical
	}
	return PressureUnknown
}

// PressureFromCommit is Windows's reading: the commit charge against the physical RAM, and the RAM still free.
// Commit alone is not pressure: with a pagefile Windows commits memory nothing has touched yet, and a dev box often
// sits past its RAM with a quarter of it free, where reading warn started jobs one at a time for no reason. So under
// the RAM, or past it with a tenth or more free, there is no reading and the free-RAM rule decides; past it with
// under a tenth free the machine pages, so jobs start one at a time; past 130% with under a fifth free it stalls
// (2026-10-14: 46 GB on 32 GB, 5.2 GB free, paged to a hard disk until Postgres hung).
func PressureFromCommit(commit, phys, availPhys uint64) Pressure {
	switch {
	case phys == 0 || commit < phys:
		return PressureUnknown
	case commit*10 >= phys*13 && availPhys*5 < phys:
		return PressureCritical
	case availPhys*10 < phys:
		return PressureWarn
	}
	return PressureUnknown
}

// ErrSkipped is Acquire's error when the person skipped the job from the cockpit.
var ErrSkipped = errors.New("skipped from the job queue")

// Source is who asked: an agent's block (and its tab, for the cockpit to open), or an engine run's step.
type Source struct {
	BlockId string
	TabId   string
	RunId   string
	Label   string // "Verify · Task 3"; empty for an agent
	// Tasks are the ids of the run's tasks an engine step is for, comma-joined ("t-3" or a merge batch's "t-3,t-4"),
	// so the cockpit tags those tasks' rows while the step waits; empty for a step of the whole run or an agent. A
	// string, not a slice, so Job stays comparable
	Tasks string
	// Always queues an engine step that memgate does not call heavy (Verify, Final)
	Always bool
	// Peak is the RAM an Always step claims when memgate does not know its command: memgate.DevBytes for
	// Final (it starts a dev app); 0 means verify.mjs's peak
	Peak uint64
}

// For names who the job is for, in a queued agent's transcript: "run 700db4" for an engine step, empty for an
// agent (wavesrv does not know its display name).
func (s Source) For() string {
	if s.RunId == "" {
		return ""
	}
	return "run " + s.RunId[:min(6, len(s.RunId))]
}

// Basis is what a job's Bytes figure rests on, for the cockpit to say so: the memgate table's estimate (the zero
// Basis), or the peaks wavesrv measured for the same command. It is a comparable value, so Job stays comparable
// (evaluate compares snapshots with slices.Equal), and is fixed at Acquire, like Bytes.
type Basis struct {
	Measured  bool
	Elsewhere bool // measured only in another project
	// Peaks are the kept peaks, newest first; 0 is none. The array's length is how many runs are kept, defined here
	// once: nothing else spells out the 5.
	Peaks [5]uint64
}

type Request struct {
	Name   string // memgate's job name, or the engine step
	Bytes  uint64 // rough RAM peak
	Engine bool   // an engine step: no Skip, never reclaimed
	// NoCPU is a call that waits on the network, not the CPU (a council expert's claude -p): Auto's CPU cap neither
	// counts it nor holds it
	NoCPU  bool
	Source Source
	// Basis is what Bytes rests on; the zero Basis is the table's estimate
	Basis Basis
}

// Job is one queued or running job as the cockpit sees it.
type Job struct {
	Id string
	Request
	Running   bool
	Forced    bool
	Position  int    // 1-based among the queued; 0 when running
	Reason    string // why a queued job waits
	QueuedAt  time.Time
	StartedAt time.Time
}

type Snapshot struct {
	Slots       int
	Mode        string
	PausedUntil time.Time // zero unless a pause is on: until then every job starts at once
	Jobs        []Job     // running first, then the queue in order
	// Bypassed counts the agent commands that ran without a slot since wavesrv started: the queue answered after
	// their `wsh jobslot` had stopped waiting. LastBypass is the latest; zero when none did.
	Bypassed   int
	LastBypass Bypass
}

// Bypass is one agent command that ran without a slot.
type Bypass struct {
	Name   string
	Source Source
	At     time.Time
}

// Wait is a queued job's place, handed to Acquire's wait callback whenever it changes.
type Wait struct {
	Position int
	Behind   string // the job just ahead, or the running job for the head
	For      string // Behind's Source.For()
	Reason   string
}

// Config wires the queue to its surroundings. Wait callbacks and OnChange run one at a time, in the order the
// queue changed, so they must not block and must not call Acquire, Release, RunNow, Skip or Reclaim.
type Config struct {
	Slots func() int
	Mode  func() string // jobs:mode, read through NormMode; nil counts slots (tests), unlike an unset setting
	// PausedUntil is jobs:pauseuntil: before it the queue runs as ModeOff. nil or a past time is no pause.
	PausedUntil func() time.Time
	// Pressure is the OS's memory pressure; nil or PressureUnknown leaves the decision to Available.
	Pressure  func(context.Context) Pressure
	Available func(context.Context) (uint64, error)
	OnChange  func(Snapshot) // when the snapshot differs from the last one handed out, outside the lock
	Now       func() time.Time
	// CPUs is the machine's CPU count, which caps ModeAuto (autoCap); nil reads runtime.NumCPU
	CPUs func() int
}

// Slot is a started job's hold on the queue.
type Slot struct {
	q       *Queue
	e       *entry
	once    sync.Once
	reclaim chan struct{}
}

// Release frees the slot; twice is once.
func (s *Slot) Release() {
	s.once.Do(func() {
		// a reclaimed slot is already out of the queue and logged there
		if s.q.remove(s.e) {
			log.Printf("[jobqueue] finished %s (%s), held %s", s.e.Id, s.e.Name,
				s.q.cfg.Now().Sub(s.e.StartedAt).Round(time.Second))
		}
		s.q.evaluate(context.Background())
	})
}

// Reclaimed closes when the queue took the slot back (an agent job held past MaxHold).
func (s *Slot) Reclaimed() <-chan struct{} { return s.reclaim }

type entry struct {
	Job
	admitted chan struct{}
	skipped  chan struct{}
	reclaim  chan struct{}
	wait     func(Wait)
	lastWait Wait
	// loggedWait: the log has its first wait line
	loggedWait bool
}

type Queue struct {
	cfg Config
	// evalMu serializes evaluate, so a waiter's callbacks never reach it out of order or after it started.
	evalMu   sync.Mutex
	lastSnap Snapshot // under evalMu
	mu       sync.Mutex
	seq      int
	entries  []*entry // in the order they asked, running and queued together
	bypassed int
	last     Bypass
}

// Default is wavesrv's queue; nil (tests, wsh) means no queue: Hold runs at once.
var Default *Queue

func New(cfg Config) *Queue {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Slots == nil {
		cfg.Slots = func() int { return DefaultSlots }
	}
	if cfg.Mode == nil {
		cfg.Mode = func() string { return ModeSlots }
	}
	return &Queue{cfg: cfg}
}

// ClampSlots reads the jobs:slots setting: unset or out of range is the default or the bound.
func ClampSlots(v *int) int {
	if v == nil {
		return DefaultSlots
	}
	return clampSlots(*v)
}

func clampSlots(n int) int {
	switch {
	case n < 1:
		return DefaultSlots
	case n > MaxSlots:
		return MaxSlots
	}
	return n
}

// plan picks the queued jobs that start now, in queue order: a forced job always, and every job in ModeOff;
// otherwise the head while fewer than slots run (in ModeSlots), or fewer than autoCap(cpus) heavy jobs that take the
// CPU (in ModeAuto: a NoCPU call neither counts nor waits on it), and the RAM allows it. With a pressure reading
// that is the pressure: normal starts it, beside a job still ramping up only when the free RAM fits both (the
// pressure has not seen that job's peak yet); warn and critical only once no job runs. With none it is the free
// RAM less the peaks of jobs still ramping up, which must fit its peak. It stops at the first job that cannot
// start, and returns why the rest wait.
func plan(jobs []Job, slots, cpus int, mode string, available uint64, pressure Pressure, now time.Time) ([]string, string) {
	running, rampingJobs, cpuJobs := 0, 0, 0
	soloRunning := false
	var ramping uint64
	for _, j := range jobs {
		if j.Running {
			running++
			if !j.NoCPU {
				cpuJobs++
			}
			soloRunning = soloRunning || memgate.Solo(j.Name)
			if now.Sub(j.StartedAt) < RampUp {
				ramping += j.Bytes
				rampingJobs++
			}
		}
	}
	free := sub(available, ramping)
	var start []string
	reason := ""
	for _, j := range jobs {
		if j.Running {
			continue
		}
		if j.Forced || mode == ModeOff {
			start = append(start, j.Id)
			running++
			if !j.NoCPU {
				cpuJobs++
			}
			rampingJobs++
			free = sub(free, j.Bytes)
			soloRunning = soloRunning || memgate.Solo(j.Name)
			continue
		}
		if reason != "" {
			continue
		}
		switch {
		case mode == ModeSlots && running >= slots:
			reason = "slot busy"
		case mode == ModeAuto && !j.NoCPU && cpuJobs >= autoCap(cpus):
			reason = fmt.Sprintf(reasonCPUBusy, autoCap(cpus))
		case soloRunning && memgate.Solo(j.Name):
			reason = ReasonBrowserRunBusy
		// critical still starts one once nothing runs: holding every job left agents waiting with no end in sight,
		// until the person paused the queue and every job started at once (2026-11-04)
		case pressure == PressureCritical && running > 0:
			reason = ReasonPressureCritical
		case pressure == PressureWarn && running > 0:
			reason = ReasonPressureHigh
		case (pressure == PressureUnknown || pressure == PressureNormal && rampingJobs > 0) &&
			!memgate.Fits(memgate.Job{Name: j.Name, Bytes: j.Bytes}, free):
			reason = fmt.Sprintf("needs %s, %s free", memgate.FormatGB(j.Bytes), memgate.FormatGB(free))
		default:
			start = append(start, j.Id)
			running++
			if !j.NoCPU {
				cpuJobs++
			}
			rampingJobs++
			free = sub(free, j.Bytes)
			soloRunning = soloRunning || memgate.Solo(j.Name)
		}
	}
	return start, reason
}

func sub(a, b uint64) uint64 {
	if a < b {
		return 0
	}
	return a - b
}

// Acquire queues the request and blocks until it starts, the person skips it (ErrSkipped) or ctx ends. wait,
// when set, hears the job's place each time it changes. The returned Slot must be released.
func (q *Queue) Acquire(ctx context.Context, req Request, wait func(Wait)) (*Slot, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	q.mu.Lock()
	q.seq++
	e := &entry{
		Job:      Job{Id: fmt.Sprintf("j%d", q.seq), Request: req, QueuedAt: q.cfg.Now()},
		admitted: make(chan struct{}),
		skipped:  make(chan struct{}),
		reclaim:  make(chan struct{}),
		wait:     wait,
	}
	q.entries = append(q.entries, e)
	q.mu.Unlock()
	q.evaluate(ctx)
	select {
	case <-e.admitted:
		return &Slot{q: q, e: e, reclaim: e.reclaim}, nil
	case <-e.skipped:
		q.remove(e)
		q.evaluate(context.Background())
		return nil, ErrSkipped
	case <-ctx.Done():
		q.remove(e)
		q.evaluate(context.Background())
		return nil, ctx.Err()
	}
}

// evaluate starts what plan says can start, refreshes every waiter's place, and tells the waiters and
// OnChange what changed. A broken RAM reading reads as plenty: it never blocks a job. A pause on runs it as ModeOff.
func (q *Queue) evaluate(ctx context.Context) {
	q.evalMu.Lock()
	defer q.evalMu.Unlock()
	available := uint64(math.MaxUint64)
	if q.cfg.Available != nil {
		if v, err := q.cfg.Available(ctx); err == nil {
			available = v
		}
	}
	pressure := PressureUnknown
	if q.cfg.Pressure != nil {
		pressure = q.cfg.Pressure(ctx)
	}
	type notice struct {
		wait func(Wait)
		w    Wait
	}
	var notices []notice
	q.mu.Lock()
	now := q.cfg.Now()
	jobs := make([]Job, len(q.entries))
	for i, e := range q.entries {
		jobs[i] = e.Job
	}
	mode := NormMode(q.cfg.Mode())
	if !q.pausedUntil(now).IsZero() {
		mode = ModeOff
	}
	start, reason := plan(jobs, clampSlots(q.cfg.Slots()), q.cpus(), mode, available, pressure, now)
	var started []*entry
	for _, id := range start {
		for _, e := range q.entries {
			if e.Id == id {
				e.Running = true
				e.StartedAt = now
				e.Position = 0
				e.Reason = ""
				close(e.admitted)
				started = append(started, e)
			}
		}
	}
	if len(started) > 0 {
		// the CPU count Auto caps, so the log alone shows how many heavy jobs ran at once
		cpuRunning := 0
		for _, e := range q.entries {
			if e.Running && !e.NoCPU {
				cpuRunning++
			}
		}
		for _, e := range started {
			log.Printf("[jobqueue] started %s (%s, block %q run %q), mode %s, pressure %s, %s free, %d heavy running",
				e.Id, e.Name, e.Source.BlockId, e.Source.RunId, mode, pressureNames[pressure],
				memgate.FormatGB(available), cpuRunning)
		}
	}
	var oldest *entry
	for _, e := range q.entries {
		if e.Running && (oldest == nil || e.StartedAt.Before(oldest.StartedAt)) {
			oldest = e
		}
	}
	ahead := oldest
	position := 0
	for _, e := range q.entries {
		if e.Running {
			continue
		}
		position++
		e.Position = position
		e.Reason = reason
		if !e.loggedWait && reason != "" {
			// once per job: a RAM reason's numbers change every tick
			e.loggedWait = true
			log.Printf("[jobqueue] %s (%s) waits #%d: %s", e.Id, e.Name, position, reason)
		}
		w := Wait{Position: position, Reason: reason}
		if ahead != nil {
			w.Behind = ahead.Name
			w.For = ahead.Source.For()
		}
		ahead = e
		if e.wait != nil && w != e.lastWait {
			e.lastWait = w
			notices = append(notices, notice{e.wait, w})
		}
	}
	snap := q.snapshotLocked()
	q.mu.Unlock()
	for _, n := range notices {
		n.wait(n.w)
	}
	if q.cfg.OnChange != nil && (q.lastSnap.Slots != snap.Slots || q.lastSnap.Mode != snap.Mode ||
		!q.lastSnap.PausedUntil.Equal(snap.PausedUntil) || !slices.Equal(q.lastSnap.Jobs, snap.Jobs) ||
		q.lastSnap.Bypassed != snap.Bypassed) {
		q.lastSnap = snap
		q.cfg.OnChange(snap)
	}
}

// cpus is the CPU count Auto's cap reads
func (q *Queue) cpus() int {
	if q.cfg.CPUs != nil {
		return q.cfg.CPUs()
	}
	return runtime.NumCPU()
}

// remove takes e out of the queue; false when it was already out.
func (q *Queue) remove(e *entry) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	n := len(q.entries)
	q.entries = slices.DeleteFunc(q.entries, func(o *entry) bool { return o == e })
	return len(q.entries) < n
}

// Snapshot is the running jobs, oldest first, then the queue in order.
func (q *Queue) Snapshot() Snapshot {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.snapshotLocked()
}

// pausedUntil is when the pause on at now ends, or zero when none is.
func (q *Queue) pausedUntil(now time.Time) time.Time {
	if q.cfg.PausedUntil == nil {
		return time.Time{}
	}
	if until := q.cfg.PausedUntil(); until.After(now) {
		return until
	}
	return time.Time{}
}

func (q *Queue) snapshotLocked() Snapshot {
	snap := Snapshot{
		Slots:       clampSlots(q.cfg.Slots()),
		Mode:        NormMode(q.cfg.Mode()),
		PausedUntil: q.pausedUntil(q.cfg.Now()),
		Bypassed:    q.bypassed,
		LastBypass:  q.last,
	}
	var queued []Job
	for _, e := range q.entries {
		if e.Running {
			snap.Jobs = append(snap.Jobs, e.Job)
		} else {
			queued = append(queued, e.Job)
		}
	}
	sort.SliceStable(snap.Jobs, func(i, j int) bool { return snap.Jobs[i].StartedAt.Before(snap.Jobs[j].StartedAt) })
	snap.Jobs = append(snap.Jobs, queued...)
	return snap
}

// NoteBypass records an agent command that ran without a slot because its `wsh jobslot` stopped waiting before the
// queue answered, or could not reach wavesrv at all (then at is when it ran, reported by a later wsh; zero is now).
// The Jobs popover shows the count, so a queue too slow to answer is seen, not only logged.
func (q *Queue) NoteBypass(name string, src Source, at time.Time) {
	if at.IsZero() {
		at = q.cfg.Now()
	}
	q.mu.Lock()
	q.bypassed++
	if !at.Before(q.last.At) {
		q.last = Bypass{Name: name, Source: src, At: at}
	}
	q.mu.Unlock()
	log.Printf("[jobqueue] %s (block %q) ran without a slot at %s: wsh stopped waiting before the queue answered",
		name, src.BlockId, at.Format("15:04:05"))
	q.evaluate(context.Background())
}

// RunNow starts a queued job past both gates; false for an unknown or already running job.
func (q *Queue) RunNow(id string) bool {
	q.mu.Lock()
	var found bool
	for _, e := range q.entries {
		if e.Id == id && !e.Running {
			e.Forced = true
			found = true
		}
	}
	q.mu.Unlock()
	if found {
		q.evaluate(context.Background())
	}
	return found
}

// Skip drops a queued agent job: its Acquire returns ErrSkipped. False for a running job, an engine job (skipping
// Verify would break the merge) or an unknown one.
func (q *Queue) Skip(id string) bool {
	q.mu.Lock()
	var skipped *entry
	for _, e := range q.entries {
		if e.Id == id && !e.Running && !e.Engine {
			skipped = e
		}
	}
	if skipped != nil {
		// out of the queue here, under the lock, so an evaluate cannot start it before its Acquire wakes
		q.entries = slices.DeleteFunc(q.entries, func(o *entry) bool { return o == skipped })
		close(skipped.skipped)
	}
	q.mu.Unlock()
	if skipped != nil {
		q.evaluate(context.Background())
	}
	return skipped != nil
}

// Reclaim takes back the slot of every agent job that has held it past MaxHold.
func (q *Queue) Reclaim() {
	q.mu.Lock()
	now := q.cfg.Now()
	var taken []*entry
	for _, e := range q.entries {
		if e.Running && !e.Engine && now.Sub(e.StartedAt) > MaxHold {
			taken = append(taken, e)
		}
	}
	for _, e := range taken {
		close(e.reclaim)
		q.entries = slices.DeleteFunc(q.entries, func(o *entry) bool { return o == e })
		log.Printf("[jobqueue] reclaimed %s (%s), held %s", e.Id, e.Name, now.Sub(e.StartedAt).Round(time.Second))
	}
	q.mu.Unlock()
	if len(taken) > 0 {
		q.evaluate(context.Background())
	}
}

// Run keeps the queue honest until ctx ends: every Tick it reclaims overdue slots and reads the RAM afresh, so
// a job waiting on RAM starts when it frees up.
func (q *Queue) Run(ctx context.Context) {
	ticker := time.NewTicker(Tick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			q.Reclaim()
			q.evaluate(ctx)
		}
	}
}

// Hold takes a slot on the default queue for an in-process caller (the engine) and returns its release. With
// no default queue it runs at once.
func Hold(ctx context.Context, req Request) (release func(), err error) {
	if Default == nil {
		return func() {}, nil
	}
	slot, err := Default.Acquire(ctx, req, nil)
	if err != nil {
		return nil, err
	}
	return slot.Release, nil
}

// Off reports whether the default queue starts every job at once: jobs:mode off, or a jobs:pauseuntil still ahead.
// It is the person's "don't wait for memory", which the engine's worker gate obeys too. With no default queue it is
// false.
func Off() bool {
	q := Default
	if q == nil {
		return false
	}
	return NormMode(q.cfg.Mode()) == ModeOff || !q.pausedUntil(q.cfg.Now()).IsZero()
}

// Poke has the default queue read its inputs again now: a changed jobs:slots or jobs:mode takes effect at once
// rather than at the next release or Tick. With no default queue it does nothing.
func Poke() {
	if Default != nil {
		Default.evaluate(context.Background())
	}
}

type sourceKey struct{}

// WithSource carries who a job is for down to the call that holds it.
func WithSource(ctx context.Context, s Source) context.Context {
	return context.WithValue(ctx, sourceKey{}, s)
}

// SourceFrom is what WithSource carried, or the zero Source.
func SourceFrom(ctx context.Context) Source {
	s, _ := ctx.Value(sourceKey{}).(Source)
	return s
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jobqueue holds the heavy shell jobs of every agent and engine run on this machine (builds, the
// typecheck, whole test suites) to a few at a time, so concurrent runs stop starving each other of CPU and
// disk. One FIFO: the head starts when a slot is free and its RAM peak fits; no job overtakes another.
package jobqueue

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memgate"
)

const (
	DefaultSlots = 1
	MaxSlots     = 4
	// RampUp is how long a started job counts its whole peak against the free RAM: one just started has not
	// reached its peak, so the reading still shows that RAM as free.
	RampUp = 60 * time.Second
	// MaxHold is how long an agent's job may hold a slot: past it the slot is taken back (a wsh that outlived
	// its command). Engine jobs live by their ctx and are never reclaimed.
	MaxHold = 60 * time.Minute
	// Tick paces Run: a fresh RAM reading and the reclaim check.
	Tick = 5 * time.Second
)

// ErrSkipped is Acquire's error when the person skipped the job from the cockpit.
var ErrSkipped = errors.New("skipped from the job queue")

// Source is who asked: an agent's block (and its tab, for the cockpit to open), or an engine run's step.
type Source struct {
	BlockId string
	TabId   string
	RunId   string
	Label   string // "Verify · Task 3"; empty for an agent
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

type Request struct {
	Name   string // memgate's job name, or the engine step
	Bytes  uint64 // rough RAM peak
	Engine bool   // an engine step: no Skip, never reclaimed
	Source Source
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
	Slots int
	Jobs  []Job // running first, then the queue in order
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
	Slots     func() int
	Available func(context.Context) (uint64, error)
	OnChange  func(Snapshot) // when the snapshot differs from the last one handed out, outside the lock
	Now       func() time.Time
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
		s.q.remove(s.e)
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
}

type Queue struct {
	cfg Config
	// evalMu serializes evaluate, so a waiter's callbacks never reach it out of order or after it started.
	evalMu   sync.Mutex
	lastSnap Snapshot // under evalMu
	mu       sync.Mutex
	seq      int
	entries  []*entry // in the order they asked, running and queued together
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

// plan picks the queued jobs that start now, in queue order: a forced job always; otherwise the head while
// fewer than slots run and its peak fits the free RAM less the peaks of jobs still ramping up. It stops at the
// first job that cannot start, and returns why the rest wait.
func plan(jobs []Job, slots int, available uint64, now time.Time) ([]string, string) {
	running := 0
	var ramping uint64
	for _, j := range jobs {
		if j.Running {
			running++
			if now.Sub(j.StartedAt) < RampUp {
				ramping += j.Bytes
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
		if j.Forced {
			start = append(start, j.Id)
			running++
			free = sub(free, j.Bytes)
			continue
		}
		if reason != "" {
			continue
		}
		switch {
		case running >= slots:
			reason = "slot busy"
		case !memgate.Fits(memgate.Job{Name: j.Name, Bytes: j.Bytes}, free):
			reason = fmt.Sprintf("needs %s, %s free", memgate.FormatGB(j.Bytes), memgate.FormatGB(free))
		default:
			start = append(start, j.Id)
			running++
			free = sub(free, j.Bytes)
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
// OnChange what changed. A broken RAM reading reads as plenty: it never blocks a job.
func (q *Queue) evaluate(ctx context.Context) {
	q.evalMu.Lock()
	defer q.evalMu.Unlock()
	available := uint64(math.MaxUint64)
	if q.cfg.Available != nil {
		if v, err := q.cfg.Available(ctx); err == nil {
			available = v
		}
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
	start, reason := plan(jobs, clampSlots(q.cfg.Slots()), available, now)
	for _, id := range start {
		for _, e := range q.entries {
			if e.Id == id {
				e.Running = true
				e.StartedAt = now
				e.Position = 0
				e.Reason = ""
				close(e.admitted)
			}
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
	if q.cfg.OnChange != nil && (q.lastSnap.Slots != snap.Slots || !slices.Equal(q.lastSnap.Jobs, snap.Jobs)) {
		q.lastSnap = snap
		q.cfg.OnChange(snap)
	}
}

func (q *Queue) remove(e *entry) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.entries = slices.DeleteFunc(q.entries, func(o *entry) bool { return o == e })
}

// Snapshot is the running jobs, oldest first, then the queue in order.
func (q *Queue) Snapshot() Snapshot {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.snapshotLocked()
}

func (q *Queue) snapshotLocked() Snapshot {
	snap := Snapshot{Slots: clampSlots(q.cfg.Slots())}
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

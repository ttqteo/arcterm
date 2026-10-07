// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"log"
	"runtime"
	"runtime/debug"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// watchdogInterval is the DAG-advance tick: the engine otherwise advances only on events (submit,
// dag action, run update), and a stalled child produces no events — the watchdog tick is what notices.
const watchdogInterval = 30 * time.Second

// wakeTickInterval paces the wake adapter and the ask sweep. It sits well under WakeConfirmTimeout and
// agentask.AnswerClearTimeout, so neither window runs much past what its constant says.
const wakeTickInterval = 5 * time.Second

// tickWait is how long the watchdog loop waits on one dag's tick before it moves on. The tick keeps running; the
// loop only stops waiting, so a dag whose tick never finishes cannot starve every other dag of its ticks. A var
// for tests.
var tickWait = watchdogInterval

// tickOverdue is how long a dag's tick may run before it is reported stuck. scheduleTickTimeout ends every wait
// in a tick that a context can end, and a Setup holds the dag lock a tick queues on for up to SetupTimeout, so a
// tick older than both is in a wait nothing ends.
var tickOverdue = scheduleTickTimeout + SetupTimeout

// verifyOverdue is how long a Verify may hold its project claim before it is reported stuck: its command is
// killed at VerifyTimeout, and its result waits on the dag lock for one tick at most. A failed batch's bisect
// runs Verify again under the same claim, so a slow one can be reported while it still works; the wake says
// what was measured and the report changes no state.
var verifyOverdue = VerifyTimeout + scheduleTickTimeout

// watchdogStatuses are the dag statuses worth a periodic tick: every nonterminal one. Stall detection
// lives inside the schedule tick, so scanning only "running" stops supervising a dag the moment one
// task fails or a gate opens — while its siblings are still live children that can hang with nothing
// else to notice them. Ticking the parked ones cannot advance work that should not advance: every
// dispatch guard (the gate halt, the circuit-break, parallelism) is inside NextToSpawn, so the tick
// observes and reports without spawning.
var watchdogStatuses = []string{DagStatus_Running, DagStatus_PlanReview, DagStatus_Finalizing, DagStatus_Blocked, DagStatus_AwaitingReview}

// watchdogOnce guards the single start; watchdogTick is the per-tick body (a var so tests can count
// invocations without running a real ticker).
var (
	watchdogOnce sync.Once
	watchdogTick = func(ctx context.Context) {
		for _, status := range watchdogStatuses {
			dags, err := wstore.GetDagsByStatus(ctx, status)
			if err != nil {
				log.Printf("watchdog: listing %s dags: %v", status, err)
				continue
			}
			for _, g := range dags {
				// a parked dag is ticked only to observe its live children. With none, the tick would
				// just rewrite the row every interval — a version bump the UI reads as a change, on
				// exactly the dags a human is sitting and looking at.
				// an open plan review has no task at work, but its reviewer still needs its timeout watched. A
				// finalizing dag is ticked so a final stage the server lost starts again.
				if status != DagStatus_Running && status != DagStatus_Finalizing && len(busyTaskIDs(g)) == 0 && !planReviewOpen(g) {
					continue
				}
				tickDag(ctx, g)
			}
		}
		for _, l := range overdueVerifies() {
			what := fmt.Sprintf("the Verify after merging task %s has held the project checkout for %s, past its %s timeout",
				l.taskID, time.Since(l.since).Round(time.Second), shortDuration(VerifyTimeout))
			reportEngineStuck(ctx, l.channelID, l.runID, l.dagID, what, map[string]any{"taskid": l.taskID})
		}
	}
)

// dagTicks is the watchdog's tick in flight for each dag.
var dagTicks = struct {
	sync.Mutex
	byDag map[string]*dagTick
}{byDag: make(map[string]*dagTick)}

type dagTick struct {
	started  time.Time
	reported bool
}

// tickDag runs one dag's tick on its own goroutine and waits up to tickWait for it. A dag whose last tick is
// still running is not ticked again: the new tick would queue behind the same wait. Once that tick is older
// than tickOverdue it is reported, once. A tick an RPC started is covered too, because the watchdog's own tick
// queues on the dag lock behind it.
func tickDag(ctx context.Context, g *waveobj.TaskGroup) {
	dagTicks.Lock()
	if cur := dagTicks.byDag[g.OID]; cur != nil {
		age := time.Since(cur.started)
		overdue := !cur.reported && age > tickOverdue
		cur.reported = cur.reported || overdue
		dagTicks.Unlock()
		if overdue {
			what := fmt.Sprintf("a scheduler tick has not finished in %s, so nothing in the dag is advancing", age.Round(time.Second))
			reportEngineStuck(ctx, g.ChannelId, g.RunID, g.OID, what, map[string]any{})
		}
		return
	}
	dagTicks.byDag[g.OID] = &dagTick{started: time.Now()}
	dagTicks.Unlock()
	done := make(chan struct{})
	goStage("tick "+g.OID, func() {
		defer close(done)
		defer func() {
			dagTicks.Lock()
			delete(dagTicks.byDag, g.OID)
			dagTicks.Unlock()
			// off the loop's goroutine, so safeTick's recover does not cover it
			if r := recover(); r != nil {
				log.Printf("watchdog: tick panic in dag %s: %v\n%s", g.OID, r, debug.Stack())
			}
		}()
		if serr := Schedule(ctx, g.OID); serr != nil {
			log.Printf("watchdog: advancing dag %s: %v", g.ID, serr)
		}
	})
	timer := time.NewTimer(tickWait)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
	}
}

// maxGoroutineDump bounds the dump a stuck report writes to the server log.
const maxGoroutineDump = 4 << 20

// reportEngineStuck records a wait the engine cannot end on the run's timeline and wakes its lead. The dump
// goes to the log first: it is the only account of where the wait is, and the rows after it take locks the
// stuck goroutine may hold.
func reportEngineStuck(ctx context.Context, channelID, runID, dagID, what string, detail map[string]any) {
	buf := make([]byte, maxGoroutineDump)
	log.Printf("dag %s: engine stuck: %s; all goroutines:\n%s", dagID, what, buf[:runtime.Stack(buf, true)])
	detail["reason"] = what
	appendRunEvent(ctx, channelID, runID, waveobj.RunEventKindEngineStuck, nil, detail)
	PostWake(ctx, channelID, runID, engineStuckWake(what))
}

// StartWatchdog launches the periodic DAG-advance loop and the wake loop (idempotent; the first call
// wins), each on its own goroutine. Both run until ctx is done. Wired once at server startup.
func StartWatchdog(ctx context.Context) {
	watchdogOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(watchdogInterval)
			defer ticker.Stop()
			safeTick(ctx, watchdogTick) // first pass immediately (a submitted dag's children may already need attention)
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					safeTick(ctx, watchdogTick)
				}
			}
		}()
		// its own loop: a wake must not wait on however long a round of dag ticks takes
		go func() {
			wakeTicker := time.NewTicker(wakeTickInterval)
			defer wakeTicker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-wakeTicker.C:
					safeTick(ctx, wakeTick)
				}
			}
		}()
	})
}

func wakeTick(ctx context.Context) {
	sweepAsks(ctx)
	tickWakes(ctx)
}

// safeTick recovers per tick: a panic inside one Schedule must not kill the loop for the server's
// lifetime — the watchdog is the only advance path for event-less stalls.
func safeTick(ctx context.Context, tick func(context.Context)) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("watchdog: tick panic (loop continues): %v", r)
		}
	}()
	tick(ctx)
}

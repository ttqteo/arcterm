// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// worktreePrepTimeout bounds one lane tree's checkout off the lock. Large checkouts took 15-55 s on the fork's runs,
// past the spawn budget that bounded them under the lock; this only stops a hung git.
const worktreePrepTimeout = 5 * time.Minute

// treePrepBound is the longest a prepare runs: the checkout, Setup's wait for a heavy-job slot (which Setup's own
// timeout does not count) and Setup. A step that waits for a prepare gives up after it.
const treePrepBound = worktreePrepTimeout + SetupSlotWait + SetupTimeout

// treePrep is one task's tree preparation, from the pass that claims the task to the pass that spawns or fails it
type treePrep struct {
	done       bool
	requeue    bool   // Setup never ran to an answer (its slot wait ran out, or a pause or cancel cut it): back to pending, untried
	failKind   string // FailureKindWorktree or FailureKindSetup, set with err
	err        error
	wt, head   string   // the prepared tree and its head, which the spawn pass uses while wt exists
	leftovers  []string // laneLeftovers' result, written to the task's CleanupError by the spawn pass
	worktreeMs int64
	setupMs    int64
	notLinked  []string
}

// treePrepJob is what the prepare of one claimed task needs, copied out of the dag the claiming pass held: the prepare
// runs once the lock is released and reads none of it again.
type treePrepJob struct {
	dagID, taskID, ownerID, projectPath, key, spawnBase, setup, setupLabel string
}

func newTreePrepJob(g *waveobj.TaskGroup, owner *waveobj.Run, taskID, spawnBase string) treePrepJob {
	return treePrepJob{
		dagID: g.OID, taskID: taskID, ownerID: owner.ID, projectPath: owner.ProjectPath,
		key: LaneWorktreeKey(g, taskID), spawnBase: spawnBase, setup: g.Setup, setupLabel: taskStepLabel("Setup", g, taskID),
	}
}

// treePreps holds the prepares between the pass that claims a task and the pass that spawns or fails it. It lives in
// memory only: a restart loses it, and settlePreparing sends a preparing task with no entry back to pending. It holds
// no worker admission: a committed preparing task counts toward the live-worker cap through busyTaskIDs.
//
// inFlight is kept apart from the entries: the pass after a skip, or the cancel itself, drops an entry while its prepare
// still runs, and the prepare is still using the lane's tree. It holds a channel per running prepare, closed when
// prepareTaskTree returns.
var treePreps = struct {
	sync.Mutex
	byKey    map[string]*treePrep
	inFlight map[string]chan struct{}
}{byKey: make(map[string]*treePrep), inFlight: make(map[string]chan struct{})}

func treePrepKey(dagID, taskID string) string {
	return dagID + "/" + taskID
}

func registerTreePrep(dagID, taskID string) {
	treePreps.Lock()
	defer treePreps.Unlock()
	treePreps.byKey[treePrepKey(dagID, taskID)] = &treePrep{}
}

// treePrepFor is a copy of the entry, so a reader never races the prepare writing it.
func treePrepFor(dagID, taskID string) (treePrep, bool) {
	treePreps.Lock()
	defer treePreps.Unlock()
	p, ok := treePreps.byKey[treePrepKey(dagID, taskID)]
	if !ok {
		return treePrep{}, false
	}
	return *p, true
}

// beginTreePrep marks the task's prepare as running and returns the func that marks it over, for a defer. It is called
// when the prepare starts, not when its entry is registered: a pass's jobs run after autoRetryStalled, which takes the
// action lock a skip holds while it waits, so a mark made at the registration could be waited on behind that lock. A
// skip that lands between the registration and the prepare's start is therefore not held for the prepare.
func beginTreePrep(dagID, taskID string) func() {
	key := treePrepKey(dagID, taskID)
	done := make(chan struct{})
	treePreps.Lock()
	treePreps.inFlight[key] = done
	treePreps.Unlock()
	return func() {
		treePreps.Lock()
		// a later prepare of the task may have taken the mark over
		if treePreps.inFlight[key] == done {
			delete(treePreps.inFlight, key)
		}
		treePreps.Unlock()
		close(done)
	}
}

// waitTreePrep waits, up to limit, for the task's prepare that is running to return, and returns at once when none is.
// It is for a step that must not touch the lane's tree while a prepare checks it out or runs Setup in it. A prepare
// takes neither the dag lock nor the action lock (taskActions), so a step that holds the action lock can wait for it.
func waitTreePrep(ctx context.Context, dagID, taskID string, limit time.Duration) error {
	treePreps.Lock()
	done := treePreps.inFlight[treePrepKey(dagID, taskID)]
	treePreps.Unlock()
	if done == nil {
		return nil
	}
	timer := time.NewTimer(limit)
	defer timer.Stop()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return fmt.Errorf("task %s's tree is still being made after %s", taskID, limit)
	}
}

// finishTreePrep records a prepare's outcome; false, and nothing recorded, when the pass after a skip, or the cancel,
// dropped the entry while it ran.
func finishTreePrep(dagID, taskID string, outcome treePrep) bool {
	treePreps.Lock()
	defer treePreps.Unlock()
	p, ok := treePreps.byKey[treePrepKey(dagID, taskID)]
	if !ok {
		return false
	}
	outcome.done = true
	*p = outcome
	return true
}

func takeTreePrep(dagID, taskID string) *treePrep {
	treePreps.Lock()
	defer treePreps.Unlock()
	key := treePrepKey(dagID, taskID)
	p := treePreps.byKey[key]
	delete(treePreps.byKey, key)
	return p
}

// dropTreePreps removes every entry of dagID that keep refuses (nil keeps none).
func dropTreePreps(dagID string, keep func(taskID string) bool) {
	prefix := treePrepKey(dagID, "")
	treePreps.Lock()
	defer treePreps.Unlock()
	for key := range treePreps.byKey {
		taskID, ok := strings.CutPrefix(key, prefix)
		if !ok || (keep != nil && keep(taskID)) {
			continue
		}
		delete(treePreps.byKey, key)
	}
}

func treePrepCount(dagID string) int {
	prefix := treePrepKey(dagID, "")
	treePreps.Lock()
	defer treePreps.Unlock()
	n := 0
	for key := range treePreps.byKey {
		if strings.HasPrefix(key, prefix) {
			n++
		}
	}
	return n
}

// prepareTrees runs the prepares one claiming pass handed back, in order, so a tick's checkouts do not multiply its
// memory and disk load. A requeue is the heavy-job queue's or the pause's answer for every Setup that would follow it,
// so the jobs after it are handed back without running, as the loop's break did while Setup held the lock.
func prepareTrees(ctx context.Context, jobs []treePrepJob) {
	for i, job := range jobs {
		prepareTaskTree(ctx, job)
		if p, ok := treePrepFor(job.dagID, job.taskID); ok && p.requeue {
			for _, later := range jobs[i+1:] {
				finishTreePrep(later.dagID, later.taskID, treePrep{requeue: true})
			}
			return
		}
	}
}

// prepareTaskTree checks out the task's lane tree and runs Setup in it, without the dag lock. It writes the filesystem
// and the registry only: what belongs on the dag (a failure, leftover trees, a requeue) is written by the next locked
// pass, from the entry.
func prepareTaskTree(ctx context.Context, job treePrepJob) {
	// ends with the tree's removal below, so a step waiting on it (a skip's rewind) never meets a half-made tree
	defer beginTreePrep(job.dagID, job.taskID)()
	wtCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), worktreePrepTimeout)
	defer cancel()
	out, tree := prepareTree(ctx, wtCtx, job)
	// the pass after a skip dropped the entry while this ran, or the cancel did when it committed: nothing waits for the
	// outcome
	finishTreePrep(job.dagID, job.taskID, out)
	if tree == "" {
		return
	}
	// Cancel removes every tree it finds, and this one may not have existed yet when it ran
	if g, err := wstore.GetDag(ctx, job.dagID); err == nil && g.Status == DagStatus_Cancelled {
		if _, err := os.Stat(tree); err != nil {
			return
		}
		if err := removeWorktreeDir(context.WithoutCancel(ctx), job.projectPath, tree); err != nil {
			log.Printf("schedule dag %s task %s: removing the tree prepared for a cancelled dag: %v", job.dagID, job.taskID, err)
		}
	}
}

// prepareTree checks out job's lane tree on wtCtx and runs Setup in it on its own SetupTimeout, and returns the outcome
// with the tree as it stands (empty once the tree is gone). The spawn pass calls it too, under the dag lock, for a
// prepared tree that vanished.
func prepareTree(ctx, wtCtx context.Context, job treePrepJob) (treePrep, string) {
	var out treePrep
	// a lane's tasks share one tree, so each starts from the commits of the task before it
	wtStart := time.Now()
	wt, head, _, err := EnsureRunWorktree(wtCtx, job.projectPath, job.key, job.spawnBase)
	out.worktreeMs = time.Since(wtStart).Milliseconds()
	if err != nil {
		out.failKind, out.err = FailureKindWorktree, err
		return out, ""
	}
	out.leftovers = laneLeftovers(wtCtx, job.projectPath, job.key)
	// not "created by this call": a failed add or a server that died during Setup leaves a clean tree the retry reuses.
	// With no Setup the default link step runs on a reused tree too: it is idempotent and takes milliseconds
	if job.setup == "" || !treeSetUp(wtCtx, wt) {
		setupStart := time.Now()
		setupCtx := jobqueue.WithSource(context.WithoutCancel(ctx), jobqueue.Source{RunId: job.ownerID, Label: job.setupLabel, Tasks: job.taskID})
		// a pause or a cancel cuts Setup off at once (stopDagSetup), including a wait for a heavy-job slot, which is
		// why that wait is bounded
		setupCtx, endSetup := dagSetupCtx(withSlotWait(setupCtx, SetupSlotWait), job.dagID)
		_, notLinked, serr := PrepareTree(withRunCmdOwner(setupCtx, job.ownerID, PlanCmd_Setup, ""), wt, job.setup)
		out.setupMs = time.Since(setupStart).Milliseconds()
		pausedMidSetup := setupCut(setupCtx)
		endSetup()
		if errors.Is(serr, errSlotWaitOver) {
			// Setup never started, so the tree is as clean as it was, and the next tick sets it up (treeSetUp). The task
			// goes back to pending untried
			log.Printf("schedule dag %s task %s: Setup waited %s for a heavy-job slot; the next tick queues it again", job.dagID, job.taskID, SetupSlotWait)
			out.requeue = true
			return out, wt
		}
		if serr != nil {
			// only a new tree is set up, so a retry must not reuse this half-prepared one. The branch
			// stays: it holds the lane's earlier commits, and the retry checks it out again.
			if rerr := removeWorktreeDir(context.WithoutCancel(ctx), job.projectPath, wt); rerr != nil {
				log.Printf("schedule dag %s task %s: removing worktree after setup failure: %v", job.dagID, job.taskID, rerr)
			}
			if pausedMidSetup {
				// the pause cut Setup off, which says nothing about the task: it goes back to pending, and the tick
				// after the resume dispatches it again
				out.requeue = true
			} else {
				out.failKind, out.err = FailureKindSetup, serr
			}
			return out, ""
		}
		markTreeSetUp(context.WithoutCancel(ctx), wt)
		out.notLinked = notLinked
	}
	out.wt, out.head = wt, head
	return out, wt
}

// startPrepares marks each claimed task preparing and returns its prepare, which runs once the dag lock is released. A
// task its route or harness refuses fails here, before any tree is made. The entries are registered by the caller once
// the pass has committed: an entry for a task the store never read as preparing would outlive a failed commit.
func startPrepares(ctx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, spawnBase string, next []string, held map[string]bool, afterCommit *[]func()) []treePrepJob {
	var jobs []treePrepJob
	for _, taskID := range next {
		task := taskByID(g, taskID)
		if _, _, kind, err := resolveWorker(g, owner, task); err != nil {
			failDispatch(ctx, g, taskID, kind, err, afterCommit)
			held[taskID] = true
			continue
		}
		task.State = TaskState_Preparing
		jobs = append(jobs, newTreePrepJob(g, owner, taskID, spawnBase))
	}
	return jobs
}

// settlePreparing moves each preparing task on by its prepare: back to pending when none is under way (wavesrv
// restarted during it) or when Setup never ran to an answer, through failDispatch when it failed, and into ready, with
// its prepare, when its tree is made. A prepare still running is left alone. A task that a skip or cancel moved off
// preparing loses its entry. Every task it sends back to pending, or fails, is added to held: its next try waits for
// the next Schedule call, as a dispatch failure always did.
func settlePreparing(ctx context.Context, g *waveobj.TaskGroup, held map[string]bool, afterCommit *[]func()) ([]string, map[string]*treePrep) {
	var ready []string
	preps := map[string]*treePrep{}
	for i := range g.Tasks {
		task := &g.Tasks[i]
		if task.State != TaskState_Preparing {
			continue
		}
		p, ok := treePrepFor(g.OID, task.ID)
		switch {
		case !ok:
			log.Printf("schedule dag %s task %s: preparing with no prepare under way; back to pending", g.OID, task.ID)
			task.State = TaskState_Pending
		case !p.done:
		case p.requeue:
			takeTreePrep(g.OID, task.ID)
			task.State = TaskState_Pending
			held[task.ID] = true
		case p.err != nil:
			takeTreePrep(g.OID, task.ID)
			failPrep(ctx, g, task, &p, afterCommit)
			held[task.ID] = true
		default:
			preps[task.ID] = takeTreePrep(g.OID, task.ID)
			recordLeftovers(task, p.leftovers, p.wt)
			ready = append(ready, task.ID)
		}
	}
	dropTreePreps(g.OID, func(taskID string) bool {
		task := taskByID(g, taskID)
		return task != nil && task.State == TaskState_Preparing
	})
	return ready, preps
}

// failPrep fails the dispatch of a task whose tree could not be made. What holds a stale tree is reaped by the cleanup
// path, outside the dag lock: each worker a reap stops exits into that lock. Debt on the task is what sends the tree
// there, and what retry-cleanup acts on.
func failPrep(ctx context.Context, g *waveobj.TaskGroup, task *waveobj.TaskNode, p *treePrep, afterCommit *[]func()) {
	if p.failKind == FailureKindWorktree {
		task.CleanupError, task.CleanupAttempts = boundedCleanupError(p.err), 0
	}
	failDispatch(ctx, g, task.ID, p.failKind, p.err, afterCommit)
}

// recordLeftovers records the stale lane dirs a process held while the task's tree was made as its cleanup debt.
func recordLeftovers(task *waveobj.TaskNode, leftovers []string, wt string) {
	if len(leftovers) == 0 {
		return
	}
	task.CleanupError = boundedCleanupError(fmt.Errorf("left behind %s, held by a process; the task runs in %s", strings.Join(leftovers, ", "), wt))
	task.CleanupAttempts = 0
}

// releasePausedPreps sends the preparing tasks of a paused dag whose Setup was cut off, or whose prepare is gone,
// back to pending untried. A paused dag spawns nothing, so a prepare that finished or failed waits for the resume's
// first tick, and one still running is left alone. The caller holds the dag lock.
func releasePausedPreps(ctx context.Context, g *waveobj.TaskGroup) error {
	var back []string
	for i := range g.Tasks {
		task := &g.Tasks[i]
		if task.State != TaskState_Preparing {
			continue
		}
		if p, ok := treePrepFor(g.OID, task.ID); ok && !p.requeue {
			continue
		}
		back = append(back, task.ID)
	}
	if len(back) == 0 {
		return nil
	}
	for _, taskID := range back {
		takeTreePrep(g.OID, taskID)
	}
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		for _, taskID := range back {
			if task := taskByID(cur, taskID); task != nil && task.State == TaskState_Preparing {
				task.State = TaskState_Pending
			}
		}
		cur.UpdatedTs = time.Now().UnixMilli()
		return nil
	}); err != nil {
		return fmt.Errorf("sending preparing tasks of a paused dag back to pending: %w", err)
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, g.OID))
	return nil
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// mergeWorktree is the squash-merge seam so tests can drive merge outcomes without a git repo.
var mergeWorktree = MergeRunWorktree

// continueMerge commits a squash merge the caller resolved; a seam so tests skip the real conflict.
var continueMerge = MergeContinue

// mergeLane is what the squash commit of lane names, less its skipped tasks, as laneMergeMessage leaves them
// out of the title.
func mergeLane(g *waveobj.TaskGroup, lane []string) MergeLane {
	var ids []string
	for _, id := range lane {
		if t := taskByID(g, id); t != nil && t.State != TaskState_Skipped {
			ids = append(ids, id)
		}
	}
	return MergeLane{Title: laneMergeMessage(g, lane), TaskIDs: ids}
}

// mergeFailureLimit is how many consecutive refusals the automatic path absorbs before the task blocks
// and asks. Three ticks is ~90s: long enough to ride out the case that motivated this — a stray file in
// the project tree that a human removes moments later — and short enough that nobody watches a run make
// no progress for long.
const mergeFailureLimit = 3

// MergeTask lands the finished lane holding a task on the project branch, stamps the merge and removes the
// lane's tree. It holds the dag mutation lock across reload -> merge -> stamp for two reasons: the engine
// persists a tick as a whole-object replace of a snapshot taken under that lock, so a stamp written outside
// it is silently reverted by any overlapping tick; and two mergers running a squash merge against one project
// tree collide on git's index lock. Nothing inside re-enters the lock (it is not reentrant). The tree is
// removed after the lock is released.
func MergeTask(ctx context.Context, channelID, ownerRunID, taskID string) error {
	return mergeTaskEntry(ctx, channelID, ownerRunID, taskID, false)
}

// ContinueMerge is `dag merge <task> --continue`, the lead's way out of the two landing failures it is
// woken for: it commits a squash merge the caller resolved after a conflict, or re-runs Verify at the
// project's HEAD after the caller committed a fix. Either way the next merge waits for that Verify.
func ContinueMerge(ctx context.Context, channelID, ownerRunID, taskID string) error {
	if channelID == "" || ownerRunID == "" || taskID == "" {
		return fmt.Errorf("channelid, runid and taskid are required")
	}
	owner, err := wstore.GetRun(ctx, channelID, ownerRunID)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	if owner.DagORef == "" {
		return fmt.Errorf("run has no dag")
	}
	g, err := wstore.GetDag(ctx, owner.DagORef)
	if err != nil {
		return err
	}
	task := taskByID(g, taskID)
	if task == nil {
		return fmt.Errorf("no task %q", taskID)
	}
	switch {
	case task.State == TaskState_VerifyFailed:
		return rerunVerify(ctx, channelID, owner, taskID)
	case task.Merged:
		if !task.CleanupPending && task.CleanupError == "" {
			return nil
		}
		return removeLaneTree(ctx, owner.DagORef, taskID)
	case task.State == TaskState_BlockedMerge && task.MergeError != "":
		return retryRefusedMerge(ctx, channelID, owner, taskID)
	case task.State == TaskState_BlockedMerge:
		return continueBlockedMerge(ctx, channelID, owner, g, task)
	}
	return fmt.Errorf("task %s is %s, want blocked-merge or verify-failed", taskID, task.State)
}

// retryRefusedMerge is `--continue` for a merge git refused outright rather than conflicted. The squash
// never applied, so there is no resolved tree to commit: continuing it would run `git commit` over an
// index the merge never touched, and finishMerge reads an empty commit as an idempotent retry and stamps
// the task merged with none of its content. The only correct continuation is the whole merge again.
//
// The retry budget is cleared first so the timeline numbers the human's attempt 1 rather than 4. The task
// stays blocked-merge until it lands: once it has been handed over, the scheduler does not take it back.
func retryRefusedMerge(ctx context.Context, channelID string, owner *waveobj.Run, taskID string) error {
	if err := withDagMutation(owner.DagORef, func() error {
		return clearMergeFailureLocked(ctx, owner.DagORef, taskID)
	}); err != nil {
		return err
	}
	appendRunEvent(ctx, channelID, owner.ID, waveobj.RunEventKindTaskMergeContinued, nil, map[string]any{"taskid": taskID})
	return mergeTaskEntry(ctx, channelID, owner.ID, taskID, false)
}

// continueBlockedMerge commits the resolved project state of a conflicted squash merge, stamps it like
// any merge, and hands the checkout to Verify when the plan has one. The blocked task is its lane's tip.
func continueBlockedMerge(ctx context.Context, channelID string, owner *waveobj.Run, g *waveobj.TaskGroup, task *waveobj.TaskNode) error {
	if task.RunID == "" {
		return fmt.Errorf("task %s has no child run", task.ID)
	}
	if err := checkLandingTree(ctx, owner); err != nil {
		return err
	}
	l, err := claimProject(jarvis.LandPath(owner), owner.DagORef, task.ID)
	if err != nil {
		return err
	}
	appendRunEvent(ctx, channelID, owner.ID, waveobj.RunEventKindTaskMergeContinued, nil, map[string]any{"taskid": task.ID})
	sha, err := continueMerge(ctx, jarvis.LandPath(owner), LaneWorktreeKey(g, task.ID), mergeLane(g, laneOf(g, task.ID)), laneFold(g))
	if err != nil {
		releaseProject(jarvis.LandPath(owner), l)
		return err
	}
	var verify string
	// the stamp is a dag write, and the engine reverts any dag write made outside this lock
	err = withDagMutation(owner.DagORef, func() error {
		var ferr error
		verify, ferr = FinishMergedTask(ctx, channelID, owner.DagORef, task.RunID, task.ID, sha)
		return ferr
	})
	landAfterMerge(channelID, owner, verify, l)
	if rerr := removeLaneTree(ctx, owner.DagORef, task.ID); err == nil {
		err = rerr
	}
	return err
}

func mergeTaskEntry(ctx context.Context, channelID, ownerRunID, taskID string, requireCleanIndex bool) error {
	if channelID == "" || ownerRunID == "" || taskID == "" {
		return fmt.Errorf("channelid, runid and taskid are required")
	}
	owner, err := wstore.GetRun(ctx, channelID, ownerRunID)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	if owner.DagORef == "" {
		return fmt.Errorf("run has no dag")
	}
	l, err := claimProject(jarvis.LandPath(owner), owner.DagORef, taskID)
	if err != nil {
		return err
	}
	var verify string
	err = withDagMutation(owner.DagORef, func() error {
		var lerr error
		verify, lerr = mergeTaskLocked(ctx, channelID, owner, taskID, requireCleanIndex, nil)
		return lerr
	})
	landAfterMerge(channelID, owner, verify, l)
	// after the lock: removal takes tens of seconds, and the workers it stops exit into that lock
	if rerr := removeLaneTree(ctx, owner.DagORef, taskID); err == nil {
		err = rerr
	}
	return err
}

// removeLaneTree removes the tree of the lane holding taskID once the dag lock is released: its debt is recorded
// on the lane's tip. The removal outlives the caller's context, as the merge it finishes did.
func removeLaneTree(ctx context.Context, dagID, taskID string) error {
	ctx = context.WithoutCancel(ctx)
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	tip := laneTip(g, laneOf(g, taskID))
	if tip == nil {
		return nil
	}
	return removeTaskTree(ctx, dagID, tip.ID, true)
}

// landAfterMerge hands the project claim to the Verify a landed merge waits on, or releases it. That Verify judges
// every verifying lane tip, not only this merge's.
func landAfterMerge(channelID string, owner *waveobj.Run, verify string, l *landing) {
	if verify == "" {
		releaseProject(jarvis.LandPath(owner), l)
		return
	}
	startVerify(channelID, owner.DagORef, owner.ID, jarvis.LandPath(owner), verify, l)
}

// errIndexNotClean is the automatic path's refusal: the squash commit commits whatever the index
// holds, so a human's staged edits would land inside the task's commit.
var errIndexNotClean = errors.New("project index is not clean")

// mergeTaskLocked lands the lane holding taskID and returns the plan's Verify command when the landed merge
// now waits on it. A lane lands as one squash commit recorded on its tip, whichever of its tasks was named,
// and only once every task in it is done or skipped. batch is the lane tips the caller merged before this one
// under the same claim: they are verifying, and their Verify waits for this merge.
func mergeTaskLocked(ctx context.Context, channelID string, owner *waveobj.Run, taskID string, requireCleanIndex bool, batch []string) (string, error) {
	g, err := wstore.GetDag(ctx, owner.DagORef)
	if err != nil {
		return "", err
	}
	if taskByID(g, taskID) == nil {
		return "", fmt.Errorf("no task %q", taskID)
	}
	lane := laneOf(g, taskID)
	task := laneTip(g, lane)
	if task == nil {
		return "", fmt.Errorf("task %s: every task in lane %s was skipped, so there is nothing to merge", taskID, strings.Join(lane, ", "))
	}
	if task.Merged {
		// the caller removes a tree still owed a removal, once it releases the lock
		return "", nil
	}
	for _, id := range lane {
		t := taskByID(g, id)
		if t.State == TaskState_Done || t.State == TaskState_Skipped || (t.ID == task.ID && t.State == TaskState_BlockedMerge) {
			continue
		}
		return "", fmt.Errorf("task %s is %s, want done: lane %s lands as one merge once all of it is done", t.ID, t.State, strings.Join(lane, ", "))
	}
	if task.RunID == "" {
		return "", fmt.Errorf("task %s has no child run", task.ID)
	}
	if held := conflictAwaitingContinue(g, task.ID); held != "" {
		return "", fmt.Errorf("%w: task %s's merge conflict is waiting for `wsh jarvis dag merge %s --continue`", errProjectBusy, held, held)
	}
	// recorded like git's own refusals: a scheduler-driven merge has no other place to say it
	if err := checkLandingTree(ctx, owner); err != nil {
		if rerr := recordMergeFailureLocked(ctx, owner.DagORef, task.ID, err.Error(), mergeFailureLimit); rerr != nil {
			return "", errors.Join(err, rerr)
		}
		return "", err
	}
	// a dependent starts at its dependency's merge, so it can finish while that merge's Verify runs or has failed
	if dep := unverifiedDependency(g, lane); dep != nil {
		return "", fmt.Errorf("%w: task %s depends on task %s, which is %s", errProjectBusy, task.ID, dep.ID, dep.State)
	}
	if requireCleanIndex {
		// AutoMergeReady checks this from a read taken before the claim, which misses a Verify that failed
		// and released in between
		for _, state := range []string{TaskState_Verifying, TaskState_VerifyFailed} {
			for _, id := range tasksInState(g, state) {
				if !slices.Contains(batch, id) {
					return "", fmt.Errorf("%w: task %s is %s", errProjectBusy, id, state)
				}
			}
		}
		clean, cerr := IndexClean(ctx, jarvis.LandPath(owner))
		if cerr != nil {
			return "", cerr
		}
		if !clean {
			return "", errIndexNotClean
		}
	}
	childRunID := task.RunID
	// merge-started closes the digest's merge-wait window (task-done -> here): the interval a
	// finished task spent waiting to be landed. Emitted only once the attempt is going ahead, so a
	// refused automatic attempt never opens a window it did not start.
	appendRunEvent(ctx, channelID, owner.ID, waveobj.RunEventKindTaskMergeStarted, nil, map[string]any{"taskid": task.ID})
	sha, err := mergeWorktree(ctx, jarvis.LandPath(owner), LaneWorktreeKey(g, task.ID), mergeLane(g, lane), laneFold(g))
	if err != nil {
		if errors.Is(err, ErrMergeConflict) {
			appendRunEvent(ctx, channelID, owner.ID, waveobj.RunEventKindTaskMergeBlocked, nil, map[string]any{"taskid": task.ID})
			if derr := markBlockedMergeLocked(ctx, owner.DagORef, childRunID); derr != nil {
				return "", derr
			}
			return "", err
		}
		// every other refusal is git declining the squash over the state of the project checkout. It is
		// recorded rather than only returned, because the caller is usually the scheduler, whose only
		// report is a server log line nobody is reading during a run.
		if rerr := recordMergeFailureLocked(ctx, owner.DagORef, task.ID, err.Error(), mergeFailureLimit); rerr != nil {
			return "", errors.Join(err, rerr)
		}
		return "", err
	}
	return FinishMergedTask(ctx, channelID, owner.DagORef, childRunID, task.ID, sha)
}

// conflictAwaitingContinue names a task other than except whose squash merge conflicted and has not been
// continued: blocked-merge with no MergeError. A refused merge records one, and its squash never touched
// the tree. Such a task owns the project: its resolver commits the fix and then continues, and a lane
// landing in between would be the HEAD that --continue credits.
func conflictAwaitingContinue(g *waveobj.TaskGroup, except string) string {
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.ID != except && t.State == TaskState_BlockedMerge && t.MergeError == "" {
			return t.ID
		}
	}
	return ""
}

// mergeVerifyFinal is a task-merged row's "verify" when the final stage's Verify stands for the merge's own.
const mergeVerifyFinal = "final"

// finalVerifyStandsIn reports whether the merge that just landed needs no Verify of its own: nothing is left
// to run, review or merge, so the final stage starts next and runs the whole Verify on this same tree. A fix
// round's merges always verify: its stage already failed once, and a scoped failure names the lane.
func finalVerifyStandsIn(g *waveobj.TaskGroup) bool {
	if g.Verify == "" || g.Final != nil {
		return false
	}
	for i := range g.Tasks {
		t := &g.Tasks[i]
		landed := t.State == TaskState_Done && (t.Merged || !g.MergeRequired) && (!t.Gate || t.Released)
		if !landed && t.State != TaskState_Skipped {
			return false
		}
	}
	return true
}

// FinishMergedTask stamps a landed merge and returns the plan's Verify command when the task now waits on it.
// The caller holds the dag mutation lock, and removes the tree after releasing it.
func FinishMergedTask(ctx context.Context, channelID, dagID, childRunID, taskID, sha string) (string, error) {
	if err := persistMergedTask(ctx, channelID, dagID, childRunID, taskID, sha); err != nil {
		return "", err
	}
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return "", err
	}
	merged := map[string]any{"taskid": taskID, "commit": sha}
	verify := g.Verify
	if task := taskByID(g, taskID); task != nil && task.VerifyDeferred {
		merged["verify"] = mergeVerifyFinal
		verify = ""
	}
	appendRunEvent(ctx, channelID, g.RunID, waveobj.RunEventKindTaskMerged, nil, merged)
	appendRunEvent(ctx, channelID, g.RunID, waveobj.RunEventKindTaskCleanupPending, nil, map[string]any{"taskid": taskID})
	return verify, nil
}

func persistMergedTask(ctx context.Context, channelID, dagID, childRunID, taskID, sha string) error {
	if err := withMutationTx(ctx, func(tx *wstore.TxWrap) error {
		txCtx := tx.Context()
		if err := wstore.UpdateRun(txCtx, channelID, childRunID, func(r *waveobj.Run) error {
			r.EndCommit = sha
			return nil
		}); err != nil {
			return err
		}
		return wstore.UpdateDag(txCtx, dagID, func(cur *waveobj.TaskGroup) error {
			task := taskByID(cur, taskID)
			if task == nil {
				return fmt.Errorf("no task %q", taskID)
			}
			// the squash landed every finished task in the lane; the commit, cleanup and Verify are the tip's
			for _, id := range laneOf(cur, taskID) {
				if t := taskByID(cur, id); t.State == TaskState_Done {
					t.Merged = true
				}
			}
			task.Merged = true
			task.CleanupPending = true
			task.CleanupError = ""
			task.CleanupAttempts = 0
			// the squash landed, so whatever git was refusing over is gone; a later lane must not
			// inherit this one's spent retry budget
			task.MergeFailures, task.MergeError = 0, ""
			// written here, not derived: a continued conflict leaves blocked-merge, which nothing re-derives
			task.State = TaskState_Done
			task.VerifyDeferred = finalVerifyStandsIn(cur)
			if cur.Verify != "" && !task.VerifyDeferred {
				task.State = TaskState_Verifying
				task.VerifyStartedTs = time.Now().UnixMilli()
			}
			RecomputeDagStatus(cur)
			return nil
		})
	}); err != nil {
		return err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, dagID))
	return nil
}

// AutoMergeReady lands every lane whose work is finished and whose gates a human already released.
// Under MergeRequired the merge is what unblocks a dependent in another lane, so leaving it to the
// lead put a language model on the critical path of every edge in the dag; dispatch has always been
// the watchdog's job and this makes the merge match. A conflict still stops at the human: the task
// goes blocked-merge exactly as it does from the RPC, and is not retried on the next tick. Every ready lane
// lands in one batch judged by one Verify; the next batch waits for it, and a failed Verify or a conflict
// waiting for --continue holds every later merge until the lead acts.
func AutoMergeReady(ctx context.Context, dagID string) {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil || g.Status == DagStatus_Cancelled || !g.MergeRequired {
		return
	}
	if len(tasksInState(g, TaskState_VerifyFailed)) > 0 || conflictAwaitingContinue(g, "") != "" {
		return
	}
	if len(tasksInState(g, TaskState_Verifying)) > 0 {
		resumeVerify(ctx, g)
		return
	}
	ready := autoMergeable(g)
	if len(ready) == 0 {
		// nothing is waiting, so nothing is held — including when the merges landed by another path
		noteMergesHeld(ctx, g, 0)
		return
	}
	owner, err := wstore.GetRun(ctx, g.ChannelId, g.RunID)
	if err != nil {
		return
	}
	merged, err := mergeBatch(ctx, g.ChannelId, owner, ready)
	switch {
	case errors.Is(err, errIndexNotClean):
		// the human is mid-edit in the project tree; the lanes stay merge-ready for them and the next
		// tick retries. Reported once per tick, not once per lane.
		log.Printf("dag %s: holding %d merge(s), project index is not clean", g.ID, len(ready)-merged)
		noteMergesHeld(ctx, g, len(ready)-merged)
	case err == nil, errors.Is(err, ErrMergeConflict), errors.Is(err, errProjectBusy):
		// errProjectBusy is another landing's claim: its Verify ticks the dag when it finishes
		noteMergesHeld(ctx, g, 0)
	}
}

// mergeBatch lands each ready lane in order under one project claim, then hands the claim to one Verify for all of
// them. A conflict leaves the tree mid-merge, so no Verify starts: the continue's Verify takes the whole batch.
func mergeBatch(ctx context.Context, channelID string, owner *waveobj.Run, ready []string) (int, error) {
	l, err := claimProject(jarvis.LandPath(owner), owner.DagORef, ready[0])
	if err != nil {
		return 0, err
	}
	var batch []string
	verify := ""
	for _, taskID := range ready {
		var v string
		err = withDagMutation(owner.DagORef, func() error {
			var lerr error
			v, lerr = mergeTaskLocked(ctx, channelID, owner, taskID, true, batch)
			return lerr
		})
		if err == nil {
			batch = append(batch, taskID)
		}
		if v != "" {
			verify = v
		}
		if errors.Is(err, ErrMergeConflict) || errors.Is(err, errIndexNotClean) {
			break
		}
		if err != nil {
			// git refused this lane, or its dependency is verifying (maybe merged earlier in this batch): the rest can still land
			log.Printf("dag %s: auto-merging task %s: %v", owner.DagORef, taskID, err)
			err = nil
		}
	}
	if verify == "" || errors.Is(err, ErrMergeConflict) {
		releaseProject(jarvis.LandPath(owner), l)
	} else {
		startVerify(channelID, owner.DagORef, owner.ID, jarvis.LandPath(owner), verify, l)
	}
	// after the claim moves on, so the batch's Verify does not wait on its cleanups
	for _, id := range batch {
		if rerr := removeLaneTree(ctx, owner.DagORef, id); rerr != nil {
			log.Printf("dag %s task %s: removing its tree: %v", owner.DagORef, id, rerr)
		}
	}
	return len(batch), err
}

// mergesHeld remembers which dags are currently holding their merges on a dirty index, so the hold is
// recorded when it STARTS rather than on every tick. In memory only: a restart re-reports a hold that is
// still in force, which is the harmless direction — the alternative is a hold nobody is ever told about.
var mergesHeld = ds.MakeSyncMap[bool]()

// noteMergesHeld records the transition into holding merges on a dirty project index. held is how many
// merges are waiting, 0 to clear. SetUnless is the transition: only the publish that claims the key
// records a row, so re-entering this every tick says nothing further.
func noteMergesHeld(ctx context.Context, g *waveobj.TaskGroup, held int) {
	if held == 0 {
		mergesHeld.Delete(g.OID)
		return
	}
	if !mergesHeld.SetUnless(g.OID, true) {
		return
	}
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindMergeHeld, nil, map[string]any{
		"held": held, "reason": errIndexNotClean.Error(),
	})
}

// autoMergeable lists the lanes that can be landed without asking anyone, by their tip: every task
// finished or skipped, nothing merged yet, every gate released. blocked-merge is excluded — a conflicted
// tree is the human's. They land in this order in one batch, and the first that cannot land may end it, so the
// lane the most pending tasks wait on goes first, then plan order.
func autoMergeable(g *waveobj.TaskGroup) []string {
	var out []string
	for _, lane := range jarvis.Lanes(g.Tasks) {
		if tip := laneMergeReady(g, lane); tip != nil {
			out = append(out, tip.ID)
		}
	}
	slices.SortStableFunc(out, func(a, b string) int { return waitingOn(g, b) - waitingOn(g, a) })
	return out
}

// unverifiedDependency returns a task in another lane that lane depends on and whose Verify is running or failed.
func unverifiedDependency(g *waveobj.TaskGroup, lane []string) *waveobj.TaskNode {
	for _, id := range lane {
		for _, depID := range taskByID(g, id).Deps {
			dep := taskByID(g, depID)
			if dep != nil && !slices.Contains(lane, depID) && (dep.State == TaskState_Verifying || dep.State == TaskState_VerifyFailed) {
				return dep
			}
		}
	}
	return nil
}

// waitingOn counts the pending tasks that depend on tipID's lane, directly or through other tasks.
func waitingOn(g *waveobj.TaskGroup, tipID string) int {
	behind := map[string]bool{}
	for _, id := range laneOf(g, tipID) {
		behind[id] = true
	}
	// to a fixed point, since nothing promises a JSON dag lists its tasks in dependency order
	for grew := true; grew; {
		grew = false
		for i := range g.Tasks {
			t := &g.Tasks[i]
			if behind[t.ID] {
				continue
			}
			if slices.ContainsFunc(t.Deps, func(d string) bool { return behind[d] }) {
				behind[t.ID], grew = true, true
			}
		}
	}
	// the lane's own tasks are done, never pending, so only the tasks behind it count
	n := 0
	for id := range behind {
		if t := taskByID(g, id); t != nil && t.State == TaskState_Pending {
			n++
		}
	}
	return n
}

// IndexClean reports whether the project has nothing staged. Unstaged edits are left alone by the
// squash commit (it commits the index, with no pathspec) and an overlapping one makes git refuse the
// merge outright, so the index is the whole hazard. Unmerged entries from an earlier conflict also
// read as not clean, which is what keeps the automatic path off a tree mid-merge.
func IndexClean(ctx context.Context, projectPath string) (bool, error) {
	if _, err := git(ctx, projectPath, "diff", "--cached", "--quiet"); err != nil {
		// exit 1 is "there are staged changes", not a failure to ask about.
		return false, nil
	}
	return true, nil
}

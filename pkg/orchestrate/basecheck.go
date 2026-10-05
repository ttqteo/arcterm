// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"slices"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Base Check states (TaskGroup.BaseCheck.State).
const (
	BaseCheckState_Running = "running"
	BaseCheckState_Passed  = "passed"
	BaseCheckState_Failed  = "failed"
	BaseCheckState_Skipped = "skipped"
)

// baseCheckFinished is called once a base Check's result is recorded. A var so tests can wait for it.
var baseCheckFinished = func(dagID string) {}

// baseCheckRuns marks the dags whose base Check is running. In memory only: a restart finds the state still
// running and starts it again, on the commit recorded at the first start.
var baseCheckRuns = ds.MakeSyncMap[bool]()

func baseCheckFailed(g *waveobj.TaskGroup) bool {
	return g.BaseCheck != nil && g.BaseCheck.State == BaseCheckState_Failed
}

// advanceBaseCheck runs the plan's Check once on the commit the lanes start from, before any task: a base
// another session broke then fails that one Check, instead of every worker's, and the final stage does not
// take it for the run's. It runs beside the plan review, which usually outlasts it. The caller holds the dag
// mutation lock.
func advanceBaseCheck(ctx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, afterCommit *[]func()) {
	if g.Check == "" || (g.BaseCheck != nil && g.BaseCheck.State != BaseCheckState_Running) {
		return
	}
	if g.BaseCheck == nil {
		// only before any task started: after that the head holds the run's own lanes, not the base
		if slices.ContainsFunc(g.Tasks, func(t waveobj.TaskNode) bool { return t.State != TaskState_Pending }) || !IsGitRepo(owner.ProjectPath) {
			return
		}
		head, err := landingHead(ctx, owner)
		if err != nil {
			g.BaseCheck = &waveobj.BaseCheck{State: BaseCheckState_Skipped, Detail: "reading the base commit: " + err.Error()}
			return
		}
		g.BaseCheck = &waveobj.BaseCheck{State: BaseCheckState_Running, Commit: head}
	}
	dagID, runID, project, commit, setup, check := g.OID, owner.ID, owner.ProjectPath, g.BaseCheck.Commit, g.Setup, g.Check
	*afterCommit = append(*afterCommit, func() { startBaseCheck(dagID, runID, project, commit, setup, check) })
}

func startBaseCheck(dagID, runID, project, commit, setup, check string) {
	if !baseCheckRuns.SetUnless(dagID, true) {
		return
	}
	goStage("basecheck "+dagID, func() {
		defer baseCheckFinished(dagID)
		defer baseCheckRuns.Delete(dagID)
		ctx := context.Background()
		state, detail := runBaseCheck(ctx, runID, project, commit, setup, check)
		if err := WithDagMutation(dagID, func() error { return recordBaseCheckLocked(ctx, dagID, setup, check, state, detail) }); err != nil {
			log.Printf("dag %s: recording the base Check: %v", dagID, err)
		}
	})
}

// treeStepError is a step of a detached tree that could not run, as against the command run in it failing.
type treeStepError struct {
	step string
	err  error
}

func (e *treeStepError) Error() string { return e.step + ": " + e.err.Error() }
func (e *treeStepError) Unwrap() error { return e.err }

// withDetachedTree runs fn in a tree detached at commit, never in a tree anyone works in, after the plan's Setup, and
// removes the tree.
func withDetachedTree(ctx context.Context, project, name, label, commit, setup string, fn func(wt string) error) error {
	wt := worktreeDir(project, name)
	if _, err := os.Stat(wt); err == nil {
		if err := removeWorktreeDir(ctx, project, wt); err != nil {
			return &treeStepError{"removing a stale " + label, err}
		}
	}
	if _, err := addWorktree(ctx, project, "--detach", wt, commit); err != nil {
		return &treeStepError{"creating the " + label, err}
	}
	defer func() {
		if err := removeWorktreeDir(context.Background(), project, wt); err != nil {
			log.Printf("removing the %s %s: %v", label, wt, err)
		}
	}()
	if setup != "" {
		if _, err := runPlanCommand(ctx, wt, setup, nil, SetupTimeout, nil); err != nil {
			return &treeStepError{"Setup failed in the " + label, errors.New(failureDetail(err))}
		}
	}
	return fn(wt)
}

// runBaseCheck runs Check in a detached tree at commit.
func runBaseCheck(ctx context.Context, runID, project, commit, setup, check string) (string, string) {
	err := withDetachedTree(ctx, project, runID+"-base", "base tree", commit, setup, func(wt string) error {
		_, err := runPlanCommand(ctx, wt, check, nil, VerifyTimeout, nil)
		return err
	})
	if err == nil {
		return BaseCheckState_Passed, ""
	}
	var se *treeStepError
	if errors.As(err, &se) {
		return BaseCheckState_Skipped, err.Error()
	}
	var pe *planCommandError
	if errors.As(err, &pe) {
		return BaseCheckState_Failed, failureDetail(err)
	}
	return BaseCheckState_Skipped, "running Check: " + err.Error()
}

func recordBaseCheckLocked(ctx context.Context, dagID, setup, check, state, detail string) error {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return err
	}
	if g.Status == DagStatus_Cancelled || g.BaseCheck == nil || g.BaseCheck.State != BaseCheckState_Running {
		return nil
	}
	// a revised plan changed the commands while this ran; the next tick checks the new ones
	if g.Check != check || g.Setup != setup {
		return nil
	}
	if state == BaseCheckState_Skipped {
		log.Printf("dag %s: the base Check could not run: %s", dagID, detail)
	}
	g.BaseCheck.State, g.BaseCheck.Detail = state, detail
	g.UpdatedTs = time.Now().UnixMilli()
	if err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		cur.BaseCheck = g.BaseCheck
		cur.UpdatedTs = g.UpdatedTs
		return nil
	}); err != nil {
		return err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, dagID))
	if state == BaseCheckState_Failed {
		PostWake(ctx, g.ChannelId, g.RunID, baseCheckFailedWake(g.Check, detail))
	}
	return nil
}

// sharedCheckFailure names a Check failure on a tree that holds a base whose Check already failed. The two outputs
// are shown side by side, since nothing tells the base's failures from ones the run added.
func sharedCheckFailure(g *waveobj.TaskGroup, where, detail string) string {
	return fmt.Sprintf("Check `%s` fails on %s (%s), and it already failed on the base before any task (%s); the failures may include failures the run introduced", g.Check, where, detail, g.BaseCheck.Detail)
}

// baseCheckFailedWake carries the cause, since the digest does not show the base Check.
func baseCheckFailedWake(check, detail string) string {
	return fmt.Sprintf("wake: the plan's Check `%s` already fails on the base, before any task (%s). Workers are told those failures are not theirs, and the final stage reports a Check failure as unverified, not failed. Fix the base if it is yours to fix.", check, detail)
}

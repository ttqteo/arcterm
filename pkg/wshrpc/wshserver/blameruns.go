// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"os/exec"
	"slices"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	runBranchPrefix      = "wave/"
	landedCreditParallel = 8
)

// a landed run's merge never changes, so its credited commits are read once per process, a failed read included
var (
	landedCreditMu sync.Mutex
	landedCredit   = map[string][]string{} // run id -> credited shas
)

// revList is a seam so tests can count the git reads.
var revList = func(ctx context.Context, cwd string, args ...string) ([]string, error) {
	out, err := exec.CommandContext(ctx, "git", append([]string{"-C", cwd, "rev-list"}, args...)...).Output()
	if err != nil {
		return nil, fmt.Errorf("git rev-list %s in %s: %w", strings.Join(args, " "), cwd, err)
	}
	return strings.Fields(string(out)), nil
}

func isLandedWithCommits(run *waveobj.Run) bool {
	return run.Land != nil && run.Land.State == orchestrate.LandState_Landed && run.Land.Commit != "" && run.EndCommit != ""
}

// landedRunCommits is what a landed run is credited with. A fast-forward land credits the run's own first-parent
// commits since its base. A merge land credits the merge's second side, but only when that side took in the
// run's EndCommit: a merge that did not is someone else's.
func landedRunCommits(ctx context.Context, run *waveobj.Run) ([]string, error) {
	commit := run.Land.Commit
	if commit == run.EndCommit {
		if run.BaseCommit == "" {
			return nil, nil
		}
		return revList(ctx, run.ProjectPath, "--first-parent", "--no-merges", run.BaseCommit+".."+commit)
	}
	side, err := revList(ctx, run.ProjectPath, commit+"^1.."+commit+"^2")
	if err != nil {
		return nil, err
	}
	if slices.Contains(side, run.EndCommit) {
		return side, nil
	}
	return nil, nil
}

// cachedLandedCommits fills the cache for every landed run it lacks, landedCreditParallel at a time.
func cachedLandedCommits(ctx context.Context, landed []*waveobj.Run) map[string][]string {
	landedCreditMu.Lock()
	var missing []*waveobj.Run
	for _, run := range landed {
		if _, ok := landedCredit[run.OID]; !ok {
			missing = append(missing, run)
		}
	}
	landedCreditMu.Unlock()

	sem := make(chan struct{}, landedCreditParallel)
	var wg sync.WaitGroup
	for _, run := range missing {
		wg.Add(1)
		sem <- struct{}{}
		go func(run *waveobj.Run) {
			defer wg.Done()
			defer func() { <-sem }()
			commits, err := landedRunCommits(ctx, run)
			if err != nil {
				if ctx.Err() != nil {
					// cancelled, not failed: the next blame reads it again
					return
				}
				log.Printf("blame: crediting landed run %s: %v", run.OID, err)
				commits = nil
			}
			landedCreditMu.Lock()
			landedCredit[run.OID] = commits
			landedCreditMu.Unlock()
		}(run)
	}
	wg.Wait()

	out := make(map[string][]string, len(landed))
	landedCreditMu.Lock()
	defer landedCreditMu.Unlock()
	for _, run := range landed {
		out[run.OID] = landedCredit[run.OID]
	}
	return out
}

// liveRunCommits credits the run whose wave/<runId> branch cwd has checked out with its first-parent non-merge
// commits since its base: lane merges are squash commits on that chain, and a merge of main is not the run's.
func liveRunCommits(ctx context.Context, cwd string, runs []*waveobj.Run) (*waveobj.Run, []string, error) {
	branch, err := gitinfo.CurrentBranch(ctx, cwd)
	if err != nil || !strings.HasPrefix(branch, runBranchPrefix) {
		// an unborn HEAD or a non-repo blames no commits, so there is nothing to credit
		return nil, nil, nil
	}
	runId := strings.TrimPrefix(branch, runBranchPrefix)
	for _, run := range runs {
		if run.OID == runId && run.BaseCommit != "" {
			commits, err := revList(ctx, cwd, "--first-parent", "--no-merges", run.BaseCommit+"..HEAD")
			return run, commits, err
		}
	}
	return nil, nil, nil
}

// runsForCommits maps each of shas that a run is credited with to that run. Other shas get no entry.
func runsForCommits(ctx context.Context, cwd string, shas []string) (map[string]wshrpc.GitBlameRun, error) {
	want := make(map[string]bool, len(shas))
	for _, sha := range shas {
		want[sha] = true
	}
	runs, err := wstore.DBGetAllObjsByType[*waveobj.Run](ctx, waveobj.OType_Run)
	if err != nil {
		return nil, fmt.Errorf("reading runs: %w", err)
	}
	out := make(map[string]wshrpc.GitBlameRun)
	credit := func(run *waveobj.Run, commits []string) {
		for _, sha := range commits {
			if want[sha] {
				out[sha] = wshrpc.GitBlameRun{RunId: run.OID, Goal: run.Goal}
			}
		}
	}

	var landed []*waveobj.Run
	for _, run := range runs {
		if isLandedWithCommits(run) {
			landed = append(landed, run)
		}
	}
	byRun := cachedLandedCommits(ctx, landed)
	for _, run := range landed {
		credit(run, byRun[run.OID])
	}

	liveRun, liveCommits, err := liveRunCommits(ctx, cwd, runs)
	if err != nil {
		return out, fmt.Errorf("crediting live run %s: %w", liveRun.OID, err)
	}
	if liveRun != nil {
		credit(liveRun, liveCommits)
	}
	return out, nil
}

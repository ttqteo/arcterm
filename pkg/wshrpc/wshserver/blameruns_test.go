// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// blameCommit makes an empty commit and returns its sha. The subject is made unique: two repos' empty commits
// with one parent, subject and second would share a sha, and runs from other tests would credit it.
func blameCommit(git func(args ...string) string, subject string) string {
	git("commit", "--allow-empty", "-m", subject+" "+uuid.NewString())
	return git("rev-parse", "HEAD")
}

func seedBlameRun(t *testing.T, dir string, run waveobj.Run) waveobj.Run {
	t.Helper()
	ch, err := wstore.CreateChannel(context.Background(), "blame-"+run.ID[:8], dir)
	if err != nil {
		t.Fatal(err)
	}
	run.ProjectPath = dir
	if err := wstore.AppendRun(context.Background(), ch.OID, run); err != nil {
		t.Fatal(err)
	}
	return run
}

func landedRun(base, end, landCommit string) waveobj.Run {
	return waveobj.Run{ID: uuid.NewString(), Goal: "blame goal", BaseCommit: base, EndCommit: end,
		Land: &waveobj.RunLand{State: "landed", Commit: landCommit}}
}

func assertCredit(t *testing.T, dir string, runId string, credited, notCredited []string) {
	t.Helper()
	got, err := runsForCommits(context.Background(), dir, append(append([]string{}, credited...), notCredited...))
	if err != nil {
		t.Fatal(err)
	}
	for _, sha := range credited {
		if got[sha].RunId != runId || got[sha].Goal != "blame goal" {
			t.Errorf("%s: want credited to %s, got %+v", sha, runId, got[sha])
		}
	}
	for _, sha := range notCredited {
		if r, ok := got[sha]; ok {
			t.Errorf("%s: want no credit, got %+v", sha, r)
		}
	}
}

// noFFFixture lands wave/x (two commits) into main with --no-ff after main moved on; it returns base,
// the branch commits, main's own commit and the merge.
func noFFFixture(t *testing.T) (dir, base, b1, b2, m1, merge string) {
	dir, git := newLandingRepo(t)
	base = git("rev-parse", "HEAD")
	git("checkout", "-b", "wave/x")
	b1 = blameCommit(git, "task 1")
	b2 = blameCommit(git, "task 2")
	git("checkout", "main")
	m1 = blameCommit(git, "main work")
	git("merge", "--no-ff", "-m", "land wave/x", "wave/x")
	merge = git("rev-parse", "HEAD")
	return
}

func TestRunsForCommitsNoFF(t *testing.T) {
	dir, base, b1, b2, m1, merge := noFFFixture(t)
	run := seedBlameRun(t, dir, landedRun(base, b2, merge))
	assertCredit(t, dir, run.ID, []string{b1, b2}, []string{m1, base, merge})
}

func TestRunsForCommitsNoFFMovedTip(t *testing.T) {
	dir, git := newLandingRepo(t)
	base := git("rev-parse", "HEAD")
	git("checkout", "-b", "wave/x")
	b1 := blameCommit(git, "task 1")
	end := blameCommit(git, "task 2")
	b3 := blameCommit(git, "fix after completion")
	git("checkout", "main")
	git("merge", "--no-ff", "-m", "land wave/x", "wave/x")
	run := seedBlameRun(t, dir, landedRun(base, end, git("rev-parse", "HEAD")))
	assertCredit(t, dir, run.ID, []string{b1, end, b3}, []string{base})
}

func TestRunsForCommitsNoFFForeignMerge(t *testing.T) {
	dir, git := newLandingRepo(t)
	base := git("rev-parse", "HEAD")
	git("checkout", "-b", "wave/x")
	end := blameCommit(git, "task 1")
	git("checkout", "-b", "other", "main")
	o1 := blameCommit(git, "other work")
	git("checkout", "main")
	git("merge", "--no-ff", "-m", "merge other", "other")
	run := seedBlameRun(t, dir, landedRun(base, end, git("rev-parse", "HEAD")))
	assertCredit(t, dir, run.ID, nil, []string{end, o1})
}

func TestRunsForCommitsFastForward(t *testing.T) {
	dir, git := newLandingRepo(t)
	base := git("rev-parse", "HEAD")
	git("checkout", "-b", "wave/x")
	b1 := blameCommit(git, "task 1")
	git("checkout", "main")
	m1 := blameCommit(git, "main work")
	git("checkout", "wave/x")
	git("merge", "--no-ff", "-m", "Merge main into wave/x", "main")
	mm := git("rev-parse", "HEAD")
	b2 := blameCommit(git, "task 2")
	run := seedBlameRun(t, dir, landedRun(base, b2, b2))
	assertCredit(t, dir, run.ID, []string{b1, b2}, []string{mm, m1, base})
}

func TestRunsForCommitsNoEndCommit(t *testing.T) {
	dir, base, b1, b2, _, merge := noFFFixture(t)
	run := seedBlameRun(t, dir, landedRun(base, "", merge))
	assertCredit(t, dir, run.ID, nil, []string{b1, b2})
}

func TestRunsForCommitsLiveBranch(t *testing.T) {
	dir, git := newLandingRepo(t)
	base := git("rev-parse", "HEAD")
	run := seedBlameRun(t, dir, waveobj.Run{ID: uuid.NewString(), Goal: "blame goal", BaseCommit: base})
	git("checkout", "-b", "wave/"+run.ID)
	b1 := blameCommit(git, "task 1")
	git("checkout", "main")
	m1 := blameCommit(git, "main work")
	git("checkout", "wave/"+run.ID)
	git("merge", "--no-ff", "-m", "Merge main into wave", "main")
	mm := git("rev-parse", "HEAD")
	b2 := blameCommit(git, "task 2")
	assertCredit(t, dir, run.ID, []string{b1, b2}, []string{mm, m1, base})
}

func TestRunsForCommitsCachesLanded(t *testing.T) {
	dir, base, b1, b2, _, merge := noFFFixture(t)
	run := seedBlameRun(t, dir, landedRun(base, b2, merge))
	var mu sync.Mutex
	calls := 0
	prev := revList
	revList = func(ctx context.Context, cwd string, args ...string) ([]string, error) {
		if cwd == dir {
			mu.Lock()
			calls++
			mu.Unlock()
		}
		return prev(ctx, cwd, args...)
	}
	t.Cleanup(func() { revList = prev })
	assertCredit(t, dir, run.ID, []string{b1, b2}, nil)
	if calls == 0 {
		t.Fatal("the first call must read the landed run's commits")
	}
	first := calls
	assertCredit(t, dir, run.ID, []string{b1, b2}, nil)
	if calls != first {
		t.Fatalf("the second call reran git for a landed run: %d calls, want %d", calls, first)
	}
}

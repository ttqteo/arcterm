// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const (
	runDone    = "11111111-1111-1111-1111-111111111111"
	runGoing   = "22222222-2222-2222-2222-222222222222"
	runOrphan  = "33333333-3333-3333-3333-333333333333"
	runDirtyID = "44444444-4444-4444-4444-444444444444"
	runLanding = "55555555-5555-5555-5555-555555555555"
)

func git(t *testing.T, dir string, args ...string) {
	t.Helper()
	if out, err := gitOut(context.Background(), dir, args...); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func newRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	git(t, dir, "init", "-q")
	git(t, dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
	return dir
}

// addTree links an engine-shaped worktree <repo>/.waveterm/worktrees/<key> on branch wave/<key>
func addTree(t *testing.T, repo, key string) string {
	t.Helper()
	wt := filepath.Join(worktreesRoot(repo), key)
	git(t, repo, "worktree", "add", "-q", "-b", "wave/"+key, wt)
	writeFile(t, filepath.Join(wt, "out.bin"), 100)
	git(t, wt, "add", "out.bin")
	git(t, wt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "work")
	return wt
}

func worktreeEnv(repo string, runs map[string]RunState) *Env {
	return &Env{
		Now:          time.Now,
		ProjectPaths: func() []string { return []string{repo} },
		RunOfWorktree: func(p string) (string, bool) {
			name := filepath.Base(p)
			if len(name) < 36 {
				return "", false
			}
			return name[:36], true
		},
		RunState: func(_ context.Context, id string) (RunState, error) { return runs[id], nil },
		RemoveWorktree: func(ctx context.Context, project, wt string) error {
			_, _ = gitOut(ctx, project, "worktree", "remove", "--force", wt)
			return os.RemoveAll(wt)
		},
	}
}

func TestRunWorktreesJudgeEachTree(t *testing.T) {
	repo := newRepo(t)
	done := addTree(t, repo, runDone)
	going := addTree(t, repo, runGoing)
	orphan := addTree(t, repo, runOrphan)
	dirty := addTree(t, repo, runDirtyID)
	landing := addTree(t, repo, runLanding)
	writeFile(t, filepath.Join(dirty, "uncommitted.txt"), 10)
	env := worktreeEnv(repo, map[string]RunState{
		runDone:    {Found: true, Finished: true, Status: "done"},
		runGoing:   {Found: true, Status: "executing"},
		runDirtyID: {Found: true, Finished: true, Status: "cancelled"},
		runLanding: {Found: true, Status: "landing"},
	})
	rep := runWorktrees{}.measure(context.Background(), env)
	if it := itemByID(rep.Items, done); !it.Cleanable || it.Guarded || it.Bytes < 100 {
		t.Fatalf("a finished, committed tree must be cleanable: %+v", it)
	}
	if it := itemByID(rep.Items, going); it.Cleanable || it.Reason != "run still running" {
		t.Fatalf("a running run's tree must stay: %+v", it)
	}
	if it := itemByID(rep.Items, landing); it.Cleanable || it.Reason != "run still landing" {
		t.Fatalf("a run whose land is pending keeps its trees: %+v", it)
	}
	if it := itemByID(rep.Items, orphan); !it.Cleanable {
		t.Fatalf("a tree no run claims counts as finished: %+v", it)
	}
	if it := itemByID(rep.Items, dirty); it.Cleanable || !it.Guarded || it.Reason != "has uncommitted changes" {
		t.Fatalf("a finished tree with changes must be guarded: %+v", it)
	}
}

func TestCleanRemovesFinishedTreesAndKeepsTheirBranches(t *testing.T) {
	repo := newRepo(t)
	done := addTree(t, repo, runDone)
	env := worktreeEnv(repo, map[string]RunState{runDone: {Found: true, Finished: true, Status: "done"}})
	res := runWorktrees{}.clean(context.Background(), env, []string{done}, CleanOpts{})
	if len(res.Cleaned) != 1 || res.Reclaimed < 100 {
		t.Fatalf("got %+v, want the tree removed and its bytes counted", res)
	}
	if _, err := os.Stat(done); err == nil {
		t.Fatal("the tree must be gone")
	}
	if out, _ := gitOut(context.Background(), repo, "branch", "--list", "wave/"+runDone); out == "" {
		t.Fatal("the branch must stay")
	}
}

func TestCleanReChecksTheRunAtRemoval(t *testing.T) {
	repo := newRepo(t)
	wt := addTree(t, repo, runDone)
	// the scan saw it done; by the click the run is going again
	env := worktreeEnv(repo, map[string]RunState{runDone: {Found: true, Status: "executing"}})
	res := runWorktrees{}.clean(context.Background(), env, []string{wt}, CleanOpts{})
	if len(res.Cleaned) != 0 || len(res.Skipped) != 1 || res.Skipped[0].Reason != "run still running" {
		t.Fatalf("got %+v, want it skipped because its run is going", res)
	}
}

func TestGuardedTreeNeedsItsOwnButton(t *testing.T) {
	repo := newRepo(t)
	wt := addTree(t, repo, runDirtyID)
	writeFile(t, filepath.Join(wt, "uncommitted.txt"), 10)
	env := worktreeEnv(repo, map[string]RunState{runDirtyID: {Found: true, Finished: true, Status: "done"}})
	if res := (runWorktrees{}).clean(context.Background(), env, []string{wt}, CleanOpts{}); len(res.Cleaned) != 0 {
		t.Fatal("Clean all must leave a tree with uncommitted changes")
	}
	if res := (runWorktrees{}).clean(context.Background(), env, []string{wt}, CleanOpts{AllowGuarded: true, Auto: true}); len(res.Cleaned) != 0 {
		t.Fatal("auto-clean must never remove a tree with uncommitted changes")
	}
	if res := (runWorktrees{}).clean(context.Background(), env, []string{wt}, CleanOpts{AllowGuarded: true}); len(res.Cleaned) != 1 {
		t.Fatalf("its own button removes it: %+v", res)
	}
}

func TestWorktreeThatIsNotAnEngineTreeIsNeverCleaned(t *testing.T) {
	repo := newRepo(t)
	scratch := filepath.Join(worktreesRoot(repo), "scratch")
	writeFile(t, filepath.Join(scratch, "notes.txt"), 7)
	env := worktreeEnv(repo, nil)
	rep := runWorktrees{}.measure(context.Background(), env)
	if it := itemByID(rep.Items, scratch); it.Cleanable || it.Reason != "not a run worktree" {
		t.Fatalf("a directory the engine did not make must stay: %+v", it)
	}
	for _, opts := range []CleanOpts{{}, {AllowGuarded: true}, {Auto: true}} {
		if res := (runWorktrees{}).clean(context.Background(), env, []string{scratch}, opts); len(res.Cleaned) != 0 {
			t.Fatalf("cleaned a non-engine directory with %+v", opts)
		}
	}
	if _, err := os.Stat(scratch); err != nil {
		t.Fatal("it must still be there")
	}
}

// settings-storage's "Couldn't scan" step stands on this: a project whose .waveterm/worktrees is a file. ReadDir's
// error there must not read as "no worktrees" on any OS.
func TestAWorktreesRootThatIsAFileIsAScanError(t *testing.T) {
	repo := newRepo(t)
	writeFile(t, worktreesRoot(repo), 3)
	if rep := (runWorktrees{}).measure(context.Background(), worktreeEnv(repo, nil)); rep.Error == "" {
		t.Fatalf("want a scan error, got %+v", rep)
	}
}

func TestCleanRefusesAPathOutsideTheProjectsWorktrees(t *testing.T) {
	repo := newRepo(t)
	env := worktreeEnv(repo, nil)
	res := runWorktrees{}.clean(context.Background(), env, []string{filepath.Join(repo, "src")}, CleanOpts{AllowGuarded: true})
	if len(res.Skipped) != 1 || len(res.Cleaned) != 0 {
		t.Fatalf("got %+v, want the path refused", res)
	}
}

// addSharedTree links an engine-shaped worktree <root>/<key> on branch wave/<key>, as the shared root lays them out
func addSharedTree(t *testing.T, repo, root, key string) string {
	t.Helper()
	wt := filepath.Join(root, key)
	git(t, repo, "worktree", "add", "-q", "-b", "wave/"+key, wt)
	writeFile(t, filepath.Join(wt, "out.bin"), 100)
	return wt
}

func TestSharedRootTreesAreListedAndCleaned(t *testing.T) {
	repo := newRepo(t)
	root := t.TempDir()
	done := addSharedTree(t, repo, root, runDone)
	going := addSharedTree(t, repo, root, runGoing)
	foreign := addSharedTree(t, repo, root, runOrphan)
	for _, wt := range []string{done, going, foreign} {
		git(t, wt, "add", "out.bin")
		git(t, wt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "work")
	}
	writeFile(t, filepath.Join(root, runDone[:8]+".run"), 36)
	env := worktreeEnv(repo, map[string]RunState{
		runDone:  {Found: true, Finished: true, Status: "done"},
		runGoing: {Found: true, Status: "executing"},
	})
	env.WorktreeRoot = func() string { return root }

	rep := runWorktrees{}.measure(context.Background(), env)
	if it := itemByID(rep.Items, done); !it.Cleanable || it.Bytes < 100 || !strings.HasPrefix(it.Detail, filepath.Base(repo)) {
		t.Fatalf("a finished run's shared tree must be listed under its project and cleanable: %+v", it)
	}
	if it := itemByID(rep.Items, going); it.Cleanable || it.Reason != "run still running" {
		t.Fatalf("a running run's shared tree must stay: %+v", it)
	}
	// the dev app and the packaged one share the root: a run this store lacks may be the other app's live one
	if it := itemByID(rep.Items, foreign); it.Cleanable || !it.Guarded {
		t.Fatalf("a shared tree whose run this store lacks must be guarded: %+v", it)
	}
	if len(rep.Items) != 3 {
		t.Fatalf("the .run marker is not a tree: %+v", rep.Items)
	}

	if res := (runWorktrees{}).clean(context.Background(), env, []string{done, foreign}, CleanOpts{AllowGuarded: true, Auto: true}); len(res.Cleaned) != 1 || res.Cleaned[0] != done {
		t.Fatalf("auto-clean removes the finished tree only: %+v", res)
	}
	if _, err := os.Stat(done); err == nil {
		t.Fatal("the finished tree must be gone")
	}
	if out, _ := gitOut(context.Background(), repo, "branch", "--list", "wave/"+runDone); out == "" {
		t.Fatal("its branch must stay")
	}
	if res := (runWorktrees{}).clean(context.Background(), env, []string{foreign}, CleanOpts{AllowGuarded: true}); len(res.Cleaned) != 1 {
		t.Fatalf("its own button removes the foreign tree: %+v", res)
	}
}

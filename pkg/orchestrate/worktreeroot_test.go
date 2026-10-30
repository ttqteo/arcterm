// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// useRoot points the test at a fresh worktree root and returns it.
func useRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	t.Cleanup(UseWorktreeRootForTest(root))
	return root
}

// samePrefixRunID is a run id other than id sharing its first eight chars.
func samePrefixRunID(id string) string {
	other := id[:runPrefixLen] + "-0000-4000-8000-000000000000"
	if other == id {
		other = id[:runPrefixLen] + "-1111-4000-8000-000000000000"
	}
	return other
}

func readMarker(t *testing.T, root, id string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(root, id[:runPrefixLen]+runMarkerExt))
	if err != nil {
		t.Fatalf("reading the prefix marker: %v", err)
	}
	return string(b)
}

func assertNoMarker(t *testing.T, root, id string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(root, id[:runPrefixLen]+runMarkerExt)); !os.IsNotExist(err) {
		t.Fatalf("no marker should be written, stat err %v", err)
	}
}

func TestWorktreeDirMapping(t *testing.T) {
	root := useRoot(t)
	project := t.TempDir()
	id := uuid.NewString()
	short := id[:runPrefixLen]
	for key, want := range map[string]string{
		id:             short,
		id + "-t-3":    short + "-t-3",
		id + "-final":  short + "-final",
		id + "-base":   short + "-base",
		id + "-bisect": short + "-bisect",
		"run-1-t-0":    "run-1-t-0",
		// not a run id followed by a suffix
		id + "x": id + "x",
	} {
		if got := worktreeDir(project, key); got != filepath.Join(root, want) {
			t.Errorf("worktreeDir(%s) = %s, want %s", key, got, filepath.Join(root, want))
		}
	}
	held := worktreeDir(project, id+"-final")
	if err := os.MkdirAll(held, 0o755); err != nil {
		t.Fatal(err)
	}
	if got, want := freeFinalTreeDir(held), filepath.Join(root, short+"-final-2"); got != want {
		t.Fatalf("the stand-in beside a held final tree = %s, want %s", got, want)
	}
}

func TestWorktreeDirLegacyWins(t *testing.T) {
	root := useRoot(t)
	project := t.TempDir()
	id := uuid.NewString()
	key := id + "-t-1"
	short := filepath.Join(root, id[:runPrefixLen]+"-t-1")
	if got := worktreeDir(project, key); got != short {
		t.Fatalf("with no legacy tree, worktreeDir = %s, want %s", got, short)
	}
	legacy := filepath.Join(project, ".waveterm", "worktrees", key)
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := worktreeDir(project, key); got != legacy {
		t.Fatalf("worktreeDir = %s, want the legacy tree %s", got, legacy)
	}
	got, err := claimWorktreeDir(project, key)
	if err != nil || got != legacy {
		t.Fatalf("claimWorktreeDir = %s, %v; want the legacy tree %s", got, err, legacy)
	}
	assertNoMarker(t, root, id)
}

// a lane tree made before the root moved is reused by the lane's next task, removed from where it is, and made
// again under the short root
func TestEnsureRunWorktreeKeepsALegacyLaneTree(t *testing.T) {
	ctx := context.Background()
	dir := newGitRepo(t)
	root := worktreeRoot()
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	key := uuid.NewString() + "-t-1"
	restore := UseWorktreeRootForTest("")
	legacy, err := CreateRunWorktree(ctx, dir, key, base)
	restore()
	if err != nil {
		t.Fatal(err)
	}
	if legacy != filepath.Join(dir, ".waveterm", "worktrees", key) {
		t.Fatalf("the tree made before the move is at %s, want the legacy path", legacy)
	}
	wt, _, created, err := EnsureRunWorktree(ctx, dir, key, base)
	if err != nil || created || wt != legacy {
		t.Fatalf("EnsureRunWorktree = %s created %v err %v; want the legacy tree reused", wt, created, err)
	}
	if err := RemoveRunWorktree(ctx, dir, key); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("cleanup removes the legacy tree, stat err %v", err)
	}
	wt, _, created, err = EnsureRunWorktree(ctx, dir, key, base)
	if err != nil || !created || wt != filepath.Join(root, key[:runPrefixLen]+"-t-1") {
		t.Fatalf("EnsureRunWorktree = %s created %v err %v; want a new tree under the short root", wt, created, err)
	}
}

func TestWorktreeDirForeignPrefixNeverShared(t *testing.T) {
	ctx := context.Background()
	dir := newGitRepo(t)
	root := worktreeRoot()
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	id := uuid.NewString()
	other := samePrefixRunID(id)

	otherTree, err := CreateRunWorktree(ctx, dir, other+"-t-1", base)
	if err != nil {
		t.Fatal(err)
	}
	if otherTree != filepath.Join(root, id[:runPrefixLen]+"-t-1") {
		t.Fatalf("the prefix's first run gets the short path, got %s", otherTree)
	}
	key := id + "-t-1"
	full := filepath.Join(root, key)
	if got := worktreeDir(dir, key); got != full {
		t.Fatalf("worktreeDir = %s, want the full-id path %s", got, full)
	}
	if got, err := claimWorktreeDir(dir, key); err != nil || got != full {
		t.Fatalf("claimWorktreeDir = %s, %v; want the full-id path %s", got, err, full)
	}
	if readMarker(t, root, id) != other {
		t.Fatal("the marker still names the run that claimed the prefix first")
	}

	if err := RemoveRunWorktree(ctx, dir, key); err != nil {
		t.Fatal(err)
	}
	wt, _, created, err := EnsureRunWorktree(ctx, dir, key, base)
	if err != nil || !created || wt != full {
		t.Fatalf("EnsureRunWorktree = %s created %v err %v; want a new tree at %s", wt, created, err, full)
	}
	if err := RemoveRunWorktree(ctx, dir, key); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(full); !os.IsNotExist(err) {
		t.Fatalf("this run's tree is removed, stat err %v", err)
	}
	if got := gitCmd(t, otherTree, "rev-parse", "--abbrev-ref", "HEAD"); got != "wave/"+other+"-t-1" {
		t.Fatalf("the other run's tree is on %q, want its own branch", got)
	}
}

func TestWorktreeDirEmptyMarker(t *testing.T) {
	root := useRoot(t)
	project := t.TempDir()
	id := uuid.NewString()
	// a crash between the marker's create and write
	if err := os.WriteFile(filepath.Join(root, id[:runPrefixLen]+runMarkerExt), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	key := id + "-t-2"
	full := filepath.Join(root, key)
	if got := worktreeDir(project, key); got != full {
		t.Fatalf("worktreeDir = %s, want the full-id path %s", got, full)
	}
	if got, err := claimWorktreeDir(project, key); err != nil || got != full {
		t.Fatalf("claimWorktreeDir = %s, %v; want the full-id path %s", got, err, full)
	}
}

func TestClaimWorktreeDirRace(t *testing.T) {
	project := t.TempDir()
	for range 20 {
		root := useRoot(t)
		id := uuid.NewString()
		keys := []string{id + "-t-1", samePrefixRunID(id) + "-t-1"}
		got := make([]string, len(keys))
		errs := make([]error, len(keys))
		var start, done sync.WaitGroup
		start.Add(1)
		for i, key := range keys {
			done.Add(1)
			go func() {
				defer done.Done()
				start.Wait()
				got[i], errs[i] = claimWorktreeDir(project, key)
			}()
		}
		start.Done()
		done.Wait()
		short := filepath.Join(root, id[:runPrefixLen]+"-t-1")
		owners := 0
		for i, key := range keys {
			if errs[i] != nil {
				t.Fatal(errs[i])
			}
			switch got[i] {
			case short:
				owners++
			case filepath.Join(root, key):
			default:
				t.Fatalf("claim of %s = %s, want %s or the full-id path", key, got[i], short)
			}
			if again := worktreeDir(project, key); again != got[i] {
				t.Fatalf("worktreeDir(%s) = %s, the claim returned %s", key, again, got[i])
			}
		}
		if owners != 1 {
			t.Fatalf("%d claims took the short path, want exactly one: %v", owners, got)
		}
	}
}

func TestClaimWorktreeDirCreatesRoot(t *testing.T) {
	project := t.TempDir()
	root := filepath.Join(t.TempDir(), "cache", "arc-wt")
	t.Cleanup(UseWorktreeRootForTest(root))
	id := uuid.NewString()
	if _, err := claimWorktreeDir(project, id); err != nil {
		t.Fatal(err)
	}
	if readMarker(t, root, id) != id {
		t.Fatal("the first claim creates the root and writes the marker")
	}

	file := filepath.Join(t.TempDir(), "arc-wt")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(UseWorktreeRootForTest(file))
	if _, err := claimWorktreeDir(project, id); err == nil || !strings.Contains(err.Error(), file) {
		t.Fatalf("a root that cannot be created fails the claim naming it, got %v", err)
	}
}

// a root that cannot be created fails every creation site with an error naming it
func TestTreeCreationFailsOnAnUnwritableRoot(t *testing.T) {
	ctx := context.Background()
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	file := filepath.Join(t.TempDir(), "arc-wt")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(UseWorktreeRootForTest(file))
	id := uuid.NewString()
	if _, _, _, err := EnsureRunWorktree(ctx, dir, id+"-t-1", base); err == nil || !strings.Contains(err.Error(), file) {
		t.Fatalf("EnsureRunWorktree error %v should name the root %s", err, file)
	}
	owner := &waveobj.Run{ID: id, ProjectPath: dir}
	if _, _, err := finalTree(ctx, &waveobj.TaskGroup{OID: "dag-u"}, owner); err == nil || !strings.Contains(err.Error(), file) {
		t.Fatalf("finalTree error %v should name the root %s", err, file)
	}
	err := withDetachedTree(ctx, dir, id+"-base", "base tree", base, "", func(string) error { return nil })
	if err == nil || !strings.Contains(err.Error(), file) {
		t.Fatalf("withDetachedTree error %v should name the root %s", err, file)
	}
}

func TestEnsureRunWorktreeUnderShortRoot(t *testing.T) {
	ctx := context.Background()
	dir := newGitRepo(t)
	root := worktreeRoot()
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	id := uuid.NewString()
	key := id + "-t-1"
	wt, _, created, err := EnsureRunWorktree(ctx, dir, key, base)
	if err != nil || !created {
		t.Fatalf("EnsureRunWorktree created %v err %v", created, err)
	}
	if want := filepath.Join(root, id[:runPrefixLen]+"-t-1"); wt != want {
		t.Fatalf("lane tree at %s, want %s", wt, want)
	}
	if got := gitCmd(t, wt, "rev-parse", "--abbrev-ref", "HEAD"); got != "wave/"+key {
		t.Fatalf("lane tree on %q, want wave/%s", got, key)
	}
	if readMarker(t, root, id) != id {
		t.Fatal("the marker holds the full run id")
	}
}

func TestDetachedTreesUnderShortRoot(t *testing.T) {
	ctx := context.Background()
	t.Run("final tree", func(t *testing.T) {
		dir := newGitRepo(t)
		root := worktreeRoot()
		id := uuid.NewString()
		tree, cleanup, err := finalTree(ctx, &waveobj.TaskGroup{OID: "dag-r"}, &waveobj.Run{ID: id, ProjectPath: dir})
		if err != nil {
			t.Fatal(err)
		}
		defer cleanup()
		if want := filepath.Join(root, id[:runPrefixLen]+"-final"); tree != want {
			t.Fatalf("final tree at %s, want %s", tree, want)
		}
		if readMarker(t, root, id) != id {
			t.Fatal("the final tree's claim writes the marker")
		}
	})
	for _, suffix := range []string{"-base", "-bisect"} {
		t.Run(suffix, func(t *testing.T) {
			dir := newGitRepo(t)
			root := worktreeRoot()
			base := gitCmd(t, dir, "rev-parse", "HEAD")
			id := uuid.NewString()
			var tree string
			if err := withDetachedTree(ctx, dir, id+suffix, "tree", base, "", func(wt string) error {
				tree = wt
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if want := filepath.Join(root, id[:runPrefixLen]+suffix); tree != want {
				t.Fatalf("detached tree at %s, want %s", tree, want)
			}
			if readMarker(t, root, id) != id {
				t.Fatal("the detached tree's claim writes the marker")
			}
		})
	}
}

// the os.UserCacheDir error path keeps the legacy layout
func TestWorktreeDirWithoutARootIsLegacy(t *testing.T) {
	root := useRoot(t)
	t.Cleanup(UseWorktreeRootForTest(""))
	project := t.TempDir()
	id := uuid.NewString()
	legacy := filepath.Join(project, ".waveterm", "worktrees", id+"-t-1")
	if got := worktreeDir(project, id+"-t-1"); got != legacy {
		t.Fatalf("worktreeDir = %s, want %s", got, legacy)
	}
	if got, err := claimWorktreeDir(project, id+"-t-1"); err != nil || got != legacy {
		t.Fatalf("claimWorktreeDir = %s, %v; want %s", got, err, legacy)
	}
	if entries, _ := os.ReadDir(root); len(entries) != 0 {
		t.Fatalf("no marker is written anywhere, the last root holds %d entries", len(entries))
	}
	assertNoMarker(t, filepath.Join(project, ".waveterm", "worktrees"), id)
}

// storedRun stores a run with status and returns its id.
func storedRun(t *testing.T, status string) string {
	t.Helper()
	ch, err := wstore.CreateChannel(context.Background(), "sweep", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	run.Status = status
	if err := wstore.AppendRun(context.Background(), ch.OID, run); err != nil {
		t.Fatal(err)
	}
	return run.ID
}

// leftTree claims key's prefix and makes its folder under root, with a .git file when withGit.
func leftTree(t *testing.T, root, key string, withGit bool) string {
	t.Helper()
	runID, _, _ := splitRunKey(key)
	if err := claimRunPrefix(root, runID); err != nil {
		t.Fatal(err)
	}
	dir := shortWorktreeDir(root, key)
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if withGit {
		if err := os.WriteFile(filepath.Join(dir, ".git"), []byte("gitdir: x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func TestSweepWorktreeRootClearsAFinishedRunsUnregisteredFolders(t *testing.T) {
	root := useRoot(t)
	for _, status := range []string{jarvis.RunStatus_Done, jarvis.RunStatus_Cancelled} {
		id := storedRun(t, status)
		landing, lane := leftTree(t, root, id, false), leftTree(t, root, id+"-t-2", false)
		SweepWorktreeRoot(context.Background())
		if exists(landing) || exists(lane) {
			t.Fatalf("%s run: its folders with no .git should be gone", status)
		}
		assertNoMarker(t, root, id)
	}
}

func TestSweepWorktreeRootKeeps(t *testing.T) {
	cases := map[string]func(t *testing.T, root string) (dir, id string){
		"a live run's folder": func(t *testing.T, root string) (string, string) {
			id := storedRun(t, jarvis.RunStatus_Executing)
			return leftTree(t, root, id, false), id
		},
		"a finished run's folder that still has a .git": func(t *testing.T, root string) (string, string) {
			id := storedRun(t, jarvis.RunStatus_Done)
			return leftTree(t, root, id+"-t-1", true), id
		},
		"a folder whose run is not stored": func(t *testing.T, root string) (string, string) {
			id := uuid.NewString()
			return leftTree(t, root, id, false), id
		},
	}
	for name, arrange := range cases {
		t.Run(name, func(t *testing.T) {
			root := useRoot(t)
			dir, id := arrange(t, root)
			SweepWorktreeRoot(context.Background())
			if !exists(dir) {
				t.Fatalf("%s was removed", dir)
			}
			if got := readMarker(t, root, id); got != id {
				t.Fatalf("marker = %q, want %q", got, id)
			}
		})
	}
}

func TestSweepWorktreeRootKeepsAMarkerAnotherRunsFolderSharesThePrefixOf(t *testing.T) {
	root := useRoot(t)
	id := storedRun(t, jarvis.RunStatus_Done)
	if err := claimRunPrefix(root, id); err != nil {
		t.Fatal(err)
	}
	// a live run sharing the prefix got a full-key folder; dropping the marker would move where its key resolves
	other := samePrefixRunID(id)
	otherDir := filepath.Join(root, other+"-t-1")
	if err := os.MkdirAll(otherDir, 0o755); err != nil {
		t.Fatal(err)
	}
	SweepWorktreeRoot(context.Background())
	if !exists(otherDir) {
		t.Fatal("the other run's folder was removed")
	}
	if got := readMarker(t, root, id); got != id {
		t.Fatalf("marker = %q, want %q", got, id)
	}
}

// ageMarker sets id's prefix marker back by age.
func ageMarker(t *testing.T, root, id string, age time.Duration) {
	t.Helper()
	old := time.Now().Add(-age)
	if err := os.Chtimes(runMarkerPath(root, id), old, old); err != nil {
		t.Fatal(err)
	}
}

func TestSweepWorktreeRootDeletesADayOldMarkerNoStoreHolds(t *testing.T) {
	root := useRoot(t)
	id := uuid.NewString()
	if err := claimRunPrefix(root, id); err != nil {
		t.Fatal(err)
	}
	ageMarker(t, root, id, unstoredMarkerAge+time.Minute)
	SweepWorktreeRoot(context.Background())
	assertNoMarker(t, root, id)
}

func TestSweepWorktreeRootKeepsTheMarkerOf(t *testing.T) {
	cases := map[string]func(t *testing.T, root string) string{
		"an unstored run under a day old": func(t *testing.T, root string) string {
			id := uuid.NewString()
			if err := claimRunPrefix(root, id); err != nil {
				t.Fatal(err)
			}
			ageMarker(t, root, id, unstoredMarkerAge-time.Hour)
			return id
		},
		"a day-old unstored run that still has a folder": func(t *testing.T, root string) string {
			id := uuid.NewString()
			leftTree(t, root, id+"-t-1", false)
			ageMarker(t, root, id, unstoredMarkerAge+time.Minute)
			return id
		},
		"a day-old live run with no folder": func(t *testing.T, root string) string {
			id := storedRun(t, jarvis.RunStatus_Executing)
			if err := claimRunPrefix(root, id); err != nil {
				t.Fatal(err)
			}
			ageMarker(t, root, id, unstoredMarkerAge+time.Minute)
			return id
		},
	}
	for name, arrange := range cases {
		t.Run(name, func(t *testing.T) {
			root := useRoot(t)
			id := arrange(t, root)
			SweepWorktreeRoot(context.Background())
			if got := readMarker(t, root, id); got != id {
				t.Fatalf("marker = %q, want %q", got, id)
			}
		})
	}
}

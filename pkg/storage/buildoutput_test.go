// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

func buildRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		if out, err := gitOut(context.Background(), dir, args...); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q")
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("node_modules/\ntarget/\nbuild/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "dist", "keep.txt"), 3) // tracked: never build output
	run("add", ".gitignore", "dist/keep.txt")
	run("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")

	writeFile(t, filepath.Join(dir, "frontend", "node_modules", "x.js"), 10)
	writeFile(t, filepath.Join(dir, "frontend", "node_modules", "pkg", "node_modules", "y.js"), 5)
	writeFile(t, filepath.Join(dir, "src-tauri", "Cargo.toml"), 1)
	writeFile(t, filepath.Join(dir, "src-tauri", "target", "a.bin"), 20)
	writeFile(t, filepath.Join(dir, "loose", "target", "b.bin"), 20)        // no Cargo.toml beside it
	writeFile(t, filepath.Join(dir, "a", "b", "c", "node_modules", "z"), 9) // four levels down
	writeFile(t, filepath.Join(dir, ".waveterm", "worktrees", "k", "node_modules", "w"), 9)
	return dir
}

func buildEnv(project string, busy map[string]string) *Env {
	return &Env{
		Now:          time.Now,
		ProjectPaths: func() []string { return []string{project} },
		BusyProjects: func(context.Context) (map[string]string, error) { return busy, nil },
	}
}

func itemIDs(items []StorageItem) []string {
	var out []string
	for _, it := range items {
		out = append(out, it.ID)
	}
	sort.Strings(out)
	return out
}

func TestBuildOutputFindsIgnoredBuildDirs(t *testing.T) {
	repo := buildRepo(t)
	rep := buildOutput{}.measure(context.Background(), buildEnv(repo, nil))
	want := []string{filepath.Join(repo, "frontend", "node_modules"), filepath.Join(repo, "src-tauri", "target")}
	sort.Strings(want)
	if got := itemIDs(rep.Items); len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("found %v, want %v", got, want)
	}
	if it := itemByID(rep.Items, filepath.Join(repo, "frontend", "node_modules")); it.Bytes != 15 || !it.Cleanable || it.Label != "frontend/node_modules" || it.Detail != repo {
		t.Fatalf("node_modules: %+v (nested node_modules counted in it, not listed apart; Detail is the project's path)", it)
	}
}

func TestBuildOutputNeverFollowsALink(t *testing.T) {
	repo := buildRepo(t)
	link := filepath.Join(repo, "other", "node_modules")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(repo, "frontend", "node_modules"), link); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	env := buildEnv(repo, nil)
	if it := itemByID(buildOutput{}.measure(context.Background(), env).Items, link); it.ID != "" {
		t.Fatal("a linked node_modules must never be listed")
	}
	res := buildOutput{}.clean(context.Background(), env, []string{link}, CleanOpts{})
	if len(res.Cleaned) != 0 {
		t.Fatal("a link must never be removed through")
	}
	if !fileExists(filepath.Join(repo, "frontend", "node_modules", "x.js")) {
		t.Fatal("the link's target must be untouched")
	}
}

func TestBusyProjectMatchesAPathWithATrailingSeparator(t *testing.T) {
	repo := buildRepo(t)
	env := buildEnv(repo, map[string]string{repo + string(filepath.Separator): "agent working in this project"})
	nm := filepath.Join(repo, "frontend", "node_modules")
	if it := itemByID(buildOutput{}.measure(context.Background(), env).Items, nm); it.Cleanable || it.Reason != "agent working in this project" {
		t.Fatalf("a busy project's output must stay: %+v", it)
	}
	if res := (buildOutput{}).clean(context.Background(), env, []string{nm}, CleanOpts{}); len(res.Cleaned) != 0 {
		t.Fatal("clean must refuse a busy project")
	}
}

func TestCleanRemovesBuildOutputAndRefusesTheRest(t *testing.T) {
	repo := buildRepo(t)
	env := buildEnv(repo, nil)
	nm := filepath.Join(repo, "frontend", "node_modules")
	dist := filepath.Join(repo, "dist")
	src := filepath.Join(repo, "frontend")
	res := buildOutput{}.clean(context.Background(), env, []string{nm, dist, src}, CleanOpts{})
	if len(res.Cleaned) != 1 || res.Cleaned[0] != nm || res.Reclaimed != 15 {
		t.Fatalf("got %+v, want only node_modules removed, 15 bytes", res)
	}
	if !fileExists(filepath.Join(dist, "keep.txt")) || !fileExists(src) {
		t.Fatal("a tracked dir and a source dir must stay")
	}
	if res := (buildOutput{}).clean(context.Background(), env, []string{filepath.Join(repo, "src-tauri", "target")}, CleanOpts{Auto: true}); len(res.Cleaned) != 0 {
		t.Fatal("auto-clean must never touch build output")
	}
}

func TestBuildOutputWithTrackedFilesNeverQualifies(t *testing.T) {
	repo := buildRepo(t)
	ctx := context.Background()
	// dist/ is ignored, yet keep.txt in it was force-added. Some git versions still call such a directory ignored
	// (the one this ran against does not), so hasTrackedFiles is asserted on its own as well
	if err := os.WriteFile(filepath.Join(repo, ".gitignore"), []byte("node_modules/\ntarget/\nbuild/\ndist/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := gitOut(ctx, repo, "add", "-f", "dist/keep.txt"); err != nil {
		t.Fatalf("git add -f: %v\n%s", err, out)
	}
	env := buildEnv(repo, nil)
	dist := filepath.Join(repo, "dist")
	if !hasTrackedFiles(ctx, repo, dist) || hasTrackedFiles(ctx, repo, filepath.Join(repo, "frontend", "node_modules")) {
		t.Fatal("hasTrackedFiles must be true for dist (keep.txt) and false for an untracked node_modules")
	}
	if it := itemByID(buildOutput{}.measure(ctx, env).Items, dist); it.ID != "" {
		t.Fatalf("a directory holding tracked files must not be listed: %+v", it)
	}
	res := buildOutput{}.clean(ctx, env, []string{dist}, CleanOpts{})
	if len(res.Cleaned) != 0 || len(res.Skipped) != 1 {
		t.Fatalf("clean must skip it (as tracked, or as not ignored, by git version): %+v", res)
	}
	if !fileExists(filepath.Join(dist, "keep.txt")) {
		t.Fatal("the tracked file must stay")
	}
}

func TestBuildOutputReachesTheReposAgentsWorkedIn(t *testing.T) {
	ctx := context.Background()
	project := buildRepo(t) // in config
	other := buildRepo(t)   // only agents worked here, in a subfolder
	plain := t.TempDir()    // not a repo
	writeFile(t, filepath.Join(plain, "node_modules", "p.js"), 4)
	wt := filepath.Join(t.TempDir(), "wt")
	if out, err := gitOut(ctx, other, "worktree", "add", "-q", wt); err != nil {
		t.Fatalf("git worktree add: %v\n%s", err, out)
	}
	writeFile(t, filepath.Join(wt, "node_modules", "w.js"), 4)
	env := buildEnv(project, nil)
	env.AgentProjects = func() []AgentProject {
		return []AgentProject{
			{Path: filepath.Join(other, "frontend"), LastActiveTs: 300},
			{Path: wt, LastActiveTs: 250},
			{Path: filepath.Join(project, "src-tauri"), LastActiveTs: 200},
			{Path: plain, LastActiveTs: 150},
			{Path: other, LastActiveTs: 100},
		}
	}
	rep := buildOutput{}.measure(ctx, env)
	theirs := itemByID(rep.Items, filepath.Join(other, "frontend", "node_modules"))
	if theirs.ID == "" || theirs.Detail != other || theirs.ModTs != 300 || !theirs.Cleanable {
		t.Fatalf("an agent's repo is listed at its top level, with its newest session: %+v", theirs)
	}
	if mine := itemByID(rep.Items, filepath.Join(project, "src-tauri", "target")); mine.ModTs != 200 {
		t.Fatalf("a project in config takes when an agent last worked in it: %+v", mine)
	}
	for _, it := range rep.Items {
		if isInside(it.Path, plain) || isInside(it.Path, wt) {
			t.Fatalf("a folder outside a repo and a linked worktree are never listed: %+v", it)
		}
	}
	if len(rep.Items) != 4 {
		t.Fatalf("got %v, want each repo's node_modules and target once", itemIDs(rep.Items))
	}
	nm := filepath.Join(other, "frontend", "node_modules")
	if res := (buildOutput{}).clean(ctx, env, []string{nm}, CleanOpts{}); len(res.Cleaned) != 1 || fileExists(nm) {
		t.Fatalf("an agent repo's build output is removed like a project's: %+v", res)
	}
	if res := (buildOutput{}).clean(ctx, env, []string{filepath.Join(plain, "node_modules")}, CleanOpts{}); len(res.Cleaned) != 0 {
		t.Fatal("a folder outside every repo must never be removed")
	}
}

func TestAnAgentInASubfolderKeepsTheProjectBusy(t *testing.T) {
	repo := buildRepo(t)
	env := buildEnv(repo, map[string]string{filepath.Join(repo, "frontend"): "agent working in this project"})
	nm := filepath.Join(repo, "frontend", "node_modules")
	if it := itemByID(buildOutput{}.measure(context.Background(), env).Items, nm); it.Cleanable {
		t.Fatalf("an agent working in a folder of the project keeps its output: %+v", it)
	}
}

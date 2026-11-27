// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"encoding/json"
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
	// the scan lists a folder and never walks it: a folder nobody sized reads 0 bytes, sized at 0 (never)
	if it := itemByID(rep.Items, filepath.Join(repo, "frontend", "node_modules")); it.Bytes != 0 || it.SizedTs != 0 || !it.Cleanable || it.Label != "frontend/node_modules" || it.Detail != repo {
		t.Fatalf("node_modules: %+v (never sized: 0 bytes, SizedTs 0; nested node_modules not listed apart; Detail is the project's path)", it)
	}
}

func TestBuildOutputTakesItsSizesFromTheKeptFileAndWalksNothing(t *testing.T) {
	repo := buildRepo(t)
	env := buildEnv(repo, nil)
	env.DataDir = t.TempDir()
	nm := filepath.Join(repo, "frontend", "node_modules")
	target := filepath.Join(repo, "src-tauri", "target")
	// 999 is not what is on disk (15): a scan that walked would read 15
	raw, err := json.Marshal(map[string]map[string]int64{nm: {"bytes": 999, "ts": 1700000000000}})
	if err != nil {
		t.Fatal(err)
	}
	writeKeptRaw(t, env, string(raw))
	rep := buildOutput{}.measure(context.Background(), env)
	if it := itemByID(rep.Items, nm); it.Bytes != 999 || it.SizedTs != 1700000000000 {
		t.Fatalf("node_modules: %+v, want the kept 999 bytes and its time", it)
	}
	if it := itemByID(rep.Items, target); it.Bytes != 0 || it.SizedTs != 0 {
		t.Fatalf("target: %+v, want 0 bytes and SizedTs 0: never sized", it)
	}
	if rep.Bytes != 999 || rep.CleanableBytes != 999 {
		t.Fatalf("category totals %d / %d, want the kept sizes summed (999)", rep.Bytes, rep.CleanableBytes)
	}
}

func TestBuildOutputCleanDropsItsKeptSizeAndStillMeasuresWhatItRemoves(t *testing.T) {
	repo := buildRepo(t)
	env := buildEnv(repo, nil)
	env.DataDir = t.TempDir()
	nm := filepath.Join(repo, "frontend", "node_modules")
	target := filepath.Join(repo, "src-tauri", "target")
	updateBuildSizes(env, func(k keptSizes) {
		k[nm] = keptSize{Bytes: 999, Ts: 1}
		k[target] = keptSize{Bytes: 20, Ts: 2}
	})
	res := buildOutput{}.clean(context.Background(), env, []string{nm}, CleanOpts{})
	if len(res.Cleaned) != 1 || res.Reclaimed != 15 {
		t.Fatalf("got %+v, want node_modules removed and its own measure (15 bytes) reclaimed, not the kept 999", res)
	}
	got := readBuildSizes(env)
	if _, ok := got[nm]; ok || got[target].Bytes != 20 {
		t.Fatalf("kept sizes %v, want the removed folder's entry dropped and the other kept", got)
	}
	// a folder a clean refused keeps its entry
	updateBuildSizes(env, func(k keptSizes) { k[filepath.Join(repo, "dist")] = keptSize{Bytes: 3, Ts: 3} })
	if res := (buildOutput{}).clean(context.Background(), env, []string{filepath.Join(repo, "dist")}, CleanOpts{}); len(res.Cleaned) != 0 {
		t.Fatalf("dist is tracked and must stay: %+v", res)
	}
	if _, ok := readBuildSizes(env)[filepath.Join(repo, "dist")]; !ok {
		t.Fatal("a refused clean must keep the entry")
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

// sequentialBuildItems is what build output listed before its git calls ran on a pool: one project after another, one
// repoTop, check-ignore and ls-files at a time (the old buildProjects and measure loops, kept here as the reference).
func sequentialBuildItems(ctx context.Context, env *Env) []StorageItem {
	var projects []buildProject
	for _, p := range env.ProjectPaths() {
		projects = append(projects, buildProject{path: filepath.Clean(p)})
	}
	home, _ := os.UserHomeDir()
	bump := func(dir string, ts int64) bool {
		for i := range projects {
			if isInside(dir, projects[i].path) {
				projects[i].lastUsed = max(projects[i].lastUsed, ts)
				return true
			}
		}
		return false
	}
	for _, a := range env.AgentProjects() {
		if bump(a.Path, a.LastActiveTs) {
			continue
		}
		top, ok := repoTop(ctx, a.Path)
		if !ok || SamePath(top, home) || bump(top, a.LastActiveTs) {
			continue
		}
		holds := false
		for _, p := range projects {
			holds = holds || isInside(p.path, top)
		}
		if !holds {
			projects = append(projects, buildProject{path: top, lastUsed: a.LastActiveTs})
		}
	}
	var items []StorageItem
	seen := map[string]bool{}
	for _, bp := range projects {
		cands := buildCandidates(bp.path)
		ignored := gitIgnored(ctx, bp.path, cands)
		for _, c := range cands {
			if seen[c] || !ignored[c] || hasTrackedFiles(ctx, bp.path, c) {
				continue
			}
			seen[c] = true
			rel, _ := filepath.Rel(bp.path, c)
			items = append(items, StorageItem{ID: c, Kind: KindBuild, Label: filepath.ToSlash(rel), Detail: bp.path, Path: c, ModTs: bp.lastUsed, Cleanable: true})
		}
	}
	return items
}

func TestBuildOutputListsManyReposInTheOrderItListedThemOneByOne(t *testing.T) {
	ctx := context.Background()
	// nine projects, more than the pool has workers (8), so the merge decides the order, not whichever git call returns first
	p1, p2, p3 := buildRepo(t), buildRepo(t), buildRepo(t)
	var q []string // repos only agents worked in
	for range 5 {
		q = append(q, buildRepo(t))
	}
	// a repo nested in p1 and a project of its own: p1's scan reaches its node_modules (listed once, under p1)
	nested := filepath.Join(p1, "pkgs", "inner")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := gitOut(ctx, nested, "init", "-q"); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	if err := os.WriteFile(filepath.Join(nested, ".gitignore"), []byte("node_modules/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(nested, "node_modules", "n.js"), 7)
	plain := t.TempDir() // not a repo
	writeFile(t, filepath.Join(plain, "node_modules", "p.js"), 4)

	env := buildEnv(p1, nil)
	env.ProjectPaths = func() []string { return []string{p1, p2, nested, p3} }
	env.AgentProjects = func() []AgentProject {
		return []AgentProject{
			{Path: filepath.Join(q[0], "frontend"), LastActiveTs: 900}, // a repo no project holds, asked for in a subfolder
			{Path: q[1], LastActiveTs: 800},
			{Path: filepath.Join(p2, "src-tauri"), LastActiveTs: 700}, // reached by a project in config and an agent folder
			{Path: q[0], LastActiveTs: 600},                           // the repo the first ask listed: it only bumps
			{Path: plain, LastActiveTs: 500},
			{Path: q[2], LastActiveTs: 400},
			{Path: q[3], LastActiveTs: 300},
			{Path: filepath.Join(q[1], "frontend"), LastActiveTs: 250},
			{Path: q[4], LastActiveTs: 200},
		}
	}
	want := sequentialBuildItems(ctx, env)
	got := buildOutput{}.measure(ctx, env).Items
	if len(want) < 16 {
		t.Fatalf("the reference lists %d folders, want at least 16 (8 repos, two each): the fixture is not what the test expects", len(want))
	}
	seen := map[string]bool{}
	for _, it := range got {
		if seen[it.ID] {
			t.Fatalf("%s is listed twice: a folder two projects reach is listed once, under the first", it.ID)
		}
		seen[it.ID] = true
	}
	if len(got) != len(want) {
		t.Fatalf("listed %d folders, want %d:\n got  %v\n want %v", len(got), len(want), itemPaths(got), itemPaths(want))
	}
	for i := range want {
		g, w := got[i], want[i]
		if g.ID != w.ID || g.Label != w.Label || g.Detail != w.Detail || g.ModTs != w.ModTs || g.Kind != w.Kind || !g.Cleanable {
			t.Fatalf("item %d is %+v, want %+v (one by one: config projects in order, then each repo agents worked in, each project's folders in the folder order)\n got  %v\n want %v",
				i, g, w, itemPaths(got), itemPaths(want))
		}
	}
	// what the reference says, spelled out: the project in config reached by an agent folder takes its time, a repo agents
	// asked for twice keeps the newest, and nothing is listed under the folder outside every repo
	if it := itemByID(got, filepath.Join(p2, "src-tauri", "target")); it.ModTs != 700 || it.Detail != p2 {
		t.Fatalf("p2's target: %+v, want its project's path and the agent's time 700", it)
	}
	if it := itemByID(got, filepath.Join(q[0], "frontend", "node_modules")); it.ModTs != 900 || it.Detail != q[0] {
		t.Fatalf("q0's node_modules: %+v, want the repo's top level and the newer of its two asks (900)", it)
	}
	if it := itemByID(got, filepath.Join(plain, "node_modules")); it.ID != "" {
		t.Fatalf("a folder outside a repo is listed: %+v", it)
	}
}

func itemPaths(items []StorageItem) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = it.ID
	}
	return out
}

func TestAnAgentInASubfolderKeepsTheProjectBusy(t *testing.T) {
	repo := buildRepo(t)
	env := buildEnv(repo, map[string]string{filepath.Join(repo, "frontend"): "agent working in this project"})
	nm := filepath.Join(repo, "frontend", "node_modules")
	if it := itemByID(buildOutput{}.measure(context.Background(), env).Items, nm); it.Cleanable {
		t.Fatalf("an agent working in a folder of the project keeps its output: %+v", it)
	}
}

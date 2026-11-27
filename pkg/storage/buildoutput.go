// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var (
	// buildDirNames are the directory names that mark build output; a target counts only beside a Cargo.toml
	buildDirNames = map[string]bool{"node_modules": true, "target": true, "dist": true, "build": true, ".next": true, "__pycache__": true}
	// buildSkipDirs are never descended into: git's own, the engine's worktrees, Claude Code's worktrees
	buildSkipDirs = map[string]bool{".git": true, ".waveterm": true, ".claude": true}
)

// buildScanDepth is how far below a project build output is looked for: enough for src-tauri/target and
// frontend/node_modules
const buildScanDepth = 3

// buildOutput lists the build directories git ignores in each project, and in each repo an agent has worked in, and
// removes the one a row asks for. Never all at once, never automatically, and never while an agent works in the
// project or one of its runs goes.
type buildOutput struct{}

// buildProject is a folder build output is looked for in, and when an agent last worked there (0: none did).
type buildProject struct {
	path     string
	lastUsed int64
}

// buildListWorkers is how many git calls build output's listing runs at once. Listing 177 repos one git call after
// another took 1m23s on a loaded machine.
const buildListWorkers = 8

// buildProjects is every project in config, then each git repo an agent has worked in that no project holds, at its
// top level. A folder outside a repo has no build output git ignores, a linked worktree (an engine run's, Claude
// Code's) belongs to the run worktrees card or to Claude Code, and the home dir kept in git, or any repo that holds a
// project, is a parent folder, so none of them is listed.
//
// The repoTop calls, one git process per agent folder, run on a pool ahead of the merge; the merge then walks the agent
// folders in their order and decides as it always did, so the projects and their order are the same. A folder a
// project in config holds is bumped without a call, as before; one an earlier agent folder's repo holds is called for
// and then bumped, the one extra call the pool costs.
func buildProjects(ctx context.Context, env *Env) []buildProject {
	var out []buildProject
	for _, p := range env.ProjectPaths() {
		out = append(out, buildProject{path: filepath.Clean(p)})
	}
	if env.AgentProjects == nil {
		return out
	}
	home, _ := os.UserHomeDir()
	agents := env.AgentProjects()
	type topResult struct {
		top string
		ok  bool
	}
	var asked []int // the agent folders no project in config holds: the only ones the merge may call repoTop for
	for i, a := range agents {
		held := false
		for _, p := range out {
			held = held || isInside(a.Path, p.path)
		}
		if !held {
			asked = append(asked, i)
		}
	}
	tops := map[int]topResult{}
	for n, r := range parallelMap(asked, buildListWorkers, func(i int) topResult {
		top, ok := repoTop(ctx, agents[i].Path)
		return topResult{top, ok}
	}) {
		tops[asked[n]] = r
	}
	// bump marks when an agent last worked in a listed project, reporting whether one holds dir
	bump := func(dir string, ts int64) bool {
		for i := range out {
			if isInside(dir, out[i].path) {
				out[i].lastUsed = max(out[i].lastUsed, ts)
				return true
			}
		}
		return false
	}
	for i, a := range agents {
		if bump(a.Path, a.LastActiveTs) {
			continue
		}
		r, ok := tops[i]
		if !ok { // cannot happen: bump holds every folder a project in config holds
			r.top, r.ok = repoTop(ctx, a.Path)
		}
		top := r.top
		if !r.ok || SamePath(top, home) || bump(top, a.LastActiveTs) {
			continue
		}
		holds := false
		for _, p := range out {
			holds = holds || isInside(p.path, top)
		}
		if !holds {
			out = append(out, buildProject{path: top, lastUsed: a.LastActiveTs})
		}
	}
	return out
}

// repoTop is the top level of the git repo dir lies in, in dir's own spelling (links not resolved); ok is false
// outside a repo and in a linked worktree, whose git dir is not the common one.
func repoTop(ctx context.Context, dir string) (string, bool) {
	out, err := gitOut(ctx, dir, "rev-parse", "--show-cdup", "--path-format=absolute", "--git-dir", "--git-common-dir")
	if err != nil {
		return "", false
	}
	lines := strings.Split(strings.TrimRight(out, "\r\n"), "\n")
	if len(lines) != 3 || !SamePath(strings.TrimSpace(lines[1]), strings.TrimSpace(lines[2])) {
		return "", false
	}
	return filepath.Join(dir, strings.TrimSpace(lines[0])), true
}

func projectPaths(projects []buildProject) []string {
	paths := make([]string, len(projects))
	for i, p := range projects {
		paths[i] = p.path
	}
	return paths
}

func (buildOutput) category() StorageCategory { return CategoryBuildOutput }

// buildCandidates lists the directories under project, at most buildScanDepth levels down, whose name marks build
// output. It never descends into a match, into buildSkipDirs, or through a link: a link or a Windows junction is
// not a directory entry here.
func buildCandidates(project string) []string {
	var out []string
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			full := filepath.Join(dir, name)
			if buildDirNames[name] && (name != "target" || fileExists(filepath.Join(dir, "Cargo.toml"))) {
				out = append(out, full)
				continue
			}
			if buildSkipDirs[name] || depth >= buildScanDepth {
				continue
			}
			walk(full, depth+1)
		}
	}
	walk(filepath.Clean(project), 1)
	return out
}

// relDirs maps each path (absolute, under project) to its slash-separated path below project with a trailing
// slash: the trailing slash tells git it is a directory, which a "node_modules/" pattern needs.
func relDirs(project string, paths []string) map[string]string {
	byRel := map[string]string{}
	for _, p := range paths {
		rel, err := filepath.Rel(project, p)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		byRel[filepath.ToSlash(rel)+"/"] = p
	}
	return byRel
}

// gitIgnored is the subset of paths (absolute, under project) that git ignores in project. A project that is not
// a git repo ignores nothing, so none of its directories qualify.
func gitIgnored(ctx context.Context, project string, paths []string) map[string]bool {
	ignored := map[string]bool{}
	byRel := relDirs(project, paths)
	if len(byRel) == 0 {
		return ignored
	}
	args := []string{"check-ignore", "--"}
	for rel := range byRel {
		args = append(args, rel)
	}
	// exit 1 means none is ignored and 128 not a repo: either way the output lists only what is ignored
	out, _ := gitOut(ctx, project, args...)
	for _, line := range strings.Split(out, "\n") {
		if p, ok := byRel[strings.TrimSpace(line)]; ok {
			ignored[p] = true
		}
	}
	return ignored
}

// hasTrackedFiles is whether git tracks any file under dir. check-ignore calls a directory ignored even when a
// file in it was force-added, and removing the directory would delete that file. When git cannot say, the answer
// is yes: a directory is left alone when in doubt.
func hasTrackedFiles(ctx context.Context, project, dir string) bool {
	rel, err := filepath.Rel(project, dir)
	if err != nil || strings.HasPrefix(rel, "..") {
		return true
	}
	out, err := gitOut(ctx, project, "ls-files", "--", filepath.ToSlash(rel)+"/")
	return err != nil || strings.TrimSpace(out) != ""
}

// busyReason is why a project's build output must stay now, "" when nothing runs there or in a folder inside it.
func busyReason(busy map[string]string, project string) string {
	for p, why := range busy {
		if isInside(p, project) {
			return why
		}
	}
	return ""
}

// projectOf is the project p lies inside, "" when none holds it.
func projectOf(projects []string, p string) string {
	for _, project := range projects {
		rel, err := filepath.Rel(project, p)
		if err == nil && rel != "." && !strings.HasPrefix(rel, "..") {
			return project
		}
	}
	return ""
}

// isPlainDir is a directory that is not a link: Lstat reports a symlink as one, and a Windows junction as
// irregular, so neither passes.
func isPlainDir(p string) bool {
	info, err := os.Lstat(p)
	return err == nil && info.IsDir()
}

// measure lists the build folders and walks none of them: walking every node_modules and target of every repo an agent
// worked in took minutes to hours. A folder's Bytes and SizedTs are what it measured when last sized (buildsizes.go),
// 0 and 0 when it never was.
//
// The git calls of each project (check-ignore, and ls-files for each folder git ignores) run on a pool of
// buildListWorkers projects at once, and the results are merged in the projects' order below: the same projects, items
// and order as listing them one by one. A folder an earlier project already lists costs its ls-files call for
// nothing, which only a repo nested in another does.
func (buildOutput) measure(ctx context.Context, env *Env) StorageCategoryReport {
	busy, busyErr := env.BusyProjects(ctx)
	kept := readBuildSizes(env)
	var items []StorageItem
	projects := buildProjects(ctx, env)
	type listing struct {
		cands   []string
		ignored map[string]bool
		tracked map[string]bool // for the folders git ignores
	}
	listings := parallelMap(projects, buildListWorkers, func(bp buildProject) listing {
		cands := buildCandidates(bp.path)
		l := listing{cands: cands, ignored: gitIgnored(ctx, bp.path, cands), tracked: map[string]bool{}}
		for _, c := range cands {
			if l.ignored[c] {
				l.tracked[c] = hasTrackedFiles(ctx, bp.path, c)
			}
		}
		return l
	})
	// a folder two projects reach (a repo nested in another) is listed once, under the first
	seen := map[string]bool{}
	for i, bp := range projects {
		project := bp.path
		cands, ignored, tracked := listings[i].cands, listings[i].ignored, listings[i].tracked
		why := busyReason(busy, project)
		if busyErr != nil {
			why = "couldn't tell whether anything runs here"
		}
		for _, c := range cands {
			if seen[c] || !ignored[c] || tracked[c] {
				continue
			}
			seen[c] = true
			rel, _ := filepath.Rel(project, c)
			// Detail is the project's path: the Settings card folds a project's folders into one row with one button
			items = append(items, StorageItem{ID: c, Kind: KindBuild, Label: filepath.ToSlash(rel), Detail: project,
				Path: c, Bytes: kept[c].Bytes, SizedTs: kept[c].Ts, ModTs: bp.lastUsed, Cleanable: why == "", Reason: why})
		}
	}
	var err error
	if busyErr != nil {
		err = fmt.Errorf("reading what runs in each project: %w", busyErr)
	}
	return report(CategoryBuildOutput, items, err)
}

func (buildOutput) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	if opts.Auto {
		for _, id := range ids {
			skip(&res, id, "build output is cleaned only when you ask")
		}
		return res
	}
	busy, err := env.BusyProjects(ctx)
	if err != nil {
		for _, id := range ids {
			skip(&res, id, "couldn't tell whether anything runs here: "+err.Error())
		}
		return res
	}
	projects := projectPaths(buildProjects(ctx, env))
	for _, id := range ids {
		id = filepath.Clean(id)
		project := projectOf(projects, id)
		switch {
		case project == "":
			skip(&res, id, "not in a project")
			continue
		case busyReason(busy, project) != "":
			skip(&res, id, busyReason(busy, project))
			continue
		case !isPlainDir(id):
			skip(&res, id, "not a directory (a link is never removed)")
			continue
		}
		found := false
		for _, c := range buildCandidates(project) {
			found = found || SamePath(c, id)
		}
		if !found {
			skip(&res, id, "not build output")
			continue
		}
		if !gitIgnored(ctx, project, []string{id})[id] {
			skip(&res, id, "git does not ignore it")
			continue
		}
		if hasTrackedFiles(ctx, project, id) {
			skip(&res, id, "git tracks files in it")
			continue
		}
		// measured right before it goes, whatever its kept size says: Reclaimed is what this clean freed
		size := dirSize(id)
		if err := os.RemoveAll(id); err != nil {
			skip(&res, id, "couldn't remove: "+err.Error())
			continue
		}
		res.Reclaimed += size
		res.Cleaned = append(res.Cleaned, id)
	}
	dropBuildSizes(env, res.Cleaned...)
	return res
}

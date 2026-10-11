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

// buildOutput lists each project's build directories that git ignores and removes the one a row asks for. Never
// all at once, never automatically, and never while an agent works in the project or one of its runs goes.
type buildOutput struct{}

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

// busyReason is why a project's build output must stay now, "" when nothing runs there.
func busyReason(busy map[string]string, project string) string {
	for p, why := range busy {
		if SamePath(p, project) {
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

func (buildOutput) measure(ctx context.Context, env *Env) StorageCategoryReport {
	busy, busyErr := env.BusyProjects(ctx)
	var items []StorageItem
	for _, project := range env.ProjectPaths() {
		cands := buildCandidates(project)
		ignored := gitIgnored(ctx, project, cands)
		why := busyReason(busy, project)
		if busyErr != nil {
			why = "couldn't tell whether anything runs here"
		}
		for _, c := range cands {
			if !ignored[c] || hasTrackedFiles(ctx, project, c) {
				continue
			}
			rel, _ := filepath.Rel(project, c)
			// Detail is the project's path: the Settings card folds a project's folders into one row with one button
			items = append(items, StorageItem{ID: c, Kind: KindBuild, Label: filepath.ToSlash(rel), Detail: project,
				Path: c, Bytes: dirSize(c), Cleanable: why == "", Reason: why})
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
	for _, id := range ids {
		id = filepath.Clean(id)
		project := projectOf(env.ProjectPaths(), id)
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
		size := dirSize(id)
		if err := os.RemoveAll(id); err != nil {
			skip(&res, id, "couldn't remove: "+err.Error())
			continue
		}
		res.Reclaimed += size
		res.Cleaned = append(res.Cleaned, id)
	}
	return res
}

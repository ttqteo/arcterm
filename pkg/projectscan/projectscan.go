// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package projectscan tells a project folder by its markers (a .git, a package.json, a pom.xml…): which of the
// folders Claude Code ran in are projects, and which folders on disk near the known projects are, for the New project
// picker's search.
package projectscan

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// markers in the order a folder's kind is read: a build manifest names the stack before a package.json, which a repo
// of another stack often carries only for its tooling, and a bare .git says only "git"
var markers = []struct{ file, kind string }{
	{"pom.xml", "Maven"},
	{"build.gradle", "Gradle"},
	{"build.gradle.kts", "Gradle"},
	{"go.mod", "Go"},
	{"Cargo.toml", "Rust"},
	{"pyproject.toml", "Python"},
	{"setup.py", "Python"},
	{"requirements.txt", "Python"},
	{"Pipfile", "Python"},
	{"pubspec.yaml", "Dart"},
	{"Package.swift", "Swift"},
	{"composer.json", "PHP"},
	{"Gemfile", "Ruby"},
	{"package.json", "Node"},
	{".git", "git"},
}

// Kind is what dir's markers say it is ("Maven", "Node", "git"…), "" for a folder that is no project.
func Kind(dir string) string {
	for _, m := range markers {
		if _, err := os.Lstat(filepath.Join(dir, m.file)); err == nil {
			return m.kind
		}
	}
	return ""
}

// Root is the nearest folder at or above dir that is a project. Home and the filesystem root never are, however
// they are marked, and the walk stops there: ok=false for a folder with no project above it.
func Root(dir, home string) (string, bool) {
	home = filepath.Clean(home)
	for p := filepath.Clean(dir); ; {
		if p == home || isFSRoot(p) {
			return "", false
		}
		if Kind(p) != "" {
			return p, true
		}
		p = filepath.Dir(p)
	}
}

// SearchRoots is where the picker's search looks: the parent and grandparent of each known project, never home, a
// folder above it or the filesystem root, in the order first named.
func SearchRoots(near []string, home string) []string {
	home = filepath.Clean(home)
	seen := map[string]bool{}
	var out []string
	for _, n := range near {
		p := filepath.Clean(n)
		for i := 0; i < 2; i++ {
			p = filepath.Dir(p)
			if isFSRoot(p) || p == home || isUnder(home, p) {
				break
			}
			if !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	return out
}

// Folder is a project found on disk.
type Folder struct {
	Path  string
	Name  string
	Kind  string
	ModTs int64 // its .git's mtime, else its own, UnixMilli: a commit touches the first
}

const (
	// how far below a search root a project can sit: <workspace>/<client>/<repo> from a grandparent
	maxDepth = 3
	// a bound on one search, so a root over a huge tree cannot stall the picker
	maxDirs = 20000
)

// folders the search never enters: dependency trees and build output hold manifests that are not projects, and a
// Mac's Library is no place for one
var skipNames = map[string]bool{
	"node_modules": true, "vendor": true, "target": true, "build": true, "dist": true, "out": true,
	"venv": true, "__pycache__": true, "Library": true,
}

// Find lists the projects under roots, at most maxDepth levels down, newest first. It does not go into a project
// (a repo's own packages are not projects of their own), a hidden folder, a symlink, or any folder under skip, and
// it leaves out a linked worktree: a branch of a repo, not a project of its own.
func Find(roots, skip []string) []Folder {
	found := map[string]Folder{}
	visited := 0
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		if visited >= maxDirs || underAny(dir, skip) {
			return
		}
		visited++
		if kind := Kind(dir); kind != "" {
			if _, ok := found[dir]; !ok && !isLinkedWorktree(dir) {
				found[dir] = Folder{Path: dir, Name: filepath.Base(dir), Kind: kind, ModTs: modTs(dir)}
			}
			return
		}
		if depth == maxDepth {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			name := e.Name()
			// a DirEntry of a symlink is not a dir, so a link is never followed
			if !e.IsDir() || strings.HasPrefix(name, ".") || skipNames[name] {
				continue
			}
			walk(filepath.Join(dir, name), depth+1)
		}
	}
	for _, r := range roots {
		walk(filepath.Clean(r), 0)
	}
	out := make([]Folder, 0, len(found))
	for _, f := range found {
		out = append(out, f)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ModTs != out[j].ModTs {
			return out[i].ModTs > out[j].ModTs
		}
		return out[i].Path < out[j].Path
	})
	return out
}

// isLinkedWorktree reports whether dir's .git is a file, as a `git worktree add` tree's is.
func isLinkedWorktree(dir string) bool {
	info, err := os.Lstat(filepath.Join(dir, ".git"))
	return err == nil && info.Mode().IsRegular()
}

func modTs(dir string) int64 {
	if info, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		return info.ModTime().UnixMilli()
	}
	if info, err := os.Stat(dir); err == nil {
		return info.ModTime().UnixMilli()
	}
	return 0
}

func isFSRoot(p string) bool {
	return filepath.Dir(p) == p
}

// isUnder reports whether path is dir or inside it; an empty path or dir is never under anything.
func isUnder(path, dir string) bool {
	if path == "" || dir == "" {
		return false
	}
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func underAny(path string, dirs []string) bool {
	for _, d := range dirs {
		if isUnder(path, d) {
			return true
		}
	}
	return false
}

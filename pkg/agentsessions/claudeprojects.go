// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// ClaudeProject is a folder Claude Code has run in, recovered from its transcript store, for the New
// project picker. Sessions counts the transcripts at the folder's top level; subagent transcripts live
// in subfolders and are not sessions of their own.
type ClaudeProject struct {
	Path         string
	Name         string
	LastActiveTs int64 // newest transcript's mtime, UnixMilli
	Sessions     int
}

// cwdProbeLines bounds how far into a transcript the scan looks for a cwd: Claude Code writes it on
// the first user record, but a session can open with summary or snapshot records that carry none.
const cwdProbeLines = 40

// ScanClaudeProjects lists the folders Claude Code has sessions for, newest first.
func ScanClaudeProjects() []ClaudeProject {
	return scanClaudeProjects(filepath.Join(wavebase.GetHomeDir(), ".claude", "projects"), agentobserve.HeadlessAgentSlug(), os.TempDir())
}

// The store's folder names are slugs (every separator becomes '-'), which cannot be turned back into a
// path, so the real path is read from a transcript's cwd. A folder that no longer exists, an engine run's
// worktree, an agent worktree, and a temp folder are not projects anyone would register, so they are left
// out; two slugs for one folder (a drive letter's case) merge.
func scanClaudeProjects(root, headlessSlug, tempDir string) []ClaudeProject {
	dirs, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	byKey := map[string]*ClaudeProject{}
	for _, d := range dirs {
		if !d.IsDir() || (headlessSlug != "" && d.Name() == headlessSlug) {
			continue
		}
		p, ok := probeProjectDir(filepath.Join(root, d.Name()))
		if !ok || !isProjectCandidate(p.Path, tempDir) {
			continue
		}
		key := pathKey(p.Path)
		if prev := byKey[key]; prev != nil {
			prev.Sessions += p.Sessions
			if p.LastActiveTs > prev.LastActiveTs {
				prev.LastActiveTs = p.LastActiveTs
				prev.Path = p.Path
			}
			continue
		}
		byKey[key] = &p
	}
	out := make([]ClaudeProject, 0, len(byKey))
	for _, p := range byKey {
		p.Name = filepath.Base(p.Path)
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastActiveTs != out[j].LastActiveTs {
			return out[i].LastActiveTs > out[j].LastActiveTs
		}
		return out[i].Path < out[j].Path
	})
	return out
}

// probeProjectDir reads one store folder: its session count, its newest transcript, and the cwd of the
// newest transcript that names one.
func probeProjectDir(dir string) (ClaudeProject, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ClaudeProject{}, false
	}
	type file struct {
		path  string
		mtime int64
	}
	var files []file
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, file{filepath.Join(dir, e.Name()), info.ModTime().UnixMilli()})
	}
	if len(files) == 0 {
		return ClaudeProject{}, false
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mtime > files[j].mtime })
	for _, f := range files {
		if cwd := transcriptCwd(f.path); cwd != "" {
			return ClaudeProject{Path: cwd, LastActiveTs: files[0].mtime, Sessions: len(files)}, true
		}
	}
	return ClaudeProject{}, false
}

func transcriptCwd(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	r := bufio.NewReader(f)
	for i := 0; i < cwdProbeLines; i++ {
		line, err := r.ReadBytes('\n')
		// a line that pastes an image runs to megabytes; only one that names a cwd is worth decoding
		if bytes.Contains(line, []byte(`"cwd"`)) {
			var rec struct {
				Cwd string `json:"cwd"`
			}
			if json.Unmarshal(line, &rec) == nil && rec.Cwd != "" {
				return rec.Cwd
			}
		}
		if err != nil {
			return ""
		}
	}
	return ""
}

func isProjectCandidate(path, tempDir string) bool {
	slashed := "/" + strings.Trim(filepath.ToSlash(path), "/") + "/"
	for _, seg := range []string{"/.waveterm/worktrees/", "/.worktrees/", "/.claude/worktrees/"} {
		if strings.Contains(strings.ToLower(slashed), seg) {
			return false
		}
	}
	if tempDir != "" {
		if rel, err := filepath.Rel(tempDir, path); err == nil && !strings.HasPrefix(rel, "..") {
			return false
		}
	}
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func pathKey(path string) string {
	key := filepath.Clean(path)
	if runtime.GOOS == "windows" {
		key = strings.ToLower(key)
	}
	return key
}

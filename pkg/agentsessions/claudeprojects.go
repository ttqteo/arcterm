// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io/fs"
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

// ClaudeProjectFolders is every folder Claude Code keeps a store folder for, with transcripts or without, newest first:
// where Settings → Storage looks for build output. A store folder whose transcripts are all gone (cleanupPeriodDays,
// arcterm's session trash) keeps its memory and still names its folder: the name is matched against the disk, and the
// store folder's newest file dates it.
func ClaudeProjectFolders() []ClaudeProject {
	return claudeProjectFolders(filepath.Join(wavebase.GetHomeDir(), ".claude", "projects"), agentobserve.HeadlessAgentSlug(), os.TempDir(), runtime.GOOS)
}

func claudeProjectFolders(root, headlessSlug, tempDir, goos string) []ClaudeProject {
	out := scanClaudeProjects(root, headlessSlug, tempDir)
	seen := map[string]bool{}
	named := map[string]bool{}
	for _, p := range out {
		seen[pathKey(p.Path)] = true
		named[agentobserve.SlugifyCwd(p.Path)] = true
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return out
	}
	dirs := map[string][]string{}
	for _, d := range entries {
		if !d.IsDir() || named[d.Name()] || (headlessSlug != "" && d.Name() == headlessSlug) {
			continue
		}
		path, ok := pathOfSlug(d.Name(), goos, dirs)
		if !ok || seen[pathKey(path)] || !isProjectCandidate(path, tempDir) {
			continue
		}
		seen[pathKey(path)] = true
		out = append(out, ClaudeProject{Path: path, Name: filepath.Base(path), LastActiveTs: newestFileMs(filepath.Join(root, d.Name()))})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastActiveTs > out[j].LastActiveTs })
	return out
}

// pathOfSlug finds the folder a store folder's name was made from. SlugifyCwd turns every character but a letter or
// a digit into '-', which cannot be undone, so the name is matched against the disk one directory at a time from the
// root down: the first folder whose whole path slugs to the name wins. dirs caches each directory's subfolders.
func pathOfSlug(slug, goos string, dirs map[string][]string) (string, bool) {
	if goos == "windows" {
		if len(slug) < 3 || slug[1:3] != "--" {
			return "", false
		}
		return matchSlug(slug[:1]+`:\`, slug[3:], dirs)
	}
	if !strings.HasPrefix(slug, "-") {
		return "", false
	}
	return matchSlug("/", slug[1:], dirs)
}

// matchSlug finds the folder under dir whose path below dir slugs to rest.
func matchSlug(dir, rest string, dirs map[string][]string) (string, bool) {
	names, ok := dirs[dir]
	if !ok {
		names = subdirNames(dir)
		dirs[dir] = names
	}
	for _, n := range names {
		s := agentobserve.SlugifyCwd(n)
		if s == rest {
			return filepath.Join(dir, n), true
		}
		if strings.HasPrefix(rest, s+"-") {
			if p, ok := matchSlug(filepath.Join(dir, n), rest[len(s)+1:], dirs); ok {
				return p, true
			}
		}
	}
	return "", false
}

// subdirNames is the folders in dir, a link to a folder counted (a cwd may run through one, as /var does on a Mac).
func subdirNames(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		} else if e.Type()&fs.ModeSymlink != 0 {
			if info, err := os.Stat(filepath.Join(dir, e.Name())); err == nil && info.IsDir() {
				names = append(names, e.Name())
			}
		}
	}
	return names
}

// newestFileMs is the newest file's mtime under dir, UnixMilli, or dir's own when it holds no file.
func newestFileMs(dir string) int64 {
	var newest int64
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			if info, ierr := d.Info(); ierr == nil {
				newest = max(newest, info.ModTime().UnixMilli())
			}
		}
		return nil
	})
	if newest == 0 {
		if info, err := os.Stat(dir); err == nil {
			newest = info.ModTime().UnixMilli()
		}
	}
	return newest
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

// probeProjectDir reads one store folder: its session count, its newest transcript, and its directory: the cwd of the
// newest transcript that names the one the folder is named for, else (a slug Claude Code shortened) the cwd of the
// newest transcript that names any. A session begun on another machine and resumed here opens on that machine's
// checkout, which would leave the folder out as missing.
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
	slug := filepath.Base(dir)
	path := ""
	for _, f := range files {
		cwd, home := transcriptCwd(f.path, slug)
		if home {
			path = cwd
			break
		}
		if path == "" {
			path = cwd
		}
	}
	if path == "" {
		return ClaudeProject{}, false
	}
	return ClaudeProject{Path: path, LastActiveTs: files[0].mtime, Sessions: len(files)}, true
}

// transcriptCwd reads the cwd a transcript's first records name: the first whose slug is the store folder's (home),
// else the first.
func transcriptCwd(path, slug string) (cwd string, home bool) {
	f, err := os.Open(path)
	if err != nil {
		return "", false
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
			if json.Unmarshal(line, &rec) == nil && rec.Cwd != "" && rec.Cwd != cwd {
				if strings.EqualFold(agentobserve.SlugifyCwd(rec.Cwd), slug) {
					return rec.Cwd, true
				}
				if cwd == "" {
					cwd = rec.Cwd
				}
			}
		}
		if err != nil {
			break
		}
	}
	return cwd, false
}

func isProjectCandidate(path, tempDir string) bool {
	slashed := "/" + strings.Trim(filepath.ToSlash(path), "/") + "/"
	for _, seg := range []string{"/.waveterm/worktrees/", "/.worktrees/", "/.claude/worktrees/"} {
		if strings.Contains(strings.ToLower(slashed), seg) {
			return false
		}
	}
	if isUnderDir(path, tempDir) {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// isUnderDir reports whether path is dir or inside it; an empty path or dir is never under anything.
func isUnderDir(path, dir string) bool {
	if path == "" || dir == "" {
		return false
	}
	rel, err := filepath.Rel(dir, path)
	return err == nil && !strings.HasPrefix(rel, "..")
}

func pathKey(path string) string {
	key := filepath.Clean(path)
	if runtime.GOOS == "windows" {
		key = strings.ToLower(key)
	}
	return key
}

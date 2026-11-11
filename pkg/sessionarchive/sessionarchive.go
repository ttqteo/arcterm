// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package sessionarchive moves the Claude transcripts arcterm's own machinery leaves behind (engine workers, reviewers
// and judges in run worktrees, agents started in temp folders, the backend's headless passes) out of Claude Code's
// projects folder into ~/.arc/archive/claude-sessions. Claude Desktop lists every folder under projects as a project
// of its own, so a few hundred runs buried the user's real ones. arcterm's history, run usage and token stats read the
// archive beside the projects folder (ArchiveOf), so nothing goes missing in the cockpit. Nothing here deletes.
package sessionarchive

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	// Quiet is how long nothing under a folder (or a headless transcript) must have been written before it moves:
	// a session still running writes every turn.
	Quiet = 15 * time.Minute
	// TempIdle is how long a temp folder that is still on disk stays: a verify scenario's folder is often left behind.
	TempIdle = 24 * time.Hour
	// SweepInterval is the pause between sweeps while wavesrv runs.
	SweepInterval = time.Hour

	// cwdProbeLines bounds how far into a transcript the sweep looks for its cwd (Claude Code writes it on the first
	// user record)
	cwdProbeLines = 40
)

// ProjectsRoot is where Claude Code keeps its transcripts, one folder per cwd.
func ProjectsRoot() string {
	return filepath.Join(wavebase.GetHomeDir(), ".claude", "projects")
}

// Dir is the archive: the same <slug>/<session>.jsonl layout as ProjectsRoot.
func Dir() string {
	return filepath.Join(wavebase.GetHomeDir(), ".arc", "archive", "claude-sessions")
}

// ArchiveOf is the archive that holds what the sweep moved out of root: Dir for ProjectsRoot, "" for any other root
// (a test's temp dir, a CLAUDE_CONFIG_DIR store), which has none.
func ArchiveOf(root string) string {
	if root == "" || !samePath(root, ProjectsRoot()) {
		return ""
	}
	return Dir()
}

// Rules says which folders are arcterm's own.
type Rules struct {
	TempDir      string // os.TempDir(): a session whose cwd is under it is a test's or a verify scenario's
	WorktreeRoot string // the engine's shared tree root (arc-wt); "" when it keeps trees in each project
	HeadlessSlug string // the store folder of the backend's headless passes; "" when there is none
}

// kind is what a store folder holds.
type kind int

const (
	kindOther kind = iota
	kindTree       // an engine run's worktree, shared root or legacy <project>/.waveterm/worktrees
	kindTemp       // a folder under the temp dir
)

// classify sorts a store folder by its slug alone, so the user's own projects are never opened.
func (r Rules) classify(slug string) kind {
	if r.WorktreeRoot != "" && strings.HasPrefix(slug, agentobserve.SlugifyCwd(filepath.Clean(r.WorktreeRoot))+"-") {
		return kindTree
	}
	if strings.Contains(slug, "-waveterm-worktrees-") {
		return kindTree
	}
	if r.TempDir != "" && strings.HasPrefix(slug, agentobserve.SlugifyCwd(filepath.Clean(r.TempDir))+"-") {
		return kindTemp
	}
	return kindOther
}

// Sweep moves arcterm's own store folders from root into archive and returns how many folders and headless
// transcripts it moved. A folder moves once nothing under it was written for Quiet and its cwd is gone from disk (a
// run's tree is removed when its task lands; one kept, a held run's, can still be resumed in place), or, under the
// temp dir, once it was idle for TempIdle. A headless pass moves transcript by transcript once Quiet.
func Sweep(root, archive string, r Rules, now time.Time) (int, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	moved := 0
	var errs []error
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		src := filepath.Join(root, e.Name())
		if r.HeadlessSlug != "" && e.Name() == r.HeadlessSlug {
			n, err := sweepHeadless(src, filepath.Join(archive, e.Name()), now)
			moved += n
			if err != nil {
				errs = append(errs, err)
			}
			continue
		}
		k := r.classify(e.Name())
		if k == kindOther {
			continue
		}
		newest, cwd := probe(src)
		idle := now.Sub(newest)
		if newest.IsZero() || idle < Quiet {
			continue
		}
		if !gone(cwd) && !(k == kindTemp && idle >= TempIdle) {
			continue
		}
		if err := moveMerge(src, filepath.Join(archive, e.Name())); err != nil {
			errs = append(errs, err)
			continue
		}
		moved++
	}
	return moved, errors.Join(errs...)
}

// sweepHeadless moves each quiet transcript of the headless folder, with the sibling folder Claude Code keeps beside
// it; the folder itself stays (the next pass writes there, and its memory is the backend's).
func sweepHeadless(src, dst string, now time.Time) (int, error) {
	entries, err := os.ReadDir(src)
	if err != nil {
		return 0, err
	}
	moved := 0
	var errs []error
	for _, e := range entries {
		if !e.Type().IsRegular() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil || now.Sub(info.ModTime()) < Quiet {
			continue
		}
		if err := os.MkdirAll(dst, 0o755); err != nil {
			return moved, err
		}
		if err := moveMerge(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			errs = append(errs, err)
			continue
		}
		moved++
		sib := strings.TrimSuffix(e.Name(), ".jsonl")
		if info, err := os.Stat(filepath.Join(src, sib)); err == nil && info.IsDir() {
			if err := moveMerge(filepath.Join(src, sib), filepath.Join(dst, sib)); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return moved, errors.Join(errs...)
}

// probe is the newest file's mtime under dir and the cwd its newest transcript names ("" when none does).
func probe(dir string) (time.Time, string) {
	var newest, newestJSONL time.Time
	var transcript string
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		// a session's own transcript sits at the folder's top level; subagents' are below it
		if filepath.Dir(p) == dir && strings.HasSuffix(p, ".jsonl") && info.ModTime().After(newestJSONL) {
			newestJSONL, transcript = info.ModTime(), p
		}
		return nil
	})
	if transcript == "" {
		return newest, ""
	}
	return newest, transcriptCwd(transcript)
}

// transcriptCwd is the first cwd a transcript's opening records name.
func transcriptCwd(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	r := bufio.NewReader(f)
	for range cwdProbeLines {
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

// gone reports whether cwd is known and no longer on disk; an unknown cwd is never gone.
func gone(cwd string) bool {
	if cwd == "" {
		return false
	}
	_, err := os.Stat(cwd)
	return errors.Is(err, fs.ErrNotExist)
}

// moveMerge renames src to dst; when dst is already there (a folder moved before, then written to again) it merges
// src into it, a file in both taking src's copy, the newer.
func moveMerge(src, dst string) error {
	if _, err := os.Lstat(dst); errors.Is(err, fs.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		return os.Rename(src, dst)
	}
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		if err := os.Remove(dst); err != nil {
			return err
		}
		return os.Rename(src, dst)
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := moveMerge(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return os.Remove(src)
}

func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if a == b {
		return true
	}
	return os.PathSeparator == '\\' && strings.EqualFold(a, b)
}

// StartSweepLoop sweeps ProjectsRoot now and then every SweepInterval, until ctx ends.
func StartSweepLoop(ctx context.Context, r Rules) {
	go func() {
		defer func() {
			panichandler.PanicHandler("sessionarchive.SweepLoop", recover())
		}()
		for {
			n, err := Sweep(ProjectsRoot(), Dir(), r, time.Now())
			if err != nil {
				log.Printf("error archiving arcterm's Claude sessions: %v\n", err)
			}
			if n > 0 {
				log.Printf("archived %d Claude sessions arcterm's runs and passes left in %s\n", n, ProjectsRoot())
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(SweepInterval):
			}
		}
	}()
}

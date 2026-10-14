// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package storage measures what arcterm and its agents leave on disk and cleans it (Settings → Storage):
// finished runs' worktrees, old Claude sessions, rolled logs with the session trash and the webview cache, and
// the projects' build output. Each category is a provider, and every rule a clean depends on is checked again at
// the moment of removal: a run can restart or a session reopen between a scan and a click. The types carry a
// Storage prefix because the generated TypeScript names a type by its bare Go name.
package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type StorageCategory string

const (
	CategoryRunWorktrees StorageCategory = "runworktrees"
	CategorySessions     StorageCategory = "sessions"
	CategoryHousekeeping StorageCategory = "housekeeping"
	CategoryBuildOutput  StorageCategory = "buildoutput"
	CategoryCanvases     StorageCategory = "canvases"
)

// what an item is, for the row and for auto-clean's pick
const (
	KindWorktree     = "worktree"
	KindSession      = "session"
	KindLog          = "log"
	KindTrash        = "trash"
	KindWebviewCache = "webviewcache"
	KindBuild        = "build"
	KindAttachments  = "attachments"
	KindCanvas       = "canvas"
)

// StorageItem is one thing a category can clean: a run's worktree, a session, a rolled log, the trash, the
// webview cache, a build directory.
type StorageItem struct {
	ID        string `json:"id"` // what a clean names it by: its path, or "trash" / "webviewcache"
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	Detail    string `json:"detail,omitempty"`
	Path      string `json:"path,omitempty"`
	Bytes     int64  `json:"bytes"`
	ModTs     int64  `json:"modts,omitempty"`   // unix ms of its last change: the sessions card filters by it
	Cleanable bool   `json:"cleanable"`         // a clean may remove it now
	Guarded   bool   `json:"guarded,omitempty"` // only its own button removes it, after a confirm that says what is lost
	Reason    string `json:"reason,omitempty"`  // why it stays, or what removing it costs
}

type StorageCategoryReport struct {
	Category       StorageCategory `json:"category"`
	Bytes          int64           `json:"bytes"`
	CleanableBytes int64           `json:"cleanablebytes"` // cleanable and not guarded
	Items          []StorageItem   `json:"items"`
	Error          string          `json:"error,omitempty"` // what kept the scan from reading all of it
}

type StorageReport struct {
	ScannedTs  int64                   `json:"scannedts"` // 0 before the first scan
	Scanning   bool                    `json:"scanning"`
	Categories []StorageCategoryReport `json:"categories"`
	StoreBytes int64                   `json:"storebytes"` // arcterm's store (<data>/db): shown, never cleaned
	LastAuto   *StorageAutoClean       `json:"lastauto,omitempty"`
}

type StorageSkipped struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

type StorageCleanResult struct {
	Reclaimed int64            `json:"reclaimed"`          // bytes removed from disk
	Trashed   int64            `json:"trashed,omitempty"`  // bytes moved to ~/.arc/trash
	Deferred  bool             `json:"deferred,omitempty"` // the webview cache clears at the next launch
	Cleaned   []string         `json:"cleaned"`
	Skipped   []StorageSkipped `json:"skipped"`
}

type StorageAutoClean struct {
	Ts        int64  `json:"ts"`
	Reclaimed int64  `json:"reclaimed"`
	Error     string `json:"error,omitempty"`
}

// CleanOpts is how a clean was asked for.
type CleanOpts struct {
	OlderThanDays int  // sessions: the card's age
	AllowGuarded  bool // the item's own button, after its stronger confirm
	Auto          bool // the daily auto-clean: only what needs no one's say
}

// RunState is what a worktree's owner run says about the tree.
type RunState struct {
	Found    bool
	Finished bool   // done or cancelled
	Status   string // for the row
}

// Env is everything a provider reads from outside the filesystem, so tests run against temp dirs and fakes.
type Env struct {
	Now              func() time.Time
	ProjectPaths     func() []string                           // the projects in config
	RunOfWorktree    func(path string) (runID string, ok bool) // the run that owns an engine tree; ok false for a name the engine never makes
	RunState         func(ctx context.Context, runID string) (RunState, error)
	BusyProjects     func(ctx context.Context) (map[string]string, error) // project path -> why its build output must stay now
	LiveTranscripts  func(ctx context.Context) ([]string, error)          // the transcripts open tabs are writing
	RemoveWorktree   func(ctx context.Context, projectPath, wt string) error
	DataDir          string // <data>: logs, the store, the cache marker
	TrashDir         string
	AttachmentsDir   string // ~/.arc/attachments: the images sent with a new agent's task, which its transcript shows
	SessionDirs      []string
	WebviewCacheDirs []string
}

type provider interface {
	category() StorageCategory
	measure(ctx context.Context, env *Env) StorageCategoryReport
	clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult
}

// report builds a category's report from its items and the error its scan ended with, if any.
func report(cat StorageCategory, items []StorageItem, err error) StorageCategoryReport {
	r := StorageCategoryReport{Category: cat, Items: items}
	if r.Items == nil {
		r.Items = []StorageItem{}
	}
	for _, it := range items {
		r.Bytes += it.Bytes
		if it.Cleanable && !it.Guarded {
			r.CleanableBytes += it.Bytes
		}
	}
	if err != nil {
		r.Error = err.Error()
	}
	return r
}

// dirSize is the summed size of the regular files under root, not following links. A missing or unreadable
// part counts as nothing: a scan reports what it can read.
func dirSize(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.Type().IsRegular() {
			if info, ierr := d.Info(); ierr == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

// SamePath compares two paths as the OS does: cleaned, and without case on Windows.
func SamePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// evalOrClean resolves the links in p, or cleans it when it cannot (a path that is gone).
func evalOrClean(p string) string {
	if r, err := filepath.EvalSymlinks(p); err == nil {
		return r
	}
	return filepath.Clean(p)
}

// gitOut runs git in dir and returns its stdout, also when git exits non-zero (check-ignore exits 1 for "none").
func gitOut(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return string(out), fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return string(out), nil
}

func skip(res *StorageCleanResult, id, reason string) {
	res.Skipped = append(res.Skipped, StorageSkipped{ID: id, Reason: reason})
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil || !errors.Is(err, fs.ErrNotExist)
}

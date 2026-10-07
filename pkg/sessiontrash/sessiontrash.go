// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package sessiontrash deletes an ended Claude session by moving its transcript (and the sibling
// directory Claude Code keeps beside it: subagents, tool results) into ~/.arc/trash, where it stays for
// Retention before the purge removes it. Nothing here restores: put the files back by hand from the
// entry's meta.json.
package sessiontrash

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	// Retention is how long a trashed session stays before the purge removes it.
	Retention = 7 * 24 * time.Hour
	// LiveWindow is how recently a transcript may have been written before its session counts as running.
	LiveWindow = 2 * time.Minute
	// PurgeInterval is the pause between purges while wavesrv runs.
	PurgeInterval = 24 * time.Hour

	transcriptExt = ".jsonl"
	metaName      = "meta.json"
)

var (
	ErrNotTranscript   = errors.New("only a Claude transcript (.jsonl) can be deleted")
	ErrOutsideProjects = errors.New("that file is not a session in the Claude projects folder")
	ErrNotFound        = errors.New("that session's transcript no longer exists")
	ErrLive            = errors.New("that session is still running (an open tab has it, or it was written to in the last 2 minutes): stop it first")
)

// Options is what one Delete needs, so the checks run against a temp dir in tests.
type Options struct {
	ProjectsDirs    []string // the roots a transcript may sit under: <root>/<project>/<id>.jsonl
	TrashDir        string
	LiveTranscripts []string // the transcript paths open tabs' agents are writing
	Now             time.Time
}

type meta struct {
	OriginalPath string `json:"originalPath"`
	DeletedAt    string `json:"deletedAt"` // RFC 3339
}

// ProjectsDirs is where Claude Code keeps its transcripts: CLAUDE_CONFIG_DIR/projects when that is set, and
// always ~/.claude/projects, where the sessions archive reads them from.
func ProjectsDirs() []string {
	var dirs []string
	if cfg := os.Getenv("CLAUDE_CONFIG_DIR"); cfg != "" {
		dirs = append(dirs, filepath.Join(cfg, "projects"))
	}
	return append(dirs, filepath.Join(wavebase.GetHomeDir(), ".claude", "projects"))
}

// TrashDir is ~/.arc/trash.
func TrashDir() string {
	return filepath.Join(wavebase.GetHomeDir(), ".arc", "trash")
}

// Delete moves an ended session's transcript, and its sibling <id>/ directory when there is one, into
// <TrashDir>/<unix-ms>-<id>/ beside a meta.json that names where they came from. It returns that entry's
// path. It refuses a path that is not <projects dir>/<project>/<id>.jsonl, and a session that is still
// running.
func Delete(o Options, transcriptPath string) (string, error) {
	transcript, err := resolveTranscript(o.ProjectsDirs, transcriptPath)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(transcript)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("reading the transcript: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", ErrNotTranscript
	}
	for _, live := range o.LiveTranscripts {
		if samePath(live, transcriptPath) || samePath(live, transcript) {
			return "", ErrLive
		}
	}
	if o.Now.Sub(info.ModTime()) < LiveWindow {
		return "", ErrLive
	}

	dir, name := filepath.Split(transcript)
	dir = filepath.Clean(dir)
	id := strings.TrimSuffix(name, transcriptExt)
	entry := filepath.Join(o.TrashDir, fmt.Sprintf("%d-%s", o.Now.UnixMilli(), id))
	if err := os.MkdirAll(o.TrashDir, 0o700); err != nil {
		return "", fmt.Errorf("creating the trash: %w", err)
	}
	if err := os.Mkdir(entry, 0o700); err != nil {
		return "", fmt.Errorf("creating the trash entry: %w", err)
	}
	// the meta first: an entry that exists says where its files came from, even if this is cut short
	raw, _ := json.MarshalIndent(meta{OriginalPath: transcriptPath, DeletedAt: o.Now.UTC().Format(time.RFC3339)}, "", "  ")
	if err := os.WriteFile(filepath.Join(entry, metaName), raw, 0o600); err != nil {
		_ = os.RemoveAll(entry)
		return "", fmt.Errorf("writing the trash entry: %w", err)
	}
	if err := moveEntry(transcript, filepath.Join(entry, name)); err != nil {
		_ = os.RemoveAll(entry)
		return "", fmt.Errorf("moving the transcript to the trash: %w", err)
	}
	sibling := filepath.Join(dir, id)
	if st, err := os.Lstat(sibling); err == nil && st.IsDir() {
		if err := moveEntry(sibling, filepath.Join(entry, id)); err != nil {
			// all or nothing: the transcript goes back, so the session is not left without its subagents
			if back := moveEntry(filepath.Join(entry, name), transcript); back != nil {
				return "", fmt.Errorf("moving the session's directory to the trash: %w (and the transcript is in %s: %v)", err, entry, back)
			}
			_ = os.RemoveAll(entry)
			return "", fmt.Errorf("moving the session's directory to the trash: %w", err)
		}
	}
	return entry, nil
}

// resolveTranscript checks that path names <projects dir>/<project>/<id>.jsonl and returns it with the
// symlinks in its directory resolved. A ".." segment is refused outright rather than cleaned away.
func resolveTranscript(roots []string, path string) (string, error) {
	if path == "" || !strings.HasSuffix(path, transcriptExt) {
		return "", ErrNotTranscript
	}
	name := filepath.Base(path)
	if name == transcriptExt {
		return "", ErrNotTranscript
	}
	if !filepath.IsAbs(path) {
		return "", ErrOutsideProjects
	}
	for _, seg := range strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' }) {
		if seg == ".." {
			return "", ErrOutsideProjects
		}
	}
	parent := filepath.Dir(filepath.Clean(path))
	sawRoot := false
	for _, root := range roots {
		resolvedRoot, err := filepath.EvalSymlinks(root)
		if err != nil {
			continue
		}
		sawRoot = true
		resolvedParent, err := filepath.EvalSymlinks(parent)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(resolvedRoot, resolvedParent)
		// the parent is a project directory: exactly one segment below the root
		if err != nil || rel == "." || rel == ".." || strings.ContainsRune(rel, filepath.Separator) {
			continue
		}
		return filepath.Join(resolvedParent, name), nil
	}
	if sawRoot {
		if _, err := os.Lstat(path); errors.Is(err, fs.ErrNotExist) {
			// not found under the roots, and not on disk: a session that is already gone
			if hasPrefixDir(roots, path) {
				return "", ErrNotFound
			}
		}
	}
	return "", ErrOutsideProjects
}

// hasPrefixDir reports whether path is lexically below one of the roots, however deep.
func hasPrefixDir(roots []string, path string) bool {
	for _, root := range roots {
		rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(path))
		if err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// samePath compares two paths as the file system does: slashes and, on Windows and macOS, case, are not
// told apart.
func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// moveEntry renames src to dst, or copies it and removes the original when the rename cannot (the trash on
// another volume than the projects dir).
func moveEntry(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	return copyThenRemove(src, dst)
}

// copyThenRemove copies a file or a directory tree to dst and then removes src. A copy that fails part way
// is removed again and leaves src as it was.
func copyThenRemove(src, dst string) error {
	if err := copyTree(src, dst); err != nil {
		_ = os.RemoveAll(dst)
		return err
	}
	if err := os.RemoveAll(src); err != nil {
		_ = os.RemoveAll(dst)
		return fmt.Errorf("removing the original: %w", err)
	}
	return nil
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(target, 0o700)
		case info.Mode()&fs.ModeSymlink != 0:
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		case info.Mode().IsRegular():
			return copyFile(path, target, info.Mode().Perm())
		}
		return nil // a socket or a device is not something a session wrote
	})
}

func copyFile(src, dst string, perm fs.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm|0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// Purge removes the trash entries older than maxAge and returns how many it removed. An entry is a
// directory named <unix-ms>-<id>; anything else in the trash is not ours and stays.
func Purge(trashDir string, maxAge time.Duration, now time.Time) (int, error) {
	entries, err := os.ReadDir(trashDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	removed := 0
	var errs []error
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		ms, _, ok := strings.Cut(e.Name(), "-")
		deletedMs, perr := strconv.ParseInt(ms, 10, 64)
		if !ok || perr != nil || deletedMs <= 0 {
			continue
		}
		if now.Sub(time.UnixMilli(deletedMs)) <= maxAge {
			continue
		}
		if err := os.RemoveAll(filepath.Join(trashDir, e.Name())); err != nil {
			errs = append(errs, err)
			continue
		}
		removed++
	}
	return removed, errors.Join(errs...)
}

// StartPurgeLoop purges the trash now and then every PurgeInterval, until ctx ends.
func StartPurgeLoop(ctx context.Context) {
	go func() {
		defer func() {
			panichandler.PanicHandler("sessiontrash.PurgeLoop", recover())
		}()
		for {
			n, err := Purge(TrashDir(), Retention, time.Now())
			if err != nil {
				log.Printf("error purging the session trash: %v\n", err)
			}
			if n > 0 {
				log.Printf("purged %d trashed sessions older than %d days\n", n, int(Retention/(24*time.Hour)))
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(PurgeInterval):
			}
		}
	}()
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package notestore keeps the user's notes as <vault>/notes/<id>.md files, so the vault's git sync
// carries them between machines and they read as plain markdown anywhere. Only wavesrv writes them (wsh
// goes through RPC), so an in-process lock suffices. The one global scratch note is notes/scratch.md,
// which List skips.
package notestore

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	// NotesDir holds one notes/<id>.md file per note.
	NotesDir = "notes"

	scratchFile   = "scratch.md"
	noteExt       = ".md"
	dayLayout     = "2006-01-02"
	titlePrefix   = "# "
	fallbackSlug  = "note"
	maxSlugLen    = 60
	maxTitleLen   = 200
	maxCollisions = 1000
)

var (
	// an id is the day the note was added and a slug of its first title; it also keeps ids inside notes/
	idRe      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$`)
	nonSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

	// ponytail: one lock for every note; per-file locks if notes are ever written concurrently in bulk
	mu           sync.Mutex
	rootOverride string
	now          = time.Now
)

// UseRootForTest points the store at a temp vault root and returns the restore func.
func UseRootForTest(root string) (restore func()) {
	mu.Lock()
	defer mu.Unlock()
	prev := rootOverride
	rootOverride = root
	return func() {
		mu.Lock()
		defer mu.Unlock()
		rootOverride = prev
	}
}

// callers hold mu
func vaultRoot() string {
	if rootOverride != "" {
		return rootOverride
	}
	return memroots.VaultRoot()
}

func notesDir() string {
	return filepath.Join(vaultRoot(), NotesDir)
}

func scratchPath() string {
	return filepath.Join(notesDir(), scratchFile)
}

func notePath(id string) (string, error) {
	if !idRe.MatchString(id) {
		return "", fmt.Errorf("invalid note id %q", id)
	}
	return filepath.Join(notesDir(), id+noteExt), nil
}

func cleanTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", errors.New("note title cannot be empty")
	}
	if len(title) > maxTitleLen || strings.ContainsAny(title, "\r\n") {
		return "", fmt.Errorf("note title must be one line of at most %d bytes", maxTitleLen)
	}
	return title, nil
}

func slugOf(title string) string {
	slug := strings.Trim(nonSlugRe.ReplaceAllString(strings.ToLower(title), "-"), "-")
	if len(slug) > maxSlugLen {
		slug = strings.Trim(slug[:maxSlugLen], "-")
	}
	if slug == "" {
		return fallbackSlug
	}
	return slug
}

func render(title, body string) []byte {
	body = strings.TrimSpace(body)
	if body == "" {
		return []byte(titlePrefix + title + "\n")
	}
	return []byte(titlePrefix + title + "\n\n" + body + "\n")
}

// parse reads a note file. A file with no heading on its first line (one edited by hand) is all body,
// titled by its id.
func parse(id string, content []byte) *waveobj.UserNote {
	text := strings.ReplaceAll(string(content), "\r\n", "\n")
	note := &waveobj.UserNote{ID: id, Title: id, Day: id[:len(dayLayout)]}
	first, rest, _ := strings.Cut(text, "\n")
	if title, ok := strings.CutPrefix(first, titlePrefix); ok && strings.TrimSpace(title) != "" {
		note.Title = strings.TrimSpace(title)
		text = rest
	}
	note.Body = strings.TrimSpace(text)
	return note
}

func write(path string, content []byte) error {
	unlock := wavevault.LockRoot(vaultRoot())
	defer unlock()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(path), err)
	}
	if err := fileutil.AtomicWriteFile(path, content, 0o644); err != nil {
		return fmt.Errorf("write note %s: %w", path, err)
	}
	wavevault.Poke()
	return nil
}

func exists(path string) (bool, error) {
	_, err := os.Stat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

func notFound(id string) error {
	return fmt.Errorf("note %s: %w", id, wstore.ErrNotFound)
}

// Add files a new note under today's date. A second note with the same title on the same day gets a
// numbered id.
func Add(title, body string) (*waveobj.UserNote, error) {
	title, err := cleanTitle(title)
	if err != nil {
		return nil, err
	}
	mu.Lock()
	defer mu.Unlock()
	base := now().Format(dayLayout) + "-" + slugOf(title)
	for n := 1; n <= maxCollisions; n++ {
		id := base
		if n > 1 {
			id = fmt.Sprintf("%s-%d", base, n)
		}
		path, err := notePath(id)
		if err != nil {
			return nil, err
		}
		taken, err := exists(path)
		if err != nil {
			return nil, fmt.Errorf("note file %s: %w", path, err)
		}
		if taken {
			continue
		}
		content := render(title, body)
		if err := write(path, content); err != nil {
			return nil, err
		}
		return parse(id, content), nil
	}
	return nil, fmt.Errorf("too many notes named %q today", title)
}

// List returns every note, newest day first.
func List() ([]*waveobj.UserNote, error) {
	mu.Lock()
	defer mu.Unlock()
	dir := notesDir()
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}
	type listed struct {
		note    *waveobj.UserNote
		modTime time.Time
	}
	var found []listed
	for _, e := range entries {
		id, isNote := strings.CutSuffix(e.Name(), noteExt)
		if e.IsDir() || !isNote || !idRe.MatchString(id) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			return nil, fmt.Errorf("note file %s: %w", e.Name(), err)
		}
		content, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, fmt.Errorf("note file %s: %w", e.Name(), err)
		}
		found = append(found, listed{parse(id, content), info.ModTime()})
	}
	// ponytail: a fresh clone gives every file of a day the checkout's time, so the order inside a day is then by id
	slices.SortFunc(found, func(a, b listed) int {
		if c := strings.Compare(b.note.Day, a.note.Day); c != 0 {
			return c
		}
		if c := b.modTime.Compare(a.modTime); c != 0 {
			return c
		}
		return strings.Compare(a.note.ID, b.note.ID)
	})
	var notes []*waveobj.UserNote
	for _, f := range found {
		notes = append(notes, f.note)
	}
	return notes, nil
}

// ReadScratch returns the scratch note as written, or "" when there is none yet.
func ReadScratch() (string, error) {
	mu.Lock()
	defer mu.Unlock()
	b, err := os.ReadFile(scratchPath())
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read scratch note: %w", err)
	}
	return string(b), nil
}

// WriteScratch replaces the scratch note with body, byte for byte; an empty body clears it.
func WriteScratch(body string) error {
	mu.Lock()
	defer mu.Unlock()
	return write(scratchPath(), []byte(body))
}

// Update rewrites a note's title and body. Its id, and so its day, stay.
func Update(id, title, body string) error {
	title, err := cleanTitle(title)
	if err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	path, err := notePath(id)
	if err != nil {
		return err
	}
	found, err := exists(path)
	if err != nil {
		return fmt.Errorf("note file %s: %w", path, err)
	}
	if !found {
		return notFound(id)
	}
	return write(path, render(title, body))
}

func Delete(id string) error {
	mu.Lock()
	defer mu.Unlock()
	path, err := notePath(id)
	if err != nil {
		return err
	}
	unlock := wavevault.LockRoot(vaultRoot())
	defer unlock()
	if err := os.Remove(path); errors.Is(err, fs.ErrNotExist) {
		return notFound(id)
	} else if err != nil {
		return fmt.Errorf("delete note %s: %w", id, err)
	}
	wavevault.Poke()
	return nil
}

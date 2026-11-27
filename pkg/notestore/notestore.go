// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package notestore keeps the user's notes as <vault>/notes/<id>.md files, so the vault's git sync
// carries them between machines and they read as plain markdown anywhere. Only wavesrv writes them (wsh
// goes through RPC), so an in-process lock suffices. List reads only files named as a note id, so other
// files in notes/ (the old Float scratch.md) stay out.
package notestore

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/util/asciifold"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	// NotesDir holds one notes/<id>.md file per note.
	NotesDir = "notes"

	noteExt          = ".md"
	frontmatterFence = "---"
	dayLayout        = "2006-01-02"
	titlePrefix      = "# "
	fallbackSlug     = "note"
	maxSlugLen       = 60
	maxTitleLen      = 200
	maxCollisions    = 1000
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
	slug := strings.Trim(nonSlugRe.ReplaceAllString(asciifold.Lower(title), "-"), "-")
	if len(slug) > maxSlugLen {
		slug = strings.Trim(slug[:maxSlugLen], "-")
	}
	if slug == "" {
		return fallbackSlug
	}
	return slug
}

// Source is where a note was written: the project's name and the agent conversation's id. It is the file's
// frontmatter, so the note still reads as markdown anywhere and Obsidian shows it as properties.
type Source struct {
	Project string
	Session string
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// a value YAML would read as something else (a colon-space, a comment, a leading indicator) goes in double quotes
func yamlValue(v string) string {
	if strings.Contains(v, ": ") || strings.Contains(v, " #") || strings.HasSuffix(v, ":") ||
		strings.ContainsAny(v[:1], "\"'[]{}&*!|>%@`#,?-") {
		return strconv.Quote(v)
	}
	return v
}

// the frontmatter block for src, with its closing line and a newline; "" when src is empty
func frontmatterOf(src Source) string {
	var b strings.Builder
	for _, kv := range [][2]string{{"project", oneLine(src.Project)}, {"session", oneLine(src.Session)}} {
		if kv[1] != "" {
			b.WriteString(kv[0] + ": " + yamlValue(kv[1]) + "\n")
		}
	}
	if b.Len() == 0 {
		return ""
	}
	return frontmatterFence + "\n" + b.String() + frontmatterFence + "\n"
}

// splitFrontmatter cuts a leading `---` … `---` block off text (LF line ends). It returns the block as written,
// closing fence and its newline included, so an edit writes back what it does not understand; "" when there is none.
func splitFrontmatter(text string) (block, rest string) {
	if !strings.HasPrefix(text, frontmatterFence+"\n") {
		return "", text
	}
	start := len(frontmatterFence) + 1
	for off := start; ; {
		line, _, more := strings.Cut(text[off:], "\n")
		next := off + len(line)
		if more {
			next++
		}
		if strings.TrimRight(line, " \t") == frontmatterFence {
			return text[:next], text[next:]
		}
		if !more {
			return "", text
		}
		off = next
	}
}

func unquote(v string) string {
	if len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"' {
		if s, err := strconv.Unquote(v); err == nil {
			return s
		}
	}
	if len(v) >= 2 && v[0] == '\'' && v[len(v)-1] == '\'' {
		return strings.ReplaceAll(v[1:len(v)-1], "''", "'")
	}
	return v
}

// sourceOf reads the project and session keys of a frontmatter block; other keys are left alone
func sourceOf(block string) Source {
	var src Source
	for _, line := range strings.Split(block, "\n") {
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		val = unquote(strings.TrimSpace(val))
		switch strings.TrimSpace(key) {
		case "project":
			src.Project = val
		case "session":
			src.Session = val
		}
	}
	return src
}

func render(front, title, body string) []byte {
	body = strings.TrimSpace(body)
	if body == "" {
		return []byte(front + titlePrefix + title + "\n")
	}
	return []byte(front + titlePrefix + title + "\n\n" + body + "\n")
}

// parse reads a note file. A file with no heading on its first line (one edited by hand) is all body,
// titled by its id. A frontmatter block above the heading gives the note its Source.
func parse(id string, content []byte) *waveobj.UserNote {
	block, text := splitFrontmatter(strings.ReplaceAll(string(content), "\r\n", "\n"))
	src := sourceOf(block)
	note := &waveobj.UserNote{ID: id, Title: id, Day: id[:len(dayLayout)], Project: src.Project, Session: src.Session}
	first, rest, _ := strings.Cut(text, "\n")
	if title, ok := strings.CutPrefix(first, titlePrefix); ok && strings.TrimSpace(title) != "" {
		note.Title = strings.TrimSpace(title)
		text = rest
	}
	note.Body = strings.TrimSpace(text)
	return note
}

// write expects its caller to hold the vault lock from before it read the file, so a sync's merge cannot land
// between that read and this write.
func write(path string, content []byte) error {
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

// Add files a new note under today's date, src as its frontmatter. A second note with the same title on the same day gets a
// numbered id.
func Add(title, body string, src Source) (*waveobj.UserNote, error) {
	title, err := cleanTitle(title)
	if err != nil {
		return nil, err
	}
	mu.Lock()
	defer mu.Unlock()
	unlock := wavevault.LockRoot(vaultRoot())
	defer unlock()
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
		content := render(frontmatterOf(src), title, body)
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

// Update rewrites a note's title and body. Its id, and so its day, stay.
func Update(id, title, body string) error {
	title, err := cleanTitle(title)
	if err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	unlock := wavevault.LockRoot(vaultRoot())
	defer unlock()
	path, err := notePath(id)
	if err != nil {
		return err
	}
	old, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return notFound(id)
	}
	if err != nil {
		return fmt.Errorf("note file %s: %w", path, err)
	}
	// the frontmatter stays as it was written: the editor shows the title and body only
	front, _ := splitFrontmatter(strings.ReplaceAll(string(old), "\r\n", "\n"))
	return write(path, render(front, title, body))
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

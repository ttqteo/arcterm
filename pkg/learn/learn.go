package learn

import (
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	notesFile    = "notes.jsonl"
	mutedFile    = "muted.json"
	proposedFile = "proposed.json"

	// A key is proposed when its notes in this window before the newest one come from minSessions sessions.
	proposeWindow = 30 * 24 * time.Hour
	minSessions   = 2

	maxKeyBytes   = 64
	maxTextRunes  = 200
	maxQuoteRunes = 300
)

var keyRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

var (
	ErrMuted      = errors.New("the user dismissed this before")
	ErrNoProposal = errors.New("no such proposal")
)

// Note is one correction an agent noted. Target is "skill:<name>" or "memory:<cwd>"; Session is
// "<WAVETERM_BLOCKID or cli>:<local date>"; TS is unix milliseconds.
type Note struct {
	Key     string `json:"key"`
	Target  string `json:"target"`
	Text    string `json:"text"`
	Quote   string `json:"quote"`
	Session string `json:"session"`
	TS      int64  `json:"ts"`
}

type Quote struct {
	Quote   string
	Session string
	TS      int64
}

// Proposal is a key that qualified: one line to add to Target, with the user's words as evidence.
type Proposal struct {
	ID       string
	Target   string
	Key      string
	Text     string
	Quotes   []Quote
	Sessions int
	Since    int64
}

type KeyInfo struct {
	Key   string
	Text  string
	Notes int
}

// Store keeps notes.jsonl, muted.json and proposed.json in one directory. wavesrv is its only writer.
type Store struct {
	dir string
	mu  sync.Mutex
}

func Open(dir string) *Store {
	return &Store{dir: dir}
}

var (
	defaultOnce  sync.Once
	defaultStore *Store
)

// Default is the store in the wave data dir.
func Default() *Store {
	defaultOnce.Do(func() {
		defaultStore = Open(filepath.Join(wavebase.GetWaveDataDir(), "learn"))
	})
	return defaultStore
}

func ID(target, key string) string {
	return target + "#" + key
}

// normalize validates n and trims its text and quote; an unset TS becomes now.
func (n *Note) normalize() error {
	if len(n.Key) > maxKeyBytes || !keyRe.MatchString(n.Key) {
		return fmt.Errorf("key %q must be a kebab-case slug (a-z, 0-9, dashes) of at most %d bytes", n.Key, maxKeyBytes)
	}
	if !validTarget(n.Target) {
		return fmt.Errorf("target %q must be skill:<name> or memory:<cwd>", n.Target)
	}
	n.Text = strings.TrimSpace(n.Text)
	if c := utf8.RuneCountInString(n.Text); c == 0 || c > maxTextRunes {
		return fmt.Errorf("text must be 1-%d characters, got %d", maxTextRunes, c)
	}
	if strings.ContainsAny(n.Text, "\r\n") {
		return errors.New("text must be one line")
	}
	if n.Session == "" {
		return errors.New("session is empty")
	}
	n.Quote = truncateRunes(strings.TrimSpace(n.Quote), maxQuoteRunes)
	if n.TS == 0 {
		n.TS = time.Now().UnixMilli()
	}
	return nil
}

func validTarget(t string) bool {
	if name, ok := strings.CutPrefix(t, "skill:"); ok {
		// the name becomes a vault directory
		return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, `/\`)
	}
	cwd, ok := strings.CutPrefix(t, "memory:")
	return ok && cwd != ""
}

func truncateRunes(s string, limit int) string {
	if utf8.RuneCountInString(s) <= limit {
		return s
	}
	return string([]rune(s)[:limit])
}

// Add appends a note, then records its ID as proposed when it qualifies. It returns ErrMuted for a key the user
// dismissed.
func (s *Store) Add(n Note) error {
	if err := n.normalize(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := ID(n.Target, n.Key)
	muted, err := s.readList(mutedFile)
	if err != nil {
		return err
	}
	if slices.Contains(muted, id) {
		return ErrMuted
	}
	if err := s.appendNote(n); err != nil {
		return err
	}
	proposed, err := s.readList(proposedFile)
	if err != nil {
		return err
	}
	if slices.Contains(proposed, id) {
		return nil
	}
	notes, err := s.readNotes()
	if err != nil {
		return err
	}
	cutoff := n.TS - proposeWindow.Milliseconds()
	sessions := map[string]bool{}
	for _, x := range notes {
		if ID(x.Target, x.Key) == id && x.TS >= cutoff {
			sessions[x.Session] = true
		}
	}
	if len(sessions) < minSessions {
		return nil
	}
	return s.writeList(proposedFile, append(proposed, id))
}

// Pending lists the proposals waiting for the user, oldest first. A proposal does not expire: it is built from
// all its notes, however old.
func (s *Store) Pending() ([]Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	byID, err := s.proposals()
	if err != nil {
		return nil, err
	}
	out := make([]Proposal, 0, len(byID))
	for _, p := range byID {
		out = append(out, p)
	}
	slices.SortFunc(out, func(a, b Proposal) int {
		return cmp.Or(cmp.Compare(a.Since, b.Since), cmp.Compare(a.ID, b.ID))
	})
	return out, nil
}

// Peek returns the proposal for id, or ErrNoProposal.
func (s *Store) Peek(id string) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	byID, err := s.proposals()
	if err != nil {
		return Proposal{}, err
	}
	p, ok := byID[id]
	if !ok {
		return Proposal{}, ErrNoProposal
	}
	return p, nil
}

// Take returns the proposal for id and clears it and its notes, so the caller can write it to its target.
func (s *Store) Take(id string) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	byID, err := s.proposals()
	if err != nil {
		return Proposal{}, err
	}
	p, ok := byID[id]
	if !ok {
		return Proposal{}, ErrNoProposal
	}
	// unpropose before the notes go: a crash between leaves notes that qualify again, not a proposal without notes
	if err := s.unpropose(id); err != nil {
		return Proposal{}, err
	}
	if err := s.dropNotes(id); err != nil {
		return Proposal{}, err
	}
	return p, nil
}

// Mute is the user's dismissal: the key's notes go, and Add refuses the key from now on.
func (s *Store) Mute(id string) error {
	if strings.LastIndex(id, "#") <= 0 {
		return fmt.Errorf("bad proposal id %q", id)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	muted, err := s.readList(mutedFile)
	if err != nil {
		return err
	}
	if err := s.writeList(mutedFile, append(muted, id)); err != nil {
		return err
	}
	if err := s.unpropose(id); err != nil {
		return err
	}
	return s.dropNotes(id)
}

// Keys lists the keys that have notes for target, however old, so an agent can reuse one.
func (s *Store) Keys(target string) ([]KeyInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	notes, err := s.readNotes()
	if err != nil {
		return nil, err
	}
	byKey := map[string][]Note{}
	for _, n := range notes {
		if n.Target == target {
			byKey[n.Key] = append(byKey[n.Key], n)
		}
	}
	out := make([]KeyInfo, 0, len(byKey))
	for key, group := range byKey {
		sortByTS(group)
		out = append(out, KeyInfo{Key: key, Text: group[len(group)-1].Text, Notes: len(group)})
	}
	slices.SortFunc(out, func(a, b KeyInfo) int { return cmp.Compare(a.Key, b.Key) })
	return out, nil
}

// proposals builds every pending proposal by ID. The caller holds s.mu.
func (s *Store) proposals() (map[string]Proposal, error) {
	proposed, err := s.readList(proposedFile)
	if err != nil {
		return nil, err
	}
	muted, err := s.readList(mutedFile)
	if err != nil {
		return nil, err
	}
	notes, err := s.readNotes()
	if err != nil {
		return nil, err
	}
	byID := map[string][]Note{}
	for _, n := range notes {
		id := ID(n.Target, n.Key)
		byID[id] = append(byID[id], n)
	}
	out := map[string]Proposal{}
	for _, id := range proposed {
		group := byID[id]
		if len(group) == 0 || slices.Contains(muted, id) {
			continue
		}
		out[id] = buildProposal(id, group)
	}
	return out, nil
}

func buildProposal(id string, group []Note) Proposal {
	sortByTS(group)
	newest := group[len(group)-1]
	p := Proposal{ID: id, Target: newest.Target, Key: newest.Key, Text: newest.Text, Since: group[0].TS}
	sessions := map[string]bool{}
	for _, n := range group {
		sessions[n.Session] = true
		if n.Quote != "" {
			p.Quotes = append(p.Quotes, Quote{Quote: n.Quote, Session: n.Session, TS: n.TS})
		}
	}
	p.Sessions = len(sessions)
	return p
}

// sortByTS orders notes oldest first; notes with the same TS keep their file order.
func sortByTS(notes []Note) {
	slices.SortStableFunc(notes, func(a, b Note) int { return cmp.Compare(a.TS, b.TS) })
}

func (s *Store) appendNote(n Note) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return fmt.Errorf("learn: %w", err)
	}
	line, err := json.Marshal(n)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(s.dir, notesFile), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("learn: %w", err)
	}
	if _, err := f.Write(append(line, '\n')); err != nil {
		f.Close()
		return fmt.Errorf("learn: append note: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("learn: append note: %w", err)
	}
	return nil
}

// readNotes reads notes.jsonl, skipping and logging a line that does not decode. A missing file is no notes.
func (s *Store) readNotes() ([]Note, error) {
	path := filepath.Join(s.dir, notesFile)
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("learn: %w", err)
	}
	var notes []Note
	for i, line := range bytes.Split(data, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var n Note
		if err := json.Unmarshal(line, &n); err != nil {
			log.Printf("learn: skipping malformed line %d of %s: %v", i+1, path, err)
			continue
		}
		notes = append(notes, n)
	}
	return notes, nil
}

// dropNotes rewrites notes.jsonl without the notes of id.
func (s *Store) dropNotes(id string) error {
	notes, err := s.readNotes()
	if err != nil {
		return err
	}
	kept := slices.DeleteFunc(slices.Clone(notes), func(n Note) bool { return ID(n.Target, n.Key) == id })
	if len(kept) == len(notes) {
		return nil
	}
	var buf bytes.Buffer
	for _, n := range kept {
		line, err := json.Marshal(n)
		if err != nil {
			return err
		}
		buf.Write(line)
		buf.WriteByte('\n')
	}
	if err := fileutil.AtomicWriteFile(filepath.Join(s.dir, notesFile), buf.Bytes(), 0o644); err != nil {
		return fmt.Errorf("learn: rewrite notes: %w", err)
	}
	return nil
}

func (s *Store) unpropose(id string) error {
	proposed, err := s.readList(proposedFile)
	if err != nil {
		return err
	}
	if !slices.Contains(proposed, id) {
		return nil
	}
	return s.writeList(proposedFile, slices.DeleteFunc(proposed, func(x string) bool { return x == id }))
}

// readList reads a JSON string array; a missing file is an empty list.
func (s *Store) readList(name string) ([]string, error) {
	path := filepath.Join(s.dir, name)
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("learn: %w", err)
	}
	var list []string
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("learn: %s: %w", path, err)
	}
	return list, nil
}

// writeList writes list sorted and without duplicates.
func (s *Store) writeList(name string, list []string) error {
	list = slices.Compact(slices.Sorted(slices.Values(list)))
	if list == nil {
		list = []string{}
	}
	data, err := json.Marshal(list)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return fmt.Errorf("learn: %w", err)
	}
	if err := fileutil.AtomicWriteFile(filepath.Join(s.dir, name), data, 0o644); err != nil {
		return fmt.Errorf("learn: write %s: %w", name, err)
	}
	return nil
}

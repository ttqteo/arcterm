// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatsuggest

// Habits: the short messages the person sends again and again ("build đi", "pull về và build"), counted over their own
// Claude Code sessions of the last 30 days, so the model offers one word for word when it is the turn's next step.
//
// The count reads the transcripts under ~/.claude/projects (2 GB a month here) once, then only what each one gained
// since: an index of the hits per file, kept in the data dir, says how far each was read. Only a typed prompt of an
// interactive session counts (entrypoint cli): a `claude -p` a script ran, a /command, a `!` command, the tags Claude
// Code writes as user records and the lines Chat sends on the person's behalf ("brainstorm: check") do not.

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	// the days a message counts for
	habitWindow = 30 * 24 * time.Hour
	// how often a message is sent before it is a habit
	habitMinUses = 3
	// the habits the model is given, most used first
	HabitMax = 15
	// a habit is a short line: longer ones are one-off asks
	habitRunes = 40
	// the transcripts are read again at most this often
	habitRescan = 5 * time.Minute
	// a record past this is no typed prompt (a tool result, a pasted image): its line is skipped unread
	habitLineMax = 64 * 1024
)

// Habit is one message the person sends often: its usual spelling, the key its spellings share, and how often it was
// sent in the window.
type Habit struct {
	Text string `json:"text"`
	Key  string `json:"key"`
	Uses int    `json:"uses"`
}

// hit is one sending of a short message: its key, its spelling and when (UnixMilli).
type hit struct {
	K  string `json:"k"`
	T  string `json:"t"`
	At int64  `json:"at"`
}

// fileState is how far one transcript was read: its size and mtime then, the offset after its last whole line, and
// the hits in what was read.
type fileState struct {
	Size int64 `json:"size"`
	Mod  int64 `json:"mod"`
	Off  int64 `json:"off"`
	Hits []hit `json:"hits,omitempty"`
}

// vietnamese letters with their marks, folded to the bare letter: the person types "build di" as often as "build đi"
var foldMap = func() map[rune]rune {
	groups := map[rune]string{
		'a': "àáạảãâầấậẩẫăằắặẳẵ",
		'e': "èéẹẻẽêềếệểễ",
		'i': "ìíịỉĩ",
		'o': "òóọỏõôồốộổỗơờớợởỡ",
		'u': "ùúụủũưừứựửữ",
		'y': "ỳýỵỷỹ",
		'd': "đ",
	}
	m := map[rune]rune{}
	for bare, marked := range groups {
		for _, r := range marked {
			m[r] = bare
		}
	}
	return m
}()

// HabitKey folds a message to what counts as the same one: lowercase, the Vietnamese marks taken off, spaces folded,
// and the punctuation at its ends taken off.
func HabitKey(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if f, ok := foldMap[r]; ok {
			r = f
		}
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimFunc(strings.Join(strings.Fields(b.String()), " "), func(r rune) bool {
		return unicode.IsPunct(r) || unicode.IsSpace(r)
	})
}

// a line Chat sends for the person: an answer to a card ("brainstorm: check", "initiative: added …")
var protocolRe = regexp.MustCompile(`^[a-z][a-z-]*: `)

// habitText is a prompt as a habit counts it, or "" when it is none: one line, typed (not a /command, a `!` command, a
// tag Claude Code writes, a pasted placeholder or a line Chat sends), two runes or more (a lone "A" answers one
// question) and at most habitRunes.
func habitText(content string) string {
	s := strings.TrimSpace(content)
	if s == "" || strings.ContainsAny(s, "\n\r") || strings.ContainsAny(s[:1], "</![") || protocolRe.MatchString(s) {
		return ""
	}
	if n := utf8.RuneCountInString(s); n < 2 || n > habitRunes {
		return ""
	}
	return s
}

// promptRecord is the part of a transcript record a habit reads.
type promptRecord struct {
	Type        string          `json:"type"`
	Entrypoint  string          `json:"entrypoint"`
	IsMeta      bool            `json:"isMeta"`
	IsSidechain bool            `json:"isSidechain"`
	Timestamp   string          `json:"timestamp"`
	Message     json.RawMessage `json:"message"`
}

var userRecord = []byte(`"type":"user"`)

// hitOf is the habit hit of one transcript line, if it is one.
func hitOf(line []byte, fallback int64) (hit, bool) {
	if !bytes.Contains(line, userRecord) {
		return hit{}, false
	}
	var rec promptRecord
	if json.Unmarshal(line, &rec) != nil || rec.Type != "user" || rec.Entrypoint != "cli" || rec.IsMeta || rec.IsSidechain {
		return hit{}, false
	}
	var msg struct {
		Content json.RawMessage `json:"content"`
	}
	if json.Unmarshal(rec.Message, &msg) != nil {
		return hit{}, false
	}
	var content string
	if json.Unmarshal(msg.Content, &content) != nil {
		return hit{}, false
	}
	text := habitText(content)
	if text == "" {
		return hit{}, false
	}
	key := HabitKey(text)
	if key == "" {
		return hit{}, false
	}
	at := fallback
	if t, err := time.Parse(time.RFC3339Nano, rec.Timestamp); err == nil {
		at = t.UnixMilli()
	}
	return hit{K: key, T: text, At: at}, true
}

// scanHits reads r's whole lines from the start and returns their hits and the bytes those lines took: a last line with
// no newline yet (Claude Code still writing it) is left for the next read. A line past habitLineMax is skipped unread.
func scanHits(r io.Reader, fallback int64) ([]hit, int64, error) {
	br := bufio.NewReaderSize(r, habitLineMax)
	var hits []hit
	var off int64
	for {
		line, err := br.ReadSlice('\n')
		if errors.Is(err, bufio.ErrBufferFull) {
			// a long record: skip to its end
			n := int64(len(line))
			for errors.Is(err, bufio.ErrBufferFull) {
				line, err = br.ReadSlice('\n')
				n += int64(len(line))
			}
			if err != nil {
				return hits, off, ignoreEOF(err)
			}
			off += n
			continue
		}
		if err != nil {
			return hits, off, ignoreEOF(err)
		}
		off += int64(len(line))
		if h, ok := hitOf(line, fallback); ok {
			hits = append(hits, h)
		}
	}
}

func ignoreEOF(err error) error {
	if errors.Is(err, io.EOF) {
		return nil
	}
	return err
}

// countHabits is the habits in hits sent since `since`: each key's uses, the spelling it was sent with most (the
// latest on a tie), keys in `hidden` left out, most used first, then by spelling.
func countHabits(hits []hit, since int64, hidden map[string]bool) []Habit {
	type tally struct {
		uses     int
		spelling map[string]int
		last     map[string]int64
	}
	byKey := map[string]*tally{}
	for _, h := range hits {
		if h.At < since || hidden[h.K] {
			continue
		}
		t := byKey[h.K]
		if t == nil {
			t = &tally{spelling: map[string]int{}, last: map[string]int64{}}
			byKey[h.K] = t
		}
		t.uses++
		t.spelling[h.T]++
		if h.At > t.last[h.T] {
			t.last[h.T] = h.At
		}
	}
	out := []Habit{}
	for key, t := range byKey {
		if t.uses < habitMinUses {
			continue
		}
		best := ""
		for s, n := range t.spelling {
			if best == "" || n > t.spelling[best] || (n == t.spelling[best] && t.last[s] > t.last[best]) {
				best = s
			}
		}
		out = append(out, Habit{Text: best, Key: key, Uses: t.uses})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Uses != out[j].Uses {
			return out[i].Uses > out[j].Uses
		}
		return out[i].Text < out[j].Text
	})
	return out
}

// HabitIndex counts the habits over the transcripts under root, keeping how far it read each in indexPath and the keys
// the person took out in hiddenPath. An empty indexPath keeps the index in memory only.
type HabitIndex struct {
	root       string
	indexPath  string
	hiddenPath string
	now        func() time.Time

	mu      sync.Mutex
	files   map[string]*fileState
	hidden  map[string]bool
	loaded  bool
	scanned time.Time
}

// NewHabitIndex makes an index over the transcripts under root (~/.claude/projects).
func NewHabitIndex(root, indexPath, hiddenPath string, now func() time.Time) *HabitIndex {
	if now == nil {
		now = time.Now
	}
	return &HabitIndex{root: root, indexPath: indexPath, hiddenPath: hiddenPath, now: now}
}

// Habits is the person's habits, at most HabitMax, most used first, read again from the transcripts when the last
// read is older than habitRescan.
func (x *HabitIndex) Habits() []Habit {
	x.mu.Lock()
	defer x.mu.Unlock()
	x.loadLocked()
	now := x.now()
	if x.scanned.IsZero() || now.Sub(x.scanned) >= habitRescan {
		x.scanLocked(now)
	}
	var all []hit
	for _, f := range x.files {
		all = append(all, f.Hits...)
	}
	out := countHabits(all, now.Add(-habitWindow).UnixMilli(), x.hidden)
	if len(out) > HabitMax {
		out = out[:HabitMax]
	}
	return out
}

// Hide takes the habit `key` out for good: the model is not given it and Setup no longer lists it.
func (x *HabitIndex) Hide(key string) error {
	key = HabitKey(key)
	if key == "" {
		return errors.New("no habit to hide")
	}
	x.mu.Lock()
	defer x.mu.Unlock()
	x.loadLocked()
	x.hidden[key] = true
	if x.hiddenPath == "" {
		return nil
	}
	keys := make([]string, 0, len(x.hidden))
	for k := range x.hidden {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return writeJSON(x.hiddenPath, keys)
}

func (x *HabitIndex) loadLocked() {
	if x.loaded {
		return
	}
	x.loaded = true
	x.files = map[string]*fileState{}
	x.hidden = map[string]bool{}
	if x.indexPath != "" {
		if b, err := os.ReadFile(x.indexPath); err == nil {
			var files map[string]*fileState
			if json.Unmarshal(b, &files) == nil && files != nil {
				x.files = files
			}
		}
	}
	if x.hiddenPath != "" {
		if b, err := os.ReadFile(x.hiddenPath); err == nil {
			var keys []string
			if json.Unmarshal(b, &keys) == nil {
				for _, k := range keys {
					x.hidden[k] = true
				}
			}
		}
	}
}

// scanLocked reads what each transcript of the window gained since the last read (the whole of a new one, or of one
// that shrank), drops the files gone or past the window, and saves the index when anything changed.
func (x *HabitIndex) scanLocked(now time.Time) {
	x.scanned = now
	paths, _ := filepath.Glob(filepath.Join(x.root, "*", "*.jsonl"))
	since := now.Add(-habitWindow)
	seen := map[string]bool{}
	changed := false
	for _, p := range paths {
		st, err := os.Stat(p)
		if err != nil || st.ModTime().Before(since) {
			continue
		}
		seen[p] = true
		cur := x.files[p]
		size, mod := st.Size(), st.ModTime().UnixMilli()
		if cur != nil && cur.Size == size && cur.Mod == mod {
			continue
		}
		if cur == nil || size < cur.Off {
			cur = &fileState{}
		}
		hits, read, err := readFrom(p, cur.Off, mod)
		if err != nil {
			continue
		}
		cur.Hits = append(cur.Hits, hits...)
		cur.Off += read
		cur.Size, cur.Mod = size, mod
		x.files[p] = cur
		changed = true
	}
	cutoff := since.UnixMilli()
	for p, f := range x.files {
		if !seen[p] {
			delete(x.files, p)
			changed = true
			continue
		}
		kept := f.Hits[:0]
		for _, h := range f.Hits {
			if h.At >= cutoff {
				kept = append(kept, h)
			}
		}
		if len(kept) != len(f.Hits) {
			f.Hits = kept
			changed = true
		}
	}
	if changed && x.indexPath != "" {
		_ = writeJSON(x.indexPath, x.files)
	}
}

func readFrom(path string, off, fallback int64) ([]hit, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	if _, err := f.Seek(off, io.SeekStart); err != nil {
		return nil, 0, err
	}
	return scanHits(f, fallback)
}

// writeJSON writes v to path through a temp file and a rename, so a crash leaves the old file whole.
func writeJSON(path string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

package learn

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

var day0 = time.Date(2026, 10, 14, 10, 0, 0, 0, time.Local)

func note(key, session string, at time.Time) Note {
	return Note{Key: key, Target: "skill:notes", Text: "Write notes in Vietnamese", Quote: "viết tiếng Việt", Session: session, TS: at.UnixMilli()}
}

func TestOneSessionMakesNoProposal(t *testing.T) {
	s := Open(t.TempDir())
	for i := 0; i < 3; i++ {
		if err := s.Add(note("notes-vi", "b1:2026-10-14", day0)); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.Pending()
	if err != nil || len(got) != 0 {
		t.Fatalf("want no proposal, got %v %v", got, err)
	}
}

func TestTwoSessionsMakeAProposal(t *testing.T) {
	s := Open(t.TempDir())
	_ = s.Add(note("notes-vi", "b1:2026-10-13", day0.Add(-24*time.Hour)))
	n := note("notes-vi", "b2:2026-10-14", day0)
	n.Text = "Always write notes in Vietnamese"
	_ = s.Add(n)
	got, _ := s.Pending()
	if len(got) != 1 {
		t.Fatalf("want 1 proposal, got %v", got)
	}
	p := got[0]
	if p.ID != "skill:notes#notes-vi" || p.Sessions != 2 || p.Text != "Always write notes in Vietnamese" || len(p.Quotes) != 2 {
		t.Fatalf("unexpected proposal %+v", p)
	}
	if p.Since != day0.Add(-24*time.Hour).UnixMilli() {
		t.Fatalf("Since should be the oldest counted note, got %d", p.Since)
	}
}

func TestNotesOlderThan30DaysDoNotCount(t *testing.T) {
	s := Open(t.TempDir())
	_ = s.Add(note("notes-vi", "b1:2026-09-01", day0.Add(-31*24*time.Hour)))
	_ = s.Add(note("notes-vi", "b2:2026-10-14", day0))
	if got, _ := s.Pending(); len(got) != 0 {
		t.Fatalf("want none, got %v", got)
	}
}

func TestProposalDoesNotExpire(t *testing.T) {
	s := Open(t.TempDir())
	_ = s.Add(note("notes-vi", "b1:2026-08-14", day0.Add(-61*24*time.Hour)))
	_ = s.Add(note("notes-vi", "b2:2026-08-15", day0.Add(-60*24*time.Hour)))
	if got, _ := s.Pending(); len(got) != 1 {
		t.Fatalf("a proposal must wait however old its notes are, got %v", got)
	}
	if _, err := s.Peek("skill:notes#notes-vi"); err != nil {
		t.Fatalf("peek an old proposal: %v", err)
	}
}

func TestMuteDropsNotesAndRefusesNewOnes(t *testing.T) {
	s := Open(t.TempDir())
	_ = s.Add(note("notes-vi", "b1:2026-10-13", day0))
	_ = s.Add(note("notes-vi", "b2:2026-10-14", day0))
	if err := s.Mute("skill:notes#notes-vi"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Pending(); len(got) != 0 {
		t.Fatalf("muted id still proposed: %v", got)
	}
	if err := s.Add(note("notes-vi", "b3:2026-10-15", day0)); !errors.Is(err, ErrMuted) {
		t.Fatalf("want ErrMuted, got %v", err)
	}
}

func TestTakeReturnsTheProposalAndClearsItsNotes(t *testing.T) {
	s := Open(t.TempDir())
	_ = s.Add(note("notes-vi", "b1:2026-10-13", day0))
	_ = s.Add(note("notes-vi", "b2:2026-10-14", day0))
	_ = s.Add(note("other-key", "b2:2026-10-14", day0))
	p, err := s.Take("skill:notes#notes-vi")
	if err != nil || p.Sessions != 2 {
		t.Fatalf("take: %+v %v", p, err)
	}
	keys, _ := s.Keys("skill:notes")
	if len(keys) != 1 || keys[0].Key != "other-key" {
		t.Fatalf("other notes must survive, got %v", keys)
	}
	if _, err := s.Take("skill:notes#notes-vi"); !errors.Is(err, ErrNoProposal) {
		t.Fatalf("second take: want ErrNoProposal, got %v", err)
	}
}

func TestAddValidates(t *testing.T) {
	s := Open(t.TempDir())
	bad := []Note{
		{Key: "Bad Key", Target: "skill:notes", Text: "x", Session: "s"},
		{Key: "ok", Target: "nowhere:x", Text: "x", Session: "s"},
		{Key: "ok", Target: "skill:notes", Text: "", Session: "s"},
		{Key: "ok", Target: "skill:notes", Text: "two\nlines", Session: "s"},
	}
	for _, n := range bad {
		if err := s.Add(n); err == nil {
			t.Fatalf("want an error for %+v", n)
		}
	}
}

func TestSkillTargetMustBeADirectoryName(t *testing.T) {
	s := Open(t.TempDir())
	for _, target := range []string{"skill:", "skill:..", "skill:a/b", `skill:a\b`, "memory:"} {
		n := note("ok", "s", day0)
		n.Target = target
		if err := s.Add(n); err == nil {
			t.Fatalf("want an error for target %q", target)
		}
	}
	n := note("ok", "s", day0)
	n.Target = `memory:C:\work\a#b`
	if err := s.Add(n); err != nil {
		t.Fatalf("a cwd may hold a hash: %v", err)
	}
}

func TestAddDefaultsTSAndCapsTheQuote(t *testing.T) {
	s := Open(t.TempDir())
	n := note("notes-vi", "b1:2026-10-14", day0)
	n.TS = 0
	n.Quote = strings.Repeat("ệ", 400)
	before := time.Now().UnixMilli()
	if err := s.Add(n); err != nil {
		t.Fatal(err)
	}
	notes, _ := s.readNotes()
	if len(notes) != 1 || notes[0].TS < before || utf8.RuneCountInString(notes[0].Quote) != 300 {
		t.Fatalf("unexpected note %+v", notes)
	}
}

func TestKeysListsEveryKeyWithItsNewestText(t *testing.T) {
	s := Open(t.TempDir())
	old := note("b-key", "s1", day0.Add(-90*24*time.Hour))
	old.Text = "old text"
	_ = s.Add(old)
	fresh := note("b-key", "s2", day0)
	fresh.Text = "new text"
	_ = s.Add(fresh)
	_ = s.Add(note("a-key", "s1", day0))
	other := note("c-key", "s1", day0)
	other.Target = "memory:/work"
	_ = s.Add(other)
	keys, err := s.Keys("skill:notes")
	if err != nil || len(keys) != 2 {
		t.Fatalf("want 2 keys, got %v %v", keys, err)
	}
	if keys[0].Key != "a-key" || keys[1] != (KeyInfo{Key: "b-key", Text: "new text", Notes: 2}) {
		t.Fatalf("unexpected keys %v", keys)
	}
}

func TestMalformedLineIsSkipped(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	_ = s.Add(note("notes-vi", "b1:2026-10-13", day0))
	appendRaw(t, dir, "{not json\n")
	_ = s.Add(note("notes-vi", "b2:2026-10-14", day0))
	if got, err := s.Pending(); err != nil || len(got) != 1 {
		t.Fatalf("want 1 proposal despite a bad line, got %v %v", got, err)
	}
}

func appendRaw(t *testing.T, dir, s string) {
	t.Helper()
	f, err := os.OpenFile(filepath.Join(dir, "notes.jsonl"), os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(s); err != nil {
		t.Fatal(err)
	}
}

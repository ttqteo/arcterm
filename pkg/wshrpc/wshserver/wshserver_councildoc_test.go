// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// waitFile waits until path holds want, or fails after a second.
func waitFile(t *testing.T, path, want string) string {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		b, _ := os.ReadFile(path)
		if strings.Contains(string(b), want) || time.Now().After(deadline) {
			return string(b)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// A save that changes what a council settled rewrites its project's block once the burst is over; a save that changes
// nothing settled, or a council with nothing settled, writes nothing; a deleted council leaves the block.
func TestCouncilDocSyncFollowsTheMemory(t *testing.T) {
	useCouncilStore(t)
	project := t.TempDir()
	claude := filepath.Join(project, "CLAUDE.md")
	if err := os.WriteFile(claude, []byte("# Rules\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &councilDocSync{seen: map[string]string{}, timers: map[string]*time.Timer{}, delay: 10 * time.Millisecond}
	t.Cleanup(func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		for _, tm := range s.timers {
			tm.Stop()
		}
	})

	c := &council.Council{Id: "c1", Project: project, Feature: "Settle the problem", Created: 1_793_800_000_000}
	saveCouncil(t, c)
	s.note(c)
	time.Sleep(30 * time.Millisecond)
	if b, _ := os.ReadFile(claude); string(b) != "# Rules\n" {
		t.Fatalf("a council with nothing settled wrote the file:\n%s", b)
	}

	c.Memory = &council.CouncilMemory{Entries: []council.CouncilMemoryEntry{{Id: "m1", Kind: council.EntryAgreed, Text: "It is a benchmark."}}}
	saveCouncil(t, c)
	s.note(c)
	got := waitFile(t, claude, "- Agreed: It is a benchmark.")
	if !strings.HasPrefix(got, "# Rules\n\n<!-- arc:council-decisions:begin") || !strings.Contains(got, "Settle the problem") {
		t.Fatalf("CLAUDE.md after the memory changed:\n%s", got)
	}

	// a save with the same memory schedules nothing: a hand edit of the block stays until the memory moves
	hand := strings.Replace(got, "It is a benchmark.", "HAND EDIT", 1)
	if err := os.WriteFile(claude, []byte(hand), 0o644); err != nil {
		t.Fatal(err)
	}
	c.Rating = "useful"
	s.note(c)
	time.Sleep(30 * time.Millisecond)
	if b, _ := os.ReadFile(claude); string(b) != hand {
		t.Errorf("a save that changed nothing settled rewrote the file")
	}

	// deleted: the block goes, the file's own text stays
	if err := os.Remove(filepath.Join(council.Dir(), "c1.json")); err != nil {
		t.Fatal(err)
	}
	s.forget(c)
	deadline := time.Now().Add(time.Second)
	for {
		b, _ := os.ReadFile(claude)
		if string(b) == "# Rules\n" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("after the delete:\n%s", b)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// At startup every project with something settled gets its block, and a project with nothing settled is not touched.
func TestCouncilDocSyncAll(t *testing.T) {
	useCouncilStore(t)
	settled, bare := t.TempDir(), t.TempDir()
	saveCouncil(t, &council.Council{Id: "c1", Project: settled, Feature: "Settled one", Created: 1,
		Memory: &council.CouncilMemory{Chosen: &council.CouncilMemoryDirection{Text: "Do the small thing first"}}})
	saveCouncil(t, &council.Council{Id: "c2", Project: bare, Feature: "Nothing yet", Created: 2})
	s := &councilDocSync{seen: map[string]string{}, timers: map[string]*time.Timer{}, delay: time.Hour}
	s.syncAll()
	b, err := os.ReadFile(filepath.Join(settled, "CLAUDE.md"))
	if err != nil || !strings.Contains(string(b), "- Direction: Do the small thing first") {
		t.Errorf("the settled project's CLAUDE.md = %q, %v", b, err)
	}
	if _, err := os.Stat(filepath.Join(bare, "CLAUDE.md")); err == nil {
		t.Error("a project with nothing settled got a CLAUDE.md")
	}
	if len(s.seen) != 2 {
		t.Errorf("seen %d councils, want both seeded", len(s.seen))
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// storeSetup points the data dir at a temp dir and counts published update events.
func storeSetup(t *testing.T) *int {
	t.Helper()
	oldDir, oldPublish := wavebase.DataHome_VarCache, publishUpdate
	wavebase.DataHome_VarCache = t.TempDir()
	var mu sync.Mutex
	published := 0
	publishUpdate = func() {
		mu.Lock()
		published++
		mu.Unlock()
	}
	t.Cleanup(func() { wavebase.DataHome_VarCache, publishUpdate = oldDir, oldPublish })
	return &published
}

func TestFileNameSafeAndDistinct(t *testing.T) {
	if got, want := FileName("SIEM/a b:c"), "SIEM_a_b_c-5e870e11.json"; got != want {
		t.Fatalf("FileName(SIEM/a b:c) = %q, want %q", got, want)
	}
	seen := map[string]string{}
	for _, name := range []string{"a/b", "a:b", "a b", "a*b", `a\b`, "a?b", `a"b`, "a<b>|", "a_b"} {
		got := FileName(name)
		if got != FileName(name) {
			t.Errorf("FileName(%q) is not stable", name)
		}
		if strings.ContainsAny(strings.TrimSuffix(got, ".json"), `\/:*?"<>| `) {
			t.Errorf("FileName(%q) = %q holds an unsafe char", name, got)
		}
		if other, ok := seen[got]; ok {
			t.Errorf("FileName(%q) and FileName(%q) collide on %q", name, other, got)
		}
		seen[got] = name
	}
	long := FileName(strings.Repeat("x", 200))
	if len(long) != 60+len("-12345678.json") {
		t.Errorf("long name not cut to 60 chars: %q", long)
	}
}

func TestLoadMissingIsZero(t *testing.T) {
	storeSetup(t)
	st, err := Load("never/checked")
	if err != nil {
		t.Fatal(err)
	}
	if st.Project != "never/checked" || st.CheckedAt != 0 || len(st.Changes) != 0 || st.Seen != nil {
		t.Fatalf("missing state is not zero: %+v", st)
	}
}

func TestLoadCorruptIsError(t *testing.T) {
	storeSetup(t)
	writeFile(t, statePath("p"), "{not json")
	if _, err := Load("p"); err == nil || !strings.Contains(err.Error(), "p") {
		t.Fatalf("Load of a corrupt file: err = %v, want an error naming the project", err)
	}
}

func TestUpdateMergesConcurrentWriters(t *testing.T) {
	storeSetup(t)
	const n = 40
	var wg sync.WaitGroup
	bump := func(field func(*State)) {
		defer wg.Done()
		for range n {
			if _, err := Update("p", func(st *State) error { field(st); return nil }); err != nil {
				t.Error(err)
				return
			}
		}
	}
	// a reader alongside, as the tab lists while a check writes
	read := func() {
		defer wg.Done()
		for range n {
			if _, err := List(map[string]string{"p": "/p"}); err != nil {
				t.Error(err)
				return
			}
		}
	}
	wg.Add(3)
	go bump(func(st *State) { st.Memories++ })
	go bump(func(st *State) { st.Sessions++ })
	go read()
	wg.Wait()
	st, err := Load("p")
	if err != nil {
		t.Fatal(err)
	}
	if st.Memories != n || st.Sessions != n {
		t.Fatalf("lost writes: memories %d sessions %d, want %d each", st.Memories, st.Sessions, n)
	}
}

func TestUpdatePublishesEvent(t *testing.T) {
	published := storeSetup(t)
	if _, err := Update("p", func(st *State) error { st.CheckedAt = 7; return nil }); err != nil {
		t.Fatal(err)
	}
	if *published != 1 {
		t.Fatalf("published %d events after a write, want 1", *published)
	}
	failed := errors.New("nope")
	if _, err := Update("p", func(st *State) error { st.CheckedAt = 9; return failed }); !errors.Is(err, failed) {
		t.Fatalf("Update err = %v, want fn's error", err)
	}
	if *published != 1 {
		t.Fatalf("a failed update published an event")
	}
	st, err := Load("p")
	if err != nil {
		t.Fatal(err)
	}
	if st.CheckedAt != 7 {
		t.Fatalf("a failed update wrote: checkedat %d", st.CheckedAt)
	}
}

func TestUpdateRoundTripsState(t *testing.T) {
	storeSetup(t)
	_, err := Update("p", func(st *State) error {
		st.OwnIndex = &wshrpc.MemIndexStats{Exists: true, Lines: 3, Bytes: 40}
		st.Changes = []wshrpc.MemChange{{Id: "c1", Kind: "trim", Op: wshrpc.MemOp{Old: "a", New: "b"}}}
		st.Seen = map[string]string{"m.md": "h"}
		st.Sort = map[string]SortEntry{"m.md": {Sha256: "h", Projects: []string{"p", "other"}}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	st, err := Load("p")
	if err != nil {
		t.Fatal(err)
	}
	if st.OwnIndex == nil || st.OwnIndex.Lines != 3 || len(st.Changes) != 1 || st.Changes[0].Op.New != "b" ||
		st.Seen["m.md"] != "h" || len(st.Sort["m.md"].Projects) != 2 {
		t.Fatalf("state did not round-trip: %+v", st)
	}
}

func TestListIncludesUncheckedProjects(t *testing.T) {
	storeSetup(t)
	if _, err := Update("b", func(st *State) error { st.CheckedAt = 5; st.Path = "stale"; return nil }); err != nil {
		t.Fatal(err)
	}
	got, err := List(map[string]string{"b": `C:\b`, "a": `C:\a`})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Project != "a" || got[1].Project != "b" {
		t.Fatalf("List = %+v, want a then b", got)
	}
	if got[0].Path != `C:\a` || got[0].CheckedAt != 0 || got[0].Changes == nil {
		t.Errorf("unchecked project: %+v", got[0])
	}
	if got[1].Path != `C:\b` || got[1].CheckedAt != 5 {
		t.Errorf("checked project: %+v", got[1])
	}
	entries, err := os.ReadDir(StateDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("List wrote state files: %d in the state dir", len(entries))
	}
}

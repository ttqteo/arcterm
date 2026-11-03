// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type watched struct {
	id, project string
	deleted     bool
}

// startWatch watches a fresh folder under the test's temp dir (one that does not exist yet, which Watch creates) and
// returns it with the channel its publishes arrive on.
func startWatch(t *testing.T) (string, <-chan watched) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), CouncilsDir)
	got := make(chan watched, 16)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if err := Watch(ctx, dir, func(id, project string, deleted bool) { got <- watched{id, project, deleted} }); err != nil {
		t.Fatalf("Watch: %v", err)
	}
	return dir, got
}

func councilJSON(t *testing.T, id, project, feature string) []byte {
	t.Helper()
	b, err := json.MarshalIndent(&Council{Id: id, Project: project, Feature: feature}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func writeTestFile(t *testing.T, path string, b []byte) {
	t.Helper()
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
}

// expectPublish waits for the next publish and checks it is want.
func expectPublish(t *testing.T, got <-chan watched, want watched) {
	t.Helper()
	select {
	case w := <-got:
		if w != want {
			t.Errorf("published %+v, want %+v", w, want)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("nothing published, want %+v", want)
	}
}

// expectQuiet checks nothing more is published for a few quiet periods.
func expectQuiet(t *testing.T, got <-chan watched) {
	t.Helper()
	select {
	case w := <-got:
		t.Errorf("published %+v, want nothing more", w)
	case <-time.After(4 * watchDebounce):
	}
}

func TestWatchPublishesACopiedCouncilOnce(t *testing.T) {
	dir, got := startWatch(t)
	project := filepath.Join(t.TempDir(), "proj")
	writeTestFile(t, filepath.Join(dir, "abc123.json"), councilJSON(t, "abc123", project, "Dark mode"))

	expectPublish(t, got, watched{"abc123", project, false})
	expectQuiet(t, got)
}

func TestWatchPublishesThreeQuickWritesOnce(t *testing.T) {
	dir, got := startWatch(t)
	path := filepath.Join(dir, "burst1.json")
	for _, feature := range []string{"one", "two", "three"} {
		writeTestFile(t, path, councilJSON(t, "burst1", "/p", feature))
		time.Sleep(watchDebounce / 6)
	}

	expectPublish(t, got, watched{"burst1", "/p", false})
	expectQuiet(t, got)
}

func TestWatchPublishesARemovedCouncilAsDeleted(t *testing.T) {
	dir, got := startWatch(t)
	path := filepath.Join(dir, "gone1.json")
	writeTestFile(t, path, councilJSON(t, "gone1", "/p", "Gone"))
	expectPublish(t, got, watched{"gone1", "/p", false})

	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	expectPublish(t, got, watched{"gone1", "", true})
	expectQuiet(t, got)
}

func TestWatchIgnoresFilesThatAreNotCouncils(t *testing.T) {
	dir, got := startWatch(t)
	writeTestFile(t, filepath.Join(dir, "notes.txt"), []byte("hello"))
	writeTestFile(t, filepath.Join(dir, "abc123.json.tmp"), councilJSON(t, "abc123", "/p", "Temp"))
	writeTestFile(t, filepath.Join(dir, "not an id.json"), councilJSON(t, "x", "/p", "Bad name"))
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}

	expectQuiet(t, got)
}

// TestWatchWaitsForAHalfWrittenFile: a file that does not parse yet is not published; the write that completes it is.
func TestWatchWaitsForAHalfWrittenFile(t *testing.T) {
	dir, got := startWatch(t)
	path := filepath.Join(dir, "half1.json")
	full := councilJSON(t, "half1", "/p", "Half")
	writeTestFile(t, path, full[:len(full)/2])
	expectQuiet(t, got)

	writeTestFile(t, path, full)
	expectPublish(t, got, watched{"half1", "/p", false})
	expectQuiet(t, got)
}

// TestWatchStopsWithItsContext: once the context is done a change publishes nothing.
func TestWatchStopsWithItsContext(t *testing.T) {
	dir := filepath.Join(t.TempDir(), CouncilsDir)
	got := make(chan watched, 16)
	ctx, cancel := context.WithCancel(context.Background())
	if err := Watch(ctx, dir, func(id, project string, deleted bool) { got <- watched{id, project, deleted} }); err != nil {
		t.Fatalf("Watch: %v", err)
	}
	cancel()
	time.Sleep(50 * time.Millisecond)
	writeTestFile(t, filepath.Join(dir, "late1.json"), councilJSON(t, "late1", "/p", "Late"))

	expectQuiet(t, got)
}

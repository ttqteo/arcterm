// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// newTestStore is a Store on a temp dir, with the event counted instead of published.
func newTestStore(t *testing.T) (*Store, *int) {
	t.Helper()
	events := 0
	prev := publishChanged
	publishChanged = func() { events++ }
	t.Cleanup(func() { publishChanged = prev })
	now := time.Date(2026, 11, 26, 9, 0, 0, 0, time.UTC)
	return &Store{Root: filepath.Join(t.TempDir(), "sessionideas"), Now: func() time.Time { return now }}, &events
}

func TestStoreLoadMissingIsEmpty(t *testing.T) {
	s, events := newTestStore(t)
	d, err := s.Load()
	if err != nil {
		t.Fatalf("Load of a missing file: %v", err)
	}
	if d.Ideas == nil || d.Marks == nil || d.Sessions == nil {
		t.Fatalf("lists must be [] on the wire, never null: %+v", d)
	}
	if len(d.Ideas)+len(d.Marks)+len(d.Sessions) != 0 || d.FirstScanDone || d.Scan != nil {
		t.Fatalf("a missing file reads as empty, got %+v", d)
	}
	if *events != 0 {
		t.Fatalf("a load publishes nothing, got %d events", *events)
	}
	if _, err := os.Stat(s.Root); !os.IsNotExist(err) {
		t.Fatalf("a load must not create the folder: %v", err)
	}
}

func TestStoreNoRootReadsEmptyAndRefusesToWrite(t *testing.T) {
	s, events := newTestStore(t)
	s.Root = ""
	d, err := s.Load()
	if err != nil || len(d.Ideas) != 0 {
		t.Fatalf("no root reads as empty: %+v, %v", d, err)
	}
	if err := s.Update(func(d *wshrpc.SessionIdeasData) error { d.SeenTs = 1; return nil }); err == nil {
		t.Fatal("Update with no data dir must refuse, not write into the working directory")
	}
	if *events != 0 {
		t.Fatalf("a refused update publishes nothing, got %d", *events)
	}
}

func TestStoreUpdateRoundTrips(t *testing.T) {
	s, _ := newTestStore(t)
	idea := wshrpc.SessionIdea{
		ID: "a1", Gist: "a tree view for sessions", Project: "arcterm", EffortOID: "e1",
		Quotes:    []wshrpc.SessionIdeaQuote{{Who: "you", Text: "sao không làm cây?"}, {Who: "agent", Text: "could be a tree"}},
		SessionID: "s1", SaidTs: 100, DeletesTs: 900, FoundTs: 200, State: wshrpc.SessionIdeaState_Review,
	}
	mark := wshrpc.SessionIdeaMark{
		TranscriptPath: "/x/s1.jsonl", SessionID: "s1", Size: 10, MtimeMs: 20, ScannedTs: 30, LastTurnTs: 40, Ideas: 1,
		Outcome: wshrpc.SessionIdeaOutcome_Ideas,
	}
	err := s.Update(func(d *wshrpc.SessionIdeasData) error {
		d.Ideas = append(d.Ideas, idea)
		d.Marks = append(d.Marks, mark)
		d.LastScanTs, d.NextScanTs, d.SeenTs, d.SnoozedUntil, d.FirstScanDone = 1, 2, 3, 4, true
		d.Scan = &wshrpc.SessionIdeasScan{Done: 1, Total: 2, Tokens: 1000}
		return nil
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !reflect.DeepEqual(got.Ideas, []wshrpc.SessionIdea{idea}) || !reflect.DeepEqual(got.Marks, []wshrpc.SessionIdeaMark{mark}) {
		t.Fatalf("ideas and marks did not round-trip: %+v", got)
	}
	if got.LastScanTs != 1 || got.NextScanTs != 2 || got.SeenTs != 3 || got.SnoozedUntil != 4 || !got.FirstScanDone {
		t.Fatalf("times and flags did not round-trip: %+v", got)
	}
	if got.Scan == nil || got.Scan.Done != 1 || got.Scan.Total != 2 || got.Scan.Tokens != 1000 {
		t.Fatalf("scan did not round-trip: %+v", got.Scan)
	}
	// a second update sees the first
	if err := s.Update(func(d *wshrpc.SessionIdeasData) error { d.Ideas[0].State = wshrpc.SessionIdeaState_Dropped; return nil }); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Load()
	if len(got.Ideas) != 1 || got.Ideas[0].State != wshrpc.SessionIdeaState_Dropped {
		t.Fatalf("second update lost the first: %+v", got.Ideas)
	}
}

func TestStoreKeepsNoSessionsOrCounts(t *testing.T) {
	s, _ := newTestStore(t)
	err := s.Update(func(d *wshrpc.SessionIdeasData) error {
		d.Sessions = []wshrpc.SessionIdeasSession{{SessionID: "s1", Outcome: wshrpc.SessionIdeasSession_NotScanned}}
		d.Scanned, d.NotYet, d.LeavingSoon = 5, 6, 7
		d.SeenTs = 9
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := s.Load()
	if len(got.Sessions) != 0 || got.Scanned != 0 || got.NotYet != 0 || got.LeavingSoon != 0 {
		t.Fatalf("the session list and the counts are computed by the reader, never stored: %+v", got)
	}
	if got.SeenTs != 9 {
		t.Fatalf("the rest of the change must be kept: %+v", got)
	}
}

func TestStoreUpdateLeavesNoTempFile(t *testing.T) {
	s, _ := newTestStore(t)
	for range 3 {
		if err := s.Update(func(d *wshrpc.SessionIdeasData) error { d.SeenTs++; return nil }); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := os.ReadDir(s.Root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "state.json" {
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("the folder must hold state.json and nothing else, got %v", names)
	}
}

func TestStoreEventFiresOncePerUpdate(t *testing.T) {
	s, events := newTestStore(t)
	for i := 1; i <= 3; i++ {
		if err := s.Update(func(d *wshrpc.SessionIdeasData) error { d.SeenTs = int64(i); return nil }); err != nil {
			t.Fatal(err)
		}
		if *events != i {
			t.Fatalf("after update %d the event fired %d times, want %d", i, *events, i)
		}
	}
	// a failed change writes nothing and publishes nothing
	boom := errors.New("boom")
	if err := s.Update(func(d *wshrpc.SessionIdeasData) error { d.SeenTs = 99; return boom }); !errors.Is(err, boom) {
		t.Fatalf("Update must return fn's error, got %v", err)
	}
	if *events != 3 {
		t.Fatalf("a failed update must not publish, got %d events", *events)
	}
	if got, _ := s.Load(); got.SeenTs != 3 {
		t.Fatalf("a failed update must not write, SeenTs = %d", got.SeenTs)
	}
}

func TestStoreCorruptFileIsAnErrorNotEmpty(t *testing.T) {
	s, events := newTestStore(t)
	if err := os.MkdirAll(s.Root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Root, "state.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Load(); err == nil {
		t.Fatal("a state.json that does not parse must be an error: an update from empty would overwrite it")
	}
	if err := s.Update(func(d *wshrpc.SessionIdeasData) error { d.SeenTs = 1; return nil }); err == nil {
		t.Fatal("Update over a corrupt state.json must refuse")
	}
	if *events != 0 {
		t.Fatalf("a refused update publishes nothing, got %d", *events)
	}
	raw, _ := os.ReadFile(filepath.Join(s.Root, "state.json"))
	if string(raw) != "{not json" {
		t.Fatalf("the corrupt file must be left as it was, got %q", raw)
	}
}

func TestStoreClock(t *testing.T) {
	s, _ := newTestStore(t)
	if got := s.Clock(); !got.Equal(time.Date(2026, 11, 26, 9, 0, 0, 0, time.UTC)) {
		t.Fatalf("Clock must use Now, got %v", got)
	}
	s.Now = nil
	if d := time.Since(s.Clock()); d < 0 || d > time.Minute {
		t.Fatalf("Clock with no Now is the real time, off by %v", d)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/sessionideas"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// emptySessionIdeas starts a test from an empty store and fixture mode off, and leaves both so after it: the store is the
// package's one temp data dir, shared by every test.
func emptySessionIdeas(t *testing.T) *sessionideas.Store {
	t.Helper()
	reset := func() {
		setSessionIdeasFixture(nil)
		if err := sessionideas.Default().Update(func(d *wshrpc.SessionIdeasData) error {
			*d = wshrpc.SessionIdeasData{}
			return nil
		}); err != nil {
			t.Fatalf("clearing the session ideas store: %v", err)
		}
	}
	reset()
	t.Cleanup(reset)
	return sessionideas.Default()
}

func devMode(t *testing.T, on bool) {
	t.Helper()
	prev := wavebase.Dev_VarCache
	wavebase.Dev_VarCache = ""
	if on {
		wavebase.Dev_VarCache = "1"
	}
	t.Cleanup(func() { wavebase.Dev_VarCache = prev })
}

func seedIdeas(t *testing.T, store *sessionideas.Store, ideas ...wshrpc.SessionIdea) {
	t.Helper()
	if err := store.Update(func(d *wshrpc.SessionIdeasData) error {
		d.Ideas = append(d.Ideas, ideas...)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func ideaByID(t *testing.T, store *sessionideas.Store, id string) wshrpc.SessionIdea {
	t.Helper()
	d, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range d.Ideas {
		if i.ID == id {
			return i
		}
	}
	t.Fatalf("no idea %s in the store", id)
	return wshrpc.SessionIdea{}
}

func TestSessionIdeasDrop(t *testing.T) {
	store := emptySessionIdeas(t)
	seedIdeas(t, store,
		wshrpc.SessionIdea{ID: "a", Gist: "first", State: wshrpc.SessionIdeaState_Review},
		wshrpc.SessionIdea{ID: "b", Gist: "second", State: wshrpc.SessionIdeaState_Review},
		wshrpc.SessionIdea{ID: "kept", Gist: "third", State: wshrpc.SessionIdeaState_Kept, KeptAs: "effort:e1"},
	)
	ws := &WshServer{}
	before := time.Now().UnixMilli()
	if err := ws.SessionIdeasResolveCommand(context.Background(), wshrpc.CommandSessionIdeasResolveData{ID: "a", Op: "drop"}); err != nil {
		t.Fatalf("drop: %v", err)
	}
	a := ideaByID(t, store, "a")
	if a.State != wshrpc.SessionIdeaState_Dropped || a.ResolvedTs < before || a.ResolvedTs > time.Now().UnixMilli() {
		t.Fatalf("a dropped idea is dropped and stamped now, got %+v", a)
	}
	if b := ideaByID(t, store, "b"); b.State != wshrpc.SessionIdeaState_Review || b.ResolvedTs != 0 {
		t.Fatalf("dropping one idea must leave the others, got %+v", b)
	}
	// the idea stays in the store, so the scan has its gist to not propose again
	if a.Gist != "first" {
		t.Fatalf("a dropped idea keeps its gist, got %q", a.Gist)
	}

	for _, c := range []struct{ name, id, want string }{
		{"already dropped", "a", "already dropped"},
		{"already kept", "kept", "already kept"},
		{"unknown", "nope", "no idea"},
	} {
		err := ws.SessionIdeasResolveCommand(context.Background(), wshrpc.CommandSessionIdeasResolveData{ID: c.id, Op: "drop"})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("drop of an idea that is %s: error %v, want one saying %q", c.name, err, c.want)
		}
	}
	if kept := ideaByID(t, store, "kept"); kept.State != wshrpc.SessionIdeaState_Kept || kept.KeptAs != "effort:e1" {
		t.Fatalf("a refused drop must leave a kept idea as it was, got %+v", kept)
	}
}

func TestSessionIdeasResolveRefusesWhatItDoesNotKnow(t *testing.T) {
	store := emptySessionIdeas(t)
	seedIdeas(t, store, wshrpc.SessionIdea{ID: "a", State: wshrpc.SessionIdeaState_Review})
	ws := &WshServer{}
	if err := ws.SessionIdeasResolveCommand(context.Background(), wshrpc.CommandSessionIdeasResolveData{ID: "a", Op: "later"}); err == nil {
		t.Fatal("an op that is neither keep nor drop must be an error")
	}
	if a := ideaByID(t, store, "a"); a.State != wshrpc.SessionIdeaState_Review {
		t.Fatalf("a refused op must leave the idea alone, got %+v", a)
	}
}

func TestSessionIdeasMarkSeen(t *testing.T) {
	store := emptySessionIdeas(t)
	ws := &WshServer{}
	before := time.Now().UnixMilli()
	if err := ws.SessionIdeasMarkCommand(context.Background(), wshrpc.CommandSessionIdeasMarkData{Op: "seen"}); err != nil {
		t.Fatal(err)
	}
	d, _ := store.Load()
	if d.SeenTs < before || d.SeenTs > time.Now().UnixMilli() || d.SnoozedUntil != 0 {
		t.Fatalf("seen sets SeenTs to now and nothing else, got %+v", d)
	}
}

func TestSessionIdeasMarkSnooze(t *testing.T) {
	store := emptySessionIdeas(t)
	ws := &WshServer{}
	before := time.Now()
	if err := ws.SessionIdeasMarkCommand(context.Background(), wshrpc.CommandSessionIdeasMarkData{Op: "snooze"}); err != nil {
		t.Fatal(err)
	}
	d, _ := store.Load()
	lo, hi := before.Add(7*24*time.Hour).UnixMilli(), time.Now().Add(7*24*time.Hour).UnixMilli()
	if d.SnoozedUntil < lo || d.SnoozedUntil > hi || d.SeenTs != 0 {
		t.Fatalf("snooze sets SnoozedUntil to now + 7 days (%d..%d), got %+v", lo, hi, d)
	}
	if err := ws.SessionIdeasMarkCommand(context.Background(), wshrpc.CommandSessionIdeasMarkData{Op: "later"}); err == nil {
		t.Fatal("an op that is neither seen nor snooze must be an error")
	}
}

func TestSessionIdeasGetComputesTheSessionList(t *testing.T) {
	store := emptySessionIdeas(t)
	if err := store.Update(func(d *wshrpc.SessionIdeasData) error {
		d.Marks = []wshrpc.SessionIdeaMark{
			{SessionID: "s1", SessionTitle: "one", Outcome: wshrpc.SessionIdeaOutcome_Ideas, Ideas: 1, MtimeMs: 10},
			{SessionID: "s2", Outcome: wshrpc.SessionIdeaOutcome_Skipped, MtimeMs: 20},
		}
		d.Ideas = []wshrpc.SessionIdea{{ID: "i1", SessionID: "s1", State: wshrpc.SessionIdeaState_Review}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	got, err := (&WshServer{}).SessionIdeasGetCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.Scanned != 1 || len(got.Sessions) != 1 || got.Sessions[0].SessionID != "s1" ||
		got.Sessions[0].Outcome != wshrpc.SessionIdeasSession_Ideas || got.Sessions[0].Ideas != 1 {
		t.Fatalf("Get lists the session of each mark that was read, got %+v", got)
	}
	if len(got.Ideas) != 1 || len(got.Marks) != 2 {
		t.Fatalf("Get carries the ideas and the marks, got %+v", got)
	}
}

func TestSessionIdeasSeedRefusedOutsideDevMode(t *testing.T) {
	store := emptySessionIdeas(t)
	devMode(t, false)
	err := (&WshServer{}).SessionIdeasSeedCommand(context.Background(), wshrpc.CommandSessionIdeasSeedData{
		Data:    wshrpc.SessionIdeasData{SeenTs: 5, Ideas: []wshrpc.SessionIdea{{ID: "x"}}},
		Fixture: true,
	})
	if err == nil || !strings.Contains(err.Error(), "dev app only") {
		t.Fatalf("seed outside dev mode must be refused, got %v", err)
	}
	if d, _ := store.Load(); d.SeenTs != 0 || len(d.Ideas) != 0 {
		t.Fatalf("a refused seed must write nothing, got %+v", d)
	}
	if _, on := sessionIdeasFixture(); on {
		t.Fatal("a refused seed must not turn fixture mode on")
	}
	if err := (&WshServer{}).SessionIdeasSeedCommand(context.Background(), wshrpc.CommandSessionIdeasSeedData{Clear: true}); err == nil {
		t.Fatal("clear outside dev mode must be refused too")
	}
}

func TestSessionIdeasSeedFixtureOnAndCleared(t *testing.T) {
	store := emptySessionIdeas(t)
	devMode(t, true)
	ws := &WshServer{}
	sessions := []wshrpc.SessionIdeasSession{{SessionID: "f1", Outcome: wshrpc.SessionIdeasSession_NotScanned}}
	err := ws.SessionIdeasSeedCommand(context.Background(), wshrpc.CommandSessionIdeasSeedData{
		Data: wshrpc.SessionIdeasData{
			Ideas:    []wshrpc.SessionIdea{{ID: "i1", Gist: "seeded", State: wshrpc.SessionIdeaState_Review}},
			SeenTs:   7,
			Sessions: []wshrpc.SessionIdeasSession{{SessionID: "never-stored"}},
		},
		Fixture:  true,
		Sessions: sessions,
		Reply:    `[{"gist":"canned"}]`,
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	d, _ := store.Load()
	if len(d.Ideas) != 1 || d.Ideas[0].ID != "i1" || d.SeenTs != 7 {
		t.Fatalf("seed writes Data to the store, got %+v", d)
	}
	if len(d.Sessions) != 0 {
		t.Fatalf("the session list is computed, so seed does not store it, got %+v", d.Sessions)
	}
	fx, on := sessionIdeasFixture()
	if !on || fx.Reply != `[{"gist":"canned"}]` || !reflect.DeepEqual(fx.Sessions, sessions) {
		t.Fatalf("fixture mode is on with the seeded sessions and reply, got %v %+v", on, fx)
	}

	// a seed without Fixture writes the data and leaves the mode as it was
	if err := ws.SessionIdeasSeedCommand(context.Background(), wshrpc.CommandSessionIdeasSeedData{
		Data: wshrpc.SessionIdeasData{SeenTs: 8},
	}); err != nil {
		t.Fatal(err)
	}
	if d, _ := store.Load(); d.SeenTs != 8 || len(d.Ideas) != 0 {
		t.Fatalf("a second seed replaces the data, got %+v", d)
	}
	if _, on := sessionIdeasFixture(); !on {
		t.Fatal("a seed without Fixture must leave fixture mode on")
	}

	if err := ws.SessionIdeasSeedCommand(context.Background(), wshrpc.CommandSessionIdeasSeedData{Clear: true}); err != nil {
		t.Fatalf("clear: %v", err)
	}
	d, _ = store.Load()
	if len(d.Ideas) != 0 || len(d.Marks) != 0 || d.SeenTs != 0 {
		t.Fatalf("clear empties the store, got %+v", d)
	}
	if _, on := sessionIdeasFixture(); on {
		t.Fatal("clear turns fixture mode off")
	}
}

// waitScanIdle waits for the guard to let go of a scan that was stopped or ended.
func waitScanIdle(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		sessionIdeasScanMu.Lock()
		idle := sessionIdeasScanCancel == nil
		sessionIdeasScanMu.Unlock()
		if idle {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the scan guard never let go")
}

func TestSessionIdeasScanSecondStartRefusedWhileOneRuns(t *testing.T) {
	emptySessionIdeas(t)
	started := make(chan sessionideas.ScanOpts, 2)
	prev := runSessionIdeasScan
	runSessionIdeasScan = func(ctx context.Context, opts sessionideas.ScanOpts) error {
		started <- opts
		<-ctx.Done()
		return ctx.Err()
	}
	t.Cleanup(func() {
		stopSessionIdeasScan()
		waitScanIdle(t)
		runSessionIdeasScan = prev
	})
	ws := &WshServer{}
	if err := ws.SessionIdeasScanCommand(context.Background(), wshrpc.CommandSessionIdeasScanData{Paths: []string{"/a.jsonl"}}); err != nil {
		t.Fatalf("the first start: %v", err)
	}
	select {
	case opts := <-started:
		if !reflect.DeepEqual(opts.Paths, []string{"/a.jsonl"}) || opts.Forced {
			t.Fatalf("a scan the person starts passes its paths and is not forced, got %+v", opts)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the scan never started")
	}

	err := ws.SessionIdeasScanCommand(context.Background(), wshrpc.CommandSessionIdeasScanData{})
	if err == nil || !strings.Contains(err.Error(), "a scan is running") {
		t.Fatalf("a second start while one runs must be refused, got %v", err)
	}
	// the schedule goes through the same guard
	if err := startSessionIdeasScan(sessionideas.ScanOpts{Forced: true, Paths: []string{"/b.jsonl"}}); err == nil {
		t.Fatal("the schedule's start must be refused while a scan runs")
	}
	select {
	case opts := <-started:
		t.Fatalf("a refused start must not run a scan, got %+v", opts)
	case <-time.After(50 * time.Millisecond):
	}

	// Stop cancels the scan, and the guard then lets the next one start
	if err := ws.SessionIdeasScanCommand(context.Background(), wshrpc.CommandSessionIdeasScanData{Stop: true}); err != nil {
		t.Fatalf("stop: %v", err)
	}
	waitScanIdle(t)
	if err := ws.SessionIdeasScanCommand(context.Background(), wshrpc.CommandSessionIdeasScanData{}); err != nil {
		t.Fatalf("a start after the scan was stopped: %v", err)
	}
	select {
	case opts := <-started:
		if len(opts.Paths) != 0 {
			t.Fatalf("no paths means every quiet session not yet scanned, got %+v", opts)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the second scan never started")
	}
}

func TestSessionIdeasScanGuardLetsGoWhenAScanEnds(t *testing.T) {
	emptySessionIdeas(t)
	prev := runSessionIdeasScan
	runSessionIdeasScan = func(ctx context.Context, opts sessionideas.ScanOpts) error { return nil }
	t.Cleanup(func() { runSessionIdeasScan = prev })
	for i := range 3 {
		if err := startSessionIdeasScan(sessionideas.ScanOpts{}); err != nil {
			t.Fatalf("start %d after the last scan ended: %v", i, err)
		}
		waitScanIdle(t)
	}
	// stopping with nothing running is not an error and leaves the guard free
	stopSessionIdeasScan()
	if err := startSessionIdeasScan(sessionideas.ScanOpts{}); err != nil {
		t.Fatalf("a stop with no scan must leave the guard free: %v", err)
	}
	waitScanIdle(t)
}

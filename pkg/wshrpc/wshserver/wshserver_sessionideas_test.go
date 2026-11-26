// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bytes"
	"context"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/sessionarchive"
	"github.com/wavetermdev/waveterm/pkg/sessionideas"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
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

// devApp sets whether wavesrv was told it runs in a dev app (ARC_DEV_APP), and puts the cache back after the test.
func devApp(t *testing.T, on bool) {
	t.Helper()
	prev := wavebase.DevApp_VarCache
	wavebase.DevApp_VarCache = on
	t.Cleanup(func() { wavebase.DevApp_VarCache = prev })
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

// keepFixture gives a test an empty ideas store and an effort vault of its own.
func keepFixture(t *testing.T) *sessionideas.Store {
	t.Helper()
	t.Cleanup(effortstore.UseRootForTest(t.TempDir()))
	return emptySessionIdeas(t)
}

// floated is an idea waiting for review, floated in a session on the 24th, for the initiative effortOID ("" is a new idea).
func floated(id, gist, effortOID string) wshrpc.SessionIdea {
	return wshrpc.SessionIdea{
		ID: id, Gist: gist, Project: "arcterm", EffortOID: effortOID, EffortTitle: "Sidecar",
		Quotes:    []wshrpc.SessionIdeaQuote{{Who: "you", Text: "later, filter the wall by project"}},
		Why:       "the session moved on to the ask keys",
		SessionID: "9a842b04", SessionTitle: "Fix the sidecar wall",
		SaidTs: time.Date(2026, 11, 24, 12, 0, 0, 0, time.Local).UnixMilli(),
		State:  wshrpc.SessionIdeaState_Review,
	}
}

func keepIdea(id, label string) error {
	return (&WshServer{}).SessionIdeasResolveCommand(context.Background(),
		wshrpc.CommandSessionIdeasResolveData{ID: id, Op: "keep", Label: label})
}

func createTestEffort(t *testing.T, title string, labels ...string) string {
	t.Helper()
	seeds := make([]wshrpc.CommandEffortChunkSeed, 0, len(labels))
	for _, l := range labels {
		seeds = append(seeds, wshrpc.CommandEffortChunkSeed{Label: l})
	}
	rtn, err := (&WshServer{}).EffortCreateCommand(context.Background(), wshrpc.CommandEffortCreateData{Title: title, Chunks: seeds})
	if err != nil {
		t.Fatal(err)
	}
	return rtn.EffortOID
}

func allEfforts(t *testing.T) []*waveobj.Effort {
	t.Helper()
	all, err := effortstore.GetAll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return all
}

func TestSessionIdeasKeepOnAnInitiativeAddsOnePendingChunkWithTheNote(t *testing.T) {
	store := keepFixture(t)
	oid := createTestEffort(t, "Sidecar", "existing chunk")
	idea := floated("i1", "Let the wall filter by project", oid)
	// the oref form is what `wsh effort list` prints
	seedIdeas(t, store, idea, floated("i2", "Show the ask age on the card", "effort:"+oid))

	before := time.Now().UnixMilli()
	if err := keepIdea("i1", ""); err != nil {
		t.Fatalf("keep: %v", err)
	}
	e, err := effortstore.Get(context.Background(), oid)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Chunks) != 2 || e.Chunks[0].Label != "existing chunk" || len(e.Chunks[0].Notes) != 0 {
		t.Fatalf("keep adds one chunk after the others and leaves them alone, got %+v", e.Chunks)
	}
	c := e.Chunks[1]
	if c.Label != idea.Gist || c.Status != "pending" {
		t.Fatalf("the chunk is pending and named by the gist, got %+v", c)
	}
	if len(c.Notes) != 1 || c.Notes[0].Text != sessionideas.KeepNote(idea) {
		t.Fatalf("the chunk's first (only) note is the source, quotes and why, got %+v", c.Notes)
	}
	if !strings.Contains(c.Notes[0].Text, "9a842b04") || !strings.Contains(c.Notes[0].Text, "> You: later, filter the wall by project") {
		t.Fatalf("the note keeps the session id and the quote once the transcript is gone, got %q", c.Notes[0].Text)
	}
	got := ideaByID(t, store, "i1")
	if got.State != wshrpc.SessionIdeaState_Kept || got.KeptAs != "chunk:"+oid+":"+idea.Gist ||
		got.ResolvedTs < before || got.ResolvedTs > time.Now().UnixMilli() {
		t.Fatalf("a kept idea says where it went and when, got %+v", got)
	}

	// a label of the person's own names the chunk instead, and an id in the oref form finds the same initiative
	if err := keepIdea("i2", " Ask age "); err != nil {
		t.Fatalf("keep with a label: %v", err)
	}
	e, _ = effortstore.Get(context.Background(), oid)
	if len(e.Chunks) != 3 || e.Chunks[2].Label != "Ask age" || len(e.Chunks[2].Notes) != 1 {
		t.Fatalf("the label wins over the gist, got %+v", e.Chunks)
	}
	if got := ideaByID(t, store, "i2"); got.KeptAs != "chunk:"+oid+":Ask age" {
		t.Fatalf("KeptAs names the bare id and the label, got %q", got.KeptAs)
	}

	// pressing Keep again must not add a second chunk
	if err := keepIdea("i1", ""); err == nil || !strings.Contains(err.Error(), "already kept") {
		t.Fatalf("a second keep must be refused, got %v", err)
	}
	if e, _ = effortstore.Get(context.Background(), oid); len(e.Chunks) != 3 {
		t.Fatalf("a refused keep adds nothing, got %+v", e.Chunks)
	}
}

func TestSessionIdeasKeepWithoutAnInitiativeMakesAnIdea(t *testing.T) {
	store := keepFixture(t)
	idea := floated("i1", "Let the wall filter by project", "")
	seedIdeas(t, store, idea, floated("i2", "Another thing nobody decided", ""))

	if err := keepIdea("i1", ""); err != nil {
		t.Fatalf("keep: %v", err)
	}
	all := allEfforts(t)
	if len(all) != 1 {
		t.Fatalf("keep without an initiative makes one, got %d", len(all))
	}
	e := all[0]
	if e.Title != idea.Gist || e.Project != "arcterm" || e.Status != "active" || len(e.Chunks) != 0 {
		t.Fatalf("an idea is an initiative with no chunk, titled by the gist, in the idea's project, got %+v", e)
	}
	if len(e.Notes) == 0 || e.Notes[0].Text != sessionideas.KeepNote(idea) {
		t.Fatalf("the idea's first note is the source, quotes and why, got %+v", e.Notes)
	}
	if len(e.Events) == 0 || e.Events[0].Kind != "effort-created" {
		t.Fatalf("the idea is stamped as created, as an effort made through `wsh effort create` is, got %+v", e.Events)
	}
	got := ideaByID(t, store, "i1")
	if got.State != wshrpc.SessionIdeaState_Kept || got.KeptAs != "effort:"+e.OID || got.ResolvedTs == 0 {
		t.Fatalf("a kept idea says where it went, got %+v", got)
	}

	if err := keepIdea("i2", "Own title"); err != nil {
		t.Fatalf("keep with a label: %v", err)
	}
	var titles []string
	for _, e := range allEfforts(t) {
		titles = append(titles, e.Title)
	}
	if len(titles) != 2 || !(titles[0] == "Own title" || titles[1] == "Own title") {
		t.Fatalf("the label titles the new idea, got %v", titles)
	}
}

func TestSessionIdeasKeepOfAGoneInitiativeMakesAnIdea(t *testing.T) {
	store := keepFixture(t)
	idea := floated("i1", "Let the wall filter by project", "deleted-since-the-scan")
	seedIdeas(t, store, idea)
	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	if err := keepIdea("i1", ""); err != nil {
		t.Fatalf("an initiative gone since the scan must not fail the keep: %v", err)
	}
	all := allEfforts(t)
	if len(all) != 1 || all[0].Title != idea.Gist || len(all[0].Chunks) != 0 || all[0].Project != "arcterm" {
		t.Fatalf("a gone initiative makes a new idea in the idea's project, got %+v", all)
	}
	got := ideaByID(t, store, "i1")
	if got.State != wshrpc.SessionIdeaState_Kept || got.KeptAs != "effort:"+all[0].OID {
		t.Fatalf("it is kept as the new idea, got %+v", got)
	}
	if out := logged.String(); !strings.Contains(out, "deleted-since-the-scan") || !strings.Contains(out, "gone") {
		t.Fatalf("the log says the initiative was gone, got %q", out)
	}
}

func TestSessionIdeasKeepRefusesWhatIsNotInReview(t *testing.T) {
	store := keepFixture(t)
	seedIdeas(t, store,
		wshrpc.SessionIdea{ID: "kept", Gist: "k", State: wshrpc.SessionIdeaState_Kept, KeptAs: "effort:e1"},
		wshrpc.SessionIdea{ID: "dropped", Gist: "d", State: wshrpc.SessionIdeaState_Dropped},
		wshrpc.SessionIdea{ID: "nogist", State: wshrpc.SessionIdeaState_Review},
	)
	for _, c := range []struct{ name, id, label, want string }{
		{"unknown", "nope", "", "no idea"},
		{"already kept", "kept", "", "already kept"},
		{"already dropped", "dropped", "", "already dropped"},
		{"no gist and no label", "nogist", "", "label"},
	} {
		err := keepIdea(c.id, c.label)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("keep of an idea that is %s: error %v, want one saying %q", c.name, err, c.want)
		}
	}
	if n := len(allEfforts(t)); n != 0 {
		t.Fatalf("a refused keep makes no initiative, got %d", n)
	}
	if k := ideaByID(t, store, "kept"); k.KeptAs != "effort:e1" {
		t.Fatalf("a refused keep must leave a kept idea as it was, got %+v", k)
	}
	if n := ideaByID(t, store, "nogist"); n.State != wshrpc.SessionIdeaState_Review || n.ResolvedTs != 0 {
		t.Fatalf("a refused keep must leave the idea in review, got %+v", n)
	}
	// the label the person gives is enough for an idea with no gist
	if err := keepIdea("nogist", "Named by hand"); err != nil {
		t.Fatalf("a label stands in for a missing gist: %v", err)
	}
}

func TestSessionIdeasKeepLeavesTheIdeaInReviewWhenTheInitiativeRefusesTheChunk(t *testing.T) {
	store := keepFixture(t)
	gist := "Let the wall filter by project"
	oid := createTestEffort(t, "Sidecar", gist) // a chunk of that name is already there
	seedIdeas(t, store, floated("i1", gist, oid))
	err := keepIdea("i1", "")
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("a chunk label already on the initiative must be refused with the initiative's own error, got %v", err)
	}
	if got := ideaByID(t, store, "i1"); got.State != wshrpc.SessionIdeaState_Review || got.KeptAs != "" || got.ResolvedTs != 0 {
		t.Fatalf("a keep that wrote nothing must leave the idea in review, got %+v", got)
	}
	e, _ := effortstore.Get(context.Background(), oid)
	if len(e.Chunks) != 1 || len(e.Chunks[0].Notes) != 0 {
		t.Fatalf("a refused keep must leave the initiative as it was, got %+v", e.Chunks)
	}
	// the person's own label gets past it
	if err := keepIdea("i1", "Filter the wall"); err != nil {
		t.Fatalf("keep under another label: %v", err)
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
	now := time.Now()
	onDisk := []agentsessions.DigestSession{
		{Path: "/claude/s1.jsonl", Stem: "s1", Size: 10, Mtime: now.Add(-20 * 24 * time.Hour)},
		{Path: "/claude/s2.jsonl", Stem: "s2", Size: 10, Mtime: now.Add(-21 * 24 * time.Hour)},
		{Path: "/claude/s3.jsonl", Stem: "s3", Size: 10, Mtime: now.Add(-84 * 24 * time.Hour)}, // 6 days from deletion
		{Path: "/claude/s4.jsonl", Stem: "s4", Size: 10, Mtime: now.Add(-time.Hour)},
	}
	swap(t, &realSessionIdeasDeps, func() sessionideas.Deps {
		return sessionideas.Deps{
			Candidates:  func() []agentsessions.DigestSession { return onDisk },
			CleanupDays: func() int { return 90 },
		}
	})
	if err := store.Update(func(d *wshrpc.SessionIdeasData) error {
		d.Marks = []wshrpc.SessionIdeaMark{
			{TranscriptPath: "/claude/s1.jsonl", SessionID: "s1", SessionTitle: "one", Outcome: wshrpc.SessionIdeaOutcome_Ideas, Ideas: 1, Size: 10, MtimeMs: onDisk[0].Mtime.UnixMilli()},
			{TranscriptPath: "/claude/s2.jsonl", SessionID: "s2", Outcome: wshrpc.SessionIdeaOutcome_Skipped, Size: 10, MtimeMs: onDisk[1].Mtime.UnixMilli()},
			{TranscriptPath: "/claude/gone.jsonl", SessionID: "gone", Outcome: wshrpc.SessionIdeaOutcome_Nothing, Size: 10, MtimeMs: 1},
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
	if got.Scanned != 1 || got.NotYet != 2 || got.LeavingSoon != 1 || len(got.Sessions) != 3 {
		t.Fatalf("Get counts the transcripts on disk against the marks (a skipped one and a transcript that is gone have no row), got %+v", got)
	}
	s1 := ideasSessionRow(t, got.Sessions, "s1")
	if s1.Outcome != wshrpc.SessionIdeasSession_Ideas || s1.Ideas != 1 || s1.Title != "one" ||
		s1.DeletesTs != onDisk[0].Mtime.Add(90*24*time.Hour).UnixMilli() {
		t.Fatalf("a scanned session's row says what is left and when its transcript goes, got %+v", s1)
	}
	if len(got.Ideas) != 1 || len(got.Marks) != 3 {
		t.Fatalf("Get carries the ideas and the marks, got %+v", got)
	}
}

func TestSessionIdeasGetListsTheFixtureSessionsInFixtureMode(t *testing.T) {
	store := emptySessionIdeas(t)
	touched := failingRealDeps(t)
	now := time.Now()
	sessions := fixtureSessions(now)
	setSessionIdeasFixture(&wshrpc.CommandSessionIdeasSeedData{Fixture: true, Sessions: sessions})
	if err := store.Update(func(d *wshrpc.SessionIdeasData) error {
		d.Marks = []wshrpc.SessionIdeaMark{{
			TranscriptPath: "/fixture/f-new.jsonl", SessionID: "f-new", SessionTitle: "Newer fixture", Project: "arc",
			Outcome: wshrpc.SessionIdeaOutcome_Nothing, Size: 400, MtimeMs: sessions[1].LastWriteTs,
		}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	got, err := (&WshServer{}).SessionIdeasGetCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if *touched != 0 {
		t.Fatalf("fixture mode never reaches the real transcripts: %d reads", *touched)
	}
	if got.Scanned != 1 || got.NotYet != 2 || len(got.Sessions) != 3 {
		t.Fatalf("the seeded sessions are the list: %+v", got)
	}
	old := ideasSessionRow(t, got.Sessions, "f-old")
	if old.Outcome != wshrpc.SessionIdeasSession_NotScanned || old.Title != "Older fixture" || old.Project != "arc" ||
		old.DeletesTs != time.UnixMilli(sessions[0].LastWriteTs).Add(90*24*time.Hour).UnixMilli() {
		t.Fatalf("a seeded session is named, and its transcript goes 90 days after its last write whatever the machine's setting: %+v", old)
	}
	if live := ideasSessionRow(t, got.Sessions, "f-live"); live.Outcome != wshrpc.SessionIdeasSession_Waiting {
		t.Fatalf("a seeded session written an hour ago is waiting: %+v", live)
	}
	if done := ideasSessionRow(t, got.Sessions, "f-new"); done.Outcome != wshrpc.SessionIdeasSession_Nothing {
		t.Fatalf("a seeded session with a mark of its file as it stands is scanned: %+v", done)
	}
}

// writeTranscript is a session file last written age ago.
func ideasTranscript(t *testing.T, dir, name string, age time.Duration) (path string, size int64, mtime time.Time) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path = filepath.Join(dir, name+".jsonl")
	if err := os.WriteFile(path, []byte("{\"type\":\"user\"}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mtime = time.Now().Add(-age).Truncate(time.Millisecond)
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	return path, int64(len("{\"type\":\"user\"}\n")), mtime
}

func TestSessionIdeasUnscannedHook(t *testing.T) {
	store := emptySessionIdeas(t)
	swap(t, &storageMarks.paths, map[string]bool(nil)) // the marks are read afresh
	dir := t.TempDir()
	day := 24 * time.Hour
	never, neverSize, neverMtime := ideasTranscript(t, dir, "never", 40*day)
	young, youngSize, youngMtime := ideasTranscript(t, dir, "young", time.Hour)
	read, readSize, readMtime := ideasTranscript(t, dir, "read", 40*day)
	passed, passedSize, passedMtime := ideasTranscript(t, dir, "passed", 40*day)
	grown, grownSize, grownMtime := ideasTranscript(t, dir, "grown", 40*day)
	archived, archivedSize, archivedMtime := ideasTranscript(t, filepath.Join(sessionarchive.Dir(), "-p-proj"), "archived", 40*day)
	if err := store.Update(func(d *wshrpc.SessionIdeasData) error {
		d.Marks = []wshrpc.SessionIdeaMark{
			{TranscriptPath: read, Size: readSize, MtimeMs: readMtime.UnixMilli(), Outcome: wshrpc.SessionIdeaOutcome_Nothing},
			{TranscriptPath: passed, Size: passedSize, MtimeMs: passedMtime.UnixMilli(), Outcome: wshrpc.SessionIdeaOutcome_Skipped},
			{TranscriptPath: grown, Size: 3, MtimeMs: grownMtime.UnixMilli() - 5000, Outcome: wshrpc.SessionIdeaOutcome_Ideas},
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name  string
		path  string
		size  int64
		mtime time.Time
		want  bool
	}{
		{"a quiet session no scan marked", never, neverSize, neverMtime, true},
		{"one still being written is left to a later scan", young, youngSize, youngMtime, false},
		{"one a scan read", read, readSize, readMtime, false},
		{"one a scan passed over (it is scanned for good)", passed, passedSize, passedMtime, false},
		{"one that grew since its scan has been scanned, so it is not never scanned", grown, grownSize, grownMtime, false},
		{"one in arcterm's archive, which a scan leaves alone", archived, archivedSize, archivedMtime, false},
	} {
		if got := sessionIdeasUnscanned(c.path, c.size, c.mtime); got != c.want {
			t.Errorf("%s: unscanned = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestSessionIdeasUnscannedHookClaimsNothingWhenTheStoreCannotBeRead(t *testing.T) {
	store := emptySessionIdeas(t)
	swap(t, &storageMarks.paths, map[string]bool(nil))
	path, size, mtime := ideasTranscript(t, t.TempDir(), "old", 40*24*time.Hour)
	if err := os.MkdirAll(store.Root, 0o755); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(store.Root, "state.json")
	good, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.WriteFile(statePath, good, 0o644) })
	buf := captureLog(t)
	if sessionIdeasUnscanned(path, size, mtime) {
		t.Fatal("with the marks unreadable no session may read as never scanned")
	}
	if !strings.Contains(buf.String(), "reading the marks") {
		t.Fatalf("a store that cannot be read is logged: %q", buf.String())
	}
}

func ideasSessionRow(t *testing.T, rows []wshrpc.SessionIdeasSession, id string) wshrpc.SessionIdeasSession {
	t.Helper()
	for _, r := range rows {
		if r.SessionID == id {
			return r
		}
	}
	t.Fatalf("no row %s in %+v", id, rows)
	return wshrpc.SessionIdeasSession{}
}

func TestSessionIdeasSeedRefusedOutsideDevMode(t *testing.T) {
	store := emptySessionIdeas(t)
	devMode(t, false)
	devApp(t, false)
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

// the Tauri host and the browser app tell wavesrv it is a dev app with ARC_DEV_APP; neither sets WAVETERM_DEV, so that
// flag alone is what the seed must accept
func TestSessionIdeasSeedAcceptedInADevApp(t *testing.T) {
	store := emptySessionIdeas(t)
	devMode(t, false)
	devApp(t, true)
	err := (&WshServer{}).SessionIdeasSeedCommand(context.Background(), wshrpc.CommandSessionIdeasSeedData{
		Data:    wshrpc.SessionIdeasData{SeenTs: 5},
		Fixture: true,
	})
	if err != nil {
		t.Fatalf("a dev app must accept the seed, got %v", err)
	}
	if d, _ := store.Load(); d.SeenTs != 5 {
		t.Fatalf("an accepted seed writes its data, got %+v", d)
	}
	if _, on := sessionIdeasFixture(); !on {
		t.Fatal("an accepted seed with Fixture turns fixture mode on")
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

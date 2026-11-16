// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/dume"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var dumeT0 = time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)

func dumeF(v float64) *float64 { return &v }
func dumeAt(base time.Time, d time.Duration) *int64 {
	t := base.Add(d).Unix()
	return &t
}

// a quota 40 min from the 5h reset with 40 % used, week 20 % used at 50 % elapsed (the gate's ready case)
func dumeReady() *claudequota.Quota {
	return &claudequota.Quota{
		FiveHourPct: dumeF(40), FiveHourReset: dumeAt(dumeT0, 40*time.Minute),
		WeekPct: dumeF(20), WeekReset: dumeAt(dumeT0, 84*time.Hour),
	}
}

type dumeNoteCall struct{ oid, chunk, status, note string }
type dumeDropCall struct {
	path, key  string
	keepBranch bool
}

// dumeWorld scripts everything the loop touches outside pkg/dume: the initiatives (which dumeNote edits through the
// real dumeApplyNote, so a note the loop writes is the one the next tick reads), the live runs, the git branch counts
// and the start.
type dumeWorld struct {
	t       *testing.T
	enabled bool
	now     time.Time
	quota   *claudequota.Quota

	efforts []*waveobj.Effort
	runs    []*waveobj.Run // the live ones
	paths   map[string]string
	ahead   func(branch string) (int, error)

	pressure   jobqueue.Pressure
	startErr   error
	started    []dume.Ref
	notes      []dumeNoteCall
	dropped    []dumeDropCall
	published  []wshrpc.DumeStatusData
	effortRead int
	quotaRead  int
}

func newDumeWorld(t *testing.T, efforts ...*waveobj.Effort) *dumeWorld {
	t.Helper()
	w := &dumeWorld{
		t: t, enabled: true, now: dumeT0, quota: dumeReady(), efforts: efforts,
		paths:    map[string]string{"proj": "/work/proj"},
		ahead:    func(string) (int, error) { return 1, nil },
		pressure: jobqueue.PressureUnknown,
	}
	swap(t, &dumeStatus, wshrpc.DumeStatusData{})
	swap(t, &dumeArmed, 0)
	swap(t, &dumeIsEnabled, func() bool { return w.enabled })
	swap(t, &dumeNow, func() time.Time { return w.now })
	swap(t, &dumeQuota, func(context.Context) *claudequota.Quota { w.quotaRead++; return w.quota })
	swap(t, &dumePressure, func(context.Context) jobqueue.Pressure { return w.pressure })
	swap(t, &dumeEfforts, func(context.Context) ([]*waveobj.Effort, error) { w.effortRead++; return w.efforts, nil })
	swap(t, &dumeRuns, func(context.Context) ([]*waveobj.Run, error) { return w.runs, nil })
	swap(t, &dumeProjectPath, func(project string) string { return w.paths[project] })
	swap(t, &dumeAhead, func(_ context.Context, _, branch string) (int, error) { return w.ahead(branch) })
	swap(t, &dumeStartRun, func(_ context.Context, ref dume.Ref) (string, string, error) {
		if w.startErr != nil {
			return "", "", w.startErr
		}
		w.started = append(w.started, ref)
		runId := fmt.Sprintf("run-%d", len(w.started))
		w.runs = append(w.runs, &waveobj.Run{
			ID: runId, Status: jarvis.RunStatus_Executing,
			EffortRef: &waveobj.RunEffortRef{EffortOID: ref.EffortOID, ChunkLabel: ref.Chunk},
		})
		return runId, "wave/" + dume.TreeKey(ref.EffortOID, w.now), nil
	})
	swap(t, &dumeNote, func(_ context.Context, oid, chunk, status, note string) error {
		w.notes = append(w.notes, dumeNoteCall{oid, chunk, status, note})
		for _, e := range w.efforts {
			if e.OID == oid {
				return dumeApplyNote(e, chunk, status, note, w.now.UnixMilli())
			}
		}
		return fmt.Errorf("no effort %s", oid)
	})
	swap(t, &dumeDropTree, func(_ context.Context, path, key string, keep bool) error {
		w.dropped = append(w.dropped, dumeDropCall{path, key, keep})
		return nil
	})
	swap(t, &dumePublish, func(s wshrpc.DumeStatusData) { w.published = append(w.published, s) })
	return w
}

func (w *dumeWorld) tick() { dumeTick(context.Background()) }

func (w *dumeWorld) status() wshrpc.DumeStatusData {
	dumeMu.Lock()
	defer dumeMu.Unlock()
	return dumeStatus
}

// chunk reads the live state of one chunk through the real classifier.
func (w *dumeWorld) chunk(effort, label string) (waveobj.EffortChunk, dume.State) {
	w.t.Helper()
	live := map[string]bool{}
	for _, r := range w.runs {
		live[r.ID] = true
	}
	for _, e := range w.efforts {
		if e.OID != effort {
			continue
		}
		for _, c := range e.Chunks {
			if c.Label == label {
				return c, dume.ClassifyChunk(c, func(id string) bool { return live[id] })
			}
		}
	}
	w.t.Fatalf("no chunk %s/%s", effort, label)
	return waveobj.EffortChunk{}, dume.StateNone
}

func dumeChunk(label, status string, notes ...string) waveobj.EffortChunk {
	c := waveobj.EffortChunk{Label: label, Status: status, Owner: dume.Owner}
	for i, n := range notes {
		c.Notes = append(c.Notes, waveobj.EffortNote{Ts: int64(i + 1), Text: n})
	}
	return c
}

func dumeEffort(oid string, chunks ...waveobj.EffortChunk) *waveobj.Effort {
	return &waveobj.Effort{OID: oid, Title: "Initiative " + oid, Status: "active", Project: "proj", Chunks: chunks}
}

func dumeRunOf(id, effort, chunk string) *waveobj.Run {
	return &waveobj.Run{ID: id, Status: jarvis.RunStatus_Executing, EffortRef: &waveobj.RunEffortRef{EffortOID: effort, ChunkLabel: chunk}}
}

func newestDumeNote(c waveobj.EffortChunk) string {
	for i := len(c.Notes) - 1; i >= 0; i-- {
		if strings.HasPrefix(c.Notes[i].Text, "DUM-E: ") {
			return c.Notes[i].Text
		}
	}
	return ""
}

func TestDumeOffStartsNothingAndPublishesOnce(t *testing.T) {
	w := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "pending")))
	w.enabled = false
	w.tick()
	w.tick()
	if len(w.started) != 0 {
		t.Fatalf("off must start nothing, got %v", w.started)
	}
	if got := w.status().Reason; got != "off" {
		t.Fatalf("reason: want off, got %q", got)
	}
	if len(w.published) != 1 {
		t.Fatalf("the same reason twice is one event, got %d", len(w.published))
	}
	if w.effortRead != 0 || w.quotaRead != 0 {
		t.Fatalf("an off tick reads nothing else (efforts %d, quota %d)", w.effortRead, w.quotaRead)
	}
}

func TestDumeStartsTheWaitingChunk(t *testing.T) {
	w := newDumeWorld(t,
		dumeEffort("e1", dumeChunk("mine", "pending"), dumeChunk("c1", "pending"), dumeChunk("c2", "pending")))
	w.efforts[0].Chunks[0].Owner = "" // not handed to DUM-E
	w.tick()
	if len(w.started) != 1 || w.started[0].EffortOID != "e1" || w.started[0].Chunk != "c1" {
		t.Fatalf("want c1 started once, got %+v", w.started)
	}
	c, st := w.chunk("e1", "c1")
	if c.Status != "active" || st != dume.StateRunning {
		t.Fatalf("c1 is active and its run live, got %q / state %d", c.Status, st)
	}
	runId, branch, ok := dume.ParseStarted(newestDumeNote(c))
	if !ok || runId != "run-1" || !strings.HasPrefix(branch, "wave/dume-e1-") {
		t.Fatalf("the started note names the run and branch, got %q", newestDumeNote(c))
	}
	if len(w.notes) != 1 || w.notes[0].status != "active" || w.notes[0].note != dume.StartedNote(runId, branch) {
		t.Fatalf("one write: active with the started note, got %+v", w.notes)
	}
	s := w.status()
	if s.Reason != "starting" || s.Running == nil || s.Running.Chunk != "c1" || s.Running.RunId != "run-1" || s.Waiting != 1 {
		t.Fatalf("status after a start: %+v", s)
	}
	if len(w.published) != 1 {
		t.Fatalf("one event for the tick, got %d", len(w.published))
	}
	if _, st := w.chunk("e1", "c2"); st != dume.StateWaiting {
		t.Fatalf("c2 still waits")
	}
}

// the swapped dumeNote of the other cases cannot prove the notes read back: this applies the real dumeApplyNote
func TestDumeApplyNoteWritesWhatClassifyChunkReads(t *testing.T) {
	apply := func(e *waveobj.Effort, status, note string) {
		t.Helper()
		if err := dumeApplyNote(e, "c1", status, note, 5_000); err != nil {
			t.Fatal(err)
		}
	}
	state := func(e *waveobj.Effort, live bool) dume.State {
		return dume.ClassifyChunk(e.Chunks[0], func(id string) bool { return live && id == "r1" })
	}

	e := dumeEffort("e1", dumeChunk("c1", "pending"))
	apply(e, "active", dume.StartedNote("r1", "wave/dume-x"))
	if st := state(e, true); st != dume.StateRunning {
		t.Fatalf("live run: want StateRunning, got %d", st)
	}
	if st := state(e, false); st != dume.StateFinished {
		t.Fatalf("run gone: want StateFinished, got %d", st)
	}
	// status change and note are two notes; the status one carries no DUM-E text
	if got := e.Chunks[0].Notes[0].Text; strings.HasPrefix(got, "DUM-E: ") || !strings.HasPrefix(got, "marked active") {
		t.Fatalf("the status note is marked-only, got %q", got)
	}

	apply(e, "", dume.ToLandNote("wave/dume-x", 2))
	if e.Chunks[0].Status != "active" || state(e, false) != dume.StateToLand {
		t.Fatalf("a note alone keeps the status and reads StateToLand, got %q / %d", e.Chunks[0].Status, state(e, false))
	}

	b := dumeEffort("e1", dumeChunk("c1", "pending"))
	apply(b, "active", dume.StartedNote("r1", "wave/dume-x"))
	apply(b, "blocked", dume.NothingNote("wave/dume-x"))
	if st := state(b, false); st != dume.StateBlocked {
		t.Fatalf("blocked with a note: want StateBlocked, got %d", st)
	}
}

func TestDumeFinishedWithCommitsIsReadyToLandAndKeepsItsBranch(t *testing.T) {
	branch := "wave/dume-e1-k1"
	w := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "active", dume.StartedNote("r1", branch))))
	w.ahead = func(b string) (int, error) {
		if b != branch {
			t.Errorf("asked about %s", b)
		}
		return 2, nil
	}
	w.tick()
	c, st := w.chunk("e1", "c1")
	if c.Status != "active" || st != dume.StateToLand {
		t.Fatalf("ready to land keeps the chunk active, got %q / %d", c.Status, st)
	}
	if got := newestDumeNote(c); got != dume.ToLandNote(branch, 2) {
		t.Fatalf("note: %q", got)
	}
	if want := []dumeDropCall{{"/work/proj", "dume-e1-k1", true}}; !reflect.DeepEqual(w.dropped, want) {
		t.Fatalf("the tree goes, the branch stays: %+v", w.dropped)
	}
	s := w.status()
	if len(s.ToLand) != 1 || s.ToLand[0].Branch != branch || s.Running != nil {
		t.Fatalf("status: %+v", s)
	}
}

func TestDumeFinishedWithNothingIsBlockedAndDropsTheBranch(t *testing.T) {
	branch := "wave/dume-e1-k1"
	w := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "active", dume.StartedNote("r1", branch))))
	w.ahead = func(string) (int, error) { return 0, nil }
	w.tick()
	c, st := w.chunk("e1", "c1")
	if c.Status != "blocked" || st != dume.StateBlocked {
		t.Fatalf("nothing committed blocks the chunk, got %q / %d", c.Status, st)
	}
	if got := newestDumeNote(c); got != dume.NothingNote(branch) {
		t.Fatalf("note: %q", got)
	}
	if want := []dumeDropCall{{"/work/proj", "dume-e1-k1", false}}; !reflect.DeepEqual(w.dropped, want) {
		t.Fatalf("tree and branch go: %+v", w.dropped)
	}
	if s := w.status(); s.Blocked != 1 || len(s.ToLand) != 0 {
		t.Fatalf("status: %+v", s)
	}
}

func TestDumeFinishedWhoseBranchCannotBeReadIsLeftForTheNextTick(t *testing.T) {
	w := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "active", dume.StartedNote("r1", "wave/dume-e1-k1"))))
	w.ahead = func(string) (int, error) { return 0, errors.New("git broke") }
	w.tick()
	if len(w.notes) != 0 || len(w.dropped) != 0 {
		t.Fatalf("an unreadable branch changes nothing: %+v %+v", w.notes, w.dropped)
	}
	if _, st := w.chunk("e1", "c1"); st != dume.StateFinished {
		t.Fatalf("still finished for the next tick, got %d", st)
	}
}

func TestDumeOwnRunsHoldItBackButItsOwnDoNotCountAsYours(t *testing.T) {
	w := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "pending")))
	w.runs = []*waveobj.Run{{ID: "u1", Status: jarvis.RunStatus_Executing}}
	w.tick()
	if len(w.started) != 0 || !strings.Contains(w.status().Reason, "1 of your runs live") {
		t.Fatalf("a run of yours holds DUM-E back, reason %q, started %v", w.status().Reason, w.started)
	}

	// a worker of that run is no second run of yours, and a finished one counts for nothing
	w.runs = []*waveobj.Run{
		{ID: "u1", Status: jarvis.RunStatus_Executing},
		{ID: "u1-t1", Status: jarvis.RunStatus_Executing, TaskId: "t-1"},
		{ID: "old", Status: jarvis.RunStatus_Done},
	}
	w.tick()
	if !strings.Contains(w.status().Reason, "1 of your runs live") {
		t.Fatalf("reason %q", w.status().Reason)
	}

	// DUM-E's own live run (a quick run on its chunk) is not yours
	w2 := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "active", dume.StartedNote("run-1", "wave/dume-e1-k1")), dumeChunk("c2", "pending")))
	w2.runs = []*waveobj.Run{dumeRunOf("run-1", "e1", "c1")}
	w2.tick()
	if strings.Contains(w2.status().Reason, "your runs") || w2.status().Reason != "working" {
		t.Fatalf("DUM-E's run is not one of yours, reason %q", w2.status().Reason)
	}
}

func TestDumeDoesNotStartAChunkThatAlreadyHasALiveRun(t *testing.T) {
	// a start that crashed before it wrote its note leaves a pending chunk with a live run on it
	w := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "pending")))
	w.runs = []*waveobj.Run{dumeRunOf("run-9", "e1", "c1")}
	w.tick()
	if len(w.started) != 0 {
		t.Fatalf("started again: %+v", w.started)
	}
	if _, st := w.chunk("e1", "c1"); st != dume.StateWaiting {
		t.Fatalf("the chunk is left as it was, state %d", st)
	}
}

func TestDumeRunsOneAtATime(t *testing.T) {
	// c1 crashed before its note (pending, live run); c2 waits behind it
	w := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "pending"), dumeChunk("c2", "pending")))
	w.runs = []*waveobj.Run{dumeRunOf("run-9", "e1", "c1")}
	w.tick()
	if len(w.started) != 0 || w.status().Reason != "working" {
		t.Fatalf("one at a time: started %v, reason %q", w.started, w.status().Reason)
	}
	if r := w.status().Running; r == nil || r.Chunk != "c1" || r.RunId != "run-9" {
		t.Fatalf("the status names the live run, got %+v", r)
	}
}

func TestDumeArmedStateSurvivesTicks(t *testing.T) {
	w := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "pending"), dumeChunk("c2", "pending")))
	reset := *w.quota.FiveHourReset
	w.tick()
	if len(w.started) != 1 || dumeArmed != reset {
		t.Fatalf("first tick starts c1 and arms the window, started %v armed %d", w.started, dumeArmed)
	}

	// c1's run ends with a commit; the window is now 85 % used, past the 70 % a window starts under
	w.runs = nil
	w.now = w.now.Add(5 * time.Minute)
	w.quota.FiveHourPct = dumeF(85)
	w.tick()
	if len(w.started) != 2 || w.started[1].Chunk != "c2" {
		t.Fatalf("an armed window takes the next chunk at 85 %%, started %+v (reason %q)", w.started, w.status().Reason)
	}
	if _, st := w.chunk("e1", "c1"); st != dume.StateToLand {
		t.Fatalf("c1 was finished on the way, state %d", st)
	}

	// the same reading on a window that never started is refused: arming is what allowed it
	w3 := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "pending")))
	w3.quota.FiveHourPct = dumeF(85)
	w3.tick()
	if len(w3.started) != 0 || !strings.Contains(w3.status().Reason, "85% used") {
		t.Fatalf("a fresh window at 85 %% does not start: %q", w3.status().Reason)
	}
}

func TestDumeSkipsAChunkWhoseProjectHasNoPath(t *testing.T) {
	w := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "pending")))
	w.paths = map[string]string{}
	w.tick()
	if len(w.started) != 0 || len(w.notes) != 0 {
		t.Fatalf("not started and not marked: %+v %+v", w.started, w.notes)
	}
	if c, st := w.chunk("e1", "c1"); c.Status != "pending" || st != dume.StateWaiting {
		t.Fatalf("stays pending, got %q / %d", c.Status, st)
	}
	if s := w.status(); s.Waiting != 0 {
		t.Fatalf("a chunk that cannot run is not waiting: %+v", s)
	}
}

func TestDumeABlockedStartKeepsItsReason(t *testing.T) {
	w := newDumeWorld(t, dumeEffort("e1", dumeChunk("c1", "pending")))
	w.startErr = errors.New("boom")
	w.tick()
	c, st := w.chunk("e1", "c1")
	if c.Status != "blocked" || st != dume.StateBlocked {
		t.Fatalf("a failed start blocks the chunk, got %q / %d", c.Status, st)
	}
	if got := newestDumeNote(c); got != "DUM-E: could not start: boom" {
		t.Fatalf("note: %q", got)
	}
	if got := w.status().Reason; got != "could not start c1: boom" {
		t.Fatalf("reason: %q", got)
	}
}

func TestDumeStartChunkNeedsAProjectPath(t *testing.T) {
	swap(t, &dumeProjectPath, func(string) string { return "" })
	_, _, err := dumeStartChunk(context.Background(), dume.Ref{EffortOID: "e1", Project: "proj", Chunk: "c1"})
	if err == nil || !strings.Contains(err.Error(), "path") {
		t.Fatalf("want a no-path error, got %v", err)
	}
}

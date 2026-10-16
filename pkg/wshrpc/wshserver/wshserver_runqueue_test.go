// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// queueWorld stands in for everything the queue loop reads and calls outside its own store: the runs the engine has,
// the create call, the cap and the event feed. The queue file itself is the real one, in the test data dir.
type queueWorld struct {
	mu        sync.Mutex
	prefix    string // keeps this world's run ids apart from every other test's: run events outlive a test in the shared db
	runs      map[string]*waveobj.Run
	maxActive int
	created   []wshrpc.CommandCreateRunData
	createErr error
	published []wshrpc.RunQueueChangedData
	hold      chan struct{} // when set, a create waits for it to close
	entered   chan struct{} // told when a create begins
}

func clearRunQueue(t *testing.T) {
	t.Helper()
	entries, err := runqueue.List()
	if err != nil {
		t.Fatalf("listing the queue: %v", err)
	}
	for _, e := range entries {
		if err := runqueue.Remove(e.Id); err != nil {
			t.Fatalf("clearing the queue: %v", err)
		}
	}
}

func useQueueWorld(t *testing.T) *queueWorld {
	t.Helper()
	clearRunQueue(t)
	w := &queueWorld{prefix: "run-" + uuid.NewString()[:8] + "-", runs: map[string]*waveobj.Run{}, maxActive: 3}
	oldLoad, oldCreate, oldMax, oldPublish := runQueueLoadRuns, runQueueCreateRun, runQueueMaxActive, runQueuePublish
	// an evaluation also tells origin sessions: none here, whatever other tests left in the shared db
	swap(t, &originNoticeRuns, func(context.Context) ([]*waveobj.Run, error) { return nil, nil })
	runQueueLoadRuns = func(ctx context.Context, afterIds []string) (map[string]*waveobj.Run, error) {
		w.mu.Lock()
		defer w.mu.Unlock()
		out := make(map[string]*waveobj.Run, len(w.runs))
		maps.Copy(out, w.runs)
		return out, nil
	}
	runQueueCreateRun = w.create
	runQueueMaxActive = func() int {
		w.mu.Lock()
		defer w.mu.Unlock()
		return w.maxActive
	}
	runQueuePublish = func(data wshrpc.RunQueueChangedData) {
		w.mu.Lock()
		defer w.mu.Unlock()
		w.published = append(w.published, data)
	}
	t.Cleanup(func() {
		runQueueLoadRuns, runQueueCreateRun, runQueueMaxActive, runQueuePublish = oldLoad, oldCreate, oldMax, oldPublish
		clearRunQueue(t)
		drainRunQueuePoke()
	})
	drainRunQueuePoke()
	return w
}

func drainRunQueuePoke() {
	select {
	case <-runQueuePoke:
	default:
	}
}

// create records the call and, unless it is scripted to fail, makes an executing top-level run, which counts against
// the cap from then on as a real one does.
func (w *queueWorld) create(ctx context.Context, data wshrpc.CommandCreateRunData) (*wshrpc.CommandCreateRunRtnData, error) {
	if w.entered != nil {
		select {
		case w.entered <- struct{}{}:
		default:
		}
	}
	if w.hold != nil {
		<-w.hold
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.created = append(w.created, data)
	if w.createErr != nil {
		return nil, w.createErr
	}
	run := &waveobj.Run{ID: w.runId(len(w.created)), Goal: data.Goal, Status: jarvis.RunStatus_Executing, ChannelOID: data.ChannelId, OriginTabId: data.OriginTabId}
	w.runs[run.ID] = run
	return &wshrpc.CommandCreateRunRtnData{Run: run}, nil
}

// runId is the id the fake create gives the nth run it makes.
func (w *queueWorld) runId(n int) string { return fmt.Sprintf("%s%d", w.prefix, n) }

func (w *queueWorld) setRun(r *waveobj.Run) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.runs[r.ID] = r
}

func (w *queueWorld) createdGoals() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	goals := make([]string, 0, len(w.created))
	for _, d := range w.created {
		goals = append(goals, d.Goal)
	}
	return goals
}

func (w *queueWorld) lastPublished() []wshrpc.RunQueueEntry {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.published) == 0 {
		return nil
	}
	return w.published[len(w.published)-1].Entries
}

// startedIn is every Started pair the publishes carried, in order.
func (w *queueWorld) startedIn() []wshrpc.RunQueueStarted {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []wshrpc.RunQueueStarted
	for _, d := range w.published {
		out = append(out, d.Started...)
	}
	return out
}

func (w *queueWorld) publishCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.published)
}

// queueEntry adds an entry as the command would have, with a title that doubles as the goal the fake create sees.
func queueEntry(t *testing.T, title, after string) wshrpc.RunQueueEntry {
	t.Helper()
	e, err := runqueue.Add(wshrpc.RunQueueEntry{
		Title:       title,
		ProjectPath: "/proj",
		After:       after,
		Data: wshrpc.CommandCreateRunData{
			ChannelId: "ch-queue", WorkspaceId: "ws", Goal: title, Mode: jarvis.RunMode_Orchestrator,
			PlanPath: "/plans/" + title + ".md", OriginTabId: "tab-1",
		},
	})
	if err != nil {
		t.Fatalf("Add(%s): %v", title, err)
	}
	return e
}

func queueEntries(t *testing.T) []wshrpc.RunQueueEntry {
	t.Helper()
	entries, err := runqueue.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	return entries
}

func entryTitles(entries []wshrpc.RunQueueEntry) []string {
	titles := make([]string, 0, len(entries))
	for _, e := range entries {
		titles = append(titles, e.Title)
	}
	return titles
}

func sameStrings(got []string, want ...string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func entryByTitle(t *testing.T, entries []wshrpc.RunQueueEntry, title string) wshrpc.RunQueueEntry {
	t.Helper()
	for _, e := range entries {
		if e.Title == title {
			return e
		}
	}
	t.Fatalf("no queued entry titled %q in %v", title, entryTitles(entries))
	return wshrpc.RunQueueEntry{}
}

// commands reach the server by reflection on its method names, so a missing one is a runtime "no such command"
var _ wshrpc.RunQueueCommands = (*WshServer)(nil)

func TestRunQueueStartsAReadyEntryAndRemovesIt(t *testing.T) {
	w := useQueueWorld(t)
	e := queueEntry(t, "Alpha", "")
	evaluateRunQueue(context.Background())

	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("created %v, want the one ready entry", got)
	}
	if w.created[0].OriginTabId != "tab-1" || w.created[0].PlanPath != "/plans/Alpha.md" {
		t.Fatalf("the start is not the data that was queued: %+v", w.created[0])
	}
	if left := queueEntries(t); len(left) != 0 {
		t.Fatalf("a started entry leaves the queue, got %v", entryTitles(left))
	}
	if w.publishCount() == 0 || len(w.lastPublished()) != 0 {
		t.Fatalf("the queue's change is published with the whole (now empty) list: %d publishes, last %v", w.publishCount(), w.lastPublished())
	}
	events, err := wstore.QueryRunEventsByKind(context.Background(), "ch-queue", w.runId(1), []string{runEventKindQueuedStart}, 5)
	if err != nil || len(events) != 1 {
		t.Fatalf("want one queued-start event on the new run, got %v (err %v)", events, err)
	}
	if !strings.Contains(string(events[0].Detail), e.Id) {
		t.Fatalf("the queued-start event names the entry %s, got %s", e.Id, events[0].Detail)
	}
}

func TestRunQueueNeverStartsPastTheCap(t *testing.T) {
	cases := []struct {
		name      string
		maxActive int
		active    int
		entries   int
		want      int
	}{
		{"room for one", 1, 0, 2, 1},
		{"room for one of three", 3, 2, 2, 1},
		{"a full cap starts none", 2, 2, 2, 0},
		{"no cap starts them all", 0, 5, 3, 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := useQueueWorld(t)
			w.maxActive = c.maxActive
			for i := range c.active {
				w.setRun(&waveobj.Run{ID: fmt.Sprintf("live-%d", i), Status: jarvis.RunStatus_Executing})
			}
			for i := range c.entries {
				queueEntry(t, fmt.Sprintf("Plan%d", i), "")
			}
			evaluateRunQueue(context.Background())
			if got := len(w.createdGoals()); got != c.want {
				t.Fatalf("started %d, want %d", got, c.want)
			}
			if c.want > 0 && c.want < c.entries {
				// the first in line goes first
				if got := w.createdGoals(); got[0] != "Plan0" {
					t.Fatalf("started %v first, want the head of the queue", got)
				}
			}
			if left := queueEntries(t); len(left) != c.entries-c.want {
				t.Fatalf("%d entries left, want %d", len(left), c.entries-c.want)
			}
		})
	}
}

func TestRunQueueCountsOnlyTopLevelUnfinishedRuns(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 1
	// none of these holds the slot: a worker, a reviewer, a stage session, a lead's child, a finished run
	w.setRun(&waveobj.Run{ID: "task", Status: jarvis.RunStatus_Executing, TaskId: "t1"})
	w.setRun(&waveobj.Run{ID: "review", Status: jarvis.RunStatus_Executing, TaskId: "t1", Review: true})
	w.setRun(&waveobj.Run{ID: "stage", Status: jarvis.RunStatus_Executing, StageRole: "verifier"})
	w.setRun(&waveobj.Run{ID: "child", Status: jarvis.RunStatus_Executing, ParentLeadORef: "tab:x"})
	w.setRun(&waveobj.Run{ID: "done", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "held", Reason: "conflict"}})
	queueEntry(t, "Alpha", "")
	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("created %v: only an unfinished top-level run counts against the cap", got)
	}
}

func TestRunQueueBlocksAnEntryWhoseCreateFails(t *testing.T) {
	w := useQueueWorld(t)
	w.createErr = errors.New("route unavailable: claude is not installed")
	queueEntry(t, "Alpha", "")
	queueEntry(t, "Beta", "")
	evaluateRunQueue(context.Background())

	entries := queueEntries(t)
	alpha := entryByTitle(t, entries, "Alpha")
	if alpha.State != wshrpc.RunQueueState_Blocked || alpha.Reason != "route unavailable: claude is not installed" {
		t.Fatalf("a failing start blocks the entry with the error as the reason, got %q %q", alpha.State, alpha.Reason)
	}
	// the blocked entry is not tried again, and the one behind it is not held up: it is tried at once
	if got := w.createdGoals(); !sameStrings(got, "Alpha", "Beta") {
		t.Fatalf("create calls %v, want Alpha once then Beta once", got)
	}
	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); len(got) != 2 {
		t.Fatalf("a blocked entry is retried by the loop: %v", got)
	}
	if last := w.lastPublished(); len(last) != 2 || entryByTitle(t, last, "Alpha").State != wshrpc.RunQueueState_Blocked {
		t.Fatalf("the block is published: %v", last)
	}
}

func TestRunQueueEntryAfterARun(t *testing.T) {
	w := useQueueWorld(t)
	w.setRun(&waveobj.Run{ID: "r1", Goal: "Learned additions", Status: jarvis.RunStatus_Executing})
	queueEntry(t, "Alpha", "r1")

	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); len(got) != 0 {
		t.Fatalf("started %v while its After run is still going", got)
	}
	if e := queueEntries(t)[0]; e.State != wshrpc.RunQueueState_Waiting {
		t.Fatalf("an entry waiting on a running run keeps waiting, got %q", e.State)
	}

	w.setRun(&waveobj.Run{ID: "r1", Goal: "Learned additions", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "landed"}})
	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("created %v, want Alpha once its After run landed", got)
	}
}

func TestRunQueueBlocksAnEntryAfterAHeldRunButNotADirtyOne(t *testing.T) {
	w := useQueueWorld(t)
	w.setRun(&waveobj.Run{ID: "held", Goal: "Learned additions", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "held", Reason: "merge conflict"}})
	w.setRun(&waveobj.Run{ID: "dirty", Goal: "Other", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "held", Reason: "uncommitted changes", Dirty: true}})
	queueEntry(t, "AfterHeld", "held")
	queueEntry(t, "AfterDirty", "dirty")
	evaluateRunQueue(context.Background())

	entries := queueEntries(t)
	held := entryByTitle(t, entries, "AfterHeld")
	if held.State != wshrpc.RunQueueState_Blocked || !strings.Contains(held.Reason, "Learned additions") || !strings.Contains(held.Reason, "held") {
		t.Fatalf("an entry after a held run is blocked, naming it: %q %q", held.State, held.Reason)
	}
	if dirty := entryByTitle(t, entries, "AfterDirty"); dirty.State != wshrpc.RunQueueState_Waiting {
		t.Fatalf("a dirty hold lands by itself, so its dependent keeps waiting, got %q", dirty.State)
	}
	if got := w.createdGoals(); len(got) != 0 {
		t.Fatalf("started %v", got)
	}
}

// a hold is not the end of the line: the person lands the run later (Land again, wsh runs land --force), and the
// entries blocked on it carry on
func TestRunQueueEntryBlockedOnAHeldRunStartsOnceItLandsLater(t *testing.T) {
	w := useQueueWorld(t)
	w.setRun(&waveobj.Run{ID: "held", Goal: "Learned additions", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "held", Reason: "the final stage failed"}})
	queueEntry(t, "Alpha", "held")
	queueEntry(t, "Beta", "")
	w.maxActive = 0
	evaluateRunQueue(context.Background())

	// Beta is not behind a run and starts; Alpha is blocked on the held run and says which run unblocks it
	alpha := entryByTitle(t, queueEntries(t), "Alpha")
	if alpha.State != wshrpc.RunQueueState_Blocked || alpha.BlockedOn != "held" {
		t.Fatalf("an entry after a held run is blocked on that run: %q BlockedOn %q", alpha.State, alpha.BlockedOn)
	}
	if got := w.createdGoals(); !sameStrings(got, "Beta") {
		t.Fatalf("created %v, want only Beta", got)
	}

	// Land again puts the land back in line, then it resolves, then it lands: only the last carries Alpha on
	for _, state := range []string{"queued", "resolving"} {
		w.setRun(&waveobj.Run{ID: "held", Goal: "Learned additions", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: state}})
		evaluateRunQueue(context.Background())
		if alpha := entryByTitle(t, queueEntries(t), "Alpha"); alpha.State != wshrpc.RunQueueState_Blocked {
			t.Fatalf("a land that is %s has not landed, so Alpha stays blocked, got %q", state, alpha.State)
		}
	}
	if got := w.createdGoals(); len(got) != 1 {
		t.Fatalf("created %v before the run landed", got)
	}

	w.setRun(&waveobj.Run{ID: "held", Goal: "Learned additions", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "landed"}})
	published := w.publishCount()
	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); !sameStrings(got, "Beta", "Alpha") {
		t.Fatalf("created %v, want Alpha started in the same pass that unblocked it", got)
	}
	if left := queueEntries(t); len(left) != 0 {
		t.Fatalf("a started entry leaves the queue, got %v", entryTitles(left))
	}
	if w.publishCount() == published {
		t.Fatal("the unblock is published")
	}
}

func TestRunQueueUnblockedEntryStillWaitsForRoom(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 1
	w.setRun(&waveobj.Run{ID: "live", Status: jarvis.RunStatus_Executing})
	w.setRun(&waveobj.Run{ID: "held", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "held", Reason: "conflict"}})
	queueEntry(t, "Alpha", "held")
	evaluateRunQueue(context.Background())
	w.setRun(&waveobj.Run{ID: "held", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "landed"}})
	evaluateRunQueue(context.Background())

	alpha := entryByTitle(t, queueEntries(t), "Alpha")
	if alpha.State != wshrpc.RunQueueState_Waiting || alpha.Reason != "" || alpha.BlockedOn != "" {
		t.Fatalf("a landed run puts the entry back to waiting, with no block left on it: %+v", alpha)
	}
	if got := w.createdGoals(); len(got) != 0 {
		t.Fatalf("started %v past a full cap", got)
	}
}

// an entry whose own start failed is blocked for that, not for a run: its After having landed must not start it again
func TestRunQueueFailedStartIsNotUnblockedByTheAfterRun(t *testing.T) {
	w := useQueueWorld(t)
	w.createErr = errors.New("plan is gone")
	w.setRun(&waveobj.Run{ID: "r1", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "landed"}})
	queueEntry(t, "Alpha", "r1")
	for range 3 {
		evaluateRunQueue(context.Background())
	}
	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("create calls %v, want one: a failed start is not retried by the loop", got)
	}
	alpha := queueEntries(t)[0]
	if alpha.State != wshrpc.RunQueueState_Blocked || alpha.Reason != "plan is gone" || alpha.BlockedOn != "" {
		t.Fatalf("a failed start blocks the entry for its error, with no run to wait on: %+v", alpha)
	}
}

// the real source only reads runs that are not done, plus the ids it is asked for, and a landed run is done: the run an
// entry is blocked on must be asked for too, or it would never be seen to land
func TestRunQueueReadsTheRunAnEntryIsBlockedOn(t *testing.T) {
	w := useQueueWorld(t)
	w.setRun(&waveobj.Run{ID: "held", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "held", Reason: "conflict"}})
	queueEntry(t, "Alpha", "held")
	evaluateRunQueue(context.Background())

	var asked []string
	runQueueLoadRuns = func(ctx context.Context, afterIds []string) (map[string]*waveobj.Run, error) {
		asked = append(asked, afterIds...)
		return map[string]*waveobj.Run{}, nil
	}
	evaluateRunQueue(context.Background())
	if !slices.Contains(asked, "held") {
		t.Fatalf("asked for runs %v, want the run Alpha is blocked on", asked)
	}
}

func TestRunQueueStartNowStartsPastAFullCapAndAnUnlandedAfter(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 1
	w.setRun(&waveobj.Run{ID: "live", Status: jarvis.RunStatus_Executing})
	w.setRun(&waveobj.Run{ID: "r1", Status: jarvis.RunStatus_Executing})
	e := queueEntry(t, "Alpha", "r1")
	if err := runqueue.SetBlocked(e.Id, "something earlier", ""); err != nil {
		t.Fatal(err)
	}

	if err := (&WshServer{}).RunQueueStartNowCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: e.Id}); err != nil {
		t.Fatalf("StartNow: %v", err)
	}
	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("created %v, want Alpha started past the full cap, its After and its block", got)
	}
	if left := queueEntries(t); len(left) != 0 {
		t.Fatalf("a started entry leaves the queue, got %v", entryTitles(left))
	}
}

func TestRunQueueStartNowBlocksTheEntryThenReturnsTheError(t *testing.T) {
	w := useQueueWorld(t)
	w.createErr = errors.New("plan is gone")
	e := queueEntry(t, "Alpha", "")

	err := (&WshServer{}).RunQueueStartNowCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: e.Id})
	if err == nil || !strings.Contains(err.Error(), "plan is gone") {
		t.Fatalf("StartNow error = %v, want the create's", err)
	}
	left := queueEntries(t)
	if len(left) != 1 || left[0].State != wshrpc.RunQueueState_Blocked || left[0].Reason != "plan is gone" {
		t.Fatalf("the entry is blocked with the error before it is returned: %+v", left)
	}
	if last := w.lastPublished(); len(last) != 1 || last[0].State != wshrpc.RunQueueState_Blocked {
		t.Fatalf("the block is published: %v", last)
	}
}

func TestRunQueueStartPublishesWhichRunTheEntryBecame(t *testing.T) {
	w := useQueueWorld(t)
	e := queueEntry(t, "Alpha", "")
	evaluateRunQueue(context.Background())

	got := w.startedIn()
	if len(got) != 1 || got[0].EntryId != e.Id || got[0].RunId != w.runId(1) {
		t.Fatalf("want one started pair %s -> %s, got %+v", e.Id, w.runId(1), got)
	}
}

func TestRunQueueFailedStartPublishesNoStarted(t *testing.T) {
	w := useQueueWorld(t)
	w.createErr = errors.New("no worktree")
	queueEntry(t, "Alpha", "")
	evaluateRunQueue(context.Background())

	if got := w.startedIn(); len(got) != 0 {
		t.Fatalf("a failed start names no run, got %+v", got)
	}
	if w.publishCount() == 0 {
		t.Fatalf("the block is still published")
	}
}

func TestRunQueueStartCarriesARunAfterOntoTheRun(t *testing.T) {
	w := useQueueWorld(t)
	w.setRun(&waveobj.Run{ID: "r1", Goal: "Learned additions", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "landed"}})
	queueEntry(t, "Alpha", "r1")
	evaluateRunQueue(context.Background())

	if len(w.created) != 1 || w.created[0].AfterRunId != "r1" {
		t.Fatalf("the start carries AfterRunId r1, got %+v", w.created)
	}
}

func TestRunQueueStartNowPastAQueuedAfterCarriesNoAfterRun(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 0
	a := queueEntry(t, "Alpha", "")
	b := queueEntry(t, "Beta", a.Id)
	if err := (&WshServer{}).RunQueueStartNowCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: b.Id}); err != nil {
		t.Fatalf("StartNow(B): %v", err)
	}
	if len(w.created) != 1 || w.created[0].Goal != "Beta" || w.created[0].AfterRunId != "" {
		t.Fatalf("an After that still names an entry is no run to remember, got %+v", w.created)
	}
}

func TestRunQueueStartNowRefusesAnUnknownEntry(t *testing.T) {
	useQueueWorld(t)
	err := (&WshServer{}).RunQueueStartNowCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: "q-nope"})
	if err == nil || !strings.Contains(err.Error(), "q-nope") {
		t.Fatalf("StartNow of an unknown entry: %v", err)
	}
}

func TestRunQueueRunNextMovesAnEntryFirstAndMakesItWaiting(t *testing.T) {
	w := useQueueWorld(t)
	queueEntry(t, "Alpha", "")
	queueEntry(t, "Beta", "")
	gamma := queueEntry(t, "Gamma", "")
	if err := runqueue.SetBlocked(gamma.Id, "its create failed", ""); err != nil {
		t.Fatal(err)
	}
	drainRunQueuePoke()

	if err := (&WshServer{}).RunQueueRunNextCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: gamma.Id}); err != nil {
		t.Fatalf("RunNext: %v", err)
	}
	entries := queueEntries(t)
	if !sameStrings(entryTitles(entries), "Gamma", "Alpha", "Beta") {
		t.Fatalf("order = %v, want the moved entry first", entryTitles(entries))
	}
	if entries[0].State != wshrpc.RunQueueState_Waiting || entries[0].Reason != "" {
		t.Fatalf("a moved blocked entry waits again: %q %q", entries[0].State, entries[0].Reason)
	}
	if last := w.lastPublished(); !sameStrings(entryTitles(last), "Gamma", "Alpha", "Beta") {
		t.Fatalf("the new order is published: %v", entryTitles(last))
	}
	if len(runQueuePoke) != 1 {
		t.Fatal("a moved entry pokes the loop, since it may be ready now")
	}
	if err := (&WshServer{}).RunQueueRunNextCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: "q-nope"}); err == nil {
		t.Fatal("RunNext of an unknown entry succeeded")
	}
}

func TestRunQueueRemoveDropsTheEntryAndBlocksWhatWaitedOnIt(t *testing.T) {
	w := useQueueWorld(t)
	alpha := queueEntry(t, "Alpha", "")
	queueEntry(t, "Beta", alpha.Id)
	queueEntry(t, "Gamma", "")

	if err := (&WshServer{}).RunQueueRemoveCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: alpha.Id}); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	entries := queueEntries(t)
	if !sameStrings(entryTitles(entries), "Beta", "Gamma") {
		t.Fatalf("queue = %v", entryTitles(entries))
	}
	beta := entryByTitle(t, entries, "Beta")
	if beta.State != wshrpc.RunQueueState_Blocked || beta.Reason != "Alpha was removed" {
		t.Fatalf("an entry that waited on the removed one is blocked: %q %q", beta.State, beta.Reason)
	}
	if beta.BlockedOn != "" {
		t.Fatalf("a removed entry is not a run that can land later, got BlockedOn %q", beta.BlockedOn)
	}
	if gamma := entryByTitle(t, entries, "Gamma"); gamma.State != wshrpc.RunQueueState_Waiting {
		t.Fatalf("an unrelated entry is untouched, got %q", gamma.State)
	}
	if last := w.lastPublished(); !sameStrings(entryTitles(last), "Beta", "Gamma") {
		t.Fatalf("the removal is published with the whole list: %v", entryTitles(last))
	}
	// the generic reason the rules would give must not replace it at the next evaluation
	w.maxActive = 0
	evaluateRunQueue(context.Background())
	if beta := entryByTitle(t, queueEntries(t), "Beta"); beta.Reason != "Alpha was removed" {
		t.Fatalf("the reason did not survive an evaluation: %q", beta.Reason)
	}
	if err := (&WshServer{}).RunQueueRemoveCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: "q-nope"}); err == nil {
		t.Fatal("Remove of an unknown entry succeeded")
	}
}

func TestRunQueueEntryAfterAQueuedEntryFollowsItToItsRun(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 1
	alpha := queueEntry(t, "Alpha", "")
	queueEntry(t, "Beta", alpha.Id)
	evaluateRunQueue(context.Background())

	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("created %v, want Alpha only: Beta waits on it", got)
	}
	left := queueEntries(t)
	if len(left) != 1 || left[0].Title != "Beta" {
		t.Fatalf("queue = %v", entryTitles(left))
	}
	if left[0].After != w.runId(1) {
		t.Fatalf("Beta waits After %q, want the run Alpha became (%s)", left[0].After, w.runId(1))
	}
	if left[0].State != wshrpc.RunQueueState_Waiting {
		t.Fatalf("Beta is %q (%q): it waits on the run, it is not blocked", left[0].State, left[0].Reason)
	}
}

func TestRunQueueOneStartAtATime(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 0
	queueEntry(t, "Alpha", "")
	beta := queueEntry(t, "Beta", "")
	w.hold = make(chan struct{})
	w.entered = make(chan struct{}, 4)

	done := make(chan struct{})
	go func() {
		defer close(done)
		evaluateRunQueue(context.Background())
	}()
	select {
	case <-w.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the first start never began")
	}

	second := make(chan struct{})
	go func() {
		defer close(second)
		evaluateRunQueue(context.Background())
	}()
	select {
	case <-second:
	case <-time.After(2 * time.Second):
		t.Fatal("an evaluation during a start waited for it: it must return")
	}
	err := (&WshServer{}).RunQueueStartNowCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: beta.Id})
	if err == nil || !strings.Contains(err.Error(), "starting") {
		t.Fatalf("StartNow during another start: %v, want a refusal saying one is starting", err)
	}

	close(w.hold)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the evaluation did not finish")
	}
	if got := w.createdGoals(); !sameStrings(got, "Alpha", "Beta") {
		t.Fatalf("created %v: each entry starts once, in order, and the evaluation goes on to the next", got)
	}
}

func TestRunQueueEvaluationSurvivesAPanicAndFreesTheStartFlag(t *testing.T) {
	w := useQueueWorld(t)
	queueEntry(t, "Alpha", "")
	runQueueLoadRuns = func(context.Context, []string) (map[string]*waveobj.Run, error) { panic("boom") }
	safeEvaluateRunQueue(context.Background()) // must not panic out

	runQueueLoadRuns = func(context.Context, []string) (map[string]*waveobj.Run, error) {
		return map[string]*waveobj.Run{}, nil
	}
	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("created %v: a panicked evaluation must not leave the start flag set", got)
	}
}

func TestRunQueueDoesNotStartWhenTheRunsCannotBeRead(t *testing.T) {
	w := useQueueWorld(t)
	queueEntry(t, "Alpha", "")
	runQueueLoadRuns = func(context.Context, []string) (map[string]*waveobj.Run, error) { return nil, errors.New("db busy") }
	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); len(got) != 0 {
		t.Fatalf("started %v without knowing how many runs are active", got)
	}
	if e := queueEntries(t)[0]; e.State != wshrpc.RunQueueState_Waiting {
		t.Fatalf("an unreadable run list blocks nothing, got %q", e.State)
	}
}

func TestRunQueueLoopRunsAtStartOnAPokeAndOnTheTick(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	poke := make(chan struct{}, 1)
	evaluated := make(chan struct{}, 64)
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		runQueueLoop(ctx, poke, time.Hour, func(context.Context) { evaluated <- struct{}{} })
	}()
	wait := func(what string) {
		t.Helper()
		select {
		case <-evaluated:
		case <-time.After(2 * time.Second):
			t.Fatalf("no evaluation %s", what)
		}
	}
	wait("at start")
	poke <- struct{}{}
	wait("on a poke, with the tick an hour away")
	cancel()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("the loop did not stop with its context")
	}

	ticks := make(chan struct{}, 64)
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	go runQueueLoop(ctx2, make(chan struct{}), 5*time.Millisecond, func(context.Context) { ticks <- struct{}{} })
	for i := range 3 {
		select {
		case <-ticks:
		case <-time.After(2 * time.Second):
			t.Fatalf("the fallback tick fired %d times, want it to keep firing", i)
		}
	}
}

func TestPokeRunQueueNeverBlocksAndCoalesces(t *testing.T) {
	drainRunQueuePoke()
	t.Cleanup(drainRunQueuePoke)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range 50 {
			PokeRunQueue()
		}
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("PokeRunQueue blocked with no loop reading")
	}
	if n := len(runQueuePoke); n != 1 {
		t.Fatalf("%d pokes are waiting, want 1: a burst is one evaluation", n)
	}
}

func TestRunQueueListReportsTheCapAndTheActiveRuns(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 2
	w.setRun(&waveobj.Run{ID: "a", Status: jarvis.RunStatus_Executing})
	w.setRun(&waveobj.Run{ID: "b", Status: jarvis.RunStatus_Planning})
	w.setRun(&waveobj.Run{ID: "c", Status: jarvis.RunStatus_Done})
	w.setRun(&waveobj.Run{ID: "d", Status: jarvis.RunStatus_Executing, TaskId: "t"})
	queueEntry(t, "Alpha", "")

	rtn, err := (&WshServer{}).RunQueueListCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rtn.MaxActive != 2 || rtn.Active != 2 || len(rtn.Entries) != 1 || rtn.Entries[0].Title != "Alpha" {
		t.Fatalf("list = %+v, want cap 2, 2 active, the one entry", rtn)
	}
}

func TestRunQueueListIsNeverNull(t *testing.T) {
	useQueueWorld(t)
	rtn, err := (&WshServer{}).RunQueueListCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rtn.Entries == nil {
		t.Fatal("an empty queue lists as null, which the cockpit's model cannot read")
	}
}

// the real run source: every run not done or cancelled, plus the runs an entry waits After, finished or not
func TestLoadRunQueueRunsReadsTheActiveRunsAndTheAfterTargets(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "run-queue-load", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	live, target, other := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for id, status := range map[string]string{live: jarvis.RunStatus_Executing, target: jarvis.RunStatus_Done, other: jarvis.RunStatus_Done} {
		if err := wstore.AppendRun(ctx, ch.OID, waveobj.Run{ID: id, Status: status}); err != nil {
			t.Fatal(err)
		}
	}
	runs, err := loadRunQueueRuns(ctx, []string{target, "q-1234", uuid.NewString()})
	if err != nil {
		t.Fatal(err)
	}
	if runs[live] == nil || runs[target] == nil {
		t.Fatalf("want the live run and the After target, got %d runs", len(runs))
	}
	if runs[other] != nil {
		t.Fatal("a finished run nothing waits on is not read")
	}
}

// RunQueueAdd: the checks happen at queue time, against the real channel and runs
func TestRunQueueAdd(t *testing.T) {
	ctx := context.Background()
	const plan = "# Coupon codes\n\n### Task 1: input\nadd the field\n"
	newChannel := func(t *testing.T) *waveobj.Channel {
		t.Helper()
		ch, err := wstore.CreateChannel(ctx, "run-queue-add", t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		return ch
	}
	writePlan := func(t *testing.T, dir, name, src string) string {
		t.Helper()
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}
	add := func(ch *waveobj.Channel, data wshrpc.CommandCreateRunData, after string) (*wshrpc.RunQueueEntry, error) {
		data.ChannelId, data.WorkspaceId = ch.OID, "ws"
		return (&WshServer{}).RunQueueAddCommand(ctx, wshrpc.CommandRunQueueAddData{Data: data, After: after})
	}

	t.Run("queues a plan, named and placed by it, and publishes the list", func(t *testing.T) {
		w := useQueueWorld(t)
		ch := newChannel(t)
		path := writePlan(t, ch.ProjectPath, filepath.Join("docs", "plan.md"), plan)
		e, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: "docs/plan.md", OriginTabId: "tab-9"}, "")
		if err != nil {
			t.Fatal(err)
		}
		if e.Id == "" || e.State != wshrpc.RunQueueState_Waiting || e.Title != "Coupon codes" || e.ProjectPath != ch.ProjectPath {
			t.Fatalf("entry = %+v", e)
		}
		if e.Data.PlanPath != path || e.Data.OriginTabId != "tab-9" {
			t.Fatalf("the data kept is what a start sends, with the plan path absolute: %+v", e.Data)
		}
		if last := w.lastPublished(); len(last) != 1 || last[0].Id != e.Id {
			t.Fatalf("the add is published: %v", last)
		}
		if len(runQueuePoke) != 1 {
			t.Fatal("an added entry pokes the loop")
		}
	})

	t.Run("refuses a plan that cannot run, leaving the queue as it was", func(t *testing.T) {
		useQueueWorld(t)
		ch := newChannel(t)
		bad := writePlan(t, t.TempDir(), "prose.md", "just prose\n")
		good := writePlan(t, t.TempDir(), "plan.md", plan)
		cases := []struct {
			name    string
			data    wshrpc.CommandCreateRunData
			errPart string
		}{
			{"unparseable plan", wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: bad}, "no tasks"},
			{"relative path missing from the project", wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: "missing.md"}, "missing.md"},
			{"quick shape", wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Quick, PlanPath: good}, "orchestrator"},
			{"no goal and no plan", wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator}, "goal"},
		}
		for _, c := range cases {
			if _, err := add(ch, c.data, ""); err == nil || !strings.Contains(err.Error(), c.errPart) {
				t.Fatalf("%s: error %v should name %q", c.name, err, c.errPart)
			}
		}
		if _, err := (&WshServer{}).RunQueueAddCommand(ctx, wshrpc.CommandRunQueueAddData{Data: wshrpc.CommandCreateRunData{WorkspaceId: "ws", Mode: jarvis.RunMode_Orchestrator, PlanPath: good}}); err == nil {
			t.Fatal("an add with no channel succeeded")
		}
		if left := queueEntries(t); len(left) != 0 {
			t.Fatalf("a refused add left %v in the queue", entryTitles(left))
		}
	})

	t.Run("refuses an After that names neither a run nor a queued entry", func(t *testing.T) {
		useQueueWorld(t)
		ch := newChannel(t)
		path := writePlan(t, t.TempDir(), "plan.md", plan)
		_, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: path}, "no-such-run")
		if err == nil || !strings.Contains(err.Error(), "no-such-run") {
			t.Fatalf("error = %v, want it to name the unknown After", err)
		}
		if left := queueEntries(t); len(left) != 0 {
			t.Fatalf("a refused add left %v in the queue", entryTitles(left))
		}
	})

	t.Run("expands an After run's id prefix to the full id", func(t *testing.T) {
		useQueueWorld(t)
		ch := newChannel(t)
		path := writePlan(t, t.TempDir(), "plan.md", plan)
		runId := uuid.NewString()
		if err := wstore.AppendRun(ctx, ch.OID, waveobj.Run{ID: runId, Status: jarvis.RunStatus_Done}); err != nil {
			t.Fatal(err)
		}
		for _, given := range []string{runId, runId[:8]} {
			e, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: path}, given)
			if err != nil {
				t.Fatalf("After %q: %v", given, err)
			}
			if e.After != runId {
				t.Fatalf("After %q stored as %q, want the full id %q", given, e.After, runId)
			}
		}
	})

	t.Run("refuses an ambiguous run id prefix", func(t *testing.T) {
		useQueueWorld(t)
		ch := newChannel(t)
		path := writePlan(t, t.TempDir(), "plan.md", plan)
		prefix := "ambig-" + uuid.NewString()[:8]
		for _, suffix := range []string{"-1", "-2"} {
			if err := wstore.AppendRun(ctx, ch.OID, waveobj.Run{ID: prefix + suffix, Status: jarvis.RunStatus_Done}); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: path}, prefix); err == nil || !strings.Contains(err.Error(), "matches") {
			t.Fatalf("error = %v, want an ambiguous-prefix refusal", err)
		}
	})

	t.Run("expands a queued entry's id prefix, so two plans chain before either has a run", func(t *testing.T) {
		useQueueWorld(t)
		ch := newChannel(t)
		path := writePlan(t, t.TempDir(), "plan.md", plan)
		first, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: path}, "")
		if err != nil {
			t.Fatal(err)
		}
		second, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: path}, first.Id[:5])
		if err != nil {
			t.Fatal(err)
		}
		if second.After != first.Id {
			t.Fatalf("After stored as %q, want the entry's full id %q", second.After, first.Id)
		}
	})

	t.Run("a goal with the plan names the entry as it will name the run", func(t *testing.T) {
		useQueueWorld(t)
		ch := newChannel(t)
		path := writePlan(t, t.TempDir(), "plan.md", plan)
		e, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: path, Goal: "coupons, first cut"}, "")
		if err != nil {
			t.Fatal(err)
		}
		if e.Title != "coupons, first cut" {
			t.Fatalf("title = %q", e.Title)
		}
	})

	t.Run("queues a goal with no plan", func(t *testing.T) {
		useQueueWorld(t)
		ch := newChannel(t)
		e, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Quick, Goal: "fix the flaky test"}, "")
		if err != nil {
			t.Fatal(err)
		}
		if e.Title != "fix the flaky test" || e.Data.PlanPath != "" {
			t.Fatalf("entry = %+v", e)
		}
	})
}

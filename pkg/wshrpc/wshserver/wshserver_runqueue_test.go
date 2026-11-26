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
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
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
	// the re-check reads the store and git; the tests of the queue's own rules want none of it (useStartWorld puts it back)
	swap(t, &runQueueRecheck, func(context.Context, wshrpc.RunQueueEntry) ([]string, string, error) { return nil, "", nil })
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

// queueEntry adds an entry as the command would have, with a title that doubles as the goal the fake create sees. It
// waits After the ids given; an empty id is no After.
func queueEntry(t *testing.T, title string, after ...string) wshrpc.RunQueueEntry {
	t.Helper()
	var afterIds []string
	for _, a := range after {
		if a != "" {
			afterIds = append(afterIds, a)
		}
	}
	e, err := runqueue.Add(wshrpc.RunQueueEntry{
		Title:       title,
		ProjectPath: "/proj",
		After:       afterIds,
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

// an entry after two runs starts only once both have landed
func TestRunQueueEntryAfterTwoRunsStartsOnceBothLanded(t *testing.T) {
	w := useQueueWorld(t)
	w.setRun(&waveobj.Run{ID: "r1", Goal: "First", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "landed"}})
	w.setRun(&waveobj.Run{ID: "r2", Goal: "Second", Status: jarvis.RunStatus_Executing})
	queueEntry(t, "Alpha", "r1", "r2")

	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); len(got) != 0 {
		t.Fatalf("started %v while its second After run is still going", got)
	}
	if e := queueEntries(t)[0]; e.State != wshrpc.RunQueueState_Waiting {
		t.Fatalf("an entry waiting on a running run keeps waiting, got %q", e.State)
	}

	w.setRun(&waveobj.Run{ID: "r2", Goal: "Second", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "landed"}})
	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("created %v, want Alpha once both After runs landed", got)
	}
	// the run keeps one id: the first run the entry waited for
	if w.created[0].AfterRunId != "r1" {
		t.Fatalf("AfterRunId = %q, want r1", w.created[0].AfterRunId)
	}
}

// any one of the runs ending held blocks the entry, on that run, and it carries on when that run lands later
func TestRunQueueEntryAfterTwoRunsIsBlockedWhenTheSecondEndsHeld(t *testing.T) {
	w := useQueueWorld(t)
	w.setRun(&waveobj.Run{ID: "r1", Goal: "First", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "landed"}})
	w.setRun(&waveobj.Run{ID: "r2", Goal: "Second", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "held", Reason: "merge conflict"}})
	queueEntry(t, "Alpha", "r1", "r2")

	evaluateRunQueue(context.Background())
	alpha := queueEntries(t)[0]
	if alpha.State != wshrpc.RunQueueState_Blocked || alpha.BlockedOn != "r2" || !strings.Contains(alpha.Reason, "Second was held") {
		t.Fatalf("an entry after a held run is blocked on it, naming it: %+v", alpha)
	}
	if got := w.createdGoals(); len(got) != 0 {
		t.Fatalf("started %v", got)
	}

	w.setRun(&waveobj.Run{ID: "r2", Goal: "Second", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: "landed"}})
	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("created %v, want Alpha once the held run landed later", got)
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

// an After list that starts with a queue entry still carries the first run id it holds
func TestRunQueueStartNowCarriesTheFirstRunOfTheListNotAQueueEntry(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 0
	a := queueEntry(t, "Alpha", "")
	b := queueEntry(t, "Beta", a.Id, "r1", "r2")
	if err := (&WshServer{}).RunQueueStartNowCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: b.Id}); err != nil {
		t.Fatalf("StartNow(B): %v", err)
	}
	if len(w.created) != 1 || w.created[0].AfterRunId != "r1" {
		t.Fatalf("want AfterRunId r1, the first After that is no queue entry, got %+v", w.created)
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

// an entry that waited on the removed one and on a run is blocked all the same: it can never start by waiting
func TestRunQueueRemoveBlocksAnEntryThatWaitsOnTheRemovedOneAndARun(t *testing.T) {
	useQueueWorld(t)
	alpha := queueEntry(t, "Alpha", "")
	queueEntry(t, "Beta", alpha.Id, "r1")
	queueEntry(t, "Gamma", "r1")

	if err := (&WshServer{}).RunQueueRemoveCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: alpha.Id}); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	entries := queueEntries(t)
	beta := entryByTitle(t, entries, "Beta")
	if beta.State != wshrpc.RunQueueState_Blocked || beta.Reason != "Alpha was removed" || beta.BlockedOn != "" {
		t.Fatalf("an entry whose list held the removed one is blocked: %+v", beta)
	}
	if gamma := entryByTitle(t, entries, "Gamma"); gamma.State != wshrpc.RunQueueState_Waiting {
		t.Fatalf("an entry that waits only on the run is untouched, got %q", gamma.State)
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
	if !sameStrings(left[0].After, w.runId(1)) {
		t.Fatalf("Beta waits After %q, want the run Alpha became (%s)", left[0].After, w.runId(1))
	}
	if left[0].State != wshrpc.RunQueueState_Waiting {
		t.Fatalf("Beta is %q (%q): it waits on the run, it is not blocked", left[0].State, left[0].Reason)
	}
}

// an entry that waits on a queue entry and on a run follows the entry to its run and keeps waiting on the other run
func TestRunQueueEntryAfterAQueuedEntryAndARunFollowsOnlyTheEntry(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 1
	w.setRun(&waveobj.Run{ID: "r9", Goal: "Learned additions", Status: jarvis.RunStatus_Executing, ParentLeadORef: "lead"}) // a child: no cap
	alpha := queueEntry(t, "Alpha", "")
	queueEntry(t, "Beta", "r9", alpha.Id)
	evaluateRunQueue(context.Background())

	left := queueEntries(t)
	if len(left) != 1 || left[0].Title != "Beta" || !sameStrings(left[0].After, "r9", w.runId(1)) {
		t.Fatalf("Beta waits After r9 and the run Alpha became (%s), got %+v", w.runId(1), left)
	}
}

// the loop must read every run of every After list, or a landed run (done, so not listed) would never be seen
func TestRunQueueReadsEveryRunAnEntryWaitsAfter(t *testing.T) {
	useQueueWorld(t)
	queueEntry(t, "Alpha", "r1", "r2")
	queueEntry(t, "Beta", "r3")

	var asked []string
	runQueueLoadRuns = func(ctx context.Context, afterIds []string) (map[string]*waveobj.Run, error) {
		asked = append(asked, afterIds...)
		return map[string]*waveobj.Run{}, nil
	}
	evaluateRunQueue(context.Background())
	for _, id := range []string{"r1", "r2", "r3"} {
		if !slices.Contains(asked, id) {
			t.Fatalf("asked for runs %v, want %s too", asked, id)
		}
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

// storePausedRun stores a paused top-level run in a fresh channel and returns its id. The pause freezes a run's agents,
// not its place: it still counts against runs:maxactive.
func storePausedRun(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "run-queue-paused", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.NewString()
	paused := waveobj.Run{ID: id, Status: jarvis.RunStatus_Paused, Pause: &waveobj.RunPause{PausedTs: time.Now().UnixMilli(), By: "manual"}}
	if err := wstore.AppendRun(ctx, ch.OID, paused); err != nil {
		t.Fatal(err)
	}
	return id
}

// the spec's "The run queue": a paused run still counts as active, so the queue starts nothing in its place. This runs
// the real run source, narrowed to the paused run: the shared test db holds other tests' runs, which would fill the cap
// on their own and hide a loader that skips paused runs.
func TestRunQueueCountsAPausedRunAgainstTheCap(t *testing.T) {
	w := useQueueWorld(t)
	w.maxActive = 1
	pausedId := storePausedRun(t)
	runQueueLoadRuns = func(ctx context.Context, afterIds []string) (map[string]*waveobj.Run, error) {
		runs, err := loadRunQueueRuns(ctx, afterIds)
		if err != nil {
			return nil, err
		}
		only := map[string]*waveobj.Run{}
		if r := runs[pausedId]; r != nil {
			only[pausedId] = r
		}
		return only, nil
	}
	if runs, _ := runQueueLoadRuns(context.Background(), nil); runs[pausedId] == nil {
		t.Fatal("the run source does not read a paused run, so it never counts against the cap")
	}
	queueEntry(t, "Alpha", "")
	evaluateRunQueue(context.Background())
	if got := w.createdGoals(); len(got) != 0 {
		t.Fatalf("created %v: a paused run holds the only slot, so the queue starts nothing", got)
	}
	if left := queueEntries(t); len(left) != 1 {
		t.Fatalf("%d entries left, want the one still waiting", len(left))
	}
}

// --after names a paused run by a unique prefix of its id, as it does a run in any other status
func TestResolveQueueAfterFindsAPausedRunByPrefix(t *testing.T) {
	pausedId := storePausedRun(t)
	got, err := resolveQueueAfter(context.Background(), pausedId[:8])
	if err != nil {
		t.Fatal(err)
	}
	if got != pausedId {
		t.Fatalf("a prefix of the paused run %s resolved to %q", pausedId, got)
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
	// after is what --after was given: an empty one is no After, as the command treats it
	add := func(ch *waveobj.Channel, data wshrpc.CommandCreateRunData, after ...string) (*wshrpc.RunQueueEntry, error) {
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
			if !sameStrings(e.After, runId) {
				t.Fatalf("After %q stored as %q, want the full id %q", given, e.After, runId)
			}
		}
	})

	t.Run("resolves each of several Afters, drops a repeat and an empty one, and keeps the order given", func(t *testing.T) {
		useQueueWorld(t)
		ch := newChannel(t)
		path := writePlan(t, t.TempDir(), "plan.md", plan)
		first, second := uuid.NewString(), uuid.NewString()
		for _, id := range []string{first, second} {
			if err := wstore.AppendRun(ctx, ch.OID, waveobj.Run{ID: id, Status: jarvis.RunStatus_Done}); err != nil {
				t.Fatal(err)
			}
		}
		queued, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: path}, "")
		if err != nil {
			t.Fatal(err)
		}
		// a run by its prefix, the same run in full, an empty one, a queued entry by its prefix, then another run
		e, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: path}, first[:8], first, "", queued.Id[:5], second)
		if err != nil {
			t.Fatal(err)
		}
		if want := []string{first, queued.Id, second}; !sameStrings(e.After, want...) {
			t.Fatalf("After stored as %q, want %q", e.After, want)
		}
		stored, err := runqueue.Resolve(e.Id)
		if err != nil {
			t.Fatal(err)
		}
		if !sameStrings(stored.After, first, queued.Id, second) {
			t.Fatalf("the file holds After %q", stored.After)
		}
	})

	t.Run("refuses the whole add when one of several Afters is unknown", func(t *testing.T) {
		useQueueWorld(t)
		ch := newChannel(t)
		path := writePlan(t, t.TempDir(), "plan.md", plan)
		runId := uuid.NewString()
		if err := wstore.AppendRun(ctx, ch.OID, waveobj.Run{ID: runId, Status: jarvis.RunStatus_Done}); err != nil {
			t.Fatal(err)
		}
		_, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Orchestrator, PlanPath: path}, runId, "no-such-run")
		if err == nil || !strings.Contains(err.Error(), "no-such-run") {
			t.Fatalf("error = %v, want it to name the unknown After", err)
		}
		if left := queueEntries(t); len(left) != 0 {
			t.Fatalf("a refused add left %v in the queue", entryTitles(left))
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
		if !sameStrings(second.After, first.Id) {
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

	t.Run("keeps the brainstorm an Approve queued it for, in the entry and in the file", func(t *testing.T) {
		w := useQueueWorld(t)
		ch := newChannel(t)
		bs := &wshrpc.RunQueueBrainstorm{Tab: "tab-bs", Path: filepath.ToSlash(filepath.Join(ch.ProjectPath, ".superpowers", "brainstorm", "coupons", "brainstorm.json"))}
		data := wshrpc.CommandCreateRunData{ChannelId: ch.OID, WorkspaceId: "ws", Mode: jarvis.RunMode_Quick, Goal: "build the coupons spec", SpecPath: "C:/p/spec.md"}
		e, err := (&WshServer{}).RunQueueAddCommand(ctx, wshrpc.CommandRunQueueAddData{Data: data, Brainstorm: bs})
		if err != nil {
			t.Fatal(err)
		}
		if e.Brainstorm == nil || *e.Brainstorm != *bs {
			t.Fatalf("the returned entry's brainstorm = %+v, want %+v", e.Brainstorm, bs)
		}
		if e.Data.SpecPath != "C:/p/spec.md" {
			t.Fatalf("the data the entry keeps carries the spec path a start would: %+v", e.Data)
		}
		stored := entryByTitle(t, queueEntries(t), "build the coupons spec")
		if stored.Brainstorm == nil || *stored.Brainstorm != *bs {
			t.Fatalf("the stored entry's brainstorm = %+v, want %+v", stored.Brainstorm, bs)
		}
		if last := w.lastPublished(); len(last) != 1 || last[0].Brainstorm == nil || last[0].Brainstorm.Path != bs.Path {
			t.Fatalf("the published list carries the brainstorm: %+v", last)
		}
	})

	t.Run("an entry queued with no brainstorm has none", func(t *testing.T) {
		useQueueWorld(t)
		ch := newChannel(t)
		e, err := add(ch, wshrpc.CommandCreateRunData{Mode: jarvis.RunMode_Quick, Goal: "plain start"}, "")
		if err != nil {
			t.Fatal(err)
		}
		if e.Brainstorm != nil {
			t.Fatalf("brainstorm = %+v, want none", e.Brainstorm)
		}
	})
}

// a run created with a SpecPath keeps it, so the next launcher's overlap check can read the spec the run was started
// from (spec 2026-11-16-run-start-choice-design.md, "Wire")
func TestCreateRunSpecPath(t *testing.T) {
	ctx := context.Background()
	const spec = "C:/p/docs/superpowers/specs/2026-11-16-coupons-design.md"
	// the goal differs per call: the vault keeps one dossier per goal, and a second run with the same goal logs a failed capture
	create := func(t *testing.T, goal, specPath string) (string, *wshrpc.CommandCreateRunRtnData) {
		t.Helper()
		stubRunServer(t, "pi", nil)
		ch, err := wstore.CreateChannel(ctx, "createrun-specpath", t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
			ChannelId: ch.OID, WorkspaceId: "ws", Goal: goal, Runtime: "pi", Mode: jarvis.RunMode_Quick, DeferStart: true, SpecPath: specPath,
		})
		if err != nil {
			t.Fatal(err)
		}
		return ch.OID, rtn
	}

	t.Run("the run keeps the spec path it was started with, returned and stored", func(t *testing.T) {
		channelId, rtn := create(t, "build the coupons spec", spec)
		if rtn.Run.SpecPath != spec {
			t.Fatalf("returned spec path = %q, want %q", rtn.Run.SpecPath, spec)
		}
		runs, err := wstore.GetChannelRuns(ctx, channelId)
		if err != nil || len(runs) != 1 || runs[0].SpecPath != spec {
			t.Fatalf("stored runs = %+v, %v; want one run with the spec path", runs, err)
		}
	})

	t.Run("a start with no spec leaves the run's empty", func(t *testing.T) {
		_, rtn := create(t, "start with no spec", "")
		if rtn.Run.SpecPath != "" {
			t.Fatalf("spec path = %q, want none", rtn.Run.SpecPath)
		}
	})
}

// ---- the re-check when an entry's turn comes (spec 2026-11-16-run-start-choice-design.md) ----

// recheckEntry queues an orchestrator start by goal alone in the world's project, so the re-check has the goal's files
// to compare and no plan file to read.
func recheckEntry(t *testing.T, w *startWorld, goal string, edit func(*wshrpc.RunQueueEntry)) wshrpc.RunQueueEntry {
	t.Helper()
	e := wshrpc.RunQueueEntry{
		Title: goal, ProjectPath: w.proj,
		Data: wshrpc.CommandCreateRunData{ChannelId: "ch-queue", WorkspaceId: "ws", Goal: goal, Mode: jarvis.RunMode_Orchestrator, OriginTabId: "tab-1"},
	}
	if edit != nil {
		edit(&e)
	}
	added, err := runqueue.Add(e)
	if err != nil {
		t.Fatalf("Add(%s): %v", goal, err)
	}
	return added
}

func TestRunQueueRecheckHoldsAnEntryForALaterRunThatSharesAFileAndStartsTheOneBehindIt(t *testing.T) {
	w := useStartWorld(t)
	alpha := recheckEntry(t, w, "Rework land.go", nil)
	recheckEntry(t, w, "Polish the Brief", nil) // names no file
	later := w.addRun(101, "Fix the merge in land.go", func(r *waveobj.Run) { r.CreatedTs = alpha.QueuedTs + 1000 })

	evaluateRunQueue(context.Background())

	if got := w.q.createdGoals(); !sameStrings(got, "Polish the Brief") {
		t.Fatalf("created %v, want only the entry behind the held one, in the same evaluation", got)
	}
	entries := queueEntries(t)
	if len(entries) != 1 {
		t.Fatalf("queue = %v, want the held entry alone", entryTitles(entries))
	}
	held := entries[0]
	if held.Id != alpha.Id || held.State != wshrpc.RunQueueState_Waiting || !sameStrings(held.After, later.ID) {
		t.Errorf("held entry = %+v, want it waiting After the later run", held)
	}
	if want := "Waiting for Fix the merge in land.go too: both edit land.go"; held.Reason != want {
		t.Errorf("reason = %q, want %q", held.Reason, want)
	}
	if pub := w.q.lastPublished(); len(pub) != 1 || pub[0].Id != alpha.Id || !sameStrings(pub[0].After, later.ID) {
		t.Errorf("last published queue = %+v, want the held entry with its new After", pub)
	}
}

func TestRunQueueRecheckKeepsEvaluatingWhileItHoldsEntriesSoEveryReadyEntryBehindThemStarts(t *testing.T) {
	w := useStartWorld(t)
	first := recheckEntry(t, w, "Rework land.go", nil)
	recheckEntry(t, w, "Also rework land.go", nil)
	recheckEntry(t, w, "Polish the Brief", nil)
	later := w.addRun(101, "Fix the merge in land.go", func(r *waveobj.Run) { r.CreatedTs = first.QueuedTs + 1000 })

	evaluateRunQueue(context.Background())

	if got := w.q.createdGoals(); !sameStrings(got, "Polish the Brief") {
		t.Fatalf("created %v, want the third entry to start after the first two were held, in the one evaluation", got)
	}
	entries := queueEntries(t)
	if got := entryTitles(entries); !sameStrings(got, "Rework land.go", "Also rework land.go") {
		t.Fatalf("queue = %v, want both held entries kept in order", got)
	}
	for _, e := range entries {
		if !sameStrings(e.After, later.ID) || e.Reason == "" {
			t.Errorf("%s = %+v, want it After the later run with a reason", e.Title, e)
		}
	}
}

func TestRunQueueRecheckIgnoresARunOlderThanTheEntry(t *testing.T) {
	w := useStartWorld(t)
	alpha := recheckEntry(t, w, "Rework land.go", nil)
	// the person saw this run when they queued, and passed over it
	w.addRun(101, "Fix the merge in land.go", func(r *waveobj.Run) { r.CreatedTs = alpha.QueuedTs - 1000 })

	evaluateRunQueue(context.Background())

	if got := w.q.createdGoals(); !sameStrings(got, "Rework land.go") {
		t.Fatalf("created %v, want the entry started: an older run is never added back", got)
	}
}

func TestRunQueueRecheckIgnoresAHeldRunAndAnotherProjectsRun(t *testing.T) {
	w := useStartWorld(t)
	alpha := recheckEntry(t, w, "Rework land.go", nil)
	w.addRun(101, "Fix the merge in land.go", func(r *waveobj.Run) {
		r.CreatedTs = alpha.QueuedTs + 1000
		r.Status = jarvis.RunStatus_Done
		r.Land = &waveobj.RunLand{State: orchestrate.LandState_Held, Reason: "conflict"}
	})
	w.addRun(102, "Fix the merge in land.go", func(r *waveobj.Run) { r.CreatedTs = alpha.QueuedTs + 1000; r.ProjectPath = w.proj + "-other" })

	evaluateRunQueue(context.Background())

	if got := w.q.createdGoals(); !sameStrings(got, "Rework land.go") {
		t.Fatalf("created %v, want the entry started: a held run would block it at once, and another project's cannot conflict", got)
	}
}

func TestRunQueueRecheckStartNowStartsTheEntryAnyway(t *testing.T) {
	w := useStartWorld(t)
	alpha := recheckEntry(t, w, "Rework land.go", nil)
	w.addRun(101, "Fix the merge in land.go", func(r *waveobj.Run) { r.CreatedTs = alpha.QueuedTs + 1000 })

	if err := (&WshServer{}).RunQueueStartNowCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: alpha.Id}); err != nil {
		t.Fatal(err)
	}
	if got := w.q.createdGoals(); !sameStrings(got, "Rework land.go") {
		t.Fatalf("created %v, want Start now to skip the re-check", got)
	}
	if len(queueEntries(t)) != 0 {
		t.Errorf("queue = %v, want the started entry gone", entryTitles(queueEntries(t)))
	}
}

func TestRunQueueRecheckStartsAHeldEntryOnceTheRunItWaitsForHasLanded(t *testing.T) {
	w := useStartWorld(t)
	alpha := recheckEntry(t, w, "Rework land.go", nil)
	later := w.addRun(101, "Fix the merge in land.go", func(r *waveobj.Run) { r.CreatedTs = alpha.QueuedTs + 1000 })

	evaluateRunQueue(context.Background())
	if got := w.q.createdGoals(); len(got) != 0 {
		t.Fatalf("created %v, want the entry held first", got)
	}
	later.Status = jarvis.RunStatus_Done
	later.Land = &waveobj.RunLand{State: orchestrate.LandState_Landed}
	w.q.setRun(later)

	evaluateRunQueue(context.Background())
	if got := w.q.createdGoals(); !sameStrings(got, "Rework land.go") {
		t.Fatalf("created %v, want the entry started once the run landed", got)
	}
	if len(queueEntries(t)) != 0 {
		t.Errorf("queue = %v, want it empty", entryTitles(queueEntries(t)))
	}
}

func TestRunQueueRecheckRunsOnlyForTheEntryWhoseTurnItIs(t *testing.T) {
	w := useStartWorld(t)
	var mu sync.Mutex
	var checked []string
	real := recheckQueuedEntry
	swap(t, &runQueueRecheck, func(ctx context.Context, e wshrpc.RunQueueEntry) ([]string, string, error) {
		mu.Lock()
		checked = append(checked, e.Title)
		mu.Unlock()
		return real(ctx, e)
	})
	running := w.addRun(101, "A run still going", nil)
	recheckEntry(t, w, "Waits for the run", func(e *wshrpc.RunQueueEntry) { e.After = []string{running.ID} })
	recheckEntry(t, w, "Ready now", nil)

	evaluateRunQueue(context.Background())

	mu.Lock()
	defer mu.Unlock()
	if !sameStrings(checked, "Ready now") {
		t.Errorf("re-checked %v, want only the entry whose turn it was: one still waiting on its After has no turn", checked)
	}
}

func TestRunQueueRecheckReadsTheEntrysSpecAtItsTurn(t *testing.T) {
	w := useStartWorld(t)
	spec := w.writeFile(t, "docs/specs/s.md", "Nothing about any file yet.")
	alpha := recheckEntry(t, w, "Build the spec", func(e *wshrpc.RunQueueEntry) { e.Data.SpecPath = spec })
	w.addRun(101, "Fix the merge in land.go", func(r *waveobj.Run) { r.CreatedTs = alpha.QueuedTs + 1000 })
	// the spec is edited after the entry was queued: what gets built is the spec as it is then
	w.writeFile(t, "docs/specs/s.md", "Now it reworks land.go.")

	evaluateRunQueue(context.Background())

	if got := w.q.createdGoals(); len(got) != 0 {
		t.Fatalf("created %v, want the entry held by a file its spec names now", got)
	}
}

func TestRunQueueRecheckThatFailsLetsTheEntryStart(t *testing.T) {
	w := useStartWorld(t)
	recheckEntry(t, w, "Rework land.go", nil)
	swap(t, &runQueueRecheck, func(context.Context, wshrpc.RunQueueEntry) ([]string, string, error) {
		return nil, "", errors.New("the store is busy")
	})

	evaluateRunQueue(context.Background())

	if got := w.q.createdGoals(); !sameStrings(got, "Rework land.go") {
		t.Fatalf("created %v, want the check to be advice and never a gate", got)
	}
}

func TestRunQueueRecheckWithUnreadableSpecLetsTheEntryStart(t *testing.T) {
	w := useStartWorld(t)
	recheckEntry(t, w, "Build the spec", func(e *wshrpc.RunQueueEntry) { e.Data.SpecPath = w.proj + "/gone.md" })

	evaluateRunQueue(context.Background())

	if got := w.q.createdGoals(); !sameStrings(got, "Build the spec") {
		t.Fatalf("created %v, want the entry started: a spec that cannot be read only costs the check", got)
	}
}

func TestRunQueueRecheckAddingNothingNewLetsTheEntryStart(t *testing.T) {
	w := useQueueWorld(t)
	e := queueEntry(t, "Alpha", "")
	// the entry already waits on run-x, which landed: a re-check naming it again has nothing to add
	if err := runqueue.WaitAlsoOn(e.Id, []string{"run-x"}, "waits"); err != nil {
		t.Fatal(err)
	}
	w.setRun(&waveobj.Run{ID: "run-x", Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: orchestrate.LandState_Landed}})
	swap(t, &runQueueRecheck, func(context.Context, wshrpc.RunQueueEntry) ([]string, string, error) {
		return []string{"run-x"}, "Waiting for X too", nil
	})

	evaluateRunQueue(context.Background())

	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("created %v, want the entry started: a run it already waited on is nothing to hold it for", got)
	}
}

func TestRunQueueRecheckPassesAreBoundedByTheQueue(t *testing.T) {
	w := useQueueWorld(t)
	queueEntry(t, "Alpha", "")
	var mu sync.Mutex
	calls := 0
	// a re-check that always finds a new, already landed run to add: the entry is ready again after every pass, so only
	// the bound ends the evaluation
	swap(t, &runQueueRecheck, func(context.Context, wshrpc.RunQueueEntry) ([]string, string, error) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		id := fmt.Sprintf("%slanded-%d", w.prefix, calls)
		w.setRun(&waveobj.Run{ID: id, Status: jarvis.RunStatus_Done, Land: &waveobj.RunLand{State: orchestrate.LandState_Landed}})
		return []string{id}, "Waiting for another too", nil
	})

	evaluateRunQueue(context.Background())

	mu.Lock()
	defer mu.Unlock()
	if calls < 1 || calls > 3 {
		t.Errorf("the re-check ran %d times for a one-entry queue, want the passes bounded by its length", calls)
	}
	if got := w.createdGoals(); len(got) != 0 {
		t.Errorf("created %v, want nothing started from a pass whose answer was never settled", got)
	}
}

// ---- telling a queued brainstorm its run ----

// brainstormWorld scripts the agents the notice reaches and records the sleep it arms.
type brainstormWorld struct {
	sent  *[]agentsDelivery
	mu    sync.Mutex
	armed []wshrpc.CommandAgentsSleepAfterRunData
	// the deliveries made when each arm happened: arming comes first, so the agent's sleep is set before its notice
	sentAtArm []int
	armErr    error
}

func useBrainstormWorld(t *testing.T) (*queueWorld, *brainstormWorld) {
	t.Helper()
	w := useQueueWorld(t)
	b := &brainstormWorld{sent: scriptAgents(t, threeAgents())}
	swap(t, &runQueueGo, func(f func()) { f() })
	swap(t, &armBrainstormSleep, func(_ context.Context, d wshrpc.CommandAgentsSleepAfterRunData) error {
		b.mu.Lock()
		defer b.mu.Unlock()
		b.armed = append(b.armed, d)
		b.sentAtArm = append(b.sentAtArm, len(*b.sent))
		return b.armErr
	})
	return w, b
}

func brainstormEntry(t *testing.T, title, tab string) wshrpc.RunQueueEntry {
	t.Helper()
	e, err := runqueue.Add(wshrpc.RunQueueEntry{
		Title: title, ProjectPath: "/proj",
		Data:       wshrpc.CommandCreateRunData{ChannelId: "ch-queue", WorkspaceId: "ws", Goal: title, Mode: jarvis.RunMode_Orchestrator},
		Brainstorm: &wshrpc.RunQueueBrainstorm{Tab: tab, Path: "C:/p/.superpowers/brainstorm/topic/brainstorm.json"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func TestRunQueueBrainstormStartedEntryTellsItsAgentItsRun(t *testing.T) {
	w, b := useBrainstormWorld(t)
	brainstormEntry(t, "Build the coupons", agentsTabB)

	evaluateRunQueue(context.Background())

	runId := w.runId(1)
	if got := w.createdGoals(); !sameStrings(got, "Build the coupons") {
		t.Fatalf("created %v", got)
	}
	if len(*b.sent) != 1 || (*b.sent)[0].blockId != agentsBlockB || (*b.sent)[0].text != "brainstorm: run "+runId {
		t.Fatalf("deliveries = %+v, want `brainstorm: run %s` to the brainstorm agent's block", *b.sent, runId)
	}
	if len(b.armed) != 1 || b.armed[0].Tab != agentsTabB || b.armed[0].RunId != runId || b.armed[0].Path != "C:/p/.superpowers/brainstorm/topic/brainstorm.json" {
		t.Errorf("armed = %+v, want the agent's sleep armed for the new run with the brainstorm.json", b.armed)
	}
	if len(b.sentAtArm) != 1 || b.sentAtArm[0] != 0 {
		t.Errorf("deliveries at the arm = %v, want the sleep armed before the notice goes out", b.sentAtArm)
	}
	assertNoSendBackLock(t)
}

func TestRunQueueBrainstormEntryWithNoBrainstormTellsNobody(t *testing.T) {
	w, b := useBrainstormWorld(t)
	queueEntry(t, "Alpha", "")

	evaluateRunQueue(context.Background())

	if got := w.createdGoals(); !sameStrings(got, "Alpha") {
		t.Fatalf("created %v", got)
	}
	if len(*b.sent) != 0 || len(b.armed) != 0 {
		t.Errorf("deliveries = %+v, armed = %+v, want nothing for an entry that is no brainstorm's", *b.sent, b.armed)
	}
}

func TestRunQueueBrainstormStartNowTellsItsAgentToo(t *testing.T) {
	w, b := useBrainstormWorld(t)
	e := brainstormEntry(t, "Build the coupons", agentsTabB)

	if err := (&WshServer{}).RunQueueStartNowCommand(context.Background(), wshrpc.CommandRunQueueIdData{Id: e.Id}); err != nil {
		t.Fatal(err)
	}
	if len(*b.sent) != 1 || (*b.sent)[0].text != "brainstorm: run "+w.runId(1) {
		t.Fatalf("deliveries = %+v, want the notice for the run Start now made", *b.sent)
	}
}

func TestRunQueueBrainstormFailedStartTellsNobody(t *testing.T) {
	w, b := useBrainstormWorld(t)
	w.createErr = errors.New("no route")
	brainstormEntry(t, "Build the coupons", agentsTabB)

	evaluateRunQueue(context.Background())

	if len(*b.sent) != 0 || len(b.armed) != 0 {
		t.Errorf("deliveries = %+v, armed = %+v, want no run, no notice", *b.sent, b.armed)
	}
}

func TestRunQueueBrainstormANoticeThatCannotBeDeliveredIsRecordedOnTheRunNotRetried(t *testing.T) {
	w, b := useBrainstormWorld(t)
	brainstormEntry(t, "Build the coupons", "no-such-tab")

	evaluateRunQueue(context.Background())

	runId := w.runId(1)
	if got := w.createdGoals(); !sameStrings(got, "Build the coupons") || len(queueEntries(t)) != 0 {
		t.Fatalf("created %v, queue %v: a notice that fails must leave the start as it was", got, entryTitles(queueEntries(t)))
	}
	if len(*b.sent) != 0 {
		t.Errorf("deliveries = %+v, want none to a tab that is gone", *b.sent)
	}
	events, err := wstore.QueryRunEventsByKind(context.Background(), "ch-queue", runId, []string{runEventKindBrainstormNoticeFailed}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("run events = %+v, want one %q on the new run", events, runEventKindBrainstormNoticeFailed)
	}
	// not retried: another evaluation sends nothing more
	evaluateRunQueue(context.Background())
	if len(*b.sent) != 0 {
		t.Errorf("deliveries = %+v after another evaluation, want the failure left alone", *b.sent)
	}
}

func TestRunQueueBrainstormAnArmThatFailsStillDeliversTheNotice(t *testing.T) {
	w, b := useBrainstormWorld(t)
	b.armErr = errors.New("sleep is off")
	brainstormEntry(t, "Build the coupons", agentsTabB)

	evaluateRunQueue(context.Background())

	if len(*b.sent) != 1 || (*b.sent)[0].text != "brainstorm: run "+w.runId(1) {
		t.Errorf("deliveries = %+v, want the notice sent whether or not the sleep could be armed", *b.sent)
	}
}

func TestRunQueueBrainstormANoticeThatPanicsDoesNotEscape(t *testing.T) {
	w, _ := useBrainstormWorld(t)
	swap(t, &armBrainstormSleep, func(context.Context, wshrpc.CommandAgentsSleepAfterRunData) error { panic("boom") })
	brainstormEntry(t, "Build the coupons", agentsTabB)

	evaluateRunQueue(context.Background()) // a panic here would fail the test

	if got := w.createdGoals(); !sameStrings(got, "Build the coupons") {
		t.Fatalf("created %v, want the run started whatever the notice did", got)
	}
}

func TestRunQueueBrainstormAStartGivenOnlyTheEntrysBrainstormTellsItOnce(t *testing.T) {
	w, b := useBrainstormWorld(t)
	e := brainstormEntry(t, "Build the coupons", agentsTabB)
	// an entry whose start data also names the brainstorm: the entry's own notice is the only one
	if err := runqueue.Remove(e.Id); err != nil {
		t.Fatal(err)
	}
	e.Data.Brainstorm = e.Brainstorm
	if _, err := runqueue.Add(e); err != nil {
		t.Fatal(err)
	}

	evaluateRunQueue(context.Background())

	if got := w.created; len(got) != 1 || got[0].Brainstorm != nil {
		t.Fatalf("created %+v, want one start whose data names no brainstorm", got)
	}
	if len(*b.sent) != 1 {
		t.Errorf("deliveries = %+v, want the one notice the entry sends", *b.sent)
	}
}

// ---- telling a brainstorm the run a direct start made ----

func TestCreateRunWithABrainstormTellsItsAgentTheRun(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "createrun-brainstorm", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	stubRunServer(t, "pi", nil)
	sent := scriptAgents(t, threeAgents())
	swap(t, &runQueueGo, func(f func()) { f() })
	var armed []wshrpc.CommandAgentsSleepAfterRunData
	swap(t, &armBrainstormSleep, func(_ context.Context, d wshrpc.CommandAgentsSleepAfterRunData) error {
		armed = append(armed, d)
		return nil
	})
	path := "C:/p/.superpowers/brainstorm/topic/brainstorm.json"

	rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "Build the coupons", Runtime: "pi",
		Mode: jarvis.RunMode_Orchestrator, DeferStart: true,
		Brainstorm: &wshrpc.RunQueueBrainstorm{Tab: agentsTabB, Path: path},
	})
	if err != nil {
		t.Fatal(err)
	}
	runId := rtn.Run.ID
	if len(*sent) != 1 || (*sent)[0].blockId != agentsBlockB || (*sent)[0].text != "brainstorm: run "+runId {
		t.Fatalf("deliveries = %+v, want `brainstorm: run %s` to the brainstorm agent's block", *sent, runId)
	}
	if len(armed) != 1 || armed[0].Tab != agentsTabB || armed[0].RunId != runId || armed[0].Path != path {
		t.Errorf("armed = %+v, want the agent's sleep armed for the new run", armed)
	}
}

func TestCreateRunWithNoBrainstormTellsNobody(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "createrun-nobrainstorm", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	stubRunServer(t, "pi", nil)
	sent := scriptAgents(t, threeAgents())
	swap(t, &runQueueGo, func(f func()) { f() })

	if _, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "Alpha", Runtime: "pi",
		Mode: jarvis.RunMode_Orchestrator, DeferStart: true,
	}); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 0 {
		t.Errorf("deliveries = %+v, want none for a start that is no brainstorm's", *sent)
	}
}

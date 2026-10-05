// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/agentctl"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	wakeChannel   = "ch-1"
	wakeRun       = "run-1"
	wakeLeadBlock = "5b1e0a52-2d5c-4c3b-9d8e-0f3b7c1a9e01"
	wakeLeadTab   = "7c2f1b63-3e6d-4d4c-8e9f-1a4c8d2b0f12"
	finishedLine  = "wake: run finished. wsh jarvis dag status"
)

// the engine and merge fixtures build store-backed runs with a dag and no lead worker; each of their
// judgment events would otherwise start a real launch goroutine that outlives its test
func init() {
	launchLeadFn = func(context.Context, string, string, string) {}
}

// stubLaunch records the wakes each started lead was launched with. The launch stays open until the test
// settles it with leadLaunched.
func stubLaunch(t *testing.T) *[]string {
	t.Helper()
	var launched []string
	old := launchLeadFn
	launchLeadFn = func(_ context.Context, _, _, wake string) { launched = append(launched, wake) }
	restoreAfterStages(t, func() { launchLeadFn = old })
	return &launched
}

const failedLine = "wake: task t-1 failed (tests), retry spent. wsh jarvis dag status"

// fakeLead scripts the lead's block and records what the adapter typed and appended.
type fakeLead struct {
	state leadState
	sends []string // "" is Enter alone
	rows  []map[string]any
	now   int64
}

func newFakeLead(t *testing.T) *fakeLead {
	t.Helper()
	f := &fakeLead{
		state: leadState{BlockId: wakeLeadBlock, TabId: wakeLeadTab, Alive: true, State: baseds.AgentState_Idle},
		now:   1_000_000,
	}
	origWakes, origState, origSend, origNow, origAppend, origReg := wakes, leadStateFn, sendWakeFn, wakeNow, appendRunEvent, agentask.GlobalRegistry
	wakes = newWaker()
	agentask.GlobalRegistry = agentask.MakeRegistry()
	leadStateFn = func(context.Context, string, string) leadState { return f.state }
	sendWakeFn = func(_ string, text string) { f.sends = append(f.sends, text) }
	wakeNow = func() int64 { return f.now }
	appendRunEvent = func(_ context.Context, _, _, kind string, _ *int, detail any) {
		row := map[string]any{"eventkind": kind}
		if d, ok := detail.(map[string]any); ok {
			for k, v := range d {
				row[k] = v
			}
		}
		f.rows = append(f.rows, row)
	}
	restoreAfterStages(t, func() {
		wakes, leadStateFn, sendWakeFn, wakeNow, appendRunEvent, agentask.GlobalRegistry = origWakes, origState, origSend, origNow, origAppend, origReg
	})
	return f
}

// status moves the scripted lead to state and returns the event its hook would publish.
func (f *fakeLead) status(state string) *wps.WaveEvent {
	f.state.State = state
	oref := waveobj.MakeORef(waveobj.OType_Block, wakeLeadBlock).String()
	return &wps.WaveEvent{Event: wps.Event_AgentStatus, Data: baseds.AgentStatusData{ORef: oref, State: state}}
}

func (f *fakeLead) countKind(kind string) int {
	n := 0
	for _, r := range f.rows {
		if r["eventkind"] == kind {
			n++
		}
	}
	return n
}

func seedLeadAsk(oref, askId string, questions int) {
	qs := make([]baseds.AgentAskQuestion, questions)
	for i := range qs {
		qs[i] = baseds.AgentAskQuestion{Question: "which way?", Options: []baseds.AgentAskOption{{Label: "A"}, {Label: "B"}}}
	}
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{
		AskId: askId, BlockId: "child", Questions: qs,
		Owner: agentask.AskOwner_Lead, ChannelId: wakeChannel, RunId: wakeRun, TaskId: "t-0", DagOID: "dag-1",
	})
}

func TestWakeSendsToIdleLead(t *testing.T) {
	f := newFakeLead(t)
	PostWake(context.Background(), wakeChannel, wakeRun, finishedLine)
	if len(f.sends) != 1 || f.sends[0] != finishedLine {
		t.Fatalf("an idle lead gets the wake at once, got %q", f.sends)
	}
	if f.countKind(waveobj.RunEventKindLeadWoken) != 1 {
		t.Fatalf("a sent wake records one lead-woken row, got %+v", f.rows)
	}
}

func TestWakeTreatsWaitingAsAtPrompt(t *testing.T) {
	f := newFakeLead(t)
	f.state.State = baseds.AgentState_Waiting
	PostWake(context.Background(), wakeChannel, wakeRun, finishedLine)
	if len(f.sends) != 1 {
		t.Fatalf("a Claude lead idle past a minute reports waiting and must still be woken, got %q", f.sends)
	}
}

func TestWakeHeldWhileLeadsOwnQuestionIsOpen(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	leadOref := waveobj.MakeORef(waveobj.OType_Block, wakeLeadBlock).String()
	agentask.GlobalRegistry.Set(leadOref, agentask.PendingAsk{AskId: "lead-ask", BlockId: wakeLeadBlock})
	f.state.State = baseds.AgentState_Asking
	PostWake(ctx, wakeChannel, wakeRun, finishedLine)
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Waiting))
	tickWakes(ctx)
	if len(f.sends) != 0 {
		t.Fatalf("a Notification's waiting must not open the lead's question to typed input, got %q", f.sends)
	}
	agentask.GlobalRegistry.Drop(leadOref)
	tickWakes(ctx)
	if len(f.sends) != 1 || f.sends[0] != finishedLine {
		t.Fatalf("the held wake goes out once the question is answered, got %q", f.sends)
	}
}

func TestWakeJoinsEventsHeldForBusyLead(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	for _, state := range []string{baseds.AgentState_Working, baseds.AgentState_Asking} {
		f.state.State = state
		PostWake(ctx, wakeChannel, wakeRun, "wake: task t-1 failed (tests), retry spent. wsh jarvis dag status")
		if len(f.sends) != 0 {
			t.Fatalf("a %s lead gets nothing yet, got %q", state, f.sends)
		}
	}
	PostWake(ctx, wakeChannel, wakeRun, "wake: merge conflict landing task t-2. git status")
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Idle))
	want := "wake: task t-1 failed (tests), retry spent. wsh jarvis dag status\n" +
		"wake: task t-1 failed (tests), retry spent. wsh jarvis dag status\n" +
		"wake: merge conflict landing task t-2. git status"
	if len(f.sends) != 1 || f.sends[0] != want {
		t.Fatalf("held events go out as one message when the lead goes idle, got %q", f.sends)
	}
}

func TestWakeConfirmedByWorkingIsNotRetried(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	PostWake(ctx, wakeChannel, wakeRun, finishedLine)
	PostWake(ctx, wakeChannel, wakeRun, "wake: second")
	if len(f.sends) != 1 {
		t.Fatalf("no second wake while one is outstanding, got %q", f.sends)
	}
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Working))
	f.now += 3 * WakeConfirmTimeout.Milliseconds()
	tickWakes(ctx)
	if len(f.sends) != 1 {
		t.Fatalf("a confirmed wake is never retried, got %q", f.sends)
	}
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Idle))
	if len(f.sends) != 2 || f.sends[1] != "wake: second" {
		t.Fatalf("the held event goes out when the lead is idle again, got %q", f.sends)
	}
}

func TestWakeRetriesOnceThenLeadIsDead(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	PostWake(ctx, wakeChannel, wakeRun, finishedLine)

	f.now += WakeConfirmTimeout.Milliseconds()
	tickWakes(ctx)
	if len(f.sends) != 2 || f.sends[1] != "" {
		t.Fatalf("the single retry presses Enter alone, got %q", f.sends)
	}
	if LeadDead(wakeRun) {
		t.Fatal("one unconfirmed wake is not a dead lead")
	}

	f.now += WakeConfirmTimeout.Milliseconds()
	tickWakes(ctx)
	if !LeadDead(wakeRun) || len(f.sends) != 2 {
		t.Fatalf("an unconfirmed retry makes the lead dead with no further sends, dead=%v sends=%q", LeadDead(wakeRun), f.sends)
	}
	if f.countKind(waveobj.RunEventKindLeadWakeFailed) != 1 {
		t.Fatalf("want one lead-wake-failed row, got %+v", f.rows)
	}

	PostWake(ctx, wakeChannel, wakeRun, "wake: merge conflict landing task t-2. git status")
	if len(f.sends) != 2 || f.countKind(waveobj.RunEventKindLeadWakeFailed) != 2 {
		t.Fatalf("a dead lead's events go on the timeline, not into its terminal: sends=%q rows=%+v", f.sends, f.rows)
	}

	NoteLeadStatus(ctx, f.status(baseds.AgentState_Working))
	if LeadDead(wakeRun) {
		t.Fatal("a lead that reports working is taking wakes again")
	}
}

func TestWakeToExitedLeadMovesQuestionsToUser(t *testing.T) {
	f := newFakeLead(t)
	f.state.Alive = false
	seedLeadAsk("block:child-1", "a1", 1)

	PokeWake(context.Background(), wakeChannel, wakeRun)

	if len(f.sends) != 0 || !LeadDead(wakeRun) {
		t.Fatalf("an exited lead is dead and gets nothing typed, dead=%v sends=%q", LeadDead(wakeRun), f.sends)
	}
	p, _ := agentask.GlobalRegistry.Get("block:child-1")
	if p.Owner != agentask.AskOwner_User || p.Note != leadNotRunningNote {
		t.Fatalf("a dead lead's questions move to the user with the reason, got %+v", p)
	}
	if f.countKind(waveobj.RunEventKindTaskForwarded) != 1 {
		t.Fatalf("want one task-forwarded row, got %+v", f.rows)
	}
}

func TestWakeAnnouncesEachQuestionOnce(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	seedLeadAsk("block:child-1", "a1", 1)
	PokeWake(ctx, wakeChannel, wakeRun)
	if len(f.sends) != 1 || f.sends[0] != "wake: 1 question waiting. wsh jarvis dag asks" {
		t.Fatalf("want the one-question line, got %q", f.sends)
	}

	NoteLeadStatus(ctx, f.status(baseds.AgentState_Working))
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Idle))
	if len(f.sends) != 1 {
		t.Fatalf("an announced question does not wake the lead again, got %q", f.sends)
	}

	seedLeadAsk("block:child-2", "a2", 2)
	PokeWake(ctx, wakeChannel, wakeRun)
	if len(f.sends) != 2 || f.sends[1] != "wake: 3 questions waiting. wsh jarvis dag asks" {
		t.Fatalf("a new ask wakes the lead with the queue's question count, got %q", f.sends)
	}
}

func TestWakeReannouncesRestoredQuestion(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	seedLeadAsk("block:child-1", "a1", 1)
	PokeWake(ctx, wakeChannel, wakeRun)
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Working))
	agentask.GlobalRegistry.Update("block:child-1", "a1", func(p *agentask.PendingAsk) { p.Misses = 1 })

	NoteLeadStatus(ctx, f.status(baseds.AgentState_Idle))

	if len(f.sends) != 2 {
		t.Fatalf("a question back after a failed delivery is announced again, got %q", f.sends)
	}
}

func TestHandoffTypedAloneOnceTheLeadIsAtItsPrompt(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	// the lead is still in the turn that ran `dag submit`
	f.state.State = baseds.AgentState_Working
	PostHandoff(ctx, wakeChannel, wakeRun)
	PostWake(ctx, wakeChannel, wakeRun, finishedLine)
	if len(f.sends) != 0 {
		t.Fatalf("a working lead gets nothing yet, got %q", f.sends)
	}

	NoteLeadStatus(ctx, f.status(baseds.AgentState_Idle))
	if len(f.sends) != 1 || f.sends[0] != HandoffCompact {
		t.Fatalf("the handoff compaction goes out first and alone, got %q", f.sends)
	}
	if f.countKind(waveobj.RunEventKindLeadWoken) != 1 {
		t.Fatalf("the handoff records one lead-woken row, got %+v", f.rows)
	}

	// PreCompact reports working, and the SessionStart after the compaction reports idle
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Working))
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Idle))
	if len(f.sends) != 2 || f.sends[1] != finishedLine {
		t.Fatalf("the held wake follows once the compaction is over, got %q", f.sends)
	}
}

func TestHandoffUnconfirmedIsRetriedLikeAWake(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	PostHandoff(ctx, wakeChannel, wakeRun)
	if len(f.sends) != 1 || f.sends[0] != HandoffCompact {
		t.Fatalf("an idle lead gets the handoff at once, got %q", f.sends)
	}
	f.now += WakeConfirmTimeout.Milliseconds()
	tickWakes(ctx)
	if len(f.sends) != 2 || f.sends[1] != "" {
		t.Fatalf("an unconfirmed handoff is retried with Enter alone, got %q", f.sends)
	}
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Working))
	f.now += 3 * WakeConfirmTimeout.Milliseconds()
	tickWakes(ctx)
	if len(f.sends) != 2 || LeadDead(wakeRun) {
		t.Fatalf("a confirmed handoff is done, sends=%q dead=%v", f.sends, LeadDead(wakeRun))
	}
}

func TestNoLeadRunLaunchesItsLeadAtTheFirstJudgmentEvent(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	launched := stubLaunch(t)

	PostWake(context.Background(), wakeChannel, wakeRun, failedLine)

	if len(*launched) != 1 || (*launched)[0] != failedLine {
		t.Fatalf("the first judgment event launches the lead with the wake as its first message, got %q", *launched)
	}
	if len(f.sends) != 0 || LeadDead(wakeRun) {
		t.Fatalf("a lead never launched is not dead and gets nothing typed, dead=%v sends=%q", LeadDead(wakeRun), f.sends)
	}
	if f.countKind(waveobj.RunEventKindLeadLaunched) != 1 || f.countKind(waveobj.RunEventKindLeadWakeFailed) != 0 {
		t.Fatalf("want one lead-launched row and no lead-wake-failed row, got %+v", f.rows)
	}
}

func TestNoLeadQuestionLaunchesTheLeadAndStaysItsQuestion(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	launched := stubLaunch(t)
	seedLeadAsk("block:child-1", "a1", 1)

	PokeWake(context.Background(), wakeChannel, wakeRun)

	if len(*launched) != 1 || (*launched)[0] != "wake: 1 question waiting. wsh jarvis dag asks" {
		t.Fatalf("a question launches the lead with the question line, got %q", *launched)
	}
	if p, _ := agentask.GlobalRegistry.Get("block:child-1"); p.Owner != agentask.AskOwner_Lead {
		t.Fatalf("a question raised before the lead exists is still the lead's, got %+v", p)
	}
}

// decision 1: nobody has a judgment to make about a clean finish, and the engine closes the run itself
func TestCleanFinishWithNoLeadLaunchesNothing(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	launched := stubLaunch(t)

	PostWake(context.Background(), wakeChannel, wakeRun, finishedLine)

	if len(*launched) != 0 || len(f.rows) != 0 || LeadDead(wakeRun) {
		t.Fatalf("a clean finish starts no lead and records nothing: launched=%q rows=%+v dead=%v", *launched, f.rows, LeadDead(wakeRun))
	}
}

func TestEventsDuringALaunchWaitForTheLead(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	launched := stubLaunch(t)
	ctx := context.Background()

	PostWake(ctx, wakeChannel, wakeRun, failedLine)
	PostWake(ctx, wakeChannel, wakeRun, finishedLine)
	tickWakes(ctx)
	if len(*launched) != 1 {
		t.Fatalf("one launch per lead while it starts, got %q", *launched)
	}

	f.state = leadState{BlockId: wakeLeadBlock, TabId: wakeLeadTab, Alive: true, State: baseds.AgentState_Idle}
	leadLaunched(ctx, wakeChannel, wakeRun, nil)
	tickWakes(ctx)

	if len(f.sends) != 1 || f.sends[0] != finishedLine {
		t.Fatalf("an event held while the lead started is typed once it is at its prompt, got %q", f.sends)
	}
}

// the spawn returns with the lead's tab in place before its process is running. Acceptance 4's second
// question arrived in that gap, the lead was judged dead three seconds after its launch, and every question
// went to the human.
func TestAQuestionWhileTheLaunchedLeadStartsWaitsForIt(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	stubLaunch(t)
	ctx := context.Background()
	seedLeadAsk("block:child-1", "a1", 1)
	PokeWake(ctx, wakeChannel, wakeRun)

	f.state = leadState{BlockId: wakeLeadBlock, TabId: wakeLeadTab, Starting: true}
	leadLaunched(ctx, wakeChannel, wakeRun, nil)
	seedLeadAsk("block:child-2", "a2", 2)
	PokeWake(ctx, wakeChannel, wakeRun)
	tickWakes(ctx)

	if LeadDead(wakeRun) {
		t.Fatal("a lead whose process is still starting is not dead")
	}
	if p, _ := agentask.GlobalRegistry.Get("block:child-2"); p.Owner == agentask.AskOwner_User {
		t.Fatalf("the question stays with the starting lead, got %+v", p)
	}
	f.state = leadState{BlockId: wakeLeadBlock, TabId: wakeLeadTab, Alive: true, State: baseds.AgentState_Idle}
	tickWakes(ctx)
	if len(f.sends) != 1 {
		t.Fatalf("the waiting question is typed once the lead is at its prompt, got %q", f.sends)
	}
}

func TestALaunchedLeadThatNeverStartsIsDead(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	stubLaunch(t)
	ctx := context.Background()
	PostWake(ctx, wakeChannel, wakeRun, failedLine)

	f.state = leadState{BlockId: wakeLeadBlock, TabId: wakeLeadTab, Starting: true}
	leadLaunched(ctx, wakeChannel, wakeRun, nil)
	PostWake(ctx, wakeChannel, wakeRun, finishedLine)
	f.now += WakeConfirmTimeout.Milliseconds()
	tickWakes(ctx)

	if !LeadDead(wakeRun) {
		t.Fatal("a lead still not running a wake-confirm timeout after its launch takes no wakes")
	}
}

func TestFailedLaunchHandsJudgmentToTheUser(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	stubLaunch(t)
	ctx := context.Background()
	seedLeadAsk("block:child-1", "a1", 1)
	PokeWake(ctx, wakeChannel, wakeRun)

	leadLaunched(ctx, wakeChannel, wakeRun, errors.New("no route for pi"))

	if !LeadDead(wakeRun) {
		t.Fatal("a lead that could not be started takes no wakes")
	}
	p, _ := agentask.GlobalRegistry.Get("block:child-1")
	if p.Owner != agentask.AskOwner_User || !strings.Contains(p.Note, leadLaunchFailedNote) || !strings.Contains(p.Note, "no route for pi") {
		t.Fatalf("its questions go to the user with why, got %+v", p)
	}
	if f.countKind(waveobj.RunEventKindLeadWakeFailed) != 1 {
		t.Fatalf("want one lead-wake-failed row, got %+v", f.rows)
	}
}

// relaunchFixture is an owner run whose lead tab is stale, with the lead's spawn stubbed the way
// spawnRunWorkersWithPrompt does it: EnsureWorkers over jarvis.SpawnRunWorker, then the new oref persisted.
type relaunchFixture struct {
	*mergeFixture
	fake    *fakeLead
	spawns  int
	prompts []string
}

func newRelaunchFixture(t *testing.T) *relaunchFixture {
	t.Helper()
	f := &relaunchFixture{mergeFixture: newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "only"}}), fake: newFakeLead(t)}
	stampLeadTab(t, f.mergeFixture)
	f.fake.state = leadState{BlockId: wakeLeadBlock, TabId: "lead-tab"}
	oldSpawn, oldHook := jarvis.SpawnRunWorker, LaunchLeadHook
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		f.spawns++
		f.prompts = append(f.prompts, prompt)
		return "tab:new-tab", nil
	}
	LaunchLeadHook = func(ctx context.Context, channelId, runId, prompt string) error {
		run, err := wstore.GetRun(ctx, channelId, runId)
		if err != nil {
			return err
		}
		spawned, err := jarvis.EnsureWorkers(ctx, run, runroute.Capability{}, "proj", prompt)
		if err != nil {
			return err
		}
		return wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
			for i, w := range spawned {
				r.Phases[i].WorkerOrefs = append(r.Phases[i].WorkerOrefs, w.ORef)
			}
			return nil
		})
	}
	restoreAfterStages(t, func() { jarvis.SpawnRunWorker, LaunchLeadHook = oldSpawn, oldHook })
	return f
}

func TestRelaunchLeadRefusesWhileTheLeadIsAlive(t *testing.T) {
	f := newRelaunchFixture(t)
	f.fake.state.Alive = true
	err := RelaunchLead(f.ctx, f.channel, f.ownerID)
	if err == nil || !strings.Contains(err.Error(), "still running") {
		t.Fatalf("a live lead must not be replaced, got %v", err)
	}
	if f.spawns != 0 || runTabID(f.owner(t)) != "lead-tab" {
		t.Fatalf("a refused relaunch changes nothing, got %d spawns, tab %q", f.spawns, runTabID(f.owner(t)))
	}
}

func TestRelaunchLeadReplacesTheStaleTabOref(t *testing.T) {
	f := newRelaunchFixture(t)
	if err := RelaunchLead(f.ctx, f.channel, f.ownerID); err != nil {
		t.Fatal(err)
	}
	if f.spawns != 1 {
		t.Fatalf("want one replacement lead spawned, got %d", f.spawns)
	}
	if got := f.owner(t).Phases[0].WorkerOrefs; len(got) != 1 || got[0] != "tab:new-tab" {
		t.Fatalf("the phase must name only the new tab, got %v", got)
	}
}

func TestRelaunchLeadResumesWakes(t *testing.T) {
	f := newRelaunchFixture(t)
	wakes.lock.Lock()
	wakes.leadDiedLocked(f.ctx, f.ownerID, wakes.runLocked(f.channel, f.ownerID), leadNotRunningNote)
	wakes.lock.Unlock()
	PostWake(f.ctx, f.channel, f.ownerID, failedLine)
	if len(f.fake.sends) != 0 || f.fake.countKind(waveobj.RunEventKindLeadWakeFailed) != 2 {
		t.Fatalf("a dead lead records the wake as failed, got sends %q rows %+v", f.fake.sends, f.fake.rows)
	}
	if err := RelaunchLead(f.ctx, f.channel, f.ownerID); err != nil {
		t.Fatal(err)
	}
	f.fake.state = leadState{BlockId: wakeLeadBlock, TabId: "new-tab", Alive: true, State: baseds.AgentState_Idle}
	PostWake(f.ctx, f.channel, f.ownerID, finishedLine)
	if len(f.fake.sends) != 1 || f.fake.sends[0] != finishedLine {
		t.Fatalf("a wake after the relaunch is delivered, got %q", f.fake.sends)
	}
	if f.fake.countKind(waveobj.RunEventKindLeadWakeFailed) != 2 {
		t.Fatalf("the wake must not be recorded as failed, got %+v", f.fake.rows)
	}
}

func TestRelaunchLeadCarriesTheHeldLines(t *testing.T) {
	f := newRelaunchFixture(t)
	wakes.lock.Lock()
	rw := wakes.runLocked(f.channel, f.ownerID)
	rw.lines = []string{failedLine}
	wakes.leadDiedLocked(f.ctx, f.ownerID, rw, leadNotRunningNote)
	wakes.lock.Unlock()
	PostWake(f.ctx, f.channel, f.ownerID, finishedLine)
	if err := RelaunchLead(f.ctx, f.channel, f.ownerID); err != nil {
		t.Fatal(err)
	}
	if len(f.prompts) != 1 {
		t.Fatalf("want one prompt, got %q", f.prompts)
	}
	p := f.prompts[0]
	for _, want := range []string{"replacement lead", "do not resubmit the plan", failedLine, finishedLine} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt lacks %q:\n%s", want, p)
		}
	}
}

func TestQuietLinesWaitForAWake(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	PostQuiet(ctx, wakeChannel, wakeRun, "t-1 passed review: adds fmtDate")
	if len(f.sends) != 0 {
		t.Fatalf("a quiet line must not wake the lead: %q", f.sends)
	}
	PostWake(ctx, wakeChannel, wakeRun, failedLine)
	want := failedLine + "\nSince your last wake:\nt-1 passed review: adds fmtDate"
	if len(f.sends) != 1 || f.sends[0] != want {
		t.Fatalf("the wake must carry the quiet lines last, got %q", f.sends)
	}
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Working))
	PostWake(ctx, wakeChannel, wakeRun, finishedLine)
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Idle))
	if len(f.sends) != 2 || f.sends[1] != finishedLine {
		t.Fatalf("delivered quiet lines must not repeat, got %q", f.sends)
	}
}

func TestQuietLinesAloneLaunchNoLead(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	launched := stubLaunch(t)
	ctx := context.Background()
	PostQuiet(ctx, wakeChannel, wakeRun, "t-1 passed review: adds fmtDate")
	PostWake(ctx, wakeChannel, wakeRun, finishedLine)
	if len(*launched) != 0 {
		t.Fatalf("a clean finish with only quiet lines needs no lead, launched %q", *launched)
	}
}

func TestLaunchedLeadGetsTheQuietLines(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	launched := stubLaunch(t)
	ctx := context.Background()
	PostQuiet(ctx, wakeChannel, wakeRun, "t-1 passed review: adds fmtDate")
	PostWake(ctx, wakeChannel, wakeRun, failedLine)
	want := failedLine + "\nSince your last wake:\nt-1 passed review: adds fmtDate"
	if len(*launched) != 1 || (*launched)[0] != want {
		t.Fatalf("the first lead must learn what landed before it, got %q", *launched)
	}
}

func TestWakeLeadsWithTheActionThenCaveatsThenRecaps(t *testing.T) {
	f := newFakeLead(t)
	f.state.State = baseds.AgentState_Working // hold everything until the lead is back at its prompt
	ctx := context.Background()
	PostQuiet(ctx, wakeChannel, wakeRun, "t-1 passed review: recap one")
	PostCaveat(ctx, wakeChannel, wakeRun, "t-2: the CDP screenshot was not taken")
	PostQuiet(ctx, wakeChannel, wakeRun, "t-2 passed review: recap two")
	PostWake(ctx, wakeChannel, wakeRun, "wake: merge conflict in t-3")
	NoteLeadStatus(ctx, f.status(baseds.AgentState_Idle))
	if len(f.sends) != 1 {
		t.Fatalf("want one wake, got %q", f.sends)
	}
	want := strings.Join([]string{
		"wake: merge conflict in t-3",
		"Unverified:",
		"t-2: the CDP screenshot was not taken",
		"Since your last wake:",
		"t-1 passed review: recap one",
		"t-2 passed review: recap two",
	}, "\n")
	if f.sends[0] != want {
		t.Fatalf("wake order:\n%s\nwant:\n%s", f.sends[0], want)
	}
}

func TestWakePutsTheQuestionsLineRightAfterTheAction(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	PostQuiet(ctx, wakeChannel, wakeRun, "t-1 passed review: recap")
	seedLeadAsk("block:child", "ask-1", 1)
	PostWake(ctx, wakeChannel, wakeRun, finishedLine)
	want := finishedLine + "\nwake: 1 question waiting. wsh jarvis dag asks\nSince your last wake:\nt-1 passed review: recap"
	if len(f.sends) != 1 || f.sends[0] != want {
		t.Fatalf("action first, then questions, recaps last: %q", f.sends)
	}
}

func TestRunFinishedUnverifiedBlockComesBeforeTheRecaps(t *testing.T) {
	f := newFakeLead(t)
	ctx := context.Background()
	PostQuiet(ctx, wakeChannel, wakeRun, "t-1 passed review: recap")
	finished := RunFinishedWake(&waveobj.FinalStage{State: FinalState_Unverified, Unverified: []string{"no screenshot: port taken"}})
	PostWake(ctx, wakeChannel, wakeRun, finished)
	if len(f.sends) != 1 || !strings.HasPrefix(f.sends[0], finished+"\n") {
		t.Fatalf("the finished block, with its unverified list, leads the wake: %q", f.sends)
	}
	if !strings.HasSuffix(f.sends[0], "Since your last wake:\nt-1 passed review: recap") {
		t.Fatalf("recaps come last: %q", f.sends[0])
	}
}

func TestACaveatAloneStartsNoWake(t *testing.T) {
	f := newFakeLead(t)
	PostCaveat(context.Background(), wakeChannel, wakeRun, "t-1: not verified")
	tickWakes(context.Background())
	if len(f.sends) != 0 {
		t.Fatalf("a caveat rides on the next wake, got %q", f.sends)
	}
}

func TestLaunchedLeadGetsTheActionFirst(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	launched := stubLaunch(t)
	ctx := context.Background()
	PostQuiet(ctx, wakeChannel, wakeRun, "t-1 passed review: adds fmtDate")
	PostCaveat(ctx, wakeChannel, wakeRun, "t-1: the CDP screenshot was not taken")
	PostWake(ctx, wakeChannel, wakeRun, failedLine)
	want := failedLine + "\nUnverified:\nt-1: the CDP screenshot was not taken\nSince your last wake:\nt-1 passed review: adds fmtDate"
	if len(*launched) != 1 || (*launched)[0] != want {
		t.Fatalf("the launch prompt leads with the action, got %q", *launched)
	}
}

func TestCaveatsAloneLaunchNoLead(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	launched := stubLaunch(t)
	ctx := context.Background()
	PostCaveat(ctx, wakeChannel, wakeRun, "t-1: not verified")
	PostWake(ctx, wakeChannel, wakeRun, finishedLine)
	PostWake(ctx, wakeChannel, wakeRun, failedLine)
	want := failedLine
	if len(*launched) != 1 || (*launched)[0] != want {
		t.Fatalf("a clean finish drops its caveats with it, got %q", *launched)
	}
}

// LeadDead reports that runId's lead stopped taking wakes, so its judgment belongs to the human (G8).
func LeadDead(runId string) bool {
	wakes.lock.Lock()
	defer wakes.lock.Unlock()
	rw := wakes.runs[runId]
	return rw != nil && rw.dead
}

func TestWakeGoesOverAnIdleSessionsStream(t *testing.T) {
	msgs, done := agentctl.Register("stream-idle")
	defer done()
	if !overStream("stream-idle", "wake: task 1 done", baseds.AgentState_Idle) {
		t.Fatalf("an idle session with a stream was left to be typed into")
	}
	if got := <-msgs; got != "wake: task 1 done" {
		t.Fatalf("stream got %q", got)
	}
}

// the mod's prompt waits for a running turn to end; typed text reaches the turn, which a tell needs.
func TestTextForABusySessionIsTypedDespiteItsStream(t *testing.T) {
	msgs, done := agentctl.Register("stream-busy")
	defer done()
	if overStream("stream-busy", "stop and rebase", baseds.AgentState_Working) {
		t.Fatalf("a working session's text went over the stream")
	}
	if len(msgs) != 0 {
		t.Fatalf("the stream holds %d messages", len(msgs))
	}
}

// Enter alone would submit whatever the human is typing in the composer.
func TestRetryEnterIsNotTypedIntoASessionWithAStream(t *testing.T) {
	msgs, done := agentctl.Register("stream-retry")
	defer done()
	if !overStream("stream-retry", "", baseds.AgentState_Working) {
		t.Fatalf("the retry's Enter was left to be typed")
	}
	if len(msgs) != 0 {
		t.Fatalf("the retry sent %d messages over the stream", len(msgs))
	}
}

func TestSessionWithNoStreamIsTyped(t *testing.T) {
	if overStream("no-stream", "wake", baseds.AgentState_Idle) || overStream("no-stream", "", baseds.AgentState_Idle) {
		t.Fatalf("a session with no stream was not left to be typed into")
	}
}

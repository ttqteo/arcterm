// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const wantPausedNudgeBase = "Arc paused this run and has now resumed it; carry on from where you stopped. " +
	"If you were waiting on an answer that is not below, ask again."

func TestPausedNudgeSaysThePauseAndAsksAgainForAnUnansweredQuestion(t *testing.T) {
	if got := PausedNudge(context.Background(), "tab:w1"); got != wantPausedNudgeBase {
		t.Fatalf("PausedNudge = %q, want %q", got, wantPausedNudgeBase)
	}
}

// pausedAskFixture gives a fresh ask registry holding one pending ask on the block of a worker tab that belongs to
// run, and a keystroke counter for what gets typed into it. It returns the tab oref (what PausedNudge takes) and the
// block oref (what the ask and its held answers are keyed by).
func pausedAskFixture(t *testing.T, run waveobj.Run, questions []baseds.AgentAskQuestion) (tabORef, blockORef string, typed *int) {
	t.Helper()
	old := agentask.GlobalRegistry
	agentask.GlobalRegistry = agentask.MakeRegistry()
	t.Cleanup(func() { agentask.GlobalRegistry = old })
	typed = new(int)
	t.Cleanup(agentask.SetSendInputForTest(func(string, []byte) error { *typed++; return nil }))

	blockORef = ownedAskBlock(t, run)
	oref, err := waveobj.ParseORef(blockORef)
	if err != nil {
		t.Fatal(err)
	}
	block, err := wstore.DBMustGet[*waveobj.Block](context.Background(), oref.OID)
	if err != nil {
		t.Fatal(err)
	}
	agentask.GlobalRegistry.Set(blockORef, agentask.PendingAsk{AskId: "a-1", BlockId: oref.OID, Questions: questions, Ts: 1})
	return block.ParentORef, blockORef, typed
}

func pausedRun() waveobj.Run {
	run := NewRun("goal", "ws-1", "/p", nil, RunMode_Quick, QuickPlaybook(), 1000)
	SetRunPause(&run, &waveobj.RunPause{PausedTs: 2000, By: "manual"})
	return run
}

func abQuestion() []baseds.AgentAskQuestion {
	return []baseds.AgentAskQuestion{{Question: "A or B?", Options: []baseds.AgentAskOption{{Label: "A"}, {Label: "B"}}}}
}

// the person answers while the run is paused: the dead TUI is not typed into, the answer rides the resume nudge after
// the base text ('below' is where the base text points), and it rides it once
func TestPausedNudgeCarriesAnAnswerGivenWhilePausedOnceAndTypesNothing(t *testing.T) {
	tabORef, blockORef, typed := pausedAskFixture(t, pausedRun(), abQuestion())

	delivered, err := agentask.DeliverAnswer(blockORef, "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}})
	if err != nil || !delivered {
		t.Fatalf("DeliverAnswer = (%v, %v), want (true, nil)", delivered, err)
	}
	if *typed != 0 {
		t.Fatalf("an answer for a paused run's agent was typed: %d keystrokes", *typed)
	}

	want := wantPausedNudgeBase + "\nWhile you were paused, the person answered your question: A or B? → B"
	if got := PausedNudge(context.Background(), tabORef); got != want {
		t.Fatalf("PausedNudge = %q, want %q", got, want)
	}
	if got := PausedNudge(context.Background(), tabORef); got != wantPausedNudgeBase {
		t.Fatalf("the held answer must be consumed by the first nudge, the second got %q", got)
	}
}

func TestPausedNudgeCarriesEveryHeldAnswerOnItsOwnLine(t *testing.T) {
	tabORef, blockORef, _ := pausedAskFixture(t, pausedRun(), []baseds.AgentAskQuestion{
		{Question: "Which\ndb?", Options: []baseds.AgentAskOption{{Label: "pg"}, {Label: "sqlite"}}},
		{Question: "Which checks?", MultiSelect: true, Options: []baseds.AgentAskOption{{Label: "unit"}, {Label: "e2e"}}},
	})
	if _, err := agentask.DeliverAnswer(blockORef, "", []baseds.AgentAnswerItem{
		{Text: "sqlite, please"},
		{SelectedIndexes: []int{0, 1}},
	}); err != nil {
		t.Fatal(err)
	}
	want := wantPausedNudgeBase +
		"\nWhile you were paused, the person answered your question: Which db? → sqlite, please" +
		"\nWhile you were paused, the person answered your question: Which checks? → unit, e2e"
	if got := PausedNudge(context.Background(), tabORef); got != want {
		t.Fatalf("PausedNudge = %q, want %q", got, want)
	}
}

// the hold applies to a run that is paused and to nothing else: an answer for a live run's agent is typed as ever, and
// its nudge has nothing to add
func TestPausedNudgeAddsNothingForAnAnswerTypedIntoALiveAgent(t *testing.T) {
	run := NewRun("goal", "ws-1", "/p", nil, RunMode_Quick, QuickPlaybook(), 1000)
	tabORef, blockORef, typed := pausedAskFixture(t, run, abQuestion())

	delivered, err := agentask.DeliverAnswer(blockORef, "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}})
	if err != nil || !delivered {
		t.Fatalf("DeliverAnswer = (%v, %v), want (true, nil)", delivered, err)
	}
	if *typed != 2 {
		t.Fatalf("want the two keystrokes for index 1 typed into a live agent, got %d", *typed)
	}
	if got := PausedNudge(context.Background(), tabORef); got != wantPausedNudgeBase {
		t.Fatalf("PausedNudge = %q, want the base text alone", got)
	}
}

const (
	wantSleptNudgeHead = "You were put to sleep while waiting on the person; carry on from where you stopped."
	wantSleptNudgeTail = "If you were waiting on an answer or a permission that is not above, ask again."
)

// sleptAskFixture gives a fresh ask registry holding one pending ask on a stored block with meta, whose process is over
// (a slept agent's controller is destroyed), and returns the block's oref. The ask and its held answers are keyed by it.
func sleptAskFixture(t *testing.T, meta waveobj.MetaMapType, questions []baseds.AgentAskQuestion) (blockORef string, typed *int) {
	t.Helper()
	stubControllerStatus(t, nil)
	old := agentask.GlobalRegistry
	agentask.GlobalRegistry = agentask.MakeRegistry()
	t.Cleanup(func() { agentask.GlobalRegistry = old })
	typed = new(int)
	t.Cleanup(agentask.SetSendInputForTest(func(string, []byte) error { *typed++; return nil }))

	blockId := uuid.NewString()
	if err := wstore.DBInsert(context.Background(), &waveobj.Block{OID: blockId, Meta: meta}); err != nil {
		t.Fatalf("insert block: %v", err)
	}
	blockORef = waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	if questions != nil {
		agentask.GlobalRegistry.Set(blockORef, agentask.PendingAsk{AskId: "a-1", BlockId: blockId, Questions: questions, Ts: 1})
	}
	return blockORef, typed
}

// slept-while-asking meta, as sleepAgent writes it
func sleptAskingMeta() waveobj.MetaMapType {
	return waveobj.MetaMapType{waveobj.MetaKey_AgentSleeping: int64(5000), waveobj.MetaKey_AgentSleepAsking: true}
}

// the sleep nudge is three parts in order (what happened, one line per answer given while asleep, what to do when the
// agent's question is not answered below), and it takes the answers so each reaches the agent once
func TestSleptNudgeWritesTheThreePartsInOrderAndTakesTheAnswers(t *testing.T) {
	blockORef, typed := sleptAskFixture(t, sleptAskingMeta(), []baseds.AgentAskQuestion{
		{Question: "Which\ndb?", Options: []baseds.AgentAskOption{{Label: "pg"}, {Label: "sqlite"}}},
		{Question: "Which checks?", MultiSelect: true, Options: []baseds.AgentAskOption{{Label: "unit"}, {Label: "e2e"}}},
	})
	if _, err := agentask.DeliverAnswer(blockORef, "", []baseds.AgentAnswerItem{
		{Text: "sqlite, please"},
		{SelectedIndexes: []int{0, 1}},
	}); err != nil {
		t.Fatal(err)
	}
	if *typed != 0 {
		t.Fatalf("an answer for a sleeping agent was typed: %d keystrokes", *typed)
	}
	want := wantSleptNudgeHead +
		"\nWhile you were asleep, the person answered your question: Which db? → sqlite, please" +
		"\nWhile you were asleep, the person answered your question: Which checks? → unit, e2e" +
		"\n" + wantSleptNudgeTail
	if got := SleptNudge(blockORef); got != want {
		t.Fatalf("SleptNudge = %q, want %q", got, want)
	}
	if got := SleptNudge(blockORef); got != wantSleptNudgeHead+"\n"+wantSleptNudgeTail {
		t.Fatalf("the held answers must be consumed by the first nudge, the second got %q", got)
	}
}

// the two nudges share one line for a held answer, apart from the word for what the agent was doing
func TestSleptNudgeSharesPausedNudgesAnswerLine(t *testing.T) {
	held := []agentask.HeldAnswer{{Question: "A or B?", Answers: []string{"B"}}}
	if got, want := heldAnswerLines("While you were asleep, ", held), "\nWhile you were asleep, the person answered your question: A or B? → B"; got != want {
		t.Fatalf("heldAnswerLines = %q, want %q", got, want)
	}
	if got, want := heldAnswerLines("While you were paused, ", held), "\nWhile you were paused, the person answered your question: A or B? → B"; got != want {
		t.Fatalf("heldAnswerLines = %q, want %q", got, want)
	}
}

// a block whose meta says it slept while asking, with no process, holds the person's answer: a dead TUI would drop the
// keystrokes
func TestAnswerHeldForASleepingAgentThatWasAsking(t *testing.T) {
	blockORef, _ := sleptAskFixture(t, sleptAskingMeta(), nil)
	if !answerHeld(blockORef) {
		t.Fatal("an answer for an agent slept while asking was not held")
	}
	stubControllerStatus(t, &blockcontroller.BlockControllerRuntimeStatus{ShellProcStatus: blockcontroller.Status_Done})
	if !answerHeld(blockORef) {
		t.Fatal("an answer for an agent slept while asking, whose controller reads done, was not held")
	}
}

// a sleep mark left over a running process (a forced restart that was no wake) is stale: the agent is awake, and its
// answer is typed as before
func TestAnswerHeldIgnoresASleepMarkOverARunningProcess(t *testing.T) {
	blockORef, _ := sleptAskFixture(t, sleptAskingMeta(), nil)
	stubControllerStatus(t, &blockcontroller.BlockControllerRuntimeStatus{ShellProcStatus: blockcontroller.Status_Running})
	if answerHeld(blockORef) {
		t.Fatal("an answer for a running agent was held because of a stale sleep mark")
	}
}

// an agent slept while idle has no ask to keep: without the asking mark an answer is typed as before
func TestAnswerHeldTypesForAnIdleSleepWithoutTheAskingMark(t *testing.T) {
	blockORef, _ := sleptAskFixture(t, waveobj.MetaMapType{waveobj.MetaKey_AgentSleeping: int64(5000)}, nil)
	if answerHeld(blockORef) {
		t.Fatal("an answer was held for an agent that slept idle")
	}
	// and the mark alone, with no sleep, is no sleep
	blockORef, _ = sleptAskFixture(t, waveobj.MetaMapType{waveobj.MetaKey_AgentSleepAsking: true}, nil)
	if answerHeld(blockORef) {
		t.Fatal("an answer was held for an agent that is not asleep")
	}
}

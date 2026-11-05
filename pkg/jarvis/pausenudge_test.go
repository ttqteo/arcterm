// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const wantPausedNudgeBase = "Arc paused this run to free memory and has now resumed it; carry on from where you stopped. " +
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

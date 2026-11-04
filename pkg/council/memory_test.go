// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"reflect"
	"strings"
	"testing"
)

func dir(text, how string) CouncilMemoryDirection {
	return CouncilMemoryDirection{Text: text, How: how}
}

func TestMemoryOfCreatesOnFirstUse(t *testing.T) {
	c := &Council{}
	m := MemoryOf(c)
	if m == nil || c.Memory != m {
		t.Fatalf("MemoryOf did not put a memory on the council: got %v, council holds %v", m, c.Memory)
	}
	m.Changed = 5
	if MemoryOf(c) != m || MemoryOf(c).Changed != 5 {
		t.Errorf("a second MemoryOf returned a different memory, want the same one")
	}
}

func TestMemoryChooseThenReplace(t *testing.T) {
	m := &CouncilMemory{}
	m.Choose(dir("A", DirectionPin), EndReplaced, 100)
	if m.Chosen == nil || m.Chosen.Text != "A" || m.Chosen.At != 100 || m.Changed != 100 {
		t.Fatalf("first Choose: chosen %+v changed %d, want A set at 100", m.Chosen, m.Changed)
	}
	if len(m.Replaced) != 0 {
		t.Fatalf("a first Choose replaced %+v, want nothing", m.Replaced)
	}

	m.Choose(dir("B", DirectionWritten), EndReplaced, 200)
	if m.Chosen.Text != "B" || m.Changed != 200 {
		t.Fatalf("second Choose: chosen %+v changed %d, want B at 200", m.Chosen, m.Changed)
	}
	want := []CouncilMemoryDirection{{Text: "A", How: DirectionPin, At: 100, Replaced: 200, Ended: EndReplaced}}
	if !reflect.DeepEqual(m.Replaced, want) {
		t.Fatalf("Replaced after B: %+v, want %+v", m.Replaced, want)
	}

	m.Choose(dir("C", DirectionPin), EndEdited, 300)
	if len(m.Replaced) != 2 || m.Replaced[0].Text != "B" || m.Replaced[1].Text != "A" {
		t.Fatalf("Replaced is not newest first: %+v", m.Replaced)
	}
	if m.Replaced[0].Replaced != 300 || m.Replaced[0].Ended != EndEdited {
		t.Errorf("B left as %+v, want replaced 300 ended %q", m.Replaced[0], EndEdited)
	}
	if m.Replaced[1].Replaced != 200 || m.Replaced[1].Ended != EndReplaced {
		t.Errorf("A kept %+v, want its earlier replaced 200 ended %q", m.Replaced[1], EndReplaced)
	}
	if m.Changed != 300 {
		t.Errorf("Changed %d, want 300", m.Changed)
	}
}

func TestMemoryChooseKeepsAtAndClearsLeftoverEnd(t *testing.T) {
	m := &CouncilMemory{}
	d := dir("A", DirectionWritten)
	d.At = 42
	d.Replaced = 7
	d.Ended = EndUnpinned
	m.Choose(d, EndReplaced, 100)
	if m.Chosen.At != 42 {
		t.Errorf("Choose overwrote a direction's At: %d, want 42", m.Chosen.At)
	}
	if m.Chosen.Replaced != 0 || m.Chosen.Ended != "" {
		t.Errorf("a chosen direction carries Replaced %d Ended %q, want none", m.Chosen.Replaced, m.Chosen.Ended)
	}
}

func TestMemoryChooseWithoutAnEndWordEndsAsReplaced(t *testing.T) {
	m := &CouncilMemory{}
	m.Choose(dir("A", DirectionPin), EndReplaced, 100)
	m.Choose(dir("B", DirectionPin), "", 200)
	if m.Replaced[0].Ended != EndReplaced {
		t.Errorf("an empty end word left Ended %q, want %q", m.Replaced[0].Ended, EndReplaced)
	}
}

// a direction that is set settles any held card, and leaves a waiting suggestion where it is
func TestMemoryChooseClearsHeldAndLeavesSuggestion(t *testing.T) {
	m := &CouncilMemory{
		Held:       &CouncilMemoryCard{Kind: CardHeld, Text: "held"},
		Suggestion: &CouncilMemoryCard{Kind: CardSuggestion, Text: "suggested", Source: SourceCheck},
	}
	m.Choose(dir("A", DirectionPin), EndReplaced, 100)
	if m.Held != nil {
		t.Errorf("Choose left the held card %+v, want nil", m.Held)
	}
	if m.Suggestion == nil || m.Suggestion.Text != "suggested" {
		t.Errorf("Choose touched the suggestion: %+v, want it left in place", m.Suggestion)
	}
}

func TestMemoryUnpin(t *testing.T) {
	m := &CouncilMemory{}
	m.Choose(dir("A", DirectionPin), EndReplaced, 100)
	if err := m.Unpin(250); err != nil {
		t.Fatalf("Unpin: %v", err)
	}
	if m.Chosen != nil {
		t.Errorf("Chosen after Unpin: %+v, want nil", m.Chosen)
	}
	want := []CouncilMemoryDirection{{Text: "A", How: DirectionPin, At: 100, Replaced: 250, Ended: EndUnpinned}}
	if !reflect.DeepEqual(m.Replaced, want) {
		t.Errorf("Replaced after Unpin: %+v, want %+v", m.Replaced, want)
	}
	if m.Changed != 250 {
		t.Errorf("Changed %d, want 250", m.Changed)
	}
}

func TestMemoryUnpinWithNoneChosenFails(t *testing.T) {
	m := &CouncilMemory{Changed: 9}
	err := m.Unpin(250)
	if err == nil || !strings.Contains(err.Error(), "chosen") {
		t.Fatalf("Unpin with none chosen: %v, want an error naming the missing chosen direction", err)
	}
	if m.Changed != 9 || len(m.Replaced) != 0 {
		t.Errorf("a refused Unpin changed the memory: %+v", m)
	}
}

func TestMemoryHoldThenSetAnyway(t *testing.T) {
	m := &CouncilMemory{}
	m.Choose(dir("A", DirectionPin), EndReplaced, 100)
	m.Hold(CouncilMemoryCard{Text: "B", Reason: "clashes with r3", How: DirectionPin, From: "r7", At: 150})
	if m.Held == nil || m.Held.Kind != CardHeld || m.Held.Text != "B" {
		t.Fatalf("Hold: held %+v, want a held card for B", m.Held)
	}
	if m.Chosen.Text != "A" {
		t.Fatalf("Hold changed the chosen direction to %q", m.Chosen.Text)
	}

	if err := m.SetAnyway(300); err != nil {
		t.Fatalf("SetAnyway: %v", err)
	}
	if m.Held != nil {
		t.Errorf("SetAnyway left the held card %+v", m.Held)
	}
	if m.Chosen.Text != "B" || m.Chosen.How != DirectionPin || m.Chosen.From != "r7" || m.Chosen.At != 300 {
		t.Errorf("chosen after SetAnyway: %+v, want B, how pin, from r7, at 300", m.Chosen)
	}
	if len(m.Replaced) != 1 || m.Replaced[0].Text != "A" || m.Replaced[0].Ended != EndReplaced || m.Replaced[0].Replaced != 300 {
		t.Errorf("Replaced after SetAnyway: %+v, want A ended %q at 300", m.Replaced, EndReplaced)
	}
	if m.Changed != 300 {
		t.Errorf("Changed %d, want 300", m.Changed)
	}
}

func TestMemorySetAnywayOfAnEditedCardEndsTheOldAsEdited(t *testing.T) {
	m := &CouncilMemory{}
	m.Choose(dir("A", DirectionWritten), EndReplaced, 100)
	m.Hold(CouncilMemoryCard{Text: "A, sharper", How: DirectionWritten, Edited: true, At: 150})
	if err := m.SetAnyway(300); err != nil {
		t.Fatalf("SetAnyway: %v", err)
	}
	if len(m.Replaced) != 1 || m.Replaced[0].Ended != EndEdited {
		t.Errorf("Replaced after an edited card: %+v, want A ended %q", m.Replaced, EndEdited)
	}
	if m.Chosen.Text != "A, sharper" || m.Chosen.How != DirectionWritten {
		t.Errorf("chosen %+v, want the edited text written", m.Chosen)
	}
}

func TestMemorySetAnywayWithNothingChosenReplacesNothing(t *testing.T) {
	m := &CouncilMemory{}
	m.Hold(CouncilMemoryCard{Text: "B", How: DirectionWritten, Edited: true})
	if err := m.SetAnyway(300); err != nil {
		t.Fatalf("SetAnyway: %v", err)
	}
	if m.Chosen == nil || m.Chosen.Text != "B" || len(m.Replaced) != 0 {
		t.Errorf("chosen %+v replaced %+v, want B chosen and nothing replaced", m.Chosen, m.Replaced)
	}
}

func TestMemoryHoldReplacesAnEarlierHeldCard(t *testing.T) {
	m := &CouncilMemory{}
	m.Hold(CouncilMemoryCard{Text: "first"})
	m.Hold(CouncilMemoryCard{Text: "second"})
	if m.Held == nil || m.Held.Text != "second" {
		t.Errorf("held %+v, want the second card", m.Held)
	}
}

func TestMemorySetAnywayWithNothingHeldFails(t *testing.T) {
	m := &CouncilMemory{Changed: 9}
	m.Choose(dir("A", DirectionPin), EndReplaced, 100)
	err := m.SetAnyway(300)
	if err == nil || !strings.Contains(err.Error(), "held") {
		t.Fatalf("SetAnyway with nothing held: %v, want an error naming the missing held card", err)
	}
	if m.Chosen.Text != "A" || m.Changed != 100 || len(m.Replaced) != 0 {
		t.Errorf("a refused SetAnyway changed the memory: %+v", m)
	}
}

func TestMemoryDiscard(t *testing.T) {
	m := &CouncilMemory{}
	m.Choose(dir("A", DirectionPin), EndReplaced, 100)
	m.Hold(CouncilMemoryCard{Text: "B"})
	if err := m.Discard(); err != nil {
		t.Fatalf("Discard: %v", err)
	}
	if m.Held != nil {
		t.Errorf("Discard left the held card %+v", m.Held)
	}
	if m.Chosen.Text != "A" || m.Changed != 100 || len(m.Replaced) != 0 {
		t.Errorf("Discard changed the direction: %+v", m)
	}
}

func TestMemoryDiscardWithNothingHeldFails(t *testing.T) {
	m := &CouncilMemory{}
	err := m.Discard()
	if err == nil || !strings.Contains(err.Error(), "held") {
		t.Fatalf("Discard with nothing held: %v, want an error naming the missing held card", err)
	}
}

func TestMemoryRaiseThenAccept(t *testing.T) {
	m := &CouncilMemory{}
	m.Choose(dir("A", DirectionPin), EndReplaced, 100)
	ok := m.Raise(CouncilMemoryCard{Text: "B", Reason: "the seats converged", Source: SourceCheck, Round: 3, From: "r9", At: 150})
	if !ok || m.Suggestion == nil || m.Suggestion.Kind != CardSuggestion || m.Suggestion.Text != "B" {
		t.Fatalf("Raise: ok %v, suggestion %+v, want a suggestion card for B", ok, m.Suggestion)
	}
	if m.Chosen.Text != "A" || m.Changed != 100 {
		t.Fatalf("Raise changed the direction: %+v changed %d", m.Chosen, m.Changed)
	}

	if err := m.Accept(400); err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if m.Suggestion != nil {
		t.Errorf("Accept left the suggestion %+v", m.Suggestion)
	}
	got := *m.Chosen
	want := CouncilMemoryDirection{Text: "B", How: DirectionSuggested, Source: SourceCheck, Round: 3, From: "r9", At: 400}
	if got != want {
		t.Errorf("chosen after Accept: %+v, want %+v", got, want)
	}
	if len(m.Replaced) != 1 || m.Replaced[0].Text != "A" || m.Replaced[0].Ended != EndReplaced || m.Replaced[0].Replaced != 400 {
		t.Errorf("Replaced after Accept: %+v, want A ended %q at 400", m.Replaced, EndReplaced)
	}
	if m.Changed != 400 {
		t.Errorf("Changed %d, want 400", m.Changed)
	}
}

func TestMemoryAcceptWithNoneWaitingFails(t *testing.T) {
	m := &CouncilMemory{}
	m.Choose(dir("A", DirectionPin), EndReplaced, 100)
	err := m.Accept(400)
	if err == nil || !strings.Contains(err.Error(), "suggestion") {
		t.Fatalf("Accept with none waiting: %v, want an error naming the missing suggestion", err)
	}
	if m.Chosen.Text != "A" || m.Changed != 100 || len(m.Replaced) != 0 {
		t.Errorf("a refused Accept changed the memory: %+v", m)
	}
}

func TestMemoryDismissedSuggestionIsNotRaisedAgain(t *testing.T) {
	t.Run("all green, by idea", func(t *testing.T) {
		m := &CouncilMemory{}
		if !m.Raise(CouncilMemoryCard{Text: "ship P3", Source: SourceGreen, From: "P3"}) {
			t.Fatal("the first Raise was refused")
		}
		if err := m.Dismiss(); err != nil {
			t.Fatalf("Dismiss: %v", err)
		}
		if m.Suggestion != nil {
			t.Errorf("Dismiss left the suggestion %+v", m.Suggestion)
		}
		if !reflect.DeepEqual(m.Dismissed, []string{"idea:P3"}) {
			t.Errorf("Dismissed %v, want [idea:P3]", m.Dismissed)
		}
		// the same idea, even reworded, stays dismissed
		if m.Raise(CouncilMemoryCard{Text: "ship P3 first", Source: SourceGreen, From: "P3"}) {
			t.Errorf("a dismissed idea was raised again")
		}
		if m.Suggestion != nil {
			t.Errorf("a refused Raise filled the slot: %+v", m.Suggestion)
		}
		// another idea is not
		if !m.Raise(CouncilMemoryCard{Text: "ship P4", Source: SourceGreen, From: "P4"}) {
			t.Errorf("a different idea was refused")
		}
	})
	t.Run("check, by text", func(t *testing.T) {
		m := &CouncilMemory{}
		if !m.Raise(CouncilMemoryCard{Text: "Cut the scope  to v1", Source: SourceCheck, Round: 2}) {
			t.Fatal("the first Raise was refused")
		}
		if err := m.Dismiss(); err != nil {
			t.Fatalf("Dismiss: %v", err)
		}
		if !reflect.DeepEqual(m.Dismissed, []string{"text:cut the scope to v1"}) {
			t.Errorf("Dismissed %v, want [text:cut the scope to v1]", m.Dismissed)
		}
		// the same words in another case and spacing, from a later round
		if m.Raise(CouncilMemoryCard{Text: " cut the SCOPE to v1 ", Source: SourceCheck, Round: 4}) {
			t.Errorf("a dismissed text was raised again")
		}
		if !m.Raise(CouncilMemoryCard{Text: "Cut the scope to v2", Source: SourceCheck, Round: 4}) {
			t.Errorf("a different text was refused")
		}
	})
}

func TestMemoryNewerSuggestionReplacesAWaitingOneWithoutDismissingIt(t *testing.T) {
	m := &CouncilMemory{}
	m.Raise(CouncilMemoryCard{Text: "first", Source: SourceCheck, Round: 1})
	if !m.Raise(CouncilMemoryCard{Text: "second", Source: SourceCheck, Round: 2}) {
		t.Fatal("the newer suggestion was refused")
	}
	if m.Suggestion == nil || m.Suggestion.Text != "second" {
		t.Fatalf("suggestion %+v, want the newer one", m.Suggestion)
	}
	if len(m.Dismissed) != 0 {
		t.Errorf("a pushed-out suggestion was dismissed: %v", m.Dismissed)
	}
	// so the pushed-out one can come back
	if !m.Raise(CouncilMemoryCard{Text: "first", Source: SourceCheck, Round: 3}) {
		t.Errorf("a pushed-out suggestion could not be raised again")
	}
}

func TestMemoryRaiseRefusesTheChosenText(t *testing.T) {
	m := &CouncilMemory{}
	m.Choose(dir("Cut the scope to v1", DirectionPin), EndReplaced, 100)
	m.Raise(CouncilMemoryCard{Text: "waiting", Source: SourceCheck})
	if m.Raise(CouncilMemoryCard{Text: "  cut the scope TO v1", Source: SourceCheck, Round: 2}) {
		t.Errorf("a suggestion of the chosen direction's own text was raised")
	}
	if m.Suggestion == nil || m.Suggestion.Text != "waiting" {
		t.Errorf("a refused Raise changed the waiting suggestion: %+v", m.Suggestion)
	}
	if len(m.Dismissed) != 0 {
		t.Errorf("a refused Raise dismissed something: %v", m.Dismissed)
	}
}

func TestMemorySuggestionNeverClearsTheHeldCard(t *testing.T) {
	m := &CouncilMemory{}
	m.Hold(CouncilMemoryCard{Text: "held", How: DirectionPin})
	m.Raise(CouncilMemoryCard{Text: "first", Source: SourceCheck})
	m.Raise(CouncilMemoryCard{Text: "second", Source: SourceCheck})
	if m.Held == nil || m.Held.Text != "held" {
		t.Errorf("a suggestion changed the held card: %+v", m.Held)
	}
	if err := m.Dismiss(); err != nil {
		t.Fatalf("Dismiss: %v", err)
	}
	if m.Held == nil || m.Held.Text != "held" {
		t.Errorf("Dismiss changed the held card: %+v", m.Held)
	}
}

func TestMemoryDismissWithNoneWaitingFails(t *testing.T) {
	m := &CouncilMemory{}
	err := m.Dismiss()
	if err == nil || !strings.Contains(err.Error(), "suggestion") {
		t.Fatalf("Dismiss with none waiting: %v, want an error naming the missing suggestion", err)
	}
	if len(m.Dismissed) != 0 {
		t.Errorf("a refused Dismiss recorded %v", m.Dismissed)
	}
}

func TestMemorySuggestionKey(t *testing.T) {
	for _, tc := range []struct {
		name string
		card CouncilMemoryCard
		want string
	}{
		{"all green", CouncilMemoryCard{Source: SourceGreen, From: "P3", Text: "Anything"}, "idea:P3"},
		{"check", CouncilMemoryCard{Source: SourceCheck, Text: "Cut  the\tScope"}, "text:cut the scope"},
		{"check with an idea named", CouncilMemoryCard{Source: SourceCheck, From: "P3", Text: "Same"}, "text:same"},
		{"no source", CouncilMemoryCard{Text: " Same "}, "text:same"},
		{"green without an idea falls to its text", CouncilMemoryCard{Source: SourceGreen, Text: "Same"}, "text:same"},
	} {
		if got := SuggestionKey(tc.card); got != tc.want {
			t.Errorf("%s: SuggestionKey = %q, want %q", tc.name, got, tc.want)
		}
	}
}

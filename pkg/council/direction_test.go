// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

const (
	fitsReply   = `{"verdict":"fits","reason":"It matches where the seats stand."}`
	clashReply  = `{"verdict":"clashes","reason":"The seats agreed on polling less."}`
	unclearBody = `{"verdict":"unclear","reason":"Which service does it mean?"}`
)

// directionRig is a saved council and a runner whose caller answers every check with one reply. events counts the
// council:changed announcements the runner itself makes: Direction makes none, the command that calls it does.
type directionRig struct {
	r      *Runner
	f      *routerCaller
	events int
}

func newDirectionRig(t *testing.T, c *Council, reply string) *directionRig {
	t.Helper()
	t.Cleanup(UseRootForTest(t.TempDir()))
	if err := Save(c); err != nil {
		t.Fatal(err)
	}
	rig := &directionRig{f: &routerCaller{res: CallRes{Text: reply, Tokens: 9}}}
	rig.r = &Runner{Caller: rig.f, Now: func() int64 { return 5000 }, OnChange: func(*Council) { rig.events++ }}
	return rig
}

func (g *directionRig) saved(t *testing.T) *Council {
	t.Helper()
	c, err := Load("c1")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// chosenCouncil is the fixture council with a direction already chosen.
func chosenCouncil() *Council {
	c := fixtureCouncil("c1", StateDone, 2)
	MemoryOf(c).Choose(CouncilMemoryDirection{Text: "Poll less", How: DirectionPin, From: "P2"}, "", 100)
	return c
}

// TestDirectionSetThatFitsIsSet: a typed direction the check says fits becomes the chosen one at once, the old one moves
// to Replaced, the check's one call and its tokens are on the council's totals, and Direction announces nothing itself.
func TestDirectionSetThatFitsIsSet(t *testing.T) {
	g := newDirectionRig(t, chosenCouncil(), fitsReply)
	c, err := g.r.Direction("c1", DirectionIn{Action: ActionSet, Text: "  Show the sleep badge first  "})
	if err != nil {
		t.Fatal(err)
	}
	m := c.Memory
	if m == nil || m.Chosen == nil || m.Chosen.Text != "Show the sleep badge first" || m.Chosen.How != DirectionWritten || m.Chosen.At != 5000 {
		t.Fatalf("chosen = %+v, want the typed text, written, set now", m)
	}
	if len(m.Replaced) != 1 || m.Replaced[0].Text != "Poll less" || m.Replaced[0].Ended != EndReplaced || m.Replaced[0].Replaced != 5000 {
		t.Errorf("replaced = %+v, want Poll less, ended replaced now", m.Replaced)
	}
	if m.Held != nil || m.Changed != 5000 {
		t.Errorf("held = %+v changed = %d, want no held card and Changed now", m.Held, m.Changed)
	}
	if len(g.f.reqs) != 1 {
		t.Fatalf("%d model calls, want exactly the one check", len(g.f.reqs))
	}
	if req := g.f.reqs[0]; req.Tools || req.Expert.Model != ModelRouter || req.Cwd != c.Project {
		t.Errorf("check request = tools %v model %q cwd %q, want no tools on %s in the project", req.Tools, req.Expert.Model, req.Cwd, ModelRouter)
	}
	if c.Calls != 1 || c.Tokens != 9 {
		t.Errorf("calls %d tokens %d, want the check's 1 call and 9 tokens on the council", c.Calls, c.Tokens)
	}
	if got := g.saved(t); got.Memory == nil || got.Memory.Chosen == nil || got.Memory.Chosen.Text != "Show the sleep badge first" || got.Calls != 1 {
		t.Errorf("saved council = %+v, want what Direction returned", got.Memory)
	}
	if g.events != 0 {
		t.Errorf("%d announcements by the runner, want 0: CouncilDirectionCommand publishes the one", g.events)
	}
}

func TestDirectionPinThatFitsKeepsWhereItCameFrom(t *testing.T) {
	g := newDirectionRig(t, fixtureCouncil("c1", StateDone, 2), fitsReply)
	c, err := g.r.Direction("c1", DirectionIn{Action: "PIN", Text: "Title from ram", From: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	if d := c.Memory.Chosen; d == nil || d.How != DirectionPin || d.From != "P2" || d.Text != "Title from ram" {
		t.Errorf("chosen = %+v, want a pin from P2", d)
	}
	if len(c.Memory.Replaced) != 0 {
		t.Errorf("replaced = %+v, want none: nothing was chosen before", c.Memory.Replaced)
	}
}

func TestDirectionPinFromAMessage(t *testing.T) {
	g := newDirectionRig(t, fixtureCouncil("c1", StateDone, 2), fitsReply)
	c, err := g.r.Direction("c1", DirectionIn{Action: ActionPin, Text: "It breaks.", From: "r1"})
	if err != nil {
		t.Fatal(err)
	}
	if d := c.Memory.Chosen; d == nil || d.From != "r1" {
		t.Errorf("chosen = %+v, want a pin from the message r1", d)
	}
}

func TestDirectionPinFromNothingIsRefused(t *testing.T) {
	g := newDirectionRig(t, fixtureCouncil("c1", StateDone, 2), fitsReply)
	_, err := g.r.Direction("c1", DirectionIn{Action: ActionPin, Text: "x", From: "P99"})
	if err == nil || !strings.Contains(err.Error(), "P99") {
		t.Fatalf("err = %v, want one naming P99", err)
	}
	if got := g.saved(t); got.Memory != nil || got.Calls != 0 || len(g.f.reqs) != 0 {
		t.Errorf("a refused pin left %+v, calls %d, %d model calls", got.Memory, got.Calls, len(g.f.reqs))
	}
}

// TestDirectionSetThatClashesIsHeldWithTheReason: nothing is set, the held card has the check's line, and the chosen
// direction stays as it was.
func TestDirectionSetThatClashesIsHeldWithTheReason(t *testing.T) {
	for name, tc := range map[string]struct{ reply, reason string }{
		"a clash":      {clashReply, "The seats agreed on polling less."},
		"unclear":      {unclearBody, "Which service does it mean?"},
		"no reason":    {`{"verdict":"clashes"}`, presetNoReason[CheckClashes]},
		"unclear bare": {`{"verdict":"unclear"}`, presetNoReason[CheckUnclear]},
	} {
		t.Run(name, func(t *testing.T) {
			g := newDirectionRig(t, chosenCouncil(), tc.reply)
			c, err := g.r.Direction("c1", DirectionIn{Action: ActionSet, Text: "Poll more"})
			if err != nil {
				t.Fatal(err)
			}
			m := c.Memory
			if m.Chosen == nil || m.Chosen.Text != "Poll less" || len(m.Replaced) != 0 {
				t.Errorf("chosen = %+v replaced = %+v, want the old direction untouched", m.Chosen, m.Replaced)
			}
			h := m.Held
			if h == nil || h.Kind != CardHeld || h.Text != "Poll more" || h.Reason != tc.reason || h.How != DirectionWritten || h.Edited || h.At != 5000 {
				t.Errorf("held = %+v, want the typed text held with %q", h, tc.reason)
			}
			if c.Calls != 1 || c.Tokens != 9 {
				t.Errorf("calls %d tokens %d, want the check booked", c.Calls, c.Tokens)
			}
		})
	}
}

func TestDirectionPinThatClashesIsHeldAsAPin(t *testing.T) {
	g := newDirectionRig(t, fixtureCouncil("c1", StateDone, 2), clashReply)
	c, err := g.r.Direction("c1", DirectionIn{Action: ActionPin, Text: "Title from ram", From: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	if h := c.Memory.Held; h == nil || h.How != DirectionPin || h.From != "P2" || h.Reason == "" {
		t.Errorf("held = %+v, want a held pin from P2 with the reason", h)
	}
	if c.Memory.Chosen != nil {
		t.Errorf("chosen = %+v, want nothing set until the person picks", c.Memory.Chosen)
	}
}

// TestDirectionACheckThatFailsHoldsAndNeverSets: an error, an empty reply, a reply that is no JSON and a runner with no
// caller each hold the direction with `The check did not answer: <error>`.
func TestDirectionACheckThatFailsHoldsAndNeverSets(t *testing.T) {
	boom := errors.New("claude is not signed in")
	for name, tc := range map[string]struct {
		rig       func(g *directionRig)
		wantInMsg string
		calls     int
	}{
		"an error":      {func(g *directionRig) { g.f.err = boom }, "claude is not signed in", 1},
		"an empty body": {func(g *directionRig) { g.f.res.Text = "  " }, "empty reply", 1},
		"no JSON":       {func(g *directionRig) { g.f.res.Text = "It fits." }, "no JSON", 1},
		"a bad verdict": {func(g *directionRig) { g.f.res.Text = `{"verdict":"maybe"}` }, "maybe", 1},
		"no caller":     {func(g *directionRig) { g.r.Caller = nil }, "no caller", 0},
	} {
		t.Run(name, func(t *testing.T) {
			g := newDirectionRig(t, chosenCouncil(), fitsReply)
			tc.rig(g)
			c, err := g.r.Direction("c1", DirectionIn{Action: ActionSet, Text: "Poll more"})
			if err != nil {
				t.Fatalf("Direction: %v: a failed check holds the direction, it is not an error", err)
			}
			m := c.Memory
			if m.Chosen == nil || m.Chosen.Text != "Poll less" {
				t.Fatalf("chosen = %+v, want the old direction: a failed check never sets one", m.Chosen)
			}
			h := m.Held
			if h == nil || h.Text != "Poll more" || !strings.HasPrefix(h.Reason, "The check did not answer: ") || !strings.Contains(h.Reason, tc.wantInMsg) {
				t.Errorf("held = %+v, want The check did not answer: …%s…", h, tc.wantInMsg)
			}
			if int(c.Calls) != tc.calls {
				t.Errorf("calls = %d, want %d: a call that was made is booked, one never made is not", c.Calls, tc.calls)
			}
		})
	}
}

func TestDirectionAFailedCheckKeepsTheTokensItSpent(t *testing.T) {
	g := newDirectionRig(t, chosenCouncil(), "")
	g.f.res = CallRes{Text: "It fits, I think.", Tokens: 40}
	c, err := g.r.Direction("c1", DirectionIn{Action: ActionSet, Text: "Poll more"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Tokens != 40 || c.Calls != 1 {
		t.Errorf("calls %d tokens %d, want the unusable reply's 40 tokens booked", c.Calls, c.Tokens)
	}
}

// TestDirectionACheckThatHangsTimesOutAndHolds: the check is bounded, and a timeout is a check that did not answer.
func TestDirectionACheckThatHangsTimesOutAndHolds(t *testing.T) {
	prev := checkTimeout
	checkTimeout = 20 * time.Millisecond
	t.Cleanup(func() { checkTimeout = prev })
	g := newDirectionRig(t, chosenCouncil(), fitsReply)
	g.r.Caller = blockingCaller{}
	done := make(chan *Council, 1)
	go func() {
		c, err := g.r.Direction("c1", DirectionIn{Action: ActionSet, Text: "Poll more"})
		if err != nil {
			t.Errorf("Direction: %v", err)
		}
		done <- c
	}()
	select {
	case c := <-done:
		if c == nil || c.Memory.Held == nil || !strings.HasPrefix(c.Memory.Held.Reason, "The check did not answer: ") {
			t.Fatalf("held = %+v, want a held direction after the timeout", c)
		}
		if c.Memory.Chosen == nil || c.Memory.Chosen.Text != "Poll less" {
			t.Errorf("chosen = %+v, want the old direction", c.Memory.Chosen)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Direction never came back from a check that hangs")
	}
}

type blockingCaller struct{}

func (blockingCaller) Call(ctx context.Context, req CallReq) (CallRes, error) {
	<-ctx.Done()
	return CallRes{}, ctx.Err()
}

// TestDirectionEditThatFitsEndsTheOldOneAsEdited: Edit is a new direction from the new text; the old one moves to
// Replaced marked `edited`.
func TestDirectionEditThatFitsEndsTheOldOneAsEdited(t *testing.T) {
	g := newDirectionRig(t, chosenCouncil(), fitsReply)
	c, err := g.r.Direction("c1", DirectionIn{Action: ActionEdit, Text: "Poll less, and say so"})
	if err != nil {
		t.Fatal(err)
	}
	m := c.Memory
	if m.Chosen == nil || m.Chosen.Text != "Poll less, and say so" {
		t.Fatalf("chosen = %+v, want the edited text", m.Chosen)
	}
	if m.Chosen.How != DirectionPin || m.Chosen.From != "P2" {
		t.Errorf("chosen = %+v, want the pin and its source kept: an edit of a pin is still that idea's", m.Chosen)
	}
	if len(m.Replaced) != 1 || m.Replaced[0].Text != "Poll less" || m.Replaced[0].Ended != EndEdited {
		t.Errorf("replaced = %+v, want the old text ended edited", m.Replaced)
	}
	if len(g.f.reqs) != 1 {
		t.Errorf("%d model calls, want the one pre-set check: an edit goes through it", len(g.f.reqs))
	}
}

func TestDirectionEditOfASuggestedOneIsWrittenByThePerson(t *testing.T) {
	c := fixtureCouncil("c1", StateDone, 2)
	MemoryOf(c).Choose(CouncilMemoryDirection{Text: "Back P1", How: DirectionSuggested, Source: SourceGreen, From: "P1", Round: 2}, "", 100)
	g := newDirectionRig(t, c, fitsReply)
	got, err := g.r.Direction("c1", DirectionIn{Action: ActionEdit, Text: "Back P1 but smaller"})
	if err != nil {
		t.Fatal(err)
	}
	if d := got.Memory.Chosen; d == nil || d.How != DirectionWritten || d.From != "" || d.Source != "" || d.Round != 0 {
		t.Errorf("chosen = %+v, want a written direction with no suggestion source: the person wrote these words", d)
	}
}

// TestDirectionEditThatClashesIsHeldAsEdited: a held edit is marked Edited, so setting it anyway ends the old one as
// edited, and the chosen direction stays meanwhile.
func TestDirectionEditThatClashesIsHeldAsEdited(t *testing.T) {
	g := newDirectionRig(t, chosenCouncil(), clashReply)
	c, err := g.r.Direction("c1", DirectionIn{Action: ActionEdit, Text: "Poll more"})
	if err != nil {
		t.Fatal(err)
	}
	m := c.Memory
	if m.Chosen == nil || m.Chosen.Text != "Poll less" {
		t.Errorf("chosen = %+v, want the old text until the person picks", m.Chosen)
	}
	if m.Held == nil || !m.Held.Edited || m.Held.Text != "Poll more" || m.Held.Reason == "" {
		t.Fatalf("held = %+v, want an edited card with the reason", m.Held)
	}
	got, err := g.r.Direction("c1", DirectionIn{Action: ActionSetAnyway})
	if err != nil {
		t.Fatal(err)
	}
	if got.Memory.Chosen.Text != "Poll more" || len(got.Memory.Replaced) != 1 || got.Memory.Replaced[0].Ended != EndEdited || got.Memory.Held != nil {
		t.Errorf("after set anyway: chosen %+v replaced %+v held %+v, want the edit set and the old one ended edited", got.Memory.Chosen, got.Memory.Replaced, got.Memory.Held)
	}
	if len(g.f.reqs) != 1 {
		t.Errorf("%d model calls, want 1: set anyway makes no check", len(g.f.reqs))
	}
}

// TestDirectionEditWithNothingChosenIsRefused: no direction to edit is an error naming it, before any call, and saves
// nothing.
func TestDirectionEditWithNothingChosenIsRefused(t *testing.T) {
	g := newDirectionRig(t, fixtureCouncil("c1", StateDone, 2), fitsReply)
	c, err := g.r.Direction("c1", DirectionIn{Action: ActionEdit, Text: "Poll more"})
	if err == nil || c != nil || !strings.Contains(err.Error(), "no direction is chosen") {
		t.Fatalf("got %v, %v, want no council and an error saying no direction is chosen", c, err)
	}
	if got := g.saved(t); got.Memory != nil || got.Calls != 0 || len(g.f.reqs) != 0 {
		t.Errorf("a refused edit left %+v, calls %d, %d model calls", got.Memory, got.Calls, len(g.f.reqs))
	}
}

// TestDirectionRefusesEmptyText: set, pin and edit with no words are an error naming the action, and save and call
// nothing.
func TestDirectionRefusesEmptyText(t *testing.T) {
	for _, action := range []string{ActionSet, ActionPin, ActionEdit} {
		for _, text := range []string{"", "  \n\t "} {
			g := newDirectionRig(t, chosenCouncil(), fitsReply)
			before := g.saved(t)
			c, err := g.r.Direction("c1", DirectionIn{Action: action, Text: text, From: "P1"})
			if err == nil || c != nil {
				t.Errorf("%s with %q: got %v, %v, want an error", action, text, c, err)
				continue
			}
			if !strings.Contains(err.Error(), action) || !strings.Contains(err.Error(), "text") {
				t.Errorf("%s with %q: error %q should name the action and say it needs text", action, text, err)
			}
			got := g.saved(t)
			if got.Calls != 0 || len(g.f.reqs) != 0 || got.Memory.Chosen.Text != before.Memory.Chosen.Text || got.Memory.Held != nil {
				t.Errorf("%s with %q: a refused action changed the council or made a call", action, text)
			}
		}
	}
}

func TestDirectionRefusesAMissingCouncilBeforeAnyCall(t *testing.T) {
	g := newDirectionRig(t, fixtureCouncil("c1", StateDone, 2), fitsReply)
	for _, action := range directionActions {
		if c, err := g.r.Direction("nope", DirectionIn{Action: action, Text: "x"}); err == nil || c != nil {
			t.Errorf("%s on a council that is not there: got %v, %v, want an error", action, c, err)
		}
	}
	if len(g.f.reqs) != 0 {
		t.Errorf("%d model calls for a council that is not there, want 0", len(g.f.reqs))
	}
}

// TestDirectionASettledDirectionClearsTheHeldSlot: set, pin and edit that fit all settle any held card (spec: Fits), so
// the lead's path held -> Edit -> Set leaves no held card behind.
func TestDirectionASettledDirectionClearsTheHeldSlot(t *testing.T) {
	for _, in := range []DirectionIn{
		{Action: ActionSet, Text: "New words"},
		{Action: ActionPin, Text: "New words", From: "P1"},
		{Action: ActionEdit, Text: "New words"},
	} {
		c := chosenCouncil()
		MemoryOf(c).Hold(CouncilMemoryCard{Text: "Held words", Reason: "It clashes.", How: DirectionWritten, At: 50})
		g := newDirectionRig(t, c, fitsReply)
		got, err := g.r.Direction("c1", in)
		if err != nil {
			t.Fatalf("%s: %v", in.Action, err)
		}
		if got.Memory.Held != nil || got.Memory.Chosen.Text != "New words" {
			t.Errorf("%s: held %+v chosen %+v, want the held slot cleared and the new words chosen", in.Action, got.Memory.Held, got.Memory.Chosen)
		}
	}
}

func TestDirectionHeldThenEditThenSetThatFitsLeavesNothingHeld(t *testing.T) {
	g := newDirectionRig(t, chosenCouncil(), clashReply)
	c, err := g.r.Direction("c1", DirectionIn{Action: ActionSet, Text: "Poll more"})
	if err != nil || c.Memory.Held == nil {
		t.Fatalf("set: %v held %+v, want a held card", err, c.Memory)
	}
	// Edit on the held card puts its text back in the input; the person rewrites it and Sets again, and this time it fits
	g.f.res.Text = fitsReply
	c, err = g.r.Direction("c1", DirectionIn{Action: ActionSet, Text: "Poll a bit more, only when idle"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Memory.Held != nil {
		t.Errorf("held = %+v, want nil: a direction that fits settles the held card", c.Memory.Held)
	}
	if c.Memory.Chosen == nil || c.Memory.Chosen.Text != "Poll a bit more, only when idle" {
		t.Errorf("chosen = %+v, want the rewritten direction", c.Memory.Chosen)
	}
}

// TestDirectionASuggestionWaitsThroughASetOrAPin: typing or pinning leaves a waiting suggestion where it is.
func TestDirectionASuggestionWaitsThroughASetOrAPin(t *testing.T) {
	c := fixtureCouncil("c1", StateDone, 2)
	MemoryOf(c).Raise(CouncilMemoryCard{Text: "Back P1", Source: SourceCheck, Round: 2, Messages: []string{"r1"}, At: 60})
	g := newDirectionRig(t, c, fitsReply)
	got, err := g.r.Direction("c1", DirectionIn{Action: ActionSet, Text: "Poll less"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Memory.Suggestion == nil || got.Memory.Suggestion.Text != "Back P1" {
		t.Errorf("suggestion = %+v, want it still waiting", got.Memory.Suggestion)
	}
}

// TestDirectionSetAnywayAndDiscard: the held card is the person's to settle, with no check.
func TestDirectionSetAnywayAndDiscard(t *testing.T) {
	held := func() *Council {
		c := chosenCouncil()
		MemoryOf(c).Hold(CouncilMemoryCard{Text: "Poll more", Reason: "It clashes.", How: DirectionPin, From: "P1", At: 50})
		return c
	}
	g := newDirectionRig(t, held(), fitsReply)
	c, err := g.r.Direction("c1", DirectionIn{Action: ActionSetAnyway})
	if err != nil {
		t.Fatal(err)
	}
	m := c.Memory
	if m.Chosen == nil || m.Chosen.Text != "Poll more" || m.Chosen.How != DirectionPin || m.Chosen.From != "P1" || m.Held != nil {
		t.Errorf("after set anyway: chosen %+v held %+v, want the held pin set", m.Chosen, m.Held)
	}
	if len(m.Replaced) != 1 || m.Replaced[0].Ended != EndReplaced {
		t.Errorf("replaced = %+v, want Poll less ended replaced", m.Replaced)
	}
	if len(g.f.reqs) != 0 || c.Calls != 0 {
		t.Errorf("%d model calls, calls %d: set anyway makes no check", len(g.f.reqs), c.Calls)
	}

	g = newDirectionRig(t, held(), fitsReply)
	c, err = g.r.Direction("c1", DirectionIn{Action: ActionDiscard})
	if err != nil {
		t.Fatal(err)
	}
	if c.Memory.Held != nil || c.Memory.Chosen == nil || c.Memory.Chosen.Text != "Poll less" || len(c.Memory.Replaced) != 0 {
		t.Errorf("after discard: held %+v chosen %+v replaced %+v, want the held card gone and nothing else changed", c.Memory.Held, c.Memory.Chosen, c.Memory.Replaced)
	}
	if len(g.f.reqs) != 0 {
		t.Errorf("%d model calls on discard, want 0", len(g.f.reqs))
	}
}

// TestDirectionAcceptTakesTheSuggestionWithNoCheck: no model call, the suggestion's source and round on the direction.
func TestDirectionAcceptTakesTheSuggestionWithNoCheck(t *testing.T) {
	c := chosenCouncil()
	MemoryOf(c).Raise(CouncilMemoryCard{Text: "Back P1", Reason: "Three seats back it.", Source: SourceCheck, Round: 2, Messages: []string{"r1"}, At: 60})
	g := newDirectionRig(t, c, clashReply) // a check, if it ran, would hold it
	got, err := g.r.Direction("c1", DirectionIn{Action: ActionAccept})
	if err != nil {
		t.Fatal(err)
	}
	d := got.Memory.Chosen
	if d == nil || d.Text != "Back P1" || d.How != DirectionSuggested || d.Source != SourceCheck || d.Round != 2 {
		t.Errorf("chosen = %+v, want the suggestion set as suggested, from the check after round 2", d)
	}
	if got.Memory.Suggestion != nil || got.Memory.Held != nil {
		t.Errorf("suggestion %+v held %+v, want both empty", got.Memory.Suggestion, got.Memory.Held)
	}
	if len(g.f.reqs) != 0 || got.Calls != 0 {
		t.Errorf("%d model calls, calls %d: accepting a suggestion sets it with no further check", len(g.f.reqs), got.Calls)
	}
}

// TestDirectionDismissThenTheSameSuggestionIsNotRaisedAgain: dismiss records the key, and Raise refuses the same text in
// another case and the same idea.
func TestDirectionDismissThenTheSameSuggestionIsNotRaisedAgain(t *testing.T) {
	c := fixtureCouncil("c1", StateDone, 2)
	MemoryOf(c).Raise(CouncilMemoryCard{Text: "Back P1", Source: SourceCheck, Round: 2, At: 60})
	g := newDirectionRig(t, c, fitsReply)
	got, err := g.r.Direction("c1", DirectionIn{Action: ActionDismiss})
	if err != nil {
		t.Fatal(err)
	}
	if got.Memory.Suggestion != nil || len(got.Memory.Dismissed) != 1 {
		t.Fatalf("suggestion %+v dismissed %v, want it cleared and its key kept", got.Memory.Suggestion, got.Memory.Dismissed)
	}
	if got.Memory.Raise(CouncilMemoryCard{Text: "  back   P1 ", Source: SourceCheck}) {
		t.Error("the same suggestion, in another case and spacing, was raised again")
	}
	if len(g.f.reqs) != 0 {
		t.Errorf("%d model calls on dismiss, want 0", len(g.f.reqs))
	}
}

func TestDirectionUnpin(t *testing.T) {
	g := newDirectionRig(t, chosenCouncil(), fitsReply)
	c, err := g.r.Direction("c1", DirectionIn{Action: ActionUnpin})
	if err != nil {
		t.Fatal(err)
	}
	if c.Memory.Chosen != nil || len(c.Memory.Replaced) != 1 || c.Memory.Replaced[0].Ended != EndUnpinned {
		t.Errorf("chosen %+v replaced %+v, want it moved to Replaced as unpinned", c.Memory.Chosen, c.Memory.Replaced)
	}
	if len(g.f.reqs) != 0 {
		t.Errorf("%d model calls on unpin, want 0", len(g.f.reqs))
	}
}

// TestDirectionTheMovesThatHaveNothingToActOnAreRefused: each says what is missing, and saves nothing.
func TestDirectionTheMovesThatHaveNothingToActOnAreRefused(t *testing.T) {
	for action, want := range map[string]string{
		ActionAccept:    "no suggestion is waiting",
		ActionDismiss:   "no suggestion is waiting",
		ActionSetAnyway: "no direction is held",
		ActionDiscard:   "no direction is held",
		ActionUnpin:     "no direction is chosen",
	} {
		g := newDirectionRig(t, fixtureCouncil("c1", StateDone, 2), fitsReply)
		c, err := g.r.Direction("c1", DirectionIn{Action: action})
		if err == nil || c != nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v, %v, want an error saying %q", action, c, err, want)
		}
		if got := g.saved(t); got.Memory != nil {
			t.Errorf("%s: a refused move left a memory behind: %+v", action, got.Memory)
		}
	}
}

// TestDirectionRefusesAnUnknownAction: a word that is not one of the eight actions is refused with an error naming it,
// and nothing is saved, so a typo never reads as a silent no-op.
func TestDirectionRefusesAnUnknownAction(t *testing.T) {
	t.Cleanup(UseRootForTest(t.TempDir()))
	if err := Save(&Council{Id: "c1", State: StateDone}); err != nil {
		t.Fatal(err)
	}
	r := &Runner{}
	for _, action := range []string{"", "chot", "SETX", "replace"} {
		c, err := r.Direction("c1", DirectionIn{Action: action, Text: "ship the small one"})
		if err == nil {
			t.Fatalf("action %q should be refused", action)
		}
		if c != nil {
			t.Errorf("action %q: a refused direction returned a council", action)
		}
		if !strings.Contains(err.Error(), "direction action") {
			t.Errorf("action %q: error %q should say it is an unknown direction action", action, err)
		}
	}
	got, err := Load("c1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Memory != nil {
		t.Errorf("a refused direction left a memory behind: %+v", got.Memory)
	}
}

// TestDirectionActionWordsAreTheEightTheWireNames: the constants are the words the command and the frontend send.
func TestDirectionActionWordsAreTheEightTheWireNames(t *testing.T) {
	want := map[string]string{
		ActionSet: "set", ActionPin: "pin", ActionEdit: "edit", ActionAccept: "accept",
		ActionDismiss: "dismiss", ActionSetAnyway: "setanyway", ActionDiscard: "discard", ActionUnpin: "unpin",
	}
	for got, w := range want {
		if got != w {
			t.Errorf("action constant = %q, want %q", got, w)
		}
	}
	if len(want) != 8 {
		t.Errorf("%d distinct action words, want 8", len(want))
	}
}

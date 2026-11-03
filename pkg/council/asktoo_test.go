// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"reflect"
	"strings"
	"testing"
)

// routedCouncil is a council in state as a run left it, holding the person's whole-council message r3 that the router
// sent to UX alone, which UX answered (r4), and a few replies Ask <seat> too must refuse.
func routedCouncil(id string, state CouncilState) *Council {
	c := fixtureCouncil(id, state, 3)
	c.Replies = append(c.Replies,
		CouncilReply{
			Id: "r3", Author: YouId, Text: "Why the idle timer?", To: []string{"ux"}, Answered: true, Round: 4, Ts: 4,
			Routed: &CouncilRouted{Chose: []string{"ux"}, Reason: "It is about the first-use flow."},
		},
		CouncilReply{Id: "r4", ParentId: "r3", Author: "ux", Text: "Answer from ux", Round: 4, Ts: 5},
		// a message of the person's the router never took up, as one on a proposal is
		CouncilReply{Id: "r5", ProposalId: "P1", Author: YouId, Text: "Is that so?", To: []string{"ux"}, Answered: true, Round: 4, Ts: 6},
		// a message the router has not chosen a seat for yet: To is empty meanwhile
		CouncilReply{Id: "r6", Author: YouId, Text: "And the poll rate?", Round: 4, Ts: 7, Routed: &CouncilRouted{Pending: true}},
		// a seat's reply, even one that carries a Routed, is not the person's message
		CouncilReply{Id: "r7", Author: "ux", Text: "Seat reply", To: []string{"ram"}, Round: 4, Ts: 8, Routed: &CouncilRouted{Chose: []string{"ram"}}},
	)
	return c
}

func TestAskTooAddsSeatAndStartsFollowup(t *testing.T) {
	h := newHarness(t)
	h.save(routedCouncil("c1", StateDone))

	saved, err := h.r.AskToo("c1", "r3", "ram")
	if err != nil {
		t.Fatalf("AskToo: %v", err)
	}
	if saved.State != StateRunning {
		t.Errorf("AskToo returned a %s council, want the follow-up running", saved.State)
	}
	ask := replyOf(t, saved, "r3")
	if !reflect.DeepEqual(ask.To, []string{"ux", "ram"}) || ask.Answered {
		t.Errorf("the reply saved with To %v answered %v, want [ux ram] and open", ask.To, ask.Answered)
	}

	got := h.wait("c1")
	if got.State != StateDone {
		t.Errorf("the council ended %s, want done again", got.State)
	}
	ans := h.f.calls("ans")
	if len(ans) != 1 || ans[0].Expert.Id != "ram" {
		t.Fatalf("answer calls = %d (first to %s), want one, to ram", len(ans), ans[0].Expert.Id)
	}
	mustContain(t, "ram's prompt", ans[0].Prompt, "- UX: Answer from ux", othersAnsweredRule)

	ask = replyOf(t, got, "r3")
	if want := []string{"ux"}; !reflect.DeepEqual(ask.Routed.Chose, want) || ask.Routed.Reason != "It is about the first-use flow." || ask.Routed.Failed || ask.Routed.Pending {
		t.Errorf("Routed after the follow-up = %+v, want Chose %v and the router's reason as it was", *ask.Routed, want)
	}
	if !reflect.DeepEqual(ask.To, []string{"ux", "ram"}) || !ask.Answered {
		t.Errorf("the reply ended with To %v answered %v, want [ux ram] and answered", ask.To, ask.Answered)
	}
	var ramAnswered bool
	for _, a := range repliesBy(got, "ram") {
		ramAnswered = ramAnswered || (a.ParentId == "r3" && a.Text == "Answer from ram")
	}
	if !ramAnswered {
		t.Errorf("ram's answer to r3 is missing: %+v", repliesBy(got, "ram"))
	}
	if n := len(h.f.calls("?")); n != 0 {
		t.Errorf("%d calls that were no answer (a router call?), want none: Ask seat too does not route again", n)
	}
}

func TestAskTooRefuses(t *testing.T) {
	for _, state := range []CouncilState{StateDone, StateAwaiting} {
		t.Run(string(state), func(t *testing.T) {
			h := newHarness(t)
			h.save(routedCouncil("c1", state))
			before := h.load("c1")
			for _, tc := range []struct {
				name, reply, seat, want string
			}{
				{"a reply that is missing", "r9", "ram", "no reply r9"},
				{"a reply the router never took up", "r5", "ram", "not routed"},
				{"a pending reply", "r6", "ram", "not chosen"},
				{"a seat already in To", "r3", "ux", "already"},
				{"a seat not on the panel", "r3", "ghost", "not a seat"},
				{"the coordinator", "r3", "lead", "not a seat"},
				{"another seat's reply", "r7", "newuser", "not your message"},
			} {
				if _, err := h.r.AskToo("c1", tc.reply, tc.seat); err == nil || !strings.Contains(err.Error(), tc.want) {
					t.Errorf("%s: AskToo = %v, want an error naming %q", tc.name, err, tc.want)
				}
				if after := h.load("c1"); !reflect.DeepEqual(after, before) {
					t.Errorf("%s: the refused call changed the council:\n%+v\nwas\n%+v", tc.name, after, before)
				}
			}
			if len(h.f.all()) != 0 {
				t.Errorf("a refused Ask seat too made %d calls", len(h.f.all()))
			}
			h.r.Caller = nil
			if _, err := h.r.AskToo("c1", "r3", "ram"); err == nil || !strings.Contains(err.Error(), "no caller") {
				t.Errorf("a runner with no caller: AskToo = %v, want an error naming the caller", err)
			}
			if after := h.load("c1"); !reflect.DeepEqual(after, before) {
				t.Errorf("a runner with no caller changed the council")
			}
			h.r.Caller = h.f
			// the refusals left no run registered: the next valid call goes through
			if _, err := h.r.AskToo("c1", "r3", "ram"); err != nil {
				t.Fatalf("AskToo after the refusals: %v", err)
			}
			if state == StateDone {
				h.wait("c1")
			}
		})
	}
}

// A council that waits on the person, or has a run on, takes the change into its save and starts nothing: the next pass
// or round answers it.
func TestAskTooWhileAwaitingSaves(t *testing.T) {
	h := newHarness(t)
	h.save(routedCouncil("c1", StateAwaiting))

	saved, err := h.r.AskToo("c1", "r3", "ram")
	if err != nil {
		t.Fatalf("AskToo: %v", err)
	}
	got := h.load("c1")
	if saved.State != StateAwaiting || got.State != StateAwaiting {
		t.Errorf("states = %s saved, %s loaded, want awaiting-you: no run starts", saved.State, got.State)
	}
	ask := replyOf(t, got, "r3")
	if !reflect.DeepEqual(ask.To, []string{"ux", "ram"}) || ask.Answered {
		t.Errorf("the reply saved with To %v answered %v, want [ux ram] and open", ask.To, ask.Answered)
	}
	if want := []string{"ux"}; !reflect.DeepEqual(ask.Routed.Chose, want) {
		t.Errorf("Routed.Chose = %v, want %v", ask.Routed.Chose, want)
	}
	h.r.mu.Lock()
	run := h.r.active["c1"]
	h.r.mu.Unlock()
	if run != nil || len(h.f.all()) != 0 {
		t.Errorf("a run started: %d calls, active %v", len(h.f.all()), run)
	}
}

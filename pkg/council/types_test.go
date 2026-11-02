// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestModeOf(t *testing.T) {
	for _, tc := range []struct {
		name string
		c    *Council
		want string
	}{
		{"a council saved before modes", &Council{}, ModeReview},
		{"review", &Council{Mode: ModeReview}, ModeReview},
		{"brainstorm", &Council{Mode: ModeBrainstorm}, ModeBrainstorm},
		{"nil", nil, ModeReview},
	} {
		if got := ModeOf(tc.c); got != tc.want {
			t.Errorf("ModeOf(%s) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestRoundsOf(t *testing.T) {
	for _, tc := range []struct {
		name string
		c    *Council
		want int
	}{
		{"a council saved before rounds", &Council{}, 2},
		{"nil", nil, 2},
		{"one", &Council{Rounds: 1}, 1},
		{"two", &Council{Rounds: 2}, 2},
		{"three", &Council{Rounds: 3}, 3},
		{"above the cap reads as two", &Council{Rounds: 4}, 2},
		{"negative reads as two", &Council{Rounds: -1}, 2},
	} {
		if got := RoundsOf(tc.c); got != tc.want {
			t.Errorf("RoundsOf(%s) = %d, want %d", tc.name, got, tc.want)
		}
	}
}

func TestSynthesisRound(t *testing.T) {
	for rounds, want := range map[int]int{0: 3, 1: 2, 2: 3, 3: 4} {
		if got := SynthesisRound(&Council{Rounds: rounds}); got != want {
			t.Errorf("SynthesisRound(rounds %d) = %d, want %d", rounds, got, want)
		}
	}
}

func TestFirstFollowRound(t *testing.T) {
	for rounds, want := range map[int]int{0: 4, 1: 3, 2: 4, 3: 5} {
		if got := FirstFollowRound(&Council{Rounds: rounds}); got != want {
			t.Errorf("FirstFollowRound(rounds %d) = %d, want %d", rounds, got, want)
		}
	}
}

func TestIsAgent(t *testing.T) {
	if IsAgent(CouncilExpert{Id: "ux"}) {
		t.Error("a role expert is not an agent")
	}
	if !IsAgent(CouncilExpert{Id: "witness", Agent: "tab-1"}) {
		t.Error("a seat with an agent tab is an agent")
	}
}

func TestHasAgents(t *testing.T) {
	experts := []CouncilExpert{{Id: "ux"}, {Id: "chair", Coordinator: true}}
	if HasAgents(&Council{Experts: experts}) {
		t.Error("an expert-only council has no agents")
	}
	if HasAgents(nil) {
		t.Error("nil has no agents")
	}
	seated := append([]CouncilExpert{{Id: "witness", Agent: "tab-1", Harness: "claude"}}, experts...)
	if !HasAgents(&Council{Experts: seated}) {
		t.Error("a council with one agent seated has agents")
	}
}

func TestHoldsDrafts(t *testing.T) {
	experts := []CouncilExpert{{Id: "ux"}, {Id: "chair", Coordinator: true}}
	seated := append([]CouncilExpert{{Id: "witness", Agent: "tab-1", Harness: "claude"}}, experts...)
	for name, tc := range map[string]struct {
		c    *Council
		want bool
	}{
		"nil":                            {nil, false},
		"no agents":                      {&Council{Experts: experts}, false},
		"no agents, started by an agent": {&Council{Experts: experts, ByAgent: true}, false},
		"agents":                         {&Council{Experts: seated}, true},
		"agents, started by an agent":    {&Council{Experts: seated, ByAgent: true}, false},
		// a stored mode is the answer, whatever the seats are now
		"held, no agents now":       {&Council{Experts: experts, DraftMode: DraftModeHeld}, true},
		"held, started by an agent": {&Council{Experts: seated, ByAgent: true, DraftMode: DraftModeHeld}, true},
		"free, agents seated":       {&Council{Experts: seated, DraftMode: DraftModeFree}, false},
	} {
		if got := HoldsDrafts(tc.c); got != tc.want {
			t.Errorf("%s: HoldsDrafts = %v, want %v", name, got, tc.want)
		}
	}
}

func TestFreezeDraftMode(t *testing.T) {
	experts := []CouncilExpert{{Id: "ux"}, {Id: "chair", Coordinator: true}}
	seated := append([]CouncilExpert{{Id: "witness", Agent: "tab-1", Harness: "claude"}}, experts...)

	// no chat at start: free, and a chat seated afterwards still reads free
	c := &Council{Experts: experts}
	freezeDraftMode(c)
	if c.DraftMode != DraftModeFree {
		t.Errorf("no chat at start froze %q, want %q", c.DraftMode, DraftModeFree)
	}
	c.Experts = seated
	if HoldsDrafts(c) {
		t.Error("a chat seated after a free start holds drafts")
	}

	// a chat at start: held, unless an agent started the council
	c = &Council{Experts: seated}
	freezeDraftMode(c)
	if c.DraftMode != DraftModeHeld {
		t.Errorf("a chat at start froze %q, want %q", c.DraftMode, DraftModeHeld)
	}
	c = &Council{Experts: seated, ByAgent: true}
	freezeDraftMode(c)
	if c.DraftMode != DraftModeFree {
		t.Errorf("a chat at start of an agent's council froze %q, want %q", c.DraftMode, DraftModeFree)
	}

	// a set mode is never overwritten
	c = &Council{Experts: seated, DraftMode: DraftModeFree}
	freezeDraftMode(c)
	if c.DraftMode != DraftModeFree {
		t.Errorf("a set free mode became %q", c.DraftMode)
	}
	c = &Council{Experts: experts, DraftMode: DraftModeHeld}
	freezeDraftMode(c)
	if c.DraftMode != DraftModeHeld {
		t.Errorf("a set held mode became %q", c.DraftMode)
	}
}

func TestSent(t *testing.T) {
	for draft, want := range map[string]bool{"": true, DraftHeld: false, DraftDropped: false} {
		if got := Sent(draft); got != want {
			t.Errorf("Sent(%q) = %v, want %v", draft, got, want)
		}
	}
}

// A council saved before agents, drafts and rounds existed must read back and write out unchanged: every new field is
// omitempty, so none of them appears until it is set.
func TestNewFieldsLeaveAnOldCouncilsJSONAlone(t *testing.T) {
	c := &Council{
		Id:        "c1",
		Experts:   []CouncilExpert{{Id: "ux"}},
		Proposals: []CouncilProposal{{Id: "P1", Author: "ux"}},
		Replies:   []CouncilReply{{Id: "r1", ProposalId: "P1", Author: "ux"}},
	}
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"agent"`, `"harness"`, `"context"`, `"rounds"`, `"skips"`, `"draft"`, `"edited"`, `"draftmode"`, `"attachments"`} {
		if strings.Contains(string(b), key) {
			t.Errorf("an old council writes %s: %s", key, b)
		}
	}

	// An old council's JSON (no attachments key) reads back with none, and writes out again with no attachments key.
	var back Council
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if len(back.Replies) != 1 || back.Replies[0].Attachments != nil {
		t.Errorf("an old reply reads back with attachments %v", back.Replies)
	}
	again, err := json.Marshal(&back)
	if err != nil {
		t.Fatal(err)
	}
	if string(again) != string(b) {
		t.Errorf("an old council changed on a round trip:\n%s\n%s", b, again)
	}

	// A reply that carries attachments writes them, in order.
	r := CouncilReply{Id: "r2", Author: YouId, Attachments: []string{"/a/1.png", "/a/2.png"}}
	rb, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rb), `"attachments":["/a/1.png","/a/2.png"]`) {
		t.Errorf("a reply with attachments writes %s", rb)
	}

	held := CouncilProposal{Id: "P2", Draft: DraftHeld, Edited: true}
	b, err = json.Marshal(held)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"draft":"held"`) || !strings.Contains(string(b), `"edited":true`) {
		t.Errorf("a held, edited idea writes %s", b)
	}
}

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
	for _, key := range []string{`"agent"`, `"harness"`, `"context"`, `"rounds"`, `"skips"`, `"draft"`, `"edited"`} {
		if strings.Contains(string(b), key) {
			t.Errorf("an old council writes %s: %s", key, b)
		}
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

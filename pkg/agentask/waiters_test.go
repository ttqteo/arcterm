// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentask

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func TestResolveWaiterDeliversOnce(t *testing.T) {
	r := MakeRegistry()
	ch := r.RegisterWaiter("a1")
	if !r.ResolveWaiter("a1", WaitResult{Answers: []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}}}) {
		t.Fatal("resolve must report the waiter was registered")
	}
	select {
	case res := <-ch:
		if res.Cancelled || len(res.Answers) != 1 || res.Answers[0].SelectedIndexes[0] != 1 {
			t.Fatalf("bad result: %#v", res)
		}
	default:
		t.Fatal("waiter must receive the result")
	}
	// second resolve is a no-op (entry removed on first resolve)
	if r.ResolveWaiter("a1", WaitResult{Cancelled: true}) {
		t.Fatal("second resolve must report no waiter")
	}
}

func TestResolveWaiterNoWaiter(t *testing.T) {
	r := MakeRegistry()
	if r.ResolveWaiter("nope", WaitResult{Cancelled: true}) {
		t.Fatal("resolving an unregistered askId must be a no-op")
	}
}

func TestHasWaiterUntilResolved(t *testing.T) {
	r := MakeRegistry()
	if r.HasWaiter("a1") {
		t.Fatal("no waiter registered yet")
	}
	r.RegisterWaiter("a1")
	if !r.HasWaiter("a1") {
		t.Fatal("a registered waiter is there")
	}
	r.ResolveWaiter("a1", WaitResult{Cancelled: true})
	if r.HasWaiter("a1") {
		t.Fatal("a resolved waiter is gone")
	}
}

func TestSameQuestionsByTextInOrder(t *testing.T) {
	q := func(texts ...string) []baseds.AgentAskQuestion {
		out := make([]baseds.AgentAskQuestion, len(texts))
		for i, s := range texts {
			out[i] = baseds.AgentAskQuestion{Question: s, Header: "h" + s}
		}
		return out
	}
	withOptions := q("A?", "B?")
	withOptions[0].Options = []baseds.AgentAskOption{{Label: "x"}}
	if !SameQuestions(q("A?", "B?"), withOptions) {
		t.Fatal("the same texts are the same questions, whatever else each side carried")
	}
	if SameQuestions(q("A?", "B?"), q("B?", "A?")) || SameQuestions(q("A?"), q("A?", "B?")) {
		t.Fatal("order and count matter")
	}
}

func TestRemoveWaiterGivesUp(t *testing.T) {
	r := MakeRegistry()
	ch := r.RegisterWaiter("a1")
	r.RemoveWaiter("a1")
	if r.ResolveWaiter("a1", WaitResult{Cancelled: true}) {
		t.Fatal("removed waiter must not resolve")
	}
	if len(ch) != 0 {
		t.Fatal("removed waiter must not have a buffered result")
	}
}

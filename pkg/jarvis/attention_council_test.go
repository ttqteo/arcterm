// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestBuildAttentionCouncilWaitingOnYou(t *testing.T) {
	in := AttentionInput{Councils: []*council.Council{
		{Id: "c-wait", Feature: "Rail apps", State: council.StateAwaiting, Updated: 1700},
		{Id: "c-done", Feature: "Other", State: council.StateDone, Updated: 1800},
		{Id: "c-run", Feature: "Running", State: council.StateRunning, Updated: 1900},
	}}
	var got []wshrpc.AttentionItem
	for _, it := range BuildAttention(in) {
		if it.Kind == AttentionCouncil {
			got = append(got, it)
		}
	}
	want := []wshrpc.AttentionItem{{
		Kind: AttentionCouncil, Key: "council:c-wait", ORef: "council:c-wait",
		Text: "Council waiting on you: Rail apps", Action: "Open", WaitingSince: 1700,
	}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestBuildAttentionCouncilResolvedElsewhereLeaves(t *testing.T) {
	c := &council.Council{Id: "c1", Feature: "Rail apps", State: council.StateAwaiting, Updated: 1}
	count := func() int {
		n := 0
		for _, it := range BuildAttention(AttentionInput{Councils: []*council.Council{c}}) {
			if it.Kind == AttentionCouncil {
				n++
			}
		}
		return n
	}
	if count() != 1 {
		t.Fatalf("an awaiting council is one item")
	}
	c.State = council.StateDone
	if count() != 0 {
		t.Fatalf("a council moved to done leaves Needs you on the next refresh")
	}
}

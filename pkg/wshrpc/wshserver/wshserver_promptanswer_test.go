// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentperm"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

func TestAnswersPrompt(t *testing.T) {
	cases := []struct {
		input string
		want  bool
	}{
		{"\r", true},
		{"1", true},
		{"3", true},
		{"0", false},
		{"y", false},
		{"\x1b", false},          // Esc cancels: the turn ends and reports idle on its own
		{"\x1b[B", false},        // an arrow moves the selection, it answers nothing
		{"\x1b[I", false},        // focus-in
		{"\x1b[<0;12;3M", false}, // a mouse report carries digits
		{"ls\r", false},
		{"", false},
	}
	for _, c := range cases {
		if got := answersPrompt([]byte(c.input)); got != c.want {
			t.Errorf("answersPrompt(%q) = %v, want %v", c.input, got, c.want)
		}
	}
}

func TestAnsweredStatus(t *testing.T) {
	last := baseds.AgentStatusData{
		ORef: "block:x", State: baseds.AgentState_Waiting, Agent: "claude", Title: "Docker",
		Model: "opus", TranscriptPath: "/t.jsonl", Hook: baseds.AgentHook_Notification, Ts: 100,
	}
	next, ok := answeredStatus(last, 200)
	if !ok {
		t.Fatal("a waiting agent's answer reported nothing")
	}
	if next.State != baseds.AgentState_Working || next.Ts != 200 || next.Hook != "" {
		t.Fatalf("answered = %+v, want working at 200 with no hook", next)
	}
	if next.Title != "Docker" || next.Model != "opus" || next.TranscriptPath != "/t.jsonl" || next.ORef != "block:x" {
		t.Fatalf("answered dropped the retained fields: %+v", next)
	}
	for _, state := range []string{baseds.AgentState_Working, baseds.AgentState_Asking, baseds.AgentState_Idle, ""} {
		last.State = state
		if _, ok := answeredStatus(last, 200); ok {
			t.Errorf("a %q agent's keystroke reported working", state)
		}
	}
}

// a granted permission prompt read "asking" until its tool ended: a 42s `docker info` held it the whole run
func TestBlockInputAnswersAPermissionPrompt(t *testing.T) {
	ctx := context.Background()
	const block = "b0000000-0000-4000-8000-0000000005a0"
	oref := blockORef(block)
	now := time.Now().UnixMilli()
	retained := func() baseds.AgentStatusData {
		var last baseds.AgentStatusData
		for _, ev := range wps.Broker.ReadEventHistory(wps.Event_AgentStatus, oref, 1) {
			if err := utilfn.ReUnmarshal(&last, ev.Data); err != nil {
				t.Fatal(err)
			}
		}
		return last
	}
	publishEvent(ctx, wps.WaveEvent{
		Event: wps.Event_AgentStatus, Scopes: []string{oref}, Persist: 1,
		Data: baseds.AgentStatusData{ORef: oref, State: baseds.AgentState_Waiting, Hook: baseds.AgentHook_Notification, Agent: "claude", Title: "Docker", Ts: now},
	})
	noteBlockInput(ctx, block, []byte("\x1b[B"))
	if got := retained().State; got != baseds.AgentState_Waiting {
		t.Fatalf("an arrow key moved the state to %q", got)
	}
	noteBlockInput(ctx, block, []byte("\r"))
	if got := retained(); got.State != baseds.AgentState_Working || got.Title != "Docker" {
		t.Fatalf("after the answer: %+v, want working with its title", got)
	}
}

// a key typed in the terminal settles the permission queue; the status report is independent of it
func TestNoteBlockInputClearsPermission(t *testing.T) {
	ctx := context.Background()
	f := newPermFixture(t)
	queue := func() []string {
		var out []string
		for _, r := range agentperm.GlobalRegistry.Snapshot(f.oref) {
			out = append(out, r.Summary)
		}
		return out
	}
	published := func() int { return len(f.published()) }
	raise := func(summary string) { f.raise("Bash", `{"command":"`+summary+`"}`) }

	raise("one")
	raise("two")
	raise("three")
	before := published()

	// an arrow, text or a focus report answers nothing and publishes nothing
	for _, in := range []string{"\x1b[B", "a", "ls\r", "\x1b[I"} {
		noteBlockInput(ctx, permBlock, []byte(in))
	}
	if got := queue(); len(got) != 3 || published() != before {
		t.Fatalf("keys that answer nothing changed the queue to %v (published %d -> %d)", got, before, published())
	}

	// a digit or Enter answers the prompt on screen: the head goes, one snapshot is published
	noteBlockInput(ctx, permBlock, []byte("1"))
	if got := queue(); len(got) != 2 || got[0] != "two" || published() != before+1 {
		t.Fatalf("after 1 the queue is %v (published %d -> %d), want two and three", got, before, published())
	}
	noteBlockInput(ctx, permBlock, []byte("\r"))
	if got := queue(); len(got) != 1 || got[0] != "three" {
		t.Fatalf("after Enter the queue is %v, want three", got)
	}

	// Esc is no answering key for the status report, but it rejects the request: all of them go
	raise("four")
	noteBlockInput(ctx, permBlock, []byte("\x1b"))
	if got := queue(); len(got) != 0 {
		t.Fatalf("after Esc the queue is %v, want empty", got)
	}
	// nothing left: another key publishes nothing
	after := published()
	noteBlockInput(ctx, permBlock, []byte("1"))
	noteBlockInput(ctx, permBlock, []byte("\x1b"))
	if published() != after {
		t.Fatal("keys on an empty queue published a snapshot")
	}
	if got := f.typedKeys(); len(got) != 0 {
		t.Fatalf("noting the terminal's keys typed %q back into it", got)
	}
}

func TestAnsweredStatusDropsTheToolKey(t *testing.T) {
	last := baseds.AgentStatusData{ORef: "block:x", State: baseds.AgentState_Waiting, ToolKey: "Bash:abc", Ts: 100}
	next, ok := answeredStatus(last, 200)
	if !ok || next.ToolKey != "" {
		t.Fatalf("answered = %+v, %v: a copied tool key would retire a request a second time", next, ok)
	}
}

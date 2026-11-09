// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentperm"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const permBlock = "b0000000-0000-4000-8000-0000000007a0"

// permFixture empties the block's queue, captures what is typed into the block and every agent:permission event
// published for it.
type permFixture struct {
	t     *testing.T
	oref  string
	mu    sync.Mutex
	typed [][]byte
	cc    *wsCaptureClient
}

func newPermFixture(t *testing.T) *permFixture {
	t.Helper()
	f := &permFixture{t: t, oref: blockORef(permBlock), cc: &wsCaptureClient{}}
	agentperm.GlobalRegistry.DropAll(f.oref)
	origSend := permSendInput
	permSendInput = func(blockId string, data []byte) error {
		if blockId != permBlock {
			t.Errorf("typed into block %q, want %q", blockId, permBlock)
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		f.typed = append(f.typed, append([]byte(nil), data...))
		return nil
	}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(f.cc)
	wps.Broker.Subscribe("agentperm-events", wps.SubscriptionRequest{Event: wps.Event_AgentPermission, AllScopes: true})
	t.Cleanup(func() {
		wps.Broker.Unsubscribe("agentperm-events", wps.Event_AgentPermission)
		wps.Broker.SetClient(prevClient)
		permSendInput = origSend
		agentperm.GlobalRegistry.DropAll(f.oref)
	})
	return f
}

func (f *permFixture) typedKeys() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.typed))
	for i, k := range f.typed {
		out[i] = string(k)
	}
	return out
}

// published is the queue (by summary) of each agent:permission event so far for this block, in order.
func (f *permFixture) published() [][]string {
	f.cc.mu.Lock()
	defer f.cc.mu.Unlock()
	var out [][]string
	for _, e := range f.cc.events {
		if e.Event != wps.Event_AgentPermission || !e.HasScope(f.oref) {
			continue
		}
		var data baseds.AgentPermissionData
		if err := utilfn.ReUnmarshal(&data, e.Data); err != nil {
			f.t.Fatal(err)
		}
		if data.ORef != f.oref {
			f.t.Errorf("event oref = %q, want %q", data.ORef, f.oref)
		}
		if data.Requests == nil {
			f.t.Errorf("an event carried null requests: an empty queue must publish []")
		}
		var summaries []string
		for _, r := range data.Requests {
			summaries = append(summaries, r.Summary)
		}
		out = append(out, summaries)
	}
	return out
}

func (f *permFixture) raise(tool, input string) {
	f.t.Helper()
	err := (&WshServer{}).AgentPermissionRaiseCommand(context.Background(), wshrpc.CommandAgentPermissionRaiseData{
		ORef: f.oref, ToolName: tool, ToolInput: json.RawMessage(input),
	})
	if err != nil {
		f.t.Fatal(err)
	}
}

func (f *permFixture) pending() baseds.AgentPermissionData {
	f.t.Helper()
	data, err := (&WshServer{}).AgentPermissionPendingCommand(context.Background(), f.oref)
	if err != nil {
		f.t.Fatal(err)
	}
	return data
}

func (f *permFixture) answer(id string, allow bool) error {
	return (&WshServer{}).AgentPermissionAnswerCommand(context.Background(), wshrpc.CommandAgentPermissionAnswerData{
		ORef: f.oref, Id: id, Allow: allow,
	})
}

func equalRows(a, b [][]string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if len(a[i]) != len(b[i]) {
			return false
		}
		for j := range a[i] {
			if a[i][j] != b[i][j] {
				return false
			}
		}
	}
	return true
}

func TestAgentPermissionRaise(t *testing.T) {
	f := newPermFixture(t)
	ws := &WshServer{}
	ctx := context.Background()
	if err := ws.AgentPermissionRaiseCommand(ctx, wshrpc.CommandAgentPermissionRaiseData{ToolName: "Bash"}); err == nil {
		t.Error("a raise with no oref was accepted")
	}
	if err := ws.AgentPermissionRaiseCommand(ctx, wshrpc.CommandAgentPermissionRaiseData{ORef: f.oref}); err == nil {
		t.Error("a raise with no tool name was accepted")
	}
	if got := f.published(); len(got) != 0 {
		t.Fatalf("a refused raise published %v", got)
	}
	f.raise("Bash", `{"command":"echo one"}`)
	f.raise("Edit", `{"file_path":"/a/b.go"}`)
	if got, want := f.published(), [][]string{{"echo one"}, {"echo one", "/a/b.go"}}; !equalRows(got, want) {
		t.Fatalf("published = %v, want %v", got, want)
	}
	data := f.pending()
	if data.ORef != f.oref || len(data.Requests) != 2 || data.Requests[0].ToolName != "Bash" || !data.Requests[0].Answerable {
		t.Fatalf("pending = %+v", data)
	}
	if _, err := ws.AgentPermissionPendingCommand(ctx, ""); err == nil {
		t.Error("a pending read with no oref was accepted")
	}
	empty, err := ws.AgentPermissionPendingCommand(ctx, blockORef("b0000000-0000-4000-8000-0000000007ff"))
	if err != nil || empty.Requests == nil || len(empty.Requests) != 0 {
		t.Errorf("an unknown block's pending = %+v, %v; want an empty non-nil queue", empty, err)
	}
}

func TestAgentPermissionAnswer(t *testing.T) {
	t.Run("allow types 1 and drops the head", func(t *testing.T) {
		f := newPermFixture(t)
		f.raise("Bash", `{"command":"one"}`)
		f.raise("Bash", `{"command":"two"}`)
		head := f.pending().Requests[0]
		if err := f.answer(head.Id, true); err != nil {
			t.Fatal(err)
		}
		if got := f.typedKeys(); len(got) != 1 || got[0] != "1" {
			t.Fatalf("typed %q, want exactly 1", got)
		}
		if got := f.pending().Requests; len(got) != 1 || got[0].Summary != "two" {
			t.Fatalf("after Allow the queue is %+v, want only the second", got)
		}
		want := [][]string{{"one"}, {"one", "two"}, {"two"}}
		if got := f.published(); !equalRows(got, want) {
			t.Fatalf("published = %v, want %v", got, want)
		}
	})

	t.Run("deny types Esc and drops all", func(t *testing.T) {
		f := newPermFixture(t)
		f.raise("Bash", `{"command":"one"}`)
		f.raise("Bash", `{"command":"two"}`)
		head := f.pending().Requests[0]
		if err := f.answer(head.Id, false); err != nil {
			t.Fatal(err)
		}
		if got := f.typedKeys(); len(got) != 1 || got[0] != "\x1b" {
			t.Fatalf("typed %q, want exactly Esc", got)
		}
		if got := f.pending().Requests; len(got) != 0 {
			t.Fatalf("after Deny the queue is %+v, want empty", got)
		}
		published := f.published()
		// (published() already fails an event whose requests came through as null rather than [])
		if last := published[len(published)-1]; len(last) != 0 {
			t.Fatalf("the last event after Deny is %v, want an empty queue", last)
		}
	})

	t.Run("a stale id types nothing", func(t *testing.T) {
		f := newPermFixture(t)
		f.raise("Bash", `{"command":"one"}`)
		f.raise("Bash", `{"command":"two"}`)
		second := f.pending().Requests[1]
		before := len(f.published())
		for _, allow := range []bool{true, false} {
			err := f.answer(second.Id, allow)
			if !errors.Is(err, agentperm.ErrNotPending) {
				t.Fatalf("answering a request behind the head (allow=%v) = %v, want ErrNotPending", allow, err)
			}
			if err := f.answer("no-such-id", allow); !errors.Is(err, agentperm.ErrNotPending) {
				t.Fatalf("answering an unknown id (allow=%v) = %v, want ErrNotPending", allow, err)
			}
		}
		if got := f.typedKeys(); len(got) != 0 {
			t.Fatalf("a stale answer typed %q", got)
		}
		if len(f.pending().Requests) != 2 || len(f.published()) != before {
			t.Fatal("a stale answer changed or published the queue")
		}
	})

	t.Run("an answered head cannot be answered again", func(t *testing.T) {
		f := newPermFixture(t)
		f.raise("Bash", `{"command":"one"}`)
		f.raise("Bash", `{"command":"two"}`)
		head := f.pending().Requests[0]
		if err := f.answer(head.Id, true); err != nil {
			t.Fatal(err)
		}
		// a double click: the second Allow must not answer the next prompt
		if err := f.answer(head.Id, true); !errors.Is(err, agentperm.ErrNotPending) {
			t.Fatalf("the repeat answer = %v, want ErrNotPending", err)
		}
		if got := f.typedKeys(); len(got) != 1 {
			t.Fatalf("typed %q, want the first Allow only", got)
		}
	})

	t.Run("allow on a prompt that is not answerable types nothing", func(t *testing.T) {
		f := newPermFixture(t)
		f.raise("ExitPlanMode", `{"plan":"do it"}`)
		head := f.pending().Requests[0]
		if head.Answerable {
			t.Fatalf("ExitPlanMode is answerable: %+v", head)
		}
		before := len(f.published())
		err := f.answer(head.Id, true)
		if err == nil || errors.Is(err, agentperm.ErrNotPending) {
			t.Fatalf("Allow on ExitPlanMode = %v, want its own refusal", err)
		}
		if got := f.typedKeys(); len(got) != 0 {
			t.Fatalf("typed %q", got)
		}
		if len(f.pending().Requests) != 1 || len(f.published()) != before {
			t.Fatal("a refused Allow changed or published the queue")
		}
	})

	t.Run("a send failure leaves the queue as it was", func(t *testing.T) {
		f := newPermFixture(t)
		f.raise("Bash", `{"command":"one"}`)
		permSendInput = func(string, []byte) error { return errors.New("pty gone") }
		head := f.pending().Requests[0]
		before := len(f.published())
		for _, allow := range []bool{true, false} {
			if err := f.answer(head.Id, allow); err == nil || err.Error() == "" {
				t.Fatalf("a failed send (allow=%v) answered %v, want the error", allow, err)
			}
		}
		if len(f.pending().Requests) != 1 || len(f.published()) != before {
			t.Fatal("a failed send changed or published the queue")
		}
	})

	t.Run("an empty oref or id is refused", func(t *testing.T) {
		f := newPermFixture(t)
		ws := &WshServer{}
		if err := ws.AgentPermissionAnswerCommand(context.Background(), wshrpc.CommandAgentPermissionAnswerData{Id: "x", Allow: true}); err == nil {
			t.Error("an answer with no oref was accepted")
		}
		if err := f.answer("", true); err == nil {
			t.Error("an answer with no id was accepted")
		}
		if got := f.typedKeys(); len(got) != 0 {
			t.Fatalf("typed %q", got)
		}
	})
}

func TestAgentPermissionAllowReportsWorking(t *testing.T) {
	f := newPermFixture(t)
	ctx := context.Background()
	publishEvent(ctx, wps.WaveEvent{
		Event: wps.Event_AgentStatus, Scopes: []string{f.oref}, Persist: 1,
		Data: baseds.AgentStatusData{ORef: f.oref, State: baseds.AgentState_Waiting, Hook: "PermissionRequest", Agent: "claude", Title: "Docker", Ts: 1_000_000},
	})
	f.raise("Bash", `{"command":"docker info"}`)
	if err := f.answer(f.pending().Requests[0].Id, true); err != nil {
		t.Fatal(err)
	}
	var last baseds.AgentStatusData
	for _, ev := range wps.Broker.ReadEventHistory(wps.Event_AgentStatus, f.oref, 1) {
		if err := utilfn.ReUnmarshal(&last, ev.Data); err != nil {
			t.Fatal(err)
		}
	}
	if last.State != baseds.AgentState_Working || last.Title != "Docker" {
		t.Fatalf("after Allow the status is %+v, want working with its title", last)
	}
	if got := f.typedKeys(); len(got) != 1 {
		t.Fatalf("typed %q: the working report must not type a second key", got)
	}
}

// the status intercept in publishEvent clears the queue the way agentperm.NoteStatus says
func TestPublishEventStatusClearsPermission(t *testing.T) {
	f := newPermFixture(t)
	ctx := context.Background()
	status := func(hook, key string, ts int64) {
		publishEvent(ctx, wps.WaveEvent{
			Event: wps.Event_AgentStatus, Scopes: []string{f.oref}, Persist: 1,
			Data: baseds.AgentStatusData{ORef: f.oref, State: baseds.AgentState_Working, Hook: hook, ToolKey: key, Agent: "claude", Ts: ts},
		})
	}
	f.raise("Bash", `{"command":"one"}`)
	f.raise("Bash", `{"command":"two"}`)
	status(baseds.AgentHook_PostToolUse, agentperm.ToolKey("Bash", json.RawMessage(`{"command":"two"}`)), 1_000_001)
	if got := f.pending().Requests; len(got) != 1 || got[0].Summary != "one" {
		t.Fatalf("after the PostToolUse of two the queue is %+v, want only one", got)
	}
	published := len(f.published())
	status(baseds.AgentHook_PostToolUse, agentperm.ToolKey("Bash", json.RawMessage(`{"command":"other"}`)), 1_000_002)
	if len(f.published()) != published {
		t.Fatal("a key that matched nothing published a snapshot")
	}
	status(baseds.AgentHook_Stop, "", 1_000_003)
	if got := f.pending().Requests; len(got) != 0 {
		t.Fatalf("after Stop the queue is %+v, want empty", got)
	}
	if rows := f.published(); len(rows) != published+1 {
		t.Fatalf("Stop published %d snapshots, want exactly one", len(rows)-published)
	}
}

// answerChoice is an Allow carrying Choice (the prompt's second option when 2).
func (f *permFixture) answerChoice(id string, allow bool, choice int) error {
	return (&WshServer{}).AgentPermissionAnswerCommand(context.Background(), wshrpc.CommandAgentPermissionAnswerData{
		ORef: f.oref, Id: id, Allow: allow, Choice: choice,
	})
}

func TestAnswerSecondChoiceTypesTwo(t *testing.T) {
	f := newPermFixture(t)
	f.raise("Bash", `{"command":"one"}`)
	f.raise("Bash", `{"command":"two"}`)
	head := f.pending().Requests[0]
	if err := f.answerChoice(head.Id, true, 2); err != nil {
		t.Fatal(err)
	}
	if got := f.typedKeys(); len(got) != 1 || got[0] != "2" {
		t.Fatalf("typed %q, want exactly 2", got)
	}
	if got := f.pending().Requests; len(got) != 1 || got[0].Summary != "two" {
		t.Fatalf("after the second choice the queue is %+v, want only the second request", got)
	}
	// choice 0 and 1 are the first option
	for _, choice := range []int{0, 1} {
		f := newPermFixture(t)
		f.raise("Bash", `{"command":"one"}`)
		if err := f.answerChoice(f.pending().Requests[0].Id, true, choice); err != nil {
			t.Fatal(err)
		}
		if got := f.typedKeys(); len(got) != 1 || got[0] != "1" {
			t.Fatalf("choice %d typed %q, want exactly 1", choice, got)
		}
	}
}

func TestAnswerSecondChoiceRefusedWhenNotAnswerable(t *testing.T) {
	f := newPermFixture(t)
	f.raise("ExitPlanMode", `{"plan":"do it"}`)
	head := f.pending().Requests[0]
	before := len(f.published())
	err := f.answerChoice(head.Id, true, 2)
	if err == nil || errors.Is(err, agentperm.ErrNotPending) {
		t.Fatalf("choice 2 on ExitPlanMode = %v, want its own refusal", err)
	}
	if got := f.typedKeys(); len(got) != 0 {
		t.Fatalf("typed %q", got)
	}
	if len(f.pending().Requests) != 1 || len(f.published()) != before {
		t.Fatal("a refused second choice changed or published the queue")
	}
}

func TestAnswerChoiceOutOfRange(t *testing.T) {
	f := newPermFixture(t)
	f.raise("Bash", `{"command":"one"}`)
	head := f.pending().Requests[0]
	before := len(f.published())
	for _, choice := range []int{-1, 3, 9} {
		if err := f.answerChoice(head.Id, true, choice); err == nil {
			t.Errorf("choice %d was accepted", choice)
		}
	}
	if got := f.typedKeys(); len(got) != 0 {
		t.Fatalf("typed %q", got)
	}
	if len(f.pending().Requests) != 1 || len(f.published()) != before {
		t.Fatal("an out-of-range choice changed or published the queue")
	}
}

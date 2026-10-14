// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/ideastore"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedIdeaBlock inserts a block whose meta carries the given transcript path ("" leaves it out) and returns its id.
func seedIdeaBlock(t *testing.T, transcriptPath string) string {
	t.Helper()
	meta := waveobj.MetaMapType{}
	if transcriptPath != "" {
		meta[waveobj.MetaKey_AgentTranscriptPath] = transcriptPath
	}
	block := &waveobj.Block{OID: uuid.NewString(), Meta: meta}
	if err := wstore.DBInsert(context.Background(), block); err != nil {
		t.Fatalf("seed block: %v", err)
	}
	return block.OID
}

// captureIdeaEvents records every ideas:changed event until the test ends.
func captureIdeaEvents(t *testing.T) func() []string {
	t.Helper()
	var mu sync.Mutex
	var sessions []string
	prev := wps.Broker.GetClient()
	wps.Broker.SetClient(&askResolveClient{onEvent: func(ev wps.WaveEvent) {
		if data, ok := ev.Data.(wshrpc.IdeasChangedData); ok && ev.Event == wps.Event_IdeasChanged {
			mu.Lock()
			sessions = append(sessions, data.SessionId)
			mu.Unlock()
		}
	}})
	route := "idea-events-" + t.Name()
	wps.Broker.Subscribe(route, wps.SubscriptionRequest{Event: wps.Event_IdeasChanged, AllScopes: true})
	t.Cleanup(func() {
		wps.Broker.UnsubscribeAll(route)
		wps.Broker.SetClient(prev)
	})
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), sessions...)
	}
}

func TestResolveIdeaSessionFromSessionId(t *testing.T) {
	// a session id wins, so a block that does not exist is never read
	got, err := resolveIdeaSession(context.Background(), wshrpc.CommandIdeaTargetData{SessionId: "abc-123", BlockId: uuid.NewString()})
	if err != nil || got != "abc-123" {
		t.Fatalf("resolveIdeaSession = %q, %v; want abc-123", got, err)
	}
}

func TestResolveIdeaSessionFromBlockTranscriptPath(t *testing.T) {
	blockId := seedIdeaBlock(t, `C:\x\proj\abc-123.jsonl`)
	got, err := resolveIdeaSession(context.Background(), wshrpc.CommandIdeaTargetData{BlockId: blockId})
	if err != nil || got != "abc-123" {
		t.Fatalf("resolveIdeaSession = %q, %v; want abc-123 from a windows transcript path", got, err)
	}
	blockId = seedIdeaBlock(t, "/home/u/.claude/projects/p/def-456.jsonl")
	got, err = resolveIdeaSession(context.Background(), wshrpc.CommandIdeaTargetData{BlockId: blockId})
	if err != nil || got != "def-456" {
		t.Fatalf("resolveIdeaSession = %q, %v; want def-456 from a posix transcript path", got, err)
	}
}

func TestResolveIdeaSessionNoSession(t *testing.T) {
	blockId := seedIdeaBlock(t, "")
	_, err := resolveIdeaSession(context.Background(), wshrpc.CommandIdeaTargetData{BlockId: blockId})
	if err == nil || err.Error() != "no agent session in this terminal yet" {
		t.Fatalf("a block with no transcript path: err = %v, want the no-session error", err)
	}
	if _, err := resolveIdeaSession(context.Background(), wshrpc.CommandIdeaTargetData{}); err == nil {
		t.Fatal("a target with neither block nor session must be an error")
	}
	if _, err := resolveIdeaSession(context.Background(), wshrpc.CommandIdeaTargetData{BlockId: uuid.NewString()}); err == nil {
		t.Fatal("an unknown block must be an error")
	}
}

func TestIdeaCommandsAddListUpdateAndPublish(t *testing.T) {
	defer ideastore.UseRootForTest(t.TempDir())()
	events := captureIdeaEvents(t)
	ws := &WshServer{}
	ctx := context.Background()
	blockId := seedIdeaBlock(t, `C:\x\proj\sess-1.jsonl`)
	target := wshrpc.CommandIdeaTargetData{BlockId: blockId}

	first, err := ws.IdeaAddCommand(ctx, wshrpc.CommandIdeaAddData{CommandIdeaTargetData: target, Text: "use a rail", Kind: "idea", By: "agent"})
	if err != nil || first == nil || first.ID == "" {
		t.Fatalf("IdeaAddCommand = %+v, %v", first, err)
	}
	second, err := ws.IdeaAddCommand(ctx, wshrpc.CommandIdeaAddData{CommandIdeaTargetData: target, Text: "keep it small", Kind: "decision", By: "you"})
	if err != nil {
		t.Fatalf("second add: %v", err)
	}
	if got := events(); len(got) != 2 || got[0] != "sess-1" || got[1] != "sess-1" {
		t.Fatalf("two adds published %v, want two ideas:changed for sess-1", got)
	}

	list, err := ws.IdeaListCommand(ctx, target)
	if err != nil || list == nil || list.SessionId != "sess-1" || len(list.Ideas) != 2 {
		t.Fatalf("IdeaListCommand = %+v, %v; want 2 ideas of sess-1", list, err)
	}
	if got := events(); len(got) != 2 {
		t.Fatalf("a list must not publish, events = %v", got)
	}

	err = ws.IdeaUpdateCommand(ctx, wshrpc.CommandIdeaUpdateData{CommandIdeaTargetData: wshrpc.CommandIdeaTargetData{SessionId: "sess-1"}, Op: ideastore.OpDrop, Ids: []string{first.ID}})
	if err != nil {
		t.Fatalf("drop: %v", err)
	}
	if got := events(); len(got) != 3 {
		t.Fatalf("an update must publish, events = %v", got)
	}
	list, _ = ws.IdeaListCommand(ctx, target)
	if !list.Ideas[0].Dropped || list.Ideas[1].Dropped || list.Ideas[1].ID != second.ID {
		t.Fatalf("after drop of %s: %+v", first.ID, list.Ideas)
	}

	// a failed update changes nothing and publishes nothing
	err = ws.IdeaUpdateCommand(ctx, wshrpc.CommandIdeaUpdateData{CommandIdeaTargetData: target, Op: ideastore.OpDrop, Ids: []string{"i99"}})
	if err == nil {
		t.Fatal("dropping an unknown id must be an error")
	}
	if got := events(); len(got) != 3 {
		t.Fatalf("a failed update published, events = %v", got)
	}
}

func TestIdeaAddWithoutSessionFailsWithoutPublishing(t *testing.T) {
	defer ideastore.UseRootForTest(t.TempDir())()
	events := captureIdeaEvents(t)
	ws := &WshServer{}
	blockId := seedIdeaBlock(t, "")
	_, err := ws.IdeaAddCommand(context.Background(), wshrpc.CommandIdeaAddData{
		CommandIdeaTargetData: wshrpc.CommandIdeaTargetData{BlockId: blockId}, Text: "x", Kind: "idea", By: "agent",
	})
	if err == nil || err.Error() != "no agent session in this terminal yet" {
		t.Fatalf("err = %v, want the no-session error", err)
	}
	if got := events(); len(got) != 0 {
		t.Fatalf("a failed add published %v", got)
	}
}

func TestIdeaTickPublishesOnlyWithANudge(t *testing.T) {
	defer ideastore.UseRootForTest(t.TempDir())()
	events := captureIdeaEvents(t)
	ws := &WshServer{}
	ctx := context.Background()
	target := wshrpc.CommandIdeaTargetData{SessionId: "tick-1"}

	// a session with no idea never gets a nudge, and a tick that returns none publishes nothing
	for i := 0; i < 5; i++ {
		rtn, err := ws.IdeaTickCommand(ctx, target)
		if err != nil || rtn == nil || rtn.Nudge != "" {
			t.Fatalf("tick %d with no ideas = %+v, %v", i, rtn, err)
		}
	}
	if got := events(); len(got) != 0 {
		t.Fatalf("ticks with no nudge published %v", got)
	}

	if _, err := ws.IdeaAddCommand(ctx, wshrpc.CommandIdeaAddData{CommandIdeaTargetData: target, Text: "one idea", Kind: "idea", By: "agent"}); err != nil {
		t.Fatal(err)
	}
	added := len(events())
	var nudge string
	for i := 0; i < 3 && nudge == ""; i++ {
		rtn, err := ws.IdeaTickCommand(ctx, target)
		if err != nil {
			t.Fatal(err)
		}
		nudge = rtn.Nudge
	}
	if nudge == "" {
		t.Fatal("three prompts after the last idea must nudge")
	}
	if got := events(); len(got) != added+1 {
		t.Fatalf("the nudging tick must publish once, events = %v", got)
	}
}

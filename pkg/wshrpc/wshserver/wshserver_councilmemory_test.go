// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// TestCouncilMemoryPublishesOncePerMove: the command is the one that announces an entry move (Runner.MemoryEntry does
// not call the runner's own OnChange), so a move announces exactly one council:changed, and a refused one none.
func TestCouncilMemoryPublishesOncePerMove(t *testing.T) {
	events := useCouncilRig(t, newCouncilFake())
	saveCouncil(t, &council.Council{Id: "mem-1", Project: `D:\p`, Feature: "x", State: council.StateDone})
	ws := &WshServer{}
	ctx := context.Background()

	if err := ws.CouncilMemoryCommand(ctx, wshrpc.CommandCouncilMemoryData{Id: "mem-1", Action: council.EntryActionAdd, Kind: council.EntryAgreed, Text: "Cache by locale"}); err != nil {
		t.Fatalf("add: %v", err)
	}
	if got := events.all(); len(got) != 1 || got[0].Id != "mem-1" || got[0].Project != `D:\p` {
		t.Fatalf("add published %+v, want exactly one council:changed for mem-1", got)
	}
	got, _ := council.Load("mem-1")
	if got.Memory == nil || len(got.Memory.Entries) != 1 || got.Memory.Entries[0].Id != "m1" || got.Memory.Entries[0].By != council.EntryByYou {
		t.Fatalf("memory after add = %+v, want m1 by you", got.Memory)
	}

	if err := ws.CouncilMemoryCommand(ctx, wshrpc.CommandCouncilMemoryData{Id: "mem-1", Action: council.EntryActionEdit, Entry: "m1", Text: "Cache by locale and plan"}); err != nil {
		t.Fatalf("edit: %v", err)
	}
	if err := ws.CouncilMemoryCommand(ctx, wshrpc.CommandCouncilMemoryData{Id: "mem-1", Action: council.EntryActionRemove, Entry: "m1"}); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if got := events.all(); len(got) != 3 {
		t.Errorf("after three moves %d events, want 3", len(got))
	}

	for name, data := range map[string]wshrpc.CommandCouncilMemoryData{
		"no council id":     {Action: council.EntryActionAdd, Kind: council.EntryOpen, Text: "x"},
		"an unknown action": {Id: "mem-1", Action: "chot"},
		"an unknown entry":  {Id: "mem-1", Action: council.EntryActionRemove, Entry: "m99"},
	} {
		if err := ws.CouncilMemoryCommand(ctx, data); err == nil {
			t.Errorf("%s: CouncilMemoryCommand = nil, want a refusal", name)
		} else if name == "no council id" && !strings.Contains(err.Error(), "council id") {
			t.Errorf("%s: error %q should mention the council id", name, err)
		}
	}
	if got := events.all(); len(got) != 3 {
		t.Errorf("refused moves published: %d events in all, want still 3", len(got))
	}
}

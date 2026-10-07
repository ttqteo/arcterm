// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// TestGatherAttentionFromLedger_UsesCallerRowsAndWindowsMessages pins the two behaviors FetchWorkState
// depends on: run rows come from the caller's ledger (the "r-ledger" run exists nowhere in the store),
// and only the recent message window is scanned — an escalation card older than the window degrades its
// still-pending ask to a plain ask item instead of an escalation card.
func TestGatherAttentionFromLedger_UsesCallerRowsAndWindowsMessages(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ledger-window", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}

	oldAskORef := "block:ledger-old"
	card, _ := json.Marshal(JarvisCardData{AskORef: oldAskORef, WorkerORef: "tab:w", Question: "Which order?"})
	if _, err := wstore.PostChannelMessage(ctx, ch.OID, waveobj.ChannelMessage{
		ID: "esc-old", Kind: "jarvis-escalation", Ts: 1000, Data: string(card),
	}); err != nil {
		t.Fatalf("post escalation: %v", err)
	}
	for i := 0; i <= attentionMessageWindow; i++ { // enough newer messages to push the card out
		if _, err := wstore.PostChannelMessage(ctx, ch.OID, waveobj.ChannelMessage{ID: fmt.Sprintf("filler-%d", i), Ts: int64(2000 + i)}); err != nil {
			t.Fatalf("post filler %d: %v", i, err)
		}
	}

	oldRegistry := agentask.GlobalRegistry
	agentask.GlobalRegistry = agentask.MakeRegistry()
	defer func() { agentask.GlobalRegistry = oldRegistry }()
	agentask.GlobalRegistry.Set(oldAskORef, agentask.PendingAsk{Ts: 1})

	items, err := GatherAttentionFromLedger(ctx, []*waveobj.Channel{ch},
		map[string][]*waveobj.Run{ch.OID: {heldRun("r-ledger", "from caller ledger", 500)}})
	if err != nil {
		t.Fatalf("GatherAttentionFromLedger: %v", err)
	}

	var sawRunFromLedger, sawPlainAsk bool
	for _, it := range items {
		switch {
		case it.Kind == AttentionRunLandHeld && it.RunId == "r-ledger":
			sawRunFromLedger = true
		case it.Kind == AttentionAsk:
			sawPlainAsk = true
		case it.Kind == AttentionEscalation:
			t.Fatalf("escalation card scanned past the window: %+v", it)
		}
	}
	if !sawRunFromLedger {
		t.Fatalf("held land from caller-provided run row missing: %+v", items)
	}
	if !sawPlainAsk {
		t.Fatalf("pending ask outside the message window did not degrade to a plain ask: %+v", items)
	}
}

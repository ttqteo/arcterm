// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func TestStaleStatus(t *testing.T) {
	const mine = `C:\Users\u\.claude\projects\p\61c3c450.jsonl`
	working := baseds.AgentStatusData{ORef: "block:old", State: baseds.AgentState_Working, Detail: "editing a.go", Title: "Fix it", TranscriptPath: mine, Ts: 10}

	// the tab the session left still shows it working: idle it, keeping who it was
	idled, ok := staleStatus([]baseds.AgentStatusData{working, {Model: "opus"}}, mine, 99)
	if !ok {
		t.Fatal("a tab still showing this session working must be idled")
	}
	if idled.State != baseds.AgentState_Idle || idled.Detail != "" || idled.Ts != 99 || idled.Title != "Fix it" || idled.ORef != "block:old" {
		t.Fatalf("idled = %+v", idled)
	}

	for name, history := range map[string][]baseds.AgentStatusData{
		"already idle": {working, {State: baseds.AgentState_Idle, TranscriptPath: mine}},
		// the tab runs another session now; its status is that session's, not this one's to clear
		"another session": {working, {State: baseds.AgentState_Working, TranscriptPath: `C:\other.jsonl`}},
		"no status":       nil,
	} {
		if _, ok := staleStatus(history, mine, 99); ok {
			t.Errorf("%s: must be left alone", name)
		}
	}
	if _, ok := staleStatus([]baseds.AgentStatusData{working}, "", 99); ok {
		t.Error("no transcript to compare: must be left alone")
	}
}

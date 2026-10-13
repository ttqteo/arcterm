// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

const (
	recAssistantText    = `{"type":"assistant","message":{"content":[{"type":"text","text":"done"}]}}`
	recAssistantToolUse = `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash"}]}}`
	recAskUse           = `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a1","name":"AskUserQuestion"}]}}`
	recAskResult        = `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"a1"}]}}`
)

func TestDeriveState(t *testing.T) {
	now := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)
	quiet := 20 * time.Second
	fresh := now.Add(-2 * time.Second)  // within window
	stale := now.Add(-30 * time.Second) // past window

	cases := []struct {
		name string
		s    Snapshot
		want string
	}{
		{"dead process is idle even mid-tool", Snapshot{Lines: []string{recAssistantToolUse}, ModTime: fresh, Now: now, ProcAlive: false, QuietWindow: quiet}, baseds.AgentState_Idle},
		{"pending ask is asking", Snapshot{Lines: []string{recAskUse}, ModTime: fresh, Now: now, ProcAlive: true, QuietWindow: quiet}, baseds.AgentState_Asking},
		{"answered ask is not asking", Snapshot{Lines: []string{recAskUse, recAskResult, recAssistantToolUse}, ModTime: fresh, Now: now, ProcAlive: true, QuietWindow: quiet}, baseds.AgentState_Working},
		{"terminal + quiescent is idle", Snapshot{Lines: []string{recAssistantText}, ModTime: stale, Now: now, ProcAlive: true, QuietWindow: quiet}, baseds.AgentState_Idle},
		{"terminal but still fresh is working", Snapshot{Lines: []string{recAssistantText}, ModTime: fresh, Now: now, ProcAlive: true, QuietWindow: quiet}, baseds.AgentState_Working},
		{"mid-tool is working", Snapshot{Lines: []string{recAssistantToolUse}, ModTime: stale, Now: now, ProcAlive: true, QuietWindow: quiet}, baseds.AgentState_Working},
		{"asking beats a stale terminal-looking tail", Snapshot{Lines: []string{recAskUse}, ModTime: stale, Now: now, ProcAlive: true, QuietWindow: quiet}, baseds.AgentState_Asking},
		{"no records, alive is working", Snapshot{Lines: nil, ModTime: stale, Now: now, ProcAlive: true, QuietWindow: quiet}, baseds.AgentState_Working},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := DeriveState(c.s); got != c.want {
				t.Fatalf("DeriveState = %q, want %q", got, c.want)
			}
		})
	}
}

func TestLastRecordTerminal(t *testing.T) {
	if !lastRecordTerminal([]string{recAssistantToolUse, recAssistantText}) {
		t.Fatal("assistant text ending should be terminal")
	}
	if lastRecordTerminal([]string{recAssistantText, recAssistantToolUse}) {
		t.Fatal("pending tool_use ending should not be terminal")
	}
	if lastRecordTerminal([]string{recAskResult}) {
		t.Fatal("user record should not be terminal")
	}
	if lastRecordTerminal(nil) {
		t.Fatal("empty should not be terminal")
	}
}

func TestPendingAsk(t *testing.T) {
	if !pendingAsk([]string{recAskUse}) {
		t.Fatal("unanswered ask should be pending")
	}
	if pendingAsk([]string{recAskUse, recAskResult}) {
		t.Fatal("answered ask should not be pending")
	}
	if pendingAsk([]string{recAssistantToolUse}) {
		t.Fatal("a non-ask tool_use is not a pending ask")
	}
}

func TestAskOpenReadsPastTheToolsCalledBesideTheQuestion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.jsonl")
	write := func(records ...string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(strings.Join(records, "\n")+"\n"), 0o644); err != nil {
			t.Fatalf("writing transcript: %v", err)
		}
	}
	siblingResult := `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]}}`

	write(recAskUse, recAssistantToolUse, siblingResult)
	if open, err := AskOpen(path); err != nil || !open {
		t.Fatalf("a question with no result is open: open=%v err=%v", open, err)
	}
	write(recAskUse, recAssistantToolUse, siblingResult, recAskResult)
	if open, err := AskOpen(path); err != nil || open {
		t.Fatalf("a question with its result is closed: open=%v err=%v", open, err)
	}
	if _, err := AskOpen(filepath.Join(t.TempDir(), "missing.jsonl")); err == nil {
		t.Fatal("a transcript that cannot be read is an error, not a closed question")
	}
}

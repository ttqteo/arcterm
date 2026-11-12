// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import (
	"os"
	"path/filepath"
	"reflect"
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

// recAskWithInput is an AskUserQuestion call that carries its questions the way Claude writes them.
const recAskWithInput = `{"type":"assistant","message":{"content":[{"type":"text","text":"one question"},` +
	`{"type":"tool_use","id":"a1","name":"AskUserQuestion","input":{"questions":[` +
	`{"question":"Which approach?","header":"Approach","multiSelect":true,"options":[` +
	`{"label":"A","description":"the small one"},{"label":"B","description":"the big one","preview":"# B"}]},` +
	`{"question":"Ship it?","header":"Ship","options":[{"label":"Yes"},{"label":"No"}]}]}}]}}`

func TestOpenAskReturnsTheOpenQuestionsFromTheToolInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.jsonl")
	write := func(records ...string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(strings.Join(records, "\n")+"\n"), 0o644); err != nil {
			t.Fatalf("writing transcript: %v", err)
		}
	}
	siblingResult := `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]}}`

	write(recAssistantToolUse, recAskWithInput, siblingResult)
	id, questions, ok, err := OpenAsk(path)
	if err != nil || !ok || id != "a1" {
		t.Fatalf("an AskUserQuestion with no result is open: id=%q ok=%v err=%v", id, ok, err)
	}
	want := []baseds.AgentAskQuestion{
		{Question: "Which approach?", Header: "Approach", MultiSelect: true, Options: []baseds.AgentAskOption{
			{Label: "A", Description: "the small one"},
			{Label: "B", Description: "the big one", Preview: "# B"},
		}},
		{Question: "Ship it?", Header: "Ship", Options: []baseds.AgentAskOption{{Label: "Yes"}, {Label: "No"}}},
	}
	if !reflect.DeepEqual(questions, want) {
		t.Fatalf("questions decoded from the tool_use input:\n got %+v\nwant %+v", questions, want)
	}

	write(recAssistantToolUse, recAskWithInput, siblingResult, recAskResult)
	if id, questions, ok, err := OpenAsk(path); err != nil || ok || id != "" || questions != nil {
		t.Fatalf("a question with its result is closed: id=%q questions=%v ok=%v err=%v", id, questions, ok, err)
	}
	if _, _, _, err := OpenAsk(filepath.Join(t.TempDir(), "missing.jsonl")); err == nil {
		t.Fatal("a transcript that cannot be read is an error, not a closed question")
	}
}

// an open question whose input carries no questions has nothing to show a person: it is not recoverable
func TestOpenAskWithoutQuestionsIsNotOpen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.jsonl")
	if err := os.WriteFile(path, []byte(recAskUse+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if id, _, ok, err := OpenAsk(path); err != nil || ok {
		t.Fatalf("an ask with no input has no questions to recover: id=%q ok=%v err=%v", id, ok, err)
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

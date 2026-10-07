// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
)

// a claude transcript writes a user record for far more than what a person typed: tool output, harness
// notices, slash commands, the compaction summary. Only the typed prompts are human prompts, including those
// typed while the session was busy, which it records as queued-command attachments rather than user records.
func TestHumanPromptsClaudeKeepsOnlyTypedPrompts(t *testing.T) {
	path := writeTranscript(t, []string{
		`{"type":"user","timestamp":"2026-09-17T06:02:05.000Z","origin":{"kind":"human"},"promptSource":"typed","message":{"role":"user","content":"You are the worker for task 1"}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:06.000Z","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:07.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"a.go"}]}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:08.000Z","isMeta":true,"message":{"role":"user","content":[{"type":"text","text":"# Skill body"}]}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:09.000Z","origin":{"kind":"task-notification"},"message":{"role":"user","content":"a background command finished"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:10.000Z","message":{"role":"user","content":"<command-name>/compact</command-name>\n<command-args></command-args>"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:11.000Z","message":{"role":"user","content":"<local-command-stdout>Compacted</local-command-stdout>"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:12.000Z","isCompactSummary":true,"message":{"role":"user","content":"This session is being continued"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:13.000Z","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:14.000Z","origin":{"kind":"human"},"promptSource":"queued","message":{"role":"user","content":"keep closed-session links clickable"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:15.000Z","isSidechain":true,"message":{"role":"user","content":"a subagent's own prompt"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:16.000Z","origin":{"kind":"human"},"message":{"role":"user","content":[{"type":"text","text":"and use the"},{"type":"image"},{"type":"text","text":"shared chip"}]}}`,
		// typed while the session was busy: the queue records it, and it reaches the model as an attachment mid-turn
		`{"type":"queue-operation","operation":"enqueue","timestamp":"2026-09-17T06:02:17.000Z","content":"use hi instead of hello"}`,
		`{"type":"queue-operation","operation":"remove","timestamp":"2026-09-17T06:02:17.500Z","content":"use hi instead of hello","reason":"absorbed_mid_turn"}`,
		`{"type":"attachment","timestamp":"2026-09-17T06:02:17.000Z","attachment":{"type":"queued_command","prompt":"use hi instead of hello","commandMode":"prompt","origin":{"kind":"human"}}}`,
		`{"type":"attachment","timestamp":"2026-09-17T06:02:18.000Z","attachment":{"type":"queued_command","prompt":"<task-notification>\n<task-id>b1</task-id>\n</task-notification>","commandMode":"task-notification"}}`,
		`{"type":"attachment","timestamp":"2026-09-17T06:02:19.000Z","attachment":{"type":"queued_command","prompt":[{"type":"text","text":"match this"},{"type":"image"}],"commandMode":"prompt","origin":{"kind":"human"}}}`,
		`{"type":"attachment","timestamp":"2026-09-17T06:02:20.000Z","attachment":{"type":"edited_text_file","filename":"a.go"}}`,
		`not json`,
	})
	got := HumanPrompts(path, "claude")
	want := []HumanPrompt{
		{Ts: 1789624925000, Text: "You are the worker for task 1"},
		{Ts: 1789624934000, Text: "keep closed-session links clickable"},
		{Ts: 1789624936000, Text: "and use the\nshared chip"},
		{Ts: 1789624937000, Text: "use hi instead of hello"},
		{Ts: 1789624939000, Text: "match this"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("HumanPrompts = %+v\nwant %+v", got, want)
	}
}

// claude code wraps a long typed or pasted message in a pasted_content tag before the transcript records it, so
// the lead's own `dag tell` would not match the text it sent (run 6c7652be recorded it as the human's)
func TestHumanPromptsClaudeUnwrapsPastedContent(t *testing.T) {
	path := writeTranscript(t, []string{
		`{"type":"attachment","timestamp":"2026-09-17T06:02:17.000Z","attachment":{"type":"queued_command","prompt":"<pasted_content id=\"63b4\">\nPlan review round 2 findings.\nThey are part of your task.\n</pasted_content id=\"63b4\">","commandMode":"prompt","origin":{"kind":"human"}}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:18.000Z","origin":{"kind":"human"},"message":{"role":"user","content":"see <pasted_content id=\"be41\">\nlog a\n</pasted_content id=\"be41\"> and <pasted_content id=\"8\">\nlog b\n</pasted_content id=\"8\">"}}`,
	})
	got := HumanPrompts(path, "claude")
	want := []HumanPrompt{
		{Ts: 1789624937000, Text: "Plan review round 2 findings.\nThey are part of your task."},
		{Ts: 1789624938000, Text: "see log a and log b"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("HumanPrompts = %+v\nwant %+v", got, want)
	}
}

func TestHumanPromptsPiReadsTheActiveBranch(t *testing.T) {
	path := writeTranscript(t, []string{
		`{"type":"session","version":3,"id":"s1","timestamp":"2026-09-17T06:00:00Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"u1","parentId":null,"timestamp":"2026-09-17T06:00:01Z","message":{"role":"user","content":"You are the worker for task 2"}}`,
		`{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-09-17T06:00:02Z","message":{"role":"assistant","content":"ok"}}`,
		`{"type":"message","id":"u2","parentId":"a1","timestamp":"2026-09-17T06:00:03Z","message":{"role":"user","content":[{"type":"text","text":"skip the docs"}]}}`,
	})
	got := HumanPrompts(path, "pi")
	want := []HumanPrompt{
		{Ts: 1789624801000, Text: "You are the worker for task 2"},
		{Ts: 1789624803000, Text: "skip the docs"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("HumanPrompts = %+v\nwant %+v", got, want)
	}
}

// jsonString is s as a JSON string literal, for a fixture line that carries a message with quotes and newlines.
func jsonString(t *testing.T, s string) string {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// a message another agent sent with wsh agents send is typed into the session like a prompt, and claude records
// a long one inside a pasted_content tag; neither is something the human told the session
func TestHumanPromptsSkipAgentMessages(t *testing.T) {
	msg := agentmsg.Envelope("design lead", "tab-1234", "/clear\nthen apply the review notes")
	pasted := "<pasted_content id=\"63b4\">\n" + msg + "\n</pasted_content id=\"63b4\">"
	claude := writeTranscript(t, []string{
		`{"type":"user","timestamp":"2026-09-17T06:02:05.000Z","origin":{"kind":"human"},"message":{"role":"user","content":"build the panel"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:06.000Z","origin":{"kind":"human"},"message":{"role":"user","content":` + jsonString(t, msg) + `}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:07.000Z","origin":{"kind":"human"},"message":{"role":"user","content":` + jsonString(t, pasted) + `}}`,
		`{"type":"attachment","timestamp":"2026-09-17T06:02:08.000Z","attachment":{"type":"queued_command","prompt":` + jsonString(t, pasted) + `,"commandMode":"prompt","origin":{"kind":"human"}}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:14.000Z","origin":{"kind":"human"},"message":{"role":"user","content":"keep the header sticky"}}`,
	})
	wantClaude := []HumanPrompt{
		{Ts: 1789624925000, Text: "build the panel"},
		{Ts: 1789624934000, Text: "keep the header sticky"},
	}
	if got := HumanPrompts(claude, "claude"); !reflect.DeepEqual(got, wantClaude) {
		t.Fatalf("claude HumanPrompts = %+v\nwant %+v", got, wantClaude)
	}

	pi := writeTranscript(t, []string{
		`{"type":"session","version":3,"id":"s1","timestamp":"2026-09-17T06:00:00Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"u1","parentId":null,"timestamp":"2026-09-17T06:00:01Z","message":{"role":"user","content":"build the panel"}}`,
		`{"type":"message","id":"u2","parentId":"u1","timestamp":"2026-09-17T06:00:02Z","message":{"role":"user","content":[{"type":"text","text":` + jsonString(t, msg) + `}]}}`,
		`{"type":"message","id":"u3","parentId":"u2","timestamp":"2026-09-17T06:00:03Z","message":{"role":"user","content":"keep the header sticky"}}`,
	})
	wantPi := []HumanPrompt{
		{Ts: 1789624801000, Text: "build the panel"},
		{Ts: 1789624803000, Text: "keep the header sticky"},
	}
	if got := HumanPrompts(pi, "pi"); !reflect.DeepEqual(got, wantPi) {
		t.Fatalf("pi HumanPrompts = %+v\nwant %+v", got, wantPi)
	}
}

func TestHumanPromptsHasNoneForAnotherRuntimeOrAMissingFile(t *testing.T) {
	if got := HumanPrompts(writeTranscript(t, []string{`{"type":"user","message":{"content":"x"}}`}), "codex"); got != nil {
		t.Fatalf("codex HumanPrompts = %+v, want none", got)
	}
	if got := HumanPrompts("does-not-exist.jsonl", "claude"); got != nil {
		t.Fatalf("missing file HumanPrompts = %+v, want none", got)
	}
}

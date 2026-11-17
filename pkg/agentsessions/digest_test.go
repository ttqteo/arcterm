// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/pisession"
)

// the digest is what a person reads in the conversation: tool calls, tool output, thinking and a subagent's
// turns are not part of it
func TestTurnsClaudeKeepsPromptsAndReplies(t *testing.T) {
	lines := []string{
		`{"type":"user","timestamp":"2026-09-17T06:02:05.000Z","cwd":"/x","message":{"role":"user","content":"fix the hook timeout"}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:06.000Z","message":{"content":[{"type":"thinking","thinking":"secret thought"}]}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:07.000Z","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"grep timeout"}}]}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:08.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"tool output text"}]}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:09.000Z","isSidechain":true,"message":{"content":[{"type":"text","text":"a subagent reply"}]}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:10.000Z","isSidechain":true,"message":{"role":"user","content":"a subagent prompt"}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:11.000Z","message":{"content":[{"type":"text","text":"the timeout was the dial"}]}}`,
	}
	got := claudeTurns(parseClaudeLines(lines))
	want := []Turn{
		{Speaker: "user", Text: "fix the hook timeout", Ts: 1789624925000},
		{Speaker: "agent", Text: "the timeout was the dial", Ts: 1789624931000},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("turns = %+v\nwant %+v", got, want)
	}
}

// a prompt is judged as HumanPrompts judges it: Claude's own notices, the compaction summary, a meta record and
// another agent's message are not typed by a person, and a message queued while the session was busy is
func TestTurnsClaudePromptsFollowHumanPrompts(t *testing.T) {
	lines := []string{
		`{"type":"user","timestamp":"2026-09-17T06:00:01.000Z","message":{"role":"user","content":"first prompt"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:00:02.000Z","isMeta":true,"message":{"role":"user","content":"[Image: 800x600]"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:00:03.000Z","isCompactSummary":true,"message":{"role":"user","content":"This session is being continued"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:00:04.000Z","message":{"role":"user","content":"<command-name>/clear</command-name>"}}`,
		`{"type":"user","timestamp":"2026-09-17T06:00:05.000Z","origin":{"kind":"task-notification"},"message":{"role":"user","content":"a background task finished"}}`,
		`{"type":"attachment","timestamp":"2026-09-17T06:00:06.000Z","attachment":{"type":"queued_command","commandMode":"prompt","prompt":"queued while busy"}}`,
		`{"type":"attachment","timestamp":"2026-09-17T06:00:07.000Z","attachment":{"type":"queued_command","commandMode":"bash","prompt":"ls"}}`,
	}
	got := claudeTurns(parseClaudeLines(lines))
	want := []Turn{
		{Speaker: "user", Text: "first prompt", Ts: 1789624801000},
		{Speaker: "user", Text: "queued while busy", Ts: 1789624806000},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("turns = %+v\nwant %+v", got, want)
	}
	// one source of truth: the digest's prompts are the prompts HumanPrompts finds in the same lines
	var prompts []Turn
	for _, p := range claudeHumanPrompts(lines) {
		prompts = append(prompts, Turn{Speaker: "user", Text: p.Text, Ts: p.Ts})
	}
	if !reflect.DeepEqual(prompts, want) {
		t.Fatalf("HumanPrompts = %+v\nwant the digest's %+v", prompts, want)
	}
}

func TestTurnsPiReadsTheActiveBranchOnly(t *testing.T) {
	path := writeTranscript(t, []string{
		`{"type":"session","version":3,"id":"s1","timestamp":"2026-09-17T06:00:00Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"u1","parentId":null,"timestamp":"2026-09-17T06:00:01Z","message":{"role":"user","content":"review the diff"}}`,
		`{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-09-17T06:00:02Z","message":{"role":"assistant","content":[{"type":"text","text":"an abandoned answer"}]}}`,
		`{"type":"message","id":"a2","parentId":"u1","timestamp":"2026-09-17T06:00:03Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"the diff is fine"}]}}`,
		`{"type":"message","id":"a3","parentId":"a2","timestamp":"2026-09-17T06:00:04Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"bash"}]}}`,
		`{"type":"message","id":"r1","parentId":"a3","timestamp":"2026-09-17T06:00:05Z","message":{"role":"toolResult","content":[{"type":"text","text":"a.go"}]}}`,
		`{"type":"message","id":"u2","parentId":"r1","timestamp":"2026-09-17T06:00:06Z","message":{"role":"user","content":[{"type":"text","text":"ship it"}]}}`,
	})
	file, err := pisession.Read(path)
	if err != nil {
		t.Fatal(err)
	}
	got := piTurns(file)
	want := []Turn{
		{Speaker: "user", Text: "review the diff", Ts: 1789624801000},
		{Speaker: "agent", Text: "the diff is fine", Ts: 1789624803000},
		{Speaker: "user", Text: "ship it", Ts: 1789624806000},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("turns = %+v\nwant %+v", got, want)
	}
}

// Task 3 writes a digest's turns to disk, so the field names are part of the file format
func TestTurnsJSONNames(t *testing.T) {
	got, err := json.Marshal([]Turn{{Speaker: "user", Text: "hi", Ts: 5}})
	if err != nil {
		t.Fatal(err)
	}
	if want := `[{"speaker":"user","text":"hi","ts":5}]`; string(got) != want {
		t.Fatalf("turns json = %s, want %s", got, want)
	}
}

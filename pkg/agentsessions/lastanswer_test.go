// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"strings"
	"testing"
)

// the answer is the last thing the session itself said: a subagent's reply recorded after it, and a turn that
// only called a tool, are not it
func TestLastAnswerClaudeIsTheLastMainChainText(t *testing.T) {
	long := strings.Repeat("a long answer ", 40)
	path := writeTranscript(t, []string{
		`{"type":"user","timestamp":"2026-09-17T06:02:05.000Z","message":{"role":"user","content":"review the diff"}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:06.000Z","message":{"content":[{"type":"text","text":"an earlier answer"}]}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:14.000Z","message":{"content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"` + long + `"},{"type":"text","text":"  "},{"type":"text","text":"second block"}]}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:15.000Z","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:16.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"a.go"}]}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:17.000Z","isSidechain":true,"message":{"content":[{"type":"text","text":"a subagent's answer"}]}}`,
		`not json`,
	})
	text, ts := LastAnswer(path, "claude")
	if want := strings.TrimSpace(long) + "\nsecond block"; text != want {
		t.Fatalf("text = %q\nwant %q", text, want)
	}
	if ts != 1789624934000 {
		t.Fatalf("ts = %d, want 1789624934000", ts)
	}
}

func TestLastAnswerPiIsTheActiveBranchsLastAssistantText(t *testing.T) {
	path := writeTranscript(t, []string{
		`{"type":"session","version":3,"id":"s1","timestamp":"2026-09-17T06:00:00Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"u1","parentId":null,"timestamp":"2026-09-17T06:00:01Z","message":{"role":"user","content":"review the diff"}}`,
		`{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-09-17T06:00:02Z","message":{"role":"assistant","content":[{"type":"text","text":"an abandoned answer"}]}}`,
		`{"type":"message","id":"a2","parentId":"u1","timestamp":"2026-09-17T06:00:03Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"the diff is fine"}]}}`,
		`{"type":"message","id":"a3","parentId":"a2","timestamp":"2026-09-17T06:00:04Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"bash"}]}}`,
		`{"type":"message","id":"r1","parentId":"a3","timestamp":"2026-09-17T06:00:05Z","message":{"role":"toolResult","content":[{"type":"text","text":"a.go"}]}}`,
	})
	text, ts := LastAnswer(path, "pi")
	if text != "the diff is fine" || ts != 1789624803000 {
		t.Fatalf("LastAnswer = %q, %d; want %q, 1789624803000", text, ts, "the diff is fine")
	}
}

func TestLastAnswerHasNoneBeforeTheFirstAnswerOrForAnotherRuntime(t *testing.T) {
	claude := writeTranscript(t, []string{
		`{"type":"user","timestamp":"2026-09-17T06:02:05.000Z","message":{"role":"user","content":"review the diff"}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:06.000Z","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}`,
	})
	pi := writeTranscript(t, []string{
		`{"type":"session","version":3,"id":"s1","timestamp":"2026-09-17T06:00:00Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"u1","parentId":null,"timestamp":"2026-09-17T06:00:01Z","message":{"role":"user","content":"review the diff"}}`,
	})
	answered := writeTranscript(t, []string{
		`{"type":"assistant","timestamp":"2026-09-17T06:02:06.000Z","message":{"content":[{"type":"text","text":"done"}]}}`,
	})
	for _, c := range []struct{ name, path, runtime string }{
		{"claude with no assistant text", claude, "claude"},
		{"pi with no assistant message", pi, "pi"},
		{"codex", answered, "codex"},
		{"missing claude file", "does-not-exist.jsonl", "claude"},
		{"missing pi file", "does-not-exist.jsonl", "pi"},
	} {
		if text, ts := LastAnswer(c.path, c.runtime); text != "" || ts != 0 {
			t.Errorf("%s: LastAnswer = %q, %d; want none", c.name, text, ts)
		}
	}
}

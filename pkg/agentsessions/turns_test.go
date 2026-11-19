// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"reflect"
	"testing"
)

// a board reads only what the session said and was told since its cursor: a subagent's turns, tool calls and
// tool output are not turns, and the text records of one answer read as one turn
func TestTurnsSinceClaudeKeepsMainChainTextAfterTheCursor(t *testing.T) {
	path := writeTranscript(t, []string{
		`{"type":"user","timestamp":"2026-09-17T06:02:05.000Z","origin":{"kind":"human"},"message":{"role":"user","content":"an old prompt"}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:06.000Z","message":{"content":[{"type":"text","text":"an old answer"}]}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:10.000Z","origin":{"kind":"human"},"message":{"role":"user","content":"draw the cache"}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:11.000Z","message":{"content":[{"type":"thinking","thinking":"hm"},{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}`,
		`{"type":"user","timestamp":"2026-09-17T06:02:12.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"a.go"}]}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:13.000Z","isSidechain":true,"message":{"content":[{"type":"text","text":"a subagent's answer"}]}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:14.000Z","message":{"content":[{"type":"text","text":"the cache has two tiers"}]}}`,
		`{"type":"assistant","timestamp":"2026-09-17T06:02:15.000Z","message":{"content":[{"type":"text","text":"and one lock"}]}}`,
		`not json`,
	})
	got := TurnsSince(path, "claude", 1789624926000) // 06:02:06, the old answer
	want := []Turn{
		{Speaker: "user", Text: "draw the cache", Ts: 1789624930000},
		{Speaker: "agent", Text: "the cache has two tiers\nand one lock", Ts: 1789624935000},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("TurnsSince = %#v\nwant %#v", got, want)
	}
	if got := TurnsSince(path, "claude", 1789624935000); len(got) != 0 {
		t.Fatalf("TurnsSince at the last turn = %#v, want none", got)
	}
}

// boards are for claude agents: another runtime's transcript, even a readable one, has no turns here, and neither
// has a file that is not there
func TestTurnsSinceHasNoneForAnotherRuntimeOrAMissingFile(t *testing.T) {
	answered := writeTranscript(t, []string{
		`{"type":"assistant","timestamp":"2026-09-17T06:02:06.000Z","message":{"content":[{"type":"text","text":"done"}]}}`,
	})
	for _, runtime := range []string{"codex", "pi", "agy", ""} {
		if got := TurnsSince(answered, runtime, 0); len(got) != 0 {
			t.Fatalf("%q: TurnsSince = %#v, want none", runtime, got)
		}
	}
	if got := TurnsSince("does-not-exist.jsonl", "claude", 0); len(got) != 0 {
		t.Fatalf("missing claude file: TurnsSince = %#v, want none", got)
	}
}

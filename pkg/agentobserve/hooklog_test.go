// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import "testing"

func TestParseHookLog(t *testing.T) {
	log := `2026-07-12T12:00:00Z published event=UserPromptSubmit state=working oref=block:abc
2026-07-12T12:00:05Z skip: no jwt in env event=PreToolUse
2026-07-12T12:00:10Z published event=PreToolUse state=working oref=block:abc
2026-07-12T12:00:30Z published event=Stop state=idle oref=block:abc
2026-07-12T12:01:00Z published event=UserPromptSubmit state=working oref=block:def
garbage line
`
	got := ParseHookLog(log)
	abc, ok := got["abc"]
	if !ok {
		t.Fatal("expected block abc")
	}
	if abc.Count != 3 {
		t.Fatalf("abc.Count = %d, want 3 (skip line excluded)", abc.Count)
	}
	if abc.LastState != "idle" {
		t.Fatalf("abc.LastState = %q, want idle", abc.LastState)
	}
	if abc.FirstMs >= abc.LastMs {
		t.Fatal("FirstMs should precede LastMs")
	}
	if _, ok := got["def"]; !ok {
		t.Fatal("expected block def")
	}
	if got["def"].Count != 1 {
		t.Fatalf("def.Count = %d, want 1", got["def"].Count)
	}
}

func TestParseHookLogEmpty(t *testing.T) {
	if len(ParseHookLog("")) != 0 {
		t.Fatal("empty log should yield no blocks")
	}
}

func TestParseHookLogSpanAndTies(t *testing.T) {
	log := `2026-07-12T12:00:10Z published event=PreToolUse state=working oref=block:abc
2026-07-12T12:00:00Z published event=UserPromptSubmit state=working oref=block:abc
2026-07-12T12:00:30Z published event=PreToolUse state=working oref=block:abc
2026-07-12T12:00:30Z published event=Stop state=idle oref=block:abc
2026-07-12T12:00:40Z skip: no jwt in env event=Notification state=waiting oref=block:abc
`
	got := ParseHookLog(log)
	want := HookState{
		FirstMs:   parseRFC3339Ms("2026-07-12T12:00:00Z"),
		LastMs:    parseRFC3339Ms("2026-07-12T12:00:30Z"),
		LastState: "idle", // the later of two lines at the same time wins
		Count:     4,      // a skip line never counts, even one naming a block
	}
	if len(got) != 1 || got["abc"] != want {
		t.Fatalf("ParseHookLog = %+v, want only abc = %+v", got, want)
	}
}

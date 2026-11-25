// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import "testing"

// tokensSinceMs is 2026-11-25T10:00:00Z, the instant the tests below count from.
const tokensSinceMs = int64(1795600800000)

// a message Claude Code writes once per content block counts once, by the line with the most output; a request
// before sinceMs is left out and one exactly at sinceMs is in
func TestTokensSinceClaudeCountsEachRequestOnceFromSince(t *testing.T) {
	path := writeTranscript(t, []string{
		`{"type":"assistant","timestamp":"2026-11-25T09:59:59.999Z","requestId":"r0","message":{"id":"m0","usage":{"input_tokens":1000,"output_tokens":1000,"cache_read_input_tokens":1000,"cache_creation_input_tokens":1000}}}`,
		`{"type":"user","timestamp":"2026-11-25T10:00:00.000Z","message":{"content":"go on"}}`,
		`{"type":"assistant","timestamp":"2026-11-25T10:00:00.000Z","requestId":"r1","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}`,
		`{"type":"assistant","timestamp":"2026-11-25T10:00:01.000Z","requestId":"r1","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":40,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}`,
		`{"type":"assistant","timestamp":"2026-11-25T10:00:02.000Z","requestId":"r1","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":40,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}`,
		`not json`,
		`{"type":"assistant","timestamp":"2026-11-25T10:05:00.000Z","requestId":"r2","message":{"id":"m2","usage":{"input_tokens":1,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":4}}}`,
	})
	// m1 counts 10+40+100+50, m2 counts 1+2+3+4
	if got := TokensSince(path, "claude", tokensSinceMs); got != 210 {
		t.Fatalf("TokensSince = %d, want 210", got)
	}
	// from the start of the file every request counts, the earlier one too
	if got := TokensSince(path, "claude", 0); got != 4210 {
		t.Fatalf("TokensSince from 0 = %d, want 4210", got)
	}
	// from after the last request nothing counts
	if got := TokensSince(path, "claude", tokensSinceMs+3_600_000); got != 0 {
		t.Fatalf("TokensSince after the last request = %d, want 0", got)
	}
}

// pi bills a message's usage nested in the message and a compaction's at the top level, an abandoned branch too
// (usagestats bills it); reasoning is a subset of output and is not added again
func TestTokensSincePiCountsBilledEntriesFromSince(t *testing.T) {
	path := writeTranscript(t, []string{
		`{"type":"session","version":3,"id":"s1","timestamp":"2026-11-25T09:00:00Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"a0","parentId":null,"timestamp":"2026-11-25T09:59:00Z","message":{"role":"assistant","usage":{"input":500,"output":500,"cacheRead":500,"cacheWrite":500,"totalTokens":2000}}}`,
		`{"type":"message","id":"u1","parentId":"a0","timestamp":"2026-11-25T10:00:00Z","message":{"role":"user","content":"go on"}}`,
		`{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-11-25T10:00:00Z","message":{"role":"assistant","usage":{"input":10,"output":20,"reasoning":5,"cacheRead":100,"cacheWrite":50,"totalTokens":180}}}`,
		`{"type":"message","id":"a2","parentId":"u1","timestamp":"2026-11-25T10:01:00Z","message":{"role":"assistant","usage":{"input":1,"output":2,"cacheRead":3,"cacheWrite":4,"totalTokens":10}}}`,
		`{"type":"message","id":"r1","parentId":"a1","timestamp":"2026-11-25T10:01:30Z","message":{"role":"toolResult","usage":{"input":7}}}`,
		`{"type":"compaction","id":"c1","parentId":"r1","timestamp":"2026-11-25T10:02:00Z","summary":"s","usage":{"input":100,"output":10}}`,
	})
	// a1 180, a2 10, r1 7, c1 110; a0 is before sinceMs
	if got := TokensSince(path, "pi", tokensSinceMs); got != 307 {
		t.Fatalf("TokensSince = %d, want 307", got)
	}
	if got := TokensSince(path, "pi", 0); got != 2307 {
		t.Fatalf("TokensSince from 0 = %d, want 2307", got)
	}
}

func TestTokensSinceIsZeroForAnotherHarnessAnUnreadableFileOrNoRecords(t *testing.T) {
	claude := writeTranscript(t, []string{
		`{"type":"assistant","timestamp":"2026-11-25T10:05:00.000Z","requestId":"r2","message":{"id":"m2","usage":{"input_tokens":1,"output_tokens":2}}}`,
	})
	pi := writeTranscript(t, []string{
		`{"type":"session","version":3,"id":"s1","timestamp":"2026-11-25T09:00:00Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"u1","parentId":null,"timestamp":"2026-11-25T10:00:00Z","message":{"role":"user","content":"go on"}}`,
	})
	notPi := writeTranscript(t, []string{`not a pi session`})
	for _, c := range []struct{ name, path, harness string }{
		{"codex", claude, "codex"},
		{"no harness", claude, ""},
		{"missing claude file", "does-not-exist.jsonl", "claude"},
		{"missing pi file", "does-not-exist.jsonl", "pi"},
		{"pi file with no usage", pi, "pi"},
		{"pi file that is not a pi session", notPi, "pi"},
	} {
		if got := TokensSince(c.path, c.harness, 0); got != 0 {
			t.Errorf("%s: TokensSince = %d, want 0", c.name, got)
		}
	}
}

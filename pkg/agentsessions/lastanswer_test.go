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

// a dead route leaves the session idle with only its transcript saying why; an error it recovered from is not it
func TestLastErrorIsTheLastAssistantMessageWhenItFailed(t *testing.T) {
	piHead := []string{
		`{"type":"session","version":3,"id":"s1","timestamp":"2026-09-24T14:03:55Z","cwd":"C:\\repo"}`,
		`{"type":"message","id":"u1","parentId":null,"timestamp":"2026-09-24T14:03:57Z","message":{"role":"user","content":"review the diff"}}`,
	}
	piDenied := `{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-09-24T14:03:58Z","message":{"role":"assistant","content":[],"provider":"opencode-go","model":"deepseek-v4-flash","stopReason":"error","errorMessage":"403: {\"type\":\"server_error\",\"message\":\"An active OpenCode Go subscription is required to use Go models.\"}"}}`
	claudeLimit := `{"type":"assistant","timestamp":"2026-09-11T16:43:52.938Z","isApiErrorMessage":true,"error":"rate_limit","message":{"role":"assistant","content":[{"type":"text","text":"You've hit your session limit · resets 2:30am"}]}}`
	claudeUser := `{"type":"user","timestamp":"2026-09-11T16:43:50.000Z","message":{"role":"user","content":"review the diff"}}`
	for _, c := range []struct {
		name, runtime, want string
		lines               []string
	}{
		{"pi refused by its provider", "pi", `403: {"type":"server_error","message":"An active OpenCode Go subscription is required to use Go models."}`,
			append(append([]string{}, piHead...), piDenied)},
		{"pi recovered after a failure", "pi", "",
			append(append([]string{}, piHead...), piDenied, `{"type":"message","id":"a2","parentId":"a1","timestamp":"2026-09-24T14:04:01Z","message":{"role":"assistant","content":[{"type":"text","text":"the diff is fine"}],"stopReason":"stop"}}`)},
		{"pi aborted", "pi", "",
			append(append([]string{}, piHead...), `{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-09-24T14:03:58Z","message":{"role":"assistant","content":[],"stopReason":"aborted","errorMessage":"Operation aborted"}}`)},
		{"claude out of usage", "claude", "You've hit your session limit · resets 2:30am", []string{claudeUser, claudeLimit}},
		{"claude recovered after a failure", "claude", "",
			[]string{claudeUser, claudeLimit, `{"type":"assistant","timestamp":"2026-09-11T19:31:00.000Z","message":{"content":[{"type":"text","text":"done"}]}}`}},
		{"claude subagent failed after the main answer", "claude", "",
			[]string{claudeUser, `{"type":"assistant","timestamp":"2026-09-11T16:43:51.000Z","message":{"content":[{"type":"text","text":"done"}]}}`,
				`{"type":"assistant","timestamp":"2026-09-11T16:43:52.000Z","isSidechain":true,"isApiErrorMessage":true,"message":{"content":[{"type":"text","text":"API Error: 529"}]}}`}},
		{"claude failed with a long page", "claude", strings.Repeat("x", maxErrorText-1) + "…",
			[]string{`{"type":"assistant","isApiErrorMessage":true,"message":{"content":[{"type":"text","text":"` + strings.Repeat("x", 2*maxErrorText) + `"}]}}`}},
	} {
		if got := LastError(writeTranscript(t, c.lines), c.runtime).Text; got != c.want {
			t.Errorf("%s: LastError = %q\nwant %q", c.name, got, c.want)
		}
	}
	if got := LastError(writeTranscript(t, []string{claudeLimit}), "codex"); got != (Failure{}) {
		t.Errorf("codex: LastError = %q, want none", got)
	}
	if got := LastError("does-not-exist.jsonl", "pi"); got != (Failure{}) {
		t.Errorf("missing pi file: LastError = %q, want none", got)
	}
	denied := LastError(writeTranscript(t, append(append([]string{}, piHead...), piDenied)), "pi")
	if denied.Model != "opencode-go/deepseek-v4-flash" || !denied.Refused() {
		t.Errorf("pi refusal = %+v (refused %v); want the route id opencode-go/deepseek-v4-flash, refused", denied, denied.Refused())
	}
}

// only a status the account cannot outwait is a refusal: a usage limit resets and a 5xx passes
func TestFailureRefusedIsAnUnauthorizedOrForbiddenStatus(t *testing.T) {
	for text, want := range map[string]bool{
		`403: {"type":"server_error"}`:                  true,
		"401 Unauthorized":                              true,
		"4031 tokens":                                   false,
		"502 status code (no body)":                     false,
		"429: rate limited":                             false,
		"You've hit your session limit · resets 2:30am": false,
		"Connection error.":                             false,
		"":                                              false,
	} {
		if got := (Failure{Text: text}).Refused(); got != want {
			t.Errorf("Refused(%q) = %v, want %v", text, got, want)
		}
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"os"
	"reflect"
	"testing"
	"time"
)

func TestClipText(t *testing.T) {
	if got := clipText("  hello   world  "); got != "hello world" {
		t.Errorf("clipText collapse = %q", got)
	}
	long := ""
	for i := 0; i < 120; i++ {
		long += "x"
	}
	got := clipText(long)
	if len([]rune(got)) != maxEventText {
		t.Errorf("clipText len = %d, want %d", len([]rune(got)), maxEventText)
	}
	if got[len(got)-len("…"):] != "…" {
		t.Errorf("clipText should end with ellipsis, got %q", got)
	}
}

func TestTrimTo(t *testing.T) {
	if got := trimTo("  short  ", 120); got != "short" {
		t.Errorf("trimTo keep = %q", got)
	}
	long := ""
	for i := 0; i < 130; i++ {
		long += "日本語"
	}
	got := trimTo(long, 120)
	if len([]rune(got)) != 120 { // 119 runes + the ellipsis
		t.Errorf("trimTo rune len = %d, want 120", len([]rune(got)))
	}
	if got[len(got)-len("…"):] != "…" {
		t.Errorf("trimTo should end with ellipsis, got %q", got)
	}
	// the old byte-slice cut mid-rune and emitted a replacement char; the rune form stays clean
	for _, r := range []rune(got) {
		if r == '\ufffd' {
			t.Errorf("trimTo produced a replacement char: %q", got)
		}
	}
}

func TestParseTs(t *testing.T) {
	if got := parseTs("2026-07-10T12:00:00.000Z"); got != 1783684800000 {
		t.Errorf("parseTs = %d", got)
	}
	if got := parseTs("garbage"); got != 0 {
		t.Errorf("parseTs(garbage) = %d, want 0", got)
	}
	if got := parseTs(""); got != 0 {
		t.Errorf("parseTs(empty) = %d, want 0", got)
	}
}

func TestCommitSubject(t *testing.T) {
	if got := commitSubject(`git commit -m "add coupon tests"`); got != "add coupon tests" {
		t.Errorf("commitSubject = %q", got)
	}
	if got := commitSubject("git commit"); got != "committed" {
		t.Errorf("commitSubject fallback = %q", got)
	}
}

// An ask the user answered (its tool_result came back) or talked past (a new prompt) no longer waits,
// even when nothing countable happens after it.
func TestExtractClaudeEventsAnsweredAskIsDone(t *testing.T) {
	ask := `{"type":"assistant","timestamp":"2026-07-10T12:00:08.000Z","message":{"content":[{"type":"tool_use","id":"t2","name":"AskUserQuestion","input":{"questions":[{"question":"Proceed?"}]}}]}}`
	reply := `{"type":"assistant","timestamp":"2026-07-10T12:00:20.000Z","message":{"content":[{"type":"text","text":"Done."}]}}`
	cases := map[string]string{
		"answered": `{"type":"user","timestamp":"2026-07-10T12:00:15.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"t2","content":"Yes"}]}}`,
		"prompted": `{"type":"user","timestamp":"2026-07-10T12:00:15.000Z","message":{"content":"never mind, do X"}}`,
	}
	for name, answer := range cases {
		t.Run(name, func(t *testing.T) {
			got := extractClaudeEvents([]string{ask, answer, reply})
			if got.Status != "done" {
				t.Fatalf("status = %q, want done", got.Status)
			}
			if last := got.Events[len(got.Events)-1]; last.Type != "finished" || last.Text != "Done." {
				t.Errorf("last event = %+v, want finished \"Done.\"", last)
			}
		})
	}
}

func TestExtractClaudeEvents(t *testing.T) {
	lines := []string{
		`{"type":"user","timestamp":"2026-07-10T12:00:00.000Z","message":{"content":"Fix the coupon coverage gap"}}`,
		`{"type":"assistant","timestamp":"2026-07-10T12:00:05.000Z","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"git commit -m \"add coupon tests\""}}]}}`,
		`{"type":"assistant","timestamp":"2026-07-10T12:00:08.000Z","message":{"content":[{"type":"tool_use","id":"t2","name":"AskUserQuestion","input":{"questions":[{"question":"Proceed with the migration?"}]}}]}}`,
	}
	got := extractClaudeEvents(lines)
	if got.Status != "waiting" {
		t.Errorf("status = %q, want waiting (last real event is an ask)", got.Status)
	}
	// started + committed + asked ; no finished (status != done)
	types := []string{}
	for _, e := range got.Events {
		types = append(types, e.Type)
	}
	want := []string{"started", "committed", "asked"}
	if len(types) != len(want) {
		t.Fatalf("event types = %v, want %v", types, want)
	}
	for i := range want {
		if types[i] != want[i] {
			t.Fatalf("event types = %v, want %v", types, want)
		}
	}
	if got.Events[0].Text != "Fix the coupon coverage gap" {
		t.Errorf("started text = %q", got.Events[0].Text)
	}
	if got.Events[1].Text != "add coupon tests" {
		t.Errorf("committed text = %q", got.Events[1].Text)
	}
	if got.Events[2].Text != "Proceed with the migration?" {
		t.Errorf("asked text = %q", got.Events[2].Text)
	}
	if got.StartedTs != 1783684800000 {
		t.Errorf("startedTs = %d", got.StartedTs)
	}
	if got.DurationMs != 8000 {
		t.Errorf("durationMs = %d, want 8000", got.DurationMs)
	}
}

func TestExtractClaudeEvents_errorKeepsSessionDone(t *testing.T) {
	lines := []string{
		`{"type":"user","timestamp":"2026-07-10T09:00:00.000Z","message":{"content":"Migrate session store"}}`,
		`{"type":"assistant","timestamp":"2026-07-10T09:00:03.000Z","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"redis-cli ping"}}]}}`,
		`{"type":"user","timestamp":"2026-07-10T09:00:05.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true}]}}`,
	}
	got := extractClaudeEvents(lines)
	if got.Status != "done" {
		t.Errorf("status = %q, want done", got.Status)
	}
	n := len(got.Events)
	if errored := got.Events[n-2]; errored.Type != "errored" || errored.Text != "failed: redis-cli ping" {
		t.Errorf("event = %+v, want errored 'failed: redis-cli ping'", errored)
	}
	if got.Events[n-1].Type != "finished" {
		t.Errorf("last event = %+v, want finished", got.Events[n-1])
	}
}

func TestExtractCodexEvents(t *testing.T) {
	lines := []string{
		`{"type":"session_meta","timestamp":"2026-07-10T09:00:00.000Z","payload":{"cwd":"/home/me/payments-api","git":{"branch":"feat/redis"}}}`,
		`{"type":"response_item","timestamp":"2026-07-10T09:00:03.000Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Migrate to redis"}]}}`,
		`{"type":"response_item","timestamp":"2026-07-10T09:00:10.000Z","payload":{"type":"function_call","name":"shell_command","call_id":"c1","arguments":"{\"command\":\"redis-cli ping\"}"}}`,
		`{"type":"response_item","timestamp":"2026-07-10T09:00:12.000Z","payload":{"type":"function_call_output","call_id":"c1","output":"Exit code: 1\nECONNREFUSED"}}`,
	}
	got := extractCodexEvents(lines)
	if got.Status != "done" {
		t.Errorf("status = %q, want done", got.Status)
	}
	if got.Events[0].Type != "started" || got.Events[0].Text != "Migrate to redis" {
		t.Errorf("first event = %+v", got.Events[0])
	}
	errored := got.Events[len(got.Events)-2]
	if errored.Type != "errored" || errored.Text != "failed: redis-cli ping" {
		t.Errorf("event = %+v", errored)
	}
}

func TestExtractCodexEvents_subagentExcluded(t *testing.T) {
	lines := []string{
		`{"type":"session_meta","timestamp":"2026-07-10T09:00:00.000Z","payload":{"cwd":"/x","thread_source":"subagent"}}`,
		`{"type":"response_item","timestamp":"2026-07-10T09:00:03.000Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}}`,
	}
	got := extractCodexEvents(lines)
	if len(got.Events) != 0 {
		t.Errorf("subagent rollout should yield no events, got %d", len(got.Events))
	}
}

func TestScanProvider_populatesEventsAndStatus(t *testing.T) {
	dir := t.TempDir()
	writeJSONL(t, dir, "sess-cov.jsonl",
		`{"type":"user","timestamp":"2026-07-10T12:00:00.000Z","cwd":"/home/me/payments-api","gitBranch":"fix/cov","message":{"content":"Cover the coupon branches"}}`,
		`{"type":"assistant","timestamp":"2026-07-10T12:00:05.000Z","message":{"model":"claude-opus-4-8","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"git commit -m \"cov\""}}]}}`,
	)
	got := scanProvider(claudeProvider(dir), 0, 10)
	if len(got) != 1 {
		t.Fatalf("want 1 session, got %d", len(got))
	}
	s := got[0]
	if s.TranscriptPath == "" {
		t.Error("TranscriptPath should be set")
	}
	if s.Status != "done" {
		t.Errorf("status = %q, want done", s.Status)
	}
	if len(s.Events) == 0 {
		t.Fatal("events should be populated")
	}
	if s.Events[0].Type != "started" {
		t.Errorf("first event = %q, want started", s.Events[0].Type)
	}
	if s.StartedTs != 1783684800000 {
		t.Errorf("startedTs = %d", s.StartedTs)
	}
}

const (
	waitUser     = `{"type":"user","timestamp":"2026-07-10T12:00:00.000Z","message":{"content":"Plan the migration"}}`
	waitAsk1     = `{"type":"assistant","timestamp":"2026-07-10T12:00:05.000Z","message":{"content":[{"type":"tool_use","id":"ask1","name":"AskUserQuestion","input":{"questions":[{"question":"Proceed?"}]}}]}}`
	waitAnswer1  = `{"type":"user","timestamp":"2026-07-10T12:00:20.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"ask1","content":"yes"}]}}`
	waitReadCall = `{"type":"assistant","timestamp":"2026-07-10T12:00:25.000Z","message":{"content":[{"type":"tool_use","id":"r1","name":"Read","input":{}}]}}`
	waitAsk2     = `{"type":"assistant","timestamp":"2026-07-10T12:00:30.000Z","message":{"content":[{"type":"tool_use","id":"ask2","name":"AskUserQuestion","input":{"questions":[{"question":"Which table first?"}]}}]}}`
	waitPrompt   = `{"type":"user","timestamp":"2026-07-10T12:00:20.000Z","message":{"content":"never mind, just read it"}}`
)

func lastEventType(se sessionEvents) string {
	if len(se.Events) == 0 {
		return ""
	}
	return se.Events[len(se.Events)-1].Type
}

func TestClaudeWaitingUnansweredAsk(t *testing.T) {
	got := extractClaudeEvents([]string{waitUser, waitAsk1})
	if got.Status != "waiting" {
		t.Errorf("status = %q, want waiting for an unanswered ask", got.Status)
	}
	if lastEventType(got) == "finished" {
		t.Error("a waiting session has no finished event")
	}
}

func TestClaudeWaitingClearedByToolResult(t *testing.T) {
	got := extractClaudeEvents([]string{waitUser, waitAsk1, waitAnswer1})
	if got.Status != "done" {
		t.Errorf("status = %q, want done once the ask has its tool_result", got.Status)
	}
	if lastEventType(got) != "finished" {
		t.Errorf("last event = %q, want finished", lastEventType(got))
	}
}

// the review's case: the ask was answered and the agent went on with a commit-less tool call, so the
// last real event is still the ask, yet nothing waits on the user
func TestClaudeWaitingClearedByAnswerOrLaterTurn(t *testing.T) {
	for name, lines := range map[string][]string{
		"answered then a tool call":         {waitUser, waitAsk1, waitAnswer1, waitReadCall},
		"a later user turn, no tool result": {waitUser, waitAsk1, waitPrompt, waitReadCall},
	} {
		if got := extractClaudeEvents(lines); got.Status != "done" {
			t.Errorf("%s: status = %q, want done", name, got.Status)
		}
	}
}

// Claude Code writes one record per content block, so a tool call beside the ask in the same turn is a later
// assistant record: it does not answer the ask, only a tool_result or a user turn does
func TestClaudeWaitingStaysThroughAParallelToolCall(t *testing.T) {
	got := extractClaudeEvents([]string{waitUser, waitAsk1, waitReadCall})
	if got.Status != "waiting" {
		t.Errorf("status = %q, want waiting while the ask has no tool_result and no user turn followed", got.Status)
	}
}

func TestClaudeWaitingSecondAskPending(t *testing.T) {
	got := extractClaudeEvents([]string{waitUser, waitAsk1, waitAnswer1, waitReadCall, waitAsk2})
	if got.Status != "waiting" {
		t.Errorf("status = %q, want waiting on the second ask", got.Status)
	}
}

func TestWithoutRecentFinish(t *testing.T) {
	now := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	events := []SessionEvent{{Type: "started", Ts: 1}, {Type: "committed", Ts: 2}, {Type: "finished", Ts: 3}}
	orig := append([]SessionEvent(nil), events...)

	fresh := withoutRecentFinish(events, now.Add(-4*time.Minute), now)
	if want := events[:2]; !reflect.DeepEqual(fresh, want) {
		t.Errorf("4 min old: got %+v, want the finished event dropped %+v", fresh, want)
	}
	if !reflect.DeepEqual(events, orig) {
		t.Errorf("input slice changed: %+v", events)
	}
	if quiet := withoutRecentFinish(events, now.Add(-6*time.Minute), now); !reflect.DeepEqual(quiet, orig) {
		t.Errorf("6 min old: got %+v, want it kept", quiet)
	}
	noFinish := events[:2]
	if got := withoutRecentFinish(noFinish, now.Add(-time.Minute), now); !reflect.DeepEqual(noFinish, got) {
		t.Errorf("no finished event: got %+v, want unchanged", got)
	}
}

// the scan hands the read-time drop its transcript's mtime: a file just written has not finished, one that has
// gone quiet has
func TestScanProvider_dropsFinishedWhileTheTranscriptIsFresh(t *testing.T) {
	dir := t.TempDir()
	lines := []string{
		`{"type":"user","timestamp":"2026-07-10T12:00:00.000Z","cwd":"/home/me/web","message":{"content":"Tidy the header"}}`,
		`{"type":"assistant","timestamp":"2026-07-10T12:00:05.000Z","message":{"content":[{"type":"text","text":"All tidy."}]}}`,
	}
	writeJSONL(t, dir, "fresh.jsonl", lines...)
	quiet := writeJSONL(t, dir, "quiet.jsonl", lines...)
	old := time.Now().Add(-10 * time.Minute)
	if err := os.Chtimes(quiet, old, old); err != nil {
		t.Fatal(err)
	}
	byID := map[string]SessionInfo{}
	for _, s := range scanProvider(claudeProvider(dir), 0, 10) {
		byID[s.ID] = s
	}
	if s := byID["fresh"]; s.Status != "done" || lastEventType(sessionEvents{Events: s.Events}) == "finished" {
		t.Errorf("fresh: status %q, last event %q, want done with no finished event", s.Status, lastEventType(sessionEvents{Events: s.Events}))
	}
	if s := byID["quiet"]; lastEventType(sessionEvents{Events: s.Events}) != "finished" {
		t.Errorf("quiet: last event %q, want finished", lastEventType(sessionEvents{Events: s.Events}))
	}
}

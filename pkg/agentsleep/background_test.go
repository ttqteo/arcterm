// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsleep

import (
	"encoding/json"
	"maps"
	"reflect"
	"strings"
	"testing"
)

// The cases mirror extractBackgroundTasks in frontend/app/view/agents/transcriptprojection.test.ts.

type m = map[string]any

// line encodes a record the way Claude Code writes it: no HTML escaping, so "<task-notification>" stays literal.
func line(t *testing.T, v any) string {
	t.Helper()
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		t.Fatal(err)
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func asst(t *testing.T, blocks ...any) string {
	return line(t, m{"type": "assistant", "message": m{"content": blocks}})
}

func toolUse(id, name string, input m) m {
	return m{"type": "tool_use", "id": id, "name": name, "input": input}
}

func bash(t *testing.T, id string, input m) string {
	return asst(t, toolUse(id, "Bash", input))
}

// result is a tool_result record; extra fields (toolUseResult) ride on the record, as Claude Code writes them.
func result(t *testing.T, id string, content any, extra m) string {
	rec := m{
		"type":    "user",
		"message": m{"content": []any{m{"type": "tool_result", "tool_use_id": id, "content": content}}},
	}
	maps.Copy(rec, extra)
	return line(t, rec)
}

func notify(t *testing.T, toolUseID, status string) string {
	return line(t, m{"type": "user", "message": m{
		"content": "<task-notification>\n<task-id>x</task-id>\n<tool-use-id>" + toolUseID + "</tool-use-id>\n<status>" + status + "</status>\n<summary>s</summary>\n</task-notification>",
	}})
}

func want(t *testing.T, lines []string, labels ...string) {
	t.Helper()
	got := BackgroundRunning(lines)
	if len(got) == 0 && len(labels) == 0 {
		return
	}
	if !reflect.DeepEqual(got, labels) {
		t.Fatalf("BackgroundRunning = %q, want %q", got, labels)
	}
}

func TestBackgroundRunningStartedIsRunningUntilItsNotification(t *testing.T) {
	start := []string{
		bash(t, "t1", m{"command": "npm test", "description": "Run tests", "run_in_background": true}),
		result(t, "t1", "Command running in background with ID: b1abc", nil),
	}
	want(t, start, "Run tests")
	for _, status := range []string{"completed", "failed", "killed", "stopped"} {
		want(t, append(append([]string{}, start...), notify(t, "t1", status)))
	}
	want(t, append(append([]string{}, start...), notify(t, "t1", "running")), "Run tests")
}

func TestBackgroundRunningAForegroundCommandThatTimedOutIntoTheBackgroundIsATaskToo(t *testing.T) {
	lines := []string{
		bash(t, "t2", m{"command": "cargo build", "description": "Build"}),
		result(t, "t2", "", m{"toolUseResult": m{"backgroundTaskId": "b2", "timedOutAfterMs": 120000}}),
	}
	want(t, lines, "Build")
}

func TestBackgroundRunningAPlainForegroundCommandIsNotATask(t *testing.T) {
	want(t, []string{bash(t, "t3", m{"command": "ls"}), result(t, "t3", "a\nb", nil)})
	// its output only quotes a start result (a grep of a transcript, a read of this file)
	quoted := result(t, "t3", `result(t, "t1", "Command running in background with ID: b1abc", nil),`, nil)
	want(t, []string{bash(t, "t3", m{"command": "sed -n 1,9p x_test.go"}), quoted})
}

func TestBackgroundRunningTaskStopAndKillShellStopIt(t *testing.T) {
	start := []string{
		bash(t, "t4", m{"command": "npm run dev", "run_in_background": true}),
		result(t, "t4", "", m{"toolUseResult": m{"backgroundTaskId": "b4"}}),
	}
	want(t, start, "npm run dev")
	want(t, append(append([]string{}, start...), asst(t, toolUse("s1", "TaskStop", m{"task_id": "b4"}))))
	want(t, append(append([]string{}, start...), asst(t, toolUse("s2", "KillShell", m{"shell_id": "b4"}))))
	// a stop that names another task leaves this one running
	want(t, append(append([]string{}, start...), asst(t, toolUse("s3", "TaskStop", m{"task_id": "other"}))), "npm run dev")
}

func TestBackgroundRunningANotificationQueuedAsAQueueOperationStillResolvesTheTask(t *testing.T) {
	lines := []string{
		bash(t, "t5", m{"command": "go test ./...", "run_in_background": true}),
		line(t, m{"type": "queue-operation", "content": "<task-notification><tool-use-id>t5</tool-use-id><status>completed</status></task-notification>"}),
	}
	want(t, lines)
}

func TestBackgroundRunningANotificationInAnAttachmentStillResolvesTheTask(t *testing.T) {
	lines := []string{
		bash(t, "t5", m{"command": "go test ./...", "run_in_background": true}),
		line(t, m{"type": "attachment", "attachment": m{"type": "queued_command", "prompt": "<task-notification><tool-use-id>t5</tool-use-id><status>failed</status></task-notification>"}}),
	}
	want(t, lines)
}

func TestBackgroundRunningAResumedSessionsOrphanSummaryStopsEachTaskItNames(t *testing.T) {
	lines := []string{
		bash(t, "t9", m{"command": "uv run fastapi", "run_in_background": true}),
		result(t, "t9", "Command running in background with ID: b9", nil),
		bash(t, "t10", m{"command": "pnpm run start", "run_in_background": true}),
		result(t, "t10", "Command running in background with ID: b10", nil),
		bash(t, "t11", m{"command": "tail -f log", "run_in_background": true}),
		result(t, "t11", "Command running in background with ID: b11", nil),
		line(t, m{"type": "user", "message": m{
			"content": "<task-notification>\n<task-id>b9</task-id>\n<task-id>b10</task-id>\n<task-id>__orphan_summary__:shell</task-id>\n<status>stopped</status>\n<summary>2 background shell command tasks didn't finish before the previous session ended.</summary>\n</task-notification>",
		}}),
	}
	want(t, lines, "tail -f log")
}

func TestBackgroundRunningAPowerShellBackgroundCommandIsATaskToo(t *testing.T) {
	lines := []string{
		asst(t, toolUse("p1", "PowerShell", m{"command": "npm run dev", "run_in_background": true})),
		result(t, "p1", "", m{"toolUseResult": m{"backgroundTaskId": "bp1"}}),
	}
	want(t, lines, "npm run dev")
}

func TestBackgroundRunningABackgroundCommandRefusedBeforeItStartedIsNotATask(t *testing.T) {
	refused := line(t, m{"type": "user", "message": m{"content": []any{m{
		"type": "tool_result", "tool_use_id": "t11", "is_error": true,
		"content": "<tool_use_error>Refused by arcterm: drop the stdout redirect</tool_use_error>",
	}}}})
	want(t, []string{bash(t, "t11", m{"command": "make > out.log", "run_in_background": true}), refused})
	// Claude Code (2.1.299+) writes the request it sent as an api-request-blob, which repeats the tool_use
	copy := line(t, m{"type": "api-request-blob", "hash": "h", "message": m{"role": "assistant", "content": []any{
		toolUse("t11", "Bash", m{"command": "make > out.log", "run_in_background": true}),
	}}})
	want(t, []string{bash(t, "t11", m{"command": "make > out.log", "run_in_background": true}), refused, copy})
}

func TestBackgroundRunningAStartWhoseResultIsNotInTheTailStaysRunning(t *testing.T) {
	want(t, []string{bash(t, "t6", m{"command": "sleep 99", "run_in_background": true})}, "sleep 99")
}

func TestBackgroundRunningLabelsFallBackToTheCommandThenAGenericName(t *testing.T) {
	lines := []string{
		bash(t, "a", m{"command": "sleep 1", "description": "  Wait a second  ", "run_in_background": true}),
		bash(t, "b", m{"command": "sleep 2", "description": "   ", "run_in_background": true}),
		bash(t, "c", m{"run_in_background": true}),
	}
	want(t, lines, "Wait a second", "sleep 2", "background command")
}

func monitor(t *testing.T, id string) string {
	return asst(t, toolUse(id, "Monitor", m{"description": "Fit progress", "command": "tail -f fit.log", "timeout_ms": 1800000}))
}

// monitorEvent names only the task id and carries no status; the expiry notice is one of them.
func monitorEvent(t *testing.T, taskID, event string) string {
	return line(t, m{"type": "user", "message": m{
		"content": "<task-notification>\n<task-id>" + taskID + "</task-id>\n<summary>Monitor event: \"Fit progress\"</summary>\n<event>" + event + "</event>\n</task-notification>",
	}})
}

func TestBackgroundRunningAMonitorIsATaskFromItsStartResultUntilItsStreamEnds(t *testing.T) {
	start := []string{
		monitor(t, "m1"),
		result(t, "m1", "Monitor started (task bm1, expires in 30m unless the source ends first).",
			m{"toolUseResult": m{"taskId": "bm1", "timeoutMs": 1800000, "persistent": false}}),
		monitorEvent(t, "bm1", "epoch 3/30"),
	}
	want(t, start, "Fit progress")
	want(t, append(append([]string{}, start...), notify(t, "m1", "completed")))
	want(t, append(append([]string{}, start...), notify(t, "m1", "killed")))
	want(t, append(append([]string{}, start...), asst(t, toolUse("s1", "TaskStop", m{"task_id": "bm1"}))))
}

func TestBackgroundRunningAMonitorsExpiryNoticeStopsIt(t *testing.T) {
	lines := []string{
		monitor(t, "m2"),
		result(t, "m2", "Monitor started (task bm2, expires in 30m unless the source ends first).", nil),
		monitorEvent(t, "bm2", "[Monitor expired after 30m with no events delivered. Re-arm it if you still need the watch.]"),
	}
	want(t, lines)
	want(t, lines[:2], "Fit progress") // the id came from the text, so the expiry found the task
}

func TestBackgroundRunningAMonitorWhoseStartWasRefusedIsNotATask(t *testing.T) {
	want(t, []string{monitor(t, "m3"), result(t, "m3", "Monitor is not available", nil)})
}

func TestBackgroundRunningKeepsFirstSeenOrder(t *testing.T) {
	lines := []string{
		bash(t, "a", m{"command": "one", "run_in_background": true}),
		bash(t, "b", m{"command": "two", "run_in_background": true}),
		bash(t, "c", m{"command": "three", "run_in_background": true}),
		notify(t, "b", "completed"),
	}
	want(t, lines, "one", "three")
}

func TestBackgroundRunningReadsAToolResultsTextBlocks(t *testing.T) {
	lines := []string{
		bash(t, "t1", m{"command": "npm test", "run_in_background": true}),
		result(t, "t1", []any{m{"type": "text", "text": "Command running in background with ID: b1"}}, nil),
		asst(t, toolUse("s1", "TaskStop", m{"task_id": "b1"})),
	}
	want(t, lines) // the id came from the text block, so TaskStop found the task
}

func TestBackgroundRunningIgnoresResultsOfOtherTools(t *testing.T) {
	lines := []string{
		asst(t, toolUse("r1", "Read", m{"file_path": "a"})),
		result(t, "r1", "Command running in background with ID: nope", nil),
	}
	want(t, lines)
}

func TestBackgroundRunningSkipsUnparsableLines(t *testing.T) {
	lines := []string{
		"",
		"not json at all",
		`{"type":"assistant","message":{"content":[{"type":"tool_use"`, // a tail cut mid-record
		bash(t, "t1", m{"command": "npm run dev", "run_in_background": true}),
		"[1,2,3]",
		`{"message":{"content":"<task-notification>"}}`,
	}
	want(t, lines, "npm run dev")
}

func TestBackgroundRunningNothingToScan(t *testing.T) {
	want(t, nil)
	want(t, []string{})
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentperm

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

const testORef = "block:b0000000-0000-4000-8000-0000000000a1"

func bash(cmd string) json.RawMessage {
	b, _ := json.Marshal(map[string]string{"command": cmd})
	return b
}

func ids(reqs []baseds.AgentPermissionRequest) []string {
	out := make([]string, len(reqs))
	for i, r := range reqs {
		out[i] = r.Summary
	}
	return out
}

func sameStrings(a, b []string) bool {
	return strings.Join(a, "\x00") == strings.Join(b, "\x00")
}

func TestToolKeyIgnoresKeyOrder(t *testing.T) {
	a := ToolKey("Bash", json.RawMessage(`{"command":"ls","description":"list"}`))
	b := ToolKey("Bash", json.RawMessage("{ \"description\": \"list\",\n  \"command\": \"ls\" }"))
	if a != b {
		t.Fatalf("key order or whitespace changed the key: %q vs %q", a, b)
	}
	if !strings.HasPrefix(a, "Bash:") {
		t.Fatalf("key %q does not start with the tool name and a colon", a)
	}
	if ToolKey("Bash", json.RawMessage(`{"command":"pwd"}`)) == ToolKey("Bash", json.RawMessage(`{"command":"ls"}`)) {
		t.Fatal("different inputs share a key")
	}
	if ToolKey("Edit", json.RawMessage(`{"command":"ls"}`)) == ToolKey("Bash", json.RawMessage(`{"command":"ls"}`)) {
		t.Fatal("different tools share a key")
	}
	// nested objects are sorted too
	n1 := ToolKey("X", json.RawMessage(`{"a":{"y":1,"x":2},"b":[1,2]}`))
	n2 := ToolKey("X", json.RawMessage(`{"b":[1,2],"a":{"x":2,"y":1}}`))
	if n1 != n2 {
		t.Fatalf("nested key order changed the key: %q vs %q", n1, n2)
	}
}

func TestToolKeyUnparseableInputHashesRawBytes(t *testing.T) {
	a := ToolKey("Bash", json.RawMessage(`not json`))
	b := ToolKey("Bash", json.RawMessage(`not json`))
	c := ToolKey("Bash", json.RawMessage(`not json!`))
	if a != b {
		t.Fatalf("the same raw bytes keyed differently: %q vs %q", a, b)
	}
	if a == c {
		t.Fatal("different raw bytes share a key")
	}
	if ToolKey("Bash", nil) != ToolKey("Bash", json.RawMessage{}) {
		t.Fatal("a missing input and an empty one key differently")
	}
	// a missing tool_input crosses the wire as null: the raise (null) and the PostToolUse report (nothing) are one call
	if ToolKey("Bash", nil) != ToolKey("Bash", json.RawMessage("null")) {
		t.Fatal("a missing input and a null one key differently")
	}
}

func TestSummaryIgnoresANullInput(t *testing.T) {
	if got := Summary("ExitPlanMode", json.RawMessage("null")); got != "ExitPlanMode" {
		t.Fatalf("Summary with a null input = %q, want the bare tool name", got)
	}
}

func TestAnswerableTable(t *testing.T) {
	for _, name := range []string{"Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch"} {
		if !Answerable(name) {
			t.Errorf("Answerable(%q) = false, want true", name)
		}
	}
	for _, name := range []string{"ExitPlanMode", "Read", "mcp__x__y", "AskUserQuestion", "Task", "bash", ""} {
		if Answerable(name) {
			t.Errorf("Answerable(%q) = true, want false", name)
		}
	}
}

func TestSummaryByTool(t *testing.T) {
	cases := []struct {
		tool, input, want string
	}{
		{"Bash", `{"command":"go test ./..."}`, "go test ./..."},
		{"Edit", `{"file_path":"/a/b.go","old_string":"x"}`, "/a/b.go"},
		{"Write", `{"file_path":"/a/c.go","content":"x"}`, "/a/c.go"},
		{"MultiEdit", `{"file_path":"/a/d.go","edits":[]}`, "/a/d.go"},
		{"NotebookEdit", `{"notebook_path":"/a/n.ipynb","new_source":"x"}`, "/a/n.ipynb"},
		{"WebFetch", `{"url":"https://example.com/x","prompt":"p"}`, "https://example.com/x"},
		{"WebSearch", `{"query":"go generics"}`, "go generics"},
		// a missing field falls back to the tool and its input
		{"Bash", `{}`, `Bash {}`},
		{"Edit", `{"old_string":"x"}`, `Edit {"old_string":"x"}`},
		// anything else: the tool name and the compact input
		{"ExitPlanMode", `{"plan": "step 1"}`, `ExitPlanMode {"plan":"step 1"}`},
		{"mcp__x__y", `{"a": 1}`, `mcp__x__y {"a":1}`},
	}
	for _, c := range cases {
		if got := Summary(c.tool, json.RawMessage(c.input)); got != c.want {
			t.Errorf("Summary(%s, %s) = %q, want %q", c.tool, c.input, got, c.want)
		}
	}
	long := Summary("ExitPlanMode", json.RawMessage(`{"plan":"`+strings.Repeat("é", 400)+`"}`))
	if n := len([]rune(long)); n != 300 {
		t.Errorf("the fallback summary is %d runes, want it cut at 300", n)
	}
	if !strings.HasPrefix(long, "ExitPlanMode ") {
		t.Errorf("the cut summary lost its tool name: %q", long[:20])
	}
	if got := Summary("ExitPlanMode", nil); got != "ExitPlanMode" {
		t.Errorf("Summary with no input = %q, want the bare tool name", got)
	}
}

func TestQueueRaiseClaimAnswer(t *testing.T) {
	r := MakeRegistry()
	first := r.Raise(testORef, "Bash", bash("one"), 100)
	second := r.Raise(testORef, "Edit", json.RawMessage(`{"file_path":"/f.go"}`), 200)
	if first.Id == "" || first.Id == second.Id {
		t.Fatalf("ids %q and %q must be set and distinct", first.Id, second.Id)
	}
	if first.ToolName != "Bash" || first.Summary != "one" || !first.Answerable || first.Ts != 100 {
		t.Fatalf("first request = %+v", first)
	}
	snap := r.Snapshot(testORef)
	if !sameStrings(ids(snap), []string{"one", "/f.go"}) {
		t.Fatalf("snapshot order = %v, want raise order", ids(snap))
	}

	if _, ok := r.ClaimHead(testORef, second.Id); ok {
		t.Fatal("claimed the second request while the first is the head")
	}
	if _, ok := r.ClaimHead(testORef, "no-such-id"); ok {
		t.Fatal("claimed an unknown id")
	}
	if _, ok := r.ClaimHead("block:other", first.Id); ok {
		t.Fatal("claimed a head of another block")
	}
	head, ok := r.ClaimHead(testORef, first.Id)
	if !ok || head.Id != first.Id {
		t.Fatalf("ClaimHead(head id) = %+v, %v", head, ok)
	}
	if got := r.Snapshot(testORef); len(got) != 2 {
		t.Fatalf("a claim removed the request: %d left, a failed send must leave the queue as it was", len(got))
	}

	if !r.AnswerHead(testORef) {
		t.Fatal("AnswerHead reported no change on a queue with a head")
	}
	snap = r.Snapshot(testORef)
	if len(snap) != 1 || snap[0].Id != second.Id {
		t.Fatalf("after AnswerHead the queue is %v, want only the second request", ids(snap))
	}
	if _, ok := r.ClaimHead(testORef, first.Id); ok {
		t.Fatal("the answered request can still be claimed")
	}
	if !r.AnswerHead(testORef) {
		t.Fatal("AnswerHead on the last request reported no change")
	}
	if r.AnswerHead(testORef) {
		t.Fatal("AnswerHead on an empty queue reported a change")
	}
	if got := r.Snapshot(testORef); got == nil || len(got) != 0 {
		t.Fatalf("an empty queue must snapshot as an empty non-nil slice (it serializes as [], not null), got %#v", got)
	}
}

func TestSnapshotIsACopy(t *testing.T) {
	r := MakeRegistry()
	r.Raise(testORef, "Bash", bash("one"), 1)
	snap := r.Snapshot(testORef)
	snap[0].Summary = "changed"
	if got := r.Snapshot(testORef)[0].Summary; got != "one" {
		t.Fatalf("editing a snapshot reached the queue: %q", got)
	}
}

func TestQueuesAreKeyedByORef(t *testing.T) {
	r := MakeRegistry()
	a := r.Raise("block:a", "Bash", bash("a"), 1)
	r.Raise("block:b", "Bash", bash("b"), 1)
	r.DropAll("block:a")
	if len(r.Snapshot("block:a")) != 0 || len(r.Snapshot("block:b")) != 1 {
		t.Fatal("DropAll on one block touched another")
	}
	if _, ok := r.ClaimHead("block:b", a.Id); ok {
		t.Fatal("an id claimed on a block it was not raised on")
	}
}

func TestDropAll(t *testing.T) {
	r := MakeRegistry()
	if r.DropAll(testORef) {
		t.Fatal("DropAll on an empty queue reported a change")
	}
	r.Raise(testORef, "Bash", bash("one"), 1)
	r.Raise(testORef, "Bash", bash("two"), 2)
	if !r.DropAll(testORef) {
		t.Fatal("DropAll on a queue reported no change")
	}
	if len(r.Snapshot(testORef)) != 0 {
		t.Fatal("DropAll left requests")
	}
}

func statusFor(hook string) *baseds.AgentStatusData {
	return &baseds.AgentStatusData{ORef: testORef, Hook: hook}
}

// the global-registry entry points are what wavesrv calls; each test resets the block it uses
func resetGlobal(t *testing.T) {
	t.Helper()
	GlobalRegistry.DropAll(testORef)
	t.Cleanup(func() { GlobalRegistry.DropAll(testORef) })
}

func TestNoteStatusClears(t *testing.T) {
	for _, hook := range []string{baseds.AgentHook_Stop, baseds.AgentHook_UserPromptSubmit, baseds.AgentHook_SessionStart} {
		t.Run(hook, func(t *testing.T) {
			resetGlobal(t)
			a := GlobalRegistry.Raise(testORef, "Bash", bash("one"), 1)
			GlobalRegistry.Raise(testORef, "Bash", bash("two"), 2)
			// an answered note, which the clear must forget
			GlobalRegistry.AnswerHead(testORef)
			if !NoteStatus(statusFor(hook)) {
				t.Fatalf("%s with a pending request reported no change", hook)
			}
			if len(GlobalRegistry.Snapshot(testORef)) != 0 {
				t.Fatalf("%s left requests", hook)
			}
			// the note for the first call is gone: a later request with the same key must be dropped by its own
			// PostToolUse, not swallowed by a note from before the clear
			GlobalRegistry.Raise(testORef, "Bash", bash("one"), 3)
			key := ToolKey("Bash", bash("one"))
			if !GlobalRegistry.NoteToolDone(testORef, key) {
				t.Fatalf("%s kept an answered note: the new request with that key was not dropped", hook)
			}
			_ = a
		})
	}

	t.Run("an empty queue is no change", func(t *testing.T) {
		resetGlobal(t)
		if NoteStatus(statusFor(baseds.AgentHook_Stop)) {
			t.Fatal("Stop on an empty queue reported a change")
		}
	})

	t.Run("other hooks change nothing", func(t *testing.T) {
		resetGlobal(t)
		GlobalRegistry.Raise(testORef, "Bash", bash("one"), 1)
		for _, hook := range []string{baseds.AgentHook_PreToolUse, baseds.AgentHook_Notification, "PermissionRequest", ""} {
			if NoteStatus(statusFor(hook)) {
				t.Fatalf("%q reported a change", hook)
			}
		}
		if len(GlobalRegistry.Snapshot(testORef)) != 1 {
			t.Fatal("a hook that clears nothing cleared the queue")
		}
	})

	t.Run("a matching key drops only its entry", func(t *testing.T) {
		resetGlobal(t)
		GlobalRegistry.Raise(testORef, "Bash", bash("one"), 1)
		GlobalRegistry.Raise(testORef, "Bash", bash("two"), 2)
		GlobalRegistry.Raise(testORef, "Bash", bash("three"), 3)
		st := statusFor(baseds.AgentHook_PostToolUse)
		st.ToolKey = ToolKey("Bash", bash("two"))
		if !NoteStatus(st) {
			t.Fatal("a PostToolUse with a matching key reported no change")
		}
		if got := ids(GlobalRegistry.Snapshot(testORef)); !sameStrings(got, []string{"one", "three"}) {
			t.Fatalf("queue after the key = %v, want one and three", got)
		}
	})

	t.Run("a key that matches nothing drops nothing", func(t *testing.T) {
		resetGlobal(t)
		GlobalRegistry.Raise(testORef, "Bash", bash("one"), 1)
		st := statusFor(baseds.AgentHook_PostToolUse)
		st.ToolKey = ToolKey("Bash", bash("other"))
		if NoteStatus(st) {
			t.Fatal("a non-matching key reported a change")
		}
		if len(GlobalRegistry.Snapshot(testORef)) != 1 {
			t.Fatal("a non-matching key dropped a request")
		}
	})

	t.Run("a nil status is ignored", func(t *testing.T) {
		if NoteStatus(nil) {
			t.Fatal("nil reported a change")
		}
	})
}

// A question answered on the cockpit card types nothing into the terminal and, raced, runs no PostToolUse hook, so its
// request is retired by the next tool report once the transcript holds the answer; until then it stays (2026-11-11:
// the card stood for minutes while the agent worked on, and held the Chat box shut).
func TestNoteStatusRetiresAnsweredQuestion(t *testing.T) {
	ask := json.RawMessage(`{"questions":[{"question":"Fold?"}]}`)
	withAskOpen := func(t *testing.T, open bool, err error) *[]string {
		t.Helper()
		var read []string
		prev := askOpen
		askOpen = func(path string) (bool, error) {
			read = append(read, path)
			return open, err
		}
		t.Cleanup(func() { askOpen = prev })
		return &read
	}
	report := func(hook string) *baseds.AgentStatusData {
		st := statusFor(hook)
		st.TranscriptPath = "t.jsonl"
		return st
	}

	t.Run("a tool report after the answer drops the question and keeps the rest", func(t *testing.T) {
		resetGlobal(t)
		withAskOpen(t, false, nil)
		GlobalRegistry.Raise(testORef, "AskUserQuestion", ask, 1)
		GlobalRegistry.Raise(testORef, "Bash", bash("two"), 2)
		for _, hook := range []string{baseds.AgentHook_PreToolUse, baseds.AgentHook_PostToolUse} {
			GlobalRegistry.Raise(testORef, "AskUserQuestion", ask, 3)
			if !NoteStatus(report(hook)) {
				t.Fatalf("%s after the answer reported no change", hook)
			}
			if got := ids(GlobalRegistry.Snapshot(testORef)); !sameStrings(got, []string{"two"}) {
				t.Fatalf("%s: queue = %v, want only the Bash request", hook, got)
			}
		}
	})

	t.Run("an open question stays", func(t *testing.T) {
		resetGlobal(t)
		withAskOpen(t, true, nil)
		GlobalRegistry.Raise(testORef, "AskUserQuestion", ask, 1)
		if NoteStatus(report(baseds.AgentHook_PostToolUse)) || len(GlobalRegistry.Snapshot(testORef)) != 1 {
			t.Fatal("a question still open in the transcript was dropped")
		}
	})

	t.Run("an unreadable transcript keeps it", func(t *testing.T) {
		resetGlobal(t)
		withAskOpen(t, false, errors.New("gone"))
		GlobalRegistry.Raise(testORef, "AskUserQuestion", ask, 1)
		if NoteStatus(report(baseds.AgentHook_PostToolUse)) {
			t.Fatal("a failed read dropped the question")
		}
	})

	t.Run("no question waiting reads no transcript", func(t *testing.T) {
		resetGlobal(t)
		read := withAskOpen(t, false, nil)
		GlobalRegistry.Raise(testORef, "Bash", bash("one"), 1)
		NoteStatus(report(baseds.AgentHook_PostToolUse))
		if len(*read) != 0 {
			t.Fatalf("read the transcript %d times with no question queued", len(*read))
		}
	})

	t.Run("other hooks and a report without a transcript leave it", func(t *testing.T) {
		resetGlobal(t)
		withAskOpen(t, false, nil)
		GlobalRegistry.Raise(testORef, "AskUserQuestion", ask, 1)
		if NoteStatus(report(baseds.AgentHook_Notification)) || NoteStatus(report("PermissionRequest")) ||
			NoteStatus(statusFor(baseds.AgentHook_PostToolUse)) {
			t.Fatal("a report that cannot show the answer dropped the question")
		}
	})

	t.Run("its key ignores the answers its PostToolUse input carries", func(t *testing.T) {
		answered := json.RawMessage(`{"questions":[{"question":"Fold?"}],"answers":{"Fold?":"Yes"}}`)
		if ToolKey("AskUserQuestion", ask) != ToolKey("AskUserQuestion", answered) {
			t.Fatal("the raise and the PostToolUse of one question key differently")
		}
	})
}

// two identical parallel calls are two prompts; the first call's PostToolUse must not take the second, still-pending entry
func TestIdenticalParallelCalls(t *testing.T) {
	r := MakeRegistry()
	key := ToolKey("Bash", bash("make"))
	r.Raise(testORef, "Bash", bash("make"), 1)
	r.Raise(testORef, "Bash", bash("make"), 2)
	r.Raise(testORef, "Bash", bash("make"), 3)

	// the first is allowed in chat: its note is kept, the other two stay pending
	r.AnswerHead(testORef)
	if got := len(r.Snapshot(testORef)); got != 2 {
		t.Fatalf("after the first answer %d are pending, want 2", got)
	}
	// its PostToolUse consumes the note and changes nothing
	if r.NoteToolDone(testORef, key) {
		t.Fatal("the first PostToolUse reported a change: it consumed a pending entry instead of the answered note")
	}
	if got := len(r.Snapshot(testORef)); got != 2 {
		t.Fatalf("the first PostToolUse left %d pending, want 2", got)
	}

	// the second is answered one by one too: each answered call keeps its own note
	r.AnswerHead(testORef)
	r.AnswerHead(testORef)
	if got := len(r.Snapshot(testORef)); got != 0 {
		t.Fatalf("after three answers %d are pending, want 0", got)
	}
	// the first note is spent and two more were taken: the next two PostToolUse reports consume those two
	if r.NoteToolDone(testORef, key) {
		t.Fatal("the second PostToolUse reported a change")
	}
	if r.NoteToolDone(testORef, key) {
		t.Fatal("the third PostToolUse reported a change")
	}
	// all notes spent: a fourth report with that key finds nothing pending and changes nothing
	if r.NoteToolDone(testORef, key) {
		t.Fatal("a PostToolUse with no note and no pending entry reported a change")
	}
}

// the same shape with the notes and entries interleaved: a call answered in the terminal, then a still-pending one
func TestIdenticalParallelCallsUnanswered(t *testing.T) {
	r := MakeRegistry()
	key := ToolKey("Bash", bash("make"))
	r.Raise(testORef, "Bash", bash("make"), 1)
	r.Raise(testORef, "Bash", bash("make"), 2)
	r.AnswerHead(testORef) // the first, answered: one note, one entry left
	if r.NoteToolDone(testORef, key) {
		t.Fatal("the first PostToolUse took the second request")
	}
	// the second call's PostToolUse arrives with no note left: the pending entry goes
	if !r.NoteToolDone(testORef, key) {
		t.Fatal("the second PostToolUse reported no change: its pending entry stayed")
	}
	if got := len(r.Snapshot(testORef)); got != 0 {
		t.Fatalf("%d pending after both PostToolUse reports, want 0", got)
	}
}

func TestNoteKey(t *testing.T) {
	cases := []struct {
		name        string
		input       string
		wantChanged bool
		wantLeft    int
	}{
		{"1 answers the head", "1", true, 1},
		{"3 answers the head", "3", true, 1},
		{"9 answers the head", "9", true, 1},
		{"Enter answers the head", "\r", true, 1},
		{"Esc alone drops all", "\x1b", true, 0},
		{"a letter does nothing", "a", false, 2},
		{"0 does nothing", "0", false, 2},
		{"an arrow does nothing", "\x1b[A", false, 2},
		{"typed text does nothing", "ls\r", false, 2},
		{"empty does nothing", "", false, 2},
		{"a focus report does nothing", "\x1b[I", false, 2},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			resetGlobal(t)
			GlobalRegistry.Raise(testORef, "Bash", bash("one"), 1)
			GlobalRegistry.Raise(testORef, "Bash", bash("two"), 2)
			if got := NoteKey(testORef, []byte(c.input)); got != c.wantChanged {
				t.Fatalf("NoteKey(%q) changed = %v, want %v", c.input, got, c.wantChanged)
			}
			if got := len(GlobalRegistry.Snapshot(testORef)); got != c.wantLeft {
				t.Fatalf("NoteKey(%q) left %d requests, want %d", c.input, got, c.wantLeft)
			}
		})
	}

	t.Run("an answering key on an empty queue changes nothing", func(t *testing.T) {
		resetGlobal(t)
		if NoteKey(testORef, []byte("1")) {
			t.Fatal("1 on an empty queue reported a change")
		}
		if NoteKey(testORef, []byte("\x1b")) {
			t.Fatal("Esc on an empty queue reported a change")
		}
	})

	t.Run("a typed answer leaves a note for its PostToolUse", func(t *testing.T) {
		resetGlobal(t)
		GlobalRegistry.Raise(testORef, "Bash", bash("make"), 1)
		GlobalRegistry.Raise(testORef, "Bash", bash("make"), 2)
		NoteKey(testORef, []byte("1"))
		st := statusFor(baseds.AgentHook_PostToolUse)
		st.ToolKey = ToolKey("Bash", bash("make"))
		if NoteStatus(st) {
			t.Fatal("the typed answer's PostToolUse took the still-pending second request")
		}
		if len(GlobalRegistry.Snapshot(testORef)) != 1 {
			t.Fatal("the second request is gone")
		}
	})
}

func TestErrNotPendingMessage(t *testing.T) {
	if ErrNotPending.Error() != "that request is no longer waiting" {
		t.Fatalf("ErrNotPending = %q", ErrNotPending.Error())
	}
}

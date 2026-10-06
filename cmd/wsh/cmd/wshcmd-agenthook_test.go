// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
)

func TestPlanEmission(t *testing.T) {
	tests := []struct {
		name      string
		ev        ccHookEvent
		wantState string
		wantMT    bool // AttachModelTitle
	}{
		{"prompt submit", ccHookEvent{HookEventName: "UserPromptSubmit"}, baseds.AgentState_Working, true},
		{"stop idle", ccHookEvent{HookEventName: "Stop"}, baseds.AgentState_Idle, true},
		{"notification empty type -> waiting", ccHookEvent{HookEventName: "Notification"}, baseds.AgentState_Waiting, false},
		{"notification idle_prompt -> idle", ccHookEvent{HookEventName: "Notification", NotificationType: "idle_prompt"}, baseds.AgentState_Idle, false},
		{"notification permission_prompt -> waiting", ccHookEvent{HookEventName: "Notification", NotificationType: "permission_prompt"}, baseds.AgentState_Waiting, false},
		{"notification elicitation_dialog -> waiting", ccHookEvent{HookEventName: "Notification", NotificationType: "elicitation_dialog"}, baseds.AgentState_Waiting, false},
		{"notification elicitation_url_dialog -> waiting", ccHookEvent{HookEventName: "Notification", NotificationType: "elicitation_url_dialog"}, baseds.AgentState_Waiting, false},
		{"notification agent_needs_input -> waiting", ccHookEvent{HookEventName: "Notification", NotificationType: "agent_needs_input"}, baseds.AgentState_Waiting, false},
		{"notification auth_success -> nothing", ccHookEvent{HookEventName: "Notification", NotificationType: "auth_success"}, "", false},
		{"notification agent_completed -> nothing", ccHookEvent{HookEventName: "Notification", NotificationType: "agent_completed"}, "", false},
		{"notification elicitation_complete -> nothing", ccHookEvent{HookEventName: "Notification", NotificationType: "elicitation_complete"}, "", false},
		{"notification elicitation_response -> nothing", ccHookEvent{HookEventName: "Notification", NotificationType: "elicitation_response"}, "", false},
		{"notification quota_auto_resume -> nothing", ccHookEvent{HookEventName: "Notification", NotificationType: "quota_auto_resume_started"}, "", false},
		{"post tool working", ccHookEvent{HookEventName: "PostToolUse"}, baseds.AgentState_Working, true},
		{"pre bash working", ccHookEvent{HookEventName: "PreToolUse", ToolName: "Bash", ToolInput: json.RawMessage(`{"command":"ls"}`)}, baseds.AgentState_Working, true},
		{"pre ask -> asking", ccHookEvent{HookEventName: "PreToolUse", ToolName: "AskUserQuestion"}, baseds.AgentState_Asking, false},
		{"pre compact working", ccHookEvent{HookEventName: "PreCompact"}, baseds.AgentState_Working, false},
		{"session start after a compaction is idle", ccHookEvent{HookEventName: "SessionStart", Source: "compact"}, baseds.AgentState_Idle, false},
		{"session start after a clear is idle", ccHookEvent{HookEventName: "SessionStart", Source: "clear"}, baseds.AgentState_Idle, false},
		{"session start on startup reports nothing", ccHookEvent{HookEventName: "SessionStart", Source: "startup"}, "", false},
		// Task now only keeps the parent "working"; the disk store (not a hook delta) tracks subagents.
		{"pre task -> working", ccHookEvent{HookEventName: "PreToolUse", ToolName: "Task", ToolUseID: "t1", ToolInput: json.RawMessage(`{"subagent_type":"Explore"}`)}, baseds.AgentState_Working, true},
		{"subagent stop -> nothing", ccHookEvent{HookEventName: "SubagentStop", ToolUseID: "t1"}, "", false},
		{"unknown event -> nothing", ccHookEvent{HookEventName: "SomeFutureEvent"}, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			em := planEmission(tt.ev)
			if em.State != tt.wantState {
				t.Fatalf("state = %q, want %q", em.State, tt.wantState)
			}
			if em.AttachModelTitle != tt.wantMT {
				t.Fatalf("attachModelTitle = %v, want %v", em.AttachModelTitle, tt.wantMT)
			}
		})
	}
}

func TestDetailForTool(t *testing.T) {
	tests := []struct {
		name, tool, input, want string
	}{
		{"edit", "Edit", `{"file_path":"/a/b/foo.go"}`, "editing foo.go"},
		{"write", "Write", `{"file_path":"C:\\x\\y\\bar.ts"}`, "editing bar.ts"},
		{"read", "Read", `{"file_path":"/a/baz.md"}`, "reading baz.md"},
		{"bash", "Bash", `{"command":"go test ./..."}`, "running go test ./..."},
		{"edit missing path -> tool name", "Edit", `{}`, "Edit"},
		{"other tool -> name", "Grep", `{"pattern":"x"}`, "Grep"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := detailForTool(tt.tool, json.RawMessage(tt.input)); got != tt.want {
				t.Fatalf("detailForTool(%q) = %q, want %q", tt.tool, got, tt.want)
			}
		})
	}
}

func TestCanvasRevealFor(t *testing.T) {
	post := func(tool, path string) ccHookEvent {
		input, _ := json.Marshal(map[string]string{"file_path": path})
		return ccHookEvent{HookEventName: "PostToolUse", ToolName: tool, ToolInput: input}
	}
	root := t.TempDir()
	design := filepath.Join(root, ".superpowers", "design")
	board := filepath.Join(design, "dag-rail", "project", "Main.dc.html")
	hits := []struct {
		name    string
		ev      ccHookEvent
		address string
	}{
		{"write a board", post("Write", board), "canvas:dag-rail"},
		{"edit a board", post("Edit", board), "canvas:dag-rail"},
		{"forward slashes", post("Write", root+"/.superpowers/design/t/project/States.dc.html"), "canvas:t"},
		{"upper-case extension", post("Write", filepath.Join(design, "t", "project", "Main.DC.HTML")), "canvas:t"},
	}
	for _, c := range hits {
		address, cwd, ok := canvasRevealFor(c.ev)
		if !ok || address != c.address || cwd != root {
			t.Errorf("%s: got (%q, %q, %v), want (%q, %q, true)", c.name, address, cwd, ok, c.address, root)
		}
	}
	pre := post("Write", board)
	pre.HookEventName = "PreToolUse"
	misses := map[string]ccHookEvent{
		"before the write lands":  pre,
		"a read":                  post("Read", board),
		"canvas.json":             post("Write", filepath.Join(design, "t", "project", "canvas.json")),
		"a board outside project": post("Write", filepath.Join(design, "t", "Main.dc.html")),
		"a board in a nested dir": post("Write", filepath.Join(design, "t", "project", "sub", "Main.dc.html")),
		"a board under feedback":  post("Write", filepath.Join(design, "t", "feedback", "Main.dc.html")),
		"an ordinary source file": post("Write", filepath.Join(root, "src", "main.go")),
		"a relative path":         post("Write", filepath.Join(".superpowers", "design", "t", "project", "Main.dc.html")),
		"no file path":            {HookEventName: "PostToolUse", ToolName: "Write"},
	}
	for name, ev := range misses {
		if address, _, ok := canvasRevealFor(ev); ok {
			t.Errorf("%s: revealed %q", name, address)
		}
	}
}

func TestDetailForToolBashTruncated(t *testing.T) {
	long := ""
	for i := 0; i < 100; i++ {
		long += "x"
	}
	got := detailForTool("Bash", json.RawMessage(`{"command":"`+long+`"}`))
	if len(got) > len("running ")+60 {
		t.Fatalf("bash detail not truncated: len=%d", len(got))
	}
}

func TestReadLastModelAndTitle(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "transcript.jsonl")
	content := `{"type":"assistant","message":{"model":"claude-sonnet-4-6","content":[]}}
{"type":"ai-title","aiTitle":"First title"}
{"type":"user","message":{"content":"hi"}}
{"type":"assistant","message":{"model":"claude-opus-4-8","content":[]}}
{"type":"ai-title","aiTitle":"Final \"quoted\" title"}
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := readLastModel(path); got != "claude-opus-4-8" {
		t.Fatalf("model = %q, want claude-opus-4-8", got)
	}
	if got := readLastTitle(path); got != `Final "quoted" title` {
		t.Fatalf("title = %q, want Final \"quoted\" title", got)
	}
}

func TestReadLastTitleMissing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "t.jsonl")
	os.WriteFile(path, []byte(`{"type":"assistant","message":{"model":"m"}}`+"\n"), 0o644)
	if got := readLastTitle(path); got != "" {
		t.Fatalf("title = %q, want empty", got)
	}
	if got := readLastModel("/no/such/file"); got != "" {
		t.Fatalf("model on missing file = %q, want empty", got)
	}
}

func TestLastUserPrompt(t *testing.T) {
	// last user turn with human text wins; assistant/ai-title lines and tool_result-only user turns are ignored
	lines := []string{
		`{"type":"assistant","message":{"content":[]}}`,
		`{"type":"user","message":{"content":"first ask"}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","content":"file contents"}]}}`,
		`{"type":"user","message":{"content":[{"type":"text","text":"/commit stage the diff"}]}}`,
		`{"type":"ai-title","aiTitle":"x"}`,
	}
	if got := lastUserPrompt(lines); got != "/commit stage the diff" {
		t.Fatalf("lastUserPrompt = %q, want %q", got, "/commit stage the diff")
	}
}

func TestLastUserPromptStringAndEmpty(t *testing.T) {
	if got := lastUserPrompt([]string{`{"type":"user","message":{"content":"hi there"}}`}); got != "hi there" {
		t.Fatalf("string content = %q, want %q", got, "hi there")
	}
	if got := lastUserPrompt([]string{`{"type":"assistant","message":{"content":"x"}}`}); got != "" {
		t.Fatalf("no user turn -> %q, want empty", got)
	}
	if got := lastUserPrompt([]string{`{"type":"user","message":{"content":[{"type":"tool_result","content":"r"}]}}`}); got != "" {
		t.Fatalf("tool_result-only user turn -> %q, want empty", got)
	}
}

func TestTitleFromPrompt(t *testing.T) {
	tests := []struct{ name, in, want string }{
		{"already-clean text passes through", "/commit stage the diff", "/commit stage the diff"},
		{"first non-empty line only", "\n\n  do the thing  \nsecond line", "do the thing"},
		{"empty -> empty", "   \n  ", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := titleFromPrompt(tt.in); got != tt.want {
				t.Fatalf("titleFromPrompt(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestTitleFromPromptTruncatedByRune(t *testing.T) {
	got := titleFromPrompt(strings.Repeat("x", 200))
	if len([]rune(got)) != titleMax {
		t.Fatalf("truncated rune-len = %d, want %d", len([]rune(got)), titleMax)
	}
}

func TestTitleFromPromptSlashCommand(t *testing.T) {
	// Claude Code stores a slash-command turn as an XML-wrapped string, not clean text —
	// the fallback must unwrap it into a "/skill args" title.
	tests := []struct{ name, in, want string }{
		{"command with args",
			"<command-name>/brainstorming</command-name>\n            <command-message>brainstorming</command-message>\n            <command-args>design the memory tab</command-args>",
			"/brainstorming design the memory tab"},
		{"command without args",
			"<command-name>/brainstorming</command-name>\n            <command-message>brainstorming</command-message>\n            <command-args></command-args>",
			"/brainstorming"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := titleFromPrompt(tt.in); got != tt.want {
				t.Fatalf("titleFromPrompt(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestAgentHookRegistered(t *testing.T) {
	found, _, err := rootCmd.Find([]string{"agent-hook"})
	if err != nil || found == nil || found.Name() != "agent-hook" {
		t.Fatalf("agent-hook not registered: found=%v err=%v", found, err)
	}
}

func TestReadShadowSessionInfoAndFirstUser(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ses_x.jsonl")
	content := `{"type":"session","id":"ses_x","title":"First title","ts":1}
{"type":"user","text":"fix the flaky test","ts":2}
{"type":"session","id":"ses_x","model":"openai/gpt-5.2-codex","title":"Final title","ts":3}
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	model, title := readShadowSessionInfo(path)
	if model != "openai/gpt-5.2-codex" {
		t.Fatalf("model = %q, want openai/gpt-5.2-codex (last session record wins)", model)
	}
	if title != "Final title" {
		t.Fatalf("title = %q, want Final title", title)
	}
	if got := readShadowFirstUser(path); got != "fix the flaky test" {
		t.Fatalf("first user = %q, want fix the flaky test", got)
	}
}

func TestAgentHookFlagsRegistered(t *testing.T) {
	cmd, _, err := rootCmd.Find([]string{"agent-hook"})
	if err != nil || cmd == nil {
		t.Fatalf("agent-hook not found: %v", err)
	}
	if cmd.Flags().Lookup("agent") == nil {
		t.Fatal("agent-hook missing --agent flag")
	}
	if cmd.Flags().Lookup("shadow") == nil {
		t.Fatal("agent-hook missing --shadow flag")
	}
	if cmd.Flags().Lookup("state") == nil {
		t.Fatal("agent-hook missing --state flag")
	}
}

func TestHookDebugLine(t *testing.T) {
	home := t.TempDir()
	// os.UserHomeDir reads HOME on unix, USERPROFILE on windows — set both so the test is OS-agnostic.
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	logPath := filepath.Join(home, ".claude", "arc-hook-debug.log")

	// flag unset -> no file written
	t.Setenv("WAVETERM_HOOK_DEBUG", "")
	hookDebugLine("should-not-appear")
	if _, err := os.Stat(logPath); !os.IsNotExist(err) {
		t.Fatalf("log file should not exist when flag unset, stat err = %v", err)
	}

	// flag set -> line appended
	t.Setenv("WAVETERM_HOOK_DEBUG", "1")
	hookDebugLine("branch=no-blockid")
	b, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("reading log: %v", err)
	}
	if !strings.Contains(string(b), "branch=no-blockid") {
		t.Fatalf("log missing message, got %q", string(b))
	}
}

func TestIsSubagentDispatch(t *testing.T) {
	for _, tt := range []struct {
		ev   ccHookEvent
		want bool
	}{
		{ccHookEvent{HookEventName: "PreToolUse", ToolName: "Agent"}, true},
		{ccHookEvent{HookEventName: "PreToolUse", ToolName: "Task"}, true},
		{ccHookEvent{HookEventName: "PostToolUse", ToolName: "Agent"}, false},
		{ccHookEvent{HookEventName: "PreToolUse", ToolName: "Bash"}, false},
	} {
		if got := isSubagentDispatch(tt.ev); got != tt.want {
			t.Errorf("isSubagentDispatch(%+v) = %v, want %v", tt.ev, got, tt.want)
		}
	}
}

// one session once dispatched 96 subagents: past the cap every call is refused, while a call already
// recorded (a re-run hook) keeps its place and another session has its own count
func TestSubagentCallAllowedCapsASession(t *testing.T) {
	dir := t.TempDir()
	for _, id := range []string{"t1", "t2", "t3"} {
		if !subagentCallAllowed(dir, "s1", id, 3) {
			t.Fatalf("call %s is within the cap of 3", id)
		}
	}
	for _, id := range []string{"t4", "t5"} {
		if subagentCallAllowed(dir, "s1", id, 3) {
			t.Fatalf("call %s is past the cap of 3", id)
		}
	}
	if !subagentCallAllowed(dir, "s1", "t2", 3) {
		t.Fatal("a call already recorded keeps its place within the cap")
	}
	if subagentCallAllowed(dir, "s1", "t4", 3) {
		t.Fatal("a refused call stays refused")
	}
	if !subagentCallAllowed(dir, "s2", "t9", 3) {
		t.Fatal("another session has its own count")
	}
}

// the ledger is bookkeeping: a call it cannot record is let through, never refused
func TestSubagentCallAllowedLetsThroughWhatItCannotRecord(t *testing.T) {
	dir := t.TempDir()
	for _, tt := range []struct{ session, toolUse string }{
		{"", "t1"},
		{"s1", ""},
		{"../escape", "t1"},
	} {
		if !subagentCallAllowed(dir, tt.session, tt.toolUse, 0) {
			t.Errorf("session %q tool use %q cannot be recorded and must be allowed", tt.session, tt.toolUse)
		}
	}
}

func TestSubagentCapDenialIsAPreToolUseDeny(t *testing.T) {
	var out struct {
		HookSpecificOutput struct {
			HookEventName            string `json:"hookEventName"`
			PermissionDecision       string `json:"permissionDecision"`
			PermissionDecisionReason string `json:"permissionDecisionReason"`
		} `json:"hookSpecificOutput"`
	}
	if err := json.Unmarshal(subagentCapDenial(), &out); err != nil {
		t.Fatalf("denial is not json: %v", err)
	}
	h := out.HookSpecificOutput
	if h.HookEventName != "PreToolUse" || h.PermissionDecision != "deny" {
		t.Fatalf("denial = %+v, want a PreToolUse deny", h)
	}
	for _, want := range []string{fmt.Sprintf("%d subagents", jarvis.MaxSubagents), "wsh runs start --plan"} {
		if !strings.Contains(h.PermissionDecisionReason, want) {
			t.Errorf("reason missing %q: %s", want, h.PermissionDecisionReason)
		}
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package codexhook

import (
	"encoding/json"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func TestPlan(t *testing.T) {
	cases := []struct {
		name string
		p    Payload
		want Emission
	}{
		{"startup", Payload{HookEventName: "SessionStart", Source: "startup"}, Emission{State: baseds.AgentState_Idle, Title: true}},
		{"resume", Payload{HookEventName: "SessionStart", Source: "resume"}, Emission{State: baseds.AgentState_Idle, Title: true}},
		{"prompt", Payload{HookEventName: "UserPromptSubmit", Prompt: "fix it"}, Emission{State: baseds.AgentState_Working, Title: true}},
		{"tool", Payload{HookEventName: "PreToolUse", ToolName: "update_plan"}, Emission{State: baseds.AgentState_Working, Detail: "update_plan"}},
		{"tool done", Payload{HookEventName: "PostToolUse", ToolName: "Bash"}, Emission{State: baseds.AgentState_Working}},
		{"approval", Payload{HookEventName: "PermissionRequest", ToolName: "Bash", ToolInput: json.RawMessage(`{"command":"rm -rf build"}`)},
			Emission{State: baseds.AgentState_Waiting, Detail: "running rm -rf build"}},
		{"stop", Payload{HookEventName: "Stop"}, Emission{State: baseds.AgentState_Idle, Title: true}},
		{"interrupt", Payload{HookEventName: "Interrupt"}, Emission{State: baseds.AgentState_Idle}},
		{"compacting", Payload{HookEventName: "PreCompact", Trigger: "auto"}, Emission{State: baseds.AgentState_Working}},
		{"typed /compact done", Payload{HookEventName: "PostCompact", Trigger: "manual"}, Emission{State: baseds.AgentState_Idle}},
		{"auto compaction done: its turn goes on", Payload{HookEventName: "PostCompact", Trigger: "auto"}, Emission{}},
		{"subagent", Payload{HookEventName: "SubagentStart"}, Emission{}},
		{"session end", Payload{HookEventName: "SessionEnd"}, Emission{}},
	}
	for _, c := range cases {
		if got := Plan(c.p); got != c.want {
			t.Errorf("%s: Plan = %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestDetailForTool(t *testing.T) {
	cases := []struct {
		tool, input, want string
	}{
		{"Bash", `{"command":"go test ./pkg/x"}`, "running go test ./pkg/x"},
		{"Bash", `{"command":["git","status"]}`, "running git status"},
		{"exec_command", `{"cmd":"npm   test\n"}`, "running npm test"},
		{"apply_patch", `{"command":"*** Begin Patch\n*** Update File: pkg/a/b.go\n@@\n-x\n+y\n*** End Patch"}`, "editing b.go"},
		{"apply_patch", `{}`, "editing"},
		{"mcp__github__search", `{"q":"x"}`, "mcp__github__search"},
		{"Bash", `not json`, "Bash"},
	}
	for _, c := range cases {
		if got := detailForTool(c.tool, json.RawMessage(c.input)); got != c.want {
			t.Errorf("detailForTool(%q, %s) = %q, want %q", c.tool, c.input, got, c.want)
		}
	}
	long := `{"command":"echo 0123456789012345678901234567890123456789012345678901234567890123456789"}`
	if got := []rune(detailForTool("Bash", json.RawMessage(long))); len(got) != len("running ")+commandDetailMax {
		t.Errorf("long command detail has %d runes, want %d", len(got), len("running ")+commandDetailMax)
	}
}

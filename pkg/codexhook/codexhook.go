// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package codexhook is the pure half of `wsh codex-hook`: what a Codex CLI lifecycle-hook payload means for the
// cockpit. It does no RPC and imports nothing from wsh; the command file wires it to the cockpit.
//
// The hook only reports. It prints nothing and exits 0 on every path, which Codex reads as "no opinion": the tool
// runs, the prompt goes through, the turn ends as it would without arcterm.
package codexhook

import (
	"encoding/json"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// Payload is the subset of Codex's hook stdin (Codex CLI 0.162) the cockpit uses. Every event carries session_id,
// transcript_path, cwd, hook_event_name and model; the rest are per event.
type Payload struct {
	HookEventName  string          `json:"hook_event_name"`
	SessionID      string          `json:"session_id"`
	TranscriptPath string          `json:"transcript_path"`
	Cwd            string          `json:"cwd"`
	Model          string          `json:"model"`
	Source         string          `json:"source"`  // SessionStart: startup | resume | clear | compact
	Trigger        string          `json:"trigger"` // PreCompact / PostCompact: manual | auto
	Prompt         string          `json:"prompt"`  // UserPromptSubmit
	ToolName       string          `json:"tool_name"`
	ToolInput      json.RawMessage `json:"tool_input"`
}

// Emission is what one event reports. State "" means nothing to report.
type Emission struct {
	State  string
	Detail string
	// Title asks the caller to (re)read the session's title: once a turn, never per tool call, since it reads the
	// rollout.
	Title bool
}

// Plan maps one hook event to the state it reports.
func Plan(p Payload) Emission {
	switch p.HookEventName {
	case "SessionStart":
		// every start lands at the prompt: a fresh launch with a task reports working at its UserPromptSubmit
		// right after, and a resume is silent until its next prompt, so its title comes now
		return Emission{State: baseds.AgentState_Idle, Title: true}
	case "UserPromptSubmit":
		return Emission{State: baseds.AgentState_Working, Title: true}
	case "PreToolUse":
		return Emission{State: baseds.AgentState_Working, Detail: detailForTool(p.ToolName, p.ToolInput)}
	case "PostToolUse":
		return Emission{State: baseds.AgentState_Working}
	case "PermissionRequest":
		return Emission{State: baseds.AgentState_Waiting, Detail: detailForTool(p.ToolName, p.ToolInput)}
	case "Stop":
		return Emission{State: baseds.AgentState_Idle, Title: true}
	case "Interrupt":
		// Codex gives this hook 3 seconds at most: no rollout read
		return Emission{State: baseds.AgentState_Idle}
	case "PreCompact":
		return Emission{State: baseds.AgentState_Working}
	case "PostCompact":
		// an auto compaction sits inside a turn whose Stop reports idle; a typed /compact has no Stop
		if p.Trigger == "manual" {
			return Emission{State: baseds.AgentState_Idle}
		}
	}
	return Emission{}
}

const commandDetailMax = 60

// a patch names each file it touches on a header line
var patchFileRe = regexp.MustCompile(`(?m)^\*\*\* (?:Update|Add|Delete) File: (.+)$`)

// detailForTool is the rail's one-line "what it is doing": the command a shell tool runs, the file a patch edits,
// otherwise the tool's name.
func detailForTool(name string, input json.RawMessage) string {
	switch name {
	case "apply_patch":
		if m := patchFileRe.FindStringSubmatch(stringField(input, "command")); m != nil {
			return "editing " + filepath.Base(strings.TrimSpace(m[1]))
		}
		return "editing"
	case "Bash", "shell", "exec_command":
		cmd := stringField(input, "command")
		if cmd == "" {
			cmd = stringField(input, "cmd")
		}
		if cmd != "" {
			return "running " + truncate(cmd, commandDetailMax)
		}
	}
	return name
}

// stringField reads a string field of a JSON object; a command given as an argv array is joined with spaces.
func stringField(raw json.RawMessage, field string) string {
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return ""
	}
	var s string
	if json.Unmarshal(obj[field], &s) == nil {
		return s
	}
	var argv []string
	if json.Unmarshal(obj[field], &argv) == nil {
		return strings.Join(argv, " ")
	}
	return ""
}

func truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

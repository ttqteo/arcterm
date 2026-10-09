// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsleep

import (
	"encoding/json"
	"maps"
	"regexp"
	"slices"
	"strings"
)

// Claude Code runs a shell command in the background (run_in_background, or a foreground command that timed
// out into the background) as a child of its process, so ending the agent would end the command. This is a
// port of extractBackgroundTasks (frontend/app/view/agents/transcriptprojection.ts), which draws the same
// tasks in the Agent surface; keep the two reading a transcript the same way. It keeps only the label and the
// running status: where the output is written is of no use to a sleep check.

// the shell tools that take run_in_background (PowerShell is Claude Code's Windows shell tool)
var shellTools = map[string]bool{"Bash": true, "PowerShell": true}

var (
	bgIDText     = regexp.MustCompile(`running in background with ID: ([A-Za-z0-9_-]+)`)
	toolUseIDTag = regexp.MustCompile(`<tool-use-id>([^<]+)</tool-use-id>`)
	statusTag    = regexp.MustCompile(`<status>([^<]+)</status>`)
	taskIDTag    = regexp.MustCompile(`<task-id>([^<]+)</task-id>`)
)

const (
	bgRunning = "running"
	bgDone    = "done" // completed, failed or stopped: no longer running
)

// <task-notification> status -> ours; "killed" and "stopped" are the same thing to the reader
var notifiedStatus = map[string]string{
	"running":   bgRunning,
	"completed": bgDone,
	"failed":    bgDone,
	"killed":    bgDone,
	"stopped":   bgDone,
}

type bgTask struct {
	label  string
	status string
}

// BackgroundRunning returns the labels of the background shell tasks a Claude transcript started that have
// not finished, in first-seen order. lines are the transcript's JSONL records (a tail is enough); a line that
// does not parse is skipped. A task counts as running until its <task-notification> (joined by tool-use-id,
// or by task id for a resumed session's orphan summary) or a later TaskStop/KillShell says otherwise.
// Background subagents are not shell tasks; the caller lists those separately.
func BackgroundRunning(lines []string) []string {
	calls := map[string]string{} // tool-use id -> label, for every shell call
	tasks := map[string]*bgTask{}
	var order []*bgTask
	byTaskId := map[string]*bgTask{}
	startTask := func(toolUseId string) *bgTask {
		if t, ok := tasks[toolUseId]; ok {
			return t
		}
		label, ok := calls[toolUseId]
		if !ok {
			return nil
		}
		t := &bgTask{label: label, status: bgRunning}
		tasks[toolUseId] = t
		order = append(order, t)
		return t
	}
	for _, line := range lines {
		var rec any
		if json.Unmarshal([]byte(line), &rec) != nil {
			continue
		}
		content, _ := dig(rec, "message", "content").([]any)
		for _, b := range content {
			block, _ := b.(map[string]any)
			id, hasID := block["id"].(string)
			switch block["type"] {
			case "tool_use":
				if !hasID {
					continue
				}
				name, _ := block["name"].(string)
				input, _ := block["input"].(map[string]any)
				switch {
				case shellTools[name]:
					calls[id] = callLabel(input)
					if background, _ := input["run_in_background"].(bool); background {
						startTask(id)
					}
				case name == "TaskStop" || name == "KillShell":
					taskId, ok := input["task_id"].(string)
					if !ok {
						taskId, ok = input["shell_id"].(string)
					}
					if t := byTaskId[taskId]; ok && t != nil {
						t.status = bgDone
					}
				}
			case "tool_result":
				useId, ok := block["tool_use_id"].(string)
				if !ok {
					continue
				}
				if _, isShell := calls[useId]; !isShell {
					continue
				}
				taskId, fromRecord := dig(rec, "toolUseResult", "backgroundTaskId").(string)
				if !fromRecord {
					if m := bgIDText.FindStringSubmatch(toolResultText(block["content"])); m != nil {
						taskId = m[1]
					}
				}
				if taskId != "" {
					byTaskId[taskId] = startTask(useId)
				}
			}
		}
		for _, text := range notificationTexts(rec) {
			status := notifiedStatus[match1(statusTag, text)]
			if status == "" {
				continue
			}
			var targets []*bgTask
			if toolUseId := match1(toolUseIDTag, text); toolUseId != "" {
				targets = append(targets, tasks[toolUseId])
			} else {
				// a resumed session's orphan summary carries no tool-use-id, only one <task-id> per unfinished task
				for _, m := range taskIDTag.FindAllStringSubmatch(text, -1) {
					targets = append(targets, byTaskId[strings.TrimSpace(m[1])])
				}
			}
			for _, t := range targets {
				if t != nil {
					t.status = status
				}
			}
		}
	}
	var running []string
	for _, t := range order {
		if t.status == bgRunning {
			running = append(running, t.label)
		}
	}
	return running
}

// callLabel is what the person would call a shell call: its description, else its command.
func callLabel(input map[string]any) string {
	if desc, _ := input["description"].(string); strings.TrimSpace(desc) != "" {
		return strings.TrimSpace(desc)
	}
	if command, _ := input["command"].(string); command != "" {
		return command
	}
	return "background command"
}

// match1 is the trimmed first capture group of re in s, or "".
func match1(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// dig reads a path of object keys out of decoded JSON; nil when any step is missing.
func dig(v any, keys ...string) any {
	for _, k := range keys {
		m, _ := v.(map[string]any)
		if v = m[k]; v == nil {
			return nil
		}
	}
	return v
}

// toolResultText is a tool_result's `content`: either a string or an array of {type:"text", text}.
func toolResultText(content any) string {
	switch c := content.(type) {
	case string:
		return c
	case []any:
		var texts []string
		for _, b := range c {
			block, _ := b.(map[string]any)
			if text, ok := block["text"].(string); ok && block["type"] == "text" {
				texts = append(texts, text)
			}
		}
		return strings.Join(texts, "\n")
	}
	return ""
}

// A notification can arrive as a user message, a queue-operation's content or a queued-command attachment, so
// every string in the record that carries the tag is read rather than one known field. Keys are visited in
// order so a record that names one task twice resolves the same way every time.
func notificationTexts(rec any) []string {
	var out []string
	var visit func(v any, depth int)
	visit = func(v any, depth int) {
		switch x := v.(type) {
		case string:
			if strings.Contains(x, "<task-notification>") {
				out = append(out, x)
			}
		case map[string]any:
			if depth >= 5 {
				return
			}
			for _, k := range slices.Sorted(maps.Keys(x)) {
				visit(x[k], depth+1)
			}
		case []any:
			if depth >= 5 {
				return
			}
			for _, e := range x {
				visit(e, depth+1)
			}
		}
	}
	visit(rec, 0)
	return out
}

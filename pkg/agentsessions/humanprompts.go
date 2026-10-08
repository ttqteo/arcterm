// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/pisession"
)

// HumanPrompt is one message submitted at an agent session's prompt, stamped with the transcript's own time.
type HumanPrompt struct {
	Ts   int64
	Text string
}

// claudePromptLine is the part of a claude transcript line that says whether it holds a prompt.
type claudePromptLine struct {
	Type             string        `json:"type"`
	Timestamp        string        `json:"timestamp"`
	IsMeta           bool          `json:"isMeta"`
	IsSidechain      bool          `json:"isSidechain"`
	IsCompactSummary bool          `json:"isCompactSummary"`
	Origin           *claudeOrigin `json:"origin"`
	Message          struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
	Attachment struct {
		Type        string          `json:"type"`
		CommandMode string          `json:"commandMode"`
		Origin      *claudeOrigin   `json:"origin"`
		Prompt      json.RawMessage `json:"prompt"`
	} `json:"attachment"`
}

type claudeOrigin struct {
	Kind string `json:"kind"`
}

// sentByPerson reports a user record a person sent: not a subagent's, whose every record is a sidechain and whose
// prompt is the task its parent gave it, and with no origin or a human one (a background task finishing, and Claude
// Code's other own records, stamp their kind).
func sentByPerson(isSidechain bool, origin *claudeOrigin) bool {
	return !isSidechain && (origin == nil || origin.Kind == "human")
}

// HumanPrompts returns the prompts submitted to a claude, pi or agy session, oldest first, the one it was launched
// with included. Claude also writes a user record for tool output and for its own notices (a skill body, a
// slash command, command output, a background task finishing, an interruption, the compaction summary); none
// of those is a prompt. Neither is another agent's message (wsh agents send), which is typed into the session
// like one. Other runtimes, and a file that cannot be read, have none.
func HumanPrompts(path, runtime string) []HumanPrompt {
	switch runtime {
	case "claude":
		return claudeHumanPrompts(readLines(path))
	case "pi":
		file, err := pisession.Read(path)
		if err != nil {
			return nil
		}
		return piHumanPrompts(file)
	case "agy":
		return agyHumanPrompts(parseAgySteps(readLines(path)))
	}
	return nil
}

func claudeHumanPrompts(lines []string) []HumanPrompt {
	var out []HumanPrompt
	for _, line := range lines {
		// most of a transcript is assistant turns; they cannot be prompts, so they are not decoded
		if !strings.Contains(line, `"type":"user"`) && !strings.Contains(line, `"queued_command"`) {
			continue
		}
		var rec claudePromptLine
		if json.Unmarshal([]byte(line), &rec) != nil {
			continue
		}
		if text := claudeTypedText(rec); text != "" {
			out = append(out, HumanPrompt{Ts: parseTs(rec.Timestamp), Text: text})
		}
	}
	return out
}

// claudeTypedText is the text a person typed that a record carries, "" when it carries none.
func claudeTypedText(rec claudePromptLine) string {
	var raw json.RawMessage
	var origin *claudeOrigin
	switch {
	case rec.Type == "user" && !rec.IsMeta && !rec.IsCompactSummary:
		raw, origin = rec.Message.Content, rec.Origin
	// a message typed while the session is busy reaches the model mid-turn as this attachment, and never as a user record
	case rec.Type == "attachment" && rec.Attachment.Type == "queued_command" && rec.Attachment.CommandMode == "prompt":
		raw, origin = rec.Attachment.Prompt, rec.Attachment.Origin
	default:
		return ""
	}
	if !sentByPerson(rec.IsSidechain, origin) {
		return ""
	}
	text := claudePromptText(raw)
	if isClaudeNotice(text) {
		return ""
	}
	// an agent's message is checked once unwrapped: a long one is recorded inside the pasted_content tag
	if text = pastedContentRe.ReplaceAllString(text, "$1"); agentmsg.IsAgentMessage(text) {
		return ""
	}
	return text
}

// pastedContentRe is the tag claude code wraps a long typed or pasted message in before recording it. The text
// inside is what was typed, and what a sender of that text (the lead's `dag tell`) matches against. The id is
// hex, not decimal: most real ids carry letters (63b4, be41).
var pastedContentRe = regexp.MustCompile(`(?s)<pasted_content id="[^"]+">\n?(.*?)\n?</pasted_content id="[^"]+">`)

// claudePromptText is a user record's typed text: its string content, or the text blocks of an array holding no
// tool result, which is the harness answering the model rather than anyone typing.
func claudePromptText(raw json.RawMessage) string {
	if s := stringContent(raw); s != "" {
		return s
	}
	var blocks []claudeBlock
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	var parts []string
	for _, b := range blocks {
		switch b.Type {
		case "tool_result":
			return ""
		case "text":
			if t := strings.TrimSpace(b.Text); t != "" {
				parts = append(parts, t)
			}
		}
	}
	return strings.Join(parts, "\n")
}

// isClaudeNotice reports text claude writes into a user record on its own account, in the shapes
// projectTranscript (frontend/app/view/agents/transcriptprojection.ts) also skips or renders apart.
func isClaudeNotice(text string) bool {
	return strings.HasPrefix(text, caveatOpenTag) ||
		commandNameRe.MatchString(text) ||
		strings.Contains(text, "<local-command-stdout>") ||
		strings.Contains(text, "<task-notification>") ||
		strings.HasPrefix(text, "[Request interrupted by user")
}

func piHumanPrompts(file *pisession.File) []HumanPrompt {
	branch, err := file.ActiveBranch()
	if err != nil {
		return nil
	}
	var out []HumanPrompt
	for _, e := range branch {
		if text := piUserText(e.Message); text != "" && !agentmsg.IsAgentMessage(text) {
			out = append(out, HumanPrompt{Ts: parseTs(e.Timestamp), Text: text})
		}
	}
	return out
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"encoding/json"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/pisession"
)

// LastAnswer returns the last thing a claude, pi or agy session said, in full, and its transcript time (UnixMilli).
// A subagent's turns and a turn that only called tools are not answers. Other runtimes, a file that cannot be
// read, and a session that has not answered yet give "", 0.
func LastAnswer(path, runtime string) (text string, ts int64) {
	switch runtime {
	case "claude":
		return claudeLastAnswer(readLines(path))
	case "pi":
		file, err := pisession.Read(path)
		if err != nil {
			return "", 0
		}
		return piLastAnswer(file)
	case "agy":
		return agyLastAnswer(parseAgySteps(readLines(path)))
	}
	return "", 0
}

func claudeLastAnswer(lines []string) (string, int64) {
	for i := len(lines) - 1; i >= 0; i-- {
		if !strings.Contains(lines[i], `"type":"assistant"`) {
			continue
		}
		var rec struct {
			Type        string `json:"type"`
			Timestamp   string `json:"timestamp"`
			IsSidechain bool   `json:"isSidechain"`
			Message     struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(lines[i]), &rec) != nil || rec.Type != "assistant" || rec.IsSidechain {
			continue
		}
		if text := textBlocks(rec.Message.Content); text != "" {
			return text, parseTs(rec.Timestamp)
		}
	}
	return "", 0
}

func piLastAnswer(file *pisession.File) (string, int64) {
	branch, err := file.ActiveBranch()
	if err != nil {
		return "", 0
	}
	for i := len(branch) - 1; i >= 0; i-- {
		var m struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		}
		if len(branch[i].Message) == 0 || json.Unmarshal(branch[i].Message, &m) != nil || m.Role != "assistant" {
			continue
		}
		if text := textBlocks(m.Content); text != "" {
			return text, parseTs(branch[i].Timestamp)
		}
	}
	return "", 0
}

// textBlocks is a message's text: its string content, or its non-blank text blocks joined with newlines.
func textBlocks(raw json.RawMessage) string {
	if s := stringContent(raw); s != "" {
		return s
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	var parts []string
	for _, b := range blocks {
		if t := strings.TrimSpace(b.Text); b.Type == "text" && t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, "\n")
}

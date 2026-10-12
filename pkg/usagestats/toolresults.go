// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Oversized tool results in Claude transcripts. A tool result enters its session's context once, is written to the
// prompt cache, and is read back on every later turn, so a whole-file Read or a test run that prints every pass is
// paid for again and again. The per-session view counts them by tool, so Analyze can say which habit fills the context.

package usagestats

import (
	"bytes"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"
)

// BigResultChars is the size, in characters, past which a tool result counts as oversized: about 5k tokens.
const BigResultChars = 20_000

var toolResultMarker = []byte(`"tool_result"`)

// BigToolResult is one oversized tool result: when it arrived, the tool that produced it ("unknown" when its call is
// not in the same file), its text length in characters, the session it bills to and whether a subagent read it, and
// the id of the call, which dedupes a result that a forked transcript carries again.
type BigToolResult struct {
	TS      time.Time
	Tool    string
	Chars   int
	Session string
	Sub     bool
	UseID   string
}

// isClaudeLine is what readClaudeLines keeps: a line that can carry usage, or the session's ai-title.
func isClaudeLine(line []byte) bool {
	return bytes.Contains(line, usageMarker) || bytes.Contains(line, aiTitleMarker)
}

// readClaudeFile reads a Claude transcript as readClaudeLines does and measures its oversized tool results as they
// stream past, so a long result is parsed once and never held. Each result's Tool is still empty: nameTools fills it.
func readClaudeFile(path string) ([]string, []BigToolResult) {
	var big []BigToolResult
	lines := scanLines(path, func(line []byte) bool {
		// a line no longer than the threshold cannot hold an oversized result: JSON escaping only lengthens the text
		if len(line) > BigResultChars && bytes.Contains(line, toolResultMarker) {
			big = append(big, bigResultsOf(line)...)
		}
		return isClaudeLine(line)
	})
	return lines, big
}

// bigResultsOf returns the oversized tool results of one user line, nil for any other line.
func bigResultsOf(line []byte) []BigToolResult {
	var rec struct {
		Type      string `json:"type"`
		Timestamp string `json:"timestamp"`
		Message   struct {
			Content json.RawMessage `json:"content"`
		} `json:"message"`
	}
	if json.Unmarshal(line, &rec) != nil || rec.Type != "user" {
		return nil
	}
	ts, err := time.Parse(time.RFC3339, rec.Timestamp)
	if err != nil {
		return nil
	}
	var blocks []struct {
		Type      string          `json:"type"`
		ToolUseID string          `json:"tool_use_id"`
		Content   json.RawMessage `json:"content"`
	}
	if json.Unmarshal(rec.Message.Content, &blocks) != nil {
		return nil
	}
	var out []BigToolResult
	for _, b := range blocks {
		if b.Type != "tool_result" {
			continue
		}
		if n := textChars(b.Content); n > BigResultChars {
			out = append(out, BigToolResult{TS: ts, Chars: n, UseID: b.ToolUseID})
		}
	}
	return out
}

// textChars is the length in characters of a tool result's content: a string, or the text blocks of a list. An image
// block counts nothing, since its tokens do not grow with its encoded size.
func textChars(raw json.RawMessage) int {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return utf8.RuneCountInString(s)
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) != nil {
		return 0
	}
	n := 0
	for _, b := range blocks {
		if b.Type == "text" {
			n += utf8.RuneCountInString(b.Text)
		}
	}
	return n
}

// nameTools sets each result's Tool from the tool_use block in lines that made the call. Only an assistant line that
// names one of the ids is parsed; a call not found leaves "unknown".
func nameTools(lines []string, big []BigToolResult) {
	if len(big) == 0 {
		return
	}
	names := make(map[string]string, len(big))
	for _, b := range big {
		if b.UseID != "" {
			names[b.UseID] = ""
		}
	}
	for _, ln := range lines {
		if !strings.Contains(ln, `"tool_use"`) || !namesAny(ln, names) {
			continue
		}
		var rec struct {
			Message struct {
				Content []struct {
					Type string `json:"type"`
					ID   string `json:"id"`
					Name string `json:"name"`
				} `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(ln), &rec) != nil {
			continue
		}
		for _, c := range rec.Message.Content {
			if _, want := names[c.ID]; want && c.Type == "tool_use" {
				names[c.ID] = c.Name
			}
		}
	}
	for i := range big {
		big[i].Tool = names[big[i].UseID]
		if big[i].Tool == "" {
			big[i].Tool = "unknown"
		}
	}
}

// namesAny reports whether line mentions an id whose tool is not yet known.
func namesAny(line string, names map[string]string) bool {
	for id, name := range names {
		if name == "" && strings.Contains(line, id) {
			return true
		}
	}
	return false
}

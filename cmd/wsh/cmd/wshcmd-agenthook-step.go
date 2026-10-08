// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// a step a turn ended on, as a design walked through in parts names it: "Phần 1/3", "Part 2 of 4", "Bước 1/3",
// "phần 1 trong 3", "Round 1 out of 2"
var stepKeywordRe = regexp.MustCompile(`(?i)(?:^|[^\p{L}])(?:phần|part|bước|step|section|mục|phase|giai đoạn|câu hỏi|question|round|vòng)\s*(\d{1,2})\s*(?:/|out of|of|trên|trong số|trong)\s*(\d{1,2})(?:[^\d]|$)`)

// a bare count that opens a line, as a heading or a bold lead does: "## 1/3 — …", "**2/3**", "(1/3)", "[1/3]", "1/3:"
var stepLineRe = regexp.MustCompile(`(?m)^\s*(?:#{1,6}\s*)?(?:\*\*|\(|\[)?\s*(\d{1,2})\s*/\s*(\d{1,2})\s*(?:\*\*|\)|\]|[:.\-–—]|$)`)

// a part with no total, only as the heading a line opens with: "## Phần 2 — …", "**Phần 1:**", "Part 3:". Only
// phần/part: "Step 1:" and "Bước 1:" open ordinary instruction lists
var stepBareRe = regexp.MustCompile(`(?im)^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:phần|part)\s+(\d{1,2})\s*(?:\*\*|[:.\-–—)]|$)`)

// what a message quotes rather than says: a code block, inline code, a "quoted" or “quoted” phrase. An example such as
// (kiểu "Phần 2/4") must not read as the part the turn stops on
var stepQuotedRe = regexp.MustCompile("(?s)```.*?```|`[^`\\n]*`|\"[^\"\\n]*\"|“[^”\\n]*”")

const stepMax = 20

// stepMarker returns the "n/m" step a message stops on, or "" when it names none. A line-opening count wins over
// one inside a sentence, and the first of each wins, so a message that recaps an earlier part after its heading
// still reads as the part its heading names. A zero-padded count is a date ("vòng 05/10"), never a step. With no
// total anywhere, a part heading gives "n" alone, but only when it is the one part the message names: headings for
// Phần 1, 2 and 3 are a whole document, not a stop on one of them. What the message quotes is left out first.
func stepMarker(text string) string {
	text = stepQuotedRe.ReplaceAllString(text, " ")
	for _, re := range []*regexp.Regexp{stepLineRe, stepKeywordRe} {
		for _, m := range re.FindAllStringSubmatch(text, -1) {
			if strings.HasPrefix(m[1], "0") || strings.HasPrefix(m[2], "0") {
				continue
			}
			n, _ := strconv.Atoi(m[1])
			total, _ := strconv.Atoi(m[2])
			if n >= 1 && total >= 2 && n <= total && total <= stepMax {
				return strconv.Itoa(n) + "/" + strconv.Itoa(total)
			}
		}
	}
	return bareStep(text)
}

// bareStep returns the one part a message's headings name with no total, or "" when they name none or several.
func bareStep(text string) string {
	part := ""
	for _, m := range stepBareRe.FindAllStringSubmatch(text, -1) {
		if strings.HasPrefix(m[1], "0") {
			continue
		}
		if n, _ := strconv.Atoi(m[1]); n < 1 || n > stepMax {
			continue
		}
		if part != "" && part != m[1] {
			return ""
		}
		part = m[1]
	}
	return part
}

// askText returns the headers and questions of an AskUserQuestion input, where a design walked through in parts
// often names its step ("Phần 1/4 ổn chưa?"), or "" when the input has none.
func askText(input json.RawMessage) string {
	var in struct {
		Questions []struct {
			Header   string `json:"header"`
			Question string `json:"question"`
		} `json:"questions"`
	}
	if json.Unmarshal(input, &in) != nil {
		return ""
	}
	parts := make([]string, 0, 2*len(in.Questions))
	for _, q := range in.Questions {
		parts = append(parts, strings.TrimSpace(q.Header), strings.TrimSpace(q.Question))
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

// lastAsk returns the text of the AskUserQuestion calls in an assistant record's content, or "" when it has none.
func lastAsk(raw json.RawMessage) string {
	var blocks []struct {
		Type  string          `json:"type"`
		Name  string          `json:"name"`
		Input json.RawMessage `json:"input"`
	}
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	ask := ""
	for _, b := range blocks {
		if b.Type == "tool_use" && b.Name == "AskUserQuestion" {
			if t := askText(b.Input); t != "" {
				ask = t
			}
		}
	}
	return ask
}

// lastAssistantText returns the text of the assistant's last message in the current turn: the turn starts at the
// last user record that carries human prose, so a turn that ended on tools alone yields "", not an older message.
func lastAssistantText(lines []string) string {
	_, text := lastAssistantTurn(lines)
	return text
}

// lastAssistantTurn returns the current turn's last AskUserQuestion after its last message, and that message's text.
func lastAssistantTurn(lines []string) (ask, text string) {
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var rec struct {
			Type    string `json:"type"`
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(ln), &rec) != nil {
			continue
		}
		switch rec.Type {
		case "user":
			if userText(rec.Message.Content) != "" {
				ask, text = "", ""
			}
		case "assistant":
			// userText keeps a record's text blocks, which is what an assistant message says too
			if t := userText(rec.Message.Content); t != "" {
				ask, text = "", t
			}
			if a := lastAsk(rec.Message.Content); a != "" {
				ask = a
			}
		}
	}
	return ask, text
}

// readLastStep returns the step the current turn stops on: a question it asks names it first, then the message
// before that question.
func readLastStep(path string) string {
	ask, text := lastAssistantTurn(tailLines(path))
	if step := stepMarker(ask); step != "" {
		return step
	}
	return stepMarker(text)
}

// askStep returns the step a pending AskUserQuestion stops on: its own questions name it first; the hook can run
// before the call reaches the transcript, so the transcript's turn is the fallback.
func askStep(input json.RawMessage, path string) string {
	if step := stepMarker(askText(input)); step != "" {
		return step
	}
	if path == "" {
		return ""
	}
	return readLastStep(path)
}

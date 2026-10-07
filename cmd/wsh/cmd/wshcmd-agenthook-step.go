// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// a step a turn ended on, as a design walked through in parts names it: "Phần 1/3", "Part 2 of 4", "Bước 1/3"
var stepKeywordRe = regexp.MustCompile(`(?i)(?:^|[^\p{L}])(?:phần|part|bước|step|section|mục|phase|giai đoạn)\s*(\d{1,2})\s*(?:/|of|trên)\s*(\d{1,2})(?:[^\d]|$)`)

// a bare count that opens a line, as a heading or a bold lead does: "## 1/3 — …", "**2/3**", "(1/3)", "1/3:"
var stepLineRe = regexp.MustCompile(`(?m)^\s*(?:#{1,6}\s*)?(?:\*\*|\()?\s*(\d{1,2})\s*/\s*(\d{1,2})\s*(?:\*\*|\)|[:.\-–—]|$)`)

const stepMax = 20

// stepMarker returns the "n/m" step a message stops on, or "" when it names none. A line-opening count wins over
// one inside a sentence, and the first of each wins, so a message that recaps an earlier part after its heading
// still reads as the part its heading names.
func stepMarker(text string) string {
	for _, re := range []*regexp.Regexp{stepLineRe, stepKeywordRe} {
		for _, m := range re.FindAllStringSubmatch(text, -1) {
			n, _ := strconv.Atoi(m[1])
			total, _ := strconv.Atoi(m[2])
			if n >= 1 && total >= 2 && n <= total && total <= stepMax {
				return strconv.Itoa(n) + "/" + strconv.Itoa(total)
			}
		}
	}
	return ""
}

// lastAssistantText returns the text of the assistant's last message in the current turn: the turn starts at the
// last user record that carries human prose, so a turn that ended on tools alone yields "", not an older message.
func lastAssistantText(lines []string) string {
	text := ""
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
				text = ""
			}
		case "assistant":
			// userText keeps a record's text blocks, which is what an assistant message says too
			if t := userText(rec.Message.Content); t != "" {
				text = t
			}
		}
	}
	return text
}

func readLastStep(path string) string {
	return stepMarker(lastAssistantText(tailLines(path)))
}

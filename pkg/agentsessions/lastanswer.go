// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/pisession"
)

// LastAnswer returns the last thing a claude, pi or agy session said, in full, and its transcript time (UnixMilli).
// A subagent's turns and a turn that only called tools are not answers. Other runtimes, a file that cannot be
// read, and a session that has not answered yet give "", 0.
func LastAnswer(path, runtime string) (text string, ts int64) {
	switch runtime {
	case "claude":
		return claudeLastAnswer(transcriptLines(path))
	case "pi":
		file, err := pisession.Read(path)
		if err != nil {
			return "", 0
		}
		return piLastAnswer(file)
	case "agy":
		return agyLastAnswer(parseAgySteps(transcriptLines(path)))
	}
	return "", 0
}

// AnswerAt returns one reply of a claude session by the uuid of its transcript record, in full, and its transcript time
// (UnixMilli): the reply LastAnswer would give had the session stopped there. A record that has no text (a tool call, a
// user turn), a subagent's record, a uuid no record has, any other runtime and a file that cannot be read are not found.
func AnswerAt(path, runtime, uuid string) (text string, ts int64, found bool) {
	if runtime != "claude" || uuid == "" {
		return "", 0, false
	}
	return claudeAnswerAt(transcriptLines(path), uuid)
}

func claudeAnswerAt(lines []string, uuid string) (string, int64, bool) {
	for _, line := range lines {
		// the uuid also names a record as its parent, so the line is parsed to check it is the record's own
		if !strings.Contains(line, uuid) || !strings.Contains(line, `"type":"assistant"`) {
			continue
		}
		var rec claudeLine
		if json.Unmarshal([]byte(line), &rec) != nil || rec.UUID != uuid {
			continue
		}
		if text := claudeReplyText(rec); text != "" {
			return text, parseTs(rec.Timestamp), true
		}
		return "", 0, false
	}
	return "", 0, false
}

func claudeLastAnswer(lines []string) (string, int64) {
	for i := len(lines) - 1; i >= 0; i-- {
		if !strings.Contains(lines[i], `"type":"assistant"`) {
			continue
		}
		var rec claudeLine
		if json.Unmarshal([]byte(lines[i]), &rec) != nil {
			continue
		}
		if text := claudeReplyText(rec); text != "" {
			return text, parseTs(rec.Timestamp)
		}
	}
	return "", 0
}

// claudeReplyText is the text the session itself said in a record: the text blocks of a main-chain assistant
// message. Thinking and tool calls are not text blocks, and a subagent's message is a sidechain.
func claudeReplyText(rec claudeLine) string {
	if rec.Type != "assistant" || rec.IsSidechain {
		return ""
	}
	return textBlocks(rec.Message.Content)
}

func piLastAnswer(file *pisession.File) (string, int64) {
	branch, err := file.ActiveBranch()
	if err != nil {
		return "", 0
	}
	for i := len(branch) - 1; i >= 0; i-- {
		if text := piReplyText(branch[i]); text != "" {
			return text, parseTs(branch[i].Timestamp)
		}
	}
	return "", 0
}

// piReplyText is the text blocks of a pi assistant message, "" for any other entry.
func piReplyText(e pisession.Entry) string {
	var m struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	}
	if len(e.Message) == 0 || json.Unmarshal(e.Message, &m) != nil || m.Role != "assistant" {
		return ""
	}
	return textBlocks(m.Content)
}

// maxErrorText bounds a provider error carried into a one-line reason; a provider can answer with a whole page.
const maxErrorText = 300

// refusedRe is an HTTP status that says the account may not use the route (unauthorized, forbidden). Unlike a
// 429 or a 5xx it does not pass with time, so the same route refuses every retry.
var refusedRe = regexp.MustCompile(`^(401|403)\b`)

// Failure is the provider error a session's last turn ended on. Model is the provider-qualified model that
// refused it, as a run route names it, when the transcript says (pi); "" otherwise.
type Failure struct {
	Text  string
	Model string
}

// Refused reports a failure no retry on the same route can pass.
func (f Failure) Refused() bool {
	return refusedRe.MatchString(f.Text)
}

// LastError returns the provider error a claude or pi session's last assistant message is, or a zero Failure when
// that message is not an error. A dead route or a spent plan leaves the session idle at its prompt, and its
// transcript is the only thing that says why. An error the session recovered from is followed by a real message,
// so it is not reported. Other runtimes and a file that cannot be read give a zero Failure.
func LastError(path, runtime string) Failure {
	switch runtime {
	case "claude":
		return claudeLastError(transcriptLines(path))
	case "pi":
		file, err := pisession.Read(path)
		if err != nil {
			return Failure{}
		}
		return piLastError(file)
	}
	return Failure{}
}

func claudeLastError(lines []string) Failure {
	for i := len(lines) - 1; i >= 0; i-- {
		if !strings.Contains(lines[i], `"type":"assistant"`) {
			continue
		}
		var rec struct {
			Type              string `json:"type"`
			IsSidechain       bool   `json:"isSidechain"`
			IsApiErrorMessage bool   `json:"isApiErrorMessage"`
			Message           struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(lines[i]), &rec) != nil || rec.Type != "assistant" || rec.IsSidechain {
			continue
		}
		if !rec.IsApiErrorMessage {
			return Failure{}
		}
		return Failure{Text: errorText(textBlocks(rec.Message.Content))}
	}
	return Failure{}
}

func piLastError(file *pisession.File) Failure {
	branch, err := file.ActiveBranch()
	if err != nil {
		return Failure{}
	}
	for i := len(branch) - 1; i >= 0; i-- {
		var m struct {
			Role         string `json:"role"`
			StopReason   string `json:"stopReason"`
			ErrorMessage string `json:"errorMessage"`
			Provider     string `json:"provider"`
			Model        string `json:"model"`
		}
		if len(branch[i].Message) == 0 || json.Unmarshal(branch[i].Message, &m) != nil || m.Role != "assistant" {
			continue
		}
		if m.StopReason != "error" {
			return Failure{}
		}
		f := Failure{Text: errorText(m.ErrorMessage)}
		if m.Provider != "" && m.Model != "" {
			f.Model = m.Provider + "/" + m.Model
		}
		return f
	}
	return Failure{}
}

func errorText(s string) string {
	return trimTo(wsRe.ReplaceAllString(s, " "), maxErrorText)
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

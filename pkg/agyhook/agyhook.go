// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agyhook is the pure half of `wsh agy-hook`: what an Antigravity CLI (agy) hook payload means for the
// cockpit, and the bytes agy's PreToolUse decision protocol wants back. It does no RPC and imports nothing from
// wsh; the command file wires it to the cockpit.
//
// agy's PreToolUse protocol (agy 1.3.1): empty stdout is "no opinion" and the tool runs under agy's normal
// permissions; `{}` or `{"decision":""}` DENIES; `{"decision":"deny","reason":...}` denies with the reason shown
// to the model. The other four events take `{}` and nothing they print changes anything.
package agyhook

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

const (
	// DismissedReason is what the model is told when the person dismissed the card.
	DismissedReason = "The user dismissed the question."

	// PreToolUseBound is how long `wsh agy-hook` works on a PreToolUse before it gives up and answers neutral:
	// the ask card's 30-minute ceiling, or a turn in the heavy-job queue.
	PreToolUseBound = 60 * time.Minute

	// HookTimeoutSeconds is the PreToolUse `timeout` written into agy's hooks.json: 62 minutes, so the hook always
	// answers (at the bound) before agy would kill it. The other events use OtherHookTimeoutSeconds.
	HookTimeoutSeconds = 3720

	OtherHookTimeoutSeconds = 10
)

const (
	toolAskQuestion = "ask_question"
	toolRunCommand  = "run_command"
	askHeader       = "The user answered in the arcterm cockpit:"
	askArrow        = " -> "
)

// Payload is the subset of agy's hook stdin that arcterm uses. The payload does not name its event: the command
// line carries it.
type Payload struct {
	ConversationID string   `json:"conversationId"`
	TranscriptPath string   `json:"transcriptPath"`
	ModelName      string   `json:"modelName"`
	WorkspacePaths []string `json:"workspacePaths"`
	ToolCall       ToolCall `json:"toolCall"`
	// Stop
	FullyIdle         bool   `json:"fullyIdle"`
	TerminationReason string `json:"terminationReason"`
	Error             string `json:"error"`
}

type ToolCall struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

// Cwd is the launch directory: the last workspace path, since `--add-dir` entries come first.
func (p Payload) Cwd() string {
	if len(p.WorkspacePaths) == 0 {
		return ""
	}
	return p.WorkspacePaths[len(p.WorkspacePaths)-1]
}

// Emission is what one hook event asks the command to do. State "" means report nothing.
type Emission struct {
	State  string
	Detail string
	// Ask is set for an ask_question tool call whose arguments parsed: the command raises Questions on the card.
	Ask       bool
	Questions []baseds.AgentAskQuestion
	// Command is the command line of a run_command tool call, which goes through memgate.
	Command string
}

// Plan maps one hook event to its emission.
func Plan(event string, p Payload) Emission {
	switch event {
	case "PreInvocation", "PostToolUse":
		return Emission{State: baseds.AgentState_Working}
	case "Stop":
		if p.FullyIdle {
			return Emission{State: baseds.AgentState_Idle}
		}
	case "PreToolUse":
		return planPreToolUse(p.ToolCall)
	}
	return Emission{}
}

func planPreToolUse(tc ToolCall) Emission {
	switch tc.Name {
	case toolAskQuestion:
		if qs, err := Questions(tc.Args); err == nil {
			return Emission{State: baseds.AgentState_Asking, Ask: true, Questions: qs}
		}
	case toolRunCommand:
		if cmd := argString(tc.Args, "CommandLine"); cmd != "" {
			return Emission{State: baseds.AgentState_Working, Detail: cmd, Command: cmd}
		}
	}
	detail := argString(tc.Args, "toolSummary")
	if detail == "" {
		detail = tc.Name
	}
	return Emission{State: baseds.AgentState_Working, Detail: detail}
}

func argString(args json.RawMessage, field string) string {
	if len(args) == 0 {
		return ""
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(args, &m) != nil {
		return ""
	}
	var s string
	if json.Unmarshal(m[field], &s) != nil {
		return ""
	}
	return s
}

// Questions converts an ask_question call's arguments to cockpit questions: each string option becomes a label
// with no description, `is_multi_select` is MultiSelect, and there is no header. An error means the call carries no
// usable question, and the command leaves it to agy's own question UI.
func Questions(args json.RawMessage) ([]baseds.AgentAskQuestion, error) {
	var in struct {
		Questions []struct {
			Question      string   `json:"question"`
			Options       []string `json:"options"`
			IsMultiSelect bool     `json:"is_multi_select"`
		} `json:"questions"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, err
	}
	if len(in.Questions) == 0 {
		return nil, errNoQuestions
	}
	qs := make([]baseds.AgentAskQuestion, len(in.Questions))
	for i, q := range in.Questions {
		opts := make([]baseds.AgentAskOption, len(q.Options))
		for j, o := range q.Options {
			opts[j] = baseds.AgentAskOption{Label: o}
		}
		qs[i] = baseds.AgentAskQuestion{Question: q.Question, MultiSelect: q.IsMultiSelect, Options: opts}
	}
	return qs, nil
}

var errNoQuestions = errors.New("ask_question carries no questions")

// AnswerReason is the deny reason that hands the person's answers to the model: one line per question,
// `<question> -> <answer>`, where a picked answer is its option labels joined by ", " and a typed one is its text.
// Question and answer text pass through unchanged, newlines included.
func AnswerReason(qs []baseds.AgentAskQuestion, answers []baseds.AgentAnswerItem) string {
	lines := make([]string, 0, len(qs))
	for i, q := range qs {
		var answer string
		if i < len(answers) {
			answer = answerText(q, answers[i])
		}
		lines = append(lines, q.Question+askArrow+answer)
	}
	return askHeader + "\n" + strings.Join(lines, "\n")
}

func answerText(q baseds.AgentAskQuestion, a baseds.AgentAnswerItem) string {
	var parts []string
	for _, idx := range a.SelectedIndexes {
		if idx >= 0 && idx < len(q.Options) {
			parts = append(parts, q.Options[idx].Label)
		}
	}
	if a.Text != "" {
		parts = append(parts, a.Text)
	}
	return strings.Join(parts, ", ")
}

// Deny is the PreToolUse output that refuses the tool and tells the model why.
func Deny(reason string) []byte {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}{"deny", reason})
	return bytes.TrimRight(buf.Bytes(), "\n")
}

// Neutral is an event's "no opinion" output: nothing for PreToolUse (where `{}` would deny), `{}` for the rest.
func Neutral(event string) []byte {
	if event == "PreToolUse" {
		return nil
	}
	return []byte("{}")
}

// FirstUserRequest is the text of the first USER_INPUT step's <USER_REQUEST> in the head of a transcript, "" when
// the head holds none. A line that does not parse (a head cut mid-line, a future format) is skipped.
func FirstUserRequest(head []byte) string {
	for _, line := range bytes.Split(head, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var rec struct {
			Type    string `json:"type"`
			Content string `json:"content"`
		}
		if json.Unmarshal(line, &rec) != nil || rec.Type != "USER_INPUT" {
			continue
		}
		if req := tagContent(rec.Content, "USER_REQUEST"); req != "" {
			return req
		}
	}
	return ""
}

func tagContent(s, tag string) string {
	open, closeTag := "<"+tag+">", "</"+tag+">"
	i := strings.Index(s, open)
	if i < 0 {
		return ""
	}
	i += len(open)
	j := strings.Index(s[i:], closeTag)
	if j < 0 {
		return ""
	}
	return strings.TrimSpace(s[i : i+j])
}

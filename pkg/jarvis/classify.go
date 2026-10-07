// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const classifyTimeout = 120 * time.Second
const maxTimeline = 12
const maxTimelineLine = 200

// runFn is the process-runner seam for this package's headless claude call (Classify). Production uses
// consult.Run; tests override it so nothing shells out and so the spec the call selects — notably its
// tier — is observable.
var runFn = consult.Run

// Decision is the classifier's structured verdict. An "answer" carries one AgentAnswerItem per question, in
// order; handleAsk validates them against the ask before delivery, since ParseDecision never sees the questions.
type Decision struct {
	Action  string                   `json:"action"` // "answer" | "escalate"
	Answers []baseds.AgentAnswerItem `json:"answers,omitempty"`
	Reason  string                   `json:"reason"`
}

// judgeAnswer is one question's verdict as the model writes it: picks, a one-line text answer, or a flag that
// this question needs the human.
type judgeAnswer struct {
	Picks []int  `json:"picks"`
	Text  string `json:"text"`
	Human bool   `json:"human"`
}

// BuildClassifyPrompt composes a JSON-only prompt: every question with its pick-one / pick-any mode and indexed
// options, the worker's task, the resolved principles (when any), and a capped recent timeline (messages are the
// channel's, oldest first; only the last maxTimeline are used). The model must return {action, answers, reason}.
// Empty principles leave the principles section out.
func BuildClassifyPrompt(questions []baseds.AgentAskQuestion, task string, channel *waveobj.Channel, messages []*waveobj.ChannelMessage, principles waveobj.PrincipleList) string {
	timeline := recentTimeline(messages)
	if task == "" {
		task = "(unknown task)"
	}
	lines := []string{
		fmt.Sprintf(`You are Jarvis, gatekeeping a coding agent in the "%s" channel. A worker paused to ask %d multiple-choice question(s). Decide for each whether it is ROUTINE (safe to auto-answer on the human's behalf) or a genuine FORK that needs the human.`, channel.Name, len(questions)),
		`A question needs the human if the choice is irreversible, changes product scope or user-facing behavior, is a real judgment call, or you are not confident. When in doubt, escalate. The worker receives all answers at once, so if ANY question needs the human, escalate the whole ask.`,
	}
	if rendered := RenderPrinciples(principles); rendered != "" {
		lines = append(lines,
			"",
			"Team principles to weigh (escalate a fork that is principle-significant, e.g. a quick patch vs. the clean fix; when you DO auto-answer, prefer the option these principles favor):",
			rendered,
		)
	}
	lines = append(lines,
		"",
		"Worker task: "+task,
		"",
		renderQuestions(questions),
		"",
		"Recent channel messages:",
		timeline,
		"",
		`Reply with ONLY a JSON object, no prose: {"action":"answer"|"escalate","answers":[...],"reason":"<one short sentence>"}`,
		`When action is answer, "answers" holds one entry per question, in order: {"picks":[<index>]} for a pick-one question, {"picks":[<index>, ...]} for a pick-any question, or {"text":"<one line>"} when no option fits. Mark a question that needs the human {"human":true} and set action to escalate.`,
	)
	return strings.Join(lines, "\n")
}

// renderQuestions lists every question with its answer mode and its options by index.
func renderQuestions(questions []baseds.AgentAskQuestion) string {
	var b strings.Builder
	for qi, q := range questions {
		mode := "pick exactly one"
		if q.MultiSelect {
			mode = "pick one or more"
		}
		b.WriteString(fmt.Sprintf("Question %d (%s): %s\n", qi+1, mode, q.Question))
		b.WriteString("Options (index: label):\n")
		for i, o := range q.Options {
			b.WriteString(fmt.Sprintf("  %d: %s", i, o.Label))
			if o.Description != "" {
				b.WriteString(" — " + o.Description)
			}
			b.WriteString("\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

// recentTimeline renders the last maxTimeline of msgs (a channel's messages, oldest first).
func recentTimeline(msgs []*waveobj.ChannelMessage) string {
	if len(msgs) == 0 {
		return "(none)"
	}
	if len(msgs) > maxTimeline {
		msgs = msgs[len(msgs)-maxTimeline:]
	}
	var b strings.Builder
	for _, m := range msgs {
		b.WriteString(m.Author + ": " + truncateLine(m.Text) + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

// truncateLine caps one message's contribution to the timeline prompt so a pasted log can't crowd
// out the question in a cheap-tier context.
func truncateLine(text string) string {
	runes := []rune(text)
	if len(runes) <= maxTimelineLine {
		return text
	}
	return string(runes[:maxTimelineLine]) + "…"
}

// ParseDecision extracts the JSON object from the reply. ANY problem — no JSON, bad JSON, unknown action,
// action=="answer" without answers, or any question marked for the human — yields escalate. The model can
// never fail open into an auto-answer; whether the answers fit the ask is handleAsk's check.
func ParseDecision(reply string) Decision {
	start := strings.Index(reply, "{")
	end := strings.LastIndex(reply, "}")
	if start < 0 || end <= start {
		return Decision{Action: "escalate", Reason: "unparseable classifier reply"}
	}
	var raw struct {
		Action  string        `json:"action"`
		Answers []judgeAnswer `json:"answers"`
		Reason  string        `json:"reason"`
	}
	if err := json.Unmarshal([]byte(reply[start:end+1]), &raw); err != nil {
		return Decision{Action: "escalate", Reason: "unparseable classifier reply"}
	}
	if raw.Action != "answer" {
		return Decision{Action: "escalate", Reason: raw.Reason}
	}
	if len(raw.Answers) == 0 {
		return Decision{Action: "escalate", Reason: "classifier gave no answers"}
	}
	answers := make([]baseds.AgentAnswerItem, 0, len(raw.Answers))
	for _, a := range raw.Answers {
		// all or nothing: the worker's panel submits every answer at once, so a partial answer would leave the
		// human finishing a half-typed panel
		if a.Human {
			return Decision{Action: "escalate", Reason: raw.Reason}
		}
		answers = append(answers, baseds.AgentAnswerItem{SelectedIndexes: a.Picks, Text: a.Text})
	}
	return Decision{Action: "answer", Answers: answers, Reason: raw.Reason}
}

// Classify runs the headless classifier. It fails safe to escalate on any CLI/timeout error.
func Classify(ctx context.Context, channel *waveobj.Channel, questions []baseds.AgentAskQuestion, task string) Decision {
	// cheap tier: this is a bounded pick-an-option classification, and every failure mode
	// (unparseable reply, no or invalid answers, non-"answer" action) already falls through to
	// escalate — a weaker model degrades toward asking the human, not toward a wrong answer.
	spec, ok := consult.HeadlessSpecForTier(consult.TierCheap)
	if !ok {
		return Decision{Action: "escalate", Reason: "claude CLI unavailable"}
	}
	principles := resolveGatekeeperPrinciples(channel)
	messages, err := wstore.GetChannelMessages(ctx, channel.OID, 0, maxTimeline)
	if err != nil {
		return Decision{Action: "escalate", Reason: "reading the channel timeline: " + err.Error()}
	}
	runCtx, cancel := context.WithTimeout(ctx, classifyTimeout)
	defer cancel()
	reply, err := runFn(runCtx, spec, channel.ProjectPath, BuildClassifyPrompt(questions, task, channel, messages, principles), func(string) {})
	if err != nil {
		return Decision{Action: "escalate", Reason: "classifier error: " + err.Error()}
	}
	return ParseDecision(reply)
}

func resolveGatekeeperPrinciples(channel *waveobj.Channel) waveobj.PrincipleList {
	return ResolveProfile(LoadGlobalProfile(), OverrideFromMeta(channel)).Principles
}

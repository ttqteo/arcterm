// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// Snapshot is the pure input to state derivation: the transcript tail plus the two liveness facts
// the observer owns (file mtime, process alive). Keeping derivation pure over this struct makes the
// state machine unit-testable without touching disk or the process table.
type Snapshot struct {
	Lines       []string  // transcript tail, oldest→newest, non-empty JSONL records
	ModTime     time.Time // transcript file mtime
	Now         time.Time
	ProcAlive   bool          // is the agent's OS process still running
	QuietWindow time.Duration // quiescence before a terminal turn counts as idle (idle hysteresis)
}

// DeriveState computes an agent's state from files + process liveness alone — no hook. Order encodes
// the confidence ranking from the spec: the process-exit floor is absolute; a pending question is a
// strict refinement of working; idle requires BOTH a terminal turn AND quiescence past the window;
// everything else is working.
func DeriveState(s Snapshot) string {
	if !s.ProcAlive {
		return baseds.AgentState_Idle // liveness floor: a dead process is never "working"
	}
	if pendingAsk(s.Lines) {
		return baseds.AgentState_Asking
	}
	if lastRecordTerminal(s.Lines) && s.Now.Sub(s.ModTime) >= s.QuietWindow {
		return baseds.AgentState_Idle
	}
	return baseds.AgentState_Working
}

type contentBlock struct {
	Type      string          `json:"type"`
	ID        string          `json:"id"`          // tool_use
	Name      string          `json:"name"`        // tool_use
	Input     json.RawMessage `json:"input"`       // tool_use
	ToolUseID string          `json:"tool_use_id"` // tool_result
}

type transcriptRecord struct {
	Type    string `json:"type"`
	Message struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

// blocksOf parses a record's message.content into content blocks. Content is either a bare string
// (no blocks) or an array of blocks; a string or parse failure yields nil.
func blocksOf(rec transcriptRecord) []contentBlock {
	var blocks []contentBlock
	if json.Unmarshal(rec.Message.Content, &blocks) != nil {
		return nil
	}
	return blocks
}

func parseRecord(line string) (transcriptRecord, bool) {
	var rec transcriptRecord
	if json.Unmarshal([]byte(strings.TrimSpace(line)), &rec) != nil {
		return rec, false
	}
	return rec, true
}

// lastRecordTerminal reports whether the last record is a finished assistant turn: an assistant
// message with a text block and no pending tool_use. Mirrors the battle-tested check in
// pkg/wshrpc/wshserver/transcript.go (validated across 619 real files). No records / non-assistant
// / a pending tool_use -> false.
func lastRecordTerminal(lines []string) bool {
	if len(lines) == 0 {
		return false
	}
	rec, ok := parseRecord(lines[len(lines)-1])
	if !ok || rec.Type != "assistant" {
		return false
	}
	hasText := false
	for _, b := range blocksOf(rec) {
		if b.Type == "tool_use" {
			return false // a tool call awaits its result: still working
		}
		if b.Type == "text" {
			hasText = true
		}
	}
	return hasText
}

// pendingAsk reports whether an AskUserQuestion tool call is outstanding: a tool_use named
// AskUserQuestion whose id has no matching tool_result later in the tail. That is precisely the
// window in which the agent is blocked waiting on the human.
func pendingAsk(lines []string) bool {
	_, _, ok := openAskCall(lines)
	return ok
}

// openAskCall is the newest AskUserQuestion tool_use in lines that has no tool_result after it: its id and its raw
// input. ok is false when every question has been answered or none was asked.
func openAskCall(lines []string) (id string, input json.RawMessage, ok bool) {
	open := map[string]json.RawMessage{}
	var order []string
	for _, line := range lines {
		rec, parsed := parseRecord(line)
		if !parsed {
			continue
		}
		for _, b := range blocksOf(rec) {
			switch b.Type {
			case "tool_use":
				if b.Name == "AskUserQuestion" && b.ID != "" {
					if _, seen := open[b.ID]; !seen {
						order = append(order, b.ID)
					}
					open[b.ID] = b.Input
				}
			case "tool_result":
				delete(open, b.ToolUseID)
			}
		}
	}
	for i := len(order) - 1; i >= 0; i-- {
		if in, still := open[order[i]]; still {
			return order[i], in, true
		}
	}
	return "", nil, false
}

// AskOpen reports whether the transcript at path holds an AskUserQuestion call with no result yet: the
// agent's question dialog is still on screen. The whole transcript is read, since the tools called beside
// a question write their results after it and can push it out of any tail.
func AskOpen(path string) (bool, error) {
	tail, err := ReadTail(path, 0)
	if err != nil {
		return false, err
	}
	return pendingAsk(tail.Lines), nil
}

// OpenAsk is AskOpen with the question itself: the tool_use id of the newest AskUserQuestion call that has no result
// yet, and its questions decoded from the call's input as the `wsh ask` hook would have sent them. A hook that was
// cancelled before it registered the question leaves the transcript as the only place it is written down. ok is
// false when no question is open, and when the open call carries no question a person could be shown.
func OpenAsk(path string) (toolUseId string, questions []baseds.AgentAskQuestion, ok bool, err error) {
	tail, err := ReadTail(path, 0)
	if err != nil {
		return "", nil, false, err
	}
	toolUseId, questions, ok = OpenAskLines(tail.Lines)
	return toolUseId, questions, ok, nil
}

// OpenAskLines is OpenAsk for a transcript already read, so a caller that also reads something else out of the same
// lines (the engine's stall check looks for a live background shell) pays one read of the file.
func OpenAskLines(lines []string) (toolUseId string, questions []baseds.AgentAskQuestion, ok bool) {
	id, input, open := openAskCall(lines)
	if !open {
		return "", nil, false
	}
	var in struct {
		Questions []struct {
			Question    string `json:"question"`
			Header      string `json:"header"`
			MultiSelect bool   `json:"multiSelect"`
			Options     []struct {
				Label       string `json:"label"`
				Description string `json:"description"`
				Preview     string `json:"preview"`
			} `json:"options"`
		} `json:"questions"`
	}
	if json.Unmarshal(input, &in) != nil || len(in.Questions) == 0 {
		return "", nil, false
	}
	questions = make([]baseds.AgentAskQuestion, len(in.Questions))
	for i, q := range in.Questions {
		var opts []baseds.AgentAskOption
		if len(q.Options) > 0 {
			opts = make([]baseds.AgentAskOption, len(q.Options))
		}
		for j, o := range q.Options {
			opts[j] = baseds.AgentAskOption{Label: o.Label, Description: o.Description, Preview: o.Preview}
		}
		questions[i] = baseds.AgentAskQuestion{Question: q.Question, Header: q.Header, MultiSelect: q.MultiSelect, Options: opts}
	}
	return id, questions, true
}

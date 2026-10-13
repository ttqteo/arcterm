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
	Type      string `json:"type"`
	ID        string `json:"id"`          // tool_use
	Name      string `json:"name"`        // tool_use
	ToolUseID string `json:"tool_use_id"` // tool_result
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
	askIDs := map[string]bool{}
	for _, line := range lines {
		rec, ok := parseRecord(line)
		if !ok {
			continue
		}
		for _, b := range blocksOf(rec) {
			switch b.Type {
			case "tool_use":
				if b.Name == "AskUserQuestion" && b.ID != "" {
					askIDs[b.ID] = true
				}
			case "tool_result":
				delete(askIDs, b.ToolUseID)
			}
		}
	}
	return len(askIDs) > 0
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

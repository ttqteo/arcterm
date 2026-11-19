// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boardforward

import (
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
)

const (
	markerHead = `[From board "`
	markerTurn = " · turn "
	markerEnd  = "]"

	// agentsessions.Turn's speakers
	speakerUser  = "user"
	speakerAgent = "agent"
)

// Marker is the text typed into the agent for a forwarded turn: a first line naming the board, the selected labels
// and the turn, then the question. The frontend's parser mirrors this format. The first line starts with "[", so a
// board named like a command can never make the message a slash command.
func Marker(board, on, turnId, question string) string {
	head := markerHead + oneLine(board) + `"`
	if on = oneLine(on); on != "" {
		head += " · on " + on
	}
	return head + markerTurn + turnId + markerEnd + "\n" + question
}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// marks says text is the forward of turnId: its first line is that turn's marker. The board name is not escaped,
// so the turn id is read from the line's end.
func marks(text, turnId string) bool {
	first, _, _ := strings.Cut(text, "\n")
	return strings.HasPrefix(first, markerHead) && strings.HasSuffix(first, markerTurn+turnId+markerEnd)
}

// ReplyAfter is the agent's reply to the forward of turnId: the last agent text after the user entry the forward's
// marker heads and before the next user entry. No such entry, or no agent text after it yet, is not found.
func ReplyAfter(turns []agentsessions.Turn, turnId string) (reply string, ts int64, ok bool) {
	start := -1
	for i, t := range turns {
		if t.Speaker == speakerUser && marks(t.Text, turnId) {
			start = i
		}
	}
	if start < 0 {
		return "", 0, false
	}
	for _, t := range turns[start+1:] {
		if t.Speaker == speakerUser {
			break
		}
		if t.Speaker == speakerAgent {
			reply, ts, ok = t.Text, t.Ts, true
		}
	}
	return reply, ts, ok
}

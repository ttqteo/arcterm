// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/council"
)

// What Setup's Auto-generate reads of each seated agent: its last autoPromptsKept prompts, each cut to its first
// autoPromptRunes, and its last reply cut to its last autoReplyRunes, so a four-agent Setup sends about 4k tokens. A
// reply usually lands on what it concluded or asks, which is why it keeps its end and a prompt keeps its start.
const (
	autoPromptsKept = 3
	autoPromptRunes = 600
	autoReplyRunes  = 1500
	autoClipMark    = "…"
)

// clipAutogenHead keeps the first n runes of s and marks the cut with …; a shorter s comes back whole.
func clipAutogenHead(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	end := 0
	for range n {
		_, w := utf8.DecodeRuneInString(s[end:])
		end += w
	}
	return s[:end] + autoClipMark
}

// clipAutogenTail keeps the last n runes of s and marks the cut with …; a shorter s comes back whole.
func clipAutogenTail(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	start := len(s)
	for range n {
		_, w := utf8.DecodeLastRuneInString(s[:start])
		start -= w
	}
	return autoClipMark + s[start:]
}

// conversationFrom is what Auto-generate reads of one agent's transcript: its last prompts that carry text, clipped,
// oldest first, and its last reply, clipped. false when the transcript holds no prompt to read, or the harness is one
// agentsessions reads nothing of.
func conversationFrom(name, harness, path string) (council.AgentConversation, bool) {
	var texts []string
	for _, p := range agentsessions.HumanPrompts(path, harness) {
		if t := strings.TrimSpace(p.Text); t != "" {
			texts = append(texts, t)
		}
	}
	if len(texts) == 0 {
		return council.AgentConversation{}, false
	}
	if len(texts) > autoPromptsKept {
		texts = texts[len(texts)-autoPromptsKept:]
	}
	for i, t := range texts {
		texts[i] = clipAutogenHead(t, autoPromptRunes)
	}
	reply, _ := agentsessions.LastAnswer(path, harness)
	return council.AgentConversation{
		Name: name, Harness: harness, Prompts: texts,
		Reply: clipAutogenTail(strings.TrimSpace(reply), autoReplyRunes),
	}, true
}

// gatherConversations reads the conversation of each seated agent, in seat order, the way a council's live-agent link
// finds a seat: the roster, then the transcript. A tab that is not a live claude or pi agent, whose transcript is
// missing or unreadable, or that has no prompt, is skipped and the rest are still read.
func gatherConversations(ctx context.Context, tabIds []string) []council.AgentConversation {
	var out []council.AgentConversation
	for _, tab := range tabIds {
		_, row, err := liveAgentLink{}.find(ctx, tab)
		if err != nil {
			continue
		}
		path, err := agentTranscriptPath(ctx, row)
		if err != nil || path == "" {
			continue
		}
		if conv, ok := conversationFrom(row.Name, row.Harness, path); ok {
			out = append(out, conv)
		}
	}
	return out
}

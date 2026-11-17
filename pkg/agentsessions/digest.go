// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import "github.com/wavetermdev/waveterm/pkg/pisession"

const (
	speakerUser  = "user"
	speakerAgent = "agent"
)

// Turn is one entry of a session's text digest: a prompt a person typed or a text reply of the agent. The
// digest is what search reads, so it keeps what a person reads in the conversation and skips tool calls,
// tool output, thinking and subagent turns. A digest is written to disk as JSON, so the tags are its file format.
type Turn struct {
	Speaker string `json:"speaker"` // "user" | "agent"
	Text    string `json:"text"`
	Ts      int64  `json:"ts"` // the transcript's own time (UnixMilli)
}

// claudeTurns is a claude transcript's digest, by HumanPrompts' rules for prompts and LastAnswer's for replies.
func claudeTurns(recs []claudeLine) []Turn {
	var out []Turn
	for _, rec := range recs {
		if text := claudeTypedText(rec); text != "" {
			out = append(out, Turn{Speaker: speakerUser, Text: text, Ts: parseTs(rec.Timestamp)})
		} else if text := claudeReplyText(rec); text != "" {
			out = append(out, Turn{Speaker: speakerAgent, Text: text, Ts: parseTs(rec.Timestamp)})
		}
	}
	return out
}

// piTurns is a pi session's digest, read off the active branch as HumanPrompts and LastAnswer read it.
func piTurns(file *pisession.File) []Turn {
	branch, err := file.ActiveBranch()
	if err != nil {
		return nil
	}
	var out []Turn
	for _, e := range branch {
		if text := piTypedText(e); text != "" {
			out = append(out, Turn{Speaker: speakerUser, Text: text, Ts: parseTs(e.Timestamp)})
		} else if text := piReplyText(e); text != "" {
			out = append(out, Turn{Speaker: speakerAgent, Text: text, Ts: parseTs(e.Timestamp)})
		}
	}
	return out
}

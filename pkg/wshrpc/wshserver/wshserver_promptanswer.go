// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

// A permission prompt reports waiting (Claude's permission_prompt Notification, Codex's PermissionRequest), and no
// hook fires between the person's answer and the end of the tool it granted: Claude's PreToolUse runs before the
// prompt and its PostToolUse after the tool. A granted command that ran for a minute read "asking" all that time.
// The answer is a key typed into the agent's own terminal, so the input path reports it.

// answersPrompt reports whether one terminal input is a key that answers a prompt: Enter takes the selected
// choice and a digit picks one. Esc is not: it cancels the turn, which reports idle itself.
func answersPrompt(input []byte) bool {
	if len(input) != 1 {
		return false
	}
	c := input[0]
	return c == '\r' || (c >= '1' && c <= '9')
}

// answeredStatus is the working a waiting agent reads once its prompt is answered: its retained status with the
// new state and time, so the roster keeps its title. Pure, over the scope's last status.
func answeredStatus(last baseds.AgentStatusData, now int64) (baseds.AgentStatusData, bool) {
	if last.State != baseds.AgentState_Waiting {
		return last, false
	}
	next := last
	next.State = baseds.AgentState_Working
	next.Detail = ""
	next.Hook = ""
	next.Step = ""
	next.Committed = false
	next.Edited = false
	next.Usage = nil
	// a tool key belongs to the one PostToolUse report that carried it; a copy would retire a permission request again
	next.ToolKey = ""
	next.Ts = now
	return next, true
}

// noteBlockInput applies a key typed into a block's terminal: it settles the block's pending permission requests,
// and reports working for a waiting agent whose terminal took a key that answers its prompt.
func noteBlockInput(ctx context.Context, blockId string, input []byte) {
	if blockId == "" {
		return
	}
	oref := waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	// before the answersPrompt gate: Esc answers no prompt, but it rejects a permission request
	notePermissionKey(oref, input)
	if !answersPrompt(input) {
		return
	}
	reportPromptAnswered(ctx, oref)
}

// reportPromptAnswered publishes working for oref's agent if its last status is waiting: its prompt was just
// answered, and no hook fires until the tool it granted ends. The chat's Allow reports through here as well, since
// it types its key without going through noteBlockInput.
func reportPromptAnswered(ctx context.Context, oref string) {
	for _, prev := range wps.Broker.ReadEventHistory(wps.Event_AgentStatus, oref, 1) {
		var last baseds.AgentStatusData
		if utilfn.ReUnmarshal(&last, prev.Data) != nil {
			continue
		}
		if next, ok := answeredStatus(last, time.Now().UnixMilli()); ok {
			publishEvent(ctx, wps.WaveEvent{
				Event:   wps.Event_AgentStatus,
				Scopes:  []string{oref},
				Persist: 1,
				Data:    next,
			})
		}
	}
}

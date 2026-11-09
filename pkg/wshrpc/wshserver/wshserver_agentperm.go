// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentperm"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The three commands of the chat view's permission card; pkg/agentperm holds the queue.

// permAllowKey and permDenyKey are what Claude Code's permission prompt takes: `1` is its first choice, Yes, and Esc
// rejects the request (and ends the turn).
const (
	permAllowKey       = "1"
	permAllowSecondKey = "2" // the second option: Yes, and don't ask again
	permDenyKey        = "\x1b"
)

// errNotAnswerable is the refusal of an Allow on a prompt whose choices the chat does not know (ExitPlanMode's plan
// menu, an MCP tool's): the person answers it in the terminal.
var errNotAnswerable = errors.New("this prompt is answered in the terminal")

// permLock makes changing a queue and publishing its snapshot one step, so two changes cannot publish in the
// other order from the one they were taken in (the card would then show a queue the registry already dropped).
// Answer holds it from the claim to the drop, so a double click cannot answer the next prompt too.
var permLock sync.Mutex

// permSendInput is indirected so tests can capture the typed key without a live block PTY.
var permSendInput = func(blockId string, data []byte) error {
	return blockcontroller.SendInput(blockId, &blockcontroller.BlockInputUnion{InputData: data})
}

// publishAgentPermission publishes oref's whole queue as Event_AgentPermission, persisted so a pane that mounts
// later reads it. Callers hold permLock.
func publishAgentPermission(oref string) {
	wps.Broker.Publish(wps.WaveEvent{
		Event:   wps.Event_AgentPermission,
		Scopes:  []string{oref},
		Persist: 1,
		Data:    baseds.AgentPermissionData{ORef: oref, Requests: agentperm.GlobalRegistry.Snapshot(oref)},
	})
}

// updatePermission runs a queue change and publishes the snapshot when it reports the queue changed.
func updatePermission(oref string, change func() bool) {
	permLock.Lock()
	defer permLock.Unlock()
	if change() {
		publishAgentPermission(oref)
	}
}

func (ws *WshServer) AgentPermissionRaiseCommand(ctx context.Context, data wshrpc.CommandAgentPermissionRaiseData) error {
	if data.ORef == "" {
		return fmt.Errorf("oref is required")
	}
	if data.ToolName == "" {
		return fmt.Errorf("toolname is required")
	}
	updatePermission(data.ORef, func() bool {
		agentperm.GlobalRegistry.Raise(data.ORef, data.ToolName, data.ToolInput, time.Now().UnixMilli())
		return true
	})
	return nil
}

func (ws *WshServer) AgentPermissionAnswerCommand(ctx context.Context, data wshrpc.CommandAgentPermissionAnswerData) error {
	if data.ORef == "" || data.Id == "" {
		return fmt.Errorf("oref and id are required")
	}
	oref, err := waveobj.ParseORef(data.ORef)
	if err != nil || oref.OType != waveobj.OType_Block {
		return fmt.Errorf("invalid block oref %q", data.ORef)
	}
	if err := answerPermission(data, oref.OID); err != nil {
		return err
	}
	// after the queue's lock is released: the status publish passes the same intercept
	if data.Allow {
		reportPromptAnswered(ctx, data.ORef)
	}
	return nil
}

// answerPermission types the answer into the block when the request is the head of its queue, and only then drops
// it: a refused or failed answer leaves the queue as it was.
func answerPermission(data wshrpc.CommandAgentPermissionAnswerData, blockId string) error {
	if data.Choice < 0 || data.Choice > 2 {
		return fmt.Errorf("choice %d is out of range: 0, 1 or 2", data.Choice)
	}
	permLock.Lock()
	defer permLock.Unlock()
	req, ok := agentperm.GlobalRegistry.ClaimHead(data.ORef, data.Id)
	if !ok {
		return agentperm.ErrNotPending
	}
	if data.Allow && !req.Answerable {
		return errNotAnswerable
	}
	key := permDenyKey
	if data.Allow {
		key = permAllowKey
		if data.Choice == 2 {
			key = permAllowSecondKey
		}
	}
	if err := permSendInput(blockId, []byte(key)); err != nil {
		return fmt.Errorf("typing the answer: %w", err)
	}
	// Esc on the prompt rejects the request and ends the turn, so the rest of the queue goes with it
	if data.Allow {
		agentperm.GlobalRegistry.AnswerHead(data.ORef)
	} else {
		agentperm.GlobalRegistry.DropAll(data.ORef)
	}
	publishAgentPermission(data.ORef)
	return nil
}

func (ws *WshServer) AgentPermissionPendingCommand(ctx context.Context, oref string) (baseds.AgentPermissionData, error) {
	if oref == "" {
		return baseds.AgentPermissionData{}, fmt.Errorf("oref is required")
	}
	return baseds.AgentPermissionData{ORef: oref, Requests: agentperm.GlobalRegistry.Snapshot(oref)}, nil
}

// notePermissionStatus applies a status report on its way through publishEvent to the permission queue: a Stop,
// UserPromptSubmit or SessionStart drops it, a PostToolUse carrying a tool key retires the request it granted.
func notePermissionStatus(ev *wps.WaveEvent) {
	var data baseds.AgentStatusData
	if utilfn.ReUnmarshal(&data, ev.Data) != nil || data.ORef == "" {
		return
	}
	updatePermission(data.ORef, func() bool { return agentperm.NoteStatus(&data) })
}

// notePermissionKey applies one input typed into a block's terminal to its permission queue.
func notePermissionKey(oref string, input []byte) {
	updatePermission(oref, func() bool { return agentperm.NoteKey(oref, input) })
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/ideastore"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var errNoIdeaSession = errors.New("no agent session in this terminal yet")

// resolveIdeaSession names the session a command targets: a session id wins, else the block's agent session,
// the transcript file's name without ".jsonl".
func resolveIdeaSession(ctx context.Context, target wshrpc.CommandIdeaTargetData) (string, error) {
	if target.SessionId != "" {
		return target.SessionId, nil
	}
	if target.BlockId == "" {
		return "", errors.New("an idea command needs a block id or a session id")
	}
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, target.BlockId)
	if err != nil {
		return "", fmt.Errorf("loading block %s: %w", target.BlockId, err)
	}
	session := agentobserve.TranscriptSession(block.Meta.GetString(waveobj.MetaKey_AgentTranscriptPath, ""))
	if session == "" {
		return "", errNoIdeaSession
	}
	return session, nil
}

func publishIdeasChanged(sessionId string) {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_IdeasChanged, Data: wshrpc.IdeasChangedData{SessionId: sessionId}})
}

func (ws *WshServer) IdeaAddCommand(ctx context.Context, data wshrpc.CommandIdeaAddData) (*ideastore.Idea, error) {
	session, err := resolveIdeaSession(ctx, data.CommandIdeaTargetData)
	if err != nil {
		return nil, err
	}
	idea, err := ideastore.Add(session, data.Text, data.Kind, data.By)
	if err != nil {
		return nil, err
	}
	publishIdeasChanged(session)
	return &idea, nil
}

func (ws *WshServer) IdeaListCommand(ctx context.Context, data wshrpc.CommandIdeaTargetData) (*ideastore.SessionIdeas, error) {
	session, err := resolveIdeaSession(ctx, data)
	if err != nil {
		return nil, err
	}
	ideas, err := ideastore.List(session)
	if err != nil {
		return nil, err
	}
	return &ideas, nil
}

func (ws *WshServer) IdeaUpdateCommand(ctx context.Context, data wshrpc.CommandIdeaUpdateData) error {
	session, err := resolveIdeaSession(ctx, data.CommandIdeaTargetData)
	if err != nil {
		return err
	}
	op := ideastore.Op{Kind: data.Op, Ids: data.Ids, Text: data.Text, NewKind: data.NewKind}
	if err := ideastore.Update(session, op); err != nil {
		return err
	}
	publishIdeasChanged(session)
	return nil
}

// IdeaTickCommand counts one more prompt in the session. A nudge changes the session's file (it restarts the
// gap), so it publishes; a tick that only counts does not, or every prompt would refetch the rail.
func (ws *WshServer) IdeaTickCommand(ctx context.Context, data wshrpc.CommandIdeaTargetData) (*wshrpc.CommandIdeaTickRtnData, error) {
	session, err := resolveIdeaSession(ctx, data)
	if err != nil {
		return nil, err
	}
	nudge, err := ideastore.Tick(session)
	if err != nil {
		return nil, err
	}
	if nudge != "" {
		publishIdeasChanged(session)
	}
	return &wshrpc.CommandIdeaTickRtnData{Nudge: nudge}, nil
}

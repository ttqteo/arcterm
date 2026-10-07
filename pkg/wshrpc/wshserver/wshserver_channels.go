// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func (ws *WshServer) CreateChannelCommand(ctx context.Context, data wshrpc.CommandCreateChannelData) (*waveobj.Channel, error) {
	// One channel per project: the channel is storage for "work in this project", and the cockpit labels
	// every channel with its project's name, so a second one at the same path is a row the user cannot
	// tell from the first. Mirrors wconfig.ProjectNameAtPath, which already refuses a second project at
	// one path. Returning the existing channel rather than an error is deliberate — two windows racing
	// the frontend's find-or-create both want the same end state, and an error there is a failed launch.
	if strings.TrimSpace(data.ProjectPath) == "" {
		ch, err := wstore.CreateChannel(ctx, data.Name, "")
		if err != nil {
			return nil, fmt.Errorf("creating channel: %w", err)
		}
		return ch, nil
	}
	ch, err := wstore.EnsureChannelAtPath(ctx, data.Name, data.ProjectPath)
	if err != nil {
		return nil, fmt.Errorf("creating channel: %w", err)
	}
	return ch, nil
}

// SyncProjectChannels gives every registered project a channel, so the registry is the one project list:
// surfaces that act on a channel (run defaults, autonomy, Jarvis replies) see a project before its first
// run. Runs at startup and on every config change; idempotent. A failure is logged per project rather than
// returned — one bad entry must not stop the rest, and the next config change retries it.
func SyncProjectChannels(ctx context.Context, projects map[string]wconfig.ProjectKeywords) {
	for name, p := range projects {
		if strings.TrimSpace(p.Path) == "" {
			continue
		}
		if _, err := wstore.EnsureChannelAtPath(ctx, name, p.Path); err != nil {
			log.Printf("project %q: ensuring its channel: %v\n", name, err)
		}
	}
}

func (ws *WshServer) DeleteChannelCommand(ctx context.Context, data wshrpc.CommandDeleteChannelData) error {
	if err := wstore.DeleteChannel(ctx, data.ChannelId); err != nil {
		return fmt.Errorf("deleting channel: %w", err)
	}
	return nil
}

func (ws *WshServer) GetChannelsCommand(ctx context.Context) (*wshrpc.CommandGetChannelsRtnData, error) {
	chans, err := wstore.GetChannels(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing channels: %w", err)
	}
	return &wshrpc.CommandGetChannelsRtnData{Channels: chans}, nil
}

func (ws *WshServer) GetChannelRunsCommand(ctx context.Context, data wshrpc.CommandGetChannelRunsData) (*wshrpc.CommandGetChannelRunsRtnData, error) {
	runs, err := wstore.GetChannelRuns(ctx, data.ChannelId)
	if err != nil {
		return nil, fmt.Errorf("getting channel runs: %w", err)
	}
	return &wshrpc.CommandGetChannelRunsRtnData{Runs: runs}, nil
}

func (ws *WshServer) GetChannelRunChangesCommand(ctx context.Context, data wshrpc.CommandGetChannelRunChangesData) (*wshrpc.CommandGetChannelRunChangesRtnData, error) {
	ids, runs, err := wstore.GetChannelRunChanges(ctx, data.ChannelId, data.Known)
	if err != nil {
		return nil, fmt.Errorf("getting channel run changes: %w", err)
	}
	return &wshrpc.CommandGetChannelRunChangesRtnData{RunIds: ids, Runs: runs}, nil
}

func (ws *WshServer) GetChannelMessagesCommand(ctx context.Context, data wshrpc.CommandGetChannelMessagesData) (*wshrpc.CommandGetChannelMessagesRtnData, error) {
	msgs, err := wstore.GetChannelMessages(ctx, data.ChannelId, data.Before, data.Limit)
	if err != nil {
		return nil, fmt.Errorf("getting channel messages: %w", err)
	}
	return &wshrpc.CommandGetChannelMessagesRtnData{Messages: msgs}, nil
}

func (ws *WshServer) PostChannelMessageCommand(ctx context.Context, data wshrpc.CommandPostChannelMessageData) (*waveobj.ChannelMessage, error) {
	if data.Data != "" && !json.Valid([]byte(data.Data)) {
		return nil, fmt.Errorf("posting channel message: data is not valid JSON")
	}
	msg := wstore.NewChannelMessage(data.Kind, data.Author, data.Text, data.RefORef, time.Now().UnixMilli())
	msg.Data = data.Data
	stored, err := wstore.PostChannelMessage(ctx, data.ChannelId, msg)
	if err != nil {
		return nil, fmt.Errorf("posting channel message: %w", err)
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, data.ChannelId))
	return stored, nil
}

func (ws *WshServer) SetChannelTierCommand(ctx context.Context, data wshrpc.CommandSetChannelTierData) error {
	if data.ChannelId == "" {
		return fmt.Errorf("channelid is required")
	}
	gk, err := jarvis.GatekeeperForTier(data.Tier)
	if err != nil {
		return err
	}
	err = wstore.DBUpdateFn(ctx, data.ChannelId, func(ch *waveobj.Channel) {
		if ch.Meta == nil {
			ch.Meta = make(waveobj.MetaMapType)
		}
		ch.Meta[jarvis.MetaKey_GatekeeperEnabled] = gk
	})
	if err != nil {
		return fmt.Errorf("updating channel tier: %w", err)
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, data.ChannelId))
	return nil
}

func (ws *WshServer) SetChannelReadCommand(ctx context.Context, data wshrpc.CommandSetChannelReadData) error {
	if data.ChannelId == "" {
		return fmt.Errorf("channelid is required")
	}
	if err := wstore.SetChannelRead(ctx, data.ChannelId, data.Ts); err != nil {
		return fmt.Errorf("updating channel read ts: %w", err)
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, data.ChannelId))
	return nil
}

func (ws *WshServer) SetChannelProfileCommand(ctx context.Context, data wshrpc.CommandSetChannelProfileData) error {
	if data.ChannelId == "" {
		return fmt.Errorf("channelid is required")
	}
	if data.Override != nil && data.Override.Route != nil {
		if _, err := runroute.Resolve(*data.Override.Route); err != nil {
			return fmt.Errorf("validating route: %w", err)
		}
	}
	if err := validateEngineDefaults(data.Override); err != nil {
		return fmt.Errorf("validating engine defaults: %w", err)
	}
	if data.Override != nil && data.Override.Principles != nil {
		global := jarvis.LoadGlobalProfile()
		// a legacy string arriving from an old client becomes a structured patch before validation/storage.
		patch := jarvis.NormalizePrinciplePatch(global.Principles, data.Override.Principles)
		if err := jarvis.ValidatePrinciplePatch(global.Principles, patch); err != nil {
			return fmt.Errorf("validating principle patch: %w", err)
		}
		if patch.IsEmpty() {
			patch = nil
		}
		data.Override.Principles = patch
	}
	empty := jarvis.ProfileOverrideIsEmpty(data.Override)
	err := wstore.DBUpdateFn(ctx, data.ChannelId, func(ch *waveobj.Channel) {
		if ch.Meta == nil {
			ch.Meta = make(waveobj.MetaMapType)
		}
		if empty {
			delete(ch.Meta, jarvis.MetaKey_JarvisProfile)
		} else {
			ch.Meta[jarvis.MetaKey_JarvisProfile] = data.Override
		}
	})
	if err != nil {
		return fmt.Errorf("updating channel profile: %w", err)
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, data.ChannelId))
	return nil
}

func (ws *WshServer) GetAttentionCommand(ctx context.Context) (*wshrpc.CommandGetAttentionRtnData, error) {
	items, err := jarvis.GatherAttention(ctx)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandGetAttentionRtnData{Items: items}, nil
}

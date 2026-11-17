// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func waitingBlockInfo(info map[string][2]string) func(string) (string, string) {
	return func(oref string) (string, string) {
		v := info[oref]
		return v[0], v[1]
	}
}

func TestBuildWaiting(t *testing.T) {
	q := []baseds.AgentAskQuestion{{Question: "Which?", Header: "Pick", Options: []baseds.AgentAskOption{{Label: "A"}}}}
	items := []wshrpc.AttentionItem{
		{Kind: jarvis.AttentionRunLandHeld, Key: "held:r1", Source: "Ship it", ChannelName: "arc", Text: "Run held", Reason: "merge conflict in go.mod", WaitingSince: 100},
		{Kind: jarvis.AttentionAsk, Key: "ask:block:new", Source: "worker-2", ChannelName: "arc", WaitingSince: 1},
		{Kind: jarvis.AttentionAsk, Key: "ask:block:gone", Source: "worker-3", ChannelName: "arc"},
		{Kind: jarvis.AttentionAsk, Key: "ask:block:solo", Source: "claude", WaitingSince: 2},
		{Kind: "unverified", Key: "unv:r2", Source: "Fix login", ChannelName: "web", Text: "Run finished unverified", WaitingSince: 50},
	}
	asks := map[string]agentask.PendingAsk{
		"block:new":  {AskId: "a-new", Questions: q, Ts: 300},
		"block:solo": {AskId: "a-solo", Questions: q, Ts: 200, Prose: true},
	}
	info := waitingBlockInfo(map[string][2]string{
		"block:new":  {"pi", "ignored-since-channel-wins"},
		"block:solo": {"claude", "waveterm"},
	})

	got := BuildWaiting(items, asks, info)

	wantQ := []WaitingQuestion{
		{Key: "ask:block:solo", ORef: "block:solo", AskId: "a-solo", Source: "claude", Project: "waveterm", Runtime: "claude", WaitingSince: 200, Prose: true, Questions: q},
		{Key: "ask:block:new", ORef: "block:new", AskId: "a-new", Source: "worker-2", Project: "arc", Runtime: "pi", WaitingSince: 300, Questions: q},
	}
	wantS := []WaitingShown{
		{Key: "held:r1", Kind: jarvis.AttentionRunLandHeld, Title: "Ship it", Project: "arc", WaitingSince: 100, Reason: "merge conflict in go.mod"},
		{Key: "unv:r2", Kind: "unverified", Title: "Fix login", Project: "web", WaitingSince: 50, Reason: "Run finished unverified"},
	}
	if !reflect.DeepEqual(got.Questions, wantQ) {
		t.Errorf("questions:\n got %+v\nwant %+v", got.Questions, wantQ)
	}
	if !reflect.DeepEqual(got.Shown, wantS) {
		t.Errorf("shown:\n got %+v\nwant %+v", got.Shown, wantS)
	}
}

func TestBuildWaitingEmptyIsNotNull(t *testing.T) {
	got := BuildWaiting(nil, nil, waitingBlockInfo(nil))
	if got.Questions == nil || got.Shown == nil {
		t.Fatalf("want empty slices so the json carries [], got %+v", got)
	}
}

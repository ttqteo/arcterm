// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// waitingAskPrefix is how jarvis keys an ask item: "ask:" + the block oref.
const waitingAskPrefix = jarvis.AttentionAsk + ":"

// WaitingList is what GET /api/waiting returns. The handler fills VapidPublic.
type WaitingList struct {
	VapidPublic string            `json:"vapidpublic"`
	Questions   []WaitingQuestion `json:"questions"`
	Shown       []WaitingShown    `json:"shown"`
	// Handed is filled by the handler from Deps.Handed
	Handed []HandedAgent `json:"handed"`
}

// WaitingQuestion is an agent question the phone can answer.
type WaitingQuestion struct {
	Key          string                    `json:"key"`
	ORef         string                    `json:"oref"`
	AskId        string                    `json:"askid"`
	Source       string                    `json:"source"`
	Project      string                    `json:"project"`
	Runtime      string                    `json:"runtime"`
	WaitingSince int64                     `json:"waitingsince"`
	Prose        bool                      `json:"prose"`
	Questions    []baseds.AgentAskQuestion `json:"questions"`
}

// WaitingShown is a waiting item the phone shows but cannot act on.
type WaitingShown struct {
	Key          string `json:"key"`
	Kind         string `json:"kind"`
	Title        string `json:"title"`
	Project      string `json:"project"`
	WaitingSince int64  `json:"waitingsince"`
	Reason       string `json:"reason"`
}

// BuildWaiting joins the attention list with the pending asks. An ask item whose ask is no longer
// pending is dropped: the phone could not answer it. blockInfo gives a block's agent runtime and project,
// the project being the fallback for a standalone agent that has no channel.
func BuildWaiting(items []wshrpc.AttentionItem, asks map[string]agentask.PendingAsk, blockInfo func(oref string) (runtime, project string)) WaitingList {
	list := WaitingList{Questions: []WaitingQuestion{}, Shown: []WaitingShown{}}
	for _, it := range items {
		if it.Kind != jarvis.AttentionAsk {
			list.Shown = append(list.Shown, waitingShownFrom(it))
			continue
		}
		oref := strings.TrimPrefix(it.Key, waitingAskPrefix)
		p, ok := asks[oref]
		if !ok {
			continue
		}
		runtime, project := blockInfo(oref)
		if it.ChannelName != "" {
			project = it.ChannelName
		}
		list.Questions = append(list.Questions, WaitingQuestion{
			Key:          it.Key,
			ORef:         oref,
			AskId:        p.AskId,
			Source:       it.Source,
			Project:      project,
			Runtime:      runtime,
			WaitingSince: p.Ts,
			Prose:        p.Prose,
			Questions:    p.Questions,
		})
	}
	sort.SliceStable(list.Questions, func(i, j int) bool {
		return list.Questions[i].WaitingSince < list.Questions[j].WaitingSince
	})
	return list
}

func waitingShownFrom(it wshrpc.AttentionItem) WaitingShown {
	reason := it.Reason
	if reason == "" {
		reason = it.Text
	}
	return WaitingShown{
		Key:          it.Key,
		Kind:         it.Kind,
		Title:        it.Source,
		Project:      it.ChannelName,
		WaitingSince: it.WaitingSince,
		Reason:       reason,
	}
}

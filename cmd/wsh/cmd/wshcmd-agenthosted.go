// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// statusTarget is the block a Claude session reports into (status, usage, ask cards): the tab that shows it. For a
// session running directly in a terminal that is the block from the environment, unchanged. For one hosted by the
// Claude daemon it is the tab attached to it (agentobserve.HostedDisplayBlock), and drop is true when no tab is
// attached: the environment's block is the tab that first started the daemon, so reporting there is the bug.
func statusTarget(envORef *waveobj.ORef) (target *waveobj.ORef, drop bool) {
	block, hosted := agentobserve.HostedDisplayBlock()
	if !hosted {
		return envORef, false
	}
	if block == "" {
		return nil, true
	}
	oref := waveobj.MakeORef(waveobj.OType_Block, block)
	return &oref, false
}

// staleStatus is what to publish to the environment's tab once a hosted session reports elsewhere: that tab's
// retained status, idled, when it is still this session's and not idle. Anything else there (another session the
// tab runs now, or nothing) is left alone. Pure, over the tab's status history.
func staleStatus(history []baseds.AgentStatusData, transcriptPath string, now int64) (baseds.AgentStatusData, bool) {
	var last *baseds.AgentStatusData
	for i := range history {
		if history[i].State != "" {
			last = &history[i]
		}
	}
	if last == nil || transcriptPath == "" || last.TranscriptPath != transcriptPath || last.State == baseds.AgentState_Idle {
		return baseds.AgentStatusData{}, false
	}
	idled := *last
	idled.State = baseds.AgentState_Idle
	idled.Detail = ""
	idled.Ts = now
	return idled, true
}

// releaseStaleStatus idles the environment's tab when it still shows this hosted session working, so the tab the
// session left does not read "working" until it is closed. Best-effort, like every other hook write.
func releaseStaleStatus(envORef, target *waveobj.ORef, transcriptPath string) {
	if envORef == nil || target == nil || envORef.String() == target.String() || transcriptPath == "" {
		return
	}
	events, err := wshclient.EventReadHistoryCommand(RpcClient, wshrpc.CommandEventReadHistoryData{
		Event: wps.Event_AgentStatus, Scope: envORef.String(), MaxItems: 50,
	}, &wshrpc.RpcOpts{Timeout: agentStatusPublishTimeoutMs})
	if err != nil {
		return
	}
	history := make([]baseds.AgentStatusData, 0, len(events))
	for _, ev := range events {
		b, err := json.Marshal(ev.Data)
		if err != nil {
			continue
		}
		var data baseds.AgentStatusData
		if json.Unmarshal(b, &data) == nil {
			history = append(history, data)
		}
	}
	if idled, ok := staleStatus(history, transcriptPath, time.Now().UnixMilli()); ok {
		_ = publishAgentStatusData(envORef, idled, 1)
	}
}

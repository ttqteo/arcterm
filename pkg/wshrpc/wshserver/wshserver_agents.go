// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentctl"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/bgagents"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func (ws *WshServer) GetSessionGroupCommand(ctx context.Context, data wshrpc.CommandGetSessionGroupData) (*wshrpc.CommandGetSessionGroupRtnData, error) {
	if data.Cwd == "" {
		return nil, fmt.Errorf("cwd is required")
	}
	return resolveSessionGroup(data.Cwd), nil
}

func (ws *WshServer) GetAgentTranscriptCommand(ctx context.Context, data wshrpc.CommandGetAgentTranscriptData) (*wshrpc.CommandGetAgentTranscriptRtnData, error) {
	read := readTranscriptTail
	if data.FromStart {
		read = readTranscriptHead
	}
	lines, err := read(data.Path, data.MaxLines)
	if err != nil {
		return nil, fmt.Errorf("reading agent transcript: %w", err)
	}
	return &wshrpc.CommandGetAgentTranscriptRtnData{Lines: lines}, nil
}

func (ws *WshServer) GetSubagentsCommand(ctx context.Context, data wshrpc.CommandGetSubagentsData) (*wshrpc.CommandGetSubagentsRtnData, error) {
	infos, err := listSubagents(data.Path)
	if err != nil {
		return nil, fmt.Errorf("listing subagents: %w", err)
	}
	return &wshrpc.CommandGetSubagentsRtnData{Subagents: infos}, nil
}

func usageBucketToWire(b usagestats.Bucket) wshrpc.UsageBucket {
	return wshrpc.UsageBucket{
		Harness: b.Harness, Provider: b.Provider, Model: b.Model, Day: b.Day,
		Input: b.Input, Output: b.Output, Reasoning: b.Reasoning,
		CacheRead: b.CacheRead, CacheCreate: b.CacheCreate, CacheCreate1h: b.CacheCreate1h,
		ReportedCostUsd: b.ReportedCostUsd, Msgs: b.Msgs,
	}
}

func (ws *WshServer) GetUsageStatsCommand(ctx context.Context, data wshrpc.CommandGetUsageStatsData) (*wshrpc.CommandGetUsageStatsRtnData, error) {
	buckets, err := usagestats.ScanUsage(data.WindowDays)
	if err != nil {
		return nil, fmt.Errorf("scanning usage: %w", err)
	}
	out := make([]wshrpc.UsageBucket, len(buckets))
	for i, b := range buckets {
		out[i] = usageBucketToWire(b)
	}
	return &wshrpc.CommandGetUsageStatsRtnData{Buckets: out}, nil
}

func (ws *WshServer) GetRecentSessionsCommand(ctx context.Context, data wshrpc.CommandGetRecentSessionsData) (*wshrpc.CommandGetRecentSessionsRtnData, error) {
	sessions, err := agentsessions.ScanSessions(data.WindowDays, data.Limit)
	if err != nil {
		return nil, fmt.Errorf("scanning sessions: %w", err)
	}
	out := make([]wshrpc.SessionInfo, len(sessions))
	for i, s := range sessions {
		out[i] = wshrpc.SessionInfo{
			ID: s.ID, Runtime: s.Runtime, ProjectPath: s.ProjectPath, ProjectName: s.ProjectName,
			Branch: s.Branch, Task: s.Task, Model: s.Model, TokensTotal: s.TokensTotal,
			LastActiveTs: s.LastActiveTs, ResumeCommand: s.ResumeCommand,
			TranscriptPath: s.TranscriptPath, ResumeArgs: s.ResumeArgs,
		}
	}
	return &wshrpc.CommandGetRecentSessionsRtnData{Sessions: out}, nil
}

func (ws *WshServer) GetSessionsActivityCommand(ctx context.Context, data wshrpc.CommandGetSessionsActivityData) (*wshrpc.CommandGetSessionsActivityRtnData, error) {
	sessions, err := agentsessions.ScanSessions(data.WindowDays, data.Limit)
	if err != nil {
		return nil, fmt.Errorf("scanning sessions: %w", err)
	}
	out := make([]wshrpc.SessionActivity, len(sessions))
	for i, s := range sessions {
		evs := make([]wshrpc.SessionEvent, len(s.Events))
		for j, e := range s.Events {
			evs[j] = wshrpc.SessionEvent{Type: e.Type, Ts: e.Ts, Text: e.Text}
		}
		out[i] = wshrpc.SessionActivity{
			ID: s.ID, Runtime: s.Runtime, ProjectPath: s.ProjectPath, ProjectName: s.ProjectName,
			Branch: s.Branch, Task: s.Task, Model: s.Model, TokensTotal: s.TokensTotal,
			LastActiveTs: s.LastActiveTs, ResumeCommand: s.ResumeCommand, ResumeArgs: s.ResumeArgs,
			TranscriptPath: s.TranscriptPath,
			Status:         s.Status, StartedTs: s.StartedTs, DurationMs: s.DurationMs, Events: evs,
		}
	}
	// unlinked sessions still list, just not under their run
	if err := linkSessionsToRuns(ctx, out); err != nil {
		log.Printf("sessions activity: %v", err)
	}
	return &wshrpc.CommandGetSessionsActivityRtnData{Sessions: out}, nil
}

func cutoffFromEpoch(sec int64) time.Time {
	if sec <= 0 {
		return time.Time{}
	}
	return time.Unix(sec, 0)
}

func (ws *WshServer) GetTranscriptTokensCommand(ctx context.Context, data wshrpc.CommandGetTranscriptTokensData) (*wshrpc.CommandGetTranscriptTokensRtnData, error) {
	total, err := usagestats.SumTranscript(data.Path)
	if err != nil {
		return nil, fmt.Errorf("summing transcript tokens: %w", err)
	}
	return &wshrpc.CommandGetTranscriptTokensRtnData{Tokens: total}, nil
}

func (ws *WshServer) GetTranscriptUsageCommand(ctx context.Context, data wshrpc.CommandGetTranscriptUsageData) (*wshrpc.CommandGetTranscriptUsageRtnData, error) {
	buckets, err := usagestats.TranscriptUsage(data.Path)
	if err != nil {
		return nil, fmt.Errorf("scanning transcript usage: %w", err)
	}
	out := make([]wshrpc.UsageBucket, len(buckets))
	for i, b := range buckets {
		out[i] = usageBucketToWire(b)
	}
	return &wshrpc.CommandGetTranscriptUsageRtnData{Buckets: out}, nil
}

func (ws *WshServer) GetCacheStatusCommand(ctx context.Context, data wshrpc.CommandGetCacheStatusData) (*wshrpc.CommandGetCacheStatusRtnData, error) {
	cw, err := usagestats.LastCacheWrite(data.Path)
	if err != nil {
		return nil, fmt.Errorf("checking cache status: %w", err)
	}
	if cw == nil {
		return &wshrpc.CommandGetCacheStatusRtnData{}, nil
	}
	return &wshrpc.CommandGetCacheStatusRtnData{LastWriteTs: cw.TS.Unix(), OneHour: cw.OneHour}, nil
}

func (ws *WshServer) GetBackgroundAgentsCommand(ctx context.Context, data wshrpc.CommandGetBackgroundAgentsData) (*wshrpc.CommandGetBackgroundAgentsRtnData, error) {
	agents, err := bgagents.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing background agents: %w", err)
	}
	out := make([]wshrpc.BackgroundAgentData, len(agents))
	for i, a := range agents {
		out[i] = wshrpc.BackgroundAgentData{
			SessionId: a.SessionId, Cwd: a.Cwd, Kind: a.Kind,
			Name: a.Name, State: a.State, StartedTs: a.StartedTs,
		}
	}
	return &wshrpc.CommandGetBackgroundAgentsRtnData{Agents: out}, nil
}

func (ws *WshServer) RemoveBackgroundAgentCommand(ctx context.Context, data wshrpc.CommandRemoveBackgroundAgentData) error {
	if data.SessionId == "" {
		return fmt.Errorf("sessionid is required")
	}
	if err := bgagents.Remove(data.SessionId); err != nil {
		return fmt.Errorf("removing background agent: %w", err)
	}
	return nil
}

func (ws *WshServer) GetWindowTokensCommand(ctx context.Context, data wshrpc.CommandGetWindowTokensData) (*wshrpc.CommandGetWindowTokensRtnData, error) {
	cutoffs := []time.Time{cutoffFromEpoch(data.FiveHourCutoff), cutoffFromEpoch(data.WeekCutoff)}
	sums, err := usagestats.WindowTokens(cutoffs)
	if err != nil {
		return nil, fmt.Errorf("summing window tokens: %w", err)
	}
	return &wshrpc.CommandGetWindowTokensRtnData{FiveHourTokens: sums[0], WeekTokens: sums[1]}, nil
}

// AgentControlCommand streams what the engine sends a block's agent session for as long as the caller
// (`wsh agentctl`, held by the session's mod) stays connected.
func (ws *WshServer) AgentControlCommand(ctx context.Context, data wshrpc.CommandAgentControlData) chan wshrpc.RespOrErrorUnion[wshrpc.AgentControlMsg] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.AgentControlMsg], 1)
	oref, err := waveobj.ParseORef(data.ORef)
	if err != nil || oref.OType != waveobj.OType_Block {
		ch <- wshutil.RespErr[wshrpc.AgentControlMsg](fmt.Errorf("agent control needs a block oref, got %q", data.ORef))
		close(ch)
		return ch
	}
	msgs, done := agentctl.Register(oref.OID)
	go func() {
		defer func() {
			panichandler.PanicHandler("AgentControlCommand", recover())
		}()
		defer close(ch)
		defer done()
		for {
			select {
			case <-ctx.Done():
				return
			case text := <-msgs:
				select {
				case ch <- wshrpc.RespOrErrorUnion[wshrpc.AgentControlMsg]{Response: wshrpc.AgentControlMsg{Text: text}}:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return ch
}

func (ws *WshServer) StreamAgentTranscriptCommand(ctx context.Context, data wshrpc.CommandStreamAgentTranscriptData) chan wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate], 16)
	go func() {
		defer func() {
			panichandler.PanicHandler("StreamAgentTranscriptCommand", recover())
		}()
		defer close(ch)
		if err := streamTranscript(ctx, data.Path, data.TailLines, ch); err != nil {
			ch <- wshutil.RespErr[wshrpc.AgentTranscriptUpdate](err)
		}
	}()
	return ch
}

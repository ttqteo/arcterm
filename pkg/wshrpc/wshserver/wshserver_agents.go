// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentctl"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/bgagents"
	"github.com/wavetermdev/waveterm/pkg/claudeaccount"
	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/usageinsights"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
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

func sessionUsageToWire(s usagestats.SessionUsage) wshrpc.UsageSession {
	models := make([]wshrpc.UsageSessionModel, len(s.Models))
	for i, m := range s.Models {
		models[i] = wshrpc.UsageSessionModel{
			Model: m.Model, Sub: m.Sub,
			Input: m.Input, Output: m.Output, CacheRead: m.CacheRead,
			CacheCreate: m.CacheCreate, CacheCreate1h: m.CacheCreate1h,
		}
	}
	return wshrpc.UsageSession{
		ID: s.ID, Title: s.Title, Project: s.Project, Models: models,
		Turns: s.Turns, SubTurns: s.SubTurns, AvgCtx: s.AvgCtx, MaxCtx: s.MaxCtx,
		ColdResumes: s.ColdResumes, ColdTokens: s.ColdTokens,
		FirstTs: s.FirstTs, LastTs: s.LastTs,
	}
}

func usageInsightsToWire(ins usageinsights.Insights) *wshrpc.UsageInsights {
	return &wshrpc.UsageInsights{
		Markdown: ins.Markdown, AnalyzedTs: ins.AnalyzedTs, WindowDays: ins.WindowDays, Model: ins.Model,
	}
}

func (ws *WshServer) GetSessionUsageCommand(ctx context.Context, data wshrpc.CommandGetSessionUsageData) (*wshrpc.CommandGetSessionUsageRtnData, error) {
	sessions := usagestats.ScanSessionUsage(data.WindowDays)
	out := make([]wshrpc.UsageSession, len(sessions))
	for i, s := range sessions {
		out[i] = sessionUsageToWire(s)
	}
	return &wshrpc.CommandGetSessionUsageRtnData{Sessions: out}, nil
}

func (ws *WshServer) AnalyzeUsageCommand(ctx context.Context, data wshrpc.CommandAnalyzeUsageData) (*wshrpc.UsageInsights, error) {
	if strings.TrimSpace(data.Digest) == "" {
		return nil, fmt.Errorf("the usage digest is empty; there is nothing to analyse")
	}
	lang := wconfig.GetWatcher().GetFullConfig().Settings.UsageInsightsLang
	ins, err := usageinsights.Analyze(ctx, usageinsights.Dir(), data.WindowDays, data.Digest, lang, time.Now)
	if err != nil {
		return nil, err
	}
	return usageInsightsToWire(ins), nil
}

func (ws *WshServer) GetUsageInsightsCommand(ctx context.Context) (*wshrpc.UsageInsights, error) {
	ins, err := usageinsights.Load(usageinsights.Dir())
	if err != nil {
		return nil, fmt.Errorf("reading the saved usage analysis: %w", err)
	}
	return usageInsightsToWire(ins), nil
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

func (ws *WshServer) ScanClaudeProjectsCommand(ctx context.Context) (*wshrpc.CommandScanClaudeProjectsRtnData, error) {
	found := agentsessions.ScanClaudeProjects()
	projects := make([]wshrpc.ClaudeProjectData, 0, len(found))
	for _, p := range found {
		projects = append(projects, wshrpc.ClaudeProjectData{Path: p.Path, Name: p.Name, LastActiveTs: p.LastActiveTs, Sessions: p.Sessions})
	}
	return &wshrpc.CommandScanClaudeProjectsRtnData{Projects: projects}, nil
}

func (ws *WshServer) GetClaudeQuotaCommand(ctx context.Context) (*wshrpc.CommandGetClaudeQuotaRtnData, error) {
	return claudeQuotaFor(ctx, claudeaccount.Active(), claudequota.Get), nil
}

// RefreshClaudeQuotaCommand is GetClaudeQuotaCommand asking the usage endpoint now: the Usage surface's
// refresh button. Only a 429 backoff holds it back, and RetryAt then says until when.
func (ws *WshServer) RefreshClaudeQuotaCommand(ctx context.Context) (*wshrpc.CommandGetClaudeQuotaRtnData, error) {
	return refreshClaudeQuotaFor(ctx, claudeaccount.Active(), claudequota.Refresh), nil
}

// a setup-token cannot read the usage endpoint (403), and the credentials file and Claude Code's
// cached answer belong to the /login account: say nothing rather than another account's numbers.
// The answer carries that account's email, so the frontend files the numbers under the real account
// rather than under "Default", whose owner changes whenever /login does.
func claudeQuotaFor(ctx context.Context, active string, get func(context.Context) *claudequota.Quota) *wshrpc.CommandGetClaudeQuotaRtnData {
	if active != "" {
		return &wshrpc.CommandGetClaudeQuotaRtnData{}
	}
	return claudeQuotaAnswer(get(ctx), time.Time{})
}

// claudeQuotaFor for a refresh: a token account's answer is empty without asking anyone, as there
func refreshClaudeQuotaFor(ctx context.Context, active string, refresh func(context.Context) (*claudequota.Quota, time.Time)) *wshrpc.CommandGetClaudeQuotaRtnData {
	if active != "" {
		return &wshrpc.CommandGetClaudeQuotaRtnData{}
	}
	return claudeQuotaAnswer(refresh(ctx))
}

// the answer carries RetryAt even when no reading is known, so a refresh held by a 429 can say so
func claudeQuotaAnswer(q *claudequota.Quota, retryAt time.Time) *wshrpc.CommandGetClaudeQuotaRtnData {
	out := &wshrpc.CommandGetClaudeQuotaRtnData{}
	if !retryAt.IsZero() {
		out.RetryAt = retryAt.UnixMilli()
	}
	if q == nil {
		return out
	}
	out.FiveHourPct = q.FiveHourPct
	out.FiveHourReset = q.FiveHourReset
	out.WeekPct = q.WeekPct
	out.WeekReset = q.WeekReset
	out.CapturedAt = q.CapturedAt.UnixMilli()
	out.Source = q.Source
	out.Email = loginEmail()
	return out
}

// swapped by tests
var loginEmail = claudequota.LoginEmail

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
			case msg := <-msgs:
				select {
				case ch <- wshrpc.RespOrErrorUnion[wshrpc.AgentControlMsg]{Response: wshrpc.AgentControlMsg{Text: msg.Text, Compact: msg.Compact, MidTurn: msg.MidTurn}}:
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

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var agentStatusCmd = &cobra.Command{
	Use:                   "agentstatus",
	Short:                 "report coding-agent session status for a block",
	Args:                  cobra.NoArgs,
	RunE:                  agentStatusRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var (
	agentStatusState      string
	agentStatusDetail     string
	agentStatusAgent      string
	agentStatusModel      string
	agentStatusTitle      string
	agentStatusTranscript string
	agentStatusCwd        string
	agentStatusSessionID  string
	agentStatusProvider   string

	agentUsageFlag       bool
	agentUsageContext    float64
	agentUsageContextMax int
	agentUsageCost       float64
	agentUsageFiveHour   float64
	agentUsageFiveReset  int64
	agentUsageWeek       float64
	agentUsageWeekReset  int64
)

func init() {
	rootCmd.AddCommand(agentStatusCmd)
	agentStatusCmd.Flags().StringVar(&agentStatusState, "state", "", "agent state: working | waiting | idle")
	agentStatusCmd.Flags().StringVar(&agentStatusDetail, "detail", "", "activity detail line (e.g. \"editing foo.go\")")
	agentStatusCmd.Flags().StringVar(&agentStatusAgent, "agent", "", "agent identity (claude | codex | opencode | pi)")
	agentStatusCmd.Flags().StringVar(&agentStatusModel, "model", "", "resolved model id (e.g. claude-sonnet-4-6)")
	agentStatusCmd.Flags().StringVar(&agentStatusTitle, "title", "", "agent ai-title / task summary (used as the sidebar tab label)")
	agentStatusCmd.Flags().StringVar(&agentStatusTranscript, "transcript", "", "path to the agent's transcript JSONL (for previous-info projection)")
	agentStatusCmd.Flags().StringVar(&agentStatusCwd, "cwd", "", "current working directory of the agent session")
	agentStatusCmd.Flags().StringVar(&agentStatusSessionID, "session-id", "", "agent session id")
	agentStatusCmd.Flags().StringVar(&agentStatusProvider, "provider", "", "model provider (e.g. openai-codex)")
	agentStatusCmd.Flags().BoolVar(&agentUsageFlag, "usage", false, "report a usage-only delta from the statusLine JSON (no --state)")
	agentStatusCmd.Flags().Float64Var(&agentUsageContext, "context-pct", 0, "context window used percentage")
	agentStatusCmd.Flags().IntVar(&agentUsageContextMax, "context-max", 0, "context window size in tokens (200000 | 1000000)")
	agentStatusCmd.Flags().Float64Var(&agentUsageCost, "cost-usd", 0, "session cost in USD")
	agentStatusCmd.Flags().Float64Var(&agentUsageFiveHour, "five-hour-pct", 0, "5-hour rate-limit used percentage (Claude.ai Pro/Max only)")
	agentStatusCmd.Flags().Int64Var(&agentUsageFiveReset, "five-hour-reset", 0, "5-hour window reset (epoch seconds)")
	agentStatusCmd.Flags().Float64Var(&agentUsageWeek, "week-pct", 0, "weekly rate-limit used percentage (Claude.ai Pro/Max only)")
	agentStatusCmd.Flags().Int64Var(&agentUsageWeekReset, "week-reset", 0, "weekly window reset (epoch seconds)")
}

func validAgentState(s string) bool {
	return s == baseds.AgentState_Working || s == baseds.AgentState_Waiting || s == baseds.AgentState_Idle
}

// buildAgentStatusData is the pure builder for an AgentStatusData event payload so tests can
// exercise it without Cobra flag globals. The Pi extension drives every field except ts.
func buildAgentStatusData(
	oref *waveobj.ORef,
	state, detail, agent, cwd, transcriptPath, sessionID, title, provider, model string,
	ts int64,
) baseds.AgentStatusData {
	return baseds.AgentStatusData{
		ORef:           oref.String(),
		State:          state,
		Detail:         detail,
		Agent:          agent,
		Cwd:            cwd,
		TranscriptPath: transcriptPath,
		SessionID:      sessionID,
		Title:          title,
		Provider:       provider,
		Model:          model,
		Ts:             ts,
	}
}

func buildAgentStatusEvent(oref *waveobj.ORef, data baseds.AgentStatusData, persist int) wps.WaveEvent {
	return wps.WaveEvent{
		Event:   wps.Event_AgentStatus,
		Scopes:  []string{oref.String()},
		Persist: persist,
		Data:    data,
	}
}

// agentStatusPublishTimeoutMs bounds the wait for wavesrv's reply, so a hook never stalls its agent's turn.
const agentStatusPublishTimeoutMs = 2000

// publishAgentStatusData waits for wavesrv's reply: hooks exit right after it, and os.Exit drops an rpc
// message still queued for the socket.
func publishAgentStatusData(oref *waveobj.ORef, data baseds.AgentStatusData, persist int) error {
	event := buildAgentStatusEvent(oref, data, persist)
	return wshclient.EventPublishCommand(RpcClient, event, &wshrpc.RpcOpts{Timeout: agentStatusPublishTimeoutMs})
}

func agentStatusRun(cmd *cobra.Command, args []string) (rtnErr error) {
	oref, err := resolveBlockArg()
	if err != nil {
		return fmt.Errorf("resolving block: %v", err)
	}
	if oref.OType != waveobj.OType_Block && oref.OType != waveobj.OType_Tab {
		return fmt.Errorf("agentstatus oref must be a block or tab (got %q)", oref.OType)
	}
	// the arcterm Claude mod reports from inside its session, so a daemon-hosted one is routed as agent-hook routes it
	// (wshcmd-agenthosted.go). An explicit -b names its block; a session in a terminal keeps its own.
	if blockArg == "" {
		target, drop := statusTarget(oref)
		if drop {
			return nil
		}
		if !agentUsageFlag {
			releaseStaleStatus(oref, target, agentStatusTranscript)
		}
		oref = target
	}

	if agentUsageFlag {
		return publishUsageDelta(cmd, oref)
	}

	if !validAgentState(agentStatusState) {
		return fmt.Errorf("--state must be one of working, waiting, idle (got %q)", agentStatusState)
	}

	eventData := buildAgentStatusData(oref, agentStatusState, agentStatusDetail, agentStatusAgent,
		agentStatusCwd, agentStatusTranscript, agentStatusSessionID, agentStatusTitle, agentStatusProvider,
		agentStatusModel, time.Now().UnixMilli())

	err = publishAgentStatusData(oref, eventData, 1)
	if err != nil {
		return fmt.Errorf("publishing agentstatus event: %v", err)
	}
	fmt.Printf("agentstatus %s set\n", agentStatusState)
	return nil
}

func publishUsageDelta(cmd *cobra.Command, oref *waveobj.ORef) error {
	usage := &baseds.AgentUsage{
		ContextPct: agentUsageContext,
		ContextMax: agentUsageContextMax,
		CostUSD:    agentUsageCost,
	}
	// only attach the rate-limit fields when explicitly provided, so an API-key (non-Pro/Max)
	// session that omits them reports nil ("unknown") rather than a misleading 0%
	if cmd.Flags().Changed("five-hour-pct") {
		usage.FiveHourPct = &agentUsageFiveHour
		if cmd.Flags().Changed("five-hour-reset") {
			usage.FiveHourReset = &agentUsageFiveReset
		}
	}
	if cmd.Flags().Changed("week-pct") {
		usage.WeekPct = &agentUsageWeek
		if cmd.Flags().Changed("week-reset") {
			usage.WeekReset = &agentUsageWeekReset
		}
	}

	if err := publishUsage(oref, usage); err != nil {
		return fmt.Errorf("publishing agentstatus usage event: %v", err)
	}
	fmt.Printf("agentstatus usage set\n")
	return nil
}

func publishUsage(oref *waveobj.ORef, usage *baseds.AgentUsage) error {
	eventData := baseds.AgentStatusData{
		ORef:  oref.String(),
		Ts:    time.Now().UnixMilli(),
		Usage: usage,
	}
	// Persist:0 — usage deltas are ephemeral; a retained usage event would evict the
	// retained Persist:1 parent-state event that a late subscriber must replay.
	return publishAgentStatusData(oref, eventData, 0)
}

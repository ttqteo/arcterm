// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/tokengate"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const tokengateReadTimeoutMs = 5000

var tokengateSpawn tokengate.Spawn

// the Claude mod runs this before an agent's Agent, Task or Workflow call: hold lines, then one verdict line
// of JSON. Any error exits non-zero with nothing on stdout and the mod lets the spawn run, so a broken gate
// never blocks an agent.
var tokengateCmd = &cobra.Command{
	Use:    "tokengate",
	Short:  "hold a costly subagent or workflow spawn for the person's say (agent hooks)",
	Args:   cobra.NoArgs,
	RunE:   tokengateRun,
	Hidden: true,
}

func init() {
	tokengateCmd.Flags().StringVar(&tokengateSpawn.Tool, "tool", "Agent", "Agent, Task or Workflow")
	tokengateCmd.Flags().IntVar(&tokengateSpawn.Agents, "agents", 1, "agents the group starts")
	tokengateCmd.Flags().BoolVar(&tokengateSpawn.AtLeast, "at-least", false, "the agent count is a floor")
	tokengateCmd.Flags().Int64Var(&tokengateSpawn.ContextTokens, "context-tokens", 0, "the agent's context now")
	tokengateCmd.Flags().Int64Var(&tokengateSpawn.ContextMax, "context-max", 0, "the agent's context window")
	rootCmd.AddCommand(tokengateCmd)
}

func tokengateRun(cmd *cobra.Command, args []string) error {
	out := json.NewEncoder(os.Stdout)
	verdict, err := tokengateDecide(context.Background(), tokengateSpawn, func(hold any) { _ = out.Encode(hold) })
	if err != nil {
		return err
	}
	return out.Encode(verdict)
}

// tokengateQuota reads the 5h window; a failed reading only leaves its numbers unknown
func tokengateQuota(ctx context.Context, estimate int64) tokengate.Quota {
	quota, err := rpcWithContext(ctx, func() (*wshrpc.CommandGetClaudeQuotaRtnData, error) {
		return wshclient.GetClaudeQuotaCommand(RpcClient, &wshrpc.RpcOpts{Timeout: tokengateReadTimeoutMs})
	})
	if err != nil || quota == nil || quota.FiveHourPct == nil {
		return tokengate.Quota{}
	}
	q := tokengate.Quota{FiveHourPct: quota.FiveHourPct, FiveHourReset: quota.FiveHourReset}
	if quota.FiveHourReset == nil {
		return q
	}
	window, err := rpcWithContext(ctx, func() (*wshrpc.CommandGetWindowTokensRtnData, error) {
		return wshclient.GetWindowTokensCommand(RpcClient, wshrpc.CommandGetWindowTokensData{
			FiveHourCutoff: *quota.FiveHourReset - int64((5 * time.Hour).Seconds()),
		}, &wshrpc.RpcOpts{Timeout: tokengateReadTimeoutMs})
	})
	if err == nil && window != nil {
		if share, ok := tokengate.WindowShare(estimate, int64(window.FiveHourTokens), *quota.FiveHourPct); ok {
			q.Share = &share
		}
	}
	return q
}

// tokengateDecide is the decision `wsh tokengate` makes about one spawn group: off, or no rule firing, it runs
// (with a note); otherwise it waits on the person's card. An error is a broken gate, which the mod answers by
// letting the spawn run.
func tokengateDecide(ctx context.Context, s tokengate.Spawn, onHold func(any)) (tokengate.Verdict, error) {
	if err := ctx.Err(); err != nil {
		return tokengate.Verdict{}, err
	}
	if RpcClient == nil {
		if err := preRunSetupRpcClient(nil, nil); err != nil {
			return tokengate.Verdict{}, err
		}
	}
	cfg, err := rpcWithContext(ctx, func() (wconfig.FullConfigType, error) {
		return wshclient.GetFullConfigCommand(RpcClient, &wshrpc.RpcOpts{Timeout: tokengateReadTimeoutMs})
	})
	if err != nil {
		return tokengate.Verdict{}, fmt.Errorf("reading settings: %w", err)
	}
	set := cfg.Settings
	if set.TokenGateEnabled != nil && !*set.TokenGateEnabled {
		return tokengate.Verdict{Run: true}, nil
	}
	quota := tokengateQuota(ctx, tokengate.Estimate(s))
	if !tokengate.Asks(tokengate.RulesFrom(set.TokenGateSharePct, set.TokenGateWindowPct, set.TokenGateAgents), s, quota) {
		return tokengate.Verdict{Run: true, Note: tokengate.Note(s, quota)}, nil
	}

	oref, err := resolveBlockArg()
	if err != nil {
		return tokengate.Verdict{}, fmt.Errorf("resolving block: %w", err)
	}
	if blockArg == "" {
		target, drop := statusTarget(oref)
		if drop {
			return tokengate.Verdict{}, fmt.Errorf("the session runs in the Claude daemon with no arcterm tab attached")
		}
		oref = target
	}
	question := tokengate.Question(s, quota, time.Local)
	onHold(tokengate.Asking(s))
	// the card's ceiling is this local deadline; the RPC's own is a minute later, so no answer reads as the
	// deadline, which is the deny option, never as an EC-TIME error, which would let the spawn run
	askCtx, cancel := context.WithTimeout(ctx, askWaitTimeout)
	defer cancel()
	rtn, err := rpcWithContext(askCtx, func() (wshrpc.AskRtnData, error) {
		return wshclient.AskCommand(RpcClient, wshrpc.CommandAskData{
			ORef:      oref.String(),
			Questions: []baseds.AgentAskQuestion{question},
			Wait:      true,
			Hold:      true,
		}, &wshrpc.RpcOpts{Timeout: int64((askWaitTimeout + time.Minute) / time.Millisecond)})
	})
	return tokengateAnswered(s, rtn, err)
}

// tokengateAnswered turns the card's outcome into the verdict. No answer before the deadline is the deny option, as a
// dismissed card is; wsh then exits, and the server's waiter cancel takes the card down. Any other error is a broken
// gate, which the mod answers by letting the spawn run.
func tokengateAnswered(s tokengate.Spawn, rtn wshrpc.AskRtnData, err error) (tokengate.Verdict, error) {
	if errors.Is(err, context.DeadlineExceeded) {
		return tokengate.VerdictFor(tokengate.OptionDeny, s), nil
	}
	if err != nil {
		return tokengate.Verdict{}, err
	}
	return tokengate.VerdictFor(tokengate.Choice(rtn.Answers, rtn.Cancelled), s), nil
}

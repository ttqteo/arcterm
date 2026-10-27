// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/tokengate"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const tokengateReadTimeoutMs = 5000

var tokengateSpawn tokengate.Spawn

// the asking session's transcript, each agent's subagent type and each Agent or Task call (JSON), which the Claude
// mod passes
var (
	tokengateTranscript string
	tokengateTypes      string
	tokengateCalls      string
	tokengateReviewDays int
)

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

var tokengateReviewCmd = &cobra.Command{
	Use:   "review",
	Short: "how far the Token burn estimates of the last days were from what their subagents cost",
	Args:  cobra.NoArgs,
	RunE:  tokengateReviewRun,
}

func init() {
	tokengateCmd.Flags().StringVar(&tokengateSpawn.Tool, "tool", "Agent", "Agent, Task or Workflow")
	tokengateCmd.Flags().IntVar(&tokengateSpawn.Agents, "agents", 1, "agents the group starts")
	tokengateCmd.Flags().BoolVar(&tokengateSpawn.AtLeast, "at-least", false, "the agent count is a floor")
	tokengateCmd.Flags().IntVar(&tokengateSpawn.Earlier, "earlier", 0, "agents started in the seconds before, which count toward the agents rule")
	tokengateCmd.Flags().Int64Var(&tokengateSpawn.ContextTokens, "context-tokens", 0, "the agent's context now")
	tokengateCmd.Flags().Int64Var(&tokengateSpawn.ContextMax, "context-max", 0, "the agent's context window")
	tokengateCmd.Flags().StringVar(&tokengateTranscript, "transcript", "", "the asking session's transcript")
	tokengateCmd.Flags().StringVar(&tokengateTypes, "types", "", "each agent's subagent type, comma-separated, in order")
	tokengateCmd.Flags().StringVar(&tokengateCalls, "calls", "", `each Agent or Task call, a JSON list of {"type","model","description","background"}`)
	tokengateReviewCmd.Flags().IntVar(&tokengateReviewDays, "days", 7, "how many days back")
	tokengateCmd.AddCommand(tokengateReviewCmd)
	rootCmd.AddCommand(tokengateCmd)
}

func tokengateRun(cmd *cobra.Command, args []string) error {
	out := json.NewEncoder(os.Stdout)
	s := tokengateSpawn
	s.Types = splitTypes(tokengateTypes)
	s.Calls = parseCalls(tokengateCalls)
	// a call that sets no model runs on the session's: its transcript's latest turn names it
	s.SessionModel = readLastModel(tokengateTranscript)
	verdict, err := tokengateDecide(context.Background(), s, tokengateTranscript, func(hold any) { _ = out.Encode(hold) })
	if err != nil {
		return err
	}
	return out.Encode(verdict)
}

// splitTypes reads --types: one name per agent, in order, an empty name unknown
func splitTypes(flag string) []string {
	if flag == "" {
		return nil
	}
	return strings.Split(flag, ",")
}

// parseCalls reads --calls; a missing or unreadable list is no calls, and the card names none
func parseCalls(flag string) []tokengate.Call {
	if flag == "" {
		return nil
	}
	var calls []tokengate.Call
	if json.Unmarshal([]byte(flag), &calls) != nil {
		return nil
	}
	return calls
}

// tokengateRead reads the quota and wavesrv's counts for a spawn: both windows, the session's share of them, the
// subagent costs, and the session's id. A failed reading only leaves its numbers unknown, and no costs prices every
// agent at PerAgentTokens
func tokengateRead(ctx context.Context, transcript string) (tokengate.Reading, []tokengate.Cost, string) {
	var r tokengate.Reading
	data := wshrpc.CommandGetSessionBurnData{Path: transcript}
	quota, err := rpcWithContext(ctx, func() (*wshrpc.CommandGetClaudeQuotaRtnData, error) {
		return wshclient.GetClaudeQuotaCommand(RpcClient, &wshrpc.RpcOpts{Timeout: tokengateReadTimeoutMs})
	})
	if err == nil && quota != nil {
		r.FiveHourPct, r.FiveHourReset = quota.FiveHourPct, quota.FiveHourReset
		r.WeekPct, r.WeekReset = quota.WeekPct, quota.WeekReset
		if quota.FiveHourReset != nil {
			data.FiveHourCutoff = *quota.FiveHourReset - int64((5 * time.Hour).Seconds())
		}
		if quota.WeekReset != nil {
			data.WeekCutoff = *quota.WeekReset - int64((7 * 24 * time.Hour).Seconds())
		}
	}
	burn, err := rpcWithContext(ctx, func() (*wshrpc.CommandGetSessionBurnRtnData, error) {
		return wshclient.GetSessionBurnCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: tokengateReadTimeoutMs})
	})
	if err != nil || burn == nil {
		return r, nil, ""
	}
	r.Counted = true
	r.WindowFiveHour, r.WindowWeek = int64(burn.WindowFiveHour), int64(burn.WindowWeek)
	r.SessionFiveHour, r.SessionWeek = int64(burn.SessionFiveHour), int64(burn.SessionWeek)
	r.Subagents = burn.Subagents
	costs := make([]tokengate.Cost, len(burn.Costs))
	for i, c := range burn.Costs {
		costs[i] = tokengate.Cost{Type: c.Type, Samples: c.Samples, Mean: c.Mean, P25: c.P25, P90: c.P90}
	}
	return r, costs, burn.Session
}

// tokengateDecide is the decision `wsh tokengate` makes about one spawn group: off, or no rule firing, it runs
// (with a note); otherwise it waits on the person's card. A decided group is logged for `wsh tokengate review`. An
// error is a broken gate, which the mod answers by letting the spawn run. `wsh council start` asks it too, with
// Tool "Council" and the council's own estimate, and treats an error the same way.
func tokengateDecide(ctx context.Context, s tokengate.Spawn, transcript string, onHold func(any)) (tokengate.Verdict, error) {
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
	if v, capped := tokengateCapped(subagentLedgerDir(), transcript, s.Tool); capped {
		return v, nil
	}
	reading, costs, session := tokengateRead(ctx, transcript)
	priced := tokengate.Price(s, costs)
	quota := tokengate.QuotaFrom(reading, priced.Estimate)
	rules := tokengate.RulesFrom(set.TokenGateSharePct, set.TokenGateWindowPct, set.TokenGateAgents, set.TokenGateWeekPct, set.TokenGateSessionPct)
	if !tokengate.Asks(rules, s, quota) {
		verdict := tokengate.Verdict{Run: true, Note: tokengate.Note(s, priced, quota)}
		tokengateLog(session, s, priced, verdict, false)
		return verdict, nil
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
	question := tokengate.Question(s, priced, quota, time.Local)
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
	verdict, err := tokengateAnswered(s, priced.Estimate, rtn, err)
	if err == nil {
		tokengateLog(session, s, priced, verdict, true)
	}
	return verdict, err
}

// tokengateAnswered turns the card's outcome into the verdict. No answer before the deadline is the deny option, as a
// dismissed card is; wsh then exits, and the server's waiter cancel takes the card down. Any other error is a broken
// gate, which the mod answers by letting the spawn run.
func tokengateAnswered(s tokengate.Spawn, estimate int64, rtn wshrpc.AskRtnData, err error) (tokengate.Verdict, error) {
	if errors.Is(err, context.DeadlineExceeded) {
		return tokengate.VerdictFor(tokengate.OptionDeny, s, estimate), nil
	}
	if err != nil {
		return tokengate.Verdict{}, err
	}
	return tokengate.VerdictFor(tokengate.Choice(rtn.Answers, rtn.Cancelled), s, estimate), nil
}

// tokengateLog appends a decided group to the estimate log `wsh tokengate review` reads; a failed write is ignored
func tokengateLog(session string, s tokengate.Spawn, p tokengate.Priced, v tokengate.Verdict, asked bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	line, err := json.Marshal(tokengate.NewLogLine(time.Now(), session, s, p, v, asked))
	if err != nil {
		return
	}
	path := tokengate.LogPath(home)
	if os.MkdirAll(filepath.Dir(path), 0o755) != nil {
		return
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(line, '\n'))
}

func tokengateReviewRun(cmd *cobra.Command, args []string) error {
	if RpcClient == nil {
		if err := preRunSetupRpcClient(nil, nil); err != nil {
			return err
		}
	}
	rtn, err := wshclient.ReviewTokenEstimatesCommand(RpcClient, wshrpc.CommandReviewTokenEstimatesData{Days: tokengateReviewDays}, &wshrpc.RpcOpts{Timeout: 60_000})
	if err != nil {
		return fmt.Errorf("reviewing token estimates: %w", err)
	}
	fmt.Print(tokengateReviewText(rtn))
	return nil
}

// tokengateReviewText is the review as the person reads it
func tokengateReviewText(r *wshrpc.CommandReviewTokenEstimatesRtnData) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Token burn estimates, last %d days: %d logged, %d ran, %d matched to the subagents that ran.\n",
		r.Days, r.Logged, r.Run, r.Matched)
	if r.Matched > 0 {
		fmt.Fprintf(&b, "Actual ÷ estimate: median %.2f×.\n", r.MedianRatio)
	}
	if r.WithRange > 0 {
		fmt.Fprintf(&b, "Inside the card's range: %d of %d (%d%%).\n", r.InRange, r.WithRange, r.InRange*100/r.WithRange)
	}
	for _, t := range r.ByType {
		fmt.Fprintf(&b, "  %s: %d matched, median %.2f×\n", t.Type, t.Matched, t.MedianRatio)
	}
	b.WriteString("Subagent costs now (finished, last 30 days):\n")
	if len(r.Costs) == 0 {
		b.WriteString("  none yet\n")
	}
	for _, c := range r.Costs {
		fmt.Fprintf(&b, "  %s: %d samples, avg %s, range %s–%s\n",
			c.Type, c.Samples, tokengate.FormatTokens(c.Mean), tokengate.FormatTokens(c.P25), tokengate.FormatTokens(c.P90))
	}
	return b.String()
}

// tokengateCapped is agent-hook's session cap, read before any card: once the session has dispatched every subagent
// the cap allows, agent-hook refuses the next Agent call whatever the person said on the card, so the gate refuses it
// first, with the cap's own reason. The session is the transcript's; a Workflow is no Agent call and the cap leaves it,
// and so is a Council, whose experts are `claude -p` calls wavesrv makes, not subagents of the asking session
func tokengateCapped(dir, transcript, tool string) (tokengate.Verdict, bool) {
	if transcript == "" || tool == "Workflow" || tool == "Council" {
		return tokengate.Verdict{}, false
	}
	session := strings.TrimSuffix(filepath.Base(transcript), ".jsonl")
	if subagentsDispatched(dir, session) < jarvis.MaxSubagents {
		return tokengate.Verdict{}, false
	}
	return tokengate.Verdict{Reason: subagentCapReason()}, true
}

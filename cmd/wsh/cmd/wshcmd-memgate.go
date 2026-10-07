// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// the Claude mod and the pi extension run this before every shell command an agent runs: one line of JSON
// on stdout says whether the command runs. Any error exits non-zero with nothing on stdout, and the hooks
// then let the command run, so a broken gate never blocks an agent.
var memgateCmd = &cobra.Command{
	Use:                   "memgate -- <command>",
	Short:                 "hold a heavy shell command for the person's say while RAM is short (agent hooks)",
	Args:                  cobra.ExactArgs(1),
	RunE:                  memgateRun,
	Hidden:                true,
	DisableFlagsInUseLine: true,
}

func init() {
	rootCmd.AddCommand(memgateCmd)
}

// printLine writes one JSON line: a memgate.Hold while the command is held, the memgate.Verdict last
func printLine(v any) error {
	out, err := json.Marshal(v)
	if err != nil {
		return err
	}
	fmt.Println(string(out))
	return nil
}

func printVerdict(v memgate.Verdict) error {
	return printLine(v)
}

func memgateRun(cmd *cobra.Command, args []string) error {
	job, heavy := memgate.Classify(args[0])
	if !heavy {
		return printVerdict(memgate.Verdict{Run: true})
	}
	// only a heavy command pays for the connection
	if err := preRunSetupRpcClient(cmd, args); err != nil {
		return err
	}
	capacity, err := wshclient.GetWorkerCapacityCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("reading free RAM: %w", err)
	}
	if memgate.Fits(job, capacity.AvailableBytes) {
		return printVerdict(memgate.Verdict{Run: true})
	}

	oref, err := resolveBlockArg()
	if err != nil {
		return fmt.Errorf("resolving block: %w", err)
	}
	if blockArg == "" {
		target, drop := statusTarget(oref)
		if drop {
			return fmt.Errorf("the session runs in the Claude daemon with no arcterm tab attached")
		}
		oref = target
	}
	question := memgate.Question(job, capacity.AvailableBytes, capacity.TotalBytes)
	if err := printLine(memgate.Asking(job, capacity.AvailableBytes)); err != nil {
		return err
	}
	rtn, err := wshclient.AskCommand(RpcClient, wshrpc.CommandAskData{
		ORef:      oref.String(),
		Questions: []baseds.AgentAskQuestion{question},
		Wait:      true,
		Hold:      true,
	}, &wshrpc.RpcOpts{Timeout: int64(askWaitTimeout / time.Millisecond)})
	if err != nil {
		return err
	}

	switch memgate.Choice(rtn.Answers, rtn.Cancelled) {
	case memgate.OptionRun:
		return printVerdict(memgate.Verdict{Run: true})
	case memgate.OptionWait:
		read := func(context.Context) (uint64, error) {
			c, err := wshclient.GetWorkerCapacityCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
			if err != nil {
				return 0, err
			}
			return c.AvailableBytes, nil
		}
		if err := printLine(memgate.Waiting(job)); err != nil {
			return err
		}
		if memgate.Wait(context.Background(), job, read, memgate.WaitEvery, memgate.WaitLimit) {
			return printVerdict(memgate.Verdict{Run: true})
		}
		return printVerdict(memgate.TimedOut(job, memgate.WaitLimit))
	}
	return printVerdict(memgate.Skipped(job, capacity.AvailableBytes))
}

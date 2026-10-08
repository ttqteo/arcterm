// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/memgate"
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
	verdict, err := memgateDecide(context.Background(), args[0], func(hold any) { _ = printLine(hold) })
	if err != nil {
		return err
	}
	return printVerdict(verdict)
}

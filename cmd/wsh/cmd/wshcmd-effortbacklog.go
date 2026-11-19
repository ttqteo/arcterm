// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var effortBackfillProposedCmd = &cobra.Command{
	Use:   "backfill-proposed",
	Short: "move the open issues leads left as pending chunks into To review",
	Long: `Move the pending chunks that name a recent orchestrator run to proposed, so they show in the Brief's To
review strip, grouped by the run that left them. Before leads filed their open issues as proposed chunks, they
wrote them as pending chunks whose label names the run ("... (run 9a842b04)"); this takes the ones written since
2026-11-13 from runs created since then.

Run it once after installing. It moves only a pending chunk with no run or agent on it, on an active or paused
initiative, whose label holds the first 8 characters of the id of a top-level orchestrator run, and it is safe to
run again: a moved chunk is proposed, so the second run finds nothing. It does not run on its own, so a pending
chunk you add later that names a run stays where it is.`,
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		rtn, err := wshclient.EffortBackfillProposedCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 120000})
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(rtn)
		}
		fmt.Printf("moved %d chunks on %d initiatives to To review\n", rtn.Chunks, rtn.Efforts)
		return nil
	},
}

func init() {
	effortBackfillProposedCmd.Flags().Bool("json", false, "JSON output")
	effortCmd.AddCommand(effortBackfillProposedCmd)
}

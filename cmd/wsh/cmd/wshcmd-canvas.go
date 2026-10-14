// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const canvasPolicyTimeoutMs = 5000

var canvasCmd = &cobra.Command{
	Use:   "canvas",
	Short: "design canvases (.superpowers/design) and what agents do with them",
	Args:  cobra.NoArgs,
	RunE:  func(cmd *cobra.Command, args []string) error { return cmd.Help() },
}

// the design-local skill runs this when a feature ships. Any failure exits 1 with nothing on stdout, and the skill
// reads that as keep.
var canvasPolicyCmd = &cobra.Command{
	Use:     "policy",
	Short:   "print what to do with a canvas when its feature ships: keep or delete-on-ship",
	Args:    cobra.NoArgs,
	RunE:    canvasPolicyRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	canvasCmd.AddCommand(canvasPolicyCmd)
	rootCmd.AddCommand(canvasCmd)
}

func canvasPolicyRun(cmd *cobra.Command, args []string) error {
	cfg, err := wshclient.GetFullConfigCommand(RpcClient, &wshrpc.RpcOpts{Timeout: canvasPolicyTimeoutMs})
	if err != nil {
		return fmt.Errorf("reading settings: %w", err)
	}
	WriteStdout("%s\n", canvasPolicy(cfg.Settings))
	return nil
}

// canvasPolicy is what an agent does with a canvas when its feature ships (design-local "Cleaning up")
func canvasPolicy(s wconfig.SettingsType) string {
	if s.StorageCanvasOnShip != nil && *s.StorageCanvasOnShip {
		return "delete-on-ship"
	}
	return "keep"
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// agentCtlTimeout is the stream's RPC ceiling: it lives as long as the agent session that holds it.
const agentCtlTimeout = 30 * 24 * time.Hour

var agentCtlCmd = &cobra.Command{
	Use:                   "agentctl",
	Short:                 "stream the cockpit's prompts for this block's agent session, one JSON line each (the Claude mod)",
	Args:                  cobra.NoArgs,
	RunE:                  agentCtlRun,
	PreRunE:               preRunSetupRpcClient,
	Hidden:                true,
	DisableFlagsInUseLine: true,
}

func init() {
	rootCmd.AddCommand(agentCtlCmd)
}

func agentCtlRun(cmd *cobra.Command, args []string) error {
	oref, err := resolveBlockArg()
	if err != nil {
		return fmt.Errorf("resolving block: %w", err)
	}
	msgs := wshclient.AgentControlCommand(RpcClient, wshrpc.CommandAgentControlData{ORef: oref.String()}, &wshrpc.RpcOpts{Timeout: agentCtlTimeout.Milliseconds()})
	out := json.NewEncoder(os.Stdout)
	for msg := range msgs {
		if msg.Error != nil {
			return msg.Error
		}
		if err := out.Encode(msg.Response); err != nil {
			return fmt.Errorf("writing a prompt: %w", err)
		}
	}
	return nil
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// a published list is ~20 KB; the cap only keeps a runaway stdin from filling memory
const claudeCmdsMaxStdinBytes = 4 << 20

// the mod does not wait on this command, so a wavesrv that does not answer must not hold its process for long
const claudeCmdsSetTimeoutMs = 5000

var claudeCmdsCmd = &cobra.Command{
	Use:    "claudecmds",
	Short:  "the slash command list of the Claude agent in this block (the Claude mod)",
	Hidden: true,
}

var claudeCmdsSetCmd = &cobra.Command{
	Use:                   "set",
	Short:                 "read the JSON list of the commands this Claude session offers from stdin and keep it for this block",
	Args:                  cobra.NoArgs,
	PreRunE:               preRunSetupRpcClient,
	RunE:                  claudeCmdsSetRun,
	Hidden:                true,
	DisableFlagsInUseLine: true,
}

func init() {
	claudeCmdsCmd.AddCommand(claudeCmdsSetCmd)
	rootCmd.AddCommand(claudeCmdsCmd)
}

func claudeCmdsSetRun(cmd *cobra.Command, args []string) error {
	// the list belongs to the agent's block; a wsh run outside a block has no agent to attach it to
	if RpcContext.BlockId == "" {
		return errors.New("claudecmds set needs a block: run it from an arcterm terminal block")
	}
	list, err := readClaudeCmdsList(os.Stdin)
	if err != nil {
		return err
	}
	return wshclient.SetClaudeLiveCommandsCommand(RpcClient, wshrpc.CommandSetClaudeLiveCommandsData{
		BlockId:  RpcContext.BlockId,
		Commands: list,
	}, &wshrpc.RpcOpts{Timeout: claudeCmdsSetTimeoutMs})
}

// readClaudeCmdsList reads the JSON array of commands from r, refusing more than claudeCmdsMaxStdinBytes. The list
// comes on stdin, not argv: 200 commands run past Windows' 32 K command line.
func readClaudeCmdsList(r io.Reader) ([]wshrpc.ClaudeCommandInfo, error) {
	raw, err := io.ReadAll(io.LimitReader(r, claudeCmdsMaxStdinBytes+1))
	if err != nil {
		return nil, fmt.Errorf("reading the command list from stdin: %w", err)
	}
	if len(raw) > claudeCmdsMaxStdinBytes {
		return nil, fmt.Errorf("the command list on stdin is over %d bytes", claudeCmdsMaxStdinBytes)
	}
	var list []wshrpc.ClaudeCommandInfo
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("the command list on stdin is not a JSON array of commands: %w", err)
	}
	return list, nil
}

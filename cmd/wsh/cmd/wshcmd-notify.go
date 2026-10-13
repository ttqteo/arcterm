// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var notifyMessage string
var notifyLevel string
var notifyTransient bool

var notifyCmd = &cobra.Command{
	Use:     "notify [title]",
	Short:   "send a Wave notification (title required)",
	Args:    cobra.ExactArgs(1),
	RunE:    notifyRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	notifyCmd.Flags().StringVar(&notifyMessage, "message", "", "notification message body")
	notifyCmd.Flags().StringVar(&notifyLevel, "level", "", "notification level (info, warn, error)")
	notifyCmd.Flags().BoolVar(&notifyTransient, "transient", false, "say it once: no unread marker, not kept in the avatar's popup")
	rootCmd.AddCommand(notifyCmd)
}

// blockId is empty outside a block, and the notice then names no sender
func notifyDataFromArgs(title, message, level, blockId string, transient bool) wshrpc.NotifyCommandData {
	data := wshrpc.NotifyCommandData{Title: title, Message: message, Level: level, Transient: transient}
	if blockId != "" {
		data.ORef = waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	}
	return data
}

func notifyRun(cmd *cobra.Command, args []string) error {
	data := notifyDataFromArgs(args[0], notifyMessage, notifyLevel, os.Getenv("WAVETERM_BLOCKID"), notifyTransient)
	err := wshclient.NotifyCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("sending notification: %w", err)
	}
	WriteStdout("notification sent\n")
	return nil
}

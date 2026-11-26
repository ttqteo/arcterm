// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var sessionIdeasCmd = &cobra.Command{
	Use:   "sessionideas",
	Short: "list, keep or drop the ideas a scan found in past sessions",
	Long: `Session ideas are what was floated in a past session and never decided: a scan finds them, and the Jarvis Brief's
From your sessions region shows them. An agent that goes through them with the person records each decision here:
keep puts the idea on its initiative as a pending chunk (or makes a new idea when no initiative matches it), with
the quote and the source session as the first note; drop removes it, and the scan does not propose it again.`,
}

// sessionIdeaLine is one row of `sessionideas list`: id, state, gist and where Keep would put it.
func sessionIdeaLine(i wshrpc.SessionIdea) string {
	target := i.EffortTitle
	if i.EffortOID == "" {
		target = "new idea"
		if i.Project != "" {
			target += " · " + i.Project
		}
	}
	return fmt.Sprintf("%s\t%s\t%s\t%s", i.ID, i.State, i.Gist, target)
}

var sessionIdeasListCmd = &cobra.Command{
	Use:     "list",
	Short:   "list every idea: id, state (review, kept or dropped), gist and the initiative it would go on",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data, err := wshclient.SessionIdeasGetCommand(RpcClient, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(data.Ideas)
		}
		for _, i := range data.Ideas {
			fmt.Println(sessionIdeaLine(i))
		}
		return nil
	},
}

var sessionIdeasKeepCmd = &cobra.Command{
	Use:   "keep <id> [--label \"<label>\"]",
	Short: "keep an idea: a pending chunk on its initiative, or a new idea when it has none",
	Long: `Keep an idea that waits for review. The chunk (or the new idea) is named by --label, else by the idea's gist,
and its first note holds the quote and the source session, so the idea keeps its source once the transcript is deleted.`,
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		err := wshclient.SessionIdeasResolveCommand(RpcClient, wshrpc.CommandSessionIdeasResolveData{
			ID: args[0], Op: "keep", Label: mustFlagString(cmd, "label"),
		}, nil)
		if err != nil {
			return err
		}
		fmt.Printf("kept %s\n", args[0])
		return nil
	},
}

var sessionIdeasDropCmd = &cobra.Command{
	Use:     "drop <id>",
	Short:   "drop an idea: it leaves the review list and the scan does not propose it again",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		err := wshclient.SessionIdeasResolveCommand(RpcClient, wshrpc.CommandSessionIdeasResolveData{ID: args[0], Op: "drop"}, nil)
		if err != nil {
			return err
		}
		fmt.Printf("dropped %s\n", args[0])
		return nil
	},
}

func init() {
	sessionIdeasListCmd.Flags().Bool("json", false, "JSON output")
	sessionIdeasKeepCmd.Flags().String("label", "", "name the chunk (or the new idea) this, instead of the idea's gist")
	sessionIdeasCmd.AddCommand(sessionIdeasListCmd, sessionIdeasKeepCmd, sessionIdeasDropCmd)
	rootCmd.AddCommand(sessionIdeasCmd)
}

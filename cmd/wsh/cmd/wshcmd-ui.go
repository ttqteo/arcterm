// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// the cockpit waits up to 4s for the user to stop typing, and a reveal may then still load its target;
// together that can pass the 5s default
const uiRpcTimeoutMs = 15000

var uiRevealAnchor string

var uiCmd = &cobra.Command{
	Use:   "ui",
	Short: "read and steer the arcterm cockpit: state, actions, reveal <address>, do <action-id>",
}

var uiStateCmd = &cobra.Command{
	Use:     "state",
	Short:   "print the cockpit's surface, busy flag, selection (addresses) and available actions as JSON",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE:    uiStateRun,
}

var uiActionsCmd = &cobra.Command{
	Use:     "actions",
	Short:   "list the actions available right now, one \"<id>\\t<label>[\\tdestructive]\" line each",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE:    uiActionsRun,
}

var uiRevealCmd = &cobra.Command{
	Use:     "reveal <address>",
	Short:   "take the user to run:<id> channel:<id> agent:<tabid> task:<id> effort:<id> radarreport:<id> surface:<key> canvas:<topic>[/<board>], or show memnote:<id> in the avatar popup",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    uiRevealRun,
}

var uiDoCmd = &cobra.Command{
	Use:     "do <action-id>",
	Short:   "run a cockpit action as if the user pressed its key (ids from wsh ui actions)",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    uiDoRun,
}

func init() {
	uiRevealCmd.Flags().StringVar(&uiRevealAnchor, "anchor", "", "sub-object to land on (a radar finding id)")
	uiCmd.AddCommand(uiStateCmd, uiActionsCmd, uiRevealCmd, uiDoCmd)
	rootCmd.AddCommand(uiCmd)
}

func uiOpts() *wshrpc.RpcOpts {
	return &wshrpc.RpcOpts{Route: wshutil.RouteId_Cockpit, Timeout: uiRpcTimeoutMs}
}

// the router answers "no route" when nothing has bound the cockpit route: the app is closed or still booting
func uiErr(err error) error {
	if strings.Contains(err.Error(), "no route for") {
		return errors.New("the cockpit is not running")
	}
	return err
}

func formatUiActions(actions []wshrpc.UiAction) string {
	var b strings.Builder
	for _, a := range actions {
		b.WriteString(a.Id + "\t" + a.Label)
		if a.Destructive {
			b.WriteString("\tdestructive")
		}
		b.WriteString("\n")
	}
	return b.String()
}

func printNotice(notice string) {
	if notice != "" {
		WriteStdout("%s\n", notice)
	}
}

func uiStateRun(cmd *cobra.Command, args []string) error {
	state, err := wshclient.UiStateCommand(RpcClient, uiOpts())
	if err != nil {
		return uiErr(err)
	}
	return jsonOut(state)
}

func uiActionsRun(cmd *cobra.Command, args []string) error {
	state, err := wshclient.UiStateCommand(RpcClient, uiOpts())
	if err != nil {
		return uiErr(err)
	}
	WriteStdout("%s", formatUiActions(state.Actions))
	return nil
}

func uiRevealRun(cmd *cobra.Command, args []string) error {
	// a failed Getwd sends none, and the cockpit then asks for the reveal from the agent's terminal
	cwd, _ := os.Getwd()
	notice, err := wshclient.UiRevealCommand(RpcClient, wshrpc.CommandUiRevealData{
		Address:       args[0],
		Anchor:        uiRevealAnchor,
		CallerBlockId: os.Getenv("WAVETERM_BLOCKID"),
		CallerCwd:     cwd,
	}, uiOpts())
	if err != nil {
		return uiErr(err)
	}
	printNotice(notice)
	return nil
}

func uiDoRun(cmd *cobra.Command, args []string) error {
	notice, err := wshclient.UiInvokeCommand(RpcClient, wshrpc.CommandUiInvokeData{
		ActionId:      args[0],
		CallerBlockId: os.Getenv("WAVETERM_BLOCKID"),
	}, uiOpts())
	if err != nil {
		return uiErr(err)
	}
	printNotice(notice)
	return nil
}

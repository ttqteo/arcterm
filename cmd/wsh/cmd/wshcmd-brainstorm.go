// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var brainstormCmd = &cobra.Command{
	Use:   "brainstorm",
	Short: "commands a brainstorming agent runs against its brainstorm.json",
	Args:  cobra.NoArgs,
	RunE:  func(cmd *cobra.Command, args []string) error { return cmd.Help() },
}

var brainstormCheckCmd = &cobra.Command{
	Use:   "check <brainstorm.json>",
	Short: "start the builder check: a one-shot reviewer reads the design and its questions come back as one line",
	Args:  cobra.ExactArgs(1),
	// runs after cobra has validated the arguments, so a missing path never reaches the RPC
	PreRunE: preRunSetupRpcClient,
	RunE:    brainstormCheckRun,
}

var brainstormJudgeCmd = &cobra.Command{
	Use:   "judge <brainstorm.json>",
	Short: "start the judge: a blind one-shot session weighs the open question's approaches and its result comes back as one line",
	Args:  cobra.ExactArgs(1),
	// runs after cobra has validated the arguments, so a missing path never reaches the RPC
	PreRunE: preRunSetupRpcClient,
	RunE:    brainstormJudgeRun,
}

var brainstormCloseCmd = &cobra.Command{
	Use:   "close <brainstorm.json>",
	Short: "close this agent's brainstorm in the cockpit: its pane, tab and Chat card go, the file stays (writing it again reopens it)",
	Args:  cobra.ExactArgs(1),
	// runs after cobra has validated the arguments, so a missing path never reaches the RPC
	PreRunE: preRunSetupRpcClient,
	RunE:    brainstormCloseRun,
}

func init() {
	brainstormJudgeCmd.Flags().String("line", "", "the user's pushback or \"double check\" as they typed it, for a rerun")
	brainstormCmd.AddCommand(brainstormCheckCmd)
	brainstormCmd.AddCommand(brainstormJudgeCmd)
	brainstormCmd.AddCommand(brainstormCloseCmd)
	rootCmd.AddCommand(brainstormCmd)
}

func brainstormCloseRun(cmd *cobra.Command, args []string) error {
	send := func(data wshrpc.CommandUiBrainstormCloseData) (string, error) {
		return wshclient.UiBrainstormCloseCommand(RpcClient, data, uiOpts())
	}
	notice, err := brainstormCloseStart(os.Getenv("WAVETERM_BLOCKID"), args[0], send)
	if err != nil {
		return uiErr(err)
	}
	printNotice(notice)
	return nil
}

// brainstormCloseStart resolves the path to absolute and asks the cockpit, which holds the pane, to close it for the
// caller's agent: only the agent's own terminal names which agent that is.
func brainstormCloseStart(blockId, file string, send func(wshrpc.CommandUiBrainstormCloseData) (string, error)) (string, error) {
	if blockId == "" {
		return "", fmt.Errorf("run wsh brainstorm close from the agent's terminal (WAVETERM_BLOCKID is not set)")
	}
	abs, err := brainstormAbsPath(file)
	if err != nil {
		return "", err
	}
	return send(wshrpc.CommandUiBrainstormCloseData{File: abs, CallerBlockId: blockId})
}

func brainstormCheckRun(cmd *cobra.Command, args []string) error {
	oref, err := resolveBlockArg()
	if err != nil {
		return err
	}
	send := func(data wshrpc.CommandBrainstormCheckData) error {
		return wshclient.BrainstormCheckCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	}
	if err := brainstormCheckStart(oref.OID, args[0], send); err != nil {
		return err
	}
	fmt.Println("builder check started")
	return nil
}

// brainstormCheckStart resolves the path to absolute and hands it with the caller's block to send.
func brainstormCheckStart(blockId, file string, send func(wshrpc.CommandBrainstormCheckData) error) error {
	abs, err := brainstormAbsPath(file)
	if err != nil {
		return err
	}
	return send(wshrpc.CommandBrainstormCheckData{BlockId: blockId, File: abs})
}

func brainstormJudgeRun(cmd *cobra.Command, args []string) error {
	oref, err := resolveBlockArg()
	if err != nil {
		return err
	}
	line, _ := cmd.Flags().GetString("line")
	send := func(data wshrpc.CommandBrainstormJudgeData) error {
		return wshclient.BrainstormJudgeCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	}
	if err := brainstormJudgeStart(oref.OID, args[0], line, send); err != nil {
		return err
	}
	fmt.Println("judge started")
	return nil
}

// brainstormJudgeStart resolves the path to absolute and hands it with the caller's block and the user's line,
// verbatim, to send.
func brainstormJudgeStart(blockId, file, line string, send func(wshrpc.CommandBrainstormJudgeData) error) error {
	abs, err := brainstormAbsPath(file)
	if err != nil {
		return err
	}
	return send(wshrpc.CommandBrainstormJudgeData{BlockId: blockId, File: abs, Line: line})
}

// brainstormAbsPath resolves file to absolute: the server reads it from its own working directory.
func brainstormAbsPath(file string) (string, error) {
	if file == "" {
		return "", fmt.Errorf("pass the path of the brainstorm.json")
	}
	abs, err := filepath.Abs(file)
	if err != nil {
		return "", fmt.Errorf("resolving %q: %w", file, err)
	}
	return abs, nil
}

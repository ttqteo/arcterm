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

// The RPC timeouts, under the 10 s the harness and the arc mod each give a call before they go on without it.
const (
	verifyReportTimeoutMs = 8000
	verifyStateTimeoutMs  = 9000
)

var verifyCmd = &cobra.Command{
	Use:   "verify",
	Short: "the scenario results of this agent: report one, read its state, ask the merge gate",
	Long: "Verify keeps, for the agent whose terminal this is, the newest run of each CDP scenario (task verify:ui), " +
		"and shows them on its rail. The block comes from WAVETERM_BLOCKID, so these run only in an agent's terminal.",
}

var verifyReportCmd = &cobra.Command{
	Use:     "report",
	Short:   "store one report of a scenario run (one JSON document on stdin; scripts/cdp/report.mjs sends them)",
	Args:    cobra.NoArgs,
	PreRunE: verifyPreRun,
	RunE:    verifyReportRun,
}

var verifyStatusCmd = &cobra.Command{
	Use:     "status",
	Short:   "print this agent's Verify state as JSON: its rows, the not-run warning and the verdict",
	Args:    cobra.NoArgs,
	PreRunE: verifyPreRun,
	RunE:    verifyStatusRun,
}

var verifyGateCmd = &cobra.Command{
	Use:     "gate",
	Short:   `print {"ask":…,"reason":…}: whether a merge command wants an ask while Verify is red or amber`,
	Args:    cobra.NoArgs,
	PreRunE: verifyPreRun,
	RunE:    verifyGateRun,
}

func init() {
	verifyStatusCmd.Flags().String("cwd", "", "the checkout to read the changed files in (default: the working directory)")
	verifyGateCmd.Flags().String("cwd", "", "the directory the command runs in")
	verifyGateCmd.Flags().String("command", "", "the Bash command the agent is about to run")
	verifyCmd.AddCommand(verifyReportCmd, verifyStatusCmd, verifyGateCmd)
	rootCmd.AddCommand(verifyCmd)
}

var errVerifyNoBlock = errors.New("not in an arcterm agent's terminal")

// verifyBlockId is the agent's block, from the environment arcterm gives its terminal.
func verifyBlockId() (string, error) {
	blockId := os.Getenv("WAVETERM_BLOCKID")
	if blockId == "" {
		return "", errVerifyNoBlock
	}
	return blockId, nil
}

// verifyPreRun checks the block before it connects, so outside an agent's terminal the answer is the block error, at
// once, whether or not there is a wavesrv to reach.
func verifyPreRun(cmd *cobra.Command, args []string) error {
	if _, err := verifyBlockId(); err != nil {
		return err
	}
	return preRunSetupRpcClient(cmd, args)
}

// verifyReportFromReader reads the one report document on stdin and puts the block on it. The block is the
// environment's own: a document that names another is overwritten, so a harness cannot report into another tile.
func verifyReportFromReader(r io.Reader, blockId string) (wshrpc.CommandVerifyReportData, error) {
	var data wshrpc.CommandVerifyReportData
	dec := json.NewDecoder(r)
	if err := dec.Decode(&data); err != nil {
		if errors.Is(err, io.EOF) {
			return data, errors.New("no report on stdin: expected one JSON document")
		}
		return data, fmt.Errorf("reading the report from stdin: %w", err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return data, errors.New("reading the report from stdin: more than one JSON document")
	}
	data.BlockId = blockId
	return data, nil
}

func verifyReportRun(cmd *cobra.Command, args []string) error {
	blockId, err := verifyBlockId()
	if err != nil {
		return err
	}
	data, err := verifyReportFromReader(os.Stdin, blockId)
	if err != nil {
		return err
	}
	if err := wshclient.VerifyReportCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: verifyReportTimeoutMs}); err != nil {
		return fmt.Errorf("sending the verify report: %w", err)
	}
	return nil
}

// verifyCwd is the --cwd given, or the working directory.
func verifyCwd(flag string) (string, error) {
	if flag != "" {
		return flag, nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("reading the working directory: %w", err)
	}
	return cwd, nil
}

func verifyStatusRun(cmd *cobra.Command, args []string) error {
	blockId, err := verifyBlockId()
	if err != nil {
		return err
	}
	cwd, err := verifyCwd(mustFlagString(cmd, "cwd"))
	if err != nil {
		return err
	}
	st, err := wshclient.GetVerifyStateCommand(RpcClient, wshrpc.CommandVerifyStateData{BlockId: blockId, Cwd: cwd},
		&wshrpc.RpcOpts{Timeout: verifyStateTimeoutMs})
	if err != nil {
		return fmt.Errorf("reading the verify state: %w", err)
	}
	return jsonOut(st)
}

// verifyGateData is the gate's question. Both flags are needed: the gate judges the checkout the merge runs in, which
// is not always the agent's own, so there is no default for --cwd as there is for status.
func verifyGateData(blockId, cwd, command string) (wshrpc.CommandVerifyGateData, error) {
	if cwd == "" {
		return wshrpc.CommandVerifyGateData{}, errors.New("--cwd is required: the directory the command runs in")
	}
	if command == "" {
		return wshrpc.CommandVerifyGateData{}, errors.New("--command is required: the Bash command about to run")
	}
	return wshrpc.CommandVerifyGateData{BlockId: blockId, Cwd: cwd, Command: command}, nil
}

// verifyGateLine is the one JSON line the mod reads. It always carries both keys: wshrpc.VerifyGateData leaves an empty
// reason out, and the mod should not have to guess at a missing one.
func verifyGateLine(g wshrpc.VerifyGateData) (string, error) {
	line := struct {
		Ask    bool   `json:"ask"`
		Reason string `json:"reason"`
	}{g.Ask, g.Reason}
	b, err := json.Marshal(line)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func verifyGateRun(cmd *cobra.Command, args []string) error {
	blockId, err := verifyBlockId()
	if err != nil {
		return err
	}
	data, err := verifyGateData(blockId, mustFlagString(cmd, "cwd"), mustFlagString(cmd, "command"))
	if err != nil {
		return err
	}
	gate, err := wshclient.VerifyGateCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: verifyStateTimeoutMs})
	if err != nil {
		return fmt.Errorf("asking the verify gate: %w", err)
	}
	line, err := verifyGateLine(*gate)
	if err != nil {
		return err
	}
	WriteStdout("%s\n", line)
	return nil
}

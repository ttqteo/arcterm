// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var jarvisCmd = &cobra.Command{
	Use:   "jarvis",
	Short: "report run progress to Jarvis (used by an orchestrator lead)",
}

var jarvisCtxCmd = &cobra.Command{
	Use:     "ctx",
	Short:   "print the run context (channel/run/dag) owning this session",
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		oref, err := resolveBlockArg()
		if err != nil {
			return fmt.Errorf("resolving block: %w", err)
		}
		rtn, err := wshclient.JarvisCtxCommand(RpcClient, wshrpc.CommandJarvisCtxData{BlockORef: oref.String()}, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			return err
		}
		if rtn.RunId == "" {
			fmt.Println("no run context (this block is not a run worker)")
			return nil
		}
		fmt.Printf("channel: %s\nrun: %s\n", rtn.ChannelId, rtn.RunId)
		if rtn.DagOID != "" {
			fmt.Printf("dag: %s\n", rtn.DagOID)
		}
		if rtn.Goal != "" {
			fmt.Printf("goal: %s\n", rtn.Goal)
		}
		return nil
	},
}

var jarvisCompleteCmd = &cobra.Command{
	Use:   "complete [deliverable-path]",
	Short: "mark the current run's phase complete (optionally recording its deliverable)",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		var artifacts []string
		if len(args) > 0 && args[0] != "" {
			artifacts = []string{args[0]} // the deliverable path the next phase builds on / the gate previews
		}
		commit, _ := cmd.Flags().GetString("commit")
		reportPath, _ := cmd.Flags().GetString("report")
		var report string
		if reportPath != "" {
			r, err := readReportFile(reportPath)
			if err != nil {
				return err
			}
			report = r
		}
		holdLand, _ := cmd.Flags().GetBool("hold-land")
		forceLand, _ := cmd.Flags().GetBool("force-land")
		rtn, err := sendRunPhase(wshrpc.CommandReportRunPhaseData{Action: "complete", Artifacts: artifacts, Commit: commit, Report: report, HoldLand: holdLand, ForceLand: forceLand}, completeTimeoutMs)
		if err != nil {
			return err
		}
		fmt.Println("run phase marked complete; the engine takes it from here")
		for _, line := range completeLandLines(rtn) {
			fmt.Println(line)
		}
		return nil
	},
	PreRunE: preRunSetupRpcClient,
}

var jarvisRunCmd = &cobra.Command{
	Use:   "run <task>",
	Short: "spawn a hands-off child run for one unit of work (used by an orchestrator lead)",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		tabId := getTabIdFromEnv()
		if tabId == "" {
			return fmt.Errorf("no WAVETERM_TABID env var set")
		}
		mode, _ := cmd.Flags().GetString("mode")
		rtn, err := wshclient.CreateChildRunCommand(RpcClient, wshrpc.CommandCreateChildRunData{
			ORef: waveobj.MakeORef(waveobj.OType_Tab, tabId).String(),
			Goal: strings.Join(args, " "),
			Mode: mode,
		}, nil)
		if err != nil {
			return err
		}
		fmt.Printf("%s\n", rtn.RunId)
		return nil
	},
	PreRunE: preRunSetupRpcClient,
}

func init() {
	jarvisRunCmd.Flags().String("mode", "", "child run mode: quick|orchestrator (default: inherit the channel strategy)")
	jarvisCompleteCmd.Flags().String("commit", "", "SHA of your finished work (e.g. $(git rev-parse HEAD)); scopes this run's evidence diff to its own commits")
	jarvisCompleteCmd.Flags().String("report", "", "path to a file holding your final report; read relative to this process's working directory and sealed as the run's evidence summary")
	jarvisCompleteCmd.Flags().Bool("hold-land", false, "complete even though the run's branch conflicts with its base; the land stays held for the human")
	jarvisCompleteCmd.Flags().Bool("force-land", false, "land the run's branch even though its final stage failed; only after the human chose it")
	jarvisCompleteCmd.MarkFlagsMutuallyExclusive("hold-land", "force-land")
	jarvisCmd.AddCommand(jarvisCompleteCmd)
	jarvisCmd.AddCommand(jarvisRunCmd)
	jarvisCmd.AddCommand(jarvisCtxCmd)
	rootCmd.AddCommand(jarvisCmd)
}

// readReportFile reads a lead's report from path, relative to this process's working directory. An
// unreadable or empty (after trimming) file is an error, so `wsh jarvis complete --report` never sends
// an empty summary.
func readReportFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("reading report file %q: %w", path, err)
	}
	report := strings.TrimSpace(string(data))
	if report == "" {
		return "", fmt.Errorf("report file %q is empty", path)
	}
	return report, nil
}

// runPhaseTimeoutMs bounds a hold or a complete that makes no land. The server's write is cancelled with the
// client's budget, and the store can be busy behind an engine tick for longer than the 5s default; a lost complete
// leaves the task running with nobody told.
const runPhaseTimeoutMs = 30_000

// completeTimeoutMs bounds `wsh jarvis complete`: a lead's complete seals the run's evidence (wshserver's
// evidenceSealTimeout, 30s) and then lands its branch before it returns.
const completeTimeoutMs = runsLandTimeoutMs + 30_000

func reportRunPhase(data wshrpc.CommandReportRunPhaseData) error {
	_, err := sendRunPhase(data, runPhaseTimeoutMs)
	return err
}

func sendRunPhase(data wshrpc.CommandReportRunPhaseData, timeoutMs int64) (*wshrpc.CommandReportRunPhaseRtnData, error) {
	tabId := getTabIdFromEnv()
	if tabId == "" {
		return nil, fmt.Errorf("no WAVETERM_TABID env var set")
	}
	data.ORef = waveobj.MakeORef(waveobj.OType_Tab, tabId).String()
	return wshclient.ReportRunPhaseCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: timeoutMs})
}

// completeLandLines are the land's outcome as complete prints it, for the lead to put in its report: "landed
// <sha>", or "held: <reason>". None when the complete made no land.
func completeLandLines(rtn *wshrpc.CommandReportRunPhaseRtnData) []string {
	switch {
	case rtn == nil:
		return nil
	case rtn.LandError != "":
		return []string{"land failed: " + rtn.LandError}
	case rtn.Land == nil:
		return nil
	}
	l := rtn.Land
	var lines []string
	switch l.State {
	case orchestrate.LandState_Landed:
		lines = append(lines, "landed "+l.Commit)
	case orchestrate.LandState_Held:
		line := "held: " + l.Reason
		if l.Dirty {
			line += "; those changes are not yours to touch: the engine lands the run by itself once they are gone"
		}
		lines = append(lines, line)
	default:
		lines = append(lines, "land "+l.State)
	}
	for _, note := range l.Notes {
		lines = append(lines, "note: "+note)
	}
	return lines
}

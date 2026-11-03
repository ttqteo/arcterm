// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/workflowscan"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// the default wshrpc budget binds the server's ctx, and the Sonnet pass alone may take 15 minutes
const workflowScanTimeoutMs = 20 * 60 * 1000

var workflowCmd = &cobra.Command{
	Use:   "workflow",
	Short: "workflow scan: find recurring workflow problems in the recent run records and propose fixes",
	Args:  cobra.NoArgs,
	RunE:  func(cmd *cobra.Command, args []string) error { return cmd.Help() },
}

var workflowScanCmd = &cobra.Command{
	Use:   "scan",
	Short: "print the recounted patterns of the recent run records (run by a scan run's agent); --start starts a scan run",
	Long: `Without --start, read the last --window days of every project's run records, have Sonnet name the
patterns that recur, recount them against the records, and print the survivors and the patterns under the
floor. Only a scan run's agent can run it; it takes a few minutes.

With --start, start a scan run in this project (or --project / --channel) and print its id. The scan's agent
proposes a fix for each pattern and asks you which to apply.`,
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE:    workflowScanRun,
}

var workflowResultCmd = &cobra.Command{
	Use:     "result <file>",
	Short:   `store the scan's verdicts, a JSON file {"verdicts":[...]} (run by a scan run's agent)`,
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    workflowResultRun,
}

func init() {
	f := workflowScanCmd.Flags()
	f.Int("window", 0, "days of run records to read (default 14)")
	f.Bool("start", false, "start a scan run instead of scanning")
	f.String("project", "", "with --start: project directory (default: the current directory)")
	f.String("channel", "", "with --start: channel id, instead of resolving the project")
	workflowCmd.AddCommand(workflowScanCmd, workflowResultCmd)
	rootCmd.AddCommand(workflowCmd)
}

func workflowTabORef() (string, error) {
	tabId := getTabIdFromEnv()
	if tabId == "" {
		return "", fmt.Errorf("no WAVETERM_TABID env var set")
	}
	return waveobj.MakeORef(waveobj.OType_Tab, tabId).String(), nil
}

func workflowScanRun(cmd *cobra.Command, args []string) error {
	window, _ := cmd.Flags().GetInt("window")
	if start, _ := cmd.Flags().GetBool("start"); start {
		return workflowStart(cmd, window)
	}
	oref, err := workflowTabORef()
	if err != nil {
		return err
	}
	scan, err := wshclient.WorkflowScanCommand(RpcClient, wshrpc.CommandWorkflowScanData{ORef: oref, WindowDays: window},
		&wshrpc.RpcOpts{Timeout: workflowScanTimeoutMs})
	if err != nil {
		return err
	}
	printWorkflowScan(os.Stdout, scan)
	return nil
}

func workflowStart(cmd *cobra.Command, window int) error {
	ch, err := runsChannel(cmd, true)
	if err != nil {
		return err
	}
	wsId, err := runsWorkspaceId()
	if err != nil {
		return err
	}
	rtn, err := wshclient.WorkflowScanStartCommand(RpcClient, wshrpc.CommandWorkflowScanStartData{
		ChannelId: ch.OID, WorkspaceId: wsId, WindowDays: window,
	}, &wshrpc.RpcOpts{Timeout: runsStartTimeoutMs})
	if err != nil {
		return err
	}
	fmt.Printf("started workflow scan %s in %s\n", rtn.Run.ID, ch.Name)
	return nil
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func workflowProjects(ps []waveobj.WorkflowScanProject) string {
	parts := make([]string, len(ps))
	for i, p := range ps {
		parts[i] = fmt.Sprintf("%s (%d)", p.Name, p.Runs)
	}
	return strings.Join(parts, ", ")
}

// printWorkflowScan is what the scan's agent reads: every survivor with its evidence, then the patterns under
// the floor, for context.
func printWorkflowScan(w io.Writer, s *waveobj.WorkflowScan) {
	fmt.Fprintf(w, "read %s in %s over %s; Sonnet named %s, %d survived the recount\n",
		plural(s.Runs, "run"), plural(s.Projects, "project"), plural(s.WindowDays, "day"), plural(s.Candidates, "pattern"), s.Kept)
	if s.Dropped > 0 {
		fmt.Fprintf(w, "%s dropped for size\n", plural(s.Dropped, "oldest run"))
	}
	if len(s.Survivors) == 0 {
		fmt.Fprintf(w, "\nno pattern reached %d runs\n", workflowscan.Floor)
	}
	for _, p := range s.Survivors {
		fmt.Fprintf(w, "\n%s  %s\n", p.Id, p.Title)
		fmt.Fprintf(w, "    fix target: %s\n", p.FixTarget)
		fmt.Fprintf(w, "    %s over %s\n", plural(p.Runs, "run"), plural(p.Days, "day"))
		fmt.Fprintf(w, "    projects: %s\n", workflowProjects(p.Projects))
		for _, q := range p.Quotes {
			fmt.Fprintf(w, "    run %s (%s, %s): %q\n", q.RunId, q.Project, q.Date, q.Text)
		}
	}
	if len(s.UnderFloor) > 0 {
		fmt.Fprintf(w, "\nunder %d runs, for context only:\n", workflowscan.Floor)
		for _, p := range s.UnderFloor {
			fmt.Fprintf(w, "  %s · %s · %s over %s\n", p.Title, p.FixTarget, plural(p.Runs, "run"), plural(p.Days, "day"))
		}
	}
}

func workflowResultRun(cmd *cobra.Command, args []string) error {
	raw, err := os.ReadFile(args[0])
	if err != nil {
		return fmt.Errorf("reading the result: %w", err)
	}
	var result struct {
		Verdicts []waveobj.WorkflowScanVerdict `json:"verdicts"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("parsing %s: %w", args[0], err)
	}
	oref, err := workflowTabORef()
	if err != nil {
		return err
	}
	if err := wshclient.WorkflowScanResultCommand(RpcClient, wshrpc.CommandWorkflowScanResultData{ORef: oref, Verdicts: result.Verdicts},
		&wshrpc.RpcOpts{Timeout: runsReadTimeoutMs}); err != nil {
		return err
	}
	fmt.Printf("stored %s\n", plural(len(result.Verdicts), "verdict"))
	return nil
}

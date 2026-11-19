// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const bugReportNoText = "(no text)"

var bugReportCmd = &cobra.Command{
	Use:   "bugreport",
	Short: "list the arcterm bug reports the person saved, and mark the ones you finished",
	Long: `Bug reports are what the person saves with the bug button in arcterm's footer: a folder under reports/ in the
data dir holding report.json (id, text, version, surface, agent, state), screen.png (missing when the capture failed)
and log.txt (the last minutes of waveapp.log).

A report is in one of three states:
  waiting   saved, no agent has taken it yet
  handling  the agent Process started holds it
  done      handled, with a one-line outcome (a run, an initiative); its folder moves to reports/done/

You read a report from its folder; never edit report.json by hand. Use "wsh bugreport list" to see the reports and
"wsh bugreport done" to mark each one you finished, so the state rules stay in one place.`,
}

// bugReportListState checks --state: empty (waiting and handling), or one of the three states.
func bugReportListState(raw string) (string, error) {
	state := strings.ToLower(strings.TrimSpace(raw))
	switch state {
	case "", wshrpc.BugReportState_Waiting, wshrpc.BugReportState_Handling, wshrpc.BugReportState_Done:
		return state, nil
	}
	return "", fmt.Errorf("--state %q is not a bug-report state: use %s, %s or %s (or leave it out for waiting and handling)",
		raw, wshrpc.BugReportState_Waiting, wshrpc.BugReportState_Handling, wshrpc.BugReportState_Done)
}

// bugReportFirstLine is the first line of a report's text that holds something, on one line of the listing.
func bugReportFirstLine(text string) string {
	for line := range strings.SplitSeq(text, "\n") {
		line = strings.TrimSpace(strings.ReplaceAll(line, "\t", " "))
		if line != "" {
			return line
		}
	}
	return bugReportNoText
}

// bugReportListText is the plain listing: one line per report, tab-separated: id, state, the first line of its text,
// its folder. state is the filter that was asked for, so an empty listing says what it was empty of.
func bugReportListText(reports []wshrpc.BugReport, state string) string {
	if len(reports) == 0 {
		if state == "" {
			return "no waiting or handling bug reports"
		}
		return fmt.Sprintf("no %s bug reports", state)
	}
	lines := make([]string, 0, len(reports))
	for _, r := range reports {
		lines = append(lines, strings.Join([]string{r.Id, r.State, bugReportFirstLine(r.Text), r.Dir}, "\t"))
	}
	return strings.Join(lines, "\n")
}

// bugReportsForJSON is the reports for --json: no reports is [], never null, so a script can loop over it.
func bugReportsForJSON(reports []wshrpc.BugReport) []wshrpc.BugReport {
	if reports == nil {
		return []wshrpc.BugReport{}
	}
	return reports
}

var bugReportListCmd = &cobra.Command{
	Use:   "list",
	Short: "list bug reports: id, state, the first line of the text, the folder",
	Long: `List the bug reports, one per line: id, state, the first line of the person's text and the report's folder
(tab-separated). Read the folder for the picture, the log and the full text.

Without --state it lists the reports that still need work, waiting and handling. --state waiting|handling|done lists
one state. --json prints the reports as a JSON array, every field, an empty array when there are none.`,
	Args: cobra.NoArgs,
	PreRunE: func(cmd *cobra.Command, args []string) error {
		if _, err := bugReportListState(mustFlagString(cmd, "state")); err != nil {
			return err
		}
		return preRunSetupRpcClient(cmd, args)
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		state, err := bugReportListState(mustFlagString(cmd, "state"))
		if err != nil {
			return err
		}
		reports, err := wshclient.BugReportListCommand(RpcClient, wshrpc.CommandBugReportListData{State: state}, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(bugReportsForJSON(reports))
		}
		fmt.Println(bugReportListText(reports, state))
		return nil
	},
}

// bugReportDoneData builds the done call from the command line, or says what to give; it needs no RPC.
func bugReportDoneData(args []string, outcome, runId, effortOID string) (wshrpc.CommandBugReportDoneData, error) {
	switch {
	case len(args) == 0:
		return wshrpc.CommandBugReportDoneData{}, fmt.Errorf(
			"give the id of the report you finished: wsh bugreport done <id> --outcome \"<one line>\" (`wsh bugreport list --state handling` lists the ids)")
	case len(args) > 1:
		return wshrpc.CommandBugReportDoneData{}, fmt.Errorf(
			"mark one report per call, got %d ids: run wsh bugreport done <id> --outcome \"<one line>\" for each", len(args))
	}
	outcome = strings.TrimSpace(outcome)
	if outcome == "" {
		return wshrpc.CommandBugReportDoneData{}, fmt.Errorf(
			"--outcome is required: say in one line what was done with the report (the run it started, the initiative, the answer)")
	}
	return wshrpc.CommandBugReportDoneData{
		Id: strings.TrimSpace(args[0]),
		Outcome: wshrpc.BugReportOutcome{
			Text:      outcome,
			RunId:     strings.TrimSpace(runId),
			EffortOID: strings.TrimSpace(effortOID),
		},
	}, nil
}

func bugReportDoneFromFlags(cmd *cobra.Command, args []string) (wshrpc.CommandBugReportDoneData, error) {
	return bugReportDoneData(args, mustFlagString(cmd, "outcome"), mustFlagString(cmd, "run"), mustFlagString(cmd, "effort"))
}

var bugReportDoneCmd = &cobra.Command{
	Use:   "done <id>",
	Short: "mark a report you finished: --outcome <one line> [--run <id>] [--effort <oid>]",
	Long: `Mark one bug report done. --outcome (required) is one line on what was done with it. --run <id> names the run you
started for it and --effort <oid> the initiative you made, when there is one.

Only a report in the handling state can be marked done, that is, one the agent Process started holds for you. A
report you asked the person a question about stays handling until the answer is acted on.

Example:
  wsh bugreport done 20261119-153012 --outcome "fixed: the footer no longer jumps" --run 3f9c1a`,
	Args: cobra.ArbitraryArgs, // checked in bugReportDoneData, so the error says what to do
	PreRunE: func(cmd *cobra.Command, args []string) error {
		if _, err := bugReportDoneFromFlags(cmd, args); err != nil {
			return err
		}
		return preRunSetupRpcClient(cmd, args)
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		data, err := bugReportDoneFromFlags(cmd, args)
		if err != nil {
			return err
		}
		if err := wshclient.BugReportDoneCommand(RpcClient, data, nil); err != nil {
			return err
		}
		fmt.Printf("marked bug report %s done\n", data.Id)
		return nil
	},
}

func init() {
	bugReportListCmd.Flags().String("state", "", "only reports in this state: waiting, handling or done (default: waiting and handling)")
	bugReportListCmd.Flags().Bool("json", false, "JSON output")
	bugReportDoneCmd.Flags().String("outcome", "", "one line on what was done with the report (required)")
	bugReportDoneCmd.Flags().String("run", "", "the id of the run you started for the report")
	bugReportDoneCmd.Flags().String("effort", "", "the oid of the initiative you made for the report")
	bugReportCmd.AddCommand(bugReportListCmd, bugReportDoneCmd)
	rootCmd.AddCommand(bugReportCmd)
}

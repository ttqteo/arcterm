// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// jobslotForgetCmd drops a measured peak the heavy-job queue admits a command on: the queue asks for the largest of
// the command's last five peaks × 1.2, so one run measured wrong holds every later run back until four more runs push
// it out. The hooks call `wsh jobslot -- <command>`, and cobra looks for no subcommand past `--`, so a command named
// "forget" still reaches jobslot itself.
var jobslotForgetCmd = &cobra.Command{
	Use:   "forget <command>",
	Short: "drop the largest measured RAM peak of a command, which the heavy-job queue admits its next run on",
	Long: "Drops the largest RAM peak arcterm measured for <command> in this directory's project, so a run that " +
		"measured wrong stops holding the command's next runs back. <command> is the name the Jobs popover shows " +
		"(scripts/verify.mjs, task check:ts) or a command line that runs it. --all drops every kept peak, and the " +
		"next run is admitted on memgate's table figure.",
	Args:    cobra.ExactArgs(1),
	RunE:    jobslotForgetRun,
	PreRunE: preRunSetupRpcClient,
}

var jobslotForgetAll bool

func init() {
	jobslotForgetCmd.Flags().BoolVar(&jobslotForgetAll, "all", false, "drop every kept peak, not only the largest")
	jobslotCmd.AddCommand(jobslotForgetCmd)
}

func jobslotForgetRun(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("reading the working directory: %w", err)
	}
	res, err := wshclient.JobPeaksForgetCommand(RpcClient, wshrpc.CommandJobPeaksForgetData{
		Command: args[0], Cwd: cwd, All: jobslotForgetAll,
	}, nil)
	if err != nil {
		return err
	}
	jobslotForgetReport(os.Stdout, res)
	return nil
}

// jobslotForgetReport says what was dropped, what is kept and what the queue asks for the next run.
func jobslotForgetReport(w io.Writer, res *wshrpc.JobPeaksForgetResult) {
	where := "outside any repository"
	if res.Project != "" {
		where = "in " + res.Project
	}
	fmt.Fprintf(w, "%s %s: dropped %s\n", res.Pattern, where, gbList(res.Dropped))
	if len(res.Left) > 0 {
		fmt.Fprintf(w, "kept, newest first: %s\n", gbList(res.Left))
	}
	if res.Measured {
		fmt.Fprintf(w, "the next run is admitted on %s\n", memgate.FormatGB(res.Bytes))
	} else {
		fmt.Fprintln(w, "the next run is admitted on memgate's table figure")
	}
}

func gbList(peaks []uint64) string {
	parts := make([]string, len(peaks))
	for i, p := range peaks {
		parts[i] = memgate.FormatGB(p)
	}
	return strings.Join(parts, ", ")
}

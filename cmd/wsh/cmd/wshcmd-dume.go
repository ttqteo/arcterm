// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const dumeStatusTimeoutMs = 5000

var dumeStatusAsJSON bool

var dumeCmd = &cobra.Command{
	Use:   "dume",
	Short: "DUM-E spends a 5-hour window's leftover quota on the initiative chunks owned by dum-e (Settings > Runs & limits)",
}

var dumeStatusCmd = &cobra.Command{
	Use:     "status",
	Short:   "say whether DUM-E is on, what it last decided and why, and where its chunks stand",
	Args:    cobra.NoArgs,
	RunE:    dumeStatusRun,
	PreRunE: preRunSetupRpcClient,
}

func dumeStatusRun(cmd *cobra.Command, args []string) error {
	d, err := wshclient.DumeStatusCommand(RpcClient, &wshrpc.RpcOpts{Timeout: dumeStatusTimeoutMs})
	if err != nil {
		return fmt.Errorf("reading DUM-E's status: %w", err)
	}
	if dumeStatusAsJSON {
		return jsonOut(d)
	}
	WriteStdout("%s", dumeStatusText(d, time.Now()))
	return nil
}

// dumeStatusText is what `wsh dume status` prints. Every line ends in a newline. now sets the clock the "last check"
// time is shown in and what "resets in" counts from. DecidedTs is unix ms; FiveHourReset is epoch seconds.
func dumeStatusText(d *wshrpc.DumeStatusData, now time.Time) string {
	var b strings.Builder
	onBoard := d.Running != nil || d.Waiting != 0 || len(d.ToLand) != 0 || d.Blocked != 0 || d.Done != 0
	switch {
	case !d.Enabled:
		b.WriteString("DUM-E: off (Settings → Runs & limits → DUM-E)\n")
		if !onBoard {
			return b.String()
		}
	case d.Reason == "":
		// the loop's first tick is minutes after launch: no reading, so no counts either
		b.WriteString("DUM-E: on, not checked yet\n")
		return b.String()
	default:
		b.WriteString("DUM-E: on\n")
		b.WriteString(dumeLastCheckLine(d, now))
		if line := dumeWindowLine(d, now); line != "" {
			b.WriteString(line)
		}
	}
	if d.Running != nil {
		fmt.Fprintf(&b, "running: %s%s\n", dumeChunkLabel(*d.Running), dumeRunSuffix(*d.Running))
	}
	fmt.Fprintf(&b, "waiting %d · to land %d · blocked %d · done %d\n", d.Waiting, len(d.ToLand), d.Blocked, d.Done)
	for _, c := range d.ToLand {
		fmt.Fprintf(&b, "  %s: git merge %s\n", dumeChunkLabel(c), c.Branch)
	}
	return b.String()
}

func dumeChunkLabel(c wshrpc.DumeChunk) string {
	return c.Effort + " · " + c.Chunk
}

// dumeRunSuffix is " (run <first 8 of the id>, <branch>)", with whichever of the two is known
func dumeRunSuffix(c wshrpc.DumeChunk) string {
	var parts []string
	if c.RunId != "" {
		id := c.RunId
		if len(id) > 8 {
			id = id[:8]
		}
		parts = append(parts, "run "+id)
	}
	if c.Branch != "" {
		parts = append(parts, c.Branch)
	}
	if len(parts) == 0 {
		return ""
	}
	return " (" + strings.Join(parts, ", ") + ")"
}

// dumeLastCheckLine: the time alone for a check made today, with the date for an older one
func dumeLastCheckLine(d *wshrpc.DumeStatusData, now time.Time) string {
	if d.DecidedTs == 0 {
		return fmt.Sprintf("last check: %s\n", d.Reason)
	}
	at := time.UnixMilli(d.DecidedTs).In(now.Location())
	layout := "15:04"
	if y, m, day := at.Date(); y != now.Year() || m != now.Month() || day != now.Day() {
		layout = "01-02 15:04"
	}
	return fmt.Sprintf("last check %s: %s\n", at.Format(layout), d.Reason)
}

// dumeWindowLine reads the gate's last 5h reading; "" when it saw none
func dumeWindowLine(d *wshrpc.DumeStatusData, now time.Time) string {
	if d.FiveHourPct == nil && d.FiveHourReset == nil {
		return ""
	}
	var parts []string
	if d.FiveHourPct != nil {
		parts = append(parts, fmt.Sprintf("%.0f%% used", *d.FiveHourPct))
	}
	if d.FiveHourReset != nil {
		left := time.Unix(*d.FiveHourReset, 0).Sub(now)
		switch {
		case left <= 0:
			parts = append(parts, "resetting now")
		case left < time.Hour:
			parts = append(parts, fmt.Sprintf("resets in %d min", int(left.Minutes())))
		default:
			parts = append(parts, fmt.Sprintf("resets in %dh%02d", int(left.Hours()), int(left.Minutes())%60))
		}
	}
	return "5h window " + strings.Join(parts, ", ") + "\n"
}

func init() {
	dumeStatusCmd.Flags().BoolVar(&dumeStatusAsJSON, "json", false, "JSON output (the full status)")
	dumeCmd.AddCommand(dumeStatusCmd)
	rootCmd.AddCommand(dumeCmd)
}

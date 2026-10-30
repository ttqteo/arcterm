// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/storage"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	storageWaitPoll = time.Second
	// a scan walks every project's trees, sessions and caches
	storageWaitLimit  = 30 * time.Minute
	storageTimeLayout = "2006-01-02 15:04"
	// a clean removes items one by one, a run tree through git
	storageCleanTimeoutMs = 10 * 60 * 1000
)

var (
	storageWait   bool
	storageAll    bool
	storageAsJSON bool
)

var storageCmd = &cobra.Command{
	Use:   "storage",
	Short: "see and clean what arcterm and its runs leave on disk: run trees, old sessions, logs, build output (Settings > Storage)",
}

var storageReportCmd = &cobra.Command{
	Use:     "report",
	Short:   "print the last scan by category, with each item's id and whether clean takes it",
	Args:    cobra.NoArgs,
	RunE:    storageReportRun,
	PreRunE: preRunSetupRpcClient,
}

var storageScanCmd = &cobra.Command{
	Use:     "scan",
	Short:   "start a fresh scan; --wait blocks until it ends and prints the report",
	Args:    cobra.NoArgs,
	RunE:    storageScanRun,
	PreRunE: preRunSetupRpcClient,
}

var storageCleanCmd = &cobra.Command{
	Use:   "clean <category> [id...]",
	Short: "remove the named items of a category that lose nothing; --all takes every one the scan marked cleanable",
	Long: `Remove items the scan marked cleanable. Each is re-checked right before it goes, so an item that changed
since the scan (its run restarted, a file changed in its tree) is skipped, not removed. A guarded item (a
run tree with uncommitted changes, or one whose run is not in this app's store) is always skipped: only
` + "`wsh storage delete`" + ` removes it. Categories: ` + strings.Join(storageCategoryNames(), ", ") + `.`,
	Args:    cobra.MinimumNArgs(1),
	RunE:    storageCleanRun,
	PreRunE: preRunSetupRpcClient,
}

var storageDeleteCmd = &cobra.Command{
	Use:   "delete <category> <id>",
	Short: "remove one guarded item (uncommitted changes, an unknown run); only after the user approves",
	Long: `Remove one item that clean skips because it is guarded. What it holds is lost.
Run it only after showing the user the item and what it holds, and getting their approval for this item.`,
	Args:    cobra.ExactArgs(2),
	RunE:    storageDeleteRun,
	PreRunE: preRunSetupRpcClient,
}

func storageCategoryNames() []string {
	return []string{
		string(storage.CategoryRunWorktrees), string(storage.CategorySessions), string(storage.CategoryHousekeeping),
		string(storage.CategoryBuildOutput), string(storage.CategoryCanvases), string(storage.CategoryPackageCaches),
	}
}

func storageReport() (*storage.StorageReport, error) {
	r, err := wshclient.GetStorageCommand(RpcClient, nil)
	if err != nil {
		return nil, fmt.Errorf("reading the storage report: %w", err)
	}
	return r, nil
}

func storageReportRun(cmd *cobra.Command, args []string) error {
	r, err := storageReport()
	if err != nil {
		return err
	}
	if storageAsJSON {
		return jsonOut(r)
	}
	WriteStdout("%s", formatStorageReport(r, time.Local))
	return nil
}

func storageScanRun(cmd *cobra.Command, args []string) error {
	before, err := storageReport()
	if err != nil {
		return err
	}
	if err := wshclient.RescanStorageCommand(RpcClient, nil); err != nil {
		return fmt.Errorf("starting the storage scan: %w", err)
	}
	if !storageWait {
		WriteStdout("scanning; see `wsh storage report`, or pass --wait\n")
		return nil
	}
	r, err := storageWaitScan(before.ScannedTs)
	if err != nil {
		return err
	}
	WriteStdout("%s", formatStorageReport(r, time.Local))
	return nil
}

// storageWaitScan polls until a scan newer than since has finished
func storageWaitScan(since int64) (*storage.StorageReport, error) {
	deadline := time.Now().Add(storageWaitLimit)
	for {
		r, err := storageReport()
		if err != nil {
			return nil, err
		}
		if !r.Scanning && r.ScannedTs > since {
			return r, nil
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("the scan is still running after %s; see `wsh storage report` later", storageWaitLimit)
		}
		time.Sleep(storageWaitPoll)
	}
}

func storageCategory(r *storage.StorageReport, name string) (*storage.StorageCategoryReport, error) {
	for i := range r.Categories {
		if string(r.Categories[i].Category) == name {
			return &r.Categories[i], nil
		}
	}
	return nil, fmt.Errorf("no category %q (one of: %s)", name, strings.Join(storageCategoryNames(), ", "))
}

// storageCleanableIds is what --all cleans: every item a clean may remove now, never a guarded one
func storageCleanableIds(c *storage.StorageCategoryReport) []string {
	var ids []string
	for _, it := range c.Items {
		if it.Cleanable && !it.Guarded {
			ids = append(ids, it.ID)
		}
	}
	return ids
}

func storageCleanRun(cmd *cobra.Command, args []string) error {
	r, err := storageReport()
	if err != nil {
		return err
	}
	c, err := storageCategory(r, args[0])
	if err != nil {
		return err
	}
	ids := args[1:]
	if storageAll {
		if len(ids) > 0 {
			return fmt.Errorf("--all takes no ids")
		}
		ids = storageCleanableIds(c)
	}
	if len(ids) == 0 {
		WriteStdout("nothing to clean in %s\n", c.Category)
		return nil
	}
	return storageClean(wshrpc.CommandCleanStorageData{Category: string(c.Category), ItemIds: ids})
}

func storageDeleteRun(cmd *cobra.Command, args []string) error {
	return storageClean(wshrpc.CommandCleanStorageData{Category: args[0], ItemIds: []string{args[1]}, AllowGuarded: true})
}

func storageClean(data wshrpc.CommandCleanStorageData) error {
	res, err := wshclient.CleanStorageCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: storageCleanTimeoutMs})
	if err != nil {
		return fmt.Errorf("cleaning %s: %w", data.Category, err)
	}
	WriteStdout("%s", formatStorageClean(res))
	return nil
}

func formatStorageSize(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}

// storageItemState says whether clean takes the item, and if not, what does
func storageItemState(it storage.StorageItem) string {
	switch {
	case it.Guarded:
		return "guarded (delete only)"
	case it.Cleanable:
		return "cleanable"
	default:
		return "kept"
	}
}

func formatStorageReport(r *storage.StorageReport, loc *time.Location) string {
	var b strings.Builder
	switch {
	case r.ScannedTs == 0 && r.Scanning:
		b.WriteString("the first scan is running; pass --wait to `wsh storage scan`, or try again shortly\n")
		return b.String()
	case r.ScannedTs == 0:
		b.WriteString("not scanned yet; run `wsh storage scan --wait`\n")
		return b.String()
	}
	fmt.Fprintf(&b, "scanned %s", time.UnixMilli(r.ScannedTs).In(loc).Format(storageTimeLayout))
	if r.Scanning {
		b.WriteString(" (a new scan is running)")
	}
	b.WriteString("\n")
	for _, c := range r.Categories {
		fmt.Fprintf(&b, "\n%s: %s, %s cleanable\n", c.Category, formatStorageSize(c.Bytes), formatStorageSize(c.CleanableBytes))
		if c.Error != "" {
			fmt.Fprintf(&b, "  scan error: %s\n", c.Error)
		}
		items := slices.Clone(c.Items)
		slices.SortStableFunc(items, func(a, b storage.StorageItem) int { return int(b.Bytes - a.Bytes) })
		for _, it := range items {
			fmt.Fprintf(&b, "  %-9s %s  %s\n", formatStorageSize(it.Bytes), storageItemState(it), it.Label)
			fmt.Fprintf(&b, "            id %s\n", it.ID)
			if it.Reason != "" {
				fmt.Fprintf(&b, "            %s\n", it.Reason)
			}
		}
	}
	return b.String()
}

func formatStorageClean(res *storage.StorageCleanResult) string {
	var b strings.Builder
	fmt.Fprintf(&b, "cleaned %d, freed %s", len(res.Cleaned), formatStorageSize(res.Reclaimed))
	if res.Trashed > 0 {
		fmt.Fprintf(&b, ", %s moved to the trash", formatStorageSize(res.Trashed))
	}
	if res.Deferred {
		b.WriteString(", the webview cache clears at the next launch")
	}
	b.WriteString("\n")
	for _, s := range res.Skipped {
		fmt.Fprintf(&b, "skipped %s: %s\n", s.ID, s.Reason)
	}
	return b.String()
}

func init() {
	storageReportCmd.Flags().BoolVar(&storageAsJSON, "json", false, "JSON output (the full report)")
	storageScanCmd.Flags().BoolVar(&storageWait, "wait", false, "block until the scan ends, then print the report")
	storageCleanCmd.Flags().BoolVar(&storageAll, "all", false, "clean every item of the category the scan marked cleanable")
	storageCmd.AddCommand(storageReportCmd, storageScanCmd, storageCleanCmd, storageDeleteCmd)
	rootCmd.AddCommand(storageCmd)
}

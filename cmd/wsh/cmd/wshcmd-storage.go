// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"cmp"
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
	// sizing every project's build folders took 6 minutes to 2h17m on a loaded machine
	storageSizeWaitLimit = 3 * time.Hour
	// a size from the last day is shown as is: the report says nothing of it
	storageSizedStaleAfter = 24 * time.Hour
)

var (
	storageWait   bool
	storageAll    bool
	storageAsJSON bool
	storageForce  bool
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

var storageSizeCmd = &cobra.Command{
	Use:   "size [project...]",
	Short: "size build output (node_modules, target, ...): a scan lists it without walking it; --wait blocks until done",
	Long: `A scan lists build folders but never walks them, so each one shows its last kept size, or "not sized" when it
never had one. This walks the folders of the named projects (a project's path is the ` + "`detail`" + ` of its items in
` + "`wsh storage report --json`" + `), or of every listed project, the oldest size first, when none is named. A project
whose folders were all sized in the last 24 hours is skipped unless --force. Sizing runs in the background: --wait
blocks until the queue is done and prints each project's size. Size before judging whether build output is worth
cleaning: a folder that was never sized counts as 0 B.`,
	RunE:    storageSizeRun,
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
	WriteStdout("%s", formatStorageReport(r, time.Local, time.Now()))
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
	WriteStdout("%s", formatStorageReport(r, time.Local, time.Now()))
	return nil
}

// storageSizeRun queues build output to be sized. A project the scan does not list is refused by the server, which
// still queues the rest: the refusal is printed with the outcome and is the command's error at the end, after --wait
// has waited for what was queued.
func storageSizeRun(cmd *cobra.Command, args []string) error {
	r, err := storageReport()
	if err != nil {
		return err
	}
	if note := storageUnscannedNote(r); note != "" {
		return fmt.Errorf("%s", strings.TrimSuffix(note, "\n"))
	}
	targets := storageBuildProjects(r, args)
	if len(args) == 0 && len(targets) == 0 {
		WriteStdout("the last scan lists no build output; nothing to size\n")
		return nil
	}
	askErr := wshclient.SizeBuildOutputCommand(RpcClient, wshrpc.CommandSizeBuildOutputData{Projects: args, Force: storageForce}, nil)
	if askErr != nil {
		askErr = fmt.Errorf("sizing build output: %w", askErr)
	}
	if !storageWait {
		WriteStdout("%s", formatStorageSizeQueued(len(targets), storageForce))
		return askErr
	}
	done, err := storageWaitSizing(storageReport, storageWaitPoll, storageSizeWaitLimit)
	if err != nil {
		return err
	}
	WriteStdout("%s", formatStorageSizes(done, args, time.Now()))
	return askErr
}

// storageWaitSizing polls until the sizing queue is done and returns that report. A report's Sizing is nil when
// nothing is queued or walking: not Walking == "", which is empty for a moment between two projects of a queue.
func storageWaitSizing(next func() (*storage.StorageReport, error), poll, limit time.Duration) (*storage.StorageReport, error) {
	deadline := time.Now().Add(limit)
	for {
		r, err := next()
		if err != nil {
			return nil, err
		}
		if r.Sizing == nil {
			return r, nil
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("sizing is still running after %s (%d of %d projects); see `wsh storage report` later", limit, r.Sizing.Done, r.Sizing.Total)
		}
		time.Sleep(poll)
	}
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

// storageSizedNote is what a build folder's kept size adds to its line: "not sized" when it never had one, "sized N
// days ago" once the size is a day old, nothing for a fresher one (the same rule as the Settings card).
func storageSizedNote(sizedTs int64, now time.Time) string {
	if sizedTs == 0 {
		return "not sized"
	}
	switch days := int(now.Sub(time.UnixMilli(sizedTs)) / storageSizedStaleAfter); days {
	case 0:
		return ""
	case 1:
		return "sized 1 day ago"
	default:
		return fmt.Sprintf("sized %d days ago", days)
	}
}

// storageUnscannedNote says why there is no report yet, or "" once a scan has finished.
func storageUnscannedNote(r *storage.StorageReport) string {
	switch {
	case r.ScannedTs == 0 && r.Scanning:
		return "the first scan is running; pass --wait to `wsh storage scan`, or try again shortly\n"
	case r.ScannedTs == 0:
		return "not scanned yet; run `wsh storage scan --wait`\n"
	}
	return ""
}

// storageBuildProject is one project's build folders as the last scan lists them (an item's Detail is its project).
type storageBuildProject struct {
	path   string
	bytes  int64
	sized  int   // folders with a kept size
	oldest int64 // the oldest kept size's time among them (unix ms), 0 when none is sized
}

// sizedNote is "not sized" when no folder of the project has a size, else the age of the oldest one.
func (p storageBuildProject) sizedNote(now time.Time) string {
	if p.sized == 0 {
		return storageSizedNote(0, now)
	}
	return storageSizedNote(p.oldest, now)
}

// storageBuildProjects is the projects of the report's build output items, in the report's order. Names, when given,
// keep only the projects they name.
func storageBuildProjects(r *storage.StorageReport, names []string) []storageBuildProject {
	var out []storageBuildProject
	for _, c := range r.Categories {
		for _, it := range c.Items {
			if it.Kind != storage.KindBuild || it.Detail == "" {
				continue
			}
			i := slices.IndexFunc(out, func(p storageBuildProject) bool { return p.path == it.Detail })
			if i < 0 {
				out = append(out, storageBuildProject{path: it.Detail})
				i = len(out) - 1
			}
			p := &out[i]
			p.bytes += it.Bytes
			if it.SizedTs != 0 {
				if p.sized == 0 || it.SizedTs < p.oldest {
					p.oldest = it.SizedTs
				}
				p.sized++
			}
		}
	}
	if len(names) == 0 {
		return out
	}
	return slices.DeleteFunc(out, func(p storageBuildProject) bool {
		return !slices.ContainsFunc(names, func(n string) bool { return storage.SamePath(n, p.path) })
	})
}

func storagePlural(n int, one, many string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, one)
	}
	return fmt.Sprintf("%d %s", n, many)
}

// formatStorageSizeQueued is what `wsh storage size` prints without --wait: it hands the work to the app and returns.
func formatStorageSizeQueued(projects int, force bool) string {
	skip := "folders sized in the last 24 hours are skipped"
	if force {
		skip = "--force: fresh sizes are walked too"
	}
	return fmt.Sprintf("sizing %s in the background (%s); pass --wait to block until done, or see `wsh storage report`\n",
		storagePlural(projects, "project", "projects"), skip)
}

// formatStorageSizes is what `wsh storage size --wait` prints once the queue is done: each build output project (only
// the named ones when names are given) with its size and how old that is, the biggest first.
func formatStorageSizes(r *storage.StorageReport, names []string, now time.Time) string {
	projects := storageBuildProjects(r, names)
	if len(projects) == 0 {
		return "no build output listed for these projects\n"
	}
	slices.SortStableFunc(projects, func(a, b storageBuildProject) int { return cmp.Compare(b.bytes, a.bytes) })
	var b strings.Builder
	fmt.Fprintf(&b, "build output sizes, %s:\n", storagePlural(len(projects), "project", "projects"))
	for _, p := range projects {
		fmt.Fprintf(&b, "  %-9s %s", formatStorageSize(p.bytes), p.path)
		if note := p.sizedNote(now); note != "" {
			fmt.Fprintf(&b, "  %s", note)
		}
		b.WriteString("\n")
	}
	return b.String()
}

func formatStorageReport(r *storage.StorageReport, loc *time.Location, now time.Time) string {
	var b strings.Builder
	if note := storageUnscannedNote(r); note != "" {
		return note
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
			label := it.Label
			if it.Kind == storage.KindBuild {
				// a scan lists build folders without walking them: say whether this size is a measure
				if note := storageSizedNote(it.SizedTs, now); note != "" {
					label += "  " + note
				}
			}
			fmt.Fprintf(&b, "  %-9s %s  %s\n", formatStorageSize(it.Bytes), storageItemState(it), label)
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
	storageSizeCmd.Flags().BoolVar(&storageWait, "wait", false, "block until the queue is done, then print each project's size")
	storageSizeCmd.Flags().BoolVar(&storageForce, "force", false, "walk folders sized in the last 24 hours too")
	storageCmd.AddCommand(storageReportCmd, storageScanCmd, storageSizeCmd, storageCleanCmd, storageDeleteCmd)
	rootCmd.AddCommand(storageCmd)
}

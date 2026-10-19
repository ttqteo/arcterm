// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	memoryRpcTimeoutMs = 5000
	memoryWaitPoll     = 5 * time.Second
	// the server gives a check 30 minutes before it cuts it short
	memoryWaitLimit  = 31 * time.Minute
	memoryIdLen      = 8
	memoryTimeLayout = "2006-01-02 15:04"
)

// the statuses a change can still be decided from; mirrors memhygiene.Pending
var memoryPendingStatuses = []string{"", "open", "conflict"}

var (
	memoryCheckWait bool
	memoryShowAll   bool
)

var memoryCmd = &cobra.Command{
	Use:   "memory",
	Short: "check each project's Claude Code auto memory and apply or keep the proposed changes (the Setup surface's Memory tab)",
}

var memoryListCmd = &cobra.Command{
	Use:     "list",
	Short:   "list registered projects with their memory index size, last check and open changes",
	Args:    cobra.NoArgs,
	RunE:    memoryListRun,
	PreRunE: preRunSetupRpcClient,
}

var memoryCheckCmd = &cobra.Command{
	Use:     "check <project>",
	Short:   "start a check of a project's memory (model calls; takes minutes); --wait blocks until it ends",
	Args:    cobra.ExactArgs(1),
	RunE:    memoryCheckRun,
	PreRunE: preRunSetupRpcClient,
}

var memoryShowCmd = &cobra.Command{
	Use:     "show <project> [change-id]",
	Short:   "list a project's pending changes, or show one change's evidence and diff",
	Args:    cobra.RangeArgs(1, 2),
	RunE:    memoryShowRun,
	PreRunE: preRunSetupRpcClient,
}

var memoryDecideCmd = &cobra.Command{
	Use:     "decide <project> <apply|keep|undo|reopen> <change-id>...",
	Short:   "apply, keep (reject), undo or reopen changes; ids may be unique prefixes",
	Args:    cobra.MinimumNArgs(3),
	RunE:    memoryDecideRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	memoryCheckCmd.Flags().BoolVar(&memoryCheckWait, "wait", false, "wait for the check to finish, then print the project")
	memoryShowCmd.Flags().BoolVar(&memoryShowAll, "all", false, "include applied and kept changes")
	memoryCmd.AddCommand(memoryListCmd, memoryCheckCmd, memoryShowCmd, memoryDecideCmd)
	rootCmd.AddCommand(memoryCmd)
}

func memoryListRun(cmd *cobra.Command, args []string) error {
	projects, err := listMemoryProjects()
	if err != nil {
		return err
	}
	WriteStdout("%s", formatMemoryProjects(projects, time.Local))
	return nil
}

func memoryCheckRun(cmd *cobra.Command, args []string) error {
	name := args[0]
	proj, err := memoryProject(name)
	if err != nil {
		return err
	}
	// --wait on a check already running (the weekly sweep, or the Memory tab) waits for that one
	if !(memoryCheckWait && proj.Checking) {
		err = wshclient.CheckMemoryHygieneCommand(RpcClient, wshrpc.CommandCheckMemoryHygieneData{Project: name}, &wshrpc.RpcOpts{Timeout: memoryRpcTimeoutMs})
		if err != nil {
			return fmt.Errorf("starting the memory check of %s: %w", name, err)
		}
	}
	if !memoryCheckWait {
		WriteStdout("checking %s; see `wsh memory list`, or pass --wait\n", name)
		return nil
	}
	deadline := time.Now().Add(memoryWaitLimit)
	for {
		time.Sleep(memoryWaitPoll)
		proj, err = memoryProject(name)
		if err != nil {
			return err
		}
		if !proj.Checking {
			WriteStdout("%s", formatMemoryProjects([]wshrpc.MemHygieneProject{*proj}, time.Local))
			if proj.LastError != "" {
				return fmt.Errorf("memory check of %s failed: %s", name, proj.LastError)
			}
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("memory check of %s still running after %s", name, memoryWaitLimit)
		}
	}
}

func memoryShowRun(cmd *cobra.Command, args []string) error {
	proj, err := memoryProject(args[0])
	if err != nil {
		return err
	}
	if len(args) == 1 {
		WriteStdout("%s", formatMemoryChanges(proj.Changes, memoryShowAll))
		return nil
	}
	c, err := resolveMemoryChange(proj.Changes, args[1])
	if err != nil {
		return err
	}
	WriteStdout("%s", formatMemoryChange(c))
	return nil
}

func memoryDecideRun(cmd *cobra.Command, args []string) error {
	name, verdict, ids := args[0], args[1], args[2:]
	if !slices.Contains([]string{wshrpc.MemVerdict_Apply, wshrpc.MemVerdict_Keep, wshrpc.MemVerdict_Undo, wshrpc.MemVerdict_Reopen}, verdict) {
		return fmt.Errorf("unknown verdict %q: use apply, keep, undo or reopen", verdict)
	}
	proj, err := memoryProject(name)
	if err != nil {
		return err
	}
	// resolve every id before deciding any, so a typo doesn't leave a half-applied batch
	changes := make([]wshrpc.MemChange, 0, len(ids))
	for _, id := range ids {
		c, err := resolveMemoryChange(proj.Changes, id)
		if err != nil {
			return err
		}
		changes = append(changes, c)
	}
	var errs []error
	for _, c := range changes {
		data := wshrpc.CommandDecideMemoryChangeData{Project: name, ChangeId: c.Id, Verdict: verdict}
		after, err := wshclient.DecideMemoryChangeCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: memoryRpcTimeoutMs})
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", shortMemoryId(c.Id), err))
			continue
		}
		WriteStdout("%s\n", formatMemoryDecision(after.Changes, c.Id))
	}
	return errors.Join(errs...)
}

func listMemoryProjects() ([]wshrpc.MemHygieneProject, error) {
	rtn, err := wshclient.ListMemoryHygieneCommand(RpcClient, &wshrpc.RpcOpts{Timeout: memoryRpcTimeoutMs})
	if err != nil {
		return nil, fmt.Errorf("listing memory projects: %w", err)
	}
	return rtn.Projects, nil
}

func memoryProject(name string) (*wshrpc.MemHygieneProject, error) {
	projects, err := listMemoryProjects()
	if err != nil {
		return nil, err
	}
	return findMemoryProject(projects, name)
}

func findMemoryProject(projects []wshrpc.MemHygieneProject, name string) (*wshrpc.MemHygieneProject, error) {
	names := make([]string, 0, len(projects))
	for i := range projects {
		if projects[i].Project == name {
			return &projects[i], nil
		}
		names = append(names, projects[i].Project)
	}
	return nil, fmt.Errorf("no registered project %q (have: %s)", name, strings.Join(names, ", "))
}

func resolveMemoryChange(changes []wshrpc.MemChange, prefix string) (wshrpc.MemChange, error) {
	var hits []wshrpc.MemChange
	for _, c := range changes {
		if strings.HasPrefix(c.Id, prefix) {
			hits = append(hits, c)
		}
	}
	switch len(hits) {
	case 1:
		return hits[0], nil
	case 0:
		return wshrpc.MemChange{}, fmt.Errorf("no change with id %q", prefix)
	default:
		return wshrpc.MemChange{}, fmt.Errorf("change id %q matches %d changes; give more of it", prefix, len(hits))
	}
}

func shortMemoryId(id string) string {
	if len(id) > memoryIdLen {
		return id[:memoryIdLen]
	}
	return id
}

func memoryPending(c wshrpc.MemChange) bool {
	return slices.Contains(memoryPendingStatuses, c.Status)
}

func formatMemoryProjects(projects []wshrpc.MemHygieneProject, loc *time.Location) string {
	if len(projects) == 0 {
		return "no registered projects\n"
	}
	var b strings.Builder
	for _, p := range projects {
		open := 0
		for _, c := range p.Changes {
			if memoryPending(c) {
				open++
			}
		}
		checked := "never checked"
		if p.CheckedAt > 0 {
			checked = "checked " + time.UnixMilli(p.CheckedAt).In(loc).Format(memoryTimeLayout)
		}
		fmt.Fprintf(&b, "%s: %d memories, index %d lines / %d bytes, %s, %d pending\n", p.Project, p.Memories, p.Index.Lines, p.Index.Bytes, checked, open)
		if p.Checking {
			b.WriteString("  checking now\n")
		}
		if p.LastError != "" {
			fmt.Fprintf(&b, "  last check failed: %s\n", p.LastError)
		}
		if len(p.SharedWith) > 0 {
			fmt.Fprintf(&b, "  shares %s with %s\n", p.Folder, strings.Join(p.SharedWith, ", "))
		}
	}
	return b.String()
}

func formatMemoryChanges(changes []wshrpc.MemChange, all bool) string {
	var b strings.Builder
	for _, c := range changes {
		if !all && !memoryPending(c) {
			continue
		}
		status := c.Status
		if status == "" {
			status = "open"
		}
		fmt.Fprintf(&b, "%s  %-8s  %-12s  %s  (index %+d lines, %+d bytes)\n", shortMemoryId(c.Id), status, c.Kind, c.Title, c.IndexDelta.Lines, c.IndexDelta.Bytes)
	}
	if b.Len() == 0 {
		return "no pending changes\n"
	}
	return b.String()
}

func formatMemoryChange(c wshrpc.MemChange) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s  %s  %s\n%s\n", shortMemoryId(c.Id), c.Kind, c.Status, c.Title)
	if c.Effect != "" {
		fmt.Fprintf(&b, "effect: %s\n", c.Effect)
	}
	if c.Note != "" {
		fmt.Fprintf(&b, "note: %s\n", c.Note)
	}
	if c.ConflictFile != "" {
		fmt.Fprintf(&b, "conflict: %s changed since the check\n", c.ConflictFile)
	}
	if len(c.Evidence) > 0 {
		b.WriteString("evidence:\n")
		for _, e := range c.Evidence {
			fmt.Fprintf(&b, "  - %s", e.Text)
			if e.Code != "" {
				fmt.Fprintf(&b, " `%s`", e.Code)
			}
			b.WriteString("\n")
		}
	}
	for _, d := range c.Diffs {
		fmt.Fprintf(&b, "--- %s", d.Path)
		if d.Note != "" {
			fmt.Fprintf(&b, " (%s)", d.Note)
		}
		b.WriteString("\n")
		for _, l := range d.Lines {
			sign := l.Sign
			if sign == "" {
				sign = " "
			}
			fmt.Fprintf(&b, "%s %s\n", sign, l.Text)
		}
	}
	return b.String()
}

// formatMemoryDecision reports the change's status after a decide; a conflict is not an rpc error
func formatMemoryDecision(changes []wshrpc.MemChange, id string) string {
	i := slices.IndexFunc(changes, func(c wshrpc.MemChange) bool { return c.Id == id })
	if i < 0 {
		return fmt.Sprintf("%s: decided", shortMemoryId(id))
	}
	c := changes[i]
	if c.Status == "conflict" {
		return fmt.Sprintf("%s: not applied, %s changed since the check; run `wsh memory check` again", shortMemoryId(id), c.ConflictFile)
	}
	return fmt.Sprintf("%s: %s  %s", shortMemoryId(id), c.Status, c.Title)
}

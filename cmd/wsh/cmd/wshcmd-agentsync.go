// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var agentSyncCmd = &cobra.Command{
	Use:   "agent-sync",
	Short: "sync steering files and skills from the vault into every harness",
}

var agentSyncStatusCmd = &cobra.Command{
	Use:          "status",
	Short:        "show what each harness currently reflects",
	Args:         cobra.NoArgs,
	PreRunE:      preRunSetupRpcClient,
	RunE:         agentSyncStatusRun,
	SilenceUsage: true,
}

var agentSyncSyncCmd = &cobra.Command{
	Use:          "sync",
	Short:        "project the shared steering doc and render canonical skills",
	Args:         cobra.NoArgs,
	PreRunE:      preRunSetupRpcClient,
	RunE:         agentSyncSyncRun,
	SilenceUsage: true,
}

var agentSyncAdoptCmd = &cobra.Command{
	Use:          "adopt",
	Short:        "migrate hand-maintained skills into the vault",
	Args:         cobra.NoArgs,
	PreRunE:      preRunSetupRpcClient,
	RunE:         agentSyncAdoptRun,
	SilenceUsage: true,
}

var (
	agentSyncDryRun bool
	agentSyncApply  bool
)

func init() {
	agentSyncSyncCmd.Flags().BoolVar(&agentSyncDryRun, "dry-run", false, "print the plan without writing")
	agentSyncAdoptCmd.Flags().BoolVar(&agentSyncApply, "apply", false, "commit the migration (default is a dry run)")
	agentSyncCmd.AddCommand(agentSyncStatusCmd, agentSyncSyncCmd, agentSyncAdoptCmd)
	rootCmd.AddCommand(agentSyncCmd)
}

func agentSyncStatusRun(cmd *cobra.Command, args []string) error {
	res, err := wshclient.AgentSyncStatusCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 15000})
	if err != nil {
		return err
	}
	WriteStdout("shared steering: %s\ncanonical skills: %s\n\n", res.SteeringDoc, res.SkillsRoot)
	for _, h := range res.Harnesses {
		if !h.Present {
			WriteStdout("%-12s not present\n", h.Label)
			continue
		}
		line := fmt.Sprintf("%-12s steering %-8s skills %d managed", h.Label, h.Steering, h.SkillsManaged)
		if h.SkillsUnmanaged > 0 {
			line += fmt.Sprintf(", %d unmanaged", h.SkillsUnmanaged)
		}
		if h.Note != "" {
			line += "  (" + h.Note + ")"
		}
		WriteStdout("%s\n", line)
	}
	return nil
}

func agentSyncSyncRun(cmd *cobra.Command, args []string) error {
	res, err := wshclient.AgentSyncApplyCommand(RpcClient, wshrpc.CommandAgentSyncApplyData{DryRun: agentSyncDryRun}, &wshrpc.RpcOpts{Timeout: 30000})
	if err != nil {
		return err
	}
	if len(res.Actions) == 0 {
		WriteStdout("everything already in sync\n")
		return nil
	}
	for _, a := range res.Actions {
		detail := ""
		if a.Detail != "" {
			detail = "  " + a.Detail
		}
		WriteStdout("%-16s %-9s %s%s\n", a.Kind, a.Runtime, a.Path, detail)
	}
	return nil
}

func agentSyncAdoptRun(cmd *cobra.Command, args []string) error {
	res, err := wshclient.AgentSyncAdoptCommand(RpcClient, wshrpc.CommandAgentSyncAdoptData{
		Apply: agentSyncApply,
	}, &wshrpc.RpcOpts{Timeout: 60000})
	if res != nil {
		for _, m := range res.Moves {
			switch {
			case m.BodyDiff:
				WriteStdout("conflict %-9s %s  (body differs; resolve by hand)\n", m.Runtime, m.From)
			case m.Seed:
				WriteStdout("seed     %-9s %s\n", m.Runtime, m.From)
			default:
				WriteStdout("delta    %-9s %s  (%s)\n", m.Runtime, m.From, strings.Join(append(m.Keys, m.Files...), ", "))
			}
		}
		for _, n := range res.Unresolved {
			WriteStdout("unresolved: %s\n", n)
		}
		// a failed apply reports its reason in the reply, beside the plan it was applying
		if err == nil && res.Error != "" {
			err = errors.New(res.Error)
		}
	}
	return err
}

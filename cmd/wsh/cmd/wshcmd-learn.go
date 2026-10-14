// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var learnCmd = &cobra.Command{
	Use:   "learn",
	Short: "note what the user teaches you, so a repeated correction can become a rule they approve",
}

// learnSession names one working session: the terminal block (or "cli" outside arcterm) and the local day.
// The proposal rule counts distinct sessions, so two notes the same day from one block count once.
func learnSession(blockID string, now time.Time) string {
	if blockID == "" {
		blockID = "cli"
	}
	return blockID + ":" + now.Format("2006-01-02")
}

// learnTarget resolves --skill / --memory into the wire fields: a skill name, or the cwd for a memory.
func learnTarget(skill string, memory bool) (string, string, error) {
	if skill != "" && memory {
		return "", "", errors.New("pass --skill <name> or --memory, not both")
	}
	if skill != "" {
		return skill, "", nil
	}
	if !memory {
		return "", "", errors.New("pass --skill <name> (a vault skill) or --memory (a rule about this project)")
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", "", fmt.Errorf("reading the working directory: %w", err)
	}
	return "", cwd, nil
}

func learnNoteStatus(rtn wshrpc.CommandLearnNoteRtnData) string {
	switch {
	case rtn.Muted:
		return "Not noted: the user dismissed this before."
	case rtn.Proposed:
		return "Noted; it is waiting for the user's yes in Needs you."
	}
	return "Noted."
}

func learnKeyLine(k wshrpc.LearnKey) string {
	return fmt.Sprintf("%s  %d×  %s", k.Key, k.Notes, k.Text)
}

var learnNoteCmd = &cobra.Command{
	Use:     "note <text>",
	Short:   "note one correction (--key <k> and --skill <name> or --memory; --quote the user's words)",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		memory, _ := cmd.Flags().GetBool("memory")
		skill, cwd, err := learnTarget(mustFlagString(cmd, "skill"), memory)
		if err != nil {
			return err
		}
		rtn, err := wshclient.LearnNoteCommand(RpcClient, wshrpc.CommandLearnNoteData{
			Key:     mustFlagString(cmd, "key"),
			Skill:   skill,
			Cwd:     cwd,
			Text:    args[0],
			Quote:   mustFlagString(cmd, "quote"),
			Session: learnSession(os.Getenv("WAVETERM_BLOCKID"), time.Now()),
		}, nil)
		if err != nil {
			return err
		}
		fmt.Println(learnNoteStatus(*rtn))
		return nil
	},
}

var learnListCmd = &cobra.Command{
	Use:     "list",
	Short:   "list the keys already noted for a skill (--skill <name>) or this project (--memory), to reuse one",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		memory, _ := cmd.Flags().GetBool("memory")
		skill, cwd, err := learnTarget(mustFlagString(cmd, "skill"), memory)
		if err != nil {
			return err
		}
		keys, err := wshclient.LearnKeysCommand(RpcClient, wshrpc.CommandLearnKeysData{Skill: skill, Cwd: cwd}, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(keys)
		}
		for _, k := range keys {
			fmt.Println(learnKeyLine(k))
		}
		return nil
	},
}

func init() {
	learnNoteCmd.Flags().String("key", "", "the rule's short kebab-case key; reuse a listed one when it means the same")
	learnNoteCmd.Flags().String("skill", "", "the vault skill the rule belongs to")
	learnNoteCmd.Flags().Bool("memory", false, "a rule about this project that no skill owns")
	learnNoteCmd.Flags().String("quote", "", "the user's own words")
	_ = learnNoteCmd.MarkFlagRequired("key")
	learnListCmd.Flags().String("skill", "", "list the keys noted for this vault skill")
	learnListCmd.Flags().Bool("memory", false, "list the keys noted for this project")
	learnListCmd.Flags().Bool("json", false, "JSON output")
	learnCmd.AddCommand(learnNoteCmd, learnListCmd)
	rootCmd.AddCommand(learnCmd)
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var effortCmd = &cobra.Command{
	Use:   "effort",
	Short: "create and update Wave effort trackers (chunk lists with statuses, owners, note trails)",
}

var effortChunkCmd = &cobra.Command{
	Use:   "chunk",
	Short: "manage an effort's chunks",
}

func jsonOut(v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(b))
	return nil
}

// chunkRef marshals a chunk position (1-based) or label into the op's Chunk field.
func chunkRef(op *wshrpc.EffortOp, ref string) { op.Chunk = ref }

var effortCreateCmd = &cobra.Command{
	Use:     "create <title>",
	Short:   "create an effort (optionally seeding chunks)",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		chunks, _ := cmd.Flags().GetStringArray("chunk")
		parent, _ := cmd.Flags().GetString("parent")
		seed := make([]wshrpc.CommandEffortChunkSeed, 0, len(chunks))
		for _, c := range chunks {
			seed = append(seed, wshrpc.CommandEffortChunkSeed{Label: c})
		}
		project, err := effortCreateProject(cmd)
		if err != nil {
			return err
		}
		rtn, err := wshclient.EffortCreateCommand(RpcClient, wshrpc.CommandEffortCreateData{
			Title:     args[0],
			Project:   project,
			Ticket:    mustFlagString(cmd, "ticket"),
			ParentOID: parent,
			Chunks:    seed,
		}, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(rtn)
		}
		fmt.Printf("created effort %s\n", rtn.EffortOID)
		return nil
	},
}

// effortCreateProject is --project, else the project holding the current directory: an agent filing
// follow-ups routinely leaves the flag off, and a projectless effort cannot launch an agent from the Brief
func effortCreateProject(cmd *cobra.Command) (string, error) {
	if p := mustFlagString(cmd, "project"); p != "" {
		return p, nil
	}
	chans, err := runsChannels()
	if err != nil {
		return "", err
	}
	p, here, err := runsProjectAt(chans, "")
	if err != nil {
		return "", err
	}
	if p == nil {
		fmt.Fprintf(os.Stderr, "note: %s is in no arcterm project, so the effort has none; set one with `wsh effort project`\n", here)
		return "", nil
	}
	return p.name, nil
}

var effortListCmd = &cobra.Command{
	Use:     "list [--archived]",
	Short:   "list efforts (oid, title, status, done/total, active chunk); archived are hidden unless asked for",
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		archived, _ := cmd.Flags().GetBool("archived")
		rtn, err := wshclient.EffortListCommand(RpcClient, wshrpc.CommandEffortListData{
			Project:         mustFlagString(cmd, "project"),
			IncludeArchived: archived,
		}, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(rtn)
		}
		for _, s := range rtn.Efforts {
			fmt.Printf("%s\t%s\t%s\t%d/%d\t%s\n", s.ORef, s.Title, s.Status, s.Done, s.Total, s.ActiveChunk)
		}
		return nil
	},
}

var effortShowCmd = &cobra.Command{
	Use:     "show <effort>",
	Short:   "show an effort's full detail (chunks, statuses, owners, note trails)",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data := wshrpc.CommandEffortGetData{EffortOID: args[0]}
		// reading an initiative from a terminal links that agent session to it (see linkSessionToEffort)
		if RpcContext.BlockId != "" {
			data.SourceBlock = "block:" + RpcContext.BlockId
		}
		rtn, err := wshclient.EffortGetCommand(RpcClient, data, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(rtn)
		}
		fmt.Print(formatEffortShow(rtn.Effort))
		return nil
	},
}

var effortRenameCmd = &cobra.Command{
	Use:     "rename <effort> <title>",
	Short:   "retitle an effort",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		return mutateOne(args[0], wshrpc.EffortOp{Op: "rename", Title: args[1]}, isJSON(cmd))
	},
}

var effortProjectCmd = &cobra.Command{
	Use:     "project <effort> <project|\"\">",
	Short:   "set or clear an effort's project",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		return mutateOne(args[0], wshrpc.EffortOp{Op: "setProject", Project: args[1]}, isJSON(cmd))
	},
}

var effortTicketCmd = &cobra.Command{
	Use:     "ticket <effort> <ticket|\"\">",
	Short:   "set or clear an effort's ticket",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		return mutateOne(args[0], wshrpc.EffortOp{Op: "setTicket", Ticket: args[1]}, isJSON(cmd))
	},
}

var effortStatusCmd = &cobra.Command{
	Use:     "status <effort> <active|paused|done|archived>",
	Short:   "set an effort's status",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		return mutateOne(args[0], wshrpc.EffortOp{Op: "setStatus", Status: args[1]}, isJSON(cmd))
	},
}

var effortUnarchiveCmd = &cobra.Command{
	Use:     "unarchive <effort>",
	Short:   "restore an archived effort to the status it held when it was archived",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		return mutateOne(args[0], wshrpc.EffortOp{Op: "unarchive"}, isJSON(cmd))
	},
}

var effortLinkCmd = &cobra.Command{
	Use:     "link <effort> --parent <effort>",
	Short:   "link an effort under a parent",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		parent, _ := cmd.Flags().GetString("parent")
		return mutateOne(args[0], wshrpc.EffortOp{Op: "link", ParentOID: parent}, isJSON(cmd))
	},
}

var effortUnlinkCmd = &cobra.Command{
	Use:     "unlink <effort>",
	Short:   "clear an effort's parent link",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		return mutateOne(args[0], wshrpc.EffortOp{Op: "link", ParentOID: ""}, isJSON(cmd))
	},
}

var effortDeleteCmd = &cobra.Command{
	Use:     "delete <effort> [--force]",
	Short:   "delete an effort (refuses unless archived or --force)",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		force, _ := cmd.Flags().GetBool("force")
		rtn, err := wshclient.EffortGetCommand(RpcClient, wshrpc.CommandEffortGetData{EffortOID: args[0]}, nil)
		if err != nil {
			return err
		}
		if rtn.Effort.Status != "archived" && !force {
			return fmt.Errorf("EC-NOT-ARCHIVED: effort %s is %s — set status archived or pass --force", args[0], rtn.Effort.Status)
		}
		if err := wshclient.EffortDeleteCommand(RpcClient, wshrpc.CommandEffortDeleteData{EffortOID: args[0]}, nil); err != nil {
			return err
		}
		fmt.Printf("deleted effort %s\n", args[0])
		return nil
	},
}

var effortAdvanceCmd = &cobra.Command{
	Use:     "advance <effort> [--note \"...\"]",
	Short:   "mark the active chunk done and activate the next non-done chunk",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		return mutateOne(args[0], wshrpc.EffortOp{Op: "advance", Note: mustFlagString(cmd, "note")}, isJSON(cmd))
	},
}

var effortReopenCmd = &cobra.Command{
	Use:     "reopen <effort> <chunk>",
	Short:   "reopen a done chunk (undo advance)",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		op := wshrpc.EffortOp{Op: "reopen"}
		chunkRef(&op, args[1])
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

var effortChunkAddCmd = &cobra.Command{
	Use:     "add <effort> \"<label>\" [--at N] [--owner X] [--stage S]",
	Short:   "add a chunk (phase)",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		op := wshrpc.EffortOp{Op: "addChunk", Label: args[1], Owner: mustFlagString(cmd, "owner"), Stage: mustFlagString(cmd, "stage")}
		if at, err := cmd.Flags().GetInt("at"); err == nil && at > 0 {
			op.At = &at
		}
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

var effortChunkRenameCmd = &cobra.Command{
	Use:     "rename <effort> <chunk> \"<label>\"",
	Short:   "rename a chunk",
	Args:    cobra.ExactArgs(3),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		op := wshrpc.EffortOp{Op: "renameChunk", Label: args[2]}
		chunkRef(&op, args[1])
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

var effortChunkMoveCmd = &cobra.Command{
	Use:     "move <effort> <chunk> <at>",
	Short:   "reorder a chunk (1-based target position)",
	Args:    cobra.ExactArgs(3),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		at, err := parseAt(args[2])
		if err != nil {
			return err
		}
		op := wshrpc.EffortOp{Op: "moveChunk", At: &at}
		chunkRef(&op, args[1])
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

var effortChunkRemoveCmd = &cobra.Command{
	Use:     "remove <effort> <chunk>",
	Short:   "remove a chunk",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		op := wshrpc.EffortOp{Op: "removeChunk"}
		chunkRef(&op, args[1])
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

var effortChunkStatusCmd = &cobra.Command{
	Use:     "status <effort> <chunk> <pending|active|done|deferred|blocked|skipped> [--note \"...\"]",
	Short:   "set a chunk's status",
	Args:    cobra.ExactArgs(3),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		op := wshrpc.EffortOp{Op: "setChunkStatus", Status: args[2], Note: mustFlagString(cmd, "note")}
		chunkRef(&op, args[1])
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

var effortChunkNoteCmd = &cobra.Command{
	Use:     "note <effort> <chunk> --note \"...\"",
	Short:   "append an annotation to a chunk's trail",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		op := wshrpc.EffortOp{Op: "appendNote", Note: mustFlagString(cmd, "note")}
		chunkRef(&op, args[1])
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

var effortChunkStageCmd = &cobra.Command{
	Use:     "stage <effort> <chunk> <stage|\"\">",
	Short:   "set or clear a chunk's stage (a grouping label; consecutive same-stage chunks render under one header)",
	Args:    cobra.ExactArgs(3),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		op := wshrpc.EffortOp{Op: "setChunkStage", Stage: args[2]}
		chunkRef(&op, args[1])
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

var effortChunkOwnerCmd = &cobra.Command{
	Use:     "owner <effort> <chunk> <owner|\"\">",
	Short:   "set or clear a chunk's owner",
	Args:    cobra.ExactArgs(3),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		op := wshrpc.EffortOp{Op: "setOwner", Owner: args[2]}
		chunkRef(&op, args[1])
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

var effortChunkAttachCmd = &cobra.Command{
	Use:     "attach <effort> <chunk> --run <oid> | --agent <tabid>",
	Short:   "record that a run or agent session is working this chunk",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		kind, oref, err := workRefFromFlags(cmd)
		if err != nil {
			return err
		}
		op := wshrpc.EffortOp{Op: "attachWork", Kind: kind, ORef: oref}
		chunkRef(&op, args[1])
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

var effortChunkDetachCmd = &cobra.Command{
	Use:     "detach <effort> [chunk] --run <oid> | --agent <tabid>",
	Short:   "remove a run or agent workref (chunk optional: removed from whichever chunk holds it)",
	Args:    cobra.RangeArgs(1, 2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		kind, oref, err := workRefFromFlags(cmd)
		if err != nil {
			return err
		}
		op := wshrpc.EffortOp{Op: "detachWork", Kind: kind, ORef: oref}
		if len(args) == 2 {
			chunkRef(&op, args[1])
		}
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

// workRefFromFlags resolves the mutually-exclusive --run/--agent pair into a kind + oref.
func workRefFromFlags(cmd *cobra.Command) (string, string, error) {
	run, _ := cmd.Flags().GetString("run")
	agent, _ := cmd.Flags().GetString("agent")
	if run != "" && agent != "" {
		return "", "", fmt.Errorf("EC-INVALID-ARGS: pass --run or --agent, not both")
	}
	if run != "" {
		return "run", "run:" + run, nil
	}
	if agent != "" {
		return "agent", "agent:" + agent, nil
	}
	return "", "", fmt.Errorf("EC-INVALID-ARGS: pass --run <oid> or --agent <tabid>")
}

// --- shared helpers ---

// mutateOne sends a single-op batch; asJSON prints the post-mutation object when set.
func mutateOne(effortOID string, op wshrpc.EffortOp, asJSON bool) error {
	data := wshrpc.CommandEffortMutateData{EffortOID: effortOID, Ops: []wshrpc.EffortOp{op}}
	if RpcContext.BlockId != "" {
		data.SourceBlock = "block:" + RpcContext.BlockId
	}
	rtn, err := wshclient.EffortMutateCommand(RpcClient, data, nil)
	if err != nil {
		return err
	}
	if asJSON {
		return jsonOut(rtn)
	}
	return nil
}

func mustFlagString(cmd *cobra.Command, name string) string {
	s, _ := cmd.Flags().GetString(name)
	return s
}

func isJSON(cmd *cobra.Command) bool {
	v, _ := cmd.Flags().GetBool("json")
	return v
}

func parseAt(s string) (int, error) {
	var at int
	if _, err := fmt.Sscanf(s, "%d", &at); err != nil || at < 1 {
		return 0, fmt.Errorf("EC-INVALID-INDEX: position must be a positive integer")
	}
	return at, nil
}

// formatEffortShow renders the human-readable detail block. Stage grouping is by consecutive run,
// the same rule the card renders: a header prints when the stage changes, so a stage that reappears
// later prints again rather than the chunks being reordered to gather them.
func formatEffortShow(e *waveobj.Effort) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s (%s) — %d/%d\n", e.Title, e.Status, countDone(e), len(e.Chunks))
	stage := ""
	for i, c := range e.Chunks {
		if c.Stage != stage {
			stage = c.Stage
			if stage != "" {
				fmt.Fprintf(&b, "  -- %s --\n", stage)
			}
		}
		fmt.Fprintf(&b, "  %d. [%s] %s%s\n", i+1, c.Status, c.Label, ownerSuffix(c.Owner))
		for _, n := range c.Notes {
			fmt.Fprintf(&b, "      · %s: %s\n", timeStr(n.Ts), n.Text)
		}
	}
	return b.String()
}

func countDone(e *waveobj.Effort) int {
	n := 0
	for _, c := range e.Chunks {
		if c.Status == "done" {
			n++
		}
	}
	return n
}

func ownerSuffix(owner string) string {
	if owner == "" {
		return ""
	}
	return " (owner: " + owner + ")"
}

func timeStr(ms int64) string {
	return time.UnixMilli(ms).Format("01-02 15:04")
}

func init() {
	effortCreateCmd.Flags().String("project", "", "project name (default: the project holding the current directory)")
	effortCreateCmd.Flags().String("ticket", "", "ticket id")
	effortCreateCmd.Flags().StringArray("chunk", nil, "chunk label (repeatable)")
	effortCreateCmd.Flags().String("parent", "", "parent effort oid")
	effortCreateCmd.Flags().Bool("json", false, "JSON output")
	effortListCmd.Flags().String("project", "", "filter by project")
	effortListCmd.Flags().Bool("archived", false, "include archived efforts")
	effortListCmd.Flags().Bool("json", false, "JSON output")
	effortShowCmd.Flags().Bool("json", false, "JSON output")
	effortLinkCmd.Flags().String("parent", "", "parent effort oid")
	effortDeleteCmd.Flags().Bool("force", false, "delete without archiving first")
	effortAdvanceCmd.Flags().String("note", "", "annotation")
	effortChunkAddCmd.Flags().Int("at", 0, "1-based insert position")
	effortChunkAddCmd.Flags().String("owner", "", "chunk owner")
	effortChunkAddCmd.Flags().String("stage", "", "grouping label")
	effortChunkStatusCmd.Flags().String("note", "", "annotation")
	effortChunkNoteCmd.Flags().String("note", "", "annotation text (required)")
	effortChunkNoteCmd.MarkFlagRequired("note")
	effortChunkAttachCmd.Flags().String("run", "", "run oid")
	effortChunkAttachCmd.Flags().String("agent", "", "agent tab id")
	effortChunkDetachCmd.Flags().String("run", "", "run oid")
	effortChunkDetachCmd.Flags().String("agent", "", "agent tab id")

	effortCmd.AddCommand(effortCreateCmd, effortListCmd, effortShowCmd, effortRenameCmd,
		effortProjectCmd, effortTicketCmd, effortStatusCmd, effortUnarchiveCmd, effortLinkCmd, effortUnlinkCmd,
		effortDeleteCmd, effortAdvanceCmd, effortReopenCmd, effortChunkCmd)
	effortChunkCmd.AddCommand(effortChunkAddCmd, effortChunkRenameCmd, effortChunkMoveCmd,
		effortChunkRemoveCmd, effortChunkStatusCmd, effortChunkNoteCmd, effortChunkOwnerCmd,
		effortChunkStageCmd, effortChunkAttachCmd, effortChunkDetachCmd)
	rootCmd.AddCommand(effortCmd)
}

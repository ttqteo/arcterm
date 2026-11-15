// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
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
		if topics, _ := cmd.Flags().GetBool("topics"); topics {
			rtn.Efforts = topicEfforts(rtn.Efforts)
		}
		if isJSON(cmd) {
			return jsonOut(rtn)
		}
		for _, s := range rtn.Efforts {
			fmt.Printf("%s\t%s\t%s\t%d/%d\t%s\n", s.ORef, s.Title, s.Status, s.Done, summaryProgressTotal(s), s.ActiveChunk)
		}
		return nil
	},
}

// topicEfforts keeps the efforts another listed effort is linked under: the topics a new effort can join with
// `create --parent`. A child whose parent is not in the list (archived, another project) makes no topic.
func topicEfforts(list []wshrpc.EffortSummary) []wshrpc.EffortSummary {
	parents := make(map[string]bool)
	for _, s := range list {
		if s.ParentOID != "" {
			parents[s.ParentOID] = true
		}
	}
	var out []wshrpc.EffortSummary
	for _, s := range list {
		if parents[strings.TrimPrefix(s.ORef, "effort:")] {
			out = append(out, s)
		}
	}
	return out
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
		fmt.Print(formatEffortShowWith(rtn.Effort, rpcChunkDrift(rtn.Effort.OID)))
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

var effortPinCmd = &cobra.Command{
	Use:     "pin <effort> [--replace-oldest]",
	Short:   "pin an effort to the Brief's cards (at most 6; --replace-oldest unpins the oldest to make room)",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		replace, _ := cmd.Flags().GetBool("replace-oldest")
		return pinOne(args[0], true, replace, isJSON(cmd))
	},
}

var effortUnpinCmd = &cobra.Command{
	Use:     "unpin <effort>",
	Short:   "unpin an effort from the Brief's cards",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		return pinOne(args[0], false, false, isJSON(cmd))
	},
}

func pinOne(effortOID string, pin, replaceOldest, asJSON bool) error {
	rtn, err := wshclient.EffortPinCommand(RpcClient, wshrpc.CommandEffortPinData{
		EffortOID: effortOID, Pin: pin, ReplaceOldest: replaceOldest,
	}, nil)
	if err != nil {
		return err
	}
	if asJSON && !rtn.CapReached {
		return jsonOut(rtn)
	}
	msg, err := pinResultMessage(effortOID, rtn)
	if err != nil {
		return err
	}
	fmt.Println(msg)
	return nil
}

// pinResultMessage words a pin call's answer; a pin the cap refused is an error, so the command exits
// nonzero and names the pin it would have to replace.
func pinResultMessage(effortOID string, rtn *wshrpc.CommandEffortPinRtnData) (string, error) {
	if rtn.CapReached {
		oldest := "the oldest pin"
		if rtn.Oldest != nil {
			oldest = fmt.Sprintf("%q (effort:%s)", rtn.Oldest.Title, rtn.Oldest.OID)
		}
		return "", fmt.Errorf("EC-PIN-CAP: %d initiatives are pinned; the oldest is %s — pass --replace-oldest to unpin it and pin this one",
			jarvis.MaxPinnedEfforts, oldest)
	}
	if rtn.Pinned {
		return fmt.Sprintf("effort %s is pinned", effortOID), nil
	}
	return fmt.Sprintf("effort %s is not pinned", effortOID), nil
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
	Use:     "add <effort> \"<label>\" [--at N] [--owner X] [--stage S] [--due YYYY-MM-DD|+Nd] [--proposed]",
	Short:   "add a chunk (phase)",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		due, err := resolveDue(mustFlagString(cmd, "due"), time.Now())
		if err != nil {
			return err
		}
		op := wshrpc.EffortOp{Op: "addChunk", Label: args[1], Owner: mustFlagString(cmd, "owner"), Stage: mustFlagString(cmd, "stage"), Due: due}
		if at, err := cmd.Flags().GetInt("at"); err == nil && at > 0 {
			op.At = &at
		}
		if p, _ := cmd.Flags().GetBool("proposed"); p {
			op.Status = "proposed"
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

var effortChunkRecheckCmd = &cobra.Command{
	Use:   "recheck <effort> <chunk> [--note \"<what was checked>\"]",
	Short: "mark a chunk still right for today's code (moves its base to the project's HEAD)",
	Long: "Mark a chunk not yet done as checked against the code as it is now: its base moves to the project's HEAD, so " +
		"the card and `wsh effort show` count commits from here. Run it after reading the chunk against the current code, " +
		"or after rewriting it with `wsh effort chunk rename`.",
	Args:    cobra.ExactArgs(2),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		op := wshrpc.EffortOp{Op: "recheckChunk", Note: mustFlagString(cmd, "note")}
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
	Use:     "status <effort> <chunk> <pending|active|done|deferred|blocked|skipped|proposed> [--note \"...\"]",
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

var effortChunkDueCmd = &cobra.Command{
	Use:   "due <effort> <chunk> <YYYY-MM-DD|+Nd|\"\">",
	Short: "set or clear the day a chunk comes due (it then waits in Needs you until it is done, deferred or skipped)",
	Long: `Set or clear the day a chunk comes due. From that local date on, while the chunk is pending, active or
blocked, it waits in the cockpit's Needs you; marking it done, deferred or skipped, or moving the date on,
takes it out. +Nd counts N days from today: "+14d" is two weeks from now. Use it for a decision to
revisit or a measurement to retake, and say in a chunk note what to measure and what the result decides.`,
	Args:    cobra.ExactArgs(3),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		due, err := resolveDue(args[2], time.Now())
		if err != nil {
			return err
		}
		op := wshrpc.EffortOp{Op: "setChunkDue", Due: due}
		chunkRef(&op, args[1])
		return mutateOne(args[0], op, isJSON(cmd))
	},
}

// resolveDue turns a due argument into the YYYY-MM-DD the server stores: "" clears, a date passes through
// (the server validates it), and "+Nd" counts N days from now's local date.
func resolveDue(s string, now time.Time) (string, error) {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "+") {
		return s, nil
	}
	n, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(s, "+"), "d"))
	if err != nil || n < 0 || !strings.HasSuffix(s, "d") {
		return "", fmt.Errorf("EC-INVALID-DUE: %q is not YYYY-MM-DD or +Nd", s)
	}
	return now.AddDate(0, 0, n).Format("2006-01-02"), nil
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

// mutateOne sends a single-op batch and prints the post-mutation object (asJSON) or a one-line confirmation.
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
	// a silent success reads the same as a no-op, and resending an add or a note is not harmless
	fmt.Printf("%s applied to effort %s\n", op.Op, effortOID)
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
// later prints again rather than the chunks being reordered to gather them. A proposed chunk prints but is
// left out of the progress total, as the summary's Done/Total leaves it out.
func formatEffortShow(e *waveobj.Effort) string {
	return formatEffortShowWith(e, nil)
}

// chunkDrift answers how far the project has moved since a chunk was written, and which files it names changed or
// went away; nil when unknown.
type chunkDrift func(label string) *wshrpc.CommandEffortChunkDriftRtnData

// rpcChunkDrift asks wavesrv, which reads the initiative's project checkout rather than this terminal's directory.
func rpcChunkDrift(effortOID string) chunkDrift {
	return func(label string) *wshrpc.CommandEffortChunkDriftRtnData {
		rtn, err := wshclient.EffortChunkDriftCommand(RpcClient, wshrpc.CommandEffortChunkDriftData{EffortOID: effortOID, Chunk: label}, nil)
		if err != nil || rtn == nil || !rtn.Known {
			return nil
		}
		return rtn
	}
}

// formatEffortShowWith is formatEffortShow with each open chunk's base: the commit its text was written against, and
// with drift, how far the code has moved since, so an agent picking it up knows to check it still holds.
func formatEffortShowWith(e *waveobj.Effort, drift chunkDrift) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s (%s) — %d/%d\n", e.Title, e.Status, countDone(e), countProgress(e))
	stage := ""
	for i, c := range e.Chunks {
		if c.Stage != stage {
			stage = c.Stage
			if stage != "" {
				fmt.Fprintf(&b, "  -- %s --\n", stage)
			}
		}
		fmt.Fprintf(&b, "  %d. [%s] %s%s%s%s\n", i+1, c.Status, c.Label, ownerSuffix(c.Owner), dueSuffix(c.Due), baseSuffix(c, drift))
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

// countProgress is the progress total.
func countProgress(e *waveobj.Effort) int {
	n := 0
	for _, c := range e.Chunks {
		if inProgressTotal(c.Status) {
			n++
		}
	}
	return n
}

// inProgressTotal says whether a chunk counts toward the progress total, as the cockpit counts it (the initiative band
// and its popover, popoverProgress in initiativepopovermodel.ts, and the Brief's row): a proposed chunk is not work until
// it is accepted, and a skipped one has left the plan.
func inProgressTotal(status string) bool {
	return status != "proposed" && status != "skipped"
}

// summaryProgressTotal is a listed effort's total, counted from its chunks the way countProgress counts. The summary's own
// Total counts skipped chunks (the Brief takes them out itself), so it stands only for a summary without chunks.
func summaryProgressTotal(s wshrpc.EffortSummary) int {
	if len(s.Chunks) == 0 {
		return s.Total
	}
	n := 0
	for _, c := range s.Chunks {
		if inProgressTotal(c.Status) {
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

func dueSuffix(due string) string {
	if due == "" {
		return ""
	}
	return " (due " + due + ")"
}

// baseSuffix names the commit an open chunk was written at, how far the code moved since and the files it names that
// changed; a settled chunk (done, skipped) has nothing left to go stale, so it prints none. A chunk from before bases
// were kept is "written around" the commit HEAD was at when it was added.
func baseSuffix(c waveobj.EffortChunk, drift chunkDrift) string {
	if c.Status == "done" || c.Status == "skipped" {
		return ""
	}
	var d *wshrpc.CommandEffortChunkDriftRtnData
	if drift != nil {
		d = drift(c.Label)
	}
	base, verb := c.BaseCommit, "written at"
	if base == "" && d != nil && d.Inferred {
		base, verb = d.Base, "written around"
	}
	if base == "" {
		return ""
	}
	at := " (" + verb + " " + jarvis.ShortCommit(base)
	if d == nil {
		return at + ")"
	}
	switch d.Behind {
	case 0:
		at += ", the code has not moved since"
	case 1:
		at += ", 1 commit ago"
	default:
		at += fmt.Sprintf(", %d commits ago", d.Behind)
	}
	if files := staleFilesText(d.Files); files != "" {
		at += "; " + files
	}
	return at + ")"
}

// staleFilesText names the files a chunk mentions that changed or went away since it was written:
// "IMAGE.md deleted, councilstore.ts changed 4 times".
func staleFilesText(files []wshrpc.EffortStaleFile) string {
	var parts []string
	for _, f := range files {
		switch {
		case f.Gone && f.RenamedTo != "":
			parts = append(parts, f.Mention+" renamed to "+f.RenamedTo)
		case f.Gone:
			parts = append(parts, f.Mention+" deleted")
		case f.Changes == 1:
			parts = append(parts, f.Mention+" changed once")
		default:
			parts = append(parts, fmt.Sprintf("%s changed %d times", f.Mention, f.Changes))
		}
	}
	return strings.Join(parts, ", ")
}

var effortStaleCmd = &cobra.Command{
	Use:   "stale [effort]",
	Short: "list the open chunks whose named files changed or went away since they were written",
	Long: `List the open chunks of one initiative, or of every active and paused one, that name a file which
changed or went away since the chunk was written. A chunk names a file in its label or notes
("councilstore.ts", "pkg/x/y.go"); one that names none is not listed. wavesrv also runs this scan on
its own, two minutes after start and every 15 minutes. Read each listed chunk against the code: rename
it, note it, skip it, or run "wsh effort chunk recheck" when it still holds.`,
	Args:    cobra.MaximumNArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data := wshrpc.CommandEffortStaleData{}
		if len(args) == 1 {
			data.EffortOID = args[0]
		}
		rtn, err := wshclient.EffortStaleCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 120000})
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(rtn)
		}
		fmt.Print(formatEffortStale(rtn.Efforts))
		return nil
	},
}

// formatEffortStale renders the stale scan: one block per initiative, each flagged chunk with its files.
func formatEffortStale(efforts []wshrpc.EffortStaleEntry) string {
	var b strings.Builder
	n := 0
	for _, e := range efforts {
		if len(e.Chunks) == 0 {
			continue
		}
		fmt.Fprintf(&b, "# %s (effort:%s)\n", e.Title, e.EffortOID)
		for _, c := range e.Chunks {
			n++
			verb := "written at"
			if c.Inferred {
				verb = "written around"
			}
			fmt.Fprintf(&b, "  %d. %s\n", c.Index, c.Chunk)
			fmt.Fprintf(&b, "      %s %s, %d landed since: %s\n", verb, jarvis.ShortCommit(c.Base), c.Landed, staleFilesText(c.Files))
		}
	}
	if n == 0 {
		return "No open chunk names a file that changed since it was written.\n"
	}
	fmt.Fprintf(&b, "\n%d chunks to recheck: rename, note or skip each, or `wsh effort chunk recheck` when it still holds.\n", n)
	return b.String()
}

var effortChunkBackfillBaseCmd = &cobra.Command{
	Use:   "backfill-base [effort]",
	Short: "stamp a base commit on the open chunks written before chunks kept one",
	Long: `Stamp a base commit on the open chunks of one initiative, or of every active and paused one, that have
none because they were written before chunks kept one: the commit the project's HEAD was at when each
was added. Their staleness then counts from that commit. wavesrv does this on its own too, two minutes
after start and every 15 minutes; the stamp adds no note and does not change when a chunk was updated.`,
	Args:    cobra.MaximumNArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data := wshrpc.CommandEffortBackfillBaseData{}
		if len(args) == 1 {
			data.EffortOID = args[0]
		}
		rtn, err := wshclient.EffortBackfillBaseCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: 120000})
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(rtn)
		}
		fmt.Printf("stamped a base on %d chunks in %d initiatives\n", rtn.Chunks, rtn.Efforts)
		return nil
	},
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
	effortListCmd.Flags().Bool("topics", false, "only the efforts others are linked under (the parents a new effort can join)")
	effortListCmd.Flags().Bool("json", false, "JSON output")
	effortShowCmd.Flags().Bool("json", false, "JSON output")
	effortPinCmd.Flags().Bool("replace-oldest", false, "at the cap, unpin the oldest pin to make room")
	effortPinCmd.Flags().Bool("json", false, "JSON output")
	effortUnpinCmd.Flags().Bool("json", false, "JSON output")
	effortLinkCmd.Flags().String("parent", "", "parent effort oid")
	effortDeleteCmd.Flags().Bool("force", false, "delete without archiving first")
	effortAdvanceCmd.Flags().String("note", "", "annotation")
	effortChunkAddCmd.Flags().Int("at", 0, "1-based insert position")
	effortChunkAddCmd.Flags().String("owner", "", "chunk owner")
	effortChunkAddCmd.Flags().String("stage", "", "grouping label")
	effortChunkAddCmd.Flags().String("due", "", "the day it comes due: YYYY-MM-DD or +Nd")
	effortChunkAddCmd.Flags().Bool("proposed", false, "propose the chunk; it counts once accepted")
	effortChunkStatusCmd.Flags().String("note", "", "annotation")
	effortChunkRecheckCmd.Flags().String("note", "", "what was checked")
	effortChunkNoteCmd.Flags().String("note", "", "annotation text (required)")
	effortChunkNoteCmd.MarkFlagRequired("note")
	effortChunkAttachCmd.Flags().String("run", "", "run oid")
	effortChunkAttachCmd.Flags().String("agent", "", "agent tab id")
	effortChunkDetachCmd.Flags().String("run", "", "run oid")
	effortChunkDetachCmd.Flags().String("agent", "", "agent tab id")
	effortStaleCmd.Flags().Bool("json", false, "JSON output")
	effortChunkBackfillBaseCmd.Flags().Bool("json", false, "JSON output")

	effortCmd.AddCommand(effortCreateCmd, effortListCmd, effortShowCmd, effortRenameCmd,
		effortProjectCmd, effortTicketCmd, effortStatusCmd, effortUnarchiveCmd, effortPinCmd, effortUnpinCmd,
		effortLinkCmd, effortUnlinkCmd,
		effortDeleteCmd, effortAdvanceCmd, effortReopenCmd, effortStaleCmd, effortChunkCmd)
	effortChunkCmd.AddCommand(effortChunkAddCmd, effortChunkRenameCmd, effortChunkRecheckCmd, effortChunkMoveCmd,
		effortChunkRemoveCmd, effortChunkStatusCmd, effortChunkNoteCmd, effortChunkOwnerCmd,
		effortChunkStageCmd, effortChunkDueCmd, effortChunkAttachCmd, effortChunkDetachCmd, effortChunkBackfillBaseCmd)
	rootCmd.AddCommand(effortCmd)
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/ideastore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var ideaCmd = &cobra.Command{
	Use:   "idea",
	Short: "record and read a brainstorm's ideas, decisions and open questions (shown on the agent's details rail)",
}

// ideaTarget names the session a command works on: --session, else the terminal this runs in.
func ideaTarget(session string) (wshrpc.CommandIdeaTargetData, error) {
	if session != "" {
		return wshrpc.CommandIdeaTargetData{SessionId: session}, nil
	}
	if blockId := os.Getenv("WAVETERM_BLOCKID"); blockId != "" {
		return wshrpc.CommandIdeaTargetData{BlockId: blockId}, nil
	}
	return wshrpc.CommandIdeaTargetData{}, errors.New("not in an arcterm terminal: pass --session <id>")
}

func ideaTargetOf(cmd *cobra.Command) (wshrpc.CommandIdeaTargetData, error) {
	return ideaTarget(mustFlagString(cmd, "session"))
}

func validateIdeaKind(kind string) error {
	switch kind {
	case ideastore.KindDecision, ideastore.KindIdea, ideastore.KindQuestion:
		return nil
	}
	return fmt.Errorf("invalid kind %q (want %s, %s or %s)", kind, ideastore.KindIdea, ideastore.KindDecision, ideastore.KindQuestion)
}

func validateIdeaBy(by string) error {
	if by == ideastore.ByAgent || by == ideastore.ByYou {
		return nil
	}
	return fmt.Errorf("invalid author %q (want %s or %s)", by, ideastore.ByAgent, ideastore.ByYou)
}

// ideaLine is one idea as a line: id, kind, topic ("-" for none) and text; a text of several lines folds into one,
// so a line stays an idea.
func ideaLine(id, kind, topic, text string) string {
	if topic == "" {
		topic = "-"
	}
	return id + "\t" + kind + "\t" + topic + "\t" + strings.Join(strings.Fields(text), " ")
}

var ideaAddCmd = &cobra.Command{
	Use:     "add <text>",
	Short:   "record an idea, a decision or an open question, one line (--kind idea|decision|question, --topic <words>)",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		kind, by := mustFlagString(cmd, "kind"), mustFlagString(cmd, "by")
		if err := validateIdeaKind(kind); err != nil {
			return err
		}
		if err := validateIdeaBy(by); err != nil {
			return err
		}
		target, err := ideaTargetOf(cmd)
		if err != nil {
			return err
		}
		idea, err := wshclient.IdeaAddCommand(RpcClient, wshrpc.CommandIdeaAddData{CommandIdeaTargetData: target, Text: args[0], Kind: kind, By: by, Topic: mustFlagString(cmd, "topic")}, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(idea)
		}
		fmt.Printf("idea %s added\n", idea.ID)
		return nil
	},
}

var ideaListCmd = &cobra.Command{
	Use:     "list",
	Short:   "list the session's ideas not dropped: id, kind, topic (- for none) and text",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		target, err := ideaTargetOf(cmd)
		if err != nil {
			return err
		}
		session, err := wshclient.IdeaListCommand(RpcClient, target, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(session)
		}
		for _, idea := range session.Ideas {
			if !idea.Dropped {
				fmt.Println(ideaLine(idea.ID, idea.Kind, idea.Topic, idea.Text))
			}
		}
		return nil
	},
}

func addIdeaUpdateFlags(cmd *cobra.Command) {
	cmd.Flags().String("kind", "", "move the ideas to a kind: idea, decision or question")
	cmd.Flags().String("text", "", "replace the text of one idea")
	cmd.Flags().String("topic", "", "set the ideas' topic, a few words (\"\" clears it)")
	cmd.Flags().Bool("drop", false, "drop the ideas")
	cmd.Flags().Bool("restore", false, "restore dropped ideas")
	cmd.Flags().Bool("merge", false, "merge two or more ideas into the oldest")
}

// buildIdeaUpdate checks the update flags and ids and turns them into the command's op, without its target.
func buildIdeaUpdate(cmd *cobra.Command, ids []string) (wshrpc.CommandIdeaUpdateData, error) {
	f := cmd.Flags()
	drop, _ := f.GetBool("drop")
	restore, _ := f.GetBool("restore")
	merge, _ := f.GetBool("merge")
	actions := 0
	for _, set := range []bool{f.Changed("kind"), f.Changed("text"), f.Changed("topic"), drop, restore, merge} {
		if set {
			actions++
		}
	}
	if actions != 1 {
		return wshrpc.CommandIdeaUpdateData{}, errors.New("give exactly one of --kind, --text, --topic, --drop, --restore, --merge")
	}
	if len(ids) == 0 {
		return wshrpc.CommandIdeaUpdateData{}, errors.New("name the ideas to update by id (see `wsh idea list`)")
	}
	data := wshrpc.CommandIdeaUpdateData{Ids: ids}
	switch {
	case f.Changed("kind"):
		data.Op, data.NewKind = ideastore.OpKind, mustFlagString(cmd, "kind")
		if err := validateIdeaKind(data.NewKind); err != nil {
			return wshrpc.CommandIdeaUpdateData{}, err
		}
	case f.Changed("text"):
		data.Op, data.Text = ideastore.OpEdit, strings.TrimSpace(mustFlagString(cmd, "text"))
		if len(ids) != 1 || data.Text == "" {
			return wshrpc.CommandIdeaUpdateData{}, errors.New("--text takes one idea id and its new text")
		}
	case f.Changed("topic"):
		data.Op, data.Topic = ideastore.OpTopic, mustFlagString(cmd, "topic")
	case drop:
		data.Op = ideastore.OpDrop
	case restore:
		data.Op = ideastore.OpRestore
	case merge:
		data.Op = ideastore.OpMerge
		if len(ids) < 2 {
			return wshrpc.CommandIdeaUpdateData{}, errors.New("--merge takes two or more idea ids")
		}
	}
	return data, nil
}

var ideaUpdateCmd = &cobra.Command{
	Use:     "update <id...>",
	Short:   "change ideas by id: --kind <kind>, --text <text>, --topic <words>, --drop, --restore or --merge (exactly one)",
	Args:    cobra.MinimumNArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		data, err := buildIdeaUpdate(cmd, args)
		if err != nil {
			return err
		}
		if data.CommandIdeaTargetData, err = ideaTargetOf(cmd); err != nil {
			return err
		}
		if err := wshclient.IdeaUpdateCommand(RpcClient, data, nil); err != nil {
			return err
		}
		// a silent success reads the same as a no-op
		fmt.Printf("%s applied to %s\n", data.Op, strings.Join(data.Ids, " "))
		return nil
	},
}

var ideaTickCmd = &cobra.Command{
	Use:     "tick",
	Short:   "count one more prompt in the session and print the nudge to record ideas, if one is due (used by the Claude mod)",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		target, err := ideaTargetOf(cmd)
		if err != nil {
			return err
		}
		rtn, err := wshclient.IdeaTickCommand(RpcClient, target, nil)
		if err != nil {
			return err
		}
		if rtn.Nudge != "" {
			fmt.Println(rtn.Nudge)
		}
		return nil
	},
}

func init() {
	ideaCmd.PersistentFlags().String("session", "", "the agent session's id; defaults to the session in this terminal")
	ideaAddCmd.Flags().String("kind", ideastore.KindIdea, "idea, decision or question")
	ideaAddCmd.Flags().String("by", ideastore.ByAgent, "who had it: agent or you")
	ideaAddCmd.Flags().String("topic", "", "a few words that group it on the rail, e.g. Layout or Part 2")
	ideaAddCmd.Flags().Bool("json", false, "JSON output")
	ideaListCmd.Flags().Bool("json", false, "JSON output (every idea, dropped ones too)")
	addIdeaUpdateFlags(ideaUpdateCmd)
	ideaCmd.AddCommand(ideaAddCmd, ideaListCmd, ideaUpdateCmd, ideaTickCmd)
	rootCmd.AddCommand(ideaCmd)
}

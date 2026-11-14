// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var councilMemoryCmd = &cobra.Command{
	Use:   "memory <id> [add <kind> <text> | edit <entry> <text> | rm <entry>]",
	Short: "read or change a council's memory: what it settled (Agreed), dropped (Ruled out) and left Open",
	Long: `With the id alone, print a council's memory: the direction the person chose, then each entry with its id (m1, m2…),
its kind and who wrote it (auto: the round check; you: the person).

Change it when the person settles a point about the council outside it, in your session, so the council and the
"Council decisions" block arcterm writes into CLAUDE.md stop saying what is no longer true:
  add <agreed|ruledout|open> <text>   a new entry (--why for a Ruled out one)
  edit <entry> <text>                  rewrite an entry (--why for a Ruled out one)
  rm <entry>                           take an entry off
To close an Open entry, rm it and add the answer as Agreed. What you write is the person's: record only what they
decided, in the language the memory is in. The direction itself is set in the app.`,
	Args:    cobra.MinimumNArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		if len(args) == 1 {
			c, err := wshclient.CouncilGetCommand(RpcClient, wshrpc.CommandCouncilIdData{Id: id}, nil)
			if err != nil {
				return err
			}
			if isJSON(cmd) {
				return jsonOut(c.Memory)
			}
			fmt.Print(councilMemoryText(c))
			return nil
		}
		why, _ := cmd.Flags().GetString("why")
		data, err := councilMemoryData(id, args[1:], why)
		if err != nil {
			return err
		}
		if err := wshclient.CouncilMemoryCommand(RpcClient, data, nil); err != nil {
			return err
		}
		fmt.Printf("council %s memory: %s done\n", id, args[1])
		return nil
	},
}

func init() {
	councilMemoryCmd.Flags().String("why", "", "why a Ruled out entry was dropped")
}

// councilMemoryData turns `memory <id> <action> …` into the move CouncilMemoryCommand makes. Pure.
func councilMemoryData(id string, args []string, why string) (wshrpc.CommandCouncilMemoryData, error) {
	action := strings.ToLower(args[0])
	rest := args[1:]
	data := wshrpc.CommandCouncilMemoryData{Id: id, Why: strings.TrimSpace(why)}
	switch action {
	case "add":
		if len(rest) < 2 {
			return data, errors.New("add takes a kind (agreed, ruledout, open) and the text")
		}
		kind := strings.ReplaceAll(strings.ToLower(rest[0]), "-", "")
		if kind != council.EntryAgreed && kind != council.EntryRuledOut && kind != council.EntryOpen {
			return data, fmt.Errorf("unknown kind %q: use agreed, ruledout or open", rest[0])
		}
		data.Action, data.Kind, data.Text = council.EntryActionAdd, kind, strings.Join(rest[1:], " ")
	case "edit":
		if len(rest) < 2 {
			return data, errors.New("edit takes the entry id (m3) and the new text")
		}
		data.Action, data.Entry, data.Text = council.EntryActionEdit, rest[0], strings.Join(rest[1:], " ")
	case "rm", "remove":
		if len(rest) != 1 {
			return data, errors.New("rm takes one entry id (m3)")
		}
		data.Action, data.Entry = council.EntryActionRemove, rest[0]
	default:
		return data, fmt.Errorf("unknown action %q: use add, edit or rm", args[0])
	}
	if action != "rm" && action != "remove" && strings.TrimSpace(data.Text) == "" {
		return data, errors.New("the entry needs text")
	}
	return data, nil
}

// councilMemoryText is a council's memory as `wsh council memory <id>` prints it. Pure.
func councilMemoryText(c *council.Council) string {
	var b strings.Builder
	m := c.Memory
	if m != nil && m.Chosen != nil {
		fmt.Fprintf(&b, "Direction: %s\n", m.Chosen.Text)
	} else {
		b.WriteString("Direction: (none chosen)\n")
	}
	if m != nil && m.Suggestion != nil {
		fmt.Fprintf(&b, "Suggested, waiting on the person: %s\n", m.Suggestion.Text)
	}
	if m == nil || len(m.Entries) == 0 {
		b.WriteString("No entries.\n")
		return b.String()
	}
	for _, e := range m.Entries {
		fmt.Fprintf(&b, "%s  %-8s %-4s %s", e.Id, e.Kind, e.By, e.Text)
		if e.Why != "" {
			fmt.Fprintf(&b, " (why: %s)", e.Why)
		}
		b.WriteString("\n")
	}
	return b.String()
}

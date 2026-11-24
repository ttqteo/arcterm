// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// refigureTimeoutMs bounds the call: one no-tools model call, then the report's rewrite with its Cite check.
const refigureTimeoutMs = 5 * 60_000

var councilRefigureCmd = &cobra.Command{
	Use:   "refigure <id>",
	Short: "have a model say how an old council's verified figures hang together, so its report draws them as charts",
	Args:  cobra.ExactArgs(1),
	Long: `A council run before seats declared how their figures relate (group, of, was, limit, bound, unit, at) reports its
figures as one flat table. refigure makes one model call with no tools (haiku by default, --model to change it) over the
council's verified figures and the question, stores the relations it names on the council's record (figurerelations,
never on a seat's proposal), and rewrites the council's saved report so its Figures section draws them. Go checks every
relation as it checks a seat's: the other figure must be a verified one of the same kind, a part no larger than its
whole, and parts no more than their whole; a relation that fails is dropped and listed in the report. The figures, their
values and their verdicts are not changed. Running it again replaces the relations. A council that is still running is
refused. The call costs tokens, printed at the end.`,
	PreRunE: preRunCouncilId,
	RunE: func(cmd *cobra.Command, args []string) error {
		model, _ := cmd.Flags().GetString("model")
		rtn, err := wshclient.CouncilRefigureCommand(RpcClient, wshrpc.CommandCouncilRefigureData{Id: args[0], Model: model}, &wshrpc.RpcOpts{Timeout: refigureTimeoutMs})
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(rtn)
		}
		fmt.Print(refigureText(args[0], rtn))
		return nil
	},
}

// refigureText is what refigure prints: each verified figure with the relations Go kept on it, then the ones it dropped
// and why, the tokens and the report rewritten.
func refigureText(id string, rtn *wshrpc.CouncilRefigureRtnData) string {
	var b strings.Builder
	kept, dropped := 0, 0
	for _, f := range rtn.Figures {
		if f.Cite != council.CiteOK {
			continue
		}
		var rel []string
		add := func(label, v string) {
			if v != "" {
				rel = append(rel, label+" "+v)
			}
		}
		add("group", f.Group)
		add("of", f.Of)
		add("was", f.Was)
		if f.Limit != "" {
			bound := f.Bound
			if bound == "" {
				bound = "max"
			}
			add("limit", f.Limit+" ("+bound+")")
		}
		add("unit", f.Unit)
		add("at", f.At)
		line := "—"
		if len(rel) > 0 {
			line = strings.Join(rel, ", ")
			if f.Of != "" || f.Was != "" || f.Limit != "" {
				kept++
			}
		}
		fmt.Fprintf(&b, "%-20s %s\n", councilOneLine(f.Value), line)
		if f.RelNote != "" {
			dropped++
			fmt.Fprintf(&b, "%-20s dropped: %s\n", "", f.RelNote)
		}
	}
	fmt.Fprintf(&b, "council %s: %d figure(s) linked to another, %d with a relation dropped, %d tokens\n", id, kept, dropped, rtn.Tokens)
	if rtn.Path != "" {
		fmt.Fprintf(&b, "rewrote %s\n", rtn.Path)
	} else {
		b.WriteString("the council has no saved report; save one from the app or with `wsh council redoc`\n")
	}
	return b.String()
}

func init() {
	councilRefigureCmd.Flags().String("model", "", "the model of the call (default: "+council.ModelRefigure+")")
	councilRefigureCmd.Flags().Bool("json", false, "print the result as JSON")
	councilCmd.AddCommand(councilRefigureCmd)
}

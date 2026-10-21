// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"sort"
	"strings"
)

const matrixReasonRunes = 120 // a matrix cell keeps one line of the reason, cut here

// Markdown is the Summary and its Matrix as a document, what Save as doc writes into the project: the feature, the
// coordinator's paragraph, the directions in rank order with each expert's stance, then proposals × experts.
func Markdown(c *Council) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Council: %s\n\n", c.Feature)
	if c.Summary == nil {
		b.WriteString("_No summary yet._\n")
	} else {
		if t := strings.TrimSpace(c.Summary.Text); t != "" {
			b.WriteString(t + "\n\n")
		}
		if len(c.Summary.Directions) > 0 {
			b.WriteString("## Directions\n\n")
			for i, d := range c.Summary.Directions {
				writeDirection(&b, c, i+1, d)
			}
		}
	}
	if len(c.Proposals) > 0 {
		b.WriteString("\n## Matrix\n\n")
		writeMatrix(&b, c)
	}
	return b.String()
}

func writeDirection(b *strings.Builder, c *Council, n int, d CouncilDirection) {
	verdict := "Split"
	if d.Agreed {
		verdict = "Agreed"
	}
	fmt.Fprintf(b, "%d. **%s** (%s)\n", n, d.Title, verdict)
	if len(d.From) > 0 {
		from := make([]string, len(d.From))
		for i, id := range d.From {
			from[i] = id
			if p := findProposal(c, id); p != nil {
				from[i] = fmt.Sprintf("%s (%s)", id, speaker(c, p.Author))
			}
		}
		fmt.Fprintf(b, "   From %s.\n", strings.Join(from, ", "))
	}
	if r := strings.TrimSpace(d.Reasoning); r != "" {
		b.WriteString("   " + strings.ReplaceAll(r, "\n", "\n   ") + "\n")
	}
	if stances := stanceList(c, d.Stances); stances != "" {
		fmt.Fprintf(b, "   Stances: %s.\n", stances)
	}
	b.WriteString("\n")
}

// stanceList names each expert's stance in the panel's order; an id the panel does not hold follows, sorted.
func stanceList(c *Council, stances map[string]CouncilStance) string {
	var parts []string
	seen := map[string]bool{}
	for _, e := range c.Experts {
		if s, ok := stances[e.Id]; ok {
			parts = append(parts, fmt.Sprintf("%s %s", e.Name, s))
			seen[e.Id] = true
		}
	}
	var rest []string
	for id := range stances {
		if !seen[id] {
			rest = append(rest, id)
		}
	}
	sort.Strings(rest)
	for _, id := range rest {
		parts = append(parts, fmt.Sprintf("%s %s", id, stances[id]))
	}
	return strings.Join(parts, ", ")
}

// tableCell makes text safe inside a table cell: one line, no bare pipe.
func tableCell(s string) string {
	return strings.ReplaceAll(strings.Join(strings.Fields(s), " "), "|", `\|`)
}

func writeMatrix(b *strings.Builder, c *Council) {
	var panel []CouncilExpert
	for _, e := range c.Experts {
		if !e.Coordinator {
			panel = append(panel, e)
		}
	}
	head, rule := "| Proposal |", "|---|"
	for _, e := range panel {
		head += " " + tableCell(e.Name) + " |"
		rule += "---|"
	}
	b.WriteString(head + " Outcome |\n" + rule + "---|\n")
	for _, p := range c.Proposals {
		fmt.Fprintf(b, "| %s |", tableCell(p.Id+" · "+p.Title))
		for _, e := range panel {
			b.WriteString(" " + matrixCell(c, p, e) + " |")
		}
		b.WriteString(" " + matrixOutcome(c, p) + " |\n")
	}
}

// matrixCell is one expert's stance on one proposal and the line of reason it gave, from its first reply straight
// to the proposal.
func matrixCell(c *Council, p CouncilProposal, e CouncilExpert) string {
	if p.Author == e.Id {
		return "author"
	}
	for _, r := range c.Replies {
		if r.ProposalId != p.Id || r.Author != e.Id || r.ParentId != "" || r.Stance == "" {
			continue
		}
		reason := strings.Join(strings.Fields(r.Text), " ")
		if runes := []rune(reason); len(runes) > matrixReasonRunes {
			reason = strings.TrimSpace(string(runes[:matrixReasonRunes])) + "…"
		}
		return tableCell(string(r.Stance) + ": " + reason)
	}
	return "—"
}

func matrixOutcome(c *Council, p CouncilProposal) string {
	if c.Summary != nil {
		if o := strings.TrimSpace(c.Summary.Outcomes[p.Id]); o != "" {
			return tableCell(o)
		}
	}
	switch {
	case p.Cut:
		return "Cut at the pause"
	case p.Withdrawn:
		return "Withdrawn"
	}
	return "—"
}

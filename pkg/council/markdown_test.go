// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"strings"
	"testing"
)

func markdownCouncil() *Council {
	return &Council{
		Id:      "c1",
		Feature: "Idle sleep for services",
		Experts: []CouncilExpert{
			{Id: "ux", Name: "UX"},
			{Id: "ram", Name: "RAM"},
			{Id: "skeptic", Name: "Skeptic"},
			{Id: "lead", Name: "Lead", Coordinator: true},
		},
		Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Title: "Show the sleep state"},
			{Id: "P2", Author: "ram", Title: "Sleep after a minute | or two"},
			{Id: "P3", Author: "skeptic", Title: "Wake on hover", Withdrawn: true},
			{Id: "P4", Author: "ram", Title: "Poll less", Cut: true},
			{Id: "P5", Author: "ux", Title: "Quiet badge"},
		},
		Replies: []CouncilReply{
			{Id: "r1", ProposalId: "P1", Author: "ram", Stance: StanceAccept, Text: "Cheap to do.\nAnd clear."},
			{Id: "r2", ProposalId: "P1", Author: "skeptic", Stance: StanceChallenge, Text: "Costs a | pipe in a cell"},
			{Id: "r3", ProposalId: "P2", Author: "ux", Stance: StanceOppose, Text: strings.Repeat("long ", 60)},
			{Id: "r4", ProposalId: "P1", ParentId: "r1", Author: "ux", Stance: StanceAccept, Text: "a branch reply is not the stance"},
			{Id: "r5", ProposalId: "P2", Author: YouId, Text: "no stance from the person"},
		},
		Summary: &CouncilSummary{
			Text: "The panel prefers showing the state.",
			Directions: []CouncilDirection{
				{Rank: 1, Title: "Show the state", Reasoning: "It answers\nthe question people ask.", From: []string{"P1", "P5"},
					Stances: map[string]CouncilStance{"skeptic": StanceChallenge, "ram": StanceAccept, "ux": StanceAccept, "ghost": StanceOppose}, Agreed: false},
				{Rank: 2, Title: "Sleep sooner", From: []string{"P2"}, Stances: map[string]CouncilStance{"ram": StanceAccept}, Agreed: true},
			},
			Outcomes: map[string]string{"P1": "Direction 1", "P2": "Direction 2", "P5": "Merged into direction 1", "P3": "Withdrawn in round 2"},
		},
	}
}

func TestMarkdown(t *testing.T) {
	md := Markdown(markdownCouncil())

	wantLines := []string{
		"# Council: Idle sleep for services",
		"The panel prefers showing the state.",
		"## Directions",
		"1. **Show the state** (Split)",
		"   From P1 (UX), P5 (UX).",
		"   It answers\n   the question people ask.",
		"   Stances: UX accept, RAM accept, Skeptic challenge, ghost oppose.", // the panel's order, then an unknown id
		"2. **Sleep sooner** (Agreed)",
		"   Stances: RAM accept.",
		"## Matrix",
		"| Proposal | UX | RAM | Skeptic | Outcome |",
		"|---|---|---|---|---|",
	}
	for _, w := range wantLines {
		if !strings.Contains(md, w) {
			t.Errorf("markdown lacks %q\n---\n%s", w, md)
		}
	}
	// the headings and the table come in order
	last := -1
	for _, w := range []string{"# Council:", "The panel prefers", "## Directions", "1. **", "2. **", "## Matrix", "| Proposal |"} {
		i := strings.Index(md, w)
		if i < last {
			t.Errorf("%q is out of order in\n%s", w, md)
		}
		last = max(last, i)
	}
}

func TestMarkdownMatrixRows(t *testing.T) {
	md := Markdown(markdownCouncil())
	rows := map[string]string{}
	for line := range strings.SplitSeq(md, "\n") {
		if len(line) > 3 && line[:3] == "| P" && line[3] >= '0' && line[3] <= '9' {
			id, _, _ := strings.Cut(strings.TrimPrefix(line, "| "), " ")
			rows[id] = line
		}
	}
	want := map[string]string{
		"P1": "| P1 · Show the sleep state | author | accept: Cheap to do. And clear. | challenge: Costs a \\| pipe in a cell | Direction 1 |",
		"P2": `| P2 · Sleep after a minute \| or two | oppose: ` + strings.TrimSpace(strings.Repeat("long ", 24)) + "… | author | — | Direction 2 |",
		"P3": "| P3 · Wake on hover | — | — | author | Withdrawn in round 2 |",
		"P4": "| P4 · Poll less | — | author | — | Cut at the pause |",
		"P5": "| P5 · Quiet badge | author | — | — | Merged into direction 1 |",
	}
	for id, w := range want {
		if rows[id] != w {
			t.Errorf("row %s = %q\nwant      %q", id, rows[id], w)
		}
	}
	if len(rows) != len(want) {
		t.Errorf("rows = %v, want one per proposal", rows)
	}
}

func TestMarkdownOutcomeFallsBackToTheProposalsState(t *testing.T) {
	c := markdownCouncil()
	c.Summary.Outcomes = nil
	md := Markdown(c)
	for _, w := range []string{"| Withdrawn |", "| Cut at the pause |", "| — |"} {
		if !strings.Contains(md, w) {
			t.Errorf("markdown lacks %q\n---\n%s", w, md)
		}
	}
}

func TestMarkdownWithoutASummaryStillHasTheMatrix(t *testing.T) {
	c := markdownCouncil()
	c.Summary = nil
	md := Markdown(c)
	for _, w := range []string{"# Council: Idle sleep for services", "_No summary yet._", "## Matrix"} {
		if !strings.Contains(md, w) {
			t.Errorf("markdown lacks %q\n---\n%s", w, md)
		}
	}
	if strings.Contains(md, "## Directions") {
		t.Errorf("a council with no summary has no directions\n%s", md)
	}
}

func TestMarkdownWithNoProposalsHasNoMatrix(t *testing.T) {
	c := markdownCouncil()
	c.Proposals, c.Replies = nil, nil
	if md := Markdown(c); strings.Contains(md, "## Matrix") {
		t.Errorf("no proposals, no matrix\n%s", md)
	}
}

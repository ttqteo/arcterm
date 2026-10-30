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

func TestMarkdownReviewAlsoRaised(t *testing.T) {
	c := markdownCouncil()
	c.Summary.Directions[0].FirstStep = "Add the state word to the tree row."
	c.Summary.Kept = []CouncilDirection{{Rank: 1, Title: "Poll less", Reasoning: "Halves the wakeups.", From: []string{"P5"}}}
	md := Markdown(c)
	for _, w := range []string{
		"   First step: Add the state word to the tree row.\n",
		"## Also raised\n\n- **Poll less** (from P5 (UX)): Halves the wakeups.\n",
	} {
		if !strings.Contains(md, w) {
			t.Errorf("markdown lacks %q\n---\n%s", w, md)
		}
	}
	if strings.Index(md, "## Also raised") < strings.Index(md, "2. **Sleep sooner**") || strings.Index(md, "## Also raised") > strings.Index(md, "## Matrix") {
		t.Errorf("Also raised must sit between the directions and the matrix\n%s", md)
	}
	if strings.Contains(md, "Wild ideas kept aside") {
		t.Errorf("a Review's Kept is Also raised, not wild ideas\n%s", md)
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

// ---- the saved document ----

// documentCouncil is markdownCouncil with the times, models, evidence and the person's words a document shows.
func documentCouncil() *Council {
	c := markdownCouncil()
	c.Question = "Which direction first?\nKeep to: no new setting."
	c.Summary.Answer = "Show the sleep state first."
	c.ModeWhy = "a feature that exists, waiting to be judged"
	c.Experts[0].Model, c.Experts[1].Model, c.Experts[2].Model, c.Experts[3].Model = "sonnet", "sonnet", "sonnet", "opus"
	c.Tokens, c.Calls, c.Started, c.Updated, c.State = 820_000, 9, 1_000, 1_000+372_000, StateDone
	for i := range c.Proposals {
		c.Proposals[i].Ts = int64(10 * (i + 1))
	}
	c.Proposals[0].Argument = "A badge tells people why it is slow.\n\nIt costs one render."
	c.Proposals[0].Evidence = []CouncilEvidence{{Ref: "a.go:1"}, {Weak: true, Note: `"about 3 s" has no measurement`}}
	// r3 is the oldest reply, though it sits after r1 and r2 in the list
	times := map[string]int64{"r1": 60, "r2": 70, "r3": 55, "r4": 80, "r5": 90}
	for i := range c.Replies {
		c.Replies[i].Ts = times[c.Replies[i].Id]
	}
	c.Replies = append(c.Replies,
		CouncilReply{Id: "r6", ProposalId: "P1", Author: "lead", Stance: StanceAccept, Ts: 85},
		CouncilReply{Id: "r7", Author: YouId, Text: "Anyone against?", To: []string{"ux", "ram", "skeptic"}, Round: 2, Ts: 100},
	)
	return c
}

func TestMarkdownDiscussion(t *testing.T) {
	c := documentCouncil()
	doc := Document(c)

	// the report comes first and is what Markdown returns; the discussion and the run facts follow it
	report := strings.TrimRight(Markdown(c), "\n")
	if !strings.HasPrefix(doc, report+"\n\n## The discussion\n\n") {
		t.Errorf("the document does not open with the report then the discussion\n%s", doc)
	}
	for _, w := range []string{"You asked: Which direction first? Keep to: no new setting.", "**Show the sleep state first.**"} {
		if !strings.Contains(doc, w) {
			t.Errorf("the report lacks %q\n%s", w, doc)
		}
	}
	if strings.Contains(report, "The discussion") || strings.Contains(report, "Run facts") {
		t.Errorf("Markdown is the report only, but holds\n%s", report)
	}

	wantLines := []string{
		"- **You** sets the goal\n  Which direction first? Keep to: no new setting.\n",
		"- **UX** proposes · P1 · Show the sleep state\n  A badge tells people why it is slow.\n\n  It costs one render.\n  Evidence: a.go:1; weak: \"about 3 s\" has no measurement\n",
		"- **Skeptic** proposes · P3 · Wake on hover (withdrawn)\n",
		"- **RAM** proposes · P4 · Poll less (cut at the pause)\n",
		"- **UX** is against it · on P2 · Sleep after a minute | or two\n",
		// an accept with words is a reply; one with none is a reaction, which the document keeps as a line of its own
		"- **RAM** replies · on P1 · Show the sleep state\n  Cheap to do.\n  And clear.\n",
		"- **Skeptic** has doubts · on P1 · Show the sleep state\n  Costs a | pipe in a cell\n",
		"- **Lead** agrees · on P1 · Show the sleep state\n",
		"- **UX** replies · on P1 · Show the sleep state (replying to RAM)\n  a branch reply is not the stance\n",
		"- **You** replies · on P2 · Sleep after a minute | or two\n  no stance from the person\n",
		"- **You** steers · to the whole council\n  Anyone against?\n",
	}
	for _, w := range wantLines {
		if !strings.Contains(doc, w) {
			t.Errorf("the discussion lacks %q\n%s", w, doc)
		}
	}

	// every message in the order it was said: proposals by their times, then the replies by theirs (r3 before r1)
	last := -1
	for _, w := range []string{
		"# Council:", "## Directions", "## Matrix", "## The discussion", "sets the goal",
		"**UX** proposes · P1", "**RAM** proposes · P2", "**Skeptic** proposes · P3", "**RAM** proposes · P4", "**UX** proposes · P5",
		"**UX** is against it", "**RAM** replies · on P1", "**Skeptic** has doubts", "**UX** replies · on P1", "**Lead** agrees",
		"**You** replies", "**You** steers", "## Run facts",
	} {
		i := strings.Index(doc, w)
		if i < 0 || i < last {
			t.Errorf("%q is missing or out of order (at %d after %d) in\n%s", w, i, last, doc)
		}
		last = max(last, i)
	}

	for _, w := range []string{
		"## Run facts\n\n- Mode: Review · a feature that exists, waiting to be judged\n",
		"- Experts: UX (sonnet), RAM (sonnet), Skeptic (sonnet), Lead (opus, coordinator)\n",
		"- Tokens: 0.8M in 9 calls\n",
		"- Time: 6 min 12 s\n",
		"- Ended: done\n",
	} {
		if !strings.Contains(doc, w) {
			t.Errorf("the run facts lack %q\n%s", w, doc)
		}
	}
}

func TestDocumentRunFactsHarness(t *testing.T) {
	c := documentCouncil()
	if doc := Document(c); strings.Contains(doc, "Harness") {
		t.Errorf("a council with no harness version names one in its run facts\n%s", doc)
	}
	c.Harness = "2026-10-22.1"
	doc := Document(c)
	facts := doc[strings.Index(doc, "## Run facts"):]
	if !strings.Contains(facts, "\n- Harness: 2026-10-22.1\n") {
		t.Errorf("the run facts lack the harness version\n%s", facts)
	}
}

func TestMarkdownDiscussionOfAnEmptyCouncil(t *testing.T) {
	doc := Document(&Council{Id: "c1", Feature: "Nothing yet", State: StateStopped, Experts: []CouncilExpert{{Id: "lead", Name: "Lead", Coordinator: true}}})
	for _, w := range []string{"_No summary yet._", "## The discussion\n\n_Nothing was said._\n", "## Run facts\n\n- Mode: Review\n", "- Experts: Lead (coordinator)\n", "- Ended: stopped\n"} {
		if !strings.Contains(doc, w) {
			t.Errorf("document lacks %q\n%s", w, doc)
		}
	}
	if strings.Contains(doc, "- Time:") {
		t.Errorf("a council that never started has no time\n%s", doc)
	}
}

func savedBrainstorm() *Council {
	return &Council{
		Id: "b1", Feature: "Council for newcomers", Question: "Council opens on threads and nobody knows what to do. Fix?",
		Mode: ModeBrainstorm, ModeWhy: "a goal with no answer yet", State: StateDone, Started: 5_000, Updated: 5_000 + 45_000, Tokens: 1_200_000, Calls: 11,
		Experts: []CouncilExpert{
			{Id: "ux", Name: "UX", Model: "sonnet"},
			{Id: "skeptic", Name: "Skeptic", Model: "sonnet"},
			{Id: "lead", Name: "Lead", Model: "opus", Coordinator: true},
		},
		Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Title: "Open on the report", Argument: "Show the answer first.", Ts: 10},
			{Id: "P2", Author: "skeptic", Title: "A council as a game", Argument: "Levels and badges.", Wild: true, Ts: 20},
		},
		Replies: []CouncilReply{
			{Id: "r1", ProposalId: "P1", Author: "skeptic", Stance: StanceAccept, Builds: true, Text: "And fold the debate behind a button.", Round: 2, Ts: 30},
			{Id: "r2", ProposalId: "P1", Author: "ux", ParentId: "r1", Stance: StanceChallenge, Text: "Hidden debates are never read.", Round: 2, Ts: 40},
		},
		Summary: &CouncilSummary{
			Text:   "Move the debate behind the answer.",
			Answer: "Open the report first.",
			Directions: []CouncilDirection{
				{Rank: 1, Title: "Report first", Reasoning: "Newcomers read the answer.", From: []string{"P1"}, FirstStep: "Open the report when a council ends.", Agreed: true},
			},
			Kept:     []CouncilDirection{{Rank: 1, Title: "A council as a game", Reasoning: "Might make people curious.", From: []string{"P2"}}},
			Outcomes: map[string]string{"P1": "Direction 1", "P2": "Kept aside"},
		},
	}
}

func TestMarkdownBrainstorm(t *testing.T) {
	c := savedBrainstorm()
	report := Markdown(c)
	for _, w := range []string{
		"You asked: Council opens on threads and nobody knows what to do. Fix?",
		"**Open the report first.**",
		"## Ideas worth trying\n\n1. **Report first** (Agreed)\n",
		"   From P1 (UX).\n",
		"   First step: Open the report when a council ends.\n",
		"## Wild ideas kept aside\n\n- **A council as a game** (from P2 (Skeptic)): Might make people curious.\n",
		"| P2 · A council as a game (wild idea) |",
		"| Kept aside |",
	} {
		if !strings.Contains(report, w) {
			t.Errorf("the report lacks %q\n%s", w, report)
		}
	}
	if strings.Contains(report, "## Directions") {
		t.Errorf("a Brainstorm's report has ideas worth trying, not directions\n%s", report)
	}

	doc := Document(c)
	for _, w := range []string{
		"- **UX** idea · P1 · Open on the report\n  Show the answer first.\n",
		"- **Skeptic** wild idea · P2 · A council as a game\n  Levels and badges.\n",
		"- **Skeptic** builds on it · on P1 · Open on the report\n  And fold the debate behind a button.\n",
		"- **UX** has doubts · on P1 · Open on the report (replying to Skeptic)\n  Hidden debates are never read.\n",
		"- **You** sets the goal\n",
		"- Mode: Brainstorm · a goal with no answer yet\n",
		"- Tokens: 1.2M in 11 calls\n",
		"- Time: 45 s\n",
	} {
		if !strings.Contains(doc, w) {
			t.Errorf("the document lacks %q\n%s", w, doc)
		}
	}
	if strings.Contains(doc, "proposes") || strings.Contains(doc, "Evidence:") {
		t.Errorf("a Brainstorm has ideas and no evidence\n%s", doc)
	}
}

func TestMarkdownBrainstormWithNoWildIdeasHasNoKeptSection(t *testing.T) {
	c := savedBrainstorm()
	c.Summary.Kept = nil
	c.Proposals = c.Proposals[:1]
	for name, md := range map[string]string{"report": Markdown(c), "document": Document(c)} {
		if strings.Contains(md, "Wild ideas kept aside") || strings.Contains(md, "wild idea") {
			t.Errorf("the %s shows a wild idea section with none kept\n%s", name, md)
		}
	}
}

func TestDocumentLeavesOutHeldAndDroppedDrafts(t *testing.T) {
	c := documentCouncil()
	c.Experts[0].Agent, c.Experts[0].Harness = "tab-1", HarnessPi
	c.Skips = []CouncilSkip{{Expert: "ram", Round: 2, Reason: "still working on its own task after 10 min"}}
	c.Proposals[4].Draft = DraftHeld    // P5, Quiet badge
	c.Proposals[3].Draft = DraftDropped // P4, Poll less
	c.Replies[1].Draft = DraftHeld      // r2, the pipe in a cell
	c.Replies[2].Draft = DraftDropped   // r3, the long oppose
	doc := Document(c)
	for _, w := range []string{"Quiet badge", "Poll less", "Costs a | pipe", "long long long"} {
		if strings.Contains(doc, w) {
			t.Errorf("the document holds %q, a draft that is not out in the room\n%s", w, doc)
		}
	}
	for _, w := range []string{"Cheap to do.", "Show the sleep state", "UX (agent pi)", "- Skipped: RAM in round 2: still working on its own task after 10 min"} {
		if !strings.Contains(doc, w) {
			t.Errorf("the document lacks %q\n%s", w, doc)
		}
	}
}

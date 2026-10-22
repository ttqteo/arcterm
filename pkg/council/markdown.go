// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"sort"
	"strings"
)

const matrixReasonRunes = 120 // a matrix cell keeps one line of the reason, cut here

// Markdown is the report as a document, what `wsh council wait` and `show` print: the feature, the question and its
// one-sentence answer, the coordinator's paragraph, the directions in rank order (a Brainstorm's ideas worth trying,
// each with its first step) with each expert's stance, the wild ideas kept aside when there are any, then
// proposals × experts. Document adds the whole discussion and the run facts to it.
func Markdown(c *Council) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Council: %s\n\n", c.Feature)
	if q := oneLine(c.Question); q != "" {
		fmt.Fprintf(&b, "You asked: %s\n\n", q)
	}
	if c.Summary == nil {
		b.WriteString("_No summary yet._\n")
	} else {
		if a := oneLine(c.Summary.Answer); a != "" {
			fmt.Fprintf(&b, "**%s**\n\n", a)
		}
		if t := strings.TrimSpace(c.Summary.Text); t != "" {
			b.WriteString(t + "\n\n")
		}
		if len(c.Summary.Directions) > 0 {
			if isBrainstorm(c) {
				b.WriteString("## Ideas worth trying\n\n")
			} else {
				b.WriteString("## Directions\n\n")
			}
			for i, d := range c.Summary.Directions {
				writeDirection(&b, c, i+1, d)
			}
		}
		if isBrainstorm(c) && len(c.Summary.Kept) > 0 {
			b.WriteString("## Wild ideas kept aside\n\n")
			for _, d := range c.Summary.Kept {
				writeKept(&b, c, d)
			}
			b.WriteString("\n")
		}
	}
	if len(c.Proposals) > 0 {
		b.WriteString("\n## Matrix\n\n")
		writeMatrix(&b, c)
	}
	return b.String()
}

// oneLine is text as one trimmed line.
func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

// fromList names the proposals a direction came from, each with its author.
func fromList(c *Council, ids []string) string {
	from := make([]string, len(ids))
	for i, id := range ids {
		from[i] = id
		if p := findProposal(c, id); p != nil {
			from[i] = fmt.Sprintf("%s (%s)", id, speaker(c, p.Author))
		}
	}
	return strings.Join(from, ", ")
}

func writeDirection(b *strings.Builder, c *Council, n int, d CouncilDirection) {
	verdict := "Split"
	if d.Agreed {
		verdict = "Agreed"
	}
	fmt.Fprintf(b, "%d. **%s** (%s)\n", n, d.Title, verdict)
	if len(d.From) > 0 {
		fmt.Fprintf(b, "   From %s.\n", fromList(c, d.From))
	}
	if r := strings.TrimSpace(d.Reasoning); r != "" {
		b.WriteString("   " + strings.ReplaceAll(r, "\n", "\n   ") + "\n")
	}
	if s := oneLine(d.FirstStep); s != "" {
		fmt.Fprintf(b, "   First step: %s\n", s)
	}
	if stances := stanceList(c, d.Stances); stances != "" {
		fmt.Fprintf(b, "   Stances: %s.\n", stances)
	}
	b.WriteString("\n")
}

// writeKept is one wild idea kept aside: its title, who it came from, and why it is worth remembering.
func writeKept(b *strings.Builder, c *Council, d CouncilDirection) {
	fmt.Fprintf(b, "- **%s**", d.Title)
	if len(d.From) > 0 {
		fmt.Fprintf(b, " (from %s)", fromList(c, d.From))
	}
	if r := oneLine(d.Reasoning); r != "" {
		b.WriteString(": " + r)
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
		title := p.Title
		if p.Wild && isBrainstorm(c) {
			title += " (wild idea)"
		}
		fmt.Fprintf(b, "| %s |", tableCell(p.Id+" · "+title))
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

// ---- the saved document ----

// Document is what a finished council saves into its project: the report (Markdown), then "The discussion", every
// proposal and reply in the order it was said, then the run facts.
func Document(c *Council) string {
	var b strings.Builder
	b.WriteString(strings.TrimRight(Markdown(c), "\n") + "\n\n")
	b.WriteString("## The discussion\n\n")
	writeDiscussion(&b, c)
	b.WriteString("\n## Run facts\n\n")
	writeRunFacts(&b, c)
	return b.String()
}

// docName is who said a message, as the document names them.
func docName(c *Council, id string) string {
	if id == YouId {
		return "You"
	}
	return speaker(c, id)
}

// indent puts prefix before every line of s that holds something.
func indent(s, prefix string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i, l := range lines {
		if strings.TrimSpace(l) != "" {
			lines[i] = prefix + l
		}
	}
	return strings.Join(lines, "\n")
}

// writeMessage is one message of the discussion: who, the label in plain words, what it is about, its words and its
// evidence.
func writeMessage(b *strings.Builder, who, label, about, body string, evidence []CouncilEvidence) {
	fmt.Fprintf(b, "- **%s** %s", who, label)
	if about != "" {
		b.WriteString(" · " + about)
	}
	b.WriteString("\n")
	if strings.TrimSpace(body) != "" {
		b.WriteString(indent(body, "  ") + "\n")
	}
	if len(evidence) > 0 {
		fmt.Fprintf(b, "  Evidence: %s\n", evidenceText(evidence))
	}
}

// proposalLabel is a proposal's label: a Review's "proposes", a Brainstorm's "idea" or "wild idea".
func proposalLabel(c *Council, p CouncilProposal) string {
	switch {
	case !isBrainstorm(c):
		return "proposes"
	case p.Wild:
		return "wild idea"
	}
	return "idea"
}

// replyLabel is a reply's label in plain words. An accept with no words is a reaction ("agrees"), which the document
// keeps as a line of its own rather than dropping.
func replyLabel(c *Council, r CouncilReply) string {
	spoke := strings.TrimSpace(r.Text) != ""
	switch {
	case r.Author == YouId && r.ProposalId == "" && r.ParentId == "":
		return "steers"
	case r.Author == YouId || r.Revised:
		return "replies"
	case r.Stance == StanceChallenge:
		return "has doubts"
	case r.Stance == StanceOppose:
		return "is against it"
	case r.Stance == StanceAccept && !spoke:
		return "agrees"
	case r.Stance == StanceAccept && r.Builds && isBrainstorm(c):
		return "builds on it"
	}
	return "replies"
}

// proposalRef is "P1 · Title", or just the id for a proposal the council no longer holds.
func proposalRef(c *Council, id string) string {
	if p := findProposal(c, id); p != nil {
		return id + " · " + oneLine(p.Title)
	}
	return id
}

func proposalMessage(c *Council, p CouncilProposal) string {
	var b strings.Builder
	about := proposalRef(c, p.Id)
	switch {
	case p.Cut:
		about += " (cut at the pause)"
	case p.Withdrawn:
		about += " (withdrawn)"
	}
	writeMessage(&b, docName(c, p.Author), proposalLabel(c, p), about, p.Argument, p.Evidence)
	return b.String()
}

func replyMessage(c *Council, r CouncilReply) string {
	var b strings.Builder
	about := ""
	switch {
	case r.ProposalId != "":
		about = "on " + proposalRef(c, r.ProposalId)
	case r.Author == YouId:
		about = "to the whole council"
	}
	if parent := findReply(c, r.ParentId); parent != nil {
		about += " (replying to " + docName(c, parent.Author) + ")"
	}
	writeMessage(&b, docName(c, r.Author), replyLabel(c, r), strings.TrimSpace(about), r.Text, r.Evidence)
	return b.String()
}

// writeDiscussion lists the person's question as the goal, then every proposal and reply in time order. Proposals
// come before replies of the same instant, and the order they were saved in breaks the rest.
func writeDiscussion(b *strings.Builder, c *Council) {
	type message struct {
		ts   int64
		text string
	}
	var msgs []message
	for _, p := range c.Proposals {
		msgs = append(msgs, message{p.Ts, proposalMessage(c, p)})
	}
	for _, r := range c.Replies {
		msgs = append(msgs, message{r.Ts, replyMessage(c, r)})
	}
	sort.SliceStable(msgs, func(i, j int) bool { return msgs[i].ts < msgs[j].ts })
	q := oneLine(c.Question)
	if q != "" {
		writeMessage(b, "You", "sets the goal", "", q, nil)
	}
	for _, m := range msgs {
		b.WriteString(m.text)
	}
	if q == "" && len(msgs) == 0 {
		b.WriteString("_Nothing was said._\n")
	}
}

// docDuration is a span in milliseconds in words: "45 s", "6 min 12 s", "1 h 5 min".
func docDuration(ms int64) string {
	secs := (ms + 500) / 1000
	switch {
	case secs < 60:
		return fmt.Sprintf("%d s", secs)
	case secs < 3600:
		if secs%60 == 0 {
			return fmt.Sprintf("%d min", secs/60)
		}
		return fmt.Sprintf("%d min %d s", secs/60, secs%60)
	}
	return fmt.Sprintf("%d h %d min", secs/3600, secs%3600/60)
}

// writeRunFacts is how the council ran: its mode and why, the experts and their models, what it cost and how it ended.
func writeRunFacts(b *strings.Builder, c *Council) {
	mode := "Review"
	if isBrainstorm(c) {
		mode = "Brainstorm"
	}
	if why := oneLine(c.ModeWhy); why != "" {
		mode += " · " + why
	}
	fmt.Fprintf(b, "- Mode: %s\n", mode)
	var experts []string
	for _, e := range c.Experts {
		name := e.Name
		if name == "" {
			name = e.Id
		}
		var tags []string
		if e.Model != "" {
			tags = append(tags, e.Model)
		}
		if e.Coordinator {
			tags = append(tags, "coordinator")
		}
		if len(tags) > 0 {
			name += " (" + strings.Join(tags, ", ") + ")"
		}
		experts = append(experts, name)
	}
	if len(experts) > 0 {
		fmt.Fprintf(b, "- Experts: %s\n", strings.Join(experts, ", "))
	}
	fmt.Fprintf(b, "- Tokens: %s in %d calls\n", FormatTokens(c.Tokens), c.Calls)
	if c.Started > 0 && c.Updated > c.Started {
		fmt.Fprintf(b, "- Time: %s\n", docDuration(c.Updated-c.Started))
	}
	fmt.Fprintf(b, "- Ended: %s\n", c.State)
}

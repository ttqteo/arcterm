// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"slices"
	"strings"
)

// The JSON each prompt asks the model to end its reply with. parse.go reads exactly these shapes, and
// TestShapesParse feeds every one back through its parser, so the two cannot drift: change a shape here and the
// parser together.
const (
	round1Shape = `{
  "overview": "two or three sentences: your overall view of the feature",
  "proposals": [
    {
      "title": "a short title for the change you propose",
      "argument": "why, in a short paragraph",
      "evidence": [{"ref": "pkg/services/idle.go:42"}]
    }
  ]
}`

	round2Shape = `{
  "stances": [
    {
      "proposalid": "P2",
      "stance": "challenge",
      "reason": "one line",
      "evidence": [{"ref": "pkg/services/idle.go:42"}]
    }
  ],
  "revisions": [
    {"proposalid": "P1", "withdraw": false, "title": "its new title", "argument": "its new argument"}
  ],
  "answers": [
    {"replyid": "r3", "text": "your answer to the person"}
  ],
  "picks": ["P2", "P3", "P4"]
}`

	answersShape = `{
  "answers": [
    {
      "replyid": "r3",
      "text": "your answer to the person",
      "stance": "accept",
      "evidence": [{"ref": "pkg/services/idle.go:42"}]
    }
  ]
}`

	synthesisShape = `{
  "answer": "one sentence that answers the person's question directly",
  "text": "one paragraph for the person: where the panel landed, and who was missing",
  "directions": [
    {
      "rank": 1,
      "title": "a short title for the direction",
      "reasoning": "why it ranks here",
      "from": ["P2", "P3"],
      "stances": {"ux": "accept", "skeptic": "challenge"},
      "agreed": false
    }
  ],
  "outcomes": {"P1": "Direction 1", "P2": "Merged into direction 1", "P4": "Withdrawn in round 2"},
  "weak": [{"ref": "P3", "note": "\"about 3 s\" has no measurement"}]
}`
)

// synthesisShapeNoQuestion is synthesisShape for a council with no question: there is nothing to answer, so it asks
// for no answer.
var synthesisShapeNoQuestion = strings.Replace(synthesisShape,
	"  \"answer\": \"one sentence that answers the person's question directly\",\n", "", 1)

const (
	// evidenceRule is in every prompt: a claim without evidence is drawn weak.
	evidenceRule = "Evidence is a path:line in the project, or a region of an attached screenshot written " +
		"screenshot:<file>#<region>. Cite it for every claim: a claim that cites nothing is drawn weak, and the " +
		"coordinator marks it as such."

	stanceRule = `A stance is one of "accept", "challenge" or "oppose".`

	// titleRule is in every prompt that cites proposals by id: the person reads the prose fields, and the UI shows no
	// proposal id.
	titleRule = "Name a proposal by its title or by what it says, never by its id (\"P2\"), in every sentence the person " +
		"reads: a reason, an argument, an answer, a note, the reasoning behind a direction, the summary text. Ids go only " +
		"in the fields that hold ids."

	jsonRule = "End your reply with one JSON object in a ```json fence and nothing after it, in this shape:"
)

// speaker is how a prompt names whoever wrote a proposal or a reply.
func speaker(c *Council, id string) string {
	if id == YouId {
		return "the person"
	}
	for _, e := range c.Experts {
		if e.Id == id {
			return e.Name
		}
	}
	return id
}

// writePicks lists how many of the experts' picks each proposal got and who gave them. A council from before picks
// existed has none, and the prompt says so, so the coordinator ranks on the replies alone.
func writePicks(b *strings.Builder, c *Council) {
	b.WriteString("## Picks\n\n")
	if len(c.Picks) == 0 {
		b.WriteString("No expert gave picks (this council is from before picks existed): rank on the replies alone.\n\n")
		return
	}
	b.WriteString("In round 2 each expert named the proposals of the others most worth doing. Picks per proposal:\n\n")
	for _, p := range c.Proposals {
		var by []string
		for _, e := range c.Experts {
			if slices.Contains(c.Picks[e.Id], p.Id) {
				by = append(by, e.Name)
			}
		}
		line := fmt.Sprintf("- %s (%s): %d", p.Id, p.Title, len(by))
		if len(by) > 0 {
			line += " (" + strings.Join(by, ", ") + ")"
		}
		b.WriteString(line + "\n")
	}
	b.WriteString("\n")
}

func findProposal(c *Council, id string) *CouncilProposal {
	for i := range c.Proposals {
		if c.Proposals[i].Id == id {
			return &c.Proposals[i]
		}
	}
	return nil
}

func findReply(c *Council, id string) *CouncilReply {
	for i := range c.Replies {
		if c.Replies[i].Id == id {
			return &c.Replies[i]
		}
	}
	return nil
}

func coordinatorExpert(c *Council) (CouncilExpert, bool) {
	for _, e := range c.Experts {
		if e.Coordinator {
			return e, true
		}
	}
	return CouncilExpert{}, false
}

// evidenceText lists evidence on one line; a weak item says so and why.
func evidenceText(ev []CouncilEvidence) string {
	if len(ev) == 0 {
		return "none"
	}
	parts := make([]string, 0, len(ev))
	for _, e := range ev {
		switch {
		case !e.Weak:
			parts = append(parts, e.Ref)
		case e.Ref != "" && e.Note != "":
			parts = append(parts, fmt.Sprintf("%s (weak: %s)", e.Ref, e.Note))
		case e.Ref != "":
			parts = append(parts, e.Ref+" (weak)")
		case e.Note != "":
			parts = append(parts, "weak: "+e.Note)
		default:
			parts = append(parts, "weak")
		}
	}
	return strings.Join(parts, "; ")
}

// writeContext is the lines every prompt opens with: who the model is (role ends in the preposition: "one expert
// on", "the coordinator of"), and what is under review.
func writeContext(b *strings.Builder, c *Council, e CouncilExpert, role string) {
	fmt.Fprintf(b, "You are %s, %s a council that reviews one feature of a project. %s\n\n", e.Name, role, strings.TrimSpace(e.Brief))
	fmt.Fprintf(b, "Feature: %s\n", c.Feature)
	if q := strings.TrimSpace(c.Question); q != "" {
		fmt.Fprintf(b, "Question for the council: %s\n", q)
	}
	fmt.Fprintf(b, "Project folder: %s\n", c.Project)
}

func writeProposal(b *strings.Builder, c *Council, p CouncilProposal, level string) {
	fmt.Fprintf(b, "%s %s · %s · %s\n%s\nEvidence: %s\n\n", level, p.Id, speaker(c, p.Author), p.Title, strings.TrimSpace(p.Argument), evidenceText(p.Evidence))
}

// Round1Prompt asks one expert for its proposals. The call runs in the project folder with Read, Grep and Glob.
func Round1Prompt(c *Council, e CouncilExpert) string {
	var b strings.Builder
	writeContext(&b, c, e, "one expert on")
	if len(c.Files) > 0 {
		b.WriteString("\nFiles to read first:\n")
		for _, f := range c.Files {
			fmt.Fprintf(&b, "- %s\n", f)
		}
	}
	if len(c.Screenshots) > 0 {
		b.WriteString("\nScreenshots (open each with Read):\n")
		for _, s := range c.Screenshots {
			fmt.Fprintf(&b, "- %s\n", s)
		}
	}
	b.WriteString("\nThis is round 1 of 3: proposals. You have Read, Grep and Glob in the project folder. " +
		"You review; you never edit anything.\n\n")
	b.WriteString("Review the feature from your angle only and propose the changes worth making. A few strong " +
		"proposals beat many weak ones, and none is a fair answer if you find nothing worth changing. " +
		"Each proposal has a short title, an argument, and the evidence it rests on.\n\n")
	b.WriteString(evidenceRule + "\n\n")
	b.WriteString(jsonRule + "\n```json\n" + round1Shape + "\n```\n")
	return b.String()
}

// unansweredFor are the person's replies still waiting on expert id.
func unansweredFor(c *Council, id string) []CouncilReply {
	var out []CouncilReply
	for _, r := range c.Replies {
		if r.Author == YouId && !r.Answered && slices.Contains(r.To, id) {
			out = append(out, r)
		}
	}
	return out
}

// askLine is one of the person's replies, with where it was posted.
func askLine(c *Council, r CouncilReply) string {
	where := "to the whole council"
	if p := findProposal(c, r.ProposalId); p != nil {
		where = fmt.Sprintf("on %s (%s)", p.Id, p.Title)
	}
	if parent := findReply(c, r.ParentId); parent != nil {
		where += fmt.Sprintf(", replying to %s's %s", speaker(c, parent.Author), parent.Id)
	}
	return fmt.Sprintf("- [%s] %s: %s\n", r.Id, where, strings.TrimSpace(r.Text))
}

// Round2Prompt asks one expert to cross-review. It is given the other experts' proposals the person did not cut, with no
// tools. Its own proposals sit apart, under their own heading, because each call is a fresh process that remembers
// nothing of round 1: the expert can revise or withdraw only what it is shown. The person's unanswered replies to
// it, and the question asked at the pause (a reply to the whole council), come last.
func Round2Prompt(c *Council, e CouncilExpert) string {
	var b strings.Builder
	writeContext(&b, c, e, "one expert on")
	b.WriteString("\nThis is round 2 of 3: cross-review. You have no tools in this round: work from the text below.\n\n")

	b.WriteString("## Proposals to review\n\n")
	review := 0
	for _, p := range c.Proposals {
		if p.Author != e.Id && !p.Cut {
			writeProposal(&b, c, p, "###")
			review++
		}
	}
	if review == 0 {
		b.WriteString("(none: no other expert has a proposal to review, so \"stances\" is empty)\n\n")
	}

	var own []CouncilProposal
	for _, p := range c.Proposals {
		if p.Author == e.Id && !p.Cut {
			own = append(own, p)
		}
	}
	if len(own) > 0 {
		b.WriteString("## Your own proposals\n\nThese are yours, from round 1. Do not review them.\n\n")
		for _, p := range own {
			writeProposal(&b, c, p, "###")
		}
	}

	if asks := unansweredFor(c, e.Id); len(asks) > 0 {
		b.WriteString("## What the person asks you\n\n")
		for _, r := range asks {
			b.WriteString(askLine(c, r))
		}
		b.WriteString("\n")
	}

	b.WriteString("## What to do\n\n")
	b.WriteString(`Give every proposal under "Proposals to review" one entry in "stances". ` + stanceRule +
		" Add one line of reason, and the evidence it rests on. An accept needs no reason: leave \"reason\" empty. " +
		"A challenge or an oppose always needs one. You cannot read the code in this round, so cite " +
		"only evidence that appears in the text above.\n\n")
	b.WriteString(`Then name your picks in "picks": the 3 proposals under "Proposals to review" most worth doing, best ` +
		"first, by proposal id. Never pick one of your own. Name fewer than 3 only when fewer are worth doing.\n\n")
	b.WriteString(`If reading the others changed your mind about one of your own proposals, add an entry to "revisions": ` +
		`set "withdraw" to true to drop it, or give its new title and argument. Leave "revisions" empty otherwise.` + "\n\n")
	b.WriteString(`Answer each question from the person with an entry in "answers", by its replyid. Leave "answers" empty ` +
		"when there are none.\n\n")
	b.WriteString(titleRule + "\n\n")
	b.WriteString(evidenceRule + "\n\n")
	b.WriteString(jsonRule + "\n```json\n" + round2Shape + "\n```\n")
	return b.String()
}

// writeThread writes the replies of one proposal (or, with an empty id, the ones to the whole council), each
// indented under the reply it answers.
func writeThread(b *strings.Builder, c *Council, proposalId string) {
	for _, r := range c.Replies {
		if r.ProposalId != proposalId {
			continue
		}
		fmt.Fprintf(b, "%s- [%s] %s", strings.Repeat("  ", len(ancestorsOf(c, r))), r.Id, speaker(c, r.Author))
		var tags []string
		if r.Stance != "" {
			tags = append(tags, string(r.Stance))
		}
		if r.Revised {
			tags = append(tags, "revised its proposal")
		}
		if len(tags) > 0 {
			fmt.Fprintf(b, " (%s)", strings.Join(tags, ", "))
		}
		if r.ParentId != "" {
			fmt.Fprintf(b, " replying to %s", r.ParentId)
		}
		fmt.Fprintf(b, ": %s", strings.TrimSpace(r.Text))
		if len(r.Evidence) > 0 {
			fmt.Fprintf(b, " Evidence: %s.", evidenceText(r.Evidence))
		}
		b.WriteString("\n")
	}
}

// SynthesisPrompt asks the coordinator for round 3: every proposal and everything said about it, the person's
// replies included, with no tools. An expert whose call failed is named as missing.
func SynthesisPrompt(c *Council) string {
	coord, ok := coordinatorExpert(c)
	if !ok {
		coord = CouncilExpert{Name: "the coordinator", Coordinator: true}
	}
	var b strings.Builder
	writeContext(&b, c, coord, "the coordinator of")
	b.WriteString("\nThis is round 3 of 3: synthesis. You have no tools: work from the text below.\n\n")

	b.WriteString("## Experts\n\nUse the id as the key in \"stances\".\n\n")
	for _, e := range c.Experts {
		if !e.Coordinator {
			fmt.Fprintf(&b, "- %s (%s)\n", e.Id, e.Name)
		}
	}
	b.WriteString("\n")

	var missing []string
	for _, e := range c.Experts {
		if f, ok := c.Failed[e.Id]; ok && !e.Coordinator {
			missing = append(missing, fmt.Sprintf("%s (its round %d call failed)", e.Name, f.Round))
		}
	}
	if len(missing) > 0 {
		b.WriteString("## Missing\n\nThese experts are missing: " + strings.Join(missing, ", ") + ". Their view is absent from " +
			"everything below. Say so in \"text\", and do not guess their stance.\n\n")
	}

	writePicks(&b, c)

	b.WriteString("## Proposals and what was said about them\n\n")
	if len(c.Proposals) == 0 {
		b.WriteString("(no expert made a proposal)\n\n")
	}
	for _, p := range c.Proposals {
		writeProposal(&b, c, p, "###")
		switch {
		case p.Cut:
			b.WriteString("The person cut this proposal at the pause: it was not reviewed.\n\n")
		case p.Withdrawn:
			b.WriteString("Its author withdrew it in round 2.\n\n")
		}
		var thread strings.Builder
		writeThread(&thread, c, p.Id)
		if thread.Len() > 0 {
			b.WriteString(thread.String() + "\n")
		}
	}
	var whole strings.Builder
	writeThread(&whole, c, "")
	if whole.Len() > 0 {
		b.WriteString("### To the whole council\n\n" + whole.String() + "\n")
	}

	b.WriteString("## What to do\n\n")
	b.WriteString("1. Merge proposals that say the same thing into one direction, and list their ids in \"from\".\n")
	b.WriteString("2. Rank the directions, best first, from \"rank\" 1. Put the directions no expert challenges or opposes " +
		"first; rank the rest by their picks (add up the picks of the proposals a direction merges), most picks first.\n")
	b.WriteString("3. In \"stances\", give each expert's stance towards the direction, keyed by the expert's id, from the replies " +
		"above. " + stanceRule + " Leave out the authors of the proposals the direction merges. \"agreed\" is true when no " +
		"expert challenges or opposes it.\n")
	b.WriteString("4. In \"outcomes\", give every proposal its fate: \"Direction N\", \"Merged into direction N\", " +
		"\"Withdrawn in round 2\" or \"Cut at the pause\".\n")
	b.WriteString("5. In \"weak\", mark any claim that cites no evidence, or whose evidence does not show what it says. " +
		"\"ref\" is a proposal id, a reply id or an evidence ref; \"note\" says what is missing.\n")
	b.WriteString("6. Treat the person's replies as the person's own view and weigh them.\n")
	shape := synthesisShapeNoQuestion
	if strings.TrimSpace(c.Question) != "" {
		b.WriteString("7. In \"answer\", write one sentence that answers the question for the council directly: the " +
			"answer itself, not a description of the discussion.\n")
		shape = synthesisShape
	}
	b.WriteString("\n" + titleRule + "\n\n")
	b.WriteString(evidenceRule + "\n\n")
	b.WriteString(jsonRule + "\n```json\n" + shape + "\n```\n")
	return b.String()
}

// ancestorsOf are the replies above r, the one r answers first. A parent loop in a hand-edited file ends the walk.
func ancestorsOf(c *Council, r CouncilReply) []CouncilReply {
	var up []CouncilReply
	for p := findReply(c, r.ParentId); p != nil && len(up) <= len(c.Replies); p = findReply(c, p.ParentId) {
		up = append(up, *p)
	}
	return up
}

// branchOf is a reply's ancestors, the one nearest the proposal first.
func branchOf(c *Council, r CouncilReply) []CouncilReply {
	up := ancestorsOf(c, r)
	slices.Reverse(up)
	return up
}

// AnswersPrompt asks one expert to answer the person's replies, the pass after the synthesis and a follow-up. For
// each reply it carries only the branch the reply sits in (its proposal and the replies above it), then the
// expert's own proposals. The expert has tools when any of the replies asked for them (Let them read code).
func AnswersPrompt(c *Council, e CouncilExpert, replies []CouncilReply) string {
	tools := false
	for _, r := range replies {
		tools = tools || r.Tools
	}
	var b strings.Builder
	writeContext(&b, c, e, "one expert on")
	b.WriteString("\nThe council has already met. The person replied in the discussion, and you answer from your own " +
		"angle, as yourself.\n")
	if tools {
		b.WriteString("You have Read, Grep and Glob in the project folder this time: read the code when an answer needs it. " +
			"You review; you never edit anything.\n\n")
	} else {
		b.WriteString("You have no tools this time: answer from the text below.\n\n")
	}

	var own []CouncilProposal
	for _, p := range c.Proposals {
		if p.Author == e.Id && !p.Cut {
			own = append(own, p)
		}
	}
	if len(own) > 0 {
		b.WriteString("## Your own proposals\n\n")
		for _, p := range own {
			writeProposal(&b, c, p, "###")
			if p.Withdrawn {
				b.WriteString("You withdrew this one in round 2.\n\n")
			}
		}
	}

	for _, r := range replies {
		fmt.Fprintf(&b, "## Reply %s\n\n", r.Id)
		if p := findProposal(c, r.ProposalId); p != nil {
			b.WriteString("The branch it sits in:\n\n")
			writeProposal(&b, c, *p, "###")
		} else {
			b.WriteString("It is addressed to the whole council, not to one proposal.\n\n")
		}
		if above := branchOf(c, r); len(above) > 0 {
			b.WriteString("The replies above it, the first one first:\n\n")
			for _, a := range above {
				fmt.Fprintf(&b, "- [%s] %s", a.Id, speaker(c, a.Author))
				if a.Stance != "" {
					fmt.Fprintf(&b, " (%s)", a.Stance)
				}
				fmt.Fprintf(&b, ": %s\n", strings.TrimSpace(a.Text))
			}
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "The person's reply [%s]: %s\n\n", r.Id, strings.TrimSpace(r.Text))
	}

	b.WriteString("## What to do\n\n")
	b.WriteString("Answer every reply above with one entry in \"answers\", by its replyid. If an answer changes your " +
		"view of the proposal it sits on, add a \"stance\". " + stanceRule + "\n\n")
	b.WriteString(titleRule + "\n\n")
	b.WriteString(evidenceRule + "\n\n")
	b.WriteString(jsonRule + "\n```json\n" + answersShape + "\n```\n")
	return b.String()
}

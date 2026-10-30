// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"slices"
	"strings"
)

// HarnessVersion names the council's prompts, role briefs and default models as they stand. Every council records it
// when its run begins (Council.Harness), and the benchmark groups its results by it, so a score is never read as the
// score of a harness it did not run. Bump it, as <YYYY-MM-DD>.<n>, in the same commit as any change to a prompt, a role
// brief or a default model.
const HarnessVersion = "2026-10-29.1"

// The JSON each prompt asks the model to end its reply with. parse.go reads exactly these shapes, and
// TestShapesParse feeds every one back through its parser, so the two cannot drift: change a shape here and the
// parser together.
const (
	round1Shape = `{
  "overview": "two or three sentences: your overall view of the feature",
  "proposals": [
    {
      "title": "a short title for the change you propose",
      "argument": "why, in at most four sentences",
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
    {"proposalid": "P1", "withdraw": false, "title": "its new title", "argument": "its new argument", "change": "one line: what you changed and why"}
  ],
  "answers": [
    {"replyid": "r3", "text": "your answer to the person, in at most three sentences"}
  ],
  "picks": ["P2", "P3", "P4"]
}`

	answersShape = `{
  "answers": [
    {
      "replyid": "r3",
      "text": "your answer to the person, in at most three sentences",
      "stance": "accept",
      "evidence": [{"ref": "pkg/services/idle.go:42"}]
    }
  ]
}`

	synthesisShape = `{
  "answer": "one short sentence that answers the person's question directly",
  "text": "at most three short sentences for the person: where the panel landed, and who was missing",
  "directions": [
    {
      "rank": 1,
      "title": "a short title for the direction",
      "reasoning": "why it ranks here",
      "firststep": "the one thing to do first",
      "from": ["P2", "P3"],
      "stances": {"ux": "accept", "skeptic": "challenge"},
      "agreed": false
    }
  ],
  "kept": [
    {"title": "a short title for a direction also raised", "reasoning": "one line: what it asks for", "from": ["P5"]}
  ],
  "outcomes": {"P1": "Direction 1", "P2": "Merged into direction 1", "P4": "Withdrawn in round 2", "P5": "Also raised"},
  "weak": [{"ref": "P3", "note": "\"about 3 s\" has no measurement"}]
}`
)

// answerLine is the line of both synthesis shapes that holds the answer to the person's question.
const answerLine = "  \"answer\": \"one short sentence that answers the person's question directly\",\n"

// synthesisShapeNoQuestion is synthesisShape for a council with no question: there is nothing to answer, so it asks
// for no answer.
var synthesisShapeNoQuestion = strings.Replace(synthesisShape, answerLine, "", 1)

// The Brainstorm shapes. They keep the keys the parsers read ("proposals" holds the ideas, "directions" the ideas worth
// trying) and add the Brainstorm ones: a wild flag, a build flag, a first step and the ideas kept aside.
const (
	brainstormRound1Shape = `{
  "overview": "two or three sentences: how you see the problem or goal",
  "proposals": [
    {
      "title": "a short title for the idea",
      "argument": "what the idea is and why it could work, in at most four sentences",
      "wild": false
    }
  ]
}`

	brainstormRound2Shape = `{
  "stances": [
    {
      "proposalid": "P2",
      "stance": "accept",
      "builds": true,
      "reason": "what you add to the idea"
    },
    {
      "proposalid": "P3",
      "stance": "accept",
      "reason": ""
    }
  ],
  "revisions": [
    {"proposalid": "P1", "withdraw": false, "title": "its new title", "argument": "its new argument", "change": "one line: what you changed and why"}
  ],
  "answers": [
    {"replyid": "r3", "text": "your answer to the person, in at most three sentences"}
  ],
  "picks": ["P2", "P3", "P4"]
}`

	brainstormSynthesisShape = `{
  "answer": "one short sentence that answers the person's question directly",
  "text": "at most three short sentences for the person: where the panel landed, and who was missing",
  "directions": [
    {
      "rank": 1,
      "title": "a short title for the idea worth trying",
      "reasoning": "why it is worth trying",
      "firststep": "the one thing to do first",
      "from": ["P2", "P3"],
      "stances": {"designer": "accept", "contrarian": "challenge"},
      "agreed": false
    }
  ],
  "kept": [
    {"title": "a short title for a wild idea kept aside", "reasoning": "why it is worth remembering", "from": ["P5"]}
  ],
  "outcomes": {"P1": "Direction 1", "P2": "Merged into direction 1", "P5": "Kept aside", "P6": "Not picked"}
}`
)

// brainstormSynthesisShapeNoQuestion is brainstormSynthesisShape for a council with no question.
var brainstormSynthesisShapeNoQuestion = strings.Replace(brainstormSynthesisShape, answerLine, "", 1)

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

	// summaryRule is in both synthesis prompts with a question: "answer" and "text" sit above the directions and are
	// read first. summaryRuleNoQuestion is the same for "text" alone.
	summaryRule = `The person reads "answer" and "text" first, above the directions, so keep them short: "answer" is one ` +
		`plain sentence of at most 25 words, "text" at most three short sentences (about 60 words) on where the panel ` +
		`landed, naming any missing expert in one clause. Do not retell the directions in "text", and put no path:line ` +
		`or other evidence ref in either: the evidence stays with the directions. Write "answer" and "text" in the ` +
		`language the person's question is written in; every other field stays in English.`
	summaryRuleNoQuestion = `The person reads "text" first, above the directions, so keep it short: at most three short ` +
		`sentences (about 60 words) on where the panel landed, naming any missing expert in one clause. Do not retell ` +
		`the directions, and put no path:line or other evidence ref in it: the evidence stays with the directions. ` +
		`Write "text" in the language the feature is written in; every other field stays in English.`

	// changeRule is in both round 2 prompts: a revision's reply shows its one-line change, and the new argument only
	// on the proposal itself.
	changeRule = `With a new title or argument, say in "change" what you changed and why, in one line: the person reads ` +
		`that line under the proposal, and the new argument only in the proposal itself.`

	jsonRule = "End your reply with one JSON object in a ```json fence and nothing after it, in this shape:"

	// wildRule is in the Brainstorm's round 1: an idea can be offered wild, and is then kept aside, not ranked.
	wildRule = `Set "wild" to true on an idea that is far-fetched, risky or off to the side but might open a door. Wild ideas ` +
		"are not ranked with the others: the coordinator keeps them aside, so offer one whenever you have one."

	// doubtRule is in the Brainstorm's round 2: judging waits until an idea has earned a doubt.
	doubtRule = `Voice a doubt (a "stance" of "challenge", or "oppose" when you are against the idea, with one line of ` +
		`reason) only on an idea you build on yourself or put in your picks. A build can carry a doubt: set "builds" to ` +
		`true and "stance" to "challenge". On every other idea, build on it or accept it; never challenge or oppose it.`
)

// isBrainstorm says whether c is a Brainstorm; every other council, a council with no mode too, is a Review.
func isBrainstorm(c *Council) bool { return ModeOf(c) == ModeBrainstorm }

// angleOf is a role's brief without the evidence rule the library ends it with: a Brainstorm asks for no evidence.
func angleOf(brief string) string {
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(brief), briefEvidenceRule))
}

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

// sentProposals are the proposals that are out in the room: the ones a held or dropped draft is not. Only these reach a
// prompt, the picks, the synthesis and the saved document.
func sentProposals(c *Council) []CouncilProposal {
	out := make([]CouncilProposal, 0, len(c.Proposals))
	for _, p := range c.Proposals {
		if Sent(p.Draft) {
			out = append(out, p)
		}
	}
	return out
}

// writePicks lists how many of the experts' picks each proposal got and who gave them. A council from before picks
// existed has none, and the prompt says so, so the coordinator ranks on the replies alone.
func writePicks(b *strings.Builder, c *Council) {
	b.WriteString("## Picks\n\n")
	if len(c.Picks) == 0 {
		if HasAgents(c) {
			b.WriteString("No seat gave picks: rank on the ideas and the replies alone.\n\n")
		} else {
			b.WriteString("No expert gave picks (this council is from before picks existed): rank on the replies alone.\n\n")
		}
		return
	}
	if isBrainstorm(c) {
		b.WriteString("In round 2 each expert named the ideas of the others most worth trying. Picks per idea:\n\n")
	} else {
		b.WriteString("In round 2 each expert named the proposals of the others most worth doing. Picks per proposal:\n\n")
	}
	for _, p := range sentProposals(c) {
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

// seatOf is the seat with expert id id.
func seatOf(c *Council, id string) (CouncilExpert, bool) {
	for _, e := range c.Experts {
		if e.Id == id {
			return e, true
		}
	}
	return CouncilExpert{}, false
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
	if isBrainstorm(c) {
		fmt.Fprintf(b, "You are %s, %s a council that brainstorms ideas for one problem or goal of a project. %s\n\n", e.Name, role, angleOf(e.Brief))
		fmt.Fprintf(b, "Problem or goal: %s\n", c.Feature)
	} else {
		fmt.Fprintf(b, "You are %s, %s a council that reviews one feature of a project. %s\n\n", e.Name, role, strings.TrimSpace(e.Brief))
		fmt.Fprintf(b, "Feature: %s\n", c.Feature)
	}
	if q := strings.TrimSpace(c.Question); q != "" {
		fmt.Fprintf(b, "Question for the council: %s\n", q)
	}
	fmt.Fprintf(b, "Project folder: %s\n", c.Project)
}

// writeProposal writes one proposal under a heading of the given level. A Brainstorm's wild idea says so, and its
// evidence line is left out: a Brainstorm asks for none.
func writeProposal(b *strings.Builder, c *Council, p CouncilProposal, level string) {
	title := p.Title
	if p.Wild && isBrainstorm(c) {
		title += " (wild idea)"
	}
	fmt.Fprintf(b, "%s %s · %s · %s\n%s\n", level, p.Id, speaker(c, p.Author), title, strings.TrimSpace(p.Argument))
	if !isBrainstorm(c) || len(p.Evidence) > 0 {
		fmt.Fprintf(b, "Evidence: %s\n", evidenceText(p.Evidence))
	}
	b.WriteString("\n")
}

// writeFiles lists the files and screenshots the person put in front of the panel.
func writeFiles(b *strings.Builder, c *Council) {
	if len(c.Files) > 0 {
		b.WriteString("\nFiles to read first:\n")
		for _, f := range c.Files {
			fmt.Fprintf(b, "- %s\n", f)
		}
	}
	if len(c.Screenshots) > 0 {
		b.WriteString("\nScreenshots (open each with Read):\n")
		for _, s := range c.Screenshots {
			fmt.Fprintf(b, "- %s\n", s)
		}
	}
}

// round1Task is what the ideas round asks, and the shape of the answer: the end of the round 1 prompt, and of an agent
// seat's first turn.
func round1Task(c *Council) string {
	var b strings.Builder
	if isBrainstorm(c) {
		b.WriteString("Come up with ideas for the problem or goal from your angle only. Do not judge any idea, yours or " +
			"anyone's: doubts wait for round 2. A few strong, different ideas beat many that are alike. Each idea is one " +
			"entry in \"proposals\", with a short title and an argument: what the idea is, and why it could work. An idea " +
			"may rest on a guess, so it needs no evidence; read the code to ground an idea, not to audit it.\n\n")
		b.WriteString(wildRule + "\n\n")
		b.WriteString(jsonRule + "\n```json\n" + brainstormRound1Shape + "\n```\n")
		return b.String()
	}
	b.WriteString("Review the feature from your angle only and propose the changes worth making. A few strong " +
		"proposals beat many weak ones, and none is a fair answer if you find nothing worth changing. " +
		"Each proposal has a short title, an argument, and the evidence it rests on.\n\n")
	b.WriteString(evidenceRule + "\n\n")
	b.WriteString(jsonRule + "\n```json\n" + round1Shape + "\n```\n")
	return b.String()
}

// Round1Prompt asks one expert for its proposals. The call runs in the project folder with Read, Grep and Glob.
func Round1Prompt(c *Council, e CouncilExpert) string {
	var b strings.Builder
	writeContext(&b, c, e, "one expert on")
	writeFiles(&b, c)
	if isBrainstorm(c) {
		fmt.Fprintf(&b, "\nThis is round 1 of %d: ideas. You have Read, Grep and Glob in the project folder. "+
			"You brainstorm; you never edit anything.\n\n", SynthesisRound(c))
	} else {
		fmt.Fprintf(&b, "\nThis is round 1 of %d: proposals. You have Read, Grep and Glob in the project folder. "+
			"You review; you never edit anything.\n\n", SynthesisRound(c))
	}
	b.WriteString(round1Task(c))
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
func Round2Prompt(c *Council, e CouncilExpert) string { return round2PromptFor(c, e, 2) }

// laterPassNote opens the task of every reply pass after the first, a council with agents and three rounds: the stances
// of the pass before stand, and what was said since is answered.
const laterPassNote = `Your stances from the earlier rounds stand. Give an entry in "stances" again only on a proposal where what was ` +
	`said since gives you reason to speak: it needs a reason, and it answers the latest reply to that proposal. Leave ` +
	`"stances" empty otherwise.`

// round2Task is what a reply pass asks, and the shape of the answer: the end of the round 2 prompt, and of an agent
// seat's turn in a reply pass. A pass after the first opens with laterPassNote.
func round2Task(c *Council, round int) string {
	var b strings.Builder
	if round > 2 {
		b.WriteString(laterPassNote + "\n\n")
	}
	if isBrainstorm(c) {
		b.WriteString(`The proposals under "Proposals to review" are the others' ideas. Your default is to build on them, not ` +
			"to judge them.\n\n")
		b.WriteString(`Give every one of them one entry in "stances". ` + stanceRule + "\n")
		b.WriteString(`- To build on an idea, add to it: a variation, a first step, a cheaper or stranger version, a way to ` +
			`combine it with another. Write what you add in "reason", set "builds" to true and "stance" to "accept".` + "\n")
		b.WriteString(`- To agree without adding anything, give "stance" "accept", leave "reason" empty and leave "builds" out.` + "\n")
		b.WriteString("- " + doubtRule + "\n\n")
		b.WriteString(`Then name your picks in "picks": the 3 proposals under "Proposals to review" most worth trying, best ` +
			"first, by proposal id. Never pick one of your own. Name fewer than 3 only when fewer are worth trying.\n\n")
		b.WriteString(`If reading the others changed your mind about one of your own ideas, add an entry to "revisions": ` +
			`set "withdraw" to true to drop it, or give its new title and argument. ` + changeRule + ` Leave "revisions" ` +
			"empty otherwise.\n\n")
		b.WriteString(`Answer each question from the person with an entry in "answers", by its replyid. Leave "answers" empty ` +
			"when there are none.\n\n")
		b.WriteString(titleRule + "\n\n")
		b.WriteString(jsonRule + "\n```json\n" + brainstormRound2Shape + "\n```\n")
		return b.String()
	}
	b.WriteString(`Give every proposal under "Proposals to review" one entry in "stances". ` + stanceRule +
		" Add one line of reason, and the evidence it rests on. An accept needs no reason: leave \"reason\" empty. " +
		"A challenge or an oppose always needs one. You cannot read the code in this round, so cite " +
		"only evidence that appears in the text above.\n\n")
	b.WriteString(`Then name your picks in "picks": the 3 proposals under "Proposals to review" most worth doing, best ` +
		"first, by proposal id. Never pick one of your own. Name fewer than 3 only when fewer are worth doing.\n\n")
	b.WriteString(`If reading the others changed your mind about one of your own proposals, add an entry to "revisions": ` +
		`set "withdraw" to true to drop it, or give its new title and argument. ` + changeRule + ` Leave "revisions" ` +
		"empty otherwise.\n\n")
	b.WriteString(`Answer each question from the person with an entry in "answers", by its replyid. Leave "answers" empty ` +
		"when there are none.\n\n")
	b.WriteString(titleRule + "\n\n")
	b.WriteString(evidenceRule + "\n\n")
	b.WriteString(jsonRule + "\n```json\n" + round2Shape + "\n```\n")
	return b.String()
}

// round2PromptFor is the cross-review prompt of reply pass round (2, or 3 in a council with three rounds). A pass after
// the first shows what was said under each proposal, which the first pass has none of.
func round2PromptFor(c *Council, e CouncilExpert, round int) string {
	var b strings.Builder
	writeContext(&b, c, e, "one expert on")
	if isBrainstorm(c) {
		fmt.Fprintf(&b, "\nThis is round %d of %d: build on each other. You have no tools in this round: work from the text below.\n\n", round, SynthesisRound(c))
	} else {
		fmt.Fprintf(&b, "\nThis is round %d of %d: cross-review. You have no tools in this round: work from the text below.\n\n", round, SynthesisRound(c))
	}
	writeWithThread := func(p CouncilProposal) {
		writeProposal(&b, c, p, "###")
		if round > 2 {
			var thread strings.Builder
			writeThread(&thread, c, p.Id)
			if thread.Len() > 0 {
				b.WriteString("What was said about it:\n" + thread.String() + "\n")
			}
		}
	}

	b.WriteString("## Proposals to review\n\n")
	review := 0
	for _, p := range sentProposals(c) {
		if p.Author != e.Id && !p.Cut {
			writeWithThread(p)
			review++
		}
	}
	if review == 0 {
		b.WriteString("(none: no other expert has a proposal to review, so \"stances\" is empty)\n\n")
	}

	var own []CouncilProposal
	for _, p := range sentProposals(c) {
		if p.Author == e.Id && !p.Cut {
			own = append(own, p)
		}
	}
	if len(own) > 0 {
		b.WriteString("## Your own proposals\n\nThese are yours, from round 1. Do not review them.\n\n")
		for _, p := range own {
			writeWithThread(p)
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
	b.WriteString(round2Task(c, round))
	return b.String()
}

// writeThread writes the replies of one proposal (or, with an empty id, the ones to the whole council), each
// indented under the reply it answers. A held or dropped reply is not written: it is not out in the room.
func writeThread(b *strings.Builder, c *Council, proposalId string) {
	for _, r := range c.Replies {
		if r.ProposalId != proposalId || !Sent(r.Draft) {
			continue
		}
		fmt.Fprintf(b, "%s- [%s] %s", strings.Repeat("  ", len(ancestorsOf(c, r))), r.Id, speaker(c, r.Author))
		var tags []string
		if r.Stance != "" {
			tags = append(tags, string(r.Stance))
		}
		if r.Builds && isBrainstorm(c) {
			tags = append(tags, "builds on it")
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
	last := SynthesisRound(c)
	if isBrainstorm(c) {
		fmt.Fprintf(&b, "\nThis is round %d of %d: pick the best. You have no tools: work from the text below.\n\n", last, last)
	} else {
		fmt.Fprintf(&b, "\nThis is round %d of %d: synthesis. You have no tools: work from the text below.\n\n", last, last)
	}

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
	for _, s := range c.Skips {
		if e, ok := seatOf(c, s.Expert); ok && !e.Coordinator {
			missing = append(missing, fmt.Sprintf("%s (it skipped round %d: %s)", e.Name, s.Round, s.Reason))
		}
	}
	if len(missing) > 0 {
		b.WriteString("## Missing\n\nThese experts are missing: " + strings.Join(missing, ", ") + ". Their view is absent from " +
			"everything below. Say so in \"text\", and do not guess their stance.\n\n")
	}

	writePicks(&b, c)

	b.WriteString("## Proposals and what was said about them\n\n")
	sent := sentProposals(c)
	if len(sent) == 0 {
		b.WriteString("(no expert made a proposal)\n\n")
	}
	for _, p := range sent {
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
	if isBrainstorm(c) {
		return writeBrainstormSynthesisTask(&b, c)
	}
	b.WriteString("1. Merge proposals that say the same thing into one direction, and list their ids in \"from\".\n")
	b.WriteString("2. Rank the directions, best first, from \"rank\" 1. Put the directions no expert challenges or opposes " +
		"first; rank the rest by their picks (add up the picks of the proposals a direction merges), most picks first.\n")
	fmt.Fprintf(&b, "3. In \"directions\", keep at most %d: the best of that ranking, read in full. A direction that only "+
		"changes wording, names or formatting takes one of the %d places only when no direction of another kind is left.\n",
		maxDirections, maxDirections)
	b.WriteString("4. For each of them, \"reasoning\" says why it ranks here, and \"firststep\" is its first step: the one " +
		"thing to do first, a text edit to make now or the first piece of new work, small enough to start this week.\n")
	b.WriteString("5. In \"kept\", list every other direction, best first, each with a title, one line on what it asks for, " +
		"and its ids in \"from\". The person reads them as Also raised. Leave \"kept\" empty when there are none.\n")
	b.WriteString("6. In \"stances\", give each expert's stance towards the direction, keyed by the expert's id, from the replies " +
		"above. " + stanceRule + " Leave out the authors of the proposals the direction merges. \"agreed\" is true when no " +
		"expert challenges or opposes it.\n")
	b.WriteString("7. In \"outcomes\", give every proposal its fate: \"Direction N\", \"Merged into direction N\", " +
		"\"Also raised\", \"Withdrawn in round 2\" or \"Cut at the pause\".\n")
	b.WriteString("8. In \"weak\", mark any claim that cites no evidence, or whose evidence does not show what it says. " +
		"\"ref\" is a proposal id, a reply id or an evidence ref; \"note\" says what is missing.\n")
	b.WriteString("9. Treat the person's replies as the person's own view and weigh them.\n")
	shape, summary := synthesisShapeNoQuestion, summaryRuleNoQuestion
	if strings.TrimSpace(c.Question) != "" {
		b.WriteString("10. In \"answer\", write one sentence that answers the question for the council directly: the " +
			"answer itself, not a description of the discussion.\n")
		shape, summary = synthesisShape, summaryRule
	}
	b.WriteString("\n" + titleRule + "\n\n")
	b.WriteString(summary + "\n\n")
	b.WriteString(evidenceRule + "\n\n")
	b.WriteString(jsonRule + "\n```json\n" + shape + "\n```\n")
	return b.String()
}

// writeBrainstormSynthesisTask ends a Brainstorm's synthesis prompt: at most 3 ideas worth trying, each with why and a
// first step, the wild ideas kept aside, and the fate of every idea. It returns the whole prompt.
func writeBrainstormSynthesisTask(b *strings.Builder, c *Council) string {
	b.WriteString("1. Merge ideas that say the same thing into one, and list their ids in \"from\".\n")
	fmt.Fprintf(b, "2. In \"directions\", choose at most %d ideas worth trying, best first, from \"rank\" 1. Rank by picks (add up the "+
		"picks of the ideas an idea merges), then by how many experts built on it. Leave out an idea nobody picked or built on. "+
		"A wild idea never takes one of the %d places.\n", maxDirections, maxDirections)
	b.WriteString("3. For each of them, \"reasoning\" says why it is worth trying, and \"firststep\" is its first step: the one " +
		"thing to do first, small enough to start this week.\n")
	b.WriteString("4. In \"stances\", give each expert's stance towards the idea, keyed by the expert's id, from the replies " +
		"above. " + stanceRule + " Leave out the authors of the ideas it merges. \"agreed\" is true when no expert has doubts " +
		"about it or is against it.\n")
	b.WriteString("5. In \"kept\", list the wild ideas that were not chosen (the ones marked wild above), each with a title, a " +
		"line on why it is worth remembering, and its ids in \"from\". Leave \"kept\" empty when there are none.\n")
	b.WriteString("6. In \"outcomes\", give every idea its fate: \"Direction N\", \"Merged into direction N\", \"Kept aside\", " +
		"\"Not picked\", \"Withdrawn in round 2\" or \"Cut at the pause\".\n")
	b.WriteString("7. Treat the person's replies as the person's own view and weigh them.\n")
	shape, summary := brainstormSynthesisShapeNoQuestion, summaryRuleNoQuestion
	if strings.TrimSpace(c.Question) != "" {
		b.WriteString("8. In \"answer\", write one sentence that answers the question for the council directly: the " +
			"answer itself, not a description of the discussion.\n")
		shape, summary = brainstormSynthesisShape, summaryRule
	}
	b.WriteString("\n" + titleRule + "\n\n")
	b.WriteString(summary + "\n\n")
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
	for _, p := range sentProposals(c) {
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
	b.WriteString(answersTask(c))
	return b.String()
}

// answersTask is what the pass after the synthesis asks, and the shape of the answer: the end of the answers prompt, and
// of an agent seat's turn in it.
func answersTask(c *Council) string {
	var b strings.Builder
	b.WriteString("Answer every reply above with one entry in \"answers\", by its replyid. If an answer changes your " +
		"view of the proposal it sits on, add a \"stance\". " + stanceRule + "\n\n")
	b.WriteString(titleRule + "\n\n")
	if !isBrainstorm(c) { // a Brainstorm asks for no evidence
		b.WriteString(evidenceRule + "\n\n")
	}
	b.WriteString(jsonRule + "\n```json\n" + answersShape + "\n```\n")
	return b.String()
}

// ---- agent seats ----

// lastTurn is the latest round before round in which seat e spoke: it posted an idea (round 1) or a reply there, a held or
// dropped one too. 0 means it has not spoken yet, so its prompt brings it into the council whole. A seat that spoke in no
// round of its turn reads as not having had it, and is sent a little twice, never too little.
func lastTurn(c *Council, e CouncilExpert, round int) int {
	last := 0
	if round > 1 && slices.ContainsFunc(c.Proposals, func(p CouncilProposal) bool { return p.Author == e.Id }) {
		last = 1
	}
	for _, r := range c.Replies {
		if r.Author == e.Id && r.Round < round {
			last = max(last, r.Round)
		}
	}
	return last
}

// agentNews are what the seat has not been shown: the others' sent ideas when it has seen none yet, and the sent replies
// of the rounds since its last turn, never one of this round (the seats answer a round at once), never its own, and never
// the person's (those come as questions, in agentAsks). A held or dropped item is in neither.
func agentNews(c *Council, e CouncilExpert, round int) (ideas []CouncilProposal, said []CouncilReply) {
	from := max(lastTurn(c, e, round), 1)
	if from == 1 {
		for _, p := range sentProposals(c) {
			if p.Author != e.Id && !p.Cut {
				ideas = append(ideas, p)
			}
		}
	}
	for _, r := range c.Replies {
		if r.Author != e.Id && r.Author != YouId && Sent(r.Draft) && r.Round >= from && r.Round < round {
			said = append(said, r)
		}
	}
	return ideas, said
}

// agentAsks are the person's questions to the seat that it has not answered.
func agentAsks(c *Council, e CouncilExpert, round int) []CouncilReply {
	return owed(c, e, round >= SynthesisRound(c))
}

// seatHasNews says whether a turn of the seat in reply pass round has anything to answer: a seat with nothing new and no
// question is not asked.
func seatHasNews(c *Council, e CouncilExpert, round int) bool {
	ideas, said := agentNews(c, e, round)
	return len(ideas)+len(said)+len(agentAsks(c, e, round)) > 0
}

// agentPrompt is the turn the seat gets in round: the first prompt until it has spoken, the later one after.
func agentPrompt(c *Council, e CouncilExpert, round int) string {
	if lastTurn(c, e, round) == 0 {
		return AgentFirstPrompt(c, e, round)
	}
	return AgentLaterPrompt(c, e, round)
}

// AgentFirstPrompt brings a live agent into the council: the question, the other seats (each marked agent or expert),
// and the turn of the round, with the answer shape the experts use for it. A seat that joins after round 1 gets
// everything sent so far in it, since it has seen none of it.
func AgentFirstPrompt(c *Council, e CouncilExpert, round int) string {
	var b strings.Builder
	if isBrainstorm(c) {
		fmt.Fprintf(&b, "You are %s, a seat in a council that brainstorms ideas for one problem or goal of a project. ", e.Name)
	} else {
		fmt.Fprintf(&b, "You are %s, a seat in a council that reviews one feature of a project. ", e.Name)
	}
	b.WriteString("You are a live agent: answer from what you already know and have done in this session, in your own voice.\n")
	if angle := strings.TrimSpace(e.Brief); angle != "" {
		b.WriteString(angle + "\n")
	}
	b.WriteString("\n")
	if isBrainstorm(c) {
		fmt.Fprintf(&b, "Problem or goal: %s\n", c.Feature)
	} else {
		fmt.Fprintf(&b, "Feature: %s\n", c.Feature)
	}
	if q := strings.TrimSpace(c.Question); q != "" {
		fmt.Fprintf(&b, "Question for the council: %s\n", q)
	}
	fmt.Fprintf(&b, "Project folder: %s\n", c.Project)
	writeFiles(&b, c)

	b.WriteString("\n## Who sits in the council\n\n")
	for _, s := range c.Experts {
		switch {
		case s.Id == e.Id:
		case s.Coordinator:
			fmt.Fprintf(&b, "- %s · expert · the coordinator, who writes the summary from what is sent\n", s.Name)
		case IsAgent(s):
			fmt.Fprintf(&b, "- %s · agent · a live session like yours\n", s.Name)
		default:
			fmt.Fprintf(&b, "- %s · expert · a fresh model call that reviews from its own angle\n", s.Name)
		}
	}
	b.WriteString("\nThe person is in the room too. Nothing you say reaches the others until the person sends it, and they may " +
		"edit or drop it first. The seats answer each round at once, so what the others say in a round reaches you in the next.\n\n")
	writeAgentTurn(&b, c, e, round, true)
	return b.String()
}

// AgentLaterPrompt is the turn of a seat that has spoken before: only what was sent since its last turn (the previous
// rounds' answers and the person's), never an answer of this round, and the shape of the answer.
func AgentLaterPrompt(c *Council, e CouncilExpert, round int) string {
	var b strings.Builder
	if round >= SynthesisRound(c) {
		b.WriteString("The council has already met. The person replied in the discussion, and you answer from your own angle, " +
			"as yourself.\n\n")
	} else {
		fmt.Fprintf(&b, "You are back in the council as %s. Below is what was sent since your last turn; the others answer a "+
			"round at the same time as you, so none of this round's answers is here.\n\n", e.Name)
	}
	writeAgentTurn(&b, c, e, round, false)
	return b.String()
}

// writeAgentTurn is the part of an agent seat's prompt both turns share: what the seat is to do in round, what is new to
// it, the person's questions, and the task with its answer shape. first says the seat has seen nothing yet.
func writeAgentTurn(b *strings.Builder, c *Council, e CouncilExpert, round int, first bool) {
	last := SynthesisRound(c)
	ideas, said := agentNews(c, e, round)
	asks := agentAsks(c, e, round)
	switch {
	case round >= last:
		if first {
			b.WriteString("The council has already met. The person replied in the discussion, and you answer from your own " +
				"angle, as yourself.\n")
		}
		b.WriteString("Work from the text below and what you already know; you answer for the council and change nothing in " +
			"the project.\n\n")
	case round == 1 && isBrainstorm(c):
		fmt.Fprintf(b, "This is round 1 of %d: ideas. You have your own tools: read the project when an idea needs it. You "+
			"brainstorm for the council; you never edit anything.\n\n", last)
	case round == 1:
		fmt.Fprintf(b, "This is round 1 of %d: proposals. You have your own tools: read the project when a proposal needs it. "+
			"You review for the council; you never edit anything.\n\n", last)
	case isBrainstorm(c):
		fmt.Fprintf(b, "This is round %d of %d: build on each other. Work from the text below and what you already know; you "+
			"change nothing in the project.\n\n", round, last)
	default:
		fmt.Fprintf(b, "This is round %d of %d: cross-review. Work from the text below and what you already know; you "+
			"change nothing in the project.\n\n", round, last)
	}

	if round == 1 {
		b.WriteString(round1Task(c))
		return
	}
	if round < last {
		b.WriteString("## Proposals to review\n\n")
		if len(ideas) == 0 {
			b.WriteString("(none since your last turn)\n\n")
		}
		for _, p := range ideas {
			writeProposal(b, c, p, "###")
		}
	}
	if len(said) > 0 || (round >= last && len(ideas) > 0) {
		b.WriteString("## What was said since your last turn\n\n")
		if round >= last { // no review section here, so the ideas it has not seen sit with the replies
			for _, p := range ideas {
				writeProposal(b, c, p, "###")
			}
		}
		shown := map[string]bool{}
		for _, r := range said {
			if !r.Revised || shown[r.ProposalId] || slices.ContainsFunc(ideas, func(p CouncilProposal) bool { return p.Id == r.ProposalId }) {
				continue
			}
			if p := findProposal(c, r.ProposalId); p != nil && Sent(p.Draft) {
				shown[p.Id] = true
				b.WriteString("This idea now reads:\n\n")
				writeProposal(b, c, *p, "###")
			}
		}
		for _, r := range said {
			b.WriteString(saidLine(c, r))
		}
		b.WriteString("\n")
	}
	if len(asks) > 0 {
		b.WriteString("## What the person asks you\n\n")
		for _, r := range asks {
			b.WriteString(askLine(c, r))
		}
		b.WriteString("\n")
	}
	b.WriteString("## What to do\n\n")
	if round >= last {
		b.WriteString(answersTask(c))
	} else {
		b.WriteString(round2Task(c, round))
	}
}

// saidLine is one reply another seat sent, as a seat is shown it: who, its stance, what it is on, and its words.
func saidLine(c *Council, r CouncilReply) string {
	var b strings.Builder
	fmt.Fprintf(&b, "- [%s] %s", r.Id, speaker(c, r.Author))
	var tags []string
	if r.Stance != "" {
		tags = append(tags, string(r.Stance))
	}
	if r.Builds && isBrainstorm(c) {
		tags = append(tags, "builds on it")
	}
	if r.Revised {
		tags = append(tags, "revised its proposal")
	}
	if len(tags) > 0 {
		fmt.Fprintf(&b, " (%s)", strings.Join(tags, ", "))
	}
	if p := findProposal(c, r.ProposalId); p != nil {
		fmt.Fprintf(&b, " on %s (%s)", p.Id, p.Title)
	} else {
		b.WriteString(" to the whole council")
	}
	if parent := findReply(c, r.ParentId); parent != nil {
		fmt.Fprintf(&b, ", replying to %s's %s", speaker(c, parent.Author), parent.Id)
	}
	if text := strings.TrimSpace(r.Text); text != "" {
		fmt.Fprintf(&b, ": %s", text)
	} else {
		b.WriteString(": agrees, with nothing to add")
	}
	if len(r.Evidence) > 0 {
		fmt.Fprintf(&b, " Evidence: %s.", evidenceText(r.Evidence))
	}
	b.WriteString("\n")
	return b.String()
}

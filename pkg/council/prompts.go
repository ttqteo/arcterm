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
const HarnessVersion = "2026-10-23.1"

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
      "from": ["P2", "P3"],
      "stances": {"ux": "accept", "skeptic": "challenge"},
      "agreed": false
    }
  ],
  "outcomes": {"P1": "Direction 1", "P2": "Merged into direction 1", "P4": "Withdrawn in round 2"},
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

// writePicks lists how many of the experts' picks each proposal got and who gave them. A council from before picks
// existed has none, and the prompt says so, so the coordinator ranks on the replies alone.
func writePicks(b *strings.Builder, c *Council) {
	b.WriteString("## Picks\n\n")
	if len(c.Picks) == 0 {
		b.WriteString("No expert gave picks (this council is from before picks existed): rank on the replies alone.\n\n")
		return
	}
	if isBrainstorm(c) {
		b.WriteString("In round 2 each expert named the ideas of the others most worth trying. Picks per idea:\n\n")
	} else {
		b.WriteString("In round 2 each expert named the proposals of the others most worth doing. Picks per proposal:\n\n")
	}
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
	if isBrainstorm(c) {
		b.WriteString("\nThis is round 1 of 3: ideas. You have Read, Grep and Glob in the project folder. " +
			"You brainstorm; you never edit anything.\n\n")
		b.WriteString("Come up with ideas for the problem or goal from your angle only. Do not judge any idea, yours or " +
			"anyone's: doubts wait for round 2. A few strong, different ideas beat many that are alike. Each idea is one " +
			"entry in \"proposals\", with a short title and an argument: what the idea is, and why it could work. An idea " +
			"may rest on a guess, so it needs no evidence; read the code to ground an idea, not to audit it.\n\n")
		b.WriteString(wildRule + "\n\n")
		b.WriteString(jsonRule + "\n```json\n" + brainstormRound1Shape + "\n```\n")
		return b.String()
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
	if isBrainstorm(c) {
		b.WriteString("\nThis is round 2 of 3: build on each other. You have no tools in this round: work from the text below.\n\n")
	} else {
		b.WriteString("\nThis is round 2 of 3: cross-review. You have no tools in this round: work from the text below.\n\n")
	}

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
	if isBrainstorm(c) {
		b.WriteString("\nThis is round 3 of 3: pick the best. You have no tools: work from the text below.\n\n")
	} else {
		b.WriteString("\nThis is round 3 of 3: synthesis. You have no tools: work from the text below.\n\n")
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
	if isBrainstorm(c) {
		return writeBrainstormSynthesisTask(&b, c)
	}
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
	shape, summary := synthesisShapeNoQuestion, summaryRuleNoQuestion
	if strings.TrimSpace(c.Question) != "" {
		b.WriteString("7. In \"answer\", write one sentence that answers the question for the council directly: the " +
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
		"A wild idea never takes one of the %d places.\n", maxIdeas, maxIdeas)
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
	if !isBrainstorm(c) { // a Brainstorm asks for no evidence
		b.WriteString(evidenceRule + "\n\n")
	}
	b.WriteString(jsonRule + "\n```json\n" + answersShape + "\n```\n")
	return b.String()
}

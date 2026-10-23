// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"regexp"
	"strings"
	"testing"
)

func TestHarnessVersionFormat(t *testing.T) {
	if !regexp.MustCompile(`^\d{4}-\d{2}-\d{2}\.\d+$`).MatchString(HarnessVersion) {
		t.Errorf("HarnessVersion = %q, want <YYYY-MM-DD>.<n>", HarnessVersion)
	}
}

// promptCouncil is a council in the middle of round 2: four proposals and a branch of replies, one cut proposal, one
// withdrawn, and three of the person's replies.
func promptCouncil() *Council {
	return &Council{
		Id:          "c1",
		Project:     `D:\proj`,
		Feature:     "Idle sleep for services",
		Question:    "Which direction first?",
		Files:       []string{"pkg/services/idle.go", "docs/spec.md"},
		Screenshots: []string{`D:\shots\tree.png`},
		Experts: []CouncilExpert{
			{Id: "ux", Name: "UX", Brief: "Can someone use it without being told how?"},
			{Id: "ram", Name: "RAM", Brief: "What stays in memory?"},
			{Id: "skeptic", Name: "Skeptic", Brief: "Name what breaks."},
			{Id: "lead", Name: "Lead", Brief: "Merge and rank.", Coordinator: true},
		},
		Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Title: "Title-one", Argument: "Argument-one", Evidence: []CouncilEvidence{{Ref: "a.go:1"}}},
			{Id: "P2", Author: "ram", Title: "Title-two", Argument: "Argument-two", Evidence: []CouncilEvidence{{Ref: "b.go:2"}}},
			{Id: "P3", Author: "skeptic", Title: "Title-three", Argument: "Argument-three", Evidence: []CouncilEvidence{{Weak: true, Note: "cites no evidence"}}},
			{Id: "P4", Author: "ram", Title: "Title-four", Argument: "Argument-four", Cut: true},
			{Id: "P5", Author: "ux", Title: "Title-five", Argument: "Argument-five", Withdrawn: true},
		},
		Replies: []CouncilReply{
			{Id: "r1", ProposalId: "P1", Author: "skeptic", Stance: StanceChallenge, Text: "Text-r1 it breaks", Round: 2},
			{Id: "r2", ProposalId: "P1", ParentId: "r1", Author: "ux", Stance: StanceAccept, Revised: true, Text: "Text-r2 fair point", Round: 2},
			{Id: "r3", ProposalId: "P1", ParentId: "r2", Author: YouId, Text: "Text-r3 why does it break?", To: []string{"ux", "skeptic"}},
			{Id: "r4", Author: YouId, Text: "Text-r4 what about Mac?", To: []string{"ux", "ram", "skeptic"}},
			{Id: "r5", ProposalId: "P2", Author: YouId, Text: "Text-r5 already answered", To: []string{"ux"}, Answered: true},
			{Id: "r6", ProposalId: "P2", Author: YouId, Text: "Text-r6 for ram only", To: []string{"ram"}},
			{Id: "r7", ProposalId: "P2", Author: "ram", Stance: StanceOppose, Text: "Text-r7 no", Round: 2},
		},
		Failed: map[string]CouncilFailure{},
	}
}

func mustContain(t *testing.T, what, prompt string, subs ...string) {
	t.Helper()
	for _, s := range subs {
		if !strings.Contains(prompt, s) {
			t.Errorf("%s lacks %q\n---\n%s", what, s, prompt)
		}
	}
}

func mustNotContain(t *testing.T, what, prompt string, subs ...string) {
	t.Helper()
	for _, s := range subs {
		if strings.Contains(prompt, s) {
			t.Errorf("%s holds %q\n---\n%s", what, s, prompt)
		}
	}
}

func TestRound1Prompt(t *testing.T) {
	c := promptCouncil()
	p := Round1Prompt(c, c.Experts[0])
	mustContain(t, "round 1 prompt", p,
		"You are UX", "Can someone use it without being told how?",
		"Idle sleep for services", "Which direction first?", `D:\proj`,
		"pkg/services/idle.go", "docs/spec.md", `D:\shots\tree.png`,
		"Read, Grep and Glob", "never edit",
		evidenceRule, round1Shape, "```json")
	mustNotContain(t, "round 1 prompt", p, "Title-one", "Text-r1")
}

func TestRound1PromptLeavesOutWhatIsEmpty(t *testing.T) {
	c := promptCouncil()
	c.Question, c.Files, c.Screenshots = "  ", nil, nil
	p := Round1Prompt(c, c.Experts[0])
	mustNotContain(t, "round 1 prompt", p, "Question for the council", "Files to read first", "Screenshots")
}

// section is the text from the heading to the next "## " heading.
func section(t *testing.T, prompt, heading string) string {
	t.Helper()
	_, rest, ok := strings.Cut(prompt, heading+"\n")
	if !ok {
		t.Fatalf("no %q section in\n%s", heading, prompt)
	}
	body, _, _ := strings.Cut(rest, "\n## ")
	return body
}

func TestRound2PromptReviewsTheOthersProposalsThatAreNotCut(t *testing.T) {
	c := promptCouncil()
	p := Round2Prompt(c, c.Experts[0]) // UX
	review := section(t, p, "## Proposals to review")
	mustContain(t, "review section", review, "P2 · RAM · Title-two", "Argument-two", "b.go:2", "P3 · Skeptic · Title-three", "weak: cites no evidence")
	mustNotContain(t, "review section", review, "Title-one", "Title-five", "Title-four") // its own, and the cut one
	mustNotContain(t, "round 2 prompt", p, "Title-four", "Argument-four")
	mustContain(t, "round 2 prompt", p, "no tools", evidenceRule, round2Shape, stanceRule, "Can someone use it without being told how?")
}

func TestRound2PromptShowsTheExpertItsOwnProposalsApart(t *testing.T) {
	c := promptCouncil()
	own := section(t, Round2Prompt(c, c.Experts[0]), "## Your own proposals")
	mustContain(t, "own section", own, "P1 · UX · Title-one", "Argument-one", "P5 · UX · Title-five")
	mustNotContain(t, "own section", own, "Title-two")
}

func TestRound2PromptCarriesThePersonsUnansweredRepliesToThisExpert(t *testing.T) {
	c := promptCouncil()
	asks := section(t, Round2Prompt(c, c.Experts[0]), "## What the person asks you") // UX
	mustContain(t, "asks section", asks, "[r3]", "Text-r3 why does it break?", "on P1 (Title-one)", "replying to UX's r2", "[r4]", "Text-r4 what about Mac?", "to the whole council")
	mustNotContain(t, "asks section", asks, "Text-r5", "Text-r6")

	ram := section(t, Round2Prompt(c, c.Experts[1]), "## What the person asks you")
	mustContain(t, "ram asks", ram, "Text-r4", "Text-r6")
	mustNotContain(t, "ram asks", ram, "Text-r3")
}

func TestRound2PromptAsksForPicksAndNeedsNoReasonForAnAccept(t *testing.T) {
	c := promptCouncil()
	p := Round2Prompt(c, c.Experts[0])
	mustContain(t, "round 2 prompt", p, `"picks"`, "the 3 proposals", "most worth doing, best first", "Never pick one of your own",
		"An accept needs no reason")
}

func TestRound2PromptWithNothingToReview(t *testing.T) {
	c := promptCouncil()
	c.Proposals, c.Replies = nil, nil
	p := Round2Prompt(c, c.Experts[0])
	mustContain(t, "round 2 prompt", p, "(none:")
	mustNotContain(t, "round 2 prompt", p, "## Your own proposals", "## What the person asks you")
}

func TestSynthesisPrompt(t *testing.T) {
	c := promptCouncil()
	c.Failed["skeptic"] = CouncilFailure{Round: 1, Error: "timeout"}
	c.Replies = append(c.Replies, CouncilReply{Id: "r8", ProposalId: "P1", Author: "ram", Stance: StanceAccept, Text: "Text-r8 agreed", Evidence: []CouncilEvidence{{Ref: "z.go:9"}}})
	p := SynthesisPrompt(c)

	mustContain(t, "synthesis prompt", p, "You are Lead", "the coordinator", "Merge and rank.", "Idle sleep for services", "Which direction first?", "no tools",
		evidenceRule, synthesisShape, stanceRule, summaryRule)
	// every proposal, the cut and the withdrawn ones too
	mustContain(t, "synthesis prompt", p, "Title-one", "Title-two", "Title-three", "Title-four", "Title-five",
		"The person cut this proposal at the pause", "Its author withdrew it in round 2")
	// every reply, with its stance and the person's among them, a child indented under its parent
	mustContain(t, "synthesis prompt", p,
		"- [r1] Skeptic (challenge): Text-r1 it breaks",
		"  - [r2] UX (accept, revised its proposal) replying to r1: Text-r2 fair point",
		"    - [r3] the person replying to r2: Text-r3 why does it break?",
		"- [r7] RAM (oppose): Text-r7 no",
		"- [r8] RAM (accept): Text-r8 agreed Evidence: z.go:9.",
		"### To the whole council", "- [r4] the person: Text-r4 what about Mac?")
	// who is missing, and the experts the stances are keyed by
	mustContain(t, "synthesis prompt", p, "Skeptic (its round 1 call failed)", "do not guess their stance", "- ux (UX)", "- ram (RAM)")
	mustNotContain(t, "synthesis prompt", p, "- lead (Lead)")
}

func TestSynthesisPromptListsPicksPerProposal(t *testing.T) {
	c := promptCouncil()
	c.Picks = map[string][]string{"ux": {"P2", "P3"}, "ram": {"P1", "P3"}}
	p := SynthesisPrompt(c)
	picks := section(t, p, "## Picks")
	mustContain(t, "picks section", picks, "- P1 (Title-one): 1 (RAM)", "- P2 (Title-two): 1 (UX)", "- P3 (Title-three): 2 (UX, RAM)", "- P4 (Title-four): 0")
	mustNotContain(t, "picks section", picks, "before picks existed")
	mustContain(t, "synthesis prompt", p, "rank the rest by their picks")
}

func TestSynthesisPromptSaysWhenNoPicksWereGiven(t *testing.T) {
	p := SynthesisPrompt(promptCouncil())
	mustContain(t, "synthesis prompt", p, "No expert gave picks", "before picks existed")
}

func TestSynthesisPromptAsksForAnAnswerOnlyWithAQuestion(t *testing.T) {
	c := promptCouncil()
	mustContain(t, "synthesis prompt", SynthesisPrompt(c), `"answer"`, "answers the question")
	c.Question = "  "
	p := SynthesisPrompt(c)
	mustNotContain(t, "synthesis prompt", p, `"answer"`, "answers the question", synthesisShape, summaryRule)
	mustContain(t, "synthesis prompt", p, synthesisShapeNoQuestion, summaryRuleNoQuestion)
}

// Only the synthesis writes the answer and the summary the person reads first; the experts' rounds stay as they are.
func TestOnlyTheSynthesisKeepsTheSummaryShortAndInTheQuestionsLanguage(t *testing.T) {
	c := promptCouncil()
	for name, p := range map[string]string{
		"round 1": Round1Prompt(c, c.Experts[0]),
		"round 2": Round2Prompt(c, c.Experts[0]),
		"answers": AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]}),
	} {
		mustNotContain(t, name+" prompt", p, summaryRule)
	}
	mustContain(t, "synthesis prompt", summaryRule, "at most 25 words", "at most three short sentences", "no path:line",
		"the language the person's question is written in", "every other field stays in English")
}

// The person reads a reason, a summary, an answer and a weak note, and the UI shows no proposal id: every prompt that
// cites proposals by id says to name them by title in prose.
func TestPromptsNameProposalsByTitleInProse(t *testing.T) {
	c := promptCouncil()
	noQuestion := promptCouncil()
	noQuestion.Question = ""
	r3 := c.Replies[2]
	for name, p := range map[string]string{
		"round 2 prompt":                    Round2Prompt(c, c.Experts[0]),
		"round 2 prompt, nothing to review": Round2Prompt(&Council{Experts: c.Experts}, c.Experts[0]),
		"synthesis prompt":                  SynthesisPrompt(c),
		"synthesis prompt, no question":     SynthesisPrompt(noQuestion),
		"answers prompt":                    AnswersPrompt(c, c.Experts[0], []CouncilReply{r3}),
	} {
		mustContain(t, name, p, titleRule, "never by its id")
	}
}

func TestSynthesisPromptNamesNoMissingExpertWhenNoneFailed(t *testing.T) {
	c := promptCouncil()
	c.Failed["lead"] = CouncilFailure{Round: 3, Error: "the synthesis itself"} // the coordinator being retried is not "missing"
	mustNotContain(t, "synthesis prompt", SynthesisPrompt(c), "## Missing", "Lead (its")
}

func TestAnswersPromptCarriesOnlyTheBranchAndTheExpertsOwnProposals(t *testing.T) {
	c := promptCouncil()
	r3 := c.Replies[2]
	p := AnswersPrompt(c, c.Experts[0], []CouncilReply{r3}) // UX answers r3

	mustContain(t, "answers prompt", p, "You are UX", "Can someone use it without being told how?", "Which direction first?", evidenceRule, answersShape, stanceRule)
	// the branch: its proposal and the replies above it, the farthest first
	mustContain(t, "answers prompt", p, "## Reply r3", "Argument-one", "Text-r1 it breaks", "Text-r2 fair point", "The person's reply [r3]: Text-r3 why does it break?")
	if i, j := strings.Index(p, "Text-r1"), strings.Index(p, "Text-r2"); i < 0 || j < i {
		t.Errorf("the ancestors are out of order: r1 at %d, r2 at %d", i, j)
	}
	// the expert's own proposals, from every branch; nothing of the other branches
	own := section(t, p, "## Your own proposals")
	mustContain(t, "own section", own, "Title-one", "Title-five", "You withdrew this one in round 2")
	mustNotContain(t, "answers prompt", p, "Title-two", "Title-three", "Text-r7", "Text-r4", "Text-r6")
	mustContain(t, "answers prompt", p, "You have no tools this time")
	mustNotContain(t, "answers prompt", p, "Read, Grep and Glob")
}

func TestAnswersPromptSaysWhenToolsAreGiven(t *testing.T) {
	c := promptCouncil()
	r3 := c.Replies[2]
	r3.Tools = true
	p := AnswersPrompt(c, c.Experts[0], []CouncilReply{r3})
	mustContain(t, "answers prompt", p, "Read, Grep and Glob")
	mustNotContain(t, "answers prompt", p, "no tools")
}

// brainstormCouncil is promptCouncil as a Brainstorm: the same ideas, the third one wild, and a build among the replies.
func brainstormCouncil() *Council {
	c := promptCouncil()
	c.Mode = ModeBrainstorm
	c.Proposals[2].Wild = true // P3 by the skeptic
	c.Replies = append(c.Replies, CouncilReply{Id: "r8", ProposalId: "P2", Author: "ux", Stance: StanceAccept, Builds: true, Text: "Text-r8 add a badge", Round: 2})
	// the UX brief as the library writes it: the angle, then the evidence rule
	c.Experts[0].Brief = brief("Can someone use it without being told how?")
	return c
}

func TestBrainstormRound1PromptAsksForIdeasWithNoEvidence(t *testing.T) {
	c := brainstormCouncil()
	p := Round1Prompt(c, c.Experts[0])
	mustContain(t, "round 1 prompt", p,
		"You are UX", "Can someone use it without being told how?", "brainstorms ideas",
		"Problem or goal: Idle sleep for services", "Which direction first?", `D:\proj`,
		"pkg/services/idle.go", `D:\shots\tree.png`, "This is round 1 of 3", "Read, Grep and Glob", "never edit",
		"Do not judge", `"wild"`, brainstormRound1Shape, "```json")
	mustNotContain(t, "round 1 prompt", p, evidenceRule, round1Shape, briefEvidenceRule, "Feature:", "cites nothing", "Title-one", "Text-r1")
}

func TestBrainstormRound2PromptBuildsOnTheOthersIdeas(t *testing.T) {
	c := brainstormCouncil()
	p := Round2Prompt(c, c.Experts[0]) // UX
	review := section(t, p, "## Proposals to review")
	mustContain(t, "review section", review, "P2 · RAM · Title-two", "P3 · Skeptic · Title-three (wild idea)")
	mustNotContain(t, "review section", review, "Title-one", "Title-four", "Title-two (wild idea)") // its own, the cut one, a tame idea
	mustContain(t, "round 2 prompt", p, "This is round 2 of 3", "no tools", "Can someone use it without being told how?",
		`"builds": true`, `"picks"`, "the 3 proposals", "Never pick one of your own", stanceRule, titleRule, doubtRule, brainstormRound2Shape)
	mustContain(t, "round 2 prompt", p, "only on an idea you build on yourself or put in your picks")
	mustNotContain(t, "round 2 prompt", p, evidenceRule, round2Shape, briefEvidenceRule)
	// the person's questions and the expert's own ideas still come through
	mustContain(t, "round 2 prompt", p, "## Your own proposals", "P1 · UX · Title-one", "Text-r3 why does it break?")
}

func TestBrainstormSynthesisPromptPicksAtMostThreeIdeasAndKeepsTheWildOnesAside(t *testing.T) {
	c := brainstormCouncil()
	c.Picks = map[string][]string{"ux": {"P2", "P3"}, "ram": {"P1", "P3"}}
	p := SynthesisPrompt(c)
	mustContain(t, "synthesis prompt", p, "This is round 3 of 3", "no tools", "at most 3 ideas worth trying", "first step", `"firststep"`,
		`"kept"`, "wild ideas", "Kept aside", brainstormSynthesisShape, titleRule, summaryRule, "answers the question")
	mustContain(t, "synthesis prompt", p, "### P3 · Skeptic · Title-three (wild idea)", "- [r8] UX (accept, builds on it): Text-r8 add a badge")
	mustNotContain(t, "synthesis prompt", p, evidenceRule, synthesisShape, `"weak"`, "marked weak")
	mustContain(t, "picks section", section(t, p, "## Picks"), "ideas of the others most worth trying", "- P3 (Title-three): 2 (UX, RAM)")

	c.Question = " "
	p = SynthesisPrompt(c)
	mustContain(t, "synthesis prompt, no question", p, brainstormSynthesisShapeNoQuestion)
	mustNotContain(t, "synthesis prompt, no question", p, `"answer"`, brainstormSynthesisShape)
}

func TestBrainstormAnswersPromptAsksForNoEvidence(t *testing.T) {
	c := brainstormCouncil()
	p := AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]})
	mustContain(t, "answers prompt", p, "The council has already met", "brainstorms ideas", "## Reply r3", answersShape, stanceRule)
	mustNotContain(t, "answers prompt", p, evidenceRule, briefEvidenceRule)
}

// Review is the default and the mode of every council saved before modes existed: no word of Brainstorm reaches its
// prompts, and an empty mode reads the same as an explicit review.
func TestReviewPromptsUnchanged(t *testing.T) {
	prompts := func(c *Council) map[string]string {
		r3 := c.Replies[2]
		return map[string]string{
			"round 1":   Round1Prompt(c, c.Experts[0]),
			"round 2":   Round2Prompt(c, c.Experts[0]),
			"synthesis": SynthesisPrompt(c),
			"answers":   AnswersPrompt(c, c.Experts[0], []CouncilReply{r3}),
		}
	}
	plain, explicit := promptCouncil(), promptCouncil()
	explicit.Mode = ModeReview
	for name, want := range prompts(plain) {
		if got := prompts(explicit)[name]; got != want {
			t.Errorf("%s prompt differs between no mode and review\n got %s\nwant %s", name, got, want)
		}
		mustNotContain(t, name+" prompt", want, "brainstorm", "wild", "builds", "firststep", "Problem or goal", "(wild idea)")
	}
	mustContain(t, "round 1 prompt", prompts(plain)["round 1"], "Feature: Idle sleep for services", "reviews one feature", evidenceRule, round1Shape)
	mustContain(t, "round 2 prompt", prompts(plain)["round 2"], "This is round 2 of 3: cross-review", round2Shape)
	mustContain(t, "synthesis prompt", prompts(plain)["synthesis"], "This is round 3 of 3: synthesis", synthesisShape)

	// the library's brief keeps its evidence rule in a Review
	withRule := promptCouncil()
	withRule.Experts[0].Brief = brief("Can someone use it without being told how?")
	mustContain(t, "round 1 prompt", Round1Prompt(withRule, withRule.Experts[0]), briefEvidenceRule)
}

func TestAnswersPromptForAWholeCouncilQuestionAndSeveralReplies(t *testing.T) {
	c := promptCouncil()
	p := AnswersPrompt(c, c.Experts[1], []CouncilReply{c.Replies[3], c.Replies[5]}) // RAM answers r4 and r6
	mustContain(t, "answers prompt", p, "## Reply r4", "addressed to the whole council", "Text-r4 what about Mac?", "## Reply r6", "Argument-two", "Text-r6 for ram only")
	mustNotContain(t, "answers prompt", p, "Title-one", "Text-r1")
	own := section(t, p, "## Your own proposals")
	mustContain(t, "own section", own, "Title-two")
	mustNotContain(t, "own section", own, "Title-four") // cut
}

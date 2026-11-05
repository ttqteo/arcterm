// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
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

func TestRound1PromptAsksForAQuoteAndVerifyRequests(t *testing.T) {
	c := promptCouncil()
	p := Round1Prompt(c, c.Experts[0])
	mustContain(t, "round 1 prompt", p, quoteRule, verifyRule, `"quote"`, `"verify"`, `"expect"`,
		"go test <one package> -run <pattern>", "npx vitest run <one file>", "cargo test <one test name>", "--manifest-path",
		"At most 2", `"pass" or "fail"`, "absolute path")
	mustContain(t, "round 1 prompt", p, round1Shape)

	// a Brainstorm asks for no evidence, so for no quote and no check either
	b := brainstormCouncil()
	pb := Round1Prompt(b, b.Experts[0])
	mustNotContain(t, "brainstorm round 1 prompt", pb, quoteRule, verifyRule, `"quote"`, `"verify"`, `"expect"`)
}

func TestLangLine(t *testing.T) {
	vi := LangLine(LangVi)
	mustContain(t, "vi line", vi, "Vietnamese", `"name"`, "Tìm bug")
	if got := LangLine(LangEn); got != "" {
		t.Errorf("LangLine(en) = %q, want none: an English council needs no line", got)
	}
	for _, lang := range []string{"", "fr", "VI "} {
		if got := LangLine(lang); got != "" {
			t.Errorf("LangLine(%q) = %q, want none for a language the council does not hold", lang, got)
		}
	}
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
		evidenceRule, synthesisShape, summaryRule, askRule)
	// Go fills the stances, the agreed flags and the outcomes: the coordinator is asked for none
	mustNotContain(t, "synthesis prompt", p, stanceRule, `"stances"`, `"agreed"`, `"outcomes"`, "In \"stances\"", "In \"outcomes\"", "every proposal its fate")
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
	// who is missing, and the experts an ask is addressed to
	mustContain(t, "synthesis prompt", p, "Skeptic (its round 1 call failed)", "do not guess their stance", "- ux (UX)", "- ram (RAM)", `in "to"`)
	mustNotContain(t, "synthesis prompt", p, "- lead (Lead)")
}

// The synthesis shows each proposal's and each stance's label, the words the document and the UI use; a proposal or a
// reply nothing labels shows none. The experts' own prompts stay as they were.
func TestSynthesisPromptShowsTheLabelOfEachClaim(t *testing.T) {
	c := promptCouncil()
	c.Proposals[0].Label = LabelRan
	c.Proposals[1].Label = LabelRead
	c.Proposals[2].Label = LabelGuess
	c.Replies[0].Label = LabelDisproved // r1, the skeptic's challenge of P1
	c.Replies[6].Label = LabelRead      // r7, RAM's objection to P2
	p := SynthesisPrompt(c)
	mustContain(t, "synthesis prompt", p,
		"Evidence: a.go:1\nLabel: Ran\n", "Evidence: b.go:2\nLabel: Read code\n", "cites no evidence\nLabel: Guess\n",
		"- [r1] Skeptic (challenge, label: Disproved): Text-r1 it breaks",
		"- [r7] RAM (oppose, label: Read code): Text-r7 no",
		"  - [r2] UX (accept, revised its proposal) replying to r1:") // no label, no tag
	mustNotContain(t, "synthesis prompt", p, "Label: Disproved\n", "Label: \n")

	// a proposal with no label, and a council whose checks did not run, show none
	c = promptCouncil()
	mustNotContain(t, "unlabelled synthesis prompt", SynthesisPrompt(c), "Label:", "label:")

	c.Proposals[0].Label, c.Replies[0].Label = LabelRan, LabelRan
	mustNotContain(t, "round 2 prompt", Round2Prompt(c, c.Experts[1]), "Label:", "label:")
}

// A Review is ranked by how bad a finding is if left alone, the label breaking ties, and a claim that only guesses or was
// disproved stays out of the top; the picks are context, not the ranking.
func TestSynthesisPromptRanksReviewBySeverityAndKeepsGuessesOutOfTheTop(t *testing.T) {
	c := promptCouncil()
	c.Picks = map[string][]string{"ux": {"P2", "P3"}, "ram": {"P1", "P3"}}
	p := SynthesisPrompt(c)
	mustContain(t, "synthesis prompt", p, "by how bad it is if left alone", "data loss", "a broken flow", "a wrong state shown", "cost", "polish",
		"the label breaks a tie", "Ran", "Read code", "Guess", "Disproved", "keep at most 5", "one of the 5 places",
		"all Guess or Disproved", `put it in "kept"`, `"firststep" is its first step`)
	mustNotContain(t, "synthesis prompt", p, "keep at most 3", "rank the rest by how many experts picked them",
		"Put the directions no expert challenges or opposes first")
	// the picks stay as context
	mustContain(t, "synthesis prompt", section(t, p, "## Picks"), "- P3 (Title-three): 2 (UX, RAM)", "Count the experts behind a direction")
}

func TestSynthesisPromptListsPicksPerProposal(t *testing.T) {
	c := promptCouncil()
	c.Picks = map[string][]string{"ux": {"P2", "P3"}, "ram": {"P1", "P3"}}
	p := SynthesisPrompt(c)
	picks := section(t, p, "## Picks")
	mustContain(t, "picks section", picks, "- P1 (Title-one): 1 (RAM)", "- P2 (Title-two): 1 (UX)", "- P3 (Title-three): 2 (UX, RAM)", "- P4 (Title-four): 0")
	mustNotContain(t, "picks section", picks, "before picks existed")
	// the picks are context for the coordinator, not a ranking rule
	mustContain(t, "synthesis prompt", p, "Count the experts behind a direction, not its picks", "counts once")
	mustNotContain(t, "synthesis prompt", p, "rank the rest by how many experts picked them")
}

// picks from seats on one model are one model's judgement: the coordinator is told so, and to write experts and models
func TestSynthesisPromptCountsPicksByExpertAndModel(t *testing.T) {
	c := promptCouncil()
	for i := range c.Experts {
		c.Experts[i].Model = "sonnet"
	}
	c.Experts[3].Model = "opus" // the coordinator does not pick
	c.Picks = map[string][]string{"ux": {"P2", "P3"}, "ram": {"P1", "P3"}}
	picks := section(t, SynthesisPrompt(c), "## Picks")
	mustContain(t, "picks section", picks, "- P3 (Title-three): 2 (UX, RAM) · 1 model (sonnet)",
		"Every expert of this council runs on one model (sonnet).", "not independent votes", `"3 experts, 1 model"`)

	c.Experts[1].Model = "opus"
	picks = section(t, SynthesisPrompt(c), "## Picks")
	mustContain(t, "picks section", picks, "- P3 (Title-three): 2 (UX, RAM) · 2 models (sonnet, opus)")
	mustNotContain(t, "picks section", picks, "Every expert of this council runs on one model")
}

func TestRunFactsSayThePicksModels(t *testing.T) {
	c := promptCouncil()
	for i := range c.Experts {
		c.Experts[i].Model = "sonnet"
	}
	var b strings.Builder
	writeRunFacts(&b, c)
	mustNotContain(t, "run facts", b.String(), "- Picks:")
	c.Picks = map[string][]string{"ux": {"P2"}}
	b.Reset()
	writeRunFacts(&b, c)
	mustContain(t, "run facts", b.String(), "- Picks: 3 experts on 1 model (sonnet); picks from one model are not independent votes")
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

// verifyCouncil is promptCouncil after the verify step: a run that matched, one that did not, one that never ran, a
// request nothing handled, and the cut proposal's result, which no prompt carries.
func verifyCouncil() *Council {
	c := promptCouncil()
	var lines []string
	for i := 1; i <= 30; i++ {
		lines = append(lines, fmt.Sprintf("out-%02d", i))
	}
	c.Proposals[0].Runs = []CouncilRun{{Command: "go test ./pkg/services -run TestIdle", Expect: RunFail, State: RunFail, Exit: 1,
		Matched: true, Tail: strings.Join(lines, "\n")}}
	c.Proposals[1].Runs = []CouncilRun{{Command: "npx vitest run frontend/a.test.ts", Expect: RunPass, State: RunFail, Exit: 1,
		Tail: "AssertionError: expected 2 to be 3"}}
	c.Proposals[2].Runs = []CouncilRun{
		{Command: "cargo test idle_sleep", Expect: RunFail, State: RunNotRun, Reason: "timed out after 3 min"},
		{Command: "go test ./pkg/pending -run TestPending", Expect: RunPass}, // nothing handled it
	}
	c.Proposals[3].Runs = []CouncilRun{{Command: "go test ./pkg/cutone -run TestCut", Expect: RunPass, State: RunPass, Matched: true, Tail: "ok-cut-output"}}
	return c
}

// everySeatSees checks that prompt p holds the results a verify step recorded on P1 to P3, and none of the cut P4's.
func everySeatSees(t *testing.T, what, p string) {
	t.Helper()
	mustContain(t, what, p,
		"`go test ./pkg/services -run TestIdle`: failed (exit 1), as its author expected",
		"`npx vitest run frontend/a.test.ts`: failed (exit 1), but its author expected it to pass",
		"AssertionError: expected 2 to be 3",
		"`cargo test idle_sleep`: not run (timed out after 3 min)",
		"out-30", "out-11") // the last 20 lines of the 30 it kept
	mustNotContain(t, what, p, "out-10", "out-01", "TestPending", "go test ./pkg/cutone", "ok-cut-output")
}

func TestRound2PromptVerifyResults(t *testing.T) {
	c := verifyCouncil()
	for _, e := range c.Experts[:3] { // every seat reads every result: its own proposals' and the others'
		everySeatSees(t, e.Name+"'s round 2 prompt", Round2Prompt(c, e))
	}
	// under its proposal: UX's own P1 under its own heading, the others' under the review heading
	ux := Round2Prompt(c, c.Experts[0])
	own := section(t, ux, "## Your own proposals")
	mustContain(t, "own section", own, "go test ./pkg/services -run TestIdle")
	mustNotContain(t, "own section", own, "npx vitest run")
	review := section(t, ux, "## Proposals to review")
	mustContain(t, "review section", review, "npx vitest run frontend/a.test.ts", "cargo test idle_sleep")
	mustNotContain(t, "review section", review, "go test ./pkg/services")
	if i, j := strings.Index(review, "### P2 ·"), strings.Index(review, "npx vitest run"); i < 0 || j < i {
		t.Errorf("a result is not under its proposal: P2 at %d, its result at %d\n%s", i, j, review)
	}
	mustContain(t, "round 2 prompt", ux, verifyResultsRule)

	// a later reply pass shows them too
	for _, e := range c.Experts[:3] {
		everySeatSees(t, e.Name+"'s round 3 prompt", round2PromptFor(c, e, 3, round2Scope{Picks: true}))
	}

	// a council with no result says nothing about results
	plain := promptCouncil()
	mustNotContain(t, "round 2 prompt", Round2Prompt(plain, plain.Experts[0]), verifyResultsRule, "Checks Go ran")

	// a Brainstorm asks for no check, so shows none
	b := verifyCouncil()
	b.Mode = ModeBrainstorm
	mustNotContain(t, "brainstorm round 2 prompt", Round2Prompt(b, b.Experts[0]), "go test ./pkg/services", verifyResultsRule)
}

func TestSynthesisPromptVerifyResults(t *testing.T) {
	c := verifyCouncil()
	p := SynthesisPrompt(c)
	everySeatSees(t, "synthesis prompt", p)
	mustContain(t, "synthesis prompt", p, synthesisVerifyRule)
	// each under its own proposal, in the order the proposals come
	last := -1
	for _, w := range []string{"### P1 ·", "go test ./pkg/services", "### P2 ·", "npx vitest run", "### P3 ·", "cargo test idle_sleep", "### P4 ·"} {
		i := strings.Index(p, w)
		if i < 0 || i < last {
			t.Errorf("%q is missing or out of order (at %d after %d) in\n%s", w, i, last, p)
		}
		last = max(last, i)
	}
	mustContain(t, "synthesis prompt", p, "The person cut this proposal at the pause")

	plain := promptCouncil()
	mustNotContain(t, "synthesis prompt", SynthesisPrompt(plain), synthesisVerifyRule)

	b := verifyCouncil()
	b.Mode = ModeBrainstorm
	mustNotContain(t, "brainstorm synthesis prompt", SynthesisPrompt(b), "go test ./pkg/services", synthesisVerifyRule)
}

func TestAnswersPromptShowsTheResultsUnderAProposal(t *testing.T) {
	c := verifyCouncil()
	p := AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]}) // UX answers r3, on its own P1
	mustContain(t, "answers prompt", p, "`go test ./pkg/services -run TestIdle`: failed (exit 1), as its author expected")
}

func TestAgentTurnShowsTheResultsOfTheIdeasItReviews(t *testing.T) {
	c := verifyCouncil()
	c.Experts[0].Agent, c.Experts[0].Harness = "tab-1", HarnessClaude
	p := AgentFirstPrompt(c, c.Experts[0], 2)
	mustContain(t, "agent round 2 prompt", p, "`npx vitest run frontend/a.test.ts`: failed (exit 1), but its author expected it to pass")
	mustNotContain(t, "agent round 2 prompt", p, "go test ./pkg/cutone")
}

func TestAnswersPromptCarriesOnlyTheBranchAndTheExpertsOwnProposals(t *testing.T) {
	c := promptCouncil()
	r3 := c.Replies[2]
	p := AnswersPrompt(c, c.Experts[0], []CouncilReply{r3}) // UX answers r3

	mustContain(t, "answers prompt", p, "You are UX", "Can someone use it without being told how?", "Which direction first?", evidenceRule, answersShape, stanceRule, replyAsksRule)
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
	// the tools, and to open a file only when the text does not hold the answer
	mustContain(t, "answers prompt", p, readWhenNeeded)
	mustNotContain(t, "answers prompt", p, "no tools")
}

// attachmentBlockOf is the block a seat's prompt carries after a person's reply with attachments, written out by hand.
func attachmentBlockOf(paths ...string) string {
	return "Attachments (read these files):\n- " + strings.Join(paths, "\n- ") + "\n"
}

// A prompt for a call with tools ends the person's reply with the block, in the reply's order, and the replies of the
// person above it in the branch carry theirs; a reply with no attachment has none, and a call with no tools has none.
func TestAnswersPromptAttachmentBlock(t *testing.T) {
	c := promptCouncil()
	one, two := filepath.Join("home", "att", "a1", "one.png"), filepath.Join("home", "att", "b2", "two.png")
	c.Replies[2].Attachments, c.Replies[2].Tools = []string{one, two}, true // r3, the person's reply under UX's r2
	ux := c.Experts[0]

	p := AnswersPrompt(c, ux, []CouncilReply{c.Replies[2]})
	mustContain(t, "answers prompt", p, "The person's reply [r3]: Text-r3 why does it break?\n"+attachmentBlockOf(one, two)+"\n", readWhenNeeded)
	if n := strings.Count(p, "read these files"); n != 1 {
		t.Errorf("the block is written %d times, want once", n)
	}

	// an ancestor of the person's replies shows its block in the branch above the reply being answered
	c.Replies = append(c.Replies, CouncilReply{Id: "r8", ProposalId: "P1", ParentId: "r3", Author: YouId, Text: "Text-r8 and the rest?", To: []string{"ux"}})
	child := AnswersPrompt(c, ux, []CouncilReply{c.Replies[len(c.Replies)-1]})
	above := section(t, child, "## Reply r8")
	mustContain(t, "the replies above r8", above, "Text-r3 why does it break?\n"+attachmentBlockOf(one, two))
	mustContain(t, "answers prompt", child, "The person's reply [r8]: Text-r8 and the rest?\n\n", readWhenNeeded) // the ancestor's Tools turn the call's on
	if n := strings.Count(child, "read these files"); n != 1 {
		t.Errorf("the block is written %d times, want once, under the ancestor only", n)
	}

	// no attachment, no block
	plain := promptCouncil()
	mustNotContain(t, "answers prompt without attachments", AnswersPrompt(plain, ux, []CouncilReply{plain.Replies[2]}), "read these files", "Attachments")

	// a call that runs with no tools never says "read these files", whatever the reply carries
	c.Replies[2].Tools = false
	noTools := AnswersPrompt(c, ux, []CouncilReply{c.Replies[2]})
	mustNotContain(t, "answers prompt with no tools", noTools, "read these files", one)
	mustContain(t, "answers prompt with no tools", noTools, "You have no tools this time")
}

// An agent seat is sent the same block as its next turn, with its own tools to read it: under each ask, and in the
// messages it is shown that went to the others.
func TestAgentPromptAttachmentBlock(t *testing.T) {
	c := agentPromptCouncil()
	img := filepath.Join("home", "att", "a1", "shot.png")
	for i := range c.Replies {
		if c.Replies[i].Id == "r5" { // to Witness, round 2
			c.Replies[i].Attachments, c.Replies[i].Tools = []string{img}, true
		}
	}
	witness, scout := c.Experts[0], c.Experts[1]

	later := AgentLaterPrompt(c, witness, 3)
	asks := section(t, later, "## What the person asks you")
	mustContain(t, "asks section", asks, "[r5] to the whole council: Text-r5 to Witness\n"+attachmentBlockOf(img))
	if n := strings.Count(later, "read these files"); n != 1 {
		t.Errorf("the later prompt writes the block %d times, want once", n)
	}

	// a seat that has not spoken is brought in whole, and its asks carry it as well
	first := AgentFirstPrompt(c, witness, 2)
	mustContain(t, "first prompt", first, "Text-r5 to Witness\n"+attachmentBlockOf(img))

	// after the report a joining seat is shown the person's messages sent to the others, block included
	joined := agentPromptCouncil()
	joined.Summary = &CouncilSummary{Text: "Done.", At: 10}
	joined.Replies = []CouncilReply{{
		Id: "r1", Author: YouId, Text: "Text-r1 to UX", To: []string{"ux"}, Round: 4, Ts: 20,
		Attachments: []string{img}, Tools: true,
	}}
	seen := AgentFirstPrompt(joined, scout, SynthesisRound(joined)+1)
	mustContain(t, "joining seat's prompt", seen, "Text-r1 to UX\n"+attachmentBlockOf(img))

	// a reply with none carries none
	plain := agentPromptCouncil()
	mustNotContain(t, "agent prompt without attachments", AgentLaterPrompt(plain, plain.Experts[0], 3), "read these files")
}

// A reply pass is a call without tools, except for the seats owed a reply with attachments: only their prompt carries the
// block, and only theirs says the files may be opened.
func TestRound2PromptAttachmentBlock(t *testing.T) {
	c := promptCouncil()
	one, two := filepath.Join("home", "att", "a1", "one.png"), filepath.Join("home", "att", "b2", "two.png")
	c.Replies[2].Attachments, c.Replies[2].Tools = []string{one, two}, true // r3, to UX and Skeptic

	ux := section(t, Round2Prompt(c, c.Experts[0]), "## What the person asks you")
	mustContain(t, "UX's asks", ux, "- [r3] on P1 (Title-one), replying to UX's r2: Text-r3 why does it break?\n"+attachmentBlockOf(one, two)+"- [r4]")
	full := Round2Prompt(c, c.Experts[0])
	mustContain(t, "UX's round 2 prompt", full, round2ReadsNote, "This is round 2 of 3: cross-review")
	mustNotContain(t, "UX's round 2 prompt", full, "You have no tools in this round", "You cannot read the code in this round, so")

	// a seat the reply was not to has no block, and keeps the sentence that says it has no tools
	ram := Round2Prompt(c, c.Experts[1])
	mustNotContain(t, "RAM's round 2 prompt", ram, "read these files", one, round2ReadsNote)
	mustContain(t, "RAM's round 2 prompt", ram, "You have no tools in this round", "You cannot read the code in this round, so")

	// a brainstorm's reply pass says the same
	c.Mode = ModeBrainstorm
	b := Round2Prompt(c, c.Experts[0])
	mustContain(t, "brainstorm round 2 prompt", b, round2ReadsNote, attachmentBlockOf(one, two))
	mustNotContain(t, "brainstorm round 2 prompt", b, "You have no tools in this round")

	// no attachment, no change to the prompt at all
	was, plain := promptCouncil(), promptCouncil()
	plain.Replies[2].Tools = false
	if Round2Prompt(plain, plain.Experts[0]) != Round2Prompt(was, was.Experts[0]) {
		t.Error("a reply with no attachment changed the round 2 prompt")
	}
}

// The synthesis is written from text and has no tools: it quotes a reply's words and never the block.
func TestSynthesisPromptNoAttachmentBlock(t *testing.T) {
	c := promptCouncil()
	img := filepath.Join("home", "att", "a1", "one.png")
	c.Replies[2].Attachments, c.Replies[2].Tools = []string{img}, true
	p := SynthesisPrompt(c)
	mustContain(t, "synthesis prompt", p, "Text-r3 why does it break?")
	mustNotContain(t, "synthesis prompt", p, "read these files", "Attachments", img)
}

func TestAnswersPromptCarriesTheReport(t *testing.T) {
	c := promptCouncil()
	p := AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]})
	mustNotContain(t, "answers prompt before the report", p, "## The council's report")

	c.Summary = &CouncilSummary{
		Answer: "Show the state first.",
		Directions: []CouncilDirection{
			{Title: "Show the state", FirstStep: "Add the badge"},
			{Title: "Sleep sooner"},
		},
		Kept: []CouncilDirection{{Title: "Wake on hover"}},
	}
	p = AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]})
	report := section(t, p, "## The council's report")
	// numbered as the person read it, so "direction 2" in a reply means something
	mustContain(t, "report section", report, "Answer: Show the state first.", "1. Show the state. First step: Add the badge\n",
		"2. Sleep sooner\n", "- Wake on hover")
}

// discussionCouncil is promptCouncil after its report (At 100), with a chat in the Discussion after it, the way council
// c65d51f5457dd6d4 had one: the person attaches a paper to UX (r10), UX answers that it read it (r11), RAM's answer is
// dropped (r12), and the person asks UX about the paper again in a new message with no attachment (r13).
func discussionCouncil() (*Council, string) {
	c := promptCouncil()
	c.Summary = &CouncilSummary{At: 100, Answer: "Show the state first.", Directions: []CouncilDirection{{Title: "Show the state"}}}
	paper := filepath.Join("home", "related", "paper.pdf")
	c.Replies = append(c.Replies,
		CouncilReply{Id: "r10", Author: YouId, Text: "Text-r10 @paper.pdf", To: []string{"ux"}, Tools: true, Attachments: []string{paper}, Answered: true, Ts: 200},
		CouncilReply{Id: "r11", ParentId: "r10", Author: "ux", Text: "Text-r11 I read it: it compares with a hand-written harness", Round: 5, Ts: 210},
		CouncilReply{Id: "r12", ParentId: "r10", Author: "ram", Text: "Text-r12 dropped", Round: 5, Ts: 211, Draft: DraftDropped},
		CouncilReply{Id: "r13", Author: YouId, Text: "Text-r13 what does human-engineered mean in that paper?", To: []string{"ux"}, Ts: 300},
	)
	return c, paper
}

// A new message in the Discussion sits in no branch, so the seat answering it is shown the chat since the report: its own
// earlier answers included, which a fresh call does not remember. Before this it answered r13 as if r10 and r11 had
// never been said.
func TestAnswersPromptCarriesTheDiscussionSinceTheReport(t *testing.T) {
	c, paper := discussionCouncil()
	ux := c.Experts[0]
	r13 := c.Replies[len(c.Replies)-1]
	p := AnswersPrompt(c, ux, []CouncilReply{r13})

	talk := section(t, p, "## The discussion since the report")
	mustContain(t, "discussion section", talk,
		"- [r10] the person to UX: Text-r10 @paper.pdf\n"+attachmentBlockOf(paper),
		"- [r11] UX to the whole council, replying to the person's r10: Text-r11 I read it",
		"Lines by UX are your own earlier answers")
	mustNotContain(t, "discussion section", talk, "Text-r12 dropped", "Text-r13", "Text-r1 it breaks", "Text-r4 what about Mac?")
	if i, j := strings.Index(p, "## The discussion since the report"), strings.Index(p, "## Reply r13"); i < 0 || j < i {
		t.Errorf("the discussion should come before the reply it leads to: at %d, reply at %d", i, j)
	}
	// the paper attached earlier in the chat turns the call's tools on, so the seat can open it again
	mustContain(t, "answers prompt", p, readWhenNeeded)
	mustNotContain(t, "answers prompt", p, "You have no tools this time")
	tools, dirs := readsOf(personRepliesIn(c, []CouncilReply{r13}))
	if !tools || !slices.Equal(dirs, []string{filepath.Dir(paper)}) {
		t.Errorf("readsOf = %v %v, want tools on and the paper's folder", tools, dirs)
	}
	if !DiscussionReads(c) {
		t.Error("DiscussionReads = false, want true: a new message would carry the paper")
	}

	// Let them read files alone on an earlier message was the person's choice for that message: it does not carry
	toggled, _ := discussionCouncil()
	toggled.Replies[len(toggled.Replies)-4].Attachments, toggled.Replies[len(toggled.Replies)-4].Text = nil, "Text-r10 look it up" // r10
	if tools, _ := readsOf(personRepliesIn(toggled, []CouncilReply{r13})); tools || DiscussionReads(toggled) {
		t.Error("an earlier message with tools on and nothing to open turned the follow-up's tools on")
	}

	// a call with no tools in the chat shows the words alone
	c.Replies[len(c.Replies)-4].Tools = false // r10
	plain := AnswersPrompt(c, ux, []CouncilReply{r13})
	mustNotContain(t, "answers prompt with no tools", plain, "read these files", paper)
	mustContain(t, "answers prompt with no tools", section(t, plain, "## The discussion since the report"), "Text-r11 I read it")
	if DiscussionReads(c) {
		t.Error("DiscussionReads = true with no tools in the chat")
	}
}

// The discussion holds only what came before the replies being answered, never a message of their own branch twice, and
// at most discussionRecent messages, the latest; a council with no report has none.
func TestAnswersPromptDiscussionBounds(t *testing.T) {
	c, _ := discussionCouncil()
	ux := c.Experts[0]
	// answering r10 (owed again for the test): nothing of the chat came before it
	r10 := c.Replies[len(c.Replies)-4]
	if strings.Contains(AnswersPrompt(c, ux, []CouncilReply{r10}), "## The discussion since the report") {
		t.Error("a reply with nothing sent before it since the report got a discussion section")
	}

	// a reply under r11 carries r10 and r11 in its branch, not in the discussion
	c.Replies = append(c.Replies, CouncilReply{Id: "r14", ParentId: "r11", Author: YouId, Text: "Text-r14 and then?", To: []string{"ux"}, Ts: 400})
	p := AnswersPrompt(c, ux, []CouncilReply{c.Replies[len(c.Replies)-1]})
	talk := section(t, p, "## The discussion since the report")
	mustContain(t, "discussion section", talk, "Text-r13")
	mustNotContain(t, "discussion section", talk, "Text-r10", "Text-r11")
	mustContain(t, "reply r14", section(t, p, "## Reply r14"), "Text-r10", "Text-r11")

	// a long chat keeps its last discussionRecent messages
	long, _ := discussionCouncil()
	for i := range discussionRecent + 3 {
		long.Replies = append(long.Replies, CouncilReply{Id: fmt.Sprintf("x%d", i), Author: YouId, Text: fmt.Sprintf("Text-x%d.", i), To: []string{"ram"}, Answered: true, Ts: int64(500 + i)})
	}
	long.Replies = append(long.Replies, CouncilReply{Id: "r99", Author: YouId, Text: "Text-r99 last", To: []string{"ux"}, Ts: 900})
	lp := AnswersPrompt(long, ux, []CouncilReply{long.Replies[len(long.Replies)-1]})
	talk = section(t, lp, "## The discussion since the report")
	if n := len(regexp.MustCompile(`(?m)^- \[`).FindAllString(talk, -1)); n != discussionRecent {
		t.Errorf("the discussion holds %d messages, want %d:\n%s", n, discussionRecent, talk)
	}
	mustContain(t, "long discussion", talk, fmt.Sprintf("Text-x%d.", discussionRecent+2))
	mustNotContain(t, "long discussion", talk, "Text-x0.", "Text-r10", "Text-r13")

	// no report, no discussion
	c.Summary = nil
	if strings.Contains(AnswersPrompt(c, ux, []CouncilReply{c.Replies[len(c.Replies)-1]}), "## The discussion since the report") {
		t.Error("a council with no report got a discussion section")
	}
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
		`"kept"`, "wild ideas", brainstormSynthesisShape, titleRule, summaryRule, "answers the question",
		"Rank by how many experts picked it", "then by how many experts built on it")
	mustContain(t, "synthesis prompt", p, "### P3 · Skeptic · Title-three (wild idea)", "- [r8] UX (accept, builds on it): Text-r8 add a badge")
	mustNotContain(t, "synthesis prompt", p, evidenceRule, synthesisShape, `"weak"`, "marked weak", "Label:", "label:")
	// Go fills a Brainstorm's stances, agreed flags and outcomes too
	mustNotContain(t, "synthesis prompt", p, stanceRule, `"stances"`, `"agreed"`, `"outcomes"`, "In \"stances\"", "In \"outcomes\"", "its fate")
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
		mustNotContain(t, name+" prompt", want, "brainstorm", "wild", "builds", "Problem or goal", "(wild idea)")
	}
	mustContain(t, "round 1 prompt", prompts(plain)["round 1"], "Feature: Idle sleep for services", "reviews one feature", evidenceRule, round1Shape)
	mustContain(t, "round 2 prompt", prompts(plain)["round 2"], "This is round 2 of 3: cross-review", round2Shape)
	mustContain(t, "synthesis prompt", prompts(plain)["synthesis"], "This is round 3 of 3: synthesis", synthesisShape,
		"keep at most 5", "only changes wording, names or formatting", `"firststep" is its first step`, "Also raised")

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

// A reply to several seats is answered by one of them first; the others are shown its answer under the reply and asked
// to add to it, not say it again. A dropped answer is not shown, and a seat that answers first is asked nothing of the sort.
func TestAnswersPromptShowsTheAnswersAlreadyGiven(t *testing.T) {
	c := promptCouncil()
	c.Replies = append(c.Replies,
		CouncilReply{Id: "r20", ParentId: "r4", Author: "ux", Text: "Text-r20 UX answered Mac first", Round: 4},
		CouncilReply{Id: "r21", ParentId: "r4", Author: "ux", Text: "Text-r21 dropped", Round: 4, Draft: DraftDropped},
		CouncilReply{Id: "r22", ParentId: "r4", Author: "ram", Round: 4},
	)
	skeptic, _ := seatOf(c, "skeptic")
	p := AnswersPrompt(c, skeptic, []CouncilReply{c.Replies[3]})
	reply := section(t, p, "## Reply r4")
	mustContain(t, "reply r4", reply, "Already answered by others in the council:", "- UX: Text-r20 UX answered Mac first",
		"- RAM: agrees, with nothing to add", writeAnswered)
	mustNotContain(t, "reply r4", reply, "Text-r21 dropped")
	mustContain(t, "answers prompt", p, othersAnsweredRule)
	// the rule comes after the voice rule, last before the shape: "say the point first" read as "agree first"
	if strings.Index(p, othersAnsweredRule) < strings.Index(p, voiceRule) || strings.Index(p, othersAnsweredRule) > strings.Index(p, answersShape) {
		t.Errorf("othersAnsweredRule should sit between the voice rule and the shape:\n%s", p)
	}

	ux, _ := seatOf(c, "ux")
	first := AnswersPrompt(c, ux, []CouncilReply{c.Replies[2]}) // r3 has no answer yet
	mustNotContain(t, "first answer", first, "Already answered", othersAnsweredRule, writeAnswered)
}

// An agent seat answering the person after another seat did is shown that answer under the ask, and the same rule.
func TestAgentFollowUpShowsTheAnswersAlreadyGiven(t *testing.T) {
	c := agentPromptCouncil()
	round := SynthesisRound(c) + 1
	c.Replies = append(c.Replies,
		CouncilReply{Id: "r8", Author: YouId, Text: "Text-r8 to everyone", To: []string{"witness", "scout", "ux", "ram"}, Round: round},
		CouncilReply{Id: "r9", ParentId: "r8", Author: "ux", Text: "Text-r9 UX answered first", Round: round},
	)
	p := AgentLaterPrompt(c, c.Experts[0], round) // Witness
	asks := section(t, p, "## What the person asks you")
	mustContain(t, "asks section", asks, "- [r8] to the whole council: Text-r8 to everyone", "  - UX already answered it: Text-r9 UX answered first", writeAnswered)
	mustContain(t, "follow-up prompt", p, othersAnsweredRule, answersShape)
	mustNotContain(t, "asks section", asks, "- [r9]")
}

// The picks and the withdrawals of a council come in its last reply pass, so its prompts name that round: 2 for a council
// of 2 rounds or none set, 3 for 3. A council of one round has no reply pass, so no prompt speaks of one.
func TestSynthesisAnswersAndPicksNameTheLastReplyRound(t *testing.T) {
	build := func(rounds int, brainstorm bool) *Council {
		c := promptCouncil()
		if brainstorm {
			c = brainstormCouncil()
		}
		c.Rounds = rounds
		c.Picks = map[string][]string{"ux": {"P2", "P3"}, "ram": {"P1", "P3"}}
		return c
	}
	for _, tc := range []struct {
		rounds      int
		round, none string // the reply round the prompts name, and the one they must not
	}{{0, "round 2", "round 3"}, {2, "round 2", "round 3"}, {3, "round 3", "round 2"}} {
		review, brain := build(tc.rounds, false), build(tc.rounds, true)

		p := SynthesisPrompt(review)
		mustContain(t, "review synthesis", p, "In "+tc.round+" each expert named the proposals of the others most worth doing",
			"Its author withdrew it in "+tc.round+".")
		mustNotContain(t, "review synthesis", p, "In "+tc.none+" each expert", "withdrew it in "+tc.none, "Withdrawn in round")

		p = SynthesisPrompt(brain)
		mustContain(t, "brainstorm synthesis", p, "In "+tc.round+" each expert named the ideas of the others most worth trying",
			"Its author withdrew it in "+tc.round+".")
		mustNotContain(t, "brainstorm synthesis", p, "In "+tc.none+" each expert", "withdrew it in "+tc.none, "Withdrawn in round")

		for name, c := range map[string]*Council{"review": review, "brainstorm": brain} {
			p = AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]}) // UX, who withdrew P5
			mustContain(t, name+" answers", p, "You withdrew this one in "+tc.round+".")
			mustNotContain(t, name+" answers", p, "withdrew this one in "+tc.none)
		}
	}
	if SynthesisPrompt(build(0, false)) != SynthesisPrompt(build(2, false)) {
		t.Error("a council with no rounds set reads differently from one of 2 rounds")
	}
}

func TestSynthesisAndAnswersOfACouncilOfOneRoundSpeakOfNoReplyPass(t *testing.T) {
	for name, c := range map[string]*Council{"review": promptCouncil(), "brainstorm": brainstormCouncil()} {
		c.Rounds = 1
		c.Picks = map[string][]string{"ux": {"P2"}}
		p := SynthesisPrompt(c)
		mustContain(t, name+" synthesis", p, "This is round 2 of 2")
		mustNotContain(t, name+" synthesis", p, "## Picks", "each expert named", "withdrew it in round", "Withdrawn in round", `"P4"`)
		mustNotContain(t, name+" answers", AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]}), "withdrew this one in round")
	}
}

// agentPromptCouncil is a council of three rounds with two live agents (Witness and Scout) beside the experts UX and RAM,
// in its third round: ideas from Witness, UX and RAM, replies of every kind, and the person's questions. P3, P4, r2 are
// not out in the room (held, dropped), r4 is of round 3, and r3 is Witness's own.
func agentPromptCouncil() *Council {
	return &Council{
		Id: "c1", Project: `D:\proj`, Feature: "Idle sleep for services", Question: "Which direction first?",
		Files: []string{"pkg/services/idle.go"}, Rounds: 3,
		Experts: []CouncilExpert{
			{Id: "witness", Name: "Witness", Agent: "tab-1", Harness: HarnessClaude},
			{Id: "scout", Name: "Scout", Agent: "tab-2", Harness: HarnessPi},
			{Id: "ux", Name: "UX", Brief: "Can someone use it without being told how?"},
			{Id: "ram", Name: "RAM", Brief: "What stays in memory?"},
			{Id: "lead", Name: "Lead", Brief: "Merge and rank.", Coordinator: true},
		},
		Proposals: []CouncilProposal{
			{Id: "P1", Author: "witness", Title: "Title-own", Argument: "Argument-own"},
			{Id: "P2", Author: "ux", Title: "Title-sent", Argument: "Argument-sent", Evidence: []CouncilEvidence{{Ref: "a.go:1"}}},
			{Id: "P3", Author: "ram", Title: "Title-held", Argument: "Argument-held", Draft: DraftHeld},
			{Id: "P4", Author: "ram", Title: "Title-dropped", Argument: "Argument-dropped", Draft: DraftDropped},
		},
		Replies: []CouncilReply{
			{Id: "r1", ProposalId: "P1", Author: "ux", Stance: StanceChallenge, Text: "Text-r1 sent challenge", Round: 2},
			{Id: "r2", ProposalId: "P1", Author: "ram", Stance: StanceChallenge, Text: "Text-r2 held", Round: 2, Draft: DraftHeld},
			{Id: "r3", ProposalId: "P2", Author: "witness", Stance: StanceAccept, Text: "Text-r3 its own reply", Round: 2},
			{Id: "r4", ProposalId: "P2", Author: "ram", Stance: StanceOppose, Text: "Text-r4 of the third round", Round: 3},
			{Id: "r5", Author: YouId, Text: "Text-r5 to Witness", To: []string{"witness"}, Round: 2},
			{Id: "r6", Author: YouId, Text: "Text-r6 to UX", To: []string{"ux"}, Round: 2},
			{Id: "r7", ProposalId: "P2", Author: "ram", Stance: StanceAccept, Round: 2},
		},
	}
}

func TestAgentPrompts(t *testing.T) {
	c := agentPromptCouncil()
	witness, scout := c.Experts[0], c.Experts[1]

	// the first turn: the question, the other seats marked agent or expert, and the shape the experts answer round 1 in
	first := AgentFirstPrompt(c, witness, 1)
	mustContain(t, "first prompt", first, "You are Witness", "live agent", "Feature: Idle sleep for services", "Question for the council: Which direction first?",
		`D:\proj`, "pkg/services/idle.go", "## Who sits in the council", "- Scout · agent", "- UX · expert", "- RAM · expert", "- Lead · expert · the coordinator",
		"Nothing you say reaches the others until the person sends it", "This is round 1 of 4: proposals", round1ShapeNoVerify, evidenceRule, quoteRule)
	mustNotContain(t, "first prompt", first, "- Witness ·", "Title-sent", "## What was said", "## What the person asks you")
	// a live agent's cites are checked, but it gets no verify request: Go runs nothing for a seat
	mustNotContain(t, "first prompt", first, round1Shape, verifyRule, `"verify"`, `"expect"`)
	mustContain(t, "brainstorm first prompt", AgentFirstPrompt(&Council{Mode: ModeBrainstorm, Feature: "F", Experts: c.Experts}, witness, 1),
		"brainstorms ideas", "Problem or goal: F", brainstormRound1Shape)

	// a later turn of the first reply pass: the ideas it has not seen, and none of the drafts that are not out
	pass2 := AgentLaterPrompt(c, witness, 2)
	mustContain(t, "round 2 prompt", pass2, "You are back in the council as Witness", "This is round 2 of 4: cross-review", "P2 · UX · Title-sent", "Argument-sent", "a.go:1", round2Shape)
	mustNotContain(t, "round 2 prompt", pass2, "Title-held", "Argument-held", "Title-dropped", "Title-own", "Text-r2 held", "## Who sits", "Question for the council")

	// a later pass: only what was sent since its last turn (round 2), never its own words, a held reply or a reply of this round
	pass3 := AgentLaterPrompt(c, witness, 3)
	said := section(t, pass3, "## What was said since your last turn")
	mustContain(t, "said section", said, "[r1] UX (challenge) on P1 (Title-own)", "Text-r1 sent challenge", "[r7] RAM (accept) on P2 (Title-sent): agrees, with nothing to add")
	mustNotContain(t, "round 3 prompt", pass3, "Text-r2 held", "Text-r3 its own reply", "Text-r4 of the third round", "Text-r6", "Argument-sent", "Title-held", "Title-dropped")
	mustContain(t, "round 3 prompt", pass3, "This is round 3 of 4: cross-review", "(none since your last turn)", laterPassNote, round2Shape)
	asks := section(t, pass3, "## What the person asks you")
	mustContain(t, "asks section", asks, "[r5]", "Text-r5 to Witness", "to the whole council")
	mustNotContain(t, "asks section", asks, "Text-r6")

	// a seat that has not spoken is brought in with everything that was sent so far
	late := AgentFirstPrompt(c, scout, 3)
	mustContain(t, "late first prompt", late, "You are Scout", "- Witness · agent", "P1 · Witness · Title-own", "P2 · UX · Title-sent",
		"Text-r1 sent challenge", "Text-r3 its own reply", "[r7] RAM (accept)", "Question for the council")
	mustNotContain(t, "late first prompt", late, "Title-held", "Text-r2 held", "Text-r4 of the third round", "- Scout ·")
	if got := agentPrompt(c, scout, 3); got != late {
		t.Error("a seat that has not spoken is not sent its first prompt")
	}
	if got := agentPrompt(c, witness, 3); got != pass3 {
		t.Error("a seat that has spoken is not sent its later prompt")
	}

	// after the summary: the follow-up shape, and what it missed of the last round
	follow := AgentLaterPrompt(c, witness, SynthesisRound(c))
	mustContain(t, "follow-up prompt", follow, "The council has already met", "Text-r4 of the third round", "Text-r5 to Witness", answersShape)
	mustNotContain(t, "follow-up prompt", follow, "Text-r2 held", "Text-r3 its own reply", "Text-r6", round2Shape)

	// nothing new and nothing asked: the seat is not asked at all
	if seatHasNews(&Council{Experts: c.Experts, Rounds: 3}, witness, 3) {
		t.Error("a seat with nothing to answer was given news")
	}
}

func TestAgentFirstPromptSaysWhetherDraftsAreHeld(t *testing.T) {
	const heldWords = "Nothing you say reaches the others until the person sends it, and they may edit or drop it first."
	const sentWords = "What you say reaches the others as you write it. The person is in the room too and may post or @ a seat."
	c := agentPromptCouncil()
	witness := c.Experts[0]

	held := AgentFirstPrompt(c, witness, 1)
	mustContain(t, "a council that holds drafts", held, heldWords)
	mustNotContain(t, "a council that holds drafts", held, "as you write it", "may post or @ a seat")

	c.ByAgent = true
	sent := AgentFirstPrompt(c, witness, 1)
	mustContain(t, "a council an agent started", sent, sentWords, "The seats answer each round at once")
	mustNotContain(t, "a council an agent started", sent, "until the person sends it", "edit or drop it first")
}

// joiningCouncil is agentPromptCouncil after the coordinator's report (at 1000 ms) with a live agent, Newbie, that has not
// spoken and joins in round 6, the second follow-up. Everything agentPromptCouncil holds (r1 to r7, ts 0) came before the
// report. After it: the person's follow-up to Witness (r10) with Witness's answer (r11), a sent reply (r15) and a held one
// (r14) of round 5, the person's question to Newbie (r12), and a reply of round 6 (r13), the round Newbie's turn is.
func joiningCouncil() (*Council, CouncilExpert) {
	c := agentPromptCouncil()
	newbie := CouncilExpert{Id: "newbie", Name: "Newbie", Agent: "tab-3", Harness: HarnessClaude}
	lead := c.Experts[4]
	c.Experts = append(c.Experts[:4:4], newbie, lead)
	c.Summary = &CouncilSummary{
		Answer:     "Answer-text sleep after an hour",
		Directions: []CouncilDirection{{Rank: 1, Title: "Direction-one sleep first", FirstStep: "Step-one measure idle"}},
		Kept:       []CouncilDirection{{Title: "Kept-title cache warm"}},
		At:         1000,
	}
	c.Replies = append(c.Replies,
		CouncilReply{Id: "r10", Author: YouId, Text: "Text-r10 follow-up to Witness", To: []string{"witness"}, Round: 5, Ts: 1100},
		CouncilReply{Id: "r15", ProposalId: "P2", Author: "ram", Stance: StanceAccept, Text: "Text-r15 RAM before the join", Round: 5, Ts: 1150},
		CouncilReply{Id: "r11", ParentId: "r10", Author: "witness", Text: "Text-r11 Witness answers the follow-up", Round: 5, Ts: 1200},
		CouncilReply{Id: "r14", ProposalId: "P2", Author: "ux", Text: "Text-r14 held", Round: 5, Ts: 1250, Draft: DraftHeld},
		CouncilReply{Id: "r12", Author: YouId, Text: "Text-r12 question to Newbie", To: []string{"newbie"}, Round: 6, Ts: 1300},
		CouncilReply{Id: "r13", ProposalId: "P2", Author: "ram", Text: "Text-r13 same round", Round: 6, Ts: 1350},
	)
	return c, newbie
}

// A seat that joins after the report is briefed from the report and what was said after it, not from every idea and
// reply: the person's messages come whoever they went to, the seat's own question comes once as its question, and a seat
// answers a round at once, so nothing of the round it joins is in it.
func TestAgentFirstPromptAfterTheReport(t *testing.T) {
	c, newbie := joiningCouncil()
	const round = 6
	p := AgentFirstPrompt(c, newbie, round)
	mustContain(t, "joining prompt", p, "You are Newbie", "Question for the council: Which direction first?", "## Who sits in the council", "- Witness · agent",
		"## The council's report", "Answer: Answer-text sleep after an hour", "1. Direction-one sleep first. First step: Step-one measure idle",
		"- Kept-title cache warm", "The council has already met", joinedLateNote, answersShape)
	mustNotContain(t, "joining prompt", p, "- Newbie ·",
		// from before the report: the ideas, the replies and the person's earlier messages
		"Argument-own", "Argument-sent", "Argument-held", "## Proposals to review", "Text-r1 sent challenge", "Text-r3 its own reply",
		"Text-r4 of the third round", "Text-r5 to Witness", "Text-r6 to UX", "[r7]",
		// not out in the room, or of the round it joins
		"Text-r14 held", "Text-r13 same round")

	said := section(t, p, "## What was said since the report")
	mustContain(t, "since the report", said, "- [r10] the person to Witness", "Text-r10 follow-up to Witness",
		"[r15] RAM (accept) on P2", "Text-r15 RAM before the join", "[r11] Witness", "Text-r11 Witness answers the follow-up")
	mustNotContain(t, "since the report", said, "r12", "Text-r12", "r13", "r14")
	if r10, r15, r11 := strings.Index(said, "[r10]"), strings.Index(said, "[r15]"), strings.Index(said, "[r11]"); r10 > r15 || r15 > r11 {
		t.Errorf("the messages are not in the order they came: r10 at %d, r15 at %d, r11 at %d\n%s", r10, r15, r11, said)
	}

	// its own question comes as its question, once
	asks := section(t, p, "## What the person asks you")
	mustContain(t, "asks section", asks, "[r12]", "Text-r12 question to Newbie")
	if n := strings.Count(p, "Text-r12 question to Newbie"); n != 1 {
		t.Errorf("the seat's own question is in the prompt %d times, want once\n%s", n, p)
	}
	if strings.Index(p, "## The council's report") > strings.Index(p, "## What was said since the report") ||
		strings.Index(p, "## What was said since the report") > strings.Index(p, "## What the person asks you") {
		t.Errorf("the report, what was said and the question are out of order\n%s", p)
	}
	if got := agentPrompt(c, newbie, round); got != p {
		t.Error("a seat that has not spoken is not sent its first prompt")
	}
}

// writeReport writes nothing for a report with neither directions nor kept ideas; a joining seat is still shown that the
// report was read, with its answer, or with one line saying it kept no direction.
func TestAgentFirstPromptReportWithoutDirections(t *testing.T) {
	c, newbie := joiningCouncil()
	c.Summary.Directions, c.Summary.Kept = nil, nil
	p := AgentFirstPrompt(c, newbie, 6)
	mustContain(t, "answer-only report", p, "## The council's report", "Answer: Answer-text sleep after an hour")
	mustNotContain(t, "answer-only report", p, "kept no direction")

	c.Summary.Answer = "  "
	p = AgentFirstPrompt(c, newbie, 6)
	mustContain(t, "empty report", p, "## The council's report", "kept no direction", "## What was said since the report")
	mustNotContain(t, "empty report", p, "Answer:")
}

// No report yet, a council still running: a seat that joins is sent everything sent so far, as a seat that joins at start
// gets today.
func TestAgentFirstPromptBeforeAReport(t *testing.T) {
	c := agentPromptCouncil()
	scout := c.Experts[1]
	p := AgentFirstPrompt(c, scout, 3)
	mustContain(t, "first prompt", p, "You are Scout", "- Witness · agent", "P1 · Witness · Title-own", "Argument-own", "P2 · UX · Title-sent",
		"Argument-sent", "Text-r1 sent challenge", "Text-r3 its own reply", "[r7] RAM (accept)", "## Proposals to review",
		"## What was said since your last turn", "Question for the council")
	mustNotContain(t, "first prompt", p, "Title-held", "Text-r2 held", "Text-r4 of the third round", "- Scout ·", "## The council's report", "since the report")
	if got := agentPrompt(c, scout, 3); got != p {
		t.Error("a seat that has not spoken is not sent its first prompt")
	}
}

// A seat that joins in round 2 or later has put no idea forward, so its prompt says it came after them and asks for no
// proposal. Round 1 and a seat with an idea of its own do not get the line.
func TestAgentFirstPromptJoinsInRound2(t *testing.T) {
	c := agentPromptCouncil()
	witness, scout := c.Experts[0], c.Experts[1]
	mustContain(t, "round 2 join", AgentFirstPrompt(c, scout, 2), joinedLateNote, "This is round 2 of 4: cross-review")
	mustContain(t, "round 3 join", AgentFirstPrompt(c, scout, 3), joinedLateNote)
	mustNotContain(t, "round 1", AgentFirstPrompt(c, scout, 1), joinedLateNote)
	mustNotContain(t, "a seat with an idea of its own", AgentFirstPrompt(c, witness, 2), joinedLateNote)
	after, newbie := joiningCouncil()
	mustContain(t, "after the report", AgentFirstPrompt(after, newbie, 6), joinedLateNote)
	mustNotContain(t, "before the report, round 1", AgentFirstPrompt(&Council{Feature: "F", Experts: c.Experts}, scout, 1), joinedLateNote)
}

// A seat joining after the report is asked when it has a question, or has something to read since the report; the report
// alone is nothing to answer.
func TestSeatHasNewsForAJoiningSeat(t *testing.T) {
	c, newbie := joiningCouncil()
	if !seatHasNews(c, newbie, 6) {
		t.Error("a seat joining after the report with a question was given no news")
	}
	noAsk, newbie := joiningCouncil()
	noAsk.Replies = slices.DeleteFunc(noAsk.Replies, func(r CouncilReply) bool { return r.Id == "r12" })
	if !seatHasNews(noAsk, newbie, 6) {
		t.Error("a seat joining after the report with messages since it was given no news")
	}
	quiet, newbie := joiningCouncil()
	quiet.Replies = quiet.Replies[:7] // r1 to r7, all from before the report
	if seatHasNews(quiet, newbie, 6) {
		t.Error("a seat joining after the report with nothing since it and no question was given news")
	}
}

func TestRound2PromptShowsWhatWasSaidInALaterPass(t *testing.T) {
	c := agentPromptCouncil()
	ux := c.Experts[2]
	p := round2PromptFor(c, ux, 3, round2Scope{Picks: true})
	mustContain(t, "round 3 prompt", p, "This is round 3 of 4: cross-review", laterPassNote, "What was said about it:", "[r1] UX", "Text-r1 sent challenge")
	own := section(t, p, "## Your own proposals")
	mustContain(t, "own section", own, "P2 · UX · Title-sent", "[r7] RAM", "[r4] RAM (oppose)")
	mustNotContain(t, "round 3 prompt", p, "Text-r2 held", "Title-held", "Title-dropped")
	// the first pass has no threads, and a council of two rounds says so in its numbers
	first := round2PromptFor(c, ux, 2, round2Scope{Picks: true})
	mustContain(t, "round 2 prompt", first, "This is round 2 of 4")
	mustNotContain(t, "round 2 prompt", first, "What was said about it:", laterPassNote)
}

func TestSynthesisPromptLeavesOutDraftsAndNamesSkips(t *testing.T) {
	c := agentPromptCouncil()
	c.Skips = []CouncilSkip{{Expert: "scout", Round: 2, Reason: "still working on its own task after 10 min"}}
	p := SynthesisPrompt(c)
	mustContain(t, "synthesis prompt", p, "This is round 4 of 4: synthesis", "Title-sent", "Text-r1 sent challenge", "Text-r4 of the third round",
		"Scout (it skipped round 2: still working on its own task after 10 min)", "No seat gave picks")
	mustNotContain(t, "synthesis prompt", p, "Title-held", "Argument-held", "Title-dropped", "Text-r2 held")
}

// every prompt whose fields the Discussion shows asks for the chat voice, a picture where one helps and the must-read sentence marked, and the synthesis does not
func TestPromptsAskForTheMustReadMark(t *testing.T) {
	for name, c := range map[string]*Council{"review": promptCouncil(), "brainstorm": brainstormCouncil()} {
		e := c.Experts[0]
		mustContain(t, name+" round 1 prompt", Round1Prompt(c, e), voiceRule, visualRule, markRule, pictureCheck)
		mustContain(t, name+" round 2 prompt", Round2Prompt(c, e), voiceRule, visualRule, markRule)
		mustContain(t, name+" answers prompt", AnswersPrompt(c, e, c.Replies), voiceRule, visualRule, markRule)
		mustNotContain(t, name+" synthesis prompt", SynthesisPrompt(c), voiceRule, visualRule, markRule)
		mustContain(t, name+" synthesis prompt", SynthesisPrompt(c), askRule)
	}
}

// The person's likes and dislikes reach every prompt after round 1 as the person's view: the cross-review, the summary
// and the answers. A thumb on a draft or on the person's own reply is not listed, and with none there is no section.
func TestPromptsListThePersonsThumbs(t *testing.T) {
	const heading = "## What the person liked and disliked"
	c := promptCouncil()
	c.Proposals[1].Thumb = ThumbLike    // P2
	c.Proposals[2].Thumb = ThumbDislike // P3
	c.Replies[0].Thumb = ThumbDislike   // r1, Skeptic's challenge on P1
	c.Replies[3].Thumb = ThumbLike      // r4, the person's own: never listed
	c.Replies = append(c.Replies,
		CouncilReply{Id: "r8", ProposalId: "P2", Author: "ux", Text: "Text-r8 held", Round: 2, Draft: DraftHeld, Thumb: ThumbLike},
		CouncilReply{Id: "r9", Author: "ram", Text: "Text-r9 to everyone", Round: 2, Thumb: ThumbLike},
	)
	ux, _ := seatOf(c, "ux")
	for name, p := range map[string]string{
		"round 2":   Round2Prompt(c, ux),
		"synthesis": SynthesisPrompt(c),
		"answers":   AnswersPrompt(c, ux, []CouncilReply{c.Replies[2]}),
	} {
		got := section(t, p, heading)
		mustContain(t, name, got, thumbsRule, "- P2 · RAM · Title-two: liked", "- P3 · Skeptic · Title-three: disliked",
			"- [r1] Skeptic's reply on P1: disliked", "- [r9] RAM's reply to the whole council: liked")
		mustNotContain(t, name, got, "[r4]", "[r8]", "P1 ·")
	}
	mustContain(t, "synthesis", SynthesisPrompt(c), "Treat the person's replies, and what they liked or disliked, as the person's own view")
	mustContain(t, "brainstorm synthesis", SynthesisPrompt(brainstormCouncil()), "and what they liked or disliked")
	mustNotContain(t, "round 2 with no thumbs", Round2Prompt(promptCouncil(), ux), heading)
}

// A live agent reads every thumb each later turn, not only the ones on what is new to it: the person often marks a
// message the seat read turns ago, and one taken back must stop counting.
func TestAgentLaterPromptListsEveryThumb(t *testing.T) {
	c := agentPromptCouncil()
	witness := c.Experts[0]
	c.Proposals[0].Thumb = ThumbDislike // P1, Witness's own idea, read in round 1
	c.Proposals[2].Thumb = ThumbLike    // P3 is held: not listed
	got := section(t, AgentLaterPrompt(c, witness, 3), "## What the person liked and disliked")
	mustContain(t, "round 3", got, "- P1 · Witness · Title-own: disliked")
	mustNotContain(t, "round 3", got, "P3")

	c.Proposals[0].Thumb = ""
	mustNotContain(t, "thumb taken back", AgentLaterPrompt(c, witness, 3), "## What the person liked and disliked")
}

// ---- the chosen direction ----

const (
	directionText    = "Ship the Ideas tab first"
	directionHeading = "## The council's memory"
)

// chooseDirection sets directionText as the council's chosen direction, with stray spaces the prompt must trim.
func chooseDirection(c *Council) *Council {
	c.Memory = &CouncilMemory{Chosen: &CouncilMemoryDirection{Text: "  " + directionText + "  ", How: DirectionPin, At: 100}}
	return c
}

// nothingChosen is a memory that holds history and cards but no chosen direction: it reads as no direction at all.
func nothingChosen(c *Council) *Council {
	c.Memory = &CouncilMemory{
		Replaced:   []CouncilMemoryDirection{{Text: "Old direction", How: DirectionWritten, At: 50, Replaced: 90, Ended: EndUnpinned}},
		Suggestion: &CouncilMemoryCard{Kind: CardSuggestion, Text: "A waiting suggestion", Source: SourceCheck},
		Held:       &CouncilMemoryCard{Kind: CardHeld, Text: "A held direction"},
	}
	return c
}

// directionKinds is every prompt a seat turn is written from: each builds the prompt for a council, so a test can build
// it with a chosen direction and without one.
func directionKinds() []struct {
	name    string
	council func() *Council
	prompt  func(c *Council) string
} {
	review := func(c *Council) string { return Round1Prompt(c, c.Experts[0]) }
	return []struct {
		name    string
		council func() *Council
		prompt  func(c *Council) string
	}{
		{"round 1", promptCouncil, review},
		{"round 2", promptCouncil, func(c *Council) string { return Round2Prompt(c, c.Experts[0]) }},
		{"reply pass 3", promptCouncil, func(c *Council) string { return round2PromptFor(c, c.Experts[0], 3, round2Scope{Picks: true}) }},
		{"answers", promptCouncil, func(c *Council) string { return AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]}) }},
		{"brainstorm round 1", brainstormCouncil, review},
		{"brainstorm round 2", brainstormCouncil, func(c *Council) string { return Round2Prompt(c, c.Experts[0]) }},
		{"brainstorm answers", brainstormCouncil, func(c *Council) string { return AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]}) }},
		{"agent first, round 1", agentPromptCouncil, func(c *Council) string { return AgentFirstPrompt(c, c.Experts[0], 1) }},
		{"agent first, joining in round 3", agentPromptCouncil, func(c *Council) string { return AgentFirstPrompt(c, c.Experts[1], 3) }},
		{"agent later, round 2", agentPromptCouncil, func(c *Council) string { return AgentLaterPrompt(c, c.Experts[0], 2) }},
		{"agent later, round 3", agentPromptCouncil, func(c *Council) string { return AgentLaterPrompt(c, c.Experts[0], 3) }},
		{"agent follow-up", agentPromptCouncil, func(c *Council) string { return AgentLaterPrompt(c, c.Experts[0], SynthesisRound(c)) }},
		{"agent first, after the report", func() *Council { c, _ := joiningCouncil(); return c }, func(c *Council) string {
			return AgentFirstPrompt(c, c.Experts[4], 6) // Newbie, the seat before the coordinator
		}},
	}
}

// Every seat turn's prompt opens with the chosen direction, above any other section, saying it outranks the report; a
// council with none, or one whose memory holds none, prompts byte for byte as it did before the memory.
func TestDirectionBlock(t *testing.T) {
	for _, k := range directionKinds() {
		t.Run(k.name, func(t *testing.T) {
			plain := k.prompt(k.council())
			mustNotContain(t, "a prompt with no memory", plain, directionHeading, directionText)

			got := k.prompt(chooseDirection(k.council()))
			mustContain(t, "a prompt with a chosen direction", got, directionHeading+"\n\n", "\n"+directionText+"\n\n", outranksReport)
			mustNotContain(t, "a prompt with a chosen direction", got, "  "+directionText, directionText+"  ") // trimmed

			// it is the first section: nothing else with a heading comes before it
			at := strings.Index(got, directionHeading)
			for line := range strings.SplitSeq(got[:at], "\n") {
				if strings.HasPrefix(line, "## ") {
					t.Errorf("the section %q comes before the chosen direction\n%s", line, got)
				}
			}

			// the direction is all it adds: leave it out and the prompt is as it was
			if without := strings.Replace(got, got[at-1:strings.Index(got, outranksReport)+len(outranksReport)+1], "", 1); without != plain {
				t.Errorf("a chosen direction changed more than its own block\n--- with it removed\n%s\n--- plain\n%s", without, plain)
			}

			if got := k.prompt(nothingChosen(k.council())); got != plain {
				t.Errorf("a memory with no chosen direction changed the prompt\n--- got\n%s\n--- want\n%s", got, plain)
			}
			if got := k.prompt(chooseDirection(k.council())); got != k.prompt(chooseDirection(k.council())) {
				t.Error("the same council prompts two ways")
			}
		})
	}
}

// A chosen direction with only spaces for text says nothing, so it opens no block.
func TestDirectionBlockLeavesOutEmptyText(t *testing.T) {
	c := promptCouncil()
	c.Memory = &CouncilMemory{Chosen: &CouncilMemoryDirection{Text: " \n ", How: DirectionPin}}
	if got, want := Round2Prompt(c, c.Experts[0]), Round2Prompt(promptCouncil(), promptCouncil().Experts[0]); got != want {
		t.Errorf("an empty chosen direction changed the prompt\n%s", got)
	}
}

// The block sits above the report where a prompt carries it, so the seat reads which one wins before it reads the report.
func TestDirectionBlockComesBeforeTheReport(t *testing.T) {
	report := &CouncilSummary{Answer: "Show the state first.", Directions: []CouncilDirection{{Title: "Show the state"}}}

	c := chooseDirection(promptCouncil())
	c.Summary = report
	p := AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]})
	if d, r := strings.Index(p, directionHeading), strings.Index(p, "## The council's report"); d < 0 || r < 0 || d > r {
		t.Errorf("the chosen direction is at %d and the report at %d in the answers prompt\n%s", d, r, p)
	}

	c, newbie := joiningCouncil()
	chooseDirection(c)
	p = AgentFirstPrompt(c, newbie, 6)
	if d, r := strings.Index(p, directionHeading), strings.Index(p, "## The council's report"); d < 0 || r < 0 || d > r {
		t.Errorf("the chosen direction is at %d and the report at %d in the joining seat's prompt\n%s", d, r, p)
	}
}

// The synthesis takes the chosen direction as settled: the report ranks it as direction 1 and writes the rest around it.
// A Brainstorm's synthesis does the same, and a council with none is prompted as before.
func TestSynthesisDirection(t *testing.T) {
	for _, tc := range []struct {
		name    string
		council func() *Council
	}{
		{"review", promptCouncil},
		{"brainstorm", brainstormCouncil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			plain := SynthesisPrompt(tc.council())
			mustNotContain(t, "a synthesis with no direction", plain, directionHeading, directionText, "settled and binding")

			p := SynthesisPrompt(chooseDirection(tc.council()))
			sec := section(t, p, directionHeading)
			mustContain(t, "direction section", sec, directionText, "settled and binding", `"directions"`, "as direction 1", "around it")
			mustNotContain(t, "direction section", sec, "  "+directionText)
			// it comes before the instructions it overrides, and the instructions are untouched
			if d, w := strings.Index(p, directionHeading), strings.Index(p, "## What to do"); d < 0 || d > w {
				t.Errorf("the chosen direction is at %d and What to do at %d\n%s", d, w, p)
			}
			if without := strings.Replace(p, directionHeading+"\n"+sec+"\n", "", 1); without != plain {
				t.Errorf("a chosen direction changed more than its own section\n--- with it removed\n%s\n--- plain\n%s", without, plain)
			}

			if got := SynthesisPrompt(nothingChosen(tc.council())); got != plain {
				t.Errorf("a memory with no chosen direction changed the synthesis\n%s", got)
			}
		})
	}
}

// ---- the whole memory ----

// remember gives the council a memory with the direction and one entry of each kind.
func remember(c *Council) *Council {
	chooseDirection(c)
	c.Memory.Entries = []CouncilMemoryEntry{
		{Id: "m1", Kind: EntryAgreed, Text: "The list reads top to bottom", By: EntryByYou},
		{Id: "m2", Kind: EntryRuledOut, Text: "A second window", Why: "costs 100 MB", By: EntryByAuto},
		{Id: "m3", Kind: EntryOpen, Text: "Does the badge need a count", By: EntryByAuto},
	}
	return c
}

// Every seat prompt carries the whole memory right after its context lines: the direction saying it outranks the report,
// then each kind that has entries with its rule line, and only those kinds.
func TestSeatPromptCarriesMemory(t *testing.T) {
	for _, k := range directionKinds() {
		t.Run(k.name, func(t *testing.T) {
			got := k.prompt(remember(k.council()))
			mustContain(t, "a prompt with a memory", got, directionHeading+"\n\nThe person settled", "\n"+directionText+"\n\n", outranksReport,
				"### Agreed\n"+agreedRule+"\n- [m1] The list reads top to bottom\n",
				"### Ruled out\n"+ruledOutRule+"\n- [m2] A second window (why: costs 100 MB)\n",
				"### Open\n"+openRule+"\n- [m3] Does the badge need a count\n")
			if a, r, o := strings.Index(got, "### Agreed"), strings.Index(got, "### Ruled out"), strings.Index(got, "### Open"); a > r || r > o {
				t.Errorf("the kinds are out of order\n%s", got)
			}
			// it is the first section
			at := strings.Index(got, directionHeading)
			for line := range strings.SplitSeq(got[:at], "\n") {
				if strings.HasPrefix(line, "## ") {
					t.Errorf("the section %q comes before the memory\n%s", line, got)
				}
			}

			c := k.council()
			c.Memory = &CouncilMemory{Entries: []CouncilMemoryEntry{{Id: "m4", Kind: EntryOpen, Text: "Only this", By: EntryByAuto}}}
			only := k.prompt(c)
			mustContain(t, "entries alone", only, directionHeading+"\n\n### Open\n"+openRule+"\n- [m4] Only this\n")
			mustNotContain(t, "entries alone", only, "The person settled", outranksReport, "### Agreed", "### Ruled out")
		})
	}
}

// A council with no direction and no entry prompts byte for byte as before the memory, held cards and history included.
func TestSeatPromptNoMemoryAsBefore(t *testing.T) {
	for _, k := range directionKinds() {
		t.Run(k.name, func(t *testing.T) {
			plain := k.prompt(k.council())
			c := k.council()
			c.Memory = &CouncilMemory{Removed: []string{"open:x"}, NextEntry: 2}
			if got := k.prompt(c); got != plain {
				t.Errorf("an empty memory changed the prompt\n%s", got)
			}
		})
	}
}

// The synthesis keeps the direction binding as direction 1, takes Agreed as settled and does not rank a Ruled out
// option as a direction; entries alone still reach it.
func TestSynthesisRulesForMemory(t *testing.T) {
	for _, tc := range []struct {
		name    string
		council func() *Council
	}{
		{"review", promptCouncil},
		{"brainstorm", brainstormCouncil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := SynthesisPrompt(remember(tc.council()))
			sec := section(t, p, directionHeading)
			mustContain(t, "memory section", sec, directionText, "settled and binding", "as direction 1",
				"### Agreed\nTake these as settled", "- [m1] The list reads top to bottom\n",
				"### Ruled out\nDo not rank an option listed here as a direction", "- [m2] A second window (why: costs 100 MB)\n",
				"### Open\nThese are still to settle", "- [m3] Does the badge need a count\n")
			if d, w := strings.Index(p, directionHeading), strings.Index(p, "## What to do"); d < 0 || d > w {
				t.Errorf("the memory is at %d and What to do at %d\n%s", d, w, p)
			}
			plain := SynthesisPrompt(tc.council())
			if without := strings.Replace(p, directionHeading+"\n"+sec+"\n", "", 1); without != plain {
				t.Errorf("the memory changed more than its own section\n--- with it removed\n%s\n--- plain\n%s", without, plain)
			}

			c := tc.council()
			c.Memory = &CouncilMemory{Entries: []CouncilMemoryEntry{{Id: "m1", Kind: EntryAgreed, Text: "Only this", By: EntryByYou}}}
			only := SynthesisPrompt(c)
			mustContain(t, "entries alone", section(t, only, directionHeading), "### Agreed", "- [m1] Only this")
			mustNotContain(t, "entries alone", only, "settled and binding")
		})
	}
}

// ---- the shared pre-read ----

// preRead is a council whose project folder holds these files (name to content), and that lists them in the order given.
func preRead(t *testing.T, files map[string]string, order ...string) *Council {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	c := promptCouncil()
	c.Project, c.Files, c.Screenshots = dir, order, nil
	return c
}

func TestRound1PromptInlinesASmallFileInFull(t *testing.T) {
	c := preRead(t, map[string]string{"small.go": "package small\n\nfunc One() {}\n"}, "small.go")
	p := Round1Prompt(c, c.Experts[0])
	mustContain(t, "round 1 prompt", p, "Files to read first", "- small.go", "### small.go\n```\npackage small\n\nfunc One() {}\n```\n")
	mustNotContain(t, "round 1 prompt", p, "not inlined")

	// a file with no final line break is closed all the same, and one that holds a fence gets a longer one
	c = preRead(t, map[string]string{"a.txt": "no break", "b.md": "see:\n```go\nx\n```\n"}, "a.txt", "b.md")
	p = Round1Prompt(c, c.Experts[0])
	mustContain(t, "round 1 prompt", p, "### a.txt\n```\nno break\n```\n", "### b.md\n````\nsee:\n```go\nx\n```\n````\n")
}

func TestRound1PromptInlinesFilesInListOrderAndByAbsolutePath(t *testing.T) {
	c := preRead(t, map[string]string{"one.go": "MARK-one\n", "two.go": "MARK-two\n"}, "two.go", "one.go")
	outside := filepath.Join(t.TempDir(), "outside.go")
	if err := os.WriteFile(outside, []byte("MARK-outside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	c.Files = append(c.Files, outside)
	p := Round1Prompt(c, c.Experts[0])
	two, one, out := strings.Index(p, "MARK-two"), strings.Index(p, "MARK-one"), strings.Index(p, "MARK-outside")
	if two < 0 || one < two || out < one {
		t.Errorf("the contents are at two %d, one %d, outside %d: want them in the order listed\n%s", two, one, out, p)
	}
	mustContain(t, "round 1 prompt", p, "### "+outside+"\n")
}

func TestRound1PromptListsButDoesNotInlineAFileOverTheCap(t *testing.T) {
	const cap = 48 * 1024
	c := preRead(t, map[string]string{
		"exact.go": "MARK-exact\n" + strings.Repeat("x", cap-len("MARK-exact\n")),
		"big.go":   "MARK-big\n" + strings.Repeat("x", cap),
	}, "exact.go", "big.go")
	p := Round1Prompt(c, c.Experts[0])
	mustContain(t, "round 1 prompt", p, "MARK-exact", "- big.go (not inlined: over 48 KB)")
	mustNotContain(t, "round 1 prompt", p, "MARK-big", "### big.go")
}

func TestRound1PromptStopsInliningPastTheTotal(t *testing.T) {
	const size = 47 * 1024
	files := map[string]string{"f4.go": "MARK-4\n"}
	var order []string
	for i := range 4 { // four of 47 KB: three fit under 160 KB, the fourth would make 188
		name := fmt.Sprintf("f%d.go", i)
		files[name] = fmt.Sprintf("MARK-%d\n", i) + strings.Repeat("x", size)
		order = append(order, name)
	}
	order = append(order, "f4.go") // small, but after the one that did not fit
	c := preRead(t, files, order...)
	p := Round1Prompt(c, c.Experts[0])
	mustContain(t, "round 1 prompt", p, "MARK-0", "MARK-1", "MARK-2", "- f3.go (not inlined: the 160 KB total is used)", "- f4.go (not inlined: the 160 KB total is used)")
	mustNotContain(t, "round 1 prompt", p, "MARK-3", "MARK-4", "### f3.go", "### f4.go")
}

func TestRound1PromptListsAFileItCannotRead(t *testing.T) {
	c := preRead(t, map[string]string{"bin.dat": "ab\x00cd", "ok.go": "MARK-ok\n"}, "gone.go", "bin.dat", "ok.go")
	if err := os.Mkdir(filepath.Join(c.Project, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	c.Files = append(c.Files, "folder")
	p := Round1Prompt(c, c.Experts[0])
	mustContain(t, "round 1 prompt", p, "- gone.go (not inlined: could not be read)", "- bin.dat (not inlined: not a text file)",
		"- folder (not inlined: could not be read)", "MARK-ok")
	mustNotContain(t, "round 1 prompt", p, "### gone.go", "### bin.dat", "### folder")
}

func TestPreReadIsForRound1Only(t *testing.T) {
	c := preRead(t, map[string]string{"small.go": "MARK-small\n"}, "small.go")
	mustNotContain(t, "round 2 prompt", Round2Prompt(c, c.Experts[0]), "MARK-small", "small.go")
	mustNotContain(t, "synthesis prompt", SynthesisPrompt(c), "MARK-small")
	// a live agent reads with its own tools: it is told which files, as before, and holds no copy
	ac := agentPromptCouncil()
	ac.Project, ac.Files = c.Project, []string{"small.go"}
	first := AgentFirstPrompt(ac, ac.Experts[0], 1)
	mustContain(t, "agent first prompt", first, "Files to read first", "- small.go")
	mustNotContain(t, "agent first prompt", first, "MARK-small", "not inlined")
	// a Brainstorm's round 1 has the pre-read too
	b := preRead(t, map[string]string{"small.go": "MARK-small\n"}, "small.go")
	b.Mode = ModeBrainstorm
	mustContain(t, "brainstorm round 1 prompt", Round1Prompt(b, b.Experts[0]), "### small.go\n```\nMARK-small\n```\n")
}

// ---- the checker a proposal names ----

func TestRound1PromptAsksAReviewSeatForAChecker(t *testing.T) {
	c := promptCouncil()
	p := Round1Prompt(c, c.Experts[0])
	mustContain(t, "round 1 prompt", p, `"checker"`, `"checkwhy"`, "ux (UX)", "ram (RAM)", "skeptic (Skeptic)", "Never name yourself", round1Shape)
	mustNotContain(t, "round 1 prompt", p, "lead (Lead)", round1ShapeNoChecker) // the coordinator checks nothing

	// a Brainstorm and a live agent seat's first turn ask for neither
	b := brainstormCouncil()
	mustNotContain(t, "brainstorm round 1 prompt", Round1Prompt(b, b.Experts[0]), `"checker"`, `"checkwhy"`, "Never name yourself")
	ac := agentPromptCouncil()
	mustNotContain(t, "agent first prompt", AgentFirstPrompt(ac, ac.Experts[0], 1), `"checker"`, `"checkwhy"`, "Never name yourself")

	// a panel of one has no other seat to name: the prompt keeps its verify request and drops the checker
	one := promptCouncil()
	one.Experts = []CouncilExpert{one.Experts[0], one.Experts[3]}
	p = Round1Prompt(one, one.Experts[0])
	mustContain(t, "one-seat round 1 prompt", p, verifyRule, round1ShapeNoChecker)
	mustNotContain(t, "one-seat round 1 prompt", p, `"checker"`, `"checkwhy"`, "Never name yourself", round1Shape)
}

// ---- the routed cross-check ----

// checkerCouncil is promptCouncil after each proposal was routed to a checker: UX's P1 to RAM, RAM's P2 to UX with a
// reason, Skeptic's P3 to RAM with one. P2 and P3 open with a sentence of their own and go on with a rest that only the
// seat it is routed to reads. P1 is challenged by Skeptic (r1) and P2 opposed by RAM (r7).
func checkerCouncil() *Council {
	c := promptCouncil()
	c.Proposals[0].Checker = "ram"
	c.Proposals[1].Checker, c.Proposals[1].CheckWhy = "ux", "it changes what a person sees"
	c.Proposals[1].Argument = "First-two. Rest-two of the argument."
	c.Proposals[2].Checker, c.Proposals[2].CheckWhy = "ram", "it holds memory"
	c.Proposals[2].Argument = "First-three. Rest-three of the argument."
	return c
}

func TestRound2PromptWritesARoutedProposalInFullAndTheRestByTitle(t *testing.T) {
	c := checkerCouncil()
	ux := Round2Prompt(c, c.Experts[0]) // P2 is routed to UX, P3 to RAM
	routed := section(t, ux, "## Proposals routed to you")
	mustContain(t, "routed section", routed, "### P2 · RAM · Title-two", "First-two. Rest-two of the argument.", "b.go:2",
		"Why it is routed to you: it changes what a person sees")
	mustNotContain(t, "routed section", routed, "Title-three", "Title-one")
	other := section(t, ux, "## Other proposals")
	mustContain(t, "other section", other, "- P3 · Skeptic · Title-three: First-three.")
	mustNotContain(t, "other section", other, "Rest-three", "cites no evidence", "Argument-two", "it holds memory", "###")
	mustNotContain(t, "round 2 prompt", ux, "## Proposals to review", "Rest-three", "it holds memory", "Title-four")
	mustContain(t, "round 2 prompt", ux, `"Proposals routed to you"`, `"Other proposals"`)

	// RAM has two routed to it and nothing left to read by title
	ram := Round2Prompt(c, c.Experts[1])
	mustContain(t, "RAM's routed section", section(t, ram, "## Proposals routed to you"), "### P1 · UX · Title-one", "Argument-one",
		"### P3 · Skeptic · Title-three", "Rest-three", "Why it is routed to you: it holds memory")
	mustNotContain(t, "RAM's prompt", ram, "## Other proposals", "it changes what a person sees")
	// a routed proposal with no reason from its author has no reason line
	if got := strings.Count(section(t, ram, "## Proposals routed to you"), "Why it is routed to you"); got != 1 {
		t.Errorf("RAM's routed section has %d reason lines, want 1 (P3's: P1 gave none)", got)
	}

	// everyone still reads their own proposals as ever
	mustContain(t, "own section", section(t, ux, "## Your own proposals"), "P1 · UX · Title-one", "Argument-one")
}

func TestRound2TaskAsksAStanceOnRoutedProposalsOnly(t *testing.T) {
	c := checkerCouncil()
	task := section(t, Round2Prompt(c, c.Experts[0]), "## What to do")
	mustContain(t, "task", task, `every proposal under "Proposals routed to you" one entry in "stances"`,
		`only the title and first line`, `"Other proposals"`, "only when you have a challenge or an oppose", `"picks"`, "any proposal listed above")
	// an older council's task is the one it always was
	old := section(t, Round2Prompt(promptCouncil(), promptCouncil().Experts[0]), "## What to do")
	mustContain(t, "older task", old, `every proposal under "Proposals to review" one entry in "stances"`, `the 3 proposals under "Proposals to review" most worth doing`)
	mustNotContain(t, "older task", old, "Other proposals", "routed")
}

func TestRound2PromptAfterRound2WritesAChallengedProposalInFullForEverySeat(t *testing.T) {
	c := checkerCouncil()
	ux, ram, skeptic := c.Experts[0], c.Experts[1], c.Experts[2]
	scope := round2Scope{Picks: true}

	// UX reads P3 by title until it draws a doubt: an accept is no doubt, and a held challenge is not out in the room
	c.Replies = append(c.Replies,
		CouncilReply{Id: "r8", ProposalId: "P3", Author: "ram", Stance: StanceAccept, Text: "Text-r8 fine", Round: 2},
		CouncilReply{Id: "r9", ProposalId: "P3", Author: "ux", Stance: StanceChallenge, Text: "Text-r9 held doubt", Round: 2, Draft: DraftHeld})
	p := round2PromptFor(c, ux, 3, scope)
	mustContain(t, "round 3 prompt", section(t, p, "## Other proposals"), "P3 · Skeptic · Title-three: First-three.")
	mustNotContain(t, "round 3 prompt", p, "Rest-three", "Text-r8", "Text-r9")
	// P2 is routed to UX, so it comes in full with its thread
	mustContain(t, "round 3 prompt", section(t, p, "## Proposals routed to you"), "### P2 · RAM · Title-two", "What was said about it:", "[r7] RAM (oppose): Text-r7 no")

	// the challenge is sent: P3 comes in full, with what was said about it, to a seat it is not routed to
	c.Replies[len(c.Replies)-1].Draft = ""
	p = round2PromptFor(c, ux, 3, scope)
	routed := section(t, p, "## Proposals routed to you")
	mustContain(t, "round 3 prompt", routed, "### P3 · Skeptic · Title-three", "Rest-three", "What was said about it:", "[r9] UX (challenge): Text-r9 held doubt")
	mustNotContain(t, "round 3 prompt", p, "## Other proposals", "it holds memory") // nothing is left by title, and the reason is RAM's

	// Skeptic reads P1 (routed to RAM, challenged by Skeptic itself) and P2 (routed to UX, opposed) in full, none by title
	p = round2PromptFor(c, skeptic, 3, scope)
	mustContain(t, "Skeptic round 3 prompt", section(t, p, "## Proposals routed to you"), "### P1 · UX · Title-one", "### P2 · RAM · Title-two")
	mustNotContain(t, "Skeptic round 3 prompt", p, "## Other proposals")
	// RAM reads the proposal it was routed in full, and the one routed elsewhere that was challenged
	p = round2PromptFor(c, ram, 3, scope)
	mustContain(t, "RAM round 3 prompt", section(t, p, "## Proposals routed to you"), "### P1 · UX · Title-one", "### P3 · Skeptic · Title-three")

	// round 2 shows no thread: a doubt has no say on the first pass
	mustNotContain(t, "round 2 prompt", Round2Prompt(c, ux), "What was said about it:")
	mustContain(t, "round 2 prompt", section(t, Round2Prompt(c, ux), "## Other proposals"), "P3 · Skeptic · Title-three: First-three.")
}

func TestRound2PromptWritesAProposalWithNoCheckerInFull(t *testing.T) {
	c := checkerCouncil()
	c.Proposals[2].Checker, c.Proposals[2].CheckWhy = "", "" // P3 is from before checkers
	p := Round2Prompt(c, c.Experts[0])
	mustContain(t, "routed section", section(t, p, "## Proposals routed to you"), "### P2 · RAM · Title-two", "### P3 · Skeptic · Title-three", "Rest-three")
	mustNotContain(t, "round 2 prompt", p, "## Other proposals")

	// a council none of whose proposals names a checker reads as it always did
	old := Round2Prompt(promptCouncil(), promptCouncil().Experts[0])
	mustContain(t, "older prompt", section(t, old, "## Proposals to review"), "### P2 · RAM · Title-two", "### P3 · Skeptic · Title-three")
	mustNotContain(t, "older prompt", old, "## Proposals routed to you", "## Other proposals", "## Already reviewed", "Why it is routed to you")
}

func TestBrainstormRound2PromptIgnoresCheckers(t *testing.T) {
	plain, routed := brainstormCouncil(), brainstormCouncil()
	for i := range routed.Proposals {
		routed.Proposals[i].Checker, routed.Proposals[i].CheckWhy = "ram", "why"
	}
	ux := plain.Experts[0]
	for _, round := range []int{2, 3} {
		want := round2PromptFor(plain, ux, round, round2Scope{Picks: true})
		for name, scope := range map[string]round2Scope{
			"whole":   {Picks: true},
			"scoped":  {Only: []string{"P2"}, Picks: true},
			"no pick": {Picks: false},
		} {
			if got := round2PromptFor(routed, ux, round, scope); got != want {
				t.Errorf("round %d, %s: a Brainstorm's prompt changed with checkers\n--- got\n%s\n--- want\n%s", round, name, got, want)
			}
		}
	}
	mustNotContain(t, "brainstorm round 2 prompt", Round2Prompt(routed, ux), "routed", "Other proposals", "Already reviewed")
}

func TestRound2PromptScopeReviewsOnlyTheProposalsInScope(t *testing.T) {
	c := checkerCouncil()
	ux := c.Experts[0]
	p := round2PromptFor(c, ux, 2, round2Scope{Only: []string{"P2"}, Picks: true})
	mustContain(t, "scoped prompt", section(t, p, "## Proposals routed to you"), "### P2 · RAM · Title-two", "Rest-two")
	seen := section(t, p, "## Already reviewed")
	mustContain(t, "already reviewed", seen, "- P3 · Title-three")
	mustNotContain(t, "already reviewed", seen, "First-three", "Skeptic", "Rest-three", "Title-two", "Title-four", "Title-one")
	mustNotContain(t, "scoped prompt", p, "## Other proposals", "First-three", "Rest-three", "Title-four")

	// nothing in scope: no proposal to review, and every other one reads as reviewed
	p = round2PromptFor(c, ux, 2, round2Scope{Only: []string{}, Picks: true})
	mustContain(t, "empty scope", section(t, p, "## Proposals routed to you"), "(none:")
	mustContain(t, "empty scope", section(t, p, "## Already reviewed"), "- P2 · Title-two", "- P3 · Title-three")
	mustNotContain(t, "empty scope", p, "Rest-two", "First-three", "## Other proposals")

	// a nil scope is the whole prompt, with no list of what was reviewed
	whole := round2PromptFor(c, ux, 2, round2Scope{Picks: true})
	mustNotContain(t, "whole prompt", whole, "## Already reviewed")
	if whole != Round2Prompt(c, ux) {
		t.Error("Round2Prompt differs from the whole-council scope with picks on a council of two rounds")
	}

	// a council that routes nothing takes a scope the same way, under its own heading
	old := promptCouncil()
	p = round2PromptFor(old, ux, 2, round2Scope{Only: []string{"P2"}, Picks: true})
	mustContain(t, "scoped older prompt", section(t, p, "## Proposals to review"), "### P2 · RAM · Title-two", "Argument-two")
	mustContain(t, "scoped older prompt", section(t, p, "## Already reviewed"), "- P3 · Title-three")
	mustNotContain(t, "scoped older prompt", p, "Argument-three", "## Proposals routed to you")
}

func TestRound2PromptScopeSaysWhetherToAskForPicks(t *testing.T) {
	c := checkerCouncil()
	ux := c.Experts[0]
	with := round2PromptFor(c, ux, 2, round2Scope{Only: []string{"P2"}, Picks: true})
	mustContain(t, "prompt with picks", with, `Then name your picks in "picks"`, "Never pick one of your own", round2Shape)
	mustNotContain(t, "prompt with picks", with, round2ShapeNoPicks)

	without := round2PromptFor(c, ux, 2, round2Scope{Only: []string{"P2"}, Picks: false})
	mustContain(t, "prompt without picks", without, round2ShapeNoPicks)
	mustNotContain(t, "prompt without picks", without, "picks", round2Shape)
	// the older prompt too
	old := promptCouncil()
	mustNotContain(t, "older prompt without picks", round2PromptFor(old, ux, 2, round2Scope{}), "picks", round2Shape)
	mustContain(t, "older prompt with picks", round2PromptFor(old, ux, 2, round2Scope{Picks: true}), "picks", round2Shape)

	// Round2Prompt asks for picks only in the last reply pass, as applyRound2 keeps them
	three := checkerCouncil()
	three.Rounds = 3
	mustNotContain(t, "round 2 of 3 reply passes", Round2Prompt(three, ux), "picks")
	mustContain(t, "round 3 of 3 reply passes", round2PromptFor(three, ux, 3, round2Scope{Picks: true}), "picks")
	mustContain(t, "round 2 of 2 reply passes", Round2Prompt(c, ux), "picks")
}

func TestFirstSentenceCutsAtTheSentenceOrTheCap(t *testing.T) {
	long := strings.Repeat("word ", 60) // 300 characters and no full stop
	for name, c := range map[string]struct{ in, want string }{
		"two sentences":   {"I'd sleep sooner. Here is why.", "I'd sleep sooner."},
		"a question":      {"Why wait? Because of memory.", "Why wait?"},
		"one line only":   {"Sleep sooner:\n\n| a | b |\n|---|---|\n| 1 | 2 |", "Sleep sooner:"},
		"a path, no stop": {"See pkg/services/idle.go:42 for it", "See pkg/services/idle.go:42 for it"},
		"leading blanks":  {"\n  First. Second.", "First."},
		"empty":           {"  ", ""},
	} {
		if got := firstSentence(c.in); got != c.want {
			t.Errorf("%s: firstSentence(%q) = %q, want %q", name, c.in, got, c.want)
		}
	}
	got := firstSentence(long)
	if n := len([]rune(got)); n > 160 || !strings.HasSuffix(got, "…") {
		t.Errorf("a 300-character sentence became %d characters, %q: want at most 160, ending in …", n, got)
	}
	if got := firstSentence(strings.Repeat("é", 160)); got != strings.Repeat("é", 160) {
		t.Errorf("a sentence of exactly 160 characters was cut: %q", got)
	}
}

func TestAgentPromptSplitsTheIdeasByChecker(t *testing.T) {
	c := agentPromptCouncil()
	c.Proposals[1].Argument = "First-sent. Rest-sent."
	c.Proposals[1].Checker, c.Proposals[1].CheckWhy = "ram", "it holds memory" // P2 (UX), routed to RAM
	witness := c.Experts[0]

	// not routed to it: only the title and first line, and nothing routed to it
	pass2 := AgentLaterPrompt(c, witness, 2)
	mustContain(t, "other section", section(t, pass2, "## Other proposals"), "- P2 · UX · Title-sent: First-sent.")
	mustContain(t, "routed section", section(t, pass2, "## Proposals routed to you"), "(none:")
	mustNotContain(t, "round 2 prompt", pass2, "Rest-sent", "it holds memory", "Title-held")

	// routed to it: in full, with the reason
	c.Proposals[1].Checker = "witness"
	pass2 = AgentLaterPrompt(c, witness, 2)
	mustContain(t, "routed section", section(t, pass2, "## Proposals routed to you"), "### P2 · UX · Title-sent", "First-sent. Rest-sent.", "a.go:1", "Why it is routed to you: it holds memory")
	mustNotContain(t, "round 2 prompt", pass2, "## Other proposals")

	// a seat joining in the first reply pass reads the ones not routed to it by title as well
	c.Proposals[0].Checker = "ram"
	c.Proposals[0].Argument = "First-own. Rest-own."
	late := AgentFirstPrompt(c, c.Experts[1], 2) // Scout: P1 and P2, neither routed to it
	mustContain(t, "late first prompt", section(t, late, "## Other proposals"), "P1 · Witness · Title-own: First-own.", "P2 · UX · Title-sent: First-sent.")
	mustNotContain(t, "late first prompt", late, "Rest-own", "Rest-sent")

	// the agent turn of a council that routes nothing is the one it always was
	plain := agentPromptCouncil()
	mustContain(t, "plain agent prompt", AgentLaterPrompt(plain, witness, 2), "## Proposals to review", "Argument-sent")
	mustNotContain(t, "plain agent prompt", AgentLaterPrompt(plain, witness, 2), "## Other proposals", "routed")
}

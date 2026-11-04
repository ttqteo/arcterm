// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
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
		evidenceRule, synthesisShape, stanceRule, summaryRule, askRule)
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
	mustContain(t, "synthesis prompt", p, "rank the rest by how many experts picked them", "counts once")
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
		everySeatSees(t, e.Name+"'s round 3 prompt", round2PromptFor(c, e, 3))
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
		mustNotContain(t, name+" prompt", want, "brainstorm", "wild", "builds", "Problem or goal", "(wild idea)")
	}
	mustContain(t, "round 1 prompt", prompts(plain)["round 1"], "Feature: Idle sleep for services", "reviews one feature", evidenceRule, round1Shape)
	mustContain(t, "round 2 prompt", prompts(plain)["round 2"], "This is round 2 of 3: cross-review", round2Shape)
	mustContain(t, "synthesis prompt", prompts(plain)["synthesis"], "This is round 3 of 3: synthesis", synthesisShape,
		"keep at most 3", "only changes wording, names or formatting", `"firststep" is its first step`, "Also raised")

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
			"Its author withdrew it in "+tc.round+".", `"Also raised", "Withdrawn in `+tc.round+`" or "Cut at the pause"`,
			`"P4": "Withdrawn in `+tc.round+`", `)
		mustNotContain(t, "review synthesis", p, "In "+tc.none+" each expert", "withdrew it in "+tc.none, "Withdrawn in "+tc.none)

		p = SynthesisPrompt(brain)
		mustContain(t, "brainstorm synthesis", p, "In "+tc.round+" each expert named the ideas of the others most worth trying",
			"Its author withdrew it in "+tc.round+".", `"Not picked", "Withdrawn in `+tc.round+`" or "Cut at the pause"`)
		mustNotContain(t, "brainstorm synthesis", p, "In "+tc.none+" each expert", "withdrew it in "+tc.none, "Withdrawn in "+tc.none)

		for name, c := range map[string]*Council{"review": review, "brainstorm": brain} {
			p = AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]}) // UX, who withdrew P5
			mustContain(t, name+" answers", p, "You withdrew this one in "+tc.round+".")
			mustNotContain(t, name+" answers", p, "withdrew this one in "+tc.none)
		}

		// the shape still parses once its example outcome names the round
		if _, _, err := ParseSynthesis(jsonFence(shapeForRounds(review, synthesisShape))); err != nil {
			t.Errorf("%d rounds: the synthesis shape does not parse: %v", tc.rounds, err)
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
		mustContain(t, name+" synthesis", p, "This is round 2 of 2", `or "Cut at the pause"`)
		mustNotContain(t, name+" synthesis", p, "## Picks", "each expert named", "withdrew it in round", "Withdrawn in round", `"P4"`)
		mustNotContain(t, name+" answers", AnswersPrompt(c, c.Experts[0], []CouncilReply{c.Replies[2]}), "withdrew this one in round")
	}
	one := promptCouncil()
	one.Rounds = 1
	if _, _, err := ParseSynthesis(jsonFence(shapeForRounds(one, synthesisShape))); err != nil {
		t.Errorf("the synthesis shape of one round does not parse: %v", err)
	}
	mustContain(t, "synthesis", SynthesisPrompt(one), `"Also raised" or "Cut at the pause"`)
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
	p := round2PromptFor(c, ux, 3)
	mustContain(t, "round 3 prompt", p, "This is round 3 of 4: cross-review", laterPassNote, "What was said about it:", "[r1] UX", "Text-r1 sent challenge")
	own := section(t, p, "## Your own proposals")
	mustContain(t, "own section", own, "P2 · UX · Title-sent", "[r7] RAM", "[r4] RAM (oppose)")
	mustNotContain(t, "round 3 prompt", p, "Text-r2 held", "Title-held", "Title-dropped")
	// the first pass has no threads, and a council of two rounds says so in its numbers
	first := round2PromptFor(c, ux, 2)
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
	directionHeading = "## The chosen direction"
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
		{"reply pass 3", promptCouncil, func(c *Council) string { return round2PromptFor(c, c.Experts[0], 3) }},
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

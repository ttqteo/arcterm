// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/agentpair"
	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// the arc-view mod draws these prompts' transcript rows by reading them back (claude/arc-view-mod/hooks/prompt-core.ts),
// and its vitest suite parses these same files. A wording change here fails this test first: rewrite the files with
// ARC_UPDATE_VIEWMOD_FIXTURES=1, then make the mod's suite pass on them.
const (
	viewModFixtureDir = "../../claude/arc-view-mod/testdata"
	updateFixturesEnv = "ARC_UPDATE_VIEWMOD_FIXTURES"
)

func checkViewModFixture(t *testing.T, name, text string) {
	t.Helper()
	// a worker's report path sits under this machine's temp dir: pin it, so the files match on any machine and
	// carry no local path. Cleaned, since macOS's TMPDIR ends in a slash that would take the next one with it.
	text = strings.ReplaceAll(text, filepath.ToSlash(filepath.Clean(os.TempDir())), "C:/tmp")
	// the spec and plan are written as this OS's absolute paths and read back as the Windows ones the files hold
	if fixtureRoot != fixtureFileRoot {
		text = strings.ReplaceAll(text, fixtureRoot+"/", fixtureFileRoot+"/")
	}
	path := filepath.Join(viewModFixtureDir, name+".txt")
	if os.Getenv(updateFixturesEnv) == "1" {
		if err := os.MkdirAll(viewModFixtureDir, 0o755); err != nil {
			t.Fatalf("creating %s: %v", viewModFixtureDir, err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatalf("writing %s: %v", path, err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v (run with %s=1 to write it)", path, err, updateFixturesEnv)
	}
	if string(want) != text {
		t.Errorf("%s no longer matches what the engine sends; rerun with %s=1 and check the arc-view mod still draws it:\n%s", path, updateFixturesEnv, text)
	}
}

// fixtureFileRoot is the project root the fixture files name. fixtureRoot is the same root as this OS writes an
// absolute path, so DocPath returns the spec and plan as written: "C:/work/app" is not absolute outside Windows, and
// a verifier's prompt there read it as relative to its tree. checkViewModFixture maps it back.
const fixtureFileRoot = "C:/work/app"

var fixtureRoot = func() string {
	if runtime.GOOS == "windows" {
		return fixtureFileRoot
	}
	// not "/work/app": that is inside "C:/work/app", which other fixtures write as is, and the mapping back would
	// rewrite it too
	return "/fixture/app"
}()

var (
	fixtureSpec = fixtureRoot + "/docs/superpowers/specs/2026-11-04-coach-design.md"
	fixturePlan = fixtureRoot + "/docs/superpowers/plans/2026-11-04-coach.md"
)

var fixturePrinciples = waveobj.PrincipleList{
	{ID: "p1", Text: "Prefer simple, direct solutions over enterprise over-engineering."},
	{ID: "p2", Text: "Handle errors at boundaries and never silently swallow them."},
}

func fixtureGroup() *waveobj.TaskGroup {
	return &waveobj.TaskGroup{
		RunID:    "run-1234",
		PlanPath: fixturePlan,
		SpecPath: fixtureSpec,
		Check:    "npm run lint",
		Verify:   "node scripts/verify.mjs ./pkg/coach",
		FinalCmd: "node scripts/cdp/final-verify.mjs coach",
		Tasks: []waveobj.TaskNode{
			{ID: "t-3", Label: "Question bank store", Description: "Owns pkg/coach/bank.go.", ReviewBase: "abc1234"},
			{ID: "t-4", Label: "Practice view"},
		},
	}
}

// TestViewModFixtures pins the wording the arc-view mod's prompt cards read, one file per kind of prompt the engine
// and the cockpit put into a session. A kind this tree has no builder for (a design session, a design-approved lead,
// the workflow scan's picks line, the council's seats) has no file here.
func TestViewModFixtures(t *testing.T) {
	quick := jarvis.BuildQuickPrompt("fix the flaky parser test", fixturePrinciples, "claude")
	checkViewModFixture(t, "quick", quick)

	const goal = "Build Interview practice app. Make a new dir for this project"
	checkViewModFixture(t, "lead-goal", jarvis.BuildOrchestratePrompt(goal, fixturePrinciples, "claude", false))
	checkViewModFixture(t, "lead-goal-autonomous", jarvis.BuildOrchestratePrompt(goal, fixturePrinciples, "claude", true))

	wake := composeWake([]string{taskFailedWake("t-3", FailureKindUnrecorded, "the worker exited")}, "wake: 1 question waiting. wsh jarvis dag asks", nil, nil)
	checkViewModFixture(t, "plan-lead", jarvis.PlanLeadPrompt(fixturePrinciples, "run-1234", fixtureSpec, fixturePlan, "eff-9", false, wake))
	replacement := replacementLeadWake(nil, []string{reviewFailedWake("t-4", "the view never loads")})
	checkViewModFixture(t, "plan-lead-replacement", jarvis.PlanLeadPrompt(nil, "run-1234", "", fixturePlan, "", true, replacement))

	g := fixtureGroup()
	owner := &waveobj.Run{Goal: "Build Interview practice app"}
	checkViewModFixture(t, "worker", taskPrompt(g, &g.Tasks[0], owner, "claude", "", "", nil))
	noPlan := &waveobj.TaskGroup{Preamble: "Never edit docs/.\n\nKeep the store in one file."}
	checkViewModFixture(t, "worker-dag", taskPrompt(noPlan, &waveobj.TaskNode{ID: "t-2", Label: "add fmtDate"}, owner, "pi", "", "", nil))

	worker := &waveobj.Run{EndCommit: "def5678", Evidence: &waveobj.RunEvidence{Summary: "## Done\nthe bank store"}}
	checkViewModFixture(t, "reviewer", reviewPrompt(g, &g.Tasks[0], worker, nil, nil))

	checkViewModFixture(t, "plan-reviewer", planReviewPrompt(g, ""))
	checkViewModFixture(t, "plan-reviewer-second", planSecondPassPrompt(g, ""))

	final := fixtureGroup()
	final.Final = &waveobj.FinalStage{Round: 1, Tree: "C:/work/app-final", Commit: "0123456789abcdef", OutDir: "C:/work/out"}
	checkViewModFixture(t, "verifier", verifierPrompt(context.Background(), final, &waveobj.Run{BaseCommit: "abc1234"}))

	checkViewModFixture(t, "builder-check", brainstormcheck.Prompt(fixtureSpec, "C:/work/app/.superpowers/brainstorm/coach/check.md"))
	judge := brainstormcheck.JudgeInput{
		Question:   "Where do the questions come from?",
		Approaches: []brainstormcheck.Approach{{Name: "Bundled bank", Description: "a JSON file in the repo"}, {Name: "Model-written", Description: "generated per session"}},
	}
	noShuffle := func(int, func(i, j int)) {}
	checkViewModFixture(t, "judge", brainstormcheck.JudgePrompt(judge, "brainstorm: judged", "C:/work/app/.superpowers/brainstorm/coach/judge.json", noShuffle))

	// what the cockpit sends over the mod's stream
	checkViewModFixture(t, "agent-message", agentmsg.Envelope("design lead", "tab-1234", "rename the helper\nand rerun the tests"))
	checkViewModFixture(t, "pair-message", agentmsg.PairEnvelope("From the judge \"review\", 14:02:\n> lock the threshold first\nThe pilot measures before the threshold is locked: swap the two steps."))
	// a pair's texts (pkg/agentpair): Chat reads them back as the sender's turn (frontend/app/view/agents/pairrelay.ts).
	// relayHead formats a time in the local zone, so the times are made in it and read back the same anywhere
	at := func(h, m int) int64 { return time.Date(2026, 11, 26, h, m, 0, 0, time.Local).UnixMilli() }
	judgeReply := "> then I lock the 0.8 threshold and run the full set\n" +
		"The pilot measures before the threshold is locked: swap the two steps.\n\n" +
		"```arc-judge\nreopen D2: the threshold is picked after the pilot measures, so it is tuned to the pilot\n" +
		"new: the pilot cases overlap the test split\n```"
	workerReply := "> reopen D2: the threshold is picked after the pilot measures, so it is tuned to the pilot\n" +
		"Swapped: O2 now locks the threshold from the labelled set before the pilot runs.\n\n" +
		"```arc-pair\nD1 Pilot on 40 transcripts\nO2 Lock the threshold from the labelled set — before the pilot runs\n" +
		"A3 Keep the 0.8 threshold? [Yes | No, change it]\n```"
	checkViewModFixture(t, "pair-relay-first", agentmsg.PairEnvelope(agentpair.RelayPrompt([]agentpair.RelayItem{
		{From: agentpair.FromJudge, Name: "mit-thesis", Tab: "tab-judge", Ts: at(14, 2), Text: judgeReply},
	}, agentpair.WorkerBrief([]string{"mit-thesis"}))))
	// a pair started from a reply the working agent had gone on from: its first prompt carries the note after the brief
	checkViewModFixture(t, "pair-relay-first-older", agentmsg.PairEnvelope(agentpair.RelayPrompt([]agentpair.RelayItem{
		{From: agentpair.FromJudge, Name: "mit-thesis", Tab: "tab-judge", Ts: at(14, 2), Text: judgeReply},
	}, agentpair.WorkerBrief([]string{"mit-thesis"})+"\n\n"+agentpair.OlderReplyNote(at(13, 40)))))
	checkViewModFixture(t, "pair-relay-batch", agentmsg.PairEnvelope(agentpair.RelayPrompt([]agentpair.RelayItem{
		{From: agentpair.FromJudge, Name: "mit-thesis", Tab: "tab-judge", Ts: at(14, 9), Text: "> O2 now locks the threshold from the earlier labelled set\n" +
			"Agreed on the order. Two things before D2 can close:\n\n" +
			"- the labelled set in `data/labels-v2.csv` has 212 rows, 31 of them from the pilot's own sources\n" +
			"- section 4.2 still reads \"tuned on the pilot\"\n\n" +
			"O4 can close once the 31 rows are out."},
		{From: agentpair.FromPerson, Ts: at(14, 10), Text: "Answer to A3: Keep 0.8."},
	}, "")))
	checkViewModFixture(t, "pair-relay-worker", agentmsg.PairEnvelope(agentpair.RelayPrompt([]agentpair.RelayItem{
		{From: agentpair.FromWorker, Name: "thesis-draft", Tab: "tab-worker", Ts: at(14, 5), Text: workerReply},
	}, "")))
	checkViewModFixture(t, "pair-judge-brief", agentmsg.PairEnvelope(agentpair.JudgeBrief(agentpair.JudgeBriefInput{
		WorkerName: "thesis-draft", WorkerTab: "tab-worker", Reply: workerReply,
		Docs: []string{"docs/superpowers/plans/2026-11-26-pilot.md"},
	})))
	// the brief of an older reply: the paragraph naming the transcript and the record, and the paste as "the agent's reply"
	checkViewModFixture(t, "pair-judge-brief-older", agentmsg.PairEnvelope(agentpair.JudgeBrief(agentpair.JudgeBriefInput{
		WorkerName: "thesis-draft", WorkerTab: "tab-worker", Reply: workerReply,
		Docs:  []string{"docs/superpowers/plans/2026-11-26-pilot.md"},
		Later: true, Transcript: "C:/Users/me/.claude/projects/thesis-draft/3f2a91c0.jsonl", Record: "9c1d7e52-4b0a-4f6e-8a31-2d5c7e90b4a1",
	})))
	checkViewModFixture(t, "pair-ended", agentmsg.PairEnvelope(agentpair.EndedNotice([]string{"task build:backend", "npm test"})))
	child := &waveobj.Run{ID: "run-77", ParentLeadORef: "tab:t1", Goal: "split the channel blob into per-run records", Status: jarvis.RunStatus_Done,
		Evidence: &waveobj.RunEvidence{Files: make([]waveobj.EvidenceFile, 3), AddTotal: 40, DelTotal: 2}}
	childLine, _ := jarvis.ParentNotifyLine(child)
	// steerRunLead drops the \r the line carried when it was typed
	checkViewModFixture(t, "child-done", strings.TrimRight(childLine, "\r"))
	child.Status = jarvis.RunStatus_Cancelled
	childLine, _ = jarvis.ParentNotifyLine(child)
	checkViewModFixture(t, "child-cancelled", strings.TrimRight(childLine, "\r"))
	checkViewModFixture(t, "autonomous-on", jarvis.AutonomousOnWake)
	checkViewModFixture(t, "autonomous-off", jarvis.AutonomousOffWake)
	checkViewModFixture(t, "builder-questions", brainstormcheck.Line("C:/work/app/.superpowers/brainstorm/coach/check.md"))
	checkViewModFixture(t, "judged", brainstormcheck.JudgedLine("C:/work/app/.superpowers/brainstorm/coach/judge.json"))
	checkViewModFixture(t, "judge-failed", brainstormcheck.JudgeFailedLine("the judge wrote no report."))
	checkViewModFixture(t, "for-later", forLaterTyped("t-3", sectionHeading(jarvis.ReportKeyForLater), "the bank's Load takes a context now"))
	checkViewModFixture(t, "review-note", reviewNoteTyped("t-3", "keep the empty-bank message"))
	checkViewModFixture(t, "wake", wake)
}

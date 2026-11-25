// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// fastTrackFixture is finalFixture on a fast-track dag.
func fastTrackFixture(t *testing.T, verify, check, finalCmd string) *mergeFixture {
	t.Helper()
	f := finalFixture(t, verify, check, finalCmd)
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.FastTrack = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return f
}

// awaitEndReviewer ticks f's dag and polls until its end reviewer has a session.
func awaitEndReviewer(t *testing.T, f *mergeFixture) *waveobj.TaskGroup {
	t.Helper()
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		g := f.dag(t)
		if g.Final != nil && g.Final.EndReview != nil && g.Final.EndReview.RunID != "" {
			return g
		}
		if time.Now().After(deadline) {
			t.Fatalf("no end reviewer started, got %+v", g.Final)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// endReviewSteps is the final-step rows with step review the fake lead recorded, as "<round> <ok>".
func endReviewSteps(lead *fakeLead) []string {
	var out []string
	for _, r := range lead.rows {
		if r["eventkind"] != waveobj.RunEventKindFinalStep || r["step"] != FinalStep_Review {
			continue
		}
		if _, ok := r["ms"].(int64); !ok {
			out = append(out, "no ms")
			continue
		}
		out = append(out, fmt.Sprintf("%v %v", r["round"], r["ok"]))
	}
	return out
}

func TestTheEndReviewerStartsWithTheTree(t *testing.T) {
	cases := []struct {
		name      string
		fastTrack bool
		finalCmd  bool
	}{
		{"fast track with the verifier alongside", true, false},
		{"fast track with a Final command", true, true},
		{"full path", false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			useVerifier(t)
			calls := captureSpawns(t)
			newFakeLead(t)
			wait, open := gate(t)
			finalCmd := ""
			if c.finalCmd {
				finalCmd = "echo shot"
			}
			f := finalFixture(t, passVerify, wait, finalCmd)
			if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
				cur.FastTrack = c.fastTrack
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			await := awaitFinal(t)
			defer func() { open(); await() }()

			if !c.fastTrack {
				g := awaitVerifierAlongside(t, f)
				if g.Final.EndReview != nil || len(*calls) != 1 {
					t.Fatalf("the full path starts no end reviewer, got %+v after %d spawns", g.Final.EndReview, len(*calls))
				}
				return
			}
			g := awaitEndReviewer(t, f)
			if g.Final.State != FinalState_Checking {
				t.Fatalf("the end reviewer starts while Check runs, got %s", g.Final.State)
			}
			run, err := wstore.GetRun(f.ctx, f.channel, g.Final.EndReview.RunID)
			if err != nil {
				t.Fatal(err)
			}
			owner, err := wstore.GetRun(f.ctx, f.channel, f.ownerID)
			if err != nil {
				t.Fatal(err)
			}
			route := reviewerRoute(owner, g)
			if run.StageRole != jarvis.UsageRole_EndReviewer || run.TaskId != "" || run.Runtime != route.Runtime || run.Model != route.Model {
				t.Fatalf("the end reviewer is a stage session on the reviewer route %+v, got %+v", route, run)
			}
			var endCalls int
			for _, s := range *calls {
				if s.cwd != g.Final.Tree {
					t.Fatalf("every session works in the stage's tree %q, got %q", g.Final.Tree, s.cwd)
				}
				if s.opts.Label == endReviewerLabel {
					endCalls++
				}
			}
			wantVerifier := !c.finalCmd
			if endCalls != 1 || (g.Final.VerifierRunID != "") != wantVerifier {
				t.Fatalf("one end reviewer, and a verifier alongside only without a Final command, got %d end reviewers and verifier %q", endCalls, g.Final.VerifierRunID)
			}
		})
	}
}

// a dag with no Check, Verify or Final command has nothing to run: its stage starts the end review in the same tick
func TestTheEndReviewerStartsAtOnceWithNoCommands(t *testing.T) {
	useVerifier(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	f := fastTrackFixture(t, "", "", "")

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}

	g := f.dag(t)
	if g.Final.State != FinalState_Verifying || g.Final.EndReview == nil || g.Final.EndReview.RunID == "" || g.Final.VerifierRunID == "" {
		t.Fatalf("with no commands the verifier and the end reviewer start at once, got %+v", g.Final)
	}
	var endCalls int
	for _, s := range *calls {
		if s.opts.Label == endReviewerLabel {
			endCalls++
		}
	}
	if endCalls != 1 || len(*calls) != 2 {
		t.Fatalf("one end reviewer beside one verifier, got %d end reviewers among %d spawns", endCalls, len(*calls))
	}
}

func TestACheckFailureWaitsForTheEndReview(t *testing.T) {
	useVerifier(t)
	captureSpawns(t)
	lead := newFakeLead(t)
	wait, open := gate(t)
	failing := wait + "; echo 'broke: x.go:3'; exit 1"
	f := fastTrackFixture(t, passVerify, failing, "")
	await := awaitFinal(t)
	awaitEndReviewer(t, f)
	g := awaitVerifierAlongside(t, f)
	verifierID, endID, tree := g.Final.VerifierRunID, g.Final.EndReview.RunID, g.Final.Tree

	open()
	await()

	g = f.dag(t)
	if finalTerminal(g.Final.State) || g.Status != DagStatus_Finalizing || !g.Final.EndReview.Waiting {
		t.Fatalf("the stage waits for the end review, got %s / %s %+v", g.Final.State, g.Status, g.Final.EndReview)
	}
	if got := runStatus(t, f, verifierID); got != jarvis.RunStatus_Cancelled {
		t.Fatalf("the verifier alongside is stopped, its run is %s", got)
	}
	if got := runStatus(t, f, endID); got == jarvis.RunStatus_Cancelled {
		t.Fatalf("the end reviewer keeps working, its run is %s", got)
	}
	if len(lead.sends) != 0 {
		t.Fatalf("the lead hears nothing until the stage ends, got %q", lead.sends)
	}
	if _, err := os.Stat(tree); err != nil {
		t.Fatalf("the end reviewer reads the tree, so the stage keeps it while it waits: %v", err)
	}

	if err := RecordFinalVerdict(f.ctx, f.dagID, endID, ReviewVerdict_Fail, "the count is off by one in x.go", ""); err != nil {
		t.Fatal(err)
	}

	g = f.dag(t)
	wantHead, wantTail := "Check `"+failing+"` failed (exit 1):\n", "broke: x.go:3\n\n[End review] the count is off by one in x.go"
	if g.Final.State != FinalState_Failed || !strings.HasPrefix(g.Final.Detail, wantHead) || !strings.HasSuffix(g.Final.Detail, wantTail) {
		t.Fatalf("the stage fails with the command's Detail, then the end review's, got %s %q", g.Final.State, g.Final.Detail)
	}
	if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], g.Final.Detail) {
		t.Fatalf("the lead is woken once with every detail, got %q", lead.sends)
	}
	if _, err := os.Stat(tree); !os.IsNotExist(err) {
		t.Fatalf("the tree is released once the end review settled the stage, stat err %v", err)
	}
}

func TestEndReviewVerdictsOnPassingCommands(t *testing.T) {
	cases := []struct {
		name, verdict, unverified string
		wantState                 string
		wantUnverified            []string
	}{
		{"fail", ReviewVerdict_Fail, "", FinalState_Failed, nil},
		{"pass", ReviewVerdict_Pass, "", FinalState_Passed, nil},
		{"pass unverified", ReviewVerdict_Pass, "the empty state", FinalState_Unverified, []string{"end review: the empty state"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			useVerifier(t)
			captureSpawns(t)
			lead := newFakeLead(t)
			f := fastTrackFixture(t, passVerify, "", "")
			g := runFinal(t, f)
			if g.Final.State != FinalState_Verifying || g.Final.EndReview == nil || g.Final.EndReview.RunID == "" {
				t.Fatalf("passing commands leave the verifier and the end reviewer at work, got %+v", g.Final)
			}
			verifierID, endID, tree := g.Final.VerifierRunID, g.Final.EndReview.RunID, g.Final.Tree
			if err := RecordFinalVerdict(f.ctx, f.dagID, verifierID, ReviewVerdict_Pass, "does what the spec asks", ""); err != nil {
				t.Fatal(err)
			}
			if g := f.dag(t); finalTerminal(g.Final.State) || !g.Final.EndReview.Waiting || !g.Final.EndReview.Judged {
				t.Fatalf("the verifier's pass waits for the end review, got %s %+v", g.Final.State, g.Final.EndReview)
			}
			if _, err := os.Stat(tree); err != nil {
				t.Fatalf("the stage keeps its tree for the end reviewer: %v", err)
			}
			if err := RecordFinalVerdict(f.ctx, f.dagID, verifierID, ReviewVerdict_Pass, "again", ""); err == nil {
				t.Fatal("a verifier's verdict on a stage that waits for its end review must be refused")
			}

			const findings = "the retry loop never ends: retry.go:40, cap it"
			text := "reads well"
			if c.verdict == ReviewVerdict_Fail {
				text = findings
			}
			if err := RecordFinalVerdict(f.ctx, f.dagID, endID, c.verdict, text, c.unverified); err != nil {
				t.Fatal(err)
			}

			g = f.dag(t)
			if g.Final.State != c.wantState || !slices.Equal(g.Final.Unverified, c.wantUnverified) {
				t.Fatalf("want %s with %q, got %s with %q", c.wantState, c.wantUnverified, g.Final.State, g.Final.Unverified)
			}
			if c.verdict == ReviewVerdict_Fail && (len(lead.sends) != 1 || !strings.Contains(lead.sends[0], "[End review] "+findings)) {
				t.Fatalf("the failed wake carries the findings, got %q", lead.sends)
			}
			if got, want := endReviewSteps(lead), []string{fmt.Sprintf("1 %v", c.verdict == ReviewVerdict_Pass)}; !slices.Equal(got, want) {
				t.Fatalf("the end review's settling is one final-step event: want %v, got %v", want, got)
			}
			if err := RecordFinalVerdict(f.ctx, f.dagID, endID, ReviewVerdict_Pass, "again", ""); err == nil {
				t.Fatal("a second end review verdict must be refused")
			}
			if !queuedSession(endID) {
				t.Fatal("the end reviewer's session ends with its verdict but its process does not: it must be queued")
			}
			if _, err := os.Stat(tree); !os.IsNotExist(err) {
				t.Fatalf("the tree is released once the end review settled the stage, stat err %v", err)
			}
		})
	}
}

func TestAnEndReviewVerdictBeforeTheCommandsFinishIsKept(t *testing.T) {
	calls := captureSpawns(t)
	newFakeLead(t)
	wait, open := gate(t)
	f := fastTrackFixture(t, wait, "", "")
	await := awaitFinal(t)
	g := awaitEndReviewer(t, f)
	endID := g.Final.EndReview.RunID

	if err := RecordFinalVerdict(f.ctx, f.dagID, endID, ReviewVerdict_Pass, "reads well", "the empty state"); err != nil {
		t.Fatal(err)
	}
	// its session ends with the verdict; the tick must not take that for a lost reviewer
	endRun(t, f.ctx, f.channel, endID)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	g = f.dag(t)
	if g.Final.State != FinalState_Checking || g.Final.EndReview.State != EndReviewState_Passed || g.Final.EndReview.Unverified != "the empty state" || len(*calls) != 1 {
		t.Fatalf("the verdict is stored while the commands run, got %s %+v after %d spawns", g.Final.State, g.Final.EndReview, len(*calls))
	}

	open()
	await()

	g = f.dag(t)
	if g.Final.State != FinalState_Unverified || !slices.Equal(g.Final.Unverified, []string{"end review: the empty state"}) {
		t.Fatalf("the stage settles on the stored verdict, got %s %q", g.Final.State, g.Final.Unverified)
	}
}

// a restart loses the commands and a held verifier verdict, but not the end review's, which is on the stage
func TestARestartedStageKeepsTheEndReviewsVerdict(t *testing.T) {
	useVerifier(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	f := fastTrackFixture(t, passVerify, "", "")
	owner, err := wstore.GetRun(f.ctx, f.channel, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	tree, _, err := finalTree(f.ctx, f.dag(t), owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Final = &waveobj.FinalStage{State: FinalState_Checking, Round: 1, OutDir: finalOutDir(f.dagID, 1), StartedTs: time.Now().UnixMilli(),
			Tree: tree, Commit: gitCmd(t, tree, "rev-parse", "HEAD"), VerifierRunID: "verifier-before-restart",
			EndReview: &waveobj.FinalEndReview{State: EndReviewState_Failed, RunID: "end-before-restart", Text: "x.go:3 is wrong"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	g := runFinal(t, f)
	if g.Final.State != FinalState_Verifying || len(*calls) != 0 {
		t.Fatalf("the commands pass and nothing new starts, got %s after %d spawns", g.Final.State, len(*calls))
	}
	if err := RecordFinalVerdict(f.ctx, f.dagID, "verifier-before-restart", ReviewVerdict_Pass, "fine", ""); err != nil {
		t.Fatal(err)
	}
	if g := f.dag(t); g.Final.State != FinalState_Failed || g.Final.Detail != "[End review] x.go:3 is wrong" {
		t.Fatalf("the end review's stored fail decides the stage, got %s %q", g.Final.State, g.Final.Detail)
	}
}

func TestAnEndReviewerLostTwiceSettlesWithoutIt(t *testing.T) {
	captureSpawns(t)
	lead := newFakeLead(t)
	f := fastTrackFixture(t, passVerify, "", "")
	g := runFinal(t, f) // TestMain's skipVerifier passes the rest of the stage
	if g.Final.EndReview == nil || !g.Final.EndReview.Waiting || finalTerminal(g.Final.State) {
		t.Fatalf("the stage waits for the end review, got %s %+v", g.Final.State, g.Final.EndReview)
	}
	first := g.Final.EndReview.RunID
	endRun(t, f.ctx, f.channel, first)
	schedule(t, f.ctx, f.dagID)
	second := f.dag(t).Final.EndReview.RunID
	if second == "" || second == first {
		t.Fatalf("a lost end reviewer is replaced once, got %q after %q", second, first)
	}
	endRun(t, f.ctx, f.channel, second)
	schedule(t, f.ctx, f.dagID)

	g = f.dag(t)
	if g.Final.State != FinalState_Unverified || g.Status != DagStatus_Done || len(g.Final.Unverified) != 1 || !strings.HasPrefix(g.Final.Unverified[0], "the end review did not finish: ") {
		t.Fatalf("want done and unverified because the end review did not finish, got %s / %+v", g.Status, g.Final)
	}
	if got := endReviewSteps(lead); !slices.Equal(got, []string{"1 false"}) {
		t.Fatalf("a lost end review settles as a failed review step, got %v", got)
	}
	if _, err := os.Stat(g.Final.Tree); !os.IsNotExist(err) {
		t.Fatalf("the tree is released once the stage settled without its end review, stat err %v", err)
	}
}

func TestEndingTheStageStopsTheEndReviewerAndARerunStartsANewOne(t *testing.T) {
	captureSpawns(t)
	newFakeLead(t)
	wait, _ := gate(t)
	f := fastTrackFixture(t, wait, "", "")
	await := awaitFinal(t)
	first := awaitEndReviewer(t, f).Final.EndReview.RunID

	if err := EndFinalStage(f.ctx, f.dagID, FinalState_Failed, "Verify hangs"); err != nil {
		t.Fatal(err)
	}
	await()
	g := f.dag(t)
	if g.Final.State != FinalState_Failed || g.Final.Detail != "ended by the human: Verify hangs" {
		t.Fatalf("the human's end stands alone, got %s %q", g.Final.State, g.Final.Detail)
	}
	if got := runStatus(t, f, first); got != jarvis.RunStatus_Cancelled {
		t.Fatalf("the end reviewer is stopped, its run is %s", got)
	}
	if g.Final.EndReview.State != EndReviewState_Stopped {
		t.Fatalf("a stopped end review reads stopped, got %+v", g.Final.EndReview)
	}

	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Verify = passVerify
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := RerunFinalStage(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await = awaitFinal(t)
	g = awaitEndReviewer(t, f)
	await()
	if g.Final.EndReview.RunID == first || g.Final.EndReview.State != EndReviewState_Reviewing {
		t.Fatalf("the rerun starts a fresh end review, got %+v after %q", g.Final.EndReview, first)
	}
}

// the human's end overrides a verdict the end review gave already: it is not joined to the Detail
func TestEndingTheStageOverridesAnEndReviewVerdictAlreadyGiven(t *testing.T) {
	captureSpawns(t)
	newFakeLead(t)
	wait, _ := gate(t)
	f := fastTrackFixture(t, wait, "", "")
	await := awaitFinal(t)
	endID := awaitEndReviewer(t, f).Final.EndReview.RunID
	if err := RecordFinalVerdict(f.ctx, f.dagID, endID, ReviewVerdict_Fail, "x.go:3 is wrong", ""); err != nil {
		t.Fatal(err)
	}

	if err := EndFinalStage(f.ctx, f.dagID, FinalState_Failed, "Verify hangs"); err != nil {
		t.Fatal(err)
	}
	await()

	g := f.dag(t)
	if g.Final.State != FinalState_Failed || g.Final.Detail != "ended by the human: Verify hangs" || g.Final.EndReview.State != EndReviewState_Failed {
		t.Fatalf("the human's end stands alone and the stored verdict stays on the review, got %s %q %+v", g.Final.State, g.Final.Detail, g.Final.EndReview)
	}
}

func TestTheEndReviewBriefCarriesUnlistedPathsAndGoalposts(t *testing.T) {
	f := fastTrackFixture(t, passVerify, "", "")
	tree := f.project
	for _, p := range []string{"pkg/listed.go", "pkg/stray.go"} {
		if err := os.MkdirAll(filepath.Join(tree, "pkg"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(tree, p), []byte(p+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	gitCmd(t, tree, "add", ".")
	gitCmd(t, tree, "commit", "-m", "the lane's squash")
	sha := gitCmd(t, tree, "rev-parse", "HEAD")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].Description = "Do the thing.\n**Files:** `pkg/listed.go`"
		cur.Final = &waveobj.FinalStage{Round: 1, Tree: tree, Commit: sha}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	g := f.dag(t)
	report := structuredReport("Added it.", "Used a map, not a slice.", "The empty state.", "None", "None")
	if err := wstore.UpdateRun(f.ctx, f.channel, g.Tasks[0].RunID, func(r *waveobj.Run) error {
		r.Evidence = &waveobj.RunEvidence{Summary: report}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	appendRunEvent(f.ctx, f.channel, g.RunID, waveobj.RunEventKindTaskMerged, nil, map[string]any{"taskid": "t-0", "commit": sha})
	finding := wshrpc.GoalpostFinding{Rule: "test-skip", File: "pkg/listed_test.go", Title: "t.Skip added to TestCount"}
	appendRunEvent(f.ctx, f.channel, g.RunID, waveobj.RunEventKindTaskGoalpost, nil, map[string]any{"taskid": "t-0", "runid": g.Tasks[0].RunID, "findings": []wshrpc.GoalpostFinding{finding}})
	owner, err := wstore.GetRun(f.ctx, f.channel, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}

	prompt := endReviewPrompt(f.ctx, g, owner)

	for _, want := range []string{
		"You are the end reviewer for run " + g.RunID,
		"### t-0: first",
		"- pkg/stray.go",
		"Its worker's Differs from plan: Used a map, not a slice.",
		"Its worker's Not verified: The empty state.",
		goalpostLine(finding),
		"`wsh jarvis dag final pass \"<summary>\"`",
		"`wsh jarvis dag final fail \"<findings",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the brief must carry %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "- pkg/listed.go") {
		t.Errorf("a listed path is not called unlisted:\n%s", prompt)
	}
}

// a worker whose report predates the sections reaches the end reviewer whole, and one that reported nothing adds no line
func TestTheEndReviewBriefReadsAnUnstructuredReportWhole(t *testing.T) {
	f := fastTrackFixture(t, passVerify, "", "")
	g := f.dag(t)
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Final = &waveobj.FinalStage{Round: 1, Tree: f.project}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateRun(f.ctx, f.channel, g.Tasks[0].RunID, func(r *waveobj.Run) error {
		r.Evidence = &waveobj.RunEvidence{Summary: " Added fmtDate. \n"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	owner, err := wstore.GetRun(f.ctx, f.channel, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}

	prompt := endReviewPrompt(f.ctx, f.dag(t), owner)

	if !strings.Contains(prompt, "Its worker reported: Added fmtDate.") {
		t.Fatalf("an unstructured report reaches the reviewer whole:\n%s", prompt)
	}
}

// the lead's amendment after a light review is no decision of the human's, so the verifier must not be told it was
func TestTheVerifierBriefTellsAnAmendedPlanFromAnAccept(t *testing.T) {
	const finding = "Task 2 has no scenario step"
	brief := func(amended bool) string {
		g := &waveobj.TaskGroup{RunID: "run-1", FastTrack: true, Final: &waveobj.FinalStage{Round: 1, Tree: "/tree"},
			PlanReview: &waveobj.PlanReviewStage{State: PlanReviewState_Accepted, Round: 1, Findings: finding, Amended: amended}}
		return verifierPrompt(context.Background(), g, &waveobj.Run{})
	}
	accepted, amended := brief(false), brief(true)
	if accepted == amended || !strings.Contains(amended, finding) {
		t.Fatalf("an amended plan's brief carries the findings and differs from an accept's:\n%s", amended)
	}
	if !strings.Contains(amended, "the lead amended the plan") || strings.Contains(amended, "the human proceeded") {
		t.Fatalf("an amended plan reads as the lead's, not the human's:\n%s", amended)
	}
	if !strings.Contains(accepted, "the human proceeded") {
		t.Fatalf("an accept keeps the human's wording:\n%s", accepted)
	}
}

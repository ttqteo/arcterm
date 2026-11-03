// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestAHumanEndsAVerifyingStage(t *testing.T) {
	cases := []struct{ outcome, wantStatus string }{
		{FinalState_Unverified, DagStatus_Done},
		{FinalState_Failed, DagStatus_Blocked},
	}
	for _, c := range cases {
		t.Run(c.outcome, func(t *testing.T) {
			f, lead, verifierID := verifyingFixture(t)
			tree := f.dag(t).Final.Tree

			if err := EndFinalStage(f.ctx, f.dagID, c.outcome, "  the verifier's tools were rejected  "); err != nil {
				t.Fatal(err)
			}

			g := f.dag(t)
			want := "ended by the human: the verifier's tools were rejected"
			if g.Final.State != c.outcome || g.Status != c.wantStatus {
				t.Fatalf("want %s / %s, got %s / %s", c.outcome, c.wantStatus, g.Final.State, g.Status)
			}
			if c.outcome == FinalState_Failed {
				if g.Final.Detail != want || len(lead.sends) != 1 || !strings.Contains(lead.sends[0], want) {
					t.Fatalf("a failed end is the stage's Detail and wakes the lead with it, got %q / %q", g.Final.Detail, lead.sends)
				}
			} else if !slices.Contains(g.Final.Unverified, want) || g.Final.Detail != "" {
				t.Fatalf("an unverified end records the reason, got %+v", g.Final)
			}
			if g.Final.VerifierRunID != verifierID {
				t.Fatalf("the verifier stays on the stage for the usage totals, got %q", g.Final.VerifierRunID)
			}
			verifier, err := wstore.GetRun(f.ctx, f.channel, verifierID)
			if err != nil || verifier.Status != jarvis.RunStatus_Cancelled {
				t.Fatalf("the verifier's run is cancelled, got %+v / %v", verifier, err)
			}
			if err := RecordFinalVerdict(f.ctx, f.dagID, verifierID, ReviewVerdict_Pass, "late", ""); err == nil {
				t.Fatal("a verdict after the human ended the stage must be refused")
			}
			if got := f.dag(t).Final.State; got != c.outcome {
				t.Fatalf("the refused verdict changes nothing, got %s", got)
			}
			if _, err := os.Stat(tree); !os.IsNotExist(err) {
				t.Fatalf("the detached final tree is removed, stat err %v", err)
			}
		})
	}
}

func TestAHumanEndsARunningFinalCommand(t *testing.T) {
	f := finalFixture(t, passVerify, "", "sleep 30")
	await := awaitFinal(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for f.dag(t).Final.State != FinalState_Final {
		if time.Now().After(deadline) {
			t.Fatal("the Final command did not start")
		}
		time.Sleep(20 * time.Millisecond)
	}

	if err := EndFinalStage(f.ctx, f.dagID, FinalState_Unverified, "the dev app hangs on boot"); err != nil {
		t.Fatal(err)
	}
	await() // returns well before the sleep only if the end stopped the command

	g := f.dag(t)
	if g.Final.State != FinalState_Unverified || g.Status != DagStatus_Done || !slices.Contains(g.Final.Unverified, "ended by the human: the dev app hangs on boot") {
		t.Fatalf("the command's late result must not overwrite the human's end, got %s / %+v", g.Status, g.Final)
	}
}

func TestRefusedFinalStageEnds(t *testing.T) {
	f := finalFixture(t, passVerify, "", "")
	cases := []struct{ name, outcome, reason, want string }{
		{"not started", FinalState_Unverified, "r", "not started"},
		{"bad outcome", FinalState_Passed, "r", "must be unverified or failed"},
		{"blank reason", FinalState_Failed, "   ", "needs the human's reason"},
		{"long reason", FinalState_Failed, strings.Repeat("r", MaxReviewNoteLen+1), "the limit is 2000"},
	}
	for _, c := range cases {
		if err := EndFinalStage(f.ctx, f.dagID, c.outcome, c.reason); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: want an error with %q, got %v", c.name, c.want, err)
		}
	}
	g := runFinal(t, f) // TestMain's skipVerifier ends it passed
	if g.Final.State != FinalState_Passed {
		t.Fatalf("setup: want a passed stage, got %s", g.Final.State)
	}
	if err := EndFinalStage(f.ctx, f.dagID, FinalState_Failed, "r"); err == nil || !strings.Contains(err.Error(), "is passed") {
		t.Fatalf("a finished stage cannot be ended, got %v", err)
	}
}

// a Check that failed on something outside the code (docker down) runs again once the human fixed it, in the same
// round, and the lead woken to plan a fix round is told to drop it
func TestAHumanRerunsAFailedFinalStage(t *testing.T) {
	lead := newFakeLead(t)
	marker := filepath.ToSlash(filepath.Join(t.TempDir(), "docker-up"))
	f := finalFixture(t, passVerify, "test -f "+marker+" || { echo 'docker is not running'; exit 1; }", "")
	if g := runFinal(t, f); g.Final.State != FinalState_Failed || len(lead.sends) != 1 {
		t.Fatalf("setup: want a failed stage that woke the lead, got %s / %q", g.Final.State, lead.sends)
	}
	ackWake(lead)
	writeFile(t, marker, "")

	if err := RerunFinalStage(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}

	g := f.dag(t)
	if g.Final.Round != 1 || g.Final.State != "" || g.Final.Detail != "" || g.Status != DagStatus_Finalizing {
		t.Fatalf("the stage starts over in the same round, got %s / %+v", g.Status, g.Final)
	}
	if len(lead.sends) != 2 || !strings.Contains(lead.sends[1], "reran the final stage of round 1") || !strings.Contains(lead.sends[1], "Drop any fix plan") {
		t.Fatalf("the lead is told to drop its fix plan, got %q", lead.sends)
	}
	if g := runFinal(t, f); g.Final.State != FinalState_Passed || g.Final.Round != 1 || g.Status != DagStatus_Done {
		t.Fatalf("the rerun passes in round 1, got %s / %+v", g.Status, g.Final)
	}
}

// the same for a stage a kill stopped: it judged nothing, so the human's rerun is what the lead was waiting for
func TestAHumanRerunsAKilledFinalStage(t *testing.T) {
	lead := newFakeLead(t)
	f := finalFixture(t, passVerify, "", "node scripts/cdp/final-verify.mjs")
	killedNow := true
	stubPlanCommandOutput(t, func(_ context.Context, _, command string) (string, error) {
		if command == "node scripts/cdp/final-verify.mjs" && killedNow {
			return "scenario 2 of 5", &planCommandError{exitCode: 0xC000013A, killed: "exit 0xc000013a"}
		}
		return "", nil
	})
	if g := runFinal(t, f); g.Final.State != FinalState_Failed || !g.Final.Killed || len(lead.sends) != 1 {
		t.Fatalf("setup: want a killed stage that woke the lead, got %s killed=%v / %q", g.Final.State, g.Final.Killed, lead.sends)
	}
	ackWake(lead)
	killedNow = false

	if err := RerunFinalStage(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}

	if g := f.dag(t); g.Final.Killed || g.Final.State != "" || g.Final.Round != 1 {
		t.Fatalf("a rerun forgets the kill and stays in the round, got %+v", g.Final)
	}
	if g := runFinal(t, f); g.Final.State != FinalState_Passed || g.Final.Round != 1 || g.Status != DagStatus_Done {
		t.Fatalf("the rerun passes in round 1, got %s / %+v", g.Status, g.Final)
	}
}

// the lead completed after its last round failed; a rerun then wakes nobody, since nobody would read it
func TestARerunOfADoneRunWakesNobody(t *testing.T) {
	lead := newFakeLead(t)
	f := finalFixture(t, passVerify, "echo 'docker is not running'; exit 1", "")
	if g := runFinal(t, f); g.Final.State != FinalState_Failed || len(lead.sends) != 1 {
		t.Fatalf("setup: want a failed stage that woke the lead, got %s / %q", g.Final.State, lead.sends)
	}
	ackWake(lead)
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sent := len(lead.sends)

	if err := RerunFinalStage(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	runFinal(t, f)

	if len(lead.sends) != sent {
		t.Fatalf("a done run's lead gets no wake, got %q", lead.sends[sent:])
	}
}

func TestRefusedFinalStageReruns(t *testing.T) {
	f := finalFixture(t, passVerify, "", "")
	if err := RerunFinalStage(f.ctx, f.dagID); err == nil || !strings.Contains(err.Error(), "has not started") {
		t.Fatalf("a stage not started cannot be rerun, got %v", err)
	}
	runFinal(t, f) // TestMain's skipVerifier ends it passed
	if err := RerunFinalStage(f.ctx, f.dagID); err == nil || !strings.Contains(err.Error(), "is passed; only a failed one") {
		t.Fatalf("a passed stage cannot be rerun, got %v", err)
	}
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Status, cur.Final.State = DagStatus_Cancelled, FinalState_Failed
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := RerunFinalStage(f.ctx, f.dagID); err == nil || !strings.Contains(err.Error(), "is cancelled") {
		t.Fatalf("a cancelled run's stage cannot be rerun, got %v", err)
	}
}

// ackWake has the fake lead take its wake, working then idle, so the waker sends the next one
func ackWake(lead *fakeLead) {
	NoteLeadStatus(context.Background(), lead.status(baseds.AgentState_Working))
	NoteLeadStatus(context.Background(), lead.status(baseds.AgentState_Idle))
}

// a run that never had a lead gets none launched only to be told to drop a fix plan it never wrote
func TestARerunWakeLaunchesNoLead(t *testing.T) {
	if !nothingToLaunchFor([]string{finalRerunWake(1)}) {
		t.Fatal("the rerun wake alone must not launch a lead")
	}
	if nothingToLaunchFor([]string{finalRerunWake(1), finalFailedWake(1, "r", "Check failed", false, false)}) {
		t.Fatal("a failed stage beside it still launches one")
	}
	if nothingToLaunchFor([]string{finalRerunWake(1), finalKilledWake(1, "r", "Final killed", false)}) {
		t.Fatal("a killed stage beside it still launches one")
	}
}

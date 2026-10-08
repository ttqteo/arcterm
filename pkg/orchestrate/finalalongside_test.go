// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// gate is a shell command that waits until open is called, for at most 30 seconds, so a test can hold a final
// command running while it looks at the stage.
func gate(t *testing.T) (string, func()) {
	t.Helper()
	path := filepath.ToSlash(filepath.Join(t.TempDir(), "open"))
	cmd := fmt.Sprintf("i=0; while [ ! -f %s ] && [ $i -lt 300 ]; do sleep 0.1; i=$((i+1)); done", path)
	return cmd, func() {
		t.Helper()
		if err := os.WriteFile(path, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// awaitFinalState polls f's dag until its final stage is in state, and returns it.
func awaitFinalState(t *testing.T, f *mergeFixture, state string) *waveobj.TaskGroup {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		g := f.dag(t)
		if g.Final != nil && g.Final.State == state {
			return g
		}
		if time.Now().After(deadline) {
			t.Fatalf("the final stage did not reach %s, got %+v", state, g.Final)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// awaitVerifierAlongside starts f's final stage and polls until its verifier works while the commands still run.
func awaitVerifierAlongside(t *testing.T, f *mergeFixture) *waveobj.TaskGroup {
	t.Helper()
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		g := f.dag(t)
		if g.Final != nil && g.Final.VerifierRunID != "" {
			if g.Final.State != FinalState_Checking {
				t.Fatalf("the verifier must start while the commands run, got %s", g.Final.State)
			}
			return g
		}
		if time.Now().After(deadline) {
			t.Fatalf("no verifier started, got %+v", g.Final)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func runStatus(t *testing.T, f *mergeFixture, runID string) string {
	t.Helper()
	r, err := wstore.GetRun(f.ctx, f.channel, runID)
	if err != nil {
		t.Fatal(err)
	}
	return r.Status
}

func TestTheVerifierStartsWhileCheckAndVerifyRun(t *testing.T) {
	useVerifier(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	wait, open := gate(t)
	f := finalFixture(t, wait, "true", "")
	await := awaitFinal(t)

	g := awaitVerifierAlongside(t, f)

	if len(*calls) != 1 || (*calls)[0].cwd != g.Final.Tree || g.Final.Tree != worktreeDir(f.project, f.ownerID+"-final") {
		t.Fatalf("one verifier works in the stage's detached tree, got %d spawns, tree %q", len(*calls), g.Final.Tree)
	}
	prompt := (*calls)[0].prompt
	if want := "While you work, the engine runs Check `true` and Verify `" + wait + "` on `" + shortSha(g.Final.Commit) + "`; if one fails, the stage fails whatever your verdict. Do not run them yourself."; !strings.Contains(prompt, want) {
		t.Fatalf("the brief must say the commands run alongside, want %q in:\n%s", want, prompt)
	}
	if strings.Contains(prompt, "and they passed") {
		t.Fatalf("the brief must not claim running commands passed:\n%s", prompt)
	}
	verifierID, tree := g.Final.VerifierRunID, g.Final.Tree

	open()
	await()

	g = f.dag(t)
	if g.Final.State != FinalState_Verifying || g.Final.VerifierRunID != verifierID || len(*calls) != 1 || g.Final.Tree != tree {
		t.Fatalf("once the commands pass the same verifier judges on, got %s %q after %d spawns", g.Final.State, g.Final.VerifierRunID, len(*calls))
	}
	if err := RecordFinalVerdict(f.ctx, f.dagID, verifierID, ReviewVerdict_Pass, "does what the spec asks", ""); err != nil {
		t.Fatal(err)
	}
	if !queuedSession(verifierID) {
		t.Fatal("the verifier's session ends with its verdict but its process does not: it must be queued")
	}
	if g := f.dag(t); g.Final.State != FinalState_Passed || g.Status != DagStatus_Done {
		t.Fatalf("the verdict ends the stage, got %s / %s", g.Final.State, g.Status)
	}
	if _, err := os.Stat(tree); !os.IsNotExist(err) {
		t.Fatalf("the tree is released once both are done, stat err %v", err)
	}
}

func TestACommandFailureFailsTheStageWhateverTheVerifierSaid(t *testing.T) {
	cases := []struct {
		name, failing, verdict string
	}{
		{"Check fails while the verifier works", "Check", ""},
		{"Check fails after the verifier failed it", "Check", ReviewVerdict_Fail},
		{"Verify fails while the verifier works", "Verify", ""},
		{"Verify fails after the verifier passed it", "Verify", ReviewVerdict_Pass},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			useVerifier(t)
			captureSpawns(t)
			lead := newFakeLead(t)
			wait, open := gate(t)
			failing := wait + "; echo 'broke: x.go:3'; exit 1"
			check, verify, wantDetail := "", failing, "Verify `"+failing+"` failed on the merged result (exit 1):\n"
			if c.failing == "Check" {
				check, verify, wantDetail = failing, passVerify, "Check `"+failing+"` failed (exit 1):\n"
			}
			f := finalFixture(t, verify, check, "")
			await := awaitFinal(t)
			g := awaitVerifierAlongside(t, f)
			verifierID, tree := g.Final.VerifierRunID, g.Final.Tree
			if c.verdict != "" {
				if err := RecordFinalVerdict(f.ctx, f.dagID, verifierID, c.verdict, "the verifier's say", ""); err != nil {
					t.Fatal(err)
				}
			}

			open()
			await()

			g = f.dag(t)
			if g.Final.State != FinalState_Failed || g.Status != DagStatus_Blocked || !strings.HasPrefix(g.Final.Detail, wantDetail) || !strings.Contains(g.Final.Detail, "broke: x.go:3") {
				t.Fatalf("want failed with the command's Detail %q, got %s / %s %q", wantDetail, g.Final.State, g.Status, g.Final.Detail)
			}
			if len(g.Final.Unverified) != 0 {
				t.Fatalf("the verifier's say is ignored, got unverified %q", g.Final.Unverified)
			}
			if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], g.Final.Detail) {
				t.Fatalf("the lead is woken with the command's Detail, got %q", lead.sends)
			}
			if c.verdict == "" {
				if got := runStatus(t, f, verifierID); got != jarvis.RunStatus_Cancelled {
					t.Fatalf("a verifier still working is stopped, its run is %s", got)
				}
			}
			if _, err := os.Stat(tree); !os.IsNotExist(err) {
				t.Fatalf("the tree is released, stat err %v", err)
			}
			if err := RecordFinalVerdict(f.ctx, f.dagID, verifierID, ReviewVerdict_Pass, "late", ""); err == nil {
				t.Fatal("a verdict after the stage failed must be refused")
			}
		})
	}
}

func TestAVerdictBeforeTheCommandsFinishWaitsForThem(t *testing.T) {
	useVerifier(t)
	calls := captureSpawns(t)
	lead := newFakeLead(t)
	wait, open := gate(t)
	f := finalFixture(t, wait, "", "")
	await := awaitFinal(t)
	g := awaitVerifierAlongside(t, f)
	verifierID, tree := g.Final.VerifierRunID, g.Final.Tree

	if err := RecordFinalVerdict(f.ctx, f.dagID, verifierID, ReviewVerdict_Pass, "does what the spec asks", ""); err != nil {
		t.Fatal(err)
	}
	// its session ends with the verdict; the tick must not take that for a lost verifier
	endRun(t, f.ctx, f.channel, verifierID)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}

	g = f.dag(t)
	if g.Final.State != FinalState_Checking || g.Status != DagStatus_Finalizing || len(*calls) != 1 {
		t.Fatalf("the verdict waits for the commands, got %s / %s after %d spawns", g.Final.State, g.Status, len(*calls))
	}
	if _, err := os.Stat(tree); err != nil {
		t.Fatalf("the tree stays while the commands run: %v", err)
	}
	if err := RecordFinalVerdict(f.ctx, f.dagID, verifierID, ReviewVerdict_Fail, "second thoughts", ""); err == nil || !strings.Contains(err.Error(), "already gave its verdict") {
		t.Fatalf("a second verdict is refused, got %v", err)
	}

	open()
	await()

	g = f.dag(t)
	if g.Final.State != FinalState_Passed || g.Status != DagStatus_Done || g.Final.Detail != "" {
		t.Fatalf("the commands passed, so the waiting pass ends the stage, got %s / %s %q", g.Final.State, g.Status, g.Final.Detail)
	}
	if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], "The final stage passed") {
		t.Fatalf("the lead hears the run finished, got %q", lead.sends)
	}
	if _, err := os.Stat(tree); !os.IsNotExist(err) {
		t.Fatalf("the tree is released, stat err %v", err)
	}
}

func TestAVerdictThatWaitedKeepsTheFinalVerifysFlakyTests(t *testing.T) {
	useVerifier(t)
	captureSpawns(t)
	newFakeLead(t)
	wait, open := gate(t)
	f := finalFixture(t, wait+`; printf 'pkg/y TestSlow\n' >> "$`+verifyFlakyEnv+`"`, "", "")
	await := awaitFinal(t)
	g := awaitVerifierAlongside(t, f)
	if err := RecordFinalVerdict(f.ctx, f.dagID, g.Final.VerifierRunID, ReviewVerdict_Pass, "fine", "no screenshot of the empty state"); err != nil {
		t.Fatal(err)
	}

	open()
	await()

	g = f.dag(t)
	want := []string{flakyItem("pkg/y TestSlow", finalVerifyWhere), "verifier: no screenshot of the empty state"}
	if g.Final.State != FinalState_Unverified || !reflect.DeepEqual(g.Final.Unverified, want) {
		t.Fatalf("want unverified with %q, got %s %q", want, g.Final.State, g.Final.Unverified)
	}
}

func TestAPlanWithAFinalCommandStartsTheVerifierAfterIt(t *testing.T) {
	useVerifier(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	wait, open := gate(t)
	f := finalFixture(t, passVerify, "true", wait+"; echo shot")
	await := awaitFinal(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}

	g := awaitFinalState(t, f, FinalState_Final)
	if len(*calls) != 0 || g.Final.VerifierRunID != "" {
		t.Fatalf("no verifier works before the Final command is done, got %d spawns, %q", len(*calls), g.Final.VerifierRunID)
	}

	open()
	await()

	g = f.dag(t)
	if g.Final.State != FinalState_Verifying || len(*calls) != 1 {
		t.Fatalf("the verifier starts after the Final command, got %s after %d spawns", g.Final.State, len(*calls))
	}
	if !strings.Contains((*calls)[0].prompt, "Before you started, the engine ran Check `true`, Verify `true` and Final `") {
		t.Fatalf("the brief says the commands ran:\n%s", (*calls)[0].prompt)
	}
}

func TestStoppingAStageMidwayStopsTheCommandsAndTheVerifier(t *testing.T) {
	cases := []struct {
		name string
		stop func(f *mergeFixture) error
		want func(t *testing.T, g *waveobj.TaskGroup)
	}{
		{"cancel", func(f *mergeFixture) error { return Cancel(f.ctx, f.dagID) }, func(t *testing.T, g *waveobj.TaskGroup) {
			if g.Status != DagStatus_Cancelled || g.Final.State != FinalState_Checking {
				t.Fatalf("a cancelled dag records no final result, got %s / %s", g.Status, g.Final.State)
			}
		}},
		{"the human's end", func(f *mergeFixture) error {
			return EndFinalStage(f.ctx, f.dagID, FinalState_Unverified, "Verify hangs")
		}, func(t *testing.T, g *waveobj.TaskGroup) {
			if g.Final.State != FinalState_Unverified || g.Status != DagStatus_Done || !reflect.DeepEqual(g.Final.Unverified, []string{"ended by the human: Verify hangs"}) {
				t.Fatalf("the human's end stands, got %s / %+v", g.Status, g.Final)
			}
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			useVerifier(t)
			captureSpawns(t)
			newFakeLead(t)
			wait, _ := gate(t)
			f := finalFixture(t, wait, "", "")
			await := awaitFinal(t)
			g := awaitVerifierAlongside(t, f)
			verifierID, tree := g.Final.VerifierRunID, g.Final.Tree

			start := time.Now()
			if err := c.stop(f); err != nil {
				t.Fatal(err)
			}
			await()

			if took := time.Since(start); took > 20*time.Second {
				t.Fatalf("stopping must end the running Verify, took %s", took)
			}
			c.want(t, f.dag(t))
			if got := runStatus(t, f, verifierID); got != jarvis.RunStatus_Cancelled {
				t.Fatalf("the verifier is stopped, its run is %s", got)
			}
			if _, err := os.Stat(tree); !os.IsNotExist(err) {
				t.Fatalf("the tree is released, stat err %v", err)
			}
		})
	}
}

// a restart loses the commands but not the stage: the next tick runs them again in the tree the verifier reads
func TestARestartedStageRunsItsCommandsInTheVerifiersTree(t *testing.T) {
	useVerifier(t)
	calls := captureSpawns(t)
	newFakeLead(t)
	f := finalFixture(t, passVerify, "", "")
	g := f.dag(t)
	owner, err := wstore.GetRun(f.ctx, f.channel, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	tree, _, err := finalTree(f.ctx, g, owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Final = &waveobj.FinalStage{State: FinalState_Checking, Round: 1, OutDir: finalOutDir(f.dagID, 1), StartedTs: time.Now().UnixMilli(),
			Tree: tree, Commit: gitCmd(t, tree, "rev-parse", "HEAD"), VerifierRunID: "verifier-before-restart"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	g = runFinal(t, f)

	if g.Final.State != FinalState_Verifying || g.Final.Tree != tree || len(*calls) != 0 {
		t.Fatalf("the commands pass in the recorded tree and no second verifier starts, got %s %q after %d spawns", g.Final.State, g.Final.Tree, len(*calls))
	}
	if _, err := os.Stat(tree); err != nil {
		t.Fatalf("the tree stays for the verifier: %v", err)
	}
	if err := RecordFinalVerdict(f.ctx, f.dagID, "verifier-before-restart", ReviewVerdict_Pass, "fine", ""); err != nil {
		t.Fatal(err)
	}
	if g := f.dag(t); g.Final.State != FinalState_Passed {
		t.Fatalf("the verdict ends the stage, got %s", g.Final.State)
	}
	if _, err := os.Stat(tree); !os.IsNotExist(err) {
		t.Fatalf("the tree is released once, at the end, stat err %v", err)
	}
}

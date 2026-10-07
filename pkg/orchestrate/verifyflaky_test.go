// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// stubFlakyVerify is a Verify that passes, writing report to its flaky file when it runs in dir.
func stubFlakyVerify(t *testing.T, dir, report string) {
	t.Helper()
	orig := runPlanCommand
	runPlanCommand = func(_ context.Context, cmdDir, _ string, env []string, _ time.Duration, _ planProgress) (string, error) {
		if filepath.Clean(cmdDir) != filepath.Clean(dir) || report == "" {
			return "ok", nil
		}
		for _, kv := range env {
			if path, ok := strings.CutPrefix(kv, verifyFlakyEnv+"="); ok {
				return "ok", os.WriteFile(path, []byte(report), 0o644)
			}
		}
		return "", fmt.Errorf("no %s in the Verify's environment", verifyFlakyEnv)
	}
	restoreAfterStages(t, func() { runPlanCommand = orig })
}

func TestAMergeVerifysFlakyTestsReachTheUnverifiedItemsAndTheLead(t *testing.T) {
	item := flakyItem("pkg/x TestRace", "in the Verify after merging t-0")
	cases := []struct {
		name, report string
		want         []string
		state        string
	}{
		{"flaky", "pkg/x TestRace\n", []string{item}, FinalState_Unverified},
		{"clean", "", nil, FinalState_Passed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			lead := newFakeLead(t)
			f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, stillOpen})
			f.setPlanCommands(t, verifyCmd, "")
			f.finish(t, "t-0")
			stubMerge(t, landedSha)
			// only the merge Verify runs in the checkout; the final stage's runs in its own tree
			stubFlakyVerify(t, f.projectPath(t), c.report)
			await := awaitVerify(t)
			finalDone := awaitFinal(t)

			if err := Schedule(f.ctx, f.dagID); err != nil {
				t.Fatal(err)
			}
			await()
			// the last merge runs no Verify of its own, and the final stage follows it
			f.finish(t, stillOpen.ID)
			if err := Schedule(f.ctx, f.dagID); err != nil {
				t.Fatal(err)
			}
			finalDone()

			g := f.dag(t)
			if g.Tasks[0].State != TaskState_Done || g.Tasks[0].VerifyError != "" {
				t.Fatalf("a Verify that reported flaky tests still passes, got %s %q", g.Tasks[0].State, g.Tasks[0].VerifyError)
			}
			if g.Final.State != c.state || !reflect.DeepEqual(g.Final.Unverified, c.want) {
				t.Fatalf("want %s with %q, got %s %q", c.state, c.want, g.Final.State, g.Final.Unverified)
			}
			if len(lead.sends) != 1 {
				t.Fatalf("want one run-finished wake, got %q", lead.sends)
			}
			if got := strings.Contains(lead.sends[0], item); got != (c.report != "") {
				t.Fatalf("the lead's wake names the flaky test only when one was reported, got %q", lead.sends[0])
			}
		})
	}
}

func TestTheFinalStageVerifysFlakyTestsAreUnverified(t *testing.T) {
	lead := newFakeLead(t)
	f := finalFixture(t, `printf 'pkg/y TestSlow\n\npkg/y TestSlow\r\n' >> "$`+verifyFlakyEnv+`"`, "", "")

	g := runFinal(t, f)

	want := []string{flakyItem("pkg/y TestSlow", finalVerifyWhere)}
	if g.Final.State != FinalState_Unverified || !reflect.DeepEqual(g.Final.Unverified, want) || g.Final.Detail != "" {
		t.Fatalf("want unverified with %q, got %s %q %q", want, g.Final.State, g.Final.Unverified, g.Final.Detail)
	}
	if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], want[0]) {
		t.Fatalf("the lead's wake names the flaky test, got %q", lead.sends)
	}
}

func TestAFailedVerifysFlakyReportIsNotRead(t *testing.T) {
	out, flaky, err := runVerifyCommand(context.Background(), t.TempDir(), `echo pkg/x TestA >> "$`+verifyFlakyEnv+`"; exit 1`, nil, nil)
	if err == nil || flaky != nil {
		t.Fatalf("a failed Verify stays a failure with no flaky report, got %v %q (output %q)", err, flaky, out)
	}
}

func TestFlakyReportParsing(t *testing.T) {
	if got := parseFlakyReport(""); got != nil {
		t.Fatalf("an empty report names nothing, got %q", got)
	}
	if got, want := parseFlakyReport("  a  TestX \r\n\nb\na TestX\n"), []string{"a TestX", "b"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("want %q, got %q", want, got)
	}
	var lines []string
	for i := range maxFlakyReported + 3 {
		lines = append(lines, fmt.Sprintf("Test%d", i))
	}
	got := parseFlakyReport(strings.Join(lines, "\n"))
	if len(got) != maxFlakyReported+1 || got[maxFlakyReported] != "3 more tests" || !slices.Equal(got[:maxFlakyReported], lines[:maxFlakyReported]) {
		t.Fatalf("a long report keeps the first %d and counts the rest, got %q", maxFlakyReported, got)
	}
}

// a batch's tips each keep the one Verify's output, so its flaky test is one item, not one per tip
func TestFinishFinalNamesABatchsFlakyTestOnce(t *testing.T) {
	g := mustGroup(t, []waveobj.TaskNode{{ID: "t-0", Label: "a"}, {ID: "t-1", Label: "b"}})
	g.Verify = verifyCmd
	kept := withFlakyItems("ok\n", []string{"pkg/x TestRace"}, afterMerging([]string{"t-0", "t-1"}))
	for i := range g.Tasks {
		g.Tasks[i].State, g.Tasks[i].VerifyOutput = TaskState_Done, kept
	}
	g.Final = &waveobj.FinalStage{State: FinalState_Verifying, Round: 1}
	var afterCommit []func()

	finishFinal(context.Background(), g, false, &afterCommit)

	want := []string{flakyItem("pkg/x TestRace", "in the Verify after merging t-0, t-1")}
	if g.Final.State != FinalState_Unverified || !reflect.DeepEqual(g.Final.Unverified, want) {
		t.Fatalf("want unverified with %q, got %s %q", want, g.Final.State, g.Final.Unverified)
	}
}

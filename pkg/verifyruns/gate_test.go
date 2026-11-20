// pkg/verifyruns/gate_test.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package verifyruns

import "testing"

func TestGateReasonParts(t *testing.T) {
	tests := []struct {
		name  string
		state State
		want  string
	}{
		{"failed lists the failed step numbers", State{Verdict: "red", Rows: []Row{
			{Scenario: "chat-council-card", State: "failed", Failed: []string{"7. a council started draws its card", "8. the card folds", "9. it reopens"}},
		}}, "Verify: chat-council-card failed steps 7, 8, 9. Merge anyway?"},
		{"one failed step reads in the singular", State{Verdict: "red", Rows: []Row{
			{Scenario: "a", State: "failed", Failed: []string{"12. only one"}},
		}}, "Verify: a failed step 12. Merge anyway?"},
		{"a failed step with no number is named without one", State{Verdict: "red", Rows: []Row{
			{Scenario: "a", State: "failed", Failed: []string{"the card"}},
		}}, "Verify: a failed. Merge anyway?"},
		{"only the numbered failed steps are listed", State{Verdict: "red", Rows: []Row{
			{Scenario: "a", State: "failed", Failed: []string{"3. x", "no number", "5. y"}},
		}}, "Verify: a failed steps 3, 5. Merge anyway?"},
		{"no result", State{Verdict: "amber", Rows: []Row{
			{Scenario: "rail-council-tab", State: "noresult"},
		}}, "Verify: rail-council-tab has no result. Merge anyway?"},
		{"out of date names the file", State{Verdict: "amber", Rows: []Row{
			{Scenario: "agent-rail-tabs", State: "outofdate", ChangedFile: "frontend/agentrailtabs.tsx"},
		}}, "Verify: agent-rail-tabs passed before frontend/agentrailtabs.tsx changed. Merge anyway?"},
		{"not run", State{Verdict: "amber", NotRun: true},
			"Verify: UI files changed and no scenario ran. Merge anyway?"},
		{"parts join in row order with a semicolon, not run last", State{Verdict: "red", NotRun: true, Rows: []Row{
			{Scenario: "chat-council-card", State: "failed", Failed: []string{"7. a", "8. b", "9. c"}},
			{Scenario: "rail-council-tab", State: "noresult"},
			{Scenario: "agent-rail-tabs", State: "outofdate", ChangedFile: "a.tsx"},
			{Scenario: "fine", State: "passed"},
			{Scenario: "set-aside", State: "skipped"},
			{Scenario: "busy", State: "running"},
		}}, "Verify: chat-council-card failed steps 7, 8, 9; rail-council-tab has no result; agent-rail-tabs passed before a.tsx changed; UI files changed and no scenario ran. Merge anyway?"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ask, reason := Gate(tc.state, "main", "main", true)
			if !ask {
				t.Fatalf("Gate did not ask: %+v", tc.state)
			}
			if reason != tc.want {
				t.Errorf("reason =\n  %q\nwant\n  %q", reason, tc.want)
			}
		})
	}
}

func TestGateTheExampleFromTheSpec(t *testing.T) {
	st := State{Verdict: "red", Rows: []Row{
		{Scenario: "chat-council-card", State: "failed", Failed: []string{"7. x", "8. y", "9. z"}},
		{Scenario: "rail-council-tab", State: "noresult"},
	}}
	_, reason := Gate(st, "main", "main", true)
	want := "Verify: chat-council-card failed steps 7, 8, 9; rail-council-tab has no result. Merge anyway?"
	if reason != want {
		t.Errorf("reason = %q, want %q", reason, want)
	}
}

func TestGateAsksOnlyForAMergeIntoTheDefaultBranchWhileRedOrAmber(t *testing.T) {
	red := State{Verdict: "red", Rows: []Row{{Scenario: "a", State: "failed", Failed: []string{"1. x"}}}}
	amber := State{Verdict: "amber", Rows: []Row{{Scenario: "a", State: "noresult"}}}
	tests := []struct {
		name          string
		st            State
		branch, deflt string
		isMerge       bool
		wantAsk       bool
	}{
		{"red merge on the default branch", red, "main", "main", true, true},
		{"amber merge on the default branch", amber, "main", "main", true, true},
		{"red but on a feature branch", red, "feat/x", "main", true, false},
		{"red but not a merge", red, "main", "main", false, false},
		{"running", State{Verdict: "running", Rows: []Row{{Scenario: "a", State: "running"}}}, "main", "main", true, false},
		{"passed", State{Verdict: "passed", Rows: []Row{{Scenario: "a", State: "passed"}}}, "main", "main", true, false},
		{"no verdict", State{}, "main", "main", true, false},
		{"the not-run warning skipped", State{NotRun: true, NotRunSkipped: true}, "main", "main", true, false},
		{"unknown default branch", red, "main", "", true, false},
		{"detached head and unknown default", red, "", "", true, false},
		{"detached head", red, "", "main", true, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ask, reason := Gate(tc.st, tc.branch, tc.deflt, tc.isMerge)
			if ask != tc.wantAsk {
				t.Errorf("ask = %v, want %v (reason %q)", ask, tc.wantAsk, reason)
			}
			if !ask && reason != "" {
				t.Errorf("a gate that does not ask gave a reason: %q", reason)
			}
		})
	}
}

// A skipped row is already left out of the verdict by Derive; the gate must not name it either.
func TestGateLeavesSkippedRowsOut(t *testing.T) {
	bf := blockOf(endedRun("1", 1000, 2000, someFail, "set-aside"), endedRun("2", 1000, 2000, nil, "stopped"))
	bf.Skips = map[string]int64{"set-aside": 3000}
	st := Derive(bf, alivePid100, nil, "")
	ask, reason := Gate(st, "main", "main", true)
	if !ask || reason != "Verify: stopped has no result. Merge anyway?" {
		t.Errorf("ask = %v, reason = %q", ask, reason)
	}
	bf.Skips["stopped"] = 3000
	if ask, _ := Gate(Derive(bf, alivePid100, nil, ""), "main", "main", true); ask {
		t.Errorf("every red row is skipped, the gate still asks")
	}
}

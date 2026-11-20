// pkg/verifyruns/gate.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package verifyruns

import (
	"regexp"
	"strings"
)

var leadingStepNumber = regexp.MustCompile(`^\s*(\d+)\.`)

// Gate decides whether a `git merge` should ask the person first: only a merge, into the project's default
// branch, while the agent's Verify is red or amber. Derive has already left skipped rows (and a skipped
// not-run warning) out of the verdict, so a skip never asks. The reason names each thing that is wrong:
//
//	Verify: chat-council-card failed steps 7, 8, 9; rail-council-tab has no result. Merge anyway?
func Gate(st State, branch, defaultBranch string, isMerge bool) (ask bool, reason string) {
	if !isMerge || branch == "" || defaultBranch == "" || branch != defaultBranch {
		return false, ""
	}
	if st.Verdict != VerdictRed && st.Verdict != VerdictAmber {
		return false, ""
	}
	var parts []string
	for _, row := range st.Rows {
		switch row.State {
		case StateFailed:
			parts = append(parts, row.Scenario+" "+failedSteps(row.Failed))
		case StateNoResult:
			parts = append(parts, row.Scenario+" has no result")
		case StateOutOfDate:
			parts = append(parts, row.Scenario+" passed before "+row.ChangedFile+" changed")
		}
	}
	if st.NotRun && !st.NotRunSkipped {
		parts = append(parts, "UI files changed and no scenario ran")
	}
	if len(parts) == 0 {
		return false, ""
	}
	return true, "Verify: " + strings.Join(parts, "; ") + ". Merge anyway?"
}

// failedSteps words a failed row: the leading `N.` of each failed step text, e.g. "failed steps 7, 8, 9". A
// step with no number is left out of the list; none numbered at all reads just "failed".
func failedSteps(failed []string) string {
	var nums []string
	for _, text := range failed {
		if m := leadingStepNumber.FindStringSubmatch(text); m != nil {
			nums = append(nums, m[1])
		}
	}
	switch len(nums) {
	case 0:
		return "failed"
	case 1:
		return "failed step " + nums[0]
	}
	return "failed steps " + strings.Join(nums, ", ")
}

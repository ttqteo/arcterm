// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workflowscan

import (
	"strings"
	"testing"
)

func TestGoalNamesCommands(t *testing.T) {
	// a scan of another project: "arcterm" must come from arcProject, the repo of Arc's own prompts, not from the
	// scan's project
	g := Goal("siem", 14)
	if first, _, _ := strings.Cut(g, "\n"); first != "Workflow scan" {
		t.Errorf("first line = %q", first)
	}
	for _, want := range []string{
		"wsh workflow scan --window 14",
		"wsh workflow result",
		"wsh jarvis complete --commit",
		"wsh jarvis complete --report",
		"docs/deferred.md",
		"## Workflow scan: <pattern, one line> (declined YYYY-MM-DD)",
		"Verified runs at decline: N. Raise again only above N.",
		`{"verdicts":[{"id","verdict","note","file","where","fixproject","edit","declinedat"}]}`,
		"chore(workflow):",
		`"siem"`,
		`"arcterm"`,
	} {
		if !strings.Contains(g, want) {
			t.Errorf("goal lacks %q", want)
		}
	}
}

// the owner's picks are taken by the agent itself, so nothing in the goal may send it to a picks command or wait
// for a line that nothing types
func TestGoalAsksPicksItself(t *testing.T) {
	g := Goal("arcterm", 14)
	for _, want := range []string{
		"AskUserQuestion",
		"Apply",
		"Drop",
		"Other",
		"fixproject",
	} {
		if !strings.Contains(g, want) {
			t.Errorf("goal lacks %q", want)
		}
	}
	for _, never := range []string{
		"wsh workflow picks",
		"workflow-scan: the owner's picks",
		"Wait idle",
		"Do not poll",
		"waveterm",
	} {
		if strings.Contains(g, never) {
			t.Errorf("goal still holds %q", never)
		}
	}
}

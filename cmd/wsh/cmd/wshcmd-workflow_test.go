// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var workflowTestScan = &waveobj.WorkflowScan{
	WindowDays: 14, Runs: 41, Projects: 3, Candidates: 4, Kept: 1, Dropped: 2,
	Survivors: []waveobj.WorkflowScanPattern{{
		Id: "p1", Title: "Skipped red step filed under Differs", FixTarget: "pkg/orchestrate/engine.go · workerContract",
		Runs: 3, Days: 2,
		Projects: []waveobj.WorkflowScanProject{{Name: "siem", Runs: 2}, {Name: "arcterm", Runs: 1}},
		Quotes: []waveobj.WorkflowScanQuote{
			{RunId: "aaaaaaaa-1111", Project: "siem", Date: "2026-10-20", Text: "skipped the watch it fail first step"},
			{RunId: "bbbbbbbb-2222", Project: "arcterm", Date: "2026-10-21", Text: "did not run the tests to see them fail"},
		},
	}},
	UnderFloor: []waveobj.WorkflowScanPattern{{Title: "eslint lacks Node globals", FixTarget: "eslint.config.js · scripts", Runs: 2, Days: 1}},
}

func TestWorkflowPrintSurvivors(t *testing.T) {
	var buf bytes.Buffer
	printWorkflowScan(&buf, workflowTestScan)
	out := buf.String()
	for _, want := range []string{
		"41 runs", "3 projects", "14 days", "2 oldest runs dropped",
		"p1", "Skipped red step filed under Differs", "pkg/orchestrate/engine.go · workerContract",
		"3 runs over 2 days", "siem (2), arcterm (1)",
		"aaaaaaaa-1111", "skipped the watch it fail first step", "bbbbbbbb-2222",
		"under 3 runs", "eslint lacks Node globals", "eslint.config.js · scripts", "2 runs over 1 day",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("output lacks %q:\n%s", want, out)
		}
	}
	if strings.Index(out, "p1") > strings.Index(out, "under 3 runs") {
		t.Errorf("survivors must come before the under-floor rows:\n%s", out)
	}

	buf.Reset()
	printWorkflowScan(&buf, &waveobj.WorkflowScan{WindowDays: 14, Runs: 5, Projects: 1})
	if !strings.Contains(buf.String(), "no pattern reached 3 runs") {
		t.Errorf("an empty scan must say so:\n%s", buf.String())
	}
}

// the scan agent is told to run `wsh workflow scan` and `wsh workflow result`, and its owner's picks never
// leave it, so the command has no picks subcommand
func TestWorkflowCommandSubcommands(t *testing.T) {
	var names []string
	for _, c := range workflowCmd.Commands() {
		names = append(names, c.Name())
	}
	if len(names) != 2 || !(names[0] == "scan" && names[1] == "result" || names[0] == "result" && names[1] == "scan") {
		t.Fatalf("want exactly scan and result, got %v", names)
	}
	if workflowScanCmd.Flags().Lookup("window") == nil {
		t.Fatal("scan must take --window: the agent's goal passes it")
	}
}

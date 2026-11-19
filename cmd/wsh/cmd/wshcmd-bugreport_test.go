// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestBugReportSubcommandsRegistered(t *testing.T) {
	for _, want := range []string{"list", "done"} {
		if !hasSub(bugReportCmd, want) {
			t.Fatalf("`bugreport %s` subcommand is not registered", want)
		}
	}
	if !hasSub(rootCmd, "bugreport") {
		t.Fatalf("`bugreport` is not on the root command")
	}
	for _, name := range []string{"state", "json"} {
		if bugReportListCmd.Flags().Lookup(name) == nil {
			t.Fatalf("`bugreport list` is missing --%s", name)
		}
	}
	for _, name := range []string{"outcome", "run", "effort"} {
		if bugReportDoneCmd.Flags().Lookup(name) == nil {
			t.Fatalf("`bugreport done` is missing --%s", name)
		}
	}
}

func TestBugReportListTextEmpty(t *testing.T) {
	cases := []struct{ state, want string }{
		{"", "no waiting or handling bug reports"},
		{wshrpc.BugReportState_Waiting, "no waiting bug reports"},
		{wshrpc.BugReportState_Done, "no done bug reports"},
	}
	for _, c := range cases {
		got := bugReportListText(nil, c.state)
		if got != c.want {
			t.Fatalf("bugReportListText(nil, %q) = %q, want %q", c.state, got, c.want)
		}
		if got := bugReportListText([]wshrpc.BugReport{}, c.state); got != c.want {
			t.Fatalf("bugReportListText(empty, %q) = %q, want %q", c.state, got, c.want)
		}
	}
}

func TestBugReportListTextMultiLine(t *testing.T) {
	reports := []wshrpc.BugReport{{
		Id:    "20261119-153012",
		State: wshrpc.BugReportState_Waiting,
		Text:  "the footer jumps when I open Jarvis\nit happens only with two agents\nand a long log",
		Dir:   `C:\data\bugreports\20261119-153012`,
	}}
	got := bugReportListText(reports, "")
	want := "20261119-153012\twaiting\tthe footer jumps when I open Jarvis\t" + `C:\data\bugreports\20261119-153012`
	if got != want {
		t.Fatalf("bugReportListText =\n%q\nwant\n%q", got, want)
	}
	if strings.Contains(got, "two agents") || strings.Count(got, "\n") != 0 {
		t.Fatalf("a report must take one line and only its first line of text, got %q", got)
	}
}

func TestBugReportListTextOneLinePerReport(t *testing.T) {
	reports := []wshrpc.BugReport{
		{Id: "a", State: wshrpc.BugReportState_Waiting, Text: "\n\n  first real line  \nsecond", Dir: "/d/a"},
		{Id: "b", State: wshrpc.BugReportState_Handling, Text: "tab\tinside\r\nand a CR", Dir: "/d/b"},
		{Id: "c", State: wshrpc.BugReportState_Waiting, Text: "  \n ", Dir: "/d/c"},
	}
	lines := strings.Split(bugReportListText(reports, ""), "\n")
	want := []string{
		"a\twaiting\tfirst real line\t/d/a",
		"b\thandling\ttab inside\t/d/b",
		"c\twaiting\t(no text)\t/d/c",
	}
	if len(lines) != len(want) {
		t.Fatalf("got %d lines %q, want %d", len(lines), lines, len(want))
	}
	for i := range want {
		if lines[i] != want[i] {
			t.Fatalf("line %d = %q, want %q", i, lines[i], want[i])
		}
		if n := strings.Count(lines[i], "\t"); n != 3 {
			t.Fatalf("line %d has %d tabs, want 3 (id, state, text, folder): %q", i, n, lines[i])
		}
	}
}

func TestBugReportsForJSONIsAnEmptyArrayNotNull(t *testing.T) {
	raw, err := json.Marshal(bugReportsForJSON(nil))
	if err != nil || string(raw) != "[]" {
		t.Fatalf("no reports as JSON = %s, %v, want []", raw, err)
	}
	raw, err = json.Marshal(bugReportsForJSON([]wshrpc.BugReport{{Id: "a", State: wshrpc.BugReportState_Waiting}}))
	if err != nil || !strings.Contains(string(raw), `"id":"a"`) {
		t.Fatalf("a report as JSON = %s, %v", raw, err)
	}
}

func TestBugReportListState(t *testing.T) {
	for _, ok := range []string{"", "waiting", "handling", "done", " Handling "} {
		if _, err := bugReportListState(ok); err != nil {
			t.Fatalf("state %q refused: %v", ok, err)
		}
	}
	got, err := bugReportListState(" Handling ")
	if err != nil || got != wshrpc.BugReportState_Handling {
		t.Fatalf("bugReportListState(\" Handling \") = %q, %v", got, err)
	}
	_, err = bugReportListState("open")
	if err == nil {
		t.Fatalf("an unknown state must be refused")
	}
	for _, name := range []string{`"open"`, "waiting", "handling", "done"} {
		if !strings.Contains(err.Error(), name) {
			t.Fatalf("the error must name %s, got %v", name, err)
		}
	}
}

func TestBugReportDoneData(t *testing.T) {
	got, err := bugReportDoneData([]string{" 20261119-153012 "}, "  fixed in run abc  ", " abc ", " oid-1 ")
	if err != nil {
		t.Fatal(err)
	}
	want := wshrpc.CommandBugReportDoneData{
		Id:      "20261119-153012",
		Outcome: wshrpc.BugReportOutcome{Text: "fixed in run abc", RunId: "abc", EffortOID: "oid-1"},
	}
	if got != want {
		t.Fatalf("bugReportDoneData = %+v, want %+v", got, want)
	}
	plain, err := bugReportDoneData([]string{"x"}, "answered the question", "", "")
	if err != nil || plain.Outcome.RunId != "" || plain.Outcome.EffortOID != "" {
		t.Fatalf("--run and --effort are optional: %+v, %v", plain, err)
	}
}

func TestBugReportDoneWithoutId(t *testing.T) {
	_, err := bugReportDoneData(nil, "fixed", "", "")
	if err == nil {
		t.Fatalf("done without an id must be refused")
	}
	if !strings.Contains(err.Error(), "id") || !strings.Contains(err.Error(), "wsh bugreport list --state handling") {
		t.Fatalf("the error must say to give an id and where to find one, got %v", err)
	}
	if _, err := bugReportDoneData([]string{"a", "b"}, "fixed", "", ""); err == nil {
		t.Fatalf("done with two ids must be refused: one report per call")
	}
}

func TestBugReportDoneWithoutOutcome(t *testing.T) {
	for _, outcome := range []string{"", "   "} {
		_, err := bugReportDoneData([]string{"x"}, outcome, "", "")
		if err == nil {
			t.Fatalf("done with outcome %q must be refused", outcome)
		}
		if !strings.Contains(err.Error(), "--outcome") {
			t.Fatalf("the error must name --outcome, got %v", err)
		}
	}
}

// The checks run before the RPC client is set up, so a missing id or --outcome is named even where wsh has no
// WAVETERM_JWT: the error is about the command line, never about the connection.
func TestBugReportDonePreRunChecksTheCommandLine(t *testing.T) {
	t.Setenv("WAVETERM_JWT", "")
	t.Cleanup(func() { bugReportDoneCmd.Flags().Set("outcome", "") })

	err := bugReportDoneCmd.PreRunE(bugReportDoneCmd, nil)
	if err == nil || !strings.Contains(err.Error(), "id") || strings.Contains(err.Error(), "WAVETERM_JWT") {
		t.Fatalf("done without an id: got %v", err)
	}
	err = bugReportDoneCmd.PreRunE(bugReportDoneCmd, []string{"x"})
	if err == nil || !strings.Contains(err.Error(), "--outcome") || strings.Contains(err.Error(), "WAVETERM_JWT") {
		t.Fatalf("done without --outcome: got %v", err)
	}
}

func TestBugReportListPreRunRefusesAnUnknownState(t *testing.T) {
	t.Setenv("WAVETERM_JWT", "")
	t.Cleanup(func() { bugReportListCmd.Flags().Set("state", "") })
	if err := bugReportListCmd.Flags().Set("state", "open"); err != nil {
		t.Fatal(err)
	}
	err := bugReportListCmd.PreRunE(bugReportListCmd, nil)
	if err == nil || !strings.Contains(err.Error(), `"open"`) || strings.Contains(err.Error(), "WAVETERM_JWT") {
		t.Fatalf("list --state open: got %v", err)
	}
}

func TestBugReportHelpReadsClearly(t *testing.T) {
	for _, c := range []struct {
		name string
		text string
		must []string
	}{
		{"bugreport", bugReportCmd.Long, []string{"waiting", "handling", "done", "report.json"}},
		{"bugreport list", bugReportListCmd.Long, []string{"--state", "--json"}},
		{"bugreport done", bugReportDoneCmd.Long, []string{"--outcome", "--run", "--effort", "handling"}},
	} {
		for _, m := range c.must {
			if !strings.Contains(c.text, m) {
				t.Fatalf("`wsh %s --help` must mention %q, got:\n%s", c.name, m, c.text)
			}
		}
	}
}

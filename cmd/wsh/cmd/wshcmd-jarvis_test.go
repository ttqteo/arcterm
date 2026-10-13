// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestJarvisRunSubcommandRegistered(t *testing.T) {
	var found bool
	for _, c := range jarvisCmd.Commands() {
		if c.Name() == "run" {
			found = true
		}
	}
	if !found {
		t.Fatal("`jarvis run` subcommand is not registered")
	}
}

func TestJarvisCtxSubcommandRegistered(t *testing.T) {
	var found bool
	for _, c := range jarvisCmd.Commands() {
		if c.Name() == "ctx" {
			found = true
		}
	}
	if !found {
		t.Fatal("`jarvis ctx` subcommand is not registered")
	}
}

func TestReadReportFile(t *testing.T) {
	dir := t.TempDir()

	path := filepath.Join(dir, "report.md")
	if err := os.WriteFile(path, []byte("  landed the fix\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	report, err := readReportFile(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if report != "landed the fix" {
		t.Errorf("report = %q, want %q", report, "landed the fix")
	}
}

func TestReadReportFileRefusesAMissingFile(t *testing.T) {
	if _, err := readReportFile(filepath.Join(t.TempDir(), "missing.md")); err == nil {
		t.Fatal("expected an error for a missing report file")
	}
}

func TestReadReportFileRefusesAnEmptyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.md")
	if err := os.WriteFile(path, []byte("   \n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readReportFile(path); err == nil {
		t.Fatal("expected an error for an empty report file")
	}
}

// the lead copies these into its report before its tab closes
func TestCompleteLandLinesSayWhereTheLandStands(t *testing.T) {
	cases := []struct {
		name string
		rtn  *wshrpc.CommandReportRunPhaseRtnData
		want []string
	}{
		{"no land", nil, nil},
		{"landed", &wshrpc.CommandReportRunPhaseRtnData{Land: &waveobj.RunLand{State: orchestrate.LandState_Landed, Commit: "9910d928", Notes: []string{"merged onto 1 commit"}}},
			[]string{"landed 9910d928", "note: merged onto 1 commit"}},
		{"held", &wshrpc.CommandReportRunPhaseRtnData{Land: &waveobj.RunLand{State: orchestrate.LandState_Held, Reason: "the final stage failed"}},
			[]string{"held: the final stage failed"}},
		{"held on a dirty checkout", &wshrpc.CommandReportRunPhaseRtnData{Land: &waveobj.RunLand{State: orchestrate.LandState_Held, Reason: "the checkout has staged changes", Dirty: true}},
			[]string{"held: the checkout has staged changes; those changes are not yours to touch: the engine lands the run by itself once they are gone"}},
		{"land failed", &wshrpc.CommandReportRunPhaseRtnData{LandError: "loading run: gone"}, []string{"land failed: loading run: gone"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := completeLandLines(c.rtn); !reflect.DeepEqual(got, c.want) {
				t.Fatalf("completeLandLines = %q, want %q", got, c.want)
			}
		})
	}
}

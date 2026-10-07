// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/harness"
)

type notice struct{ title, message, level string }

func stubCheck(t *testing.T, installed, latest string) *[]notice {
	t.Helper()
	origProbe, origLatest, origState := probeAll, latestVersion, statePath
	t.Cleanup(func() { probeAll, latestVersion, statePath = origProbe, origLatest, origState })
	spec, _ := harness.Lookup("claude")
	probeAll = func(context.Context) []harness.ProbeResult {
		return []harness.ProbeResult{{Spec: spec, Installed: installed != "", Version: installed}}
	}
	latestVersion = func(context.Context, string, string) (string, error) { return latest, nil }
	dir := t.TempDir()
	statePath = func() string { return filepath.Join(dir, "harness-updates.json") }
	resetLatest()
	var got []notice
	return &got
}

func TestCheck_announcesANewVersionOnce(t *testing.T) {
	got := stubCheck(t, "2.1.292 (Claude Code)", "2.1.300")
	notify := func(title, message, level string) { *got = append(*got, notice{title, message, level}) }
	Check(context.Background(), notify)
	Check(context.Background(), notify)
	if len(*got) != 1 {
		t.Fatalf("notices = %d, want 1: %+v", len(*got), *got)
	}
	// the spec's notice: "Claude Code 2.1.300 is out · Settings → About to update"
	if (*got)[0].title != "Claude Code 2.1.300 is out" || (*got)[0].message != "Settings → About to update" {
		t.Errorf("notice = %+v", (*got)[0])
	}
	if Latest("claude") != "2.1.300" {
		t.Errorf("Latest = %q", Latest("claude"))
	}
	// a restart (fresh memory, same state file) does not announce it again
	resetLatest()
	Check(context.Background(), notify)
	if len(*got) != 1 {
		t.Errorf("announced again after a restart: %+v", *got)
	}
}

func TestCheck_saysNothingWhenCurrentOrNotInstalled(t *testing.T) {
	for _, installed := range []string{"2.1.300 (Claude Code)", ""} {
		got := stubCheck(t, installed, "2.1.300")
		Check(context.Background(), func(title, message, level string) { *got = append(*got, notice{title, message, level}) })
		if len(*got) != 0 {
			t.Errorf("installed %q: notices %+v", installed, *got)
		}
	}
}

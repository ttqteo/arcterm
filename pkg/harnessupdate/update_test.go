// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package harnessupdate

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/harness"
)

func stubUpdate(t *testing.T, out string, err error, after string) *[]string {
	t.Helper()
	origRun, origProbe := runUpdate, probeAll
	t.Cleanup(func() { runUpdate, probeAll = origRun, origProbe })
	var argv []string
	runUpdate = func(_ context.Context, bin string, args []string) ([]byte, error) {
		argv = append([]string{bin}, args...)
		return []byte(out), err
	}
	spec, _ := harness.Lookup("claude")
	probeAll = func(context.Context) []harness.ProbeResult {
		return []harness.ProbeResult{{Spec: spec, Installed: true, Version: after}}
	}
	return &argv
}

func TestUpdate_runsTheHarnessUpdaterAndReadsTheNewVersion(t *testing.T) {
	argv := stubUpdate(t, "Successfully updated from 2.1.292 to 2.1.300\n", nil, "2.1.300 (Claude Code)")
	res, err := Update(context.Background(), "claude")
	if err != nil {
		t.Fatal(err)
	}
	if len(*argv) != 2 || (*argv)[0] != "claude" || (*argv)[1] != "update" {
		t.Errorf("ran %v", *argv)
	}
	if res.Version != "2.1.300" {
		t.Errorf("version = %q", res.Version)
	}
}

func TestUpdate_failsWithTheUpdatersLastLine(t *testing.T) {
	stubUpdate(t, "Checking for updates...\nError: EACCES permission denied\n", errors.New("exit status 1"), "2.1.292")
	_, err := Update(context.Background(), "claude")
	if err == nil || err.Error() != "Error: EACCES permission denied" {
		t.Errorf("err = %v", err)
	}
}

func TestUpdate_saysItTimedOut(t *testing.T) {
	stubUpdate(t, "", context.DeadlineExceeded, "2.1.292")
	_, err := Update(context.Background(), "claude")
	if !errors.Is(err, context.DeadlineExceeded) || !strings.Contains(err.Error(), "timed out after 5m0s") {
		t.Errorf("err = %v", err)
	}
}

func TestUpdate_refusesAHarnessWithNoUpdater(t *testing.T) {
	stubUpdate(t, "", nil, "")
	if _, err := Update(context.Background(), "codex"); err == nil {
		t.Error("codex has no update command and returned no error")
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package devservers

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestStdoutFileFindsARedirectedProcessLog(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "server.log")
	log, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	cmd := exec.Command("ping", "-n", "30", "127.0.0.1")
	cmd.Stdout = log
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	got := stdoutFile(int32(cmd.Process.Pid))
	if !strings.EqualFold(got, logPath) {
		// the temp dir can sit behind a short (8.3) or linked path: compare what both resolve to
		want, _ := filepath.EvalSymlinks(logPath)
		if !strings.EqualFold(got, want) {
			t.Fatalf("stdoutFile = %q; want %q", got, logPath)
		}
	}
}

func TestStdoutFileIsEmptyForAPipe(t *testing.T) {
	cmd := exec.Command("ping", "-n", "30", "127.0.0.1")
	if _, err := cmd.StdoutPipe(); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	if got := stdoutFile(int32(cmd.Process.Pid)); got != "" {
		t.Fatalf("stdoutFile = %q; want \"\" for a pipe", got)
	}
}

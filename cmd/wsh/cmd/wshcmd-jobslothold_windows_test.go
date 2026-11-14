// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

const jobslotHoldHelperEnv = "ARC_TEST_JOBSLOT_HOLD_HELPER"

// The helper half: started by Git Bash, it prints what it would hold.
func TestJobslotHoldHelper(t *testing.T) {
	if os.Getenv(jobslotHoldHelperEnv) == "" {
		t.Skip("run by TestJobslotHoldsTheGitBashShell")
	}
	fmt.Printf("hold %d\n", jobslotHoldPid())
}

// Under Git Bash, wsh's parent is a fork that exits with wsh: the slot must follow the shell instead.
func TestJobslotHoldsTheGitBashShell(t *testing.T) {
	bash := `C:\Program Files\Git\usr\bin\bash.exe`
	if _, err := os.Stat(bash); err != nil {
		t.Skip("no Git Bash at " + bash)
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	// the trailing `; true` keeps bash from exec'ing the last command in place of itself
	script := fmt.Sprintf("echo shell $(cat /proc/$$/winpid); '%s' -test.run='^TestJobslotHoldHelper$'; true", self)
	cmd := exec.Command(bash, "-c", script)
	cmd.Env = append(os.Environ(), jobslotHoldHelperEnv+"=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("bash: %v\n%s", err, out)
	}
	var shell, hold string
	for _, line := range strings.Split(strings.ReplaceAll(string(out), "\r", ""), "\n") {
		if v, ok := strings.CutPrefix(line, "shell "); ok {
			shell = v
		}
		if v, ok := strings.CutPrefix(line, "hold "); ok {
			hold = v
		}
	}
	if shell == "" || hold != shell {
		t.Fatalf("held %q, want the shell %q\n%s", hold, shell, out)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package shellutil

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// TestNativeArgHelper is the native program the round-trip test runs through Windows PowerShell: it prints the
// arguments it received after "--" as one JSON line.
func TestNativeArgHelper(t *testing.T) {
	if os.Getenv("SHELLUTIL_ARG_HELPER") != "1" {
		return
	}
	args := os.Args
	for i, a := range args {
		if a == "--" {
			args = args[i+1:]
			break
		}
	}
	out, _ := json.Marshal(args)
	fmt.Println(string(out))
	os.Exit(0)
}

// The prompt of every run lead reached claude cut off at its first double quote, because powershell.exe 5.1
// passed it on unescaped; each argument here has to arrive whole.
func TestHardQuoteWindowsPowerShellArgRoundTrips(t *testing.T) {
	ps, err := exec.LookPath("powershell.exe")
	if err != nil {
		t.Skip("no powershell.exe")
	}
	args := []string{
		"- questions: `wsh jarvis dag forward <task> \"<what you checked, what you recommend>\"`.\n- next rule",
		`say "hi" and "bye"`,
		`no"space`,
		`C:\a dir\`,
		`C:\nospace\`,
		`back\slash "quoted \" thing" end`,
		"$HOME, `tick` and the phase's apostrophe",
	}
	var cmd strings.Builder
	cmd.WriteString("& " + HardQuotePowerShell(os.Args[0]) + " " + HardQuotePowerShell("-test.run=^TestNativeArgHelper$") + " --")
	for _, a := range args {
		cmd.WriteString(" " + HardQuoteWindowsPowerShellArg(a))
	}
	run := exec.Command(ps, "-NoProfile", "-NonInteractive", "-Command", cmd.String())
	run.Env = append(os.Environ(), "SHELLUTIL_ARG_HELPER=1")
	out, err := run.CombinedOutput()
	if err != nil {
		t.Fatalf("powershell: %v\n%s", err, out)
	}
	var got []string
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(out))), &got); err != nil {
		t.Fatalf("helper output is not json: %v\n%s", err, out)
	}
	if len(got) != len(args) {
		t.Fatalf("got %d arguments, want %d:\n%q", len(got), len(args), got)
	}
	for i := range args {
		if got[i] != args[i] {
			t.Errorf("argument %d arrived as %q, want %q", i, got[i], args[i])
		}
	}
}

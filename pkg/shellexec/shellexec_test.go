// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestEnsureWshOnPath(t *testing.T) {
	sep := string(os.PathListSeparator)
	bin := "/wave/bin"

	getPath := func(env []string) string {
		for _, kv := range env {
			if name, val, ok := strings.Cut(kv, "="); ok && strings.EqualFold(name, "PATH") {
				return val
			}
		}
		return ""
	}

	t.Run("prepends when missing", func(t *testing.T) {
		ecmd := &exec.Cmd{Env: []string{"WAVETERM_WSHBINDIR=" + bin, "PATH=/usr/bin" + sep + "/bin"}}
		ensureWshOnPath(ecmd)
		want := bin + sep + "/usr/bin" + sep + "/bin"
		if got := getPath(ecmd.Env); got != want {
			t.Fatalf("PATH = %q, want %q", got, want)
		}
	})

	t.Run("idempotent when already present", func(t *testing.T) {
		ecmd := &exec.Cmd{Env: []string{"WAVETERM_WSHBINDIR=" + bin, "PATH=" + bin + sep + "/usr/bin"}}
		ensureWshOnPath(ecmd)
		want := bin + sep + "/usr/bin"
		if got := getPath(ecmd.Env); got != want {
			t.Fatalf("PATH = %q, want %q (should not duplicate)", got, want)
		}
	})

	t.Run("no-op without bin dir", func(t *testing.T) {
		ecmd := &exec.Cmd{Env: []string{"PATH=/usr/bin"}}
		ensureWshOnPath(ecmd)
		if got := getPath(ecmd.Env); got != "/usr/bin" {
			t.Fatalf("PATH = %q, want unchanged", got)
		}
	})

	t.Run("adds PATH when absent", func(t *testing.T) {
		ecmd := &exec.Cmd{Env: []string{"WAVETERM_WSHBINDIR=" + bin}}
		ensureWshOnPath(ecmd)
		if got := getPath(ecmd.Env); got != bin {
			t.Fatalf("PATH = %q, want %q", got, bin)
		}
	})
}

func TestDirectProgramStartsOnlyAnExeGivenApartFromItsArgs(t *testing.T) {
	found := map[string]string{
		"claude": `C:\Users\me\.local\bin\claude.exe`,
		"node":   `C:\nodejs\NODE.EXE`,
		"pi":     `C:\npm\pi.cmd`,
		"tool":   `C:\bin\tool.bat`,
	}
	look := func(name string) (string, error) {
		if p, ok := found[name]; ok {
			return p, nil
		}
		return "", exec.ErrNotFound
	}
	cases := []struct {
		name string
		goos string
		argv []string
		want string
	}{
		{"an exe on windows", "windows", []string{"claude", "--resume", "x"}, found["claude"]},
		{"the extension in any case", "windows", []string{"node"}, found["node"]},
		{"a cmd shim needs the shell", "windows", []string{"pi", "audit auth"}, ""},
		{"a bat needs the shell", "windows", []string{"tool"}, ""},
		{"not found: the shell decides (alias, profile function)", "windows", []string{"myalias"}, ""},
		{"a line for the shell (no argv)", "windows", nil, ""},
		{"an empty program", "windows", []string{""}, ""},
		{"not windows: sh -c already runs it in its place", "darwin", []string{"claude"}, ""},
	}
	for _, c := range cases {
		if got := directProgram(c.goos, c.argv, look); got != c.want {
			t.Errorf("%s: directProgram(%q, %q) = %q, want %q", c.name, c.goos, c.argv, got, c.want)
		}
	}
}

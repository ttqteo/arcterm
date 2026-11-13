// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package shellutil

import (
	"os/exec"
	"strings"
	"testing"
)

func TestGitBashFromPathDir(t *testing.T) {
	tests := []struct {
		name   string
		dir    string
		exists []string
		want   string
	}{
		{
			name:   "usr bin resolves to the launcher",
			dir:    `C:\Program Files\Git\usr\bin`,
			exists: []string{`C:\Program Files\Git\usr\bin\bash.exe`, `C:\Program Files\Git\bin\bash.exe`},
			want:   `C:\Program Files\Git\bin\bash.exe`,
		},
		{
			name:   "usr bin with forward slashes and other case resolves to the launcher",
			dir:    `C:/Program Files/Git/USR/Bin/`,
			exists: []string{`C:\Program Files\Git\USR\Bin\bash.exe`, `C:\Program Files\Git\bin\bash.exe`},
			want:   `C:\Program Files\Git\bin\bash.exe`,
		},
		{
			name:   "usr bin keeps itself when the launcher is missing",
			dir:    `C:\Program Files\Git\usr\bin`,
			exists: []string{`C:\Program Files\Git\usr\bin\bash.exe`},
			want:   `C:\Program Files\Git\usr\bin\bash.exe`,
		},
		{
			name:   "the launcher dir is itself",
			dir:    `C:\Program Files\Git\bin`,
			exists: []string{`C:\Program Files\Git\bin\bash.exe`},
			want:   `C:\Program Files\Git\bin\bash.exe`,
		},
		{
			name:   "a dir with no bash is empty",
			dir:    `C:\Program Files\Git\cmd`,
			exists: []string{`C:\Program Files\Git\bin\bash.exe`},
			want:   "",
		},
		{
			name:   "a usr bin with no bash is empty even when the launcher exists",
			dir:    `C:\Program Files\Git\usr\bin`,
			exists: []string{`C:\Program Files\Git\bin\bash.exe`},
			want:   "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			present := map[string]bool{}
			for _, p := range tt.exists {
				present[p] = true
			}
			got := gitBashFromPathDir(tt.dir, func(p string) bool { return present[p] })
			if got != tt.want {
				t.Fatalf("gitBashFromPathDir(%q) = %q, want %q", tt.dir, got, tt.want)
			}
		})
	}
}

// TestInstalledGitBashRunsShims resolves the bash the way a plan command does and runs an npm shim through it:
// a bash launched from <git>\usr\bin has no /usr/bin on its PATH, so every `#!/usr/bin/env bash` shim exits 127.
func TestInstalledGitBashRunsShims(t *testing.T) {
	bash := FindGitBash(nil, true)
	if bash == "" {
		t.Skip("no Git for Windows found")
	}
	if _, err := exec.LookPath("npx"); err != nil {
		t.Skip("no npx on PATH")
	}
	out, err := exec.Command(bash, "-c", "npx --version").CombinedOutput()
	if err != nil {
		t.Fatalf("%s -c 'npx --version' failed: %v\n%s", bash, err, strings.TrimSpace(string(out)))
	}
}

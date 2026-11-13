// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"os"
	"path/filepath"
	"testing"
)

func withTempNoFolderHome(t *testing.T) string {
	t.Helper()
	home := realTempDir(t)
	old := noFolderHome
	noFolderHome = func() (string, error) { return home, nil }
	t.Cleanup(func() { noFolderHome = old })
	return home
}

// The launch No folder replaced Home for: the folder exists afterwards and Claude Code will not ask to trust it.
func TestEnsureNoFolderCreatesAndTrustsTheFolder(t *testing.T) {
	home := withTempNoFolderHome(t)
	cfg := withTempClaudeConfig(t, `{"projects": {}}`)
	dir, err := EnsureNoFolder()
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(home, ".arc", "no-folder"); dir != want {
		t.Fatalf("dir = %q, want %q", dir, want)
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		t.Fatalf("no folder not created: %v", err)
	}
	data, err := os.ReadFile(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !trustedIn(t, data, normalizeClaudePath(dir)) {
		t.Fatalf("no folder not trusted: %s", data)
	}
}

// Every launch calls it: a second call finds the folder and its trust in place and changes nothing.
func TestEnsureNoFolderTwiceWritesTheConfigOnce(t *testing.T) {
	withTempNoFolderHome(t)
	cfg := withTempClaudeConfig(t, `{"projects": {}}`)
	if _, err := EnsureNoFolder(); err != nil {
		t.Fatal(err)
	}
	first, _ := os.ReadFile(cfg)
	if _, err := EnsureNoFolder(); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(cfg)
	if string(first) != string(second) {
		t.Fatalf("second call rewrote the config:\n%s\n---\n%s", first, second)
	}
}

// A config Claude Code cannot read either must not stop the launch: the folder is still returned.
func TestEnsureNoFolderLaunchesEvenWhenTrustFails(t *testing.T) {
	withTempNoFolderHome(t)
	withTempClaudeConfig(t, `{not json`)
	dir, err := EnsureNoFolder()
	if err != nil || dir == "" {
		t.Fatalf("dir = %q, err = %v", dir, err)
	}
}

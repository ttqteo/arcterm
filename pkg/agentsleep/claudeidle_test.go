// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsleep

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestClaudeIdleCompacts(t *testing.T) {
	noEnv := func(string) (string, bool) { return "", false }
	env := func(k, v string) func(string) (string, bool) {
		return func(name string) (string, bool) { return v, name == k }
	}
	cases := []struct {
		name             string
		global, settings string
		env              func(string) (string, bool)
		want             bool
	}{
		{"nothing set: Claude Code's defaults are on", "", "", noEnv, true},
		{"files that do not parse say nothing", "{", "not json", noEnv, true},
		{"autoCompactEnabled off in the global config", `{"autoCompactEnabled": false}`, "", noEnv, false},
		{"autoCompactEnabled off in settings", "", `{"autoCompactEnabled": false}`, noEnv, false},
		{"the global config wins over settings", `{"autoCompactEnabled": true}`, `{"autoCompactEnabled": false}`, noEnv, true},
		{"idleCompaction off", "", `{"idleCompaction": false}`, noEnv, false},
		{"idleCompaction on", "", `{"idleCompaction": true}`, noEnv, true},
		{"DISABLE_AUTO_COMPACT", "", "", env("DISABLE_AUTO_COMPACT", "1"), false},
		{"DISABLE_COMPACT", "", "", env("DISABLE_COMPACT", "true"), false},
		{"DISABLE_AUTO_COMPACT=0 keeps it on", "", "", env("DISABLE_AUTO_COMPACT", "0"), true},
	}
	for _, tc := range cases {
		if got := ClaudeIdleCompacts([]byte(tc.global), []byte(tc.settings), tc.env); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestReadClaudeIdleCompactsFollowsTheFiles(t *testing.T) {
	home := t.TempDir()
	noEnv := func(string) (string, bool) { return "", false }
	if !ReadClaudeIdleCompacts(home, noEnv) {
		t.Fatal("no config files: want Claude Code's default (it compacts)")
	}
	global := filepath.Join(home, ".claude.json")
	if err := os.WriteFile(global, []byte(`{"autoCompactEnabled": false}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if ReadClaudeIdleCompacts(home, noEnv) {
		t.Fatal("autoCompactEnabled off: want false")
	}
	if !ReadClaudeIdleCompacts(home, func(k string) (string, bool) {
		if k == "CLAUDE_CONFIG_DIR" {
			return filepath.Join(home, "other"), true
		}
		return "", false
	}) {
		t.Fatal("CLAUDE_CONFIG_DIR points elsewhere: want that dir's (missing) config, so true")
	}
	// a change on disk is read again, even within the same second
	if err := os.WriteFile(global, []byte(`{"autoCompactEnabled": true, "x": 1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(time.Minute)
	if err := os.Chtimes(global, later, later); err != nil {
		t.Fatal(err)
	}
	if !ReadClaudeIdleCompacts(home, noEnv) {
		t.Fatal("autoCompactEnabled back on: want true")
	}
	if ReadClaudeIdleCompacts(home, func(k string) (string, bool) { return "1", k == "DISABLE_AUTO_COMPACT" }) {
		t.Fatal("DISABLE_AUTO_COMPACT in the env: want false whatever the files say")
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"os"
	"path/filepath"
	"testing"
)

func writeClaudeSettings(t *testing.T, path string, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func noEnv(string) (string, bool) { return "", false }

func TestClaudeTuiEnv(t *testing.T) {
	t.Run("user settings ask for fullscreen: the block gets the env form", func(t *testing.T) {
		cfg := t.TempDir()
		writeClaudeSettings(t, filepath.Join(cfg, "settings.json"), `{"model":"opus","tui":"fullscreen"}`)
		got := claudeTuiEnv(noEnv, cfg, "")
		if got[claudeNoFlickerVar] != "1" {
			t.Fatalf("want %s=1, got %v", claudeNoFlickerVar, got)
		}
	})
	t.Run("no tui setting, the classic one, or no file: nothing is added", func(t *testing.T) {
		for _, body := range []string{`{"model":"opus"}`, `{"tui":"default"}`, `not json`} {
			cfg := t.TempDir()
			writeClaudeSettings(t, filepath.Join(cfg, "settings.json"), body)
			if got := claudeTuiEnv(noEnv, cfg, ""); len(got) != 0 {
				t.Fatalf("%s: want nothing, got %v", body, got)
			}
		}
		if got := claudeTuiEnv(noEnv, filepath.Join(t.TempDir(), "missing"), ""); len(got) != 0 {
			t.Fatalf("missing file: want nothing, got %v", got)
		}
	})
	t.Run("the project's settings win over the user's, the local file over both", func(t *testing.T) {
		cfg := t.TempDir()
		writeClaudeSettings(t, filepath.Join(cfg, "settings.json"), `{"tui":"fullscreen"}`)
		proj := t.TempDir()
		writeClaudeSettings(t, filepath.Join(proj, ".claude", "settings.json"), `{"tui":"default"}`)
		if got := claudeTuiEnv(noEnv, cfg, proj); len(got) != 0 {
			t.Fatalf("project says default: want nothing, got %v", got)
		}
		writeClaudeSettings(t, filepath.Join(proj, ".claude", "settings.local.json"), `{"tui":"fullscreen"}`)
		if got := claudeTuiEnv(noEnv, cfg, proj); got[claudeNoFlickerVar] != "1" {
			t.Fatalf("local says fullscreen: want %s=1, got %v", claudeNoFlickerVar, got)
		}
	})
	t.Run("a CLAUDE_CODE_NO_FLICKER already in the environment is left alone", func(t *testing.T) {
		cfg := t.TempDir()
		writeClaudeSettings(t, filepath.Join(cfg, "settings.json"), `{"tui":"fullscreen"}`)
		set := func(k string) (string, bool) {
			if k == claudeNoFlickerVar {
				return "0", true
			}
			return "", false
		}
		if got := claudeTuiEnv(set, cfg, ""); len(got) != 0 {
			t.Fatalf("want nothing, got %v", got)
		}
	})
}

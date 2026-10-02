// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// DefaultSettings exists so the Settings surface can tell a user's override apart from a shipped
// value: Settings is the merge of the two, so on its own it can't mark a changed row or say what
// Revert restores. The property that matters is that a home-directory settings.json moves Settings
// and leaves DefaultSettings alone.
func TestDefaultSettingsIgnoresHomeOverrides(t *testing.T) {
	configDir := t.TempDir()
	barr, err := json.Marshal(map[string]any{ConfigKey_TermFontFamily: "Comic Sans MS"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "settings.json"), barr, 0644); err != nil {
		t.Fatalf("write settings.json: %v", err)
	}

	prev := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = configDir
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = prev })

	full := ReadFullConfig()
	if full.Settings.TermFontFamily != "Comic Sans MS" {
		t.Fatalf("Settings.TermFontFamily = %q, want the home override", full.Settings.TermFontFamily)
	}
	if full.DefaultSettings.TermFontFamily != `"JetBrains Mono", monospace` {
		t.Fatalf("DefaultSettings.TermFontFamily = %q, want the shipped default", full.DefaultSettings.TermFontFamily)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// Claude Code's fullscreen renderer has a boot canary: a launch records itself in ~/.claude.json and clears the record
// once it has drawn and run ~10 s, or when it exits through its own exit hooks. A launch that finds the record of a
// process gone without either starts in the classic renderer ("didn't finish starting last time"), and two such
// strikes turn fullscreen off for the whole Claude version ("repeatedly failed to start"). On Windows arcterm stops a
// block with TerminateProcess (shellexec.CmdWrap.KillGraceful), which runs no exit hook, so every claude closed or
// restarted in its first seconds counted as a crash and the next agents came up classic. Claude skips the canary when
// fullscreen comes from CLAUDE_CODE_NO_FLICKER=1, its documented equivalent of `"tui": "fullscreen"`, so a block gets
// that variable whenever the person's settings ask for fullscreen.
const claudeNoFlickerVar = "CLAUDE_CODE_NO_FLICKER"

// the settings files that can set `tui`, lowest precedence first, as Claude Code layers them
func claudeTuiSettingsFiles(configDir string, cwd string) []string {
	files := []string{filepath.Join(configDir, "settings.json")}
	if cwd != "" {
		files = append(files, filepath.Join(cwd, ".claude", "settings.json"), filepath.Join(cwd, ".claude", "settings.local.json"))
	}
	return files
}

func claudeTuiSetting(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var cfg struct {
		Tui string `json:"tui"`
	}
	if json.Unmarshal(raw, &cfg) != nil {
		return ""
	}
	return strings.TrimSpace(cfg.Tui)
}

// claudeTuiEnv is the env a local block adds so claude starts fullscreen when its settings say so; empty when they
// don't, or when CLAUDE_CODE_NO_FLICKER is already in wavesrv's environment (the person's own choice wins).
func claudeTuiEnv(lookupEnv func(string) (string, bool), configDir string, cwd string) map[string]string {
	if _, ok := lookupEnv(claudeNoFlickerVar); ok {
		return nil
	}
	tui := ""
	for _, f := range claudeTuiSettingsFiles(configDir, cwd) {
		if v := claudeTuiSetting(f); v != "" {
			tui = v
		}
	}
	if tui != "fullscreen" {
		return nil
	}
	return map[string]string{claudeNoFlickerVar: "1"}
}

// the config dir claude reads its user settings from: CLAUDE_CONFIG_DIR, else ~/.claude
func claudeConfigDir() string {
	if dir := os.Getenv("CLAUDE_CONFIG_DIR"); dir != "" {
		return dir
	}
	return filepath.Join(wavebase.GetHomeDir(), ".claude")
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsleep

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Claude Code compacts an awake idle conversation itself (IdleCompactVar), but only while its compaction is on: with
// DISABLE_COMPACT or DISABLE_AUTO_COMPACT set, `"autoCompactEnabled": false` or `"idleCompaction": false`, it never
// does (its idle check answers compaction_off or idle_compaction_off, v2.1.326). arcterm then compacts the awake agent
// itself, as it did before Claude Code had one (Settings.CompactAwake). 2026-11-17: autoCompactEnabled off, and the
// cold resumes of 100k-200k conversations went from 5 in the two weeks before to 24 in the week after arcterm stopped.

// ClaudeIdleCompacts is whether Claude Code's own idle compaction can run, from its global config (~/.claude.json, read
// first for autoCompactEnabled, as Claude Code does), its user settings (settings.json in its config dir) and the env.
// A file that is missing or does not parse says nothing, which leaves Claude Code's defaults (on).
func ClaudeIdleCompacts(globalConfig, userSettings []byte, lookupEnv func(string) (string, bool)) bool {
	for _, name := range []string{"DISABLE_COMPACT", "DISABLE_AUTO_COMPACT"} {
		if v, ok := lookupEnv(name); ok && envTrue(v) {
			return false
		}
	}
	var global, user struct {
		AutoCompact *bool `json:"autoCompactEnabled"`
		Idle        *bool `json:"idleCompaction"`
	}
	_ = json.Unmarshal(globalConfig, &global)
	_ = json.Unmarshal(userSettings, &user)
	auto := global.AutoCompact
	if auto == nil {
		auto = user.AutoCompact
	}
	if auto != nil && !*auto {
		return false
	}
	return user.Idle == nil || *user.Idle
}

// envTrue is how Claude Code reads a switch in the env: 1, true, yes or on.
func envTrue(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
		return n != 0
	}
	return false
}

// claudeConfigPaths are Claude Code's global config and user settings files: the config dir is CLAUDE_CONFIG_DIR,
// else ~/.claude; the global config is <config dir>/.config.json when it exists, else .claude.json under
// CLAUDE_CONFIG_DIR or the home dir (as claudequota.defaultPaths resolves it).
func claudeConfigPaths(home string, lookupEnv func(string) (string, bool)) (global, settings string) {
	override, _ := lookupEnv("CLAUDE_CONFIG_DIR")
	dir := override
	if dir == "" {
		dir = filepath.Join(home, ".claude")
	}
	settings = filepath.Join(dir, "settings.json")
	if alt := filepath.Join(dir, ".config.json"); fileExists(alt) {
		return alt, settings
	}
	if override != "" {
		return filepath.Join(override, ".claude.json"), settings
	}
	return filepath.Join(home, ".claude.json"), settings
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// fileStamp is what says a config file changed without reading it.
type fileStamp struct {
	size int64
	mod  time.Time
}

func stampOf(p string) fileStamp {
	fi, err := os.Stat(p)
	if err != nil {
		return fileStamp{size: -1}
	}
	return fileStamp{fi.Size(), fi.ModTime()}
}

var claudeIdleCache struct {
	sync.Mutex
	global, settings           string
	globalStamp, settingsStamp fileStamp
	read                       bool
	compacts                   bool
}

// ReadClaudeIdleCompacts is ClaudeIdleCompacts over the files on disk, read again only when one of them changed: the
// global config runs to hundreds of KB and the sleep loop asks every minute.
func ReadClaudeIdleCompacts(home string, lookupEnv func(string) (string, bool)) bool {
	global, settings := claudeConfigPaths(home, lookupEnv)
	gs, ss := stampOf(global), stampOf(settings)
	c := &claudeIdleCache
	c.Lock()
	defer c.Unlock()
	if !c.read || c.global != global || c.settings != settings || c.globalStamp != gs || c.settingsStamp != ss {
		g, _ := os.ReadFile(global)
		s, _ := os.ReadFile(settings)
		c.compacts = ClaudeIdleCompacts(g, s, func(string) (string, bool) { return "", false })
		c.global, c.settings, c.globalStamp, c.settingsStamp, c.read = global, settings, gs, ss, true
	}
	compacts := c.compacts
	// the env is cheap and not part of the cache
	return compacts && ClaudeIdleCompacts(nil, nil, lookupEnv)
}

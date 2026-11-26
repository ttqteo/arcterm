// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// DefaultCleanupDays is how long Claude Code keeps a transcript after its last write when its settings say nothing.
const DefaultCleanupDays = 30

// ClaudeSettingsPath is ~/.claude/settings.json, where Claude Code's cleanupPeriodDays lives (arcterm writes 90 there
// unless the person set one).
func ClaudeSettingsPath() string {
	return filepath.Join(wavebase.GetHomeDir(), ".claude", "settings.json")
}

// CleanupPeriodDays is the cleanupPeriodDays of the settings file at path: Claude Code's default of 30 when the file or
// the key is absent. A file that cannot be read or parsed, or a value that is not a whole number of days above zero,
// logs what it lost and gives the default. Read it each time it is needed: the person can change it between ticks.
func CleanupPeriodDays(path string) int {
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return DefaultCleanupDays
	}
	if err != nil {
		log.Printf("sessionideas: reading %s: %v; assuming cleanupPeriodDays %d", path, err, DefaultCleanupDays)
		return DefaultCleanupDays
	}
	var s struct {
		CleanupPeriodDays *int `json:"cleanupPeriodDays"`
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		log.Printf("sessionideas: parsing %s: %v; assuming cleanupPeriodDays %d", path, err, DefaultCleanupDays)
		return DefaultCleanupDays
	}
	switch {
	case s.CleanupPeriodDays == nil:
		return DefaultCleanupDays
	case *s.CleanupPeriodDays <= 0:
		log.Printf("sessionideas: cleanupPeriodDays in %s is %d, not a period of days; assuming %d", path, *s.CleanupPeriodDays, DefaultCleanupDays)
		return DefaultCleanupDays
	}
	return *s.CleanupPeriodDays
}

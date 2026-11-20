// pkg/verifyruns/glob.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package verifyruns

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Config is a project's opt-in to Verify: `.arc/verify.json` at the repo root. A repo without the file has no
// Verify at all, whatever its agents run.
type Config struct {
	// Watch lists the UI files whose change wants a scenario run: `**` and `*` globs relative to the repo root.
	Watch []string `json:"watch"`
	// Rerun is the command the not-run line names, e.g. "task verify:ui -- <name>".
	Rerun string `json:"rerun"`
}

// Watches reports whether rel (a forward-slash path relative to the repo root) matches a watch glob.
func (c *Config) Watches(rel string) bool {
	if c == nil {
		return false
	}
	for _, pattern := range c.Watch {
		if Match(pattern, rel) {
			return true
		}
	}
	return false
}

// LoadConfig reads `<repoRoot>/.arc/verify.json`. A missing file is not an error: it returns nil, nil, which
// means the project has not opted in.
func LoadConfig(repoRoot string) (*Config, error) {
	file := filepath.Join(repoRoot, ".arc", "verify.json")
	data, err := os.ReadFile(file)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("%s: %w", file, err)
	}
	return &cfg, nil
}

// Match reports whether the forward-slash relative path rel matches pattern. `**` as a whole segment matches
// any number of segments, none included; `*` (and `?`, `[...]`) match within one segment only. The caller
// normalises backslash paths first.
func Match(pattern, rel string) bool {
	if pattern == "" || rel == "" {
		return false
	}
	return matchSegments(strings.Split(pattern, "/"), strings.Split(rel, "/"))
}

func matchSegments(pat, segs []string) bool {
	for len(pat) > 0 {
		if pat[0] == "**" {
			// collapse a run of ** into one, then try every split of what is left of the path
			for len(pat) > 0 && pat[0] == "**" {
				pat = pat[1:]
			}
			if len(pat) == 0 {
				return true
			}
			for i := 0; i <= len(segs); i++ {
				if matchSegments(pat, segs[i:]) {
					return true
				}
			}
			return false
		}
		if len(segs) == 0 {
			return false
		}
		ok, err := path.Match(pat[0], segs[0])
		if err != nil || !ok {
			return false
		}
		pat, segs = pat[1:], segs[1:]
	}
	return len(segs) == 0
}

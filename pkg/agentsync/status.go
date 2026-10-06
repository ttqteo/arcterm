// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/harness"
)

// HarnessStatus is one row of the sync view.
type HarnessStatus struct {
	Runtime  string `json:"runtime"`
	Label    string `json:"label"`
	Present  bool   `json:"present"`
	Steering string `json:"steering"` // current | stale | absent
	// Path is the harness's steering file, whether or not it exists yet.
	Path string `json:"path"`
	// SkillsManaged counts skill directories arcterm wrote; SkillsUnmanaged counts the user's own.
	SkillsManaged   int    `json:"skillsmanaged"`
	SkillsUnmanaged int    `json:"skillsunmanaged"`
	Note            string `json:"note,omitempty"`
}

func Status(p Paths) ([]HarnessStatus, error) {
	canonicalBody, err := os.ReadFile(p.SteeringDoc)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	specs := harness.List()
	out := make([]HarnessStatus, 0, len(specs))
	for _, spec := range specs {
		st := HarnessStatus{Runtime: spec.Runtime, Label: spec.Label, Steering: "absent", Path: spec.SteeringPath(p.Home)}
		st.Present = configRootExists(spec, p.Home)
		if st.Present {
			existing, _ := os.ReadFile(st.Path)
			st.Steering = steeringState(string(existing), string(canonicalBody))
		}
		if dir := spec.SkillsPath(p.Home); dir != "" && st.Present {
			observed, err := observeSkills(dir)
			if err != nil {
				return nil, err
			}
			for _, e := range observed {
				if e.Managed {
					st.SkillsManaged++
				} else if isSkillDir(dir, e.Name) {
					st.SkillsUnmanaged++
				}
			}
		}
		if spec.Runtime == "pi" && st.Present {
			claudeSkills := ""
			if cl, ok := harness.Lookup("claude"); ok {
				claudeSkills = cl.SkillsPath(p.Home)
			}
			st.Note = piSkillsNote(piSettingsSkills(spec.ConfigRoot(p.Home)), claudeSkills, p.SkillsRoot)
		}
		out = append(out, st)
	}
	return out, nil
}

// piSettingsSkills reads the skills array out of pi's settings. Read-only, always: arcterm distributes
// availability, and pi's exclusion entries belong to the user.
func piSettingsSkills(configRoot string) []string {
	data, err := os.ReadFile(filepath.Join(configRoot, "settings.json"))
	if err != nil {
		return nil
	}
	var parsed struct {
		Skills []string `json:"skills"`
	}
	if json.Unmarshal(data, &parsed) != nil {
		return nil
	}
	return parsed.Skills
}

// sameTarget compares two configured paths case-insensitively: these live on Windows, where the
// filesystem is, and the comparison only ever decides which sentence pi's note gets.
func sameTarget(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

// piSkillsNote describes how pi reaches the synced skills, or warns that it does not. A "!" prefix
// is an exclusion entry, not a search path.
func piSkillsNote(entries []string, claudeSkills, vaultSkills string) string {
	for _, e := range entries {
		if strings.HasPrefix(e, "!") {
			continue
		}
		expanded := e
		if strings.HasPrefix(expanded, "~") {
			expanded = filepath.Join(filepath.Dir(filepath.Dir(claudeSkills)), strings.TrimPrefix(expanded, "~"+string(filepath.Separator)))
		}
		if claudeSkills != "" && sameTarget(expanded, claudeSkills) {
			return "via " + claudeSkills
		}
		if sameTarget(expanded, vaultSkills) {
			return "via the vault directly"
		}
	}
	return "pi settings do not point at the synced skills"
}

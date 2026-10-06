// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/skills"
)

// Paths are the locations one sync run reads and writes. Passed explicitly rather than read from
// globals so tests drive a temp home without stubbing package state.
type Paths struct {
	Home        string
	SteeringDoc string
	SkillsRoot  string
	// Shipped holds the skills arcterm ships, one top-level directory each, seeded into SkillsRoot.
	// nil seeds nothing.
	Shipped fs.FS
}

func DefaultPaths() Paths {
	return Paths{
		Home:        wavebase.GetHomeDir(),
		SteeringDoc: memroots.SteeringDocPath(),
		SkillsRoot:  memroots.SkillsRoot(),
		Shipped:     skills.FS,
	}
}

const (
	ActionSteeringWrite  = "steering-write"
	ActionSkillWrite     = "skill-write"
	ActionSkillRemove    = "skill-remove"
	ActionSkillUnmanaged = "skill-unmanaged"
)

// Action is one change a sync run made, or would make under dryRun.
type Action struct {
	Kind    string `json:"kind"`
	Runtime string `json:"runtime"`
	Path    string `json:"path"`
	Detail  string `json:"detail,omitempty"`
}

// configRootExists gates every write: arcterm syncs a harness only once the user has actually run it.
func configRootExists(spec harness.Spec, home string) bool {
	root := spec.ConfigRoot(home)
	if root == "" {
		return false
	}
	st, err := os.Stat(root)
	return err == nil && st.IsDir()
}

// projectSteering writes the canonical body into each present harness's steering region. A render
// identical to what is already on disk is not written, so mtimes stay meaningful for status.
func projectSteering(p Paths, dryRun bool) ([]Action, error) {
	body, err := os.ReadFile(p.SteeringDoc)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // nothing canonical yet
		}
		return nil, fmt.Errorf("reading canonical steering doc: %w", err)
	}
	var actions []Action
	for _, spec := range harness.List() {
		if !configRootExists(spec, p.Home) {
			continue
		}
		target := spec.SteeringPath(p.Home)
		existing, readErr := os.ReadFile(target)
		if readErr != nil && !os.IsNotExist(readErr) {
			return actions, fmt.Errorf("reading %s: %w", target, readErr)
		}
		next := applyRegion(string(existing), string(body))
		if next == string(existing) {
			continue
		}
		actions = append(actions, Action{Kind: ActionSteeringWrite, Runtime: spec.Runtime, Path: target})
		if dryRun {
			continue
		}
		if err := os.WriteFile(target, []byte(next), 0o644); err != nil {
			return actions, fmt.Errorf("writing %s: %w", target, err)
		}
	}
	return actions, nil
}

// WriteResult is the outcome of a steering write: a conflict means the file changed under the editor
// and nothing was written.
type WriteResult struct {
	Mtime    int64
	Conflict bool
}

// WriteSteering replaces the canonical document, refusing when it changed since baseMtime. A
// baseMtime of 0 means "the caller has not read it yet" and skips the check.
func WriteSteering(p Paths, content string, baseMtime int64) (WriteResult, error) {
	if st, err := os.Stat(p.SteeringDoc); err == nil && baseMtime != 0 && st.ModTime().UnixMilli() != baseMtime {
		return WriteResult{Mtime: st.ModTime().UnixMilli(), Conflict: true}, nil
	}
	if err := os.MkdirAll(filepath.Dir(p.SteeringDoc), 0o755); err != nil {
		return WriteResult{}, err
	}
	if err := os.WriteFile(p.SteeringDoc, []byte(content), 0o644); err != nil {
		return WriteResult{}, err
	}
	st, err := os.Stat(p.SteeringDoc)
	if err != nil {
		return WriteResult{}, err
	}
	return WriteResult{Mtime: st.ModTime().UnixMilli()}, nil
}

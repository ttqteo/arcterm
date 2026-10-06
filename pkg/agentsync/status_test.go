// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStatusReportsSteeringState(t *testing.T) {
	p := testPaths(t, "canonical rules\n", ".codex")
	byRuntime := func() map[string]HarnessStatus {
		st, err := Status(p)
		if err != nil {
			t.Fatal(err)
		}
		m := map[string]HarnessStatus{}
		for _, s := range st {
			m[s.Runtime] = s
		}
		return m
	}

	if got := byRuntime()["codex"]; got.Steering != "absent" || !got.Present {
		t.Fatalf("before projection: %+v, want present with absent steering", got)
	}
	if got := byRuntime()["pi"]; got.Present {
		t.Fatalf("pi has no config root here: %+v", got)
	}
	if got := byRuntime()["codex"]; got.Path != filepath.Join(p.Home, ".codex", "AGENTS.md") {
		t.Fatalf("codex path = %q, want its steering file", got.Path)
	}
	if got := byRuntime()["pi"]; got.Path == "" {
		t.Fatalf("pi is not installed but its row still needs a path: %+v", got)
	}
	if _, err := Apply(p, false); err != nil {
		t.Fatal(err)
	}
	if got := byRuntime()["codex"]; got.Steering != "current" {
		t.Fatalf("after projection: %+v, want current", got)
	}
	if err := os.WriteFile(p.SteeringDoc, []byte("changed rules\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := byRuntime()["codex"]; got.Steering != "stale" {
		t.Fatalf("after canonical edit: %+v, want stale", got)
	}
}

func TestStatusCountsManagedAndUnmanagedSkills(t *testing.T) {
	p := testPaths(t, "canonical\n", ".codex")
	seedSkill(t, p, "graphify")
	seedSkill(t, p, "effort-tracking")
	// the user's own directory under a canonical name: arcterm writes neither it nor a rendered copy
	occupied := filepath.Join(p.Home, ".codex", "skills", "graphify")
	writeFile(t, filepath.Join(occupied, "SKILL.md"), "mine\n")
	if _, err := Apply(p, false); err != nil {
		t.Fatal(err)
	}
	st, err := Status(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range st {
		if s.Runtime != "codex" {
			continue
		}
		if s.SkillsManaged != 1 || s.SkillsUnmanaged != 1 {
			t.Fatalf("codex = %+v, want 1 managed and 1 unmanaged", s)
		}
	}
}

func TestPiSkillsNote(t *testing.T) {
	claudeSkills := filepath.Join("C:", "Users", "k", ".claude", "skills")
	vaultSkills := filepath.Join("C:", "vault", "skills")
	if note := piSkillsNote([]string{claudeSkills, "!" + filepath.Join(claudeSkills, "simplify")}, claudeSkills, vaultSkills); note == "" {
		t.Error("a pointer at the claude skills dir must be reported as reaching the farm")
	}
	if note := piSkillsNote([]string{vaultSkills}, claudeSkills, vaultSkills); note == "" {
		t.Error("a pointer straight at the vault must be reported as reaching the farm")
	}
	if note := piSkillsNote([]string{filepath.Join("C:", "elsewhere")}, claudeSkills, vaultSkills); note == "" {
		t.Error("a pointer at neither must produce a warning note, not an empty one")
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestAdoptSeedsTheFirstCopyIntoTheVault(t *testing.T) {
	p := testPaths(t, "", ".claude")
	writeFile(t, filepath.Join(p.Home, ".claude", "CLAUDE.md"), "# Prefs\n")
	writeFile(t, filepath.Join(p.Home, ".claude", "skills", "graphify", skillFile), "---\nname: graphify\n---\nbody\n")

	plan, err := Adopt(p, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Moves) != 1 || !plan.Moves[0].Seed {
		t.Fatalf("plan = %+v, want one seeding move", plan)
	}
	if got := readFile(t, filepath.Join(p.SkillsRoot, "graphify", skillFile)); got != "---\nname: graphify\n---\nbody\n" {
		t.Fatalf("canonical skill = %q", got)
	}
	// and it comes straight back as a managed copy
	back := filepath.Join(p.Home, ".claude", "skills", "graphify")
	if _, err := os.Stat(filepath.Join(back, managedMarkName)); err != nil {
		t.Fatalf("the adopted skill was not rendered back: %v", err)
	}
	if _, err := os.Stat(filepath.Join(p.SkillsRoot, "graphify", managedMarkName)); !os.IsNotExist(err) {
		t.Error("the canonical tree must not carry the ownership mark")
	}
}

// adopting moves the user's skills out of the harness into the vault: the final stage's dev app, on a vault of its
// own, would carry them off
func TestAdoptRefusesWhenItMustKeepTheHarnesses(t *testing.T) {
	p := testPaths(t, "", ".claude")
	p.KeepHarnesses = true
	src := filepath.Join(p.Home, ".claude", "skills", "graphify", skillFile)
	writeFile(t, src, "---\nname: graphify\n---\nbody\n")

	if _, err := Adopt(p, true, nil); err == nil {
		t.Fatal("Adopt applied with KeepHarnesses set")
	}
	if got := readFile(t, src); got != "---\nname: graphify\n---\nbody\n" {
		t.Fatalf("the user's skill = %q, want it where it was", got)
	}
	if plan, err := Adopt(p, false, nil); err != nil || len(plan.Moves) != 1 {
		t.Fatalf("the plan = %+v, %v: a dry run still plans", plan, err)
	}
}

func TestAdoptTurnsAFrontmatterVariantIntoADelta(t *testing.T) {
	p := testPaths(t, "", ".codex", ".config/opencode")
	writeFile(t, filepath.Join(p.Home, ".codex", "AGENTS.md"), "# Prefs\n")
	writeFile(t, filepath.Join(p.Home, ".codex", "skills", "orch", skillFile),
		"---\nname: orch\ntool: codex\n---\nsame body\n")
	writeFile(t, filepath.Join(p.Home, ".config", "opencode", "skills", "orch", skillFile),
		"---\nname: orch\ntool: opencode\n---\nsame body\n")

	plan, err := Adopt(p, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Unresolved) != 0 {
		t.Fatalf("a frontmatter-only variant must not be unresolved: %+v", plan.Unresolved)
	}
	if got := readFile(t, filepath.Join(p.SkillsRoot, "orch", deltaDirName, "opencode.yaml")); got != "tool: opencode\n" {
		t.Fatalf("opencode delta = %q, want only the differing key", got)
	}
	// each harness ends up with its own flavour of the same shared body
	codex := readFile(t, filepath.Join(p.Home, ".codex", "skills", "orch", skillFile))
	opencode := readFile(t, filepath.Join(p.Home, ".config", "opencode", "skills", "orch", skillFile))
	if codex != "---\nname: orch\ntool: codex\n---\nsame body\n" {
		t.Fatalf("codex copy = %q", codex)
	}
	if opencode != "---\nname: orch\ntool: opencode\n---\nsame body\n" {
		t.Fatalf("opencode copy = %q", opencode)
	}
}

func TestAdoptTurnsASidecarIntoADelta(t *testing.T) {
	p := testPaths(t, "", ".claude", ".codex")
	writeFile(t, filepath.Join(p.Home, ".claude", "CLAUDE.md"), "# Prefs\n")
	writeFile(t, filepath.Join(p.Home, ".claude", "skills", "simplify", skillFile), "---\nname: simplify\n---\nbody\n")
	writeFile(t, filepath.Join(p.Home, ".codex", "skills", "simplify", skillFile), "---\nname: simplify\n---\nbody\n")
	writeFile(t, filepath.Join(p.Home, ".codex", "skills", "simplify", "agents", "openai.yaml"), "display_name: Simplify\n")

	if _, err := Adopt(p, true, nil); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, filepath.Join(p.SkillsRoot, "simplify", deltaDirName, "codex", "agents", "openai.yaml")); got != "display_name: Simplify\n" {
		t.Fatalf("codex sidecar delta = %q", got)
	}
	if _, err := os.Stat(filepath.Join(p.Home, ".codex", "skills", "simplify", "agents", "openai.yaml")); err != nil {
		t.Errorf("codex lost its sidecar: %v", err)
	}
	if _, err := os.Stat(filepath.Join(p.Home, ".claude", "skills", "simplify", "agents", "openai.yaml")); !os.IsNotExist(err) {
		t.Error("codex's sidecar must not reach claude")
	}
}

func TestAdoptLeavesABodyConflictExactlyWhereItIs(t *testing.T) {
	p := testPaths(t, "", ".claude", ".codex")
	writeFile(t, filepath.Join(p.Home, ".claude", "CLAUDE.md"), "# Prefs\n")
	writeFile(t, filepath.Join(p.Home, ".claude", "skills", "review", skillFile), "---\nname: review\n---\nclaude body\n")
	writeFile(t, filepath.Join(p.Home, ".codex", "skills", "review", skillFile), "---\nname: review\n---\ncodex body\n")

	plan, err := Adopt(p, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(plan.Unresolved, []string{"review"}) {
		t.Fatalf("unresolved = %#v, want the body conflict named", plan.Unresolved)
	}
	if _, err := os.Stat(filepath.Join(p.SkillsRoot, "review")); !os.IsNotExist(err) {
		t.Error("nothing may be moved into the vault while the bodies disagree")
	}
	if got := readFile(t, filepath.Join(p.Home, ".claude", "skills", "review", skillFile)); got != "---\nname: review\n---\nclaude body\n" {
		t.Errorf("claude copy was touched: %q", got)
	}
	if got := readFile(t, filepath.Join(p.Home, ".codex", "skills", "review", skillFile)); got != "---\nname: review\n---\ncodex body\n" {
		t.Errorf("codex copy was touched: %q", got)
	}
}

func TestPlanAdoptWritesNothing(t *testing.T) {
	p := testPaths(t, "", ".claude")
	writeFile(t, filepath.Join(p.Home, ".claude", "CLAUDE.md"), "# Prefs\n")
	writeFile(t, filepath.Join(p.Home, ".claude", "skills", "graphify", skillFile), "---\nname: graphify\n---\nbody\n")

	plan, err := Adopt(p, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Moves) != 1 {
		t.Fatalf("plan = %+v, want the move reported", plan)
	}
	if _, err := os.Stat(p.SkillsRoot); !os.IsNotExist(err) {
		t.Error("a dry run must not create the vault skills root")
	}
	if _, err := os.Stat(filepath.Join(p.Home, ".claude", "skills", "graphify", skillFile)); err != nil {
		t.Errorf("a dry run moved the source: %v", err)
	}
}

func TestAdoptSkipsWhatArcAlreadyOwns(t *testing.T) {
	p := testPaths(t, "", ".claude")
	writeFile(t, filepath.Join(p.Home, ".claude", "CLAUDE.md"), "# Prefs\n")
	seedSkill(t, p, "graphify")
	if _, err := Apply(p, false); err != nil {
		t.Fatal(err)
	}
	plan, err := Adopt(p, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Moves) != 0 {
		t.Fatalf("plan = %+v, want nothing to adopt", plan)
	}
}

// bodyConflict gives claude and codex differing copies of the review skill; claude is first in
// catalog order, so a keep for codex proves the choice overrides the order.
func bodyConflict(t *testing.T) Paths {
	t.Helper()
	p := testPaths(t, "", ".claude", ".codex")
	writeFile(t, filepath.Join(p.Home, ".claude", "CLAUDE.md"), "# Prefs\n")
	writeFile(t, filepath.Join(p.Home, ".claude", "skills", "review", skillFile), "---\nname: review\n---\nclaude body\n")
	writeFile(t, filepath.Join(p.Home, ".claude", "skills", "review", "notes.md"), "claude notes\n")
	writeFile(t, filepath.Join(p.Home, ".codex", "skills", "review", skillFile), "---\nname: review\n---\ncodex body\n")
	return p
}

func TestAdoptKeepSeedsTheChosenCopy(t *testing.T) {
	p := bodyConflict(t)

	plan, err := Adopt(p, true, map[string]string{"review": "codex"})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Unresolved) != 0 {
		t.Fatalf("a kept name must not be unresolved: %#v", plan.Unresolved)
	}
	for _, m := range plan.Moves {
		if m.Seed != (m.Runtime == "codex") {
			t.Fatalf("move %+v: only the kept codex copy may seed", m)
		}
	}
	if got := readFile(t, filepath.Join(p.SkillsRoot, "review", skillFile)); got != "---\nname: review\n---\ncodex body\n" {
		t.Fatalf("canonical skill = %q, want the kept codex copy", got)
	}
	// the reconcile renders the kept copy into claude too
	if got := readFile(t, filepath.Join(p.Home, ".claude", "skills", "review", skillFile)); got != "---\nname: review\n---\ncodex body\n" {
		t.Fatalf("claude copy = %q, want the kept body", got)
	}
	if _, err := os.Stat(filepath.Join(p.SkillsRoot, "review", deltaDirName)); !os.IsNotExist(err) {
		t.Error("a replaced copy must not become a delta")
	}
}

func TestAdoptKeepSetsTheOtherCopyAsideIntact(t *testing.T) {
	p := bodyConflict(t)
	replaced := filepath.Join(filepath.Dir(p.SkillsRoot), "skills-replaced", "claude", "review")
	// an earlier replacement already holds the plain name
	writeFile(t, filepath.Join(replaced, skillFile), "earlier\n")

	if _, err := Adopt(p, true, map[string]string{"review": "codex"}); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, filepath.Join(replaced, skillFile)); got != "earlier\n" {
		t.Errorf("the earlier replacement was overwritten: %q", got)
	}
	aside := replaced + "-2"
	if got := readFile(t, filepath.Join(aside, skillFile)); got != "---\nname: review\n---\nclaude body\n" {
		t.Errorf("set-aside SKILL.md = %q", got)
	}
	if got := readFile(t, filepath.Join(aside, "notes.md")); got != "claude notes\n" {
		t.Errorf("set-aside sidecar = %q", got)
	}
}

func TestAdoptRefusesAKeepWithNoCopy(t *testing.T) {
	p := bodyConflict(t)

	for _, keep := range []map[string]string{{"review": "opencode"}, {"missing": "claude"}} {
		if _, err := Adopt(p, true, keep); err == nil {
			t.Fatalf("keep %v: want an error", keep)
		}
	}
	if _, err := os.Stat(p.SkillsRoot); !os.IsNotExist(err) {
		t.Error("a bad keep must not create the vault skills root")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(p.SkillsRoot), "skills-replaced")); !os.IsNotExist(err) {
		t.Error("a bad keep must not set anything aside")
	}
	if got := readFile(t, filepath.Join(p.Home, ".claude", "skills", "review", skillFile)); got != "---\nname: review\n---\nclaude body\n" {
		t.Errorf("claude copy was touched: %q", got)
	}
	if got := readFile(t, filepath.Join(p.Home, ".codex", "skills", "review", skillFile)); got != "---\nname: review\n---\ncodex body\n" {
		t.Errorf("codex copy was touched: %q", got)
	}
}

// A harness keeps more than skills in its skills directory: Codex's bundled .system set, another tool's
// store with no SKILL.md. Adopt must neither list nor move them.
func TestAdoptIgnoresDirectoriesThatAreNotSkills(t *testing.T) {
	p := testPaths(t, "", ".codex")
	skills := filepath.Join(p.Home, ".codex", "skills")
	writeFile(t, filepath.Join(skills, ".system", "imagegen", skillFile), "bundled\n")
	writeFile(t, filepath.Join(skills, "synced", "bucket", "blob"), "data\n")
	writeFile(t, filepath.Join(skills, "graphify", skillFile), "---\nname: graphify\n---\nbody\n")

	plan, err := Adopt(p, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Moves) != 1 || plan.Moves[0].Name != "graphify" {
		t.Fatalf("plan = %+v, want only the real skill", plan)
	}
	for _, left := range []string{filepath.Join(".system", "imagegen", skillFile), filepath.Join("synced", "bucket", "blob")} {
		if _, err := os.Stat(filepath.Join(skills, left)); err != nil {
			t.Errorf("%s moved: %v", left, err)
		}
	}
	st, err := Status(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range st {
		if s.Runtime == "codex" && s.SkillsUnmanaged != 0 {
			t.Fatalf("codex = %+v, want no unmanaged skills once graphify is adopted", s)
		}
	}
}

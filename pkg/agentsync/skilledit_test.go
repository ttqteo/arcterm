// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

func TestReadSkillReturnsTheVaultDoc(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes-plus")
	doc, err := ReadSkill(p, "notes-plus")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Content != "---\nname: notes-plus\n---\nbody\n" || doc.Mtime == 0 {
		t.Fatalf("doc = %#v", doc)
	}
	if doc.Path != filepath.Join(p.SkillsRoot, "notes-plus", skillFile) {
		t.Errorf("path = %q", doc.Path)
	}
}

func TestReadSkillRefusesNamesOutsideTheVault(t *testing.T) {
	p := testPaths(t, "")
	writeFile(t, filepath.Join(filepath.Dir(p.SkillsRoot), "secret", skillFile), "x")
	for _, name := range []string{"../secret", "missing", "", "A"} {
		if _, err := ReadSkill(p, name); err == nil {
			t.Errorf("ReadSkill(%q) must fail", name)
		}
	}
}

func TestWriteSkillReplacesTheDocAndGuardsTheMtime(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes-plus")
	doc, err := ReadSkill(p, "notes-plus")
	if err != nil {
		t.Fatal(err)
	}
	res, err := WriteSkill(p, "notes-plus", "edited\n", doc.Mtime)
	if err != nil || res.Conflict {
		t.Fatalf("write = %#v, %v", res, err)
	}
	if got := readFile(t, doc.Path); got != "edited\n" {
		t.Fatalf("SKILL.md = %q", got)
	}
	// an outside edit after the read: the stale base must conflict and write nothing
	later := time.UnixMilli(res.Mtime).Add(2 * time.Second)
	writeFile(t, doc.Path, "outside\n")
	if err := os.Chtimes(doc.Path, later, later); err != nil {
		t.Fatal(err)
	}
	res, err = WriteSkill(p, "notes-plus", "mine\n", doc.Mtime)
	if err != nil || !res.Conflict {
		t.Fatalf("a stale base must conflict: %#v, %v", res, err)
	}
	if got := readFile(t, doc.Path); got != "outside\n" {
		t.Fatalf("a conflict must not write: %q", got)
	}
	// overwrite sends 0
	if res, err = WriteSkill(p, "notes-plus", "mine\n", 0); err != nil || res.Conflict {
		t.Fatalf("overwrite = %#v, %v", res, err)
	}
	if got := readFile(t, doc.Path); got != "mine\n" {
		t.Fatalf("overwrite did not land: %q", got)
	}
}

func TestWriteSkillRefusesAShippedSkill(t *testing.T) {
	p := testPaths(t, "")
	p.Shipped = shippedFS()
	if err := seedShippedSkills(p.SkillsRoot, p.Shipped); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteSkill(p, "design-local", "edited\n", 0); err == nil {
		t.Fatal("a shipped skill must not be written")
	}
	if got := readFile(t, filepath.Join(p.SkillsRoot, "design-local", skillFile)); got != "---\nname: design-local\n---\nshipped\n" {
		t.Errorf("shipped SKILL.md changed: %q", got)
	}
}

func TestCreateSkillWritesAFrontmatterThatParses(t *testing.T) {
	p := testPaths(t, "")
	doc, err := CreateSkill(p, "trade-check", `Use when: checking "positions" #now`)
	if err != nil {
		t.Fatal(err)
	}
	block, rest, ok := splitFrontmatter(doc.Content)
	if !ok {
		t.Fatalf("no frontmatter: %q", doc.Content)
	}
	var fm struct{ Name, Description string }
	if err := yaml.Unmarshal([]byte(block), &fm); err != nil {
		t.Fatal(err)
	}
	if fm.Name != "trade-check" || fm.Description != `Use when: checking "positions" #now` {
		t.Errorf("frontmatter = %#v", fm)
	}
	if !strings.HasPrefix(rest, "\n# trade-check") {
		t.Errorf("body = %q", rest)
	}
	rows, err := SkillRows(p)
	if err != nil || len(rows) != 1 || rows[0].Name != "trade-check" {
		t.Fatalf("the new skill must be a canonical row: %#v, %v", rows, err)
	}
}

func TestCreateSkillRefusesBadOrTakenNames(t *testing.T) {
	p := testPaths(t, "", ".claude")
	p.Shipped = shippedFS()
	seedSkill(t, p, "taken")
	writeFile(t, filepath.Join(p.Home, ".claude", "skills", "mine", skillFile), "own copy\n")
	for _, name := range []string{"Bad", "two  words", "-lead", "trail-", "a--b", "../up", strings.Repeat("a", 65)} {
		if _, err := CreateSkill(p, name, "d"); err == nil {
			t.Errorf("CreateSkill(%q) must fail", name)
		}
	}
	for _, name := range []string{"taken", "design-local", "mine"} {
		if _, err := CreateSkill(p, name, "d"); !errors.Is(err, ErrSkillExists) {
			t.Errorf("CreateSkill(%q) = %v, want ErrSkillExists", name, err)
		}
	}
	if _, err := CreateSkill(p, "fresh", ""); err == nil {
		t.Error("a skill without a description must be refused")
	}
	if _, err := os.Stat(filepath.Join(p.SkillsRoot, "fresh")); !os.IsNotExist(err) {
		t.Error("a refused create must leave no directory")
	}
}

func TestSkillRowsMarkShippedAndColumnsCarryTheirFolder(t *testing.T) {
	p := testPaths(t, "", ".claude")
	p.Shipped = shippedFS()
	if err := seedShippedSkills(p.SkillsRoot, p.Shipped); err != nil {
		t.Fatal(err)
	}
	seedSkill(t, p, "own-skill")
	rows, err := SkillRows(p)
	if err != nil {
		t.Fatal(err)
	}
	shipped := map[string]bool{}
	for _, r := range rows {
		shipped[r.Name] = r.Shipped
	}
	if !shipped["design-local"] || shipped["own-skill"] {
		t.Errorf("shipped = %#v", shipped)
	}
	for _, c := range SkillColumns(p) {
		if c.Runtime == "claude" && c.Path != filepath.Join(p.Home, ".claude", "skills") {
			t.Errorf("claude column path = %q", c.Path)
		}
	}
}

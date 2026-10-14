// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestUpsertAdditionWritesThenReplacesByKey(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes")
	if err := UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "notes-vi", Text: "Write notes in Vietnamese", Learned: "2026-10-12", Count: 2}); err != nil {
		t.Fatal(err)
	}
	if err := UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "notes-vi", Text: "Always write notes in Vietnamese", Learned: "2026-10-14", Count: 1}); err != nil {
		t.Fatal(err)
	}
	got, _ := ReadAdditions(p.SkillsRoot, "notes")
	want := []Addition{{Key: "notes-vi", Text: "Always write notes in Vietnamese", Learned: "2026-10-14", Count: 3}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
}

func TestUpsertAdditionRefusesAMissingSkillAndTheCap(t *testing.T) {
	p := testPaths(t, "")
	if err := UpsertAddition(p.SkillsRoot, "ghost", Addition{Key: "k", Text: "t", Learned: "2026-10-14", Count: 1}); !errors.Is(err, ErrNoSkill) {
		t.Fatalf("want ErrNoSkill, got %v", err)
	}
	seedSkill(t, p, "notes")
	for i := 0; i < MaxAdditions; i++ {
		if err := UpsertAddition(p.SkillsRoot, "notes", Addition{Key: fmt.Sprintf("k%d", i), Text: "t", Learned: "2026-10-14", Count: 1}); err != nil {
			t.Fatal(err)
		}
	}
	if err := UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "one-more", Text: "t", Learned: "2026-10-14", Count: 1}); !errors.Is(err, ErrAdditionsFull) {
		t.Fatalf("want ErrAdditionsFull, got %v", err)
	}
	// replacing an existing key at the cap is still allowed
	if err := UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "k0", Text: "t2", Learned: "2026-10-14", Count: 1}); err != nil {
		t.Fatal(err)
	}
}

func TestUpsertAdditionRefusesALineItCouldNotReadBack(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes")
	for name, a := range map[string]Addition{
		"two lines":   {Key: "k", Text: "one\ntwo", Learned: "2026-10-14", Count: 1},
		"empty text":  {Key: "k", Text: "", Learned: "2026-10-14", Count: 1},
		"bad key":     {Key: "Not A Key", Text: "t", Learned: "2026-10-14", Count: 1},
		"bad date":    {Key: "k", Text: "t", Learned: "14/10/2026", Count: 1},
		"bad count":   {Key: "k", Text: "t", Learned: "2026-10-14", Count: -1},
		"empty key":   {Key: "", Text: "t", Learned: "2026-10-14", Count: 1},
		"carriage rt": {Key: "k", Text: "one\rtwo", Learned: "2026-10-14", Count: 1},
	} {
		if err := UpsertAddition(p.SkillsRoot, "notes", a); err == nil {
			t.Errorf("%s: want an error, got nil", name)
		}
	}
	if got, _ := ReadAdditions(p.SkillsRoot, "notes"); len(got) != 0 {
		t.Fatalf("a refused line must write nothing, got %+v", got)
	}
}

func TestRemoveAddition(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes")
	_ = UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "a", Text: "A", Learned: "2026-10-14", Count: 1})
	_ = UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "b", Text: "B", Learned: "2026-10-14", Count: 1})
	if err := RemoveAddition(p.SkillsRoot, "notes", "a"); err != nil {
		t.Fatal(err)
	}
	got, _ := ReadAdditions(p.SkillsRoot, "notes")
	if len(got) != 1 || got[0].Key != "b" {
		t.Fatalf("got %+v", got)
	}
}

func TestRemoveAdditionIsANoOpWhenAbsentAndDropsTheFileWhenEmpty(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes")
	if err := RemoveAddition(p.SkillsRoot, "notes", "ghost"); err != nil {
		t.Fatalf("removing from a skill with no additions: %v", err)
	}
	_ = UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "a", Text: "A", Learned: "2026-10-14", Count: 1})
	if err := RemoveAddition(p.SkillsRoot, "notes", "ghost"); err != nil {
		t.Fatalf("removing an absent key: %v", err)
	}
	if got, _ := ReadAdditions(p.SkillsRoot, "notes"); len(got) != 1 {
		t.Fatalf("an absent key must leave the list alone, got %+v", got)
	}
	if err := RemoveAddition(p.SkillsRoot, "notes", "a"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(p.SkillsRoot, "notes", deltaDirName, additionsFile)); !os.IsNotExist(err) {
		t.Fatalf("an empty list must remove additions.md, stat err = %v", err)
	}
}

func TestReadAdditionsSkipsLinesItDoesNotRecognise(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes")
	writeFile(t, filepath.Join(p.SkillsRoot, "notes", deltaDirName, additionsFile),
		"a stray note\r\n- kept <!-- arc:learn key=k1 learned=2026-10-14 count=2 -->\r\n- no marker\n")
	got, err := ReadAdditions(p.SkillsRoot, "notes")
	if err != nil {
		t.Fatal(err)
	}
	want := []Addition{{Key: "k1", Text: "kept", Learned: "2026-10-14", Count: 2}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
}

func TestRenderSkillAppendsAdditionsForEveryRuntime(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes")
	_ = UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "notes-vi", Text: "Write notes in Vietnamese", Learned: "2026-10-14", Count: 3})
	for _, rt := range []string{"claude", "codex"} {
		files, err := renderSkill(p.SkillsRoot, "notes", rt)
		if err != nil {
			t.Fatal(err)
		}
		md := string(files["SKILL.md"])
		want := "\n## Your additions\n<!-- arc:user -->\nThese are the user's own rules; where they conflict with the text above, they win.\n\n- Write notes in Vietnamese (learned 2026-10-14, 3×)\n"
		if !strings.HasSuffix(md, want) {
			t.Fatalf("%s: SKILL.md does not end with the additions:\n%s", rt, md)
		}
		if _, leaked := files[filepath.Join(".arc", "additions.md")]; leaked {
			t.Fatalf("%s: .arc/additions.md must not be copied", rt)
		}
	}
}

func TestRenderSkillWithoutAdditionsIsUnchanged(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes")
	files, err := renderSkill(p.SkillsRoot, "notes", "claude")
	if err != nil {
		t.Fatal(err)
	}
	if got := string(files["SKILL.md"]); got != "---\nname: notes\n---\nbody\n" {
		t.Fatalf("SKILL.md = %q, want the vault text untouched", got)
	}
}

func TestApplyWritesAdditionsIntoTheHarnessSkill(t *testing.T) {
	p := testPaths(t, "", ".claude")
	seedSkill(t, p, "notes")
	_ = UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "notes-vi", Text: "Write notes in Vietnamese", Learned: "2026-10-14", Count: 3})
	if _, err := Apply(p, false); err != nil {
		t.Fatal(err)
	}
	md, err := os.ReadFile(filepath.Join(p.Home, ".claude", "skills", "notes", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(md), "\n## Your additions\n<!-- arc:user -->\n") || !strings.HasSuffix(string(md), "- Write notes in Vietnamese (learned 2026-10-14, 3×)\n") {
		t.Fatalf("the projected SKILL.md lacks the additions:\n%s", md)
	}
}

func TestSeedShippedSkillsKeepsAdditions(t *testing.T) {
	root := filepath.Join(t.TempDir(), "skills")
	if err := seedShippedSkills(root, shippedFS()); err != nil {
		t.Fatal(err)
	}
	a := Addition{Key: "runs-short", Text: "Keep run goals to one line", Learned: "2026-10-14", Count: 2}
	if err := UpsertAddition(root, "cockpit-runs", a); err != nil {
		t.Fatal(err)
	}
	if err := seedShippedSkills(root, shippedFS()); err != nil {
		t.Fatal(err)
	}
	got, err := ReadAdditions(root, "cockpit-runs")
	if err != nil {
		t.Fatal(err)
	}
	if want := []Addition{a}; !reflect.DeepEqual(got, want) {
		t.Fatalf("a reseed must keep the additions, got %+v", got)
	}
	// and the shipped body is still the shipped body, with no additions text mixed into the vault copy
	if got := readFile(t, filepath.Join(root, "cockpit-runs", skillFile)); got != "---\nname: cockpit-runs\n---\nshipped\n" {
		t.Errorf("vault SKILL.md = %q, want the shipped copy alone", got)
	}
}

func TestSkillRowsCarryTheAdditions(t *testing.T) {
	p := testPaths(t, "", ".claude")
	seedSkill(t, p, "notes")
	seedSkill(t, p, "plain")
	a := Addition{Key: "notes-vi", Text: "Write notes in Vietnamese", Learned: "2026-10-14", Count: 3}
	if err := UpsertAddition(p.SkillsRoot, "notes", a); err != nil {
		t.Fatal(err)
	}
	rows, err := SkillRows(p)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]SkillRow{}
	for _, r := range rows {
		byName[r.Name] = r
	}
	if got := byName["notes"].Additions; !reflect.DeepEqual(got, []Addition{a}) {
		t.Fatalf("notes additions = %+v", got)
	}
	if got := byName["plain"].Additions; got != nil {
		t.Fatalf("plain additions = %+v, want none", got)
	}
	if got := byName["notes"].Deltas; got != nil {
		t.Fatalf("additions.md is not a per-harness delta, got %+v", got)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeBench fills a data dir the way Phase 0 left it: council-bench/cases.json, a key file per entry in keys (by case
// id; a case with none has a key path that points nowhere), and a project folder for every entry.
func writeBench(t *testing.T, dir string, cases []map[string]any, keys map[string]string) {
	t.Helper()
	benchDir := filepath.Join(dir, "council-bench")
	if err := os.MkdirAll(filepath.Join(benchDir, "keys"), 0o755); err != nil {
		t.Fatal(err)
	}
	for id, text := range keys {
		if err := os.WriteFile(filepath.Join(benchDir, "keys", id+".md"), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range cases {
		if p, _ := c["project"].(string); p != "" {
			if err := os.MkdirAll(p, 0o755); err != nil {
				t.Fatal(err)
			}
		}
	}
	data, err := json.MarshalIndent(cases, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(benchDir, "cases.json"), data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// phase0Case is a cases.json entry as Phase 0 wrote it, with its project and key under dir.
func phase0Case(dir, id, mode string) map[string]any {
	return map[string]any{
		"id":         id,
		"mode":       mode,
		"project":    filepath.ToSlash(filepath.Join(dir, "council-bench-projects", id)),
		"group":      "ui-feature",
		"solo_group": "solo-ui",
		"feature":    "Council, for a first-time user",
		"question":   "A newcomer opens a council and cannot tell what to do. How should it change?",
		"files":      "frontend/a.tsx, frontend/b.tsx,docs/spec.md",
		"key":        filepath.ToSlash(filepath.Join(dir, "council-bench", "keys", id+".md")),
	}
}

const newcomerKey = `K1: Open a finished council on its report first and move the debate behind it.
K2: Plain words instead of code words (Accept/Challenge/Oppose, Split, P-ids).

K3: The vote as top-3 picks, with agreement as a reaction.
`

func TestLoadCasesPhase0Shape(t *testing.T) {
	dir := t.TempDir()
	writeBench(t, dir, []map[string]any{phase0Case(dir, "newcomer", "brainstorm")}, map[string]string{"newcomer": newcomerKey})

	got, warnings, err := LoadCases(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Fatalf("warnings = %v, want none", warnings)
	}
	if len(got) != 1 {
		t.Fatalf("cases = %d, want 1", len(got))
	}
	c := got[0]
	if c.Id != "newcomer" || c.Mode != "brainstorm" || c.Group != "ui-feature" || c.SoloGroup != "solo-ui" {
		t.Errorf("case = %+v", c)
	}
	if c.Feature != "Council, for a first-time user" || !strings.HasPrefix(c.Question, "A newcomer opens") {
		t.Errorf("feature/question = %q / %q", c.Feature, c.Question)
	}
	if want := []string{"frontend/a.tsx", "frontend/b.tsx", "docs/spec.md"}; strings.Join(c.FileList(), "|") != strings.Join(want, "|") {
		t.Errorf("FileList = %v, want %v", c.FileList(), want)
	}
	if len(c.KeyLines) != 3 {
		t.Fatalf("key lines = %v, want 3", c.KeyLines)
	}
	if c.KeyLines[0].Id != "K1" || c.KeyLines[2].Id != "K3" ||
		c.KeyLines[1].Text != "Plain words instead of code words (Accept/Challenge/Oppose, Split, P-ids)." {
		t.Errorf("key lines = %+v", c.KeyLines)
	}
}

func TestLoadCasesSkipsMissingProject(t *testing.T) {
	dir := t.TempDir()
	cases := []map[string]any{phase0Case(dir, "gone", "review"), phase0Case(dir, "kept", "review")}
	writeBench(t, dir, cases, map[string]string{"gone": newcomerKey, "kept": newcomerKey})
	if err := os.RemoveAll(cases[0]["project"].(string)); err != nil {
		t.Fatal(err)
	}

	got, warnings, err := LoadCases(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Id != "kept" {
		t.Fatalf("cases = %+v, want only kept", got)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "gone") || !strings.Contains(warnings[0], "project") {
		t.Errorf("warnings = %v, want one naming case gone and its project", warnings)
	}
}

func TestLoadCasesSkipsMissingKey(t *testing.T) {
	dir := t.TempDir()
	cases := []map[string]any{phase0Case(dir, "nokey", "review"), phase0Case(dir, "emptykey", "review"), phase0Case(dir, "kept", "brainstorm")}
	writeBench(t, dir, cases, map[string]string{"emptykey": "no key lines here\n", "kept": newcomerKey})

	got, warnings, err := LoadCases(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Id != "kept" {
		t.Fatalf("cases = %+v, want only kept", got)
	}
	if len(warnings) != 2 {
		t.Fatalf("warnings = %v, want 2", warnings)
	}
	if !strings.Contains(warnings[0], "nokey") || !strings.Contains(warnings[0], "key") {
		t.Errorf("warnings[0] = %q, want it to name case nokey and its key", warnings[0])
	}
	if !strings.Contains(warnings[1], "emptykey") || !strings.Contains(warnings[1], "no key lines") {
		t.Errorf("warnings[1] = %q, want it to name case emptykey and say its key has no lines", warnings[1])
	}
}

func TestLoadCasesSkipsUnusableEntries(t *testing.T) {
	dir := t.TempDir()
	badMode := phase0Case(dir, "badmode", "debate")
	noMode := phase0Case(dir, "nomode", "")
	delete(noMode, "mode")
	dup := phase0Case(dir, "nomode", "review")
	noID := phase0Case(dir, "noid", "review")
	noID["id"] = ""
	writeBench(t, dir, []map[string]any{badMode, noMode, dup, noID}, map[string]string{"badmode": newcomerKey, "nomode": newcomerKey, "noid": newcomerKey})

	got, warnings, err := LoadCases(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Id != "nomode" || got[0].Mode != "review" {
		t.Fatalf("cases = %+v, want nomode alone, mode read as review", got)
	}
	if len(warnings) != 3 {
		t.Fatalf("warnings = %v, want 3 (unknown mode, repeated id, no id)", warnings)
	}
}

func TestLoadCasesNoFile(t *testing.T) {
	dir := t.TempDir()
	_, _, err := LoadCases(dir)
	if err == nil {
		t.Fatal("want an error when cases.json is missing")
	}
	if !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("err = %v, want it to wrap fs.ErrNotExist", err)
	}
	path := filepath.Join(dir, "council-bench", "cases.json")
	if !strings.Contains(err.Error(), path) {
		t.Errorf("err = %q, want it to name %s", err, path)
	}
	if !strings.Contains(err.Error(), "Phase 0b") {
		t.Errorf("err = %q, want it to say Phase 0b's tasks build the cases", err)
	}
}

func TestLoadCasesBadFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "council-bench"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "council-bench", "cases.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadCases(dir); err == nil || !strings.Contains(err.Error(), "cases.json") {
		t.Errorf("err = %v, want a parse error naming cases.json", err)
	}
}

func TestPlanOrderAndEstimate(t *testing.T) {
	cases := []Case{{Id: "alpha"}, {Id: "beta"}}
	items, estimate, err := Plan(cases, Options{Runs: 2})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, it := range items {
		got = append(got, it.Case+"/"+it.Variant+"/"+string(rune('0'+it.Run)))
	}
	want := []string{
		"alpha/solo/1", "alpha/solo/2", "alpha/council/1", "alpha/council/2",
		"beta/solo/1", "beta/solo/2", "beta/council/1", "beta/council/2",
	}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("items = %v\nwant    %v", got, want)
	}
	if wantEst := int64(2 * 2 * (550_000 + 1_400_000)); estimate != wantEst {
		t.Errorf("estimate = %d, want %d", estimate, wantEst)
	}
}

func TestPlanDefaultsAndSelection(t *testing.T) {
	cases := []Case{{Id: "alpha"}, {Id: "beta"}, {Id: "gamma"}}

	items, estimate, err := Plan(cases, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 6 || items[0].Run != 1 {
		t.Errorf("default plan = %+v, want 3 cases x solo and council x 1 run", items)
	}
	if estimate != 3*(550_000+1_400_000) {
		t.Errorf("default estimate = %d", estimate)
	}

	items, estimate, err = Plan(cases, Options{Cases: []string{"gamma", "alpha", "gamma"}, Variants: []string{"council"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Case != "gamma" || items[1].Case != "alpha" || items[0].Variant != "council" {
		t.Errorf("selected plan = %+v, want gamma then alpha (the repeat dropped), council only", items)
	}
	if estimate != 2*1_400_000 {
		t.Errorf("selected estimate = %d", estimate)
	}
}

func TestPlanUnknownName(t *testing.T) {
	cases := []Case{{Id: "alpha"}}
	if _, _, err := Plan(cases, Options{Cases: []string{"nope"}}); err == nil || !strings.Contains(err.Error(), `"nope"`) || !strings.Contains(err.Error(), "alpha") {
		t.Errorf("unknown case: err = %v, want it to name nope and the known cases", err)
	}
	if _, _, err := Plan(cases, Options{Variants: []string{"v3"}}); err == nil || !strings.Contains(err.Error(), `"v3"`) || !strings.Contains(err.Error(), "solo") {
		t.Errorf("unknown variant: err = %v, want it to name v3 and the known variants", err)
	}
	if _, _, err := Plan(cases, Options{Runs: -1}); err == nil {
		t.Error("negative runs: want an error")
	}
}

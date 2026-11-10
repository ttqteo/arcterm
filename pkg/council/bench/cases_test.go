// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
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
	if !strings.Contains(err.Error(), "scripts/council-bench-cases.mjs builds them") {
		t.Errorf("err = %q, want it to name the script that builds the cases", err)
	}
	if strings.Contains(err.Error(), "Phase 0b") {
		t.Errorf("err = %q, still names Phase 0b's tasks, which are not the builder any more", err)
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

// planNames is a plan's items as case/variant/run, in order.
func planNames(items []CouncilBenchPlanItem) string {
	var got []string
	for _, it := range items {
		got = append(got, fmt.Sprintf("%s/%s/%d", it.Case, it.Variant, it.Run))
	}
	return strings.Join(got, " ")
}

func TestLoadCasesReadsRetiredAndTag(t *testing.T) {
	dir := t.TempDir()
	old := phase0Case(dir, "old", "review")
	old["retired"] = true
	fresh := phase0Case(dir, "fresh", "review")
	fresh["tag"] = TeamPassTag
	writeBench(t, dir, []map[string]any{old, fresh, phase0Case(dir, "plain", "review")}, map[string]string{"old": newcomerKey, "fresh": newcomerKey, "plain": newcomerKey})

	got, warnings, err := LoadCases(dir)
	if err != nil || len(warnings) != 0 || len(got) != 3 {
		t.Fatalf("cases = %+v, warnings = %v, err = %v, want 3 and no warnings", got, warnings, err)
	}
	if !got[0].Retired || got[0].Tag != "" {
		t.Errorf("old = %+v, want retired and untagged", got[0])
	}
	if got[1].Retired || got[1].Tag != TeamPassTag {
		t.Errorf("fresh = %+v, want not retired and tagged %s", got[1], TeamPassTag)
	}
	if got[2].Retired || got[2].Tag != "" {
		t.Errorf("plain = %+v, want neither (a case from before the fields)", got[2])
	}
}

func TestPlanOrderAndEstimate(t *testing.T) {
	cases := []Case{{Id: "alpha"}, {Id: "beta"}}
	items, estimate, err := Plan(cases, Options{Runs: 2})
	if err != nil {
		t.Fatal(err)
	}
	// run 1 of every cell before any run 2, and a case's council and team back to back (a cut leaves whole pairs)
	want := "alpha/council/1 alpha/team/1 beta/council/1 beta/team/1 alpha/council/2 alpha/team/2 beta/council/2 beta/team/2"
	if got := planNames(items); got != want {
		t.Errorf("items = %s\nwant    %s", got, want)
	}
	if wantEst := int64(2 * 2 * (8_800_000 + 4_500_000)); estimate != wantEst {
		t.Errorf("estimate = %d, want %d", estimate, wantEst)
	}
}

func TestPlanDefaultsAndSelection(t *testing.T) {
	cases := []Case{{Id: "alpha"}, {Id: "beta"}, {Id: "gamma"}}

	items, estimate, err := Plan(cases, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 6 || items[0].Run != 1 || items[0].Variant != VariantCouncil || items[1].Variant != VariantTeam {
		t.Errorf("default plan = %+v, want 3 cases x council and team x 1 run", items)
	}
	if estimate != 3*(8_800_000+4_500_000) {
		t.Errorf("default estimate = %d", estimate)
	}

	items, estimate, err = Plan(cases, Options{Cases: []string{"gamma", "alpha", "gamma"}, Variants: []string{"council"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Case != "gamma" || items[1].Case != "alpha" || items[0].Variant != "council" {
		t.Errorf("selected plan = %+v, want gamma then alpha (the repeat dropped), council only", items)
	}
	if estimate != 2*8_800_000 {
		t.Errorf("selected estimate = %d", estimate)
	}
}

func TestPlanPricesEachVariantFromPhase0bMeans(t *testing.T) {
	for variant, want := range map[string]int64{VariantSolo: 2_300_000, VariantCouncil: 8_800_000, VariantTeam: 4_500_000} {
		items, estimate, err := Plan([]Case{{Id: "alpha"}}, Options{Variants: []string{variant}})
		if err != nil || len(items) != 1 || items[0].Variant != variant {
			t.Fatalf("%s: plan = %+v, %v, want its one item", variant, items, err)
		}
		if estimate != want {
			t.Errorf("%s: estimate = %d, want %d", variant, estimate, want)
		}
	}
}

func TestAllVariants(t *testing.T) {
	if got := AllVariants(); strings.Join(got, " ") != "council team brainstorm" {
		t.Errorf("AllVariants = %v, want council, team, then brainstorm (solo stays runnable when named)", got)
	}
	if got := strings.Join(variantOrder, " "); got != "solo council team brainstorm" {
		t.Errorf("variantOrder = %s, want brainstorm last, so a table lists it after the team", got)
	}
}

func TestPlanBrainstormRunsOnBrainstormCasesOnly(t *testing.T) {
	cases := []Case{{Id: "review", Mode: council.ModeReview}, {Id: "brain", Mode: council.ModeBrainstorm}, {Id: "nomode"}}

	// a bare plan: brainstorm joins the council and the team on the Brainstorm case, and nowhere else
	items, estimate, err := Plan(cases, Options{})
	if err != nil {
		t.Fatal(err)
	}
	want := "review/council/1 review/team/1 brain/council/1 brain/team/1 brain/brainstorm/1 nomode/council/1 nomode/team/1"
	if got := planNames(items); got != want {
		t.Errorf("bare plan = %s\nwant       %s", got, want)
	}
	if wantEst := int64(3*(8_800_000+4_500_000) + 5_000_000); estimate != wantEst {
		t.Errorf("bare estimate = %d, want %d: the brainstorm item's price counts once, for the one Brainstorm case", estimate, wantEst)
	}

	// naming it changes nothing: a Review case (or one with no mode) still skips it, and the estimate follows the items kept
	items, estimate, err = Plan(cases, Options{Variants: []string{VariantBrainstorm}})
	if err != nil {
		t.Fatal(err)
	}
	if got := planNames(items); got != "brain/brainstorm/1" {
		t.Errorf("named plan = %s, want only the Brainstorm case's item", got)
	}
	if estimate != 5_000_000 {
		t.Errorf("named estimate = %d, want 5000000", estimate)
	}

	// naming the Review case too: its brainstorm item is left out, and so is its price
	items, estimate, err = Plan(cases, Options{Cases: []string{"review"}, Variants: []string{VariantBrainstorm, VariantTeam}})
	if err != nil {
		t.Fatal(err)
	}
	if got := planNames(items); got != "review/team/1" {
		t.Errorf("review case plan = %s, want its team item only", got)
	}
	if estimate != 4_500_000 {
		t.Errorf("review case estimate = %d, want the team's price alone", estimate)
	}

	// every run of the Brainstorm case keeps its item, run 1 of every case before any run 2
	items, estimate, err = Plan(cases[:2], Options{Variants: []string{VariantCouncil, VariantBrainstorm}, Runs: 2})
	if err != nil {
		t.Fatal(err)
	}
	if got := planNames(items); got != "review/council/1 brain/council/1 brain/brainstorm/1 review/council/2 brain/council/2 brain/brainstorm/2" {
		t.Errorf("two-run plan = %s", got)
	}
	if wantEst := int64(4*8_800_000 + 2*5_000_000); estimate != wantEst {
		t.Errorf("two-run estimate = %d, want %d", estimate, wantEst)
	}

	// a plan whose every item is skipped is empty, with no estimate (the callers turn it into their own error)
	items, estimate, err = Plan(cases[:1], Options{Variants: []string{VariantBrainstorm}})
	if err != nil || len(items) != 0 || estimate != 0 {
		t.Errorf("brainstorm on a Review case = %+v, %d, %v, want no items", items, estimate, err)
	}
}

func TestPlanSoloStaysRunnableWhenNamed(t *testing.T) {
	cases := []Case{{Id: "alpha"}}
	items, estimate, err := Plan(cases, Options{Variants: []string{"team", "solo"}})
	if err != nil {
		t.Fatal(err)
	}
	if got := planNames(items); got != "alpha/team/1 alpha/solo/1" {
		t.Errorf("items = %s, want the variants in the order named", got)
	}
	if estimate != 4_500_000+2_300_000 {
		t.Errorf("estimate = %d, want the team's and the solo's price", estimate)
	}
}

func TestPlanRetiredCases(t *testing.T) {
	cases := []Case{{Id: "old", Retired: true}, {Id: "fresh"}}
	council := []string{VariantCouncil}

	items, _, err := Plan(cases, Options{Variants: council})
	if err != nil || planNames(items) != "fresh/council/1" {
		t.Errorf("a bare plan = %s, %v, want the retired case left out", planNames(items), err)
	}
	items, _, err = Plan(cases, Options{Cases: []string{"old"}, Variants: council})
	if err != nil || planNames(items) != "old/council/1" {
		t.Errorf("a plan that names the retired case = %s, %v, want it included", planNames(items), err)
	}
	items, _, err = Plan(cases, Options{Cases: []string{"fresh", "old"}, Variants: council, Runs: 2})
	if err != nil || planNames(items) != "fresh/council/1 old/council/1 fresh/council/2 old/council/2" {
		t.Errorf("a plan that names both = %s, %v", planNames(items), err)
	}
	if _, _, err := Plan(cases, Options{Cases: []string{"nope"}}); err == nil || !strings.Contains(err.Error(), "old") {
		t.Errorf("unknown case: err = %v, want the retired case listed among the known ones (it runs when named)", err)
	}

	// every case retired: nothing to run, which the callers turn into their own error
	items, estimate, err := Plan([]Case{{Id: "old", Retired: true}}, Options{})
	if err != nil || len(items) != 0 || estimate != 0 {
		t.Errorf("a bare plan of retired cases = %+v, %d, %v, want no items", items, estimate, err)
	}
}

func TestPlanUnknownName(t *testing.T) {
	cases := []Case{{Id: "alpha"}}
	if _, _, err := Plan(cases, Options{Cases: []string{"nope"}}); err == nil || !strings.Contains(err.Error(), `"nope"`) || !strings.Contains(err.Error(), "alpha") {
		t.Errorf("unknown case: err = %v, want it to name nope and the known cases", err)
	}
	if _, _, err := Plan(cases, Options{Variants: []string{"v3"}}); err == nil || !strings.Contains(err.Error(), `"v3"`) ||
		!strings.Contains(err.Error(), "solo") || !strings.Contains(err.Error(), "team") {
		t.Errorf("unknown variant: err = %v, want it to name v3 and every known variant, solo included", err)
	}
	if _, _, err := Plan(cases, Options{Runs: -1}); err == nil {
		t.Error("negative runs: want an error")
	}
	if _, _, err := Plan(cases, Options{Cap: -1}); err == nil || !strings.Contains(err.Error(), "cap") {
		t.Errorf("negative cap: err = %v, want an error naming the cap", err)
	}
}

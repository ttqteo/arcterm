// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const evidenceSentence = "Cite a path:line for every claim, or a region of an attached screenshot; a claim with neither is marked weak."

// useTempConfig points the config dir at a temp dir, so the person's real councilroles.json is never read, and
// returns it.
func useTempConfig(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	prev := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = dir
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = prev })
	return dir
}

func writeRolesFile(t *testing.T, dir, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, wconfig.CouncilRolesFile), []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", wconfig.CouncilRolesFile, err)
	}
}

func groupById(t *testing.T, id string) CouncilGroup {
	t.Helper()
	for _, g := range Groups() {
		if g.Id == id {
			return g
		}
	}
	t.Fatalf("no group %q in %v", id, Groups())
	return CouncilGroup{}
}

func expertIds(es []CouncilExpert) []string {
	ids := make([]string, len(es))
	for i, e := range es {
		ids[i] = e.Id
	}
	return ids
}

func roleById(t *testing.T, id string) CouncilExpert {
	t.Helper()
	for _, r := range Roles() {
		if r.Id == id {
			return r
		}
	}
	t.Fatalf("no role %q in the library", id)
	return CouncilExpert{}
}

func TestBuiltInGroups(t *testing.T) {
	useTempConfig(t)

	ui := groupById(t, "ui-feature")
	if ui.Name != "Review a UI feature" {
		t.Errorf("ui-feature name = %q", ui.Name)
	}
	if want := []string{"ux", "ram", "newuser", "skeptic"}; !reflect.DeepEqual(ui.Roles, want) {
		t.Errorf("ui-feature roles = %v, want %v", ui.Roles, want)
	}
	if ui.Coordinator != "coordinator" {
		t.Errorf("ui-feature coordinator = %q", ui.Coordinator)
	}

	paper := groupById(t, "paper")
	if paper.Name != "Paper review" {
		t.Errorf("paper name = %q", paper.Name)
	}
	if want := []string{"reviewer-a", "reviewer-b", "reader"}; !reflect.DeepEqual(paper.Roles, want) {
		t.Errorf("paper roles = %v, want %v", paper.Roles, want)
	}
	if paper.Coordinator != "areachair" {
		t.Errorf("paper coordinator = %q", paper.Coordinator)
	}
	if got := len(Groups()); got != 3 {
		t.Errorf("Groups() holds %d, want only the three that ship", got)
	}
}

// brainstormRoles are the roles of the Product ideas group that no Review uses: a Brainstorm asks for no evidence, so
// their briefs carry no evidence rule.
var brainstormRoles = []string{"designer", "builder", "contrarian", "facilitator"}

func TestEveryBuiltInRoleHasANameABriefAndTheEvidenceRule(t *testing.T) {
	useTempConfig(t)
	want := []string{"ux", "ram", "newuser", "skeptic", "coordinator", "reviewer-a", "reviewer-b", "reader", "areachair",
		"designer", "builder", "contrarian", "facilitator"}
	roles := Roles()
	if got := expertIds(roles); !reflect.DeepEqual(got, want) {
		t.Fatalf("role ids = %v, want %v", got, want)
	}
	for _, r := range roles {
		if strings.TrimSpace(r.Name) == "" {
			t.Errorf("%s has no name", r.Id)
		}
		if slices.Contains(brainstormRoles, r.Id) {
			if strings.TrimSpace(r.Brief) == "" || strings.Contains(r.Brief, "path:line") || strings.Contains(r.Brief, "weak") {
				t.Errorf("%s brief = %q, want an angle with no evidence rule", r.Id, r.Brief)
			}
		} else if !strings.HasSuffix(r.Brief, evidenceSentence) {
			t.Errorf("%s brief does not end with the evidence rule: %q", r.Id, r.Brief)
		}
		if r.Model == "" {
			t.Errorf("%s has no model", r.Id)
		}
	}
	if got := roleById(t, "newuser").Name; got != "New user" {
		t.Errorf("newuser name = %q", got)
	}
	if got := roleById(t, "areachair").Name; got != "Area chair" {
		t.Errorf("areachair name = %q", got)
	}
}

func TestExpertsForUIFeature(t *testing.T) {
	useTempConfig(t)
	es, err := ExpertsFor("ui-feature")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	if want := []string{"ux", "ram", "newuser", "skeptic", "coordinator"}; !reflect.DeepEqual(expertIds(es), want) {
		t.Fatalf("experts = %v, want %v", expertIds(es), want)
	}
	for i, e := range es {
		last := i == len(es)-1
		if e.Coordinator != last {
			t.Errorf("%s Coordinator = %v, want %v", e.Id, e.Coordinator, last)
		}
		wantModel := "sonnet"
		if last {
			wantModel = "opus"
		}
		if e.Model != wantModel {
			t.Errorf("%s model = %q, want %q", e.Id, e.Model, wantModel)
		}
		if e.Brief == "" || e.Name == "" {
			t.Errorf("%s has an empty name or brief: %+v", e.Id, e)
		}
	}
}

func TestProductIdeasGroup(t *testing.T) {
	useTempConfig(t)
	g := groupById(t, "product-ideas")
	if g.Name != "Product ideas" || g.Coordinator != "facilitator" || !reflect.DeepEqual(g.Roles, []string{"newuser", "designer", "builder", "contrarian"}) {
		t.Fatalf("product-ideas = %+v", g)
	}
	es, err := ExpertsFor("product-ideas")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	if want := []string{"newuser", "designer", "builder", "contrarian", "facilitator"}; !reflect.DeepEqual(expertIds(es), want) {
		t.Fatalf("experts = %v, want %v: no Scout, the facilitator last", expertIds(es), want)
	}
	for i, e := range es {
		last := i == len(es)-1
		wantModel := "sonnet"
		if last {
			wantModel = "opus"
		}
		if e.Coordinator != last || e.Model != wantModel || e.Name == "" || e.Brief == "" {
			t.Errorf("%s = %+v, want coordinator %v on %s", e.Id, e, last, wantModel)
		}
	}
	if got := es[len(es)-1].Name; got != "Facilitator" {
		t.Errorf("coordinator name = %q", got)
	}
}

func TestExpertsForPaperEndsWithTheAreaChair(t *testing.T) {
	useTempConfig(t)
	es, err := ExpertsFor("paper")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	if want := []string{"reviewer-a", "reviewer-b", "reader", "areachair"}; !reflect.DeepEqual(expertIds(es), want) {
		t.Fatalf("experts = %v, want %v", expertIds(es), want)
	}
	chair := es[len(es)-1]
	if !chair.Coordinator || chair.Model != "opus" {
		t.Errorf("area chair = %+v, want the coordinator on opus", chair)
	}
}

func TestExpertsForUnknownGroupIsAnError(t *testing.T) {
	useTempConfig(t)
	if _, err := ExpertsFor("nope"); err == nil {
		t.Fatal("an unknown group must be an error")
	}
}

func TestUserFileOverridesARoleByIdAndAddsAGroup(t *testing.T) {
	dir := useTempConfig(t)
	writeRolesFile(t, dir, `{"roles":[{"id":"ux","model":"haiku"}],
"groups":[{"id":"mine","name":"Mine","roles":["ux","skeptic"],"coordinator":"coordinator"}]}`)

	ux := roleById(t, "ux")
	if ux.Model != "haiku" {
		t.Errorf("ux model = %q, want the user's haiku", ux.Model)
	}
	if ux.Name != "UX" || !strings.HasSuffix(ux.Brief, evidenceSentence) {
		t.Errorf("ux lost its name or brief by the override: %+v", ux)
	}
	if got := len(Roles()); got != 13 {
		t.Errorf("an override must not add a role: %d roles", got)
	}

	mine := groupById(t, "mine")
	if mine.Name != "Mine" || !reflect.DeepEqual(mine.Roles, []string{"ux", "skeptic"}) || mine.Coordinator != "coordinator" {
		t.Errorf("mine = %+v", mine)
	}
	groupById(t, "ui-feature") // the built-ins stay

	es, err := ExpertsFor("mine")
	if err != nil {
		t.Fatalf("ExpertsFor(mine): %v", err)
	}
	if want := []string{"ux", "skeptic", "coordinator"}; !reflect.DeepEqual(expertIds(es), want) {
		t.Fatalf("experts = %v, want %v", expertIds(es), want)
	}
	if es[0].Model != "haiku" {
		t.Errorf("the group's ux = %q, want the overridden haiku", es[0].Model)
	}
	// the built-in group sees the override too: roles are looked up by id
	ui, _ := ExpertsFor("ui-feature")
	if ui[0].Model != "haiku" {
		t.Errorf("ui-feature ux = %q, want haiku", ui[0].Model)
	}
}

func TestUserFileCanAddARoleAndReplaceABuiltInGroup(t *testing.T) {
	dir := useTempConfig(t)
	writeRolesFile(t, dir, `{"roles":[{"id":"a11y","name":"Accessibility","brief":"Can a keyboard-only user do it?"}],
"groups":[{"id":"paper","name":"My paper review","roles":["reader","a11y"],"coordinator":"areachair"}]}`)

	a11y := roleById(t, "a11y")
	if a11y.Name != "Accessibility" || a11y.Brief != "Can a keyboard-only user do it?" {
		t.Errorf("a11y = %+v", a11y)
	}
	if a11y.Model != "sonnet" {
		t.Errorf("a role with no model defaults to sonnet, got %q", a11y.Model)
	}
	paper := groupById(t, "paper")
	if paper.Name != "My paper review" {
		t.Errorf("a user group of a built-in's id replaces it: %+v", paper)
	}
	if got := len(Groups()); got != 3 {
		t.Errorf("replacing must not duplicate: %d groups", got)
	}
	es, err := ExpertsFor("paper")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	if want := []string{"reader", "a11y", "areachair"}; !reflect.DeepEqual(expertIds(es), want) {
		t.Fatalf("experts = %v, want %v", expertIds(es), want)
	}
}

func TestUnknownRoleInAGroupIsSkipped(t *testing.T) {
	dir := useTempConfig(t)
	writeRolesFile(t, dir, `{"groups":[{"id":"odd","name":"Odd","roles":["ux","ghost","skeptic","ux"],"coordinator":"coordinator"}]}`)
	es, err := ExpertsFor("odd")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	if want := []string{"ux", "skeptic", "coordinator"}; !reflect.DeepEqual(expertIds(es), want) {
		t.Fatalf("experts = %v, want an unknown id skipped and a repeat kept once: %v", expertIds(es), want)
	}
}

func TestAGroupWithoutAKnownCoordinatorIsAnError(t *testing.T) {
	dir := useTempConfig(t)
	writeRolesFile(t, dir, `{"groups":[{"id":"headless","name":"Headless","roles":["ux"],"coordinator":"ghost"}]}`)
	if _, err := ExpertsFor("headless"); err == nil {
		t.Fatal("a group whose coordinator is no known role cannot run and must be an error")
	}
}

func TestAMalformedUserFileLeavesTheBuiltIns(t *testing.T) {
	dir := useTempConfig(t)
	writeRolesFile(t, dir, `{"roles": [`)
	if got := len(Roles()); got != 13 {
		t.Errorf("Roles() = %d with a broken file, want the 13 built-ins", got)
	}
	if got := len(Groups()); got != 3 {
		t.Errorf("Groups() = %d with a broken file, want the 3 built-ins", got)
	}
}

func TestSaveGroupThenGroupsListsIt(t *testing.T) {
	dir := useTempConfig(t)
	writeRolesFile(t, dir, `{"roles":[{"id":"ux","model":"haiku"}]}`)

	g := CouncilGroup{Id: "saved", Name: "Saved", Roles: []string{"ram", "newuser"}, Coordinator: "coordinator"}
	if err := SaveGroup(g); err != nil {
		t.Fatalf("SaveGroup: %v", err)
	}
	if got := groupById(t, "saved"); !reflect.DeepEqual(got, g) {
		t.Errorf("saved group = %+v, want %+v", got, g)
	}
	if got := roleById(t, "ux").Model; got != "haiku" {
		t.Errorf("SaveGroup dropped the file's roles: ux model = %q", got)
	}
	es, err := ExpertsFor("saved")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	if want := []string{"ram", "newuser", "coordinator"}; !reflect.DeepEqual(expertIds(es), want) {
		t.Fatalf("experts = %v, want %v", expertIds(es), want)
	}
}

func TestSaveGroupReplacesOneOfTheSameId(t *testing.T) {
	useTempConfig(t)
	if err := SaveGroup(CouncilGroup{Id: "g", Name: "One", Roles: []string{"ux"}, Coordinator: "coordinator"}); err != nil {
		t.Fatal(err)
	}
	if err := SaveGroup(CouncilGroup{Id: "g", Name: "Two", Roles: []string{"ram"}, Coordinator: "coordinator"}); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, g := range Groups() {
		if g.Id == "g" {
			n++
			if g.Name != "Two" {
				t.Errorf("g = %+v, want the second save", g)
			}
		}
	}
	if n != 1 {
		t.Errorf("group g listed %d times, want once", n)
	}
}

func TestSaveGroupRefusesAnEmptyId(t *testing.T) {
	useTempConfig(t)
	if err := SaveGroup(CouncilGroup{Name: "No id", Roles: []string{"ux"}, Coordinator: "coordinator"}); err == nil {
		t.Fatal("a group with no id cannot be found again and must be refused")
	}
}

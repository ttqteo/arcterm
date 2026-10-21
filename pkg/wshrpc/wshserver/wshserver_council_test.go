// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// useCouncilStore points the council store and the config dir (councilroles.json) at temp dirs, so a test never
// reads or writes the person's own.
func useCouncilStore(t *testing.T) {
	t.Helper()
	t.Cleanup(council.UseRootForTest(t.TempDir()))
	prev := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = t.TempDir()
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = prev })
}

func saveCouncil(t *testing.T, c *council.Council) *council.Council {
	t.Helper()
	if err := council.Save(c); err != nil {
		t.Fatalf("save council %s: %v", c.Id, err)
	}
	return c
}

func councilIds(cs []*council.Council) []string {
	ids := make([]string, len(cs))
	for i, c := range cs {
		ids[i] = c.Id
	}
	sort.Strings(ids)
	return ids
}

func writeCouncilFile(t *testing.T, path string, size int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", size)), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestCouncilGetAndListByProject(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()
	p1, p2 := t.TempDir(), t.TempDir()
	saveCouncil(t, &council.Council{Id: "a", Project: p1, Feature: "Idle sleep", State: council.StateDone})
	saveCouncil(t, &council.Council{Id: "b", Project: p2, Feature: "Dark mode", State: council.StateRunning, Round: 1})
	saveCouncil(t, &council.Council{Id: "c", Project: p1, Feature: "Palette row", State: council.StateNotRun})

	got, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: "a"})
	if err != nil {
		t.Fatalf("CouncilGetCommand: %v", err)
	}
	if got.Id != "a" || got.Feature != "Idle sleep" || got.Project != p1 || got.State != council.StateDone {
		t.Errorf("get a = %+v", got)
	}
	if _, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: "missing"}); err == nil {
		t.Error("get of a council that does not exist should fail")
	}
	if _, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{}); err == nil {
		t.Error("get with no id should fail")
	}

	for _, tc := range []struct {
		project string
		want    []string
	}{
		{p1, []string{"a", "c"}},
		{p2, []string{"b"}},
		{t.TempDir(), []string{}},
		{"", []string{"a", "b", "c"}},
	} {
		list, err := ws.CouncilListCommand(ctx, wshrpc.CommandCouncilListData{Project: tc.project})
		if err != nil {
			t.Fatalf("CouncilListCommand(%q): %v", tc.project, err)
		}
		if list == nil {
			t.Errorf("list(%q) = nil, want an empty list the frontend can map over", tc.project)
		}
		if ids := councilIds(list); !reflect.DeepEqual(ids, tc.want) {
			t.Errorf("list(%q) = %v, want %v", tc.project, ids, tc.want)
		}
	}
}

func TestCouncilEstimateWholeCouncil(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()
	experts, err := council.ExpertsFor("ui-feature")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}

	est, err := ws.CouncilEstimateCommand(ctx, wshrpc.CommandCouncilEstimateData{Experts: experts})
	if err != nil {
		t.Fatalf("CouncilEstimateCommand: %v", err)
	}
	if want := (wshrpc.CouncilEstimateRtnData{Calls: 9, Tokens: 820_000, Minutes: 6}); *est != want {
		t.Errorf("UI group with no files = %+v, want %+v", *est, want)
	}

	// a path is under the project, a folder counts its files but not .git or node_modules, and a path that is not
	// there counts for nothing
	project := t.TempDir()
	writeCouncilFile(t, filepath.Join(project, "a.txt"), 4000)
	writeCouncilFile(t, filepath.Join(project, "src", "b.txt"), 300)
	writeCouncilFile(t, filepath.Join(project, "src", "deep", "c.txt"), 100)
	writeCouncilFile(t, filepath.Join(project, "src", "node_modules", "x.txt"), 10_000)
	writeCouncilFile(t, filepath.Join(project, "src", ".git", "y"), 10_000)
	outside := filepath.Join(t.TempDir(), "abs.txt")
	writeCouncilFile(t, outside, 400)
	est, err = ws.CouncilEstimateCommand(ctx, wshrpc.CommandCouncilEstimateData{
		Project: project, Files: []string{"a.txt", "src", "missing.txt", outside}, Experts: experts,
	})
	if err != nil {
		t.Fatalf("estimate with files: %v", err)
	}
	// 4800 bytes are 1200 tokens read by each of the four experts
	if want := (wshrpc.CouncilEstimateRtnData{Calls: 9, Tokens: 820_000 + 4*1200, Minutes: 6}); *est != want {
		t.Errorf("with files = %+v, want %+v", *est, want)
	}
}

func TestCouncilEstimateOfASavedCouncil(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()
	experts, err := council.ExpertsFor("ui-feature")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	saveCouncil(t, &council.Council{
		Id: "c1", Project: t.TempDir(), Feature: "Idle sleep", Experts: experts, State: council.StateAwaiting, Round: 1,
		Failed: map[string]council.CouncilFailure{"ux": {Round: 1, Error: "timeout"}},
	})

	for _, tc := range []struct {
		name string
		data wshrpc.CommandCouncilEstimateData
		want wshrpc.CouncilEstimateRtnData
	}{
		{"remaining skips the expert whose round 1 failed", wshrpc.CommandCouncilEstimateData{Id: "c1"},
			wshrpc.CouncilEstimateRtnData{Calls: 4, Tokens: 3*45_000 + 80_000, Minutes: 3}},
		{"a follow-up of two experts", wshrpc.CommandCouncilEstimateData{Id: "c1", Followup: 2},
			wshrpc.CouncilEstimateRtnData{Calls: 2, Tokens: 40_000, Minutes: 1}},
		{"a follow-up that reads code", wshrpc.CommandCouncilEstimateData{Id: "c1", Followup: 2, Tools: true},
			wshrpc.CouncilEstimateRtnData{Calls: 2, Tokens: 180_000, Minutes: 2}},
	} {
		got, err := ws.CouncilEstimateCommand(ctx, tc.data)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if *got != tc.want {
			t.Errorf("%s = %+v, want %+v", tc.name, *got, tc.want)
		}
	}
	if _, err := ws.CouncilEstimateCommand(ctx, wshrpc.CommandCouncilEstimateData{Id: "missing"}); err == nil {
		t.Error("the remaining estimate of a council that does not exist should fail")
	}
}

func TestCouncilSaveDocDefaultPath(t *testing.T) {
	useCouncilStore(t)
	prevDay := councilDocDay
	t.Cleanup(func() { councilDocDay = prevDay })
	councilDocDay = func() time.Time { return time.Date(2026, 10, 21, 9, 0, 0, 0, time.Local) }
	ws := &WshServer{}
	ctx := context.Background()
	project := t.TempDir()
	c := saveCouncil(t, &council.Council{
		Id: "c1", Project: project, Feature: "Idle sleep for services!", State: council.StateDone,
		Summary: &council.CouncilSummary{
			Text:       "Sleep an idle service after a minute.",
			Directions: []council.CouncilDirection{{Rank: 1, Title: "Sleep after a minute", Reasoning: "It saves RAM.", Agreed: true}},
		},
	})

	got, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c1"})
	if err != nil {
		t.Fatalf("CouncilSaveDocCommand: %v", err)
	}
	want := filepath.Join(project, "docs", "council", "2026-10-21-idle-sleep-for-services.md")
	if got.Path != want {
		t.Errorf("default path = %q, want %q", got.Path, want)
	}
	body, err := os.ReadFile(want)
	if err != nil {
		t.Fatalf("the doc was not written: %v", err)
	}
	if string(body) != council.Markdown(c) {
		t.Errorf("the doc is not council.Markdown:\n%s", body)
	}
	if !strings.Contains(string(body), "# Council: Idle sleep for services!") {
		t.Errorf("the doc does not name the feature:\n%s", body)
	}
}

func TestCouncilSaveDocPickedPathAndRefusals(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()
	project, elsewhere := t.TempDir(), t.TempDir()
	saveCouncil(t, &council.Council{Id: "c1", Project: project, Feature: "Idle sleep", State: council.StateDone})

	// a relative path is under the project, an absolute one inside it is kept as it is
	got, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c1", Path: "notes/out.md"})
	if err != nil {
		t.Fatalf("relative path: %v", err)
	}
	if want := filepath.Join(project, "notes", "out.md"); got.Path != want {
		t.Errorf("relative path = %q, want %q", got.Path, want)
	}
	inside := filepath.Join(project, "abs.md")
	if got, err = ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c1", Path: inside}); err != nil || got.Path != inside {
		t.Fatalf("absolute path inside the project = %+v, %v", got, err)
	}

	outside := filepath.Join(elsewhere, "x.md")
	for _, path := range []string{outside, filepath.Join("..", filepath.Base(elsewhere), "x.md"), "../x.md", "docs/../../x.md", "..", "."} {
		if got, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c1", Path: path}); err == nil {
			t.Errorf("path %q was written to %q, want a refusal", path, got.Path)
		}
	}
	if _, err := os.Stat(outside); err == nil {
		t.Errorf("%s was written", outside)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(project), "x.md")); err == nil {
		t.Error("a file was written next to the project")
	}

	if _, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "missing"}); err == nil {
		t.Error("saving a doc of a council that does not exist should fail")
	}
	saveCouncil(t, &council.Council{Id: "c2", Feature: "No project", State: council.StateDone})
	if _, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c2"}); err == nil {
		t.Error("a council with no project has nowhere to save a doc")
	}
}

func TestCouncilFeatureSlug(t *testing.T) {
	for in, want := range map[string]string{
		"Idle sleep for services!":    "idle-sleep-for-services",
		"  --Dark   mode / Light--  ": "dark-mode-light",
		"Chế độ ngủ cho dịch vụ":      "chế-độ-ngủ-cho-dịch-vụ",
		"":                            "council",
		" ?! ":                        "council",
		strings.Repeat("ab ", 40):     strings.TrimSuffix(strings.Repeat("ab-", 20), "-"),
		strings.Repeat("a", 100):      strings.Repeat("a", councilDocSlugRunes),
		"v2.1 release (draft)":        "v2-1-release-draft",
		"C:\\Users\\me\\proj /x":      "c-users-me-proj-x",
		"naïve café":                  "naïve-café",
		"under_score":                 "under-score",
	} {
		if got := councilFeatureSlug(in); got != want {
			t.Errorf("councilFeatureSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCouncilRolesAndSaveGroup(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()

	roles, err := ws.CouncilRolesCommand(ctx)
	if err != nil {
		t.Fatalf("CouncilRolesCommand: %v", err)
	}
	hasRole, hasGroup := map[string]bool{}, map[string]bool{}
	for _, r := range roles.Roles {
		hasRole[r.Id] = true
	}
	for _, g := range roles.Groups {
		hasGroup[g.Id] = true
	}
	for _, id := range []string{"ux", "ram", "newuser", "skeptic", "coordinator"} {
		if !hasRole[id] {
			t.Errorf("role %q missing from %v", id, roles.Roles)
		}
	}
	if !hasGroup["ui-feature"] || hasGroup["mine"] {
		t.Errorf("groups = %v, want ui-feature and no mine yet", roles.Groups)
	}

	mine := council.CouncilGroup{Id: "mine", Name: "Mine", Roles: []string{"ux", "skeptic"}, Coordinator: "coordinator"}
	if err := ws.CouncilSaveGroupCommand(ctx, mine); err != nil {
		t.Fatalf("CouncilSaveGroupCommand: %v", err)
	}
	roles, err = ws.CouncilRolesCommand(ctx)
	if err != nil {
		t.Fatalf("CouncilRolesCommand after save: %v", err)
	}
	var found *council.CouncilGroup
	for i := range roles.Groups {
		if roles.Groups[i].Id == "mine" {
			found = &roles.Groups[i]
		}
	}
	if found == nil || !reflect.DeepEqual(*found, mine) {
		t.Errorf("saved group came back as %+v, want %+v", found, mine)
	}
	if err := ws.CouncilSaveGroupCommand(ctx, council.CouncilGroup{Name: "No id"}); err == nil {
		t.Error("a group with no id should be refused")
	}
}

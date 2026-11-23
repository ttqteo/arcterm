// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// redocCouncil is a council of project whose report was saved at docPath.
func redocCouncil(id, project, docPath string, state council.CouncilState) *council.Council {
	return &council.Council{Id: id, Feature: "feature " + id, Project: project, DocPath: docPath, State: state}
}

func TestRedocPlan(t *testing.T) {
	const project = `D:\work\mit\mit-thesis`
	// What docs/council holds: two reports, a side file, a folder of brief copies, a folder of regions, a note that is
	// not markdown.
	entries := []string{
		"2026-11-18-a.md", "2026-11-18-a.discussion.md", "2026-11-19-b.md", "2026-11-20-c.md",
		"2026-11-21-gone.md", "briefs/", "2026-11-18-a-regions/", "notes.txt",
	}
	list := []*council.Council{
		// saved at the project's own path: re-saved
		redocCouncil("a1", project, `D:\work\mit\mit-thesis\docs\council\2026-11-18-a.md`, council.StateDone),
		// the stored path has another drive, another prefix and slashes: it still names the file under this project
		redocCouncil("b1", project, "/Users/q/mit-thesis/docs/council/2026-11-19-b.md", council.StateDone),
		// a record of another project, whose report happens to carry the name of one here: not this project's to rewrite
		redocCouncil("x1", `D:\work\other`, `D:\work\other\docs\council\2026-11-20-c.md`, council.StateDone),
		// a record whose report is not here at all (another project's folder, or deleted)
		redocCouncil("y1", project, `D:\work\other\docs\council\2026-11-30-elsewhere.md`, council.StateDone),
		// a document saved outside docs/council is not a report of this layout, even when its name matches
		redocCouncil("z1", project, `D:\work\mit\mit-thesis\notes\2026-11-21-gone.md`, council.StateDone),
		// no document saved yet
		redocCouncil("n1", project, "", council.StateDone),
	}
	got := redocPlan(project, list, entries)
	wantSaves := []redocSave{
		{Id: "a1", Feature: "feature a1", Report: "2026-11-18-a.md"},
		{Id: "b1", Feature: "feature b1", Report: "2026-11-19-b.md"},
	}
	if !reflect.DeepEqual(got.Saves, wantSaves) {
		t.Errorf("saves = %+v, want %+v", got.Saves, wantSaves)
	}
	// c.md (its only record is another project's), gone.md (its record's path lies outside docs/council) and nothing
	// else: not the side file, not briefs/, not the regions folder, not notes.txt.
	wantUntouched := []string{"2026-11-20-c.md", "2026-11-21-gone.md"}
	if !reflect.DeepEqual(got.Untouched, wantUntouched) {
		t.Errorf("untouched = %v, want %v", got.Untouched, wantUntouched)
	}
	if len(got.Skipped) != 0 {
		t.Errorf("skipped = %+v, want none", got.Skipped)
	}
}

func TestRedocPlanSideFilesAndBriefsAreNotReports(t *testing.T) {
	const project = "/work/thesis"
	// A record that names a side file or a file in briefs/ is no report's record, and neither is listed untouched.
	list := []*council.Council{
		redocCouncil("s1", project, "/work/thesis/docs/council/2026-11-18-a.discussion.md", council.StateDone),
		redocCouncil("s2", project, "/work/thesis/docs/council/briefs/2026-11-18-s2-brief.md", council.StateDone),
	}
	got := redocPlan(project, list, []string{"2026-11-18-a.discussion.md", "briefs/", "briefs/2026-11-18-s2-brief.md"})
	if len(got.Saves) != 0 || len(got.Untouched) != 0 || len(got.Skipped) != 0 {
		t.Errorf("plan = %+v, want it empty", got)
	}
}

func TestRedocEntriesMarkDirectories(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "briefs"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"2026-11-18-a.md", "2026-11-18-a.discussion.md", filepath.Join("briefs", "b.md")} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := redocEntries(dir)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"2026-11-18-a.discussion.md", "2026-11-18-a.md", "briefs/"}; !reflect.DeepEqual(got, want) {
		t.Errorf("entries = %v, want %v", got, want)
	}
	// Through the plan, the folder gives one report and nothing else to list.
	plan := redocPlan("/p", nil, got)
	if want := []string{"2026-11-18-a.md"}; !reflect.DeepEqual(plan.Untouched, want) {
		t.Errorf("untouched = %v, want %v", plan.Untouched, want)
	}
	if _, err := redocEntries(filepath.Join(dir, "missing")); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a folder that is not there: err = %v, want fs.ErrNotExist", err)
	}
}

func TestRedocPlanOneReportOneSave(t *testing.T) {
	const project = "/work/thesis"
	path := "/work/thesis/docs/council/2026-11-18-a.md"
	// The list is newest first: a follow-up that rewrote the same file wins, the older record is named in Skipped.
	list := []*council.Council{
		redocCouncil("new", project, path, council.StateDone),
		redocCouncil("old", project, path, council.StateDone),
	}
	got := redocPlan(project, list, []string{"2026-11-18-a.md"})
	if len(got.Saves) != 1 || got.Saves[0].Id != "new" {
		t.Fatalf("saves = %+v, want only the newest council", got.Saves)
	}
	if len(got.Skipped) != 1 || got.Skipped[0].Id != "old" || got.Skipped[0].Report != "2026-11-18-a.md" || got.Skipped[0].Why == "" {
		t.Errorf("skipped = %+v, want the older record with a reason", got.Skipped)
	}
	if len(got.Untouched) != 0 {
		t.Errorf("untouched = %v, want none", got.Untouched)
	}
}

func TestRedocPlanLeavesAMidRunCouncilAlone(t *testing.T) {
	const project = "/work/thesis"
	list := []*council.Council{
		redocCouncil("r1", project, "/work/thesis/docs/council/2026-11-18-a.md", council.StateRunning),
		redocCouncil("r2", project, "/work/thesis/docs/council/2026-11-19-b.md", council.StateAwaiting),
		redocCouncil("r3", project, "/work/thesis/docs/council/2026-11-20-c.md", council.StateQueued),
		redocCouncil("r4", project, "/work/thesis/docs/council/2026-11-21-d.md", council.StateStopped),
	}
	got := redocPlan(project, list, []string{"2026-11-18-a.md", "2026-11-19-b.md", "2026-11-20-c.md", "2026-11-21-d.md"})
	if len(got.Saves) != 1 || got.Saves[0].Id != "r4" {
		t.Errorf("saves = %+v, want only the stopped council", got.Saves)
	}
	if len(got.Skipped) != 3 {
		t.Fatalf("skipped = %+v, want the three that are not over", got.Skipped)
	}
	// Named by a council, so none of the reports is "no council record".
	if len(got.Untouched) != 0 {
		t.Errorf("untouched = %v, want none", got.Untouched)
	}
}

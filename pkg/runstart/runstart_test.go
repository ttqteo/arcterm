// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runstart

import (
	"reflect"
	"testing"
)

func run(id, title string, files ...string) LiveRun {
	return LiveRun{Id: id, Title: title, Files: files}
}

func held(l LiveRun) LiveRun {
	l.Held, l.HeldReason = true, "verify failed"
	return l
}

func TestSameFile(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"pkg/a/land.go", "pkg/a/land.go", true},
		{"pkg/a/land.go", "land.go", true},
		{"land.go", "pkg/a/land.go", true},
		{"pkg/a/land.go", "b/land.go", false},
		{"pkg/a/xland.go", "land.go", false},
		{"pkg/a/land.go", "pkg/a/land_test.go", false},
		{"", "", false},
		{"land.go", "", false},
	}
	for _, c := range cases {
		if got := SameFile(c.a, c.b); got != c.want {
			t.Errorf("SameFile(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestDiffFiles(t *testing.T) {
	got := DiffFiles([]string{
		"pkg/x/a.go", "CHANGELOG.md", "pkg/x/a.go", "frontend/types/gotypes.d.ts", "", " docs/guide/run.md ",
		"docs\\guide\\other.md", "go.sum", "pkg/x/b.go",
	})
	want := []string{"pkg/x/a.go", "docs/guide/run.md", "docs/guide/other.md", "pkg/x/b.go"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DiffFiles = %v, want %v", got, want)
	}
	if got := DiffFiles(nil); len(got) != 0 {
		t.Errorf("DiffFiles(nil) = %v, want none", got)
	}
}

const testPlan = `# A plan

**Verify:** ` + "`go test ./pkg/a`" + `

### Task 1: First
**Files:** ` + "`pkg/a/one.go`, `pkg/a/one_test.go`" + `
Do the first thing.

### Task 2: Second
**Files:** ` + "`CHANGELOG.md`, `frontend/app/two.tsx`, `scripts/release`" + `
Do the second thing.
`

func TestNewRunFiles(t *testing.T) {
	t.Run("a spec's mentions, bare name folded into its path, hub files out", func(t *testing.T) {
		got := NewRunFiles("fix land.go", "See pkg/orchestrate/land.go and add a CHANGELOG.md line.", "")
		want := []string{"pkg/orchestrate/land.go"}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})
	t.Run("a plan's Files lines and its mentions, after the spec's, distinct", func(t *testing.T) {
		got := NewRunFiles("", "The spec edits pkg/orchestrate/land.go and pkg/a/one.go.", testPlan)
		want := []string{"pkg/orchestrate/land.go", "pkg/a/one.go", "pkg/a/one_test.go", "frontend/app/two.tsx", "scripts/release"}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})
	t.Run("an extensionless Files entry still counts when the plan does not parse", func(t *testing.T) {
		got := NewRunFiles("", "", "**Files:** `scripts/release`, `README.md`\nno task headings here")
		want := []string{"scripts/release"}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
	})
	t.Run("nothing named is no files", func(t *testing.T) {
		if got := NewRunFiles("make it faster", "No file is named here.", ""); len(got) != 0 {
			t.Errorf("got %v, want none", got)
		}
	})
}

func TestOverlaps(t *testing.T) {
	files := []string{"pkg/a/land.go", "pkg/b/x.go", "docs/note.md"}
	live := []LiveRun{
		run("r1", "Run A", "land.go", "other.go"),
		run("r2", "Run B"),
		held(run("r3", "Run H", "pkg/b/x.go", "pkg/b/x.go")),
		run("r4", "Run C", "pkg/zzz/y.go"),
	}
	got := Overlaps(files, live)
	if len(got) != len(live) {
		t.Fatalf("got %d overlaps for %d live runs: %+v", len(got), len(live), got)
	}
	for i, id := range []string{"r1", "r2", "r3", "r4"} {
		if got[i].RunId != id {
			t.Errorf("overlap %d is run %s, want %s (live's order)", i, got[i].RunId, id)
		}
	}
	// a bare mention shared with a repo path is named by the fuller spelling
	if want := []string{"pkg/a/land.go"}; !reflect.DeepEqual(got[0].Files, want) {
		t.Errorf("run A shares %v, want %v", got[0].Files, want)
	}
	if len(got[1].Files) != 0 || len(got[3].Files) != 0 {
		t.Errorf("runs with nothing shared list %v and %v", got[1].Files, got[3].Files)
	}
	if want := []string{"pkg/b/x.go"}; !reflect.DeepEqual(got[2].Files, want) {
		t.Errorf("held run shares %v, want %v", got[2].Files, want)
	}
	if !got[2].Held || got[2].HeldReason != "verify failed" || got[0].Title != "Run A" {
		t.Errorf("held flag, reason and title must carry over: %+v", got)
	}
}

func TestSuggest(t *testing.T) {
	const landHeld = "Run H is held and edits pkg/a/land.go: land it first, or this run will conflict"
	files := []string{"pkg/a/land.go"}
	cases := []struct {
		name       string
		in         SuggestInput
		wantChoice string
		wantAfter  []string
		wantReason string
	}{
		{
			name:       "no files, room: run now",
			in:         SuggestInput{Source: SourceSpec, Active: 1, MaxActive: 3},
			wantChoice: ChoiceNow,
			wantReason: "The spec names no files: only the run cap was checked",
		},
		{
			name:       "no files, no room: queue",
			in:         SuggestInput{Source: SourcePlan, Active: 3, MaxActive: 3, Live: []LiveRun{run("r1", "Run A", "pkg/a/land.go")}},
			wantChoice: ChoiceQueue,
			wantReason: "The plan names no files: only the run cap was checked",
		},
		{
			name:       "no files, a goal",
			in:         SuggestInput{Source: SourceGoal, Active: 0, MaxActive: 3},
			wantChoice: ChoiceNow,
			wantReason: "The goal names no files: only the run cap was checked",
		},
		{
			name:       "overlap with one run: after it",
			in:         SuggestInput{Files: files, Source: SourceSpec, Active: 1, MaxActive: 3, Live: []LiveRun{run("r1", "Run A", "pkg/a/land.go")}},
			wantChoice: ChoiceAfter,
			wantAfter:  []string{"r1"},
			wantReason: "Edits pkg/a/land.go like Run A",
		},
		{
			name: "overlap with two runs: after both, the second counted",
			in: SuggestInput{Files: files, Source: SourceSpec, Active: 2, MaxActive: 3, Live: []LiveRun{
				run("r1", "Run A", "pkg/a/land.go"), run("r2", "Run B", "land.go"), run("r3", "Run C", "pkg/z.go"),
			}},
			wantChoice: ChoiceAfter,
			wantAfter:  []string{"r1", "r2"},
			wantReason: "Edits pkg/a/land.go like Run A and 1 more run",
		},
		{
			name: "overlap with three runs",
			in: SuggestInput{Files: files, Source: SourceSpec, Active: 3, MaxActive: 9, Live: []LiveRun{
				run("r1", "Run A", "pkg/a/land.go"), run("r2", "Run B", "pkg/a/land.go"), run("r3", "Run C", "pkg/a/land.go"),
			}},
			wantChoice: ChoiceAfter,
			wantAfter:  []string{"r1", "r2", "r3"},
			wantReason: "Edits pkg/a/land.go like Run A and 2 more runs",
		},
		{
			name:       "overlap wins over a full cap",
			in:         SuggestInput{Files: files, Source: SourceSpec, Active: 3, MaxActive: 3, Live: []LiveRun{run("r1", "Run A", "pkg/a/land.go")}},
			wantChoice: ChoiceAfter,
			wantAfter:  []string{"r1"},
			wantReason: "Edits pkg/a/land.go like Run A",
		},
		{
			name:       "only a held run overlaps, room: run now, the held run named",
			in:         SuggestInput{Files: files, Source: SourceSpec, Active: 1, MaxActive: 3, Live: []LiveRun{held(run("rh", "Run H", "pkg/a/land.go"))}},
			wantChoice: ChoiceNow,
			wantReason: landHeld,
		},
		{
			name:       "only a held run overlaps, no room: queue, the held run named",
			in:         SuggestInput{Files: files, Source: SourceSpec, Active: 2, MaxActive: 2, Live: []LiveRun{held(run("rh", "Run H", "pkg/a/land.go"))}},
			wantChoice: ChoiceQueue,
			wantReason: "2 runs are already active; " + landHeld,
		},
		{
			name: "a held and a non-held run overlap: after the non-held one only",
			in: SuggestInput{Files: files, Source: SourceSpec, Active: 2, MaxActive: 3, Live: []LiveRun{
				held(run("rh", "Run H", "pkg/a/land.go")), run("r1", "Run A", "pkg/a/land.go"),
			}},
			wantChoice: ChoiceAfter,
			wantAfter:  []string{"r1"},
			wantReason: "Edits pkg/a/land.go like Run A; " + landHeld,
		},
		{
			name:       "no overlap, room: run now",
			in:         SuggestInput{Files: files, Source: SourceSpec, Active: 2, MaxActive: 3, Live: []LiveRun{run("r1", "Run A", "pkg/other/z.go")}},
			wantChoice: ChoiceNow,
			wantReason: "No live run edits the same files",
		},
		{
			name:       "no overlap, no room: queue",
			in:         SuggestInput{Files: files, Source: SourceSpec, Active: 3, MaxActive: 3, Live: []LiveRun{run("r1", "Run A", "pkg/other/z.go")}},
			wantChoice: ChoiceQueue,
			wantReason: "3 runs are already active",
		},
		{
			name:       "no overlap, a cap of one is full",
			in:         SuggestInput{Files: files, Source: SourceSpec, Active: 1, MaxActive: 1},
			wantChoice: ChoiceQueue,
			wantReason: "1 run is already active",
		},
		{
			name:       "no cap: always room",
			in:         SuggestInput{Files: files, Source: SourceSpec, Active: 40, MaxActive: 0},
			wantChoice: ChoiceNow,
			wantReason: "No live run edits the same files",
		},
		{
			name:       "no files, no cap",
			in:         SuggestInput{Source: SourceSpec, Active: 40, MaxActive: 0},
			wantChoice: ChoiceNow,
			wantReason: "The spec names no files: only the run cap was checked",
		},
		{
			name:       "a run with a blank title is named by its id",
			in:         SuggestInput{Files: files, Source: SourceSpec, Active: 1, MaxActive: 3, Live: []LiveRun{run("r7", "", "pkg/a/land.go")}},
			wantChoice: ChoiceAfter,
			wantAfter:  []string{"r7"},
			wantReason: "Edits pkg/a/land.go like r7",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Suggest(c.in)
			if got.Choice != c.wantChoice {
				t.Errorf("choice = %q, want %q", got.Choice, c.wantChoice)
			}
			if !reflect.DeepEqual(got.After, c.wantAfter) {
				t.Errorf("after = %v, want %v", got.After, c.wantAfter)
			}
			if got.Reason != c.wantReason {
				t.Errorf("reason = %q, want %q", got.Reason, c.wantReason)
			}
		})
	}
}

func TestRecheckAdds(t *testing.T) {
	files := []string{"pkg/a/land.go"}
	const queuedTs = 100
	newer := func(id, title string, ts int64, files ...string) LiveRun {
		l := run(id, title, files...)
		l.CreatedTs = ts
		return l
	}
	t.Run("a newer run sharing a file is added, named by the first", func(t *testing.T) {
		live := []LiveRun{
			newer("r1", "Run A", 200, "land.go"),
			newer("r2", "Run B", 300, "pkg/a/land.go"),
		}
		add, reason := RecheckAdds(files, live, queuedTs, nil)
		if want := []string{"r1", "r2"}; !reflect.DeepEqual(add, want) {
			t.Errorf("add = %v, want %v", add, want)
		}
		if want := "Waiting for Run A too: both edit pkg/a/land.go"; reason != want {
			t.Errorf("reason = %q, want %q", reason, want)
		}
	})
	t.Run("older, equal-age, held, listed and unrelated runs are left alone", func(t *testing.T) {
		live := []LiveRun{
			newer("old", "Old", 50, "pkg/a/land.go"),
			newer("same", "Same age", queuedTs, "pkg/a/land.go"),
			held(newer("held", "Held", 400, "pkg/a/land.go")),
			newer("listed", "Listed", 400, "pkg/a/land.go"),
			newer("other", "Other", 400, "pkg/zzz/y.go"),
			newer("fresh", "Fresh", 400, "pkg/a/land.go"),
		}
		add, reason := RecheckAdds(files, live, queuedTs, []string{"listed"})
		if want := []string{"fresh"}; !reflect.DeepEqual(add, want) {
			t.Errorf("add = %v, want %v", add, want)
		}
		if want := "Waiting for Fresh too: both edit pkg/a/land.go"; reason != want {
			t.Errorf("reason = %q, want %q", reason, want)
		}
	})
	t.Run("nothing to add is no reason", func(t *testing.T) {
		live := []LiveRun{newer("old", "Old", 50, "pkg/a/land.go"), newer("other", "Other", 400, "pkg/zzz/y.go")}
		add, reason := RecheckAdds(files, live, queuedTs, nil)
		if len(add) != 0 || reason != "" {
			t.Errorf("add = %v, reason = %q, want none", add, reason)
		}
	})
	t.Run("an entry with no files adds nothing", func(t *testing.T) {
		add, reason := RecheckAdds(nil, []LiveRun{newer("r1", "Run A", 200, "pkg/a/land.go")}, queuedTs, nil)
		if len(add) != 0 || reason != "" {
			t.Errorf("add = %v, reason = %q, want none", add, reason)
		}
	})
}

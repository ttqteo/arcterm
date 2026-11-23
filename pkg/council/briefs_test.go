// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

var briefDay = time.Date(2026, 11, 23, 9, 0, 0, 0, time.Local)

// briefCouncil is a council in a fresh project folder with the files given.
func briefCouncil(t *testing.T, files ...string) *Council {
	t.Helper()
	c := testCouncil("c1")
	c.Project, c.Files = t.TempDir(), files
	return c
}

// writeBrief writes text at path, making its folders.
func writeBrief(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readBack(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestTakeBriefsCopiesAnOutsideFile(t *testing.T) {
	notes := filepath.Join(t.TempDir(), "notes.md")
	writeBrief(t, notes, "# Notes\nwake on demand\n")
	c := briefCouncil(t, notes, "pkg/ram.go")
	takeBriefs(c, briefDay)

	copyRel := "docs/council/briefs/2026-11-23-c1-notes.md"
	if want := []string{copyRel, "pkg/ram.go"}; !reflect.DeepEqual(c.Files, want) {
		t.Fatalf("files = %q, want %q", c.Files, want)
	}
	if want := []CouncilBrief{{Source: notes, Copy: copyRel}}; !reflect.DeepEqual(c.Briefs, want) {
		t.Errorf("briefs = %+v, want %+v", c.Briefs, want)
	}
	if got := readBack(t, filepath.Join(c.Project, filepath.FromSlash(copyRel))); got != "# Notes\nwake on demand\n" {
		t.Errorf("the copy holds %q", got)
	}
}

func TestTakeBriefsMakesAnInsideAbsolutePathRelative(t *testing.T) {
	c := briefCouncil(t)
	c.Files = []string{filepath.Join(c.Project, "pkg", "ram.go"), "docs/spec.md"}
	takeBriefs(c, briefDay)
	if want := []string{"pkg/ram.go", "docs/spec.md"}; !reflect.DeepEqual(c.Files, want) {
		t.Errorf("files = %q, want %q", c.Files, want)
	}
	if len(c.Briefs) != 0 {
		t.Errorf("briefs = %+v, want none: nothing came from outside", c.Briefs)
	}
}

func TestTakeBriefsCopiesASmallFolderWholeAndSkipsABigOne(t *testing.T) {
	small := filepath.Join(t.TempDir(), "design")
	writeBrief(t, filepath.Join(small, "a.txt"), "one\n")
	writeBrief(t, filepath.Join(small, "sub", "b.txt"), "two\n")
	big := filepath.Join(t.TempDir(), "dump")
	writeBrief(t, filepath.Join(big, "x.bin"), strings.Repeat("x", briefCap/2+1))
	writeBrief(t, filepath.Join(big, "y.bin"), strings.Repeat("y", briefCap/2+1))
	c := briefCouncil(t, small, big)
	takeBriefs(c, briefDay)

	copyRel := "docs/council/briefs/2026-11-23-c1-design"
	if want := []string{copyRel, big}; !reflect.DeepEqual(c.Files, want) {
		t.Fatalf("files = %q, want %q: the big folder stays as it was", c.Files, want)
	}
	copied := filepath.Join(c.Project, filepath.FromSlash(copyRel))
	if got := readBack(t, filepath.Join(copied, "sub", "b.txt")); got != "two\n" {
		t.Errorf("the folder's tree was not kept: sub/b.txt holds %q", got)
	}
	if len(c.Briefs) != 2 || c.Briefs[0] != (CouncilBrief{Source: small, Copy: copyRel}) {
		t.Fatalf("briefs = %+v", c.Briefs)
	}
	if b := c.Briefs[1]; b.Source != big || b.Copy != "" || !strings.Contains(b.Skipped, "1 MB") {
		t.Errorf("the big folder's brief = %+v, want skipped over the 1 MB cap", b)
	}
	if _, err := os.Stat(filepath.Join(c.Project, "docs", "council", "briefs", "2026-11-23-c1-dump")); !os.IsNotExist(err) {
		t.Errorf("the big folder left a copy behind (stat: %v)", err)
	}
}

func TestTakeBriefsSkipsABigFile(t *testing.T) {
	pdf := filepath.Join(t.TempDir(), "paper.pdf")
	writeBrief(t, pdf, strings.Repeat("p", briefCap+1))
	c := briefCouncil(t, pdf)
	takeBriefs(c, briefDay)
	if c.Files[0] != pdf || len(c.Briefs) != 1 || !strings.Contains(c.Briefs[0].Skipped, "1 MB") {
		t.Errorf("files %q, briefs %+v: want a big file skipped and left as it was", c.Files, c.Briefs)
	}
}

func TestTakeBriefsSkipsAnUnreadableFile(t *testing.T) {
	gone := filepath.Join(t.TempDir(), "gone.md")
	c := briefCouncil(t, gone)
	takeBriefs(c, briefDay)
	if c.Files[0] != gone {
		t.Errorf("files = %q, want the entry left as it was", c.Files)
	}
	if len(c.Briefs) != 1 || c.Briefs[0].Source != gone || c.Briefs[0].Copy != "" || !strings.Contains(c.Briefs[0].Skipped, "cannot be read") {
		t.Errorf("briefs = %+v, want one skipped as unreadable", c.Briefs)
	}
}

func TestTakeBriefsSkipsWhenTheProjectFolderIsNotThere(t *testing.T) {
	notes := filepath.Join(t.TempDir(), "notes.md")
	writeBrief(t, notes, "x\n")
	c := briefCouncil(t, notes)
	c.Project = filepath.Join(c.Project, "missing")
	takeBriefs(c, briefDay)
	if c.Files[0] != notes || len(c.Briefs) != 1 || !strings.Contains(c.Briefs[0].Skipped, "not there") {
		t.Errorf("files %q, briefs %+v: want the brief skipped, the project is not there", c.Files, c.Briefs)
	}
}

// A council with no project folder has nowhere to copy into: takeBriefs leaves it as it is and writes nothing. An empty
// Project cleans to ".", so a copy that slipped through would land under the working folder, which the test owns.
func TestTakeBriefsTakesNothingWhenTheCouncilHasNoProject(t *testing.T) {
	work := t.TempDir()
	t.Chdir(work)
	outside := t.TempDir()
	notes := filepath.Join(outside, "notes.md")
	writeBrief(t, notes, "# Notes\n")

	for _, project := range []string{"", "  "} {
		c := testCouncil("c1")
		c.Project, c.Files = project, []string{notes, "pkg/ram.go"}
		takeBriefs(c, briefDay)
		if want := []string{notes, "pkg/ram.go"}; !reflect.DeepEqual(c.Files, want) {
			t.Errorf("project %q: files = %q, want them exactly as given %q", project, c.Files, want)
		}
		if len(c.Briefs) != 0 {
			t.Errorf("project %q: briefs = %+v, want none: there is no project to copy into", project, c.Briefs)
		}
	}

	for root, want := range map[string][]string{work: nil, outside: {"notes.md"}} {
		var found []string
		err := filepath.WalkDir(root, func(p string, _ os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if rel, _ := filepath.Rel(root, p); rel != "." {
				found = append(found, filepath.ToSlash(rel))
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(found, want) {
			t.Errorf("under %s: found %q, want %q: nothing is written to disk", root, found, want)
		}
	}
}

func TestTakeBriefsDoesNotCopyTwiceOnARerun(t *testing.T) {
	notes := filepath.Join(t.TempDir(), "notes.md")
	writeBrief(t, notes, "first\n")
	c := briefCouncil(t, notes)
	takeBriefs(c, briefDay)
	writeBrief(t, notes, "second\n")
	files, briefs := append([]string(nil), c.Files...), append([]CouncilBrief(nil), c.Briefs...)

	takeBriefs(c, briefDay.AddDate(0, 0, 1))
	if !reflect.DeepEqual(c.Files, files) || !reflect.DeepEqual(c.Briefs, briefs) {
		t.Errorf("a re-run changed files %q → %q, briefs %+v → %+v", files, c.Files, briefs, c.Briefs)
	}
	if got := readBack(t, filepath.Join(c.Project, filepath.FromSlash(c.Files[0]))); got != "first\n" {
		t.Errorf("the copy was taken again: it holds %q", got)
	}

	// a record whose files still name the source (as given again) takes the copy it has
	c.Files = []string{notes}
	takeBriefs(c, briefDay.AddDate(0, 0, 1))
	if !reflect.DeepEqual(c.Files, files) || !reflect.DeepEqual(c.Briefs, briefs) {
		t.Errorf("the source given again: files %q, briefs %+v, want %q and %+v", c.Files, c.Briefs, files, briefs)
	}
}

func TestTakeBriefsRetriesABriefThatWasSkipped(t *testing.T) {
	notes := filepath.Join(t.TempDir(), "notes.md")
	c := briefCouncil(t, notes)
	takeBriefs(c, briefDay)
	writeBrief(t, notes, "now here\n")
	takeBriefs(c, briefDay)
	if want := []CouncilBrief{{Source: notes, Copy: "docs/council/briefs/2026-11-23-c1-notes.md"}}; !reflect.DeepEqual(c.Briefs, want) {
		t.Errorf("briefs = %+v, want the skip replaced by the copy %+v", c.Briefs, want)
	}
}

func TestTakeBriefsNumbersOneBaseNameTwice(t *testing.T) {
	a := filepath.Join(t.TempDir(), "notes.md")
	b := filepath.Join(t.TempDir(), "notes.md")
	writeBrief(t, a, "a\n")
	writeBrief(t, b, "b\n")
	c := briefCouncil(t, a, b)
	takeBriefs(c, briefDay)
	want := []string{"docs/council/briefs/2026-11-23-c1-notes.md", "docs/council/briefs/2026-11-23-c1-notes-2.md"}
	if !reflect.DeepEqual(c.Files, want) {
		t.Fatalf("files = %q, want %q", c.Files, want)
	}
	if got := readBack(t, filepath.Join(c.Project, filepath.FromSlash(want[1]))); got != "b\n" {
		t.Errorf("the second copy holds %q", got)
	}
}

func TestTakeBriefsLeavesTheCallersSliceAndScreenshotsAlone(t *testing.T) {
	notes := filepath.Join(t.TempDir(), "notes.md")
	writeBrief(t, notes, "x\n")
	shot := filepath.Join(t.TempDir(), "shot.png")
	files := []string{notes}
	c := briefCouncil(t, files...)
	c.Files, c.Screenshots = files, []string{shot}
	takeBriefs(c, briefDay)
	if files[0] != notes {
		t.Errorf("the caller's files slice was rewritten: %q", files)
	}
	if c.Screenshots[0] != shot {
		t.Errorf("screenshots = %q, want them untouched", c.Screenshots)
	}
}

func TestChangedFilesWatchesABriefsSource(t *testing.T) {
	c := briefCouncil(t, "docs/council/briefs/2026-11-23-c1-notes.md", "pkg/ram.go", "docs/council/briefs/2026-11-23-c1-spec.md")
	src1, src2 := filepath.Join("C:", "out", "notes.md"), filepath.Join("C:", "out", "spec.md")
	c.Briefs = []CouncilBrief{
		{Source: src2, Copy: "docs/council/briefs/2026-11-23-c1-spec.md"},
		{Source: src1, Copy: "docs/council/briefs/2026-11-23-c1-notes.md"},
		{Source: filepath.Join("C:", "out", "big.pdf"), Skipped: "over the 1 MB cap"},
	}
	useMtimes(t, map[string]int64{
		councilFilePath(c, "pkg/ram.go"):      2000,
		src1:                                  3000,
		src2:                                  3000,
		filepath.Join("C:", "out", "big.pdf"): 3000,
	})
	if got, want := changedFiles(c, 1000), []string{src1, "pkg/ram.go", src2}; !reflect.DeepEqual(got, want) {
		t.Errorf("changedFiles = %q, want %q: each source in the place files lists its copy", got, want)
	}
	if got := changedFiles(c, 5000); len(got) != 0 {
		t.Errorf("nothing changed after 5000, got %q", got)
	}
}

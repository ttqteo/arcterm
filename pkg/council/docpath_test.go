// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// useDocDay fixes the date a default document name starts with.
func useDocDay(t *testing.T) {
	t.Helper()
	prev := DocDay
	t.Cleanup(func() { DocDay = prev })
	DocDay = func() time.Time { return time.Date(2026, 10, 21, 9, 0, 0, 0, time.Local) }
}

func docCouncil(project string) *Council {
	c := fixtureCouncil("c1", StateDone, 3)
	c.Project, c.Feature = project, "Idle sleep for services!"
	return c
}

func TestFeatureSlug(t *testing.T) {
	for in, want := range map[string]string{
		"Idle sleep for services!":    "idle-sleep-for-services",
		"  --Dark   mode / Light--  ": "dark-mode-light",
		"Chế độ ngủ cho dịch vụ":      "chế-độ-ngủ-cho-dịch-vụ",
		"":                            "council",
		" ?! ":                        "council",
		strings.Repeat("ab ", 40):     strings.TrimSuffix(strings.Repeat("ab-", 20), "-"),
		strings.Repeat("a", 100):      strings.Repeat("a", docSlugRunes),
		"v2.1 release (draft)":        "v2-1-release-draft",
		"C:\\Users\\me\\proj /x":      "c-users-me-proj-x",
		"naïve café":                  "naïve-café",
		"under_score":                 "under-score",
	} {
		if got := FeatureSlug(in); got != want {
			t.Errorf("FeatureSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDocPathDefault(t *testing.T) {
	useDocDay(t)
	project := t.TempDir()
	got, err := DocPath(docCouncil(project), "")
	if err != nil {
		t.Fatalf("DocPath: %v", err)
	}
	if want := filepath.Join(project, "docs", "council", "2026-10-21-idle-sleep-for-services.md"); got != want {
		t.Errorf("default path = %q, want %q", got, want)
	}
}

func TestDocPathPickedPath(t *testing.T) {
	project := t.TempDir()
	c := docCouncil(project)
	// a relative path is under the project, an absolute one inside it is kept as it is
	if got, err := DocPath(c, "notes/out.md"); err != nil || got != filepath.Join(project, "notes", "out.md") {
		t.Errorf("relative path = %q, %v", got, err)
	}
	inside := filepath.Join(project, "abs.md")
	if got, err := DocPath(c, inside); err != nil || got != inside {
		t.Errorf("absolute path inside the project = %q, %v", got, err)
	}
	// a path that is asked for is written as it is, even when a file is there: it is the person's pick
	if err := os.WriteFile(inside, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, err := DocPath(c, inside); err != nil || got != inside {
		t.Errorf("picked path over a file = %q, %v, want it kept", got, err)
	}
	elsewhere := filepath.Join(t.TempDir(), "x.md")
	for _, path := range []string{elsewhere, filepath.Join("..", filepath.Base(filepath.Dir(elsewhere)), "x.md"), "../x.md", "docs/../../x.md", "..", "."} {
		if got, err := DocPath(c, path); err == nil {
			t.Errorf("path %q gave %q, want a refusal", path, got)
		}
	}
	if _, err := DocPath(&Council{Id: "c2", Feature: "No project"}, ""); err == nil {
		t.Error("a council with no project has nowhere to save a doc")
	}
}

func TestDocPathClash(t *testing.T) {
	useDocDay(t)
	project := t.TempDir()
	dir := filepath.Join(project, "docs", "council")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	base := "2026-10-21-idle-sleep-for-services"
	for _, tc := range []struct{ existing, want string }{
		{"", base + ".md"},
		{base + ".md", base + "-2.md"},
		{base + "-2.md", base + "-3.md"},
	} {
		if tc.existing != "" {
			if err := os.WriteFile(filepath.Join(dir, tc.existing), []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		got, err := DocPath(docCouncil(project), "")
		if err != nil || got != filepath.Join(dir, tc.want) {
			t.Errorf("with %q there: path = %q, %v, want %q", tc.existing, got, err, tc.want)
		}
	}
}

func TestDocPathNotGit(t *testing.T) {
	useDocDay(t)
	project := t.TempDir() // a plain folder: no .git anywhere in it
	c := docCouncil(project)
	path, err := WriteDocument(c, "")
	if err != nil {
		t.Fatalf("WriteDocument in a plain folder: %v", err)
	}
	body, err := os.ReadFile(path)
	if err != nil || string(body) != Document(c) {
		t.Fatalf("the file = %q, %v, want the document", body, err)
	}
	if _, err := os.Stat(filepath.Join(project, ".git")); err == nil {
		t.Error("writing the document made a .git")
	}
}

func TestDocPathSavedTwiceKeepsOneFile(t *testing.T) {
	useDocDay(t)
	project := t.TempDir()
	c := docCouncil(project)
	first, err := WriteDocument(c, "")
	if err != nil {
		t.Fatal(err)
	}
	// a follow-up, Summarize or Retry rewrites the file the council was saved at: no -2 copy
	c.DocPath = first
	second, err := WriteDocument(c, "")
	if err != nil || second != first {
		t.Fatalf("second save = %q, %v, want %q again", second, err, first)
	}
	files, err := os.ReadDir(filepath.Dir(first))
	if err != nil || len(files) != 1 {
		t.Errorf("docs/council holds %d files, %v, want one", len(files), err)
	}

	// a DocPath that points outside the project is not trusted: the default path is used
	c.DocPath = filepath.Join(t.TempDir(), "elsewhere.md")
	if got, err := DocPath(c, ""); err != nil || !strings.HasPrefix(got, project) {
		t.Errorf("DocPath outside the project gave %q, %v, want a path under the project", got, err)
	}
}

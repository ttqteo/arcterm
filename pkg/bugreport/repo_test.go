// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bugreport

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const forkModule = "github.com/wavetermdev/waveterm"

// fakeRepo makes dir look like arcterm's checkout: Taskfile.yml, src-tauri/, and a go.mod naming module.
func fakeRepo(t *testing.T, dir, goMod string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "src-tauri"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Taskfile.yml"), []byte("version: '3'\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte(goMod), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func goMod(module string) string { return "module " + module + "\n\ngo 1.25\n" }

func TestIsArctermRepo(t *testing.T) {
	root := t.TempDir()
	cases := []struct {
		name  string
		build func(dir string)
		want  bool
	}{
		{"all three", func(d string) { fakeRepo(t, d, goMod(forkModule)) }, true},
		{"module line with a comment and CRLF", func(d string) {
			fakeRepo(t, d, "// header\r\nmodule "+forkModule+" // the fork\r\n\r\ngo 1.25\r\n")
		}, true},
		{"quoted module", func(d string) { fakeRepo(t, d, "module \""+forkModule+"\"\n") }, true},
		{"another module", func(d string) { fakeRepo(t, d, goMod("github.com/someone/else")) }, false},
		{"a module that only starts with it", func(d string) { fakeRepo(t, d, goMod(forkModule+"/v2")) }, false},
		{"no go.mod", func(d string) {
			fakeRepo(t, d, "")
			os.Remove(filepath.Join(d, "go.mod"))
		}, false},
		{"no Taskfile", func(d string) {
			fakeRepo(t, d, goMod(forkModule))
			os.Remove(filepath.Join(d, "Taskfile.yml"))
		}, false},
		{"no src-tauri", func(d string) {
			fakeRepo(t, d, goMod(forkModule))
			os.Remove(filepath.Join(d, "src-tauri"))
		}, false},
		{"src-tauri is a file", func(d string) {
			fakeRepo(t, d, goMod(forkModule))
			os.Remove(filepath.Join(d, "src-tauri"))
			os.WriteFile(filepath.Join(d, "src-tauri"), []byte("x"), 0o644)
		}, false},
		{"a go.mod with no module line", func(d string) { fakeRepo(t, d, "go 1.25\n") }, false},
		{"an empty dir", func(d string) { os.MkdirAll(d, 0o755) }, false},
	}
	for i, c := range cases {
		dir := filepath.Join(root, string(rune('a'+i)))
		c.build(dir)
		if got := IsArctermRepo(dir); got != c.want {
			t.Errorf("%s: IsArctermRepo = %v, want %v", c.name, got, c.want)
		}
	}
	if IsArctermRepo(filepath.Join(root, "missing")) || IsArctermRepo("") {
		t.Error("a missing or empty path is not the repo")
	}
}

func TestFindRepoSettingWins(t *testing.T) {
	root := t.TempDir()
	chosen := filepath.Join(root, "chosen") // any folder that exists: the person picked it
	if err := os.MkdirAll(chosen, 0o755); err != nil {
		t.Fatal(err)
	}
	scanned := fakeRepo(t, filepath.Join(root, "scanned"), goMod(forkModule))
	projects := map[string]wconfig.ProjectKeywords{"scanned": {Path: scanned}}

	path, project, ok := FindRepo(chosen, projects)
	if !ok || path != chosen || project != "" {
		t.Fatalf("the setting wins over the scan, and no project sits there: %q %q %v", path, project, ok)
	}

	projects["chosen-project"] = wconfig.ProjectKeywords{Path: chosen}
	path, project, ok = FindRepo(chosen, projects)
	if !ok || path != chosen || project != "chosen-project" {
		t.Fatalf("the project registered at the setting's path is named: %q %q %v", path, project, ok)
	}
}

func TestFindRepoAMissingSettingIsNotFound(t *testing.T) {
	root := t.TempDir()
	scanned := fakeRepo(t, filepath.Join(root, "scanned"), goMod(forkModule))
	projects := map[string]wconfig.ProjectKeywords{"scanned": {Path: scanned}}
	if _, _, ok := FindRepo(filepath.Join(root, "moved away"), projects); ok {
		t.Fatal("a set folder that no longer exists reads as not found, so the person can pick again")
	}
	file := filepath.Join(root, "a file")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := FindRepo(file, projects); ok {
		t.Fatal("a file is not a folder")
	}
}

func TestFindRepoScansProjectsInNameOrder(t *testing.T) {
	root := t.TempDir()
	plain := filepath.Join(root, "plain")
	if err := os.MkdirAll(plain, 0o755); err != nil {
		t.Fatal(err)
	}
	b := fakeRepo(t, filepath.Join(root, "b"), goMod(forkModule))
	c := fakeRepo(t, filepath.Join(root, "c"), goMod(forkModule))
	projects := map[string]wconfig.ProjectKeywords{
		"zz-gone":  {Path: filepath.Join(root, "gone")},
		"aa-plain": {Path: plain},
		"ccc":      {Path: c},
		"bbb":      {Path: b},
		"empty":    {},
	}
	for i := 0; i < 20; i++ { // map order is random: the answer is not
		path, project, ok := FindRepo("", projects)
		if !ok || path != b || project != "bbb" {
			t.Fatalf("got %q %q %v, want the first repo by name", path, project, ok)
		}
	}
}

func TestFindRepoNone(t *testing.T) {
	root := t.TempDir()
	other := fakeRepo(t, filepath.Join(root, "other"), goMod("example.com/other"))
	for name, projects := range map[string]map[string]wconfig.ProjectKeywords{
		"nil":             nil,
		"no repo of ours": {"other": {Path: other}},
	} {
		if path, project, ok := FindRepo("", projects); ok || path != "" || project != "" {
			t.Errorf("%s: %q %q %v", name, path, project, ok)
		}
	}
	if _, _, ok := FindRepo("   ", nil); ok {
		t.Error("a blank setting is no setting")
	}
}

func TestFindRepoMatchesTheProjectPathLoosely(t *testing.T) {
	root := t.TempDir()
	repo := fakeRepo(t, filepath.Join(root, "arcterm"), goMod(forkModule))
	// a trailing separator and, on Windows, the other case and slash direction, are the same folder
	setting := repo + string(filepath.Separator)
	projects := map[string]wconfig.ProjectKeywords{"arcterm": {Path: repo}}
	if runtime.GOOS == "windows" {
		projects["arcterm"] = wconfig.ProjectKeywords{Path: strings.ToUpper(filepath.ToSlash(repo))}
	}
	path, project, ok := FindRepo(setting, projects)
	if !ok || project != "arcterm" {
		t.Fatalf("%q %q %v", path, project, ok)
	}
	if filepath.Clean(path) != filepath.Clean(repo) {
		t.Fatalf("the path comes back clean: %q", path)
	}
}

func TestFindRepoExpandsAHomePathInAProject(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	fakeRepo(t, filepath.Join(home, "code", "arcterm"), goMod(forkModule))
	path, project, ok := FindRepo("", map[string]wconfig.ProjectKeywords{"arcterm": {Path: "~/code/arcterm"}})
	if !ok || project != "arcterm" || filepath.Clean(path) != filepath.Join(home, "code", "arcterm") {
		t.Fatalf("%q %q %v", path, project, ok)
	}
}

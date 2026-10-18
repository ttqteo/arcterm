// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package projectscan

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func mkdir(t *testing.T, parts ...string) string {
	t.Helper()
	p := filepath.Join(parts...)
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func touch(t *testing.T, parts ...string) {
	t.Helper()
	p := filepath.Join(parts...)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, nil, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestKind(t *testing.T) {
	base := t.TempDir()
	maven := mkdir(t, base, "maven")
	touch(t, maven, "pom.xml")
	touch(t, maven, "package.json")
	node := mkdir(t, base, "node")
	touch(t, node, "package.json")
	repo := mkdir(t, base, "repo", ".git")
	plain := mkdir(t, base, "plain")

	for _, c := range []struct{ dir, want string }{
		{maven, "Maven"},
		{node, "Node"},
		{filepath.Dir(repo), "git"},
		{plain, ""},
	} {
		if got := Kind(c.dir); got != c.want {
			t.Errorf("Kind(%s) = %q, want %q", filepath.Base(c.dir), got, c.want)
		}
	}
}

func TestRoot(t *testing.T) {
	home := t.TempDir()
	touch(t, home, "package.json")
	repo := mkdir(t, home, "ws", "repo")
	mkdir(t, repo, ".git")
	sub := mkdir(t, repo, "src", "services")
	loose := mkdir(t, home, "notes", "week1")

	if got, ok := Root(sub, home); !ok || got != repo {
		t.Errorf("Root(subfolder) = %q, %v, want the repo above it", got, ok)
	}
	if got, ok := Root(repo, home); !ok || got != repo {
		t.Errorf("Root(repo) = %q, %v, want the repo itself", got, ok)
	}
	// a marker in home makes no project of home or of the folders under it
	if got, ok := Root(home, home); ok {
		t.Errorf("Root(home) = %q, want none", got)
	}
	if got, ok := Root(loose, home); ok {
		t.Errorf("Root(unmarked folder) = %q, want none", got)
	}
	if got, ok := Root(string(filepath.Separator), home); ok {
		t.Errorf("Root(/) = %q, want none", got)
	}
}

func TestSearchRoots(t *testing.T) {
	home := filepath.Join(string(filepath.Separator), "Users", "me")
	near := []string{
		filepath.Join(home, "ws", "dev", "a"),
		filepath.Join(home, "ws", "dev", "b"),
		filepath.Join(home, "solo"),
		filepath.Join(string(filepath.Separator), "opt", "tools", "x"),
	}
	want := []string{
		filepath.Join(home, "ws", "dev"),
		filepath.Join(home, "ws"),
		filepath.Join(string(filepath.Separator), "opt", "tools"),
		filepath.Join(string(filepath.Separator), "opt"),
	}
	if got := SearchRoots(near, home); !reflect.DeepEqual(got, want) {
		t.Errorf("SearchRoots = %v, want %v (never home, a folder above it or the filesystem root)", got, want)
	}
}

func TestFind(t *testing.T) {
	root := t.TempDir()
	old := time.Now().Add(-48 * time.Hour)

	app := mkdir(t, root, "app")
	mkdir(t, app, ".git")
	touch(t, app, "web", "package.json") // inside a project: not a project of its own
	deep := mkdir(t, root, "g1", "g2", "svc")
	touch(t, deep, "pom.xml")
	touch(t, root, "g1", "g2", "g3", "toodeep", "go.mod")
	touch(t, root, "node_modules", "lib", "package.json")
	touch(t, root, ".cache", "thing", "package.json")
	touch(t, root, "skipme", "tree", "Cargo.toml")
	// a linked worktree (its .git a file) is a branch of a repo, not a project of its own
	touch(t, root, "app.worktrees", "feature", ".git")
	touch(t, root, "app.worktrees", "feature", "package.json")
	other := mkdir(t, t.TempDir(), "linked")
	touch(t, other, "package.json")
	if err := os.Symlink(other, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(deep, old, old); err != nil {
		t.Fatal(err)
	}

	got := Find([]string{root, root}, []string{filepath.Join(root, "skipme")})
	var paths []string
	for _, f := range got {
		paths = append(paths, f.Path)
	}
	if want := []string{app, deep}; !reflect.DeepEqual(paths, want) {
		t.Fatalf("Find = %v, want %v, newest first", paths, want)
	}
	if got[0].Name != "app" || got[0].Kind != "git" || got[1].Kind != "Maven" {
		t.Errorf("Find = %+v, want app as git and svc as Maven", got)
	}
	if got[1].ModTs != old.UnixMilli() {
		t.Errorf("svc ModTs = %d, want its folder's mtime %d", got[1].ModTs, old.UnixMilli())
	}
}

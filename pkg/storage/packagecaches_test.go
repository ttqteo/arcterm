// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func cacheByID(caches []PackageCache, id string) PackageCache {
	for _, c := range caches {
		if c.ID == id {
			return c
		}
	}
	return PackageCache{}
}

func TestPackageCacheDirsReadsTheirVariablesThenDefaults(t *testing.T) {
	home := t.TempDir()
	elsewhere := t.TempDir()
	vars := map[string]string{"GOCACHE": filepath.Join(elsewhere, "gocache"), "CARGO_HOME": filepath.Join(elsewhere, "cargo")}
	got := PackageCacheDirs("darwin", home, func(k string) string { return vars[k] })
	for id, want := range map[string]string{
		"go-build":       filepath.Join(elsewhere, "gocache"),
		"go-mod":         filepath.Join(home, "go", "pkg", "mod"),
		"npm":            filepath.Join(home, ".npm", "_cacache"),
		"cargo-registry": filepath.Join(elsewhere, "cargo", "registry"),
		"pip":            filepath.Join(home, "Library", "Caches", "pip"),
		"homebrew":       filepath.Join(home, "Library", "Caches", "Homebrew"),
	} {
		if c := cacheByID(got, id); c.Path != want {
			t.Errorf("%s = %q, want %q", id, c.Path, want)
		}
	}
	if c := cacheByID(got, "npm"); c.Detail != filepath.Join("~", ".npm", "_cacache") {
		t.Errorf("npm's row shows %q, want the home dir as ~", c.Detail)
	}
	if c := cacheByID(got, "go-build"); c.Detail != c.Path {
		t.Errorf("a cache outside home shows its path, got %q", c.Detail)
	}
	linux := PackageCacheDirs("linux", home, func(string) string { return "" })
	if c := cacheByID(linux, "go-build"); c.Path != filepath.Join(home, ".cache", "go-build") {
		t.Errorf("linux go-build = %q", c.Path)
	}
	if c := cacheByID(linux, "homebrew"); c.ID != "" {
		t.Error("Homebrew's cache is a Mac's only")
	}
}

func TestPackageCacheDirsNeverPointsAtHome(t *testing.T) {
	home := t.TempDir()
	vars := map[string]string{"GOCACHE": home, "GOMODCACHE": filepath.Dir(home), "UV_CACHE_DIR": "relative/uv", "BUN_INSTALL_CACHE_DIR": "off"}
	got := PackageCacheDirs("darwin", home, func(k string) string { return vars[k] })
	for _, id := range []string{"go-build", "go-mod", "uv", "bun"} {
		if c := cacheByID(got, id); c.ID != "" {
			t.Errorf("%s = %q: a variable set to home, a folder holding it, or a relative path is left out", id, c.Path)
		}
	}
	if c := cacheByID(PackageCacheDirs("darwin", home, func(k string) string {
		return map[string]string{"GOCACHE": "off"}[k]
	}), "go-build"); c.ID != "" {
		t.Error("GOCACHE=off has no cache")
	}
}

func cacheEnv(t *testing.T) (*Env, string) {
	t.Helper()
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "npm", "a"), 10)
	writeFile(t, filepath.Join(root, "gomod", "m@v1", "b"), 20)
	return &Env{PackageCaches: []PackageCache{
		{ID: "npm", Label: "npm cache", Path: filepath.Join(root, "npm")},
		{ID: "go-mod", Label: "Go modules", Path: filepath.Join(root, "gomod")},
		{ID: "pip", Label: "pip cache", Path: filepath.Join(root, "pip")}, // never made
	}}, root
}

func TestPackageCachesListsWhatExists(t *testing.T) {
	env, root := cacheEnv(t)
	rep := packageCaches{}.measure(context.Background(), env)
	if len(rep.Items) != 2 || rep.Bytes != 30 || rep.CleanableBytes != 30 {
		t.Fatalf("got %+v, want npm and Go modules, 30 bytes", rep)
	}
	if it := itemByID(rep.Items, "npm"); it.Kind != KindCache || it.Path != filepath.Join(root, "npm") || !it.Cleanable {
		t.Fatalf("npm: %+v", it)
	}
}

func TestPackageCachesCleanByIDOnly(t *testing.T) {
	env, root := cacheEnv(t)
	gomod := filepath.Join(root, "gomod")
	if runtime.GOOS != "windows" {
		// the module cache makes its folders read-only
		if err := os.Chmod(filepath.Join(gomod, "m@v1"), 0o555); err != nil {
			t.Fatal(err)
		}
	}
	res := packageCaches{}.clean(context.Background(), env, []string{"go-mod", "pip", root, "nope"}, CleanOpts{})
	if len(res.Cleaned) != 1 || res.Cleaned[0] != "go-mod" || res.Reclaimed != 20 || fileExists(gomod) {
		t.Fatalf("got %+v, want only Go modules removed (read-only folders and all)", res)
	}
	if len(res.Skipped) != 3 || !fileExists(filepath.Join(root, "npm", "a")) {
		t.Fatalf("a missing cache, a path and an unknown id are skipped, nothing else touched: %+v", res.Skipped)
	}
}

func TestPackageCachesStayWhileABuildRunsAndNeverAutoClean(t *testing.T) {
	env, root := cacheEnv(t)
	env.BusyCaches = func() string { return "a build or install is running" }
	if it := itemByID(packageCaches{}.measure(context.Background(), env).Items, "npm"); it.Cleanable || it.Reason == "" {
		t.Fatalf("a cache must stay while a build runs: %+v", it)
	}
	if res := (packageCaches{}).clean(context.Background(), env, []string{"npm"}, CleanOpts{}); len(res.Cleaned) != 0 {
		t.Fatal("clean must refuse while a build runs")
	}
	env.BusyCaches = nil
	if res := (packageCaches{}).clean(context.Background(), env, []string{"npm"}, CleanOpts{Auto: true}); len(res.Cleaned) != 0 {
		t.Fatal("auto-clean must never touch a package cache")
	}
	if !fileExists(filepath.Join(root, "npm", "a")) {
		t.Fatal("npm's cache must still be there")
	}
}

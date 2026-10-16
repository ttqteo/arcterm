// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

// linkDepsFixture is a repo whose package dirs each hold one case, and an engine tree of it. Every main-side
// node_modules holds a marker naming its dir, so a link is told apart from a copy.
func linkDepsFixture(t *testing.T) (main, wt string) {
	t.Helper()
	main = newGitRepo(t)
	for _, d := range []string{"same", "uninstalled", "pkgdiff", "wsdiff", "mainonly", "present", "deep/nested/pkg", "mainlink", "crlf"} {
		writeFile(t, filepath.Join(main, d, "package.json"), `{"name":"`+filepath.Base(d)+`"}`+"\n")
	}
	writeFile(t, filepath.Join(main, "wsdiff", "pnpm-workspace.yaml"), "overrides: {}\n")
	gitCmd(t, main, "add", ".")
	gitCmd(t, main, "commit", "-m", "packages")
	wt, err := CreateRunWorktree(context.Background(), main, "run-1", gitCmd(t, main, "rev-parse", "HEAD"))
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{"same", "pkgdiff", "wsdiff", "mainonly", "present", "deep/nested/pkg", "crlf"} {
		writeFile(t, filepath.Join(main, d, "node_modules", "marker.txt"), d)
	}
	// the developer edited these after the tree's commit: what main has installed is no longer what the tree asks for
	writeFile(t, filepath.Join(main, "pkgdiff", "package.json"), `{"name":"pkgdiff","dependencies":{"x":"1"}}`+"\n")
	writeFile(t, filepath.Join(main, "wsdiff", "pnpm-workspace.yaml"), "overrides: {x: '2'}\n")
	// an untracked lockfile, as SIEM's gitignored pnpm-lock.yaml: the tree has none to compare
	writeFile(t, filepath.Join(main, "mainonly", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
	// saved with other line endings than the tree's checkout: the same manifest
	writeFile(t, filepath.Join(main, "crlf", "package.json"), `{"name":"crlf"}`+"\r\n")
	writeFile(t, filepath.Join(wt, "present", "node_modules", "own.txt"), "own")
	// main's own node_modules is a link to somewhere else: never chained
	elsewhere := t.TempDir()
	if err := linkDir(context.Background(), filepath.Join(main, "mainlink", "node_modules"), elsewhere); err != nil {
		t.Fatal(err)
	}
	return main, wt
}

func isLinkAt(t *testing.T, p string) bool {
	t.Helper()
	fi, err := os.Lstat(p)
	if err != nil {
		return false
	}
	return fi.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0
}

func TestLinkDependenciesLinksOnlyWhatMainHasInstalledForTheSameManifests(t *testing.T) {
	_, wt := linkDepsFixture(t)
	notLinked, err := linkDependencies(context.Background(), wt)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{"same", "mainonly", "deep/nested/pkg", "crlf"} {
		nm := filepath.Join(wt, d, "node_modules")
		if !isLinkAt(t, nm) {
			t.Errorf("%s: node_modules must be linked", d)
			continue
		}
		if b, err := os.ReadFile(filepath.Join(nm, "marker.txt")); err != nil || string(b) != d {
			t.Errorf("%s: the link must reach main's node_modules, read %q err %v", d, b, err)
		}
	}
	for _, d := range []string{"uninstalled", "pkgdiff", "wsdiff", "mainlink"} {
		if _, err := os.Lstat(filepath.Join(wt, d, "node_modules")); err == nil {
			t.Errorf("%s: node_modules must not be created", d)
		}
	}
	if isLinkAt(t, filepath.Join(wt, "present", "node_modules")) {
		t.Error("present: a node_modules the tree already has must be left alone")
	}
	want := []string{
		"pkgdiff (package.json differs from the main checkout's)",
		"wsdiff (pnpm-workspace.yaml differs from the main checkout's)",
	}
	slices.Sort(notLinked)
	if !slices.Equal(notLinked, want) {
		t.Fatalf("notLinked = %q, want %q: a dir main never installed is not the worker's to install", notLinked, want)
	}

	again, err := linkDependencies(context.Background(), wt)
	if err != nil {
		t.Fatalf("a second run must be a no-op: %v", err)
	}
	slices.Sort(again)
	if !slices.Equal(again, want) {
		t.Fatalf("a second run reported %q, want %q", again, want)
	}
}

func TestLinkDependenciesDoesNothingInTheMainCheckout(t *testing.T) {
	main, _ := linkDepsFixture(t)
	notLinked, err := linkDependencies(context.Background(), main)
	if err != nil || notLinked != nil {
		t.Fatalf("got %q, %v; want nothing", notLinked, err)
	}
	if isLinkAt(t, filepath.Join(main, "uninstalled", "node_modules")) {
		t.Fatal("the main checkout must not be linked into itself")
	}
}

func TestPrepareTreeRunsSetupInsteadOfLinking(t *testing.T) {
	_, wt := linkDepsFixture(t)
	var ran string
	old := runPlanCommand
	runPlanCommand = func(_ context.Context, dir, command string, _ []string, _ time.Duration, _ planProgress) (string, error) {
		ran = command
		return "ok", nil
	}
	t.Cleanup(func() { runPlanCommand = old })

	tail, notLinked, err := PrepareTree(context.Background(), wt, "make deps")
	if err != nil || tail != "ok" || notLinked != nil || ran != "make deps" {
		t.Fatalf("got tail %q notLinked %q err %v ran %q", tail, notLinked, err, ran)
	}
	if isLinkAt(t, filepath.Join(wt, "same", "node_modules")) {
		t.Fatal("a tree with a Setup gets that Setup, not the default links")
	}

	ran = ""
	if _, _, err := PrepareTree(context.Background(), wt, ""); err != nil {
		t.Fatal(err)
	}
	if ran != "" || !isLinkAt(t, filepath.Join(wt, "same", "node_modules")) {
		t.Fatalf("no Setup must link and run nothing, ran %q", ran)
	}
}

func TestRemovingALinkedTreeLeavesMainsNodeModules(t *testing.T) {
	main, wt := linkDepsFixture(t)
	if _, err := linkDependencies(context.Background(), wt); err != nil {
		t.Fatal(err)
	}
	if err := RemoveRunWorktree(context.Background(), main, "run-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("the tree must be removed, stat err = %v", err)
	}
	for _, d := range []string{"same", "mainonly", "deep/nested/pkg", "crlf"} {
		if b, err := os.ReadFile(filepath.Join(main, d, "node_modules", "marker.txt")); err != nil || string(b) != d {
			t.Errorf("%s: main's node_modules must survive the tree's removal, read %q err %v", d, b, err)
		}
	}
}

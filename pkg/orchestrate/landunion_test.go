// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestResolveAddOnlyPutsTheLandedLinesFirst(t *testing.T) {
	merged := "top\n<<<<<<< run\nrun line\n||||||| base\n=======\nlanded line\n>>>>>>> landed\nbottom\n"
	got, ok := resolveAddOnly(merged)
	if !ok || got != "top\nlanded line\nrun line\nbottom\n" {
		t.Fatalf("the base's added lines come first: ok %v, %q", ok, got)
	}
}

func TestResolveAddOnlyResolvesEveryBlock(t *testing.T) {
	merged := "<<<<<<< run\nr1\n||||||| base\n=======\nl1\n>>>>>>> landed\nmiddle\n<<<<<<< run\nr2a\nr2b\n||||||| base\n=======\nl2\n>>>>>>> landed\n"
	got, ok := resolveAddOnly(merged)
	if !ok || got != "l1\nr1\nmiddle\nl2\nr2a\nr2b\n" {
		t.Fatalf("both blocks are replaced and the text between them kept: ok %v, %q", ok, got)
	}
}

func TestResolveAddOnlyRefusesARealEdit(t *testing.T) {
	// the base has a line: one side changed or removed it, which is not an add
	merged := "<<<<<<< run\nnew\n||||||| base\nold\n=======\nother\n>>>>>>> landed\n"
	if got, ok := resolveAddOnly(merged); ok || got != "" {
		t.Fatalf("a block over a base line is a real conflict: ok %v, %q", ok, got)
	}
	// one add-only block does not excuse a real one after it
	merged = "<<<<<<< run\na\n||||||| base\n=======\nb\n>>>>>>> landed\n<<<<<<< run\nx\n||||||| base\ny\n=======\nz\n>>>>>>> landed\n"
	if got, ok := resolveAddOnly(merged); ok || got != "" {
		t.Fatalf("one real block holds the whole file: ok %v, %q", ok, got)
	}
}

func TestResolveAddOnlyKeepsAFileWithoutBlocks(t *testing.T) {
	merged := "one\ntwo"
	if got, ok := resolveAddOnly(merged); !ok || got != merged {
		t.Fatalf("a clean merge is returned as it was: ok %v, %q", ok, got)
	}
}

func TestResolveAddOnlyKeepsCRLF(t *testing.T) {
	merged := "top\r\n<<<<<<< run\r\nrun line\r\n||||||| base\r\n=======\r\nlanded line\r\n>>>>>>> landed\r\nbottom\r\n"
	got, ok := resolveAddOnly(merged)
	if !ok || got != "top\r\nlanded line\r\nrun line\r\nbottom\r\n" {
		t.Fatalf("every line keeps its own ending: ok %v, %q", ok, got)
	}
}

func TestResolveAddOnlyRefusesAnUnclosedBlock(t *testing.T) {
	for _, merged := range []string{
		"<<<<<<< run\nr\n",
		"<<<<<<< run\nr\n||||||| base\n",
		"<<<<<<< run\nr\n||||||| base\n=======\nl\n",
	} {
		if got, ok := resolveAddOnly(merged); ok || got != "" {
			t.Fatalf("a cut-off block is not resolvable: %q gave ok %v, %q", merged, ok, got)
		}
	}
}

func TestResolveAddOnlyKeepsASeparatorLookalikeInsideASide(t *testing.T) {
	// a markdown heading underline is a line of equals signs: only the one after the base part separates
	merged := "<<<<<<< run\nTitle\n=======\n||||||| base\n=======\nlanded\n>>>>>>> landed\n"
	got, ok := resolveAddOnly(merged)
	if !ok || got != "landed\nTitle\n=======\n" {
		t.Fatalf("a side's own equals line stays in that side: ok %v, %q", ok, got)
	}
}

func TestResolveAddOnlyRefusesAnAmbiguousSeparator(t *testing.T) {
	// a base part of one equals line reads as an empty base followed by a landed side that starts with the real separator
	merged := "<<<<<<< run\nr\n||||||| base\n=======\n=======\nl\n>>>>>>> landed\n"
	if got, ok := resolveAddOnly(merged); ok || got != "" {
		t.Fatalf("an equals line in the landed part cannot be told from the separator: ok %v, %q", ok, got)
	}
}

func TestUnionPaths(t *testing.T) {
	content := "# files whose conflicts the land resolves\n\nCHANGELOG.md\n  docs/open-issues.md  \r\n\t# an indented comment\nscripts\\cdp\\scenarios.mjs\n"
	want := []string{"CHANGELOG.md", "docs/open-issues.md", "scripts/cdp/scenarios.mjs"}
	if got := unionPaths(content); !slices.Equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	if got := unionPaths(""); len(got) != 0 {
		t.Fatalf("an empty file lists nothing: %q", got)
	}
}

func TestUnionMergePathsReadsTheBaseBranchAndToleratesNoFile(t *testing.T) {
	dir := newGitRepo(t)
	ctx := context.Background()
	if got := unionMergePaths(ctx, dir, "main"); len(got) != 0 {
		t.Fatalf("a project with no .arc/union-merge lists nothing: %q", got)
	}
	writeFile(t, filepath.Join(dir, ".arc", "union-merge"), "# listed\nCHANGELOG.md\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "list the changelog")
	// the base branch's committed list counts, not a working copy
	writeFile(t, filepath.Join(dir, ".arc", "union-merge"), "CHANGELOG.md\nother.md\n")
	if got := unionMergePaths(ctx, dir, "main"); !slices.Equal(got, []string{"CHANGELOG.md"}) {
		t.Fatalf("got %q", got)
	}
}

// Two lines appended at the same spot of CHANGELOG.md: git merge conflicts, and the file resolves with main's line
// first, as main landed first.
func TestResolveAddOnlyFileInRealMerge(t *testing.T) {
	dir := newGitRepo(t)
	ctx := context.Background()
	changelog := filepath.Join(dir, "CHANGELOG.md")
	writeFile(t, changelog, "# Changelog\n\n## Unreleased\n\n- first\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "changelog")
	gitCmd(t, dir, "checkout", "-b", "wave/run")
	writeFile(t, changelog, "# Changelog\n\n## Unreleased\n\n- first\n- from the run\n")
	gitCmd(t, dir, "commit", "-am", "run entry")
	gitCmd(t, dir, "checkout", "main")
	writeFile(t, changelog, "# Changelog\n\n## Unreleased\n\n- first\n- from main\n")
	gitCmd(t, dir, "commit", "-am", "main entry")
	gitCmd(t, dir, "checkout", "wave/run")
	if _, err := git(ctx, dir, "merge", "--no-edit", "main"); err == nil {
		t.Fatal("the two appended lines should conflict")
	}

	ok, err := resolveAddOnlyFile(ctx, dir, "CHANGELOG.md")
	if err != nil || !ok {
		t.Fatalf("an add-only conflict resolves: ok %v, err %v", ok, err)
	}
	if want, got := "# Changelog\n\n## Unreleased\n\n- first\n- from main\n- from the run\n", readFile(t, changelog); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if unmerged := gitCmd(t, dir, "diff", "--name-only", "--diff-filter=U"); unmerged != "" {
		t.Fatalf("the resolved file is staged: still unmerged: %s", unmerged)
	}
	// the merge can now be finished
	gitCmd(t, dir, "commit", "--no-edit")
	if tip := gitCmd(t, dir, "show", "HEAD:CHANGELOG.md"); !strings.Contains(tip, "- from main\n- from the run") {
		t.Fatalf("the merge commit holds the union: %q", tip)
	}
}

// A CRLF file keeps its endings through git's own merge-file markers and the bytes read back from the index.
func TestResolveAddOnlyFileKeepsCRLF(t *testing.T) {
	dir := newGitRepo(t)
	ctx := context.Background()
	// no conversion on commit or checkout, whatever the machine's autocrlf is
	gitCmd(t, dir, "config", "core.autocrlf", "false")
	changelog := filepath.Join(dir, "CHANGELOG.md")
	writeFile(t, changelog, "# Changelog\r\n\r\n- first\r\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "changelog")
	gitCmd(t, dir, "checkout", "-b", "wave/run")
	writeFile(t, changelog, "# Changelog\r\n\r\n- first\r\n- from the run\r\n")
	gitCmd(t, dir, "commit", "-am", "run entry")
	gitCmd(t, dir, "checkout", "main")
	writeFile(t, changelog, "# Changelog\r\n\r\n- first\r\n- from main\r\n")
	gitCmd(t, dir, "commit", "-am", "main entry")
	gitCmd(t, dir, "checkout", "wave/run")
	if _, err := git(ctx, dir, "merge", "--no-edit", "main"); err == nil {
		t.Fatal("the two appended lines should conflict")
	}

	ok, err := resolveAddOnlyFile(ctx, dir, "CHANGELOG.md")
	if err != nil || !ok {
		t.Fatalf("an add-only conflict resolves: ok %v, err %v", ok, err)
	}
	if want, got := "# Changelog\r\n\r\n- first\r\n- from main\r\n- from the run\r\n", readFile(t, changelog); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveAddOnlyFileLeavesARealConflict(t *testing.T) {
	dir := newGitRepo(t)
	ctx := context.Background()
	notes := filepath.Join(dir, "notes.md")
	writeFile(t, notes, "one\ntwo\nthree\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "notes")
	gitCmd(t, dir, "checkout", "-b", "wave/run")
	writeFile(t, notes, "one\nrun two\nthree\n")
	gitCmd(t, dir, "commit", "-am", "run edit")
	gitCmd(t, dir, "checkout", "main")
	writeFile(t, notes, "one\nmain two\nthree\n")
	gitCmd(t, dir, "commit", "-am", "main edit")
	gitCmd(t, dir, "checkout", "wave/run")
	if _, err := git(ctx, dir, "merge", "--no-edit", "main"); err == nil {
		t.Fatal("the two edits of one line should conflict")
	}
	before := readFile(t, notes)

	ok, err := resolveAddOnlyFile(ctx, dir, "notes.md")
	if err != nil || ok {
		t.Fatalf("an edit of one line is not add-only: ok %v, err %v", ok, err)
	}
	if after := readFile(t, notes); after != before {
		t.Fatalf("a file left to a human is left as git wrote it: %q", after)
	}
	if unmerged := gitCmd(t, dir, "diff", "--name-only", "--diff-filter=U"); unmerged != "notes.md" {
		t.Fatalf("the file stays unmerged: %q", unmerged)
	}
}

// Both sides adding the same new file has no common ancestor: the base is empty and both bodies are adds.
func TestResolveAddOnlyFileWhenBothSidesAddedTheFile(t *testing.T) {
	dir := newGitRepo(t)
	ctx := context.Background()
	gitCmd(t, dir, "checkout", "-b", "wave/run")
	writeFile(t, filepath.Join(dir, "log.md"), "run entry\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "run adds log")
	gitCmd(t, dir, "checkout", "main")
	writeFile(t, filepath.Join(dir, "log.md"), "main entry\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "main adds log")
	gitCmd(t, dir, "checkout", "wave/run")
	if _, err := git(ctx, dir, "merge", "--no-edit", "main"); err == nil {
		t.Fatal("two new files at one path should conflict")
	}

	ok, err := resolveAddOnlyFile(ctx, dir, "log.md")
	if err != nil || !ok {
		t.Fatalf("two adds of one file resolve: ok %v, err %v", ok, err)
	}
	if got := readFile(t, filepath.Join(dir, "log.md")); got != "main entry\nrun entry\n" {
		t.Fatalf("got %q", got)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"path/filepath"
	"strings"
	"testing"
)

// validateTestRun parses the judge reply over the fixture inventory and validates it, failing unless
// the change titled "ok" is kept and the one titled "bad" is dropped with a reason containing want.
func validateTestRun(t *testing.T, inv *Inventory, docs map[string]string, docTarget, reply, want string) {
	t.Helper()
	changes, err := ParseJudge(reply, inv, docTarget)
	if err != nil {
		t.Fatal(err)
	}
	kept, dropped := Validate(changes, map[string]*Inventory{inv.Folder: inv}, docs)
	if len(kept) != 1 || kept[0].Title != "ok" {
		t.Fatalf("kept %+v, want only the change titled ok (dropped: %v)", kept, dropped)
	}
	if len(dropped) != 1 || !strings.Contains(dropped[0], `"bad"`) || !strings.Contains(dropped[0], want) {
		t.Fatalf("dropped %v, want one reason naming \"bad\" and containing %q", dropped, want)
	}
}

func TestValidateDropsMissingFile(t *testing.T) {
	inv := judgeTestInventory(t)
	validateTestRun(t, inv, nil, judgeDocAgents, `{"changes": [
		{"kind": "delete", "title": "ok", "files": ["alpha.md"]},
		{"kind": "delete", "title": "bad", "files": ["../alpha.md"]}
	]}`, "names ../alpha.md, which isn't in")
}

func TestValidateDropsTrimNotExactlyOnce(t *testing.T) {
	inv := judgeTestInventory(t)
	validateTestRun(t, inv, nil, judgeDocAgents, `{"changes": [
		{"kind": "trim", "title": "ok", "files": ["alpha.md"], "old": " Verified 2026-07-24.", "new": ""},
		{"kind": "trim", "title": "bad", "files": ["beta.md"], "old": "Gone passage", "new": ""}
	]}`, "appears 0 times")

	// twice is as bad as never
	writeFile(t, inv.Memories[1].Path, "same. same.\n")
	validateTestRun(t, inv, nil, judgeDocAgents, `{"changes": [
		{"kind": "trim", "title": "ok", "files": ["alpha.md"], "old": "one thing", "new": "it"},
		{"kind": "trim", "title": "bad", "files": ["beta.md"], "old": "same.", "new": ""}
	]}`, "appears 2 times")

	// a CRLF file still matches a passage written with "\n"
	writeFile(t, inv.Memories[0].Path, "line one\r\nline two\r\n")
	validateTestRun(t, inv, nil, judgeDocAgents, `{"changes": [
		{"kind": "trim", "title": "ok", "files": ["alpha.md"], "old": "one\nline", "new": "one"},
		{"kind": "trim", "title": "bad", "files": ["beta.md"], "old": "", "new": "x"}
	]}`, "old passage is empty")
}

func TestValidateDropsSectionNotExactlyOnce(t *testing.T) {
	inv := judgeTestInventory(t)
	doc := filepath.Join(t.TempDir(), judgeDocAgents)
	docs := map[string]string{doc: "# Repo\r\n\r\n## Gotchas\r\n\r\n- one\r\n\r\n## Notes\r\n\r\n### Notes\r\n"}
	changes, err := ParseJudge(`{"changes": [
		{"kind": "move-to-doc", "title": "ok", "files": ["alpha.md"], "section": "Gotchas", "passage": "- alpha"},
		{"kind": "move-to-doc", "title": "bad", "files": ["beta.md"], "section": "## Notes", "passage": "- beta"},
		{"kind": "move-to-doc", "title": "missing", "files": ["beta.md"], "section": "Nowhere", "passage": "- beta"}
	]}`, inv, doc)
	if err != nil {
		t.Fatal(err)
	}
	kept, dropped := Validate(changes, map[string]*Inventory{inv.Folder: inv}, docs)
	if len(kept) != 1 || kept[0].Title != "ok" {
		t.Fatalf("kept %+v, want only ok", kept)
	}
	if kept[0].Op.DocSection != "## Gotchas" {
		t.Errorf("kept section %q, want the doc's exact heading line", kept[0].Op.DocSection)
	}
	if len(dropped) != 2 || !strings.Contains(dropped[0], "appears 2 times") || !strings.Contains(dropped[1], "appears 0 times") {
		t.Fatalf("dropped %v, want Notes twice and Nowhere never", dropped)
	}
}

func TestValidateDropsMergeUnderTwo(t *testing.T) {
	inv := judgeTestInventory(t)
	validateTestRun(t, inv, nil, judgeDocAgents, `{"changes": [
		{"kind": "merge", "title": "ok", "files": ["alpha.md", "beta.md"], "merge_name": "alpha.md", "merge_body": "x\n", "index_line": "- [A](alpha.md) — a"},
		{"kind": "merge", "title": "bad", "files": ["gamma.md"], "merge_name": "gamma-2.md", "merge_body": "x\n", "index_line": "- [G](gamma-2.md) — g"}
	]}`, "needs two or more files")

	// a merge never writes over a memory it doesn't merge
	validateTestRun(t, inv, nil, judgeDocAgents, `{"changes": [
		{"kind": "merge", "title": "ok", "files": ["alpha.md", "beta.md"], "merge_name": "ab.md", "merge_body": "x\n", "index_line": "- [AB](ab.md) — ab"},
		{"kind": "merge", "title": "bad", "files": ["alpha.md", "beta.md"], "merge_name": "gamma.md", "merge_body": "x\n", "index_line": "- [G](gamma.md) — g"}
	]}`, "a memory it doesn't merge")
}

func TestValidateDropsMultilineIndexLine(t *testing.T) {
	inv := judgeTestInventory(t)
	validateTestRun(t, inv, nil, judgeDocAgents, `{"changes": [
		{"kind": "add-to-index", "title": "ok", "files": ["gamma.md"], "index_line": "- [Gamma](gamma.md) — g"},
		{"kind": "trim", "title": "bad", "files": ["beta.md"], "old": "same", "new": "one", "index_line": "- [Beta](beta.md)\r\n— beta"}
	]}`, "more than one line")
}

func TestValidateDropsAlreadyLinked(t *testing.T) {
	inv := judgeTestInventory(t)
	// a trim may rewrite a memory's own index line: the line it replaces is removed
	validateTestRun(t, inv, nil, judgeDocAgents, `{"changes": [
		{"kind": "trim", "title": "ok", "files": ["beta.md"], "old": "same", "new": "one", "index_line": "- [Beta](beta.md) — shorter"},
		{"kind": "add-to-index", "title": "bad", "files": ["gamma.md"], "index_line": "- [Alpha again](alpha.md) — gamma"}
	]}`, "already links")
}

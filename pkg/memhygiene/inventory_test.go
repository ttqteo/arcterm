// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const inventoryTestIndex = "# Memory index\n" +
	"\n" +
	"- [A](a.md) and [B](b%20two.md) - both on one line\n" +
	"- [Gone](gone.md) - its file was deleted\n"

var inventoryTestFiles = map[string]string{
	"a.md":     "---\nname: a\ndescription: the a rule\nmetadata:\n  type: feedback\n---\n\nAlways do a.\n**Why:** because.\n",
	"b two.md": "plain body, no frontmatter\n",
	"c.md":     "---\ndescription: \"quoted c\"\n---\nc body\n",
}

func inventoryTestFolder(t *testing.T, convert func(string) string) string {
	t.Helper()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "MEMORY.md"), convert(inventoryTestIndex))
	for name, content := range inventoryTestFiles {
		writeFile(t, filepath.Join(dir, name), convert(content))
	}
	return dir
}

func TestInventoryParsesIndexLinksAndFrontmatter(t *testing.T) {
	dir := inventoryTestFolder(t, func(s string) string { return s })
	inv, err := ReadInventory(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, m := range inv.Memories {
		names = append(names, m.Name)
	}
	if want := []string{"a.md", "b two.md", "c.md"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("memories = %v, want %v (index order, then unlinked)", names, want)
	}
	both := "- [A](a.md) and [B](b%20two.md) - both on one line"
	if inv.Memories[0].IndexLine != both || inv.Memories[1].IndexLine != both {
		t.Fatalf("index lines = %q, %q; want both %q", inv.Memories[0].IndexLine, inv.Memories[1].IndexLine, both)
	}
	if inv.Memories[2].IndexLine != "" {
		t.Fatalf("unlinked c.md has index line %q", inv.Memories[2].IndexLine)
	}
	if want := []string{"gone.md"}; !reflect.DeepEqual(inv.DeadLinks, want) {
		t.Fatalf("dead links = %v, want %v", inv.DeadLinks, want)
	}
	if inv.Index.Lines != 4 || inv.Index.Bytes != len(inventoryTestIndex) || !inv.Index.Exists {
		t.Fatalf("index stats = %+v, want 4 lines, %d bytes", inv.Index, len(inventoryTestIndex))
	}
	a := inv.Memories[0]
	if a.Description != "the a rule" || a.Frontmatter["name"] != "a" || a.Frontmatter["type"] != "feedback" {
		t.Fatalf("a frontmatter = %v, description %q", a.Frontmatter, a.Description)
	}
	if a.Body != "\nAlways do a.\n**Why:** because." {
		t.Fatalf("a body = %q", a.Body)
	}
	if inv.Memories[1].Body != "plain body, no frontmatter" || len(inv.Memories[1].Frontmatter) != 0 {
		t.Fatalf("b = %+v", inv.Memories[1])
	}
	if inv.Memories[2].Description != "quoted c" {
		t.Fatalf("c description = %q", inv.Memories[2].Description)
	}
	hash, err := HashFile(a.Path)
	if err != nil {
		t.Fatal(err)
	}
	if a.Sha256 != hash || a.Size != len(inventoryTestFiles["a.md"]) || a.Path != filepath.Join(dir, "a.md") {
		t.Fatalf("a = path %q sha %q size %d", a.Path, a.Sha256, a.Size)
	}
}

func TestInventoryCRLFAndBOM(t *testing.T) {
	lf, err := ReadInventory(inventoryTestFolder(t, func(s string) string { return s }))
	if err != nil {
		t.Fatal(err)
	}
	crlfIndex := string(utf8BOM) + strings.ReplaceAll(inventoryTestIndex, "\n", "\r\n")
	crlf, err := ReadInventory(inventoryTestFolder(t, func(s string) string {
		return string(utf8BOM) + strings.ReplaceAll(s, "\n", "\r\n")
	}))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(crlf.IndexLines, lf.IndexLines) || !reflect.DeepEqual(crlf.DeadLinks, lf.DeadLinks) {
		t.Fatalf("crlf index = %q dead %v, want %q dead %v", crlf.IndexLines, crlf.DeadLinks, lf.IndexLines, lf.DeadLinks)
	}
	if crlf.Index.Lines != lf.Index.Lines || crlf.Index.Bytes != len(crlfIndex) {
		t.Fatalf("crlf index stats = %+v, want %d lines and %d bytes", crlf.Index, lf.Index.Lines, len(crlfIndex))
	}
	if len(crlf.Memories) != len(lf.Memories) {
		t.Fatalf("crlf has %d memories, lf %d", len(crlf.Memories), len(lf.Memories))
	}
	for i, want := range lf.Memories {
		got := crlf.Memories[i]
		if got.Name != want.Name || got.IndexLine != want.IndexLine || got.Body != want.Body ||
			got.Description != want.Description || !reflect.DeepEqual(got.Frontmatter, want.Frontmatter) {
			t.Fatalf("crlf memory %d = %+v, want %+v", i, got, want)
		}
	}
}

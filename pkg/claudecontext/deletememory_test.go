// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudecontext

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var deleteNow = time.Date(2026, 10, 14, 9, 30, 0, 0, time.UTC)

// a home with one project's memory folder: an index linking two memories, and both files
func memoryHome(t *testing.T) (home, dir string) {
	t.Helper()
	home = t.TempDir()
	dir = filepath.Join(home, ".claude", "projects", "-Users-me-proj", "memory")
	write(t, filepath.Join(dir, "MEMORY.md"), "- [Keep](keep.md) — stays\n- [Gone](gone_rule.md) — goes\n")
	write(t, filepath.Join(dir, "keep.md"), "---\nname: keep\n---\n\nKeep me.\n")
	write(t, filepath.Join(dir, "gone_rule.md"), "---\nname: gone-rule\n---\n\nGone.\n")
	return home, dir
}

func TestDeleteMemoryMovesTheFileToTheTrashAndDropsItsIndexLine(t *testing.T) {
	home, dir := memoryHome(t)
	trash := filepath.Join(home, ".arc", "trash")
	path := filepath.Join(dir, "gone_rule.md")

	entry, err := DeleteMemory(path, home, trash, deleteNow)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(trash, "1791970200000-memory-gone_rule"); entry != want {
		t.Errorf("entry = %s, want %s", entry, want)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the memory is still in its folder: %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(entry, "gone_rule.md")); err != nil || string(got) != "---\nname: gone-rule\n---\n\nGone.\n" {
		t.Errorf("trashed file = %q, %v", got, err)
	}
	var meta trashMeta
	raw, _ := os.ReadFile(filepath.Join(entry, "meta.json"))
	if err := json.Unmarshal(raw, &meta); err != nil || meta.OriginalPath != path || meta.DeletedAt != "2026-10-14T09:30:00Z" {
		t.Errorf("meta = %+v, %v", meta, err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "MEMORY.md")); string(got) != "- [Keep](keep.md) — stays\n" {
		t.Errorf("MEMORY.md = %q", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "keep.md")); err != nil {
		t.Errorf("the other memory went too: %v", err)
	}
}

func TestDeleteMemoryWithNoIndexLineLeavesTheIndexAlone(t *testing.T) {
	home, dir := memoryHome(t)
	write(t, filepath.Join(dir, "unlisted.md"), "Not in the index.\n")
	before, _ := os.ReadFile(filepath.Join(dir, "MEMORY.md"))
	if _, err := DeleteMemory(filepath.Join(dir, "unlisted.md"), home, filepath.Join(home, "trash"), deleteNow); err != nil {
		t.Fatal(err)
	}
	if after, _ := os.ReadFile(filepath.Join(dir, "MEMORY.md")); string(after) != string(before) {
		t.Errorf("MEMORY.md changed: %q", after)
	}
}

func TestDeleteMemoryRefusesAnythingButAProjectMemoryFile(t *testing.T) {
	home, dir := memoryHome(t)
	write(t, filepath.Join(home, ".claude", "CLAUDE.md"), "global\n")
	write(t, filepath.Join(home, ".claude", "projects", "-Users-me-proj", "notes.md"), "beside the memory folder\n")
	write(t, filepath.Join(dir, "sub", "deep.md"), "a folder down\n")
	write(t, filepath.Join(dir, "data.json"), "{}\n")
	cases := map[string]string{
		"the index":             filepath.Join(dir, "MEMORY.md"),
		"a global file":         filepath.Join(home, ".claude", "CLAUDE.md"),
		"outside memory/":       filepath.Join(home, ".claude", "projects", "-Users-me-proj", "notes.md"),
		"a folder down":         filepath.Join(dir, "sub", "deep.md"),
		"not markdown":          filepath.Join(dir, "data.json"),
		"a dot-dot segment":     dir + "/../memory/keep.md",
		"a relative path":       filepath.Join(".claude", "projects", "-Users-me-proj", "memory", "keep.md"),
		"another home's memory": filepath.Join(t.TempDir(), ".claude", "projects", "p", "memory", "x.md"),
	}
	trash := filepath.Join(home, "trash")
	for name, path := range cases {
		if _, err := DeleteMemory(path, home, trash, deleteNow); !errors.Is(err, ErrNotMemory) {
			t.Errorf("%s: err = %v, want ErrNotMemory", name, err)
		}
	}
	if _, err := os.Stat(trash); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("a refused delete made the trash: %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "MEMORY.md")); string(got) != "- [Keep](keep.md) — stays\n- [Gone](gone_rule.md) — goes\n" {
		t.Errorf("MEMORY.md changed: %q", got)
	}
}

func TestDeleteMemoryRefusesASymlink(t *testing.T) {
	home, dir := memoryHome(t)
	outside := filepath.Join(t.TempDir(), "elsewhere.md")
	write(t, outside, "not a memory\n")
	link := filepath.Join(dir, "link.md")
	if err := os.Symlink(outside, link); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	if _, err := DeleteMemory(link, home, filepath.Join(home, "trash"), deleteNow); !errors.Is(err, ErrNotMemory) {
		t.Errorf("err = %v, want ErrNotMemory", err)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Errorf("the link's target went: %v", err)
	}
}

func TestDeleteMemoryOfAMissingFileFails(t *testing.T) {
	home, dir := memoryHome(t)
	if _, err := DeleteMemory(filepath.Join(dir, "never.md"), home, filepath.Join(home, "trash"), deleteNow); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("err = %v, want not exist", err)
	}
}

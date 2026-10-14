// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// splitTestMemory writes a memory file into folder and returns it as the inventory has it.
func splitTestMemory(t *testing.T, folder, name, indexLine string) Memory {
	t.Helper()
	path := filepath.Join(folder, name)
	body := "about " + name + "\n"
	writeFile(t, path, body)
	hash, err := HashFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return Memory{Name: name, Path: path, Sha256: hash, Size: len(body), Description: "desc of " + name, IndexLine: indexLine}
}

func splitTestFolders(t *testing.T) (shared, own string) {
	root := t.TempDir()
	return filepath.Join(root, "shared", "memory"), filepath.Join(root, "own", "memory")
}

// splitTestShared returns the changes in group shared, failing unless exactly want of them exist.
func splitTestShared(t *testing.T, changes []wshrpc.MemChange, want int) []wshrpc.MemChange {
	t.Helper()
	var out []wshrpc.MemChange
	for _, c := range changes {
		if c.Group == "shared" {
			out = append(out, c)
		}
	}
	if len(out) != want {
		t.Fatalf("want %d shared changes, got %d: %+v", want, len(out), out)
	}
	return out
}

func TestSplitOneProjectGivesMove(t *testing.T) {
	sharedDir, ownDir := splitTestFolders(t)
	line := "- [HK probe](hk.md) — turn latency"
	m := splitTestMemory(t, sharedDir, "hk.md", line)
	other := splitTestMemory(t, sharedDir, "det.md", "- [Det](det.md)")
	shared := &Inventory{Folder: sharedDir, Memories: []Memory{m, other}}
	sorted := map[string][]string{"hk.md": {"ca"}, "det.md": {"detector"}}

	changes := SplitChanges("ca", shared, nil, sorted, ownDir, filepath.Join(t.TempDir(), "settings.local.json"))
	c := splitTestShared(t, changes, 1)[0]

	if c.Kind != "move-here" || c.ApplyLabel != "Move here" || c.Status != "open" {
		t.Fatalf("kind/label/status = %q/%q/%q", c.Kind, c.ApplyLabel, c.Status)
	}
	wantFiles := []wshrpc.MemFileRef{{Path: m.Path, Sha256: m.Sha256}, {Path: filepath.Join(ownDir, "hk.md")}}
	if !reflect.DeepEqual(c.Files, wantFiles) {
		t.Fatalf("files = %+v, want %+v", c.Files, wantFiles)
	}
	if c.Id != ChangeID("move-here", wantFiles) {
		t.Fatalf("id is not ChangeID over its files")
	}
	wantOp := wshrpc.MemOp{Folder: sharedDir, Memories: []string{"hk.md"}, ToFolder: ownDir,
		IndexRemove: []string{line}, IndexAdd: line, IndexFolder: ownDir}
	if !reflect.DeepEqual(c.Op, wantOp) {
		t.Fatalf("op = %+v, want %+v", c.Op, wantOp)
	}
	lineBytes := len(line) + 1
	if c.IndexDelta != (wshrpc.MemIndexDelta{Lines: -1, Bytes: -lineBytes}) || c.OwnIndexDelta != (wshrpc.MemIndexDelta{Lines: 1, Bytes: lineBytes}) {
		t.Fatalf("deltas = %+v / %+v", c.IndexDelta, c.OwnIndexDelta)
	}
}

func TestSplitSeveralGivesCopy(t *testing.T) {
	sharedDir, ownDir := splitTestFolders(t)
	line := "- [Branches](br.md) — never checkout the shared tree"
	m := splitTestMemory(t, sharedDir, "br.md", line)
	shared := &Inventory{Folder: sharedDir, Memories: []Memory{m}}
	sorted := map[string][]string{"br.md": {"ca", "detector", "other"}}

	c := splitTestShared(t, SplitChanges("ca", shared, nil, sorted, ownDir, filepath.Join(t.TempDir(), "s.json")), 1)[0]

	if c.Kind != "copy-here" || c.ApplyLabel != "Copy here" {
		t.Fatalf("kind/label = %q/%q", c.Kind, c.ApplyLabel)
	}
	if len(c.Op.IndexRemove) != 0 || c.Op.IndexAdd != line || c.Op.ToFolder != ownDir {
		t.Fatalf("copy must keep the shared line and add it to the own index: %+v", c.Op)
	}
	if c.IndexDelta != (wshrpc.MemIndexDelta{}) || c.OwnIndexDelta.Lines != 1 {
		t.Fatalf("deltas = %+v / %+v", c.IndexDelta, c.OwnIndexDelta)
	}
	wantFiles := []wshrpc.MemFileRef{{Path: m.Path, Sha256: m.Sha256}, {Path: filepath.Join(ownDir, "br.md")}}
	if !reflect.DeepEqual(c.Files, wantFiles) {
		t.Fatalf("files = %+v", c.Files)
	}

	// already in the own folder with the same content: nothing to copy
	ownM := splitTestMemory(t, ownDir, "br.md", line)
	own := &Inventory{Folder: ownDir, Memories: []Memory{ownM}}
	splitTestShared(t, SplitChanges("ca", shared, own, sorted, ownDir, filepath.Join(t.TempDir(), "s.json")), 0)
}

func TestSplitLinkedFilesGrouped(t *testing.T) {
	sharedDir, ownDir := splitTestFolders(t)
	hub := "- [Gaps](hub.md), [g1](g1.md), [g2](g2.md)"
	mems := []Memory{
		splitTestMemory(t, sharedDir, "hub.md", hub),
		splitTestMemory(t, sharedDir, "g1.md", hub),
		splitTestMemory(t, sharedDir, "g2.md", hub),
	}
	shared := &Inventory{Folder: sharedDir, Memories: mems}
	sorted := map[string][]string{"hub.md": {"ca"}, "g1.md": {"ca"}, "g2.md": {"ca"}}

	c := splitTestShared(t, SplitChanges("ca", shared, nil, sorted, ownDir, filepath.Join(t.TempDir(), "s.json")), 1)[0]

	if !reflect.DeepEqual(c.Op.Memories, []string{"hub.md", "g1.md", "g2.md"}) {
		t.Fatalf("memories = %v", c.Op.Memories)
	}
	if len(c.Files) != 6 || !reflect.DeepEqual(c.Op.IndexRemove, []string{hub}) || c.Op.IndexAdd != hub {
		t.Fatalf("one change must move all three files and the one line: %+v", c)
	}
	if c.Effect != "3 files · "+splitFormatSize(mems[0].Size+mems[1].Size+mems[2].Size) {
		t.Fatalf("effect = %q", c.Effect)
	}

	// one member also applies elsewhere: the group copies as a whole rather than half-moving
	sorted["g2.md"] = []string{"ca", "detector"}
	c = splitTestShared(t, SplitChanges("ca", shared, nil, sorted, ownDir, filepath.Join(t.TempDir(), "s.json")), 1)[0]
	if c.Kind != "copy-here" || len(c.Op.Memories) != 3 {
		t.Fatalf("kind = %q memories = %v", c.Kind, c.Op.Memories)
	}

	// a member the sort missed: moving the line would strand it, so the group waits
	delete(sorted, "g1.md")
	splitTestShared(t, SplitChanges("ca", shared, nil, sorted, ownDir, filepath.Join(t.TempDir(), "s.json")), 0)
}

func TestSplitSettingsChange(t *testing.T) {
	sharedDir, ownDir := splitTestFolders(t)
	settings := filepath.Join(t.TempDir(), ".claude", "settings.local.json")
	writeFile(t, settings, "{\n  \"permissions\": {}\n}\n")
	hash, err := HashFile(settings)
	if err != nil {
		t.Fatal(err)
	}

	changes := SplitChanges("ca", &Inventory{Folder: sharedDir}, nil, map[string][]string{}, ownDir, settings)

	if len(changes) != 1 {
		t.Fatalf("want only the settings change, got %+v", changes)
	}
	c := changes[0]
	if c.Kind != "settings" || c.Group != "switch" || c.ApplyLabel != "Switch memory" {
		t.Fatalf("kind/group/label = %q/%q/%q", c.Kind, c.Group, c.ApplyLabel)
	}
	if c.Op.SettingsPath != settings || c.Op.SettingsValue != ownDir {
		t.Fatalf("op = %+v", c.Op)
	}
	wantFiles := []wshrpc.MemFileRef{{Path: settings, Sha256: hash}}
	if !reflect.DeepEqual(c.Files, wantFiles) || c.Id != ChangeID("settings", wantFiles) {
		t.Fatalf("files = %+v id = %s", c.Files, c.Id)
	}
}

func TestRemoveSharedPerMemory(t *testing.T) {
	sharedDir, _ := splitTestFolders(t)
	a := splitTestMemory(t, sharedDir, "a.md", "- [A](a.md)")
	b := splitTestMemory(t, sharedDir, "b.md", "- [B](b.md)")
	shared := &Inventory{Folder: sharedDir, Memories: []Memory{a, b}}
	sorted := map[string][]string{"a.md": {"x", "y"}, "b.md": {"x", "z"}}
	switchedAt := map[string]int64{"x": 100, "y": 200}
	stillLoading := []string{"z"}

	underY := RemoveShared("y", shared, sorted, stillLoading, switchedAt)
	if len(underY) != 1 || underY[0].Kind != "remove-shared" || !reflect.DeepEqual(underY[0].Op.Memories, []string{"a.md"}) {
		t.Fatalf("y switched last for a.md, so its removal lists under y: %+v", underY)
	}
	c := underY[0]
	if !reflect.DeepEqual(c.Op.IndexRemove, []string{"- [A](a.md)"}) || c.Op.Folder != sharedDir || c.IndexDelta.Lines != -1 {
		t.Fatalf("op/delta = %+v / %+v", c.Op, c.IndexDelta)
	}
	wantFiles := []wshrpc.MemFileRef{{Path: a.Path, Sha256: a.Sha256}}
	if !reflect.DeepEqual(c.Files, wantFiles) || c.Id != ChangeID("remove-shared", wantFiles) {
		t.Fatalf("files = %+v", c.Files)
	}
	if got := RemoveShared("x", shared, sorted, stillLoading, switchedAt); len(got) != 0 {
		t.Fatalf("x didn't switch last for a.md, and z still loads b.md: %+v", got)
	}
}

func TestRemoveSharedSkipsOther(t *testing.T) {
	sharedDir, _ := splitTestFolders(t)
	a := splitTestMemory(t, sharedDir, "a.md", "- [A](a.md)")
	shared := &Inventory{Folder: sharedDir, Memories: []Memory{a}}
	switchedAt := map[string]int64{"x": 100}

	if got := RemoveShared("x", shared, map[string][]string{"a.md": {"x", "other"}}, nil, switchedAt); len(got) != 0 {
		t.Fatalf("a memory about an unregistered part of the repo stays shared: %+v", got)
	}
	if got := RemoveShared("x", shared, map[string][]string{"a.md": {"x"}}, nil, switchedAt); len(got) != 1 {
		t.Fatalf("without other it is removed: %+v", got)
	}
}

func TestOpenSharedChanges(t *testing.T) {
	changes := []wshrpc.MemChange{
		{Group: "shared", Status: "open"},
		{Group: "shared", Status: "conflict"},
		{Group: "shared", Status: "applied"},
		{Group: "shared", Status: "kept"},
		{Group: "own", Status: "open"},
		{Group: "switch", Status: "open"},
	}
	if got := OpenSharedChanges(changes); got != 2 {
		t.Fatalf("OpenSharedChanges = %d, want 2", got)
	}
	if got := OpenSharedChanges(changes[2:]); got != 0 {
		t.Fatalf("all shared reviewed: OpenSharedChanges = %d, want 0", got)
	}
}

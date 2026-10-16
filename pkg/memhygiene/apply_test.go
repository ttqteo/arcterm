// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var applyTestNow = time.Date(2026, 10, 14, 9, 12, 0, 0, time.UTC)

// applyTestChange builds a change whose Files carry the paths' hashes now, as a check would.
func applyTestChange(t *testing.T, kind string, op wshrpc.MemOp, paths ...string) wshrpc.MemChange {
	t.Helper()
	change := wshrpc.MemChange{Kind: kind, Title: kind + " test", Op: op}
	for _, path := range paths {
		hash, err := HashFile(path)
		if err != nil {
			t.Fatal(err)
		}
		change.Files = append(change.Files, wshrpc.MemFileRef{Path: path, Sha256: hash})
	}
	return change
}

func applyTestRun(t *testing.T, change wshrpc.MemChange, backupRoot string) string {
	t.Helper()
	id, conflict, err := Apply(change, backupRoot, applyTestNow)
	if err != nil || conflict != "" || id == "" {
		t.Fatalf("Apply = %q, conflict %q, %v", id, conflict, err)
	}
	return id
}

// applyTestExpect asserts each file's exact bytes; "" means the file must not exist.
func applyTestExpect(t *testing.T, want map[string]string) {
	t.Helper()
	for path, content := range want {
		data, err := os.ReadFile(path)
		if content == "" {
			if !errors.Is(err, fs.ErrNotExist) {
				t.Errorf("%s exists, want it gone", path)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: %v", path, err)
			continue
		}
		if string(data) != content {
			t.Errorf("%s:\n got %q\nwant %q", path, data, content)
		}
	}
}

func applyTestFolder(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "memory")
	for name, content := range files {
		writeFile(t, filepath.Join(dir, name), content)
	}
	return dir
}

func TestApplyDelete(t *testing.T) {
	dir := applyTestFolder(t, map[string]string{
		"MEMORY.md": "# Memory\n- [A](a.md) — a\n- [B](b.md) — b\n",
		"a.md":      "a body\n",
		"b.md":      "b body\n",
	})
	idx, a, b := filepath.Join(dir, "MEMORY.md"), filepath.Join(dir, "a.md"), filepath.Join(dir, "b.md")
	op := wshrpc.MemOp{Folder: dir, Memories: []string{"a.md"}, IndexRemove: []string{"- [A](a.md) — a"}}
	applyTestRun(t, applyTestChange(t, "delete", op, a, idx), t.TempDir())
	applyTestExpect(t, map[string]string{idx: "# Memory\n- [B](b.md) — b\n", a: "", b: "b body\n"})
}

func TestApplyTrim(t *testing.T) {
	dir := applyTestFolder(t, map[string]string{
		"MEMORY.md": "- [A](a.md) — a long hook\n- [B](b.md) — b\n",
		"a.md":      "---\nname: a\n---\nkeep this\nthe long passage\nthat goes on\nend\n",
	})
	idx, a := filepath.Join(dir, "MEMORY.md"), filepath.Join(dir, "a.md")
	op := wshrpc.MemOp{
		Folder: dir, Memories: []string{"a.md"},
		Old: "the long passage\nthat goes on\n", New: "short\n",
		IndexRemove: []string{"- [A](a.md) — a long hook"}, IndexAdd: "- [A](a.md) — hook",
	}
	applyTestRun(t, applyTestChange(t, "trim", op, a, idx), t.TempDir())
	applyTestExpect(t, map[string]string{
		a:   "---\nname: a\n---\nkeep this\nshort\nend\n",
		idx: "- [A](a.md) — hook\n- [B](b.md) — b\n",
	})
}

func TestApplyMerge(t *testing.T) {
	dir := applyTestFolder(t, map[string]string{
		"MEMORY.md": "# Memory\n- [A](a.md) — a\n- [X](x.md) — x\n- [B](b.md) — b\n",
		"a.md":      "a body\n",
		"b.md":      "b body\n",
	})
	idx, a, b := filepath.Join(dir, "MEMORY.md"), filepath.Join(dir, "a.md"), filepath.Join(dir, "b.md")
	op := wshrpc.MemOp{
		Folder: dir, Memories: []string{"a.md", "b.md"},
		WriteName: "a.md", WriteBody: "---\nname: ab\n---\nboth bodies",
		IndexRemove: []string{"- [A](a.md) — a", "- [B](b.md) — b"}, IndexAdd: "- [AB](a.md) — a and b",
	}
	applyTestRun(t, applyTestChange(t, "merge", op, a, b, idx), t.TempDir())
	applyTestExpect(t, map[string]string{
		a:   "---\nname: ab\n---\nboth bodies\n",
		b:   "",
		idx: "# Memory\n- [AB](a.md) — a and b\n- [X](x.md) — x\n",
	})
}

func TestApplyMoveToDoc(t *testing.T) {
	repo := initRepo(t)
	doc := filepath.Join(repo, "CLAUDE.md")
	commit(t, repo, "docs", map[string]string{"CLAUDE.md": "# Proj\n\n## Rules\n\n- one\n- two\n\n## Other\n\n```\n## Rules\n```\n"})
	dir := applyTestFolder(t, map[string]string{
		"MEMORY.md": "- [R](r.md) — rule three\n- [S](s.md) — s\n",
		"r.md":      "rule three\n",
	})
	idx, r := filepath.Join(dir, "MEMORY.md"), filepath.Join(dir, "r.md")
	op := wshrpc.MemOp{
		Folder: dir, Memories: []string{"r.md"}, IndexRemove: []string{"- [R](r.md) — rule three"},
		DocPath: doc, DocSection: "## Rules", DocPassage: "- three\n",
	}
	applyTestRun(t, applyTestChange(t, "move-to-doc", op, doc, r, idx), t.TempDir())
	applyTestExpect(t, map[string]string{
		doc: "# Proj\n\n## Rules\n\n- one\n- two\n- three\n\n## Other\n\n```\n## Rules\n```\n",
		r:   "",
		idx: "- [S](s.md) — s\n",
	})
	status, err := runGit(repo, "status", "--porcelain", "--", "CLAUDE.md")
	if err != nil {
		t.Fatal(err)
	}
	if status != "M CLAUDE.md" {
		t.Errorf("git status = %q, want the edit left uncommitted", status)
	}
}

func TestApplyAddToIndex(t *testing.T) {
	dir := applyTestFolder(t, map[string]string{
		"h.md": "---\nname: h\nsource: vault/h.md\nsource_hash: abc123\nharvested_at: 2026-07-21\ndescription: d\n---\nsource: stays in the body\n",
	})
	idx, h := filepath.Join(dir, "MEMORY.md"), filepath.Join(dir, "h.md")
	op := wshrpc.MemOp{Folder: dir, Memories: []string{"h.md"}, IndexAdd: "- [H](h.md) — d", StripHarvester: true}
	applyTestRun(t, applyTestChange(t, "add-to-index", op, h, idx), t.TempDir())
	applyTestExpect(t, map[string]string{
		idx: "- [H](h.md) — d\n",
		h:   "---\nname: h\ndescription: d\n---\nsource: stays in the body\n",
	})

	// an existing index gets the line after its last entry, before trailing blank lines
	writeFile(t, idx, "# Memory\n- [H](h.md) — d\n\n")
	writeFile(t, filepath.Join(dir, "g.md"), "g\n")
	op = wshrpc.MemOp{Folder: dir, Memories: []string{"g.md"}, IndexAdd: "- [G](g.md) — g"}
	applyTestRun(t, applyTestChange(t, "add-to-index", op, filepath.Join(dir, "g.md"), idx), t.TempDir())
	applyTestExpect(t, map[string]string{idx: "# Memory\n- [H](h.md) — d\n- [G](g.md) — g\n\n", filepath.Join(dir, "g.md"): "g\n"})
}

// applyTestSplit is a shared folder with a hub memory linking two files, and an own folder.
func applyTestSplit(t *testing.T) (shared, own string, op wshrpc.MemOp, paths []string) {
	t.Helper()
	shared = applyTestFolder(t, map[string]string{
		"MEMORY.md": "- [Hub](hub.md) — see [Leaf](leaf.md)\n- [N](n.md) — n\n",
		"hub.md":    "hub\n",
		"leaf.md":   "leaf\r\n",
	})
	own = filepath.Join(t.TempDir(), "own")
	op = wshrpc.MemOp{
		Folder: shared, Memories: []string{"hub.md", "leaf.md"}, ToFolder: own, IndexFolder: own,
		IndexAdd: "- [Hub](hub.md) — see [Leaf](leaf.md)",
	}
	paths = []string{filepath.Join(shared, "hub.md"), filepath.Join(shared, "leaf.md"), filepath.Join(shared, "MEMORY.md"),
		filepath.Join(own, "hub.md"), filepath.Join(own, "leaf.md"), filepath.Join(own, "MEMORY.md")}
	return shared, own, op, paths
}

func TestApplyMoveHere(t *testing.T) {
	shared, own, op, paths := applyTestSplit(t)
	op.IndexRemove = []string{op.IndexAdd}
	applyTestRun(t, applyTestChange(t, "move-here", op, paths...), t.TempDir())
	applyTestExpect(t, map[string]string{
		filepath.Join(shared, "hub.md"):    "",
		filepath.Join(shared, "leaf.md"):   "",
		filepath.Join(shared, "MEMORY.md"): "- [N](n.md) — n\n",
		filepath.Join(own, "hub.md"):       "hub\n",
		filepath.Join(own, "leaf.md"):      "leaf\r\n",
		filepath.Join(own, "MEMORY.md"):    "- [Hub](hub.md) — see [Leaf](leaf.md)\n",
	})
}

func TestApplyCopyHere(t *testing.T) {
	shared, own, op, paths := applyTestSplit(t)
	applyTestRun(t, applyTestChange(t, "copy-here", op, paths...), t.TempDir())
	applyTestExpect(t, map[string]string{
		filepath.Join(shared, "hub.md"):    "hub\n",
		filepath.Join(shared, "leaf.md"):   "leaf\r\n",
		filepath.Join(shared, "MEMORY.md"): "- [Hub](hub.md) — see [Leaf](leaf.md)\n- [N](n.md) — n\n",
		filepath.Join(own, "hub.md"):       "hub\n",
		filepath.Join(own, "leaf.md"):      "leaf\r\n",
		filepath.Join(own, "MEMORY.md"):    "- [Hub](hub.md) — see [Leaf](leaf.md)\n",
	})
}

func TestApplyRemoveShared(t *testing.T) {
	shared, _, op, paths := applyTestSplit(t)
	op = wshrpc.MemOp{Folder: shared, Memories: op.Memories, IndexRemove: []string{op.IndexAdd}}
	applyTestRun(t, applyTestChange(t, "remove-shared", op, paths[:3]...), t.TempDir())
	applyTestExpect(t, map[string]string{
		filepath.Join(shared, "hub.md"):    "",
		filepath.Join(shared, "leaf.md"):   "",
		filepath.Join(shared, "MEMORY.md"): "- [N](n.md) — n\n",
	})
}

func TestApplySettings(t *testing.T) {
	repo := initRepo(t)
	path := filepath.Join(repo, ".claude", "settings.local.json")
	op := wshrpc.MemOp{SettingsPath: path, SettingsValue: "/home/dana/.claude/projects/own/memory"}
	backupRoot := t.TempDir()
	id := applyTestRun(t, applyTestChange(t, "settings", op, path), backupRoot)
	applyTestExpect(t, map[string]string{path: "{\n  \"autoMemoryDirectory\": \"/home/dana/.claude/projects/own/memory\"\n}\n"})
	if conflict, err := Undo(backupRoot, id); err != nil || conflict != "" {
		t.Fatalf("Undo = %q, %v", conflict, err)
	}
	applyTestExpect(t, map[string]string{path: ""})
}

func TestApplyPreservesCRLF(t *testing.T) {
	const bom = "\ufeff"
	dir := applyTestFolder(t, map[string]string{
		"MEMORY.md": bom + "# Memory\r\n- [A](a.md) — a long hook\r\n- [B](b.md) — b\r\n",
		"a.md":      bom + "---\r\nname: a\r\n---\r\nkeep\r\nthe long passage\r\nend\r\n",
		"c.md":      "---\r\nname: c\r\nsource: x\r\n---\r\nc\r\n",
	})
	idx, a, c := filepath.Join(dir, "MEMORY.md"), filepath.Join(dir, "a.md"), filepath.Join(dir, "c.md")
	trim := wshrpc.MemOp{
		Folder: dir, Memories: []string{"a.md"}, Old: "keep\nthe long passage\n", New: "keep\nshort\n",
		IndexRemove: []string{"- [A](a.md) — a long hook"}, IndexAdd: "- [A](a.md) — hook",
	}
	applyTestRun(t, applyTestChange(t, "trim", trim, a, idx), t.TempDir())
	add := wshrpc.MemOp{Folder: dir, Memories: []string{"c.md"}, IndexAdd: "- [C](c.md) — c", StripHarvester: true}
	applyTestRun(t, applyTestChange(t, "add-to-index", add, c, idx), t.TempDir())
	applyTestExpect(t, map[string]string{
		a:   bom + "---\r\nname: a\r\n---\r\nkeep\r\nshort\r\nend\r\n",
		c:   "---\r\nname: c\r\n---\r\nc\r\n",
		idx: bom + "# Memory\r\n- [A](a.md) — hook\r\n- [B](b.md) — b\r\n- [C](c.md) — c\r\n",
	})
}

func TestApplyConflictWritesNothing(t *testing.T) {
	files := map[string]string{"MEMORY.md": "- [A](a.md) — a\n", "a.md": "a\n"}
	dir := applyTestFolder(t, files)
	idx, a := filepath.Join(dir, "MEMORY.md"), filepath.Join(dir, "a.md")
	op := wshrpc.MemOp{Folder: dir, Memories: []string{"a.md"}, IndexRemove: []string{"- [A](a.md) — a"}}
	backupRoot := filepath.Join(t.TempDir(), "backups")

	edited := applyTestChange(t, "delete", op, a, idx)
	writeFile(t, a, "a, edited since the check\n")
	created := applyTestChange(t, "delete", op, a, idx, filepath.Join(dir, "new.md"))
	writeFile(t, filepath.Join(dir, "new.md"), "appeared since the check\n")

	for _, tc := range []struct {
		change wshrpc.MemChange
		want   string
	}{{edited, a}, {created, filepath.Join(dir, "new.md")}} {
		id, conflict, err := Apply(tc.change, backupRoot, applyTestNow)
		if err != nil || id != "" || conflict != tc.want {
			t.Errorf("Apply = %q, conflict %q, %v; want conflict %s", id, conflict, err, tc.want)
		}
	}
	applyTestExpect(t, map[string]string{a: "a, edited since the check\n", idx: files["MEMORY.md"]})
	if _, err := os.Stat(backupRoot); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a conflicting apply wrote a backup: %v", err)
	}
}

func applyTestSnapshot(t *testing.T, paths []string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			t.Fatal(err)
		}
		out[path] = string(data)
	}
	return out
}

func TestUndoRestores(t *testing.T) {
	_, own, op, paths := applyTestSplit(t)
	op.IndexRemove = []string{op.IndexAdd}
	writeFile(t, filepath.Join(own, "MEMORY.md"), string(utf8BOM)+"# Own\r\n")
	before := applyTestSnapshot(t, paths)
	backupRoot := t.TempDir()
	id := applyTestRun(t, applyTestChange(t, "move-here", op, paths...), backupRoot)
	if after := applyTestSnapshot(t, paths); after[paths[0]] != "" || after[paths[3]] != "hub\n" {
		t.Fatalf("the move didn't happen: %q", after)
	}
	if conflict, err := Undo(backupRoot, id); err != nil || conflict != "" {
		t.Fatalf("Undo = %q, %v", conflict, err)
	}
	applyTestExpect(t, before)
}

func TestUndoConflictWritesNothing(t *testing.T) {
	dir := applyTestFolder(t, map[string]string{"MEMORY.md": "- [A](a.md) — a\n- [B](b.md) — b\n", "a.md": "a\n"})
	idx, a := filepath.Join(dir, "MEMORY.md"), filepath.Join(dir, "a.md")
	op := wshrpc.MemOp{Folder: dir, Memories: []string{"a.md"}, IndexRemove: []string{"- [A](a.md) — a"}}
	backupRoot := t.TempDir()
	id := applyTestRun(t, applyTestChange(t, "delete", op, a, idx), backupRoot)

	// the line the undo would put back is there again
	writeFile(t, idx, "- [B](b.md) — b\n- [A](a.md) — a\n")
	if conflict, err := Undo(backupRoot, id); err != nil || conflict != idx {
		t.Errorf("Undo = %q, %v; want conflict %s", conflict, err, idx)
	}
	applyTestExpect(t, map[string]string{a: "", idx: "- [B](b.md) — b\n- [A](a.md) — a\n"})

	// a file the apply deleted must still be absent
	writeFile(t, idx, "- [B](b.md) — b\n")
	writeFile(t, a, "a, written again\n")
	if conflict, err := Undo(backupRoot, id); err != nil || conflict != a {
		t.Errorf("Undo = %q, %v; want conflict %s", conflict, err, a)
	}
	applyTestExpect(t, map[string]string{a: "a, written again\n", idx: "- [B](b.md) — b\n"})
}

func TestPruneBackupsAfter30Days(t *testing.T) {
	const keep = 30 * 24 * time.Hour
	dir := applyTestFolder(t, map[string]string{"a.md": "a\n", "b.md": "b\n"})
	backupRoot := t.TempDir()
	var ids []string
	for i, age := range []time.Duration{31 * 24 * time.Hour, 29 * 24 * time.Hour} {
		name := []string{"a.md", "b.md"}[i]
		change := applyTestChange(t, "delete", wshrpc.MemOp{Folder: dir, Memories: []string{name}}, filepath.Join(dir, name))
		id, conflict, err := Apply(change, backupRoot, applyTestNow.Add(-age))
		if err != nil || conflict != "" {
			t.Fatalf("Apply = %q, %v", conflict, err)
		}
		ids = append(ids, id)
	}
	if err := PruneBackups(backupRoot, applyTestNow, keep); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(backupRoot)
	if err != nil {
		t.Fatal(err)
	}
	var left []string
	for _, e := range entries {
		left = append(left, e.Name())
	}
	if strings.Join(left, ",") != ids[1] {
		t.Errorf("backups left = %v, want only the 29-day-old %s", left, ids[1])
	}
	if err := PruneBackups(filepath.Join(backupRoot, "missing"), applyTestNow, keep); err != nil {
		t.Errorf("pruning a missing backup root: %v", err)
	}
}

func TestApplyJudgeSiblingsNoConflict(t *testing.T) {
	inv := judgeTestInventory(t)
	reply := `{"changes": [
		{"kind": "delete", "title": "Stale alpha", "files": ["alpha.md"]},
		{"kind": "trim", "title": "Shorter beta", "files": ["beta.md"], "old": "the same thing", "new": "one thing", "index_line": "- [Beta rule](beta.md) — one thing"}
	]}`
	changes, err := ParseJudge(reply, inv, "")
	if err != nil {
		t.Fatal(err)
	}
	backupRoot := t.TempDir()
	applyTestRun(t, changes[0], backupRoot)
	id := applyTestRun(t, changes[1], backupRoot)
	applyTestExpect(t, map[string]string{
		inv.IndexPath:                         "- [Beta rule](beta.md) — one thing\n",
		filepath.Join(inv.Folder, "alpha.md"): "",
		filepath.Join(inv.Folder, "beta.md"):  "Beta says one thing.\n",
	})

	// the manifest comes from the write plan, so undo still restores the index left out of Files
	if conflict, err := Undo(backupRoot, id); err != nil || conflict != "" {
		t.Fatalf("Undo = %q, %v", conflict, err)
	}
	applyTestExpect(t, map[string]string{inv.IndexPath: judgeTestLineB + "\n", filepath.Join(inv.Folder, "beta.md"): "Beta says the same thing.\n"})
}

func TestApplyIndexLineGoneIsConflict(t *testing.T) {
	inv := judgeTestInventory(t)
	changes, err := ParseJudge(`{"changes": [{"kind": "delete", "title": "Stale alpha", "files": ["alpha.md"]}]}`, inv, "")
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, inv.IndexPath, judgeTestLineB+"\n")
	backupRoot := filepath.Join(t.TempDir(), "backups")
	id, conflict, err := Apply(changes[0], backupRoot, applyTestNow)
	if err != nil || id != "" || conflict != inv.IndexPath {
		t.Errorf("Apply = %q, conflict %q, %v; want conflict %s", id, conflict, err, inv.IndexPath)
	}
	applyTestExpect(t, map[string]string{inv.IndexPath: judgeTestLineB + "\n", filepath.Join(inv.Folder, "alpha.md"): inv.Memories[0].Body})
	if _, err := os.Stat(backupRoot); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a conflicting apply wrote a backup: %v", err)
	}
}

func TestApplyIndexLineAlreadyPresentIsConflict(t *testing.T) {
	inv := judgeTestInventory(t)
	const line = "- [Gamma](gamma.md) — gamma"
	changes, err := ParseJudge(`{"changes": [{"kind": "add-to-index", "title": "Worth loading", "files": ["gamma.md"], "index_line": "`+line+`"}]}`, inv, "")
	if err != nil {
		t.Fatal(err)
	}
	index := judgeTestLineA + "\n" + judgeTestLineB + "\n" + line + "\n"
	writeFile(t, inv.IndexPath, index)
	gamma := filepath.Join(inv.Folder, "gamma.md")
	gammaBefore := applyTestSnapshot(t, []string{gamma})[gamma]
	backupRoot := filepath.Join(t.TempDir(), "backups")
	id, conflict, err := Apply(changes[0], backupRoot, applyTestNow)
	if err != nil || id != "" || conflict != inv.IndexPath {
		t.Errorf("Apply = %q, conflict %q, %v; want conflict %s", id, conflict, err, inv.IndexPath)
	}
	applyTestExpect(t, map[string]string{inv.IndexPath: index, gamma: gammaBefore})
	if _, err := os.Stat(backupRoot); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a conflicting apply wrote a backup: %v", err)
	}
}

func TestUndoEarlierJudgeChangeAfterSibling(t *testing.T) {
	inv := judgeTestInventory(t)
	reply := `{"changes": [
		{"kind": "delete", "title": "Stale alpha", "files": ["alpha.md"]},
		{"kind": "trim", "title": "Shorter beta", "files": ["beta.md"], "old": "the same thing", "new": "one thing", "index_line": "- [Beta rule](beta.md) — one thing"}
	]}`
	changes, err := ParseJudge(reply, inv, "")
	if err != nil {
		t.Fatal(err)
	}
	backupRoot := t.TempDir()
	first := applyTestRun(t, changes[0], backupRoot)
	second := applyTestRun(t, changes[1], backupRoot)

	// the sibling rewrote MEMORY.md after the first apply; the first one's index edit still undoes
	if conflict, err := Undo(backupRoot, first); err != nil || conflict != "" {
		t.Fatalf("Undo first = %q, %v", conflict, err)
	}
	applyTestExpect(t, map[string]string{
		inv.IndexPath:                         judgeTestLineA + "\n- [Beta rule](beta.md) — one thing\n",
		filepath.Join(inv.Folder, "alpha.md"): inv.Memories[0].Body,
	})
	if conflict, err := Undo(backupRoot, second); err != nil || conflict != "" {
		t.Fatalf("Undo second = %q, %v", conflict, err)
	}
	applyTestExpect(t, map[string]string{
		inv.IndexPath:                        judgeTestLineA + "\n" + judgeTestLineB + "\n",
		filepath.Join(inv.Folder, "beta.md"): "Beta says the same thing.\n",
	})
}

func TestUndoPutsLineBackUnderItsNeighbour(t *testing.T) {
	dir := applyTestFolder(t, map[string]string{
		"MEMORY.md": "- [A](a.md) — a\n- [B](b.md) — b\n- [C](c.md) — c\n- [D](d.md) — d\n",
		"a.md":      "a\n",
		"c.md":      "c\n",
	})
	idx := filepath.Join(dir, "MEMORY.md")
	del := func(name, line string) wshrpc.MemChange {
		op := wshrpc.MemOp{Folder: dir, Memories: []string{name}, IndexRemove: []string{line}}
		return applyTestChange(t, "delete", op, filepath.Join(dir, name))
	}
	backupRoot := t.TempDir()
	c := applyTestRun(t, del("c.md", "- [C](c.md) — c"), backupRoot)
	applyTestRun(t, del("a.md", "- [A](a.md) — a"), backupRoot)

	// C's old line number is now past D; it goes back under B, the line it sat under
	if conflict, err := Undo(backupRoot, c); err != nil || conflict != "" {
		t.Fatalf("Undo = %q, %v", conflict, err)
	}
	applyTestExpect(t, map[string]string{idx: "- [B](b.md) — b\n- [C](c.md) — c\n- [D](d.md) — d\n", filepath.Join(dir, "c.md"): "c\n"})
}

func TestUndoUnderABlankLineUsesTheLineBelow(t *testing.T) {
	dir := applyTestFolder(t, map[string]string{
		"MEMORY.md": "# Memory\n\n- [A](a.md) — a\n- [B](b.md) — b\n- [C](c.md) — c\n",
		"a.md":      "a\n",
		"b.md":      "b\n",
	})
	idx := filepath.Join(dir, "MEMORY.md")
	del := func(name, line string) wshrpc.MemChange {
		op := wshrpc.MemOp{Folder: dir, Memories: []string{name}, IndexRemove: []string{line}}
		return applyTestChange(t, "delete", op, filepath.Join(dir, name))
	}
	backupRoot := t.TempDir()
	a := applyTestRun(t, del("a.md", "- [A](a.md) — a"), backupRoot)
	b := applyTestRun(t, del("b.md", "- [B](b.md) — b"), backupRoot)

	// both sat under the blank line, so the line above can't place them; A goes first, then B above C
	for _, id := range []string{a, b} {
		if conflict, err := Undo(backupRoot, id); err != nil || conflict != "" {
			t.Fatalf("Undo %s = %q, %v", id, conflict, err)
		}
	}
	applyTestExpect(t, map[string]string{idx: "# Memory\n\n- [A](a.md) — a\n- [B](b.md) — b\n- [C](c.md) — c\n"})
}

func TestUndoIndexLineGoneIsConflict(t *testing.T) {
	inv := judgeTestInventory(t)
	reply := `{"changes": [{"kind": "trim", "title": "Shorter beta", "files": ["beta.md"], "old": "the same thing", "new": "one thing", "index_line": "- [Beta rule](beta.md) — one thing"}]}`
	changes, err := ParseJudge(reply, inv, "")
	if err != nil {
		t.Fatal(err)
	}
	backupRoot := t.TempDir()
	id := applyTestRun(t, changes[0], backupRoot)

	// the line the apply added was edited by hand, so the undo can't find what to take back out
	edited := judgeTestLineA + "\n- [Beta rule](beta.md) — edited\n"
	writeFile(t, inv.IndexPath, edited)
	if conflict, err := Undo(backupRoot, id); err != nil || conflict != inv.IndexPath {
		t.Errorf("Undo = %q, %v; want conflict %s", conflict, err, inv.IndexPath)
	}
	applyTestExpect(t, map[string]string{inv.IndexPath: edited, filepath.Join(inv.Folder, "beta.md"): "Beta says one thing.\n"})
}

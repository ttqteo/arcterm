// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// evidenceTestMemory writes one memory with body into a temp folder and gathers its evidence against
// repo, with no transcripts.
func evidenceTestMemory(t *testing.T, repo, content string) Memory {
	t.Helper()
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "MEMORY.md"), "- [M](m.md) - the memory\n")
	writeFile(t, filepath.Join(folder, "m.md"), content)
	inv, err := ReadInventory(folder)
	if err != nil {
		t.Fatal(err)
	}
	if err := GatherEvidence(inv, repo, DefaultBranch(repo), nil); err != nil {
		t.Fatal(err)
	}
	return inv.Memories[0]
}

func evidenceTestFind(m Memory, tone, text, code string) bool {
	for _, e := range m.Evidence {
		if e.Tone == tone && strings.HasPrefix(e.Text, text) && e.Code == code {
			return true
		}
	}
	return false
}

func evidenceTestCount(m Memory, text string) int {
	n := 0
	for _, e := range m.Evidence {
		if strings.HasPrefix(e.Text, text) {
			n++
		}
	}
	return n
}

func evidenceTestPinNow(t *testing.T, now time.Time) {
	t.Helper()
	old := evidenceNow
	evidenceNow = func() time.Time { return now }
	t.Cleanup(func() { evidenceNow = old })
}

func TestEvidenceGonePath(t *testing.T) {
	repo := initRepo(t)
	commit(t, repo, "add", map[string]string{"pkg/old/gone.go": "package old\n", "pkg/keep.go": "package pkg\n"})
	if _, err := runGit(repo, "rm", "-q", "pkg/old/gone.go"); err != nil {
		t.Fatal(err)
	}
	commit(t, repo, "remove gone.go", nil)

	m := evidenceTestMemory(t, repo, "See `pkg/old/gone.go` and `pkg/keep.go`, not github.com/x/y.go or ~/.claude/x.md.\n")
	if !evidenceTestFind(m, "warn", "Names a file that is gone: ", "pkg/old/gone.go") {
		t.Fatalf("gone file not flagged: %+v", m.Evidence)
	}
	if n := evidenceTestCount(m, "Names a file that is gone"); n != 1 {
		t.Fatalf("%d gone files flagged, want 1: %+v", n, m.Evidence)
	}
}

func TestEvidenceLinePastEnd(t *testing.T) {
	repo := initRepo(t)
	commit(t, repo, "add", map[string]string{"src/a.go": "one\ntwo\nthree\n"})

	m := evidenceTestMemory(t, repo, "The rule is at src/a.go:2, the fix at a.go:9.\n")
	if !evidenceTestFind(m, "warn", "Names a line past the end of its file, which has 3 lines: ", "a.go:9") {
		t.Fatalf("line past end not flagged: %+v", m.Evidence)
	}
	if n := evidenceTestCount(m, "Names a line past the end"); n != 1 {
		t.Fatalf("%d lines flagged, want only a.go:9: %+v", n, m.Evidence)
	}

	ok := evidenceTestMemory(t, repo, "The rule is at src/a.go:3.\n")
	if !evidenceTestFind(ok, "ok", "What it names still exists: ", "src/a.go:3") {
		t.Fatalf("a line in range isn't reported as existing: %+v", ok.Evidence)
	}
}

func TestEvidenceCommitNotOnDefaultBranch(t *testing.T) {
	repo := initRepo(t)
	onMain := commit(t, repo, "on main", map[string]string{"a.txt": "a\n"})
	if _, err := runGit(repo, "checkout", "-q", "-b", "side"); err != nil {
		t.Fatal(err)
	}
	onSide := commit(t, repo, "on side", map[string]string{"b.txt": "b\n"})
	if _, err := runGit(repo, "checkout", "-q", "main"); err != nil {
		t.Fatal(err)
	}
	if got := DefaultBranch(repo); got != "main" {
		t.Fatalf("DefaultBranch = %q, want main", got)
	}

	m := evidenceTestMemory(t, repo, "Landed in "+onMain+"; the attempt in "+onSide+" never merged.\n")
	if !evidenceTestFind(m, "warn", "Names a commit that isn't on main: ", onSide) {
		t.Fatalf("side-branch commit not flagged: %+v", m.Evidence)
	}
	if evidenceTestFind(m, "warn", "Names a commit that isn't on main: ", onMain) {
		t.Fatalf("commit on main flagged: %+v", m.Evidence)
	}
}

func TestEvidenceHarvesterFrontmatter(t *testing.T) {
	repo := initRepo(t)
	harvested := evidenceTestMemory(t, repo, "---\nname: h\nmetadata:\n  type: reference\n  source: codex\n  source_hash: abc123\n  harvested_at: 2026-07-01\n---\nUse Postgres.\n")
	if !evidenceTestFind(harvested, "none", "Written by the old harvester on 2026-07-01, from codex", "") {
		t.Fatalf("harvester frontmatter not reported: %+v", harvested.Evidence)
	}
	written := evidenceTestMemory(t, repo, "---\nname: w\ndescription: from a session\n---\nUse Postgres.\n")
	if evidenceTestCount(written, "Written by the old harvester") != 0 {
		t.Fatalf("a session-written memory reported as harvested: %+v", written.Evidence)
	}
}

func TestEvidenceDatedClaims(t *testing.T) {
	evidenceTestPinNow(t, time.Date(2026, 10, 14, 12, 0, 0, 0, time.Local))
	repo := initRepo(t)
	m := evidenceTestMemory(t, repo, "Verified 2026-07-24 on the box. Since 07-21 it holds; last seen Oct 12.\n"+
		"Not dates: commit 64bc188f, claude 2.1.296, build 1.10-12, id 2026abc10, range 3-10-12.\n")
	for _, want := range []string{
		"Dated claim: verified 2026-07-24, 82 days ago",
		"Dated claim: since 07-21, 85 days ago",
		"Dated claim: seen Oct 12, 2 days ago",
	} {
		if !evidenceTestFind(m, "none", want, "") {
			t.Errorf("missing %q in %+v", want, m.Evidence)
		}
	}
	if n := evidenceTestCount(m, "Dated claim"); n != 3 {
		t.Fatalf("%d dated claims, want 3: %+v", n, m.Evidence)
	}
}

func evidenceTestTranscript(t *testing.T, path string, lines ...any) {
	t.Helper()
	var b strings.Builder
	for _, l := range lines {
		data, err := json.Marshal(l)
		if err != nil {
			t.Fatal(err)
		}
		b.Write(data)
		b.WriteByte('\n')
	}
	writeFile(t, path, b.String())
}

func evidenceTestLine(ts string, content ...map[string]any) map[string]any {
	return map[string]any{"type": "assistant", "timestamp": ts, "message": map[string]any{"role": "assistant", "content": content}}
}

func evidenceTestRead(path string) map[string]any {
	return map[string]any{"type": "tool_use", "id": "t1", "name": "Read", "input": map[string]any{"file_path": path}}
}

func TestReadCountsIgnoreBareNameMatches(t *testing.T) {
	evidenceTestPinNow(t, time.Date(2026, 10, 14, 12, 0, 0, 0, time.Local))
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "MEMORY.md"), "- [A](a.md)\n- [B](b.md)\n")
	writeFile(t, filepath.Join(folder, "a.md"), "a\n")
	writeFile(t, filepath.Join(folder, "b.md"), "b\n")
	aPath := filepath.Join(folder, "a.md")
	bPath := filepath.Join(folder, "b.md")

	sessions := t.TempDir()
	worktree := t.TempDir()
	// read with forward slashes and an upper-cased path: claude code may spell it either way
	evidenceTestTranscript(t, filepath.Join(sessions, "s1.jsonl"),
		evidenceTestLine("2026-10-12T09:00:00Z", evidenceTestRead(strings.ToUpper(filepath.ToSlash(aPath)))))
	// a name in text, a Bash cat of the file, and a Read of another file count for nothing
	evidenceTestTranscript(t, filepath.Join(sessions, "s2.jsonl"),
		map[string]any{"type": "user", "timestamp": "2026-10-13T08:00:00Z", "message": map[string]any{"role": "user", "content": "please \"Read\" " + bPath}},
		evidenceTestLine("2026-10-13T08:01:00Z",
			map[string]any{"type": "text", "text": "I will \"Read\" " + bPath},
			map[string]any{"type": "tool_use", "id": "t2", "name": "Bash", "input": map[string]any{"command": "cat " + bPath}},
			evidenceTestRead(filepath.Join(folder, "other.md"))))
	// two reads in one session count once, the later one is the last read
	evidenceTestTranscript(t, filepath.Join(worktree, "s3.jsonl"),
		evidenceTestLine("2026-10-13T10:00:00Z", evidenceTestRead(aPath)),
		evidenceTestLine("2026-10-13T11:00:00Z", evidenceTestRead(aPath)))
	writeFile(t, filepath.Join(sessions, "notes.txt"), "not a transcript")

	inv, err := ReadInventory(folder)
	if err != nil {
		t.Fatal(err)
	}
	if err := GatherEvidence(inv, t.TempDir(), "main", []string{sessions, worktree, filepath.Join(sessions, "missing")}); err != nil {
		t.Fatal(err)
	}
	if inv.Sessions != 3 {
		t.Fatalf("sessions = %d, want 3", inv.Sessions)
	}
	a, b := inv.Memories[0], inv.Memories[1]
	wantLast := time.Date(2026, 10, 13, 11, 0, 0, 0, time.UTC).UnixMilli()
	if a.Reads != 2 || a.LastRead != wantLast {
		t.Fatalf("a: reads %d last %d, want 2 and %d", a.Reads, a.LastRead, wantLast)
	}
	if b.Reads != 0 {
		t.Fatalf("b: reads %d, want 0 (bare name matches only)", b.Reads)
	}
	lastOn := time.UnixMilli(wantLast).Format("Jan 2")
	if !evidenceTestFind(a, "none", "Read in 2 of 3 sessions, last on "+lastOn, "") {
		t.Fatalf("a read evidence: %+v", a.Evidence)
	}
	if !evidenceTestFind(b, "none", "Read in 0 of 3 sessions", "") {
		t.Fatalf("b read evidence: %+v", b.Evidence)
	}
}

func TestEvidenceUnlinkedAndDeadLink(t *testing.T) {
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "MEMORY.md"), "- [Hub](hub.md) links [Gone](gone.md)\n")
	writeFile(t, filepath.Join(folder, "hub.md"), "hub\n")
	writeFile(t, filepath.Join(folder, "loose.md"), "loose\n")
	inv, err := ReadInventory(folder)
	if err != nil {
		t.Fatal(err)
	}
	if err := GatherEvidence(inv, t.TempDir(), "main", nil); err != nil {
		t.Fatal(err)
	}
	if !evidenceTestFind(inv.Memories[0], "warn", "Its index line also links a file that is gone: ", "gone.md") {
		t.Fatalf("hub: %+v", inv.Memories[0].Evidence)
	}
	if !evidenceTestFind(inv.Memories[1], "warn", "Not in the index, so no session loads it", "") {
		t.Fatalf("loose: %+v", inv.Memories[1].Evidence)
	}
}

func TestEvidenceInstructionDocs(t *testing.T) {
	project, home := t.TempDir(), t.TempDir()
	writeFile(t, filepath.Join(project, "AGENTS.md"), string(utf8BOM)+"# Agents\r\nrule\r\n")
	writeFile(t, filepath.Join(home, "CLAUDE.md"), "global\n")
	docs := InstructionDocs(project, home)
	want := map[string]string{
		filepath.Join(project, "AGENTS.md"): "# Agents\nrule",
		filepath.Join(home, "CLAUDE.md"):    "global",
	}
	if len(docs) != len(want) {
		t.Fatalf("docs = %v, want %v", docs, want)
	}
	for p, content := range want {
		if docs[p] != content {
			t.Fatalf("docs[%s] = %q, want %q", p, docs[p], content)
		}
	}
	if _, err := os.Stat(filepath.Join(project, "CLAUDE.md")); err == nil {
		t.Fatal("test setup: project has a CLAUDE.md")
	}
}

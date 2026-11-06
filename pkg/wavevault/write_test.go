// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeVaultWithDossier(t *testing.T) (*Vault, string) {
	t.Helper()
	v, err := openVaultAt(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	content := "---\nid: t-1\nstatus: draft\ntitle: Keep This\n---\n\n" +
		"Human prose.\n\n<!-- jarvis:begin state -->\nold\n<!-- jarvis:end state -->\n"
	p := filepath.Join(v.Root, "tasks/active/t-1.md")
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return v, p
}

var wspec = RegionSpec{MachineKeys: []string{"status"}, Blocks: []string{"state"}}

func TestWriteSplicesMachineRegionsOnly(t *testing.T) {
	v, p := writeVaultWithDossier(t)
	base := ContentHash(mustRead(t, p))
	res, err := v.Write("t-1", wspec, []RegionEdit{
		{Kind: FrontmatterKey, Name: "status", Value: "active"},
		{Kind: Block, Name: "state", Value: "new state"},
	}, base)
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if res.Conflict {
		t.Fatal("no concurrent edit — Conflict must be false")
	}
	got := string(mustRead(t, p))
	if !contains(got, "status: active") || !contains(got, "new state") {
		t.Fatalf("machine regions not written:\n%s", got)
	}
	if !contains(got, "title: Keep This") || !contains(got, "Human prose.") {
		t.Fatalf("human regions altered:\n%s", got)
	}
	if res.Hash != ContentHash([]byte(got)) {
		t.Fatal("WriteResult.Hash must equal the new content hash")
	}
}

func TestWriteRejectsNonMachineEdit(t *testing.T) {
	v, _ := writeVaultWithDossier(t)
	base := ContentHash(mustRead(t, filepath.Join(v.Root, "tasks/active/t-1.md")))
	_, err := v.Write("t-1", wspec, []RegionEdit{{Kind: FrontmatterKey, Name: "title", Value: "hijack"}}, base)
	if err == nil {
		t.Fatal("editing a human-owned key must be rejected")
	}
}

func TestWriteConflictWhenChangedUnderneath(t *testing.T) {
	v, p := writeVaultWithDossier(t)
	staleBase := "deadbeef" // not the real hash -> simulates an edit since the caller last read
	res, err := v.Write("t-1", wspec, []RegionEdit{{Kind: FrontmatterKey, Name: "status", Value: "active"}}, staleBase)
	if err != nil {
		t.Fatalf("conflict is not an error: %v", err)
	}
	if !res.Conflict {
		t.Fatal("a baseHash mismatch must report Conflict=true")
	}
	// nothing written — the file is untouched, human wins
	if contains(string(mustRead(t, p)), "status: active") {
		t.Fatal("a conflicting write must NOT modify the file")
	}
	if len(res.ConflictRegions) == 0 {
		t.Fatal("ConflictRegions should name the targeted machine regions")
	}
}

func TestWriteTracksMachineHash(t *testing.T) {
	v, p := writeVaultWithDossier(t)
	base := ContentHash(mustRead(t, p))
	res, err := v.Write("t-1", wspec, []RegionEdit{{Kind: FrontmatterKey, Name: "status", Value: "active"}}, base)
	if err != nil {
		t.Fatal(err)
	}
	v.mu.Lock()
	got, ok := v.machineFiles[p]
	v.mu.Unlock()
	if !ok || got != res.Hash {
		t.Fatalf("machineFiles[%s] = %q,%v; want %q", p, got, ok, res.Hash)
	}
}

func TestCreateTracksAsMachineAndCommitsAsJarvis(t *testing.T) {
	v, err := openVaultAt(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	res, err := v.Create("decisions", "d-1.md", "---\nid: d-1\n---\n\nbody\n")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	p := filepath.Join(v.Root, "decisions", "d-1.md")
	if len(mustRead(t, p)) == 0 {
		t.Fatal("Create did not write the file")
	}
	v.mu.Lock()
	h, ok := v.machineFiles[p]
	v.mu.Unlock()
	if !ok || h != res.Hash {
		t.Fatalf("machineFiles[%s]=%q,%v; want %q", p, h, ok, res.Hash)
	}
	if err := v.Commit(context.Background(), "add d-1"); err != nil {
		t.Fatal(err)
	}
	if got := lastAuthor(t, v.Root); got != "Jarvis" {
		t.Fatalf("created file author = %q, want Jarvis", got)
	}
}

func TestCreateRejectsExistingFile(t *testing.T) {
	v, err := openVaultAt(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.Create("decisions", "d-1.md", "one"); err != nil {
		t.Fatal(err)
	}
	if _, err := v.Create("decisions", "d-1.md", "two"); err == nil {
		t.Fatal("Create must reject an already-existing file")
	}
}

func TestCreateHumanCommitsAsUserNotJarvis(t *testing.T) {
	ctx := context.Background()
	v, err := openVaultAt(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	content := "---\nid: h-1\n---\n\nhuman-authored body\n"
	res, err := v.CreateHuman("decisions", "h-1.md", content)
	if err != nil {
		t.Fatalf("CreateHuman: %v", err)
	}
	p := filepath.Join(v.Root, "decisions", "h-1.md")
	if string(mustRead(t, p)) != content {
		t.Fatal("CreateHuman did not write the exact content")
	}
	if res.Hash != ContentHash([]byte(content)) {
		t.Fatal("WriteResult.Hash must equal the content hash")
	}
	// the key difference from Create: NOT tracked as machine-authored
	v.mu.Lock()
	_, tracked := v.machineFiles[p]
	v.mu.Unlock()
	if tracked {
		t.Fatal("CreateHuman must NOT record the file in machineFiles")
	}
	// so at commit time it lands in the user (add -A) commit, authored by the vault identity
	if err := v.Commit(ctx, "human decision"); err != nil {
		t.Fatal(err)
	}
	if got := lastAuthor(t, v.Root); got != "Wave User" {
		t.Fatalf("human-created file commit author = %q, want Wave User", got)
	}
}

func mustRead(t *testing.T, p string) []byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool { return indexOf(s, sub) >= 0 })()
}
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestWriteStatusCRLF(t *testing.T) {
	v, p := writeVaultWithDossier(t)
	orig := strings.ReplaceAll(string(mustRead(t, p)), "\n", "\r\n")
	if err := os.WriteFile(p, []byte(orig), 0o644); err != nil {
		t.Fatal(err)
	}
	base := ContentHash([]byte(orig))
	if _, err := v.Write("t-1", wspec, []RegionEdit{{Kind: FrontmatterKey, Name: "status", Value: "completed"}}, base); err != nil {
		t.Fatalf("Write to a CRLF record must pass the machine-only guard: %v", err)
	}
	got := string(mustRead(t, p))
	if want := strings.Replace(orig, "status: draft", "status: completed", 1); got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

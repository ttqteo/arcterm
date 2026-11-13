// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func newBareRemote(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if _, err := runGitErr(context.Background(), dir, "init", "--bare", "-b", "main"); err != nil {
		t.Fatal(err)
	}
	return dir
}

// newSyncVault opens a fresh vault; a non-empty remote becomes its origin.
func newSyncVault(t *testing.T, remote string) *Vault {
	t.Helper()
	v, err := OpenVaultAtForTest(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if remote != "" {
		if err := v.SetRemote(context.Background(), remote); err != nil {
			t.Fatal(err)
		}
	}
	return v
}

func writeVaultFile(t *testing.T, v *Vault, rel string, content []byte) {
	t.Helper()
	p := filepath.Join(v.Root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, content, 0o644); err != nil {
		t.Fatal(err)
	}
}

func readVaultFile(t *testing.T, v *Vault, rel string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(v.Root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func vaultFileExists(v *Vault, rel string) bool {
	_, err := os.Stat(filepath.Join(v.Root, filepath.FromSlash(rel)))
	return err == nil
}

func mustSync(t *testing.T, v *Vault) SyncResult {
	t.Helper()
	res, err := v.Sync(context.Background())
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if res.Off != "" {
		t.Fatalf("Sync off: %q", res.Off)
	}
	return res
}

func mustCommit(t *testing.T, v *Vault) {
	t.Helper()
	if err := v.Commit(context.Background(), "local"); err != nil {
		t.Fatal(err)
	}
}

func revOf(t *testing.T, dir, rev string) string {
	t.Helper()
	out, err := runGitErr(context.Background(), dir, "rev-parse", rev)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(out)
}

// assertPublished checks the vault's HEAD is what the remote's main holds.
func assertPublished(t *testing.T, v *Vault, remote string) {
	t.Helper()
	if head, main := revOf(t, v.Root, "HEAD"), revOf(t, remote, "main"); head != main {
		t.Fatalf("HEAD %s != remote main %s", head, main)
	}
}

func assertNoConflictCopies(t *testing.T, v *Vault) {
	t.Helper()
	copies, err := v.ConflictCopies()
	if err != nil {
		t.Fatal(err)
	}
	if len(copies) != 0 {
		t.Fatalf("unexpected conflict copies: %v", copies)
	}
}

// syncedPair returns two vaults sharing a remote, both holding rel = base.
func syncedPair(t *testing.T, rel string, base []byte) (a, b *Vault, remote string) {
	t.Helper()
	remote = newBareRemote(t)
	a, b = newSyncVault(t, remote), newSyncVault(t, remote)
	writeVaultFile(t, a, rel, base)
	mustSync(t, a)
	mustSync(t, b)
	return a, b, remote
}

func TestSyncNoRemoteIsNoop(t *testing.T) {
	v := newSyncVault(t, "")
	writeVaultFile(t, v, "memory/n.md", []byte("note\n"))
	res, err := v.Sync(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Off != SyncOffNoRemote {
		t.Fatalf("Off = %q, want %q", res.Off, SyncOffNoRemote)
	}
	if commitCount(t, v.Root) != 0 {
		t.Fatal("sync with no remote must not commit")
	}
}

func TestSyncFirstPushToEmptyRemote(t *testing.T) {
	remote := newBareRemote(t)
	a := newSyncVault(t, remote)
	writeVaultFile(t, a, "memory/n.md", []byte("hello\n"))
	res := mustSync(t, a)
	if !res.Pushed {
		t.Fatal("first sync to an empty remote must push")
	}
	out, err := runGitErr(context.Background(), remote, "show", "main:memory/n.md")
	if err != nil {
		t.Fatal(err)
	}
	if out != "hello\n" {
		t.Fatalf("remote content = %q", out)
	}
}

func TestSyncEachSideCommitsAndSyncs(t *testing.T) {
	remote := newBareRemote(t)
	a, b := newSyncVault(t, remote), newSyncVault(t, remote)

	writeVaultFile(t, a, "memory/a.md", []byte("from a\n"))
	mustSync(t, a)
	mustSync(t, b)
	if got := string(readVaultFile(t, b, "memory/a.md")); got != "from a\n" {
		t.Fatalf("b sees %q", got)
	}

	writeVaultFile(t, b, "memory/b.md", []byte("from b\n"))
	if res := mustSync(t, b); !res.Pushed {
		t.Fatal("b's write must push")
	}
	if res := mustSync(t, a); res.Pushed {
		t.Fatal("a pulling with nothing new must not push")
	}
	if got := string(readVaultFile(t, a, "memory/b.md")); got != "from b\n" {
		t.Fatalf("a sees %q", got)
	}
	assertPublished(t, a, remote)
}

func TestSyncReportsPulled(t *testing.T) {
	remote := newBareRemote(t)
	a, b := newSyncVault(t, remote), newSyncVault(t, remote)

	writeVaultFile(t, a, "memory/a.md", []byte("from a\n"))
	if res := mustSync(t, a); res.Pulled {
		t.Fatal("a's first push to an empty remote pulled nothing")
	}
	if res := mustSync(t, b); !res.Pulled {
		t.Fatal("b joining a's history must report a pull")
	}
	if res := mustSync(t, b); res.Pulled {
		t.Fatal("b syncing again with nothing new must not report a pull")
	}
	// a local commit alone is not a pull
	writeVaultFile(t, a, "memory/a2.md", []byte("again\n"))
	if res := mustSync(t, a); res.Pulled || !res.Pushed {
		t.Fatalf("a's own write: Pulled %v Pushed %v, want a push and no pull", res.Pulled, res.Pushed)
	}
	// both sides wrote: the merge brings a's commit into b
	writeVaultFile(t, b, "memory/b.md", []byte("from b\n"))
	if res := mustSync(t, b); !res.Pulled {
		t.Fatal("b merging a's new commit must report a pull")
	}
}

func TestSyncUnbornVaultJoinsRemote(t *testing.T) {
	remote := newBareRemote(t)
	a := newSyncVault(t, remote)
	writeVaultFile(t, a, "memory/n.md", []byte("hello\n"))
	mustSync(t, a)

	b := newSyncVault(t, remote)
	if _, err := runGit(context.Background(), b.Root, "rev-parse", "--verify", "HEAD"); err == nil {
		t.Fatal("precondition: b's HEAD must be unborn")
	}
	mustSync(t, b)
	if got := string(readVaultFile(t, b, "memory/n.md")); got != "hello\n" {
		t.Fatalf("b sees %q", got)
	}
	assertPublished(t, b, remote)
}

func TestSyncJoinsUnrelatedHistories(t *testing.T) {
	remote := newBareRemote(t)
	a, b := newSyncVault(t, ""), newSyncVault(t, "")
	for _, v := range []*Vault{a, b} {
		writeVaultFile(t, v, "skills/x/SKILL.md", []byte("same skill\n"))
	}
	writeVaultFile(t, a, "steering/AGENTS.md", []byte("steering from a\n"))
	writeVaultFile(t, b, "steering/AGENTS.md", []byte("steering from b\n"))
	mustCommit(t, a)
	mustCommit(t, b)

	for _, v := range []*Vault{a, b} {
		if err := v.SetRemote(context.Background(), remote); err != nil {
			t.Fatal(err)
		}
	}
	mustSync(t, a)
	res := mustSync(t, b)

	if got := string(readVaultFile(t, b, "skills/x/SKILL.md")); got != "same skill\n" {
		t.Fatalf("identical file = %q", got)
	}
	if got := string(readVaultFile(t, b, "steering/AGENTS.md")); got != "steering from b\n" {
		t.Fatalf("local side not kept: %q", got)
	}
	if got := string(readVaultFile(t, b, "conflicts/steering/AGENTS.md")); got != "steering from a\n" {
		t.Fatalf("conflict copy = %q", got)
	}
	if want := []string{"conflicts/steering/AGENTS.md"}; !reflect.DeepEqual(res.NewConflicts, want) {
		t.Fatalf("NewConflicts = %v, want %v", res.NewConflicts, want)
	}
	assertPublished(t, b, remote)
}

func TestSyncBothEditSameNote(t *testing.T) {
	a, b, remote := syncedPair(t, "memory/n.md", []byte("base\n"))
	writeVaultFile(t, a, "memory/n.md", []byte("edited on a\n"))
	mustSync(t, a)
	writeVaultFile(t, b, "memory/n.md", []byte("edited on b\n"))
	res := mustSync(t, b)

	if got := string(readVaultFile(t, b, "memory/n.md")); got != "edited on b\n" {
		t.Fatalf("local side not kept: %q", got)
	}
	if got := string(readVaultFile(t, b, "conflicts/memory/n.md")); got != "edited on a\n" {
		t.Fatalf("conflict copy = %q", got)
	}
	if want := []string{"conflicts/memory/n.md"}; !reflect.DeepEqual(res.NewConflicts, want) {
		t.Fatalf("NewConflicts = %v, want %v", res.NewConflicts, want)
	}
	assertPublished(t, b, remote)

	mustSync(t, a)
	if !vaultFileExists(a, "conflicts/memory/n.md") {
		t.Fatal("the conflict copy must reach the other machine")
	}
}

func marshalEffortT(t *testing.T, e *waveobj.Effort) []byte {
	t.Helper()
	b, err := MarshalEffort(e)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestSyncBothEditSameEffort(t *testing.T) {
	const rel = "efforts/e1.json"
	base := &waveobj.Effort{OID: "e1", Version: 1, Title: "base", Status: "active",
		Chunks: []waveobj.EffortChunk{chunk("c1", 10)}, CreatedTs: 1, UpdatedTs: 10}
	a, b, remote := syncedPair(t, rel, marshalEffortT(t, base))

	onA := *base
	onA.Version, onA.Title, onA.UpdatedTs = 2, "renamed on a", 20
	writeVaultFile(t, a, rel, marshalEffortT(t, &onA))
	mustSync(t, a)

	onB := *base
	onB.Version, onB.UpdatedTs = 2, 15
	onB.Notes = []waveobj.EffortNote{note(15, "note from b")}
	writeVaultFile(t, b, rel, marshalEffortT(t, &onB))
	res := mustSync(t, b)

	raw := readVaultFile(t, b, rel)
	got, err := ParseEffort(raw)
	if err != nil {
		t.Fatalf("merged effort: %v", err)
	}
	if got.Title != "renamed on a" || got.UpdatedTs != 20 || got.Version != 3 {
		t.Fatalf("merged scalars: title=%q updatedts=%d version=%d", got.Title, got.UpdatedTs, got.Version)
	}
	wantNotes(t, got.Notes, "note from b")
	if !bytes.Equal(raw, marshalEffortT(t, got)) {
		t.Fatal("merged effort is not in the canonical encoding")
	}
	if len(res.NewConflicts) != 0 {
		t.Fatalf("NewConflicts = %v", res.NewConflicts)
	}
	assertNoConflictCopies(t, b)
	assertPublished(t, b, remote)
}

func TestSyncFirstJoinMergesSettingsKeys(t *testing.T) {
	remote := newBareRemote(t)
	a, b := newSyncVault(t, remote), newSyncVault(t, remote)
	writeVaultFile(t, a, SettingsSyncPath, []byte(`{"a:key": 1, "shared": "from a"}`))
	writeVaultFile(t, b, SettingsSyncPath, []byte(`{"b:key": 2, "shared": "from b"}`))
	mustSync(t, a)
	res := mustSync(t, b)

	var got map[string]any
	if err := json.Unmarshal(readVaultFile(t, b, SettingsSyncPath), &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"a:key": 1.0, "b:key": 2.0, "shared": "from b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("merged settings = %v, want %v", got, want)
	}
	if len(res.NewConflicts) != 0 {
		t.Fatalf("NewConflicts = %v", res.NewConflicts)
	}
	assertNoConflictCopies(t, b)
}

func TestSyncMalformedEffortConflictFallsBack(t *testing.T) {
	const rel = "efforts/e2.json"
	base := &waveobj.Effort{OID: "e2", Version: 1, Title: "t", Status: "active", CreatedTs: 1, UpdatedTs: 1}
	a, b, _ := syncedPair(t, rel, marshalEffortT(t, base))
	writeVaultFile(t, a, rel, []byte("{broken on a\n"))
	mustSync(t, a)
	writeVaultFile(t, b, rel, []byte("{broken on b\n"))
	res := mustSync(t, b)

	if got := string(readVaultFile(t, b, rel)); got != "{broken on b\n" {
		t.Fatalf("local side not kept: %q", got)
	}
	if got := string(readVaultFile(t, b, "conflicts/"+rel)); got != "{broken on a\n" {
		t.Fatalf("conflict copy = %q", got)
	}
	if want := []string{"conflicts/" + rel}; !reflect.DeepEqual(res.NewConflicts, want) {
		t.Fatalf("NewConflicts = %v, want %v", res.NewConflicts, want)
	}
}

func TestSyncModifyDeleteKeepsEdit(t *testing.T) {
	remote := newBareRemote(t)
	a, b := newSyncVault(t, remote), newSyncVault(t, remote)
	writeVaultFile(t, a, "memory/edited-on-b.md", []byte("base 1\n"))
	writeVaultFile(t, a, "memory/edited-on-a.md", []byte("base 2\n"))
	mustSync(t, a)
	mustSync(t, b)

	if err := os.Remove(filepath.Join(a.Root, "memory", "edited-on-b.md")); err != nil {
		t.Fatal(err)
	}
	writeVaultFile(t, a, "memory/edited-on-a.md", []byte("edit from a\n"))
	mustSync(t, a)

	writeVaultFile(t, b, "memory/edited-on-b.md", []byte("edit from b\n"))
	if err := os.Remove(filepath.Join(b.Root, "memory", "edited-on-a.md")); err != nil {
		t.Fatal(err)
	}
	res := mustSync(t, b)

	if got := string(readVaultFile(t, b, "memory/edited-on-b.md")); got != "edit from b\n" {
		t.Fatalf("our edit vs their delete = %q", got)
	}
	if got := string(readVaultFile(t, b, "memory/edited-on-a.md")); got != "edit from a\n" {
		t.Fatalf("their edit vs our delete = %q", got)
	}
	if len(res.NewConflicts) != 0 {
		t.Fatalf("NewConflicts = %v", res.NewConflicts)
	}
	assertNoConflictCopies(t, b)
	assertPublished(t, b, remote)
}

func TestSyncConflictCopyIsByteExact(t *testing.T) {
	const rel = "memory/blob.bin"
	fromA := []byte("from a\x00 binary\r\n")
	fromB := []byte("from b\x00 binary\r\n")
	a, b, _ := syncedPair(t, rel, []byte("base\x00\r\n"))
	writeVaultFile(t, a, rel, fromA)
	mustSync(t, a)
	writeVaultFile(t, b, rel, fromB)
	mustSync(t, b)

	if got := readVaultFile(t, b, rel); !bytes.Equal(got, fromB) {
		t.Fatalf("local side = %q, want %q", got, fromB)
	}
	if got := readVaultFile(t, b, "conflicts/"+rel); !bytes.Equal(got, fromA) {
		t.Fatalf("conflict copy = %q, want %q", got, fromA)
	}
}

func TestSyncPushRaceRetries(t *testing.T) {
	a, b, remote := syncedPair(t, "memory/n.md", []byte("base\n"))
	writeVaultFile(t, a, "memory/a2.md", []byte("a2\n"))
	writeVaultFile(t, b, "memory/b2.md", []byte("b2\n"))

	raced := false
	beforePush = func() {
		if raced {
			return
		}
		raced = true
		if _, err := b.Sync(context.Background()); err != nil {
			t.Errorf("racing b.Sync: %v", err)
		}
	}
	t.Cleanup(func() { beforePush = nil })

	res := mustSync(t, a)
	if !raced || !res.Pushed {
		t.Fatalf("raced=%v pushed=%v", raced, res.Pushed)
	}
	if !vaultFileExists(a, "memory/b2.md") {
		t.Fatal("the retry must merge b's racing push")
	}
	assertPublished(t, a, remote)
}

// lockFreeWithin reports whether LockRoot(root) can be taken within d, releasing it at once.
func lockFreeWithin(root string, d time.Duration) bool {
	got := make(chan struct{})
	go func() {
		unlock := LockRoot(root)
		close(got)
		unlock()
	}()
	select {
	case <-got:
		return true
	case <-time.After(d):
		return false // the goroutine takes and drops the lock once Sync lets go of it
	}
}

// A writer (an effort save) must not wait on the network: the vault lock is free while Sync
// fetches and pushes, held only for its commit and merge.
func TestSyncLeavesTheVaultLockFreeDuringFetchAndPush(t *testing.T) {
	a, _, _ := syncedPair(t, "memory/n.md", []byte("base\n"))
	writeVaultFile(t, a, "memory/a2.md", []byte("a2\n"))
	var fetchFree, pushFree bool
	beforeFetch = func() { fetchFree = lockFreeWithin(a.Root, 2*time.Second) }
	beforePush = func() { pushFree = lockFreeWithin(a.Root, 2*time.Second) }
	t.Cleanup(func() { beforeFetch, beforePush = nil, nil })

	if res := mustSync(t, a); !res.Pushed {
		t.Fatal("the sync must push a2")
	}
	if !fetchFree || !pushFree {
		t.Fatalf("vault lock held over the network: free during fetch=%v, push=%v", fetchFree, pushFree)
	}
}

// A write that lands while Sync fetches is committed before the merge (which needs a clean tree,
// here one the incoming change touches) and goes out with the same push.
func TestSyncCommitsAWriteMadeDuringTheFetch(t *testing.T) {
	a, b, remote := syncedPair(t, "memory/n.md", []byte("base\n"))
	writeVaultFile(t, b, "memory/n.md", []byte("edited on b\n"))
	mustSync(t, b)

	wrote := false
	beforeFetch = func() {
		if wrote {
			return
		}
		wrote = true
		unlock := LockRoot(a.Root) // as an effort-store write does
		writeVaultFile(t, a, "memory/during.md", []byte("written mid-fetch\n"))
		unlock()
	}
	t.Cleanup(func() { beforeFetch = nil })

	res := mustSync(t, a)
	if !wrote || !res.Pulled || !res.Pushed {
		t.Fatalf("wrote=%v pulled=%v pushed=%v", wrote, res.Pulled, res.Pushed)
	}
	if got := string(readVaultFile(t, a, "memory/n.md")); got != "edited on b\n" {
		t.Fatalf("b's edit not merged: %q", got)
	}
	out, err := runGitErr(context.Background(), remote, "show", "main:memory/during.md")
	if err != nil || out != "written mid-fetch\n" {
		t.Fatalf("the mid-fetch write was not pushed: %q, %v", out, err)
	}
	assertPublished(t, a, remote)
}

func TestSyncRecoversInterruptedMerge(t *testing.T) {
	ctx := context.Background()
	a, b, remote := syncedPair(t, "memory/n.md", []byte("base\n"))
	writeVaultFile(t, a, "memory/n.md", []byte("edited on a\n"))
	mustSync(t, a)
	writeVaultFile(t, b, "memory/n.md", []byte("edited on b\n"))
	mustCommit(t, b)
	if _, err := runGitErr(ctx, b.Root, "fetch", "origin"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGitErr(ctx, b.Root, "merge", "origin/main"); err == nil {
		t.Fatal("precondition: the manual merge must conflict")
	}

	mustSync(t, b)
	if _, err := runGit(ctx, b.Root, "rev-parse", "--verify", "-q", "MERGE_HEAD"); err == nil {
		t.Fatal("MERGE_HEAD still present after sync")
	}
	if got := string(readVaultFile(t, b, "memory/n.md")); got != "edited on b\n" {
		t.Fatalf("local side not kept: %q", got)
	}
	assertPublished(t, b, remote)
}

func TestSetRemoteAddSetRemove(t *testing.T) {
	ctx := context.Background()
	v := newSyncVault(t, "")
	steps := []struct{ set, want string }{
		{"", ""},
		{"https://example.com/one.git", "https://example.com/one.git"},
		{"  https://example.com/two.git ", "https://example.com/two.git"},
		{"", ""},
	}
	for _, s := range steps {
		if err := v.SetRemote(ctx, s.set); err != nil {
			t.Fatalf("SetRemote(%q): %v", s.set, err)
		}
		got, err := v.RemoteURL(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if got != s.want {
			t.Fatalf("after SetRemote(%q): RemoteURL = %q, want %q", s.set, got, s.want)
		}
	}
	if err := v.SetRemote(ctx, "--upload-pack=evil"); err == nil {
		t.Fatal("a url that git would parse as an option must be rejected")
	}
}

func TestConflictCopiesAndMalformedEfforts(t *testing.T) {
	v := newSyncVault(t, "")
	if got, err := v.ConflictCopies(); err != nil || got != nil {
		t.Fatalf("no conflicts dir: %v, %v", got, err)
	}
	if got, err := v.MalformedEfforts(); err != nil || got != nil {
		t.Fatalf("no efforts dir: %v, %v", got, err)
	}

	writeVaultFile(t, v, "conflicts/steering/AGENTS.md", []byte("x"))
	writeVaultFile(t, v, "conflicts/memory/n.md", []byte("x"))
	good := &waveobj.Effort{OID: "ok", Status: "active"}
	writeVaultFile(t, v, "efforts/ok.json", marshalEffortT(t, good))
	writeVaultFile(t, v, "efforts/z-bad.json", []byte("{nope"))
	writeVaultFile(t, v, "efforts/a-nooid.json", []byte(`{"title":"x"}`))
	writeVaultFile(t, v, "efforts/readme.txt", []byte("not an effort"))

	copies, err := v.ConflictCopies()
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"conflicts/memory/n.md", "conflicts/steering/AGENTS.md"}; !reflect.DeepEqual(copies, want) {
		t.Fatalf("ConflictCopies = %v, want %v", copies, want)
	}
	bad, err := v.MalformedEfforts()
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"efforts/a-nooid.json", "efforts/z-bad.json"}; !reflect.DeepEqual(bad, want) {
		t.Fatalf("MalformedEfforts = %v, want %v", bad, want)
	}
}

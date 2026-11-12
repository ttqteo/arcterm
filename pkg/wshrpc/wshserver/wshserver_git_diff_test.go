// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func writeInRepo(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// a.txt is committed as "one", b.txt as "two" in a second commit; HEAD is "later" (c.txt), and a.txt is
// then edited on disk, uncommitted.
func diffTestRepo(t *testing.T) (dir, base, end, head string) {
	t.Helper()
	dir = t.TempDir()
	gitIn(t, dir, "init", "-q", "-b", "main")
	gitIn(t, dir, "config", "user.name", "t")
	gitIn(t, dir, "config", "user.email", "t@t")
	gitIn(t, dir, "config", "core.autocrlf", "false")
	writeInRepo(t, dir, "a.txt", "one\n")
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-q", "-m", "base")
	base = gitIn(t, dir, "rev-parse", "HEAD")
	writeInRepo(t, dir, "b.txt", "two\n")
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-q", "-m", "end")
	end = gitIn(t, dir, "rev-parse", "HEAD")
	writeInRepo(t, dir, "c.txt", "three\n")
	gitIn(t, dir, "add", ".")
	gitIn(t, dir, "commit", "-q", "-m", "later")
	head = gitIn(t, dir, "rev-parse", "HEAD")
	writeInRepo(t, dir, "a.txt", "edited on disk\n")
	return dir, base, end, head
}

func TestGitFileAtRefCommandWorktreeReadsTheDisk(t *testing.T) {
	dir, _, _, _ := diffTestRepo(t)
	ws := &WshServer{}
	ctx := context.Background()
	// without Worktree it is the blob at the ref, as before
	blob, err := ws.GitFileAtRefCommand(ctx, wshrpc.CommandGitFileAtRefData{Cwd: dir, Ref: "HEAD", Path: "a.txt"})
	if err != nil || blob.Content != "one\n" {
		t.Fatalf("blob read = %+v, %v; want the committed text", blob, err)
	}
	disk, err := ws.GitFileAtRefCommand(ctx, wshrpc.CommandGitFileAtRefData{Cwd: dir, Ref: "HEAD", Path: "a.txt", Worktree: true})
	if err != nil || disk.Content != "edited on disk\n" || !disk.IsRepo {
		t.Fatalf("worktree read = %+v, %v; want the on-disk text", disk, err)
	}
	capped, err := ws.GitFileAtRefCommand(ctx, wshrpc.CommandGitFileAtRefData{Cwd: dir, Path: "a.txt", Worktree: true, MaxBytes: 4})
	if err != nil || !capped.TooLarge || capped.Content != "" {
		t.Fatalf("capped worktree read = %+v, %v; want TooLarge and no content", capped, err)
	}
	// a binary file on disk comes back with its bytes when the caller asks for Raw, as a blob read does
	writeInRepo(t, dir, "img.bin", "ab\x00cd")
	raw, err := ws.GitFileAtRefCommand(ctx, wshrpc.CommandGitFileAtRefData{Cwd: dir, Path: "img.bin", Worktree: true, Raw: true})
	if err != nil || !raw.Binary || raw.Data64 == "" {
		t.Fatalf("raw worktree read = %+v, %v; want Binary with Data64", raw, err)
	}
}

func TestGitChangesCommandBoundedByEnd(t *testing.T) {
	dir, base, end, head := diffTestRepo(t)
	ws := &WshServer{}
	ctx := context.Background()
	bounded, err := ws.GitChangesCommand(ctx, wshrpc.CommandGitChangesData{Cwd: dir, Ref: base, End: end})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(bounded.StatusZ, "b.txt") || strings.Contains(bounded.StatusZ, "c.txt") || strings.Contains(bounded.StatusZ, "a.txt") {
		t.Errorf("bounded StatusZ = %q, want only b.txt", bounded.StatusZ)
	}
	if bounded.Branch != "main" || bounded.Head != head || bounded.Ref != base {
		t.Errorf("Branch/Head/Ref = %q/%q/%q, want main/%s/%s", bounded.Branch, bounded.Head, bounded.Ref, head, base)
	}
	// End without a ref changes nothing: the live read
	live, err := ws.GitChangesCommand(ctx, wshrpc.CommandGitChangesData{Cwd: dir, End: end})
	if err != nil || !strings.Contains(live.StatusZ, "a.txt") {
		t.Errorf("End with no ref: %+v, %v; want the live list, the edited a.txt included", live, err)
	}
	// a ref with no End is the read to the working tree, as before
	open, err := ws.GitChangesCommand(ctx, wshrpc.CommandGitChangesData{Cwd: dir, Ref: base})
	if err != nil || !strings.Contains(open.StatusZ, "c.txt") {
		t.Errorf("ref with no End: %+v, %v; want everything since base, c.txt included", open, err)
	}
}

func TestGitChangesCommandPassesNumstatErrorThrough(t *testing.T) {
	dir, _, _, _ := diffTestRepo(t)
	// the committed blob of the edited file goes missing: status still lists it, `diff --numstat` cannot
	blob := gitIn(t, dir, "rev-parse", "HEAD:a.txt")
	obj := filepath.Join(dir, ".git", "objects", blob[:2], blob[2:])
	if err := os.Chmod(obj, 0o666); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(obj); err != nil {
		t.Fatalf("removing the loose blob: %v", err)
	}
	got, err := (&WshServer{}).GitChangesCommand(context.Background(), wshrpc.CommandGitChangesData{Cwd: dir})
	if err != nil {
		t.Fatalf("GitChangesCommand: %v, want the list with the numstat error beside it", err)
	}
	if !strings.Contains(got.StatusZ, "a.txt") || !strings.Contains(got.NumstatError, "diff --numstat") {
		t.Errorf("StatusZ %q, NumstatError %q; want the list and the error", got.StatusZ, got.NumstatError)
	}
}

func TestListBranchesCommandReportsAConfiguredRemote(t *testing.T) {
	dir, _, _, _ := diffTestRepo(t)
	ws := &WshServer{}
	ctx := context.Background()
	got, err := ws.ListBranchesCommand(ctx, wshrpc.CommandListBranchesData{ProjectPath: dir})
	if err != nil || got.HasRemote {
		t.Fatalf("no remote: %+v, %v; want HasRemote false", got, err)
	}
	bare := t.TempDir()
	gitIn(t, bare, "init", "-q", "--bare")
	gitIn(t, dir, "remote", "add", "origin", bare)
	got, err = ws.ListBranchesCommand(ctx, wshrpc.CommandListBranchesData{ProjectPath: dir})
	if err != nil || !got.HasRemote {
		t.Fatalf("with origin: %+v, %v; want HasRemote true", got, err)
	}
}

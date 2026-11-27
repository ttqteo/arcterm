// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	stalePlanLabel  = "Rework src/store.ts reads"
	staleLaterLabel = "Revisit src/store.ts reads"
)

// staleCommit commits one file's new content at unixSec and returns the commit.
func staleCommit(t *testing.T, dir, file, content string, unixSec int64) string {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, file), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	date := time.Unix(unixSec, 0).UTC().Format(time.RFC3339)
	env := append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_AUTHOR_DATE="+date,
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t", "GIT_COMMITTER_DATE="+date)
	for _, args := range [][]string{{"add", "."}, {"commit", "-q", "-m", "c"}} {
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = env
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	head, err := gitinfo.HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	return head
}

// staleLaterFixture is an active initiative on a project checkout whose src/store.ts changed after two chunks naming
// it were written: a plan chunk and a chunk saved for later, neither with a base. It returns the initiative and the
// commit both chunks were written against.
func staleLaterFixture(t *testing.T) (oid, base string) {
	t.Helper()
	ctx := context.Background()
	withConfigHome(t, t.TempDir())
	t.Cleanup(effortstore.UseRootForTest(t.TempDir()))

	dir := t.TempDir()
	if out, err := exec.Command("git", "-C", dir, "init", "-q", "-b", "main").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	now := time.Now()
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	base = staleCommit(t, dir, "src/store.ts", "one\n", now.Add(-10*24*time.Hour).Unix())
	staleCommit(t, dir, "src/store.ts", "one\ntwo\n", now.Add(-2*24*time.Hour).Unix())

	const project = "stale-later-proj"
	if err := (&WshServer{}).CreateProjectCommand(ctx, wshrpc.CommandCreateProjectData{Name: project, Path: dir}); err != nil {
		t.Fatal(err)
	}
	written := now.Add(-5 * 24 * time.Hour).UnixMilli()
	e := &waveobj.Effort{
		Title: "stale scan and later chunks", Project: project, Status: "active",
		Chunks: []waveobj.EffortChunk{
			{Label: stalePlanLabel, Status: "pending", UpdatedTs: written},
			{Label: staleLaterLabel, Status: "pending", Later: true, UpdatedTs: written},
		},
		Events: []waveobj.EffortEvent{
			{Ts: written, Kind: "chunk-added", Label: stalePlanLabel},
			{Ts: written, Kind: "chunk-added", Label: staleLaterLabel},
		},
	}
	if err := effortstore.Create(ctx, e); err != nil {
		t.Fatal(err)
	}
	return e.OID, base
}

// The scan lists a plan chunk that names a changed file, and leaves out a saved passage that names the same file: it
// is the person's own item, not work written against the code.
func TestScanStaleLeavesLaterChunksOut(t *testing.T) {
	oid, _ := staleLaterFixture(t)
	ctx := context.Background()
	for _, scope := range []string{oid, ""} {
		entries, err := scanStale(ctx, scope)
		if err != nil {
			t.Fatal(err)
		}
		if len(entries) != 1 || len(entries[0].Chunks) != 1 {
			t.Fatalf("scope %q: entries = %+v, want one initiative with one chunk", scope, entries)
		}
		got := entries[0].Chunks[0]
		if got.Chunk != stalePlanLabel || got.Index != 1 || len(got.Files) != 1 || got.Files[0].Mention != "src/store.ts" {
			t.Fatalf("scope %q: flagged %+v, want only the plan chunk at 1 naming src/store.ts", scope, got)
		}
	}

	// the same chunk, no longer saved for later, is flagged: the later mark is what kept it out
	err := effortstore.Update(ctx, oid, func(e *waveobj.Effort) error {
		e.Chunks[1].Later = false
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	entries, err := scanStale(ctx, oid)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || len(entries[0].Chunks) != 2 || entries[0].Chunks[1].Chunk != staleLaterLabel {
		t.Fatalf("a chunk taken out of Later = %+v, want both chunks flagged", entries)
	}
}

// The base backfill stamps the plan chunk and leaves the saved passage with no base.
func TestBackfillBasesLeavesLaterChunksOut(t *testing.T) {
	oid, base := staleLaterFixture(t)
	ctx := context.Background()
	chunks, efforts, err := backfillBases(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if chunks != 1 || efforts != 1 {
		t.Fatalf("stamped %d chunks in %d initiatives, want 1 in 1", chunks, efforts)
	}
	e, err := effortstore.Get(ctx, oid)
	if err != nil {
		t.Fatal(err)
	}
	if e.Chunks[0].Label != stalePlanLabel || e.Chunks[0].BaseCommit != base {
		t.Fatalf("plan chunk base = %q, want %q", e.Chunks[0].BaseCommit, base)
	}
	if e.Chunks[1].Label != staleLaterLabel || e.Chunks[1].BaseCommit != "" {
		t.Fatalf("later chunk base = %q, want none", e.Chunks[1].BaseCommit)
	}
}

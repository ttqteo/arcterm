// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavevault"
)

func seedNoteVault(t *testing.T) *wavevault.Vault {
	t.Helper()
	v, err := wavevault.OpenVaultAtForTest(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	write := func(rel, content string) {
		if err := os.WriteFile(filepath.Join(v.Root, rel), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("tasks/active/t-1.md", "---\nid: t-1\nstatus: active\nobjective: drop worktrees\n---\n\nbody [[m-1]]\n")
	write("memory/m-1.md", "---\nid: m-1\n---\n\nWorktrees flaky.\n")
	write("decisions/d-1.md", "---\nid: d-1\nstatus: accepted\ntitle: worktree call\n---\n\nrationale\n")
	return v
}

func TestReadVaultNoteReturnsTitleAndBody(t *testing.T) {
	v := seedNoteVault(t)
	if err := os.MkdirAll(filepath.Join(v.Root, "memory", "waveterm"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(v.Root, "memory", "waveterm", "m-2.md"), []byte("---\nid: m-2\ntitle: EC-TIME lands anyway\n---\n\nNever re-send.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := readVaultNote(v, "m-2")
	if err != nil {
		t.Fatalf("readVaultNote(m-2): %v", err)
	}
	if got.Id != "m-2" || got.Title != "EC-TIME lands anyway" || got.Project != "waveterm" || got.Updated == 0 {
		t.Fatalf("m-2 = %+v, want title from frontmatter, project waveterm, an updated time", got)
	}
	if !strings.Contains(got.Body, "Never re-send.") || strings.Contains(got.Body, "title:") {
		t.Fatalf("m-2 body = %q, want the body without its frontmatter", got.Body)
	}

	got, err = readVaultNote(v, "m-1") // no title frontmatter, at the memory root
	if err != nil {
		t.Fatalf("readVaultNote(m-1): %v", err)
	}
	if got.Title != "m-1" || got.Project != "" {
		t.Fatalf("m-1 = %+v, want the id as title and no project", got)
	}
}

func TestReadVaultNoteErrorsOnUnknownId(t *testing.T) {
	v := seedNoteVault(t)
	if got, err := readVaultNote(v, "no-such-note"); err == nil {
		t.Fatalf("readVaultNote(no-such-note) = %+v, want an error", got)
	}
}

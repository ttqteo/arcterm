// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// writeProjectTranscript writes a store folder's transcript whose user record names cwd, after a record that
// names none (Claude Code can open a session with a summary).
func writeProjectTranscript(t *testing.T, root, slug, name, cwd string, mtime time.Time) {
	t.Helper()
	dir := filepath.Join(root, slug)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	user, _ := json.Marshal(map[string]any{"type": "user", "cwd": cwd})
	body := `{"type":"summary","summary":"x"}` + "\n" + string(user) + "\n"
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

func mkdirAll(t *testing.T, parts ...string) string {
	t.Helper()
	p := filepath.Join(parts...)
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestScanClaudeProjects(t *testing.T) {
	root := t.TempDir()
	work := t.TempDir()
	temp := t.TempDir()
	now := time.Now().Truncate(time.Second)

	alpha := mkdirAll(t, work, "alpha")
	beta := mkdirAll(t, work, "beta")
	runTree := mkdirAll(t, work, "alpha", ".waveterm", "worktrees", "0f8fad5b-d9cb-469f-a165-70867728950e-t-1")
	agentTree := mkdirAll(t, work, "alpha", ".claude", "worktrees", "fix")
	scratch := mkdirAll(t, temp, "scratch")

	writeProjectTranscript(t, root, "alpha", "a1.jsonl", alpha, now.Add(-3*time.Hour))
	writeProjectTranscript(t, root, "alpha", "a2.jsonl", alpha, now.Add(-1*time.Hour))
	writeProjectTranscript(t, root, "beta", "b1.jsonl", beta, now.Add(-2*time.Hour))
	// a subagent transcript sits in a subfolder: not a session of its own
	writeProjectTranscript(t, root, filepath.Join("beta", "b1", "subagents"), "s1.jsonl", beta, now)
	writeProjectTranscript(t, root, "run", "r1.jsonl", runTree, now)
	writeProjectTranscript(t, root, "agentwt", "w1.jsonl", agentTree, now)
	writeProjectTranscript(t, root, "tmp", "t1.jsonl", scratch, now)
	writeProjectTranscript(t, root, "gone", "g1.jsonl", filepath.Join(work, "deleted"), now)
	writeProjectTranscript(t, root, "headless", "h1.jsonl", beta, now)

	got := scanClaudeProjects(root, "headless", temp)
	if len(got) != 2 {
		t.Fatalf("want alpha and beta, got %+v", got)
	}
	if got[0].Path != alpha || got[0].Name != "alpha" || got[0].Sessions != 2 {
		t.Errorf("first = %+v, want alpha with 2 sessions", got[0])
	}
	if got[0].LastActiveTs != now.Add(-1*time.Hour).UnixMilli() {
		t.Errorf("alpha last active = %d, want its newest transcript's mtime", got[0].LastActiveTs)
	}
	if got[1].Path != beta || got[1].Sessions != 1 {
		t.Errorf("second = %+v, want beta with 1 session", got[1])
	}
}

func TestScanClaudeProjectsMergesOneFolderUnderTwoSlugs(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("a drive letter's case only splits a folder in two on Windows")
	}
	root := t.TempDir()
	alpha := mkdirAll(t, t.TempDir(), "alpha")
	now := time.Now().Truncate(time.Second)
	lower := strings.ToLower(alpha[:1]) + alpha[1:]
	writeProjectTranscript(t, root, "upper", "u.jsonl", alpha, now.Add(-time.Hour))
	writeProjectTranscript(t, root, "lower", "l.jsonl", lower, now)

	got := scanClaudeProjects(root, "", "")
	if len(got) != 1 || got[0].Sessions != 2 || got[0].Path != lower {
		t.Fatalf("want one merged project at the newer spelling, got %+v", got)
	}
}

func TestScanClaudeProjectsMissingStore(t *testing.T) {
	if got := scanClaudeProjects(filepath.Join(t.TempDir(), "nope"), "", ""); got != nil {
		t.Fatalf("want nil for a missing store, got %+v", got)
	}
}

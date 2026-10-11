// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const day = 24 * time.Hour

// session writes <root>/<project>/<id>.jsonl last changed age ago, with a sibling <id>/ directory
func session(t *testing.T, root, id string, size int, age time.Duration) string {
	t.Helper()
	path := filepath.Join(root, "-p-proj", id+".jsonl")
	writeFile(t, path, size)
	writeFile(t, filepath.Join(root, "-p-proj", id, "subagents", "a.jsonl"), 50)
	when := time.Now().Add(-age)
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
	return path
}

func sessionEnv(t *testing.T, root string, live ...string) *Env {
	return &Env{
		Now:             time.Now,
		SessionDirs:     []string{root},
		TrashDir:        filepath.Join(t.TempDir(), "trash"),
		LiveTranscripts: func(context.Context) ([]string, error) { return live, nil },
	}
}

func TestSessionsListsOnlyWeekOldTranscriptsWithTheirDirectory(t *testing.T) {
	root := t.TempDir()
	old := session(t, root, "old-session", 200, 40*day)
	session(t, root, "new-session", 200, 2*day)
	rep := oldSessions{}.measure(context.Background(), sessionEnv(t, root))
	if len(rep.Items) != 1 || rep.Items[0].ID != old {
		t.Fatalf("got %+v, want only the 40-day-old session", rep.Items)
	}
	if it := rep.Items[0]; it.Bytes != 250 || !it.Cleanable || it.ModTs == 0 {
		t.Fatalf("got %+v, want 200 + 50 bytes, cleanable, its time", it)
	}
}

func TestSessionOpenInATabIsNotCleanable(t *testing.T) {
	root := t.TempDir()
	old := session(t, root, "open-session", 10, 40*day)
	rep := oldSessions{}.measure(context.Background(), sessionEnv(t, root, old))
	if it := rep.Items[0]; it.Cleanable || it.Reason != "open in a tab" {
		t.Fatalf("got %+v, want it kept as open", it)
	}
}

func TestCleanMovesSessionsToTheTrash(t *testing.T) {
	root := t.TempDir()
	old := session(t, root, "old-session", 200, 40*day)
	env := sessionEnv(t, root)
	res := oldSessions{}.clean(context.Background(), env, []string{old}, CleanOpts{OlderThanDays: 30})
	if len(res.Cleaned) != 1 || res.Trashed != 250 || res.Reclaimed != 0 {
		t.Fatalf("got %+v, want 250 bytes moved to the trash", res)
	}
	if _, err := os.Stat(old); err == nil {
		t.Fatal("the transcript must have left the projects folder")
	}
	if entries, _ := os.ReadDir(env.TrashDir); len(entries) != 1 {
		t.Fatalf("want one trash entry, have %d", len(entries))
	}
}

func TestCleanSkipsASessionNewerThanTheChosenAge(t *testing.T) {
	root := t.TempDir()
	tenDays := session(t, root, "ten-days", 10, 10*day)
	res := oldSessions{}.clean(context.Background(), sessionEnv(t, root), []string{tenDays}, CleanOpts{OlderThanDays: 30})
	if len(res.Cleaned) != 0 || len(res.Skipped) != 1 || res.Skipped[0].Reason != "changed in the last 30 days" {
		t.Fatalf("got %+v, want it skipped as too new", res)
	}
}

func TestCleanSkipsALiveSessionAndNeverRunsAutomatically(t *testing.T) {
	root := t.TempDir()
	old := session(t, root, "open-session", 10, 40*day)
	if res := (oldSessions{}).clean(context.Background(), sessionEnv(t, root, old), []string{old}, CleanOpts{OlderThanDays: 7}); len(res.Cleaned) != 0 {
		t.Fatalf("cleaned a session a tab has open: %+v", res)
	}
	if res := (oldSessions{}).clean(context.Background(), sessionEnv(t, root), []string{old}, CleanOpts{Auto: true}); len(res.Cleaned) != 0 {
		t.Fatalf("auto-clean must never touch sessions: %+v", res)
	}
}

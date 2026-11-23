// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"os"
	"path/filepath"
	"testing"
)

const tasksSession = "4b2df5dd-4a7d-402b-9e30-72d1d8f52887"

// the folder names Claude Code wrote for these projects on this machine (2026-11-23)
func TestClaudeTempProjectDirHashesTheLowercasedName(t *testing.T) {
	for project, want := range map[string]string{
		"D--work-arcterm":                      "af6958e97965116e",
		"d--work-mit-mit-thesis":               "5e2ecd59cda09c82",
		"D--Workspace-SIEM-portal-apps-portal": "51e72e0768dda010",
	} {
		if got := claudeTempProjectDir(project); got != want {
			t.Errorf("claudeTempProjectDir(%q) = %q, want %q", project, got, want)
		}
	}
}

func transcriptIn(t *testing.T, project string) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "projects", project, tasksSession+".jsonl")
}

func mkTasks(t *testing.T, root string, parts ...string) string {
	t.Helper()
	dir := filepath.Join(append([]string{root, "claude"}, append(parts, tasksSession, "tasks")...)...)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestClaudeTasksDirFindsTheHashedFolder(t *testing.T) {
	root := t.TempDir()
	want := mkTasks(t, root, "af6958e97965116e")
	if got := ClaudeTasksDir(transcriptIn(t, "D--work-arcterm"), root); got != want {
		t.Errorf("ClaudeTasksDir = %q, want %q", got, want)
	}
}

// Claude Code before short temp dirs named the folder after the project itself
func TestClaudeTasksDirFindsTheOlderNamedFolder(t *testing.T) {
	root := t.TempDir()
	want := mkTasks(t, root, "D--work-arcterm")
	if got := ClaudeTasksDir(transcriptIn(t, "D--work-arcterm"), root); got != want {
		t.Errorf("ClaudeTasksDir = %q, want %q", got, want)
	}
}

func TestClaudeTasksDirIsEmptyWhenNoFolderExists(t *testing.T) {
	root := t.TempDir()
	mkTasks(t, root, "af6958e97965116e") // another project's session folder does not count
	for _, transcript := range []string{
		transcriptIn(t, "D--other-project"),
		filepath.Join(t.TempDir(), "D--work-arcterm", tasksSession+".txt"),
		tasksSession + ".jsonl",
		"",
	} {
		if got := ClaudeTasksDir(transcript, root); got != "" {
			t.Errorf("ClaudeTasksDir(%q) = %q, want empty", transcript, got)
		}
	}
}

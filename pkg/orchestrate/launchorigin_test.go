// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const originRun = "c1423d16-9d19-4f67-8726-7aed1a35e400"

// A session's transcript places it in the run that launched it when the store has no record of that run: the
// worktree it ran in, read back from worktreeDir's own keys.
func TestLaunchOriginReadsTheWorktreeBack(t *testing.T) {
	project := filepath.Join("D:", "projects", "arcterm")
	cases := []struct {
		name string
		cwd  string
		want LaunchOrigin
	}{
		{"a task's tree", worktreeDir(project, TaskWorktreeKey(originRun, "t-8")), LaunchOrigin{RunID: originRun, TaskID: "t-8"}},
		{"the final tree", worktreeDir(project, FinalWorktreeKey(originRun)), LaunchOrigin{RunID: originRun, Role: jarvis.UsageRole_Verifier}},
		{"the run's own tree", worktreeDir(project, originRun), LaunchOrigin{RunID: originRun}},
		{"a folder inside a task's tree", filepath.Join(worktreeDir(project, TaskWorktreeKey(originRun, "t-2")), "frontend"), LaunchOrigin{RunID: originRun, TaskID: "t-2"}},
		{"forward slashes", "D:/projects/arcterm/.waveterm/worktrees/" + originRun + "-t-1", LaunchOrigin{RunID: originRun, TaskID: "t-1"}},
	}
	for _, c := range cases {
		got, ok := LaunchOriginOf(c.cwd, "Your instructions are in the file C:\\prompts\\x.md")
		if !ok || got != c.want {
			t.Errorf("%s: LaunchOriginOf(%q) = %+v, %v; want %+v", c.name, c.cwd, got, ok, c.want)
		}
	}
}

func TestLaunchOriginIgnoresOtherFolders(t *testing.T) {
	for _, cwd := range []string{
		filepath.Join("D:", "projects", "arcterm"),
		filepath.Join("D:", "projects", "arcterm", ".waveterm", "worktrees", "notarun-t-1"),
		filepath.Join("D:", "projects", "arcterm", ".waveterm", "worktrees"),
		filepath.Join("D:", "elsewhere", "worktrees", originRun+"-t-1"),
		"",
	} {
		if got, ok := LaunchOriginOf(cwd, "how to build this"); ok {
			t.Errorf("LaunchOriginOf(%q) = %+v, want no origin", cwd, got)
		}
	}
}

// A stage session runs outside any task's tree (the plan reviewer in the landing tree), so its prompt's opening line
// places it. The scan keeps only a session's first 120 characters, which hold the whole line.
func TestLaunchOriginReadsAStagePromptBack(t *testing.T) {
	g := &waveobj.TaskGroup{RunID: originRun, PlanPath: "p.md", Final: &waveobj.FinalStage{Round: 1, Tree: "/tree"}}
	cases := []struct {
		role   string
		prompt string
	}{
		{jarvis.UsageRole_PlanReviewer, planReviewPrompt(g, "tree")},
		{jarvis.UsageRole_Verifier, verifierPrompt(context.Background(), g, &waveobj.Run{})},
	}
	for _, c := range cases {
		want := LaunchOrigin{RunID: originRun, Role: c.role}
		for _, prompt := range []string{c.prompt, c.prompt[:120]} {
			if got, ok := LaunchOriginOf(filepath.Join("D:", "projects", "arcterm"), prompt); !ok || got != want {
				t.Errorf("%s: LaunchOriginOf on %q = %+v, %v; want %+v", c.role, prompt, got, ok, want)
			}
		}
	}
	for _, prompt := range []string{
		"You are the plan reviewer for run banana. Judge it.",
		"Please act as if You are the plan reviewer for run " + originRun + ".",
		"how to build this",
	} {
		if got, ok := LaunchOriginOf("", prompt); ok {
			t.Errorf("LaunchOriginOf on %q = %+v, want no origin", prompt, got)
		}
	}
}

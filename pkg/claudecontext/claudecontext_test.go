// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudecontext

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
)

func write(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func find(files []File, group, label string) (File, bool) {
	for _, f := range files {
		if f.Group == group && f.Label == label {
			return f, true
		}
	}
	return File{}, false
}

func count(files []File, group string) int {
	n := 0
	for _, f := range files {
		if f.Group == group {
			n++
		}
	}
	return n
}

func TestScanErrorsOnAMissingProject(t *testing.T) {
	if _, err := Scan(filepath.Join(t.TempDir(), "gone"), t.TempDir()); err == nil {
		t.Fatal("want an error for a project folder that does not exist")
	}
}

func TestScanListsTheFixedFilesEvenWhenMissing(t *testing.T) {
	files, err := Scan(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{GroupInstructions: 4, GroupMemory: 0, GroupSettings: 3, GroupSkills: 0, GroupSetup: 1, GroupGlobal: 2}
	for g, n := range want {
		if got := count(files, g); got != n {
			t.Errorf("%s: got %d rows, want %d", g, got, n)
		}
	}
	for _, f := range files {
		if f.Exists {
			t.Errorf("%s exists in an empty project", f.Label)
		}
	}
}

func TestScanMarksTheInstructionsClaudeReads(t *testing.T) {
	proj := t.TempDir()
	write(t, filepath.Join(proj, ".claude", "CLAUDE.md"), "# a")
	write(t, filepath.Join(proj, "AGENTS.md"), "# b")
	write(t, filepath.Join(proj, "CLAUDE.local.md"), "# c")
	files, err := Scan(proj, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for label, want := range map[string]string{
		"CLAUDE.md": "", ".claude/CLAUDE.md": NoteReads, "CLAUDE.local.md": NoteReads, "AGENTS.md": "",
	} {
		f, _ := find(files, GroupInstructions, label)
		if f.Note != want {
			t.Errorf("%s: note %q, want %q", label, f.Note, want)
		}
	}
}

func TestScanReadsMemoryUnderTheProjectSlug(t *testing.T) {
	proj, home := t.TempDir(), t.TempDir()
	dir := filepath.Join(home, ".claude", "projects", agentobserve.SlugifyCwd(proj), "memory")
	write(t, filepath.Join(dir, "MEMORY.md"), "- [a](a.md)")
	write(t, filepath.Join(dir, "a.md"), "---\nname: a\ndescription: top level\ntype: feedback\n---\nbody")
	write(t, filepath.Join(dir, "b.md"), "---\r\nname: b\r\ndescription: nested\r\nmetadata:\r\n  type: project\r\n---\r\nbody")
	write(t, filepath.Join(dir, "c.md"), "no frontmatter")
	write(t, filepath.Join(dir, "notes.txt"), "not memory")
	files, err := Scan(proj, home)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct{ label, note, desc string }{
		{"MEMORY.md", "index", ""},
		{"a.md", "feedback", "top level"},
		{"b.md", "project", "nested"},
		{"c.md", "", ""},
	}
	if got := count(files, GroupMemory); got != len(cases) {
		t.Fatalf("got %d memory rows, want %d", got, len(cases))
	}
	for _, c := range cases {
		f, ok := find(files, GroupMemory, c.label)
		if !ok || !f.Exists || f.Note != c.note || f.Description != c.desc {
			t.Errorf("%s: got %+v, want note %q description %q", c.label, f, c.note, c.desc)
		}
	}
}

func TestScanNotesHooksServersAndInvalidJSON(t *testing.T) {
	proj, home := t.TempDir(), t.TempDir()
	write(t, filepath.Join(proj, ".claude", "settings.json"), "\ufeff"+`{"hooks":{
		"Stop":[{"hooks":[{"type":"command","command":"a"},{"type":"command","command":"b"}]}],
		"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"c"}]}]}}`)
	write(t, filepath.Join(proj, ".claude", "settings.local.json"), `{"permissions":`)
	write(t, filepath.Join(proj, ".mcp.json"), `{"mcpServers":{"x":{"command":"x"}}}`)
	write(t, filepath.Join(home, ".claude", "settings.json"), `{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"a"}]}]}}`)
	files, err := Scan(proj, home)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ group, label, note string }{
		{GroupSettings, ".claude/settings.json", "3 hooks"},
		{GroupSettings, ".claude/settings.local.json", NoteInvalidJSON},
		{GroupSettings, ".mcp.json", "1 MCP server"},
		{GroupGlobal, "~/.claude/settings.json", "1 hook"},
	} {
		f, _ := find(files, c.group, c.label)
		if f.Note != c.note {
			t.Errorf("%s: note %q, want %q", c.label, f.Note, c.note)
		}
	}
}

func TestScanListsSkillsAgentsAndCommands(t *testing.T) {
	proj := t.TempDir()
	write(t, filepath.Join(proj, ".claude", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship it\n---\n")
	write(t, filepath.Join(proj, ".claude", "skills", "empty", "README.md"), "not a skill")
	write(t, filepath.Join(proj, ".claude", "agents", "reviewer.md"), "---\ndescription: Reviews\n---\n")
	write(t, filepath.Join(proj, ".claude", "commands", "go.md"), "Run it")
	files, err := Scan(proj, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if got := count(files, GroupSkills); got != 3 {
		t.Fatalf("got %d skill rows, want 3", got)
	}
	for _, c := range []struct{ label, note, desc string }{
		{".claude/skills/deploy", "skill", "Ship it"},
		{".claude/agents/reviewer.md", "agent", "Reviews"},
		{".claude/commands/go.md", "command", ""},
	} {
		f, ok := find(files, GroupSkills, c.label)
		if !ok || !f.Exists || f.Note != c.note || f.Description != c.desc {
			t.Errorf("%s: got %+v, want note %q description %q", c.label, f, c.note, c.desc)
		}
	}
}

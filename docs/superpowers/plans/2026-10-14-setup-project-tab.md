# Setup → Project tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A fourth Setup tab, Project, that lists every file shaping a Claude Code agent in one registered project
(instructions, project memory, settings, skills/agents/commands, `.arc/setup`, two global files) and reads the selected
one in a rail.

**Architecture:** A pure Go package (`pkg/claudecontext`) stats and peeks the files; one wshrpc command returns them.
A pure TS model groups them; the store keeps project, result and selection in module atoms (Setup unmounts on a
surface switch); a new `projectcontexttab.tsx` renders projects | files | rail, the rail reading through `useFileText`.

**Tech Stack:** Go (yaml.v3, encoding/json), wshrpc + `task generate`, React 19 + jotai + Tailwind 4, vitest, CDP
scenario harness.

**Spec:** `docs/superpowers/specs/2026-10-14-setup-project-tab-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/claudecontext ./pkg/wshrpc/...`

**Final:** `node scripts/cdp/final-verify.mjs setup-project surface-smoke`

Conventions for every task: commit only the files the task names, with a pathspec
(`git add <paths> && git commit -m "..." -- <paths>`); no `Co-Authored-By` trailer; never `git push`. Check only the
files you touched with `gofmt -l` / `npx prettier --check` / `npx eslint`; never `--write` the tree.

---

### Task 1: `pkg/claudecontext` — scan a project's Claude files

**Depends on:** none

**Files:** `pkg/claudecontext/claudecontext.go`, `pkg/claudecontext/claudecontext_test.go`

Where:
- Create: `pkg/claudecontext/claudecontext.go`
- Test: `pkg/claudecontext/claudecontext_test.go`

**Step 1: Write the failing tests**

`pkg/claudecontext/claudecontext_test.go`:

```go
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
```

**Step 2: Run the tests to see them fail**

Run: `go test ./pkg/claudecontext`
Expected: FAIL to build — `undefined: Scan`, `File`, `GroupInstructions`…

**Step 3: Write the implementation**

`pkg/claudecontext/claudecontext.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package claudecontext lists the files that shape a Claude Code agent in one project: its instructions, its project
// memory, its settings, its skills, agents and commands, its .arc/setup, and the two global files that also apply.
// Read-only: it stats each file and peeks at frontmatter or JSON for a row's note; Setup → Project reads the files.
package claudecontext

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"gopkg.in/yaml.v3"
)

const (
	GroupInstructions = "instructions"
	GroupMemory       = "memory"
	GroupSettings     = "settings"
	GroupSkills       = "skills"
	GroupSetup        = "setup"
	GroupGlobal       = "global"
)

const (
	NoteReads       = "Claude reads this"
	NoteInvalidJSON = "invalid JSON"
)

// File is one row of the tab. A fixed file (an instructions candidate, a settings file) is listed whether or not it
// exists; a listed one (memory, skills) only when it does.
type File struct {
	Group       string
	Path        string // absolute
	Label       string // as the row shows it: relative to the project, ~/…, or the memory file's name
	Exists      bool
	Size        int64
	ModTs       int64 // epoch ms
	Note        string
	Description string
}

// Scan lists the files for the project at projectPath, with home as the user's home folder.
func Scan(projectPath, home string) ([]File, error) {
	if fi, err := os.Stat(projectPath); err != nil || !fi.IsDir() {
		return nil, fmt.Errorf("project folder not found: %s", projectPath)
	}
	var out []File
	out = append(out, instructions(projectPath)...)
	// one folder even where a drive letter's case splits the slug (d--… / D--…): Windows and macOS ignore case
	out = append(out, memory(filepath.Join(home, ".claude", "projects", agentobserve.SlugifyCwd(projectPath), "memory"))...)
	for _, rel := range []string{".claude/settings.json", ".claude/settings.local.json", ".mcp.json"} {
		out = append(out, withJSONNote(stat(GroupSettings, filepath.Join(projectPath, filepath.FromSlash(rel)), rel)))
	}
	out = append(out, skills(projectPath)...)
	out = append(out, stat(GroupSetup, filepath.Join(projectPath, ".arc", "setup"), ".arc/setup"))
	out = append(out, stat(GroupGlobal, filepath.Join(home, ".claude", "CLAUDE.md"), "~/.claude/CLAUDE.md"))
	out = append(out, withJSONNote(stat(GroupGlobal, filepath.Join(home, ".claude", "settings.json"), "~/.claude/settings.json")))
	return out, nil
}

func stat(group, path, label string) File {
	f := File{Group: group, Path: path, Label: label}
	if fi, err := os.Stat(path); err == nil && !fi.IsDir() {
		f.Exists = true
		f.Size = fi.Size()
		f.ModTs = fi.ModTime().UnixMilli()
	}
	return f
}

// Claude Code takes the first of CLAUDE.md, .claude/CLAUDE.md, AGENTS.md that exists as the project's instructions
// (instructionsfile.ts's order), and CLAUDE.local.md beside it whenever it exists.
func instructions(projectPath string) []File {
	rels := []string{"CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"}
	out := make([]File, 0, len(rels))
	marked := false
	for _, rel := range rels {
		f := stat(GroupInstructions, filepath.Join(projectPath, filepath.FromSlash(rel)), rel)
		if f.Exists && rel == "CLAUDE.local.md" {
			f.Note = NoteReads
		} else if f.Exists && !marked {
			f.Note = NoteReads
			marked = true
		}
		out = append(out, f)
	}
	return out
}

func memory(dir string) []File {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []File
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".md") {
			continue
		}
		f := stat(GroupMemory, filepath.Join(dir, e.Name()), e.Name())
		if e.Name() == "MEMORY.md" {
			f.Note = "index"
		} else {
			fm := readFrontmatter(f.Path)
			f.Note = fm.kind()
			f.Description = fm.Description
		}
		out = append(out, f)
	}
	return out
}

func skills(projectPath string) []File {
	var out []File
	found, _ := filepath.Glob(filepath.Join(projectPath, ".claude", "skills", "*", "SKILL.md"))
	for _, p := range found {
		f := stat(GroupSkills, p, ".claude/skills/"+filepath.Base(filepath.Dir(p)))
		f.Note = "skill"
		f.Description = readFrontmatter(p).Description
		out = append(out, f)
	}
	for _, sub := range []string{"agents", "commands"} {
		found, _ := filepath.Glob(filepath.Join(projectPath, ".claude", sub, "*.md"))
		for _, p := range found {
			f := stat(GroupSkills, p, ".claude/"+sub+"/"+filepath.Base(p))
			f.Note = strings.TrimSuffix(sub, "s")
			f.Description = readFrontmatter(p).Description
			out = append(out, f)
		}
	}
	return out
}

// memory files carry their type at the top level or under metadata:, as the two memory formats write it
type frontmatter struct {
	Type        string `yaml:"type"`
	Description string `yaml:"description"`
	Metadata    struct {
		Type string `yaml:"type"`
	} `yaml:"metadata"`
}

func (fm frontmatter) kind() string {
	if fm.Type != "" {
		return fm.Type
	}
	return fm.Metadata.Type
}

// readFrontmatter reads the YAML block a file opens with; no block, or one that does not parse, reads as empty
func readFrontmatter(path string) frontmatter {
	var fm frontmatter
	data, err := os.ReadFile(path)
	if err != nil {
		return fm
	}
	text := strings.ReplaceAll(string(data), "\r\n", "\n")
	if !strings.HasPrefix(text, "---\n") {
		return fm
	}
	end := strings.Index(text[4:], "\n---")
	if end < 0 {
		return fm
	}
	_ = yaml.Unmarshal([]byte(text[4:4+end]), &fm)
	return fm
}

// withJSONNote notes a settings file's hook count, or .mcp.json's server count; a file that is not JSON says so
func withJSONNote(f File) File {
	if !f.Exists {
		return f
	}
	data, err := os.ReadFile(f.Path)
	if err != nil {
		return f
	}
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	if !json.Valid(data) {
		f.Note = NoteInvalidJSON
		return f
	}
	var doc struct {
		Hooks map[string][]struct {
			Hooks []json.RawMessage `json:"hooks"`
		} `json:"hooks"`
		MCPServers map[string]json.RawMessage `json:"mcpServers"`
	}
	// a field of an unexpected shape leaves the rest decoded, which is all a note needs
	_ = json.Unmarshal(data, &doc)
	hooks := 0
	for _, entries := range doc.Hooks {
		for _, e := range entries {
			hooks += len(e.Hooks)
		}
	}
	switch {
	case hooks > 0:
		f.Note = plural(hooks, "hook")
	case len(doc.MCPServers) > 0:
		f.Note = plural(len(doc.MCPServers), "MCP server")
	}
	return f
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("1 %s", word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}
```

**Step 4: Run the tests to see them pass**

Run: `go test ./pkg/claudecontext`
Expected: `ok  	github.com/wavetermdev/waveterm/pkg/claudecontext`

Run: `gofmt -l pkg/claudecontext`
Expected: no output.

**Step 5: Commit**

```bash
git add pkg/claudecontext/claudecontext.go pkg/claudecontext/claudecontext_test.go
git commit -m "feat(claudecontext): list the Claude files that shape one project" -- pkg/claudecontext/claudecontext.go pkg/claudecontext/claudecontext_test.go
```

---

### Task 2: `ClaudeContextCommand` RPC

**Depends on:** Task 1

**Files:** `pkg/wshrpc/wshrpctypes_agentsync.go`, `pkg/wshrpc/wshserver/wshserver_agentsync.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

Where:
- Modify: `pkg/wshrpc/wshrpctypes_agentsync.go` (interface at the top; types at the end)
- Modify: `pkg/wshrpc/wshserver/wshserver_agentsync.go` (handler after `AgentSyncSkillsCommand`)
- Regenerated by `task generate` (never hand-edit): `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`,
  `pkg/wshrpc/wshclient/wshclient.go`

**Step 1: Add the command and its types**

In `pkg/wshrpc/wshrpctypes_agentsync.go`, add as the last line of `AgentSyncCommands`:

```go
	ClaudeContextCommand(ctx context.Context, data CommandClaudeContextData) (*CommandClaudeContextRtnData, error)
```

and at the end of the file:

```go
type CommandClaudeContextData struct {
	Path string `json:"path"`
}

// ClaudeContextFile is one row of Setup → Project (pkg/claudecontext.File).
type ClaudeContextFile struct {
	Group       string `json:"group"` // instructions | memory | settings | skills | setup | global
	Path        string `json:"path"`
	Label       string `json:"label"`
	Exists      bool   `json:"exists"`
	Size        int64  `json:"size,omitempty"`
	ModTs       int64  `json:"modts,omitempty"`
	Note        string `json:"note,omitempty"`
	Description string `json:"description,omitempty"`
}

type CommandClaudeContextRtnData struct {
	Files []ClaudeContextFile `json:"files"`
}
```

**Step 2: Add the handler**

In `pkg/wshrpc/wshserver/wshserver_agentsync.go`, add `"github.com/wavetermdev/waveterm/pkg/claudecontext"` and
`"github.com/wavetermdev/waveterm/pkg/wavebase"` to the imports (skip one already there), and after
`AgentSyncSkillsCommand`:

```go
func (ws *WshServer) ClaudeContextCommand(ctx context.Context, data wshrpc.CommandClaudeContextData) (*wshrpc.CommandClaudeContextRtnData, error) {
	files, err := claudecontext.Scan(data.Path, wavebase.GetHomeDir())
	if err != nil {
		return nil, err
	}
	out := make([]wshrpc.ClaudeContextFile, len(files))
	for i, f := range files {
		out[i] = wshrpc.ClaudeContextFile{
			Group: f.Group, Path: f.Path, Label: f.Label, Exists: f.Exists, Size: f.Size, ModTs: f.ModTs,
			Note: f.Note, Description: f.Description,
		}
	}
	return &wshrpc.CommandClaudeContextRtnData{Files: out}, nil
}
```

**Step 3: Regenerate the bindings**

Run: `task generate`
Expected: exits 0. Then `git diff --stat` shows `wshclientapi.ts`, `gotypes.d.ts`, `wshclient.go` changed, and
`grep -n "ClaudeContextCommand" frontend/app/store/wshclientapi.ts` finds the method calling `"claudecontext"`.

**Step 4: Check it builds**

Run: `go vet ./pkg/wshrpc/... ./pkg/claudecontext`
Expected: no output, exit 0. (A type elsewhere that implements the whole RPC interface would fail here; add the
method to it the same way if one does.)

Run: `gofmt -l pkg/wshrpc/wshrpctypes_agentsync.go pkg/wshrpc/wshserver/wshserver_agentsync.go`
Expected: no output.

**Step 5: Commit**

```bash
P="pkg/wshrpc/wshrpctypes_agentsync.go pkg/wshrpc/wshserver/wshserver_agentsync.go frontend/app/store/wshclientapi.ts frontend/types/gotypes.d.ts pkg/wshrpc/wshclient/wshclient.go"
git add $P && git commit -m "feat(wshrpc): ClaudeContextCommand answers a project's Claude files" -- $P
```

Commit every file `task generate` changed, and only those plus the two edited files; if it touched others, list
them in `P`.

---

### Task 3: The pure model — groups, defaults, file kind

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/claudecontextmodel.ts`, `frontend/app/view/agents/claudecontextmodel.test.ts`

Where:
- Create: `frontend/app/view/agents/claudecontextmodel.ts`
- Test: `frontend/app/view/agents/claudecontextmodel.test.ts`

**Step 1: Write the failing tests**

`frontend/app/view/agents/claudecontextmodel.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { contextFileKind, contextGroups, contextProject, contextSelection } from "./claudecontextmodel";

const f = (group: string, label: string, extra: Partial<ClaudeContextFile> = {}): ClaudeContextFile => ({
    group,
    label,
    path: `/p/${label}`,
    exists: true,
    ...extra,
});

describe("contextGroups", () => {
    it("lists the six groups in order, empty ones with no sections", () => {
        const groups = contextGroups([f("instructions", "CLAUDE.md")]);
        expect(groups.map((g) => g.key)).toEqual(["instructions", "memory", "settings", "skills", "setup", "global"]);
        expect(groups[1].sections).toEqual([]);
    });

    it("keeps the backend's order outside memory and counts only files that exist", () => {
        const groups = contextGroups([
            f("settings", ".claude/settings.json"),
            f("settings", ".claude/settings.local.json", { exists: false }),
            f("settings", ".mcp.json"),
        ]);
        const settings = groups.find((g) => g.key === "settings")!;
        expect(settings.sections[0].rows.map((r) => r.label)).toEqual([
            ".claude/settings.json",
            ".claude/settings.local.json",
            ".mcp.json",
        ]);
        expect(settings.count).toBe(2);
    });

    it("puts MEMORY.md first, then memory by type in a fixed order, untyped last", () => {
        const groups = contextGroups([
            f("memory", "z.md", { note: "user" }),
            f("memory", "b.md", { note: "feedback" }),
            f("memory", "MEMORY.md", { note: "index" }),
            f("memory", "a.md", { note: "feedback" }),
            f("memory", "odd.md"),
        ]);
        const memory = groups.find((g) => g.key === "memory")!;
        expect(memory.sections.map((s) => [s.head, s.rows.map((r) => r.label)])).toEqual([
            [null, ["MEMORY.md"]],
            ["user", ["z.md"]],
            ["feedback", ["a.md", "b.md"]],
            ["other", ["odd.md"]],
        ]);
    });
});

describe("contextProject", () => {
    const projects = [{ name: "alpha" }, { name: "beta" }];
    it("keeps the chosen project while it is registered", () => {
        expect(contextProject(projects, "beta", "alpha")).toBe("beta");
    });
    it("falls back to the app bar's filter, then the first project", () => {
        expect(contextProject(projects, "gone", "beta")).toBe("beta");
        expect(contextProject(projects, null, "all")).toBe("alpha");
    });
    it("is null with no projects", () => {
        expect(contextProject([], null, "all")).toBeNull();
    });
});

describe("contextSelection", () => {
    const groups = contextGroups([
        f("instructions", "CLAUDE.md", { exists: false }),
        f("instructions", "AGENTS.md"),
        f("memory", "MEMORY.md", { note: "index" }),
    ]);
    it("keeps a selection that is still listed", () => {
        expect(contextSelection(groups, "/p/MEMORY.md")).toBe("/p/MEMORY.md");
    });
    it("falls back to the first file that exists", () => {
        expect(contextSelection(groups, "/p/gone.md")).toBe("/p/AGENTS.md");
        expect(contextSelection(groups, null)).toBe("/p/AGENTS.md");
    });
    it("never selects a missing file", () => {
        expect(contextSelection(groups, "/p/CLAUDE.md")).toBe("/p/AGENTS.md");
    });
});

describe("contextFileKind", () => {
    it("reads markdown, JSON, and the rest as text", () => {
        expect(contextFileKind("C:\\p\\CLAUDE.MD")).toBe("markdown");
        expect(contextFileKind("/p/.mcp.json")).toBe("json");
        expect(contextFileKind("/p/.arc/setup")).toBe("text");
    });
});
```

**Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/claudecontextmodel.test.ts`
Expected: FAIL — cannot resolve `./claudecontextmodel`.

**Step 3: Write the model**

`frontend/app/view/agents/claudecontextmodel.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setup → Project's list: the files ClaudeContextCommand returns for a project (pkg/claudecontext), grouped and
// ordered for the tab. Memory splits by its frontmatter type; a group with nothing in it keeps its heading and reads
// as empty, so a missing file shows as missing rather than forgotten.

export type ContextGroupKey = "instructions" | "memory" | "settings" | "skills" | "setup" | "global";

export const CONTEXT_GROUPS: { key: ContextGroupKey; label: string }[] = [
    { key: "instructions", label: "Instructions" },
    { key: "memory", label: "Memory" },
    { key: "settings", label: "Settings" },
    { key: "skills", label: "Skills & agents" },
    { key: "setup", label: "Setup" },
    { key: "global", label: "Global" },
];

// the memory types in the order the tab lists them; a file of another type, or none, goes under "other"
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"];

const MEMORY_INDEX = "MEMORY.md";

export interface ContextSection {
    head: string | null;
    rows: ClaudeContextFile[];
}

export interface ContextGroup {
    key: ContextGroupKey;
    label: string;
    count: number; // the files that exist
    sections: ContextSection[];
}

const byLabel = (a: ClaudeContextFile, b: ClaudeContextFile) => a.label.localeCompare(b.label);

function memorySections(rows: ClaudeContextFile[]): ContextSection[] {
    const index = rows.filter((r) => r.label === MEMORY_INDEX);
    const rest = rows.filter((r) => r.label !== MEMORY_INDEX);
    const sections: ContextSection[] = index.length > 0 ? [{ head: null, rows: index }] : [];
    for (const type of MEMORY_TYPES) {
        const typed = rest.filter((r) => r.note === type).sort(byLabel);
        if (typed.length > 0) {
            sections.push({ head: type, rows: typed });
        }
    }
    const other = rest.filter((r) => !MEMORY_TYPES.includes(r.note ?? "")).sort(byLabel);
    if (other.length > 0) {
        sections.push({ head: "other", rows: other });
    }
    return sections;
}

// Outside memory the backend's order stands: it is the order Claude looks in.
export function contextGroups(files: ClaudeContextFile[]): ContextGroup[] {
    return CONTEXT_GROUPS.map(({ key, label }) => {
        const rows = files.filter((f) => f.group === key);
        const sections = key === "memory" ? memorySections(rows) : rows.length > 0 ? [{ head: null, rows }] : [];
        return { key, label, count: rows.filter((r) => r.exists).length, sections };
    });
}

// The project the tab shows: the one chosen while it is still registered, else the app bar's filter, else the first.
export function contextProject(projects: { name: string }[], current: string | null, filter: string): string | null {
    const listed = (name: string | null) => name != null && projects.some((p) => p.name === name);
    if (listed(current)) {
        return current;
    }
    if (listed(filter)) {
        return filter;
    }
    return projects[0]?.name ?? null;
}

// The file the rail reads: the selection while it is listed and exists, else the first file that exists.
export function contextSelection(groups: ContextGroup[], selected: string | null): string | null {
    const rows = groups.flatMap((g) => g.sections.flatMap((s) => s.rows)).filter((r) => r.exists);
    if (selected != null && rows.some((r) => r.path === selected)) {
        return selected;
    }
    return rows[0]?.path ?? null;
}

export type ContextFileKind = "markdown" | "json" | "text";

export function contextFileKind(path: string): ContextFileKind {
    const p = path.toLowerCase();
    if (p.endsWith(".md")) {
        return "markdown";
    }
    if (p.endsWith(".json")) {
        return "json";
    }
    return "text";
}
```

**Step 4: Run them to see them pass**

Run: `npx vitest run frontend/app/view/agents/claudecontextmodel.test.ts`
Expected: all tests PASS.

Run: `npx prettier --check frontend/app/view/agents/claudecontextmodel.ts frontend/app/view/agents/claudecontextmodel.test.ts`
and `npx eslint frontend/app/view/agents/claudecontextmodel.ts frontend/app/view/agents/claudecontextmodel.test.ts`
Expected: clean.

**Step 5: Commit**

```bash
P="frontend/app/view/agents/claudecontextmodel.ts frontend/app/view/agents/claudecontextmodel.test.ts"
git add $P && git commit -m "feat(setup): model for the Project tab's grouped file list" -- $P
```

---

### Task 4: Store, the Project tab, and its rail

**Depends on:** Task 3

**Files:** `frontend/app/view/agents/setupstyles.ts`, `frontend/app/view/agents/projectcontexttab.tsx`, `frontend/app/view/agents/setupstore.ts`, `frontend/app/view/agents/setupsurface.tsx`

Where:
- Create: `frontend/app/view/agents/setupstyles.ts`
- Create: `frontend/app/view/agents/projectcontexttab.tsx`
- Modify: `frontend/app/view/agents/setupstore.ts` (`SetupTab`; a new `// ---- project ----` section before `// ---- tools ----`)
- Modify: `frontend/app/view/agents/setupsurface.tsx` (shared styles move out; `TABS`; header and body switch)

**Step 1: Move the shared styles out of `setupsurface.tsx`**

`projectcontexttab.tsx` needs `SECTION_HEAD`, `BTN_SECONDARY` and `FADE_IN`, and `setupsurface.tsx` will import the
tab, so the constants move to a leaf module instead of being exported from the surface (which would make an import
cycle).

`frontend/app/view/agents/setupstyles.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Class strings and motion the Setup tabs share (setupsurface.tsx, projectcontexttab.tsx).

import { MOTION } from "@/app/element/motiontokens";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";

export const SECTION_HEAD = cn(REGION_LABEL, "text-muted");
export const BTN_SECONDARY =
    "h-[30px] cursor-pointer rounded border border-edge-mid bg-surface-raised px-3 text-[12.5px] font-semibold text-ink-mid hover:border-edge-strong hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:text-ink-faint disabled:hover:border-edge-mid disabled:hover:bg-surface-raised";

// a swapped tab or skill fades in rather than cutting; the outgoing one leaves at once, so a quick run of
// arrow keys through the skill list never queues exits
export const FADE_IN = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: MOTION.durMicro, ease: MOTION.easeFluid },
};
```

In `setupsurface.tsx`: delete the local `SECTION_HEAD`, `BTN_SECONDARY` and `FADE_IN` (and `FADE_IN`'s comment), add
`import { BTN_SECONDARY, FADE_IN, SECTION_HEAD } from "./setupstyles";`, and drop `REGION_LABEL` / `MOTION` from the
imports if nothing else in the file uses them (grep first).

**Step 2: Add the store**

In `setupstore.ts`, change the tab type:

```ts
export type SetupTab = "instructions" | "skills" | "tools" | "project";
```

and add before `// ---- tools ----`:

```ts
// ---- project ----

// the project Setup → Project shows (null: contextProject picks), what was read for it, and the file the rail reads
export interface ClaudeContextLoad {
    project: string;
    path: string;
    files: ClaudeContextFile[];
    error: string | null;
}
export const setupContextProjectAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const setupContextAtom = atom<ClaudeContextLoad | null>(null) as PrimitiveAtom<ClaudeContextLoad | null>;
export const setupContextSelectedAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export async function loadClaudeContext(project: string, path: string): Promise<void> {
    try {
        const r = await RpcApi.ClaudeContextCommand(TabRpcClient, { path }, { timeout: READ_TIMEOUT_MS });
        globalStore.set(setupContextAtom, { project, path, files: r.files ?? [], error: null });
    } catch (e) {
        globalStore.set(setupContextAtom, { project, path, files: [], error: errText(e) });
    }
}

// re-reads the project on screen: an agent may have written memory or settings since
export function reloadClaudeContext(): Promise<void> {
    const cur = globalStore.get(setupContextAtom);
    return cur == null ? Promise.resolve() : loadClaudeContext(cur.project, cur.path);
}

export function selectContextProject(name: string): void {
    globalStore.set(setupContextProjectAtom, name);
    globalStore.set(setupContextSelectedAtom, null);
}

export function selectContextFile(path: string): void {
    globalStore.set(setupContextSelectedAtom, path);
}
```

**Step 3: Write the tab**

`frontend/app/view/agents/projectcontexttab.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Setup → Project: every file that shapes a Claude Code agent in one registered project (ClaudeContextCommand),
// grouped, with the selected one read in the rail. Read-only: nothing here writes a file. The model is
// claudecontextmodel.ts, the state setupstore.ts.

import { Markdown } from "@/app/element/markdown";
import { splitFrontmatter } from "@/app/view/code/codefrontmatter";
import { FrontmatterCard } from "@/app/view/code/frontmattercard";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { RotateCw } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, useEffect, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgo } from "./agentsviewmodel";
import {
    contextFileKind,
    contextGroups,
    contextProject,
    contextSelection,
    type ContextGroup,
} from "./claudecontextmodel";
import { projectListAtom } from "./projectsstore";
import {
    loadClaudeContext,
    reloadClaudeContext,
    selectContextFile,
    selectContextProject,
    setupContextAtom,
    setupContextProjectAtom,
    setupContextSelectedAtom,
} from "./setupstore";
import { BTN_SECONDARY, FADE_IN, SECTION_HEAD } from "./setupstyles";
import { useFileText } from "./usefiletext";

export function ProjectContextHeader() {
    const data = useAtomValue(setupContextAtom);
    return (
        <button
            type="button"
            aria-label="Read the files again"
            title="Read the files again"
            disabled={data == null}
            onClick={() => fireAndForget(reloadClaudeContext)}
            className={cn(BTN_SECONDARY, "flex items-center gap-1.5")}
        >
            <RotateCw size={13} />
            Reload
        </button>
    );
}

function ProjectColumn({ projects, current }: { projects: { name: string; path: string }[]; current: string | null }) {
    return (
        <aside
            aria-label="Projects"
            className="flex w-[220px] flex-none flex-col gap-0.5 overflow-y-auto border-r border-border bg-surface px-2.5 py-3.5"
        >
            <div className={cn(SECTION_HEAD, "px-2.5 pb-1.5")}>Projects</div>
            {projects.map((p) => (
                <button
                    key={p.name}
                    type="button"
                    data-context-project={p.name}
                    aria-current={p.name === current || undefined}
                    onClick={() => selectContextProject(p.name)}
                    className={cn(
                        "flex w-full cursor-pointer flex-col gap-0.5 rounded border-0 px-2.5 py-[7px] text-left",
                        p.name === current ? "bg-surface-selected" : "bg-transparent hover:bg-surface-hover"
                    )}
                >
                    <span className="truncate text-[12.5px] font-medium text-primary">{p.name}</span>
                    <span className="truncate text-[10.5px] text-muted">{p.path}</span>
                </button>
            ))}
        </aside>
    );
}

function ContextRow({ row, selected, showNote }: { row: ClaudeContextFile; selected: boolean; showNote: boolean }) {
    if (!row.exists) {
        return (
            <div
                data-context-missing={row.label}
                className="flex items-center gap-2 px-2.5 py-[7px] text-[12.5px] text-ink-faint"
            >
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="ml-auto flex-none">—</span>
            </div>
        );
    }
    return (
        <button
            type="button"
            data-context-file={row.path}
            aria-current={selected || undefined}
            onClick={() => selectContextFile(row.path)}
            className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded border-0 px-2.5 py-[7px] text-left text-[12.5px]",
                selected ? "bg-surface-selected text-primary" : "bg-transparent text-secondary hover:bg-surface-hover"
            )}
        >
            <span className="min-w-0 truncate">{row.label}</span>
            {showNote && row.note ? (
                <span data-context-note className="flex-none text-[11px] text-muted">
                    {row.note}
                </span>
            ) : null}
            <span className="ml-auto flex-none text-[11px] text-muted">
                {row.modts ? formatAgo(Date.now() - row.modts) : ""}
            </span>
        </button>
    );
}

// Global starts folded: those files apply to every project, and the tab is about this one.
function ContextGroupView({ group, selected }: { group: ContextGroup; selected: string | null }) {
    const [open, setOpen] = useState(group.key !== "global");
    return (
        <section data-context-group={group.key} className="flex flex-col gap-0.5">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="flex cursor-pointer items-center gap-2 border-0 bg-transparent px-2.5 pb-1 pt-2.5 text-left"
            >
                <span className={SECTION_HEAD}>{group.label}</span>
                <span className="text-[11px] text-muted">{group.count}</span>
            </button>
            {!open ? null : group.sections.length === 0 ? (
                <div data-context-empty className="px-2.5 py-[7px] text-[12.5px] text-ink-faint">
                    —
                </div>
            ) : (
                group.sections.map((s) => (
                    <Fragment key={s.head ?? ""}>
                        {s.head != null ? <div className="px-2.5 pt-1.5 text-[11px] text-muted">{s.head}</div> : null}
                        {s.rows.map((r) => (
                            <ContextRow
                                key={r.path}
                                row={r}
                                selected={r.path === selected}
                                showNote={group.key !== "memory"}
                            />
                        ))}
                    </Fragment>
                ))
            )}
        </section>
    );
}

function ContextRail({ row }: { row: ClaudeContextFile }) {
    const [file] = useFileText(row.path);
    const doc = file.status === "ok" && contextFileKind(row.path) === "markdown" ? splitFrontmatter(file.text) : null;
    return (
        <motion.aside
            key={row.path}
            {...FADE_IN}
            aria-label="File"
            data-context-rail={row.path}
            className="flex w-[440px] flex-none flex-col border-l border-border bg-surface"
        >
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
                <div className="flex flex-col gap-1.5">
                    <div className="text-[14px] font-medium text-primary">{row.label}</div>
                    {row.description ? (
                        <div className="text-[13px] leading-[1.5] text-secondary">{row.description}</div>
                    ) : null}
                    <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 break-all text-[11px] text-muted">{row.path}</div>
                        <button
                            type="button"
                            data-context-copy
                            onClick={() => fireAndForget(() => navigator.clipboard.writeText(row.path))}
                            className={cn(BTN_SECONDARY, "flex-none")}
                        >
                            Copy path
                        </button>
                    </div>
                </div>
                {file.status === "loading" ? (
                    <div className="text-[12.5px] text-muted">Reading…</div>
                ) : file.status === "error" ? (
                    <div className="text-[12.5px] text-muted">Empty, or could not be read.</div>
                ) : doc != null ? (
                    <Markdown
                        text={doc.body}
                        header={doc.fields.length > 0 ? <FrontmatterCard fields={doc.fields} /> : null}
                        scrollable={false}
                        className="markdown-doc markdown-rail"
                        contentClassName="p-0"
                        fontSizeOverride={14}
                        resolveOpts={{ connName: "local", baseDir: row.path.replace(/[\\/][^\\/]*$/, "") }}
                    />
                ) : (
                    <pre className="m-0 whitespace-pre-wrap break-all font-mono text-[12px] leading-[1.5] text-secondary">
                        {file.text}
                    </pre>
                )}
            </div>
        </motion.aside>
    );
}

export function ProjectContextTab({ model }: { model: AgentsViewModel }) {
    const projects = useAtomValue(projectListAtom);
    const filter = useAtomValue(model.projectFilterAtom);
    const chosen = useAtomValue(setupContextProjectAtom);
    const data = useAtomValue(setupContextAtom);
    const selectedPath = useAtomValue(setupContextSelectedAtom);
    const name = contextProject(projects, chosen, filter);
    const project = projects.find((p) => p.name === name) ?? null;
    // re-read on every visit and project change: an agent may have written memory or settings since
    useEffect(() => {
        if (project != null) {
            fireAndForget(() => loadClaudeContext(project.name, project.path));
        }
    }, [project?.name, project?.path]);
    if (projects.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
                No projects yet. Add one from the project switcher in the app bar.
            </div>
        );
    }
    const loaded = data != null && data.project === name ? data : null;
    const groups = loaded == null || loaded.error != null ? null : contextGroups(loaded.files);
    const selected = groups == null ? null : contextSelection(groups, selectedPath);
    const row = groups?.flatMap((g) => g.sections.flatMap((s) => s.rows)).find((r) => r.path === selected) ?? null;
    return (
        <div className="flex min-h-0 flex-1" data-context-tab>
            <ProjectColumn projects={projects} current={name} />
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-2.5 pb-4 pt-1">
                {loaded == null ? (
                    <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Reading…</div>
                ) : loaded.error != null ? (
                    <div role="alert" className="m-2.5 rounded border border-error/30 bg-error/10 px-3 py-2 text-[12.5px] text-error-soft">
                        {loaded.error}
                    </div>
                ) : (
                    groups!.map((g) => <ContextGroupView key={g.key} group={g} selected={selected} />)
                )}
            </div>
            {row != null ? <ContextRail row={row} /> : null}
        </div>
    );
}
```

**Step 4: Wire it into the surface**

In `setupsurface.tsx`:

- `TABS` gains `{ key: "project", label: "Project" }` as its last entry.
- Import `{ ProjectContextHeader, ProjectContextTab } from "./projectcontexttab"`.
- Replace the header ternary with:

```tsx
                    {tab === "instructions" ? (
                        <HeaderStatus />
                    ) : tab === "skills" ? (
                        <SkillsHeader />
                    ) : tab === "tools" ? (
                        <ToolsHeader />
                    ) : (
                        <ProjectContextHeader />
                    )}
```

- Replace the body ternary's last branch the same way: `tab === "tools" ? <ToolsLibrary model={model} /> : <ProjectContextTab model={model} />`.
- Update the file's top comment to name the Project tab: "The Project tab lists the Claude files of one project
  (projectcontexttab.tsx)."

**Step 5: Typecheck, test, lint**

Run: `task check:ts` (about 2 minutes; give it a 5-minute timeout)
Expected: exit 0.

Run: `npx vitest run frontend/app/view/agents/`
Expected: PASS (setup and claudecontext tests included).

Run: `npx prettier --check` and `npx eslint` on `setupstyles.ts`, `projectcontexttab.tsx`, `setupstore.ts`,
`setupsurface.tsx` under `frontend/app/view/agents/`.
Expected: clean. (If `setupsurface.tsx` was not prettier-clean at HEAD, only the lines you changed need to be.)

**Step 6: Try it in the dev app**

If a dev app is running (`task dev`), open Setup → Project (`g .`, then the Project tab), pick arcterm, select a
memory file, and take `node scripts/cdp-shot.mjs cdp-shots/setup-project-manual.png`. If no dev app is running, do
not start one for this: Final runs Task 5's `setup-project` scenario, whose steps show each part of this tab:

| What this task builds | `setup-project` step |
|---|---|
| The project column, the six groups, the "Claude reads this" and hook-count notes, a missing file's row | 1 |
| A memory file read in the rail, with its frontmatter description | 2 |
| An empty group's "—" row (Skills & agents) | 3 |
| Global folded, opened by a click on its heading | 4 |
| A settings file that does not parse: the row's "invalid JSON" note, the raw text in the rail | 5 |
| An empty file: the rail's "Empty, or could not be read." line | 6 |
| Copy path in the rail head | 7 |
| Reload re-reads the project (a memory file added since shows) | 8 |
| The project's folder gone: the alert banner, no list | 9 |

The "No projects yet" state goes unverified: staging it would mean removing every registered project from the dev
app.

**Step 7: Commit**

```bash
P="frontend/app/view/agents/setupstyles.ts frontend/app/view/agents/projectcontexttab.tsx frontend/app/view/agents/setupstore.ts frontend/app/view/agents/setupsurface.tsx"
git add $P && git commit -m "feat(setup): Project tab lists a project's Claude files and reads one in the rail" -- $P
```

---

### Task 5: CDP scenario `setup-project` and the CHANGELOG line

**Depends on:** Task 4

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

Where:
- Modify: `scripts/cdp/scenarios.mjs` (a new scenario after `toolsWorktreeGone`'s definition; register it in the
  exported list after `toolsWorktreeGone`)
- Modify: `CHANGELOG.md` (top `## Unreleased` → `### Added`)

**Step 1: Write the scenario**

`scenarios.mjs` already imports `mkdtempSync`, `mkdirSync`, `writeFileSync`, `rmSync`, `homedir`, `tmpdir` and `join`.
`polishWaitFor`, `polishNap`, `waitForProjectInConfig`, `ttClick`, `notesClipStub` and `NOTES_CLIP_RESTORE` are defined
earlier in the file.

```js
// --- setup-project: Setup → Project lists a project's Claude files in six groups and reads the selected one in the
// rail. The fixture is a temp project with a CLAUDE.md, a settings.json holding one hook, a settings.local.json that
// does not parse and an empty .arc/setup, and a memory folder under ~/.claude/projects/<slug> holding an index and
// one feedback memory; teardown removes the project, its folder and the memory folder. The last step deletes the
// project's folder to show the path-gone banner, so it runs last.
const SP_PROJECT = "verify-setup-project";
const spSlug = (p) => p.replace(/[^A-Za-z0-9]/g, "-");
const setupProject = {
    name: "setup-project",
    surface: "setup",
    async arrange(h) {
        const ctx = {};
        try {
            ctx.root = mkdtempSync(join(tmpdir(), "verify-sp-"));
            writeFileSync(join(ctx.root, "CLAUDE.md"), "# Fixture project\n\nRead me first.\n");
            mkdirSync(join(ctx.root, ".claude"), { recursive: true });
            writeFileSync(
                join(ctx.root, ".claude", "settings.json"),
                JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] } })
            );
            writeFileSync(join(ctx.root, ".claude", "settings.local.json"), '{ "hooks": not json');
            mkdirSync(join(ctx.root, ".arc"), { recursive: true });
            writeFileSync(join(ctx.root, ".arc", "setup"), "");
            ctx.memProject = join(homedir(), ".claude", "projects", spSlug(ctx.root));
            const mem = join(ctx.memProject, "memory");
            mkdirSync(mem, { recursive: true });
            writeFileSync(join(mem, "MEMORY.md"), "- [Fixture rule](feedback_fixture.md) — the fixture's one rule\n");
            writeFileSync(
                join(mem, "feedback_fixture.md"),
                "---\nname: fixture-rule\ndescription: The fixture's one rule\nmetadata:\n  type: feedback\n---\n\nFixture rule body.\n"
            );
            await h.rpc("createproject", { name: SP_PROJECT, path: ctx.root });
            ctx.projectMade = true;
            await waitForProjectInConfig(h, SP_PROJECT);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        rec("0. the fixture project, its files and its memory are arranged", ctx.arrangeError == null, ctx.arrangeError ?? "");
        if (ctx.arrangeError != null) return steps;

        await h.goto("setup");
        await ttClick(h, '[data-setup-tab="project"]');
        const listed = await polishWaitFor(h, `!!document.querySelector('[data-context-project="${SP_PROJECT}"]')`, 8000);
        await ttClick(h, `[data-context-project="${SP_PROJECT}"]`);
        const loaded = await polishWaitFor(h, `!!document.querySelector('[data-context-group="memory"] [data-context-file]')`, 8000);
        const list = await h.ev(`(() => {
            const note = (label) => {
                const b = [...document.querySelectorAll("[data-context-file]")].find((x) => x.textContent.includes(label));
                return b?.querySelector("[data-context-note]")?.textContent ?? null;
            };
            return {
                groups: [...document.querySelectorAll("[data-context-group]")].map((g) => g.getAttribute("data-context-group")),
                claudeMd: note("CLAUDE.md"),
                settings: note(".claude/settings.json"),
                missing: !!document.querySelector('[data-context-missing="AGENTS.md"]'),
            };
        })()`);
        rec(
            "1. Setup → Project lists the fixture project's six groups; CLAUDE.md is the one Claude reads, settings.json notes its hook, AGENTS.md shows as missing",
            listed &&
                loaded &&
                JSON.stringify(list.groups) === JSON.stringify(["instructions", "memory", "settings", "skills", "setup", "global"]) &&
                list.claudeMd === "Claude reads this" &&
                list.settings === "1 hook" &&
                list.missing,
            JSON.stringify({ listed, loaded, ...list })
        );

        await h.ev(`[...document.querySelectorAll("[data-context-file]")].find((b) => b.textContent.includes("feedback_fixture.md"))?.click()`);
        const read = await polishWaitFor(
            h,
            `(document.querySelector("[data-context-rail]")?.textContent ?? "").includes("Fixture rule body.")`,
            5000
        );
        await polishNap(300);
        await h.shot("cdp-shots/setup-project-1-memory.png");
        const rail = await h.ev(`document.querySelector("[data-context-rail]")?.textContent?.slice(0, 200) ?? null`);
        rec("2. selecting the feedback memory reads it in the rail with its description", read && rail.includes("The fixture's one rule"), rail);

        // a row by its label, clicked; the rail's text once it holds `want`
        const clickRow = (label) =>
            h.ev(`(() => { const b = [...document.querySelectorAll("[data-context-file]")].find((x) => x.textContent.includes(${JSON.stringify(label)})); b?.click(); return !!b; })()`);
        const railHas = (want) =>
            polishWaitFor(h, `(document.querySelector("[data-context-rail]")?.textContent ?? "").includes(${JSON.stringify(want)})`, 5000);

        const skills = await h.ev(`(() => {
            const g = document.querySelector('[data-context-group="skills"]');
            return { empty: g?.querySelector("[data-context-empty]")?.textContent?.trim() ?? null, files: g?.querySelectorAll("[data-context-file]").length ?? -1 };
        })()`);
        rec('3. Skills & agents, empty in the fixture, shows one "—" row', skills.empty === "—" && skills.files === 0, JSON.stringify(skills));

        const globalRows = `[...document.querySelectorAll('[data-context-group="global"] [data-context-file], [data-context-group="global"] [data-context-missing]')].map((r) => r.textContent)`;
        const folded = await h.ev(`${globalRows}.length`);
        await h.ev(`document.querySelector('[data-context-group="global"] button[aria-expanded]')?.click()`);
        const opened = await polishWaitFor(h, `${globalRows}.length === 2`, 3000);
        const global = await h.ev(globalRows);
        rec(
            "4. Global starts folded; a click on its heading shows ~/.claude/CLAUDE.md and ~/.claude/settings.json",
            folded === 0 && opened && global.some((t) => t.includes("~/.claude/CLAUDE.md")) && global.some((t) => t.includes("~/.claude/settings.json")),
            JSON.stringify({ folded, global })
        );

        const badNote = await h.ev(`[...document.querySelectorAll("[data-context-file]")].find((b) => b.textContent.includes("settings.local.json"))?.querySelector("[data-context-note]")?.textContent ?? null`);
        const badClicked = await clickRow("settings.local.json");
        const badRaw = badClicked && (await railHas('{ "hooks": not json'));
        await polishNap(300);
        await h.shot("cdp-shots/setup-project-2-invalid-json.png");
        rec('5. settings.local.json that does not parse notes "invalid JSON" and the rail shows its raw text', badNote === "invalid JSON" && badRaw, JSON.stringify({ badNote, badClicked, badRaw }));

        const setupClicked = await clickRow(".arc/setup");
        const empty = setupClicked && (await railHas("Empty, or could not be read."));
        rec('6. the empty .arc/setup reads "Empty, or could not be read." in the rail', empty, JSON.stringify({ setupClicked, empty }));

        // a stub over Clipboard.prototype's writeText: the real one rejects without OS focus and would overwrite the user's clipboard
        await h.ev(notesClipStub(false));
        await h.ev(`document.querySelector("[data-context-rail] [data-context-copy]")?.click()`);
        const copied = await polishWaitFor(h, `(window.__notesClip ?? []).length === 1`, 2000);
        const clip = await h.ev(`window.__notesClip ?? []`);
        await h.ev(NOTES_CLIP_RESTORE);
        rec(
            "7. Copy path in the rail head copies the file's full path",
            copied && clip[0]?.replace(/\\/g, "/").endsWith("/.arc/setup") && clip[0].length > ".arc/setup".length,
            JSON.stringify(clip)
        );

        writeFileSync(
            join(ctx.memProject, "memory", "project_added.md"),
            "---\nname: added\ndescription: Written after the tab opened\ntype: project\n---\n\nAdded body.\n"
        );
        await h.ev(`document.querySelector('button[aria-label="Read the files again"]')?.click()`);
        const added = await polishWaitFor(
            h,
            `[...document.querySelectorAll('[data-context-group="memory"] [data-context-file]')].some((b) => b.textContent.includes("project_added.md"))`,
            5000
        );
        rec("8. Reload re-reads the project: a memory file written since shows under Memory", added, "");

        let rmError = null;
        try {
            rmSync(ctx.root, { recursive: true, force: true });
        } catch (e) {
            rmError = String(e?.message ?? e);
        }
        await h.ev(`document.querySelector('button[aria-label="Read the files again"]')?.click()`);
        const gone = await polishWaitFor(
            h,
            `!!document.querySelector('[data-context-tab] [role="alert"]') && !document.querySelector("[data-context-group]")`,
            5000
        );
        await polishNap(300);
        await h.shot("cdp-shots/setup-project-3-path-gone.png");
        const alert = await h.ev(`document.querySelector('[data-context-tab] [role="alert"]')?.textContent ?? null`);
        rec("9. with the project's folder gone, Reload shows the alert banner and no list", rmError == null && gone, JSON.stringify({ rmError, alert }));
        return steps;
    },
    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`setup-project teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        if (ctx.projectMade) {
            // deleteproject leaves the channel createproject made, so that goes too
            await step("remove the project", async () => {
                await h.rpc("deleteproject", { name: SP_PROJECT });
                const norm = (s) => (s || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.root))) {
                    await h.rpc("deletechannel", { channelid: c.oid });
                }
            });
        }
        if (ctx.memProject) await step("remove the memory folder", () => rmSync(ctx.memProject, { recursive: true, force: true }));
        if (ctx.root) await step("remove the project folder", () => rmSync(ctx.root, { recursive: true, force: true }));
    },
};
```

Register it: add `setupProject,` after `toolsWorktreeGone,` in the exported scenario list near the end of the file.

**Step 2: Check the script parses**

Run: `node --check scripts/cdp/scenarios.mjs`
Expected: no output, exit 0. (Do not run prettier on `scripts/*.mjs`.)

**Step 3: Run it if a dev app is up**

If a dev app is running on CDP `:9222`: `task verify:ui -- setup-project surface-smoke`
Expected: both PASS, all nine steps; `cdp-shots/setup-project-1-memory.png` shows the memory file in the rail,
`setup-project-2-invalid-json.png` the raw text of the bad settings file, `setup-project-3-path-gone.png` the banner.
If no dev app is running, skip: Final runs it.

**Step 4: The CHANGELOG line**

Under the top `## Unreleased` → `### Added` in `CHANGELOG.md` (create `### Added` above `### Changed` if that section
has none), add:

```markdown
- **Setup → Project**: one place to see what shapes Claude in a project: its CLAUDE.md or AGENTS.md, its memory
  grouped by type, its settings and hooks, its skills, agents and commands, and `.arc/setup`. Pick a file to read it
  beside the list. <!-- try: go:setup -->
```

Run: `npx vitest run frontend/app/cockpit/whatsnew.test.ts`
Expected: PASS (`go:setup` is a live binding id).

**Step 5: Commit**

```bash
P="scripts/cdp/scenarios.mjs CHANGELOG.md"
git add $P && git commit -m "test(cdp): setup-project scenario; changelog for Setup → Project" -- $P
```

If `CHANGELOG.md` has other people's uncommitted lines in it, commit only your line through a private index
(`GIT_INDEX_FILE` + `git commit-tree`), never the whole file.

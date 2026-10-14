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

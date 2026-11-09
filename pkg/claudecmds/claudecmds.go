// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package claudecmds lists the skills and slash commands Claude Code would offer in a folder, for the chat view's `/`
// menu: the project's and the user's `.claude/skills` and `.claude/commands`, and those of the enabled plugins (and of
// the folders `CLAUDE_CODE_PLUGIN_DIRS` names), a plugin's as `<plugin>:<name>`. It reads files only; a missing or
// malformed one is skipped.
package claudecmds

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	SourceSkill   = "skill"
	SourceCommand = "command"

	// maxDescription is how much of a description the menu keeps.
	maxDescription = 120
	// maxCommandDepth bounds the walk of a commands folder.
	maxCommandDepth = 4
)

// Info is one entry of the `/` menu. Name has no leading slash.
type Info struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Source      string `json:"source"`
}

// List is every skill and command visible from cwd for the user at home, deduplicated by name (the project's first,
// then the user's, then the plugins') and sorted by name. It never returns nil.
func List(home, cwd string) ([]Info, error) {
	var all []Info
	if cwd != "" {
		all = append(all, readRoot(filepath.Join(cwd, ".claude"), "")...)
	}
	if home != "" {
		all = append(all, readRoot(filepath.Join(home, ".claude"), "")...)
		for _, dir := range pluginDirs(home, cwd) {
			all = append(all, readPlugin(dir)...)
		}
	}
	seen := map[string]bool{}
	out := make([]Info, 0, len(all))
	for _, i := range all {
		if i.Name == "" || seen[i.Name] {
			continue
		}
		seen[i.Name] = true
		out = append(out, i)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Name < out[b].Name })
	return out, nil
}

// readRoot reads <root>/skills and <root>/commands, prefixing each name with prefix + ":" when prefix is set.
func readRoot(root, prefix string) []Info {
	var out []Info
	out = append(out, readSkills(filepath.Join(root, "skills"), prefix)...)
	out = append(out, readCommands(filepath.Join(root, "commands"), prefix, "", 0)...)
	return out
}

func qualify(prefix, name string) string {
	if prefix == "" {
		return name
	}
	return prefix + ":" + name
}

// readSkills lists <dir>/<folder>/SKILL.md; the folder names a skill whose frontmatter has no name.
func readSkills(dir, prefix string) []Info {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []Info
	for _, e := range entries {
		data, err := os.ReadFile(filepath.Join(dir, e.Name(), "SKILL.md"))
		if err != nil {
			continue
		}
		fm, _ := splitFrontmatter(string(data))
		name := fm["name"]
		if name == "" {
			name = e.Name()
		}
		out = append(out, Info{Name: qualify(prefix, name), Description: cut(fm["description"]), Source: SourceSkill})
	}
	return out
}

// readCommands lists the .md files under dir; a file in a subfolder is named `<folder>:<file>`.
func readCommands(dir, prefix, sub string, depth int) []Info {
	entries, err := os.ReadDir(dir)
	if err != nil || depth > maxCommandDepth {
		return nil
	}
	var out []Info
	for _, e := range entries {
		path := filepath.Join(dir, e.Name())
		st, err := os.Stat(path) // follows a symlinked file or folder
		if err != nil {
			continue
		}
		if st.IsDir() {
			next := e.Name()
			if sub != "" {
				next = sub + ":" + e.Name()
			}
			out = append(out, readCommands(path, prefix, next, depth+1)...)
			continue
		}
		if !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".md")
		if sub != "" {
			name = sub + ":" + name
		}
		fm, body := splitFrontmatter(string(data))
		desc := fm["description"]
		if desc == "" {
			desc = firstLine(body)
		}
		out = append(out, Info{Name: qualify(prefix, name), Description: cut(desc), Source: SourceCommand})
	}
	return out
}

// readPlugin lists a plugin folder's skills and commands under the name in its manifest.
func readPlugin(dir string) []Info {
	name := ""
	if data, err := os.ReadFile(filepath.Join(dir, ".claude-plugin", "plugin.json")); err == nil {
		var m struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(data, &m) == nil {
			name = m.Name
		}
	}
	if name == "" {
		name = filepath.Base(dir)
	}
	return readRoot(dir, name)
}

// pluginDirs is the install folder of each enabled installed plugin, then the folders of CLAUDE_CODE_PLUGIN_DIRS in
// the user's settings.
func pluginDirs(home, cwd string) []string {
	userSettings := filepath.Join(home, ".claude", "settings.json")
	enabled := map[string]bool{}
	var env string
	settingsFiles := []string{userSettings}
	if cwd != "" {
		settingsFiles = append(settingsFiles,
			filepath.Join(cwd, ".claude", "settings.json"), filepath.Join(cwd, ".claude", "settings.local.json"))
	}
	for _, f := range settingsFiles { // later files override earlier ones
		var s struct {
			EnabledPlugins map[string]bool   `json:"enabledPlugins"`
			Env            map[string]string `json:"env"`
		}
		if !readJSON(f, &s) {
			continue
		}
		for k, v := range s.EnabledPlugins {
			enabled[k] = v
		}
		if f == userSettings {
			env = s.Env["CLAUDE_CODE_PLUGIN_DIRS"]
		}
	}
	var dirs []string
	var installed struct {
		Plugins map[string][]struct {
			InstallPath string `json:"installPath"`
		} `json:"plugins"`
	}
	if readJSON(filepath.Join(home, ".claude", "plugins", "installed_plugins.json"), &installed) {
		keys := make([]string, 0, len(installed.Plugins))
		for k := range installed.Plugins {
			if enabled[k] {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		for _, k := range keys {
			for _, inst := range installed.Plugins[k] {
				if inst.InstallPath != "" {
					dirs = append(dirs, inst.InstallPath)
				}
			}
		}
	}
	for _, d := range filepath.SplitList(env) {
		if d != "" {
			dirs = append(dirs, d)
		}
	}
	return dirs
}

func readJSON(path string, v any) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return json.Unmarshal(data, v) == nil
}

// splitFrontmatter reads the `---` block at the top of a file: only `name:` and `description:` (quotes trimmed; a
// `>` or `|` value takes its indented lines). body is the text after the block, or the whole text without one.
func splitFrontmatter(text string) (fm map[string]string, body string) {
	fm = map[string]string{}
	text = strings.TrimPrefix(text, "\xef\xbb\xbf")
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return fm, text
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end < 0 {
		return fm, text
	}
	for i := 1; i < end; i++ {
		key, val, ok := strings.Cut(lines[i], ":")
		if !ok || strings.HasPrefix(lines[i], " ") || strings.HasPrefix(lines[i], "\t") {
			continue
		}
		key = strings.TrimSpace(key)
		if key != "name" && key != "description" {
			continue
		}
		val = strings.TrimSpace(val)
		if val != "" && strings.Trim(val, ">|-+") == "" { // a block scalar
			var parts []string
			for j := i + 1; j < end && (strings.HasPrefix(lines[j], " ") || strings.HasPrefix(lines[j], "\t")); j++ {
				parts = append(parts, strings.TrimSpace(lines[j]))
			}
			val = strings.Join(parts, " ")
		}
		fm[key] = unquote(val)
	}
	return fm, strings.Join(lines[end+1:], "\n")
}

func unquote(s string) string {
	if len(s) >= 2 && (s[0] == '"' && s[len(s)-1] == '"' || s[0] == '\'' && s[len(s)-1] == '\'') {
		return s[1 : len(s)-1]
	}
	return s
}

func firstLine(s string) string {
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			return l
		}
	}
	return ""
}

func cut(s string) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) > maxDescription {
		return string(r[:maxDescription])
	}
	return s
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudecmds

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeJSON(t *testing.T, path string, v any) {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, path, string(b))
}

func byName(list []Info) map[string]Info {
	m := map[string]Info{}
	for _, i := range list {
		m[i.Name] = i
	}
	return m
}

func TestListUserAndProjectSkills(t *testing.T) {
	home, cwd := t.TempDir(), t.TempDir()
	writeFile(t, filepath.Join(home, ".claude", "skills", "paper", "SKILL.md"),
		"---\nname: paper\ndescription: Write papers\n---\nbody\n")
	writeFile(t, filepath.Join(cwd, ".claude", "skills", "deploy", "SKILL.md"), "---\ndescription: \"Ship it\"\n---\nbody\n")
	got, err := List(home, cwd)
	if err != nil {
		t.Fatal(err)
	}
	m := byName(got)
	if m["paper"] != (Info{Name: "paper", Description: "Write papers", Source: "skill"}) {
		t.Errorf("paper = %+v", m["paper"])
	}
	if m["deploy"] != (Info{Name: "deploy", Description: "Ship it", Source: "skill"}) {
		t.Errorf("deploy = %+v (a skill with no name: takes its folder's name)", m["deploy"])
	}
	if len(got) != 2 {
		t.Errorf("got %d entries, want 2: %+v", len(got), got)
	}
}

func TestListCommandsWithSubfolders(t *testing.T) {
	home := t.TempDir()
	writeFile(t, filepath.Join(home, ".claude", "commands", "fix.md"), "---\ndescription: Fix the bug\n---\nFix it.\n")
	writeFile(t, filepath.Join(home, ".claude", "commands", "git", "sync.md"), "\n\nSync the branch with origin\nmore\n")
	long := strings.Repeat("x", 200)
	writeFile(t, filepath.Join(home, ".claude", "commands", "long.md"), long+"\n")
	got, err := List(home, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	m := byName(got)
	if m["fix"] != (Info{Name: "fix", Description: "Fix the bug", Source: "command"}) {
		t.Errorf("fix = %+v", m["fix"])
	}
	if m["git:sync"] != (Info{Name: "git:sync", Description: "Sync the branch with origin", Source: "command"}) {
		t.Errorf("git:sync = %+v", m["git:sync"])
	}
	if d := m["long"].Description; len([]rune(d)) != 120 {
		t.Errorf("long description is %d runes, want 120", len([]rune(d)))
	}
}

func TestListEnabledPluginsOnly(t *testing.T) {
	home, cwd := t.TempDir(), t.TempDir()
	dir1, dir2 := filepath.Join(t.TempDir(), "sp"), filepath.Join(t.TempDir(), "off")
	writeJSON(t, filepath.Join(home, ".claude", "plugins", "installed_plugins.json"), map[string]any{
		"version": 2,
		"plugins": map[string]any{
			"sp@mkt":  []map[string]any{{"installPath": dir1}},
			"off@mkt": []map[string]any{{"installPath": dir2}},
		},
	})
	writeJSON(t, filepath.Join(home, ".claude", "settings.json"), map[string]any{
		"enabledPlugins": map[string]bool{"sp@mkt": true, "off@mkt": false},
	})
	writeJSON(t, filepath.Join(dir1, ".claude-plugin", "plugin.json"), map[string]string{"name": "superpowers"})
	writeFile(t, filepath.Join(dir1, "skills", "brainstorming", "SKILL.md"), "---\nname: brainstorming\ndescription: Think first\n---\n")
	writeFile(t, filepath.Join(dir1, "commands", "plan.md"), "---\ndescription: Make a plan\n---\n")
	writeJSON(t, filepath.Join(dir2, ".claude-plugin", "plugin.json"), map[string]string{"name": "off"})
	writeFile(t, filepath.Join(dir2, "skills", "hidden", "SKILL.md"), "---\nname: hidden\n---\n")
	got, err := List(home, cwd)
	if err != nil {
		t.Fatal(err)
	}
	m := byName(got)
	if m["superpowers:brainstorming"] != (Info{Name: "superpowers:brainstorming", Description: "Think first", Source: "skill"}) {
		t.Errorf("superpowers:brainstorming = %+v", m["superpowers:brainstorming"])
	}
	if m["superpowers:plan"] != (Info{Name: "superpowers:plan", Description: "Make a plan", Source: "command"}) {
		t.Errorf("superpowers:plan = %+v", m["superpowers:plan"])
	}
	if len(got) != 2 {
		t.Errorf("got %+v, want only the enabled plugin's two entries", got)
	}
}

func TestListPluginDirsFromEnv(t *testing.T) {
	home := t.TempDir()
	a, b := filepath.Join(t.TempDir(), "a"), filepath.Join(t.TempDir(), "b")
	writeJSON(t, filepath.Join(home, ".claude", "settings.json"), map[string]any{
		"env": map[string]string{"CLAUDE_CODE_PLUGIN_DIRS": a + string(os.PathListSeparator) + b},
	})
	writeJSON(t, filepath.Join(a, ".claude-plugin", "plugin.json"), map[string]string{"name": "arc"})
	writeFile(t, filepath.Join(a, "skills", "runs", "SKILL.md"), "---\nname: runs\ndescription: Start runs\n---\n")
	got, err := List(home, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want := []Info{{Name: "arc:runs", Description: "Start runs", Source: "skill"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v (b has no manifest and no files)", got, want)
	}
}

func TestListMissingDirsIsEmpty(t *testing.T) {
	home, cwd := t.TempDir(), t.TempDir()
	got, err := List(home, cwd)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || len(got) != 0 {
		t.Errorf("got %#v, want an empty non-nil list", got)
	}
	// malformed JSON files are skipped, not an error
	writeFile(t, filepath.Join(home, ".claude", "settings.json"), "{not json")
	writeFile(t, filepath.Join(home, ".claude", "plugins", "installed_plugins.json"), "[[[")
	writeFile(t, filepath.Join(home, ".claude", "skills", "ok", "SKILL.md"), "---\nname: ok\n---\n")
	got, err = List(home, cwd)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Name != "ok" {
		t.Errorf("got %+v, want just ok", got)
	}
}

func TestListDedupesByName(t *testing.T) {
	home, cwd := t.TempDir(), t.TempDir()
	writeFile(t, filepath.Join(cwd, ".claude", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: project one\n---\n")
	writeFile(t, filepath.Join(home, ".claude", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: user one\n---\n")
	writeFile(t, filepath.Join(home, ".claude", "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\n")
	got, err := List(home, cwd)
	if err != nil {
		t.Fatal(err)
	}
	want := []Info{{Name: "alpha", Source: "skill"}, {Name: "deploy", Description: "project one", Source: "skill"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

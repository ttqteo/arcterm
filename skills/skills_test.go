// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package skills

import (
	"encoding/json"
	"io/fs"
	"regexp"
	"strings"
	"testing"
)

// frontmatterName returns the `name:` value of a SKILL.md's leading --- block.
func frontmatterName(t *testing.T, doc string) string {
	t.Helper()
	lines := strings.Split(strings.ReplaceAll(doc, "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		t.Fatalf("SKILL.md does not open with a --- frontmatter block")
	}
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "---" {
			break
		}
		if name, ok := strings.CutPrefix(line, "name:"); ok {
			return strings.TrimSpace(name)
		}
	}
	return ""
}

// canvasIndexExample is the one-line canvas.json shape the design skill documents (the code span that opens with {"v":).
var canvasIndexExample = regexp.MustCompile("`(\\{\"v\":[^`]*)`")

// TestDesignSkillVersions pins what the design skill teaches about canvas versions: the agent writes `replaces`
// when a new canvas redraws an older one, and keeps `replaces` and `notreplaces` through every rewrite of canvas.json.
// The documented index shape carries both keys and stays valid JSON, so an agent copying it writes a file Arc can read.
func TestDesignSkillVersions(t *testing.T) {
	doc, err := fs.ReadFile(FS, "design/SKILL.md")
	if err != nil {
		t.Fatalf("design/SKILL.md is not embedded: %v", err)
	}
	text := string(doc)
	for _, want := range []string{"replaces", "notreplaces"} {
		if !strings.Contains(text, want) {
			t.Errorf("design/SKILL.md does not mention %q", want)
		}
	}
	m := canvasIndexExample.FindStringSubmatch(text)
	if m == nil {
		t.Fatalf("design/SKILL.md has no canvas.json index example (a code span opening with {\"v\":)")
	}
	var index map[string]any
	if err := json.Unmarshal([]byte(m[1]), &index); err != nil {
		t.Fatalf("the canvas.json index example in design/SKILL.md is not valid JSON: %v\n%s", err, m[1])
	}
	for _, key := range []string{"replaces", "notreplaces"} {
		if _, ok := index[key]; !ok {
			t.Errorf("the canvas.json index example in design/SKILL.md has no %q key", key)
		}
	}
}

// TestVisualSkill pins what the visual skill teaches: the arc-visual block and the folder it names, the button call,
// mermaid as the first choice, and the --arc- colour properties the page receives from Chat.
func TestVisualSkill(t *testing.T) {
	doc, err := fs.ReadFile(FS, "visual/SKILL.md")
	if err != nil {
		t.Fatalf("visual/SKILL.md is not embedded: %v", err)
	}
	if got := frontmatterName(t, string(doc)); got != "visual" {
		t.Errorf("visual frontmatter name = %q, want visual", got)
	}
	for _, want := range []string{"arc-visual", "~/.arc/visuals", "arc.sendPrompt", "mermaid", "--arc-"} {
		if !strings.Contains(string(doc), want) {
			t.Errorf("visual/SKILL.md does not mention %q", want)
		}
	}
}

func TestShippedSkills(t *testing.T) {
	doc, err := fs.ReadFile(FS, "doc-review/SKILL.md")
	if err != nil {
		t.Fatalf("doc-review/SKILL.md is not embedded: %v", err)
	}
	if got := frontmatterName(t, string(doc)); got != "doc-review" {
		t.Errorf("doc-review frontmatter name = %q, want doc-review", got)
	}

	doc, err = fs.ReadFile(FS, "council/SKILL.md")
	if err != nil {
		t.Fatalf("council/SKILL.md is not embedded: %v", err)
	}
	if got := frontmatterName(t, string(doc)); got != "council" {
		t.Errorf("council frontmatter name = %q, want council", got)
	}
	// the start (with the mode the agent picks), the read-back, the refusal and the queued line are what the skill
	// teaches; each names its command or the words it prints. wsh council estimate is not among them: the agent starts
	// a council itself and the token gate prices the start, so the skill no longer offers with an estimate.
	for _, want := range []string{"wsh council start", "--mode", "wsh council wait", "Not run:", "Queued after"} {
		if !strings.Contains(string(doc), want) {
			t.Errorf("council/SKILL.md does not mention %q", want)
		}
	}

	doc, err = fs.ReadFile(FS, "handoff/SKILL.md")
	if err != nil {
		t.Fatalf("handoff/SKILL.md is not embedded: %v", err)
	}
	if got := frontmatterName(t, string(doc)); got != "handoff" {
		t.Errorf("handoff frontmatter name = %q, want handoff", got)
	}
	// the Handoff ask (its header, the four choices in their order and the start commands) and the arc-review block
	// (its fence, the `subagent` pairing field and the lines Chat's buttons send back) are what the skill teaches; Chat
	// reads the header, the four labels and the fence by these exact words.
	handoff := string(doc)
	for _, want := range []string{
		"AskUserQuestion", "Handoff", "(Recommended)",
		"wsh runs start --plan", "--queue", "--after", "runs:maxactive",
		"```arc-review", "subagent", "Fix these review findings:", "Skip the review:",
	} {
		if !strings.Contains(handoff, want) {
			t.Errorf("handoff/SKILL.md does not mention %q", want)
		}
	}
	// the four choices keep their order: Chat draws the rows in this order and maps a click back by label
	last := -1
	for _, label := range []string{"`Arc engine`", "`Arc engine, queued`", "`Inline in this session`", "`Subagent-driven`"} {
		at := strings.Index(handoff, label)
		if at < 0 {
			t.Errorf("handoff/SKILL.md does not name the choice %s", label)
			continue
		}
		if at < last {
			t.Errorf("handoff/SKILL.md names %s before the choice above it: the four choices must come in order", label)
		}
		last = at
	}

	entries, err := fs.ReadDir(FS, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, err := fs.Stat(FS, e.Name()+"/SKILL.md"); err != nil {
			t.Errorf("skill %s has no SKILL.md: %v", e.Name(), err)
		}
	}
}

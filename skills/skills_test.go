// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package skills

import (
	"io/fs"
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

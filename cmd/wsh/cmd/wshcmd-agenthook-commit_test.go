// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTurnOutcome(t *testing.T) {
	prompt := `{"type":"user","message":{"content":"commit it"}}`
	bash := func(id, cmd string) string {
		return fmt.Sprintf(`{"type":"assistant","message":{"content":[{"type":"tool_use","id":%q,"name":"Bash","input":{"command":%q}}]}}`, id, cmd)
	}
	result := func(id string, isError bool) string {
		return fmt.Sprintf(`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":%q,"is_error":%t,"content":"ok"}]}}`, id, isError)
	}
	edit := `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"e1","name":"Edit","input":{"file_path":"a.go"}}]}}`
	done := `{"type":"assistant","message":{"content":[{"type":"text","text":"Committed."}]}}`
	commit := bash("c1", `git add -A && git commit -m "fix: x"`)

	cases := []struct {
		name   string
		lines  []string
		want   bool
		edited bool
	}{
		{"a commit", []string{prompt, commit, result("c1", false), done}, true, false},
		{"git -C commit", []string{prompt, bash("c1", "git -C ../repo commit -m x"), result("c1", false), done}, true, false},
		{"a dry run", []string{prompt, bash("c1", "git commit --dry-run"), result("c1", false), done}, false, false},
		{"no bash", []string{prompt, done}, false, false},
		{"other bash", []string{prompt, bash("b1", "go test ./..."), result("b1", false), done}, false, false},
		{"an earlier turn's commit", []string{prompt, commit, result("c1", false), done, prompt, done}, false, false},
		{"an edit after the commit", []string{prompt, commit, result("c1", false), edit, done}, false, true},
		{"an edit then a commit", []string{prompt, edit, commit, result("c1", false), done}, true, false},
		{"a failed commit", []string{prompt, commit, result("c1", true), done}, false, false},
		{"an edit then a failed commit", []string{prompt, edit, commit, result("c1", true), done}, false, true},
		{"a failed commit then a good one", []string{prompt, commit, result("c1", true), bash("c2", "git commit -m y"), result("c2", false), done}, true, false},
		{"git log mentioning commit", []string{prompt, bash("b1", "git log --oneline | grep commit"), result("b1", false), done}, false, false},
		{"an edit, no commit", []string{prompt, edit, done}, false, true},
		{"an earlier turn's edit", []string{prompt, edit, done, prompt, done}, false, false},
	}
	for _, c := range cases {
		got := turnOutcome(c.lines)
		if got.Committed != c.want {
			t.Errorf("%s: Committed = %v, want %v", c.name, got.Committed, c.want)
		}
		if got.Edited != c.edited {
			t.Errorf("%s: Edited = %v, want %v", c.name, got.Edited, c.edited)
		}
	}
}

// a turn whose commit is followed by more tool output than the 64 KB the other transcript readers take: the commit
// must still be found, since the window is read back to the turn's prompt
func TestReadTurnOutcomePastTheTail(t *testing.T) {
	big := strings.Repeat("x", 4000)
	lines := []string{
		`{"type":"user","message":{"content":"commit it"}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"c1","name":"Bash","input":{"command":"git commit -m x"}}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"c1","is_error":false,"content":"ok"}]}}`,
	}
	for i := 0; len(strings.Join(lines, "\n")) < 3*transcriptTailBytes; i++ {
		lines = append(lines,
			fmt.Sprintf(`{"type":"assistant","message":{"content":[{"type":"tool_use","id":"b%d","name":"Bash","input":{"command":"git log"}}]}}`, i),
			fmt.Sprintf(`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"b%d","is_error":false,"content":%q}]}}`, i, big))
	}
	lines = append(lines, `{"type":"assistant","message":{"content":[{"type":"text","text":"Committed."}]}}`)
	path := filepath.Join(t.TempDir(), "t.jsonl")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !readTurnOutcome(path).Committed {
		t.Fatal("readTurnOutcome: Committed = false for a commit more than transcriptTailBytes before the end")
	}
	// the earlier turn's commit stays the earlier turn's
	lines = append(lines, `{"type":"user","message":{"content":"thanks"}}`, `{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}`)
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if readTurnOutcome(path).Committed {
		t.Fatal("readTurnOutcome: Committed = true for a turn after the committing one")
	}
}

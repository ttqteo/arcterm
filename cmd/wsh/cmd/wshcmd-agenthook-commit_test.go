// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"testing"
)

func TestTurnCommitted(t *testing.T) {
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
		name  string
		lines []string
		want  bool
	}{
		{"a commit", []string{prompt, commit, result("c1", false), done}, true},
		{"git -C commit", []string{prompt, bash("c1", "git -C ../repo commit -m x"), result("c1", false), done}, true},
		{"a dry run", []string{prompt, bash("c1", "git commit --dry-run"), result("c1", false), done}, false},
		{"no bash", []string{prompt, done}, false},
		{"other bash", []string{prompt, bash("b1", "go test ./..."), result("b1", false), done}, false},
		{"an earlier turn's commit", []string{prompt, commit, result("c1", false), done, prompt, done}, false},
		{"an edit after the commit", []string{prompt, commit, result("c1", false), edit, done}, false},
		{"an edit then a commit", []string{prompt, edit, commit, result("c1", false), done}, true},
		{"a failed commit", []string{prompt, commit, result("c1", true), done}, false},
		{"a failed commit then a good one", []string{prompt, commit, result("c1", true), bash("c2", "git commit -m y"), result("c2", false), done}, true},
		{"git log mentioning commit", []string{prompt, bash("b1", "git log --oneline | grep commit"), result("b1", false), done}, false},
	}
	for _, c := range cases {
		if got := turnCommitted(c.lines); got != c.want {
			t.Errorf("%s: turnCommitted = %v, want %v", c.name, got, c.want)
		}
	}
}

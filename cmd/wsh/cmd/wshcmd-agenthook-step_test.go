// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import "testing"

func TestStepMarker(t *testing.T) {
	cases := []struct {
		name, text, want string
	}{
		{"vietnamese part", "Phần 1/3: kiến trúc và luồng sự kiện.\n\nBạn thấy ổn chưa?", "1/3"},
		{"english part", "## Part 2/4 — data model\n\nLooks right?", "2/4"},
		{"part of", "Here is part 2 of 3, the error handling.", "2/3"},
		{"bước", "**Bước 3/5:** chạy migration", "3/5"},
		{"bold count heading", "**2/3** Error handling\n\nOK?", "2/3"},
		{"parenthesised count", "(1/3) Architecture", "1/3"},
		{"heading count", "### 3/3 — testing", "3/3"},
		{"heading beats a recap", "## Part 2/3 — UI\n\nPart 1/3 was approved.", "2/3"},
		{"no marker", "Done. All tests pass.", ""},
		{"fraction in prose", "Use 1/2 cup of flour.", ""},
		{"date at line start", "10/7: shipped", ""},
		{"date in prose", "Released on 10/7, part of the plan.", ""},
		{"step past its total", "Part 4/3", ""},
		{"total too large", "Step 1/50", ""},
		{"a single part", "Part 1/1", ""},
		{"steps plural", "steps 1/3 are done", ""},
	}
	for _, c := range cases {
		if got := stepMarker(c.text); got != c.want {
			t.Errorf("%s: stepMarker(%q) = %q, want %q", c.name, c.text, got, c.want)
		}
	}
}

func TestLastAssistantText(t *testing.T) {
	prompt := `{"type":"user","message":{"content":"design the event flow"}}`
	toolResult := `{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}`
	tool := `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}`
	part1 := `{"type":"assistant","message":{"content":[{"type":"text","text":"Phần 1/3: kiến trúc"}]}}`
	part2 := `{"type":"assistant","message":{"content":[{"type":"text","text":"Phần 2/3: lỗi"}]}}`

	if got := lastAssistantText([]string{prompt, tool, toolResult, part1}); got != "Phần 1/3: kiến trúc" {
		t.Errorf("turn ending on text = %q", got)
	}
	if got := lastAssistantText([]string{prompt, part1, toolResult, part2}); got != "Phần 2/3: lỗi" {
		t.Errorf("a tool result does not start a turn = %q", got)
	}
	if got := lastAssistantText([]string{prompt, part1, prompt, tool, toolResult}); got != "" {
		t.Errorf("a turn that ended on tools carried the last turn's text = %q", got)
	}
}

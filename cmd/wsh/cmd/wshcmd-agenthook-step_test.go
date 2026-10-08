// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

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
		{"phần trong", "Đây là phần 1 trong 3 của thiết kế.", "1/3"},
		{"phần trong số", "Phần 2 trong số 4: dữ liệu", "2/4"},
		{"round of", "Review round 1 of 2 is done.", "1/2"},
		{"out of", "Part 2 out of 3 — the API", "2/3"},
		{"câu hỏi", "Câu hỏi 2/5: bạn dùng Postgres hay SQLite?", "2/5"},
		{"bracketed count", "[1/4] Khung sidebar", "1/4"},
		{"zero-padded date", "Chạy lại vòng 05/10, phần còn lại giữ nguyên.", ""},
		{"zero-padded heading date", "## 05/10 — kết quả", ""},
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

func TestReadLastStepAsk(t *testing.T) {
	prompt := `{"type":"user","message":{"content":"design the sidebar"}}`
	design := `{"type":"assistant","message":{"content":[{"type":"text","text":"Phần 2/4: ba panel, mỗi panel một nguồn."}]}}`
	plain := `{"type":"assistant","message":{"content":[{"type":"text","text":"Đây là khung sidebar."}]}}`
	ask := func(q string) string {
		return `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"AskUserQuestion","input":{"questions":[{"header":"Khung","question":"` + q + `"}]}}]}}`
	}
	cases := []struct {
		name  string
		lines []string
		want  string
	}{
		{"the ask names it", []string{prompt, plain, ask("Phần 1/4 (khung sidebar) ổn chưa?")}, "1/4"},
		{"the message before the ask names it", []string{prompt, design, ask("Ổn chưa?")}, "2/4"},
		{"an ask before a later message is not the stop", []string{prompt, ask("Phần 1/4 ổn chưa?"), plain}, ""},
		{"an earlier turn's ask", []string{prompt, ask("Phần 1/4 ổn chưa?"), prompt, plain}, ""},
	}
	dir := t.TempDir()
	for i, c := range cases {
		path := filepath.Join(dir, strconv.Itoa(i)+".jsonl")
		if err := os.WriteFile(path, []byte(strings.Join(c.lines, "\n")+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if got := readLastStep(path); got != c.want {
			t.Errorf("%s: readLastStep = %q, want %q", c.name, got, c.want)
		}
	}

	input := []byte(`{"questions":[{"header":"Chốt","question":"Phần 4/4 ổn chưa?"}]}`)
	if got := askStep(input, ""); got != "4/4" {
		t.Errorf("askStep from the input = %q, want 4/4", got)
	}
	path := filepath.Join(dir, "fallback.jsonl")
	_ = os.WriteFile(path, []byte(prompt+"\n"+design+"\n"), 0o644)
	if got := askStep([]byte(`{"questions":[{"header":"OK","question":"Ổn chưa?"}]}`), path); got != "2/4" {
		t.Errorf("askStep falls back to the transcript = %q, want 2/4", got)
	}
}

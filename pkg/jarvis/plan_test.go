// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func mustParsePlan(t *testing.T, src string) Plan {
	t.Helper()
	p, err := ParsePlan(src)
	if err != nil {
		t.Fatalf("ParsePlan: %v", err)
	}
	return p
}

// depLists renders each task as "id:dep,dep" so nil and empty deps compare equal.
func depLists(tasks []waveobj.TaskNode) []string {
	out := make([]string, len(tasks))
	for i, t := range tasks {
		out[i] = t.ID + ":" + strings.Join(t.Deps, ",")
	}
	return out
}

func TestParsePlanDependencies(t *testing.T) {
	t.Run("a task with no Depends line follows the previous task", func(t *testing.T) {
		p := mustParsePlan(t, "### Task 1: a\ndo a\n\n### Task 2: b\ndo b\n")
		want := []string{"t-1:", "t-2:t-1"}
		if got := depLists(p.Tasks); !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
		if p.Verify != "" || p.Setup != "" {
			t.Fatalf("Verify and Setup are optional, got %q / %q", p.Verify, p.Setup)
		}
	})
	t.Run("none and lists", func(t *testing.T) {
		p := mustParsePlan(t, "### Task 1: a\n### Task 2: b\n**Depends on:** none\n### Task 3: c\n\n**Depends on:** Task 1, Task 2\n")
		want := []string{"t-1:", "t-2:", "t-3:t-1,t-2"}
		if got := depLists(p.Tasks); !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})
}

func TestParsePlanRejects(t *testing.T) {
	cases := []struct {
		name    string
		src     string
		errPart string
	}{
		{"no tasks", "# Plan\n\nJust prose.\n", "no tasks"},
		{"forward reference", "### Task 1: a\n**Depends on:** Task 2\n### Task 2: b\n", "Task 2"},
		{"unknown reference", "### Task 1: a\n### Task 2: b\n**Depends on:** Task 0\n", "Task 0"},
		{"malformed reference", "### Task 1: a\n### Task 2: b\n**Depends on:** the first one\n", "the first one"},
		{"duplicate reference", "### Task 1: a\n### Task 2: b\n### Task 3: c\n**Depends on:** Task 1, Task 1\n", "Task 1"},
		{"empty Depends", "### Task 1: a\n### Task 2: b\n**Depends on:**\n", "Depends on"},
		{"out-of-order number", "### Task 1: a\n### Task 3: c\n", "Task 3"},
		{"Verify without backticks", "**Verify:** task test\n\n### Task 1: a\n", "Verify"},
		{"a second Verify line", "**Verify:** `a`\n**Verify:** `b`\n\n### Task 1: a\n", "Verify"},
		{"Check without backticks", "**Check:** task check:ts\n\n### Task 1: a\n", "Check"},
		{"a second Check line", "**Check:** `a`\n**Check:** `b`\n\n### Task 1: a\n", "Check"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParsePlan(c.src)
			if err == nil {
				t.Fatal("want an error")
			}
			if !strings.Contains(err.Error(), c.errPart) {
				t.Fatalf("error %q should name %q", err, c.errPart)
			}
		})
	}
}

func TestParsePlanCheck(t *testing.T) {
	src := "**Verify:** `task test`\n**Check:** `task check:ts`\n\n### Task 1: a\n"
	p := mustParsePlan(t, src)
	if p.Verify != "task test" || p.Check != "task check:ts" {
		t.Fatalf("got verify %q, check %q", p.Verify, p.Check)
	}
}

func TestParsePlanPlanLevelLinesOnlyBeforeTheFirstTask(t *testing.T) {
	src := "# Coupon codes\n\n**Verify:** `task test`\n**Setup:** `task worktree:prepare`\n\n### Task 1: a\n**Verify:** `not plan level`\ndo a\n"
	p := mustParsePlan(t, src)
	if p.Title != "Coupon codes" || p.Verify != "task test" || p.Setup != "task worktree:prepare" {
		t.Fatalf("got title %q, verify %q, setup %q", p.Title, p.Verify, p.Setup)
	}
	if !strings.Contains(p.Tasks[0].Description, "**Verify:** `not plan level`") {
		t.Fatalf("a Verify line inside a task is task text, got %q", p.Tasks[0].Description)
	}
}

func TestParsePlanPreamble(t *testing.T) {
	src := "# Coupon codes\n\n**Verify:** `task test`\n\nNever edit docs/.\n\n```\nfenced example\n```\n\nSecond paragraph.\n\n\n### Task 1: a\ndo a\n"
	p := mustParsePlan(t, src)
	for _, want := range []string{"Never edit docs/.", "```\nfenced example\n```", "Second paragraph."} {
		if !strings.Contains(p.Preamble, want) {
			t.Fatalf("preamble missing %q, got %q", want, p.Preamble)
		}
	}
	for _, gone := range []string{"# Coupon codes", "Coupon codes\n", "**Verify:**", "task test"} {
		if strings.Contains(p.Preamble, gone) {
			t.Fatalf("preamble must not carry the title or command lines, found %q in %q", gone, p.Preamble)
		}
	}
	if strings.HasPrefix(p.Preamble, "\n") || strings.HasSuffix(p.Preamble, "\n") {
		t.Fatalf("leading/trailing blank lines must be trimmed, got %q", p.Preamble)
	}
}

func TestParsePlanSpec(t *testing.T) {
	cases := map[string]string{
		"**Spec:** `docs/specs/coupons.md`":                                        "docs/specs/coupons.md",
		"**Spec:** `docs/specs/coupons.md` — read it in full before your task.":    "docs/specs/coupons.md",
		"**Spec:** [`docs/specs/coupons.md`](../specs/coupons.md). Read it first.": "docs/specs/coupons.md",
		"**Spec:** docs/specs/coupons.md":                                          "docs/specs/coupons.md",
		"**Spec:** the coupons design, section 2":                                  "",
	}
	for line, want := range cases {
		p := mustParsePlan(t, "# Coupons\n\n"+line+"\n\n### Task 1: a\ndo a\n")
		if p.Spec != want {
			t.Errorf("%q: spec %q, want %q", line, p.Spec, want)
		}
		// the line's prose ("read it before your task") is for every worker, so it stays in the preamble
		if !strings.Contains(p.Preamble, line) {
			t.Errorf("%q: the Spec line left the preamble %q", line, p.Preamble)
		}
	}
	if p := mustParsePlan(t, "# Coupons\n\n### Task 1: a\n**Spec:** `x.md`\n"); p.Spec != "" {
		t.Fatalf("a Spec line inside a task is task text, got spec %q", p.Spec)
	}
}

func TestParsePlanWithoutPreamble(t *testing.T) {
	src := "# Coupon codes\n\n**Verify:** `task test`\n**Setup:** `task worktree:prepare`\n\n### Task 1: a\ndo a\n"
	p := mustParsePlan(t, src)
	if p.Preamble != "" {
		t.Fatalf("a header holding only the title and commands has an empty preamble, got %q", p.Preamble)
	}
}

func TestParsePlanTaskText(t *testing.T) {
	src := "## Task 1: first\n**Depends on:** none\n\nline one\nline two\n\n### Task 2\nsecond body\n"
	p := mustParsePlan(t, src)
	if len(p.Tasks) != 2 {
		t.Fatalf("both heading levels are tasks, got %d", len(p.Tasks))
	}
	if p.Tasks[0].Label != "first" || p.Tasks[0].Description != "line one\nline two" {
		t.Fatalf("task 1 = %q / %q", p.Tasks[0].Label, p.Tasks[0].Description)
	}
	if p.Tasks[1].Label != "Task 2" || p.Tasks[1].Description != "second body" {
		t.Fatalf("task 2 = %q / %q", p.Tasks[1].Label, p.Tasks[1].Description)
	}
}

func TestParsePlanIgnoresFencedLines(t *testing.T) {
	src := "### Task 1: write the parser test\n\n```markdown\n### Task 2: sample\n**Depends on:** none\n```\n\n### Task 2: real\n"
	p := mustParsePlan(t, src)
	if len(p.Tasks) != 2 || p.Tasks[1].Label != "real" {
		t.Fatalf("a fenced heading is not a task, got %v", depLists(p.Tasks))
	}
	if !strings.Contains(p.Tasks[0].Description, "### Task 2: sample") {
		t.Fatalf("fenced lines stay in the task text, got %q", p.Tasks[0].Description)
	}
	if want := []string{"t-1:", "t-2:t-1"}; !reflect.DeepEqual(depLists(p.Tasks), want) {
		t.Fatalf("got %v, want %v", depLists(p.Tasks), want)
	}
}

func TestParsePlanCRLF(t *testing.T) {
	p := mustParsePlan(t, "**Verify:** `go test ./...`\r\n\r\n### Task 1: a\r\nbody\r\n### Task 2: b\r\n**Depends on:** none\r\n")
	if p.Verify != "go test ./..." || p.Tasks[0].Label != "a" || p.Tasks[0].Description != "body" {
		t.Fatalf("got verify %q, task 1 %q / %q", p.Verify, p.Tasks[0].Label, p.Tasks[0].Description)
	}
	if want := []string{"t-1:", "t-2:"}; !reflect.DeepEqual(depLists(p.Tasks), want) {
		t.Fatalf("got %v, want %v", depLists(p.Tasks), want)
	}
}

func TestPlanFormatParses(t *testing.T) {
	p := mustParsePlan(t, PlanFormat)
	if want := []string{"t-1:", "t-2:t-1", "t-3:t-1"}; !reflect.DeepEqual(depLists(p.Tasks), want) {
		t.Fatalf("the format's own example must parse as documented, got %v", depLists(p.Tasks))
	}
	if p.Verify == "" || p.Setup == "" || p.Check == "" || p.Final == "" || p.Prototype == "" {
		t.Fatalf("the example shows Verify, Setup, Check, Final and Prototype, got %q / %q / %q / %q / %q", p.Verify, p.Setup, p.Check, p.Final, p.Prototype)
	}
	if p.EffortOID != "<oid>" || !reflect.DeepEqual(p.Tasks[0].Chunks, []string{"<exact chunk label>"}) {
		t.Fatalf("the example shows an Effort line and a Chunk line, got %q / %v", p.EffortOID, p.Tasks[0].Chunks)
	}
}

// a worker runs what its task names, so a plan that names whole packages repeats Verify's work in every task
func TestPlanFormatKeepsTaskTestsFocused(t *testing.T) {
	if !strings.Contains(PlanFormat, "never a whole package or the full suite") {
		t.Fatalf("the format must keep a task's tests to the focused ones:\n%s", PlanFormat)
	}
}

func node(id string, deps ...string) waveobj.TaskNode {
	return waveobj.TaskNode{ID: id, Label: id, Deps: deps}
}

func TestLanes(t *testing.T) {
	cases := []struct {
		name    string
		tasks   []waveobj.TaskNode
		lanes   [][]string
		longest int
	}{
		{"chain", []waveobj.TaskNode{node("t-1"), node("t-2", "t-1"), node("t-3", "t-2")}, [][]string{{"t-1", "t-2", "t-3"}}, 3},
		{"fork", []waveobj.TaskNode{node("t-1"), node("t-2", "t-1"), node("t-3", "t-1")}, [][]string{{"t-1"}, {"t-2"}, {"t-3"}}, 2},
		{"join", []waveobj.TaskNode{node("t-1"), node("t-2"), node("t-3", "t-1", "t-2")}, [][]string{{"t-1"}, {"t-2"}, {"t-3"}}, 2},
		{"independent", []waveobj.TaskNode{node("t-1"), node("t-2"), node("t-3", "t-2")}, [][]string{{"t-1"}, {"t-2", "t-3"}}, 2},
		{"a fork branch continues as its own chain", []waveobj.TaskNode{node("t-1"), node("t-2", "t-1"), node("t-3", "t-1"), node("t-4", "t-3")}, [][]string{{"t-1"}, {"t-2"}, {"t-3", "t-4"}}, 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Lanes(c.tasks); !reflect.DeepEqual(got, c.lanes) {
				t.Fatalf("lanes = %v, want %v", got, c.lanes)
			}
			if got := LongestChain(c.tasks); got != c.longest {
				t.Fatalf("longest chain = %d, want %d", got, c.longest)
			}
		})
	}
}

func TestParsePlanEffortAndChunks(t *testing.T) {
	src := "# Tracker\n\n**Effort:** effort:5d11f853\n**Verify:** `task test`\n\nNever edit docs/.\n\n" +
		"### Task 1: a\n**Depends on:** none\n**Chunk:** #8 first\n**Chunk:** #6 second\n\ndo a\n\n" +
		"### Task 2: b\n**Depends on:** none\ndo b\n\n" +
		"### Task 3: c\n**Chunk:** #12 third\ndo c\n"
	p := mustParsePlan(t, src)
	if p.EffortOID != "5d11f853" {
		t.Fatalf("effort = %q, want the oid without its prefix", p.EffortOID)
	}
	if got := p.Tasks[0].Chunks; !reflect.DeepEqual(got, []string{"#8 first", "#6 second"}) {
		t.Fatalf("task 1 chunks = %v", got)
	}
	if len(p.Tasks[1].Chunks) != 0 {
		t.Fatalf("task 2 names no chunk, got %v", p.Tasks[1].Chunks)
	}
	if got := p.Tasks[2].Chunks; !reflect.DeepEqual(got, []string{"#12 third"}) {
		t.Fatalf("a Chunk line first under a heading with no Depends line counts, got %v", got)
	}
	if got := depLists(p.Tasks); !reflect.DeepEqual(got, []string{"t-1:", "t-2:", "t-3:t-2"}) {
		t.Fatalf("chunk lines must not disturb dependencies, got %v", got)
	}
	if p.Tasks[0].Description != "do a" || p.Tasks[2].Description != "do c" {
		t.Fatalf("the Chunk lines are not task text, got %q / %q", p.Tasks[0].Description, p.Tasks[2].Description)
	}
	if p.Preamble != "Never edit docs/." {
		t.Fatalf("the Effort line is not preamble text, got %q", p.Preamble)
	}
}

func TestParsePlanBareEffortOID(t *testing.T) {
	p := mustParsePlan(t, "**Effort:** 5d11f853\n\n### Task 1: a\ndo a\n")
	if p.EffortOID != "5d11f853" {
		t.Fatalf("effort = %q", p.EffortOID)
	}
}

func TestParsePlanChunkWithoutEffortRejected(t *testing.T) {
	_, err := ParsePlan("### Task 1: a\ndo a\n\n### Task 2: second\n**Chunk:** #8 x\ndo b\n")
	if err == nil || !strings.Contains(err.Error(), "task 2") || !strings.Contains(err.Error(), "Effort") {
		t.Fatalf("a Chunk line with no Effort line must be refused naming the task, got %v", err)
	}
}

func TestParsePlanEffortRejects(t *testing.T) {
	for name, src := range map[string]string{
		"backticks":      "**Effort:** `effort:abc`\n### Task 1: a\nx\n",
		"empty":          "**Effort:**\n### Task 1: a\nx\n",
		"twice":          "**Effort:** a\n**Effort:** b\n### Task 1: a\nx\n",
		"empty chunk":    "**Effort:** a\n### Task 1: a\n**Chunk:**\nx\n",
		"repeated chunk": "**Effort:** a\n### Task 1: a\n**Chunk:** c\n**Chunk:** c\nx\n",
	} {
		if _, err := ParsePlan(src); err == nil {
			t.Fatalf("%s: want an error", name)
		}
	}
}

func TestParsePlanChunkLineLaterIsTaskText(t *testing.T) {
	src := "**Effort:** e1\n\n### Task 1: a\n**Depends on:** none\nsome text\n**Chunk:** late\n\n" +
		"### Task 2: b\n**Chunk:** early\n**Depends on:** none\nx\n"
	p := mustParsePlan(t, src)
	if len(p.Tasks[0].Chunks) != 0 || !strings.Contains(p.Tasks[0].Description, "**Chunk:** late") {
		t.Fatalf("a Chunk line after task text is task text, got chunks %v, description %q", p.Tasks[0].Chunks, p.Tasks[0].Description)
	}
	if got := p.Tasks[1].Chunks; !reflect.DeepEqual(got, []string{"early"}) || !strings.Contains(p.Tasks[1].Description, "**Depends on:** none") {
		t.Fatalf("a Depends line after a Chunk line is task text, got chunks %v, description %q", got, p.Tasks[1].Description)
	}
	if len(p.Tasks[1].Deps) != 1 {
		t.Fatalf("task 2 keeps its default dependency, got %v", p.Tasks[1].Deps)
	}
}

func TestParsePlanFinalAndPrototype(t *testing.T) {
	src := "# Board\n\n**Verify:** `task test`\n**Final:** `node scripts/cdp/final-verify.mjs board`\n**Prototype:** .superpowers/design/board/board.dc.html\n\n### Task 1: a\ndo a\n"
	p := mustParsePlan(t, src)
	if p.Final != "node scripts/cdp/final-verify.mjs board" || p.Prototype != ".superpowers/design/board/board.dc.html" {
		t.Fatalf("got final %q, prototype %q", p.Final, p.Prototype)
	}
	if strings.Contains(p.Preamble, "Final") || strings.Contains(p.Preamble, "Prototype") {
		t.Fatalf("the Final and Prototype lines are not preamble text, got %q", p.Preamble)
	}
}

func TestParsePlanFinalRejects(t *testing.T) {
	for name, src := range map[string]string{
		"a second Final line":     "**Final:** `a`\n**Final:** `b`\n\n### Task 1: a\n",
		"Final without backticks": "**Final:** node x.mjs\n\n### Task 1: a\n",
		"a second Prototype line": "**Prototype:** a.html\n**Prototype:** b.html\n\n### Task 1: a\n",
		"Prototype in backticks":  "**Prototype:** `a.html`\n\n### Task 1: a\n",
		"an empty Prototype line": "**Prototype:**\n\n### Task 1: a\n",
	} {
		if _, err := ParsePlan(src); err == nil {
			t.Fatalf("%s: want an error", name)
		}
	}
}

func TestParsePlanFinalAfterTheFirstTaskIsTaskText(t *testing.T) {
	p := mustParsePlan(t, "### Task 1: a\n**Final:** `not plan level`\n**Prototype:** x.html\ndo a\n")
	if p.Final != "" || p.Prototype != "" {
		t.Fatalf("Final and Prototype after the first task are task text, got %q / %q", p.Final, p.Prototype)
	}
	if !strings.Contains(p.Tasks[0].Description, "**Final:** `not plan level`") {
		t.Fatalf("task text lost the line, got %q", p.Tasks[0].Description)
	}
}

func TestParsePlanFilesOverlap(t *testing.T) {
	accepted := []struct{ name, src string }{
		{"no Files lines", "### Task 1: a\n### Task 2: b\n**Depends on:** none\n"},
		{"only one task lists the file", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** none\nedits pkg/a.go\n"},
		{"direct Depends", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** Task 1\n**Files:** `pkg/a.go`\n"},
		{"implicit Depends on the previous task", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Files:** `pkg/a.go`\n"},
		{"transitive Depends", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** Task 1\n**Files:** `pkg/b.go`\n### Task 3: c\n**Depends on:** Task 2\n**Files:** `pkg/a.go`, `pkg/c.go`\n"},
		{"different files side by side", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** none\n**Files:** `pkg/b.go`\n"},
	}
	for _, c := range accepted {
		t.Run(c.name, func(t *testing.T) {
			mustParsePlan(t, c.src)
		})
	}
	refused := []struct {
		name, src string
		errParts  []string
	}{
		{"unordered tasks", "### Task 1: one\n**Files:** `pkg/a.go`\n### Task 2: two\n**Depends on:** none\n**Files:** `pkg/b.go`, `pkg/a.go`\n",
			[]string{"1 (one)", "2 (two)", "pkg/a.go", "Depends on"}},
		{"siblings of one parent", "### Task 1: one\n### Task 2: two\n**Depends on:** Task 1\n**Files:** `x.ts`\n### Task 3: three\n**Depends on:** Task 1\n**Files:** `x.ts`\n",
			[]string{"2 (two)", "3 (three)", "x.ts"}},
		{"slashes and dot segments are normalised", "### Task 1: one\n**Files:** `pkg\\a.go`\n### Task 2: two\n**Depends on:** none\n**Files:** `./pkg//a.go`\n",
			[]string{"pkg/a.go"}},
		{"a second Files line continues the list", "### Task 1: one\n**Files:** `pkg/a.go`\n### Task 2: two\n**Depends on:** none\n**Files:** `pkg/b.go`\n**Files:** `pkg/a.go`\n",
			[]string{"pkg/a.go"}},
		{"paths without backticks", "### Task 1: one\n**Files:** pkg/a.go, pkg/b.go\n", []string{"task 1", "backticks"}},
		{"an empty Files line", "### Task 1: one\n**Files:**\n", []string{"task 1", "backticks"}},
		{"an absolute path", "### Task 1: one\n**Files:** `/abs/a.go`\n", []string{"relative to the repo root"}},
	}
	for _, c := range refused {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParsePlan(c.src)
			if err == nil {
				t.Fatal("want an error")
			}
			for _, part := range c.errParts {
				if !strings.Contains(err.Error(), part) {
					t.Fatalf("error %q should name %q", err, part)
				}
			}
		})
	}
}

func TestParsePlanFilesLineStaysInTheTaskText(t *testing.T) {
	p := mustParsePlan(t, "**Effort:** effort:abc\n\n### Task 1: a\n**Depends on:** none\n**Files:** `pkg/a.go`\n**Chunk:** #1 x\ndo a\n")
	if want := "**Files:** `pkg/a.go`\ndo a"; p.Tasks[0].Description != want {
		t.Fatalf("got description %q, want %q", p.Tasks[0].Description, want)
	}
	if !reflect.DeepEqual(p.Tasks[0].Chunks, []string{"#1 x"}) {
		t.Fatalf("a Chunk line after the Files line is still read, got %v", p.Tasks[0].Chunks)
	}
}

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

// fork ac548aa57: the plan reviewer is told which tasks have no Depends line, since reviewers read that as running at
// the same time as the task before, when the engine makes it wait. An explicit line naming the task before is not the
// default edge, though the two read the same.
func TestParsePlanImplicitDeps(t *testing.T) {
	p := mustParsePlan(t, "### Task 1: a\n### Task 2: b\n### Task 3: c\n**Depends on:** Task 2\n### Task 4: d\n**Depends on:** none\n### Task 5: e\n")
	if want := []string{"t-2", "t-5"}; !reflect.DeepEqual(p.ImplicitDeps, want) {
		t.Fatalf("ImplicitDeps = %v, want %v", p.ImplicitDeps, want)
	}
	if p := mustParsePlan(t, "### Task 1: a\n"); len(p.ImplicitDeps) != 0 {
		t.Fatalf("the first task has no task before it to wait for, got %v", p.ImplicitDeps)
	}
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

// A prose line that starts with inline code of backticks (```` ``` ````) opens no fence: CommonMark reads a backtick
// run followed by more backticks on the line as code spans. Run 911b6d3a's plan lost Tasks 7 to 13 to such a line.
func TestParsePlanInlineBackticksOpenNoFence(t *testing.T) {
	src := "### Task 1: a\n```` ``` ```` blocks draw as cards\n\n### Task 2: b\n"
	p := mustParsePlan(t, src)
	if len(p.Tasks) != 2 || p.Tasks[1].Label != "b" {
		t.Fatalf("an inline code line is not a fence, got %v", depLists(p.Tasks))
	}
}

// A fence still open at the end of the plan swallows every heading after it, so submit refuses it and names where it
// opened, rather than run a dag that silently lacks those tasks.
func TestParsePlanUnclosedFenceIsRefused(t *testing.T) {
	src := "### Task 1: a\ndo a\n\n### Task 2: b\n```go\nfunc x() {}\n\n### Task 3: c\n\n### Task 4: d\n"
	_, err := ParsePlan(src)
	if err == nil {
		t.Fatal("an unclosed fence must be refused")
	}
	for _, want := range []string{"task 2", "line 5", "2 task headings"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q should name %q", err, want)
		}
	}
	// open at the very end with no heading after it: the last task's text just runs on, which two older plans do
	tail := "### Task 1: a\ndo a\n```go\nfunc x() {}\n"
	if p, err := ParsePlan(tail); err != nil || len(p.Tasks) != 1 {
		t.Fatalf("a fence left open at the end with nothing after it parses, got %v, %v", p.Tasks, err)
	}
}

// A closing fence is the opener's character, at least as long, and nothing else on the line: a shorter run or one
// with text after it is fence content.
func TestParsePlanFenceClosesOnlyOnAMatchingRun(t *testing.T) {
	src := "### Task 1: a\n````markdown\n```\n### Task 2: sample\n``` not a closer\n````\n\n### Task 2: real\n"
	p := mustParsePlan(t, src)
	if len(p.Tasks) != 2 || p.Tasks[1].Label != "real" {
		t.Fatalf("got %v, want the sample heading kept as text", depLists(p.Tasks))
	}
	if !strings.Contains(p.Tasks[0].Description, "### Task 2: sample") {
		t.Fatalf("fenced lines stay in the task text, got %q", p.Tasks[0].Description)
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

// leads left off the tests and callers a task breaks, and the plan review sent the plan back for them (workflow scan p1)
func TestPlanFormatFilesLineListsWhatTheChangeBreaks(t *testing.T) {
	if !strings.Contains(PlanFormat, "every test or caller the change breaks") {
		t.Fatalf("the Files line must name the tests and callers a task's change breaks:\n%s", PlanFormat)
	}
}

// run bd67b1fe: a Check that found docker down exited 3 and the stage failed; the plan format now says the final
// stage reads Check's and Verify's exit 3 as "could not verify", and that a merge point does not
func TestPlanFormatSaysCheckAndVerifyMayExit3InTheFinalStage(t *testing.T) {
	for _, want := range []string{
		"In the final stage Check and Verify may exit 3 the same way",
		"at a merge point exit 3 still fails",
	} {
		if !strings.Contains(PlanFormat, want) {
			t.Fatalf("the format must say %q:\n%s", want, PlanFormat)
		}
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
		{"transitive Depends", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** Task 1 (calls a)\n**Files:** `pkg/b.go`\n### Task 3: c\n**Depends on:** Task 2 (calls b)\n**Files:** `pkg/a.go`, `pkg/c.go`\n"},
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

func TestParsePlanDependsReasons(t *testing.T) {
	accepted := []struct{ name, src, want string }{
		{"shared file and no reason", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** Task 1\n**Files:** `pkg/a.go`, `pkg/b.go`\n", "t-1"},
		{"no shared file with a reason", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** Task 1 (uses the topOf rows it adds)\n**Files:** `pkg/b.go`\n", "t-1"},
		{"a reason holding commas and parentheses", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** Task 1 (calls parse(x), then lanes)\n**Files:** `pkg/b.go`\n", "t-1"},
		{"a mixed list", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** none\n**Files:** `pkg/b.go`\n### Task 3: c\n**Depends on:** Task 1 (uses X), Task 2\n**Files:** `pkg/b.go`, `pkg/c.go`\n", "t-1,t-2"},
		{"the implicit edge", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Files:** `pkg/b.go`\n", "t-1"},
		{"the dependent task has no Files line", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** Task 1\n", "t-1"},
		{"the task it waits on has no Files line", "### Task 1: a\n### Task 2: b\n**Depends on:** Task 1\n**Files:** `pkg/b.go`\n", "t-1"},
	}
	for _, c := range accepted {
		t.Run(c.name, func(t *testing.T) {
			p := mustParsePlan(t, c.src)
			if got := strings.Join(p.Tasks[len(p.Tasks)-1].Deps, ","); got != c.want {
				t.Fatalf("the reason is dropped and the ids stay, got %q, want %q", got, c.want)
			}
		})
	}
	refused := []struct {
		name, src string
		errParts  []string
	}{
		{"no shared file and no reason", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: fixtures\n**Depends on:** none\n**Files:** `pkg/b.go`\n### Task 3: evidence\n**Depends on:** Task 2\n**Files:** `pkg/c.go`\n",
			[]string{"task 3 (evidence)", "task 2 (fixtures)", "share no path", "parentheses", "drop the edge", "scenario"}},
		{"the bare half of a mixed list", "### Task 1: a\n**Files:** `pkg/a.go`\n### Task 2: b\n**Depends on:** none\n**Files:** `pkg/b.go`\n### Task 3: c\n**Depends on:** Task 1 (uses X), Task 2\n**Files:** `pkg/c.go`\n",
			[]string{"task 3 (c)", "task 2 (b)"}},
		{"empty parentheses", "### Task 1: a\n### Task 2: b\n**Depends on:** Task 1 ()\n", []string{"empty", "Task 1"}},
		{"an unclosed reason", "### Task 1: a\n### Task 2: b\n**Depends on:** Task 1 (uses x\n", []string{"Task 1 (uses x"}},
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

func TestTaskFilesReadsBackTheFilesLine(t *testing.T) {
	p := mustParsePlan(t, "# P\n\n### Task 1: a\n**Files:** `pkg/a.go`, `web/b.ts`\n\nDo a.\n")
	if got, want := TaskFiles(p.Tasks[0].Description), []string{"pkg/a.go", "web/b.ts"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("TaskFiles = %v, want %v", got, want)
	}
	if got := TaskFiles("Do a.\n**Files:** pkg/a.go"); got != nil {
		t.Fatalf("an unparseable Files line must add none, got %v", got)
	}
	if got := TaskFiles("Do a."); got != nil {
		t.Fatalf("a task with no Files line must list none, got %v", got)
	}
}

// a directory entry ends in a slash on the Files line; reading it back drops the slash like any other spelling, so a
// path under it matches the entry as a prefix
func TestTaskFilesReadsADirectoryEntry(t *testing.T) {
	p := mustParsePlan(t, "# P\n\n### Task 1: a\n**Files:** `pkg/gen/`, `web\\b.ts`\n\nDo a.\n")
	if got, want := TaskFiles(p.Tasks[0].Description), []string{"pkg/gen", "web/b.ts"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("TaskFiles = %v, want %v", got, want)
	}
}

// Kael sync 11-13 (dc1c00b4a): a fence opened on a list item ("- ```bash") is a fence, so its indented closer must not
// open a phantom one that hides every later task heading
func TestParsePlanFenceOpenedOnAListItem(t *testing.T) {
	for name, opener := range map[string]string{
		"dash":    "- ```bash\n  go test ./pkg/x\n  ```\n",
		"ordered": "1. ```bash\n   go test ./pkg/x\n   ```\n",
		"tilde":   "- ~~~bash\n  go test ./pkg/x\n  ~~~\n",
	} {
		t.Run(name, func(t *testing.T) {
			src := "### Task 1: a\n- run:\n" + opener + "\n### Task 2: b\n**Depends on:** none\n\n### Task 3: c\n"
			p := mustParsePlan(t, src)
			if want := []string{"t-1:", "t-2:", "t-3:t-2"}; !reflect.DeepEqual(depLists(p.Tasks), want) {
				t.Fatalf("the list item's closing fence must not open a new one, got %v, want %v", depLists(p.Tasks), want)
			}
		})
	}
	// a heading inside a list item's fence stays text
	src := "### Task 1: a\n- ```md\n  ### Task 2: sample\n  ```\n\n### Task 2: real\n"
	p := mustParsePlan(t, src)
	if len(p.Tasks) != 2 || p.Tasks[1].Label != "real" || !strings.Contains(p.Tasks[0].Description, "### Task 2: sample") {
		t.Fatalf("got %v, want the fenced sample heading kept as text", depLists(p.Tasks))
	}
}

// an inner ``` block inside a ```` fence is content: only a run at least as long closes the outer one
func TestParsePlanFenceClosesOnlyOnALongEnoughRun(t *testing.T) {
	src := "### Task 1: a\n````markdown\n```md\n### Task 9: sample\n```\n````\n\n### Task 2: b\n"
	p := mustParsePlan(t, src)
	if want := []string{"t-1:", "t-2:t-1"}; !reflect.DeepEqual(depLists(p.Tasks), want) {
		t.Fatalf("an inner ``` block must not close a ```` fence, got %v, want %v", depLists(p.Tasks), want)
	}
	if !strings.Contains(p.Tasks[0].Description, "### Task 9: sample") {
		t.Fatalf("fenced lines stay in the task text, got %q", p.Tasks[0].Description)
	}
}

// Kael sync 11-13 (725085b17): a quoted document's own same-length ```bash block does not close the ```markdown block
// around it, and an inline span on a list item opens no fence
func TestParsePlanFenceShapes(t *testing.T) {
	for name, src := range map[string]string{
		"nested same-length fences":  "### Task 1: a\n```markdown\n# Doc\n```bash\ngo test\n```\n```\n\n### Task 2: b\n\n### Task 3: c\n",
		"inline span on a list item": "### Task 1: a\n- ```go test ./...``` must pass\n\n### Task 2: b\n\n### Task 3: c\n",
	} {
		t.Run(name, func(t *testing.T) {
			p := mustParsePlan(t, src)
			if want := []string{"t-1:", "t-2:t-1", "t-3:t-2"}; !reflect.DeepEqual(depLists(p.Tasks), want) {
				t.Fatalf("got %v, want %v", depLists(p.Tasks), want)
			}
		})
	}
}

// a fence with no inner block reads as before, and one left open that hid nothing still parses (0e9d917d8)
func TestParsePlanFenceShapesKeepTheOldReading(t *testing.T) {
	plain := "### Task 1: a\n```go\nfunc x() {}\n```\n\n### Task 2: b\n"
	if p := mustParsePlan(t, plain); len(p.Tasks) != 2 {
		t.Fatalf("got %v", depLists(p.Tasks))
	}
	tail := "### Task 1: a\ndo a\n- ```go\n  func x() {}\n"
	if p, err := ParsePlan(tail); err != nil || len(p.Tasks) != 1 {
		t.Fatalf("a list-item fence left open at the end with nothing after it parses, got %v, %v", p.Tasks, err)
	}
}

// a fence left open over a task heading is refused, naming where it opened
func TestParsePlanRefusesAnUnclosedFence(t *testing.T) {
	src := "### Task 1: a\n```bash\ngo test\n\n### Task 2: b\n"
	if _, err := ParsePlan(src); err == nil || !strings.Contains(err.Error(), "never closed") {
		t.Fatalf("want an unclosed-fence error, got %v", err)
	}
	src = "### Task 1: a\n- ```bash\n  go test\n\n### Task 2: b\n"
	if _, err := ParsePlan(src); err == nil || !strings.Contains(err.Error(), "never closed") {
		t.Fatalf("a list-item fence left open over a heading is refused too, got %v", err)
	}
}

// Kael sync 11-13 (a2c52d70e): a BOM before the first line hid the title and the plan-level lines
func TestParsePlanStripsABOM(t *testing.T) {
	p := mustParsePlan(t, "\xef\xbb\xbf**Verify:** `go test ./...`\n\n### Task 1: a\nbody\n")
	if p.Verify != "go test ./..." || p.Preamble != "" {
		t.Fatalf("got verify %q, preamble %q", p.Verify, p.Preamble)
	}
	p = mustParsePlan(t, "\xef\xbb\xbf# The plan\n\n### Task 1: a\nbody\n")
	if p.Title != "The plan" || p.Preamble != "" {
		t.Fatalf("got title %q, preamble %q", p.Title, p.Preamble)
	}
}

// Kael sync 11-13 (19be11b27): a near-miss heading would otherwise fold the task into the one before it
func TestParsePlanRefusesANearMissTaskHeading(t *testing.T) {
	for _, heading := range []string{"### Task 3 - c", "#### Task 3: c", " ### Task 3: c", "### task 3: c"} {
		t.Run(heading, func(t *testing.T) {
			_, err := ParsePlan("### Task 1: a\nx\n### Task 2: b\ny\n" + heading + "\nz\n")
			if err == nil || !strings.Contains(err.Error(), "not a task heading") {
				t.Fatalf("got err %v, want %q refused", err, heading)
			}
		})
	}
}

// engine F5 (65f44bce3): a task heading written with one # folds into the task before it
func TestParsePlanRefusesASingleHashTaskHeading(t *testing.T) {
	src := "### Task 1: a\ndo a\n\n# Task 2: b\n**Depends on:** none\ndo b\n"
	if _, err := ParsePlan(src); err == nil || !strings.Contains(err.Error(), "is not a task heading") {
		t.Fatalf("want the near-miss heading error, got %v", err)
	}
}

// Kael sync 11-13 (6c55c3aef): the plan's own "# <title>" may start with "Task <n>"; only that one line is spared
func TestParsePlanTitleMayStartWithTask(t *testing.T) {
	p := mustParsePlan(t, "# Task 3 follow-ups: sessions find\n\n### Task 1: a\ndo a\n")
	if p.Title != "Task 3 follow-ups: sessions find" || len(p.Tasks) != 1 {
		t.Fatalf("want the title read and one task, got title %q, %d tasks", p.Title, len(p.Tasks))
	}
	if _, err := ParsePlan("# Plan\n# Task 1: a\ndo a\n"); err == nil || !strings.Contains(err.Error(), "is not a task heading") {
		t.Fatalf("want the near-miss heading error, got %v", err)
	}
}

// a heading inside a fence is text, near-miss or not
func TestParsePlanNearMissHeadingInAFenceIsText(t *testing.T) {
	p := mustParsePlan(t, "### Task 1: a\n```md\n#### Task 3: sample\n# Task 2 - sample\n```\n\n### Task 2: b\n")
	if len(p.Tasks) != 2 || !strings.Contains(p.Tasks[0].Description, "#### Task 3: sample") {
		t.Fatalf("got %v", depLists(p.Tasks))
	}
}

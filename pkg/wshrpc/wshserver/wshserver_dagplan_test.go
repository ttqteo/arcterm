// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestDagSubmitFromPlanPath(t *testing.T) {
	ctx := context.Background()
	// prototype, when given, is the canvas the run was started with
	newRun := func(t *testing.T, prototype ...string) (string, string) {
		t.Helper()
		ch, err := wstore.CreateChannel(ctx, "dag-plan-test", t.TempDir())
		if err != nil {
			t.Fatalf("CreateChannel: %v", err)
		}
		run := jarvis.NewRun("ship coupons", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
		run.Status = jarvis.RunStatus_Planning
		if len(prototype) > 0 {
			run.Prototype = prototype[0]
		}
		if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
			t.Fatalf("AppendRun: %v", err)
		}
		return ch.OID, run.ID
	}
	writePlan := func(t *testing.T, name, src string) string {
		t.Helper()
		path := filepath.Join(t.TempDir(), name)
		if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}
	const plan = "# Coupon codes\n\n### Task 1: input\nadd the field\n\n### Task 2: totals\n**Depends on:** none\n\n### Task 3: tests\n**Depends on:** Task 1, Task 2\n"

	t.Run("the plan's tasks, dependencies and title become the dag", func(t *testing.T) {
		channelId, runId := newRun(t)
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "plan.md", plan)})
		if err != nil {
			t.Fatal(err)
		}
		got := make([]string, len(g.Tasks))
		for i, task := range g.Tasks {
			got[i] = task.ID + " " + task.Label + " <- " + strings.Join(task.Deps, ",")
		}
		if want := []string{"t-1 input <- ", "t-2 totals <- ", "t-3 tests <- t-1,t-2"}; !reflect.DeepEqual(got, want) {
			t.Fatalf("tasks = %v, want %v", got, want)
		}
		if g.Title != "Coupon codes" || g.Tasks[0].Description != "add the field" {
			t.Fatalf("title %q, task 1 text %q", g.Title, g.Tasks[0].Description)
		}
		// nothing pinned a width, so the plan's shape picks it: two tasks can start at once
		if g.Parallelism != 2 {
			t.Fatalf("parallelism = %d, want 2", g.Parallelism)
		}
	})

	t.Run("a plan without a title is named by its file", func(t *testing.T) {
		channelId, runId := newRun(t)
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "2026-09-15-coupons.md", "### Task 1: input\n")})
		if err != nil {
			t.Fatal(err)
		}
		if g.Title != "2026-09-15-coupons" {
			t.Fatalf("title = %q", g.Title)
		}
	})

	t.Run("a rejected plan leaves the run free to take a valid one", func(t *testing.T) {
		channelId, runId := newRun(t)
		dir := t.TempDir()
		cases := []struct {
			name    string
			data    wshrpc.CommandDagSubmitData
			errPart string
		}{
			{"relative path", wshrpc.CommandDagSubmitData{PlanPath: "plan.md"}, "absolute"},
			{"plan path and tasks together", wshrpc.CommandDagSubmitData{PlanPath: writePlan(t, "plan.md", plan), Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "a"}}}, "not both"},
			{"missing plan file", wshrpc.CommandDagSubmitData{PlanPath: filepath.Join(dir, "missing.md")}, "missing.md"},
			{"unparseable plan", wshrpc.CommandDagSubmitData{PlanPath: writePlan(t, "prose.md", "just prose\n")}, "no tasks"},
			{"spec without a plan", wshrpc.CommandDagSubmitData{SpecPath: writePlan(t, "spec.md", "# spec\n"), Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "a"}}}, "needs planpath"},
			{"relative spec path", wshrpc.CommandDagSubmitData{PlanPath: writePlan(t, "plan.md", plan), SpecPath: "spec.md"}, "absolute"},
			{"missing spec file", wshrpc.CommandDagSubmitData{PlanPath: writePlan(t, "plan.md", plan), SpecPath: filepath.Join(dir, "missing-spec.md")}, "missing-spec.md"},
		}
		for _, c := range cases {
			c.data.ChannelId, c.data.RunId = channelId, runId
			_, err := (&WshServer{}).DagSubmitCommand(ctx, c.data)
			if err == nil || !strings.Contains(err.Error(), c.errPart) {
				t.Fatalf("%s: error %v should name %q", c.name, err, c.errPart)
			}
		}
		if _, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "plan.md", plan)}); err != nil {
			t.Fatalf("valid plan after rejections: %v", err)
		}
	})

	t.Run("the plan's Verify and Setup commands are stored on the dag", func(t *testing.T) {
		channelId, runId := newRun(t)
		src := "**Verify:** `task test`\n**Setup:** `task worktree:prepare`\n\n### Task 1: input\n"
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "plan.md", src)})
		if err != nil {
			t.Fatal(err)
		}
		if g.Verify != "task test" || g.Setup != "task worktree:prepare" {
			t.Fatalf("verify %q, setup %q", g.Verify, g.Setup)
		}
	})

	t.Run("the plan's Check command is stored on the dag", func(t *testing.T) {
		channelId, runId := newRun(t)
		src := "**Check:** `task check:ts`\n\n### Task 1: input\n"
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "plan.md", src)})
		if err != nil {
			t.Fatal(err)
		}
		if g.Check != "task check:ts" {
			t.Fatalf("check %q", g.Check)
		}
	})

	t.Run("the plan's Final command and Prototype are stored on the dag", func(t *testing.T) {
		channelId, runId := newRun(t)
		src := "**Final:** `node scripts/cdp/final-verify.mjs board`\n**Prototype:** .superpowers/design/board/board.dc.html\n\n### Task 1: input\n"
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "plan.md", src)})
		if err != nil {
			t.Fatal(err)
		}
		if g.FinalCmd != "node scripts/cdp/final-verify.mjs board" || g.Prototype != ".superpowers/design/board/board.dc.html" {
			t.Fatalf("final %q, prototype %q", g.FinalCmd, g.Prototype)
		}
	})

	t.Run("the run's prototype wins over the plan's", func(t *testing.T) {
		channelId, runId := newRun(t, "C:/canvas/Main.dc.html")
		src := "**Prototype:** .superpowers/design/other/Main.dc.html\n\n### Task 1: input\n"
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "plan.md", src)})
		if err != nil {
			t.Fatal(err)
		}
		if g.Prototype != "C:/canvas/Main.dc.html" {
			t.Fatalf("prototype = %q, want the run's", g.Prototype)
		}
	})

	t.Run("the plan and spec paths are stored on the dag", func(t *testing.T) {
		channelId, runId := newRun(t)
		planPath, specPath := writePlan(t, "plan.md", plan), writePlan(t, "spec.md", "# spec\n")
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: planPath, SpecPath: specPath})
		if err != nil {
			t.Fatal(err)
		}
		if g.PlanPath != planPath || g.SpecPath != specPath {
			t.Fatalf("planpath %q, specpath %q", g.PlanPath, g.SpecPath)
		}
	})

	t.Run("the plan's effort and chunks are stored, and must exist", func(t *testing.T) {
		effort := &waveobj.Effort{Title: "tracker", Chunks: []waveobj.EffortChunk{{Label: "#8 first", Status: "pending"}, {Label: "3", Status: "pending"}}}
		if err := effortstore.Create(ctx, effort); err != nil {
			t.Fatal(err)
		}
		src := func(effortOID, label string) string {
			return "**Effort:** effort:" + effortOID + "\n\n### Task 1: input\n**Chunk:** " + label + "\nadd the field\n"
		}
		channelId, runId := newRun(t)
		for _, c := range []struct{ name, effort, label, errPart string }{
			{"missing effort", "no-such-effort", "#8 first", "no-such-effort"},
			{"missing chunk label", effort.OID, "#9 nope", "#9 nope"},
			{"a position is not a label", effort.OID, "2", `"2"`},
		} {
			_, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "plan.md", src(c.effort, c.label))})
			if err == nil || !strings.Contains(err.Error(), c.errPart) {
				t.Fatalf("%s: error %v should name %q", c.name, err, c.errPart)
			}
		}
		g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "plan.md", src(effort.OID, "#8 first"))})
		if err != nil {
			t.Fatalf("valid effort and chunk after rejections: %v", err)
		}
		if g.EffortOID != effort.OID || !reflect.DeepEqual(g.Tasks[0].Chunks, []string{"#8 first"}) || g.Tasks[0].Description != "add the field" {
			t.Fatalf("effort %q, chunks %v, text %q", g.EffortOID, g.Tasks[0].Chunks, g.Tasks[0].Description)
		}
	})

	t.Run("a Model line may name a harness; one that cannot work is refused naming the task", func(t *testing.T) {
		// whether agy is installed is the machine's business; the catalog's run-worker flag is what this checks
		oldValidate := validateHarness
		validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
			return harness.ValidateCapable(runtime, op)
		}
		t.Cleanup(func() { validateHarness = oldValidate })
		src := func(line string) string {
			return "### Task 1: input\nadd the field\n\n### Task 2: totals\n**Depends on:** none\n**Model:** " + line + "\ndo it\n"
		}
		channelId, runId := newRun(t)
		for _, c := range []struct{ name, line, errPart string }{
			{"a harness that is not a run worker", "opencode:x", `task "t-2"`},
			{"such a harness alone", "opencode", `task "t-2"`},
			{"a model the harness does not take", "agy:Not_A_Slug", `task "t-2"`},
		} {
			_, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "plan.md", src(c.line))})
			if err == nil || !strings.Contains(err.Error(), c.errPart) {
				t.Fatalf("%s: error %v should name %q", c.name, err, c.errPart)
			}
		}
		for _, c := range []struct{ line, runtime, model string }{
			{"agy:gemini-3-pro", "agy", "gemini-3-pro"},
			{"agy", "agy", ""},
			{"pi:openrouter/x:free", "pi", "openrouter/x:free"},
			{"sonnet", "", "sonnet"},
		} {
			channelId, runId := newRun(t)
			g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: channelId, RunId: runId, PlanPath: writePlan(t, "plan.md", src(c.line))})
			if err != nil {
				t.Fatalf("%s: %v", c.line, err)
			}
			if got := g.Tasks[1].RunSpec; got.Runtime != c.runtime || got.Model != c.model {
				t.Fatalf("%s: task 2 runs on %q / %q, want %q / %q", c.line, got.Runtime, got.Model, c.runtime, c.model)
			}
		}
	})

	t.Run("a task submitted as JSON cannot name chunks without an effort", func(t *testing.T) {
		channelId, runId := newRun(t)
		_, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
			ChannelId: channelId, RunId: runId, Title: "t", Parallelism: 1,
			Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "a", Chunks: []string{"#8 first"}}},
		})
		if err == nil || !strings.Contains(err.Error(), "no effort") {
			t.Fatalf("want a refusal naming the missing effort, got %v", err)
		}
	})
}

func TestDagSubmitRoundExtendsTheDag(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	write := func(name, src string) string {
		t.Helper()
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}
	ch, err := wstore.CreateChannel(ctx, "dag-round-test", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("ship coupons", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Status = jarvis.RunStatus_Planning
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	submit := func(data wshrpc.CommandDagSubmitData) (*waveobj.TaskGroup, error) {
		data.ChannelId, data.RunId = ch.OID, run.ID
		return (&WshServer{}).DagSubmitCommand(ctx, data)
	}
	fixPlan := write("fix.md", "**Verify:** `echo fix-verify`\n**Setup:** `echo fix-setup`\n**Check:** `echo fix-check`\n**Final:** `echo fix-final`\n\n"+
		"### Task 1: widen\nwiden the column\n\n### Task 2: cover\n**Depends on:** Task 1\n")

	if _, err := submit(wshrpc.CommandDagSubmitData{PlanPath: fixPlan, Round: true}); err == nil || !strings.Contains(err.Error(), "no dag") {
		t.Fatalf("a round on a run with no dag: want a refusal, got %v", err)
	}
	planPath, specPath := write("plan.md", "**Verify:** `echo verify`\n**Check:** `echo check`\n**Final:** `echo final`\n\n### Task 1: a\n\n### Task 2: b\n\n### Task 3: c\n"), write("spec.md", "# spec\n")
	g, err := submit(wshrpc.CommandDagSubmitData{PlanPath: planPath, SpecPath: specPath})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := submit(wshrpc.CommandDagSubmitData{PlanPath: fixPlan, Round: true}); err == nil || !strings.Contains(err.Error(), "the final stage has not failed") {
		t.Fatalf("a round before the final stage failed: want a refusal, got %v", err)
	}
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		for i := range cur.Tasks {
			cur.Tasks[i].State = orchestrate.TaskState_Done
		}
		cur.PlanReview = &waveobj.PlanReviewStage{State: orchestrate.PlanReviewState_Passed, Round: 1}
		cur.Final = &waveobj.FinalStage{State: orchestrate.FinalState_Failed, Round: 1, Detail: "FAIL"}
		orchestrate.RecomputeDagStatus(cur)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	// a round runs the run's own commands: a fix plan naming others is refused, not silently ignored
	if _, err := submit(wshrpc.CommandDagSubmitData{PlanPath: fixPlan, Round: true}); err == nil || !strings.Contains(err.Error(), "**Verify:** line") {
		t.Fatalf("a fix plan with its own commands: want a refusal naming the line, got %v", err)
	}
	if cur, err := wstore.GetDag(ctx, g.OID); err != nil || len(cur.Tasks) != 3 {
		t.Fatalf("a refused round leaves the dag alone, got %v", err)
	}
	// repeating the run's own line is fine
	tasksOnly := write("fix-tasks.md", "**Final:** `echo final`\n\n### Task 1: widen\nwiden the column\n\n### Task 2: cover\n**Depends on:** Task 1\n")

	// a spec passed with the round is ignored: the round implements the run's spec
	got, err := submit(wshrpc.CommandDagSubmitData{PlanPath: tasksOnly, SpecPath: write("other-spec.md", "# other\n"), Round: true})
	if err != nil {
		t.Fatal(err)
	}
	var shape []string
	for _, task := range got.Tasks[3:] {
		shape = append(shape, task.ID+" <- "+strings.Join(task.Deps, ","))
	}
	if len(got.Tasks) != 5 || !reflect.DeepEqual(shape, []string{"t-4 <- ", "t-5 <- t-4"}) {
		t.Fatalf("the fix tasks are t-4 and t-5, t-5 after t-4, got %d tasks %v", len(got.Tasks), shape)
	}
	if got.Verify != "echo verify" || got.Setup != "" || got.Check != "echo check" || got.FinalCmd != "echo final" {
		t.Fatalf("the dag keeps its commands, got verify %q setup %q check %q final %q", got.Verify, got.Setup, got.Check, got.FinalCmd)
	}
	if got.PlanPath != planPath || got.SpecPath != specPath || got.PlanReview.State != orchestrate.PlanReviewState_Passed {
		t.Fatalf("the dag keeps its plan, spec and passed plan review, got %q %q %+v", got.PlanPath, got.SpecPath, got.PlanReview)
	}
	if got.Final == nil || got.Final.Round != 2 || got.Final.State != "" {
		t.Fatalf("round 2 is set up, not started, got %+v", got.Final)
	}
	if !strings.HasPrefix(got.Tasks[3].Description, "Fix round 2: this is task 1 of the fix plan at "+tasksOnly+";") {
		t.Fatalf("a checkout-landed round names its fix plan by its absolute path, got %q", got.Tasks[3].Description)
	}
}

func TestDagPlanPreview(t *testing.T) {
	ctx := context.Background()
	write := func(t *testing.T, name, src string) string {
		t.Helper()
		path := filepath.Join(t.TempDir(), name)
		if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}

	t.Run("reports the plan's name, commands and shape", func(t *testing.T) {
		src := "# Coupons\n\n**Verify:** `task test`\n**Check:** `task check:ts`\n\n### Task 1: input\n**Depends on:** none\n\n### Task 2: totals\n**Depends on:** none\n\n### Task 3: tests\n**Depends on:** Task 1, Task 2\n"
		got, err := (&WshServer{}).DagPlanPreviewCommand(ctx, wshrpc.CommandDagPlanPreviewData{PlanPath: write(t, "plan.md", src)})
		if err != nil {
			t.Fatal(err)
		}
		want := wshrpc.CommandDagPlanPreviewRtnData{
			Title:  "Coupons",
			Verify: "task test",
			Check:  "task check:ts",
			Shape:  wshrpc.DagPlanShape{Tasks: 3, Lanes: 3, LongestChain: 2},
			Tasks: []wshrpc.DagPlanPreviewTask{
				{Id: "t-1", Title: "input", Lane: 1},
				{Id: "t-2", Title: "totals", Lane: 2},
				{Id: "t-3", Title: "tests", Lane: 3, Deps: []string{"t-1", "t-2"}},
			},
		}
		if !reflect.DeepEqual(*got, want) {
			t.Fatalf("preview = %+v, want %+v", *got, want)
		}
	})

	t.Run("shows a plan's Model line as written", func(t *testing.T) {
		src := "### Task 1: a\n**Model:** agy:gemini-3-pro\n\n### Task 2: b\n**Model:** agy\n\n### Task 3: c\n**Model:** sonnet\n\n### Task 4: d\n**Model:** pi:openrouter/x:free\n\n### Task 5: e\n"
		got, err := (&WshServer{}).DagPlanPreviewCommand(ctx, wshrpc.CommandDagPlanPreviewData{PlanPath: write(t, "plan.md", src)})
		if err != nil {
			t.Fatal(err)
		}
		lines := make([]string, len(got.Tasks))
		for i, task := range got.Tasks {
			lines[i] = task.Model
		}
		if want := []string{"agy:gemini-3-pro", "agy", "sonnet", "pi:openrouter/x:free", ""}; !reflect.DeepEqual(lines, want) {
			t.Fatalf("model lines = %q, want %q", lines, want)
		}
	})

	t.Run("a plan with no title is named by its file", func(t *testing.T) {
		got, err := (&WshServer{}).DagPlanPreviewCommand(ctx, wshrpc.CommandDagPlanPreviewData{PlanPath: write(t, "2026-09-15-coupons.md", "### Task 1: input\n")})
		if err != nil {
			t.Fatal(err)
		}
		if got.Title != "2026-09-15-coupons" {
			t.Fatalf("title = %q", got.Title)
		}
	})

	t.Run("a relative path is read from the project", func(t *testing.T) {
		plan := write(t, "coupons.md", "### Task 1: input\n")
		got, err := (&WshServer{}).DagPlanPreviewCommand(ctx, wshrpc.CommandDagPlanPreviewData{PlanPath: "coupons.md", ProjectPath: filepath.Dir(plan)})
		if err != nil {
			t.Fatal(err)
		}
		if got.Title != "coupons" || got.Shape.Tasks != 1 {
			t.Fatalf("preview = %+v", *got)
		}
	})

	t.Run("a plan that will not run is refused with the parser's message", func(t *testing.T) {
		cases := []struct {
			name    string
			path    string
			errPart string
		}{
			{"relative path with no project", "plan.md", "absolute"},
			{"missing file", filepath.Join(t.TempDir(), "missing.md"), "missing.md"},
			{"no tasks", write(t, "prose.md", "just prose\n"), "no tasks"},
		}
		for _, c := range cases {
			_, err := (&WshServer{}).DagPlanPreviewCommand(ctx, wshrpc.CommandDagPlanPreviewData{PlanPath: c.path})
			if err == nil || !strings.Contains(err.Error(), c.errPart) {
				t.Fatalf("%s: error %v should name %q", c.name, err, c.errPart)
			}
		}
	})
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func skipFinding(file string) wshrpc.GoalpostFinding {
	return wshrpc.GoalpostFinding{Rule: "test-skip", File: file, Title: "test skipped", Before: []string{"it('adds', () => {"}, After: []string{"it.skip('adds', () => {"}}
}

func TestReviewPromptGoalposts(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "add sums", ReviewBase: "base"}}}
	task := &g.Tasks[0]
	worker := &waveobj.Run{EndCommit: "tip", Evidence: &waveobj.RunEvidence{Summary: "## Done\nsums"}}
	today := reviewPrompt(g, task, worker, nil, nil)
	if got := reviewPrompt(g, task, worker, nil, []wshrpc.GoalpostFinding{}); got != today {
		t.Fatal("no findings must leave the prompt as it is")
	}
	if strings.Contains(today, "lower a check") {
		t.Fatal("no findings must add no section")
	}

	later := skipFinding("a.test.ts")
	later.After = []string{"it.skip('adds two', () => {"}
	noVerify := wshrpc.GoalpostFinding{Rule: "no-verify", Title: "commit hooks bypassed", After: []string{"git commit --no-verify"}}
	findings := []wshrpc.GoalpostFinding{skipFinding("a.test.ts"), noVerify, later, skipFinding("b.test.ts")}
	got := reviewPrompt(g, task, worker, nil, findings)

	var lines []string
	for _, l := range strings.Split(got, "\n") {
		if strings.HasPrefix(l, "- [") {
			lines = append(lines, l)
		}
	}
	if len(lines) != 3 {
		t.Fatalf("want one line per distinct finding (3), got %d:\n%s", len(lines), strings.Join(lines, "\n"))
	}
	for i, want := range []string{"[test-skip] a.test.ts: test skipped", "[no-verify] commit hooks bypassed", "[test-skip] b.test.ts: test skipped"} {
		if !strings.HasPrefix(lines[i], "- "+want) {
			t.Errorf("line %d: want rule, file and title %q, got %q", i, want, lines[i])
		}
	}
	if !strings.Contains(lines[0], "adds two") {
		t.Errorf("a repeated finding must keep the latest samples, got %q", lines[0])
	}
	if !strings.Contains(got, "Pass or fail each one by name") {
		t.Error("the section must tell the reviewer to judge each finding")
	}
	if strings.Index(got, "The worker reported") > strings.Index(got, "[test-skip]") {
		t.Error("the findings follow the worker's report")
	}
	if strings.Replace(got, "\n\n"+goalpostSection(findings), "", 1) != today {
		t.Error("findings must add only their section")
	}
}

func TestGoalpostSampleIsClipped(t *testing.T) {
	long := strings.Repeat("x", 500)
	got := goalpostSample([]string{"a", long, "c", "d", "e"})
	if strings.Count(got, "`") != 2*goalpostSampleLines || !strings.HasSuffix(got, "…") {
		t.Fatalf("want the first %d lines and a mark for the rest, got %q", goalpostSampleLines, got)
	}
	if strings.Contains(got, long) {
		t.Fatal("a long line must be clipped")
	}
}

// seedGoalpostWorker is a running task t-0 whose current worker is a run that works it.
func seedGoalpostWorker(t *testing.T) (context.Context, *waveobj.TaskGroup, *waveobj.Run) {
	t.Helper()
	ctx, dag := seedPendingDag(t)
	worker := appendTaskRun(t, ctx, dag, "t-0", false)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Running
		g.Tasks[0].RunID = worker.ID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return ctx, dag, worker
}

func appendTaskRun(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup, taskID string, review bool) *waveobj.Run {
	t.Helper()
	run := jarvis.NewRun("goal", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	run.DagORef = dag.OID
	run.TaskId = taskID
	run.Review = review
	if err := wstore.AppendRun(ctx, dag.ChannelId, run); err != nil {
		t.Fatal(err)
	}
	return &run
}

func goalpostEvents(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup) []waveobj.RunEvent {
	t.Helper()
	evs, err := wstore.QueryRunEventsByKind(ctx, dag.ChannelId, dag.RunID, []string{waveobj.RunEventKindTaskGoalpost}, 0)
	if err != nil {
		t.Fatal(err)
	}
	return evs
}

func TestRecordGoalposts(t *testing.T) {
	findings := []wshrpc.GoalpostFinding{skipFinding("a.test.ts")}

	t.Run("the task's current worker", func(t *testing.T) {
		ctx, dag, worker := seedGoalpostWorker(t)
		ok, err := RecordGoalposts(ctx, dag.OID, worker.ID, findings)
		if err != nil || !ok {
			t.Fatalf("want recorded, got %v, %v", ok, err)
		}
		evs := goalpostEvents(t, ctx, dag)
		if len(evs) != 1 {
			t.Fatalf("want one task-goalpost event, got %d", len(evs))
		}
		var d struct {
			TaskId   string                   `json:"taskid"`
			RunId    string                   `json:"runid"`
			Findings []wshrpc.GoalpostFinding `json:"findings"`
		}
		if err := json.Unmarshal(evs[0].Detail, &d); err != nil {
			t.Fatal(err)
		}
		if d.TaskId != "t-0" || d.RunId != worker.ID || len(d.Findings) != 1 || d.Findings[0].Title != "test skipped" {
			t.Fatalf("want the task, the worker and the finding, got %+v", d)
		}
	})

	notRecorded := map[string]func(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup, worker *waveobj.Run) string{
		"the task's reviewer": func(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup, _ *waveobj.Run) string {
			return appendTaskRun(t, ctx, dag, "t-0", true).ID
		},
		"a retired attempt": func(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup, worker *waveobj.Run) string {
			newer := appendTaskRun(t, ctx, dag, "t-0", false)
			if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
				g.Tasks[0].RunID = newer.ID
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			return worker.ID
		},
		"a run with no task": func(t *testing.T, ctx context.Context, dag *waveobj.TaskGroup, _ *waveobj.Run) string {
			return appendTaskRun(t, ctx, dag, "", false).ID
		},
	}
	for name, caller := range notRecorded {
		t.Run(name, func(t *testing.T) {
			ctx, dag, worker := seedGoalpostWorker(t)
			ok, err := RecordGoalposts(ctx, dag.OID, caller(t, ctx, dag, worker), findings)
			if err != nil || ok {
				t.Fatalf("want not recorded and no error, got %v, %v", ok, err)
			}
			if n := len(goalpostEvents(t, ctx, dag)); n != 0 {
				t.Fatalf("want no event, got %d", n)
			}
		})
	}

	t.Run("no findings", func(t *testing.T) {
		ctx, dag, worker := seedGoalpostWorker(t)
		if _, err := RecordGoalposts(ctx, dag.OID, worker.ID, nil); err == nil {
			t.Fatal("an empty findings slice must be an error")
		}
	})
}

func TestGoalpostsForTask(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	for _, ev := range []struct {
		taskID string
		file   string
	}{{"t-0", "first.ts"}, {"t-1", "other.ts"}, {"t-0", "second.ts"}} {
		detail := map[string]any{"taskid": ev.taskID, "runid": "r", "findings": []wshrpc.GoalpostFinding{skipFinding(ev.file)}}
		if _, err := wstore.AppendRunEvent(ctx, dag.ChannelId, dag.RunID, waveobj.RunEventKindTaskGoalpost, nil, detail); err != nil {
			t.Fatal(err)
		}
	}
	got := goalpostsForTask(ctx, mustLoadDag(t, ctx, dag.OID), "t-0")
	if len(got) != 2 || got[0].File != "first.ts" || got[1].File != "second.ts" {
		t.Fatalf("want t-0's findings oldest first, got %+v", got)
	}
}

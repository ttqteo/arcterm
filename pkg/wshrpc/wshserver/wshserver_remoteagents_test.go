// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/remotemode"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func workerRun(oid, tab string, mutate func(*waveobj.Run)) *waveobj.Run {
	run := &waveobj.Run{OID: oid, Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + tab}}}}
	mutate(run)
	return run
}

func TestRemoteAgentsMarksRunWorkers(t *testing.T) {
	const (
		tabLead, tabTask, tabReview, tabStage, tabChild, tabPlain = "t-lead", "t-task", "t-review", "t-stage", "t-child", "t-plain"
		blockPrefix                                               = "d0000000-0000-4000-8000-00000000000"
	)
	mk := func(tab, block string) agentTabFacts {
		tf := agentFacts(tab, tab, blockPrefix+block, "claude", baseds.AgentState_Idle)
		tf.HasStream = true
		return tf
	}
	plain := mk(tabPlain, "1")
	lead := mk(tabLead, "2")
	task := mk(tabTask, "3")
	review := mk(tabReview, "4")
	stage := mk(tabStage, "5")
	child := mk(tabChild, "6")
	asking := mk("t-ask", "7")
	asking.OpenAsk = true
	noStream := mk("t-exited", "8")
	noStream.HasStream = false
	waiting := mk("t-wait", "9")
	waiting.Status.State = baseds.AgentState_Waiting
	waiting.Status.Hook = baseds.AgentHook_Notification
	waiting.Status.NotificationType = "permission_prompt"
	waiting.Status.TranscriptPath = "/tmp/wait.jsonl"
	scriptAgents(t, &agentRosterFacts{
		Tabs: []agentTabFacts{plain, lead, task, review, stage, child, asking, noStream, waiting},
		Runs: []*waveobj.Run{
			// a lead's own run has no task, review, stage or parent
			workerRun("run-lead", tabLead, func(r *waveobj.Run) {}),
			workerRun("run-task", tabTask, func(r *waveobj.Run) { r.TaskId = "1" }),
			workerRun("run-review", tabReview, func(r *waveobj.Run) { r.Review = true }),
			workerRun("run-stage", tabStage, func(r *waveobj.Run) { r.StageRole = "verifier" }),
			workerRun("run-child", tabChild, func(r *waveobj.Run) { r.ParentLeadORef = "tab:" + tabLead }),
		},
	})

	agents, err := RemoteAgents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	byTab := map[string]remotemode.Agent{}
	for _, a := range agents {
		byTab[a.TabId] = a
	}
	if len(byTab) != 9 {
		t.Fatalf("got %d agents, want 9: %+v", len(byTab), agents)
	}
	for tab, want := range map[string]bool{
		tabPlain: false, tabLead: false, tabTask: true, tabReview: true, tabStage: true, tabChild: true,
	} {
		if got := byTab[tab].RunWorker; got != want {
			t.Errorf("%s RunWorker = %v, want %v", tab, got, want)
		}
	}
	if !byTab["t-ask"].OpenAsk || byTab[tabPlain].OpenAsk {
		t.Errorf("OpenAsk: asking=%v plain=%v", byTab["t-ask"].OpenAsk, byTab[tabPlain].OpenAsk)
	}
	if !byTab[tabPlain].HasStream || byTab["t-exited"].HasStream {
		t.Errorf("HasStream: live=%v exited=%v", byTab[tabPlain].HasStream, byTab["t-exited"].HasStream)
	}
	w := byTab["t-wait"]
	if w.Status.State != baseds.AgentState_Waiting || w.Status.NotificationType != "permission_prompt" {
		t.Errorf("waiting status folded: %+v", w.Status)
	}
	if w.TranscriptPath != "/tmp/wait.jsonl" || w.BlockId != blockPrefix+"9" || w.Harness != "claude" {
		t.Errorf("waiting agent = %+v", w)
	}
}

// scriptTaskGroups scripts loadRemoteTaskGroup with the groups by oid (an oid with an error entry fails) and
// counts the loads per oid.
func scriptTaskGroups(t *testing.T, groups map[string]*waveobj.TaskGroup, failing ...string) map[string]int {
	t.Helper()
	loads := map[string]int{}
	prev := loadRemoteTaskGroup
	loadRemoteTaskGroup = func(_ context.Context, oid string) (*waveobj.TaskGroup, error) {
		loads[oid]++
		if slices.Contains(failing, oid) {
			return nil, errors.New("store busy")
		}
		return groups[oid], nil
	}
	t.Cleanup(func() { loadRemoteTaskGroup = prev })
	return loads
}

func TestRemoteAgentsFillsRunFields(t *testing.T) {
	const blockPrefix = "d0000000-0000-4000-8000-00000000000"
	mk := func(tab, name string, n int) agentTabFacts {
		tf := agentFacts(tab, name, blockPrefix+strconv.Itoa(n), "claude", baseds.AgentState_Working)
		tf.HasStream = true
		return tf
	}
	tabs := []agentTabFacts{
		mk("t-lead", "lead agent", 1),
		mk("t-a-task", "task a", 2),
		mk("t-b-review", "review b", 3),
		mk("t-c-verify", "verify", 4),
		mk("t-d-plan", "plan", 5),
		mk("t-e-land", "land", 6),
		mk("t-f-child", "child", 7),
		mk("t-g-nolabel", "no label", 8),
		mk("t-h-missing", "missing task", 9),
		mk("t-i-orphan1", "orphan one", 10),
		mk("t-j-orphan2", "orphan two", 11),
		mk("t-k-bad", "bad load", 12),
		mk("t-l-nodag", "no dag", 13),
		mk("t-m-lostlead", "lost lead", 14),
		mk("t-plain", "plain", 15),
		mk("t-z-unknown", "unknown role", 16),
	}
	run := func(oid, tab string, mutate func(*waveobj.Run)) *waveobj.Run {
		return workerRun(oid, tab, func(r *waveobj.Run) { r.Goal = "goal of " + oid; mutate(r) })
	}
	dag := func(r *waveobj.Run) { r.DagORef = "dag-1" }
	scriptAgents(t, &agentRosterFacts{Tabs: tabs, Runs: []*waveobj.Run{
		// the lead's own run: the dag's name, and the lead is not a worker
		run("run-lead", "t-lead", func(r *waveobj.Run) { r.DagORef = "dag-1"; r.Goal = "Ship the phone list\n\nplan details follow" }),
		run("run-task", "t-a-task", func(r *waveobj.Run) { dag(r); r.TaskId = "t-1" }),
		run("run-review", "t-b-review", func(r *waveobj.Run) { dag(r); r.TaskId = "t-1"; r.Review = true }),
		run("run-verify", "t-c-verify", func(r *waveobj.Run) { dag(r); r.StageRole = "verifier" }),
		run("run-plan", "t-d-plan", func(r *waveobj.Run) { dag(r); r.StageRole = "plan-reviewer" }),
		run("run-land", "t-e-land", func(r *waveobj.Run) { dag(r); r.StageRole = "land-resolver" }),
		run("run-unknown", "t-z-unknown", func(r *waveobj.Run) { dag(r); r.StageRole = "spec-checker" }),
		// a `wsh jarvis run` child: grouped under its lead, named after the lead's tab
		run("run-child", "t-f-child", func(r *waveobj.Run) { r.ParentLeadORef = "tab:t-lead"; r.Goal = "Check the logs" }),
		run("run-lostlead", "t-m-lostlead", func(r *waveobj.Run) { r.ParentLeadORef = "tab:t-gone"; r.Goal = "Orphaned child" }),
		run("run-nolabel", "t-g-nolabel", func(r *waveobj.Run) { dag(r); r.TaskId = "t-2" }),
		run("run-missing", "t-h-missing", func(r *waveobj.Run) { dag(r); r.TaskId = "t-9" }),
		// a dag with no lead run in the roster facts: the first worker's own goal names it
		run("run-orphan1", "t-i-orphan1", func(r *waveobj.Run) { r.DagORef = "dag-2"; r.TaskId = "t-1"; r.Goal = "Orphan dag first goal" }),
		run("run-orphan2", "t-j-orphan2", func(r *waveobj.Run) { r.DagORef = "dag-2"; r.TaskId = "t-2"; r.Goal = "Orphan dag second goal" }),
		// a dag that fails to load: the worker's line is its goal
		run("run-bad", "t-k-bad", func(r *waveobj.Run) { r.DagORef = "dag-bad"; r.TaskId = "t-1"; r.Goal = "Bad dag worker prompt" }),
		// a worker with no dag and no parent lead keys on its own run
		run("run-nodag", "t-l-nodag", func(r *waveobj.Run) { r.TaskId = "t-1"; r.Goal = "Legacy task" }),
		run("run-plain", "t-plain", func(r *waveobj.Run) {}),
	}})
	loads := scriptTaskGroups(t, map[string]*waveobj.TaskGroup{
		"dag-1": {OID: "dag-1", Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "Roster"}, {ID: "t-2"}}},
		"dag-2": {OID: "dag-2", Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "Take it"}, {ID: "t-2", Label: "Release it"}}},
	}, "dag-bad")

	agents, err := RemoteAgents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	byTab := map[string]remotemode.Agent{}
	for _, a := range agents {
		byTab[a.TabId] = a
	}
	for tab, want := range map[string][3]string{
		"t-a-task":     {"dag-1", "Ship the phone list", "Roster"},
		"t-b-review":   {"dag-1", "Ship the phone list", "Review: Roster"},
		"t-c-verify":   {"dag-1", "Ship the phone list", "Verifier"},
		"t-d-plan":     {"dag-1", "Ship the phone list", "Plan reviewer"},
		"t-e-land":     {"dag-1", "Ship the phone list", "Land resolver"},
		"t-z-unknown":  {"dag-1", "Ship the phone list", "Spec checker"},
		"t-g-nolabel":  {"dag-1", "Ship the phone list", "t-2"},
		"t-h-missing":  {"dag-1", "Ship the phone list", "goal of run-missing"},
		"t-f-child":    {"lead:tab:t-lead", "lead agent", "Check the logs"},
		"t-m-lostlead": {"lead:tab:t-gone", "Orphaned child", "Orphaned child"},
		"t-i-orphan1":  {"dag-2", "Orphan dag first goal", "Take it"},
		"t-j-orphan2":  {"dag-2", "Orphan dag first goal", "Release it"},
		"t-k-bad":      {"dag-bad", "Bad dag worker prompt", "Bad dag worker prompt"},
		"t-l-nodag":    {"run-nodag", "Legacy task", "Legacy task"},
	} {
		a := byTab[tab]
		if !a.RunWorker {
			t.Errorf("%s is not a run worker: %+v", tab, a)
		}
		if got := [3]string{a.RunKey, a.RunName, a.RunLine}; got != want {
			t.Errorf("%s: key, name, line = %q, want %q", tab, got, want)
		}
	}
	// the lead and a plain agent are not workers: no run fields
	for _, tab := range []string{"t-lead", "t-plain"} {
		if a := byTab[tab]; a.RunWorker || a.RunKey != "" || a.RunName != "" || a.RunLine != "" {
			t.Errorf("%s is not a worker, got %+v", tab, a)
		}
	}
	// each distinct group loads once per call, however many workers name it
	if loads["dag-1"] != 1 || loads["dag-2"] != 1 || loads["dag-bad"] != 1 || len(loads) != 3 {
		t.Errorf("task group loads = %v, want each of dag-1, dag-2 and dag-bad once", loads)
	}
	if _, err := RemoteAgents(context.Background()); err != nil {
		t.Fatal(err)
	}
	if loads["dag-1"] != 2 {
		t.Errorf("a second call loaded dag-1 %d times in all, want 2: the cache is per call", loads["dag-1"])
	}
}

func TestRemoteAgentsFillsAsk(t *testing.T) {
	const blockAsk, blockEmpty, blockPlain = "e0000000-0000-4000-8000-000000000001", "e0000000-0000-4000-8000-000000000002", "e0000000-0000-4000-8000-000000000003"
	asking := agentFacts("t-ask", "asking", blockAsk, "claude", baseds.AgentState_Asking)
	asking.OpenAsk = true
	empty := agentFacts("t-empty", "empty ask", blockEmpty, "claude", baseds.AgentState_Asking)
	empty.OpenAsk = true
	plain := agentFacts("t-plain", "plain", blockPlain, "claude", baseds.AgentState_Idle)
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{asking, empty, plain}})
	agentask.GlobalRegistry.Set(blockORef(blockAsk), agentask.PendingAsk{
		AskId: "ask-1", BlockId: blockAsk,
		Questions: []baseds.AgentAskQuestion{{Question: "Which database should the migration use?"}, {Question: "And the schema name?"}},
	})
	agentask.GlobalRegistry.Set(blockORef(blockEmpty), agentask.PendingAsk{AskId: "ask-2", BlockId: blockEmpty})
	t.Cleanup(func() {
		agentask.GlobalRegistry.Drop(blockORef(blockAsk))
		agentask.GlobalRegistry.Drop(blockORef(blockEmpty))
	})

	agents, err := RemoteAgents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	asks := map[string]string{}
	for _, a := range agents {
		asks[a.TabId] = a.Ask
	}
	// the first question's text; an ask with no question and an agent with no ask carry none
	want := map[string]string{"t-ask": "Which database should the migration use?", "t-empty": "", "t-plain": ""}
	for tab, w := range want {
		if asks[tab] != w {
			t.Errorf("%s: Ask = %q, want %q", tab, asks[tab], w)
		}
	}
	// the row's line is then the question (shown by the listing)
	rows, _ := remotemode.BuildAgentList(agents, nil)
	for _, r := range rows {
		if r.Tab == "t-ask" && r.Line != "Which database should the migration use?" {
			t.Errorf("the asking row's line = %q, want its question", r.Line)
		}
		if r.Tab == "t-empty" && r.Line != "Asking you a question" {
			t.Errorf("an ask with no question reads %q, want the generic line", r.Line)
		}
	}
}

func TestRemoteAgentsKeepsRowWhenTranscriptPathErrors(t *testing.T) {
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{agentFacts(agentsTabA, "lead", agentsBlockA, "claude", baseds.AgentState_Idle)}})
	blockTranscriptMeta = func(context.Context, string) (string, error) { return "", errors.New("block store down") }
	agents, err := RemoteAgents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(agents) != 1 || agents[0].TranscriptPath != "" {
		t.Fatalf("agents = %+v, want the row kept with an empty path", agents)
	}
}

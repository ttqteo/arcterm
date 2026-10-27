// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisstate

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jarvisdossier"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func trun(id, status string, created, completed int64, evidence *waveobj.RunEvidence) *waveobj.Run {
	return &waveobj.Run{OID: id, ID: id, Goal: "goal-" + id, Status: status, ProjectPath: "/p/one",
		CreatedTs: created, CompletedTs: completed, Evidence: evidence}
}

func ev(summary string) *waveobj.RunEvidence {
	return &waveobj.RunEvidence{Summary: summary, Files: []waveobj.EvidenceFile{{Path: "a.go", Stat: "M", Add: 3, Del: 1}}}
}

func sess(id, project, status string, lastActive int64) agentsessions.SessionInfo {
	return agentsessions.SessionInfo{ID: id, Runtime: "pi", ProjectPath: project, Task: "task-" + id, Model: "m", Status: status, LastActiveTs: lastActive, StartedTs: lastActive}
}

func TestActiveWorkSkipsTerminalRuns(t *testing.T) {
	runs := []*waveobj.Run{
		trun("r1", "executing", 100, 0, nil),
		trun("r2", "done", 100, 200, ev("x")),
		trun("r3", "cancelled", 100, 200, nil),
	}
	items := ActiveWork(runs, nil, nil, nil)
	if len(items) != 1 || items[0].Kind != "run" || items[0].Title != "goal-r1" {
		t.Fatalf("items=%+v want only the executing run", items)
	}
	if items[0].Detail != "status: executing" || items[0].NavTarget != "run:r1" {
		t.Fatalf("item=%+v want status detail + run navtarget", items[0])
	}
}

func TestActiveWorkAttentionMapsProjectViaRun(t *testing.T) {
	runs := []*waveobj.Run{trun("r1", "executing", 100, 0, nil)}
	attn := []wshrpc.AttentionItem{{Kind: "gate", Key: "k", RunId: "r1", Source: "the ask bridge", Text: "review", Action: "Review", WaitingSince: 150}}
	items := ActiveWork(runs, nil, attn, nil)
	if len(items) != 2 {
		t.Fatalf("items=%+v want run + attention", items)
	}
	var a *wshrpc.ActiveWorkItem
	for i := range items {
		if items[i].Kind == "attention" {
			a = &items[i]
		}
	}
	if a == nil || a.Project != "/p/one" || a.Detail != "Review: review" || a.Ts != 150 {
		t.Fatalf("attention item=%+v want project from its run", a)
	}
}

func TestActiveWorkIncludesLiveSessionsAndBlockers(t *testing.T) {
	sessions := []agentsessions.SessionInfo{
		sess("s1", "/p/one", "waiting", 300),
		sess("s2", "/p/one", "done", 200),
	}
	dossiers := []jarvisdossier.Dossier{{ID: "d1", Objective: "ship ledger", Status: "active", Updated: 400, Blockers: []string{"needs decision on X"}}}
	items := ActiveWork(nil, sessions, nil, dossiers)
	if len(items) != 2 {
		t.Fatalf("items=%+v want session + blocker", items)
	}
	var blocker, live *wshrpc.ActiveWorkItem
	for i := range items {
		switch items[i].Kind {
		case "blocker":
			blocker = &items[i]
		case "session":
			live = &items[i]
		}
	}
	if blocker == nil || blocker.Title != "ship ledger" || blocker.Detail != "needs decision on X" || blocker.NavTarget != "task:d1" {
		t.Fatalf("blocker=%+v wrong", blocker)
	}
	if live == nil || live.Detail != "pi m" {
		t.Fatalf("live session=%+v wrong", live)
	}
}

func TestShippedFiltersDoneWithEvidenceAndWindow(t *testing.T) {
	runs := []*waveobj.Run{
		trun("r1", "done", 100, 500, ev("shipped a")),
		trun("r2", "done", 100, 900, ev("shipped b")),
		trun("r3", "done", 100, 0, nil),         // done but never sealed
		trun("r4", "blocked", 100, 0, ev("nope")), // sealed but not done
	}
	items := Shipped(runs, 600)
	if len(items) != 1 || items[0].RunOID != "r2" || items[0].Summary != "shipped b" {
		t.Fatalf("items=%+v want only r2 in window", items)
	}
	if items[0].CompletedTs != 900 || len(items[0].Files) != 1 {
		t.Fatalf("item=%+v wrong fields", items[0])
	}
	all := Shipped(runs, 0)
	if len(all) != 2 || all[0].RunOID != "r2" {
		t.Fatalf("all=%+v want both sealed, newest first", all)
	}
}

func TestTimelineMergesAndSortsDesc(t *testing.T) {
	runs := []*waveobj.Run{
		trun("r1", "done", 100, 500, ev("shipped a")),
		trun("r2", "blocked", 300, 0, nil),
	}
	sessions := []agentsessions.SessionInfo{sess("s1", "/p/one", "done", 200)}
	decisions := []DecisionEntry{{ID: "d1", Summary: "chose sqlite", CreatedTs: 400}}
	dossiers := []jarvisdossier.Dossier{{ID: "dd", Objective: "ship ledger", Status: "active", Updated: 600}}
	evs := Timeline(runs, sessions, decisions, dossiers, nil, 0)
	if len(evs) != 6 {
		t.Fatalf("evs=%+v want 6 events", evs)
	}
	for i := 1; i < len(evs); i++ {
		if evs[i-1].Ts < evs[i].Ts {
			t.Fatalf("not sorted desc: %+v", evs)
		}
	}
	if evs[0].Kind != "dossier" || evs[0].Title != "ship ledger" || evs[0].NavTarget != "task:dd" {
		t.Fatalf("newest=%+v want dossier event", evs[0])
	}
	if evs[5].Kind != "run-created" || evs[5].Title != "goal-r1" {
		t.Fatalf("oldest=%+v want run-created", evs[5])
	}
}

func TestTimelineWindowFilter(t *testing.T) {
	runs := []*waveobj.Run{
		trun("r1", "done", 100, 500, ev("x")),
		trun("r2", "blocked", 300, 0, nil),
	}
	evs := Timeline(runs, nil, nil, nil, nil, 250)
	if len(evs) != 2 {
		t.Fatalf("evs=%+v want only events >= 250", evs)
	}
	for _, e := range evs {
		if e.Ts < 250 {
			t.Fatalf("event %+v before window", e)
		}
	}
}

func TestDeltaAddsAttentionSince(t *testing.T) {
	runs := []*waveobj.Run{trun("r1", "done", 100, 500, ev("x"))}
	attn := []wshrpc.AttentionItem{{Kind: "ask", Key: "k", RunId: "r1", Source: "worker", Text: "question", Action: "Answer", WaitingSince: 400}}
	evs := Delta(350, runs, nil, nil, attn, nil, nil)
	var found bool
	for _, e := range evs {
		if e.Kind == "attention" {
			found = true
			if e.Project != "/p/one" || e.Detail != "Answer: question" {
				t.Fatalf("attention event=%+v wrong", e)
			}
		}
	}
	if !found {
		t.Fatalf("evs=%+v want an attention event in the delta", evs)
	}
	for _, e := range evs {
		if e.Ts < 350 {
			t.Fatalf("event %+v before since", e)
		}
	}
}

func TestActiveWorkRunWorkerOrefsSortedDeduped(t *testing.T) {
	r := trun("r1", "executing", 100, 0, nil)
	r.Phases = []waveobj.RunPhase{
		{Kind: "plan", WorkerOrefs: []string{"tab:b", "tab:a"}},
		{Kind: "execute", WorkerOrefs: []string{"tab:a"}},
	}
	items := ActiveWork([]*waveobj.Run{r}, nil, nil, nil)
	if len(items) != 1 {
		t.Fatalf("items=%+v want the one run", items)
	}
	got := items[0].WorkerORefs
	if len(got) != 2 || got[0] != "tab:a" || got[1] != "tab:b" {
		t.Fatalf("workerorefs=%v want [tab:a tab:b] sorted + deduped", got)
	}
}

func TestActiveWorkRunWithoutPhasesHasNoWorkerOrefs(t *testing.T) {
	items := ActiveWork([]*waveobj.Run{trun("r1", "executing", 100, 0, nil)}, nil, nil, nil)
	if items[0].WorkerORefs != nil {
		t.Fatalf("workerorefs=%v want nil (omitted on the wire)", items[0].WorkerORefs)
	}
}

func TestShippedCarriesReportAndChunk(t *testing.T) {
	r := trun("r1", "done", 100, 500, ev("sum"))
	r.Report = "# t\n\nlead"
	r.EffortRef = &waveobj.RunEffortRef{EffortOID: "e1", ChunkLabel: "N1 box upgrade"}
	items := Shipped([]*waveobj.Run{r, trun("r2", "done", 100, 600, ev("b"))}, 0)
	byID := map[string]wshrpc.ShippedItem{}
	for _, it := range items {
		byID[it.RunOID] = it
	}
	if !byID["r1"].HasReport || byID["r1"].EffortOID != "e1" || byID["r1"].ChunkLabel != "N1 box upgrade" {
		t.Fatalf("r1 = %+v", byID["r1"])
	}
	if byID["r2"].HasReport || byID["r2"].EffortOID != "" {
		t.Fatalf("r2 = %+v", byID["r2"])
	}
}

// a DAG's task workers are represented by their orchestrator run: the ledger lists the lead only,
// and the lead's row carries the workers' tabs so their live agents do not surface as direct agents
func dagRuns() []*waveobj.Run {
	lead := trun("lead", "executing", 100, 0, nil)
	lead.Mode, lead.DagORef = "orchestrator", "dag:d1"
	lead.Phases = []waveobj.RunPhase{{Kind: "plan", WorkerOrefs: []string{"tab:lead"}}}
	w1 := trun("w1", "executing", 110, 0, nil)
	w1.Mode, w1.DagORef = "quick", "dag:d1"
	w1.Phases = []waveobj.RunPhase{{Kind: "execute", WorkerOrefs: []string{"tab:w1"}}}
	w2 := trun("w2", "done", 120, 500, ev("worker landed"))
	w2.Mode, w2.DagORef = "quick", "dag:d1"
	w2.Phases = []waveobj.RunPhase{{Kind: "execute", WorkerOrefs: []string{"tab:w2"}}}
	solo := trun("solo", "done", 130, 600, ev("solo landed"))
	solo.Mode = "quick"
	return []*waveobj.Run{lead, w1, w2, solo}
}

func TestActiveWorkFoldsDagWorkersIntoTheirLead(t *testing.T) {
	items := ActiveWork(dagRuns(), nil, nil, nil)
	if len(items) != 1 || items[0].NavTarget != "run:lead" {
		t.Fatalf("items=%+v want only the lead", items)
	}
	if items[0].Mode != "orchestrator" {
		t.Fatalf("mode=%q want orchestrator", items[0].Mode)
	}
	got := items[0].WorkerORefs
	if len(got) != 3 || got[0] != "tab:lead" || got[1] != "tab:w1" || got[2] != "tab:w2" {
		t.Fatalf("workerorefs=%v want the lead's and both workers' tabs", got)
	}
}

func TestShippedLeavesOutDagWorkers(t *testing.T) {
	items := Shipped(dagRuns(), 0)
	if len(items) != 1 || items[0].RunOID != "solo" || items[0].Mode != "quick" {
		t.Fatalf("items=%+v want only the solo quick run, with its mode", items)
	}
}

func TestBrainstormSessionRunIsNoRunYouStarted(t *testing.T) {
	check := &waveobj.Run{OID: "check", Goal: "builder check", Status: "done", CompletedTs: 5, CreatedTs: 4,
		StageRole: jarvis.UsageRole_BuilderCheck, Evidence: &waveobj.RunEvidence{}}
	running := *check
	running.OID, running.Status = "check-live", "executing"
	judge := *check
	judge.OID, judge.StageRole = "judge", jarvis.UsageRole_BrainstormJudge
	runs := []*waveobj.Run{check, &running, &judge}
	if got := ActiveWork(runs, nil, nil, nil); len(got) != 0 {
		t.Fatalf("active work = %+v, want none", got)
	}
	if got := Shipped(runs, 0); len(got) != 0 {
		t.Fatalf("shipped = %+v, want none", got)
	}
	if got := Timeline(runs, nil, nil, nil, nil, 0); len(got) != 0 {
		t.Fatalf("timeline = %+v, want none", got)
	}
}

func TestTimelineLeavesOutDagWorkers(t *testing.T) {
	for _, e := range Timeline(dagRuns(), nil, nil, nil, nil, 0) {
		if e.NavTarget == "run:w1" || e.NavTarget == "run:w2" {
			t.Fatalf("event %+v is a DAG worker's", e)
		}
	}
}

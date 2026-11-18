// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"testing"

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

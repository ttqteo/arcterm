// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestRunLinkOf(t *testing.T) {
	dag := &waveobj.TaskGroup{RunID: "lead", ChannelId: "ch", Tasks: []waveobj.TaskNode{
		{ID: "t-1", RunID: "w1-retry"},
		{ID: "t-2", RunID: "w2", ReviewRunID: "rv2"},
	}}
	cases := []struct {
		name string
		run  waveobj.Run
		dag  *waveobj.TaskGroup
		want sessionRunLink
		ok   bool
	}{
		{"lead owns the dag", waveobj.Run{OID: "lead", ChannelOID: "ch", DagORef: "d", Mode: "orchestrator"}, dag,
			sessionRunLink{RunId: "lead", ChannelId: "ch", Role: "lead"}, true},
		{"lead before its dag", waveobj.Run{OID: "lead", ChannelOID: "ch", Mode: "orchestrator"}, nil,
			sessionRunLink{RunId: "lead", ChannelId: "ch", Role: "lead"}, true},
		{"an earlier attempt is placed by its own task id", waveobj.Run{OID: "w1", DagORef: "d", TaskId: "t-1"}, dag,
			sessionRunLink{RunId: "lead", ChannelId: "ch", TaskId: "t-1", Role: "worker"}, true},
		{"a finished reviewer keeps its role", waveobj.Run{OID: "rv1", DagORef: "d", TaskId: "t-1", Review: true}, dag,
			sessionRunLink{RunId: "lead", ChannelId: "ch", TaskId: "t-1", Role: "review"}, true},
		{"a legacy worker is placed by the task's link", waveobj.Run{OID: "w2", DagORef: "d"}, dag,
			sessionRunLink{RunId: "lead", ChannelId: "ch", TaskId: "t-2", Role: "worker"}, true},
		{"a legacy reviewer is placed by the task's review link", waveobj.Run{OID: "rv2", DagORef: "d"}, dag,
			sessionRunLink{RunId: "lead", ChannelId: "ch", TaskId: "t-2", Role: "review"}, true},
		{"a plan reviewer is placed by its stage", waveobj.Run{OID: "pr", DagORef: "d", StageRole: "plan-reviewer"}, dag,
			sessionRunLink{RunId: "lead", ChannelId: "ch", Role: "plan-reviewer"}, true},
		{"a final verifier is placed by its stage", waveobj.Run{OID: "fv", DagORef: "d", StageRole: "verifier"}, dag,
			sessionRunLink{RunId: "lead", ChannelId: "ch", Role: "verifier"}, true},
		{"an unlinked legacy child stays in its run", waveobj.Run{OID: "gone", DagORef: "d"}, dag,
			sessionRunLink{RunId: "lead", ChannelId: "ch", Role: "worker"}, true},
		{"a child whose dag is gone", waveobj.Run{OID: "w", DagORef: "d", TaskId: "t-1"}, nil, sessionRunLink{}, false},
		{"a plain run", waveobj.Run{OID: "q", Mode: "quick"}, nil, sessionRunLink{}, false},
	}
	for _, c := range cases {
		got, ok := runLinkOf(&c.run, c.dag)
		if ok != c.ok || got != c.want {
			t.Errorf("%s: got %+v %v, want %+v %v", c.name, got, ok, c.want, c.ok)
		}
	}
}

// A run this store recorded places its session; a session no recorded run claims is placed by its transcript, as a
// session launched by another app's store is, and any other session stays on its own.
func TestLinkSessionsToRunsFallsBackToTheTranscript(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "session-origin", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	lead := jarvis.NewRun("ship it", "ws-id", "/repo", nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	lead.SessionId = uuid.NewString()
	if err := wstore.AppendRun(ctx, ch.OID, lead); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	other := uuid.NewString()
	tree := filepath.Join("repo", ".waveterm", "worktrees", other+"-t-3")
	sessions := []wshrpc.SessionActivity{
		// the recorded lead, though it ran in another run's tree: the store's record wins
		{ID: lead.SessionId, ProjectPath: tree},
		{ID: uuid.NewString(), ProjectPath: tree, Task: "Your instructions are in the file x.md"},
		{ID: uuid.NewString(), ProjectPath: "/repo", Task: "You are the plan reviewer for run " + other + ". Before any worker starts"},
		{ID: uuid.NewString(), ProjectPath: "/repo", Task: "how to build this"},
	}
	if err := linkSessionsToRuns(ctx, sessions); err != nil {
		t.Fatalf("linkSessionsToRuns: %v", err)
	}
	want := []struct{ run, channel, task, role string }{
		{lead.ID, ch.OID, "", "lead"},
		{other, "", "t-3", ""},
		{other, "", "", "plan-reviewer"},
		{"", "", "", ""},
	}
	for i, w := range want {
		s := sessions[i]
		if s.RunId != w.run || s.ChannelId != w.channel || s.TaskId != w.task || s.Role != w.role {
			t.Errorf("session %d: run %q channel %q task %q role %q; want %+v", i, s.RunId, s.ChannelId, s.TaskId, s.Role, w)
		}
	}
}

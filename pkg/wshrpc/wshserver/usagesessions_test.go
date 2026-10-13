// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const usageTestRepo = "/home/u/repo"

// seedUsageRun stores a run in a fresh channel, or in channelId when one is given, and returns the stored run.
func seedUsageRun(t *testing.T, channelId string, run waveobj.Run) waveobj.Run {
	t.Helper()
	ctx := context.Background()
	if channelId == "" {
		ch, err := wstore.CreateChannel(ctx, "usage-"+uuid.NewString(), usageTestRepo)
		if err != nil {
			t.Fatal(err)
		}
		channelId = ch.OID
	}
	run.ID = uuid.NewString()
	run.OID, run.ChannelOID = run.ID, channelId
	if err := wstore.AppendRun(ctx, channelId, run); err != nil {
		t.Fatal(err)
	}
	return run
}

// seedUsageDag stores an orchestrator lead, its dag, and one child per given run, each under a new session id.
func seedUsageDag(t *testing.T, children ...waveobj.Run) (waveobj.Run, []string) {
	t.Helper()
	dagId := uuid.NewString()
	lead := seedUsageRun(t, "", waveobj.Run{
		Mode: "orchestrator", Goal: "ship the thing\nwith care", ProjectPath: usageTestRepo,
		SessionId: uuid.NewString(), DagORef: dagId,
	})
	dag := waveobj.TaskGroup{OID: dagId, ID: dagId, RunID: lead.ID, ChannelId: lead.ChannelOID,
		Tasks: []waveobj.TaskNode{{ID: "t-1"}}}
	if err := wstore.AppendDag(context.Background(), &dag); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(children))
	for i, child := range children {
		child.DagORef, child.SessionId = dagId, uuid.NewString()
		// a child's own path is its lane, which must never name the project
		child.ProjectPath = usageTestRepo + "/.waveterm/worktrees/" + child.SessionId
		ids[i] = seedUsageRun(t, lead.ChannelOID, child).SessionId
	}
	return lead, ids
}

func usageSessionsOf(t *testing.T, metas ...usagestats.SessionMeta) []wshrpc.UsageSessionMeta {
	t.Helper()
	got, err := usageSessions(context.Background(), metas)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(metas) {
		t.Fatalf("got %d sessions for %d metas", len(got), len(metas))
	}
	return got
}

func claudeSessionMeta(session string) usagestats.SessionMeta {
	return usagestats.SessionMeta{Harness: "claude", Session: session, Cwd: "/somewhere/else", Title: "a title"}
}

func TestUsageSessionsLead(t *testing.T) {
	lead, _ := seedUsageDag(t)
	got := usageSessionsOf(t, claudeSessionMeta(lead.SessionId))[0]
	want := wshrpc.UsageSessionMeta{
		Harness: "claude", Session: lead.SessionId, Title: "a title", Project: usageTestRepo,
		RunId: lead.ID, ChannelId: lead.ChannelOID, RunGoal: "ship the thing", RunMode: "orchestrator", Role: "lead",
	}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestUsageSessionsLeadEarlierSession(t *testing.T) {
	earlier, current := uuid.NewString(), uuid.NewString()
	lead := seedUsageRun(t, "", waveobj.Run{
		Mode: "orchestrator", Goal: "relaunched", ProjectPath: usageTestRepo,
		SessionId: current, LeadSessionIds: []string{earlier, current},
	})
	for _, s := range usageSessionsOf(t, claudeSessionMeta(earlier), claudeSessionMeta(current)) {
		if s.RunId != lead.ID || s.ChannelId != lead.ChannelOID || s.Role != "lead" || s.RunMode != "orchestrator" ||
			s.RunGoal != "relaunched" || s.Project != usageTestRepo {
			t.Fatalf("a lead session links to its run as lead, got %+v", s)
		}
	}
}

func TestUsageSessionsWorkerAndReviewer(t *testing.T) {
	lead, ids := seedUsageDag(t,
		waveobj.Run{TaskId: "t-1"},
		waveobj.Run{TaskId: "t-1", Review: true},
		waveobj.Run{StageRole: "plan-reviewer"},
		waveobj.Run{StageRole: "verifier"},
	)
	wantRole := []string{"worker", "reviewer", "plan-reviewer", "verifier"}
	wantTask := []string{"t-1", "t-1", "", ""}
	got := usageSessionsOf(t, claudeSessionMeta(ids[0]), usagestats.SessionMeta{Harness: "pi", Session: ids[1]}, claudeSessionMeta(ids[2]), claudeSessionMeta(ids[3]))
	for i, s := range got {
		if s.RunId != lead.ID || s.ChannelId != lead.ChannelOID || s.RunGoal != "ship the thing" || s.RunMode != "orchestrator" {
			t.Errorf("%s: want the owning run's id, goal and mode, got %+v", wantRole[i], s)
		}
		if s.Role != wantRole[i] || s.TaskId != wantTask[i] {
			t.Errorf("got role %q task %q, want %q %q", s.Role, s.TaskId, wantRole[i], wantTask[i])
		}
		if s.Project != usageTestRepo {
			t.Errorf("%s: project %q, want the owning run's %q", wantRole[i], s.Project, usageTestRepo)
		}
	}
}

// a child launched before runs recorded their task has nothing UsageRole can read, and it is not the lead
func TestUsageSessionsLegacyChildIsNotLead(t *testing.T) {
	lead, ids := seedUsageDag(t, waveobj.Run{})
	got := usageSessionsOf(t, claudeSessionMeta(ids[0]))[0]
	if got.RunId != lead.ID || got.Role != "worker" {
		t.Fatalf("want a worker of run %s, got %+v", lead.ID, got)
	}
}

func TestUsageSessionsQuickRun(t *testing.T) {
	run := seedUsageRun(t, "", waveobj.Run{Mode: "quick", Goal: "fix it", ProjectPath: usageTestRepo, SessionId: uuid.NewString()})
	got := usageSessionsOf(t, claudeSessionMeta(run.SessionId))[0]
	want := wshrpc.UsageSessionMeta{
		Harness: "claude", Session: run.SessionId, Title: "a title", Project: usageTestRepo,
		RunId: run.ID, ChannelId: run.ChannelOID, RunGoal: "fix it", RunMode: "quick",
	}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestUsageSessionsUnlinked(t *testing.T) {
	got := usageSessionsOf(t, claudeSessionMeta(uuid.NewString()), usagestats.SessionMeta{Harness: "claude", Session: uuid.NewString()})
	want := wshrpc.UsageSessionMeta{Harness: "claude", Session: got[0].Session, Title: "a title", Project: "/somewhere/else"}
	if got[0] != want {
		t.Fatalf("got %+v, want %+v", got[0], want)
	}
	if got[1].Project != "" {
		t.Fatalf("no cwd and no run leaves the project empty, got %q", got[1].Project)
	}
}

func TestUsageSessionsWorktreeCwdFoldsToRepo(t *testing.T) {
	cases := []struct{ cwd, want string }{
		{"/home/u/repo/.worktrees/x", "/home/u/repo"},
		{"/home/u/repo/.claude/worktrees/x", "/home/u/repo"},
		{"/home/u/repo/.waveterm/worktrees/x", "/home/u/repo"},
		{`C:\Users\u\repo\.worktrees\x`, `C:\Users\u\repo`},
		{`C:\Users\u\repo\.claude\worktrees\x`, `C:\Users\u\repo`},
		{`C:\Users\u\repo\.claude/worktrees/x`, `C:\Users\u\repo`},
		{"/home/u/repo/.worktrees/x/", "/home/u/repo"},
		{"/home/u/lanes/repo-x", "/home/u/lanes/repo-x"},
		{"/home/u/repo-worktrees/x", "/home/u/repo-worktrees/x"},
		{"/home/u/repo/.worktrees", "/home/u/repo/.worktrees"},
		{"/home/u/repo", "/home/u/repo"},
	}
	for _, c := range cases {
		got := usageSessionsOf(t, usagestats.SessionMeta{Harness: "codex", Session: uuid.NewString(), Cwd: c.cwd})[0]
		if got.Project != c.want {
			t.Errorf("cwd %q: project %q, want %q", c.cwd, got.Project, c.want)
		}
	}
}

func TestUsageSessionsCodexNotLinked(t *testing.T) {
	lead, _ := seedUsageDag(t)
	for _, harness := range []string{"codex", "opencode"} {
		got := usageSessionsOf(t, usagestats.SessionMeta{Harness: harness, Session: lead.SessionId, Cwd: "/somewhere/else"})[0]
		want := wshrpc.UsageSessionMeta{Harness: harness, Session: lead.SessionId, Project: "/somewhere/else"}
		if got != want {
			t.Fatalf("got %+v, want %+v", got, want)
		}
	}
}

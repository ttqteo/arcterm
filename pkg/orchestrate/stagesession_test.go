// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func dagOwner(t *testing.T, ctx context.Context, g *waveobj.TaskGroup) *waveobj.Run {
	t.Helper()
	owner, err := wstore.GetRun(ctx, g.ChannelId, g.RunID)
	if err != nil {
		t.Fatal(err)
	}
	return owner
}

// a stage session works no task: its run is placed in the dag by its role, and counted under it
func TestSpawnStageSessionRecordsARunWithItsRoleAndNoTask(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	calls := captureSpawns(t)
	f := newFakeLead(t)
	owner := dagOwner(t, ctx, dag)
	tree := t.TempDir()
	runID, err := spawnStageSession(ctx, ctx, dag, owner, StageSession{Role: "verifier", Label: "final check", Tree: tree, Prompt: "judge it"})
	if err != nil {
		t.Fatal(err)
	}
	c := (*calls)[0]
	if c.cwd != tree || c.prompt != "judge it" || c.opts.TaskId != "" || c.opts.RunId != runID || c.opts.SessionId == "" || c.opts.Label != "final check" {
		t.Fatalf("spawned %+v", c)
	}
	if c.cap.Runtime != runroute.DefaultRuntime(owner.Runtime) {
		t.Fatalf("the session runs on the lead's route, got %q", c.cap.Runtime)
	}
	run, err := wstore.GetRun(ctx, dag.ChannelId, runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.StageRole != "verifier" || run.SessionId != c.opts.SessionId || run.DagORef != dag.OID || run.TaskId != "" || run.Review || run.ProjectPath != tree {
		t.Fatalf("stage run = %+v", run)
	}
	if jarvis.UsageRole(run) != "verifier" {
		t.Fatalf("usage role = %q", jarvis.UsageRole(run))
	}
	if f.countKind(waveobj.RunEventKindStageSessionStarted) != 1 {
		t.Fatalf("want one stage-session-started row, got %v", f.rows)
	}
}

func TestSpawnStageSessionReportsASpawnFailure(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	allowWorkerHarnessForTest(t)
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		return "", errors.New("no terminal")
	}
	restoreAfterStages(t, func() { spawnWorker = old })
	if _, err := spawnStageSession(ctx, ctx, dag, dagOwner(t, ctx, dag), StageSession{Role: "verifier", Tree: t.TempDir()}); err == nil || !strings.Contains(err.Error(), "no terminal") {
		t.Fatalf("want the spawn's error, got %v", err)
	}
}

func TestStageSessionRouteLead(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	calls := captureSpawns(t)
	capableLeadHarnessForTest(t)
	dag.ReviewerRoute = &waveobj.RoutePin{Runtime: "agy"}
	_, err := spawnStageSession(ctx, ctx, dag, dagOwner(t, ctx, dag), StageSession{Role: "verifier", Tree: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "cannot lead") {
		t.Fatalf("want the cannot-lead error, got %v", err)
	}
	if len(*calls) != 0 {
		t.Fatalf("an agy stage session must not spawn, got %d spawns", len(*calls))
	}
}

func TestStageSessionLost(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	captureSpawns(t)
	newFakeLead(t)
	runID, err := spawnStageSession(ctx, ctx, dag, dagOwner(t, ctx, dag), StageSession{Role: "verifier", Tree: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	if reason := stageSessionLost(ctx, dag, runID, now, now); reason != "" {
		t.Fatalf("a fresh session is working, got %q", reason)
	}
	if reason := stageSessionLost(ctx, dag, runID, now-ReviewTimeout.Milliseconds()-1, now); !strings.Contains(reason, "no verdict within") {
		t.Fatalf("past the timeout, got %q", reason)
	}
	endRun(t, ctx, dag.ChannelId, runID)
	if reason := stageSessionLost(ctx, dag, runID, now, now); reason != "it ended without a verdict" {
		t.Fatalf("an ended session, got %q", reason)
	}
}

// a session that cannot start is retried on the next tick, once
func TestTendStageSessionGivesUpAfterOneRespawn(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	allowWorkerHarnessForTest(t)
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		return "", errors.New("no terminal")
	}
	restoreAfterStages(t, func() { spawnWorker = old })
	owner := dagOwner(t, ctx, dag)
	session := func() StageSession { return StageSession{Role: "verifier", Tree: t.TempDir()} }
	var runID string
	var startedTs int64
	var respawns int
	var afterCommit []func()
	if reason := tendStageSession(ctx, ctx, dag, owner, session, &runID, &startedTs, &respawns, 1, &afterCommit); reason != "" || respawns != 1 {
		t.Fatalf("the first failure is retried, got %q with %d respawns", reason, respawns)
	}
	if reason := tendStageSession(ctx, ctx, dag, owner, session, &runID, &startedTs, &respawns, 2, &afterCommit); !strings.Contains(reason, "could not start: no terminal") {
		t.Fatalf("the second failure gives up, got %q", reason)
	}
}

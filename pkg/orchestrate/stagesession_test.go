// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"reflect"
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
	if reason, _ := stageSessionLost(ctx, dag, runID, now, now); reason != "" {
		t.Fatalf("a fresh session is working, got %q", reason)
	}
	if reason, _ := stageSessionLost(ctx, dag, runID, now-ReviewTimeout.Milliseconds()-1, now); !strings.Contains(reason, "no verdict within") {
		t.Fatalf("past the timeout, got %q", reason)
	}
	endRun(t, ctx, dag.ChannelId, runID)
	if reason, _ := stageSessionLost(ctx, dag, runID, now, now); reason != "it ended without a verdict" {
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
	session := func() (StageSession, error) { return StageSession{Role: "verifier", Tree: t.TempDir()}, nil }
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

// a session whose brief cannot be built is spent like one that could not start, and nothing is spawned
func TestTendStageSessionCountsABuilderErrorAsASpawnFailure(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	calls := captureSpawns(t)
	owner := dagOwner(t, ctx, dag)
	session := func() (StageSession, error) { return StageSession{}, errors.New("no diff") }
	var runID string
	var startedTs int64
	var respawns int
	var afterCommit []func()
	if reason := tendStageSession(ctx, ctx, dag, owner, session, &runID, &startedTs, &respawns, 1, &afterCommit); reason != "" || respawns != 1 {
		t.Fatalf("the first builder error is retried, got %q with %d respawns", reason, respawns)
	}
	if reason := tendStageSession(ctx, ctx, dag, owner, session, &runID, &startedTs, &respawns, 2, &afterCommit); reason != "it could not start: no diff" {
		t.Fatalf("the second builder error gives up, got %q", reason)
	}
	if len(*calls) != 0 || runID != "" {
		t.Fatalf("nothing is spawned without a brief, got %d spawns and run %q", len(*calls), runID)
	}
}

// a session with its own route runs on it, and its lens rides on the started event; the final verifier has none
func TestSpawnStageSessionRunsOnItsRouteAndNamesItsLens(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	calls := captureSpawns(t)
	f := newFakeLead(t)
	owner := dagOwner(t, ctx, dag)
	route := waveobj.RoutePin{Runtime: "claude", Model: "haiku"}
	runID, err := spawnStageSession(ctx, ctx, dag, owner, StageSession{Role: jarvis.UsageRole_PlanReviewer, Tree: t.TempDir(), Lens: PlanReviewLens_Spec, Route: route})
	if err != nil {
		t.Fatal(err)
	}
	run, err := wstore.GetRun(ctx, dag.ChannelId, runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Runtime != "claude" || run.Model != "haiku" || (*calls)[0].cap.Runtime != "claude" {
		t.Fatalf("the session runs on its route, got run %s/%s", run.Runtime, run.Model)
	}
	if _, err := spawnStageSession(ctx, ctx, dag, owner, StageSession{Role: jarvis.UsageRole_Verifier, Tree: t.TempDir()}); err != nil {
		t.Fatal(err)
	}
	var lenses []any
	for _, row := range f.rows {
		if row["eventkind"] == waveobj.RunEventKindStageSessionStarted {
			lens, ok := row["lens"]
			lenses = append(lenses, lens, ok)
		}
	}
	if want := []any{PlanReviewLens_Spec, true, nil, false}; !reflect.DeepEqual(lenses, want) {
		t.Fatalf("started rows' lens = %v, want %v", lenses, want)
	}
}

// Run bf3a2fe3's reviewer: its route refused every turn, it sat idle, and the review failed as a plain timeout
func TestLostSessionsSayWhyTheirLastTurnFailed(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	captureSpawns(t)
	newFakeLead(t)
	stubSessionsRoot(t, t.TempDir())
	runID, err := spawnStageSession(ctx, ctx, dag, dagOwner(t, ctx, dag), StageSession{Role: "verifier", Tree: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	run, err := wstore.GetRun(ctx, dag.ChannelId, runID)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	timedOut := now - ReviewTimeout.Milliseconds() - 1
	if reason, want := lostReason(stageSessionLost(ctx, dag, runID, timedOut, now)), "it gave no verdict within "+ReviewTimeout.String(); reason != want {
		t.Fatalf("with no transcript, got %q, want %q", reason, want)
	}
	writeFailedTurn(t, run, deadRouteError, time.Now())
	if reason, _ := stageSessionLost(ctx, dag, runID, now, now); reason != "" {
		t.Fatalf("a failed turn alone does not end a session before the timeout, got %q", reason)
	}
	failed := "; its last turn failed: " + deadRouteError
	if reason, want := lostReason(stageSessionLost(ctx, dag, runID, timedOut, now)), "it gave no verdict within "+ReviewTimeout.String()+failed; reason != want {
		t.Fatalf("stage session: got %q, want %q", reason, want)
	}
	review := &waveobj.TaskNode{ReviewRunID: runID, ReviewSpawnedTs: timedOut}
	if reason, want := lostReason(reviewerLost(ctx, dag, review, now)), "reviewer gave no verdict within "+ReviewTimeout.String()+failed; reason != want {
		t.Fatalf("reviewer: got %q, want %q", reason, want)
	}
	endRun(t, ctx, dag.ChannelId, runID)
	if reason, want := lostReason(stageSessionLost(ctx, dag, runID, now, now)), "it ended without a verdict"+failed; reason != want {
		t.Fatalf("ended session: got %q, want %q", reason, want)
	}
}

// lostReason is the reason alone, marked when final so that a comparison with a plain reason fails.
func lostReason(reason string, final bool) string {
	if final {
		return "final: " + reason
	}
	return reason
}

// a refusal the session has stopped retrying ends it before any timeout, and as final: a replacement on the same
// route would be refused too. An error that passes with time is not one.
func TestRefusedSessionsAreLostAtOnceAndForGood(t *testing.T) {
	ctx, dag := seedPendingDag(t)
	captureSpawns(t)
	newFakeLead(t)
	stubSessionsRoot(t, t.TempDir())
	runID, err := spawnStageSession(ctx, ctx, dag, dagOwner(t, ctx, dag), StageSession{Role: "verifier", Tree: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	run, err := wstore.GetRun(ctx, dag.ChannelId, runID)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	settled := time.Now().Add(-RefusedQuiet - time.Second)
	writeFailedTurn(t, run, busyRouteError, settled)
	if reason, final := stageSessionLost(ctx, dag, runID, now, now); reason != "" || final {
		t.Fatalf("a 502 is not a refusal, got %q final %v", reason, final)
	}
	writeFailedTurn(t, run, deadRouteError, settled)
	if reason, final := stageSessionLost(ctx, dag, runID, now, now); reason != "its route refused it: "+deadRouteError || !final {
		t.Fatalf("stage session: got %q final %v", reason, final)
	}
	review := &waveobj.TaskNode{ReviewRunID: runID, ReviewSpawnedTs: now}
	if reason, final := reviewerLost(ctx, dag, review, now); reason != "reviewer's route refused it: "+deadRouteError || !final {
		t.Fatalf("reviewer: got %q final %v", reason, final)
	}
}

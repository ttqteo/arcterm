// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func seedDagSubmission(t *testing.T) (context.Context, *waveobj.Channel, waveobj.Run, *waveobj.TaskGroup) {
	t.Helper()
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "dag-store", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := waveobj.Run{ID: uuid.NewString(), Goal: "owner", WorkspaceId: "ws-1", ProjectPath: ch.ProjectPath, Mode: "orchestrator", Status: "planning"}
	if err := AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	dagID := uuid.NewString()
	dag := &waveobj.TaskGroup{
		OID: dagID, ID: dagID, RunID: run.ID, ChannelId: ch.OID, Title: "g", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t", Label: "task", State: "pending"}}, Status: "running", CreatedTs: 1, UpdatedTs: 1,
	}
	return ctx, ch, run, dag
}

func transitionDagOwner(run *waveobj.Run) error {
	if run.Mode != "orchestrator" || run.Status != "planning" {
		return context.Canceled
	}
	run.Status = "executing"
	return nil
}

func TestCreateDagForRunCommitsDagLinkAndTransition(t *testing.T) {
	ctx, ch, run, proposed := seedDagSubmission(t)

	got, created, err := CreateDagForRun(ctx, ch.OID, run.ID, proposed, transitionDagOwner)
	if err != nil {
		t.Fatal(err)
	}
	if !created || got.OID != proposed.OID {
		t.Fatalf("created=%v dag=%q, want true/%q", created, got.OID, proposed.OID)
	}
	storedDag, err := GetDag(ctx, proposed.OID)
	if err != nil {
		t.Fatal(err)
	}
	storedRun, err := GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if storedDag.OID != proposed.OID || storedRun.DagORef != proposed.OID || storedRun.Status != "executing" {
		t.Fatalf("stored dag/run mismatch: dag=%q run=%+v", storedDag.OID, storedRun)
	}
}

func TestCreateDagForRunReturnsExisting(t *testing.T) {
	ctx, ch, run, proposed := seedDagSubmission(t)
	first, created, err := CreateDagForRun(ctx, ch.OID, run.ID, proposed, transitionDagOwner)
	if err != nil || !created {
		t.Fatalf("first create: created=%v err=%v", created, err)
	}
	secondProposal := *proposed
	secondProposal.OID = uuid.NewString()
	secondProposal.ID = secondProposal.OID
	second, created, err := CreateDagForRun(ctx, ch.OID, run.ID, &secondProposal, transitionDagOwner)
	if err != nil {
		t.Fatal(err)
	}
	if created || second.OID != first.OID {
		t.Fatalf("retry created=%v dag=%q, want false/%q", created, second.OID, first.OID)
	}
}

func TestGetDagsWithPendingCleanup(t *testing.T) {
	ctx := context.Background()
	pendingID, clearID, failedID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	pending := &waveobj.TaskGroup{
		OID: pendingID, ID: pendingID, RunID: uuid.NewString(), ChannelId: uuid.NewString(),
		Parallelism: 1, Status: "done", Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done", CleanupPending: true}},
	}
	clear := &waveobj.TaskGroup{
		OID: clearID, ID: clearID, RunID: uuid.NewString(), ChannelId: uuid.NewString(),
		Parallelism: 1, Status: "done", Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done"}},
	}
	// failed-cleanup debt keeps CleanupPending cleared and carries a bounded error — the sweep
	// must still find it, or error-only debt would never be retried at startup.
	failed := &waveobj.TaskGroup{
		OID: failedID, ID: failedID, RunID: uuid.NewString(), ChannelId: uuid.NewString(),
		Parallelism: 1, Status: "running", Tasks: []waveobj.TaskNode{{ID: "t-1", State: "done", Merged: true, CleanupError: "locked"}},
	}
	if err := AppendDag(ctx, pending); err != nil { t.Fatal(err) }
	if err := AppendDag(ctx, clear); err != nil { t.Fatal(err) }
	if err := AppendDag(ctx, failed); err != nil { t.Fatal(err) }
	t.Cleanup(func() {
		_ = DBDelete(context.Background(), waveobj.OType_Dag, pendingID)
		_ = DBDelete(context.Background(), waveobj.OType_Dag, clearID)
		_ = DBDelete(context.Background(), waveobj.OType_Dag, failedID)
	})

	got, err := GetDagsWithPendingCleanup(ctx)
	if err != nil { t.Fatal(err) }
	foundPending, foundClear, foundFailed := false, false, false
	for _, dag := range got {
		foundPending = foundPending || dag.OID == pendingID
		foundClear = foundClear || dag.OID == clearID
		foundFailed = foundFailed || dag.OID == failedID
	}
	if !foundPending || !foundFailed || foundClear {
		t.Fatalf("pending=%v failed=%v clear=%v dags=%+v", foundPending, foundFailed, foundClear, got)
	}
}

func TestCreateDagForRunRollsBackAllWrites(t *testing.T) {
	ctx, ch, run, proposed := seedDagSubmission(t)
	const trigger = "fail_dag_run_update"
	if err := WithTx(ctx, func(tx *TxWrap) error {
		tx.Exec(`CREATE TEMP TRIGGER fail_dag_run_update BEFORE UPDATE ON db_run BEGIN SELECT RAISE(ABORT, 'forced run update failure'); END`)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = WithTx(context.Background(), func(tx *TxWrap) error {
			tx.Exec("DROP TRIGGER IF EXISTS " + trigger)
			return nil
		})
	})

	channelBefore, err := DBMustGet[*waveobj.Channel](ctx, ch.OID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := CreateDagForRun(ctx, ch.OID, run.ID, proposed, transitionDagOwner); err == nil {
		t.Fatal("want forced run update failure")
	}
	storedDag, err := DBGet[*waveobj.TaskGroup](ctx, proposed.OID)
	if err != nil {
		t.Fatal(err)
	}
	if storedDag != nil {
		t.Fatalf("dag persisted despite rollback: %+v", storedDag)
	}
	storedRun, err := GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedChannel, err := DBMustGet[*waveobj.Channel](ctx, ch.OID)
	if err != nil {
		t.Fatal(err)
	}
	if storedRun.DagORef != "" || storedRun.Status != "planning" {
		t.Fatalf("row run changed despite rollback: %+v", storedRun)
	}
	// the channel's bump rolls back with the run write it announces
	if storedChannel.Version != channelBefore.Version {
		t.Fatalf("channel version %d changed despite rollback, was %d", storedChannel.Version, channelBefore.Version)
	}
}

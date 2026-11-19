// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jarvisstate"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// rcEffort stores an initiative whose chunks are all proposed, as a lead's follow-ups are.
func rcEffort(t *testing.T, labels ...string) string {
	t.Helper()
	e := &waveobj.Effort{Title: "follow-ups", Status: "active"}
	for _, l := range labels {
		e.Chunks = append(e.Chunks, waveobj.EffortChunk{Label: l, Status: "proposed"})
	}
	if err := effortstore.Create(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	cleanupEffort(t, e.OID)
	return e.OID
}

func rcChunk(t *testing.T, oid, label string) waveobj.EffortChunk {
	t.Helper()
	e, err := effortstore.Get(context.Background(), oid)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range e.Chunks {
		if c.Label == label {
			return c
		}
	}
	t.Fatalf("effort %s has no chunk %q", oid, label)
	return waveobj.EffortChunk{}
}

func rcHolds(c waveobj.EffortChunk, runId string) bool {
	for _, w := range c.WorkRefs {
		if w.ORef == "run:"+runId {
			return true
		}
	}
	return false
}

// rcFinishNotes counts the "Run finished" notes the run left on the chunk
func rcFinishNotes(c waveobj.EffortChunk, runId string) int {
	n := 0
	for _, note := range c.Notes {
		if note.Run == "run:"+runId && strings.HasPrefix(note.Text, jarvisstate.RunFinishedPrefix) {
			n++
		}
	}
	return n
}

// rcExpect checks one chunk's status, and whether the run holds it
func rcExpect(t *testing.T, oid, label, status string, runId string, held bool) {
	t.Helper()
	c := rcChunk(t, oid, label)
	if c.Status != status || rcHolds(c, runId) != held {
		t.Fatalf("chunk %q: status %q, held %v; want %q, held %v", label, c.Status, rcHolds(c, runId), status, held)
	}
}

func rcCreate(t *testing.T, ctx context.Context, name string, data wshrpc.CommandCreateRunData) (*waveobj.Channel, *wshrpc.CommandCreateRunRtnData, error) {
	t.Helper()
	ch, err := wstore.CreateChannel(ctx, name, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	data.ChannelId, data.WorkspaceId, data.Goal, data.Runtime = ch.OID, "ws", "g", "pi"
	rtn, err := (&WshServer{}).CreateRunCommand(ctx, data)
	return ch, rtn, err
}

// a deferred start counts as started: the ticked chunks turn pending and the run holds them, and the first one is the
// run's EffortRef
func TestRunChunksDeferredStartLeavesThemPendingAndAttached(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	a, b := rcEffort(t, "a1", "a2", "a3"), rcEffort(t, "b1")

	ch, rtn, err := rcCreate(t, ctx, "runchunks-deferred", wshrpc.CommandCreateRunData{
		Mode: jarvis.RunMode_Orchestrator, DeferStart: true,
		Chunks: []waveobj.RunEffortRef{{EffortOID: a, ChunkLabel: "a1"}, {EffortOID: b, ChunkLabel: "b1"}, {EffortOID: a, ChunkLabel: "a2"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	run := mustRun(t, ctx, ch.OID, rtn.Run.ID)
	if run.EffortRef == nil || *run.EffortRef != (waveobj.RunEffortRef{EffortOID: a, ChunkLabel: "a1"}) {
		t.Fatalf("effortref = %+v, want the first ticked chunk", run.EffortRef)
	}
	rcExpect(t, a, "a1", "pending", run.ID, true)
	rcExpect(t, a, "a2", "pending", run.ID, true)
	rcExpect(t, b, "b1", "pending", run.ID, true)
	rcExpect(t, a, "a3", "proposed", run.ID, false)
}

// a started quick run holds them too, once its first worker is up
func TestRunChunksAStartedRunHoldsThem(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	a := rcEffort(t, "a1")

	ch, rtn, err := rcCreate(t, ctx, "runchunks-started", wshrpc.CommandCreateRunData{
		Mode: jarvis.RunMode_Quick, Chunks: []waveobj.RunEffortRef{{EffortOID: a, ChunkLabel: "a1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	rcExpect(t, a, "a1", "pending", mustRun(t, ctx, ch.OID, rtn.Run.ID).ID, true)
}

// a quick run whose first worker would not start stays persisted, blocked and retryable: it keeps its chunks, so a
// retry works them and a cancel releases them
func TestRunChunksAFailedFirstSpawnStillHoldsThem(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", errors.New("no tab"))
	a := rcEffort(t, "a1")

	ch, _, err := rcCreate(t, ctx, "runchunks-spawnfail", wshrpc.CommandCreateRunData{
		Mode: jarvis.RunMode_Quick, Chunks: []waveobj.RunEffortRef{{EffortOID: a, ChunkLabel: "a1"}},
	})
	if err == nil || !strings.Contains(err.Error(), "spawning first worker") {
		t.Fatalf("want the spawn failure, got %v", err)
	}
	runs, gerr := wstore.GetChannelRuns(ctx, ch.OID)
	if gerr != nil || len(runs) != 1 {
		t.Fatalf("runs = %+v, %v; want the one persisted run", runs, gerr)
	}
	rcExpect(t, a, "a1", "pending", runs[0].ID, true)
}

// the request's own EffortOID stays the run's EffortRef; the ticked chunks are held beside it
func TestRunChunksKeepTheRequestsOwnEffortRef(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	own, other := rcEffort(t, "own"), rcEffort(t, "o1")

	ch, rtn, err := rcCreate(t, ctx, "runchunks-own", wshrpc.CommandCreateRunData{
		Mode: jarvis.RunMode_Quick, DeferStart: true, EffortOID: own, ChunkLabel: "own",
		Chunks: []waveobj.RunEffortRef{{EffortOID: other, ChunkLabel: "o1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	run := mustRun(t, ctx, ch.OID, rtn.Run.ID)
	if run.EffortRef == nil || *run.EffortRef != (waveobj.RunEffortRef{EffortOID: own, ChunkLabel: "own"}) {
		t.Fatalf("effortref = %+v, want the request's own", run.EffortRef)
	}
	rcExpect(t, other, "o1", "pending", run.ID, true)
	// the own chunk's attach runs detached; let it finish before the effort is removed
	deadline := time.Now().Add(5 * time.Second)
	for !rcHolds(rcChunk(t, own, "own"), run.ID) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
}

// a chunk that does not resolve is refused before anything persists, and takes the good ones with it
func TestRunChunksRefusedUpFrontLeaveNoRun(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	good := rcEffort(t, "g1")

	for name, tc := range map[string]struct {
		bad  waveobj.RunEffortRef
		want string
	}{
		"unknown initiative": {waveobj.RunEffortRef{EffortOID: "00000000-0000-0000-0000-000000000000", ChunkLabel: "x"}, "EC-UNKNOWN-EFFORT"},
		"unknown chunk":      {waveobj.RunEffortRef{EffortOID: good, ChunkLabel: "nope"}, "EC-UNKNOWN-CHUNK"},
	} {
		t.Run(name, func(t *testing.T) {
			ch, _, err := rcCreate(t, ctx, "runchunks-refused", wshrpc.CommandCreateRunData{
				Mode: jarvis.RunMode_Quick, DeferStart: true,
				Chunks: []waveobj.RunEffortRef{{EffortOID: good, ChunkLabel: "g1"}, tc.bad},
			})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want %s", err, tc.want)
			}
			if runs, _ := wstore.GetChannelRuns(ctx, ch.OID); len(runs) != 0 {
				t.Fatalf("a refused start persisted a run: %+v", runs)
			}
			c := rcChunk(t, good, "g1")
			if c.Status != "proposed" || len(c.WorkRefs) != 0 {
				t.Fatalf("a refused start moved the good chunk: %+v", c)
			}
		})
	}
}

// a plan the engine refused cancels the run, so its chunks never moved
func TestRunChunksARefusedPlanLeavesThemProposed(t *testing.T) {
	ctx := context.Background()
	ch, projectDir, plan, execGit := newSetupPlanRun(t, "echo ok")
	oldValidate := validateHarness
	validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
		if runs, _ := wstore.GetChannelRuns(ctx, ch.OID); len(runs) > 0 {
			return harness.Spec{}, fmt.Errorf("harness %q cannot run workers here", runtime)
		}
		spec, _ := harness.Lookup(runtime)
		return spec, nil
	}
	t.Cleanup(func() { validateHarness = oldValidate })
	a := rcEffort(t, "a1", "a2")

	_, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "g", Runtime: "pi", Mode: jarvis.RunMode_Orchestrator, PlanPath: plan,
		Chunks: []waveobj.RunEffortRef{{EffortOID: a, ChunkLabel: "a1"}, {EffortOID: a, ChunkLabel: "a2"}},
	})
	if err == nil || !strings.Contains(err.Error(), "submitting plan") {
		t.Fatalf("the refused plan must be reported, got %v", err)
	}
	assertRunTornDown(t, ch, projectDir, execGit)
	for _, label := range []string{"a1", "a2"} {
		c := rcChunk(t, a, label)
		if c.Status != "proposed" || len(c.WorkRefs) != 0 {
			t.Fatalf("a cancelled start moved chunk %q: %+v", label, c)
		}
	}
}

// a failed Setup goes to the run's lead, which fixes it and resubmits: the run is alive, so it holds its chunks
func TestRunChunksAFailedSetupHandedToTheLeadStillHoldsThem(t *testing.T) {
	ctx := context.Background()
	ch, _, plan, _ := newSetupPlanRun(t, "exit 3")
	stubLeadSpawn(t, nil)
	a := rcEffort(t, "a1")

	rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "g", Runtime: "pi", Mode: jarvis.RunMode_Orchestrator, PlanPath: plan,
		Chunks: []waveobj.RunEffortRef{{EffortOID: a, ChunkLabel: "a1"}},
	})
	if err != nil {
		t.Fatalf("a failed Setup goes to the lead, not back as a failed start: %v", err)
	}
	rcExpect(t, a, "a1", "pending", rtn.Run.ID, true)
}

// a started plan holds them once its dag is submitted
func TestRunChunksASubmittedPlanHoldsThem(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	ch, err := wstore.CreateChannel(ctx, "runchunks-plan", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	plan := filepath.Join(t.TempDir(), "plan.md")
	if err := os.WriteFile(plan, []byte("# Coupon codes\n\n### Task 1: input\nadd the field\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := rcEffort(t, "a1")

	rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "g", Runtime: "pi", Mode: jarvis.RunMode_Orchestrator, PlanPath: plan,
		Chunks: []waveobj.RunEffortRef{{EffortOID: a, ChunkLabel: "a1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	run := mustRun(t, ctx, ch.OID, rtn.Run.ID)
	if run.DagORef == "" {
		t.Fatal("the plan was not submitted, so the test proves nothing")
	}
	rcExpect(t, a, "a1", "pending", run.ID, true)
}

// rcHeldRun is a run holding the chunks, as a start leaves it: workrefs on each, the first one its EffortRef
func rcHeldRun(t *testing.T, status string, refs ...waveobj.RunEffortRef) waveobj.Run {
	t.Helper()
	run := jarvis.NewRun("the goal", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	run.Status = status
	if len(refs) > 0 {
		run.EffortRef = &refs[0]
		if err := jarvisstate.AttachRunToChunks(context.Background(), refs, "run:"+run.ID); err != nil {
			t.Fatal(err)
		}
	}
	return run
}

// a done run lets go of every chunk it held and says so on each
func TestRunChunksReleaseOfADoneRunDetachesAndNotesEach(t *testing.T) {
	ctx := context.Background()
	a, b := rcEffort(t, "a1", "a2"), rcEffort(t, "b1")
	run := rcHeldRun(t, jarvis.RunStatus_Done,
		waveobj.RunEffortRef{EffortOID: a, ChunkLabel: "a1"}, waveobj.RunEffortRef{EffortOID: b, ChunkLabel: "b1"}, waveobj.RunEffortRef{EffortOID: a, ChunkLabel: "a2"})

	for range 2 { // the seal backfill can run again
		releaseRunChunks(ctx, &run, "test")
	}
	for _, tc := range []struct{ oid, label string }{{a, "a1"}, {a, "a2"}, {b, "b1"}} {
		c := rcChunk(t, tc.oid, tc.label)
		if rcHolds(c, run.ID) || c.Status != "pending" {
			t.Fatalf("chunk %q: held %v, status %q; want released and still pending", tc.label, rcHolds(c, run.ID), c.Status)
		}
		if n := rcFinishNotes(c, run.ID); n != 1 {
			t.Fatalf("chunk %q has %d Run finished notes, want 1", tc.label, n)
		}
	}
}

// a cancelled run finished nothing: its chunks are free and stay pending on their initiatives, with no note
func TestRunChunksReleaseOfACancelledRunOnlyDetaches(t *testing.T) {
	ctx := context.Background()
	a := rcEffort(t, "a1", "a2")
	run := rcHeldRun(t, jarvis.RunStatus_Cancelled,
		waveobj.RunEffortRef{EffortOID: a, ChunkLabel: "a1"}, waveobj.RunEffortRef{EffortOID: a, ChunkLabel: "a2"})

	releaseRunChunks(ctx, &run, "test")
	for _, label := range []string{"a1", "a2"} {
		c := rcChunk(t, a, label)
		if rcHolds(c, run.ID) || c.Status != "pending" || rcFinishNotes(c, run.ID) != 0 {
			t.Fatalf("chunk %q: held %v, status %q, finish notes %d; want free, pending, no note", label, rcHolds(c, run.ID), c.Status, rcFinishNotes(c, run.ID))
		}
	}
}

// a run from before this change holds no workref the release could find (its seal already detached it): the done
// note still goes on the chunk its EffortRef names, and only that one
func TestRunChunksReleaseFallsBackToTheRunsEffortRef(t *testing.T) {
	ctx := context.Background()
	a := rcEffort(t, "a1", "a2")
	for _, tc := range []struct {
		status string
		notes  int
	}{{jarvis.RunStatus_Done, 1}, {jarvis.RunStatus_Cancelled, 0}} {
		run := rcHeldRun(t, tc.status)
		label := map[string]string{jarvis.RunStatus_Done: "a1", jarvis.RunStatus_Cancelled: "a2"}[tc.status]
		run.EffortRef = &waveobj.RunEffortRef{EffortOID: a, ChunkLabel: label}

		releaseRunChunks(ctx, &run, "test")
		if n := rcFinishNotes(rcChunk(t, a, label), run.ID); n != tc.notes {
			t.Fatalf("%s run: %d notes on its EffortRef chunk, want %d", tc.status, n, tc.notes)
		}
		other := map[string]string{"a1": "a2", "a2": "a1"}[label]
		if n := rcFinishNotes(rcChunk(t, a, other), run.ID); n != 0 {
			t.Fatalf("%s run: a note went on %q, which it never named", tc.status, other)
		}
	}
}

// a run with no initiative at all has nothing to release
func TestRunChunksReleaseOfARunWithNoChunksIsANoop(t *testing.T) {
	run := rcHeldRun(t, jarvis.RunStatus_Done)
	releaseRunChunks(context.Background(), &run, "test")
}

// both seal paths release what a done run held
func TestRunChunksSealingADoneRunReleasesThem(t *testing.T) {
	ctx := context.Background()
	a, b := rcEffort(t, "a1"), rcEffort(t, "b1")
	refs := []waveobj.RunEffortRef{{EffortOID: a, ChunkLabel: "a1"}, {EffortOID: b, ChunkLabel: "b1"}}
	seal := map[string]func(channelId, runId string){
		"the completion seal": sealDoneRunEvidence,
		"the backfill command": func(channelId, runId string) {
			if err := (&WshServer{}).SealRunEvidenceCommand(ctx, wshrpc.CommandSealRunEvidenceData{ChannelId: channelId, RunId: runId}); err != nil {
				t.Fatal(err)
			}
		},
	}
	for name, doSeal := range seal {
		t.Run(name, func(t *testing.T) {
			channelId, run := sealedDoneRun(t, func(r *waveobj.Run) {
				r.EffortRef = &refs[0]
				if err := jarvisstate.AttachRunToChunks(ctx, refs, "run:"+r.ID); err != nil {
					t.Fatal(err)
				}
			})
			doSeal(channelId, run.ID)
			if sealed, err := wstore.GetRun(ctx, channelId, run.ID); err != nil || sealed.Evidence == nil {
				t.Fatalf("the run was not sealed, so the test proves nothing: %v", err)
			}
			for _, ref := range refs {
				c := rcChunk(t, ref.EffortOID, ref.ChunkLabel)
				if rcHolds(c, run.ID) || rcFinishNotes(c, run.ID) != 1 {
					t.Fatalf("chunk %q: held %v, finish notes %d; want released and noted once", ref.ChunkLabel, rcHolds(c, run.ID), rcFinishNotes(c, run.ID))
				}
			}
		})
	}
}

// a plain run's cancel frees what it held
func TestRunChunksCancelOfAPlainRunReleasesThem(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	a, b := rcEffort(t, "a1", "a2"), rcEffort(t, "b1")

	ch, rtn, err := rcCreate(t, ctx, "runchunks-cancel-plain", wshrpc.CommandCreateRunData{
		Mode: jarvis.RunMode_Quick, DeferStart: true,
		Chunks: []waveobj.RunEffortRef{{EffortOID: a, ChunkLabel: "a1"}, {EffortOID: a, ChunkLabel: "a2"}, {EffortOID: b, ChunkLabel: "b1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := (&WshServer{}).CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: rtn.Run.ID}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ oid, label string }{{a, "a1"}, {a, "a2"}, {b, "b1"}} {
		c := rcChunk(t, tc.oid, tc.label)
		if rcHolds(c, rtn.Run.ID) || c.Status != "pending" || rcFinishNotes(c, rtn.Run.ID) != 0 {
			t.Fatalf("chunk %q: held %v, status %q, notes %d; want free, pending, no note", tc.label, rcHolds(c, rtn.Run.ID), c.Status, rcFinishNotes(c, rtn.Run.ID))
		}
	}
}

// an orchestrator run owns a dag, and its cancel goes through the engine: the chunks are freed there too
func TestRunChunksCancelOfADagOwnerReleasesThem(t *testing.T) {
	ctx := context.Background()
	a, b := rcEffort(t, "a1", "a2"), rcEffort(t, "b1")
	ch, err := wstore.CreateChannel(ctx, "runchunks-cancel-dag", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	dag, err := orchestrate.NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t", Label: "task"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	owner.DagORef = dag.OID
	refs := []waveobj.RunEffortRef{{EffortOID: a, ChunkLabel: "a1"}, {EffortOID: a, ChunkLabel: "a2"}, {EffortOID: b, ChunkLabel: "b1"}}
	owner.EffortRef = &refs[0]
	if err := jarvisstate.AttachRunToChunks(ctx, refs, "run:"+owner.ID); err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &dag); err != nil {
		t.Fatal(err)
	}

	if err := (&WshServer{}).CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: owner.ID}); err != nil {
		t.Fatal(err)
	}
	if got := mustRun(t, ctx, ch.OID, owner.ID); got.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("status = %q, so the cancel did not take the dag path to the end", got.Status)
	}
	for _, ref := range refs {
		c := rcChunk(t, ref.EffortOID, ref.ChunkLabel)
		if rcHolds(c, owner.ID) || c.Status != "pending" || rcFinishNotes(c, owner.ID) != 0 {
			t.Fatalf("chunk %q: held %v, status %q, notes %d; want free, pending, no note", ref.ChunkLabel, rcHolds(c, owner.ID), c.Status, rcFinishNotes(c, owner.ID))
		}
	}
}

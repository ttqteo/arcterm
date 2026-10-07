// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// TestResolveRunWorkerFromMeta_ResolvesAStampedWorker covers the stamp path: the runoref/channeloref on
// the worker tab lead to the run row, its channel and the phase. UUID ids are required because ParseORef
// validates the oid as a UUID.
func TestResolveRunWorkerFromMeta_ResolvesAStampedWorker(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "rw-meta", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	workerTabOID := uuid.NewString()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: workerTabOID, Name: "w", Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatalf("seed worker tab: %v", err)
	}
	workerTab := waveobj.MakeORef(waveobj.OType_Tab, workerTabOID).String()
	runID := uuid.NewString()
	run := waveobj.Run{ID: runID, Goal: "g", Status: "executing", CreatedTs: 1,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Plan}, {Kind: PhaseKind_Execute, WorkerOrefs: []string{workerTab}}}}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("append run: %v", err)
	}
	if err := wstore.StampWorkerOwner(ctx, workerTab,
		waveobj.MakeORef(waveobj.OType_Run, runID).String(),
		waveobj.MakeORef(waveobj.OType_Channel, ch.OID).String()); err != nil {
		t.Fatalf("stamp: %v", err)
	}
	m := ResolveRunWorkerFromMeta(ctx, workerTab)
	if m == nil || m.Channel.OID != ch.OID || m.Run.ID != runID || m.PhaseIdx != 1 {
		t.Fatalf("meta resolve wrong: %+v", m)
	}
}

// TestResolveRunWorkerFromMeta_FallsBackToScan proves a worker with no owner stamp still resolves, to
// the run row whose phase lists it, so a missing best-effort stamp never regresses resolution.
func TestResolveRunWorkerFromMeta_FallsBackToScan(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "rw-fallback", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	unstamped := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	runID := uuid.NewString()
	run := waveobj.Run{ID: runID, Goal: "g2", Status: "executing", CreatedTs: 2,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, WorkerOrefs: []string{unstamped}}}}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("append run: %v", err)
	}
	m := ResolveRunWorkerFromMeta(ctx, unstamped) // no stamp -> fallback scan
	if m == nil || m.Run.ID != runID || m.PhaseIdx != 0 || m.Channel.OID != ch.OID {
		t.Fatalf("fallback resolve wrong: %+v", m)
	}
}

// The fallback narrows the run rows by a substring match on the oref, so a run that only quotes a tab
// oref in its goal is a candidate. It is not that tab's run, and must not resolve as one.
func TestResolveRunWorkerFromMeta_IgnoresAnORefInGoalText(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "rw-goaltext", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	quoted := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	run := waveobj.Run{ID: uuid.NewString(), Goal: "look at what " + quoted + " did", Status: "executing", CreatedTs: 3,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, WorkerOrefs: []string{"tab:" + uuid.NewString()}}}}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("append run: %v", err)
	}
	if m := ResolveRunWorkerFromMeta(ctx, quoted); m != nil {
		t.Fatalf("a tab only quoted in a goal resolved to run %s", m.Run.ID)
	}
}

// A worker whose stamp is missing resolves through its messages: the earliest dispatch or directive in a
// gatekept channel owns it, and a concierge channel that dispatched it earlier is passed over.
func TestResolveAskOwner_UnstampedWorkerResolvesByItsMessages(t *testing.T) {
	ctx := context.Background()
	concierge := storedChannel(t, false)
	gatekept := storedChannel(t, true)
	// no tab row behind the oref, so the dispatch cannot stamp it and the stamp read misses
	worker := newTabORef()
	for _, m := range []struct {
		channel, kind, text string
		ts                  int64
	}{
		{concierge.OID, "dispatch", "concierge task", 10},
		{gatekept.OID, "directive", "nudge", 20},
		{gatekept.OID, "dispatch", "gatekept task", 30},
	} {
		if _, err := wstore.PostChannelMessage(ctx, m.channel, wstore.NewChannelMessage(m.kind, "claude", m.text, worker, m.ts)); err != nil {
			t.Fatalf("post %s: %v", m.kind, err)
		}
	}
	ch, task, _ := ResolveAskOwner(ctx, worker)
	if ch == nil || ch.OID != gatekept.OID || task != "gatekept task" {
		t.Fatalf("want the gatekept channel and its dispatch text, got ch=%+v task=%q", ch, task)
	}
	// the outcome belongs to the channel that dispatched first, whatever its tier
	if got := ResolveDispatchChannel(ctx, worker); got == nil || got.OID != concierge.OID {
		t.Fatalf("want the earliest dispatching channel, got %+v", got)
	}
}

// seedWorkerTab inserts a worker tab so StampWorkerOwner (and the B3 dispatch-stamp) can land its meta.
func seedWorkerTab(t *testing.T, ctx context.Context) string {
	t.Helper()
	oid := uuid.NewString()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: oid, Name: "w", Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatalf("seed worker tab: %v", err)
	}
	return waveobj.MakeORef(waveobj.OType_Tab, oid).String()
}

// A concierge worker dispatched by a gatekeeper-enabled channel resolves to that channel + its task.
func TestResolveAskOwner_Concierge(t *testing.T) {
	ctx := context.Background()
	gk, err := wstore.CreateChannel(ctx, "gk", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if _, err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Channel, gk.OID),
		waveobj.MetaMapType{MetaKey_GatekeeperEnabled: true}, false); err != nil {
		t.Fatalf("enable gatekeeper: %v", err)
	}
	worker := seedWorkerTab(t, ctx)
	dm := wstore.NewChannelMessage("dispatch", "claude", "concierge task", worker, 10)
	if _, err := wstore.PostChannelMessage(ctx, gk.OID, dm); err != nil { // also stamps channeloref (Task B3)
		t.Fatalf("post dispatch: %v", err)
	}
	ch, task, source := ResolveAskOwner(ctx, worker)
	if ch == nil || ch.OID != gk.OID || task != "concierge task" || source != "concierge task" {
		t.Fatalf("concierge resolve wrong: ch=%+v task=%q source=%q", ch, task, source)
	}
}

// A run worker (stamped run+channel) resolves via the run path FIRST — runoref precedence (Design Note 2).
func TestResolveAskOwner_RunWorker(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "run-ch", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	worker := seedWorkerTab(t, ctx)
	runID := uuid.NewString()
	run := waveobj.Run{ID: runID, Goal: "ship it", Status: "executing", CreatedTs: 1,
		Phases: []waveobj.RunPhase{{Kind: PhaseKind_Execute, Skill: "superpowers:writing-plans", WorkerOrefs: []string{worker}}}}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("append run: %v", err)
	}
	if err := wstore.StampWorkerOwner(ctx, worker,
		waveobj.MakeORef(waveobj.OType_Run, runID).String(),
		waveobj.MakeORef(waveobj.OType_Channel, ch.OID).String()); err != nil {
		t.Fatalf("stamp: %v", err)
	}
	gotCh, task, source := ResolveAskOwner(ctx, worker)
	if gotCh == nil || gotCh.OID != ch.OID {
		t.Fatalf("run worker resolve wrong channel: %+v", gotCh)
	}
	if !contains(task, "ship it") {
		t.Fatalf("run worker task should mention the run goal, got %q", task)
	}
	if !contains(source, "ship it") {
		t.Fatalf("run worker source should mention the run goal, got %q", source)
	}
}

// A concierge worker dispatched by a channel set to concierge is not owned by the gatekeeper (nil), matching
// the old ResolveGatekeeperChannel skip of non-enabled channels.
func TestResolveAskOwner_NonGatekeeper(t *testing.T) {
	ctx := context.Background()
	plain, err := wstore.CreateChannel(ctx, "plain", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if _, err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Channel, plain.OID),
		waveobj.MetaMapType{MetaKey_GatekeeperEnabled: false}, false); err != nil {
		t.Fatalf("set concierge: %v", err)
	}
	worker := seedWorkerTab(t, ctx)
	dm := wstore.NewChannelMessage("dispatch", "claude", "task", worker, 10)
	if _, err := wstore.PostChannelMessage(ctx, plain.OID, dm); err != nil {
		t.Fatalf("post dispatch: %v", err)
	}
	if ch, _, _ := ResolveAskOwner(ctx, worker); ch != nil {
		t.Fatalf("non-gatekeeper channel must not own the ask, got %+v", ch)
	}
}

func countOutcomes(t *testing.T, ctx context.Context, channelId, workerORef string) int {
	t.Helper()
	msgs, err := wstore.GetChannelMessages(ctx, channelId, 0, 0)
	if err != nil {
		t.Fatalf("read messages: %v", err)
	}
	n := 0
	for _, m := range msgs {
		if m.Kind == "outcome" && m.RefORef == workerORef {
			n++
		}
	}
	return n
}

// PostOutcome keeps the dispatch-existence gate: a
// worker WITH a dispatch message earns an outcome; a worker with NO dispatch message (e.g. a run worker
// that now carries channeloref) does not — even though the channel resolves.
func TestPostOutcomeOnlyForDispatchedWorker(t *testing.T) {
	ctx := context.Background()
	// dispatched worker -> gets an outcome
	ch, err := wstore.CreateChannel(ctx, "oc-dispatched", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	worker := seedWorkerTab(t, ctx)
	if _, err := wstore.PostChannelMessage(ctx, ch.OID, wstore.NewChannelMessage("dispatch", "claude", "task", worker, 10)); err != nil {
		t.Fatalf("post dispatch: %v", err)
	}
	full, _ := wstore.DBMustGet[*waveobj.Channel](ctx, ch.OID)
	PostOutcome(full, worker, "claude", OutcomeData{Status: "done", Summary: "s"})
	if got := countOutcomes(t, ctx, ch.OID, worker); got != 1 {
		t.Fatalf("dispatched worker should get exactly 1 outcome, got %d", got)
	}

	// non-dispatched worker (channel resolves, but no dispatch message) -> no outcome
	ch2, err := wstore.CreateChannel(ctx, "oc-undispatched", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	worker2 := seedWorkerTab(t, ctx)
	full2, _ := wstore.DBMustGet[*waveobj.Channel](ctx, ch2.OID)
	PostOutcome(full2, worker2, "claude", OutcomeData{Status: "done", Summary: "s"})
	if got := countOutcomes(t, ctx, ch2.OID, worker2); got != 0 {
		t.Fatalf("undispatched worker must get no outcome, got %d", got)
	}
}

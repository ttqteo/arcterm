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

// storedChannel creates a channel with the gatekeeper flag written explicitly both ways: an unset flag
// means on, so "disabled" has to be written. The store is shared by the package's tests, so every id a
// test resolves by is a fresh uuid.
func storedChannel(t *testing.T, enabled bool, runs ...waveobj.Run) *waveobj.Channel {
	t.Helper()
	ctx := context.Background()
	c, err := wstore.CreateChannel(ctx, "resolve-"+uuid.NewString(), "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if _, err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Channel, c.OID),
		waveobj.MetaMapType{MetaKey_GatekeeperEnabled: enabled}, false); err != nil {
		t.Fatalf("set gatekeeper flag: %v", err)
	}
	for _, run := range runs {
		if err := wstore.AppendRun(ctx, c.OID, run); err != nil {
			t.Fatalf("append run: %v", err)
		}
	}
	return c
}

func newTabORef() string {
	return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
}

// dispatchTo posts a dispatch for a worker with no tab row behind it, so no owner stamp lands and the
// resolvers have only the message to go on.
func dispatchTo(t *testing.T, channelId, oref, text string) {
	t.Helper()
	msg := wstore.NewChannelMessage("dispatch", "claude", text, oref, 1)
	if _, err := wstore.PostChannelMessage(context.Background(), channelId, msg); err != nil {
		t.Fatalf("post dispatch: %v", err)
	}
}

func TestResolveRunWorker_MatchesPhaseWorker(t *testing.T) {
	worker := newTabORef()
	run := waveobj.Run{ID: uuid.NewString(), Goal: "ship coupons", Phases: []waveobj.RunPhase{
		{Kind: PhaseKind_Brainstorm, State: PhaseState_Done, WorkerOrefs: []string{newTabORef()}},
		{Kind: PhaseKind_Plan, Skill: "superpowers:writing-plans", State: PhaseState_Running, WorkerOrefs: []string{worker}},
	}}
	c := storedChannel(t, true, run)
	m := resolveRunWorkerByScan(context.Background(), worker)
	if m == nil || m.Channel.OID != c.OID || m.Run.ID != run.ID || m.PhaseIdx != 1 {
		t.Fatalf("want %s/%s/phase 1, got %+v", c.OID, run.ID, m)
	}
}

func TestResolveRunWorker_MatchesRegardlessOfToggle(t *testing.T) {
	worker := newTabORef()
	run := waveobj.Run{ID: uuid.NewString(), Goal: "g", Phases: []waveobj.RunPhase{
		{Kind: PhaseKind_Execute, State: PhaseState_Running, WorkerOrefs: []string{worker}},
	}}
	storedChannel(t, false, run) // gatekeeper toggle OFF
	if m := resolveRunWorkerByScan(context.Background(), worker); m == nil {
		t.Fatalf("run workers must resolve even with the gatekeeper toggle off")
	}
}

func TestResolveRunWorker_NilForUnknown(t *testing.T) {
	run := waveobj.Run{ID: uuid.NewString(), Phases: []waveobj.RunPhase{{Kind: PhaseKind_Plan, WorkerOrefs: []string{newTabORef()}}}}
	storedChannel(t, true, run)
	if m := resolveRunWorkerByScan(context.Background(), newTabORef()); m != nil {
		t.Fatalf("want nil for unknown oref, got %+v", m)
	}
}

func TestRunWorkerTask_MentionsPhaseAndGoal(t *testing.T) {
	run := &waveobj.Run{Goal: "ship coupons", Phases: []waveobj.RunPhase{
		{Kind: PhaseKind_Plan, Skill: "superpowers:writing-plans"},
	}}
	task := runWorkerTask(run, 0)
	for _, want := range []string{"plan", "superpowers:writing-plans", "ship coupons"} {
		if !contains(task, want) {
			t.Fatalf("task missing %q: %s", want, task)
		}
	}
}

func TestResolve_EnabledOwner(t *testing.T) {
	c := storedChannel(t, true)
	worker := newTabORef()
	dispatchTo(t, c.OID, worker, "harden webhooks")
	got, task := resolveGatekeeperChannelByMeta(context.Background(), worker)
	if got == nil || got.OID != c.OID {
		t.Fatalf("want %s, got %v", c.OID, got)
	}
	if task != "harden webhooks" {
		t.Fatalf("want task, got %q", task)
	}
}

func TestResolve_NotEnabledIgnored(t *testing.T) {
	c := storedChannel(t, false)
	worker := newTabORef()
	dispatchTo(t, c.OID, worker, "x")
	if got, _ := resolveGatekeeperChannelByMeta(context.Background(), worker); got != nil {
		t.Fatalf("want nil for disabled channel, got %v", got)
	}
}

func TestResolve_NoOwner(t *testing.T) {
	c := storedChannel(t, true)
	dispatchTo(t, c.OID, newTabORef(), "x")
	if got, _ := resolveGatekeeperChannelByMeta(context.Background(), newTabORef()); got != nil {
		t.Fatalf("want nil for unowned oref, got %v", got)
	}
}

func TestGatekeeperForTier(t *testing.T) {
	cases := []struct {
		tier    string
		want    bool
		wantErr bool
	}{
		{"gatekeeper", true, false},
		{"concierge", false, false},
		// the retired third rung, and anything else, must not quietly land on either tier
		{"delegator", false, true},
		{"", false, true},
		{"bogus", false, true},
	}
	for _, c := range cases {
		got, err := GatekeeperForTier(c.tier)
		if (err != nil) != c.wantErr || got != c.want {
			t.Errorf("GatekeeperForTier(%q) = (%v, %v), want (%v, err=%v)", c.tier, got, err, c.want, c.wantErr)
		}
	}
}

// A project nobody has configured is gatekept; only an explicit concierge pick turns it off.
func TestGatekeeperOnDefaultsOn(t *testing.T) {
	cases := []struct {
		name string
		meta waveobj.MetaMapType
		want bool
	}{
		{"nil meta", nil, true},
		{"never set", waveobj.MetaMapType{}, true},
		{"gatekeeper", waveobj.MetaMapType{MetaKey_GatekeeperEnabled: true}, true},
		{"concierge", waveobj.MetaMapType{MetaKey_GatekeeperEnabled: false}, false},
	}
	for _, c := range cases {
		if got := GatekeeperOn(&waveobj.Channel{Meta: c.meta}); got != c.want {
			t.Errorf("%s: GatekeeperOn = %v, want %v", c.name, got, c.want)
		}
	}
}

// A tab oref (what a dispatch records) and an unparseable oref pass through ChannelOwnerORef
// unchanged — only a block oref triggers the DB block→tab walk (covered by the live E2E).
func TestChannelOwnerORef_Passthrough(t *testing.T) {
	if got := ChannelOwnerORef(context.Background(), "tab:t1"); got != "tab:t1" {
		t.Fatalf("tab oref should pass through, got %q", got)
	}
	if got := ChannelOwnerORef(context.Background(), "not-an-oref"); got != "not-an-oref" {
		t.Fatalf("unparseable oref should pass through, got %q", got)
	}
}

func boolPtr(b bool) *bool    { return &b }
func strPtr(s string) *string { return &s }

func TestResolveProfile_DefaultMode(t *testing.T) {
	global := waveobj.JarvisProfile{DefaultMode: RunMode_Pipeline}

	// nil override inherits global
	got := ResolveProfile(global, nil)
	if got.DefaultMode != RunMode_Pipeline {
		t.Fatalf("nil override: got mode=%q", got.DefaultMode)
	}

	// override replaces the section
	ov := &waveobj.ProfileOverride{DefaultMode: strPtr(RunMode_Orchestrator)}
	got = ResolveProfile(global, ov)
	if got.DefaultMode != RunMode_Orchestrator {
		t.Fatalf("override: got mode=%q", got.DefaultMode)
	}
}

func TestResolveDispatchChannelFindsConciergeChannel(t *testing.T) {
	// concierge (gatekeeper OFF) channel still owns its dispatch
	c := storedChannel(t, false)
	worker := newTabORef()
	dispatchTo(t, c.OID, worker, "do a thing")
	got := ResolveDispatchChannel(context.Background(), worker)
	if got == nil || got.OID != c.OID {
		t.Fatalf("got %v, want %s", got, c.OID)
	}
}

func TestResolveDispatchChannelNoMatch(t *testing.T) {
	ctx := context.Background()
	c := storedChannel(t, false)
	worker := newTabORef()
	// a message that names the worker without dispatching it does not make the channel its owner
	if _, err := wstore.PostChannelMessage(ctx, c.OID, wstore.NewChannelMessage("outcome", "claude", "done", worker, 1)); err != nil {
		t.Fatalf("post outcome: %v", err)
	}
	if got := ResolveDispatchChannel(ctx, worker); got != nil {
		t.Fatalf("got %v, want nil", got)
	}
}

func TestRunOwnsWorker(t *testing.T) {
	run := &waveobj.Run{ID: "r1", Phases: []waveobj.RunPhase{
		{Kind: PhaseKind_Plan, WorkerOrefs: []string{"tab:t1"}},
		{Kind: PhaseKind_Execute, WorkerOrefs: []string{"tab:t2", "tab:t3"}},
	}}
	if !RunOwnsWorker(run, "tab:t2") {
		t.Fatalf("expected run to own tab:t2")
	}
	if RunOwnsWorker(run, "tab:nope") {
		t.Fatalf("did not expect run to own tab:nope")
	}
	if RunOwnsWorker(nil, "tab:t1") {
		t.Fatalf("nil run owns nothing")
	}
}

// a lead works in the project checkout, which is also the project path of every other running dag run of that
// project, so the scan must resolve its tab to the run that lists it even when another run comes first.
func TestResolveRunWorker_ResolvesALeadToItsOwnRunBesideAnotherRunOfTheSameProject(t *testing.T) {
	const project = `C:\repo`
	tabOID := uuid.NewString()
	blockOID := uuid.NewString()
	other := waveobj.Run{ID: uuid.NewString(), DagORef: "g1", ProjectPath: project, CreatedTs: 1, Phases: []waveobj.RunPhase{
		{Kind: PhaseKind_Execute, State: PhaseState_Running, WorkerOrefs: []string{newTabORef()}},
	}}
	own := waveobj.Run{ID: uuid.NewString(), DagORef: "g2", ProjectPath: project, CreatedTs: 2, Phases: []waveobj.RunPhase{
		{Kind: PhaseKind_Execute, State: PhaseState_Running, WorkerOrefs: []string{"tab:" + tabOID}},
	}}
	storedChannel(t, true, other, own)
	// the lead tab's first block carries cmd:cwd = the project checkout (UUID ids: ParseORef validates)
	tab := &waveobj.Tab{OID: tabOID, BlockIds: []string{blockOID}}
	if err := wstore.DBInsert(context.Background(), tab); err != nil {
		t.Fatal(err)
	}
	block := &waveobj.Block{OID: blockOID, Meta: waveobj.MetaMapType{waveobj.MetaKey_CmdCwd: project}}
	if err := wstore.DBInsert(context.Background(), block); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		wstore.DBDelete(context.Background(), waveobj.OType_Tab, tabOID)
		wstore.DBDelete(context.Background(), waveobj.OType_Block, blockOID)
	})
	m := resolveRunWorkerByScan(context.Background(), "tab:"+tabOID)
	if m == nil || m.Run.ID != own.ID {
		t.Fatalf("lead must resolve to its own run, got %+v", m)
	}
}

func TestRunWorkerSourceCarriesOnlyTheHeadline(t *testing.T) {
	run := &waveobj.Run{Goal: "ship coupons\nwith a long body the classifier needs", Phases: []waveobj.RunPhase{
		{Kind: PhaseKind_Plan, Skill: "superpowers:writing-plans"},
	}}
	if task := runWorkerTask(run, 0); !contains(task, "with a long body") {
		t.Fatalf("the classifier's task must keep the full goal: %q", task)
	}
	src := runWorkerSource(run, 0)
	if !contains(src, "ship coupons") || contains(src, "long body") || !contains(src, "superpowers:writing-plans") {
		t.Fatalf("source = %q", src)
	}
	if got := runWorkerSource(run, 5); got != "ship coupons" {
		t.Fatalf("out-of-range source = %q", got)
	}
}

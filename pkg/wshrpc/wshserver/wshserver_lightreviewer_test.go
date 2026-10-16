// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const lightReviewerField = "lightReviewerRoute"

func TestCreateRunCarriesLightReviewerRoute(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	profileRoute := &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-sonnet-5-5"}
	sent := &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-opus-5-5"}

	run, err := createEngineRun(t, ctx, &waveobj.ProfileOverride{LightReviewerRoute: profileRoute}, wshrpc.CommandCreateRunData{LightReviewerRoute: sent})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if !samePin(run.LightReviewerRoute, sent) {
		t.Fatalf("light reviewer route = %+v, want the sent one", run.LightReviewerRoute)
	}

	run, err = createEngineRun(t, ctx, &waveobj.ProfileOverride{LightReviewerRoute: profileRoute}, wshrpc.CommandCreateRunData{})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if !samePin(run.LightReviewerRoute, profileRoute) {
		t.Fatalf("light reviewer route = %+v, want the profile's", run.LightReviewerRoute)
	}

	run, err = createEngineRun(t, ctx, nil, wshrpc.CommandCreateRunData{})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if run.LightReviewerRoute != nil {
		t.Fatalf("light reviewer route = %+v, want nil (claude/sonnet)", run.LightReviewerRoute)
	}
}

func TestCreateRunRefusesABadLightReviewerRoute(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	_, err := createEngineRun(t, ctx, nil, wshrpc.CommandCreateRunData{LightReviewerRoute: &waveobj.RoutePin{Runtime: "openrouter"}})
	if err == nil || !strings.Contains(err.Error(), lightReviewerField) {
		t.Fatalf("err = %v, want a refusal naming %s", err, lightReviewerField)
	}
}

// Before a dag exists the run is the pending carrier, and a bad route is refused without a write.
func TestSetRunSettingsAppliesLightReviewerRouteBeforeDag(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-light-pending", jarvis.Orchestration_Engine)
	ws := &WshServer{}
	route := &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-sonnet-5-5"}

	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, LightReviewerRoute: &waveobj.RoutePin{Runtime: "openrouter"},
	}); err == nil || !strings.Contains(err.Error(), lightReviewerField) {
		t.Fatalf("err = %v, want a refusal naming %s", err, lightReviewerField)
	}
	if got := mustRun(t, ctx, ch.OID, run.ID); got.LightReviewerRoute != nil {
		t.Fatalf("a refused write was persisted: %+v", got.LightReviewerRoute)
	}

	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, LightReviewerRoute: route,
	}); err != nil {
		t.Fatalf("SetRunSettingsCommand: %v", err)
	}
	if got := mustRun(t, ctx, ch.OID, run.ID); !samePin(got.LightReviewerRoute, route) {
		t.Fatalf("pending: light reviewer route = %+v, want %+v", got.LightReviewerRoute, route)
	}
}

// After submit the group is the authority: it gets the route and the run keeps its launch snapshot.
func TestSetRunSettingsAppliesLightReviewerRouteAfterSubmit(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-light-live", jarvis.Orchestration_Engine)
	ws := &WshServer{}
	pending := &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-sonnet-5-5"}
	live := &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-opus-5-5"}

	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, LightReviewerRoute: pending,
	}); err != nil {
		t.Fatalf("SetRunSettingsCommand: %v", err)
	}
	g := submitPlan(t, ctx, ch, run.ID)
	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, LightReviewerRoute: live,
	}); err != nil {
		t.Fatalf("SetRunSettingsCommand after submit: %v", err)
	}
	got, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatalf("GetDag: %v", err)
	}
	if !samePin(got.LightReviewerRoute, live) {
		t.Fatalf("live: group light reviewer route = %+v, want %+v", got.LightReviewerRoute, live)
	}
	if r := mustRun(t, ctx, ch.OID, run.ID); !samePin(r.LightReviewerRoute, pending) {
		t.Fatalf("the run changed after submit: light reviewer route = %+v, want %+v", r.LightReviewerRoute, pending)
	}

	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{ChannelId: ch.OID, RunId: run.ID}); err != nil {
		t.Fatalf("SetRunSettingsCommand clear: %v", err)
	}
	if got, err = wstore.GetDag(ctx, g.OID); err != nil {
		t.Fatalf("GetDag: %v", err)
	}
	if got.LightReviewerRoute != nil {
		t.Fatalf("a nil value must clear the group's: %+v", got.LightReviewerRoute)
	}
}

func TestProfileSaveRefusesABadLightReviewerRoute(t *testing.T) {
	ctx := context.Background()
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}
	bad := &waveobj.RoutePin{Runtime: "openrouter"}

	global := jarvis.BuiltinProfile()
	global.LightReviewerRoute = bad
	if err := ws.SetGlobalProfileCommand(ctx, wshrpc.CommandSetGlobalProfileData{Profile: global}); err == nil || !strings.Contains(err.Error(), lightReviewerField) {
		t.Fatalf("global: err = %v, want a refusal naming %s", err, lightReviewerField)
	}
	if got := jarvis.LoadGlobalProfile(); got.LightReviewerRoute != nil {
		t.Fatalf("a refused global profile was written: %+v", got.LightReviewerRoute)
	}

	ch, err := wstore.CreateChannel(ctx, "profile-light", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	if err := ws.SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID, Override: &waveobj.ProfileOverride{LightReviewerRoute: bad},
	}); err == nil || !strings.Contains(err.Error(), lightReviewerField) {
		t.Fatalf("override: err = %v, want a refusal naming %s", err, lightReviewerField)
	}
	if channelHasProfileMeta(t, ctx, ch.OID) {
		t.Fatal("a refused override must not write channel meta")
	}
}

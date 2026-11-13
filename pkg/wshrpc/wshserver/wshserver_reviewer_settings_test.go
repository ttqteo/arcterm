// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func boolPtr(b bool) *bool { return &b }

func samePin(a, b *waveobj.RoutePin) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

const pairRefusal = "reviewerPicks and workerRoute are both set"

func createEngineRun(t *testing.T, ctx context.Context, override *waveobj.ProfileOverride, data wshrpc.CommandCreateRunData) (*waveobj.Run, error) {
	t.Helper()
	ch, err := wstore.CreateChannel(ctx, "reviewer-settings", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	if override != nil {
		seedProfileMeta(t, ctx, ch.OID, override)
	}
	data.ChannelId, data.WorkspaceId, data.Goal, data.Runtime = ch.OID, "ws", "g", "pi"
	data.Mode, data.DeferStart = jarvis.RunMode_Orchestrator, true
	rtn, err := (&WshServer{}).CreateRunCommand(ctx, data)
	if err != nil {
		return nil, err
	}
	return rtn.Run, nil
}

func TestCreateRunReviewerPicksInheritance(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	reviewer := &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-sonnet-5-5"}
	profileRoute := &waveobj.RoutePin{Runtime: "pi"}

	run, err := createEngineRun(t, ctx, &waveobj.ProfileOverride{ReviewerPicks: boolPtr(true), ReviewerRoute: reviewer}, wshrpc.CommandCreateRunData{})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if !run.ReviewerPicks || run.WorkerRoute != nil || !samePin(run.ReviewerRoute, reviewer) {
		t.Fatalf("nil data: picks=%v worker=%+v reviewer=%+v, want the profile's picks and reviewer route", run.ReviewerPicks, run.WorkerRoute, run.ReviewerRoute)
	}

	// a caller that sends the workers setting owns it: no route with picks false is Same as lead
	run, err = createEngineRun(t, ctx, &waveobj.ProfileOverride{WorkerRoute: profileRoute}, wshrpc.CommandCreateRunData{ReviewerPicks: boolPtr(false)})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if run.ReviewerPicks || run.WorkerRoute != nil {
		t.Fatalf("sent false: picks=%v worker=%+v, want Same as lead though the profile names a route", run.ReviewerPicks, run.WorkerRoute)
	}

	// a sent route with picks false beats a profile on Reviewer picks (wsh runs start --worker-runtime)
	sentWorker := &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-sonnet-5-5"}
	run, err = createEngineRun(t, ctx, &waveobj.ProfileOverride{ReviewerPicks: boolPtr(true)}, wshrpc.CommandCreateRunData{WorkerRoute: sentWorker, ReviewerPicks: boolPtr(false)})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if run.ReviewerPicks || !samePin(run.WorkerRoute, sentWorker) {
		t.Fatalf("sent route: picks=%v worker=%+v, want the sent route and no picks", run.ReviewerPicks, run.WorkerRoute)
	}

	// with nothing sent, the profile's route still hydrates as before
	run, err = createEngineRun(t, ctx, &waveobj.ProfileOverride{WorkerRoute: profileRoute}, wshrpc.CommandCreateRunData{})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if run.ReviewerPicks || !samePin(run.WorkerRoute, profileRoute) || run.ReviewerRoute != nil {
		t.Fatalf("nil data: picks=%v worker=%+v reviewer=%+v, want the profile's route", run.ReviewerPicks, run.WorkerRoute, run.ReviewerRoute)
	}

	// a sent reviewer route beats the profile's
	sent := &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-opus-5-5"}
	run, err = createEngineRun(t, ctx, &waveobj.ProfileOverride{ReviewerRoute: reviewer}, wshrpc.CommandCreateRunData{ReviewerRoute: sent})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if !samePin(run.ReviewerRoute, sent) {
		t.Fatalf("reviewer route = %+v, want the sent one", run.ReviewerRoute)
	}
}

func TestCreateRunRefusesPicksWithRoute(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	_, err := createEngineRun(t, ctx, nil, wshrpc.CommandCreateRunData{
		ReviewerPicks: boolPtr(true), WorkerRoute: &waveobj.RoutePin{Runtime: "pi"},
	})
	if err == nil || !strings.Contains(err.Error(), pairRefusal) {
		t.Fatalf("err = %v, want %q", err, pairRefusal)
	}
	_, err = createEngineRun(t, ctx, nil, wshrpc.CommandCreateRunData{ReviewerRoute: &waveobj.RoutePin{Runtime: "openrouter"}})
	if err == nil || !strings.Contains(err.Error(), "reviewerRoute") {
		t.Fatalf("err = %v, want a refusal naming reviewerRoute", err)
	}
}

func TestSetRunSettingsReviewerFields(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-reviewer", jarvis.Orchestration_Engine)
	ws := &WshServer{}
	reviewer := &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-sonnet-5-5"}

	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, ReviewerPicks: true, WorkerRoute: &waveobj.RoutePin{Runtime: "pi"},
	}); err == nil || !strings.Contains(err.Error(), pairRefusal) {
		t.Fatalf("err = %v, want %q", err, pairRefusal)
	}
	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, ReviewerRoute: &waveobj.RoutePin{Runtime: "openrouter"},
	}); err == nil || !strings.Contains(err.Error(), "reviewerRoute") {
		t.Fatalf("err = %v, want a refusal naming reviewerRoute", err)
	}
	if got := mustRun(t, ctx, ch.OID, run.ID); got.ReviewerPicks || got.ReviewerRoute != nil {
		t.Fatalf("a refused write was persisted: %+v", got)
	}

	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, ReviewerPicks: true, ReviewerRoute: reviewer,
	}); err != nil {
		t.Fatalf("SetRunSettingsCommand: %v", err)
	}
	if got := mustRun(t, ctx, ch.OID, run.ID); !got.ReviewerPicks || !samePin(got.ReviewerRoute, reviewer) {
		t.Fatalf("pending: picks=%v reviewer=%+v", got.ReviewerPicks, got.ReviewerRoute)
	}

	g := submitPlan(t, ctx, ch, run.ID)
	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, ReviewerPicks: true, ReviewerRoute: reviewer,
	}); err != nil {
		t.Fatalf("SetRunSettingsCommand after submit: %v", err)
	}
	live, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatalf("GetDag: %v", err)
	}
	if !live.ReviewerPicks || !samePin(live.ReviewerRoute, reviewer) {
		t.Fatalf("live: picks=%v reviewer=%+v", live.ReviewerPicks, live.ReviewerRoute)
	}
	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{ChannelId: ch.OID, RunId: run.ID}); err != nil {
		t.Fatalf("SetRunSettingsCommand clear: %v", err)
	}
	if live, err = wstore.GetDag(ctx, g.OID); err != nil {
		t.Fatalf("GetDag: %v", err)
	}
	if live.ReviewerPicks || live.ReviewerRoute != nil {
		t.Fatalf("a zero value must clear the group's: picks=%v reviewer=%+v", live.ReviewerPicks, live.ReviewerRoute)
	}
}

// the global profile is validated like an override: a width out of range or a worker route that cannot
// resolve, once stored, would refuse every later orchestrator launch that inherits it, blaming the launch
func TestGlobalProfileSaveRefusesBadWidthAndWorkerRoute(t *testing.T) {
	ctx := context.Background()
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}

	global := jarvis.BuiltinProfile()
	global.Parallelism = orchestrate.MaxParallelism + 1
	if err := ws.SetGlobalProfileCommand(ctx, wshrpc.CommandSetGlobalProfileData{Profile: global}); err == nil || !strings.Contains(err.Error(), "parallelism") {
		t.Fatalf("width %d: err = %v, want a parallelism refusal", global.Parallelism, err)
	}
	global.Parallelism, global.WorkerRoute = 0, &waveobj.RoutePin{Runtime: "openrouter"}
	if err := ws.SetGlobalProfileCommand(ctx, wshrpc.CommandSetGlobalProfileData{Profile: global}); err == nil || !strings.Contains(err.Error(), "workerRoute") {
		t.Fatalf("err = %v, want a refusal naming workerRoute", err)
	}
	if got := jarvis.LoadGlobalProfile(); got.Parallelism != 0 || got.WorkerRoute != nil {
		t.Fatalf("a refused global profile was written: %+v", got)
	}
	// 0 is the global profile's documented "let the lead choose"
	global.WorkerRoute = &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-sonnet-5-5"}
	if err := ws.SetGlobalProfileCommand(ctx, wshrpc.CommandSetGlobalProfileData{Profile: global}); err != nil {
		t.Fatalf("width 0 with a valid worker route: %v", err)
	}
}

func TestProfileSaveRefusesPicksWithRoute(t *testing.T) {
	ctx := context.Background()
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}
	route := &waveobj.RoutePin{Runtime: "pi"}

	global := jarvis.BuiltinProfile()
	global.ReviewerPicks, global.WorkerRoute = true, route
	if err := ws.SetGlobalProfileCommand(ctx, wshrpc.CommandSetGlobalProfileData{Profile: global}); err == nil || !strings.Contains(err.Error(), pairRefusal) {
		t.Fatalf("global: err = %v, want %q", err, pairRefusal)
	}
	global.WorkerRoute, global.ReviewerRoute = nil, &waveobj.RoutePin{Runtime: "openrouter"}
	if err := ws.SetGlobalProfileCommand(ctx, wshrpc.CommandSetGlobalProfileData{Profile: global}); err == nil || !strings.Contains(err.Error(), "reviewerRoute") {
		t.Fatalf("global: err = %v, want a refusal naming reviewerRoute", err)
	}
	if got := jarvis.LoadGlobalProfile(); got.ReviewerPicks || got.ReviewerRoute != nil {
		t.Fatalf("a refused global profile was written: %+v", got)
	}
	global.ReviewerRoute = &waveobj.RoutePin{Runtime: "pi", Model: "anthropic/claude-sonnet-5-5"}
	if err := ws.SetGlobalProfileCommand(ctx, wshrpc.CommandSetGlobalProfileData{Profile: global}); err != nil {
		t.Fatalf("global picks with a reviewer route: %v", err)
	}

	ch, err := wstore.CreateChannel(ctx, "profile-pair", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	if err := ws.SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID, Override: &waveobj.ProfileOverride{ReviewerPicks: boolPtr(true), WorkerRoute: route},
	}); err == nil || !strings.Contains(err.Error(), pairRefusal) {
		t.Fatalf("override: err = %v, want %q", err, pairRefusal)
	}
	if err := ws.SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID, Override: &waveobj.ProfileOverride{ReviewerRoute: &waveobj.RoutePin{Runtime: "openrouter"}},
	}); err == nil || !strings.Contains(err.Error(), "reviewerRoute") {
		t.Fatalf("override: err = %v, want a refusal naming reviewerRoute", err)
	}
	if channelHasProfileMeta(t, ctx, ch.OID) {
		t.Fatal("a refused override must not write channel meta")
	}
}

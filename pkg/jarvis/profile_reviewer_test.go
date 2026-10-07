// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func routeEq(a, b *waveobj.RoutePin) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// The workers setting is one section made of the pair, so an override that names either half owns both.
func TestResolveProfileWorkersPair(t *testing.T) {
	globalRoute := &waveobj.RoutePin{Runtime: "pi"}
	overrideRoute := &waveobj.RoutePin{Runtime: "claude", Model: "sonnet"}
	cases := []struct {
		name      string
		global    waveobj.JarvisProfile
		override  *waveobj.ProfileOverride
		wantPicks bool
		wantRoute *waveobj.RoutePin
	}{
		{"picks override a global route", waveobj.JarvisProfile{WorkerRoute: globalRoute}, &waveobj.ProfileOverride{ReviewerPicks: boolPtr(true)}, true, nil},
		{"false picks is Same as lead", waveobj.JarvisProfile{ReviewerPicks: true}, &waveobj.ProfileOverride{ReviewerPicks: boolPtr(false)}, false, nil},
		{"a route override clears global picks", waveobj.JarvisProfile{ReviewerPicks: true}, &waveobj.ProfileOverride{WorkerRoute: overrideRoute}, false, overrideRoute},
		{"nil override keeps a global route", waveobj.JarvisProfile{WorkerRoute: globalRoute}, nil, false, globalRoute},
		{"nil override keeps global picks", waveobj.JarvisProfile{ReviewerPicks: true}, nil, true, nil},
		{"an unrelated override keeps global picks", waveobj.JarvisProfile{ReviewerPicks: true}, &waveobj.ProfileOverride{Parallelism: intPtr(2)}, true, nil},
	}
	for _, tc := range cases {
		got := ResolveProfile(tc.global, tc.override)
		if got.ReviewerPicks != tc.wantPicks || !routeEq(got.WorkerRoute, tc.wantRoute) {
			t.Errorf("%s: picks=%v route=%+v, want picks=%v route=%+v", tc.name, got.ReviewerPicks, got.WorkerRoute, tc.wantPicks, tc.wantRoute)
		}
	}
}

func TestResolveProfileReviewerRoute(t *testing.T) {
	globalRoute := &waveobj.RoutePin{Runtime: "claude", Model: "opus"}
	overrideRoute := &waveobj.RoutePin{Runtime: "pi"}
	global := waveobj.JarvisProfile{ReviewerRoute: globalRoute}
	if got := ResolveProfile(global, &waveobj.ProfileOverride{ReviewerRoute: overrideRoute}); !routeEq(got.ReviewerRoute, overrideRoute) {
		t.Errorf("reviewer route = %+v, want the override's", got.ReviewerRoute)
	}
	if got := ResolveProfile(global, &waveobj.ProfileOverride{Parallelism: intPtr(2)}); !routeEq(got.ReviewerRoute, globalRoute) {
		t.Errorf("reviewer route = %+v, want the global's", got.ReviewerRoute)
	}
	// the reviewer route is its own section: a workers override does not touch it
	if got := ResolveProfile(global, &waveobj.ProfileOverride{ReviewerPicks: boolPtr(true)}); !routeEq(got.ReviewerRoute, globalRoute) {
		t.Errorf("reviewer route = %+v, want the global's beside a workers override", got.ReviewerRoute)
	}
}

func TestProfileOverrideIsEmptyReviewerFields(t *testing.T) {
	cases := []struct {
		name     string
		override *waveobj.ProfileOverride
	}{
		{"reviewerpicks true", &waveobj.ProfileOverride{ReviewerPicks: boolPtr(true)}},
		// false is a value: it overrides a global route or picks back to Same as lead
		{"reviewerpicks false", &waveobj.ProfileOverride{ReviewerPicks: boolPtr(false)}},
		{"reviewerroute", &waveobj.ProfileOverride{ReviewerRoute: &waveobj.RoutePin{Runtime: "pi"}}},
	}
	for _, tc := range cases {
		if ProfileOverrideIsEmpty(tc.override) {
			t.Errorf("%s: ProfileOverrideIsEmpty = true, want false", tc.name)
		}
	}
}

func TestApplyEngineSettingsReviewerFields(t *testing.T) {
	reviewer := &waveobj.RoutePin{Runtime: "claude", Model: "opus"}
	set := PendingEngineSettings{ReviewerPicks: true, ReviewerRoute: reviewer}

	r := ApplyPendingEngineSettings(engineRun(), set)
	if !r.ReviewerPicks || !routeEq(r.ReviewerRoute, reviewer) {
		t.Fatalf("pending: picks=%v reviewer=%+v", r.ReviewerPicks, r.ReviewerRoute)
	}
	cleared := ApplyPendingEngineSettings(r, PendingEngineSettings{})
	if cleared.ReviewerPicks || cleared.ReviewerRoute != nil {
		t.Fatalf("a zero value must clear the run's: picks=%v reviewer=%+v", cleared.ReviewerPicks, cleared.ReviewerRoute)
	}

	g := ApplyLiveEngineSettings(waveobj.TaskGroup{Parallelism: 2}, set)
	if !g.ReviewerPicks || !routeEq(g.ReviewerRoute, reviewer) {
		t.Fatalf("live: picks=%v reviewer=%+v", g.ReviewerPicks, g.ReviewerRoute)
	}
	g = ApplyLiveEngineSettings(g, PendingEngineSettings{})
	if g.ReviewerPicks || g.ReviewerRoute != nil {
		t.Fatalf("a zero value must clear the group's: picks=%v reviewer=%+v", g.ReviewerPicks, g.ReviewerRoute)
	}
}

func TestMigrateReviewerRoutePins(t *testing.T) {
	ctx := context.Background()
	withConfigHome(t, t.TempDir())
	profile := LoadGlobalProfile()
	profile.ReviewerRoute = &waveobj.RoutePin{Runtime: "claude", Tier: "cheap"}
	if err := SaveGlobalProfile(profile); err != nil {
		t.Fatal(err)
	}
	ch, err := wstore.CreateChannel(ctx, "reviewer-migrate", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	seedOverride(t, ctx, ch.OID, &waveobj.ProfileOverride{ReviewerRoute: &waveobj.RoutePin{Runtime: "claude", Tier: "mid"}})
	run := NewRun("reviewer run", "ws-1", t.TempDir(), nil, RunMode_Orchestrator, DefaultOrchestratorPlaybook(), 1)
	run.ReviewerRoute = &waveobj.RoutePin{Runtime: "claude", Tier: "cheap"}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	dag := seedTierDag(t, ctx, ch.OID, run.ID, nil)
	if err := wstore.UpdateDag(ctx, dag.OID, func(g *waveobj.TaskGroup) error {
		g.ReviewerRoute = &waveobj.RoutePin{Runtime: "pi", Tier: "capable"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := migrateTierPinsOnce(ctx); err != nil {
		t.Fatal(err)
	}

	cheap := waveobj.RoutePin{Runtime: "claude", Model: consult.CheapModel}
	if got := LoadGlobalProfile().ReviewerRoute; !routeEq(got, &cheap) {
		t.Fatalf("global reviewer route = %+v", got)
	}
	storedCh, err := wstore.DBMustGet[*waveobj.Channel](ctx, ch.OID)
	if err != nil {
		t.Fatal(err)
	}
	if o := OverrideFromMeta(storedCh); o == nil || !routeEq(o.ReviewerRoute, &waveobj.RoutePin{Runtime: "claude", Model: consult.MidModel}) {
		t.Fatalf("channel override = %+v", o)
	}
	storedRun, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !routeEq(storedRun.ReviewerRoute, &cheap) {
		t.Fatalf("run reviewer route = %+v", storedRun.ReviewerRoute)
	}
	storedDag, err := wstore.GetDag(ctx, dag.OID)
	if err != nil {
		t.Fatal(err)
	}
	if !routeEq(storedDag.ReviewerRoute, &waveobj.RoutePin{Runtime: "pi"}) {
		t.Fatalf("dag reviewer route = %+v", storedDag.ReviewerRoute)
	}
}

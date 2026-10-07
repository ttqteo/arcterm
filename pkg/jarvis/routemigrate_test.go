// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedOverride stores the override through the same meta write SetChannelProfileCommand uses.
func seedOverride(t *testing.T, ctx context.Context, channelId string, override *waveobj.ProfileOverride) {
	t.Helper()
	if err := wstore.DBUpdateFn(ctx, channelId, func(ch *waveobj.Channel) {
		if ch.Meta == nil {
			ch.Meta = make(waveobj.MetaMapType)
		}
		ch.Meta[MetaKey_JarvisProfile] = override
	}); err != nil {
		t.Fatal(err)
	}
}

func seedTierDag(t *testing.T, ctx context.Context, channelId, runId string, route *waveobj.RoutePin) *waveobj.TaskGroup {
	t.Helper()
	dagID := uuid.NewString()
	dag := &waveobj.TaskGroup{
		OID: dagID, ID: dagID, RunID: runId, ChannelId: channelId, Title: "g", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-0", Label: "a", State: "pending"}}, Status: "running", CreatedTs: 1, UpdatedTs: 1,
		WorkerRoute: route,
	}
	if err := wstore.AppendDag(ctx, dag); err != nil {
		t.Fatal(err)
	}
	return dag
}

func TestMigrateTierPinsRewritesEveryStore(t *testing.T) {
	ctx := context.Background()
	withConfigHome(t, t.TempDir())
	if err := wconfig.WriteWaveHomeConfigFile(wconfig.SettingsFile, waveobj.MetaMapType{
		wconfig.ConfigKey_HarnessPreferredRuntime: "claude",
		settingsKeyPreferredTier:                  "mid",
	}); err != nil {
		t.Fatal(err)
	}
	profile := LoadGlobalProfile()
	profile.WorkerRoute = &waveobj.RoutePin{Runtime: "claude", Tier: "cheap"}
	if err := SaveGlobalProfile(profile); err != nil {
		t.Fatal(err)
	}
	ch, err := wstore.CreateChannel(ctx, "tier-migrate", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	seedOverride(t, ctx, ch.OID, &waveobj.ProfileOverride{
		Route:       &waveobj.RoutePin{Runtime: "claude", Tier: "capable"},
		WorkerRoute: &waveobj.RoutePin{Runtime: "claude", Tier: "mid"},
	})
	run := NewRun("tier run", "ws-1", t.TempDir(), nil, RunMode_Orchestrator, DefaultOrchestratorPlaybook(), 1)
	run.WorkerRoute = &waveobj.RoutePin{Runtime: "claude", Tier: "cheap"}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	dag := seedTierDag(t, ctx, ch.OID, run.ID, &waveobj.RoutePin{Runtime: "pi", Tier: "capable"})

	if err := migrateTierPinsOnce(ctx); err != nil {
		t.Fatal(err)
	}

	settings, _ := wconfig.ReadWaveHomeConfigFile(wconfig.SettingsFile)
	if _, present := settings[settingsKeyPreferredTier]; present || settings[wconfig.ConfigKey_HarnessPreferredModel] != consult.MidModel {
		t.Fatalf("settings = %+v, want the tier moved into the preferred model", settings)
	}
	if got := LoadGlobalProfile().WorkerRoute; got == nil || *got != (waveobj.RoutePin{Runtime: "claude", Model: consult.CheapModel}) {
		t.Fatalf("global worker route = %+v", got)
	}
	storedCh, err := wstore.DBMustGet[*waveobj.Channel](ctx, ch.OID)
	if err != nil {
		t.Fatal(err)
	}
	override := OverrideFromMeta(storedCh)
	if override == nil || *override.Route != (waveobj.RoutePin{Runtime: "claude"}) || *override.WorkerRoute != (waveobj.RoutePin{Runtime: "claude", Model: consult.MidModel}) {
		t.Fatalf("channel override = %+v", override)
	}
	wantRunRoute := waveobj.RoutePin{Runtime: "claude", Model: consult.CheapModel}
	storedRun, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if storedRun.WorkerRoute == nil || *storedRun.WorkerRoute != wantRunRoute {
		t.Fatalf("run row worker route = %+v", storedRun.WorkerRoute)
	}
	storedDag, err := wstore.GetDag(ctx, dag.OID)
	if err != nil {
		t.Fatal(err)
	}
	if storedDag.WorkerRoute == nil || *storedDag.WorkerRoute != (waveobj.RoutePin{Runtime: "pi"}) {
		t.Fatalf("dag worker route = %+v", storedDag.WorkerRoute)
	}

	// a second pass finds nothing to rewrite and leaves the results intact
	if err := migrateTierPinsOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if got := LoadGlobalProfile().WorkerRoute; got == nil || got.Model != consult.CheapModel {
		t.Fatalf("second pass changed the global worker route: %+v", got)
	}
}

func TestMigratePreferredTierWithoutSettingsFile(t *testing.T) {
	dir := t.TempDir()
	withConfigHome(t, dir)
	if err := migratePreferredTier(); err != nil {
		t.Fatalf("missing settings file: %v", err)
	}
	if _, err := os.Stat(filepath.Join(wavebase.GetWaveConfigDir(), wconfig.SettingsFile)); !os.IsNotExist(err) {
		t.Fatalf("settings file created or unreadable: %v", err)
	}
}

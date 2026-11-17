// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func seedProfileMeta(t *testing.T, ctx context.Context, id string, meta any) {
	t.Helper()
	if err := wstore.DBUpdateFn(ctx, id, func(ch *waveobj.Channel) {
		if ch.Meta == nil {
			ch.Meta = make(waveobj.MetaMapType)
		}
		ch.Meta[jarvis.MetaKey_JarvisProfile] = meta
	}); err != nil {
		t.Fatalf("seeding meta: %v", err)
	}
}

func channelHasProfileMeta(t *testing.T, ctx context.Context, id string) bool {
	t.Helper()
	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, id)
	if err != nil {
		t.Fatalf("reloading channel: %v", err)
	}
	return ch.Meta.HasKey(jarvis.MetaKey_JarvisProfile)
}

// stale replacement/disabled IDs must resolve away and surface as diagnostics without mutating the global list.
func TestGetJarvisProfileReturnsDiagnostics(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "diag-chan", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	seedProfileMeta(t, ctx, ch.OID, &waveobj.ProfileOverride{
		Principles: &waveobj.PrinciplePatch{
			Replacements: map[string]string{"ghost-replace": "x"},
			Disabled:     []string{"ghost-disable"},
		},
	})
	rtn, err := (&WshServer{}).GetJarvisProfileCommand(ctx, wshrpc.CommandGetJarvisProfileData{ChannelId: ch.OID})
	if err != nil {
		t.Fatal(err)
	}
	if len(rtn.Global.Principles) != len(jarvis.DefaultPrinciples) {
		t.Fatalf("global principles: got %d want %d", len(rtn.Global.Principles), len(jarvis.DefaultPrinciples))
	}
	if len(rtn.Resolved.Principles) != len(jarvis.DefaultPrinciples) {
		t.Fatalf("resolved should ignore stale entries: got %d", len(rtn.Resolved.Principles))
	}
	codes := map[string]string{}
	for _, d := range rtn.PrincipleDiagnostics {
		codes[d.PrincipleID] = d.Code
	}
	if codes["ghost-replace"] != jarvis.DiagnosticMissingReplacement {
		t.Errorf("expected missing-replacement diagnostic, got %+v", rtn.PrincipleDiagnostics)
	}
	if codes["ghost-disable"] != jarvis.DiagnosticMissingDisabled {
		t.Errorf("expected missing-disabled diagnostic, got %+v", rtn.PrincipleDiagnostics)
	}
}

// a legacy project string persisted by old builds is surfaced to the FE as a normalized structured patch
// (disable every global + a single legacy-project addition) while resolving to its exact text.
func TestGetJarvisProfileNormalizesLegacyOverride(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "legacy-chan", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	seedProfileMeta(t, ctx, ch.OID, map[string]any{"principles": "legacy project text"})
	rtn, err := (&WshServer{}).GetJarvisProfileCommand(ctx, wshrpc.CommandGetJarvisProfileData{ChannelId: ch.OID})
	if err != nil {
		t.Fatal(err)
	}
	if rtn.Override == nil || rtn.Override.Principles == nil {
		t.Fatal("expected a structured override view")
	}
	adds := rtn.Override.Principles.Additions
	if len(adds) != 1 || adds[0].ID != waveobj.LegacyProjectPrincipleID || adds[0].Text != "legacy project text" {
		t.Fatalf("legacy not normalized to a project addition: %+v", rtn.Override.Principles)
	}
	if len(rtn.Override.Principles.Disabled) != len(jarvis.DefaultPrinciples) {
		t.Fatalf("legacy should disable all globals: %+v", rtn.Override.Principles.Disabled)
	}
	if got := jarvis.RenderPrinciples(rtn.Resolved.Principles); got != "legacy project text" {
		t.Fatalf("resolved legacy text mismatch: %q", got)
	}
}

func TestSetChannelProfileRejectsBlankText(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "blank-chan", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	err = (&WshServer{}).SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID,
		Override:  &waveobj.ProfileOverride{Principles: &waveobj.PrinciplePatch{Additions: []waveobj.Principle{{ID: "p1", Text: "   "}}}},
	})
	if err == nil {
		t.Fatal("expected validation error for blank addition text")
	}
	if channelHasProfileMeta(t, ctx, ch.OID) {
		t.Fatal("must not write channel meta on validation failure")
	}
}

func TestSetChannelProfileRejectsCollision(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "collide-chan", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	err = (&WshServer{}).SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID,
		Override:  &waveobj.ProfileOverride{Principles: &waveobj.PrinciplePatch{Additions: []waveobj.Principle{{ID: jarvis.DefaultPrinciples[0].ID, Text: "dup"}}}},
	})
	if err == nil {
		t.Fatal("expected error for addition id colliding with a global principle")
	}
	if channelHasProfileMeta(t, ctx, ch.OID) {
		t.Fatal("must not write channel meta on collision")
	}
}

func TestSetChannelProfileStoresPatch(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "store-chan", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	disableID := jarvis.DefaultPrinciples[2].ID
	if err := (&WshServer{}).SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID,
		Override:  &waveobj.ProfileOverride{Principles: &waveobj.PrinciplePatch{Disabled: []string{disableID}}},
	}); err != nil {
		t.Fatal(err)
	}
	reloaded, err := wstore.DBMustGet[*waveobj.Channel](ctx, ch.OID)
	if err != nil {
		t.Fatal(err)
	}
	ov := jarvis.OverrideFromMeta(reloaded)
	if ov == nil || ov.Principles == nil {
		t.Fatal("expected a stored principle patch")
	}
	if len(ov.Principles.Disabled) != 1 || ov.Principles.Disabled[0] != disableID {
		t.Fatalf("stored patch mismatch: %+v", ov.Principles)
	}
}

func TestSetChannelProfileRouteRoundTripsWithoutResolvedRoute(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "route-chan", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	route := &waveobj.RoutePin{Runtime: "pi"}
	if err := (&WshServer{}).SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID,
		Override:  &waveobj.ProfileOverride{Route: route},
	}); err != nil {
		t.Fatal(err)
	}
	reloaded, err := wstore.DBMustGet[*waveobj.Channel](ctx, ch.OID)
	if err != nil {
		t.Fatal(err)
	}
	stored := jarvis.OverrideFromMeta(reloaded)
	if stored == nil || stored.Route == nil || *stored.Route != *route {
		t.Fatalf("stored route mismatch: %+v", stored)
	}
	got, err := (&WshServer{}).GetJarvisProfileCommand(ctx, wshrpc.CommandGetJarvisProfileData{ChannelId: ch.OID})
	if err != nil {
		t.Fatal(err)
	}
	if got.Override == nil || got.Override.Route == nil || *got.Override.Route != *route {
		t.Fatalf("returned route mismatch: %+v", got.Override)
	}
	resolved, err := json.Marshal(got.Resolved)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(resolved), "route") {
		t.Fatalf("resolved profile leaked route: %s", resolved)
	}
}

func TestSetChannelProfileRejectsInvalidRouteBeforeWrite(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "invalid-route-chan", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	seedProfileMeta(t, ctx, ch.OID, &waveobj.ProfileOverride{Route: &waveobj.RoutePin{Runtime: "pi"}})
	invalid := &waveobj.RoutePin{Runtime: "openrouter"}
	if err := (&WshServer{}).SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID,
		Override:  &waveobj.ProfileOverride{Route: invalid},
	}); err == nil {
		t.Fatal("expected invalid route error")
	}
	reloaded, err := wstore.DBMustGet[*waveobj.Channel](ctx, ch.OID)
	if err != nil {
		t.Fatal(err)
	}
	stored := jarvis.OverrideFromMeta(reloaded)
	if stored == nil || stored.Route == nil || stored.Route.Runtime != "pi" {
		t.Fatalf("invalid route changed profile: %+v", stored)
	}
}

func TestSetChannelProfileNilRouteClearsEmptyOverride(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "clear-route-chan", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	seedProfileMeta(t, ctx, ch.OID, &waveobj.ProfileOverride{Route: &waveobj.RoutePin{Runtime: "pi"}})
	if err := (&WshServer{}).SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID,
		Override:  &waveobj.ProfileOverride{},
	}); err != nil {
		t.Fatal(err)
	}
	if channelHasProfileMeta(t, ctx, ch.OID) {
		t.Fatal("nil route with no other sections should clear override")
	}
}

func TestSetChannelProfileOmitsEmptyPatchAndDeletes(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "empty-chan", "/repo")
	if err != nil {
		t.Fatal(err)
	}
	seedProfileMeta(t, ctx, ch.OID, &waveobj.ProfileOverride{Principles: &waveobj.PrinciplePatch{Disabled: []string{jarvis.DefaultPrinciples[0].ID}}})
	if err := (&WshServer{}).SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID,
		Override:  &waveobj.ProfileOverride{Principles: &waveobj.PrinciplePatch{}},
	}); err != nil {
		t.Fatal(err)
	}
	if channelHasProfileMeta(t, ctx, ch.OID) {
		t.Fatal("an all-empty patch should be omitted and the empty override should delete the key")
	}
}

func withConfigHome(t *testing.T, dir string) {
	t.Helper()
	old := wavebase.ConfigHome_VarCache
	t.Cleanup(func() {
		wavebase.ConfigHome_VarCache = old
		// a project command reloads the watcher from dir; read the package's own config back for the next test
		wconfig.GetWatcher().Reload()
	})
	wavebase.ConfigHome_VarCache = dir
	// pin the vault inside dir: unset, it resolves to the real ~/.waveterm/vault, and portable settings
	// writes land in its config layer
	settings, err := json.Marshal(map[string]string{wconfig.ConfigKey_MemoryVaultPath: filepath.Join(dir, "vault")})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, wconfig.SettingsFile), settings, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestGetGlobalProfileCommandReturnsBuiltinWhenUnset(t *testing.T) {
	withConfigHome(t, t.TempDir())
	got, err := (&WshServer{}).GetGlobalProfileCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Principles) != len(jarvis.DefaultPrinciples) {
		t.Fatalf("expected builtin principles, got %d", len(got.Principles))
	}
}

func TestSetGlobalProfileCommandPersists(t *testing.T) {
	withConfigHome(t, t.TempDir())
	profile := jarvis.BuiltinProfile()
	profile.Principles = append(waveobj.PrincipleList(nil), profile.Principles...)
	profile.Principles[0].Text = "Edited global principle."
	profile.DefaultMode = "orchestrator"
	if err := (&WshServer{}).SetGlobalProfileCommand(context.Background(), wshrpc.CommandSetGlobalProfileData{Profile: profile}); err != nil {
		t.Fatal(err)
	}
	got, err := (&WshServer{}).GetGlobalProfileCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.Principles[0].Text != "Edited global principle." {
		t.Fatalf("edited principle not persisted: %q", got.Principles[0].Text)
	}
	if got.DefaultMode != "orchestrator" {
		t.Fatalf("defaultmode not persisted: %q", got.DefaultMode)
	}
}

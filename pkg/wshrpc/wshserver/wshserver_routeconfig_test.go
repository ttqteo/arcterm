// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// reads the effective settings: the route keys are portable, so they live in the vault layer
func readSettings(t *testing.T) wconfig.SettingsType {
	t.Helper()
	full := wconfig.ReadFullConfig()
	if len(full.ConfigErrors) > 0 {
		t.Fatalf("reading settings: %v", full.ConfigErrors)
	}
	return full.Settings
}

func readPreferredRoute(t *testing.T) (string, string) {
	t.Helper()
	settings := readSettings(t)
	return settings.HarnessPreferredRuntime, settings.HarnessPreferredModel
}

func TestSetConfigPreferredRouteGuardsAtomicPairs(t *testing.T) {
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}
	ctx := context.Background()
	valid := waveobj.MetaMapType{
		wconfig.ConfigKey_HarnessPreferredRuntime: "pi",
		wconfig.ConfigKey_HarnessPreferredModel:   "opencode/deepseek-v4-flash",
	}
	if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: valid}); err != nil {
		t.Fatalf("seed valid route: %v", err)
	}

	for name, patch := range map[string]waveobj.MetaMapType{
		"unsupported runtime": {
			wconfig.ConfigKey_HarnessPreferredRuntime: "openrouter",
			wconfig.ConfigKey_HarnessPreferredModel:   "",
		},
		"model outside the runtime namespace": {
			wconfig.ConfigKey_HarnessPreferredRuntime: "claude",
			wconfig.ConfigKey_HarnessPreferredModel:   "opencode/deepseek-v4-pro",
		},
		// a runtime alone would leave the previous runtime's model in settings
		"one-key patch": {
			wconfig.ConfigKey_HarnessPreferredRuntime: "claude",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: patch}); err == nil {
				t.Fatal("expected route validation error")
			}
			gotRuntime, gotModel := readPreferredRoute(t)
			if gotRuntime != "pi" || gotModel != "opencode/deepseek-v4-flash" {
				t.Fatalf("invalid patch changed route: got %q/%q", gotRuntime, gotModel)
			}
		})
	}

	if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: waveobj.MetaMapType{"term:fontfamily": "route-test"}}); err != nil {
		t.Fatalf("unrelated config patch: %v", err)
	}
	if got := readSettings(t).TermFontFamily; got != "route-test" {
		t.Fatalf("unrelated patch not persisted: %q", got)
	}
}

func TestSetConfigPreferredRouteRejectsNonStringValues(t *testing.T) {
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}
	ctx := context.Background()
	if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: waveobj.MetaMapType{
		wconfig.ConfigKey_HarnessPreferredRuntime: "pi",
		wconfig.ConfigKey_HarnessPreferredModel:   "opencode/deepseek-v4-flash",
	}}); err != nil {
		t.Fatalf("seed valid route: %v", err)
	}
	if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: waveobj.MetaMapType{
		wconfig.ConfigKey_HarnessPreferredRuntime: "pi",
		wconfig.ConfigKey_HarnessPreferredModel:   1,
	}}); err == nil {
		t.Fatal("expected non-string route validation error")
	}
	gotRuntime, gotModel := readPreferredRoute(t)
	if gotRuntime != "pi" || gotModel != "opencode/deepseek-v4-flash" {
		t.Fatalf("non-string patch changed route: got %q/%q", gotRuntime, gotModel)
	}
}

// a null pair is how a caller returns to "no preference": both keys are deleted, not left behind as empty strings
func TestSetConfigPreferredRouteNullPairClearsPreference(t *testing.T) {
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}
	ctx := context.Background()
	if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: waveobj.MetaMapType{
		wconfig.ConfigKey_HarnessPreferredRuntime: "pi",
		wconfig.ConfigKey_HarnessPreferredModel:   "opencode/deepseek-v4-flash",
	}}); err != nil {
		t.Fatalf("seed valid route: %v", err)
	}
	clearPair := wshrpc.MetaSettingsType{MetaMapType: waveobj.MetaMapType{
		wconfig.ConfigKey_HarnessPreferredRuntime: nil,
		wconfig.ConfigKey_HarnessPreferredModel:   nil,
	}}
	if err := ws.SetConfigCommand(ctx, clearPair); err != nil {
		t.Fatalf("null pair rejected: %v", err)
	}
	if gotRuntime, gotModel := readPreferredRoute(t); gotRuntime != "" || gotModel != "" {
		t.Fatalf("null pair left a route saved: got %q/%q", gotRuntime, gotModel)
	}
	// with nothing saved it is a no-op, not an error: a teardown that restores "none" may run on a store that is already there
	if err := ws.SetConfigCommand(ctx, clearPair); err != nil {
		t.Fatalf("null pair with nothing saved rejected: %v", err)
	}
}

// one null beside a string is still refused, so a half patch cannot strand the other key
func TestSetConfigPreferredRouteLoneNullRefused(t *testing.T) {
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}
	ctx := context.Background()
	if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: waveobj.MetaMapType{
		wconfig.ConfigKey_HarnessPreferredRuntime: "pi",
		wconfig.ConfigKey_HarnessPreferredModel:   "opencode/deepseek-v4-flash",
	}}); err != nil {
		t.Fatalf("seed valid route: %v", err)
	}
	for name, patch := range map[string]waveobj.MetaMapType{
		"null runtime, string model": {
			wconfig.ConfigKey_HarnessPreferredRuntime: nil,
			wconfig.ConfigKey_HarnessPreferredModel:   "",
		},
		"string runtime, null model": {
			wconfig.ConfigKey_HarnessPreferredRuntime: "pi",
			wconfig.ConfigKey_HarnessPreferredModel:   nil,
		},
	} {
		t.Run(name, func(t *testing.T) {
			if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: patch}); err == nil {
				t.Fatal("expected a lone null to be refused")
			}
			gotRuntime, gotModel := readPreferredRoute(t)
			if gotRuntime != "pi" || gotModel != "opencode/deepseek-v4-flash" {
				t.Fatalf("refused patch changed route: got %q/%q", gotRuntime, gotModel)
			}
		})
	}
}

func TestSetConfigPreferredRouteModelPin(t *testing.T) {
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}
	ctx := context.Background()
	modelPatch := waveobj.MetaMapType{
		wconfig.ConfigKey_HarnessPreferredRuntime: "pi",
		wconfig.ConfigKey_HarnessPreferredModel:   "opencode/deepseek-v4-flash",
	}
	if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: modelPatch}); err != nil {
		t.Fatalf("valid model pin rejected: %v", err)
	}
	gotRuntime, gotModel := readPreferredRoute(t)
	if gotRuntime != "pi" || gotModel != "opencode/deepseek-v4-flash" {
		t.Fatalf("model pin not persisted: got %q/%q", gotRuntime, gotModel)
	}

	// switching back to the runtime default must clear the stale model
	defaultPatch := waveobj.MetaMapType{
		wconfig.ConfigKey_HarnessPreferredRuntime: "pi",
		wconfig.ConfigKey_HarnessPreferredModel:   "",
	}
	if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: defaultPatch}); err != nil {
		t.Fatalf("runtime default with cleared model rejected: %v", err)
	}
	gotRuntime, gotModel = readPreferredRoute(t)
	if gotRuntime != "pi" || gotModel != "" {
		t.Fatalf("stale model not cleared: got %q/%q", gotRuntime, gotModel)
	}

	// model without runtime is rejected
	if err := ws.SetConfigCommand(ctx, wshrpc.MetaSettingsType{MetaMapType: waveobj.MetaMapType{
		wconfig.ConfigKey_HarnessPreferredModel: "opencode/deepseek-v4-flash",
	}}); err == nil {
		t.Fatal("expected model-only patch to be rejected")
	}
}

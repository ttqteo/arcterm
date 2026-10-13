// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runroute

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func useDataDir(t *testing.T) string {
	t.Helper()
	prev := wavebase.DataHome_VarCache
	wavebase.DataHome_VarCache = t.TempDir()
	t.Cleanup(func() { wavebase.DataHome_VarCache = prev })
	return wavebase.DataHome_VarCache
}

// a mark survives a restart, a later refusal of the same route replaces it, and it lapses after the TTL
func TestRefusedRoutesPersistReplaceAndExpire(t *testing.T) {
	useDataDir(t)
	const day = int64(24 * 60 * 60 * 1000)
	now := int64(100 * day)
	if got := RefusedRoutes(now); len(got) != 0 {
		t.Fatalf("no file reads as no marks, got %+v", got)
	}
	bare := RefusedRoute{Runtime: "pi", Text: "403: subscription required", Ts: now - 8*day}
	model := RefusedRoute{Runtime: "pi", Model: "opencode-go/deepseek-v4-flash", Text: "403: subscription required", Ts: now - day}
	if err := RecordRefused(now, bare, model); err != nil {
		t.Fatal(err)
	}
	if got, want := RefusedRoutes(now), []RefusedRoute{model}; !reflect.DeepEqual(got, want) {
		t.Fatalf("a mark past the TTL lapses: got %+v, want %+v", got, want)
	}
	again := RefusedRoute{Runtime: "pi", Model: "opencode-go/deepseek-v4-flash", Text: "401: key revoked", Ts: now}
	if err := RecordRefused(now, again); err != nil {
		t.Fatal(err)
	}
	if got, want := RefusedRoutes(now), []RefusedRoute{again}; !reflect.DeepEqual(got, want) {
		t.Fatalf("a second refusal of a route replaces its mark: got %+v, want %+v", got, want)
	}
}

func TestClearRefusedDropsEveryMark(t *testing.T) {
	useDataDir(t)
	if err := ClearRefused(); err != nil {
		t.Fatalf("clearing with no file: %v", err)
	}
	if err := RecordRefused(1, RefusedRoute{Runtime: "pi", Text: "403", Ts: 1}); err != nil {
		t.Fatal(err)
	}
	if err := ClearRefused(); err != nil {
		t.Fatal(err)
	}
	if got := RefusedRoutes(1); len(got) != 0 {
		t.Fatalf("cleared marks came back: %+v", got)
	}
}

// a damaged file costs the picker its warnings, never the caller an error
func TestUnreadableRefusedFileReadsAsNoMarks(t *testing.T) {
	dir := useDataDir(t)
	if err := os.WriteFile(filepath.Join(dir, refusedRoutesFile), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := RefusedRoutes(1); len(got) != 0 {
		t.Fatalf("got %+v", got)
	}
	if err := RecordRefused(1, RefusedRoute{Runtime: "pi", Text: "403", Ts: 1}); err != nil {
		t.Fatal(err)
	}
	if got := RefusedRoutes(1); len(got) != 1 {
		t.Fatalf("a refusal recorded over a damaged file is kept, got %+v", got)
	}
}

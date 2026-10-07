// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var testVaultDir string

// TestMain points the wave data dir at a throwaway temp dir and initializes the wstore SQLite DB
// (running the embedded migrations) so the resolver/dispatch tests can exercise routing to the
// DB-backed resolvers against a real, empty store. Mirrors pkg/wstore/wstore_maintest_test.go.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "wshserver-test-*")
	if err != nil {
		panic(err)
	}
	wavebase.DataHome_VarCache = dir
	if err := wavebase.EnsureWaveDBDir(); err != nil {
		panic(err)
	}
	configDir := filepath.Join(dir, "config")
	testVaultDir = filepath.Join(dir, "vault")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		panic(err)
	}
	settings, err := json.Marshal(map[string]any{wconfig.ConfigKey_MemoryVaultPath: testVaultDir})
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "settings.json"), settings, 0o644); err != nil {
		panic(err)
	}
	wavebase.ConfigHome_VarCache = configDir
	// the config is read only when the watcher starts; without it VaultRoot falls back to ~/.waveterm/vault
	wconfig.GetWatcher().Start()
	if err := wstore.InitWStore(); err != nil {
		panic(err)
	}
	// seal evidence inline in tests: deterministic, and no seal goroutine outlives a test to touch the
	// shared package-level store. Tests that assert on the dispatch itself override sealAsync locally.
	sealAsync = func(fn func()) { fn() }
	// Continuity capture opens the real vault + calls a model; keep it out of the package's run tests.
	// The dedicated wiring test overrides this locally to observe the dispatch.
	captureAsync = func(fn func()) {}
	// a background tick can merge, run Setup and add worktrees in a fixture's temp repo while the test removes it
	// (a2c2ca6e). Tests that need the tick run it themselves or record the poke.
	scheduleDag = func(string) {}
	// tests spawn workers through a stub that makes no tab, so there is nothing to start, and a missing tab
	// must not read as a worker that exited
	jarvis.StartRunWorker = func(context.Context, string) error { return nil }
	orchestrate.SetWorkerGoneForTest(func(context.Context, *waveobj.Run) bool { return false })
	code := m.Run()
	// a test that repoints the config home without restoring it hands every later test the real vault
	// (fixture efforts and tasks landed in ~/.waveterm/vault that way); TestVaultIsTheTestsOwn runs too early to see it
	if root := memroots.VaultRoot(); !strings.HasPrefix(filepath.Clean(root), filepath.Clean(testVaultDir)) {
		fmt.Fprintf(os.Stderr, "FAIL: after the tests the vault root is %q, outside the test vault %q\n", root, testVaultDir)
		code = 1
	}
	os.RemoveAll(dir)
	os.Exit(code)
}

// every run the package creates captures a dossier into the vault; a test must never write the user's
func TestVaultIsTheTestsOwn(t *testing.T) {
	if !strings.HasPrefix(filepath.Clean(memroots.VaultRoot()), filepath.Clean(testVaultDir)) {
		t.Fatalf("vault root %q is outside the test vault %q", memroots.VaultRoot(), testVaultDir)
	}
}

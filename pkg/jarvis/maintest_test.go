// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// TestMain points the wave data dir at a throwaway temp dir and initializes the wstore SQLite DB so the
// DB-backed resolution tests in this package (worker-owner meta lookup + scan fallback) have a real
// store. Mirrors pkg/wstore's TestMain; the pure-function tests here are unaffected by the extra init.
// It points the effort store at an empty vault under the same dir too: the attention gather reads every
// initiative, so the real vault's proposed or due chunks would leak into a queue a test expects empty.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "jarvis-test-*")
	if err != nil {
		panic(err)
	}
	wavebase.DataHome_VarCache = dir
	if err := wavebase.EnsureWaveDBDir(); err != nil {
		panic(err)
	}
	if err := wstore.InitWStore(); err != nil {
		panic(err)
	}
	restoreVault := effortstore.UseRootForTest(filepath.Join(dir, "vault"))
	code := m.Run()
	restoreVault()
	os.RemoveAll(dir)
	os.Exit(code)
}

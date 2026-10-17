// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"os"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// TestMain points the wave data dir at a throwaway temp dir and initializes the wstore SQLite DB, so the agent
// restore tests run against a real, empty store.
func TestMain(m *testing.M) {
	// the stand-in for a daemon a closed block left behind (leftovers_darwin_test.go): it only waits
	if os.Getenv("ARC_TEST_LEFTOVER") != "" {
		time.Sleep(time.Minute)
		os.Exit(0)
	}
	dir, err := os.MkdirTemp("", "blockcontroller-test-*")
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
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

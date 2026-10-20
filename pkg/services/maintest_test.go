// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// TestMain points the wave data dir at a throwaway temp dir and runs what wavesrv runs first (cmd/server/main-server.go),
// so the real-wiring test runs against a real store with a window to put a tab in.
//
// With ARC_TEST_SERVE=1 the binary is not a test: it serves HTTP on 127.0.0.1:$PORT and never returns, the way a dev
// server does under npm (TestRealServiceStopsWithItsChild).
func TestMain(m *testing.M) {
	if os.Getenv("ARC_TEST_SERVE") == "1" {
		err := http.ListenAndServe("127.0.0.1:"+os.Getenv("PORT"), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("ok"))
		}))
		panic(err)
	}
	// the agent running this test carries its own block's env, which a service's process must not inherit
	for _, kv := range os.Environ() {
		if k, _, _ := strings.Cut(kv, "="); strings.HasPrefix(k, "WAVETERM") {
			os.Unsetenv(k)
		}
	}
	dir, err := os.MkdirTemp("", "services-test-*")
	if err != nil {
		panic(err)
	}
	wavebase.DataHome_VarCache = dir
	wavebase.ConfigHome_VarCache = dir
	if err := wavebase.EnsureWaveDBDir(); err != nil {
		panic(err)
	}
	if err := wavebase.EnsureWaveConfigDir(); err != nil {
		panic(err)
	}
	if err := filestore.InitFilestore(); err != nil {
		panic(err)
	}
	if err := wstore.InitWStore(); err != nil {
		panic(err)
	}
	if err := shellutil.InitCustomShellStartupFiles(); err != nil {
		panic(err)
	}
	if _, err := wcore.EnsureInitialData(); err != nil {
		panic(err)
	}
	if err := wcore.InitMainServer(); err != nil { // the jwt keys a controller signs its wsh token with
		panic(err)
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// TestMain points the wave data dir at a throwaway temp dir and initializes the wstore SQLite DB so
// the ScheduleOnce tests have a real store. Mirrors pkg/jarvis's TestMain; the pure-function tests in
// this package are unaffected by the extra init.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "orchestrate-test-*")
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
	// fixtures store worker tabs no controller runs; only the tests that script a dead one should see it stall
	workerControllerGone = func(context.Context, *waveobj.Run) bool { return false }
	// fixtures spawn workers through a stub that makes no tab, so there is nothing to start
	startWorker = func(context.Context, string) error { return nil }
	// a landed dag's verifier would need a workspace to spawn in; only the verifier's own tests start one
	startVerifier = skipVerifier
	// a fixture's worker has no transcript, and the lookup then globs every dir under the root: against the
	// real ~/.claude/projects that was 1.4M file checks a run, all logged as test inputs for go to re-check
	sessionsRootFor = func(string) string { return filepath.Join(dir, "sessions") }
	defer effortstore.UseRootForTest(filepath.Join(dir, "vault"))()
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

// skipVerifier ends the final stage as though the verifier passed the moment it started. Alongside the
// commands, the pass waits for them, as a real verifier's would.
func skipVerifier(_, _ context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, afterCommit *[]func()) {
	if g.Final.State == FinalState_Checking {
		holdFinalVerdict(g.OID, finalVerdict{round: g.Final.Round, verdict: ReviewVerdict_Pass, text: "skipped"})
		return
	}
	finishFinal(context.Background(), g, true, afterCommit)
	releaseFinalTree(g, owner, afterCommit)
}

// stageLeakTimeout bounds how long a test's cleanup waits for the background stages it started.
const stageLeakTimeout = 10 * time.Second

// waitStages waits until no background stage is running, and fails the test, naming them, if some still are
// after stageLeakTimeout: a stage that outlives its test lands in the next test's fakes.
func waitStages(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(stageLeakTimeout)
	for len(runningStages()) > 0 {
		if time.Now().After(deadline) {
			t.Errorf("background stages outlived the test: %s", strings.Join(runningStages(), ", "))
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// restoreAfterStages restores a swapped hook once the test's background stages have finished with it.
func restoreAfterStages(t *testing.T, restore func()) {
	t.Helper()
	t.Cleanup(func() {
		waitStages(t)
		restore()
	})
}

// runningStages names the stages still running, sorted.
func runningStages() []string {
	stages.Lock()
	defer stages.Unlock()
	names := make([]string, 0, len(stages.running))
	for name := range stages.running {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

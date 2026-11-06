// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"errors"
	"os"
	"regexp"
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestStartConfigWatcherReturnsInitializationError(t *testing.T) {
	sentinel := errors.New("watcher unavailable")
	original := initConfigWatcher
	initConfigWatcher = func() (*wconfig.Watcher, error) {
		return nil, sentinel
	}
	t.Cleanup(func() { initConfigWatcher = original })

	err := startConfigWatcher()
	if !errors.Is(err, sentinel) {
		t.Fatalf("error = %v, want sentinel", err)
	}
}

// the boot calls that write outside a copied store, start a process or talk to a remote. Spelled out here rather than
// read from snapshotBootSkips, so dropping a name from the list fails the test instead of passing it.
var snapshotMustSkip = []string{
	"retryCleanupDebtAtStartup",
	"runTelebot",
	"wavevault.StartSyncLoop",
	"harnessupdate.StartLoop",
	"reporadar.RecoverInterruptedScans",
	"sessiontrash.StartPurgeLoop",
	"wshserver.StartStorage",
	"wshserver.SweepCanvasFeedback", // deletes inside the registered projects' real checkouts
	"orchestrate.SweepWorktreeRoot",
	"orchestrate.MarkInterruptedRuns", // resumes a worker for each interrupted run it finds
	"orchestrate.ResumeInterruptedLeads",
	"runpause.ResumeAtBoot",
	"wshserver.ResumeBrainstormSessions",
	"orchestrate.StartWatchdog",
	"runregulator.Start",
	"services.Init",
	"wshserver.StartAgentSleepLoop",
	"jarvisvolunteer.StartLooseEndSweep",
	"memhygiene.StartSweep",
	"wshserver.StartCouncilRunner",
	"wshserver.StartRunQueue",
}

func withSnapshot(t *testing.T, on bool) {
	t.Helper()
	old := wavebase.Snapshot_VarCache
	wavebase.Snapshot_VarCache = on
	t.Cleanup(func() { wavebase.Snapshot_VarCache = old })
}

func TestSnapshotSkipsEachListedBootCallOnlyUnderSnapshot(t *testing.T) {
	withSnapshot(t, true)
	for _, name := range snapshotMustSkip {
		if !snapshotSkips(name) {
			t.Errorf("snapshot store: snapshotSkips(%q) = false, want the call skipped", name)
		}
	}
	// a boot call that is not listed runs in a snapshot too: the store, filestore and listeners it needs
	for _, name := range []string{"wshserver.StartKeepAwake", "projectactivity.StartLoop", "blockcontroller.RestoreLiveAgents", ""} {
		if snapshotSkips(name) {
			t.Errorf("snapshot store: snapshotSkips(%q) = true, want an unlisted call to run", name)
		}
	}

	withSnapshot(t, false)
	for _, name := range snapshotMustSkip {
		if snapshotSkips(name) {
			t.Errorf("not a snapshot: snapshotSkips(%q) = true, want every call to run", name)
		}
	}
}

// a call site that asks for a name the list lacks, or spells it differently, would silently never skip.
func TestSnapshotSkipNamesMatchTheirCallSites(t *testing.T) {
	src, err := os.ReadFile("main-server.go")
	if err != nil {
		t.Fatal(err)
	}
	var asked []string
	for _, m := range regexp.MustCompile(`snapshotSkips\("([^"]*)"\)`).FindAllStringSubmatch(string(src), -1) {
		asked = append(asked, m[1])
	}
	for _, name := range snapshotMustSkip {
		if n := countOf(asked, name); n != 1 {
			t.Errorf("%q is asked at %d call sites in main-server.go, want exactly 1", name, n)
		}
	}
	for _, name := range asked {
		if !slices.Contains(snapshotBootSkips, name) {
			t.Errorf("a call site asks snapshotSkips(%q), which snapshotBootSkips does not list", name)
		}
	}
	for _, name := range snapshotBootSkips {
		if !slices.Contains(asked, name) {
			t.Errorf("snapshotBootSkips lists %q, which no call site asks for", name)
		}
	}
}

func countOf(list []string, name string) int {
	n := 0
	for _, s := range list {
		if s == name {
			n++
		}
	}
	return n
}

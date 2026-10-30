// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package stablewsh

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func writeTestFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("creating %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("writing %s: %v", path, err)
	}
}

func TestSync_copiesThenLeavesAnIdenticalCopyAlone(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "wsh-0.14.11-windows.x64.exe")
	writeTestFile(t, src, "build 11")
	dst := Path(filepath.Join(dir, "home"))

	if err := Sync(src, dst); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 11" {
		t.Fatalf("stable copy = %q (err %v), want the source bytes", got, err)
	}
	info1, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("stat after first sync: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if err := Sync(src, dst); err != nil {
		t.Fatalf("second sync: %v", err)
	}
	info2, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("stat after second sync: %v", err)
	}
	if !info2.ModTime().Equal(info1.ModTime()) {
		t.Fatalf("identical copy was rewritten: mtime %v -> %v", info1.ModTime(), info2.ModTime())
	}
}

// macOS can flag one file's code signature as invalid and SIGKILL every exec of it while its bytes and signature stay
// valid (2026-10-30: every hook exited 137 until the copy was replaced); only a new file clears it
func TestSync_replacesAnIdenticalCopyThatCannotRun(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "wsh-0.15.19-darwin.arm64")
	writeTestFile(t, src, "build 19")
	dst := Path(filepath.Join(dir, "home"))
	writeTestFile(t, dst, "build 19")
	before, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("stat before sync: %v", err)
	}
	prev := Runs
	Runs = func(string) bool { return false }
	t.Cleanup(func() { Runs = prev })

	if err := Sync(src, dst); err != nil {
		t.Fatalf("sync: %v", err)
	}
	after, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("stat after sync: %v", err)
	}
	if os.SameFile(before, after) {
		t.Fatalf("an identical copy that cannot run was kept; want a new file in its place")
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 19" {
		t.Fatalf("stable copy = %q (err %v), want the source bytes", got, err)
	}
}

// a script that SIGKILLs itself stands in for the copy macOS kills on exec; any other failure still counts as running
func TestRuns_falseOnlyForACopyThatIsKilled(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("only macOS kills a copy whose signature it flagged")
	}
	dir := t.TempDir()
	killed := filepath.Join(dir, "killed")
	writeTestFile(t, killed, "#!/bin/sh\nkill -9 $$\n")
	failing := filepath.Join(dir, "failing")
	writeTestFile(t, failing, "#!/bin/sh\nexit 3\n")

	if Runs(killed) {
		t.Fatalf("a copy killed on exec was reported as running")
	}
	if !Runs(failing) {
		t.Fatalf("a copy that exits nonzero was reported as not running; only a kill should replace it")
	}
}

// the failure this exists for: a rebuild deletes the versioned binary the hooks named
func TestSync_survivesARebuildDeletingTheOldBinary(t *testing.T) {
	dir := t.TempDir()
	dst := Path(filepath.Join(dir, "home"))
	oldBuild := filepath.Join(dir, "wsh-0.14.10-windows.x64.exe")
	newBuild := filepath.Join(dir, "wsh-0.14.11-windows.x64.exe")
	writeTestFile(t, oldBuild, "build 10")

	if err := Sync(oldBuild, dst); err != nil {
		t.Fatalf("sync from old build: %v", err)
	}
	if err := os.Remove(oldBuild); err != nil {
		t.Fatalf("simulating the rebuild: %v", err)
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 10" {
		t.Fatalf("stable copy gone after the old build was deleted: %q (err %v)", got, err)
	}

	writeTestFile(t, newBuild, "build 11")
	if err := Sync(newBuild, dst); err != nil {
		t.Fatalf("sync from new build: %v", err)
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 11" {
		t.Fatalf("stable copy = %q (err %v), want the new build", got, err)
	}
	for _, leftover := range []string{dst + ".tmp", dst + ".old"} {
		if _, err := os.Stat(leftover); !os.IsNotExist(err) {
			t.Fatalf("swap left %s behind", leftover)
		}
	}
}

// a long-lived process (wsh agentctl) still runs the copy an earlier swap moved aside, so .old cannot go; a
// non-empty directory stands in for it, since neither a remove nor a rename onto it succeeds on any OS
func TestSync_swapsWhileAnEarlierCopyIsStillRunning(t *testing.T) {
	dir := t.TempDir()
	dst := Path(filepath.Join(dir, "home"))
	writeTestFile(t, dst, "build 10")
	writeTestFile(t, filepath.Join(dst+".old", "held"), "build 9")
	src := filepath.Join(dir, "wsh-0.14.11-windows.x64.exe")
	writeTestFile(t, src, "build 11")

	if err := Sync(src, dst); err != nil {
		t.Fatalf("sync with a held .old: %v", err)
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 11" {
		t.Fatalf("stable copy = %q (err %v), want the new build", got, err)
	}
}

func TestSync_removesCopiesMovedAsideEarlier(t *testing.T) {
	dir := t.TempDir()
	dst := Path(filepath.Join(dir, "home"))
	writeTestFile(t, dst, "build 10")
	writeTestFile(t, dst+".old.1", "build 9, no longer running")
	src := filepath.Join(dir, "wsh-0.14.11-windows.x64.exe")
	writeTestFile(t, src, "build 11")

	if err := Sync(src, dst); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if _, err := os.Stat(dst + ".old.1"); !os.IsNotExist(err) {
		t.Fatalf("an earlier swap's copy that no process holds was left behind")
	}
}

func stubRuns(t *testing.T, runs bool) {
	t.Helper()
	prev := Runs
	Runs = func(string) bool { return runs }
	t.Cleanup(func() { Runs = prev })
}

// 2026-10-31: a copy written at 01:52 was killed on exec by 01:55, mid-session, and hooks failed until a relaunch
func TestHeal_replacesACopyThatNoLongerRuns(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "wsh-0.15.19-darwin.arm64")
	writeTestFile(t, src, "build 19")
	dst := Path(filepath.Join(dir, "home"))
	writeTestFile(t, dst, "build 19")
	before, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("stat before heal: %v", err)
	}
	stubRuns(t, false)

	healed, err := Heal(src, dst)
	if err != nil || !healed {
		t.Fatalf("Heal = %v, %v; want a replaced copy", healed, err)
	}
	after, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("stat after heal: %v", err)
	}
	if os.SameFile(before, after) {
		t.Fatalf("the killed copy was kept; want a new file in its place")
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 19" {
		t.Fatalf("stable copy = %q (err %v), want the source bytes", got, err)
	}
}

// the watch only mends a copy that no longer runs: an older or newer build install-agent-hooks wrote stays until the
// next launch syncs it
func TestHeal_leavesACopyThatRunsAlone(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "wsh-0.15.19-darwin.arm64")
	writeTestFile(t, src, "build 19")
	dst := Path(filepath.Join(dir, "home"))
	writeTestFile(t, dst, "build 18")
	stubRuns(t, true)

	if healed, err := Heal(src, dst); err != nil || healed {
		t.Fatalf("Heal = %v, %v; want the running copy left alone", healed, err)
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 18" {
		t.Fatalf("stable copy = %q (err %v), want it untouched", got, err)
	}
}

func TestHeal_leavesAMissingCopyAlone(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "wsh-0.15.19-darwin.arm64")
	writeTestFile(t, src, "build 19")
	dst := Path(filepath.Join(dir, "home"))
	stubRuns(t, false)

	if healed, err := Heal(src, dst); err != nil || healed {
		t.Fatalf("Heal = %v, %v; want nothing written", healed, err)
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("Heal wrote a copy the person had deleted")
	}
}

// a killed copy with no source to copy from (an app bundle being replaced) is reported and kept, never removed
func TestHeal_keepsTheCopyWhenTheSourceIsGone(t *testing.T) {
	dir := t.TempDir()
	dst := Path(filepath.Join(dir, "home"))
	writeTestFile(t, dst, "build 19")
	stubRuns(t, false)

	if healed, err := Heal(filepath.Join(dir, "gone"), dst); err == nil || healed {
		t.Fatalf("Heal = %v, %v; want an error and no replacement", healed, err)
	}
	if got, err := os.ReadFile(dst); err != nil || string(got) != "build 19" {
		t.Fatalf("stable copy = %q (err %v), want it kept", got, err)
	}
}

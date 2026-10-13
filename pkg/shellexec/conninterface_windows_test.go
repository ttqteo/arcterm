//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"os"
	"os/exec"
	"slices"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

const helperEnv = "SHELLEXEC_TEST_HELPER"

// TestHelperProcess is not a test: it is the long-lived child the other tests start.
func TestHelperProcess(t *testing.T) {
	if os.Getenv(helperEnv) != "sleep" {
		return
	}
	time.Sleep(60 * time.Second)
	os.Exit(0)
}

func startSleeper(t *testing.T) *exec.Cmd {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestHelperProcess$")
	cmd.Env = append(os.Environ(), helperEnv+"=sleep")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	return cmd
}

func jobWithRoot(pid int) (jobobject.LiveJob, bool) {
	for _, j := range jobobject.LiveJobs() {
		if j.RootPid == pid {
			return j, true
		}
	}
	return jobobject.LiveJob{}, false
}

func TestMakeCmdWrapRegistersBlockOwner(t *testing.T) {
	cmd := startSleeper(t)
	cw := MakeCmdWrap(cmd, nil, false, "block-1")
	pid := cmd.Process.Pid
	j, ok := jobWithRoot(pid)
	want := jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: "block-1"}
	if !ok || j.Owner != want || !slices.Contains(j.Members, pid) {
		t.Fatalf("live job for pid %d = %+v (found %v), want owner %+v with the pid a member", pid, j, ok, want)
	}
	cw.Kill()
	cw.Wait()
	if _, ok := jobWithRoot(pid); ok {
		t.Fatalf("job for pid %d is still registered after Kill and Wait", pid)
	}

	cmd = startSleeper(t)
	cw = MakeCmdWrap(cmd, nil, false, "")
	defer func() {
		cw.Kill()
		cw.Wait()
	}()
	if j, ok := jobWithRoot(cmd.Process.Pid); ok {
		t.Fatalf("a wrap with no block id registered a job: %+v", j)
	}
}

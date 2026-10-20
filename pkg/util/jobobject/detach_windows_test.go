//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"testing"
)

// skipIfBreakawayDenied skips when this test process already sits in a job that forbids breakaway, such as a
// terminal in an arcterm from before BREAKAWAY_OK: no job of ours can grant what an outer one denies.
func skipIfBreakawayDenied(t *testing.T) {
	t.Helper()
	probe, err := helperCmd("sleep")
	if err != nil {
		t.Fatal(err)
	}
	if err := StartDetached(probe); errors.Is(err, ErrBreakawayDenied) {
		t.Skip("this test process is in a job that denies breakaway")
	} else if err != nil {
		t.Fatalf("StartDetached: %v", err)
	}
	probe.Process.Kill()
	probe.Wait()
}

func TestStartDetachedOutlivesTheJob(t *testing.T) {
	skipIfBreakawayDenied(t)
	mid, err := helperCmd("detach")
	if err != nil {
		t.Fatal(err)
	}
	stdin, err := mid.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := mid.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := mid.Start(); err != nil {
		t.Fatalf("starting middle process: %v", err)
	}
	defer func() {
		mid.Process.Kill()
		mid.Wait()
	}()
	// two nested jobs, as in arcterm: the host's around wavesrv, the block's around its shell
	hostJob, err := Attach(mid.Process)
	if err != nil {
		t.Fatalf("Attach host job: %v", err)
	}
	blockJob, err := Attach(mid.Process)
	if err != nil {
		t.Fatalf("Attach block job: %v", err)
	}
	if _, err := stdin.Write([]byte("\n")); err != nil {
		t.Fatal(err)
	}
	sc := bufio.NewScanner(stdout)
	if !sc.Scan() {
		t.Fatalf("middle process printed no pids: %v", sc.Err())
	}
	var plain, detached int
	if _, err := fmt.Sscan(sc.Text(), &plain, &detached); err != nil {
		t.Fatalf("parsing pids %q: %v", sc.Text(), err)
	}
	defer func() {
		if p, err := os.FindProcess(detached); err == nil {
			p.Kill()
		}
	}()

	Close(blockJob)
	Close(hostJob)
	waitForExit(t, mid.Process.Pid)
	waitForExit(t, plain)
	if !isRunning(detached) {
		t.Fatalf("detached pid %d died with the job", detached)
	}
}

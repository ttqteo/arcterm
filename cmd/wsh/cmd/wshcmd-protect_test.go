// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// syncBuf is a writer two goroutines can share
type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuf) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func protectStream(updates ...wshrpc.JobSlotUpdate) chan jobslotMsg {
	ch := make(chan jobslotMsg, len(updates))
	for _, u := range updates {
		ch <- jobslotMsg{Response: u}
	}
	return ch
}

// the agent hook reads a line that starts with wsh protect as taking no slot of its own, on the wsh side as on wavesrv's
func TestJobslotExemptsWshProtect(t *testing.T) {
	for _, command := range []string{"wsh protect -- npm test", "wsh protect -- python scripts/audit_guard.py", "wsh protect -- task check:ts"} {
		if jobslotTakesSlot(command) {
			t.Errorf("jobslotTakesSlot(%q) = true; wsh protect holds its own slot", command)
		}
	}
	if !jobslotTakesSlot("npm test") {
		t.Error("npm test takes a slot")
	}
}

func TestProtectAwait(t *testing.T) {
	yes, no := true, false
	var w bytes.Buffer
	verdict, job, _ := protectAwait(protectStream(
		wshrpc.JobSlotUpdate{Queued: 1, Behind: "task check:ts", For: "run 700db4"},
		wshrpc.JobSlotUpdate{Run: &yes, Job: "j7"},
	), &w)
	if verdict != protectStarted || job != "j7" {
		t.Fatalf("verdict %v job %q, want started j7", verdict, job)
	}
	if !strings.Contains(w.String(), "protect waits #1 behind task check:ts (run 700db4)") {
		t.Fatalf("stderr = %q", w.String())
	}
	if verdict, _, reason := protectAwait(protectStream(wshrpc.JobSlotUpdate{Run: &no, Reason: "Not run: skipped"}), &w); verdict != protectRefused || reason != "Not run: skipped" {
		t.Fatalf("verdict %v reason %q, want refused", verdict, reason)
	}
	closed := protectStream(wshrpc.JobSlotUpdate{Queued: 2})
	close(closed)
	if verdict, _, _ := protectAwait(closed, &w); verdict != protectBroken {
		t.Fatalf("a stream that ends with no verdict is broken, got %v", verdict)
	}
	failed := make(chan jobslotMsg, 1)
	failed <- jobslotMsg{Error: errors.New("rpc connection closed")}
	if verdict, _, _ := protectAwait(failed, &w); verdict != protectBroken {
		t.Fatalf("a failed stream is broken, got %v", verdict)
	}
}

// a dropped link warns, then asks again (with the child's pid) until wavesrv answers
func TestProtectKeepReconnectsAfterTheLinkDrops(t *testing.T) {
	saved := protectRetry
	protectRetry = 5 * time.Millisecond
	t.Cleanup(func() { protectRetry = saved })
	yes := true
	first := make(chan jobslotMsg, 1)
	first <- jobslotMsg{Error: errors.New("rpc connection closed")}
	var mu sync.Mutex
	opens := 0
	again := make(chan jobslotMsg, 1)
	again <- jobslotMsg{Response: wshrpc.JobSlotUpdate{Run: &yes}}
	open := func() chan jobslotMsg {
		mu.Lock()
		defer mu.Unlock()
		opens++
		if opens == 1 {
			return nil // arcterm still restarting
		}
		return again
	}
	done := make(chan struct{})
	var w syncBuf
	finished := make(chan struct{})
	go func() { protectKeep(first, open, done, &w); close(finished) }()
	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(w.String(), "Protect is back on") {
		if time.Now().After(deadline) {
			t.Fatalf("never reconnected; stderr = %q", w.String())
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !strings.Contains(w.String(), "lost arcterm's job queue") {
		t.Fatalf("no warning when the link dropped; stderr = %q", w.String())
	}
	close(done)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("protectKeep outlived the child")
	}
}

func TestProtectExitCode(t *testing.T) {
	if protectExitCode(nil) != 0 {
		t.Fatal("a clean exit is 0")
	}
	// this test binary, given a flag it does not know, exits 2
	err := exec.Command(os.Args[0], "-no-such-flag").Run()
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("the child did not exit non-zero: %v", err)
	}
	if got := protectExitCode(err); got != exitErr.ExitCode() || got == 0 {
		t.Fatalf("exit code %d, want the child's %d", got, exitErr.ExitCode())
	}
	if protectExitCode(errors.New("wait failed")) != 1 {
		t.Fatal("an error with no exit code is 1")
	}
}

//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"os/exec"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

// A service block's tree on Windows is its job's members: what procs reads, with the time each process started, is
// what Busy weighs against the time the page first answered.
func TestRealProcsReadsTheBlocksJob(t *testing.T) {
	const blockId = "blk-procs-test"
	before := time.Now().UnixMilli()
	cmd := exec.Command("ping", "-n", "30", "127.0.0.1")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	job, err := jobobject.Attach(cmd.Process)
	if err != nil {
		t.Fatalf("Attach: %v", err)
	}
	t.Cleanup(func() {
		jobobject.KillTree(job)
		jobobject.Close(job)
	})
	jobobject.Register(job, cmd.Process.Pid, jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: blockId})

	got := procs(blockId)
	var child *Proc
	for i := range got {
		if int(got[i].Pid) == cmd.Process.Pid {
			child = &got[i]
		}
	}
	if child == nil {
		t.Fatalf("procs(%s) = %v, missing the child %d", blockId, got, cmd.Process.Pid)
	}
	now := time.Now().UnixMilli()
	if child.StartMs < before-1000 || child.StartMs > now+1000 {
		t.Errorf("the child's StartMs = %d, want between %d and %d: it started in this test", child.StartMs, before, now)
	}
	if !Busy(got, before-1000, now) {
		t.Error("a process that started after the page first answered is not read as work in progress")
	}
	if Busy(got, now+int64(time.Minute/time.Millisecond), now) {
		t.Error("a process that started before the page first answered is read as work in progress")
	}
	if other := procs("blk-procs-test-other"); len(other) != 0 {
		t.Errorf("procs of a block with no job and no controller = %v, want none", other)
	}
}

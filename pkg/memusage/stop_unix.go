// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package memusage

import (
	"fmt"
	"syscall"
	"time"
)

// StopTree ends pid and its descendants: SIGTERM to each, children before their parents so a parent cannot start
// them again, then SIGKILL to whatever is still alive after grace.
func StopTree(t Table, pid int32, grace time.Duration, signal func(pid int32, sig syscall.Signal) error, alive func(pid int32) bool) error {
	if !t.Has(pid) {
		return fmt.Errorf("process %d has already exited", pid)
	}
	tree := t.Tree(pid) // breadth first, so walking it backwards ends a child before its parent
	for i := len(tree) - 1; i >= 0; i-- {
		_ = signal(tree[i], syscall.SIGTERM)
	}
	deadline := time.Now().Add(grace)
	for time.Now().Before(deadline) {
		if !anyAlive(tree, alive) {
			return nil
		}
		time.Sleep(25 * time.Millisecond)
	}
	for i := len(tree) - 1; i >= 0; i-- {
		if alive(tree[i]) {
			_ = signal(tree[i], syscall.SIGKILL)
		}
	}
	return nil
}

func anyAlive(pids []int32, alive func(int32) bool) bool {
	for _, p := range pids {
		if alive(p) {
			return true
		}
	}
	return false
}

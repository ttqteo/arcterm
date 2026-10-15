// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package memusage

import (
	"os/exec"
	"syscall"
	"testing"
	"time"
)

func TestStopTreeTermsThenKillsSurvivors(t *testing.T) {
	tb := heaviestTable()
	alive := map[int32]bool{11: true, 13: true}
	var sent []string
	signal := func(p int32, s syscall.Signal) error {
		sent = append(sent, map[syscall.Signal]string{syscall.SIGTERM: "TERM", syscall.SIGKILL: "KILL"}[s]+":"+string(rune('0'+p%10)))
		if s == syscall.SIGTERM && p == 13 {
			alive[13] = false // 13 exits on TERM; 11 ignores it
		}
		if s == syscall.SIGKILL {
			alive[p] = false
		}
		return nil
	}
	err := StopTree(tb, 11, 150*time.Millisecond, signal, func(p int32) bool { return alive[p] })
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"TERM:3", "TERM:1", "KILL:1"}
	if len(sent) != len(want) {
		t.Fatalf("sent %v, want %v (children first, then KILL only to the survivor)", sent, want)
	}
	for i := range want {
		if sent[i] != want[i] {
			t.Fatalf("sent %v, want %v", sent, want)
		}
	}
}

func TestStopTreeOnAGonePid(t *testing.T) {
	if err := StopTree(heaviestTable(), 99, time.Millisecond, func(int32, syscall.Signal) error { return nil }, func(int32) bool { return false }); err == nil {
		t.Fatal("a pid no longer in the table is an error")
	}
}

// real processes and real signals: a shell with two sleeping children, ended through StopTree
func TestStopTreeEndsRealProcesses(t *testing.T) {
	if testing.Short() {
		t.Skip("starts real processes")
	}
	cmd := exec.Command("sh", "-c", "sleep 600 & sleep 600 & wait")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	// reap the shell, so an exited sh is not a zombie that kill(pid, 0) still reports alive
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	shPid := int32(cmd.Process.Pid)

	var table Table
	var kids []int32
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		tb, err := ReadTable()
		if err == nil {
			if tree := tb.Tree(shPid); len(tree) == 3 {
				table, kids = tb, tree[1:]
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(kids) != 2 {
		_ = syscall.Kill(int(shPid), syscall.SIGKILL)
		t.Fatalf("sh %d never showed two children", shPid)
	}
	alive := func(p int32) bool { return syscall.Kill(int(p), 0) == nil }
	err := StopTree(table, shPid, 500*time.Millisecond,
		func(p int32, s syscall.Signal) error { return syscall.Kill(int(p), s) }, alive)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the shell did not exit")
	}
	gone := time.Now().Add(2 * time.Second)
	for _, k := range kids {
		for alive(k) && time.Now().Before(gone) {
			time.Sleep(20 * time.Millisecond)
		}
		if alive(k) {
			t.Errorf("child %d is still running", k)
		}
	}
}

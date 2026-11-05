// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// A live process whose cwd is the tree is what kept runs d39cfe1a and 983dcb44's merged trees on disk: Windows
// refuses to delete a directory some process works in.
func TestRemoveHeldDirKillsAProcessWorkingInTheDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "tree")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("cmd", "/c", "ping -n 60 127.0.0.1 >nul")
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(exited) }()
	t.Cleanup(func() { _ = cmd.Process.Kill(); <-exited })

	// the plain delete fails while it runs, or this test proves nothing
	time.Sleep(300 * time.Millisecond)
	if err := os.Remove(dir); err == nil {
		t.Fatal("deleted a directory a live process works in; the test cannot show the kill")
	}
	if err := removeHeldDir(context.Background(), dir); err != nil {
		t.Fatalf("removeHeldDir: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("dir still there: %v", err)
	}
	select {
	case <-exited:
	case <-time.After(5 * time.Second):
		t.Fatal("the process holding the dir is still running")
	}
}

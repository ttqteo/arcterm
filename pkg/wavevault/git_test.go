// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// a timed-out git is killed, but a helper it started (ssh, git-remote-https; here a shell alias) can
// hold its output pipe open; the call must still return near the timeout, not when the helper exits
func TestGitTimeoutBoundsCallWhenChildHoldsPipe(t *testing.T) {
	old := gitWaitDelay
	gitWaitDelay = 200 * time.Millisecond
	t.Cleanup(func() { gitWaitDelay = old })
	dir := t.TempDir()
	start := time.Now()
	_, err := runGitSync(context.Background(), dir, 500*time.Millisecond, true, "-c", "alias.slow=!sleep 10", "slow")
	if err == nil {
		t.Fatal("the timed-out command succeeded")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("returned after %v: the helper's pipe, not the timeout, bounded the call", elapsed)
	}
}

// a local git killed at its timeout skips its own cleanup and leaves index.lock behind; every later
// add or commit would then fail until someone deleted it by hand
func TestKilledGitLeavesNoIndexLock(t *testing.T) {
	ctx := context.Background()
	v := newSyncVault(t, "")
	lock := filepath.Join(v.Root, ".git", "index.lock")
	// stands in for an add -A that took the index lock and was still running at the deadline
	short, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	if _, err := runGitErr(short, v.Root, "-c", "alias.slow=!touch .git/index.lock && sleep 3", "slow"); err == nil {
		t.Fatal("the timed-out command succeeded")
	}
	if _, err := os.Stat(lock); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("index.lock left behind: stat err = %v", err)
	}
	writeVaultFile(t, v, "memory/n.md", []byte("n\n"))
	mustCommit(t, v)
}

// a lock that predates the killed command belongs to someone else (another git in the vault) and stays
func TestKilledGitKeepsAnOlderIndexLock(t *testing.T) {
	v := newSyncVault(t, "")
	lock := filepath.Join(v.Root, ".git", "index.lock")
	if err := os.WriteFile(lock, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Minute)
	if err := os.Chtimes(lock, old, old); err != nil {
		t.Fatal(err)
	}
	short, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if _, err := runGitErr(short, v.Root, "-c", "alias.slow=!sleep 3", "slow"); err == nil {
		t.Fatal("the timed-out command succeeded")
	}
	if _, err := os.Stat(lock); err != nil {
		t.Fatalf("another process's index.lock was removed: %v", err)
	}
}

// a fetch or push never takes index.lock and runs outside the vault lock, so a lock made while it
// ran is another git's (a commit beside it) and stays when the fetch is killed
func TestKilledFetchKeepsALockMadeWhileItRan(t *testing.T) {
	v := newSyncVault(t, "")
	lock := filepath.Join(v.Root, ".git", "index.lock")
	short, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	go func() {
		time.Sleep(100 * time.Millisecond)
		os.WriteFile(lock, nil, 0o644)
	}()
	if _, err := v.syncGitNet(short, "-c", "alias.slow=!sleep 3", "slow"); err == nil {
		t.Fatal("the timed-out command succeeded")
	}
	if _, err := os.Stat(lock); err != nil {
		t.Fatalf("another git's index.lock was removed: %v", err)
	}
}

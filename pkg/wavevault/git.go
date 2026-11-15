// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	gitTimeout = 10 * time.Second
	// syncGitTimeout bounds the network commands (fetch, push); local ones keep gitTimeout.
	syncGitTimeout = 2 * time.Minute
)

// gitWaitDelay bounds the wait for a git command's pipes once git has exited or been killed. A var for
// tests.
var gitWaitDelay = 5 * time.Second

// lockMtimeSlack absorbs a coarse filesystem timestamp when telling whether index.lock was made after a
// command started.
const lockMtimeSlack = 2 * time.Second

// syncGitEnv keeps a background sync from ever opening a credential prompt or dialog.
var syncGitEnv = []string{"GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never"}

// gitCommand builds `git -C dir args...`. WaitDelay: a timeout kills git only, and a helper it started
// (ssh, git-remote-https) can hold the output pipe open long past it, so without it the pipe, not the
// timeout, bounds the call, with the vault lock held.
func gitCommand(ctx context.Context, dir string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.WaitDelay = gitWaitDelay
	return cmd
}

// gitRunErr drops exec.ErrWaitDelay: git exited 0 and its output was read; only an abandoned pipe was cut.
func gitRunErr(err error) error {
	if errors.Is(err, exec.ErrWaitDelay) {
		return nil
	}
	return err
}

// removeLockLeftByKill removes the index.lock a git killed by ctx left behind: a killed git skips its
// lockfile cleanup, and every later add, commit or merge in the vault would fail on the lock. Only a lock
// made since start is the killed command's; an older one belongs to another git working in the vault.
func removeLockLeftByKill(ctx context.Context, dir string, start time.Time) {
	if ctx.Err() == nil {
		return
	}
	lock := filepath.Join(dir, ".git", "index.lock")
	info, err := os.Stat(lock)
	if err != nil || info.ModTime().Before(start.Add(-lockMtimeSlack)) {
		return
	}
	if err := os.Remove(lock); err != nil {
		log.Printf("wavevault: removing the index.lock a killed git left: %v", err)
	}
}

// runGitSync runs one sync git command. Stdout comes back untrimmed (a conflict stage must be
// written byte-exact), and an error names the command and its stderr. indexLock is a command that can take
// index.lock: only its kill can have left one, so a fetch or push, which never takes it and runs outside the
// vault lock, leaves any it finds to the git that made it.
func runGitSync(ctx context.Context, dir string, timeout time.Duration, indexLock bool, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := gitCommand(ctx, dir, args...)
	cmd.Env = append(os.Environ(), syncGitEnv...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	start := time.Now()
	out, err := cmd.Output()
	if indexLock {
		removeLockLeftByKill(ctx, dir, start)
	}
	if err := gitRunErr(err); err != nil {
		return out, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return out, nil
}

// runGit runs `git -C dir args...` and returns stdout. Mirrors pkg/gitinfo's read path.
func runGit(ctx context.Context, dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	start := time.Now()
	out, err := gitCommand(ctx, dir, args...).Output()
	removeLockLeftByKill(ctx, dir, start)
	return strings.TrimSpace(string(out)), gitRunErr(err)
}

// HeadAuthorForTest returns the author name of HEAD. A thin exported wrapper for sibling-package
// tests (jarvisdossier) that assert ownership-staged authorship.
func HeadAuthorForTest(ctx context.Context, root string) (string, error) {
	out, err := runGit(ctx, root, "log", "-1", "--format=%an")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// runGitErr is runGit for write operations: it captures stderr into the error so a failure's cause
// is visible.
func runGitErr(ctx context.Context, dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	start := time.Now()
	out, err := gitCommand(ctx, dir, args...).CombinedOutput()
	removeLockLeftByKill(ctx, dir, start)
	if err := gitRunErr(err); err != nil {
		return string(out), fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package orchestrate

import (
	"context"
	"errors"
	"log"
	"os/exec"
	"sync/atomic"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

// shellCommand runs a plan command through Git Bash, so a plan's POSIX Verify and Setup lines mean here what
// they mean under sh elsewhere: cmd.exe rejects the inline VAR=value prefix and $(...) that leads write.
// Bash keeps its stock path conversion, the one the agents' own Git Bash has: shell shims on PATH (corepack's
// pnpm, every npm global bin) hand node a /c/... path built from $0 and fail without it. A command that needs a
// /-leading argument kept raw prefixes MSYS_NO_PATHCONV=1 itself.
func shellCommand(ctx context.Context, command string) (*exec.Cmd, error) {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	bash := shellutil.FindGitBash(&fullConfig, false)
	if bash == "" {
		return nil, errors.New("plan commands run in Git Bash on Windows, and none was found: install Git for Windows or set term:gitbashpath")
	}
	return exec.CommandContext(ctx, bash, "-c", command), nil
}

// runShellCmd starts c in a job object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, so that when
// the command's context ends (timeout or cancel), killing the job takes the whole process
// tree with it — not just the Git Bash launcher exec.Cmd.Cancel would otherwise kill,
// leaving its children (e.g. a spawned `go test`) running orphaned.
//
// c.Cancel is set before Start so the context-watcher goroutine Start spawns never reads it
// concurrently with a write; the job handle it closes over is published through an atomic
// once Attach succeeds. The job is registered as owner's when owner is set.
func runShellCmd(c *exec.Cmd, owner jobobject.Owner) error {
	var job atomic.Uint64
	c.Cancel = func() error {
		if j := job.Load(); j != 0 {
			jobobject.KillTree(uintptr(j))
		} else if c.Process != nil {
			c.Process.Kill()
		}
		return nil
	}
	if err := c.Start(); err != nil {
		return err
	}
	if j, jerr := jobobject.AttachSealed(c.Process); jerr == nil {
		job.Store(uint64(j))
		if owner.Kind != "" {
			jobobject.Register(j, c.Process.Pid, owner)
		}
	}
	// a Setup, Verify or Final is a build or a test suite: it yields the CPU to what the person is doing
	if perr := jobobject.LowerPriority(uintptr(job.Load()), c.Process); perr != nil {
		log.Printf("lowering the priority of plan command pid %d: %v", c.Process.Pid, perr)
	}
	err := c.Wait()
	if j := job.Load(); j != 0 {
		jobobject.Close(uintptr(j))
	}
	return err
}

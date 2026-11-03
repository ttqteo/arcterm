// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package council

import (
	"os/exec"
	"sync/atomic"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

// runTree runs c inside a job object that kills on close, so that when its context ends the whole process tree goes
// with it: `go test` leaves its compiled test binary, and `npx` its node, running when only the launcher is killed.
// c.Cancel is set before Start, so the watcher goroutine Start spawns never reads it while it is written; the job
// handle it closes over is published through an atomic once the job exists.
func runTree(c *exec.Cmd) error {
	var job atomic.Uint64
	c.Cancel = func() error {
		if j := job.Load(); j != 0 {
			jobobject.KillTree(uintptr(j))
		} else if c.Process != nil {
			_ = c.Process.Kill()
		}
		return nil
	}
	if err := c.Start(); err != nil {
		return err
	}
	if j, err := jobobject.AttachSealed(c.Process); err == nil {
		job.Store(uint64(j))
	}
	err := c.Wait()
	if j := job.Load(); j != 0 {
		jobobject.Close(uintptr(j))
	}
	return err
}

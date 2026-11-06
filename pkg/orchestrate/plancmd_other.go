// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package orchestrate

import (
	"context"
	"log"
	"os/exec"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

func shellCommand(ctx context.Context, command string) (*exec.Cmd, error) {
	return exec.CommandContext(ctx, "sh", "-c", command), nil
}

// runShellCmd runs c, reniced so a Setup, Verify or Final yields the CPU to what the person is doing. Outside
// Windows, the process's own group/session handles its descendants on cancellation. There is no job to register,
// so owner goes unused.
func runShellCmd(c *exec.Cmd, owner jobobject.Owner) error {
	if err := c.Start(); err != nil {
		return err
	}
	if err := jobobject.LowerPriority(0, c.Process); err != nil {
		log.Printf("lowering the priority of plan command pid %d: %v", c.Process.Pid, err)
	}
	return c.Wait()
}

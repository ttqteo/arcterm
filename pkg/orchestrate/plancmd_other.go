// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package orchestrate

import (
	"context"
	"os/exec"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

func shellCommand(ctx context.Context, command string) (*exec.Cmd, error) {
	return exec.CommandContext(ctx, "sh", "-c", command), nil
}

// runShellCmd just runs c: outside Windows, the process's own group/session handles its
// descendants on cancellation. There is no job to register, so owner goes unused.
func runShellCmd(c *exec.Cmd, owner jobobject.Owner) error {
	return c.Run()
}

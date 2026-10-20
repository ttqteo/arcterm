//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"errors"
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// StartDetached starts cmd outside every job object the caller is in, so it outlives the block's job (closing the
// terminal) and the host's job (quitting arcterm). It has a hidden console of its own, which its console children
// share, and its own process group, so a Ctrl+C in the caller's console does not reach it.
func StartDetached(cmd *exec.Cmd) error {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_BREAKAWAY_FROM_JOB | windows.CREATE_NO_WINDOW | windows.CREATE_NEW_PROCESS_GROUP
	err := cmd.Start()
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) && inAnyJob() {
		return ErrBreakawayDenied
	}
	return err
}

func inAnyJob() bool {
	in, err := isProcessInJob(windows.CurrentProcess(), 0)
	return err == nil && in
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package harness

import (
	"os/exec"
	"syscall"
	"testing"

	"golang.org/x/sys/windows"
)

func TestHideWindowSetsNoWindowAndKeepsOtherFlags(t *testing.T) {
	cmd := exec.Command("agy", "--version")
	HideWindow(cmd)
	if cmd.SysProcAttr == nil || cmd.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 {
		t.Fatalf("SysProcAttr = %+v, want CREATE_NO_WINDOW in CreationFlags", cmd.SysProcAttr)
	}

	cmd = exec.Command("agy")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP}
	HideWindow(cmd)
	want := uint32(windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NO_WINDOW)
	if cmd.SysProcAttr.CreationFlags != want {
		t.Fatalf("CreationFlags = %#x, want %#x", cmd.SysProcAttr.CreationFlags, want)
	}
}

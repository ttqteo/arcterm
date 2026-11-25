// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package harness

import "os/exec"

// HideWindow is a no-op off Windows: a child there opens no console window.
func HideWindow(cmd *exec.Cmd) {}

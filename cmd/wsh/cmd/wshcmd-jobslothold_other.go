// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package cmd

// jobslotProcs is nil: a POSIX shell starts a program as its own child, so wsh's parent is the shell
func jobslotProcs() map[int32]jobslotProc {
	return nil
}

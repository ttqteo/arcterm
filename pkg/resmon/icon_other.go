//go:build !windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

// off Windows the others are not read, so no icon is asked for
func readIcon(pid int) string {
	return ""
}

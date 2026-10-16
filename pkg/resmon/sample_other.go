//go:build !windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

// attribution is Windows-only (job objects): the snapshot reports unsupported and the readout hides
const supported = false

func readTable() (map[int]proc, error) {
	return map[int]proc{}, nil
}

func readStat(pid int) procStat {
	return procStat{}
}

func readCmdline(pid int) string {
	return ""
}

func splitCmdline(cmdline string) []string {
	return nil
}

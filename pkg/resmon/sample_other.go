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

// readListenPorts maps each pid to the tcp ports it listens on. Off Windows nothing is sampled (no job
// groups either), so the rows carry no ports and the frontend draws no ports chip.
func readListenPorts() map[int][]int {
	return nil
}

func splitCmdline(cmdline string) []string {
	return nil
}

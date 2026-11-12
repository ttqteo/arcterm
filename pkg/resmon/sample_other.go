//go:build !windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import "github.com/shirou/gopsutil/v4/process"

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

// ReadArgv is pid's argv, as gopsutil reads it (the proc file on Linux, the kernel's process arguments on macOS,
// where claude code starts a Bash-tool command as `<shell> -c -l <script>`); nil when it cannot be read.
func ReadArgv(pid int) []string {
	p, err := process.NewProcess(int32(pid))
	if err != nil {
		return nil
	}
	argv, err := p.CmdlineSlice()
	if err != nil {
		return nil
	}
	return argv
}

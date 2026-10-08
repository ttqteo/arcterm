// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package memusage

import "github.com/shirou/gopsutil/v4/process"

// readParents is every running pid's parent.
func readParents() (map[int32]int32, error) {
	procs, err := process.Processes()
	if err != nil {
		return nil, err
	}
	parent := make(map[int32]int32, len(procs))
	for _, p := range procs {
		ppid, err := p.Ppid()
		if err != nil {
			continue // exited mid-read
		}
		parent[p.Pid] = ppid
	}
	return parent, nil
}

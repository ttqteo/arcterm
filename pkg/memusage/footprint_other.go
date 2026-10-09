// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows && (!darwin || !cgo)

package memusage

import "github.com/shirou/gopsutil/v4/process"

// footprint is the resident set: the footprint call is darwin's, and wsh builds
// without cgo.
func footprint(pid int32) (uint64, bool) {
	p, err := process.NewProcess(pid)
	if err != nil {
		return 0, false
	}
	m, err := p.MemoryInfo()
	if err != nil {
		return 0, false
	}
	return m.RSS, true
}

// responsiblePid has no equivalent here: the webview's processes are found as the host's children instead.
func responsiblePid(int32) (int32, bool) {
	return 0, false
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin

// The macOS sampler's reads. The interval is sampleInterval, 2 s (agentcpu.go): one tick lists the process table
// once (memusage.ReadTable) and reads the CPU time of each pid under an agent's root, no others. The sampler starts
// with the first Read and stops 10 s after the last (resmon's idleStop pattern), so nothing runs while the strain
// band is not asking. No cgo: gopsutil reads a process's times through libproc by dlopen, so the package builds with
// CGO_ENABLED=0 (`GOOS=darwin CGO_ENABLED=0 go vet ./pkg/agentcpu`).

package agentcpu

import (
	"runtime"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/memusage"
)

const supported = true

func platformSources() sources {
	return sources{cores: runtime.NumCPU(), table: memusage.ReadTable, times: readTimes, command: readCommand}
}

// readTimes is the CPU time of each pid it can read. The Process is built bare rather than through NewProcess, which
// would also check the pid exists and read its start time: the table was read a moment ago, and a pid that has gone
// reads as no time, which Compute treats as a counter that ran backwards (counted from 0).
func readTimes(pids []int32) Times {
	out := make(Times, len(pids))
	for _, pid := range pids {
		ts, err := (&process.Process{Pid: pid}).Times()
		if err != nil {
			continue
		}
		out[pid] = uint64((ts.User + ts.System) * 1e9)
	}
	return out
}

// readCommand is pid's command line as a row shows it; "" when it cannot be read.
func readCommand(pid int32) string {
	p, err := process.NewProcess(pid)
	if err != nil {
		return ""
	}
	args, err := p.CmdlineSlice()
	if err != nil {
		return ""
	}
	return memusage.ShortCommand(args)
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"strconv"
	"strings"
)

// gpuEngineUse is one instance of Windows' "GPU Engine" counter: a process's share of one engine of one adapter.
type gpuEngineUse struct {
	Pid    int
	Engine string // the adapter and engine: "luid_0x0_0xc9e3_phys_0_eng_0"
	Pct    float64
}

// parseGpuInstance reads a "GPU Engine" instance name, "pid_1234_luid_0x00000000_0x0000C9E3_phys_0_eng_0_engtype_3D":
// the process, and the engine as the adapter and engine index (the engine type left out, since each index has one).
func parseGpuInstance(name string) (pid int, engine string, ok bool) {
	parts := strings.Split(strings.ToLower(name), "_")
	if len(parts) < 9 || parts[0] != "pid" || parts[2] != "luid" {
		return 0, "", false
	}
	pid, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, "", false
	}
	end := len(parts)
	for i, p := range parts {
		if p == "engtype" {
			end = i
			break
		}
	}
	if end <= 3 {
		return 0, "", false
	}
	return pid, strings.Join(parts[2:end], "_"), true
}

// gpuTotals turns one reading into what Task Manager shows: the machine's GPU as its busiest engine (the sum of every
// process on it), and each process's GPU as its busiest engine. Both are capped at 100.
func gpuTotals(uses []gpuEngineUse) (machine float64, byPid map[int]float64) {
	perEngine := map[string]float64{}
	perPidEngine := map[int]map[string]float64{}
	for _, u := range uses {
		if u.Pct <= 0 {
			continue
		}
		perEngine[u.Engine] += u.Pct
		m, ok := perPidEngine[u.Pid]
		if !ok {
			m = map[string]float64{}
			perPidEngine[u.Pid] = m
		}
		m[u.Engine] += u.Pct
	}
	for _, v := range perEngine {
		machine = max(machine, v)
	}
	byPid = make(map[int]float64, len(perPidEngine))
	for pid, engines := range perPidEngine {
		var top float64
		for _, v := range engines {
			top = max(top, v)
		}
		byPid[pid] = min(top, 100)
	}
	return min(machine, 100), byPid
}

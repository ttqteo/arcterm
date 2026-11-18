// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import "testing"

func TestParseGpuInstance(t *testing.T) {
	pid, engine, ok := parseGpuInstance("pid_1234_luid_0x00000000_0x0000C9E3_phys_0_eng_3_engtype_VideoDecode")
	if !ok || pid != 1234 || engine != "luid_0x00000000_0x0000c9e3_phys_0_eng_3" {
		t.Fatalf("got %d %q %v", pid, engine, ok)
	}
	for _, bad := range []string{"", "_Total", "pid_x_luid_0_0_phys_0_eng_0_engtype_3D", "luid_0x0_0x1_phys_0"} {
		if _, _, ok := parseGpuInstance(bad); ok {
			t.Errorf("%q parsed", bad)
		}
	}
}

func TestGpuTotalsTakesTheBusiestEngine(t *testing.T) {
	uses := []gpuEngineUse{
		{Pid: 1, Engine: "3d", Pct: 30},
		{Pid: 2, Engine: "3d", Pct: 25},
		{Pid: 1, Engine: "copy", Pct: 5},
		{Pid: 3, Engine: "video", Pct: 40},
		{Pid: 4, Engine: "3d", Pct: 0},
	}
	machine, byPid := gpuTotals(uses)
	if machine != 55 {
		t.Fatalf("machine %v, want 55 (the 3D engine: 30 + 25)", machine)
	}
	if byPid[1] != 30 || byPid[2] != 25 || byPid[3] != 40 {
		t.Fatalf("byPid %v", byPid)
	}
	if _, ok := byPid[4]; ok {
		t.Fatalf("an idle process got a row: %v", byPid)
	}
}

func TestGpuTotalsCapsAtOneHundred(t *testing.T) {
	machine, byPid := gpuTotals([]gpuEngineUse{{Pid: 1, Engine: "3d", Pct: 80}, {Pid: 1, Engine: "3d", Pct: 50}})
	if machine != 100 || byPid[1] != 100 {
		t.Fatalf("machine %v byPid %v", machine, byPid)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestOutputTaskId(t *testing.T) {
	cases := map[string]string{
		`cmd /c "pwsh -c ls > "C:\Users\me\AppData\Local\Temp\claude\x\tasks\b7k2.output" 2>&1"`: "b7k2",
		`cmd /c "dir"`:                           "",
		`cmd /c "x > "C:\tmp\b7k2.output" 2>&1"`: "",
	}
	for cmdline, want := range cases {
		if got := outputTaskId(cmdline); got != want {
			t.Errorf("outputTaskId(%q) = %q, want %q", cmdline, got, want)
		}
	}
}

// what Git Bash started for a task out of the job: the group's pids and their Windows descendants, never a job
// member, a pid already taken, or a "child" older than its parent (a reused pid)
func TestOutsideOf(t *testing.T) {
	table := map[int]proc{
		10: {Pid: 10, Ppid: 1, Name: "bash.exe"},   // the task's bash, in the job
		20: {Pid: 20, Ppid: 99, Name: "task.exe"},  // started out of the job; its Windows parent is gone
		21: {Pid: 21, Ppid: 20, Name: "cargo.exe"}, // what it runs
		22: {Pid: 22, Ppid: 21, Name: "rustc.exe"},
		23: {Pid: 23, Ppid: 20, Name: "old.exe"}, // older than 20: a reused ppid, not its child
		30: {Pid: 30, Ppid: 10, Name: "stray.exe"},
		40: {Pid: 40, Ppid: 20, Name: "taken.exe"},
	}
	created := map[int]int64{10: 100, 20: 200, 21: 210, 22: 220, 23: 50, 30: 300, 40: 240}
	inJob := map[int]bool{10: true}
	taken := map[int]bool{10: true, 40: true}
	got := outsideOf(table, []int{10, 20}, inJob, taken, func(pid int) int64 { return created[pid] })
	slices.Sort(got)
	if want := []int{20, 21, 22, 30}; !slices.Equal(got, want) {
		t.Errorf("outside = %v, want %v", got, want)
	}
	// a second task whose group names the same pids claims none of them
	if again := outsideOf(table, []int{20}, inJob, taken, func(pid int) int64 { return created[pid] }); len(again) != 0 {
		t.Errorf("pids taken by the first task were claimed again: %v", again)
	}
}

// a task's figure is its processes in the job and outside it; the group's total gains only the outside ones, its rows
// already holding the rest
func TestAddShellTasks(t *testing.T) {
	procs := map[int]proc{
		10: {Pid: 10, CreateTs: 1000, Cpu: 1, Mem: 100},
		11: {Pid: 11, Cpu: 2, Mem: 200},
		20: {Pid: 20, Cpu: 4, Mem: 1000},
		21: {Pid: 21, Cpu: -1, Mem: -1}, // could not be read: left out
	}
	g := wshrpc.ResMonGroup{Cpu: 3, Mem: 300}
	addShellTasks(&g, procs, []shellTask{{root: 10, command: "cargo build", pids: []int{10, 11}, outside: []int{20, 21}}})
	if g.Mem != 1300 || g.Cpu != 7 {
		t.Errorf("group totals = %v cpu, %d mem; want 7, 1300", g.Cpu, g.Mem)
	}
	want := []wshrpc.ResMonShellTask{{Command: "cargo build", CreateTs: 1000, Cpu: 7, Mem: 1300}}
	if !slices.Equal(g.Tasks, want) {
		t.Errorf("tasks = %+v, want %+v", g.Tasks, want)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"slices"
	"strings"
	"testing"
)

// a job's tool commands are claude's children that eval a Bash command or redirect a PowerShell task's output, each
// with its subtree; claude's other children are not
func TestJobShellTasks(t *testing.T) {
	bash := `"C:\Program Files\Git\usr\bin\bash.exe" -c "` + bashScript + `"`
	procs := map[int]proc{
		1:  {Pid: 1, Ppid: 0, Name: "cmd.exe", CreateTs: 1},
		2:  {Pid: 2, Ppid: 1, Name: "claude.exe", CreateTs: 2},
		10: {Pid: 10, Ppid: 2, Name: "bash.exe", Command: bash, CreateTs: 10},
		11: {Pid: 11, Ppid: 10, Name: "sleep.exe", CreateTs: 11},
		20: {Pid: 20, Ppid: 2, Name: "cmd.exe", Command: `cmd /c "pwsh -c ls > "C:\t\tasks\b7k2.output" 2>&1"`, CreateTs: 20},
		30: {Pid: 30, Ppid: 2, Name: "node.exe", Command: "node mcp.js", CreateTs: 30},
		40: {Pid: 40, Ppid: 1, Name: "bash.exe", Command: bash, CreateTs: 40}, // not claude's child
	}
	tasks := jobShellTasks(procs, []int{1, 2, 10, 11, 20, 30, 40}, 1)
	slices.SortFunc(tasks, func(a, b shellTask) int { return a.root - b.root })
	if len(tasks) != 2 {
		t.Fatalf("tasks = %+v, want the bash and the PowerShell task", tasks)
	}
	if b := tasks[0]; b.root != 10 || b.command != "sleep 600 # probe" || b.taskId != "" || !slices.Equal(b.pids, []int{10, 11}) {
		t.Errorf("bash task = %+v", b)
	}
	if p := tasks[1]; p.root != 20 || p.taskId != "b7k2" || p.command != "" || !slices.Equal(p.pids, []int{20}) {
		t.Errorf("PowerShell task = %+v", p)
	}
}

// a heavy command the arc mod ran in its jobslot wrapper reads as the command the agent wrote, which the transcript keeps
func TestJobShellTasksUnwrapsTheJobslotWrapper(t *testing.T) {
	wrapped := `'C:\Users\me\.arc\bin\wsh.exe' jobslot --hold-parent -- 'cargo build'; [ $? -ne 75 ] || exit 75` + "\n" + "cargo build"
	script := `source /c/snap.sh 2>/dev/null || true && eval ` + shQuote(wrapped) + ` < /dev/null && pwd -P >| /c/cwd`
	procs := map[int]proc{
		1: {Pid: 1, Name: "cmd.exe", CreateTs: 1},
		2: {Pid: 2, Ppid: 1, Name: "claude.exe", CreateTs: 2},
		// the script's own double quotes (shQuote's '"'"') are escaped in the Windows command line
		10: {Pid: 10, Ppid: 2, Name: "bash.exe", Command: `"C:\Program Files\Git\usr\bin\bash.exe" -c "` + strings.ReplaceAll(script, `"`, `\"`) + `"`, CreateTs: 10},
	}
	tasks := jobShellTasks(procs, []int{1, 2, 10}, 1)
	if len(tasks) != 1 || tasks[0].command != "cargo build" {
		t.Errorf("tasks = %+v, want the one task as `cargo build`", tasks)
	}
}

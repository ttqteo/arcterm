// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"context"
	"log"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// msysTableTTL is how long a tick reuses an MSYS process table: `ps -l` is a process start, so a sampler that read it
// every 2-second tick while an agent runs a command would start one every tick. A command a task starts after the read
// joins its figure at the next one.
const msysTableTTL = 10 * time.Second

const (
	// the arc mod runs a heavy command as
	//   '<wsh>' jobslot --hold-parent -- '<command>'; [ $? -ne 75 ] || exit 75\n<command>
	// (claude/arc-mod/hooks/jobslot-core.ts heldInBackground; 75 is JOBSLOT_REFUSED_EXIT), while the transcript keeps
	// the command the agent wrote
	heldMarker = " jobslot --hold-parent -- "
	heldTail   = "; [ $? -ne 75 ] || exit 75\n"
)

// HeldOriginal is the command the arc mod's background wrapper holds, which is what the person ran; any other command
// comes back as it is. It is jobslot-core.ts heldOriginal without knowing the wsh path: the wrapper is rebuilt around
// each candidate original, and only a command that equals its rebuilt self is a wrapper. The quoted copy may hold
// the tail's text too, so each place the tail occurs is tried.
func HeldOriginal(command string) string {
	i := strings.Index(command, heldMarker)
	if i < 2 || command[0] != '\'' || command[i-1] != '\'' {
		return command
	}
	prefix := command[:i] + heldMarker
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }
	for from := 0; from < len(command); {
		k := strings.Index(command[from:], heldTail)
		if k < 0 {
			break
		}
		at := from + k
		original := command[at+len(heldTail):]
		if command == prefix+quote(original)+heldTail+original {
			return original
		}
		from = at + 1
	}
	return command
}

// shellTask is one command a claude agent runs with its Bash or PowerShell tool, as a tick saw it: the process claude
// started for it (root), the job members under it (pids, root first), and what Git Bash started for it out of the job
// with their descendants (outside).
type shellTask struct {
	root            int
	taskId, command string
	pids            []int
	outside         []int
}

// msysTable is one read of an MSYS install's process table.
type msysTable struct {
	procs []MsysProc
	at    time.Time
}

// outputTaskId is the task id a PowerShell-tool task's cmd.exe names in the output file it redirects into, "" for any
// other command line.
func outputTaskId(cmdline string) string {
	i := strings.Index(cmdline, outputSuffix)
	if i < 0 {
		return ""
	}
	head := cmdline[:i]
	j := strings.LastIndex(head, outputDir)
	if j < 0 {
		return ""
	}
	return head[j+len(outputDir):]
}

// taskOf reads whether p, a child of parent, runs a claude tool command: a PowerShell task's cmd.exe by its task id, a
// Bash task's bash by the command it evals.
func taskOf(p, parent proc) (taskId, command string, ok bool) {
	if !strings.EqualFold(parent.Name, imageClaude) {
		return "", "", false
	}
	if strings.EqualFold(p.Name, imageCmd) {
		id := outputTaskId(p.Command)
		return id, "", id != ""
	}
	// the transcript keeps the command the agent wrote, not the jobslot wrapper the arc mod ran it in
	command, ok = EvalCommand(splitCmdline(p.Command))
	return "", HeldOriginal(command), ok
}

// jobShellTasks is every tool command running in one job: a member whose parent is the job's claude, with its subtree
// of members. procs must hold the members' command lines.
func jobShellTasks(procs map[int]proc, members []int, rootPid int) []shellTask {
	in := make(map[int]bool, len(members))
	for _, m := range members {
		in[m] = true
	}
	var rows []treeRow
	var tasks []shellTask
	for _, m := range members {
		p := procs[m]
		if !in[p.Ppid] || !isJobChild(p, procs[p.Ppid]) {
			continue
		}
		taskId, command, ok := taskOf(p, procs[p.Ppid])
		if !ok {
			continue
		}
		if rows == nil {
			rows = jobTree(procs, members, rootPid)
		}
		tasks = append(tasks, shellTask{root: m, taskId: taskId, command: command, pids: append([]int{m}, rowPids(subtree(rows, m))...)})
	}
	return tasks
}

// msysPsOf is the ps.exe beside the first MSYS bash among pids, "" when there is none.
func msysPsOf(procs map[int]proc, pids []int) string {
	for _, pid := range pids {
		p := procs[pid]
		if !strings.EqualFold(p.Name, imageBash) {
			continue
		}
		if argv := splitCmdline(p.Command); len(argv) > 0 {
			if ps := MsysPsBeside(argv[0]); ps != "" {
				return ps
			}
		}
	}
	return ""
}

// msysProcs reads ps's table, reusing a read younger than msysTableTTL. A failed read is logged and reads as none.
func (st *tickState) msysProcs(ps string, now time.Time) []MsysProc {
	if t, ok := st.msys[ps]; ok && now.Sub(t.at) < msysTableTTL {
		return t.procs
	}
	procs, err := ReadMsysProcs(context.Background(), ps)
	if err != nil {
		log.Printf("resmon: reading the msys process table with %s: %v", ps, err)
	}
	st.msys[ps] = msysTable{procs: procs, at: now}
	return procs
}

// outsideOf is what Git Bash started for a task out of its job: the members of the MSYS process groups the task's own
// processes lead, and their descendants by Windows parent, minus every job member and every pid taken already. A
// descendant links only when it is no older than its parent (isArcChild), so a reused pid is never claimed.
func outsideOf(table map[int]proc, group []int, inJob, taken map[int]bool, createTs func(int) int64) []int {
	byPpid := map[int][]int{}
	for pid, p := range table {
		byPpid[p.Ppid] = append(byPpid[p.Ppid], pid)
	}
	withTs := func(pid int) proc {
		p := table[pid]
		p.Pid, p.CreateTs = pid, createTs(pid)
		return p
	}
	var out []int
	seen := map[int]bool{}
	var walk func(pid int)
	walk = func(pid int) {
		if seen[pid] {
			return
		}
		seen[pid] = true
		// a job member or a pid already placed is walked through, not claimed: what it runs out of the job is still
		// the task's
		if !inJob[pid] && !taken[pid] {
			taken[pid] = true
			out = append(out, pid)
		}
		parent := withTs(pid)
		kids := slices.Clone(byPpid[pid])
		slices.Sort(kids)
		for _, c := range kids {
			if isArcChild(withTs(c), parent) {
				walk(c)
			}
		}
	}
	for _, pid := range group {
		if _, ok := table[pid]; ok {
			walk(pid)
		}
	}
	return out
}

// shellTasks finds every job's tool commands and what Git Bash started for each out of the job. The MSYS table is read
// only when some task runs in an MSYS bash. taken holds the pids already placed (job members, the Arc tree); an outside
// pid is taken by the first task whose group holds it.
func (st *tickState) shellTasks(procs, table map[int]proc, jobs []jobobject.LiveJob, inJob, taken map[int]bool, createTs func(int) int64, now time.Time) map[rootKey][]shellTask {
	out := map[rootKey][]shellTask{}
	for _, j := range jobs {
		members := slices.DeleteFunc(slices.Clone(j.Members), func(pid int) bool { _, ok := procs[pid]; return !ok })
		tasks := jobShellTasks(procs, members, j.RootPid)
		for i := range tasks {
			if tasks[i].command == "" {
				continue // a PowerShell task's commands stay in the job
			}
			ps := msysPsOf(procs, tasks[i].pids)
			if ps == "" {
				continue
			}
			group := MsysGroupPids(st.msysProcs(ps, now), tasks[i].pids)
			tasks[i].outside = outsideOf(table, group, inJob, taken, createTs)
		}
		if len(tasks) > 0 {
			out[rootKey{j.Owner, j.RootPid}] = tasks
		}
	}
	return out
}

// taskFigures adds up a task's processes: those procs could not read (-1) are left out.
func taskFigures(procs map[int]proc, pids ...[]int) (cpu float64, mem int64) {
	for _, list := range pids {
		for _, pid := range list {
			p, ok := procs[pid]
			if !ok {
				continue
			}
			if p.Cpu > 0 {
				cpu += p.Cpu
			}
			if p.Mem > 0 {
				mem += p.Mem
			}
		}
	}
	return cpu, mem
}

// addShellTasks puts a job's tool commands on its group, each with its processes' figures, and adds what they run
// outside the job to the group's totals: those processes are no row of the group, but the agent runs them.
func addShellTasks(g *wshrpc.ResMonGroup, procs map[int]proc, tasks []shellTask) {
	for _, t := range tasks {
		cpu, mem := taskFigures(procs, t.pids, t.outside)
		g.Tasks = append(g.Tasks, wshrpc.ResMonShellTask{
			TaskId: t.taskId, Command: t.command, CreateTs: procs[t.root].CreateTs, Cpu: cpu, Mem: mem,
		})
		outCpu, outMem := taskFigures(procs, t.outside)
		g.Cpu += outCpu
		g.Mem += outMem
	}
}

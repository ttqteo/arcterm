// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"cmp"
	"context"
	"errors"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	imageClaude = "claude.exe"
	imageCmd    = "cmd.exe"
	imageBash   = "bash.exe"
	msysPsImage = "ps.exe"
	msysPsWait  = 5 * time.Second

	// claude code runs a Bash-tool command as `bash -c "... && eval '<command>' < /dev/null && pwd -P >| ..."`
	evalPrefix = "eval "
	evalSuffix = " < /dev/null"
	// and a PowerShell-tool one as `cmd /c "... pwsh ... > "<dir>\tasks\<task id>.output" 2>&1"`
	outputDir    = `\tasks\`
	outputSuffix = `.output" 2>&1`
)

// shQuote single-quotes s as claude code does for its eval.
func shQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

// isTaskProcess reports whether a child of claude runs the background task. A PowerShell-tool task's cmd.exe
// redirects into the output file its id names; a Bash-tool task's bash evals the command in its -c script.
func isTaskProcess(name, cmdline string, argv []string, taskId, command string) bool {
	if strings.EqualFold(name, imageCmd) {
		return taskId != "" && strings.Contains(cmdline, outputDir+taskId+outputSuffix)
	}
	if command == "" {
		return false
	}
	want := evalPrefix + shQuote(command) + evalSuffix
	for i := 0; i+1 < len(argv); i++ {
		if argv[i] == "-c" && strings.Contains(argv[i+1], want) {
			return true
		}
	}
	return false
}

// findTaskRoot is the job member, a child of claude, that runs the task. The same command can run twice, so
// of several matches the one created nearest the task's start wins.
func findTaskRoot(table map[int]proc, members []int, data wshrpc.CommandResMonKillShellTaskData) (int, bool) {
	in := make(map[int]bool, len(members))
	for _, m := range members {
		in[m] = true
	}
	best, bestDist := 0, int64(-1)
	for _, m := range members {
		p, ok := table[m]
		if !ok || !in[p.Ppid] || !strings.EqualFold(table[p.Ppid].Name, imageClaude) {
			continue
		}
		cmdline := readCmdline(m)
		if !isTaskProcess(p.Name, cmdline, splitCmdline(cmdline), data.TaskId, data.Command) {
			continue
		}
		dist := readStat(m).createTs - data.StartedTs
		if dist < 0 {
			dist = -dist
		}
		if bestDist < 0 || dist < bestDist {
			best, bestDist = m, dist
		}
	}
	return best, bestDist >= 0
}

type msysProc struct {
	pid, pgid, winpid int
}

// parseMsysPs reads `ps -l` rows: PID PPID PGID WINPID TTY UID STIME COMMAND, each optionally led by a
// one-letter status.
func parseMsysPs(out string) []msysProc {
	var procs []msysProc
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) > 0 && len(f[0]) == 1 && !unicode.IsDigit(rune(f[0][0])) {
			f = f[1:]
		}
		if len(f) < 4 {
			continue
		}
		pid, err1 := strconv.Atoi(f[0])
		pgid, err2 := strconv.Atoi(f[2])
		winpid, err3 := strconv.Atoi(f[3])
		if err1 != nil || err2 != nil || err3 != nil {
			continue // the header
		}
		procs = append(procs, msysProc{pid: pid, pgid: pgid, winpid: winpid})
	}
	return procs
}

// msysGroupPids is the Windows pids of every MSYS process in a group led by one of pids. Only a group its
// leader is in pids counts, so a group the task merely joined is never taken.
func msysGroupPids(procs []msysProc, pids []int) []int {
	in := make(map[int]bool, len(pids))
	for _, p := range pids {
		in[p] = true
	}
	leaders := map[int]bool{}
	for _, p := range procs {
		if in[p.winpid] && p.pid == p.pgid {
			leaders[p.pgid] = true
		}
	}
	var out []int
	for _, p := range procs {
		if leaders[p.pgid] {
			out = append(out, p.winpid)
		}
	}
	return out
}

// msysGroup is what Git Bash runs for the task outside its Windows tree: its fork exits once the command
// starts, so the command's Windows parent is gone and only MSYS's process groups still link it to its shell.
// ps is the one beside the task's MSYS bash, which reads that install's process table.
func msysGroup(ctx context.Context, table map[int]proc, pids []int) []int {
	ps := ""
	for _, pid := range pids {
		if !strings.EqualFold(table[pid].Name, imageBash) {
			continue
		}
		argv := splitCmdline(readCmdline(pid))
		if len(argv) == 0 {
			continue
		}
		if cand := filepath.Join(filepath.Dir(argv[0]), msysPsImage); fileExists(cand) {
			ps = cand
			break
		}
	}
	if ps == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, msysPsWait)
	defer cancel()
	out, err := exec.CommandContext(ctx, ps, "-l").Output()
	if err != nil {
		log.Printf("resmon: reading the msys process table with %s: %v", ps, err)
		return nil
	}
	return msysGroupPids(parseMsysPs(string(out)), pids)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// taskKillSet is the task's root and its tree, then each MSYS group member and its tree, each pid once, in
// that order: a shell goes before what it runs, so it cannot start the next command.
func taskKillSet(rows []treeRow, root int, group []int) []int {
	seen := map[int]bool{}
	var out []int
	add := func(pid int) {
		for _, p := range append([]int{pid}, rowPids(subtree(rows, pid))...) {
			if !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	add(root)
	for _, pid := range group {
		add(pid)
	}
	return out
}

func rowPids(rows []treeRow) []int {
	out := make([]int, len(rows))
	for i, r := range rows {
		out[i] = r.Pid
	}
	return out
}

// KillShellTask terminates one background shell task of a killable claude agent: the process claude started
// for it and everything that process runs inside the agent's job. A task no live process matches is gone.
func KillShellTask(ctx context.Context, resolve Resolver, data wshrpc.CommandResMonKillShellTaskData) wshrpc.ResMonKillRtnData {
	jobs, info, ok := ownerJobs(ctx, resolve, data.OwnerId)
	if !ok {
		return refused
	}
	table, err := readTable()
	if err != nil {
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Failed, Error: err.Error()}
	}
	for _, j := range jobs {
		root, found := findTaskRoot(table, j.Members, data)
		if !found {
			continue
		}
		layout := readLayout(table, j, info.Agent)
		tree := append([]int{root}, rowPids(subtree(layout.rows, root))...)
		return terminateTask(j.Owner, taskKillSet(layout.rows, root, msysGroup(ctx, table, tree)), layout.core)
	}
	return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Gone}
}

// terminateTask terminates pids that are not core, in order. A pid outside the job (an MSYS process of
// another owner) or already exited is passed over.
func terminateTask(o jobobject.Owner, pids []int, core map[int]string) wshrpc.ResMonKillRtnData {
	killed := 0
	var failure error
	for _, pid := range pids {
		if core[pid] != "" {
			continue
		}
		switch err := jobobject.TerminateMember(o, pid); {
		case err == nil:
			killed++
		case errors.Is(err, jobobject.ErrGone), errors.Is(err, jobobject.ErrNotMember):
		default:
			log.Printf("resmon: terminating pid %d of a shell task in %s %s: %v", pid, o.Kind, o.Id, err)
			failure = cmp.Or(failure, err)
		}
	}
	switch {
	case killed > 0:
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Killed, Killed: killed}
	case failure != nil:
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Failed, Error: osText(failure)}
	}
	return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Gone}
}

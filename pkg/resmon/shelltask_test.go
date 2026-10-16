// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"slices"
	"testing"
)

const bashScript = `source /c/snap.sh 2>/dev/null || true && eval 'sleep 600 # probe' < /dev/null && pwd -P >| /c/cwd`

func TestIsTaskProcessBash(t *testing.T) {
	argv := []string{`C:\Program Files\Git\bin\bash.exe`, "-c", bashScript}
	cases := []struct {
		name, command string
		want          bool
	}{
		{"exact command", "sleep 600 # probe", true},
		{"prefix of the command", "sleep 600", false},
		{"other command", "sleep 60", false},
		{"no command", "", false},
	}
	for _, c := range cases {
		if got := isTaskProcess("bash.exe", "", argv, "b1", c.command); got != c.want {
			t.Errorf("%s: isTaskProcess = %v, want %v", c.name, got, c.want)
		}
	}
	// the script is only read after -c
	if isTaskProcess("bash.exe", "", []string{"bash.exe", bashScript}, "b1", "sleep 600 # probe") {
		t.Error("matched a script that is not a -c argument")
	}
}

func TestIsTaskProcessQuotedCommand(t *testing.T) {
	command := `echo "it's" '$HOME'`
	script := `x && eval ` + `'echo "it'"'"'s" '"'"'$HOME'"'"''` + ` < /dev/null && pwd -P`
	if !isTaskProcess("bash.exe", "", []string{"bash.exe", "-c", script}, "b1", command) {
		t.Fatal("did not match a command with quotes")
	}
}

func TestIsTaskProcessPowerShell(t *testing.T) {
	cmdline := `C:\WINDOWS\System32\cmd.exe /d /s /c ""chcp.com" 65001 >nul & "pwsh.exe" -Command "..." > "C:\Temp\claude\p\s\tasks\b10l70gsa.output" 2>&1"`
	if !isTaskProcess("cmd.exe", cmdline, nil, "b10l70gsa", "") {
		t.Error("did not match the task's output redirect")
	}
	if isTaskProcess("cmd.exe", cmdline, nil, "b10l70g", "") {
		t.Error("matched a prefix of the task id")
	}
	// a bash task that only reads another task's output file is not that task
	if isTaskProcess("bash.exe", cmdline, nil, "b10l70gsa", "") {
		t.Error("matched the output path in a bash process")
	}
}

const psOut = `      PID    PPID    PGID     WINPID   TTY         UID    STIME COMMAND
    61724       1   61724      14056  ?         197609 00:43:44 /usr/bin/bash
    61730   61724   61724      39176  ?         197609 00:43:44 /usr/bin/sleep
S   61731   61730   61724      39177  ?         197609 00:43:44 /usr/bin/node
    65363       1   65363      53632  ?         197609 00:45:38 /usr/bin/bash
    65400   65363   61724      22792  ?         197609 00:45:39 /usr/bin/bash
`

func TestParseMsysPs(t *testing.T) {
	got := parseMsysPs(psOut)
	want := []msysProc{
		{61724, 61724, 14056}, {61730, 61724, 39176}, {61731, 61724, 39177}, {65363, 65363, 53632}, {65400, 61724, 22792},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("parseMsysPs = %v, want %v", got, want)
	}
}

func TestMsysGroupPids(t *testing.T) {
	procs := parseMsysPs(psOut)
	got := msysGroupPids(procs, []int{50304, 14056})
	if want := []int{14056, 39176, 39177, 22792}; !slices.Equal(got, want) {
		t.Errorf("group led by the task's shell = %v, want %v", got, want)
	}
	// 22792 is in the group but does not lead it: the group is not taken
	if got := msysGroupPids(procs, []int{22792}); len(got) != 0 {
		t.Errorf("group of a non-leader = %v, want none", got)
	}
}

func TestTaskKillSet(t *testing.T) {
	// 10 > 11 > 12 is the task's tree; 20 > 21 is a forked command whose windows parent exited; 30 is not the task
	rows := []treeRow{{10, 0}, {11, 1}, {12, 2}, {20, 0}, {21, 1}, {30, 0}}
	got := taskKillSet(rows, 10, []int{11, 20})
	if want := []int{10, 11, 12, 20, 21}; !slices.Equal(got, want) {
		t.Fatalf("taskKillSet = %v, want %v", got, want)
	}
}

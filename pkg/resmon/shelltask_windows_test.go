//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	tasksEnv   = "RESMON_TEST_TASKS"
	gitBashEnv = "RESMON_TEST_GITBASH"
	// each task prints its name and the windows pid of the sleep it forks, then waits on it
	taskCommand = "sleep 60 & echo %s $(cat /proc/$!/winpid); wait"
)

// a command line claude code started a Bash-tool task with, captured from a live session
const capturedCmdline = `"C:\Program Files\Git\bin\bash.exe" -c "source /c/Users/u/.claude/shell-snapshots/snapshot-bash-1-x.sh 2>/dev/null || true && eval 'echo \"it'\"'\"'s \\\"q\\\" \$HOME\" >/dev/null; powershell -Command \"Where-Object { \$_.Name -eq '\"'\"'bash.exe'\"'\"' }\" # quote-probe-x' < /dev/null && pwd -P >| /c/Users/u/AppData/Local/Temp/claude-544d-cwd"`

const capturedCommand = `echo "it's \"q\" \$HOME" >/dev/null; powershell -Command "Where-Object { \$_.Name -eq 'bash.exe' }" # quote-probe-x`

func TestIsTaskProcessCapturedCmdline(t *testing.T) {
	if !isTaskProcess("bash.exe", capturedCmdline, splitCmdline(capturedCmdline), "b1", capturedCommand) {
		t.Fatal("did not match the command line claude code started the task with")
	}
}

// helperClaude stands in for claude.exe: on the go-ahead it starts one Git Bash task per name in
// RESMON_TEST_TASKS, the way claude code starts a Bash-tool command, prints "bash <name> <pid>" for each and
// relays what the tasks print.
func helperClaude() {
	if _, err := bufio.NewReader(os.Stdin).ReadString('\n'); err != nil {
		fail(err)
	}
	for _, name := range strings.Split(os.Getenv(tasksEnv), ",") {
		script := "true && " + evalPrefix + shQuote(fmt.Sprintf(taskCommand, name)) + evalSuffix + " && pwd -P"
		task := exec.Command(os.Getenv(gitBashEnv), "-c", script)
		task.Stdout = os.Stdout
		if err := task.Start(); err != nil {
			fail(err)
		}
		fmt.Printf("bash %s %d\n", name, task.Process.Pid)
	}
	select {}
}

func gitBash(t *testing.T) string {
	bash := filepath.Join(os.Getenv("ProgramFiles"), "Git", "bin", "bash.exe")
	if !fileExists(bash) {
		t.Skip("Git Bash is not installed at", bash)
	}
	return bash
}

// claudeTree is a stand-in claude.exe started in a registered job, with its tasks' outer bash and forked sleep.
type claudeTree struct {
	owner jobobject.Owner
	bash  map[string]int
	sleep map[string]int
}

func startClaude(t *testing.T, tasks ...string) *claudeTree {
	t.Helper()
	bash := gitBash(t)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	claude := filepath.Join(t.TempDir(), imageClaude)
	if err := copyFile(exe, claude); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(claude, helperRunFlag)
	cmd.Env = append(os.Environ(), helperEnv+"=claude", tasksEnv+"="+strings.Join(tasks, ","), gitBashEnv+"="+bash)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting claude: %v", err)
	}
	job, err := jobobject.Attach(cmd.Process)
	if err != nil {
		cmd.Process.Kill()
		t.Fatalf("Attach: %v", err)
	}
	ct := &claudeTree{owner: blockOwner(t), bash: map[string]int{}, sleep: map[string]int{}}
	jobobject.Register(job, cmd.Process.Pid, ct.owner)
	// closing the job reaps the tasks too; the temp dir is removed after, once claude.exe has exited
	t.Cleanup(func() {
		jobobject.Close(job)
		cmd.Wait()
	})
	stdin.Write([]byte("\n"))
	for _, line := range readLines(t, stdout, 2*len(tasks)) {
		var kind, name string
		var pid int
		if _, err := fmt.Sscanf(line, "%s %s %d", &kind, &name, &pid); err == nil && kind == "bash" {
			ct.bash[name] = pid
		} else if _, err := fmt.Sscanf(line, "%s %d", &name, &pid); err == nil {
			ct.sleep[name] = pid
		} else {
			t.Fatalf("parsing %q", line)
		}
	}
	return ct
}

func copyFile(from, to string) error {
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}

func TestKillShellTaskKillsForkedCommand(t *testing.T) {
	ct := startClaude(t, "a", "b")
	resolve := agentResolver(wshrpc.ResMonOwner_AgentTab)

	got := KillShellTask(context.Background(), resolve, wshrpc.CommandResMonKillShellTaskData{
		OwnerId: ct.owner.Id, TaskId: "ba", Command: fmt.Sprintf(taskCommand, "a"),
	})
	if got.Outcome != wshrpc.ResMonKill_Killed || got.Killed < 2 {
		t.Fatalf("result = %+v, want killed with the shell and its sleep", got)
	}
	waitForExit(t, ct.bash["a"])
	waitForExit(t, ct.sleep["a"])
	assertRunning(t, "the other task", ct.bash["b"], ct.sleep["b"])
}

func TestKillShellTaskGone(t *testing.T) {
	ct := startClaude(t, "a")
	got := KillShellTask(context.Background(), agentResolver(wshrpc.ResMonOwner_AgentTab), wshrpc.CommandResMonKillShellTaskData{
		OwnerId: ct.owner.Id, TaskId: "bz", Command: "sleep 60",
	})
	assertOutcome(t, got, wshrpc.ResMonKill_Gone, 0)
	assertRunning(t, "the task", ct.bash["a"], ct.sleep["a"])
}

func TestKillShellTaskRefusesReadOnlyOwner(t *testing.T) {
	ct := startClaude(t, "a")
	got := KillShellTask(context.Background(), agentResolver(wshrpc.ResMonOwner_RunCmd), wshrpc.CommandResMonKillShellTaskData{
		OwnerId: ct.owner.Id, TaskId: "ba", Command: fmt.Sprintf(taskCommand, "a"),
	})
	assertOutcome(t, got, wshrpc.ResMonKill_Refused, 0)
	assertRunning(t, "the task", ct.bash["a"], ct.sleep["a"])
}

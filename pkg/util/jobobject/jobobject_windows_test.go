//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"golang.org/x/sys/windows"
)

const (
	helperEnv      = "JOBOBJECT_TEST_HELPER"
	helperLifetime = 60 * time.Second
	exitTimeout    = 10 * time.Second
)

// TestHelperProcess is not a test: it is the child process the other tests start.
func TestHelperProcess(t *testing.T) {
	switch os.Getenv(helperEnv) {
	case "sleep":
		time.Sleep(helperLifetime)
		os.Exit(0)
	case "spawn":
		// waits for the go-ahead so the parent attaches the job first, then starts a sleeper and exits
		if _, err := bufio.NewReader(os.Stdin).ReadString('\n'); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		child, err := helperCmd("sleep")
		if err == nil {
			err = child.Start()
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(child.Process.Pid)
		os.Exit(0)
	case "detach":
		// like spawn, but starts two sleepers, a plain one and a detached one, and prints both pids
		if _, err := bufio.NewReader(os.Stdin).ReadString('\n'); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		plain, err := helperCmd("sleep")
		if err == nil {
			err = plain.Start()
		}
		var detached *exec.Cmd
		if err == nil {
			detached, err = helperCmd("sleep")
		}
		if err == nil {
			err = StartDetached(detached)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(plain.Process.Pid, detached.Process.Pid)
		time.Sleep(helperLifetime)
		os.Exit(0)
	}
}

func helperCmd(mode string) (*exec.Cmd, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(exe, "-test.run=^TestHelperProcess$")
	cmd.Env = append(os.Environ(), helperEnv+"="+mode)
	return cmd, nil
}

func startSleeper(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd, err := helperCmd("sleep")
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting sleeper: %v", err)
	}
	t.Cleanup(func() {
		cmd.Process.Kill()
		cmd.Wait()
	})
	return cmd
}

// attachRegistered closes the job at cleanup, so a test that closes it itself must not use this.
func attachRegistered(t *testing.T, cmd *exec.Cmd, o Owner) uintptr {
	t.Helper()
	job, err := Attach(cmd.Process)
	if err != nil {
		t.Fatalf("Attach: %v", err)
	}
	Register(job, cmd.Process.Pid, o)
	t.Cleanup(func() { Close(job) })
	return job
}

func assignToJob(t *testing.T, job uintptr, pid int) {
	t.Helper()
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		t.Fatalf("OpenProcess(%d): %v", pid, err)
	}
	defer windows.CloseHandle(h)
	if err := windows.AssignProcessToJobObject(windows.Handle(job), h); err != nil {
		t.Fatalf("AssignProcessToJobObject(%d): %v", pid, err)
	}
}

// isRunning is false for an exited process even while a handle keeps its object alive.
func isRunning(pid int) bool {
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(h)
	ev, err := windows.WaitForSingleObject(h, 0)
	return err == nil && ev == uint32(windows.WAIT_TIMEOUT)
}

func waitForExit(t *testing.T, pid int) {
	t.Helper()
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(h)
	if ev, err := windows.WaitForSingleObject(h, uint32(exitTimeout.Milliseconds())); err != nil || ev != windows.WAIT_OBJECT_0 {
		t.Fatalf("pid %d did not exit: %d %v", pid, ev, err)
	}
}

func findLiveJob(o Owner) (LiveJob, bool) {
	for _, lj := range LiveJobs() {
		if lj.Owner == o {
			return lj, true
		}
	}
	return LiveJob{}, false
}

func TestMembersIncludesOrphanedGrandchild(t *testing.T) {
	mid, err := helperCmd("spawn")
	if err != nil {
		t.Fatal(err)
	}
	stdin, err := mid.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := mid.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := mid.Start(); err != nil {
		t.Fatalf("starting middle process: %v", err)
	}
	defer func() {
		mid.Process.Kill()
		mid.Wait()
	}()
	job, err := Attach(mid.Process)
	if err != nil {
		t.Fatalf("Attach: %v", err)
	}
	defer Close(job)

	if _, err := stdin.Write([]byte("\n")); err != nil {
		t.Fatal(err)
	}
	sc := bufio.NewScanner(stdout)
	if !sc.Scan() {
		t.Fatalf("middle process printed no pid: %v", sc.Err())
	}
	grandchild, err := strconv.Atoi(strings.TrimSpace(sc.Text()))
	if err != nil {
		t.Fatalf("parsing grandchild pid %q: %v", sc.Text(), err)
	}
	waitForExit(t, mid.Process.Pid)

	members, err := Members(job)
	if err != nil {
		t.Fatalf("Members: %v", err)
	}
	if !slices.Contains(members, grandchild) {
		t.Fatalf("Members = %v, missing orphaned grandchild %d", members, grandchild)
	}
	if !isRunning(grandchild) {
		t.Fatalf("grandchild %d is not running", grandchild)
	}
}

func TestLiveJobsDropsClosedJob(t *testing.T) {
	var logs bytes.Buffer
	prevLog := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(prevLog)

	cmd := startSleeper(t)
	pid := cmd.Process.Pid
	job, err := Attach(cmd.Process)
	if err != nil {
		t.Fatalf("Attach: %v", err)
	}
	o := Owner{Kind: OwnerKind_Block, Id: "test-livejobs-drops-closed"}
	Register(job, pid, o)

	lj, ok := findLiveJob(o)
	if !ok {
		t.Fatal("registered job missing from LiveJobs")
	}
	if lj.RootPid != pid || !slices.Contains(lj.Members, pid) {
		t.Fatalf("LiveJob = %+v, want root and member %d", lj, pid)
	}

	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
				LiveJobs()
			}
		}
	}()
	Close(job)
	close(stop)
	<-done

	if _, ok := findLiveJob(o); ok {
		t.Fatal("closed job still in LiveJobs")
	}
	if logs.Len() > 0 {
		t.Fatalf("LiveJobs logged errors during Close: %s", logs.String())
	}
}

func TestTerminateMemberRefusesNonMember(t *testing.T) {
	member := startSleeper(t)
	stranger := startSleeper(t)
	o := Owner{Kind: OwnerKind_Block, Id: "test-terminate-refuses"}
	attachRegistered(t, member, o)

	if err := TerminateMember(o, stranger.Process.Pid); !errors.Is(err, ErrNotMember) {
		t.Fatalf("TerminateMember(stranger) = %v, want ErrNotMember", err)
	}
	if !isRunning(stranger.Process.Pid) {
		t.Fatal("stranger was terminated")
	}
	if err := TerminateMember(Owner{Kind: OwnerKind_Block, Id: "test-no-such-owner"}, member.Process.Pid); !errors.Is(err, ErrNotMember) {
		t.Fatalf("TerminateMember(unregistered owner) = %v, want ErrNotMember", err)
	}
	if !isRunning(member.Process.Pid) {
		t.Fatal("member was terminated through an owner with no live job")
	}
}

func TestTerminateMemberGone(t *testing.T) {
	cmd := startSleeper(t)
	pid := cmd.Process.Pid
	o := Owner{Kind: OwnerKind_Block, Id: "test-terminate-gone"}
	attachRegistered(t, cmd, o)

	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	// exited, but the exec handle still keeps the process object alive
	waitForExit(t, pid)
	if err := TerminateMember(o, pid); !errors.Is(err, ErrGone) {
		t.Fatalf("TerminateMember(exited, handle open) = %v, want ErrGone", err)
	}
	// releases the last handle, so the pid no longer opens
	cmd.Wait()
	if err := TerminateMember(o, pid); !errors.Is(err, ErrGone) {
		t.Fatalf("TerminateMember(exited, released) = %v, want ErrGone", err)
	}
}

func TestTerminateMemberKills(t *testing.T) {
	root := startSleeper(t)
	target := startSleeper(t)
	o := Owner{Kind: OwnerKind_Block, Id: "test-terminate-kills"}
	job := attachRegistered(t, root, o)
	assignToJob(t, job, target.Process.Pid)

	if err := TerminateMember(o, target.Process.Pid); err != nil {
		t.Fatalf("TerminateMember: %v", err)
	}
	waitForExit(t, target.Process.Pid)
	target.Wait()
	if code := target.ProcessState.ExitCode(); code != terminateExitCode {
		t.Fatalf("target exit code = %d, want %d", code, terminateExitCode)
	}
	if !isRunning(root.Process.Pid) {
		t.Fatal("the job's other member was terminated")
	}
}

func processExists(pid int) bool {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	windows.CloseHandle(h)
	return true
}

// powershellEncodedCommand base64-encodes a command as UTF-16LE for -EncodedCommand.
func powershellEncodedCommand(cmd string) string {
	u16 := utf16.Encode([]rune(cmd))
	buf := make([]byte, 0, len(u16)*2)
	for _, v := range u16 {
		buf = append(buf, byte(v), byte(v>>8))
	}
	return base64.StdEncoding.EncodeToString(buf)
}

// TestJobObjectKillsDescendants verifies that killing the job terminates not just the
// direct child but its descendants too — the behavior that prevents orphaned agent
// processes when a block is closed.
func TestJobObjectKillsDescendants(t *testing.T) {
	dir := t.TempDir()
	pidFile := filepath.Join(dir, "child.pid")
	// inner powershell writes its own pid then sleeps; outer powershell waits on it
	inner := fmt.Sprintf("$pid | Out-File -Encoding ascii -FilePath '%s'; Start-Sleep -Seconds 60", pidFile)
	outer := fmt.Sprintf("Start-Process -NoNewWindow -Wait powershell -ArgumentList '-NoProfile','-EncodedCommand','%s'; Start-Sleep -Seconds 60", powershellEncodedCommand(inner))
	cmd := exec.Command("powershell", "-NoProfile", "-Command", outer)
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting outer process: %v", err)
	}
	defer func() {
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
	}()

	job, err := Attach(cmd.Process)
	if err != nil {
		t.Fatalf("Attach: %v", err)
	}
	if job == 0 {
		t.Fatal("Attach returned zero handle")
	}
	defer Close(job)

	// wait for the descendant to write its pid
	var childPid int
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		data, rerr := os.ReadFile(pidFile)
		if rerr == nil {
			pidStr := strings.TrimSpace(string(data))
			if _, serr := fmt.Sscanf(pidStr, "%d", &childPid); serr == nil && childPid > 0 {
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if childPid == 0 {
		t.Fatal("descendant never wrote its pid")
	}
	if !processExists(childPid) {
		t.Fatalf("descendant %d not running before job kill", childPid)
	}

	KillTree(job)

	deadline = time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if !processExists(childPid) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("descendant %d still alive after job kill", childPid)
}

// TestKillTreeKeepingSparesAKeptApp: a kept app in the job (ping stands in for Docker Desktop) outlives the kill and
// the closing of the job's handle, while the rest of the tree dies; with no kept app the kill takes everything.
func TestKillTreeKeepingSparesAKeptApp(t *testing.T) {
	old := keepImages
	keepImages = map[string]bool{"ping.exe": true}
	t.Cleanup(func() { keepImages = old })

	root := startSleeper(t)
	job, err := Attach(root.Process)
	if err != nil {
		t.Fatalf("Attach: %v", err)
	}
	app := exec.Command("ping", "-n", "120", "127.0.0.1")
	if err := app.Start(); err != nil {
		t.Fatalf("starting ping: %v", err)
	}
	t.Cleanup(func() {
		app.Process.Kill()
		app.Wait()
	})
	assignToJob(t, job, app.Process.Pid)

	KillTreeKeeping(job)
	Close(job)
	waitForExit(t, root.Process.Pid)
	time.Sleep(300 * time.Millisecond)
	if !isRunning(app.Process.Pid) {
		t.Fatal("the kept app died with the job")
	}

	plain := startSleeper(t)
	job2, err := Attach(plain.Process)
	if err != nil {
		t.Fatalf("Attach: %v", err)
	}
	defer Close(job2)
	KillTreeKeeping(job2)
	waitForExit(t, plain.Process.Pid)
}

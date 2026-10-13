//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"golang.org/x/sys/windows"
)

const (
	helperEnv      = "RESMON_TEST_HELPER"
	kidsEnv        = "RESMON_TEST_KIDS"
	helperLifetime = 60 * time.Second
	waitTimeout    = 10 * time.Second
	// no ^ or $ anchors: cmd.exe would eat the ^ when the helper starts under it
	helperRunFlag = "-test.run=TestHelperProcess"
	// grants only wait and limited query, so opening the helper to terminate it is denied
	lockedDacl = "D:(A;;0x101000;;;WD)"
)

// TestHelperProcess is not a test: it is the child process the other tests start.
func TestHelperProcess(t *testing.T) {
	switch os.Getenv(helperEnv) {
	case "tree":
		helperTree()
	case "locked":
		helperLocked()
	}
}

// helperTree waits for the go-ahead (so the test attaches the job first), prints "pid ppid", starts its kids
// (RESMON_TEST_KIDS "2,1": two kids with one kid each), then sleeps.
func helperTree() {
	if os.Getenv("RESMON_TEST_WAIT") != "" {
		if _, err := bufio.NewReader(os.Stdin).ReadString('\n'); err != nil {
			fail(err)
		}
	}
	fmt.Printf("%d %d\n", os.Getpid(), os.Getppid())
	spec := strings.Split(os.Getenv(kidsEnv), ",")
	n, _ := strconv.Atoi(spec[0])
	for range n {
		kid := helperCmd("tree", strings.Join(spec[1:], ","))
		kid.Stdout = os.Stdout
		if err := kid.Start(); err != nil {
			fail(err)
		}
	}
	time.Sleep(helperLifetime)
	os.Exit(0)
}

func helperLocked() {
	if _, err := bufio.NewReader(os.Stdin).ReadString('\n'); err != nil {
		fail(err)
	}
	sd, err := windows.SecurityDescriptorFromString(lockedDacl)
	if err != nil {
		fail(err)
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		fail(err)
	}
	if err := windows.SetSecurityInfo(windows.CurrentProcess(), windows.SE_KERNEL_OBJECT, windows.DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
		fail(err)
	}
	fmt.Println("locked")
	time.Sleep(helperLifetime)
	os.Exit(0)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

func helperCmd(mode, kids string, launcher ...string) *exec.Cmd {
	exe, err := os.Executable()
	if err != nil {
		fail(err)
	}
	args := append(launcher, exe, helperRunFlag)
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Env = append(os.Environ(), helperEnv+"="+mode, kidsEnv+"="+kids, "RESMON_TEST_WAIT=")
	return cmd
}

// testTree is a process tree started in one registered job.
type testTree struct {
	owner jobobject.Owner
	job   uintptr
	root  int         // the job's root: cmd.exe when started under a launcher
	ppid  map[int]int // every helper's parent pid
}

func (tr *testTree) kidsOf(pid int) []int {
	var out []int
	for c, pp := range tr.ppid {
		if pp == pid {
			out = append(out, c)
		}
	}
	return out
}

func treeSize(kids string) int {
	total, level := 1, 1
	for _, s := range strings.Split(kids, ",") {
		n, _ := strconv.Atoi(s)
		level *= n
		total += level
	}
	return total
}

// startTree starts a helper tree in a new job registered for o; under launcher (e.g. "cmd.exe", "/c") the
// launcher is the job's root.
func startTree(t testing.TB, o jobobject.Owner, kids string, launcher ...string) *testTree {
	t.Helper()
	cmd := helperCmd("tree", kids, launcher...)
	cmd.Env = append(cmd.Env, "RESMON_TEST_WAIT=1")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting tree: %v", err)
	}
	job, err := jobobject.Attach(cmd.Process)
	if err != nil {
		cmd.Process.Kill()
		t.Fatalf("Attach: %v", err)
	}
	jobobject.Register(job, cmd.Process.Pid, o)
	t.Cleanup(func() {
		jobobject.Close(job)
		cmd.Process.Kill()
		cmd.Wait()
	})
	if _, err := stdin.Write([]byte("\n")); err != nil {
		t.Fatal(err)
	}
	tr := &testTree{owner: o, job: job, root: cmd.Process.Pid, ppid: map[int]int{}}
	lines := readLines(t, stdout, treeSize(kids))
	for _, line := range lines {
		var pid, ppid int
		if _, err := fmt.Sscanf(line, "%d %d", &pid, &ppid); err != nil {
			t.Fatalf("parsing %q: %v", line, err)
		}
		tr.ppid[pid] = ppid
	}
	return tr
}

func readLines(t testing.TB, r interface{ Read([]byte) (int, error) }, n int) []string {
	t.Helper()
	got := make(chan []string, 1)
	go func() {
		sc := bufio.NewScanner(r)
		var lines []string
		for len(lines) < n && sc.Scan() {
			lines = append(lines, sc.Text())
		}
		got <- lines
	}()
	select {
	case lines := <-got:
		if len(lines) < n {
			t.Fatalf("read %d of %d helper lines", len(lines), n)
		}
		return lines
	case <-time.After(waitTimeout):
		t.Fatalf("timed out waiting for %d helper lines", n)
	}
	return nil
}

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
	if ev, err := windows.WaitForSingleObject(h, uint32(waitTimeout.Milliseconds())); err != nil || ev != windows.WAIT_OBJECT_0 {
		t.Fatalf("pid %d did not exit: %d %v", pid, ev, err)
	}
}

func assertRunning(t *testing.T, what string, pids ...int) {
	t.Helper()
	for _, pid := range pids {
		if !isRunning(pid) {
			t.Fatalf("%s pid %d was terminated", what, pid)
		}
	}
}

func agentResolver(kind string) Resolver {
	return func(ctx context.Context, o jobobject.Owner) OwnerInfo {
		return OwnerInfo{Kind: kind, Label: o.Id, Agent: true}
	}
}

func blockOwner(t *testing.T) jobobject.Owner {
	return jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: "test-" + t.Name()}
}

func assertOutcome(t *testing.T, got wshrpc.ResMonKillRtnData, outcome string, killed int) {
	t.Helper()
	if got.Outcome != outcome || got.Killed != killed {
		t.Fatalf("result = %+v, want outcome %s killed %d", got, outcome, killed)
	}
	if outcome != wshrpc.ResMonKill_Failed && got.Error != "" {
		t.Fatalf("Error set for outcome %s: %q", outcome, got.Error)
	}
}

func TestKillTreeKillsSubtreeOnly(t *testing.T) {
	tr := startTree(t, blockOwner(t), "2,1")
	kids := tr.kidsOf(tr.root)
	target, sibling := kids[0], kids[1]
	grand, siblingGrand := tr.kidsOf(target)[0], tr.kidsOf(sibling)[0]

	got := Kill(context.Background(), agentResolver(wshrpc.ResMonOwner_AgentTab),
		wshrpc.CommandResMonKillData{OwnerId: tr.owner.Id, Pid: int32(target), Tree: true})
	assertOutcome(t, got, wshrpc.ResMonKill_Killed, 2)
	waitForExit(t, target)
	waitForExit(t, grand)
	assertRunning(t, "outside the subtree", tr.root, sibling, siblingGrand)
}

func TestKillCoreIsProtected(t *testing.T) {
	// pi's shape: a cmd.exe launcher whose one child is the agent
	tr := startTree(t, blockOwner(t), "1", "cmd.exe", "/c")
	agent := tr.kidsOf(tr.root)[0]
	kid := tr.kidsOf(agent)[0]
	resolve := agentResolver(wshrpc.ResMonOwner_RunWorker)

	for _, pid := range []int{tr.root, agent} {
		for _, tree := range []bool{false, true} {
			got := Kill(context.Background(), resolve, wshrpc.CommandResMonKillData{OwnerId: tr.owner.Id, Pid: int32(pid), Tree: tree})
			assertOutcome(t, got, wshrpc.ResMonKill_Protected, 0)
		}
	}
	assertRunning(t, "core or its child", tr.root, agent, kid)
}

func TestKillRefusesReadOnlyOwner(t *testing.T) {
	runOwner := jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: "test-run-readonly", Cmd: "Verify", Task: "3"}
	runTree := startTree(t, runOwner, "1")
	runKid := runTree.kidsOf(runTree.root)[0]
	ctx := context.Background()
	resolve := agentResolver(wshrpc.ResMonOwner_AgentTab)

	for _, pid := range []int{runTree.root, runKid} {
		got := Kill(ctx, resolve, wshrpc.CommandResMonKillData{OwnerId: runOwner.Id, Pid: int32(pid), Tree: true})
		assertOutcome(t, got, wshrpc.ResMonKill_Refused, 0)
	}
	assertOutcome(t, KillChildren(ctx, resolve, wshrpc.CommandResMonKillChildrenData{OwnerId: runOwner.Id}), wshrpc.ResMonKill_Refused, 0)
	assertRunning(t, "run command", runTree.root, runKid)

	// a block whose owner resolves read-only is refused the same way
	blockTree := startTree(t, blockOwner(t), "1")
	blockKid := blockTree.kidsOf(blockTree.root)[0]
	readOnly := agentResolver(wshrpc.ResMonOwner_RunCmd)
	assertOutcome(t, Kill(ctx, readOnly, wshrpc.CommandResMonKillData{OwnerId: blockTree.owner.Id, Pid: int32(blockKid)}), wshrpc.ResMonKill_Refused, 0)
	assertOutcome(t, KillChildren(ctx, readOnly, wshrpc.CommandResMonKillChildrenData{OwnerId: blockTree.owner.Id}), wshrpc.ResMonKill_Refused, 0)

	// an Arc pid: through the Arc group (no owner id) and through a killable agent's id
	self := int32(os.Getpid())
	assertOutcome(t, Kill(ctx, resolve, wshrpc.CommandResMonKillData{OwnerId: "", Pid: self, Tree: true}), wshrpc.ResMonKill_Refused, 0)
	assertOutcome(t, Kill(ctx, resolve, wshrpc.CommandResMonKillData{OwnerId: blockTree.owner.Id, Pid: self, Tree: true}), wshrpc.ResMonKill_Refused, 0)
	assertOutcome(t, KillChildren(ctx, resolve, wshrpc.CommandResMonKillChildrenData{OwnerId: ""}), wshrpc.ResMonKill_Refused, 0)
	assertRunning(t, "block", blockTree.root, blockKid)
}

func TestKillGone(t *testing.T) {
	tr := startTree(t, blockOwner(t), "1")
	kid := tr.kidsOf(tr.root)[0]
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, uint32(kid))
	if err != nil {
		t.Fatal(err)
	}
	windows.TerminateProcess(h, 1)
	windows.CloseHandle(h)
	waitForExit(t, kid)

	got := Kill(context.Background(), agentResolver(wshrpc.ResMonOwner_AgentTab),
		wshrpc.CommandResMonKillData{OwnerId: tr.owner.Id, Pid: int32(kid), Tree: true})
	assertOutcome(t, got, wshrpc.ResMonKill_Gone, 0)
	assertRunning(t, "root", tr.root)
}

func TestKillFailedCarriesOSText(t *testing.T) {
	tr := startTree(t, blockOwner(t), "0")
	locked := helperCmd("locked", "")
	stdin, err := locked.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := locked.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := locked.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		locked.Process.Kill()
		locked.Wait()
	})
	h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(locked.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	err = windows.AssignProcessToJobObject(windows.Handle(tr.job), h)
	windows.CloseHandle(h)
	if err != nil {
		t.Fatalf("AssignProcessToJobObject: %v", err)
	}
	stdin.Write([]byte("\n"))
	readLines(t, stdout, 1)

	got := Kill(context.Background(), agentResolver(wshrpc.ResMonOwner_AgentTab),
		wshrpc.CommandResMonKillData{OwnerId: tr.owner.Id, Pid: int32(locked.Process.Pid)})
	if got.Outcome != wshrpc.ResMonKill_Failed || got.Error == "" || strings.Contains(got.Error, "OpenProcess") {
		t.Fatalf("result = %+v, want failed with the bare OS text", got)
	}
	assertRunning(t, "locked", locked.Process.Pid)
}

func TestKillChildrenSparesCore(t *testing.T) {
	tr := startTree(t, blockOwner(t), "2,1", "cmd.exe", "/c")
	agent := tr.kidsOf(tr.root)[0]
	var others []int
	for pid := range tr.ppid {
		if pid != agent {
			others = append(others, pid)
		}
	}

	got := KillChildren(context.Background(), agentResolver(wshrpc.ResMonOwner_AgentTab),
		wshrpc.CommandResMonKillChildrenData{OwnerId: tr.owner.Id})
	assertOutcome(t, got, wshrpc.ResMonKill_Killed, len(others))
	for _, pid := range others {
		waitForExit(t, pid)
	}
	assertRunning(t, "core", tr.root, agent)
}

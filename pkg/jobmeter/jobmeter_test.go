// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmeter

import (
	"context"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/resmon"
)

const mb uint64 = 1 << 20

// shq single-quotes s the way claude code quotes the command it evals.
func shq(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

// evalScript is the -c script claude code starts a Bash-tool command with.
func evalScript(command string) string {
	return "source /c/snap.sh 2>/dev/null || true && eval " + shq(command) + " < /dev/null && pwd -P >| /c/cwd"
}

// heldWrapped is what the arc mod's hook runs a background command as (jobslot-core.ts heldInBackground), whose
// own quoting writes a single quote as close-quote, backslash, quote, open-quote.
func heldWrapped(wsh, command string) string {
	q := func(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }
	return q(wsh) + " jobslot --hold-parent -- " + q(command) + "; [ $? -ne 75 ] || exit 75\n" + command
}

// world is a scripted machine: its process table, argv and footprints are what a test says, and it counts what the
// meter reads.
type world struct {
	m      *meter
	parent map[int32]int32
	argv   map[int32][]string
	foot   map[int32]uint64
	agents []Agent

	beside map[string]string            // bash.exe -> the ps.exe beside it
	msys   map[string][]resmon.MsysProc // ps.exe -> its table

	argvReads map[int32]int
	psReads   map[string]int
}

func newWorld() *world {
	return &world{
		m:         newMeter(),
		parent:    map[int32]int32{1: 0},
		argv:      map[int32][]string{},
		foot:      map[int32]uint64{},
		argvReads: map[int32]int{},
		psReads:   map[string]int{},
	}
}

// spawn adds a process under parent with the argv it was started with.
func (w *world) spawn(pid, parent int32, argv ...string) {
	w.parent[pid] = parent
	if len(argv) > 0 {
		w.argv[pid] = argv
	}
}

func (w *world) kill(pids ...int32) {
	for _, p := range pids {
		delete(w.parent, p)
	}
}

func (w *world) hold(foot map[int32]uint64) {
	w.foot = foot
}

func (w *world) seams() seams {
	s := seams{
		argv: func(pid int32) []string {
			w.argvReads[pid]++
			return w.argv[pid]
		},
		footprint: func(pid int32) (uint64, bool) {
			n, ok := w.foot[pid]
			return n, ok
		},
	}
	if w.beside != nil {
		s.psBeside = func(bash string) string { return w.beside[bash] }
		s.msys = func(ps string) []resmon.MsysProc {
			w.psReads[ps]++
			return w.msys[ps]
		}
	}
	return s
}

func (w *world) poll() []Done {
	return w.m.step(memusage.NewTable(w.parent), w.agents, w.seams())
}

// agent 10 runs the block "blk"; a Bash-tool shell 20 runs under it with two descendants, 21 and 22
func shellWorld() *world {
	w := newWorld()
	w.agents = []Agent{{BlockId: "blk", Pid: 10}}
	w.spawn(10, 1)
	return w
}

func bashTool(command string) []string {
	return []string{`C:\Program Files\Git\bin\bash.exe`, "-c", evalScript(command)}
}

func wantDone(t *testing.T, got []Done, want ...Done) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("done = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("done[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestMeterReportsATreesLargestSumOnceAfterItLeaves(t *testing.T) {
	w := shellWorld()
	w.spawn(20, 10, bashTool("make build")...)
	w.spawn(21, 20)
	w.spawn(22, 21)
	for _, foot := range []map[int32]uint64{
		{20: 10 * mb, 21: 20 * mb, 22: 30 * mb},  // 60
		{20: 10 * mb, 21: 200 * mb, 22: 30 * mb}, // 240: the peak
		{20: 10 * mb, 21: 50 * mb, 22: 30 * mb},  // 90
	} {
		w.hold(foot)
		wantDone(t, w.poll())
	}
	w.kill(20, 21, 22)
	wantDone(t, w.poll(), Done{BlockId: "blk", Command: "make build", Peak: 240 * mb})
	wantDone(t, w.poll()) // reported once
}

func TestMeterMatchesALoginShellLikeBash(t *testing.T) {
	for _, argv := range [][]string{
		{`C:\Program Files\Git\bin\bash.exe`, "-c", evalScript("gradle build")},
		{"/bin/zsh", "-c", "-l", evalScript("gradle build")},
		{"/bin/bash", "-c", "-l", evalScript("gradle build")},
	} {
		w := shellWorld()
		w.spawn(20, 10, argv...)
		w.hold(map[int32]uint64{20: 700 * mb})
		wantDone(t, w.poll())
		w.kill(20)
		wantDone(t, w.poll(), Done{BlockId: "blk", Command: "gradle build", Peak: 700 * mb})
	}
}

func TestMeterReportsAHeldBackgroundCommandAsItsInnerCommand(t *testing.T) {
	for _, command := range []string{"make build", "npm run build -- --name 'a b'", "echo '; [ $? -ne 75 ] || exit 75\n' && make"} {
		w := shellWorld()
		w.spawn(20, 10, `C:\Program Files\Git\bin\bash.exe`, "-c", evalScript(heldWrapped(`C:\Users\u\.arc\bin\wsh.exe`, command)))
		w.hold(map[int32]uint64{20: 5 * mb})
		wantDone(t, w.poll())
		w.kill(20)
		wantDone(t, w.poll(), Done{BlockId: "blk", Command: command, Peak: 5 * mb})
	}
}

func TestMeterLeavesACommandThatOnlyLooksHeldAlone(t *testing.T) {
	for _, command := range []string{
		// a wrapper whose copy and original disagree
		"'/x/wsh' jobslot --hold-parent -- 'make a'; [ $? -ne 75 ] || exit 75\nmake b",
		// no tail
		"'/x/wsh' jobslot --hold-parent -- 'make a'",
		// the wsh word is not quoted
		"wsh jobslot --hold-parent -- 'make a'; [ $? -ne 75 ] || exit 75\nmake a",
	} {
		w := shellWorld()
		w.spawn(20, 10, bashTool(command)...)
		w.hold(map[int32]uint64{20: mb})
		w.poll()
		w.kill(20)
		wantDone(t, w.poll(), Done{BlockId: "blk", Command: command, Peak: mb})
	}
}

func TestMeterIgnoresWhatIsNotABashToolShellOfAnAgent(t *testing.T) {
	w := shellWorld()
	w.spawn(20, 10, `C:\Program Files\Git\bin\bash.exe`, "--login", "-i") // a shell, but not a Bash-tool command
	w.spawn(23, 10, "node", "server.js", "-c", "x")                       // -c, but no eval
	w.spawn(24, 10)                                                       // argv not readable
	w.spawn(11, 1)                                                        // a process that is not an agent...
	w.spawn(30, 11, bashTool("make build")...)                            // ...with a Bash-tool shell under it
	w.hold(map[int32]uint64{20: mb, 23: mb, 24: mb, 30: mb, 10: mb, 11: mb})
	wantDone(t, w.poll())
	wantDone(t, w.poll())
	w.kill(20, 23, 24, 30)
	wantDone(t, w.poll())
	if n := w.argvReads[30]; n != 0 {
		t.Errorf("read the argv of a child of a pid that is not an agent %d times", n)
	}
}

func TestMeterReportsNothingForACommandItNeverSampled(t *testing.T) {
	w := shellWorld()
	w.spawn(20, 10, bashTool("make build")...)
	w.hold(nil) // the shell was gone by the time its footprint was read
	wantDone(t, w.poll())
	w.kill(20)
	wantDone(t, w.poll())
}

func TestMeterTakesUpAShellItCouldNotReadTheFirstTime(t *testing.T) {
	w := shellWorld()
	w.spawn(20, 10) // just started: no argv yet
	w.hold(map[int32]uint64{20: 9 * mb})
	wantDone(t, w.poll())
	w.argv[20] = bashTool("make build")
	wantDone(t, w.poll())
	w.kill(20)
	wantDone(t, w.poll(), Done{BlockId: "blk", Command: "make build", Peak: 9 * mb})
}

func TestMeterCountsAShellWhoseParentIsNoLongerItsAgentAsGone(t *testing.T) {
	// pid 20 now belongs to someone else's child: the old command is over
	w := shellWorld()
	w.spawn(20, 10, bashTool("make build")...)
	w.hold(map[int32]uint64{20: 40 * mb})
	wantDone(t, w.poll())
	w.parent[20] = 77
	w.spawn(77, 1)
	wantDone(t, w.poll(), Done{BlockId: "blk", Command: "make build", Peak: 40 * mb})
	wantDone(t, w.poll())
}

func TestMeterKeepsMeasuringAShellWhoseAgentWentFirst(t *testing.T) {
	w := shellWorld()
	w.spawn(20, 10, bashTool("make build")...)
	w.hold(map[int32]uint64{20: 40 * mb})
	wantDone(t, w.poll())
	w.agents = nil // the agent is no longer listed; its shell still runs and still holds memory
	w.hold(map[int32]uint64{20: 90 * mb})
	wantDone(t, w.poll())
	w.kill(20)
	wantDone(t, w.poll(), Done{BlockId: "blk", Command: "make build", Peak: 90 * mb})
}

func TestMeterMeasuresEveryCommandOfEveryAgent(t *testing.T) {
	w := newWorld()
	w.agents = []Agent{{BlockId: "a", Pid: 10}, {BlockId: "b", Pid: 11}}
	w.spawn(10, 1)
	w.spawn(11, 1)
	w.spawn(20, 10, bashTool("make a")...)
	w.spawn(21, 10, bashTool("make b")...)
	w.spawn(30, 11, bashTool("make c")...)
	w.hold(map[int32]uint64{20: 1 * mb, 21: 2 * mb, 30: 3 * mb})
	wantDone(t, w.poll())
	w.kill(30, 20)
	wantDone(t, w.poll(),
		Done{BlockId: "a", Command: "make a", Peak: mb},
		Done{BlockId: "b", Command: "make c", Peak: 3 * mb})
	w.kill(21)
	wantDone(t, w.poll(), Done{BlockId: "a", Command: "make b", Peak: 2 * mb})
}

func TestMeterReadsEachProcessesArgvOnce(t *testing.T) {
	w := shellWorld()
	w.spawn(20, 10, bashTool("make build")...)
	w.spawn(23, 10, "node", "x.js")
	w.hold(map[int32]uint64{20: mb})
	for range 4 {
		w.poll()
	}
	if w.argvReads[20] != 1 || w.argvReads[23] != 1 {
		t.Errorf("argv reads = %v, want one each", w.argvReads)
	}
	// a pid that left the table and came back is a new process
	w.kill(23)
	w.poll()
	w.spawn(23, 10, "node", "y.js")
	w.poll()
	if w.argvReads[23] != 2 {
		t.Errorf("argv reads of a pid that left and came back = %d, want 2", w.argvReads[23])
	}
}

// Git Bash runs a task's real work outside the bash's Windows tree: its MSYS process groups tie it back.
func msysWorld() *world {
	w := shellWorld()
	const bin, usr = `C:\Git\bin\bash.exe`, `C:\Git\usr\bin\bash.exe`
	// bin\bash.exe is the launcher; its child, usr\bin\bash.exe, has a ps.exe beside it
	w.spawn(20, 10, bin, "-c", evalScript("make build"))
	w.spawn(21, 20, usr, "-c", "x")
	// the command's work: 40 > 41, whose windows parent (the exited fork) is gone
	w.spawn(40, 1)
	w.spawn(41, 40)
	w.beside = map[string]string{usr: `C:\Git\usr\bin\ps.exe`}
	w.msys = map[string][]resmon.MsysProc{
		`C:\Git\usr\bin\ps.exe`: {{Pid: 100, Pgid: 100, Winpid: 21}, {Pid: 101, Pgid: 100, Winpid: 40}, {Pid: 200, Pgid: 200, Winpid: 99}},
	}
	return w
}

func TestMeterAddsTheMsysGroupsTrees(t *testing.T) {
	w := msysWorld()
	w.hold(map[int32]uint64{20: 1 * mb, 21: 2 * mb, 40: 300 * mb, 41: 100 * mb, 99: 5000 * mb})
	wantDone(t, w.poll())
	w.kill(20, 21, 40, 41)
	// 1 + 2 from the shell's own tree, 300 + 100 from the group's member 40 and its child; never 99, another group's
	wantDone(t, w.poll(), Done{BlockId: "blk", Command: "make build", Peak: 403 * mb})
}

func TestMeterWithNoMsysSeamCountsTheWindowsTreeOnly(t *testing.T) {
	w := msysWorld()
	w.beside, w.msys = nil, nil
	w.hold(map[int32]uint64{20: 1 * mb, 21: 2 * mb, 40: 300 * mb, 41: 100 * mb})
	w.poll()
	w.kill(20, 21)
	wantDone(t, w.poll(), Done{BlockId: "blk", Command: "make build", Peak: 3 * mb})
}

func TestMeterReadsTheMsysTableOncePerPollForAllCommands(t *testing.T) {
	w := msysWorld()
	const usr = `C:\Git\usr\bin\bash.exe`
	w.spawn(25, 10, `C:\Git\bin\bash.exe`, "-c", evalScript("make test"))
	w.spawn(26, 25, usr, "-c", "y")
	w.hold(map[int32]uint64{20: mb, 21: mb, 25: mb, 26: mb, 40: mb, 41: mb})
	w.poll()
	w.poll()
	if got := w.psReads[`C:\Git\usr\bin\ps.exe`]; got != 2 {
		t.Errorf("ps -l ran %d times in 2 polls measuring 2 commands, want 2", got)
	}
}

func TestMeterReadsNoMsysTableWhileNothingIsMeasured(t *testing.T) {
	w := msysWorld()
	w.kill(20, 21, 40, 41)
	w.spawn(23, 10, "node", "x.js")
	w.poll()
	w.poll()
	if len(w.psReads) != 0 {
		t.Errorf("ps -l ran with no command measured: %v", w.psReads)
	}
}

func TestMeterReadsNoMsysTableWhenNoBashHasAPs(t *testing.T) {
	w := msysWorld()
	w.beside = map[string]string{} // no ps.exe beside any bash
	w.msys = map[string][]resmon.MsysProc{}
	w.hold(map[int32]uint64{20: mb, 21: mb})
	w.poll()
	w.poll()
	if len(w.psReads) != 0 {
		t.Errorf("ps -l ran with no ps.exe to run: %v", w.psReads)
	}
}

func TestMeterRunPollsUntilItsContextEnds(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var polls atomic.Int32
	done := make(chan struct{})
	go func() {
		defer close(done)
		Run(ctx, Config{
			Poll: 5 * time.Millisecond,
			Agents: func(memusage.Table) []Agent {
				if polls.Add(1) == 3 {
					cancel()
				}
				return nil
			},
		})
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not return after its context ended")
	}
	if polls.Load() < 3 {
		t.Fatalf("polled %d times", polls.Load())
	}
}

func TestMeterRunWithNoAgentsFuncOnlyWaits(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	Run(ctx, Config{Poll: 5 * time.Millisecond})
}

// liveShell starts a real Bash-tool-shaped shell as a child of this process running `sleep <secs>`, as claude code
// would start one under an agent. It skips where there is no shell for it.
func liveShell(t *testing.T, command string) *exec.Cmd {
	t.Helper()
	shell := "/bin/sh"
	if runtime.GOOS == "windows" {
		shell = filepath.Join(os.Getenv("ProgramFiles"), "Git", "bin", "bash.exe")
	}
	if _, err := os.Stat(shell); err != nil {
		t.Skip("no shell at", shell)
	}
	cmd := exec.Command(shell, "-c", "true && eval "+shq(command)+" < /dev/null && pwd -P")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cmd.Process.Kill()
		cmd.Wait()
	})
	return cmd
}

func TestMeterRunMeasuresALiveShellUntilItEnds(t *testing.T) {
	cmd := liveShell(t, "sleep 2")
	var mu sync.Mutex
	var got []Done
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go Run(ctx, Config{
		Poll:   50 * time.Millisecond,
		Agents: func(memusage.Table) []Agent { return []Agent{{BlockId: "blk", Pid: int32(os.Getpid())}} },
		OnDone: func(d Done) {
			mu.Lock()
			got = append(got, d)
			mu.Unlock()
		},
	})
	deadline := time.Now().Add(20 * time.Second)
	for {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the shell's command was never reported")
		}
		time.Sleep(20 * time.Millisecond)
	}
	cmd.Wait()
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || got[0].BlockId != "blk" || got[0].Command != "sleep 2" || got[0].Peak == 0 {
		t.Fatalf("done = %+v, want one {blk, sleep 2, a non-zero peak}", got)
	}
}

// TestMeasurePollCost reads what one poll costs on this machine, over its live process table with a Git Bash
// command being measured; the figures go into docs/open-issues.md "RAM watch". It is a measurement, not a check,
// and runs only on request:
//
//	ARC_MEASURE_JOBMETER=1 go test ./pkg/jobmeter -run TestMeasurePollCost -v -count=1
func TestMeasurePollCost(t *testing.T) {
	if os.Getenv("ARC_MEASURE_JOBMETER") != "1" {
		t.Skip("set ARC_MEASURE_JOBMETER=1 to measure what one poll costs")
	}
	// a command that forks its work, so on Windows the work sits outside the shell's tree, tied back by MSYS groups
	liveShell(t, "sleep 120 & wait")
	self, err := process.NewProcess(int32(os.Getpid()))
	if err != nil {
		t.Fatal(err)
	}
	cpu := func() time.Duration {
		ts, err := self.Times()
		if err != nil {
			t.Fatal(err)
		}
		return time.Duration((ts.User + ts.System) * float64(time.Second))
	}
	// what one call costs on average over n calls: wall time and this process's CPU time
	timed := func(n int, f func()) (wall, cpuTime time.Duration) {
		c0, w0 := cpu(), time.Now()
		for range n {
			f()
		}
		return time.Since(w0) / time.Duration(n), (cpu() - c0) / time.Duration(n)
	}

	pid := int32(os.Getpid())
	agents := []Agent{{BlockId: "blk", Pid: pid}}
	s := liveSeams(context.Background())
	m := newMeter()
	var table memusage.Table
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(50 * time.Millisecond) {
		if table, err = memusage.ReadTable(); err != nil {
			t.Fatal(err)
		}
		if len(table.Children(pid)) > 0 || time.Now().After(deadline) {
			break
		}
	}
	time.Sleep(500 * time.Millisecond) // let the shell start what it runs
	table, _ = memusage.ReadTable()
	coldStart := time.Now()
	m.step(table, agents, s)
	cold := time.Since(coldStart)
	if len(m.shells) != 1 {
		t.Fatalf("measuring %d commands, want 1", len(m.shells))
	}
	var sh *shell
	for _, x := range m.shells {
		sh = x
	}
	tree := m.treeOf(table, slices.Collect(maps.Keys(m.shells))[0], sh, s, map[string][]resmon.MsysProc{})

	const n = 50
	tableWall, tableCPU := timed(n, func() { memusage.ReadTable() })
	footWall, footCPU := timed(n, func() {
		for _, p := range tree {
			s.footprint(p)
		}
	})
	// the whole poll, counting the ps -l runs it makes
	liveMsys := s.msys
	var psRuns int
	var psInStep time.Duration
	if liveMsys != nil {
		s.msys = func(ps string) []resmon.MsysProc {
			start := time.Now()
			defer func() { psRuns++; psInStep += time.Since(start) }()
			return liveMsys(ps)
		}
	}
	stepWall, stepCPU := timed(n, func() {
		tb, _ := memusage.ReadTable()
		m.step(tb, agents, s)
	})

	// one ps -l the way the meter runs it (output read through a pipe), with the CPU time of that child process
	var psWall, psCPU time.Duration
	if sh.ps != "" {
		const runs = 20
		for range runs {
			start := time.Now()
			cmd := exec.Command(sh.ps, "-l")
			if _, err := cmd.Output(); err != nil {
				t.Fatal(err)
			}
			psWall += time.Since(start)
			psCPU += cmd.ProcessState.UserTime() + cmd.ProcessState.SystemTime()
		}
		psWall /= runs
		psCPU /= runs
	}
	t.Logf("processes in the table: %d; the measured command's tree: %d processes (the Windows tree plus MSYS group members); ps.exe: %q",
		len(table.Pids()), len(tree), sh.ps)
	t.Logf("first poll, argv reads included: %v wall", cold)
	t.Logf("table read:        %v wall, %v cpu", tableWall, tableCPU)
	t.Logf("footprints (%d):   %v wall, %v cpu", len(tree), footWall, footCPU)
	t.Logf("ps -l:             %v wall, %v cpu (a child process)", psWall, psCPU)
	t.Logf("ps -l runs in the %d polls: %d (%v wall each inside the poll)", n, psRuns, psInStep/time.Duration(max(psRuns, 1)))
	t.Logf("whole poll:        %v wall, %v cpu in wavesrv + %v cpu in ps.exe = %v per 2 s poll (%.2f%% of one core)",
		stepWall, stepCPU, psCPU, stepCPU+psCPU, 100*float64(stepCPU+psCPU)/float64(defaultPoll))
}

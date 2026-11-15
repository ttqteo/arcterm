// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentcpu

import (
	"fmt"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const sec = uint64(time.Second) // one core busy for one second, in the unit Times holds (nanoseconds)

// 10 is an agent that exec'd its command (bash, zsh): 11 and 12 its children, 13 a grandchild under 11, 14 another
// child. 20 is a fish or pwsh wrapper around the agent 21, with 22 and 23 the agent's commands. 99 is no agent's.
func cpuTable() memusage.Table {
	return memusage.NewTable(map[int32]int32{
		10: 1, 11: 10, 12: 10, 13: 11, 14: 10,
		20: 1, 21: 20, 22: 21, 23: 21,
		99: 1,
	})
}

var cpuRoots = map[string]int32{"blk-a": 10, "blk-b": 20}

func isShell20(pid int32) bool { return pid == 20 }

func commandNamed(pid int32) string { return fmt.Sprintf("cmd-%d", pid) }

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

// compute is Compute over the fixture: 8 cores, a 2 s wall, the two agents above
func compute(prev, cur Times) map[string]wshrpc.AgentCpuAgent {
	return computeWith(prev, cur, 2*time.Second, 8)
}

func computeWith(prev, cur Times, wall time.Duration, cores int) map[string]wshrpc.AgentCpuAgent {
	out := map[string]wshrpc.AgentCpuAgent{}
	for _, a := range Compute(prev, cur, wall, cores, cpuTable(), cpuRoots, isShell20, commandNamed) {
		out[a.BlockId] = a
	}
	return out
}

func TestComputeSumsTheTreeAndNamesTheBusiestDescendant(t *testing.T) {
	prev := Times{10: 100 * sec, 11: 50 * sec, 12: 7 * sec, 13: 9 * sec, 99: 1 * sec}
	// 4 core-seconds in 2 s over 8 cores is 25%; 99 burns far more but belongs to no agent
	cur := Times{10: 101 * sec, 11: 52 * sec, 12: 7 * sec, 13: 10 * sec, 99: 17 * sec}
	got := compute(prev, cur)
	a, ok := got["blk-a"]
	if !ok || !near(a.Cpu, 25) {
		t.Fatalf("blk-a = %+v, want Cpu 25: 4 core-seconds over 2 s on 8 cores", a)
	}
	if a.Top == nil || a.Top.Pid != 11 || !near(a.Top.Cpu, 12.5) || a.Top.Command != "cmd-11" {
		t.Fatalf("blk-a Top = %+v, want pid 11 at 12.5%% named cmd-11 (the agent's own pid 10 is never offered)", a.Top)
	}
}

func TestComputeSkipsTheShellWrapperForTop(t *testing.T) {
	// 20 is the shell that did not exec, 21 the agent: the sum counts all of them, Top only the agent's commands
	prev := Times{20: 10 * sec, 21: 10 * sec, 22: 10 * sec, 23: 10 * sec}
	cur := Times{20: 13 * sec, 21: 14 * sec, 22: 11 * sec, 23: 10*sec + sec/2}
	b := compute(prev, cur)["blk-b"]
	if want := 8.5 / 16 * 100; !near(b.Cpu, want) {
		t.Fatalf("blk-b Cpu = %v, want %v: the wrapper and the agent count in the agent's own total", b.Cpu, want)
	}
	if b.Top == nil || b.Top.Pid != 22 || !near(b.Top.Cpu, 1.0/16*100) {
		t.Fatalf("blk-b Top = %+v, want pid 22: neither the shell 20 nor the agent 21 is a command to stop", b.Top)
	}
}

func TestComputeAProcessBornMidIntervalCountsFromZero(t *testing.T) {
	prev := Times{10: 5 * sec, 11: 5 * sec}
	// 14 appeared after the last sample: its whole CPU time is not this interval's
	cur := Times{10: 5 * sec, 11: 6 * sec, 14: 400 * sec}
	a := compute(prev, cur)["blk-a"]
	if !near(a.Cpu, 1.0/16*100) {
		t.Fatalf("Cpu = %v, want 6.25: only 11's one second counts", a.Cpu)
	}
	if a.Top == nil || a.Top.Pid != 11 {
		t.Fatalf("Top = %+v, want 11: a process new since the last sample counts from 0, so 14 cannot lead", a.Top)
	}
}

func TestComputeAProcessGoneIsSkipped(t *testing.T) {
	// 12 and 13 had a time in the last sample and have none now (they exited, or could not be read): both are
	// skipped, never subtracted into a negative
	prev := Times{10: 5 * sec, 11: 5 * sec, 12: 90 * sec, 13: 90 * sec}
	cur := Times{10: 5 * sec, 11: 7 * sec}
	a := compute(prev, cur)["blk-a"]
	if !near(a.Cpu, 2.0/16*100) {
		t.Fatalf("Cpu = %v, want 12.5: 12 and 13 left the sample and add nothing", a.Cpu)
	}
	if a.Top == nil || a.Top.Pid != 11 {
		t.Fatalf("Top = %+v, want 11", a.Top)
	}
}

func TestComputeAReusedPidCountsFromZero(t *testing.T) {
	// 12's time went backwards: its pid was reused by a new process since the last sample
	prev := Times{12: 500 * sec}
	cur := Times{12: 3 * sec}
	a := compute(prev, cur)["blk-a"]
	if a.Cpu != 0 || a.Top != nil {
		t.Fatalf("got %+v, want nothing: a counter that ran backwards is a new process, not -497 s", a)
	}
}

func TestComputeScalesByCores(t *testing.T) {
	prev := Times{10: 0, 11: 0}
	cur := Times{10: 1 * sec, 11: 1 * sec}
	if a := computeWith(prev, cur, 2*time.Second, 8)["blk-a"]; !near(a.Cpu, 12.5) {
		t.Fatalf("8 cores: Cpu = %v, want 12.5", a.Cpu)
	}
	if a := computeWith(prev, cur, 2*time.Second, 4)["blk-a"]; !near(a.Cpu, 25) {
		t.Fatalf("4 cores: Cpu = %v, want 25: the same time is a bigger share of fewer cores", a.Cpu)
	}
	if a := computeWith(prev, cur, 1*time.Second, 8)["blk-a"]; !near(a.Cpu, 25) {
		t.Fatalf("1 s wall: Cpu = %v, want 25: the same time over a shorter wall", a.Cpu)
	}
}

func TestComputeNoCpuNoTop(t *testing.T) {
	prev := Times{10: 5 * sec, 11: 5 * sec, 21: 5 * sec}
	cur := Times{10: 5 * sec, 11: 5 * sec, 21: 5 * sec}
	got := compute(prev, cur)
	for _, id := range []string{"blk-a", "blk-b"} {
		a, ok := got[id]
		if !ok || a.Cpu != 0 || a.Top != nil {
			t.Fatalf("%s = %+v (listed %v), want Cpu 0 and no Top: nothing ran", id, a, ok)
		}
	}
}

func TestComputeClampsToTheWholeMachine(t *testing.T) {
	// a counter that ticks faster than the wall (a late sample, a coarse clock) must not report 400%
	prev := Times{10: 0, 11: 0, 13: 0, 12: 0}
	cur := Times{10: 20 * sec, 11: 20 * sec, 13: 20 * sec, 12: 20 * sec}
	a := compute(prev, cur)["blk-a"]
	if a.Cpu != 100 || a.Top == nil || a.Top.Cpu != 100 {
		t.Fatalf("got %+v top %+v, want both held at 100", a, a.Top)
	}
}

func TestComputeAnAgentThatIsNotRunningIsLeftOut(t *testing.T) {
	roots := map[string]int32{"blk-a": 10, "blk-gone": 4242}
	got := Compute(Times{10: 0}, Times{10: sec}, 2*time.Second, 8, cpuTable(), roots, isShell20, commandNamed)
	if len(got) != 1 || got[0].BlockId != "blk-a" {
		t.Fatalf("got %+v, want blk-a only: a root that is not in the table has no reading", got)
	}
}

func TestComputeListsAgentsByBlockId(t *testing.T) {
	roots := map[string]int32{"blk-z": 10, "blk-m": 20, "blk-a": 99}
	got := Compute(Times{}, Times{}, 2*time.Second, 8, cpuTable(), roots, isShell20, commandNamed)
	if len(got) != 3 || got[0].BlockId != "blk-a" || got[1].BlockId != "blk-m" || got[2].BlockId != "blk-z" {
		t.Fatalf("got %+v, want the block ids in order: a map's order must not reshuffle the answer", got)
	}
}

func TestComputeWithoutAWallReadsNothing(t *testing.T) {
	if got := Compute(Times{10: 0}, Times{10: sec}, 0, 8, cpuTable(), cpuRoots, isShell20, commandNamed); got != nil {
		t.Fatalf("a zero wall: got %+v, want nil", got)
	}
	if got := Compute(Times{10: 0}, Times{10: sec}, time.Second, 0, cpuTable(), cpuRoots, isShell20, commandNamed); got != nil {
		t.Fatalf("no cores: got %+v, want nil", got)
	}
}

func TestComputeAsksForACommandOnlyForTheTop(t *testing.T) {
	asked := map[int32]int{}
	command := func(pid int32) string { asked[pid]++; return "x" }
	prev := Times{10: 0, 11: 0, 12: 0, 13: 0}
	cur := Times{10: sec, 11: 2 * sec, 12: sec / 2, 13: sec}
	Compute(prev, cur, 2*time.Second, 8, cpuTable(), map[string]int32{"blk-a": 10}, isShell20, command)
	if len(asked) != 1 || asked[11] != 1 {
		t.Fatalf("command asked for %v, want pid 11 once: a command line read costs a call per process", asked)
	}
}

// fakeWorld is a process list and its CPU times that a test moves between ticks.
type fakeWorld struct {
	mu       sync.Mutex
	table    memusage.Table
	times    Times
	cmdReads map[int32]int
	timeCall int
}

func newWorld() *fakeWorld {
	return &fakeWorld{table: cpuTable(), times: Times{}, cmdReads: map[int32]int{}}
}

func (w *fakeWorld) set(times Times) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.times = times
}

func (w *fakeWorld) sources() sources {
	return sources{
		cores: 8,
		table: func() (memusage.Table, error) {
			w.mu.Lock()
			defer w.mu.Unlock()
			return w.table, nil
		},
		times: func(pids []int32) Times {
			w.mu.Lock()
			defer w.mu.Unlock()
			w.timeCall++
			out := Times{}
			for _, p := range pids {
				if v, ok := w.times[p]; ok {
					out[p] = v
				}
			}
			return out
		},
		command: func(pid int32) string {
			w.mu.Lock()
			defer w.mu.Unlock()
			w.cmdReads[pid]++
			return fmt.Sprintf("raw-%d", pid)
		},
	}
}

func TestTickIsNotReadyUntilASecondSampleGivesDeltas(t *testing.T) {
	w := newWorld()
	w.set(Times{10: 5 * sec, 11: 5 * sec})
	s := newSampler(w.sources(), time.Second, time.Minute)
	st := newTickState()
	t0 := time.Unix(1000, 0)

	data, ok := s.tick(st, cpuRoots, isShell20, t0)
	if !ok || data.Ready || len(data.Agents) != 0 {
		t.Fatalf("first tick = %+v ok %v, want a baseline only: no deltas yet", data, ok)
	}
	w.set(Times{10: 5 * sec, 11: 7 * sec})
	data, ok = s.tick(st, cpuRoots, isShell20, t0.Add(2*time.Second))
	if !ok || !data.Ready || len(data.Agents) != 2 {
		t.Fatalf("second tick = %+v ok %v, want ready with both agents", data, ok)
	}
	a := data.Agents[0]
	if a.BlockId != "blk-a" || !near(a.Cpu, 2.0/16*100) || a.Top == nil || a.Top.Pid != 11 || a.Top.Command != "raw-11" {
		t.Fatalf("blk-a = %+v top %+v, want 12.5%% with 11 as raw-11", a, a.Top)
	}
}

func TestTickKeepsTheBaselineWhenTheProcessListCannotBeRead(t *testing.T) {
	w := newWorld()
	w.set(Times{10: 0, 11: 0})
	src := w.sources()
	failing := false
	read := src.table
	src.table = func() (memusage.Table, error) {
		if failing {
			return memusage.Table{}, fmt.Errorf("busy")
		}
		return read()
	}
	s := newSampler(src, time.Second, time.Minute)
	st := newTickState()
	t0 := time.Unix(1000, 0)
	s.tick(st, cpuRoots, isShell20, t0)

	failing = true
	w.set(Times{10: 0, 11: 2 * sec})
	if _, ok := s.tick(st, cpuRoots, isShell20, t0.Add(2*time.Second)); ok {
		t.Fatal("a failed process list read must give no reading")
	}
	failing = false
	w.set(Times{10: 0, 11: 4 * sec})
	data, ok := s.tick(st, cpuRoots, isShell20, t0.Add(4*time.Second))
	if !ok || !data.Ready || !near(data.Agents[0].Cpu, 4.0/(4*8)*100) {
		t.Fatalf("got %+v ok %v, want 4 core-seconds over the 4 s since the last good sample (12.5%%)", data, ok)
	}
}

func TestTickReadsACommandLineOncePerProcess(t *testing.T) {
	w := newWorld()
	s := newSampler(w.sources(), time.Second, time.Minute)
	st := newTickState()
	t0 := time.Unix(1000, 0)
	for i := range 4 {
		w.set(Times{10: uint64(i) * sec, 11: uint64(i) * 2 * sec})
		s.tick(st, map[string]int32{"blk-a": 10}, isShell20, t0.Add(time.Duration(i)*2*time.Second))
	}
	if n := w.cmdReads[11]; n != 1 {
		t.Fatalf("pid 11 command line read %d times over 3 ready ticks, want 1: it is cached while the process lives", n)
	}
}

func TestTickForgetsACommandWhenItsProcessIsGone(t *testing.T) {
	w := newWorld()
	s := newSampler(w.sources(), time.Second, time.Minute)
	st := newTickState()
	roots := map[string]int32{"blk-a": 10}
	t0 := time.Unix(1000, 0)
	w.set(Times{10: 0, 11: 0})
	s.tick(st, roots, isShell20, t0)
	w.set(Times{10: 0, 11: 2 * sec})
	s.tick(st, roots, isShell20, t0.Add(2*time.Second))
	// 11 exits; its pid is reused by another process before it is the busiest again
	w.set(Times{10: 0})
	s.tick(st, roots, isShell20, t0.Add(4*time.Second))
	w.set(Times{10: 0, 11: 0})
	s.tick(st, roots, isShell20, t0.Add(6*time.Second))
	w.set(Times{10: 0, 11: 2 * sec})
	s.tick(st, roots, isShell20, t0.Add(8*time.Second))
	if n := w.cmdReads[11]; n != 2 {
		t.Fatalf("pid 11 command line read %d times, want 2: the cache entry of a process that left is dropped", n)
	}
}

func TestSamplerRunsOnlyWhileAskedAndStopsWhenIdle(t *testing.T) {
	w := newWorld()
	w.set(Times{10: 0, 11: 0})
	// a process whose time advances on every read, so each tick sees a delta
	src := w.sources()
	advance := src.times
	src.times = func(pids []int32) Times {
		out := advance(pids)
		w.mu.Lock()
		n := uint64(w.timeCall)
		w.mu.Unlock()
		for _, p := range pids {
			if p == 11 {
				out[p] = n * sec
			}
		}
		return out
	}
	s := newSampler(src, 5*time.Millisecond, 60*time.Millisecond)

	first := s.Read(map[string]int32{"blk-a": 10}, isShell20)
	if !first.Supported || first.Ready || first.Agents == nil || len(first.Agents) != 0 {
		t.Fatalf("first read = %+v, want supported, not ready, an empty list and not null", first)
	}
	var ready wshrpc.AgentCpuData
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ready = s.Read(map[string]int32{"blk-a": 10}, isShell20); ready.Ready && len(ready.Agents) == 1 {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	if !ready.Ready || len(ready.Agents) != 1 || ready.Agents[0].Cpu <= 0 {
		t.Fatalf("never became ready with a reading: %+v", ready)
	}
	// an agent that left the roster is not in the next answer even before a tick drops it
	if got := s.Read(map[string]int32{"blk-other": 20}, isShell20); len(got.Agents) != 0 {
		t.Fatalf("read for another roster = %+v, want no agents of the old one", got)
	}

	// nobody asks any more: the loop stops, and the next read starts it afresh with no stale figures
	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && s.isRunning() {
		time.Sleep(5 * time.Millisecond)
	}
	if s.isRunning() {
		t.Fatal("the sampler kept running with no read for longer than its idle limit")
	}
	if again := s.Read(map[string]int32{"blk-a": 10}, isShell20); again.Ready {
		t.Fatalf("read after a stop = %+v, want not ready: the old baseline is gone", again)
	}
}

func TestReadIsUnsupportedWithoutASampler(t *testing.T) {
	w := newWorld()
	s := newSampler(w.sources(), time.Millisecond, time.Minute)
	got := readVia(false, s, cpuRoots, isShell20)
	if got.Supported || got.Ready || got.Agents == nil || len(got.Agents) != 0 {
		t.Fatalf("got %+v, want unsupported with an empty list", got)
	}
	if s.isRunning() {
		t.Fatal("a platform with no sampler must start no goroutine")
	}
	if w.timeCall != 0 {
		t.Fatalf("read CPU times %d times on a platform with no sampler", w.timeCall)
	}
}

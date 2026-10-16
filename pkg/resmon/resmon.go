// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"cmp"
	"context"
	"log"
	"os"
	"runtime"
	"slices"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	// BenchmarkSample: one tick over 10 jobs of 4 processes plus the Arc group costs 14 to 21 ms of CPU
	// (i5-12400, ~480 processes on the machine), 0.7% to 1% of one core at this interval, and only while the
	// frontend polls. Nearly all of it is the toolhelp snapshot, which scales with the machine's process
	// count, not with the jobs.
	sampleInterval = 2 * time.Second
	idleStop       = 10 * time.Second // the sampler stops when no Snapshot call came for this long
	// resolving an agent tab scans every run row (~85 ms on a 1,500-run store), so a snapshot reuses an owner's
	// info for this long; a job never changes owner, only a tab rename waits on it
	ownerInfoTTL = 30 * time.Second
)

// OwnerInfo is what the server knows about an owner that the registry does not.
type OwnerInfo struct {
	Kind    string // wshrpc.ResMonOwner_*
	Label   string
	Runtime string // claude | pi | ""
	Agent   bool   // the block's tab has session:agent: decides the core rule
}

type Resolver func(ctx context.Context, o jobobject.Owner) OwnerInfo

type procStat struct {
	ok       bool
	createTs int64  // epoch ms
	cpuTime  uint64 // kernel + user, 100ns units
	mem      int64  // working set bytes; -1 if unavailable
}

// procId names a process across pid reuse.
type procId struct {
	pid      int
	createTs int64
}

type rootKey struct {
	owner   jobobject.Owner
	rootPid int
}

// sample is one tick's raw result; Snapshot groups it with the resolver's owner info.
type sample struct {
	ts       int64
	ready    bool
	procs    map[int]proc // tracked pids only: job members and the Arc group
	arcRows  []treeRow
	jobs     []jobobject.LiveJob
	rootTs   map[rootKey]int64
	totalMem int64
	busyCpu  bool
	busyMem  bool
	hostPid  int
	selfPid  int
}

// tickState is owned by one sampler goroutine: CPU-time marks for deltas, the command-line cache, the
// roots' first-seen create times and the busy counter.
type tickState struct {
	hostPid  int
	selfPid  int
	cores    int
	lastWall time.Time
	cpuMarks map[procId]uint64 // cpu time in 100ns units at lastWall
	cmdlines map[procId]string
	rootTs   map[rootKey]int64
	busy     busyState
}

func newTickState() *tickState {
	return &tickState{
		hostPid:  os.Getppid(),
		selfPid:  os.Getpid(),
		cores:    runtime.NumCPU(),
		cpuMarks: map[procId]uint64{},
		cmdlines: map[procId]string{},
		rootTs:   map[rootKey]int64{},
	}
}

// tick takes one sample: one process table read, the live jobs, then times, memory and create time for the
// tracked pids only.
func (st *tickState) tick() *sample {
	now := time.Now()
	table, err := readTable()
	if err != nil {
		log.Printf("resmon: reading the process table: %v", err)
		table = map[int]proc{}
	}
	jobs := jobobject.LiveJobs()
	inJob := map[int]bool{}
	for _, j := range jobs {
		for _, m := range j.Members {
			inJob[m] = true
		}
	}
	stats := map[int]procStat{}
	stat := func(pid int) procStat {
		s, ok := stats[pid]
		if !ok {
			s = readStat(pid)
			stats[pid] = s
		}
		return s
	}
	arcRows := arcTree(table, st.hostPid, st.selfPid, inJob, func(pid int) int64 { return stat(pid).createTs })

	tracked := make(map[int]bool, len(inJob)+len(arcRows))
	for pid := range inJob {
		tracked[pid] = true
	}
	for _, r := range arcRows {
		tracked[r.Pid] = true
	}
	wallDelta := now.Sub(st.lastWall)
	ready := !st.lastWall.IsZero()
	marks := make(map[procId]uint64, len(tracked))
	cmdlines := make(map[procId]string, len(tracked))
	procs := make(map[int]proc, len(tracked))
	for pid := range tracked {
		p, ok := table[pid]
		if !ok {
			continue // exited since the membership read
		}
		s := stat(pid)
		p.CreateTs, p.Cpu, p.Mem = s.createTs, -1, -1
		if s.ok {
			id := procId{pid, s.createTs}
			p.Mem = s.mem
			p.Cpu = 0
			if prev, seen := st.cpuMarks[id]; seen && ready && wallDelta > 0 && s.cpuTime >= prev {
				p.Cpu = float64(s.cpuTime-prev) * 100 / float64(wallDelta/100) / float64(st.cores)
			}
			marks[id] = s.cpuTime
			cmd, cached := st.cmdlines[id]
			if !cached {
				cmd = readCmdline(pid)
			}
			cmdlines[id] = cmd
			p.Command = cmd
		}
		procs[pid] = p
	}
	st.cpuMarks, st.cmdlines, st.lastWall = marks, cmdlines, now

	rootTs := make(map[rootKey]int64, len(jobs))
	for _, j := range jobs {
		k := rootKey{j.Owner, j.RootPid}
		ts, ok := st.rootTs[k]
		if !ok || ts == 0 {
			ts = procs[j.RootPid].CreateTs
		}
		rootTs[k] = ts
	}
	st.rootTs = rootTs
	slices.SortFunc(jobs, func(a, b jobobject.LiveJob) int {
		return cmp.Or(cmp.Compare(rootTs[rootKey{a.Owner, a.RootPid}], rootTs[rootKey{b.Owner, b.RootPid}]), cmp.Compare(a.RootPid, b.RootPid))
	})

	var totalMem int64
	if vm, err := mem.VirtualMemory(); err == nil {
		totalMem = int64(vm.Total)
	}
	s := &sample{
		ts: now.UnixMilli(), ready: ready, procs: procs, arcRows: arcRows, jobs: jobs, rootTs: rootTs,
		totalMem: totalMem, hostPid: st.hostPid, selfPid: st.selfPid,
	}
	// busy counts every group, so it groups without labels: owner info changes no total
	cpu, memUsed := sumTotals(buildGroups(procs, arcRows, s.jobViews(nil), st.hostPid, st.selfPid))
	s.busyCpu, s.busyMem = st.busy.observe(cpu, memUsed, totalMem)
	return s
}

func (s *sample) jobViews(info func(o jobobject.Owner) OwnerInfo) []jobView {
	views := make([]jobView, 0, len(s.jobs))
	for _, j := range s.jobs {
		v := jobView{Job: j, RootTs: s.rootTs[rootKey{j.Owner, j.RootPid}]}
		if info != nil {
			v.Info = info(j.Owner)
		}
		views = append(views, v)
	}
	return views
}

var sampler = struct {
	mu       sync.Mutex
	running  bool
	lastCall time.Time
	latest   *sample
}{}

func samplerLoop() {
	st := newTickState()
	t := time.NewTicker(sampleInterval)
	defer t.Stop()
	for {
		s := st.tick()
		sampler.mu.Lock()
		sampler.latest = s
		sampler.mu.Unlock()
		<-t.C
		sampler.mu.Lock()
		if time.Since(sampler.lastCall) > idleStop {
			sampler.running, sampler.latest = false, nil
			sampler.mu.Unlock()
			return
		}
		sampler.mu.Unlock()
	}
}

// latestSample marks a Snapshot call, starts the sampler if it is stopped, and returns its latest sample
// (nil before the first tick).
func latestSample() *sample {
	sampler.mu.Lock()
	defer sampler.mu.Unlock()
	sampler.lastCall = time.Now()
	if !sampler.running {
		sampler.running = true
		go samplerLoop()
	}
	return sampler.latest
}

type ownerEntry struct {
	info OwnerInfo
	at   time.Time
}

type ownerCache struct {
	mu      sync.Mutex
	entries map[jobobject.Owner]ownerEntry
}

func newOwnerCache() *ownerCache {
	return &ownerCache{entries: map[jobobject.Owner]ownerEntry{}}
}

var snapshotOwners = newOwnerCache()

// resolveAll resolves each job's owner at most once per ownerInfoTTL and forgets owners whose jobs have ended.
func (c *ownerCache) resolveAll(ctx context.Context, resolve Resolver, jobs []jobobject.LiveJob, now time.Time) map[jobobject.Owner]OwnerInfo {
	c.mu.Lock()
	defer c.mu.Unlock()
	next := make(map[jobobject.Owner]ownerEntry, len(jobs))
	rtn := make(map[jobobject.Owner]OwnerInfo, len(jobs))
	for _, j := range jobs {
		if _, done := next[j.Owner]; done {
			continue
		}
		e, ok := c.entries[j.Owner]
		if !ok || now.Sub(e.at) >= ownerInfoTTL {
			e = ownerEntry{info: resolve(ctx, j.Owner), at: now}
		}
		next[j.Owner] = e
		rtn[j.Owner] = e.info
	}
	c.entries = next
	return rtn
}

// Snapshot returns the latest sample grouped by owner; Ready is false until a second tick gives CPU deltas.
func Snapshot(ctx context.Context, resolve Resolver) wshrpc.ResMonSnapshotData {
	if !supported {
		return wshrpc.ResMonSnapshotData{Groups: []wshrpc.ResMonGroup{}}
	}
	s := latestSample()
	if s == nil {
		return wshrpc.ResMonSnapshotData{Supported: true, Ts: time.Now().UnixMilli(), Groups: []wshrpc.ResMonGroup{}}
	}
	owners := snapshotOwners.resolveAll(ctx, resolve, s.jobs, time.Now())
	groups := buildGroups(s.procs, s.arcRows, s.jobViews(func(o jobobject.Owner) OwnerInfo { return owners[o] }), s.hostPid, s.selfPid)
	cpu, memUsed := sumTotals(groups)
	return wshrpc.ResMonSnapshotData{
		Supported: true,
		Ready:     s.ready,
		Ts:        s.ts,
		Cpu:       cpu,
		Mem:       memUsed,
		TotalMem:  s.totalMem,
		BusyCpu:   s.busyCpu,
		BusyMem:   s.busyMem,
		Groups:    groups,
	}
}

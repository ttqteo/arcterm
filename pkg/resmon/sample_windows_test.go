//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"unsafe"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"golang.org/x/sys/windows"
)

const (
	benchJobs = 10
	benchKids = "3" // a root and three kids: four long-lived processes per job
)

// BenchmarkSample measures one sampler tick over 10 registered jobs; the result is recorded on sampleInterval.
func BenchmarkSample(b *testing.B) {
	for i := range benchJobs {
		startTree(b, jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: fmt.Sprintf("bench-%d", i)}, benchKids)
	}
	st := newTickState()
	if s := st.tick(); len(s.jobs) < benchJobs {
		b.Fatalf("tick saw %d jobs, want %d", len(s.jobs), benchJobs)
	}
	// wall time includes waits in the kernel; the CPU this process spends is what costs a core
	before := readStat(os.Getpid()).cpuTime
	b.ResetTimer()
	for range b.N {
		st.tick()
	}
	b.StopTimer()
	cpuMs := float64(readStat(os.Getpid()).cpuTime-before) / 1e4 / float64(b.N)
	b.ReportMetric(cpuMs, "cpu-ms/tick")
	b.ReportMetric(cpuMs/float64(sampleInterval.Milliseconds())*100, "%core")
}

// listenLocal opens a TCP listener on a free loopback port and returns the port.
func listenLocal(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	return ln.Addr().(*net.TCPAddr).Port
}

func TestReadListenPortsSeesOwnListener(t *testing.T) {
	port := listenLocal(t)
	if got := readListenPorts()[os.Getpid()]; !slices.Contains(got, port) {
		t.Fatalf("ports for pid %d = %v, want %d among them", os.Getpid(), got, port)
	}
}

// one port listened on over both v4 and v6 is one entry; several ports come back sorted
func TestReadListenPortsSortsAndDedupes(t *testing.T) {
	v4, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer v4.Close()
	port := v4.Addr().(*net.TCPAddr).Port
	// a host without a v6 loopback still checks the v4 listener on its own
	if v6, err := net.Listen("tcp6", fmt.Sprintf("[::1]:%d", port)); err == nil {
		defer v6.Close()
	} else {
		t.Logf("no v6 listener on port %d, checking v4 alone: %v", port, err)
	}
	other := listenLocal(t)
	got := readListenPorts()[os.Getpid()]
	if !slices.IsSorted(got) {
		t.Fatalf("ports for pid %d = %v, want them sorted", os.Getpid(), got)
	}
	if n := slices.Index(got, port); n < 0 || slices.Index(got[n+1:], port) >= 0 {
		t.Fatalf("ports for pid %d = %v, want %d exactly once", os.Getpid(), got, port)
	}
	if !slices.Contains(got, other) {
		t.Fatalf("ports for pid %d = %v, want %d among them", os.Getpid(), got, other)
	}
}

// a tick carries a tracked process's command line and listening ports onto its row, the way the snapshot reads
// them: the two things a terminal's status line is made of
func TestTickPutsCommandAndPortsOnRows(t *testing.T) {
	port := listenLocal(t)
	s := newTickState().tick()
	self := os.Getpid()
	if !slices.Contains(s.procs[self].Ports, port) {
		t.Fatalf("sampled ports for pid %d = %v, want %d among them", self, s.procs[self].Ports, port)
	}
	if want := os.Args[0]; !strings.Contains(s.procs[self].Command, filepath.Base(want)) {
		t.Fatalf("sampled command for pid %d = %q, want it to name %q", self, s.procs[self].Command, filepath.Base(want))
	}
	var found bool
	for _, g := range buildGroups(s.procs, s.arcRows, nil, s.hostPid, s.selfPid) {
		for _, r := range g.Rows {
			if int(r.Pid) == self {
				found = true
				if !slices.Contains(r.Ports, port) {
					t.Fatalf("row ports for pid %d = %v, want %d among them", self, r.Ports, port)
				}
				if r.Command != s.procs[self].Command {
					t.Fatalf("row command for pid %d = %q, want %q", self, r.Command, s.procs[self].Command)
				}
			}
		}
	}
	if !found {
		t.Fatalf("no row for pid %d", self)
	}
}

// A row's memory is the private working set, the Consumers panel's and Task Manager's figure: it grows by what
// the process touches and stays under the whole working set, which also counts the DLL pages every process shares.
func TestReadStatMemIsThePrivateWorkingSet(t *testing.T) {
	self := os.Getpid()
	before := readStat(self)
	if !before.ok || before.mem < 0 {
		t.Fatalf("readStat(self) = %+v, want its memory read", before)
	}
	// fresh pages from the OS: a Go slice can land on heap an earlier run (-count) already touched, and not grow
	const held = 64 << 20
	addr, err := windows.VirtualAlloc(0, held, windows.MEM_COMMIT|windows.MEM_RESERVE, windows.PAGE_READWRITE)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.VirtualFree(addr, 0, windows.MEM_RELEASE)
	// the pages are outside Go's heap, so reading the address back as a pointer is safe
	buf := unsafe.Slice(*(**byte)(unsafe.Pointer(&addr)), held)
	for i := 0; i < len(buf); i += 4096 {
		buf[i] = 1
	}
	after := readStat(self)
	if after.mem < before.mem+held*9/10 {
		t.Errorf("mem grew %d MB holding 64 MB", (after.mem-before.mem)>>20)
	}
	p, err := process.NewProcess(int32(self))
	if err != nil {
		t.Fatal(err)
	}
	m, err := p.MemoryInfo()
	if err != nil {
		t.Fatal(err)
	}
	// a Go test binary shares ~8 MB of system DLL pages (ntdll, kernel32…); the whole working set read a hair apart
	// from mem lands within a few hundred KB of it
	const sharedFloor = 4 << 20
	if uint64(after.mem)+sharedFloor > m.RSS {
		t.Errorf("mem %d KB is within 4 MB of the whole working set %d KB: the shared pages are counted", after.mem>>10, m.RSS>>10)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package memusage

import (
	"os"
	"runtime"
	"testing"

	"github.com/shirou/gopsutil/v4/process"
)

// A job's figure is the private bytes, the commit: it grows by what this process allocates and touches, and it is
// the figure the queue's admission reads the machine's commit charge against, so a working set Windows trimmed under
// pressure cannot make a peak read low. The Consumers panel keeps the private working set.
func TestJobFootprintIsThePrivateBytes(t *testing.T) {
	pid := int32(os.Getpid())
	before, ok := JobFootprint(pid)
	if !ok || before == 0 {
		t.Fatalf("job footprint of this process = %d, %v", before, ok)
	}
	const held = 64 << 20
	buf := make([]byte, held)
	for i := 0; i < len(buf); i += 4096 {
		buf[i] = 1
	}
	after, ok := JobFootprint(pid)
	if !ok {
		t.Fatal("job footprint of this process could not be read")
	}
	if after < before+held*9/10 {
		t.Errorf("job footprint grew %d MB holding 64 MB", (after-before)>>20)
	}
	runtime.KeepAlive(buf)
	// private bytes count every committed private page, resident or not, so they are never under the private working set
	if foot, ok := footprint(pid); !ok || after < foot {
		t.Errorf("private bytes %d MB are under the private working set %d MB", after>>20, foot>>20)
	}
}

// The figure is the private working set: it grows by the memory this process touches and stays under the whole
// working set, which also counts the pages it shares with other processes.
func TestFootprintIsThePrivateWorkingSet(t *testing.T) {
	pid := int32(os.Getpid())
	before, ok := footprint(pid)
	if !ok {
		t.Fatal("footprint of this process could not be read")
	}
	const held = 64 << 20
	buf := make([]byte, held)
	for i := 0; i < len(buf); i += 4096 {
		buf[i] = 1
	}
	after, ok := footprint(pid)
	if !ok {
		t.Fatal("footprint of this process could not be read")
	}
	if after < before+held*9/10 {
		t.Errorf("footprint grew %d MB holding 64 MB", (after-before)>>20)
	}
	p, err := process.NewProcess(pid)
	if err != nil {
		t.Fatal(err)
	}
	m, err := p.MemoryInfo()
	if err != nil {
		t.Fatal(err)
	}
	if after > m.RSS {
		t.Errorf("private working set %d MB is over the working set %d MB", after>>20, m.RSS>>20)
	}
	runtime.KeepAlive(buf)
	if _, ok := footprint(-1); ok {
		t.Error("footprint read a pid that does not exist")
	}
}

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

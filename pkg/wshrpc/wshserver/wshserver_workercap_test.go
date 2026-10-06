// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"testing"

	"github.com/shirou/gopsutil/v4/mem"
)

func stubVirtualMemory(t *testing.T, vm *mem.VirtualMemoryStat, err error) {
	t.Helper()
	prev := virtualMemory
	virtualMemory = func(context.Context) (*mem.VirtualMemoryStat, error) { return vm, err }
	t.Cleanup(func() { virtualMemory = prev })
}

func TestWorkerCapacityMapsTheReading(t *testing.T) {
	stubVirtualMemory(t, &mem.VirtualMemoryStat{Total: 8 << 30, Available: 3 << 30}, nil)
	rtn, err := (&WshServer{}).GetWorkerCapacityCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rtn.TotalBytes != 8<<30 || rtn.AvailableBytes != 3<<30 || rtn.PerWorkerBytes == 0 {
		t.Fatalf("got %+v, want the OS reading passed through and a nonzero estimate", rtn)
	}
	// the tracker is process-wide, so the expected count is derived from what came back
	want := 0
	if rtn.AvailableBytes > rtn.ReserveBytes {
		want = int((rtn.AvailableBytes - rtn.ReserveBytes) / rtn.PerWorkerBytes)
	}
	if rtn.MoreWorkers != want {
		t.Fatalf("MoreWorkers = %d, want %d from %+v", rtn.MoreWorkers, want, rtn)
	}
}

func TestWorkerCapacityReportsAMemoryReadError(t *testing.T) {
	stubVirtualMemory(t, nil, errors.New("host_statistics failed"))
	if _, err := (&WshServer{}).GetWorkerCapacityCommand(context.Background()); err == nil {
		t.Fatal("a failed memory read is an error, not a zero reading")
	}
}

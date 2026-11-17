//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

// POWER_INFORMATION_LEVEL SystemExecutionState
const awakeTestSystemExecutionState = 16

var awakeTestCallNtPowerInformation = windows.NewLazySystemDLL("powrprof.dll").NewProc("CallNtPowerInformation")

func awakeTestExecutionState(t *testing.T) uint32 {
	t.Helper()
	var state uint32
	r, _, _ := awakeTestCallNtPowerInformation.Call(awakeTestSystemExecutionState, 0, 0,
		uintptr(unsafe.Pointer(&state)), unsafe.Sizeof(state))
	if r != 0 {
		t.Fatalf("CallNtPowerInformation: NTSTATUS %#x", r)
	}
	return state
}

// clearing is not asserted: any other app (a video player, a download) may hold ES_SYSTEM_REQUIRED
// system-wide, so its absence after release cannot be relied on.
func TestKeepAwakeSetsSystemRequired(t *testing.T) {
	release := KeepAwake()
	if state := awakeTestExecutionState(t); state&awakeEsSystemRequired == 0 {
		release()
		t.Fatalf("execution state %#x lacks ES_SYSTEM_REQUIRED while kept awake", state)
	}
	release()
	release()
}

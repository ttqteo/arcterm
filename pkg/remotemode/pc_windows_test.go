//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"testing"
	"unsafe"
)

// Nothing here locks the screen or presses a key: it resolves the procs and checks what would be sent.

func TestPCWindowsProcsResolve(t *testing.T) {
	for _, proc := range []struct {
		name string
		find func() error
	}{
		{"LockWorkStation", pcLockWorkStation.Find},
		{"SendInput", pcSendInput.Find},
	} {
		if err := proc.find(); err != nil {
			t.Errorf("user32.dll %s does not resolve: %v", proc.name, err)
		}
	}
}

// SendInput refuses a cbSize that is not sizeof(INPUT), and reads KEYBDINPUT at fixed offsets. The numbers are
// what the Windows SDK headers give (checked with a C program built against mingw's windows.h).
func TestPCWindowsInputLayout(t *testing.T) {
	var in pcInput
	size, kiOffset := uintptr(40), uintptr(8)
	kiSize, extraOffset := uintptr(24), uintptr(16)
	if unsafe.Sizeof(uintptr(0)) == 4 {
		size, kiOffset, kiSize, extraOffset = 28, 4, 16, 12
	}
	if got := unsafe.Sizeof(in); got != size {
		t.Errorf("sizeof(pcInput) = %d, want sizeof(INPUT) = %d", got, size)
	}
	if got := unsafe.Offsetof(in.inputType); got != 0 {
		t.Errorf("offsetof(type) = %d, want 0", got)
	}
	if got := unsafe.Offsetof(in.ki); got != kiOffset {
		t.Errorf("offsetof(ki) = %d, want %d", got, kiOffset)
	}
	if got := unsafe.Sizeof(in.ki); got != kiSize {
		t.Errorf("sizeof(KEYBDINPUT) = %d, want %d", got, kiSize)
	}
	for _, field := range []struct {
		name      string
		got, want uintptr
	}{
		{"wVk", unsafe.Offsetof(in.ki.vk), 0},
		{"wScan", unsafe.Offsetof(in.ki.scan), 2},
		{"dwFlags", unsafe.Offsetof(in.ki.flags), 4},
		{"time", unsafe.Offsetof(in.ki.time), 8},
		{"dwExtraInfo", unsafe.Offsetof(in.ki.extraInfo), extraOffset},
	} {
		if field.got != field.want {
			t.Errorf("offsetof(KEYBDINPUT.%s) = %d, want %d", field.name, field.got, field.want)
		}
	}
}

// Each step maps to the key code of the keyboard's volume key, and a step the page has no button for maps to none.
func TestPCWindowsVolumeKeys(t *testing.T) {
	want := map[string]uint16{"down": 0xAE, "mute": 0xAD, "up": 0xAF}
	for _, step := range pcVolumeSteps {
		if got, ok := pcVolumeKeys[step]; !ok || got != want[step] {
			t.Errorf("pcVolumeKeys[%q] = %#x, %v; want %#x", step, got, ok, want[step])
		}
	}
	if len(pcVolumeKeys) != len(pcVolumeSteps) {
		t.Errorf("pcVolumeKeys has %d keys for %d steps: %v", len(pcVolumeKeys), len(pcVolumeSteps), pcVolumeKeys)
	}
}

// One tap is a key down then a key up of the same key, both keyboard events, so no key is left held.
func TestPCWindowsKeyPress(t *testing.T) {
	for _, step := range pcVolumeSteps {
		vk := pcVolumeKeys[step]
		press := pcKeyPress(vk)
		if len(press) != 2 {
			t.Fatalf("pcKeyPress(%#x) has %d events, want 2", vk, len(press))
		}
		for i, ev := range press {
			if ev.inputType != 1 {
				t.Errorf("%s event %d: type %d, want INPUT_KEYBOARD (1)", step, i, ev.inputType)
			}
			if ev.ki.vk != vk {
				t.Errorf("%s event %d: vk %#x, want %#x", step, i, ev.ki.vk, vk)
			}
		}
		if press[0].ki.flags != 0 {
			t.Errorf("%s down flags = %#x, want 0", step, press[0].ki.flags)
		}
		if press[1].ki.flags != 0x0002 {
			t.Errorf("%s up flags = %#x, want KEYEVENTF_KEYUP (0x2)", step, press[1].ki.flags)
		}
	}
}

func TestPCWindowsIsSupported(t *testing.T) {
	if !pcSupported {
		t.Error("pcSupported is false on windows, so remoteDeps would leave the Computer section hidden")
	}
}

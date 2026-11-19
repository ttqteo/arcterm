//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// pcSupported: wavesrv runs in the owner's desktop session, so it can lock that session and press its media keys.
const pcSupported = true

const (
	pcInputKeyboard  = 1      // INPUT.type of a keyboard event
	pcKeyeventfKeyUp = 0x0002 // KEYEVENTF_KEYUP

	pcVkVolumeMute = 0xAD // VK_VOLUME_MUTE
	pcVkVolumeDown = 0xAE // VK_VOLUME_DOWN
	pcVkVolumeUp   = 0xAF // VK_VOLUME_UP
)

var (
	pcUser32          = windows.NewLazySystemDLL("user32.dll")
	pcLockWorkStation = pcUser32.NewProc("LockWorkStation")
	pcSendInput       = pcUser32.NewProc("SendInput")

	pcWtsapi32                   = windows.NewLazySystemDLL("wtsapi32.dll")
	pcWTSQuerySessionInformation = pcWtsapi32.NewProc("WTSQuerySessionInformationW")
)

const (
	pcWtsCurrentSession     = 0xFFFFFFFF // WTS_CURRENT_SESSION: the session of the calling process
	pcWtsSessionInfoEx      = 25         // WTSSessionInfoEx in WTS_INFO_CLASS
	pcWtsSessionStateLock   = 0          // WTS_SESSIONSTATE_LOCK
	pcWtsSessionStateUnlock = 1          // WTS_SESSIONSTATE_UNLOCK
)

// pcWtsInfoEx is the head of WTSINFOEXW up to WTSINFOEX_LEVEL1_W.SessionFlags. The union after Level holds a
// LARGE_INTEGER, so it starts at offset 8 on 32 and on 64 bits alike, and SessionFlags sits at 16.
type pcWtsInfoEx struct {
	level        uint32
	_            uint32
	sessionId    uint32
	sessionState int32
	sessionFlags int32
}

// pcLocked reads whether this desktop session is locked. Win+L, the lock screen after idle and the phone's own
// Lock all set it; a screen only turned off (remote mode keeps the computer awake, not the display) does not.
var pcLocked = pcReadLocked

func pcReadLocked(ctx context.Context) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, fmt.Errorf("read the lock state: %w", err)
	}
	if err := pcWTSQuerySessionInformation.Find(); err != nil {
		return false, fmt.Errorf("read the lock state: wtsapi32.dll has no WTSQuerySessionInformationW: %w", err)
	}
	var buf *pcWtsInfoEx
	var size uint32
	r, _, err := pcWTSQuerySessionInformation.Call(
		0, // WTS_CURRENT_SERVER_HANDLE
		uintptr(pcWtsCurrentSession),
		uintptr(pcWtsSessionInfoEx),
		uintptr(unsafe.Pointer(&buf)),
		uintptr(unsafe.Pointer(&size)),
	)
	if r == 0 {
		return false, pcCallError("read the lock state: WTSQuerySessionInformationW failed", err)
	}
	if buf == nil {
		return false, errors.New("read the lock state: WTSQuerySessionInformationW returned no buffer")
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(buf)))
	if uintptr(size) < unsafe.Sizeof(*buf) {
		return false, fmt.Errorf("read the lock state: WTSQuerySessionInformationW returned %d bytes", size)
	}
	return pcLockedFromInfo(buf.level, buf.sessionFlags)
}

// pcLockedFromInfo reads SessionFlags. Windows 7 and Server 2008 R2 swap the two values; arcterm needs Windows 10.
func pcLockedFromInfo(level uint32, flags int32) (bool, error) {
	if level != 1 {
		return false, fmt.Errorf("read the lock state: WTSINFOEX level %d, want 1", level)
	}
	switch flags {
	case pcWtsSessionStateLock:
		return true, nil
	case pcWtsSessionStateUnlock:
		return false, nil
	}
	return false, fmt.Errorf("read the lock state: Windows does not know it (session flags %d)", flags)
}

// pcKeybdInput is KEYBDINPUT.
type pcKeybdInput struct {
	vk        uint16
	scan      uint16
	flags     uint32
	time      uint32
	extraInfo uintptr
}

// pcInput is INPUT holding a KEYBDINPUT. The C union is as long as its largest member, MOUSEINPUT, which is 8
// bytes longer than KEYBDINPUT on 32 and on 64 bits alike, so the padding is the same for both; SendInput
// refuses (ERROR_INVALID_PARAMETER) a cbSize that is not sizeof(INPUT).
type pcInput struct {
	inputType uint32
	ki        pcKeybdInput
	_         [8]byte
}

// pcVolumeKeys maps each of pcVolumeSteps to the virtual-key code of the keyboard key it presses.
var pcVolumeKeys = map[string]uint16{
	"down": pcVkVolumeDown,
	"mute": pcVkVolumeMute,
	"up":   pcVkVolumeUp,
}

// pcKeyPress is the two events of one tap of a key: down, then up. They go to SendInput in one call so the key
// cannot be left held down by a failure between them.
func pcKeyPress(vk uint16) [2]pcInput {
	return [2]pcInput{
		{inputType: pcInputKeyboard, ki: pcKeybdInput{vk: vk}},
		{inputType: pcInputKeyboard, ki: pcKeybdInput{vk: vk, flags: pcKeyeventfKeyUp}},
	}
}

// pcLock locks the desktop session, the same as Win+L.
func pcLock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("lock the screen: %w", err)
	}
	if err := pcLockWorkStation.Find(); err != nil {
		return fmt.Errorf("lock the screen: user32.dll has no LockWorkStation: %w", err)
	}
	if r, _, err := pcLockWorkStation.Call(); r == 0 {
		return pcCallError("LockWorkStation failed", err)
	}
	return nil
}

// pcVolume taps the volume key a step names, one press the same as the keyboard's (about 2%).
func pcVolume(ctx context.Context, step string) error {
	if err := pcCheckStep(step); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("press volume %s: %w", step, err)
	}
	vk, ok := pcVolumeKeys[step]
	if !ok {
		return fmt.Errorf("press volume %s: no key for that step", step)
	}
	if err := pcSendInput.Find(); err != nil {
		return fmt.Errorf("press volume %s: user32.dll has no SendInput: %w", step, err)
	}
	events := pcKeyPress(vk)
	sent, _, err := pcSendInput.Call(uintptr(len(events)), uintptr(unsafe.Pointer(&events[0])), unsafe.Sizeof(events[0]))
	if int(sent) != len(events) {
		return pcCallError(fmt.Sprintf("press volume %s: SendInput sent %d of %d key events", step, sent, len(events)), err)
	}
	return nil
}

// pcCallError words a failed Windows call. Call hands back GetLastError, and a call that sets none leaves
// ERROR_SUCCESS, which reads as "The operation completed successfully" inside a failure, so that one is left out.
func pcCallError(what string, err error) error {
	var errno syscall.Errno
	if errors.As(err, &errno) && errno != 0 {
		return fmt.Errorf("%s: %w", what, err)
	}
	return errors.New(what)
}

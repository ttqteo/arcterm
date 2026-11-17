//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"log"
	"runtime"
	"sync"

	"golang.org/x/sys/windows"
)

const (
	awakeEsContinuous     = 0x80000000
	awakeEsSystemRequired = 0x00000001
)

var awakeSetThreadExecutionState = windows.NewLazySystemDLL("kernel32.dll").NewProc("SetThreadExecutionState")

// KeepAwake asks Windows not to sleep until release is called. Not ES_DISPLAY_REQUIRED: the screen
// may turn off. The execution state belongs to the thread that set it, so one goroutine locked to
// its thread both sets and clears it.
func KeepAwake() (release func()) {
	set := make(chan struct{})
	done := make(chan struct{})
	cleared := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(cleared)
		if r, _, err := awakeSetThreadExecutionState.Call(uintptr(awakeEsContinuous | awakeEsSystemRequired)); r == 0 {
			log.Printf("remotemode: keep-awake: SetThreadExecutionState: %v", err)
		}
		close(set)
		<-done
		if r, _, err := awakeSetThreadExecutionState.Call(uintptr(awakeEsContinuous)); r == 0 {
			log.Printf("remotemode: keep-awake: clearing SetThreadExecutionState: %v", err)
		}
	}()
	<-set
	var once sync.Once
	return func() {
		once.Do(func() {
			close(done)
			<-cleared
		})
	}
}

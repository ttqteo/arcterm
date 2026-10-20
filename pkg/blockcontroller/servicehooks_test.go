// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"testing"
	"time"
)

func TestInterruptedWithin(t *testing.T) {
	t0 := time.Now()
	noteInput("b1", []byte{3}, t0)
	if !InterruptedWithin("b1", 3*time.Second, t0.Add(2*time.Second)) {
		t.Fatal("a Ctrl+C 2s ago is within the window")
	}
	if InterruptedWithin("b1", 3*time.Second, t0.Add(4*time.Second)) {
		t.Fatal("a Ctrl+C 4s ago is outside the window")
	}
	noteInput("b2", []byte("abc"), t0)
	if InterruptedWithin("b2", 3*time.Second, t0) {
		t.Fatal("input without Ctrl+C is not an interrupt")
	}
}

func TestServiceExitHookSilentOnShutdown(t *testing.T) {
	oldHook := ServiceExitHook
	ServiceExitHook = func(string, int) {}
	t.Cleanup(func() { ServiceExitHook = oldHook; shuttingDown.Store(false) })

	if serviceExitHook() == nil {
		t.Fatal("a normal exit must reach the service hook")
	}
	shuttingDown.Store(true)
	if serviceExitHook() != nil {
		t.Fatal("an exit caused by server shutdown is not a service crash")
	}
}

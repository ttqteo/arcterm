// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bytes"
	"sync"
	"time"
)

// ServiceExitHook is told when a block's process ends, so the held-services supervisor can tell a crash from a
// stop. It is called beside AgentOutcomeHook; the supervisor ignores blocks that are not its services.
var ServiceExitHook func(blockId string, exitCode int)

// serviceExitHook is the hook an exited block should run, or nil while the server shuts down: a quit is not a crash.
func serviceExitHook() func(blockId string, exitCode int) {
	if shuttingDown.Load() {
		return nil
	}
	return ServiceExitHook
}

// StopLeftovers ends every process of this user that still carries blockId once its block is closed.
func StopLeftovers(blockId string) {
	stopLeftovers(blockId)
}

// InterruptWindow is how long after a Ctrl+C a service exit still reads as the person's own stop.
const InterruptWindow = 3 * time.Second

var (
	interruptMu sync.Mutex
	interruptAt = map[string]time.Time{}
)

// noteInput records when a block last received Ctrl+C (byte 0x03).
func noteInput(blockId string, data []byte, now time.Time) {
	if !bytes.Contains(data, []byte{0x03}) {
		return
	}
	interruptMu.Lock()
	interruptAt[blockId] = now
	interruptMu.Unlock()
}

// InterruptedWithin reports whether blockId received Ctrl+C within d before now.
func InterruptedWithin(blockId string, d time.Duration, now time.Time) bool {
	interruptMu.Lock()
	at, ok := interruptAt[blockId]
	interruptMu.Unlock()
	return ok && now.Sub(at) <= d
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentctl holds the command streams of agent sessions whose harness mod can run a prompt itself,
// so the engine need not type into their terminals.
package agentctl

import "sync"

// queueSize bounds what a stream holds unread; Send refuses past it, and the caller types instead.
const queueSize = 16

var (
	lock    sync.Mutex
	streams = make(map[string]chan string)
)

// Register opens blockId's stream and returns it with its close. A second stream for the block replaces
// the first: a mod reload starts its new stream while the old process is still going away.
func Register(blockId string) (<-chan string, func()) {
	ch := make(chan string, queueSize)
	lock.Lock()
	streams[blockId] = ch
	lock.Unlock()
	return ch, func() {
		lock.Lock()
		defer lock.Unlock()
		if streams[blockId] == ch {
			delete(streams, blockId)
		}
	}
}

// Has reports whether blockId's session has a stream open.
func Has(blockId string) bool {
	lock.Lock()
	defer lock.Unlock()
	return streams[blockId] != nil
}

// Send hands text to blockId's session and reports whether its stream took it.
func Send(blockId, text string) bool {
	lock.Lock()
	defer lock.Unlock()
	ch := streams[blockId]
	if ch == nil {
		return false
	}
	select {
	case ch <- text:
		return true
	default:
		return false
	}
}

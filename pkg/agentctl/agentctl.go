// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentctl holds the command streams of agent sessions whose harness mod can run a prompt itself,
// so the engine need not type into their terminals.
package agentctl

import "sync"

// queueSize bounds what a stream holds unread; Send refuses past it, and the caller types instead.
const queueSize = 16

// Msg is one thing for a session to do: run Text as a prompt, or compact with Compact as the instructions,
// which wins when both are set. MidTurn asks for Text to join the turn the session is running, as typed
// text would, instead of waiting for it to end.
type Msg struct {
	Text    string
	Compact string
	MidTurn bool
}

var (
	lock    sync.Mutex
	streams = make(map[string]chan Msg)
)

// Register opens blockId's stream and returns it with its close. A second stream for the block replaces
// the first: a mod reload starts its new stream while the old process is still going away.
func Register(blockId string) (<-chan Msg, func()) {
	ch := make(chan Msg, queueSize)
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

// Send hands msg to blockId's session and reports whether its stream took it.
func Send(blockId string, msg Msg) bool {
	lock.Lock()
	defer lock.Unlock()
	ch := streams[blockId]
	if ch == nil {
		return false
	}
	select {
	case ch <- msg:
		return true
	default:
		return false
	}
}

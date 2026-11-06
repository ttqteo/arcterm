// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"errors"
	"os"
)

// PeekMessage is one message of a session's Quick look: a prompt the person typed ("user") or the answer that closed
// its turn ("assistant"), stamped with the transcript's own time (UnixMilli).
type PeekMessage struct {
	Role string
	Text string
	Ts   int64
}

// peekDefaultCount and peekMaxCount bound ClaudeTailMessages' n: 0 means peekDefaultCount, and n is clamped to
// 1..peekMaxCount.
const (
	peekDefaultCount = 5
	peekMaxCount     = 20
)

// clampPeekCount maps a requested message count onto 1..peekMaxCount, 0 (or below) meaning peekDefaultCount.
func clampPeekCount(n int) int {
	if n <= 0 {
		return peekDefaultCount
	}
	if n > peekMaxCount {
		return peekMaxCount
	}
	return n
}

// ClaudeTailMessages returns the last n messages (oldest first) of the Claude transcript at path: each real prompt
// and the answer that closed its turn. capped says the read stopped at its scan limit before finding n messages. A file
// that cannot be opened returns the error.
func ClaudeTailMessages(path string, n int) (msgs []PeekMessage, capped bool, err error) {
	n = clampPeekCount(n)
	_ = n
	f, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	f.Close()
	return nil, false, errors.New("session peek: not implemented")
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentmsg holds what one agent's message to another is made of: the envelope that names its sender,
// and the lock that keeps the receiver from messaging the sender back within the same turn. It imports nothing
// from the engine, so a transcript reader can recognize a message.
package agentmsg

import (
	"fmt"
	"strings"
	"sync"
)

// envelopePrefix opens every agent message. It is plain text because that is the one form that reads the same
// over the control stream, typed into claude, and typed into pi; it also keeps a message from starting with a
// slash, so one agent cannot run a command in another's session.
const envelopePrefix = `[Message from agent "`

// Envelope wraps text in the header that tells the receiver who sent it and that the user did not type it.
func Envelope(senderName, senderTabId, text string) string {
	return fmt.Sprintf("%s%s\" (tab %s), sent with wsh agents send. Not typed by the user. Its sender reads your reply with wsh agents read, so answer here and do not send one back.]\n%s",
		envelopePrefix, senderName, senderTabId, text)
}

// IsAgentMessage reports whether text is an enveloped agent message rather than something a person typed.
func IsAgentMessage(text string) bool {
	return strings.HasPrefix(strings.TrimSpace(text), envelopePrefix)
}

var (
	lockMu sync.Mutex
	// senders is, per block, the blocks that messaged it during its current turn.
	// ponytail: in memory, so a wavesrv restart opens every lock; persist it if loops show up after restarts.
	senders = map[string]map[string]bool{}
)

// NoteSent records that toBlock was messaged by fromBlock.
func NoteSent(fromBlock, toBlock string) {
	lockMu.Lock()
	defer lockMu.Unlock()
	if senders[toBlock] == nil {
		senders[toBlock] = map[string]bool{}
	}
	senders[toBlock][fromBlock] = true
}

// SendBackLocked reports whether fromBlock may not message toBlock: toBlock messaged it, and fromBlock's turn
// has not ended since.
func SendBackLocked(fromBlock, toBlock string) bool {
	lockMu.Lock()
	defer lockMu.Unlock()
	return senders[fromBlock][toBlock]
}

// TurnEnded clears what was recorded for block, whose turn is over.
func TurnEnded(block string) {
	lockMu.Lock()
	defer lockMu.Unlock()
	delete(senders, block)
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentask holds the in-memory registry of pending agent ask requests.
// AskCommand registers a pending ask keyed by the block's ORef; AnswerAgentCommand
// looks it up to encode + inject the answer; the clear path drops it. Keyed by ORef
// because an agent blocks on one AskUserQuestion at a time (at most one pending ask per block).
package agentask

import (
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// Owners of a dag child's ask. Only asks raised by dag children have one; the queue is how the lead
// and the human take turns on a question, and every other ask keeps Owner "".
const (
	AskOwner_Lead = "lead"
	AskOwner_User = "user"
)

// AnswerClearTimeout bounds how long a typed answer may go unconfirmed. Hook delivery is sub-second;
// this absorbs a slow turn start.
const AnswerClearTimeout = 30 * time.Second

// AnswerUnconfirmedNote is the note on an ask whose typed answer never cleared it.
const AnswerUnconfirmedNote = "answer was sent but never confirmed"

// a second unconfirmed delivery means typing into this child does not work, so the human takes it.
const maxDeliveryMisses = 2

// PendingAsk is the question set currently awaiting an answer for a block.
type PendingAsk struct {
	AskId     string
	BlockId   string
	Questions []baseds.AgentAskQuestion
	// Ts is the UnixMilli the ask was raised, copied from AgentAskData.Ts. Drives the "waiting 41m"
	// age in the attention list; without it the list can say what is waiting but not for how long.
	Ts int64
	// Prose mirrors CommandAskData.Prose: delivery types text instead of picker keystrokes.
	Prose bool
	// Hold mirrors CommandAskData.Hold: a working status never retires it.
	Hold bool
	// the fields below are set only for an ask raised by a dag child.
	Owner string
	// Deadline is the UnixMilli past which a lead-owned ask moves to the user.
	Deadline int64
	// Note says why the ask is with its owner: the lead's forward note, a missed deadline, a failed delivery.
	Note string
	// Misses counts typed answers the agent never cleared.
	Misses    int
	ChannelId string
	// RunId is the dag's owning run, the one the lead works in.
	RunId  string
	TaskId string
	DagOID string
}

type Registry struct {
	lock    sync.Mutex
	pending map[string]PendingAsk
	// clears holds typed dag answers waiting for the agent's clear, keyed by oref.
	clears map[string]sentAnswer
	// typed holds prose answers typed into a dag child's session, keyed by task, until the engine meets them in the
	// child's transcript, where they look exactly like a prompt the human typed.
	typed map[string][]typedAnswer
	waits waiters
}

// sentAnswer is a claimed ask whose answer was typed but not yet confirmed.
type sentAnswer struct {
	pending PendingAsk
	sentAt  int64
}

type typedAnswer struct {
	text   string
	sentAt int64
}

func MakeRegistry() *Registry {
	return &Registry{pending: make(map[string]PendingAsk), clears: make(map[string]sentAnswer), typed: make(map[string][]typedAnswer)}
}

func typedKey(dagOID, taskId string) string {
	return dagOID + "/" + taskId
}

func (r *Registry) noteTyped(p PendingAsk, text string, sentAt int64) {
	r.lock.Lock()
	defer r.lock.Unlock()
	key := typedKey(p.DagOID, p.TaskId)
	r.typed[key] = append(r.typed[key], typedAnswer{text: strings.TrimSpace(text), sentAt: sentAt})
}

func (r *Registry) forgetTyped(p PendingAsk, sentAt int64) {
	r.lock.Lock()
	defer r.lock.Unlock()
	key := typedKey(p.DagOID, p.TaskId)
	r.typed[key] = slices.DeleteFunc(r.typed[key], func(a typedAnswer) bool { return a.sentAt == sentAt })
	if len(r.typed[key]) == 0 {
		delete(r.typed, key)
	}
}

// TakeTypedAnswer reports whether a prompt read from a dag task's transcript at ts is a prose answer typed for that
// task, and forgets the answer so a later prompt with the same text still counts as the human's.
func (r *Registry) TakeTypedAnswer(dagOID, taskId, text string, ts int64) bool {
	r.lock.Lock()
	defer r.lock.Unlock()
	key := typedKey(dagOID, taskId)
	answers := r.typed[key]
	text = strings.TrimSpace(text)
	for i, a := range answers {
		if a.text != text || ts < a.sentAt {
			continue
		}
		r.typed[key] = slices.Delete(answers, i, i+1)
		if len(r.typed[key]) == 0 {
			delete(r.typed, key)
		}
		return true
	}
	return false
}

// GlobalRegistry is the process-wide instance used by the wsh server handlers.
var GlobalRegistry = MakeRegistry()

func (r *Registry) Set(oref string, p PendingAsk) {
	r.lock.Lock()
	defer r.lock.Unlock()
	r.pending[oref] = p
}

func (r *Registry) Get(oref string) (PendingAsk, bool) {
	r.lock.Lock()
	defer r.lock.Unlock()
	p, ok := r.pending[oref]
	return p, ok
}

// List returns every pending ask, keyed by the block ORef it is registered under. The returned map is a
// copy, so a caller may hold it after the lock is released.
func (r *Registry) List() map[string]PendingAsk {
	r.lock.Lock()
	defer r.lock.Unlock()
	out := make(map[string]PendingAsk, len(r.pending))
	for k, v := range r.pending {
		out[k] = v
	}
	return out
}

func (r *Registry) Drop(oref string) {
	r.lock.Lock()
	defer r.lock.Unlock()
	delete(r.pending, oref)
	// unconditionally, even when nothing was pending: a clear can legitimately arrive with no entry in
	// memory (a repeat PostToolUse clear, or the first clear after a restart that did not restore the
	// ask) and the stored row still has to go.
}

// Claim atomically removes and returns the pending ask for oref, making "who delivers it" a single
// decision. It returns (_, false) WITHOUT deleting when no ask is pending, or when askid != "" and the
// pending ask's AskId differs (a stale answer for an ask that was replaced). Otherwise it deletes the
// entry and returns (pending, true) — only the first caller for a given pending ask wins.
func (r *Registry) Claim(oref, askid string) (PendingAsk, bool) {
	r.lock.Lock()
	defer r.lock.Unlock()
	p, ok := r.pending[oref]
	if !ok {
		return PendingAsk{}, false
	}
	if askid != "" && p.AskId != askid {
		return PendingAsk{}, false
	}
	delete(r.pending, oref)
	return p, true
}

// Update edits a pending ask in place. It returns false when nothing is pending, or when
// askId != "" and no longer matches.
func (r *Registry) Update(oref, askId string, fn func(*PendingAsk)) bool {
	r.lock.Lock()
	defer r.lock.Unlock()
	p, ok := r.pending[oref]
	if !ok || (askId != "" && p.AskId != askId) {
		return false
	}
	fn(&p)
	r.pending[oref] = p
	return true
}

func (r *Registry) awaitClear(oref string, p PendingAsk, now int64) {
	r.lock.Lock()
	defer r.lock.Unlock()
	r.clears[oref] = sentAnswer{pending: p, sentAt: now}
}

// ConfirmClear ends the wait on a typed answer. The agent clearing its ask is the only proof the
// keystrokes reached the picker.
func (r *Registry) ConfirmClear(oref string) bool {
	r.lock.Lock()
	defer r.lock.Unlock()
	_, ok := r.clears[oref]
	delete(r.clears, oref)
	return ok
}

// ExpireClears puts back every typed answer the agent did not clear within timeout, keyed by oref.
// The ask returns to its owner with the failure noted, and to the user on the second miss. A block
// that already holds a new ask moved on, so its answer did land and nothing is restored.
func (r *Registry) ExpireClears(now int64, timeout time.Duration) map[string]PendingAsk {
	r.lock.Lock()
	defer r.lock.Unlock()
	restored := make(map[string]PendingAsk)
	for oref, s := range r.clears {
		if now-s.sentAt < timeout.Milliseconds() {
			continue
		}
		delete(r.clears, oref)
		if _, live := r.pending[oref]; live {
			continue
		}
		p := s.pending
		p.Misses++
		p.Note = AnswerUnconfirmedNote
		if p.Misses >= maxDeliveryMisses {
			p.Owner = AskOwner_User
		}
		r.pending[oref] = p
		restored[oref] = p
	}
	return restored
}

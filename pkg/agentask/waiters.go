// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentask

import (
	"sync"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// WaitResult is one resolved ask for a --wait caller: the answers, or Cancelled=true when
// the ask was cleared (dismissed in the cockpit) before an answer arrived.
type WaitResult struct {
	Answers   []baseds.AgentAnswerItem
	Cancelled bool
}

// waiters holds blocked wsh ask --wait callers, keyed by the pending ask's AskId. The
// buffered(1) channel + non-blocking resolve make double-resolve safe: only the first
// resolve sends, and a resolve racing a remove is either delivered or dropped, never
// blocked. At most one waiter exists per ask (one AskId, one --wait caller).
type waiters struct {
	lock sync.Mutex
	m    map[string]chan WaitResult
}

func (w *waiters) Register(askId string) chan WaitResult {
	ch := make(chan WaitResult, 1)
	w.lock.Lock()
	defer w.lock.Unlock()
	if w.m == nil {
		w.m = make(map[string]chan WaitResult)
	}
	w.m[askId] = ch
	return ch
}

func (w *waiters) Resolve(askId string, res WaitResult) bool {
	w.lock.Lock()
	ch, ok := w.m[askId]
	if ok {
		delete(w.m, askId)
	}
	w.lock.Unlock()
	if !ok {
		return false
	}
	select {
	case ch <- res:
	default: // already resolved or abandoned — first resolve wins
	}
	return true
}

func (w *waiters) Has(askId string) bool {
	w.lock.Lock()
	defer w.lock.Unlock()
	_, ok := w.m[askId]
	return ok
}

func (w *waiters) Remove(askId string) {
	w.lock.Lock()
	delete(w.m, askId)
	w.lock.Unlock()
}

// Registry-level helpers used by the wsh server and DeliverAnswer.
func (r *Registry) RegisterWaiter(askId string) chan WaitResult { return r.waits.Register(askId) }
func (r *Registry) ResolveWaiter(askId string, res WaitResult) bool {
	return r.waits.Resolve(askId, res)
}
func (r *Registry) RemoveWaiter(askId string) { r.waits.Remove(askId) }

// HasWaiter reports whether a --wait caller is still blocked on the ask.
func (r *Registry) HasWaiter(askId string) bool { return r.waits.Has(askId) }

// SameQuestions reports whether two asks put the same questions, by their text in order: a second
// projection of one AskUserQuestion call, whatever fields each side carried.
func SameQuestions(a, b []baseds.AgentAskQuestion) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Question != b[i].Question {
			return false
		}
	}
	return true
}

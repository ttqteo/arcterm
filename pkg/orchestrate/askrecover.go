// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// RecoverAskHook registers a question a worker's transcript shows open and no hook registered, as the worker's own
// `wsh ask` would have: in the ask registry, and in its lead's question queue. Wired to wshserver at startup, which
// orchestrate cannot import; the default does nothing.
var RecoverAskHook = func(ctx context.Context, blockOref, toolUseId string, questions []baseds.AgentAskQuestion) {}

// workerOpenAskFn reads the question a claude transcript has open. A var so tests can count the reads: it reads the
// whole file.
var workerOpenAskFn = agentobserve.OpenAsk

// askRecovery is a question found open in a worker's transcript, for recoverAsks once the tick that found it has
// committed.
type askRecovery struct {
	blockOref string
	toolUseId string
	questions []baseds.AgentAskQuestion
}

// recoverableAsk reads the transcript of a claude worker about to be judged stalled and returns the question it has
// open that no hook registered. The registration is the PreToolUse `wsh agent-hook`'s, and a hook cancelled on timeout
// (wavesrv slow) leaves no trace but the transcript. The read is the reason this takes only a stall candidate: it
// reads the whole file under the dag lock, so it is not paid by a task still writing or working, nor by a block whose
// question is already in the registry (workerAsking sees that one). Only claude has an AskUserQuestion to find.
func recoverableAsk(ctx context.Context, run *waveobj.Run) (askRecovery, bool) {
	blockId, _ := workerBlockFn(ctx, run)
	if blockId == "" {
		return askRecovery{}, false
	}
	blockOref := waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	if _, registered := agentask.GlobalRegistry.Get(blockOref); registered {
		return askRecovery{}, false
	}
	path, runtime, tracked := transcriptForRun(run)
	if !tracked || path == "" || runtime != defaultWorkerRuntime {
		return askRecovery{}, false
	}
	toolUseId, questions, open, err := workerOpenAskFn(path)
	if err != nil || !open {
		return askRecovery{}, false
	}
	return askRecovery{blockOref: blockOref, toolUseId: toolUseId, questions: questions}, true
}

// askRecoveryLog remembers, per worker block, the last tool_use id whose question was handed to RecoverAskHook, so a
// question that goes on showing open (its registration dismissed, or never taken) is registered once and not on every
// tick that finds it. In memory only: a restart finds the question again and registers it again, which is right.
type askRecoveryLog struct {
	mu   sync.Mutex
	last map[string]string
}

func newAskRecoveryLog() *askRecoveryLog {
	return &askRecoveryLog{last: map[string]string{}}
}

// claim reports whether blockOref's question toolUseId has not been handed over yet, and marks it handed over.
func (l *askRecoveryLog) claim(blockOref, toolUseId string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.last[blockOref] == toolUseId {
		return false
	}
	l.last[blockOref] = toolUseId
	return true
}

var askRecoveries = newAskRecoveryLog()

// recoverAsks hands each question a tick found open to RecoverAskHook. The tick has committed and released the dag
// lock by now: the registration walks the store (block -> run -> dag) and raises events, none of it under that lock.
func recoverAsks(ctx context.Context, found []askRecovery) {
	for _, r := range found {
		if askRecoveries.claim(r.blockOref, r.toolUseId) {
			RecoverAskHook(ctx, r.blockOref, r.toolUseId, r.questions)
		}
	}
}

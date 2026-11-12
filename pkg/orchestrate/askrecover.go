// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/agentsleep"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// RecoverAskHook registers a question a worker's transcript shows open and no hook registered, as the worker's own
// `wsh ask` would have: in the ask registry, and in its lead's question queue. Wired to wshserver at startup, which
// orchestrate cannot import; the default does nothing.
var RecoverAskHook = func(ctx context.Context, blockOref, toolUseId string, questions []baseds.AgentAskQuestion) {}

// workerTranscriptFn reads a claude worker's whole transcript. A var so tests can count the reads: each is of the whole
// file, under the dag lock.
var workerTranscriptFn = func(path string) ([]string, error) {
	tail, err := agentobserve.ReadTail(path, 0)
	return tail.Lines, err
}

// askRecovery is a question found open in a worker's transcript, for recoverAsks once the tick that found it has
// committed.
type askRecovery struct {
	blockOref string
	toolUseId string
	questions []baseds.AgentAskQuestion
}

// candidateReading is what the one transcript read of a stall candidate shows: a question the worker has open that no
// hook registered, and the labels of the background shells it still waits on.
type candidateReading struct {
	ask        askRecovery
	askOpen    bool
	background []string
}

// readStallCandidate reads the transcript of a claude worker about to be judged stalled, once, for both things a
// silent transcript can hide. A question open that no hook registered: the registration is the PreToolUse
// `wsh agent-hook`'s, and a hook cancelled on timeout (wavesrv slow) leaves no trace but the transcript. A background
// shell still running: the worker waits on it, and the transcript and its CPU can both read idle for as long as it
// does. The read is the reason this takes only a stall candidate: it reads the whole file under the dag lock, so it is
// not paid by a task still writing or working, nor by a block whose question is already in the registry
// (workerAsking sees that one). Only claude has an AskUserQuestion or a background shell to find; ok is false for
// anything else, and for a transcript that cannot be read.
func readStallCandidate(ctx context.Context, run *waveobj.Run) (candidateReading, bool) {
	blockId, _ := workerBlockFn(ctx, run)
	if blockId == "" {
		return candidateReading{}, false
	}
	blockOref := waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	if _, registered := agentask.GlobalRegistry.Get(blockOref); registered {
		return candidateReading{}, false
	}
	path, runtime, tracked := transcriptForRun(run)
	if !tracked || path == "" || runtime != defaultWorkerRuntime {
		return candidateReading{}, false
	}
	lines, err := workerTranscriptFn(path)
	if err != nil {
		return candidateReading{}, false
	}
	reading := candidateReading{background: agentsleep.BackgroundRunning(lines)}
	if toolUseId, questions, open := agentobserve.OpenAskLines(lines); open {
		reading.ask = askRecovery{blockOref: blockOref, toolUseId: toolUseId, questions: questions}
		reading.askOpen = true
	}
	return reading, true
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

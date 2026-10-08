// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// askEventTimeout bounds the ask-lifecycle recording work (a block -> run -> dag walk plus one
// append) so a slow store can never hold up the answer or clear path it hangs off.
const askEventTimeout = 5 * time.Second

func (ws *WshServer) AskCommand(ctx context.Context, data wshrpc.CommandAskData) (wshrpc.AskRtnData, error) {
	if data.ORef == "" || len(data.Questions) == 0 {
		return wshrpc.AskRtnData{}, fmt.Errorf("oref and at least one question are required")
	}
	oref, err := waveobj.ParseORef(data.ORef)
	if err != nil {
		return wshrpc.AskRtnData{}, fmt.Errorf("invalid oref %q: %w", data.ORef, err)
	}
	askId := uuid.New().String()
	// one raise time for both the registry entry and the published event: the attention list ages an ask
	// off its registry Ts while the frontend ages it off the event's, and two time.Now() calls would let
	// those two disagree by the width of this function.
	ts := time.Now().UnixMilli()
	// the waiter is registered before the ask is published, not after: publishAgentAsk runs the
	// Gatekeeper and any synchronous subscriber, either of which can answer or clear this ask before
	// this function reaches the select. Registering afterwards loses that resolve, and the caller
	// blocks on an ask nothing will ever resolve again.
	var waiter <-chan agentask.WaitResult
	if data.Wait {
		waiter = agentask.GlobalRegistry.RegisterWaiter(askId)
	}
	agentask.GlobalRegistry.Set(data.ORef, agentask.PendingAsk{
		AskId:     askId,
		BlockId:   oref.OID,
		Questions: data.Questions,
		Ts:        ts,
		Prose:     data.Prose,
		Hold:      data.Hold,
	})
	publishAgentAsk(baseds.AgentAskData{
		ORef:      data.ORef,
		AskId:     askId,
		Questions: data.Questions,
		Ts:        ts,
		Prose:     data.Prose,
		Hold:      data.Hold,
	})
	// a dag child raising an ask is a lead event: the child blocks on the question, so the lead must
	// be able to see it (and answer it via `wsh jarvis dag answer`) — the child sessions are invisible
	// to the human (the "child asks never reach anyone" flaw).
	forwardChildAsk(ctx, data.ORef, askId, data.Questions)
	if !data.Wait {
		return wshrpc.AskRtnData{AskId: askId}, nil
	}
	// wait mode (pi ask bridge): block until the human answers in the cockpit, or the
	// caller dies. ctx.Done cleanup drops the pending ask and publishes the cleared
	// event so the attention list never shows a stale ask for a dead agent.
	select {
	case res := <-waiter:
		return wshrpc.AskRtnData{AskId: askId, Answers: res.Answers, Cancelled: res.Cancelled}, nil
	case <-ctx.Done():
		agentask.GlobalRegistry.RemoveWaiter(askId)
		agentask.GlobalRegistry.Drop(data.ORef)
		recordAskTransition(data.ORef, askId, waveobj.RunEventKindChildAskCleared, orchestrate.AskClearReasonWaiterEnded)
		publishAgentAsk(baseds.AgentAskData{ORef: data.ORef, AskId: askId, Cleared: true})
		return wshrpc.AskRtnData{}, ctx.Err()
	}
}

func (ws *WshServer) AnswerAgentCommand(ctx context.Context, data wshrpc.CommandAnswerAgentData) error {
	if data.ORef == "" {
		return fmt.Errorf("oref is required")
	}
	_, err := agentask.DeliverAnswer(data.ORef, "", data.Answers)
	return err
}

func (ws *WshServer) AgentAskClearCommand(ctx context.Context, oref string) error {
	if oref == "" {
		return fmt.Errorf("oref is required")
	}
	// a dag child clearing its ask is the proof a typed answer reached the picker; without it the sweep
	// puts an answered question back in front of its owner
	agentask.GlobalRegistry.ConfirmClear(oref)
	pending, found := agentask.GlobalRegistry.Get(oref)
	if found {
		// a blocked --wait caller (pi) treats a cockpit dismiss as cancellation; CC's
		// PostToolUse clear finds no waiter and is unchanged in effect.
		agentask.GlobalRegistry.ResolveWaiter(pending.AskId, agentask.WaitResult{Cancelled: true})
	}
	agentask.GlobalRegistry.Drop(oref)
	// only a clear that found something pending is a lifecycle transition — a repeat clear
	// (PostToolUse after a cockpit dismiss) must not append a second row.
	if found {
		recordAskTransition(oref, pending.AskId, waveobj.RunEventKindChildAskCleared, orchestrate.AskClearReasonDismissed)
	}
	publishAgentAsk(baseds.AgentAskData{ORef: oref, AskId: pending.AskId, Cleared: true})
	return nil
}

// askResumeGraceMs is how far after an ask a working status has to land before it counts as the agent
// having moved on. It mirrors the frontend's ASK_STALE_GRACE_MS: a reporter's own working events can
// land in the same instant as the ask that follows them, and those must not retire it.
const askResumeGraceMs = 2000

// retireAskOnResume drops a pending ask whose agent has demonstrably resumed work. PostToolUse ->
// `wsh ask --clear` is the only other retirement path for a live block, and it never fires when the
// AskUserQuestion tool is rejected or interrupted in the agent's own terminal — so the question stayed
// pending forever, holding its card and its attention count. A working status materially after the ask
// is proof the agent is no longer blocked on it: nothing else can run while the ask tool holds the turn.
// Only `working` counts (idle would kill a prose ask raised at settle, which is idle by construction).
func retireAskOnResume(ev *wps.WaveEvent) {
	if ev == nil || ev.Event != wps.Event_AgentStatus {
		return
	}
	// events arrive over the RPC wire with Data as a raw JSON map, so decode rather than assert.
	var data baseds.AgentStatusData
	if err := utilfn.ReUnmarshal(&data, ev.Data); err != nil {
		return
	}
	if data.ORef == "" || data.State != baseds.AgentState_Working {
		return
	}
	pending, ok := agentask.GlobalRegistry.Get(data.ORef)
	// a held command's card is raised from inside the tool call it holds: the agent working on in
	// parallel has not moved past it
	if !ok || pending.Hold || data.Ts-pending.Ts <= askResumeGraceMs {
		return
	}
	claimed, ok := agentask.GlobalRegistry.Claim(data.ORef, pending.AskId)
	if !ok {
		return
	}
	// a blocked --wait caller is cancelled, not left hanging on a question the human answered elsewhere.
	agentask.GlobalRegistry.ResolveWaiter(claimed.AskId, agentask.WaitResult{Cancelled: true})
	publishAgentAsk(baseds.AgentAskData{ORef: data.ORef, AskId: claimed.AskId, Cleared: true})
	recordAskTransition(data.ORef, claimed.AskId, waveobj.RunEventKindChildAskCleared, orchestrate.AskClearReasonResumed)
}

func publishAgentAsk(data baseds.AgentAskData) {
	jarvis.PublishAgentAsk(data)
}

// forwardChildAsk puts a pending ask raised by a dag child's block in its lead's question queue: the
// child's ask card renders only on the child session, invisible to the human, so the lead answers it
// or forwards it. No-op for blocks that are not dag children.
func forwardChildAsk(ctx context.Context, blockOref, askId string, questions []baseds.AgentAskQuestion) {
	if len(questions) == 0 {
		return
	}
	g, target, ok := askTargetForBlock(ctx, blockOref, askId)
	if !ok {
		return
	}
	orchestrate.RaiseChildAsk(ctx, g, target, blockOref, questions[0].Question)
}

// askTargetForBlock resolves the dag task behind a block's ask, so the raise, answer and clear paths
// all attach their lifecycle rows to the same task and ask id. ok=false for a plain (non-dag) block.
func askTargetForBlock(ctx context.Context, blockOref, askId string) (*waveobj.TaskGroup, orchestrate.AskTarget, bool) {
	run, channelId, ok := ownerRunForBlock(ctx, blockOref)
	if !ok {
		return nil, orchestrate.AskTarget{}, false
	}
	return orchestrate.ResolveAskTarget(ctx, channelId, run, askId)
}

// recordAskTransition resolves the dag task behind a block's ask, records one lifecycle row for it and
// tells the run its question queue changed. Every caller has already taken the ask out of the registry, so
// the run's question card re-reads a queue without it. It builds its own bounded context rather than taking
// one: the clear-on-waiter-end caller's context is already cancelled, and a dead context would silently drop
// the row. Non-dag blocks resolve to nothing and record nothing.
func recordAskTransition(oref, askId, kind, detail string) {
	ctx, cancel := context.WithTimeout(context.Background(), askEventTimeout)
	defer cancel()
	if g, target, ok := askTargetForBlock(ctx, oref, askId); ok {
		orchestrate.RecordAskLifecycle(ctx, target, kind, detail)
		orchestrate.PublishAskQueueChanged(g, target)
	}
}

// RecordAskAnswered is agentask's answer-hook implementation, wired at server startup. It runs on
// every delivered answer — cockpit, Gatekeeper, or dag lead — and both publishes the cleared event
// that retires the ask card and the attention entry, and records the one child-answered row that
// closes the ask the child raised. DeliverAnswer claims the ask out of the registry but publishes
// nothing, so without this an answered question stayed on screen until it aged out. The publish goes
// first: recordAskTransition walks block -> run -> dag against the store, and the dismissal must not
// wait on it.
func RecordAskAnswered(oref, askId string) {
	publishAgentAsk(baseds.AgentAskData{ORef: oref, AskId: askId, Cleared: true})
	recordAskTransition(oref, askId, waveobj.RunEventKindChildAnswered, "")
}

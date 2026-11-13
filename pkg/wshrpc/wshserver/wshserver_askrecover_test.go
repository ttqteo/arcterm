// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// A worker whose question was found open in its transcript (its hook was cancelled on timeout) is registered as the hook
// would have registered it: `dag asks` lists it, the lead's queue hears of it, and the digest line reads `ask:` with the
// question instead of `running a command`.
func TestRecoverWorkerAskRegistersLikeTheHook(t *testing.T) {
	cc := &wsCaptureClient{}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(cc)
	defer wps.Broker.SetClient(prevClient)
	wps.Broker.Subscribe("recoverask-events", wps.SubscriptionRequest{Event: orchestrate.DagEventChildAsk, AllScopes: true})
	defer wps.Broker.Unsubscribe("recoverask-events", orchestrate.DagEventChildAsk)

	g, _, blockORef := dagAskFixture(t)
	agentask.GlobalRegistry = agentask.MakeRegistry()
	ws := &WshServer{}
	ctx := context.Background()
	questions := []baseds.AgentAskQuestion{{
		Question: "Keep the old API?",
		Header:   "API",
		Options:  []baseds.AgentAskOption{{Label: "Keep"}, {Label: "Drop"}},
	}}

	RecoverWorkerAsk(ctx, blockORef, "toolu_ask1", questions)

	pending, ok := agentask.GlobalRegistry.Get(blockORef)
	if !ok || len(pending.Questions) != 1 || pending.Questions[0].Question != "Keep the old API?" || pending.AskId == "" {
		t.Fatalf("the recovered question is in the registry as a hook ask is: %+v (pending %v)", pending, ok)
	}
	asks, err := ws.DagAsksCommand(ctx, wshrpc.CommandDagStatusData{ChannelId: g.ChannelId, RunId: g.RunID})
	if err != nil {
		t.Fatal(err)
	}
	if len(asks.Asks) != 1 || asks.Asks[0].TaskId != "t-0" || asks.Asks[0].AskId != pending.AskId {
		t.Fatalf("dag asks lists the recovered question: %+v", asks.Asks)
	}
	if !cc.saw(orchestrate.DagEventChildAsk, waveobj.MakeORef(waveobj.OType_Run, g.RunID).String()) {
		t.Fatal("the recovered question reaches the lead's queue, as a hook ask does")
	}
	status, err := ws.DagStatusCommand(ctx, wshrpc.CommandDagStatusData{ChannelId: g.ChannelId, RunId: g.RunID})
	if err != nil {
		t.Fatal(err)
	}
	td := status.Digest.Tasks[0]
	if td.TaskId != "t-0" || td.AskId != pending.AskId || td.AskSummary != "Keep the old API?" {
		t.Fatalf("the digest line carries the recovered question, as for a hook ask: %+v", td)
	}

	// found again on a later tick: the question is already up, and a second card would replace the one being answered
	RecoverWorkerAsk(ctx, blockORef, "toolu_ask1", questions)
	if again, _ := agentask.GlobalRegistry.Get(blockORef); again.AskId != pending.AskId {
		t.Fatalf("a question already pending is left alone: ask %q replaced by %q", pending.AskId, again.AskId)
	}
}

// a block that is not a dag worker's still gets its ask, and a call with no question registers nothing
func TestRecoverWorkerAskEdges(t *testing.T) {
	agentask.GlobalRegistry = agentask.MakeRegistry()
	oref := waveobj.MakeORef(waveobj.OType_Block, "11111111-2222-4333-8444-555555555555").String()

	RecoverWorkerAsk(context.Background(), oref, "toolu_none", nil)
	if _, ok := agentask.GlobalRegistry.Get(oref); ok {
		t.Fatal("no questions, nothing to register")
	}
	RecoverWorkerAsk(context.Background(), "not-an-oref", "toolu_bad", []baseds.AgentAskQuestion{{Question: "Q?"}})
	if got := agentask.GlobalRegistry.List(); len(got) != 0 {
		t.Fatalf("an unparsable oref registers nothing: %+v", got)
	}
}

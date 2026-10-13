// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var (
	inflightLock sync.Mutex
	inflight     = map[string]context.CancelFunc{} // askId -> cancel
)

// deliverFn is the delivery seam; tests stub it so no real ask actuator runs.
var deliverFn = agentask.DeliverAnswer

// PublishAgentAsk is the single way an ask raise or clear reaches the rest of the system: the
// Gatekeeper first, then the broker. It lives here rather than in wshserver because the attention
// gather also clears asks (for blocks that no longer exist) and wshserver imports jarvis, not the
// other way round.
func PublishAgentAsk(data baseds.AgentAskData) {
	OnAgentAsk(data)
	wps.Broker.Publish(wps.WaveEvent{
		Event:   wps.Event_AgentAsk,
		Scopes:  []string{data.ORef},
		Persist: 1,
		Data:    data,
	})
}

// OnAgentAsk is the server-side Gatekeeper entry point, called from PublishAgentAsk for every ask
// and clear. It never blocks the publish path: real work runs in a goroutine. A Cleared event
// cancels any in-flight classification for that AskId.
func OnAgentAsk(data baseds.AgentAskData) {
	if data.Cleared {
		cancelInflight(data.AskId)
		return
	}
	if data.AskId == "" || data.ORef == "" {
		return
	}
	inflightLock.Lock()
	if _, dup := inflight[data.AskId]; dup {
		inflightLock.Unlock()
		return // the persisted event re-delivered; already handling
	}
	ctx, cancel := context.WithCancel(context.Background())
	inflight[data.AskId] = cancel
	inflightLock.Unlock()
	go func() {
		defer func() { panichandler.PanicHandler("jarvis.OnAgentAsk", recover()) }()
		defer cancelInflight(data.AskId)
		handleAsk(ctx, data)
	}()
}

func cancelInflight(askId string) {
	inflightLock.Lock()
	defer inflightLock.Unlock()
	if cancel, ok := inflight[askId]; ok {
		cancel()
		delete(inflight, askId)
	}
}

// ChannelOwnerORef maps an asking oref to the oref a channel dispatch would reference for that
// worker. Asks fire from the worker's terminal block ("block:<id>"), but a channel dispatch records
// the worker's TAB oref ("tab:<id>"), so a block-scoped ask must be walked up to its tab before
// ownership resolution. Non-block orefs (or any lookup failure) pass through unchanged — fail-safe:
// a bad mapping just means no channel matches, never a wrong one.
//
// Exported so the attention builder resolves a pending ask the same way the watcher does.
func ChannelOwnerORef(ctx context.Context, askingORef string) string {
	oref, err := waveobj.ParseORef(askingORef)
	if err != nil || oref.OType != waveobj.OType_Block {
		return askingORef
	}
	tabId, err := wstore.DBFindTabForBlockId(ctx, oref.OID)
	if err != nil || tabId == "" {
		return askingORef
	}
	return waveobj.MakeORef(waveobj.OType_Tab, tabId).String()
}

// ResolveAskOwner resolves the channel + classifier task that owns an ask's worker oref, via the Phase-2
// owner-stamp meta (each helper falls back to the old scan on a stamp miss). Run workers carry
// jarvis:runoref (+channeloref); we check the run path FIRST so a run worker takes the run path, not the
// concierge path (it also has channeloref). Concierge workers carry channeloref only. This flips the old
// gatekeeper-then-run precedence, but is equivalent: run workers never appear in dispatch messages and
// concierge workers have no run, so neither can match the other's path (Design Note 2). Returns
// (nil, "", "") for a standalone agent no channel dispatched. Exported for the attention builder. The
// second value is the classifier's task and the third is the attention row's source.
func ResolveAskOwner(ctx context.Context, ownerORef string) (*waveobj.Channel, string, string) {
	if m := ResolveRunWorkerFromMeta(ctx, ownerORef); m != nil {
		source := dagTaskSource(ctx, m.Run)
		if source == "" {
			source = runWorkerSource(m.Run, m.PhaseIdx)
		}
		return m.Channel, runWorkerTask(m.Run, m.PhaseIdx), source
	}
	ch, task := resolveGatekeeperChannelByMeta(ctx, ownerORef)
	return ch, task, goalHeadline(task)
}

func handleAsk(ctx context.Context, data baseds.AgentAskData) {
	ownerORef := ChannelOwnerORef(ctx, data.ORef)
	if m := ResolveRunWorkerFromMeta(ctx, ownerORef); m != nil && isOrchestratorRun(ctx, m.Run) {
		return
	}
	ch, task, _ := ResolveAskOwner(ctx, ownerORef)
	// the tier gate lives here, not in ResolveAskOwner: the attention list resolves owners through it too,
	// and a concierge project's asks still need their run and goal as a label there
	if ch == nil || !GatekeeperOn(ch) {
		return
	}
	decision := Classify(ctx, ch, data.Questions, task)
	if ctx.Err() != nil {
		return // cleared / cancelled mid-classification
	}
	if decision.Action != "answer" {
		postEscalation(ch.OID, data, decision.Reason, ownerORef)
		return
	}
	// DeliverAnswer claims the ask before it encodes, so an answer the encoder would refuse must be caught here:
	// past the claim it would take the ask out of the registry with nothing delivered
	if err := agentask.ValidateAnswers(data.Questions, decision.Answers, data.Prose); err != nil {
		postEscalation(ch.OID, data, "invalid classifier answer: "+err.Error(), ownerORef)
		return
	}
	delivered, derr := deliverFn(data.ORef, data.AskId, decision.Answers)
	if derr == nil && delivered {
		postAnswered(ch.OID, data, decision.Answers, decision.Reason, ownerORef)
		return
	}
	// classifier chose answer but delivery raced a clear or failed — fail safe to escalate
	// rather than let the ask vanish from the channel trail.
	reason := "answer delivery failed"
	if derr != nil {
		reason += ": " + derr.Error()
	}
	postEscalation(ch.OID, data, reason, ownerORef)
}

// isOrchestratorRun reports a run whose questions the Gatekeeper must leave alone: an orchestrator lead,
// or a run the engine spawned for one of its dag tasks. The lead protocol asks only for decisions reserved
// for the human (spec review, plan approval, plan review, a failed final stage), so its asks go to the
// cockpit as they are, before dag submit as well as after. A dag child's question waits in its lead's
// queue: an auto-answer would race the lead's, and an escalation would put a second card in front of the
// human for the same question. A dag names its lead in RunID; the lead holds the same DagORef.
func isOrchestratorRun(ctx context.Context, run *waveobj.Run) bool {
	if run.Mode == RunMode_Orchestrator {
		return true
	}
	if run.DagORef == "" {
		return false
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	return err == nil && g.RunID != run.ID
}

// postAnswered records a delivered answer; answers has already passed agentask.ValidateAnswers, so every pick
// indexes its question's options.
func postAnswered(channelId string, data baseds.AgentAskData, answers []baseds.AgentAnswerItem, reason, workerORef string) {
	parts := make([]string, 0, len(answers))
	for i, a := range answers {
		if a.Text != "" {
			parts = append(parts, fmt.Sprintf("%q", a.Text))
			continue
		}
		labels := make([]string, 0, len(a.SelectedIndexes))
		for _, idx := range a.SelectedIndexes {
			labels = append(labels, fmt.Sprintf("%q", data.Questions[i].Options[idx].Label))
		}
		parts = append(parts, strings.Join(labels, ", "))
	}
	text := "Answered → " + strings.Join(parts, "; ")
	if reason != "" {
		text += " — " + reason
	}
	payload, _ := json.Marshal(BuildCardData(data.Questions, answers, reason, data.ORef, data.AskId, workerORef))
	postJarvisData(channelId, "jarvis-answered", text, string(payload))
}

func postEscalation(channelId string, data baseds.AgentAskData, reason, workerORef string) {
	var b strings.Builder
	b.WriteString("@you — your call")
	if reason != "" {
		b.WriteString(" (" + reason + ")")
	}
	b.WriteString("\n")
	var payload string
	if len(data.Questions) > 0 {
		for _, q := range data.Questions {
			b.WriteString(q.Question + "\n")
			for i, o := range q.Options {
				b.WriteString(fmt.Sprintf("  %d) %s\n", i, o.Label))
			}
		}
		j, _ := json.Marshal(BuildCardData(data.Questions, nil, reason, data.ORef, data.AskId, workerORef))
		payload = string(j)
	}
	postJarvisData(channelId, "jarvis-escalation", strings.TrimRight(b.String(), "\n"), payload)
}

func postJarvisData(channelId, kind, text, data string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	msg := wstore.NewChannelMessage(kind, "jarvis", text, "", time.Now().UnixMilli())
	msg.Data = data
	if _, err := wstore.PostChannelMessage(ctx, channelId, msg); err != nil {
		log.Printf("jarvis: post %s failed: %v", kind, err)
		return
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, channelId))
}

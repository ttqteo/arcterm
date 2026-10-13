// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"log"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// deliverLeadAnswerFn types the ON answer into the lead's own picker. A var for tests.
var deliverLeadAnswerFn = agentask.DeliverAnswer

// ApplyAutonomousSwitch carries a mid-run change of runId's Approvals setting to its lead. The setting is
// already saved, so an error says what still needs the human: the lead's own question, when its picker
// cannot take the ON answer as text.
//
// A run with no lead yet (not started, or a plan run submitted with none) gets no wake: the lead it starts
// builds its prompt from the saved setting, and a wake would only mark a lead that never ran as dead, or
// start one just to read it.
func ApplyAutonomousSwitch(ctx context.Context, channelId, runId string, on bool) error {
	st := leadStateFn(ctx, channelId, runId)
	hasLead := st.TabId != ""
	if !on {
		if hasLead {
			PostWake(ctx, channelId, runId, jarvis.AutonomousOffWake)
		}
		return nil
	}
	returned := returnUserAsksToLead(channelId, runId)
	if !hasLead {
		if returned {
			PokeWake(ctx, channelId, runId)
		}
		return nil
	}
	// held while the lead's own question is open (leadAsking), so it is typed once that question closes
	PostWake(ctx, channelId, runId, jarvis.AutonomousOnWake)
	return answerLeadQuestion(ctx, channelId, runId, st.BlockId)
}

// returnUserAsksToLead gives the lead back the run's child questions the human holds, with a fresh deadline:
// nobody is at the cockpit to answer them. It reports whether any moved.
func returnUserAsksToLead(channelId, runId string) bool {
	returned := false
	deadline := wakeNow() + LeadAskDeadline.Milliseconds()
	for oref, p := range agentask.GlobalRegistry.List() {
		if p.RunId != runId || p.DagOID == "" || p.Owner != agentask.AskOwner_User {
			continue
		}
		moved := agentask.GlobalRegistry.Update(oref, p.AskId, func(cur *agentask.PendingAsk) {
			cur.Owner, cur.Note, cur.Deadline = agentask.AskOwner_Lead, "", deadline
		})
		if !moved {
			continue
		}
		// the lead may have been told of it before it moved to the human, so the next wake must name it again
		wakes.lock.Lock()
		delete(wakes.runLocked(channelId, runId).told, askTold(p))
		wakes.lock.Unlock()
		publishChildAsk(p)
		returned = true
	}
	return returned
}

// answerLeadQuestion answers the lead's own waiting question (Spec review, Plan review, the land question)
// with AutonomousOnAnswer. Typing takes KeystrokeDelay per rune, past the RPC budget, so it runs in the
// background once the answer is known to fit the picker.
func answerLeadQuestion(ctx context.Context, channelId, runId, blockId string) error {
	if blockId == "" {
		return nil
	}
	oref := waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	pending, ok := agentask.GlobalRegistry.Get(oref)
	if !ok {
		return nil
	}
	answers := make([]baseds.AgentAnswerItem, len(pending.Questions))
	for i := range answers {
		answers[i] = baseds.AgentAnswerItem{Text: jarvis.AutonomousOnAnswer}
	}
	if err := agentask.ValidateAnswers(pending.Questions, answers, pending.Prose); err != nil {
		return fmt.Errorf("approvals saved as autonomous, but the lead's question still needs an answer in its terminal: %w", err)
	}
	bg := context.WithoutCancel(ctx)
	go func() {
		if _, err := deliverLeadAnswerFn(oref, pending.AskId, answers); err != nil {
			log.Printf("autonomous: run %s: answering the lead's question: %v", runId, err)
			appendRunEvent(bg, channelId, runId, waveobj.RunEventKindLeadWakeFailed, nil, map[string]any{
				"reason": "the lead's question could not be answered: " + err.Error(),
				"lines":  []string{jarvis.AutonomousOnAnswer},
			})
		}
	}()
	return nil
}

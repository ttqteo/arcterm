// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"encoding/json"
	"log"
	"slices"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// OutcomeData is the structured payload of a channel "outcome" message (JSON in ChannelMessage.Data).
// The FE styles the status pill off Status.
type OutcomeData struct {
	Status     string `json:"status"`     // "done" | "failed" | "waiting"
	Summary    string `json:"summary"`    // short transcript-derived "what came of it" line
	DurationMs int64  `json:"durationMs"` // wall time from the transcript
	ExitCode   int    `json:"exitCode"`   // process exit code (recorded, not the status source)
	// NoTranscript marks the one exit the transcript cannot describe: the agent died before writing
	// anything. Consumers need it distinguishable from an ordinary failure because it is the only
	// outcome that says the launch itself never got off the ground.
	NoTranscript bool `json:"noTranscript,omitempty"`
}

var ChildOutcomeHook func(context.Context, string, OutcomeData) error

// OutcomeStatus maps an agentsessions status to the persisted pill status. Unknown/empty -> "done"
// (a session with no error/ask marker completed a turn cleanly).
func OutcomeStatus(sessionStatus string) string {
	switch sessionStatus {
	case "failed":
		return "failed"
	case "waiting":
		return "waiting"
	default:
		return "done"
	}
}

// workerMessagesIn returns the messages in one channel that reference the worker, oldest first. Inside a
// write transaction, pass that transaction's context so the read sees what it has written.
func workerMessagesIn(ctx context.Context, channelId, workerORef string) ([]*waveobj.ChannelMessage, error) {
	all, err := wstore.GetMessagesByRef(ctx, workerORef)
	if err != nil {
		return nil, err
	}
	var msgs []*waveobj.ChannelMessage
	for _, m := range all {
		if m.ChannelOID == channelId {
			msgs = append(msgs, m)
		}
	}
	return msgs, nil
}

// alreadyHasFreshOutcome reports whether, among one worker's messages in a channel, an outcome is
// newer-or-equal to the latest dispatch/directive — meaning a re-post would be a duplicate. A later
// re-dispatch (newer ts) makes it stale again, so the worker can earn a fresh outcome. Pure.
func alreadyHasFreshOutcome(msgs []*waveobj.ChannelMessage) bool {
	var latestDispatch, latestOutcome int64
	for _, m := range msgs {
		switch m.Kind {
		case "dispatch", "directive":
			if m.Ts > latestDispatch {
				latestDispatch = m.Ts
			}
		case "outcome":
			if m.Ts > latestOutcome {
				latestOutcome = m.Ts
			}
		}
	}
	return latestOutcome >= latestDispatch && latestOutcome > 0
}

// PostOutcome posts a persisted "outcome" message to ch for workerORef, but only if ch actually
// dispatched the worker (a dispatch message references it) and no fresh outcome already exists. The
// dispatch-existence gate means run workers — which have no dispatch message — get no outcome.
// Fire-and-forget by the caller.
func PostOutcome(ch *waveobj.Channel, workerORef, runtime string, data OutcomeData) {
	if ch == nil {
		return
	}
	payload, _ := json.Marshal(data)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	msg := wstore.NewChannelMessage("outcome", runtime, data.Summary, workerORef, time.Now().UnixMilli())
	msg.Data = string(payload)
	// both checks read inside the write transaction, with its context, so two near-simultaneous
	// worker-exit signals can't both pass and double-post the outcome.
	posted, err := wstore.PostChannelMessageIf(ctx, ch.OID, msg, func(txCtx context.Context) (bool, error) {
		msgs, err := workerMessagesIn(txCtx, ch.OID, workerORef)
		if err != nil {
			return false, err
		}
		// only workers dispatched via a message earn an outcome
		dispatched := slices.ContainsFunc(msgs, func(m *waveobj.ChannelMessage) bool { return m.Kind == "dispatch" })
		return dispatched && !alreadyHasFreshOutcome(msgs), nil
	})
	if err != nil {
		log.Printf("jarvis: post outcome failed: %v", err)
		return
	}
	if posted {
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, ch.OID))
	}
}

// resolveDispatchChannelForWorker loads the worker's dispatching channel via the channeloref stamp,
// falling back to the worker's dispatch messages on a stamp miss. The PostOutcome dispatch-existence gate
// still applies, so a wrongly-stamped run worker won't get an outcome.
func resolveDispatchChannelForWorker(ctx context.Context, workerORef string) *waveobj.Channel {
	if _, channelORef, err := wstore.GetWorkerOwner(ctx, workerORef); err == nil && channelORef != "" {
		if chRef, perr := waveobj.ParseORef(channelORef); perr == nil {
			if ch, gerr := wstore.DBMustGet[*waveobj.Channel](ctx, chRef.OID); gerr == nil && ch != nil {
				return ch
			}
		}
	}
	return ResolveDispatchChannel(ctx, workerORef)
}

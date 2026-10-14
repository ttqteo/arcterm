// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The read that makes the memory subsystem's continuity answerable from outside it: where the last run
// left off. It was already computed and persisted; it had no read path.

package wshserver

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/jarviscontinuity"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func (ws *WshServer) GetLatestResumeCommand(ctx context.Context) (*wshrpc.CommandGetLatestResumeRtnData, error) {
	runs, err := wstore.DBGetAllObjsByType[*waveobj.Run](ctx, waveobj.OType_Run)
	if err != nil {
		return nil, fmt.Errorf("loading runs: %w", err)
	}
	return buildLatestResume(runs), nil
}

// buildLatestResume picks the single newest narrative. Ordering is by the narrative's own Updated stamp
// (the dossier's, written at the boundary) and not by the run's, because a run that reached rest twice
// carries only its latest text — the run's createdts would rank a stale narrative above a fresh one.
// Runs with no stamp fall back to their completion, then their creation, so an early narrative written
// before Updated was populated still ranks rather than vanishing.
//
// Always returns non-nil: an empty result with Card nil is "nothing to resume", which is a real answer and
// not an error. The scan reads every run row — the same read ResolveSpaceScope already makes — but the
// response is one card, so the cost is bounded where the caller can feel it.
func buildLatestResume(runs []*waveobj.Run) *wshrpc.CommandGetLatestResumeRtnData {
	out := &wshrpc.CommandGetLatestResumeRtnData{}
	var bestRank int64
	for _, run := range runs {
		card, ok := jarviscontinuity.ReadResumeCard(run)
		if !ok {
			continue
		}
		rank := resumeRank(card, run)
		if out.Card != nil && rank <= bestRank {
			continue
		}
		bestRank = rank
		out.Card = &wshrpc.ResumeCardData{
			TaskId:  card.TaskID,
			Summary: card.Summary,
			Status:  card.Status,
			Updated: card.Updated,
		}
		out.RunORef = waveobj.MakeORef(waveobj.OType_Run, run.OID).String()
		out.ChannelOid = run.ChannelOID
		out.RunStatus = run.Status
		out.RunGoal = run.Goal
	}
	return out
}

// resumeRank is the recency key. All three sources are Unix millis (jarvisdossier stamps `updated` with
// UnixMilli; wstore stamps run timestamps the same way), so mixing them in one comparison is sound.
func resumeRank(card jarviscontinuity.ResumeCard, run *waveobj.Run) int64 {
	if card.Updated > 0 {
		return card.Updated
	}
	if run.CompletedTs > 0 {
		return run.CompletedTs
	}
	return run.CreatedTs
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// The backlog pass moves what leads left as pending chunks, before they filed proposals, into To review. It runs when
// the person asks (`wsh effort backfill-proposed`), never at startup: a pending chunk a person adds later that names a
// run must stay where it is.

// errNoBacklogChunks ends an update that has nothing left to move, so the initiative is not rewritten.
var errNoBacklogChunks = errors.New("no backlog chunks to propose")

func (ws *WshServer) EffortBackfillProposedCommand(ctx context.Context) (*wshrpc.CommandEffortBackfillProposedRtnData, error) {
	chunks, efforts, err := backfillProposed(ctx, jarvis.BacklogSince())
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandEffortBackfillProposedRtnData{Chunks: chunks, Efforts: efforts}, nil
}

// backlogRuns is every run in every channel. A channel that cannot be read fails the pass: its runs could name chunks
// the pass would then leave behind with no word, and the pass is safe to run again.
func backlogRuns(ctx context.Context) ([]*waveobj.Run, error) {
	chans, err := wstore.GetChannelsShared(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading channels: %w", err)
	}
	var runs []*waveobj.Run
	for _, ch := range chans {
		cr, err := wstore.GetChannelRunsShared(ctx, ch.OID)
		if err != nil {
			return nil, fmt.Errorf("reading the runs of channel %s: %w", ch.OID, err)
		}
		runs = append(runs, cr...)
	}
	return runs, nil
}

// backfillProposed moves the pending chunks jarvis.PickBacklogProposals names (since is its cutoff) to proposed, one
// update per initiative, and returns how many chunks on how many initiatives it moved. An initiative that fails to
// update is logged and left, so one bad file does not stop the rest; running the pass again takes it up.
func backfillProposed(ctx context.Context, since int64) (int, int, error) {
	all, err := effortstore.GetAll(ctx)
	if err != nil {
		return 0, 0, err
	}
	runs, err := backlogRuns(ctx)
	if err != nil {
		return 0, 0, err
	}
	chunks, efforts := 0, 0
	seen := map[string]bool{}
	for _, p := range jarvis.PickBacklogProposals(all, runs, since) {
		if seen[p.EffortOID] {
			continue
		}
		seen[p.EffortOID] = true
		n, err := proposeBacklogChunks(ctx, p.EffortOID, runs, since)
		if err != nil {
			log.Printf("effort backfill proposed: %s: %v", p.EffortOID, err)
			continue
		}
		if n > 0 {
			chunks += n
			efforts++
		}
	}
	return chunks, efforts, nil
}

// proposeBacklogChunks moves the initiative's picks to proposed in one update. The pick is made again on the stored
// initiative inside the update, so a chunk a run or a person took since the first read is left alone.
func proposeBacklogChunks(ctx context.Context, oid string, runs []*waveobj.Run, since int64) (int, error) {
	moved := 0
	err := effortstore.Update(ctx, oid, func(e *waveobj.Effort) error {
		picks := jarvis.PickBacklogProposals([]*waveobj.Effort{e}, runs, since)
		if len(picks) == 0 {
			return errNoBacklogChunks
		}
		now := time.Now().UnixMilli()
		for _, p := range picks {
			// the note names the run the lead came from, as a lead's own proposal does, and no session: the pass
			// has none to open (jarvis.ProposalRun reads the run alone)
			by := jarvis.NoteAuthor{Who: "agent", Run: "run:" + p.RunOID}
			chunk := jarvis.ExactLabelRef + p.Label
			ops := []wshrpc.EffortOp{
				{Op: "setChunkStatus", Chunk: chunk, Status: "proposed"},
				{Op: "appendNote", Chunk: chunk, Note: jarvis.ProposedNote},
			}
			if err := jarvis.ApplyEffortOpsAs(e, ops, "", now, by); err != nil {
				return err
			}
		}
		moved = len(picks)
		return nil
	})
	if errors.Is(err, errNoBacklogChunks) {
		return 0, nil
	}
	return moved, err
}

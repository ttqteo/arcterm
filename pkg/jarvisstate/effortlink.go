// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisstate

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// AttachRunToChunk records that a run is working a chunk (idempotent; refreshes the ref ts). Used by
// CreateRunCommand when the composer picked an effort chunk. Advisory only — nothing auto-ticks.
func AttachRunToChunk(ctx context.Context, effortOID, chunkRef, runORef string) error {
	if _, err := effortstore.Get(ctx, effortOID); err != nil {
		return err
	}
	return effortstore.Update(ctx, effortOID, func(e *waveobj.Effort) error {
		return jarvis.ApplyEffortOps(e, []wshrpc.EffortOp{{
			Op: "attachWork", Chunk: chunkRef, Kind: "run", ORef: runORef,
		}}, "", time.Now().UnixMilli())
	})
}

// DetachRunFromChunk removes a run's workref from whichever chunk holds it (idempotent). Called at
// evidence seal so a finished run stops claiming a chunk.
func DetachRunFromChunk(ctx context.Context, effortOID, runORef string) error {
	if _, err := effortstore.Get(ctx, effortOID); err != nil {
		return err
	}
	return effortstore.Update(ctx, effortOID, func(e *waveobj.Effort) error {
		return jarvis.ApplyEffortOps(e, []wshrpc.EffortOp{{
			Op: "detachWork", ORef: runORef,
		}}, "", time.Now().UnixMilli())
	})
}

// AttachRunToChunks is the hold a run started from To review takes on every chunk ticked for it: each chunk that is
// still proposed turns pending (it is being worked now), and the run is attached to all of them. One effort is one
// batch, so a run can hold two chunks of one initiative: ApplyEffortOps checks every op against the effort as it was
// before the batch, and attachWork's "one live chunk at a time" rule only looks at chunks other than the target. A
// later lone AttachRunToChunk of the same run to a third chunk is still refused. Idempotent. An initiative that
// cannot take the run (gone, a chunk that no longer resolves) does not keep the others from it: every effort is tried
// and the errors come back joined.
func AttachRunToChunks(ctx context.Context, refs []waveobj.RunEffortRef, runORef string) error {
	var order []string
	labels := map[string][]string{}
	for _, ref := range refs {
		seen := slices.Contains(labels[ref.EffortOID], ref.ChunkLabel)
		if _, ok := labels[ref.EffortOID]; !ok {
			order = append(order, ref.EffortOID)
		}
		if !seen {
			labels[ref.EffortOID] = append(labels[ref.EffortOID], ref.ChunkLabel)
		}
	}
	var errs []error
	for _, oid := range order {
		chunks := labels[oid]
		// a chunk the run already holds is done: attaching it again would be refused beside the hold it has on its
		// sibling, which is what makes a second identical call a no-op instead of an error
		attachOps := func(e *waveobj.Effort) ([]wshrpc.EffortOp, error) {
			var flip, attach []wshrpc.EffortOp
			for _, label := range chunks {
				idx, err := jarvis.ResolveChunkIndex(e, label)
				if err != nil {
					return nil, err
				}
				if slices.ContainsFunc(e.Chunks[idx].WorkRefs, func(w waveobj.ChunkWorkRef) bool { return w.ORef == runORef }) {
					continue
				}
				if e.Chunks[idx].Status == "proposed" {
					flip = append(flip, wshrpc.EffortOp{Op: "setChunkStatus", Chunk: label, Status: "pending"})
				}
				attach = append(attach, wshrpc.EffortOp{Op: "attachWork", Chunk: label, Kind: "run", ORef: runORef})
			}
			return append(flip, attach...), nil
		}
		cur, err := effortstore.Get(ctx, oid)
		if err == nil {
			var ops []wshrpc.EffortOp
			if ops, err = attachOps(cur); err == nil && len(ops) == 0 {
				continue
			}
		}
		if err == nil {
			err = effortstore.Update(ctx, oid, func(e *waveobj.Effort) error {
				ops, err := attachOps(e)
				if err != nil || len(ops) == 0 {
					return err
				}
				return jarvis.ApplyEffortOps(e, ops, "", time.Now().UnixMilli())
			})
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("effort %s: %w", oid, err))
		}
	}
	return errors.Join(errs...)
}

// DetachRunEverywhere removes a run's workref from every chunk of every initiative that holds it, and returns the
// chunks it was on: the release a run makes when it ends. A chunk keeps the status it has (a release frees the run's
// hold, it does not decide what became of the work). Idempotent: a run that holds nothing returns no chunks.
func DetachRunEverywhere(ctx context.Context, runORef string) ([]waveobj.RunEffortRef, error) {
	all, err := effortstore.GetAll(ctx)
	if err != nil {
		return nil, err
	}
	var released []waveobj.RunEffortRef
	var errs []error
	for _, listed := range all {
		if len(chunksHolding(listed, runORef)) == 0 {
			continue
		}
		var held []waveobj.RunEffortRef
		err := effortstore.Update(ctx, listed.OID, func(e *waveobj.Effort) error {
			// read again under the effort's lock: the listing may be a moment old
			held = chunksHolding(e, runORef)
			if len(held) == 0 {
				return nil
			}
			return jarvis.ApplyEffortOps(e, []wshrpc.EffortOp{{Op: "detachWork", ORef: runORef}}, "", time.Now().UnixMilli())
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("effort %s: %w", listed.OID, err))
			continue
		}
		released = append(released, held...)
	}
	return released, errors.Join(errs...)
}

// chunksHolding is the chunks of e that carry runORef as a workref.
func chunksHolding(e *waveobj.Effort, runORef string) []waveobj.RunEffortRef {
	var out []waveobj.RunEffortRef
	for _, c := range e.Chunks {
		for _, w := range c.WorkRefs {
			if w.ORef == runORef {
				out = append(out, waveobj.RunEffortRef{EffortOID: e.OID, ChunkLabel: c.Label})
				break
			}
		}
	}
	return out
}

// RunFinishedPrefix opens the note a sealed run leaves on its chunk; NoteRunFinished keys idempotence on it.
const RunFinishedPrefix = "Run finished"

// RunFinishedText is the one line a sealed run's chunk note reads as: the report's title, else the first
// line of the sealed summary, else the goal. The full report renders under the note (Chunk sidebar).
func RunFinishedText(r *waveobj.Run) string {
	first := func(s string) string {
		for _, l := range strings.Split(s, "\n") {
			if t := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(l), "# ")); t != "" {
				return t
			}
		}
		return ""
	}
	line := first(r.Report)
	if line == "" && r.Evidence != nil {
		line = first(r.Evidence.Summary)
	}
	if line == "" {
		line = r.Goal
	}
	return RunFinishedPrefix + ": " + line
}

// NoteRunFinished drops an agent note carrying the run's oref on the chunk the run executed. Idempotent
// per run, because the seal backfill can run more than once.
func NoteRunFinished(ctx context.Context, ref waveobj.RunEffortRef, runORef, text string) error {
	if _, err := effortstore.Get(ctx, ref.EffortOID); err != nil {
		return err
	}
	return effortstore.Update(ctx, ref.EffortOID, func(e *waveobj.Effort) error {
		idx, err := jarvis.ResolveChunkIndex(e, ref.ChunkLabel)
		if err != nil {
			return err
		}
		for _, n := range e.Chunks[idx].Notes {
			if n.Run == runORef && strings.HasPrefix(n.Text, RunFinishedPrefix) {
				return nil
			}
		}
		return jarvis.ApplyEffortOpsAs(e, []wshrpc.EffortOp{{Op: "appendNote", Chunk: ref.ChunkLabel, Note: text}},
			"", time.Now().UnixMilli(), jarvis.NoteAuthor{Who: "agent", Run: runORef})
	})
}

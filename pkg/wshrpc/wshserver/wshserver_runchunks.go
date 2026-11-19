// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jarvisstate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// runChunksTimeout bounds taking or releasing a run's chunks: a few quick effort writes, which must not inherit an
// RPC budget a slow landing tree has already spent.
const runChunksTimeout = 30 * time.Second

// checkEffortChunk is CreateRun's up-front check of an effort chunk a run is to work: the initiative exists and the
// chunk resolves in it. The errors carry the codes `wsh effort` prints.
func checkEffortChunk(ctx context.Context, effortOID, chunkLabel string) error {
	eff, err := effortstore.Get(ctx, effortOID)
	if err != nil {
		return fmt.Errorf("EC-UNKNOWN-EFFORT: %v", err)
	}
	if chunkLabel == "" {
		return fmt.Errorf("EC-UNKNOWN-CHUNK: chunklabel is required when effortoid is set")
	}
	_, err = jarvis.ResolveChunkIndex(eff, chunkLabel)
	return err
}

// applyRunChunks makes a started run the holder of the chunks it was started on (data.Chunks, from To review): each
// proposed one turns pending and carries the run, one batch per initiative. It runs once the run has really started
// (its plan's dag submitted, its first worker up, or a deferred start), and once more for a run whose first worker
// would not start, which stays persisted, blocked and retryable. It is synchronous so the reply that follows shows
// the chunks held, and a failure is logged, not returned: the run is already running.
func applyRunChunks(ctx context.Context, data wshrpc.CommandCreateRunData, run *waveobj.Run) {
	if len(data.Chunks) == 0 {
		return
	}
	actx, cancel := context.WithTimeout(context.WithoutCancel(ctx), runChunksTimeout)
	defer cancel()
	if err := jarvisstate.AttachRunToChunks(actx, data.Chunks, "run:"+run.ID); err != nil {
		log.Printf("CreateRun: run %s: taking its To review chunks failed (non-fatal): %v", run.ID, err)
	}
}

// releaseRunChunks is what a run that ends gives back: it lets go of every chunk it holds on every initiative, and for
// a done run leaves the "Run finished" note on each of them (jarvisstate.NoteRunFinished). A cancelled run finished
// nothing, so its chunks are only freed, and stay pending on their initiatives for the person to settle. A run from
// before runs held several chunks has no workref to find, so a done one still gets its note on the chunk its
// EffortRef names. Idempotent, since the seal backfill can run more than once, and non-fatal: the run itself holds
// the record, and the release is a pointer.
func releaseRunChunks(ctx context.Context, run *waveobj.Run, logPrefix string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), runChunksTimeout)
	defer cancel()
	runORef := "run:" + run.ID
	held, err := jarvisstate.DetachRunEverywhere(ctx, runORef)
	if err != nil {
		log.Printf("%s: releasing run %s's chunks failed (non-fatal): %v", logPrefix, run.ID, err)
	}
	if run.Status != jarvis.RunStatus_Done {
		return
	}
	if len(held) == 0 && run.EffortRef != nil {
		held = []waveobj.RunEffortRef{*run.EffortRef}
	}
	text := jarvisstate.RunFinishedText(run)
	for _, ref := range held {
		if nerr := jarvisstate.NoteRunFinished(ctx, ref, runORef, text); nerr != nil {
			log.Printf("%s: noting the finished run on chunk %q failed (non-fatal): %v", logPrefix, ref.ChunkLabel, nerr)
		}
	}
}

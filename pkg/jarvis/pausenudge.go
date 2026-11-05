// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"errors"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// pausedNudgeText is the first turn of an agent reopened after its run was paused. It always ends by telling the
// agent to ask again, because an ask waits in memory only: a restart drops it, and an answer the person gave while the
// run was paused rides after this text when there is one.
const pausedNudgeText = "Arc paused this run to free memory and has now resumed it; carry on from where you stopped. " +
	"If you were waiting on an answer that is not below, ask again."

// heldAnswerPrefix starts the line that carries one answer the person gave while the run was paused.
const heldAnswerPrefix = "While you were paused, the person answered your question: "

// PausedNudge is the nudge a resumed agent starts with, for the worker in tab workerORef: the pause text, then a line
// for each answer the person gave one of its open questions while the run was paused. It takes those answers, so each
// reaches the agent once. A tab that cannot be read has none to carry: the text alone still tells the agent to ask again.
func PausedNudge(ctx context.Context, workerORef string) string {
	var b strings.Builder
	b.WriteString(pausedNudgeText)
	for _, blockORef := range workerBlockORefs(ctx, workerORef) {
		for _, held := range agentask.TakeHeldAnswers(blockORef) {
			b.WriteString("\n" + heldAnswerPrefix + oneLine(held.Question) + " → " + oneLine(strings.Join(held.Answers, ", ")))
		}
	}
	return b.String()
}

// workerBlockORefs is the oref of each block of the worker's tab, which is what its pending asks and held answers are
// keyed by. A tab that is gone has none.
func workerBlockORefs(ctx context.Context, workerORef string) []string {
	oref, err := waveobj.ParseORef(workerORef)
	if err != nil || oref.OType != waveobj.OType_Tab {
		return nil
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, oref.OID)
	if errors.Is(err, wstore.ErrNotFound) {
		return nil
	}
	if err != nil {
		log.Printf("paused nudge: loading tab %s: %v", workerORef, err)
		return nil
	}
	orefs := make([]string, len(tab.BlockIds))
	for i, blockId := range tab.BlockIds {
		orefs[i] = waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	}
	return orefs
}

// oneLine puts text on one line: a nudge is a command-line argument, and an answer is the person's own words.
func oneLine(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

// blockRunPaused reports whether the run that owns block's tab is paused (RunPaused), found through the owner stamp
// the exit hook reads. A block with no tab, no stamp or a run that is gone belongs to no paused run.
func blockRunPaused(ctx context.Context, block *waveobj.Block) (bool, error) {
	tabORef, err := waveobj.ParseORef(block.ParentORef)
	if err != nil || tabORef.OType != waveobj.OType_Tab {
		return false, nil
	}
	runORefStr, _, err := wstore.GetWorkerOwner(ctx, block.ParentORef)
	if errors.Is(err, wstore.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	runORef, err := waveobj.ParseORef(runORefStr)
	if err != nil || runORef.OType != waveobj.OType_Run {
		return false, nil
	}
	run, err := wstore.DBGet[*waveobj.Run](ctx, runORef.OID)
	if err != nil {
		return false, err
	}
	return RunPaused(run), nil
}

// answerHeld is agentask.HoldAnswer: an answer for a block of a paused run is held, since the agent's process is
// gone. A run that cannot be read is treated as not paused: the answer is typed as before.
func answerHeld(blockORef string) bool {
	oref, err := waveobj.ParseORef(blockORef)
	if err != nil || oref.OType != waveobj.OType_Block {
		return false
	}
	ctx := context.Background()
	block, err := wstore.DBGet[*waveobj.Block](ctx, oref.OID)
	if err != nil || block == nil {
		if err != nil {
			log.Printf("holding an answer for %s: loading the block: %v", blockORef, err)
		}
		return false
	}
	paused, err := blockRunPaused(ctx, block)
	if err != nil {
		log.Printf("holding an answer for %s: reading its run: %v", blockORef, err)
		return false
	}
	return paused
}

func init() {
	agentask.HoldAnswer = answerHeld
}

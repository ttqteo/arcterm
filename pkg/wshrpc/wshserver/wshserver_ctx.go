// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"slices"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// ownerRunForBlock resolves the run owning a block (block -> tab via ParentORef -> the run whose
// phases list that tab as a worker) plus its channel. Found=false for any unresolvable step — callers
// degrade gracefully (an ask from an unrelated block is not a dag child's ask).
func ownerRunForBlock(ctx context.Context, blockOrefStr string) (*waveobj.Run, string, bool) {
	if blockOrefStr == "" {
		return nil, "", false
	}
	oref, err := waveobj.ParseORef(blockOrefStr)
	if err != nil || oref.OType != waveobj.OType_Block {
		return nil, "", false
	}
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, oref.OID)
	if err != nil || block.ParentORef == "" {
		return nil, "", false
	}
	tabORef, err := waveobj.ParseORef(block.ParentORef)
	if err != nil || tabORef.OType != waveobj.OType_Tab {
		return nil, "", false
	}
	tabOrefStr := "tab:" + tabORef.OID
	// the store narrows to the rows that mention the tab without decoding any: every effort update and
	// ask resolves its block here, and decoding every run each time was a quarter of what wavesrv allocated
	runs, err := wstore.GetRunCandidatesByWorker(ctx, tabOrefStr)
	if err != nil {
		return nil, "", false
	}
	for _, run := range runs {
		if !runHasWorker(run, tabOrefStr) {
			continue
		}
		// a run whose channel is gone owns nothing
		if ch, cerr := wstore.DBGet[*waveobj.Channel](ctx, run.ChannelOID); cerr != nil || ch == nil {
			continue
		}
		return run, run.ChannelOID, true
	}
	return nil, "", false
}

func runHasWorker(run *waveobj.Run, workerORef string) bool {
	for _, p := range run.Phases {
		if slices.Contains(p.WorkerOrefs, workerORef) {
			return true
		}
	}
	return false
}

// JarvisCtxCommand resolves the run context owning the caller's block: block -> tab (ParentORef) ->
// the run whose phases list that tab as a worker. Empty for an unresolvable caller — the lead's
// `wsh jarvis dag` commands fall back on this so the engine's own session never needs to dig ids out
// of the database (the "run context is not injected" flaw).
func (ws *WshServer) JarvisCtxCommand(ctx context.Context, data wshrpc.CommandJarvisCtxData) (*wshrpc.CommandJarvisCtxRtnData, error) {
	rtn := &wshrpc.CommandJarvisCtxRtnData{}
	run, channelId, ok := ownerRunForBlock(ctx, data.BlockORef)
	if !ok {
		return rtn, nil
	}
	rtn.ChannelId = channelId
	rtn.RunId = run.ID
	rtn.DagOID = run.DagORef
	rtn.Goal = run.Goal
	return rtn, nil
}

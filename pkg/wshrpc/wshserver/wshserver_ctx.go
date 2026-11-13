// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// ownerRunForBlock resolves the run owning a block (block -> tab via ParentORef -> the run the tab's owner
// stamp names, or else the run whose phases list that tab as a worker) plus its channel. Found=false for any
// unresolvable step — callers degrade gracefully (an ask from an unrelated block is not a dag child's ask).
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
	// a stamped tab's run is read off its stamp; a tab with no usable stamp falls back to the store's narrowed scan
	// of the run rows (jarvis.ResolveRunWorkerFromMeta), which skips a run whose channel is gone. Every effort
	// update, resmon snapshot and ask resolves its block here, and the scan alone was ~330 ms per call on a store
	// of thousands of runs.
	m := jarvis.ResolveRunWorkerFromMeta(ctx, "tab:"+tabORef.OID)
	if m == nil {
		return nil, "", false
	}
	return m.Run, m.Channel.OID, true
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

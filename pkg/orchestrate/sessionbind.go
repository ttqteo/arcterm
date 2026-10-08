// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"log"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// assignsOwnSession reports a runtime that names its own conversation and takes no --session-id.
func assignsOwnSession(runtime string) bool {
	spec, ok := harness.Lookup(runtime)
	return ok && spec.AssignsOwnSession
}

// NoteWorkerSession binds an engine worker's session id late. A runtime that names its own conversation
// (agy) is spawned with no id, so its first status report is the first time arcterm learns it. The report's
// block is resolved to its tab, and the tab to the child run the engine stamped on it at spawn; the id is
// written to that run, and the latest one wins. Only a child whose own runtime names its session is bound, so
// a nested `agy -p` inside a claude or pi worker's block never touches that worker's launch-time id.
// Errors are logged, never returned: this runs on the publish path of every status event.
func NoteWorkerSession(ctx context.Context, ev *wps.WaveEvent) {
	if ev == nil || ev.Event != wps.Event_AgentStatus {
		return
	}
	var data baseds.AgentStatusData
	if utilfn.ReUnmarshal(&data, ev.Data) != nil || data.SessionID == "" || data.ORef == "" || !assignsOwnSession(data.Agent) {
		return
	}
	oref, err := waveobj.ParseORef(data.ORef)
	if err != nil || oref.OType != waveobj.OType_Block {
		return
	}
	block, err := wstore.DBGet[*waveobj.Block](ctx, oref.OID)
	if err != nil || block == nil {
		return
	}
	tabORef, err := waveobj.ParseORef(block.ParentORef)
	if err != nil || tabORef.OType != waveobj.OType_Tab {
		return
	}
	runORefStr, channelORefStr, err := wstore.GetWorkerOwner(ctx, tabORef.String())
	if err != nil || runORefStr == "" || channelORefStr == "" {
		return
	}
	runORef, rerr := waveobj.ParseORef(runORefStr)
	channelORef, cerr := waveobj.ParseORef(channelORefStr)
	if rerr != nil || cerr != nil {
		return
	}
	run, err := wstore.GetRun(ctx, channelORef.OID, runORef.OID)
	if err != nil || run == nil || !assignsOwnSession(run.Runtime) || run.SessionId == data.SessionID {
		return
	}
	err = wstore.UpdateRun(ctx, channelORef.OID, runORef.OID, func(r *waveobj.Run) error {
		r.SessionId = data.SessionID
		return nil
	})
	if err != nil {
		log.Printf("orchestrate: binding session %s to run %s: %v", data.SessionID, run.ID, err)
	}
}

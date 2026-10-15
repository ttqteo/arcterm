// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/keepawake"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// The check that holds the Mac awake while work runs: keepawake decides, this file gathers the facts.

// keepAwakeEvery is well inside the 11 minutes a Mac on battery takes to sleep after the person leaves it.
const keepAwakeEvery = 30 * time.Second

// keepAwakeFacts is everything one check counts, the battery read only when there is work to hold for.
func keepAwakeFacts(ctx context.Context, now time.Time) (keepawake.Facts, error) {
	var f keepawake.Facts
	runs, err := wstore.GetRunsByStatus(ctx, jarvis.RunStatus_Planning, jarvis.RunStatus_Executing)
	if err != nil {
		return f, err
	}
	for _, r := range runs {
		if runqueue.TopLevel(r) {
			f.ActiveRuns++
		}
	}
	tabs, err := wstore.DBGetAllObjsByType[*waveobj.Tab](ctx, waveobj.OType_Tab)
	if err != nil {
		return f, err
	}
	for _, tab := range tabs {
		if len(tab.BlockIds) == 0 {
			continue
		}
		blockId := tab.BlockIds[0]
		rs := blockcontroller.GetBlockControllerRuntimeStatus(blockId)
		if rs == nil || rs.ShellProcStatus != blockcontroller.Status_Running {
			continue
		}
		st := orchestrate.LatestAgentStatus(blockId, tab.OID)
		if keepawake.Working(st.State, st.Ts, now) {
			f.WorkingAgents++
		}
	}
	if q := jobqueue.Default; q != nil {
		for _, j := range q.Snapshot().Jobs {
			if j.Running {
				f.RunningJobs++
			}
		}
	}
	f.Battery = keepawake.Battery{Pct: -1}
	if f.ActiveRuns > 0 || f.WorkingAgents > 0 || f.RunningJobs > 0 {
		f.Battery = keepawake.ReadBattery(ctx)
	}
	return f, nil
}

// StartKeepAwake runs the check every keepAwakeEvery for the life of ctx, and logs each time the hold is taken or
// dropped.
func StartKeepAwake(ctx context.Context) {
	go func() {
		var holder keepawake.Holder
		defer holder.Set(false)
		held := false
		ticker := time.NewTicker(keepAwakeEvery)
		defer ticker.Stop()
		for {
			func() {
				defer func() { panichandler.PanicHandler("keepawake:loop", recover()) }()
				on := wconfig.GetWatcher().GetFullConfig().Settings.PowerKeepAwake
				facts, err := keepAwakeFacts(ctx, time.Now())
				if err != nil {
					log.Printf("keepawake: %v\n", err)
					return
				}
				hold, why := keepawake.Decide(on == nil || *on, facts)
				if err := holder.Set(hold); err != nil {
					log.Printf("keepawake: %v\n", err)
					return
				}
				if hold != held {
					if hold {
						log.Printf("keepawake: holding the Mac awake (%s)\n", why)
					} else {
						log.Printf("keepawake: let go (%s)\n", why)
					}
					held = hold
				}
			}()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

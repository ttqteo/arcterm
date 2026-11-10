// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/runpause"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

// An agent of a run whose turn the usage limit ended pauses the whole top-level run until the limit resets
// (runpause.PauseForLimit), instead of the stall check retrying the worker into the same limit.

// the side effects, as vars so tests script them
var (
	limitOwnerRun = func(ctx context.Context, blockORef string) (runId, channelId string, ok bool) {
		run, ch, found := ownerRunForBlock(ctx, blockORef)
		if !found {
			return "", "", false
		}
		return run.ID, ch, true
	}
	limitTopRun   = runpause.TopRunOf
	limitQuota    = func(ctx context.Context) *claudequota.Quota { q, _ := claudequota.Refresh(ctx); return q }
	limitPauseRun = runpause.PauseForLimit
	limitGo       = func(fn func()) { go fn() }
)

// atUsageLimit is the block oref of an agent-status event that reports a turn the usage limit ended, "" otherwise.
func atUsageLimit(ev *wps.WaveEvent) string {
	var d baseds.AgentStatusData
	if utilfn.ReUnmarshal(&d, ev.Data) != nil {
		return ""
	}
	if d.Hook != baseds.AgentHook_StopFailure || d.Detail != baseds.StopFailureDetail_UsageLimit {
		return ""
	}
	oref, err := waveobj.ParseORef(d.ORef)
	if err != nil || oref.OType != waveobj.OType_Block {
		return ""
	}
	return d.ORef
}

// noteUsageLimit pauses the top-level run of an agent that hit the usage limit, off the publishing goroutine: it asks
// the usage endpoint for the reset. An agent of no run (one the person runs) is left alone.
func noteUsageLimit(ctx context.Context, ev *wps.WaveEvent) {
	blockORef := atUsageLimit(ev)
	if blockORef == "" {
		return
	}
	ctx = context.WithoutCancel(ctx)
	limitGo(func() {
		runId, channelId, ok := limitOwnerRun(ctx, blockORef)
		if !ok {
			return
		}
		top, err := limitTopRun(ctx, channelId, runId)
		if err != nil {
			log.Printf("run limit: %s hit the usage limit, but its run has no top: %v\n", blockORef, err)
			return
		}
		resumeAt := runpause.LimitResumeAt(limitQuota(ctx), time.Now())
		if err := limitPauseRun(ctx, channelId, top, resumeAt); err != nil {
			// already paused: another of its agents got there first, or the person paused it
			log.Printf("run limit: not pausing run %s at the usage limit: %v\n", top, err)
			return
		}
		log.Printf("run limit: paused run %s at the usage limit (%s); it resumes after %s\n", top, blockORef, resumeAt.Format(time.RFC3339))
	})
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

func limitEvent(hook, detail, oref string) *wps.WaveEvent {
	return &wps.WaveEvent{Event: wps.Event_AgentStatus, Data: baseds.AgentStatusData{
		ORef: oref, State: baseds.AgentState_Idle, Hook: hook, Detail: detail, Ts: 1,
	}}
}

type limitWorld struct {
	paused []string
	err    error
}

func newLimitWorld(t *testing.T) *limitWorld {
	w := &limitWorld{}
	swap(t, &limitGo, func(fn func()) { fn() })
	swap(t, &limitOwnerRun, func(_ context.Context, blockORef string) (string, string, bool) {
		if blockORef == "block:5f3c1a2e-8b4d-4c6e-9a1f-2b3c4d5e6f70" {
			return "task-run", "chan", true
		}
		return "", "", false
	})
	swap(t, &limitTopRun, func(_ context.Context, channelId, runId string) (string, error) { return "top-run", nil })
	swap(t, &limitQuota, func(context.Context) *claudequota.Quota { return nil })
	swap(t, &limitPauseRun, func(_ context.Context, channelId, runId string, resumeAt time.Time) error {
		if w.err != nil {
			return w.err
		}
		w.paused = append(w.paused, channelId+"/"+runId)
		return nil
	})
	return w
}

func TestUsageLimitPausesTheWorkersTopRun(t *testing.T) {
	w := newLimitWorld(t)
	noteUsageLimit(context.Background(), limitEvent(baseds.AgentHook_StopFailure, baseds.StopFailureDetail_UsageLimit, "block:5f3c1a2e-8b4d-4c6e-9a1f-2b3c4d5e6f70"))
	if len(w.paused) != 1 || w.paused[0] != "chan/top-run" {
		t.Fatalf("paused %v, want the worker's top-level run", w.paused)
	}
}

func TestUsageLimitLeavesTheRestAlone(t *testing.T) {
	w := newLimitWorld(t)
	for name, ev := range map[string]*wps.WaveEvent{
		"another api error":     limitEvent(baseds.AgentHook_StopFailure, "", "block:5f3c1a2e-8b4d-4c6e-9a1f-2b3c4d5e6f70"),
		"a plain stop":          limitEvent(baseds.AgentHook_Stop, "", "block:5f3c1a2e-8b4d-4c6e-9a1f-2b3c4d5e6f70"),
		"an agent of no run":    limitEvent(baseds.AgentHook_StopFailure, baseds.StopFailureDetail_UsageLimit, "block:6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d"),
		"a tab-scoped report":   limitEvent(baseds.AgentHook_StopFailure, baseds.StopFailureDetail_UsageLimit, "tab:5f3c1a2e-8b4d-4c6e-9a1f-2b3c4d5e6f70"),
		"an event with no data": {Event: wps.Event_AgentStatus},
	} {
		noteUsageLimit(context.Background(), ev)
		if len(w.paused) != 0 {
			t.Fatalf("%s: paused %v", name, w.paused)
		}
	}
	// a run already paused refuses, and nothing else happens
	w.err = errors.New("run top-run is already paused")
	noteUsageLimit(context.Background(), limitEvent(baseds.AgentHook_StopFailure, baseds.StopFailureDetail_UsageLimit, "block:5f3c1a2e-8b4d-4c6e-9a1f-2b3c4d5e6f70"))
	if len(w.paused) != 0 {
		t.Fatalf("paused %v on a refusal", w.paused)
	}
}

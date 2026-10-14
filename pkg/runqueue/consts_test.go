// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runqueue_test

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// pkg/runqueue cannot import jarvis or orchestrate (jarvis imports runqueue, orchestrate imports jarvis), so its
// rules spell the statuses and land states as literals. This external test imports both and fails when a literal
// has drifted from the constant it copies.

func landedRun(status, landState string, dirty bool) *waveobj.Run {
	return &waveobj.Run{Status: status, Land: &waveobj.RunLand{State: landState, Reason: "why", Dirty: dirty}}
}

func TestOutcomeLiteralsMatchTheirSources(t *testing.T) {
	cases := []struct {
		name   string
		run    *waveobj.Run
		final  bool
		landed bool
		reason string
	}{
		{"landed", landedRun(jarvis.RunStatus_Done, orchestrate.LandState_Landed, false), true, true, ""},
		{"held", landedRun(jarvis.RunStatus_Done, orchestrate.LandState_Held, false), true, false, "why"},
		{"dirty hold", landedRun(jarvis.RunStatus_Done, orchestrate.LandState_Held, true), false, false, ""},
		{"land pending", landedRun(jarvis.RunStatus_Done, orchestrate.LandState_Pending, false), false, false, ""},
		{"land queued", landedRun(jarvis.RunStatus_Done, orchestrate.LandState_Queued, false), false, false, ""},
		{"land resolving", landedRun(jarvis.RunStatus_Done, orchestrate.LandState_Resolving, false), false, false, ""},
		{"done in the checkout", &waveobj.Run{Status: jarvis.RunStatus_Done}, true, true, ""},
		{"done on a branch not yet landed", &waveobj.Run{Status: jarvis.RunStatus_Done, LandPath: "/wt"}, false, false, ""},
		{"cancelled", &waveobj.Run{Status: jarvis.RunStatus_Cancelled}, true, false, "cancelled"},
		{"executing", &waveobj.Run{Status: jarvis.RunStatus_Executing}, false, false, ""},
	}
	for _, c := range cases {
		final, landed, reason := runqueue.Outcome(c.run)
		if final != c.final || landed != c.landed || reason != c.reason {
			t.Errorf("%s: Outcome = (%v, %v, %q), want (%v, %v, %q)", c.name, final, landed, reason, c.final, c.landed, c.reason)
		}
	}
}

func TestActiveLiteralsMatchTheirSources(t *testing.T) {
	statuses := []string{
		jarvis.RunStatus_Planning,
		jarvis.RunStatus_AwaitingReview,
		jarvis.RunStatus_Executing,
		jarvis.RunStatus_Blocked,
	}
	for _, status := range statuses {
		if got := runqueue.Active([]*waveobj.Run{{Status: status}}); got != 1 {
			t.Errorf("a %s run counts %d, want 1", status, got)
		}
	}
	for _, status := range []string{jarvis.RunStatus_Done, jarvis.RunStatus_Cancelled} {
		if got := runqueue.Active([]*waveobj.Run{{Status: status}}); got != 0 {
			t.Errorf("a %s run counts %d, want 0", status, got)
		}
	}
}

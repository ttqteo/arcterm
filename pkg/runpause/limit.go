// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runpause

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Pausing a run at the usage limit. A Claude worker whose turn the account's usage limit ended reports a StopFailure
// (baseds.StopFailureDetail_UsageLimit). Left alone, its transcript stops growing, the stall check retries it 15
// minutes later and the new worker hits the same limit, until the retries run out. PauseForLimit pauses the whole
// top-level run instead, its NoAutoResumeUntil just past the reset: the pause frees the RAM its agents hold, and the
// regulator resumes the run once the limit has reset and the RAM is there, each agent reopening with the paused nudge.

const (
	// limitResumeMargin is how long past the reading's reset the run waits: the reset falls on the hour
	limitResumeMargin = 2 * time.Minute
	// limitRecheck is how long a run waits when no reading names a reset ahead: one resumed too early hits the limit
	// again and pauses once more
	limitRecheck = 30 * time.Minute
)

// LimitResumeAt is when a run that hit the usage limit at now may resume: just past the reset of the window the
// reading shows used up (the latest when several are), else past the five-hour window's reset while it is still
// ahead (a reading taken before the last requests), else limitRecheck from now.
func LimitResumeAt(q *claudequota.Quota, now time.Time) time.Time {
	if q == nil {
		return now.Add(limitRecheck)
	}
	var at time.Time
	usedUp := func(pct *float64, reset *int64) {
		if pct == nil || *pct < 100 || reset == nil {
			return
		}
		if t := time.Unix(*reset, 0); t.After(now) && t.After(at) {
			at = t
		}
	}
	usedUp(q.FiveHourPct, q.FiveHourReset)
	usedUp(q.WeekPct, q.WeekReset)
	for _, w := range q.ScopedWeeks {
		usedUp(&w.Pct, w.Reset)
	}
	if at.IsZero() && q.FiveHourReset != nil {
		if t := time.Unix(*q.FiveHourReset, 0); t.After(now) {
			at = t
		}
	}
	if at.IsZero() {
		return now.Add(limitRecheck)
	}
	return at.Add(limitResumeMargin)
}

// PauseForLimit pauses the top-level run runId because one of its agents hit the usage limit, and holds it paused
// until resumeAt. It refuses a run already paused (another of its workers got there first, or the person paused it),
// as Pause does.
func PauseForLimit(ctx context.Context, channelId, runId string, resumeAt time.Time) error {
	return pause(ctx, channelId, runId, By_Limit, resumeAt.UnixMilli())
}

// TopRunOf is the open top-level run whose tree holds runId in channelId: runId itself when it is top-level.
func TopRunOf(ctx context.Context, channelId, runId string) (string, error) {
	all, err := wstore.GetChannelRunsShared(ctx, channelId)
	if err != nil {
		return "", fmt.Errorf("listing the runs of channel %s: %w", channelId, err)
	}
	for _, r := range all {
		if r.ID == runId && runqueue.TopLevel(r) {
			return r.ID, nil
		}
	}
	for _, r := range all {
		if !runqueue.TopLevel(r) || r.Status == jarvis.RunStatus_Done || r.Status == jarvis.RunStatus_Cancelled {
			continue
		}
		t, err := walk(ctx, channelId, r.ID)
		if err != nil {
			continue
		}
		if t.byID[runId] != nil {
			return r.ID, nil
		}
	}
	return "", fmt.Errorf("run %s belongs to no open top-level run", runId)
}

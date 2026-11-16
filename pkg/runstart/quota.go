// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runstart

import (
	"fmt"
	"math"
	"slices"
	"time"

	"github.com/wavetermdev/waveterm/pkg/tokengate"
)

const (
	// MinQuotaSamples is how many earlier runs make an estimate of the next one's tokens worth trusting.
	MinQuotaSamples = 3
	// NearlySpentPct is how full a window must be, with no estimate to go by, before the note shows.
	NearlySpentPct = 85.0
)

// QuotaInput is the quota reading and the project's earlier runs. The percents are the share of each window used;
// the resets are epoch seconds, as the reading holds them. WindowTokens is the tokens the 5-hour window has seen so
// far, which sizes it. Samples are the summed tokens of the project's last done runs of the kind being started.
type QuotaInput struct {
	FiveHourPct, WeekPct     *float64
	FiveHourReset, WeekReset *int64
	WindowTokens             int64
	Samples                  []int64
	Now                      time.Time
	Loc                      *time.Location
}

// QuotaNote is the line the reason adds when the run is likely to hit a quota window: "Quota at 8%: the run will
// pause until 16:40, then carry on". It never holds a run; a run that hits the limit pauses and resumes after the
// reset by itself. With enough samples the median of them, as a share of the 5-hour window, is compared with what is
// left of it; with too few, or a window too empty to size, either window over NearlySpentPct shows the note (the
// 5-hour one first). "" when quota is fine, or the reading for the window that would speak lacks its percent or its
// reset, or that reset is already behind Now (a stale reading).
func QuotaNote(q QuotaInput) string {
	if len(q.Samples) >= MinQuotaSamples && q.FiveHourPct != nil {
		if share, ok := tokengate.WindowShare(median(q.Samples), q.WindowTokens, *q.FiveHourPct); ok {
			if float64(share) > 100-*q.FiveHourPct {
				return quotaLine(q, *q.FiveHourPct, q.FiveHourReset, false)
			}
			return ""
		}
	}
	if q.FiveHourPct != nil && *q.FiveHourPct > NearlySpentPct {
		return quotaLine(q, *q.FiveHourPct, q.FiveHourReset, false)
	}
	if q.WeekPct != nil && *q.WeekPct > NearlySpentPct {
		return quotaLine(q, *q.WeekPct, q.WeekReset, true)
	}
	return ""
}

func quotaLine(q QuotaInput, pct float64, reset *int64, weekly bool) string {
	if reset == nil {
		return ""
	}
	at := time.Unix(*reset, 0)
	if !q.Now.IsZero() && !at.After(q.Now) {
		return ""
	}
	loc := q.Loc
	if loc == nil {
		loc = time.Local
	}
	layout := "15:04"
	if weekly {
		layout = "Mon 15:04"
	}
	left := int(math.Round(max(100-pct, 0)))
	return fmt.Sprintf("Quota at %d%%: the run will pause until %s, then carry on", left, at.In(loc).Format(layout))
}

// median is the middle of samples (the mean of the middle pair when even), without reordering the caller's slice.
func median(samples []int64) int64 {
	s := slices.Clone(samples)
	slices.Sort(s)
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

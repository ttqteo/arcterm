// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runstart

import (
	"testing"
	"time"
)

func pctp(v float64) *float64 { return &v }
func tsp(t time.Time) *int64 {
	v := t.Unix()
	return &v
}

var (
	quotaNow = time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC) // a Monday
	reset5h  = time.Date(2026, 11, 16, 16, 40, 0, 0, time.UTC)
	resetWk  = time.Date(2026, 11, 23, 16, 40, 0, 0, time.UTC)
)

func quota(pct5, pctWk float64, samples ...int64) QuotaInput {
	return QuotaInput{
		FiveHourPct: pctp(pct5), WeekPct: pctp(pctWk), FiveHourReset: tsp(reset5h), WeekReset: tsp(resetWk),
		WindowTokens: 6_000_000, Samples: samples, Now: quotaNow, Loc: time.UTC,
	}
}

func TestQuotaNote(t *testing.T) {
	const m = int64(1_000_000)
	if quotaNow.Weekday() != time.Monday || resetWk.Weekday() != time.Monday {
		t.Fatal("the test's dates are meant to be Mondays")
	}
	cases := []struct {
		name string
		in   QuotaInput
		want string
	}{
		// 60% used on a window that has seen 6M tokens: the window holds 10M, 4M (40%) is left
		{"3 samples whose median share is over what is left", quota(60, 10, 4*m, 5*m, 6*m), "Quota at 40%: the run will pause until 16:40, then carry on"},
		{"3 samples whose median share is under what is left", quota(60, 10, 1*m, 2*m, 3*m), ""},
		{"a share just equal to what is left is no note", quota(60, 10, 4*m, 4*m, 4*m), ""},
		{"the median ignores one huge run", quota(60, 10, 1*m, 2*m, 100*m), ""},
		{"an even count takes the middle pair's mean, unsorted", quota(60, 10, 9*m, 1*m, 5*m, 4*m), "Quota at 40%: the run will pause until 16:40, then carry on"},
		// 90% used, window 9M: 10M capacity, a 0.5M run is 5% of it, 10% is left
		{"an estimate that fits wins over a nearly spent window", func() QuotaInput {
			q := quota(90, 10, 300_000, 500_000, 700_000)
			q.WindowTokens = 9 * m
			return q
		}(), ""},
		{"an estimate that does not fit shows the note", func() QuotaInput {
			q := quota(90, 10, 1*m, 2*m, 3*m)
			q.WindowTokens = 9 * m
			return q
		}(), "Quota at 10%: the run will pause until 16:40, then carry on"},
		{"the week is not weighed against an estimate", func() QuotaInput {
			q := quota(10, 95, 1*m, 1*m, 1*m)
			q.WindowTokens = 1 * m
			return q
		}(), ""},

		{"WindowShare false (no tokens in the window): over 85% shows the note", func() QuotaInput {
			q := quota(90, 10, 1*m, 2*m, 3*m)
			q.WindowTokens = 0
			return q
		}(), "Quota at 10%: the run will pause until 16:40, then carry on"},
		{"WindowShare false (window too empty): under 85% is no note", func() QuotaInput {
			q := quota(3, 10, 1*m, 2*m, 3*m)
			q.WindowTokens = 0
			return q
		}(), ""},
		{"WindowShare false (window under 5% used): the week can still speak", quota(3, 90, 1*m, 2*m, 3*m), "Quota at 10%: the run will pause until Mon 16:40, then carry on"},

		{"2 samples, 86% used", quota(86, 10, 1*m, 2*m), "Quota at 14%: the run will pause until 16:40, then carry on"},
		{"2 samples, 80% used", quota(80, 10, 1*m, 2*m), ""},
		{"no samples, exactly 85% is not over", quota(85, 85), ""},
		{"no samples, 5-hour over and week over: the 5-hour window speaks", quota(92, 99), "Quota at 8%: the run will pause until 16:40, then carry on"},
		{"a fractional percent rounds the remainder", quota(91.6, 10), "Quota at 8%: the run will pause until 16:40, then carry on"},
		{"a spent window", quota(100, 10), "Quota at 0%: the run will pause until 16:40, then carry on"},

		{"weekly wording adds the weekday", quota(10, 88), "Quota at 12%: the run will pause until Mon 16:40, then carry on"},
		{"a weekly reset in another zone", func() QuotaInput {
			q := quota(10, 88)
			q.Loc = time.FixedZone("ICT", 7*3600) // 16:40 UTC is 23:40 there
			return q
		}(), "Quota at 12%: the run will pause until Mon 23:40, then carry on"},
		{"a weekly reset past midnight in another zone moves the weekday", func() QuotaInput {
			q := quota(10, 88)
			q.Loc = time.FixedZone("ICT", 9*3600) // 01:40 on Tuesday
			return q
		}(), "Quota at 12%: the run will pause until Tue 01:40, then carry on"},

		{"no reading at all", QuotaInput{Now: quotaNow, Loc: time.UTC}, ""},
		{"no reading, with samples", QuotaInput{WindowTokens: 6 * m, Samples: []int64{1 * m, 2 * m, 3 * m}, Now: quotaNow, Loc: time.UTC}, ""},
		{"a percent with no reset", func() QuotaInput {
			q := quota(95, 10)
			q.FiveHourReset = nil
			return q
		}(), ""},
		{"a reset with no percent", func() QuotaInput {
			q := quota(10, 10)
			q.FiveHourPct = nil
			q.WeekPct = nil
			return q
		}(), ""},
		{"the week's reading missing leaves the 5-hour note alone", func() QuotaInput {
			q := quota(90, 0)
			q.WeekPct, q.WeekReset = nil, nil
			return q
		}(), "Quota at 10%: the run will pause until 16:40, then carry on"},
		{"a window that has already reset is no note", func() QuotaInput {
			q := quota(95, 10)
			q.Now = reset5h.Add(time.Hour)
			return q
		}(), ""},
		{"no Now: the reset is not judged stale", func() QuotaInput {
			q := quota(95, 10)
			q.Now = time.Time{}
			return q
		}(), "Quota at 5%: the run will pause until 16:40, then carry on"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := QuotaNote(c.in); got != c.want {
				t.Errorf("QuotaNote = %q, want %q", got, c.want)
			}
		})
	}
}

func TestQuotaNoteKeepsSamples(t *testing.T) {
	samples := []int64{9, 1, 5}
	q := quota(60, 10)
	q.Samples = samples
	QuotaNote(q)
	if samples[0] != 9 || samples[1] != 1 || samples[2] != 5 {
		t.Errorf("QuotaNote sorted the caller's samples: %v", samples)
	}
}

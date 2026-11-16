// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package dume is DUM-E: it spends the 5-hour Claude window's leftover quota, just before the window resets, on the
// initiative chunks the person handed it (owner "dum-e"). This file is the gate: given the quota, the clock and what
// else is running, start the next chunk or not, and say why in words the cockpit shows. Pure.
package dume

import (
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

const (
	startWithin     = 60 * time.Minute // a window starts only this close to its reset
	startMaxUsedPct = 70.0             // ... with at least 30 % of it left
	stopAtUsedPct   = 90.0             // a started window takes no new chunk past this
	stopWithin      = 10 * time.Minute // ... nor this close to its reset
	weekUnderPace   = 10.0             // the week must be this many points under even pace: leftover 5h quota still counts against it
	weekLen         = 7 * 24 * time.Hour
)

// Inputs is what the loop reads before each decision.
type Inputs struct {
	Enabled     bool
	Quota       *claudequota.Quota
	Now         time.Time
	OwnRunsLive int // top-level runs not DUM-E's, neither done nor cancelled
	DumeRunLive bool
	Pressure    jobqueue.Pressure
	ArmedReset  int64 // the 5h reset (epoch s) of the window DUM-E has started; 0 = none
	HasWork     bool  // a chunk waits for DUM-E
}

// Decision is the gate's answer. ArmedReset is what the loop keeps for the next tick.
type Decision struct {
	Start      bool
	ArmedReset int64
	Reason     string
}

func Decide(in Inputs) Decision {
	if !in.Enabled {
		return Decision{Reason: "off"}
	}
	q := in.Quota
	if q == nil || q.FiveHourPct == nil || q.FiveHourReset == nil {
		return Decision{Reason: "no 5h quota reading"}
	}
	reset := *q.FiveHourReset
	left := time.Unix(reset, 0).Sub(in.Now)
	if left <= 0 {
		return Decision{Reason: "the 5h window has reset; waiting for a new reading"}
	}
	used := *q.FiveHourPct
	armed := in.ArmedReset == reset
	keep := int64(0)
	if armed {
		keep = reset
		if used >= stopAtUsedPct {
			return Decision{ArmedReset: keep, Reason: fmt.Sprintf("5h window %.0f%% used: done for this window", used)}
		}
		if left <= stopWithin {
			return Decision{ArmedReset: keep, Reason: fmt.Sprintf("%s to reset: done for this window", fmtDur(left))}
		}
	} else {
		if left > startWithin {
			return Decision{Reason: fmt.Sprintf("%s to the 5h reset; starts within %s", fmtDur(left), fmtDur(startWithin))}
		}
		if used > startMaxUsedPct {
			return Decision{Reason: fmt.Sprintf("5h window %.0f%% used; starts with at least %.0f%% left", used, 100-startMaxUsedPct)}
		}
	}
	wpct, wreset, ok := weekReading(q)
	if !ok {
		return Decision{ArmedReset: keep, Reason: "no weekly reading"}
	}
	if pace := weekPace(in.Now, wreset); wpct > pace-weekUnderPace {
		return Decision{ArmedReset: keep, Reason: fmt.Sprintf("week %.0f%% used at %.0f%% pace; needs %.0f points under", wpct, pace, weekUnderPace)}
	}
	if in.OwnRunsLive > 0 {
		return Decision{ArmedReset: keep, Reason: fmt.Sprintf("%d of your runs live", in.OwnRunsLive)}
	}
	if in.Pressure == jobqueue.PressureWarn || in.Pressure == jobqueue.PressureCritical {
		return Decision{ArmedReset: keep, Reason: "memory pressure high"}
	}
	// past here the window is DUM-E's: it stays armed whether or not a chunk starts now
	if in.DumeRunLive {
		return Decision{ArmedReset: reset, Reason: "working"}
	}
	if !in.HasWork {
		return Decision{ArmedReset: reset, Reason: "no chunk owned by dum-e waiting"}
	}
	return Decision{Start: true, ArmedReset: reset, Reason: "starting"}
}

// weekReading is the account's week, else its highest model-scoped week (a Team seat has no all-model one).
func weekReading(q *claudequota.Quota) (pct float64, reset int64, ok bool) {
	if q.WeekPct != nil && q.WeekReset != nil {
		return *q.WeekPct, *q.WeekReset, true
	}
	for _, w := range q.ScopedWeeks {
		if w.Reset != nil && (!ok || w.Pct > pct) {
			pct, reset, ok = w.Pct, *w.Reset, true
		}
	}
	return pct, reset, ok
}

// weekPace is the share of the week gone at now, in percent: what an even spend would have used.
func weekPace(now time.Time, reset int64) float64 {
	start := time.Unix(reset, 0).Add(-weekLen)
	p := 100 * float64(now.Sub(start)) / float64(weekLen)
	return min(100, max(0, p))
}

// fmtDur is "40 min" under an hour, else "2h05".
func fmtDur(d time.Duration) string {
	m := int(d.Round(time.Minute) / time.Minute)
	if m < 60 {
		return fmt.Sprintf("%d min", m)
	}
	return fmt.Sprintf("%dh%02d", m/60, m%60)
}

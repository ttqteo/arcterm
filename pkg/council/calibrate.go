// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "math"

// The start estimate's formula (Estimate) counts a council's calls from its panel and prices each at a constant. Real
// councils make more calls than it counts (follow-ups, memory and region checks, retries), and each call costs several
// times more, because a seat rereads its context on every tool call and Run facts counts the cache reads
// (consult.go adds Input + CacheRead + CacheCreation + Output). The 2026-11-19 council on the council measured 4–9M for
// councils the formula priced at ~0.8–1.3M. Calibration closes that gap with what finished councils measured: calls ×
// cost per call. The council's memory ruled out a median of runs.

const (
	calibrationMax = 5 // the newest finished councils the price is read from
	calibrationMin = 2 // with fewer, the formula stands alone
)

// Calibration is what the newest finished councils measured against the formula. CallRatio is their calls over the
// calls Estimate gives their panels, and PerCall the tokens a call of theirs took on average. Councils is how many it
// read; 0 is no calibration.
type Calibration struct {
	Councils  int
	CallRatio float64
	PerCall   int64
}

// CalibrationFrom reads the newest calibrationMax councils of cs (newest Updated first, as List gives them) that ran to
// the end with role experts only: done, not a bench run, no chat seated, a call and its tokens counted. A chat answers
// at its own context, which Estimate prices apart, so a council that seated one would skew the per-call price.
func CalibrationFrom(cs []*Council) Calibration {
	var calls, formula, n int
	var tokens int64
	for _, c := range cs {
		if n == calibrationMax {
			break
		}
		if c == nil || c.Bench || c.State != StateDone || HasAgents(c) || c.Calls == 0 || c.Tokens == 0 {
			continue
		}
		calls += c.Calls
		tokens += c.Tokens
		formula += Estimate(c.Experts, 0, c.Rounds).Calls
		n++
	}
	if n < calibrationMin || formula == 0 {
		return Calibration{}
	}
	return Calibration{Councils: n, CallRatio: float64(calls) / float64(formula), PerCall: tokens / int64(calls)}
}

// Calibrated is est priced from measured councils. Its calls are scaled by CallRatio, rounded up and never fewer than
// the formula's. Each call is priced at PerCall, and the total never drops below the formula's, so a council with big
// files keeps at least its file term. Measured names how many councils the price came from. An empty calibration
// returns est as it is.
func (cal Calibration) Calibrated(est CouncilEstimate) CouncilEstimate {
	if cal.Councils == 0 {
		return est
	}
	calls := max(est.Calls, int(math.Ceil(float64(est.Calls)*cal.CallRatio)))
	est.Tokens = max(est.Tokens, int64(calls)*cal.PerCall)
	est.Calls = calls
	est.Measured = cal.Councils
	return est
}

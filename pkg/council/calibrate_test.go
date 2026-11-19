package council

import (
	"math"
	"testing"
)

// finishedCouncil is an expert-only council that ran to the end with calls and tokens measured.
func finishedCouncil(id string, updated int64, calls int, tokens int64) *Council {
	c := testCouncil(id)
	c.State, c.Updated, c.Calls, c.Tokens = StateDone, updated, calls, tokens
	return c
}

func TestCalibrationNeedsTwoFinishedCouncils(t *testing.T) {
	if cal := CalibrationFrom([]*Council{finishedCouncil("a", 2, 20, 4_000_000)}); cal.Councils != 0 {
		t.Fatalf("one council calibrated: %+v", cal)
	}
	est := CouncilEstimate{Calls: 10, Tokens: 800_000, Minutes: 6}
	if got := (Calibration{}).Calibrated(est); got != est {
		t.Errorf("an empty calibration changed the estimate: %+v", got)
	}
}

func TestCalibrationIsCallsTimesCostPerCall(t *testing.T) {
	a, b := finishedCouncil("a", 3, 20, 4_000_000), finishedCouncil("b", 2, 20, 6_000_000)
	formula := Estimate(a.Experts, 0, a.Rounds).Calls + Estimate(b.Experts, 0, b.Rounds).Calls
	cal := CalibrationFrom([]*Council{a, b})
	if cal.Councils != 2 || cal.PerCall != 250_000 {
		t.Fatalf("cal = %+v, want 2 councils at 250k a call", cal)
	}
	if want := 40.0 / float64(formula); cal.CallRatio != want {
		t.Errorf("call ratio = %v, want %v", cal.CallRatio, want)
	}
	got := cal.Calibrated(CouncilEstimate{Calls: 10, Tokens: 800_000, Minutes: 6})
	calls := int(math.Ceil(10 * cal.CallRatio))
	if got.Calls != calls || got.Tokens != int64(calls)*250_000 || got.Measured != 2 || got.Minutes != 6 {
		t.Errorf("calibrated = %+v, want %d calls at 250k each from 2 councils", got, calls)
	}
}

func TestCalibrationSkipsWhatDidNotRunAsAStart(t *testing.T) {
	running := finishedCouncil("r", 9, 5, 1_000_000)
	running.State = StateRunning
	bench := finishedCouncil("b", 8, 30, 9_000_000)
	bench.Bench = true
	noCalls := finishedCouncil("z", 7, 0, 0)
	withAgent := finishedCouncil("g", 6, 12, 3_000_000)
	withAgent.Experts = append(withAgent.Experts, CouncilExpert{Id: "agent:t1", Agent: "t1"})
	cal := CalibrationFrom([]*Council{running, bench, noCalls, withAgent, finishedCouncil("a", 2, 20, 4_000_000)})
	if cal.Councils != 0 {
		t.Errorf("only one council qualifies, yet it calibrated: %+v", cal)
	}
}

func TestCalibrationReadsTheNewestFive(t *testing.T) {
	var cs []*Council
	for i := range 7 {
		cs = append(cs, finishedCouncil(string(rune('a'+i)), int64(100-i), 10, int64(1_000_000*(i+1))))
	}
	if cal := CalibrationFrom(cs); cal.Councils != 5 || cal.PerCall != 300_000 {
		t.Errorf("cal = %+v, want the first five (1M..5M over 50 calls = 300k a call)", cal)
	}
}

// the calibrated price never drops below the formula's, so a council with big files is not priced lower than before
func TestCalibrationNeverLowersTheFormula(t *testing.T) {
	cal := Calibration{Councils: 3, CallRatio: 1, PerCall: 50_000}
	if got := cal.Calibrated(CouncilEstimate{Calls: 10, Tokens: 2_000_000}); got.Tokens != 2_000_000 {
		t.Errorf("tokens = %d, want the formula's 2M", got.Tokens)
	}
}

package dume

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

var now = time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)

func f(v float64) *float64 { return &v }
func at(d time.Duration) *int64 {
	t := now.Add(d).Unix()
	return &t
}

// a quota 40 min from the 5h reset with 40 % used, week 20 % used at 50 % elapsed
func ready() *claudequota.Quota {
	return &claudequota.Quota{
		FiveHourPct: f(40), FiveHourReset: at(40 * time.Minute),
		WeekPct: f(20), WeekReset: at(84 * time.Hour), // 3.5 days left: pace 50
	}
}

func in(q *claudequota.Quota) Inputs {
	return Inputs{Enabled: true, Quota: q, Now: now, Pressure: jobqueue.PressureUnknown, HasWork: true}
}

func TestDecide(t *testing.T) {
	reset := *ready().FiveHourReset
	cases := map[string]struct {
		in        Inputs
		start     bool
		armed     int64
		reasonHas string
	}{
		"off":            {Inputs{Quota: ready(), Now: now}, false, 0, "off"},
		"no reading":     {in(nil), false, 0, "no 5h"},
		"ready":          {in(ready()), true, reset, "starting"},
		"too early":      {in(func() *claudequota.Quota { q := ready(); q.FiveHourReset = at(2 * time.Hour); return q }()), false, 0, "to the 5h reset"},
		"too much used":  {in(func() *claudequota.Quota { q := ready(); q.FiveHourPct = f(75); return q }()), false, 0, "75% used"},
		"week over pace": {in(func() *claudequota.Quota { q := ready(); q.WeekPct = f(45); return q }()), false, 0, "week 45%"},
		"no week":        {in(func() *claudequota.Quota { q := ready(); q.WeekPct, q.WeekReset = nil, nil; return q }()), false, 0, "no weekly reading"},
		"scoped week stands": {in(func() *claudequota.Quota {
			q := ready()
			q.WeekPct, q.WeekReset = nil, nil
			q.ScopedWeeks = []claudequota.ScopedWeek{{Model: "Fable", Pct: 10, Reset: at(84 * time.Hour)}}
			return q
		}()), true, reset, "starting"},
		"own run live": {func() Inputs { i := in(ready()); i.OwnRunsLive = 1; return i }(), false, 0, "1 of your runs"},
		"pressure":     {func() Inputs { i := in(ready()); i.Pressure = jobqueue.PressureWarn; return i }(), false, 0, "memory"},
		"no work":      {func() Inputs { i := in(ready()); i.HasWork = false; return i }(), false, reset, "no chunk"},
		"working":      {func() Inputs { i := in(ready()); i.DumeRunLive = true; return i }(), false, reset, "working"},
		// armed: past the start thresholds but under the stop ones
		"armed keeps going": {func() Inputs {
			i := in(func() *claudequota.Quota { q := ready(); q.FiveHourPct = f(85); return q }())
			i.ArmedReset = reset
			return i
		}(), true, reset, "starting"},
		"armed stops at 90": {func() Inputs {
			i := in(func() *claudequota.Quota { q := ready(); q.FiveHourPct = f(90); return q }())
			i.ArmedReset = reset
			return i
		}(), false, reset, "90%"},
		"armed stops near reset": {func() Inputs {
			i := in(func() *claudequota.Quota { q := ready(); q.FiveHourReset = at(9 * time.Minute); return q }())
			i.ArmedReset = *i.Quota.FiveHourReset
			return i
		}(), false, *at(9 * time.Minute), "min to reset"},
		"armed on an old window": {func() Inputs {
			i := in(func() *claudequota.Quota { q := ready(); q.FiveHourPct = f(85); return q }())
			i.ArmedReset = reset - 5*3600
			return i
		}(), false, 0, "85% used"},
		"window already reset": {in(func() *claudequota.Quota { q := ready(); q.FiveHourReset = at(-time.Minute); return q }()), false, 0, "reset"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			d := Decide(c.in)
			if d.Start != c.start || d.ArmedReset != c.armed || !strings.Contains(d.Reason, c.reasonHas) {
				t.Fatalf("Decide = %+v, want start=%v armed=%d reason containing %q", d, c.start, c.armed, c.reasonHas)
			}
		})
	}
}

func TestWeekPace(t *testing.T) {
	if p := weekPace(now, now.Add(84*time.Hour).Unix()); p < 49.9 || p > 50.1 {
		t.Fatalf("pace = %v, want 50", p)
	}
	if p := weekPace(now, now.Add(8*24*time.Hour).Unix()); p != 0 {
		t.Fatalf("pace before the week = %v, want 0", p)
	}
}

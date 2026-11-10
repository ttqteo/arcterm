// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runpause

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

func TestLimitResumeAt(t *testing.T) {
	now := time.Date(2026, 11, 11, 1, 30, 0, 0, time.UTC)
	pct := func(v float64) *float64 { return &v }
	at := func(d time.Duration) *int64 { s := now.Add(d).Unix(); return &s }
	for name, tc := range map[string]struct {
		q    *claudequota.Quota
		want time.Time
	}{
		"no reading":                     {nil, now.Add(limitRecheck)},
		"the five-hour window used up":   {&claudequota.Quota{FiveHourPct: pct(100), FiveHourReset: at(3 * time.Hour), WeekPct: pct(60), WeekReset: at(72 * time.Hour)}, now.Add(3*time.Hour + limitResumeMargin)},
		"the week used up as well":       {&claudequota.Quota{FiveHourPct: pct(100), FiveHourReset: at(3 * time.Hour), WeekPct: pct(100), WeekReset: at(30 * time.Hour)}, now.Add(30*time.Hour + limitResumeMargin)},
		"a model's week used up":         {&claudequota.Quota{FiveHourPct: pct(20), FiveHourReset: at(2 * time.Hour), ScopedWeeks: []claudequota.ScopedWeek{{Model: "Fable", Pct: 100, Reset: at(50 * time.Hour)}}}, now.Add(50*time.Hour + limitResumeMargin)},
		"a reading behind: none at 100":  {&claudequota.Quota{FiveHourPct: pct(97), FiveHourReset: at(90 * time.Minute)}, now.Add(90*time.Minute + limitResumeMargin)},
		"a used-up window already reset": {&claudequota.Quota{FiveHourPct: pct(100), FiveHourReset: at(-time.Minute)}, now.Add(limitRecheck)},
		"a reading with no reset in it":  {&claudequota.Quota{FiveHourPct: pct(100)}, now.Add(limitRecheck)},
	} {
		if got := LimitResumeAt(tc.q, now); !got.Equal(tc.want) {
			t.Errorf("%s: got %v, want %v", name, got, tc.want)
		}
	}
}

func TestPauseForLimitHoldsTheRunUntilTheReset(t *testing.T) {
	f := newFixture(t)
	r := f.run()
	f.expectMarked(r)
	resumeAt := time.Now().Add(3 * time.Hour)
	if err := PauseForLimit(f.ctx, f.ch.OID, r.ID, resumeAt); err != nil {
		t.Fatal(err)
	}
	p := f.get(r.ID).Pause
	if p == nil || p.By != By_Limit || p.NoAutoResumeUntil != resumeAt.UnixMilli() {
		t.Fatalf("pause %+v, want by limit, held until %d", p, resumeAt.UnixMilli())
	}
	// a second worker of the same run reaching the limit finds it paused
	if err := PauseForLimit(f.ctx, f.ch.OID, r.ID, resumeAt); err == nil {
		t.Fatal("pausing an already paused run again succeeded")
	}
	// a restart before the reset keeps it paused
	f.pressure = jobqueue.PressureNormal
	ResumeAtBoot(f.ctx)
	if got := f.get(r.ID); got.Pause == nil || got.Status != jarvis.RunStatus_Paused {
		t.Fatalf("a run paused at the limit resumed at boot before its reset (status %q)", got.Status)
	}
}

func TestResumeAtBootResumesALimitPauseWhoseResetHasPassed(t *testing.T) {
	f := newFixture(t)
	r := f.run()
	f.expectMarked(r)
	if err := PauseForLimit(f.ctx, f.ch.OID, r.ID, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	f.pressure = jobqueue.PressureNormal
	ResumeAtBoot(f.ctx)
	if got := f.get(r.ID); got.Pause != nil || jarvis.RunPaused(got) {
		t.Fatalf("a limit pause past its reset stayed paused at boot: %+v", got.Pause)
	}
}

func TestTopRunOf(t *testing.T) {
	f := newFixture(t)
	solo := f.run()
	top, _, tasks := f.orchestrator("", 1)
	for name, tc := range map[string]struct{ run, want string }{
		"a top-level run is its own": {solo.ID, solo.ID},
		"an orchestrator":            {top.ID, top.ID},
		"a task worker of it":        {tasks[0].ID, top.ID},
	} {
		got, err := TopRunOf(f.ctx, f.ch.OID, tc.run)
		if err != nil || got != tc.want {
			t.Errorf("%s: got %q, %v; want %q", name, got, err, tc.want)
		}
	}
	if _, err := TopRunOf(f.ctx, f.ch.OID, "no-such-run"); err == nil {
		t.Error("a run that is in no tree found a top")
	}
}

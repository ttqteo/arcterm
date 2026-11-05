// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runregulator

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const gb = uint64(1) << 30

var t0 = time.UnixMilli(1_800_000_000_000)

// running is an unpaused candidate holding held bytes.
func running(id string, tasksDone int, createdTs int64, held uint64) Candidate {
	return Candidate{RunID: id, ChannelID: "ch-" + id, CreatedTs: createdTs, TasksDone: tasksDone, HeldBytes: held}
}

// paused is a paused candidate that held held bytes when it paused, at pausedTs (Unix ms).
func paused(id string, pausedTs int64, held uint64) Candidate {
	return Candidate{RunID: id, ChannelID: "ch-" + id, Paused: true, PausedTs: pausedTs, HeldBytes: held}
}

func at(d time.Duration) time.Time { return t0.Add(d) }

func in(p jobqueue.Pressure, free uint64, now time.Time, cands ...Candidate) Input {
	return Input{Pressure: p, FreeBytes: free, Now: now, Candidates: cands}
}

func wantAction(t *testing.T, got Action, kind Kind, runID string) {
	t.Helper()
	if got.Kind != kind || got.RunID != runID {
		t.Fatalf("action = %+v, want kind %v on %q", got, kind, runID)
	}
}

func TestNoPauseBeforeSixtySecondsOfTight(t *testing.T) {
	var st State
	c := running("a", 0, 1, 2*gb)
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 8*gb, at(0), c)), ActionNone, "")
	wantAction(t, Decide(&st, in(jobqueue.PressureCritical, 8*gb, at(59*time.Second), c)), ActionNone, "")
	got := Decide(&st, in(jobqueue.PressureWarn, 8*gb, at(60*time.Second), c))
	wantAction(t, got, ActionPause, "a")
	if got.ChannelID != "ch-a" {
		t.Fatalf("channel = %q, want ch-a", got.ChannelID)
	}
}

func TestTightClockRestartsWhenPressureReturnsToNormal(t *testing.T) {
	var st State
	c := running("a", 0, 1, 2*gb)
	Decide(&st, in(jobqueue.PressureWarn, 8*gb, at(0), c))
	Decide(&st, in(jobqueue.PressureNormal, 8*gb, at(40*time.Second), c))
	// tight again at 50 s: 60 s of it has not passed by 100 s
	Decide(&st, in(jobqueue.PressureWarn, 8*gb, at(50*time.Second), c))
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 8*gb, at(100*time.Second), c)), ActionNone, "")
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 8*gb, at(110*time.Second), c)), ActionPause, "a")
}

func TestPauseSkipsFinalizingMidMergeSmallAndPausedRuns(t *testing.T) {
	var st State
	fin := running("fin", 0, 9, 8*gb)
	fin.Finalizing = true
	merging := running("merging", 0, 9, 8*gb)
	merging.MidMerge = true
	small := running("small", 0, 9, gb-1)
	already := paused("already", 1, 8*gb)
	good := running("good", 5, 1, gb)

	Decide(&st, in(jobqueue.PressureCritical, 0, at(0)))
	got := Decide(&st, in(jobqueue.PressureCritical, 0, at(60*time.Second), fin, merging, small, already, good))
	wantAction(t, got, ActionPause, "good")

	var none State
	Decide(&none, in(jobqueue.PressureCritical, 0, at(0)))
	got = Decide(&none, in(jobqueue.PressureCritical, 0, at(60*time.Second), fin, merging, small, already))
	wantAction(t, got, ActionNone, "")
}

func TestPausePicksFewestTasksDoneThenNewest(t *testing.T) {
	var st State
	a := running("a", 3, 100, 2*gb)
	b := running("b", 1, 100, 2*gb)
	c := running("c", 1, 200, 2*gb) // ties b on tasks done, and is newer
	d := running("d", 1, 50, 2*gb)
	Decide(&st, in(jobqueue.PressureWarn, 0, at(0)))
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 0, at(60*time.Second), a, b, c, d)), ActionPause, "c")
}

func TestOnePausePerWindow(t *testing.T) {
	var st State
	a := running("a", 0, 1, 2*gb)
	b := running("b", 0, 2, 2*gb)
	Decide(&st, in(jobqueue.PressureCritical, 0, at(0), a, b))
	wantAction(t, Decide(&st, in(jobqueue.PressureCritical, 0, at(60*time.Second), a, b)), ActionPause, "b")
	// the pick is paused now; the next one waits out one fresh reading window
	a2 := a
	wantAction(t, Decide(&st, in(jobqueue.PressureCritical, 0, at(65*time.Second), a2)), ActionNone, "")
	wantAction(t, Decide(&st, in(jobqueue.PressureCritical, 0, at(119*time.Second), a2)), ActionNone, "")
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 0, at(120*time.Second), a2)), ActionPause, "a")
}

func TestTwoPausesThatDidNotLowerThePressureStandItDown(t *testing.T) {
	var st State
	runs := []Candidate{running("a", 0, 1, 2*gb), running("b", 0, 2, 2*gb), running("c", 0, 3, 2*gb)}
	Decide(&st, in(jobqueue.PressureWarn, 0, at(0), runs...))
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 0, at(60*time.Second), runs...)), ActionPause, "c")
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 0, at(120*time.Second), runs[:2]...)), ActionPause, "b")
	// the second pause did not lower it either: no third pause, and none while the pressure stays tight
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 0, at(180*time.Second), runs[:1]...)), ActionNone, "")
	wantAction(t, Decide(&st, in(jobqueue.PressureCritical, 0, at(600*time.Second), runs[:1]...)), ActionNone, "")

	// back at normal, it pauses again once tight has lasted 60 s
	Decide(&st, in(jobqueue.PressureNormal, 0, at(700*time.Second), runs[:1]...))
	Decide(&st, in(jobqueue.PressureWarn, 0, at(710*time.Second), runs[:1]...))
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 0, at(770*time.Second), runs[:1]...)), ActionPause, "a")
}

func TestCriticalFallingToWarnCountsAsLower(t *testing.T) {
	var st State
	runs := []Candidate{running("a", 0, 1, 2*gb), running("b", 0, 2, 2*gb), running("c", 0, 3, 2*gb)}
	Decide(&st, in(jobqueue.PressureCritical, 0, at(0), runs...))
	wantAction(t, Decide(&st, in(jobqueue.PressureCritical, 0, at(60*time.Second), runs...)), ActionPause, "c")
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 0, at(120*time.Second), runs[:2]...)), ActionPause, "b")
	// critical fell to warn after the first pause, so the count restarted: warn after the second is only one miss
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 0, at(180*time.Second), runs[:1]...)), ActionPause, "a")
}

func TestAPauseThatFailedIsNotCountedAsOneThatDidNotHelp(t *testing.T) {
	var st State
	runs := []Candidate{running("a", 0, 1, 2*gb), running("b", 0, 2, 2*gb)}
	Decide(&st, in(jobqueue.PressureWarn, 0, at(0), runs...))
	act := Decide(&st, in(jobqueue.PressureWarn, 0, at(60*time.Second), runs...))
	wantAction(t, act, ActionPause, "b")
	st.Failed(act)
	act = Decide(&st, in(jobqueue.PressureWarn, 0, at(120*time.Second), runs...))
	wantAction(t, act, ActionPause, "b")
	st.Failed(act)
	// two failed attempts are not two pauses that missed: it keeps trying, one per window
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 0, at(180*time.Second), runs...)), ActionPause, "b")
}

func TestNoResumeBeforeFiveMinutesOfNormal(t *testing.T) {
	var st State
	p := paused("a", 1, 2*gb)
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(0), p)), ActionNone, "")
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(5*time.Minute-time.Second), p)), ActionNone, "")
	got := Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(5*time.Minute), p))
	wantAction(t, got, ActionResume, "a")
	if got.ChannelID != "ch-a" {
		t.Fatalf("channel = %q, want ch-a", got.ChannelID)
	}
}

func TestATightReadingRestartsTheNormalClock(t *testing.T) {
	var st State
	p := paused("a", 1, 2*gb)
	Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(0), p))
	Decide(&st, in(jobqueue.PressureWarn, 64*gb, at(4*time.Minute), p))
	Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(4*time.Minute+5*time.Second), p))
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(6*time.Minute), p)), ActionNone, "")
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(9*time.Minute+5*time.Second), p)), ActionResume, "a")
}

func TestNoResumeWithoutHeldPlusMarginFree(t *testing.T) {
	var st State
	p := paused("a", 1, 10*gb)
	Decide(&st, in(jobqueue.PressureNormal, 0, at(0), p))
	need := 10*gb + ResumeMargin
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, need, at(5*time.Minute), p)), ActionNone, "")
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, need+1, at(5*time.Minute+5*time.Second), p)), ActionResume, "a")
}

func TestResumePicksTheRunPausedLongestWhoseHoldHasPassed(t *testing.T) {
	var st State
	oldest := paused("oldest", 1000, gb)
	oldest.NoAutoResumeUntil = at(5*time.Minute).UnixMilli() + 1 // still held at the moment it would resume
	older := paused("older", 2000, gb)
	newer := paused("newer", 3000, gb)
	Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(0), oldest, older, newer))
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(5*time.Minute), newer, oldest, older)), ActionResume, "older")
}

func TestResumeIsHeadOfLine(t *testing.T) {
	var st State
	big := paused("big", 1000, 30*gb)
	small := paused("small", 2000, gb)
	Decide(&st, in(jobqueue.PressureNormal, 20*gb, at(0), big, small))
	// the one paused longest waits for its RAM; a smaller one does not jump it
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, 20*gb, at(5*time.Minute), big, small)), ActionNone, "")
}

func TestAResumeRestartsTheFiveMinuteClock(t *testing.T) {
	var st State
	a := paused("a", 1000, gb)
	b := paused("b", 2000, gb)
	Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(0), a, b))
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(5*time.Minute), a, b)), ActionResume, "a")
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(5*time.Minute+10*time.Second), b)), ActionNone, "")
	wantAction(t, Decide(&st, in(jobqueue.PressureNormal, 64*gb, at(10*time.Minute), b)), ActionResume, "b")
}

func TestAnUnknownReadingCountsAsNormal(t *testing.T) {
	var st State
	p := paused("a", 1, gb)
	Decide(&st, in(jobqueue.PressureUnknown, 64*gb, at(0), p))
	wantAction(t, Decide(&st, in(jobqueue.PressureUnknown, 64*gb, at(5*time.Minute), p)), ActionResume, "a")
}

func TestUnknownNeverPauses(t *testing.T) {
	var st State
	c := running("a", 0, 1, 8*gb)
	Decide(&st, in(jobqueue.PressureUnknown, 0, at(0), c))
	wantAction(t, Decide(&st, in(jobqueue.PressureUnknown, 0, at(10*time.Minute), c)), ActionNone, "")
}

func TestATightReadingNeverResumes(t *testing.T) {
	var st State
	p := paused("a", 1, gb)
	Decide(&st, in(jobqueue.PressureWarn, 64*gb, at(0), p))
	wantAction(t, Decide(&st, in(jobqueue.PressureWarn, 64*gb, at(10*time.Minute), p)), ActionNone, "")
}

func TestMidMergeAndFinalizingFromTheDag(t *testing.T) {
	task := func(state string, merged bool) waveobj.TaskNode {
		return waveobj.TaskNode{State: state, Merged: merged}
	}
	cases := []struct {
		name       string
		g          *waveobj.TaskGroup
		midMerge   bool
		finalizing bool
	}{
		{"no dag", nil, false, false},
		{"running tasks", &waveobj.TaskGroup{Status: "running", Tasks: []waveobj.TaskNode{task("running", false), task("pending", false)}}, false, false},
		{"a task verifying", &waveobj.TaskGroup{Status: "running", Tasks: []waveobj.TaskNode{task("verifying", true), task("pending", false)}}, true, false},
		{"merge required, a done task not merged", &waveobj.TaskGroup{Status: "running", MergeRequired: true, Tasks: []waveobj.TaskNode{task("done", false)}}, true, false},
		{"merge required, every done task merged", &waveobj.TaskGroup{Status: "running", MergeRequired: true, Tasks: []waveobj.TaskNode{task("done", true), task("running", false)}}, false, false},
		{"no merge required, a done task not merged", &waveobj.TaskGroup{Status: "running", Tasks: []waveobj.TaskNode{task("done", false)}}, false, false},
		{"finalizing", &waveobj.TaskGroup{Status: "finalizing", MergeRequired: true, Tasks: []waveobj.TaskNode{task("done", true)}}, false, true},
	}
	for _, c := range cases {
		if got := MidMerge(c.g); got != c.midMerge {
			t.Errorf("%s: MidMerge = %v, want %v", c.name, got, c.midMerge)
		}
		if got := Finalizing(c.g); got != c.finalizing {
			t.Errorf("%s: Finalizing = %v, want %v", c.name, got, c.finalizing)
		}
	}
}

func TestTasksDoneCountsOnlyDoneTasks(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{{State: "done"}, {State: "done"}, {State: "skipped"}, {State: "running"}, {State: "failed"}}}
	if got := TasksDone(g); got != 2 {
		t.Fatalf("TasksDone = %d, want 2", got)
	}
	if got := TasksDone(nil); got != 0 {
		t.Fatalf("TasksDone(nil) = %d, want 0", got)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/sessionideas"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// ideasLoopWorld scripts what one tick of the schedule reads outside the store (the transcripts, the setting, the clock,
// the quota, the runs) and records the scans it starts. A tick runs on DUM-E's clock and gate inputs, so the world uses
// DUM-E's test fixtures: dumeT0 is the clock and dumeReady() a window 40 minutes from its reset with room left.
type ideasLoopWorld struct {
	t     *testing.T
	store *sessionideas.Store

	now      time.Time
	days     int
	cands    []agentsessions.DigestSession
	quota    *claudequota.Quota
	pressure jobqueue.Pressure
	runs     []*waveobj.Run
	runsErr  error

	candReads, dayReads, runReads int
	scans                         []sessionideas.ScanOpts
}

func newIdeasLoopWorld(t *testing.T) *ideasLoopWorld {
	t.Helper()
	w := &ideasLoopWorld{t: t, store: emptySessionIdeas(t), now: dumeT0, days: 90, quota: dumeReady(), pressure: jobqueue.PressureUnknown}
	swap(t, &dumeStatus, wshrpc.DumeStatusData{})
	swap(t, &dumeArmed, 0)
	swap(t, &sessionIdeasArmed, 0)
	swap(t, &dumeNow, func() time.Time { return w.now })
	swap(t, &dumeQuota, func(context.Context) *claudequota.Quota { return w.quota })
	swap(t, &dumePressure, func(context.Context) jobqueue.Pressure { return w.pressure })
	swap(t, &dumeRuns, func(context.Context) ([]*waveobj.Run, error) { w.runReads++; return w.runs, w.runsErr })
	swap(t, &realSessionIdeasDeps, func() sessionideas.Deps {
		return sessionideas.Deps{
			Candidates:  func() []agentsessions.DigestSession { w.candReads++; return w.cands },
			CleanupDays: func() int { w.dayReads++; return w.days },
		}
	})
	swap(t, &runSessionIdeasScan, func(_ context.Context, opts sessionideas.ScanOpts) error {
		w.scans = append(w.scans, opts)
		return nil
	})
	return w
}

// onDisk is a transcript last written age days before the clock.
func (w *ideasLoopWorld) onDisk(name string, age float64) agentsessions.DigestSession {
	c := agentsessions.DigestSession{
		Path: "/claude/" + name + ".jsonl", Stem: name, Size: 100,
		Mtime: w.now.Add(-time.Duration(age * 24 * float64(time.Hour))),
	}
	w.cands = append(w.cands, c)
	return c
}

func (w *ideasLoopWorld) firstScanDone(marks ...wshrpc.SessionIdeaMark) {
	w.t.Helper()
	if err := w.store.Update(func(d *wshrpc.SessionIdeasData) error {
		d.FirstScanDone = true
		d.Marks = append(d.Marks, marks...)
		return nil
	}); err != nil {
		w.t.Fatal(err)
	}
}

// tick runs one pass and waits for the scan it may have started to end.
func (w *ideasLoopWorld) tick() {
	w.t.Helper()
	sessionIdeasTick(context.Background())
	waitScanIdle(w.t)
}

func (w *ideasLoopWorld) store0() wshrpc.SessionIdeasData {
	w.t.Helper()
	d, err := w.store.Load()
	if err != nil {
		w.t.Fatal(err)
	}
	return d
}

// atReset puts the 5h reset d from the clock, with pct used.
func (w *ideasLoopWorld) window(pct float64, toReset time.Duration) {
	q := dumeReady()
	q.FiveHourPct = dumeF(pct)
	q.FiveHourReset = dumeAt(w.now, toReset)
	w.quota = q
}

func TestSessionIdeasLoopDoesNothingBeforeTheFirstScan(t *testing.T) {
	w := newIdeasLoopWorld(t)
	w.onDisk("forced", 88)
	w.tick() // the store says no scan has ever been asked for
	if len(w.scans) != 0 || w.candReads != 0 {
		t.Fatalf("nothing scans, not even a session near deletion, until the person pressed Scan my sessions: scans %+v, transcripts read %d", w.scans, w.candReads)
	}
	if d := w.store0(); d.NextScanTs != 0 {
		t.Fatalf("a schedule that has not started names no next scan: %d", d.NextScanTs)
	}
}

func TestSessionIdeasLoopDoesNothingInFixtureMode(t *testing.T) {
	w := newIdeasLoopWorld(t)
	w.onDisk("forced", 88)
	w.firstScanDone()
	setSessionIdeasFixture(&wshrpc.CommandSessionIdeasSeedData{Fixture: true})
	w.tick()
	if len(w.scans) != 0 || w.candReads != 0 || w.dayReads != 0 {
		t.Fatalf("fixture mode reads no real transcript and starts no scan: scans %+v, reads %d/%d", w.scans, w.candReads, w.dayReads)
	}
}

func TestSessionIdeasLoopDoesNothingWhileAScanRuns(t *testing.T) {
	w := newIdeasLoopWorld(t)
	w.onDisk("forced", 88)
	w.firstScanDone()
	release := make(chan struct{})
	running := make(chan struct{})
	swap(t, &runSessionIdeasScan, func(ctx context.Context, opts sessionideas.ScanOpts) error {
		w.scans = append(w.scans, opts)
		close(running)
		select {
		case <-release:
		case <-ctx.Done():
		}
		return nil
	})
	if err := startSessionIdeasScan(sessionideas.ScanOpts{}); err != nil {
		t.Fatal(err)
	}
	<-running
	t.Cleanup(func() { close(release); waitScanIdle(t) })

	sessionIdeasTick(context.Background())
	if len(w.scans) != 1 || w.candReads != 0 {
		t.Fatalf("a tick that finds a scan running does nothing: scans %+v, transcripts read %d", w.scans, w.candReads)
	}
}

func TestSessionIdeasLoopForcedScansAtOnceWhateverTheGateSays(t *testing.T) {
	w := newIdeasLoopWorld(t)
	w.quota = nil                          // the gate has no reading at all
	w.pressure = jobqueue.PressureCritical // and memory is short
	w.runs = []*waveobj.Run{{ID: "r1", Status: jarvis.RunStatus_Executing}}
	first := w.onDisk("forced-first", 89)
	second := w.onDisk("forced-second", 85)
	w.onDisk("due", 82)
	w.onDisk("young", 10)
	w.firstScanDone()

	w.tick()
	want := []sessionideas.ScanOpts{{Forced: true, Paths: []string{first.Path, second.Path}}}
	if !reflect.DeepEqual(w.scans, want) {
		t.Fatalf("a session 7 days from deletion scans at once, with only the forced list: got %+v, want %+v", w.scans, want)
	}
	if w.runReads != 0 {
		t.Fatalf("a forced scan waits on no gate, so it reads none of its inputs; runs read %d times", w.runReads)
	}
}

func TestSessionIdeasLoopDueWaitsForTheGate(t *testing.T) {
	live := func(mod func(*waveobj.Run)) []*waveobj.Run {
		r := &waveobj.Run{ID: "r1", Status: jarvis.RunStatus_Executing}
		if mod != nil {
			mod(r)
		}
		return []*waveobj.Run{r}
	}
	for _, c := range []struct {
		name  string
		setup func(w *ideasLoopWorld)
		scans bool
	}{
		{"a window near its reset with room left starts it", func(w *ideasLoopWorld) {}, true},
		{"no quota reading waits", func(w *ideasLoopWorld) { w.quota = nil }, false},
		{"a window with its reset far off waits", func(w *ideasLoopWorld) { w.window(10, 3*time.Hour) }, false},
		{"a window mostly used waits", func(w *ideasLoopWorld) { w.window(85, 40*time.Minute) }, false},
		{"a live run of the person's waits", func(w *ideasLoopWorld) { w.runs = live(nil) }, false},
		{"a live run of DUM-E's waits too: a scan never shares a window with it", func(w *ideasLoopWorld) {
			w.runs = live(func(r *waveobj.Run) { r.EffortRef = &waveobj.RunEffortRef{EffortOID: "e1", ChunkLabel: "c"} })
		}, false},
		{"a live task of a run is not a run of its own", func(w *ideasLoopWorld) { w.runs = live(func(r *waveobj.Run) { r.TaskId = "t1" }) }, true},
		{"a finished run holds nothing", func(w *ideasLoopWorld) { w.runs = live(func(r *waveobj.Run) { r.Status = jarvis.RunStatus_Done }) }, true},
		{"memory pressure waits", func(w *ideasLoopWorld) { w.pressure = jobqueue.PressureWarn }, false},
		{"runs that cannot be read wait", func(w *ideasLoopWorld) { w.runsErr = errors.New("db locked") }, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			w := newIdeasLoopWorld(t)
			due := w.onDisk("due", 82)
			w.onDisk("not-due", 60)
			w.firstScanDone()
			c.setup(w)
			w.tick()
			switch {
			case c.scans && !reflect.DeepEqual(w.scans, []sessionideas.ScanOpts{{Paths: []string{due.Path}}}):
				t.Fatalf("the gate says go: want one scan of the due session, not forced, got %+v", w.scans)
			case !c.scans && len(w.scans) != 0:
				t.Fatalf("the gate says wait, but a scan started: %+v", w.scans)
			}
		})
	}
}

func TestSessionIdeasLoopKeepsItsOwnArmedWindow(t *testing.T) {
	w := newIdeasLoopWorld(t)
	w.onDisk("due-a", 82)
	w.onDisk("due-b", 81)
	w.firstScanDone()

	w.tick()
	if len(w.scans) != 1 || sessionIdeasArmed == 0 {
		t.Fatalf("the first tick of a window starts a scan and arms it: scans %+v, armed %d", w.scans, sessionIdeasArmed)
	}
	// a window the loop has started takes more until it is 90% used; one it has not started stops at 70%
	w.now = w.now.Add(5 * time.Minute)
	w.window(80, 35*time.Minute)
	w.quota.FiveHourReset = dumeAt(dumeT0, 40*time.Minute) // the same window
	w.tick()
	if len(w.scans) != 2 {
		t.Fatalf("an armed window at 80%% still takes the next scan: %+v", w.scans)
	}
	if dumeArmed != 0 {
		t.Fatalf("the loop arms windows of its own and leaves DUM-E's alone, DUM-E's armed reset is %d", dumeArmed)
	}
	w.window(95, 25*time.Minute)
	w.quota.FiveHourReset = dumeAt(dumeT0, 40*time.Minute)
	w.tick()
	if len(w.scans) != 2 {
		t.Fatalf("an armed window at 95%% is done: %+v", w.scans)
	}
}

func TestSessionIdeasLoopNeverForcesASkippedSession(t *testing.T) {
	w := newIdeasLoopWorld(t)
	passed := w.onDisk("decide-agent", 89) // 1 day from deletion
	w.firstScanDone(wshrpc.SessionIdeaMark{
		TranscriptPath: passed.Path, SessionID: "decide-agent", Size: passed.Size, MtimeMs: passed.Mtime.UnixMilli(),
		Outcome: wshrpc.SessionIdeaOutcome_Skipped,
	})
	w.tick()
	if len(w.scans) != 0 {
		t.Fatalf("a session read and passed over is scanned for good: %+v", w.scans)
	}
}

func TestSessionIdeasLoopReadsTheSettingEachTick(t *testing.T) {
	w := newIdeasLoopWorld(t)
	session := w.onDisk("a-month", 25)
	w.firstScanDone()
	w.tick()
	if len(w.scans) != 0 || w.dayReads != 1 {
		t.Fatalf("under a 90-day period a 25-day-old session is far from deletion: scans %+v, setting read %d times", w.scans, w.dayReads)
	}
	w.days = 30 // the person lowered cleanupPeriodDays: 5 days left
	w.tick()
	if want := []sessionideas.ScanOpts{{Forced: true, Paths: []string{session.Path}}}; !reflect.DeepEqual(w.scans, want) || w.dayReads != 2 {
		t.Fatalf("the next tick reads the setting again: scans %+v want %+v, setting read %d times", w.scans, want, w.dayReads)
	}
}

func TestSessionIdeasLoopSetsTheNextScan(t *testing.T) {
	w := newIdeasLoopWorld(t)
	soon := w.onDisk("soon", 70) // due in 10 days
	w.onDisk("later", 40)
	w.firstScanDone()
	w.tick()
	if len(w.scans) != 0 {
		t.Fatalf("nothing is due: %+v", w.scans)
	}
	if got, want := w.store0().NextScanTs, sessionideas.DueAt(soon.Mtime, 90).UnixMilli(); got != want {
		t.Fatalf("the next scan is the earliest due day: got %d, want %d", got, want)
	}

	// everything read: no next scan
	w.cands = nil
	w.tick()
	if got := w.store0().NextScanTs; got != 0 {
		t.Fatalf("with nothing left to scan there is no next scan, got %d", got)
	}
}

func TestSessionIdeasLoopLogsWhatItCannotRead(t *testing.T) {
	w := newIdeasLoopWorld(t)
	w.onDisk("due", 82)
	w.firstScanDone()
	w.runsErr = errors.New("db locked")
	buf := captureLog(t)
	w.tick()
	if len(w.scans) != 0 || !strings.Contains(buf.String(), "db locked") {
		t.Fatalf("a tick that cannot read the runs waits and says why: scans %+v, log %q", w.scans, buf.String())
	}
}

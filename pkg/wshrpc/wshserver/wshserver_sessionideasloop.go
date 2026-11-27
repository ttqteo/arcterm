// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/dume"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/sessionideas"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// sessionIdeasFirstTick is the wait before the first tick, so it does not land with DUM-E's (dumeFirstTick).
const sessionIdeasFirstTick = 90 * time.Second

// sessionIdeasArmed is the 5h reset (epoch s) of the window the loop has started a scan in, as DUM-E's dumeArmed is for
// its own: the gate lets a window it has started take more until 90% used. Only the loop's goroutine touches it.
var sessionIdeasArmed int64

// StartSessionIdeasLoop runs the schedule's tick until ctx ends: the first after 90 seconds, then every five minutes on
// DUM-E's cadence (dumeTickEvery). A leftover window is only the stretch before a 5-hour reset, which an hourly check
// can miss. A tick reads file times and the marks, and the head of a transcript it has not seen as it stands (to tell a
// machine session), nothing more, until a session is due. At the first tick the loop also lists the sessions once
// (warmSessionIdeasOrigins), whether or not a scan was ever asked for.
//
// Before the loop starts, a scan the store holds with no end time is ended: it ran when wavesrv last stopped, and would
// otherwise read as running for good (Scan hidden, Stop with nothing to cancel).
func StartSessionIdeasLoop(ctx context.Context) {
	endSessionIdeasScanLeftAtShutdown()
	go func() {
		timer := time.NewTimer(sessionIdeasFirstTick)
		defer timer.Stop()
		warmed := false
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			if !warmed {
				warmed = true
				warmSessionIdeasOrigins()
			}
			safeSessionIdeasTick(ctx)
			timer.Reset(dumeTickEvery)
		}
	}()
}

// warmSessionIdeasOrigins lists the sessions once, off any RPC: the first list reads the head of every transcript to
// leave out the machine sessions (seconds over a few thousand; sessionideas.PersonSessions caches each until its file
// changes), so the Brief's first read of the list does not wait on it. It reads files only, and calls no model.
func warmSessionIdeasOrigins() {
	defer func() {
		panichandler.PanicHandler("sessionideas-warm", recover())
	}()
	if _, on := sessionIdeasFixture(); on {
		return
	}
	sessionIdeasOnDisk()
}

// safeSessionIdeasTick keeps a panic in one tick from ending the loop for good.
func safeSessionIdeasTick(ctx context.Context) {
	defer func() {
		panichandler.PanicHandler("sessionideas-tick", recover())
	}()
	sessionIdeasTick(ctx)
}

// sessionIdeasTick is one pass of the schedule. It does nothing while a scan runs, in fixture mode, and until the person
// has scanned once (nothing scans before that, a forced scan included: it spends tokens they have not seen estimated).
// After a scan of one project it reads only the projects scanned that way (sessionideas.InScope), until a scan of every
// project. Then it reads the transcripts and the marks and the setting afresh, records the next due day, and:
//   - scans the sessions 7 days or fewer from deletion at once, whatever the gate says (their transcripts go otherwise);
//   - else scans the sessions whose scan came due when DUM-E's gate says Start, which is a leftover 5-hour window with no
//     live run (DUM-E's own included) and no memory pressure.
//
// Both go through the one scan guard, with Paths always set: a scan with none would read every quiet session.
func sessionIdeasTick(ctx context.Context) {
	if _, on := sessionIdeasFixture(); on || sessionIdeasScanRunning() {
		return
	}
	store := sessionideas.Default()
	d, err := store.Load()
	if err != nil {
		log.Printf("sessionideas: schedule: reading the store: %v", err)
		return
	}
	if !d.FirstScanDone && len(d.ScanProjects) == 0 {
		return
	}
	now := dumeNow()
	cands, days := sessionIdeasOnDisk()
	// until the person scans every project, the schedule reads only the projects they scanned one by one
	cands = sessionideas.InScope(d, cands)
	if next := sessionideas.NextDueTs(cands, d.Marks, now, days); next != d.NextScanTs {
		if err := store.Update(func(d *wshrpc.SessionIdeasData) error {
			d.NextScanTs = next
			return nil
		}); err != nil {
			log.Printf("sessionideas: schedule: saving the next scan: %v", err)
		}
	}
	due, forced := sessionideas.Plan(cands, d.Marks, now, days)
	if len(forced) > 0 {
		log.Printf("sessionideas: schedule: %d sessions are 7 days from deletion, scanning them now", len(forced))
		startScheduledScan(sessionideas.ScanOpts{Forced: true, Paths: forced})
		return
	}
	if len(due) == 0 {
		return
	}
	runs, err := dumeRuns(ctx)
	if err != nil {
		log.Printf("sessionideas: schedule: reading the runs, so %d due sessions wait: %v", len(due), err)
		return
	}
	// every live top-level run counts as the person's, DUM-E's too: a scan never shares a window with DUM-E
	g := dume.Decide(dume.Inputs{
		Enabled: true, Quota: dumeQuota(ctx), Now: now, OwnRunsLive: runqueue.Active(runs),
		Pressure: dumePressure(ctx), ArmedReset: sessionIdeasArmed, HasWork: true,
	})
	sessionIdeasArmed = g.ArmedReset
	if !g.Start {
		return
	}
	log.Printf("sessionideas: schedule: a leftover window is open, scanning %d due sessions", len(due))
	startScheduledScan(sessionideas.ScanOpts{Paths: due})
}

// startScheduledScan starts a scan through the guard. A scan that appeared since the tick looked is not an error.
func startScheduledScan(opts sessionideas.ScanOpts) {
	if err := startSessionIdeasScan(opts); err != nil && !sessionIdeasScanRunning() {
		log.Printf("sessionideas: schedule: starting a scan: %v", err)
	}
}

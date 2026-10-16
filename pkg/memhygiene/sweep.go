// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"context"
	"log"
	"slices"
	"sort"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// the sweep only looks for due projects each tick; the weekly cadence lives in the state's NextCheckAt,
// so a restart doesn't reset it
const sweepInterval = time.Hour

const sweepInterrupted = "Check interrupted by a restart"

// StartSweep clears what a previous process left checking, then checks every due project at startup
// and hourly until ctx is cancelled. One panicking tick doesn't end the ticker.
func StartSweep(ctx context.Context) {
	sweepClearStale()
	tick := func() {
		defer func() { panichandler.PanicHandler("memhygiene.sweep", recover()) }()
		sweepOnce(ctx, time.Now())
	}
	go func() {
		defer func() { panichandler.PanicHandler("memhygiene.sweep-loop", recover()) }()
		tick()
		t := time.NewTicker(sweepInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				tick()
			}
		}
	}()
}

// sweepOnce checks each due project, one at a time, then drops expired backups.
func sweepOnce(ctx context.Context, now time.Time) {
	registry := registryFn()
	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if ctx.Err() != nil {
			return
		}
		st, err := Load(name)
		if err != nil {
			log.Printf("memhygiene: sweep: %v\n", err)
			continue
		}
		if !sweepDue(st, now) {
			continue
		}
		if err := entryBegin(name); err != nil {
			log.Printf("memhygiene: sweep: %v\n", err)
			continue
		}
		entryRun(name)
	}
	if err := PruneBackups(entryBackupRoot(), now, entryBackupKeep); err != nil {
		log.Printf("memhygiene: sweep: %v\n", err)
	}
}

// sweepDue: its next check is due (a week after the last attempt, failed or not) or it was never
// attempted, and it's not kept sharing (the user chose to keep sharing, so only Check now checks it).
func sweepDue(st *State, now time.Time) bool {
	if st.Checking || now.UnixMilli() < st.NextCheckAt {
		return false
	}
	return !slices.ContainsFunc(st.Changes, func(c wshrpc.MemChange) bool {
		return c.Kind == splitKindSettings && c.Status == checkStatusKept
	})
}

// sweepClearStale ends the checks a previous process was running when it stopped, so the tab never
// reads "Checking…" forever.
func sweepClearStale() {
	for name := range registryFn() {
		st, err := Load(name)
		if err != nil {
			log.Printf("memhygiene: clearing stale checks: %v\n", err)
			continue
		}
		if !st.Checking {
			continue
		}
		if _, err := Update(name, func(st *State) error {
			st.Checking, st.LastError = false, sweepInterrupted
			return nil
		}); err != nil {
			log.Printf("memhygiene: clearing stale checks: %v\n", err)
		}
	}
}

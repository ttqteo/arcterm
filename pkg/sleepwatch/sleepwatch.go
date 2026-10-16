// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package sleepwatch notices that the machine slept. A run that stalls for forty minutes reads as a hung agent until
// you think to check `pmset -g log`; the gap between two ticks of a 30-second loop says it directly.
//
// The gap is read from the wall clock. Go's monotonic clock is the wrong one: on macOS it stops while the machine
// sleeps (mach_absolute_time), on Windows it keeps counting, so neither a monotonic gap nor a late timer is the same
// fact on both. A tick that finds the wall clock far past where the last one left it was not running in between.
//
// A sleeping Mac wakes for a few seconds about every quarter hour (DarkWake: maintenance, Power Nap), and a tick can
// land in one. Read tick by tick, a night's sleep would come out as a string of short ones, and the last of them as
// the sleep. So a sleep is held until the machine has stayed awake for Settle, and a gap that comes before then is
// the same sleep going on.
package sleepwatch

import (
	"context"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

const (
	Interval = 30 * time.Second
	// how late a tick may be before the machine is taken to have slept: well past a busy machine's lag
	MinGap = 2 * time.Minute
	// how long the machine stays awake before a sleep is reported: past 98.7% of a Mac's DarkWakes in its power log
	// (97% end within 30 seconds); a longer one is a wake in which agents ran, and splits the sleep in two
	Settle = 2 * time.Minute
)

// Gap reports whether the machine slept between two ticks Interval apart, and roughly when: from the last tick before
// it to the first after (each within Interval of the real moment). Wall clock only; a clock set back is not a sleep.
func Gap(prev, now time.Time, interval time.Duration) (from, to time.Time, ok bool) {
	p, n := prev.Round(0), now.Round(0) // Round(0) strips the monotonic reading
	if n.Sub(p)-interval < MinGap {
		return time.Time{}, time.Time{}, false
	}
	return p, n, true
}

// Watch folds ticks Interval apart into sleeps.
type Watch struct {
	prev     time.Time
	from, to time.Time // the sleep held until the machine has stayed awake for Settle; zero when none is
}

// Tick takes a tick's time and returns a sleep once the machine has stayed awake for Settle after it.
func (w *Watch) Tick(now time.Time) (from, to time.Time, ok bool) {
	if gapFrom, gapTo, gap := Gap(w.prev, now, Interval); gap {
		if w.to.IsZero() {
			w.from = gapFrom
		}
		w.to = gapTo
	} else if !w.to.IsZero() && now.Round(0).Sub(w.to) >= Settle {
		from, to, ok = w.from, w.to, true
		w.from, w.to = time.Time{}, time.Time{}
	}
	w.prev = now
	return from, to, ok
}

// StartLoop ticks every Interval and hands each sleep it finds to publish, Settle after the machine woke.
func StartLoop(ctx context.Context, publish func(baseds.SleptData)) {
	go func() {
		defer func() { panichandler.PanicHandler("sleepwatch:loop", recover()) }()
		ticker := time.NewTicker(Interval)
		defer ticker.Stop()
		w := &Watch{prev: time.Now()}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			if from, to, ok := w.Tick(time.Now()); ok {
				publish(baseds.SleptData{From: from.UnixMilli(), To: to.UnixMilli()})
			}
		}
	}()
}

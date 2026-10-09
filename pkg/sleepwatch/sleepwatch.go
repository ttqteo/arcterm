// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package sleepwatch notices that the machine slept. A run that stalls for forty minutes reads as a hung agent until
// you think to check `pmset -g log`; the gap between two ticks of a 30-second loop says it directly.
//
// The gap is read from the wall clock. Go's monotonic clock is the wrong one: on macOS it stops while the machine
// sleeps (mach_absolute_time), on Windows it keeps counting, so neither a monotonic gap nor a late timer is the same
// fact on both. A tick that finds the wall clock far past where the last one left it was not running in between.
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

// StartLoop ticks every Interval and hands each sleep it finds to publish.
func StartLoop(ctx context.Context, publish func(baseds.SleptData)) {
	go func() {
		defer func() { panichandler.PanicHandler("sleepwatch:loop", recover()) }()
		ticker := time.NewTicker(Interval)
		defer ticker.Stop()
		prev := time.Now()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			now := time.Now()
			if from, to, ok := Gap(prev, now, Interval); ok {
				publish(baseds.SleptData{From: from.UnixMilli(), To: to.UnixMilli()})
			}
			prev = now
		}
	}()
}

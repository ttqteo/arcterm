// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	// dueBefore is how long before its deletion day a session's scan comes due: it waits for a leftover 5-hour window.
	dueBefore = 10 * 24 * time.Hour
	// forcedWithin is how close to its deletion day an unscanned session is scanned at once, outside any window.
	forcedWithin = 7 * 24 * time.Hour
)

// DeletesAt is the day Claude Code deletes a transcript last written at mtime, when cleanupPeriodDays is days.
func DeletesAt(mtime time.Time, days int) time.Time {
	return mtime.Add(time.Duration(days) * 24 * time.Hour)
}

// DueAt is the day a session's scan comes due: 10 days before its deletion day.
func DueAt(mtime time.Time, days int) time.Time {
	return DeletesAt(mtime, days).Add(-dueBefore)
}

// leavesSoon says whether a transcript is deleted within 7 days (or already past it).
func leavesSoon(mtime time.Time, days int, now time.Time) bool {
	return DeletesAt(mtime, days).Sub(now) <= forcedWithin
}

// Plan is what the schedule's own scan reads, nearest deletion first, from the sessions a scan would read (Eligible: not
// archived, quiet, with no mark of the file as it stands, so a skipped session is never in either list). Forced are those
// 7 days or fewer from deletion, which scan at once; due are the others whose scan came due, which wait for a window.
// A session is in one list at most.
func Plan(candidates []agentsessions.DigestSession, marks []wshrpc.SessionIdeaMark, now time.Time, days int) (due, forced []string) {
	for _, c := range pickWork(candidates, marks, ScanOpts{}, now) {
		switch {
		case leavesSoon(c.Mtime, days, now):
			forced = append(forced, c.Path)
		case !now.Before(DueAt(c.Mtime, days)):
			due = append(due, c.Path)
		}
	}
	return due, forced
}

// NextDueTs is the earliest due day, in unix ms, of the sessions a scan would read: 0 when there are none. It is in the
// past while a session waits for a window.
func NextDueTs(candidates []agentsessions.DigestSession, marks []wshrpc.SessionIdeaMark, now time.Time, days int) int64 {
	work := pickWork(candidates, marks, ScanOpts{}, now)
	if len(work) == 0 {
		return 0
	}
	return DueAt(work[0].Mtime, days).UnixMilli() // pickWork goes oldest write first, which is the earliest due day
}

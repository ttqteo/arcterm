// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import "time"

// SessionWindows is the tokens each Claude session (its subagents included) recorded since each quota window's
// cutoff, and every session's together: WindowTokens' sums, for Usage's By session 5h and Wk columns
type SessionWindows struct {
	FiveHour int
	Week     int
	Sessions map[string][2]int // session id → its 5h and week tokens
}

// ScanSessionWindows reads the Claude transcripts of the week (and a day); a zero cutoff is the trailing window
func ScanSessionWindows(fiveHourCutoff, weekCutoff, now time.Time) SessionWindows {
	return scanSessionWindows(claudeProjectsRoot(), fiveHourCutoff, weekCutoff, now)
}

func scanSessionWindows(root string, fiveHourCutoff, weekCutoff, now time.Time) SessionWindows {
	if fiveHourCutoff.IsZero() {
		fiveHourCutoff = now.Add(-5 * time.Hour)
	}
	if weekCutoff.IsZero() {
		weekCutoff = now.Add(-7 * 24 * time.Hour)
	}
	w := SessionWindows{Sessions: map[string][2]int{}}
	for _, r := range dedupe(parseFiles(walkClaudeFiles(root, weekCutoff.AddDate(0, 0, -1)))) {
		inFive, inWeek := !r.TS.Before(fiveHourCutoff), !r.TS.Before(weekCutoff)
		if !inFive && !inWeek {
			continue
		}
		tokens := recordTokens(r)
		s := w.Sessions[r.Session]
		if inFive {
			w.FiveHour += tokens
			s[0] += tokens
		}
		if inWeek {
			w.Week += tokens
			s[1] += tokens
		}
		w.Sessions[r.Session] = s
	}
	return w
}

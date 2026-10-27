// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package projectactivity answers the Overview's Activity card: a project's tokens, sessions, runs and
// councils per local day. The tokens come from arcterm's own daily tally (tally.go), because Claude Code
// deletes a transcript after cleanupPeriodDays and the graph reaches further back than the files do.
package projectactivity

import (
	"sort"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	dayLayout = "2006-01-02"
	// DefaultWeeks is the window when the caller names none: a GitHub-style year.
	DefaultWeeks = 53
)

// WindowStart is the first local day of the window: weeks weeks back from the start of the current
// Monday-first week (weeks <= 0 means DefaultWeeks).
func WindowStart(now time.Time, weeks int) time.Time {
	if weeks <= 0 {
		weeks = DefaultWeeks
	}
	y, m, d := now.Date()
	// Go counts Sunday as 0; a Monday-first week puts it at the end
	sinceMonday := (int(now.Weekday()) + 6) % 7
	return time.Date(y, m, d-sinceMonday-7*weeks, 0, 0, 0, 0, now.Location())
}

// Aggregate folds the tally rows, the project's runs and its councils into the days of the window that
// have anything on them, oldest first, and counts the distinct sessions across the whole window (summing
// the days would count a session once per day it ran). Rows are expected to be the project's already.
func Aggregate(rows []wstore.SessionDay, runs []*waveobj.Run, councils []*council.Council, now time.Time, weeks int) ([]wshrpc.ProjectActivityDay, int) {
	first := WindowStart(now, weeks).Format(dayLayout)
	last := now.Format(dayLayout)
	inWindow := func(day string) bool { return day >= first && day <= last }

	type sessionKey struct{ harness, session string }
	days := map[string]*wshrpc.ProjectActivityDay{}
	daySessions := map[string]map[sessionKey]bool{}
	windowSessions := map[sessionKey]bool{}
	dayOf := func(day string) *wshrpc.ProjectActivityDay {
		d := days[day]
		if d == nil {
			d = &wshrpc.ProjectActivityDay{Day: day}
			days[day] = d
		}
		return d
	}
	for _, r := range rows {
		if !inWindow(r.Day) {
			continue
		}
		d := dayOf(r.Day)
		d.Tokens += r.Tokens
		k := sessionKey{r.Harness, r.Session}
		if daySessions[r.Day] == nil {
			daySessions[r.Day] = map[sessionKey]bool{}
		}
		daySessions[r.Day][k] = true
		windowSessions[k] = true
	}
	for day, set := range daySessions {
		days[day].Sessions = len(set)
	}
	for _, r := range runs {
		// an engine child run belongs to its parent's run, not to the project's own list
		if r == nil || r.TaskId != "" || r.StageRole != "" || r.ParentLeadORef != "" {
			continue
		}
		day := time.UnixMilli(r.CreatedTs).In(now.Location()).Format(dayLayout)
		if inWindow(day) {
			dayOf(day).Runs++
		}
	}
	for _, c := range councils {
		if c == nil || c.Bench {
			continue
		}
		day := time.UnixMilli(c.Created).In(now.Location()).Format(dayLayout)
		if inWindow(day) {
			dayOf(day).Councils++
		}
	}
	out := make([]wshrpc.ProjectActivityDay, 0, len(days))
	for _, d := range days {
		out = append(out, *d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day < out[j].Day })
	return out, len(windowSessions)
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telebot

import (
	"fmt"
	"strings"
	"time"
)

// The telegram:mode values. An unset or unknown mode reads as manual.
const (
	ModeManual   = "manual"
	ModeSchedule = "schedule"
	ModeAlways   = "always"

	// OfficeHours is the schedule an unset telegram:schedule reads as.
	OfficeHours = "mon,tue,wed,thu,fri 08:00-17:30"
)

// scanDaysBack and scanDaysAhead bound the window starts Allowed looks at, in days from today. A wrapping window that
// began yesterday still covers early this morning, and a start is never more than a week away.
const (
	scanDaysBack  = 1
	scanDaysAhead = 8
)

var weekdayNames = [7]string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"} // indexed by time.Weekday

// monToSun is the order String() lists days in.
var monToSun = [7]time.Weekday{
	time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday, time.Saturday, time.Sunday,
}

// Schedule is a weekly window in local time. End <= Start runs past midnight (End == Start is a full 24 h); Days name
// the day a window starts.
type Schedule struct {
	Days       [7]bool // indexed by time.Weekday
	Start, End int     // minutes after midnight
}

// ParseSchedule reads "<days> <HH:MM>-<HH:MM>", the days a comma list of mon…sun in any case; "" reads as OfficeHours.
func ParseSchedule(s string) (Schedule, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		s = OfficeHours
	}
	sep := strings.LastIndexAny(s, " \t")
	if sep < 0 {
		return Schedule{}, fmt.Errorf("schedule %q: want \"<days> <HH:MM>-<HH:MM>\"", s)
	}
	var sc Schedule
	for _, name := range strings.Split(s[:sep], ",") {
		lower := strings.ToLower(strings.TrimSpace(name))
		day := -1
		for i, n := range weekdayNames {
			if n == lower {
				day = i
			}
		}
		if day < 0 {
			return Schedule{}, fmt.Errorf("schedule %q: unknown day %q (want mon, tue, wed, thu, fri, sat or sun)", s, name)
		}
		sc.Days[day] = true
	}
	from, to, ok := strings.Cut(s[sep+1:], "-")
	if !ok {
		return Schedule{}, fmt.Errorf("schedule %q: want a time range like 08:00-17:30", s)
	}
	var err error
	if sc.Start, err = parseClock(from); err != nil {
		return Schedule{}, fmt.Errorf("schedule %q: %w", s, err)
	}
	if sc.End, err = parseClock(to); err != nil {
		return Schedule{}, fmt.Errorf("schedule %q: %w", s, err)
	}
	return sc, nil
}

// parseClock reads "HH:MM" as minutes after midnight.
func parseClock(s string) (int, error) {
	t, err := time.Parse("15:04", strings.TrimSpace(s))
	if err != nil {
		return 0, fmt.Errorf("bad time %q (want HH:MM, 00:00 to 23:59)", s)
	}
	return t.Hour()*60 + t.Minute(), nil
}

// String writes the schedule the way ParseSchedule reads it, the days in mon…sun order.
func (s Schedule) String() string {
	var days []string
	for _, d := range monToSun {
		if s.Days[d] {
			days = append(days, weekdayNames[d])
		}
	}
	return fmt.Sprintf("%s %02d:%02d-%02d:%02d", strings.Join(days, ","), s.Start/60, s.Start%60, s.End/60, s.End%60)
}

// window is one stretch of allowed time, start inclusive and end exclusive.
type window struct{ start, end time.Time }

// windows lists the schedule's windows that start from scanDaysBack days before now to scanDaysAhead after, in
// now's location and in order, with windows that run into each other joined. A window's times are wall-clock times
// (time.Date), so on a day the clocks change it still opens at "08:00".
func (s Schedule) windows(now time.Time) []window {
	loc := now.Location()
	year, month, today := now.Date()
	var out []window
	for off := -scanDaysBack; off <= scanDaysAhead; off++ {
		day := time.Date(year, month, today+off, 0, 0, 0, 0, loc)
		if !s.Days[day.Weekday()] {
			continue
		}
		endDay := day.Day()
		if s.End <= s.Start {
			endDay++
		}
		w := window{
			start: time.Date(day.Year(), day.Month(), day.Day(), s.Start/60, s.Start%60, 0, 0, loc),
			end:   time.Date(day.Year(), day.Month(), endDay, s.End/60, s.End%60, 0, 0, loc),
		}
		if n := len(out); n > 0 && !w.start.After(out[n-1].end) {
			if w.end.After(out[n-1].end) {
				out[n-1].end = w.end
			}
			continue
		}
		out = append(out, w)
	}
	return out
}

// at reports whether now is inside a window and when that run of windows ends (zero: it never does); when it is not,
// next is the start of the next window (zero: the schedule names no day).
func (s Schedule) at(now time.Time) (in bool, end, next time.Time) {
	everyDay := true
	for _, d := range s.Days {
		everyDay = everyDay && d
	}
	if everyDay && s.Start == s.End {
		return true, time.Time{}, time.Time{}
	}
	for _, w := range s.windows(now) {
		if !now.Before(w.start) && now.Before(w.end) {
			return true, w.end, time.Time{}
		}
		if w.start.After(now) {
			return false, time.Time{}, w.start
		}
	}
	return false, time.Time{}, time.Time{}
}

// When is the allowed-time part of the settings. The master switch is Settings.Enabled, not a field here: Allowed
// answers only for a bot that is switched on.
type When struct {
	Mode     string
	Schedule Schedule
	OnUntil  time.Time // zero = none
}

// Allowed reports whether the bot may connect at now; until is when that ends (zero = no end: always, or a schedule
// with every day and a 24 h window), next is when it starts again (zero = nothing will start it). Only until is
// meaningful when allowed, only next when not. A live OnUntil allows in every mode; until is then the later of
// OnUntil and the schedule window's end when both hold.
func (w When) Allowed(now time.Time) (allowed bool, until, next time.Time) {
	if w.Mode == ModeAlways {
		return true, time.Time{}, time.Time{}
	}
	var inWindow bool
	var windowEnd, windowNext time.Time
	if w.Mode == ModeSchedule {
		inWindow, windowEnd, windowNext = w.Schedule.at(now)
	}
	onLive := w.OnUntil.After(now)
	switch {
	case inWindow && onLive:
		if windowEnd.IsZero() || w.OnUntil.Before(windowEnd) {
			return true, windowEnd, time.Time{}
		}
		return true, w.OnUntil, time.Time{}
	case inWindow:
		return true, windowEnd, time.Time{}
	case onLive:
		return true, w.OnUntil, time.Time{}
	}
	return false, time.Time{}, windowNext
}

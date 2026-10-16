// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telebot

import (
	"testing"
	"time"
)

// oct is a UTC time in October 2026: the 12th is a Monday, so the 14th is the Wednesday and the 19th the next Monday.
func oct(day, hour, min int) time.Time {
	return time.Date(2026, time.October, day, hour, min, 0, 0, time.UTC)
}

func mustSchedule(t *testing.T, s string) Schedule {
	t.Helper()
	sc, err := ParseSchedule(s)
	if err != nil {
		t.Fatalf("ParseSchedule(%q): %v", s, err)
	}
	return sc
}

func TestAllowedCalendar(t *testing.T) {
	if oct(14, 0, 0).Weekday() != time.Wednesday || oct(19, 0, 0).Weekday() != time.Monday {
		t.Fatalf("the test calendar moved: 14 Oct 2026 is %v", oct(14, 0, 0).Weekday())
	}
}

func TestParseSchedule(t *testing.T) {
	office := mustSchedule(t, OfficeHours)
	for _, d := range []time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday} {
		if !office.Days[d] {
			t.Errorf("office hours miss %v", d)
		}
	}
	if office.Days[time.Saturday] || office.Days[time.Sunday] {
		t.Errorf("office hours include the weekend: %v", office.Days)
	}
	if office.Start != 8*60 || office.End != 17*60+30 {
		t.Errorf("office hours window = %d-%d", office.Start, office.End)
	}
	if got := office.String(); got != OfficeHours {
		t.Errorf("String() = %q, want %q", got, OfficeHours)
	}

	if empty := mustSchedule(t, ""); empty != office {
		t.Errorf("an empty schedule reads as %v, want office hours %v", empty, office)
	}
	if blank := mustSchedule(t, "   "); blank != office {
		t.Errorf("a blank schedule reads as %v, want office hours %v", blank, office)
	}

	weekend := mustSchedule(t, "sat,sun 00:00-00:00")
	if !weekend.Days[time.Saturday] || !weekend.Days[time.Sunday] || weekend.Days[time.Monday] {
		t.Errorf("weekend days = %v", weekend.Days)
	}
	if weekend.Start != 0 || weekend.End != 0 {
		t.Errorf("weekend window = %d-%d, want a full day", weekend.Start, weekend.End)
	}
	if got := weekend.String(); got != "sat,sun 00:00-00:00" {
		t.Errorf("weekend String() = %q", got)
	}

	if loose := mustSchedule(t, " SUN, Mon  8:00-9:05 "); loose.String() != "mon,sun 08:00-09:05" {
		t.Errorf("a loosely typed schedule reads as %q", loose.String())
	}
}

func TestParseScheduleErrors(t *testing.T) {
	for _, s := range []string{
		"funday 08:00-17:30",   // unknown day
		"mon,,tue 08:00-17:30", // empty day
		"mon 25:00-17:30",      // hour out of range
		"mon 08:00-17:60",      // minute out of range
		"mon 08:00",            // no dash
		"mon 08:00-",           // no end
		"08:00-17:30",          // no days
		"mon 0800-1730",        // no colon
	} {
		if sc, err := ParseSchedule(s); err == nil {
			t.Errorf("ParseSchedule(%q) = %v, want an error", s, sc)
		}
	}
}

func TestAllowed(t *testing.T) {
	office := mustSchedule(t, OfficeHours)
	night := mustSchedule(t, "mon,tue,wed,thu,fri 17:30-08:00")
	weekend := mustSchedule(t, "sat,sun 00:00-00:00")
	everyDay := mustSchedule(t, "mon,tue,wed,thu,fri,sat,sun 00:00-00:00")
	var zero time.Time

	cases := []struct {
		name        string
		when        When
		now         time.Time
		wantAllowed bool
		wantUntil   time.Time
		wantNext    time.Time
	}{
		{"office, Wed 10:00 is inside", When{Mode: ModeSchedule, Schedule: office}, oct(14, 10, 0), true, oct(14, 17, 30), zero},
		{"office, the window opens at its start", When{Mode: ModeSchedule, Schedule: office}, oct(14, 8, 0), true, oct(14, 17, 30), zero},
		{"office, the window is over at its end", When{Mode: ModeSchedule, Schedule: office}, oct(14, 17, 30), false, zero, oct(15, 8, 0)},
		{"office, Wed 18:00 waits for Thu", When{Mode: ModeSchedule, Schedule: office}, oct(14, 18, 0), false, zero, oct(15, 8, 0)},
		{"office, Wed 07:00 waits for 08:00", When{Mode: ModeSchedule, Schedule: office}, oct(14, 7, 0), false, zero, oct(14, 8, 0)},
		{"office, Fri 18:00 waits for Mon", When{Mode: ModeSchedule, Schedule: office}, oct(16, 18, 0), false, zero, oct(19, 8, 0)},
		{"office, Sun waits for Mon", When{Mode: ModeSchedule, Schedule: office}, oct(18, 12, 0), false, zero, oct(19, 8, 0)},

		{"overnight, Tue 07:00 is Monday's window", When{Mode: ModeSchedule, Schedule: night}, oct(13, 7, 0), true, oct(13, 8, 0), zero},
		{"overnight, Tue 20:00 runs to Wed", When{Mode: ModeSchedule, Schedule: night}, oct(13, 20, 0), true, oct(14, 8, 0), zero},
		{"overnight, Sat 07:00 is Friday's window", When{Mode: ModeSchedule, Schedule: night}, oct(17, 7, 0), true, oct(17, 8, 0), zero},
		{"overnight, Sat 09:00 is outside", When{Mode: ModeSchedule, Schedule: night}, oct(17, 9, 0), false, zero, oct(19, 17, 30)},
		{"overnight, Mon 07:00 has no Sunday window", When{Mode: ModeSchedule, Schedule: night}, oct(19, 7, 0), false, zero, oct(19, 17, 30)},

		{"weekend, Sat 12:00 runs on through Sunday", When{Mode: ModeSchedule, Schedule: weekend}, oct(17, 12, 0), true, oct(19, 0, 0), zero},
		{"weekend, Mon waits for Sat", When{Mode: ModeSchedule, Schedule: weekend}, oct(19, 12, 0), false, zero, oct(24, 0, 0)},
		{"every day all day never ends", When{Mode: ModeSchedule, Schedule: everyDay}, oct(14, 3, 0), true, zero, zero},
		{"a schedule with no day never starts", When{Mode: ModeSchedule}, oct(14, 10, 0), false, zero, zero},

		{"manual with 2 h left", When{Mode: ModeManual, OnUntil: oct(14, 12, 0)}, oct(14, 10, 0), true, oct(14, 12, 0), zero},
		{"an unset mode is manual", When{OnUntil: oct(14, 12, 0)}, oct(14, 10, 0), true, oct(14, 12, 0), zero},
		{"manual, the time is up", When{Mode: ModeManual, OnUntil: oct(14, 12, 0)}, oct(14, 12, 0), false, zero, zero},
		{"manual, long past", When{Mode: ModeManual, OnUntil: oct(14, 9, 0)}, oct(14, 10, 0), false, zero, zero},
		{"manual with none", When{Mode: ModeManual}, oct(14, 10, 0), false, zero, zero},
		{"manual ignores the schedule", When{Mode: ModeManual, Schedule: office}, oct(14, 10, 0), false, zero, zero},

		{"always", When{Mode: ModeAlways}, oct(17, 3, 0), true, zero, zero},
		{"always with an on-for has no end", When{Mode: ModeAlways, OnUntil: oct(17, 4, 0)}, oct(17, 3, 0), true, zero, zero},

		{"schedule, outside, with a live on-for", When{Mode: ModeSchedule, Schedule: office, OnUntil: oct(17, 12, 0)}, oct(17, 10, 0), true, oct(17, 12, 0), zero},
		{"schedule, outside, with a lapsed on-for", When{Mode: ModeSchedule, Schedule: office, OnUntil: oct(17, 9, 0)}, oct(17, 10, 0), false, zero, oct(19, 8, 0)},
		{"schedule, inside, on-for past its end", When{Mode: ModeSchedule, Schedule: office, OnUntil: oct(14, 19, 0)}, oct(14, 10, 0), true, oct(14, 19, 0), zero},
		{"schedule, inside, on-for before its end", When{Mode: ModeSchedule, Schedule: office, OnUntil: oct(14, 12, 0)}, oct(14, 10, 0), true, oct(14, 17, 30), zero},
		{"unbounded schedule, an on-for adds nothing", When{Mode: ModeSchedule, Schedule: everyDay, OnUntil: oct(14, 12, 0)}, oct(14, 10, 0), true, zero, zero},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			allowed, until, next := c.when.Allowed(c.now)
			if allowed != c.wantAllowed {
				t.Errorf("allowed = %v, want %v", allowed, c.wantAllowed)
			}
			if !until.Equal(c.wantUntil) {
				t.Errorf("until = %v, want %v", until, c.wantUntil)
			}
			if !next.Equal(c.wantNext) {
				t.Errorf("next = %v, want %v", next, c.wantNext)
			}
		})
	}
}

// A window is a wall-clock time: on the day the clocks change it still opens and closes at "08:00" and "17:30".
func TestAllowedWallClockAcrossDaylightSaving(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("no time zone data: %v", err)
	}
	// The clocks go back at 02:00 on Sun 1 Nov 2026, which makes that Sunday 25 h long.
	day := When{Mode: ModeSchedule, Schedule: mustSchedule(t, "sun 08:00-17:30")}
	allowed, until, _ := day.Allowed(time.Date(2026, time.November, 1, 10, 0, 0, 0, ny))
	if want := time.Date(2026, time.November, 1, 17, 30, 0, 0, ny); !allowed || !until.Equal(want) {
		t.Errorf("Sunday window: allowed = %v, until = %v, want %v", allowed, until, want)
	}

	// From 23:00 Sat to the window's 06:00 Sun is 7 h on the wall clock and 8 h of elapsed time: the extra hour counts.
	night := When{Mode: ModeSchedule, Schedule: mustSchedule(t, "sat 22:00-06:00")}
	now := time.Date(2026, time.October, 31, 23, 0, 0, 0, ny)
	allowed, until, _ = night.Allowed(now)
	if want := time.Date(2026, time.November, 1, 6, 0, 0, 0, ny); !allowed || !until.Equal(want) {
		t.Errorf("overnight window: allowed = %v, until = %v, want %v", allowed, until, want)
	}
	if got := until.Sub(now); got != 8*time.Hour {
		t.Errorf("overnight window left = %v, want 8h of elapsed time across the extra hour", got)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"reflect"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestDeletesAtAndDueAt(t *testing.T) {
	mtime := daysAgo(5)
	if got, want := DeletesAt(mtime, 90), mtime.Add(90*24*time.Hour); !got.Equal(want) {
		t.Errorf("DeletesAt = %v, want the last write plus 90 days, %v", got, want)
	}
	if got, want := DueAt(mtime, 90), mtime.Add(80*24*time.Hour); !got.Equal(want) {
		t.Errorf("DueAt = %v, want 10 days before the deletion day, %v", got, want)
	}
	if got, want := DueAt(mtime, 30), mtime.Add(20*24*time.Hour); !got.Equal(want) {
		t.Errorf("DueAt of a 30-day period = %v, want %v", got, want)
	}
}

// sess is a candidate last written age days ago.
func sess(name string, age float64, size int64) agentsessions.DigestSession {
	return agentsessions.DigestSession{Path: "/claude/" + name + ".jsonl", Stem: name, Mtime: daysAgo(age), Size: size}
}

// scannedAs is the mark a scan leaves for a session as it stands.
func scannedAs(c agentsessions.DigestSession, outcome string) wshrpc.SessionIdeaMark {
	return wshrpc.SessionIdeaMark{TranscriptPath: c.Path, SessionID: c.Stem, Size: c.Size, MtimeMs: c.Mtime.UnixMilli(), Outcome: outcome}
}

func TestPlan(t *testing.T) {
	forcedLate := sess("forced-late", 85, 10)   // 5 days left
	forcedFirst := sess("forced-first", 89, 10) // 1 day left: nearest deletion goes first
	forcedEdge := sess("forced-edge", 83, 10)   // exactly 7 days left: forced
	dueEdge := sess("due-edge", 80, 10)         // its scan came due this instant
	dueSoon := sess("due-soon", 82, 10)         // 8 days left: due, not forced
	notYet := sess("not-yet", 79.9, 10)         // 10.1 days left: not due
	young := sess("young", 3, 10)               // quiet, far from deletion
	scanned := sess("scanned", 88, 10)          // read already, as it stands
	skipped := sess("skipped", 88, 10)          // passed over, as it stands
	grown := sess("grown", 88, 10)              // its mark holds an older size: the new turns are unread
	archived := sess("archived", 88, 10)        // in arcterm's archive, which a scan skips
	archived.Archived = true
	marks := []wshrpc.SessionIdeaMark{
		scannedAs(scanned, wshrpc.SessionIdeaOutcome_Nothing),
		scannedAs(skipped, wshrpc.SessionIdeaOutcome_Skipped),
		{TranscriptPath: grown.Path, Size: 5, MtimeMs: grown.Mtime.Add(-time.Hour).UnixMilli(), Outcome: wshrpc.SessionIdeaOutcome_Ideas},
	}
	cands := []agentsessions.DigestSession{
		young, forcedLate, dueEdge, scanned, skipped, archived, notYet, grown, forcedEdge, dueSoon, forcedFirst,
	}

	due, forced := Plan(cands, marks, scanNow, 90)
	if want := []string{forcedFirst.Path, grown.Path, forcedLate.Path, forcedEdge.Path}; !reflect.DeepEqual(forced, want) {
		t.Errorf("forced is every unscanned session with at most 7 days left (a grown one included), nearest deletion first: got %v, want %v", forced, want)
	}
	if want := []string{dueSoon.Path, dueEdge.Path}; !reflect.DeepEqual(due, want) {
		t.Errorf("due is the rest whose scan came due (a forced one is not listed twice), nearest deletion first: got %v, want %v", due, want)
	}
}

func TestPlanNeverSchedulesWhatAScanLeavesAlone(t *testing.T) {
	young := sess("written-an-hour-ago", 0, 10) // still being written
	young.Mtime = scanNow.Add(-time.Hour)
	passedOver := sess("passed-over", 89, 10)
	archived := sess("archived", 89, 10)
	archived.Archived = true
	marks := []wshrpc.SessionIdeaMark{scannedAs(passedOver, wshrpc.SessionIdeaOutcome_Skipped)}

	// with a 2-day period the young one is 1 day from deletion, but a scan leaves a session still being written alone
	due, forced := Plan([]agentsessions.DigestSession{young, passedOver, archived}, marks, scanNow, 2)
	if len(due) != 0 || len(forced) != 0 {
		t.Fatalf("a skipped session is never due or forced, nor an archived or still-written one: due %v forced %v", due, forced)
	}
	due, forced = Plan(nil, nil, scanNow, 90)
	if len(due) != 0 || len(forced) != 0 {
		t.Fatalf("no candidates, nothing to plan: due %v forced %v", due, forced)
	}
}

func TestPlanFollowsThePeriodOfTheSetting(t *testing.T) {
	a := sess("a", 21, 10) // with 30 days: due since 1 day, 9 days left
	b := sess("b", 23, 10) // 7 days left
	due, forced := Plan([]agentsessions.DigestSession{a, b}, nil, scanNow, 30)
	if !reflect.DeepEqual(due, []string{a.Path}) || !reflect.DeepEqual(forced, []string{b.Path}) {
		t.Fatalf("a 30-day period: got due %v forced %v", due, forced)
	}
	due, forced = Plan([]agentsessions.DigestSession{a, b}, nil, scanNow, 90)
	if len(due) != 0 || len(forced) != 0 {
		t.Fatalf("the same sessions under a 90-day period are not near anything: due %v forced %v", due, forced)
	}
}

func TestNextDueTs(t *testing.T) {
	soon := sess("soon", 70, 10) // due in 10 days
	later := sess("later", 40, 10)
	scanned := sess("scanned", 85, 10) // read already: it holds no scan
	archived := sess("archived", 79, 10)
	archived.Archived = true
	marks := []wshrpc.SessionIdeaMark{scannedAs(scanned, wshrpc.SessionIdeaOutcome_Ideas)}

	got := NextDueTs([]agentsessions.DigestSession{later, scanned, archived, soon}, marks, scanNow, 90)
	if want := DueAt(soon.Mtime, 90).UnixMilli(); got != want {
		t.Errorf("the next scan is the earliest due day of what is left to scan: got %d, want %d", got, want)
	}
	if got := NextDueTs([]agentsessions.DigestSession{scanned, archived}, marks, scanNow, 90); got != 0 {
		t.Errorf("nothing left to scan has no next scan, got %d", got)
	}
}

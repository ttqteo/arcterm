// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runprune

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var now = time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)

func daysAgo(d int) int64 { return now.Add(-time.Duration(d) * 24 * time.Hour).UnixMilli() }

const prompt = "You are the reviewer for task 3.\n\nRead the diff…\n" // a generated prompt: several lines

func oids(runs []*waveobj.Run) string {
	var ids []string
	for _, r := range runs {
		ids = append(ids, r.OID)
	}
	return strings.Join(ids, ",")
}

func TestCandidatesAreFinishedEngineSessionsOlderThanAWeek(t *testing.T) {
	runs := []*waveobj.Run{
		{OID: "task-old", TaskId: "t1", Status: "done", CompletedTs: daysAgo(8), Goal: prompt},
		{OID: "review-old", Review: true, TaskId: "t1", Status: "done", CompletedTs: daysAgo(30), Goal: prompt},
		{OID: "stage-old", StageRole: "plan-reviewer", Status: "cancelled", CancelledTs: daysAgo(9), Goal: prompt},
		{OID: "cancelled-unrecorded", TaskId: "t2", Status: "cancelled", CreatedTs: daysAgo(10), Goal: prompt},
		// kept whole:
		{OID: "task-recent", TaskId: "t3", Status: "done", CompletedTs: daysAgo(6), Goal: prompt},
		{OID: "task-blocked", TaskId: "t4", Status: "blocked", CreatedTs: daysAgo(20), Goal: prompt},
		{OID: "task-executing", TaskId: "t5", Status: "executing", CreatedTs: daysAgo(20), Goal: prompt},
		{OID: "person-run", Status: "done", CompletedTs: daysAgo(40), Goal: prompt},
		{OID: "lead", DagORef: "dag:a", Status: "done", CompletedTs: daysAgo(40), Goal: prompt},
		{OID: "already-trimmed", TaskId: "t6", Status: "done", CompletedTs: daysAgo(40), Goal: "You are the reviewer for task 3."},
	}
	if got, want := oids(Candidates(runs, now)), "task-old,review-old,stage-old,cancelled-unrecorded"; got != want {
		t.Fatalf("candidates = %s, want %s", got, want)
	}
}

func TestADagStillRunningKeepsItsSessionsWhole(t *testing.T) {
	runs := []*waveobj.Run{
		{OID: "lead", DagORef: "dag:a", Status: "executing", CreatedTs: daysAgo(12)},
		{OID: "task-a", DagORef: "dag:a", TaskId: "t1", Status: "done", CompletedTs: daysAgo(10), Goal: prompt},
		{OID: "lead-b", DagORef: "dag:b", Status: "done", CompletedTs: daysAgo(9)},
		{OID: "task-b", DagORef: "dag:b", TaskId: "t1", Status: "done", CompletedTs: daysAgo(10), Goal: prompt},
	}
	if got := oids(Candidates(runs, now)); got != "task-b" {
		t.Fatalf("candidates = %s, want task-b", got)
	}
}

func TestTrimmedGoalKeepsTheFirstLineCapped(t *testing.T) {
	if got := TrimmedGoal("\n  You are the reviewer.  \nmore\nmore"); got != "You are the reviewer." {
		t.Fatalf("TrimmedGoal = %q", got)
	}
	long := strings.Repeat("ả", MaxGoalRunes+50) + "\nrest"
	got := []rune(TrimmedGoal(long))
	if len(got) != MaxGoalRunes || got[len(got)-1] != '…' {
		t.Fatalf("a long first line keeps %d runes ending %q, want %d ending …", len(got), got[len(got)-1], MaxGoalRunes)
	}
	if TrimmedGoal(TrimmedGoal(long)) != TrimmedGoal(long) {
		t.Fatal("trimming twice changes the goal again, so a sweep would rewrite it every day")
	}
}

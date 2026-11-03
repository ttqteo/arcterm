// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workflowscan

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var testNow = time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)

func daysAgo(d float64) int64 {
	return testNow.Add(-time.Duration(d * float64(24*time.Hour))).UnixMilli()
}

func testRun(id string, created int64) *waveobj.Run {
	return &waveobj.Run{OID: id, ID: id, Goal: "goal of " + id, CreatedTs: created}
}

func info(r *waveobj.Run, project string) RunInfo {
	return RunInfo{Run: r, Project: project}
}

func ev(runId, kind string, ts int64, detail map[string]any) waveobj.RunEvent {
	raw, _ := json.Marshal(detail)
	return waveobj.RunEvent{RunID: runId, Kind: kind, Ts: ts, Detail: raw}
}

func blockOf(t *testing.T, c Corpus, runId string) Block {
	t.Helper()
	for _, b := range c.Blocks {
		if b.RunId == runId {
			return b
		}
	}
	t.Fatalf("no block for run %s in %+v", runId, c.Blocks)
	return Block{}
}

func TestCorpusSignals(t *testing.T) {
	run := testRun("aaaaaaaa-0000-0000-0000-000000000001", daysAgo(2))
	run.Evidence = &waveobj.RunEvidence{
		Dag: &waveobj.EvidenceDag{
			Tasks: []waveobj.EvidenceDagTask{{TaskId: "t-2", Differs: "used a map", FoundNotFixed: "flaky base test", NotVerified: "none"}},
			Told:  []string{"stop editing AGENTS.md"},
		},
		Verification: &waveobj.RunVerification{State: "unverified", Reasons: []string{"scenario read an empty store"}},
	}
	silent := testRun("bbbbbbbb-0000-0000-0000-000000000002", daysAgo(2))
	ts := daysAgo(2)
	events := []waveobj.RunEvent{
		ev(run.OID, "plan-reviewed", ts+1, map[string]any{"findings": "plan asks for a whole-package run"}),
		ev(run.OID, "task-review-failed", ts+2, map[string]any{"taskid": "t-1", "note": "missed the edge case"}),
		ev(run.OID, "task-review-passed", ts+3, map[string]any{"taskid": "t-1", "unverified": "did not run the scenario"}),
		ev(run.OID, "child-ask", ts+4, map[string]any{"taskid": "t-1", "question": "which branch?"}),
		ev(run.OID, "task-told", ts+5, map[string]any{"taskid": "t-1", "text": "use the existing helper"}),
		ev(run.OID, "land-held", ts+6, map[string]any{"reason": "merge conflict in go.mod"}),
		ev(run.OID, "task-failed", ts+7, map[string]any{"taskid": "t-3", "lastfailurekind": "stalled", "detail": "no output for 10m"}),
		ev(run.OID, "task-verify-failed", ts+8, map[string]any{"taskid": "t-3", "reason": "go test", "detail": "--- FAIL: TestX"}),
		ev(run.OID, "lead-wake-failed", ts+9, map[string]any{"lines": []string{"line one", "line two"}}),
		ev(run.OID, "task-retried", ts+10, map[string]any{"taskid": "t-3", "kind": "stalled"}),
		ev(run.OID, "review-overruled", ts+11, map[string]any{"taskid": "t-4"}),
		// none of these is a line
		ev(silent.OID, "task-review-passed", ts, map[string]any{"taskid": "t-1", "note": "fine"}),
		ev(silent.OID, "child-answered", ts, map[string]any{"taskid": "t-1", "askid": "x"}),
		ev(silent.OID, "task-lead-told", ts, map[string]any{"taskid": "t-1", "text": "hand-off"}),
		ev(silent.OID, "task-told", ts, map[string]any{"taskid": "t-1", "text": "none"}),
		ev(silent.OID, "task-told", ts, map[string]any{"taskid": "t-1", "text": "Undefined."}),
		ev(silent.OID, "land-held", ts, map[string]any{"reason": "  "}),
	}
	c := BuildCorpus([]RunInfo{info(run, "waveterm"), info(silent, "waveterm")}, events, testNow, 14)

	if len(c.Blocks) != 1 {
		t.Fatalf("blocks = %d, want 1 (the silent run has no signal): %+v", len(c.Blocks), c.Blocks)
	}
	want := []string{
		"[plan-reviewed] plan asks for a whole-package run",
		"[task-review-failed] t-1 missed the edge case",
		"[task-review-passed] t-1 reviewer-unverified: did not run the scenario",
		"[child-ask] t-1 which branch?",
		"[task-told] t-1 use the existing helper",
		"[land-held] merge conflict in go.mod",
		"[task-failed] t-3 stalled no output for 10m",
		"[task-verify-failed] t-3 --- FAIL: TestX",
		"[lead-wake-failed] line one / line two",
		`[task-retried] {"kind":"stalled","taskid":"t-3"}`,
		`[review-overruled] {"taskid":"t-4"}`,
		"[t-2 differs] used a map",
		"[t-2 found-not-fixed] flaky base test",
		"[human-told] stop editing AGENTS.md",
		"[final-unverified] scenario read an empty store",
	}
	b := blockOf(t, c, run.OID)
	if strings.Join(b.Lines, "\n") != strings.Join(want, "\n") {
		t.Errorf("lines:\n%s\nwant:\n%s", strings.Join(b.Lines, "\n"), strings.Join(want, "\n"))
	}
	header := "### run aaaaaaaa · 2026-10-24 · waveterm · goal of " + run.OID
	if !strings.HasPrefix(c.Text, header+"\n[plan-reviewed]") {
		t.Errorf("text starts %q, want header %q", c.Text[:min(len(c.Text), 120)], header)
	}
	if b.Short != "aaaaaaaa" || b.Date != "2026-10-24" || b.Project != "waveterm" {
		t.Errorf("block = %+v", b)
	}
	if c.Runs != 1 || c.Projects != 1 || c.Dropped != 0 {
		t.Errorf("counts runs=%d projects=%d dropped=%d", c.Runs, c.Projects, c.Dropped)
	}
}

func TestCorpusFieldCut(t *testing.T) {
	run := testRun("cccccccc-0000-0000-0000-000000000001", daysAgo(1))
	long := strings.Repeat("é", 2000)
	c := BuildCorpus([]RunInfo{info(run, "p")}, []waveobj.RunEvent{
		ev(run.OID, "land-held", daysAgo(1), map[string]any{"reason": long}),
	}, testNow, 14)
	line := blockOf(t, c, run.OID).Lines[0]
	want := "[land-held] " + strings.Repeat("é", MaxField) + " …"
	if line != want {
		t.Errorf("line has %d runes, want %d", len([]rune(line)), len([]rune(want)))
	}
}

func TestCorpusWindow(t *testing.T) {
	old := testRun("dddddddd-0000-0000-0000-000000000001", daysAgo(15))
	events := []waveobj.RunEvent{ev(old.OID, "land-held", daysAgo(15), map[string]any{"reason": "held"})}
	runs := []RunInfo{info(old, "p")}
	if c := BuildCorpus(runs, events, testNow, 14); len(c.Blocks) != 0 {
		t.Errorf("14-day window kept a 15-day-old run: %+v", c.Blocks)
	}
	if c := BuildCorpus(runs, events, testNow, 30); len(c.Blocks) != 1 {
		t.Errorf("30-day window dropped a 15-day-old run")
	}
}

func TestCorpusSkipsBrainstormAndScanRuns(t *testing.T) {
	check := testRun("eeeeeeee-0000-0000-0000-000000000001", daysAgo(1))
	check.StageRole = "builder-check"
	judge := testRun("eeeeeeee-0000-0000-0000-000000000002", daysAgo(1))
	judge.StageRole = "brainstorm-judge"
	scan := testRun("eeeeeeee-0000-0000-0000-000000000003", daysAgo(1))
	scan.WorkflowScan = &waveobj.WorkflowScan{State: waveobj.WorkflowScanState_Picking}
	kept := testRun("eeeeeeee-0000-0000-0000-000000000004", daysAgo(1))
	var runs []RunInfo
	var events []waveobj.RunEvent
	for _, r := range []*waveobj.Run{check, judge, scan, kept} {
		runs = append(runs, info(r, "p"))
		events = append(events, ev(r.OID, "land-held", daysAgo(1), map[string]any{"reason": "held"}))
	}
	c := BuildCorpus(runs, events, testNow, 14)
	if len(c.Blocks) != 1 || c.Blocks[0].RunId != kept.OID {
		t.Errorf("blocks = %+v, want only %s", c.Blocks, kept.OID)
	}
}

func TestCorpusCapDropsOldest(t *testing.T) {
	big := strings.Repeat("x", MaxField)
	var runs []RunInfo
	var events []waveobj.RunEvent
	// each block holds 4 cut fields, about 6k chars, so 200 blocks pass the cap
	const n = 200
	for i := range n {
		r := testRun(fmt.Sprintf("%08d-0000-0000-0000-000000000000", i), daysAgo(13)+int64(i))
		runs = append(runs, info(r, "p"))
		for range 4 {
			events = append(events, ev(r.OID, "land-held", r.CreatedTs, map[string]any{"reason": big}))
		}
	}
	c := BuildCorpus(runs, events, testNow, 14)
	if c.Dropped == 0 || c.Dropped+len(c.Blocks) != n {
		t.Fatalf("dropped=%d kept=%d, want a cut summing to %d", c.Dropped, len(c.Blocks), n)
	}
	if got := len([]rune(c.Text)); got > MaxCorpusChars {
		t.Errorf("text is %d chars, over the cap %d", got, MaxCorpusChars)
	}
	newest := runs[n-1].Run.OID
	if c.Blocks[len(c.Blocks)-1].RunId != newest {
		t.Errorf("newest block %s was dropped", newest)
	}
	if c.Blocks[0].RunId == runs[0].Run.OID {
		t.Errorf("oldest block survived the cut")
	}
	if c.Runs != len(c.Blocks) {
		t.Errorf("Runs = %d, want the kept blocks %d", c.Runs, len(c.Blocks))
	}
}

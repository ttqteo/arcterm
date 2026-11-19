// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const (
	backlogCutoff = int64(1_000_000)
	// two run ids that share nothing, so a label names one or the other
	backlogRunA = "aaaa1111-2222-4333-8444-555555555555"
	backlogRunB = "bbbb9999-2222-4333-8444-555555555555"
)

func orchRun(oid string, created int64) *waveobj.Run {
	return &waveobj.Run{OID: oid, ID: oid, Mode: "orchestrator", CreatedTs: created}
}

// backlogEffort is an active initiative with one chunk whose first note is at written.
func backlogEffort(oid string, written int64, c waveobj.EffortChunk) *waveobj.Effort {
	if c.Status == "" {
		c.Status = "pending"
	}
	if written > 0 {
		c.Notes = append([]waveobj.EffortNote{{Ts: written, Text: "chunk added"}}, c.Notes...)
	}
	return &waveobj.Effort{OID: oid, Status: "active", Chunks: []waveobj.EffortChunk{c}, CreatedTs: 1}
}

func pickOne(t *testing.T, e *waveobj.Effort, runs ...*waveobj.Run) []BacklogProposal {
	t.Helper()
	return PickBacklogProposals([]*waveobj.Effort{e}, runs, backlogCutoff)
}

func TestPickBacklogProposalsPicksAChunkNamingARecentOrchestratorRun(t *testing.T) {
	e := backlogEffort("e1", backlogCutoff+10, waveobj.EffortChunk{Label: "fix the flaky retry (run aaaa1111)"})
	got := pickOne(t, e, orchRun(backlogRunA, backlogCutoff+5))
	want := []BacklogProposal{{EffortOID: "e1", Label: "fix the flaky retry (run aaaa1111)", RunOID: backlogRunA}}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestPickBacklogProposalsSkipsAChunkThatIsNotPending(t *testing.T) {
	for _, status := range []string{"active", "blocked", "done", "deferred", "skipped", "proposed"} {
		e := backlogEffort("e1", backlogCutoff+10, waveobj.EffortChunk{Label: "issue aaaa1111", Status: status})
		if got := pickOne(t, e, orchRun(backlogRunA, backlogCutoff+5)); len(got) != 0 {
			t.Fatalf("a %s chunk was picked: %+v", status, got)
		}
	}
}

func TestPickBacklogProposalsSkipsAChunkWithAWorkref(t *testing.T) {
	c := waveobj.EffortChunk{Label: "issue aaaa1111", WorkRefs: []waveobj.ChunkWorkRef{{Kind: "run", ORef: "run:x"}}}
	if got := pickOne(t, backlogEffort("e1", backlogCutoff+10, c), orchRun(backlogRunA, backlogCutoff+5)); len(got) != 0 {
		t.Fatalf("a chunk held by a run was picked: %+v", got)
	}
}

func TestPickBacklogProposalsSkipsAChunkWrittenBeforeTheCutoff(t *testing.T) {
	c := waveobj.EffortChunk{Label: "issue aaaa1111"}
	if got := pickOne(t, backlogEffort("e1", backlogCutoff-1, c), orchRun(backlogRunA, backlogCutoff+5)); len(got) != 0 {
		t.Fatalf("a chunk written before the cutoff was picked: %+v", got)
	}
	// on the cutoff counts
	if got := pickOne(t, backlogEffort("e1", backlogCutoff, c), orchRun(backlogRunA, backlogCutoff+5)); len(got) != 1 {
		t.Fatalf("a chunk written on the cutoff was skipped: %+v", got)
	}
}

// a chunk is dated by its earliest note: a note added after the cutoff to a chunk written before it does not date it
func TestPickBacklogProposalsDatesAChunkByItsEarliestNote(t *testing.T) {
	c := waveobj.EffortChunk{Label: "issue aaaa1111", Notes: []waveobj.EffortNote{{Ts: backlogCutoff + 500, Text: "looked at it"}}}
	e := backlogEffort("e1", backlogCutoff-100, c)
	if got := pickOne(t, e, orchRun(backlogRunA, backlogCutoff+5)); len(got) != 0 {
		t.Fatalf("a later note moved the chunk's written time: %+v", got)
	}
}

// with no note, the chunk-added event under the chunk's label dates it; with neither, the chunk is skipped
func TestPickBacklogProposalsDatesAChunkWithNoNoteByItsAddedEvent(t *testing.T) {
	run := orchRun(backlogRunA, backlogCutoff+5)
	e := backlogEffort("e1", 0, waveobj.EffortChunk{Label: "issue aaaa1111"})
	if got := pickOne(t, e, run); len(got) != 0 {
		t.Fatalf("a chunk with no note and no event was picked: %+v", got)
	}
	e.Events = []waveobj.EffortEvent{
		{Ts: backlogCutoff - 50, Kind: "chunk-added", Label: "another chunk"},
		{Ts: backlogCutoff + 50, Kind: "chunk-added", Label: "issue aaaa1111"},
	}
	if got := pickOne(t, e, run); len(got) != 1 {
		t.Fatalf("a chunk added after the cutoff was skipped: %+v", got)
	}
	e.Events[1].Ts = backlogCutoff - 50
	if got := pickOne(t, e, run); len(got) != 0 {
		t.Fatalf("a chunk added before the cutoff was picked: %+v", got)
	}
}

func TestPickBacklogProposalsSkipsRunsThatAreNotARecentTopLevelOrchestratorRun(t *testing.T) {
	c := waveobj.EffortChunk{Label: "issue aaaa1111"}
	cases := map[string]*waveobj.Run{
		"quick run":           {OID: backlogRunA, Mode: "quick", CreatedTs: backlogCutoff + 5},
		"pipeline run":        {OID: backlogRunA, Mode: "pipeline", CreatedTs: backlogCutoff + 5},
		"run with no mode":    {OID: backlogRunA, CreatedTs: backlogCutoff + 5},
		"older than cutoff":   {OID: backlogRunA, Mode: "orchestrator", CreatedTs: backlogCutoff - 1},
		"engine task child":   {OID: backlogRunA, Mode: "orchestrator", CreatedTs: backlogCutoff + 5, TaskId: "t-1"},
		"engine review child": {OID: backlogRunA, Mode: "orchestrator", CreatedTs: backlogCutoff + 5, Review: true},
		"engine stage child":  {OID: backlogRunA, Mode: "orchestrator", CreatedTs: backlogCutoff + 5, StageRole: "verifier"},
		"lead's child run":    {OID: backlogRunA, Mode: "orchestrator", CreatedTs: backlogCutoff + 5, ParentLeadORef: "tab:abc"},
	}
	for name, run := range cases {
		if got := pickOne(t, backlogEffort("e1", backlogCutoff+10, c), run); len(got) != 0 {
			t.Errorf("%s: picked %+v", name, got)
		}
	}
	// the run counts on the cutoff
	if got := pickOne(t, backlogEffort("e1", backlogCutoff+10, c), orchRun(backlogRunA, backlogCutoff)); len(got) != 1 {
		t.Errorf("a run created on the cutoff was skipped: %+v", got)
	}
}

func TestPickBacklogProposalsReadsTheIdOnlyWithNoHexCharacterBesideIt(t *testing.T) {
	run := orchRun(backlogRunA, backlogCutoff+5)
	for label, want := range map[string]bool{
		"issue aaaa1111":                    true,
		"aaaa1111 leaves a flaky test":      true,
		"(run aaaa1111).":                   true,
		"issue AAAA1111 upper":              true,
		"run:aaaa1111-extra":                true, // a hyphen is no hex character
		"issue aaaa11112":                   false,
		"issue 0aaaa1111":                   false,
		"issue deadaaaa1111beef":            false,
		"issue aaaa111":                     false,
		"issue aaaa 1111":                   false,
		"issue aaaa11112 and then aaaa1111": true, // a later, clean mention counts
	} {
		got := pickOne(t, backlogEffort("e1", backlogCutoff+10, waveobj.EffortChunk{Label: label}), run)
		if (len(got) == 1) != want {
			t.Errorf("label %q: picked %v, want %v", label, len(got) == 1, want)
		}
	}
}

func TestPickBacklogProposalsTakesTheNewerRunWhenALabelNamesTwo(t *testing.T) {
	older := orchRun(backlogRunA, backlogCutoff+5)
	newer := orchRun(backlogRunB, backlogCutoff+90)
	e := backlogEffort("e1", backlogCutoff+100, waveobj.EffortChunk{Label: "from aaaa1111 and bbbb9999"})
	for _, runs := range [][]*waveobj.Run{{older, newer}, {newer, older}} {
		got := pickOne(t, e, runs...)
		if len(got) != 1 || got[0].RunOID != backlogRunB {
			t.Fatalf("got %+v, want run %s", got, backlogRunB)
		}
	}
}

func TestPickBacklogProposalsSkipsAnInitiativeThatIsDoneOrArchived(t *testing.T) {
	run := orchRun(backlogRunA, backlogCutoff+5)
	for _, status := range []string{"done", "archived"} {
		e := backlogEffort("e1", backlogCutoff+10, waveobj.EffortChunk{Label: "issue aaaa1111"})
		e.Status = status
		if got := pickOne(t, e, run); len(got) != 0 {
			t.Fatalf("a %s initiative's chunk was picked: %+v", status, got)
		}
	}
	e := backlogEffort("e1", backlogCutoff+10, waveobj.EffortChunk{Label: "issue aaaa1111"})
	e.Status = "paused"
	if got := pickOne(t, e, run); len(got) != 1 {
		t.Fatalf("a paused initiative's chunk was skipped: %+v", got)
	}
}

func TestPickBacklogProposalsWalksEveryInitiativeInOrder(t *testing.T) {
	runs := []*waveobj.Run{orchRun(backlogRunA, backlogCutoff+5), orchRun(backlogRunB, backlogCutoff+6)}
	e1 := backlogEffort("e1", backlogCutoff+10, waveobj.EffortChunk{Label: "one aaaa1111"})
	e1.Chunks = append(e1.Chunks,
		waveobj.EffortChunk{Label: "unrelated", Status: "pending"},
		waveobj.EffortChunk{Label: "two bbbb9999", Status: "pending", Notes: []waveobj.EffortNote{{Ts: backlogCutoff + 11, Text: "chunk added"}}})
	e2 := backlogEffort("e2", backlogCutoff+10, waveobj.EffortChunk{Label: "three bbbb9999"})
	got := PickBacklogProposals([]*waveobj.Effort{e1, e2}, runs, backlogCutoff)
	want := []BacklogProposal{
		{EffortOID: "e1", Label: "one aaaa1111", RunOID: backlogRunA},
		{EffortOID: "e1", Label: "two bbbb9999", RunOID: backlogRunB},
		{EffortOID: "e2", Label: "three bbbb9999", RunOID: backlogRunB},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("pick %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestBacklogSinceIsTheThirteenthOfNovemberLocal(t *testing.T) {
	// 2026-11-13 00:00 local, read back in local time so the test holds in any zone
	got := time.UnixMilli(BacklogSince()).In(time.Local)
	if got.Year() != 2026 || got.Month() != time.November || got.Day() != 13 || got.Hour() != 0 || got.Minute() != 0 {
		t.Fatalf("BacklogSince = %v", got)
	}
}

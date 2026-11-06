package jarvisstate

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestTimelineEffortEventsFoldChunkLabel(t *testing.T) {
	eff := &waveobj.Effort{
		OID:   "eff-1",
		Title: "Scenario gate clearance",
		Events: []waveobj.EffortEvent{
			{Ts: 100, Kind: "chunk-done", Label: "Phase 3", Text: "marked done"},
		},
	}
	evs := Timeline(nil, nil, nil, nil, []*waveobj.Effort{eff}, 0)
	if len(evs) != 1 {
		t.Fatalf("expected 1 event, got %d", len(evs))
	}
	ev := evs[0]
	if ev.Title != "Scenario gate clearance" {
		t.Errorf("title = %q, want effort title", ev.Title)
	}
	if ev.Detail != "Phase 3 · marked done" {
		t.Errorf("detail = %q, want %q", ev.Detail, "Phase 3 · marked done")
	}
	if ev.NavTarget != "effort:eff-1" {
		t.Errorf("navtarget = %q, want effort:eff-1", ev.NavTarget)
	}
}

func TestEffortSummaryCarriesNewestNoteAcrossChunks(t *testing.T) {
	eff := &waveobj.Effort{
		OID:   "eff-2",
		Title: "Anomaly-driven hypothesis system",
		Notes: []waveobj.EffortNote{{Ts: 100, Text: "effort created"}},
		Chunks: []waveobj.EffortChunk{
			{Label: "A1", Status: "done", Notes: []waveobj.EffortNote{{Ts: 300, Text: "older", Author: "agent"}}},
			{Label: "C0", Status: "active", Notes: []waveobj.EffortNote{
				{Ts: 500, Text: "merged to LOCAL DEV, NOT pushed\nsecond line stays in the detail", Author: "agent", Session: "agent:tab-1"},
			}},
		},
	}
	got := EffortSummaryOf(eff).LastNote
	if got == nil {
		t.Fatal("no last note")
	}
	if got.Ts != 500 || got.Session != "agent:tab-1" || got.Chunk != "C0" {
		t.Errorf("last note = %+v, want ts 500 from agent:tab-1 on C0", got)
	}
	if got.Text != "merged to LOCAL DEV, NOT pushed" {
		t.Errorf("text = %q, want only the first line", got.Text)
	}
}

func TestEffortSummaryLastNoteIsCapped(t *testing.T) {
	long := strings.Repeat("x", LastNoteMaxChars+50)
	eff := &waveobj.Effort{OID: "eff-3", Notes: []waveobj.EffortNote{{Ts: 1, Text: long}}}
	got := EffortSummaryOf(eff).LastNote
	if got == nil || len([]rune(got.Text)) != LastNoteMaxChars {
		t.Fatalf("last note text not capped to %d: %+v", LastNoteMaxChars, got)
	}
}

func TestEffortSummaryWithoutNotesHasNoLastNote(t *testing.T) {
	if got := EffortSummaryOf(&waveobj.Effort{OID: "eff-4"}).LastNote; got != nil {
		t.Fatalf("last note = %+v, want nil", got)
	}
}

func TestEffortSummaryBlockedChunkCarriesNeedsAndAge(t *testing.T) {
	eff := &waveobj.Effort{
		OID: "eff-b",
		Chunks: []waveobj.EffortChunk{
			{Label: "S6", Status: "blocked", Notes: []waveobj.EffortNote{
				{Ts: 100, Text: "marked blocked · needs: a DEV soak\nsecond line"},
				{Ts: 200, Text: "the empty-buffer blocker is gone on DEV", Author: "agent"},
			}},
			{Label: "G10", Status: "blocked", Notes: []waveobj.EffortNote{{Ts: 50, Text: "marked blocked · needs: the G4 label"}}},
			{Label: "Old", Status: "blocked"},
			{Label: "Done", Status: "done", Notes: []waveobj.EffortNote{{Ts: 10, Text: "marked blocked · stale"}}},
		},
	}
	s := EffortSummaryOf(eff)
	b := s.Chunks[0].Blocked
	if b == nil || b.Since != 100 || b.Needs != "needs: a DEV soak" {
		t.Fatalf("S6 blocked = %+v, want since 100 and the marking note's first line", b)
	}
	if b.Latest == nil || b.Latest.Ts != 200 || b.Latest.Text != "the empty-buffer blocker is gone on DEV" {
		t.Errorf("S6 latest = %+v, want the newer note", b.Latest)
	}
	if g := s.Chunks[1].Blocked; g == nil || g.Since != 50 || g.Latest != nil {
		t.Errorf("G10 blocked = %+v, want since 50 and no latest (the marking note is the newest)", g)
	}
	if o := s.Chunks[2].Blocked; o == nil || o.Since != 0 || o.Needs != "" {
		t.Errorf("unrecorded block = %+v, want an empty Blocked", o)
	}
	if s.Chunks[3].Blocked != nil {
		t.Errorf("a done chunk carries Blocked %+v", s.Chunks[3].Blocked)
	}
}

func TestEffortSummaryBlockedChunkTakesTheLatestMarking(t *testing.T) {
	// blocked, unblocked, blocked again: the age is the last marking's, and what it needs is that note's
	eff := &waveobj.Effort{
		OID: "eff-r",
		Chunks: []waveobj.EffortChunk{
			{Label: "S6", Status: "blocked", Notes: []waveobj.EffortNote{
				{Ts: 100, Text: "marked blocked · needs: the old thing"},
				{Ts: 150, Text: "marked pending"},
				{Ts: 300, Text: "marked blocked · needs: a new thing"},
			}},
		},
	}
	b := EffortSummaryOf(eff).Chunks[0].Blocked
	if b == nil || b.Since != 300 || b.Needs != "needs: a new thing" || b.Latest != nil {
		t.Fatalf("blocked = %+v, want the second marking and no latest", b)
	}
}

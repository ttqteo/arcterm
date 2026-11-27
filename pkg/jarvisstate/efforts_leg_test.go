package jarvisstate

import (
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestEffortSummaryOf(t *testing.T) {
	e := &waveobj.Effort{
		Title: "t", Project: "p", Ticket: "T-1", Status: "active",
		Chunks: []waveobj.EffortChunk{
			{Label: "c1", Status: "done"},
			{Label: "c2", Status: "active"},
			{Label: "c3", Status: "pending"},
		},
		UpdatedTs: 99,
	}
	s := EffortSummaryOf(e)
	if s.ORef != "effort:"+e.OID || s.Done != 1 || s.Total != 3 || s.ActiveChunk != "c2" || s.UpdatedTs != 99 {
		t.Fatalf("summary: %+v", s)
	}
}

func TestEffortSummaryActiveChunkFallsBackToFirstNonDone(t *testing.T) {
	e := &waveobj.Effort{Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{{Label: "a", Status: "pending"}, {Label: "b", Status: "pending"}}}
	s := EffortSummaryOf(e)
	if s.ActiveChunk != "a" {
		t.Fatalf("activechunk: %q", s.ActiveChunk)
	}
}

func TestEffortSummaryLeavesProposedOutOfProgress(t *testing.T) {
	e := &waveobj.Effort{
		Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{
			{Label: "p1", Status: "proposed"},
			{Label: "c1", Status: "done"},
			{Label: "c2", Status: "pending"},
		},
	}
	s := EffortSummaryOf(e)
	if s.Done != 1 || s.Total != 2 || s.ActiveChunk != "c2" || len(s.Chunks) != 3 {
		t.Fatalf("summary: %+v", s)
	}
}

func TestEffortsFiltersArchived(t *testing.T) {
	es := []*waveobj.Effort{
		{Title: "live", Status: "active", Chunks: []waveobj.EffortChunk{{Label: "x", Status: "done"}}},
		{Title: "dead", Status: "archived", Chunks: []waveobj.EffortChunk{{Label: "y", Status: "pending"}}},
	}
	got := Efforts(es)
	if len(got) != 1 || got[0].Title != "live" {
		t.Fatalf("efforts: %+v", got)
	}
}

func TestDeltaIncludesEffortEventsInWindow(t *testing.T) {
	eff := &waveobj.Effort{Title: "t", Project: "p", Status: "active",
		Events: []waveobj.EffortEvent{
			{Ts: 200, Kind: "chunk-done", Label: "Phase 1", Text: "soak accepted"},
			{Ts: 50, Kind: "chunk-added", Label: "Phase 3"},
		},
	}
	evs := Delta(100, nil, nil, nil, nil, nil, []*waveobj.Effort{eff})
	if len(evs) != 1 {
		t.Fatalf("delta: %+v", evs)
	}
	ev := evs[0]
	if ev.Kind != "chunk-done" || ev.Title != "t" || ev.NavTarget != "effort:"+eff.OID || ev.Project != "p" {
		t.Fatalf("event: %+v", ev)
	}
}

func TestDeltaSkipsArchivedEffortEvents(t *testing.T) {
	eff := &waveobj.Effort{Title: "dead", Status: "archived",
		Events: []waveobj.EffortEvent{{Ts: 200, Kind: "chunk-done", Label: "x"}}}
	evs := Delta(100, nil, nil, nil, nil, nil, []*waveobj.Effort{eff})
	if len(evs) != 0 {
		t.Fatalf("archived events leaked: %+v", evs)
	}
}

// a later chunk is not the initiative's work (call 3): it is in no field of the summary but Later, and only while it is
// open, in chunk order, with what Ask agent needs from its first note
func TestEffortSummaryLater(t *testing.T) {
	long := strings.Repeat("đ", 1200) // multi-byte: the cut is by runes, not bytes
	e := &waveobj.Effort{
		Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{
			{Label: "saved one", Status: "pending", Later: true, Due: "2026-11-30", UpdatedTs: 900, Notes: []waveobj.EffortNote{
				{Ts: 500, Text: long, Author: "you", Session: "agent:t1", Conversation: "conv-1"},
				{Ts: 700, Text: "a second note", Author: "agent", Session: "agent:t2", Conversation: "conv-2"},
			}},
			{Label: "plan one", Status: "done", Notes: []waveobj.EffortNote{{Ts: 300, Text: "plan note", Author: "you"}}},
			{Label: "saved two", Status: "blocked", Later: true, UpdatedTs: 800},
			{Label: "plan two", Status: "pending"},
			{Label: "saved done", Status: "done", Later: true},
			{Label: "saved skipped", Status: "skipped", Later: true},
			{Label: "saved deferred", Status: "deferred", Later: true},
			{Label: "saved proposed", Status: "proposed", Later: true},
			{Label: "saved active", Status: "active", Later: true, UpdatedTs: 77},
		},
		Events: []waveobj.EffortEvent{
			{Ts: 10, Kind: "chunk-added", Label: "saved two"},
			{Ts: 20, Kind: "chunk-added", Label: "saved two"},
			{Ts: 15, Kind: "chunk-added", Label: "plan two"},
		},
	}
	s := EffortSummaryOf(e)
	var labels []string
	for _, c := range s.Chunks {
		labels = append(labels, c.Label)
	}
	if !reflect.DeepEqual(labels, []string{"plan one", "plan two"}) {
		t.Fatalf("chunks: %v, want the plan only", labels)
	}
	if s.Done != 1 || s.Total != 2 {
		t.Fatalf("done/total = %d/%d, want 1/2: a later chunk is not the initiative's work", s.Done, s.Total)
	}
	if s.ActiveChunk != "plan two" {
		t.Fatalf("activechunk = %q: an active later chunk is never the one being worked on", s.ActiveChunk)
	}
	if s.LastNote == nil || s.LastNote.Text != "plan note" || s.LastNote.Chunk != "plan one" {
		t.Fatalf("lastnote = %+v: a later chunk's notes are no candidates", s.LastNote)
	}
	if len(s.Later) != 3 {
		t.Fatalf("later: %+v, want the pending, blocked and active ones, in chunk order", s.Later)
	}
	one, two, active := s.Later[0], s.Later[1], s.Later[2]
	if one.Label != "saved one" || one.Status != "pending" || one.Due != "2026-11-30" {
		t.Fatalf("first item: %+v", one)
	}
	if one.Since != 500 {
		t.Fatalf("since = %d, want the first note's ts", one.Since)
	}
	if one.Session != "agent:t1" || one.Conversation != "conv-1" {
		t.Fatalf("session/conversation = %q/%q, want the first note's, not the second's", one.Session, one.Conversation)
	}
	if want := strings.Repeat("đ", 1000); one.Note != want {
		t.Fatalf("note: %d runes, want the first note cut to 1000", len([]rune(one.Note)))
	}
	if two.Label != "saved two" || two.Status != "blocked" || two.Since != 20 || two.Note != "" {
		t.Fatalf("second item: %+v, want since = the latest chunk-added event", two)
	}
	if active.Label != "saved active" || active.Status != "active" || active.Since != 77 {
		t.Fatalf("third item: %+v, want since = the chunk's UpdatedTs when there is no note and no event", active)
	}
}

// an initiative whose only chunks are later has no plan: it keeps the shape of an idea (Total 0, no Chunks, no LastNote)
func TestEffortSummaryLaterOnlyKeepsAnIdeasShape(t *testing.T) {
	e := &waveobj.Effort{Title: "idea", Status: "active", Chunks: []waveobj.EffortChunk{
		{Label: "saved one", Status: "pending", Later: true, Notes: []waveobj.EffortNote{{Ts: 50, Text: "passage"}}},
		{Label: "saved two", Status: "active", Later: true},
	}}
	s := EffortSummaryOf(e)
	if s.Total != 0 || s.Done != 0 || len(s.Chunks) != 0 || s.ActiveChunk != "" || s.LastNote != nil {
		t.Fatalf("summary: %+v, want Total 0, no Chunks, no ActiveChunk and no LastNote", s)
	}
	if len(s.Later) != 2 {
		t.Fatalf("later: %+v", s.Later)
	}
}

// the mark is not a status: an unmarked chunk is back in the plan and out of Later
func TestEffortSummaryLaterNoLongerLaterIsPlanAgain(t *testing.T) {
	e := &waveobj.Effort{Title: "t", Status: "active", Chunks: []waveobj.EffortChunk{{Label: "c", Status: "pending"}}}
	s := EffortSummaryOf(e)
	if s.Total != 1 || len(s.Chunks) != 1 || len(s.Later) != 0 {
		t.Fatalf("summary: %+v", s)
	}
}

func TestEffortSummaryCarriesStage(t *testing.T) {
	e := &waveobj.Effort{Title: "t", Status: "active",
		Chunks: []waveobj.EffortChunk{
			{Label: "c1", Status: "done", Stage: "Evidence pipeline"},
			{Label: "c2", Status: "active"},
		}}
	s := EffortSummaryOf(e)
	if len(s.Chunks) != 2 || s.Chunks[0].Stage != "Evidence pipeline" || s.Chunks[1].Stage != "" {
		t.Fatalf("chunks: %+v", s.Chunks)
	}
}

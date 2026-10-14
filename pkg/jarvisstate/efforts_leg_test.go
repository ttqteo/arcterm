package jarvisstate

import (
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

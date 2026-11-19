// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func proposedChunk(notes ...waveobj.EffortNote) waveobj.EffortChunk {
	return waveobj.EffortChunk{Label: "P", Status: "proposed", Notes: notes}
}

func TestProposalRunNoNote(t *testing.T) {
	if got := ProposalRun(proposedChunk()); got != "" {
		t.Fatalf("a proposed chunk with no notes names run %q", got)
	}
}

func TestProposalRunNoteWithoutRun(t *testing.T) {
	// a chunk proposed from a terminal that resolved a session but no run, and a note that is not the proposal
	c := proposedChunk(
		waveobj.EffortNote{Ts: 10, Text: ProposedNote, Author: "agent", Session: "agent:t1"},
		waveobj.EffortNote{Ts: 20, Text: "renamed from X", Author: "agent", Run: "run:other"})
	if got := ProposalRun(c); got != "" {
		t.Fatalf("got %q, want none", got)
	}
}

func TestProposalRunNewestProposedNoteWins(t *testing.T) {
	c := proposedChunk(
		waveobj.EffortNote{Ts: 10, Text: ProposedNote, Author: "agent", Session: "agent:a", Run: "run:old"},
		waveobj.EffortNote{Ts: 30, Text: ProposedNote, Author: "agent", Session: "agent:b", Run: "run:new"},
		waveobj.EffortNote{Ts: 20, Text: ProposedNote, Author: "agent", Session: "agent:c", Run: "run:mid"})
	if got := ProposalRun(c); got != "run:new" {
		t.Fatalf("got %q, want run:new", got)
	}
	// equal times: the later note in the trail is the newer one, as planReviewItems reads the proposer
	tie := proposedChunk(
		waveobj.EffortNote{Ts: 10, Text: ProposedNote, Run: "run:first"},
		waveobj.EffortNote{Ts: 10, Text: ProposedNote, Run: "run:second"})
	if got := ProposalRun(tie); got != "run:second" {
		t.Fatalf("tie: got %q, want run:second", got)
	}
}

func TestProposalRunNotProposedChunk(t *testing.T) {
	for _, status := range []string{"pending", "active", "done", "deferred", "blocked", "skipped", ""} {
		c := waveobj.EffortChunk{Label: "P", Status: status, Notes: []waveobj.EffortNote{
			{Ts: 10, Text: ProposedNote, Author: "agent", Session: "agent:a", Run: "run:r1"}}}
		if got := ProposalRun(c); got != "" {
			t.Fatalf("a %q chunk names run %q", status, got)
		}
	}
}

// The backlog pass writes the note with the run and no session; the lead's own proposal keeps both.
func TestProposalRunBacklogShape(t *testing.T) {
	c := proposedChunk(waveobj.EffortNote{Ts: 10, Text: ProposedNote, Author: "agent", Run: "run:r1"})
	if got := ProposalRun(c); got != "run:r1" {
		t.Fatalf("got %q, want run:r1", got)
	}
}

// Only the exact text counts: a note that merely mentions a proposal is not one.
func TestProposalRunReadsTheProposedNoteOnly(t *testing.T) {
	c := proposedChunk(
		waveobj.EffortNote{Ts: 10, Text: ProposedNote, Run: "run:r1"},
		waveobj.EffortNote{Ts: 20, Text: "proposed again", Run: "run:r2"},
		waveobj.EffortNote{Ts: 30, Text: "Run finished", Run: "run:r3"})
	if got := ProposalRun(c); got != "run:r1" {
		t.Fatalf("got %q, want run:r1", got)
	}
}

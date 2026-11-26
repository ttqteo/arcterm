// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func idea(id, session, state string) wshrpc.SessionIdea {
	return wshrpc.SessionIdea{ID: id, SessionID: session, State: state}
}

func mark(session, outcome string, mtime int64) wshrpc.SessionIdeaMark {
	return wshrpc.SessionIdeaMark{
		SessionID: session, SessionTitle: "title " + session, Project: "arcterm", TranscriptPath: "/x/" + session + ".jsonl",
		Size: 10, MtimeMs: mtime, Outcome: outcome,
	}
}

func rowFor(t *testing.T, rows []wshrpc.SessionIdeasSession, session string) wshrpc.SessionIdeasSession {
	t.Helper()
	for _, r := range rows {
		if r.SessionID == session {
			return r
		}
	}
	t.Fatalf("no row for session %s in %+v", session, rows)
	return wshrpc.SessionIdeasSession{}
}

func TestSessionsEmpty(t *testing.T) {
	rows, scanned, notYet, leaving := Sessions(wshrpc.SessionIdeasData{}, time.Now())
	if rows == nil || len(rows) != 0 || scanned != 0 || notYet != 0 || leaving != 0 {
		t.Fatalf("no marks: an empty (non-nil) list and zero counts, got %v %d %d %d", rows, scanned, notYet, leaving)
	}
}

func TestSessionsSaysWhatIsLeftOfEachSession(t *testing.T) {
	d := wshrpc.SessionIdeasData{
		Marks: []wshrpc.SessionIdeaMark{
			mark("waiting", wshrpc.SessionIdeaOutcome_Ideas, 100),
			mark("kept", wshrpc.SessionIdeaOutcome_Ideas, 200),
			mark("dropped", wshrpc.SessionIdeaOutcome_Ideas, 300),
			mark("empty", wshrpc.SessionIdeaOutcome_Nothing, 400),
			mark("mixed", wshrpc.SessionIdeaOutcome_Ideas, 500),
		},
		Ideas: []wshrpc.SessionIdea{
			idea("1", "waiting", wshrpc.SessionIdeaState_Review),
			idea("2", "waiting", wshrpc.SessionIdeaState_Review),
			idea("3", "waiting", wshrpc.SessionIdeaState_Kept),
			idea("4", "kept", wshrpc.SessionIdeaState_Kept),
			idea("5", "dropped", wshrpc.SessionIdeaState_Dropped),
			idea("6", "mixed", wshrpc.SessionIdeaState_Kept),
			idea("7", "mixed", wshrpc.SessionIdeaState_Kept),
			idea("8", "mixed", wshrpc.SessionIdeaState_Dropped),
		},
	}
	rows, scanned, _, _ := Sessions(d, time.Now())
	if scanned != 5 || len(rows) != 5 {
		t.Fatalf("five marks are five scanned sessions, got scanned=%d rows=%d", scanned, len(rows))
	}
	for _, c := range []struct {
		session, outcome string
		ideas            int
	}{
		{"waiting", wshrpc.SessionIdeasSession_Ideas, 2}, // what still waits, not what was found
		{"kept", wshrpc.SessionIdeasSession_Kept, 1},
		{"dropped", wshrpc.SessionIdeasSession_Nothing, 0}, // nothing left open
		{"empty", wshrpc.SessionIdeasSession_Nothing, 0},
		{"mixed", wshrpc.SessionIdeasSession_Kept, 2},
	} {
		r := rowFor(t, rows, c.session)
		if r.Outcome != c.outcome || r.Ideas != c.ideas {
			t.Errorf("session %s: outcome %q with %d ideas, want %q with %d", c.session, r.Outcome, r.Ideas, c.outcome, c.ideas)
		}
	}
	r := rowFor(t, rows, "kept")
	if r.Title != "title kept" || r.Project != "arcterm" || r.TranscriptPath != "/x/kept.jsonl" || r.Size != 10 || r.LastWriteTs != 200 {
		t.Errorf("a row carries its mark's title, project, path, size and write time: %+v", r)
	}
}

func TestSessionsLeavesOutSkippedMarks(t *testing.T) {
	d := wshrpc.SessionIdeasData{Marks: []wshrpc.SessionIdeaMark{
		mark("read", wshrpc.SessionIdeaOutcome_Nothing, 100),
		mark("decide-agent", wshrpc.SessionIdeaOutcome_Skipped, 200),
		mark("no-user-turn", wshrpc.SessionIdeaOutcome_Skipped, 300),
	}}
	rows, scanned, notYet, leaving := Sessions(d, time.Now())
	if scanned != 1 || len(rows) != 1 || rows[0].SessionID != "read" || notYet != 0 || leaving != 0 {
		t.Fatalf("a skipped mark is in neither the rows nor the counts, got %+v scanned=%d", rows, scanned)
	}
}

func TestSessionsNewestWriteFirst(t *testing.T) {
	d := wshrpc.SessionIdeasData{Marks: []wshrpc.SessionIdeaMark{
		mark("b", wshrpc.SessionIdeaOutcome_Nothing, 100),
		mark("c", wshrpc.SessionIdeaOutcome_Nothing, 300),
		mark("a", wshrpc.SessionIdeaOutcome_Nothing, 100),
		mark("d", wshrpc.SessionIdeaOutcome_Nothing, 200),
	}}
	rows, _, _, _ := Sessions(d, time.Now())
	var order string
	for _, r := range rows {
		order += r.SessionID
	}
	if order != "cdab" {
		t.Fatalf("rows go newest write first, the id breaking a tie: got %q, want cdab", order)
	}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func idea(id, session, state string) wshrpc.SessionIdea {
	return wshrpc.SessionIdea{ID: id, SessionID: session, State: state}
}

// onDisk is a candidate last written age days ago, and the mark a scan left for it as it stands. The mark names the
// session as a digest does, so the candidate's own stem and the session id differ.
func onDisk(name string, age float64, outcome string) (agentsessions.DigestSession, wshrpc.SessionIdeaMark) {
	c := sess(name, age, 10)
	return c, wshrpc.SessionIdeaMark{
		TranscriptPath: c.Path, SessionID: "id-" + name, SessionTitle: "title " + name, Project: "arcterm",
		Size: c.Size, MtimeMs: c.Mtime.UnixMilli(), Outcome: outcome,
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
	rows, scanned, notYet, leaving := Sessions(wshrpc.SessionIdeasData{}, nil, 90, time.Now())
	if rows == nil || len(rows) != 0 || scanned != 0 || notYet != 0 || leaving != 0 {
		t.Fatalf("no candidates: an empty (non-nil) list and zero counts, got %v %d %d %d", rows, scanned, notYet, leaving)
	}
}

func TestSessionsSaysWhatIsLeftOfEachSession(t *testing.T) {
	var cands []agentsessions.DigestSession
	var marks []wshrpc.SessionIdeaMark
	for i, name := range []string{"waiting", "kept", "dropped", "empty", "mixed"} {
		c, m := onDisk(name, float64(10+i), wshrpc.SessionIdeaOutcome_Ideas)
		if name == "empty" {
			m.Outcome = wshrpc.SessionIdeaOutcome_Nothing
		}
		cands, marks = append(cands, c), append(marks, m)
	}
	d := wshrpc.SessionIdeasData{
		Marks: marks,
		Ideas: []wshrpc.SessionIdea{
			idea("1", "id-waiting", wshrpc.SessionIdeaState_Review),
			idea("2", "id-waiting", wshrpc.SessionIdeaState_Review),
			idea("3", "id-waiting", wshrpc.SessionIdeaState_Kept),
			idea("4", "id-kept", wshrpc.SessionIdeaState_Kept),
			idea("5", "id-dropped", wshrpc.SessionIdeaState_Dropped),
			idea("6", "id-mixed", wshrpc.SessionIdeaState_Kept),
			idea("7", "id-mixed", wshrpc.SessionIdeaState_Kept),
			idea("8", "id-mixed", wshrpc.SessionIdeaState_Dropped),
		},
	}
	rows, scanned, notYet, leaving := Sessions(d, cands, 90, scanNow)
	if scanned != 5 || len(rows) != 5 || notYet != 0 || leaving != 0 {
		t.Fatalf("five matching marks are five scanned sessions, got scanned=%d notYet=%d leaving=%d rows=%d", scanned, notYet, leaving, len(rows))
	}
	for _, c := range []struct {
		session, outcome string
		ideas            int
	}{
		{"id-waiting", wshrpc.SessionIdeasSession_Ideas, 2}, // what still waits, not what was found
		{"id-kept", wshrpc.SessionIdeasSession_Kept, 1},
		{"id-dropped", wshrpc.SessionIdeasSession_Nothing, 0}, // nothing left open
		{"id-empty", wshrpc.SessionIdeasSession_Nothing, 0},
		{"id-mixed", wshrpc.SessionIdeasSession_Kept, 2},
	} {
		r := rowFor(t, rows, c.session)
		if r.Outcome != c.outcome || r.Ideas != c.ideas {
			t.Errorf("session %s: outcome %q with %d ideas, want %q with %d", c.session, r.Outcome, r.Ideas, c.outcome, c.ideas)
		}
	}
	c, _ := onDisk("kept", 11, "")
	r := rowFor(t, rows, "id-kept")
	if r.Title != "title kept" || r.Project != "arcterm" || r.TranscriptPath != c.Path || r.Size != 10 || r.LastWriteTs != c.Mtime.UnixMilli() {
		t.Errorf("a scanned row carries its mark's session, title and project and the file's path, size and write time: %+v", r)
	}
	if want := DeletesAt(c.Mtime, 90).UnixMilli(); r.DeletesTs != want {
		t.Errorf("a row carries the day its transcript is deleted: got %d, want %d", r.DeletesTs, want)
	}
}

func TestSessionsListsWhatNoScanHasReadYet(t *testing.T) {
	quiet := sess("quiet", 12, 700)
	written := sess("written", 0, 300)
	written.Mtime = scanNow.Add(-time.Hour) // still being written: a scan leaves it alone
	rows, scanned, notYet, leaving := Sessions(wshrpc.SessionIdeasData{}, []agentsessions.DigestSession{quiet, written}, 90, scanNow)
	if scanned != 0 || notYet != 2 || leaving != 0 || len(rows) != 2 {
		t.Fatalf("two sessions no scan has read are not yet scanned: scanned=%d notYet=%d leaving=%d rows=%+v", scanned, notYet, leaving, rows)
	}
	q := rowFor(t, rows, "quiet")
	if q.Outcome != wshrpc.SessionIdeasSession_NotScanned || q.Ideas != 0 || q.Size != 700 || q.TranscriptPath != quiet.Path ||
		q.LastWriteTs != quiet.Mtime.UnixMilli() || q.DeletesTs != DeletesAt(quiet.Mtime, 90).UnixMilli() || q.Title != "" {
		t.Errorf("a quiet unscanned session is not-scanned, with the file's own fields and no title (the walk reads no transcript): %+v", q)
	}
	if w := rowFor(t, rows, "written"); w.Outcome != wshrpc.SessionIdeasSession_Waiting {
		t.Errorf("an unscanned session still being written is waiting, got %+v", w)
	}
}

func TestSessionsTakesTheSessionOfACandidateThatCarriesOne(t *testing.T) {
	c := sess("quiet", 12, 700)
	c.Session = &agentsessions.SessionInfo{ID: "id-quiet", Task: "the title", ProjectName: "arc"}
	rows, _, _, _ := Sessions(wshrpc.SessionIdeasData{}, []agentsessions.DigestSession{c}, 90, scanNow)
	if len(rows) != 1 || rows[0].SessionID != "id-quiet" || rows[0].Title != "the title" || rows[0].Project != "arc" {
		t.Fatalf("a candidate's own session names its row: %+v", rows)
	}
}

func TestSessionsNamesEachRowsProject(t *testing.T) {
	c := sess("quiet", 12, 700)
	c.Cwd = filepath.Join("work", "mit-thesis")
	rows, _, _, _ := Sessions(wshrpc.SessionIdeasData{}, []agentsessions.DigestSession{c}, 90, scanNow)
	if len(rows) != 1 || rows[0].ProjectDir != filepath.Dir(c.Path) || rows[0].Project != "mit-thesis" {
		t.Fatalf("a row carries its Claude Code folder and the name of the folder it was started in: %+v", rows)
	}
}

func TestSessionsLeavesOutSkippedAndArchived(t *testing.T) {
	read, readMark := onDisk("read", 10, wshrpc.SessionIdeaOutcome_Nothing)
	decide, decideMark := onDisk("decide-agent", 11, wshrpc.SessionIdeaOutcome_Skipped)
	archived, archivedMark := onDisk("archived", 12, wshrpc.SessionIdeaOutcome_Nothing)
	archived.Archived = true
	unscannedArchived := sess("archived-unscanned", 13, 10)
	unscannedArchived.Archived = true
	d := wshrpc.SessionIdeasData{Marks: []wshrpc.SessionIdeaMark{readMark, decideMark, archivedMark}}
	rows, scanned, notYet, leaving := Sessions(d, []agentsessions.DigestSession{read, decide, archived, unscannedArchived}, 90, scanNow)
	if scanned != 1 || len(rows) != 1 || rows[0].SessionID != "id-read" || notYet != 0 || leaving != 0 {
		t.Fatalf("a skipped mark and an archived transcript are in neither the rows nor the counts, got %+v scanned=%d notYet=%d", rows, scanned, notYet)
	}
}

func TestSessionsReadsAgainAGrownSessionAndASkippedOneThatGrew(t *testing.T) {
	grown, grownMark := onDisk("grown", 10, wshrpc.SessionIdeaOutcome_Ideas)
	grownMark.Size = 5 // it held less when it was read
	passed, passedMark := onDisk("passed", 11, wshrpc.SessionIdeaOutcome_Skipped)
	passedMark.MtimeMs-- // a skipped session that was written since
	d := wshrpc.SessionIdeasData{Marks: []wshrpc.SessionIdeaMark{grownMark, passedMark}}
	rows, scanned, notYet, _ := Sessions(d, []agentsessions.DigestSession{grown, passed}, 90, scanNow)
	if scanned != 0 || notYet != 2 || len(rows) != 2 {
		t.Fatalf("a session whose file changed since its mark is read by the next scan, so not yet scanned: %+v scanned=%d notYet=%d", rows, scanned, notYet)
	}
	r := rowFor(t, rows, "id-grown")
	if r.Outcome != wshrpc.SessionIdeasSession_NotScanned || r.Size != 10 || r.Title != "title grown" {
		t.Errorf("a grown session shows the file as it is and the title its mark knows: %+v", r)
	}
}

func TestSessionsCountsWhatLeavesWithinAWeek(t *testing.T) {
	soon := sess("soon", 84, 10) // 6 days left, unscanned
	edge := sess("edge", 83, 10) // exactly 7 days left, unscanned
	far := sess("far", 82, 10)   // 8 days left
	readSoon, readMark := onDisk("read", 88, wshrpc.SessionIdeaOutcome_Nothing)
	d := wshrpc.SessionIdeasData{Marks: []wshrpc.SessionIdeaMark{readMark}}
	rows, scanned, notYet, leaving := Sessions(d, []agentsessions.DigestSession{soon, edge, far, readSoon}, 90, scanNow)
	if len(rows) != 4 || scanned != 1 || notYet != 3 || leaving != 2 {
		t.Fatalf("two unscanned sessions leave within 7 days, the scanned one does not count: scanned=%d notYet=%d leaving=%d rows=%d", scanned, notYet, leaving, len(rows))
	}
	// the same sessions under a 30-day setting are past deletion or far from it: only what has 7 days or fewer counts
	_, _, _, leaving = Sessions(d, []agentsessions.DigestSession{sess("a", 23, 10), sess("b", 22, 10)}, 30, scanNow)
	if leaving != 1 {
		t.Fatalf("the setting decides the deletion day: want 1 leaving soon under 30 days, got %d", leaving)
	}
}

func TestSessionsNewestWriteFirst(t *testing.T) {
	// each session id is its stem; the id keeps two sessions written in the same millisecond in one order
	b, c, a, dd := sess("b", 30, 1), sess("c", 10, 1), sess("a", 30, 1), sess("d", 20, 1)
	rows, _, _, _ := Sessions(wshrpc.SessionIdeasData{}, []agentsessions.DigestSession{b, c, a, dd}, 90, scanNow)
	var order string
	for _, r := range rows {
		order += r.SessionID
	}
	if order != "cdab" {
		t.Fatalf("rows go newest write first, the id breaking a tie: got %q, want cdab", order)
	}
}

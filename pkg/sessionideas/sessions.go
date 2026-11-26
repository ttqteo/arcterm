// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"sort"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Sessions is the list the Sessions scanned fold draws and the counts above it, from the marks alone: one row per session
// a scan has read. A session passed over without a model call (a skipped mark) is left out of the rows and the counts.
// What a row says is what is left of it: ideas while any of its ideas waits for review, kept when none waits and one was
// kept, nothing when it gave nothing or all its ideas were dropped.
//
// The marks hold no deletion day and know of no session that was never read, so the rows carry none and notYet and
// leavingSoon are 0; the clock is passed for the callers that will add them.
func Sessions(d wshrpc.SessionIdeasData, _ time.Time) (sessions []wshrpc.SessionIdeasSession, scanned, notYet, leavingSoon int) {
	type tally struct{ review, kept int }
	bySession := map[string]*tally{}
	for _, i := range d.Ideas {
		t := bySession[i.SessionID]
		if t == nil {
			t = &tally{}
			bySession[i.SessionID] = t
		}
		switch i.State {
		case wshrpc.SessionIdeaState_Review:
			t.review++
		case wshrpc.SessionIdeaState_Kept:
			t.kept++
		}
	}
	sessions = []wshrpc.SessionIdeasSession{}
	for _, m := range d.Marks {
		if m.Outcome == wshrpc.SessionIdeaOutcome_Skipped {
			continue
		}
		row := wshrpc.SessionIdeasSession{
			SessionID:      m.SessionID,
			Title:          m.SessionTitle,
			Project:        m.Project,
			TranscriptPath: m.TranscriptPath,
			Size:           m.Size,
			LastWriteTs:    m.MtimeMs,
			Outcome:        wshrpc.SessionIdeasSession_Nothing,
		}
		if t := bySession[m.SessionID]; t != nil {
			switch {
			case t.review > 0:
				row.Outcome, row.Ideas = wshrpc.SessionIdeasSession_Ideas, t.review
			case t.kept > 0:
				row.Outcome, row.Ideas = wshrpc.SessionIdeasSession_Kept, t.kept
			}
		}
		sessions = append(sessions, row)
	}
	// newest write first; the id keeps two sessions written in the same millisecond in one order
	sort.Slice(sessions, func(a, b int) bool {
		if sessions[a].LastWriteTs != sessions[b].LastWriteTs {
			return sessions[a].LastWriteTs > sessions[b].LastWriteTs
		}
		return sessions[a].SessionID < sessions[b].SessionID
	})
	return sessions, len(sessions), 0, 0
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// homeAsTilde is path with the home dir at its head written as "~" ("~/notes", and "~" for the home dir itself), so a
// name drawn from it reads "~" rather than the user's account name. Any other path, and "", is returned as it is.
func homeAsTilde(path, home string) string {
	if path == "" || home == "" {
		return path
	}
	// Rel compares without case on Windows, as the file system does; another drive is an error
	rel, err := filepath.Rel(home, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return path
	}
	if rel == "." {
		return "~"
	}
	return "~" + string(filepath.Separator) + rel
}

// Sessions is the list the Sessions scanned fold draws and the counts above it: one row per transcript on disk (the
// candidates), newest write first. Each row says what the scan made of the session as it stands now:
//
//   - a mark of the file as it stands: what is left of its ideas (ideas while any waits for review, kept when none waits
//     and one was kept, nothing when it gave nothing or all were dropped). A session passed over without a model call
//     (a skipped mark) is left out of the rows and the counts.
//   - no mark, or a mark of an older file (it grew): not-scanned when it is quiet, so the next scan reads it, or waiting
//     while it is still being written.
//
// An archived transcript is left out, as the scan leaves it alone. A mark whose transcript is gone has no row. Every row
// carries the day its transcript is deleted (its last write plus days). scanned counts the rows a scan has read, notYet
// the rows it has not (not-scanned and waiting), and leavingSoon those of them 7 days or fewer from deletion.
//
// A candidate from the walk carries no session, so an unscanned row has no title or project of its own; a mark of an
// older file lends its own, and a candidate that does carry a session (the dev app's fixtures) names its row.
func Sessions(d wshrpc.SessionIdeasData, candidates []agentsessions.DigestSession, days int, now time.Time) (sessions []wshrpc.SessionIdeasSession, scanned, notYet, leavingSoon int) {
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
	marks := map[string]wshrpc.SessionIdeaMark{}
	for _, m := range d.Marks {
		marks[m.TranscriptPath] = m
	}

	sessions = []wshrpc.SessionIdeasSession{}
	for _, c := range candidates {
		if c.Archived {
			continue
		}
		row := wshrpc.SessionIdeasSession{
			SessionID:      c.Stem,
			ProjectDir:     ProjectDir(c.Path),
			ProjectPath:    homeAsTilde(c.Cwd, wavebase.GetHomeDir()),
			TranscriptPath: c.Path,
			Size:           c.Size,
			LastWriteTs:    c.Mtime.UnixMilli(),
			DeletesTs:      DeletesAt(c.Mtime, days).UnixMilli(),
		}
		m, marked := marks[c.Path]
		if marked {
			row.SessionID, row.Title, row.Project = firstNonEmpty(m.SessionID, row.SessionID), m.SessionTitle, m.Project
		}
		if c.Session != nil {
			row.SessionID, row.Title, row.Project = firstNonEmpty(c.Session.ID, row.SessionID), firstNonEmpty(c.Session.Task, row.Title), firstNonEmpty(c.Session.ProjectName, row.Project)
		}
		if row.Project == "" && c.Cwd != "" {
			row.Project = filepath.Base(c.Cwd) // an unscanned session is named by the folder it was started in
		}
		if marked && markMatches(m, c) {
			if m.Outcome == wshrpc.SessionIdeaOutcome_Skipped {
				continue
			}
			row.SessionID = firstNonEmpty(m.SessionID, c.Stem) // the id its ideas were stored under
			row.Outcome = wshrpc.SessionIdeasSession_Nothing
			if m.Outcome == wshrpc.SessionIdeaOutcome_Unreadable {
				row.Outcome = wshrpc.SessionIdeasSession_Unreadable // ideas an earlier read of it found still say ideas
			}
			if t := bySession[row.SessionID]; t != nil {
				switch {
				case t.review > 0:
					row.Outcome, row.Ideas = wshrpc.SessionIdeasSession_Ideas, t.review
				case t.kept > 0:
					row.Outcome, row.Ideas = wshrpc.SessionIdeasSession_Kept, t.kept
				}
			}
			scanned++
		} else {
			row.Outcome = wshrpc.SessionIdeasSession_NotScanned
			if !quiet(c, now) {
				row.Outcome = wshrpc.SessionIdeasSession_Waiting
			}
			notYet++
			if leavesSoon(c.Mtime, days, now) {
				leavingSoon++
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
	return sessions, scanned, notYet, leavingSoon
}

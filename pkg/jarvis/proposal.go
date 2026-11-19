// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import "github.com/wavetermdev/waveterm/pkg/waveobj"

// ProposedNote is the text of the chunk note that marks who proposed a chunk and, for a run's lead, from which run.
const ProposedNote = "proposed"

// ProposalRun is the run a proposed chunk came from: the Run ("run:<oid>") of the chunk's newest note whose text is
// ProposedNote, any author and with or without a session (the backlog pass writes one with a run and no session).
// A later note in the trail is the newer one when two share a time. It is "" when the chunk is not proposed, has no
// such note, or its newest one names no run.
//
// "A proposal names a run" is read here and only here: the plan review's Needs you item, To review's grouping and the
// backlog pass all call it. The plan review's ProposerORef keeps reading the note's Session.
func ProposalRun(c waveobj.EffortChunk) string {
	if c.Status != "proposed" {
		return ""
	}
	run, ts, found := "", int64(0), false
	for _, note := range c.Notes {
		if note.Text != ProposedNote {
			continue
		}
		if !found || note.Ts >= ts {
			run, ts, found = note.Run, note.Ts, true
		}
	}
	return run
}

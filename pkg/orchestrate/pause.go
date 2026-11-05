// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// DagStatus_Paused reads on a dag while TaskGroup.PausedTs is set, unless the dag is done or cancelled
// (RecomputeDagStatus). The dag's runs keep their own statuses; Run.PausedUnder marks them.
const DagStatus_Paused = "paused"

// The three functions below are the engine's half of a run's pause (spec 2026-11-05-run-pause-design, decisions 5 to
// 7). Their signatures are final and pkg/runpause calls them; the bodies are stubs until the task that builds them.

// PauseDag pauses dagID for the top-level run topRunID. It marks every run of the dag except topRunID itself with
// PausedUnder = topRunID, sets the dag's PausedTs in the same write, and only then stops Verify, Final and every
// live session. It returns the sessions it suspended, for the caller to keep in Pause.Sessions.
func PauseDag(ctx context.Context, dagID, topRunID string) ([]waveobj.PausedSession, error) {
	return nil, fmt.Errorf("pausing dag %s: not built yet", dagID)
}

// ResumeDag resumes dagID: it reopens each session the caller stored in Pause.Sessions in its own session, then
// clears the dag's PausedTs and ticks it. It leaves each run's PausedUnder to the caller, which clears the marks
// once every dag is resumed.
func ResumeDag(ctx context.Context, dagID string, sessions []waveobj.PausedSession) error {
	return fmt.Errorf("resuming dag %s: not built yet", dagID)
}

// ReopenSession reopens one suspended session with nudge as its first turn: in its own tab, or in a new tab when
// that tab was closed. Both ResumeDag and pkg/runpause call it.
func ReopenSession(ctx context.Context, s waveobj.PausedSession, nudge string) error {
	return fmt.Errorf("reopening session of run %s: not built yet", s.RunId)
}

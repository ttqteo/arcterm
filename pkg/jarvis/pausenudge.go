// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import "context"

// pausedNudgeText is the first turn of an agent reopened after its run was paused. It always ends by telling the
// agent to ask again, because an ask waits in memory only: a restart drops it, and an answer the person gave while the
// run was paused rides after this text when there is one.
const pausedNudgeText = "Arc paused this run to free memory and has now resumed it; carry on from where you stopped. " +
	"If you were waiting on an answer that is not below, ask again."

// PausedNudge is the nudge a resumed agent starts with, for the worker in tab workerORef. Task 2 appends the
// answers the person gave that worker's open question while the run was paused.
func PausedNudge(ctx context.Context, workerORef string) string {
	return pausedNudgeText
}

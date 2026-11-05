// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"testing"
)

func TestPausedNudgeSaysThePauseAndAsksAgainForAnUnansweredQuestion(t *testing.T) {
	const want = "Arc paused this run to free memory and has now resumed it; carry on from where you stopped. " +
		"If you were waiting on an answer that is not below, ask again."
	if got := PausedNudge(context.Background(), "tab:w1"); got != want {
		t.Fatalf("PausedNudge = %q, want %q", got, want)
	}
}

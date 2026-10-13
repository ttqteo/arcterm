// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"strings"
	"testing"
)

// A restarted process must not inherit the alternate screen of the one before: the frontend ignores the OSC R while
// it replays the log, so a Claude Code that fell back to its classic renderer drew into a buffer with no scrollback
func TestTerminalResetSeqLeavesAltScreenInStream(t *testing.T) {
	seq := GetTerminalResetSeq()
	if !strings.Contains(seq, "\x1b[?1047l") {
		t.Fatalf("reset sequence has no in-stream alt screen exit: %q", seq)
	}
	if strings.Contains(seq, "\x1b[?1049l") {
		t.Errorf("1049l restores a saved cursor even on the normal screen; use 1047l: %q", seq)
	}
}

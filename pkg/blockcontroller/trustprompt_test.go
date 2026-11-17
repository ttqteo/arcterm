// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// the trust prompt's first render as Claude Code 2.1.325 wrote it (2026-11-17, a restored agent's stored output): words
// apart by cursor-forwards, rows placed by cursor moves, a link in OSC 8, the probe inside it. The permission list is
// left out.
var trustRender = strings.Join([]string{
	"\x1b[?25l\x1b[?2004h\x1b[38;2;255;193;7m\r\n" + strings.Repeat("─", 120),
	"\x1b[3;2H\x1b[1mAccessing\x1b[1Cworkspace:\x1b[m\x1b[1m\x1b[5;2Hd:\\projects\\mit\\mit-thesis\x1b[22m",
	"\x1b[7;2HQuick\x1b[1Csafety\x1b[1Ccheck:\x1b[1CIs\x1b[1Cthis\x1b[1Ca\x1b[1Cproject\x1b[1Cyou\x1b[1Ccreated?",
	"\x1b[22;2H\x1b]8;;https://code.claude.com/docs/en/security\x1b\\Security guide\x1b]8;;\x1b\\",
	"\x1b[28;2HEnter\x1b[1Cto\x1b[1Cconfirm\x1b]7501;?\x07\x1b[m",
	"\x1b[25;2H \x1b[1CNo, exit\x1b[38;2;177;185;249m\x1b[26;2H❯\x1b[1CYes, I trust this folder\x1b[m",
}, "")

func TestTrustScanFindsThePromptThroughItsEscapes(t *testing.T) {
	var s trustScan
	if !s.Feed([]byte(trustRender)) {
		t.Fatalf("the prompt was not found; text read: %q", s.text)
	}
}

func TestTrustScanReadsAPromptSplitAcrossChunks(t *testing.T) {
	var s trustScan
	b := []byte(trustRender)
	found := false
	// three bytes at a time cut escape sequences and the ❯ apart
	for i := 0; i < len(b); i += 3 {
		found = s.Feed(b[i:min(i+3, len(b))]) || found
	}
	if !found {
		t.Fatalf("the prompt split across chunks was not found; text read: %q", s.text)
	}
}

func TestTrustScanNeedsBothMarkers(t *testing.T) {
	var s trustScan
	if s.Feed([]byte("a reply that quotes \x1b[1mYes, I trust this folder\x1b[m and nothing else")) {
		t.Fatal("one marker alone read as the prompt")
	}
	var far trustScan
	far.Feed([]byte("Quick safety check"))
	far.Feed([]byte(strings.Repeat("x", trustWindow+10)))
	if far.Feed([]byte("Yes, I trust this folder")) {
		t.Fatal("markers a window apart read as the prompt")
	}
}

func newTrustWorld() *progWorld {
	pw := newProgWorld()
	pw.w.trust = &trustScan{}
	pw.w.startMs = pw.clock.UnixMilli()
	return pw
}

func TestProgWatchReadsTheTrustPromptAsking(t *testing.T) {
	pw := newTrustWorld()
	// the restored agent's last state, from before this process started
	pw.latest = baseds.AgentStatusData{State: baseds.AgentState_Working, Agent: "claude", Ts: pw.w.startMs - 60_000}
	pw.w.output([]byte(trustRender))
	if len(pw.published) != 1 || pw.published[0] != "asking/claude" {
		t.Fatalf("published %v, want the agent asking", pw.published)
	}
	// it asks once: a redraw of the prompt says nothing new
	pw.w.output([]byte(trustRender))
	if len(pw.published) != 1 {
		t.Fatalf("published %v, want one asking", pw.published)
	}
}

func TestProgWatchLeavesTheMarkersAloneOnceAHookReported(t *testing.T) {
	pw := newTrustWorld()
	// SessionStart reported after the process started: Claude Code is past its prompt, and the words are in a
	// conversation it shows
	pw.latest = baseds.AgentStatusData{State: baseds.AgentState_Idle, Agent: "claude", Ts: pw.w.startMs + 2_000}
	pw.w.output([]byte(trustRender))
	if len(pw.published) != 0 {
		t.Fatalf("published %v after a hook reported", pw.published)
	}
}

func TestProgWatchStopsLookingForTheTrustPromptOnAReport(t *testing.T) {
	pw := newTrustWorld()
	pw.latest = baseds.AgentStatusData{State: baseds.AgentState_Working, Agent: "claude", Ts: pw.w.startMs - 60_000}
	pw.w.output([]byte("\x1b]7501;state=idle:app=claude-code\x1b\\"))
	pw.w.output([]byte(trustRender))
	if len(pw.published) != 0 {
		t.Fatalf("published %v after the program reported its state", pw.published)
	}
}

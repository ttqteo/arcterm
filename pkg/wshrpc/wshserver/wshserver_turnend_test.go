// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

func tsLine(typ, subtype string, at time.Time) string {
	if subtype != "" {
		return fmt.Sprintf(`{"type":%q,"subtype":%q,"timestamp":%q}`, typ, subtype, at.UTC().Format(time.RFC3339Nano))
	}
	return fmt.Sprintf(`{"type":%q,"timestamp":%q}`, typ, at.UTC().Format(time.RFC3339Nano))
}

func TestTurnEndedAfter(t *testing.T) {
	since := time.Date(2026, 11, 13, 5, 15, 44, 0, time.UTC)
	end := since.Add(3*time.Minute + 39*time.Second)
	// the 2026-11-13 tail: the turn's last message, the cancelled Stop hook, then the turn's end and bookkeeping
	ended := []string{
		tsLine("assistant", "", end.Add(-17*time.Second)),
		`{"type":"attachment","attachment":{"type":"hook_cancelled","hookEvent":"Stop","timedOut":true}}`,
		tsLine("system", "stop_hook_summary", end),
		tsLine("system", "turn_duration", end),
		`{"type":"file-history-snapshot"}`,
	}
	if !turnEndedAfter(ended, since.UnixMilli()) {
		t.Fatal("a tail ending on turn_duration after the working report is a finished turn")
	}
	if turnEndedAfter(ended, end.Add(time.Second).UnixMilli()) {
		t.Fatal("a turn_duration older than the working report ended an earlier turn")
	}
	next := append(append([]string{}, ended...), tsLine("user", "", end.Add(time.Second)))
	if turnEndedAfter(next, since.UnixMilli()) {
		t.Fatal("a prompt after the turn's end opened the next turn")
	}
	mid := []string{tsLine("user", "", since), tsLine("assistant", "", since.Add(time.Second))}
	if turnEndedAfter(mid, since.UnixMilli()) {
		t.Fatal("a turn with no turn_duration has not ended")
	}
	if turnEndedAfter(nil, 0) {
		t.Fatal("an empty tail has not ended")
	}
}

func TestWatchesTurnEnd(t *testing.T) {
	w := baseds.AgentStatusData{State: baseds.AgentState_Working, Agent: "claude", TranscriptPath: "x", Ts: 1, Hook: baseds.AgentHook_PostToolUse}
	if !watchesTurnEnd(w) {
		t.Fatal("a Claude tool's working is watched")
	}
	for name, d := range map[string]baseds.AgentStatusData{
		"idle":       {State: baseds.AgentState_Idle, Agent: "claude", TranscriptPath: "x", Ts: 1, Hook: baseds.AgentHook_Stop},
		"pi":         {State: baseds.AgentState_Working, Agent: "pi", TranscriptPath: "x", Ts: 1, Hook: baseds.AgentHook_PostToolUse},
		"no path":    {State: baseds.AgentState_Working, Agent: "claude", Ts: 1, Hook: baseds.AgentHook_PostToolUse},
		"compaction": {State: baseds.AgentState_Working, Agent: "claude", TranscriptPath: "x", Ts: 1, Hook: "PreCompact"},
	} {
		if watchesTurnEnd(d) {
			t.Fatalf("%s must not be watched", name)
		}
	}
}

// the 2026-11-13 case end to end: a working whose turn ended with no Stop report goes idle from the transcript, and a
// later report in time drops the check
func TestTurnEndIdlesAWorkingWhoseStopNeverReported(t *testing.T) {
	old := turnEndQuiet
	turnEndQuiet = 30 * time.Millisecond
	defer func() { turnEndQuiet = old }()
	ctx := context.Background()

	path := filepath.Join(t.TempDir(), "session.jsonl")
	working := time.Now().Add(-time.Minute)
	tail := strings.Join([]string{
		tsLine("user", "", working),
		tsLine("assistant", "", working.Add(10*time.Second)),
		tsLine("system", "turn_duration", working.Add(20*time.Second)),
	}, "\n") + "\n"
	if err := os.WriteFile(path, []byte(tail), 0o644); err != nil {
		t.Fatal(err)
	}
	oref := blockORef(uuid.NewString())
	publishEvent(ctx, wps.WaveEvent{
		Event:   wps.Event_AgentStatus,
		Scopes:  []string{oref},
		Persist: 1,
		Data: baseds.AgentStatusData{ORef: oref, State: baseds.AgentState_Working, Agent: "claude", TranscriptPath: path,
			Ts: working.UnixMilli(), Hook: baseds.AgentHook_UserPromptSubmit, Title: "multi-screen"},
	})
	last := waitStatus(t, oref, func(d baseds.AgentStatusData) bool { return d.State == baseds.AgentState_Idle })
	if last.Hook != AgentHook_TranscriptTurnEnd || last.Title != "multi-screen" || last.TranscriptPath != path {
		t.Fatalf("idle from the transcript: got %+v", last)
	}

	// a turn still running is left working, and a report before the check replaces it
	busy := blockORef(uuid.NewString())
	if err := os.WriteFile(path, []byte(tail+tsLine("user", "", time.Now())+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	publishEvent(ctx, wps.WaveEvent{
		Event:   wps.Event_AgentStatus,
		Scopes:  []string{busy},
		Persist: 1,
		Data: baseds.AgentStatusData{ORef: busy, State: baseds.AgentState_Working, Agent: "claude", TranscriptPath: path,
			Ts: time.Now().UnixMilli(), Hook: baseds.AgentHook_PostToolUse},
	})
	time.Sleep(150 * time.Millisecond)
	if got := lastStatus(busy); got.State != baseds.AgentState_Working {
		t.Fatalf("a turn still running must stay working, got %+v", got)
	}
	armTurnEnd(busy, 0, false)
}

func lastStatus(scope string) baseds.AgentStatusData {
	var d baseds.AgentStatusData
	if hist := wps.Broker.ReadEventHistory(wps.Event_AgentStatus, scope, 1); len(hist) > 0 {
		_ = utilfn.ReUnmarshal(&d, hist[0].Data)
	}
	return d
}

func waitStatus(t *testing.T, scope string, ok func(baseds.AgentStatusData) bool) baseds.AgentStatusData {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if d := lastStatus(scope); ok(d) {
			return d
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("status of %s never matched; last %+v", scope, lastStatus(scope))
	return baseds.AgentStatusData{}
}

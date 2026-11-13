// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

// A Claude turn whose Stop hook never reported left its agent working for good: on 2026-11-13 the hook ran 12.6 s on a
// machine out of RAM and Claude Code killed it at its 10 s timeout, so Chat said "Working…" for 15 minutes and held the
// next message as Queued. Claude Code still writes the turn's end into the transcript (a system turn_duration record,
// after its Stop hooks, a cancelled one included), so wavesrv reads it there: a Claude agent reading working with no
// report for turnEndQuiet gets its transcript's tail checked, and goes idle when the turn ended after its last report.
// Checks repeat every turnEndQuiet while it keeps reading working with no report.

// AgentHook_TranscriptTurnEnd is the Hook of the idle wavesrv reports for a turn its transcript says ended.
const AgentHook_TranscriptTurnEnd = "TranscriptTurnEnd"

// turnEndQuiet is how long an agent reads working with no report before its transcript is checked. Long against a
// Stop hook's 10 s timeout, short against a person looking at a "Working…" that is over.
var turnEndQuiet = 30 * time.Second

// turnEndTailBytes is how much of the transcript (readTranscriptEnd)'s end a check reads: a turn's end and anything after it fit easily.
const turnEndTailBytes = 256 * 1024

var turnEndWatch = struct {
	sync.Mutex
	timers map[string]*time.Timer
}{timers: map[string]*time.Timer{}}

// watchesTurnEnd says whether a published status is a Claude turn's working that its transcript can close: one a
// prompt or a tool reported (a compaction's working ends with no turn_duration), with the transcript it names.
func watchesTurnEnd(data baseds.AgentStatusData) bool {
	if data.State != baseds.AgentState_Working || data.Agent != "claude" || data.TranscriptPath == "" || data.Ts == 0 {
		return false
	}
	switch data.Hook {
	case baseds.AgentHook_UserPromptSubmit, baseds.AgentHook_PreToolUse, baseds.AgentHook_PostToolUse:
		return true
	}
	return false
}

// noteTurnEndWatch arms the turn-end check for a status just published, or drops it: every report of a scope replaces
// the check its last one armed, and only a watched working arms a new one.
func noteTurnEndWatch(ev *wps.WaveEvent) {
	var data baseds.AgentStatusData
	if utilfn.ReUnmarshal(&data, ev.Data) != nil || data.State == "" {
		return
	}
	for _, scope := range ev.Scopes {
		armTurnEnd(scope, data.Ts, watchesTurnEnd(data))
	}
}

func armTurnEnd(scope string, ts int64, arm bool) {
	turnEndWatch.Lock()
	defer turnEndWatch.Unlock()
	if t := turnEndWatch.timers[scope]; t != nil {
		t.Stop()
		delete(turnEndWatch.timers, scope)
	}
	if arm {
		turnEndWatch.timers[scope] = time.AfterFunc(turnEndQuiet, func() { checkTurnEnd(scope, ts) })
	}
}

// checkTurnEnd idles the scope's agent when it still reads the working that armed the check (ts) and its transcript
// says the turn ended after it; otherwise, still working, it checks again later.
func checkTurnEnd(scope string, ts int64) {
	hist := wps.Broker.ReadEventHistory(wps.Event_AgentStatus, scope, 1)
	if len(hist) == 0 {
		return
	}
	var last baseds.AgentStatusData
	if utilfn.ReUnmarshal(&last, hist[0].Data) != nil || last.Ts != ts || !watchesTurnEnd(last) {
		return
	}
	lines, err := readTranscriptEnd(last.TranscriptPath, turnEndTailBytes)
	if err != nil || !turnEndedAfter(lines, last.Ts) {
		armTurnEnd(scope, ts, true)
		return
	}
	log.Printf("agent status: %s read working after its turn ended, idled from its transcript\n", scope)
	publishEvent(context.Background(), wps.WaveEvent{
		Event:   wps.Event_AgentStatus,
		Scopes:  []string{scope},
		Persist: 1,
		Data:    turnEndIdle(last, time.Now().UnixMilli()),
	})
}

// turnEndIdle is the idle a transcript's turn end stands in for: the working it ends, idled. Pure.
func turnEndIdle(working baseds.AgentStatusData, now int64) baseds.AgentStatusData {
	return baseds.AgentStatusData{
		ORef:           working.ORef,
		State:          baseds.AgentState_Idle,
		Agent:          working.Agent,
		Model:          working.Model,
		Cwd:            working.Cwd,
		SessionID:      working.SessionID,
		Provider:       working.Provider,
		Title:          working.Title,
		TranscriptPath: working.TranscriptPath,
		Ts:             now,
		Hook:           AgentHook_TranscriptTurnEnd,
	}
}

// turnEndedAfter reports whether a Claude transcript's tail ends on a finished turn: its last prompt, message or system
// record is the turn_duration Claude Code writes when a turn ends, at sinceMs or later (an older one ended the turn
// before the working report). Pure.
func turnEndedAfter(lines []string, sinceMs int64) bool {
	for i := len(lines) - 1; i >= 0; i-- {
		var rec struct {
			Type      string `json:"type"`
			Subtype   string `json:"subtype"`
			Timestamp string `json:"timestamp"`
		}
		if json.Unmarshal([]byte(lines[i]), &rec) != nil {
			continue
		}
		switch rec.Type {
		case "user", "assistant":
			return false
		case "system":
			if rec.Subtype != "turn_duration" {
				return false
			}
			at, err := time.Parse(time.RFC3339Nano, rec.Timestamp)
			return err == nil && at.UnixMilli() >= sinceMs
		}
	}
	return false
}

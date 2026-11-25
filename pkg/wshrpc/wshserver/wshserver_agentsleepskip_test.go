// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bytes"
	"log"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsleep"
)

// An idle 100k+ agent whose cache went cold is logged once per turn, a run's agent names its run, and an agent the
// check compacts is not logged at all.
func TestLogCompactSkipsOncePerReasonAndTurn(t *testing.T) {
	var buf bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(prev)

	now := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	s := agentsleep.Settings{Compact: true, CompactAt: agentsleep.CompactAtDefault, CompactAwake: true}
	cold := agentsleep.Candidate{TabId: "t1", BlockId: "b1", Harness: "claude", Idle: true, HasStream: true,
		Cache: agentsleep.CacheState{Tokens: 212_000, LastTurn: now.Add(-70 * time.Minute), OneHour: true}}
	owned := agentsleep.Candidate{TabId: "t2", BlockId: "b2", Harness: "claude", Idle: true, HasStream: true, RunOwned: true}
	due := agentsleep.Candidate{TabId: "t3", BlockId: "b3", Harness: "claude", Idle: true, HasStream: true,
		Cache: agentsleep.CacheState{Tokens: 150_000, LastTurn: now.Add(-56 * time.Minute), OneHour: true}}
	rows := map[string]*agentRow{"t1": {}, "t2": {}, "t3": {}}
	rows["t1"].Name, rows["t2"].Name, rows["t3"].Name = "thesis", "worker", "arcterm"
	rows["t2"].RunId = "run-9"
	live := map[string]bool{"b1": true, "b2": true, "b3": true}
	cands := []agentsleep.Candidate{cold, owned, due}
	plan := agentsleep.Plan{Compact: []agentsleep.Compaction{{TabId: "t3"}}}

	l := &sleepLoop{}
	l.logCompactSkips(cands, rows, plan, now, s, live)
	l.logCompactSkips(cands, rows, plan, now.Add(time.Minute), s, live)
	out := buf.String()
	if n := strings.Count(out, "not compacting"); n != 2 {
		t.Fatalf("want 2 lines over two checks, got %d:\n%s", n, out)
	}
	if !strings.Contains(out, `"thesis" (block b1) at 212k: its cache went cold first`) {
		t.Errorf("cold agent line missing:\n%s", out)
	}
	if !strings.Contains(out, `"worker" (block b2): a run owns it (run run-9)`) {
		t.Errorf("run agent line missing:\n%s", out)
	}
	if strings.Contains(out, "arcterm") {
		t.Errorf("an agent being compacted was logged:\n%s", out)
	}

	// a new turn that went cold again is logged again; a block no longer live is forgotten
	buf.Reset()
	cold.Cache.LastTurn = now.Add(-65 * time.Minute)
	l.logCompactSkips([]agentsleep.Candidate{cold}, rows, agentsleep.Plan{}, now.Add(time.Hour), s, map[string]bool{"b1": true})
	if strings.Count(buf.String(), "not compacting") != 1 {
		t.Errorf("a new cold turn should log once more:\n%s", buf.String())
	}
	if _, kept := l.skipLogged["b2"]; kept {
		t.Errorf("block b2 is not live and should be forgotten")
	}
}

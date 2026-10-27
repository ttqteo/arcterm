// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsleep

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

var compactOn = Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: CompactAtDefault}

func assistantLine(ts time.Time, input, read, write, write1h int, sidechain bool) string {
	return fmt.Sprintf(`{"type":"assistant","isSidechain":%t,"timestamp":%q,"message":{"usage":{"input_tokens":%d,"cache_read_input_tokens":%d,"cache_creation_input_tokens":%d,"cache_creation":{"ephemeral_1h_input_tokens":%d}}}}`,
		sidechain, ts.Format(time.RFC3339Nano), input, read, write, write1h)
}

const boundaryLine = `{"type":"system","subtype":"compact_boundary","content":"Conversation compacted","isSidechain":false}`

func TestReadCacheStateTakesTheLastMainRequest(t *testing.T) {
	t1, t2 := t0.Add(-40*time.Minute), t0.Add(-30*time.Minute)
	lines := []string{
		assistantLine(t1, 10, 50_000, 2_000, 2_000, false),
		`{"type":"user","message":{"content":"a tool result that quotes \"usage\" and \"compact_boundary\""}}`,
		assistantLine(t2, 5, 120_000, 3_000, 3_000, false),
		assistantLine(t0, 1, 900, 9_000, 0, true),                                                        // a subagent's
		`{"type":"assistant","timestamp":"2026-10-09T14:00:00Z","message":{"usage":{"input_tokens":0}}}`, // a synthetic turn
	}
	got := ReadCacheState(lines)
	want := CacheState{Tokens: 123_005, LastTurn: t2, OneHour: true}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestReadCacheStateAfterACompaction(t *testing.T) {
	t1 := t0.Add(-20 * time.Minute)
	got := ReadCacheState([]string{assistantLine(t1, 1, 150_000, 1_000, 1_000, false), boundaryLine})
	if got.Tokens != 0 || !got.Compacted || got.LastTurn != t1 {
		t.Fatalf("after a boundary got %+v, want no tokens, compacted, the last turn kept", got)
	}
	// a turn after the compaction starts the count over
	got = ReadCacheState([]string{boundaryLine, assistantLine(t0, 1, 0, 20_000, 20_000, false)})
	if got.Tokens != 20_001 || got.Compacted {
		t.Fatalf("a turn after the boundary got %+v, want 20001 tokens, not compacted", got)
	}
}

func TestReadCacheStateKeepsTheLastWritesKind(t *testing.T) {
	// a request that only reads the cache says nothing of its kind
	got := ReadCacheState([]string{
		assistantLine(t0.Add(-time.Minute), 1, 100, 5_000, 5_000, false),
		assistantLine(t0, 1, 105_100, 0, 0, false),
	})
	if !got.OneHour {
		t.Fatal("a read after an hour-long write lost OneHour")
	}
	got = ReadCacheState([]string{assistantLine(t0, 1, 100, 5_000, 0, false)})
	if got.OneHour {
		t.Fatal("a five-minute write read as OneHour")
	}
}

// big is a Claude agent with a stream whose last turn, idleFor before t0, left a hour-long cache of 150k
func big(tab string, idleFor time.Duration) Candidate {
	c := eligible(tab, idleFor)
	c.HasStream = true
	c.Cache = CacheState{Tokens: 150_000, LastTurn: t0.Add(-idleFor), OneHour: true}
	return c
}

func TestDecideCompactsBeforeItSleeps(t *testing.T) {
	got := Decide([]Candidate{big("a", 30*time.Minute)}, t0, compactOn, plentyOfRAM)
	want := Plan{Compact: []Compaction{{TabId: "a", ThenSleep: true}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestDecideSleepsWithoutACompactionThatWouldNotPay(t *testing.T) {
	small := big("small", 30*time.Minute)
	small.Cache.Tokens = CompactAtDefault - 1
	noStream := big("nostream", 30*time.Minute)
	noStream.HasStream = false
	cold := big("cold", 30*time.Minute)
	cold.Cache.LastTurn = t0.Add(-61 * time.Minute)
	pi := big("pi", 30*time.Minute)
	pi.Harness = "pi"
	off := Settings{Enabled: true, After: 30 * time.Minute, CompactAt: CompactAtDefault}
	for _, tc := range []struct {
		c Candidate
		s Settings
	}{{small, compactOn}, {noStream, compactOn}, {cold, compactOn}, {pi, compactOn}, {big("off", 30*time.Minute), off}} {
		got := Decide([]Candidate{tc.c}, t0, tc.s, plentyOfRAM)
		if want := (Plan{Sleep: []string{tc.c.TabId}}); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: got %+v, want %+v", tc.c.TabId, got, want)
		}
	}
}

func TestDecideWaitsForACompactionToLand(t *testing.T) {
	c := big("a", 31*time.Minute)
	c.CompactSent, c.AfterCompact = t0.Add(-time.Minute), SleepAfterLoop
	if got := Decide([]Candidate{c}, t0, compactOn, plentyOfRAM); !reflect.DeepEqual(got, Plan{}) {
		t.Fatalf("got %+v, want nothing while it compacts", got)
	}
}

func TestDecideSleepsOnceTheCompactionLands(t *testing.T) {
	// the compaction reset its idle clock: it sleeps anyway, without another After
	c := big("a", time.Minute)
	c.Cache = CacheState{Compacted: true, LastTurn: t0.Add(-32 * time.Minute), OneHour: true}
	c.CompactSent, c.AfterCompact = t0.Add(-2*time.Minute), SleepAfterLoop
	if got := Decide([]Candidate{c}, t0, compactOn, plentyOfRAM); !reflect.DeepEqual(got, Plan{Sleep: []string{"a"}}) {
		t.Fatalf("got %+v, want it asleep", got)
	}
	// the check's own sleep spares an agent the person has since put on screen
	c.Viewing = true
	if got := Decide([]Candidate{c}, t0, compactOn, plentyOfRAM); !reflect.DeepEqual(got, Plan{}) {
		t.Fatalf("on screen got %+v, want nothing", got)
	}
	// the person's own Sleep does not, nor does it need sleep switched on
	c.AfterCompact = SleepAfterPerson
	if got := Decide([]Candidate{c}, t0, Settings{CompactAt: CompactAtDefault}, plentyOfRAM); !reflect.DeepEqual(got, Plan{Sleep: []string{"a"}}) {
		t.Fatalf("the person's Sleep got %+v, want it asleep", got)
	}
	// not yet idle: the summary has not landed
	c.Idle = false
	if got := Decide([]Candidate{c}, t0, compactOn, plentyOfRAM); !reflect.DeepEqual(got, Plan{}) {
		t.Fatalf("still compacting got %+v, want nothing", got)
	}
}

func TestDecideCompactsAnAwakeAgentAsItsCacheRunsOut(t *testing.T) {
	at := func(idleFor time.Duration, change func(*Candidate), s Settings) Plan {
		c := big("a", idleFor)
		c.Viewing = true // on screen, so no sleep takes it
		if change != nil {
			change(&c)
		}
		return Decide([]Candidate{c}, t0, s, plentyOfRAM)
	}
	compact := Plan{Compact: []Compaction{{TabId: "a"}}}
	if got := at(55*time.Minute, nil, compactOn); !reflect.DeepEqual(got, compact) {
		t.Fatalf("5 min left got %+v, want %+v", got, compact)
	}
	// sleep switched off: the cache rule still holds
	if got := at(56*time.Minute, nil, Settings{Compact: true, CompactAt: CompactAtDefault}); !reflect.DeepEqual(got, compact) {
		t.Fatalf("sleep off got %+v, want %+v", got, compact)
	}
	for name, tc := range map[string]struct {
		idle   time.Duration
		change func(*Candidate)
		s      Settings
	}{
		"6 min left":        {54 * time.Minute, nil, compactOn},
		"gone":              {60 * time.Minute, nil, compactOn},
		"five-minute cache": {4 * time.Minute, func(c *Candidate) { c.Cache.OneHour = false }, compactOn},
		"working":           {55 * time.Minute, func(c *Candidate) { c.Idle = false }, compactOn},
		"a run's":           {55 * time.Minute, func(c *Candidate) { c.RunOwned = true }, compactOn},
		"already asked":     {55 * time.Minute, func(c *Candidate) { c.CompactSent = t0.Add(-time.Minute) }, compactOn},
		"compaction off":    {55 * time.Minute, nil, Settings{Enabled: true, After: 30 * time.Minute, CompactAt: CompactAtDefault}},
	} {
		if got := at(tc.idle, tc.change, tc.s); !reflect.DeepEqual(got, Plan{}) {
			t.Errorf("%s: got %+v, want nothing", name, got)
		}
	}
}

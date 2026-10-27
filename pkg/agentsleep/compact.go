// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsleep

import (
	"encoding/json"
	"strings"
	"time"
)

// Compacting before the cache goes cold. Claude Code's prompt cache lives an hour: the first turn after that writes
// the whole context again at twice the input rate, and an agent woken from sleep after an hour always pays it. A
// compaction while the cache is still warm reads the context at the cached rate and leaves a summary, so the turn
// that comes back pays for the summary alone. It happens at two moments: just before an agent sleeps, and, for an
// idle agent that does not sleep, when its cache has CompactLead left. Only a session whose mod takes a compaction
// over its control stream is compacted, so nothing is ever typed over a draft in its composer.

const (
	// CompactAtDefault is the least context, in tokens, worth losing detail over
	CompactAtDefault = 100_000
	// CacheTTL is the life of the hour-long cache Claude Code writes; cacheTTLShort the default one's
	CacheTTL      = time.Hour
	cacheTTLShort = 5 * time.Minute
	// CompactLead is how much cache life an idle agent that does not sleep has left when it is compacted
	CompactLead = 5 * time.Minute
	// CompactGiveUp is how long a compaction that was asked for may take to land before nothing waits on it
	CompactGiveUp = 10 * time.Minute
)

// CompactInstructions is what an automatic compaction keeps.
const CompactInstructions = "Keep: the task, what the person asked and decided and why, the files changed, open questions and the next step. Drop: code you read, tool output, drafts."

// SleepAfter is who asked for a sleep that waits on a compaction.
type SleepAfter int

const (
	SleepAfterNone   SleepAfter = iota
	SleepAfterLoop              // the idle check: the agent must still not be on screen when it lands
	SleepAfterPerson            // the person's Sleep, which they chose on screen
)

// CacheState is what the tail of a Claude transcript says about the session's prompt cache.
type CacheState struct {
	Tokens    int       // the context the last main-thread request carried; 0 once a compaction followed it
	LastTurn  time.Time // when that request ran: the cache's life counts from it
	OneHour   bool      // the last cache write was the hour-long kind
	Compacted bool      // a compaction landed after the last request
}

// ReadCacheState reads a Claude transcript's JSONL records (a tail is enough) for its cache state. A line that does not
// parse, a subagent's line and a request that reports no tokens (a synthetic error turn) are skipped.
func ReadCacheState(lines []string) CacheState {
	var st CacheState
	for _, line := range lines {
		// most lines are neither, and a full parse of every tool result would cost more than the rest of the read
		if !strings.Contains(line, `"compact_boundary"`) && !strings.Contains(line, `"usage"`) {
			continue
		}
		var rec struct {
			Type        string `json:"type"`
			Subtype     string `json:"subtype"`
			IsSidechain bool   `json:"isSidechain"`
			Timestamp   string `json:"timestamp"`
			Message     *struct {
				Usage *struct {
					Input         int `json:"input_tokens"`
					CacheRead     int `json:"cache_read_input_tokens"`
					CacheCreate   int `json:"cache_creation_input_tokens"`
					CacheCreation *struct {
						OneHour int `json:"ephemeral_1h_input_tokens"`
					} `json:"cache_creation"`
				} `json:"usage"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(line), &rec) != nil || rec.IsSidechain {
			continue
		}
		switch {
		case rec.Type == "system" && rec.Subtype == "compact_boundary":
			st.Tokens, st.Compacted = 0, true
		case rec.Type == "assistant" && rec.Message != nil && rec.Message.Usage != nil:
			u := rec.Message.Usage
			tokens := u.Input + u.CacheRead + u.CacheCreate
			if tokens == 0 {
				continue
			}
			st.Tokens, st.Compacted = tokens, false
			if ts, err := time.Parse(time.RFC3339Nano, rec.Timestamp); err == nil {
				st.LastTurn = ts
			}
			if u.CacheCreate > 0 {
				st.OneHour = u.CacheCreation != nil && u.CacheCreation.OneHour > 0
			}
		}
	}
	return st
}

// cacheLeft is how long the session's cache has left at now; zero or less when it is gone or was never read.
func cacheLeft(c CacheState, now time.Time) time.Duration {
	if c.LastTurn.IsZero() {
		return 0
	}
	ttl := cacheTTLShort
	if c.OneHour {
		ttl = CacheTTL
	}
	return c.LastTurn.Add(ttl).Sub(now)
}

// compactWorth is whether a compaction pays off for c now: a Claude session that takes one over its stream, whose
// context reaches the threshold, and whose cache is still warm (a cold one would be read at the full rate, which only
// pays if the agent is ever resumed).
func compactWorth(c Candidate, now time.Time, s Settings) bool {
	return s.Compact && c.Harness == "claude" && c.HasStream && c.Cache.Tokens >= s.CompactAt && cacheLeft(c.Cache, now) > 0
}

// CompactBeforeSleep is whether the person's Sleep of c compacts it first.
func CompactBeforeSleep(c Candidate, now time.Time, s Settings) bool {
	return compactWorth(c, now, s)
}

// cacheRunningOut is whether an idle agent that does not sleep is compacted this check: its hour-long cache has
// CompactLead or less left.
func cacheRunningOut(c Candidate, now time.Time, s Settings) bool {
	if !c.Idle || c.RunOwned || !c.Cache.OneHour || !compactWorth(c, now, s) {
		return false
	}
	return cacheLeft(c.Cache, now) <= CompactLead
}

// Compaction is one compaction a check asks for; ThenSleep is set when the agent sleeps once it lands.
type Compaction struct {
	TabId     string
	ThenSleep bool
}

// Plan is one check's work: the compactions to ask for, then the agents to put to sleep now.
type Plan struct {
	Compact []Compaction
	Sleep   []string
}

// Decide is the whole check. A sleep waiting on a compaction that has landed goes first, whatever the settings say: an
// earlier check or the person chose it (the check's own still needs the agent off screen). Then every agent Pick
// names sleeps, or is compacted first when that pays off, or waits while a compaction asked for earlier lands. Last,
// an idle agent no sleep takes is compacted when its cache is about to go.
func Decide(cands []Candidate, now time.Time, s Settings, freeBytes uint64) Plan {
	var p Plan
	byTab := map[string]Candidate{}
	taken := map[string]bool{}
	for _, c := range cands {
		byTab[c.TabId] = c
		landed := c.Idle && !c.RunOwned && c.Cache.Compacted
		if landed && (c.AfterCompact == SleepAfterPerson || c.AfterCompact == SleepAfterLoop && !c.Viewing) {
			p.Sleep = append(p.Sleep, c.TabId)
			taken[c.TabId] = true
		}
	}
	for _, id := range Pick(cands, now, s, freeBytes) {
		if taken[id] {
			continue
		}
		taken[id] = true
		c := byTab[id]
		switch {
		case !c.CompactSent.IsZero():
			// its compaction has not landed yet: a later check sleeps it
		case compactWorth(c, now, s):
			p.Compact = append(p.Compact, Compaction{TabId: id, ThenSleep: true})
		default:
			p.Sleep = append(p.Sleep, id)
		}
	}
	for _, c := range cands {
		if !taken[c.TabId] && c.CompactSent.IsZero() && cacheRunningOut(c, now, s) {
			p.Compact = append(p.Compact, Compaction{TabId: c.TabId})
		}
	}
	return p
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsleep

import (
	"strconv"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const (
	// sleepAfterFloorMin is the least "After idle for" honoured: under it a pause between two turns would put an
	// agent to sleep
	sleepAfterFloorMin = 5
	sleepAfterDefault  = 30
	// compactAtFloorK is the least context, in thousands of tokens, worth a compaction: under it one loses detail for
	// little
	compactAtFloorK = 25
)

// FromConfig reads the person's settings: Sleep idle agents (default on), After idle for (default 30 minutes, never
// under sleepAfterFloorMin), Compact before the cache goes cold (default on) and its least context (default 100k,
// never under compactAtFloorK).
func FromConfig(st wconfig.SettingsType) Settings {
	after := int64(sleepAfterDefault)
	if st.AgentsSleepAfterMin != nil {
		after = *st.AgentsSleepAfterMin
	}
	after = max(after, sleepAfterFloorMin)
	atK := int64(CompactAtDefault / 1000)
	if st.AgentsCompactAtK != nil {
		atK = *st.AgentsCompactAtK
	}
	atK = max(atK, compactAtFloorK)
	return Settings{
		Enabled:   st.AgentsSleepIdle == nil || *st.AgentsSleepIdle,
		After:     time.Duration(after) * time.Minute,
		Compact:   st.AgentsCompactIdle == nil || *st.AgentsCompactIdle,
		CompactAt: int(atK) * 1000,
	}
}

// IdleCompactVar is Claude Code's own idle compaction threshold (v2.1.299 on): a conversation of at least that many
// tokens left idle about 54 minutes is compacted before its hour-long prompt cache runs out. Claude Code does this
// for an agent that stays awake, so arcterm compacts only the one it puts to sleep; it hands Claude its threshold.
const IdleCompactVar = "CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS"

// IdleCompactEnv is the env a local block adds so Claude Code's idle compaction starts at the person's threshold
// instead of its own 200k: empty when Compact before the cache goes cold is off (Claude's default stands, and
// `"idleCompaction": false` in its settings turns it off), or when the variable is already in wavesrv's environment
// (the person's own choice wins).
func IdleCompactEnv(s Settings, lookupEnv func(string) (string, bool)) map[string]string {
	if !s.Compact {
		return nil
	}
	if _, ok := lookupEnv(IdleCompactVar); ok {
		return nil
	}
	return map[string]string{IdleCompactVar: strconv.Itoa(s.CompactAt)}
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsleep

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestFromConfig(t *testing.T) {
	yes, no := true, false
	ten, one, zero, k250 := int64(10), int64(1), int64(0), int64(250)
	cases := []struct {
		name string
		in   wconfig.SettingsType
		want Settings
	}{
		{"unset is on at 30 minutes", wconfig.SettingsType{}, Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: 100_000}},
		{"off", wconfig.SettingsType{AgentsSleepIdle: &no}, Settings{Enabled: false, After: 30 * time.Minute, Compact: true, CompactAt: 100_000}},
		{"on at ten minutes", wconfig.SettingsType{AgentsSleepIdle: &yes, AgentsSleepAfterMin: &ten}, Settings{Enabled: true, After: 10 * time.Minute, Compact: true, CompactAt: 100_000}},
		{"one minute is raised to the floor of five", wconfig.SettingsType{AgentsSleepAfterMin: &one}, Settings{Enabled: true, After: 5 * time.Minute, Compact: true, CompactAt: 100_000}},
		{"zero is raised to the floor too", wconfig.SettingsType{AgentsSleepAfterMin: &zero}, Settings{Enabled: true, After: 5 * time.Minute, Compact: true, CompactAt: 100_000}},
		{"compaction off", wconfig.SettingsType{AgentsCompactIdle: &no}, Settings{Enabled: true, After: 30 * time.Minute, CompactAt: 100_000}},
		{"compaction at 250k", wconfig.SettingsType{AgentsCompactAtK: &k250}, Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: 250_000}},
		{"ten thousand is raised to the floor of 25k", wconfig.SettingsType{AgentsCompactAtK: &ten}, Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: 25_000}},
	}
	for _, tc := range cases {
		if got := FromConfig(tc.in); got != tc.want {
			t.Errorf("%s: FromConfig = %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

func TestIdleCompactEnv(t *testing.T) {
	noEnv := func(string) (string, bool) { return "", false }
	on := Settings{Compact: true, CompactAt: 120_000}
	if got := IdleCompactEnv(on, noEnv); len(got) != 1 || got[IdleCompactVar] != "120000" {
		t.Fatalf("compaction on: got %v, want %s=120000", got, IdleCompactVar)
	}
	// sleep off does not matter: Claude compacts an awake agent either way
	if got := IdleCompactEnv(Settings{Enabled: false, Compact: true, CompactAt: 100_000}, noEnv); got[IdleCompactVar] != "100000" {
		t.Errorf("sleep off: got %v, want the threshold", got)
	}
	if got := IdleCompactEnv(Settings{CompactAt: 120_000}, noEnv); len(got) != 0 {
		t.Errorf("compaction off: got %v, want nothing (Claude's own default stands)", got)
	}
	set := func(k string) (string, bool) { return "50000", k == IdleCompactVar }
	if got := IdleCompactEnv(on, set); len(got) != 0 {
		t.Errorf("already in the environment: got %v, want the person's own value left alone", got)
	}
}

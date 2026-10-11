// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tokengate

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func f64(v float64) *float64 { return &v }
func i64(v int64) *int64     { return &v }
func pint(v int) *int        { return &v }

func TestEstimateCountsAtLeastOneAgent(t *testing.T) {
	if got := Estimate(Spawn{Agents: 3}); got != 3*PerAgentTokens {
		t.Fatalf("3 agents = %d", got)
	}
	if got := Estimate(Spawn{Agents: 0}); got != PerAgentTokens {
		t.Fatalf("0 agents = %d, want one agent's", got)
	}
}

func TestWindowShare(t *testing.T) {
	// 10M tokens at 50% → capacity 20M; 2M is 10%
	if share, ok := WindowShare(2_000_000, 10_000_000, 50); !ok || share != 10 {
		t.Fatalf("share %d ok %v", share, ok)
	}
	if _, ok := WindowShare(2_000_000, 10_000_000, 4); ok {
		t.Fatal("a window under 5% used is too small a sample")
	}
	if _, ok := WindowShare(2_000_000, 0, 50); ok {
		t.Fatal("no window tokens, no share")
	}
}

func TestRulesFromFillsDefaultsAndKeepsZero(t *testing.T) {
	if got := RulesFrom(nil, nil, nil); got != DefaultRules {
		t.Fatalf("unset = %+v", got)
	}
	zero := 0
	if got := RulesFrom(f64(0), f64(80), &zero); got != (Rules{SharePct: 0, WindowPct: 80, Agents: 0}) {
		t.Fatalf("set = %+v", got)
	}
}

func TestAsks(t *testing.T) {
	one := Spawn{Tool: "Agent", Agents: 1}
	cases := []struct {
		name  string
		rules Rules
		s     Spawn
		q     Quota
		want  bool
	}{
		{"a lone subagent with room runs", DefaultRules, one, Quota{FiveHourPct: f64(20), Share: pint(3)}, false},
		{"nothing known runs", DefaultRules, one, Quota{}, false},
		{"a big share asks", DefaultRules, one, Quota{FiveHourPct: f64(20), Share: pint(10)}, true},
		{"a full window asks", DefaultRules, one, Quota{FiveHourPct: f64(70)}, true},
		{"three agents ask", DefaultRules, Spawn{Tool: "Agent", Agents: 3}, Quota{}, true},
		{"a workflow asks", DefaultRules, Spawn{Tool: "Workflow", Agents: 1, AtLeast: true}, Quota{}, true},
		{"a rule at 0 is off", Rules{}, Spawn{Tool: "Agent", Agents: 9}, Quota{FiveHourPct: f64(99), Share: pint(50)}, false},
	}
	for _, c := range cases {
		if got := Asks(c.rules, c.s, c.q); got != c.want {
			t.Errorf("%s: %v", c.name, got)
		}
	}
}

func TestFormatTokens(t *testing.T) {
	for in, want := range map[int64]string{4_500_000: "4.5M", 3_000_000: "3M", 142_300: "142k", 900: "900"} {
		if got := FormatTokens(in); got != want {
			t.Errorf("FormatTokens(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestNote(t *testing.T) {
	one := Spawn{Tool: "Agent", Agents: 1}
	if got := Note(one, Quota{Share: pint(3)}); got != "Token burn: starting 1 subagent, about 1.5M tokens (rough), ~3% of the 5h window." {
		t.Fatalf("note %q", got)
	}
	if got := Note(one, Quota{}); got != "Token burn: starting 1 subagent, about 1.5M tokens (rough)." {
		t.Fatalf("note %q", got)
	}
}

func TestQuestionSaysEveryKnownNumber(t *testing.T) {
	q := Question(
		Spawn{Tool: "Agent", Agents: 3, ContextTokens: 142_000, ContextMax: 200_000},
		Quota{FiveHourPct: f64(62), FiveHourReset: i64(time.Date(2026, 10, 8, 14, 20, 0, 0, time.UTC).Unix()), Share: pint(9)},
		time.UTC,
	)
	want := "An agent wants to start 3 subagents, about 4.5M tokens (rough). Its own context is 142k of 200k, " +
		"and each of its further calls re-reads that. The 5-hour window is 62% used and resets at 14:20; " +
		"this would take about 9% more."
	if q.Header != "Token burn" || q.Question != want {
		t.Fatalf("header %q question\n%q\nwant\n%q", q.Header, q.Question, want)
	}
	if len(q.Options) != 4 || q.Options[OptionAllowSession].Label != "Allow this session" {
		t.Fatalf("options %+v", q.Options)
	}
}

func TestQuestionLeavesOutUnknownNumbers(t *testing.T) {
	q := Question(Spawn{Tool: "Workflow", Agents: 4, AtLeast: true}, Quota{}, time.UTC)
	if want := "An agent wants to run a workflow with at least 4 agents, about 6M tokens (rough)."; q.Question != want {
		t.Fatalf("question %q", q.Question)
	}
}

func TestChoice(t *testing.T) {
	pick := func(i int) []baseds.AgentAnswerItem { return []baseds.AgentAnswerItem{{SelectedIndexes: []int{i}}} }
	cases := []struct {
		answers   []baseds.AgentAnswerItem
		cancelled bool
		want      int
	}{
		{pick(OptionAllow), false, OptionAllow},
		{pick(OptionAllowTurn), false, OptionAllowTurn},
		{pick(OptionAllowSession), false, OptionAllowSession},
		{pick(OptionDeny), false, OptionDeny},
		{pick(OptionAllow), true, OptionDeny},
		{nil, false, OptionDeny},
		{[]baseds.AgentAnswerItem{{Text: "sure"}}, false, OptionDeny},
	}
	for i, c := range cases {
		if got := Choice(c.answers, c.cancelled); got != c.want {
			t.Errorf("case %d: %d, want %d", i, got, c.want)
		}
	}
}

func TestVerdictFor(t *testing.T) {
	for choice, scope := range map[int]string{OptionAllow: "", OptionAllowTurn: ScopeTurn, OptionAllowSession: ScopeSession} {
		if v := VerdictFor(choice, Spawn{}); !v.Run || v.Scope != scope {
			t.Errorf("choice %d: %+v", choice, v)
		}
	}
	v := VerdictFor(OptionDeny, Spawn{Tool: "Agent", Agents: 2})
	if v.Run || !strings.HasPrefix(v.Reason, "Not run:") || !strings.Contains(v.Reason, "Do not retry") {
		t.Fatalf("deny %+v", v)
	}
}

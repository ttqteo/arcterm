// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tokengate

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func f64(v float64) *float64 { return &v }
func i64(v int64) *int64     { return &v }
func pint(v int) *int        { return &v }

// measured costs as 2026-10-11's transcripts gave them, rounded
var testCosts = []Cost{
	{Type: "general-purpose", Samples: 14, Mean: 2_800_000, P25: 300_000, P90: 6_100_000},
	{Type: "Explore", Samples: 3, Mean: 7_000_000, P25: 5_800_000, P90: 11_700_000},
	{Type: "web-fetch", Samples: 2, Mean: 100_000, P25: 80_000, P90: 420_000},
	{Type: CostAll, Samples: 31, Mean: 4_800_000, P25: 130_000, P90: 11_700_000},
}

// the general-purpose row, and an every-type row too thin to price from
var thinCosts = []Cost{testCosts[0], {Type: CostAll, Samples: 4, Mean: 1, P25: 1, P90: 1}}

func TestEstimateCountsAtLeastOneAgent(t *testing.T) {
	if got := Estimate(Spawn{Agents: 3}); got != 3*PerAgentTokens {
		t.Fatalf("3 agents = %d", got)
	}
	if got := Estimate(Spawn{Agents: 0}); got != PerAgentTokens {
		t.Fatalf("0 agents = %d, want one agent's", got)
	}
}

func TestCouncilSpawnIsPricedFromItsOwnEstimate(t *testing.T) {
	council := Spawn{Tool: "Council", Agents: 4, EstimateTokens: 900_000}
	if got := Estimate(council); got != 900_000 {
		t.Fatalf("Estimate = %d, want the council's own 900k, not %d", got, 4*PerAgentTokens)
	}
	// measured subagent costs say nothing about a council's one-shot calls: the estimate stands, with no range
	if got, want := Price(council, testCosts), (Priced{Estimate: 900_000}); !reflect.DeepEqual(got, want) {
		t.Fatalf("Price = %+v, want %+v", got, want)
	}
	if got, want := Price(council, nil), (Priced{Estimate: 900_000}); !reflect.DeepEqual(got, want) {
		t.Fatalf("Price without costs = %+v, want %+v", got, want)
	}
	// a spawn with no estimate of its own is still priced per agent
	if got := Estimate(Spawn{Tool: "Council", Agents: 4}); got != 4*PerAgentTokens {
		t.Fatalf("Estimate without EstimateTokens = %d", got)
	}
}

func TestCouncilSpawnAsksLikeAnAgentSpawnOfThatSize(t *testing.T) {
	council := Spawn{Tool: "Council", Agents: 4, EstimateTokens: 900_000}
	agents := Spawn{Tool: "Agent", Agents: 4}
	cases := []struct {
		name  string
		rules Rules
		q     Quota
		want  bool
	}{
		{"four experts reach the agent count rule", DefaultRules, Quota{}, true},
		{"a big window share asks", Rules{SharePct: 10}, Quota{FiveHourPct: f64(20), Share: pint(10)}, true},
		{"a small share with the count rule off runs", Rules{SharePct: 10}, Quota{FiveHourPct: f64(20), Share: pint(3)}, false},
		{"a full window asks", DefaultRules, Quota{FiveHourPct: f64(70)}, true},
		{"a rule at 0 is off", Rules{}, Quota{FiveHourPct: f64(99), Share: pint(50)}, false},
	}
	for _, c := range cases {
		got, want := Asks(c.rules, council, c.q), Asks(c.rules, agents, c.q)
		if got != c.want || got != want {
			t.Errorf("%s: council asks %v, agent spawn of that size asks %v, want %v", c.name, got, want, c.want)
		}
	}
	// two experts stay under the count rule, as two agents do
	two := Spawn{Tool: "Council", Agents: 2, EstimateTokens: 400_000}
	if Asks(DefaultRules, two, Quota{}) {
		t.Fatal("a two-expert council asked with room in every window")
	}
}

func TestCouncilSpawnIsNamedOnTheCardTheNoteAndTheVerdict(t *testing.T) {
	s := Spawn{Tool: "Council", Agents: 4, EstimateTokens: 900_000}
	p := Price(s, testCosts)
	wantCard := "An agent wants to start a Council (4 experts), about 900k tokens (rough)."
	if got := Question(s, p, Quota{}, time.UTC).Question; got != wantCard {
		t.Fatalf("question\n%q\nwant\n%q", got, wantCard)
	}
	if got, want := Note(s, p, Quota{Share: pint(2)}), "Token burn: starting a Council (4 experts), about 900k tokens (rough), ~2% of the 5h window."; got != want {
		t.Fatalf("note\n%q\nwant\n%q", got, want)
	}
	if got := Asking(s).Hold; !strings.Contains(got, "start a Council (4 experts)") {
		t.Fatalf("hold %q", got)
	}
	if v := VerdictFor(OptionDeny, s, p.Estimate); v.Run || !strings.Contains(v.Reason, "start a Council (4 experts)") || !strings.Contains(v.Reason, "about 900k tokens") {
		t.Fatalf("deny %+v", v)
	}
	if got := Question(Spawn{Tool: "Council", Agents: 1, EstimateTokens: 200_000}, Priced{Estimate: 200_000}, Quota{}, time.UTC).Question; !strings.Contains(got, "Council (1 expert)") {
		t.Fatalf("one expert: %q", got)
	}
	// the estimate log names the spawn "Council", with the council's own estimate
	line := NewLogLine(time.Unix(0, 0), "s1", s, p, Verdict{Run: true}, false)
	if line.Tool != "Council" || line.Agents != 4 || line.Estimate != 900_000 || line.Low != 0 || line.High != 0 {
		t.Fatalf("log line %+v", line)
	}
}

func TestPrice(t *testing.T) {
	gp := "general-purpose"
	cases := []struct {
		name  string
		s     Spawn
		costs []Cost
		want  Priced
	}{
		{"one general-purpose", Spawn{Agents: 1, Types: []string{gp}}, testCosts,
			Priced{Estimate: 2_800_000, Low: 300_000, High: 6_100_000, Basis: []string{"14 general-purpose"}}},
		{"two general-purpose and an Explore", Spawn{Agents: 3, Types: []string{gp, gp, "Explore"}}, testCosts,
			Priced{Estimate: 12_600_000, Low: 6_400_000, High: 23_900_000, Basis: []string{"14 general-purpose", "3 Explore"}}},
		{"a type with too few samples takes the every-type row", Spawn{Agents: 1, Types: []string{"web-fetch"}}, testCosts,
			Priced{Estimate: 4_800_000, Low: 130_000, High: 11_700_000, Basis: []string{"31 recent"}}},
		{"a workflow's agents have no type", Spawn{Tool: "Workflow", Agents: 2, AtLeast: true}, testCosts,
			Priced{Estimate: 9_600_000, Low: 260_000, High: 23_400_000, Basis: []string{"31 recent"}}},
		{"no costs at all", Spawn{Agents: 3}, nil, Priced{Estimate: 4_500_000}},
		{"a thin every-type row leaves the rest at the constant, with no range", Spawn{Agents: 2, Types: []string{gp, "web-fetch"}}, thinCosts,
			Priced{Estimate: 4_300_000, Basis: []string{"14 general-purpose"}}},
	}
	for _, c := range cases {
		if got := Price(c.s, c.costs); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: %+v, want %+v", c.name, got, c.want)
		}
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

func TestSessionShare(t *testing.T) {
	// 2M of the window's 10M, the window 50% used: the session took 10%
	if pct, ok := SessionShare(2_000_000, 10_000_000, 50); !ok || pct != 10 {
		t.Fatalf("share %d ok %v", pct, ok)
	}
	// a session count above the window's (a file read between the two sums) is the whole window
	if pct, ok := SessionShare(12_000_000, 10_000_000, 50); !ok || pct != 50 {
		t.Fatalf("clamped share %d ok %v", pct, ok)
	}
	// it apportions the reported percent, so a window under 5% used still gives one
	if pct, ok := SessionShare(5_000_000, 10_000_000, 2); !ok || pct != 1 {
		t.Fatalf("small window share %d ok %v", pct, ok)
	}
	if _, ok := SessionShare(0, 10_000_000, 50); ok {
		t.Fatal("no session tokens, no share")
	}
	if _, ok := SessionShare(2_000_000, 0, 50); ok {
		t.Fatal("no window tokens, no share")
	}
}

func TestQuotaFrom(t *testing.T) {
	reset5h := i64(time.Date(2026, 10, 11, 14, 20, 0, 0, time.UTC).Unix())
	resetWk := i64(time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC).Unix())
	full := Reading{
		FiveHourPct: f64(50), FiveHourReset: reset5h, WeekPct: f64(20), WeekReset: resetWk, Counted: true,
		WindowFiveHour: 10_000_000, WindowWeek: 40_000_000, SessionFiveHour: 2_000_000, SessionWeek: 4_000_000, Subagents: 3,
	}
	// 5h: capacity 20M, 2M is 10%, the session 2/10 of 50% = 10%. week: capacity 200M, 2M is 1%, the session 4/40 of 20% = 2%
	q := QuotaFrom(full, 2_000_000)
	if q.Share == nil || *q.Share != 10 || q.WeekShare == nil || *q.WeekShare != 1 {
		t.Fatalf("shares %v / %v", q.Share, q.WeekShare)
	}
	if q.Session == nil || *q.Session.FiveHourPct != 10 || *q.Session.WeekPct != 2 || q.Session.Subagents != 3 {
		t.Fatalf("session %+v", q.Session)
	}

	// a Team seat has no week reading: every week number is unknown, the 5h ones still work
	team := full
	team.WeekPct, team.WeekReset = nil, nil
	q = QuotaFrom(team, 2_000_000)
	if q.WeekPct != nil || q.WeekShare != nil || q.Session == nil || q.Session.WeekPct != nil || q.Share == nil {
		t.Fatalf("team seat %+v session %+v", q, q.Session)
	}

	// a reset that is unknown: the window's count had a guessed cutoff, so it gives no shares, but its percent stays
	noReset := full
	noReset.FiveHourReset = nil
	q = QuotaFrom(noReset, 2_000_000)
	if q.Share != nil || q.Session.FiveHourPct != nil || q.FiveHourPct == nil {
		t.Fatalf("no 5h reset %+v session %+v", q, q.Session)
	}

	// wavesrv's count failed or timed out: only the reported percents
	q = QuotaFrom(Reading{FiveHourPct: f64(50), FiveHourReset: reset5h}, 2_000_000)
	if q.Share != nil || q.Session != nil || q.FiveHourPct == nil {
		t.Fatalf("not counted %+v", q)
	}

	// no session tokens (no transcript path): no session
	noSession := full
	noSession.SessionFiveHour, noSession.SessionWeek = 0, 0
	if q = QuotaFrom(noSession, 2_000_000); q.Session != nil {
		t.Fatalf("no session tokens, session %+v", q.Session)
	}
}

func TestRulesFromFillsDefaultsAndKeepsZero(t *testing.T) {
	if got := RulesFrom(nil, nil, nil, nil, nil); got != DefaultRules {
		t.Fatalf("unset = %+v", got)
	}
	zero := 0
	want := Rules{SharePct: 0, WindowPct: 80, Agents: 0, WeekPct: 0, SessionPct: 40}
	if got := RulesFrom(f64(0), f64(80), &zero, f64(0), f64(40)); got != want {
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
		{"a third agent a moment after two others asks", DefaultRules, Spawn{Tool: "Agent", Agents: 1, Earlier: 2}, Quota{}, true},
		{"a second agent a moment after another runs", DefaultRules, Spawn{Tool: "Agent", Agents: 1, Earlier: 1}, Quota{}, false},
		{"a workflow asks", DefaultRules, Spawn{Tool: "Workflow", Agents: 1, AtLeast: true}, Quota{}, true},
		{"a full week asks", DefaultRules, one, Quota{WeekPct: f64(80)}, true},
		{"a week with room runs", DefaultRules, one, Quota{WeekPct: f64(79)}, false},
		{"a heavy session asks", DefaultRules, one, Quota{Session: &SessionUse{FiveHourPct: pint(25)}}, true},
		{"a light session runs", DefaultRules, one, Quota{Session: &SessionUse{FiveHourPct: pint(24), WeekPct: pint(90)}}, false},
		{"a session with no 5h share runs", DefaultRules, one, Quota{Session: &SessionUse{WeekPct: pint(90)}}, false},
		{"a rule at 0 is off", Rules{}, Spawn{Tool: "Agent", Agents: 9}, Quota{
			FiveHourPct: f64(99), Share: pint(50), WeekPct: f64(99), Session: &SessionUse{FiveHourPct: pint(99)},
		}, false},
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
	rough := Spawn{Tool: "Agent", Agents: 1}
	if got := Note(rough, Price(rough, nil), Quota{Share: pint(3)}); got != "Token burn: starting 1 subagent, about 1.5M tokens (rough), ~3% of the 5h window." {
		t.Fatalf("note %q", got)
	}
	if got := Note(rough, Price(rough, nil), Quota{}); got != "Token burn: starting 1 subagent, about 1.5M tokens (rough)." {
		t.Fatalf("note %q", got)
	}
	gp := Spawn{Tool: "Agent", Agents: 1, Types: []string{"general-purpose"}}
	q := Quota{Share: pint(3), WeekShare: pint(0), Session: &SessionUse{FiveHourPct: pint(18), WeekPct: pint(4), Subagents: 4}}
	want := "Token burn: starting 1 subagent, about 2.8M tokens (300k–6.1M, 14 general-purpose), ~3% of the 5h window, " +
		"<1% of the week. This session so far: ~18% of 5h, ~4% of the week."
	if got := Note(gp, Price(gp, testCosts), q); got != want {
		t.Fatalf("note\n%q\nwant\n%q", got, want)
	}
	partly := Spawn{Tool: "Agent", Agents: 2, Types: []string{"general-purpose", "web-fetch"}}
	if got := Note(partly, Price(partly, thinCosts), Quota{}); got != "Token burn: starting 2 subagents, about 4.3M tokens (rough, partly 14 general-purpose)." {
		t.Fatalf("note %q", got)
	}
}

func TestQuestionSaysEveryKnownNumber(t *testing.T) {
	s := Spawn{Tool: "Agent", Agents: 3, ContextTokens: 142_000, ContextMax: 200_000, Types: []string{"general-purpose", "general-purpose", "Explore"}}
	q := Question(s, Price(s, testCosts), Quota{
		FiveHourPct: f64(62), FiveHourReset: i64(time.Date(2026, 10, 8, 14, 20, 0, 0, time.UTC).Unix()), Share: pint(9),
		WeekPct: f64(31), WeekReset: i64(time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC).Unix()), WeekShare: pint(1),
		Session: &SessionUse{FiveHourPct: pint(18), WeekPct: pint(4), Subagents: 4},
	}, time.UTC)
	want := "An agent wants to start 3 subagents, about 12.6M tokens, likely 6.4M–23.9M (from 14 general-purpose and 3 Explore subagents). " +
		"Its own context is 142k of 200k, and each of its further calls re-reads that. " +
		"This session has used about 18% of the 5-hour window and about 4% of the week so far, its 4 subagents included. " +
		"The 5-hour window is 62% used and resets at 14:20; this would take about 9% more. " +
		"The week is 31% used and resets Mon 09:00; this would take about 1% of it."
	if q.Header != "Token burn" || q.Question != want {
		t.Fatalf("header %q question\n%q\nwant\n%q", q.Header, q.Question, want)
	}
	if len(q.Options) != 4 || q.Options[OptionAllowSession].Label != "Allow this session" {
		t.Fatalf("options %+v", q.Options)
	}
}

func TestQuestionLeavesOutUnknownNumbers(t *testing.T) {
	wf := Spawn{Tool: "Workflow", Agents: 4, AtLeast: true}
	if got := Question(wf, Price(wf, nil), Quota{}, time.UTC).Question; got != "An agent wants to run a workflow with at least 4 agents, about 6M tokens (rough)." {
		t.Fatalf("question %q", got)
	}
	// a Team seat (no week), and a session whose only known share is a sliver of the 5h window, with no subagents
	one := Spawn{Tool: "Agent", Agents: 1}
	want := "An agent wants to start 1 subagent, about 1.5M tokens (rough). " +
		"This session has used less than 1% of the 5-hour window so far. The 5-hour window is 40% used."
	if got := Question(one, Price(one, nil), Quota{FiveHourPct: f64(40), Session: &SessionUse{FiveHourPct: pint(0)}}, time.UTC).Question; got != want {
		t.Fatalf("question\n%q\nwant\n%q", got, want)
	}
	partly := Spawn{Tool: "Agent", Agents: 2, Types: []string{"general-purpose", "web-fetch"}}
	if got := Question(partly, Price(partly, thinCosts), Quota{}, time.UTC).Question; got != "An agent wants to start 2 subagents, about 4.3M tokens (rough, partly from 14 general-purpose subagents)." {
		t.Fatalf("question %q", got)
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
		if v := VerdictFor(choice, Spawn{}, 0); !v.Run || v.Scope != scope {
			t.Errorf("choice %d: %+v", choice, v)
		}
	}
	v := VerdictFor(OptionDeny, Spawn{Tool: "Agent", Agents: 2}, 5_600_000)
	if v.Run || !strings.HasPrefix(v.Reason, "Not run:") || !strings.Contains(v.Reason, "Do not retry") || !strings.Contains(v.Reason, "about 5.6M tokens") {
		t.Fatalf("deny %+v", v)
	}
}

func TestQuestionSaysTheAgentsJustStarted(t *testing.T) {
	s := Spawn{Tool: "Agent", Agents: 1, Earlier: 2}
	want := "An agent wants to start 1 subagent, about 1.5M tokens (rough). It started 2 more in the last few seconds."
	if got := Question(s, Price(s, nil), Quota{}, time.UTC).Question; got != want {
		t.Fatalf("question\n%q\nwant\n%q", got, want)
	}
}

func TestLogLine(t *testing.T) {
	line := NewLogLine(time.Unix(1_760_000_000, 0), "s1",
		Spawn{Tool: "Agent", Agents: 2, Types: []string{"general-purpose", "Explore"}},
		Priced{Estimate: 9_800_000, Low: 6_100_000, High: 17_800_000},
		Verdict{Run: true, Scope: ScopeTurn}, true)
	data, err := json.Marshal(line)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"ts":1760000000,"session":"s1","tool":"Agent","agents":2,"types":["general-purpose","Explore"],"estimate":9800000,"low":6100000,"high":17800000,"verdict":"allow-turn"}`
	if string(data) != want {
		t.Fatalf("line\n%s\nwant\n%s", data, want)
	}
	// the agents started just before count in the log, and only when there were some
	data, _ = json.Marshal(NewLogLine(time.Unix(0, 0), "", Spawn{Tool: "Agent", Agents: 1, Earlier: 2}, Priced{Estimate: 1}, Verdict{Run: true}, true))
	if !strings.Contains(string(data), `"earlier":2`) {
		t.Fatalf("burst line %s", data)
	}
	// a workflow's agents have no types: an empty list, not null
	data, _ = json.Marshal(NewLogLine(time.Unix(0, 0), "", Spawn{Tool: "Workflow", Agents: 1}, Priced{Estimate: 1}, Verdict{Run: true}, false))
	if !strings.Contains(string(data), `"types":[]`) || !strings.Contains(string(data), `"verdict":"run"`) {
		t.Fatalf("workflow line %s", data)
	}
	for _, c := range []struct {
		v     Verdict
		asked bool
		want  string
	}{
		{Verdict{Run: true}, false, "run"},
		{Verdict{Run: true}, true, "allow"},
		{Verdict{Run: true, Scope: ScopeSession}, true, "allow-session"},
		{Verdict{}, true, "deny"},
	} {
		if got := VerdictName(c.v, c.asked); got != c.want {
			t.Errorf("VerdictName(%+v, %v) = %q, want %q", c.v, c.asked, got, c.want)
		}
	}
	if got := LogPath("/h"); got != filepath.Join("/h", ".arc", "tokengate", "estimates.jsonl") {
		t.Fatalf("log path %q", got)
	}
}

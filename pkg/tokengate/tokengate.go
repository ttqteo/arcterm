// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package tokengate holds a costly spawn (subagents, a workflow) for the person's say before it spends tokens:
// cost grows as context × calls × agents, nearly all of it cache reads. `wsh tokengate` asks; the Claude mod
// calls it before every Agent, Task or Workflow tool call, as it calls `wsh jobslot` before a heavy shell command.
// It asks only when a rule says the spawn matters: a card on every spawn trains a reflex Allow.
package tokengate

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// PerAgentTokens is a subagent's typical run: ~30 tool calls at a ~50k average context, nearly all cache
// reads. Rough and uncalibrated; measuring it from saved transcripts is the follow-up (docs/deferred.md).
const PerAgentTokens int64 = 1_500_000

// below this much of the 5h window used, tokens/pct is too small a sample to give the window's size
const minPctForShare = 5.0

// the card's options, by index
const (
	OptionAllow = iota
	OptionAllowTurn
	OptionAllowSession
	OptionDeny
)

// a verdict's scope: how long the mod lets later spawns through without asking
const (
	ScopeTurn    = "turn"
	ScopeSession = "session"
)

// Spawn is what the agent is about to start: one group of parallel tool calls
type Spawn struct {
	Tool          string // Agent, Task or Workflow; a group with any Workflow is Workflow
	Agents        int
	AtLeast       bool // a workflow's agent count is a floor: loops multiply it
	ContextTokens int64
	ContextMax    int64
}

// Quota is what is known of the 5-hour window; nil fields are unknown, left out of the card, and fire no rule
type Quota struct {
	FiveHourPct   *float64
	FiveHourReset *int64 // epoch seconds
	Share         *int   // whole percent of the window the estimate would take
}

// Rules say when a spawn asks; a rule at 0 is off. A workflow always asks.
type Rules struct {
	SharePct  float64 // the spawn would take at least this much of the 5h window
	WindowPct float64 // the 5h window is at least this full
	Agents    int     // the group starts at least this many agents
}

var DefaultRules = Rules{SharePct: 10, WindowPct: 70, Agents: 3}

// RulesFrom fills unset settings with the defaults; a setting of 0 stays 0, which turns its rule off
func RulesFrom(sharePct, windowPct *float64, agents *int) Rules {
	r := DefaultRules
	if sharePct != nil {
		r.SharePct = *sharePct
	}
	if windowPct != nil {
		r.WindowPct = *windowPct
	}
	if agents != nil {
		r.Agents = *agents
	}
	return r
}

// Verdict is `wsh tokengate`'s last line. Note is the log line of a spawn that ran without asking.
type Verdict struct {
	Run    bool   `json:"run"`
	Scope  string `json:"scope,omitempty"`
	Reason string `json:"reason,omitempty"`
	Note   string `json:"note,omitempty"`
}

// Hold is a line printed while the card waits, for the hook to show the person
type Hold struct {
	Hold string `json:"hold"`
}

func Estimate(s Spawn) int64 {
	return int64(max(s.Agents, 1)) * PerAgentTokens
}

// WindowShare is the estimate as a whole percent of the 5h window, whose size is read off the tokens the
// window has seen and how full it is. false when that reading is too thin to divide by.
func WindowShare(estimate, fiveHourTokens int64, fiveHourPct float64) (int, bool) {
	if fiveHourPct < minPctForShare || fiveHourTokens <= 0 {
		return 0, false
	}
	capacity := float64(fiveHourTokens) * 100 / fiveHourPct
	return int(math.Round(float64(estimate) * 100 / capacity)), true
}

// Asks says whether the spawn is worth the person's say
func Asks(r Rules, s Spawn, q Quota) bool {
	switch {
	case s.Tool == "Workflow":
		return true
	case r.Agents > 0 && s.Agents >= r.Agents:
		return true
	case r.WindowPct > 0 && q.FiveHourPct != nil && *q.FiveHourPct >= r.WindowPct:
		return true
	case r.SharePct > 0 && q.Share != nil && float64(*q.Share) >= r.SharePct:
		return true
	}
	return false
}

// FormatTokens is a token count as the card shows it: 4.5M, 3M, 142k
func FormatTokens(n int64) string {
	switch {
	case n >= 1_000_000:
		return strings.TrimSuffix(fmt.Sprintf("%.1f", float64(n)/1e6), ".0") + "M"
	case n >= 1_000:
		return fmt.Sprintf("%dk", n/1_000)
	}
	return fmt.Sprintf("%d", n)
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

// what the agent wants, as a sentence reads it after "wants to"
func what(s Spawn) string {
	n := max(s.Agents, 1)
	if s.Tool == "Workflow" {
		return "run a workflow with at least " + plural(n, "agent")
	}
	if s.AtLeast {
		return "start at least " + plural(n, "subagent")
	}
	return "start " + plural(n, "subagent")
}

// Note is the log line of a spawn that runs without asking
func Note(s Spawn, q Quota) string {
	var b strings.Builder
	verb, rest, _ := strings.Cut(what(s), " ")
	fmt.Fprintf(&b, "Token burn: %s %s, about %s tokens (rough)", ing(verb), rest, FormatTokens(Estimate(s)))
	if q.Share != nil {
		fmt.Fprintf(&b, ", ~%d%% of the 5h window", *q.Share)
	}
	b.WriteString(".")
	return b.String()
}

// "start" → "starting", "run" → "running"
func ing(verb string) string {
	if verb == "run" {
		return "running"
	}
	return verb + "ing"
}

// Question is the card. loc is where the reset time is read; the caller passes time.Local
func Question(s Spawn, q Quota, loc *time.Location) baseds.AgentAskQuestion {
	var b strings.Builder
	fmt.Fprintf(&b, "An agent wants to %s, about %s tokens (rough).", what(s), FormatTokens(Estimate(s)))
	if s.ContextTokens > 0 && s.ContextMax > 0 {
		fmt.Fprintf(&b, " Its own context is %s of %s, and each of its further calls re-reads that.",
			FormatTokens(s.ContextTokens), FormatTokens(s.ContextMax))
	}
	if q.FiveHourPct != nil {
		fmt.Fprintf(&b, " The 5-hour window is %d%% used", int(math.Round(*q.FiveHourPct)))
		if q.FiveHourReset != nil {
			fmt.Fprintf(&b, " and resets at %s", time.Unix(*q.FiveHourReset, 0).In(loc).Format("15:04"))
		}
		if q.Share != nil {
			fmt.Fprintf(&b, "; this would take about %d%% more", *q.Share)
		}
		b.WriteString(".")
	}
	return baseds.AgentAskQuestion{
		Header:   "Token burn",
		Question: b.String(),
		Options: []baseds.AgentAskOption{
			OptionAllow:        {Label: "Allow", Description: "Start this one. A later costly spawn asks again."},
			OptionAllowTurn:    {Label: "Allow this turn", Description: "Start this and every later spawn until your next prompt, without asking."},
			OptionAllowSession: {Label: "Allow this session", Description: "Don't ask again in this agent's session."},
			OptionDeny:         {Label: "Don't spawn", Description: "The agent does the work itself or asks you. Later spawns this turn are refused too."},
		},
	}
}

// Choice is the option the person picked; a dismissed card, a typed answer or no answer is a deny
func Choice(answers []baseds.AgentAnswerItem, cancelled bool) int {
	if cancelled || len(answers) == 0 || len(answers[0].SelectedIndexes) != 1 {
		return OptionDeny
	}
	switch i := answers[0].SelectedIndexes[0]; i {
	case OptionAllow, OptionAllowTurn, OptionAllowSession:
		return i
	}
	return OptionDeny
}

// VerdictFor turns the person's choice into the line the mod reads
func VerdictFor(choice int, s Spawn) Verdict {
	switch choice {
	case OptionAllow:
		return Verdict{Run: true}
	case OptionAllowTurn:
		return Verdict{Run: true, Scope: ScopeTurn}
	case OptionAllowSession:
		return Verdict{Run: true, Scope: ScopeSession}
	}
	return Verdict{Reason: fmt.Sprintf(
		"Not run: the person chose not to %s now (token budget, about %s tokens). "+
			"Do not retry a spawn this turn; do the work in this session or ask the person, "+
			"and say in your report that the spawn was refused.",
		what(s), FormatTokens(Estimate(s)))}
}

// Asking is the hold line while the card waits
func Asking(s Spawn) Hold {
	return Hold{fmt.Sprintf("Token burn: waiting for your answer on arcterm's card before the agent may %s.", what(s))}
}

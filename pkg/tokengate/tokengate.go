// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package tokengate holds a costly spawn (subagents, a workflow) for the person's say before it spends tokens:
// cost grows as context × calls × agents, nearly all of it cache reads. `wsh tokengate` asks; the Claude mod
// calls it before every Agent, Task or Workflow tool call, as it calls `wsh jobslot` before a heavy shell command;
// `wsh council start` asks it for a Council, which arrives as a Bash command and brings its own estimate.
// It asks only when a rule says the spawn matters: a card on every spawn trains a reflex Allow.
package tokengate

import (
	"fmt"
	"math"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// PerAgentTokens prices an agent when no finished subagents say otherwise: ~30 tool calls at a ~50k average context,
// nearly all cache reads. Price uses measured Costs first.
const PerAgentTokens int64 = 1_500_000

// below this much of a window used, tokens/pct is too small a sample to give the window's size
const minPctForShare = 5.0

// CostAll is the Cost row over every subagent type
const CostAll = "all"

// a type's row prices its agents from this many samples, the every-type row the rest from minAllSamples
const (
	minTypeSamples = 3
	minAllSamples  = 5
)

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
	Tool          string // Agent, Task or Workflow; a group with any Workflow is Workflow; Council for `wsh council start`
	Agents        int    // a Council's is its experts
	AtLeast       bool   // a workflow's agent count is a floor: loops multiply it
	ContextTokens int64
	ContextMax    int64
	// the spawn's own estimate when it has one (a Council's, from pkg/council); 0 prices each agent as usual
	EstimateTokens int64
	Types          []string // each agent's subagent type, in order; "" or missing is unknown (a Workflow's agents)
	// agents the same agent started in the seconds before, which count toward the agents rule: one message's spawns
	// reach the gate spread out as Claude writes them, so the mod chains the groups that come within seconds
	Earlier int
	// each Agent or Task call as the agent wrote it, which the card lists; none for a Workflow or a Council
	Calls []Call
	// the model the asking session runs on, which a call that sets none takes; "" is unknown
	SessionModel string
}

// Call is one Agent or Task call: what the card names of the subagent it would start
type Call struct {
	Type        string `json:"type"`
	Model       string `json:"model,omitempty"` // the call's own model; "" when it sets none
	Description string `json:"description,omitempty"`
	Background  bool   `json:"background,omitempty"`
}

// the built-in subagent types with no model of their own, so a call that sets none runs on the session's model. In
// 2026-10's transcripts every Explore and general-purpose call with no model ran on the session's; a fork always does
var inheritsModel = map[string]bool{"general-purpose": true, "Explore": true, "Plan": true, "fork": true}

// the card lists this many calls, then counts the rest
const maxCallLines = 6

// Cost is what finished subagents of one type cost, as wavesrv measures them on their transcripts
type Cost struct {
	Type    string
	Samples int
	Mean    int64
	P25     int64
	P90     int64
}

// Priced is a spawn's estimate: the sum of its agents' mean costs, and a range (the sums of their p25 and p90) when
// every agent was priced from samples. Basis names the rows used, "14 general-purpose" or "31 recent", in the order
// first used; none means every agent was priced at PerAgentTokens (or the spawn brought its own estimate).
type Priced struct {
	Estimate int64
	Low      int64
	High     int64 // 0: no range
	Basis    []string
}

// SessionUse is the whole percent of each window the asking session, its subagents included, has used; nil is
// unknown
type SessionUse struct {
	FiveHourPct *int
	WeekPct     *int
	Subagents   int
}

// Quota is what is known of the 5-hour and weekly windows; nil fields are unknown, left out of the card, and fire
// no rule
type Quota struct {
	FiveHourPct   *float64
	FiveHourReset *int64 // epoch seconds
	Share         *int   // whole percent of the 5h window the estimate would take
	WeekPct       *float64
	WeekReset     *int64 // epoch seconds
	WeekShare     *int   // whole percent of the weekly window the estimate would take
	Session       *SessionUse
}

// Reading is what `wsh tokengate` read for a spawn: the quota (nil fields unknown) and, when Counted, wavesrv's
// token counts of both windows and of the asking session inside them
type Reading struct {
	FiveHourPct, WeekPct         *float64
	FiveHourReset, WeekReset     *int64
	Counted                      bool
	WindowFiveHour, WindowWeek   int64
	SessionFiveHour, SessionWeek int64
	Subagents                    int
}

// Rules say when a spawn asks; a rule at 0 is off. A workflow always asks.
type Rules struct {
	SharePct   float64 // the spawn would take at least this much of the 5h window
	WindowPct  float64 // the 5h window is at least this full
	Agents     int     // the group starts at least this many agents
	WeekPct    float64 // the weekly window is at least this full
	SessionPct float64 // the asking session has already used at least this much of the 5h window
}

var DefaultRules = Rules{SharePct: 10, WindowPct: 70, Agents: 3, WeekPct: 80, SessionPct: 25}

// RulesFrom fills unset settings with the defaults; a setting of 0 stays 0, which turns its rule off
func RulesFrom(sharePct, windowPct *float64, agents *int, weekPct, sessionPct *float64) Rules {
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
	if weekPct != nil {
		r.WeekPct = *weekPct
	}
	if sessionPct != nil {
		r.SessionPct = *sessionPct
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

// Estimate is the spawn at PerAgentTokens an agent, for a caller with no measured costs; a spawn with an estimate of
// its own is that
func Estimate(s Spawn) int64 {
	if s.EstimateTokens > 0 {
		return s.EstimateTokens
	}
	return int64(max(s.Agents, 1)) * PerAgentTokens
}

// Price prices each agent from its type's row when that has minTypeSamples, else the every-type row when that has
// minAllSamples, else at PerAgentTokens. An agent with no known type takes the every-type row. A spawn with an
// estimate of its own is priced at that, with no range: finished subagents' costs say nothing about its calls.
func Price(s Spawn, costs []Cost) Priced {
	if s.EstimateTokens > 0 {
		return Priced{Estimate: s.EstimateTokens}
	}
	rows := map[string]Cost{}
	for _, c := range costs {
		rows[c.Type] = c
	}
	all, hasAll := rows[CostAll]
	hasAll = hasAll && all.Samples >= minAllSamples
	var p Priced
	ranged := true
	seen := map[string]bool{}
	for i := 0; i < max(s.Agents, 1); i++ {
		t := ""
		if i < len(s.Types) {
			t = s.Types[i]
		}
		c, ok := rows[t]
		if t == "" || t == CostAll || !ok || c.Samples < minTypeSamples {
			c, ok = all, hasAll
		}
		if !ok {
			p.Estimate += PerAgentTokens
			ranged = false
			continue
		}
		p.Estimate += c.Mean
		p.Low += c.P25
		p.High += c.P90
		if !seen[c.Type] {
			seen[c.Type] = true
			name := c.Type
			if name == CostAll {
				name = "recent"
			}
			p.Basis = append(p.Basis, fmt.Sprintf("%d %s", c.Samples, name))
		}
	}
	if !ranged {
		p.Low, p.High = 0, 0
	}
	return p
}

// WindowShare is the estimate as a whole percent of a window, whose size is read off the tokens the window has
// seen and how full it is. false when that reading is too thin to divide by.
func WindowShare(estimate, windowTokens int64, windowPct float64) (int, bool) {
	if windowPct < minPctForShare || windowTokens <= 0 {
		return 0, false
	}
	capacity := float64(windowTokens) * 100 / windowPct
	return int(math.Round(float64(estimate) * 100 / capacity)), true
}

// SessionShare is the whole percent of a window one session's tokens took: the window's reported percent,
// apportioned by tokens. false when the session has no tokens in the window, or the window none at all
func SessionShare(sessionTokens, windowTokens int64, windowPct float64) (int, bool) {
	if sessionTokens <= 0 || windowTokens <= 0 {
		return 0, false
	}
	sessionTokens = min(sessionTokens, windowTokens)
	return int(math.Round(float64(sessionTokens) * windowPct / float64(windowTokens))), true
}

// QuotaFrom turns what was read into what the card and the rules use, for a spawn of estimate tokens. A window
// whose percent or reset is unknown gets no shares: its token count's cutoff was only a guess.
func QuotaFrom(r Reading, estimate int64) Quota {
	q := Quota{FiveHourPct: r.FiveHourPct, FiveHourReset: r.FiveHourReset, WeekPct: r.WeekPct, WeekReset: r.WeekReset}
	if !r.Counted {
		return q
	}
	var use SessionUse
	if r.FiveHourPct != nil && r.FiveHourReset != nil {
		if share, ok := WindowShare(estimate, r.WindowFiveHour, *r.FiveHourPct); ok {
			q.Share = &share
		}
		if pct, ok := SessionShare(r.SessionFiveHour, r.WindowFiveHour, *r.FiveHourPct); ok {
			use.FiveHourPct = &pct
		}
	}
	if r.WeekPct != nil && r.WeekReset != nil {
		if share, ok := WindowShare(estimate, r.WindowWeek, *r.WeekPct); ok {
			q.WeekShare = &share
		}
		if pct, ok := SessionShare(r.SessionWeek, r.WindowWeek, *r.WeekPct); ok {
			use.WeekPct = &pct
		}
	}
	if use.FiveHourPct != nil || use.WeekPct != nil {
		use.Subagents = r.Subagents
		q.Session = &use
	}
	return q
}

// Asks says whether the spawn is worth the person's say
func Asks(r Rules, s Spawn, q Quota) bool {
	switch {
	case s.Tool == "Workflow":
		return true
	case r.Agents > 0 && s.Agents+s.Earlier >= r.Agents:
		return true
	case r.WindowPct > 0 && q.FiveHourPct != nil && *q.FiveHourPct >= r.WindowPct:
		return true
	case r.SharePct > 0 && q.Share != nil && float64(*q.Share) >= r.SharePct:
		return true
	case r.WeekPct > 0 && q.WeekPct != nil && *q.WeekPct >= r.WeekPct:
		return true
	case r.SessionPct > 0 && q.Session != nil && q.Session.FiveHourPct != nil &&
		float64(*q.Session.FiveHourPct) >= r.SessionPct:
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
	if s.Tool == "Council" {
		return fmt.Sprintf("start a Council (%s)", plural(n, "expert"))
	}
	if s.AtLeast {
		return "start at least " + plural(n, "subagent")
	}
	return "start " + plural(n, "subagent")
}

// joinAnd lists parts as a sentence does: "a", "a and b", "a, b and c"
func joinAnd(parts []string) string {
	if len(parts) <= 1 {
		return strings.Join(parts, "")
	}
	return strings.Join(parts[:len(parts)-1], ", ") + " and " + parts[len(parts)-1]
}

// costText is the estimate and what it rests on; long is the card's spelling, else the note's. The card names the
// finished subagents it priced from as finished: "from 40 Explore subagents" read as forty about to start
func costText(p Priced, long bool) string {
	est := FormatTokens(p.Estimate)
	switch {
	case len(p.Basis) == 0:
		return fmt.Sprintf("about %s tokens (rough)", est)
	case p.High == 0 && long:
		return fmt.Sprintf("about %s tokens (rough, partly going by the cost of %s subagents)", est, finished(p.Basis))
	case p.High == 0:
		return fmt.Sprintf("about %s tokens (rough, partly %s)", est, strings.Join(p.Basis, ", "))
	case long:
		return fmt.Sprintf("about %s tokens, likely %s–%s, going by the cost of %s subagents",
			est, FormatTokens(p.Low), FormatTokens(p.High), finished(p.Basis))
	}
	return fmt.Sprintf("about %s tokens (%s–%s, %s)", est, FormatTokens(p.Low), FormatTokens(p.High), strings.Join(p.Basis, ", "))
}

// finished lists the rows priced from as finished ones: "14 finished general-purpose and 3 Explore"
func finished(basis []string) string {
	parts := slices.Clone(basis)
	if n, rest, ok := strings.Cut(parts[0], " "); ok {
		parts[0] = n + " finished " + rest
	}
	return joinAnd(parts)
}

// modelName is a model as the card names it: an alias as the call wrote it ("haiku"), an id as the agent header
// does ("claude-opus-5-5" → "opus 5.5", a dated "claude-haiku-4-5-20251001" → "haiku 4.5")
func modelName(m string) string {
	m = strings.TrimPrefix(m, "claude-")
	if i := strings.LastIndex(m, "-"); i >= 0 && len(m)-i-1 == 8 && strings.Trim(m[i+1:], "0123456789") == "" {
		m = m[:i]
	}
	family, version, ok := strings.Cut(m, "-")
	if !ok {
		return m
	}
	return family + " " + strings.ReplaceAll(version, "-", ".")
}

// callLine is one call as the card lists it: `• Explore on haiku, in the background: "Find the hook"`. A call that
// sets no model says what it falls to, the session's model, unless its type may set one of its own
func callLine(c Call, sessionModel string) string {
	t := c.Type
	if t == "" {
		t = "general-purpose"
	}
	session := "this session's model"
	if sessionModel != "" {
		session = "this session's " + modelName(sessionModel)
	}
	line := "• " + t
	switch {
	case c.Model != "":
		line += " on " + modelName(c.Model)
	case inheritsModel[t] && sessionModel != "":
		line += fmt.Sprintf(" on %s (no model set, so it takes this session's)", modelName(sessionModel))
	case inheritsModel[t]:
		line += " on this session's model (no model set)"
	default:
		line += fmt.Sprintf(" (no model set: its type's own model, or %s)", session)
	}
	if c.Background {
		line += ", in the background"
	}
	if c.Description != "" {
		line += `: "` + c.Description + `"`
	}
	return line
}

// callLines lists the spawn's calls, a line each, the ones past maxCallLines counted
func callLines(calls []Call, sessionModel string) string {
	var lines []string
	for i, c := range calls {
		if i == maxCallLines {
			lines = append(lines, fmt.Sprintf("• and %d more", len(calls)-maxCallLines))
			break
		}
		lines = append(lines, callLine(c, sessionModel))
	}
	return strings.Join(lines, "\n")
}

// sentence starts a clause as a sentence: "about 1.5M tokens" → "About 1.5M tokens"
func sentence(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// approx is a derived percent as the note says it: "~9%", or "<1%" below one
func approx(pct int) string {
	if pct < 1 {
		return "<1%"
	}
	return fmt.Sprintf("~%d%%", pct)
}

// about is a derived percent as the card says it: "about 9%", or "less than 1%"
func about(pct int) string {
	if pct < 1 {
		return "less than 1%"
	}
	return fmt.Sprintf("about %d%%", pct)
}

// sessionParts names the session's known shares, the 5h one first; say spells a percent, fiveHour names the window
func sessionParts(u *SessionUse, say func(int) string, fiveHour string) []string {
	if u == nil {
		return nil
	}
	var parts []string
	if u.FiveHourPct != nil {
		parts = append(parts, say(*u.FiveHourPct)+" of "+fiveHour)
	}
	if u.WeekPct != nil {
		parts = append(parts, say(*u.WeekPct)+" of the week")
	}
	return parts
}

// Note is the log line of a spawn that runs without asking
func Note(s Spawn, p Priced, q Quota) string {
	var b strings.Builder
	verb, rest, _ := strings.Cut(what(s), " ")
	fmt.Fprintf(&b, "Token burn: %s %s, %s", ing(verb), rest, costText(p, false))
	if q.Share != nil {
		fmt.Fprintf(&b, ", %s of the 5h window", approx(*q.Share))
	}
	if q.WeekShare != nil {
		fmt.Fprintf(&b, ", %s of the week", approx(*q.WeekShare))
	}
	b.WriteString(".")
	if parts := sessionParts(q.Session, approx, "5h"); len(parts) > 0 {
		fmt.Fprintf(&b, " This session so far: %s.", strings.Join(parts, ", "))
	}
	return b.String()
}

// "start" → "starting", "run" → "running"
func ing(verb string) string {
	if verb == "run" {
		return "running"
	}
	return verb + "ing"
}

// Question is the card, in up to three paragraphs: what would start (each call on a line of its own, its model
// and task), what it would cost, and where the session and the windows stand. loc is where the reset times are
// read; the caller passes time.Local
func Question(s Spawn, p Priced, q Quota, loc *time.Location) baseds.AgentAskQuestion {
	head := fmt.Sprintf("An agent wants to %s.", what(s))
	if len(s.Calls) > 0 {
		head = fmt.Sprintf("An agent wants to %s:\n%s", what(s), callLines(s.Calls, s.SessionModel))
	}
	var c strings.Builder
	fmt.Fprintf(&c, "%s.", sentence(costText(p, true)))
	if s.Earlier > 0 {
		fmt.Fprintf(&c, " It started %d more in the last few seconds.", s.Earlier)
	}
	if s.ContextTokens > 0 && s.ContextMax > 0 {
		fmt.Fprintf(&c, " Its own context is %s of %s, and each of its further calls re-reads that.",
			FormatTokens(s.ContextTokens), FormatTokens(s.ContextMax))
	}
	var b strings.Builder
	if parts := sessionParts(q.Session, about, "the 5-hour window"); len(parts) > 0 {
		fmt.Fprintf(&b, " This session has used %s so far", strings.Join(parts, " and "))
		if n := q.Session.Subagents; n > 0 {
			fmt.Fprintf(&b, ", its %s included", plural(n, "subagent"))
		}
		b.WriteString(".")
	}
	if q.FiveHourPct != nil {
		fmt.Fprintf(&b, " The 5-hour window is %d%% used", int(math.Round(*q.FiveHourPct)))
		if q.FiveHourReset != nil {
			fmt.Fprintf(&b, " and resets at %s", time.Unix(*q.FiveHourReset, 0).In(loc).Format("15:04"))
		}
		if q.Share != nil {
			fmt.Fprintf(&b, "; this would take %s more", about(*q.Share))
		}
		b.WriteString(".")
	}
	if q.WeekPct != nil {
		fmt.Fprintf(&b, " The week is %d%% used", int(math.Round(*q.WeekPct)))
		if q.WeekReset != nil {
			fmt.Fprintf(&b, " and resets %s", time.Unix(*q.WeekReset, 0).In(loc).Format("Mon 15:04"))
		}
		if q.WeekShare != nil {
			fmt.Fprintf(&b, "; this would take %s of it", about(*q.WeekShare))
		}
		b.WriteString(".")
	}
	paras := []string{head, c.String()}
	if b.Len() > 0 {
		paras = append(paras, strings.TrimPrefix(b.String(), " "))
	}
	return baseds.AgentAskQuestion{
		Header:   "Token burn",
		Question: strings.Join(paras, "\n\n"),
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

// VerdictFor turns the person's choice into the line the mod reads; estimate is the spawn's priced tokens
func VerdictFor(choice int, s Spawn, estimate int64) Verdict {
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
		what(s), FormatTokens(estimate))}
}

// Asking is the hold line while the card waits
func Asking(s Spawn) Hold {
	return Hold{fmt.Sprintf("Token burn: waiting for your answer on arcterm's card before the agent may %s.", what(s))}
}

// LogPath is the estimate log under home: one line per spawn group `wsh tokengate` decided, which
// `wsh tokengate review` (usagestats.ReviewEstimates) reads back
func LogPath(home string) string {
	return filepath.Join(home, ".arc", "tokengate", "estimates.jsonl")
}

// LogLine is one line of the estimate log; usagestats.EstimateLine reads the same JSON
type LogLine struct {
	Ts       int64    `json:"ts"`
	Session  string   `json:"session"`
	Tool     string   `json:"tool"`
	Agents   int      `json:"agents"`
	Types    []string `json:"types"`
	Earlier  int      `json:"earlier,omitempty"`
	Estimate int64    `json:"estimate"`
	Low      int64    `json:"low"`
	High     int64    `json:"high"`
	Verdict  string   `json:"verdict"`
}

// VerdictName is how the log names a verdict: "run" when no card asked, else what the person picked
func VerdictName(v Verdict, asked bool) string {
	switch {
	case !v.Run:
		return "deny"
	case !asked:
		return "run"
	case v.Scope == ScopeTurn:
		return "allow-turn"
	case v.Scope == ScopeSession:
		return "allow-session"
	}
	return "allow"
}

// NewLogLine is the log line for a decided spawn group
func NewLogLine(now time.Time, session string, s Spawn, p Priced, v Verdict, asked bool) LogLine {
	types := s.Types
	if types == nil {
		types = []string{}
	}
	return LogLine{
		Ts:       now.Unix(),
		Session:  session,
		Tool:     s.Tool,
		Agents:   max(s.Agents, 1),
		Types:    types,
		Earlier:  s.Earlier,
		Estimate: p.Estimate,
		Low:      p.Low,
		High:     p.High,
		Verdict:  VerdictName(v, asked),
	}
}

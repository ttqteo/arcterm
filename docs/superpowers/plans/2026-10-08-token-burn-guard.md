# Token burn guard v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** before a Claude Code agent in arcterm runs `Agent`, `Task` or `Workflow`, hold a costly spawn behind a
"Token burn" card (context, 5h window, rough cost; Allow / Allow this turn / Allow this session / Don't spawn);
a cheap one runs at once with a log line. On by default, thresholds in settings.

**Architecture:** the memgate shape. Pure Go `pkg/tokengate` (estimate, rules, card, verdicts) → hidden
`wsh tokengate` (reads settings, quota, window tokens; asks with `AskCommand`) → the Claude mod's `tool.call`
hooks gather parallel spawns into one call and keep the turn's or session's decision. Spec:
`docs/superpowers/specs/2026-10-08-token-burn-guard-design.md`.

**Tech Stack:** Go, cobra (`wsh`), TypeScript Claude Code mod (`claude/arc-mod`), vitest.

**Verify:** `node scripts/verify.mjs ./pkg/tokengate ./cmd/wsh/...`

**Final:** `go test ./pkg/tokengate && go test ./cmd/wsh/cmd -run Tokengate && npx vitest run claude/arc-mod/hooks/tokengate-core.test.ts && claude plugin validate claude/arc-mod`

No view changes: the card is the existing ask card memgate uses, so no CDP scenario applies.

---

### Task 1: `pkg/tokengate`: estimate, rules, card, verdicts

**Depends on:** none

**Files:**
- Create: `pkg/tokengate/tokengate.go`
- Test: `pkg/tokengate/tokengate_test.go`

**Step 1: Write the failing tests**

```go
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
```

**Step 2: Run, expect a build failure**

Run: `go test ./pkg/tokengate`
Expected: FAIL, undefined `Estimate`, `Spawn`, …

**Step 3: Implement**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package tokengate holds a costly spawn (subagents, a workflow) for the person's say before it spends tokens:
// cost grows as context × calls × agents, nearly all of it cache reads. `wsh tokengate` asks; the Claude mod
// calls it before every Agent, Task or Workflow tool call. memgate's twin, for tokens instead of RAM. It asks
// only when a rule says the spawn matters: a card on every spawn trains a reflex Allow.
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
```

**Step 4: Run, expect PASS**

Run: `go test ./pkg/tokengate`
Expected: `ok`

**Step 5: Commit**

```bash
git add pkg/tokengate
git commit -m "feat(tokengate): estimate, rules, card and verdicts for a spawn" -- pkg/tokengate
```

### Task 2: settings keys

**Depends on:** none

**Files:**
- Modify: `pkg/wconfig/settingsconfig.go` (after `UsageInsightsLang`)
- Generated by `task generate`: `pkg/wconfig/metaconsts.go`, `frontend/types/gotypes.d.ts`, and whatever else
  it rewrites (commit it; never hand-edit)

**Step 1: Add the keys**

```go
	TokenGateClear     bool     `json:"tokengate:*,omitempty"`
	TokenGateEnabled   *bool    `json:"tokengate:enabled,omitempty"`   // nil = on: a costly spawn waits on the Token burn card
	TokenGateSharePct  *float64 `json:"tokengate:sharepct,omitempty"`  // ask when a spawn would take this % of the 5h window; nil = 10, 0 = off
	TokenGateWindowPct *float64 `json:"tokengate:windowpct,omitempty"` // ask when the 5h window is this % used; nil = 70, 0 = off
	TokenGateAgents    *int     `json:"tokengate:agents,omitempty"`    // ask when a group starts this many agents; nil = 3, 0 = off
```

**Step 2: Regenerate**

Run: `task generate`
Expected: exit 0; `git status` shows the generated files changed.

**Step 3: Build check**

Run: `go build ./pkg/wconfig ./cmd/wsh`
Expected: exit 0

**Step 4: Commit**

```bash
git add pkg/wconfig frontend/types
git commit -m "feat(settings): tokengate keys" -- pkg/wconfig frontend/types
```

### Task 3: `wsh tokengate`

**Depends on:** Task 1, Task 2

**Files:**
- Create: `cmd/wsh/cmd/wshcmd-tokengate.go`
- Test: `cmd/wsh/cmd/wshcmd-tokengate_test.go`

Reuses `rpcWithContext` (`wshcmd-memgate-decide.go`), `printLine` (`wshcmd-memgate.go`), `resolveBlockArg`,
`statusTarget`, `blockArg`, `askWaitTimeout` and `preRunSetupRpcClient`, as `memgateDecide` does.

**Step 1: Write the failing test** (as memgate's: a done context returns at once, without asking)

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/tokengate"
)

func TestTokengateDecideReturnsPromptlyOnADoneContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	_, err := tokengateDecide(ctx, tokengate.Spawn{Tool: "Agent", Agents: 2}, func(any) { t.Fatal("held a spawn on a done context") })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if time.Since(start) > time.Second {
		t.Fatalf("took %s", time.Since(start))
	}
}
```

Run: `go test ./cmd/wsh/cmd -run TestTokengate`
Expected: FAIL, undefined `tokengateDecide`

**Step 2: Implement**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"fmt"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/tokengate"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const tokengateReadTimeoutMs = 5000

var tokengateSpawn tokengate.Spawn

// the Claude mod runs this before an agent's Agent, Task or Workflow call: hold lines, then one verdict line
// of JSON. Any error exits non-zero with nothing on stdout and the mod lets the spawn run, so a broken gate
// never blocks an agent.
var tokengateCmd = &cobra.Command{
	Use:    "tokengate",
	Short:  "hold a costly subagent or workflow spawn for the person's say (agent hooks)",
	Args:   cobra.NoArgs,
	RunE:   tokengateRun,
	Hidden: true,
}

func init() {
	tokengateCmd.Flags().StringVar(&tokengateSpawn.Tool, "tool", "Agent", "Agent, Task or Workflow")
	tokengateCmd.Flags().IntVar(&tokengateSpawn.Agents, "agents", 1, "agents the group starts")
	tokengateCmd.Flags().BoolVar(&tokengateSpawn.AtLeast, "at-least", false, "the agent count is a floor")
	tokengateCmd.Flags().Int64Var(&tokengateSpawn.ContextTokens, "context-tokens", 0, "the agent's context now")
	tokengateCmd.Flags().Int64Var(&tokengateSpawn.ContextMax, "context-max", 0, "the agent's context window")
	rootCmd.AddCommand(tokengateCmd)
}

func tokengateRun(cmd *cobra.Command, args []string) error {
	verdict, err := tokengateDecide(context.Background(), tokengateSpawn, func(hold any) { _ = printLine(hold) })
	if err != nil {
		return err
	}
	return printLine(verdict)
}

// tokengateQuota reads the 5h window; a failed reading only leaves its numbers unknown
func tokengateQuota(ctx context.Context, estimate int64) tokengate.Quota {
	quota, err := rpcWithContext(ctx, func() (*wshrpc.CommandGetClaudeQuotaRtnData, error) {
		return wshclient.GetClaudeQuotaCommand(RpcClient, &wshrpc.RpcOpts{Timeout: tokengateReadTimeoutMs})
	})
	if err != nil || quota == nil || quota.FiveHourPct == nil {
		return tokengate.Quota{}
	}
	q := tokengate.Quota{FiveHourPct: quota.FiveHourPct, FiveHourReset: quota.FiveHourReset}
	if quota.FiveHourReset == nil {
		return q
	}
	window, err := rpcWithContext(ctx, func() (*wshrpc.CommandGetWindowTokensRtnData, error) {
		return wshclient.GetWindowTokensCommand(RpcClient, wshrpc.CommandGetWindowTokensData{
			FiveHourCutoff: *quota.FiveHourReset - int64((5 * time.Hour).Seconds()),
		}, &wshrpc.RpcOpts{Timeout: tokengateReadTimeoutMs})
	})
	if err == nil && window != nil {
		if share, ok := tokengate.WindowShare(estimate, int64(window.FiveHourTokens), *quota.FiveHourPct); ok {
			q.Share = &share
		}
	}
	return q
}

// tokengateDecide is the decision `wsh tokengate` makes about one spawn group: off, or no rule firing, it runs
// (with a note); otherwise it waits on the person's card. An error is a broken gate, which the mod answers by
// letting the spawn run.
func tokengateDecide(ctx context.Context, s tokengate.Spawn, onHold func(any)) (tokengate.Verdict, error) {
	if err := ctx.Err(); err != nil {
		return tokengate.Verdict{}, err
	}
	if RpcClient == nil {
		if err := preRunSetupRpcClient(nil, nil); err != nil {
			return tokengate.Verdict{}, err
		}
	}
	cfg, err := rpcWithContext(ctx, func() (wconfig.FullConfigType, error) {
		return wshclient.GetFullConfigCommand(RpcClient, &wshrpc.RpcOpts{Timeout: tokengateReadTimeoutMs})
	})
	if err != nil {
		return tokengate.Verdict{}, fmt.Errorf("reading settings: %w", err)
	}
	set := cfg.Settings
	if set.TokenGateEnabled != nil && !*set.TokenGateEnabled {
		return tokengate.Verdict{Run: true}, nil
	}
	quota := tokengateQuota(ctx, tokengate.Estimate(s))
	if !tokengate.Asks(tokengate.RulesFrom(set.TokenGateSharePct, set.TokenGateWindowPct, set.TokenGateAgents), s, quota) {
		return tokengate.Verdict{Run: true, Note: tokengate.Note(s, quota)}, nil
	}

	oref, err := resolveBlockArg()
	if err != nil {
		return tokengate.Verdict{}, fmt.Errorf("resolving block: %w", err)
	}
	if blockArg == "" {
		target, drop := statusTarget(oref)
		if drop {
			return tokengate.Verdict{}, fmt.Errorf("the session runs in the Claude daemon with no arcterm tab attached")
		}
		oref = target
	}
	question := tokengate.Question(s, quota, time.Local)
	onHold(tokengate.Asking(s))
	rtn, err := rpcWithContext(ctx, func() (wshrpc.AskRtnData, error) {
		return wshclient.AskCommand(RpcClient, wshrpc.CommandAskData{
			ORef:      oref.String(),
			Questions: []baseds.AgentAskQuestion{question},
			Wait:      true,
			Hold:      true,
		}, &wshrpc.RpcOpts{Timeout: int64(askWaitTimeout / time.Millisecond)})
	})
	if err != nil {
		return tokengate.Verdict{}, err
	}
	return tokengate.VerdictFor(tokengate.Choice(rtn.Answers, rtn.Cancelled), s), nil
}
```

**Step 3: Run, expect PASS**

Run: `go test ./cmd/wsh/cmd -run 'TestTokengate|TestMemgate'`
Expected: `ok`

**Step 4: Commit**

```bash
git add cmd/wsh/cmd/wshcmd-tokengate.go cmd/wsh/cmd/wshcmd-tokengate_test.go
git commit -m "feat(wsh): tokengate holds a costly spawn behind the person's card" -- cmd/wsh/cmd/wshcmd-tokengate.go cmd/wsh/cmd/wshcmd-tokengate_test.go
```

### Task 4: the mod's pure core

**Depends on:** none

**Files:**
- Create: `claude/arc-mod/hooks/tokengate-core.ts`
- Test: `claude/arc-mod/hooks/tokengate-core.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { decisionAfter, joinGroup, spawnCount, tokengateArgs, tokengateLine } from "./tokengate-core";

describe("spawnCount", () => {
    it("counts one agent per Agent or Task call", () => {
        expect(spawnCount("Agent", { prompt: "x" })).toEqual({ agents: 1, atLeast: false });
        expect(spawnCount("Task", {})).toEqual({ agents: 1, atLeast: false });
    });
    it("counts a workflow's agent( call sites, at least one", () => {
        expect(spawnCount("Workflow", { script: "agent('a'); agent ('b'); subagent('c')" })).toEqual({ agents: 2, atLeast: true });
        expect(spawnCount("Workflow", { script: "phase('x')" })).toEqual({ agents: 1, atLeast: true });
        expect(spawnCount("Workflow", { name: "review" })).toEqual({ agents: 1, atLeast: true });
    });
});

describe("joinGroup", () => {
    it("sums parallel spawns, and any workflow makes the group a workflow", () => {
        const one = { agents: 1, atLeast: false };
        const g = joinGroup(joinGroup(null, "Agent", one), "Agent", one);
        expect(g).toEqual({ tool: "Agent", agents: 2, atLeast: false });
        expect(joinGroup(g, "Workflow", { agents: 3, atLeast: true })).toEqual({ tool: "Workflow", agents: 5, atLeast: true });
    });
});

describe("tokengateArgs", () => {
    it("passes the group, and the context when known", () => {
        expect(tokengateArgs({ tool: "Agent", agents: 2, atLeast: false }, { tokens: 142000.4, window: 200000 })).toEqual([
            "tokengate", "--tool", "Agent", "--agents", "2", "--context-tokens", "142000", "--context-max", "200000",
        ]);
        expect(tokengateArgs({ tool: "Workflow", agents: 1, atLeast: true }, null)).toEqual([
            "tokengate", "--tool", "Workflow", "--agents", "1", "--at-least",
        ]);
    });
});

describe("tokengateLine", () => {
    it("reads holds and verdicts, and nothing else", () => {
        expect(tokengateLine('{"hold":"waiting"}')).toEqual({ hold: "waiting" });
        expect(tokengateLine('{"run":true}')).toEqual({ verdict: { run: true, scope: null, reason: null, note: null } });
        expect(tokengateLine('{"run":true,"note":"Token burn: x"}')).toEqual({ verdict: { run: true, scope: null, reason: null, note: "Token burn: x" } });
        expect(tokengateLine('{"run":true,"scope":"session"}')).toEqual({ verdict: { run: true, scope: "session", reason: null, note: null } });
        expect(tokengateLine('{"run":false,"reason":"Not run: x"}')).toEqual({ verdict: { run: false, scope: null, reason: "Not run: x", note: null } });
        expect(tokengateLine('{"run":true,"scope":"forever"}')).toEqual({ verdict: { run: true, scope: null, reason: null, note: null } });
        expect(tokengateLine('{"run":false}')).toBeNull();
        expect(tokengateLine("garbage")).toBeNull();
    });
});

describe("decisionAfter", () => {
    const v = (run: boolean, scope: "turn" | "session" | null) => ({ run, scope, reason: run ? null : "r", note: null });
    it("keeps a scoped allow and every deny", () => {
        expect(decisionAfter(v(true, null))).toBeNull();
        expect(decisionAfter(v(true, "turn"))).toBe("allow-turn");
        expect(decisionAfter(v(true, "session"))).toBe("allow-session");
        expect(decisionAfter(v(false, null))).toBe("deny-turn");
    });
});
```

Run: `npx vitest run claude/arc-mod/hooks/tokengate-core.test.ts`
Expected: FAIL, cannot resolve `./tokengate-core`

**Step 2: Implement**

```ts
// what `wsh tokengate` says before an agent starts subagents or a workflow: a costly spawn waits for the
// person's say on arcterm's "Token burn" card, a cheap one runs with a note. kept free of the engine so vitest
// can run it; register.ts holds the tool.call hooks, the gathering of parallel spawns and the decision.

export type SpawnTool = "Agent" | "Task" | "Workflow";
export type SpawnCount = { agents: number; atLeast: boolean };
export type Group = { tool: SpawnTool } & SpawnCount;
export type SpawnVerdict = { run: boolean; scope: "turn" | "session" | null; reason: string | null; note: string | null };
export type Decision = "allow-turn" | "allow-session" | "deny-turn" | null;

// a workflow's agents are its agent( call sites, a floor: a loop or parallel() over a list multiplies them.
// one named or read from a file is unknown, so at least one
export function spawnCount(tool: SpawnTool, input: Record<string, unknown>): SpawnCount {
    if (tool !== "Workflow") {
        return { agents: 1, atLeast: false };
    }
    const script = typeof input.script === "string" ? input.script : "";
    const sites = script.match(/\bagent\s*\(/g)?.length ?? 0;
    return { agents: Math.max(1, sites), atLeast: true };
}

// parallel spawns in one message ask on one card
export function joinGroup(g: Group | null, tool: SpawnTool, c: SpawnCount): Group {
    if (!g) {
        return { tool, ...c };
    }
    return {
        tool: g.tool === "Workflow" || tool === "Workflow" ? "Workflow" : g.tool,
        agents: g.agents + c.agents,
        atLeast: g.atLeast || c.atLeast,
    };
}

export function tokengateArgs(g: Group, context: { tokens: number; window: number } | null): string[] {
    const args = ["tokengate", "--tool", g.tool, "--agents", String(g.agents)];
    if (g.atLeast) {
        args.push("--at-least");
    }
    if (context) {
        args.push("--context-tokens", String(Math.round(context.tokens)), "--context-max", String(context.window));
    }
    return args;
}

const filled = (v: unknown): v is string => typeof v === "string" && v !== "";

// one stdout line: a hold to show while the card waits, or the verdict, last. anything else, wsh's errors
// included, is no line at all: a broken gate never blocks an agent
export function tokengateLine(line: string): { hold: string } | { verdict: SpawnVerdict } | null {
    let v: unknown;
    try {
        v = JSON.parse(line);
    } catch {
        return null;
    }
    if (typeof v !== "object" || v === null) {
        return null;
    }
    const o = v as { hold?: unknown; run?: unknown; scope?: unknown; reason?: unknown; note?: unknown };
    if (filled(o.hold)) {
        return { hold: o.hold };
    }
    if (o.run === true) {
        const scope = o.scope === "turn" || o.scope === "session" ? o.scope : null;
        return { verdict: { run: true, scope, reason: null, note: filled(o.note) ? o.note : null } };
    }
    if (o.run === false && filled(o.reason)) {
        return { verdict: { run: false, scope: null, reason: o.reason, note: null } };
    }
    return null;
}

// what the verdict leaves for later spawns: a plain Allow asks again next time; "this turn" and a deny hold
// until the next prompt, "this session" until the session ends
export function decisionAfter(v: SpawnVerdict): Decision {
    if (!v.run) {
        return "deny-turn";
    }
    if (v.scope === "session") {
        return "allow-session";
    }
    return v.scope === "turn" ? "allow-turn" : null;
}
```

**Step 3: Run, expect PASS**

Run: `npx vitest run claude/arc-mod/hooks/tokengate-core.test.ts`
Expected: all pass

**Step 4: Commit**

```bash
git add claude/arc-mod/hooks/tokengate-core.ts claude/arc-mod/hooks/tokengate-core.test.ts
git commit -m "feat(claude-mod): tokengate core: spawn count, args, lines, decision" -- claude/arc-mod/hooks/tokengate-core.ts claude/arc-mod/hooks/tokengate-core.test.ts
```

### Task 5: wire the mod's hooks

**Depends on:** Task 3, Task 4

**Files:**
- Modify: `claude/arc-mod/hooks/register.ts` (imports; module state near `turn`; `askTokengate` and
  `spawnGate` after `ramHold`; the `session.start`, `session.measure` and `classic.UserPromptSubmit` handlers;
  three `tool.call` handlers after the PowerShell one)

**Step 1: Module state and the gate** (after `ramHold`)

```ts
import { decisionAfter, joinGroup, spawnCount, tokengateArgs, tokengateLine } from "./tokengate-core";
import type { Decision, Group, SpawnTool, SpawnVerdict } from "./tokengate-core";

// the person's say on later spawns: until the next prompt (turn) or the session's end, and a deny's reason
let spawnDecision: { kind: Decision; reason: string | null } = { kind: null, reason: null };
// the last context reading, for the card
let lastContext: { tokens: number; window: number } | null = null;
// the open group: parallel spawns arriving while it gathers or waits share its verdict
let pendingSpawn: { group: Group; verdict: Promise<SpawnVerdict> } | null = null;

// parallel Agent calls in one message reach their hooks together; wait this long for the siblings
const GATHER_MS = 400;
const RUN: SpawnVerdict = { run: true, scope: null, reason: null, note: null };

// `wsh tokengate` for one group; a failure of wsh's lets the spawn run
async function askTokengate($: EngineInterface, group: Group): Promise<SpawnVerdict> {
    let verdict = RUN;
    let buffered = "";
    try {
        for await (const chunk of $.process.spawn({ argv: [WSH, ...tokengateArgs(group, lastContext)] })) {
            if (chunk.stream !== "stdout") {
                continue;
            }
            const taken = takeLines(buffered + chunk.text);
            buffered = taken.rest;
            for (const line of taken.lines) {
                const read = tokengateLine(line);
                if (read && "hold" in read) {
                    $.ui.log(`arc: ${read.hold}`);
                } else if (read) {
                    verdict = read.verdict;
                }
            }
        }
    } catch (err) {
        $.ui.log(`arc: wsh tokengate failed: ${String(err)}`, { to: "debug" });
        return RUN;
    }
    if (verdict.note) {
        $.ui.log(`arc: ${verdict.note}`);
    }
    return verdict;
}

// why the spawn does not run; null lets it, always outside arcterm
async function spawnGate($: EngineInterface, tool: SpawnTool, input: Record<string, unknown>): Promise<string | null> {
    if (!active || spawnDecision.kind === "allow-turn" || spawnDecision.kind === "allow-session") {
        return null;
    }
    if (spawnDecision.kind === "deny-turn") {
        return spawnDecision.reason;
    }
    const count = spawnCount(tool, input);
    if (pendingSpawn) {
        pendingSpawn.group = joinGroup(pendingSpawn.group, tool, count);
    } else {
        const open: { group: Group; verdict: Promise<SpawnVerdict> } = { group: joinGroup(null, tool, count), verdict: Promise.resolve(RUN) };
        open.verdict = (async () => {
            await new Promise((resolve) => setTimeout(resolve, GATHER_MS));
            const v = await askTokengate($, open.group);
            const kind = decisionAfter(v);
            if (kind) {
                spawnDecision = { kind, reason: v.reason };
            }
            pendingSpawn = null;
            return v;
        })();
        pendingSpawn = open;
    }
    const mine = pendingSpawn!; // taken before the await: the verdict clears pendingSpawn
    const v = await mine.verdict;
    return v.run ? null : v.reason;
}
```

If the hook runtime has no `setTimeout`, drop the gather wait (one call per spawn; the agent-count rule then
sees 1, "Allow this turn" covers the rest) and say so in the commit message and the spec.

**Step 2: Feed it**

In `session.start`, before `const started = await next(e);`:

```ts
        spawnDecision = { kind: null, reason: null };
```

In `session.measure`, before `return next(e)`:

```ts
        if (e.context.percent != null) {
            lastContext = { tokens: (e.context.percent / 100) * e.context.window, window: e.context.window };
        }
```

In `classic.UserPromptSubmit`, before `return next(e)`:

```ts
        if (spawnDecision.kind !== "allow-session") {
            spawnDecision = { kind: null, reason: null };
        }
```

After the PowerShell `tool.call`:

```ts
    // a costly spawn waits on the person's card; refused in code, as the shell is
    for (const tool of ["Agent", "Task", "Workflow"] as const) {
        on("tool.call", { tool }, async ($, e, next) => {
            const why = await spawnGate($, tool, e as unknown as Record<string, unknown>);
            return why === null ? next(e) : { deny: why };
        });
    }
```

If the engine's types reject a non-literal `tool`, write the three `on(...)` calls out.

**Step 3: Check**

Run: `claude plugin validate claude/arc-mod`
Expected: valid

Run: `npx vitest run claude/arc-mod`
Expected: all pass

Run: `npx eslint claude/arc-mod/hooks/register.ts claude/arc-mod/hooks/tokengate-core.ts`
Expected: no errors

**Step 4: Live check (ask the person first: it starts a few tiny subagents)**

In a Claude agent inside the dev app (whose launch installs the synced mod): (a) "start one Haiku subagent that
answers ok": it runs with no card and an `arc: Token burn: starting 1 subagent…` line; (b) "start three Haiku
subagents in parallel, each answering ok": one card saying 3; Don't spawn refuses all three and the agent
reports it; (c) in a new prompt, the same with Allow this session; a further three-agent spawn later in the
session runs without a card. If (b) shows three cards or none, the hooks ran one after another: note it in the
spec's last paragraph of "Claude mod".

**Step 5: Commit**

```bash
git add claude/arc-mod/hooks/register.ts
git commit -m "feat(claude-mod): hold costly Agent, Task and Workflow calls behind the Token burn card" -- claude/arc-mod/hooks/register.ts
```

### Task 6: docs

**Depends on:** Task 5

**Files:**
- Modify: `CHANGELOG.md` (top `Unreleased` section, `Added`)
- Modify: `docs/deferred.md` (the "(arcterm) Token burn guard" entry; a new memgate entry)
- Modify: `AGENTS.md` (beside the memgate gotcha)

`AGENTS.md` and `docs/deferred.md` may hold other sessions' uncommitted edits: stage only this task's hunks
(write them as a patch and `git apply --cached <patch>`), never the whole file.

**Step 1: CHANGELOG** under `Added`:

```
- Before an agent starts a costly batch of subagents or a workflow, a Token burn card shows its context, the
  5-hour window and a rough cost, and waits for Allow, Allow this turn, Allow this session or Don't spawn. A
  single subagent with room in the window runs without asking. Tune it with the `tokengate:*` settings.
```

**Step 2: deferred.md:** in the Token burn guard entry, mark part (1) shipped (link the spec); parts (2), (3),
calibrating `PerAgentTokens` and exempting engine runs stay deferred. Add an entry:

```
## (arcterm) memgate asks too often on a small Mac (deferred 2026-10-08)

- **What:** on an 8 GB Mac most builds and test suites miss memgate's headroom, so the Low RAM card comes up
  for nearly every heavy command and the person learns to click Run now.
- **Ideas:** wait 30–60 s for RAM before asking (often a build just ended), an "Allow this session" for a job
  kind, and a lower headroom or per-job peaks measured on the machine itself rather than fixed.
- **Pick up** with a brainstorm; the token gate's ask-only-when-it-matters rules
  (`docs/superpowers/specs/2026-10-08-token-burn-guard-design.md`) are the model.
```

**Step 3: AGENTS.md:** after the memgate gotcha add:

```
- **A subagent or workflow spawn can come back "Not run: …".** The Claude mod asks `wsh tokengate` before every
  `Agent`, `Task` or `Workflow` call; a costly one (a big share of the 5h window, a full window, 3+ agents, a
  workflow) waits on a Token burn card. A refusal is the person's call for the rest of that prompt: don't retry
  the spawn; do the work in the session and report it. Rules and estimate are in `pkg/tokengate`.
```

**Step 4: Commit**

```bash
git commit -m "docs: token burn guard v1" -- CHANGELOG.md docs/deferred.md AGENTS.md
```

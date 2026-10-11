# Token burn guard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the Token burn card and note say how much of the 5-hour and weekly windows the asking session has used, its
subagents included, and price a spawn from what finished subagents actually cost instead of a fixed 1.5M.

**Architecture:** v1's shape, one reading wider. A new `usagestats.SessionBurn` counts, in one pass over the Claude
transcripts, both windows' tokens, the session's tokens in them (root transcript plus everything under its
`subagents/` dir), and the mean total of finished subagent transcripts. A new RPC `GetSessionBurnCommand` carries it
to `wsh tokengate`, which replaces v1's `GetWindowTokensCommand` call with it and hands the numbers to a new pure
`tokengate.QuotaFrom`. The Claude mod passes the session's transcript path with `--transcript`.

**Tech Stack:** Go, cobra (`wsh`), TypeScript Claude Code mod (`claude/arc-mod`), vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-token-burn-guard-v2-design.md` (v1:
`docs/superpowers/specs/2026-10-08-token-burn-guard-design.md`)

**Verify:** `node scripts/verify.mjs ./pkg/usagestats ./pkg/tokengate ./pkg/wshrpc/wshserver ./cmd/wsh/...`

**Final:** `go test ./pkg/usagestats -run 'TestSessionBurn|TestParseFiles' && go test ./pkg/tokengate && go test ./cmd/wsh/cmd -run Tokengate && npx vitest run claude/arc-mod/hooks/tokengate-core.test.ts && claude plugin validate claude/arc-mod`

No view changes: the card's text changes, but it is drawn by the existing held card, which v1's `token-burn-card`
scenario already covers with a fixture question. The live check (real subagents) is the person's, as in v1: a session
that ran subagents shows its share and a `session` estimate, a fresh session shows `recent`, and where a Workflow's
agents write their transcripts is recorded in the spec. No task runs it.

## Global Constraints

- Every token count is `WindowTokens`' sum: input + output + reasoning + cache read + cache write, deduped by
  `message.id:requestId`. A session's count and a window's count must use the same sum.
- A number that is unknown is left out of the card and the note, never shown as 0, and the rule that needs it does
  not fire.
- A broken or slow reading never blocks a spawn: a failed `GetSessionBurnCommand` leaves the estimate at
  `PerAgentTokens` ("(rough)") and the shares unknown; the 5 s read timeout of v1 (`tokengateReadTimeoutMs`) stays.
- Per-agent estimate: `session` with ≥ 2 finished subagent files of this session; else `recent` with ≥ 5 finished
  subagent files whose last record is within 14 days; else `default` (`PerAgentTokens`, 1.5M). A file whose last
  record is under 60 s old is still running and is no sample. The mean, not the median.
- New rules: `tokengate:weekpct` (default 80: the week is at least this full) and `tokengate:sessionpct` (default 25:
  this session has used at least this much of the 5h window). nil = the default, 0 = off.
- A window whose percent or reset is unknown gets no shares (a Claude Team seat has no week reading at all).
- HEAD is not formatter-clean: run `gofmt -l` only on files you touched, and never `gofmt -w` a file that was already
  unclean before your change (`pkg/wshrpc/wshrpctypes_agents.go` is). Never hand-edit generated files: change Go, run
  `task generate`.
- Edit `claude/arc-mod/`, never `cmd/wsh/cmd/claude-mod/`: `task sync:claudemod` writes the copy.

## Review Focus

- A session that started days ago: only its records inside each window count, and a turn between the week and 5h
  cutoffs counts for the week only (Task 1 test `TestSessionBurnCountsTheSessionAndItsSubagentsInEachWindow`).
- A spawn from inside a subagent (the path is `<session>/subagents/agent-x.jsonl`) counts the whole session, nested
  subagents included (same Task 1 test, second path).
- A Claude Team seat: no week reading, so every week number is unknown and the week rule is off, while the 5h numbers
  still work (Task 2 test `TestQuotaFrom`, Team seat case).
- wavesrv's count fails or times out (a cold parse cache on the first spawn after a restart reads up to 15 days of
  transcripts): the gate still decides from the quota percents, with the estimate "(rough)" (Task 2 `TestQuotaFrom`
  "not counted" case; Task 4 leaves the spawn's PerAgent at 0 on a failed call).
- A subagent still running when the spawn asks: its partial total is no sample, but it is still the session's
  subagent (Task 1 test `TestSessionBurnPerAgentPrefersTheSessionsOwnFinishedSubagents`).

---

### Task 1: `usagestats.SessionBurn`: the session's and the windows' tokens, and a measured per-agent cost

**Depends on:** none
**Files:** `pkg/usagestats/burn.go`, `pkg/usagestats/burn_test.go`, `pkg/usagestats/usagestats.go`

**Interfaces:**
- Consumes: `walkClaudeFiles`, `cachedFileRecords`, `claudeSessionOf`, `dedupe`, `sumRecordsSinceCutoffs` (all in
  `pkg/usagestats`); test helpers `asstLine`, `writeJSONL`, `testOpus`, `testSonnet` from `sessions_test.go`.
- Produces: `func SessionBurn(path string, fiveHourCutoff, weekCutoff, now time.Time) Burn`;
  `type Burn struct { WindowFiveHour, WindowWeek, SessionFiveHour, SessionWeek, Subagents int; PerAgent int64;
  PerAgentSamples int; PerAgentSource string }`; constants `PerAgentSession = "session"`, `PerAgentRecent =
  "recent"`, `PerAgentDefault = "default"`; `func parseEach(files []scanFile) [][]Record`.

- [ ] **Step 1: Write the failing tests**

Create `pkg/usagestats/burn_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestSessionBurnCountsTheSessionAndItsSubagentsInEachWindow(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	fiveHour, week := now.Add(-5*time.Hour), now.Add(-7*24*time.Hour)
	proj := filepath.Join(root, "proj")
	// the session: a turn in the 5h window, one in the week before it, one before the week
	writeJSONL(t, filepath.Join(proj, "s1.jsonl"),
		asstLine("a1", now.Add(-time.Hour), testOpus, "/w", 100, 0, 0, 0, 0),
		asstLine("a2", now.Add(-24*time.Hour), testOpus, "/w", 10, 0, 0, 0, 0),
		asstLine("a3", now.Add(-10*24*time.Hour), testOpus, "/w", 1, 0, 0, 0, 0),
	)
	// a subagent, and one it spawned, both finished inside the 5h window
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", now.Add(-2*time.Hour), testSonnet, "/w", 1000, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-a", "subagents", "agent-b.jsonl"),
		asstLine("c1", now.Add(-2*time.Hour), testSonnet, "/w", 3000, 0, 0, 0, 0))
	// another session in the same windows
	writeJSONL(t, filepath.Join(proj, "s2.jsonl"),
		asstLine("d1", now.Add(-time.Hour), testOpus, "/w", 50000, 0, 0, 0, 0))

	for _, path := range []string{
		filepath.Join(proj, "s1.jsonl"),
		filepath.Join(proj, "s1", "subagents", "agent-a.jsonl"), // a spawn from inside a subagent counts the whole session
	} {
		b := sessionBurn(root, path, fiveHour, week, now)
		if b.SessionFiveHour != 4100 || b.SessionWeek != 4110 {
			t.Errorf("%s: session 5h/week = %d/%d, want 4100/4110", path, b.SessionFiveHour, b.SessionWeek)
		}
		if b.WindowFiveHour != 54100 || b.WindowWeek != 54110 {
			t.Errorf("%s: window 5h/week = %d/%d, want 54100/54110", path, b.WindowFiveHour, b.WindowWeek)
		}
		if b.Subagents != 2 {
			t.Errorf("%s: subagents = %d, want 2", path, b.Subagents)
		}
	}
}

func TestSessionBurnWithNoPathCountsOnlyTheWindows(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	proj := filepath.Join(root, "proj")
	writeJSONL(t, filepath.Join(proj, "s1.jsonl"), asstLine("a1", now.Add(-time.Hour), testOpus, "/w", 100, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", now.Add(-time.Hour), testSonnet, "/w", 1000, 0, 0, 0, 0))
	b := sessionBurn(root, "", time.Time{}, time.Time{}, now)
	if b.SessionFiveHour != 0 || b.SessionWeek != 0 || b.Subagents != 0 {
		t.Fatalf("no path = %+v, want no session numbers", b)
	}
	if b.WindowFiveHour != 1100 || b.WindowWeek != 1100 {
		t.Fatalf("window 5h/week = %d/%d, want 1100/1100 (zero cutoffs are the trailing windows)", b.WindowFiveHour, b.WindowWeek)
	}
}

func TestSessionBurnPerAgentPrefersTheSessionsOwnFinishedSubagents(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	proj := filepath.Join(root, "proj")
	writeJSONL(t, filepath.Join(proj, "s1.jsonl"), asstLine("a1", now.Add(-time.Hour), testOpus, "/w", 10, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", now.Add(-50*time.Minute), testSonnet, "/w", 600, 0, 0, 0, 0),
		asstLine("b2", now.Add(-49*time.Minute), testSonnet, "/w", 400, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-b.jsonl"),
		asstLine("c1", now.Add(-40*time.Minute), testSonnet, "/w", 3000, 0, 0, 0, 0))
	// still running: its last record is seconds old, so its total is not final
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-c.jsonl"),
		asstLine("d1", now.Add(-10*time.Second), testSonnet, "/w", 99999, 0, 0, 0, 0))
	b := sessionBurn(root, filepath.Join(proj, "s1.jsonl"), time.Time{}, time.Time{}, now)
	// (1000 + 3000) / 2
	if b.PerAgentSource != PerAgentSession || b.PerAgentSamples != 2 || b.PerAgent != 2000 {
		t.Fatalf("per agent = %d over %d (%s), want 2000 over 2 (session)", b.PerAgent, b.PerAgentSamples, b.PerAgentSource)
	}
	if b.Subagents != 3 {
		t.Fatalf("subagents = %d, want 3: a running subagent is still the session's", b.Subagents)
	}
}

func TestSessionBurnPerAgentFallsBackToRecentSubagentsThenToNone(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	proj := filepath.Join(root, "proj")
	// this session has one finished subagent, too few on its own
	writeJSONL(t, filepath.Join(proj, "s1.jsonl"), asstLine("a1", now.Add(-time.Hour), testOpus, "/w", 10, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", now.Add(-time.Hour), testSonnet, "/w", 1000, 0, 0, 0, 0))
	// three finished subagents of another session within 14 days
	for i, id := range []string{"c1", "c2", "c3"} {
		writeJSONL(t, filepath.Join(proj, "s2", "subagents", fmt.Sprintf("agent-%d.jsonl", i)),
			asstLine(id, now.Add(-time.Duration(i+2)*24*time.Hour), testSonnet, "/w", 2000, 0, 0, 0, 0))
	}
	// one that finished 20 days ago is no recent sample, whatever its file's time
	writeJSONL(t, filepath.Join(proj, "s3", "subagents", "agent-old.jsonl"),
		asstLine("e1", now.Add(-20*24*time.Hour), testSonnet, "/w", 900000, 0, 0, 0, 0))
	path := filepath.Join(proj, "s1.jsonl")
	if b := sessionBurn(root, path, time.Time{}, time.Time{}, now); b.PerAgentSource != PerAgentDefault || b.PerAgent != 0 || b.PerAgentSamples != 0 {
		t.Fatalf("4 recent samples = %+v, want the default", b)
	}
	writeJSONL(t, filepath.Join(proj, "s2", "subagents", "agent-9.jsonl"),
		asstLine("c9", now.Add(-time.Hour), testSonnet, "/w", 2000, 0, 0, 0, 0))
	b := sessionBurn(root, path, time.Time{}, time.Time{}, now)
	// (1000 + 4 × 2000) / 5
	if b.PerAgentSource != PerAgentRecent || b.PerAgentSamples != 5 || b.PerAgent != 1800 {
		t.Fatalf("per agent = %d over %d (%s), want 1800 over 5 (recent)", b.PerAgent, b.PerAgentSamples, b.PerAgentSource)
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/usagestats -run TestSessionBurn`
Expected: FAIL to build: `undefined: sessionBurn`, `undefined: PerAgentSession`.

- [ ] **Step 3: Split the per-file parse out of `parseFiles`**

In `pkg/usagestats/usagestats.go`, replace the body of `parseFiles` (keep its doc comment) and add `parseEach` right
above it:

```go
// parseEach reads + parses each transcript concurrently (through parseCache, so an unchanged file is not read
// again), bounded to NumCPU workers, and returns each file's records at its index in files: uncut, and shared with
// the cache, so not to be modified.
func parseEach(files []scanFile) [][]Record {
	workers := runtime.NumCPU()
	if workers < 1 {
		workers = 1
	}
	results := make([][]Record, len(files))
	sem := make(chan struct{}, workers)
	var wg sync.WaitGroup
	for i, f := range files {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, f scanFile) {
			defer wg.Done()
			defer func() { <-sem }()
			results[i] = cachedFileRecords(f)
		}(i, f)
	}
	wg.Wait()
	return results
}
```

```go
func parseFiles(files []scanFile) []Record {
	var records []Record
	for i, recs := range parseEach(files) {
		cutoff := files[i].cutoff
		for _, r := range recs {
			if cutoff.IsZero() || !r.TS.Before(cutoff) {
				records = append(records, r)
			}
		}
	}
	return records
}
```

- [ ] **Step 4: Write `SessionBurn`**

Create `pkg/usagestats/burn.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"path/filepath"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// where a Burn's per-agent cost comes from; pkg/tokengate spells the same three
const (
	PerAgentSession = "session" // this session's finished subagents
	PerAgentRecent  = "recent"  // the finished subagents of the last perAgentRecentDays on this machine
	PerAgentDefault = "default" // too few of either: the caller's own constant
)

const (
	perAgentSessionMin = 2
	perAgentRecentMin  = 5
	perAgentRecentDays = 14
	// a subagent file whose last record is this recent is still running, its total not final
	subagentRunningFor = 60 * time.Second
)

// Burn is what a spawn is weighed by: the Claude tokens the 5h and weekly windows have seen, the part of them one
// session recorded (its subagents included), and what a subagent costs, measured on finished subagent transcripts.
// Every count is WindowTokens' sum, so the session's and the windows' compare.
type Burn struct {
	WindowFiveHour  int
	WindowWeek      int
	SessionFiveHour int
	SessionWeek     int
	Subagents       int   // the session's subagent files with a record inside the week window
	PerAgent        int64 // the samples' mean total; 0 with PerAgentDefault
	PerAgentSamples int
	PerAgentSource  string
}

// SessionBurn reads the Claude transcripts once for a spawn. path is the session's transcript or one of its
// subagents' ("" leaves the session fields 0); a zero cutoff is the trailing window.
func SessionBurn(path string, fiveHourCutoff, weekCutoff, now time.Time) Burn {
	return sessionBurn(filepath.Join(wavebase.GetHomeDir(), ".claude", "projects"), path, fiveHourCutoff, weekCutoff, now)
}

func sessionBurn(root, path string, fiveHourCutoff, weekCutoff, now time.Time) Burn {
	if fiveHourCutoff.IsZero() {
		fiveHourCutoff = now.Add(-5 * time.Hour)
	}
	if weekCutoff.IsZero() {
		weekCutoff = now.Add(-7 * 24 * time.Hour)
	}
	recentCutoff := now.AddDate(0, 0, -perAgentRecentDays)
	earliest := weekCutoff
	if recentCutoff.Before(earliest) {
		earliest = recentCutoff
	}
	session := ""
	if path != "" {
		session, _ = claudeSessionOf(path)
	}

	var b Burn
	var all []Record
	var sessionSum, recentSum int64
	var sessionN, recentN int
	files := walkClaudeFiles(root, earliest.AddDate(0, 0, -1))
	for i, recs := range parseEach(files) {
		all = append(all, recs...)
		owner, sub := claudeSessionOf(files[i].path)
		if !sub || len(recs) == 0 {
			continue
		}
		last := recs[0].TS
		var total int64
		for _, r := range recs {
			if r.TS.After(last) {
				last = r.TS
			}
			total += int64(recordTokens(r))
		}
		mine := session != "" && owner == session
		if mine && !last.Before(weekCutoff) {
			b.Subagents++
		}
		if now.Sub(last) < subagentRunningFor {
			continue
		}
		if mine {
			sessionSum += total
			sessionN++
		}
		if !last.Before(recentCutoff) {
			recentSum += total
			recentN++
		}
	}

	cutoffs := []time.Time{fiveHourCutoff, weekCutoff}
	deduped := dedupe(all)
	windows := sumRecordsSinceCutoffs(deduped, cutoffs)
	b.WindowFiveHour, b.WindowWeek = windows[0], windows[1]
	if session != "" {
		var mineRecs []Record
		for _, r := range deduped {
			if r.Session == session {
				mineRecs = append(mineRecs, r)
			}
		}
		sums := sumRecordsSinceCutoffs(mineRecs, cutoffs)
		b.SessionFiveHour, b.SessionWeek = sums[0], sums[1]
	}

	switch {
	case sessionN >= perAgentSessionMin:
		b.PerAgent, b.PerAgentSamples, b.PerAgentSource = sessionSum/int64(sessionN), sessionN, PerAgentSession
	case recentN >= perAgentRecentMin:
		b.PerAgent, b.PerAgentSamples, b.PerAgentSource = recentSum/int64(recentN), recentN, PerAgentRecent
	default:
		b.PerAgentSource = PerAgentDefault
	}
	return b
}

// recordTokens is one record's tokens as WindowTokens sums them
func recordTokens(r Record) int {
	return r.Input + r.Output + r.Reasoning + r.CacheRead + r.CacheCreate
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `go test ./pkg/usagestats -run 'TestSessionBurn|TestParseFiles|TestWindowTokens|TestScanRoots|TestScanSessionUsage'`
Expected: PASS. Then `gofmt -l pkg/usagestats` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add pkg/usagestats/burn.go pkg/usagestats/burn_test.go pkg/usagestats/usagestats.go
git commit -m "feat(usagestats): SessionBurn counts a session's share of the 5h and weekly windows and a measured per-agent cost"
```

---

### Task 2: `pkg/tokengate`: the week, the session's share, the measured estimate, two rules

**Depends on:** none
**Files:** `pkg/tokengate/tokengate.go`, `pkg/tokengate/tokengate_test.go`, `cmd/wsh/cmd/wshcmd-tokengate.go`

**Interfaces:**
- Consumes: v1's `pkg/tokengate` as it is on `main`; its one caller, `tokengateDecide` in
  `cmd/wsh/cmd/wshcmd-tokengate.go`, which this task keeps building (Task 4 rewrites that part).
- Produces (Task 4 uses all of these):
  - `Spawn` gains `PerAgent int64`, `PerAgentSamples int`, `PerAgentSource string`.
  - `type SessionUse struct { FiveHourPct, WeekPct *int; Subagents int }`.
  - `Quota` gains `WeekPct *float64`, `WeekReset *int64`, `WeekShare *int`, `Session *SessionUse`.
  - `type Reading struct { FiveHourPct, WeekPct *float64; FiveHourReset, WeekReset *int64; Counted bool;
    WindowFiveHour, WindowWeek, SessionFiveHour, SessionWeek int64; Subagents int }`.
  - `func QuotaFrom(r Reading, estimate int64) Quota`, `func SessionShare(sessionTokens, windowTokens int64,
    windowPct float64) (int, bool)`.
  - `Rules` gains `WeekPct, SessionPct float64`; `DefaultRules = Rules{SharePct: 10, WindowPct: 70, Agents: 3,
    WeekPct: 80, SessionPct: 25}`; `func RulesFrom(sharePct, windowPct *float64, agents *int, weekPct, sessionPct
    *float64) Rules`.
  - constants `PerAgentSession`, `PerAgentRecent`, `PerAgentDefault` (same strings as `pkg/usagestats`).

- [ ] **Step 1: Write the failing tests**

In `pkg/tokengate/tokengate_test.go`, replace `TestRulesFromFillsDefaultsAndKeepsZero` and `TestAsks` with these, and
append the new tests below them. Every other v1 test stays as it is and must still pass.

```go
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

func TestEstimateUsesTheMeasuredPerAgentCost(t *testing.T) {
	if got := Estimate(Spawn{Agents: 3, PerAgent: 1_200_000, PerAgentSource: PerAgentSession}); got != 3_600_000 {
		t.Fatalf("3 agents at 1.2M = %d", got)
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

func TestNoteSaysTheMeasuredEstimateTheWeekAndTheSession(t *testing.T) {
	s := Spawn{Tool: "Agent", Agents: 1, PerAgent: 1_200_000, PerAgentSamples: 4, PerAgentSource: PerAgentSession}
	q := Quota{Share: pint(3), WeekShare: pint(0), Session: &SessionUse{FiveHourPct: pint(18), WeekPct: pint(4), Subagents: 4}}
	want := "Token burn: starting 1 subagent, about 1.2M tokens (average of this session's 4), ~3% of the 5h window, " +
		"<1% of the week. This session so far: ~18% of 5h, ~4% of the week."
	if got := Note(s, q); got != want {
		t.Fatalf("note\n%q\nwant\n%q", got, want)
	}
	recent := Spawn{Tool: "Agent", Agents: 2, PerAgent: 900_000, PerAgentSamples: 7, PerAgentSource: PerAgentRecent}
	if got := Note(recent, Quota{}); got != "Token burn: starting 2 subagents, about 1.8M tokens (average of 7 recent)." {
		t.Fatalf("note %q", got)
	}
}

func TestQuestionSaysTheSessionAndTheWeek(t *testing.T) {
	q := Question(
		Spawn{Tool: "Agent", Agents: 3, ContextTokens: 142_000, ContextMax: 200_000,
			PerAgent: 1_200_000, PerAgentSamples: 4, PerAgentSource: PerAgentSession},
		Quota{
			FiveHourPct: f64(62), FiveHourReset: i64(time.Date(2026, 10, 8, 14, 20, 0, 0, time.UTC).Unix()), Share: pint(9),
			WeekPct: f64(31), WeekReset: i64(time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC).Unix()), WeekShare: pint(1),
			Session: &SessionUse{FiveHourPct: pint(18), WeekPct: pint(4), Subagents: 4},
		},
		time.UTC,
	)
	want := "An agent wants to start 3 subagents, about 3.6M tokens (the average of this session's 4 subagents). " +
		"Its own context is 142k of 200k, and each of its further calls re-reads that. " +
		"This session has used about 18% of the 5-hour window and about 4% of the week so far, its 4 subagents included. " +
		"The 5-hour window is 62% used and resets at 14:20; this would take about 9% more. " +
		"The week is 31% used and resets Mon 09:00; this would take about 1% of it."
	if q.Question != want {
		t.Fatalf("question\n%q\nwant\n%q", q.Question, want)
	}
}

func TestQuestionLeavesOutWhatIsUnknownOfTheSessionAndTheWeek(t *testing.T) {
	// a Team seat (no week), a session whose only known share is a sliver of the 5h window, with no subagents
	q := Question(Spawn{Tool: "Agent", Agents: 1}, Quota{FiveHourPct: f64(40), Session: &SessionUse{FiveHourPct: pint(0)}}, time.UTC)
	want := "An agent wants to start 1 subagent, about 1.5M tokens (rough). " +
		"This session has used less than 1% of the 5-hour window so far. The 5-hour window is 40% used."
	if q.Question != want {
		t.Fatalf("question\n%q\nwant\n%q", q.Question, want)
	}
	recent := Spawn{Tool: "Agent", Agents: 2, PerAgent: 900_000, PerAgentSamples: 7, PerAgentSource: PerAgentRecent}
	if got := Question(recent, Quota{}, time.UTC).Question; got != "An agent wants to start 2 subagents, about 1.8M tokens (the average of 7 recent subagents)." {
		t.Fatalf("question %q", got)
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/tokengate`
Expected: FAIL to build: `too many arguments in call to RulesFrom`, `unknown field WeekPct`, `undefined: QuotaFrom`.

- [ ] **Step 3: Rewrite `pkg/tokengate/tokengate.go`**

Replace the whole file with this. `Choice`, `VerdictFor`, `Asking`, `Verdict`, `Hold`, the option and scope constants,
`FormatTokens`, `plural`, `what` and `ing` are v1's, unchanged.

```go
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

// PerAgentTokens is a subagent's typical run when nothing measured says otherwise: ~30 tool calls at a ~50k
// average context, nearly all cache reads. A Spawn's PerAgent, measured on finished subagent transcripts, wins.
const PerAgentTokens int64 = 1_500_000

// below this much of a window used, tokens/pct is too small a sample to give the window's size
const minPctForShare = 5.0

// where a Spawn's PerAgent comes from; pkg/usagestats spells the same three
const (
	PerAgentSession = "session"
	PerAgentRecent  = "recent"
	PerAgentDefault = "default"
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
	Tool          string // Agent, Task or Workflow; a group with any Workflow is Workflow
	Agents        int
	AtLeast       bool // a workflow's agent count is a floor: loops multiply it
	ContextTokens int64
	ContextMax    int64
	// one agent's measured cost and what it was measured on; PerAgent 0 is PerAgentTokens
	PerAgent        int64
	PerAgentSamples int
	PerAgentSource  string
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

// Estimate is the group's tokens: its agents, at least one, at the measured per-agent cost or PerAgentTokens
func Estimate(s Spawn) int64 {
	per := s.PerAgent
	if per <= 0 {
		per = PerAgentTokens
	}
	return int64(max(s.Agents, 1)) * per
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
	case r.Agents > 0 && s.Agents >= r.Agents:
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
	if s.AtLeast {
		return "start at least " + plural(n, "subagent")
	}
	return "start " + plural(n, "subagent")
}

// basis says what the estimate rests on: "(rough)" for the constant, else what it is the average of. short is the
// note's spelling
func basis(s Spawn, short bool) string {
	if s.PerAgent <= 0 || (s.PerAgentSource != PerAgentSession && s.PerAgentSource != PerAgentRecent) {
		return "(rough)"
	}
	switch {
	case s.PerAgentSource == PerAgentSession && short:
		return fmt.Sprintf("(average of this session's %d)", s.PerAgentSamples)
	case s.PerAgentSource == PerAgentSession:
		return fmt.Sprintf("(the average of this session's %d subagents)", s.PerAgentSamples)
	case short:
		return fmt.Sprintf("(average of %d recent)", s.PerAgentSamples)
	}
	return fmt.Sprintf("(the average of %d recent subagents)", s.PerAgentSamples)
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
func Note(s Spawn, q Quota) string {
	var b strings.Builder
	verb, rest, _ := strings.Cut(what(s), " ")
	fmt.Fprintf(&b, "Token burn: %s %s, about %s tokens %s", ing(verb), rest, FormatTokens(Estimate(s)), basis(s, true))
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

// Question is the card. loc is where the reset times are read; the caller passes time.Local
func Question(s Spawn, q Quota, loc *time.Location) baseds.AgentAskQuestion {
	var b strings.Builder
	fmt.Fprintf(&b, "An agent wants to %s, about %s tokens %s.", what(s), FormatTokens(Estimate(s)), basis(s, false))
	if s.ContextTokens > 0 && s.ContextMax > 0 {
		fmt.Fprintf(&b, " Its own context is %s of %s, and each of its further calls re-reads that.",
			FormatTokens(s.ContextTokens), FormatTokens(s.ContextMax))
	}
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

- [ ] **Step 4: Run the tests to see them pass**

Run: `go test ./pkg/tokengate`
Expected: PASS, v1's tests included (`TestNote`, `TestQuestionSaysEveryKnownNumber` and
`TestQuestionLeavesOutUnknownNumbers` keep their exact v1 strings). Then `gofmt -l pkg/tokengate` prints nothing.

- [ ] **Step 5: Keep `wsh` building**

`RulesFrom` takes five arguments now, and the engine verifies `cmd/wsh` at this task's merge. In
`cmd/wsh/cmd/wshcmd-tokengate.go`, in `tokengateDecide`, pass the two new rules as unset (their settings keys arrive in
Task 3, and Task 4 replaces this line):

```go
	if !tokengate.Asks(tokengate.RulesFrom(set.TokenGateSharePct, set.TokenGateWindowPct, set.TokenGateAgents, nil, nil), s, quota) {
```

Change nothing else in that file. Run: `go build ./cmd/wsh/... && go test ./cmd/wsh/cmd -run Tokengate`
Expected: success and PASS.

- [ ] **Step 6: Commit**

```bash
git add pkg/tokengate/tokengate.go pkg/tokengate/tokengate_test.go cmd/wsh/cmd/wshcmd-tokengate.go
git commit -m "feat(tokengate): the week, the session's share of each window, a measured per-agent estimate, two rules"
```

---

### Task 3: the `GetSessionBurnCommand` RPC and the two settings keys

**Depends on:** Task 1
**Files:** `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `pkg/wconfig/settingsconfig.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wconfig/metaconsts.go`, `schema/settings.json`

**Interfaces:**
- Consumes: `usagestats.SessionBurn(path string, fiveHourCutoff, weekCutoff, now time.Time) usagestats.Burn`
  (Task 1); `cutoffFromEpoch` in `wshserver_agents.go`.
- Produces (Task 4 uses all of these): `wshclient.GetSessionBurnCommand(w *wshutil.WshRpc, data
  wshrpc.CommandGetSessionBurnData, opts *wshrpc.RpcOpts) (*wshrpc.CommandGetSessionBurnRtnData, error)`;
  `wshrpc.CommandGetSessionBurnData{Path string; FiveHourCutoff, WeekCutoff int64}`;
  `wshrpc.CommandGetSessionBurnRtnData{WindowFiveHour, WindowWeek, SessionFiveHour, SessionWeek, Subagents int;
  PerAgent int64; PerAgentSamples int; PerAgentSource string}`; settings fields `TokenGateWeekPct *float64` and
  `TokenGateSessionPct *float64` on `wconfig.SettingsType`.

- [ ] **Step 1: Declare the command and its types**

In `pkg/wshrpc/wshrpctypes_agents.go`, add the method to the interface on the line right after
`GetWindowTokensCommand(...)`:

```go
	GetSessionBurnCommand(ctx context.Context, data CommandGetSessionBurnData) (*CommandGetSessionBurnRtnData, error) // a spawn's weighing for the Token burn card: both windows, one session's share, a measured per-agent cost
```

and the two types right after `CommandGetWindowTokensRtnData`:

```go
type CommandGetSessionBurnData struct {
	Path           string `json:"path,omitempty"`           // the session's transcript, or one of its subagents'; "" = no session
	FiveHourCutoff int64  `json:"fivehourcutoff,omitempty"` // epoch seconds; 0 = the trailing 5 hours (not all-time, unlike GetWindowTokens)
	WeekCutoff     int64  `json:"weekcutoff,omitempty"`     // epoch seconds; 0 = the trailing 7 days
}

// usagestats.Burn on the wire: WindowTokens' sums for both windows and for the session inside them, its subagents
// included, and the mean total of finished subagent transcripts (source "session", "recent" or "default", 0 tokens)
type CommandGetSessionBurnRtnData struct {
	WindowFiveHour  int    `json:"windowfivehour"`
	WindowWeek      int    `json:"windowweek"`
	SessionFiveHour int    `json:"sessionfivehour"`
	SessionWeek     int    `json:"sessionweek"`
	Subagents       int    `json:"subagents"`
	PerAgent        int64  `json:"peragent"`
	PerAgentSamples int    `json:"peragentsamples"`
	PerAgentSource  string `json:"peragentsource"`
}
```

This file was not gofmt-clean before the change; do not `gofmt -w` it.

- [ ] **Step 2: Serve it**

In `pkg/wshrpc/wshserver/wshserver_agents.go`, add right after `GetWindowTokensCommand`:

```go
func (ws *WshServer) GetSessionBurnCommand(ctx context.Context, data wshrpc.CommandGetSessionBurnData) (*wshrpc.CommandGetSessionBurnRtnData, error) {
	b := usagestats.SessionBurn(data.Path, cutoffFromEpoch(data.FiveHourCutoff), cutoffFromEpoch(data.WeekCutoff), time.Now())
	return &wshrpc.CommandGetSessionBurnRtnData{
		WindowFiveHour:  b.WindowFiveHour,
		WindowWeek:      b.WindowWeek,
		SessionFiveHour: b.SessionFiveHour,
		SessionWeek:     b.SessionWeek,
		Subagents:       b.Subagents,
		PerAgent:        b.PerAgent,
		PerAgentSamples: b.PerAgentSamples,
		PerAgentSource:  b.PerAgentSource,
	}, nil
}
```

(`cutoffFromEpoch(0)` is the zero time, which `SessionBurn` reads as the trailing window.)

- [ ] **Step 3: Add the settings keys**

In `pkg/wconfig/settingsconfig.go`, right after the `TokenGateAgents` line:

```go
	TokenGateWeekPct    *float64 `json:"tokengate:weekpct,omitempty"`    // ask when the weekly window is this % used; nil = 80, 0 = off
	TokenGateSessionPct *float64 `json:"tokengate:sessionpct,omitempty"` // ask when the asking session has used this % of the 5h window; nil = 25, 0 = off
```

then `gofmt -w pkg/wconfig/settingsconfig.go` (it was clean), which realigns the tokengate block.

- [ ] **Step 4: Regenerate**

Run: `task generate`
Expected: `pkg/wshrpc/wshclient/wshclient.go` gains `GetSessionBurnCommand`, `frontend/app/store/wshclientapi.ts`
gains `GetSessionBurnCommand` (command `"getsessionburn"`), `frontend/types/gotypes.d.ts` gains both types and the
two `tokengate:` keys, `pkg/wconfig/metaconsts.go` gains `ConfigKey_TokenGateWeekPct` and
`ConfigKey_TokenGateSessionPct`, `schema/settings.json` gains both keys as numbers. Check with `git diff --stat`;
nothing else in the generated files may change. Never edit them by hand.

- [ ] **Step 5: Build**

Run: `go build ./pkg/wshrpc/... ./pkg/wconfig/... ./cmd/server/...`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add pkg/wshrpc/wshrpctypes_agents.go pkg/wshrpc/wshserver/wshserver_agents.go pkg/wconfig/settingsconfig.go \
  pkg/wshrpc/wshclient/wshclient.go frontend/app/store/wshclientapi.ts frontend/types/gotypes.d.ts \
  pkg/wconfig/metaconsts.go schema/settings.json
git commit -m "feat(wshrpc): GetSessionBurn carries a session's share of the windows and a measured per-agent cost; tokengate week and session keys"
```

---

### Task 4: `wsh tokengate` reads the session's burn

**Depends on:** Task 2, Task 3
**Files:** `cmd/wsh/cmd/wshcmd-tokengate.go`, `cmd/wsh/cmd/wshcmd-tokengate_test.go`

**Interfaces:**
- Consumes: `tokengate.Reading`, `tokengate.QuotaFrom`, `tokengate.Estimate`, the five-argument `tokengate.RulesFrom`,
  `Spawn.PerAgent/PerAgentSamples/PerAgentSource` (Task 2); `wshclient.GetSessionBurnCommand`,
  `wshrpc.CommandGetSessionBurnData`, `wshrpc.CommandGetSessionBurnRtnData`, `SettingsType.TokenGateWeekPct`,
  `SettingsType.TokenGateSessionPct` (Task 3).
- Produces: the hidden flag `--transcript <path>` on `wsh tokengate` (Task 5 passes it);
  `func tokengateDecide(ctx context.Context, s tokengate.Spawn, transcript string, onHold func(any)) (tokengate.Verdict, error)`.

- [ ] **Step 1: Write the failing test**

In `cmd/wsh/cmd/wshcmd-tokengate_test.go`, change the call in `TestTokengateDecideReturnsPromptlyOnADoneContext` to
pass an empty transcript:

```go
	_, err := tokengateDecide(ctx, tokengate.Spawn{Tool: "Agent", Agents: 2}, "", func(any) { t.Fatal("held a spawn on a done context") })
```

and append:

```go
func TestTokengateTakesTheSessionsTranscript(t *testing.T) {
	if f := tokengateCmd.Flags().Lookup("transcript"); f == nil || f.DefValue != "" {
		t.Fatalf("--transcript flag = %+v", f)
	}
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `go test ./cmd/wsh/cmd -run Tokengate`
Expected: FAIL to build: `too many arguments in call to tokengateDecide`.

- [ ] **Step 3: Read the burn in `wsh tokengate`**

In `cmd/wsh/cmd/wshcmd-tokengate.go`:

Below `var tokengateSpawn tokengate.Spawn` add:

```go
// the asking session's transcript, which the Claude mod passes; "" leaves the session's share unknown
var tokengateTranscript string
```

In `init()`, after the `--context-max` flag:

```go
	tokengateCmd.Flags().StringVar(&tokengateTranscript, "transcript", "", "the asking session's transcript")
```

In `tokengateRun`, pass it:

```go
	verdict, err := tokengateDecide(context.Background(), tokengateSpawn, tokengateTranscript, func(hold any) { _ = out.Encode(hold) })
```

Replace the whole `tokengateQuota` function with:

```go
// tokengateRead reads the quota and wavesrv's token counts for a spawn, and gives the spawn its measured per-agent
// cost. A failed reading only leaves its numbers unknown, and the estimate at PerAgentTokens
func tokengateRead(ctx context.Context, s tokengate.Spawn, transcript string) (tokengate.Spawn, tokengate.Quota) {
	var r tokengate.Reading
	data := wshrpc.CommandGetSessionBurnData{Path: transcript}
	quota, err := rpcWithContext(ctx, func() (*wshrpc.CommandGetClaudeQuotaRtnData, error) {
		return wshclient.GetClaudeQuotaCommand(RpcClient, &wshrpc.RpcOpts{Timeout: tokengateReadTimeoutMs})
	})
	if err == nil && quota != nil {
		r.FiveHourPct, r.FiveHourReset = quota.FiveHourPct, quota.FiveHourReset
		r.WeekPct, r.WeekReset = quota.WeekPct, quota.WeekReset
		if quota.FiveHourReset != nil {
			data.FiveHourCutoff = *quota.FiveHourReset - int64((5 * time.Hour).Seconds())
		}
		if quota.WeekReset != nil {
			data.WeekCutoff = *quota.WeekReset - int64((7 * 24 * time.Hour).Seconds())
		}
	}
	burn, err := rpcWithContext(ctx, func() (*wshrpc.CommandGetSessionBurnRtnData, error) {
		return wshclient.GetSessionBurnCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: tokengateReadTimeoutMs})
	})
	if err == nil && burn != nil {
		s.PerAgent, s.PerAgentSamples, s.PerAgentSource = burn.PerAgent, burn.PerAgentSamples, burn.PerAgentSource
		r.Counted = true
		r.WindowFiveHour, r.WindowWeek = int64(burn.WindowFiveHour), int64(burn.WindowWeek)
		r.SessionFiveHour, r.SessionWeek = int64(burn.SessionFiveHour), int64(burn.SessionWeek)
		r.Subagents = burn.Subagents
	}
	return s, tokengate.QuotaFrom(r, tokengate.Estimate(s))
}
```

Change `tokengateDecide`'s signature and its two quota lines:

```go
func tokengateDecide(ctx context.Context, s tokengate.Spawn, transcript string, onHold func(any)) (tokengate.Verdict, error) {
```

```go
	s, quota := tokengateRead(ctx, s, transcript)
	rules := tokengate.RulesFrom(set.TokenGateSharePct, set.TokenGateWindowPct, set.TokenGateAgents, set.TokenGateWeekPct, set.TokenGateSessionPct)
	if !tokengate.Asks(rules, s, quota) {
		return tokengate.Verdict{Run: true, Note: tokengate.Note(s, quota)}, nil
	}
```

(replacing `quota := tokengateQuota(ctx, tokengate.Estimate(s))` and the `if !tokengate.Asks(tokengate.RulesFrom(...` block).
The rest of `tokengateDecide` already uses `s`, which now carries the measured cost into `Question`, `Asking` and the
deny reason.

- [ ] **Step 4: Run the tests to see them pass**

Run: `go test ./cmd/wsh/cmd -run Tokengate && go build ./cmd/wsh/...`
Expected: PASS and a clean build. Then `gofmt -l cmd/wsh/cmd/wshcmd-tokengate.go cmd/wsh/cmd/wshcmd-tokengate_test.go`
prints nothing.

- [ ] **Step 5: Commit**

```bash
git add cmd/wsh/cmd/wshcmd-tokengate.go cmd/wsh/cmd/wshcmd-tokengate_test.go
git commit -m "feat(wsh): tokengate weighs a spawn by the session's share of both windows and a measured per-agent cost"
```

---

### Task 5: the Claude mod passes the session's transcript

**Depends on:** none
**Files:** `claude/arc-mod/hooks/tokengate-core.ts`, `claude/arc-mod/hooks/tokengate-core.test.ts`, `claude/arc-mod/hooks/register.ts`, `cmd/wsh/cmd/claude-mod/hooks/tokengate-core.ts`, `cmd/wsh/cmd/claude-mod/hooks/register.ts`

**Interfaces:**
- Consumes: `wsh tokengate --transcript <path>` (Task 4; until it lands an unknown flag makes wsh exit non-zero, which
  the mod already answers by letting the spawn run).
- Produces: `tokengateArgs(g: Group, context: { tokens: number; window: number } | null, transcript: string | null = null): string[]`.

- [ ] **Step 1: Write the failing test**

In `claude/arc-mod/hooks/tokengate-core.test.ts`, add inside `describe("tokengateArgs", ...)`:

```ts
    it("passes the session's transcript when known", () => {
        expect(tokengateArgs({ tool: "Agent", agents: 1, atLeast: false }, null, "/h/.claude/projects/p/s1.jsonl")).toEqual([
            "tokengate", "--tool", "Agent", "--agents", "1", "--transcript", "/h/.claude/projects/p/s1.jsonl",
        ]);
        expect(tokengateArgs({ tool: "Agent", agents: 1, atLeast: false }, null, null)).toEqual([
            "tokengate", "--tool", "Agent", "--agents", "1",
        ]);
    });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run claude/arc-mod/hooks/tokengate-core.test.ts`
Expected: FAIL on the new case (no `--transcript` in the args).

- [ ] **Step 3: Pass the path**

In `claude/arc-mod/hooks/tokengate-core.ts`, replace `tokengateArgs` with:

```ts
// the session's transcript lets wsh read what this session, its subagents included, has used of each window
export function tokengateArgs(
    g: Group,
    context: { tokens: number; window: number } | null,
    transcript: string | null = null,
): string[] {
    const args = ["tokengate", "--tool", g.tool, "--agents", String(g.agents)];
    if (g.atLeast) {
        args.push("--at-least");
    }
    if (context) {
        args.push("--context-tokens", String(Math.round(context.tokens)), "--context-max", String(context.window));
    }
    if (transcript) {
        args.push("--transcript", transcript);
    }
    return args;
}
```

In `claude/arc-mod/hooks/register.ts`, in `askTokengate`, pass the path the `classic.UserPromptSubmit` hook already
keeps in `transcriptPath`:

```ts
        for await (const chunk of $.process.spawn({ argv: [WSH, ...tokengateArgs(group, lastContext, transcriptPath)] })) {
```

- [ ] **Step 4: Sync the embedded copy and check**

Run: `task sync:claudemod && npx vitest run claude/arc-mod/hooks/tokengate-core.test.ts && claude plugin validate claude/arc-mod`
Expected: the copies under `cmd/wsh/cmd/claude-mod/hooks/` match the sources (no test file copied), vitest PASS,
validate passes. Then `npx prettier --check claude/arc-mod/hooks/tokengate-core.ts claude/arc-mod/hooks/register.ts`.

- [ ] **Step 5: Commit**

```bash
git add claude/arc-mod/hooks/tokengate-core.ts claude/arc-mod/hooks/tokengate-core.test.ts claude/arc-mod/hooks/register.ts \
  cmd/wsh/cmd/claude-mod/hooks/tokengate-core.ts cmd/wsh/cmd/claude-mod/hooks/register.ts
git commit -m "feat(claude-mod): the Token burn gate passes the session's transcript to wsh tokengate"
```

---

### Task 6: docs

**Depends on:** Task 4, Task 5
**Files:** `CHANGELOG.md`, `docs/guide/settings.md`, `docs/deferred.md`, `docs/open-issues.md`

**Interfaces:**
- Consumes: the setting names and defaults of Task 3 (`tokengate:weekpct` 80, `tokengate:sessionpct` 25).
- Produces: nothing code reads.

- [ ] **Step 1: CHANGELOG**

In `CHANGELOG.md`, add as the first entry under `### Changed` of the top `## Unreleased` section (open
`## Unreleased` above a dated top section if the top one has a date):

```markdown
- The Token burn card says how much of the 5-hour and weekly windows the agent's session has used so far, its
  subagents included, and prices a spawn from what this session's subagents (or recent ones) actually cost instead
  of a fixed guess. It also asks when the week is 80% used (`tokengate:weekpct`) or the session has used 25% of the
  5-hour window (`tokengate:sessionpct`).
```

- [ ] **Step 2: Settings guide**

In `docs/guide/settings.md`, replace the line that starts `- **Thẻ Token burn**` with:

```markdown
- **Thẻ Token burn** (`tokengate:enabled`, `tokengate:sharepct`, `tokengate:windowpct`, `tokengate:agents`, `tokengate:weekpct`, `tokengate:sessionpct`): trước khi một agent Claude chạy `Agent`, `Task` hay `Workflow`, arcterm hiện thẻ **Token burn** trên terminal của nó khi lần spawn sẽ tốn từ `tokengate:sharepct` % cửa sổ 5 giờ (mặc định 10), khi cửa sổ đã dùng từ `tokengate:windowpct` % (mặc định 70), khi cửa sổ tuần đã dùng từ `tokengate:weekpct` % (mặc định 80), khi chính session đó, tính cả subagent của nó, đã dùng từ `tokengate:sessionpct` % cửa sổ 5 giờ (mặc định 25), khi nhóm khởi chạy từ `tokengate:agents` agent cùng lúc (mặc định 3), hoặc khi đó là một Workflow. Chi phí mỗi agent lấy trung bình các subagent đã chạy xong của session đó, không đủ thì của các subagent gần đây trên máy. Đặt một ngưỡng là `0` để tắt quy tắc đó; `tokengate:enabled` = `false` tắt hẳn thẻ. Không có thẻ trong Settings: ghi vào `settings.json`.
```

- [ ] **Step 3: deferred.md**

In `docs/deferred.md`, entry "(arcterm) Token burn guard":

Replace

```markdown
  — **shipped** (`docs/superpowers/specs/2026-10-08-token-burn-guard-design.md`: `pkg/tokengate`, `wsh tokengate`,
  the Claude mod's `tool.call` gate); (2) a burn alert:
```

with

```markdown
  — **shipped** (`docs/superpowers/specs/2026-10-08-token-burn-guard-design.md`: `pkg/tokengate`, `wsh tokengate`,
  the Claude mod's `tool.call` gate; v2, `docs/superpowers/specs/2026-10-11-token-burn-guard-v2-design.md`: the
  session's share of the 5h and weekly windows, subagents included, and a per-agent cost measured on finished
  subagent transcripts); (2) a burn alert:
```

and replace the **Still deferred** bullet with:

```markdown
- **Still deferred:** parts (2) and (3); a whole-run cost estimate at plan submit (a decision in
  `docs/superpowers/specs/2026-10-07-quota-guard-design.md`), calibrated per task from workers' transcripts the way
  v2 measures a subagent; and exempting engine runs from the gate. The live check (real subagents) is chunk 1 of the
  effort "Token burn guard: follow-ups" (`1dce9cf9-1464-456b-831c-7c5d13a12fc9`), due 2026-10-14; v2's joins it: a
  session that ran subagents shows its share and a `session` estimate, a fresh one shows `recent`, and where a
  Workflow's agents write their transcripts goes into the v2 spec.
```

- [ ] **Step 4: open-issues.md**

In `docs/open-issues.md`, in the "(arcterm) Token burn guard part (1) shipped" row, replace `calibrating
\`PerAgentTokens\`` with `a whole-run cost estimate at plan submit`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md docs/guide/settings.md docs/deferred.md docs/open-issues.md
git commit -m "docs: token burn guard v2"
```

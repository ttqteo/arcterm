# Token burn guard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** price a spawn from what finished subagents of the same type actually cost (with a range), add the weekly
window and the session's own share to the Token burn card, show those numbers in Usage, and log every estimate so
`wsh tokengate review` can say a week later how far off they were.

**Architecture:** `pkg/usagestats` measures (subagent costs by type from transcripts and their `.meta.json`, the
session's and the windows' tokens, per-session window tokens for Usage, the review). New RPCs carry it: the gate's
`GetSessionBurnCommand`, Usage's `GetSubagentCostsCommand` and wider `GetSessionUsageCommand`, and
`ReviewTokenEstimatesCommand`. The pure `pkg/tokengate` prices and words it; `wsh tokengate` reads, decides, logs,
and reviews; the Claude mod passes each agent's `subagent_type` and the session's transcript.

**Tech Stack:** Go, cobra (`wsh`), TypeScript Claude Code mod (`claude/arc-mod`), React 19 + Tailwind 4 + jotai,
vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-11-token-burn-guard-v2-design.md` (v1:
`docs/superpowers/specs/2026-10-08-token-burn-guard-design.md`)

**Verify:** `node scripts/verify.mjs ./pkg/usagestats ./pkg/tokengate ./pkg/wshrpc/wshserver ./cmd/wsh/...`

**Final:** `{ go test ./pkg/usagestats -run 'TestSubagentCosts|TestNearestRank|TestSessionBurn|TestScanSessionWindows|TestReviewEstimates|TestParseFiles' && go test ./pkg/tokengate && go test ./cmd/wsh/cmd -run 'Tokengate|SplitTypes' && npx vitest run claude/arc-mod/hooks/tokengate-core.test.ts frontend/app/view/agents/usagesessions.test.ts frontend/app/view/agents/subagentcosts.test.ts && claude plugin validate claude/arc-mod; } || exit 1; if [ "$(uname -s)" = Darwin ]; then echo "unverified: usage-token-burn and usage-insights need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs usage-token-burn usage-insights`

One view changes: Usage's Claude tab. Task 7 adds the **5h** and **Wk** columns to By session and the **Subagent
cost** card under it, and its `usage-token-burn` scenario shows both; `usage-insights` reruns because the By session
grid changed. The Token burn card's words change, but the card is drawn by the existing held card (v1's
`token-burn-card` scenario, a fixture question). The live check (real subagents) is the person's, chunk 1 of the
effort "Token burn guard: follow-ups"; the week-later review is its chunk 3, due 2026-10-19. No task runs either.

## Global Constraints

- Every token count is `WindowTokens`' sum: input + output + reasoning + cache read + cache write, deduped by
  `message.id:requestId`. A session's count, a window's count and a subagent's total all use it.
- Subagent samples: transcripts under `~/.claude/projects/*/*/subagents/` (nested included), finished (last record
  ≥ 60 s old), last record within 30 days; type from `agentType` in the `.meta.json` beside the file, else `unknown`;
  per type: samples, mean, p25, p90 (nearest rank), plus an `all` row last.
- An agent is priced from its type's row with ≥ 3 samples, else the `all` row with ≥ 5, else `PerAgentTokens` (1.5M)
  with no range. An Agent/Task call's type is its `subagent_type`, `general-purpose` when absent; a Workflow's agents
  have none. A group's estimate is the sum of means; its range the sums of p25 and p90, only when every agent was
  priced from a row.
- A number that is unknown is left out of the card, the note and Usage (`—`), never shown as 0, and the rule that
  needs it does not fire. A window whose percent or reset is unknown gets no shares (a Claude Team seat has no week).
- New rules: `tokengate:weekpct` (default 80) and `tokengate:sessionpct` (default 25); nil = the default, 0 = off.
- A broken or slow reading never blocks a spawn; v1's 5 s read timeout (`tokengateReadTimeoutMs`) stays. A failed log
  write is ignored. The log is `~/.arc/tokengate/estimates.jsonl` (`tokengate.LogPath(home)`).
- HEAD is not formatter-clean: run `gofmt -l` only on files you touched, and never `gofmt -w` a file that was unclean
  before your change (`pkg/wshrpc/wshrpctypes_agents.go` is). Never hand-edit generated files: change Go, run
  `task generate`. Edit `claude/arc-mod/`, never `cmd/wsh/cmd/claude-mod/` (`task sync:claudemod` writes it). Never run
  prettier on `scripts/*.mjs`. Colors come from the `@theme` tokens, never raw hex.

## Review Focus

- A session that started days ago: only its records inside each window count, and a turn between the week and 5h
  cutoffs counts for the week only (Task 1 `TestSessionBurnCountsTheSessionAndItsSubagentsInEachWindow`).
- A spawn from inside a subagent (`<session>/subagents/agent-x.jsonl`) counts the whole session, nested subagents
  included (same test, second path).
- A subagent still running, or one that finished more than 30 days ago, is no sample; a subagent with no meta file
  is `unknown`, not dropped (Task 1 `TestSubagentCostsByType`).
- A Claude Team seat: no week reading, so every week number is unknown and the week rule is off while the 5h numbers
  work (Task 3 `TestQuotaFrom`); in Usage its Wk column is `—` (Task 7 `windowSharePct` test).
- wavesrv's count fails or times out (a cold parse cache after a restart): the gate still decides from the quota
  percents, priced at 1.5M an agent "(rough)" (Task 3 `TestPrice` "no costs" and `TestQuotaFrom` "not counted";
  Task 5 leaves `costs` nil on a failed call).

---

### Task 1: `pkg/usagestats`: subagent costs by type, and the session's burn

**Depends on:** none
**Files:** `pkg/usagestats/burn.go`, `pkg/usagestats/burn_test.go`, `pkg/usagestats/usagestats.go`

**Interfaces:**
- Consumes: `walkClaudeFiles`, `cachedFileRecords`, `claudeSessionOf`, `dedupe`, `sumRecordsSinceCutoffs` (all in
  `pkg/usagestats`); test helpers `asstLine`, `writeJSONL`, `testOpus`, `testSonnet` from `sessions_test.go`.
- Produces (Tasks 2 and 4 use these):
  - `type SubagentCost struct { Type string; Samples int; Mean, P25, P90 int64 }`; constants `SubagentTypeAll = "all"`,
    `SubagentTypeUnknown = "unknown"`.
  - `func SubagentCosts(now time.Time) []SubagentCost`.
  - `type Burn struct { Session string; WindowFiveHour, WindowWeek, SessionFiveHour, SessionWeek, Subagents int; Costs
    []SubagentCost }`; `func SessionBurn(path string, fiveHourCutoff, weekCutoff, now time.Time) Burn`.
  - unexported, for Task 2: `parseEach(files []scanFile) [][]Record`, `subagentScanFiles(files []scanFile) []scanFile`,
    `subagentFiles(files []scanFile, perFile [][]Record) []subagentFile` (fields `session, agentType string; first,
    last time.Time; total int64`; method `finished(now time.Time) bool`), `recordTokens(r Record) int`,
    `claudeProjectsRoot() string`.

- [ ] **Step 1: Write the failing tests**

Create `pkg/usagestats/burn_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// writeMeta writes the .meta.json Claude Code keeps beside a subagent transcript
func writeMeta(t *testing.T, jsonlPath, agentType string) {
	t.Helper()
	data := fmt.Sprintf(`{"agentType":%q,"model":"inherit"}`, agentType)
	if err := os.WriteFile(strings.TrimSuffix(jsonlPath, ".jsonl")+".meta.json", []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSubagentCostsByType(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	sub := filepath.Join(root, "proj", "s1", "subagents")
	agent := func(name, agentType string, ts time.Time, tokens int) {
		path := filepath.Join(sub, name+".jsonl")
		writeJSONL(t, path, asstLine(name, ts, testSonnet, "/w", tokens, 0, 0, 0, 0))
		if agentType != "" {
			writeMeta(t, path, agentType)
		}
	}
	agent("agent-g1", "general-purpose", now.Add(-time.Hour), 100)
	agent("agent-g2", "general-purpose", now.Add(-2*time.Hour), 200)
	agent("agent-g3", "general-purpose", now.Add(-3*24*time.Hour), 900)
	agent("agent-e1", "Explore", now.Add(-time.Hour), 5000)
	agent("agent-u1", "", now.Add(-time.Hour), 50)                          // no meta file: unknown
	agent("agent-run", "general-purpose", now.Add(-10*time.Second), 99999)  // still running
	agent("agent-old", "general-purpose", now.Add(-40*24*time.Hour), 77777) // finished before the 30 days
	got := subagentCostsIn(root, now)
	want := []SubagentCost{
		{Type: "general-purpose", Samples: 3, Mean: 400, P25: 100, P90: 900},
		{Type: "Explore", Samples: 1, Mean: 5000, P25: 5000, P90: 5000},
		{Type: SubagentTypeUnknown, Samples: 1, Mean: 50, P25: 50, P90: 50},
		{Type: SubagentTypeAll, Samples: 5, Mean: 1250, P25: 100, P90: 5000},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("costs\n%+v\nwant\n%+v", got, want)
	}
}

func TestNearestRank(t *testing.T) {
	sorted := []int64{10, 20, 30, 40}
	if p25, p90 := nearestRank(sorted, 25), nearestRank(sorted, 90); p25 != 10 || p90 != 40 {
		t.Fatalf("p25 %d p90 %d", p25, p90)
	}
	if got := nearestRank([]int64{7}, 90); got != 7 {
		t.Fatalf("one sample = %d", got)
	}
}

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
		if b.Session != "s1" {
			t.Errorf("%s: session %q", path, b.Session)
		}
		if b.SessionFiveHour != 4100 || b.SessionWeek != 4110 {
			t.Errorf("%s: session 5h/week = %d/%d, want 4100/4110", path, b.SessionFiveHour, b.SessionWeek)
		}
		if b.WindowFiveHour != 54100 || b.WindowWeek != 54110 {
			t.Errorf("%s: window 5h/week = %d/%d, want 54100/54110", path, b.WindowFiveHour, b.WindowWeek)
		}
		if b.Subagents != 2 {
			t.Errorf("%s: subagents = %d, want 2", path, b.Subagents)
		}
		// neither subagent has a meta file: two unknown samples, and the every-type row
		if len(b.Costs) != 2 || b.Costs[0].Type != SubagentTypeUnknown || b.Costs[0].Samples != 2 || b.Costs[1].Type != SubagentTypeAll {
			t.Errorf("%s: costs %+v", path, b.Costs)
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
	if b.Session != "" || b.SessionFiveHour != 0 || b.SessionWeek != 0 || b.Subagents != 0 {
		t.Fatalf("no path = %+v, want no session numbers", b)
	}
	if b.WindowFiveHour != 1100 || b.WindowWeek != 1100 {
		t.Fatalf("window 5h/week = %d/%d, want 1100/1100 (zero cutoffs are the trailing windows)", b.WindowFiveHour, b.WindowWeek)
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/usagestats -run 'TestSubagentCosts|TestNearestRank|TestSessionBurn'`
Expected: FAIL to build: `undefined: subagentCostsIn`, `undefined: SubagentCost`, `undefined: sessionBurn`.

- [ ] **Step 3: Split the per-file parse out of `parseFiles`**

In `pkg/usagestats/usagestats.go`, add `parseEach` right above `parseFiles`, and replace the body of `parseFiles`
(keep its doc comment):

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

- [ ] **Step 4: Write `burn.go`**

Create `pkg/usagestats/burn.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// the cost rows' names for every type at once, and for a subagent whose meta file names none; pkg/tokengate reads "all"
const (
	SubagentTypeAll     = "all"
	SubagentTypeUnknown = "unknown"
)

const (
	// a subagent file whose last record is this recent is still running, its total not final
	subagentRunningFor = 60 * time.Second
	// how far back finished subagents price a spawn
	subagentCostDays = 30
)

// SubagentCost is what finished subagents of one type cost: how many, their mean total, and the p25 and p90 totals
type SubagentCost struct {
	Type    string
	Samples int
	Mean    int64
	P25     int64
	P90     int64
}

// Burn is what a spawn is weighed by: the Claude tokens the 5h and weekly windows have seen, the part of them one
// session recorded (its subagents included), and what finished subagents cost by type. Every count is WindowTokens'
// sum, so they compare.
type Burn struct {
	Session         string // the session's id; "" when no path was given
	WindowFiveHour  int
	WindowWeek      int
	SessionFiveHour int
	SessionWeek     int
	Subagents       int // the session's subagent files with a record inside the week window
	Costs           []SubagentCost
}

// subagentFile is one subagent transcript: the session it bills to, its type, its first and last record, its total
type subagentFile struct {
	session   string
	agentType string
	first     time.Time
	last      time.Time
	total     int64
}

func (f subagentFile) finished(now time.Time) bool {
	return now.Sub(f.last) >= subagentRunningFor
}

func claudeProjectsRoot() string {
	return filepath.Join(wavebase.GetHomeDir(), ".claude", "projects")
}

// SubagentCosts is what the finished subagents of the last 30 days cost by type: the most sampled type first, the
// every-type row last
func SubagentCosts(now time.Time) []SubagentCost {
	return subagentCostsIn(claudeProjectsRoot(), now)
}

func subagentCostsIn(root string, now time.Time) []SubagentCost {
	files := subagentScanFiles(walkClaudeFiles(root, now.AddDate(0, 0, -subagentCostDays-1)))
	return subagentCosts(subagentFiles(files, parseEach(files)), now)
}

// subagentScanFiles keeps the files under a subagents dir
func subagentScanFiles(files []scanFile) []scanFile {
	var out []scanFile
	for _, f := range files {
		if _, sub := claudeSessionOf(f.path); sub {
			out = append(out, f)
		}
	}
	return out
}

// subagentFiles folds each subagent transcript among files (perFile holds their records, by index) into one entry
func subagentFiles(files []scanFile, perFile [][]Record) []subagentFile {
	var out []subagentFile
	for i, recs := range perFile {
		session, sub := claudeSessionOf(files[i].path)
		if !sub || len(recs) == 0 {
			continue
		}
		f := subagentFile{session: session, agentType: agentTypeOf(files[i].path), first: recs[0].TS, last: recs[0].TS}
		for _, r := range recs {
			if r.TS.Before(f.first) {
				f.first = r.TS
			}
			if r.TS.After(f.last) {
				f.last = r.TS
			}
			f.total += int64(recordTokens(r))
		}
		out = append(out, f)
	}
	return out
}

// agentTypeOf reads the agentType Claude Code writes beside a subagent transcript, in <name>.meta.json
func agentTypeOf(path string) string {
	data, err := os.ReadFile(strings.TrimSuffix(path, ".jsonl") + ".meta.json")
	if err != nil {
		return SubagentTypeUnknown
	}
	var meta struct {
		AgentType string `json:"agentType"`
	}
	if json.Unmarshal(data, &meta) != nil || meta.AgentType == "" {
		return SubagentTypeUnknown
	}
	return meta.AgentType
}

// subagentCosts groups the finished subagents whose last record is within subagentCostDays by type
func subagentCosts(subs []subagentFile, now time.Time) []SubagentCost {
	since := now.AddDate(0, 0, -subagentCostDays)
	byType := map[string][]int64{}
	var all []int64
	for _, f := range subs {
		if !f.finished(now) || f.last.Before(since) {
			continue
		}
		byType[f.agentType] = append(byType[f.agentType], f.total)
		all = append(all, f.total)
	}
	out := make([]SubagentCost, 0, len(byType)+1)
	for t, totals := range byType {
		out = append(out, costOf(t, totals))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Samples != out[j].Samples {
			return out[i].Samples > out[j].Samples
		}
		return out[i].Type < out[j].Type
	})
	if len(all) > 0 {
		out = append(out, costOf(SubagentTypeAll, all))
	}
	return out
}

func costOf(agentType string, totals []int64) SubagentCost {
	sorted := slices.Clone(totals)
	slices.Sort(sorted)
	var sum int64
	for _, v := range sorted {
		sum += v
	}
	return SubagentCost{
		Type:    agentType,
		Samples: len(sorted),
		Mean:    sum / int64(len(sorted)),
		P25:     nearestRank(sorted, 25),
		P90:     nearestRank(sorted, 90),
	}
}

// nearestRank is the p-th percentile of sorted (ascending, not empty) by nearest rank: the ceil(p/100 × n)-th value
func nearestRank(sorted []int64, p int) int64 {
	rank := max((p*len(sorted)+99)/100, 1)
	return sorted[rank-1]
}

// SessionBurn reads the Claude transcripts once for a spawn. path is the session's transcript or one of its
// subagents' ("" leaves the session fields 0); a zero cutoff is the trailing window.
func SessionBurn(path string, fiveHourCutoff, weekCutoff, now time.Time) Burn {
	return sessionBurn(claudeProjectsRoot(), path, fiveHourCutoff, weekCutoff, now)
}

func sessionBurn(root, path string, fiveHourCutoff, weekCutoff, now time.Time) Burn {
	if fiveHourCutoff.IsZero() {
		fiveHourCutoff = now.Add(-5 * time.Hour)
	}
	if weekCutoff.IsZero() {
		weekCutoff = now.Add(-7 * 24 * time.Hour)
	}
	earliest := now.AddDate(0, 0, -subagentCostDays)
	if weekCutoff.Before(earliest) {
		earliest = weekCutoff
	}
	var b Burn
	if path != "" {
		b.Session, _ = claudeSessionOf(path)
	}
	files := walkClaudeFiles(root, earliest.AddDate(0, 0, -1))
	perFile := parseEach(files)
	var all []Record
	for _, recs := range perFile {
		all = append(all, recs...)
	}
	subs := subagentFiles(files, perFile)
	for _, f := range subs {
		if b.Session != "" && f.session == b.Session && !f.last.Before(weekCutoff) {
			b.Subagents++
		}
	}
	b.Costs = subagentCosts(subs, now)

	cutoffs := []time.Time{fiveHourCutoff, weekCutoff}
	deduped := dedupe(all)
	windows := sumRecordsSinceCutoffs(deduped, cutoffs)
	b.WindowFiveHour, b.WindowWeek = windows[0], windows[1]
	if b.Session != "" {
		var mine []Record
		for _, r := range deduped {
			if r.Session == b.Session {
				mine = append(mine, r)
			}
		}
		sums := sumRecordsSinceCutoffs(mine, cutoffs)
		b.SessionFiveHour, b.SessionWeek = sums[0], sums[1]
	}
	return b
}

// recordTokens is one record's tokens as WindowTokens sums them
func recordTokens(r Record) int {
	return r.Input + r.Output + r.Reasoning + r.CacheRead + r.CacheCreate
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `go test ./pkg/usagestats -run 'TestSubagentCosts|TestNearestRank|TestSessionBurn|TestParseFiles|TestWindowTokens|TestScanRoots|TestScanSessionUsage'`
Expected: PASS. Then `gofmt -l pkg/usagestats/burn.go pkg/usagestats/burn_test.go pkg/usagestats/usagestats.go` prints
nothing.

- [ ] **Step 6: Commit**

```bash
git add pkg/usagestats/burn.go pkg/usagestats/burn_test.go pkg/usagestats/usagestats.go
git commit -m "feat(usagestats): subagent costs by type, and a session's share of the 5h and weekly windows"
```

---

### Task 2: `pkg/usagestats`: per-session window tokens for Usage, and the estimate review

**Depends on:** Task 1
**Files:** `pkg/usagestats/sessionwindows.go`, `pkg/usagestats/sessionwindows_test.go`, `pkg/usagestats/review.go`, `pkg/usagestats/review_test.go`

**Interfaces:**
- Consumes (Task 1): `parseEach`, `subagentScanFiles`, `subagentFiles`, `subagentFile.finished`, `recordTokens`,
  `claudeProjectsRoot`.
- Produces (Task 4 uses these):
  - `type SessionWindows struct { FiveHour, Week int; Sessions map[string][2]int }`;
    `func ScanSessionWindows(fiveHourCutoff, weekCutoff, now time.Time) SessionWindows`.
  - `type EstimateLine struct` (the log's JSON, see below); `type EstimateReview struct { Logged, Run, Matched int;
    MedianRatio float64; WithRange, InRange int; ByType []TypeReview }`; `type TypeReview struct { Type string;
    Matched int; MedianRatio float64 }`; `func ReviewEstimates(logPath string, days int, now time.Time)
    (EstimateReview, error)`.

- [ ] **Step 1: Write the failing tests**

Create `pkg/usagestats/sessionwindows_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"path/filepath"
	"testing"
	"time"
)

func TestScanSessionWindows(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	proj := filepath.Join(root, "proj")
	writeJSONL(t, filepath.Join(proj, "s1.jsonl"),
		asstLine("a1", now.Add(-time.Hour), testOpus, "/w", 100, 0, 0, 0, 0),
		asstLine("a2", now.Add(-24*time.Hour), testOpus, "/w", 10, 0, 0, 0, 0),
		asstLine("a3", now.Add(-10*24*time.Hour), testOpus, "/w", 1, 0, 0, 0, 0),
	)
	writeJSONL(t, filepath.Join(proj, "s1", "subagents", "agent-a.jsonl"),
		asstLine("b1", now.Add(-2*time.Hour), testSonnet, "/w", 1000, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(proj, "s2.jsonl"), asstLine("d1", now.Add(-time.Hour), testOpus, "/w", 50000, 0, 0, 0, 0))
	w := scanSessionWindows(root, time.Time{}, time.Time{}, now)
	if w.FiveHour != 51100 || w.Week != 51110 {
		t.Fatalf("windows 5h/week = %d/%d, want 51100/51110", w.FiveHour, w.Week)
	}
	if w.Sessions["s1"] != [2]int{1100, 1110} || w.Sessions["s2"] != [2]int{50000, 50000} {
		t.Fatalf("sessions %+v", w.Sessions)
	}
}
```

Create `pkg/usagestats/review_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"encoding/json"
	"math"
	"path/filepath"
	"testing"
	"time"
)

func TestReviewEstimates(t *testing.T) {
	root := t.TempDir()
	now := time.Now().Truncate(time.Second)
	t0 := now.Add(-2 * time.Hour)
	sub := filepath.Join(root, "proj", "s1", "subagents")
	writeJSONL(t, filepath.Join(sub, "agent-a.jsonl"), asstLine("a1", t0.Add(time.Minute), testSonnet, "/w", 2000, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(sub, "agent-b.jsonl"), asstLine("b1", t0.Add(2*time.Minute), testSonnet, "/w", 4000, 0, 0, 0, 0))
	writeJSONL(t, filepath.Join(sub, "agent-c.jsonl"), asstLine("c1", t0.Add(30*time.Minute), testSonnet, "/w", 99999, 0, 0, 0, 0))
	line := func(l EstimateLine) string {
		data, err := json.Marshal(l)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	logPath := filepath.Join(root, "estimates.jsonl")
	writeJSONL(t, logPath,
		// two general-purpose agents estimated at 3000 (1000–5000): agent-a and agent-b ran, 6000, twice it and over the range
		line(EstimateLine{Ts: t0.Unix(), Session: "s1", Tool: "Agent", Agents: 2, Types: []string{"general-purpose", "general-purpose"}, Estimate: 3000, Low: 1000, High: 5000, Verdict: "run"}),
		// one Explore 29 minutes later: agent-c, which started a minute after it
		line(EstimateLine{Ts: t0.Add(29 * time.Minute).Unix(), Session: "s1", Tool: "Agent", Agents: 1, Types: []string{"Explore"}, Estimate: 100000, Verdict: "allow"}),
		// refused: it never ran
		line(EstimateLine{Ts: t0.Add(40 * time.Minute).Unix(), Session: "s1", Tool: "Agent", Agents: 1, Types: []string{"Explore"}, Estimate: 100000, Verdict: "deny"}),
		// a session with no subagents on disk
		line(EstimateLine{Ts: t0.Unix(), Session: "s9", Tool: "Agent", Agents: 1, Estimate: 100000, Verdict: "run"}),
		// before the period
		line(EstimateLine{Ts: now.Add(-9 * 24 * time.Hour).Unix(), Session: "s1", Tool: "Agent", Agents: 1, Estimate: 1, Verdict: "run"}),
		"not json",
	)
	rev, err := reviewEstimatesIn(root, logPath, 7, now)
	if err != nil {
		t.Fatal(err)
	}
	if rev.Logged != 4 || rev.Run != 3 || rev.Matched != 2 {
		t.Fatalf("logged/run/matched = %d/%d/%d, want 4/3/2", rev.Logged, rev.Run, rev.Matched)
	}
	// ratios 6000/3000 = 2 and 99999/100000
	if math.Abs(rev.MedianRatio-(2+0.99999)/2) > 1e-9 {
		t.Fatalf("median ratio %v", rev.MedianRatio)
	}
	if rev.WithRange != 1 || rev.InRange != 0 {
		t.Fatalf("with range %d in range %d, want 1 and 0", rev.WithRange, rev.InRange)
	}
	if len(rev.ByType) != 2 || rev.ByType[0].Type != "Explore" || rev.ByType[1].Type != "general-purpose" ||
		rev.ByType[1].MedianRatio != 2 || rev.ByType[0].Matched != 1 {
		t.Fatalf("by type %+v", rev.ByType)
	}
}

func TestReviewEstimatesWithNoLogIsEmpty(t *testing.T) {
	rev, err := reviewEstimatesIn(t.TempDir(), filepath.Join(t.TempDir(), "none.jsonl"), 7, time.Now())
	if err != nil || rev.Logged != 0 || rev.Matched != 0 {
		t.Fatalf("no log = %+v, %v", rev, err)
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/usagestats -run 'TestScanSessionWindows|TestReviewEstimates'`
Expected: FAIL to build: `undefined: scanSessionWindows`, `undefined: EstimateLine`, `undefined: reviewEstimatesIn`.

- [ ] **Step 3: Write `sessionwindows.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import "time"

// SessionWindows is the tokens each Claude session (its subagents included) recorded since each quota window's
// cutoff, and every session's together: WindowTokens' sums, for Usage's By session 5h and Wk columns
type SessionWindows struct {
	FiveHour int
	Week     int
	Sessions map[string][2]int // session id → its 5h and week tokens
}

// ScanSessionWindows reads the Claude transcripts of the week (and a day); a zero cutoff is the trailing window
func ScanSessionWindows(fiveHourCutoff, weekCutoff, now time.Time) SessionWindows {
	return scanSessionWindows(claudeProjectsRoot(), fiveHourCutoff, weekCutoff, now)
}

func scanSessionWindows(root string, fiveHourCutoff, weekCutoff, now time.Time) SessionWindows {
	if fiveHourCutoff.IsZero() {
		fiveHourCutoff = now.Add(-5 * time.Hour)
	}
	if weekCutoff.IsZero() {
		weekCutoff = now.Add(-7 * 24 * time.Hour)
	}
	w := SessionWindows{Sessions: map[string][2]int{}}
	for _, r := range dedupe(parseFiles(walkClaudeFiles(root, weekCutoff.AddDate(0, 0, -1)))) {
		inFive, inWeek := !r.TS.Before(fiveHourCutoff), !r.TS.Before(weekCutoff)
		if !inFive && !inWeek {
			continue
		}
		tokens := recordTokens(r)
		s := w.Sessions[r.Session]
		if inFive {
			w.FiveHour += tokens
			s[0] += tokens
		}
		if inWeek {
			w.Week += tokens
			s[1] += tokens
		}
		w.Sessions[r.Session] = s
	}
	return w
}
```

- [ ] **Step 4: Write `review.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"bufio"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"slices"
	"sort"
	"time"
)

// how long after a logged spawn its subagents' first records may start and still be its own
const reviewMatchWindow = 10 * time.Minute

// EstimateLine is one line of the Token burn estimate log (~/.arc/tokengate/estimates.jsonl); pkg/tokengate's LogLine
// writes the same JSON
type EstimateLine struct {
	Ts       int64    `json:"ts"` // epoch seconds
	Session  string   `json:"session"`
	Tool     string   `json:"tool"`
	Agents   int      `json:"agents"`
	Types    []string `json:"types"`
	Estimate int64    `json:"estimate"`
	Low      int64    `json:"low"`
	High     int64    `json:"high"`    // 0: the card showed no range
	Verdict  string   `json:"verdict"` // run, allow, allow-turn, allow-session, deny
}

// EstimateReview is how the logged estimates of the last days compare with what their subagents cost
type EstimateReview struct {
	Logged      int          // lines in the period
	Run         int          // of them, groups that ran (every verdict but deny)
	Matched     int          // of them, groups whose session had finished subagents start within reviewMatchWindow
	MedianRatio float64      // actual ÷ estimate over the matched groups; 0 with none
	WithRange   int          // matched groups whose estimate had a range
	InRange     int          // of them, those whose actual fell inside it
	ByType      []TypeReview // matched groups whose agents were all of one type, the most matched first
}

type TypeReview struct {
	Type        string
	Matched     int
	MedianRatio float64
}

// ReviewEstimates reads the estimate log at logPath for the last days and matches each group that ran with the
// finished subagents its session started within reviewMatchWindow after it, the earliest first, at most its agent
// count. A missing log is an empty review.
func ReviewEstimates(logPath string, days int, now time.Time) (EstimateReview, error) {
	return reviewEstimatesIn(claudeProjectsRoot(), logPath, days, now)
}

func reviewEstimatesIn(root, logPath string, days int, now time.Time) (EstimateReview, error) {
	since := now.AddDate(0, 0, -days)
	lines, err := readEstimateLog(logPath, since)
	if err != nil {
		return EstimateReview{}, err
	}
	files := subagentScanFiles(walkClaudeFiles(root, since.AddDate(0, 0, -1)))
	bySession := map[string][]subagentFile{}
	for _, f := range subagentFiles(files, parseEach(files)) {
		if f.finished(now) {
			bySession[f.session] = append(bySession[f.session], f)
		}
	}
	for _, subs := range bySession {
		sort.Slice(subs, func(i, j int) bool { return subs[i].first.Before(subs[j].first) })
	}
	taken := map[string][]bool{}
	var rev EstimateReview
	var ratios []float64
	typeRatios := map[string][]float64{}
	for _, l := range lines {
		rev.Logged++
		if l.Verdict == "deny" {
			continue
		}
		rev.Run++
		subs := bySession[l.Session]
		if l.Session == "" || l.Estimate <= 0 || len(subs) == 0 {
			continue
		}
		if taken[l.Session] == nil {
			taken[l.Session] = make([]bool, len(subs))
		}
		start := time.Unix(l.Ts, 0)
		var actual int64
		n := 0
		for i, f := range subs {
			if n == max(l.Agents, 1) || f.first.Sub(start) > reviewMatchWindow {
				break
			}
			if taken[l.Session][i] || f.first.Before(start) {
				continue
			}
			taken[l.Session][i] = true
			actual += f.total
			n++
		}
		if n == 0 {
			continue
		}
		rev.Matched++
		ratio := float64(actual) / float64(l.Estimate)
		ratios = append(ratios, ratio)
		if l.High > 0 {
			rev.WithRange++
			if actual >= l.Low && actual <= l.High {
				rev.InRange++
			}
		}
		if t, ok := singleType(l.Types); ok {
			typeRatios[t] = append(typeRatios[t], ratio)
		}
	}
	rev.MedianRatio = median(ratios)
	for t, rs := range typeRatios {
		rev.ByType = append(rev.ByType, TypeReview{Type: t, Matched: len(rs), MedianRatio: median(rs)})
	}
	sort.Slice(rev.ByType, func(i, j int) bool {
		if rev.ByType[i].Matched != rev.ByType[j].Matched {
			return rev.ByType[i].Matched > rev.ByType[j].Matched
		}
		return rev.ByType[i].Type < rev.ByType[j].Type
	})
	return rev, nil
}

// readEstimateLog reads the log's lines from since on, oldest first, skipping lines that do not parse; a missing log
// is no lines
func readEstimateLog(path string, since time.Time) ([]EstimateLine, error) {
	f, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []EstimateLine
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		var l EstimateLine
		if json.Unmarshal(sc.Bytes(), &l) != nil || l.Ts < since.Unix() {
			continue
		}
		out = append(out, l)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Ts < out[j].Ts })
	return out, sc.Err()
}

// singleType is the one type every agent of a group had, when there is one
func singleType(types []string) (string, bool) {
	if len(types) == 0 || types[0] == "" {
		return "", false
	}
	for _, t := range types[1:] {
		if t != types[0] {
			return "", false
		}
	}
	return types[0], true
}

func median(vs []float64) float64 {
	if len(vs) == 0 {
		return 0
	}
	s := slices.Clone(vs)
	slices.Sort(s)
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `go test ./pkg/usagestats`
Expected: PASS. Then `gofmt -l pkg/usagestats/sessionwindows.go pkg/usagestats/sessionwindows_test.go pkg/usagestats/review.go pkg/usagestats/review_test.go`
prints nothing.

- [ ] **Step 6: Commit**

```bash
git add pkg/usagestats/sessionwindows.go pkg/usagestats/sessionwindows_test.go pkg/usagestats/review.go pkg/usagestats/review_test.go
git commit -m "feat(usagestats): per-session window tokens for Usage, and a review of the Token burn estimate log"
```

---

### Task 3: `pkg/tokengate`: price by type with a range, the week, the session, two rules, the log line

**Depends on:** none
**Files:** `pkg/tokengate/tokengate.go`, `pkg/tokengate/tokengate_test.go`, `cmd/wsh/cmd/wshcmd-tokengate.go`

**Interfaces:**
- Consumes: v1's `pkg/tokengate` as it is on `main`, and its one caller, `cmd/wsh/cmd/wshcmd-tokengate.go`, which this
  task keeps building (Task 5 rewrites its decision).
- Produces (Task 4 and Task 5 use these):
  - `Spawn` gains `Types []string`. `type Cost struct { Type string; Samples int; Mean, P25, P90 int64 }`;
    `const CostAll = "all"`. `type Priced struct { Estimate, Low, High int64; Basis []string }`;
    `func Price(s Spawn, costs []Cost) Priced`. `Estimate(s Spawn) int64` stays (1.5M an agent).
  - `type SessionUse struct { FiveHourPct, WeekPct *int; Subagents int }`; `Quota` gains `WeekPct *float64`,
    `WeekReset *int64`, `WeekShare *int`, `Session *SessionUse`. `type Reading struct { FiveHourPct, WeekPct *float64;
    FiveHourReset, WeekReset *int64; Counted bool; WindowFiveHour, WindowWeek, SessionFiveHour, SessionWeek int64;
    Subagents int }`; `func QuotaFrom(r Reading, estimate int64) Quota`; `func SessionShare(sessionTokens, windowTokens
    int64, windowPct float64) (int, bool)`.
  - `Rules` gains `WeekPct, SessionPct float64`; `DefaultRules = Rules{SharePct: 10, WindowPct: 70, Agents: 3, WeekPct:
    80, SessionPct: 25}`; `func RulesFrom(sharePct, windowPct *float64, agents *int, weekPct, sessionPct *float64)
    Rules`.
  - `func Note(s Spawn, p Priced, q Quota) string`; `func Question(s Spawn, p Priced, q Quota, loc *time.Location)
    baseds.AgentAskQuestion`; `func VerdictFor(choice int, s Spawn, estimate int64) Verdict`.
  - `func LogPath(home string) string`; `type LogLine struct` (same JSON as `usagestats.EstimateLine`);
    `func NewLogLine(now time.Time, session string, s Spawn, p Priced, v Verdict, asked bool) LogLine`;
    `func VerdictName(v Verdict, asked bool) string`.

- [ ] **Step 1: Write the failing tests**

Replace `pkg/tokengate/tokengate_test.go` with:

```go
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/tokengate`
Expected: FAIL to build: `undefined: Cost`, `undefined: Price`, `too many arguments in call to RulesFrom`.

- [ ] **Step 3: Rewrite `pkg/tokengate/tokengate.go`**

Replace the whole file with this. The option and scope constants, `Verdict`, `Hold`, `Estimate`, `WindowShare`,
`FormatTokens`, `plural`, `what`, `ing`, `Choice` and `Asking` are v1's, unchanged.

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
	"path/filepath"
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
	Tool          string // Agent, Task or Workflow; a group with any Workflow is Workflow
	Agents        int
	AtLeast       bool // a workflow's agent count is a floor: loops multiply it
	ContextTokens int64
	ContextMax    int64
	Types         []string // each agent's subagent type, in order; "" or missing is unknown (a Workflow's agents)
}

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
// first used; none means every agent was priced at PerAgentTokens.
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

// Estimate is the spawn at PerAgentTokens an agent, for a caller with no measured costs
func Estimate(s Spawn) int64 {
	return int64(max(s.Agents, 1)) * PerAgentTokens
}

// Price prices each agent from its type's row when that has minTypeSamples, else the every-type row when that has
// minAllSamples, else at PerAgentTokens. An agent with no known type takes the every-type row.
func Price(s Spawn, costs []Cost) Priced {
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

// joinAnd lists parts as a sentence does: "a", "a and b", "a, b and c"
func joinAnd(parts []string) string {
	if len(parts) <= 1 {
		return strings.Join(parts, "")
	}
	return strings.Join(parts[:len(parts)-1], ", ") + " and " + parts[len(parts)-1]
}

// costText is the estimate and what it rests on; long is the card's spelling, else the note's
func costText(p Priced, long bool) string {
	est := FormatTokens(p.Estimate)
	switch {
	case len(p.Basis) == 0:
		return fmt.Sprintf("about %s tokens (rough)", est)
	case p.High == 0 && long:
		return fmt.Sprintf("about %s tokens (rough, partly from %s subagents)", est, joinAnd(p.Basis))
	case p.High == 0:
		return fmt.Sprintf("about %s tokens (rough, partly %s)", est, strings.Join(p.Basis, ", "))
	case long:
		return fmt.Sprintf("about %s tokens, likely %s–%s (from %s subagents)",
			est, FormatTokens(p.Low), FormatTokens(p.High), joinAnd(p.Basis))
	}
	return fmt.Sprintf("about %s tokens (%s–%s, %s)", est, FormatTokens(p.Low), FormatTokens(p.High), strings.Join(p.Basis, ", "))
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

// Question is the card. loc is where the reset times are read; the caller passes time.Local
func Question(s Spawn, p Priced, q Quota, loc *time.Location) baseds.AgentAskQuestion {
	var b strings.Builder
	fmt.Fprintf(&b, "An agent wants to %s, %s.", what(s), costText(p, true))
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
		Estimate: p.Estimate,
		Low:      p.Low,
		High:     p.High,
		Verdict:  VerdictName(v, asked),
	}
}
```

- [ ] **Step 4: Keep `wsh` building**

The engine verifies `cmd/wsh` at this task's merge. In `cmd/wsh/cmd/wshcmd-tokengate.go`, change only these five
lines (Task 5 rewrites the decision):

```go
	if !tokengate.Asks(tokengate.RulesFrom(set.TokenGateSharePct, set.TokenGateWindowPct, set.TokenGateAgents, nil, nil), s, quota) {
		return tokengate.Verdict{Run: true, Note: tokengate.Note(s, tokengate.Price(s, nil), quota)}, nil
```

```go
	question := tokengate.Question(s, tokengate.Price(s, nil), quota, time.Local)
```

and in `tokengateAnswered`, both `tokengate.VerdictFor(...)` calls gain `tokengate.Estimate(s)` as their last argument:

```go
		return tokengate.VerdictFor(tokengate.OptionDeny, s, tokengate.Estimate(s)), nil
```

```go
	return tokengate.VerdictFor(tokengate.Choice(rtn.Answers, rtn.Cancelled), s, tokengate.Estimate(s)), nil
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `go test ./pkg/tokengate && go build ./cmd/wsh/... && go test ./cmd/wsh/cmd -run Tokengate`
Expected: PASS, a clean build, PASS. Then `gofmt -l pkg/tokengate cmd/wsh/cmd/wshcmd-tokengate.go` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add pkg/tokengate/tokengate.go pkg/tokengate/tokengate_test.go cmd/wsh/cmd/wshcmd-tokengate.go
git commit -m "feat(tokengate): price a spawn by subagent type with a range; the week, the session's share, two rules, the log line"
```

---

### Task 4: the RPCs and the two settings keys

**Depends on:** Task 1, Task 2, Task 3
**Files:** `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `pkg/wconfig/settingsconfig.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wconfig/metaconsts.go`, `schema/settings.json`

**Interfaces:**
- Consumes: `usagestats.SessionBurn`, `usagestats.SubagentCosts`, `usagestats.SubagentCost` (Task 1);
  `usagestats.ScanSessionWindows`, `usagestats.ReviewEstimates`, `usagestats.EstimateReview`, `usagestats.TypeReview`
  (Task 2); `tokengate.LogPath` (Task 3); `cutoffFromEpoch`, `sessionUsageToWire` in `wshserver_agents.go`.
- Produces (Tasks 5 and 7 use these):
  - `wshclient.GetSessionBurnCommand(w, wshrpc.CommandGetSessionBurnData{Path string; FiveHourCutoff, WeekCutoff
    int64}, opts) (*wshrpc.CommandGetSessionBurnRtnData, error)`; the return has `Session string`, `WindowFiveHour,
    WindowWeek, SessionFiveHour, SessionWeek, Subagents int`, `Costs []wshrpc.SubagentCostData`.
  - `wshrpc.SubagentCostData{Type string; Samples int; Mean, P25, P90 int64}` (TS: `type`, `samples`, `mean`, `p25`,
    `p90`).
  - `wshclient.GetSubagentCostsCommand(w, opts) (*wshrpc.CommandGetSubagentCostsRtnData, error)` → `Costs`; TS
    `RpcApi.GetSubagentCostsCommand(client, opts?)` → `{ costs }`.
  - `wshclient.ReviewTokenEstimatesCommand(w, wshrpc.CommandReviewTokenEstimatesData{Days int}, opts)
    (*wshrpc.CommandReviewTokenEstimatesRtnData, error)`; the return has `Days, Logged, Run, Matched int`,
    `MedianRatio float64`, `WithRange, InRange int`, `ByType []wshrpc.TokenEstimateTypeReview{Type string; Matched
    int; MedianRatio float64}`, `Costs []wshrpc.SubagentCostData`.
  - TS `CommandGetSessionUsageData` gains `fivehourcutoff?: number`, `weekcutoff?: number`; `UsageSession` gains
    `fivehourtokens: number`, `weektokens: number`; `CommandGetSessionUsageRtnData` gains `windowfivehourtokens:
    number`, `windowweektokens: number`.
  - `wconfig.SettingsType.TokenGateWeekPct`, `TokenGateSessionPct` (`*float64`).

- [ ] **Step 1: Declare the commands and types**

In `pkg/wshrpc/wshrpctypes_agents.go`, add three methods to the interface right after the `GetWindowTokensCommand(...)`
line:

```go
	GetSessionBurnCommand(ctx context.Context, data CommandGetSessionBurnData) (*CommandGetSessionBurnRtnData, error)                   // a spawn's weighing for the Token burn card
	GetSubagentCostsCommand(ctx context.Context) (*CommandGetSubagentCostsRtnData, error)                                                // what finished subagents cost, by type (Usage)
	ReviewTokenEstimatesCommand(ctx context.Context, data CommandReviewTokenEstimatesData) (*CommandReviewTokenEstimatesRtnData, error) // the logged Token burn estimates against what ran
```

Change the session-usage types (keep every existing field):

- `CommandGetSessionUsageData` gains, after `WindowDays`:

```go
	FiveHourCutoff int64 `json:"fivehourcutoff,omitempty"` // epoch seconds; 0 = the trailing 5 hours
	WeekCutoff     int64 `json:"weekcutoff,omitempty"`     // epoch seconds; 0 = the trailing 7 days
```

- `CommandGetSessionUsageRtnData` gains, after `Sessions`:

```go
	WindowFiveHourTokens int `json:"windowfivehourtokens"` // every session's tokens since FiveHourCutoff
	WindowWeekTokens     int `json:"windowweektokens"`
```

- `UsageSession` gains, after `LastTs`:

```go
	FiveHourTokens int `json:"fivehourtokens"` // this session's tokens since FiveHourCutoff, subagents included
	WeekTokens     int `json:"weektokens"`
```

And add these types right after `CommandGetWindowTokensRtnData`:

```go
// what finished subagents of one type cost (usagestats.SubagentCost); type "all" is every type at once
type SubagentCostData struct {
	Type    string `json:"type"`
	Samples int    `json:"samples"`
	Mean    int64  `json:"mean"`
	P25     int64  `json:"p25"`
	P90     int64  `json:"p90"`
}

type CommandGetSessionBurnData struct {
	Path           string `json:"path,omitempty"`           // the session's transcript, or one of its subagents'; "" = no session
	FiveHourCutoff int64  `json:"fivehourcutoff,omitempty"` // epoch seconds; 0 = the trailing 5 hours (not all-time, unlike GetWindowTokens)
	WeekCutoff     int64  `json:"weekcutoff,omitempty"`     // epoch seconds; 0 = the trailing 7 days
}

// usagestats.Burn on the wire: WindowTokens' sums for both windows and for the session inside them (its subagents
// included), and what finished subagents cost by type
type CommandGetSessionBurnRtnData struct {
	Session         string             `json:"session"`
	WindowFiveHour  int                `json:"windowfivehour"`
	WindowWeek      int                `json:"windowweek"`
	SessionFiveHour int                `json:"sessionfivehour"`
	SessionWeek     int                `json:"sessionweek"`
	Subagents       int                `json:"subagents"`
	Costs           []SubagentCostData `json:"costs"`
}

type CommandGetSubagentCostsRtnData struct {
	Costs []SubagentCostData `json:"costs"`
}

type CommandReviewTokenEstimatesData struct {
	Days int `json:"days,omitempty"` // 0 = 7
}

type TokenEstimateTypeReview struct {
	Type        string  `json:"type"`
	Matched     int     `json:"matched"`
	MedianRatio float64 `json:"medianratio"`
}

// usagestats.EstimateReview on the wire, with the subagent costs as they stand now
type CommandReviewTokenEstimatesRtnData struct {
	Days        int                       `json:"days"`
	Logged      int                       `json:"logged"`
	Run         int                       `json:"run"`
	Matched     int                       `json:"matched"`
	MedianRatio float64                   `json:"medianratio"`
	WithRange   int                       `json:"withrange"`
	InRange     int                       `json:"inrange"`
	ByType      []TokenEstimateTypeReview `json:"bytype"`
	Costs       []SubagentCostData        `json:"costs"`
}
```

This file was not gofmt-clean before the change; do not `gofmt -w` it.

- [ ] **Step 2: Serve them**

In `pkg/wshrpc/wshserver/wshserver_agents.go`, add the imports `github.com/wavetermdev/waveterm/pkg/tokengate` and
`github.com/wavetermdev/waveterm/pkg/wavebase`, replace `GetSessionUsageCommand` with:

```go
func (ws *WshServer) GetSessionUsageCommand(ctx context.Context, data wshrpc.CommandGetSessionUsageData) (*wshrpc.CommandGetSessionUsageRtnData, error) {
	sessions := usagestats.ScanSessionUsage(data.WindowDays)
	windows := usagestats.ScanSessionWindows(cutoffFromEpoch(data.FiveHourCutoff), cutoffFromEpoch(data.WeekCutoff), time.Now())
	out := make([]wshrpc.UsageSession, len(sessions))
	for i, s := range sessions {
		out[i] = sessionUsageToWire(s)
		tokens := windows.Sessions[s.ID]
		out[i].FiveHourTokens, out[i].WeekTokens = tokens[0], tokens[1]
	}
	return &wshrpc.CommandGetSessionUsageRtnData{
		Sessions:             out,
		WindowFiveHourTokens: windows.FiveHour,
		WindowWeekTokens:     windows.Week,
	}, nil
}
```

and add right after `GetWindowTokensCommand`:

```go
func costsToWire(costs []usagestats.SubagentCost) []wshrpc.SubagentCostData {
	out := make([]wshrpc.SubagentCostData, len(costs))
	for i, c := range costs {
		out[i] = wshrpc.SubagentCostData{Type: c.Type, Samples: c.Samples, Mean: c.Mean, P25: c.P25, P90: c.P90}
	}
	return out
}

func (ws *WshServer) GetSessionBurnCommand(ctx context.Context, data wshrpc.CommandGetSessionBurnData) (*wshrpc.CommandGetSessionBurnRtnData, error) {
	b := usagestats.SessionBurn(data.Path, cutoffFromEpoch(data.FiveHourCutoff), cutoffFromEpoch(data.WeekCutoff), time.Now())
	return &wshrpc.CommandGetSessionBurnRtnData{
		Session:         b.Session,
		WindowFiveHour:  b.WindowFiveHour,
		WindowWeek:      b.WindowWeek,
		SessionFiveHour: b.SessionFiveHour,
		SessionWeek:     b.SessionWeek,
		Subagents:       b.Subagents,
		Costs:           costsToWire(b.Costs),
	}, nil
}

func (ws *WshServer) GetSubagentCostsCommand(ctx context.Context) (*wshrpc.CommandGetSubagentCostsRtnData, error) {
	return &wshrpc.CommandGetSubagentCostsRtnData{Costs: costsToWire(usagestats.SubagentCosts(time.Now()))}, nil
}

func (ws *WshServer) ReviewTokenEstimatesCommand(ctx context.Context, data wshrpc.CommandReviewTokenEstimatesData) (*wshrpc.CommandReviewTokenEstimatesRtnData, error) {
	days := data.Days
	if days <= 0 {
		days = 7
	}
	now := time.Now()
	rev, err := usagestats.ReviewEstimates(tokengate.LogPath(wavebase.GetHomeDir()), days, now)
	if err != nil {
		return nil, fmt.Errorf("reviewing token estimates: %w", err)
	}
	byType := make([]wshrpc.TokenEstimateTypeReview, len(rev.ByType))
	for i, t := range rev.ByType {
		byType[i] = wshrpc.TokenEstimateTypeReview{Type: t.Type, Matched: t.Matched, MedianRatio: t.MedianRatio}
	}
	return &wshrpc.CommandReviewTokenEstimatesRtnData{
		Days:        days,
		Logged:      rev.Logged,
		Run:         rev.Run,
		Matched:     rev.Matched,
		MedianRatio: rev.MedianRatio,
		WithRange:   rev.WithRange,
		InRange:     rev.InRange,
		ByType:      byType,
		Costs:       costsToWire(usagestats.SubagentCosts(now)),
	}, nil
}
```

(`cutoffFromEpoch(0)` is the zero time, which `SessionBurn` and `ScanSessionWindows` read as the trailing window.)

- [ ] **Step 3: Add the settings keys**

In `pkg/wconfig/settingsconfig.go`, right after the `TokenGateAgents` line:

```go
	TokenGateWeekPct    *float64 `json:"tokengate:weekpct,omitempty"`    // ask when the weekly window is this % used; nil = 80, 0 = off
	TokenGateSessionPct *float64 `json:"tokengate:sessionpct,omitempty"` // ask when the asking session has used this % of the 5h window; nil = 25, 0 = off
```

then `gofmt -w pkg/wconfig/settingsconfig.go` (it was clean), which realigns the tokengate block.

- [ ] **Step 4: Regenerate**

Run: `task generate`
Expected: `pkg/wshrpc/wshclient/wshclient.go` and `frontend/app/store/wshclientapi.ts` gain the three commands
(`"getsessionburn"`, `"getsubagentcosts"`, `"reviewtokenestimates"`); `frontend/types/gotypes.d.ts` gains the new types,
the widened session-usage types and the two `tokengate:` keys; `pkg/wconfig/metaconsts.go` gains
`ConfigKey_TokenGateWeekPct` and `ConfigKey_TokenGateSessionPct`; `schema/settings.json` gains both keys as numbers.
Check with `git diff --stat`; nothing else may change. Never edit generated files by hand. (`UsageSession` now
requires `fivehourtokens` and `weektokens`; the TS fixture in `usagesessions.test.ts` gains them in Task 7.)

- [ ] **Step 5: Build**

Run: `go build ./pkg/wshrpc/... ./pkg/wconfig/... ./cmd/server/... ./cmd/wsh/...`
Expected: success. Then `gofmt -l pkg/wshrpc/wshserver/wshserver_agents.go pkg/wconfig/settingsconfig.go` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add pkg/wshrpc/wshrpctypes_agents.go pkg/wshrpc/wshserver/wshserver_agents.go pkg/wconfig/settingsconfig.go \
  pkg/wshrpc/wshclient/wshclient.go frontend/app/store/wshclientapi.ts frontend/types/gotypes.d.ts \
  pkg/wconfig/metaconsts.go schema/settings.json
git commit -m "feat(wshrpc): session burn, subagent costs and the estimate review over RPC; per-session window tokens; tokengate week and session keys"
```

---

### Task 5: `wsh tokengate` prices by type, reads the session, logs, and reviews

**Depends on:** Task 3, Task 4
**Files:** `cmd/wsh/cmd/wshcmd-tokengate.go`, `cmd/wsh/cmd/wshcmd-tokengate_test.go`

**Interfaces:**
- Consumes: Task 3's `tokengate.Price`, `Cost`, `Reading`, `QuotaFrom`, five-argument `RulesFrom`, `Note`, `Question`,
  three-argument `VerdictFor`, `LogPath`, `NewLogLine`, `FormatTokens`; Task 4's `wshclient.GetSessionBurnCommand`,
  `wshclient.ReviewTokenEstimatesCommand`, their data types, `SettingsType.TokenGateWeekPct` and `TokenGateSessionPct`.
- Produces: flags `--transcript <path>` and `--types <a,b,…>` on `wsh tokengate` (Task 6 passes them); the subcommand
  `wsh tokengate review [--days 7]`; `func tokengateDecide(ctx context.Context, s tokengate.Spawn, transcript string,
  onHold func(any)) (tokengate.Verdict, error)`.

- [ ] **Step 1: Write the failing tests**

Replace `cmd/wsh/cmd/wshcmd-tokengate_test.go` with:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/tokengate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestTokengateDecideReturnsPromptlyOnADoneContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	_, err := tokengateDecide(ctx, tokengate.Spawn{Tool: "Agent", Agents: 2}, "", func(any) { t.Fatal("held a spawn on a done context") })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if time.Since(start) > time.Second {
		t.Fatalf("took %s", time.Since(start))
	}
}

func TestTokengateAnsweredMapsTheCardsOutcome(t *testing.T) {
	s := tokengate.Spawn{Tool: "Agent", Agents: 3}
	if v, err := tokengateAnswered(s, 8_400_000, wshrpc.AskRtnData{}, context.DeadlineExceeded); err != nil || v.Run || v.Reason == "" {
		t.Fatalf("no answer before the deadline = %+v, %v; want the deny verdict", v, err)
	}
	if v, err := tokengateAnswered(s, 8_400_000, wshrpc.AskRtnData{Cancelled: true}, nil); err != nil || v.Run {
		t.Fatalf("a dismissed card = %+v, %v; want a deny", v, err)
	}
	pick := []baseds.AgentAnswerItem{{SelectedIndexes: []int{tokengate.OptionAllowTurn}}}
	if v, err := tokengateAnswered(s, 8_400_000, wshrpc.AskRtnData{Answers: pick}, nil); err != nil || !v.Run || v.Scope != tokengate.ScopeTurn {
		t.Fatalf("Allow this turn = %+v, %v", v, err)
	}
	broken := errors.New("no route to the cockpit")
	if _, err := tokengateAnswered(s, 8_400_000, wshrpc.AskRtnData{}, broken); !errors.Is(err, broken) {
		t.Fatalf("a broken card's error = %v, want it passed on", err)
	}
}

func TestSplitTypes(t *testing.T) {
	if got := splitTypes(""); got != nil {
		t.Fatalf("no flag = %v", got)
	}
	if got := splitTypes("general-purpose,,Explore"); !reflect.DeepEqual(got, []string{"general-purpose", "", "Explore"}) {
		t.Fatalf("types = %v", got)
	}
}

func TestTokengateFlagsAndReview(t *testing.T) {
	for _, name := range []string{"transcript", "types"} {
		if f := tokengateCmd.Flags().Lookup(name); f == nil || f.DefValue != "" {
			t.Errorf("--%s flag = %+v", name, f)
		}
	}
	if f := tokengateReviewCmd.Flags().Lookup("days"); f == nil || f.DefValue != "7" {
		t.Errorf("review --days flag = %+v", f)
	}
	if tokengateReviewCmd.Parent() != tokengateCmd {
		t.Errorf("review is not under tokengate")
	}
}

func TestTokengateReviewText(t *testing.T) {
	got := tokengateReviewText(&wshrpc.CommandReviewTokenEstimatesRtnData{
		Days: 7, Logged: 4, Run: 3, Matched: 2, MedianRatio: 1.5, WithRange: 1, InRange: 0,
		ByType: []wshrpc.TokenEstimateTypeReview{{Type: "Explore", Matched: 1, MedianRatio: 1}, {Type: "general-purpose", Matched: 1, MedianRatio: 2}},
		Costs: []wshrpc.SubagentCostData{
			{Type: "general-purpose", Samples: 14, Mean: 2_800_000, P25: 300_000, P90: 6_100_000},
			{Type: "all", Samples: 31, Mean: 4_800_000, P25: 130_000, P90: 11_700_000},
		},
	})
	want := "Token burn estimates, last 7 days: 4 logged, 3 ran, 2 matched to the subagents that ran.\n" +
		"Actual ÷ estimate: median 1.50×.\n" +
		"Inside the card's range: 0 of 1 (0%).\n" +
		"  Explore: 1 matched, median 1.00×\n" +
		"  general-purpose: 1 matched, median 2.00×\n" +
		"Subagent costs now (finished, last 30 days):\n" +
		"  general-purpose: 14 samples, avg 2.8M, range 300k–6.1M\n" +
		"  all: 31 samples, avg 4.8M, range 130k–11.7M\n"
	if got != want {
		t.Fatalf("review\n%s\nwant\n%s", got, want)
	}
	empty := tokengateReviewText(&wshrpc.CommandReviewTokenEstimatesRtnData{Days: 7})
	if empty != "Token burn estimates, last 7 days: 0 logged, 0 ran, 0 matched to the subagents that ran.\nSubagent costs now (finished, last 30 days):\n  none yet\n" {
		t.Fatalf("empty review %q", empty)
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./cmd/wsh/cmd -run 'Tokengate|SplitTypes'`
Expected: FAIL to build: `too many arguments in call to tokengateDecide`, `undefined: splitTypes`,
`undefined: tokengateReviewCmd`, `undefined: tokengateReviewText`.

- [ ] **Step 3: Rewrite the command**

Replace `cmd/wsh/cmd/wshcmd-tokengate.go` with:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

// the asking session's transcript and each agent's subagent type, which the Claude mod passes
var (
	tokengateTranscript string
	tokengateTypes      string
	tokengateReviewDays int
)

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

var tokengateReviewCmd = &cobra.Command{
	Use:   "review",
	Short: "how far the Token burn estimates of the last days were from what their subagents cost",
	Args:  cobra.NoArgs,
	RunE:  tokengateReviewRun,
}

func init() {
	tokengateCmd.Flags().StringVar(&tokengateSpawn.Tool, "tool", "Agent", "Agent, Task or Workflow")
	tokengateCmd.Flags().IntVar(&tokengateSpawn.Agents, "agents", 1, "agents the group starts")
	tokengateCmd.Flags().BoolVar(&tokengateSpawn.AtLeast, "at-least", false, "the agent count is a floor")
	tokengateCmd.Flags().Int64Var(&tokengateSpawn.ContextTokens, "context-tokens", 0, "the agent's context now")
	tokengateCmd.Flags().Int64Var(&tokengateSpawn.ContextMax, "context-max", 0, "the agent's context window")
	tokengateCmd.Flags().StringVar(&tokengateTranscript, "transcript", "", "the asking session's transcript")
	tokengateCmd.Flags().StringVar(&tokengateTypes, "types", "", "each agent's subagent type, comma-separated, in order")
	tokengateReviewCmd.Flags().IntVar(&tokengateReviewDays, "days", 7, "how many days back")
	tokengateCmd.AddCommand(tokengateReviewCmd)
	rootCmd.AddCommand(tokengateCmd)
}

func tokengateRun(cmd *cobra.Command, args []string) error {
	out := json.NewEncoder(os.Stdout)
	s := tokengateSpawn
	s.Types = splitTypes(tokengateTypes)
	verdict, err := tokengateDecide(context.Background(), s, tokengateTranscript, func(hold any) { _ = out.Encode(hold) })
	if err != nil {
		return err
	}
	return out.Encode(verdict)
}

// splitTypes reads --types: one name per agent, in order, an empty name unknown
func splitTypes(flag string) []string {
	if flag == "" {
		return nil
	}
	return strings.Split(flag, ",")
}

// tokengateRead reads the quota and wavesrv's counts for a spawn: both windows, the session's share of them, the
// subagent costs, and the session's id. A failed reading only leaves its numbers unknown, and no costs prices every
// agent at PerAgentTokens
func tokengateRead(ctx context.Context, transcript string) (tokengate.Reading, []tokengate.Cost, string) {
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
	if err != nil || burn == nil {
		return r, nil, ""
	}
	r.Counted = true
	r.WindowFiveHour, r.WindowWeek = int64(burn.WindowFiveHour), int64(burn.WindowWeek)
	r.SessionFiveHour, r.SessionWeek = int64(burn.SessionFiveHour), int64(burn.SessionWeek)
	r.Subagents = burn.Subagents
	costs := make([]tokengate.Cost, len(burn.Costs))
	for i, c := range burn.Costs {
		costs[i] = tokengate.Cost{Type: c.Type, Samples: c.Samples, Mean: c.Mean, P25: c.P25, P90: c.P90}
	}
	return r, costs, burn.Session
}

// tokengateDecide is the decision `wsh tokengate` makes about one spawn group: off, or no rule firing, it runs
// (with a note); otherwise it waits on the person's card. A decided group is logged for `wsh tokengate review`. An
// error is a broken gate, which the mod answers by letting the spawn run.
func tokengateDecide(ctx context.Context, s tokengate.Spawn, transcript string, onHold func(any)) (tokengate.Verdict, error) {
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
	reading, costs, session := tokengateRead(ctx, transcript)
	priced := tokengate.Price(s, costs)
	quota := tokengate.QuotaFrom(reading, priced.Estimate)
	rules := tokengate.RulesFrom(set.TokenGateSharePct, set.TokenGateWindowPct, set.TokenGateAgents, set.TokenGateWeekPct, set.TokenGateSessionPct)
	if !tokengate.Asks(rules, s, quota) {
		verdict := tokengate.Verdict{Run: true, Note: tokengate.Note(s, priced, quota)}
		tokengateLog(session, s, priced, verdict, false)
		return verdict, nil
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
	question := tokengate.Question(s, priced, quota, time.Local)
	onHold(tokengate.Asking(s))
	// the card's ceiling is this local deadline; the RPC's own is a minute later, so no answer reads as the
	// deadline, which is the deny option, never as an EC-TIME error, which would let the spawn run
	askCtx, cancel := context.WithTimeout(ctx, askWaitTimeout)
	defer cancel()
	rtn, err := rpcWithContext(askCtx, func() (wshrpc.AskRtnData, error) {
		return wshclient.AskCommand(RpcClient, wshrpc.CommandAskData{
			ORef:      oref.String(),
			Questions: []baseds.AgentAskQuestion{question},
			Wait:      true,
			Hold:      true,
		}, &wshrpc.RpcOpts{Timeout: int64((askWaitTimeout + time.Minute) / time.Millisecond)})
	})
	verdict, err := tokengateAnswered(s, priced.Estimate, rtn, err)
	if err == nil {
		tokengateLog(session, s, priced, verdict, true)
	}
	return verdict, err
}

// tokengateAnswered turns the card's outcome into the verdict. No answer before the deadline is the deny option, as a
// dismissed card is; wsh then exits, and the server's waiter cancel takes the card down. Any other error is a broken
// gate, which the mod answers by letting the spawn run.
func tokengateAnswered(s tokengate.Spawn, estimate int64, rtn wshrpc.AskRtnData, err error) (tokengate.Verdict, error) {
	if errors.Is(err, context.DeadlineExceeded) {
		return tokengate.VerdictFor(tokengate.OptionDeny, s, estimate), nil
	}
	if err != nil {
		return tokengate.Verdict{}, err
	}
	return tokengate.VerdictFor(tokengate.Choice(rtn.Answers, rtn.Cancelled), s, estimate), nil
}

// tokengateLog appends a decided group to the estimate log `wsh tokengate review` reads; a failed write is ignored
func tokengateLog(session string, s tokengate.Spawn, p tokengate.Priced, v tokengate.Verdict, asked bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	line, err := json.Marshal(tokengate.NewLogLine(time.Now(), session, s, p, v, asked))
	if err != nil {
		return
	}
	path := tokengate.LogPath(home)
	if os.MkdirAll(filepath.Dir(path), 0o755) != nil {
		return
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(line, '\n'))
}

func tokengateReviewRun(cmd *cobra.Command, args []string) error {
	if RpcClient == nil {
		if err := preRunSetupRpcClient(nil, nil); err != nil {
			return err
		}
	}
	rtn, err := wshclient.ReviewTokenEstimatesCommand(RpcClient, wshrpc.CommandReviewTokenEstimatesData{Days: tokengateReviewDays}, &wshrpc.RpcOpts{Timeout: 60_000})
	if err != nil {
		return fmt.Errorf("reviewing token estimates: %w", err)
	}
	fmt.Print(tokengateReviewText(rtn))
	return nil
}

// tokengateReviewText is the review as the person reads it
func tokengateReviewText(r *wshrpc.CommandReviewTokenEstimatesRtnData) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Token burn estimates, last %d days: %d logged, %d ran, %d matched to the subagents that ran.\n",
		r.Days, r.Logged, r.Run, r.Matched)
	if r.Matched > 0 {
		fmt.Fprintf(&b, "Actual ÷ estimate: median %.2f×.\n", r.MedianRatio)
	}
	if r.WithRange > 0 {
		fmt.Fprintf(&b, "Inside the card's range: %d of %d (%d%%).\n", r.InRange, r.WithRange, r.InRange*100/r.WithRange)
	}
	for _, t := range r.ByType {
		fmt.Fprintf(&b, "  %s: %d matched, median %.2f×\n", t.Type, t.Matched, t.MedianRatio)
	}
	b.WriteString("Subagent costs now (finished, last 30 days):\n")
	if len(r.Costs) == 0 {
		b.WriteString("  none yet\n")
	}
	for _, c := range r.Costs {
		fmt.Fprintf(&b, "  %s: %d samples, avg %s, range %s–%s\n",
			c.Type, c.Samples, tokengate.FormatTokens(c.Mean), tokengate.FormatTokens(c.P25), tokengate.FormatTokens(c.P90))
	}
	return b.String()
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `go test ./cmd/wsh/cmd -run 'Tokengate|SplitTypes' && go build ./cmd/wsh/...`
Expected: PASS and a clean build. Then `gofmt -l cmd/wsh/cmd/wshcmd-tokengate.go cmd/wsh/cmd/wshcmd-tokengate_test.go`
prints nothing.

- [ ] **Step 5: Commit**

```bash
git add cmd/wsh/cmd/wshcmd-tokengate.go cmd/wsh/cmd/wshcmd-tokengate_test.go
git commit -m "feat(wsh): tokengate prices by subagent type, reads the session's share, logs each estimate; wsh tokengate review"
```

---

### Task 6: the Claude mod passes each agent's type and the session's transcript

**Depends on:** none
**Files:** `claude/arc-mod/hooks/tokengate-core.ts`, `claude/arc-mod/hooks/tokengate-core.test.ts`, `claude/arc-mod/hooks/register.ts`, `cmd/wsh/cmd/claude-mod/hooks/tokengate-core.ts`, `cmd/wsh/cmd/claude-mod/hooks/register.ts`

**Interfaces:**
- Consumes: `wsh tokengate --types … --transcript …` (Task 5; until it lands an unknown flag makes wsh exit non-zero,
  which the mod already answers by letting the spawn run). The `tool.call` hook's event is the tool's input, as v1's
  Workflow count already reads it (`input.script`); an Agent call's input carries `subagent_type`.
- Produces: `SpawnCount = { agents: number; atLeast: boolean; types: string[] }` (so `Group` has `types` too);
  `tokengateArgs(g: Group, context: { tokens: number; window: number } | null, transcript: string | null = null):
  string[]`.

- [ ] **Step 1: Update the tests**

In `claude/arc-mod/hooks/tokengate-core.test.ts`, replace the `describe("spawnCount", ...)`, `describe("joinGroup",
...)` and `describe("tokengateArgs", ...)` blocks with:

```ts
describe("spawnCount", () => {
    it("counts one agent per Agent or Task call, of its subagent type", () => {
        expect(spawnCount("Agent", { prompt: "x", subagent_type: "Explore" })).toEqual({ agents: 1, atLeast: false, types: ["Explore"] });
        expect(spawnCount("Agent", { prompt: "x" })).toEqual({ agents: 1, atLeast: false, types: ["general-purpose"] });
        expect(spawnCount("Task", {})).toEqual({ agents: 1, atLeast: false, types: ["general-purpose"] });
    });
    it("counts a workflow's agent( call sites, at least one, with no types", () => {
        expect(spawnCount("Workflow", { script: "agent('a'); agent ('b'); subagent('c')" })).toEqual({ agents: 2, atLeast: true, types: [] });
        expect(spawnCount("Workflow", { script: "phase('x')" })).toEqual({ agents: 1, atLeast: true, types: [] });
        expect(spawnCount("Workflow", { name: "review" })).toEqual({ agents: 1, atLeast: true, types: [] });
    });
});

describe("joinGroup", () => {
    it("sums parallel spawns and their types, and any workflow makes the group a workflow", () => {
        const gp = { agents: 1, atLeast: false, types: ["general-purpose"] };
        const g = joinGroup(joinGroup(null, "Agent", gp), "Agent", { agents: 1, atLeast: false, types: ["Explore"] });
        expect(g).toEqual({ tool: "Agent", agents: 2, atLeast: false, types: ["general-purpose", "Explore"] });
        expect(joinGroup(g, "Workflow", { agents: 3, atLeast: true, types: [] })).toEqual({
            tool: "Workflow",
            agents: 5,
            atLeast: true,
            types: ["general-purpose", "Explore"],
        });
    });
});

describe("tokengateArgs", () => {
    it("passes the group, its types, and the context when known", () => {
        expect(
            tokengateArgs({ tool: "Agent", agents: 2, atLeast: false, types: ["general-purpose", "Explore"] }, { tokens: 142000.4, window: 200000 })
        ).toEqual([
            "tokengate", "--tool", "Agent", "--agents", "2", "--types", "general-purpose,Explore",
            "--context-tokens", "142000", "--context-max", "200000",
        ]);
        expect(tokengateArgs({ tool: "Workflow", agents: 1, atLeast: true, types: [] }, null)).toEqual([
            "tokengate", "--tool", "Workflow", "--agents", "1", "--at-least",
        ]);
    });
    it("passes the session's transcript when known", () => {
        expect(tokengateArgs({ tool: "Agent", agents: 1, atLeast: false, types: [] }, null, "/h/.claude/projects/p/s1.jsonl")).toEqual([
            "tokengate", "--tool", "Agent", "--agents", "1", "--transcript", "/h/.claude/projects/p/s1.jsonl",
        ]);
    });
});
```

and in the gate test that checks two gathered spawns ask once, change its expectation to:

```ts
        expect(asked).toEqual([{ tool: "Agent", agents: 2, atLeast: false, types: ["general-purpose", "general-purpose"] }]);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run claude/arc-mod/hooks/tokengate-core.test.ts`
Expected: FAIL: the expectations with `types` do not match.

- [ ] **Step 3: Carry the types**

In `claude/arc-mod/hooks/tokengate-core.ts`:

```ts
export type SpawnCount = { agents: number; atLeast: boolean; types: string[] };
```

```ts
// a call's agents and the subagent types known of them: Agent and Task start one, of the input's subagent_type
// (general-purpose, Claude Code's default, when absent). a workflow's agents are its agent( call sites, a floor: a
// loop or parallel() over a list multiplies them, and their types are unknown; one named or read from a file is at
// least one
export function spawnCount(tool: SpawnTool, input: Record<string, unknown>): SpawnCount {
    if (tool !== "Workflow") {
        const type =
            typeof input.subagent_type === "string" && input.subagent_type !== ""
                ? input.subagent_type
                : "general-purpose";
        return { agents: 1, atLeast: false, types: [type] };
    }
    const script = typeof input.script === "string" ? input.script : "";
    const sites = script.match(/\bagent\s*\(/g)?.length ?? 0;
    return { agents: Math.max(1, sites), atLeast: true, types: [] };
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
        types: [...g.types, ...c.types],
    };
}

// the types let wsh price each agent from finished subagents of its type; the transcript lets it read what this
// session, its subagents included, has used of each window
export function tokengateArgs(
    g: Group,
    context: { tokens: number; window: number } | null,
    transcript: string | null = null
): string[] {
    const args = ["tokengate", "--tool", g.tool, "--agents", String(g.agents)];
    if (g.atLeast) {
        args.push("--at-least");
    }
    if (g.types.length > 0) {
        args.push("--types", g.types.join(","));
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

(replacing the existing `SpawnCount` type, its comment-and-`spawnCount`, `joinGroup` and `tokengateArgs`).

In `claude/arc-mod/hooks/register.ts`, in `askTokengate`, pass the path the `classic.UserPromptSubmit` hook already
keeps in `transcriptPath`:

```ts
        for await (const chunk of $.process.spawn({ argv: [WSH, ...tokengateArgs(group, lastContext, transcriptPath)] })) {
```

- [ ] **Step 4: Sync the embedded copy and check**

Run: `task sync:claudemod && npx vitest run claude/arc-mod/hooks/tokengate-core.test.ts && claude plugin validate claude/arc-mod`
Expected: the copies under `cmd/wsh/cmd/claude-mod/hooks/` match the sources (no test file copied), vitest PASS,
validate passes. Then `npx prettier --check claude/arc-mod/hooks/tokengate-core.ts claude/arc-mod/hooks/register.ts`
and fix only lines this task changed.

- [ ] **Step 5: Commit**

```bash
git add claude/arc-mod/hooks/tokengate-core.ts claude/arc-mod/hooks/tokengate-core.test.ts claude/arc-mod/hooks/register.ts \
  cmd/wsh/cmd/claude-mod/hooks/tokengate-core.ts cmd/wsh/cmd/claude-mod/hooks/register.ts
git commit -m "feat(claude-mod): the Token burn gate passes each agent's subagent type and the session's transcript"
```

---

### Task 7: Usage: the 5h and Wk columns, and the Subagent cost card

**Depends on:** Task 4
**Files:** `frontend/app/view/agents/usagesessions.ts`, `frontend/app/view/agents/usagesessions.test.ts`, `frontend/app/view/agents/usagedigest.test.ts`, `frontend/app/view/agents/usagesessiontable.tsx`, `frontend/app/view/agents/usageinsightsstore.ts`, `frontend/app/view/agents/usagesurface.tsx`, `frontend/app/view/agents/subagentcosts.ts`, `frontend/app/view/agents/subagentcosts.test.ts`, `frontend/app/view/agents/subagentcostcard.tsx`, `scripts/cdp/scenarios.mjs`

**Interfaces:**
- Consumes (Task 4, generated): `RpcApi.GetSessionUsageCommand(client, { windowdays, fivehourcutoff?, weekcutoff? })`
  returning `{ sessions, windowfivehourtokens, windowweektokens }`; `UsageSession.fivehourtokens`, `.weektokens`;
  `RpcApi.GetSubagentCostsCommand(client)` returning `{ costs: SubagentCostData[] }`; `SubagentCostData { type,
  samples, mean, p25, p90 }`. From `ratelimitstore.ts`: `DonutWindow { pct?: number; reset?: number }` (reset in epoch
  seconds), as `claudeDonut.fivehour` / `.week` in `usagesurface.tsx`.
- Produces: `SessionRow.fiveHourPct`, `SessionRow.weekPct` (`number | null`); `SessionQuota`; `windowSharePct`;
  `costRows`; `<SubagentCostCard costs={…} />`; the scenario `usage-token-burn`.

- [ ] **Step 1: Write the failing tests**

In `frontend/app/view/agents/usagesessions.test.ts`, add `windowSharePct` to the import from `./usagesessions`, add
`fivehourtokens: 0, weektokens: 0,` to the `sess` helper's object (before `...over`), and append the tests below. In
`frontend/app/view/agents/usagedigest.test.ts`, the `row` helper builds a whole `SessionRow`: add
`fiveHourPct: null, weekPct: null,` after its `share: 0.01,` line, or the typecheck fails.

```ts
describe("windowSharePct", () => {
    it("apportions the window's percent by tokens, clamped to the window", () => {
        expect(windowSharePct(4_000_000, 20_000_000, 62, 1)).toBe(12);
        expect(windowSharePct(30_000_000, 20_000_000, 62, 1)).toBe(62);
    });
    it("is unknown without a percent, a reset, or tokens on either side", () => {
        expect(windowSharePct(1, 10, undefined, 1)).toBeNull();
        expect(windowSharePct(1, 10, 50, undefined)).toBeNull(); // a Team seat's week has no reset
        expect(windowSharePct(0, 10, 50, 1)).toBeNull();
        expect(windowSharePct(1, 0, 50, 1)).toBeNull();
    });
});

describe("buildSessionRows quota windows", () => {
    const quota = {
        fiveHourPct: 62,
        fiveHourReset: 1,
        weekPct: 41,
        weekReset: 2,
        windowFiveHourTokens: 20_000_000,
        windowWeekTokens: 200_000_000,
    };
    it("gives each row its share of the 5-hour and weekly windows", () => {
        const rows = buildSessionRows([sess("a", { fivehourtokens: 4_000_000, weektokens: 20_000_000 }), sess("b")], none, quota);
        const a = rows.find((r) => r.id === "a")!;
        const b = rows.find((r) => r.id === "b")!;
        expect([a.fiveHourPct, a.weekPct]).toEqual([12, 4]);
        expect([b.fiveHourPct, b.weekPct]).toEqual([null, null]);
    });
    it("leaves both unknown with no quota", () => {
        expect(buildSessionRows([sess("a", { fivehourtokens: 4_000_000 })], none)[0].fiveHourPct).toBeNull();
    });
});
```

Create `frontend/app/view/agents/subagentcosts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { costRows } from "./subagentcosts";

describe("costRows", () => {
    it("keeps the server's order and marks the rows the Token burn card prices from", () => {
        const rows = costRows([
            { type: "general-purpose", samples: 14, mean: 2_800_000, p25: 300_000, p90: 6_100_000 },
            { type: "web-fetch", samples: 2, mean: 100_000, p25: 80_000, p90: 420_000 },
            { type: "all", samples: 4, mean: 1_900_000, p25: 90_000, p90: 6_100_000 },
        ]);
        expect(rows.map((r) => [r.label, r.samples, r.avg, r.range, r.prices, r.all])).toEqual([
            ["general-purpose", 14, "2.8M", "300K–6.1M", true, false],
            ["web-fetch", 2, "100K", "80K–420K", false, false],
            ["All types", 4, "1.9M", "90K–6.1M", false, true],
        ]);
    });
    it("is empty with no costs", () => {
        expect(costRows([])).toEqual([]);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/usagesessions.test.ts frontend/app/view/agents/subagentcosts.test.ts`
Expected: FAIL: `windowSharePct` is not exported; `./subagentcosts` does not exist.

- [ ] **Step 3: The pure models**

In `frontend/app/view/agents/usagesessions.ts`, add to `SessionRow` (after `share`):

```ts
    fiveHourPct: number | null; // whole percent of the 5-hour quota window, subagents included; null unknown
    weekPct: number | null; // the same for the weekly window
```

add above `buildSessionRows`:

```ts
// The live Claude windows a row's 5h and Wk shares divide: their percents and resets (epoch seconds) as Live limits
// reads them, and every session's tokens since each window's cutoff (GetSessionUsage)
export interface SessionQuota {
    fiveHourPct?: number;
    fiveHourReset?: number;
    weekPct?: number;
    weekReset?: number;
    windowFiveHourTokens: number;
    windowWeekTokens: number;
}

// A session's share of a quota window, as a whole percent: the window's reported percent apportioned by tokens, as
// the Token burn card does (pkg/tokengate SessionShare). null when the window's percent or reset is unknown, or the
// session or the window has no tokens in it.
export function windowSharePct(sessionTokens: number, windowTokens: number, pct?: number, reset?: number): number | null {
    if (pct == null || reset == null || sessionTokens <= 0 || windowTokens <= 0) {
        return null;
    }
    return Math.round((Math.min(sessionTokens, windowTokens) * pct) / windowTokens);
}
```

change the signature and doc of `buildSessionRows`:

```ts
// One row per session, most expensive first. `live` maps a session id to the tab running it
// (liveSessionTabs); `quota` gives each row its 5h and Wk shares (null leaves them unknown).
export function buildSessionRows(
    sessions: UsageSession[],
    live: Map<string, string>,
    quota: SessionQuota | null = null
): SessionRow[] {
```

and add to the `row` object built for each session (after `lifetimeMs,`):

```ts
            fiveHourPct: quota
                ? windowSharePct(s.fivehourtokens ?? 0, quota.windowFiveHourTokens, quota.fiveHourPct, quota.fiveHourReset)
                : null,
            weekPct: quota ? windowSharePct(s.weektokens ?? 0, quota.windowWeekTokens, quota.weekPct, quota.weekReset) : null,
```

Create `frontend/app/view/agents/subagentcosts.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage surface's Subagent cost card (Claude tab): what finished subagents of each type cost over the last 30
// days (GetSubagentCostsCommand). These rows price the Token burn card (pkg/tokengate Price): a type with
// TYPE_SAMPLES or more prices its own agents, the every-type row the rest once it has ALL_SAMPLES.

import { fmt } from "./usagestats";

export const TYPE_SAMPLES = 3;
export const ALL_SAMPLES = 5;

export interface CostRow {
    type: string;
    label: string; // the type, or "All types" for the every-type row
    samples: number;
    avg: string; // "2.8M"
    range: string; // p25 to p90, "300K–6.1M"
    all: boolean;
    prices: boolean; // whether the Token burn card prices from this row
}

export function costRows(costs: SubagentCostData[]): CostRow[] {
    return costs.map((c) => {
        const all = c.type === "all";
        return {
            type: c.type,
            label: all ? "All types" : c.type,
            samples: c.samples,
            avg: fmt(c.mean),
            range: `${fmt(c.p25)}–${fmt(c.p90)}`,
            all,
            prices: c.samples >= (all ? ALL_SAMPLES : TYPE_SAMPLES),
        };
    });
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run frontend/app/view/agents/usagesessions.test.ts frontend/app/view/agents/subagentcosts.test.ts`
Expected: PASS.

- [ ] **Step 5: The store**

In `frontend/app/view/agents/usageinsightsstore.ts`:

Add atoms below `sessionUsageLoadedAtom`:

```ts
// every session's tokens since each quota window's cutoff, for the By session 5h and Wk columns
export const sessionWindowTokensAtom = atom<{ fiveHour: number; week: number }>({ fiveHour: 0, week: 0 }) as PrimitiveAtom<{
    fiveHour: number;
    week: number;
}>;
// what finished subagents cost by type, for the Subagent cost card
export const subagentCostsAtom = atom<SubagentCostData[]>([]) as PrimitiveAtom<SubagentCostData[]>;

const FIVE_HOUR_S = 5 * 3600;
const WEEK_S = 7 * 24 * 3600;
```

In the fixture comment block add three lines after `sessions`:

```ts
//   windowfivehourtokens, windowweektokens  every session's tokens in the 5-hour and weekly windows (absent: 0)
//   costs     the Subagent cost rows (absent: none)
```

and to `DevInsightsFixture`:

```ts
    windowfivehourtokens?: number;
    windowweektokens?: number;
    costs?: SubagentCostData[];
```

Replace `loadSessionUsage` with:

```ts
// fiveHourReset / weekReset are the Claude windows' resets (epoch seconds) as Live limits reads them; the rows' 5h and
// Wk tokens count from reset − window, and from the trailing window when a reset is unknown
export async function loadSessionUsage(windowDays: number, fiveHourReset?: number, weekReset?: number): Promise<void> {
    const seq = ++sessionSeq;
    // the skeleton shows while a different window loads; reopening the surface keeps the rows it holds
    if (windowDays !== heldSessionWindow) {
        heldSessionWindow = windowDays;
        globalStore.set(sessionUsageLoadedAtom, false);
    }
    try {
        const fixture = devInsights();
        let sessions: UsageSession[];
        let windows = { fiveHour: 0, week: 0 };
        if (fixture != null) {
            sessions = fixture.sessions ?? [];
            windows = { fiveHour: fixture.windowfivehourtokens ?? 0, week: fixture.windowweektokens ?? 0 };
        } else {
            const rtn = await RpcApi.GetSessionUsageCommand(TabRpcClient, {
                windowdays: windowDays,
                fivehourcutoff: fiveHourReset != null ? fiveHourReset - FIVE_HOUR_S : undefined,
                weekcutoff: weekReset != null ? weekReset - WEEK_S : undefined,
            });
            sessions = rtn.sessions ?? [];
            windows = { fiveHour: rtn.windowfivehourtokens ?? 0, week: rtn.windowweektokens ?? 0 };
        }
        if (seq !== sessionSeq) {
            return; // a newer load superseded this one
        }
        globalStore.set(sessionUsageAtom, sessions);
        globalStore.set(sessionWindowTokensAtom, windows);
    } catch {
        // keep the last-good rows
    } finally {
        if (seq === sessionSeq) {
            globalStore.set(sessionUsageLoadedAtom, true);
        }
    }
}

let costsSeq = 0;

export async function loadSubagentCosts(): Promise<void> {
    const seq = ++costsSeq;
    try {
        const fixture = devInsights();
        const costs =
            fixture != null ? (fixture.costs ?? []) : ((await RpcApi.GetSubagentCostsCommand(TabRpcClient)).costs ?? []);
        if (seq === costsSeq) {
            globalStore.set(subagentCostsAtom, costs);
        }
    } catch {
        // keep the last-good rows
    }
}
```

- [ ] **Step 6: The table's columns**

In `frontend/app/view/agents/usagesessiontable.tsx`:

- The header comment's first sentence names the new columns: "…with the share of the window's Claude spend, its share
  of the 5-hour and weekly quota windows (subagents included), the context it ran at…".
- The grid gains two 44px columns after the share bar:

```ts
// title | share bar | 5h | wk | spend | context avg / peak | cold | subagents | lifetime
const GRID = "grid grid-cols-[minmax(0,1fr)_150px_44px_44px_78px_104px_52px_64px_56px] items-center gap-3.5 px-[18px]";
```

- Add below `shareStr`:

```ts
// a quota-window share: "12%", "<1%", "—" when unknown
function pctStr(pct: number | null): string {
    if (pct == null) return "—";
    return pct < 1 ? "<1%" : `${pct}%`;
}
```

- In `Row`, right after the share bar's `</span>` (the span holding the `Meter` and `shareStr`):

```tsx
            <span data-usage-session-5h="" className={NUM}>
                {pctStr(row.fiveHourPct)}
            </span>
            <span data-usage-session-wk="" className={NUM}>
                {pctStr(row.weekPct)}
            </span>
```

- In `Header`, right after `<span>Share of window</span>`:

```tsx
            <span className="text-right" title="This tab's share of the 5-hour quota window, subagents included">
                5h
            </span>
            <span className="text-right" title="This tab's share of the weekly quota window, subagents included">
                Wk
            </span>
```

- In `SkeletonRows`, right after the share bar's `SkeletonLine` (`h-[5px] w-full`), add two
  `<SkeletonLine className="ml-auto h-[10px] w-[24px]" />`.
- The table's `min-w-[720px]` becomes `min-w-[820px]`.

- [ ] **Step 7: The card**

Create `frontend/app/view/agents/subagentcostcard.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage surface's Subagent cost card (Claude tab), under By session: one row per subagent type, and the every-type
// row last, with its samples, average and p25–p90 range. Thin: the rows come from subagentcosts.ts. A row the Token burn
// card does not price from (too few samples) is muted.

import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { costRows } from "./subagentcosts";

// type | samples | avg | range
const GRID = "grid grid-cols-[minmax(0,1fr)_72px_78px_120px] items-center gap-3.5 px-[18px]";
const NUM = "text-right text-[11.5px] tabular-nums text-secondary";

export function SubagentCostCard({ costs }: { costs: SubagentCostData[] }) {
    const rows = costRows(costs);
    return (
        <section data-subagent-costs="" className="mb-[22px] min-w-0">
            <div className="mb-3 flex items-center gap-2.5">
                <h3 className={cn(REGION_LABEL, "text-muted")}>Subagent cost</h3>
                <div className="h-px flex-1 bg-edge-faint" />
                <span className="text-[10.5px] tabular-nums text-muted">
                    finished, last 30 days · prices the Token burn card
                </span>
            </div>
            <div className="overflow-hidden rounded-[14px] border border-border bg-surface-raised">
                {rows.length === 0 ? (
                    <div className="px-[18px] py-4 text-[12px] text-muted">No finished subagents in the last 30 days</div>
                ) : (
                    <>
                        <div
                            className={cn(GRID, "border-b border-edge-faint py-2.5 text-[10.5px] whitespace-nowrap text-muted")}
                        >
                            <span>Type</span>
                            <span className="text-right">Samples</span>
                            <span className="text-right">Avg</span>
                            <span className="text-right">Range p25–p90</span>
                        </div>
                        {rows.map((r) => (
                            <div
                                key={r.type}
                                data-subagent-cost={r.type}
                                className={cn(GRID, "border-b border-edge-faint py-2.5 last:border-b-0", r.all && "bg-surface-hover")}
                            >
                                <span
                                    className={cn("truncate text-[12.5px] font-semibold", r.prices ? "text-primary" : "text-muted")}
                                >
                                    {r.label}
                                </span>
                                <span className={NUM}>{r.samples}</span>
                                <span className={NUM}>{r.avg}</span>
                                <span className={NUM}>{r.range}</span>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </section>
    );
}
```

- [ ] **Step 8: Wire the surface**

In `frontend/app/view/agents/usagesurface.tsx`:

- Import `loadSubagentCosts`, `sessionWindowTokensAtom` and `subagentCostsAtom` from `./usageinsightsstore` (beside
  `loadSessionUsage`), and `import { SubagentCostCard } from "./subagentcostcard";`.
- In the effect on `[windowDays]`, remove `void loadSessionUsage(windowDays);` (keep `void loadSavedInsights();`) and
  update its comment to say only the saved analysis loads there.
- Move the line `const claudeDonut = donuts.find((d) => d.provider === "claude");` from below `insightsCard(...)` to
  right above `const sessionRows = useMemo(`, and replace the `sessionRows` memo with:

```tsx
    // Claude's 5-hour and weekly windows, as Live limits reads them. The By session rows load with the window and again
    // when a quota window rolls over, since their 5h and Wk shares count tokens from each window's reset.
    const claudeDonut = donuts.find((d) => d.provider === "claude");
    const fiveHourPct = claudeDonut?.fivehour.pct;
    const fiveHourReset = claudeDonut?.fivehour.reset;
    const weekPct = claudeDonut?.week.pct;
    const weekReset = claudeDonut?.week.reset;
    useEffect(() => {
        void loadSessionUsage(windowDays, fiveHourReset, weekReset);
        void loadSubagentCosts();
    }, [windowDays, fiveHourReset, weekReset]);
    const sessionWindows = useAtomValue(sessionWindowTokensAtom);
    const subagentCosts = useAtomValue(subagentCostsAtom);
    const sessionRows = useMemo(
        () =>
            claude
                ? buildSessionRows(sessions, liveSessionTabs(agents), {
                      fiveHourPct,
                      fiveHourReset,
                      weekPct,
                      weekReset,
                      windowFiveHourTokens: sessionWindows.fiveHour,
                      windowWeekTokens: sessionWindows.week,
                  })
                : [],
        [claude, sessions, agents, fiveHourPct, fiveHourReset, weekPct, weekReset, sessionWindows]
    );
```

  Keep the comment above the old `claudeDonut` line with the held-window code that still uses `claudeDonut`.
- In the Claude block's loaded branch, right after the `{sessionRows.length > 0 ? (<UsageSessionTable … />) : null}`
  expression, add `<SubagentCostCard costs={subagentCosts} />`.

- [ ] **Step 9: The scenario**

In `scripts/cdp/scenarios.mjs` (hand-formatted 4-space; never run prettier on it), add right after the `usageInsights`
scenario object:

```js
// --- usage token burn: By session's 5h / Wk columns and the Subagent cost card ---------------------------------
// (docs/superpowers/specs/2026-10-11-token-burn-guard-v2-design.md.) Seeded like usage-insights, minus the open agent:
// the first three sessions get tokens inside the quota windows, the fixture carries every session's window totals and
// three Subagent cost rows, and the Claude snapshot reads 62% of 5 hours and 41% of the week. The rows then read 12% / 4%
// (4M of 20M at 62%, 20M of 200M at 41%), <1% / <1%, 3% / 1%, and — / — from the fourth on.
const usageTokenBurn = {
    name: "usage-token-burn",
    surface: "usage",
    async arrange(h) {
        const now = Date.now();
        const sessions = usageInsightsSessions(now).map((s, i) => ({
            ...s,
            fivehourtokens: [4_000_000, 10_000, 1_000_000][i] ?? 0,
            weektokens: [20_000_000, 100_000, 3_000_000][i] ?? 0,
        }));
        const ctx = {
            prevUsage: await h.ev(`localStorage.getItem('wave:dev-usage-buckets')`),
            prevRate: await h.ev(`localStorage.getItem('wave:ratelimits')`),
            prevInsights: await h.ev(`localStorage.getItem(${JSON.stringify(UI_KEY)})`),
        };
        try {
            const nowSec = Math.floor(now / 1000);
            const rateLimits = {
                "claude:default": {
                    fivehourpct: 62,
                    fivehourreset: nowSec + 3 * 3600,
                    weekpct: 41,
                    weekreset: nowSec + 6 * 24 * 3600,
                    capturedAt: now,
                },
            };
            const insights = {
                sessions,
                saved: usageInsightsSaved(now),
                analyze: "ok",
                windowfivehourtokens: 20_000_000,
                windowweektokens: 200_000_000,
                costs: [
                    { type: "general-purpose", samples: 14, mean: 2_800_000, p25: 300_000, p90: 6_100_000 },
                    { type: "web-fetch", samples: 2, mean: 100_000, p25: 80_000, p90: 420_000 },
                    { type: "all", samples: 16, mean: 2_500_000, p25: 100_000, p90: 6_100_000 },
                ],
            };
            await h.ev(
                `localStorage.setItem('wave:dev-usage-buckets', ${JSON.stringify(JSON.stringify(buildUsageFixture()))})`
            );
            await h.ev(`localStorage.setItem('wave:ratelimits', ${JSON.stringify(JSON.stringify(rateLimits))})`);
            await h.ev(`localStorage.setItem(${JSON.stringify(UI_KEY)}, ${JSON.stringify(JSON.stringify(insights))})`);
            // the quota snapshot seeds an atom at module load
            if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        try {
            rec(
                "0. the sessions, the window totals, the costs and the quota snapshot are in place",
                ctx.arrangeError == null,
                ctx.arrangeError ?? "seeded"
            );
            const ready = await ahWait(
                h,
                `document.querySelectorAll("[data-usage-session]").length > 0 && document.querySelectorAll("[data-subagent-cost]").length > 0`,
                20000
            );
            const table = await h.ev(`(() => {
                const head = document.querySelector("[data-usage-sessions] .grid");
                const header = head ? [...head.children].map((c) => c.textContent.trim()) : [];
                const rows = [...document.querySelectorAll("[data-usage-session]")].slice(0, 4).map((r) => [
                    r.querySelector("[data-usage-session-5h]")?.textContent.trim() ?? null,
                    r.querySelector("[data-usage-session-wk]")?.textContent.trim() ?? null,
                ]);
                return { header, rows };
            })()`);
            await h.shot("cdp-shots/usage-token-burn-sessions.png");
            rec(
                "1. usage-token-burn-sessions: By session shows 5h and Wk after Share of window, each row's share of the quota windows",
                ready === true &&
                    JSON.stringify(table?.header?.slice(1, 4)) === JSON.stringify(["Share of window", "5h", "Wk"]) &&
                    JSON.stringify(table?.rows) ===
                        JSON.stringify([
                            ["12%", "4%"],
                            ["<1%", "<1%"],
                            ["3%", "1%"],
                            ["—", "—"],
                        ]),
                JSON.stringify({ ready, table })
            );

            await h.ev(`document.querySelector("[data-subagent-costs]")?.scrollIntoView({ block: "center" })`);
            const card = await h.ev(
                `[...document.querySelectorAll("[data-subagent-cost]")].map((r) => [...r.children].map((c) => c.textContent.trim()))`
            );
            await h.shot("cdp-shots/usage-token-burn-costs.png");
            rec(
                "2. usage-token-burn-costs: the Subagent cost card lists each type and All types last, with samples, average and range",
                JSON.stringify(card) ===
                    JSON.stringify([
                        ["general-purpose", "14", "2.8M", "300K–6.1M"],
                        ["web-fetch", "2", "100K", "80K–420K"],
                        ["All types", "16", "2.5M", "100K–6.1M"],
                    ]),
                JSON.stringify(card)
            );
        } catch (e) {
            rec("usage-token-burn ran to the end", false, String(e?.message ?? e));
        }
        return steps;
    },
    // puts the three storage keys back, reloads onto them, and leaves for the Cockpit
    async teardown(h, ctx) {
        const errors = [];
        const step = async (label, fn) => {
            try {
                await fn();
            } catch (e) {
                errors.push(`${label}: ${String(e?.message ?? e)}`);
            }
        };
        await step("restore the storage keys", async () => {
            await h.ev(restoreStorageKey("wave:dev-usage-buckets", ctx.prevUsage));
            await h.ev(restoreStorageKey("wave:ratelimits", ctx.prevRate));
            await h.ev(restoreStorageKey(UI_KEY, ctx.prevInsights));
        });
        await step("reload onto the restored keys", async () => {
            if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
        });
        await step("leave on the Cockpit", () => h.goto("cockpit"));
        if (errors.length > 0) throw new Error(errors.join("; "));
    },
};
```

and register it in `SCENARIOS` right after `usageInsights,`:

```js
    usageTokenBurn,
```

Run: `node --check scripts/cdp/scenarios.mjs`
Expected: no output. (The scenario runs in Final on Windows; on a Mac WKWebView answers no CDP.)

- [ ] **Step 10: Typecheck and test**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (about 2 minutes; give it a longer timeout) and
`npx vitest run frontend/app/view/agents/`
Expected: exit 0 and PASS. Then `npx prettier --write` the nine `frontend/app/view/agents/` files this task touched:
each was prettier-clean before this task (or is new), and prettier also orders the new imports and wraps the long
lines above. Rerun the vitest line.

- [ ] **Step 11: Commit**

```bash
git add frontend/app/view/agents/usagesessions.ts frontend/app/view/agents/usagesessions.test.ts \
  frontend/app/view/agents/usagedigest.test.ts frontend/app/view/agents/usagesessiontable.tsx frontend/app/view/agents/usageinsightsstore.ts \
  frontend/app/view/agents/usagesurface.tsx frontend/app/view/agents/subagentcosts.ts \
  frontend/app/view/agents/subagentcosts.test.ts frontend/app/view/agents/subagentcostcard.tsx scripts/cdp/scenarios.mjs
git commit -m "feat(usage): By session shows each tab's share of the 5h and weekly windows; a Subagent cost card"
```

---

### Task 8: docs

**Depends on:** Task 5, Task 6, Task 7
**Files:** `CHANGELOG.md`, `docs/guide/settings.md`, `docs/guide/usage.md`, `docs/deferred.md`, `docs/open-issues.md`

**Interfaces:**
- Consumes: the names and defaults of Tasks 3–7 (`tokengate:weekpct` 80, `tokengate:sessionpct` 25, `wsh tokengate
  review [--days 7]`, the log path, the 5h / Wk columns, the Subagent cost card).
- Produces: nothing code reads.

- [ ] **Step 1: CHANGELOG**

In `CHANGELOG.md`, add as the first entries under `### Changed` of the top `## Unreleased` section (open
`## Unreleased` above a dated top section if the top one has a date):

```markdown
- The Token burn card prices a spawn from what finished subagents of the same type cost (general-purpose, Explore,
  fork…), with a likely range, and says how much of the 5-hour and weekly windows the agent's session has used so
  far, its subagents included. It also asks when the week is 80% used (`tokengate:weekpct`) or the session has used
  25% of the 5-hour window (`tokengate:sessionpct`). `wsh tokengate review` shows how far the estimates of the last
  week were from what ran.

- **Usage → By session** shows each tab's share of the 5-hour and weekly quota windows (**5h**, **Wk**), and a
  **Subagent cost** card lists what each subagent type costs: the figures the Token burn card prices from.
```

- [ ] **Step 2: Settings guide**

In `docs/guide/settings.md`, replace the line that starts `- **Thẻ Token burn**` with:

```markdown
- **Thẻ Token burn** (`tokengate:enabled`, `tokengate:sharepct`, `tokengate:windowpct`, `tokengate:agents`, `tokengate:weekpct`, `tokengate:sessionpct`): trước khi một agent Claude chạy `Agent`, `Task` hay `Workflow`, arcterm hiện thẻ **Token burn** trên terminal của nó khi lần spawn sẽ tốn từ `tokengate:sharepct` % cửa sổ 5 giờ (mặc định 10), khi cửa sổ đã dùng từ `tokengate:windowpct` % (mặc định 70), khi cửa sổ tuần đã dùng từ `tokengate:weekpct` % (mặc định 80), khi chính session đó, tính cả subagent của nó, đã dùng từ `tokengate:sessionpct` % cửa sổ 5 giờ (mặc định 25), khi nhóm khởi chạy từ `tokengate:agents` agent cùng lúc (mặc định 3), hoặc khi đó là một Workflow. Chi phí mỗi agent lấy từ các subagent cùng loại đã chạy xong (thẻ **Subagent cost** trong [Usage](usage.md)). Đặt một ngưỡng là `0` để tắt quy tắc đó; `tokengate:enabled` = `false` tắt hẳn thẻ. Không có thẻ trong Settings: ghi vào `settings.json`.
```

- [ ] **Step 3: Usage guide**

In `docs/guide/usage.md`, in the `## Bảng By session` table, add these two rows right after the **Share of window**
row:

```markdown
| **5h** | Phần cửa sổ quota 5 giờ tab đã dùng, tính cả subagent: phần trăm Live limits đọc được, chia theo token. `—` khi chưa đọc được quota hay giờ reset, hoặc tab không có token trong cửa sổ. |
| **Wk** | Như **5h**, cho cửa sổ tuần. Ghế Claude Team không có cửa sổ tuần nên luôn là `—`. |
```

and add this section right before `## Thanh meter quota trên app bar`:

```markdown
## Thẻ Subagent cost

Dưới bảng **By session**, thẻ **Subagent cost** liệt kê chi phí các subagent đã chạy xong trong 30 ngày qua, theo loại
(`general-purpose`, `Explore`, `fork`…): số mẫu, trung bình và khoảng p25–p90, cùng dòng **All types** cho mọi loại.
Thẻ **Token burn** ước tính một lần spawn từ đúng những con số này: loại có từ 3 mẫu tính theo loại đó, còn lại theo
**All types** khi nó có từ 5 mẫu, không đủ nữa thì 1.5M mỗi agent. Dòng chưa đủ mẫu hiện mờ.

Mỗi lần spawn được ghi vào `~/.arc/tokengate/estimates.jsonl`. `wsh tokengate review` (mặc định 7 ngày, `--days N`)
so các ước tính đó với các subagent thực sự đã chạy: tỉ lệ thực tế ÷ ước tính và bao nhiêu lần rơi vào khoảng thẻ đã nêu.
```

- [ ] **Step 4: deferred.md**

In `docs/deferred.md`, entry "(arcterm) Token burn guard":

Replace

```markdown
  — **shipped** (`docs/superpowers/specs/2026-10-08-token-burn-guard-design.md`: `pkg/tokengate`, `wsh tokengate`,
  the Claude mod's `tool.call` gate); (2) a burn alert:
```

with

```markdown
  — **shipped** (`docs/superpowers/specs/2026-10-08-token-burn-guard-design.md`: `pkg/tokengate`, `wsh tokengate`,
  the Claude mod's `tool.call` gate; v2, `docs/superpowers/specs/2026-10-11-token-burn-guard-v2-design.md`: priced by
  subagent type from finished transcripts with a range, the week and the session's share, Usage's 5h / Wk columns and
  Subagent cost card, the estimate log and `wsh tokengate review`); (2) a burn alert:
```

and replace the **Still deferred** bullet with:

```markdown
- **Still deferred:** parts (2) and (3); a whole-run cost estimate at plan submit (a decision in
  `docs/superpowers/specs/2026-10-07-quota-guard-design.md`; 2026-10-11 data: ~10M a task all-in, 3–20M); weighing by
  price instead of raw tokens; and exempting engine runs from the gate. The effort "Token burn guard: follow-ups"
  (`1dce9cf9-1464-456b-831c-7c5d13a12fc9`) holds the live check (chunk 1, due 2026-10-14) and the week-later review
  with `wsh tokengate review` (chunk 3, due 2026-10-19), which decides the next of these.
```

- [ ] **Step 5: open-issues.md**

In `docs/open-issues.md`, in the "(arcterm) Token burn guard part (1) shipped" row, replace `calibrating
\`PerAgentTokens\`` with `a whole-run cost estimate at plan submit`.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md docs/guide/settings.md docs/guide/usage.md docs/deferred.md docs/open-issues.md
git commit -m "docs: token burn guard v2"
```

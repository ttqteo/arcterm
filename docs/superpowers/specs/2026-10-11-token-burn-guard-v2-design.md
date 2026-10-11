# Token burn guard, v2: estimate a spawn from measured subagents, and show it in Usage

Status: design, 2026-10-11, revised the same day: the estimate is per subagent type with a range, Usage shows the
numbers it rests on, and every estimate is logged so a review a week later can say how far off it was (effort "Token
burn guard: follow-ups", chunk 3, due 2026-10-19). Builds on v1 (`2026-10-08-token-burn-guard-design.md`, on `main`).

## Problem

The person wants to know, before a fan-out, what it will cost, and later whether that guess held. v1 cannot say:

- The estimate is a constant: `agents × PerAgentTokens` (1.5M). Measured on this machine (2026-10-11, 31 subagents in
  30 days) a subagent costs median 0.78M, mean 4.8M, p90 11.7M, max 42M: one number for all of them is off by 10×
  either way.
- The spread is mostly the subagent's **type**: web-fetch ~0.1M (8 samples), general-purpose ~1–3M (14), Explore ~6M
  (3), fork ~39M (2, a fork inherits the parent's whole context). The type is known before the spawn (the Agent tool's
  `subagent_type`) and recorded after it (`agentType` in the `.meta.json` Claude Code writes beside each subagent
  transcript).
- It reads only the 5-hour window, never the weekly one, and never the asking session's own usage.
- Nothing records what was estimated, so nobody can check it.

## What v2 adds

1. **A per-type estimate with a range.** Each agent of a group is priced from finished subagents of its type; the card
   and the note give the expected total and a range ("about 3M, likely 1–12M").
2. **The weekly window** beside the 5h one: how full, when it resets, what share the spawn would take.
3. **The session's share of each window**, its subagents included.
4. **Two rules:** the week is already full, and this session has already used a large share of the 5h window.
5. **Usage shows the numbers:** By session gains a **5h** and a **Wk** column (each session's share of the quota
   windows, subagents included), and a **Subagent cost** card lists each type's samples, average and range: the same
   figures the gate uses.
6. **An estimate log and a review:** `wsh tokengate` appends each decided group to a log; `wsh tokengate review`
   matches the logged groups with the subagents that actually ran and says how far off the estimates were.

Example question:

> An agent wants to start 3 subagents, about 12.6M tokens, likely 6.4M–23.9M (from 14 general-purpose and 3 Explore
> subagents). Its own context is 142k of 200k, and each of its further calls re-reads that. This session has used
> about 18% of the 5-hour window and about 4% of the week so far, its 4 subagents included. The 5-hour window is 62%
> used and resets at 14:20; this would take about 9% more. The week is 31% used and resets Mon 09:00; this would take
> about 1% of it.

Example note: "Token burn: starting 1 subagent, about 2.8M tokens (300k–6.1M, 14 general-purpose), ~3% of the 5h
window, <1% of the week. This session so far: ~18% of 5h, ~4% of the week."

As in v1, a number that is unknown is left out of the sentence, never shown as 0, and the rule that needs it does
not fire.

## The numbers

All token counts are the sum `WindowTokens` uses (input + output + reasoning + cache read + cache write, deduped by
`message.id:requestId`), so every count compares with every other.

### Subagent costs

- **Samples:** each subagent transcript under `~/.claude/projects/*/*/subagents/` (nested ones included) that is
  **finished** (its last record is at least 60 s old) and whose last record is within **30 days**. Its total is the
  file's own sum (a nested subagent is its own sample, so one that spawned others is counted low).
- **Type:** `agentType` from the `.meta.json` beside it; a missing or unreadable meta file is type `unknown`.
- **Per type:** samples, mean, p25 and p90 (nearest rank on the sorted totals). Also one `all` row over every sample.
- **An agent's price:** its type's row when that type has ≥ 3 samples; else the `all` row when it has ≥ 5; else
  `PerAgentTokens` (1.5M) with no range.
- **A spawn's types:** `Agent`/`Task` take the input's `subagent_type`, `general-purpose` when it is absent (Claude
  Code's default). A Workflow's agents have no known type and are priced by the `all` row.
- **Group:** estimate = the sum of its agents' means; low = the sum of their p25s, high = the sum of their p90s, both
  only when every agent was priced from a row (otherwise the range is left out). The rules use the estimate.
- Why the mean for the estimate: it is what a group's total follows; the range carries the skew.

### Windows and the session

- **Window share of the spawn** (v1's `WindowShare`, once per window): capacity ≈ window tokens ÷ (window % ÷ 100),
  only when the window is ≥ 5% used and its tokens > 0. The week's tokens are read with cutoff = week reset − 7 days,
  as `windowtokenstore.ts` does. A Claude Team seat has no week to read: its usage answer carries neither `seven_day`
  nor a `weekly_all` row, only a model-scoped one (a Premium seat's Fable share), which `claudequota` does not take
  for the week. There every week number is unknown and the week rule does not fire.
- **Session share:** `session tokens in the window ÷ window tokens × window %`, rounded to a whole percent ("<1%"
  below 1). It apportions the reported percent, so it needs no 5% floor, only session and window tokens > 0. A session
  count above the window count (a file read between the two sums) is clamped to the window %.
- **Session tokens** cover the session's root transcript and every `.jsonl` under its `subagents/` dir. A path under
  `<session>/subagents/` is mapped to its session first, so a spawn from inside a subagent counts the whole session.
- A window whose percent or reset is unknown gets no shares: its token count's cutoff was only a guess.

Known overstatement, said with "about": the window % counts usage this machine's transcripts never see (the
person's other machine, claude.ai on the web), so capacity and session share lean high. The raw sum also weighs a
cache read like an output token and Opus like Sonnet; Usage's By session prices by model, and weighing the gate the
same way is a candidate for the review to decide.

### The log and the review

- **Log:** `~/.arc/tokengate/estimates.jsonl`, one line per group `wsh tokengate` decided: `ts` (epoch seconds),
  `session` (the transcript's session id, "" when unknown), `tool`, `agents`, `types`, `estimate`, `low`, `high`
  (0 when no range), `verdict` (`run` without asking, `allow`, `allow-turn`, `allow-session`, `deny`). A failed write
  is ignored. Spawns the mod lets through on an earlier "Allow this turn/session" never reach wsh and are not logged.
  The log is never trimmed: at about 200 bytes a group it grows a few MB a year, and the review reads only its period.
- **Review** (`wsh tokengate review [--days 7]`): for each logged group of the last N days whose verdict let it run
  and whose session is known, the actual is the sum of that session's finished subagent files whose first record falls
  within 10 minutes after `ts`, the earliest first, at most `agents` of them. A group with none found is "unmatched".
  It prints: groups logged, run, matched; the median of actual ÷ estimate; the share of matched groups inside
  [low, high]; the same median per type for single-type groups; and the current Subagent cost rows.
- The chunk due 2026-10-19 says what decides it: keep the estimate when the median ratio is within 0.5–2× and at
  least 60% land inside the range; otherwise retune the sample floors or percentiles, or weigh by price.

## Components

### `pkg/usagestats`

- `SubagentCosts(now time.Time) []SubagentCost` with `SubagentCost { Type string; Samples int; Mean, P25, P90 int64 }`,
  sorted by samples, `all` last.
- `SessionBurn(path string, fiveHourCutoff, weekCutoff, now time.Time) Burn`: `Session string`, `WindowFiveHour`,
  `WindowWeek`, `SessionFiveHour`, `SessionWeek`, `Subagents` (the session's subagent files with a record inside the
  week window), `Costs []SubagentCost`. One walk of the Claude transcripts serves both.
- `ScanSessionWindows(fiveHourCutoff, weekCutoff, now time.Time) SessionWindows`: every session's tokens since each
  window's cutoff, and the windows' totals, for Usage's columns (a zero cutoff is the trailing window).
  `ScanSessionUsage` is unchanged; `GetSessionUsageCommand` joins the two.
- `ReviewEstimates(logPath string, days int, now time.Time) (EstimateReview, error)` for the review: a missing log is an
  empty review, an unreadable one an error.

All of it goes through the per-file record cache (`cachedFileRecords`); measured 2026-10-11, a burn read took 462 ms
cold and 25 ms warm.

### RPC (`pkg/wshrpc/wshrpctypes_agents.go`, then `task generate`)

- `GetSessionBurnCommand{Path, FiveHourCutoff, WeekCutoff}` → the `Burn` fields (a zero cutoff is the trailing
  window).
- `GetSubagentCostsCommand()` → `{Costs}` for Usage's card.
- `GetSessionUsageCommand` data gains `FiveHourCutoff`, `WeekCutoff`; its sessions gain `fivehourtokens`,
  `weektokens`; the return gains `windowfivehourtokens`, `windowweektokens`.
- `ReviewTokenEstimatesCommand{Days}` → the review's figures; `wsh tokengate review` prints them.

### `pkg/tokengate`

- `Spawn` gains `Types []string` (one per agent, "" for unknown) and is priced by `Price(s Spawn, costs []Cost)
  Priced { Estimate, Low, High int64; Basis []string }` (`Cost` mirrors `SubagentCost`; `High` 0 = no range; `Basis`
  names the rows used, "14 general-purpose", "31 recent"). `Estimate(s)` stays for callers that have no costs (1.5M an
  agent).
- `Quota` gains `WeekPct`, `WeekReset`, `WeekShare`, `Session *SessionUse { FiveHourPct, WeekPct *int; Subagents
  int }`; `Reading` and `QuotaFrom(r Reading, estimate int64) Quota` build it.
- `Rules` gains `WeekPct` (default 80) and `SessionPct` (default 25); 0 turns either off.
- `Note` and `Question` take the priced spawn and say the range, its basis, the week and the session.
- `LogLine` is the log's JSON line and `NewLogLine` builds it.

### `wsh tokengate`

- New flags `--transcript <path>` and `--types <a,b,…>`. One `GetClaudeQuotaCommand` and one `GetSessionBurnCommand`
  (5 s timeouts each; a failure leaves those numbers unknown and the estimate at 1.5M an agent), then the rules, the
  card, and the log line.
- `wsh tokengate review [--days 7]`.

### Settings

`tokengate:weekpct`, `tokengate:sessionpct` (`*float64`, nil = the default, 0 = off).

### Claude mod

`spawnCount` also returns the call's types (`subagent_type`, else `general-purpose`; none for a Workflow); `joinGroup`
gathers them; `tokengateArgs` passes `--types` and the `--transcript` that `register.ts` keeps from
`classic.UserPromptSubmit`.

### Usage (Claude tab)

- **By session:** two columns after **Share of window**: **5h** and **Wk**, each session's share of that quota
  window, subagents included, by the session-share formula with the live Claude percents; `—` when unknown (no quota
  reading, no reset, a Team seat's week, or no tokens in the window). The table already reloads with the surface.
- **Subagent cost** card under By session: one row per type (`Type`, `Samples`, `Avg`, `Range` p25–p90) and the
  `all` row, with a caption that these price the Token burn card. Empty: "No finished subagents in the last 30 days".
- A CDP scenario shows both with fixture data.

## Failure and edge cases

- No transcript path, or no session tokens in a window: the session clause and that column are left out.
- A type with too few samples falls back to `all`, then to 1.5M without a range.
- A resumed session counts its own file; a `--fork-session` is a new file and starts from zero.
- Workflow agents: no workflow transcript exists on this machine to check where Claude Code writes them. If they land
  under the session's `subagents/` dir they count like any subagent; if not, the session share misses them. The live
  check settles which and records it here.

## Testing

- Go `pkg/usagestats`: `SubagentCosts` (types from meta, `unknown`, a running file left out, an old one left out,
  percentiles); `SessionBurn` (root plus nested subagents, records on both sides of each cutoff, a subagent path mapped
  to its session, no path); `ScanSessionWindows`; `ReviewEstimates` (a matched group, a denied one skipped,
  an unmatched one, the 10-minute window, at most `agents` files).
- Go `pkg/tokengate`: `Price` (per type, fallback to `all`, to 1.5M, range only when all priced), `SessionShare`,
  `QuotaFrom` (Team seat, unknown reset, not counted, no session), the new rules, `Note`/`Question` clauses, `LogLine`.
- vitest: `spawnCount` types, `joinGroup` types, `tokengateArgs` with types and transcript; Usage's pure model for the
  two columns and the card rows.
- CDP: the Usage scenario with the new columns and card.
- Live, after v1's live check: a session that ran subagents shows its share; the card's types match the spawn.

## Out of scope

- A whole engine run's cost at plan submit (v3). Measured 2026-10-11 over 8 runs: ~10M a task all-in (3–20M), workers
  alone median 1.7M a task; the per-run transcripts sit under `…worktrees-<runId>[-t-N]`.
- Weighing by price instead of raw tokens (the review decides).
- Showing the session share on the rail or in Consumers.
- Trimming `estimates.jsonl`.

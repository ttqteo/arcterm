# Token burn guard, v2: what this session has used, and a measured estimate

Status: design, 2026-10-11. Builds on v1 (`2026-10-08-token-burn-guard-design.md`), whose run was in progress when
this was written; v2's plan is written against v1's code once that run lands on `main`, not against v1's plan.

## Problem

v1 holds a costly spawn, but its numbers say little about the session asking:

- The estimate is a constant: `agents × PerAgentTokens` (1.5M), whatever this session's subagents have actually
  cost.
- It reads only the 5-hour window. The weekly window, the one that stops work for days, is not read at all.
- It reads the account's usage, never the session's: the card cannot say "this session, with its subagents, has
  taken 18% of the 5h window", which is what the person weighs before allowing more.

## What v2 adds

1. **The weekly window**, beside the 5h one: how full it is, when it resets, and what share of it the spawn would
   take.
2. **This session's share of each window**, its subagents included: the tokens the session's transcript and every
   transcript under its `subagents/` dir recorded inside the window, as a share of the window's reading.
3. **A measured per-agent estimate**: the average total of the subagents this session already ran; with too few,
   the average of recent subagents on this machine; with none, v1's 1.5M.
4. Two rules: the week is already full, and this session has already taken a large share of the 5h window.

The card and the `arc:` note carry all of it. Example question:

> An agent wants to start 3 subagents, about 3.6M tokens (the average of this session's 4 subagents). Its own
> context is 142k of 200k, and each of its further calls re-reads that. This session has used about 18% of the
> 5-hour window and 4% of the week so far, its 4 subagents included. The 5-hour window is 62% used and resets at
> 14:20; this would take about 9% more of it, and about 1% of the week (31% used, resets Mon 09:00).

Example note: "Token burn: starting 1 subagent, about 1.2M tokens (average of this session's 4), ~3% of the 5h
window, <1% of the week. This session so far: ~18% of 5h, 4% of the week."

As in v1, a number that is unknown is left out of the sentence, never shown as 0, and the rule that needs it does
not fire.

## The numbers

All token counts are the same sum `WindowTokens` uses (input + output + cache read + cache write, deduped), so a
session's count and the window's count are comparable.

- **Window share of the spawn** (v1's `WindowShare`, now called once per window): capacity ≈ window tokens ÷
  (window % ÷ 100), only when the window is ≥ 5% used and its tokens > 0. The week's tokens are read with cutoff =
  week reset − 7 days, as `windowtokenstore.ts` does.
- **Session share:** `session tokens in the window ÷ window tokens × window %`, rounded to a whole percent ("<1%"
  below 1). It apportions the reported percent, so it needs no 5% floor, only window tokens > 0. A session count
  above the window count (a file read between the two sums) is clamped to the window %.
- **Session tokens** cover the session's root transcript and every `.jsonl` under its `subagents/` dir, nested
  ones included (`transcriptRecords` already folds them). A path under `<session>/subagents/` is mapped to its root
  `<session>.jsonl` first, so a spawn from inside a subagent counts the whole session.
- **Per-agent estimate**, first that holds:
  - `session`: the mean total of this session's subagent files, when there are at least 2 finished ones;
  - `recent`: the mean total of the subagent files under `~/.claude/projects/*/*/subagents/` written in the last
    14 days, when there are at least 5 finished ones;
  - `default`: `PerAgentTokens` (1.5M), labelled "rough" as in v1.

  A file whose last record is under 60 s old is a subagent still running and is left out. The mean, not the
  median: the estimate is multiplied by the group's size, and a group's total follows the mean. Each file is one
  sample, a nested subagent included, so a subagent that spawned its own is counted low; fine for a rough number.
- `Estimate(agents) = agents × per-agent estimate`. A Workflow's "at least N" stays.

Known overstatement, said with "about": the window % counts usage this machine's transcripts never see (the
person's other machine, claude.ai on the web), so both the capacity and the session share lean high. The raw sum
also weighs a cache read like an output token and Opus like Sonnet, which the real limit likely does not.

## Components

### `pkg/usagestats`

`SessionBurn(path string, fiveHourCutoff, weekCutoff time.Time) SessionBurn`, computed in one pass so the session's
and the window's counts are taken together:

- `WindowFiveHour, WindowWeek int` (as `WindowTokens`), `SessionFiveHour, SessionWeek int`, `Subagents int` (the
  session's subagent files with a record inside the week window);
- `PerAgent int64`, `PerAgentSamples int`, `PerAgentSource string` (`session` | `recent` | `default`).

The recent scan goes through the existing per-file record cache (`cachedFileRecords`), so a spawn after the first
reads only changed files.

### RPC

`GetSessionBurnCommand(CommandGetSessionBurnData{Path, FiveHourCutoff, WeekCutoff})` → the fields above, in
`pkg/wshrpc/wshrpctypes_agents.go`, then `task generate`. An empty or unreadable `Path` leaves the session fields 0
and the per-agent source `recent` or `default`.

### `pkg/tokengate`

- `Quota` gains `WeekPct *float64`, `WeekReset *int64`, `WeekShare *int`, and `Session *SessionUse { FiveHourPct,
  WeekPct *int; Subagents int }` (nil when no transcript path was given).
- `Spawn` gains `PerAgent int64`, `PerAgentSamples int`, `PerAgentSource string`; `Estimate` uses `PerAgent` when
  set, else `PerAgentTokens`.
- `SessionShare(sessionTokens, windowTokens int64, windowPct float64) (int, bool)`.
- `Rules` gains `WeekPct` (default 80: the week is at least this full) and `SessionPct` (default 25: this session
  has already taken at least this much of the 5h window). 0 turns either off. `RulesFrom` grows to match.
- `Note` and `Question` gain the week clause, the session clause and the estimate's source.

### `wsh tokengate`

New flag `--transcript <path>`. `tokengateQuota` reads `GetClaudeQuotaCommand` as v1 does, then one
`GetSessionBurnCommand` replaces v1's `GetWindowTokensCommand` (5 s timeout; a failure only leaves those numbers
unknown and the estimate at `default`). A reset that is nil leaves that window's shares unknown.

### Settings

`tokengate:weekpct`, `tokengate:sessionpct` (`*float64`, nil = the default, 0 = off), then `task generate`.

### Claude mod

`tokengateArgs` adds `--transcript` from the path `register.ts` already keeps from `classic.UserPromptSubmit`
(the hook's own `transcript_path` when the event carries one). No path yet: the flag is left out.

## Failure and edge cases

- No transcript path, or a session with no usage in a window: the session clause is left out.
- A session started before the window: only its records inside the window count.
- A resumed session counts its own file; a `--fork-session` is a new file and starts from zero.
- Workflow agents: no workflow transcript exists on this machine to check where Claude Code writes them. If they land
  under the session's `subagents/` dir they count like any subagent; if not, the session share misses them. The
  plan's live step settles which and records it here.

## Testing

- Go `pkg/usagestats`: `SessionBurn` on a fixture tree: root plus nested subagent files, records on both sides of
  each cutoff, a subagent path mapped to its root; per-agent `session` with 2 finished files, a running file left
  out, `recent` with 5, `default` below that.
- Go `pkg/tokengate`: `SessionShare` (apportion, clamp, zero window), the week share, each new rule alone, at 0, and
  with its number unknown; `Note` and `Question` with each new clause present or absent and each estimate source.
- vitest: `tokengateArgs` with and without a transcript path.
- Live, after v1's live check: one session that ran subagents shows its share and a `session` estimate; a fresh
  session shows `recent`.

## Out of scope

- A whole engine run's cost at plan submit. It needs the same calibration per task rather than per subagent, from
  workers' transcripts; it stays the next step in `docs/deferred.md`.
- Showing the session share outside the gate (a Consumers row, the rail).
- Weighing cache reads and models the way the real limit does.

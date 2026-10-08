# Usage insights — design

Status: design settled 2026-10-08.

## Problem

The Usage surface folds Claude usage by harness × model × day (`pkg/usagestats` → `UsageBucket`). It
says how much was spent, not which tab spent it or why, so it cannot teach the user to spend quota
better. A one-off analysis of a week of transcripts (2026-10-01 → 10-08, 314 Claude sessions) showed
that the answer lives per session:

- 64% of spend was cache reads, i.e. context re-sent every turn; 26% cache writes; output only 10%.
- Turns above 200k context were 36% of turns and 60% of spend. Average context was 211k.
- The five most expensive tabs were 32% of the week. They were tabs kept open for days (57 h, 82 h)
  at 300–430k average context, or tabs that fanned out ~48 subagents.
- 82 resumes after more than an hour idle re-wrote the whole context at the 1-hour cache-write rate:
  ~7% of the week.

None of this is visible in the UI. Wanted: the per-tab numbers in Usage, with deterministic flags, and
an **Analyze** button that asks Claude to read them and say where the quota goes and what to change.

Out of scope: harnesses other than Claude (only Claude has a quota window and cache classes that make
the flags mean something); scheduled or automatic analysis; a history of past analyses; a follow-up
conversation about the result (opening an agent tab seeded with it).

## Decisions

### 1. Per-session usage: `pkg/usagestats`

- `Record` gains `Session` (the parent session id) and `Sub` (true for a record from a
  `<session>/subagents/*.jsonl` file, which is attached to its parent). Parsing and `parseCache` are
  unchanged, so a repeat scan still re-reads only files written since the last one.
- `ScanSessions(windowDays) []SessionUsage` folds Claude records per session:
  - `ID`, `Title` (the transcript's last `ai-title`, else the first user prompt, 80 chars),
    `Project` (the transcript directory, shortened; every `.waveterm-worktrees-*` directory folds to
    "engine run"), `Models`;
  - token classes (input, output, reasoning, cache read, cache write, cache write 1h) for the whole
    session, and the same classes for its subagents alone;
  - `Turns`, `AvgCtx`, `MaxCtx`, where a turn's context is input + cache read + cache write;
  - `ColdResumes`, `ColdTokens`: main-session turns that come more than 60 minutes after the
    session's previous turn and write more than 50k tokens of cache;
  - `FirstTs`, `LastTs`.
- Dedupe stays `message.id:requestId`. Print-mode records stay excluded, which also keeps the
  analysis call below out of the numbers it analyses.
- Spend is not computed in Go. The frontend prices token classes with `usagepricing.ts`, as it does
  for buckets, so there is one price table.

### 2. RPCs

- `GetSessionUsageCommand {windowDays}` → `{sessions: SessionUsage[]}`.
- `AnalyzeUsageCommand {windowDays}` → `{markdown, analyzedts, windowdays, model}`.
  - wavesrv builds a digest (`pkg/usagestats/digest.go`, pure): totals per token class, per model
    and per effort; the heaviest 5-hour windows; the context-size distribution (<100k, 100–200k,
    200–400k, 400–700k, >700k) with each band's share of turns and spend; and the 25 most expensive
    sessions with the fields above. It holds numbers, titles and project names only, never
    conversation text, and stays around 3–5k tokens. Spend in the digest uses a Go copy of the list
    prices for the relative weights only, labelled as such.
  - It runs `consult.Run` with `consult.HeadlessSpecForTier(consult.TierMid)` (Sonnet on the
    claude runtime), a 90 s timeout, and a fixed prompt: where the quota goes, which tabs cost most
    and why, the habits that waste it, what to change. It answers in `usage:insightslang` (empty
    means English).
  - One analysis at a time: a second call while one runs returns "already analysing".
  - It does not check quota itself: `pkg/quotagate` is only designed so far
    (`2026-10-07-quota-guard-design.md`). The button checks it instead (section 3). Once quotagate
    ships, the RPC also refuses while `quotagate.Held("claude")`.
  - On success it writes `insights/usage.json` in the data dir, so the last result survives a
    restart; `GetUsageInsightsCommand` reads it back. An empty or truncated reply is an error and does
    not overwrite the file. A failed write is logged and the result is still returned.
- `usage:insightslang` is a new `wconfig` setting. Run `task generate` after adding the types.

### 3. UI: two sections in the Usage detail pane

Both show only when the rail's scope is Claude (or Claude is the solo harness).

```
Header
Live limits | Historical            (unchanged)
INSIGHTS ─────────────── [Analyze]  new, under the KPI row
Daily chart | Where it goes         (unchanged)
Models                              (unchanged)
BY SESSION ──── 314 tabs · 7 days   new, last
```

**Insights card.** States, as a pure reducer in `usageinsights.ts`:

| State | Shows |
|---|---|
| never analysed | one line ("Claude reads the per-tab numbers, not your conversations, and points at what spends quota") and **Analyze** |
| running | skeleton lines, "Analysing… (~30 s)", button disabled |
| done | the markdown through `element/markdown.tsx`; meta "analysed 14:30 · 7 days · sonnet"; button reads **Re-analyze** |
| stale | done, plus a muted line when the result is older than 24 h or its window differs from the selected 7 days / All time. It never re-runs on its own |
| error | `SurfaceError` with retry; the previous result stays |
| held | Claude's live 5-hour or weekly window (`ratelimitstore`, the readings Live limits shows) is at or above 95%: button disabled, tooltip "Claude quota is at N% until …" |
| no Claude sessions | no button, "No Claude tabs in this window" |

**By session table.** One row per session, sorted by spend, 25 rows then "Show all". Columns: title,
project, model, a bar with the session's share of the window's Claude spend, average / peak context,
cold resumes, subagent share of spend, lifetime. Deterministic chips under the title
(`usagesessions.ts`, pure):

- **large context**: average context above 200k
- **cold resumes**: 3 or more
- **heavy subagents**: subagents above 50% of the session's spend
- **long-lived**: lifetime above 24 h

Clicking a row opens the session through the router: a live tab with `openTarget` (agent), an ended
one with `showSession`. The table follows the 7 days / All time control like the rest of the pane.

**Keys.** `a` runs Analyze on the Usage surface, bound in `bindings.ts` and listed in
`docs/keyboard-shortcuts.md`. `j`/`k` keep driving the rail.

Styling uses the existing `SectionRule`, `REGION_LABEL` and theme tokens (DESIGN.md). A `.dc.html`
mockup is approved before the UI is built.

## Testing

- **Go, `pkg/usagestats`:** session attribution, including subagent files → parent; average and peak
  context; the cold-resume rule at its edges (59 min no, 61 min with >50k cache write yes, 61 min with
  a small write no); dedupe; title from `ai-title`, then the first prompt; engine-run worktrees fold
  to one project.
- **Go, digest:** deterministic output, capped at 25 sessions, no conversation text; the prompt handed
  to `consult` is checked with a scripted runner; a concurrent call returns without calling it; an
  empty reply does not overwrite the saved result.
- **Vitest:** `usagesessions.ts` (pricing through `usagepricing`, chip thresholds, sort, the 25-row
  cut) and `usageinsights.ts` (the card's states, including held at 95%).
- **CDP:** a `usage-insights` scenario in `scripts/cdp/scenarios.mjs` injects sessions and a saved
  result, opens Usage → Claude, and screenshots the By session table and the Insights card done and
  empty.

## Docs

- `CHANGELOG.md`: one `Added` line.
- `docs/keyboard-shortcuts.md`: the `a` binding.

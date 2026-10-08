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

- `Record` gains `Session` (the parent session id: the transcript's file stem, or for a
  `<session>/subagents/*.jsonl` file the `<session>` directory above it), `Sub` (true for a subagent
  file's records), `Cwd` (the assistant line's `cwd`) and `Title`. `parseFile` sets them for Claude files,
  so `parseCache` keeps them and a repeat scan still re-reads only the files written since the last one.
- `Title` is the file's last `ai-title` record (Claude Code's running name for the session). The Claude
  line filter keeps lines carrying `"ai-title"` beside the usage lines for this. There is no first-prompt
  fallback: that needs the full transcript the usage filter skips. A session without one shows
  "Untitled" and its id.
- `ScanSessionUsage(windowDays) []SessionUsage` walks the Claude root only, keeps the records inside the
  window, dedupes them as `ScanUsage` does, drops `<synthetic>`, and folds them per `Session`:
  - `ID`, `Title`, `Project`: the last segment of the main records' `Cwd`, except that a cwd under a
    `.waveterm-worktrees` directory is "engine run";
  - `Models`: one entry per (model, sub) with the token classes (input, output, cache read, cache
    write, cache write 1h), so the frontend prices each with its own model's rate;
  - `Turns` and `SubTurns` (records), and over the main-session turns only `AvgCtx` and `MaxCtx`,
    where a turn's context is input + cache read + cache write;
  - `ColdResumes`, `ColdTokens`: main-session turns more than 60 minutes after the session's previous
    turn that write more than 50k tokens of cache;
  - `FirstTs`, `LastTs` (Unix ms).
- Print-mode records stay excluded, which also keeps the analysis call below out of the numbers it
  analyses.
- Spend is not computed in Go. Prices live only in `usagepricing.ts` (Opus 5.5 reads cache at a
  different rate from older Opus, so a second table would drift), and the frontend prices per model as
  it does for buckets.

### 2. RPCs and the analysis

- `GetSessionUsageCommand {windowdays}` → `{sessions: UsageSession[]}`.
- **The digest is built in the frontend** (`usagedigest.ts`, pure), because spend needs the one price
  table: totals per token class (tokens and spend), spend per model, tokens and spend per day, the
  share of spend in sessions whose average context is under 100k, 100–200k, 200–400k and above 400k,
  cold resumes and their spend at the 1-hour write rate, subagent share, and the 25 most expensive
  sessions with every field above, spend and share of the window. Numbers, titles and project names
  only, never conversation text; about 3–5k tokens.
- `AnalyzeUsageCommand {windowdays, digest}` → `UsageInsights {markdown, analyzedts, windowdays, model}`,
  in a new `pkg/usageinsights`:
  - It runs `consult.Run` with `consult.SpecForTier("claude", consult.TierMid)`: `claude -p --model
    sonnet`. Not the headless runtime, which defaults to openrouter: the person asked Claude to read
    their Claude usage. A 120 s timeout and a fixed prompt around the digest: where the quota goes,
    which tabs cost most and why, the habits that waste it, what to change, as short markdown sections
    ending with a numbered "what to change" list. It answers in `usage:insightslang` (empty means
    English).
  - One analysis at a time: a second call while one runs returns an "already analysing" error.
  - It does not check quota itself: `pkg/quotagate` is only designed so far
    (`2026-10-07-quota-guard-design.md`). The button checks it instead (section 3). Once quotagate
    ships, the RPC also refuses while `quotagate.Held("claude")`.
  - On success it writes `insights/usage.json` under the data dir, so the last result survives a
    restart; `GetUsageInsightsCommand` reads it back (an empty result when none). An empty reply is an
    error and does not overwrite the file. A failed write is logged and the result is still returned.
- `usage:insightslang` is a new `wconfig` setting. Run `task generate` after adding the types.

### 3. UI: provider tabs, two new sections, a compact chart row

The mockup is `.superpowers/design/usage-insights/` (Main: the whole surface on the Claude tab;
InsightsStates: the card's other states).

**Provider tabs replace the rail.** The 392 px harness rail goes. A tab strip under the surface header
holds one tab per harness with usage or a quota reading, ordered by tokens in the window, then **All**
at the right end. A tab shows the provider dot, the name, a LIVE / SAVED pill when the provider reports
quota, and its meta: `5h N% · wk N%` when it reports quota, else its tokens. The default tab is the
harness with the most tokens (Claude, for a Claude-heavy user). The strip is a `role="tablist"` in the
underline style of the details rail tabs (`TAB`, `TAB_ON`, `TAB_OFF` in `agentrailpanel.tsx`). The
rail's "Reporting quota / History only" grouping survives only as that meta. The detail pane takes the
full width and its `DetailHeader` goes, since the tab names the provider and its state.
`usageHarnessFilterAtom` stays the one selection; the tabs write it as the rail rows did.

**Order in the pane.**

```
Provider tabs                          replaces the rail
Live limits | Historical               unchanged
INSIGHTS ─────────────── [Analyze]     new, Claude tab only
BY SESSION ──── 314 tabs · 7 days      new, Claude tab only
Daily | Where it goes | Models         compacted into one row of three cards
```

**The chart row, compacted, on every tab.** `DailyChart`, `SplitCard` and `ModelGroup` sit in one grid
row (`1.25fr 1fr 1fr`, one column below the `@container` breakpoint) of equal-height cards:

- `DailyChart`: plot 96 px high; the Tokens / Spend toggle moves onto the section rule; day labels show
  the day only and a bar's tooltip carries its date and value; one line under the plot names the peak
  day.
- `SplitCard`: keeps the token and spend bars; the class table becomes a 2×2 legend, each cell
  `<class> <token %> · <spend %>`, with absolute tokens and dollars in the cell's tooltip.
- `ModelGroup`: one card per provider, 5 px bars, model names without the provider prefix the card
  heading already shows.

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
project (after a green "open" dot when the session's tab is still open), model, a bar with the session's share of the window's Claude spend, average / peak context,
cold resumes, subagent share of spend, lifetime. Deterministic chips under the title
(`usagesessions.ts`, pure):

- **large context**: average context above 200k
- **cold resumes**: 3 or more
- **heavy subagents**: subagents above 50% of the session's spend
- **long-lived**: lifetime above 24 h

Clicking a row opens the session through the router: a live tab with `openTarget` (agent), an ended
one with `showSession`. The table follows the 7 days / All time control like the rest of the pane.

**Keys.** `a` runs Analyze on the Usage surface, bound in `bindings.ts` and listed in
`docs/keyboard-shortcuts.md`. With the rail gone, `←`/`→` switch provider tabs, `j`/`k` move
through the By session rows and `Enter` opens one: `useSurfaceListNav` moves from the rail to the
table.

Styling uses the existing `SectionRule`, `REGION_LABEL` and theme tokens (DESIGN.md). A `.dc.html`
mockup is approved before the UI is built.

## Testing

- **Go, `pkg/usagestats`:** session attribution, including subagent files → parent; average and peak
  context over main turns; the cold-resume rule at its edges (59 min no, 61 min with >50k cache write
  yes, 61 min with a small write no); dedupe; title from the last `ai-title`; engine-run worktrees fold
  to one project. Over one fixture corpus, the session totals sum to the same tokens per class as
  `ScanUsage`'s Claude buckets, so the By session table and the KPI row cannot disagree.
- **Go, `pkg/usageinsights`:** the prompt carries the digest and the language; a scripted runner stands
  in for `consult.Run`; a concurrent call returns "already analysing" without calling it; an empty reply
  is an error and does not overwrite the saved result; save and load round-trip.
- **Vitest:** `usagesessions.ts` (pricing through `spendOf`, chip thresholds, sort, the 25-row cut, the
  live join), `usagedigest.ts` (deterministic, capped at 25 sessions, the context bands) and
  `usageinsights.ts` (the card's states, including held at 95%).
- **CDP:** a `usage-insights` scenario in `scripts/cdp/scenarios.mjs` seeds a dev-only fixture (sessions,
  a saved result, and the analyse outcome), opens Usage on the Claude tab, and screenshots the provider
  tabs, the By session table, the compact chart row, and the Insights card done, running, never
  analysed, stale, error and held. The existing `usage-charts` scenario selects scopes through the
  rail's `data-usage-harness` buttons; the tabs keep that attribute so it keeps working, and its shots
  change to the new layout.

## Docs

- `CHANGELOG.md`: one `Added` line.
- `docs/keyboard-shortcuts.md`: the `a` binding.

# Usage insights: levers — design

Follows `2026-10-08-usage-insights-design.md`, whose Insights card this replaces. Prototype:
`D:\work\arcterm\.superpowers\design\usage-insights-levers\project\` (Main, Narrow, Running).

## Problem

The card shows Claude's markdown in two columns, and on a wide window it reads badly:

- a wall of prose: the numbers that matter (spend by context band, subagent and cold-resume shares) sit inside
  sentences, and a `##` heading at 13.5px barely stands out from the body;
- lines run about 180 characters on a wide window, and the side tile ("What to change") is shorter than the main
  column, leaving a hole under it;
- tab titles are text, not links to the session;
- the advice repeats the prompt's fixed list of levers on every run and never says what a fix is worth;
- the saved analysis of 2026-10-13 says the digest's "Tokens and spend by class" and "Spend by model" tables were
  empty, so Claude could not separate cache writes from reads or Opus from Sonnet. Unverified: the code that builds
  them (`usagesurface.tsx` `analyze`, `aggregateBuckets(buckets, now, "claude")`) reads correctly.

## Decisions

### 1. Savings are computed in the frontend, in % of spend

A pure `usagelevers.ts` turns the window's `SessionRow`s into levers. Each lever is a set of candidate sessions,
each with the spend that lever could recover; a lever's total is the sum, shown as a share of the window's Claude
spend. Every figure is an upper bound and the UI says "at most".

| key | sessions | recoverable per session |
|---|---|---|
| `longctx` | `avgCtx` > 200k | main-session spend × (1 − 100k / `avgCtx`) |
| `bigread` | an oversized Read result | its tokens × (one 1-hour cache write + `rereadtokens` at the cache-read rate), at the session's main model's prices |
| `bigbash` | an oversized Bash result | as `bigread` |
| `opus` | an Opus session Claude names in `opusclear` | spend × (1 − Sonnet price / that Opus model's price), from `usagepricing.ts` |
| `cold` | `coldResumes` > 0 | `coldSpendUsd` |

Subagent spend is not a lever: subagents keep bulk reading out of the main context. A lever under 1% of spend is
hidden. Levers overlap (a long tab is often the one with big reads), so they are never summed; the card says so.

The unit is % of the window's spend for both windows. Weekly-quota points were considered and dropped: the weekly
meter counts from its last reset while the window is the last 7 days, so sessions before the reset would read 0,
and "points" needed explaining.

### 2. `rereadtokens` on each oversized tool result (Go)

`SessionBigResults` (`pkg/usagestats/sessions.go`) gains `RereadTokens`: for each main-conversation result, its
tokens (chars / 4) counted once for every main turn after the one that wrote it to the cache, stopping at the first
turn whose context falls by at least the result's tokens (a `/compact` or `/clear` dropped it). It is filled in
`foldSessions`, which has the turns, and summed per tool into `UsageBigResults.rereadtokens`. A subagent's result
gets 0: a session's subagent records carry no agent id, so one subagent's turns cannot be told from another's, and
its lever counts only the cache write. Wire type change: `task generate`.

### 3. Claude writes words, not numbers

`AnalyzeUsageCommand` gains `levers` (the candidates from section 1, sessions numbered `S1`, `S2`…). The digest
adds one table per lever with its five heaviest sessions by those ids, and a list of every Opus session with what
it would cost on Sonnet. The prompt keeps the `levers` knowledge text and the EN/VI language, and asks for JSON only:

```json
{
  "headline": "one sentence, at most 25 words",
  "levers": [{ "key": "longctx", "fix": "one sentence", "tabs": ["S3", "S7"] }],
  "opusclear": ["S2", "S9"],
  "tips": ["one sentence", "…"]
}
```

- `opusclear`: the Opus sessions whose titles read as clearly described work that Sonnet would do.
- `tips`: at most three general tips from the knowledge text that the numbers do not measure (CLAUDE.md size,
  `/rewind`, skills for repeated work), preferring ones no lever already covers.

Go (`pkg/usageinsights`) strips a code fence, parses, and drops an unknown `key` and any id that is not in the
request. A reply that does not parse is an error ("Claude's answer was not in the expected format"); the card keeps
the previous result beside it, as errors do today. `Insights` saves the request's levers next to the reply, so the
card draws the numbers Claude saw; the stale note covers numbers that moved since. The `opus` total is computed at
render from `opusclear`.

A saved analysis with markdown and no levers (every one before this ships) still renders through today's
`AnalysisBody` until the next Re-analyze.

### 4. The card

The rule above the card is unchanged (meta, EN/VI, Analyze). The card's own labels stay English like the rest of the
app; EN/VI picks the language of what Claude writes (headline, fixes, tips). The prototype draws the labels in
Vietnamese; the build uses the English ones named here. Inside the panel:

- **Headline**, 15px semibold, at most 72ch.
- **Wide container (`@3xl` and up)**: two columns.
  - Left, fixed 520px: "Recoverable · at most · % of spend", then one row per lever, ranked: rank, title,
    a 2px bar (`muted` fill on `edge-strong`, scaled to the largest lever), the value (`~22%`, `tabular-nums`).
    The selected row is `bg-surface-selected`. The rows are a `listbox`: ↑/↓ move the selection while it has
    focus (a local handler, not a surface binding, so no global key is taken). The first lever starts selected.
  - Below the levers, after a divider: a **General tips** row marked by a lightbulb icon in place of the rank, no
    bar, no value, and "not from your numbers" in muted text.
  - Right, `border-l border-edge-mid`: the selected lever's title and evidence ("41 tabs, avg 314k"), its
    fix line (13px, at most 64ch), then up to five tab chips and "+N". For General tips: the title, a bordered
    "not from your numbers" tag, and the tips as a list.
- **Narrow container**: one column; the bar moves under the title; the selected lever opens its chips and fix
  under its row, the others stay one line.
- A tab chip opens its session through the same `openSession` the By session table uses (a live tab through the
  router, an ended one as its transcript).
- Footer: "Levers overlap, so they don't add up."
- Running: the skeleton takes the two-column shape. Never, held, no-sessions, error and the stale note are
  unchanged.

Colors come from `@theme` tokens; no accent in the card except the focus ring.

### 5. The empty tables

The plan's first task reproduces the analysis in the dev app and logs the digest. If the class and model tables are
empty, it finds why and fixes it; either way a `usagedigest.test.ts` case pins that both tables are present whenever
the Claude buckets are.

## Testing

- `usagelevers.test.ts`: each formula, the 1% cut, ranking, `opusclear` summing, an unknown session id ignored.
- `usagedigest.test.ts`: lever tables and session ids in the digest; the class and model tables present.
- `pkg/usagestats`: `RereadTokens` counts later turns, stops at a context drop, keeps main and subagent apart.
- `pkg/usageinsights`: fenced and bare JSON parse; unknown key and id dropped; garbage is an error that keeps the
  saved result; a legacy markdown-only file still loads.
- CDP scenario `usage-insights-levers`: a saved levers result as fixture; shots of the wide card with a lever
  selected, with General tips selected, and the narrow card.

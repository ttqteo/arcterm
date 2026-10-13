# Usage insights: levers — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Usage → Insights card's markdown wall with a ranked list of levers (what each fix could recover,
in % of spend, computed in the frontend), where Claude writes only the words (headline, one fix per lever, which Opus
tabs were clear work, general tips) as JSON.

**Architecture:** `pkg/usagestats` adds `rereadtokens` to each session's oversized tool results. A pure
`usagelevers.ts` turns the By session rows into lever candidates (sessions with their recoverable $) and, from a saved
result, into the views the card draws. The Analyze RPC carries the candidates; `pkg/usageinsights` asks Claude for JSON,
validates it against the candidates and saves both. The card draws a two-column list + detail on a wide container and
an accordion on a narrow one; a saved markdown-only result still renders the old way.

**Tech stack:** Go (wavesrv), TypeScript/React 19 + Tailwind 4 + jotai, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-10-13-usage-insights-levers-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/usagestats/... ./pkg/usageinsights/... ./pkg/wshrpc/...`

**Final:** `node scripts/cdp/final-verify.mjs usage-insights usage-insights-levers`

**Prototype:** D:\work\arcterm\.superpowers\design\usage-insights-levers\project

Notes for every task:

- Never hand-edit generated files (`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`,
  `pkg/wshrpc/wshclient/wshclient.go`); change the Go type and run `task generate`.
- Typecheck with `task check:ts` (about 2 minutes; give the command a 5-minute timeout). Never `npx tsc`.
- Colors only from `@theme` tokens (`frontend/tailwindsetup.css`); no raw hex in components.
- The card's labels are English; the prototype's Vietnamese labels are not copied (spec section 4).
- Check formatting only on files you touched (`npx prettier --check <files>`, `gofmt -l <files>`).

---

### Task 1: Pin the digest's class and model tables, and expose the digest to scenarios

**Depends on:** none
**Files:** `frontend/app/view/agents/usagedigest.test.ts`, `frontend/app/view/agents/usageinsightsstore.ts`

The saved analysis of 2026-10-13 said the digest's "Tokens and spend by class" and "Spend by model" tables were empty.
The code that builds them looks right; this task pins the behaviour with a test and lets Task 7's scenario read the
digest the real surface sends.

**Step 1: Write the test.** In `usagedigest.test.ts` add a case that builds the stats the way the surface does,
from Claude buckets, and checks both tables have rows:

```ts
import { aggregateBuckets } from "./usagestats";

it("lists the class and model tables whenever Claude buckets exist", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    const day = "2026-10-12";
    const buckets: UsageBucket[] = [
        { harness: "claude", provider: "anthropic", model: "claude-opus-5-5", day, input: 1000, output: 2000,
          reasoning: 0, cacheread: 900_000, cachecreate: 80_000, cachecreate1h: 80_000, msgs: 10 },
        { harness: "claude", provider: "anthropic", model: "claude-sonnet-5-5", day, input: 500, output: 800,
          reasoning: 0, cacheread: 300_000, cachecreate: 20_000, cachecreate1h: 20_000, msgs: 4 },
        { harness: "codex", provider: "openai", model: "gpt-5.5", day, input: 100, output: 100,
          reasoning: 0, cacheread: 0, cachecreate: 0, cachecreate1h: 0, msgs: 1 },
    ];
    const digest = buildUsageDigest({
        windowLabel: "last 7 days",
        stats: aggregateBuckets(buckets, now, "claude"),
        rows: [],
    });
    const section = (title: string) => digest.split(`## ${title}`)[1]?.split("\n## ")[0] ?? "";
    expect(section("Tokens and spend by class")).toMatch(/\| Cache read \|/);
    expect(section("Spend by model")).toMatch(/claude-opus-5-5/);
    expect(section("Spend by model")).not.toMatch(/gpt-5\.5/);
});
```

Check the `UsageBucket` field names against `frontend/types/gotypes.d.ts` and the class label against
`CLASS_LABEL` in `usagestats.ts` before running; adjust the literals to match, not the code.

**Step 2: Run it.** `npx vitest run frontend/app/view/agents/usagedigest.test.ts`. Expected: PASS. If it fails, the
bug is in `buildUsageDigest` or `aggregateBuckets`: find it with superpowers:systematic-debugging, fix it, and keep the
test.

**Step 3: Record the digest in the dev fixture.** In `analyzeUsage` (`usageinsightsstore.ts`), when a dev fixture is
active, write the digest it was given back into the fixture before resolving, so a scenario can read what the surface
sent:

```ts
// a scenario reads back what the surface sent (usage-insights-levers)
function devRecordDigest(digest: string): void {
    try {
        const raw = localStorage.getItem(DEV_INSIGHTS_KEY);
        const value = raw != null ? JSON.parse(raw) : {};
        localStorage.setItem(DEV_INSIGHTS_KEY, JSON.stringify({ ...value, lastdigest: digest }));
    } catch {
        // a fixture that cannot be rewritten only loses the record
    }
}
```

Call it in the `fixture != null` branch before `devAnalyze`. Add `lastdigest?: string` to `DevInsightsFixture` and one
line for it in the fixture comment block.

**Step 4: Run the usage tests.** `npx vitest run frontend/app/view/agents/` — expected PASS.

**Step 5: Commit.**
`git commit -m "test(usage): pin the digest's class and model tables; dev fixture records the digest" -- frontend/app/view/agents/usagedigest.test.ts frontend/app/view/agents/usageinsightsstore.ts`

---

### Task 2: `rereadtokens` on oversized tool results

**Depends on:** none
**Files:** `pkg/usagestats/sessions.go`, `pkg/usagestats/sessions_test.go`, `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `frontend/types/gotypes.d.ts`

**Step 1: Write the failing test** in `sessions_test.go` (package `usagestats`, so `foldSessions` is reachable):

```go
func TestFoldSessionsRereadTokens(t *testing.T) {
	t0 := time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)
	turn := func(min int, ctx int) Record {
		return Record{TS: t0.Add(time.Duration(min) * time.Minute), Harness: "claude", Provider: "anthropic",
			Model: "claude-opus-5-5", CacheRead: ctx, Session: "s1"}
	}
	recs := []Record{
		turn(0, 50_000),
		turn(2, 80_000),  // writes the 40k-char result read at minute 1
		turn(3, 82_000),  // reads it
		turn(4, 84_000),  // reads it
		turn(5, 20_000),  // context fell by more than the result: compacted, stop
		turn(6, 22_000),
	}
	big := []BigToolResult{
		{TS: t0.Add(1 * time.Minute), Tool: "Read", Chars: 40_000, Session: "s1"},
		{TS: t0.Add(1 * time.Minute), Tool: "Read", Chars: 40_000, Session: "s1", Sub: true},
	}
	s := foldSessions(recs, big)[0]
	var main, sub SessionBigResults
	for _, b := range s.BigResults {
		if b.Sub {
			sub = b
		} else {
			main = b
		}
	}
	if main.RereadTokens != 2*10_000 {
		t.Fatalf("main RereadTokens = %d, want %d", main.RereadTokens, 2*10_000)
	}
	if sub.RereadTokens != 0 {
		t.Fatalf("sub RereadTokens = %d, want 0", sub.RereadTokens)
	}
}
```

**Step 2: Run it.** `go test ./pkg/usagestats -run '^TestFoldSessionsRereadTokens$'` — expected: FAIL to compile
(`RereadTokens` undefined).

**Step 3: Implement.**

- `SessionBigResults` gains `RereadTokens int` with a comment: main-conversation results only; a subagent's records
  carry no agent id, so its later turns cannot be told apart.
- Add `const charsPerToken = 4` beside `BigResultChars` use, commented as the estimate the digest also uses.
- In `foldSessions`, keep each session's main turns in time order: add `turns []mainTurn` to `acc`
  (`type mainTurn struct { ts time.Time; ctx int }`) and append `{r.TS, ctx}` where the main-turn branch computes
  `ctx`.
- Add the helper and use it where each `b` is added to its tool group (`byTool[k].RereadTokens += rereadOf(b, a.turns)`
  for `!b.Sub`):

```go
// rereadOf is how many tokens a main-conversation result is read back from the cache: its size once for every main
// turn after the one that wrote it, until a turn whose context falls by at least its size (a /compact or /clear
// dropped it).
func rereadOf(b BigToolResult, turns []mainTurn) int {
	tokens := b.Chars / charsPerToken
	total := 0
	wrote := false
	prev := -1
	for _, t := range turns {
		if !t.ts.After(b.TS) {
			continue
		}
		if prev >= 0 && prev-t.ctx >= tokens {
			break
		}
		prev = t.ctx
		if !wrote {
			wrote = true
			continue
		}
		total += tokens
	}
	return total
}
```

  `bySession[b.Session]` is the `acc` for the result's session; the loop over `big` already looks it up.
- `UsageBigResults` gains `RereadTokens int \`json:"rereadtokens,omitempty"\`` (comment: tokens of these results read
  back on later main turns, see usagestats.SessionBigResults); `sessionUsageToWire` copies it.

**Step 4: Run.** `go test ./pkg/usagestats -run '^TestFoldSessions'` — expected PASS. Then `task generate`.

**Step 5: Commit.**
`git commit -m "feat(usage): count how often an oversized tool result is read back" -- pkg/usagestats/sessions.go pkg/usagestats/sessions_test.go pkg/wshrpc/wshrpctypes_agents.go pkg/wshrpc/wshserver/wshserver_agents.go frontend/types/gotypes.d.ts`
(if `task generate` changes another file, add it to the commit and say so in the task report.)

---

### Task 3: Claude answers in JSON against the levers it is given

**Depends on:** Task 2
**Files:** `pkg/usageinsights/usageinsights.go`, `pkg/usageinsights/usageinsights_test.go`, `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `pkg/wshrpc/wshserver/wshserver_usageinsights_test.go`, `frontend/types/gotypes.d.ts`

Depends on Task 2 only so the two `task generate` runs do not conflict in the generated files.

**Step 1: Types in `usageinsights`.**

```go
// LeverSession is one session a lever could recover spend from; Ref ("S1") is how the digest and Claude name it.
type LeverSession struct {
	Ref     string  `json:"ref"`
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	SaveUsd float64 `json:"saveusd"`
}

// Lever is one fix the frontend priced (usagelevers.ts): its candidate sessions, and the evidence it shows (Count,
// Tokens: what they count depends on Key). Fix and Tabs are Claude's, filled from its answer.
type Lever struct {
	Key      string         `json:"key"`
	Count    int            `json:"count,omitempty"`
	Tokens   int            `json:"tokens,omitempty"`
	Sessions []LeverSession `json:"sessions"`
	Fix      string         `json:"fix,omitempty"`
	Tabs     []string       `json:"tabs,omitempty"`
}

// Request is what one analysis reads.
type Request struct {
	WindowDays int
	Digest     string
	Lang       string
	Levers     []Lever
	SpendUsd   float64 // the window's Claude spend, the levers' denominator
}
```

`Insights` gains `Headline string \`json:"headline,omitempty"\``, `Levers []Lever \`json:"levers,omitempty"\``,
`OpusClear []string \`json:"opusclear,omitempty"\``, `Tips []string \`json:"tips,omitempty"\`` and
`SpendUsd float64 \`json:"spendusd,omitempty"\``. `Markdown` stays: it is what a result saved before this change holds,
and a new result leaves it "".

**Step 2: Write the failing tests** in `usageinsights_test.go` for a new `parseReply(reply string, levers []Lever)
(reply, error)`, using the existing `run` seam style for `Analyze`:

- bare JSON parses; the same JSON inside a ```json fence parses; JSON after one line of preamble parses;
- a lever with an unknown `key` is dropped; a `tabs` ref not among any lever's sessions is dropped;
- an `opusclear` ref not in the `opus` lever's sessions is dropped;
- `tips` are trimmed, empty ones dropped, at most three kept;
- "not json" and a reply with an empty headline are errors whose message is
  `Claude's answer was not in the expected format`;
- `Analyze` saves `Headline`, the request's levers with `Fix`/`Tabs` filled, `OpusClear`, `Tips`, `SpendUsd`, and an
  empty `Markdown`; after a failed parse the saved file is unchanged;
- `Load` of a file holding only `{"markdown":"## x","analyzedts":1,"windowdays":7,"model":"sonnet"}` still returns
  that markdown.

Run `go test ./pkg/usageinsights` — expected FAIL (undefined).

**Step 3: Implement.**

- `parseReply`: take the text from the first `{` to the last `}` (this covers a fence and a preamble), unmarshal into

  ```go
  type reply struct {
  	Headline string `json:"headline"`
  	Levers   []struct {
  		Key  string   `json:"key"`
  		Fix  string   `json:"fix"`
  		Tabs []string `json:"tabs"`
  	} `json:"levers"`
  	OpusClear []string `json:"opusclear"`
  	Tips      []string `json:"tips"`
  }
  ```

  then filter as the tests say. `ErrFormat = errors.New("Claude's answer was not in the expected format")`.
- `Analyze(ctx, dir string, req Request, now func() time.Time)`: same busy lock, timeout and empty-reply error as
  today; on success copy `req.Levers`, set each lever's `Fix`/`Tabs` from the reply's lever with the same key, and
  save. Errors keep the saved file as it was.
- `Prompt(digest, lang)` asks for JSON only. Replace the section paragraph with:

  ```
  Answer with one JSON object and nothing else:
  {"headline": "...", "levers": [{"key": "...", "fix": "...", "tabs": ["S1"]}], "opusclear": ["S2"], "tips": ["..."]}
  - headline: one sentence of at most 25 words on where the spend goes, citing one number from the digest.
  - levers: one entry per lever in the digest's "Levers" section, same key; fix is one sentence on what to change,
    concrete to these tabs; tabs are up to five session refs (S1, S2, ...) from that lever's table, most telling first.
  - opusclear: the refs in the "opus" table whose titles read as clearly described work Sonnet would do.
  - tips: at most three one-sentence tips from the notes below that the numbers do not measure, preferring ones no
    lever covers.
  Write every string in %s. Do not invent numbers: the card shows the digest's own.
  ```

  Keep the `levers` knowledge constant and the `<digest>` fence as they are.
- Wire: `UsageLeverSession`, `UsageLever` mirror the Go types with the same json tags; `CommandAnalyzeUsageData`
  gains `Levers []UsageLever \`json:"levers,omitempty"\`` and `SpendUsd float64 \`json:"spendusd,omitempty"\``;
  `UsageInsights` gains the five new fields. `AnalyzeUsageCommand` builds a `usageinsights.Request`;
  `usageInsightsToWire` copies everything. Update `wshserver_usageinsights_test.go` for the new signature.

**Step 4: Run.** `go test ./pkg/usageinsights ./pkg/wshrpc/wshserver -run 'Insights|Analyze|Usage'` — expected PASS.
Then `task generate`.

**Step 5: Commit** the Go files and the regenerated ones by name:
`git commit -m "feat(usage): Analyze returns a headline, a fix per lever, clear Opus tabs and tips as JSON" -- <files>`

---

### Task 4: `usagelevers.ts` — price the levers and build the card's views

**Depends on:** Task 1, Task 3
**Files:** `frontend/app/view/agents/usagelevers.ts`, `frontend/app/view/agents/usagelevers.test.ts`, `frontend/app/view/agents/usagesessions.ts`, `frontend/app/view/agents/usagesessions.test.ts`

**Step 1: Session rows carry what the levers price.** `SessionRow` gains, optional so existing fixtures still type:

```ts
mainModel?: string; // the main conversation's model id, unstripped, for its prices
opusSpendUsd?: number; // spend on Opus models, main and subagents
opusAsSonnetUsd?: number; // the same tokens at the Sonnet price of that generation
```

In `buildSessionRows` set `mainModel: main`, and for each model whose id contains `opus` add `modelSpend(m)` to
`opusSpendUsd` and `modelSpend({ ...m, model: sonnetFor(m.model) })` to `opusAsSonnetUsd`, with

```ts
// the Sonnet an Opus tab would have run on: the same generation's (priceFor's "sonnet-5" row covers 5 and 5.5)
function sonnetFor(model: string): string {
    return model.includes("opus-5") ? "claude-sonnet-5-5" : "claude-sonnet-4-5";
}
```

Add a `usagesessions.test.ts` case: an `claude-opus-5-5` model with 1M cache-read tokens gives
`opusSpendUsd` 0.2 and `opusAsSonnetUsd` 0.2 (the cache-read rates are equal), and 1M output gives 20 and 10.

**Step 2: Write `usagelevers.test.ts` first**, for these exports:

```ts
export type LeverKey = "longctx" | "bigread" | "bigbash" | "opus" | "cold";
export const LONG_CTX_FROM = 200_000;
export const LONG_CTX_TARGET = 100_000;
export const MIN_SHARE = 0.01;
export const MAX_TABS = 5;

// The candidates Analyze sends: every lever with a session it could recover spend from, sessions by saving.
// A session's ref is S + its 1-based place in `rows` (sorted by spend), the same in every lever and the digest.
export function buildLevers(rows: SessionRow[]): UsageLever[];

export function sessionRef(index: number): string; // 0 -> "S1"

export interface LeverView {
    key: LeverKey;
    totalUsd: number;
    share: number; // of the saved spendusd, 0..1
    count: number;
    tokens: number;
    fix?: string;
    tabs: UsageLeverSession[]; // at most MAX_TABS: Claude's tabs, else the heaviest sessions; for opus, opusclear
    more: number; // sessions beyond `tabs`
}

// The levers a saved result draws: opus totals only the opusclear sessions; under MIN_SHARE hidden; largest first.
export function leverViews(ins: UsageInsights): LeverView[];

// A saved analysis with something to show: markdown (saved before levers) or a headline.
export function hasInsights(ins: UsageInsights | undefined): boolean;
```

Cases, each with a hand-made `SessionRow`:

- `longctx`: `avgCtx` 300k, spend 10, sub spend 2 → saves `8 × (1 − 100k/300k)` = 5.333…; `avgCtx` 200k exactly → no
  candidate; `count` = sessions, `tokens` = rounded mean `avgCtx` of the candidates.
- `bigread`: one Read group `{tool: "Read", count: 2, chars: 80_000, rereadtokens: 100_000}` on main model
  `claude-opus-5-5` → `(20_000 × 8 + 100_000 × 0.2) / 1e6` = 0.18; a `sub` Read group counts only the write;
  `count` = results, `tokens` = chars / 4. `bigbash` the same with `tool: "Bash"`; any other tool is in neither.
- `opus`: a row with `opusSpendUsd` 30, `opusAsSonnetUsd` 12 → saves 18; a row with no Opus → absent.
- `cold`: `coldSpendUsd` 3 → saves 3; `count` = summed `coldResumes`.
- a lever with no candidate is left out; sessions sort by `saveusd` descending; refs follow row order.
- `leverViews`: a lever under 1% of `spendusd` is hidden; order is by `totalUsd`; opus with `opusclear: ["S2"]` totals
  only S2; `tabs` follow Claude's order and drop unknown refs; with no Claude tabs it takes the heaviest five;
  `more` = sessions − tabs shown (for opus: opusclear − shown).
- `hasInsights`: undefined → false; `{markdown: ""}` with no headline → false; markdown → true; headline → true.

Run `npx vitest run frontend/app/view/agents/usagelevers.test.ts` — expected FAIL.

**Step 3: Implement** `usagelevers.ts` as a pure module with the header comment the other usage models carry ("Pure
model … No React, no Wave runtime imports"), pricing through `priceFor` (`usagepricing.ts`). Per-session savings:

| key | saving |
|---|---|
| `longctx` | `avgCtx > LONG_CTX_FROM` ? `(spendUsd − subSpendUsd) × (1 − LONG_CTX_TARGET / avgCtx)` : 0 |
| `bigread` / `bigbash` | Σ over the row's `bigResults` with tool `Read` / `Bash`: `(chars/4 × cacheWrite1h + (sub ? 0 : rereadtokens) × cacheRead) / 1e6` at `priceFor(mainModel)`; no price → 0 |
| `opus` | `max(0, opusSpendUsd − opusAsSonnetUsd)` |
| `cold` | `coldSpendUsd` |

**Step 4: Run** the two test files — PASS — and `npx vitest run frontend/app/view/agents/`.

**Step 5: Commit.**
`git commit -m "feat(usage): price the insights levers from the session rows" -- frontend/app/view/agents/usagelevers.ts frontend/app/view/agents/usagelevers.test.ts frontend/app/view/agents/usagesessions.ts frontend/app/view/agents/usagesessions.test.ts`

---

### Task 5: The digest names the levers; Analyze sends them; a levers result counts as a result

**Depends on:** Task 4
**Files:** `frontend/app/view/agents/usagedigest.ts`, `frontend/app/view/agents/usagedigest.test.ts`, `frontend/app/view/agents/usageinsightsstore.ts`, `frontend/app/view/agents/usageinsights.ts`, `frontend/app/view/agents/usageinsights.test.ts`, `frontend/app/view/agents/usagesurface.tsx`

**Step 1: Tests first.**

- `usagedigest.test.ts`: `buildUsageDigest` takes `levers: UsageLever[]`. The top sessions table's first column is
  `ref` with `S1`, `S2`…; a `## Levers (what each fix could recover at most)` section has one `### <key>: at most
  $X (Y% of spend)` heading per lever and a table `ref | title | project | saves` of its five heaviest sessions; the
  `opus` lever's table lists every candidate (cap 40) with `models | spend | saves on Sonnet`. No levers →
  "No lever applies in this window."
- `usageinsights.test.ts`: `insightsCard` treats `{markdown: "", headline: "x", levers: [...]}` as `done`, and
  `{markdown: ""}` with no headline as `never` (use `hasInsights`).

Run both — FAIL.

**Step 2: Implement.**

- `buildUsageDigest`: the new section after the top sessions table; `cell()` for titles; refs from `sessionRef`.
- `usageinsights.ts`: `insightsCard` uses `hasInsights` instead of `markdown !== ""`.
- `usageinsightsstore.ts`: `analyzeUsage(windowDays, digest, lang, levers, spendUsd)` sends
  `{ windowdays, digest, lang, levers, spendusd }`; `loadSavedInsights` keeps a result when `hasInsights(ins)`;
  `devAnalyze`'s default result becomes a small levers result (headline, the given levers with a fix each, one tip)
  so a scenario that presses `a` without a `result` gets the new card.
- `usagesurface.tsx` `analyze`: `const levers = buildLevers(sessionRows)`; pass them to `buildUsageDigest` and
  `analyzeUsage`, with `spendUsd = sessionRows.reduce((s, r) => s + r.spendUsd, 0)`.

**Step 3: Run** `npx vitest run frontend/app/view/agents/` and `task check:ts` — PASS / exit 0.

**Step 4: Commit** the five files by name:
`git commit -m "feat(usage): Analyze sends the priced levers and the digest names them" -- <files>`

---

### Task 6: The levers card

**Depends on:** Task 5
**Files:** `frontend/app/view/agents/usageleversbody.tsx`, `frontend/app/view/agents/usageinsightscard.tsx`, `frontend/app/view/agents/usageinsightsstore.ts`, `frontend/app/view/agents/usagesurface.tsx`

Read `DESIGN.md` and the prototype boards first (`Main.dc.html`, `Narrow.dc.html`, `Running.dc.html` under the
Prototype path). Copy sizes from the boards; take colors from tokens: `bg-surface-raised` panel, `bg-surface-selected`
selected row, `border-edge-mid` dividers, bar `bg-muted` on `bg-edge-strong`, text `text-primary` / `text-ink-hi` /
`text-secondary` / `text-muted` / `text-ink-faint`.

**Step 1: Selection survives the surface unmounting.** In `usageinsightsstore.ts`:

```ts
// the lever the Insights card shows, or "tips"; a module atom since the Usage surface unmounts on switch
export const insightsLeverAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;
```

An unknown or missing key means the first lever.

**Step 2: `LeversBody({ ins, now, note, onOpenSession })`** in `usageleversbody.tsx`, from `leverViews(ins)`:

- the optional stale `note` on top (as `AnalysisBody` does), then the headline: `text-[15px] font-semibold
  leading-[1.45] text-primary max-w-[72ch]`.
- `data-usage-levers` on the root. Labels: `LEVER_TITLE = { longctx: "Long context", bigread: "Oversized reads",
  bigbash: "Noisy Bash output", opus: "Opus on clear work", cold: "Cold resumes" }`; evidence: `longctx` "N tabs, avg
  314k"; `bigread`/`bigbash` "N results, ≈2.5M tokens"; `opus` "N tabs"; `cold` "N resumes" (numbers through `fmt`
  from `usagestats.ts`). The value is `~22%` (`Math.round(share × 100)`, `<1%` never shows since those are hidden).
- **Wide (`@3xl:`)**: `flex flex-col @3xl:flex-row @3xl:gap-7`. Left column `@3xl:w-[520px] flex-none`: header row
  "Recoverable" (`REGION_LABEL text-muted`) and "at most · % of spend" (10.5px muted); a `role="listbox"
  aria-label="Levers"` of `role="option"` buttons, each `data-usage-lever={key}` `aria-selected`: rank (12px
  ink-faint), title (13px medium ink-hi, truncate), the 2px bar (140px wide, width = total / largest), the value
  (13px semibold tabular-nums, 44px right-aligned). After a `border-t border-edge-mid` divider, the General tips
  option (`data-usage-lever="tips"`): lucide `Lightbulb` 12px ink-faint in place of the rank, "General tips"
  (13px medium secondary), "not from your numbers" (11px muted); only when `ins.tips?.length`. Right column
  `hidden @3xl:flex flex-1 min-w-0 flex-col gap-3 border-l border-edge-mid pl-7` with `data-usage-lever-detail={key}`:
  the selected lever's title (`REGION_LABEL text-muted`) and evidence, the fix (13px leading-[1.6] ink-hi
  max-w-[64ch]), the tab chips; or for tips the title, a bordered "not from your numbers" tag and the tips as a list.
- **Narrow**: the same rows; under the selected row (`@3xl:hidden`) its chips and fix, indented to the title.
- **Chips**: `<button data-usage-lever-tab={session.id} title="Open this tab">` with the session title,
  `h-6 rounded-md border border-edge-mid bg-surface px-[9px] text-[11.5px] text-secondary hover:border-edge-strong`;
  then "+N" (11.5px muted) when `more > 0`. Click → `onOpenSession(session.id)`.
- **Keys**: `onKeyDown` on the listbox: ArrowDown / ArrowUp move the selection (tips last), move focus to the newly
  selected option, `preventDefault()` and `stopPropagation()` so the surface's own bindings do not also run. Check
  `buildUsageBindings` in `frontend/app/store/keybindings/bindings.ts` and the session table's cursor keys: if the
  bindings listen in the capture phase, stopping propagation is not enough; then skip the global binding while
  `document.activeElement` is inside `[data-usage-levers]` instead.
- Footer: "Levers overlap, so they don't add up." (11px muted).
- No motion beyond what `motiontokens.ts` offers; none is needed here.

**Step 3: Wire it.** In `UsageInsightsCard`, where a result is drawn (`done`, and `error` with `prev`): render
`LeversBody` when `ins.headline` is set, else the existing `AnalysisBody` (a result saved before this change). Add
`onOpenSession: (id: string) => void` to its props; in `usagesurface.tsx` pass an `id → openSession(row)` lookup over
`sessionRows` that does nothing when the row is not in the window. `RunningBody` takes the prototype's two-column
skeleton shape (`SkeletonLine`s: a 56% headline line, five rows on the left, three lines in the right column under
`@3xl`).

**Step 4: Check.** `task check:ts` (exit 0); `npx vitest run frontend/app/view/agents/`;
`npx prettier --check` and `npx eslint` on the touched files.

**Step 5: Commit** the files by name:
`git commit -m "feat(usage): Insights shows ranked levers with a detail column and general tips" -- <files>`

---

### Task 7: CDP scenario, changelog, hand check

**Depends on:** Task 6
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/open-issues.md`

**Step 1: Scenario `usage-insights-levers`** (surface `usage`), next to `usageInsights` in `scenarios.mjs` and
registered the same way. Reuse its arrange and teardown helpers (`usageInsightsSessions`, the bucket and rate-limit
seeding, `UI_KEY`), but give the bigger sessions `bigresults` (a `Read` group with `rereadtokens`, a `Bash` group), two
with an `claude-opus-5-5` model, and some `avgctx` above 200k, and set `saved` to a levers result:
`{ markdown: "", headline, levers: [...with fix and tabs...], opusclear: [...], tips: [3 tips], spendusd,
analyzedts: now, windowdays: 7, model: "sonnet", lang: "en" }` built from those sessions' refs. Steps, each with a shot:

1. **wide, lever selected**: viewport 1600×950 (`Emulation.setDeviceMetricsOverride`, as other scenarios do). Assert
   `[data-usage-levers]` exists, the options are ranked by value, the first is `aria-selected="true"`,
   `[data-usage-lever-detail]` names it and shows its fix and chips. Press ArrowDown inside the listbox: the second
   option is selected and the detail follows.
2. **wide, general tips**: click `[data-usage-lever="tips"]`; the detail shows "not from your numbers" and three items.
3. **chip opens the tab**: click a `[data-usage-lever-tab]` of an ended session; the Agent surface shows its
   transcript (assert the way `usage-insights` checks a By session row opening).
4. **narrow**: viewport 900×950; the detail column is hidden and the selected row shows its fix under it.
5. **running**: set the fixture's `analyze` to `"hang"`, press `a`; the running skeleton has the two-column shape.
6. **the digest the surface sent**: with `analyze: "ok"` and seeded buckets, press `a`, wait for `done`, read
   `lastdigest` from the fixture: it holds a non-empty "Tokens and spend by class" table, a non-empty "Spend by model"
   table and a "## Levers" section (Task 1's check, end to end).

Teardown restores every localStorage key and the viewport. Run it against a dev app you started:
`task verify:ui -- usage-insights-levers usage-insights` — both PASS (`usage-insights` covers the legacy markdown body,
which must still render).

**Step 2: CHANGELOG.** Under the top `## Unreleased` → `Changed` (open the section if it has none):

```
- **Usage → Insights ranks what to change by what it would save**: each fix (long context, oversized reads, noisy
  Bash output, Opus on clear work, cold resumes) shows at most how much of the window's spend it recovers, the tabs
  behind it open with a click, and a General tips row holds advice your numbers do not measure. Re-analyze once to
  get the new card.
```

Stage only that hunk if the file has other unstaged edits (`git add -p CHANGELOG.md`), then a bare `git commit`.

**Step 3: Hand check.** Add to `docs/open-issues.md` under "0 · Waiting on a hand check":
`- [ ] (arcterm) Usage → Insights levers: Re-analyze in the installed app; the levers' sizes look plausible against the By session table, chips open their tabs, EN/VI changes the words only.`

**Step 4: Commit** `scripts/cdp/scenarios.mjs` and `docs/open-issues.md` by path (the CHANGELOG hunk as above):
`git commit -m "test(usage): usage-insights-levers scenario; changelog and hand check" -- scripts/cdp/scenarios.mjs docs/open-issues.md`

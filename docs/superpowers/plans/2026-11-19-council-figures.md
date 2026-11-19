# Council figures in the Report Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A finished council's Report (and its Map tab, and Library's Councils tab for the benchmark) shows six figures
drawn from what the council recorded, each with a one-line takeaway, so the person sees at a glance which directions
stand, where the panel split, where the tokens went, and whether a council beats one agent.

**Architecture:** One pure model, `councilfiguresmodel.ts`, derives every figure's data and takeaway from the `Council`
object the cockpit already holds (and from `CouncilBenchResultsRtnData` for the benchmark); thin `.tsx` views draw them
as inline SVG with theme tokens; one wiring task places them and adds the CDP scenarios. No model call draws or words a
figure: every number and every takeaway is computed. The glance quadrant uses the same formula as the `.md` chart in
`pkg/council/charts.go` (`directionPoint`), held to it by a shared golden file. Task 1 lands the model's types and
stubbed functions, so the model (Task 3) and the four views (Tasks 4–7) are built side by side.

**Tech Stack:** React 19, TypeScript, Tailwind 4 tokens (`frontend/tailwindsetup.css`), inline SVG, jotai, vitest, Go
(one golden test), CDP scenarios (`scripts/cdp/council/*.mjs`, registered in `scripts/cdp/councilscenarios.mjs`).

**Already in place:** `feat/council-charts` is merged into `main` (1d3356077). It carries `pkg/council/charts.go`
(`directionPoint`, `workSpans`, `writeGlanceChart`), which Task 3 reads, and the bench's `CouncilBenchRow.recall5` and
`allscored`, which Task 3 and Task 7 read. The canvas below was approved on 2026-11-19. Running
`wsh council bench rejudge` on the installed app fills recall@all for the real Review rows. The scenarios stub their own
results, so no task waits on it.

**Prototype:** D:\work\arcterm\.superpowers\design\council-figures\project

**Verify:** `node scripts/verify.mjs ./pkg/council/...`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs council-summary council-map council-figures council-figures-graph council-bench-chart`

---

## The six figures (spec every task reads)

Rules for all six (DESIGN.md "Status", the dataviz checks run 2026-11-19):

- Colour never carries meaning alone. Measured on `#1c1c1c`: `success` and `error` are ΔE 2.0 apart for a deuteranope,
  so a stance always shows its glyph and word (✓ Accept, ? Challenge, ✕ Oppose, ● Proposed), and on an edge its dash
  pattern. The seat tones `conn-*` sit above the lightness band for a dark surface, so a seat is told apart by its row,
  avatar and name; its avatar tone is never a chart series colour.
- Text wears text tokens (`text-primary`, `text-secondary`, `text-muted`), never a series colour.
- Every figure is a `<figure>` whose `<figcaption>` is its takeaway line (computed, see each figure), has a **Table**
  toggle that shows the same numbers as a table, hover tooltips with hit targets larger than the mark, and keyboard
  focus in reading order (Enter does what a click does).
- Marks: 2px lines, 4px rounded bar ends on the baseline, ≥8px points, a 2px surface gap between adjacent fills,
  recessive axes (`edge-faint`), one axis per chart.
- Motion (`element/motiontokens.ts`): a section fades in with `viewFade` when it mounts; a hover highlight changes
  opacity over the fast duration; the Map's Matrix/Graph switch crossfades with `viewFade`; a spend bar on a running
  council eases its width to the new value. Reduced motion: no transitions. Nothing cascades.
- A figure with nothing to show is not drawn (no empty frame): the conditions are under each figure.

### A. At a glance: evidence × agreement (Report, Review only)

- Shown when the council is Review and its summary has a direction.
- One point per direction, labelled `D<rank>` beside it.
- **x = evidence held:** among the evidence of the direction's `from` proposals, the share with `cite === "ok"` and
  not `weak`.
- **y = agreement:** (the authors of its proposals + the other seats whose stance is accept), divided by (the authors
  + every other seat with a stance).
- Both formulas are exactly `directionPoint`'s in `pkg/council/charts.go`. `held/evidence` is that x and
  `backers/sides` that y, before any clamping.
- A direction whose proposals carry no evidence at all is drawn hollow, with "no evidence cited" in its tooltip, so 0
  of 0 never reads like 0 of 3.
- The drawn coordinates are placed the way `writeGlanceChart` places them: clamped to 0.08–0.9 (`ChartUnit`), then,
  in rank order, a point within 0.04 of one already placed is nudged 0.05 inward (`nudge`), at most 4 times. The point's
  `x`/`y` are these placed coordinates.
- Plot about 320×240, square cells. The four quadrant names sit muted in the corners: Stands (top right), Backed on thin
  evidence (top left), A guess (bottom left), Shown but contested (bottom right).
- **Tooltip:** the title, "evidence held n of m", "backed by k of s seats".
- **Click:** opens that direction's card (the Report's one-open-card state) and scrolls to it.
- **Takeaway:**
  - "D1 and D3 stand on checked evidence and the panel's backing", naming the directions in the top right quadrant
    (unclamped x ≥ 0.5, y ≥ 0.5).
  - When every direction is there: "All five directions stand on checked evidence; D5 has the thinnest backing (1 of 2
    seats)", naming the one with the lowest y. This is council 4e9f4589's real case: every direction sits top right.
  - With none there: "No direction stands on both checked evidence and the panel's backing".
  - Then, when any direction is in the bottom left quadrant: "; D4 is a guess".

### B. Stance grid: direction × seat (Report, both modes)

- Shown when the summary has a direction.
- A real `<table>`:
  - **Rows:** directions in rank order.
  - **Columns:** the panel seats (avatar and short name) in panel order, the coordinator left out.
  - **Last column:** an agreement bar (backers/sides, as in A) with "Agreed" or "Split" from `d.agreed`, as a word.
- **Cells:** the seat that authored one of the direction's proposals shows ● Proposed (the `bg-pill` tint). Otherwise
  the seat's stance glyph and word on the existing `STANCE_PILL` tint, or a muted dash for no stance. `builds` is not a
  stance (`direction.stances` never holds it): it is a flag on a reply (`CouncilReply.builds`). In a Brainstorm, a seat
  with no stance on the direction that has a reply with `builds: true` to one of the direction's `from` proposals reads
  "Builds on".
- **Row hover:** the row lifts (`surface-hover`).
- **Click:** opens that direction, as in A.
- **Takeaway:**
  - "The panel split on D2 and D5", naming the rows with an oppose or with `agreed` false.
  - With none: "Every direction kept the panel's backing".
  - Then "; UX challenged most (2)", naming the seat with the most oppose stances, or, when no seat opposed, the most
    challenges; when no seat opposed a direction, add "No seat opposed a direction."

### C. What each seat spent (Report, under the kept ideas)

- Shown when `c.stats` has a seat with tokens.
- Horizontal bars, one row per seat (the coordinator included), in panel order, coordinator last. Order is by panel
  position, never by size, so colour and position follow the seat.
- Each row: the seat's avatar, name and model (`CouncilExpert.model`, muted), then the bar.
- One series: the bar is `accent` at 60%, its length its tokens on one shared linear axis.
- At the bar's end, in text tokens: "3.0M · 2 calls · 1.5M a call".
- Header line: "9.0M tokens in 15 calls · 8 min 18 s of reading and writing": the council's own `tokens` and `calls`
  (the Run facts figures), then the seats' `stats.ms` summed. The seats' `stats` can add up to fewer tokens and calls
  (council 4e9f4589: 14 calls and 38k fewer tokens), so a last muted row "Memory check · outside the seats" carries the
  difference, and the rows always add up to the header.
- **Tooltip:** time spent (`ms`), calls, tokens per call.
- **Click:** opens the Discussion on that seat's messages alone (what the Glance panel's seat already does).
- **Takeaway:** "Đo RAM spent a third of the tokens (3.0M of 9.0M)", naming the seat with the largest share in words:
  "half", "a third", "a quarter", else "n%". Shown only when that share is ≥ 25%; with no seat that large: "The seats
  spent alike". Then ", at 1.5M a call: over twice any other seat" when its tokens per call are at least twice the
  next seat's.

### D. When each seat worked, and what it read twice (Report, under C)

- Shown when `c.timeline` has a step with a time.
- **Lanes:** one per seat in panel order, on a time axis from the first step to the last, labelled in minutes from the
  start.
- **Spans:** each lane's stretches come from `workSpans` (`pkg/council/charts.go`): steps no more than 60 s apart join
  one stretch, and a stretch is at least 5 s wide. They are drawn as 4px-rounded bars in `accent` at 45%.
- **Step marks** on the stretch, told apart by shape, not colour: a read is a tick, a search a dot, a command (`run`) a
  square, and a post (`propose` or `reply`) a small flag; the legend names each, the flag as "posted an idea or reply".
- **Shared reads:** a read of a file another seat also read is drawn hollow. Paths are compared as slash paths with case
  folded, as `chartSeats` does.
- **Round markers:** a muted vertical rule at the first post of each round, labelled R1, R2…. Round 1 is the earliest
  proposal `ts`; round n is the earliest reply with `round === n`.
- When a seat's timeline holds `MAX_TIMELINE_STEPS` steps (200, Go's `MaxTimelineSteps`), the lane says "first N steps
  kept".
- **Tooltip** on a stretch: from–to clock, the number of steps, its three most-read targets.
- **Under the lanes:** a list headed "Read by more than one seat": file, the seats' avatars, the total reads. At most 8
  rows, sorted by seat count and then by reads; past 8, a last muted row "and N more: <the next file> (<its seats>, <its
  reads> reads)".
- **Takeaway:**
  - "9 files were read by two or more seats (27 reads); the chatsuggest council report by four", naming the file read
    by the most seats when that is ≥ 3.
  - Then "184 of 232 steps came in each seat's first stretch, before it posted": the steps in each seat's first span,
    summed.
  - With no shared read: "No seat read a file another one read".
  - A seat with no step (the coordinator) has no lane; the legend says so in one line.

### E. Argument map (Map tab: a Matrix | Graph switch above the stance matrix, Matrix by default)

- Shown when the council has a sent proposal.
- Two columns:
  - **Left:** the seats in panel order (avatar, name, and "N replies" muted under it), plus a "You" row when the person
    replied to an idea.
  - **Right:** the ideas grouped by outcome, in this order: one group per direction (headed `D<rank>` and its title),
    then Also raised, Withdrawn, Cut. An idea merged into a direction sits in that direction's group, its title led by
    "merged ·".
  - An idea node is its id, a one-line title cut with an ellipsis, and its label chip (Ran, Read, Guess, Disproved).
  - Rows are 28px. A withdrawn or cut idea is dimmed.
- **Edges:** horizontal cubic curves from a seat to an idea.
  - The author's edge is solid neutral, "proposed".
  - A reply's edge takes its stance: accept solid, challenge dashed, oppose dotted, with the stance glyph at the idea
    end, on the stance's status token.
  - Several replies from one seat to one idea are one edge with a count. A reply to a reply counts toward its proposal.
- **Hover** an idea or a seat: its edges stay full, the rest drop to 20% opacity, and the tooltip counts its stances
  ("3 accept, 1 challenge, 2 oppose").
- **Click** an idea: switches to Matrix with that idea's row open, which is the matrix's own reasons view.
- **Scroll:** the graph scrolls vertically inside its box. The layout is fixed by order, so nothing moves between
  renders.
- **Takeaway:**
  - Lead with the tally when one stance is most of them: "Every idea drew a reply, but 21 of 23 stances were
    challenges and no seat opposed" (council 4e9f4589's real shape).
  - Then "Most contested: P5 (2 challenges)", the idea with the most oppose stances, then challenge as the tie-break.
  - Then "; untouched: P4, P9" for sent ideas no other seat replied to, the first three named, or "Every idea drew a
    reply" when there are none.

### F. Benchmark: key lines found against tokens per run (Library → Councils, a folded "Benchmark" section on top)

- Shown when `CouncilBenchResults` has a scored row.
- Two small multiples, Review and Brainstorm, each with its own one axis.
- **x:** tokens per run on a log scale, ticks at 0.3M, 1M, 3M, 10M, 30M.
- **y:** recall as a share of keys, 0–100%.
  - A Review row uses recall@all when every scored run was judged whole (`allscored === scored`). Otherwise it uses
    `recall5`, drawn hollow with the tooltip "recall@5 only: `wsh council bench rejudge` scores it whole".
  - A Brainstorm row uses its recall@all.
- One point per (harness, variant) row.
- **Variant:** shape (solo ●, council ■, team ▲, brainstorm ◆) plus a colour from `--color-chart-1..4` (Task 2), with a
  direct label "council · 11-12".
- **Harness:** the newest harness at full opacity, older ones at 40%, with a legend line "older harness".
- **Frontier:** a 2px muted stepped line through the newest harness's points that no cheaper point of it beats on
  recall. Older harnesses are not on it: their prompts differ.
- **Labels:** only the newest harness's points carry a direct label; older ones show in the tooltip.
- **Tooltip:** the row as `wsh council bench results` prints it.
- **Table toggle:** the same table.
- **Takeaway**, per small multiple:
  - The newest harness's frontier, compared: "Newest harness: the brainstorm skill finds 31% at 5.7M a run, the
    council 21% at 1.5M".
  - Then, when a variant has no row on the newest harness but beat its frontier when last run: "Solo last ran on 11-05:
    40% at 0.3M".
  - Then, when a plotted Review row is recall@5 only: "the council's 11-12 score counts its first 5 items only".
- **Folded header:** "Benchmark · 52 runs in 2 modes" (the rows' `runs` summed, the modes counted), then the section's
  one-line takeaway across both modes: the variant with the best recall per million tokens, and, when its last run is on
  an older harness, "run it on the newest harness".

---

### Task 1: The figures model's types and stubs

**Depends on:** none

**Files:** `frontend/app/view/agents/councilfiguresmodel.ts`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`

A small task: it lands the contract the views (Tasks 4–7) and the model (Task 3) are built against at the same time.

**Step 1: The two section predicates** (`councilsummarymodel.ts`, with tests in `councilsummarymodel.test.ts`). They are
the one source of "does the Report draw this section", read by both the figures model and `outlineOf`, so
`councilsummarymodel.ts` never imports the figures model (the figures model imports it, not the other way round):

```ts
/** Pure: the Report's "At a glance" section draws (figure B, and A in a Review): the summary has a direction. */
export function hasGlanceFigures(c: Council): boolean;
/** Pure: the Report's "What it spent" section draws (figure C): some seat in `c.stats` has tokens > 0. */
export function hasSpendFigures(c: Council): boolean;
```

**Step 2: The types and stubs** (`councilfiguresmodel.ts`). Export exactly these types, and every function as a stub
that returns `null` (`benchPoints`: `{ review: null, brainstorm: null }`), each with a `// Task 3 implements` line.
`Council`, `CouncilExpert`, `CouncilBenchRow` are the generated global types.

```ts
/** Go's MaxTimelineSteps (pkg/council/types.go), which no generated file carries; Task 3's golden test holds it equal. */
export const MAX_TIMELINE_STEPS = 200;

export type FigureStance = "accept" | "challenge" | "oppose";
export type CellKind = "proposed" | FigureStance | "builds" | "none";

export type GlancePoint = { rank: number; title: string; x: number; y: number; hollow: boolean; held: number; evidence: number; backers: number; sides: number };
export type StanceCell = { seat: string; kind: CellKind };
export type StanceRow = { rank: number; title: string; cells: StanceCell[]; backers: number; sides: number; agreed: boolean };

export type SpendRow = { id: string | null; name: string; model: string; tokens: number; calls: number; perCall: number; ms: number; coordinator: boolean };
// id null: the "Memory check · outside the seats" row

export type StepShape = "tick" | "dot" | "square" | "flag";
export type LaneStep = { ts: number; shape: StepShape; target: string; shared: boolean };
export type LaneSpan = { start: number; end: number; steps: number; top: string[] };
export type Lane = { seat: CouncilExpert; spans: LaneSpan[]; steps: LaneStep[]; capped: boolean };
export type RoundMark = { round: number; ts: number };
export type SharedRead = { path: string; seats: string[]; reads: number };

export type GraphSeat = { id: string; name: string; replies: number; you: boolean };
export type GraphIdea = { id: string; title: string; label: string; merged: boolean; dim: boolean; y: number };
export type IdeaGroup = { key: string; heading: string; ideas: GraphIdea[] };
export type GraphEdge = { seat: string; idea: string; stance: FigureStance | "proposed"; count: number };

export type BenchPoint = { harness: string; variant: string; mode: string; x: number; y: number; hollow: boolean; newest: boolean; label: string; row: CouncilBenchRow };
export type BenchPanel = { mode: "review" | "brainstorm"; points: BenchPoint[]; frontier: BenchPoint[]; takeaway: string };

export function glancePoints(c: Council): { points: GlancePoint[]; takeaway: string } | null;
export function stanceGrid(c: Council): { seats: CouncilExpert[]; rows: StanceRow[]; takeaway: string } | null;
export function seatSpend(c: Council): { rows: SpendRow[]; total: number; calls: number; ms: number; takeaway: string } | null;
export function seatLanes(c: Council): { lanes: Lane[]; rounds: RoundMark[]; shared: SharedRead[]; more: SharedRead | null; moreCount: number; t0: number; t1: number; takeaway: string } | null;
export function argumentGraph(c: Council): { seats: GraphSeat[]; groups: IdeaGroup[]; edges: GraphEdge[]; takeaway: string } | null;
export function benchPoints(rows: CouncilBenchRow[]): { review: BenchPanel | null; brainstorm: BenchPanel | null; runs: number; modes: number; takeaway: string };
```

`GraphIdea.y` is the row's top in px (28px rows, group headings included), so the view draws edges in one pass.
`BenchPoint.x` is `log10(tokens per run)`. `SharedRead.seats` holds expert ids.

**Step 3:** Run `npx vitest run frontend/app/view/agents/councilsummarymodel.test.ts` and `task check:ts`. Both pass.
Commit `feat(council): the figures model's types`.

### Task 2: Chart parts and the benchmark palette

**Depends on:** none

**Files:** `frontend/app/view/agents/councilchartparts.tsx`, `frontend/tailwindsetup.css`, `docs/agents/council-chart-palette.md`

**Step 1: The palette.** Add `--color-chart-1..4` to `@theme` as an identity palette that stays the same across themes
(DESIGN.md "Identity palettes"), with a why comment: solo `#497bf8`, council `#c97a30`, team `#2a9d8f`, brainstorm
`#b04fbf`. On 2026-11-19 these four passed every check of the dataviz validator on `#1c1c1c` with `--pairs all`
(scatter points can sit beside any other: worst CVD ΔE 10.1, worst normal ΔE 18.5). The seat tones `conn-*` and a
blue/purple pair both failed.

The validator is the dataviz skill's `scripts/validate_palette.js`. Its folder is versioned by the Claude Code install,
so find it with `ls -d /tmp/claude/bundled-skills/*/*/dataviz/scripts/validate_palette.js | tail -1` (Git Bash; on
Windows `/tmp` is `C:\tmp`). With it, run
`node <that file> "#497bf8,#c97a30,#2a9d8f,#b04fbf" --mode dark --pairs all --surface <s>` for every `surfaceRaised`
in `frontend/app/view/agents/themes.ts`'s `THEMES` (loop over them), and step a slot's lightness only if a theme fails.
When no copy is found, keep the four values, and write in the doc that the per-theme check was not run and why.

Record in `docs/agents/council-chart-palette.md`: the chosen hex values, the validator path used, and the worst ΔE per
theme (or the note that it was not run). These four are for Figure F's variants only.

**Step 2: The parts.**
- `ChartFigure`: a `<figure>` with the title, the takeaway as `<figcaption>`, a Chart | Table toggle (local state, Table
  renders the `table` prop; the toggle carries `data-figure-table-toggle`), and `viewFade` on mount.
- `ChartTooltip`: positioned at the hovered mark, the element `frost` panel, reusing `element/tooltip` when it fits;
  its root carries `data-chart-tooltip`.
- `StanceGlyph`: icon plus word per stance (and Proposed, Builds on), the tint from the same map as `STANCE_PILL`. Copy
  that map into this file as an export; Task 8 makes `councilsummary.tsx` import it and drops its own.
- `useHoverDim`: the focused or hovered id, which the views read to dim the rest.
- `LogAxis` and `LinearAxis`: SVG ticks on `edge-faint`, labels in `text-muted` at 10px.

All of it reduced-motion aware, with no raw colours.

**Step 3:** Run `task check:ts`. It passes. Commit `feat(council): chart parts and the benchmark palette`.

### Task 3: The figures model

**Depends on:** Task 1 (fills in its stubs)

**Files:** `frontend/app/view/agents/councilfiguresmodel.ts`, `frontend/app/view/agents/councilfiguresmodel.test.ts`, `scripts/cdp/council/rail-apps-figures.json`, `pkg/council/charts.go`, `pkg/council/charts_golden_test.go`, `pkg/council/testdata/glance-golden.json`

Keep Task 1's exported types and signatures as they are: the views are built against them in parallel. A field the
model needs and the views do not is a non-exported helper; a change to an exported type is additive only.

**Step 1: The fixture.** Write `scripts/cdp/council/rail-apps-figures.json`, the one fixture the vitest, the Go golden
and the Task 8 scenarios all read: a done Review council in the cockpit's `Council` JSON shape, written like the other
`rail-apps-*.json` (project empty, times around 2026-10-21 09:00 UTC). It needs:
- 4 panel seats (each with a `model`) and a coordinator;
- 9 proposals, among them a withdrawn one and one with no evidence, with evidence mixing `ok`, `wrong` and `weak` cites;
- replies covering each stance, a reply to a reply, and one by `you`;
- 3 directions and 2 Also raised items;
- `stats` for every seat, and the council's `tokens`/`calls` above the seats' sums (a memory-check remainder);
- `timeline` steps across 3 rounds (reads, searches, runs, and the `propose`/`reply` posts), with two files read by 3
  seats, nine or more files read by two or more seats (so the shared list overflows 8), and one seat at 200 steps.

Hand-write it from the shape of council `4e9f4589d6d9c6f8` (`wsh council show 4e9f4589d6d9c6f8 --json`). Keep the
texts short and in English. Make one pair of directions coincide after `ChartUnit`, so the nudge is exercised.

**Step 2: The golden.** In `charts.go`, extract from `writeGlanceChart` a `glancePlaced(c *Council) [][2]float64` that
returns each direction's clamped and nudged coordinates in rank order, and have `writeGlanceChart` use it (its output
unchanged; its existing tests still pass). `charts_golden_test.go` loads the fixture
(`../../scripts/cdp/council/rail-apps-figures.json`) as a Go `Council` and writes, under `-update`, or else compares
with, `pkg/council/testdata/glance-golden.json`:
`{ maxTimelineSteps, directions: [{ rank, evidence, agreement, x, y }], spans: { <seat>: [{ start, end, steps }] } }`,
where `evidence`/`agreement` are `directionPoint`'s raw values, `x`/`y` are `glancePlaced`'s, and
`maxTimelineSteps` is `MaxTimelineSteps`.

**Step 3: Failing tests first** (`councilfiguresmodel.test.ts`, reading the same fixture and the golden). For each
exported function, assert on the fixture:
- `MAX_TIMELINE_STEPS` equals the golden's `maxTimelineSteps`;
- `glancePoints`: `held/evidence` equals the golden's `evidence` and `backers/sides` its `agreement` (to 1e-9; skip the
  hollow one's x ratio, 0 of 0); `x`/`y` equal the golden's placed `x`/`y` to 1e-9; hollow for the no-evidence
  direction; the coincident pair nudged apart; the takeaway text;
- `stanceGrid` gives cells per (direction, seat), with Proposed for the authors, "builds" only from a reply's `builds`
  flag in a Brainstorm (an edited copy of the fixture), and the takeaway;
- `seatSpend` keeps panel order with the coordinator last, gives per-call figures, adds the memory-check row so the rows
  sum to the header, sums `ms`, and words the share as "a third";
- `seatLanes` gives the spans equal to the golden's, the step shapes (the posts as flags), hollow shared reads, round
  markers, the cap note on the 200-step seat, the shared-read rows sorted and capped at 8 with the "and N more" row;
- `argumentGraph` gives the groups in outcome order, the 28px row tops, merged edges with counts, a reply-to-reply
  counted on its proposal, seat reply counts, the You row, and the most contested and untouched lists;
- `benchPoints` (from a `CouncilBenchRow[]` literal) gives the log x, recall@all versus `recall5` (hollow), the
  frontier, the newest harness flag, runs and modes, and the takeaway per mode and across both.

Also cover each figure's "nothing to show" condition returning `null`, and that `stanceGrid` / `seatSpend` return
`null` exactly when `hasGlanceFigures` / `hasSpendFigures` are false.

**Step 4: Implement** the functions, no React, no jotai. Reuse what exists rather than re-derive it:
- `isBrainstorm`, `positionsOf`, `hasGlanceFigures`, `hasSpendFigures` from `councilsummarymodel.ts`;
- the panel order from `councilmodel.ts`'s `panel`;
- stance names from `CouncilStance`.

Write every takeaway in English. A Vietnamese council reads the same English for now, as the Map's words do today.

**Step 5:** Run `npx vitest run frontend/app/view/agents/councilfiguresmodel.test.ts` and
`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/council -run 'Golden|Chart'` (Bash). Both pass.

**Step 6: Commit** `feat(council): the figures model a council's Report draws`.

### Task 4: At a glance (figures A and B)

**Depends on:** Task 1 (the model's types and signatures), Task 2 (ChartFigure, ChartTooltip, StanceGlyph, useHoverDim and the axes)

**Files:** `frontend/app/view/agents/councilglancefigures.tsx`

Build `GlanceFigures({ c, onOpenDirection })` against Task 1's types (the stubs return `null` until Task 3 lands; the
view draws nothing then): A beside B in one row when the pane is 900px or wider, stacked under it. Both are drawn
exactly as the spec says. A Brainstorm draws B alone. The model returning `null` draws nothing.
`onOpenDirection(rank)` is what a click or Enter on a point or a row calls. Markers for the scenario:
`data-council-figure="glance"` / `"stance-grid"`, a point `data-glance-point={rank}`, a grid row
`data-stance-row={rank}`.

Task 8's `council-figures` scenario proves it: the first shot, the point hover and its tooltip, the point click, the
row click, the Table toggle, and the narrow stack.

Run `task check:ts`. Commit `feat(council): the glance quadrant and stance grid`.

### Task 5: What the seats spent (figures C and D)

**Depends on:** Task 1 (the model's types and signatures), Task 2 (ChartFigure, ChartTooltip, StanceGlyph, useHoverDim and the axes)

**Files:** `frontend/app/view/agents/councilspendfigures.tsx`

Build `SpendFigures({ c, onSeat })` against Task 1's types: C, then D with its "Read by more than one seat" list.
Click or Enter on a seat row or a lane calls `onSeat(id)`. On a council still running, C eases bar widths as `stats`
move (see Motion). Markers: `data-council-figure="spend"` / `"lanes"`, `data-spend-seat={id}` on each C row,
`data-lane-seat={id}` on each lane, `data-lane-span` on each stretch, and `data-shared-read` on each list row.

Task 8's `council-figures` scenario proves it: the spend shot, the seat-row hover and its tooltip, the stretch hover
and its tooltip, the lane and shared-read counts, and the seat click opening the Discussion.

Run `task check:ts`. Commit `feat(council): what each seat spent and when it worked`.

### Task 6: The argument map (figure E)

**Depends on:** Task 1 (the model's types and signatures), Task 2 (ChartFigure, ChartTooltip, StanceGlyph, useHoverDim and the axes)

**Files:** `frontend/app/view/agents/councilargumentmap.tsx`

Build `ArgumentMap({ c, onOpenIdea })` against Task 1's types, as the spec says. Place nodes from `GraphIdea.y` (the
fixed row height), not from the DOM, so edges draw in one pass. Hover or focus dims through `useHoverDim`. Markers:
`data-council-figure="graph"`, `data-graph-idea={id}`, `data-graph-seat={id}`, and
`data-graph-edge="<seat>-><idea>"` with `data-stance`; a dimmed edge carries `data-dimmed`.

Task 8's `council-figures-graph` scenario proves it: the graph shot, the idea hover dimming the other edges, and the
click opening the Matrix row.

Run `task check:ts`. Commit `feat(council): the argument map`.

### Task 7: The benchmark chart (figure F)

**Depends on:** Task 1 (the model's types and signatures), Task 2 (ChartFigure, ChartTooltip, StanceGlyph, useHoverDim and the axes)

**Files:** `frontend/app/view/agents/councilbenchchart.tsx`, `frontend/app/view/agents/councilbenchstore.ts`

- `councilbenchstore.ts`: `benchResultsAtom` (null until loaded), and `loadBenchResults()`, which calls
  `RpcApi.CouncilBenchResultsCommand(TabRpcClient)` (read off `RpcApi` at call time, so the scenario's `stubRpc` stand-in
  answers) and turns an error into a logged line and `null`.
- `CouncilBenchChart()`: loads each time it mounts and draws the folded "Benchmark" section, closed by default and
  remembered in localStorage `council.benchOpen` (wrapped in try/catch). The folded header shows "52 runs in 2 modes"
  and the takeaway, so the insight reads without opening it. Inside are the two small multiples as the spec says, with
  the Table toggle showing the rows.
- Markers: `data-council-figure="bench"`, `data-bench-toggle` on the fold header, `data-bench-point="<mode>/<variant>/<harness>"`.

Task 8's `council-bench-chart` scenario proves it: the folded takeaway, the open shot, the fold remembered across a
reload, the point hover and its tooltip, and the Table toggle.

Run `task check:ts`. Commit `feat(council): the benchmark chart`.

### Task 8: Place the figures, scenarios, docs

**Depends on:** Task 3 (the model), Task 4 (places GlanceFigures), Task 5 (places SpendFigures), Task 6 (places ArgumentMap), Task 7 (places CouncilBenchChart)

**Files:** `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `frontend/app/view/agents/councilmap.tsx`, `frontend/app/view/library/librarysurface.tsx`, `scripts/cdp/council/fixtures.mjs`, `scripts/cdp/council/fixtures.test.mjs`, `scripts/cdp/council/figures.mjs`, `scripts/cdp/council/summary.mjs`, `scripts/cdp/council/map.mjs`, `scripts/cdp/councilscenarios.mjs`, `docs/guide/council.md`, `docs/hand-checks.md`, `CHANGELOG.md`

**Step 1: Report** (`councilsummary.tsx`).
- A section `data-council-section="glance"`, "At a glance", goes between the cover and the directions, holding
  `GlanceFigures`. `onOpenDirection` opens and scrolls to the card through the existing open-card state.
- A section `data-council-section="spend"`, "What it spent", goes after the kept ideas and before the Final proposal,
  holding `SpendFigures`. `onSeat` is the seat click the Glance panel already makes.
- In `councilsummarymodel.ts`, `outlineOf` gains `{ id: "glance", label: "At a glance" }` after the answer when
  `hasGlanceFigures(c)`, and `{ id: "spend", label: "What it spent" }` after kept when `hasSpendFigures(c)`, so both
  become jump links (`sectionOf`'s default branch finds them by `data-council-section`). It does not import the
  figures model. Update `councilsummarymodel.test.ts`'s outline and jump-link cases: list the two new entries and keep
  every existing entry.
- Import `STANCE_PILL` from `councilchartparts.tsx` and drop the local copy.

**Step 2: Map** (`councilmap.tsx`).
- A Matrix | Graph segmented switch above the stance matrix (`data-map-view="matrix"` / `"graph"` on its buttons). Its
  state lives in a per-council jotai atom, so it survives the surface unmounting.
- Graph draws `ArgumentMap`, and the swap crossfades with `viewFade`.
- `onOpenIdea(id)` sets Matrix and opens that row.

**Step 3: Library.** Place `CouncilBenchChart` at the top of the Councils tab.

**Step 4: The fixture in the harness** (`scripts/cdp/council/fixtures.mjs`).
- Add `"figures"` to `COUNCIL_FIXTURES` and to `PLACE` (`figures: { createdAgoMs: 45 * MINUTE }`), and update the
  tree-order comment above `PLACE`.
- `placeCouncil` also shifts every `timeline` step's `ts` (each seat's rows) by the same delta, so the round markers and
  the lanes keep their gaps. Add a case to `fixtures.test.mjs`: after `placeCouncil`, a step's gap to the first
  proposal is as authored.

**Step 5: Scenarios** in `scripts/cdp/council/figures.mjs` (exports `councilFigures`, `councilFiguresGraph`,
`councilBenchChart`, each `{ arrange, assert, teardown }` like `summary.mjs`, using `arrangeCouncilProject` /
`seedCouncil(h, ctx, "figures")` / `teardownCouncilProject`), registered in `councilscenarios.mjs` as
`council-figures`, `council-figures-graph`, `council-bench-chart`, with the header comment naming them.
- `council-figures`: seed the `figures` fixture and open its Report. Then:
  - shot; `await h.whatsnewShot("council-figures", { selector: '[data-council-section="glance"]' })`;
  - hover `[data-glance-point="1"]`, shot, assert `[data-chart-tooltip]` reads "evidence held" and "backed by";
  - click it, assert direction 1's card is open (`[data-council-direction-detail="1"]`); close it;
  - click `[data-stance-row="2"]`, assert direction 2's card is open; close it;
  - jump to "What it spent" through the jump link, shot, assert 4 or more `[data-lane-seat]` and 2 or more
    `[data-shared-read]`;
  - hover the Đo RAM seat's `[data-spend-seat]` row, shot, assert the tooltip reads "a call";
  - hover a `[data-lane-span]`, shot, assert the tooltip names a step count;
  - click a `[data-spend-seat]` row, assert the Discussion shows that seat's messages alone; return to the Report;
  - toggle the glance figure's Table (`[data-figure-table-toggle]`), shot;
  - narrow the pane below 900px, assert A sits above B, shot (with the Table still on).
- `council-figures-graph`: seed the `figures` fixture, open the Map, click `[data-map-view="graph"]`, shot. Then:
  - hover an idea, assert every edge not on it has `data-dimmed`, shot;
  - click it, assert the Matrix shows with that row open.
- `council-bench-chart`: `stubRpc(h, ["CouncilBenchResultsCommand"], { CouncilBenchResultsCommand: { value } })` with a
  `CouncilBenchResultsRtnData` built from the current `council-bench.jsonl` shape (rows of both modes, two harnesses,
  one Review row with `allscored < scored`). Open Library → Councils, assert the folded header reads "runs in 2 modes"
  and the takeaway, open it (`[data-bench-toggle]`), shot. Reload, open Library → Councils, assert it is still open.
  Then hover a point, shot, assert the tooltip, and toggle Table, shot. Teardown clears `council.benchOpen` and unstubs.
- `council-summary` (`summary.mjs`) and `council-map` (`map.mjs`) must still pass. Update their asserts only where the
  new sections and the switch sit in the page.

There is one shot per Prototype board:
- `Main.dc.html`: the council-figures first shot and its point hover;
- `Glance-narrow.dc.html`: the narrowed pane with Table;
- `Spend.dc.html`: the spend shot and the Đo RAM seat hover;
- `Lanes.dc.html`: the stretch hover;
- `Graph.dc.html`: council-figures-graph;
- `Bench.dc.html`: council-bench-chart.

**Step 6: Docs.**
- `docs/guide/council.md`: a short "Figures" section on what each figure answers.
- `docs/hand-checks.md`: `- [ ] (arcterm) Council figures on a real council (4e9f4589d6d9c6f8): the takeaways read
  right, and the argument map stays legible at 22 ideas`.
- `CHANGELOG.md`: Unreleased has no `### Added` yet; open one above `### Changed` with the line "A council's Report
  draws what its panel found and spent: where each direction stands on evidence and agreement, who backed or opposed
  it, what each seat spent and read twice, and, on the Map, who answered which idea. Library's Councils tab charts the
  benchmark. `<!-- big --> <!-- shot: none -->`". The picture does not exist until Final runs the scenario
  (`public/whatsnew/1.9.0-council-figures.webp`), and `whatsnew.test.ts` fails a `shot:` file that is missing, so the
  line says `shot: none` here; the lead swaps it for `<!-- shot: 1.9.0-council-figures.webp -->` and commits the
  picture at wrap-up.

**Step 7:** Run `task check:ts`, `npx vitest run frontend/app/view/agents/councilsummarymodel.test.ts
frontend/app/cockpit/whatsnew.test.ts scripts/cdp/council/fixtures.test.mjs`, and
`node --check scripts/cdp/council/figures.mjs`. The scenarios themselves run in Final, which starts its own dev app.
Commit `feat(council): place the figures in the Report, Map and Library`.

---

## Out of scope

- The `.md` document's charts (`feat/council-charts`, Mermaid) are a separate piece of work. This plan only holds the
  glance formula to them.
- Token use split by cache read and fresh input: `CouncilExpertStat` keeps one total. Adding a split is a Go change to
  `pkg/consult` usage capture first.
- A Vietnamese wording of the takeaways and the figure titles.
- Figures while round 1 is still running. C and D draw once `stats` and `timeline` have data, which on a running council
  is the Report only when it is shown.

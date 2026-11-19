# Council figures in the Report Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A finished council's Report (and its Map tab, and Library's Councils tab for the benchmark) shows six figures
drawn from what the council recorded, each with a one-line takeaway, so the person sees at a glance which directions
stand, where the panel split, where the tokens went, and whether a council beats one agent.

**Architecture:** One pure model, `councilfiguresmodel.ts`, derives every figure's data and takeaway from the `Council`
object the cockpit already holds (and from `CouncilBenchResultsRtnData` for the benchmark); thin `.tsx` views draw them
as inline SVG with theme tokens; one wiring task places them and adds the CDP scenarios. No model call draws or words a
figure: every number and every takeaway is computed. The glance quadrant uses the same formula as the `.md` chart in
`pkg/council/charts.go` (`directionPoint`), held to it by a shared golden file.

**Tech Stack:** React 19, TypeScript, Tailwind 4 tokens (`frontend/tailwindsetup.css`), inline SVG, jotai, vitest, Go
(one golden test), CDP scenarios (`scripts/cdp/councilscenarios.mjs`).

**Already in place:** `feat/council-charts` is merged into `main` (1d3356077). It carries `pkg/council/charts.go`
(`directionPoint`, `workSpans`), which Task 1 reads, and the bench's `CouncilBenchRow.Recall5` and `AllScored`, which
Task 6 reads. The canvas below was approved on 2026-11-19. Running `wsh council bench rejudge` on the installed app
fills recall@all for the real Review rows. The scenarios inject their own results, so no task waits on it.

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
- Both formulas are exactly `directionPoint`'s in `pkg/council/charts.go`.
- A direction whose proposals carry no evidence at all is drawn hollow, with "no evidence cited" in its tooltip, so 0
  of 0 never reads like 0 of 3.
- Points that coincide are nudged apart the way `writeGlanceChart` does: within 0.04 → 0.05 inward, at most 4 times.
  Coordinates are clamped to 0.08–0.9.
- Plot about 320×240, square cells. The four quadrant names sit muted in the corners: Stands (top right), Backed on thin
  evidence (top left), A guess (bottom left), Shown but contested (bottom right).
- **Tooltip:** the title, "evidence held n of m", "backed by k of s seats".
- **Click:** opens that direction's card (the Report's one-open-card state) and scrolls to it.
- **Takeaway:**
  - "D1 and D3 stand on checked evidence and the panel's backing", naming the directions in the top right quadrant
    (x ≥ 0.5, y ≥ 0.5).
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
  the seat's stance glyph and word on the existing `STANCE_PILL` tint, or a muted dash for no stance. In a Brainstorm a
  `builds` reply reads "Builds on".
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
- One series: the bar is `accent` at 60%, its length its tokens on one shared linear axis.
- At the bar's end, in text tokens: "3.0M · 2 calls · 1.5M a call".
- Header line: "9.0M tokens in 15 calls", the council's own `tokens` and `calls` (the Run facts figures). The seats'
  `stats` can add up to less (council 4e9f4589: 14 calls and 38k fewer tokens), so a last muted row "Memory check ·
  outside the seats" carries the difference, and the rows always add up to the header.
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
- **Step marks** on the stretch, told apart by shape, not colour: a read is a tick, a search a dot, a command a square.
- **Shared reads:** a read of a file another seat also read is drawn hollow. Paths are compared as slash paths with case
  folded, as `chartSeats` does.
- **Round markers:** a muted vertical rule at the first post of each round, labelled R1, R2…. Round 1 is the earliest
  proposal `ts`; round n is the earliest reply with `round === n`.
- When a seat's timeline holds `MaxTimelineSteps` steps, the lane says "first N steps kept".
- **Tooltip** on a stretch: from–to clock, the number of steps, its three most-read targets.
- **Under the lanes:** a list headed "Read by more than one seat": file, the seats' avatars, the total reads. At most 8
  rows, sorted by seat count and then by reads.
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
  - **Left:** the seats in panel order (avatar and name), plus a "You" row when the person replied to an idea.
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
  - A Review row uses recall@all when every scored run was judged whole (`allScored === scored`). Otherwise it uses
    recall@5, drawn hollow with the tooltip "recall@5 only: `wsh council bench rejudge` scores it whole".
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
- **Folded header:** the section's one-line takeaway across both modes: the variant with the best recall per million
  tokens, and, when its last run is on an older harness, "run it on the newest harness".

---

### Task 1: The figures model

**Depends on:** none

**Files:** `frontend/app/view/agents/councilfiguresmodel.ts`, `frontend/app/view/agents/councilfiguresmodel.test.ts`, `frontend/app/view/agents/testdata/council-figures.json`, `pkg/council/charts_golden_test.go`, `pkg/council/testdata/glance-golden.json`

**Step 1: The fixture.** Write `testdata/council-figures.json`: a done Review council in the cockpit's `Council` JSON
shape. It needs:
- 4 panel seats and a coordinator;
- 9 proposals, among them a withdrawn one and one with no evidence, with evidence mixing `ok`, `wrong` and `weak` cites;
- replies covering each stance, a reply to a reply, and one by `you`;
- 3 directions and 2 Also raised items;
- `stats` for every seat;
- `timeline` steps across 3 rounds, with two files read by 3 seats and one seat at `MaxTimelineSteps`.

Hand-write it from the shape of council `4e9f4589d6d9c6f8` (`wsh council show 4e9f4589d6d9c6f8 --json`). Keep the
texts short and in English.

**Step 2: The golden.** `charts_golden_test.go` loads the same fixture as a Go `Council`, runs `directionPoint` and
`workSpans` over it, and compares the result with `pkg/council/testdata/glance-golden.json`. `-update` rewrites the
golden. The golden holds `[{rank, evidence, agreement}]` and `{seat: [{start, end, steps}]}`.

**Step 3: Failing tests first** (`councilfiguresmodel.test.ts`). For each exported function, assert on the fixture:
- `glancePoints` equals the Go golden to 1e-9, is hollow for the no-evidence direction, nudges coincident points, and
  gives the takeaway text;
- `stanceGrid` gives cells per (direction, seat), with Proposed for the authors, and the takeaway;
- `seatSpend` keeps panel order with the coordinator last, gives per-call figures, and words the share as "a third";
- `seatLanes` gives the spans equal to the Go golden, the step shapes, hollow shared reads, round markers, the cap note,
  and the shared-read rows sorted and capped at 8;
- `argumentGraph` gives the groups in outcome order, merged edges with counts, a reply-to-reply counted on its
  proposal, the You row, and the most contested and untouched lists;
- `benchPoints` (from a `CouncilBenchRow[]` literal) gives the log x, recall@all versus recall@5 (hollow), the frontier,
  the newest harness flag, and the takeaway per mode.

Also cover each figure's "nothing to show" condition returning `null`.

**Step 4: Implement** the pure functions with these signatures, no React, no jotai:

```ts
export type GlancePoint = { rank: number; title: string; x: number; y: number; hollow: boolean; held: number; evidence: number; backers: number; sides: number };
export function glancePoints(c: Council): { points: GlancePoint[]; takeaway: string } | null;
export function stanceGrid(c: Council): { seats: CouncilExpert[]; rows: StanceRow[]; takeaway: string } | null;
export function seatSpend(c: Council): { rows: SpendRow[]; total: number; calls: number; takeaway: string } | null;
export function seatLanes(c: Council): { lanes: Lane[]; rounds: RoundMark[]; shared: SharedRead[]; t0: number; t1: number; takeaway: string } | null;
export function argumentGraph(c: Council): { seats: GraphSeat[]; groups: IdeaGroup[]; edges: GraphEdge[]; takeaway: string } | null;
export function benchPoints(rows: CouncilBenchRow[]): { review: BenchPanel | null; brainstorm: BenchPanel | null };
```

Reuse what exists rather than re-derive it:
- `isBrainstorm` and `positionsOf` from `councilsummarymodel.ts`;
- the panel order from `councildiscussionmodel.ts`'s `panel`;
- stance names from `CouncilStance`.

Write every takeaway in English. A Vietnamese council reads the same English for now, as the Map's words do today.

**Step 5:** Run `npx vitest run frontend/app/view/agents/councilfiguresmodel.test.ts` and
`go test ./pkg/council -run Golden` (with the cgo prefix from AGENTS.md). Both pass.

**Step 6: Commit** `feat(council): the figures model a council's Report draws`.

### Task 2: Chart parts and the benchmark palette

**Depends on:** none

**Files:** `frontend/app/view/agents/councilchartparts.tsx`, `frontend/tailwindsetup.css`, `docs/agents/council-chart-palette.md`

**Step 1: The palette.** Add `--color-chart-1..4` to `@theme` as an identity palette that stays the same across themes
(DESIGN.md "Identity palettes"), with a why comment: solo `#497bf8`, council `#c97a30`, team `#2a9d8f`, brainstorm
`#b04fbf`. On 2026-11-19 these four passed every check of the dataviz validator on `#1c1c1c` with `--pairs all`
(scatter points can sit beside any other: worst CVD ΔE 10.1, worst normal ΔE 18.5). The seat tones `conn-*` and a
blue/purple pair both failed. Re-run
`node <dataviz>/scripts/validate_palette.js "#497bf8,#c97a30,#2a9d8f,#b04fbf" --mode dark --pairs all --surface <s>`
for every `surfaceRaised` in `frontend/app/view/agents/themes.ts`'s `THEMES` (loop over them), and step a slot's
lightness only if a theme fails.

Record each theme's report in `docs/agents/council-chart-palette.md`: the chosen hex values, and the worst ΔE per theme.
These four are for Figure F's variants only.

**Step 2: The parts.**
- `ChartFigure`: a `<figure>` with the title, the takeaway as `<figcaption>`, a Chart | Table toggle (local state, Table
  renders the `table` prop), and `viewFade` on mount.
- `ChartTooltip`: positioned at the hovered mark, the element `frost` panel, reusing `element/tooltip` when it fits.
- `StanceGlyph`: icon plus word per stance, the tint from the same map as `STANCE_PILL` (move that map into this file
  and import it from `councilsummary.tsx` in Task 7).
- `useHoverDim`: the focused or hovered id, which the views read to dim the rest.
- `LogAxis` and `LinearAxis`: SVG ticks on `edge-faint`, labels in `text-muted` at 10px.

All of it reduced-motion aware, with no raw colours.

**Step 3:** Run `task check:ts`. It passes. Commit `feat(council): chart parts and the benchmark palette`.

### Task 3: At a glance (figures A and B)

**Depends on:** Task 1 (uses the figures model's functions and the fixture), Task 2 (uses ChartFigure, ChartTooltip, StanceGlyph, useHoverDim and the axes)

**Files:** `frontend/app/view/agents/councilglancefigures.tsx`

Build `GlanceFigures({ c, onOpenDirection })`: A beside B in one row when the pane is 900px or wider, stacked under it.
Both are drawn exactly as the spec says. A Brainstorm draws B alone. The model returning `null` draws nothing.
`onOpenDirection(rank)` is what a click or Enter on a point or a row calls. Every mark carries
`data-council-figure="glance"` / `"stance-grid"`, and a point `data-glance-point={rank}`, for the scenario.

Run `task check:ts`. Commit `feat(council): the glance quadrant and stance grid`.

### Task 4: What the seats spent (figures C and D)

**Depends on:** Task 1 (uses the figures model's functions and the fixture), Task 2 (uses ChartFigure, ChartTooltip, StanceGlyph, useHoverDim and the axes)

**Files:** `frontend/app/view/agents/councilspendfigures.tsx`

Build `SpendFigures({ c, onSeat })`: C, then D with its "Read by more than one seat" list. Click or Enter on a seat row
or a lane calls `onSeat(id)`. On a council still running, C eases bar widths as `stats` move (see Motion). Use the
markers `data-council-figure="spend"` / `"lanes"`, `data-lane-seat={id}`, and `data-shared-read` on each list row.

Run `task check:ts`. Commit `feat(council): what each seat spent and when it worked`.

### Task 5: The argument map (figure E)

**Depends on:** Task 1 (uses the figures model's functions and the fixture), Task 2 (uses ChartFigure, ChartTooltip, StanceGlyph, useHoverDim and the axes)

**Files:** `frontend/app/view/agents/councilargumentmap.tsx`

Build `ArgumentMap({ c, onOpenIdea })` as the spec says. Measure the right column's node positions from the fixed row
height, not from the DOM, so edges draw in one pass. Hover or focus dims through `useHoverDim`. Use the markers
`data-council-figure="graph"`, `data-graph-idea={id}`, and `data-graph-edge="<seat>-><idea>"` with `data-stance`.

Run `task check:ts`. Commit `feat(council): the argument map`.

### Task 6: The benchmark chart (figure F)

**Depends on:** Task 1 (uses the figures model's functions and the fixture), Task 2 (uses ChartFigure, ChartTooltip, StanceGlyph, useHoverDim and the axes)

**Files:** `frontend/app/view/agents/councilbenchchart.tsx`, `frontend/app/view/agents/councilbenchstore.ts`

- `councilbenchstore.ts`: `benchResultsAtom` (null until loaded), and `loadBenchResults()`, which calls
  `RpcApi.CouncilBenchResultsCommand(TabRpcClient)` and swallows an error into a logged line and `null`. Export a setter
  for the scenario to inject results.
- `CouncilBenchChart()`: loads on mount and draws the folded "Benchmark" section, closed by default and remembered in
  localStorage `council.benchOpen`. The folded header shows the takeaway, so the insight reads without opening it.
  Inside are the two small multiples as the spec says, with the Table toggle showing the rows.
- Markers: `data-council-figure="bench"`, `data-bench-point="<mode>/<variant>/<harness>"`.

Run `task check:ts`. Commit `feat(council): the benchmark chart`.

### Task 7: Place the figures, scenarios, docs

**Depends on:** Task 3 (places GlanceFigures), Task 4 (places SpendFigures), Task 5 (places ArgumentMap), Task 6 (places CouncilBenchChart)

**Files:** `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `frontend/app/view/agents/councilmap.tsx`, `frontend/app/view/library/librarysurface.tsx`, `scripts/cdp/councilscenarios.mjs`, `docs/guide/council.md`, `docs/hand-checks.md`, `CHANGELOG.md`

**Step 1: Report** (`councilsummary.tsx`).
- A section `id="glance"`, "At a glance", goes between the cover and the directions, holding `GlanceFigures`.
  `onOpenDirection` opens and scrolls to the card through the existing open-card state.
- A section `id="spend"`, "What it spent", goes after the kept ideas and before the Final proposal, holding
  `SpendFigures`. `onSeat` is the seat click the Glance panel already makes.
- In `councilsummarymodel.ts`, `outlineOf` gains "At a glance" after the answer (when A or B draws) and "What it spent"
  after kept (when C draws), so both become jump links. Update `councilsummarymodel.test.ts`'s outline cases: list the
  two new entries and keep every existing entry.
- Import `STANCE_PILL` from `councilchartparts.tsx`.

**Step 2: Map** (`councilmap.tsx`).
- A Matrix | Graph segmented switch above the stance matrix. Its state lives in a per-council jotai atom, so it survives
  the surface unmounting.
- Graph draws `ArgumentMap`, and the swap crossfades with `viewFade`.
- `onOpenIdea(id)` sets Matrix and opens that row.

**Step 3: Library.** Place `CouncilBenchChart` at the top of the Councils tab.

**Step 4: Scenarios** (`councilscenarios.mjs`).
- `council-figures`: inject the Task 1 fixture council and open its Report. Then:
  - shot;
  - hover `[data-glance-point="1"]`, shot, assert the tooltip text;
  - click it, assert direction 1's card is open;
  - scroll to `#spend`, shot, assert 4 or more `[data-lane-seat]` and 2 or more `[data-shared-read]`;
  - toggle the glance figure's Table, shot;
  - repeat with the pane narrowed below 900px (A and B stack).
- `council-figures-graph`: open the Map, switch to Graph, shot. Then:
  - hover an idea, assert the other edges are dimmed, shot;
  - click it, assert the Matrix shows with that row open.
- `council-bench-chart`: inject a `CouncilBenchResultsRtnData` built from the current `council-bench.jsonl` shape (rows
  of both modes, one Review row not judged whole). Open Library → Councils, assert the folded header's takeaway, open
  it, shot. Then hover a point, shot, and toggle Table, shot.
- `council-summary` and `council-map` must still pass. Update their asserts only where the new sections sit in the page.

There is one shot per Prototype board:
- `Main.dc.html`: the council-figures first shot and its hover;
- `Glance-narrow.dc.html`: the narrowed pane with Table;
- `Spend.dc.html` and `Lanes.dc.html`: the `#spend` shot;
- `Graph.dc.html`: council-figures-graph;
- `Bench.dc.html`: council-bench-chart.

**Step 5: Docs.**
- `docs/guide/council.md`: a short "Figures" section on what each figure answers.
- `docs/hand-checks.md`: `- [ ] (arcterm) Council figures on a real council (4e9f4589d6d9c6f8): the takeaways read
  right, and the argument map stays legible at 22 ideas`.
- `CHANGELOG.md` Unreleased, Added: "A council's Report draws what its panel found and spent: where each direction
  stands on evidence and agreement, who backed or opposed it, what each seat spent and read twice, and, on the Map, who
  answered which idea. Library's Councils tab charts the benchmark. `<!-- big -->`".

**Step 6:** Run `task check:ts` and
`CDP_PORT=<port> task verify:ui -- council-figures council-figures-graph council-bench-chart council-summary council-map`
against a dev app. Commit `feat(council): place the figures in the Report, Map and Library`.

---

## Out of scope

- The `.md` document's charts (`feat/council-charts`, Mermaid) are a separate piece of work. This plan only holds the
  glance formula to them.
- Token use split by cache read and fresh input: `CouncilExpertStat` keeps one total. Adding a split is a Go change to
  `pkg/consult` usage capture first.
- A Vietnamese wording of the takeaways and the figure titles.
- Figures while round 1 is still running. C and D draw once `stats` and `timeline` have data, which on a running council
  is the Report only when it is shown.

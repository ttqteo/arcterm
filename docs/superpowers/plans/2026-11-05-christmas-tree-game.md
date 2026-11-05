# The lobby Christmas tree

A shared pixel pine in the Office hall that grows through the season as orchestrator tasks finish: wavesrv keeps a
season ledger of finished tasks and answers it over one wshrpc command; the frontend turns that list into growth stages
and ornaments with pure functions, draws one pixel grid in the hall, a close-up card and the Agent rail, and announces
milestones with a toast. Every design decision, with its why, is in the spec's "The builder's decisions" section; this
plan does not repeat them, so read that section before your task.

**Spec:** `docs/superpowers/specs/2026-11-05-christmas-tree-game-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/xmastree ./pkg/wstore ./pkg/orchestrate ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs office-xmas-tree christmas-theme surface-smoke`
**Prototype:** D:\src\arcterm\.superpowers\design\christmas-tree-game\project\A-closeup.dc.html

Shared rules for every task: colours only from `@theme` tokens (`--color-xmas-*`, `--color-accent`, existing office
tokens), never raw hex; every decor piece renders only while `useChristmasDecor()` is true; motion only while
`useChristmasMotion()` is true; pure logic in a `.ts` with a `.test.ts` beside it, thin `.tsx` on top (AGENTS.md
"Frontend conventions"); never hand-edit generated files; Go tests on Windows need
`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash).

### Task 1: The tree's wire: types, command, event and season window
**Depends on:** none
**Files:** `pkg/xmastree/xmastree.go`, `pkg/xmastree/xmastree_test.go`, `pkg/wshrpc/wshrpctypes_xmastree.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_xmastree.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`

The small interface every other task builds on, so the frontend does not wait for the ledger (Task 2).

- `pkg/wshrpc/wshrpctypes_xmastree.go`: interface `XmasTreeCommands` with
  `XmasTreeCommand(ctx context.Context) (*XmasTreeData, error)` and the type
  `XmasTreeData { Season int json:"season"; Phase string json:"phase"; Done []int64 json:"done" }`; embed the interface
  in `wshrpctypes.go` like `ServicesCommands`.
- Event `Event_XmasTreeChanged = "xmastree:changed" // type: wshrpc.XmasTreeData` in `pkg/wps/wpstypes.go` (and its
  list), registered in `pkg/tsgen/tsgenevent.go` as `services:changed` is.
- `pkg/xmastree/xmastree.go`: `SeasonAt(now time.Time) (season int, phase string, from, to time.Time)`, pure,
  server-local (spec "Season window, in Go only"); and `Read(ctx context.Context, now time.Time) (*wshrpc.XmasTreeData, error)`
  that for now returns the season and phase with an empty (non-nil) `Done`. Task 2 fills `Read` in.
- `pkg/wshrpc/wshserver/wshserver_xmastree.go`: `XmasTreeCommand` returns `xmastree.Read(ctx, time.Now())`.
- Run `task generate` and commit what it writes.
- Interface other tasks rely on (TS): `RpcApi.XmasTreeCommand(TabRpcClient): Promise<XmasTreeData>`,
  `XmasTreeData = { season: number; phase: string; done: number[] }`, event type `"xmastree:changed"`.

Acceptance: `go test ./pkg/xmastree -run 'TestSeasonAt'` (31 Oct 23:59 → off; 1 Nov 00:00 → season, that year;
31 Dec 23:59 → season; 1 Jan 12:00 → newyear with the previous year's season; 2 Jan 00:00 → off); `go vet ./pkg/xmastree
./pkg/wshrpc/...` clean; `task generate` leaves no diff after the commit; `task check:ts` clean.

### Task 2: The season ledger, its backfill and the engine's write
**Depends on:** Task 1
**Files:** `db/migrations-wstore/000026_xmastask.up.sql`, `db/migrations-wstore/000026_xmastask.down.sql`, `pkg/xmastree/xmastree.go`, `pkg/xmastree/xmastree_test.go`, `pkg/orchestrate/engine.go`, `pkg/orchestrate/lifecycleevent_test.go`

Spec "The ledger and the wire". Runs beside the frontend tasks.

- Migration `000026_xmastask`: `db_xmastask (runid TEXT NOT NULL, taskid TEXT NOT NULL, ts INTEGER NOT NULL,
  PRIMARY KEY (runid, taskid))` plus an index on `ts`; down drops both (precedent `000025_sessionday`). If `000026` is
  taken on `main` when you start, take the next free number and say so in your report.
- `pkg/xmastree` (store-call precedent: `pkg/wstore/wstore_sessionday.go`, `WithTx` / `WithReadTxRtn`):
  - `RecordTaskDone(ctx, runID, taskID string, ts int64) error`: `INSERT OR IGNORE`; when a row was inserted, publish
    `wps.Event_XmasTreeChanged` with the current `Read` answer.
  - `Read`: runs the backfill once per process (`sync.Once`-like; a failed backfill is returned as the error and tried
    again on the next call, never swallowed), then returns the window's rows ordered by `ts, runid, taskid`; phase
    `off` → empty `Done`.
  - Backfill: `INSERT OR IGNORE INTO db_xmastask SELECT runid, json_extract(data,'$.taskid'), ts FROM db_runevent
    WHERE kind = 'task-done'` inside the window, skipping rows with no taskid.
- `pkg/orchestrate/engine.go`: in the `afterCommit` closure that appends `RunEventKindTaskDone` (around line 643),
  take one `now := time.Now().UnixMilli()`, append the event with `appendRunEventAt(ctx, now, …)` (engine.go:1222) and
  call `xmastree.RecordTaskDone(ctx, g.RunID, taskID, now)`; log an error with the run id, never fail the run. Make the
  call go through a package var (like `appendRunEventAt`) so a test can capture it. Check `pkg/xmastree` imports
  nothing from `pkg/orchestrate`.

Acceptance (`go test ./pkg/xmastree -run 'TestRecordTaskDone|TestBackfill|TestRead'` and
`go test ./pkg/orchestrate -run 'TestTaskDoneRecordsXmasLedger'`):
- `TestRecordTaskDone`: the same (runid, taskid) twice is one row (a retried task counts once).
- `TestBackfill`: `task-done` events inside the window count; one before 1 Nov and one of another kind do not; a task
  both in the events and recorded live counts once; a second `Read` adds nothing.
- `TestRead`: rows come back oldest first; a row survives deleting its run events (the ledger outlives pruning).
- `TestTaskDoneRecordsXmasLedger` in `lifecycleevent_test.go`: a task going to done calls the ledger write once with
  the DAG's run id, the task id and the same timestamp as its `task-done` event.

### Task 3: The growth and ornament model (pure)
**Depends on:** none
**Files:** `frontend/app/view/agents/xmastreemodel.ts`, `frontend/app/view/agents/xmastreemodel.test.ts`

Spec sections "Growth" and "Positions and announcements". Pure TypeScript, no React, no store, no import of the grid.
Interface the store, hall and card tasks rely on (export exactly these names; add helpers as you need):

```ts
export const MILESTONES: readonly number[];        // [5, 15, 50, 150, 250, 600, 1500]
export const SPOTS_BY_STAGE: readonly number[];    // branch stages 0..5: [4, 10, 19, 22, 25, 30]
export type Tier = 0 | 1 | 2 | 3;                  // small, big, rare, heirloom
export interface Ornament { tier: Tier; first: number; last: number } // task indices into `done`, inclusive
export interface Arrangement { count: number; spots: (Ornament | null)[] }
export type XmasPhase = "season" | "newyear" | "off";
export interface XmasTreeView {                    // what the store derives and every view draws
    season: number; phase: XmasPhase; count: number; milestone: number;
    arrangement: Arrangement; done: readonly number[];
}
export function milestoneAt(count: number): number;           // 0..7 reached
export function branchTiers(milestone: number): number;       // 0..5
export function hasLights(milestone: number): boolean;        // milestone >= 6
export function hasStar(milestone: number): boolean;          // milestone >= 7
export function spotCount(milestone: number): number;
export function emptyArrangement(): Arrangement;
export function advance(a: Arrangement, count: number): Arrangement; // adds tasks a.count+1..count, one step each
export function moveOrnament(a: Arrangement, from: number, to: number): Arrangement; // to free: move; to taken: swap
export function tierCounts(a: Arrangement): [number, number, number, number];
export function ornamentTasks(o: Ornament): number;           // last - first + 1
export function ornamentRange(o: Ornament, done: readonly number[]): { from: number; to: number }; // ms
export function progress(count: number): { milestone: number; left: number; fraction: number }; // to the next; at 7: left 0, fraction 1
export function milestoneToAnnounce(milestone: number, announced: number): number | null;
export function milestoneTitle(milestone: number): string;    // "The tree grew its 1st tier" … "The star is on top of the tree"
export function parseArrangement(raw: unknown): Arrangement | null; // validates localStorage JSON; null when malformed
export type Dir = "up" | "down" | "left" | "right";
export function nearestSpot(points: readonly { x: number; y: number }[], from: number, dir: Dir, allowed: readonly boolean[]): number; // from itself when none
```

Rules (the spec's decisions): a new ornament takes the lowest-numbered free spot; when none is free, the 10 oldest
(lowest `first`) of the lowest tier holding at least 10 merge into one ornament of the next tier spanning their tasks,
placed at the oldest one's spot, the other nine freed; heirlooms (tier 3) never merge; a task with no spot and no tier
of 10 hangs nothing but `count` still advances. Growing to a stage with more spots appends free spots at the end.

Acceptance (`npx vitest run frontend/app/view/agents/xmastreemodel.test.ts`):
- `advance(emptyArrangement(), 214)` gives tier counts 14 / 10 / 1 / 0 (board A); `progress(214)` is milestone 4 with
  36 left; `milestoneAt` at 4, 5, 1499, 1500 is 0, 1, 6, 7.
- Advancing 0→N in one call equals advancing one task at a time (N = 300).
- For every N from 1 to 3,999 the hung ornaments' tasks sum to N; past that the pinned no-spot case keeps `count`
  and drops the ornament.
- A moved ornament keeps its spot after `advance` adds tasks, and the new ones take free spots.
- `moveOrnament` swaps with a taken spot and moves into a free one.
- `ornamentRange` of a merged big bauble spans its ten tasks' first and last `done` times.
- `milestoneToAnnounce(4, 0)` is 4, `(4, 4)` null, `(5, 4)` 5.
- `parseArrangement` rejects a wrong shape, more than 30 spots, and `first > last`.
- `nearestSpot` picks the closest allowed point in the arrow's direction and returns `from` when none.

### Task 4: The pixel tree grid and the fireworks (pure)
**Depends on:** none
**Files:** `frontend/app/view/agents/xmastreegrid.ts`, `frontend/app/view/agents/xmastreegrid.test.ts`

Spec "One pixel grid" and "1 January". Pure, no React; it takes plain numbers, not the model. Draw it after the
existing rail pine (`christmasrailtree.ts`: tiers of needles in alternating shades, a trunk, a plus star), grown to
five tiers.

```ts
export const XMAS_TREE_W: number;   // grid columns, the same at every stage (the tree grows inside it)
export const XMAS_TREE_H: number;   // grid rows
export interface TreeGrid { rows: readonly string[]; spots: readonly { x: number; y: number }[] } // "." empty
export function treeGrid(tiers: number, lights: boolean, star: boolean, spotCount: number): TreeGrid;
export const XMAS_TREE_FILL: Record<string, string>; // cell char -> CSS colour from tokens (needles, dark needles, trunk, light, star)
export const ORNAMENT_FILL: readonly string[];       // by tier: xmas-bulb, accent, xmas-snow, xmas-crimson
export function fireworkCells(frame: number, w: number, h: number): { x: number; y: number; fill: string }[];
export const FIREWORK_FRAMES: number;
```

- `tiers` 0 is the sapling (a short tip on a trunk); tiers 1–5 add a wider tier below, one after another. Lights are
  bulb cells along the tiers' edges; the star a plus on top. Spot k stays on the same cell at every stage that has it
  as far as the grid allows, so an ornament does not jump when the tree grows; a spot that must move keeps its index.
- Spots are listed for `spotCount` (4, 10, 19, 22, 25, 30 in practice) on needle cells only.

Acceptance (`npx vitest run frontend/app/view/agents/xmastreegrid.test.ts`):
- For each (tiers, spotCount) pair of the spec, every spot is on a needle cell of that grid, no two share a cell, none
  is on a light or star cell.
- Every row is `XMAS_TREE_W` long and there are `XMAS_TREE_H` rows at every stage; the sapling's needles are a subset
  of tier 5's.
- `star: false` has no star cell; `lights: false` no light cell.
- Every fill is a `var(--color-…)` or a `color-mix(…)` of them: no raw hex (assert with a regex).
- `fireworkCells` stays inside `w × h` for every frame and differs between frame 0 and frame 1.

### Task 5: The tree store, the milestone toast and the Agent rail's pine
**Depends on:** Task 1 (the XmasTreeCommand, its event and generated TS), Task 3 (the model and XmasTreeView), Task 4 (the grid for the rail)
**Files:** `frontend/app/view/agents/xmastreestore.ts`, `frontend/app/view/agents/xmastreestore.test.ts`, `frontend/app/view/agents/xmastreenotifier.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `frontend/app/view/agents/christmasrailtreeview.tsx`, `frontend/app/view/agents/christmasrailtree.ts`, `frontend/app/view/agents/christmasrailtree.test.ts`, `frontend/app/view/agents/cockpitofficedevhooks.ts`, `scripts/cdp/xmastreescenarios.mjs`, `scripts/cdp/scenarios.mjs`

- `xmastreestore.ts` (precedent: `servicesstore.ts`'s feed): `ensureXmasTreeFeed()` reads `XmasTreeCommand` once and
  then follows `xmastree:changed`; idempotent; a failed read is logged, not swallowed. Exports, for Tasks 6–8:
  - `xmasTreeFixtureAtom: PrimitiveAtom<XmasTreeData | null>` (DEV hook only; wins over live data),
  - `xmasTreeAtom: Atom<XmasTreeView | null>`: null only until the first answer; in phase off a view with count 0; the
    arrangement read from localStorage `xmas.tree.<season>` through `parseArrangement` and `advance`d to the count
    (rebuilt when missing, malformed or ahead), written back when it changes; every storage access in try/catch,
  - `moveXmasOrnament(from: number, to: number): void` (persists),
  - `xmasTreeGoAtom: PrimitiveAtom<number>` bumped by "go to the tree"; Task 6 makes the Office consume it.
  Pure helpers (the storage key, the advance-or-rebuild choice) are tested in `xmastreestore.test.ts`.
- `xmastreenotifier.tsx`, mounted once in `cockpit-root.tsx`: starts the feed; while `useChristmasDecor()` and phase
  `season`, applies `milestoneToAnnounce` against localStorage `xmas.tree.announced.<season>` and pushes one toast
  (`pushToast`, level info, title `milestoneTitle(m)`, message "N tasks finished this season", `onOpen` = switch to
  the Cockpit surface, `cockpitViewAtom` "office", `officeFloorAtom` 0, bump `xmasTreeGoAtom`). Find how a
  cockpit-root child reaches the surface atom and reuse that route.
- Rail pine (spec "The rail's pine out of season"): `christmasrailtreeview.tsx` draws `treeGrid(...)` at 3 px a cell
  from `xmasTreeAtom`: the season's stage and its ornaments (`ORNAMENT_FILL`) in season and newyear, the full tree with
  no ornaments in off, nothing while the atom is null. Keep `data-rail-tree`; add `data-rail-tree-milestone`. Delete
  `christmasrailtree.ts` and its test after grepping every import (AGENTS.md rule).
- DEV hook in `cockpitofficedevhooks.ts`: `window.__cockpitOfficeTree(data: XmasTreeData | null)` sets the fixture.
- `scripts/cdp/scenarios.mjs`: the `christmas-theme` scenario's step 8e (around line 12305) waits for
  `svg[data-rail-tree]` on live data; have it set a fixture with `__cockpitOfficeTree` (phase season, 214 tasks) before
  it and clear it in its teardown, so it passes in any month.
- CDP: create `scripts/cdp/xmastreescenarios.mjs` exporting a factory `xmasTreeScenarios(kit)` that returns the
  scenario `office-xmas-tree`, spread into the list in `scenarios.mjs` the way `railTranscriptScenarios(RT_KIT)` is
  (around line 61037), with a kit object passing the helpers it needs from `scenarios.mjs` (the Christmas preset keys
  and setter the `christmas-theme` scenario uses, its wait helper) and from `cockpitofficescenarios.mjs` (key, probe,
  waitForOffice, settleBoss). Arrange: the Christmas preset with effects on, `xmas.tree.*` localStorage keys cleared;
  teardown restores both and clears the fixture. This task's steps: **rail-pine** (fixture 214 tasks, phase season: the
  Agent rail's Overview shows the pine with `data-rail-tree-milestone="4"`; screenshot) and **milestone-toast** (fixture
  249 then 250 tasks: one toast titled "The tree grew its 5th tier"; screenshot; a second answer at 250 adds no toast).

Acceptance: `npx vitest run frontend/app/view/agents/xmastreestore.test.ts`; `task check:ts` clean; steps
`office-xmas-tree` › rail-pine and › milestone-toast, and `christmas-theme` › 8e, pass in
`task verify:ui -- office-xmas-tree christmas-theme`.

### Task 6: The tree in the hall and the 1 January scene
**Depends on:** Task 5 (the store's atoms and the scenario file)
**Files:** `frontend/app/view/agents/officeplanmodel.ts`, `frontend/app/view/agents/officeplanmodel.test.ts`, `frontend/app/view/agents/officeboss.ts`, `frontend/app/view/agents/officeboss.test.ts`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/xmastreehall.tsx`, `scripts/cdp/xmastreescenarios.mjs`

- `officeplanmodel.ts`: when the plan input says the tree shows (a new optional input flag, true only with the
  Christmas decor, a phase other than off, and the ground floor), the plan gets `xmasTree?: { box: Box; spot: Point }`
  against the hall's right wall level with the notice board, sized from `XMAS_TREE_W` / `XMAS_TREE_H` at about 3 px a
  cell, and `TREE_KEY = "xmas-tree"` is exported; the key joins the cursor order after the notice board. Tests: the box
  lies inside the hall; it overlaps neither the board, the lift (doors, dial, label strip), the lounge, nor any
  right-hand room's door (`rightDoors`); the lane between the board's right edge and the tree's left edge is at least
  `2 * BOSS_HALF_W`; its spot is on the hall floor; absent when the flag is off or on another floor.
- `officeboss.ts`: `TREE_KEY` is a stop like the board: `spotOf` (around line 541) returns the tree's spot, the hall's
  nearest-stop search (around 573) and `cardAt` (around 608) know it. Tests in `officeboss.test.ts`: the boss walks to
  the tree's spot; the nearest stop from the spot is the tree.
- `cockpitsurface.tsx`: the stops filter (around line 398) keeps `TREE_KEY` like the board and lift, and `dialogFor`
  (around 765) gives it no dialog box (Task 8 opens the card).
- `xmastreehall.tsx`: the hall tree as pixel art (the grid at the hall's cell size, ornaments from the arrangement),
  and in phase `newyear` the fireworks over the hall (`fireworkCells`, animated only with `useChristmasMotion`, one
  still frame otherwise) and a sign under the tree "This season: N tasks". Roots marked `data-xmas-tree`,
  `data-xmas-fireworks`, `data-xmas-sign`.
- `cockpitoffice.tsx`: pass the flag into the plan, draw `xmastreehall.tsx` in the hall in the office's depth order,
  make the tree clickable (the boss walks there), and walk the boss to the tree when `xmasTreeGoAtom` changes (as
  `openBoard` does). A at the tree does nothing until Task 8.
- CDP steps in `office-xmas-tree`: **hall-tree** (fixture 214 tasks: the Office on G shows `[data-xmas-tree]`;
  screenshot of the hall) and **new-year** (fixture phase newyear, 1,632 tasks: `[data-xmas-fireworks]` and a
  `[data-xmas-sign]` containing "1,632"; screenshot); extend **milestone-toast**: clicking the toast brings the boss to
  the tree (the probe's cursor key is `xmas-tree`).

Acceptance: `npx vitest run frontend/app/view/agents/officeplanmodel.test.ts frontend/app/view/agents/officeboss.test.ts`;
`task check:ts`; the hall-tree, new-year and milestone-toast steps pass.

### Task 7: The close-up card and its keys
**Depends on:** Task 3 (XmasTreeView, nearestSpot, moveOrnament, the tier helpers), Task 4 (treeGrid for the enlarged tree)
**Files:** `frontend/app/view/agents/xmastreecard.tsx`, `frontend/app/view/agents/xmastreecardmodel.ts`, `frontend/app/view/agents/xmastreecardmodel.test.ts`, `frontend/app/view/agents/officecontrols.ts`, `frontend/app/view/agents/officecontrols.test.ts`

Runs beside Tasks 5 and 6: the card takes props and callbacks, owns no key listener and reads no store.

- `officecontrols.ts`: a new `OfficeLayer` `"tree"` with two new actions (carry's `slot` / `drop` stay carry's):
  arrows → `{ do: "treeMove"; dir: Dir }`, Space/Enter → `{ do: "treeLift" }`, Escape → `{ do: "back" }`, everything
  else `none`; `backFrom("tree")` is `"walk"`. Chords still pass. Tests in `officecontrols.test.ts`.
- `xmastreecardmodel.ts` (pure): the card state `{ cursor: number; lifted: number | null }` and a reducer for treeMove
  (via `nearestSpot`, over ornaments only while nothing is lifted, every spot while one is), treeLift (lift; put down
  → `moveOrnament`, or back on its own spot), and close (a lifted ornament goes back); plus the side column's texts:
  "214 tasks", "Milestone 4 / 7: four tiers. 36 tasks to the fifth tier." (lights and star wording for 5→6 and 6→7,
  "The tree is complete." at 7), the lifted ornament's name and "Merged from 10 tasks, 8/11 to 12/11" (day/month as
  board A; "1 task, 8/11" for a small one), and the key rows: small, big and rare always, heirloom once one hangs.
  Tests cover each.
- `xmastreecard.tsx`: the card as board A lays it out (the Prototype): title "The lobby tree", the header line
  "Season 1/11 → 1/1", the enlarged grid on the left with the dashed cursor ring, the lifted ornament raised and a
  "▶ put here" label by the ring while one is lifted, the side column (count, milestone line and progress bar, the
  "Lifting" box, the key), and the footer "←↑→↓ pick · A lift / put down · B back to the hall". Props: an
  `XmasTreeView`, the card state, and callbacks. Root `data-xmas-tree-card`, lifted ornament `data-xmas-lifted`, label
  `data-xmas-put-here`.

Acceptance: `npx vitest run frontend/app/view/agents/officecontrols.test.ts frontend/app/view/agents/xmastreecardmodel.test.ts`;
`task check:ts`; the card is shown by Task 8's **card-lifted** step.

### Task 8: Open the card in the Office, the CDP card step, the changelog and the shortcuts
**Depends on:** Task 6, Task 7 (the card component, its reducer and the tree layer's key actions)
**Files:** `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/usecockpitkeyboard.ts`, `frontend/app/view/agents/cockpitsurface.tsx`, `scripts/cdp/xmastreescenarios.mjs`, `CHANGELOG.md`, `docs/keyboard-shortcuts.md`

- `usecockpitkeyboard.ts`: the office's key dispatch (the switch on `act.do`, around line 122) gets the `treeMove`
  and `treeLift` cases, and `talk` at `TREE_KEY` opens the card; add the tree layer's methods to the hook interface
  (around line 24) that `cockpitoffice.tsx`'s handle (around line 269) implements. The layer is `"tree"` while the card
  is open.
- `cockpitoffice.tsx`: implements those handle methods: opens `xmastreecard.tsx` over the office, drives its reducer,
  persists a put-down through `moveXmasOrnament`, and B closes it to walking. Play the existing office UI chip on lift
  and put-down if `officesoundcues.ts` has a fitting cue (no new sound). `cockpitsurface.tsx` only if the layer needs
  passing through.
- CDP step **card-lifted** in `office-xmas-tree`: fixture 214 tasks; walk to the tree, Space opens
  `[data-xmas-tree-card]`; an arrow and Space lift a big bauble (`[data-xmas-lifted]` present, the side column reads
  "Merged from 10 tasks", `[data-xmas-put-here]` shows); screenshot; an arrow and Space put it down; Esc closes; Space
  reopens and the ornament is on its new spot.
- `CHANGELOG.md`: one `Added` line under the top `Unreleased` section (open one if the top has a date), written for the
  user: the lobby tree that grows with finished run tasks, with ornaments to rearrange. Add `<!-- big -->` only if the
  release has fewer than 5 big cards.
- `docs/keyboard-shortcuts.md`: in the Office rows, `Space` at the tree opens its close-up, and a row for the card's
  keys.

Acceptance: `npx vitest run frontend/app/view/agents/officecontrols.test.ts`; `task check:ts`;
`task verify:ui -- office-xmas-tree` passes every step (rail-pine, milestone-toast, hall-tree, new-year, card-lifted).

# Cockpit, Jarvis, Diff and Setup on Chat's spring

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md`
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surfaces-spring-cockpit surfaces-spring-office surfaces-spring-brief surfaces-spring-initiatives surfaces-spring-diff surfaces-spring-setup cockpit-empty-state cockpit-office prefers-reduced-motion jarvis-brief-cards jarvis-brief-later jarvis-brief-activity brief-act-blocked jarvis-initiative-sheet jarvis-chunk-sheet kael1113-timeline kael1113-final-stage diff-file-states diff-scope diff-comments diff-file-keys setup-instructions-sync`

Only motion changes: radius, type, colour and layout stay as they are (spec, Scope). Radar, the Agent surface outside
Chat, Usage and Code are out of scope, and so are the overlays' `popoverReveal` / `modalPanel`.

Decisions the run lead made beyond the spec, and why:

- **One batch model, a pure function plus a thin hook** (`frontend/app/element/springbatch.ts`, Task 1). The hook
  compares against the keys of the last *committed* render (a ref written in a layout effect), so a double render or a
  re-render with the same keys never re-decides, and a card that only changes size (same keys) still animates.
  Re-deals and reorders do not count toward the 3: only keys added plus keys removed do.
- **Shared tokens are not retuned.** `cardVariants`, `composerReveal`, `paneReveal`, `foldReveal`, `sheetPanel` and
  `PaneReveal`'s default are used by surfaces out of scope (the Agent tree, Usage, Radar, council, modals), so each
  site on the four surfaces switches to `springReveal` / `springPop` (or puts `MOTION.spring` on its own height / x /
  layout transition) instead. Only the comments in `motiontokens.ts` change.
- **The 320px cap reuses Chat's `arrivalFrom` / `ARRIVAL_CAP_PX`** from `frontend/app/view/agents/chatarrival.ts`
  (import it; do not copy or move it).
- **A re-dealt cockpit card is the same card through a shared `layoutId`** (the spec's own first option): the grid's
  columns stay separate flex parents, all inside one `LayoutGroup`; a card present before and after a change exits its
  old column at once (no exit animation: pass the still-present ids to the column `AnimatePresence`s as `custom` and
  make the exit variant a function of it) and its new copy slides from the old box on the spring. The spec's
  verification line was amended to match (one copy in the DOM at every sample, no ghost, no pop).
- **Reduced motion is one hook, not `MotionConfig`** (plan review, round 1). Under `reducedMotion="user"` motion drops
  only transform and layout animations; height and opacity still play (Chat's `usePartMotion`, `chatfooter.tsx`, says
  so). Task 1 moves `usePartMotion` into `springbatch.ts` (`chatfooter.tsx` re-exports it, so Chat's importers are
  unchanged), and every `springReveal` / `springPop` / `springSheet` site on the four surfaces spreads it: under reduced
  motion it mounts at its end state and leaves with no exit. Layout and imperative transitions use
  `shapeTransition(motion, reduce)`. Spec §4 was corrected to say so before submit.
- **The sheet slide gets its own spring variant**, `springSheet` (Task 1, `motiontokens.ts`): `sheetPanel`'s x on
  `MOTION.spring`, opacity on the ease. `sheetPanel` itself stays for the council rail (out of scope); the Office panel
  (Task 3) and `ModalShell`'s `variant="sheet"`, which only Jarvis's detail sheets use (Task 5), switch to it.
- **Left on purpose:** `SurfaceScaffold`'s empty state (`surfacescaffold.tsx`, a `cardVariants` scale entrance) is one
  whole-surface state shared with Radar, Usage and Code, not a list item or a disclosure; it keeps its tween.
  `dagmodal.tsx` only uses `modalBackdrop` / `modalPanel` (overlay motion, out of scope).
- **One scenario per area, one file per area, so parallel tasks never share a file.** Task 1 registers the group
  `scripts/cdp/scenarios-surfaces-spring.mjs` and a stub per area under `scripts/cdp/surfaces-spring/`, plus the shared
  frame sampler `springprobe.mjs`; each surface task fills only its own area file. The kit is `SS_KIT = { ...OF_KIT, ...KAEL_KITS,
  run: RUN_KIT }` from scenarios.mjs: the Chat redesign's kit, `scenario(name)` (a registered scenario, so a step can
  reuse its `arrange` / `teardown`), and the Jarvis, Diff and run-seeding helpers (`kit.jarvis`, `kit.files`,
  `kit.run`).
- **The reduced-motion step lives in the Setup scenario** (Task 7), the simplest surface to trigger a fold on.
- **The initiative chunk "Fog: other surfaces (Cockpit, Jarvis, Radar, Diff, Setup)" is closed by Task 2**; Radar is
  out by the person's call (spec, Scope).

Principles for every worker: the smallest change that does it, one source of truth (`motiontokens.ts`,
`springbatch.ts`), no abstraction for one use, never swallow an error. Motion comes only from `motiontokens.ts`;
opacity stays on the Fluid ease, only shape (height, width, scale, x/y, layout) rides `MOTION.spring`. Under reduced
motion springs jump: every variant site spreads `usePartMotion(variants)` from `springbatch.ts` (not `MotionConfig`,
which leaves height and opacity animating), and layout or hand-rolled height code uses `shapeTransition(motion,
reduce)` with `useReducedMotion()`. Pure logic lives in a `.ts` beside its `.test.ts`; no render tests (AGENTS.md). Run only the
focused tests named in your task, plus Check. Existing scenarios on your surface must keep passing: if one fails only
because it samples before the ~0.35s spring settles, lengthen its wait (the file is on your Files line), never weaken
what it asserts. Before you finish, run your area's scenario against a dev app of your tree (`AGENTS.md`, Visual
verification; `CDP_PORT=<port> task verify:ui -- <name>`, or `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs
<name>`); if you cannot run it, say exactly what was not verified.

### Task 1: The batch model, the scenario scaffold, and the docs
**Depends on:** none
**Files:** `frontend/app/element/springbatch.ts`, `frontend/app/element/springbatch.test.ts`, `frontend/app/element/motiontokens.ts`, `frontend/app/view/agents/chatfooter.tsx`, `DESIGN.md`, `docs/reference/motion-system.md`, `CHANGELOG.md`, `docs/hand-checks.md`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-surfaces-spring.mjs`, `scripts/cdp/surfaces-spring/springprobe.mjs`, `scripts/cdp/surfaces-spring/springprobe.test.mjs`, `scripts/cdp/surfaces-spring/cockpit.mjs`, `scripts/cdp/surfaces-spring/office.mjs`, `scripts/cdp/surfaces-spring/brief.mjs`, `scripts/cdp/surfaces-spring/initiatives.mjs`, `scripts/cdp/surfaces-spring/diff.mjs`, `scripts/cdp/surfaces-spring/setup.mjs`

Everything Tasks 2–7 build on. Interfaces other tasks rely on (names and shapes are fixed here):

`frontend/app/element/springbatch.ts` (spec Design §3):

```ts
export type BatchMotion = "animate" | "instant";
export const BATCH_INSTANT_AT = 3;
export interface BatchSeen { keys: readonly string[]; filter?: string }
// null prev = first load → "instant"; filter changed → "instant"; |added| + |removed| >= BATCH_INSTANT_AT → "instant";
// otherwise "animate" (order changes and re-deals count 0, so a size-only change animates)
export function batchMotion(prev: BatchSeen | null, keys: readonly string[], filter?: string): BatchMotion;
// prev = the keys and filter of the last committed render (a ref set in useLayoutEffect), so a re-render never re-decides
export function useSpringBatch(keys: readonly string[], filter?: string): BatchMotion;
// MOTION.spring when "animate" and reduce is false, { duration: 0 } otherwise
export function shapeTransition(motion: BatchMotion, reduce?: boolean | null): Transition;
// moved here unchanged from chatfooter.tsx (which re-exports it): reduce → { variants, initial: false,
// animate: "animate" } (no exit); otherwise { variants, initial: "initial", animate: "animate", exit: "exit" }
export function usePartMotion(variants: Variants);
```

`motiontokens.ts` gains `springSheet: Variants`: `sheetPanel`'s shape (`opacity` 0 → 1, `x` 24 → 0, out the same
way) with `x` on `MOTION.spring` and opacity on the Fluid ease (`durMicro` in, `durExit` out).

`scripts/cdp/surfaces-spring/springprobe.mjs` (page-side samplers return JS expression strings for
`Runtime.evaluate`, with `awaitPromise`):

- `startSampler(selector, { ms = 900 } = {})`: installs `window.__arcSpringProbe`, recording on every animation frame
  for `ms` `{ t, n, rect }` (n = how many elements match `selector`, rect = the first match's
  `getBoundingClientRect()` top/left/width/height, or null). Start it, then trigger the change (in the page or from
  the scenario), then read.
- `readSampler()`: resolves to the samples once the window is over.
- Pure verdicts on the samples: `between(samples, key)` (some sample's `rect[key]` lies strictly between the first
  and the last sample's), `atOnce(samples, key)` (from the first sample that differs from the first one, every later
  sample equals the last: it landed in one frame), `singleCopy(samples)` (every sample has n ≤ 1).

`scripts/cdp/scenarios-surfaces-spring.mjs` copies the shape of `scenarios-overlays-frost.mjs`: a header naming each
area file and its task, and `export default (kit) => [...cockpit(kit), ...office(kit), ...brief(kit),
...initiatives(kit), ...diff(kit), ...setup(kit)]`. Each area file is a stub `export default (kit) => []` with a
one-line comment naming its scenario (`surfaces-spring-<area>`) and its task. Register the group in `scenarios.mjs` as
`...surfacesSpringScenarios(SS_KIT)` beside `overlaysFrostScenarios`, with `const SS_KIT = { ...OF_KIT, ...KAEL_KITS,
run: RUN_KIT }` defined after `RUN_KIT` and a comment saying what each part is for.

Docs (spec, DESIGN.md section): DESIGN.md's Motion rule's last sentence becomes "every surface but Radar uses the
spring for anything that changes shape, and a batch change (first load, a filter switch, 3+ items at once) shows at
once (`element/springbatch.ts`); Radar keeps its tweens until it is moved on purpose", and "card entrances animate
opacity + scale, never x/y" drops the `Reorder.Item` reason (cockpit cards may slide on the layout spring). In
`motiontokens.ts` change only comments: `springReveal`'s ("other surfaces keep their tween reveals" → every surface
but Radar), `cardVariants`' and `sheetPanel`'s `Reorder.Item` reasons (there is no `Reorder` in the frontend). Update
the matching sentence in `docs/reference/motion-system.md` and list `springbatch.ts` and `springSheet` there. CHANGELOG under
`Changed` in the top section: "The Cockpit, Jarvis, Diff and Setup move on the same smooth spring as Chat: rows and
cards open and fold instead of jumping, and a filter switch or a big update still shows at once." One `- [ ]
(arcterm)` line in `docs/hand-checks.md`: the spring's feel on the four surfaces in the packaged app on a real roster
(the scenarios run on fixtures).

Acceptance: `npx vitest run frontend/app/element/springbatch.test.ts scripts/cdp/surfaces-spring/springprobe.test.mjs`
passes, covering: first load → instant; filter change → instant; 1 and 2 arrivals or departures → animate; 3 arrivals,
3 departures, 2 + 1 mixed → instant; same keys reordered (a re-deal) → animate; `shapeTransition` under reduce →
duration 0; `between` / `atOnce` / `singleCopy` on hand-made samples. Chat's `usePartMotion` importers
(`chatband.tsx`, `chatcomposer.tsx`, `councilchat.tsx`) still typecheck unchanged. Importing `scripts/cdp/scenarios.mjs` in node
(`node -e "import('./scripts/cdp/scenarios.mjs').then((m) => console.log(m.SCENARIOS.filter((s) => s.name.startsWith('surfaces-spring')).length))"`)
loads with the group registered (0 names until Tasks 2–7 fill the stubs) and adds no duplicate name.

### Task 2: Cockpit cards view on the spring
**Depends on:** Task 1
**Chunk:** Fog: other surfaces (Cockpit, Jarvis, Radar, Diff, Setup)
**Files:** `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/agentrow.tsx`, `frontend/app/view/agents/leadcard.tsx`, `frontend/app/view/agents/cockpitemptystate.tsx`, `frontend/app/view/agents/idlesection.tsx`, `frontend/app/view/agents/backgroundedsection.tsx`, `frontend/app/view/agents/backgroundagentsstrip.tsx`, `frontend/app/view/agents/cardgridlayout.ts`, `frontend/app/view/agents/cardgridlayout.test.ts`, `scripts/cdp/surfaces-spring/cockpit.mjs`, `scripts/cdp/scenarios.mjs`

Spec Design §1–§3, the Cockpit parts, except the Office (Task 3). Inventory every shape-changing tween and every
one-frame show/hide in these files and move it as §1/§2 say (a card's composer `composerReveal` → `springReveal`, a
card's entrance `cardVariants` → `springPop`, the Idle / backgrounded sections' rows, the empty state). The grid
(`cockpitsurface.tsx`, the `columns.map` with one `AnimatePresence` per column):

- `useSpringBatch(cards.map((c) => c.id), chip)` decides the render. Every card wrapper (the motion root of
  `AgentRow` and `LeadCard`) takes `layoutId={card id}` inside one `LayoutGroup` around the columns, its layout
  transition `shapeTransition(motion, reduce)`; on "instant" new cards mount with `initial={false}` and leaving ones
  exit with no animation. A chip switch remounts the grid under a key (spec §3).
- A card present before and after a change never fades or pops: the column presences get `custom` = the set of ids
  still in the grid, and the card's exit variant is a function of it (gone → `springPop.exit`; still here → leave at
  once). Its copy in the new column slides from the old box (shared `layoutId`).
- `AgentRow` / `LeadCard` are drawn only from `cockpitsurface.tsx`'s `renderCard`, which both the grid and the
  Office's card panel (`renderOfficeCard`) use: give them the layout props through an optional prop that only the
  grid's call passes, so the Office panel's card takes no `layoutId`.
- Layout animation of a resizing card scales its content while it moves (motion's layout uses transforms); if the
  distortion is visible, correct it on the card's direct content (`layout` on it) rather than giving up the resize. Say
  in your report what you chose.

Acceptance — fill `scripts/cdp/surfaces-spring/cockpit.mjs` with scenario `surfaces-spring-cockpit` (arrange a
populated cards view from the cockpit fixtures or `inject-live-agents.mjs`; a reload is a first load and lands at
once, so arrive a card without one, as `cockpit-keys-on-arrival` in `scenarios.mjs` does), each step with a screenshot,
sampled with `springprobe.mjs`:
(1) one card arriving: the new card's scale/opacity are mid-way at an early sample (pops on the spring), a card
re-dealt to the other column is `between` its old and new place with `singleCopy`, and a column-mate's height is
`between` its old and new;
(2) a chip switch (all → working): the new list `atOnce`;
(3) three cards arriving in one update: `atOnce`, no card mid-scale.
`npx vitest run frontend/app/view/agents/cardgridlayout.test.ts` still passes (add a case only if you change it).
`cockpit-empty-state` still passes.

### Task 3: Cockpit Office on the spring
**Depends on:** Task 1 (fills the `office.mjs` stub and the probe it adds)
**Files:** `frontend/app/view/agents/cockpitoffice.tsx`, `scripts/cdp/surfaces-spring/office.mjs`, `scripts/cdp/cockpitofficescenarios.mjs`

Spec §1. The Office has no motion `layout` animation and no animated list; its two shape changes are the desk card
panel (`OfficeCardPanel`, `sheetPanel` on its `motion.div`) and the office's pan, a CSS `transform` transition the
panel's `useLayoutEffect` sets on the root (`translateX(-pan)`, `durMacro` on the Fluid ease). The panel switches to
`springSheet` through `usePartMotion`; the pan drives the root's x with motion's `animate(root, { x: -pan },
shapeTransition("animate", reduce))` instead of the CSS transition (when `moving` is false it still lands at once,
before paint, so a shut panel never leaves the office slid for a frame). Leave pure fades and the office's sprite/pet
motion alone.

Acceptance — scenario `surfaces-spring-office` in `office.mjs` (reuse `cockpit-office`'s `arrange` / `teardown` via
`kit.scenario("cockpit-office")`), each step with a screenshot: (1) opening the desk's card panel: its x is `between`
the edge and its rest at an early sample; (2) the office's pan as the panel opens: the office root's x is `between`
0 and `-pan` at an early sample, and back at 0 after the panel shuts. `cockpit-office` and `prefers-reduced-motion` in `cockpitofficescenarios.mjs` still pass.

### Task 4: Jarvis brief page on the spring
**Depends on:** Task 1 (fills the `brief.mjs` stub and uses `useSpringBatch`)
**Files:** `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/jarvis/briefrowviews.tsx`, `frontend/app/view/jarvis/initiativelist.tsx`, `frontend/app/view/jarvis/initiativecards.tsx`, `frontend/app/view/jarvis/waitingstrip.tsx`, `frontend/app/view/jarvis/briefpeekview.tsx`, `frontend/app/view/jarvis/brieftoast.tsx`, `frontend/app/view/jarvis/peterrand.tsx`, `frontend/app/view/jarvis/petpeek.tsx`, `frontend/app/view/jarvis/recordbandview.tsx`, `frontend/app/view/jarvis/forlaterregion.tsx`, `frontend/app/view/jarvis/activityregion.tsx`, `scripts/cdp/surfaces-spring/brief.mjs`, `scripts/cdp/scenarios-jarvis-cards.mjs`, `scripts/cdp/scenarios-brief-act.mjs`, `scripts/cdp/scenarios-jarvis-later.mjs`, `scripts/cdp/scenarios-jarvis-activity.mjs`

Spec §1–§3 on the Brief: `paneReveal` in `briefsurface.tsx` and `petpeek.tsx`, `composerReveal` in `peterrand.tsx`
and `recordbandview.tsx` → `springReveal` (or their own variant with `MOTION.spring` on height); `brieftoast.tsx`'s
`cardVariants` → `springPop`'s signature (keep its `pointerEvents: "none"` exit) and its `layout` on `MOTION.spring`;
`petpeek.tsx`'s `layout="size"` transition on `MOTION.spring`. The one-frame disclosures open and fold on
`springReveal`: a brief row's detail (`briefrowviews.tsx`, the `expanded && children` sites, initiative card and idea
row), the regions' "Show more / Show less" (`briefsurface.tsx`, and the initiatives region's in `initiativelist.tsx`),
the "since" sections, the Waiting strip's "Show all N" (`waitingstrip.tsx`) and the peek's objective "Show less"
(`briefpeekview.tsx`). Brief rows that arrive or leave one at a time open and
fold on `springReveal`; first load, the brief's filter or search, and 3+ rows at once show at once (`useSpringBatch`
per region list, `AnimatePresence initial={false}`).

Acceptance — scenario `surfaces-spring-brief` in `brief.mjs` (seed with `seed-brief.mjs` or reuse
`jarvis-brief-cards`' arrange via `kit.scenario`), each step with a screenshot: (1) a brief row's detail opens with its
height `between` closed and open at an early sample, and folds the same way; (2) a region's "Show more" opens on the
spring. `jarvis-brief-cards` still passes.

### Task 5: Jarvis initiatives and runs on the spring
**Depends on:** Task 1 (fills the `initiatives.mjs` stub and uses `useSpringBatch`)
**Files:** `frontend/app/view/jarvis/chunkview.tsx`, `frontend/app/view/jarvis/initiativesheet.tsx`, `frontend/app/view/jarvis/effortdetailview.tsx`, `frontend/app/view/jarvis/finalshotsviewer.tsx`, `frontend/app/view/jarvis/briefrunsheet.tsx`, `frontend/app/view/jarvis/runsheet.tsx`, `frontend/app/view/jarvis/runtimingview.tsx`, `frontend/app/view/orchestrate/timelinerail.tsx`, `frontend/app/modals/modalshell.tsx`, `scripts/cdp/surfaces-spring/initiatives.mjs`, `scripts/cdp/scenarios-jarvis-sheet.mjs`, `scripts/cdp/scenarios-kael1113-timeline.mjs`, `scripts/cdp/scenarios-kael1113-final.mjs`

Spec §1–§3 on Jarvis's initiative and run sheets: an initiative's chunk list (`initiativesheet.tsx`, `chunkview.tsx`:
the chunk trail, a block's "Show all / Show less") and the final shots viewer's steps (`finalshotsviewer.tsx`,
`stepsOpen`) and the run sheet's timing section (`runtimingview.tsx`) open and fold on `springReveal`;
`ModalShell`'s `variant="sheet"` (only Jarvis's detail sheets use it) slides on `springSheet` (its centered
`modalPanel` branch is overlay motion and stays); `PaneReveal` call sites in these files pass `springReveal`
(`PaneReveal`'s default stays `paneReveal`: Radar and the Agent surface use it). Chunks or trail entries that arrive one
at a time open on the spring, a batch shows at once (`useSpringBatch`). `finalshotsviewer.tsx` is also drawn in the
Agent surface's final stage (`finalstageviews.tsx`): the same motion there is fine.

Acceptance — scenario `surfaces-spring-initiatives` in `initiatives.mjs` (reuse `jarvis-initiative-sheet` /
`jarvis-chunk-sheet` fixtures via `kit.scenario`), each step with a screenshot: (1) an initiative's chunk list opens
with its height `between` at an early sample; (2) a chunk's "Show all" opens on the spring; (3) the final shots
viewer's steps open on the spring (seed shots with `kit.run.seedFinalShots`); (4) a Jarvis detail sheet's x is
`between` at an early sample as it opens. `jarvis-initiative-sheet`, `jarvis-chunk-sheet`, `kael1113-timeline` and
`kael1113-final-stage` still pass.

### Task 6: Diff Review mode folds on the spring
**Depends on:** Task 1 (fills the `diff.mjs` stub)
**Files:** `frontend/app/view/agents/reviewlistview.tsx`, `scripts/cdp/surfaces-spring/diff.mjs`, `scripts/cdp/scenarios-diff-states.mjs`, `scripts/cdp/scenarios-diff-scope.mjs`, `scripts/cdp/scenarios-diff-comments.mjs`, `scripts/cdp/scenarios-diff-file-keys.mjs`

Spec §2, the Diff bullet: only Review mode's file fold moves (`reviewlistview.tsx`, its `collapsed` set). A file
folding or unfolding opens/closes its body height on `MOTION.spring` (opacity on the ease); a body taller than
`ARRIVAL_CAP_PX` animates only its last 320px (`arrivalFrom` from `chatarrival.ts`), the rest there at once, and a
fold starts from at most 320px visible. A file whose header is above the reading position folds or unfolds at once,
so the `scrollTo` anchor and the reader's place hold. File mode's file switch and the side panel fold
(`panelFoldedAtom`) stay instant. The body holds Monaco/diff rows: if a motion component per file costs measurable
render time on a large diff, drive the height imperatively as Chat's `Arriving` does (`chatconversation.tsx`), and
say which you chose.

Acceptance — scenario `surfaces-spring-diff` in `diff.mjs` (reuse `diff-file-states`' fixture repo via
`kit.scenario`, with a file long enough to pass 320px), each step with a screenshot: (1) a short file folds and
unfolds with its body height `between` at an early sample; (2) a long file unfolds with its height starting at
(full − 320) ± a few px, never at 0; (3) folding a file above the viewport leaves the reading position's scrollTop
unchanged. `diff-file-states`, `diff-scope`, `diff-comments` and `diff-file-keys` still pass.

### Task 7: Setup on the spring, and the reduced-motion check
**Depends on:** Task 1 (fills the `setup.mjs` stub and uses `shapeTransition`)
**Files:** `frontend/app/view/agents/setupsurface.tsx`, `scripts/cdp/setup-fixtures.mjs`, `scripts/cdp/memory-fixtures.mjs`, `frontend/app/view/agents/setupmemory.tsx`, `frontend/app/view/agents/toolslibrary.tsx`, `frontend/app/view/agents/projectcontexttab.tsx`, `frontend/app/view/agents/learnedtab.tsx`, `frontend/app/view/agents/memorycard.tsx`, `frontend/app/view/agents/memoryparts.tsx`, `scripts/cdp/surfaces-spring/setup.mjs`, `scripts/cdp/scenarios-setup-instructions.mjs`

Spec §1–§3 on Setup: the three `PaneReveal ... variants={composerReveal}` (conflict and error banners) →
`springReveal`; the one-frame disclosures (Tools' "others" list in `toolslibrary.tsx`, memory and learned sections,
any section that toggles in one frame) open and fold on `springReveal`; rows arriving one at a time in a Setup list
open on the spring, a batch (first load, a tab switch, search, 3+ at once) shows at once (`useSpringBatch`). The tab
panel's `FADE_IN` is a pure fade: leave it. `memoryparts.tsx` / `memorycard.tsx` are only drawn in Setup's memory tab.

Acceptance — scenario `surfaces-spring-setup` in `setup.mjs`, each step with a screenshot: (1) a Setup disclosure
opens with its height `between` at an early sample and folds the same way. Pick one an existing fixture reaches
(`setup-fixtures.mjs`, `memory-fixtures.mjs`, or `setup-instructions-sync`' arrange via `kit.scenario`) and name it in
the scenario's header; Tools' others list (`ToolSuggestions` in the Add-tool form) needs a directory whose
`package.json` has a server script, so use it only if you add that fixture; (2) with `prefers-reduced-motion: reduce` emulated
(`Emulation.setEmulatedMedia`), the same section lands `atOnce`; clear the emulation in teardown.
`setup-instructions-sync` still passes.

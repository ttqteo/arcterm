# Cockpit, Jarvis, Diff and Setup on Chat's spring

Date: 2026-11-14 · Brainstorm: `.superpowers/brainstorm/surfaces-chat-look/brainstorm.json` ·
Initiative: "GUI redesign after the AI-chat references" (`effort 7655bf18-619e-40cf-8805-5f4a6e5ac85e`, chunk
"Fog: other surfaces (Cockpit, Jarvis, Radar, Diff, Setup)")

No prototype: nothing changes in layout or look, only how things move.

## Goal

Carry the new Chat's motion to the other surfaces, so they feel as smooth as Chat: anything that changes shape rides
the no-bounce spring, and content that today appears or disappears in one frame opens and folds on it.

## Scope

- In scope: the Cockpit (cards view and Office), Jarvis, Diff (the `files` surface) and Setup surfaces.
- Out of scope: Radar (the person's call). Also the surfaces not named: the Agent surface outside Chat, Usage and Code.
- Only the spring carries over (answer 1). Chat's type rhythm (14px, line-height ~1.6, tracking -0.01em), its pill
  chips, the 22px floating box and its compact step lines do **not**: radius, type, colour and layout stay as they are.
- The shared overlays' fill is done (chunk 10). Overlay motion (`popoverReveal`, `modalPanel`) is not in scope.

## Today

- `element/motiontokens.ts` holds `MOTION.spring` (`{ type: "spring", visualDuration: 0.35, bounce: 0 }`) and its two
  variants, `springReveal` (height 0 → auto on the spring, opacity on the Fluid ease at `durMicro`) and `springPop`
  (scale 0.97 → 1 on the spring, opacity on the ease). Only Chat uses them.
- The four surfaces use tween reveals: `composerReveal` (`setupsurface.tsx`, `recordbandview.tsx`, `peterrand.tsx`),
  `paneReveal` (`briefsurface.tsx`, `petpeek.tsx`), `sheetPanel` (`cockpitoffice.tsx`, the Jarvis detail sheets),
  `cardVariants` (cockpit cards, `cockpitemptystate.tsx`, `brieftoast.tsx`), and `layout` animations
  (`cockpitoffice.tsx`, `view/orchestrate/*` drawn inside Jarvis).
- Other places show and hide in one frame (a conditional render with no motion): Jarvis brief rows
  (`briefrowviews.tsx`), an initiative's chunks (`chunkview.tsx`, `initiativesheet.tsx`), the final shots viewer, a
  cockpit card arriving or leaving, a file folding in Diff's Review mode (`reviewlistview.tsx`).
- The Cockpit cards view has no per-state columns: `splitGridColumns` (`cardgridlayout.ts:32`) puts leads in column 1
  and agents in column 2 when both kinds are present, else deals cards round-robin (`i % n`) across 2–3 columns, and
  every card takes a flex-grow share of its column's height (`cardShare`, `cardgridlayout.ts:46`). The chips filter
  one list (`cockpitsurface.tsx:331`); each column is its own `AnimatePresence` (`cockpitsurface.tsx:1145`).
- DESIGN.md (Motion) says Chat uses the spring and "other surfaces keep their tween reveals until they are moved on
  purpose". `cardVariants` is opacity + scale only, a rule written because `Reorder.Item` owned a cockpit card's x/y
  transform; there is no `Reorder` in the frontend any more.

## Design

### 1. Tweens that change shape move to the spring (answer 2)

Every reveal on the four surfaces that changes a size or a position moves to the spring:

- a height reveal (`composerReveal`, `paneReveal`, `foldReveal`, a hand-written height tween) → `springReveal`, or its
  height transition on `MOTION.spring` where a site keeps its own variant (e.g. `foldReveal`'s clip-while-moving);
- a scale entrance (`cardVariants` on a card, a panel that pops in) → scale on the spring, as `springPop`;
- the Office's two shape changes are its card panel (`sheetPanel`'s x slide, now `springSheet`) and its pan, both with
  the transition on `MOTION.spring`; Diff has no layout animation (amended 2026-11-15 after plan review: the first
  draft named existing `layout` animations on the Office's positions and in Diff, and neither exists).

Opacity stays on the Fluid ease everywhere (a spring on opacity overshoots 1). Durations of pure fades are unchanged.

### 2. What jumps today opens and folds on the spring (answer 2)

- A row or card that arrives in a list opens its height on `springReveal` (a card in a column: `springPop`), so it
  never shoves what the reader is looking at; one that leaves folds the same way.
- A disclosure that today toggles in one frame (a brief row's detail, an initiative's chunk list, a file in Diff's
  Review mode, a Setup section) opens and folds on `springReveal`.
- A very long block (a large file unfolding in Review mode) animates only its last ~320px of height; the rest is there
  at once, as Chat does (`initial` height computed at mount, skipped under reduced motion).
- **Diff (Agent's call, builder question 3):** only Review mode (`reviewlistview.tsx`, its `collapsed` set) has files
  that fold, and only that fold moves. A file folding or unfolding above the reading position shows at once, so the
  `scrollTo` anchor and the reader's place hold (as Chat's Show earlier never animates). Switching files in File mode
  (one `MonacoDiffViewer` in `fill` mode, no height to spring) and folding the side panel (`panelFoldedAtom`, which
  would re-lay Monaco out every frame) stay instant.

### 3. One change springs, a batch appears at once (answer 3)

- A single row or card arriving, leaving, opening or folding runs the spring.
- The first load of a list, a filter switch (the Cockpit chips all / asking / working / idle, any surface filter), and
  an update that changes **3 or more** items of the same list at once show the new state immediately, with no motion.
  Lists sit in `AnimatePresence initial={false}`, and a filter switch remounts the list under a key.
- **The Cockpit card grid slides on the spring (builder question 1, the person's answer).** Every card in the cards
  view takes a `layout` animation on `MOTION.spring`. When one card arrives or leaves (the roster changed, or an agent
  changed state under a chip and joined or left the filtered list), the new card enters on `springPop`, the leaving one
  exits the same way, cards re-dealt to the other column by `splitGridColumns` slide to their new place, and cards in
  the same column resize smoothly as their `cardShare` changes. Re-dealt cards must move as the same element (one
  shared `layoutId` per card across the column `AnimatePresence`s, or one presence over the grid), never exit one column
  and enter another. On an instant change (first load, a chip switch, 3+ cards arriving or leaving at once) the layout
  animation is off for that render and everything lands in one frame. Re-deals and resizes caused by a single arrival
  count as that one change, not toward the 3.
- `cardVariants`' "never x/y" rule is dropped for cockpit cards: it existed because `Reorder.Item` owned their
  transform, and there is no `Reorder` in the frontend now.
- The rule is one pure model with a test (e.g. `springbatch.ts`: given the previous and next item keys of a list and
  why it changed, answer "animate" or "instant"), used by every list on the four surfaces.

### 4. Reduced motion

Springs jump, as in Chat. `MotionConfig reducedMotion="user"` is not enough: it drops only transform and layout
animations, and height and opacity still play. So every spring variant site spreads Chat's `usePartMotion` (moved to
`element/springbatch.ts`), which under reduced motion mounts at the end state and leaves with no exit, and layout or
hand-rolled height code takes `shapeTransition(motion, reduce)` (no duration under reduced motion). Amended 2026-11-15
by the run lead after plan review.

## DESIGN.md

The Motion rule's last sentence ("Chat uses these; other surfaces keep their tween reveals until they are moved on
purpose") becomes: every surface but Radar uses the spring for anything that changes shape, and a batch change (first
load, a filter switch, 3+ items at once) shows at once. Radar keeps its tweens until it is moved on purpose.
`springReveal`'s comment in `motiontokens.ts` changes to match, and `cardVariants`' comment and DESIGN.md's "card
entrances animate opacity + scale, never x/y" drop the `Reorder.Item` reason: cockpit cards may slide on the layout
spring.

## Verification

- Unit tests: the batch model (single change → animate, its re-deals included; first load, filter switch, 3+ arrivals
  or departures → instant).
- A CDP scenario per surface (or one scenario with a step per surface, e.g. `surfaces-spring`), each step with a
  screenshot:
  - Cockpit: one card arriving pops in on the spring, and mid-flight a re-dealt card sits between its old and new
    place and a column-mate's height is between its old and new height (one copy of the card in the DOM at every
    sample: no exit ghost left in the old column and no pop in the new one; a remount under the card's shared
    `layoutId` counts as the same card, since the columns are separate parents and React cannot move a node between
    them; amended 2026-11-15 by the run lead, the Design section already allowed the `layoutId` route); a chip
    filter switch shows the new list in the next frame; 3 cards arriving at once land in one frame.
  - Jarvis: a brief row's detail opens on the spring; an initiative's chunk list opens on the spring.
  - Diff (Review mode): a file folds and unfolds on the spring; a long file unfolds with the 320px cap.
  - Setup: a section opens on the spring.
  - With reduced motion emulated, one of the above lands in one frame.
- Existing scenarios on these surfaces keep passing (their waits may need to allow the spring's ~0.35s settle).
- `task check:ts` and vitest.
- A `- [ ]` line in `docs/hand-checks.md` for anything not seen in the running app.
- One CHANGELOG line under Changed: the Cockpit, Jarvis, Diff and Setup move on the same spring as Chat.

## Left to the builder

- The inventory of every shape-changing and one-frame site on the four surfaces (section 2 lists the known ones).
- The batch model's name and shape, and how each list feeds it.
- The scenario's name and steps.
- The DESIGN.md and `motiontokens.ts` comment edits.

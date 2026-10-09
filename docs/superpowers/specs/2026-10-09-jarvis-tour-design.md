# Jarvis tour

A step-by-step tour of the Jarvis surface: one real control at a time is lit, with a small card beside it that says
what it is and what to do, in Vietnamese or English. The person asked for it because much of Jarvis is hard to find
on one's own.

## Decisions

- **Form:** a spotlight on the real element plus a card with **Back**, **Next** and **Skip**, step `n / N`.
- **Tracks:** four, each started on its own: **Brief**, **Initiatives**, **Run sheet**, **Profile**.
- **Language:** every step has Vietnamese and English text. A `VI | EN` switch on the card picks one and is
  remembered; Vietnamese is the default. Only the tour is bilingual, so no i18n library.
- **A step whose element is not there:** the tour first opens what the step needs (the Profile, the newest run's
  sheet, the first initiative). If there is still nothing, as with no run at all, the step shows as a card in the
  middle of the surface with no spotlight and says what would be there.
- **Start:** a **?** button in the Jarvis header opens a menu of the four tracks. The first time Jarvis opens, a small
  offer card proposes the Brief track; either answer means it never shows again.
- **Built in the repo, no tour library:** the hard parts (opening what a step needs, falling back, keys) are ours
  either way, and a library's own CSS and keys would fight the theme tokens and the keybinding system.

## Tracks

Selectors are the ones already in the code unless marked *new*.

### Brief (surface `jarvis`)

1. `[data-jarvis-brief-band="waiting"]`, or `[data-jarvis-brief-region="waiting"]` when the queue is not empty: what
   waits on you; the nav badge counts the same.
2. The region heads (`[data-jarvis-brief-region] button[aria-pressed]`): a click shows only that region.
3. `[data-jarvis-brief-region="sessions"]` with `[data-jarvis-run-kind]`: runs going on their own, by project; a row
   opens its run sheet.
4. `[data-jarvis-brief-region="behind"]` with `[data-jarvis-brief-mark-seen]`: what landed since you last looked.
5. `[data-jarvis-brief-filter]`: `/` filters the Brief, `Esc` clears it.
6. Centered card: the Brief's keys, `j` / `k`, `Enter`, `d`, `e`, `Shift+G`, `i`.

### Initiatives

1. `[data-jarvis-new-initiative]`: a piece of work bigger than one run.
2. `[data-jarvis-brief-row="initiative"]` with `[data-jarvis-segment-bar]`: one segment per chunk.
3. `[data-jarvis-work-on]` and `[data-jarvis-initiative-menu]`: start an agent on it (`w`); rename, pause, archive.
4. The tour reveals the first initiative (`briefRevealChunkAtom`) and lights `[data-jarvis-initiative-detail="true"]`:
   stages, chunks, `[data-jarvis-chunk-status]`, `[data-jarvis-add-chunk]`.
5. `[data-jarvis-ideas]` with `[data-jarvis-jot-idea]`: ideas with no chunks yet; **Plan it** has an agent split one.
6. `[data-jarvis-brief-archived]`: archived initiatives.

### Run sheet

The tour opens the newest run's sheet (`openAddress(model, "run:<id>")`); with no run, every step is a centered card.

1. `[data-run-sheet-verb]` and the meter (`[data-run-sheet] [role="img"]`): where the run stands.
2. `[data-run-sheet-rows]`: each task's state and action (Open in Agent, View child run, Open DAG), then `next:`.
3. `[data-run-sheet-timeline]`'s toggle: every event, newest first; the part to read when a run needs you.
4. `[data-run-sheet-final-shots]`, only when the run has a Final: the screenshots of its last final round.
5. `[data-jarvis-brief-sheet-config="editable"]`: the run's shape, and **Adjust** for later dispatches.
6. `footer[data-jarvis-brief-sheet-face="settings"]`, its buttons marked *new* `data-run-sheet-dock="dag|lead|ask|cancel"`.
7. `aria-label="Previous run"` / `"Next run"` (`j` / `k`), and `[data-jarvis-brief-band="composer"]` when present.

### Profile

The tour opens the Profile (`briefProfileAtom` set to `""`).

1. `[data-jarvis-brief-profile]` and `[data-jarvis-autonomy="chip"]`.
2. `[data-jarvis-profile-tab]`: Global for every project, Project for this one; **Same as global** inherits.
3. `role=group[aria-label="Default shape"]` and *new* `[data-jarvis-profile-field="parallel"]`.
4. *new* `[data-jarvis-profile-field="lead-route|worker-route|reviewer-route"]`: which harness and model each role uses.
5. `role=group[aria-label="Runs land on"]`: own branch `wave/<runId>` merged back when done, or the checkout; a
   branch run is held when the checkout has uncommitted edits to a file it changes.
6. `[data-jarvis-global-principles="editor"]`: short rules put in the lead's prompt, customizable per project.
7. *new* `[data-jarvis-profile-save]`: saving applies to runs started afterwards only.

## Components

- `frontend/app/view/jarvis/jarvistour.ts`, pure: the step and track types, the reducer (`start`, `next`, `back`,
  `close`), and `stepView(step, found)`, which turns a step and whether its target was found into a spotlight or a
  centered card. A step's `prepare` is data (`"brief" | "newestRun" | "profile" | "firstInitiative"`), not a function,
  so the reducer stays testable and the component does the opening.
- `frontend/app/view/jarvis/jarvistourcontent.ts`: the four tracks, each step `{ id, target?, prepare?, vi, en }` with
  a title and a body in each language.
- `frontend/app/view/jarvis/jarvistourstore.ts`: `tourAtom` (the track and step, or null); `tourLangAtom` and
  `tourOfferedAtom` as `atomWithStorage` (`jarvis.tour.lang`, `jarvis.tour.offered`, `getOnInit: true`).
- `frontend/app/view/jarvis/jarvistour.tsx`, thin: the overlay, the card and the **?** menu.
  - The overlay is a fixed layer above dialogs: a dim with a cut-out round the target's `getBoundingClientRect`,
    measured again on resize, scroll and a DOM change. It takes every click, so a click outside the card does
    nothing; the tour teaches by showing, not by letting a click open things mid-step.
  - The card is placed with `@floating-ui/react` (`offset`, `flip`, `shift`, `autoUpdate`, as
    `autonomyladderview.tsx` does) against the target's rect, or centered.
  - Keys while the tour is open: `→` / `Enter` next, `←` back, `Esc` closes. A capture-phase listener takes them
    before ModalShell's Escape, and the tour's open atom joins the guard list of `surface:back-home` in
    `bindings.ts`. The **?** button has no chord: `Shift+?` is the shortcuts cheatsheet.
- The **?** button sits in the Brief header after the Profile button (`briefsurface.tsx`, before the divider),
  28×28 like it; the offer card sits under the header.

## Behaviour

- Starting a track sets the surface to `jarvis`. Before each step the tour runs its `prepare`, waits for the target
  for up to one second, then lights it or centers the card.
- What the tour opened (the run sheet, the Profile) it closes when the track ends or is skipped; what was open
  before stays open.
- Leaving the Jarvis surface ends the tour.
- Colors are `@theme` tokens only, so every theme applies.

## Testing

- `jarvistour.test.ts`: the reducer's bounds, `stepView` with a target found and missing, each track's `prepare`
  order, and that every step of every track has a non-empty title and body in both languages.
- A CDP scenario `jarvis-tour` in `scripts/cdp/scenarios.mjs`: open Jarvis, click **?**, start Brief and shoot its
  first step, step on, switch to EN and check the card's text, `Esc` closes; start Profile and check the Profile
  opened with the route field lit. Each track's first step is shot.

## Docs

- `docs/guide/jarvis.md`: a short section on the tour.
- `CHANGELOG.md`: one line under Added.

## Not in this change

- A tour for any other surface, and translating the rest of the UI.
- Demo data during the tour.

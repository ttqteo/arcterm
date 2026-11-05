# Christmas theme

**Spec:** `docs/superpowers/specs/2026-11-05-christmas-theme-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/memgate`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs christmas-theme surface-smoke terminal-theme`
**Prototype:** D:\src\arcterm\.superpowers\design\christmas-theme\project\A-forest-gold.dc.html

The Christmas preset: a palette in `THEMES`, plus snow over the window, a string of lights under the app bar, trees,
gifts, a wreath and Santa hats in the Office, and the pet's Santa hat everywhere it shows. It follows the Spider theme's
model (`themedecor.ts` + `themedecorview.tsx`). The prototype board settles the palette and the app layout; the motion
spikes are `D:\src\arcterm\.superpowers\design\christmas-theme\spike\snow.html` and `spike\lights.html` (absolute:
`.superpowers/` is gitignored, so a run's worktree has no copy). Read them before drawing the snow or the lights.

Verify names `./pkg/memgate` only because `scripts/verify.mjs` needs one Go pattern: this plan changes no Go, so at a
merge it runs the vitest files the merge touches, and in the final stage vitest plus the frontend typecheck.

## Decisions beyond the spec (the builder's calls, made by the lead)

- **One gate model, `frontend/app/view/agents/christmas.ts`.** `CHRISTMAS_THEME = "christmas"`,
  `hasChristmasDecor(preset, effectsOff)` (the spec's `decorOn`), `christmasMotionOn(decorOn, reducedMotion)` (the
  spec's `motionOn`), and `giftCount(finished, done)` clamped to `GIFT_MAX = 6`. The two hooks every view uses,
  `useChristmasDecor()` and `useChristmasMotion()`, live in `christmasstore.ts` beside it (the latter reads
  `prefers-reduced-motion` with a `matchMedia` listener). Every task keys its static decor off `useChristmasDecor()`
  and its motion off `useChristmasMotion()`; nobody re-derives the preset check. Why: the spec's two gates, one source.
- **The switch is "Christmas effects"**, a toggle that is on by default, shown in Settings → Appearance → Theme under
  the preset grid only while Christmas is the preset: a plain control inside `ThemeChips` (`appearance.tsx`), not a
  `SettingRow`, so `settingsmodel.ts` and its one-row pin on the theme card stay as they are. Stored as `christmasEffectsOffAtom`
  (`atomWithStorage<boolean>("cockpit.theme.christmasEffectsOff", false)`) in `themestore.ts`, next to the preset.
  Picking a preset does not reset it. Why: the spec's "Turn off effects" reads as a negative on a toggle; a named
  on-switch says what it holds, and storing "off" keeps the default false.
- **The snow's opacity rule and stepping are pure in `christmassnow.ts`**, not in `christmas.ts`; the gift clamp is in
  `christmas.ts` and the Office's per-room count in `officeplanmodel.ts`. Why: each pure piece sits beside its one
  user, so the tasks that build them own separate files and run at the same time.
- **The snow has its own 12fps `setInterval`** in its canvas component, not a hook into `PulseDriver`: PulseDriver
  writes styles to DOM nodes, the snow paints a canvas. It runs only while `useChristmasMotion()` is true,
  `document.hidden` is false (a `visibilitychange` listener) and the window is neither in Float (`floatModeAtom`) nor
  folded into Sprout (`floatMiniAtom`); otherwise the interval is cleared and the canvas cleared. Flake count scales
  with the window area, capped at 120. Flakes over a visible `.term-connectelem` draw at half opacity.
- **The lights blink through a new `pulse-blink` entry in `PULSES`** (period ~1.2 s, low ~0.25), every other bulb
  lagged half a period with `data-pulse-lag`, so the string chases. Lit and still, the bulbs carry no PULSES class
  (zero frames). Asking, every bulb takes `bg-asking` and the class; under reduced motion PulseDriver already writes
  nothing, so the bulbs stay lit in `asking`. The asking signal is the Cockpit badge's own count: extract
  `useCockpitWaitingCount(model)` from `NavRail` (one hook both read) instead of recomputing it.
- **Decor colours are four tokens** in `frontend/tailwindsetup.css` beside `--color-spidey-*`: `--color-xmas-crimson`
  `#a0061b` (hats, ribbons, the wreath's bow, gift paper), `--color-xmas-bulb` `#d0283c` (a lit red bulb),
  `--color-xmas-pine` `#2f6b4a` (trees, the wreath) and `--color-xmas-snow` `#f2ead9` (flakes, the hat's trim, a cream
  bulb). The star and the gold bulb use the accent. No component writes a hex.
- **The Christmas theme chip** shows background, surface, the crimson (`var(--color-xmas-crimson)`) and the accent
  gold, as the Spider chip shows its decor red (`chipSwatches` in `themedecor.ts`).
- **ANSI and contrast:** `deriveAnsi` already derives the 16 colours from a palette, and its test already loops every
  preset; the preset sets `ansiBlue` (`#88b4dc`). The contrast-floor block in `themes.test.ts` (~line 80) loops only
  default, graphite and spider and checks only muted and inkFaint: Task 1 adds `christmas` to it and adds, for the
  Christmas preset, text, secondary, accent and the status colours on bg and on surface at 4.5:1. The test that pins
  `THEMES` at 9 presets (~line 135) goes to 10.
- **The hat is `PetOutfit` `"santa-hat"`.** `petOutfit(choice, now, christmas = false)` returns `"santa-hat"` first
  when `christmas` is true (flag days included), so a caller that does not pass it keeps today's behaviour. The hat is
  stamped over the plain pose grid (never `DRESSED`, `SPIDEY_DRESSED`, `MINION_DRESSED`) and, for the boss, over
  `PETER_BOSS_POSES` too, in every pose and facing; `back` holds no flag.
- **Office people get a hat through `PlanOutfit.hat?: boolean`**, part of `planSpriteUrl`'s cache key, stamped over
  every `PlanSprite` grid (sit, walk, doze, back, Spidey poses) at the head's top. `cockpitoffice.tsx` sets it where a
  sprite is drawn (each `planSpriteUrl` call: desks, seats, loungers, walkers from `walkersAtom`), not where an outfit
  is stored, so turning the effects off takes every hat off at once.
- **Where the pet's hat shows:** Sprout, the pet corner, Jarvis and the Office (pet and boss), in every pose including
  Spider-Man's web hang and crawl grids (`spriteOfRows` in `petview.tsx`). The fold button's sprite (`app-bar.tsx`
  `FOLD_SPRITE`) and the What's new sheet's pet stay hatless: they draw no outfit today. Recorded in the spec.
- **Every project room gets a tree spot while it can.** `buildPlan` adds `Room.xmas?: { tree: Point; gifts: number }`
  to each `agents` room, always computed (it is pure and cheap; only Christmas draws it): `tree` is the room's first
  plant, else a free spot the model finds that overlaps no desk, seat, table, door or chip; with none free, `xmas` is
  absent and that room draws no tree and no gifts. `gifts` is `giftCount(finished agents in the room, done tasks of the
  runs at its tables)`. Why: a busy room (desk row full, a run at its table) has no plant, and it is the room that
  earns gifts. The plants a room has are all drawn as trees; gifts lie beside `xmas.tree`.
- **`scenery(plan, phase, tired, christmas = false)`** draws trees for plants, the gift boxes (four on the floor, two
  stacked, at most six, the boxes taking a fixed footprint) and the wreath at the board's top centre.
  `sceneryKey(plan, phase, tired, theme, christmas = false)` adds `christmas` and, only when it is true, each room's
  `xmas`, so a finished agent redraws the canvases only under Christmas.
- **The scenario's Office run** is seeded through the office dev hook (`window.__cockpitOffice({ runs })`), with a run
  built by `floorsRun` from `scripts/cdp/cockpitofficescenarios.mjs` (exported for this), and cleared at teardown. The
  `christmas-office` cockpit fixture holds the agents only: one finished (idle inside the Finished window) and one
  asking.
- **The CDP scenario is `christmas-theme`**, one scenario with the steps the spec lists, against a new cockpit fixture
  `christmas-office` (a project room with agents, one finished, one asking, and a run with done tasks at a table). It
  restores the preset, the effects switch and the fixture at teardown.
- **CPU and RAM of the snow** are measured in the scenario (CDP `Performance.getMetrics` TaskDuration and
  `JSHeapUsedSize` over 10 s with snow on, then with effects off) and logged in `docs/open-issues.md` "RAM watch".

Workers: do not run `task dev` in your tree (the shared build junctions reach the user's running app). Run only your
task's focused tests and Check before completing; Verify and Final run on the merged result. Commit only the files your
task lists, with no attribution trailer.

### Task 1: Palette, gates, the effects switch and decor tokens
**Depends on:** none
**Files:** `frontend/app/view/agents/christmas.ts`, `frontend/app/view/agents/christmas.test.ts`, `frontend/app/view/agents/christmasstore.ts`, `frontend/app/view/agents/themes.ts`, `frontend/app/view/agents/themes.test.ts`, `frontend/app/view/agents/themestore.ts`, `frontend/app/view/agents/themedecor.ts`, `frontend/app/view/agents/themedecor.test.ts`, `frontend/app/view/agents/settingspages/appearance.tsx`, `frontend/tailwindsetup.css`

The interface every other task uses. Add the `christmas` `ThemeDef` ("Christmas") to `THEMES` with the spec's palette
table exactly (`ansiBlue` `#88b4dc`, no `claudeMark`), after Spider. Write `christmas.ts` (`CHRISTMAS_THEME`,
`hasChristmasDecor`, `christmasMotionOn`, `GIFT_MAX`, `giftCount`) and `christmasstore.ts` (`useChristmasDecor`,
`useChristmasMotion`), add `christmasEffectsOffAtom` to `themestore.ts`, the four `--color-xmas-*` tokens to
`tailwindsetup.css`, the Christmas branch of `chipSwatches`, and the "Christmas effects" toggle in `ThemeChips`
(`appearance.tsx`), a plain control under the preset grid shown only while the preset is Christmas, with `data-christmas-effects` on the toggle so the
scenario can find it.

Exported signatures the other tasks rely on (keep them exact):
`hasChristmasDecor(preset: string, effectsOff: boolean): boolean`,
`christmasMotionOn(decorOn: boolean, reducedMotion: boolean): boolean`,
`giftCount(finished: number, done: number): number`, `GIFT_MAX = 6`,
`useChristmasDecor(): boolean`, `useChristmasMotion(): boolean`.

Acceptance:
- `npx vitest run frontend/app/view/agents/christmas.test.ts`: decor only for `christmas` and only with effects on;
  motion false under reduced motion and whenever decor is off; `giftCount` 0 → 0, 3+2 → 5, 4+9 → 6, negatives → 0.
- `npx vitest run frontend/app/view/agents/themes.test.ts`: `christmas` is in the contrast-floor loop (muted,
  inkFaint), and new assertions hold text, secondary, accent, success, warning and error at 4.5:1 on its bg and
  surface; `deriveAnsi`'s loop covers it; the preset count is 10.
- `npx vitest run frontend/app/view/agents/themedecor.test.ts`: the Christmas chip shows the crimson token and the
  accent.
- The scenario steps that show it (written by Task 7): `christmas-theme` step "pick Christmas" (palette applied, chip
  pressed) and step "effects off" (toggle shown and switched).

### Task 2: Snow over the window
**Depends on:** Task 1 (uses `useChristmasMotion` and the `--color-xmas-snow` token)
**Files:** `frontend/app/view/agents/christmassnow.ts`, `frontend/app/view/agents/christmassnow.test.ts`, `frontend/app/view/agents/christmassnowview.tsx`, `frontend/app/cockpit/cockpit-root.tsx`

A pure `christmassnow.ts`: flake creation for a window size (count by area, capped at 120), one step of a flake at a
frame (fall and a slight drift, wrapping to the top), and `flakeAlpha(x, y, base, rects)` that halves `base` when the
point lies in any rectangle. `christmassnowview.tsx`: `SnowLayer`, one fixed full-window `<canvas>`
(`pointer-events-none`, `aria-hidden`, `data-christmas-snow`, above the content, below modals), sized with
`devicePixelRatio`, mounted next to `PulseDriver` in `cockpit-root.tsx`. Its 12fps interval runs only under the gates
in the plan's decisions; each frame reads the visible `.term-connectelem` rects (skip zero-size ones). Flakes are 1 to
2 px, faint (alpha ~0.35 to 0.6), in `--color-xmas-snow` read once from the computed style per theme change. It renders
nothing when decor is off.

Acceptance:
- `npx vitest run frontend/app/view/agents/christmassnow.test.ts`: `flakeAlpha` halves inside a rect, keeps `base`
  outside and on an empty list, treats a rect's edge as inside; the flake count scales with area and never passes 120;
  a step keeps a flake inside the window (wraps at the bottom).
- Scenario steps (Task 7): `christmas-theme` "snow falls" (the canvas exists, its interval paints: two reads of its
  pixels differ), "snow over a terminal is fainter" (the rule's test covers the numbers; the step shows a terminal
  with snow over it), "effects off" (no snow canvas) and "reduced motion" (canvas painted once or empty, no further
  frames).

### Task 3: Lights under the app bar
**Depends on:** Task 1 (uses `useChristmasDecor` and the `--color-xmas-*` tokens)
**Files:** `frontend/app/view/agents/christmaslights.tsx`, `frontend/app/cockpit/app-bar.tsx`, `frontend/app/element/pulse.ts`, `frontend/app/element/pulse.test.ts`, `frontend/app/view/agents/navrail.tsx`

`ChristmasLights`: a row of small round bulbs hanging from the app bar's bottom edge on a thin wire, repeating red
(`--color-xmas-bulb`), gold (accent), green (success) and cream (`--color-xmas-snow`), absolutely positioned so the app
bar's height and layout do not change, `aria-hidden`, `pointer-events-none`, `data-christmas-lights` on the row and
`data-asking` while asking. Mounted in `app-bar.tsx` only while `useChristmasDecor()` is true. Add `pulse-blink` to
`PULSES`. Extract `useCockpitWaitingCount(model)` from `NavRail` (same inputs, same count; NavRail then calls it) and
have the lights blink in `bg-asking` while it is above zero. Follow the lights spike for the bulb size and spacing.

Acceptance:
- `npx vitest run frontend/app/element/pulse.test.ts`: `pulse-blink` dips to its `low` mid-cycle and is back at 1 at
  the cycle's end; a half-period lag starts a bulb at the bottom.
- Scenario steps (Task 7): `christmas-theme` "lights lit and still" (no bulb carries a PULSES class, colours are the
  four) and "lights blink while an agent asks" (with the fixture's asking agent: `data-asking`, every bulb `bg-asking`
  with `pulse-blink`, and two reads of a bulb's opacity differ) and "reduced motion" (bulbs lit in `bg-asking`, their
  opacity unchanged across two reads). `FOLD_SPRITE` stays as it is.

### Task 4: The pet's Santa hat
**Depends on:** Task 1 (uses `useChristmasDecor`)
**Files:** `frontend/app/view/jarvis/petsprite.ts`, `frontend/app/view/jarvis/petsprite.test.ts`, `frontend/app/view/jarvis/petoutfit.ts`, `frontend/app/view/jarvis/petoutfit.test.ts`, `frontend/app/view/jarvis/petview.tsx`, `frontend/app/cockpit/sprout-mini.tsx`

Add `"santa-hat"` to `PetOutfit` and the hat's pixel art (red cap in `--color-xmas-crimson`, cream trim and bobble in
`--color-xmas-snow`, drooping to one side) for every pose and facing of the default pet, Spider-Man (Spidey poses and
`PETER_BOSS_POSES`) and the minion, stamped over the plain grid by `outfitRows` / `spriteFor` / `bossRows` /
`bossSprite`, and over Spider-Man's web hang and crawl grids that `petview.tsx` draws through `spriteOfRows`. Change
`petOutfit(choice, now, christmas = false)` per the plan's decisions. Pass `useChristmasDecor()`
from `petview.tsx` and `sprout-mini.tsx`. Do not touch `cockpitoffice.tsx` (Task 6 passes it there). The `t>` mark
and the no-terminal hero stay as they are.

Acceptance:
- `npx vitest run frontend/app/view/jarvis/petoutfit.test.ts`: christmas returns `"santa-hat"` for every choice and on
  a flag day; without it the old results hold.
- `npx vitest run frontend/app/view/jarvis/petsprite.test.ts`: every pose of every character in `"santa-hat"` has hat
  cells, all at or above the head's top rows, its body cells equal the plain pose's (never a dressed grid), and `back`
  is empty; the boss's facings too.
- Scenario steps (Task 7): `christmas-theme` "pet wears the hat" (the pet corner's sprite with hat cells; Jarvis'
  pet), "Sprout wears the hat" (folded into Sprout, its sprite has hat cells and the snow canvas paints nothing) and
  "effects off brings the outfit back".

### Task 5: Office trees, gifts and the wreath
**Depends on:** Task 1 (uses `giftCount` and the `--color-xmas-*` tokens)
**Files:** `frontend/app/view/agents/officeplanmodel.ts`, `frontend/app/view/agents/officeplanmodel.test.ts`, `frontend/app/view/office/scenery.ts`, `frontend/app/view/office/scenery.test.ts`, `frontend/app/view/office/officepalette.ts`, `frontend/app/view/office/officepalette.test.ts`

`Room.xmas` in `buildPlan` per the plan's decisions, and in `scenery.ts` the `christmas` parameter: a small pine tree
(tiers in `--color-xmas-pine`, lit dots in the bulb colours, a gold star, a pot or trunk) at every plant and at
`xmas.tree`, the gift boxes beside `xmas.tree` (crimson, gold and green paper with a cross ribbon; four on the floor,
two stacked; no more than six), and a red-and-green wreath at the notice board's top centre; register each prop with
`prop(...)` so depth sorting still works. Add the office roles the art needs to `officepalette.ts`, mapped to the
`--color-xmas-*` tokens. `sceneryKey` gains `christmas` per the decisions. Without `christmas` both functions behave as
today. Do not touch `cockpitoffice.tsx` (Task 6 wires it).

Acceptance:
- `npx vitest run frontend/app/view/agents/officeplanmodel.test.ts`: `xmas.gifts` counts the room's finished agents
  and its runs' done tasks, clamped at 6; `xmas.tree` is the first plant when there is one; a room with a full desk
  row and a table still gets a tree spot that overlaps no desk, seat, table, door or chip; a room with no free spot
  has no `xmas`.
- `npx vitest run frontend/app/view/office/scenery.test.ts`: under `christmas` a plant draws tree cells and no leaf
  cells, gifts draw `min(gifts, 6)` boxes in a footprint that does not grow past six, the board gets the wreath; with
  `christmas` false the ops equal today's; `sceneryKey` changes with a room's gifts only under `christmas`.
- `npx vitest run frontend/app/view/office/officepalette.test.ts`: the new roles resolve to the xmas tokens.
- Scenario step (Task 7): `christmas-theme` "office decorated" (trees, gifts and the wreath in the shot).

### Task 6: Office people's hat sprites
**Depends on:** Task 1 (uses the `--color-xmas-*` tokens)
**Files:** `frontend/app/view/office/plansprite.ts`, `frontend/app/view/office/plansprite.test.ts`

`PlanOutfit.hat?: boolean`: in `outfitGrid` / `planSpriteUrl` stamp a Santa hat over the head of every `PlanSprite`
(the hat in `--color-xmas-crimson` and `--color-xmas-snow`), the hat part of the sprite cache key. Without `hat` every
grid and URL is as today.

Acceptance:
- `npx vitest run frontend/app/view/office/plansprite.test.ts`: with `hat` every sprite's grid has hat cells on its top
  rows and the rest equal the hatless grid; `planSpriteUrl` caches the two separately.
- Scenario step (Task 8): `christmas-theme` "office decorated" (people in hats).

### Task 7: Office wiring
**Depends on:** Task 4 (uses `petOutfit`'s `christmas` argument for the boss), Task 5 (uses `scenery`'s and `sceneryKey`'s `christmas` parameters), Task 6 (uses `PlanOutfit.hat`)
**Files:** `frontend/app/view/agents/cockpitoffice.tsx`

In `cockpitoffice.tsx`, read `useChristmasDecor()` once and pass it to `sceneryKey` / `scenery`; set `hat` at each
`planSpriteUrl` call (desks, seats, loungers and the walkers from `walkersAtom`), not in the stored outfits, so a toggle
takes effect at once; pass it to `petOutfit` for the boss and the Office's pet so the hat replaces the Vietnam outfit
while it shows.

Acceptance:
- `task check:ts` passes.
- Scenario steps (Task 8): `christmas-theme` "office decorated" (trees, gifts, the wreath; people, walkers and the boss
  in hats) and "effects off brings the outfit back" (Office back to plants, no gifts, no hats).

### Task 8: Scenario, fixture, measurement and docs
**Depends on:** Task 2 (the snow canvas the scenario checks), Task 3 (the lights the scenario checks), Task 7 (the wired Office the scenario checks; Task 7 follows Tasks 4, 5 and 6)
**Files:** `scripts/cdp/scenarios.mjs`, `scripts/cdp/cockpitofficescenarios.mjs`, `scripts/cockpit-fixtures/scenarios.mjs`, `scripts/cockpit-fixtures/scenarios.test.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md`

Add the `christmas-theme` scenario with the steps the tasks above name, in this order: pick Christmas; snow falls;
snow over a terminal is fainter; lights lit and still; lights blink while an agent asks; office decorated; pet wears
the hat; Sprout wears the hat (fold and unfold with the existing Sprout scenario's helpers); reduced motion (emulate `prefers-reduced-motion` with CDP `Emulation.setEmulatedMedia`: snow stops, lights
lit in asking without blinking, static decor stays); effects off (snow and lights gone, palette kept); effects off
brings the outfit back. Each step asserts the DOM or pixels it names and takes a shot. Add the `christmas-office`
cockpit fixture (agents only: one finished, idle inside the Finished window, and one asking), and seed the Office run
with done tasks through `window.__cockpitOffice({ runs })`, building it with `floorsRun` (export it from
`cockpitofficescenarios.mjs`). Teardown restores `cockpit.theme.preset`, `cockpit.theme.christmasEffectsOff`, the
media emulation, the seeded run and the fixture (`--clear`). Measure the snow (plan decisions) inside the scenario and print the numbers; run the
scenario once with `node scripts/cdp/final-verify.mjs christmas-theme` and write the measured CPU and heap in
the table of `docs/open-issues.md` section "5 · (arcterm) RAM watch" (if it cannot run, write the entry as not yet measured and say why).
Add one `CHANGELOG.md` line under `Added` in the top section (`<!-- big -->`), and a `- [ ]` line in
`docs/hand-checks.md` titled "(arcterm) …" for the Christmas look in WebView2 (snow over a terminal, the lights' blink,
the hats at taskbar size).

Acceptance:
- `npx vitest run scripts/cockpit-fixtures/scenarios.test.mjs`, with a new case that runs `validateScenario` on the
  `christmas-office` fixture, passes.
- `node scripts/cdp/final-verify.mjs christmas-theme` passes every step listed above and writes its shots.

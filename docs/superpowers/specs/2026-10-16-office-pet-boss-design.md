# Office pet boss — design

**Date:** 2026-10-16
**Status:** built (run 0e916f02, 2026-10-16); hand check pending (open-issues.md section 0)
**Canvas:** `.superpowers/design/office-pet-boss/project/` (gitignored; `Main` the eight Peter poses, `Entrance` the six
frames of Spider-Man's entrance, `Floor` the boss pet on the floor beside Sprout and the Minion)
**Changes:** "The boss" and the out-of-scope line "The pet in the office: it keeps walking the footer" of
`2026-10-15-cockpit-office-design.md`. Everything else there still holds, and so does
`2026-10-16-office-floors-design.md`: this spec draws the boss, it does not move it.

## Problem

In the Office the footer creature is easy to miss: at rest it is drawn at 0.4 opacity
(`frontend/app/view/jarvis/petview.tsx:797`), 48 px tall, on the footer's top edge right under the busy pixel floor,
and in a probe of the `office` fixture it read as a red speck. Meanwhile the Office has its own character, the boss,
drawn as a capped chibi that has nothing to do with the pet the person picked. Two characters stand for the same
thing: the pet is Jarvis, the brain of the cockpit, and the boss is the person's presence in the office.

## Decision

**In the Office the pet is the boss.** The character the person walks with the arrow keys is drawn with the picked
pet's own sprites (Sprout, Minion or Spider-Man), and while the Office shows there is one Jarvis: the footer creature
gives way, and its bubble, marks and peek hang off the boss. Leaving the Office puts it back on the footer.

Spider-Man enters through a window: he web-swings in, pulls off the mask, and in a puff the suit becomes Peter
Parker the boss, in a buttoned shirt and a tie. In the Office he is always Peter. Sprout and the Minion arrive by the existing teleport (a beam drops
on the boss's spot).

## Drawing

- `BossView` (`frontend/app/view/agents/cockpitoffice.tsx`) draws an `<svg>` of `<rect>` cells from
  `spriteFor(pose, marks, outfit, character)` (`petsprite.ts`), as the footer does, in place of the chibi `<img>`. Its
  colours are theme tokens, so a change of theme or pet shows at once; it does not go through the sprite cache. Its
  place is still written on the DOM by `useDomTransform`, so a walk step renders nothing. The selection ring under its
  feet stays.
- The pet's cell is 5 px in the office (`BOSS_CELL_PX`, `officeboss.ts`), so its 16-cell grid is 80 px and the figure
  in it 65 to 70 px, as tall as a standing person (23 cells at the plan's 3 px, 69 px). At first it took the office's
  3 px cell, the same pixel but 40 px of figure, and it read as smaller than the workers (2026-10-16).
- At night and after hours the office's people are shaded by phase; the pet takes a `filter: brightness()` for the
  `after` phase (after work hours) so it does not glow in a dark room.
- The chibi boss poses (`BOSS_POSES`, `BOSS_OUTFIT` in `plansprite.ts`) go once nothing draws them.

## Poses

A pure `frontend/app/view/agents/officepet.ts` picks the pose, with `officepet.test.ts` beside it:

- **Walking:** `walk1` / `walk2` on `walkFrameAtom`, turned the way it walks (`PetFacing`, 2026-10-16): its front
  going down, its back going up, its side going left or right, drawn facing right and mirrored for left. The side and
  back are the boss's own grids (`BOSS_FACING` in `petsprite.ts`, two frames each, the second with the feet together);
  the footer's poses are the front. In the VN shirt a turned boss wears it without the star, which is on the front.
- **Standing:** `stand`, still turned the way it last went (frame 2 of that facing), so an arrow pressed with reduced
  motion on, where nothing walks, still turns it; a pastime, sleep, speech or tiredness faces the viewer.
- **Idle a few seconds:** a pastime from `REST_POSES`, its frames on `PASTIMES`' timing (`petwalk.ts`), in place. It
  never wanders off on its own: where the boss stands is the Cockpit's cursor.
- **No input for `SLEEP_AFTER_MS`:** `sleep`, with its z mark.
- **A key, a click, or a walk starting:** up at once.
- **Mood:** `expressionFor` / `postureFor` as on the footer: the `gate`, `escalation`, `blocked` and `unread` marks,
  and `tired` and `speak`.
- **Spider-Man:** no app-bar hang and no web-swing pastime in the Office; he walks, stands and rests as the others do.

**Peter the boss.** In the Office Spider-Man is drawn from `PETER_BOSS_POSES` (`petsprite.ts`), eight new grids
copied from the canvas's `Main` board: `stand`, `walk1`, `walk2`, `speak`, `tired`, `work1`, `work2` and `sit`. The suit
is hidden: a buttoned shirt (`v`), a tie down its middle in a new cell code drawn in a new token `--color-peter-tie`
(added beside the other Peter tokens in `tailwindsetup.css`; the runtime themes do not set them), jeans, and the hair
and glasses of the Peter rest poses. The front walk has the `stand` head, a foot lifted in turn; his side and back
are in `BOSS_FACING` with the rest (above). `PETER_BOSS_POSES` is a full `Record<PetPose, …>`: the
other poses (`sleep`, `read1/2`, `music1/2`, `ball1/2`, `dangle`) are the existing Peter grids with the open shirt
buttoned over the suit (the suit cells under it become shirt, the chest's spider the tie), the mapping the canvas
uses, so the boss never shows the suit after the entrance. The footer keeps `SPIDEY_POSES` and `SPIDEY_LOOK` as they
are. Peter the boss always wears the white shirt and tie: the pet's outfit setting (the VN shirt) is not put over it,
though the flag in hand still shows; Sprout and the Minion wear their outfit in the office as on the footer.

## Entrance

A pure `frontend/app/view/agents/officeentrance.ts`, with `officeentrance.test.ts`:

- **When:** each time the Office mounts, unless it was left less than **2 minutes** ago. Leaving is any unmount (Cards,
  another surface). The time is module state, not persisted, so the first Office after a launch always plays it.
- **Spider-Man:** six frames, as the canvas's `Entrance` board times them: swings in through the outer-wall window
  nearest the boss's spot (`SPIDEY_SWING`, 0–700 ms), lands (the suit's `sit`, to 1000), stands (to 1300), unmasks (a
  new `SPIDEY_UNMASK` grid, to 1800), a puff of smoke (a new `SPIDEY_PUFF` grid in the muted and primary greys, to
  2200), and stands as Peter the boss; about 2.2 s, then nothing runs. The window positions
  move out of `scenery.ts` (the loop at "the outer wall's windows") into a pure helper both use, so the art and the
  entrance agree. With office floors, the windows are the current floor's.
- **Sprout and the Minion:** the teleport's `arrive` (`petteleport.ts`) on the boss's spot.
- **Skipped:** any walk key, a click on the floor, or ↵ ends it at once with the boss in place; reduced motion never
  plays it. The bubble waits for it to end.

## One Jarvis

- `petstore.ts` gets `petOfficeBossAtom: HTMLElement | null`. `BossView` sets it through a ref callback and clears it
  on unmount.
- `PetView`: while it is set and the window is not folded, `PetSprite` is not drawn. The voice (events into the
  bubble, quotes) runs as before. `PetBubble` and `PetPeek` anchor to the boss element (both already use floating-ui's
  `autoUpdate`, so they follow it as it walks), and the corner is `cornerFor` of the boss's screen x.
- A click on the boss opens or closes the peek, as on the footer; the boss is never dragged, since where it stands is
  the cursor. ⌘J is unchanged.
- Leaving the Office clears the atom and the footer creature fades in as it does at boot. There is no exit scene: the
  Office unmounts at once.
- A fold from the Office plays no departure: `floatstore.ts` waits for the walking pet's departure only while
  `[data-pet-sprite]` is drawn (`walkingPetShown`), and in the Office it is not, so the window folds at once and the
  folded Sprout arrives as usual. Nothing in `floatstore.ts` changes.

## Cost

| Part | Cost |
|---|---|
| The boss svg | ~150–200 `<rect>`, as the footer's; the footer's is gone meanwhile, so about no net DOM nodes |
| Eight Peter grids and the entrance frames | strings of 16×16, under 10 KB in the bundle |
| The chibi boss images | no longer drawn, ~8 fewer entries in the sprite cache |
| Rendering | the svg re-renders on a frame change only: ~4/s walking, ~2/s in a pastime (the footer's walk is 8/s) |
| Entrance | 2–3 s, then no timer |

These are estimates. The plan measures them: the `cockpit-office` scenario on the `office-bench` roster before and
after, JS heap, DOM nodes and the Office JS line, into **RAM watch** in `docs/open-issues.md`. A miss is reported, not
tuned away by raising the budget.

## Files

| File | Change |
|---|---|
| `view/agents/officepet.ts` (+ test) | new: pose, facing and marks of the boss pet |
| `view/agents/officeentrance.ts` (+ test) | new: the entrance's phases, cooldown, skip and window |
| `view/office/scenery.ts` | the outer-wall windows from the shared helper |
| `view/agents/cockpitoffice.tsx` | `BossView` draws the pet svg and plays the entrance; sets `petOfficeBossAtom` |
| `view/jarvis/petsprite.ts` (+ test) | `PETER_BOSS_POSES`, the tie's cell code, `SPIDEY_UNMASK`, `SPIDEY_PUFF` |
| `frontend/tailwindsetup.css` | `--color-peter-tie` |
| `view/jarvis/petstore.ts` | `petOfficeBossAtom` |
| `view/jarvis/petview.tsx` | gives way to the boss; bubble and peek anchor to it |
| `view/office/plansprite.ts` | drop the chibi boss poses |
| `scripts/cdp/cockpitofficescenarios.mjs` | the steps under Verify |
| `CHANGELOG.md` | one `Added` line |

## Verify

- vitest: `officepet.test.ts`, `officeentrance.test.ts`, and `petsprite.test.ts` checking each new Peter grid is
  16×16, uses only known codes, and shows no suit code (`S`, `D`) in any `PETER_BOSS_POSES` grid.
- CDP, in `cockpit-office`: no `[data-pet-sprite]` on the footer and a pet svg as the boss; Spider-Man's entrance at
  each phase, held still by a DEV hook as `force({ swing })` holds the footer's swing; Peter walking and in a pastime;
  the bubble over the boss; leaving the Office puts the pet back on the footer; reopening within 2 minutes plays no
  entrance.

## Out of scope

- An exit scene.
- Top-down sprite sets for the pets.
- Spider-Man's app-bar hang or web-swing pastime inside the Office.
- The pet as photographer (part 3 of the cockpit office spec).

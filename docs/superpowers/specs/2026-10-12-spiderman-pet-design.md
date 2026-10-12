# Spider-Man pet and Spider theme — design

Date: 2026-10-12. Status: approved in brainstorming, not yet planned.

## Goal

A third Jarvis creature, **Spider-Man**: Peter Parker when idle, the suit when working, with spider-web versions of the
pet's motion (drag, fall, teleport, the working dots) and a pastime of its own, hanging upside down from the app bar.
Separately, a **Spider** theme preset (navy + red) that re-skins the whole app. The two are picked independently in
Settings → Appearance; neither switches the other.

Cost at runtime is unchanged: a pose is still one 16×16 grid drawn as at most 256 SVG rects, the theme is a one-time
`--color-*` override, and every web effect is drawn on the same cell grid as the existing teleport.

## 1. The character

Modelled on the Minion (commit `33fa01f16`, 21 files).

- `PetCharacter` becomes `"sprout" | "minion" | "spidey"` (`petsprite.ts`); `PET_CHARACTER_NAME.spidey = "Spider-Man"`
  (`petcharacter.ts`), so "Fold into Spider-Man" and the float bar name it for free; `petCharacter()` accepts it.
  Settings → Appearance → Jarvis → Character offers it (`settingspages/appearance.tsx`).
- One grid per pose in `petsprite.ts`, `SPIDEY_POSES` (all 16 `PetPose`s), each drawn in one of two looks:
  - the suit: red/blue, big white eyes, web seams on the mask, a small black spider on the chest;
  - Peter Parker: brown hair, glasses, green sweater, jeans.
  - `SPIDEY_LOOK: Record<PetPose, "suit" | "peter">` names the look, and a test holds each grid to it. Suit: `walk1/2`,
    `stand`, `speak`, `dangle`, `tired`, `work1/2`. Peter: `sit`, `sleep`, `read1/2`, `music1/2`, `ball1/2`.
  - Draft grids (rendered and checked against the marks' cells) are in the plan.
- New cell codes (`S D B e p H g v`) and tokens in `tailwindsetup.css`, beside `--color-minion-*`, fixed across themes (identity colours):
  `--color-spidey-red`, `--color-spidey-red-dark`, `--color-spidey-blue`, `--color-spidey-eye`, `--color-spidey-web`,
  `--color-peter-skin`, `--color-peter-hair`, `--color-peter-glasses`, `--color-peter-sweater`.
- The VN outfit: `dressSpideyInFlag` like `dressMinionInFlag` — Peter's sweater becomes the shirt with the star; a
  suit pose is left bare (a suit is a suit). The held flag reuses `FLAG_CELLS` for every pose.
- Every per-character branch gains `spidey`: `outfitRows`, and `app-bar.tsx`'s `FOLD_SPRITE` (Spider-Man's is the
  suit standing, not Peter sitting, so the fold button shows the hero); `task check:ts` finds any other.
- Original pixel fan art; no Marvel logo or asset.

## 2. Web effects (Spider-Man only)

Sprout and the Minion are untouched. A web strand is a run of 1-cell rects in `--color-spidey-web`, so it stays pixel
art.

1. **Dragged: hangs on a strand.** On press the sprite eases ~4 cells below the grab point (~120 ms) and a strand joins
   the cursor to its hands; the pose stays `dangle`. No rotation or scaling (sprout spec §3).
2. **Fall: rappels down.** `webLanding(offset)` in `petfall.ts`, same `Landing` shape as `landing`: a slower `easeOut`
   descent (~0.5 s) with one small bounce, and a strand from the release point to the head that goes on touchdown. A
   hop up (the ledge rose) stays as it is.
3. **Teleport: web-swing.** `petwebswing.ts` exports `webSwingFrame(kind, t)` (its own frame shape: the pet's offset
   and opacity, and the strand's cells), over the same `TELEPORT_MS`, so `teleportstore.ts` and the fold timing do not
   change. The pet is drawn in `dangle` while it swings. Depart: a
   strand shoots up and out, the pet is yanked along it and gone. Arrive: a strand drops, the pet swings in on an arc,
   lands stretched, squashes, settles. `petteleportsvg.tsx` picks the frame by character.
4. **Working dots → a web.** `WorkingDots` takes `character`; for Spider-Man the three dots become a 12 px web (4
   spokes, 3 rings) whose rings light in turn like the dots; the count stays beside it. Reduced motion: a still web.
5. **The `hang` pastime.**
   - The app bar carries `data-pet-ceiling`; `petledge.ts` gains `measureCeiling` (null when none is shown). Float and
     the folded window have no ceiling, so the pastime is never picked there.
   - `petwalk.ts`: rest poses depend on the character; Spider-Man adds `hang`, ~1 rest in 7. The rest has three timed
     phases, reported on `WalkerStep.hang`: **up** (~400 ms, shoot a strand to the ceiling and zip up), **hang**
     (4–8 s, `stand` turned upside down by `upsideDown(sprite)` — cells moved, not CSS — a strand from the feet to the
     ceiling; `dangle` while going up and coming down), **down** (the rappel of item 2).
   - It comes down at once when the cursor enters it (giving back the header it covers), when a posture or utterance
     arrives (so the bubble still opens from the bottom), or when a drag starts.
   - It ignores terminals and never touches the bubble, peek or Float.

## 3. The Spider theme

A ninth preset in `THEMES` (`themes.ts`), appended; Claude stays the default and `THEMES[0]`.

| Role | Draft |
|---|---|
| bg, surface, surfaceRaised, surfaceHover, surfaceSelected | `#0b1020`, `#0f1528`, `#151c33`, `#1a223c`, `#212b4a` |
| code | `#080c18` |
| border, edgeMid, edgeStrong, edgeFaint | `#1a2240`, `#222b4a`, `#2e3960`, `#131a30` |
| text, secondary, muted, inkFaint | `#e8ebf2`, `#c6cbd8`, `#8d94a8`, `#6b7390` |
| accent | `#e23636` |
| success, warning | `#4fc28f`, `#e8b04b` |
| error | `#ff6b9a` — pink, so an error does not read as the red accent |
| ansiBlue | `#4a8fe7` |

The values are drafts; `themes.test.ts`'s contrast floor (muted ≥ 4.5:1 on bg and surfaceHover, inkFaint ≥ 3:1, each
ANSI slot ≥ 3:1 on bg) decides the final ones. Sprout, drawn in the accent, turns red under this theme.

## 4. Verification

- vitest on the pure modules: poses are 16×16 and use only `PET_TOKENS` codes, `SPIDEY_LOOK` covers every pose,
  flipped grids stay 16×16, `petCharacter("spidey")`, `webLanding`, `webSwingFrame` over time, `hang`'s phases and
  each interrupt, `measureCeiling` with no ceiling, and the THEMES count going from 8 to 9.
- `task check:ts`.
- CDP: extend `jarvis-pet` after its step 14 (the Minion): pick Spider-Man in Settings with a real click and check its
  tokens; drag it and find the strand; force `hang` and check the sprite sits under `[data-pet-ceiling]` flipped; pick
  the Spider theme. Run against the running dev app (`task verify:ui -- jarvis-pet`), not a final-verify build.

## 5. Docs

- `CHANGELOG.md` → Added: the Spider-Man pet (web effects, hanging from the app bar); the Spider theme.
- `docs/guide/settings.md`: Spider-Man under Character, Spider in the Theme row.

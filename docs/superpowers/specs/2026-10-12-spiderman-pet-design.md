# Spider-Man pet and Spider theme — design

Date: 2026-10-12, revised the same day after the design canvas. Status: approved on the canvas, not yet planned.

**Prototype:** `.superpowers/design/spiderman-pet/project/` (gitignored; boards `Main`, `Walk`,
`Thwip`, `Effects`, `Fold`, `Theme`). Every pixel grid named below is drawn there; the plan carries them as data.

## Goal

A third Jarvis creature, **Spider-Man** in the Homecoming (2017) suit: slim, red and blue, a small black spider on the
chest, big white eyes framed in black. He is the suit at work and Peter Parker (shirt open on the suit) at rest; he walks
the footer side-on, now and then shoots a strand to the app bar, crawls along under it and hangs upside down; his drag,
fall, fold and working mark are made of web; folded, he sits on the edge of a brick rooftop. Separately, a **Spider**
theme preset (near-black + Spider-Man red) re-skins the whole app. The two are picked independently in Settings →
Appearance; neither switches the other.

Runtime cost is unchanged: a pose is still one grid of at most 400 cells drawn as SVG rects, the theme is a one-time
`--color-*` override, and every web effect is cells on the pet's own grid.

## 1. The character (`petsprite.ts`)

- `PetCharacter` becomes `"sprout" | "minion" | "spidey"`; `PET_CHARACTER_NAME.spidey = "Spider-Man"`
  (`petcharacter.ts`), offered in Settings → Appearance → Jarvis → Character.
- **The look.** Slim: a 7-cell torso, 1-cell arms, long legs. The head is solid red with one dark seam down the middle
  and the eyes white with a black frame at their outer corners (no web lattice: at 16×16 it broke the silhouette). The
  chest emblem is a 3×3 black X. Homecoming colours, theme-independent (identity, like the Minion's).
- **`SPIDEY_POSES: Record<PetPose, …>`**, one 16×16 grid per pose, each in one look (`SPIDEY_LOOK`):
  - suit: `stand`; `walk1`/`walk2` **side-on**, facing right (the renderer's existing mirror turns him left);
    `speak` = the **thwip**, side-on, crouched and leaning into the shot, the arm out at shoulder height with a bent
    elbow, the strand leaving the wrist, the back hand on the ground; `tired` (lids down, hands on knees); `dangle`
    (one hand up on the strand, at column 12); `work1`/`work2` (at the laptop); `sit` = the **hero landing**.
  - Peter: `sleep`, `read1`/`read2`, `music1`/`music2`, `ball1`/`ball2` — messy hair, glasses, a white shirt open on the
    suit, jeans.
  - Every grid keeps the marks' cells clear as Sprout's do and stands on its bottom row.
- **Grids outside `PetPose`** (Spider-Man only, exported beside `SPIDEY_POSES`):
  - `SPIDEY_HANG` — drawn upside down: boots wrapped on the strand at the top (column 8), thin legs bent out at the
    knees, both hands on the strand above the hips, the chest, the head at the bottom.
  - `SPIDEY_CRAWL` — two frames, drawn upside down, belly to the app bar's underside, side-on facing right.
  - `SPIDEY_SWING` — the web-swing's body, slung diagonally along the strand, hand up at column 10, knees tucked.
  - `SPIDEY_FOLD` — the 20×20 rooftop scene (§4), built by a function of the lit window count and the leg frame.
- **Cell codes**, each a token in `tailwindsetup.css` (identity, fixed across themes): `S` `--color-spidey-red`
  `#d0102a`, `B` `--color-spidey-blue` `#1f4aa8`, `D` `--color-spidey-seam` `#2a0a0d`, `e` `--color-spidey-eye`
  `#f4f6fb`, `x` `--color-spidey-web` `#c9ced8`, `p` `--color-peter-skin` `#f0c19b`, `H` `--color-peter-hair` `#4a2f1c`,
  `g` `--color-peter-glasses` `#3a3a40`, `v` `--color-peter-shirt` `#e4e7ee`; the rooftop: `c` `--color-city-cornice`
  `#6b6f78`, `C` `--color-city-cornice-shade` `#44474f`, `M` `--color-city-brick` `#4a2a26`, `N` `--color-city-brick-light`
  `#5e3631`, `Q` `--color-city-window` `#2a2d33`, `L` `--color-city-window-lit` `#f2c14e`. `k` stays the background (the
  eye frames, the emblem); `s` (shoes) and the pastime props reuse the existing codes.
- **The VN outfit.** The held flag works for every pose. The flag shirt recolours Peter's shirt (`v`) red, with no star
  (an open shirt has no three-row panel to hold one); a suit pose is left as it is. Not drawn on the rooftop.
- Every per-character branch gains `spidey` (`outfitRows`, `app-bar.tsx`'s `FOLD_SPRITE` — the suit standing, so the
  fold button shows the hero — and any other the typecheck finds).

## 2. Moving and the web (Spider-Man only; Sprout and the Minion are untouched)

A strand is a run of 1-cell rects in `--color-spidey-web`.

1. **Walking the footer**: side-on (`walk1`/`walk2`), mirrored when heading left, as today.
2. **Dragged**: on press he eases 4 cells under the pointer in `dangle` and a strand joins the pointer to his raised hand
   (column 12). No rotation or scaling.
3. **Let go**: `webLanding(offset)` in `petfall.ts` — a rappel, slower than a fall and braking (`easeOut`), the same
   one-cell bounce; the strand from the release point to the hand goes on touchdown. A hop up stays `landing`'s.
4. **Fold and unfold**: `petwebswing.ts` `webSwingFrame(kind, t)` — the strand and the `SPIDEY_SWING` body moved in
   whole cells, over the same `TELEPORT_MS`, so `teleportstore.ts` and the fold's timing do not change. Departing, a
   strand shoots up and out and he is yanked along it and fades; arriving, a strand drops and he swings in on a pendulum's
   arc and lands.
5. **The working mark**: `WorkingDots` takes `character`; for Spider-Man the three dots are a 12px web whose three rings
   light in turn (still under reduced motion). On the footer and Float; the fold uses its windows instead (§4).
6. **The app-bar pastime** (`petwalk.ts` rest `"hang"`, ~1 rest in 7, never tired, never under reduced motion, only when
   `[data-pet-ceiling]` — the app bar — is shown; `petledge.ts measureCeiling`): four timed phases on `WalkerStep.hang`:
   - `up` (~400 ms): a strand to the bar, up it in `dangle`;
   - `crawl` (~1.5–3 s): along the bar's underside in `SPIDEY_CRAWL`, a cell per frame, within the ledge's span;
   - `hang` (4–8 s): down the strand a few cells, `SPIDEY_HANG`, the strand from the bar to his boots;
   - `down` (~500 ms): the rappel of item 3, landing where the crawl left him.
   He comes down at once when the cursor enters him, a posture or utterance arrives (the bubble still opens from the
   bottom), or a drag starts. It ignores terminals and never touches the bubble, peek or Float.

## 3. The Spider theme (`themes.ts`)

A ninth preset, appended; Claude stays the default. Near-black, barely cool, with Spider-Man's red as the accent and a
pink error so a failure never reads as the accent; the terminal keeps a real blue. Measured against `themes.test.ts`'s
floor: muted 6.44:1 on bg and 5.38:1 hovered, ink-faint 3.95:1, the weakest ANSI slot 3.95:1.

| Role | Value |
|---|---|
| bg, surface, surfaceRaised, surfaceHover, surfaceSelected | `#0d0d0f`, `#131316`, `#1a1a1e`, `#202025`, `#27272d` |
| code | `#08080a` |
| border, edgeMid, edgeStrong, edgeFaint | `#1c1c21`, `#26262c`, `#34343c`, `#151518` |
| text, secondary, muted, inkFaint | `#ececef`, `#c8c8ce`, `#94949c`, `#707078` |
| accent, success, warning, error | `#e23636`, `#4fc28f`, `#e8b04b`, `#ff6b9a` |
| ansiBlue | `#4a8fe7` |

## 4. Folded (`sprout-mini.tsx`, `petmini.ts`)

For Spider-Man the folded pet is the rooftop scene, 20×20 cells = 60px, inside the existing 64px box
(`MINI_SPROUT_BOX` unchanged): he sits front-on on the edge of a brick rooftop, hands on the ledge, legs over the front,
four windows below. What the fold already shows maps onto it:

- **Working agents → lit windows**: the first `min(working, 4)` windows are lit, in place of the working dots.
- **Waiting on you → spider-sense**: when a posture waits (`gate`, `escalation`, `blocked`) or the waiting chip shows,
  amber (`--color-asking`) jags spark either side of and over his head, in place of the posture mark; the waiting chip
  stays, at the right.
- **Rest → swinging legs**: the bob's two frames swing his legs instead of lifting the sprite.
- **Unread** keeps its mark at its usual cells; **Jarvis thinking** (an errand streaming) shows the 12px working web
  beside his head.
- The hover list, Restore, the bubble and the drag are unchanged; folding in and out is the web-swing (§2.4).

## 5. Verification

- vitest on the pure modules: every grid's size and ground row, codes all in `PET_TOKENS`, `SPIDEY_LOOK` (suit grids
  carry `S` and no `H`, Peter's carry `H`), the marks' cells clear, the fold scene's lit windows for 0..6 working agents,
  `webLanding`, `webSwingFrame`, `strandCells`, the hang's four phases and each interrupt, the crawl staying on the
  ledge's span, `measureCeiling`, `petCharacter("spidey")`, the THEMES count 8 → 9.
- `task check:ts`.
- CDP: `jarvis-pet` gains steps — pick Spider-Man with a real click and check his tokens; drag him and find the strand;
  force the hang and check each phase (crawl under `[data-pet-ceiling]`, then upside down on a strand); fold and check the
  rooftop scene, its lit windows and spider-sense; pick the Spider theme. Run against the running dev app (`task verify:ui
  -- jarvis-pet`).

## 6. Docs

`CHANGELOG.md` → Added: the Spider-Man pet; the Spider theme. `docs/guide/settings.md`: Spider-Man under Character, Spider
in the Theme row. `docs/open-issues.md` "0 · Waiting on a hand check": one line for trying it in the running app.

# Pet stay put — plan

**Spec:** `D:\work\arcterm\docs\superpowers\specs\2026-11-02-pet-stay-put-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/wconfig`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs pet-stay jarvis-peek jarvis-pet float-mini`

The Jarvis pet can be told to stay at its home for 1 hour, 4 hours, or until turned off, from Settings → Jarvis and
from a pin button in the peek; and roaming becomes calmer for everyone. Frontend only: no Go, no wire types, no
`task generate`. Follow `DESIGN.md` for the new controls (tokens from `frontend/tailwindsetup.css`, no raw colors).

Every control that shows the stay reads it through `shownStayChoice(stay, Date.now())` (Task 1), never the raw atom:
the atom keeps an ended timed stay until the expiry timer clears it, and a control must already read Roam then.

### Task 1: The stay state and its store
**Depends on:** none
**Files:** `frontend/app/view/jarvis/petstay.ts`, `frontend/app/view/jarvis/petstay.test.ts`, `frontend/app/view/jarvis/petstore.ts`, `frontend/app/view/jarvis/petstore.test.ts`

A pure model plus its persisted atom, which every other task builds on. Interface (other tasks rely on these names):

- `petstay.ts` (pure, no atoms):
  - `export type PetStayChoice = "roam" | "1h" | "4h" | "forever"`
  - `export interface PetStay { choice: PetStayChoice; until: number | null }` — `until` is an absolute epoch ms for
    1h/4h, `null` for roam and forever. `export const PET_ROAM: PetStay`.
  - `stayFor(choice, now): PetStay` — 1h → `until = now + 3_600_000`, 4h → `now + 14_400_000`.
  - `parsePetStay(raw: string | null, now): PetStay` — a missing, malformed or already-expired value reads as roam.
  - `isStaying(stay, now): boolean` — false for roam and for a timed stay at or past `until`.
  - `shownStayChoice(stay, now): PetStayChoice` — the choice, or `"roam"` when `isStaying` is false.
  - `stayEndsInMs(stay, now): number | null` — ms until a timed stay ends (≥ 0), null otherwise (for the expiry timer).
  - `stayUntilLabel(stay): string | null` — `"until 15:30"` (local time, 24-hour `HH:MM`) for a timed stay, else null.
  - `PET_STAY_CHOICES: { id: PetStayChoice; label: string; menuLabel: string }[]`, in the Settings order Roam, 1h,
    4h, forever. Labels `Roam` / `Stay 1h` / `Stay 4h` / `Stay` (Settings) and `Roam again` / `Stay 1 hour` /
    `Stay 4 hours` / `Stay until I turn it off` (peek menu), one source of the words for both controls. The menu's
    own order (Roam last) is Task 4's.
- `petstore.ts`: `petStayAtom` (seeded at module load from localStorage key `wave:pet.stay` via `parsePetStay`, like
  `petHomeAtom`), `setPetStay(choice: PetStayChoice)` (writes the atom and localStorage; quota/disabled storage keeps
  the in-memory value, as `setPetHome` does), and `clearExpiredPetStay(now)` (sets roam when the stored stay has
  ended; a no-op otherwise).

Acceptance (vitest): `npx vitest run frontend/app/view/jarvis/petstay.test.ts frontend/app/view/jarvis/petstore.test.ts`
covers each `stayFor` choice, parse of garbage / expired / valid values, `isStaying` and `shownStayChoice` at, before
and after `until`, `stayEndsInMs`, the label's zero-padding (`until 09:05`), the store round-trip through
localStorage, and `clearExpiredPetStay` (clears an ended timed stay; leaves an active timed stay, forever and roam
as they are).

### Task 2: Walker stays home, calmer roam, the view wiring and two DEV levers
**Depends on:** Task 1 (reads `petStayAtom`, `isStaying`, `stayEndsInMs`, `clearExpiredPetStay`)
**Files:** `frontend/app/view/jarvis/petwalk.ts`, `frontend/app/view/jarvis/petwalk.test.ts`, `frontend/app/view/jarvis/petview.tsx`

Walker (`petwalk.ts`), per spec §1, §3 and §4:
- `WalkerInput` gains a required `staying: boolean` and a required `quick: boolean` (DEV pace, below).
- Staying: where it would call `pickTarget`, the target is `clearSpot(homeX(home), ledge, avoid)` instead
  (`initialWalker` included: at boot it stands at home rather than walking off). A rest or a walk anywhere but home,
  while home is clear, retargets home at once (not when the rest ends). Asleep, it goes home when it wakes (the
  existing `settle` path, targeting home). It still rests with pastimes, still sleeps after `SLEEP_AFTER_MS`, and
  still steps aside to the nearest clear spot when a toast or terminal covers it, then walks back once home is clear.
  A drop while staying lands it at the new home (the drop already persists home) and it stays there.
- Staying, a Spider-Man hang skips its crawl (`crawlMs` 0, so he comes down where he went up); roaming is unchanged.
- Calmer roam for everyone: `REST_MIN_MS = 60_000`, `REST_MAX_MS = 180_000` (still doubled when tired),
  `TARGET_MAX_PX = 200`. With `input.quick`, a rest draws from the old 5–15 s range instead
  (`QUICK_REST_MIN_MS = 5_000`, `QUICK_REST_MAX_MS = 15_000`), and `restIn`'s forced rest lasts the quick maximum.
- Reduced motion is unchanged (already placed at home).

View (`petview.tsx`):
- `measure()` passes `staying: isStaying(globalStore.get(petStayAtom), Date.now())` and `quick: forceRef.current?.quick ?? false`.
- Subscribe to `petStayAtom` in the sprite and `run()` when it changes, so turning a stay on walks it home at once
  and turning it off lets it roam.
- Expiry lives in the always-mounted `PetView` (not `PetSprite`, which is not mounted in the Cockpit office): while a
  timed stay is set, a `setTimeout` for `stayEndsInMs` calls `clearExpiredPetStay`; cleared on change and unmount.
  The sprite's atom subscription then steps the walker. A stay already expired at boot is handled by Task 1's parse.
- Two DEV force options on the existing `PetForce` contract (`force(...)` in `petview.tsx`, DEV only):
  `at?: number` places the walker at that left edge (clamped to the ledge) as a fresh rest, so a step can put the pet
  away from home; `quick?: boolean` sets `WalkerInput.quick`, so scenarios see a walk or a rest within seconds.

Acceptance (vitest, new cases in `petwalk.test.ts`, run with
`npx vitest run frontend/app/view/jarvis/petwalk.test.ts`): staying, a rest ending never walks anywhere but home;
staying while resting away from a clear home starts a walk home on the very next step; a toast/avoid span over home
moves it to the nearest clear spot, and removing the span walks it home; asleep away from home, waking walks it home;
`initialWalker` with staying stands at home; staying, a drag then a drop with a new home lands it at the new home and
later steps never walk it off; a staying hang has no crawl phase and comes down at `x0`; roaming rests last 60–180 s
and walks 80–200 px, and `quick` rests last 5–15 s. Existing cases updated to the new constants (or `quick`). The
view's wiring and the `at` lever are shown by the `pet-stay` scenario's "walks home" step (Task 5).

### Task 3: Settings → Jarvis "Pet roams" row
**Depends on:** Task 1 (uses `petStayAtom`, `setPetStay`, `PET_STAY_CHOICES`, `shownStayChoice`, `stayUntilLabel`)
**Files:** `frontend/app/view/agents/settingspages/jarvis.tsx`, `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `frontend/app/view/agents/settingssurface.tsx`

- Declare the row in `settingsmodel.ts` beside `appearance.petoutfit`, with the same fields: `id: "appearance.petstay"`,
  `title: "Pet roams"`, `desc: "Keep Jarvis at its spot for a while, or until you let it roam again."`,
  `key: "wave:pet.stay"`, `scope: "local"`, in the `jarvis/jarvis` card after the outfit row.
- `settingspages/jarvis.tsx`: a `PetStayRow` with a `Segmented<PetStayChoice>` (like `PetOutfitRow`) over Roam /
  Stay 1h / Stay 4h / Stay, its value `shownStayChoice(stay, Date.now())`; for a timed stay the row shows
  `stayUntilLabel` (muted, beside the control). The row root carries `data-pet-stay-row`.
- `settingssurface.tsx`: the row's revert — changed when `shownStayChoice` is not roam, revert sets roam.

Acceptance: `npx vitest run frontend/app/view/agents/settingsmodel.test.ts` (the `jarvis/jarvis` card lists
`appearance.petstay` after `appearance.petoutfit`); rendered and driven by the `pet-stay` scenario's "settings row"
step (Task 5).

### Task 4: Pin button and menu in the peek
**Depends on:** Task 1 (uses `petStayAtom`, `setPetStay`, `PET_STAY_CHOICES`, `shownStayChoice`, `stayUntilLabel`)
**Files:** `frontend/app/view/jarvis/petpeek.tsx`

- In the peek header (`data-pet-peek-header`), a pin icon button (lucide `Pin`, 28 px like the close button,
  `aria-label="Pet stays put"`, `data-pet-stay-pin`, `aria-haspopup="menu"`) placed before Full view, and before
  Terminal in folded Sprout's peek (the `onRestore` branch). It is lit (accent text, as the app's other active icon
  toggles) while `shownStayChoice` is not roam, with `data-staying` set then.
- Clicking it opens a small menu (`role="menu"`, `data-pet-stay-menu`) using the app's existing popover/menu pattern,
  with four `menuitemradio` rows in this order: Stay 1 hour, Stay 4 hours, Stay until I turn it off, Roam again
  (`menuLabel`s from `PET_STAY_CHOICES`), the shown choice checked (`aria-checked`). A timed choice shows
  `stayUntilLabel` muted on its row. Picking one calls `setPetStay` and closes the menu; Escape and an outside click
  close it without closing the peek (mind `petPeekOpenAtom`'s Escape guard).
- Folded Sprout: the folded window's click-through poll (`miniclickthrough.ts`) drops clicks outside
  `[data-mini-hit]`, so the menu renders inside the peek's `data-mini-hit="chat"` panel or carries `data-mini-hit`
  itself.

Acceptance: `task check:ts` clean; shown and driven by the `pet-stay` scenario's "pin menu" and "stay chosen" steps
and the `float-mini` scenario's folded-peek pin step (Task 5).

### Task 5: Scenarios and the changelog line
**Depends on:** Task 2 (uses the `at` and `quick` DEV force options it adds)
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

- New scenario `pet-stay` in `scripts/cdp/scenarios.mjs`, modelled on `jarvis-peek` / `jarvis-pet` (arrange saves
  `wave:pet.stay` and `wave:pet.home`, teardown restores both, lifts any force and leaves the pet roaming). Steps,
  each with a shot and an assert:
  1. "walks home": while roaming, `force({ ...PET_CALM, at: <a clear x at least 120 px from home> })`, then choose
     Stay (forever) through the peek's pin menu and close the peek; assert the sprite's left edge reaches home within
     20 s and stays there for 5 s with `quick` forced.
  2. "pin menu": open the peek, click `[data-pet-stay-pin]`; `[data-pet-stay-menu]` shows four items in the order
     Stay 1 hour, Stay 4 hours, Stay until I turn it off, Roam again, with Stay until I turn it off checked.
  3. "stay chosen": pick Stay 1 hour; the menu closes, the pin has `data-staying`, `localStorage['wave:pet.stay']`
     holds choice `1h` with an `until` about an hour ahead; reopening the menu shows Stay 1 hour checked and an
     "until HH:MM" label.
  4. "settings row": open Settings → Jarvis; `[data-pet-stay-row]` shows Stay 1h selected and "until HH:MM"; choose
     Roam; the row reads Roam and the peek's pin has no `data-staying`.
- `jarvis-peek` step 2: the first Tab now lands on the pin (`Pet stays put`), the second on `Open full Jarvis view`;
  update the step's assert and its label.
- `jarvis-pet`: roaming rests now last 1–3 minutes, so every wait on a walk or a rest (the 40–60 s waits, the
  `PET_CALM` forces) runs with `quick: true` forced (add it to `PET_CALM` or to each force), keeping the existing
  timeouts.
- `float-mini`: after step 3 opens the folded peek's chat, a step asserts `[data-pet-stay-pin]` sits before
  `[data-mini-restore]` in the header, clicks it, and asserts `[data-pet-stay-menu]` is visible and inside a
  `[data-mini-hit]` element; Escape closes it (shot).
- `CHANGELOG.md`: one line under `Added` in the top `Unreleased` section (open one if the top section has a date):
  Jarvis can stay put — pin it from its panel or Settings → Jarvis for an hour, four hours or until you let it roam,
  and it now roams at a calmer pace. Not `<!-- big -->`.

Acceptance: `node scripts/cdp/final-verify.mjs pet-stay jarvis-peek jarvis-pet float-mini` passes (this is the
plan's Final).

# Pet stay put — fix round 1

**Spec:** `D:\work\arcterm\docs\superpowers\specs\2026-11-02-pet-stay-put-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/wconfig`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs pet-stay jarvis-peek jarvis-pet float-mini`

Two defects from the run's Final (round 1), both in what this run changed. Frontend and scenario only. Out of scope,
because they fail on the base or need the human: `jarvis-peek` step 6 (busy vs quiet width), `jarvis-pet` step 8
(avoid span covers the right half), and `float-mini` steps 2–5 (the Final's dev window never shrinks on Float). Don't
touch those.

### Task 1: The quiet peek's title fits beside the stay pin

**Depends on:** none

**Files:** `frontend/app/view/jarvis/petpeek.tsx`, `scripts/cdp/scenarios.mjs`

In `scenarios.mjs`, touch the `pet-stay` scenario only.

Defect: since the pin joined the header, the quiet card (`max-w-[300px]`, `petpeek.tsx` ~line 1216) truncates its
title to "Nothing waiting o…" (Final shots `jarvis-peek-empty.png`, `pet-stay-2-menu.png`). The quiet card states
queue absence in its title, so the title must read whole.

Decision: widen the quiet card's max width by what the pin and its gap take, so header order and controls stay as
specified (title, pin, Full view, close). Don't shrink the title text, drop Full view or move the pin. Keep the busy
(420) and item (560) widths unchanged. Folded Sprout's peek has its own width: check its header there too and fix it
the same way if its title is cut.

Acceptance:
- In the docked quiet peek, "Nothing waiting on you" shows in full beside the pin, Full view and close
  (the title element's `scrollWidth <= clientWidth`).
- A new `pet-stay` step (number it after the existing ones), with a shot, opens the quiet peek and asserts the title
  is not clipped and reads "Nothing waiting on you". Existing `pet-stay` steps still pass.
- `jarvis-peek` step 4 (narrow panel bounded, no horizontal overflow) still passes at 440 px wide.

### Task 2: jarvis-peek's arrange waits for the pet store instead of a fixed 2.5 s

**Depends on:** Task 1

**Files:** `scripts/cdp/scenarios.mjs`

Touch the `jarvis-peek` scenario only.

Defect: in the Final, `jarvis-peek` step 3 failed only on `ctx.reset === true`. Its arrange reloads, sleeps a fixed
2.5 s, then calls `globalThis.__wavePetStore.resetPeek()`, which returned false because the store was not there yet.
It now runs right after `pet-stay`, whose teardown also reloads. `petstore.ts`'s DEV `__wavePetStore` is unchanged
by this run, so this is the arrange racing the boot.

Decision: replace the fixed sleep with a bounded poll (up to ~15 s, the helpers already in `scenarios.mjs` such as
`polishWaitFor`) for `typeof globalThis.__wavePetStore?.resetPeek === 'function'`, then reset as before. If the poll
times out, `reset` stays false and step 3 fails as now. Confirm the cause before fixing: if the store is present and
`reset` is still false, report what you found instead.

Acceptance:
- `jarvis-peek` step 3 passes when run after `pet-stay` (`task verify:ui -- pet-stay jarvis-peek` on a dev app, or
  the Final).
- No other `jarvis-peek` step changes its assertions.

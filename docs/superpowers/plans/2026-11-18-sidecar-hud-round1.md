# Sidecar HUD: round 1 fixes

**Spec:** `docs/superpowers/specs/2026-11-18-sidecar-hud-design.md`
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs sidecar-orbit sidecar-compact`

Two defects the run's tasks found and left, both in files this run changed. Every rule of the run's plan
(`docs/superpowers/plans/2026-11-18-sidecar-hud.md`, "Rules") still holds: the `DASH_READ` structures, no filter,
colours from tokens only, decoration memoized. Each fix adds a scenario step that would have caught it.

### Task 1: The Resources column fills after the page opens or reloads
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/tauri/sidecar.tsx`, `scripts/cdp/scenarios-sidecar.mjs`

At wall width (1920×1080) the Resources column stays on "Measuring…" after the page opens or reloads; the panel opened
later at 1400 wide fills (Task 5's step 30 records `columnBefore: {"state":"measuring","glow":0}`). Cause, from the
source: `useResourcesPanel` (`frontend/tauri/sidecar.tsx`) sends `{kind: "resources", open: true}` from an effect when
the page mounts with the column showing, which can reach the bridge before the page's hello; the bridge's `hello()`
(`frontend/app/cockpit/sidecarbridge.tsx`, "a reloaded page starts with its resource panel shut") then calls
`stopResources()`, and the page re-sends only when `want` flips or its pids change. Confirm the order first (a
`console` read over CDP, not a committed log).

Fix it on the page side, leaving the bridge's hello rule as it is: the page asks for resources only once it has heard
its first snapshot after its hello (for example, `want` also needs a snapshot heard, so the effect runs, and sends the
open act, after the hello is answered). Keep the pid refresh, the close act on unmount and the panel's show-at-once
"measuring" state.

Acceptance:
- A new step in `sidecar-orbit`, before step 30 shrinks the page, at 1920×1080: "the Resources column fills at wall
  width": within 15 s of the page loading (reload the page in the step, so it covers the reload case), the column
  (`[data-sidecar-resources="column"]`) leaves "Measuring…" and draws a
  `[data-hud-glow]` line. On a platform other than win32 it skips the glow wait like step 30.
- Step 30's `columnBefore` now reads `ready`.
- Every existing step in both scenarios still passes.

### Task 2: A heavy agent's label above its node clears the dot
**Depends on:** Task 1 (both add a step to `scripts/cdp/scenarios-sidecar.mjs`)
**Model:** sonnet
**Files:** `frontend/app/cockpit/sidecarorbit.tsx`, `scripts/cdp/scenarios-sidecar.mjs`

On the orbit, a node at the top draws its label at a fixed `top: -51` above the dot (`labelStyle` in `Node`,
`sidecarorbit.tsx`), sized for two lines; a heavy agent's label has a third line (`data-sidecar-node-heavy`, about
67 px tall), so the dot covers it (the `band-red` shot: quill, "1.9 GB (o) test ./…"). Anchor a label above its node
by its bottom edge (a fixed gap above the dot, growing upward), so any number of lines clears the dot. Labels below
and beside a node stay as they are.

Acceptance:
- A new step in `sidecar-orbit` at the `band-red` state: "a node's label never covers its dot": for every
  `[data-sidecar-node]`, its label's rect does not intersect the dot's rect, the heavy top node included.
- The `band-red` shot shows quill's three lines above its dot.
- Every existing step in both scenarios still passes.

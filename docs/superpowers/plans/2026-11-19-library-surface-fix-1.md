# Library surface: final-stage fix, round 1

**Spec:** `docs/superpowers/specs/2026-11-19-library-surface-design.md`
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke library-tabs canvas-gallery jarvis-brief-later`

The final Verify failed on one vitest case, which is already failing on `main` and is outside the Library goal:
`frontend/tauri/browsershim/browsershim.test.ts` › "answers every Tauri command the frontend invokes" reports
`core.ts answers no sidecar_corner`. Commit 74668cfe4 (on `main`) made `frontend/tauri/sidecar.tsx:311` invoke the new
host command `sidecar_corner` (`src-tauri/src/sidecar.rs:1115`, returns `Option<f64>`) without adding it to the browser
stand-in. It still holds the land, so it is fixed here.

### Task 1: the browser stand-in answers `sidecar_corner`

**Depends on:** none
**Files:** `frontend/tauri/browsershim/core.ts`, `frontend/tauri/browsershim/browsershim.test.ts`

Decision: the stand-in answers `null`, not an error. The host's own answer when it cannot read the radius is `None`
(`null`), and `sidecar.tsx` then keeps its 12px default; a page has no native window, so "cannot read it" is the
truthful answer, and it keeps the Sidecar page's console free of a logged failure. (Only reached when
`NATIVE_MAC_FRAME` is set, so the browser app on a Mac.)

- Add `"sidecar_corner"` to `BROWSER_COMMANDS` in `core.ts`, beside `sidecar_form` and `sidecar_pids`, and a
  `case "sidecar_corner": return null as T;` with a one-line comment saying why (no native window to read a corner
  from; the Sidecar page keeps its default radius).
- In `browsershim.test.ts`'s "core stand-in" describe, assert `await invoke("sidecar_corner")` resolves to `null`.

Acceptance: `npx vitest run frontend/tauri/browsershim/browsershim.test.ts` passes, including "answers every Tauri
command the frontend invokes". No UI changes, so no scenario step; the Final line reruns the plan's scenarios on the
merged result.

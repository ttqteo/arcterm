# Fix round 1: the browser shim answers Sidecar's corner command

**Spec:** `docs/superpowers/specs/2026-11-19-bug-report-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/bugreport ./pkg/jarvis ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs bug-report-box bug-report-jarvis surface-smoke`
**Prototype:** D:\work\arcterm\.superpowers\design\bug-report\project\B-footer.dc.html

The final stage's Verify failed on one vitest case that is already failing on the base, not in the bug-report work:
`frontend/tauri/browsershim/browsershim.test.ts` > "answers every Tauri command the frontend invokes" reports
`core.ts answers no sidecar_corner`. Base commit 74668cfe4 added `invoke("sidecar_corner")` to
`frontend/tauri/sidecar.tsx` (and the Rust command) but gave the browser shim no answer for it. Any failing step holds
the land, so this round fixes it.

### Task 1: The browser shim refuses `sidecar_corner` like Sidecar's other window commands
**Depends on:** none
**Files:** `frontend/tauri/browsershim/core.ts`, `frontend/tauri/browsershim/browsershim.test.ts`

In `frontend/tauri/browsershim/core.ts`, add `"sidecar_corner"` to `BROWSER_COMMANDS` next to `open_sidecar`,
`sidecar_form` and `sidecar_pids`, and give it a `case` in `invoke` that throws `"Sidecar is a window of the Tauri
host"`, the same refusal `open_sidecar` and `sidecar_form` give, with a one-line comment: the page has no native Mac
window whose corner radius could be read, and `sidecar.tsx` keeps its 12px frame when the call fails.

Decision (lead's, autonomous run): refuse rather than answer `null`. Both leave the 12px frame; refusing keeps the
shim's one rule for Sidecar's window commands (a page has no second window), which the existing test already states.

In `browsershim.test.ts`, extend the case "refuses the Sidecar window's commands: a page has no second window to open,
shrink or pin" with `await expect(invoke("sidecar_corner")).rejects.toThrow(/Tauri host/);`.

Acceptance: `npx vitest run frontend/tauri/browsershim/browsershim.test.ts` passes, both "answers every Tauri command
the frontend invokes" and the Sidecar refusal case. No rendered view changes, so no scenario step is added; the
plan's Final still runs `bug-report-box`, `bug-report-jarvis` and `surface-smoke`.

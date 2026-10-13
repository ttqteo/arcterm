# Usage insights levers — fix round 1

Final's Verify failed on `frontend/tauri/browsershim/browsershim.test.ts` > "answers every Tauri command the frontend
invokes": `core.ts answers no raise_topmost`. The cause predates this run: main's `ba6dba32b` (fix(fold)) added
`invoke<string>("raise_topmost")` in `frontend/app/view/agents/floatstore.ts:559` and the Tauri command
(`src-tauri/src/foreground.rs`), but not the browser stand-in. The same test's first case timed out at 5000ms in the
full vitest run and passed when rerun alone (118ms): load, not a defect, and out of scope here.

### Task 1: The browser shim answers `raise_topmost`

**Depends on:** none

**Files:** `frontend/tauri/browsershim/core.ts`

The browser app has no native window to lift, so `raise_topmost` is a no-op there, like `set_folded_chrome` and
`hold_window_frame`.

- [ ] **Step 1:** Run `npx vitest run frontend/tauri/browsershim/browsershim.test.ts` and see "answers every Tauri
  command the frontend invokes" fail on `raise_topmost`.
- [ ] **Step 2:** In `frontend/tauri/browsershim/core.ts`, add `"raise_topmost"` to the `NO_OPS` list (line 12). The
  caller (`floatstore.ts:559`) only logs the result, so returning `undefined` is enough. Change no other file.
- [ ] **Step 3:** Run the same vitest file again; all its cases pass. Run `npx prettier --check
  frontend/tauri/browsershim/core.ts`.
- [ ] **Step 4:** Commit with `git commit -m "fix(browsershim): answer raise_topmost as a no-op" -- frontend/tauri/browsershim/core.ts`.
  No CHANGELOG line: the browser app is a test harness, not something a user sees.

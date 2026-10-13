# Terminals and tools: final-stage fix, round 1

The final stage's Verify failed in `frontend/tauri/browsershim/browsershim.test.ts`, on a failure that predates this
run: commit `ba6dba32b` (on the run's base) added `invoke<string>("raise_topmost")` in
`frontend/app/view/agents/floatstore.ts:559`, and the browser stand-in for `@tauri-apps/api/core` does not answer it, so
"answers every Tauri command the frontend invokes" fails (`core.ts answers no raise_topmost`). In the full suite the
same file's first test, "shims every Tauri module the frontend imports", also timed out at vitest's 5 s default; alone
it takes ~110 ms.

### Task 1: The browser stand-in answers raise_topmost

**Depends on:** none

**Files:** `frontend/tauri/browsershim/core.ts`, `frontend/tauri/browsershim/browsershim.test.ts`

**Step 1:** In `core.ts`, add `"raise_topmost"` to `NO_OPS` (a browser page has no window to lift above another app;
`floatstore.ts` only logs the answer, so `undefined` is fine). Nothing else in `core.ts` changes.

**Step 2:** In `browsershim.test.ts`, give "shims every Tauri module the frontend imports, and exports every name it
takes" a timeout of 30000 ms (vitest's third `it` argument): it dynamically imports every stand-in module and walks the
frontend's sources, which ran past 5 s under the full suite's load. Do not change what it asserts.

**Step 3: Check.** `npx vitest run frontend/tauri/browsershim/browsershim.test.ts` passes (all 9 tests), and the
typecheck (`node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`) exits 0.

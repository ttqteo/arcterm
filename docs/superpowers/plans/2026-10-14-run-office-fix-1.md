# Run office fix round 1

**Spec:** `docs/superpowers/specs/2026-10-14-run-office-design.md` (its Benchmark section changed in 209d0b0b6: the busy
budgets now subtract an office-off baseline)

**Goal:** bring `jarvis-office-bench` inside the spec's budgets. Final round 1 measured (another run's Final shared the
machine, so the busy and ms numbers are inflated):
`{"desks":104,"heapOpenMB":2.84,"nodesAdded":1484,"busyPct":12.6,"busyReducedPct":7.8,"cache":79,"heapAfterOffMB":1.99,"openMs":429,"clockReduced":false,"clockOff":false}`.
Four steps failed: 3 (busy 12.6 % > 2 %), 4 (busy under reduced motion 7.8 % > 0.5 %), 6 (heap after off 1.99 MB >
1 MB) and 7 (first open 429 ms > 150 ms). The frame clock does stop (the probe read `clock: false` under reduced
motion and after off), so step 4's 7.8 % is the Jarvis page's own work, which the bench had no baseline for.

Rules: never raise a budget (the spec: a miss is reported, not tuned away); never run prettier on `scripts/*.mjs`;
colours stay `--color-*` tokens; no jsdom tests.

### Task 1: Hold the office bench inside its budgets

**Files:** `scripts/cdp/officescenarios.mjs`, `frontend/app/view/jarvis/officesprites.ts`, `frontend/app/view/jarvis/officeview.tsx`, `docs/open-issues.md`

- Modify: `scripts/cdp/officescenarios.mjs` (`jarvisOfficeBench`)
- Modify: `frontend/app/view/jarvis/officesprites.ts`, `frontend/app/view/jarvis/officeview.tsx` (only as the
  measurements below need)
- Modify: `docs/open-issues.md` (the "RAM watch" Run office line: the new numbers)

**Step 1: the baseline.** In `jarvisOfficeBench.assert`, after the fixture is handed over with the office off and
`closed` is read, hold 30 s and read again: `baseBusyPct` = that TaskDuration delta / 30 s. Report `busyPct` and
`busyReducedPct` as the hold's busy minus `baseBusyPct` (keep the raw values in the printed bench line too, as
`busyRawPct`, `busyReducedRawPct` and `baseBusyPct`). Steps 3 and 4 keep their budgets (2 % and 0.5 %) and their
names say "over the office-off baseline".

**Step 2: first open ≤ 150 ms.** Profile the toggle click to floors drawn (the bench's `openMs`) in the dev app over
CDP (`Profiler` or `Performance` timeline), and name what takes the time in the report (sprite rasterising with
`toDataURL`, React rendering ~1,500 nodes, image decode). Cut it: for example rasterise the sprites off the click path
(build the cache when the Brief mounts with the office off, in `requestIdleCallback` chunks, or draw sprites with one
shared canvas/`createImageBitmap`), or render the floors past the first screen after the first frame. The measure
stays the spec's: click to every desk in the DOM.

**Step 3: heap after off ≤ 1 MB over closed.** Find what stays after the office turns off (a heap snapshot diff over
CDP, `HeapProfiler`), and name it in the report. The sprite cache is allowed to stay (the spec bounds it at 320 and
says an entry never goes stale), so a cache of ~79 data URLs is expected. Free anything else the office holds once it
is off (detached floors, listeners, the fixture's derived floors kept by a component, image decode buffers).

**Step 4: busy while on ≤ 2 % over the baseline.** If the hold still costs more than 2 % after Steps 1–3, profile a
few seconds of it and cut the per-frame work (only the animated desks should re-render on a tick; nothing else should
run while the office is on).

**Step 5: measure.** Run `ARC_FINAL_OUT=<tmp dir> node scripts/cdp/final-verify.mjs jarvis-office jarvis-office-bench`
once, on a quiet machine (check that no other dev app or Final is running first: `Get-Process wave-tauri`), and put the
printed bench line in the report. Acceptance: `jarvis-office` steps 0–10 and `jarvis-office-bench` steps 0–7 all pass.
Run the touched vitest files (`npx vitest run frontend/app/view/jarvis/office`) and the typecheck
(`node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`).

**Step 6: record.** Replace the Run office line under "RAM watch" in `docs/open-issues.md` with the new numbers,
dated 2026-10-14, raw and baseline busy both shown. If a budget is still missed after real effort, say so on that line
and in the report's Found not fixed, with what the profile shows; do not raise the budget.

**Step 7: commit.** `git commit -m "perf(jarvis): run office within its bench budgets" -- <the files you touched>`.

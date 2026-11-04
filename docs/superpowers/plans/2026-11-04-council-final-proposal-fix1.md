# Council final proposal — fix round 1

The final stage's Verify failed on two frontend cases that time out, neither in the run's code:

- `frontend/app/view/agents/railstore.test.ts` › `railVisibleAtom` › "is on for a profile that never stored a choice"
- `frontend/app/view/agents/gridstore.persist.test.ts` › `agentGridAtom storage` › "starts empty for a profile that never stored a grid"

Each is its file's first `vi.resetModules()` + `await import(...)`, which pays the cold transform of the module's whole
import graph (`./agentcenter` reaches most of the cockpit's stores). Commit 3047ab46c (2026-10-29) already raised both
cases to 30 s; on the loaded machine during Final, both ran 32.9 s and timed out again, even when `verify.mjs` reran the
three files alone. The run did not grow that graph: `councilstore.ts` gained no import, and `councilreveal.ts` is
imported by no module either file reaches. So this is a base flake, fixed here because it holds the land.

### Task 1: Pay the cold transform outside the timed cases in the two storage tests

**Depends on:** none
**Files:** `frontend/app/view/agents/railstore.test.ts`, `frontend/app/view/agents/gridstore.persist.test.ts`

Move the cold transform out of the first case into a warm-up the per-test timeout does not cover, so no case's
result depends on how loaded the machine is:

- In each file, add a `beforeAll` that imports the module under test once (`await import("./railstore")` /
  `await import("./gridstore")`), with a generous hook timeout (120 s, the hook's own argument). vite-node keeps the
  transform across `vi.resetModules()`, so every case after it only re-evaluates the module, which is what the cases
  need (the atom reads storage at module creation). The `lsMock` hoist runs before the hook, so the warm import reads
  the stubbed `localStorage`; clear `lsMock` after the warm import so the first case still starts from an empty store.
- Drop the 30 s argument on the two first cases and the comment that says they pay the cold transform; rewrite the
  comment on the `beforeAll` to say why it is there (the atom reads storage once, at module creation, so each case
  imports a fresh copy, and the first fresh import pays the cold transform of the graph `./agentcenter` reaches).
- Do not change any assertion, mock or other case, and do not raise vitest's global `testTimeout`.

Acceptance:
- `npx vitest run frontend/app/view/agents/railstore.test.ts frontend/app/view/agents/gridstore.persist.test.ts`
  passes, and each file's first case now takes well under a second in the report (the warm-up shows as the hook).
- Check it holds under load: run the two files together with one other heavy vitest file at the same time (for
  example `frontend/app/view/agents/agentcenter.test.ts` in a second process) and report both timings.
- Confirm the warm-up really primes the case: temporarily remove the `beforeAll` and see the first case's time
  return to the multi-second cold import; put it back before committing.

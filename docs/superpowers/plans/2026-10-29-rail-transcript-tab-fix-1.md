# Transcript tab: fix round 1

**Spec:** `docs/superpowers/specs/2026-10-29-rail-transcript-tab-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs rail-transcript-tab agent-rail-tabs surface-smoke`

The run's final stage failed at Verify before any scenario ran. Two existing vitest cases timed out on the merged
result, on a machine with about 1.9 GB of RAM free:

- `frontend/app/view/agents/railstore.test.ts`: "is on for a profile that never stored a choice", 5.8 to 9.5 s.
- `frontend/app/view/agents/gridstore.persist.test.ts`: "starts empty for a profile that never stored a grid",
  5.8 to 9.5 s.

Each case is the first in its file. It calls `vi.resetModules()` and then imports `./railstore` or `./gridstore` for the
first time, so it pays the cold transform of the module graph; the cases after it pass in under 1.5 s. The lead traced
both modules' static import graphs: neither reaches a file this run changed, so the slowness is the cold import under
memory pressure, not this run's code. The person chose to give these cases room and rerun the final stage.

### Task 1: Give the two cold-import cases a longer timeout

**Depends on:** none

**Files:** `frontend/app/view/agents/railstore.test.ts`, `frontend/app/view/agents/gridstore.persist.test.ts`

Give the first case of each file a 30-second timeout (vitest's third argument to `it`, or a shared constant at the top of
the file), with a one-line comment saying it is the first fresh import of the module, which pays the cold transform.
Leave every other case and the global `testTimeout` alone, and change no assertion.

Steps:

1. Make the two edits.
2. Run `node node_modules/vitest/vitest.mjs run frontend/app/view/agents/railstore.test.ts
   frontend/app/view/agents/gridstore.persist.test.ts` and confirm all 21 cases pass.
3. `npx eslint` and `npx prettier --check` on the two files.
4. Commit only the two files.

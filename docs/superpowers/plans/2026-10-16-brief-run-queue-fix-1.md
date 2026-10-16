# Brief run queue — fix round 1

**Goal:** `brief-run-queue` passes in the Final: its step 1 clears a briefing fixture an earlier scenario left on before it
looks for the fill run's Runs row.

**Spec:** `docs/superpowers/specs/2026-10-16-brief-run-queue-design.md`

### Task 1: `brief-run-queue` turns off a briefing fixture left on before it reads Runs

**Depends on:** none

The round-1 Final (`node scripts/cdp/final-verify.mjs brief-run-queue run-queue brief-surface`) failed steps 1 and 4 of
`brief-run-queue` and passed every other step. Step 1's rows show the Brief's fixture sessions ("Port the usage charts",
"loom · polish the composer", "Ship the landing briefing") and no fill-run row (`fillAt: -1`). Step 4 then has no fill
row to click (`clicked4: false`). The cause: the harness runs scenarios in `SCENARIOS` order, `brief-surface`
(`scripts/cdp/scenarios.mjs:399`) runs first and leaves a `[data-briefing-fixture]` button on, and `briefsurface.tsx:784`
then draws the fixture's agents instead of the live runs. The queued rows still show because they come from the live run
queue, not the fixture. Leaving for `cockpit` and coming back (`scenarios.mjs:40224-40225`) does not clear the fixture.
Only a reload clears it.

Steps:

1. In `brief-run-queue`'s step 1 (`scripts/cdp/scenarios.mjs`, near line 40221), after `goto("cockpit")` then
   `goto("jarvis")` and before the `polishWaitFor` that waits for the fill row:
   - Check whether a fixture is on, the way `brief-design-parity` does (`scenarios.mjs:12909-12911`):
     `[...document.querySelectorAll('[data-briefing-fixture]')].some((b) => b.className.includes('bg-accentbg'))`.
   - If one is, call `polishReload(h)` as `scenarios.mjs:21214` does, then `goto("jarvis")`.
   - Add a one-line comment naming why: `brief-surface` leaves a fixture on, and only a reload clears it.
2. Keep the cockpit → jarvis remount for the stale-briefing case, which still applies when no fixture is on.
3. Run `node scripts/cdp/final-verify.mjs brief-run-queue run-queue brief-surface`, which runs the scenarios in the
   Final's order. Every step of `brief-run-queue` must pass, steps 1 and 4 included, and `run-queue` and `brief-surface`
   must still pass. In the report, quote step 1's `fillAt` and step 4's `clicked4` and `channel`.
4. Commit only `scripts/cdp/scenarios.mjs`.

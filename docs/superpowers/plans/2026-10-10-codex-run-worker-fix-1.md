# Codex run worker: final-stage fix, round 1

**Spec:** `docs/superpowers/specs/2026-10-10-codex-run-worker-design.md`

The final stage ran `model-picks` and then `codex-worker-route` in one dev app. `model-picks` passed; `codex-worker-route`
errored in arrange with `TypeError: Cannot read properties of undefined (reading 'wshRpcCall')` at the first line of
`listHarnessesPatiently` (`scripts/cdp/scenarios.mjs`). Cause: `model-picks`' teardown (`teardownFixtureRun`) ends with
`location.reload()` and a fixed 2.5 s nap, and on the final stage's cold dev app the page had not yet run
`boot-core.ts`, which sets `window.TabRpcClient`, when the next scenario's arrange called it. Run alone, the scenario is
first after `verify.mjs`'s nav-render wait, which is why it passed in the task.

### Task 1: codex-worker-route waits for the app to boot before its first RPC
**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`

- In `codex-worker-route`'s `arrange`, before `listHarnessesPatiently`, wait (poll every 500 ms, up to 120 s, like
  `verify.mjs`'s render wait) until the page has both `window.TabRpcClient` and a `nav button`. A failed evaluate while
  polling (the execution context destroyed by a reload still in flight) counts as not ready, not as an error. Past the
  deadline throw an error that says the app did not boot, so a real boot failure still fails the scenario.
- Put the wait in one small helper beside `listHarnessesPatiently` (e.g. `waitForAppBoot(h, maxMs)`), and call it also
  from `listHarnessesPatiently` itself, so that helper is safe on its own. Do not change `teardownFixtureRun` or any
  other scenario.
- Keep the file's hand formatting (4-space indent); never run prettier on it.

Acceptance:
- `node scripts/cdp/final-verify.mjs codex-worker-route model-picks` (the runner keeps `SCENARIOS` order, so
  `codex-worker-route` runs right after `model-picks`' reload, as in the final stage): both scenarios pass, with no
  `ERROR` row. Report the printed table.

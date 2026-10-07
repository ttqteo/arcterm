# Claude account switch — Final fix round 1

**Goal:** Fix the two steps that failed in the run's Final: `settings-claude-account` step 7 (one Enter in the
"Dán token" field adds the account twice) and `usage-charts` step 14 (the app-bar check fails when the window is
maximized).

**Verify:** `node scripts/verify.mjs ./pkg/claudeaccount/... ./pkg/claudequota/... ./pkg/wconfig/... ./pkg/wshrpc/... ./pkg/baseds/... ./pkg/waveobj/... ./cmd/wsh/... ./cmd/server/...`

**Final:** `node scripts/cdp/final-verify.mjs settings-claude-account usage-charts`

---

### Task 1: SecretInput commits a value once

**Depends on:** none

Final evidence: in step 7 of `settings-claude-account`, one Enter keydown in `[data-claude-account-paste-token] input`
with `sk-ant-oat01-fixtureC` created two accounts both labelled "Fixture C", with `createdts` 8 ms apart.

Cause: `SecretInput` in `frontend/app/view/agents/settingssurface.tsx` (~line 637). Its Enter handler calls
`commit()` and then `e.currentTarget.blur()`, and `onBlur={commit}` fires a second `commit()` at once. `draft`
still holds the value, because `setDraft("")` runs only after the async `onCommit` resolves. So every Enter
commits twice. For the Claude account form (`onCommit={add}`) that means two `ClaudeAccountAddCommand` calls.
The headless API-key row (`onCommit={saveKey}`) has the same double commit, which happens to be harmless there.

Fix:
- Guard `SecretInput` so one value is committed once. While an `onCommit` for a value is in flight, a second
  commit of the same value (the blur that follows Enter, or a second Enter) does nothing.
- After the commit settles, a commit is allowed again: a failed add keeps the value, and pressing Enter again
  retries it. That keeps the existing failure behaviour, where the value stays and the inline error shows.
- Put the gate in a small pure module beside the component, for example `frontend/app/view/agents/commitgate.ts`
  with `commitgate.test.ts`, following the repo's extract-and-test pattern.

Tests (vitest, written first and failing first):
- Two commits of the same value while the first is pending call `onCommit` once.
- After the first resolves `false`, committing the same value again calls `onCommit` again.
- After it resolves `true`, a later commit of a new value goes through.
- A rejected `onCommit` also frees the gate.

Acceptance: `settings-claude-account` step 7 ("a setup-token adds a fourth row, Fixture C, with no error") passes
in Final. Do not change the scenario's assertions for this step: the scenario is right and the component is wrong.

Run: `npx vitest run frontend/app/view/agents/`, `task check:ts` (5-minute timeout), and `npx prettier --check` on
the new files only (`settingssurface.tsx` already fails prettier at HEAD; leave those lines alone).

Commit: `fix(settings): one Enter in a secret field commits once`. Add no CHANGELOG line: the account form is new
in this run, and the API-key double save was invisible to users.

### Task 2: usage-charts app-bar check accepts a maximized window

**Depends on:** none

Final evidence: `usage-charts` step 14 failed with `{"found":true,"usageArcs":0,"hasLimitText":false,"min":true,"max":false,"close":true}`.
This branch does not touch the app bar. `frontend/app/cockpit/app-bar.tsx:118` labels the button
`aria-label={maximized ? "Restore" : "Maximize"}`, and the Final dev app's window opened maximized, so the button
read "Restore". The step looks only for `[aria-label="Maximize"]` (`scripts/cdp/scenarios.mjs` ~line 1877).

Fix: in that step, count the maximize control as present when the bar has `[aria-label="Maximize"]` or
`[aria-label="Restore"]`, and keep `max` in the detail JSON (for example `max: "Maximize" | "Restore" | null`) so
the record still shows which one it saw. Change nothing else in `usage-charts`. Never run prettier on
`scripts/*.mjs`.

Acceptance: `usage-charts` step 14 passes in Final whether the window opens maximized or not.

Run: `node --check scripts/cdp/scenarios.mjs`.

Commit: `test(cdp): usage-charts app-bar check accepts a maximized window`.

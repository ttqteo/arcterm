# Claude Account Settings UX — Final fix round 1

**Goal:** Make the `settings-claude-account` CDP scenario's seeded quota snapshots reach the page, and make step 11 read Default's snapshot where the app keeps it, so the Final passes on the merged result.

**Architecture:** Scenario only (`scripts/cdp/scenarios.mjs`). No product code changes: the section, the Add dialog and the restart dialog passed every step that does not depend on a seeded snapshot.

**Spec:** `docs/superpowers/specs/2026-10-08-claude-account-ux-design.md`

## Global Constraints

- Never run prettier on `scripts/*.mjs` (it reindents them).
- Do not start a build, a dev app or `final-verify.mjs` on this machine; the round's Final runs the scenario after the merge.
- Keep every step's number, title and assertion as they are, except where a task below says otherwise.

### Task 1: Seed the quota snapshots so they survive, and read Default's snapshot by its real key

**Depends on:** none

**Files:** `scripts/cdp/scenarios.mjs`

The round-1 Final failed steps 1, 5, 11, 16, 17 and 22. All six share two causes in the scenario, not in the UI.

1. **The seeded snapshots never reached the page.**
   - Evidence:
     - Fixture A and Fixture B both read `Not used yet`.
     - The Usage surface found no reading for A.
     - `fixture@example.com` was missing from Same account as (both the row menu and the Add dialog's Name step).
   - Cause: `arrange` writes `wave:ratelimits` to localStorage and then reloads. But `frontend/app/view/agents/ratelimitstore.ts` holds the snapshots in a jotai atom read once at module load, and `persistSaved` writes that whole atom back to localStorage. Between the `setItem` and the reload, a pending write from the page can overwrite the seed with the atom's older contents, which have no seed. Examples are the boot-time `readClaudeQuota` in `claudequota.ts` (a live usage-endpoint call, which finished during the arrange: Default reads a live 60%) and the identity refresh after `claudeaccountadd`.
2. **Step 11 reads the wrong key.**
   - `claudePlan` reads Default's snapshot as `saved["claude:default"]`.
   - Once the /login email is known, `adoptDefaultSnapshot` moves that snapshot to `claude:<loginemail>`, and `claudeQuotaKey` reads Default from there.
   - So `defaultPct` is always null on a machine with a /login email, and the live-reading branch of step 11 can never match: the round-1 Final read `{"value":"60%","defaultPct":null}`.

- [ ] **Step 1: Seed until the seed survives a reload.**
  - In `settingsClaudeAccount.arrange`, replace the single `localStorage.setItem` + `caReload` of the rate snapshots with a loop of at most 3 tries:
    - set the `rate` object;
    - `caReload(h)`;
    - read `wave:ratelimits` back from the reloaded page;
    - stop once it holds `claude:<idA>`, `claude:<idB>` and `claude:fixture@example.com` with the seeded `fivehourpct` (97, 40, 55).
  - Do not require `claude:default` to survive: the page moves it to the /login email's key.
  - After the reload the atom is loaded from the seed, so a later write keeps it.
  - If 3 tries do not hold, set `ctx.arrangeError` to a message naming the keys that are missing. Then the table says the seed failed instead of failing steps 1, 5, 16, 17 and 22 one by one.
  - Keep the roster fixture write before the first reload, as now. The existing single reload after it becomes the loop's first try. Do not add a reload ahead of it.
  - Update the comment above `rate` to say why the seed is read back.
- [ ] **Step 2: Read Default's snapshot by the key the app uses.**
  - In `claudePlan`, take the /login email from `claudeaccountlist` (`loginemail`, trimmed, lowercased). Read Default's percent from `saved["claude:" + loginEmail]` when that email is set, otherwise from `saved["claude:default"]`.
  - Keep the returned field name `defaultPct`, so steps 5 and 11 stay as they are.
  - Update the comment on `claudePlan` to say that Default's snapshot follows the /login email.
- [ ] **Step 3: Check the file.**
  - `node --check scripts/cdp/scenarios.mjs` must pass.
  - `npx eslint scripts/cdp/scenarios.mjs` already fails at HEAD on Node globals (`no-undef`) and two `no-useless-escape` hits. Add no new error class and touch none of the existing ones.
- [ ] **Step 4: Commit.**
  - Use `test(cdp): settings-claude-account seeds quota snapshots that survive the reload`.
  - The commit body says both causes in one line each.

**Shown by:** steps 1, 5, 11, 16, 17 and 22 of `settings-claude-account`, run by the round's Final.

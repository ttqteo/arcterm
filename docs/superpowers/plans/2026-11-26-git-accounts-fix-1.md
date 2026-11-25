# GitHub accounts per folder: Final round 1 fixes

**Spec:** `docs/superpowers/specs/2026-11-25-git-accounts-design.md` (its "Builder decisions" section, including the credentials-strip decision added for this round)
**Verify:** `node scripts/verify.mjs ./pkg/gitaccount ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs settings-git-accounts settings-pages`
**Prototype:** .superpowers/design/git-accounts/project/A-agents-card.dc.html

Round 1 of the Final failed on two counts. `settings-pages` failed three steps whose expectations were stale before this
run: the Remote page (3d37bc6e0), the Appearance page's `agentheader` card and an eleventh theme. The end review found
that the `~/.git-credentials` fix cannot be reached when no repo leaks. Both tasks: simple and direct (KISS, YAGNI, DRY,
one source of truth), no attribution trailers in commits.

### Task 1: settings-pages expects the pages, cards and themes the app has
**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`

In the `settings-pages` scenario (`scripts/cdp/scenarios.mjs`, the block under `// --- settings-pages:`), bring the
expectations in line with the sources, which are right:

- `SP_PAGES`: insert `{ id: "remote", cards: ["remotemode", "remotesetup"] }` after `general` (the page order and card
  ids of `frontend/app/view/agents/settingsmodel.ts`), and make appearance's cards
  `["theme", "colors", "fonts", "agentrows", "agentheader", "chat"]`. Keep agents as
  `["claudeaccount", "gitaccounts", "sleep", "flags"]`.
- Replace "nine pages" with "ten pages" in the step label, the header comment and the scenario's one-line title comment.
- The appearance-detail step: the chip count is the number of entries in `THEMES` (`frontend/app/view/agents/themes.ts`),
  11 today. Change `chips.count === 10` to `=== 11`, and "ten theme chips" to "eleven theme chips" in the label and the
  comment above it.
- If the scenario opens or shots each page from `SP_PAGES` (it does: one step per page), the Remote page gets a step and a
  shot like the others, and nothing else changes. If a detail step walks a fixed list of pages, leave Remote out of it:
  no detail is asked for here.

Do not reformat the file (hand-formatted 4-space `.mjs`; never run prettier on `scripts/*.mjs`). Check with
`node --check scripts/cdp/scenarios.mjs`. An agent an Arc run started runs no CDP: the Final runs the scenario.

Acceptance: the Final's `settings-pages` steps "index: one flat list of ten pages…", "appearance: the page holds its cards
in order", "remote: the page holds its cards in order" and "appearance-detail: eleven theme chips…" pass, and every other
`settings-pages` step still passes.

### Task 2: the ~/.git-credentials fix is reachable when no repo leaks
**Depends on:** none
**Files:** `frontend/app/view/agents/gitaccounts.ts`, `frontend/app/view/agents/gitaccounts.test.ts`, `frontend/app/view/agents/settingspages/gitaccounts.tsx`, `scripts/cdp/scenarios-git-accounts.mjs`

Today a leaks strip, and with it Fix, shows only on an account whose scan found token or identity repos
(`leakText` in `gitaccounts.ts`, used at `settingspages/gitaccounts.tsx` around lines 242 and 360). The credentials row is
added to whichever account's fix list opens (`fixRows(s, credentialsLines)`). So with clean repos and github.com lines in
`~/.git-credentials` (`scan.credentialslines > 0`), the credentials fix has no way in. The spec says the fix list has
that row on any machine whose `~/.git-credentials` holds github.com lines.

Decision (recorded in the spec's Builder decisions): when `credentialslines > 0` and no account has a strip, one account
row carries a credentials-only strip. That row is the default login's account when it is one of the accounts, else the
first account in list order. The strip text is `~/.git-credentials keeps N github.com line(s) in plain text.`
(singular for 1), with the same Fix button as the other strips. Fix opens the fix list with only the credentials row,
ticked, and is gated by `fixAllowed` / `fixDisabledReason` exactly as now (disabled, with its reason, when that account's
token is not saved and accepted). When any account already has a strip, nothing changes: the credentials row joins
whichever account's fix list opens. One strip at most for the credentials, so "no leaks strip on an account with nothing
to fix" still holds for every other row.

- `gitaccounts.ts`: one pure function, for example `credentialsStripLogin(list, scan): string`. It returns the login that
  carries the credentials-only strip, or `""` when `credentialslines` is 0 or any account has token or identity repos.
  Add the strip text, either through `leakText` taking `credentialsLines` and a flag, or as a small `credentialsText(n)`.
  Pick whichever keeps one source of truth for the strip text.
- `gitaccounts.test.ts`: tests for no strip when the lines are 0; no credentials strip when an account already has one;
  the default login carrying it; the first account carrying it when the default login is not an account; and the text in
  singular and plural.
- `settingspages/gitaccounts.tsx`: draw that strip in the same `[data-git-account-leaks]` element and the same Fix button
  hooks the other strips use, so the scenario helpers work unchanged. Mark it `data-git-account-leaks="credentials"`, or
  add a separate attribute, so a step can tell it apart.
- `scripts/cdp/scenarios-git-accounts.mjs`: a new step 14, "credentials only". The fixture is clean repos for every
  account (no token or identity repos), `credentialslines: 2`, dave the default login with token state `saved`. Expect
  dave's row, and only dave's, to show the strip with "~/.git-credentials keeps 2 github.com lines in plain text."
  Fix opens `[data-git-fix-modal]` with exactly one row, `credentials:~/.git-credentials`, ticked. Apply sends one
  `gitaccountfix` `{login: "dave", tokenrepos: [], identityrepos: [], credentials: true}` and the row reads ok. Shot
  `cdp-shots/settings-git-accounts-14-credentials-only.png`. Seed the mock and remount the card the way steps 5–12 do.
  Keep step 13 (the What's new picture) last, or renumber so the picture step stays the last step. Do not reformat the
  file.

Checks: `npx vitest run frontend/app/view/agents/gitaccounts.test.ts`, `task check:ts`,
`npx eslint frontend/app/view/agents/gitaccounts.ts frontend/app/view/agents/settingspages/gitaccounts.tsx`, and
`node --check scripts/cdp/scenarios-git-accounts.mjs`. No CDP (the Final runs it); add no hand-check line, because
this strip uses the existing strip motion.

Acceptance: the new tests pass. The Final's `settings-git-accounts` passes every step, step 14 included, and step 1 still
shows no strip on carol or dave (that fixture has token or identity repos on alice and bob, so the credentials-only strip
stays off).

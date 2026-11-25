# GitHub accounts per folder

**Spec:** `docs/superpowers/specs/2026-11-25-git-accounts-design.md` (its "Builder decisions" section settles every file name, marker, state and RPC this plan names)
**Verify:** `node scripts/verify.mjs ./pkg/gitaccount ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs settings-git-accounts settings-pages`
**Prototype:** .superpowers/design/git-accounts/project/A-agents-card.dc.html

Shape: Task 1 lands the wire types; Task 2 (Go backend) and Task 3 (the card) then run side by side; Task 4 writes the
scenario against Task 3's hooks, plus the CHANGELOG and docs. Every task: simple and direct (KISS, YAGNI, DRY, one
source of truth), errors handled at the boundary and never swallowed (a failure logs and says what it lost), never
hand-edit generated files (edit the Go types, run `task generate`), no attribution trailers in commits.

### Task 1: Wire types for the gitaccount RPCs
**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_gitaccount.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

Add `GitAccountCommands` (embedded in the interface list in `wshrpctypes.go` beside `ClaudeAccountCommands`) and run
`task generate`. No handler yet: dispatch is by reflection, so an unimplemented command only errors when called.
Exact shapes (json tags lowercase, `omitempty` on optional strings); Tasks 2 and 3 rely on them:

- `GitAccountListCommand() (*GitAccountListRtnData, error)`; `GitAccountListRtnData{Accounts []GitAccountData; DefaultLogin, GlobalName, GlobalEmail, DefaultHelper string}`;
  `GitAccountData{Login, Name, Email string; Roots []string}`.
- `GitAccountCheckTokenCommand(CommandGitAccountTokenData) (*GitHubUserData, error)`; `CommandGitAccountTokenData{Login, Token string}`; `GitHubUserData{Login, Name, Email string}`.
- `GitAccountAddCommand(CommandGitAccountAddData) (*GitAccountData, error)`; `CommandGitAccountAddData{Login, Token, Name, Email, Root, DefaultLogin string}`.
- `GitAccountUpdateCommand(CommandGitAccountUpdateData) error`; `{Login, Name, Email string}` ("" keeps a field).
- `GitAccountSetTokenCommand(CommandGitAccountTokenData) error`.
- `GitAccountRemoveCommand(CommandGitAccountLoginData) error`, `GitAccountSetDefaultCommand(CommandGitAccountLoginData) error`; `CommandGitAccountLoginData{Login string}`.
- `GitAccountAddRootCommand(CommandGitAccountRootData) error`, `GitAccountRemoveRootCommand(CommandGitAccountRootData) error`; `{Login, Root string}`.
- `GitAccountTokenStateCommand(CommandGitAccountLoginData) (*GitAccountTokenStateData, error)`; `{State string /* saved|refused|missing|unreachable */; Detail string}`.
- `GitAccountScanCommand() (*GitAccountScanRtnData, error)`; `GitAccountScanRtnData{Accounts []GitAccountScanData; CredentialsLines int; Errors []string}`;
  `GitAccountScanData{Login string; Repos int; TokenRepos []GitRepoRemoteData; IdentityRepos []GitRepoIdentityData}`;
  `GitRepoRemoteData{Path, Remote, MaskedUrl string}`; `GitRepoIdentityData{Path, Name, Email string}`.
- `GitAccountFixCommand(CommandGitAccountFixData) (*GitAccountFixRtnData, error)`; `CommandGitAccountFixData{Login string; TokenRepos, IdentityRepos []string; Credentials bool}`;
  `GitAccountFixRtnData{Results []GitFixResultData}`; `GitFixResultData{Kind /* token|identity|credentials */, Path, Error string}`.

Acceptance: `task generate` leaves `RpcApi.GitAccountListCommand` … `GitAccountFixCommand` in `wshclientapi.ts` and the
types in `gotypes.d.ts`; `go build ./...` and `task check:ts` pass.

### Task 2: pkg/gitaccount and its wshserver handlers
**Depends on:** Task 1 (implements the `GitAccountCommands` interface and types it adds)
**Model:** opus
**Files:** `pkg/gitaccount/gitaccount.go`, `pkg/gitaccount/gitconfig.go`, `pkg/gitaccount/github.go`, `pkg/gitaccount/scan.go`, `pkg/gitaccount/fix.go`, `pkg/gitaccount/gitaccount_test.go`, `pkg/gitaccount/gitconfig_test.go`, `pkg/gitaccount/github_test.go`, `pkg/gitaccount/scan_test.go`, `pkg/gitaccount/fix_test.go`, `pkg/wshrpc/wshserver/wshserver_gitaccount.go`

Implement every decision in the spec's "Builder decisions" Data, Tokens and Scan-and-fix parts: the JSON list as the
only source, the block and account files rendered from it, `git credential` calls that name their own helper,
backups, scan, fix. All git runs go through one helper that adds `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`
and returns stderr in its error. Package vars swapped by tests: the store path, the backup dir, the OS helper, the
GitHub API base. One package mutex around every write. Handlers in `wshserver_gitaccount.go` are thin and carry
`var _ wshrpc.GitAccountCommands = (*WshServer)(nil)`.

Acceptance, each a focused test that runs real `git` with `t.Setenv("HOME", tmp)`, `GIT_CONFIG_NOSYSTEM=1`, the OS
helper swapped to `store --file=<tmp>/creds`, and an `httptest` server for `/user`:

- `TestIncludeAppliesUnderRoot`: after Add, `git -C <root>/a/b config user.email` is the account's email and
  `git credential fill` there returns the account's token; in a repo outside every root, `credential.username` is the
  default login and `user.email` is the global one.
- `TestRenderRemovesRootAndAccount`: removing a root drops its include; removing the last account leaves
  `~/.gitconfig` byte-equal to before the first add (other content and its place kept) and no `~/.gitconfig-<login>`.
- `TestAddRefusesToken`: 401, a login mismatch and an unreachable API each refuse Add with nothing written; a refused
  token leaves no store entry.
- `TestRootOverlapRefused`: a root inside or containing another account's root is refused.
- `TestRemoveDefaultRefused`: Remove of the account whose login is the default login is refused with nothing changed
  (its token still in the store); after SetDefault to another login it succeeds.
- `TestRemoveLastRoot`: removing an account's last root keeps the account, its token and its file, and drops its
  include line.
- `TestTokenState`: saved, refused, missing, unreachable.
- `TestScanFindsLeaksAndIdentities`: two levels deep, `node_modules` and `.git` files skipped, the token-shaped
  username and the password forms flagged, `https://user@github.com` not, masked URL never holds the token.
- `TestFixRewritesAndBacksUp`: refused when the token is missing or refused (nothing changed); otherwise URLs
  cleaned, local identity unset, a failure on one repo reported while the rest are fixed, every changed file in the
  backup folder; backups pruned to 20.
- `TestCredentialsFixKeepsOtherHosts`: github.com lines dropped, other hosts kept; afterwards the block resets
  github.com helpers and restores the saved ones (pure helper-list test: empty-value resets in order, `store` dropped);
  `git credential approve` by arcterm never writes `~/.git-credentials`.
- `TestAccountFileBackupWhenForeign`: an existing `~/.gitconfig-<login>` without the header is backed up first.

### Task 3: The GitHub accounts card, add dialog and fix list
**Depends on:** Task 1 (uses the generated `RpcApi.GitAccount*` calls and types)
**Files:** `frontend/app/view/agents/gitaccounts.ts`, `frontend/app/view/agents/gitaccounts.test.ts`, `frontend/app/view/agents/settingspages/gitaccounts.tsx`, `frontend/app/view/agents/settingspages/gitaccountaddmodal.tsx`, `frontend/app/view/agents/settingspages/gitaccountfixmodal.tsx`, `frontend/app/view/agents/settingspages/agents.tsx`, `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`

Build the card to the Prototype board and the spec's RPC-and-UI decisions (read `DESIGN.md` and the Claude account
card in `agents.tsx` first; reuse `SettingCard`, `CardFooter`, `Note`, `ModalShell`, `DialogButton`, the context
menu and `springReveal`; colors only from tokens). `agents.tsx` gains one line mounting `GitAccountsCard` after
`ClaudeAccountCard`. `settingsmodel.ts`: the row-less `gitaccounts` card after `claudeaccount` with the spec's
keywords, and the new Agents blurb. Pure logic in `gitaccounts.ts`: rows (Default first), token-state text, the
add dialog's step reducer (login+token → check → email/root/default login → save; token-only for Replace), the fix
list's default ticks (token and credentials rows ticked, identity rows not), the fix button's enabled rule (token
state `saved` and something to fix). Network RPCs pass `{ timeout: 30000 }`.

DOM hooks Task 4 relies on (exact names): `[data-git-account-row="<login>|default"]`, `[data-git-account-token="<login>"][data-state]`,
`[data-git-account-root]`, `[data-git-account-repos="<login>"]`, `[data-git-account-menu="<login>|default"]`,
`[data-git-account-leaks="<login>"]`, `[data-git-account-fix="<login>"]` (`disabled` when not allowed),
`[data-git-root-input="<login>"]`, `[data-git-account-add]`, `[data-git-account-add-root]`, `[data-git-accounts-empty]`,
`[data-git-accounts-scan-error]`, `[data-git-accounts-error]`; add dialog `[data-git-add-modal][data-mode="add|token"]`
with `[data-git-add-login]`, `[data-git-add-token]`, `[data-git-add-check]`, `[data-git-add-email]`, `[data-git-add-root]`,
`[data-git-add-default]`, `[data-git-add-save]`, `[data-git-add-error]`; fix list `[data-git-fix-modal]` with
`[data-git-fix-row="<kind>:<path>"]` (a checkbox inside), `[data-git-fix-apply]`, `[data-git-fix-result="<kind>:<path>"][data-ok]`.

Acceptance: `npx vitest run frontend/app/view/agents/gitaccounts.test.ts` covers the row order, each token state's
text, the dialog steps (a refused check stays on the token step with its error; the first account requires the
default login), the default ticks and the fix button rule. `settingsmodel.test.ts` lists `agents/gitaccounts` after
`agents/claudeaccount`, finds the card by "github" and "commit email", and "claude account" still finds only
`claudeaccount`. `task check:ts` passes. An account with no roots reads **No folder**. Rendered states and
interactions are shown by Task 4's `settings-git-accounts` steps: every token state and the nothing-to-fix row (1),
scan-running dashes (1b), empty (2), add dialog (3, 4), fix list (5, 6), scan error (7), Replace token (8), the ⋯
menu's Rename / Change email (9), Add folder from the footer and Remove folder (10), Remove account and its refusal
for the default login (11), Change default login (12).

### Task 4: Scenario, CHANGELOG and docs
**Depends on:** Task 3 (uses its DOM hooks)
**Files:** `scripts/cdp/scenarios-git-accounts.mjs`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/guide/settings.md`, `docs/hand-checks.md`

Scenario `settings-git-accounts` in its own module (shaped like `scenarios-chat-suggest-card.mjs`, registered in
`scenarios.mjs`): it installs an RPC mock (`RpcApi.setMockRpcClient`) answering every `gitaccount*` command from
fixtures and recording calls, so nothing real is written or fetched; teardown removes it. Steps, each with a shot:
(1) Settings → Agents shows the card under Claude account: Default row with its login, email and helper, and four
account rows with roots and repo counts whose `[data-git-account-token][data-state]` and text are saved / refused /
missing / unreachable, the leaks strip with Fix enabled on the saved account and disabled on the refused one, and no
`[data-git-account-leaks]` on an account the scan found nothing to fix for; (1b) with the mocked `gitaccountscan`
held pending, repo counts show a dash, then fill in when it resolves; (2) the empty state when the list has no accounts; (3) + Add account: a refused check
shows its error on the token step; (4) a good check moves on to email, root and default login, Save calls
`gitaccountadd` with them and the new row appears; (5) Fix opens the list: token and credentials rows ticked, identity
rows unticked with their identity; clearing one tick then Apply sends only the ticked paths; (6) a fix that failed on
one repo keeps the modal open with that row in the error tone; (7) a scan error shows its note while rows stay;
each of the following asserts the recorded payload: (8) ⋯ → Replace token opens `[data-git-add-modal][data-mode="token"]`
with the login fixed, and a good check sends `gitaccountsettoken`; (9) ⋯ → Rename and ⋯ → Change email send
`gitaccountupdate`; (10) footer + Add folder → pick the account → type into `[data-git-root-input]` sends
`gitaccountaddroot`, and ⋯ → Remove folder sends `gitaccountremoveroot`; (11) ⋯ → Remove account confirms and sends
`gitaccountremove`, and a mocked refusal for the default login shows its error in `[data-git-accounts-error]`;
(12) Default row ⋯ → Change default login sends `gitaccountsetdefault`; then
`await h.whatsnewShot("git-accounts", { selector: '[data-setting-card="gitaccounts"]' })`. In `scenarios.mjs`,
`SP_PAGES`' agents entry becomes `["claudeaccount", "gitaccounts", "sleep", "flags"]`.

`CHANGELOG.md` Unreleased → Added: one line for the person (each GitHub account tied to folders, name/email/token
follow the folder wherever git runs, fix tokens in remote URLs), ending `<!-- big --> <!-- shot: none -->` (spec,
CHANGELOG decision). `docs/guide/settings.md`: a "Làm thế nào" subsection for the card, written in Vietnamese like the
rest of the file, and the Agents page's card list updated. `docs/hand-checks.md`, under a new `## 2026-11-26` heading
opened above the current top heading (`## 2026-11-25`), as the file's header says: `- [ ]` lines
for a real push from a repo under a root using that account's Keychain token; Windows: GCM stores and serves the token
and gh still serves repos outside roots; the new row's `springReveal` and the modals' open/close motion.

Acceptance: `node --check scripts/cdp/scenarios-git-accounts.mjs`; `npx vitest run frontend/app/cockpit/whatsnew.test.ts`
passes; the Final runs `settings-git-accounts` (steps 1–12) and `settings-pages`.

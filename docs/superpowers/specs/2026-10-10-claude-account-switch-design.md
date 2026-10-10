# Claude account switching, and a manual vault sync

Status in this fork (synced from kaeltran16/waveterm 2026-10-10): only §2, the vault's Sync now button, was
taken, ported onto Settings → General's Vault & sync card. §1 was not: this fork already switches accounts with
`claude setup-token` tokens (`2026-10-07-claude-account-switch-design.md`, `2026-10-08-claude-account-ux-design.md`),
and on macOS claude keeps its login in the Keychain, not `.credentials.json`.

Two Settings changes. The design canvas is `C:\Users\cktra\Projects\waveterm\.superpowers\design\claude-account\project\`
(gitignored, read it from that absolute path): `Main.dc.html` and `States.dc.html` for the Claude account
section, `Vault.dc.html` and `VaultStates.dc.html` for the vault row.

## 1. Claude account

### Goal

One active Claude.ai login at a time. Arc keeps every login it has seen and switches between them in one
click, so a user who hits one account's 5-hour or weekly limit can move to another without `/login`. Per-agent
accounts (several `CLAUDE_CONFIG_DIR`s at once) are out of scope.

### Where Claude Code keeps a login

- Tokens: `<config dir>/.credentials.json`, key `claudeAiOauth` (`accessToken`, `refreshToken`, `expiresAt`,
  `refreshTokenExpiresAt` in epoch milliseconds, `scopes`, `subscriptionType`, `rateLimitTier`). The same file
  holds `mcpOAuth` (MCP server logins) and possibly other keys; a switch must keep them.
- Identity: `oauthAccount` in the user config file that `pkg/jarvis/claudetrust.go`'s `claudeConfigPath`
  resolves (`accountUuid`, `emailAddress`, `organizationName`, ...).
- `<config dir>` is `CLAUDE_CONFIG_DIR`, else `~/.claude`.

A running Claude Code session watches `.credentials.json`'s mtime and re-reads it when it changes, so a switch
also reaches running sessions at their next credential check. Arc promises only that new launches use the new
account; it does nothing to running sessions.

### Behaviour

- **Saved logins** live in Arc's encrypted secret store (`pkg/secretstore`), one secret per account named
  `claudeacct_<accountUuid with - replaced by _>`. The value is one line of compact JSON:
  `{"oauth": <claudeAiOauth as read>, "account": <oauthAccount as read>, "lastusedts": <ms>}`.
- **Capture.** Reading the live login (both `claudeAiOauth` and an `oauthAccount` with an `accountUuid` present)
  saves it into its account's secret with `lastusedts` = now. Listing captures first, so a `/login` made in any
  claude session appears the next time Arc lists. No live login means nothing is captured and nothing fails.
- **List** returns every saved account: uuid, email, organization name, plan (`subscriptionType`), whether it
  is the active one (its uuid equals the live `oauthAccount.accountUuid`), whether it is expired
  (`refreshTokenExpiresAt` is set and in the past), and `lastusedts`. It also reports whether a live
  Claude.ai login exists.
- **Switch(uuid)**:
  1. Capture the live login (its refresh token rotates while in use, so the saved copy would go stale).
  2. Refuse an unknown uuid or an expired target with an error naming the account. Switching to the active
     account is a no-op.
  3. Write the target's `oauth` as `claudeAiOauth` into `.credentials.json`, keeping every other key, by atomic
     write (`fileutil.AtomicWriteFile`) with the file's existing permissions (0600 when new).
  4. Under Claude Code's config lock (`lockClaudeConfig`), write the target's `account` as `oauthAccount` into
     the user config file, keeping every other key, by atomic write.
  5. If step 4 fails, restore `.credentials.json` to what it was before step 3, so a failed switch leaves the
     current login unchanged. The error names the file and the cause.
  Switches and captures are serialized by one mutex.
- **Remove(uuid)** deletes the saved secret. Removing the active account is refused (the UI does not offer it).

### Settings UI

A **Claude account** section in Settings, group Agents, directly after New Agent. Blurb: "Which Claude.ai
login new claude sessions use. Arc saves every login it sees, so moving to another account is one click."

- **Accounts** row (stacked). Description: "Every claude session launches with the active account. Switching
  saves the active login first, so its tokens are current when you come back to it." Key line:
  `~/.claude/.credentials.json · ~/.claude.json · secrets.enc`, scope local. One full-width list:
  - the active account first, on a selected-row background, Claude-coral initial, email, `org · plan`, and a
    green dot + "Active" label (no Remove);
  - each other account: neutral initial, email, `org · plan · last used <ago>`, then Remove and Switch in a
    fixed right-hand slot so buttons align across rows;
  - an expired account shows the amber line "Sign-in expired. Run /login with this account to save it again."
    and a disabled Switch (Remove still works);
  - after a successful switch, a status line under the list: "Switched to <email>. New claude sessions use it;
    running ones pick it up at their next token check.";
  - with only one account saved: "No other accounts yet. Add one below." under the list;
  - with no live login: a warning note above the list, "No Claude.ai login is active. Switch to a saved
    account, or run /login in a claude session.";
  - a failed switch or remove: an error note under the list with the backend's message.
- **Add an account** row. Description: "Run `/login` in any claude session and sign in with the other account.
  Arc saves it the next time it checks." A **Check now** button re-lists; when the list did not grow it shows
  "No new login found" beside the button.
- Opening the section lists (and so captures).

### Usage donuts

`frontend/app/view/agents/ratelimitstore.ts` saves the last 5h/weekly snapshot per provider. After a
successful switch the frontend drops the saved `claude` snapshot (atom and localStorage), since it belongs to
the previous account; the next agent report fills it again.

### Testing

- Go unit tests on temp files, with the credentials path, the config path and the secret store injected as
  package vars: capture saves the live login; capture with no login is a no-op; switch keeps `mcpOAuth` and
  every other key in both files; switch captures the live login before writing; switch refuses an expired or
  unknown target; a failing config write restores `.credentials.json`; remove deletes and refuses the active
  account; expiry and active flags in list.
- Vitest for the pure row model (ordering, flags, meta line) and for dropping a saved rate-limit snapshot.
- CDP scenario `settings-claude-account`: opens the section and checks it renders (Accounts row with an active
  account or the no-login note; Add an account row with Check now; clicking Check now leaves no error note).
  It seeds two fake saved accounts (one valid, one expired) into the dev app's own secret store, checks their
  rows, and clicks Remove only on a seeded account; it never clicks Switch, since the dev app shares the real
  `~/.claude`. Removing a saved account touches only the secret store.

## 2. Manual vault sync

The Vault section's **Sync remote** row gets a **Sync now** button beside the remote input. The backend already
has `VaultSyncCommand` (with `wait`) and reports `running` / `lasterror` in `VaultStatusCommand`; today a sync
runs only at launch and on window focus (`frontend/app/store/vaultsync.ts`).

- The button carries a refresh icon and reads "Sync now". It is disabled while `status.running` is true
  (label "Syncing…"), including a sync started at launch or on focus, and when sync is off (`status.off` set),
  where it keeps the label "Sync now".
- A click marks the row syncing at once, calls `VaultSyncCommand` with `wait: true` and an RPC timeout long
  enough for a sync (use 120 s), then reloads the status. The existing status line under the row reports the
  outcome ("Last synced just now", or "Sync failed: ..." in the error color). An RPC failure (including the
  timeout) shows in the row's existing error note.
- After a failure the button stays enabled, so the user can retry.
- CDP scenario `settings-vault-sync`: opens the Vault section and checks the Sync remote row has the button,
  and that its disabled state matches the status (the final-verify dev app's vault normally has no remote:
  button disabled, status "Sync off — no remote"). It clicks only when the button is enabled.

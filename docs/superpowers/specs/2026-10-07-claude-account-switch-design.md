# Claude account switch in Settings — design

Status: design settled 2026-10-07.

## Problem

The user keeps more than one Claude subscription and moves to another when the current one's 5-hour or
weekly window runs out. Today that means `/logout` and `/login` inside a claude terminal, then restarting
every running agent by hand. arcterm also assumes one Claude account: the Plan usage strip, the cockpit
rail and `ratelimitstore` keep a single `"claude"` snapshot, and `pkg/claudequota` only reads the account
in `~/.claude/.credentials.json`.

Wanted: pick the account in Settings, one account at a time, and have new agents and the quota readout
follow it.

Out of scope: several accounts at once (different agents on different accounts), automatic switching
when a window fills, a "switch?" toast, refreshing or minting tokens ourselves, `CLAUDE_CONFIG_DIR`
profiles, macOS Keychain, and remote (ssh/wsl) connections.

## Decisions

1. **Accounts are `claude setup-token` tokens.** `claude setup-token` issues a one-year OAuth token for a
   Pro/Max/Team/Enterprise account. A claude process with `CLAUDE_CODE_OAUTH_TOKEN` set uses that token
   ahead of the `/login` credentials, so `~/.claude` (settings, arcterm's hooks and mod, session history)
   stays one directory and the cockpit keeps working. `CLAUDE_CONFIG_DIR` was rejected because arcterm
   hardcodes `~/.claude` for history (`pkg/agentsessions/agentsessions.go`) and hooks
   (`cmd/wsh/cmd/wshcmd-installhooks.go`). Swapping `.credentials.json` was rejected because
   refresh tokens rotate and a running claude writes its own account back over the file.
   Limit, from the docs: such a token serves model requests only (no Remote Control, no claude.ai
   connectors).
2. **"Default (/login)" is always an option** and means no token: claude uses whatever `/login` stored,
   exactly as today. It is the state after upgrade.
3. **Tokens live in `pkg/secretstore`** (`secrets.enc`, DPAPI on Windows), one secret per account,
   `CLAUDE_ACCOUNT_<id>` (ids are `a` + 8 hex, since secret names allow only `[A-Za-z0-9_]`). The account
   list (id, label) is a local file, `<data dir>/claude-accounts.json`, behind four RPCs, not a setting:
   `SetConfigCommand` rejects an array-of-objects value, the Settings "changed" check compares by
   identity, and settings sync through the vault to machines that do not hold the tokens. The active
   account is the string setting `claude:activeaccount` (empty = Default), listed in `machineLocalKeys`
   so it never syncs. No RPC returns a token.
4. **The token reaches claude through wavesrv's own environment.** On start and on every switch, wavesrv
   sets `CLAUDE_CODE_OAUTH_TOKEN` and `ARC_CLAUDE_ACCOUNT=<id>` in its process environment (or restores the
   values it inherited, for Default). Local shells (`pkg/shellexec`), headless `claude -p` runs
   (`pkg/consult`) and run workers all start from `os.Environ()`, so everything started after the
   switch gets the new account with no per-launch plumbing. Shells already open keep the old value: a
   `claude` typed into an old terminal still runs on the old account, and the switch dialog says so.
5. **Running agents are offered a restart.** Switching opens a dialog listing live claude agents. Idle
   ones are pre-checked; working ones are unchecked with "đang làm việc — restart sau khi xong lượt".
   Confirming restarts the checked agents with `claude --resume <session>` through the existing resume
   path, so the conversation continues on the new account. Cancel switches anyway and leaves them.
   Asking agents are listed unchecked with "đang hỏi — restart sẽ bỏ câu hỏi" (a resume drops the pending
   question). Not listed: background agents (no block; one stays on the old account until it ends), plain
   terminals, agents already on the new account, and agents with no block or no transcript, which cannot
   be resumed.
6. **Quota is per account.**
   - `wsh agentstatus --usage` reads `ARC_CLAUDE_ACCOUNT` from its environment (inherited from the claude
     that runs the hook) and sends it as `AgentUsage.account` (new field in `pkg/baseds`; `task generate`).
   - `ratelimitstore` keys Claude snapshots `claude:<account>` (`claude:default` for Default; an existing
     `"claude"` snapshot migrates to `claude:default`). The Plan usage strip, the cockpit rail and the pet
     show only the active account's agents and snapshot, so an unrestarted agent on the old account cannot
     overwrite the new one's numbers. The filter is in their shared model (`planDonuts`), not in
     `liveWindowAgents`, which the fleet brief also uses to count every live session whatever its account.
   - `pkg/claudequota` answers only while Default is active (decision 7); the frontend records its
     answer as `claude:default`, never under another account.
7. **`/api/oauth/usage` refuses a setup-token** (checked 2026-10-07 with a real token: `403`; the token's
   scope is inference only). So `claudequota` asks only for Default, with the `.credentials.json` token,
   and skips other accounts. Their numbers come only from agent reports: right after a switch the strip
   shows the new account's last snapshot with its age (the existing staleness rules already roll a
   window past its reset, so a reset window reads 0%), or nothing for an account never used, until an
   agent on it finishes a turn.

8. **Quota snapshots belong to the real account, not to "Default".** (Added 2026-10-07 after use.) Keyed by
   arcterm account id, Default's snapshot changed owner whenever `/login` changed: the user's mozox
   account hit its limit as the `/login` account, `/login` then moved to another account, and the new
   account's numbers overwrote mozox's, so the picker showed nothing for mozox while it sat at 100%. And a
   token account at its limit never finishes a turn, so it never reports on its own.
   - wavesrv reads the `/login` account's email from `oauthAccount.emailAddress` in Claude Code's config
     file (the file `claudequota` already reads) and returns it with the account list and with every
     quota answer.
   - A token account may carry an email (optional, picked when adding it or later on its row, from the
     emails arcterm has seen plus free text). A token account for an account that was once the `/login`
     one then shows that account's last snapshot.
   - Snapshots are keyed `claude:<email>` (lowercased) when the email is known, else `claude:<id>` for a
     token account with none, else `claude:default`. A live agent counts toward the active account when
     its account resolves to the same key, so a token account and Default naming the same email are one.
   - An existing `claude:default` snapshot moves to the `/login` email the first time it is known.
   - Not done: noting a 429 "usage limit" from an agent as "exhausted until reset" (filed in
     `docs/open-issues.md`).

9. **An agent's usage carries the account its process really runs on.** (Added 2026-10-07.) A Default
   agent started before a `/login` change keeps the previous account's token in memory but reported as
   "Default", so the strip showed that account's 94% for a `/login` account at 4%. At `SessionStart`
   (including a resume), `wsh agent-hook` reads the `/login` email from Claude Code's config file and sets
   it on the agent's block as `agent:loginemail`; a Default agent's usage resolves through that email,
   not the current `/login` one. A token agent keeps resolving through its arcterm account.
10. **A manual refresh.** The Plan usage strip and the Usage surface get a refresh button that asks the
    usage endpoint now (`RefreshClaudeQuotaCommand`), bypassing the 5-minute spacing but never a 429
    backoff, which the button reports as "thử lại lúc HH:MM". A live answer always beats Claude Code's
    cached copy in the config file, which any session, on any account, may have written.

## Settings UI

A "Claude account" section in `settingssurface.tsx`:

- A radio list: Default (/login) first, then each account by label. The active one is selected; picking
  another switches (decision 5's dialog).
- Each account row: label (editable), last known 5h / week % from its snapshot with its age ("chưa dùng"
  when there is none), Remove. The token is never shown.
- "+ Đăng nhập account" opens a dialog with a small live terminal running `claude setup-token`. The
  browser opens, the user signs in as the account to add and authorizes. arcterm watches the block's
  output for `sk-ant-oat01-[A-Za-z0-9_-]+`; on a match it stores the token, closes the terminal, and asks
  only for a label (default "Account N"). The user never copies the token. Closing the dialog first
  kills the command and stores nothing. The terminal lives in a helper tab marked `session:helper`,
  which the session sidebar skips, and the tab is closed on every exit path: its pty output (the
  `term` block file, which holds the token) is deleted with it. arcterm never runs the OAuth flow itself: that would mean
  posing as Claude Code's client on an unpublished API.
- "Dán token" (secondary): a disclosure in the Claude account section itself, not part of the sign-in
  dialog, holding a label field and a token field, for a token made elsewhere.
  Saving checks the shape only (`sk-ant-oat` prefix); a bad token surfaces as a 401 on the next claude
  run.
- Removing the active account switches to Default first.

A token works for model calls and is refused by the usage endpoint: checked 2026-10-07, `claude -p` ran
with it and `/api/oauth/usage` answered `403`.

## Testing

- Go: env apply/restore (Default restores the inherited value, including "unset"); secret naming;
  `claudequota` returning nothing while a non-Default account is active; `agentstatus` tagging from `ARC_CLAUDE_ACCOUNT`.
- vitest: `ratelimitstore` keying and the `"claude"` → `claude:default` migration; active-account
  filtering in the strip's model (`planDonuts`); the restart dialog's listing and pre-check rule as a pure
  function.
- CDP: a `settings-claude-account` scenario that opens the section with two fixture accounts and the
  switch dialog.

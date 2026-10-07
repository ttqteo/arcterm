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
6. **Quota is per account.**
   - `wsh agentstatus --usage` reads `ARC_CLAUDE_ACCOUNT` from its environment (inherited from the claude
     that runs the hook) and sends it as `AgentUsage.account` (new field in `pkg/baseds`; `task generate`).
   - `ratelimitstore` keys Claude snapshots `claude:<account>` (`claude:default` for Default; an existing
     `"claude"` snapshot migrates to `claude:default`). The Plan usage strip, the cockpit rail and
     `liveWindowAgents` show only the active account's agents and snapshot, so an unrestarted agent on
     the old account cannot overwrite the new one's numbers.
   - `pkg/claudequota` answers only while Default is active (decision 7); the frontend records its
     answer as `claude:default`, never under another account.
7. **`/api/oauth/usage` refuses a setup-token** (checked 2026-10-07 with a real token: `403`; the token's
   scope is inference only). So `claudequota` asks only for Default, with the `.credentials.json` token,
   and skips other accounts. Their numbers come only from agent reports: right after a switch the strip
   shows the new account's last snapshot with its age (the existing staleness rules already roll a
   window past its reset, so a reset window reads 0%), or nothing for an account never used, until an
   agent on it finishes a turn.

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
- "Dán token" (secondary, in the same dialog): label + token field, for a token made elsewhere.
  Saving checks the shape only (`sk-ant-oat` prefix); a bad token surfaces as a 401 on the next claude
  run.
- Removing the active account switches to Default first.

A token works for model calls and is refused by the usage endpoint: checked 2026-10-07, `claude -p` ran
with it and `/api/oauth/usage` answered `403`.

## Testing

- Go: env apply/restore (Default restores the inherited value, including "unset"); secret naming;
  `claudequota` returning nothing while a non-Default account is active; `agentstatus` tagging from `ARC_CLAUDE_ACCOUNT`.
- vitest: `ratelimitstore` keying and the `"claude"` → `claude:default` migration; active-account
  filtering in `liveWindowAgents` and the strip's model; the restart dialog's pre-check rule as a pure
  function.
- CDP: a `settings-claude-account` scenario that opens the section with two fixture accounts and the
  switch dialog.

# Claude account switch in Settings — design

Status: design settled 2026-10-07. One open check (decision 7) before the plan.

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
3. **Tokens live in `pkg/secretstore`** (`secrets.enc`), one secret per account,
   `CLAUDE_ACCOUNT_<id>`. `settings.json` holds only the non-secret part: `claude:accounts` (id, label)
   and `claude:activeaccount` (an id, or empty for Default). A token is write-only in the UI: pasted
   once, then shown masked; replacing it means pasting again.
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
   - `pkg/claudequota` asks with the active account's token (Default: the `.credentials.json` token, as
     now), and keeps its 5-minute throttle and 429 backoff per account, so a switch asks at once
     instead of waiting out the previous account's throttle.
7. **Open check: does `/api/oauth/usage` accept a setup-token?** The token's scope may be inference
   only. Check once by hand with a real token before writing the plan. If it is refused, `claudequota`
   skips non-Default accounts. Their numbers then come only from agent reports, and between sessions
   the strip shows the account's last snapshot with its age (the existing staleness rules already roll
   a window past its reset).

## Settings UI

A "Claude account" section in `settingssurface.tsx`:

- A radio list: Default (/login) first, then each account by label. The active one is selected; picking
  another switches (decision 5's dialog).
- Each account row: label (editable), masked token, last known 5h / week % from its snapshot, Remove.
- "Thêm account": label + token field, with one line on how to get a token (`claude setup-token` in any
  terminal, signed in as that account in the browser). Saving validates the shape only (non-empty,
  `sk-ant-oat` prefix); a bad token shows up as a 401 on the next claude run.
- Removing the active account switches to Default first.

## Testing

- Go: env apply/restore (Default restores the inherited value, including "unset"); secret naming;
  `claudequota` token choice and per-account throttle (the `Reader` already takes injected paths and
  clock); `agentstatus` tagging from `ARC_CLAUDE_ACCOUNT`.
- vitest: `ratelimitstore` keying and the `"claude"` → `claude:default` migration; active-account
  filtering in `liveWindowAgents` and the strip's model; the restart dialog's pre-check rule as a pure
  function.
- CDP: a `settings-claude-account` scenario that opens the section with two fixture accounts and the
  switch dialog.

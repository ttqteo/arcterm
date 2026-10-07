# Harness update notice and one-click update

Status: design agreed 2026-10-07. Not built.

## Problem

Claude Code ships often. Today the only way to learn a new version is out and to update it is to run `claude update` in
a terminal. The native installer has its own background updater, but it can be off (a legacy `autoUpdates: false` in
`~/.claude.json`, `DISABLE_AUTOUPDATER`) or stuck, and nothing in arcterm says so.

## Scope

Claude Code only at first. The catalog carries the field that makes a harness checkable, so pi, codex or opencode
join by filling it in and naming their update command. arcterm's own self-update stays deferred
(`docs/deferred.md`, "In-app auto-update").

## Design

### Latest version

- `harness.Spec` gains `NpmPackage` (claude: `@anthropic-ai/claude-code`). Claude Code publishes the same version
  numbers to npm as to its native channel.
- The latest version is `dist-tags.<channel>` from `https://registry.npmjs.org/<package>`, the channel being
  `autoUpdatesChannel` from `~/.claude/settings.json` (`latest` when unset, or `stable`).
- HTTP follows `pkg/claudequota`: a 10 s client, an endpoint seam for tests, failures logged and kept out of the UI.

### Check loop

- wavesrv checks at startup and every 6 hours, on the `pkg/wavevault/syncloop.go` pattern, started from
  `cmd/server/main-server.go`.
- The result is held in memory and returned as `HarnessInfo.latestversion` by `ListHarnessesCommand`, so the
  frontend needs no new read RPC.
- Setting `harness:updatecheck` (default true) turns the loop off; the request goes to a third party, so it can be
  refused.

### Notice

- When the latest version is newer than the installed one (`--version`, compared numerically), Jarvis says so once
  per version through `Event_Notify`, as `publishVaultNotice` does: "Claude Code 2.1.300 is out · Settings → About to
  update".
- The last version announced is persisted, so a restart does not repeat it.
- When Claude Code's own updater works this rarely fires: it is the safety net for when that updater is off or stuck.

### Update

- Settings → About lists each installed harness with its version. A harness with a newer version shows
  "2.1.300 available" and an **Update** button.
- The button calls a new `UpdateHarnessCommand{runtime}`: wavesrv runs the harness's update command
  (`claude update`) with a 5 minute timeout behind an exec seam, then probes `--version` again and returns the new
  version or the error with the command's last output line.
- The row reads "Updating…" while it runs, then "Updated to 2.1.300 · new sessions use it", or the error.
- Running agents are unaffected: the native updater renames the running `claude.exe` aside (`claude.exe.old.*`), so
  open sessions keep the old version and the next launch gets the new one. `claudeSupportsMods` is re-decided at the
  next app launch, when `install-agent-hooks` runs.

## Testing

- Go: numeric version comparison; `dist-tags` parsing through the endpoint seam, including a missing channel and a
  non-200; announce-once across a restart; the update command through the exec seam (success, failure, timeout).
- Frontend: a pure model of a harness row's state (installed, update available, updating, updated, failed) with a
  vitest beside it.
- UI: a CDP scenario that opens Settings → About with an injected newer version and shows the row and its button.

# Storage: see what arcterm leaves on disk, and clean it — design

Status: design settled 2026-10-08.

## Problem

arcterm and the agents it runs leave data behind, and nothing shows how much or offers to remove it. Measured
on the person's Mac on 2026-10-08:

| What | Size | Where |
|---|---|---|
| Build output of this repo | 3.4 GB | `src-tauri/target` (plus `node_modules`, `dist`) |
| Claude session transcripts | 490 MB | `~/.claude/projects` |
| Worktrees (a session's) | 152 MB | `.claude/worktrees` |
| Run worktrees | 52 MB | `<project>/.waveterm/worktrees` |
| arcterm's store | 43 MB | `<data>/db` (not cleanable) |
| Logs | 16 MB | `<data>/waveapp.log`, `waveapp.1.log` |
| `~/.arc`, WebKit caches | ~17 MB | `~/.arc`, `~/Library/Caches/dev.arc.app/WebKit` |

Some cleanup already exists: `pkg/sessiontrash` moves one ended session to `~/.arc/trash` and purges entries
after 7 days (`StartPurgeLoop`), the log rolls past 10 MB to one backup (`src-tauri/src/applog.rs`), and the
engine removes a merged task's worktree (`CleanupTaskWorktree`, with its cleanup debt). None of it is
visible, and none of it touches old sessions in bulk, leftover worktrees of finished runs, or build output.

## Goals

- A **Storage** section in Settings: per category, what it holds and how much, and a button that cleans it.
- Cleaning never removes what is in use, and never removes something unrecoverable without its own confirm.
- Safe categories clean themselves daily; when the cleanable total passes a threshold, arcterm says so.

Out of scope: restoring trashed sessions from the UI (by hand, as `pkg/sessiontrash` says), pi and other
runtimes' sessions, cleaning arcterm's store (`db`), build output outside the projects in config, Claude
Code's own worktrees under `.claude/worktrees` (Claude Code manages them; today's 152 MB one is removed by
hand), disk space of other apps, and a storage chip on the app bar (the person chose Settings).

## Decisions

1. **Settings → Storage.** A new section id `storage` in `settingssurface.tsx`. Its head reads `arcterm
   uses 4.1 GB · 3.7 GB can be cleaned`, with **Rescan** and the time of the last scan. Below, one card per
   category (decision 4), each with its size, one line on what it is, its items in a collapsible list, and
   its clean button. At the bottom, the auto-clean switch and threshold (decision 8) with the last auto-clean's
   time and what it reclaimed.

2. **Every clean confirms** in ConfirmModal, naming what goes and how much comes back. After it the card
   shows the new size and a toast says `Reclaimed 152 MB`. An item the server skipped stays listed with its
   reason beside it (`run still running`, `agent working in this project`).

3. **`pkg/storage` in `wavesrv`, one provider per category.** A provider has `Measure` (size, items) and
   `Clean(items, opts)` (removes what is safe, returns bytes reclaimed and items skipped with a reason).
   Every safety check runs again inside `Clean`, at the moment of removal; a scan's verdict is never trusted,
   because a run can restart or a session reopen between the two.

4. **Categories and their rules.**
   1. **Run worktrees.** The directories under `<project>/.waveterm/worktrees/` of every project in config
      (`projects`), each matched to its run and task in the store. Cleanable when the run is done, cancelled
      or failed **and** `git status --porcelain` in the worktree is empty; a directory no run claims counts as
      finished. Removed with the engine's `RemoveRunWorktree`, which keeps the branch, and the task's cleanup
      debt (`CleanupPending`, `CleanupError`) cleared. A finished worktree with uncommitted changes is left
      out of **Clean all** and auto-clean; its own row's button removes it after a confirm that says those
      changes are lost. A running run's worktree is never offered.
   2. **Old Claude sessions.** Transcripts `~/.claude/projects/*/*.jsonl` last modified more than N days ago,
      N picked on the card from 7, 30 (default) and 90, with the count and size for that N. **Move to trash**
      calls `pkg/sessiontrash` for each, so its rules hold: a session a live tab has as its transcript, or
      whose file changed in the last 2 minutes, is skipped with that reason. Claude sessions only.
   3. **Logs, cache and trash.** Rolled logs (`waveapp.1.log`; the live `waveapp.log` stays), the trash
      (`~/.arc/trash`, removed for good at once), and the webview's cache (macOS:
      `~/Library/Caches/<identifier>/WebKit/NetworkCache` and `CacheStorage`; Windows:
      `<data>/EBWebView/Default/Cache`, `Code Cache`, `GPUCache`). The cache is in use while the app runs, so
      its clean only writes a marker file, `<data>/clear-webview-cache`; at the next launch the host removes
      the cache directories and the marker **before** it creates the webview. The card says "cleared when
      arcterm next opens".
   4. **Build output.** Per project in config, directories up to three levels deep (enough for
      `src-tauri/target` and `frontend/node_modules`), not descending into a match, `.git` or
      `.waveterm/worktrees`. A directory qualifies only when all hold: its name is `node_modules`, `target`,
      `dist`, `build`, `.next` or `__pycache__`; a `target` sits beside a `Cargo.toml`; and
      `git check-ignore` says the project ignores it, so tracked files are never removed. Each project's row
      has its own button; there is no Clean all. A project with an agent in state `working` or a running run
      is refused, since removing output under a running build breaks it.

5. **Two RPCs and an event.** `GetStorageCommand` returns the last scan (per category: size, items with
   their ids, sizes and whether each is cleanable with its reason) plus the scan time and whether a scan is
   running. `CleanStorageCommand{category, itemids, olderthandays}` cleans and returns bytes reclaimed and the
   skipped items with reasons, then rescans. `RescanStorageCommand` starts a scan. A finished scan publishes a
   `storage:scan` event the section and the nudge listen to.

6. **Scanning runs in the background.** Walking `node_modules` or `target` takes seconds, so one goroutine
   scans and keeps the result in memory with its time. It runs at start (after a short delay), on Rescan,
   after every clean and after every auto-clean. Sizes are the summed sizes of files, not following symlinks.

7. **The pure model.** `frontend/app/view/agents/storagemodel.ts` orders the cards, joins skipped reasons to
   items, recomputes a card for the chosen N, and decides when to nudge (decision 8). `storagemodel.test.ts`
   covers it; the section's `.tsx` only draws.

8. **Auto-clean and nudge.** Two new settings in `wconfig`: `storage:autoclean` (bool, default true) and
   `storage:nudgegb` (number, default 2); `task generate` follows. With auto-clean on, `wavesrv` cleans at
   start and daily, beside `sessiontrash`'s purge loop: run worktrees that are finished and clean, and rolled
   logs older than 7 days (the trash already purges itself). It never auto-cleans sessions, build output,
   dirty worktrees or the webview cache. When a scan finds more than `storage:nudgegb` GB cleanable, the
   frontend shows an in-app toast, at most once a day, that opens Settings → Storage.

9. **Errors.** A category whose scan fails shows `Couldn't scan: <reason>` with a Rescan, and the other cards
   stand. A clean that removed part of its items reports what it reclaimed and lists the rest with reasons.
   An auto-clean failure goes to `waveapp.log` and to the "last auto-clean" line, never to a toast; the next
   day retries.

## Testing

- **Go, `pkg/storage`,** over temp directories and temp git repos: each provider's measure; the run worktree
  rules (done, running, dirty, orphan); `target` with and without `Cargo.toml`; a directory git does not
  ignore never qualifying; a project with a working agent refused; a live session skipped; the cache marker
  written and nothing else removed; auto-clean touching only its categories; a clean re-checking a rule that
  changed after the scan.
- **Rust, `src-tauri`:** the marker makes the host remove the cache directories and the marker before the
  webview, with temp directories (`cargo test`).
- **Vitest, `storagemodel.test.ts`:** card order, skipped reasons on items, the N switch, the nudge's
  threshold and once-a-day rule.
- **CDP:** a `settings-storage` scenario in `scripts/cdp/scenarios.mjs` opens Settings → Storage over fixture
  data; on a Mac the plan's Final guards it as AGENTS.md says.
- **By hand on the Mac:** a scan of this repo against `du`; cleaning the `memgate` worktree and the trash;
  the cache marker followed by a relaunch.

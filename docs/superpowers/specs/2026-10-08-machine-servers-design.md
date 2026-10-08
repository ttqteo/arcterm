# Servers on this machine: every listening process, who owns it, and stopping it — design

Status: design settled 2026-10-08; not built.

## Problem

The details rail's Servers section (`railservers.tsx`, `pkg/devservers`) lists only the processes listening in the
focused agent's project. Nothing in arcterm shows every server on the machine, so a stray one goes unnoticed. On
2026-10-08 an `astro dev` on `:4321` (`D:\Workspace\SIEM\apps\website`) had been running since 2026-10-05: a
background command of a Claude session that had since ended started it, the shell that launched it is gone, and
the person found it only because it showed up in an unrelated agent's rail.

The same day showed that the parent chain alone cannot tell who owns a server. The portal agent's live background
task "Restart built portal on 4310" runs `sh.exe → pnpm → node`, and that chain's root parent had already exited:
on Windows the process Claude Code spawns to start a background command exits while the command keeps running. The
`:8100` uvicorn of the same agent, started another way, chains up to `claude.exe` intact.

## Goals

- A chip in the footer counts the servers running inside a git repo and flags the ones nothing owns.
- Clicking it opens a popover listing **every** listening process the person's account can read, grouped by repo,
  each with a badge naming what it belongs to: an agent, a terminal, another app, or nothing.
- From a row: open a port in the browser, read its log (when an agent's background task started it), copy it, stop it.
- Polling stays cheap enough to run every 15 s.

Out of scope: UDP; the ports Docker forwards for containers (they show as `com.docker.backend`); a filter or search box;
a RAM column; notifications pushed when a new unowned server appears; stopping unowned servers automatically.

## Decisions

1. **A chip and a popover.** `MachineServersChip` sits in the footer's status group (`footerstatus.tsx`), before the
   RAM chip (`workercapacitychip.tsx`), which moved there from the app bar on 2026-10-08: a lucide icon and the count
   of servers inside a git repo (`4`). When any of them has no owner (decision 5) it reads
   `4 · 1 no owner`, the second part in the warning tone. With none in a repo it shows the icon alone, muted. Hover:
   a tooltip listing the repo servers' ports. Click: `MachineServersPanel`, a popover built like `ConsumersPanel`
   (`PopoverReveal`, rising from just above the footer's right end, DESIGN.md tokens only); `Esc`, a click outside
   or the chip again closes it. Opening it closes Consumers, and opening Consumers closes it.

2. **Scope: everything the account can read.** Every TCP listener whose process's command line can be read. One
   whose command line can't (System, services, another user's) is left out. One process on several ports is one row.

3. **Grouping.** A row's repo is the nearest directory at or above its cwd that holds `.git` (a directory, or a file
   for a worktree); lookups are cached by path. Rows with a repo are grouped under it, shown shortened
   (`SIEM/apps/portal`); groups holding a `no owner` row come first, then by name. Rows with no repo go in
   **Other**, collapsed by default to one line: `Other (9) Code, Docker, Orca…`.

4. **Rows.** As the rail's: each port (opens `http://localhost:<port>`), the command (full on hover), uptime; then
   the owner badge. On hover or focus: **Log** (decision 6), **Copy** (PID and command) and **Stop**, red, asking
   twice (`Stop?`), stopping the process tree through the existing `StopDevServerCommand`. On an `app` row the
   confirm names the app (`Stop VS Code?`), since it stops the app.

5. **Ownership: Go walks the chain, the frontend matches background tasks.** `devservers.Owner(chain, agents,
   terminals)` is pure. Walking up a listener's parents it returns the first that applies:
   - `agent` + block id: an ancestor is a live agent's process (`agentobserve.EnumerateAgents`);
   - `terminal` + block id: an ancestor is a terminal block's shell (`blockcontroller.GetBlockControllerPid`);
   - `app` + name: the chain reaches a session root (explorer, services, wininit; launchd on a Mac) intact, and the
     name is the exe of the highest ancestor below that root;
   - `detached` + `launchercmdline`: the chain breaks first, either at a parent that no longer exists or at one
     whose create time is later than its child's (the pid was reused). `launchercmdline` is the command line of the
     highest ancestor still alive.

   The frontend resolves `detached` rows: if a running background task of any agent in `backgroundTasksByIdAtom`
   matches the launcher command line, the way the rail's `matchLogTask` matches (`devserversmodel.ts`), the row
   belongs to that agent. Otherwise it is **no owner**.

   Badges: `claude · <agent name>` (click opens it through `openTarget`), `terminal · <tab name>` (click opens it),
   the app's name (no action), and `no owner` in the warning tone, with the tooltip *"Still running. No agent,
   terminal or open app holds it."* On the 2026-10-08 machine, `:4310` reads `claude · portal` and `:4321` reads
   `no owner`.

6. **Log.** Offered when the row belongs to an agent and one of that agent's running background tasks launched it,
   whether through the chain or through the match in decision 5. It opens the task's output file in that agent's
   File tab, following live, with the tab titled by the server's ports and command (the `FileRef.title` the rail
   now sets).

7. **One RPC.** `ListAllDevServersCommand` takes no arguments and returns `{servers}`: today's `devservers.Server`
   fields plus `repo`, `owner {kind, blockid, name}` and `launchercmdline`. It sits in `wshrpctypes_devservers.go`
   beside `ListDevServersCommand`; `task generate` writes the bindings.

8. **Reading cheaply.** `devservers.ListAll(ctx)`:
   - reads the TCP table once (`net.Connections`), and the pid → parent table from one toolhelp snapshot
     (`memusage.ReadTable`; gopsutil's per-process parent read took 11 s for 441 processes);
   - reads the command line, cwd, name and create time only of the listeners and their ancestors, and **caches them
     by (pid, create time)**: a process already read is not read again, and an entry whose pid has left the snapshot
     is dropped, so the cache stays at a few hundred entries. In steady state a poll is the TCP table and the
     snapshot, a few milliseconds;
   - is single-flight: a call that arrives while a read is under way gets that read's result.

   Nothing runs between polls: no goroutine, no watcher.

9. **Polling.** One store, `machineserversstore.ts`, serves chip and popover: every 15 s while the window is visible,
   every 3 s while the popover is open, never while the window is hidden.

10. **Pure model, thin view.** `machineservers.ts` turns the RPC result and the background tasks into groups, rows,
    badges, the chip's counts and each row's actions; `machineservers.test.ts` covers it. The chip and panel only draw.

11. **Errors.** A failed read of the TCP table: the chip shows its icon and `?`, muted; the popover shows the one line
    *"Could not read listening ports"* above the last reading, dimmed. A process that disappears mid-read is skipped.
    A Stop whose create time no longer matches is refused (`CheckStop`) with a toast, *"That process already
    exited"*, and the list refreshes.

## Prerequisite (done)

`extractBackgroundTasks` (`transcriptprojection.ts`) now reads a resumed session's orphan summary, which names
unfinished tasks only by `<task-id>`, so tasks a previous session left are no longer "running" forever. Decision 5's
match depends on that: without it the dead `:4310` task of the previous session matched the live server.

## Testing

- **Go, `pkg/devservers`:** `Owner` over fake chains: agent, terminal, app, a missing parent, a reused pid (parent
  newer than child), the launcher being the highest live ancestor; the repo lookup with `.git` as directory and as
  file, and no repo; unreadable processes left out; the cache reading a (pid, create time) once and dropping pids
  that left the snapshot; single-flight sharing one read.
- **Vitest, `machineservers.test.ts`:** grouping by repo, `no owner` groups first, Other collapsed with its names;
  the chip's count and `no owner` count; a `detached` row matched to a running background task (the `:4310` case:
  launcher `sh -c "pnpm run start"`, task `pnpm run start`) and left `no owner` when the task is stopped; Log only on
  agent-owned rows with a matching task; the `app` confirm naming the app.
- **CDP:** a `machine-servers` scenario in `scripts/cdp/scenarios.mjs` mocks `listalldevservers` the way
  `consumers-popover` mocks its RPCs, then shoots the chip (plain, with `no owner`, the error state) and the popover
  (groups, Other collapsed and expanded, each badge kind, a row's hover actions, the Stop confirm) and drives Esc, a
  click outside and the chip again. It runs on Windows; a Mac Final guards it as AGENTS.md says.
- **By hand, after the land:** the popover against `Get-NetTCPConnection -State Listen` on the person's machine.

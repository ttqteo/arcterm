# Dev servers in the agent rail — design

Status: design settled 2026-10-07.

## Problem

An agent starts and reuses servers the user cannot see. In the case that prompted this, a Claude agent
working on a website reported "Dev server (PID 29308) was already running, not from this session, so I
reused it on port 4321" — and nothing in the cockpit showed that server, its port, or how to stop it.
The rail's Background tasks section does not cover it: it is derived from the agent's own transcript
(`extractBackgroundTasks`), so it lists only commands *this session* ran with `run_in_background`. A
server started by an earlier session, by another agent, or by the user in a terminal is invisible, and
even one this session started shows as a command, not as "listening on :4321".

The user wants to see, per agent, which servers are running in its project, who started them, and to
open, read, copy and stop them from the rail.

Out of scope: every listening port on the machine (too noisy: databases, Docker, other apps); a live
log for a server this session did not start (there is no output file to read); pi and opencode agents
(the process anchor finds only `claude` processes — a later spec can extend the anchor); a badge in
the agent tree.

## Decisions

1. **Which servers belong to an agent.** A process that listens on a TCP port belongs to the agent's
   rail when either:
   - its working directory is inside the agent's project directory (case-insensitive, `\` and `/`
     treated alike on Windows), or
   - it descends from the agent's `claude` process.

   The RPC takes the project root from the rail (`railState.cwd`, the transcript's cwd) and the
   agent's block id. The root falls back to the agent process's cwd from `agentobserve.EnumerateAgents`
   (`ProcInfo.BlockID`, `.Cwd`, `.Pid`) when the rail has none, and the block id still finds the agent's
   process there, for `byAgent`. A process named `claude` / `claude.exe` is never listed (a Claude Code
   process may listen for IDE integration). A process whose working directory cannot be read (elevated,
   or exited mid-sweep) is skipped silently. Listening processes are read with
   `gopsutil/v4/net.Connections("tcp")`, status `LISTEN`; one PID listening on several ports is one row.

2. **Who started it.** `byAgent` is true when the process descends from this agent's `claude`
   process; otherwise the row reads "already running" (an earlier session, another agent, or the user).

3. **Backend: `pkg/devservers`.** `List(ctx, cwd, blockId)` returns rows of
   `{pid, createMs, ports[], name, cmdline, cwd, byAgent, launcherCmdline}`, where `launcherCmdline` is
   the command line of the `claude` process's direct child on the chain down to the server (for a
   background Bash call, the `bash -c "<command>"` that ran it); empty when not `byAgent`. The filtering
   and labelling are a pure function over an injected process list, so `go test` covers them without
   real ports. Exposed as wshrpc commands `ListDevServersCommand` and `StopDevServerCommand`
   (`task generate` after adding them).

4. **Stop kills the listener and its descendants, never its ancestors.** `StopDevServer(pid, createMs)`
   first checks that the PID's create time still matches, so a reused PID is never killed. It does not
   walk up: an ancestor whose working directory is in the project may be the user's own shell. Wrappers
   such as `pnpm` and `npm` exit when their child does.

5. **Polling, not a sweeper.** The rail calls `ListDevServers` every 5 s while the rail is visible
   (`railVisibleAtom`; the Servers section's own open state lives inside `CollapsibleRail`, out of the
   caller's reach), every 30 s otherwise so the strip count stays current, and not at all while the window
   is hidden (`document.hidden`). There is no backend goroutine sweeping for every agent: it would cost
   CPU while nobody looks. A failed call shows one line, "Could not read listening ports", and keeps the
   last result.

6. **Rail placement.** A new stat id `servers` joins `AgentRailStatId`, counted in the tab strip
   directly before `bgtasks`, and its section sits directly before Background tasks. It follows the
   rail's existing rule (`agentrailsections.ts`): the strip counts it whether or not it is empty, so the
   rail keeps one shape; the body lists the section only when the count is above zero.

7. **A row.**

   ```
   ●  :4321  astro dev                        2h 14m
      PID 29308 · already running
   ```

   - The dot means listening. Several ports read `:4321 :24678`.
   - The label is the command line shortened (`node …\astro\astro.js dev` → `astro dev`); hovering shows
     it in full.
   - The second line is the PID, who started it ("this agent" or "already running"), and the uptime
     from `createMs`.

8. **Row actions.**

   | Action | Behaviour |
   |---|---|
   | Open | Clicking a port opens `http://localhost:<port>` with `getApi().openExternal`. |
   | Log | Shown only when a background task matches (decision 9): opens its output file in the panel's File tab with Live on, as Background tasks already does. |
   | Copy | Copies `PID <pid>` and the full command line. |
   | Stop | First click turns the button into "Stop?"; a second click within 3 s stops it. No dialog. The row leaves the list at once; the next poll confirms it. |

9. **Matching a server to its log.** A running background task of this agent matches a row when the
   row is `byAgent` and `task.command` is a substring of `launcherCmdline`. No match, no Log button —
   the rail has no way to read the output of a server it did not start.

10. **Code layout.** Pure logic — label shortening, log matching, uptime formatting — lives in
    `frontend/app/view/agents/devserversmodel.ts` with `devserversmodel.test.ts` beside it; the store and
    polling in a small `devserversstore.ts`; `agentdetailsrail.tsx` only renders.

## Testing

- `go test ./pkg/devservers/...`: the filter (cwd inside project, descendant of the agent, neither),
  the `byAgent` label, port grouping, `launcherCmdline`, and the create-time check before a stop.
- vitest: `devserversmodel.test.ts` and `agentrailsections.test.ts` (the new stat and its order).
- CDP scenario `rail-servers` in `scripts/cdp/scenarios.mjs`, on real processes: a `node dev-server.js` HTTP
  server run in the fixture agent's project directory (listed by its cwd, "already running"), and `node` under
  the name `claude` that carries the fixture agent's `WAVETERM_BLOCKID` and runs a second server from a
  directory outside the project (listed only as the agent's descendant, "this agent"), whose command the
  fixture transcript ran in the background, so its row has a Log button. It shoots the rail, then drives the
  rows: a port opens `http://localhost:<port>`, Copy writes the PID and command line, a failed poll puts the
  muted line over the rows it kept, Stop asks `Stop?` and then ends the process, and Log opens the output
  file in the rail's panel. Teardown ends every process it started.

# Held services: arcterm keeps a pinned app's server running

> **Superseded in part 2026-10-20** by `2026-10-20-services-sleep-design.md`: `autostart` now defaults to false and
> reads "Keep running"; a service without it sleeps ten minutes after it leaves the screen and starts when shown.

A pinned app today is a terminal plus a page (`frontend/app/view/agents/appmodel.ts`): opening the tool types its
command into a shell (`cmd:firstcommand`), the frontend probes the fixed `url` from `tools.json`, and the page shows in
the terminal's place. The server lives and dies with that terminal tab, its state is frontend-only (`appStatesAtom` in
`appstore.ts`), nothing starts it again after arcterm restarts, and the port has to be written down in advance.

This design makes arcterm the place that holds those servers: wavesrv starts them, keeps them running, restarts them
when they crash, gives them a port, starts them again when arcterm opens, and the cockpit shows their state everywhere.
The idea comes from claudecodeui's plugin servers (`server/utils/plugin-process-manager.js` there: the host spawns each
plugin's server, learns its port, starts the enabled ones at boot and stops them all at shutdown).

## Decisions taken with the person

- **arcterm holds the service.** A service is a child of wavesrv: it dies when arcterm quits and starts again when
  arcterm opens. Not launchd, not pm2. (A `task install` restarts every service for a few seconds; accepted.)
- **Any app run by one command.** The portfolio-journal dashboard (`npm run dash`, port 8386), project dev servers
  (Next, Vite) and claudecodeui are the examples, so nothing is specific to one app.
- **The UI is A + B on the canvas:** services live in the Agent tree's project folders with Restart and Stop in the
  page header (A), and a Services chip in the app bar opens a popover listing every service (B). The canvas is
  `.superpowers/design/held-services/` (gitignored; boards `Main`, `AppBarServices`, `RowStates`).

## Goals

- A service runs without any tab or surface open, and its state is right whether or not the UI is looking.
- Start, Stop and Restart from the tree row, the page header and the popover.
- A crash is seen from any surface (the chip turns red) and retried on its own, a few times.
- arcterm gives a service its port, so most apps need no port written down.
- Services marked "Start with arcterm" are running again after arcterm restarts.

## Non-goals

- Becoming pm2: no cluster mode, schedules, deploys, log files or rotation. The log is the terminal's scrollback.
- Services that outlive arcterm, or access from a phone.
- A `wsh services` command, and adopting the dev servers agents start on their own (`pkg/devservers`, the details
  rail's Servers). Both are later steps.
- Windows-specific work. The Mac is the one machine; shared code paths that already handle Windows (job-object kill)
  keep working, nothing more.

## Anti-goals (a failure even if it works)

- A service that dies and nothing says so.
- arcterm stopping a server it did not start.
- A `node` child left holding the port after Stop or Restart (`npm run dash` spawns one).
- Polling that costs CPU or RAM while services run.
- arcterm editing the person's `tools.json` on its own: the remembered port and the Stop flag live in arcterm's own
  store. The person's own edits are the Setup → Tools form and the tree menu's "Start with arcterm" check.

## What a service is

A tool with a page. In `tools.json` (`pkg/wconfig/settingsconfig.go` `ToolKeywords`) that is either of:

- `url`, as today: the page at a fixed port, e.g. `http://127.0.0.1:8386/`.
- `"port": "auto"` (new): arcterm picks the port; the page is `http://127.0.0.1:<port>/`. `url` wins if both are set.

and one new optional key:

- `autostart` (bool, default **true** for a service): "Start with arcterm".

`ToolKeywords` feeds generated types, so `task generate` follows. A tool without a page stays a plain tool, unchanged.

## Lifecycle (wavesrv)

A new Go package (name left to the builder) supervises services.

- **One terminal block per service**, created the first time it starts or is shown, and kept after. Controller `cmd`
  (not `shell` plus `cmd:firstcommand`, which is cleared once typed and so cannot restart, `firstcommand.go:87-89`):
  `cmd` is the tool's command and args, `cmd:cwd` its folder (`dir`, else Home: with no focused agent and no project,
  that is where `opensin` resolves today), `tool:id` the tool, and `cmd:runonstart` false, so a pane that mounts the
  log never starts it. Stop never closes it; the terminal's scrollback is the log.
- **Its tab.** wavesrv creates the tab and the block itself (`wcore.CreateTab`, `pkg/wcore/workspace.go:200`, in the
  client's workspace) when the service has none, so a boot start needs no surface open. The tab carries `tool:id` and
  `session:project`. The tree lists it once, as the service row, never also as a terminal row. If the tab or block is
  closed some other way, that counts as Stop, and the next Start creates a new one. *(Builder check; our call.)*
- **Shell and PATH.** The command runs through the shell (`cmd:shell`, default true, which quotes the args as
  `shellcontroller.go:780-800` does) with the PATH the Tauri host took from the login shell (`src-tauri/src/shellenv.rs`),
  so `npm` from nvm or Homebrew resolves as it does in a tool terminal today. *(Builder check; answered by the code.)*
- **The log stays a live terminal**, so a dev server's own keys (Vite's `r`, `o`, `q`) work. An exit the person caused
  there (a Ctrl+C typed in the log, or a clean exit 0) is a Stop, not a crash; how to tell is the builder's (e.g. the
  controller saw `^C` written to the PTY just before the exit). *(Builder check; our call.)*
- **Environment.** The process gets `PORT=<port>` through the block meta `cmd:env`, which the controller already layers
  into the process environment (`resolveEnvMap`, `pkg/blockcontroller/shellcontroller.go:806`, block meta at :829).
- **Start** ensures the block and calls `ResyncController` with force, which works with no frontend involved
  (`blockcontroller.go:214`; `RestoreLiveAgents` at `cmd/server/main-server.go:526` is the precedent).
- **Stop** marks the service stopped by the person, stops the controller gracefully, then runs the same sweep block
  close runs on a Mac (`stopLeftovers`, `pkg/blockcontroller/leftovers_darwin.go:33`: every process still carrying the
  block's `WAVETERM_BLOCKID` gets SIGTERM, then SIGKILL). Today the kill reaches only the child's pid
  (`shellexec/conninterface.go:107-133`), so without the sweep the `node` under `npm` survives.
- **Restart** is Stop then Start.
- **Crash**: the controller reports done (`Event_ControllerStatus`, `ShellProcExitCode`) while the service was not
  stopped by the person. arcterm waits and starts it again: 1 s, 2 s, 4 s, 8 s, 16 s. After 5 crashes within 10 minutes
  it gives up and the service stays crashed until the person restarts it. Ten minutes up resets the count.
- **Boot**: once wavesrv is up, every service with `autostart` starts, staggered like `RestoreLiveAgents` (300 ms),
  except one the person stopped. Services with `autostart` off stay stopped whatever they were before.
- **A Stop is remembered** (the person's call): arcterm keeps a per-service "stopped by the person" flag in its own
  store, never in `tools.json`. Any Stop sets it (row, header, popover, a Ctrl+C in the log); Start and Restart clear
  it. A service that crashed and gave up is not stopped by the person, so the next boot tries it again.
- **Shutdown**: `StopAllBlockControllersForShutdown` already stops them. That is not a crash.
- **Leftovers from an arcterm that died** (a wavesrv crash, a `kill -9`): at boot, before starting a service, arcterm
  runs the `WAVETERM_BLOCKID` sweep for that service's block, so its own old server is stopped rather than read as
  running elsewhere. *(Builder check; our call.)*
- **The entry changes**: the supervisor watches `tools.json` (the `wconfig` file watcher). A change to a running
  service's command, args, folder, `url` or `port` restarts it; a change to its name, purpose or `autostart` does not.
  Removing the entry stops the service, closes its tab and forgets a Stop (the remembered port stays). A new entry with `autostart` starts as soon as it is added.
  *(Builder check; our call.)*
- **Running elsewhere**: before starting a service with a fixed port, arcterm probes its page. If it already answers
  (pm2 or a terminal runs it), arcterm starts nothing, shows the page, and Stop is not offered: today's `owned: false`.
  Start stays offered: it probes again, nothing changes while the page answers, and once it no longer does arcterm
  starts the service. Nothing probes on its own.
- **Readiness** moves from the frontend (`appstore.ts:100-133`) to wavesrv: an HTTP GET of the page, any response
  counts, 1.5 s timeout, every 500 ms, up to 30 s. It runs only while a service starts. While it runs, nothing polls;
  a crash is the process exiting.

## Port

- `url` set: the port is fixed. arcterm still sets `PORT` to it, which helps apps that read it.
- `port: "auto"`: arcterm picks a free port on 127.0.0.1, remembers it per tool in its own store (never in
  `tools.json`), and reuses it on later starts while it is free, so the page keeps its address.
- Log fallback: when the page does not answer on that port and the output has printed a local URL
  (`http://127.0.0.1:N`, `http://localhost:N`, `http://0.0.0.0:N`), arcterm switches to N and remembers it. Vite
  ignores `PORT` and prints its URL; Next reads `PORT`.
- Port taken: a fixed port held by a process that does not answer as the page. The row names the holder when
  `pkg/devservers` can (it lists listeners by process).
- Known limit: arcterm embeds only `http://127.0.0.1:*` (`arctools.AppURL`, the CSP's frame-src). A server that listens
  only on `::1` cannot be shown; it reads "no page".

## States

One pure state model in Go (with tests), sent to the frontend by a wshrpc status command plus an event on every change.
Each state is a word plus a dot, never color alone (board `RowStates`):

| State | Words in the row | Dot |
|---|---|---|
| stopped | stopped | hollow, muted |
| starting | starting… | green, pulsing |
| running | `:8386` | green |
| elsewhere | not started by arcterm, `:8386` | hollow green |
| retrying | crashed · retry in 8s | red |
| crashed (gave up) | crashed · exit 1, with Restart | red |
| port taken | 8386 is held by another program | amber |
| no page | running, no page after 30s | amber |

Start, Stop and Restart are wshrpc commands; "Start with arcterm" is written through the existing
`ToolsSetUserCommand`.

## UI A: the Agent tree and the page header (board `Main`)

- Every configured service has a row in its project's folder, whatever its state, below the divider and above the
  plain terminals. Its project is the registered project its folder is in, else Home (`appProjectName` in
  `appmodel.ts`). Unlike a terminal, the row does not come and go with a tab.
- The row is today's `TerminalRow` (`agenttree.tsx:2006`) with the app icon, the state words or port, and the dot.
  Hover shows the one action that fits: Start when stopped, Restart when crashed. Its menu: Start / Stop / Restart,
  Open in the browser, Start with arcterm (a check), Edit in Setup → Tools.
- A click shows the service in the centre: the page when running, the log otherwise. It never starts it: a service
  that never ran gets its tab and block at that click, not started, and the header offers Start.
- The header (`terminalpaneheadview.tsx`) keeps Page | Log, Back, Forward, Home and Open in the browser, and adds the
  state line ("Running on 127.0.0.1:8386 · up 2h 14m"), a Restart button, and Stop (or Start when stopped). A service
  has no close button: it stays in the tree, and selecting another row leaves it.

## UI B: the Services chip and popover (board `AppBarServices`)

- A chip beside the Jobs chip (`cockpit/jobqueuechip.tsx`), in the same style, hidden when no service is configured.
  It shows the running count; "· N crashed" in the error token when any is retrying or crashed; the warning token when
  any has port taken or no page and none crashed.
- Its popover follows the Jobs popover (`jobqueuepanel.tsx`): every service, those that need the person first
  (crashed, then amber), then running, then stopped. A row: dot, name, project, then its state words or port and time
  up, and on hover its actions (Log, Restart, Start, Stop, Open); a second line gives the command (mono) and its
  folder. The footer: "A tool with a page is a service. Add one in Setup → Tools." A click on a row opens the service
  in the Agent centre through the one router (`frontend/app/view/jarvis/openref.ts`). Keyboard as in the Jobs popover.

## Setup → Tools

- The Page field (detail `SettingRow` "Page", add form `tool-url`, `toolslibrary.tsx`) gains a way to say "pick a free
  port", saved as `port: "auto"`.
- A tool with a page gains a "Start with arcterm" toggle, on by default.

## What happens to today's pinned apps

- A tool with `url` becomes a service, with `autostart` on unless set. The person's `portfolio` entry is one.
- The frontend probe loop and the `owned` logic in `appstore.ts` give way to the service state. The page frame and its
  out-of-sight keep-alive (`apppane.tsx`, `APP_FRAME_IDLE_MS`) stay.

## RAM

arcterm's own cost per service is one PTY and a goroutine, and a probe only while it starts. The service's RAM is the
app's own. With `autostart`, that RAM is spent whenever arcterm is open: that is why the toggle is per service. The RAM
table in `docs/open-issues.md` gets a row.

## Verification

- Go: the state machine and the backoff, port picking and remembering, the log URL scan, and one test that starts a
  real small server command through the supervisor and stops it with its child.
- Frontend: pure models with vitest beside them: row words from a state, the chip's summary, the popover's order.
- CDP scenarios in `scripts/cdp/scenarios.mjs`: one for the tree rows in their states and the page header, one for
  the chip and the open popover. They run on a Mac in headless Chrome (`task dev:browser`). The canvas is the visual
  spec: a plan points its `**Prototype:**` line at it.
- `CHANGELOG.md` gets one Added line.

## Left to the builder

- Package, type and RPC names; where the remembered port is stored.
- The control that says "pick a free port" in Setup → Tools.
- What to do with a pinned-app terminal opened before this change: leave it as a plain terminal or close it, but never
  stop a server it runs without the person.
- How "port taken" finds the holder, and the exact backoff numbers within the shape above.

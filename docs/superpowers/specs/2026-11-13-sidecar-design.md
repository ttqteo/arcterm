# Sidecar: a Cockpit wall on a second screen

Status: design, 2026-11-13. Brainstorm: `.superpowers/brainstorm/cockpit-window/brainstorm.json`. Boards:
`.superpowers/design/cockpit-window/project/` (`D-fit-by-count.dc.html`, `E-strain-band.dc.html`).

## Goal

Use two or more screens fully: the main arcterm window holds the agents' terminals on one screen, and **Sidecar**, a
second window, shows every agent at once on another. What matters is seeing many agents at a glance. Sidecar is a
companion of the main window, not a second app: one view (a wall of agent tiles), no Office, no other surface, no
terminal.

## What was measured (prototype, dev build, 1920×1080, 12 fixture agents)

| Build of the second window | Renderer (private) | GPU process added | JS heap |
|---|---|---|---|
| Whole app loaded, Agent surface left out | 304 MB with no agents; 450–630 MB with 12; 720 MB after ~15 min on screen | +30–60 MB | 122–137 MB |
| Slim page fed a snapshot (this design) | 60 MB at open, 65–68 MB after 2 min, flat | +10–19 MB | 6 MB |

- The browser, network and storage processes are shared by every window of one WebView2 environment; a window adds
  only its renderer and some GPU memory. Closing the window frees its renderer.
- Leaving the xterms out saved almost nothing: the cost of the first build was the whole app.
- The main Cockpit's renderer grows while it is on screen (430 → 720 MB in ~15 min) and drops back when hidden
  (`display:none` → 425 MB in 25 s); the main window grows the same way (to 946 MB). That is a separate defect of the
  Cockpit view (suspects: the 12 fps PulseDriver, animations) and goes into `docs/open-issues.md` "RAM watch". Sidecar
  stays on screen all day, so it must not repeat it: nothing on Sidecar animates.
- wavesrv keys every websocket by its `stableid` and replaces a connection that reuses one (`pkg/web/ws.go`
  `registerConn`); a window that boots the app on the main window's tab route steals its connection. The slim page
  never connects, so this does not arise.
- `frontend/tauri/tailwind.css` scans only `../app` and `../layout`, so classes used only in `frontend/tauri/*.tsx`
  are never generated. The tray popover works only because its classes also appear in `frontend/app`. Add
  `@source "./*.tsx";`.

## Decisions

### 1. The window

- Built by the Tauri host (`src-tauri/src/sidecar.rs`) as label `sidecar`, page `sidecar.html`, `decorations(false)`
  (the page draws its own title bar, like the main window), `min_inner_size(1100, 700)` logical px. A Ctrl+P row,
  "Open Sidecar", invokes a Tauri command that opens it or brings it forward.
- First open: on a screen other than the main window's when there is one (positioned in physical px after the build,
  since screens of different scale make a logical position ambiguous), then maximized; with one screen, centred.
- F11, or the full-screen button on its title bar, toggles full screen on the screen it is on (verified in the
  prototype: 1920×1080).
- It closes when the main window is destroyed (it would otherwise keep the app running with no terminals to open its
  agents in). A main window hidden to the tray icon leaves it open.
- **Reopens as last time:** if Sidecar was open when arcterm closed, the next launch reopens it on the same screen, at
  the same position and size, full screen if it was. Persist it the way `src-tauri/src/winframe.rs` keeps the main
  window's frame (`restore_and_track`, `save`). If the remembered screen is gone, open it on the main screen.
- Its own capability file (`src-tauri/capabilities/sidecar.json`): `core:event:default` plus the window permissions
  its title bar uses (start-dragging, minimize, toggle-maximize, close, set-fullscreen, is-fullscreen). Nothing else.

### 2. How it is built: a slim page fed a snapshot

Like the tray popover (`frontend/tauri/tray.tsx`, `frontend/app/cockpit/traybridge.tsx`): Sidecar's page never boots
the cockpit, the wsh client or WOS, and keeps no store.

- `frontend/tauri/sidecar.html` + `sidecar.tsx`: the page; a third Vite input beside `index.html` and `tray.html`
  (`frontend/tauri/vite.config.ts`).
- `frontend/app/cockpit/sidecartypes.ts`: the plain-data contract (it crosses a Tauri event).
- `frontend/app/cockpit/sidecarsnapshot.ts` (+ `.test.ts`): pure, roster → snapshot.
- `frontend/app/cockpit/sidecarbridge.tsx`: mounted once in the cockpit shell (`cockpitshell.tsx`, beside
  `TrayBridge`). It emits `sidecar:snapshot` whenever the roster or the agents' recent messages change, answers a
  page's `hello` with a snapshot, and carries out each `sidecar:act`.
- Acts: `hello`; `open` (focus the agent in the main window: set `focusIdAtom`, `showTerminal()`, surface `agent`,
  raise the main window); `answer` (the first question's option, via `answerAgentAsk` in `askanswer.ts`); `older`
  (scrollback, below); the band's actions (below).
- The snapshot ages nothing itself: it carries the main window's `now`, and the page redraws its ages every 30 s.

### 3. The wall

- One tile per agent; plain terminals and tools are left out. Order: waiting on you, working, ready for review (idle
  with uncommitted or committed changes), idle, asleep. Idle and asleep tiles are dimmed.
- A tile: status dot, name, age in its state, project · runtime and model; then its recent messages, newest at the
  bottom; then, for an ask, the amber WAITING ON YOU band, the question and its options as buttons 1–9 (an ask with
  several questions or a multi-select is answered in the main window: Enter); otherwise a context bar (`ctx 61%`).
- A message is what the agent said plus the tool it ran: outcome (✓ / ✕), verb and target (`RAN go test ./pkg/x`),
  the target in mono. For an agent the main window streams (asking, working, idle under 5 min, or focused:
  `streamableTranscriptAgents`), the data is `liveEntriesByIdAtom` (`livetranscriptatoms.ts`). **Agent's call
  (builder question 1):** Sidecar never makes the main window stream more agents. An agent that is not streamed (idle
  past 5 min, asleep) gets a one-time read of the tail of its transcript, enough for its last 2 messages, taken when
  its stream stops (`dropLiveId` clears its live entries) or when Sidecar first sees it, and kept in the bridge as
  those few messages only; a tile never shows its messages vanish.
- Keys: arrows move the selection, Enter opens the selected agent in the main window, 1–9 answers its ask, F11 full
  screen. Double-click opens. A footer lists them.
- **Tiles fit the agent count** (board `D-fit-by-count.dc.html`): the wall always fills one screen without a page
  scroll; columns, rows and messages per tile follow the count and the window size. At 1920×1080: 4 agents → 2×2, ~6
  messages per tile; 12 → 4×3, 2 messages; 20 → 5×4, 1 message. The shape is a pure function (window size, count →
  columns, rows, messages per tile) with tests. Past the count where a tile would drop below a readable size, the
  wall keeps that size and scrolls.
- **Scrollback:** a tile shows 1–2 recent messages (more when the tile is tall). Scrolling up inside a tile loads
  earlier messages lazily: the page sends `older { id, before, count }`, the bridge answers from the entries the main
  window holds (up to 4,000 lines per agent, `livetranscript.ts` `MAX_RETAINED_LINES`; a pi session in full), and the
  page keeps only what is on screen, dropping a tile's loaded history when it scrolls back to the bottom. For an agent
  that is not streamed, `older` reads the next page from its transcript file on demand and keeps nothing after.

### 4. The strain band (RAM and CPU)

Board `E-strain-band.dc.html`. When many agents strain the machine's RAM or CPU, Sidecar warns. Not tokens, not
battery.

- Always shown, small, on Sidecar's title bar: RAM free and the machine's CPU %.
- One general band at the top of the wall when the machine is strained: amber when strained, red when it is about to
  run out of memory. It says what is strained and since when (`RAM high for 3 min (2.1 GB free of 32 GB) · CPU over 90%
  for 2 min · 7 agents working, 2 heavy jobs running`), then the 2–3 heaviest agents, each with its weight, its
  heaviest process, and its actions (see "Actions on a heavy agent" below). **Agent's call (builder question 2):** no
  band-wide action. The board's "Pause heavy jobs for 15 min" is dropped: `jobs:pauseuntil` turns the queue off
  (`pkg/jobqueue/jobqueue.go`: "before it the queue runs as ModeOff"), which would start every queued heavy job at
  once, the opposite of what a strained machine needs; the queue's `auto` mode already holds heavy jobs until their RAM
  fits. An × hides the band until its level changes. No sound.
- **Actions on a heavy agent (builder question 3, the person's answer):** two buttons. **Stop** stops the agent's
  heaviest process, the one the band names, as the tray's Free up does (`StopProcessCommand`, `traybridge.tsx`
  `stop`), after a confirmation in place on the tile row ("Stop `node next build`? The agent's build ends; the agent
  keeps running." with Stop and Cancel); a refusal (the process already exited, or is no longer under the agent) shows
  as the row's note. **Sleep agent** (`AgentsSleepCommand`, `agentsleep.ts`) frees the whole agent's RAM and keeps
  its conversation. There is no Skip: `JobQueueSkipCommand` drops only a job still queued, and the band names running
  processes. The board's "Skip the build" button is replaced by Stop.
- When: amber when wavesrv's memory pressure (the `memorypressure` event, i.e. the OS's own level) is `high`, or the
  machine's CPU is over 90% for 2 minutes straight; red when the pressure is `critical`. The band clears once it has
  been under its threshold for 30 s, so it never flickers. The rules are a pure model with tests.
- **Who is heaviest:** by RAM when the band is up for RAM, by CPU when it is up for CPU. RAM per agent is the existing
  consumers reading (`GetConsumersCommand`, `pkg/memusage`: each agent's process tree and its heaviest process).
  **Agent's call (builder question 4): CPU per agent reuses `pkg/resmon` on Windows.** resmon already samples each
  agent's CPU (processes grouped by job object and owner block, CPU deltas between samples, its own 80%-over-3-samples
  busy rule in `group.go`), polled by the main window every 2 s while it is visible (`resmonstore.ts`,
  `RESMON_POLL_MS`). A second sampler over `pkg/memusage` trees would give two CPU figures per agent that can
  disagree. resmon answers `supported:false` elsewhere, so a macOS sampler is the only new Go: it fills the same
  per-agent CPU figure that resmon's snapshot carries, so the band reads one shape on both platforms, and it runs only
  while the band shows. The RAM reading likewise runs only while the band shows; the machine figures on the title bar
  come from what the main window already polls or receives.
- The bridge in the main window reads the machine and the per-agent figures and puts them in the snapshot; the page
  stays storeless.

### 5. RAM budget

Sidecar costs at most **100 MB** private (its renderer plus what it adds to the GPU process) with 12 agents, and holds
there after a day on screen. The prototype measured ~80 MB on a dev build. Measure it again on a release build
(`task tauri:build`), add the figures to `docs/open-issues.md` "RAM watch", and do not merge over budget.

## Testing

- Vitest, beside each pure file: the snapshot (order, review state, terminals left out, ask options, runtime label),
  the wall shape function, the band's rules (thresholds, the 2-minute CPU window, the 30 s clear, hide until the level
  changes), and the scrollback paging.
- Go: the macOS per-agent CPU sampler on a fake process table, like `pkg/memusage/heaviest_test.go`; on Windows the
  band reads resmon, whose grouping is already tested (`pkg/resmon/group_test.go`).
- Vitest for the transcript-tail read of an agent that is not streamed (last 2 messages, kept after its stream stops).
- A CDP scenario (`scripts/cdp/scenarios.mjs`) that opens Sidecar through the host and screenshots its page with a
  fixture roster (4, 12 and 20 agents) and with the band at amber and red. Sidecar's page is a separate CDP target on
  the same port (the prototype's `cdpeval` found it by its `sidecar.html` url). It needs the Tauri host: mark it
  `host: true`.
- Measure RAM as above before merging.

## Out of scope

- Office, Jarvis or any other surface on Sidecar; a terminal on Sidecar.
- Token burn warnings (the 5-hour window): `pkg/tokengate` already gates costly spawns.
- An app bar button or a dedicated shortcut for Sidecar: Ctrl+P and the reopen cover it.
- Fixing the main Cockpit's on-screen growth (logged in RAM watch; a separate fix).

## Left to the builder

- The Ctrl+P row's wording.
- How the macOS sampler reads a process tree's CPU time, and its sampling interval.
- Scrolling back past what the main window holds (4,000 lines): read on from wavesrv, or stop there.
- The smallest readable tile, past which the wall scrolls (more than ~20 agents).
- The CDP scenario's fixtures.

# Menu bar and tray popover

arcterm gets an icon in the macOS menu bar and the Windows tray. Clicking it opens a small popover with the
machine's state: memory, CPU and disk, what arcterm holds of each, the heavy-job queue, what waits on you, and
Claude's 5-hour window. Its two subpages free memory and disk for real: they stop a command or clean what arcterm
left behind. You can see why the Mac is slow, and act on it, without bringing the cockpit forward. The person asked
for it after looking at CleanMyMac's menu: "the compact part of the machine, with this."

Prototype: `.superpowers/design/tray-popover/project/` (gitignored). Every board
is a state the built popover reaches:

- `Main`: macOS, memory pressure high, one job running, one queued, four items waiting.
- `A-FreeUp`: the Free up subpage.
- `A-Storage`: the Clean up subpage.
- `A-Quiet`: normal pressure, no jobs, nothing waiting, no count on the icon.
- `A-Critical`: pressure critical, a red dot beside the count.
- `A-PausedHot`: the queue paused, Claude's 5h at 91%.
- `A-Offline`: wavesrv not answering.
- `Win-Main`: Windows, the popover above the taskbar.

## Decisions

### The icon

- **One icon on both platforms**, built with Tauri's tray API (the `tray-icon` feature of the `tauri` crate, built
  in `.setup` from a new `src-tauri/src/tray.rs`).
  - A left click opens or closes the popover.
  - A right click opens a native menu: **Open arcterm** and **Quit arcterm**.
  - Linux has no packaging here and gets no tray.
- **The glyph is the "t>" mark**, drawn pixel-exact at runtime from its 12×9 grid by `src-tauri/src/trayicon.rs`
  (cells mirrored from `scripts/gen-app-icon.mjs`), so the badge, the dot and the dimming compose onto it without a
  PNG per state. Never downscale `public/logos/arcterm.png`.
  - macOS: a template image 18 pt high (4 px per cell, 48×36), so the system tints it for light and dark menu bars.
  - Windows: a white glyph on transparent, square at the tray's size for the monitor's scale (16, 20, 24 or 32 px).
- **The count is what waits on you:** `queueRows(attentionAtom, agents, channelMessages).length`, the number Sprout
  wears (`useWaitingCount`, `view/jarvis/petview.tsx`).
  - On macOS it is the status item's title beside the glyph (`set_title`).
  - Windows has no tray title, so the count is drawn into the icon as the needs-you badge: an amber circle with
    `on-warning` text, holding 1–9 or 9+, drawn by `trayicon.rs` like the glyph.
  - At 0 the title is empty and the icon has no badge.
- **Memory pressure critical adds a red dot** beside the count (board `A-Critical`), so the icon alone tells you the
  machine is about to stall.
  - macOS tints a template image whole, so the dot cannot sit in the glyph. Task 4 sets the status item's
    attributed title: a red `●` before the count, through AppKit as `macwindow.rs` already does. On Windows the dot
    is drawn into the icon.
  - If the attributed title cannot be built, the title reads `! 4`.
- **Offline dims the glyph** to 45% and drops the count (board `A-Offline`). The host sets this itself when wavesrv's
  stderr closes (`[tauri] wavesrv stderr closed`), since no frontend can then tell it.
- **A setting turns it off:** `app:tray`, default on, shown in Settings → General as "Show arcterm in the menu bar"
  ("in the tray" on Windows). The popover's gear opens Settings → General, where that row sits.

### The popover window

- **A second webview window, label `tray`**, created when the popover opens and destroyed when it closes.
  - It costs nothing while closed. A WKWebView or WebView2 process is 50–100 MB, and on an 8 GB Mac keeping one alive
    for an occasional glance is the wrong trade.
  - The cost is a cold open of about 0.3–0.5 s. If it measures past 0.5 s on the Mac, keep the window hidden after
    its first open instead; that is the one fallback.
- **It closes** on a click outside it (blur), Esc on the main page, a second click on the icon, and any action that
  opens the cockpit. Esc on a subpage goes back to the main page.
- **Size and place:**
  - 360 px wide. Its height follows its content and is reported by the page (`tray_popover_size`), capped at the
    monitor's work area minus 16 px, with the content scrolling past that.
  - It sits under the icon on macOS and above it on Windows, aligned to the icon's rect from the click event, kept
    on screen, and flipped when the taskbar is at the top or a side.
  - Borderless and transparent. The page draws its own 12 px radius and `edge-strong` border. The shadow is the
    window's native one, since a CSS shadow would be clipped at the edge of a window sized to the page.
  - Always on top, never in the taskbar or Mission Control, and shown on every Space and over full-screen apps.
- **It must not raise the main window.** On macOS, showing a normal window activates the app, which brings the
  cockpit forward too. Task 4 spikes this: the popover becomes a non-activating panel through AppKit (like
  `macwindow.rs`'s calls), or an existing crate's NSPanel conversion if one builds cleanly. The popover is only
  worth having if the cockpit stays where it was.
- **Its own Vite entry:** `frontend/tauri/tray.html` + `tray.tsx`. It is a small React page with the same
  `tailwindsetup.css` and theme: the theme preset sits in the shared `localStorage`, and `themestore.ts` applies it
  the same way. It does not boot the cockpit, the wsh client or WOS.

### Data flows through the main window

The main webview already holds everything the popover shows: the attention queue, the agents, the job queue, the
usage meters, the storage report and the consumers poll. It runs as long as arcterm runs, folded into Sprout or not.
So it is the popover's only source:

- **The snapshot.** A pure `cockpit/traysnapshot.ts` (`traySnapshot(...)` with a test beside it) turns those atoms
  into one plain `TraySnapshot`. A `TrayBridge` component in the always-mounted cockpit shell sends it to the `tray`
  window as the `tray:snapshot` event whenever it changes while the popover is open. The popover keeps no state of
  its own beyond which page shows.
- **Actions** go back as `tray:act` events (`{ kind, id, ... }`). `TrayBridge` runs each with the code that already
  does it:
  - `JobQueueRunNowCommand`, `JobQueueSkipCommand`, `pacePatch`, `pausePatch`;
  - `CleanStorageCommand` with the category's confirm copy;
  - the stop command below;
  - opening the cockpit at an item: the router (`openref.ts`) after showing and focusing the main window.
- **The badge.** `TrayBridge` calls `set_tray_status { count, alert, visible }` whenever the count, the pressure
  level or `app:tray` changes, whether or not the popover is open.
- **Why not let the popover connect to wavesrv itself?** It would need copies of the attention queue, the agents
  roster and the usage meters, which are joined in the frontend from several stores. Sprout and the tray must never
  disagree about what waits on you.

### What is new in Go

- **`GetMachineStatsCommand`** (`pkg/machinestats`, new) returns the machine's figures:
  - memory total and available (gopsutil `mem.VirtualMemory`);
  - the memory pressure level (`jobqueue.ReadPressure`: Activity Monitor's on macOS, the commit charge on Windows;
    unknown elsewhere);
  - the CPU percent now and its last 60 one-second samples;
  - the system volume's total and free bytes, and its name. The name is read once: the root volume's name on macOS
    (Macintosh HD unless renamed), `Local Disk (C:)` or the drive's label on Windows.
  - CPU sampling runs only while calls keep coming, and stops 10 s after the last one, as `pkg/resmon`'s sampler
    does. `TrayBridge` polls once a second while the popover is open. The samples live in Go, so a webview
    throttling its timers in the background cannot leave holes in the graph.
- **A `memorypressure` event** published when the level changes. A watcher in wavesrv reads the level every 10 s,
  which on macOS is one `sysctl`. It feeds the icon's red dot while the popover is shut.
- **The heaviest command per agent, on every OS.** `GetConsumersCommand`'s rows gain the agent's heaviest descendant
  process: pid, a shortened command line and its footprint, from `pkg/memusage`'s process table.
  - Today that comes from the Resource Manager, whose sampler is Windows-only (`resmon/sample_other.go` returns
    nothing). On the Mac, Free up would otherwise have nothing to stop.
  - The agent's own process and arcterm's processes (wavesrv, the host, the webview) are never offered.
- **`StopProcessCommand { pid, blockid }`** ends that process's subtree:
  - Unix: SIGTERM, then SIGKILL after 3 s for whatever is left. Windows: resmon's existing tree kill.
  - It first re-checks that the pid is still a descendant of that agent's process, and refuses anything else.
  - The agent is not told separately; it sees its command end.
- Run `task generate` after the new wshrpc types and the `app:tray` key.

### What is new in the Tauri host

- **`tray.rs`** builds the icon and the right-click menu, opens and places the popover window, closes it on blur,
  and restarts the app for **Restart arcterm** (`AppHandle::restart`).
- **New commands:**
  - `set_tray_status { count, alert, visible }`, from the main window (`visible` is `app:tray`);
  - `tray_popover_size { height }`, from the popover.

  Add both to `docs/reference/architecture.md`'s command list ("eleven Tauri commands" becomes thirteen).
- **A capability for the `tray` window** (`src-tauri/capabilities/tray.json`): event emit and listen, and the
  popover's size command, nothing else. Opening the cockpit or a URL goes through `tray:act` to the main window.
- **Offline:** when wavesrv's stderr closes, the host sets the dimmed icon itself. If the popover is open or opens
  later, it shows the offline page.
  - Its actions: **Restart arcterm**; **Show log**, which opens `waveapp.log` with the OS's handler; and **Quit**.
  - It also shows when the cockpit last heard from wavesrv (not the last snapshot's arrival: the cockpit keeps
    sending snapshots after wavesrv has gone).

### The popover's content

Copy and order follow the boards. The rules behind them:

- **Memory card:**
  - The status word is Normal, High or Critical (`working`, `asking` and `error` colours, each with its dot). With
    no reading there is no word.
  - The caption says what the queue does at that level: "Jobs start as RAM allows", "Jobs run one at a time", "No
    heavy job starts", or "Queue paused" while paused.
  - The bar fills with what is used, in `muted` at Normal and in the status colour above it.
  - **Free up** opens the subpage.
- **CPU card:** the percent now and the last minute's line.
- **Storage card:**
  - Free and total of the system volume, and **Clean up**.
  - A split bar: arcterm's share is the storage report's total plus `storebytes`; everything else is the rest of
    the used space.
  - "arcterm N GB · M GB can be cleaned", where M is the sum of `cleanablebytes` over the categories the popover
    cleans in place (Run worktrees, Old Claude sessions, and Logs, cache and trash).
  - The report is the last scan (`GetStorageCommand`). The popover never starts a scan.
- **Heavy jobs:**
  - The Jobs popover's rows (`cockpit/jobqueuepanel.tsx`): running or place in the queue, the command, its peak
    RAM, its time, and ↗ to its agent or run. A second line names the agent and why the job waits.
  - **Run now** and **Skip** on a queued job; no Skip on the engine's own jobs.
  - The header holds the Slots select and a Pause select (1h, 4h). While paused, a row under the header reads
    "Paused, 52m left: every job starts at once" with **Resume**.
  - With no jobs, the body reads "No heavy jobs running."
- **Waiting on you:**
  - The queue's rows, at most five: the kind (`queueKindLabel`; `ask` in `asking` and semibold, the rest `muted`),
    the title and a muted tail. A row opens its item in the cockpit.
  - Past five, a last row reads "N more" and opens the Brief.
  - The header counts the items, and "N agents working" at its right.
  - Empty: "Nothing is waiting on you."
- **Footer:**
  - **Open arcterm**.
  - The Claude 5h chip: the label, a short meter with the elapsed tick, and the percent, coloured by `usageLevel`
    like the app bar's meter. Its tooltip gives the reset time and the week. With no Claude plan reading, the chip
    is left out.
  - The gear.
- **Free up subpage:**
  - The summary: free of total, and the split bar arcterm against other apps.
  - Each agent by footprint, heaviest first, with ↗.
  - Under each agent, its heaviest command and that command's size, with **Stop** in `error`. Stop asks no confirm
    (the agent carries on); its tooltip says so.
  - arcterm's own row, with no action.
  - "Other apps hold N GB" with **Open Activity Monitor** (Task Manager on Windows).
  - The figures come from `GetConsumersCommand`, polled while the subpage shows.
- **Clean up subpage:**
  - Settings → Storage's categories, with its copy (`storagemodel.ts` `CARD_COPY`).
  - Run worktrees, Old Claude sessions, and Logs, cache and trash clean in place. A first click turns the button
    into a confirm naming the action and its size ("Clean all 4.1 GB?"); a second click cleans, the way Settings →
    Storage's card cleans that category.
  - Build output and Design canvases have only ↗, to Settings → Storage and the Canvas gallery, where they are
    cleaned one by one.
  - The store shows, never cleaned.
- **Keyboard:** the popover takes focus when it opens. Tab walks the controls, Enter acts, and Esc goes back or
  closes. It adds no global shortcut.
- **Motion:** none beyond the shared popover reveal (`PopoverReveal`'s tokens); reduced motion respected.

### Out of scope

Temperatures (macOS needs private SMC access), network, battery, the trash, a Linux tray, a global shortcut to open
the popover, and purging memory (it only drops file cache, which fills again).

## Verification

- **Unit tests:** `traysnapshot.test.ts` covers the snapshot: the count rule, the five-row cap with "N more", the
  pressure caption per level, the storage sums, and the usage chip's level.
- **Go tests:** `pkg/machinestats` (sampler start/stop, the ring), the pressure watcher's publish-on-change, the
  heaviest-descendant pick, and `StopProcessCommand`'s descendant check, which refuses the agent itself, wavesrv
  and a pid outside the tree.
- **CDP scenarios** (`scripts/cdp/scenarios.mjs`):
  - `tray.html` loads in headless Chrome with a fixture snapshot (`?fixture=<name>`), one scenario per board:
    `tray-main`, `tray-freeup`, `tray-storage`, `tray-quiet`, `tray-critical`, `tray-paused`, `tray-offline`.
  - A `tray-actions` scenario clicks Run now, Skip, Stop and a clean-confirm, and asserts the `tray:act` events
    sent.
  - These run on the Mac's `task dev:browser` path; none needs the Tauri host.
- **Hand checks on the Mac** (`host: true` territory). The Final judges only the popover's page: the icon and the
  window's behaviour belong to the Tauri host, which the Mac's headless-Chrome Final does not run, so these stay hand
  checks and the run reports them unverified. Their logic is unit-tested in Rust.
  - the template icon on a light and a dark menu bar;
  - the icon's states: the count (`Main`), none at 0 (`A-Quiet`), the red dot (`A-Critical`), the dimmed glyph
    (`A-Offline`);
  - the popover under the icon on a full-screen Space;
  - the cockpit staying put when the popover opens;
  - the cold open's time, which `tray.rs` logs to `waveapp.log`, against the 0.5 s line;
  - closing on a click outside;
  - the offline page after killing wavesrv by its PID;
  - Restart arcterm;
  - Settings → General's toggle hiding the icon.
- **Windows:** the code builds for it, and the scenarios cover its page (`Win-Main` differs only in labels and
  position). The tray icon, its badge and the popover above the taskbar go unverified: there is no Windows machine
  now. Say so in the final report.

## Changelog

`Added`: "arcterm in the menu bar (the tray on Windows): see memory, CPU and disk, free them up, run or skip a queued
job, and open what waits on you, without bringing the window forward." with `<!-- big -->`.

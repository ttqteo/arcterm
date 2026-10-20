# Open issues — consolidated backlog

**This file is the single "what's left" list.** `docs/deferred.md` holds the why; this file holds the
what. New deferrals get their full entry appended to `docs/deferred.md`, then a one-line row here.

Pruned 2026-10-05: every row was re-checked against git and the closed ones removed (the shipped
orchestrator rows F11–F26, the closed scans, the Jarvis Brief B5 table, the recall-arm held items).
Recover the pre-prune list with `git show c99f2041:docs/open-issues.md`. The orchestrator flaw history
(F1–F26) stays in `docs/orchestrator-redesign-flaws.md`.

The rows of that prune were worked as chunks of `effort:c732b933-f976-4263-b191-fd95454c3d84`, archived
2026-10-06 with nothing actionable left (`wsh effort show c732b933-f976-4263-b191-fd95454c3d84`).

Status legend:

- **Waiting on a hand check** — shipped and unit-tested, never tried in the running app; tick it once tried, then
  delete the line (a finding becomes a row below).
- **Actionable** — can be picked up as-is.
- **Blocked** — cannot start until a prerequisite exists.
- **Held** — deliberately deferred pending a named trigger or evidence; do not build off the spec alone.
- **Declined** — decided against; do not resurface.

---

## 0 · Waiting on a hand check

Each line: what to do, what you should see, where, and the commit. Tick it when it holds, then remove it; when it
does not, say what you saw and it becomes a bug row under Actionable.

- [ ] (arcterm) Kael sync: with Code on one project, click a file link in an agent of another, large project: Code
  shows at once (its file list fills in after), then opens the file at its line. Tab onto the empty-state buttons, a
  surface error's Retry and Code's view-mode toggle: each shows the accent ring. `codestore.ts` `openInCode`,
  `surfacescaffold.tsx`, `codepathbar.tsx` (be313d719).
- [ ] (arcterm) Kael sync: after rebuilding wavesrv (or the next install), start an orchestrator run and let a
  worker run past 2 minutes: its row in the Agent tree reads its time since spawn (`3m`, `4m`…), not `<1m` while it
  stays busy; a retried task starts counting again, and a worker spawned before the rebuild shows no age.
  `runlineage.ts` `taskElapsed`, `scheduler.go` `MarkRunning` (e5eb5262e).
- [ ] (arcterm) Terminal header without the Ctrl Tab hint: pick a terminal (or a pinned app) from the tree after an
  agent: its header shows no "Ctrl Tab back to …" text, and Ctrl+Tab still returns to the agent.
- [ ] (arcterm) Resume dialog grouped by run: with an orchestrator run live, switch the Claude account in Settings →
  Agents: the run's lead and workers sit under a "run <title>" section in the lead's project folder, the run's
  checkbox selects all of them, and Resume selected resumes them (checked in headless Chrome with synthetic rows only,
  not with real run lineage).
- [ ] (arcterm) Storage scan fills card by card: after rebuilding wavesrv and restarting, open Settings → Storage
  within the first minute and press Rescan: Run worktrees, Sessions and Housekeeping show their sizes within seconds
  while Build output and Package caches still read …; `waveapp.log` gets a `storage scan took …` line naming each
  category's time (which one is slow). Commit `fix(storage): fill Storage card by card`.
- [ ] (arcterm) New dialog's Command box: pick Terminal, click the empty right part of the box (or its top edge):
  the caret lands at the end of the command; clicking a flag chip's × still removes it.
- [ ] (arcterm) Reload keys (Windows), in the dev app after a restart of `task dev` (the host changed): open a pinned
  app, move to another page in it, click in it and press `Ctrl`+`R`: the same page reloads, arcterm does not; its
  header's Reload does the same. In a terminal `Ctrl`+`R` opens the shell's reverse search; on the sidebar it redraws
  the focused terminal; `Ctrl`+`Shift`+`R` redraws from inside one; `F5` anywhere never reloads arcterm; the palette's
  **Reload the window** does. `src-tauri/src/pagekeys.rs`, commit "fix(keys): Ctrl+R reloads a pinned app's page".
- [ ] (arcterm) Pinned app Back / Forward (Windows), in the dev app after a restart of `task dev` (the host changed):
  open a pinned app, click through two of its pages, then header ← steps back one page and → forward again; with a
  second pinned app open, ← on the first never moves the second. They run `navigation.back()` in the app's frame
  (`pagekeys.rs` `app_frame_action`) instead of the window's `history.back()`, which stepped whichever frame moved last.
- [ ] (arcterm) Found on this machine: after rebuilding wavesrv (`task build:backend:quickdev:windows`, then restart
  the dev app) or the next install, open Setup → Tools: **mole** sits under System reading installed (`mo` from
  `%LOCALAPPDATA%\Programs\mole-cli`), and any of the detected TUIs on PATH (htop, ncdu, tig, btm…) list first under
  Found on this machine, with "· N found" in the header. Add moves one into its category and into Open a tool; its
  detail's "Remove from the library" sends it back; the cross hides it for good. `task verify:ui -- tools-found`
  covers the list, detail and Hide with a fixture; Add and the real detection are unverified.
- [ ] (arcterm) Image diff: after rebuilding wavesrv (`task build:backend:quickdev:windows`, then restart the dev app)
  or the next install, open Diff → Review on a repo with a changed PNG or JPG: in place of "Binary file — no text to
  show" its section shows Before | After side by side over a checkerboard, each captioned `W×H · size` (the After
  size in the accent when the pixel size changed); an added image reads "Added" on the left, a deleted one "Deleted"
  on the right. Before reads "Couldn't read" on an old wavesrv. (a39a50869)
- [ ] (arcterm) Kael sync: on the Brief, Runs and Initiatives show their filter as a line of chips with counts under
  the head; with more than six projects the Initiatives filter is one "project" menu in the head; right-click a row
  and the arrows move the menu's highlight, Escape closes it without leaving the Brief. (6a225bc59)
- [ ] (arcterm) Kael sync: after an agent launch, a new Claude session lists the skills as arc:runs, arc:cockpit,
  arc:design, arc:initiatives, arc:notes, arc:doc-review, arc:ideas, arc:learn (none twice), ~/.claude/skills no longer
  holds cockpit-runs and the rest, and Setup → Skills shows them in sync; a rule approved through `wsh learn` for
  cockpit-runs now shows under runs. (1cd40ef02)
- [ ] (arcterm) Background task Stop inside its card: with a running background task, open the Agent rail's Background
  tasks: the red Stop square sits inside the running row's card, right of "running", and hovering the card lights the
  whole card, Stop included; a stopped row looks as before (`agentdetailsrail.tsx` `BackgroundTaskRow`).
- [ ] (arcterm) UI check after a commit: after the next build and install, in a Claude session in this repo, commit a
  change to a `frontend/**/*.tsx` file without running `task verify:ui` or `cdp-shot.mjs` first: the model reads an
  `[arc ui check]` reminder after the commit's output (it says so, then tries the change or adds a line here); a
  commit that also touches `docs/open-issues.md`, or one after a `cdp-shot.mjs`, gets none. Unit-tested only
  (`claude/arc-mod/hooks/uicheck-core.ts`, `register.test.ts`).
- [ ] (arcterm) Dev server glyph: in the installed build, have an agent start `pnpm dev --host 2>&1` (an Astro site)
  in the background and let its turn end: its sidebar dot goes grey (idle, not working) with a green server glyph
  beside it, and the header reads `idle` then the glyph and `:4321`; the rail's Servers row says `this agent` and
  has a Log (not `already running`).
- [ ] (arcterm) Pinned app: in Setup → Tools → Add your own tool, type Folder `~/Workspaces/dev/portfolio-journal`
  (Hóng): a chip `npm run dash · 8386` shows, the other 14 scripts fold under Other scripts, and pressing it fills
  Name, Command and Page. Add it: it is a held service that sleeps until opened, its row under the project in the Agent
  tree reads `sleeping` with a hollow dot. Open it: it starts, and the dashboard shows in the centre under Page | Log,
  the header reading `Running on 127.0.0.1:8386 · up …`, the row `:8386` with a green dot, and the app bar's Services
  chip counts it; Log shows the npm output; Stop frees 8386 (npm's `node` child too) and the row reads stopped, and it
  stays stopped when shown again. Leave it for ten minutes (another surface, or another tab in the centre): the row
  reads `sleeping` and 8386 is free; open it again and it starts. Turn Keep running on (the row's menu, or Setup →
  Tools): it starts at once, never sleeps, and starts again when you quit and reopen arcterm unless you stopped it. With
  Hóng already running outside arcterm, its row reads `not started by arcterm` and Open shows it at once; its row in
  the footer's Servers has Pin as app, which opens the same form filled from it. Also in the Mac app, which the
  headless-Chrome Final cannot reach: the WKWebView frame, Back/Forward (the window's history there), the row's
  right-click menu, j/k onto a service row, and a start at boot finding npm from nvm or Homebrew on the login PATH.
- [ ] (arcterm) Jarvis → Waiting on you, a "plan" row whose agent is closed (or the Needs you strip, the palette, the
  pet's peek): Open lands on the Brief with that initiative expanded on its Proposed group (Accept all, Drop all),
  even from another surface, past the 6-row cap, under a search or another project's filter. Its activity link and
  right-click Open activity still open the Activity sheet. 2026-10-19 (`openref.ts` selectEffort,
  `briefsurface.tsx` briefOpenInitiativeAtom).
- [ ] (arcterm) Kael sync: open a run's DAG and click a task node: a peek opens beside it (session, route rows,
  description, actions); click it again, the background or press Esc to close it; click the final-stage node: its
  steps show in the peek, a finished step's kept output still opens. (ffeb41ae3)
- [ ] (arcterm) Kael sync: a terminal still looks the same after its SCSS moved to Tailwind (margins, no overview
  ruler, transparent viewport); Servers → a server's Log still opens the terminal with its search box. (42fe2f19b)
- [ ] (arcterm) Kael sync: right-click a terminal: the context menu grows out of the pointer, edged and shadowed like
  other popovers; a toast still holds while hovered. (d8031c9e1)
- [ ] (arcterm) Kael sync: on the Brief, Tab to a button and press Enter: the button acts, the row under the cursor
  does not open; click a chip then press Enter: the cursor row opens. (ee2f9fe44)
- [ ] (arcterm) Kael sync: an ambient tag chip opens its record (Ctrl peeks it); a decision log card shows its title
  and age. (607baece3)
- [ ] (arcterm) On a PC with two drives, open the tray popover: Storage shows one row per drive (here Local Disk (C:)
  and Data (D:), no Google Drive (G:)), each with its own free figure, and the arcterm part of D:'s bar holds the repos'
  worktrees and build output while C:'s holds sessions, logs and the store; Clean up's head reads `C: … · D: … free`.
  Tried only on tray fixtures in a browser, not in the app with live data.
- [ ] (arcterm) A Claude agent in default permission mode asked to run a slow command (`sleep 30` in Bash): its row
  reads asking at the permission prompt, then working the moment you press Enter or 1, not after the 30 s. Pressing
  Esc there instead ends at idle. `pkg/wshrpc/wshserver/wshserver_promptanswer.go`.
- [ ] (arcterm) Agent panel: open three files from Files (or Files changed): three tabs, the newest on show; click the
  first, it shows again; `×` on the middle one closes it and the one on show stays. Open six: five tabs, the oldest
  gone. With many open on a narrow panel the names shorten and the strip scrolls, the file on show in sight. In a
  markdown file follow a link to another: same tab, Back returns. On Overview the files are one icon with their
  count. 2026-10-18.
- [ ] (arcterm) Settings, in the installed app on the Mac (the run's Final checked headless Chrome only): the index
  lists General, Appearance, Agents, Runs & limits, Terminal, Background AI, Jarvis & Office, Storage & sync, then
  About under a line. Runs & limits → Heavy jobs: pick 2, open the Jobs popover, it reads 2; pick Auto there, the row
  reads Auto with no changed dot. Token burn: turn the gate off, the five thresholds dim; revert one changed threshold,
  its dot goes. Search "fold" finds Minimize on Jarvis & Office, "vault" finds Vault path on Storage & sync. Run
  d09b9dd1, ff28cea67. 2026-10-18.

- [ ] (arcterm) Code, and an agent's File tab: open an HTML file in Preview, scroll halfway, switch to another surface
  and back, then to another file and back: the page opens where you left it each time, not at the top. Rest the
  pointer on the page, then on a PDF: no chip with the file's path appears over the path bar. Needs a wavesrv built
  after `pkg/htmlserve`'s scroll script. 2026-10-18.
- [ ] (arcterm) File tab: rest the pointer on the empty space between a file's path and Preview / Source: no grey fill
  and no chip; on the path itself: the grey fill and the chip with the full path and "Click to copy". 2026-10-18.
- [ ] (arcterm) Office, Windows and Mac: hold an arrow, the boss walks faster than before (~240 px/s); hold `Shift`
  with it, it runs at twice that; let go of `Shift` mid-walk, it slows back. With reduced motion on, `Shift`+arrow
  jumps 48 px instead of 24. 2026-10-16.
- [ ] (arcterm) Office with music on: press `o` to Cards, switch surface, or click another window; the music fades
  out over ~0.4 s instead of cutting off (a jingle playing fades too). 2026-10-16.
- [ ] (arcterm) Office, each pet (Sprout, Minion, Spider-Man) and the VN shirt: walk with the arrows; the boss shows its
  back going up, its side going left / right (mirrored for left), its front going down, and stays turned standing.
  Judge Peter's side head (the spec once dropped one as a long face). 2026-10-16.
- [ ] (arcterm, Mac) Put an app in full screen, let arcterm fold into Sprout over it (or `⌘M`), click arcterm's Dock
  icon: the window grows back and the screen slides to arcterm's desktop, with arcterm in front. `waveapp.log`:
  `[fold] folded over a full-screen app`, then `[fold] grown back from over a full-screen app: desktop on screen false
  ... ordered it out and in again`, then `[fold] 1 s later: desktop on screen true, on the active Space true`. Same
  with `⌘Tab` and a double-click on Sprout; a fold on a desktop logs none of it. If the screen still stays on the
  full-screen app, send those lines: the fallback is a fold that no longer follows onto a full-screen Space.
  `macwindow.rs` `take_to_desktop`, `check_unfold_space`. 2026-10-17.

**2026-10-16 (the Office's sounds)**

- [ ] (arcterm) In the real app: Cockpit → Office with real agents and a run. Are the jingles pleasant and the default
  volume right; does the music (Settings → Jarvis & Office → Office music) duck under a jingle and stop when arcterm loses
  focus; do the footsteps and the wall bump feel right with Boss sounds on. The `office-sound` scenario logged the cues
  only and played no sound. `officeaudio.ts`, `officescores.ts`, `officesound.tsx`.

**2026-10-16 (the Office's pet boss)**

- [ ] (arcterm) In the installed app: Cockpit → Office with Spider-Man picked. He swings in through a window, unmasks
  and stands as Peter in a shirt and tie (white, whatever the outfit setting); walk
  with the arrows (front-on, no mirroring); stand still 4 s for a pastime; click him for the condition panel. Switch
  to Cards and back within 2 minutes: no entrance. Pick Sprout, reopen after 2 minutes: the beam. The footer pet is
  gone in the Office and back outside it.

**2026-10-16 (initiative `i` keycap dropped)**

- [ ] (arcterm) An agent with an initiative: the header shows `◇ <initiative> ⌄` with no `i` keycap after it; hovering
  it names `(i)`, and `i` (focus outside the TUI) still opens the popover. `agentheader.tsx`.

**2026-10-16 (skim split out of arc-view)**

- [ ] (arcterm) After a dev build relaunches arcterm: `~/.arc/claude-skim-mod` exists, `~/.arc/claude-view-mod/hooks`
  holds only `register.ts`, `wake-core.ts`, `wake-row.tsx`, and `env.CLAUDE_CODE_PLUGIN_DIRS` lists all three mods.
  In a new `claude` session a long explanation draws dimmed around its highlighted sentences, `/skim` toggles it with
  "skim off" in the status area, and a lead's wake row still draws as its events.
- [ ] (arcterm) Published copy: in a Claude Code profile without arcterm's mods, `/plugin marketplace add
  ttqteo/claude-skim` then `/plugin install skim@claude-skim` loads it and highlights a long reply.

**2026-10-16 (the Office's floors and lift, run 006c403f)**

- [ ] (arcterm) In the installed Mac app (the `cockpit-office-floors` scenario ran in the Windows dev app, WebView2,
  with real keys and the real mouse, and Final's headless Chrome on a Mac is not WKWebView): Cockpit → Office. One floor
  of four project rooms round the hall, a run as a table in its project's room, a `+N` chip for what does not fit.
  PageUp / PageDown ride the lift (the doors shut, the dial ticks, they open on the new floor); `g` in a room picks it up
  (← ↑ ↓ → a slot, PageUp / PageDown a floor, ↵ puts it down, Esc puts it back); dragging a room by its title does the
  same with the mouse, the lift's panel opening by itself to take it to a floor's button. Reload and the arrangement is
  kept. `cockpitoffice.tsx`, `officelayout.ts`, `officeplanmodel.ts`.
**2026-10-16 (initiative sheet day header)**

- [ ] (arcterm) Open an initiative with notes in the sheet (e.g. from Needs you) and scroll its Notes: the sticky
  `TODAY` header shares the sheet's background, with no darker band. `briefsheet.tsx` effort face `bg-background`.

**2026-10-16 (run workers in their project's room)**

- [ ] With an orchestrator run's workers or reviewers live, open Cockpit → Office: they sit in the run's project room
  (e.g. `arcterm`), with no room named `1` / `4` or a run-id hash. `projectname.ts` `projectNameFromTranscriptPath`.

**2026-10-16 (the run queue in Jarvis's Brief, run 0f988c55)**

- [ ] (arcterm) Queue a plan `--after` a lead run that has a DAG, then open its row in Jarvis → Brief → Runs. The queue
  sheet's waits-on line reads `<stage> <done>/<total>` (for example `working 2/5`). Start now turns the sheet into the
  run's sheet with no blank frame between the two. The Final waited only on a quick run with no DAG and did not record
  frames across the switch. `briefqueuesheet.tsx`, `briefsheet.tsx`.

**2026-10-16 (queued row says Queued)**

- [ ] Queue a plan `--after` a running run: its row in the Agent tree reads `Queued · after <run title>`, and a narrow
  sidebar still shows `Queued ·` before the cut. `runqueuemodel.ts` `queuedMeta`.

**2026-10-16 (the Office's Needs you notice board, run 0e23de6a)**

- [ ] (arcterm) With real Needs you rows (a plan to review, a run to land, a learned rule): Cockpit → Office. The
  board below the lounge pins up to three slips with the `!n` count over it; ↑↓ / `j` `k` and `n` stop at it only
  while rows wait. ↵ there (or a click, or `m` → Notice board) opens the box: ← → page the rows, and Approve, Land,
  Accept, Dismiss act as the strip's buttons do, toasting on failure with the page kept; Open on an agent, initiative
  or channel row lands there. After work hours the slips dim with the office. The CDP scenario
  `office-needs-you-board` ran on a fixture only and pressed no act that calls the server.

**2026-10-16 (Jarvis without the office)**

- [ ] Open Jarvis's Brief: the Runs list's header shows the run-kind toggle and no **office** chip, and no floor draws
  under the runs. Sprout walks the footer as before; its bubble and its peek open from it (not from a desk). The
  Cockpit's Office is unchanged. `briefsurface.tsx`, `petview.tsx`; the commit that deleted `view/jarvis/office*`.

**2026-10-16 (kael sync: memory hygiene, autonomous runs, wider plan review, radar kinds)**

- [ ] (arcterm) Setup → Memory: the tab sits between Learned and Project; a project row shows its index size and
  "Not checked yet" until a check runs; **Check now** proposes changes with their evidence, Accept applies one and
  Undo puts it back. `setupmemory.tsx`, `setupsurface.tsx`.
- [ ] (arcterm) New → Orchestrate: the Models block is a 2×2 grid (Lead, Workers, Reviewers, Light reviewers) and an
  **Approvals** row (Ask me | Autonomous) with its note sits under it; a run started on Autonomous shows the word on
  its run sheet's config line. `launcherrunfields.tsx`, `launchermodal.tsx`.
- [ ] (arcterm) A run's sheet → Adjust: the Approvals dial saves, turning it on with a lead question waiting hands that
  question back; the palette offers **Go autonomous** / **Ask me again** on the run. `briefrunsheet.tsx`.
- [ ] (arcterm) A run's plan review: five reviewer rows in the Agent tree, each titled `Plan review · <lens>`, and one
  chip per reviewer in the DAG view; a round-2 resubmit shows one `Round-2 follow-up`. `agenttree.tsx`.
- [ ] (arcterm) Settings → Background AI → Radar: a **Commit classifier** row under Radar audit, its placeholder
  `haiku` on claude and `pi default` on pi. `settingspages/backgroundai.tsx`.
- [ ] (arcterm) Agent sidebar → a project's Conversations: an ended orchestrator run whose lead landed in `arc-wt`
  shows as one run entry under that project, not missing (counted in "elsewhere") or under a key like `006c403f`.
  `agentsidebarmodel.ts` `projectKeyResolver`, `sessionruns.go` `fillEngineTreeRoots`.
- [ ] (arcterm) A Claude agent's background command (`run_in_background`) that redirects stdout to a file is refused
  with the "Claude Code already saves…" reason; `2>&1`, `> $null` and a foreground redirect pass. `guard-core.ts`.
- [ ] (arcterm) Settings → Storage → Run worktrees lists the trees under `%LOCALAPPDATA%rc-wt` with their project and
  run status; one whose run the dev app's store lacks shows guarded, and Clean all leaves it. `pkg/storage/worktrees.go`.
- [ ] (arcterm) Agent rail → Background tasks: a running command has a red Stop; two clicks end it (the row reads
  stopped, the process is gone from Task Manager), a task already ended toasts "had already ended". Windows only.
  `agentdetailsrail.tsx`, `pkg/resmon/shelltask.go`.
- [ ] (arcterm) Jarvis Brief → Initiatives: with initiatives in two or more projects, the head shows `all · <project>…`
  chips; picking one narrows the rows, the paused count and "Show N archived"; a project with none shows No match.
  `briefsurface.tsx`.
- [ ] (arcterm) A terminal after a GPU reset (or a WebGL context loss): it goes on drawing with the DOM renderer at
  once, no white sad-face canvas, and WebGL comes back about 2 s later. `termwrap.ts`.

**2026-10-16 (the Office plays like a pixel game, run 25462413)**

- [ ] (arcterm) In the installed Mac app (Final ran the scenarios in headless Chrome, not WKWebView): Cockpit → Office.
  No Cockpit title; the counts, Cards | Office, projects and Live only sit in the framed HUD bar inside the office.
  Walk to a desk: `↵ Talk` (`↵ Answer` at one that asks) over the person; ↵ opens the dialog box at the office's foot,
  or at its head when the boss stands in the view's lower half (its name plate should sit clear of the HUD bar: in
  the Final shot `cockpit-office-dialog-questions.png` it touches the bar's lower edge). ↑ ↓ move the ▶ over a dim
  Send; ↵ on an answer moves the ▶ to Send and a second ↵ sends; `f` opens the full card, Esc goes back to the box,
  Esc again to walking. Reply opens the full card with its composer focused, and `m` typed there types. `m` and the
  footer's `m menu` open the office menu under the HUD bar; its Events shows the Events rail and Esc while walking
  hides it; the footer names the newest event. With real runs: a meeting room's box shows the lead's last line and
  its task column, and a worker seat whose review failed leads with Approve / Send back / Retry / Skip.
  `officecontrols.ts`, `officedialog.tsx`, `cockpitoffice.tsx`; merge 519802593.

**2026-10-15 (menu bar / tray popover, run f502b3ed)**

The Final judged only the popover's page in headless Chrome; the icon and the window belong to the Tauri host. Spec
`docs/superpowers/specs/2026-10-15-tray-popover-design.md`; `src-tauri/src/tray.rs`, `macwindow.rs`,
`frontend/app/cockpit/traybridge.tsx`.

- [ ] (arcterm) The menu bar icon on a light and a dark menu bar: a count when something waits on you, none at 0, a
  red `●` before the count at critical memory pressure (`! 4` if the attributed title failed), the dimmed glyph
  with no count once wavesrv has gone.
- [ ] (arcterm) On macOS 27 a left click and a right click on the icon both open the popover, and a second click of
  either closes it (2026-10-16: no menu on a Mac).
- [ ] (arcterm) Click the icon with the cockpit behind another app, and again on a full-screen Space: the popover
  opens under the icon and the cockpit stays where it was (its webview shows in an `ArcTrayPanel`,
  `macwindow::show_in_panel`); nothing crashes.
- [ ] (arcterm) The popover is as tall as its page, not its loading page's 62 pt: the panel takes the hidden window's
  frame after tao applies it (`macwindow::after_tao_frame`, 2026-10-16). Clicking Storage, clicking outside it and Esc
  close it without a crash.
- [ ] (arcterm) Closed popovers no longer leave their windows behind: tao 0.35.3 keeps one reference to every
  NSWindow it makes and one to its delegate, which holds the window, so no destroyed window was ever freed;
  `macwindow::free_when_destroyed` releases the two a second after the popover's destroy (2026-10-16). Check that
  `heap <arcterm pid> | grep TaoWindow` stays at 1 after a few opens, that `waveapp.log` says "freed the closed
  popover's window", and that switching light and dark mode afterwards crashes nothing. Report the leak to tao.
- [ ] (arcterm) The cold open: `[tray] popover ready N ms after the click` in `waveapp.log` stays under 500 ms. Past
  it, the popover needs a hidden window made at launch.
- [ ] (arcterm) A click outside closes the popover; a second click on the icon closes it and does not reopen it.
- [ ] (arcterm) Free up: run `sleep 600` in an agent's terminal; it shows as that agent's heaviest command, and Stop
  ends it and leaves the agent running.
- [ ] (arcterm) Kill wavesrv by its PID: the icon dims, the popover opens on the offline page with Last heard within
  15 s of the kill, Restart arcterm brings it back. With Settings → General's toggle off, the icon stays hidden
  through the kill.
- [ ] (arcterm) Settings → General's toggle hides and shows the icon; the popover's gear opens Settings → General.
- [ ] (arcterm) On Windows, open the popover a few times while what waits on you changes: no scrollbar on either
  edge, the footer whole, one rounded edge at each corner (the system's, no CSS border inside it), and "free of
  31.8 GB" inside the Memory card on its own line.

**2026-10-15 (an agent cut off by a restart carries on)**

- [ ] (arcterm) Give a hand-launched claude agent a task that takes a while, and while it works quit arcterm (or let
  `task install` close it). Reopen: the agent comes back on its session and starts a turn on its own with "The app
  restarted while you were working…", and goes on with the task. An agent that was idle at the quit comes back at its
  prompt with no new turn. Same for one waiting on a permission: it asks again. `agentrestore.go` NoteAgentState,
  RestoreLiveAgents, restoreStartArgs.

**2026-10-15 (arcterm stays on its own Desktop on a Mac)**

- [ ] (arcterm) With **Fold when you leave** on and arcterm full on Desktop 1: switch to Desktop 2 (Ctrl+→) and wait
  past the fold delay: arcterm does not fold; `⌘Tab` back takes the screen to Desktop 1, full. Fold with `⌘M`, go to
  Desktop 2: no Sprout there; `⌘Tab` or the Dock icon takes you to Desktop 1, where it grows back. Make another app
  full screen (green button) over arcterm: it folds and Sprout shows over that app (the one case `CGSSpaceGetType`
  must answer 4, not checked by hand yet); click it: arcterm comes back on a Desktop (note which: AppKit picks it).
  `foreground.rs` desktop_on_screen, `macwindow.rs` folded_behavior.

**2026-10-14 (merge of the Mac's Setup → Skills edit work into main)**

- [ ] (arcterm) Setup → Skills after the merge: a vault skill with accepted lines shows its `+N` chip and, while its
  editor holds unsaved text, `edited` beside it; its rail lists **Your additions** under SKILL.md and, for a skill
  under Your skills, the Edit footer; a skill under Ships with arcterm has no footer. The merge joined both sides by
  hand in `setupsurface.tsx`; `setup-skill-edit` and `setup-skill-additions` were not run on the merged tree.

**2026-10-14 (land queue, run 33724b1d)**

- [ ] (arcterm) Land line: finish 3 small runs close together that each add a `CHANGELOG.md` line. They land one after
  another with no hold, the later ones reading **Landing · #N in line** in the tree and the run sheet meanwhile
  (01939e1, 6d6cb41). The CDP `land-queue` scenario only draws seeded lands that the driver skips.
- [ ] (arcterm) Resolver: land a run whose branch really conflicts with `main`. A **Conflict resolver** session starts
  in the landing tree, the land reads **Landing · resolving conflicts**, and once the resolver commits the merge and
  completes, the land goes back in line and lands. If the resolver cannot merge, it is held naming the files. No check
  started a real model; the tree's resolver row is vitest-only (03b96bd, 66a1ec1, 5e3e45a).
- [ ] (arcterm) Queued start after a held run: queue a plan `--after` a run, hold that run's final, Land anyway. The
  queued run starts by itself, and `wsh runs land` lists it as released (40ba52f, de7e7e1).

**2026-10-14 (initiatives on the Agent surface, run 961cdb3d)**

- [ ] (arcterm) Plan to review: on a real Claude agent that proposed chunks (`wsh effort chunk add --proposed`),
  **Accept all and continue** on its rail types "Plan accepted, start with <first chunk>" into its terminal and the
  agent starts on it. The `initiative-plan-review` scenario's agent is a fake tab with no TUI, so only the text and the
  block it was sent to were checked (383e1d466).
- [ ] (arcterm) Review: with Sprout folded into its mini window, its "Review in Jarvis" line restores the window and
  lands on Jarvis's Review pass. Only the unfolded path was exercised (547e071eb).
- [ ] (arcterm) Review: Pause or Archive inside a pass, then start a new pass with `v`: that initiative is not back as
  "changed". The mark lands after the server's write; the scenario's clock was stubbed, so the order was never
  measured against real time (547e071eb).

**2026-10-14 (run handoff: the session that started a run is told how it landed)**

- [ ] (arcterm) Run handoff: a run started with `wsh runs start` from a Claude session messages that session once it
  lands, and waits while you are mid-turn with it. No scenario can bring a deferred run to a messaged outcome, so this is
  tried only in unit tests with a scripted roster; neither has the `--queue` path (CLI → `RunQueueAdd` → the loop →
  `CreateRun`) been tried in the running app.
- [ ] (arcterm) Run handoff: hovering a queued row on the Agent tree fades in its Start now and Remove buttons (another
  row's stay hidden). Run 973afb5b's Final failed only this step (`run-queue` step 2, opacity read 0) while its
  screenshots came out blank, so it was force-landed as `df5f68488`; try `task verify:ui -- run-queue` or hover a
  `wsh runs start --queue` row by hand.

**2026-10-14 (leadless run row)**

- [ ] With one run whose lead tab is open and one whose lead tab is closed, in the Agent sidebar: both rows have the
  mark beside the title, the same title weight and colour, and the chip line flush under the mark; only the lead's row
  shows tokens. `agenttree.tsx` `RunRow`.

**2026-10-14 (Cockpit / Jarvis badge split)**

- [ ] With one agent asking and one run waiting to be confirmed: the Cockpit nav badge says 1, the same as its "need
  you" tab, and Jarvis says 1. Confirm the run in Jarvis and its badge goes away. `attentionstore.ts` `splitAttention`.

**2026-10-14 (brainstorm ideas, run ee18a780)**

- [ ] In an agent tab, type `/idea` (or `/arc:idea`): Claude Code lists the command and runs it, and the idea lands in
  the rail's Ideas section. `claude plugin validate` does not inspect `commands/`. `claude/arc-mod/commands/idea.md`.
- [ ] On a Mac, select text in an agent's terminal and press Cmd+Shift+I: a toast with Undo, and the line in Ideas;
  with nothing selected the Ideas box opens. `ideasstore.ts` `runIdeaCapture`.

**2026-10-14 (Conversations rescan)**

- [ ] In an agent tab run `/clear` (or quit claude and start it again in that terminal): within a second the session it
  left appears at the top of its project under Conversations, without leaving the Agent surface. `usesessionsscan.ts`.
- [ ] Mark an old conversation for later (row menu): it moves to the top of its project folder, above newer ones.
  `agentsidebarmodel.ts` `conversationTree`.

**2026-10-14 (overflow fixes)**

- [ ] Open the RAM popover (app bar) with an agent named past the column: the name ends in "…" before CPU, its
  command shrinks first, and hovering the row shows the full name. `consumerspanel.tsx`.
- [ ] Agent → Conversation History, a run of 20+ tasks: its strip thins to fit and "N/M landed" stays in the card.
  `conversationhistory.tsx`.

**2026-10-14 (learned additions; the three CDP scenarios pass 14/14 on `main`, these need live agents)**

- [ ] Note the same rule twice from two agents (`wsh learn note "<rule>" --key <k> --skill <name>`): a "Learned rule"
  row appears in Needs you; Why unfolds the quotes; Edit, then Enter, saves the edited text; Accept adds the line
  under "Your additions" in the skill's rail with a `+N` chip on its row, and in Setup → Learned (fourth tab).
  Commits `e2499a0f4`, `f2e7616e0`, `6c0ca4220`.
- [ ] Edit and Remove a line in Setup → Learned: the skill's SKILL.md in `~/.claude/skills` follows; a removed key is
  not proposed again. Commit `f2e7616e0`.

**2026-10-14 (Setup → Project tab)**

- [ ] On an install with no registered project, open Setup → Project: it says "No projects yet" and shows no groups
  (decided in `claudecontextmodel.ts`, unit-tested; the `setup-project` scenario covers every other state, but
  staging zero projects would wipe the dev app's). Then press **Copy path** in the rail and paste: the file's full
  path (the scenario checks it through a clipboard stub, never the real clipboard). Commit dcdd1cac8.

**2026-10-14 (Agent sidebar: a failed plan review's fold)**

- [ ] With an engine run whose plan review just failed (lead revising), look under the run in the Agent sidebar: the
  finished fold reads `1 review · 1 failed` with a red dot, not a green check. Once the lead resubmits and round 2
  starts, the fold goes back to a check. Tried only in unit tests (`agenttreemodel.test.ts`).

**2026-10-14 (Claude mod on a Team account: ask dialog, Token burn gate)**

- [ ] After the next build and `task install`, in a Claude agent: have it ask a choice question; answer once in Claude's
  own dialog and once on the arcterm card: each answer reaches Claude (never "The user dismissed the question") and one
  card shows, not two. Dismiss on the card with the dialog still open: about 1.5 s later Claude gets "dismissed". Ask it
  to start 3 subagents, pick allow-this-turn on the Token burn card, then a new prompt that starts 3 again: the card
  asks again. Tried only in unit tests, and the transcript path in a headless `claude -p`.

**2026-10-14 (Heavy jobs: run steps named by the run's title)**

- [ ] With an engine run whose Check, Verify or Setup step waits or runs in the heavy-job queue, open the app bar's Jobs
  chip: that row's second line reads `<run title> · Check · base tree` (the plan's title, else the goal's first line),
  not `Run 973afb · …`, and ↗ still opens the run. `frontend/app/cockpit/jobqueuepanel.tsx`.

**2026-10-14 (What's new: highlight cards, the rest folded)**

- [ ] In the dev app (`task verify:ui -- whats-new`, then by eye), open What's new from the footer's version: each
  release shows 4–5 cards (title, two lines of text, Try it at the bottom right), then one "N more changes · M fixes"
  line. A cut card opens to its whole note on click; one that fits shows no pointer. In the fold, a note with no bold
  lead that fits two lines (0.15.11 "A new waiting item flashes…") has no chevron and stays aligned with the rows
  above. Check the cards read well on the Light theme too. `frontend/app/cockpit/whatsnewsheet.tsx`.

**2026-10-14 (Claude memory lint in the Claude mod)**

- [ ] After the next build and `task install`, on Windows and on the Mac: add a line `- [X](x.md) — test` to the
  project's `MEMORY.md` (`~/.claude/projects/<project>/memory/`), start a new Claude agent: a toast "arc: memory lint
  found 1 issue(s)" shows and Claude's first reply names "MEMORY.md points at missing x.md". Remove the line and start
  another: no toast. Tried only in a headless `claude -p` on Windows with a copy of the mod.

**2026-10-14 (reopen a closed agent, Ctrl+Shift+T)**

- [ ] Close a claude agent with Ctrl+Shift+W, then press Ctrl+Shift+T (also from inside another terminal): it comes
  back in a new tab, asleep, with its conversation; a message wakes it on the same session. Close 6 and press
  Ctrl+Shift+T 6 times: 5 come back, the 6th toasts "No closed agent to reopen". Ctrl+Shift+O opens Open a tool.

**2026-10-14 (folded Sprout holds the OS toast)**

- [ ] Fold Sprout, put another app in front, and let an agent ask: only Sprout's "NEEDS YOU" bubble shows, no Windows
  toast. Leave it unanswered 30 s: the Windows toast follows. Answer within 30 s, or click arcterm, and no toast
  comes. Commit "fix(notify): a folded Sprout says needs-you first, the OS toast only if it still waits".

**2026-10-14 (Jarvis graph peek removed)**

- [ ] On Jarvis, open a record's peek (from the Brief and from Sprout's popup): its footer shows only the log line, no
  "Where it sits on the map"; `Shift+G` on Jarvis does nothing and the footer hints list no "graph"; Escape still
  closes the record peek, then leaves Jarvis. Commit "refactor(jarvis): remove the vault graph peek".

**2026-10-14 (Sprout names the project)**

- [ ] In Float or folded, let an agent finish a turn: Sprout's bubble reads "NOTICE · <project>" above "<agent>
  finished"; an agent stopped at a permission prompt reads "NEEDS YOU · <project>". Commit "fix(pet): Sprout names the project".

**2026-10-14 (fold pause box)**

- [ ] With "Fold when you leave arcterm" on, fold into Sprout and hover it: "Restore, don't fold for" shows only the
  Custom… box. Click into it: 1 hour and till 8:00 pop up above the box, over the card's rows (the card does not grow),
  with "or type 2h, 30m, 14:30"; clicking one restores and the card says "No fold until …". Typing hides the list
  and shows the until-hint.

**2026-10-14 (fold corner)**

- [ ] Right-click the Sprout button → Fold to → Top left, then fold: Sprout lands in the top-left corner, 24px in, and
  its card opens down and right. Folded, Settings can't be reached, so restore, pick Bottom left in Settings → Jarvis & Office
  → Folding → Fold to, fold again: bottom left. Drag Sprout mid-screen, restore: the Fold to row reads "Where you
  dragged it" and the menu has no corner ticked.

**2026-10-13 (kaeltran16 sync: cherry-picked fixes and features)**

- [ ] Code → project picker, type a folder that is not a git repo (one with a `node_modules`): the tree lists its
  files without `node_modules`, a footer names the skip set, the header path ends "· not a git repository", the
  Changed tab and a file's Diff toggle are greyed out with "Not a git repository — no change tracking", and Search
  finds text in it. Scenario `code-plain-dir`. `codestore.ts` `codePlainAtom`, `pkg/gitinfo/walk.go`.
- [ ] A run with a Final stage: once Check/Verify finish, click the step in the final stage pane and in the run's
  rail: its kept output opens. `finalstagepane.tsx`, `pkg/orchestrate/final.go` `<round>-steps/`.
- [ ] Sessions → an ended session → Resume: the new agent tab is named after the session's task, not the project.
  `sessionsruns.ts` `resumeLaunchOpts`.
- [ ] `task dev` (Windows) while an editor is in front: the dev window opens behind it, restored, without taking
  focus. On a Mac the dev window still appears. `src-tauri/src/main.rs` `show_behind_foreground`.
- [ ] Setup → shared instructions with a long line: the editor wraps it instead of scrolling sideways.

**2026-10-13 (Initiative bar: the next chunk is no longer accent)**

- [ ] Jarvis → Initiatives: a row whose chunks are all pending (e.g. Repo hygiene 0/2) shows an all-grey bar, no
  accent segment; a chunk set to active is still accent. `effortmodel.ts` `buildEffortCard` segments.

**2026-10-13 (one click on the folded Sprout holds its card; Mac: the Dock icon over a full-screen app)**

- [ ] Fold into Sprout, click it once: after a beat the card of agents and terminals opens (no Jarvis chat) and stays
  with the cursor moved off it; a click on a row floats on it. Click Sprout again, press Esc, or click another app:
  the card closes and does not pop back while the cursor still rests on Sprout. A double-click restores.
  `sprout-mini.tsx`, `miniclickthrough.ts`.

**2026-10-13 (Jarvis popup: folded chat closes on a click away, no Ask while folded, compact composer)**

- [ ] Fold into Sprout, open the Jarvis chat from its card, then click another app (or the desktop): the chat closes.
  Clicking inside the chat, or the chat resizing the folded window, must not close it. `sprout-mini.tsx`.
- [ ] Folded, the chat has no Ask field; the hover card's row reads "N waiting on you" / "New reply" / "Nothing
  waiting". Ask Jarvis from the full window, fold before the reply lands: the "New reply" bubble opens the chat
  with the reply in it. `petpeek.tsx`, `peterrand.tsx`.
- [ ] Full window, Jarvis popup (Sprout in the footer): under the field one muted line `Claude Code ⌄ · <project> ⌄`;
  each part opens its picker and the choice sticks. `peterrand.tsx`, `harnesspicker.tsx` (`bare`).
- [ ] Folded hover card's pause row: the box reads "Custom…"; clicking in shows "e.g. 2h, 30m, or until 14:30";
  typing `2h` turns it into "until <time>". `sprout-mini.tsx`.

**2026-10-13 (Spider theme: blue accent)**

- [ ] (arcterm) **The Spider theme's accent is the suit's blue (#7a9ce6), not red.** Setup → Appearance → Theme →
  Spider: links, focus rings and the selected row read soft blue, nothing glares red; the app-bar spider logo, the
  small spiders in the corners and the pet keep the suit's red; the Spider chip shows a red and a blue swatch.
  Commit: "feat(theme): the Spider theme's accent is the suit's soft blue".

**2026-10-13 (Don't fold for, on the folded Sprout)**

- [ ] (arcterm) **The folded Sprout's card holds the auto fold off.** Turn on "Fold when you leave arcterm" (right-click
  the app bar's Sprout), leave for an app that covers arcterm so it folds, and rest the cursor on Sprout: the card ends
  with "Restore, don't fold for" and `1 hour`, `till 8:00` and a box. Typing `2h` shows "until …" under it; Enter (or a
  chip) restores the window, and leaving again does not fold. Folded by hand, the card then reads "No fold until …"
  with Resume. Check the card is not cut off at the top with four agents listed (the folded window grew to 320x336),
  and that typing keeps the card open when the cursor leaves it. (`sprout-mini.tsx` `FoldPauseRow`, `foldpause.ts`)

**2026-10-13 (arcterm's RAM broken down in the compact popup)**

- [ ] (arcterm) **The compact RAM popup lists what arcterm's figure is made of.** Open the RAM chip on Windows: under
  the agent list one line reads `Agents … · Interface … · Server … · Host … · Terminals …`, and the parts add up to
  the header's `arcterm …`. CDP `consumers-popover` step 20 checks it. (`consumerspanel.tsx` `CompactOwn`)

**2026-10-13 (Sleeping and background-task rows in the sidebar)**

- [ ] (arcterm) **Sleeping rows read apart from idle ones; rows carry fewer marks.** In the Agent sidebar a sleeping
  agent shows a moon in place of its ✳, a faded name and meta, and a bare age (`19m`); an idle one keeps its ✳ and
  `text-secondary` name. Selected or unread, a sleeping row's name is bright again. An agent with a background command
  shows no mark (and no ✓ while it runs); one with a canvas shows a grid icon after its name (accent dot when
  updated; a click shows the canvas, again goes back to the terminal); a finished one a bare green ✓; the Later
  bookmark is grey. `agenttree.tsx` (`SleepGlyph`, `CanvasTag`); scenarios `agent-sleep`, `sidebar-agent-glyph`.
- [ ] (arcterm) **Settings → Appearance → Agent sidebar hides row meta.** Turn off Model, then Tokens, then Age,
  then Branch: each disappears from every agent row in the sidebar at once and comes back when turned on; the card's
  changed dot shows while one is off, and Revert turns it back on. It survives a reload. `rowfields.ts`,
  `rowfieldsstore.ts`, `settingspages/appearance.tsx`.

**2026-10-13 (Classic-renderer Claude after a restart scrolls)**

- [ ] (arcterm) **A Claude that comes back on the classic renderer scrolls.** Rebuild wavesrv, then restart arcterm twice
  within ~10 s so a resumed Claude prints "fullscreen renderer didn't finish starting last time": its pane should
  scroll with the wheel (normal screen, scrollback), not sit stuck. `pkg/util/shellutil` reset sequence (`?1047l`).

**2026-10-13 (Usage cold first open)**

- [ ] (arcterm) **Usage fills in after a fresh start.** Restart arcterm (the build with this fix), open Usage at once:
  the stat tiles, By session and Subagent cost replace their placeholders within a few seconds and never stay on
  them; switching 7 days / All time is not needed. commit "scans get a 60s RPC timeout and share in-flight reads".

**2026-10-13 (canvas arrows with few boards)**

- [ ] (arcterm) **A canvas with five tabs or fewer has ‹ and › too.** Open a canvas with two to four boards (Canvas in
  the header): ‹ and › sit either side of the All / board tabs, and each steps one board as `[` and `]` do; so do `←`
  / `→`, while `↑` / `↓` still change agent. CDP scenario `canvas-tabs` step 4 checks ‹; it has not run in the app
  yet. commits "a canvas with few boards gets ‹ › too" and "← → step canvas boards".

**2026-10-13 (close hands focus to the neighbour)**

- [ ] (arcterm) **Closing the shown agent opens its neighbour.** In one pane, with three or more agents in a project,
  pick the middle one and close it (Ctrl+Shift+W or the header's Close): the one below it in the sidebar takes the
  centre, not the first agent; close the last one in a folder and the one above it takes it. Same for a plain terminal.
  commit "close opens the neighbour".

**2026-10-13 (folder running count, Spider-Man web)**

- [ ] (arcterm) **A project folder counts its running agents.** With an agent working in a project, its folder row in
  the Agent sidebar reads a pulsing dot and `1` (hover: "1 running"), open or folded, and drops it when the agent goes
  idle; hovering the folder shows no button (a terminal or a tool opens from New). commit "project folders count running agents"; the
  dot and number, commit "folded folder stays inside the sidebar".
- [ ] (arcterm) **A folded folder stays inside the sidebar.** Fold a project with 10+ agents while one runs and one
  asks: the row reads its name (at least a few letters), the dot and number, `N asking`, then the agent and terminal
  marks with their numbers (hover: "13 agents · 1 terminal"), all inside the sidebar. commit "folded folder stays
  inside the sidebar".
- [ ] (arcterm) **Spider-Man's web stays one piece.** Theme Spider-Man, restart on the Cockpit surface, then open
  Agent: the corner web runs across the rail and the tree as one, with no second corner at the tree's left edge.
  commit "project folders count running agents".

**2026-10-13 (server whose launcher exited)**

- [ ] (arcterm) **A daemonized dev server keeps its agent.** Have a Claude agent start Astro 7 in the background
  (`pnpm run dev`, whose `astro dev` returns once the server is up): its task reads completed, yet the agent's
  Servers row reads `this agent` with a log button, and the footer's Servers popover badges it `claude · <agent>`,
  not `no owner`. `frontend/app/view/agents/devserversmodel.ts` (`matchEndedTask`).

**2026-10-13 (sleeping agent title)**

- [ ] (arcterm) **A sleeping agent's row keeps its title.** Open the Agent surface with agents asleep (or put one to
  sleep from its row's menu): each row reads the conversation's title, as its Conversation History row does, not just
  the project name ("portal"). Holds after an arcterm restart too, once the Conversations scan has loaded.

**2026-10-13 (Alt+Tab grows Sprout back; Jarvis card link)**

- [ ] (arcterm) **Spider-Man shows Sprout's working dots.** With Spider-Man as the pet and an agent working, fold into
  Sprout: the pill at his top right shows three pulsing green dots and the count, no web; the same in Float, and the
  dots alone while Jarvis thinks. `task verify:ui -- jarvis-pet` (steps 15b, 22) checks it.

- [ ] (arcterm) **Alt+Tab grows any fold back, maximized (Windows).** Fold with the Sprout button (not Fold when you
  leave) from a restored (not maximized) Full window, click into another app, Alt+Tab back to arcterm: the window opens
  in Full, maximized. The same from Float: it comes back in Full, maximized, not as the float. A click on Sprout from
  the other app leaves it folded; a toast click that opens the chat leaves it folded too. `waveapp.log` logs
  "back in arcterm: growing back to Full, maximized".
- [ ] (arcterm) **A long Open link ends in "…" in the folded Jarvis card.** With a run notice whose title is long (an
  installer build), open the card from Sprout: the "Open <title>" link stays inside the card, cut with "…", and its
  hover shows the whole title.

**2026-10-13 (New agent: Claude account)**

- [ ] (arcterm) **The New agent footer names the Claude account.** With a token account added in Settings → Agents →
  Claude account, open New agent and pick Claude Code: the footer reads "Starts in <path> · on main · Claude: <label>"
  (or the /login email while Default is active), and a resume adds it after the branch. Pick Codex or Terminal: the
  account part goes. With only /login it never shows. Not yet seen in the running app.

**2026-10-13 (App bar usage button)**

- [ ] (arcterm) **RAM and plan meters, one button.** In the app bar, the free RAM and the 5h / wk meters sit in one
  bordered button with a divider between them. Click the RAM figure: Consumers opens ranked by RAM; click a meter: it
  opens ranked by tokens; a second click closes it. Hover a meter: the tooltip says "resets at HH:MM" for the 5-hour
  window and "resets <Day> HH:MM" for the weekly one, not a countdown. Not yet seen in the running app.

**2026-10-13 (Sync from the kaeltran16 fork)**

- [ ] (arcterm) **Claude mod after the merge.** In a Claude session in arcterm, ask a question with AskUserQuestion,
  dismiss it in Claude's dialog: the cockpit card goes away and the agent reads idle. Then answer one from the card: the
  dialog closes. `claude/arc-mod/hooks/register.ts` (ask kept ours; cache-miss band added from the fork).
- [ ] (arcterm) **Consumers with CPU and commands (Windows).** Have an agent run something long (`git log --all -p` in a
  big repo), click the app bar's RAM chip: the panel reads `N GB free · arcterm N GB · N% CPU · 5h N%` on one line; the agent's row
  names `git log --all -p` after its name with its CPU, RAM and 10-minute spend (CPU reads – for the first 2-4 s);
  ⋯ → Kill git log --all -p asks, then kills it and notes "Killed git log --all -p." under the row while the agent
  keeps running. No Resource Manager popover, no footer readout. `frontend/app/view/agents/consumerspanel.tsx`,
  `frontend/app/cockpit/resmon.ts`.
- [ ] (arcterm) **Review marks in the Diff surface's Log tab.** Open a commit's file, press `v`: the row's check fills and
  the next unreviewed file opens; the bar reads 1/n reviewed. `frontend/app/view/agents/changedfilelist.tsx`.
- [ ] (arcterm) **Final verification row.** Start a plan run with a Final: once the dag is finalizing, the agent list
  shows a Final verification row under the run, its pane shows the steps, and the Agent rail's Final section shows for
  it. `frontend/app/view/agents/agenttree.tsx`, `agentsurface.tsx`.
- [ ] (arcterm) **Bubble click opens the agent.** When Jarvis says a one-off line for an agent (a cache-miss notice),
  clicking the bubble opens that agent's terminal instead of the chat. `frontend/app/view/jarvis/petview.tsx`.

**2026-10-13 (Terminals and tools)**

- [ ] (arcterm) **Install two tools with winget.** Setup → Tools, pick `glow`, press **Install**: an `Install glow`
  terminal opens in the project you are in and the row reads `installing`; when winget exits 0 the terminal closes by
  itself (about 2 s) and the tool reads `installed`, or `not found on PATH` with the hint to restart arcterm (PATH is
  read once, at launch). Do the same for a second tool (`lazygit`). Also run `winget show --id <id> -e` for the nine
  ids in `pkg/arctools/catalog.go`: the ids drawn on the canvas were illustrations. `0f8df9836`, `363ed96be`
- [ ] (arcterm) **An install that fails.** Setup → Tools → **Add your own tool** with a command that is not on PATH and
  the install command `cmd /c exit 1`, then **Install**. The row reads `install failed` in the library and, under the
  project's divider, in the tree (its terminal stays open); **Open output** shows that terminal, **Try again** runs the
  install once more. `0f8df9836`, `363ed96be`
- [ ] (arcterm) **A tool in a Mac build (brew).** On Apple silicon: Setup → Tools → **Install** `glow` runs
  `brew install glow` in an `Install glow` terminal; then open it with `Cmd+Shift+T`. A Finder-launched app has a short
  PATH: check the library reads `found at …` for a tool brew put in `/opt/homebrew/bin`, or shows the restart hint,
  and that `brew` itself is found by the install terminal. `0f8df9836`
- [ ] (arcterm) **A tool in the tree and the centre.** With an agent focused, `Ctrl+Shift+T` → lazygit: a lazygit row
  sits under the divider of the agent's project and the tool shows in the centre, in the agent's folder (a worktree
  agent gives the folder chip). `Esc` and the arrows work inside it; a quick `Ctrl+Tab` flips to the agent and back
  with lazygit's screen as it was; quit lazygit and the terminal stays at its shell prompt in that folder, its row now
  reading the last command. `3af7fd154`, `962e5c80a`
- [ ] (arcterm) **A removed worktree.** Open a terminal in an agent's isolated worktree, then land the agent's branch
  so the worktree goes: the terminal's row strikes its folder through and reads `removed`, and its pane shows the card
  "This terminal's folder was removed" over its last screen; **Reopen in `<project>`** opens a terminal at the project
  root, **Close terminal** closes it. `301dae8bc`

**2026-10-13 (Usage → Insights: ranked levers)**

- [ ] (arcterm) Usage → Insights levers: Re-analyze once in the installed app; the levers' sizes look plausible against the By session table and the card draws Claude's words. (That real Claude answers the JSON prompt was checked 2026-10-13 with one live `Analyze` on a built digest, in Vietnamese: it parsed with all five levers, valid refs, and the headline citing the digest's own numbers.)

**2026-10-13 (Spider-Man pet: held strand, crawl art, a grab mid-descent, idle mid-hang)**

- [ ] (arcterm) **Spider-Man hangs under the pointer.** With Spider-Man as Jarvis, press him anywhere and drag: he
  eases 4 cells under the pointer with his raised hand right under it, and the strand runs from the pointer to that
  hand; let go and the strand stays where you let go while he rappels down, his hand drifting back to centre.
  Hover him while he hangs under the app bar and grab him at once, while he is still coming down: he stays under the
  pointer instead of sliding off it. Under the app bar, the crawl reads as one body (boots and gloves on the bar, the
  head with its eye in front). `petview.tsx`, `petsprite.ts` SPIDEY_CRAWL.

**2026-10-13 (Spider theme: the web sits behind the sidebar)**

- [ ] (arcterm) **The web is behind the icons.** Under the Spider theme on the Agent surface, the top-left web shows
  through the gaps of the nav rail and the agent tree, under the Cockpit/Jarvis icons and the Conversation History row,
  and reads as one web across the rail's border (also after narrowing the window until the rail drops its labels); no
  web at the bottom right over the terminal or the Stop button. `frontend/app/view/agents/themedecorview.tsx`
  (`PanelWeb`).

**2026-10-13 (Folded Spider-Man shows how many agents work)**

- [ ] (arcterm) **Folded Spider-Man carries the count.** With Spider-Man as Jarvis and two or more agents working,
  fold the window (Ctrl+M): beside the rooftop's top-right corner a pill shows his web and the number working, matching
  `wsh agents list`'s `working` rows, also past four, where the lit windows stop; with none working and Jarvis idle the
  pill is gone, and a waiting chip sits under the pill. `frontend/app/cockpit/sprout-mini.tsx`.

**2026-10-13 (Sidebar: folds slide open and closed)**

- [ ] (arcterm) **Sidebar folds animate.** Click the Conversations header and a project folder in Conversations: the
  rows slide closed and open (~0.3 s) instead of vanishing; the first paint and a section reopened with its folders
  open do not replay. Tab to a row after it opens: its focus ring is not clipped. (The Active and Terminals sections
  became the one project tree, whose folders animate row by row.) `agenttree.tsx` FoldBody, `motiontokens.ts`
  foldReveal, `agentsidebarmodel.ts` folderBlocks.

**2026-10-13 (Sidebar: a plan run's line drops the lead suffix)**

- [ ] (arcterm) **A run's line shows its count.** Start a run from a plan file and look at its row, and its lead's
  row (with tokens and age), in a narrow sidebar: the line reads `⌄ 1  Plan review · 0/N` (later `Working · k/N`)
  without being cut; widen the sidebar and the chip reads `1 worker` again. Hovering the progress shows
  `… · lead starts if needed` (or `lead closed`), hovering the chip `1 worker`.

**2026-10-13 (Click a file's path to copy it)**

- [ ] (arcterm) **The path copies on click.** Open a file in an agent's File tab, hover its path (a grey fill, the
  tooltip shows the full path and "Click to copy"), click it (a check shows after the path, the full path is on the
  clipboard); no copy icon beside Pin. The same in Code's path bar above the editor.

**2026-10-13 (Terminal: right-click copies or pastes)**

- [ ] (arcterm) **Right-click copy/paste in a terminal.** In an agent's or a shell terminal: highlight text (it lands
  on the clipboard), right-click once with it still selected (copies, the highlight clears); right-click with nothing
  selected (the clipboard pastes after a short beat); right-click twice quickly (the menu opens, nothing pastes).
  Settings → Terminal → Right-click to paste off: one right-click opens the menu again. Also try it on a Mac (no word
  gets selected under the pointer). `term.tsx` handleContextMenu, `termrightclick.ts`.

**2026-10-13 (Canvas: three board tabs and arrows)**

- [ ] (arcterm) **Three tabs and ‹ › on a canvas with many boards.** Open a canvas with more boards than fit a tab
  row (terminal-tui, 8): on LibraryAdd the bar reads `‹ Library [LibraryAdd] Main 2/8 ⌄ ›`, the open board underlined in
  the middle; › moves to the next board and the three tabs slide with it, ‹ back, a click on a neighbour opens it, and
  4/8 opens the menu. Mark and Build this… stay whole in the bar. `canvaspane.tsx` BoardPicker, `canvasmodel.ts`
  stripWindow; CDP `canvas-many-boards` steps 1–5, not yet run.

**2026-10-13 (Canvases reopen from the palette)**

- [ ] (arcterm) **Open a canvas after a restart.** Restart arcterm, select an agent in this repo, open the palette
  and type “canvas”: a Canvases group lists the folders under `.superpowers/design` (terminal-tui, arc-pet…). Enter
  switches to that agent in canvas mode on the board. With no agent selected there is no group; a canvas another agent
  already has open lands on that agent. `command-palette.tsx` canvasItems, `openref.ts` loadCanvas.

**2026-10-13 (Resume with a message; Transcript in the New dialog's footer)**

- [ ] (arcterm) **Resume from the transcript with a message.** Open an ended session's transcript (History, or
  Transcript in the New dialog), type a line, press Enter: a new tab resumes the session and the line arrives as its
  next message. Shift+Enter is a newline, a Telex/IME Enter does not send, empty + Enter just resumes. A live session
  shows Jump → in the header and no box. `sessionsdetail.tsx` ResumeComposer.
- [ ] (arcterm) **Transcript sits beside Launch.** New dialog → pick a session under Resume: the footer reads Cancel ·
  Transcript shift+enter · Resume enter and the row has no button. Shift+Enter from the Start or Project column
  opens the transcript; in the Task box it is a newline. `launchermodal.tsx` footer, `launcher.ts` launcherKey.
- [ ] (arcterm) **A resume pick lapses after two minutes closed.** New → pick a session under Resume, type a task,
  close; reopen at once: the session is still picked. Close, wait over two minutes, reopen: New session is picked
  and the task text is still there. `launcherstore.ts` RESUME_PICK_KEEP_MS.
- [ ] (arcterm) **A sleeping agent's cell has a message box.** Sleep an idle agent (row menu → Sleep), select it: under
  its conversation, a box reading "message <name> to wake it… (Enter)", lined up with the transcript. Type a line and
  press Enter: the button reads Waking…, the agent wakes and the line arrives as its next message. In a 2x2 grid each
  sleeping cell has its own box. `sleepingtranscript.tsx`. CDP `agent-sleep` step 4b passes (box, Waking…, the
  message reaches agentswake) on a mocked wake; left by hand: a real wake delivering the line.
- [ ] (arcterm) **Open asleep from the New dialog.** New → Claude → pick a session under Resume: the footer reads
  Cancel · Open asleep shift+enter · Resume enter. Open asleep (or Shift+Enter): the dialog closes, the session is a
  new row on the agent list with the moon, its cell shows the conversation and the card "Sleeping since <its last
  activity>" (with the day when not today), and no claude process starts. Type in the box under it and press Enter:
  it wakes on that session and the line arrives. Pick a codex session: the button is still Transcript.
  `launchermodal.tsx` resumeSecondary, `agentsleep.ts` asleepLaunchMeta. CDP `launcher-resume` step 6 passes (the
  button, the row with the moon, the cell, the block meta, the server lists it sleeping); left by hand: Wake or a
  message starts claude on that session.
- [ ] (arcterm) **A sleeping agent survives a restart.** Sleep an agent, quit arcterm and reopen it: the agent is still
  on the agent list with the moon (not under Terminals) and its cell shows its conversation, not "No transcript
  found". Same after a reload (Ctrl+R). `agentsleep.ts` sleepingStatus, `liveagents.ts`.

**2026-10-13 (New: Ctrl+V pastes into the Task)**

- [ ] (arcterm) **Ctrl+V in the New dialog lands in the Task.** Open New (an agent row picked, focus on the Start or
  Project column), press Ctrl+V with text copied: focus moves to the Task box and the text lands at its end; with an
  image copied, a thumbnail appears under it. On a run picked from a goal it lands in the Goal. `launcher.ts`
  launcherKey `paste`, `launchermodal.tsx` onKeyDown.

**2026-10-13 (Background tasks: one green dot, with a count)**

- [ ] (arcterm) **The sidebar's background dot and the rail's running row match.** Have an agent start a command with
  run_in_background: its sidebar row shows a pulsing green dot with the count beside it (`● 1`), and the rail's
  Background tasks shows that task with the same pulsing green dot, not the accent colour. `agenttree.tsx`
  BackgroundDot, `agentdetailsrail.tsx` BG_DOT.

**2026-10-13 (Fold when you leave: stricter, on top; Sprout click opens the chat)**

- [ ] (arcterm) **Auto fold only for a maximized or full-screen app, and Sprout on top of it.** Windows, Fold when you
  leave on, arcterm maximized: switch to a maximized Chrome and wait 3 s: Sprout folds and sits above Chrome
  (`waveapp.log`: `[fold] lifting Sprout on top: lifted, joined to the foreground`). A big unmaximized window, a dialog
  or a popup that takes the focus does not fold it; neither does coming back within 3 s. Alt+Tab or click back to
  arcterm: it grows back (`[fold] main window took the foreground`). `foreground.rs` covered_on_windows,
  raise_topmost, main-foreground; `floatstore.ts` setupAutoSprout.
- [ ] (arcterm) **One click on the folded Sprout opens the chat, a double-click restores.** Fold with `Ctrl+M`: one
  click opens the Jarvis chat beside Sprout (a second click closes it); a double-click grows the window back without
  the chat flashing open. `sprout-mini.tsx` onClick.

**2026-10-12 (folded Sprout: a click restores, every Space)**

- [ ] (arcterm) **Folded Sprout on a Mac.** (Since 2026-10-15 a fold on arcterm's own Desktop stays there; Sprout
  follows only a fold over a full-screen app, see that day's entry.) Fold, `⌘Tab` away and back, press
  `⌘M`: it comes back. Pass the cursor over Sprout: no card; rest on it: the card (agents, **Ask Jarvis**, **Restore**)
  shows, also while a bubble is up, and **Ask Jarvis** opens the chat. Restore, then make arcterm full screen (green
  button): it still works, nothing threw. `macwindow.rs` set_folded_chrome, `sprout-mini.tsx`, `minihit.ts` nextHover.

**2026-10-12 (Spider-Man pet)**

- [ ] (arcterm) Spider-Man pet: drag and rappel, the crawl and hang under the app bar (hover cuts it), the web-swing on fold and unfold, the rooftop's windows and spider-sense, and the Spider theme — look in the running app.

**2026-10-12 (Fold when you leave: leave folds, return grows back)**

- [ ] (arcterm) **Leaving folds, coming back grows back, overlays do nothing.** On Windows, with **Fold when you leave**
  on and arcterm maximized: switch to an app covering over 80% of arcterm (maximized or a big window): Sprout folds
  after ~1 s; one covering half or less leaves it be. Come back by Alt+Tab, by the taskbar button, or by clicking
  arcterm: it grows back each way. Press Win+Shift+S, or lock the screen (Win+L): it does not fold. Hover Sprout and
  click an agent while auto-folded: Float opens on it, the window does not grow back. Fold with `Ctrl+M`, switch away
  and back: it stays folded; one click on the taskbar button grows it back, also when Sprout was already in front (it
  does not minimize). `waveapp.log` shows `[fold] leaving…`, `[fold] back in arcterm…`, `[tauri] taskbar button…`.
  `foreground.rs` is_overlay / watch_taskbar, `floatstore.ts` setupAutoSprout.

**2026-10-12 (A lead-less run's row)**

- [ ] (arcterm) **Clicking a plan run's top row shows a terminal.** Start a run from a plan file
  (`wsh runs start --plan`) and, while its plan review or a worker is running, click the run's top row in the Agent
  sidebar: the reviewer's or worker's terminal shows and its row reads selected. Double-click it: the terminal takes
  your typing. Click it while every task is still queued: the run only unfolds. The workers chip still folds it.
  `agenttree.tsx` RunRow, `runlineage.ts` runFocusAgent.

**2026-10-12 (Background tasks on the sidebar glyph)**

- [ ] (arcterm) **An agent's sidebar ✳ carries its state, and a green dot its background tasks; Close waits for
  them.** Rows: a working agent's ✳ pulses in the accent colour, an asking one's in yellow, an idle or sleeping one's is
  grey and still, and the second line has no state dot. Have a Claude agent run something long with
  `run_in_background` (a `sleep 120`), let its turn end and commit: a green dot pulses slowly on its second line,
  hovering it lists the task, and neither the row's ✓ Close, the header's Close nor its key shows. Within ~15 s of the
  command ending the dot goes and Close appears. `agenttree.tsx` RuntimeGlyph / BackgroundDot, `donesuggest.ts`.
  The CDP scenario `sidebar-agent-glyph` covers the colours, the dot and Close on fixture rows; what is left to try by
  hand is a real task ending and its dot going.

**2026-10-12 (Mouse wheel in a restored Claude fullscreen pane)**

- [ ] (arcterm) **The wheel scrolls a Claude agent in fullscreen (`"tui": "fullscreen"`) after arcterm restarts.**
  Start a Claude agent, have a few turns so it overflows, wait ~10 s (the pane's cache is saved when idle), restart
  arcterm, then wheel over that agent: the conversation scrolls. Before, the restored pane sent X10 mouse reports
  Claude ignores (the cache lost `ESC[?1006h`). A pane restored before this fix stays broken until its Claude is
  relaunched. `termmodes.ts`, `termwrap.ts` processAndCacheData.

**2026-10-12 (Run sheet with a long goal)**

- [ ] (arcterm) **A long goal opened with Show more no longer swallows the run sheet.** In Jarvis, open a run whose
  goal is several paragraphs and click Show more: the top (verb, meter, goal) scrolls on its own within half the
  sheet, the tasks below still scroll, and the dock at the bottom (with the screenshots button) stays in view.
  `runsheet.tsx` Reading.
- [ ] (arcterm) **An earlier Final round's screenshots stay while the next round runs.** On a run whose Final is on
  round 2 or later and still running (reading says "final: running Verify"), the dock shows **Screenshots · N**, and
  the Final check row under the tasks reads "N shots · round 1"; both open round 1's shots. `finalshotsmodel.ts`.

**2026-10-12 (Outline with many headings)**

- [ ] (arcterm) **A long document's Outline scrolls instead of squeezing.** Open a markdown file with 30+ headings
  in the Agent panel's File tab (Preview), click Outline: each row is full height and readable, and the list
  scrolls. `docoutlineview.tsx`.

**2026-10-12 (Final check viewer arrows)**

- [ ] (arcterm) **← → walk every screenshot of a Final check round.** Open a run's Final check screenshots on a
  round of plain PNGs (one tab per file): → and ← move tab to tab, and the selected tab scrolls into view; on a
  manifest round, → past a scenario's last shot opens the next scenario's first. ↑ ↓ still step scenarios.

**2026-10-12 (type into the task from the New dialog's Start column)**

- [ ] (arcterm) **A letter in the Start column starts the task.** Mod+N, `1`, type `fix`: focus is in Task and it
  reads `fix`, a saved draft kept before it. With Unikey/EVKey Telex, typing `vieets` from the Start column gives
  `viết`, the first letter included; with the Windows Vietnamese IME the first key may do nothing (it is skipped on
  purpose). Pick Orchestrate → A plan file: letters do nothing; pick Terminal: nothing; the footer shows `a–z task`
  only when a letter would write. (`launcher.ts` `launcherKey` "write", `launchermodal.tsx`)

**2026-10-12 (path links from another folder)**

- [ ] (arcterm) **A path an agent names from a subfolder is a link.** In an agent that worked on
  `obsidian/seminar_cycle2/huong_C/plan_cycle2_C_rulegen_20261011.md` from the mit-thesis root and wrote it back as
  `huong_C/plan_cycle2_C_rulegen_20261011.md`: hovering the path underlines it, Ctrl+click opens the file in the
  agent's File tab. A path two touched files both end in stays plain. (`pathlinks.ts` `matchKnownPath`,
  `pathlinkroute.ts`, `termpathlinks.ts`)

**2026-10-12 (images in File tab and Code)**

- [ ] (arcterm) **An image opens instead of "Binary file".** Open a `.png` (e.g. `docs/guide/images/agent-rail.png`)
  from the Agent panel's Files list, in Code, and in Code's side column: it shows fitted with "W × H · size" under it;
  a click shows it at its own size with scrollbars, a second click fits it again. Try an `.svg` too. (`imageframe.tsx`,
  `codeclassify.ts`)

**2026-10-12 (File tab header)**

- [ ] (arcterm) **Icon-only Outline, Wrap and Pin in the File tab.** Open a markdown file in the Agent panel's File
  tab: the header shows Preview/Source then icons only (Outline, Pin, Copy path, Open in Code); Pin turns into a filled
  accent pin when on, and its tooltip says "Unpin this file"; Outline still opens its list. In Source, the Wrap icon
  toggles accent. On Code, the bar above the editor shows Wrap, Pin and Copy path as icons the same way, `Alt+Z`
  still lights Wrap, and Copy path flashes a check. (`filetab.tsx`, `docoutlineview.tsx`, `codepathbar.tsx`)

**2026-10-12 (shortcuts, window, terminal)**

- [ ] (arcterm) **Plain Ctrl in a terminal, Windows.** In a Claude Code terminal: `Ctrl`+`P` opens Search, `Ctrl`+`G`
  opens the go-to bar, `Ctrl`+`N` the New dialog, `Ctrl`+`M` folds into Sprout, `Ctrl`+`J` opens What's waiting
  (Shift+Enter still makes a new line); `Ctrl`+`Shift`+`W` asks to close the agent. `d80e14b74` and the commit after it
- [ ] (arcterm) **Mac chords.** `⌘=` / `⌘-` / `⌘0` zoom (not Control any more); `⌘⇧Enter` toggles terminal
  fullscreen from inside the terminal; `⌘K` clears the terminal (Mac only). `cc7a43629`
- [ ] (arcterm) **The `?` button**, both machines: at the bottom bar's right end on every surface, also while typing in a
  terminal; it opens the cheat sheet. `cc7a43629`
- [ ] (arcterm) **VS Code keys.** `Mod`+`,` opens Settings; on Code, `Mod`+`Shift`+`E` focuses the file tree.
  `cc7a43629`
- [ ] (arcterm) **Auto fold, Windows** (Settings → Jarvis & Office → Folding → Fold when you leave, on): a maximized or full-screen
  app on arcterm's screen folds it after ~1 s; a small window, a half-screen snap, the Start menu or a window on the
  other screen leaves it be. `d80e14b74`
- [ ] (arcterm) **Auto fold, Mac.** `foreground.rs`'s macOS branch now reads the window list (`CGWindowListCopyWindowInfo`)
  and folds when the frontmost other window above arcterm covers 80% of it; the first one, `NSWindow.occlusionState`,
  never folded (a zoomed Chrome right over arcterm left it "visible"). Unit-tested, and checked once against the live
  window list. Left, by hand on a Mac build: a maximized Chrome over arcterm folds it after ~1 s, and so does a
  full-screen app (its own Space: if the Space animation outlasts the 800 ms wait, it does not, and the wait wants a
  second look); a window beside it, one on another screen, and a screenshot leave it be.
- [ ] (arcterm) **Canvas board picker.** With more boards than fit the tab row, open the picker: the board before the
  shown one wears `[`, the one after it `]`. `d80e14b74`
- [ ] (arcterm) **Double-click a sidebar row** (a run's lead row too): it selects the agent and typing goes into its
  terminal; it no longer folds the workers (the `N workers` chip does). `d80e14b74`
- [ ] (arcterm) **Ctrl+C copies, Windows.** In a terminal, select text and press `Ctrl`+`C`: it is copied and the
  selection clears, nothing is interrupted; press it again with nothing selected and it interrupts. After a restart
  of `task dev` (the default lives in wavesrv), highlighting no longer copies unless Copy on select is on.
  `6bb81dd0b`
- [ ] (arcterm) **Tick a task box in a markdown Preview.** Open a `.md` with `- [ ]` lines in the Agent panel's File
  tab, Preview: click a box; it ticks, the file on disk now reads `- [x]` on that line, and the scroll stays put.
  Click again to clear it. `65179f6b8`
- [ ] (arcterm) **Worktree facts in the Agent panel.** Select an agent working in a linked worktree (a run worker):
  Overview's session block reads `project · model`, then `⑂ wave/ae9e6a71 · 📁 ae9e6a71` (ids cut to 8 digits) with
  the full branch and path in the tooltips; an agent in the main checkout keeps `project · ⑂ branch · model`. `7c5074e8f`
- [ ] (arcterm) **The redrawn RAM and tokens panel.** Open it from the app bar: a RAM bar (arcterm, other apps, free)
  under the free-memory line, column heads, tokens and spend in their own columns, and a row's Stop, Sleep and
  → Sonnet only while you point at it; arcterm's own processes on one line. `70bfd1cd9`
- [ ] (arcterm) **Pasted images in the transcript.** Paste an image into the New dialog's Task and start the agent:
  the image shows in the transcript, live and when the session is read back, not "no longer on disk". In the New
  dialog a click on the thumbnail shows it larger under the row, and another click shrinks it. `78fad34cf`

---

## 1 · Actionable

| Item | Kind | Effort | Source / notes |
|---|---|---|---|
| (arcterm) Scenario steps that fail in a Final on a Mac and are not the settings reorganization's: `settings-pages` agents-detail and `settings-storage` step 11 read the DOM once before it redraws (racy), `settings-telegram` step 3 needs `ARC_TELEGRAM_API_BASE`, which `final-verify.mjs` does not set, and `agy-harness` 2/5/6/7/9, `route-picker-flat` (too few fixture rows to scroll) and `jarvis-pet` 8 fail on the base too. Each is a chunk of effort `c721a0be` (11–16) with its cause | verification gap | M | run d09b9dd1 Final, `data/final-shots/f983b4e3-ff58-410d-9457-f3007b0cb39e/1/shots.json`; `scripts/cdp/scenarios.mjs` |
| (arcterm) Engine worktrees moved to `%LOCALAPPDATA%\arc-wt\<8 of run id>` with the kaeltran16 sync (2026-10-13), but our own path readers still look only under `<project>/.waveterm/worktrees`: the sidebar's grouping of engine conversations under their project (`agentsidebarmodel.ts` `ENGINE_WORKTREES`), Claude project mapping (`pkg/agentsessions/claudeprojects.go`), Settings → Storage's engine-tree cleanup (`pkg/storage/worktrees.go`) and Usage's "engine run" project label (`pkg/usagestats/sessions.go` `projectOf`). `orchestrate.runOfWorktree` already reads both | bug | M | `pkg/orchestrate/worktreeroot.go`, `launchorigin.go` `runOfShortTree` |
| (arcterm) Not ported from the kaeltran16 sync (2026-10-13): Usage's **By work** lens (spend by project, run and session; `usageattribution.ts` and the backend's session directory are in, our tabbed Usage surface does not draw it), the New run goal's file-pick button (it lived in the fork's `newruncontrol.tsx`, which our New dialog replaced), and the fork's `docs/orchestrator-guide.md` changes (short worktree root, cleanup round, final stage row) into `docs/guide/orchestrator.md` | feature | M | merge of `kael/main` 713f11140; dropped scenarios `usage-work`, `new-run-attachments`, `run-sheet-carry` |
| (arcterm) Final on a Mac checks Chromium, not WKWebView: `task dev:browser` runs the scenarios in headless Chrome, so WebKit-only behaviour (the File tab Source view's Ctrl+Enter, IME, scrolling) and the scenarios marked `host: true` (notify-toast, float-mini, jarvis-modes) still need a hand check in the real app or a Windows run | verification gap | S | `scripts/cdp/browser-app.mjs`, `scripts/cdp/final-verify.mjs` (`hostOnlyScenarios`); AGENTS.md "Visual verification"; run 915dc28d (2026-10-12) |
| (arcterm) Token burn guard part (1) shipped (a Token burn card before a costly `Agent`/`Task`/`Workflow` spawn). Left: nothing warns while a session burns its 5h window through cache reads (a docs session went ~20M → ~220M tokens in an hour): a burn-rate toast, cache reads shown apart in Consumers, a whole-run cost estimate at plan submit, exempting engine runs | feature | M | `docs/deferred.md` "Token burn guard"; complements `docs/superpowers/specs/2026-10-07-quota-guard-design.md` |
| (arcterm) The Claude sign-in dialog's `TokenScanner` is tested only on synthetic output: the `settings-claude-account` scenario runs a node stand-in through the dev override `arc:dev:setuptoken-cmd`, never the real command. Record a real `claude setup-token` run's pty output (the token redacted to a fixture of the same shape, line breaks and escape sequences kept) and add it as a `setuptokenscan.test.ts` case | verification gap | S | `frontend/app/view/agents/setuptokenscan.ts`, `frontend/app/cockpit/claude-signin-modal.tsx`; plan review of `docs/superpowers/plans/2026-10-07-claude-account-switch.md` (2026-10-07) |
| (arcterm) A Claude Code background session whose terminal has exited (and no `claude attach` tab) shows nowhere: its reports are dropped (`statusTarget`) until a tab attaches. The terminal that sent it to the background is found by its command line (`--resume <id>`) or, when that names no session (a bare `claude`, `--continue`, a picked `--resume`), by the session its block last reported (`agentobserve.DisplayBlock`, 2026-10-10); that path is unit-tested only, never exercised on a live background session. Check: send a bare `claude` session to the background, and its tab keeps its status and subagents | verification gap | S | `waveapp.log` 2026-10-06 16:40:02–16:40:20; `claude agents --json` lists the session `kind: background`; Close already stops it by the `--resume` id (`ce797bee`) |
| The 2026-10-10 fixes were unit-tested on macOS only, where WKWebView answers no CDP: the palette pick that hides its cell (focus goes to the picked agent, `modalfocusfallback.ts`), every ModalShell dialog gating the surface keys (`anyDialogOpen`), the grid holding for its saved focused cell on reload (`gridHold`; `agent-grid` step 10b passed in headless Chrome on a Mac, run 915dc28d, 2026-10-12), and the File tab Source view sending on `Ctrl`+`Enter` in WKWebView. Run `agent-grid` and `md-comments` on Windows (`md-comments` also runs on a Mac in `task dev:browser`), and try the Source view send in a macOS build | verification gap | S | the 2026-10-10 bug fixes (branch `fix/open-bugs`, landed on main 2026-10-12) |
| (arcterm) Closing an agent attached to a background session was never exercised live: `ce797bee` runs `claude stop <id>` from `WorkspaceService.CloseTab` (dry run against the real `claude agents` picked only the background session), but no wavesrv with it has closed a real one. Check: Close it, then `claude agents` no longer lists it `working` | verification gap | S | `pkg/bgagents` `Stop`, `pkg/service/workspaceservice` `tabSessionIds` |
| A run whose lead is down is visible only on the Cockpit: its card shows "Lead down" and "Lead wake failed" with **Relaunch lead** (`leadcard.tsx`, `orchestrate/relaunchlead.ts`). The Agent surface's run row only reads "lead closed" (`runmodel.ts` `dagProgressLabel`), with no action, and `wsh runs show` does not mention it at all. A run whose lead died in an app restart (run 74f0fa77, 2026-10-06) then sat 15 min on a failed plan review with nobody to revise it, unnoticed by a user who works in Agent/Conversation History. Since `90f4b49e` (kaeltran16 fork, merged 2026-10-07) a lead killed by an app restart is resumed at boot (`ResumeInterruptedLeads`), so what is left is a lead that resume cannot bring back. Show the lead-down state and Relaunch on the Agent surface's run row, and a `lead down` line (and a relaunch command) in `wsh runs` | feature | S | Session 2026-10-06; restart recovery itself is `docs/deferred.md` "Run recovery after a restart — dag runs" |
| Agent + Sessions merge, the 2x2 grid and Uploads were never run live: no `task check:ts`, of the four new CDP scenarios only `agent-grid` and `agent-uploads` have run, and every step passed (headless Chrome on a Mac, run 915dc28d, 2026-10-12); `agent-history` and `agent-rail-sections` have not, and a real WebView2 drag, an OS file drop and the native Attach dialog were never exercised. Clear `public/cockpit-fixtures/active.json` first (`npm run cockpit:fixtures -- --clear`): the new scenarios SKIP while it exists | verification gap | M | `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`; If WebView2 cancels a drag the instant it starts, the fix is a `setTimeout(0)` in `beginAgentDrag` (already deferred once) or moving the overlay mount later |
| `wsh ui state` cannot tell a worker that Conversation History is open (it reports `surface: agent`, `agent:<id>`): needs a `center` field in `UiState` (Go type + `task generate`) | feature | S | `frontend/app/cockpit/uiapi.ts`, `uiclient.ts`; Task 7 review |
| `useLocalImage` (shared by the Uploads lightbox, the Final check viewer and the run sheet) decodes the whole file with no size guard: a very large attached image costs hundreds of MB transiently. Check `content-length` before `resp.blob()` and add a `toolarge` status | limitation | S | `frontend/app/view/jarvis/localimage.ts`; Task 28 review |
| Duplicated rules from the merge: "choose an agent row" (`selectAgentRow` in `agenttree.tsx` and `select` in `terminalsrail.tsx`); the Open-in-split gate (seeded + `canOpenInSplit` + fallback to `openTerminal`) in `agenttree.tsx` and `cockpit/actions/agent.ts`; `blockId != null` checks beside `eligibleIds` | tech-debt | S | final integration review 2026-10-06 |
| OS-file drops on a plain terminal are recorded under its block, but `TerminalRail` has no Uploads section, so they are invisible and count toward `MAX_OWNERS` (40), which can evict an agent's older records | limitation | S | `frontend/app/view/agents/uploadsingest.ts` `ingestFiles`, `terminalsrail.tsx`; final review |
| A sidebar session scan requested inside its rate-limit gap (an exit within 1 s of the last scan, an arrival within 5 s) is dropped, not deferred: two agents closed within a second leave the second ended session missing until the next trigger | limitation | S | `frontend/app/view/agents/usesessionsscan.ts`; Task 5 review |
| Ctrl+Tab with more live agents than grid cells keeps changing which four agents show (it replaces the focused cell); Ctrl+Shift+Tab is "next asking agent, forward", not previous. Decide whether Ctrl+Tab should cycle only among agents already in the grid | held decision | S | `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`; plan `Decisions to confirm` 1 and 4 |
| Markdown comments in the File tab (Preview, cards, the three gestures, the tray) were never run live: the run's Final stage ran on macOS, where WKWebView answers no CDP, so none of the 17 steps of the `md-comments` scenario ran. Run `node scripts/cdp/final-verify.mjs md-comments` on Windows and compare the shots with the mockup boards (`.superpowers/design/md-comments/project/`, gitignored: keep it until then). Step 12 also checks that the Cockpit card of a roster agent with no `blockId` still shows its inline `docs/guide.md` link | verification gap | M | `docs/superpowers/specs/2026-10-06-md-comments-design.md`; run 74f0fa77 |
| (arcterm) A Claude account at its usage limit is not marked exhausted: a token account at its limit never finishes a turn, so arcterm never learns its quota from it (`/api/oauth/usage` refuses a setup-token with 403, so `claudequota` cannot ask either), and the picker shows its last snapshot, or "Not used yet", while it sits at 100%. Noting a 429 usage-limit answer from an agent on it as "exhausted until the window resets" is not done: it needs the agent's hook to report the refusal (and the reset time Claude prints with it) and a snapshot written at 100% with that reset | feature | M | `docs/superpowers/specs/2026-10-07-claude-account-switch-design.md` decision 8; `frontend/app/view/agents/ratelimitstore.ts`, `cmd/wsh/cmd/wshcmd-agenthook.go` |
| (arcterm) A dag child's question that a human owns is not in the Cockpit's "Cần bạn" strip: the strip lists the attention list's gates, blocked tasks, runs to accept or land and escalations, and `ChildAskCard` (answered through `DagAsksCommand`) is fed by the run sheet and the agent rail, not by `GetAttention`. It stays there, and the Cockpit and dock badges do not count it. Listing it in the strip needs the attention list to carry it, with an answer path through `DagAsksCommand` rather than the agent's block | feature | M | `docs/superpowers/specs/2026-10-07-cockpit-needs-you-design.md` decision 5; `frontend/app/view/agents/childaskcard.tsx`, `frontend/app/view/agents/needsyoustripmodel.ts` |
| (arcterm) Whether `/model` applies inside a running Claude turn was never checked (the Consumers plan's Task 1 spike could not drive a session: tmux is not installed on this Mac), so the panel's → Sonnet toast says "from its next turn". Check it as the spike describes; if the switch waits for the turn, add spec decision 9's fallback: a re-run of a worker's task on Sonnet through the existing `escalate` dag action (`wsh jarvis dag escalate <task> --model sonnet`) | verification gap | S | `docs/superpowers/specs/2026-10-08-consumers-panel-design.md` decision 9; Task 1 of the Consumers plan, `git show 75f82cd9:docs/superpowers/plans/2026-10-08-consumers-panel.md` |
| (arcterm) 11 user-guide shots are still `<!-- shot: … -->` placeholders: agent-history, cockpit-needs-you, code-side-column, jarvis-brief, plan-launcher-error, settings-agents, setup-skills, usage-claude-tab, usage-insights-sessions, usage-consumers-tokens, usage-low-ram-card. Each would show real data on a demo store (efforts, the Claude account email, usage from `~/.claude` transcripts, the real skills list) or its CDP scenario failed there; they need fixture data first. Take them at 1600x1000 into `docs/guide/images/` | docs | M | `docs/guide/README.md` |
| (arcterm) A lead the roster still reads as `working` after its turn ended never gets its wake: `flushLocked` sends only when the lead is at its prompt (`atPrompt(st.State)`), so the line sits queued and the run sits `dag-blocked` with nobody acting. Run aeae1cdf (2026-10-14): the lead's turn ended 15:12 (Stop hooks ran, `turn_duration` logged), `wsh agents list` still showed it `working` at 16:33, and the Final-failed wake from ~16:04 never reached it; resent by hand with `wsh agents send`. Find what leaves the state at `working` past a Stop, and give a queued wake a ceiling (say 10 min with the transcript quiet) after which it is typed anyway or the run reads "lead not answering" in Needs you | bug | M | `pkg/orchestrate/wake.go` `flushLocked`; lead transcript `~/.claude/projects/C--Users-u-AppData-Local-arc-wt-aeae1cdf/3cfe7ead-….jsonl` |

- **`final-stage` CDP scenario, Part B flakes** (2026-10-12). B2–B6 failed in 2 of 3 runs after the lead's
  Final verification block was removed from the details rail, and passed in 2 runs without that change
  (one of which failed only B6). The failing shape: in B2 the DAG modal's final node still reads the B1
  state ("waits on every task") while the tree's row shows Tree running, and from B3 on the stage row has
  lost focus (no pane). That change touches neither the modal nor focus, so the cause is unproven either
  way. Repro: `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs final-stage`, a few runs.

Tracked in their own initiatives, not here:

- **arcterm Claude mod live verify** (usage strip, card answer, Esc, dag child ask, settings hooks; `CLAUDE_CODE_PLUGIN_DIRS` loading with no enable prompt; a card answered after more than ten minutes still answers the call) — effort `99832658`, chunk 9. Each needs an interactive Claude session in the dev app; the headless half is `node scripts/claude-mod-load-check.mjs`. Spec `docs/superpowers/specs/2026-10-02-claude-mod-design.md`.
- **Orchestrator wall-clock** — effort `b1fe5d7e`: live-verify the unit-tested fixes, the round-2 final tree lock, the Timing section live check.

### (arcterm) RAM watch

- **Cockpit office** (2026-10-15, `cockpit-office-bench`, 76 people: 48 desks, 27 seats and the boss; dev app in
  headless Chrome on the Mac, a loaded 8 GB machine): every budget held. Heap −4.13 MB and −664 DOM nodes (the office
  replaces the Cards grid, so both read below Cards); busy −4.7 % over Cards while the boss and three walkers walk (22 %
  raw, baseline 26.7 %), −6.4 % under reduced motion, −15.2 % in a quiet office; 143 to 150 sprites; 37 to 65 ms to
  draw. Budgets: 5 MB, 2,000, 2 %, 0.5 %, 0.3 %, 600, 1 MB, 150 ms. Busy is from React's dev build (a
  performance.measure per render) and sits inside the baseline's noise; the production-build reading is the effort chunk
  'Re-measure: cockpit office busy on a production build'. Row 7 holds what a second Office round trip adds back in
  Cards: +0.01, −1.99 and −2.81 MB in three runs, −2.8 MB in the run's Final. Read from the first Cards read, as the
  spec first had it, the same row read −0.6 to +2.39 MB over seven runs, and a control run that never opened the office
  read +1.56 MB on that step: the dev page's own growth. Both reads come after a forced GC (`metrics()`), yet the dev
  page's heap still swings by up to about 3 MB between reads; the cause is not established, and a swing that size can
  hide a leak under the 1 MB budget.
- **Cockpit office, walking off React** (2026-10-15, same bench and machine): a walk step moved the boss and the walkers
  through their atoms, so React rendered each of them on every animation frame (~400 renders a second while the boss
  and three walkers walk, `Mover` ~205 of them). A step now writes the transform on the DOM: ~176 renders a second
  (`Mover` 26), JS while walking 8.1 to 10.6 % of a core against 9.6 to 19 % before (two 10 s holds each, read with
  `Performance.getMetrics`). The bench: busy walking −9.5 % over Cards (14.2 % raw, baseline 23.7 %), −8.7 % reduced,
  −14.8 % quiet; heap −4.96 MB, −775 nodes, 91 sprites, 74 ms to draw, +0.04 MB on the second round trip. A probe of
  the same hold found paint and raster small: drawing the static scenery (floors, walls, desk parts, 259 of the
  office's 591 nodes) as one pixel canvas, or giving the movers their own layer alone, moved busy by less than the
  holds' own noise (±3 points), and cut only the off-main-thread raster (3.7–4.6 % to 0.7–1.6 %).
- **Cockpit office in pixel art** (2026-10-15, `cockpit-office-bench`, the same 76-person roster; dev app in headless
  Chrome on the Mac, before and after interleaved, two runs each, each on its own ports and store; a loaded 8 GB
  machine, the Cards baseline read 23.5 to 35.7 %): the office's own DOM nodes 498 → 218 (the floors, walls, windows,
  dark layers, screens, sign and desk parts are now two canvases at art resolution, 391 × 1070 × 4 = ~1.67 MB each);
  busy walking −9.4 / −8.8 → −7.1 / −20.5 % over Cards (raw 16.5 / 14.7 → 18.0 / 15.2 %), reduced motion −12.2 / −8.0
  → −9.7 / −18.3 %, quiet −17.0 / −15.5 → −16.6 / −25.3 %; heap −4.29 / −4.46 → −4.70 / −5.87 MB; sprites 91 / 92 →
  95 / 95; time to draw 84 / 78 → 133 / 201 ms; a second round trip +0.03 / +0.02 MB after (−1.13 / +0.02 before).
  One budget missed: the second after run drew in 201 ms (budget 150); the first held at 133 ms, and a third after
  run, read only for the canvas size, at 118 ms. The draw is the one number that rose (about 80 ms before to 130–200
  ms), and the cause is not established: the open now waits for both canvases to paint, and the miss came in the run
  whose Cards baseline read 35.7 %. Re-measure the open on a production build or a quiet machine. Busy did not move
  beyond the holds' noise of ±3 points: the raw readings are 14.7–16.5 % before and 15.2–18.0 % after, and every
  over-Cards figure sits below the baseline, so the budgets read as held from a baseline that swings by more than
  they allow.
- **Cockpit office with the pixel-game controls** (2026-10-16, `cockpit-office-bench` at fd9c41ac0, after run 25462413's
  HUD bar, dialog box and office menu; Tauri dev app on Windows through `final-verify.mjs`, its own ports and store,
  the Cards baseline read 36.6 %): every budget held. 76 people, the office's own DOM nodes 245 (218 before the
  controls), −1174 nodes and −4.68 MB heap against Cards; busy walking −16.2 % over Cards (20.4 % raw), reduced motion
  −16.9 %, quiet −26.8 % with no clock running; 145 sprites; 115 ms to draw; a second round trip −2 MB. The first
  bench run on Windows rather than the Mac, so the busy figures are not comparable with the rows above; the
  production-build re-measure is still open.
- **Cockpit office as floors** (2026-10-16, `cockpit-office-bench`, the same 48 agents over six projects and three
  fixture runs; two runs, in the Windows dev app (WebView2) on a loaded machine, so the absolute figures do not compare
  with the Mac's above): the office draws one floor of four rooms, so it holds 31 people (20 desks, 10 seats and the boss)
  where it held 76, on two floors (G and 1); its own DOM nodes 218 → 113, −1,345 / −1,347 over Cards; heap −5.67 / −5.16
  MB; busy walking −13.5 / −20.8 % over Cards (raw 14.9 / 22 %, baselines 28.4 / 42.8 %), reduced motion −15.2 / −28.5
  %, quiet −18.4 / −32.3 %; sprite cache 81; a second round trip −0.73 / −0.66 MB; time to draw 76 / 155 ms. One budget
  missed: the second run drew in 155 ms (budget 150), with its Cards baseline at 42.8 % against 28.4 % in the first,
  which drew in 76 ms: the same noise as the pixel-art entry's miss, so re-measure the open on a production build or a
  quiet machine. The bench's roster check (step 0) now asks for a full floor of about 30 people and a second floor,
  not 75 people.
- (arcterm) telebot (2026-10-16): one long-poll goroutine + 2 s ticker; measure wavesrv RSS on/off.
- **Cockpit office pet boss** (2026-10-16, `cockpit-office-bench`, one run through `final-verify.mjs` in the Windows dev
  app (WebView2), the same 31 people on two floors as the floors entry above, which is the before: it was measured on
  this run's base commit, where the boss was still the chibi `<img>`; the Cards baseline read 28 %, as in that entry's
  first run): every budget held. The boss is now an `<svg>` of the pet's cells (Sprout's 99 at rest, the Minion's 115)
  in a button, so the office's own DOM nodes 113 → 214 (+101) and nodes added over Cards −1,345 / −1,347 → −1,244; heap
  −5.67 / −5.16 → −5.12 MB (+0.55 / +0.04); sprite cache 81 → 74 (the boss no longer goes through it); a second round
  trip −0.73 / −0.66 → −0.73 MB; time to draw 76 / 155 → 104 ms. Busy: walking −13.5 / −20.8 → −6.5 % over Cards (raw
  14.9 / 22 → 21.5 %, baseline 28.4 / 42.8 → 28 %), reduced motion −15.2 / −28.5 → −7.5 %, quiet −18.4 / −32.3 → −22.5
  % with no clock running. Walking is the one figure that moved against the pet: with a baseline close to the first
  before run's, the raw reading is 6.6 points higher, though inside the 14.9–22 % spread the two before runs had. The
  likely cost is the boss redrawing its ~100 rects on each walk frame (8 a second); one run cannot tell that from noise,
  so it joins the production-build re-measure already open. Budgets: 5 MB, 2,000, 2 %, 0.5 %, 0.3 %, 600, 1 MB, 150 ms.
  The pet's entrance is a one-off 0.5 to 2.2 s as the office opens and is skipped in the bench (`entrance: "skip"`), so
  none of these include it.
- **Office music** (2026-10-16, not measured): to measure by hand: arcterm's WebView2 processes in Task Manager, Office
  open, music off then on for a minute (spec estimate 1–3 MB). Nothing exists with the Office closed or music off but
  the jingles' short-lived nodes. The `office-sound` scenario logs the cues and plays no sound, so it reads no memory.

---

## 2 · Blocked

### Remote/WSL worker host operations

Git surfaces break for SSH/WSL workers because they run on the local host. Not routable today: agent
launch has no connection parameter, `Run`/worktree/`AgentVM` carry no connection field, and the remote
impl doesn't register `GitChangesCommand`/`GitDiffCommand`. Prerequisite chain: (1) remote agent launch
threading connection through launch → run → worktree → `AgentVM`; (2) register host-bound commands on
`wshremote` (or expose `wshserver` handlers over the connection route); (3) then route keyed off the
agent's connection, local default. Effort realistically L counting step 1. Full reference design in git
history (pre-consolidation issue 5). The E8 connserver readiness handshake (patch saved, needs a live
SSH/WSL verify) rides on step 1.

### (arcterm) Codex sessions not shown on a Mac

Reported 2026-10-10: Codex sessions do not show on a Mac; it is not yet known whether that is Conversation History or
the rail. Not reproduced: no Mac at hand. The scanner reads `~/.codex/sessions/**/rollout-*.jsonl` on every OS
(`pkg/agentsessions/agentsessions.go` `allProviders`), with nothing Mac-specific. Suspects: a newer Codex there that no
longer writes rollout jsonl (Windows `codex-cli 0.162.0` already keeps `thread_history_1.sqlite` beside it), a
`CODEX_HOME` the scanner ignores, or, for the rail, an install older than the Codex hook support (`a5deee7d`) or hooks
not yet trusted with `/hooks`. On the Mac first run: `codex --version; echo $CODEX_HOME; ls ~/.codex/; find
~/.codex/sessions -name 'rollout-*' -mtime -3 | head -3; grep -c codex-hook ~/.codex/hooks.json`.

---

## 3 · Held — pick up only on the named trigger

Each names its revive condition in `docs/deferred.md` unless a source is given.

Harnesses:

- **(arcterm) agy kept but unverified: decide 2027-01-15** (2026-10-15) — unused, since the AI Pro plan does not
  reach argon, and installed nowhere, so its fixture-based tests can stay green while it breaks. Keep and check it
  live if the plan reaches argon by then, otherwise remove it; notes in `docs/deferred.md`.

Cockpit and surfaces:

- **(arcterm) Image diff in File mode** (2026-10-19) — the image diff shipped in Diff → Review only; File mode
  still shows "Binary file", and no CDP scenario covers it. Revive when a changed image in File mode is wanted.
- **(arcterm) Per-tool shortcuts in the tool library** (2026-10-13) — Setup → Tools has no Shortcut field until the
  `Ctrl`+`G` leader-chord question (a tool as a leader chord beside the go-to letters) is settled. Revive when the
  picker's `Ctrl`+`Shift`+`T` is too slow for one or two tools; notes in `docs/deferred.md`.
- **(arcterm) Windows taskbar overlay badge when arcterm is backgrounded** — OS notifications ship
  (2026-10-07) and the Dock badge covers macOS. Measure first that it is missed (`dockbadgesync.ts`).
- **Conversation History's "All activity" rows peeking a run, agent or initiative** (2026-10-01; the old
  Sessions surface moved into the Agent surface 2026-10-06) — revive when a row carries a target; wire it
  through `openOrPeek`.
- **(arcterm) Saved actions: one-click commit, pull and other chores** (2026-10-09) — each action a `cmd` (no
  tokens) or a `prompt` to the selected agent (commit, which needs judgment). Revive when the same chore prompt is
  typed by hand often; design with the Diff surface's repository actions, notes in `docs/deferred.md`.
- **(arcterm) Preview pane for localhost dev servers and HTML files** (2026-10-08) — iframes, not a browser;
  HTML needs its own scoped `/preview/<token>/…` route, never `/wave/stream-file` (it leaks the authkey). Revive
  when opening a dev server or `.dc.html` canvas outside arcterm becomes routine; design in `docs/deferred.md`.
- **(arcterm) Line comments in the Spec/Plan review dialog** (2026-10-07) — reuse `MdDoc`, sent with
  Request changes. Revive when Spec review notes keep pointing at specific passages; settled design in
  `docs/deferred.md`.
- **(arcterm) Editable LaTeX visual mode, Overleaf style** (2026-10-07) — needs CodeMirror 6 beside Monaco;
  the read-only `.tex` Preview covers reading. Revive when switching Preview ↔ Source is the complaint.
- **(arcterm) Session scan cache on disk** (2026-10-06) — skip the first History load's 0.5 s cold parse
  after a launch. Revive when a cold `ScanSessions` measures over about 1 s.
- **(arcterm) In-app auto-update, Chrome style** (2026-10-06) — `tauri-plugin-updater` plus the NSIS
  installer's `/P /UPDATE /R`. Revive when releases are published somewhere the app can fetch without
  signing in.
- **Code and Diff in the nav rail: re-measure ~2026-10-20** (2026-10-06) — drop them from the rail if they
  are reached almost only through the Agent panel's "Open in…" buttons, the palette and `g b` / `g f`.
- **Markdown comments in the Agent panel: re-measure ~2026-10-20** (2026-10-06) — count the sends; near
  zero removes the comment gestures and the tray, keeping the Preview.
- **Terminal file drop → the original file's path** (2026-09-30; a drop pastes a temp copy's path since
  2026-10-06, `6eeab650`) — the original path needs Tauri's `dragDropEnabled`, which disables HTML5 drag
  app-wide.
- **Work on an initiative — "Save place and close"** (2026-09-29) — revive when losing a session's place
  recurs.
- **Run recovery after a restart — New Agent sessions** (2026-09-30) — revive when a session is seen
  re-running its launch prompt.
- **A lead's terminal pane rendering blank while the backend holds its output** (2026-10-05) — seen once,
  2026-09-21, on a lead launched into a freshly restarted dev app: `wavesrv` held 32 KB of scrollback
  (`filestore.db`, `db_file_data`, `name='term'`) and resizing did not repaint. Never reproduced. Revive
  when it is seen again: note the block id and keep `waveapp.log` before touching the pane. No repro
  loop exists, because nothing exposes the xterm buffer to CDP.
- **Cross-surface ideas from the cockpit-focus spec** (2026-09-22; focus itself was removed 2026-10-06) —
  relationship annotation, companion split, time correlation, drag courier.
- **Resource linking beyond navigation** (2026-09-17) — Related Work, the Work Trail strip, structured
  refs, file/diff/commit/session targets, a shared action builder, usage-to-work links.
- **Cross-surface Back history and its context strip** (2026-09-17) — the parked branch
  `feat/surface-integration` and its commit `09e86573` are gone (2026-10-09); reviving means rebuilding it.
- **Composer attachments** (2026-09-18) — revive when attaching a file to a goal or steer is wanted.
- **Diff surface repository actions (Spec B)** (2026-09-04) — checkout, cherry-pick, revert. Commit, fetch, pull
  and push shipped 2026-10-09 (`docs/superpowers/specs/2026-10-09-diff-commit-log-redesign-design.md`). Needs its
  own spec; revive when one of those three is wanted from the Diff surface. The orphaned revert path was deleted
  2026-10-05, recovery commands in `docs/deferred.md`.
- **Diff surface: hiding whitespace-only files from the change list** (2026-09-11).
- **Incremental stateful transcript projection** — only if the capped re-project profiles hot (CDP /
  React-DevTools pass against a populated cockpit first).

Orchestrator:

- **Cross-run Verify hold under `--landing checkout`** (2026-09-15) — one run's failed Verify does not
  hold another run's merges in the same checkout. Branch landing, the default, is unaffected.
- **Lead-authored task routing, Phase 4** (2026-09-17) — the cost/outcome measurement gate. Revive on
  evidence that cheap-first routing waste is common.
- **DAG liveness batching (M1)** — 42.7 ms per running task per 30 s tick on 191 session files; build
  the per-schedule snapshot only when the corpus nears ~3,000 files.
- **Automated board rendering** for the final verifier — revive when a verdict misses a layout defect a
  rendered board would have caught (spec `docs/superpowers/specs/2026-09-25-orchestrator-findings-fixes-design.md` §5).
- **A cheap-model route for judging sessions** — revive when the judging roles are a material share of
  a run's tokens (same spec).
- **An idle-lead watchdog after the dag is done** — revive on a run whose lead sat idle at `run
  finished` without completing (same spec).

Radar:

- **Metadata collectors and the clustering pipeline** (retired 2026-10-06) — revive when chunk 8 of
  `effort:1557171a-e61d-4b29-83fd-fc7f818e6131` measures the fix-sibling audit as not worth keeping.
- **Security review audits** (held 2026-10-13) — revive with a classifier flag for trust-boundary commits
  and a fresh probe; `docs/deferred.md` keeps the probe's prompt.
- **Missing test coverage audits** (held 2026-10-13) — revive if Radar is to report test gaps as their own
  finding type; `docs/deferred.md` keeps the probe's prompt.

Memory hygiene:

- **Pi and Codex memory, merges across batches, a retention score / LRU ordering** (2026-10-14) — each
  with its own revive condition in `docs/deferred.md`.

Jarvis (what survived the 2026-09-22/23 memory and recall-arm removals):

- **U2 Tasks:** in-Wave `## Notes` editing; decision supersede UI (backend `SupersedeDecision` exists);
  manual dossier creation; live push.
- **E Continuity:** a cheap model tier for boundary summaries; completed-task prose re-freshness; a
  per-task resume card beyond the pet's newest-narrative peek.
- **D attribution tuning:** `timeBoxMs` 30d, `weightLayer3` 0.3 (needs a human ground-truth pass),
  `weightLayer2` 0.8 (needs dispatch goals carrying ticket ids).
- **Jarvis Briefing:** generic cross-project progress needs a Wave-owned workstream/milestone contract —
  its own product/data-model session.
- **Pet:** courier gestures (build the store and the gestures together); higher acting tiers.
- **Pi Part B:** `wave_create_widget` pi tool + `wsh widget` vdom CLI — when a concrete consumer appears.

---

## 4 · Declined / permanent limitations (do not resurface)

- Cockpit light/Paper theme — declined; code removed 2026-08-24 (`docs/deferred.md`).
- Gatekeeper v1.1 (make-a-rule + countdown) — revive only on recurring-ask or misfire evidence. Measured
  2026-10-12 over 879 structured asks since 08-11: 737 distinct headers, and the ones that recur (spec
  review, scope, plan review, commit) are approval gates, not routine asks a rule could answer.
- arcterm Environment capability — restore via `git show 4e80bf4f:docs/environment-roadmap.md` if needed.
- Agents-tab fit-one-screen density engine — obsolete, un-executable against the card grid.
- Diff-surface row-density variants and the rest of the narrow-window cascade — the commit column fold
  shipped (`19d324e5`); the rest only on a narrow-window user.
- Rate-limit token *cap* and plan-tier badge — no honest Anthropic-side source.
- Codex/OpenAI 5h-window bars — Codex has no such window.
- Codex subagents + depth>1 subagent nesting — no per-subagent files exist; closed no-go.
- Usage pricing family-substring drift (historical Opus billed at current tier) — accepted estimate error.
- OpenCode as a run worker — declined 2026-09-17: this install only uses claude and pi. Codex came back as a task
  worker on 2026-10-10 (`docs/superpowers/specs/2026-10-10-codex-run-worker-design.md`). Recovery path for
  opencode: `docs/deferred.md` 2026-09-14 entry.
- Final stage: persisting a verifier's verdict held during Checking — declined 2026-09-30.
- The memory subsystem and the Jarvis recall arm (Ask, proactive cards, embeddings) — removed
  2026-09-22/23 on measured usage. Revive only on evidence that note bodies, not index lines, change an
  agent's behaviour (`docs/deferred.md`).

---

## 5 · (arcterm) RAM watch

Features that hold memory over time, measured when they landed. A heavy one is a candidate to drop or to put behind a
setting; that call is the person's. Layers are the compact RAM popup's.

| Feature | Commit | Layer | Measured | Date | Verdict |
|---|---|---|---|---|---|
| Pinned apps: each open app's page kept loaded out of sight for 10 min (`APP_FRAME_IDLE_MS`, `AppFrames` in `apppane.tsx`), so it keeps its page and scroll | uncommitted | Interface | Not measured. One frame, a renderer of its own (127.0.0.1 is cross-site to the cockpit), per app seen in the last 10 min, where before only the app on screen held one; a guess of 50–150 MB each for a dev page. To read: the WebView2 working set with two apps open, one out of sight, then past the 10 min. | 2026-10-19 | pending |
| Held services: wavesrv holds every pinned app's server (`pkg/services`), each one `cmd` terminal block in a tab of its own; only a shown or Keep-running service runs, a sleeping one holds 0 MB | uncommitted | arcterm (wavesrv) and the apps' processes | Not measured. arcterm's own cost is one PTY and one goroutine per running service, a timer per service off screen, plus a readiness probe (an HTTP GET every 500 ms, up to 30 s) only while a service is starting; nothing polls while one runs. A sleeping service has no process. The running services' own RAM is the apps', not arcterm's. To read: wavesrv's working set with 0, 5 and 10 services running. | 2026-10-20 | pending |
| Pinned apps: the page's iframe in the centre, and the app's own dev server | uncommitted | Interface, and the app's process | Not measured. No frame until an app is opened; open, the frame (no second webview). The app's server is a held service (row above): it runs whenever its service does, opened or not, and its RAM is the app's, not arcterm's. | 2026-10-19 | pending |
| Agent → Canvas gallery: the grid of lazy `<img>` previews, and the viewer's one board iframe | `75278d142` | Interface | The page's JS heap after a GC, from Final's `canvas-gallery` steps 1 (grid) and 3 (viewer) on a 3-canvas fixture: 41.6 MB and 41.8 MB (43.4 and 43.4 in an earlier run). Not measured: the WebView2 working set, and the 17-canvas case. The heap figure is the page's own JS and says nothing of the board iframe. Between visits only the list (a row per canvas) and the folder-URL cache stay. | 2026-10-14 | pending |

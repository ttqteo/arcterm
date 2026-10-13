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
  sleeping cell has its own box. `sleepingtranscript.tsx`; CDP `agent-sleep` step 4b.

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

- [ ] (arcterm) **Folded Sprout on a Mac.** Fold with `⌘M`, then: switch Desktop (Ctrl+→) and go into a full-screen
  app: Sprout is there on each; click it there: the window comes back on that Space. Fold, `⌘Tab` away and back, press
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
- [ ] (arcterm) **Auto fold, Windows** (Settings → General → Window → Fold when you leave, on): a maximized or full-screen
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
| (arcterm) Final on a Mac checks Chromium, not WKWebView: `task dev:browser` runs the scenarios in headless Chrome, so WebKit-only behaviour (the File tab Source view's Ctrl+Enter, IME, scrolling) and the scenarios marked `host: true` (notify-toast, float-mini, jarvis-modes) still need a hand check in the real app or a Windows run | verification gap | S | `scripts/cdp/browser-app.mjs`, `scripts/cdp/final-verify.mjs` (`hostOnlyScenarios`); AGENTS.md "Visual verification"; run 915dc28d (2026-10-12) |
| (arcterm) Token burn guard part (1) shipped (a Token burn card before a costly `Agent`/`Task`/`Workflow` spawn). Left: nothing warns while a session burns its 5h window through cache reads (a docs session went ~20M → ~220M tokens in an hour): a burn-rate toast, cache reads shown apart in Consumers, a whole-run cost estimate at plan submit, exempting engine runs | feature | M | `docs/deferred.md` "Token burn guard"; complements `docs/superpowers/specs/2026-10-07-quota-guard-design.md` |
| (arcterm) The Claude sign-in dialog's `TokenScanner` is tested only on synthetic output: the `settings-claude-account` scenario runs a node stand-in through the dev override `arc:dev:setuptoken-cmd`, never the real command. Record a real `claude setup-token` run's pty output (the token redacted to a fixture of the same shape, line breaks and escape sequences kept) and add it as a `setuptokenscan.test.ts` case | verification gap | S | `frontend/app/view/agents/setuptokenscan.ts`, `frontend/app/cockpit/claude-signin-modal.tsx`; plan review of `docs/superpowers/plans/2026-10-07-claude-account-switch.md` (2026-10-07) |
| (arcterm) A Claude Code background session whose terminal has exited (and no `claude attach` tab) shows nowhere: its reports are dropped (`statusTarget`) until a tab attaches. The terminal that sent it to the background is found by its command line (`--resume <id>`) or, when that names no session (a bare `claude`, `--continue`, a picked `--resume`), by the session its block last reported (`agentobserve.DisplayBlock`, 2026-10-10); that path is unit-tested only, never exercised on a live background session. Check: send a bare `claude` session to the background, and its tab keeps its status and subagents | verification gap | S | `waveapp.log` 2026-10-06 16:40:02–16:40:20; `claude agents --json` lists the session `kind: background`; Close already stops it by the `--resume` id (`ce797bee`) |
| The 2026-10-10 fixes were unit-tested on macOS only, where WKWebView answers no CDP: the palette pick that hides its cell (focus goes to the picked agent, `modalfocusfallback.ts`), every ModalShell dialog gating the surface keys (`anyDialogOpen`), the grid holding for its saved focused cell on reload (`gridHold`; `agent-grid` step 10b passed in headless Chrome on a Mac, run 915dc28d, 2026-10-12), and the File tab Source view sending on `Ctrl`+`Enter` in WKWebView. Run `agent-grid` and `md-comments` on Windows (`md-comments` also runs on a Mac in `task dev:browser`), and try the Source view send in a macOS build | verification gap | S | the 2026-10-10 bug fixes (branch `fix/open-bugs`, landed on main 2026-10-12) |
| (arcterm) Closing an agent attached to a background session was never exercised live: `ce797bee` runs `claude stop <id>` from `WorkspaceService.CloseTab` (dry run against the real `claude agents` picked only the background session), but no wavesrv with it has closed a real one. Check: Close it, then `claude agents` no longer lists it `working` | verification gap | S | `pkg/bgagents` `Stop`, `pkg/service/workspaceservice` `tabSessionIds` |
| A run whose lead is down is visible only on the Cockpit: its card shows "Lead down" and "Lead wake failed" with **Relaunch lead** (`leadcard.tsx`, `orchestrate/relaunchlead.ts`). The Agent surface's run row only reads "lead closed" (`runmodel.ts` `dagProgressLabel`), with no action, and `wsh runs show` does not mention it at all. A run whose lead died in an app restart (run 74f0fa77, 2026-10-06) then sat 15 min on a failed plan review with nobody to revise it, unnoticed by a user who works in Agent/Conversation History. Since `90f4b49e` (kaeltran16 fork, merged 2026-10-07) a lead killed by an app restart is resumed at boot (`ResumeInterruptedLeads`), so what is left is a lead that resume cannot bring back. Show the lead-down state and Relaunch on the Agent surface's run row, and a `lead down` line (and a relaunch command) in `wsh runs` | feature | S | Session 2026-10-06; restart recovery itself is `docs/deferred.md` "Run recovery after a restart — dag runs" |
| Agent + Sessions merge, the 2x2 grid and Uploads were never run live: no `task check:ts`, of the four new CDP scenarios only `agent-grid` and `agent-uploads` have run, and every step passed (headless Chrome on a Mac, run 915dc28d, 2026-10-12); `agent-history` and `agent-rail-sections` have not, and a real WebView2 drag, an OS file drop and the native Attach dialog were never exercised. Clear `public/cockpit-fixtures/active.json` first (`npm run cockpit:fixtures -- --clear`): the new scenarios SKIP while it exists | verification gap | M | `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`; If WebView2 cancels a drag the instant it starts, the fix is a `setTimeout(0)` in `beginAgentDrag` (already deferred once) or moving the overlay mount later |
| Plain terminals are reachable only by mouse, from the Agent tree's Terminals section (back from the details rail 2026-10-06): not in the palette, Ctrl+Tab or `j`/`k`, and not while the centre is fullscreen (which hides the tree). Option: list terminals in the palette's Agents group | feature | S | `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`; Task 13 review (2026-10-06) |
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

Tracked in their own initiatives, not here:

- **arcterm Claude mod live verify** (usage strip, card answer, Esc, dag child ask, settings hooks; `CLAUDE_CODE_PLUGIN_DIRS` loading with no enable prompt; a card answered after more than ten minutes still answers the call) — effort `99832658`, chunk 9. Each needs an interactive Claude session in the dev app; the headless half is `node scripts/claude-mod-load-check.mjs`. Spec `docs/superpowers/specs/2026-10-02-claude-mod-design.md`.
- **Orchestrator wall-clock** — effort `b1fe5d7e`: live-verify the unit-tested fixes, the round-2 final tree lock, the Timing section live check.

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

Cockpit and surfaces:

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

- **Route picker lists a route the account cannot run (F14)** (held 2026-10-06) — `pi --list-models`
  itself lists `openai-codex/gpt-5.3-codex-spark`, which the provider rejects, so a catalog check at
  spawn would pass it. Revive when dead routes are more than a stray row, as a denylist learned from
  spawn failures. Source: `docs/orchestrator-redesign-flaws.md` F14.
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

Jarvis (what survived the 2026-09-22/23 memory and recall-arm removals):

- **U2 Tasks:** in-Wave `## Notes` editing; decision supersede UI (backend `SupersedeDecision` exists);
  manual dossier creation; live push.
- **U3 Graph:** search/filter; read rail; cross-surface nav out of a node; whole-vault attribution; the
  visual constants (opacity/width/dash/`RUN_SQUARE_SCALE`) want a dense-vault legibility check.
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
- Gatekeeper v1.1 (make-a-rule + countdown) — revive only on recurring-ask or misfire evidence.
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

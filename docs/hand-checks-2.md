# Waiting on a hand check, part 2

Older lines of `docs/hand-checks.md`, moved here when it grew past its size; the rules and the list of parts
are in that file. Tick a line here when it holds, then remove it; a part left empty is deleted.

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

**2026-10-14 (Conversations rescan)**

- [ ] In an agent tab run `/clear` (or quit claude and start it again in that terminal): within a second the session it
  left appears at the top of its project under Conversations, without leaving the Agent surface. `usesessionsscan.ts`.
- [ ] Mark an old conversation for later (row menu): it moves to the top of its project folder, above newer ones.
  `agentsidebarmodel.ts` `conversationTree`.

**2026-10-14 (overflow fixes)**

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

**2026-10-14 (Claude mod on a Team account: ask dialog, Token burn gate)**

- [ ] After the next build and `task install`, in a Claude agent: have it ask a choice question; answer once in Claude's
  own dialog and once on the arcterm card: each answer reaches Claude (never "The user dismissed the question") and one
  card shows, not two. Dismiss on the card with the dialog still open: about 1.5 s later Claude gets "dismissed". Ask it
  to start 3 subagents, pick allow-this-turn on the Token burn card, then a new prompt that starts 3 again: the card
  asks again. Tried only in unit tests, and the transcript path in a headless `claude -p`.

**2026-10-14 (What's new: highlight cards, the rest folded)**

- [ ] What's new by eye (`whats-new` passes on main, 2026-11-02): the cards read well on the Light theme, and in the
  fold a note with no bold lead that fits two lines has no chevron and stays aligned with the rows above.
  `frontend/app/cockpit/whatsnewsheet.tsx`.

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

- [ ] `task dev` (Windows) while an editor is in front: the dev window opens behind it, restored, without taking
  focus. On a Mac the dev window still appears. `src-tauri/src/main.rs` `show_behind_foreground`.
- [ ] Setup → shared instructions with a long line: the editor wraps it instead of scrolling sideways.

**2026-10-13 (Jarvis popup: folded chat closes on a click away, no Ask while folded, compact composer)**

- [ ] Fold into Sprout, open the Jarvis chat from its card, then click another app (or the desktop): the chat closes.
  Clicking inside the chat, or the chat resizing the folded window, must not close it. `sprout-mini.tsx`.
- [ ] Folded, the chat has no Ask field; the hover card's row reads "N waiting on you" / "New reply" / "Nothing
  waiting". Ask Jarvis from the full window, fold before the reply lands: the "New reply" bubble opens the chat
  with the reply in it. `petpeek.tsx`, `peterrand.tsx`.
- [ ] Full window, Jarvis popup (Sprout in the footer): under the field one muted line `Claude Code ⌄ · <project> ⌄`;
  each part opens its picker and the choice sticks. `peterrand.tsx`, `harnesspicker.tsx` (`bare`).

**2026-10-13 (Spider theme: blue accent)**

- [ ] (arcterm) **The Spider theme's accent is the suit's blue (#7a9ce6), not red.** Setup → Appearance → Theme →
  Spider: links, focus rings and the selected row read soft blue, nothing glares red; the app-bar spider logo, the
  small spiders in the corners and the pet keep the suit's red; the Spider chip shows a red and a blue swatch.
  Commit: "feat(theme): the Spider theme's accent is the suit's soft blue".

**2026-10-13 (Don't fold for, on the folded Sprout)**

- [ ] (arcterm) **The folded Sprout's card, the parts the fold pause entry (2026-10-14) leaves out.** Folded by hand,
  the card reads "No fold until …" with Resume; with four agents listed it is not cut off at the top (the folded window
  grew to 320x336); and typing in the Custom… box keeps the card open when the cursor leaves it. (`sprout-mini.tsx`
  `FoldPauseRow`, `foldpause.ts`)

**2026-10-13 (close hands focus to the neighbour)**

- [ ] (arcterm) **Closing the shown agent opens its neighbour.** In one pane, with three or more agents in a project,
  pick the middle one and close it (Ctrl+Shift+W or the header's Close): the one below it in the sidebar takes the
  centre, not the first agent; close the last one in a folder and the one above it takes it. Same for a plain terminal.
  commit "close opens the neighbour".

**2026-10-13 (folder running count, Spider-Man web)**

- [ ] (arcterm) **Spider-Man's web stays one piece.** Theme Spider-Man, restart on the Cockpit surface, then open
  Agent: the corner web runs across the rail and the tree as one, with no second corner at the tree's left edge.
  commit "project folders count running agents".

**2026-10-13 (server whose launcher exited)**

- [ ] (arcterm) **A daemonized dev server keeps its agent.** Have a Claude agent start Astro 7 in the background
  (`pnpm run dev`, whose `astro dev` returns once the server is up): its task reads completed, yet the agent's
  Servers row reads `this agent` with a log button, and the footer's Servers popover badges it `claude · <agent>`,
  not `no owner`. `frontend/app/view/agents/devserversmodel.ts` (`matchEndedTask`).

**2026-10-13 (Alt+Tab grows Sprout back; Jarvis card link)**

- [ ] (arcterm) **A long Open link ends in "…" in the folded Jarvis card.** With a run notice whose title is long (an
  installer build), open the card from Sprout: the "Open <title>" link stays inside the card, cut with "…", and its
  hover shows the whole title.

**2026-10-13 (New agent: Claude account)**

- [ ] (arcterm) **The New agent footer names the Claude account.** With a token account added in Settings → Agents →
  Claude account, open New agent and pick Claude Code: the footer reads `Claude: <label>` (or the /login email while
  Default is active), for a new session and a resume alike; pick Codex or Terminal and it goes; with only /login it
  never shows. `launcher.ts` `footerLine` (since rewritten: it no longer names the path and branch).

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
  `brew install glow` in an `Install glow` terminal; then open it with `Cmd+Shift+O` (`Cmd+Shift+T` now reopens the agent closed last). A Finder-launched app has a short
  PATH: check the library reads `found at …` for a tool brew put in `/opt/homebrew/bin`, or shows the restart hint,
  and that `brew` itself is found by the install terminal. `0f8df9836`
- [ ] (arcterm) **A tool in the tree and the centre.** With an agent focused, `Ctrl+Shift+O` → lazygit: a lazygit row
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

**2026-10-13 (Canvases reopen from the palette)**

- [ ] (arcterm) **Open a canvas after a restart.** Restart arcterm, select an agent in this repo, open the palette
  and type “canvas”: a Canvases group lists the folders under `.superpowers/design` (terminal-tui, arc-pet…). Enter
  switches to that agent in canvas mode on the board. With no agent selected there is no group; a canvas another agent
  already has open lands on that agent. `command-palette.tsx` canvasItems, `openref.ts` loadCanvas.

**2026-10-13 (Resume with a message; Transcript in the New dialog's footer)**

- [ ] (arcterm) **A resume pick lapses after 30 seconds closed.** New → pick a session under Resume, type a task,
  close; reopen at once: the session is still picked. Close, wait over 30 seconds, reopen: New session is picked
  and the task text is still there. `launcherstore.ts` RESUME_PICK_KEEP_MS.

**2026-10-12 (folded Sprout: a click restores, every Space)**

- [ ] (arcterm) **Folded Sprout on a Mac.** (Since 2026-10-15 a fold on arcterm's own Desktop stays there; Sprout
  follows only a fold over a full-screen app, see that day's entry.) Fold, `⌘Tab` away and back, press
  `⌘M`: it comes back. Pass the cursor over Sprout: no card; rest on it: the card (agents, **Ask Jarvis**, **Restore**)
  shows, also while a bubble is up, and **Ask Jarvis** opens the chat. Restore, then make arcterm full screen (green
  button): it still works, nothing threw. `macwindow.rs` set_folded_chrome, `sprout-mini.tsx`, `minihit.ts` nextHover.

**2026-10-12 (Spider-Man pet)**

- [ ] (arcterm) Spider-Man pet: drag and rappel, the crawl and hang under the app bar (hover cuts it), the web-swing on fold and unfold, the rooftop's windows and spider-sense, and the Spider theme — look in the running app.

**2026-10-12 (A lead-less run's row)**

- [ ] (arcterm) **Clicking a plan run's top row shows a terminal.** Start a run from a plan file
  (`wsh runs start --plan`) and, while its plan review or a worker is running, click the run's top row in the Agent
  sidebar: the reviewer's or worker's terminal shows and its row reads selected. Double-click it: the terminal takes
  your typing. Click it while every task is still queued: the run only unfolds. The workers chip still folds it.
  `agenttree.tsx` RunRow, `runlineage.ts` runFocusAgent.

**2026-10-12 (Background tasks on the sidebar glyph)**

- [ ] (arcterm) **An agent's sidebar ✳ carries its state; Close waits for its background tasks.** Rows: a working
  agent's ✳ pulses in the accent colour, an asking one's in yellow, an idle or sleeping one's is grey and still, and the
  second line has no state dot. Have a Claude agent run something long with `run_in_background` (a `sleep 120`), let its
  turn end and commit: neither the row's ✓ Close, the header's Close nor its key shows until about 15 s after the
  command ends. The green background dot this entry first named is gone ("calmer agent rows — no background-task mark");
  running tasks are rows under the agent now. `agenttree.tsx` RuntimeGlyph, `donesuggest.ts`; the `sidebar-agent-glyph`
  scenario covers the colours and Close on fixture rows.

**2026-10-12 (Run sheet with a long goal)**

- [ ] (arcterm) **An earlier Final round's screenshots stay while the next round runs.** On a run whose Final is on
  round 2 or later and still running (reading says "final: running Verify"), the dock shows **Screenshots · N**, and
  the Final check row under the tasks reads "N shots · round 1"; both open round 1's shots. `finalshotsmodel.ts`.

**2026-10-12 (shortcuts, window, terminal)**

- [ ] (arcterm) **Mac chords.** `⌘=` / `⌘-` / `⌘0` zoom (not Control any more); `⌘⇧Enter` toggles terminal
  fullscreen from inside the terminal; `⌘K` clears the terminal (Mac only). `cc7a43629`
- [ ] (arcterm, Mac) **The `?` button** at the bottom bar's right end on every surface opens the cheat sheet (tried on
  Windows 2026-11-02). `cc7a43629`
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
- [ ] (arcterm) **Tick a task box in a markdown Preview.** Open a `.md` with `- [ ]` lines in the Agent panel's File
  tab, Preview: click a box; it ticks, the file on disk now reads `- [x]` on that line, and the scroll stays put.
  Click again to clear it. `65179f6b8`
- [ ] (arcterm) **Worktree facts in the Agent panel.** Select an agent working in a linked worktree (a run worker):
  Overview's session block reads `project · model`, then `⑂ wave/ae9e6a71 · 📁 ae9e6a71` (ids cut to 8 digits) with
  the full branch and path in the tooltips; an agent in the main checkout keeps `project · ⑂ branch · model`. `7c5074e8f`
- [ ] (arcterm) **A real Brainstorm with a Claude agent.** In the dev app, start a Claude agent on a scratch project, ask
  it to brainstorm a small feature, and drive it only through the pane: the Brainstorm switch appears on the agent's
  first write of `brainstorm.json`; each answer is one write per turn, with a short terminal reply; an approach question shows "Judge's read" and
  "Judge's pick" once the real blind Opus judge is done (a tab "Judge" nests under the agent); Check with a builder
  runs a real reviewer (its "Builder check" row nests under the agent) and its questions come back without a second
  question from the agent; Approve opens New run prefilled (orchestrator, the project, the spec's path in the goal, the
  first board as prototype); start the run and `run` is set in the file after it starts, so the tree line and the bar
  name the run. The scenarios play the agent and the server; none of this ran against a model. `docs/agents/brainstorm.md`
  "Testing it", `docs/deferred.md` "Builder check end to end" and "Brainstorm judge end to end".
- [ ] (arcterm) **A real Brainstorm with a pi agent.** The same, with a pi agent: pi has no reveal hook, so the skill has it
  run `wsh ui reveal brainstorm:<topic>` itself after writing the file; check the pane opens then, and that the
  judge and the builder check (both Arc's own sessions) work the same.
- [ ] (arcterm) **Markdown images and a File tab that follows its file.** Open a `.md` with PNG and SVG figures beside it
  (`![](figures/x.svg)`) in an agent's File tab: the figures draw, not their alt text in a box, and in Code's Preview
  too. Change a line of it from outside (the agent, an editor): within ~2 s Preview and Source show it, keep their
  scroll, and the figures do not blink. f6e9a3a6b, d1dffb724; no dev app was running to try it.
- [ ] (arcterm) **Hooks heal mid-session on a Mac.** With a build that has `pkg/stablewsh` installed, keep agents
  working until macOS kills `~/.arc/bin/wsh` again (`~/.arc/bin/wsh version` exits 137; on 2026-10-30/31 it struck
  three times, once 3 minutes after a fresh copy): within ~10 s `waveapp.log` reads `stablewsh: … was killed on exec;
  replaced it`, `wsh version` exits 0 again, and the next turn ends with no "Stop hook error". Why the kernel flags
  the file is still unknown.
- [ ] (arcterm) **Council Map's table header sticks.** On a council with ~20 ideas, open Map and scroll down: the head
  row (Idea, each seat, Agreement, Outcome) stays flush at the top of the pane, with no strip of rows showing above
  it; scrolled sideways, the head follows the columns. `frontend/app/view/agents/councilmap.tsx` (`Matrix`). The
  sideways half holds: `council-map` passed 12/12 in the Tauri dev app on 2026-11-05 (seven seats: the matrix scrolls
  inside its box with the Idea column in place); no step scrolls it down.
- [ ] (arcterm) **A council seat's failure sits under the message it failed on.** In a council where a seat failed on
  one of your messages (a usage limit), send another message to a different seat: the seat's failure line (with Retry
  and Retry with…) stays right under the first message, the first message no longer repeats the error, and nothing
  red sits under the new one. `frontend/app/view/agents/councilchatmodel.ts` (`councilChannel`), commit 71c348869; no
  dev app was running to try it.
- [ ] (arcterm) **A chat seat reads as its name and key, and its name opens it.** Seat a live chat in a council (@ its
  key): its messages, chip, "For …" line and failure line read `notes · 0976023f`, not `notes`. Hover its name or
  avatar on a message: the tooltip is the chat's session title; click either: the Agent surface opens on that chat's
  terminal. Close the chat's tab: the name and avatar stop being buttons. `frontend/app/view/agents/councilchat.tsx`
  (`Byline`, `SeatAvatar`), commit 3bdede464; no dev app was running to try it.
- [ ] (arcterm) **Whom a council message goes to: the parts no scenario reaches.** With real routed messages, the
  chip row's hover cuts a long reason with "…" at a word; in a council with a chat seat, the `@<key>` chip in your
  message opens that chat's terminal, as its name does; type one long line in the council's message box: it grows a
  line each time the text wraps, up to five, then scrolls, and no line is cut off. The chips, the `@RAM` chip, the
  quote, its glide and its 2 s ring hold: `council-routing` passed in the Tauri dev app on 2026-11-05, `quote-stacked`
  included. `councilchat.tsx` (`ReachRow`, `QuoteRow`, `SeatChip`), commits bf8c79a0c and 2e2e65fdf.
- [ ] (arcterm) **A closed chat seat comes back.** Seat a live chat in a council and let it answer once; close its tab
  and send it a message: its failure line reads `… is gone: its tab closed. Click its name to open its session again,
  then Retry`. Click its name (or avatar, or its @ chip in your message) → its session opens asleep in a new tab; press
  Retry → the seat answers from that tab, and its name now carries the new tab's key. Resume the session from
  Conversations instead → the same Retry reaches it. `pkg/council/agentcaller.go` (`Rebind`), `runner.go` (`rebind`),
  `wshserver_councilagents.go` (`Holder`), `councilchatmodel.ts` (`seatLink`); Go and unit tests only, no dev app was up.
- [ ] (arcterm) **A chat seat's Seats button is the agent mark.** Open a council with a chat seat, then its Seats list:
  the seat's row ends on the Bot icon (not a terminal), its tooltip `Go to <name>`; click → the Agent surface on that
  chat. `councilseats.tsx`, commit 74981bd46; no dev app was up.
- [ ] (arcterm) **Close project.** Right-click a project folder holding agents and terminals (one working, one asleep,
  a run's worker among them) → Close project… is last, red; pick it → the confirm counts them and says how many are
  working; Close project → every one of their tabs closes, the folder keeps its councils and any service, and the agents
  are in Conversations (Mod+Shift+T reopens the last). A folder with no tab has no Close project…. `agenttree.tsx`
  (`openFolderMenu`), `agentactions.ts` (`confirmCloseProject`); unit tests only, no dev app was up.
- [ ] (arcterm) **Open asleep from History and Conversations.** Right-click an ended Claude or pi session in a project
  Overview's History, then one in the Agent tree's Conversations: Open asleep sits under Resume; pick it → the session is
  on the roster asleep (moon in its row), its transcript shows with a box to wake it, and no process starts until you
  Wake it or send a message; pick it again on the same session → it goes to that tab, no second one. A codex session's
  menu has Resume only. `projecthistory.tsx`, `agenttree.tsx`, `sessionsdetail.tsx` (`openSessionAsleep`); unit tests
  only, no dev app was up.
- [ ] (arcterm) Kael sync: run a real workflow scan: in a project with a fortnight of runs, `wsh workflow scan --start`
  (or the palette's Scan workflow row) → an Opus agent opens and its `wsh workflow scan` returns after the Sonnet
  pass with each recounted pattern, its quote per run and a fix target; the agent asks one `AskUserQuestion` question
  per suggestion (id as the header, Apply or Drop, a reason in Other; no more than 4 to a call, so more than 4
  suggestions make a second call) and the cockpit shows it as an agent waiting on you. Apply a fix to this repo → the
  edit lands as a `chore(workflow): …` commit; Drop one → a "Workflow scan: … (declined YYYY-MM-DD)" section lands in
  `docs/deferred.md`; a fix whose project is another one is only shown as text, never applied. Start a second scan
  while the first is live → refused naming its project and run. Go tests with a scripted Sonnet reply only: the
  consult call, the AskUserQuestion flow, and the Apply/Drop commits have not run against a real agent
  (`wshserver_workflowscan.go`, `wshcmd-workflow.go`, `pkg/workflowscan/goal.go`, run 12a23f8b Task 3). From the
  palette's row, the open waits up to 15 s for the scan's agent to show in the roster and then lands on it, not on the
  run's sheet (`palette-scan.ts`, unit tests with fake timers only; run 12a23f8b fix round Task 1).
- [ ] (arcterm) **Synced council seat reopens.** On Windows, open council 45b27fa6 (mit-thesis, synced from the Mac; its
  thesis seat names `/Users/ttqteo/.claude/projects/...`), click the thesis · 040af37e chip or name → the session
  `953f36b0` opens asleep in a new tab (or the tab holding it is focused) instead of the "Couldn't reopen the session"
  toast; Retry on a failed thesis turn reaches that tab. Unit tests only (`transcriptpath.ts`, `archivedSession`,
  `seatLink`, Go `Holder`).
- [ ] (arcterm) **Council short names, call bar gap.** Start a council with a Vietnamese question (Soi một tính năng
  giao diện) → the cards read UX, Đo RAM, Khách, Tìm bug and Thư ký, untruncated, with initials U, Đ, K, T, T; while it
  runs, the green call bar under the header sits ~10px below the Discussion tab's underline, not touching it.
  Unit tests and the typecheck only (`roles.go`, `councildiscussion.tsx`); no dev app was up.
- [ ] (arcterm) **Council evidence chips don't select.** In a council's Discussion or Report, drag across a claim's
  evidence row → the file, screenshot, `+N` and label chips ("Đã đọc code") never turn blue; the Weak and Wrong cite
  chips still select, so their reason can be copied. Not tried in the app (`councilsourcespanel.tsx`,
  `councilchecks.tsx`).
- [ ] (arcterm) **Tab closes are logged.** Close an agent with Ctrl+Shift+W then Enter, and another with the header's
  Close and a click → `waveapp.log` has, for each, `[fe-log] [close] ask … from=Mod+Shift+W` (or `from=header`), then
  `[close] confirm … via=enter after=…ms` (or `via=click`), `[close] close … why=close from …`, and wavesrv's
  `CloseTab: tab …`. Unit tests and the typecheck only (`closelog.ts`, `confirmdialog.tsx`, `agentactions.ts`).
- [ ] (arcterm) **Open council idea rings.** In a council's Discussion, click an idea's replies → its bubble wears a
  bright 2px ring over its tint, plainly the one the right panel shows; j/k focus alone draws the accent ring (below).
  Not tried in the app (`councilchat.tsx` `IdeaMessage` bubble).
- [ ] (arcterm) **Picked council idea shows in both places.** In a council's Discussion, click an idea on the Ideas tab →
  the row wears an accent ring and its `Idea N` turns accent; the channel scrolls the same idea to the top, whose bubble
  wears the same accent ring (wider for ~2 s, then 2px) and whose byline starts with the same accent `Idea N`. Every
  other idea's byline shows its `Idea N` muted. j/k moves both rings together. Typecheck only (`councilchat.tsx`
  `IdeaMessage`, `IdeasList`, `pick`); no dev app was up.
- [ ] (arcterm) **Withdrawn council idea.** Run a council until a seat withdraws its own idea in round 2 → in the
  Discussion the idea's byline has a grey outlined `Withdrawn` pill and its bubble is dim; its thread's title is struck
  through with the same pill; the author's reply reads `withdrew it` with a one-line reason, or only the pill when it gave
  none, and never counts as an "agrees" chip. An older council's "Withdrawn." reply shows as the pill alone. Unit tests
  and the typecheck only (`councilchat.tsx` `IdeaMessage`, `ThreadIdea`, `ReplyMessage`); no dev app was up.
- [ ] (arcterm) **Fold button without the pet's name.** The app bar right of + New shows a 26px square with only the
  pet (Sprout, Minion or Spider-Man), no name beside it; hovering it says `Fold into <name>`, a click folds, a right-click
  still opens the fold menu. ESLint only (`app-bar.tsx`); no dev app was up.
- [ ] (arcterm) **Colored background task output.** Start a background shell that prints colors (`task tauri:build`, or
  `npx vitest run <one test>`), then click its row under the agent in the Agent tree → the peek's Output shows vite's
  `dist/` dim and `assets/…` cyan, vitest's ✓ green, with no `▯[36m`-style codes; switch the theme and the colors follow
  it. A Monitor's Events tab draws the same way. Unit tests and the typecheck only (`ansitext.ts`,
  `backgroundtaskpeek.tsx` `AnsiLines`); no dev app was up.
- [ ] (arcterm) **Revised council idea.** Run a council until a seat retitles its own idea in round 2 → its reply in the
  thread has an accent `revised it` pill, a `New title` line with the new title, then its one-line reason, and no
  "Retitled:" in the words; an older council's "Retitled: …" reply splits the same way. Unit tests and the typecheck
  only (`councilchat.tsx` `ReplyMessage`, `DraftCard`); no dev app was up.
- [ ] (arcterm) **Cut council idea.** In a council with a pause, untick an idea and continue → in the Discussion that
  idea has a grey outlined `Cut` pill (hover: "You left it out at the pause…") and a dim bubble; its thread's title is
  struck through. Unit tests and the typecheck only (`councilchat.tsx` `OutPill`); no dev app was up.
- [ ] (arcterm) **History tree line.** Cockpit → a project's Overview → History, on a session that started a council
  and a run → a 2px grey line drops from under the session through its child rows: ├ into each child but the last, a
  rounded └ into the last, the turn meeting the child's title line; unfold a council that is not the last child → the
  line runs on through its peek to the next child; a top-level council or run has no line. Unit tests and the typecheck
  only (`TreeLine` in `projecthistory.tsx`, `isLastChild`, 3fcd9c943); no dev app was up.
- [ ] (arcterm) **Initiative "only" bar wraps.** Jarvis → an initiative with a long chunk title → Notes → click the
  chunk → the "only" bar on top shows the whole title over several lines, the "only" label, tone dot and "show all"
  sitting on its first line. Prettier only (`NotesFeed` in `effortdetailview.tsx`); no dev app was up.
- [ ] (arcterm) **Council Memory icons.** A council → Memory → hover the Direction → Earlier reads as a history icon
  with its count, Edit a pencil, Unpin a crossed-out pin, each with its word as a tooltip; Unpin spins while it runs;
  hover an entry → Chốt a pin, Edit a pencil. Prettier and ESLint only (`councilmemory.tsx`); no dev app was up.
- [ ] (arcterm) **Overview Quick look and Back.** Agent → a project's Overview → click a History session row → the
  transcript opens in a dialog over the Overview, with Activity/Transcript, Resume and Open; Esc or a click outside
  closes it. Scroll a long transcript down → the pinned prompt at the top sits on the dialog's own ground, no darker
  band behind it. Open → the full session pane, its Back reads "Back to Overview" and returns there, and so does Esc;
  the same from History says "Back to History". Vitest and `task check:ts` only (`projecthistory.tsx`,
  `sessionpeek.tsx`, `agentcenter.ts`); the `project-overview-history` scenario's step 7 was updated, not run.
- [ ] (arcterm) **Memory tab without a model.** After the next build, Setup → Memory → arcterm → Check now, with
  `headless:runtime` still unset (no OpenRouter key) → the index card shows its lines and size, "Last check failed" still
  names the key, and the table lists Review rows (`feedback_no-co-author-trailer.md` among them, untouched 30+ days);
  Still true on one → it reads "Marked still true at …", and the next session start no longer lints that memory.
  Go and vitest tests only (`pkg/memhygiene/review.go`); no dev app was up.
- [ ] (arcterm) **Detail tooltips wait.** A council → send a message the router sends to one seat → sweep the pointer
  across the message: no tip shows. Rest it on the Planner chip above the text → after about half a second "Router
  chose …" opens above the chips, never over the message; a short button name (Copy, Pin) still shows at once.
  Vitest and `task check:ts` only (`titletip.ts` `tipDelay`, `titletiphost.tsx`, `ReachRow`); no dev app was up.
- [ ] (arcterm) **New run takes the profile's auto width.** Jarvis → Profile → Parallel workers "auto" → + Run →
  Orchestrate: Workers at once reads `auto` (− disabled), the footer says "Orchestrator × auto in …"; Start run → the
  run's DAG width is the lead's (or the plan's) pick, not 3. + steps to 3; − at 1 returns to auto. Set the profile to 5
  → a fresh New run shows 5. Vitest and `task check:ts` only (`runconfigstore.ts`, `WorkerStepper` `unsettable`,
  `newrun.ts`); no dev app was up.
- [ ] (arcterm) **A short table's frame fits the table.** Agent → a reply with a 3-column table: the rounded frame
  ends at the last column, not the pane's edge; hover → the copy button sits on the table's top-right corner. A table
  wider than the pane still fills it and scrolls inside. CSS only (`markdownmessage.tsx` table wrapper `w-fit
  max-w-full`); no dev app was up.
- [ ] (arcterm) **Pinned prompt: no gap above, one stacked card under.** A sleeping agent with three or more turns →
  scroll down until the second prompt pins: nothing peeks above the bar (before, a 12px strip of the transcript did);
  one thin card edge shows under the bar, never two. Scroll back into the first turn → the first prompt pins with no
  edge under it. Same in an ended agent's transcript, the rail transcript and a session's read. Prettier/ESLint only
  (`pinnedpromptbar.tsx`; top padding dropped in `sleepingtranscript.tsx`, `endedtranscript.tsx`,
  `sessionsdetail.tsx`); no dev app was up.
- [ ] (arcterm) **Council Map: a long cite wraps inside the idea column.** A council report → Map, an idea whose
  "Đã đọc code" line cites a long path (`obsidian_harness/20261104_harness_overview.html:108`): the cite chip wraps
  within the idea column instead of running under the first seat's column. `councilmap.tsx` (`CheckLine` cite span:
  `wrap-anywhere`, `max-w-full`); no dev app was up.
- [ ] (arcterm) **Chat over a live Claude agent.** Start a Claude agent → its cell opens in Chat. Send "hello" → your
  bubble shows and the reply streams in under it, with the "Working · …" line while it works and Stop sending Esc.
  Ctrl+Shift+K flips to the real TUI and back (the box takes focus in Chat, the terminal in Terminal), and a long
  conversation scrolls to the end and keeps your place after a flip. Alt-drop another agent's row onto a cell in Chat:
  its `@mention` lands in the message box (nothing is typed into the terminal under it), and in Terminal it still goes
  to the prompt; closing the float note or the translate panel gives the keyboard back to the box. The `agent-chat`
  scenario drives the bubbles, the box, the flips, the split, the Alt-drop and the float note on fixture agents over a
  transcript file; a real session's stream and the translate panel's close are what is left to try here
  (`chatpane.tsx`, `agentsurface.tsx`, `cellinput.ts`). Claude's replies are bubbles on the left and its "Worked for …"
  line sits outside them, plain; a long tool output opens in place under its line, not in a dialog. Paste a screenshot
  into the box (and on Windows, one WebView2 hands over empty): a thumbnail shows, and once sent your bubble shows the
  picture, from a file under `~/.arc/attachments`. Type `@` in an agent of a registered project: its files list under
  the box, Enter or Tab picks one as `@<path>`, Escape closes the list and leaves the box focused (`chatcomposer.tsx`,
  `filemention.tsx`).
  **Second round.** In a real session, send a message while Claude works: your bubble shows dimmed and captioned
  Queued, then turns into the ordinary bubble where Claude took it (a `/command` draws no bubble of its own). Type `/`
  as the box's first character: Claude Code's commands and your skills list, and `/model` flips the cell to Terminal for
  its menu. The footer's chip against Shift+Tab in the TUI: the same mode in the same order, and while a dialog covers
  the TUI's own footer the chip keeps the last mode. On a real Bash prompt (`echo hi > x.txt`) the card's second button
  reads the prompt's own "Yes, and …" option 2 and answers it; try the card in a tall pane with a short conversation, and
  with two queued answerable requests (the second card's label should match its own dialog). Send while the card is up:
  the Send button is disabled with its reason. The `agent-chat` scenario (steps 20 to 26) drives all of this on fixtures:
  a `queued_command` line and the Queued bubble, the hold behind a card, ↑, the `/` menu over a mocked command list, the
  chip and the second button from Claude Code 2.1.319's captured screens written to the fixture terminal, a tool with no
  result drawn as running, and Copy on hover. What it cannot show is a live Claude Code: the real ordering of the queued
  line against a turn, the real dialog behind the screens, and Shift+Tab's actual cycle (`chatpending.ts`, `slashmenu.tsx`,
  `chatfooter.tsx`, `permissioncard.tsx`). The captured screens are the real 2.1.319 binary drawing against a mock API,
  and only the redirect form of the Bash prompt was captured: also try a plain command (such as `touch y.txt`) and check
  that the second button reads that prompt's own option 2. Open a subagent in the cell while it works, then after it
  stops: a tool it left with no result spins only while it works (`subagentinterior.tsx`). Hover a bubble: Copy sits in
  the gap under it, which is now wider under Claude's bubbles (about 20px, was 8px); judge whether that reads right.
- [ ] (arcterm) **Permission prompt in Chat.** In a real Claude session that is not on bypass permissions, ask for
  something that needs a prompt (a Bash command such as `echo hi > x.txt`): the chat shows the card with the command,
  Allow and Deny. Allow runs the command; Deny stops the turn. Answering the same prompt in the terminal instead (flip
  to Terminal, or "More options in Terminal") clears the card. Two parallel identical prompts show "1 more waiting",
  and Allow on the first leaves the second's card up until it is answered. The `agent-chat` scenario drives the card
  on fixtures with a mocked answer command; the `PermissionRequest` hook (`wsh install-agent-hooks`), the `1` / Esc
  it types and the queue in wavesrv (`pkg/agentperm`) were not tried against a live Claude Code.
- [ ] (arcterm) **A multi-question ask switches tabs in Chat.** Have a Claude agent call AskUserQuestion with two
  questions; in Chat, click the second tab: it shows the second question. Pick an option on the first: it moves to the
  second. Same in a held command's dialog and a run's worker card (`AskRow`, wired to `answerTabAtom` 2026-11-11).
- [ ] (arcterm) **Chat redesign: what the `chat-redesign` scenario cannot see.** In the packaged app, with a Claude
  agent in Chat: (1) motion at 60fps: while the agent streams a long reply and runs tools, the new rows and step lines
  ease in without a hitch or a jump, the box springs between idle, running and a dragged-over state, and a Windows
  "reduce animations" setting makes all of it jump instead; (2) drag real files from Explorer onto the box → it turns
  into the drop zone, and dropping attaches them as @ mentions; (3) a real brainstorm answered from Chat: have the
  agent start one (`arc:brainstorm`) and ask a question → the card shows in the conversation and the box says "Answer
  question N in your own words, or pick A–C above"; click an option, then ask another and answer it by typing in the
  box → each folds into a "Question N · … · You picked" row in place of your message, Chat stays on Chat the whole time
  (`chatconversation.tsx`, `chatpane.tsx`, `chatbrainstormcard.tsx`, `chatbrainstormwire.ts`; spec
  `docs/superpowers/specs/2026-11-11-chat-redesign-design.md`).
- [ ] (arcterm) **Kael sync 2026-11-12: the keys on a Mac.** On a Mac build (the scenarios ran on Windows or headless
  Chrome): in Code, ⌥M on a selection starts a review comment, ⌥⇧M with a comment present opens Send review, ⌥O opens the
  finder seeded with `@`, F12 / ⇧F12 on a word list its definition / references, and ⌥← / ⌥→ go back and forward from
  inside the editor (⌥ types ∂ / µ / ø on a Mac, so each is matched by its physical key: `optionLetterMatches`,
  `keyutil.ts`); in a terminal path ⌘⇧-click peeks at the file and ⌘-click still opens it; ⌘S in Setup → Instructions
  saves the shared doc (`bindings.ts` buildCodeBindings, `termpathlinks.ts` linkGesture, `setupinstructionsync.tsx`
  isSaveKey; `kael-keys` and `code-peek` cover Windows).
- [ ] (arcterm) **Review comments reach a real agent.** In Code, comment on two lines of a file in a project with a live
  Claude agent, then Alt+Shift+M → Send review → pick the agent: its prompt receives one message led by a one-line
  instruction with `path:lines`, the quoted line and your note for each comment, the comments leave the file's gutter,
  and a send with the agent gone says why and keeps them. In Diff, `m` on a line of an agent's working tree, Ctrl+Enter,
  then Shift+Enter: the agent gets the batch as its next prompt (joins a turn in progress, at its prompt when idle);
  with the agent asking a question the bar says Send waits. The scenarios send to a fixture agent through the DEV sink
  (`codereviewbar.tsx`, `commentsendbar.tsx`, `commentsend.ts`; commits b53e46f17 and c40d7d075).
- [ ] (arcterm) **The terminal Code peek on real output.** In a live agent's terminal that has printed a path to a
  markdown file, a changed source file, a file not tracked yet, an image and a binary: Ctrl+Shift+click on each → a card
  under the line (Preview, Source and Diff against HEAD for the first three; the image hinted; the binary named), Enter
  opens it in Code, Esc closes it, and a path Claude Code shortened with "…" is not underlined. Ctrl+Shift+click a
  second path with the card open: one card at a time, and the agent's session is never redrawn
  (`codepeekcard.tsx`, `codepeekhost.tsx`, `termpathlinks.ts`; commit 7b29fb067).
- [ ] (arcterm) **Setup sync on your own files.** Setup → Instructions with your real `~/.claude`, `~/.pi` and shared doc:
  a harness file you edited by hand reads out of date, Sync now shows the counts and writes it, and every file reads
  current afterwards; blank the shared doc → every row reads blank and Sync now is gone. In Setup → Skills, make a link
  (`mklink /J` on Windows, `ln -s`) in a harness's skills folder and copy a vault skill into it: the link lists under
  "Linked from another folder" and survives Manage; the copy offers Leave it and Replace it with the vault copy
  (`setupinstructionsync.tsx`, `setupskillsync.tsx`, `pkg/agentsync`; commits 26b69eee5 and cd2281893; the scenario
  runs against a page-side mock).
- [ ] (arcterm) **Usage By work and Workflow on real data.** Usage → By work after a day of real runs and a few brainstorm
  sessions: the project and initiative cards add up to All usage, a session's role / task / initiative reads right, a
  session whose tab you closed stays under its initiative, an unpriced model shows an estimate with its coverage, and
  Show more pages the list; Esc steps back from an item to its scope and then to All usage. Usage → Workflow → Scan
  workflow on a project with runs starts a real scan (it spends tokens) and the lens follows its four stages to
  Done (`usageworkview.tsx`, `workflowlensview.tsx`, `pkg/wshrpc/wshserver/usagesessions.go`; commits 4b3918a61,
  68d08dc32 and 29d5574ad; the scenarios use seeded data).
- [ ] (arcterm) **Diff on a landed run and an ended agent.** Open Diff on a run that has landed while the checkout has
  moved on since: the working-tree row reads base to the run's own tip, not the checkout's; close the agent that made
  the changes → Diff says "This agent has ended" with Open its folder; compare in a repository with no remote shows no
  Fetch, and in one with a remote Fetch is there (`diffsource.ts` subjectState, `landedRunTip`, `ListBranches`
  hasremote; commit c40d7d075; the scenarios break the reads at the RPC client).
- [ ] (arcterm) **A sent message rises into Chat from the box.** In an agent's Chat, send a message (to an idle agent,
  then one while it works, then a `! ls`): its dimmed bubble rises in from the box in about a third of a second rather
  than appearing at once, and the transcript's copy replacing it later does not move. Switch to another agent and back,
  or to Terminal and back, while one is still Sending… or Queued: it shows at once, with no second rise. With the OS's
  reduced motion on, it only fades (`chatpane.tsx` PendingBubble / PendingCommand, `chatsentrise.ts`; no scenario
  catches the motion).
- [ ] (arcterm) **The hologram folds into the asking sphere.** With the hologram as Jarvis, have an agent ask you
  something (a permission prompt): over about a second the HUD's rings wind in and draw down into the core while the
  amber sphere grows out of it, a touch past its size, with a flare of light at the crossing; answering it plays the
  same back. Hover the hologram: solid; leave: faint, also while the sphere shows. Click it → the crossed eye → Hide 1
  hour: the peek closes and Jarvis collapses to a line, flares and goes; Ctrl+P → Show Jarvis: it opens from a line
  back into the HUD. Try it once on a Mac too (WKWebView draws the canvas's alpha its own way) and with the OS's
  reduced motion on, where it only fades (`hologrammodel.ts` morphPose, `hologramscene.ts` draw, `hologramview.tsx`
  POWER_ON / POWER_DOWN; the jarvis-hide scenario shoots the power-down and power-on, no scenario catches the morph).
- [ ] (arcterm) **A Chat send waits for Claude Code's box.** Send a few messages from an agent's Chat (a short one, a
  long one that wraps, one with a line break), also while Claude works and with the machine busy: each goes out on its
  own, none waits in Claude Code's box with an empty row under it. `waveapp.log` no longer shows
  `[chat-send] enter-unechoed … echo=unknown` for every send (it read so 36 of 36 times before), and an
  `enter-linebreak … retry=1` line, when one shows, is followed by the message going out. While Claude works, ↑ in an
  empty Chat box takes the queued messages back (`chattakeback.ts` splitRules; no scenario runs a live Claude Code).
- [ ] (arcterm) **The initiative band on a live Claude agent and on a Mac.** Link a real Claude agent to an initiative,
  let a turn end on a chunk, then click its `go on with: <label>` chip: the band moves to that chunk at once, the
  waiting line never draws over the box, and the agent's next prompt starts with
  `initiative: switched you to chunk <n> <label>`. Mark done from the band: the agent moves to the next chunk. Press
  `i` from the message box: the band opens and `m`, `n`, `w` and the arrows work without a click. Once on a Mac
  (`task dev:browser`, then `task verify:ui -- chat-initiative-band initiative-popover initiative-link`): the scenarios
  ran only on WebView2 in run 175af141, with fixture agents (`initiativebandview.tsx`, `chatpane.tsx` goOn).
- [ ] (arcterm) **A reply draws once when you send the next message as it ends.** In a Claude agent's Chat, send a
  message while the reply's last paragraph is still streaming (once queued, once with Send now), and once right after it
  ends: the reply stays one copy above your message, with no second copy under it and no flicker (`chatlive.ts`
  withLiveReply; unit tests only, no scenario streams a live reply).
- [ ] (arcterm) **A `! command` that restarts arcterm stays in Chat.** In a Claude agent's Chat, send `! task install`
  (or any `!` command, then quit arcterm while it runs): after arcterm reopens, the agent's Chat shows the `!` row right
  after the reply it was sent after, before your next message, with "Sent before arcterm restarted · its output was not
  kept". A `!` that finished normally shows once, with its output, never a second time (`chatlostbash.ts`; unit tests
  and the typecheck only, no scenario restarts the app).

# Waiting on a hand check

Changes that shipped tested only by unit tests or the typecheck, never tried in the running app (or a platform branch
no build here compiled). Split out of `docs/open-issues.md` on 2026-11-03; that file keeps the rest of the backlog.

Each line: what to do, what you should see, where, and the commit. Tick it when it holds, then remove it; when it
does not, say what you saw and it becomes a bug row under Actionable.

**Parts.** This file is the open part: a new line always goes here, at the top. When an edit takes it past 400 lines,
move its oldest lines (whole entries from the bottom, a date heading with its entries) to the top of the
highest-numbered `hand-checks-N.md` until this file is under 250 lines; when that part would pass 600 lines, start
`hand-checks-<N+1>.md` with the same header instead, and add it to the list below. The higher the number, the newer
its lines. Lines in an older part are ticked and removed where they are; a part left empty is deleted and taken off the
list (its number is not reused).

Older parts: [part 7](hand-checks-7.md) · [part 6](hand-checks-6.md) · [part 5](hand-checks-5.md) ·
[part 4](hand-checks-4.md) · [part 3](hand-checks-3.md) · [part 2](hand-checks-2.md) (oldest).

- [ ] (arcterm) **Sidecar P/Q across a real day: the question heuristic's misses, the ping from across the room, RAM of
  P with 12 agents after a day.** The `sidecar-orbit` and `sidecar-compact` scenarios read fixtures: they cannot judge
  a real day. With real agents for a day: (1) a finished agent whose last message asks something gets a Needs you row
  (Enter: reply in the main window), and a rhetorical question at the end of a report does too, which is the miss to
  count (spec "Open": a miss only adds a row, and answering or opening it clears it); note the false rows and any
  question it did not catch. (2) From across the room (a second screen, 2 m away), a waiting node or row pings and you
  see it without reading; nothing else on the screen moves. (3) RAM of P with 12 agents after a day on screen, against
  the 100 MB budget: write the figures into the "Sidecar, part 3" row of `docs/open-issues.md` "RAM watch" (the main
  window's renderer grows on its own: read Sidecar's renderer plus the GPU process it adds, as the part-1 row does).
  Commit: test(sidecar) CDP scenarios for the orbit dashboard, full and compact
- [ ] (arcterm) **Packaged build: Sidecar has its own taskbar button with the screen badge, not arcterm's icon;
  right-click shows no "Pin to taskbar"; closing arcterm closes it.** Windows only; the dev app shares the exe's icon
  either way and the `sidecar-orbit` scenario only reads the log line `[sidecar] app id dev.arc.app-dev.sidecar`. Install
  a `task tauri:build` build and open Sidecar → it is its own taskbar button, not grouped under arcterm's, drawn with
  arcterm's mark and a small screen badge in its corner; right-click its button → no Pin to taskbar (a pin would relaunch
  arcterm, not Sidecar); close the main window with the tray icon off (Settings → `app:tray`) → Sidecar closes with it.
  The spec's open question is answered here: which icon Windows draws for a window whose id has no shortcut, the
  window's own (`WM_SETICON`) or the exe's; if the exe's, say so and the host's icon call is the next thing to look at.
  Commit: feat(sidecar) its own taskbar button and icon on Windows
- [ ] (arcterm) **A pencil marks an agent with an unsent message.** Vitest and the typecheck only. Type half a message
  (or attach a file) in one agent's Chat box, pick another agent → the first one's row in the Agent tree shows a small
  accent pencil after its name (also in a split row's cell); pick it again → the pencil is gone while you are on it;
  send or clear the box → it does not come back. Commit: feat/draft-mark.
- [ ] (arcterm) **Sleeping agents keep their titles across a restart.** Vitest and the typecheck only. With several
  agents asleep (some on transcripts of a few MB), restart arcterm a few times → every sleeping row in the Agent tree
  shows its conversation's title, none its project's name; if a row starts as the project's name it turns into the
  title within a minute (`sleepertitles.ts`, the read queue that retries).
- [ ] (arcterm) **A first review fail reopens the worker's session.** Go unit tests only, with the resume stubbed; no
  engine run (commit 01900d143). (1) Run a small plan with a claude worker whose task the reviewer will fail (a task
  that asks for a test it skips). → On the fail, the worker's own tab restarts with the findings as its first prompt
  (scrollback above it), no new worker row appears in the Agent tree, and the run timeline shows `t-N: review fix
  round in the same session`. (2) The worker fixes, runs `wsh jarvis complete`, and the second reviewer starts; the
  task does not stall in the first minute after the reopen. (3) Restart arcterm between the worker's complete and the
  fail (no context figure survives a restart) → the timeline shows `t-N: fresh worker: the worker reported no context
  size` and a new worker tab starts as before.

- [ ] (arcterm) **Sidecar keeps asks, answers the ask you saw, and fills a high-scale screen.** Vitest and the
  typecheck only; no dev app ran (branch `fix/sidecar-council`). (1) Set the Cockpit's project filter to one project,
  or send an agent to Background, and have that agent ask a 2-option question: it shows on Sidecar's orbit (P) and in
  the compact window (Q) as a Needs you row. (2) Answer the row with 1: it lands as before; `answer … refused` in
  `waveapp.log` only when the ask changed under you. (3) On a 1920 px screen at 175%, maximize or full-screen Sidecar: P
  shows, not Q; drag it narrow and Q comes back. (The wall and its tiles went with the orbit dashboard; the
  `sidecar-orbit` and `sidecar-compact` scenarios read the same rows.)
- [ ] (arcterm) **Close on the Agent tree's picked rows.** The `tree-multi-close` scenario reads the menu and the
  confirm on a fixture roster and cancels; nothing was ever closed. In the app, Ctrl+click two idle agents (no run) in
  the sidebar, right-click one → Close 2 agents closes both at once, a toast says "Closed 2 agents", the picks clear,
  and both sit under Conversations to resume. With one working, it asks first naming it; with a run's lead picked too,
  the item says "1 in a run stays" and the lead stays open. Commit 21e72f9cd.
- [ ] (arcterm) **No terminal card over a prompt that is up.** Vitest only (fixtures with their rules joined, as
  `readTermLines` gives them); never tried in the app. In a Claude agent in auto mode, let it stop and wait on you
  (a Notification, or a brainstorm question): Chat shows no "Waiting on you in the terminal" card quoting
  `⏵⏵ auto mode on`. Press Shift+Tab in the terminal a few times: the mode chip under the chat box follows each mode.
  Have it run a Bash command that needs permission: the dialog card's text holds no `╌╌╌` lines
  (`tuiscreen.ts` `splitRules`, `tuiPromptUp`).

- [ ] (arcterm) **Agents start without a PowerShell around them (Windows): a new agent and a run worker.** Resumed
  Claude agents are checked (build ee9ef3a4c: four `claude.exe` straight under wavesrv, hooks reporting, `wsh` found).
  Still untried: launch a new Claude agent and start a run worker; each works as before and has no `powershell.exe`
  above its `claude.exe`. A pi or codex agent (a `.cmd` shim) still has its PowerShell. If something only your
  PowerShell profile set is now missing for an agent, that is this change (`shellexec.directProgram`).
- [ ] (arcterm) **Commit card from a real agent.** The `chat-commit` scenario drives the card from a fixture transcript;
  a live agent writing the block was never tried. In a Claude agent in a repo whose rules say to ask before committing
  (e.g. SIEM), have it finish a change: instead of a prose "commit?" its reply ends in a Commit suggestion card
  (message box, a tick per file, Commit). Edit the message, untick a file, press Commit → the card folds into
  "Commit suggestion · N files — Commit sent", the agent commits exactly that message and those files
  (`git show --stat HEAD`) and reports the hash. In arcterm itself (where the agent commits on its own) no card shows.
  Also check the first prompt of a new session carries the full "Commit asks in arcterm" line and later ones the short
  reminder (`commitask-core.ts`, `skills/commit/SKILL.md`, `chatcommitcard.tsx`).
- [ ] (arcterm) **No `/compact` loop before a sleep.** Unit tests only; never tried in the app. Have a Claude agent
  with 100k+ of context go idle (sleep on, After idle for short), off screen, so the sleep loop compacts it: Chat
  shows one `/compact Keep: …` and the agent sleeps once it lands. Run `/compact` by hand right before so the loop's
  one answers "Not enough messages to compact": the agent still sleeps within a minute, with no second `/compact`
  10 minutes later. With a session moved to the background from that tab, `waveapp.log` shows no "dropped
  PreToolUse's working … reported after its turn ended" for its tools. Commit 0102ea983.
- [ ] (arcterm) **Closing a brainstorm.** Unit tests and the typecheck only; never tried in the app. In an agent with a
  brainstorm open: (1) ⋯ → Close brainstorm. The Brainstorm tab, the header strip and the Chat card go, the agent gets
  `brainstorm: close` (hidden in Chat) and answers in the terminal, and the earlier ✓ rows stay ✓ rows rather than raw
  `brainstorm: …` bubbles. (2) Open another one, type "off brainstorm, bàn tiếp" to the agent. It runs
  `wsh brainstorm close <path>`, prints "Closed the brainstorm …", the same three things go, and a toast names it.
  (3) Resume it from the palette (Brainstorms ›) and the pane comes back on its open question.

- [ ] (arcterm) **A council's Summary uses the Discussion's `canSummarize`.** Vitest and typecheck only. Open a council
  whose only idea is a held draft (Summary, no summary yet) → no Summarize button; one with a sent idea that is done,
  stopped or failed in round 1 → Summarize shows, and Summarize again is on once there is a summary. Commit: the
  `chore(council): Summary uses canSummarize …` one.
- [ ] (arcterm) **Prettier sweep reordered imports in the palette, the route picker and the run sheet.** Typecheck,
  eslint and the bindings/palette/route vitest only; no change meant, but import order sets module load order. In the
  dev app open the command palette (Ctrl+P), a launcher's model picker, and a run's sheet in Jarvis → each opens and
  draws as before. Commit: c378f3486.
- [ ] (arcterm) **The arc mod's gating hooks carry a `.catch`.** Vitest, the mod typecheck and `claude plugin validate`
  only (all 15 now listed "with .catch"). The handlers run only when a hook fails, so day to day nothing should change:
  after `wsh install-agent-hooks` (or a launch), in a Claude session in arcterm run a Bash command, edit a file in the
  session's repo, send `@<tab id> hi` to another agent and start a subagent → each behaves as before, with no `arc:`
  hook failure line in the transcript. Commit: the `chore(arc-mod): .catch …` one.
- [ ] (arcterm) **The Token burn gate gathers parallel spawns on `$.clock.sleep`.** Vitest and the mod typecheck only.
  The gate's gather wait used `setTimeout`, which a mod's declared environment does not have; whether it was missing at
  run time was never seen. After `wsh install-agent-hooks` (or a launch), have a Claude session in arcterm start 3
  subagents in one message → one Token burn card naming 3 agents, and no `arc: tool.call hook` failure line in the
  transcript. Commit: the `chore(claude-mods): typecheck …` one.
- [ ] (arcterm) **A run's Setup no longer holds the dag lock.** Go tests and the `dag-preparing` CDP scenario only (a
  seeded dag in a worktree dev app); the run's Final ended unverified on one flaky wshserver test. On the installed
  build, run a plan of three or more tasks in this repo (its `.arc/setup` makes each tree): the task cards read
  "preparing its tree" for a moment before running, and `waveapp.log`'s `dag <id> lock:` lines no longer name
  `dispatch` as the slowest phase with holds of 10 s and more (`66bea964a`).
- [ ] (arcterm) **A lead's tell reaches the worker, not its `claude -p`.** Mod tests and `claude plugin validate`
  only. On the installed build, in a run whose worker runs `claude -p "sleep 60 with Bash, then say done"`, send
  `wsh jarvis dag tell <task> "<note>"` while it waits: the worker's own session takes the note (mid-turn), and after
  the nested run exits a second tell still reaches it over the stream, not typed into the composer (`bf4c55362`).
- [ ] (arcterm) **Diff n / p open a collapsed folder.** Unit tests and typecheck only, no dev app ran. On Diff in tree
  mode with changes in two folders, collapse the second, then press n until the next file is in it: the folder opens
  and the file's row is selected on screen (3bc4f85dc).
- [ ] (arcterm) **The Cockpit's Enter sends a typed answer.** Typecheck only, no dev app ran. With an agent asking one
  question on the Cockpit, type an answer in its box without picking an option, move focus back to the card and press
  Enter: the answer is sent, not the agent opened (3bc4f85dc).
- [ ] (arcterm) **The Chat being read keeps its place when a launch finishes starting.** The CDP scenario
  `chat-scroll-keep` (step 2b) checked it over a fixture roster, not a real launch. + New a Claude agent in another
  project, switch to an agent whose Chat you have scrolled halfway up before the new one's Claude answers, and wait for
  its title and first message: the Chat stays where you were reading.
- [ ] (arcterm) **A message sent mid-turn keeps the agent working.** Unit tests only; the installed mod needs an
  arcterm launch to pick it up. While a Claude agent runs a tool, type a message in Chat so it queues and interrupts the
  tool: Chat keeps "Working · …" under the reply and `wsh agents list` reads `working` through the rest of that turn,
  and wavesrv's log has no "dropped PreToolUse's working … reported after its turn ended" lines for it.
- [ ] (arcterm) **A Work on session keeps its initiative.** Go tests only, no dev app ran. In Jarvis, Work on an
  initiative whose notes point at another one, and ask the agent to `wsh effort show` that other initiative: the Agent
  header and initiative band keep the one you picked (63184f53b).
- [ ] (arcterm) **The chat box answers a single question.** Unit tests and typecheck only, no dev app ran. Have a
  Claude agent ask one AskUserQuestion, then type a reply in the chat box (not the card) and press Send: it goes at
  once, the card closes, and the agent goes on with your words as the answer, with no "Queued · sends once you answer"
  line. An ask of two questions still shows that line and holds the message.
- [ ] (arcterm) **A send to a killed agent is refused.** Unit tests only; the shell reading (`shellHoldsNothing`) never
  ran against a real terminal. Start claude in an agent tab, then kill its process (Task Manager, or `taskkill /PID`,
  not `/exit`) so the tab is back at its shell prompt: `wsh agents send <tab> hi` from another agent answers "back at
  its shell prompt … nothing was sent", and nothing is typed into that shell. A send to a live agent still goes
  through. Try it in a Git Bash tab and a PowerShell tab (Git Bash hides MSYS children from Windows, native ones it
  shows), and on a Mac (the process list reads differently there).
- [ ] (arcterm) **The Jarvis hologram no longer drops to the pixel pet.** Unit tests and typecheck only, no dev app
  ran. Use arcterm a working day with many agents and terminals opened, closed and switched between: `waveapp.log`
  has no `[hologram] failed` line, the hologram never turns into Sprout/Minion for 5 s, and terminals still draw sharp
  (WebGL) after switching back to one hidden for over 30 s.
- [ ] (arcterm) **A finished run or council stays where it finished in Chat.** The CDP scenario `chat-council` checked
  the council cards on fixtures; the run ✓ row has no scenario (unit tests only). In a real agent that ran a run and a
  council, keep talking after both end: the Done council card stays just above the agent's summary of it and the run's
  ✓ row where its `[arc] Run … landed` message came (a quick run, which sends none: after the last tool call before it
  finished), both scrolling away with the conversation; only a run or council still going sits at the bottom.
- [ ] (arcterm) **Chat's selection has softly rounded corners.** CSS only, no dev app ran. In Chat, select a word and
  then a few wrapped lines: each highlighted line has 3px rounded ends, and the lines still meet without a gap that
  reads as broken.
- [ ] (arcterm) **`[` `]` on an open brainstorm board stay in the asked part.** Unit tests and typecheck only, no dev
  app ran. In a brainstorm whose open question's part has two or more boards (and another part has boards too), open
  one from the rail's Boards tab: `]`, `[`, `←` and `→` cycle only that part's boards, never the All view or another
  part's board, and the dialog's title follows. (a411573de)
- [ ] (arcterm) **A narrow brainstorm run step stacks.** Unit tests and typecheck only, no dev app ran. Narrow the Agent
  pane under ~820px on a brainstorm handed to a run: the run's rail sits under the summary at full width, not 460px
  beside it; under ~520px each "What you handed over" row puts its gist under its title. (66933b70e)
- [ ] (arcterm) **A brainstorm waiting on you does not take the keyboard.** Unit tests and typecheck only, no dev app
  ran. Pick, with `j`/`k`, an idle agent whose brainstorm asks a question: `j`/`k` keep moving the tree. An agent at
  a permission prompt still takes the keyboard when picked. (80d72e75a)
- [ ] (arcterm) **A pi that quits leaves the agents list.** Unit tests only, no live pi ran. After installing the
  build (its launch writes the new pi status extension), run pi in an agent tab and quit it back to the shell:
  `wsh agents list` no longer lists that tab, and `wsh agents send` to it is refused instead of typed into the shell.
  Start pi again in the tab: once it starts, the tab is listed again. `dd3f02acc`
- [ ] (arcterm) **A paragraph picked above a code block leaves its line number alone.** Unit tests and typecheck only,
  no dev app ran. In Chat, triple-click a paragraph that sits right above a code block: only the paragraph is
  highlighted, not the block's `1`, and a copy holds only the paragraph's text.
- [ ] (arcterm) **A landed run keeps no blank columns.** Unit tests and typecheck only, no dev app ran. In the Agent
  sidebar, a landed run (no RAM, tokens or age) reads `✓ Landed` whole on its second line, not `✓ La…` before three
  blank columns; a running run beside it still lines its RAM up with the other rows.
- [ ] (arcterm) **Approve on a brainstorm that queues.** CDP `run-start-choice-brainstorm` checked the Brainstorm tab's
  approve bar against queue entries made over RPC; the launcher's own Queue from Approve, the `brainstorm: queued`
  line, wavesrv's `brainstorm: run <id>` and Chat's card were not tried. Fill the run cap (`runs:maxactive`), approve a
  design in a brainstorm and press Approve → in the launcher pick Queue → Start: the dialog closes, the agent's
  terminal gets `brainstorm: queued q-…` and writes nothing, the tab's approve bar reads `Queued` (Approve off), and
  Chat's Builder check card reads the same in grey, not amber. Raise the cap → the agent gets `brainstorm: run <id>`,
  records the run, and Chat draws the run row for that line. Dequeue the entry instead → Approve is on again. Agent
  surface, Brainstorm tab and Chat. Task 6 of the run-start-choice plan.
- [ ] (arcterm) **A long council tag wraps in its card; suggestion chips share a line.** Not tried in the app: no dev
  app ran, typecheck only. Open a done council whose direction tag names two long seats (`Reviewer 3 (evaluation) and
  Phản biện have doubts`) → the tag wraps to two lines inside the card, its icon on the first. In that council's box
  with three long asks, and in a Claude agent's Chat with long suggestions in the full-width column → two chips share
  the first line (each up to 340px, cut with …), not one per line.
- [ ] (arcterm) **A message that lands joined to another clears its Queued bubble.** Unit tests and typecheck only, no
  dev app ran. In a build with 9504b430c, in a Claude agent's Chat: send `làm đi`, then in the agent's Terminal type
  `xyz` in Claude Code's box without Enter, back in Chat send `báo council đi` while it works (it lands as one prompt
  `xyzbáo council đi` once the turn ends) → its Queued bubble goes as that prompt lands, not 30 minutes later. Same
  with a short one: after `làm đi`, leave `làm đi` in Claude Code's box and send `ok` → `làm điok` lands and the `ok`
  bubble goes.
- [ ] (arcterm) **A Claude Code menu no hook reports shows in Chat as a card.** Not tried in the app: unit tests on the
  real pause screen (its PTY output replayed through xterm) only. The first try showed the foot-of-screen card instead,
  as the card read only the bottom 40 rows (commits "fix(chat): a terminal menu no hook reports shows as a card", "fix(chat):
  Edit prompt comes back to the box; a screen Chat cannot read shows as its foot" and "fix(chat): the screen card reads
  the whole screen, so a dialog at its top is found", 2026-11-16). When Claude
  Code stops on the safeguards' "Session paused" menu, Chat shows a yellow card titled `Session paused` with its text
  (paragraphs read naturally, not cut at the terminal's width), `1. Switch to Opus 4.8` / `2. Edit prompt and retry with
  Opus 5.5` and Answer in Terminal, and within ~10 s the agent reads asking in the tree and Needs you. Switch picks it
  and the card goes; Edit prompt empties Claude Code's box and puts the prompt in Chat's box, focused, and the prompt's
  bubble leaves the conversation. A plain permission prompt still shows only the permission card. With an MCP form or
  another unnumbered screen up while the agent reads waiting, Chat shows "Waiting on you in the terminal" with the foot
  of the screen in mono; it never shows while Claude Code's prompt and mode line are up.
- [ ] (arcterm) **Claude Code's folder trust prompt shows in Chat as a card.** Unit tests on a screen written from a
  screenshot only, no dev app ran (commit "fix(chat): Claude Code's folder trust prompt shows as a card"). Resume a Claude
  agent in a folder Claude Code does not trust yet (another drive-letter case of a trusted one did it on 2026-11-17):
  Chat shows a yellow card titled `Accessing workspace:` with its text and two buttons, `No, exit` and `Yes, I trust
  this folder` (no numbers), the second one highlighted. Yes picks it (the terminal moves on past the prompt) and the
  card goes. If no card shows, the prompt has no solid rule over it on the real screen: capture its PTY output for
  `tuiscreen.fixtures.json`. With wavesrv from "fix(agents): an agent on Claude Code's folder trust prompt reads
  asking" (Go tests, and the scanner on that agent's real stored output, only), the agent also reads asking in the
  tree and counts in Needs you while the prompt waits, even unopened (`waveapp.log`: "shows Claude Code's folder trust
  prompt; reading it asking"); after Yes it reads idle, or working on the restore's nudge, and after No, exit idle.
- [ ] (arcterm) **Opening a run from an agent shows it in the Agent tree, not Jarvis.** Unit tests (`runTreeAgent`) and
  typecheck only, no dev app ran (commit "fix(agents): a run opened from an agent shows in the Agent tree"). With a
  brainstorm whose approved run is under way: click its run line in the tree (`working · …`, title Show the run in the
  tree), its pane's Open run, and Open run on Chat's run card → each stays on Agent, selects the run's lead (or, with no
  lead tab, the run's agent that asks or works) and unfolds the run's lanes under it. With the lead closed and no task
  at work, each opens the run in Jarvis as before.
- [ ] (arcterm) **A canvas board's screenshot button shows a camera.** Typecheck only, no dev app ran (commit
  "fix(canvas): the board's screenshot button shows a camera"). Open an agent's Canvas: the board's top-right button
  reads a camera icon then `Copy`; a click turns it into ✓ `Copied` and puts the board's picture on the clipboard.
- [ ] (arcterm) **An unclosed tag in a Markdown Preview shows as text; a highlight around a bare link closes.** Unit
  tests only, no dev app ran (commit "fix(markdown): an unclosed tag in a Preview shows as text; a mark closes on the
  == a bare URL swallowed"). Open `harnesspov/harnesspov/agent/prompts/system.md` (mit-thesis) in Preview: line 4
  reads `"script":"<a complete Node CommonJS script>"}` as written and nothing after it is blue. A `<details>` with
  its `</details>` in a README still folds. In Chat, an answer with `==… http://localhost:4321/.==` draws the sentence
  highlighted with no `==` showing, the link ending at `4321/`.
- [ ] (arcterm) **A council an agent ran ends as a card at the end of Chat, its summary in a council panel.** The CDP
  scenario `chat-council` covers fixture transcripts only (commit "feat(chat): an ended council stays a card at the end,
  its summary in a council panel", 2026-11-16). Ask a Claude agent for a council (/arc:council) and let it wait in the
  background → once it ends, Chat ends with a `Council · review` card (✓ Done · N directions, the answer, Open report)
  after any run cards, and the agent's first reply after the council's notification sits in a tinted panel headed
  `Council · review · N directions` with Open report; the `wsh council start` call stays a plain tool line.

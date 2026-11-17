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

Older parts: [part 6](hand-checks-6.md) · [part 5](hand-checks-5.md) · [part 4](hand-checks-4.md) ·
[part 3](hand-checks-3.md) · [part 2](hand-checks-2.md) (oldest).

- [ ] (arcterm) **The When row's choices are pill badges.** Prettier only. + Run → a project → the third column's
  When row shows Run now, After run… and Queue as separate rounded pills (wrapping on a narrow column, "After run…"
  never cut off), the picked one accent-tinted, and the one Jarvis suggests carries a small "Jarvis" badge inside it
  instead of a "Jarvis suggests" line under the label; `task verify:ui -- run-start-choice` still passes.
  `launcherwhenrow.tsx`.
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
  or send an agent to Background, and have that agent ask a 2-option question: it shows on Sidecar's wall and in the
  small form. (2) Answer a tile with 1: it lands as before; `answer … refused` in `waveapp.log` only when the ask
  changed under you. (3) On a 1920 px screen at 175%, maximize or full-screen Sidecar: the wall shows, not the small
  form; drag it narrow and the small form comes back.
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
- [ ] (arcterm) **Sidecar's wall holds only the Cockpit's agents.** Unit tests and typecheck only; the rewritten
  `sidecar-wall` scenario (steps 4-6, 14-15 and the new 24) was not run, since it needs the Tauri host (branch
  `feat/sidecar-button`). Run `task verify:ui -- sidecar-wall` on a dev app. By hand: with agents idle for hours, Sidecar
  shows only the asking, working and just-finished ones, the title bar still counts the idle ones, an agent that
  finishes leaves the wall about 5 minutes later, and switching the Cockpit's project filter or Live only changes the
  wall too.
- [ ] (arcterm) **Sidecar opens from the Cockpit and from the Jarvis button.** Typecheck and the keybindings tests only,
  no dev app ran (branch `feat/sidecar-button`). On the Cockpit, the header's Sidecar button (after Live only, in Cards
  and in Office's bar) opens Sidecar, or brings it forward when it is open; a right-click on the Jarvis button at the
  app bar's right end shows Open Sidecar first, above the fold items, and it does the same.
- [ ] (arcterm) **The browser-drawn controls draw dark.** Not tried in the app: no dev app ran, and CDP cannot capture
  a native popup (commit "fix(ui): the browser-drawn controls draw dark", 2026-11-16, `color-scheme: dark` on `:root`).
  In Setup → Tools add a tool and click into its folder field → the project suggestions open dark, not white. An
  unchecked checkbox (New dialog, Tools) and radio (Setup skill sync) are dark boxes now, not white, and still read
  as controls; the Telegram card's time fields still open a dark picker.
- [ ] (arcterm) **The Jarvis peek's project list opens dark.** Not tried in the app: CDP cannot capture a native
  `<select>` popup (commit "fix(jarvis): the peek's project list opens on the theme's surface", 2026-11-16). Open the
  Jarvis peek and click "No folder" under the Ask box → the list is the dark surface with primary text, like Setup's
  selects, not white with grey names; switch theme and it follows (`peterrand.tsx`, `[&_option]` classes).
- [ ] (arcterm) **A council's discussion has no ↩ Back pill.** Unit tests and typecheck only, no dev app ran
  (commit "feat(council): drop the Back jump pill from the discussion", 2026-11-16). Open a council with a long discussion, scroll to the middle, click ↑ Top then ↓ Latest →
  only ↑ and ↓ ever show in the bottom-right corner, each still glides to its end, and j/k still move after a click.
- [ ] (arcterm) **The pinned bar skips a picture-only message.** Unit tests and typecheck only, no dev app ran. In a
  build with f67013e11, in a Claude agent's Chat send a message, then one that is only a pasted picture, then scroll
  up past both → the pinned bar shows the text message, never "(picture)"; its ↑ and its n/m count step over the
  picture-only one.
- [ ] (arcterm) **A tight run line keeps its count.** Unit tests and typecheck only, no dev app ran. In the Agent
  sidebar at 248px, a working run whose tasks wait in the job queue (`≡#3`) with its RAM shown: its second line reads
  `Work… · 2/6` (or `Working · 2/6` when it fits), never `Working · …`; hover the words for the full line. A run a session started
  (its ↰ after the words) keeps `· 0/5` whole beside the ↰, never under it.
- [ ] (arcterm) **A wait on a council or an agent shows no terminal row.** Unit tests and typecheck only, no dev app
  ran. Have a Claude agent seat itself on a council (`wsh council start --agent self`, which runs
  `wsh council wait <id> --timeout 0` in the background) → no "Wait for council to finish" row under the agent in the
  tree and no background line above Chat's box; the council card and its own tree row still show, and the report
  still comes back when the council ends. The same holds for `wsh agents wait <tab>` run in the background. A build or
  dev server run in the background still shows as before.
- [ ] (arcterm) **A landed run offers ✓ Close run.** No dev app ran. In the Chat of an agent that started a run, once
  the run lands its card folds to `✓ Run a9e0fd4f landed · merged into main …` → a green `✓ Close run · N open` sits at
  that row's right end; the rest of the row still opens the `[arc] Run …` message. Click it → the Close run confirm
  names the run and N sessions; confirm → the run's lead, workers and reviewers close, and the button goes. In the
  Agent sidebar the ✓ sits on the agent that started the run (its row reads `merged · run …`), not on the run's row:
  once you have read its last turn, click it → `Close agent and run` names N open sessions; Close all → it and the
  run's sessions close, Close agent only → only it. Close that agent by Alt+W or its header ✓ → the same confirm. A
  run started from + Run (no origin agent) keeps the small ✓ on its own row. A run still landing, or held, shows
  neither. (Origin ✓: unit tests and typecheck only.)
- [ ] (arcterm) **The run chip's × hides finished runs.** Unit tests and typecheck only, no dev app ran. On an agent
  whose started runs have all landed (`2 runs` on its tree row and beside its name in the header), hover the chip → a
  small × shows after it; click it → the chip is gone from both places, and stays gone after a reload. With one run
  still going, the × hides only the finished one and the chip reads that run's progress. A lead's own `run 1c…` link
  shows no ×.
- [ ] (arcterm) **An interrupt keeps Chat's conversation in place.** No dev app ran. In a build with 1b304b177 (it
  reinstalls the arc mod on launch), on Windows, send a Claude agent in Chat a long task and press Esc while it works →
  the conversation stays where it was: no skeleton, no blank, no redraw from the top. Before, it emptied and loaded
  again whole on every interrupt.
- [ ] (arcterm) **New project leaves out the council bench's folders.** No dev app ran. In a build with 28dcb26a5,
  open + → New project → no row's path is under the app's data dir (`…\dev.arc.app\data\council-bench-projects\…`:
  spec-live-agents, bugs-orchestrate, goalpost-guard…); typing still finds folders on disk.
- [ ] (arcterm) **A pending land's peek reads as a card.** No dev app ran. In the Agent sidebar, hover a run's
  `Landing · Verify r…` line → the tip is two lines (`Landing into main · Verify running 18s`, then that a click opens
  the details), not the run id and commands. Click the line → the peek shows a green pulsing dot and the line in full,
  `Run a9e0fd4f → main` under it, then rows labelled STEP / COMMAND / INSPECT (WHY and JOB while queued) with the
  commands and job id in code chips; the dot is yellow on a RAM wait. Copy for an agent still copies the old lines
  (`Run … · land pending into main`, `Step: …`, `Command: …`).
- [ ] (arcterm) **A long menu row is cut, not stretched.** No dev app ran. On an agent that started runs with long
  goals, click `N runs ▾` in its header → the menu is at most ~520px wide, each Started runs row is one line ending in
  `…` with its status (`done`, `running`) still at the right, and hovering a row shows the whole goal. Other menus
  (the header's ⋯, a tree row's right-click) look as before.
- [ ] (arcterm) DUM-E: with dume:enabled on, a dum-e chunk pending and under an hour to the 5h reset with 30%+ left, a
  sonnet quick run starts in a wave/dume-… worktree within 5 min; when it ends the chunk reads "ready to land" with a
  git merge line, and the Brief header line follows along.
- [ ] (arcterm) **The ↩ Reply button sits off the selection's top-right corner.** No dev app ran; CDP `chat-quote`
  step 1 was updated to the new place without a run (`task verify:ui -- chat-quote`). In Chat, select a few lines of a
  reply → the small ↩ sits just up and right of the widest line's end, touching the corner diagonally; a selection
  against the pane's right edge keeps it inside the pane; with no room above it goes off the bottom-right corner.
- [ ] (arcterm) **A run's second line lines up with an agent's.** No dev app ran. In the Agent sidebar, a run row
  (`› 7  Working · 7/7`, or a run with no plan yet reading `working`) → its second line starts under the title, at the
  same column as an agent's `planning · run 1c…`, not under the icon; its progress bar below is unchanged.
- [ ] (arcterm) **Chat's permission card answers an Artifact prompt.** Unit tests and typecheck only; the screen
  reader (`tuiSelectYes`) was tested on a list written from a screenshot, not a capture. Have an agent delete a
  throwaway artifact → the card reads `Wants to use an artifact`, `delete https://claude.ai/artifact/…`, with Allow and
  Deny; Allow deletes it (the terminal's cursor moves from No to Yes, then Enter), Deny cancels. Also check the
  publish consent, if it asks. Agent surface, Chat. dc372ecbd.
- [ ] (arcterm) **The brainstorm card holds its place from step to step.** CDP `chat-redesign` 14c checked the held
  state and that the end row is the same element; the motion itself was never watched. In a live brainstorm in Chat,
  click an option → the card stays, its rows dimmed, `Sent · <answer>` in its footer, no collapse; when the next
  question lands the card changes in place and eases once to its new height. Same for Confirm the design → Builder
  check. Agent surface, Chat. 541b374df.
- [ ] (arcterm) **A crowded agent header keeps its project and initiative readable.** Unit test and typecheck only
  (`headermodel.test.ts` `initiativeTitle`). Pick an agent linked to an initiative that offers Ship and ✓ Close ·
  N tok, in a pane ~1150px wide → the initiative reads `◇ <title>` with one ◇ (not `◇ ◇ C…`), the project is whole or
  cut past a few letters, and the long name is what truncates first. Then a 2x2 split (560px cell) → still `/ +`,
  the run's number, `opus`, nothing overlapping. Agent surface header. 2f3a86ffa.
- [ ] (arcterm) **A terminal launch does not wait on Task images.** Unit test only (`launcherimages.test.ts`
  `imagesHoldLaunch`). Ctrl+N → Claude Code → paste a large image into Task, and before its thumbnail stops spinning
  pick Terminal → Open terminal is enabled and opens one; back on Claude Code, Launch agent waits for the image as
  before. `launchermodal.tsx` `imagesWriting`.
- [ ] (arcterm) **The rail's session card has no Tools row.** The dev app was down when it was made, so
  `task verify:ui -- agent-subagents-background` never ran on it (its step 4 now checks there is no row). Open an
  agent that has run tools → the right rail's session card shows project, model, branch and the state line, with no
  `ran ×N` chips. `agentdetailsrail.tsx`.
- [ ] (arcterm) Ask Jarvis at No folder with a real consult (claude): a question is answered in the popover; a job
  naming a project reaches its open agent as your own prompt (no "Not typed by the user" header), a sleeping one wakes;
  a job for a project with no agent opens one with the launcher's harness.
- [ ] (arcterm) **`jarvis-peek` puts a saved harness preference back.** Only the no-preference case ran in the Final.
  With a harness picked in the launcher, `task verify:ui -- jarvis-peek` → afterwards the launcher still shows that
  harness and model. On a Mac, the launcher's harness menu with many harnesses scrolls inside its panel and is not
  clipped. `scenarios.mjs` `jarvis-peek` teardown, `harnesspicker.tsx`.

- [ ] (arcterm) **Jarvis's peek has no pin while Jarvis is the hologram.** Typechecked only. Settings → Jarvis & Office →
  Form: Hologram, open the peek → its header reads `Nothing waiting on you`, hide, Full view, × with no pin. Switch to
  Character (Sprout) → the pin is back; fold into Sprout → the folded peek keeps it. `petpeek.tsx` `hologramShown`.
- [ ] (arcterm) **Parent initiative is a searchable dropdown.** Unit test and typecheck only; no dev app was run. Brief →
  an initiative with a parent → Edit details → Parent initiative reads the parent's title, not an id. Click it → a
  frosted list under the box with a search field focused, "No parent" first, the same project's initiatives next, the
  current parent in accent; the initiative itself and its sub-initiatives are not listed. Type → it filters; ↑↓ and
  Enter pick; Escape closes only the list, not the dialog. Pick another, Save → the sheet shows the new parent. New
  initiative → the field reads None and the list works the same. Commit: fix(jarvis) pick an initiative's parent from
  a list

- [ ] (arcterm) **Settings → Jarvis & Office → Form shows only the picked form's rows.** Unit test and typecheck only;
  no dev app was running. Shows as reads Hologram | Character, Hologram first. On Hologram the card holds Shows as and
  Hologram size, and no Character or Vietnam's colours; switch to Character → Hologram size goes, Character and
  Vietnam's colours appear under it. On Hologram, search "flag" → the card shows Vietnam's colours (not an empty card).
  Hover the fold button (app bar −, and the float bar's on a Mac) → "Fold into Jarvis" on Hologram, "Fold into Minion"
  on Character with Minion. Commit: fix(settings) Jarvis's form is Hologram or Character

- [ ] (arcterm) **Full ↔ Float switch on a Mac and in a release build.** Measured only in the Windows dev app over CDP
  (540–710 ms per switch, was 1.1–1.3 s). On a Mac: `Shift+F` in and out a few times → no flicker of the shadow or the
  traffic lights mid-fade, the float lands in its place with its shadow, and the hologram powers on in the ledge slot
  just after the fade. Fold into Sprout and open it back out → the content grows straight away, no half-second pause.
  On Windows, installed: `Shift+F` in and out → no empty outline jumping before the fade in (the window is cloaked
  while it changes frame, checked over Win32 with the production bundle in a debug host), the taskbar button stays,
  and typing goes to the terminal straight after the switch (the cloak must not take the focus).
  Windows release: the switch feels well under a second. Commit: fix(float) Full ↔ Float switches in half the time
- [ ] (arcterm) **Sidecar's first open on one screen, or on a screen of another scale.** Two screens of one scale
  held on 1.1.3 `38f41b95b` (2026-11-15): Open Sidecar came up maximized on the other screen as `arcterm Sidecar`, and
  un-maximizing left 1280×800 centred there. Still unseen: with one screen it opens centred (1280×800, never past 90% of
  the screen), not maximized; and on a screen of a different scale from the main window's the size is still right.
  Commit: feat(sidecar) the Sidecar window from the Tauri host
- [ ] (arcterm) **Sidecar closes when the main window is destroyed, and stays when it is only hidden.** Tray icon off
  (Settings → `app:tray`): open Sidecar, close the main window → Sidecar closes with it and arcterm quits. Tray icon
  on: close the main window → it hides to the icon and Sidecar stays open; Quit from the icon closes both. Commit: same.
- [ ] (arcterm) **Sidecar reopens as last time.** Unit tests of the state and the restore decision only: no scenario can
  relaunch the app. With two screens, open Sidecar, drag or resize it, press F11 (or its full-screen button), then quit
  arcterm (tray icon → Quit, and once by closing the main window with the tray icon off) → the next launch reopens
  Sidecar on the same screen, at the same frame, full screen, without taking the focus from the main window. Close
  Sidecar with its own close button, quit, launch → it stays shut. Quit with Sidecar maximized, unplug that screen,
  launch → Sidecar comes up maximized on the main window's screen. Commit: feat(sidecar) Sidecar reopens as last time
- [ ] (arcterm) **Sidecar will not drag below 340×440.** The `sidecar-wall` scenario cannot check it: on Windows the
  host's `min_inner_size` clamps a person dragging an edge, not a programmatic `set_size` (a live run set 200×200 and read
  200×207 back), so step 2 only checks the page's own window calls. Open Sidecar, drag its bottom-right corner toward the
  top-left → it stops at 340×440 and the wall still draws whole tiles (no tile under 300 px wide). Commit: test(sidecar)
  the sidecar-wall CDP scenario
- [ ] (arcterm) **Sidecar's RAM against the 100 MB budget, on a release build.** The run could not take it: it needs
  `task tauri:build` and a day on screen. Install the build, run 12 agents, open Sidecar and leave it a day with the
  strain band showing for part of it (a heavy build, or one `yes > /dev/null` per core), then read the private working set of
  its WebView2 renderer plus the GPU process's growth when it opened (Task Manager → Details, or `Get-Process
  msedgewebview2` with Sidecar closed and open). Under 100 MB and level after the day → write the figures into the
  part-2 row of `docs/open-issues.md` "RAM watch" and tick this; over → a defect to fix before the next release (the
  spec's section 5). Part 1 read ~48 MB with 11 agents. Commit: test(sidecar) the sidecar-wall scenario for part 2
- [ ] (arcterm) **The S button shrinks and restores a real window, and the relaunch keeps it.** The scenario presses S
  and the pin on a real window (340×440 pinned, then back to the size it had, in the wall), but cannot relaunch the app,
  so the relaunch is a Rust test of the decision only. Open Sidecar on a screen of a different scale from the main
  window's and press S → it shrinks to 340×440 at that screen's top-right corner, pinned above other windows; drag it
  wider than 1100 px → the wall shows and S stays pressed; press S → it returns to its first frame. Press S, then quit
  arcterm (tray icon → Quit) and launch → Sidecar reopens small and pinned, and S still returns to the old frame. With
  Sidecar full screen or maximized, press S → it leaves that and shrinks; S again → full screen or maximized comes
  back. On a Mac, press S from macOS full screen and again. Commit: feat(sidecar) the host's small form — S shrinks and
  pins, S again restores, a relaunch reopens as it was
- [ ] (arcterm) **The strain band on a real strained machine.** The scenario drives the band with fixture readings. With
  Sidecar open and 10+ agents working, start something that fills the memory (or lets the OS report pressure `high`) →
  the amber band appears within seconds saying `RAM high for … (… free of …)` over the three agents that weigh most,
  heaviest first, each with its heaviest process, and Stop (asks in place; the process ends, the agent keeps running)
  and Sleep agent (its RAM is freed); let the CPU run over 90% for 2 minutes → the same band says `CPU over 90% for 2
  min` with rows by CPU. Free it → the band clears after 30 s without flicker. × hides it until the level changes. At
  `critical` it turns red and names your OS. Commit: feat(sidecar) the strain band and tile scrollback on the wall
- [ ] (arcterm) **The macOS per-agent CPU sampler (`pkg/agentcpu`) on a Mac.** It compiles on Windows but has only run
  against a fake process table. On a Mac with Sidecar open and an agent running a build, make the CPU run over 90% for 2
  minutes → the band's rows are the CPU's, the agent that runs the build first, its busiest process named and `Stop`
  ending it; with the CPU calm the band clears and wavesrv's own CPU stays near 0 (the sampler runs only while a CPU
  band shows). Commit: feat(sidecar) CPU per agent: resmon on Windows, a new sampler on macOS

- [ ] (arcterm) **The version's tooltip, About and a dirty dev build name the commit.** The footer of installed 1.1.3
  read `v1.1.3 · 38f41b95b`, the installer's commit, on 2026-11-15. Still unseen: its tooltip adds "commit <sha>",
  Settings → About shows the same under Commit, and `task dev` with an uncommitted edit reads `· <sha>-dirty`.
  Commit: feat(cockpit) "the version names the commit the build was made from".

- [ ] (arcterm) **An agent's run counts leave cancelled runs out.** Unit tests and the typecheck only; no dev app ran.
  From an agent, `wsh runs start` two runs, cancel one → that agent's row in the Agent sidebar shows the live run's
  chip (its progress such as `1/3`, or no words while it plans), not "2 runs", and its header reads "↳ <the live
  run's goal>", which opens it with no menu; cancel the other too → the chip reads "cancelled" and the header
  "↳ <newest goal> · cancelled", both opening the newest of them. Commits: fix(agents) "the run chip leaves cancelled
  runs out", fix(agents) "the header's started runs leave cancelled runs out".
- [ ] (arcterm) **An open chunk names the files that changed since it was written.** Unit tests, the typecheck and
  a scan over the real initiatives' JSON only; no dev app ran. Rebuild, wait two minutes after start (the first scan),
  then open "Repo hygiene: lint, prettier, stale comments, test gaps" in the initiative sheet → rows such as
  "councildiscussion.tsx fails prettier --check…" carry a grey "changed since" chip whose tooltip lists
  "councildiscussion.tsx changed N times"; open one → under its status reads "… changed N times since this was
  written (<day>): check it still holds" with Mark checked; Mark checked → the chip and the line go. "ReleaseHub
  parser image + GitHub follow-ups" chunk 4 (IMAGE.md) → an amber "file gone" chip, and "rewrite or skip it": the
  installed 1.1.3 lost it on 2026-11-16 (its backfill dated the chunk by a note added the day before, so it read
  "written at d694b95a2, the code has not moved since"); after the fix the first scan re-derives that base from the
  initiative's creation and the chip comes back. `wsh effort stale` lists the same chunks; `wsh effort show <effort>`
  prints "(written around <sha>, N commits ago; … changed N times)" on old chunks, and after the first scan
  "written at" (the backfilled base).
- [ ] (arcterm) **An open chunk counts the commits since it was written.** Unit tests and the typecheck only; no dev
  app ran. In an initiative whose project is registered, `wsh effort chunk add <effort> "probe"`, make a commit in that
  project, then open the chunk in the initiative sheet → under its status reads "Written 1 commit ago (<day>): check it
  still holds" with Mark checked; Mark checked → the line goes, and the trail gains "checked against <sha>".
  `wsh effort show <effort>` prints "(written at <sha>, 1 commit ago)" beside it before, "the code has not moved
  since" after. Work on this chunk → the agent's prompt asks it to check the chunk still holds first. Chunks made
  before this change show no line. Commit: feat(initiatives) a chunk keeps the commit it was written at

- [ ] (arcterm) **↑ in Chat's empty box falls through to history when the take-back finds nothing.** Only the typecheck
  covers it. While Claude works, send a message from Chat so it shows as Queued, wait until Claude takes it but its
  bubble still stands, then press ↑ in the empty box → after about 2 s the last message sent comes back into the box
  (it did nothing before). With a message still truly queued, ↑ still takes it back instead. Commit: fix(chat) ↑ falls
  through to history when the take-back finds nothing, and the bash ghost layer wraps at the editor's width
- [ ] (arcterm) **A long bash command's ghost stays after its last character.** In Chat type `!` and a command long
  enough to wrap past the box's max height so it scrolls, with a suggestion showing → the faint suggestion sits right
  after the last character, on the same wrapped lines as the text (the layer is now padded by the scrollbar's width).
  Same commit.

- [ ] (arcterm) **Sixel images draw in a terminal of the installed app.** The dev app applies no CSP, so only a
  packaged build shows it. In a terminal run
  `printf 'Pq#0;2;0;0;0#1;2;100;100;0#2;2;0;100;0#1~~@@vv@@~~@@~~$#2??}}GG}}??}}??-#1!14@\'` → a small
  yellow-and-green "HI" draws, and `waveapp.log` has no new `WebAssembly.instantiate` rejection after a terminal
  mounts (it had one per mount). Commit: fix(tauri) the CSP lets the terminal's sixel decoder compile its WASM
- [ ] (arcterm) **Jarvis and initiatives polish batch, in the app.** Unit tests and the typecheck only; no dev app
  ran. Check each: (1) the initiative link in an agent's header has the tooltip "… Ctrl+click to peek at it in
  Sprout"; (2) the initiative band's Mark done and Add note show their m / n hints as key caps that sit level in the
  button; (3) a run whose lead process died (kill the lead's claude) reads "Failed · n/m" in red in the Agent tree,
  "failed" on the Brief and Failed in the run sheet; (4) on a fresh launch, open Sprout before Jarvis: the "N
  initiatives changed · M idle" line shows once the briefing loads; (5) a plan a run worker proposes
  (`wsh effort chunk add ... --proposed` from its terminal) opens that worker from Needs you; (6) in the Brief, delete a
  stage's last chunks, then within 5 s rename the next stage: the stage you clicked is renamed. Commits: branch
  fix/jarvis-initiatives-polish (c6fa4470b … ffacae754)
- [ ] (arcterm) **The spring's feel on the Cockpit, Jarvis, Diff and Setup, on a real roster.** The
  `surfaces-spring-*` scenarios time each motion on fixtures (`task verify:ui -- surfaces-spring-cockpit`
  …); no packaged build ran them on your own agents and projects. In the packaged app on a real roster: the Cockpit
  as an agent goes from working to needing you (its card moves to its new place, no card jumps or doubles), a Jarvis
  brief card and an initiative row open and fold, a Diff file folds in Review, a Setup section folds, and a filter
  switch or a big update (three or more rows at once) shows at once instead of running the spring on each row.
  Commit: feat(motion) the batch model, the scenario scaffold and the docs for the surfaces' spring (run d2a699db)
- [ ] (arcterm) **Council bench team cell cleans up after itself.** Only unit tests cover it; no bench ran a real team.
  Run `wsh council bench --variant team --case <one case> --runs 1` to the end, then again and end it with
  `wsh council bench stop` while the lead works → after each, `~/.claude/projects/` has no new folder for the cell, and
  after the stop no `claude` or `node` process from that cell is left in Task Manager (the stop takes the same kill as a
  timeout). Commit: fix(council-bench) a team cell removes
  its transcripts and kills its whole tree on timeout (run e6d14c4f)
- [ ] (arcterm) **A council change reloads only that council.** With two projects that each have councils, run a council
  in one → its tree row and the Councils list update as it goes, the other project's councils stay as they were, and a
  council deleted with `wsh council` leaves both lists. Commit: perf(council) a council change reloads that council,
  not every council in every list (run e6d14c4f)
- [ ] (arcterm) **Radar retired, on a store that had it.** The Final ran on a fresh dev store, so migration 000028 never
  dropped a real `db_radarreport` and no saved Startup surface read `radar`. Install the build over an arcterm that has
  Radar reports and Settings → General → Startup surface set to Radar → it boots on Cockpit, the rail has no Radar,
  `Ctrl+G` `r` does nothing, and `waveapp.log` shows no migration error. Commit: refactor: Retire Radar (run c2a6aebb)
- [ ] (arcterm) **Frosted overlays on a Mac, and the folded Sprout window.** The Final's frost scenarios ran only in
  WebView2 (Windows). On a Mac build, open the command palette, a context menu with a submenu, a Chat footer menu and
  a toast over a working agent → each panel blurs what is behind it (the palette over its dimmed scrim, a submenu
  over the chat, not over its parent menu), and muted text stays readable. Then fold Sprout into its own window and
  open its bubble or peek → it draws a solid panel, not a see-through one. Commit: feat(ui) Overlays in the Chat
  look: the frosted fill (run 04bd30dc)
- [ ] (arcterm) **Switch to this chunk tells a real agent at once.** The CDP scenario `chat-initiative-band` (4, 4c,
  4d) passes against fixture agents whose sends go to a mock; no real Claude Code session took one. In a real Claude
  agent linked to an initiative, with the message box empty, open the band and press Switch to this chunk on a free
  chunk → the agent answers on the new chunk at once, Chat shows the `Chunk N · name` divider and `Moved to chunk N ·
  sent by arcterm` (no bubble reading `Go on with this chunk.`); while the agent works the send waits for its turn to
  end. With a draft in the box the framed line waits and rides with the draft. Commit: feat(chat) initiative band:
  Switch to this chunk tells the agent at once, a how-to.
- [ ] (arcterm) **Agent composer image cap, 3.5 MB.** Unit-tested only (`composerattachments.test.ts`); no scenario
  attaches to the agent composer. Agent → paste a 4 MB image into the message box → it is refused at once with
  `over 3.5 MB`, not lost on send; a 3 MB image sends. Commit: fix(council) the Report's summary Retry needs a sent
  idea, and the composer's image cap is 3.5 MB (run a9774e84)
- [ ] (arcterm) **Council decisions, 11-14.** Go-tested and typechecked; no dev app ran. (1) Hover a seat's message
  in a council's chat → its byline shows Pin to Report as a pin and Chốt as a compass; an idea's Chốt and the Memory
  tab's hover Chốt are compasses too (`council-discussion`, `council-memory`). (2) Pin a chat seat's message, then
  open the saved report under `docs/council/` → its Final proposal reads `_From <project> · <key>_`, the key the
  Report's header shows. (3) Quit arcterm while a council runs, reopen → the council reads stopped and its report
  file is saved (Open report works). Commit: fix(council) Chốt draws a compass, a chat seat's key in the report,
  a stale council's report
- [ ] (arcterm) **`wsh agents list` and agents in no project.** Unit-tested; run live from this project (the count
  line showed), but no agent was open in a scratch folder then. Open a Claude agent in a folder that is no project →
  `wsh agents list` from an agent in arcterm lists it with `(no project)` after its folder's name. Commit:
  fix(wsh) agents list shows sessions in no project
- [ ] (arcterm) **Token burn card inside a run.** Go-tested only; no dev app ran. In an orchestrator run (autonomous
  too), have a worker start 3+ subagents, or run `wsh council start` → the Token burn card shows at once in Needs you
  and in the run's question card as yours, the lead gets no wake for it, and `wsh jarvis dag answer` from the lead
  is refused. Allow there → the spawn runs. Commit: fix(orchestrate) a held card raised in a run is the person's
- [ ] (arcterm) **Council fixes, 11-14 third batch.** Go- and unit-tested and typechecked; no dev app ran. (1) In a
  council paused after round 1, Continue with `Check it against @<a file>` → round 2's expert cards show them reading
  it. (2) In a 3-round council, attach an image to a reply in round 2 → in round 3 an expert shown that thread opens it
  (its activity names the file). (3) Kill wavesrv while a council runs a verify command, start arcterm again → the
  `council-<id>` folder under arc-wt is gone (`[council] … removed the verify tree` in waveapp.log). (4) `wsh council
  start` in a folder that is not a registered project → its row is in Home's folder (`council-tree`, step 11j). Commit:
  fix(council) Continue's @file, round 3 attachments, crash-left verify trees, councils in Home
- [ ] (arcterm) **Council fixes, 11-14 second batch.** Go-tested and typechecked; no dev app ran. (1) Paste a 4 MB
  image into a council's chat → its chip reads `Image too large (over 3.5 MB)` at once (`council-discussion`,
  attach-oversize). (2) In a done Review report with Also raised, press the header's `Also raised` jump link → the
  page scrolls there and the ideas are unfolded (`council-summary`). (3) `wsh council summarize <id>` on a council
  paused after round 1 → it prints `summarizing`, and `wsh council wait <id>` returns its report. Commit:
  fix(council) one image cap, kept jump unfolds, summarize command, withdrawal round, Draft lookup outside the lock
- [ ] (arcterm) **Council small fixes, 11-14 batch.** Unit-tested and typechecked only; no dev app ran. (1) Leave a
  council paused after round 1 in a registered project → the Cockpit's Needs you strip has a `Council` row; under
  another project's filter it is gone; Open lands on its Discussion (`task verify:ui -- council-needs-you`, step 4b).
  (2) Ctrl+K → Needs you → Enter on a learned rule → the Cockpit shows, with the rule's Accept and Dismiss. (3) In a
  council with a waiting suggestion, fold the Ideas rail → the `Ideas · N` button carries the dot (`council-memory`,
  step 1b). (4) A council whose coordinator failed with no sent idea → its Retry is greyed, and its hover says no idea
  was sent. (5) Copy a routed message's `Router failed` row → the pasted text reads `Router failed UX`, not
  `Router failedUX` (`council-routing`). Commit: fix(council) Needs you strip, palette learned rule, folded-rail dot,
  summary Retry hold

- [ ] (arcterm) Council and Doc review cards in Chat, with a real agent: in a Claude agent's Chat have it start a
  council (`/arc:council`, or ask for one) → while it runs a Council card sits at the end of the conversation (the
  question, a chip per expert, the step, the time, the estimate, Stop; Open council opens the room); a second council
  started while one runs shows the queued card naming the first; a council that pauses after round 1 reads Waiting on
  you with Continue and Stop. When one ends its card leaves on the spring and a ✓ row (Open report) stands at the
  `wsh council start` call, ■ when you Stop it; run a follow-up on a done council from its room → its row reads
  running again and the card never comes back to the end. Then have the agent ask a Doc review (`/arc:doc-review`) → a
  Doc review card in the dock above the box with Review and Approve; Approve folds it into "✓ Doc review · approved ·
  <file>", and Request changes from Review into "↺ … changes requested · N comments". An exited agent shows both cards
  without Stop, Continue, Review and Approve. The `chat-council` scenario covers these states from fixtures, not the output of a real agent's
  `wsh council start`. Commit: feat(chat) place the council cards and the Doc review rows in the conversation
- [ ] (arcterm) **The brainstorm part of the Chat band on a live agent.** Link a real Claude agent to an initiative and
  have it run a brainstorm that draws boards. While it works between two questions, its Chat band reads `Brainstorm`,
  `N boards` and `Decided N` beside the initiative, with no Mark done on the line. Let it draw another board while
  Chat is shown → within a few seconds `1 new` with a dot appears, and the header's Brainstorm tab carries the same
  dot. Open the part → the decisions that are yours and the boards, the new one tagged `new`, the conversation moved
  down and not under it. Click the new board → the Brainstorm tab opens and both dots go; from inside the band, `b`
  opens the same tab. Checked only with fixture agents in the `chat-brainstorm-band` scenario (`chatband.tsx`,
  `brainstormbandview.tsx`).
- [ ] (arcterm) Esc in Chat before the reply, on Windows: after a build, in a Claude agent's Chat send a long ask
  ("write 3000 words on …") and press Esc once its bubble shows as sent, before any reply → the text comes back into the
  box and the bubble leaves the conversation at the same moment, with no Queued bubble after; send it again → it shows
  once and gets its answer. Tried on a Mac in the browser dev app with a real Claude (haiku), not in WebView2. Commit:
  fix(chat) a message Esc takes back leaves the conversation
- [ ] (arcterm) A pasted jobslot wrapper queues once: after a build with the new `wsh` and an arcterm restart, have a
  Claude agent run `'<home>/.arc/bin/wsh' jobslot --hold-parent -- 'task check:ts'; [ $? -ne 75 ] || exit 75` then a
  newline and `task check:ts`, in the foreground → the Jobs popover shows one `task check:ts`, running, not a second
  one waiting "CPU busy, 1 at a time" behind it, and the typecheck finishes on its own. Commit: fix(arc-mod) a pasted
  jobslot wrapper is not queued twice
- [ ] (arcterm) Triple-click in Chat on a Mac: after a build, triple-click a short list item, a short paragraph and a
  heading in an agent's reply → each highlights only its text, with no band on to the column's right edge, and Copy
  pastes the line with no trailing line break. A drag across several paragraphs still selects them all. Checked only in
  a WKWebView harness with the same module, not in the app. Commit: fix(chat) a triple-click selects the line's text
- [ ] (arcterm) Compacting in Chat: after a build with the new `wsh`, type `/compact` in a Claude agent's Chat → under
  the last message it reads Compacting… with no `(…)` timer, then the line goes away when the summary lands. A
  compaction Claude starts on its own mid-turn still reads Working…. Commit: fix(chat) a /compact reads Compacting…
- [ ] (arcterm) Kael sync 11-13: a land refused mid-merge is undone: in a scratch repo, start a run with two tasks, and
  once the first lane has merged put a `commit-msg` hook in the repo's `.git/hooks` that refuses the engine's own
  commits and no one else's (`#!/bin/sh`, then `grep -q '^Arc-Run:' "$1" && exit 1`; only the squash and land commits
  carry that trailer, so the workers' commits still go through). While the second lane merges → its squash is refused,
  the landing tree has nothing staged afterwards, and the next tick merges it once the hook is gone; before, the
  squash stayed staged and held every later merge. Put the hook back before the run completes → the land holds with the
  refusal as its reason, `git status` in the checkout shows no merge in progress (no `.git/MERGE_HEAD`) and nothing
  staged; remove the hook and run `wsh runs land <run-id>` → it lands. A run started with `--landing checkout` behaves
  as it did. Unit-tested on Windows only (`/bin/sh` hooks), never on a real run. Commit: f03b9ee67 (`merge.go`
  `finishMerge` / `undoMerge`, `land.go` `mergeRefusal`).
- [ ] (arcterm) Kael sync 11-13: a resume that fails in a new tab leaves no extra tab: close the tab of a Quick run's
  worker while it works → the run reads Blocked "worker's tab was closed…". Make the resume fail (move the worker's
  session `.jsonl` away) and Resume from the palette → it reports why, and the Agent tree gains no extra terminal for
  the run; put the file back and Resume again → one new tab opens and the worker continues. Unit-tested only. Commit:
  5019e90c8 (`interrupted.go` `resumeInNewTab`, `swapPhaseWorker`).
- [ ] (arcterm) Tooltips show at once, long ones too: hover the RAM figure on a run row in the Agent tree (its title
  runs past 60 characters) → the chip shows with no wait, and moving the pointer off drops it at once. Vitest + eslint
  only, not tried in the app (`titletiphost.tsx`, `titletip.ts` `tipDelay` removed).
- [ ] (arcterm) A run worker's header stays on one clean line: open a worker whose lead's name is a long goal → the
  link back to the lead (↰ icon) is cut with an ellipsis at about 220px, the project name stays readable, and the model
  and context figure stop short of the Chat | Terminal switch; hovering the link shows the whole name. Vitest + eslint
  only, not tried in the app (`agentheader.tsx` `RunLinkItem`).
- [ ] (arcterm) Agent header buttons: open an agent → the header has More (⋯), Float and Close, no Split or Fullscreen
  button; ⋯ lists Split (its submenu) and Fullscreen terminal. Settings → Appearance → Agent header: turn Split and
  Fullscreen on → both buttons come back and Split leaves ⋯; turn Float off → its button goes and ⋯ lists Float window.
  The `agent-header-redesign` scenario's step 6c covers it (`headerbuttons.ts`).
- [ ] (arcterm) Canvas quick pick with a comma: have an agent draw A-/B-/C- option boards and end its reply with
  bullets like "**A, chip trầm** (…)" and a question → the quick pick card shows rows A, B, C instead of only the
  "A đi" chips. Unit-tested only (`chatcanvaspick.ts` `namedLetters`), not tried in the app.
- [ ] (arcterm) A brainstorm's cards after its run: Approve a brainstorm and let the run finish, then, without
  restarting arcterm, keep talking until the agent sets `run` back to null and asks again (a question or a builder
  check) → Chat shows that card. Before, Approve's in-memory start mark brought the finished run back and its folded
  card hid every later one. Unit-tested only (`brainstormpoller.ts` `settleBrainstorm`), not tried in the app.
- [ ] (arcterm) Heavy jobs popover from a tree tag: with a job queued, click an agent's `#1` (or a run's `×2`) in the
  Agent tree → the popover opens with that agent's (or run's) job rows drawn selected and scrolled into view; the app
  bar's Jobs chip opens it with none selected. Unit-tested only (`jobqueuestore.ts` `toggleJobQueue`), not tried in the app.
- [ ] (arcterm) No keycaps beside the view switch and Mark done: open an agent with a canvas → no Alt+C keycap in the
  header, Alt+C still walks the views; an agent on an initiative chunk → the band's and the ◇ popover's Mark done show
  no `m`, and `m` still marks it done. Typecheck only, not tried in the app.
- [ ] (arcterm) Chat's tool box in the real app: in a live Claude agent's Chat, open a finished stretch → one bordered
  box, a plain row per tool with past-tense verbs and no icons; open a Bash row → `$ command`, its output, Open full
  view; click an edited file's name → the File tab opens it; a stretch with a failed Edit → "Edit failed" in red on its
  row, the folded line stays muted; no file chips under a stretch. Checked only in the headless-Chrome build
  (`agent-chat` CDP), not in WebView2, and not in a light theme (`chatstepsview.tsx`).
- [ ] (arcterm) Checks after a brainstorm's run starts: brainstorm with a builder check (and a judge), Approve, and let
  the run start → the brainstorming agent's row loses its checks chip (`> ✓`) and the check rows under it; a check that
  still asks, or the one selected, stays. Unit-tested only (`agenttreemodel.ts` `checksSuperseded`), not tried in the app.
- [ ] (arcterm) A `wsh detach` server has an owner: in an agent, `wsh detach npm run dev` in a repo with a dev server →
  the footer's Servers names `claude · <agent>` on its row instead of "no owner", and Log opens the `arc-detach` log;
  the agent's tree row shows a green server mark with `:<port>`, and folding its project's folder shows the port on the
  folder. From a plain terminal, the row reads `terminal · <name>` and Log opens the file, not the pane. Close the agent
  → the row keeps its name. Unit-tested only (`pkg/devservers/detached.go`, `treeservers.ts`), not tried in the app.
- [ ] (arcterm) The Agent sidebar is 280px with RAM and Tokens on and Age off (`agentTreeWidth`, `rowfields.ts`): in
  Settings → Appearance → Agent sidebar turn Age off; the sidebar stays 280px and a lead's second line reads its words
  (`Working · 0/7`), not `W… · 0/7`. Turn Tokens off too and it narrows to 248px.
- [ ] (arcterm) The agent header drops its button words when short of room (`nextHeaderLabels`, `headermodel.ts`):
  with an agent that has Ship and Close, narrow the window or open a split until the header crowds; Chat, Terminal,
  Ship and Close become icons, the model and context (`opus 120k`) never draw under the Chat switch, and widening
  brings the words back without flicker. Hovering Close names the session's tokens.
- [ ] (arcterm) A relaunched lead stays on its run's row (`isCurrentLead`, `staleLead`, `runlineage.ts` /
  `agenttreemodel.ts`): with an orchestrator run executing, restart arcterm (or let its lead die so the engine
  relaunches it); the run's row in the Agent tree is the new lead's, working, and the old lead's sleeping tab has no
  row of its own. An agent whose brainstorm run was cancelled and queued again reads `plan queued #N` alone, with no
  `cancelled · run …` beside it.
- [ ] (arcterm) A server mark keeps two ports (`shortPortsLabel`, `devserversmodel.ts`): an agent or run row in the
  Agent tree whose background servers listen on four ports reads `:5175 :9230 +2` beside the green server glyph, and
  hovering it lists all four ports with their commands.
- [ ] (arcterm) Chat's Working dot crackles (`workingglyph.tsx`, `pulse.ts` noise pulses): with a live agent working,
  watch the dot for ten seconds: bolts strike at different angles and lengths, the core flickers, the dot and the
  `Working…` words jolt now and then but stay readable, and it does not feel frantic. The CPU in Task Manager stays
  where it was with the old dot (the driver is still 12fps).
- [ ] (arcterm) Chat ref badges with real data: in a live agent's Chat, pick an agent, a run and a council from `@` →
  each shows as a tinted badge with its name (the box keeps the text `agent:<8>`); send → the bubble's badges open the
  agent's terminal, the run in Jarvis, the council's discussion; Ctrl-click peeks; a working agent's badge pulses green
  and an asking one shows an amber ring. A token typed or pasted into the box stays text (badges only in the bubble).
  Checked only with seeded atoms in the `chat-ref-badges` CDP scenario, not against a real project's runs and councils.
- [ ] (arcterm) A calmer turn in Chat with a live agent (`chatsteps.ts`, `chatstepsummary.ts`, `chatturnfiles.tsx`): while
  it works, a running stretch stays one folded line with its spinner and opens only on a click, and the Working line
  reads `Working` and its stats with no `· <activity>` tail; a stretch of one described command reads as its
  description; a finished stretch under 10 s shows no time. When a turn that edited files ends, a card lists them with
  their +/− lines; a row opens the Diff on that file and See all opens the agent's whole Diff. Checked only in the
  `agent-chat` CDP scenario with fixture turns.

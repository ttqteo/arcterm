# Waiting on a hand check, part 8

Older lines of `docs/hand-checks.md`, moved here when it grew past its size; the rules and the list of parts
are in that file. Tick a line here when it holds, then remove it; a part left empty is deleted.

## 2026-11-18

- [ ] (arcterm) **Remote mode through Tailscale on a real phone.** Only fakes have run `tailscale serve` (the
  `remotemode` tests). Step 10 of `remote-switch` (the Connection card with Tailscale picked) was written but its run was
  stopped for low memory: run `task verify:ui -- remote-switch` first. Turn HTTPS on for the tailnet (admin console →
  DNS), then Settings → Remote → Connection → Tailscale: the tailnet address and login fill in by themselves; turn
  Remote on → the footer reads Remote on and `tailscale serve status` lists `https://<pc>.ts.net` proxying to
  `127.0.0.1:47821`. With the phone's Tailscale app logged in as the same user, open that address in Safari, add it to
  the home screen, turn on notifications; an agent's question pushes and an answer reaches the agent. A device logged
  in as another tailnet user gets 403. Turn Remote off → `tailscale serve status` reads "No serve config" again (the
  foreground serve dies with its child; if a config stays behind, `tailscale serve reset` clears it and the kill path
  needs a fix). Commit: feat(remote) Tailscale as a second way in
- [ ] (arcterm) **Remote mode on a real phone (ported from the kael fork).** The `remote-switch`, `remote-hand` and
  `remote-phone` scenarios cover Settings → Remote, the footer chip, the More menu's Hand to phone and the phone page
  against fixtures; nothing has run against a real tunnel. With a Cloudflare named tunnel and an Access app set up as in
  `docs/remote-phone.md`: `wsh remote on` → the footer reads Remote on; install the page on an iPhone from Safari, log in
  from inside the installed app, turn on notifications; an agent's question pushes to the phone and an answer there
  reaches the agent; with Telegram paired too, the question goes to both and the first answer wins (the other side says
  it was answered). Hand a claude agent over (`p`): its transcript, a prompt, Stop and a permission Allow work from the
  phone; Take back returns it.
- [ ] (arcterm) **No white flash switching between HTML files.** Lint and the typecheck only. Open two dark HTML
  pages as tabs in the File pane (or Code), switch back and forth: the pane stays dark until the page draws, a page
  with no background still shows on white, and a kept scroll position still comes back.
- [ ] (arcterm) **A refused Stop says why: on a dev server's rail row, and in a toast from an app's menu.** The
  `rail-servers` scenario fails at its first step on main too, so the row's new error line was never drawn. Run a
  server as admin (an elevated shell: `npx http-server -p 8099`), let an agent in a normal arcterm list it in its rail,
  then Stop, Stop? → a red "Couldn't stop it: Access is denied." line under that server's row, which stays listed. An
  app (Setup → Tools service) whose Stop wavesrv refuses → a toast "Couldn't stop <name>". Commit: fix(servers) a
  refused Stop says why
- [ ] (arcterm) **Keep running, then Opens in at once, keeps Keep running; a built-in's Opens in writes no command.**
  Setup → Tools, a tool of yours with a page: click Keep running, then at once change Shows → reopen Setup → Keep
  running is still on, and `tools.json` has `"autostart": true`. Then lazygit: change Opens in → its `tools.json`
  entry has `opensin` and no `command`. An entry an older arcterm wrote keeps its command until Reset. Commit:
  fix(services,tools) one tab per service, built-in overrides without a command
- [ ] (arcterm) **An agent with no project sits in No folder, with the terminals that have none.** Start a Claude agent
  from a folder that is no project (New → No folder) and open a terminal with no project → one No folder folder at the
  bottom of the Agent tree holds both, agent first, a divider, then the terminal; there is no "ungrouped" folder. No
  folder has no right-click menu, so such agents have no Close project. Commit: fix(agent tree) one No folder
- [ ] (arcterm) **No folder in the New dialog's Tool row opens in home with a project named Home.** Add a project named
  `Home` (any folder), then New → Tool → No folder → lazygit (Opens in: root) → it opens in your home folder, under No
  folder in the tree, not in that project's folder. Commit: fix(agent tree) explicit Home pick
- [ ] (arcterm) **A remote terminal never reads as in a removed folder.** With an SSH connection, open a remote
  terminal in `/tmp/x` and a local Git Bash one in `/tmp/x` too, then delete the local folder → only the local
  terminal shows the folder-gone card. Commit: fix(servers) remote terminals never read as in a gone folder
- [ ] (arcterm) Focus read's step buttons and per-agent toggle (`chatpane.tsx` FocusReadSteps, `chatfocusreadstore.ts`):
  with focus read on, the K / J / Q column under the toggle sits clear of the pinned prompt card and reads well in a
  light and a dark theme; holding ↓ steps block after block with no judder; turning it on for one agent in a 2x2 split
  leaves the other cells undimmed, and it is still on for that agent after a restart.
- [ ] (arcterm) Focus read skips what is not text (`chatfocusreadview.ts` `data-fr-skip`): on a real agent's turn with
  tool steps and a command card between paragraphs, `J` / `K` and a stopped scroll pass over them to the next paragraph,
  they stay at 32% and are never lit, and the paragraphs either side of the lit one sit at 50%. The `chat-focus-read`
  fixture has no tool steps, so the scenario checks only the 50% neighbours; the one pill (toggle over K / J, a hairline,
  Q) also reads well in a light theme.
- [ ] (arcterm) A folded message of yours (`narrationtimeline.tsx` PromptText): in Chat, folded, a click anywhere on the
  bubble (its padding too) opens it, and its hover Copy / Fork row under it still works; open, a click on its text does
  nothing and the text selects, and only Show less folds it. A bubble with a pasted block card: the card still opens on
  its own while the text above it is folded. Same in Conversation History's transcript and a pending bubble. No scenario
  opens a folded bubble in History or a pending one (`chat-bubble-fold` covers Chat).
- [ ] (arcterm) Sending to an idle agent in Chat (`chatlive.ts` liveTurn, `chatpane.tsx`): when the last turn ended
  with an "Edited N files" card, the card stays where it is from the send until your message lands and the new turn
  starts (it used to fold away at the send and spring open again up to 3 s later). A message queued while the agent
  works leaves the working turn's card held back as before. Checked only by unit tests.
- [ ] (arcterm) Chat around a send (`chatpending.ts` sending, `chatpane.tsx` WorkingLine, `chatconversation.tsx`
  ownArrives): send to a Claude agent that is busy redrawing (just after a turn ends, or while it starts) and the
  bubble stays until your message lands, never blinking out at 5 s; as the turn starts the working line opens under
  the bubble and as it ends folds away, with the conversation gliding rather than jumping; a message typed straight in
  the terminal opens into Chat on the spring. Measured in headless Chrome with a fixture agent (a scripted send,
  live reply and transcript), not yet with a real Claude agent in the app.

## 2026-11-17

- [ ] (arcterm) **Session search on your real transcripts.** The three `session-search-*` scenarios answer the search
  from a mock; nothing has run `SearchSessions` over real transcripts in the app. Agent → Conversation History → type a
  word you remember from an old Claude conversation → "N results" (with "· indexing…" the first time, clearing on its
  own within seconds), each card with the word marked in its snippet; click one → it opens with the find bar at the
  hit, Enter / Shift+Enter step through the matches, Esc closes the bar. New agent → Claude → `/` or the Session
  column's magnifier → the same word lists title and "Matched by content" rows. Note how long the first search takes.
  `conversationhistory.tsx`, `launcherresumelist.tsx`, `sessionsdetail.tsx`; commits 4b9814411, c7fdf4883, 104a440a8.
- [ ] (arcterm) **Closing Sidecar frees its two window icons; a reopen still draws the badge.** Windows only; the code is
  unit-tested but was never run in an app. Open Task Manager → Details, add the "GDI objects" and "USER objects"
  columns, then open and close Sidecar (Ctrl+P → Open Sidecar) ten times → arcterm's counts come back to the same
  level after each close instead of growing by two per cycle, and after each reopen the title bar and the taskbar
  button still draw the screen-badge icon. Commit: fix(sidecar) free the window's icons when Sidecar closes
- [ ] (arcterm) **Sidecar P/Q across a real day: the question heuristic's misses, the ping from across the room.** The
  `sidecar-orbit` and `sidecar-compact` scenarios read fixtures: they cannot judge a real day. With real agents for a
  day: (1) a finished agent whose last message asks something gets a Needs you row (Enter: reply in the main window),
  and a rhetorical question at the end of a report does too, which is the miss to count (spec "Open": a miss only adds
  a row, and answering or opening it clears it); note the false rows and any question it did not catch. (2) From across
  the room (a second screen, 2 m away), a waiting node or row pings and you see it without reading; nothing else on the
  screen moves. (P's RAM after a day was read on 2026-11-24: the "Sidecar, part 3" row of `docs/open-issues.md`.)
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
- [ ] (arcterm) **The one-line Chat box's menus and asleep line.** The `chat-redesign` scenario checks the row, the
  grown box and the line under it, not these. In Chat with a live Claude agent: click the model ("Opus 5.5 High")
  under the box → its menu opens upward, its right edge on the model's, and Effort / More models open their panels to
  the menu's left, all on screen in a narrow float window too; the permission mode opens its menu the same way. Put the
  agent to sleep → "Asleep · …" with the moon sits at the left of the line under the box, the model muted at its right,
  `+` gone from the box and Send reading Wake. `chatfooter.tsx`, `chatcomposer.tsx`.
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
- [ ] (arcterm) No keycap beside the view switch: open an agent with a canvas → no Alt+C keycap in the header, Alt+C
  still walks the views. Typecheck only, not tried in the app.
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
- [ ] (arcterm) The Heavy jobs popover keeps its place after Run now (`usePanelPlacement`, `consumerspanel.tsx`): open
  it from a waiting agent's `≡#1` tag in the Agent tree and press Run now on that job; the tag goes, and the popover
  stays hanging where it opened, not in the bottom right corner. The same from the app bar's jobs chip.
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
  and an asking one shows an amber ring. A token or an @path typed or pasted into the box becomes a badge or a file pill
  once a space or punctuation follows it; deleting one leaves one space.
  Checked only with seeded atoms in the `chat-ref-badges` CDP scenario, not against a real project's runs and councils.
- [ ] (arcterm) Chat ref badges: a session: of a recent conversation shows its title and age and a click reopens it as an agent; an effort: whose chunks are all done shows its done/total in green
- [ ] (arcterm) Chat box: a token finished through Telex (the IME's composition end) becomes a badge, and a real clipboard paste of `xem run:<id> agent:<id> ` gives two badges; the scenario types with key events only, so neither path ran in a live app
- [ ] (arcterm) A calmer turn in Chat with a live agent (`chatsteps.ts`, `chatstepsummary.ts`, `chatturnfiles.tsx`): while
  it works, a running stretch stays one folded line with its spinner and opens only on a click, and the Working line
  reads `Working` and its stats with no `· <activity>` tail; a stretch of one described command reads as its
  description; a finished stretch under 10 s shows no time. When a turn that edited files ends, a card lists them with
  their +/− lines; a row opens the Diff on that file and See all opens the agent's whole Diff. Checked only in the
  `agent-chat` CDP scenario with fixture turns.
- [ ] (arcterm) Focus read in Chat (`chatfocusreadview.ts`): with a real wheel and a trackpad, a stopped scroll settles the nearest block onto the line in one short glide and never fights an ongoing fling; `Space` / `Shift+Space` step like `j` / `k`; with reduced motion the step jumps and the dimming has no fade; while a live agent writes a reply and you sit at the bottom nothing is dimmed, and scrolling up brings the dimming back; `j` / `q` typed with Telex on act as keys in the conversation. The `chat-focus-read` scenario drives keys and `scrollTop` only

## 2026-11-16

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
  header's ◇ chip and the rail's Initiative tab keep the one you picked (63184f53b).
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
- [ ] (arcterm) Tooltips show at once, long ones too: hover the RAM figure on a run row in the Agent tree (its title
  runs past 60 characters) → the chip shows with no wait, and moving the pointer off drops it at once. Vitest + eslint
  only, not tried in the app (`titletiphost.tsx`, `titletip.ts` `tipDelay` removed).
- [ ] (arcterm) A run worker's header stays on one clean line: open a worker whose lead's name is a long goal → the
  link back to the lead (↰ icon) is cut with an ellipsis at about 220px, the project name stays readable, and the model
  and context figure stop short of the Chat | Terminal switch; hovering the link shows the whole name. Vitest + eslint
  only, not tried in the app (`agentheader.tsx` `RunLinkItem`).

## 2026-11-15

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

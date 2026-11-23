# Waiting on a hand check, part 5

Older lines of `docs/hand-checks.md`, moved here when it grew past its size; the rules and the list of parts
are in that file. Tick a line here when it holds, then remove it; a part left empty is deleted.

- [ ] (arcterm) Chat's Fork resumes in a real claude: in a Claude agent's Chat, ⋯ → Fork opens a session that knows
  the whole conversation; Fork from here on your second message, one that knows only the first exchange; on a reply,
  one that knows everything through that reply. The original session is unchanged (the scenario `chat-fork` covers
  the menus, the tab and the draft with a mocked fork; this is the live claude replay; `pkg/agentsessions/fork.go`).
- [ ] (arcterm) A real Sleep says so until the agent sleeps: on an idle Claude agent with a long, warm conversation
  (so the server compacts first), Sleep from its row menu → its Chat box reads "Compacting, then sleeping…", read-only,
  no Stop, the row menu shows that line disabled; once the summary lands (up to a minute later) the box reads "Asleep
  since HH:MM · freed N MB" with Wake, and no card sits above the conversation; on a short conversation the box reads
  "Going to sleep…" for the few seconds the process takes (`fallasleepstore.ts`, `chatcomposer.tsx`; CDP
  `agent-sleep` 5b passes with a mocked server only).
- [ ] (arcterm) A question in Chat shows one card: have a Claude agent call AskUserQuestion with Chat open → only the
  question card with its tabs and options shows, no "Wants to use AskUserQuestion" card with raw JSON and Answer in
  Terminal above it; answer it → the agent goes on; a Bash prompt it raises next still gets its Allow/Deny card
  (`permissionmodel.ts` cardHead, `permissioncard.tsx`; unit-tested only).
- [ ] (arcterm) A run's row shows the whole run's RAM: with Settings → Appearance → Agent sidebar → RAM on and a run
  working with its lead and two or more workers, the lead's row ends with the sum of the lead and its workers (about the
  Resource Manager's run group added up, not the lead's figure alone); hover it → the tooltip names the lead's own
  figure; a worker's row still shows its own; close the lead's tab → the lead-less run row shows the workers' sum
  (`agenttree.tsx` useRunRam, `agentram.ts` runRamLabel; unit-tested only).
- [ ] (arcterm) A sleeping agent goes back to its chat from a brainstorm: on a Claude agent asleep with its Brainstorm
  (or Canvas) showing, click Chat in the header → the conversation shows; Alt+C walks Chat ↔ Brainstorm and never
  Terminal, which stays dimmed and disabled; wake it → it opens in the Chat/Terminal mode it had before
  (`agentheader.tsx`, `chatmode.ts` cellViewOptions, `agent:view-cycle`; CDP `agent-chat` steps 14/14a updated, not run).
- [ ] (arcterm) A Chat message never joins the next one: on a dev app or build with `boxShowsTyped`, send a dozen
  messages to an idle Claude from Chat (short, Vietnamese, ~200 characters, one with a line break, a `/model`, a
  `! ls`) → each goes as its own prompt and its Sending… bubble goes, none stays in the terminal's box with a line
  break after it; a `/command` and `! ls` go with no noticeable delay (a box the check cannot read waits up to 2 s).
  Before, "…cũng hay" sat in the box and went out with the next message as "…cũng hay\ncó", leaving two Sending…
  bubbles (`agentsubmit.ts` waitForEcho, `chattakeback.ts` boxShowsTyped).
- [ ] (arcterm) Kael-sync behaviour reverted to ours (branch `fix/kael-revert-ours`, 2026-11-12; initiative "Kael
  sync: reverted to ours"): Usage → By provider, 7-day window → the Daily chart starts at your first day of use;
  Code, a Markdown file in Preview → `b` toggles Blame and stays in Preview; an agent writing "Editing src/x.ts…" →
  Ctrl+click on the path opens it; Ctrl+P on Code, type `@` → paths, Alt+O → Symbols; a changed file opened as a diff
  in the agent panel and Code's Diff mode still fill their pane (they are back on our layout; the Diff surface and the
  peek card keep the fill one). Scenario `code-outline` checks the `@` / Alt+O split.
- [ ] (arcterm) Kael-sync edge fixes (branch `fix/kael-sync-edges`, 2026-11-12), unit-tested only:
  on a Mac, Option+←/→ in Code's editor moves a word (Windows: Alt+←/→ there still goes back/forward);
  Code → Send review shows an asking agent greyed with "answer it first";
  Diff → pick a worktree in the sidebar → `m` on a line opens a comment, and the send bar offers a new agent in that
  worktree; comment a dirty file in project scope, commit another file → the comment stays drawn;
  start a Code comment (Alt+M), switch project → no comment box on the next project's file.
- [ ] (arcterm) Chat's compaction summary collapses from inside: in a Chat that compacted, click the Compacted pill
  → the summary shows a Collapse button at its top right and at its end; the top one closes it, the end one closes it
  and scrolls the Compacted pill back into view (`narrationtimeline.tsx` CompactionDivider). Since 2026-11-12 both
  open and close animate on the spring (~0.35 s), its border and padding folding with it rather than snapping, and the
  end button's scroll back is smooth.
- [ ] (arcterm) A new session is named by its task while it starts: New agent with a task ("sao lag vậy") → during
  "Starting Claude Code…" the agent header and the tree read the task's first line, not the project name; Claude Code's
  ai-title replaces it once it reports (`agentsviewmodel.ts` launchTitle, `cockpit-actions.ts`).
- [ ] (arcterm) A nested `claude -p` leaves its agent alone on Windows: from a Claude agent's Bash, run
  `timeout 90 claude -p "say ok" --model haiku | cat` with a build carrying `agentobserve.nestedSession` → the agent
  stays working under its own name and its Chat keeps its own conversation; before, it went idle under the nested
  session's title and Chat showed that session.
- [ ] (arcterm) Chat's tool fold lines up: open a "Worked for …" line in Chat → its caret sits centred over the step
  icons (spinner or tool icon) below it, and "Worked for" starts where the step names start (`chatstepsview.tsx`
  FoldCaret and the fold button's `px-1.5 gap-2`, matching StepLine).
- [ ] (arcterm) A picture sent to a sleeping agent reaches it: paste an image into a real sleeping Claude agent's Chat
  box and press Enter → it wakes, and its first turn shows the picture in your bubble and answers about it. The box,
  the chip, the wake call and Ctrl+↓ are covered by `task verify:ui -- chat-asleep-attach-jump` over a mocked wake;
  the delivery to a real resumed session is not (merge fc4f50652).
- [ ] (arcterm) One RAM figure per agent on Windows: after installing a build from 8eb023f79, an agent's RAM in the
  Agent sidebar matches its row in the app bar's RAM popover (within a few MB; before, the sidebar read ~170 MB higher)
  and sits near Task Manager's Memory column for its processes (`pkg/resmon/sample_windows.go` privateWorkingSet).
- [ ] (arcterm) The subagent card in Chat, on a build from 8c4050322: in a Claude agent's Chat (not bypassPermissions)
  ask for a subagent → the card reads "Wants to start a subagent" with the call's description, type and model, the
  agent reads waiting; Allow starts it and the agent reads working at once; Deny ends the turn. The terminal's own
  dialog goes with either (`wshcmd-agenthook.go` permissionRaiseFor, `pkg/agentperm`).

- [ ] (arcterm) Chat take-back and the Sending… caption, on a build from bd3a302a5: send a message to an idle Claude →
  its bubble reads Sending… until it lands, never Queued with Send now (3c7de6e85). Send two while Claude works → both
  read Queued; Esc (or ↑ in the empty box) → both come back into the box, one per line, the bubbles go, the turn runs
  on and the terminal's own box is empty. Send one to an idle Claude and press Esc before it answers → the turn stops
  and the text is back in the box. A pty probe saw the Esc half on Claude Code 2.1.322, never ↑ on a live queue
  (`chattakeback.ts`, `chattakebackstore.ts`).

- [ ] (arcterm) Tray job size tooltip, on a build from 2667a3291: with a heavy job queued, open the tray and hover a
  job's GB figure → "The RAM the queue sets aside for it (the Jobs popover says whether it was measured)". Commit:
  fix(tray) a job's RAM tooltip says what the figure is
- [ ] (arcterm) Old engine prompts are trimmed, on a build with `pkg/runprune`: about 5 minutes after arcterm starts,
  `waveapp.log` has `runprune: trimmed the prompts of N engine sessions that ended over 7 days ago (… MB)`; the first
  sweep on the 2026-11-14 store should trim ~2,200 runs and ~28 MB (a read-only simulation). Then open an old run's
  DAG and peek a task from over a week ago → its goal shows one line, its report and evidence are whole; a run you
  started yourself still shows its whole goal. Unit tests only. Commit: feat(runs) trim finished engine sessions'
  prompts after a week
- [ ] (arcterm) A server start takes no heavy-job slot, on a build from 62dd4420e: have an agent run
  `./gradlew bootRun` or `mvn spring-boot:run` in the background (or `uvicorn app:app`) in a Java or Python project:
  the Jobs popover shows no row for it, and a `task check:ts` started beside it starts at once
  (`pkg/memgate` servers). 2026-11-13.

- [ ] (arcterm) Jobslot never holds a command: after installing a build from 7835c75de, an agent's `ls` runs at once
  and a `task check:ts` still shows in the Jobs popover while it runs; with wavesrv stuck (or its socket gone), a heavy
  command starts within ~5 s instead of hanging (`cmd/wsh/cmd/wshcmd-jobslot.go` jobslotOpen, merge 7835c75de).

- [ ] (arcterm) Jobslot bypass count: on a build with feat/jobslot-connect-deadline, stop wavesrv's queue from
  answering in time (e.g. suspend wavesrv for ~10 s with a heavy command waiting, then resume it) → the command runs,
  and once wavesrv resumes the Jobs popover's footer reads "1 command ran without a slot · last …" and waveapp.log
  has `[jobqueue] … ran without a slot`. A normal `task check:ts` adds nothing to the count (`wshserver_jobqueue.go`
  GiveUpTs, `jobqueue.NoteBypass`). With no other job running, the app bar's Jobs chip reads "1 ran unqueued" in the
  warning tone and goes after 30 min. With wavesrv suspended past 15 s (the connect never completes), the command
  still runs, a file appears in `~/.arc/jobslot-missed/`, and the next heavy command after the resume removes it and
  the count goes up (`wshcmd-jobslot.go` jobslotNoteMissed / jobslotTakeMissed).

- [ ] (arcterm) No transcript error before a run's first message: start an orchestrator run, open its lead in Chat
  while the run's Setup is still going → the empty conversation shows no "Could not read the transcript: …" line, and
  the lead's messages appear once it starts (`chatempty.ts` chatEmptyError, `transcript.go` noTranscriptFile;
  fix/chat-no-transcript-yet). Unit tests and typecheck were not run for the frontend half.
- [ ] (arcterm) Shortcut labels in words on Windows: the footer chips (`Esc back`, `Enter send`, `Space · Ctrl+click
  peek`), the Ctrl+P palette footer (`Enter`, `Ctrl+Enter`, `Esc close`, the 76px key column not clipping
  `Ctrl+Enter`), a confirm dialog's `Esc` / `Enter` chips, Chat's Send now `Ctrl+Enter`, the Ctrl+Tab switcher's
  `Shift+Tab` / `Esc`, the tool picker's `Enter` / `Shift+Enter`, and a tooltip's shortcut (`Ctrl+Shift+P`, no
  lower-case `ctrl+`) — no ⏎ ↵ ⌫ left; on a Mac the same places keep ⌘⏎ ⇧ (branch `fix/shortcut-labels`).
- [ ] (arcterm) A new agent's first message with Send now: + New → Claude with a task → Chat shows the task as a dimmed
  bubble captioned "Starting Claude Code…" with a pulsing dot and no Send now; once the session is up, a message sent
  while it works reads "Queued" with Send now (`chatpane.tsx` PendingBubble, merge 69fa01de1 of chat-empty-start over
  Send now).

- [ ] (arcterm) Chat's live "Worked for …" folds: while a Claude agent works, click its last "Worked for … · N tools"
  line in Chat → its tool lines fold; click again → they open; once the agent stops it is folded as the others. Drag
  over a tool line's text to select it → the text is selected and the line does not open (`burstRenderMode`
  userClosed, `chatconversation.tsx` WorkPill, `narrationtimeline.tsx` ToolLine; fix/chat-work-fold).
- [ ] (arcterm) The skim fold keeps the point: after installing this build, in a Claude Code terminal with skim on, a
  long reply with headings folds to each heading with a line under it, a "Lưu ý / didn't run" sentence stays in the
  fold, and a reply whose fold would be most of it draws in full with no Show more (`claude/skim-mod/hooks/fold-core.ts`
  foldOf; bench `node scripts/skim-bench.mjs`).

- [ ] (arcterm) Chat's question card goes once answered, and Send queues behind it: in a real Claude agent's Chat
  (installed build, so wavesrv has `pkg/agentperm`'s change) have it call AskUserQuestion → the "Wants to use
  AskUserQuestion" card shows and the box says "Answer the permission prompt first · Send queues your message"; type a
  message and Enter → "Queued · sends once you answer". Answer on the cockpit card (not in the terminal) → the card is
  gone by the agent's next tool, and the queued message is typed in by itself (826c542d6).
- [ ] (arcterm) Resume shows its chat while loading: New agent → a project → pick a past Claude session → Resume, with
  the cell on Chat → the conversation's messages show at once, not "No messages yet", and stay when the agent reports
  in (`agentsviewmodel.ts` pendingToVM transcriptPath, `cockpit-actions.ts` launchAgent; fix/resume-chat-transcript).
- [ ] (arcterm) Agent sidebar RAM on a Mac: with an awake agent running, its row in the Agent sidebar shows an MB or GB
  figure beside its tokens within 10 s, close to the agent's row in the app bar's RAM (Consumers) panel; a sleeping
  agent shows none (`agentramstore.ts` useAgentRamPoll: no Resource Manager there, so it polls GetConsumers every 10 s
  while the field is on; checked on Windows only, `sidebar-agent-ram` scenario).

- [ ] (arcterm) Chat folds no reply by default: in a Claude agent's Chat with the skim button on, a reply over 10
  lines draws in full with its highlighted sentences and no Show more; Settings → Appearance → Chat → Fold long replies
  on folds it again, off unfolds it (`chatskimstore.ts` chatFoldOnAtom, `chat.fold` in localStorage).

- [ ] (arcterm) Chat keys and agent switching: in a Claude agent's Chat scroll up and click in the conversation, then
  Tab → the focus is in the chat box and typing goes there (Tab inside the terminal or a field still does what it did).
  While the agent works send a message so it shows Queued, then Ctrl+Enter (⌘+Enter on a Mac) in the empty box → it is
  sent now, as the Send now button (which shows the key) does. Switch to another agent and back → its conversation shows
  at once, no skeleton, and a reply written meanwhile is there (`chatpane.tsx`, `railtranscript.tsx` viewCache,
  `bindings.ts` agent:chat-focus-box; fix/chat-bash-running).
- [ ] (arcterm) Run sessions leave Claude Desktop: after installing a build with baf99c646, `waveapp.log` says
  "archived N Claude sessions" within a minute of start once a run has landed, Claude Desktop's sidebar shows no
  `arc-wt-…` / `verify-…` / `.waveterm/worktrees` groups, and in arcterm Conversation History still lists a landed
  run's workers under it, the run's usage rows are filled, and Usage's token totals did not drop
  (`pkg/sessionarchive`, baf99c646).
- [ ] (arcterm) A new Claude session reads idle: after installing a build with d24f57019, check `~/.claude/settings.json`
  has a `SessionStart` group with matcher `startup` running `wsh.exe agent-hook`, then + New agent (Claude, no task) →
  within a few seconds Chat shows no "Working…" line and no Stop button, and the tree dot reads idle. A launch with a
  task still reads working through its first turn (`cmd/wsh/cmd/wshcmd-agenthook.go` planEmission, d24f57019).
- [ ] (arcterm) An agent reopens a past conversation: from an agent's terminal run `wsh ui reveal session:<8-char id of
  an ended Claude session>` → it prints `Opened "<title>" as agent:<tab>`, and a tab for that conversation shows asleep
  in the Agent tree; `wsh agents send <tab> continue` wakes it and the turn runs. The same id again goes to that tab
  instead of opening a second (`frontend/app/view/jarvis/openref.ts` openSession, feat/reveal-session).
- [ ] (arcterm) Chat answers the panel commands itself: in a live Claude agent's Chat send `/usage`, `/cost`, `/context`, `/tasks`, `/stats`, `/skills`, `/help`, `/status` → each
  shows a card under the conversation ("shown by arcterm · not sent"), nothing reaches the terminal, and the card's ×
  or your next message closes it; sending one again moves it to the end. `/usage`: 5-hour and weekly bars with resets,
  the session's cost; `/context`: percent and tokens, Compact now sends `/compact`; `/tasks` in an agent with a
  background shell → the task with Stop, a click opens its output peek, a subagent row opens its conversation;
  `/stats`: "Reading your sessions…" then today / 7 days / spend; `/skills` and `/help`: a pick puts `/<name> ` in the
  box. Open in Terminal sends the real command and flips. On a sleeping agent the cards show and it stays asleep.
  `/diff` → the Diff surface on that agent. `/theme` → the pane flips to Terminal (`chatlocal.ts`,
  `chatlocalcards.tsx`, `chatpane.tsx`, 6ef37b31a).
- [ ] (arcterm) Skim folds long replies in Chat: in a Claude agent's Chat with the Skim button on, a reply over 10 lines → its verdict and highlighted marks (or its top reasons
  when unmarked), then "› Show more · N lines"; a click opens it in full with "Show less", and it stays open when you
  switch agents and back. A reply ending on a question, or a short one, draws in full. Skim off → every reply in full,
  no highlights. Compare one reply with the terminal's fold: the same sentences (`chatskim.ts` `chatFold`,
  `chatconversation.tsx` `ProseText`, `claude/skim-mod/hooks/fold-core.ts`).

- [ ] (arcterm) The dev app no longer piles up React's render measures: leave `task dev` up an hour while using the
  cockpit, then in its DevTools console `performance.getEntriesByType("measure").length` → a few thousand at most, not
  millions, and the renderer's working set stays flat instead of climbing toward GBs (`frontend/tauri/main.tsx`,
  933a2b8ce).
- [ ] (arcterm) `/btw` from Chat: in a live Claude agent that has finished at least one turn, send `/btw what file did
  you last edit?` from Chat (while it works, and once idle) → a dimmed `/btw …` card with "Asking on the side…" until a
  card lands on your side: the question, then "side answer · not in the conversation" and the answer as Markdown; the
  terminal shows the same as one dim line, and Claude's next turn never mentions it. Right after a wake (a resumed
  session, no turn yet) → "No side answer: this session has not finished a turn…". In a pi agent → the command is typed
  and the pane flips to Terminal. The fork and the notice's record were probed headless (`claude -p` stream-json, a
  scratch mod: `$.model.fork` answered, the notice stored as `system`/`informational`); the cockpit stream end to end
  and every card were never drawn (`claude/arc-mod/hooks/btw-core.ts`, `register.ts` `answerBtw`, `chatpane.tsx`
  `PendingCommand`, `chatconversation.tsx` `BtwCard`).
- [ ] (arcterm) A slash command's output in Chat: in a live Claude agent's Chat send `/goal every test passes` → under
  the `/goal …` card a rule and "Goal set: …"; `/compact` with the network off → its error in red; `/login` from the
  terminal → a `/login` card with "Login successful". Send `/usage` (or `/config`) from Chat → a dimmed `/usage` card with
  "Open in Terminal" and Show Terminal while the panel is open; close it in the terminal → the card turns into `/usage`
  with "Opens in Terminal" and Show Terminal (no "dialog dismissed" line). The `! command` card is now drawn by the
  same `CommandCard`: `! ls` still lands as one card, its long output scrolling inside it, `! cmd`'s error in red (both
  held on the build before this change, 2026-11-11), a command that prints nothing → "No output", and Copy takes the
  command and its output. Unit tests only; nothing was drawn (`transcriptprojection.ts` `attachLocalOutput`,
  `chatmodel.ts` `commandItem`, `chatconversation.tsx` `CommandCard`, 21b328d69).
- [ ] (arcterm) Send now on a queued Chat message: while a Claude agent works on a long turn (a build, a `sleep 60`),
  send it a message from Chat → its bubble reads Queued with Send now beside it; click Send now → the running command
  moves to the background (Terminal shows it as a background task, not cancelled) and Claude answers the message at
  once; while it asks for a permission no Send now shows (`chatpane.tsx` `PendingBubble`, `chatmodel.ts`
  `SEND_NOW_KEYS`, 07b55af84).
- [ ] (arcterm) Claude Code compacts an awake agent at arcterm's threshold: after this build start a Claude agent and
  run `echo $CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` in its terminal (or a terminal beside it) → `100000` (your Compact
  threshold); take one past 100k of context and leave it on screen and idle ~55 minutes → one compaction lands
  (Transcript → Compactions), not two; Sleep on such an agent still compacts it first (`agentsleep/config.go`
  `IdleCompactEnv`, b0b7b1f8a).
- [ ] (arcterm) Goal meter: in a Claude agent send `/goal every test in <a folder> passes` (a goal it cannot meet at
  once) → in Chat a strip above the box reads `Goal · <condition>` with a mark per check and the time running, "not yet"
  opens the evaluator's reason, ✕ sends `/goal clear` and the strip goes; in Terminal the band above the prompt reads
  `◎ goal <condition> ▮▮▯ check 2 · 1m 4s`, its clock ticking; once met both read Goal met with the checks, time and
  tokens, and go after your next prompt. Ask Claude for work it may propose a goal for → "Claude proposes a goal" and
  Answer in Terminal. Unit tests (`goal-core.ts`, real `/goal` records) and an engine test of the band on a copy of the
  mod; neither surface was drawn in a live session (`chatgoal.tsx`, `goal-band.tsx`).
- [ ] (arcterm) An agent's dot follows Claude Code's OSC 7501 reports when its hooks are silent: after this build start
  a Claude agent, then make `~/.arc/bin/wsh` fail (rename it away for a minute) and send the agent a prompt → its dot
  goes working and, ~10 s after the turn ends, idle, with `taking its OSC 7501 report` lines in waveapp.log; put wsh
  back → with the hooks working no such line appears, and an agent whose turn ends with background work still
  running stays working (`blockcontroller/progwatch.go`, `pkg/progstatus`).
- [ ] (arcterm) A run pauses at the usage limit: after this build (the next launch writes the StopFailure hook into
  `~/.claude/settings.json`), run an engine run when the 5-hour window is nearly used up → the worker that hits the
  limit reads idle, the run reads "Paused · usage limit, resumes HH:MM" (the window's reset plus 2 minutes) and its
  agents close; after that time, with RAM to spare, it resumes and the workers carry on; `run limit: paused run`
  in waveapp.log (`pkg/runpause/limit.go`, `pkg/wshrpc/wshserver/wshserver_runlimit.go`).
- [ ] (arcterm) Fork a conversation: Agent → Conversations → right-click an ended Claude conversation → Fork → a new
  tab named "<title> (fork)" opens on the same conversation, and a message there leaves the original's transcript as
  it was (Conversation History lists both); open a conversation in the centre → Fork sits beside Resume and does the
  same; a Codex or pi conversation offers no Fork (`sessionsruns.ts` `forkLaunchOpts`, `claude --resume --fork-session`).
- [ ] (arcterm) Every send is submitted: from a Claude agent's Chat send ten short one-line messages in a row, idle and
  while it works, and one of ~165 characters with Vietnamese in it → each reaches Claude as a prompt (Terminal shows
  none left in the box with a line break after it); `/compact` and a model pick from the footer run; Resume's
  "continue" nudge and Clear from the rail run (`agentsubmit.ts` `submitToAgent`, `chatpending.ts` `submitSteps`).
- [ ] (arcterm) Chat's Working line counts the turn: send a Claude agent in Chat a prompt that takes a minute → the line
  reads `Working · … (34s · ↓ 860 tokens)`, the seconds ticking and the tokens rising as each reply lands (in steps, not
  token by token as the TUI streams); compare with the TUI's own counter in Terminal (`chatpane.tsx` `TurnStatsText`,
  `transcriptprojection.ts` `turnStats`).
- [ ] (arcterm) A stopped service stays stopped: Setup → Tools → portfolio → Stop, then quit and reopen arcterm (or
  `task install`) → it does not run (no `node live/server.mjs` in Activity Monitor, :8386 refuses); open it from the rail
  → the card "portfolio is stopped" with Start, and Start brings the page up; after that a restart starts it as before.
  The portfolio tab no longer shows as a sleeping agent in the Agent tree. A dashboard request that runs Claude leaves
  the service block with no `agent:*` meta (`wsh getmeta -b block:<its id>`). Go unit tests only (`pkg/services`,
  `reportsToBlock`); the boot order that showed the service pane was not reproduced.
- [ ] (arcterm) Bash mode in Chat's box: type `!` at the start of a Claude agent's Chat box → the Bash caption and a dark
  shell well show (the border stays as it is); delete the `!` → both go; send `! ls` → no Queued bubble, and the `! ls`
  card with its output lands; a `!` later in a message changes nothing (`chatcomposer.tsx` `bash`, `chatmodel.ts`
  `bashMode`).
- [ ] (arcterm) Chat bash mode on Windows: Tab on a path and on a command word in a `!` command completes through Git
  Bash with no console window flashing (`shellcomplete.hideWindow`); the list's code is `bashcomplete.tsx`.
- [ ] (arcterm) Chat's compact header: a live Claude agent in Chat → its header shows the dot, the name and the project
  (and a server, the lead, an initiative or Ship/Commit/Close when they apply), with no ✳, state word, model, context
  or ⌥C; hover the dot → its state; flip to Terminal → the full header is back and Chat/Terminal did not move. An agent
  with no initiative: the header shows a `+ Link to initiative` chip with an `i` keycap that opens the picker under it,
  and `i` opens it too, in Chat and in Terminal; a linked agent's header shows its ◇ chip in Chat as in Terminal, and
  the chip and `i` open the rail's Initiative tab (`agentheader.tsx` `InitiativeLink`; the `initiative-link` scenario).
- [ ] (arcterm) A Chat message queued mid-turn reads as you wrote it: while a Claude agent works, send from its Chat a
  message of two lines with a pasted screenshot → once Claude takes it in, your bubble shows the two lines and the
  picture as a thumbnail, with no `<pasted_content id="…">` tags and no `Attached images:` list; a paste inside a
  message you typed around it still folds into a `Pasted · N lines` card (`chattagblocks.ts` `unwrapWholePaste`).
- [ ] (arcterm) A refused command reads as Blocked in Chat: in a live Claude agent's Chat, have it run a background
  command with a `> file` redirect (arcterm's hook refuses it), or deny a Bash prompt → its tool row shows a grey ⊘
  square and `BLOCKED`, no duration, and its open panel says `NOT RUN` instead of an exit code; the work fold's
  `· N failed` leaves it out, while a command that ran and exited non-zero (`grep` with no match) still counts red.
  Unit tests cover the projection (`transcriptprojection.ts` `bashNeverRan`); the row was never drawn (ea97fa2ea).
- [ ] (arcterm) Chat's box takes Vietnamese typing (Telex) with pills and menus around it: in a live Claude agent's Chat
  type a Vietnamese sentence in Telex (e.g. "chào bạn, xem giúp mình file này") with no menu open, again before and
  after an `@` pill, and with the `/` list and the `@` list open → no letter is lost or doubled, a syllable being
  composed is never rebuilt under you, and the caret stays where you typed. The scenarios type with `Input.insertText`,
  which never goes through an IME composition; only a real IME proves the editor's hold-while-composing rule
  (`chateditor.tsx`, `chatcomposer.tsx`).
- [ ] (arcterm) Chat's box takes paste, drop and long text like the textarea it replaced: paste a screenshot → an
  attachment chip over the box, no image in the text; paste text copied from a page or an editor → it lands as plain
  text, no formatting or font; Alt-drop a file from the tree onto the cell → its `@mention` lands in the box as a pill
  with the caret after it; type until the message passes the box's maximum height → the box scrolls inside itself, not
  the page; Shift+Enter breaks a line, Enter sends; Ctrl+Z and Ctrl+Y (Cmd+Z / Cmd+Shift+Z) undo and redo typing, and
  undo never brings back a text a pick or a recall replaced. The scenarios paste a file with a synthetic event and
  drop with synthetic drag events (`chateditor.tsx`, `chatinsert.ts`, `agent-chat` 3, 17).
- [ ] (arcterm) A sleeping agent's box wakes it with a pill in the message: sleep a Claude agent, open its Chat, type
  `look at ` then `@` and a file name (or `@../` and pick one), send → the agent wakes, and Claude Code receives
  `look at @<path>` as one message (a pill is plain `@path` text to it), and the box empties. A sleeping box takes
  text only, as before: no attachment tray, no + button (`chatcomposer.tsx`, `agent-sleep` 4b).
- [ ] (arcterm) Chat's `@` walks folders on a real disk: in a Claude agent's Chat type `@../` → the parent folder's
  entries, folders first with a trailing `/`; type `@D:/` (or `@/` on a Mac) and `@~/` → the drive's and your home
  folder's entries; Tab on a folder → the box reads `@../<folder>/` and the list shows that folder's entries, Tab on a
  file → a pill; an agent started outside a registered project walks too; a folder you cannot read (a permission
  error, a name that does not exist) → the list says `Cannot read <folder>`. The scenarios walk a temp folder and one
  that does not exist; a folder whose name holds a space cannot be picked into a mention yet (`filemention.tsx`,
  `launchermention.ts`, `agent-chat` 70-74).
- [ ] (arcterm) Chat shows what you sent as cards and pills: in a live Claude agent's Chat send one message with a
  dropped PDF, a picked `.ts` file and an `@` mention → under your bubble a card for each file (type tag, name, folder
  and size) and the mention as a pill in the text, as the chat-file-mentions canvas draws them ("Sent"); click a card
  and the pill → the file opens in the File tab; delete one of the files, reload → its card reads Not found. The
  scenario writes the message into a fixture transcript and mocks nothing of the files, but never sends one through a
  real composer and agent (`chatfilecards.tsx`, `chatfilepill.tsx`, `chattagblock.tsx`, `agent-chat` 60-63).
- [ ] (arcterm) Chat's `/` menu is the session's own list: start a new Claude agent after this build → in its Chat, `/`
  lists `/code-review`, `/simplify` and `/skim` (Built-in and Plugins groups) and the footer says "N commands in this
  session", matching Claude Code's own `/` typeahead in the terminal; connect an MCP server mid-session, send any
  message, then `/` again → its prompts show in the MCP group; an agent started before the build (or a sleeping one)
  shows the "found on disk" fallback instead; Ctrl+U in the box opens the file picker. The scenario mocks the live
  list (`agent-chat` 23, 50-53); only a live session proves the arc mod publishes it and `$.command.list()` answers
  what the typeahead shows (`claude/arc-mod/hooks/register.ts`, `pkg/claudecmds/live.go`, `slashmenu.tsx`).
- [ ] (arcterm) Chat inline visual: in a live Claude agent's Chat, ask "draw me a visual of …" → Claude writes a file in
  `~/.arc/visuals` and names it in a one-line `arc-visual` block; the visual shows inline in the app's colours (switch
  the theme: it follows on the next load, a frame already drawn keeps the old colours), its height fits the page, and a
  button in it sends its prompt as your message. The scenario draws pages from a folder of its own and clicks them
  through CDP; only a live Claude proves it writes the file where Chat looks, and writes a page that calls
  `arc.sendPrompt` from a handler (`skills/visual/SKILL.md`, `chatvisualview.tsx`, `agent-chat` 40-44).
- [ ] (arcterm) Chat inline visual in the Terminal view: the same reply seen in the Terminal view reads as one line saying
  what the visual shows plus a three-line `arc-visual` block, not the page's HTML (the skill keeps the page in the
  file).
- [ ] (arcterm) RAM of Chat inline visuals: with three visuals mounted in one chat, read the WebView2 processes' working
  set before and after (`Get-Process msedgewebview2 | Measure-Object WorkingSet64 -Sum`, with the installed app
  closed), and write the difference per visual into the "Chat inline visuals" row of `docs/open-issues.md` §5 RAM watch
  (a frame is its own renderer, kept once mounted). No step could measure it: the dev app shares the installed app's
  WebView2 image names.
- [ ] (arcterm) Round check after the two Chat runs: once run 3df0f2d3 (slash and + menus, file cards and pills, `@`
  walks folders; 15 tasks) has landed on top of run b539a1af (inline visuals), run `node scripts/cdp/final-verify.mjs
  agent-chat` on `main` → every step PASS, the inline-visual steps (`agent-chat-40` to `-44`) included, and the `@`
  picker still opens above the box with recent files first. b539a1af's t-5 committed its scenario steps without
  running them (the dev app could not boot in 10 min with RAM short); only its run's Final checks them before this.
- [ ] (arcterm) `@` picker: in a live Claude agent's Chat that has edited a few files, type `@` → the list opens
  above the box (also with the window short or the box near the top), the files the agent read or wrote this session
  lead it, newest first; type part of a name (`@sto`) → a recent file that matches still leads, and the typed letters
  are in the accent colour in each name and folder; the New launcher's Task box `@` also opens above its box. Unit
  tests and the typecheck only (`launchermention.ts` `recentMentionPaths`, `mentionMatchMask`); no dev app was run.
- [ ] (arcterm) Long Chat sends: in a live Claude agent's Chat, send a one-line message of ~500 characters, then one
  of ~5,000 characters, then a multi-line one → each is submitted (the Terminal view shows it as Claude's prompt, not
  as text left in the box), idle and while Claude works (Queued, then sent at the turn's end). Unit tests only
  (`chatpending.ts` `pastesBody`, `submitDelayMs`; `agentcomposer.tsx` `typeIntoAgent`).
- [ ] (arcterm) Esc clears a Queued bubble: while Claude works, send a message from Chat (Queued), switch to Terminal
  and press Esc → back in Chat the Queued bubble goes within ~5 s of Claude stopping; a message queued and left alone
  is still sent when the turn ends. Unit tests only (`chatpending.ts` `PENDING_IDLE_MS`).
- [ ] (arcterm) Button motion: hover icon buttons, chips and tabs on several surfaces → the colour fades in over
  ~140 ms instead of snapping; press and hold a small button → it sinks slightly (3%) and springs back on release; a
  full-width row (History's session cards) and a drag handle (a tree row) do not shrink; drag a Cockpit card and the
  fullscreen toggle in an agent header still behave as before; with Windows "Animation effects" off, colours change
  at once and nothing sinks. Only the compiled stylesheet was checked (`tailwindsetup.css` base button rule); no dev
  app was running.
- [ ] (arcterm) A background server named by what runs: have a Claude agent start a dev server in the background
  (`npm run dev` with `run_in_background`) → once the footer's Servers lists it, its row under the agent in the Agent
  tree reads `<dir> · <port>` (`portal/web · 4310` for a server in `portal\web`) instead of the agent's description,
  hovering the row shows that description, and the peek's title still reads it. Unit tests only
  (`agenttreemodel.ts` `backgroundTaskRows`, `devserversmodel.ts` `serverName`); no scenario starts a real server.
- [ ] (arcterm) Chat draft survives a switch: in an awake Claude agent's Chat, type a line and paste an image (and drop
  a file), switch to another agent, then to Jarvis, then back → the text and both chips are still in the box, the
  image's thumbnail still shows; send → the box empties and the chips go; sleep the agent with text in the box → the
  wake box shows the same text. Unit tests and the typecheck only (`agentcomposer.tsx` `keepDraft`,
  `composerattachments.ts` `draftKey`).
- [ ] (arcterm) Chat skim highlights: in a live Claude agent's Chat, ask for a long explanation → its marked sentences
  show highlighted once the reply lands, the same ones the Terminal view highlights, and the highlighter button at the
  top right of Chat turns them off and on (it stays as you left it after a restart). The scenario injects its own store
  folder; only a live agent proves the real skim store file is found and its hashes match (`chatskimstore.ts`,
  `agent-chat` 34).
- [ ] (arcterm) Chat pinned prompt beside the skim button: in a long Chat, scroll until your first prompt pins at the
  top → the pinned bar's text stops short of the highlighter button at the top right instead of running under it
  (`pr-10` on the bar, `chatconversation.tsx`). No scenario step shows the bar with the button in view.
- [ ] (arcterm) Drag a file into Chat's message box from each source → an attachment chip, no path text in the box:
  a file row of arcterm's Worktree files tree, a file from VS Code's explorer, one from Obsidian, and (as before) one
  from Explorer; dragging ordinary text (a sentence from a page) still drops it as text. Unit tests only
  (`pathdrop.ts` `pathsFromDrop`, `chatcomposer.tsx` `onDrop`); no dev app was running to try the drop.
- [ ] (arcterm) Alt+C tooltip on a sleeping Claude agent: hover the Alt+C key cap in the header of a sleeping Claude
  agent → with a canvas and a review open it reads "Switch Canvas and Review, …" (no Chat or Terminal, which the key
  skips while asleep); with neither open it reads "Switches the view once the agent wakes". Awake, it still lists
  Chat and Terminal (`agentheader.tsx` key cap title).
- [ ] (arcterm) Chat model chip: in a real Claude agent's Chat, click the model chip and pick another model → Claude
  Code switches to it (its own footer shows the new model; the chip follows once the agent's row updates). The CDP
  scenario only checks the menu and the `/model <alias>` it types, against a mock (`chatfooter.tsx`, `agent-chat` 28).
- [ ] (arcterm) Chat mode chip: in a real Claude agent's Chat, pick each of the four modes from the mode chip's menu →
  Claude Code lands on each (its footer shows it, the chip follows), pressing Shift+Tab as many times as the cycle
  needs. The scenario's fixture screen never redraws, so it only checks one Shift+Tab and the "did not offer" toast
  (`chatfooter.tsx`, `agent-chat` 29).
- [ ] (arcterm) Chat sleep and wake: Sleep a Claude agent that is showing Chat, then Wake it from the message box →
  the conversation never blinks, the model chip and attach fold out into "Asleep" and the model label and back in
  on wake, Send shows "Waking…" while it wakes, and the Chat | Terminal control stays, dimmed, while it sleeps. The
  scenario checks the same box element survives (`chatpane.tsx`, `agent-chat` 14 and 32).
- [ ] (arcterm) Chat motion: Chat fades over the terminal and back when you switch views, and the Chat | Terminal
  control's selected fill slides between its two sides, in the header and in a split's cell bar; with the OS's
  reduce-motion on, all of it snaps with no fade or slide. The scenario reads the fill's position and the layer's
  pointer events, not the look (`agent-chat` 33).

- [ ] (arcterm) Token burn joiner: after a build with 40f58fdd6 and `task install`, in a fresh Claude session ask for
  three Agent calls in one message, the third with a long prompt, so it arrives after the card for the first two is
  up; leave the card unanswered past 10 s → the third call waits (no "tool.call hook skipped" line, it does not start),
  a `wsh tokengate hold` process runs while it waits, and after Allow or Don't spawn it follows that answer and the
  hold process is gone. Unit tests only (`tokengate-core.ts` `SpawnWait`, `register.ts` `waitInFlight`). Effort
  1dce9cf9 has the matching proposed live-check chunk.
- [ ] (arcterm) Chat multi-line send: in a Claude agent's Chat, send a message with a pasted picture, then one written
  over two lines (Shift+Enter) → each is submitted at once (Claude starts on it, the terminal's prompt box is empty),
  no "Sending…" left hanging. A one-line message and a `/model` still work as before. Typecheck only
  (`agentcomposer.tsx` `typeIntoAgent`: paste then a separate Enter).
- [ ] (arcterm) Chat long path: a Chat reply holding a long path in backticks (a scratchpad path) → the path ends in
  "…" inside the bubble, hovering names it whole, clicking still opens it. Typecheck only (`markdownmessage.tsx`).

- [ ] (arcterm) Graphs load blank: open a run's Route DAG, a project's Branches card, and a design canvas from the
  gallery after a reload → while each loads the area is plain background (the Branches card keeps its height), no grey
  placeholder blocks, then the content appears. Typecheck only (`dagmodal.tsx`, `daggraph.tsx`,
  `projectgraphcard.tsx`, `canvasgalleryview.tsx`; `GraphSkeleton` deleted).
- [ ] (arcterm) Run sheet attention rows with a long task name: a failed task named in a full sentence → its orange
  row truncates the name with an ellipsis, still shows the reason ("failed"), and the `retry/skip/escalate` pill
  sits inside the border; hovering the name shows it whole (`AttentionRow`, `runsheet.tsx`).
- [ ] (arcterm) Window app id (Windows, packaged build): arcterm has one taskbar button, merged with its pin, and an
  agent toast reads "arcterm". The main window carries the app id instead of the process
  (`set_window_app_user_model_id`, `src-tauri/src/main.rs`); release-only code (`cfg(not(debug_assertions))`), which
  `task dev` never reaches, so only a packaged build tries it. Build cdfa1afd4 died at launch in it (heap corruption,
  empty log); e584b1faa launches clean.
- [ ] (arcterm) Agents keep colors after an installer run from an agent's shell: from an agent's PowerShell run
  `"<installer>.exe" /P /UPDATE /R` → the reopened arcterm's Claude agents draw in color, and `waveapp.log` has a
  `[tauri] opened from an agent's shell; dropped … NO_COLOR …` line. A `NO_COLOR` set in your own environment still
  reaches agents (`src-tauri/src/shellenv.rs`, e584b1faa).
- [ ] (arcterm) Agents keep colors after `! task install` typed in a Claude Code session (that shell has `NO_COLOR=1`
  and `TERM=dumb` but no `CLAUDECODE`): the reopened arcterm's agents draw in color, and `waveapp.log` has a
  `[tauri] opened from an agent's shell; dropped NO_COLOR TERM …` line (the 2026-11-16 launch had none).
- [ ] (arcterm) No panic when an installer closes arcterm: after `! task install`, `waveapp.log` shows
  `[tauri] Windows ended the session …; exiting` after `wavesrv stderr closed`, and no
  `panic in thread 'main' … cannot move state from Destroyed` (every install from 2026-11-13 to 11-16 had one).
  Quit from the tray still logs no such line (`EXIT_REQUESTED`, `src-tauri/src/main.rs`).
- [ ] (arcterm) Agent header Float button: an agent's header shows a picture-in-picture button left of Fullscreen; click
  it → the agent floats and the button reads pressed (accent); click again → it leaves float. The … menu no longer lists
  Float window.
- [ ] (arcterm) Claude fullscreen: with `"tui": "fullscreen"` in `~/.claude/settings.json`, start a Claude agent and
  close it within 5 s, three times in a row, then start one more → every agent opens fullscreen, and none prints
  "Claude Code's fullscreen renderer didn't finish starting last time" or "has repeatedly failed to start". Unit-tested
  only (`pkg/blockcontroller/claudetui.go`); needs the rebuilt wavesrv.
- [ ] (arcterm) Agent panel → Files: drag a file onto a folder → the folder gets an accent ring, the strip says "Drop
  to move into <dir>/", and the drop moves it (the folder opens, the file selected there); drag a multi-selection, a
  folder, and onto empty space below the rows (the root); a folder onto itself or its own subfolder shows the no-drop
  pointer; a name already in the target gives a "Couldn't move" toast; a moved file open in a File tab stays open; the
  same drag onto a terminal still types the paths. Not run in a dev app (`railtreepane.tsx`, `railmove.ts`).
- [ ] (arcterm) Cockpit → Background → Attach: the new tab runs `claude attach <short id>` and shows the session;
  answer it, let it finish → `claude agents --json` lists it as one `background` entry (no second `interactive` one)
  and its row leaves "needs input"; close the tab → the session is stopped. Also attach a job whose daemon died long
  ago (a stale "blocked" row) and see whether `claude attach` brings it back; if it errors, Attach needs a
  `claude respawn` first. Unit-tested only (`backgroundAttachCommand`, `pkg/bgagents`).
- [ ] (arcterm) History → right-click a session row → Copy session id sits between Copy title and Copy transcript
  path; pasting gives the session's id (for Claude, the transcript file's name without `.jsonl`). No dev app was
  running to try it (`projecthistory.tsx` `sessionMenu`, 5db413c1e).
- [ ] (arcterm) New agent's resume step: Mod+N with Claude Code → the three columns as before, New session picked; →
  into Session and ↓ onto a past session → the dialog turns into the step (Task box on top, the Session list left, the
  picked session's last messages right: your messages boxed, Claude's as markdown) with focus still on that row; ↑↓
  moves the read with a short fade; ↑ back to New session → the columns return, focus on New session; ← (or the agent /
  project button in the title) shows the columns with focus on Project, and → back into Session returns to the step;
  Esc closes the dialog in one press; Shift+Enter does nothing there (no Open asleep in the footer); Alt+← from the
  Task box shows the columns, and Back shows its `alt+←` hint. Check the dialog keeps its height across the switch. Pick
  a long session and scroll to the top of its messages → "Reading older messages…", then 10 older ones land above
  with what you were reading staying put; keep going → "Start of the session" at the top. A session whose last 8 MB
  is all tool output reads on by itself until a message shows. Not run in a dev app (`launchermodal.tsx`,
  `launcherpeekpanel.tsx`, 73435fc7a, c0b0f4078, branch `feat/launcher-peek-older`).

- [ ] (arcterm) Kael sync 11-06: a real `snapshot-dev.mjs` boot on the packaged store: with the main dev app stopped,
  run `task dev:snapshot` on your install → the app opens on a copy of your projects, runs and vault; no run resumes
  and no agent relaunches (nothing starts outside `%LOCALAPPDATA%\arc-snap\scratch`), no vault push or commit reaches
  your real vault, and a block whose cwd is a real folder refuses to start with the reason (red in its terminal, "failed
  to start" on an agent's row). Ctrl-C ends it. It needs your packaged install, which a run's checkout does not have, so
  no real boot was seen (`scripts/cdp/snapshot-dev.mjs`, `cmd/server` `snapshotSkips`, `pkg/blockcontroller`
  `ResyncController`).
- [ ] (arcterm) Kael sync 11-06: the terminal status line on macOS: open a terminal in the Agent tree and run a
  long command (`sleep 30`) → its row stays the one line it was, with no dot, command or port chip, and nothing errors
  in the console (the sampler reads no terminals on a Mac, so `terminalStatusLine` is `null`). The Windows draw is
  shown by the `terminal-status-line` scenario; this branch needs a Mac, which no run here has (`agenttree.tsx`
  terminal rows, `pkg/resmon`).
- [ ] (arcterm) Kael sync 11-06: the prompt cards in a live Claude session. After the next install (`task install`,
  which closes the running arcterm), start an orchestrator run on a small plan and open its lead, then a worker and a
  reviewer in the Agent tree → each one's first prompt is drawn as a card (its role, tags and labelled parts: the
  worker's task, the reviewer's `The task:` and `The change:`, the lead's goal), not as raw text, and Ctrl+O shows the
  text the model reads. Then send an agent a message from the cockpit and let a child run end under a lead → each reads
  as a card too (an agent message, a child-run line). A prompt you type that opens like one of these outside arcterm
  (paste a worker's first line into a Claude Code session in a plain terminal) stays as typed. Only the mod's
  vitest suite ran, on fixtures built from our own prompt builders; a drawn prompt row was never seen in a live session,
  and a launch prompt is the command-line argument, so its row carries no plugin origin and is known only by its
  opening (`claude/arc-view-mod/hooks/prompt-core.ts`, `prompt-row.tsx`, `register.ts`).
- [ ] (arcterm) Kael sync 11-06: the reviewer fails a real task that wrote outside its Files line. Run an orchestrator
  plan with a task whose `**Files:**` line names one file and have its worker also edit another (a stray change to
  `README.md` will do) → the task's reviewer prompt ends with "The task's commits change these paths, which its
  **Files:** line does not list:" and that path, and the review fails the task for it unless the worker's report names
  it under Differs from plan. A task whose edits all sit inside its Files line (a listed directory covers its files)
  gets no such section. Only unit tests ran (`pkg/orchestrate/review_test.go`); no real run reached a reviewer
  (`spawnReviewer`, `unlistedSection`, `jarvis.TaskFiles`).

- [ ] (arcterm) **A run's agents run below normal priority.** After the next build, start an engine run; while a
  worker types, Task Manager → Details (add the Base priority column) shows its `claude.exe`/`node.exe`, the `bash.exe`
  of its commands and a `tsc`/`go` they start as Below normal, and your own agents and arcterm itself as Normal; the
  same for the engine's Verify/Final `bash.exe`. On a Mac, `ps -o pid,nice,comm` shows them at nice 10 (that branch
  compiled under `GOOS=darwin` vet only, never ran). `jobobject.LowerPriority`, block meta `cmd:lowpriority`.
- [ ] (arcterm) **Cancelling a pi turn takes its command out of the job queue.** With `jobs:mode` `slots` and
  `jobs:slots` 1, have one agent run a typecheck, then have a pi agent run another: pi's footer shows it queued; press
  Escape in pi → the Jobs popover drops pi's entry at once, and nothing holds a slot after the first one ends.
  `pi/extensions/waveterm-tools.ts` (ctx.signal, read from pi 0.73.1's types, never run live).
- [ ] (arcterm) **The transcript's ↓ button scrolls smoothly.** In a sleeping or ended agent's transcript, scroll up
  a few screens and click the round ↓ at the bottom: the feed glides down to the last line (instant with Reduce motion
  on), the button leaves and does not flash back, and scrolling up mid-glide stops it. `sticktobottom.tsx`.
- [ ] (arcterm) **+ Project on an initiative with none.** Brief → open an initiative with no project → under its title a
  dashed `+ Project` sits before "active · updated …"; click it → "Choose a project" opens, its button reads Set project;
  pick one and press it → the dialog closes, no agent starts, the meta line now leads with the project and the button is
  gone; Work on then starts in that project with no picker. Work on from an initiative with none still opens the picker
  with Start agent. Typecheck only (`initiativesheet.tsx`, `initiativeprojectpicker.tsx`); no dev app was up.
- [ ] (arcterm) **New agent: pick the Claude account for one launch.** After the next build, with two or more Claude
  accounts in Settings → Claude account, open New agent on Claude Code → the footer reads `Claude: <account> ⌄`;
  click it → a menu above lists your /login account then each token account, the one in use ticked, `active` (or
  `project`) beside the usual one; pick another, Launch → the new agent's usage meters and `/status` show the picked
  account, and the active account in Settings is unchanged. Escape closes the menu, not the dialog. Only unit tests and
  the typecheck ran; the menu was never drawn (`launchermodal.tsx` AccountPicker, `blockcontroller` MetaKey_ClaudeAccount).
- [ ] (arcterm) **Overview shows an agent's whole name.** Agent → a project's Overview with an agent at work whose name
  is longer than ~15 letters ("Rail trong brainstorm mode") → its Running row shows the whole name and the "running …"
  line beside it shortens instead; a short name still lines its detail up with the others; a very long one stops at
  60% of the row. Same in Finished, not read yet. Typecheck only (`projectnow.tsx`); no dev app was up.
- [ ] (arcterm) **Brainstorm hides the details rail.** Open an agent with a brainstorm and press `b`: the right details
  rail (token meter, Files changed) and its 44px strip are gone, the brainstorm pane reaches the window edge, and the
  header's `⋯` has no Show/Hide details. `b` back to the terminal: the rail returns as it was. A canvas or a Doc review
  still keeps the rail. Typecheck only (`agentsurface.tsx`, `agentheader.tsx`).
- [ ] (arcterm) **A stopped Keep running app stays stopped across a restart.** In the installed app, Setup → Tools:
  portfolio (Keep running on) → Stop, quit and reopen arcterm → it reads stopped/sleeping and nothing listens on 8386;
  `services.json` in the data dir has `"off": true` for it. Open it (rail or tree) → it starts, `off` is gone, and the
  next restart starts it on its own again. Unit tests only (71461e840).
- [ ] (arcterm) **A council reply to a long message stays in the column.** After the next build, in a council's
  Discussion, press Reply (↶) on a seat's long message, type a short line and send → your bubble sits at the right,
  no wider than the column; its quote row shows the seat's name and the message cut with `…`, and your line shows
  under it. Before, the bubble stretched off the left edge and your text was out of sight. Checked only on a copy of
  the bubble's markup in the dev app, not on a real council (`councilchat.tsx` ReplyMessage bubble, `max-w-full`).
- [ ] (arcterm) **A council's r / c / m keys.** Open a council: each tab of the Report / Discussion / Map strip shows its
  key (r, c, m) after its icon and the Discussion's count, the strip still one row. With focus out of a text box, `c`
  opens the Discussion, `m` the Map, `r` the Report (on the Report already, it glides to the body); typing r c m in the
  Discussion's box writes them. Back in the terminal, `r` / `c` / `m` are the agent's again. Unit tests and the
  typecheck only; the `council-discussion`, `council-map` and `council-summary` scenarios, updated for it, have not run.
- [ ] (arcterm) **A council report's tab bar on top, one `⋯`.** Open a finished council's Report: the bar with the
  Report / Discussion / Map tabs, the jump links (Ideas worth trying · Wild ideas kept aside) and one `⋯` sits at the
  top, above "Council · Brainstorm" and the title, and stays there as you scroll. The `⋯` lists Save as doc (or Open the
  document), Create initiative and Run again, a divider, then Resume (an old council) and Pin; the cover has no `⋯` of
  its own. A click on Report while it shows glides to the ideas, just under the bar. Typecheck only, and the
  `council-summary` scenario, updated for it, has not run.

- [ ] (arcterm) **Council decisions in CLAUDE.md, and Update CLAUDE.md.** After installing a build, open the thesis
  project's CLAUDE.md: within a few seconds of arcterm starting it ends with a Council decisions block (the 11-04
  council's Direction, two Agreed, one Open) between `arc:council-decisions` markers, and the rest of the file is as it
  was. Add an entry in that council's Memory tab → the block shows it about 3 s later. At the foot of the Memory tab,
  under the list: one Claude agent open in the project → "Update CLAUDE.md with <agent>" pastes a one-line prompt into
  its terminal and submits it, the status reading "Sent to <agent>…"; several → "Update CLAUDE.md…" shows Send to and
  their names; none → "Copy the CLAUDE.md prompt" copies it. A council with an empty Memory shows no bar. Unit tests
  and the typecheck only (db3ebe8f4, 14f8da9c8).
- [ ] (arcterm) **Reply to a seat's message in a council.** In the installed app, open a council's Discussion, hover a
  seat's message in the chat → Reply (the arrow before Copy) puts "Replying to <seat> · <first words>" above the box,
  the caret in it, and the line under the box reads Answered by: <seat>; a click on the line goes back to the message, ×
  or Esc clears it. Send → your post shows the seat's message quoted at its top, and only that seat answers it. The same
  in an idea's thread (its own box). Then switch the rail Ideas → Memory → Ideas: each keeps where it was scrolled.
  Unit tests and the typecheck only (1678c53c5, 16781ddb0).
- [ ] (arcterm) **A council chat with a diagram keeps still.** Open a council whose ideas hold a ```mermaid diagram
  (thesis: "Chốt bài toán…", ideas 17 and 27), scroll to near the end, open another agent and come back, and switch
  the header to Summary and back: the chat lands where you left it, and scrolling up glides with no jump of a
  screen. Quit and reopen arcterm and do it once more (the first drawing holds its room from the size kept last
  session). WebKit check of the drawing cache only; never tried in the app.
- [ ] (arcterm) **A big council opens at once.** Open the thesis council "Chốt bài toán…" (158 messages) from the Agent
  tree → the tree row and the header answer the click at once, a skeleton of message bubbles shows, and the chat
  replaces it within about a second, landing where you left it. A small council (a CDP fixture) opens with no
  skeleton. Unit tests and a WebKit bench of the markdown only; never tried in the app.
- [ ] (arcterm) **The council sheet's actions do what they say.** In the dev or installed app, open a finished council
  from Jarvis → Activity → its Earlier line, so the report opens in the Brief's sheet → Add to initiative… lists the
  initiatives and adds the chosen direction as a chunk (the initiative's plan shows it); Ask in chat opens the council's
  Discussion with the draft filled; Open chat opens the Discussion; Full report ↗ opens the report file in Code. Then a
  failed and a stopped council: the verdict block says it ended and lists what finished. Unit tests only; the
  `jarvis-council-sheet` scenario clicks none of these (Revamp Jarvis, 471a49f67).
- [ ] (arcterm) **An agent's note on a chunk reads as an agent's.** Let an agent write a note on a chunk (`wsh effort
  note` from a run's worker), then open the initiative in the Brief's sheet and the chunk → the note block is drawn in
  the agent's colour with Open agent session ↗ (or Open run ↗ for a run's note), clamps at four lines with Show all, and
  a run's report shows under Show all. Unit tests only: a scenario cannot write an agent-authored note (Revamp Jarvis,
  d2848e49d).

- [ ] (arcterm) **Pause and Resume keep each agent's session (claude, pi, agy, codex).** In the installed app, for each
  of the four harnesses, start an orchestrator run whose worker uses it (a run per harness is fine; a quick run works
  too) → while a worker is mid-task, the run's ⋯ menu → Pause → the lead and every worker stop (their processes leave
  Task Manager or Activity Monitor), the run reads "Paused · resumes when memory frees", and the worktrees and commits
  stay. Answer a question the worker had open while the run is paused. Resume → each agent reopens in its own tab and
  session with the "Arc paused this run…" nudge, still holding its earlier conversation (no fresh session), carries on
  from where it stopped, and gets the answer you gave while paused. Go tests only; the CDP `run-paused` scenario seeds a
  paused run and never suspends a session.
- [ ] (arcterm) **A run pauses itself under real memory pressure and resumes when it frees (Windows and macOS).** On
  each OS, with two or three runs going, fill RAM (several `node -e` allocating a few GB each, or a few big builds)
  until the app bar's RAM chip is amber and stays so for about a minute → the run with the fewest tasks done (not one in
  its Final stage or mid-merge, and holding over 1 GB) pauses by itself, the RAM drops, and its `run-paused` event
  reads `auto` with the RAM it held; no card and no toast. Free the RAM → about five minutes later, once the free RAM is
  over what the run held plus 4 GB, it resumes by itself. On Windows the pressure reading (commit charge) is never
  "normal", only unknown: check it resumes there all the same. Only the pure rules (`runregulator.Decide`) are unit
  tested.
- [ ] (arcterm) **The run card's ⋯ menu.** `BlockedCard` in `runcards.tsx`, the one run card that carries a Cancel, is
  mounted by no screen, so the `run-paused` scenario has no step for its menu. When a screen mounts it: on a top-level
  active run its ⋯ menu holds Pause, on a paused one Resume, and neither sits beside Cancel.
- [ ] (arcterm) **Skim folds a long reply.** After the next build, a new `claude` session (fullscreen) → ask something
  that gets a reply longer than 10 lines → it shows the first paragraph and up to 4 one-sentence reasons, then
  `▾ show more · N lines` → click it → the whole reply, highlighted as before, with `▴ show less` under it → click →
  folded again; `/skim` off → replies draw in full. The fold was seen live through a dev-mod probe; the click and the
  skim-mod build were not tried (`claude/skim-mod`, fold-core.ts).

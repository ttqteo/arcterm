# Changelog

What changed in arcterm for the person using it, newest first. Internals (tests, specs, plans, build
scripts) stay in `git log`.

Add one line in the same commit as any change a user would notice, under `Added`, `Changed` or
`Fixed` in the top section. The top section stays `Unreleased` until its build: on a bump, replace
`Unreleased` with the build date. If the top section already has a date, open a new
`## Unreleased` above it, and give it a version number at the bump.

The app reads this file for What's new (the version at the bottom right). A line about something you can open may end
with `<!-- try: <id> -->`, the id of a global keybinding (`buildGlobalBindings` in
`frontend/app/store/keybindings/bindings.ts`, such as `go:usage` or `open-tool`): its note gets a Try it button that
runs it. `whatsnew.test.ts` fails on an id that is gone.

A new feature someone would open the app to try ends with `<!-- big -->` (either order beside a try comment): What's
new draws it as one of its release's cards and folds every other line under a count. At most 5 per release, and
`whatsnew.test.ts` fails a release with more; a fix, a tweak or a rename is never big.

A big line may also end with `<!-- shot: <file> -->`, a picture of the feature in `public/whatsnew/` that its card
shows above the title: a 2:1 crop of a `task verify:ui` screenshot, as WebP, named `<version>-<topic>.webp`
(`cwebp -q 82 -crop <x> <y> <w> <h> cdp-shots/<shot>.png -o public/whatsnew/<file>`). `whatsnew.test.ts` fails on a
missing file, on one over 120 KB, and on a picture given to a line that is not big.

## Unreleased

### Added

- Each agent in the Agent sidebar shows the RAM it and the commands it runs hold now, beside its tokens. Settings →
  Appearance → Agent sidebar → RAM turns it off.
- In Chat, a `!` command you send shows at once with Running… until it finishes, instead of nothing until its output
  lands.
- Chat keys: Tab puts you back in the chat box after you scrolled or clicked in the conversation, and Ctrl+Enter
  (⌘+Enter on a Mac) in the empty box is Send now for a queued message, shown beside the button.
- An agent can reopen a past conversation for you: `wsh ui reveal session:<id>` opens it in a tab, as Resume in
  Conversation History does, and `wsh agents send` then wakes it with a message.
- Chat answers `/usage`, `/cost`, `/context`, `/tasks`, `/stats`, `/skills`, `/help` and `/status` itself: a card under
  the conversation with your plan windows and the session's cost, how full the context is (with Compact now), the
  background tasks and subagents (Stop, see the output, open a subagent), your token totals, the commands to pick from,
  and the agent's model, account and session. They work on a sleeping agent too, and each card offers the real panel
  in the Terminal. `/diff` opens the Diff surface on the agent. <!-- big -->
- Skim in Chat folds a long reply as it does in the terminal: its verdict and the sentences Claude marked (or its top
  reasons), then Show more with the reply's length to read it all. The Skim button turns it off with the highlights.
- `wsh council bench` also measures Arc's brainstorm skill, and its results table is split into Review and Brainstorm.
- A goal meter for Claude Code's `/goal`: above Chat's box and above the prompt in the terminal, the goal, a mark for
  each check Claude's evaluator made, how long it has run, and Goal met or stopped with its counts; the evaluator's
  reason is a click away, ✕ clears the goal, and a goal Claude proposes shows while it waits on your answer. <!-- big -->
- Fork a Claude conversation: a new session that starts from where it is, in a tab of its own, while the original
  stays as it was. It is in a conversation's right-click menu and beside Resume when you read one.
- A message queued in Chat while Claude works has a Send now beside Queued: Claude moves what it is running to the
  background and reads your queued messages at once, as Claude Code's own send-now key does.
- `/btw <question>` from Chat gets its answer in Chat: a card under your question, the answer from the conversation so
  far, marked as a side answer that Claude's conversation never sees; the agent's work goes on meanwhile.
- Chat's bash mode (a message that starts with !) shows the command in a shell well, suggests the last matching !
  command you ran (→ takes it), and completes commands, $variables and files with Tab.

### Changed

- A folded long reply keeps its point: every heading keeps a line, a bold label keeps the sentence after it, the
  options a "choose one:" sentence points at stay, and so do the warnings and what waits on you that the old fold cut
  away. A fold that would be most of the reply shows the reply in full instead.
- Chat no longer folds a long reply: the skim button only highlights the sentences that matter, and every reply draws
  in full. Turn folding back on in Settings → Appearance → Chat.
- The Claude sessions arcterm's runs, verify checks and background passes leave behind move to
  `~/.arc/archive/claude-sessions` once their worktree is gone, so Claude Desktop no longer lists hundreds of worker
  sessions as projects; arcterm's history, run usage and token stats still read them there.
- A bare `/theme`, `/privacy-settings` or another command whose panel only Claude Code's own screen draws now flips
  Chat to the Terminal, as `/model` does, instead of leaving a card waiting until you went there yourself.
- A Claude agent that stays awake and idle is compacted by Claude Code's own idle compaction, which arcterm now
  starts at your Compact threshold (100k unless you changed it) instead of Claude's 200k; arcterm compacts only the
  agents it puts to sleep, so the two never compact the same agent. It applies to agents started after the update.
- An agent's status keeps up when its hooks fall silent (a killed `wsh`, a hook another plugin skips): arcterm's
  terminals now answer the program-status protocol (OSC 7501) that Claude Code reports through, and when no hook
  has said anything for 10 seconds around a change, the agent's dot takes what Claude Code reported.
- The / menu in Chat lists every command Claude Code offers in that session (built-ins, its own skills, plugins, MCP),
  grouped and scrolling, and the + button opens a menu: add files or a folder, slash commands, MCP servers, plugins.
- In Chat, the files you send show as cards under your message (type, name, folder and size; click to open), the files
  you @mention as pills, and pasted or tagged content (a paste, a system reminder, command output) as a folded card,
  instead of raw paths and tags.
- Chat's message box shows a file you @mention as a pill, and @ walks folders: type @../ or @D:/ to browse, Tab to step
  into a folder.
- Chat's `@` file list opens above the box, puts the files the agent just read or wrote first, and marks the
  letters you typed in each name.
- Every button eases its hover and focus colours in instead of snapping, and sinks a little when you press it.
- Chat's Working line counts the turn as the terminal does: how long it has run and the tokens Claude has written,
  as in "(1m 11s · ↓ 3.1k tokens)".
- In Chat, the agent's header keeps only its name and project: the model and the context are in the message box, and
  what it is doing in the chat. Link to initiative moved into the … menu (`i` still opens it); the Terminal view keeps
  the full header.
- While Claude waits on a permission prompt or a question, Chat's message box says so above your text, and Send
  queues the message instead of doing nothing: it goes by itself once you answer (Cancel takes it back).

### Fixed

- An agent's shell commands no longer freeze while arcterm is busy: an ordinary command never waits on the heavy-job
  queue, and a build or test suite waits at most 5 seconds for the queue to answer before it runs anyway.
- Chat no longer shows "Could not read the transcript: … cannot find the path specified" for a run's lead or worker
  that has not written its first message yet
- In Chat, the "Worked for …" line of what the agent is doing now folds when you click it; before, it stayed open
  until the agent stopped. Selecting a tool line's text no longer opens or closes the line.
- Resuming a conversation from New agent shows its messages in Chat at once, while Claude Code is still loading, instead
  of "No messages yet".
- Opening a compaction's summary in Chat at the end of the conversation keeps the COMPACTED line in place and opens the
  summary below it, instead of scrolling to the summary's last line.
- Chat's card for a Claude question (AskUserQuestion) now goes away once the question is answered, instead of staying
  until the turn ended and keeping the message box from sending.
- Chat's Send now shows Ctrl+↵ on Windows instead of ⌘↵.

- Switching between agents no longer shows Chat loading each time: an agent you come back to shows its conversation at
  once and reads only what was written since.
- A new Claude Code session you have sent nothing to reads as waiting at its prompt, not "Working…" with a Stop
  button.
- A question card with several questions in Chat, a run's card or a held command's dialog switches between its tabs
  again, and picking an answer moves on to the next question.
- A Chat message with a picture or several lines, sent while Claude works, no longer shows twice, once still marked
  Queued after Claude has it.
- A Chat message queued while Claude runs a long command keeps its Queued bubble until Claude takes it, instead of
  vanishing after two minutes.
- Chat's message box no longer underlines Vietnamese (or any non-English) words as misspelled.
- A run whose agent hits your Claude usage limit pauses until the limit resets, reading "Paused · usage limit,
  resumes 05:02", and carries on by itself after it, instead of retrying the worker into the same limit every 15
  minutes until the retries ran out. An agent stopped by any API error now reads idle instead of working.
- What a slash command prints shows in Chat under the command, as a `! command`'s output does (`/goal`'s "Goal set",
  a failed `/compact`'s error, `/login`'s "Login successful"), where it used to be dropped, along with a command such as
  `/login` itself; a command whose panel only Claude Code's own screen draws (`/config`, `/usage`…) says it opens in the
  Terminal, with a button to show it.
- A `claude -p` (or any claude) an agent starts from its own terminal no longer takes the agent over: its state, its
  conversation in Chat and the agent's control stream stay the agent's, where they used to switch to the nested
  session and, once it ended, leave the agent without its stream until it restarted.
- A message sent from Chat (or the cockpit, a slash command, Compact, Clear, a model pick, a nudge) is submitted every
  time, instead of now and then landing in Claude Code's box with a line break after it and waiting there unsent.
- A service you stop stays stopped, through a restart of arcterm and when it shows on screen: its card says it is
  stopped and offers Start, instead of it starting again by itself (a reinstall used to bring a stopped app back up).
- A service whose page runs Claude (a dashboard asking Claude for an analysis) is no longer taken for an agent: it no
  longer shows as a sleeping agent, and the memory regulator no longer stops it to free RAM.
- A `! command` you run in the agent's box shows in Chat as one card: the command, then what it printed (errors in red,
  "No output" for one that printed nothing), instead of an empty "Bash input" card and a bubble of raw `<bash-stdout>`
  tags.
- Chat's message box goes into bash mode when it starts with `!`, as Claude Code's own box does: a Bash caption says
  the text runs in the agent's shell.
- A skill the agent runs by itself shows as a Skill step in its work, instead of a bubble on your side that looked like
  you had typed the slash command.
- A Chat message you send while the agent is working shows as you wrote it, its pictures as thumbnails, instead of
  raw `<pasted_content id="…">` tags around the text and a list of image paths.
- A command Claude Code refused before it ran (a hook, a permission rule, you declining it) shows as Blocked in grey
  in the agent's transcript, instead of a red failure in the "N failed" count of the tools it worked through.
- A run you pause stays paused until you resume it: Arc's memory regulator no longer resumes it a moment later, and
  a restart no longer resumes it either. It reads "Paused · until you resume".
- A long message sent from Chat is submitted instead of sitting in Claude Code's box as a new line while Chat showed
  it Queued.
- A message you cleared with Esc in the terminal no longer stays Queued in Chat: its bubble goes a few seconds after
  Claude stops.
- A run holds far less RAM: a task's worker stops once it hands its commit to review, and its reviewer once its
  verdict is in, instead of both idling at their prompt (~1.5 GB each) until the lane landed. Pausing a run now stops
  those idle sessions too.
### Changed

- A background command that left a server running is named in the Agent tree by the server and its port
  (`portal/web · 4310`) instead of the words the agent started it with; hover the row to read those.
- The peek of a background command or Monitor widens to fit its output, up to the edge of the window, so a wide build
  log no longer wraps every line.
### Changed

- A new session's Chat no longer reads "No messages yet" over a "Working…" line while it starts. A session launched
  with a task shows that task at once as your first message, captioned "Starting Claude Code…"; one launched without
  a task shows the agent's logo, "Starting Claude Code…" and the project it starts in. Once it is ready, it shows
  "New conversation" with the model, the project and how to begin (`@` for a file, `/` for a command). An agent that
  failed to start says so, with why.

## 1.0.6 — 2026-11-10

### Added

- A Claude agent's cell opens in Chat: its conversation as bubbles with a message box under it (Stop, attachments, pasted images that show in your message, and `@` for a project file included), an Allow / Deny card when Claude Code asks for permission, and the choices of a question it asks as buttons. The real terminal is one flip away, in the header's Chat / Terminal switch or with Ctrl+Shift+K (Cmd+Shift+K on a Mac); a split's cells each have their own switch. <!-- big -->
- In Chat, a message you send while Claude is working shows as yours at once, marked Queued, and stays where Claude
  takes it; one you queued in the terminal shows as your bubble too.
- In Chat, `/` in the message box lists Claude Code's commands and your skills, ↑ puts back the last message you sent,
  and under the box the model, the context used and the permission mode are shown (the chips are under Changed). A
  permission card also offers the prompt's own "Yes, and don't ask again" choice, and Copy shows on
  hover under a message and on every code block.
- In an agent's Files tab, drag files or folders onto a folder of the tree to move them there; pins and open file tabs
  follow. Dragging onto a terminal still types the paths.
- A session's menu in History has Copy session id, beside Copy title and Copy transcript path.
- Chat shows Claude's skim highlights, the sentences worth reading, as the terminal does; the highlighter button at the
  top of Chat turns them off and on.
- Claude agents can draw a visual right in Chat: a chart, an illustration, a widget or a quiz, in the app's colours, whose
  buttons ask Claude the next question for you. <!-- big -->

### Changed

- An agent's replies in Chat read as a page instead of bubbles beside an avatar, and your message pins to the top
  of the chat once you scroll past it; click it to go back.
- The Chat message box shows the model and the permission mode as chips: click either to pick another from a menu.
  The context shows as a small ring.
- A sleeping agent keeps the same chat as an awake one: putting it to sleep or waking it only folds the message
  box's chips in or out. Chat fades over the terminal and back, and the Chat | Terminal control slides between its
  two sides.
- Float window is a button in the agent header, beside Fullscreen, instead of a row in the … menu.
- Choosing an agent or terminal that is not in your split now shows it on its own, instead of swapping it into the
  split's focused pane. The split stays as it was: click its row in the sidebar, or one of its agents, to bring it back.
- New agent, Claude Code: pick a past session and the dialog turns into a resume step, with the Task box on top,
  your sessions on the left and the picked session's last 5 messages on the right, shown at once and formatted as in
  the transcript; scroll up to read older ones, back to the session's start. New session keeps the usual columns. The
  agent and project sit in the title: click one, Back in the footer (Alt+←), or press ← from the sessions, to change
  them. Esc now closes the dialog in one press. The step has no Open asleep button: Open asleep stays in History and
  Conversations' menus.
- The lobby Christmas tree grows with the tasks your runs finish on every machine that syncs the same vault, not
  only this one. Where you hung the ornaments stays your own on each machine.

### Fixed

- Switching to another agent or surface and back no longer empties Chat's message box: what you were writing and the
  files you had attached are still there.
- A file dragged onto Chat's message box from arcterm's file tree, VS Code or Obsidian is attached, as one dragged
  from Explorer is, instead of landing as its path in plain text.
- A subagent an agent starts while a Token burn card is already up waits for your answer on that card, instead of
  starting unasked after 10 seconds.
- A tool that is still running shows as running in Chat, with a spinner and how long it has run, instead of as done.
- A message sent from an agent's message box with an attached picture, or written over several lines, is sent at once
  instead of sitting unsent in Claude's own prompt box while Chat shows "Sending…".
- A long file path in an agent's Chat reply ends in "…" inside its bubble instead of running past the bubble's edge;
  hover it to read the whole path.
- A run's attention rows with a long task name cut the name short instead of hiding why the task stopped and pushing
  its retry/skip/escalate tag past the edge; hover the name to read it whole.
- The Route DAG, a project's Branches graph and an opening design canvas load on a blank area instead of placeholder
  blocks shaped like something they are not.
- Attach on a Cockpit Background session opens that session in its tab with `claude attach`, so it keeps running in
  the background and its row moves on to done when it finishes, instead of staying on "needs input" forever.
- Claude agents always start in the fullscreen renderer when your Claude settings ask for it (`/tui fullscreen`):
  closing or restarting an agent in its first seconds no longer makes the next ones open in the classic renderer,
  or turns fullscreen off altogether.
- On a Mac, new terminals and agents no longer fail to start with "too many open files" after a while with several
  agents open: following an agent's transcript no longer holds open every other session file of its project.
- Agents keep their colors in an arcterm reopened by an installer run from an agent's shell: Claude Code's PowerShell
  sets `NO_COLOR`, which arcterm passed on to every agent it started. A `NO_COLOR` you set yourself still applies.
- Sending a message from Chat scrolls to the end, even when you had scrolled up to read.

## 1.0.5 — 2026-11-06

### Added

- New agent: Quick look shows a Claude session's last 5 messages before you resume it (Shift+Enter).
- An initiative with no project shows a `+ Project` button under its title in the Brief's sheet: pick the project there,
  without starting an agent, and Work on goes straight to it afterwards.
- In the New agent dialog, the `Claude: <account>` line at the bottom is now a menu: pick another of your Claude accounts (or your /login one) and that one agent runs on it, without switching the active account or the project's. A resumed session started this way keeps its account; a later account switch's restart moves it to the new one.
- A council's views have keys: `r` the Report, `c` the Discussion, `m` the Map, each drawn beside its tab.
- **Terminal rows say what they run** (from the kaeltran16 fork): under its name, each terminal in the Agent tree shows a
  dot, the command its shell is running with how long it has run ("node server.js  3s") or "idle", and a chip with the
  port its processes listen on (":5173 +1" for several). Windows only for now; on a Mac the row stays one line.
  <!-- try: go:agent -->
- **Arcterm's prompts show as cards in a Claude transcript** (from the kaeltran16 fork): what a run sends a lead, a
  worker, a reviewer, a plan reviewer or the final verifier, an agent message, a child run's end, a brainstorm line and a
  note for a later task now read as a card with its role, tags and labelled parts, instead of the whole prompt as raw
  text. Ctrl+O still shows the text the model reads.
- **Image zoom in Code's Preview** (from the kaeltran16 fork): click an image in a markdown file's Preview to open it
  full-window, fitted to the window and never enlarged past its size. The wheel zooms around the pointer, `+` and `-`
  around the centre, drag pans, `0` fits again, and Esc or a click outside closes it.
- **n and p in Diff** (from the kaeltran16 fork): in the changed-file list, `n` opens the next file and `p` the previous
  one in the order the list draws, without marking it reviewed, and stop at the ends. `r` re-reads the comparison on
  screen while compare is on.
- **Resume a brainstorm from the palette** (from the kaeltran16 fork): Commands → Resume brainstorm… lists the
  brainstorms left open in every project, newest first, with the question each waits on. Enter starts an agent on one in
  its own project; Ctrl+Enter (Cmd+Enter on a Mac) dismisses it until it next changes. <!-- try: go:palette -->
- **The Brief's blocked rows say what they need** (from the kaeltran16 fork): a chunk marked blocked shows its note, its
  age and any newer note, the oldest first, and has Unblock and Done (each with Undo) in place of Open; Open lands on
  the chunk in its initiative. The queue's summary counts the initiatives the blocked chunks span, the filter reaches
  rows inside every fold, and Initiatives counts the quiet ones.

### Changed

- **The reviewer checks a task's Files line** (from the kaeltran16 fork): an orchestrator run's task reviewer is told
  which files a task's commits changed outside its Files line and fails the ones the task did not call for; it also
  fails a requirement the worker's report admits is unmet, and passes a cosmetic point with a note.
- Setup → Memory reviews one memory at a time, with its text, Delete and Ask an agent.
- A run's agents, and the builds, typechecks and test suites they and the engine start, run below normal CPU priority
  (niced on a Mac), so the machine stays responsive while a run works, and the run still takes the whole CPU when
  you are not using it.
- A council's pin button on an idea, a message or a Memory row is now called Set as direction, and its tooltip says what
  that does: the line becomes the one every seat reads first, after a check against what the seats agreed.
- A Brainstorm council splits the problem into zones, one per seat, and picks its top 3 ideas from different zones where
  it can, so one part of the problem no longer takes every place; an idea that says what the code does today cites the
  line, and between two even ideas the one read in the code ranks first.
- The app bar's Christmas lights hang only in gaps wide enough for three bulbs or more, so the narrow gaps around New
  and the fold button no longer hold a lone bulb.
- An agent's Brainstorm view no longer keeps the details rail on its right, so the brainstorm's own Boards and
  Decided rail get the width; it comes back with the terminal.
- While the judge weighs a brainstorm question, the agent's approaches are headed "Answer now, or wait for the judge",
  so it is plain the rows answer, and every row has a tick box to send several together, as the judge's options may
  allow.
- A folded reply keeps the bold heading of the section a highlighted sentence sits in, so "the list is not built"
  still says which part it is about.
- A folded reply whose opening ends on a colon ("answering when it will be done:") keeps the paragraph after it, which
  holds the answer, and claude is asked to highlight the answer to your question first.
- The prompt pinned to the top of a transcript shows as the top card of a stack when earlier prompts lie above it:
  one card's edge peeks out under it.
- A council's Report, Discussion and Map share one header row, so the tabs and the ⋯ menu stay in place when you
  switch. The Report's row shows the mode, the clock, the replies and the tokens after the status chip, and the lone ⓘ
  button is gone from the Discussion and the Map.
- A council report's idea cards name each expert once, as an avatar: the "from …" list of names and the row of
  "Proposed" chips are gone. An expert who agrees, doubts or opposes has its avatar ringed in that colour, and
  hovering an avatar says who it is and where it stands.
- The app bar shows the t> mark alone, without the "arcterm" name beside it.
- With the Christmas theme, the t> mark dresses for the season: the t a pine with a star and two baubles, the > a
  string of red and gold lights. On a Mac the menu bar icon wears it too, in colour, in deeper tones on a light menu bar.
- With the Christmas theme, the app bar's lights hang in swags between the search, the chips and New, hooked to their
  top corners, instead of one long string along the bar's bottom edge, so no bulb sits on a box.

### Fixed

- **Blame follows unsaved edits** (from the kaeltran16 fork): with a file open and changed since saving, Code's blame
  column keeps each entry beside its own line instead of drifting after an inserted or deleted line, and the lines you
  inserted or edited read `unsaved` instead of borrowing a neighbour's blame.
- A resumed brainstorm's agent gets its brainstorm pane back, whether you resume from the exited pane or from the
  palette.
- The ↓ button in a transcript now scrolls smoothly down to the latest line instead of jumping there.
- After an update, arcterm installs its own version's Claude mod and hooks again: it used to pick an old `wsh` left
  behind by an earlier install, so the Claude mod stayed at that old version.
- A council reply you send to a long message no longer stretches off the left edge of the Discussion: the quote shortens
  to fit and your text shows beside it.
- A run started from a brainstorm's Approve (or a canvas's Build this…) now opens the New dialog with the project's saved Profile (Approvals, workers, workers at once) instead of always Ask me.
- With every initiative archived, Jarvis's Brief shows the "No initiative yet" box with its New initiative button again,
  over Show N archived, instead of saying every initiative is on a card above when there are no cards.
- A project's Overview shows an agent's whole name in Running and Finished, not the first 15 letters: the line of
  what it is doing beside it shortens instead.
- A folded `claude` reply whose list has one item past the four it shows draws all of them, rather than four and
  "… 1 more", and a numbered list keeps its numbers, so "type 2" in the reply still points at its item.
- A brainstorm's decision titles are written with their diacritics in Vietnamese, as the rest of the pane is, instead
  of sometimes showing as "Quy mo chay".
- A short table in an agent's reply sits in a frame as wide as the table, instead of one stretched across the pane.
- In a sleeping or ended agent's transcript, nothing shows above the pinned prompt any more: a strip of what scrolled
  past used to peek out over it.
- An app with Keep running that you stopped stays stopped when arcterm restarts, instead of starting again on its
  own; opening it or pressing Start runs it, and from then on it starts with arcterm as before.
- **Vault notes with Windows line endings** (from the kaeltran16 fork): a memory, task or decision saved with CRLF line
  endings or a byte-order mark keeps its status, objective and id when arcterm reads it, and changing its status no
  longer stacks a second front-matter block on top of the first. The file keeps its own line endings.
- **Conversation History titles and finish marks** (from the kaeltran16 fork): a session is titled by its first real
  prompt, not by an `effort:` reference, a local command's output or the "Work by these principles" preamble; a session
  written to in the last five minutes no longer shows a "finished" event; and pi's subagent runs are no longer listed
  as sessions of their own.
- **Agents that fail to start say so** (from the kaeltran16 fork): an agent whose controller refuses to start now reads
  "failed to start" with the reason in the Agent header and its tree row, and its terminal prints the error in red,
  instead of staying a booting, working row forever.
- **Tools used stay filled off the Cockpit** (from the kaeltran16 fork): the Agent surface's details rail shows an
  agent's live Tools, Subagents and Background tasks without opening the Cockpit first, and keeps them after you leave
  it.
- **Background subagents end at their notification** (from the kaeltran16 fork): a subagent started in the background
  now ends when its completion notice arrives, as a success or a failure, instead of a neutral "done"; the plumbing
  handback row is gone from the transcript, a subagent's interior, Tools and the Cockpit card.
- **Focus after a palette pick** (from the kaeltran16 fork): picking Cockpit from the search palette with nothing
  focused leaves the Cockpit's `j`, `k` and Enter working at once, instead of dead until you click.

## 1.0.4 — 2026-11-06

### Added

- Jarvis's Brief opens on the initiatives you pinned, as cards: up to six, each with its progress bar, its next chunk and Work on. Pin one from a card's ⋯ menu, a list row, the open initiative's Pin, or `p` under the cursor; every other initiative sits in one compact list under the cards, and with nothing pinned the six that most need you show as cards. <!-- try: go:jarvis --> <!-- big -->
- `wsh effort pin <initiative>` and `wsh effort unpin <initiative>` pin an initiative to the Brief's cards from a terminal. Pinning a seventh says six are pinned and offers to unpin the oldest (`--replace-oldest` in the terminal).
- A council's report opens in the Brief's side sheet from its line in Activity: the verdict, the ranked directions with their first steps, Work on (it opens the New agent dialog filled in and never starts an agent by itself), Add to initiative…, and what to ask next. <!-- try: go:jarvis -->
- Reply to one seat's message in a council: Reply beside Copy and Pin puts "Replying to …" above the message box, and what you send goes to the seat that wrote it, with its message quoted on yours. It works in the chat and in an idea's thread; × or Esc stops replying.
- A project's CLAUDE.md (or its AGENTS.md when it has no CLAUDE.md) keeps a "Council decisions" block: the direction,
  Agreed, Ruled out and Open of each of its councils' Memory, newest first, rewritten a few seconds after a Memory
  changes. Every agent of the project starts from what the councils settled. Arcterm writes only that block; the rest
  of the file stays yours.
- Update CLAUDE.md at the foot of a council's Memory tab hands a Claude agent of the project a prompt to bring the rest
  of its CLAUDE.md in line with what the council settled (a stale status line, the next steps, an outdated direction),
  showing you the diff before it commits. With several agents open you pick one; with none it copies the prompt.

### Changed

- A council's report opens with its tab bar at the top (Report / Discussion / Map and the jump to its ideas), not at the
  bottom of the screen under the cover, and has one `⋯` menu there: Save as doc, Create initiative and Run again sit
  with Resume and Pin.
- A big council (more than forty ideas and replies) opens at once: its header and an outline of the chat show while the chat draws, instead of arcterm pausing on the click.
- The Brief shows what is waiting on you as one strip at the top (Show all opens the full queue under it), and runs and councils together in one Activity column on the right: live ones as cards, the last week's finished councils and failed or cancelled runs under Earlier, with tabs for all, orchestrator, quick and councils. <!-- try: go:jarvis -->
- An initiative opens in the side sheet instead of expanding in place, and its plan is still editable there (add, rename, move and remove chunks). `j`/`k` step its chunks, Previous and Next step the initiatives, and Activity ↗ shows its feed. A run's ↳ link opens its initiative on that chunk.
- A chunk opens inside its initiative's sheet instead of a separate side panel: one status button (`s`, then `1`–`6`; blocked asks why and keeps the reason as a note) beside the move it most needs (Start, Done, Reopen, Unblock), and its trail newest first, where Notes only hides the bare status changes. Esc goes back to the initiative.
- Pause a run from its ⋯ menu (the run sheet, the lead card on the Cockpit, the DAG view's header) or with `wsh runs pause <run>`, to free its memory without losing it: the lead, the workers and any running Verify or Final stop, the worktrees, commits and sessions stay, and a paused run reads "Paused · resumes when memory frees" in the Agent tree and the run list. Resume it from the same menu, from the small Resume button on its row, or with `wsh runs resume <run>`, and each agent carries on in its own session.
- Arc pauses a run by itself when memory stays tight, the one with the fewest tasks done, never one in its Final stage or mid-merge, and resumes it once memory has been free for a while, so a crowded machine slows down instead of stalling. It does nothing while the heavy-job queue is switched off, and it leaves a notice only in the run itself, never a card or a toast.
- A landing run's line in the Agent tree says what the land is doing: Check or Verify running and for how long, or
  waiting for RAM or a job slot in the heavy-job queue. Hover it for the details; click it for Run now, Jobs and Copy
  for an agent, to hand a stuck land to another agent.
- The Files tab in an agent's side panel has a filter box: type part of a file name (or press `/` in the tree) and
  the tree keeps only the files that match, their folders open. Enter opens the file, Esc shows it in the whole tree.
- A landing run's line in the Agent tree says what the land is doing: Check or Verify running and for how long, or
  waiting for RAM or a job slot in the heavy-job queue. Hover it for the details; click it for Run now, Jobs and Copy
  for an agent, to hand a stuck land to another agent.
- In a `claude` session, a long reply folds to its verdict and the first sentence of each of its top reasons, or,
  when Claude highlighted sentences in it, to its verdict and those sentences, still highlighted, with a ▾ show more
  button that opens it in full (and ▴ show less to fold it back), set a line below the reply in Claude's
  orange so it never reads as one of its items. `/skim` off draws replies in full.
- Right-click a session in a project's History to mark it for later: a bookmark shows on its row, the same mark the
  Agent tree's Conversations carry, and Done clears it.
- A Christmas tree stands in the Office's lobby from 1 November to New Year and grows as your orchestrator runs finish tasks: every finished task hangs an ornament, ten small ones merge into a big bauble, and the tree gains tiers of branches, then its lights, then its star, with a notice each time it reaches a new stage. Walk the boss to the tree and press `Space` for a close-up: pick an ornament with the arrows, lift it and hang it somewhere else, and the tree keeps your arrangement. <!-- big -->

### Changed

- A brainstorm whose run merged can now be closed even when the run's final check could not verify everything (it
  asks first), and Close also closes what is left of the run: accepts its outcome, ends its open sessions and removes
  the worktrees its cleanup left.
- Your own messages in a session's transcript sit in an accent-tinted box, so they stand out from the agent's replies.
- An agent asking you something in the Agent tree breathes amber over its whole row again, not only its glyph, without the stray amber line beside the row.
- The Christmas snow has its own Snow switch under Christmas effects in Settings → Appearance, off by default, and
  falls smoothly instead of in jerky steps when you turn it on.
- The Christmas theme's green is a shade darker, so text, code and cards on it read more easily.
- The Christmas lights run along the bottom of the app bar, behind its search and buttons, instead of hanging over the top of the screen below, where they sat on buttons and made them look disabled.
- While arcterm starts up (a long wait after a reinstall), the Agent and Cockpit screens show your pet running back and forth with "Setting up arcterm" instead of blank grey boxes, so it no longer looks stuck.

### Fixed

- A council seat you ask again in the Discussion remembers the chat since the report, its own earlier answers
  included: it no longer says it has not read a paper it answered about one message up, and a file or link you gave
  earlier in the chat stays open to it.
- A council's Memory keeps what you decide in the chat (a choice, a fact you correct, an option you drop), and what a
  seat settles at the end of a long answer: it used to read only a message's first 400 characters and only what the
  seats agreed on.
- A council's chat no longer jumps while you scroll or loses your place when you come back to it: a diagram in it
  keeps its height from the start instead of growing a few hundred pixels when it finishes drawing.
- A council's Ideas and Memory tabs keep where you scrolled them: switching between them, or to an idea's thread, and
  back no longer returns the list to the top.
- A run no longer logs "Cleanup failed" every 30 seconds when a dev server a worker started and left behind holds a
  finished task's folder: the engine stops what holds the folder and deletes it.
- Stop on an agent's background shell task on Windows also stops the command the task started (a `sleep`, a dev
  server), which kept running before.
- A finished run no longer waits on you to land because its spec was edited in your checkout after it started: the land keeps the run's version, moves your newer draft into the repo's `.git/arc-drafts/<run>/`, and says so in the land's notes.
- In a `claude` session, a folded reply keeps the command Claude asks you to type (`! task install`), highlighted,
  instead of ending on "type the command below:" with the command hidden under show more; and a reply that ends on a
  question for you (which way, A, B or C?) is drawn in full, so the question and its options are never folded away.

## 1.0.3 — 2026-11-05

### Added

- In the Canvas gallery, a canvas that redraws an older one now says `Replaces <topic>`, and the older card is dimmed with an Outdated chip and a Newer link to the latest version. Scan for versions finds the pairs already there for you to untick and link in one go, a card that looks like a new version offers Link or No, and an open canvas has Link an older version… (and × to undo a link). <!-- try: go:canvases -->

### Changed

- More of arcterm dresses up with the Christmas theme on: the snow keeps falling while a dialog is open (fainter over the dialog itself); New agent, New project, Keyboard shortcuts and Quick look hang a string of lights from their top edge; New agent's Start column, the cockpit's "No agents running" window and the Christmas theme chip wear Santa hats, as do the pet on the app bar's fold button and in What's new; a finished run's check becomes a gift; and the lights hang along the Christmas effects switch in Settings. A small Christmas tree stands in the bottom corner of an agent's Overview panel. <!-- try: new-agent -->
- In a project's Overview, clicking a session in History opens it in Quick look, over the page, instead of leaving for the full session; Open in the dialog (or Open transcript in the row's right-click menu) still takes you there.

### Fixed

- Right-clicking twice in a terminal opens its menu again instead of pasting twice; a double right-click at an ordinary pace no longer counts as two clicks.
- An agent that finished its turn but is still watching a Monitor or a background command no longer offers Resume in its Overview panel: the panel says it is waiting, like the agent's header, since the agent picks up again on its own.
- An agent asking you something in the Agent tree no longer flickers: its row keeps a steady amber box, and the stray amber line that came and went beside it is gone.
- In Quick look, the prompt pinned to the top of a long transcript no longer sits on a dark band that does not match the dialog.
- Every orchestrator run no longer stalls for minutes while the engine deletes one task's worktree that holds a full `node_modules`.
- New run now takes Jarvis's Parallel workers "auto": Workers at once reads auto and the lead picks the width, instead of always starting at 3. Press − at 1 to go back to auto.
- A tooltip that explains something at length (the reason the council's router picked a seat, a source's note) no longer pops over the text you are reading as the pointer passes: it waits a moment before it shows. A control's short name still shows at once. In a council, the router's reason shows only when you point at the chips above your message, and it opens above them instead of over the message.

## 1.0.2 — 2026-11-05

### Added

- **Christmas**, a new theme in Settings → Appearance → Theme: forest green and antique gold, snow falling over the window (fainter over a terminal), a string of lights under the app bar that blinks while an agent needs you, Christmas trees, gifts and a wreath in the Office, and a Santa hat on the pet and on everyone in the Office. The Christmas effects switch under the themes drops the decor and keeps the colours; with reduced motion on, the snow and the blink stop and the rest stays. <!-- big --> <!-- shot: 1.0.2-christmas.webp -->
- With the Christmas theme on, every icon on the nav rail wears a small Santa hat; it goes when you turn the Christmas effects off.
- In a project's Overview, each session in History has a Quick look button (and a Quick look item in its right-click menu) that opens its transcript in a dialog over the page, with Resume and Open, so you can read a session without leaving the Overview.

### Changed

- A Claude agent that goes to edit a file in another repo than the project it was started in now asks you first, naming both repos, even in auto mode; once you say yes it edits that repo freely until the session ends. A run's agent, which nobody is watching, is refused instead and told to ask.
- A session or run opened from a project's Overview (or from History, Councils or the Canvas gallery) now goes back there with its Back button and Escape, and the button says where ("Back to Overview"), instead of always going back to the terminal.
- In a council's message box, an `@seat` you pick or type is tinted in that seat's colour (and an `@file` as a link) as you write, as the sent message shows it, instead of sitting in the text as plain words.
- In a brainstorm, clicking a board in the Boards rail opens it large in a dialog over the question, instead of stretching the rail and squeezing the question into a thin column. A board tied to an answer has a Pick button for that answer under it.
- A Review council's report now leads with up to five ranked, evidence-backed findings and folds the rest under Also raised (a brainstorm folds its wild ideas kept aside the same way); click the heading to open them. A Review council also finishes sooner, because its seats start reviewing each other's ideas as they arrive instead of waiting for every seat to finish.
- In a council, an idea's "4 agree" shows the avatars of the seats that agreed, and hovering it lists them one per line with their avatars, instead of a plain tooltip with their names run together.
- Setup in the nav rail now carries a badge counting the projects whose memory has something to review, and its Memory tab reads `Memory · N`, so a stale or oversized memory gets noticed without opening Setup to look.

### Fixed

- The New dialog's Orchestrate and Quick run now start from the project's saved Profile (Approvals, workers, workers at once): picking the row used to count as changing the run by hand, so an Autonomous default never showed and it stayed on Ask me.
- Quick translate on Windows keeps translating when Google turns it away for too many requests: it falls back to MyMemory's free translator (up to about 500 characters at a time and a few thousand a day) instead of failing until Google lets it back in. On a Mac it is tried after Apple Translation.
- Setup → Memory now shows each project's memory size even when its model check fails, and lists the memories worth a second look without a model: one untouched for 30 days, or (when the model check failed) one naming a file that is gone. Each comes up as a Review; Still true marks it reviewed, so neither this tab nor the session-start memory check flags it again for 30 days.
- Ctrl+Z in a council's message box takes back a seat or file picked from the `@` list, a suggested question put in with a click, and text pasted beside an image; before, any of these wiped the box's undo, so Ctrl+Z did nothing after them.
- After you click a chunk in an initiative's Notes to show only that chunk, the bar on top shows the chunk's whole title, wrapping onto more lines, instead of cutting it off with "…".

## 1.0.1 — 2026-11-05

### Added

- An agent whose last turn left work to commit or push shows a **Ship** button in its header (`Alt`+`S`, also from inside the terminal): one click asks it to commit only its own changes, pull and resolve any conflict, then push, and it stops to ask only on a conflict it cannot settle. The header's … menu and the palette also offer Ship and Commit only for any idle agent, and when a Pull or Push in Diff fails because the branches diverged, its notice has a button that hands the merge to the agent whose work is shown. <!-- big -->
- A saved council report has a Cite check section after the Matrix: arcterm reads every `path:line` the report cites, the coordinator's own sentences included, with no model, and counts how many hold, how many point at a line that says nothing the sentence claims, and how many are wrong or outside the project, listing each with where it was cited. `wsh council cites <report.md>` runs the same check on a report you already have.
- An agent that starts a council on the same topic as one that ended in the past week is stopped first: it shows you what that council said to do first and whether the council has been upgraded since, and runs again only with what is new (`--new-evidence`) or because you want the upgraded council's answer (`--rerun-upgraded`).

### Changed

- The council's Memory tab is now the council's memory: one list of what the seats agreed on, ruled out and left open, kept up after each round, with the direction pinned on top. Every seat reads it before it answers.
- A council idea is quieter: its bubble holds only what the seat wrote, and one line under it carries the replies, who agreed, a weak or wrong claim, like and dislike, Chốt (now just a pin), its files as an icon with a count, and Copy and Pin to Report under a … menu; hover any of them for the details (the last reply's time, the names, the claim's note, the file list). The Ideas rail drops its caption and the agree count under Agreed, and the Read files switch and the cost estimate under the message box wait until you type.
- Switching a council between Report, Discussion and Map fades the new view in instead of cutting to it, and between Discussion and Map the grey mark slides to the tab you clicked.
- A council's header is one slim row: the Report, Discussion and Map tabs are icons, the title gets the room, the mode, time, replies and tokens sit at the foot of the Ideas rail (under an ⓘ in the header when the rail is folded), the seats show two avatars and +N (hover for the whole list), and Summarize, Resume, Pin and Stop moved into a … menu.
- A council ranks directions by how many experts picked them, counting an expert once across merged proposals, and its report says "3 experts, 1 model" rather than "5 picks": seats on one model are not independent votes. Run facts says when every seat ran on one model.

- An agent that starts a council now puts the seats that must judge whether your question's claim, method or result holds on opus, and tells you which and the token estimate before you approve; a light question stays all sonnet. A council role an agent writes for you is named in your language, checked against the library first, and saved only once you approve it.
- In a council's Discussion, an idea whose thread has replies you have not read says `2 new replies` on its reply chip and its Ideas rail row; the rail can show only those ideas.
- A council's Discussion header wraps a long title onto a second line instead of cutting it short, and its step chip reads shorter (`Round 1/2`, `Round 2/2 · 3 drafts`); the full words are on hover.
- The app bar's fold button shows only the pet, without its name; the tooltip still says what it folds into.
- In the New agent dialog, Flag, Worktree and Command are small icons beside the Task box, so its hint shows in full; Worktree lights up when on, and the flags you turned on sit as chips under the text.
- In a project's History, the runs and councils a session started hang off it on a tree line (├ └), so you can see which session they belong to and where its group ends.

### Fixed

- On Windows, Float and the fold into Sprout take a maximized window out of maximized first and size and place it right on a scaled display (125%, 150%), and coming back to arcterm grows a folded Sprout back to Full, maximized: they had followed macOS's rules.
- On Windows, Sprout's card names Ctrl+M (not ⌘M) for Restore window, and dragging an agent over a grid cell says "hold Alt to mention" (not ⌥).
- A click on an idea in a council's Ideas rail glides the Discussion to it instead of jumping there (still a jump with reduced motion on).
- Settings → Storage no longer marks a finished run's tree "has uncommitted changes" when all it holds are the links its Setup made (`node_modules`, `src-tauri/target`), so Clean all and the automatic cleanup now remove it.
- The Jobs chip reads the queue again when the app reconnects to its backend, so a job that started or ended while the connection was down no longer leaves it showing the old queue.
- In a council's message box, the `@` list no longer offers a live chat the message already mentions, so picking it again cannot write the mention twice.
- In a narrow window (about 1000px) the app bar fits again: the usage meters keep their label and percent and drop their bars and countdown (still in the tooltip), so the window's Close button is no longer pushed off the edge and All projects stays on one line.
- In a council's Discussion with the Ideas rail open, an idea's reply line (replies, new replies, last reply) wraps onto more lines instead of spilling past the narrow message column and cutting off its time.
- A background task's Output and a Monitor's Events show the colors the program printed (a build's file names, a test run's ✓ and ✗) instead of raw escape codes like `▯[36m`; a progress line redrawn in place shows its last state.
- An HTML page previewed in arcterm (the File tab, a design canvas, a brainstorm board) can no longer send what it holds to another site: it loads its own folder's files, common CDNs and Google Fonts, and its fetches, forms and frames go nowhere else. Images and video from other sites still show.
- A note titled in Vietnamese keeps its words in its id (`wsh note add "Cải tiến"` → `…-cai-tien`, not `…-c-i-ti-n`); so do Jarvis's dossier and decision files, and the id of a tool you add.
- The old `ideas` skill, which told an agent to run the removed `wsh idea` and got `unknown command`, is cleared from your skills on the next agent launch.
- A council report's file name is plain ASCII (`chot-bai-toan…`, not `chốt-bài-toán…`), so the path it prints opens with a click in the terminal.
- While a council's experts are still on their first ideas, the cards in Discussion draw their tables, lists and highlighted sentences instead of showing raw `|` and `==` marks.
- Open DAG no longer stalls before the window appears: the window opens at once with a placeholder, and the graph fills in a moment later.
- A click on an idea in a council's Ideas tab now shows which message it is: the row and its message in the channel both wear an accent ring, the message rings wider for a moment where it lands, and each idea in the channel carries its `Idea N` number, as on the tab.
- A pinned council's right-click menu in the Agent tree offers Unpin again; before, it had neither Unpin nor Close, so a pinned council could not be taken out of the tree from there.
- New opened while a council (or a council's Setup) is in the centre starts on that council's project, as it does from a project's Overview, instead of the project of whichever agent was last in focus.
- On Windows, heavy jobs (builds, typechecks, test suites) and run workers no longer go one at a time just because the commit charge is past your RAM, which a pagefile allows: they wait only when free RAM drops under a tenth.
- Dragging a file from the Files tab onto a terminal no longer types a name holding a line break (which a shell would run as Enter) or a double quote (which ends the quoting early): such a path is left out and a warning names it.

## 1.0.0 — 2026-11-04

### Added

- In a council's Discussion, every idea and reply a seat has sent now has **Copy** (its markdown, a table or list as the seat wrote it) and **Pin to Report** beside the thumbs when you point at it. The pinned message shows as the Report's **Final proposal** at its end, with Open in Discussion, Copy and Unpin, and it closes the saved document; a council with no summary shows it too.
- **Scan workflow**, a Start row in the palette when a project is active, scans the last 14 days of your runs for a correction or failure that came back in three or more of them, and opens an agent that proposes a small fix to the prompt or config behind each pattern, asks you which to apply and commits only those. A fix that belongs to another project is shown as text to copy, never applied. <!-- try: go:palette --> <!-- big -->
- **A council has a Memory tab, and a Chốt button to fill it**: the direction the seats read before the Report. Chốt an idea or a seat's message (the button beside like and dislike, or `p` on the idea under the cursor), or write the direction yourself; it is checked against what the seats agreed first, and one that clashes waits on the tab for you to Edit, Set anyway or Discard. After a round the check may suggest a new direction, with Show the messages it rests on. The tab keeps the chosen direction and what it replaced, and a change of direction marks the Report Outdated. <!-- big -->
- **A council's Ideas tab groups the ideas by where the seats stand**: Waiting on you, Agreed, Has doubts, Someone against it, No stance yet and Withdrawn, each under a header with its colour and a count, in the order they arrived. An idea moves group as a seat changes its stance; a withdrawn one says which round it left in, and one you cut says `cut by you`.
- **Close project…** in a project folder's right-click menu in the Agent tree closes every agent and terminal in it at once, after a confirm that says how many and how many are still working. Their conversations stay in Conversations, and the folder's councils and services stay.
- **Open asleep** in the right-click menu of a session in a project Overview's History and in the Agent tree's Conversations: the session comes back on the roster with its transcript and a box to wake it, and costs nothing until you Wake it or send a message. A codex session, which cannot sleep, still only resumes.
- In a council, a seat that cites part of a screenshot or a pasted image now marks it with a box, and the boxed part shows as an image with a red rectangle under the idea or reply, in the channel and the thread panel. A click opens the whole screenshot in Sources with the same box on it, and the council's saved document embeds the images. A box that does not fit the image is a Wrong cite, and in a checked claim a screenshot cited with no box counts as no evidence. <!-- big -->

### Changed

- A brainstorm whose agent judges the build small (a few files, no mockup to match) now offers a quick run at approve, where it always offered an orchestrator run; Change still opens the launcher to pick the other.
- An agent waiting on your answer now breathes amber over its whole row in the Agent tree, where only its glyph pulsed, so you see it from across the tree.
- Under critical memory pressure the heavy-job queue still starts one job at a time, where it held every job until you paused the queue, and the pause then let them all start at once.
- The heavy-job queue runs e2e and smoke checks one at a time even in Auto, where several agents' runs started together and pegged the CPU though the RAM fit; it also catches a check wrapped in `timeout`, `node scripts/smoke.mjs`, `npm run smoke`, `npx playwright test` and npm/pnpm scripts named e2e or smoke.
- An agent with three or more commands running in the background folds them behind a `3 running` chip on its row in the Agent tree; click it to list them. One or two still show as rows.
- In a council, a chat seat's chip in your message (`@82faafca`) opens that chat's terminal, as its name on a message does, and the message an answer's quote takes you back to rings for two seconds where it lands.
- A chat seat's button in a council's Seats list shows the agent mark and reads Go to <name>, where it showed a terminal icon; its name's hover says the same.
- A Vietnamese council's experts have short, everyday names that fit on their cards: UX, Đo RAM, Khách, Tìm bug, Thư ký, Giám khảo A / B, Biên tập, Tổng hợp, Thiết kế, Dev, Phản biện and Điều phối, where every name started with "Người". A council you already ran keeps its names.
- A council message with a web link (`https://…`) now lets the experts open that page with WebFetch, where they said they could not open it and read the repo instead; the link locks Let them read files on and names the site. A link in the council's question does the same for round 1.
- In a council's Discussion, the idea whose replies are open on the right wears a bright ring, where only its tint deepened and it barely stood out from its neighbours.
- In a council, an idea its author withdrew wears a Withdrawn badge and is drawn dim, its title struck in its thread, and the author's reply reads "withdrew it" with the reason it gave, where the thread only showed a bare "Withdrawn." reply.
- In a council, an author's change to its own idea reads "revised it", with the new title on a line of its own above its reason, where the reply ran "Retitled: <title>." into the reason as one English-prefixed paragraph.
- In a council's Discussion, an idea you unticked at the pause wears a Cut badge and is drawn dim, its title struck in its thread, as the Map already showed it; it looked like any other idea.
- A Vietnamese council's experts have short names that fit on their cards: Trải nghiệm, Canh RAM, Soi lỗi, Tổng hợp, Phản biện A, Thợ code, Cãi ngược and so on, where every name started with "Người". A council you already ran keeps its names.

### Fixed

- A brainstorm handed to a quick run now follows that run: the Agent tree and the Run step say it is working, blocked or done instead of "planning" forever, and Close the brainstorm appears once it is done.
- Clicking an idea in a council's Ideas rail no longer pushes the whole window up off its frame: only the discussion scrolls to the idea. Moving between ideas with j and k, and jumping back to a quoted question, scroll the same way.
- A run no longer waits for hours to start its next task while your computer is short of memory and another run is working: each run now keeps at least one worker going, and Jobs set to Off (or paused) stops runs waiting for memory too, as it already did for builds and tests.
- Pausing the heavy-job queue now pauses it on this computer only, where the pause synced through the vault and let every heavy job on your other computers start at once too.
- A canvas board whose page runs longer than its board size is now drawn whole, at its page's full height, where it showed a second scrollbar inside the board beside the canvas's own.
- A council that was stopped after it wrote its summary reads Done in the Agent tree and its header, where it read Stopped, even right after it answered a follow-up you asked.
- A chat seated in a council whose tab you closed comes back: open its conversation again (Resume, Open asleep, or click the seat's name, avatar or @ chip, which now opens it asleep) and Retry reaches it in its new tab, where Retry used to fail with "is gone" for good. A seat from before this keeps its conversation from its next turn, while its tab is still open.
- A council synced from your other computer opens a chat seat's conversation again when you click its name, avatar or @ chip, and Retry reaches it, where it said "Couldn't reopen the session: its conversation is no longer in Conversation History" because the seat named the session by the other computer's path.
- A council's progress bar no longer touches the Discussion tab's underline while the council runs.
- On a council's report, clicking Report scrolls down past the answer to the report itself, where it did nothing, and the Directions and Also raised links glide down to their section instead of jumping there.
- A council message long enough to wrap grows its box line by line, where the box stayed one line tall and cut off the first line as you typed.
- A run graph's task and Final verification details read in the app's own font: the worker, review, tokens, activity times and the Open in Agent button were drawn in the code font.
- More labels read in the app's own font instead of the code font: the brainstorm pane (question numbers, the check clock, topic and file names), the background task peek's title, state and tabs, Setup → Memory's line counts and file names, the @ file picker, the roles in the Claude account restart list, and the Brief's plan path, "just now" and field labels.

## 0.15.21 — 2026-11-03

### Added

- A failed final stage can be run again in the same round, for a failure outside the code (a service that was down, a tool that was not installed) once you have fixed it: **Rerun final stage** on the run sheet and in the Final verification pane, in the palette, or `wsh runs rerun-final <run>`. It spends no fix round, the lead is told to drop its fix plan, and a run held only by that failed stage lands by itself once the rerun passes.
- The Monitors and background shells an agent left running show in the Agent tree, one row under their agent with what the task reported and, for a Monitor with a timeout, how long is left. Click a row to peek at it: a Monitor has an Events tab that lists what it reported and an Output tab for its output file once it has one, a background shell has only the Output tab, which follows the file while it runs, Esc or a click outside closes the peek, and on Windows Stop ends a running task with two clicks. A task that ends or is stopped leaves the tree. <!-- big -->
- A message to the whole council now goes to the one seat (or two) best placed to answer it, not to every seat: your message names whom the router chose (hover it for why), Ask <seat> too has another seat weigh in, and `@all` asks everyone. Let them read files is Auto, On or Off, and in Auto the router decides for a message it takes.
- A council checks what its experts claim. Every idea, and every reply that takes a side, is labelled by arcterm, never by a model: **Ran** when a test the expert asked for ran and came out as they said, **Disproved** when it came out the other way, **Read code** when a `path:line` it cites holds up, **Guess** when it cites nothing that holds. A cite that does not hold shows as **Wrong cite** on its chip. An expert can ask for up to two tests (`go test`, `vitest` or `cargo test` on one package, file or test), which run in a throwaway copy of your project as it stands, never in your checkout, before the pause after round 1, and every expert reads the results in round 2. <!-- big -->
- A council has a **Map** tab beside Report and Discussion: a card per expert with what it is doing now and a bar of how many of its claims were run, disproved, read or guessed, and a table of who agrees with which idea, with each idea's label and how it ended. Click an idea to see each expert's reason. A seat's timeline of what it read, searched, ran and said opens from its card or from Seats. <!-- big -->
- **Resume** on a council the Agent sidebar no longer lists (ended over a day ago, or closed): it comes back to its project's folder for a day and opens on its Discussion, ready for your reply. Nothing runs until you send one. It sits beside Pin in the council's header and on its row in Councils.

### Changed

- In a council's Discussion, whom your message goes to is a row of seat chips at the top of its bubble instead of a `For …` line under it, and an `@UX` you typed is UX's chip; an answer that does not sit right under your message opens on a quote of it, which you click to go back to it.
- A chat seated in a council reads as its name and the key you @ it by (`notes · 0976023f`), so two chats of one project no longer share a name; click its name or avatar on a message to open its terminal, and hover it for its session's title.
- In the final stage a Check or Verify that exits 3 now reads as unverified, like the Final command, and the stage goes on instead of failing; at a merge point exit 3 still fails.
- The lead sends the leftovers inside the feature a run built (a defect, a doc that no longer matches it, a check a worker can write) to the fix round instead of a follow-up initiative; the run-finished wake says what counts as round work.
- Two runs at once start at most 8 workers between them, a run refills only to its share while another run waits, and new workers wait while the machine's memory pressure reads warn or critical (one still starts when none is live).
- While a task's commit is under review, another task starts in its slot at once instead of waiting for the review.
- Plan review flags a Setup, Check or Verify command, or a task step, that names a path a later task creates (a package pattern, a test file) unless that task is among its Depends, instead of every worker hitting a command that fails in its tree.
- Plan review checks the plan's claims about existing code (what a function calls, who calls it, what a test asserts) against the tree, so a false claim is a finding and not a worker stopping to ask the lead.
- A failed plan review no longer types up to ~10k characters into the lead's composer: the wake keeps whole findings up to a cap and names `wsh jarvis dag planreview findings`, which prints them all.
- A task wake tells the lead what failed (the review's first finding, the failure's first line, the first failing Verify line, the conflicted files) and ends on `wsh jarvis dag status <task>`, which now prints only that task; a worker-stopped task's wake no longer claims a spent retry.
- A project's councils sit in the Agent sidebar among its agents, with no Councils label of their own.
- `wsh council bench` now runs the council against a Claude Code agent team on two new cases, stops at a 50M token cap, and `wsh council bench results` says whether the team is a go.
- The Memory tab is made for a backlog of changes. Apply and Keep move on to the next change still to review, and `j` / `k` step through the table, `a` applies, `x` keeps and `u` undoes. Each labelled group of a split project has an Apply all (two clicks) that applies its open changes one at a time and shows its progress. The project list puts projects with changes to review first and draws a checked project with an empty index on one line; a change's kind is tinted by what it does (remove, bring in, edit in place), an empty size reads 0 KB, and a long path shortens its folder, not its file name.
- Check now in the Memory tab spins and reads Checking… while it runs, and a note says what the check found (Checked · N to review, Checked · nothing to review, or Check failed) for five seconds. The tab fades when you switch project or change, and its meters ease to their new width; with reduced motion on, nothing animates.
- The Diff, Code and File views draw the ligatures of the code font (`->`, `!=`, `=>` in JetBrains Mono, the default, and in Fira Code); Hack has none.
- A council's experts have plain names, in the language of your question: Ease of use, Memory watcher, Bug hunter, Summarizer, Final judge and Other side, or "Người lo trải nghiệm", "Người canh RAM", "Người soi lỗi" and so on for a Vietnamese question. The roles Setup suggests are named in that language too.
- A council expert's timeline: what it read, searched, ran (a verify command in mono, with whether it passed) and proposed, newest at the bottom. It opens in the Seats popover from a seat's Timeline button, a click on an expert's card in the Map, or a click on an expert's card while the experts first read.
- In a narrow pane (under 900 px) a council's Report, Discussion and Map tabs shrink to their icons, the word moving into the tooltip, and the Discussion's count stays beside its icon.
- A like or dislike you give a council expert's message shows as a Liked or Disliked chip under it, which a press takes back; the time and the two thumbs sit together at the right end of the message's byline and show on hover.
- An evidence chip that cites many lines of a file keeps the file's name and cuts the list of lines with an ellipsis (the tooltip holds all of them), where a long list used to push the name out.
- The questions Ask next offers in a council, and the replies a seat suggests in a thread, stay while you type; pressing one puts its text in the box in place of what you typed.
- The question at the top of a council's Discussion folds under its text: Show more sits beneath the question and its limits, the text grows to its full height and the rest of the limits fade in, and Show less folds it back. It stays still when you ask for reduced motion.
- Pin replaces a council's Close and Reopen: Pin (Pinned once pinned) in the Discussion header, the Report's tab bar, Councils and a project Overview's History keeps a council at the top of its project, running ones too. The tree now keeps only live, pinned, unread or recent councils, and Councils, which marks the pinned ones, lists every other. Close on an ended council's tree row (on hover, and in its right-click menu) takes it off the tree at once; Councils still lists it.
- A council's Discussion keeps its chat and puts its ideas in a quiet rail beside it: one entry per idea with its number, author, title and a line of its replies and stances. A click scrolls the chat to that idea, an idea's replies open its thread on the rail's second tab, and the rail folds away.
- A council's Report says Outdated only when a new idea came, an idea was revised or an expert changed their stance since the summary, and names what changed; other replies only add "N replies since" under it.
- A council's minutes count the time it ran, not the clock since it started, so a council chatted in the next day no longer reads hundreds of minutes.
- A council's Discussion keeps the replies on an idea in that idea's thread, where each one also showed in the channel: the channel holds the ideas, your messages to the whole council and the answers to them, and an idea's reply chip opens its thread.
- A run started from a spec (Build … as specified in …, as a brainstorm starts it) no longer stops for your Plan review click after the plan's second review: the lead carries the findings into the tasks and goes on, and asks you only about a finding that would change what the spec decided.
- An app's page header on the Agent surface is tidier: Back, Forward, Reload and Home show only while the page does, and Restart moved into a ⋯ menu beside Stop (with Keep running and Pin), so its arrow no longer sits next to Reload's.
- A message to the whole council that needs no expert, such as a greeting, thanks or an ok, is answered by the router itself at once, with Ask <seat> too under it to bring a seat in; the router also picks a seat faster than before.

### Fixed

- A council seat's failure line (a usage limit, an error) sits under the message it failed on, with its Retry, instead of at the bottom under every message sent after it, where it read as the newest message's failure.
- A Claude session begun on another computer and synced over now lists under this computer's copy of its project, in the Overview's History and Activity and in Conversation History, and resumes there, instead of under the other computer's path.
- A final step that something outside killed holds the land but asks for a rerun, not a fix round, since it judged nothing; a base Check that timed out or was killed no longer lets the run's own Check failures pass as shared.
- The lead fixes every failing final step, one already failing on the base included, instead of reading the run-finished exemptions into it and leaving the land held.
- A skip, retry, escalate or stop that cannot finish no longer cancels the whole dag: the task shows failed (worker-stopped), the other workers go on and the lead is woken.
- Cancelling one worker's run by hand fails its task and leaves the dag and its other workers going.
- A plan started with a spec leaves no untracked copy of it in the checkout, so the land no longer holds on a draft there; an autonomous lead writes its spec inside its own tree.
- A spec git ignores, such as one under `.superpowers/`, is refused up front with the folder to use (`docs/superpowers/specs/`), instead of failing at submit after the lead planned the run.
- A task whose tree's folder an editor or shell holds no longer fails every dispatch, retry-cleanup and skip: it runs in a fresh folder beside the old one, which shows as the task's cleanup debt until it can be deleted.
- A plan's Setup or Verify that runs through a shim on PATH, such as corepack's pnpm, runs on Windows instead of failing with a node path on the wrong drive.
- After the app quits mid-dispatch, the runs a tick had started but never recorded are cancelled at the next start instead of reading executing forever.
- Closing the tab of a quick run's worker, or of an orchestrator lead before its plan, fails the run with a "tab was closed" reason instead of leaving it executing, and Resume restarts that worker in a new tab.
- A lead that fixes a failed merge Verify in the run's tree and runs `dag merge --continue` without committing is told to commit first, instead of Verify passing on a fix the land then deletes; a land with uncommitted changes in that tree holds, naming the files, instead of merging without them.
- A run whose project is a subfolder of its repo lands when its spec or plan also sits untracked in the checkout, instead of holding with git's "would overwrite untracked files".
- `dag merge --continue` over a squash the lead threw away, or a resolution it committed itself, is refused with the way out instead of marking the task merged on the wrong commit or without its Arc trailers; the card and the lead's rules say to `git add` the resolution without committing.
- A merge Verify that times out or is killed is no longer bisected, and its wake says so; a bisect step that times out stops the bisect instead of blaming its tip; and a failure only the landing tree shows lands every lane with the failure listed as a flaky item for the final stage.
- Retrying a task that already merged, holds a merge conflict, or has a Verify running or failed is refused with the command to use instead, rather than running a second attempt whose commit never merges or letting later merges land on a failing commit.
- `wsh jarvis dag escalate` on a task whose merge conflicted is refused with `dag merge <task> --continue`, instead of starting a fresh worker and leaving the conflicted squash holding later merges.
- A worker that alternates a tool-call error with a failed spawn reaches the lead after three failures in a row, instead of being retried forever; a retry of your own gives it a fresh count.
- A council report's title (what it was about) no longer looks the same as its answer: the title is smaller and quieter, so the answer is the one bold line on the cover.
- The box under a sleeping agent's conversation (and the other message boxes) no longer shows a sideways and an up-down scrollbar when the app is zoomed in, and a message of two lines or more no longer gets a scrollbar it does not need.
- A run that finished and landed with one task still failed no longer reads Cancelled in its Conversations group or a brainstorm's Run step, and `wsh runs show` says its plan was closed when the run ended instead of `status=cancelled`.
- Deleting a session you just closed now says it was written to seconds ago and how long to wait, instead of "still running … stop it first"; a session a tab still holds says so on its own.
- A council question that names an `.astro`, `.vue` or `.svelte` file turns on Let them read files by itself, like any other source file.
- A council file synced in from another machine shows in the tree and in Councils on its own, without waiting for another council to change.
- The app zoom you set with Ctrl+= / Ctrl+- is kept: arcterm opens at the same size after a restart or a reinstall.
- A run you landed with Land anyway after its final check failed reads Landed in the Agent tree and the Brief, not Cancelled.
- A council with a long question keeps its status chip readable in the Discussion and Map headers: the title shortens first, where the chip used to be cut to its first letter.
- In a project's Overview, a run's diamond in History is no longer cut off on its left, and a Branches row with long branch names shortens them instead of spilling over the History column.
- Starting a run in a project that is one folder of a large repo no longer fails and cancels itself while its tree checks out: the run's trees check out only that folder, and a tree that still takes long finishes in the background while the run waits for it.
- A council message that a seat failed to answer, because of a usage limit or a failed call, now says so under it (`New user could not answer: …`), where it used to read as answered with no reply.
- New agent (⌘N or Ctrl+N, the app bar's New, the palette) opened from a project's Overview starts on that project, where it started on the project of the agent last in focus.
- The Transcript tab's Compactions button no longer leaves the compaction marker hidden behind the pinned prompt on a long conversation.
- A run's timeline reads "Started from the queue", "Land in line" and "Resolving conflicts with the base" again, where it showed the raw event names.
- A council message that cites a screenshot shows it as one chip with an image icon, cut short with the full name on hover, where a long name spilled out of its chip.
- An `.svg` opened in Code (or the File tab) draws, where it showed "Cannot show this image".
- On Windows the Float window keeps its size from one float to the next, where it grew a little each time, and the window you leave Float to no longer grows either.
- Sprout stands on the Float window's ledge when you enter Float, where it could rest half above it until something moved it.
- A council's Report has the Close and Reopen button too, at the end of its tab bar: a closed council opened from Councils lands on its Report, where you could only reopen it from the Discussion tab.

## 0.15.20 — 2026-11-02

### Changed

- A council's chat reads more like a messenger. Your own messages have no name line above them (the time shows on
  hover), and under the newest one Sent turns to Seen, with the small avatars of the seats on it, a second after you
  send; only then do their typing bubbles of three rising dots appear, in place of the "… is writing" line. A seat's
  reply names its stance only when it takes one, with its time on hover, and "For …" shows only when your message goes
  to someone other than the usual seats.
- A council's reply box sends from a round button with a send icon, in a box whose corners follow it, as a messenger's
  does. The tooltip still names Reply or Send and Enter.
- A council's Discussion header shows its seats as one stack of avatars instead of a row that cut a seat in half on a
  narrow pane: hover or click it for the list of every seat, with what each is doing and its message count, and pick
  one to see only its messages. Close is now an X (Reopen an arrow).
- A council's report now reads like one: a cover holds the question, the answer and the council at a glance (its
  state, experts, time and tokens, who did what, the saved document), the ideas worth trying are cards with their
  first step, and a click on one opens why it was picked and who weighed in under them. Report and Discussion are two
  tabs instead of a Show the discussion button, and the Discussion's seats sit in its one-row header, so the chat gets
  the height. <!-- try: go:councils -->
- In the New dialog, typing a letter in the Project or Session column now starts the task, as it does in the Start
  column: focus jumps to the Task (or Goal) box with the letter in it, instead of filtering the list. Digits and the
  arrows still pick a project or a session. Only a pick with no Task box (a terminal, a tool, a council, a run from a
  plan file) still filters the projects as you type, and the Session column no longer searches older sessions.
  <!-- try: new-agent -->
- A closed council no longer stays in the Agent tree under a Closed councils fold: it leaves the tree. Every council,
  closed ones too, is in the new Councils list at the top of the Agent sidebar (under Canvas gallery, or `Ctrl+G` `o`),
  newest first by Today, Yesterday and Earlier, with a search; open one there and Reopen puts it back in the tree.
  <!-- try: go:councils -->
- The jump buttons are now just their arrows: a council's Top, Back and Latest (↑ ↩ ↓), and the Latest button (↓) in
  an agent's transcript; hover one to see what it does.

### Added

- A seat's answer in a council thread suggests two or three replies you might send next, as chips over the thread's
  box: a click puts one in the box to edit and send.
- Like or dislike a council's messages: 👍 and 👎 sit under every idea, and in the line over each seat's reply when
  you hover it. The seats read what you liked and disliked in their next turns and the summary weighs it as your own
  view, so you can steer the discussion without typing; press the same thumb again to take it back.
- A council that already exists, running or done, can take a live claude or pi chat into it: type `@` in its message
  box, pick the chat under Add a live chat (its short id, title, project and how much context it holds are listed) and
  send. The chat joins the council, answers that message from its own context, and stays a seat.
- A council's message boxes, the channel's and an idea's thread, take images and files: paste or drop an image and it
  waits as a thumbnail above the text, and type `@` then a few letters of a project file to name it. The seats that
  answer read what you attached, and your message shows the image as a thumbnail and each file as a chip you can open.
- When two or more council seats failed, the seat strip offers Retry all: pick a model beside each failed seat (its own
  by default), and they all run again together instead of one Retry refusing the next while the first runs.
- An agent can pick the experts' models when it starts a council for you: `wsh council start --model sonnet`, or
  `--model skeptic=opus` for one seat, and `wsh council retry --all` reruns every failed seat at once.
- An agent you ask for a council on named chats now seats those chats in it, beside a Skeptic and a coordinator, and
  the council runs to the report without holding drafts for you to send: `wsh council start --agent <tab id>`, and
  `--agent self` for the chat that asks.
- A project folder in the Agent sidebar shows on its icon how many of Jarvis's waiting items (a gate, a run to confirm
  or land, an escalation) are that project's.
- Jarvis has a Councils region under Runs: every council still at work across your projects, and the ones that ended
  this week, with the ones waiting on you first. A row opens the council, on its report once it has one.
- Right-click a project folder in the Agent sidebar → New agent… opens the New dialog with that project already
  picked.
- A project can run on a Claude account of its own: Settings → Agents → Claude account → + Project account. Agents
  and terminals opened in that project use its account, and so do a council, a Radar audit or a background AI call
  run in its folder; every other project keeps using the checked one, and the New dialog's footer names the account a
  launch will use.
- A project's History list opens a menu on right-click: a session can open its transcript, resume, copy its title or
  transcript path, or be deleted; a run or a council can be opened or have its title copied. Each session row also
  names its model.
- A council call that failed can be retried on another model: Retry with… beside Retry picks opus, Opus 4.8, sonnet,
  fable or haiku for that one call, the seat keeps its own model, and the saved document notes the retry. A call
  Claude's safeguards flagged offers Opus 4.8 first, the model Claude Code itself falls back to.
- A council call Claude's safeguards flag runs again once on Opus 4.8 by itself, as Claude Code does, so a flagged
  summary no longer fails the council; the saved document notes it. An agent can retry a failed council call too:
  `wsh council retry <id> [--expert <seat>] [--model <model>]`.
- Jarvis can stay put: pin it from its panel, or from Settings → Jarvis, for an hour, four hours or until you let it
  roam again, and it now roams at a calmer pace for everyone.
- A council's Discussion has Top and Latest buttons in the channel's bottom right corner, and after either jump a
  Back to where you were button that puts the message you were reading back where it was.
- Translate offers what you just copied: a word or a short sentence shows as a Paste chip under the box, and a click
  or Tab pastes and translates it. Links, paths, file names, commands, code, numbers and images are never offered. On a
  Mac, macOS may ask whether arcterm can paste from other apps. <!-- try: translate -->
- A council's experts can put a small table, a numbered list or a flowchart in an idea or a reply when it reads
  better than sentences, and the Discussion and the report draw it as one, a table with its copy button. Councils
  started before this update have none.
- A council's experts now mark the one or two sentences you must read in a long idea or reply, and the Discussion
  and the report draw them highlighted, as your terminal does. Councils started before this update have no marks.
- A council's report ends with two or three questions worth asking the panel next: where the experts still disagree,
  a condition nobody checked, or a view the panel was missing. They sit as chips under the newest message in the
  Discussion and under Ask next in the report; a click puts the question in the box, with `@` the expert it is for, to
  edit and send. Councils started before this update have none until you Summarize again.
- Typing `@` in New agent's Task box lists the project's files; ↑↓ and Enter (or a click) put `@path` in the task,
  and Esc closes the list without closing the dialog. <!-- try: new-agent -->
- Council Setup's Auto-generate button writes the topic, a question and the mode from what the seated agents were
  talking about. It asks before replacing text you already wrote.
- A table in a Markdown Preview or an agent's reply has a copy button on its corner when you point at it: it pastes
  into Sheets, Excel, Numbers, Notion or Docs as a table with real cells and a border round each, not as `| a | b |`
  text.
- Drop files or folders from Finder or Explorer onto the agent panel's Files tree to copy them into the folder under
  the pointer (onto a file: its folder; onto empty space: the project root). The originals stay where they are, and a
  name already taken becomes `name (1)`, `name (2)`…
- Translate keeps a history: with the box empty, the panel lists what you translated last, newest first. A click on a
  row translates it again, ☆ stars a word you want to learn (Starred lists only those, and they stay however long the
  history grows), and × removes a row. Speaker buttons read the text and the translation aloud in your system's voice.
  <!-- try: translate -->

### Changed

- A council's message box is more compact: Let them read files and the cost line share one row under it, and the
  channel's Top, Back and Latest buttons sit side by side with shorter labels.
- A council in the Agent sidebar now reads like a group chat in a chat list: two of its seats as overlapping circles
  (a green dot while one writes, a red one when a call failed), its title, and under it its state and how long ago
  its last message came.
- A council's message box now lines up with the messages above it instead of running the full width, and a message
  you send rises into the chat from the box.
- Once a brainstorm's Approve starts its run, the agent that ran the brainstorm goes to sleep 15 seconds after it
  records the run, freeing its RAM; Wake or any message brings it back. It stays awake when Sleep idle agents is off.
- A sleeping agent's side panel no longer offers a Transcript tab: its conversation already fills the terminal's place, and the tab comes back when it wakes.
- A run or council in a project's History names its kind on its second line, so its title lines up with the sessions'.
- Tables in agent messages, notes and councils wrap their cells to fit, instead of scrolling sideways.
- The must-read sentence highlighted in a message is yellow, so it shows on a blue bubble too.
- A council's seat filters are short, flat buttons instead of long coloured pills: a seat at work shows only its dot,
  and what it is doing is on hover.
- A brainstorming agent's Builder check and Judge rows fold into a small chip on its row once they have answered, with a
  mark per check; click the chip to show them again. They stay open while one is still reading or asks you.
- A brainstorm mockup's thumbnail opens the board full size when you click it, not only from its Open full size link.
- An ended council's × in the Agent tree now closes it instead of deleting it: it folds into its project's Closed
  councils, where Reopen brings it back (a retry or a reply reopens it too). Remove council… on its right-click menu
  still deletes one for good, into ~/.arc/trash, and `wsh council close` / `wsh council close --reopen` do the same.
- A brainstorm's boards now sit in a resizable right rail beside the question instead of small thumbnails in it: drag
  the rail wider and they lie side by side, each headed by its option and lit with it when you point at either, and a
  click opens a board large in the rail while the question stays on screen, with marking still there.
- A council's header fits on one line: the mode leads, a long question shortens to fit instead of pushing the status
  onto a second row, and Top, Latest and Back in its discussion glide to their place instead of jumping.
- New dialog: a session picked to resume is forgotten once the dialog has been closed for 30 seconds, not two minutes.
- A council message you send to several experts is answered by one of them first; the others read that answer and add
  only what their own angle brings, or show as "agrees" under it, instead of each opening with the same "you're right".
  It takes a little longer, one answer before the rest.
- A council follow-up that names a file or a path (`rail-apps.json`, `pkg/services/idle.go`) turns Let them read files
  on by itself and says which file it saw; one that names none answers from the discussion, which costs about a fifth.
  Flip the switch to choose for yourself. The experts answering a follow-up now also see the report, so "direction 2"
  in your question means the report's second one.
- A council's experts talk to each other as "you" (bạn) in their replies instead of calling out a role name ("Phương
  pháp ơi").
- The New dialog opens in its Task box, now at the top above the columns: type what the agent should do and press Enter
  to start it (Shift+Enter for a new line). Alt+1–9 picks another agent without leaving the box; a run opens in its
  Goal the same way. <!-- try: new-agent -->
- A file open in an agent's File tab updates by itself when it changes on disk, as an agent edits it, and Preview and
  Source keep your place. Before, only a background task's Live output did.
- A project folder in the Agent sidebar folds from its folder icon as well as its chevron; a click on its name still
  opens the project's Overview.
- A council's chat shows when each message came as the time of day (`14:32`); hover it for the date and how far into
  the council it came. Before, `1:16` was the time since the council started and read like a clock.
- The files a council message cites are a small chip each, its lines after it (`huong_harness.md:65`), in place of a
  chip per line with the whole path; past two, the rest fold into `+N files`. Hover one for the path. A click opens
  Sources on the right: the cited lines lit, a line each side, the message's other files above, and Open in Code. Esc
  goes back to the thread.
- A council's report keeps its facts in a column beside it that stays in view as you scroll: the state and cost, an
  outline of the report (a click jumps to a part; the one you are reading is grey), each expert with its model and what
  it did, and the saved document. Click an expert to see only their ideas and replies in the Discussion, each reply
  naming the idea it is on; Show everyone brings the rest back. The header keeps only the title and its actions.
- A council reads at the size a brainstorm does: its report, Discussion, Setup and Sources step up a size, and the
  report's answer is set larger as the headline it is.
- A council's Discussion reads as a chat: each expert's ideas and replies sit in bubbles tinted their colour, and the
  avatars carry two letters (ĐV, KT) that tell apart seats whose names start alike. Your question sits on the right,
  folded to three lines with its limits as chips. The seats at the top are filters, each with how many messages it
  wrote, and a thread slides in from the right. The report folds what you asked into a card that opens on the whole
  question and the limits you set.
- A council's experts write their ideas and replies like chat messages to you: short, friendly sentences with the point
  first, in place of dense report prose. Councils started before this update keep the old wording.
- A council's Discussion reads as a group chat: once a round is over, the experts' ideas take turns instead of coming
  as one expert's block after another, and every reply sits in the chat under a quote of the idea it answers, the
  replies to one idea together. An idea is its message alone, with no title over it; the thread still gathers each
  idea's replies.

### Fixed

- A reply you send in a council's thread or channel scrolls into view, wherever you had scrolled to, and a thread you
  are reading at its end keeps up with the seats' new replies instead of leaving them below the fold.
- Translate keeps working when Google turns it away ("429 Too Many Requests") or cannot be reached: on a Mac, Apple
  Translation answers on the device instead (macOS 26 or later, with the language pair downloaded in System Settings →
  General → Language & Region → Translation Languages; it adds no phonetics or word classes). After a 429, arcterm
  leaves Google alone for a few minutes instead of asking again on every edit, and the error says until when.
  <!-- try: translate -->
- The New project search no longer matches every folder when you type your user name: it reads paths from `~`, and
  lists the folders whose name matches before the ones that match only by path.
- A running task's mark in a run's graph sits back in the middle of its pulsing ring, and every task's mark lines up
  with its title again, instead of sitting a few pixels low.
- A brainstorm's Approve stays off while the run it started is still starting, with "The run is starting" beside it,
  so pressing it again in the minute before the agent records the run no longer starts the same run twice.
- A brainstorm's "What you handed over" list keeps its text readable: where each decision came from now sits under the
  text instead of in a column of its own that squeezed it to one word a line.
- The counts beside the Agent panel's tabs scroll sideways with the mouse wheel when the panel is too narrow for them
  all, with a fade on the edge that hides some, instead of the last ones being cut off out of reach.
- A brainstorm whose design waits on you to confirm the agent's guesses now pulses its agent and says "confirm N
  decisions" in the tree, as an open question does, instead of reading "in progress".
- A run started from a brainstorm now shows in History by its feature ("Build …"), with its spec's file name on the
  line under it, instead of a title cut off halfway through the spec's full path.
- In a council, when you ask everyone something, the experts who answer after the first one no longer open with the
  same "Right, agreed…" and repeat its point: they add only what is new, or show as agreeing.
- A council an agent starts inside a project registered at a repo's subfolder (such as `apps/website`) now shows
  under that project in the Agent tree, instead of nowhere.
- A council expert whose answer breaks a line inside its JSON no longer fails with "invalid character '\n' in string
  literal": the answer is read as written.
- Resuming a conversation again while its tab is still loading says the agent is still starting, instead of "already
  open" over an empty terminal.
- Starting a run no longer fails over and over with "Selected route is unavailable" when the list of installed agents
  had not loaded: arcterm loads it again and starts the run on the project's route.
- On a brainstorm board opened large in the rail, `[` `]` and ← → step through its boards as on an agent's canvas, instead of
  switching to another surface or another agent. While any canvas is shown, ← → never jump to another agent: when its
  board is loading, unreachable or being marked they do nothing.
- A council's Summary failed panel has a close button; it comes back only when the summary fails again, and the
  Coordinator's Retry stays in the strip above.
- While the brainstorm judge weighs a question's approaches, an approach's facts open from a clear button set apart
  from the row, so reading them no longer risks answering by mistake, and Show all facts opens every approach's facts
  at once.
- A council's message box holds its one line level with the Send or Reply button, not low at the foot of the
  box.
- A finished council you left on its Discussion opens there again from its row in the Agent sidebar, instead of on
  the report; a council with a newer summary still opens on the report.
- A council's message box no longer shows a scrollbar over its hint while it holds one line.
- A council's chat, its open thread and its Summary keep your place: leaving for another council, the Summary, another
  agent or another surface and coming back lands where you were reading, not at the newest message or the top.
- In New agent, Tab from the Task box goes to the Project column, then the sessions, Cancel and Launch, and round to
  the box again. It no longer stops at + Flag, Worktree, Command or the Agent column: Alt+1–9 (Option on a Mac) picks
  the agent from the box.
- On a Mac, agents no longer show `?` with no model or title, and hook errors in every turn, when macOS has started
  killing arcterm's helper (`~/.arc/bin/wsh`): arcterm replaces a copy that no longer runs within seconds, mid-session
  too, not only when it opens.
- A heavy command a Claude agent runs in the background (a typecheck, a build) waits its turn in the Jobs queue like
  one it runs in the foreground. Before, it let go of its place at once, so two or three agents could each start a
  3 GB typecheck at the same time and push the Mac into swap.
- The Agent badge no longer counts a brainstorm's Judge and Builder check sessions as unread: their answer goes to the
  brainstorming agent, so the badge had a number no row in the tree showed.
- Images in a Markdown Preview (the File tab, Code) show: a figure on disk beside the file, PNG, SVG or any other,
  drew as `[img]` or an empty box with only its caption.
- On a Mac, a pinned app keeps the settings it saves in its page (a dark mode, filters) when arcterm restarts. Before,
  it opened with none of them each time, though the same app in a browser kept them.
- A sleeping agent's conversation, a finished run worker's, and one opened in Conversation History come back where you
  left off when you switch away and back, instead of jumping to the last message. One read to the end still opens at
  the end.
- A canvas's toolbar no longer draws its text on top of itself when you zoom in (Cmd +) or the pane is narrow: the
  "updated … ago" line gives way first, then the topic and the board tabs shorten with `…`, and the buttons stay
  whole.

## 0.15.19 — 2026-10-30

### Added

- **Who wrote this line**: the Code surface's Blame button (or `b`) opens a column beside the editor with each
  block's commit, its age and, when a run landed it, that run's goal. A click opens the run, or copies the sha.
- The Code surface's diff (`d`) now steps from `HEAD` to the branch base (everything this branch changed in the file)
  and then off; the diff header says which one you are looking at.
- A run's task reviewer is now shown every check a Claude worker loosened (a skipped or deleted test, a rewritten
  expected value, `--no-verify`) and must pass or fail each one; outside a run, Claude is told so it says so in its
  reply.
- **Live agents in a council, and a council that reads as a chat**: a council can seat your running claude and pi
  agents beside its role experts, each answering from its own session, and every answer waits for you as a draft to
  send to the others, edit or drop. The discussion of every council is now a chat: each idea is a message in a channel
  with a reply chip that opens its thread on the right, and j / k, Enter and Esc move over the ideas, open a thread
  and close it. <!-- big -->
- **Translate**: a button above Setup on the nav rail, or Ctrl+Shift+D (⌘⇧D on a Mac), opens a small panel beside the
  rail. Type or paste text and its translation shows below, from English to Vietnamese or any other pair (⇄ swaps them,
  and Detect language reads the source for you), with the phonetic and word classes for a single word. Nothing needs
  installing, and the text stays when you close the panel. <!-- try: translate -->
- A Markdown or HTML file's Preview in an agent's File tab has a Back to the top button in its header, beside the
  outline.
- A Claude agent with a large context (100k tokens or more) is compacted while its prompt cache is still warm: just
  before it sleeps, and, when it stays awake, once it has sat idle with 5 minutes of cache left. Waking it later reads
  the summary instead of re-reading the whole conversation at twice the input price. Sleep on such an agent compacts
  it first and puts it to sleep once the summary lands. Settings → Agents → Sleep idle agents turns it off or moves
  the threshold.
- Right-clicking a council in the Agent tree offers Copy id, a running council's too, so `wsh council show <id>` and
  the other council commands no longer need the id typed out.
- A brainstorm question says over its answers whether you pick one or more. When the answers can be combined, each row
  has a tick box: tick several and Send gives them to the agent together, while clicking a row still sends it alone.
  Every approach in the judge's list now has its letter, the fifth and later ones included.
- Read back a whole conversation beside the terminal: the Transcript tab on the agent's panel (Ctrl+Shift+F, ⌘⇧F on a
  Mac, from anywhere on Agent) draws it as the sleeping view does, loads the earlier part as you scroll up, and keeps up
  with what the agent writes while you read. Its Compactions button steps back through each compaction, so what a
  compaction dropped from the terminal can be read again. Esc returns to the terminal.
- A project's Overview has a Branches card: the newest commits of every branch drawn over the commit graph, with your
  uncommitted changes on top.

### Changed

- A plan review's first round runs two independent reviewers instead of five, for about the same findings at a
  lower cost, and engine sessions use a 5-minute prompt cache instead of an hour.
- A run started with `wsh runs start` from inside a linked worktree branches from that worktree and lands back into
  it, instead of the main checkout.
- Motion: the palette's scope underline slides between tabs, a DAG task settles when it finishes, live timeline rows
  fade in, Jarvis's reply shows a flow bar while it thinks (and can be dismissed), and a failed copy now reads
  "Copy failed".
- Brainstorm part rows are roomier, and the question and working views sit a third of the way down the pane.
- arcterm's log (`waveapp.log`) is about 98% smaller: routine connection and call lines are gone, errors stay.
- Close the brainstorm, once its run has merged, now also ends the agent that brainstormed it (unless it is still at
  work), and keeps the design canvas in the Canvas gallery instead of deleting it.
- A project's Overview fills the centre pane: Now and the Branches card sit in a column beside History, which loads
  more sessions as you scroll.
- A click on a project's folder in the Agent sidebar opens its Overview; the chevron before it folds and unfolds the
  folder.
- When an agent offers you options that differ in UI, in a brainstorm or a plain chat, it draws each one as its own
  board on a canvas beside its terminal (Option A, Option B…) instead of ASCII boxes, and asks first before drawing
  a mockup only a few lines tall. In a brainstorm the boards sit beside the question in the options' order; after you
  pick, the boards you passed over move out of the canvas into an `unchosen/` folder, so a run only builds the one you
  chose.
- In a float, the Translate tab shows the Translate panel over the terminal (Ctrl+Shift+D opens it there too) instead of
  opening translate-shell, so it works without installing anything. A translate-shell terminal opened from Setup →
  Tools is an ordinary tab in the float.
- Start run in the New dialog no longer holds the dialog on "Starting…" while the run is created: the dialog closes at
  once and the run shows as a Starting row in its project's folder in the Agent tree until its lead takes its place.
  The row's × cancels it; a start that fails stays as a Failed row with Try again and Dismiss.
- A project's Overview shows a year of activity as a calendar in your theme's colour, and its History lists each
  session with the runs and councils it started under it. The Run and Council buttons are gone from its header: an
  agent session starts those.
- A council in a project Overview's History is named as in the Agent tree, and a click unfolds it in place (its
  question, answer and top directions) instead of leaving the Overview: Open council takes you to it.
- The Token burn card lists each subagent an agent wants to start, with the model it will run on and its task. A
  subagent given no model says so and names the one it falls back to: this session's (an Explore with no model runs
  on Opus when the session does). The estimate now says it comes from finished subagents.
- The Token burn card (and an Antigravity question that holds its agent) always pops up as a dialog, over the agent's
  own terminal too, instead of sitting above the terminal. Later hides it and leaves a one-line strip above the
  terminal whose Answer brings it back.
- The Token burn card's "about" figure is what a subagent of that type usually costs (the median), about a third of
  the average it showed before, which a few very big subagents pulled up; the share of the 5-hour window and the 10%
  check still go by the average.
- Jarvis's Waiting on you opens the rows past its first three with "+2 more" (the count it hides) and folds them with
  "Show less", as the other regions do, instead of "Show all 5", which read like a cap of five.
- The how-to hint at the top of a brainstorm is one slim row instead of a four-line card, so the question sits higher.
- The New dialog is quieter: a past session is one line (its title and how long ago), the command folds under
  Command ›, and Project lists names only (the folder is in the tooltip). <!-- try: new-agent -->
- A council review reads like a brainstorm: at most three directions, each with a first step, and the rest under Also
  raised, one line each, with wording-only fixes kept out of the top three. A review used to list every direction as a
  long paragraph.

### Fixed

- A run that ended while its DAG was blocked or finalizing no longer leaves that DAG stuck (and retrying every 30
  seconds).
- The cache-miss notice no longer covers a survey above the prompt.
- A run held because the checkout was in the middle of a merge, rebase or cherry-pick now lands by itself once
  that operation is finished or aborted, instead of waiting for you to land it by hand.
- A run's lead or worker you open for the first time after it has been working no longer shows its terminal
  garbled, two frames of different widths over each other. Its output now replays at the size it was drawn at.
- While the brainstorm judge weighs a question's approaches, an approach's "N facts" opens the facts under its row.
  Before, only the count showed, and clicking the row sent the approach as your answer.
- A run's route takes a pi model from a provider whose own ids carry an org, such as
  `river/deepseek-ai/DeepSeek-V4.1-Flash`. Before, the route was refused as the wrong namespace.
- In Jarvis, opening an initiative's panel no longer shades every agent row under Runs as if it were the one open.
- A message typed under a sleeping agent stays in its box while the agent wakes, even if you open another agent and
  come back. Before, the box came back empty, so the message read as lost, though it still reached the agent.
- Vietnamese in the Hack and Fira Code fonts no longer breaks apart: letters such as ả, ị and ở drew with a gap after
  them ("ả nh"), in monospace labels and in the terminal. They now come from JetBrains Mono at the same width.
- Closing a brainstorming agent closes its builder check and its judge with it. Before, they kept reading in tabs of
  their own, and stayed in the Agent tree after the agent was gone.
- A brainstorm's earlier judge or builder check no longer turns up as a separate session in the Agent tree when the
  agent asks for a new one: the earlier one's tab closes as the new one starts.
- A brainstorm whose agent was put to sleep keeps showing the brainstorm instead of "exited with code 1 · Resume in a
  new agent": Wake above it brings the same agent back, and answering in the pane wakes it with your answer.
- An agent's Files tab lists the files of a folder that is not a git repository, as Code does, leaving out
  node_modules, build output and dot-folders. Before, the files flashed up and gave way to a "Not a git repository"
  note.
- A canvas board no longer flickers between two sizes (86% and 87%) when the pane's width shifts by a few pixels: the
  board shrinks at once when the pane narrows, and grows again only once it widens by more than a little.
- The summary under a Compacted divider reads as formatted markdown from its first section. Before, its opening ran
  into one raw block with the `<system-reminder>` tags showing, and it ended with Claude Code's instructions to the
  model.

## 0.15.18 — 2026-10-27

### Added

- Brainstorm mode: an agent's brainstorm opens beside its terminal, one question at a time, with a blind judge for
  approach questions and a builder check before you approve the run. Ask an agent to brainstorm a feature and its
  Brainstorm switch appears; Approve opens New run with the design attached. <!-- try: new-agent --> <!-- big -->
  <!-- shot: 0.15.18-brainstorm.webp -->
- A file an agent names without its folder ("It's in docs/slide/ as Deck.pptx") is a link again: Ctrl+click finds
  it in a folder named on the lines around it.
- A deck, a sheet or a video an agent links to opens: the File panel, which shows only text, PDFs and images, now
  offers Open (in PowerPoint, Excel or the file's own app) and Show in Explorer instead of a dead end.
- Remove a council you are done with: hover its row in the Agent tree and click ×, right-click it, or click Remove in
  its header. A council that is running or waits on you has to be stopped first; the document it saved stays.
- Right-click a project's folder in the Agent tree and pick Open overview: one page with what in the project waits on
  you, what is running in it, and buttons to start an agent, a terminal, a run or a council there.
- Right-click an app in the Agent tree and pick Hide (Stop and hide while it runs) to take its row out of the tree;
  it comes back when it starts again, and Setup → Tools still lists it.
- **Brainstorm**: a council has a second mode beside Review. Ask it about a problem or a goal and its experts offer
  ideas, build on each other's and keep the wild ones aside; the report ranks up to three ideas worth trying, each with
  a first step. arcterm picks the mode from your question, and the chip in New council flips it. <!-- try: new-council --> <!-- big -->
  <!-- shot: 0.15.18-council-brainstorm.webp -->
- Every finished council is saved in its project as `docs/council/<date>-<feature>.md` with its whole discussion, and
  the report shows the path and opens the file.
- An agent starts a council when the conversation holds a real open question (two directions weighed and neither won,
  a spec or plan just written), and at once when you ask for one; it sums the report up in the chat when the council
  ends.
- A finished council's report asks "Was this useful?" with Useful and Not really; the answer can be changed later,
  and the council benchmark counts it beside its own scores.
- `wsh council bench` runs the council benchmark: each case with a solo agent and with a council, one at a time, and a
  judge scores every report against the case's key. It prices the plan and asks the Token burn card once before it
  starts; `wsh council bench results` prints the scores per version of the council's prompts and models, and
  `wsh council bench stop` ends a run early. What it runs never shows in the app or in the project.

### Changed

- Ideas are gone, since Brainstorm mode replaces them: an agent's rail has no Ideas count or section, selecting text in
  a terminal no longer offers **Add as idea** (`Ctrl+Shift+I` does nothing), `wsh idea` and the `/idea` command are
  removed, and a council keeps its directions in its report rather than adding them to Ideas. The idea files already
  saved stay on disk, unread.
- A project's Overview has a History column beside what needs you: its sessions, councils and runs of the last 7
  days, searchable with /, and the agents that finished a turn you have not read. Running now lists the project's
  runs, their workers counted as the Agent tree counts them, and three or more items of one kind in Needs you fold
  into one row.
- An agent's right-click menu has **Copy id** in place of Copy @mention: it copies the bare id, so pasting it to tell
  an agent about another one keeps the message with the agent you typed to, where a leading `@id` sent it away. Drag
  an agent onto a pane holding Alt still types its `@` token to message it.
- A council that ends shows a toast and an unread dot on its row, and one waiting on you has an item in Needs you that
  opens it.
- New council moved from every project's folder in the Agent tree to the New dialog: pick **Council** and a project,
  then Set up council. A project lists Councils only once it has one.
- A council reads shorter: its answer is one plain sentence and its summary a few, both in the language you asked in;
  each proposal keeps to a few sentences, and an expert who revises one says in a line what changed instead of
  repeating the whole new argument.
- A row in Needs you unfolds when you click its text: a run to confirm lists each thing it left unverified, so you
  know what to check before Accept.
- A finished council opens on its answer: one sentence first, then the directions.
- The council speaks in plain words (Agrees, Has doubts, Is against it) and ranks ideas by each expert's top three
  picks; an expert who agrees without a comment shows as a reaction under the idea, not as a reply.
- New council is one box: write what to review, and the options sit under it.
- A running council reads as a group chat: a bar for the step it is on, a chip for each expert with what it is doing
  now, and every idea and reply as a message in the order it came, with Reply on each expert's message.
- One council runs at a time across all projects. A council started while another runs shows in the Agent tree as
  Queued, can be removed from the queue, and starts when the running one ends or waits on you.

### Fixed

- A sleeping agent that a run's message (or yours) woke no longer stays shown as asleep when it took more than a few
  seconds to resume: its row and its terminal show it awake. One already stuck that way comes back with Wake, or with
  a message from its composer, without restarting it.
- While a sleeping agent wakes, what would cut the wake short is off until it is back: Close, the header's … menu,
  Send and Wake everywhere else, and Close agent in its row's menu.

## 0.15.17 — 2026-10-21

### Added

- **Council**: ask a panel of expert agents to review a feature. They propose, argue in a thread you can join, and
  Summarize ranks the directions with a matrix of who stood where. <!-- try: new-council --> <!-- big -->
- The Agent panel has a Changes tab beside Overview and Files: the agent's whole Files changed list, not only its
  first eight files, with the Session / Branch switch and View diff; a file opens on its Diff. It says which branch
  and worktree the list is measured in, lists that range's commits over their graph with what is not committed yet on
  top, commits ticked files without leaving the agent, and reads git again when the agent finishes a turn, when you
  open it and when you come back to the window.
- Servers: a server started outside arcterm whose output goes to a file (a redirect, or a task a Claude session that
  has ended ran in the background) now opens that file as its live Log. A server with no owner also has
  Restart in arcterm, which stops it and runs it again in a terminal in its folder, so you can see its output from then on.
- A pinned app's page shows a thin line along its top while it loads, after opening it, Home or Reload, with the page
  it had staying in view meanwhile.
- arcterm's Ctrl and Alt shortcuts (the palette, Ctrl+Tab, a surface's keys) work while you are clicked into a pinned
  app's page; the page keeps its own copy, paste, select all and undo.

### Changed

- A split shows in the Agent sidebar as one row: its agents and terminals leave their places in the folder and sit
  together, laid out as on screen, with the split on screen framed. Every project's saved split keeps its row, so a
  click on one of its cells brings that split back; the × on a cell takes it out of the split.
- The Servers popover shows each server's Log button all the time, not only on hover; a server started outside
  arcterm shows it faded, and its tooltip says why there is no log to open.
- Each project keeps its own split in Agent: choosing an agent or terminal of another project shows that project's
  split, and coming back finds the first one as you left it. Open in split and the header's Split menu offer only the
  project's own agents and terminals; terminals that name no project split among themselves. A split arranged before
  this update is not kept.
- The Agent panel's Files tab is as wide as Overview and Changes, fixed; only an open file's tab can be dragged wider.
- Claude highlights the must-read sentences in every long reply, a report of what it did or a list included: what
  changed, any caveat, and any decision left to you, not only the caveat.
- When the rest of a reply dims around its highlighted sentences, the bold words that open a list item or a paragraph
  stay bright, as headings do, so the reply keeps its outline.
- A run's land no longer holds on your uncommitted edits to a file your project lists in `.arc/union-merge` (such as
  `CHANGELOG.md`): when they sit apart from the run's changes, or only add lines beside its own, the land merges and
  puts your edits back on top, still uncommitted.

### Fixed

- Dropping an agent or terminal on a split cell's top or bottom edge stacks it there, as the drop preview shows;
  before, two cells always sat side by side whichever edge you dropped on. A drop splits the cell under it, so a cell
  beside another offers only its top and bottom edges, and closing a cell lets its neighbour fill the space.
- Text in a split no longer turns into wrong characters when a pane opens beside it or you click from one pane to the
  other (a `claude` or `codex` running in a terminal showed it most).
- Sentences Claude highlights below a table in its reply now show highlighted; before, every one after the table
  stayed plain.
- Updating arcterm now always updates the `wsh` its agents run; before, an agent session left running across the
  update could keep them on the old one, so newer commands such as `wsh detach` were missing.
- The mouse's Back and Forward buttons no longer go back in another app's page, out of sight, or in one whose app had
  stopped, which then showed an error: they now do nothing. The Back and Forward buttons in an app's header still go
  back and forward in its page.
- A folder's file tree (the Agent panel's Files tab, the Code surface) shows at once: the files git listed last time
  show while it reads the folder again, and a folder never listed before shows its top level from the disk meanwhile.
  Before, the tree sat on a placeholder for as long as git took, over ten seconds on a busy machine.
- An agent arcterm brought back after a restart no longer goes missing from the Agent tree when it was slow to load:
  resuming its conversation said it was already open and went nowhere. It now shows once it loads.

## 0.15.16 — 2026-10-21

### Added

- `wsh detach <command>` starts a dev server, database or watcher that keeps running when its terminal closes and
  when arcterm quits or is reinstalled; it prints the pid, a log file and the command that stops it, and agents use it
  for the servers they leave running.
- `wsh memory` runs a memory check from a shell and applies or keeps what it proposes, as Setup → Memory does;
  while a project's memory index is over the budget it states (`Budget: N bytes`), the check proposes cuts to fit.
- arcterm now looks after your pinned apps' servers: it gives each a port, starts it when you open the app, restarts it when it crashes, and stops it a minute after you leave it, never while it is still working (a chat answer, a script it started). Setup → Tools shows each app's state with Stop, Restart, Keep running and its rail pin, and the footer's Servers names an app's server. Keep running starts it with arcterm and never stops it. <!-- big -->
- Pin up to three of your apps to the nav rail: each opens as its own full-width surface, with the same page you had in Agent. <!-- big -->
- A pinned app's page reloads where it is with `Ctrl`+`R` or `F5` pressed in it, or its new Reload button, as in a
  browser (Windows).
- Setup → Tools suggests the terminal tools it finds on your computer (htop, ncdu, tig, bottom and about 20 more)
  under **Found on this machine**: **Add** puts one in the library and in Open a tool, the cross hides it. Mole (`mo`),
  the disk cleaner and app uninstaller, joins the library's System tools.
- Diff → Review shows a changed image (PNG, JPG, GIF, WebP) as its before and after side by side, with each one's
  pixel size and file size, where it used to say "Binary file — no text to show". <!-- big -->
- Pinned apps: give a tool of yours a **Page** (`http://127.0.0.1:<port>`) and a **Folder** in Setup → Tools, and
  opening it runs its command, waits for the page and shows it right in arcterm, in place of its terminal. Page and Log
  switch between the page and the server's output, with Back, Forward, Home, Open in the browser and Stop beside
  them. A page already up is shown without starting anything, and closing it then leaves that server running. The app
  sits in the sidebar under the project its folder is in, or Home, and nothing runs until you open it. No need to
  remember the command or the port: pick the folder and the form offers the scripts that run a server, each with the
  port read from its code, or press **Pin as app** on a server already running in the Servers list.
  <!-- try: open-tool -->
  <!-- big --> <!-- shot: 0.15.16-pinned-apps.webp -->
- An agent waiting on another agent sits under it in the sidebar, on a tree guide, and goes back to its place when
  the wait ends; when the two are in different projects its row says whom it waits on instead. Agents wait with the
  new `wsh agents wait <tab>`, which returns once that agent stops working; a loop that watches another agent's tab
  counts too.
- The agent panel opens several files at once, each in a tab of its own (up to 5): the files you open from Files,
  Files changed or a path no longer replace each other, and a link followed inside a file keeps Back and Forward in
  its tab. On Overview and Files the tabs fold into one icon with how many are open.
- The Office's music is a music-box Spider-Man theme in place of the day and night tunes, crunched as a Game Boy
  Advance would play it and picking up where it stopped when you come back. A file at `~/.arc/office-music.mp3`
  plays instead.
- **New project** finds folders Claude Code never ran in: type, and under the Claude Code list a **Found on disk**
  section shows the projects (a git repo, or a folder with a `package.json`, `pom.xml`, `pyproject.toml`…) in and near
  the folders your projects sit in, each with what it is and when it last changed.
- Settings → Storage has a **Package caches** card: what npm, Go, Cargo, Homebrew and the like downloaded or built
  once, each with its own Remove, which the next install or build fetches again.
- Markdown draws `==text==` highlighted, as Obsidian does: in a file's Preview in the agent panel and on Code, and in
  its Source view, where the `==` marks stay but fade. Ask Claude to highlight a markdown file and it writes the marks
  into that file instead of printing the file in its reply.
- Right-click a file or folder in Code's tree or the agent panel's Files, an open file's path or its tab, for **Copy
  Relative Path**, **Copy Absolute Path** and **Reveal in Finder** (Show in Explorer on Windows).

### Changed

- A run's lead asks shorter questions: one decision per question, two lines at most, with several decisions
  as separate questions in one ask instead of one long paragraph.
- A plan's `**Depends on:**` reference between two tasks whose `**Files:**` lines share no path must say why in
  parentheses (`Task 1 (uses the rows it adds)`): submit refuses a bare one, so a needless edge no longer makes a
  task wait for another.
- A terminal's header no longer spells out "Ctrl Tab back to …": the bar is shorter, and `Ctrl`+`Tab` still goes
  back to the agent you were on.
- Folded into the bottom-right corner, your pet sits in the corner again, 24px in, instead of 96px up.
- Resume agents on a new Claude account lists them by project, with each run's lead and workers under the run, a
  checkbox for a whole project or run, and Select all; a long list scrolls instead of running off the screen.
- `Ctrl`+`R` and `F5` never reload the whole arcterm window any more (Windows): outside a terminal `Ctrl`+`R` redraws
  it, as `Cmd`+`R` does on a Mac, `Ctrl`+`Shift`+`R` redraws from inside one, and in a terminal `Ctrl`+`R` stays the
  shell's reverse search. **Reload the window** in the command palette reloads arcterm when you mean it.
- A pinned app's page stays where you left it, scroll and all, when you switch to another agent, its Log or another
  view and come back. A page out of sight for 10 minutes is let go and loads afresh next time; its server keeps
  running.
- The Brief's Runs kind and Initiatives project filters sit on a line of chips under their head, each with its
  count; past six projects they fold into one menu in the head.
- Claude Code lists arcterm's own skills as `arc:runs`, `arc:cockpit`, `arc:design`, `arc:initiatives`, `arc:notes`,
  `arc:doc-review`, `arc:ideas` and `arc:learn`, from the arc mod, with the rules you approved through `wsh learn`;
  other harnesses keep the plain names (`runs`, `cockpit`, …), and the old names (`cockpit-runs`, `cockpit-ui`,
  `design-local`, `effort-tracking`) go, keeping your rules.
- An orchestrator run's DAG opens a node's peek beside it on a click: the worker's session, its route, the
  description and the actions it needs; the final stage's node shows its steps there. The hover peek and the rails
  under the graph are gone, and every run, finished ones included, opens in the run sheet.
- Engine runs in a project with no Setup line and no `.arc/setup` link the main checkout's installed `node_modules`
  into each tree, so a task's tests run without an install.
- The tray's Storage card shows every drive on a PC with more than one, each with its free space and arcterm's share
  of it (worktrees and build output count on the drive they sit on), and leaves out virtual drives such as Google
  Drive's.
- Setup → Memory shows a change in a rail as wide as Skills' one, growing with the window, so its diff no longer
  wraps every few words.
- An agent whose turn ended while work it started still runs in the background no longer reads idle: its header and
  sidebar row say working while a command is at work, and waiting, on a slower pulse, while it only watches (a Monitor,
  a loop that checks and sleeps).
- Settings is sorted by what each setting changes: a Runs & limits page holds the run route, how many runs and heavy
  jobs go at once, keeping the Mac awake and when a costly spawn asks first; the pet's folding sits with Jarvis & Office;
  the vault with Storage & sync; About at the foot of the list. <!-- try: settings -->
- Settings → Storage's Build output also lists the repos agents worked in, not only your projects, says when an agent
  last worked in each and puts the longest unused first; a project's row opens onto each folder with its own Remove.
- **Work on** an initiative that has no project asks which project to start the agent in, and the initiative keeps
  it, instead of an error telling you to run `wsh effort project`.
- Plan to review in the agent's details rail shows a row's Accept, Rename and Drop only while the pointer is over it,
  so each proposed step's title gets the rail's full width.
- In the Office, **Open** in a desk's dialog box shows the full card in a game-framed panel on the right, and the office
  slides over when the panel would hide the desk; **Terminal** takes you to the agent's terminal, and `f` opens or shuts
  the panel.
- **Translate** translates into Vietnamese only, like Google Translate's English → Vietnamese: an English word shows
  its Vietnamese meanings instead of a whole English dictionary entry first. Type `:en` in it to translate into English.
  It answers short: the translation with a word's phonetics, then one line of meanings per word class (noun, verb…),
  where it used to print each meaning on two lines under headers and repeat what you typed.

### Fixed

- An agent you resume on a new Claude account after it stopped mid-turn (at a usage limit, say) carries on with its
  work, as one does after arcterm restarts; it used to wait at its prompt for you to type continue.
- Docker Desktop started by an agent keeps running when that agent is restarted (such as resuming it on another
  Claude account), its tab is closed, or arcterm quits or updates; it used to quit with the agent.
- A link that opens a new window (`target="_blank"`, `window.open`) in a pinned app's page or in the cockpit opens in
  your default browser; it did nothing. An app's Open in the browser button opens the page you are on, not its start
  page.
- An app that is starting counts the seconds it has waited for its page; it read 0 s the whole time.
- A file link in an agent or in Diff switches to Code at once, instead of after the repository's file list has
  loaded, which on a large repository looked as if the click did nothing.
- A running worker's row in the Agent tree shows how long it has run since it started; it read <1m for as long as
  the worker stayed busy.
- On Windows, a program you installed while arcterm was open now runs in the next terminal or agent you open, and
  Setup → Tools shows it installed, without restarting arcterm.
- A path from your home folder or through a dot folder, such as `~/.claude/usage-data/report.html`, is a link in a
  terminal and an agent's transcript: Ctrl+click opens it.
- A prompt you sent, in the live transcript and a past one, keeps its line breaks and shows its headings and code
  blocks, so an engine task's long prompt no longer reads as one wall of text; a long prompt shows its first lines,
  with Show more.
- Holding `Ctrl` in the Agent view no longer leaves a copy of **Redraw the terminal** in the bottom bar each time.
- A service whose program starts agents of its own (a dashboard that calls `claude -p`) is listed once in the Agent
  tree, as its service row, instead of a second time as an agent.
- In the New dialog, a click anywhere in the Command box puts the caret in it, not only a click on the text.
- Settings → Storage fills each card as soon as its scan is done, instead of reading Scanning… for minutes until
  build output and the package caches have been measured.
- A pinned app's Back and Forward step through that app's own pages (Windows); they did nothing, or moved a page you
  could not see.
- A run that fails to start while the machine is short on memory is cancelled, instead of staying "executing" with no
  agent in the sidebar.
- A context menu takes the arrow keys and Enter as soon as it opens, and the Brief's list no longer moves under it.
- An agent that left a dev server running in the background no longer reads as working once its turn ends, even
  when it started the server with `2>&1` or another redirection: its dot goes idle and a green server glyph beside it
  (with the ports, in the agent's header) says the server is still up. In the rail's Servers, such a server now reads
  `this agent` with its Log, instead of `already running`.
- Open on a plan to review whose agent has closed opens the initiative in Jarvis's Brief, on the proposed chunks
  with Accept all and Drop all, instead of its Activity sheet, which had no way to decide them.
- A stalled orchestrator task whose worker starts working again goes back to running, and a plan reviewer that sits
  at its prompt without a verdict is replaced after the short grace instead of 20 minutes.
- A button reached with Tab keeps Enter and Space: the Brief no longer opens the row under its cursor instead.
- A terminal's link tooltip says Ctrl on Windows, not Cmd.
- A terminal keeps showing its output when saving it to the scrollback store fails under load.
- An agent you let run a command from its permission prompt reads working again as soon as you answer, instead of
  asking until the command finished.
- An agent whose turn ended no longer reads as working with nothing running in the background: a background command
  arcterm refused before it started, or a command whose output only quoted one, kept the row's dot green and held its
  Close back.
- On a Mac, **Fold when you leave** folds behind any app that covers arcterm, not only Chrome: under an app whose window
  hid arcterm completely, the fold waited until you came back and then folded the window as you returned, so the Dock
  icon or `⌘Tab` showed Sprout instead of the cockpit.
- Settings → Storage shows a clean as it happens: Remove reads Removing… with a spinner until the folder is
  gone, the card's own button reads Cleaning…, and the row leaves as soon as the clean ends instead of after the rescan.
- Skim highlights every sentence Claude marks in a reply, not only the first four: the fifth on no longer draws as
  plain text, nor dims with the rest. A reply marked through most of its length draws in full instead of dimmed.
- A Claude agent watching something with a Monitor counts as having background work: its details list the Monitor,
  and it is neither put to sleep nor offered Close until the Monitor ends.
- An HTML page in Code or the agent panel's File tab opens where you left it after you switch to another surface or
  file and come back, or an agent rewrites it, instead of jumping back to the top.
- Resting the pointer on an HTML or PDF preview no longer hangs a chip with the file's path over the path bar.
- A tooltip holding a long path wraps it inside its box instead of running the path out past the edge.
- In the agent panel's File tab only the path itself is the copy button: the empty space beside it no longer turns
  grey or pops the full path up over the top of the document.
- An image opened in Code or the File tab now shows in the installed app, instead of "Cannot show this image".
- The output of a run's Verify, Check and Final steps no longer shows boxes and stray `[24m` codes where a tool
  printed colors: the color codes are dropped, so the text reads as plain lines.
- The t> mark in the Mac menu bar sits level with the memory beside it, its middle on the text's middle, instead of
  hanging below the text.
- The menu bar icon opens its popover again after arcterm let the popover go at critical memory pressure; one such
  time left every click opening nothing until arcterm restarted.
- In a float, the agent tabs no longer slide over the Translate button or under the usage: a narrow float shows as many
  tabs as fit and puts the rest under "+N".
- **New project**'s Claude Code list shows only projects: `/`, your home folder and the orchestrator's run worktrees
  are gone, and a session begun in a repo's subfolder counts for the repo.

## 0.15.15 — 2026-10-17

### Added

- **Note and Translate in Float**: the strip under a float's terminal has a **Note** tab, one markdown note that saves
  itself as you type (with Preview), and a **Translate** tab that opens translate-shell, its prompt showing the
  language it translates into, with `↑` recalling past lookups. `Cmd`+`Shift`+`N` floats the note.
  <!-- try: float-note --> <!-- big -->
- Office sounds: chiptune jingles when a task finishes, a run lands or someone needs you, with optional footsteps and
  day and night music (`s` or the office menu's Mute sound mutes them). Settings → Appearance turns the jingles, the
  boss's sounds and the music on or off, and sets how loud they play.
- On a Mac, translate-shell is in the tool library (Setup → Tools), translating into English and Vietnamese.
- **Answer an agent's question from Telegram**: pair a bot in Settings → General → Notifications, then tap an option
  or reply in your own words. <!-- big --> <!-- shot: 0.15.15-telegram.webp -->
- **Your pet is the Office's boss**: in the Cockpit's Office you walk around as Sprout, the Minion, or Spider-Man, who
  swings in through a window and turns into Peter Parker in a shirt and tie. Its speech bubble and the condition panel
  open over it, and the footer pet comes back when you leave. <!-- big --> <!-- shot: 0.15.15-office-boss.webp -->
- The memory free shows beside arcterm's menu bar icon on a Mac (`4 · 1.1 GB`), and in the tray icon's tooltip on
  Windows. Settings → General → Window turns it off.
- Find in a file the agent panel opens: `Cmd`+`F` in a markdown Preview opens a find bar that marks every match and
  steps through them with `Enter`; in Source and Diff it opens the editor's find from anywhere in the tab.

### Changed

- The menu bar popover's Memory and CPU cards are one line each ("1.2 GB free of 16 GB", "Load: 38%"), and Memory
  shows the swap in use. CPU shows the right load the moment it opens, instead of 0% or the figure from the last
  time you opened it.
- On a Mac, a float's title bar ends in a − in place of the button with your pet's name: it folds the float into the
  pet, and a right-click picks the corner it folds to.
- Folded into the bottom-right corner, your pet sits higher, clear of the chat or help button a page keeps there
  (Messenger's, for one).
- Telegram connects only while an agent's question is open, and only when you allow it: for a while (1h, 2h, 4h or
  your own), on a schedule such as office hours, or always.
- **Background tucked away in the Office**: the Backgrounded and Background lists no longer sit under the building,
  so the office fills the Cockpit. The office menu (`m`) lists **Background** with how many agents are there; pick
  it to show both lists under the office, and **Hide background** to tuck them away again. Cards still shows them.
  <!-- big --> <!-- shot: 0.15.15-office-background.webp -->
- The Office's music and jingles fade out instead of cutting off when you leave the Office, switch away from the
  window, or mute.
- The Office's boss turns the way it walks again: its back going up, its side going left or right, its front going
  down, and it stays turned when it stops.
- The Office's boss walks faster, and runs while you hold `Shift` with the arrows.
- `Space` is the Office's action key: it talks at a desk, picks the ▶ item in a dialog box, rides the lift and puts a
  carried room down. `Enter` still works.
- The Office's boss is as tall as the people working there; it was drawn smaller than them.
- The Office's notice board opens when nothing waits on you too: walk up and press `Space`, click it, or pick Notice
  board in the office menu, and it says nothing is waiting.
- The Office's sounds are softer: the shrill top of the chiptune is filtered off and the whole mix is a little quieter.
- An Office dialog box's menu drops Terminal, which did what Open does, offers Diff to open the agent's changed files
  while its box shows them, and calls Background "Send to background".
- An Office dialog box no longer shows a key beside the item under the ▶: as in a game, ↑ ↓ move the ▶ and `Space`
  or `Enter` picks. The letter and number keys still work.
- The agent header no longer shows a bare `i` key beside the initiative; `i` still opens it, and the link's tooltip
  says so.
- The system notification for an agent that needs you no longer plays a sound; the Dock icon still bounces.
- With the menu bar icon on (the tray icon on Windows), closing arcterm's window hides it instead of quitting: your
  agents keep running and the icon keeps showing the memory free. The popover's Open arcterm, or the Dock icon, brings
  the window back; Quit (`⌘Q`) still quits.
- The Resume list and Conversation History load older sessions as you scroll, instead of stopping at the newest 50 or 100. <!-- try: go:history -->
- Typing in the Resume list finds any session of that project still on disk. <!-- try: new-agent -->
- Claude Code now keeps conversations 90 days instead of 30, unless you set `cleanupPeriodDays` yourself.

### Fixed

- On a Mac, closing the menu bar popover no longer crashes arcterm.
- On macOS 27 the menu bar icon looks pressed while its popover is open; it only did on earlier macOS.
- On a Mac, arcterm folded into Sprout over a full-screen app comes back where you can see it: the Dock icon, `⌘Tab` or
  a double-click on Sprout takes the screen to arcterm's desktop instead of leaving it on the full-screen app.
- A conversation no longer ends up open in two tabs after arcterm restarts: resuming it right after a restart goes to
  the tab already running it, a restart brings back one tab per conversation, and a sleeping copy says which tab has
  it open instead of waking beside it.
- In a Claude reply with highlighted sentences, a command for you to type (`! task install`) is highlighted too,
  with the sentence saying what it will do, instead of fading with the rest of the explanation.
- A Claude agent's heavy commands (a build, the typecheck, a whole test suite) wait their turn in the job queue
  again, so two agents no longer run the typecheck at once and push a small Mac deep into swap.
- The menu bar popover opens at once instead of after a half-second to two-second wait: it loads while the pointer
  reaches the icon and stays ready between opens. At critical memory pressure it gives its memory back and loads
  again on the next open.
- The app no longer scrolls as a whole: the window stays put instead of sliding up out of view, or bouncing under a
  trackpad fling on macOS.
- A new terminal (New → Terminal, or the Diff panel's Open a terminal here) opens in the centre with the cursor in it,
  as a new agent does, instead of waiting in the sidebar to be clicked.
- The keys the Office menu (`m`) shows beside its items, such as `s` or `j`, now work while the menu is open: the
  menu shuts and the key does its job. Before, only ↑ ↓ and `Space` did anything there.
- The Office opens straight onto the office when no agent is running: no grey card placeholders while it loads, and
  no "No agents running" panel over the rooms. The Cards view keeps both.
- The Office's boss stops with its whole body against a wall, instead of walking half through it into the next room or
  with its head over the top of the building.
- In the Office the coffee machine, the plants and the notice board hide the boss and anyone walking behind them,
  instead of the boss being drawn on top of them.
- In the Office the boss walks right up to an empty seat on the sofa, instead of stopping a step short of it as if
  someone sat there.
- A click in the Office, or a jump to a desk, walks the boss round the desks, tables and the sofa instead of through
  them, and so do the people walking to the lounge.
- The plant in an Office room no longer stands in its doorway, where it stopped the boss walking in: it now stands at
  the end of the first desk row, under the door.
- Highlighted sentences in Claude's replies now show on Team accounts too. Claude Code's security plugin there kept
  the instructions out of the system prompt, so Claude never marked anything; they now ride with your prompt instead.
- `Esc` in the Office stays in the Office: it only steps back, and no longer reaches the window behind it, where on a
  Mac it could take arcterm out of full screen.
- The menu bar icon looks pressed while its popover is open, as a menu's does, and the popover fades in when it opens
  instead of popping up.
- On a Mac, clicking arcterm's menu bar icon, with either button, opens the popover with memory, CPU and what waits on
  you, instead of only Open / Quit, and the icon is the size of the icons beside it.
- Disk sizes read as Finder and System Settings read them: a 245 GB drive shows 245 GB in the menu bar popover and
  Settings → Storage, not 228 GB. Memory keeps the units Activity Monitor uses.
- On a Mac, closing an agent or a terminal also stops what it left running in the background (a daemon such as
  codex's app-server, a `nohup` server), so those no longer hold memory after it is gone. A sleeping agent keeps them,
  and a tmux or screen server started in it stays.

## 0.15.14 — 2026-10-16

### Added

- **The run queue in Jarvis**: a plan queued with `--after` sits in the Brief's Runs right under the run it waits on
  (a chain nests one level per link), a plan waiting for room at the end. Click one for what it waits on, its plan
  and route, and Start now, Run next or Remove; a run started from the queue says what it was queued after.
- **Initiatives by project**: the Brief's Initiatives head has a project filter (all, each project, no project) when
  the initiatives name more than one; it narrows before the list is cut, and the paused count and archived ones follow
  it.
- **Stop a background command**: a Claude agent's running background command (a hung build, a dev server it left
  behind) has a Stop beside it in the agent rail's Background tasks; two clicks end it and what it started. Windows.
- The Office has a notice board in the hall: what needs you waits there as pinned slips, and ↵ at the board pages
  through them with the same buttons the Cards view shows. The Office's "need you" count adds the board's slips to the
  agents that ask.
- **Memory hygiene**: Setup → Memory checks each project's Claude Code memory every week, or when you ask, and
  proposes changes with their evidence (files a memory names that are gone, a rule already in AGENTS.md, how often
  sessions open it): drop, merge, or move a shared memory into the project's own. Nothing changes until you accept a
  change, and an applied one can be undone for 30 days. <!-- big -->
- **Autonomous runs**: an orchestrator run's **Approvals** can be Autonomous (the New dialog, the profile, the run
  sheet, `wsh runs start --autonomous`). Its lead makes the calls it would otherwise ask you and records each one with
  why in its report; **Go autonomous** / **Ask me again** in the palette switch a run that is going.
- **A wider plan review**: round 1 runs four lens reviewers (spec coverage, task order and files, tests and commands,
  final coverage) beside the full review, and round 2 is one follow-up that checks only what the lead changed. The
  lens reviewers run on the new **Light reviewers** route, Sonnet unless you pick one.
- **Radar audits more kinds**: besides a fix's siblings it audits bugs a change introduced and hotspot files, sorts
  commits that have no `fix:` prefix (pick its model under Settings → Background AI → Commit classifier), and keeps
  git to a project that is a subfolder of its repository.
- arcterm in the menu bar (the tray on Windows): see memory, CPU and disk, free them up, run or skip a queued job, and open what waits on you, without bringing the window forward. <!-- big -->
- A Doc review lists the document's headings under Sections, beside the agent's ask: click one to jump there. The ask's
  items that lead to a section now show an arrow, and one the agent wrote short ("New in Go" for "What is new in Go")
  finds its section too.
- **Claude highlights what to read**: in a Claude session, a reply that explains something draws its 2–4 must-read
  sentences on a tinted ground and dims the rest (`/skim` turns the dimming off), and a brainstorm highlights only the
  question waiting on you, its options left bright. A copy, the transcript and Conversation History get the reply
  without the marks. In the fullscreen terminal, a question that scrolled out of view stays above the prompt until
  you answer. <!-- big -->
- **Resume a canvas's session**: a canvas opened from the Canvas gallery offers the session that drew it, beside its
  title: Resume puts that conversation back in a tab, or Jump goes to its agent if it is still running.
  <!-- try: go:canvases --> <!-- big --> <!-- shot: 0.15.14-canvas-resume.webp -->
- **The Mac stays awake while work runs**: while an agent is working, a run is going or a heavy job runs, the Mac no
  longer sleeps when left idle, so a run you walk away from keeps moving. The display still turns off, closing the lid
  still sleeps it, and on battery it lets go under 20%. Turn it off in Settings → Agents → Runs.

### Changed

- **The Office is now a building of floors**: you ride a lift between them. Each project is one room, its runs are
  meeting tables in it, and you arrange the rooms with g or by dragging.
- A plan queued behind another run reads **Queued · after** and the run's name in the Agent tree, so its row says it is queued even when
  the run's name is cut off.
- **The office lives in the Cockpit only**: Jarvis's Runs list no longer has an **office** chip, and Jarvis stays on
  the footer instead of taking a desk under the runs.
- **The Office plays like a pixel game**: ↵ at a desk opens a dialog box at the edge of the office with what the agent
  says, its question and its numbers, and a ▶ menu of what you can do there: ↑ ↓ pick, ↵ does it, Esc steps back, and
  Full card (f) shows the whole card. A run's room offers Open lead and Adjust, a worker's seat its task's own buttons.
  <!-- big -->
- **The Office fills the Cockpit**: its counts, Cards/Office, projects and Live only sit in a bar inside the office,
  the footer shows only `m menu` and the newest event, and `m` opens the office menu (Events shows the Events rail,
  which Office now hides).
- The Office view is drawn in pixel art: a bright office in work hours and a dim one after hours, people you can tell apart by their hair, the boss in a cap. It also draws with about 280 fewer page elements.
- **The Office's ⚡ reads as energy**: it shows what is left of Claude's 5-hour window, so 4 % used reads ⚡ 96 %, and
  it turns amber at 10 % left.
- **The Office walks lighter**: a step of the boss or a walker moves only that figure instead of redrawing it, so while
  they walk the Office takes about 10 % of a core, down from up to 19 %.
- **A calmer Ideas list**: each idea takes at most two lines, an open question reads brightest and a decision dimmest,
  and hovering one shows its whole text, turn and author beside the rail. Click an idea to pick it for Merge or Drop:
  the card itself lights up, with no checkbox. Only the topic under way stays open; the others fold, with a dot when
  they hold something new. Editing an idea, the kind you chose stands out from the other two.
- **Background tasks, newest first**: the agent rail lists the task started last at the top, so a running one no
  longer sits under the ones already done.
- **A clearer agent rail**: the session's context, spend and facts sit on their own tile, the list headers (Files
  changed, Servers…) read brighter, and a short rule sets the Overview and Files tabs apart from the counts after them.
- **Rail lists carry their icons**: each list on the agent rail (Ideas, Files changed, Uploads, Servers, Background
  tasks…) leads with the same icon as its count in the strip above.
- **The Office offers a card instead of opening it**: when the boss stands at a desk, a ↵ over the person there
  offers its card, like a game's "press E"; press Enter or click it to open the card, and Esc to close it again.
  Walking with `j`/`k`, `n` or the arrows no longer opens cards by itself; a click on a desk still opens its card.
  The boss no longer walks onto a desk or the person at it, and the ↵ shows only while it stands in front of a desk.
- **A bigger Office card**: ⤢ on the card's corner, or `f`, grows it to about half the office and most of its height,
  so a long answer reads without scrolling; the size you pick stays for the next card.
- **The session tile keeps to the session**: the agent rail no longer lists the project's AGENTS.md or CLAUDE.md under
  the session's facts; Setup → Project lists it, with every other file that shapes the agent. <!-- try: go:setup -->
- **Stop and Resume sit on the session tile**: the agent's state, its cache countdown and Resume or Stop moved from the
  foot of the agent rail into the session tile, under project · branch · model and over Compact and Clear.
- **The session's figures open the breakdown**: click the context line or the token bar on the session tile (a ⌄ at
  the bar's end) to see where the tokens and spend went; the separate Breakdown button is gone.
- **No empty context slot on a sleeping agent**: the spend now sits at the end of the token bar, and the context line
  shows only while the agent runs, so an agent asleep or one waiting for its first turn after a restart shows no blank
  row.

### Fixed

- **An initiative opened in the sheet no longer draws a dark band** behind its Notes' day header (`TODAY`).
- **A run's workers sit in their project's room in the office**, and under that project everywhere else, instead of a
  room named after their task ("1", "4").
- **A GPU reset no longer leaves a terminal white**: it switches to the plain renderer at once and goes back to WebGL
  two seconds later.
- **arcterm starts even when a window opens before its server**: boot no longer fails with "wavesrv did not report
  its ports".
- **A run stopped by an app restart carries on**: a quick run, or a lead that had not submitted its plan, resumes
  instead of waiting Blocked for you to press Resume.
- **Finished plan reviewers and final verifiers close**, instead of idling at their prompt until arcterm quits, and the
  worktree folders of finished runs are swept up.
- **A lead's wake is no longer held** by a tool hook that reported after its turn ended, or while you type an answer
  to its question.
- **A spec the run revised no longer holds its land.**
- **Settings → Storage sees the engine's trees**: Run worktrees now lists and cleans the trees runs leave in
  `arc-wt` (under your cache folder), not only the old `.waveterm/worktrees`. A tree whose run this app does not
  know, such as one the dev app and the installed arcterm share, is left to its own button.
- **Finished orchestrator runs show under their project again**: in the Agent sidebar's Conversations, a run whose
  lead and workers ran in arcterm's own tree folder (`arc-wt`) is filed under its project instead of under the tree's
  name, where the sidebar hid it.
- **A background command's log is never empty**: a Claude agent that starts a background command with its output
  redirected to a file (`task dev > dev.log`) is told to drop the redirect, since Claude Code already keeps that
  output in the file the Background tasks and Servers lists open.
- **"The Mac slept for…" counts the whole sleep**: it counts from when the Mac fell asleep, not from the last few
  seconds macOS woke it in the night for maintenance, so a night's sleep no longer reads as nine minutes. The pet now
  says it two minutes after the Mac wakes.
- **The boss walks around the lounge's furniture**: in the Office the boss no longer walks onto the sofa, the coffee
  machine or a plant; it stops in front of them, as it does at a desk.
- **The Office fills the Cockpit's height**: a quiet office no longer stops partway down with an empty strip below
  it; the last room stretches to the bottom. An agent coming in or leaving no longer makes the office blink.
- **arcterm's share of the RAM bar adds up when the Mac swaps**: the bar counts what arcterm and its agents hold in
  RAM now, so on a Mac short of memory it no longer fills the whole used part and shows other apps at 0 MB. What they
  come to with what macOS compressed or swapped out is named beside it, and the header shows the swap in use.
- **Canvas previews show, and work on a Mac**: the Canvas gallery's cards show the preview taken the first time you
  open a canvas (the installed app drew them blank before), a Mac now takes them, and Send captures the board there.
  They use the Screen Recording permission arcterm already has; without it Send says so.
- **An agent cut off by a restart carries on**: when arcterm quits, updates or crashes while a claude, pi, agy or
  codex agent is working, waiting on a permission or asking you something, it comes back with a note to pick up where
  it left off (and to ask again if it was waiting on you), instead of sitting at its prompt until you type "continue".
  An agent that had finished its turn comes back waiting, as before.
- **Sprout's bubble no longer hides your prompt**: it has a × to close it, and typing puts it away at once instead of
  covering the bottom of the terminal for several seconds. What it said stays unread on Sprout; ⌘J reads it back.
- **An agent's terminal fills its pane again**: a run's worker or lead opened after it started no longer stays
  drawn at 80×24 inside a larger pane when the Mac is short of RAM; the pane fits itself within two seconds, as
  Redraw did.
- **The Office card stays in the office**: the card beside a desk keeps to the office's height and scrolls, instead of
  running down the page with the agent's whole last answer; a finished card's age no longer runs into Review changes.
- **A run that finished while arcterm was out of touch reads finished**: when the window loses its connection to the
  backend for a while (folded, say) and a run moves on or lands meanwhile, the Agent tree catches up as soon as it
  reconnects, instead of showing the run working with a task stalled until the app restarts.

## 0.15.13 — 2026-10-15

### Added

- **The Cockpit as an office**: press `o`, or Office beside Live only, to see your agents as a floor plan: a room per
  project, a glass meeting room per run, idle agents in the lounge, the lights off where no one works. Walk the boss
  with the arrow keys; `n` shows the way to the next Needs you; the card of the desk you stand at opens beside it. Its
  cost shows in the RAM panel, and Settings → Appearance → Office turns the animation off. <!-- big -->
- **Ideas grouped by topic**: the agent names a topic for each line of a brainstorm, and the Ideas list on the agent's
  rail groups by it — open questions first, then each topic in the order it came up, then Other. A list with no
  topics reads Decided / Ideas / Open as before.
- **Correct or delete a memory in Setup → Project**: a Claude memory's panel has **Correct…**, which sends Claude one
  line saying what is wrong so Claude fixes the file itself (or copies the line when no Claude agent is open in that
  project), and **Delete**, which moves the memory to `~/.arc/trash` and drops its line from `MEMORY.md`.
  <!-- try: go:setup -->
- **Jarvis has an office too**: with the Runs list's **office** chip on, Jarvis leaves the footer for a desk of its own
  under the runs, beside a desk for every agent you started yourself. It keeps watch when something waits on you, works
  while your agents work, reads, listens to music or plays ball when all is quiet, and sleeps at night; with no agent
  around, a free desk opens a new one. Click Jarvis to open its panel, as on the footer.
  <!-- try: go:jarvis --> <!-- big -->

### Changed

- **The link between a session and its run is shorter**: under the session it is a small run chip on its second line
  (`0/7`, `queued #2`, `merged`, `2 runs`) instead of a line with the run's name, and the run's row shows a ↰ instead
  of `from <session>`. The names are in their tooltips, and a click still goes to the other.
- **⌘R redraws the terminal** on a Mac: garbled text in an agent or terminal pane repaints and the TUI draws
  itself again, as the header menu's Redraw does, from inside the terminal too.
- **A tidier Ideas list**: when a later decision replaces an earlier line, the agent drops or rewrites the old one, and
  it no longer records status (commits, estimates) as ideas, so the list shows where a brainstorm stands. Each line
  holds the gist in a few words, leaving the details to the spec, and the agent adds nothing when nothing new came up.
- **An idea's Edit and Drop buttons sit at its bottom right**, beside the turn line, so hovering a line no longer
  covers the end of its text.
- **Wider side panels in Setup**: the file panel on Setup → Project takes about half the window, and the skill panel on
  Setup → Skills grows too, so a file reads at a comfortable width.
- **Canvases is now the Canvas gallery**: the sidebar row, the gallery's title and the `Ctrl+G` `v` command use the new
  name. <!-- try: go:canvases -->
- **What's new** is livelier: a release's highlights show a picture of the feature, every note leads with a colored
  icon for what it is about, and your Jarvis pet tells the news in the corner.
- **Waiting on you is easier to read**: each row in Jarvis puts the title over a second line saying why it waits, where
  it is from and how long; the kind chip is amber only where an agent or a run waits on your answer (red when stuck,
  grey for a reminder); and the box no longer repeats the count its heading shows. <!-- try: go:jarvis -->

### Fixed

- **On macOS arcterm stays on its own Desktop**: switching to another Desktop no longer folds it into Sprout, and a
  folded Sprout stays on arcterm's Desktop, so opening it no longer moved arcterm to the Desktop you were on. Sprout
  still follows you over a full-screen app.
- **An answered question no longer leaves its agent stuck on asking**: a question's card could stay behind after you
  answered it (most often on a Claude Team or Enterprise account), hidden while the agent worked and back as "asking"
  (with a Waiting on you card) every time it finished a turn, until the app reloaded. An agent that finishes a turn
  now drops any card the server no longer holds.
- **A sleeping session never reads as asking**: a question card left behind on a session that has since gone to sleep
  no longer marks it "asking" in the sidebar, where it stood above the agent that really was waiting on you.
- **Heavy jobs no longer pile up on a Mac short of memory**: under yellow memory pressure the Jobs queue runs one
  heavy command at a time, where it used to let in another every minute (three typechecks on an 8 GB Mac swapped
  for a quarter of an hour), and while one is still starting up the next joins it only when the free RAM fits both.
- **Work on a due chunk turns into Go to agent** once the agent it started is open, on the Brief, the Needs you strip
  and Sprout's peek, so the row takes you back to that agent. An unverified run in Waiting on you no longer reads
  "blocked".
- **A Claude subagent asks once on the Token burn card**, not twice: the gate ran a second time for the same spawn
  under the tool's old name, Task, so a plain Allow brought the card straight back.
- **Three subagents started at once now ask on the Token burn card**: Claude starts each one as it writes it, a
  second or so apart, so the gate saw two and then one and never asked. Spawns within 10 seconds of each other now
  count together, and the third asks.
- **The Token burn card no longer asks about a subagent arcterm will refuse anyway**: once a session has started
  its 10 subagents, the spawn is refused with that reason at once, not after you allowed it. A subagent that arrives
  while the gate is still deciding on the ones before it is counted too, instead of slipping through with them.
- **Allow this turn lasts the whole turn**: a background subagent reporting back no longer ends it, or a Don't
  spawn, so the Token burn card no longer comes back before your next prompt.
- **A spawn after Don't spawn says why it was refused**: a subagent the agent tries later in the turn is told you
  chose Don't spawn earlier, not refused in the words of the card it never had (such as "run a workflow").

## 0.15.12 — 2026-10-14

### Added

- **Edit and create skills in Setup**: on Setup → Skills, **Edit** opens a vault skill's `SKILL.md` right in the side
  panel and **Save** copies it into every harness at once; **New skill** asks a name and a description, then opens the
  new skill to write. Skills that ship with arcterm stay read-only.
- **Canvases**: every mockup an agent drew lives on in Agent → Canvases, with a preview of each; open one to page
  through its boards, or Clean up to move the old ones to the trash. Agents no longer delete a canvas when its feature
  ships unless you turn that on in Settings → Storage. <!-- try: go:canvases --> <!-- big -->
  <!-- shot: 0.15.12-canvases.webp -->
- **Runs as an office**: in Jarvis, the Runs list's **office** chip draws each run as a pixel office floor under its
  row: the lead in a glass corner office and one person per task, typing, stuck, in review, carrying the merge, or
  raising a hand when they need you. Click a person to open their terminal.
- **Ideas on the agent's rail**: while you brainstorm, the agent lists what was decided, floated and left open, and you
  can add, edit, merge or drop ideas, or run the idea command in Claude to keep the idea just discussed. An Ideas count
  on the rail opens the list and shows a dot while some are new; an ended session in Conversation History shows its list
  too.
- **Keep a selection as an idea**: select text in an agent's terminal and press `Ctrl+Shift+I` (`Cmd+Shift+I` on a Mac),
  or click **Add as idea** beside the selection, to keep it in the agent's Ideas; the toast has Undo. With nothing
  selected, the same keys open the Ideas box.
- **Setup → Project**: one place to see what shapes Claude in a project: its CLAUDE.md or AGENTS.md, its memory
  grouped by type, its settings and hooks, its skills, agents and commands, and `.arc/setup`. Pick a file to read it
  beside the list. <!-- try: go:setup -->
- **Reopen an agent you just closed**: `Ctrl+Shift+T` (`Cmd+Shift+T` on a Mac) brings back the agent closed last, as a
  browser reopens a closed tab. Its conversation returns asleep, so it costs nothing until you wake it or send it a
  message. The last 5 closed agents are kept. <!-- try: reopen-agent -->
- **Agents learn your corrections**: agents now note how you correct them. When the same correction comes up in two
  sessions, Needs you asks whether to keep it as a rule, and the lines you accept appear, highlighted, under
  Setup → Learned and in each skill.
- **Claude checks its memory at session start**: on every machine with arcterm, a new Claude session looks over the
  project's Claude memory and, when something has gone stale (a broken link, a file or `task` that no longer exists, a
  memory untouched for 30 days), shows a toast and lists it in its first reply, offering to fix it.
- **Review an agent's proposed plan on its rail**: when an agent proposes chunks for its initiative, its details rail
  opens on Plan to review; accept, rename or drop each, or Accept all and continue. Proposed chunks don't count toward
  progress until accepted. <!-- try: go:agent -->
- **The agent's initiative from its header**: click the initiative link (or press `i`) for its progress, the chunk
  this agent is on with Mark done, what's next and a note; an agent with no initiative can Link to one.
  <!-- try: go:agent -->
- **Review initiatives**: Jarvis → Initiatives → Review (`v`) walks what changed since you last reviewed, then the
  ones idle for two weeks, with Pause, Archive and Mark reviewed. <!-- try: go:jarvis -->
- **Sub-initiatives on the List**: link an initiative under another from its ⋯ menu; children sit under their parent.
  <!-- try: go:jarvis -->
- **Queue a plan instead of starting it**: `wsh runs start --plan <file> --queue` (or `--after` another run, which
  implies `--queue`) leaves the plan waiting on the Agent tree, and arcterm starts it by itself when fewer than
  `runs:maxactive` runs are going. A queued plan is a row in its project's folder with Start now, Run next and Remove.
- **A session and the runs it started point at each other**: a session that started a run shows where the run is under
  its name (`→ Setup · 3/5`, `→ Queued #2`, `→ merged`, `→ held`, or `→ 2 runs`), and the run's row says
  `from <session>`. A click on either goes to the other.
- **Pick the corner Sprout folds into**: right-click the Sprout button → **Fold to**, or Settings → General → Window
  → Fold to: top left, top right, bottom left or bottom right. Folded, Sprout moves there at once; a drag still keeps
  its own spot until you pick a corner again. <!-- big --> <!-- shot: 0.15.12-fold-corner.webp -->
- **Close several agents at once from the Consumers panel**: hover a row and tick it, or tick Sleeping to pick every
  sleeping agent, then press Close in the bar under the list. It asks first only when a ticked agent is working; the
  closed agents' conversations stay under Conversations. A run's lead and workers still close with their run. <!-- big -->
  <!-- shot: 0.15.12-close-agents.webp -->
- **Pick one project's sleeping agents in the Consumers panel**: when the agents asleep come from more than one
  project, Sleeping lists them under a head per project, with a tick that picks just that project's.
- **What's new**: click the version at the bottom right for the latest release notes, a headline each (click one for
  the rest); **Try it** on a note takes you to that feature. The shortcuts button beside it is now a round help icon. <!-- big -->
- **Code browses folders that are not git repositories** (from the kaeltran16 fork): a plain folder picked in Code
  lists and searches its files, skipping `node_modules`, build output and dot-folders; Changed and Diff are greyed
  out with the reason. <!-- big -->
- **A finished Check, Verify or Final step keeps its output**: click the step in the final stage pane or the run's
  rail to read it after the next step has started.

### Changed

- **Setup says where a skill's copy is, not "Synced"**: a cell now reads **Up to date** or **Out of date** against
  the copy in that harness's skills folder on this machine, and the side panel lists those folders under Copied into.
  The Instructions tab says Up to date too.
- **Setup → Skills separates your skills from arcterm's**: the vault's skills sit under **Your skills** (with Edit) and
  **Ships with arcterm** (read-only); the side panel is wider and grows with the window, and its SKILL.md scrolls with
  the panel rather than in a second scrollbar of its own; **Manage … in arcterm** shows only while a skill sits outside
  the vault.
- A run whose lead tab is closed looks the same in the Agent sidebar as one whose lead is open: same mark, title and
  line under it; only the token count is missing.
- **The Cockpit badge counts only agents that need you**, matching its "need you" tab. Runs to confirm or land,
  approvals, escalations and due chunks are counted on Jarvis, where you act on them.
- **Open a tool moved to `Ctrl+Shift+O`** (`Cmd+Shift+O` on a Mac), freeing `Ctrl+Shift+T` for reopening an agent.
- **Folded, Sprout tells you first**: while Sprout is folded and another app is in front, an agent that needs you
  shows only Sprout's bubble; the system notification follows 30 seconds later, and only if it still waits on you.
- **Subagent questions name the model**: when an agent asks to start a subagent with no model set, or on Opus, the
  question says so and suggests haiku for collecting or sonnet for code; answer No (or Tab) and name one to switch.
- **What's new leads with each release's highlights**: a few cards for the features worth trying, and every other
  note, fixes too, folded under one "58 more changes · 12 fixes" line.
- **Python and pnpm projects wait their turn for RAM too**: an agent's whole `pytest` run (bare, `uv run` or
  `python -m`), `pnpm test` / `pnpm build`, `astro build` and an `e2e.sh` script now queue in Jobs like a build,
  so parallel workers no longer get killed for low memory; one test file or a `-k` filter still runs at once.
- **Jobs on Windows watches the commit charge**: once the memory handed out passes the RAM (the machine is paging),
  heavy commands start one at a time, and past 130% with little RAM free none start until it eases, instead of
  piling on while a few GB still read as free.
- **A conflict with the base at land goes to a resolver session**: in the files your project lists in `.arc/union-merge`
  (such as `CHANGELOG.md`), lines both sides only added are all kept, the base's first; any other conflict gets one
  resolver agent in the run's landing tree, and the land is held, naming the files, only if that fails.
- **The Jarvis graph peek is gone**: `Shift+G` on Jarvis and the record peek's **Where it sits on the map** no longer
  open the vault graph, which drew mostly unlinked dots. A record's runs are still listed in its peek.
- **A tidier agent header**: Open a tool, Float and Redraw moved into a new `…` button (the same menu as a right-click
  on the header), leaving `…`, Split, Fullscreen and Close. A project folder in the sidebar no longer shows a `+` on
  hover; open a terminal from **New**.
- The folded Sprout's "Restore, don't fold for" is one box now: click into it and 1 hour and till 8:00 pop up over
  the card, or type a time as before.
- **Close the agent or terminal in focus with ⌘⇧W on a Mac**, the same shape as Ctrl+Shift+W on Windows. ⌘W on its
  own now does nothing.
- **One click on the folded Sprout opens its card of agents and terminals** and keeps it open, instead of the Jarvis
  chat: pick one to float on it, or open the chat from the card. Click Sprout again, press Esc or click away to close
  it; a double-click still restores the window.
- **Anything at work is green, never the accent**: a working agent's dot, glyph and header, subagents, a run's lanes,
  strip and graph, the Jobs queue and an effort's active chunk are now the status green, so in a theme with a blue
  accent (Spider, Graphite, One Dark…) a working agent no longer reads as the selected one. In a run's strip and an
  effort's bar the done segments are the same green dimmed.
- **A run's land commit gets a conventional subject** (`feat(cockpit): <plan title>`), typed from the branch's own
  commits, instead of the bare plan title.
- **A land held only by uncommitted changes in the checkout lands by itself** once they are committed, stashed or
  moved aside; the lead's `complete` now prints `landed <sha>` or `held: <reason>`, and its wake names every land
  blocker, not only conflicts.

### Fixed

- **arcterm's icon shows at small sizes on a Mac**: in Finder's list view, app lists and other small places it was a
  noisy red-and-blue square instead of the t> mark.
- **Runs that finish together land one after another** instead of each after the first being held. A land waits its
  turn in its project (`Landing · #2 in line` in the Agent tree), merges the base into the run's branch itself and
  re-runs Check and Verify on the result, so you no longer merge `main` into a branch by hand before Land again.
- **A queued run waiting on a held run starts once you land that run anyway**, with Land again or
  `wsh runs land --force`, instead of staying blocked until you press Start now.
- **A finished run no longer waits to land on a file in your checkout that already matches the run's version**,
  such as a generated copy a dev build rewrites. A real edit of yours to a file the run changes still holds it.
- **An ended session shows in Conversations right away** when its tab stays open: after `/clear`, after quitting
  claude and starting it again in the same terminal, or after resuming another session there. A session marked for
  later now stays at the top of its project instead of sinking under "Show more".
- Long names no longer run into the CPU and RAM columns of the RAM popover; they end in "…", with the full name on
  hover. A run with many tasks no longer spills its task strip out of its card in Conversation History.
- A run whose plan review failed no longer shows a green check on its finished fold in the Agent sidebar: the fold
  shows a red dot and "1 failed" until the lead's next round replaces that review.
- What's new shows the open arrow only on notes that have more to read; a short note that already shows in full no
  longer has one that does nothing.
- **A pick in Claude's own question dialog no longer comes back as dismissed** on a Team or Enterprise Claude account,
  and the arcterm card stays the one waiting for your answer instead of being swapped for another.
- **The Token burn card asks again on each prompt** on a Team or Enterprise Claude account: one allow or deny held for
  the rest of the session, and its estimate now counts what the session has already used.
- The Heavy jobs popover names a run's Check, Verify, Setup and Final steps by the run's title instead of only its short
  id ("Run 973afb").
- **Sprout names the project** when it says an agent finished or is waiting at a permission prompt: the project
  sits beside Notice / Needs you, as it did on the toast.
- **Sprout folds to where you last dragged it** instead of always the bottom-right corner, where it covered the buttons
  many pages keep there (a chat's heads, a help bubble). Drag it once and the next fold lands it in the same place.
- **A folded project folder in the Agent sidebar stays inside the sidebar** when its agents are running: its running
  agents read as the working dot and a number, its agents and terminals as a mark and a number each (hover for the
  words), and the project's name always shows.
- **The Dock icon brings arcterm back over a full-screen app on a Mac**: with the window folded into Sprout above a
  full-screen app, clicking the Dock icon (or ⌘Tab, or a double-click on Sprout) now takes you to arcterm's desktop
  instead of leaving the screen on the full-screen app.
- **Mission Control shows arcterm while it is folded into Sprout or pinned in Float on a Mac**: a window kept on top
  used to be left out of Mission Control altogether; now it shows there with your other windows.
- **A sleeping agent keeps its conversation's title** instead of reading as its project's name: when it slept long
  enough ago that newer conversations pushed it out of Conversations, its title now comes from its own transcript.
- **Resuming a conversation that a tab already holds takes you to that tab** instead of opening a second one on the
  same conversation, whether it is awake or asleep, from the command palette, New's Resume list, Open asleep or
  Conversations. A message typed with the resume wakes the agent with it, or goes to it if awake.
- **pi loads the arc package from arcterm's own repository** (`github.com/ttqteo/arcterm`) instead of the upstream
  fork's; an entry an earlier build wrote for the fork is replaced on the next launch.
- A resumed session's tab is named after the session instead of the project.
- `wsh jarvis dag submit` no longer stops at a bare timeout: it says whether the plan landed, did not land, or
  cannot tell, and `dag status` shows whether a plan review is running or failed.
- The shared instructions editor in Setup wraps long lines instead of scrolling sideways.
- Files an older arcterm build installed into the Claude mod folder are removed when a newer build drops them.

## 0.15.11 — 2026-10-13

### Added

- **Stop the fold that follows you out of arcterm for a while**: with "Fold when you leave arcterm" on, the folded
  Sprout's hover card restores the window and holds the fold off for 1 hour, until the next 8:00, or until a time you
  type (`2h`, `30m`, `14:30`). While it holds, the card says until when, with Resume to end it.
- **The New agent dialog says which Claude account a Claude Code launch runs on** ("· Claude: Max 2", or your
  /login email for Default), once you have added a token account in Settings → Agents → Claude account. With only
  /login, the footer is unchanged. <!-- try: new-agent --> <!-- big -->

- **A library of terminal tools (lazygit, yazi, btop and more) that opens in the right folder**: Setup → Tools lists
  nine built-in tools and any of your own, shows which are installed, and installs one with winget or brew in a
  terminal you can watch. **Open a tool** (`Ctrl+Shift+T`, the agent header's Tool button, the tool button on a
  project folder, or Search) opens one in the focused agent's folder, and the New dialog's Tool row opens one in a
  project's root. <!-- try: open-tool --> <!-- big -->
- **Resource Manager** (from the kaeltran16 fork): the footer shows arcterm's CPU and RAM; click it, or `Mod`+`G` `m`,
  for a popover of every process arcterm and its agents started, grouped by agent, with `x` to kill a runaway process
  and its children (asks first, never the agent itself). <!-- big -->
- **Mark files reviewed in the Diff surface's log**: a check at each file's right end, `v` or **Mark reviewed** in the
  diff header to mark the open file and step to the next unreviewed one, and an _n/m reviewed_ bar over the list. <!-- try: go:files --> <!-- big -->
- **Notes in the palette**: the palette's Notes scope lists, previews, copies, edits and deletes your notes, and
  `wsh note add` lets an agent write one. <!-- try: go:palette -->
- **A run's final stage has its own row**: a Final verification row under the run in the agent list, with the step
  pipeline, the running command and End final stage, and the stage as the last node of the run's DAG.
- **A missed prompt cache is named**: when a Claude turn re-billed a cache miss, a line above Claude's prompt says
  how much, and arcterm shows it as a notice.
- A new waiting item flashes arcterm's taskbar button while arcterm is in the background.
- A finished orchestrator run takes one more round for the leftovers inside its goal before it completes.
- Spider-Man as a third Jarvis character (Settings → Appearance → Character): the Homecoming suit at work, Peter Parker at rest. He walks the footer side-on, thwips when he speaks, hangs from a strand when you drag him and rappels down when you let go, now and then crawls along under the app bar and hangs upside down until your cursor comes near, web-swings out and back when the window folds, and folded sits on a rooftop whose windows light up for each running agent, with his web and the count of agents at work beside it. <!-- try: go:settings --> <!-- big -->
- A Spider theme (Settings → Appearance → Theme): Claude's colours with the suit's soft blue as the accent and its red
  in the spider decor, a spider in place of the arcterm logo, a small spider that drops on its thread over the agent list and
  senses an agent asking you, another hanging over the empty Agent screen, and a web in the top-left corner behind
  the sidebar's icons. Picking Spider-Man as Jarvis asks whether to switch to it, and as Jarvis he now and then says a
  line from his films.
- **Your design canvases are back after a restart**: the palette (search “canvas”) lists the canvases in the
  selected agent’s project, and opening one shows it on that agent. <!-- try: go:palette -->
- **Usage → Insights answers in English or Vietnamese**: an EN / VI switch beside Analyze picks the language, and
  re-runs an analysis that is on screen in the other one. <!-- try: go:usage -->

### Changed

- **A smaller Jarvis popup**: the harness and the project a question goes to are one line of small text under the
  field instead of two dropdowns. Folded into Sprout, the popup only shows what waits on you and a reply already on
  its way, with no field to ask in; restore the window to ask.
- **The folded Sprout's "don't fold" box says what it takes**: it reads "Custom…", and shows "e.g. 2h, 30m, or until
  14:30" once you click into it.
- The RAM popup on Windows now shows what arcterm's total is made of, on one line under the agents: Agents,
  Interface (the webview), Server, Host and Terminals.
- **Agent rows in the sidebar are calmer.** Background commands an agent left running no longer mark its row (Servers
  and the rail's Background tasks list them; Close still waits for them), its canvas is a grid icon beside its name,
  Close is a green check alone, and the Later bookmark is grey instead of yellow.
- **Choose what an agent row shows**: Settings → Appearance → Agent sidebar turns its model, branch, tokens and age on
  or off. All stay on unless you turn one off. <!-- try: go:settings -->
- **A split no longer moves anything in the sidebar.** Its agents and terminals keep their rows in their own folders,
  each marked with a split icon, so the row you click stays under the pointer (Remove from split and End split are on
  the row's menu). Moving between a split's cells keeps the agent's header and details panel, so the panes no longer
  jump in size when a terminal in the split takes the focus.
- The app bar's usage meters keep to Claude's 5-hour and weekly windows: a model's own weekly window (Fable wk) is
  only on the Usage surface now.
- **The New dialog lists everything in three columns and keeps one height**: Agent, Project, and the pick's own list
  (an agent's sessions, the tools, a run's model or its start and width). A long project or session list scrolls in
  its column instead of growing the dialog; type in the Session column to filter it, as in Project, and Home is `0`.
  It now offers up to 30 recent sessions to resume, not 5.
- **On Windows, Alt+Tab back to a folded arcterm opens it maximized**, in Full, whatever size it was folded from (Full,
  Float, or a smaller window); the taskbar button does the same. On macOS ⌘Tab still gives back the size it folded from.
- **The Resource Manager is now part of the Consumers panel.** On Windows the app bar's RAM chip opens Consumers again,
  one line per agent: its CPU, RAM, spend of the last 10 minutes, and the heaviest command it runs
  (`git log --all -p`), with Kill, Switch to Sonnet, Sleep and Stop in one ⋯ menu; the header reads free RAM, what
  arcterm itself holds and its CPU share, and the 5-hour quota on one line (`6.2 GB free · arcterm 5.9 GB · 4% CPU`).
  The separate popover and `Mod`+`G` `m` are gone. On macOS the panel is unchanged.
- **A sleeping agent reads apart from an idle one in the sidebar**: a moon takes its ✳ at the head of the row and the
  row fades, its age is how long it has slept.
- **Alt+Tab back to arcterm opens the window again from Sprout**, however it was folded (the Sprout button, minimize,
  or Fold when you leave), as ⌘Tab does on macOS; a click on Sprout itself still leaves it folded.
- **Spider-Man shows the same working dots as Sprout** in place of the small web, which read as a green smudge.
- **RAM is read in one place.** On Windows the app bar's RAM chip opens the Resource Manager, which now names Arc's
  total CPU and memory and the free RAM at its top; the footer's `Arc … CPU` readout is gone, and Consumers keeps
  tokens and spend alone. On macOS the chip opens Consumers by RAM as before.
- **The Resource Manager shows an agent and the commands it runs**, not every launcher, console and wrapping shell:
  they fold into a `+ N helper processes` line that opens the whole tree, and an agent running nothing starts folded.
- **A project folder in the Agent sidebar says how many of its agents are running**, open or folded; its hover keeps
  only the `+` for a new terminal, and a tool opens from New.
- **The free RAM and the plan-usage meters in the app bar are now one button**, since both open the same panel: click
  the RAM figure for the list ranked by RAM, the meters for it ranked by tokens. Hovering a meter now says when the
  window resets ("resets at 14:30", "resets Tue 09:00") instead of repeating the countdown.
- **Usage → Insights ranks what to change by what it would save**: each fix (long context, oversized reads, noisy
  Bash output, Opus on clear work, cold resumes) shows at most how much of the window's spend it recovers, the tabs
  behind it open with a click, and a General tips row holds advice your numbers do not measure. Re-analyze once to
  get the new card. <!-- try: go:usage -->
- **Terminals sit with their project's agents in the sidebar and open in the centre**: the Active and Terminals
  sections are one tree, a folder per project with its agents, then its terminals and tools. Picking a terminal (in
  the tree, with `j` / `k`, `Ctrl+Tab` or Search) shows it in the centre, and a quick `Ctrl+Tab` goes back to the
  agent. A terminal can also take a cell in the split. One whose folder was removed (the worktree of an agent that
  landed) offers to reopen in the project.
- **The terminal panel folds to a strip** showing the terminal's name and latest output line; `` Ctrl+` `` opens and folds
  it. Moving a terminal into the panel is now a button, not what picking it does.
- **The sidebar's Conversations section and its project folders open and close smoothly**: folding them slides their
  rows closed instead of dropping them at once.
- **A run's line in the sidebar fits again**: it reads `Plan review · 0/11` and no longer cuts off at the count;
  whether its lead has started is in the tooltip, and in a narrow sidebar the workers chip keeps just its number.
- **Click a file's path to copy it**: in the Agent panel's File tab and in Code, the path at the top copies its full
  path on click, in place of a separate copy button.
- **Right-click in a terminal copies or pastes**: with text selected it copies it, with nothing selected it pastes;
  right-click twice to open the terminal menu. Highlighting text now copies it by default too. Both are switches in
  Settings → Terminal (Copy on select, Right-click to paste).
- **A canvas with too many boards for a row of tabs shows three of them**, the open one with its neighbours, between
  ‹ and › that step to the previous and next board as [ and ] do; beside them, where you are (4/8) opens the menu of
  every board.
- New dialog: a session picked to resume is forgotten once the dialog has been closed for more than two minutes, so a
  later New starts a new session instead of a resume you forgot about. What you typed is still kept.
- **An ended session's transcript has a message box**: type the next message and press Enter to resume the session
  with it (empty, Enter just resumes); Shift+Enter is a newline.
- **The New dialog's Transcript button moved to the footer**, beside Launch, with its key Shift+Enter, which now opens
  the picked session's transcript from anywhere but the Task box, and Launch shows its key as Enter.
- **A sleeping agent's conversation has a message box under it** on the Agent screen: type and press Enter to wake the
  agent with that as its next message, without pressing Wake first.
- **New dialog: Open asleep** replaces Transcript beside Launch (Shift+Enter) when a Claude, pi or agy session is
  picked to resume: the session goes on the agent list asleep, showing its conversation, and starts only when you wake
  it or send it a message. A codex session, which cannot sleep, keeps Transcript.
- **Ctrl+V in the New dialog pastes into the Task** (or a run's Goal) wherever focus is outside a text field, images
  included, and leaves the cursor there.
- **An agent's ✳ in the sidebar now shows its state** in place of the dot on its second line: it pulses in the accent
  colour while working, in yellow while asking, and goes grey when idle or asleep.
- **Fold when you leave** is simpler and calmer: on Windows it folds only when the app you switch to is maximized or
  full screen on arcterm's screen and stays in front for about 3 seconds, so a dialog or popup that grabs the focus while
  you watch something no longer folds it. It grows back as soon as you come back to arcterm, by Alt+Tab, the taskbar
  button or a click. A fold from the Sprout button or `Ctrl+M` stays until you double-click Sprout, press `Ctrl+M`
  again, pick **Restore**, or click arcterm's taskbar button (the Dock icon on macOS).
- **One click on the folded Sprout opens the Jarvis chat, a double-click brings the window back**, and `⌘M`
  (`Ctrl+M`) folds and unfolds. The card that shows when the cursor rests on Sprout lists your agents and has an **Ask
  Jarvis** row too; a cursor that only passes over Sprout no longer pops the card, and the card shows even while Sprout
  is speaking.
- **On macOS the folded Sprout follows you to every Space**, beside a full-screen app too, instead of staying on the
  Desktop you folded it on.
- The launcher's **Transcript** button on a picked session spells out its key, **Shift+Enter**, in place of ⇧⏎.
- In the launcher, **Task is wider than Resume** (6 to 4) when there are sessions to resume, so a long task has more
  room to type in.
- **Usage → Analyze now sees oversized tool results**: whole-file reads and long command output (over 20k characters)
  are counted per tool and per tab, and its advice names concrete fixes such as reading a file by range, making a
  command print only failures, or compacting before you step away. <!-- try: go:usage -->

### Fixed

- **An initiative's progress bar no longer paints its next chunk in the accent colour**, which read as work under
  way when nobody had picked it up. Only a chunk actually marked active is accent; the next one stays grey.
- **The folded Sprout's Jarvis chat closes when you click away** to another app, as a popup should, instead of
  staying open over it.
- **A Claude agent that restarts on Claude Code's classic renderer scrolls again.** When arcterm restarted while a
  resumed Claude was still starting, Claude Code fell back to its classic renderer on the next launch and drew it
  inside the fullscreen screen left over from before, which has no scrollback, so the wheel did nothing.
- **A canvas with only a few boards has ‹ and › beside its tabs too**, and on a canvas `←` / `→` step the boards as
  `[` and `]` do (`↑` / `↓` and `j` / `k` still move between agents).
- **Closing the agent or terminal you are looking at opens the one beside it** in the sidebar (the one below, or above
  when it was last), instead of jumping back to the first agent.
- **Usage no longer sits on its loading placeholders after arcterm starts**: the first scan of your transcripts could
  outlast a 5-second limit and lose its answer, leaving By session and Subagent cost blank until you switched the
  window. The scans now get up to a minute, and opening Usage reads each transcript once instead of up to three times.
- **A dev server whose launcher exited still names the agent that started it.** `pnpm run dev` on Astro 7 starts
  the server and returns, so the agent's Servers list read `already running` and the footer's Servers popover read
  `no owner`; both now say the agent, and its log opens from the task that started it.
- **A long "Open …" link in the Jarvis card no longer runs off its edge**: it ends in "…", and hovering it shows the
  whole title.
- **A sleeping agent keeps its title in the Agent sidebar** instead of showing only its project name: the row reads the
  conversation's title from Conversation History while the agent has no process to report it.
- **Spider-Man's corner web no longer splits in two** after opening the Agent surface from another one: the tree's
  half sat at the tree's own edge until the window was resized.
- A sleeping agent stays on the agent list with its conversation after arcterm restarts or reloads, instead of
  turning into a plain terminal or losing its transcript.
- A plan run no longer cancels itself at submit when its plan or spec differs from the committed copy only in line
  endings (a file saved with Windows CRLF).
- **Fold when you leave** no longer folds arcterm for a screenshot, the lock screen, Alt+Tab's switcher or the Start
  menu.
- **Fold when you leave works on macOS**: switching to an app whose window covers most of arcterm, such as a maximized
  Chrome, folds it into Sprout. Before, nothing folded it on a Mac.
- Settings: **Fold when you leave** now describes the rule of your OS: on Windows only a maximized or full-screen
  window folds arcterm, however big an unmaximized one is; on macOS any window covering most of arcterm does.
- **A window folded on leaving grows back on ⌘Tab** on macOS: coming back to arcterm with ⌘Tab sometimes left it in
  Sprout until you clicked the Dock icon.
- On Windows, Sprout folded on leaving now floats above the app you switched to instead of hiding under it, and a
  return to arcterm grows it back even when the fold came while that app was in front.
- The mouse wheel scrolls Claude Code's fullscreen view again after arcterm restarts or reloads its pane.
- An agent with a background task still running is no longer offered **✓ Close**: closing it would end that task.
- Jarvis: opening a long run goal with **Show more** no longer pushes the run's tasks and its bottom bar (with the
  screenshots button) out of the sheet; the goal scrolls on its own instead.
- Jarvis: a run's **Screenshots** button and Final check row no longer vanish while a later Final round runs; they
  keep showing the last finished round, marked with its number.
- Agent sidebar: clicking the top row of a run started from a plan (it has no lead) now shows the terminal of the run's
  agent that is asking or working, such as its plan reviewer or a worker, and a double-click lets you type into it.
  The click used to fold and unfold the run, so a double-click did nothing; the workers chip still folds it.

## 0.15.10 — 2026-10-12

### Added

- Jarvis: a **New run** button in the header, **Work on this chunk** in the chunk panel, and ideas you jot down
  inline. <!-- try: go:jarvis -->
- **Type straight into the task in the New dialog**: with focus on the Start column, a letter moves you into the Task
  box (or a run's Goal) with that letter in it, so a digit, then the task, then Enter launches.
- **Images open in the Agent panel's File tab and in Code**: a `.png`, `.jpg`, `.gif`, `.webp`, `.svg` or other image
  shows fitted to the pane, with its size underneath; click it to see it at its own size. It showed "Binary file"
  before.
- **Tick a task box in a markdown Preview**: in the Agent panel's File tab, clicking a `- [ ]` box ticks it (or clears
  a ticked one) and saves the file.
- **A server running in one of arcterm's terminals says which terminal** in Servers, and its Log opens that terminal
  with its search box.
- **A run's own actions on its row's right-click menu** in the agent tree: Open in Jarvis, Open the DAG, Open the
  diff, Workers at once, Resume, Stop a worker, Copy run id and Cancel run, each offered only when it applies, as in
  the command palette.
- **Read a past session without resuming it**: in the New dialog's Resume list, **Transcript** on a session (or
  Shift+Enter, which the picked session's button shows) opens its transcript on the Agent surface instead of starting
  the agent again. <!-- try: new-agent --> <!-- big -->
- **A `?` button on the bottom bar** opens the keyboard shortcuts on every surface, also while you type in a
  terminal, where the `?` key itself is text. <!-- try: help -->
- **⌘⇧Enter toggles terminal fullscreen** (Ctrl+Shift+Enter on Windows), from inside the terminal too: the same
  chord on both platforms, since a Mac keyboard has no F11 of its own. F11 still works.
- **Fold when you leave**: switch to another app whose window hides arcterm (maximized or full screen on its screen)
  and the full window folds into Sprout after a moment; an app beside it, or on another screen, leaves it be. Coming
  back to arcterm (Alt+Tab, the taskbar) focuses Sprout, and a double-click or Restore grows it back. Off by default;
  right-click the Sprout button in the app bar to switch it, or Settings → General → Window. Your own dialogs (a file
  picker) leave it be. <!-- big -->
- **⌘J opens Jarvis's What's waiting popup** in one chord, from any surface and from inside a terminal (Ctrl+J on
  Windows, where Shift+Enter is the terminal's newline). Hold ⌘ on its own and the creature shows a J. <!-- try: go:waiting -->
- **@mention another agent** without looking up its id: right-click an agent in the sidebar (or a segment of the split
  row) → **Copy @mention**, its `@` token shown beside the label. Or drag an agent onto a Claude agent's pane holding
  ⌥ (Alt on Windows) to type its token at that prompt; a drag without the key still places it in the split. <!-- big -->
- **Home** in the New agent dialog: the last row of the Project column starts Claude Code or a terminal in your home
  folder, outside any project. Claude Code there is ask-only: it cannot edit files, every shell command asks first
  (even one you once allowed for good), keys and `.env` files stay unreadable, and bypass and auto mode are off.
  Resuming one of those sessions keeps it ask-only. <!-- try: new-agent -->
- Your pet (Sprout or the Minion) **teleports** when you minimize into it and back: it turns to light and leaves in a
  blue beam from where it walks, then lands in the screen's corner on a ring with a burst of sparks; Restore plays it
  the other way. Reduced motion skips it.
- **Ctrl+Tab** on the Agent surface opens a tab switcher over the terminal, as the system's app switcher works: hold
  Ctrl and press Tab to move through your agents and terminals, most recent first, then let go to open the one picked.
  A quick Ctrl+Tab flips back to the tab you were on before, and passing over an agent leaves its unread turns unread.
  It works the same in a float and in fullscreen, and Option+Tab works too on a Mac. Ctrl+Shift+Tab now steps back
  through the switcher; it no longer jumps to the next agent that is asking. <!-- big -->
- **Code** can pin files: right-click a file → **Pin**, or **Pin** in the bar above the editor. Pinned files list at
  the top of the Files tab, per project; clicking one opens it and shows where it lives in the tree, and the
  file search (Ctrl+P, ⌘P on a Mac) lists them first. The agent panel's **Files** tab shows the same pins above its
  tree for the agent's folder, and right-clicking a file there pins or unpins it on both sides. <!-- try: go:code --> <!-- big -->
- An **HTML file** opens as the page itself in **Code** and the agent panel's file tab, with **Source** one toggle
  away: images, styles and scripts beside it load, so an exported slide deck shows and pages through as it would in a
  browser. It shows the saved file, and a page too big to open as text still previews.
- **Locate** and **Collapse All** at the top of Code's file tree and of the agent panel's Files tab. Locate opens
  the folders down to the file you are reading and puts it under the cursor, in the middle of the list (IntelliJ's
  Select Opened File); Collapse All closes every folder.
- The agent panel's file tab has a **Pin** button, as Code's path bar does: it pins the file in the agent's folder, to
  the same Pinned list the Files tab and Code show.
- **Outline on the agent panel's File tab**: a markdown file in Preview lists its headings, as Code does; pick one to
  scroll there.

### Changed

- Jarvis: **Waiting on you** shows its first three items, **Runs** come before **Initiatives**, and **Since you
  looked**, **Shipped** and **Ideas** sit in a column beside them.
- Jarvis: initiatives are one-line rows, blocked ones first, that open in place.
- An unverified run is accepted with **Accept** (was Acknowledge).
- Runs read one way everywhere (Working, Final check, Wrapping up, Landing, Landed), and a run's strip ends in three
  pips for Final check, Wrap-up and Land, so all tasks green no longer reads as finished.
- **Tidier file headers**: in the Agent panel's File tab, Outline, Wrap and Pin are icon buttons now, and so are Wrap,
  Pin and Copy path above Code's editor; a pinned file shows a filled pin instead of the word "Pinned".
- **An agent in a worktree reads clearly in the Agent panel**: the branch moves to its own line beside the
  worktree's short name, so the project name keeps its width, and a run's long id shows as its first 8 digits (the
  full name is in the tooltip).
- **The RAM and tokens panel is redrawn**: a bar of your RAM (arcterm, other apps, free) under the free-memory line,
  column heads, tokens and spend in their own columns, and a row's Stop, Sleep and → Sonnet only when you point at it,
  so agent names get the room. arcterm's own processes fit on one line.
- **Ctrl+C copies in a terminal on Windows while text is selected**, as in Windows Terminal and VS Code; with nothing
  selected it is the interrupt as before. **Copy on select is now off by default**, so highlighting what you read no
  longer replaces what you copied; Settings → Terminal turns it back on.
- **A double-click on a sidebar row opens the agent**, typing in its terminal; it used to fold a run's workers or an
  agent's subagents, which their chip still does.
- **A canvas with many boards stays readable**: past four boards the header picks the board from a menu (with
  `[` and `]` still stepping), the header's buttons no longer get cut off, and All shows the boards as a grid of
  tiles at least 560px wide instead of shrinking them all into one picture. A click on a tile opens that board.
- **⌘, / Ctrl+, opens Settings**, as in VS Code, and **⌘⇧E / Ctrl+Shift+E** focuses Code's file tree (VS Code's
  Explorer key; Alt+T still works). <!-- try: settings -->
- The **Launch a Pi tab** shortcut (⌘⇧N / Ctrl+Shift+N) is gone; the New dialog's Pi row starts one.
- **Every file wraps long lines by default** in Code, Diff and the agent panel's File tab, not only prose; **Wrap**
  (Alt+Z) still turns it off for a file.
- **More config files are colored** in Code and the File tab: `.env` and `.env.*`, `.toml`, `.conf`, `.cfg`,
  `.npmrc`, `.gitignore` and the other ignore files, `.jsonc`, `.json5`, `Dockerfile.*`, `.zshrc`, `.bashrc` and
  `.envrc`. Comments in `tsconfig.json` and `.vscode/*.json` no longer show as errors.
- An agent's model shows its version, **opus 5.5** rather than **opus**, in the sidebar, the agent header, the tab
  switcher and a lead card's workers.
- **Minimize into Sprout** always lands Sprout in the bottom-right corner of the screen (above the Dock on a Mac),
  rather than wherever Sprout happened to be walking, so it is always in the same place. You can still drag it
  anywhere while folded; the next minimize puts it back in the corner.
- **⌘W** closes the agent or terminal in focus, as a terminal app closes its tab (Ctrl+Shift+W on Windows, where
  Ctrl+W still deletes a word in the terminal). It works from inside the terminal and asks first, and it no longer
  closes arcterm's window. Ctrl+C twice no longer closes an agent: it always goes to the terminal.
- A **sleeping agent** shows its conversation where its terminal was: the terminal kept only the lines printed before
  the agent started and the kill that put it to sleep. **Wake** brings the live terminal back.
- Images attached to a **new agent's task** show as pictures in its transcript, not as a list of paths. They are kept
  in `~/.arc/attachments` rather than a temp folder emptied after a day, so the pictures stay; **Settings → Storage**
  removes them under Logs, cache and trash. An image whose file is gone is named in its place.
- In the **New agent** dialog, **Resume** now sits left of **Task**: pick the session first, then write what to send
  it, the first prompt of a new session or the next message of a resumed one. Tab follows the same order.
- The counts beside the **Agent panel**'s tabs (files changed, uploads, background tasks…) toggle their section: a
  click closes one already open on screen, and opens it, scrolled into view, otherwise.
- The **Split** menu's **Show only this agent** is now **Close split**.
- The **File** tab's header shows the file's whole path, `slides/slide.pdf`, not only its folder, and a middle click
  on the tab closes it, as an editor's tab.
- **New** starts on the project of the agent or terminal you are focused on in the Agent surface, rather than the
  last project picked in the dialog. A draft you closed keeps the project it was written for.
- arcterm reopens at the **size and place** you left its window, maximized or not, instead of its default frame
  each launch. Quitting while in Float or folded into Sprout reopens at the full window you came from, and a window
  left on a display that is gone opens at the default.
- The **Agent panel** slides between Overview's width and a wider tab's (Files, an open file), as it slides when it
  opens and collapses, instead of jumping.
- The **File** tab keeps your place: switching agents, tabs, or Back and Forward brings a file back where you left it
  in Source, Preview and Diff, not at the top. A file opened afresh from a link still starts at its line. A PDF or a
  web page still opens at the top.
- Diff's **Log** shows who made each commit again: a round mark with the author's initials beside its age, and the
  author's name, email and the exact date when you hover the row.

### Changed

- The Token burn card prices a spawn from what finished subagents of the same type cost (general-purpose, Explore,
  fork…), with a likely range, and says how much of the 5-hour and weekly windows the agent's session has used so
  far, its subagents included. It also asks when the week is 80% used (`tokengate:weekpct`) or the session has used
  25% of the 5-hour window (`tokengate:sessionpct`). `wsh tokengate review` shows how far the estimates of the last
  week were from what ran.

- **Usage → By session** shows each tab's share of the 5-hour and weekly quota windows (**5h**, **Wk**), and a
  **Subagent cost** card lists what each subagent type costs: the figures the Token burn card prices from.

### Fixed

- **A long document's Outline is readable again**: with many headings, the list squeezed every row down to a sliver
  instead of scrolling.
- Jarvis: `i` focuses the run sheet's composer; a blocked run no longer reads green; the tour's first card no longer
  covers the Waiting controls; a chunk note whose run is gone says so instead of loading forever.
- **← → in the Final check viewer walk every screenshot**: past a scenario's last shot they go on to the next
  scenario, so a round of plain screenshots (one per tab) no longer leaves the arrows doing nothing, and the selected
  tab scrolls into view.
- **A file an agent names from another folder opens on Ctrl+click**: when an agent writes a path relative to the
  folder it is working in (`huong_C/plan.md` rather than `notes/huong_C/plan.md`), the link now finds the file it
  read or wrote there, in its terminal and in its transcript. Before, it was not a link at all.
- **Images pasted into the New dialog's Task show in the transcript again**, live and when you read the session
  back, instead of "no longer on disk". In the New dialog itself a click on a pasted image now shows it larger.
- The **RAM and tokens panel lines up in columns**: the model, RAM, tokens and each button (→ Sonnet, Sleep or
  Wake, Stop) keep one place down the list instead of moving row to row.
- **No more red spellcheck underlines** in text fields (the New dialog's Task, the composer, comments): the
  built-in spellchecker marked every Vietnamese word as wrong.
- A run's task strip draws a **working task in blue**, so it no longer looks like a failed task's red.
- A sidebar row with both a **canvas** tag and **Close** no longer runs past the sidebar's edge: beside the canvas tag
  Close shows only its check.
- **Esc closes a terminal's search box** and puts you back in the terminal, as its Close button's tooltip says; it did
  nothing before.
- Switching to an agent whose panel you left on **Files** now opens it on Files at once: it no longer slid to
  Overview's width, flashed Overview, then slid back once the agent's git status loaded.
- In the Spec review dialog, **a decision points at its place in the spec** when you rest on it or click it, even when
  the spec is written in another language: it matches the names it shares with a passage (`release_items`,
  FieldPolicy, /infra), and dims the rest down to that one list item. The **SPEC REVIEW** label no longer wraps.
- **Zoom on a Mac is ⌘= / ⌘- / ⌘0**, as in other Mac apps; it was Control.
- In a review, a click outside the note field under a selected passage closes it; a note already typed there is kept
  in Your notes.
- An agent's model, and a past conversation's in History, no longer reads `<synthetic>` after you interrupt Claude
  or an API error ends a turn: it keeps the model the session last answered with.
- On macOS, a double-click or right-click on a button, the app bar (its search box too), the surface rail or the
  footer no longer selects a word of its text. Text boxes still select as before.
- **Float** shows an orchestrator run as one tab, its lead, not a tab for every worker and reviewer it started;
  Ctrl+Tab and the folded Sprout's list skip them too. A worker you opened keeps its tab while you are on it.
- Holding **Ctrl** shows the **Agent** rail item's digit again: the count of working agents was drawn over it, and
  now steps aside until you let go.
- **Float** has a close button for the agent or terminal it shows, next to **Leave float**, as the agent header has
  outside Float; it asks first, like ⌘W.
- Search's **Files** scope (⌘P) finds a file an agent created after the project's file list was loaded: each time it
  opens, it reads the list again, and the Code tree picks up the new file too.
- A file reached by a jump (**Open in Code**, a pinned file, a search result) lands in the middle of the file tree,
  not on its bottom edge. The arrow keys still scroll a row at a time.
- The agent panel's file tab shows a long file name in full when the panel has room, instead of cutting it at a fixed
  width; a narrow panel cuts the name, never the counts beside it.
- On macOS, `Ctrl`+`Enter` sends your markdown comments from the File tab's Source view too, not only from Preview.
- A Claude session you send to the background from a terminal started as plain `claude`, `claude --continue` or a
  `--resume` picked from the list keeps showing its status and subagents in that tab.
- After a reload, the agent grid comes back focused on the cell you left focused, not on whichever agent loaded first.
- Picking an agent from the search palette while typing in another agent's terminal moves the keyboard to the picked
  agent instead of dropping it, so keys work without a click.
- With a dialog open over Agent, Diff or Code (the shortcuts sheet, a confirm), `Esc` closes the dialog and `j`/`k`,
  `d` and `f` no longer act on the surface behind it.

## 0.15.9 — 2026-10-11

### Added

- **Settings → Storage** shows what arcterm and its agents leave on disk (finished runs' worktrees, old Claude
  sessions, logs, cache and trash, your projects' build output) and cleans each with a button; the safe parts clean
  themselves daily, and a toast says when more than 2 GB can go. <!-- big -->

- Jarvis has a tour: the **?** button in its header walks you through the Brief, Initiatives, the run sheet and the
  Profile one control at a time, in Vietnamese or English, and Jarvis offers it once the first time you open it.

- Before an agent starts a costly batch of subagents or a workflow, a Token burn card shows its context, the
  5-hour window and a rough cost, and waits for Allow, Allow this turn, Allow this session or Don't spawn. A
  single subagent with room in the window runs without asking. Tune it with the `tokengate:*` settings.

- **Setup → Skills** shows a selected skill's SKILL.md in its side panel: the description under the name for
  every skill, then the file itself, read from the copy **Open SKILL.md** opens. A relative link in it opens its
  file in Code.

- A chunk of an initiative can carry a due day (`wsh effort chunk due <effort> <chunk> 2026-10-20`, or `+14d`).
  From that day it waits in Needs you, in the Brief's queue and in Sprout's list, with **Work on** to start an agent
  on what its notes say, and Sprout tells you once when it comes due. It leaves when the chunk is done, deferred or
  skipped, or its date moves on; the chunk's row on the Brief shows the day.

- **Sync now** in **Settings → General → Vault & sync** syncs the vault at once, without waiting for the window to
  regain focus; a failed sync shows in the card's status line in red, and the button stays ready to retry.

- Jarvis can be a one-eyed Minion instead of Sprout: pick it in **Settings → Appearance → Jarvis → Character**. It
  walks, rests and plays like Sprout, wears the same marks, and the flag shirt turns its overalls red.

- Message another live agent from any Claude prompt: start it with `@` and the agent's tab id
  (`@3f2a91bc review this diff`) and it goes straight to that agent's session, not the one you typed in; a line under the prompt says it
  was sent, and a message that could not go comes back to the box with the reason. Right-click an agent card and
  **Copy @mention** copies the id.

- An agent idle for 30 minutes goes to sleep: its process ends and its RAM is freed, but its row and conversation
  stay; **Wake**, or a message to it, picks it up where it was. When RAM runs low the longest-idle one sleeps early.
  Settings → Agents → **Sleep idle agents** sets the time or turns it off; **Sleep** is also in the RAM panel and the
  row's menu. <!-- big -->
- Codex can work a task in an orchestrator run: pick it as the run's Workers (it is listed once
  `~/.codex/config.toml` names a `model`), or write `**Model:** codex:gpt-5.5` (or `codex`, or `agy:<model>`) on a
  plan task and start the run on **Reviewer picks**. A Codex worker runs with its approval, sandbox and hook-trust
  checks off, since no one is there to answer them, and its heavy commands skip the job queue. <!-- big -->
- The Jarvis pet's popup answers every agent question in place, not only one-pick ones: a question with several
  parts or several picks opens its answer form under the row (**Answer**, or `Enter`), where `1`–`9` pick, `←` / `→`
  change question and `Enter` sends. Clicking a "Needs you" bubble lands on that question with its form open.
- Codex agents show working, idle and "needs you" on the rail with their session's title and model, and come back in
  their own session after arcterm restarts. arcterm adds its hooks to `~/.codex/hooks.json`; trust them once with
  `/hooks` in Codex.
- The **Sprout** button on the app bar and on the float bar, and minimize (the yellow button on macOS), fold the
  window into Sprout right where Sprout stood, from the cockpit or a float: the window shrinks into Sprout, which stays
  in place, and Sprout floats over your other apps; hover it
  to see every agent and float on one; click it to answer what waits on you or ask Jarvis; drag it anywhere; and
  double-click it or press **Restore** to get back the window you folded, at the same size and place. `⌘M` (`Ctrl`+`M`
  on Windows) folds too, even from inside a terminal. **Settings → General → Window → Minimize** sends minimize to the
  Dock or taskbar instead. On macOS, a click on arcterm's Dock icon brings a folded window back, for when Sprout is out
  of sight on another Space.
- In a float, Sprout walks a ledge under the terminal, with a count of what waits on you; click it for the Jarvis chat.
  In a float and folded, a "…" beside Sprout's head says how many agents are working.
  Tabs on the ledge, beside Sprout, switch the float to another agent's terminal or to a plain terminal; past five, a
  **+N** menu lists the rest, and `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab` (on a Mac `Option`+`Tab` too) step through them all,
  even from inside a terminal.
  A tab's dot pulses while its agent works or asks, as on the float bar and in folded Sprout's list. The ledge's right
  end shows the plan usage, each provider's 5-hour window with its countdown; hover it for the weekly one.
  In a float and folded into Sprout, what used to be a toast is Sprout's bubble, a permission prompt included; folded,
  it shows even while another app is in front, and what needs you also reaches the system notifications.
- Builds, typechecks and whole test suites from every agent and run now go through one queue that starts each as soon
  as the free RAM allows, so several runs no longer push the machine into swap; the new Jobs chip in the app bar shows
  what runs and what waits, with Run now and Skip. <!-- big -->
- An agent whose build or test waits in the job queue says so on its row and in its header, as `queued #2` instead of
  working, with why it waits (RAM or a busy slot) in the tooltip; a click opens the Jobs popover.
- The Jobs popover's Slots picker sets how the queue runs: **Auto** (the default) as many at once as the free RAM
  allows, **1–4** no more than that many at once, **Off** never makes one wait.
- **Pause the queue for 1h or 4h** in the Jobs popover: every heavy job starts at once until then, the chip counts the
  pause down, and **Resume** ends it early.
- Diff can commit and sync. The Commit tab lists the working tree's files with a tick each (Changes ticked,
  Unversioned not): write a message and press **Commit** or `Ctrl`+`Enter`, and only the ticked files are committed, so
  what another session staged stays staged. **Amend** loads the last commit's message and turns off once that commit is
  pushed. Beside the source picker, **Fetch**, **Pull** and **Push** work on the branch against its upstream and show
  how many commits it is ahead and behind: Pull only fast-forwards and asks first when an agent is working in that
  folder, Push never forces, and a refusal from git is shown instead of changing anything. <!-- big -->
- A run an agent started with `wsh runs start` links back to that session: `↰ <session>` in the run's header on
  Agent and **started from** on its run sheet, which open the session's terminal, or its transcript once it has ended.
  The other way round, the session's header links its runs with `↳`: one opens its run sheet, several
  (`3 runs, 1 active`) a menu of them.
- The Agent panel's File tab has a copy button in its header that copies the file's full path.

### Changed

- arcterm now wears Claude's colors by default: a new **Claude** theme (claude.ai's warm greys, the clay accent and
  Claude Code's status colors) heads **Settings → Appearance → Theme**, and the pi theme follows it. In it the
  terminal keeps a real blue, and the Claude Code mark is ivory like the Codex and Pi marks, so clay stays the
  accent. A theme you picked yourself stays; pick **Graphite** to go back to the old look.
- The Agent panel's File tab is roomier. Its header no longer repeats the file name the tab already shows, only its
  folder. Back and Forward appear only once you have opened a second file, and Open in Code is an icon. A markdown
  preview there has smaller headings and less margin, so more of the file fits.
- The RAM panel's arcterm section has an **Agents** line, every agent's RAM added up, so its rows add up to
  **Total, with agents**.
- The Codex and Antigravity marks are a white mark on a dark tile, like pi's, so they read clearly on a dark theme
  instead of fading into it.
- The header button for a finished agent reads **✓ Close · 8.7M tok**, like its sidebar row's ✓ Close, instead of
  repeating itself as Done — Close.
- A float window stays above your other apps from the moment it opens; its pin button turns that off.
- The Low RAM card is gone: a heavy command waits in the job queue instead.
- On a Mac the job queue judges RAM by macOS's own memory pressure, which counts compressed memory and swap, so heavy
  jobs no longer wait on a machine that only looks full: they run at green, one at a time at yellow, and wait at red.
- New agent: the task and the list of sessions to resume sit side by side, so the dialog fits without scrolling; a long
  list scrolls inside itself.
- Pressing any other key while holding `Ctrl` or `Alt`, as in `Ctrl`+`C`, hides the shortcut bar and the rail and
  agent numbers again.
- Those rail and agent numbers are a small badge in the icon's corner instead of covering the whole icon.
- The **Agent** item in the left rail keeps its count of working agents while you are on Agent, not only from other
  surfaces.

### Fixed

- A held card that pops up over the cockpit, such as an Antigravity agent's question, is headed by its own title
  instead of "Low RAM".
- On a Claude Team plan the app bar no longer shows Fable's weekly share as your weekly usage ("wk 0%" however much
  you used). Anthropic does not report a Team seat's all-models week, so a Team seat shows its 5-hour window, then
  Fable's weekly share as its own "Fable wk" bar, as claude.ai does; the Usage surface's Claude tab shows it as a
  "Fable weekly" card.
- On macOS, the Claude usage in the app bar and on the Usage surface is read fresh from Anthropic for your `/login`
  account, as on Windows, instead of from Claude Code's own saved copy, which could be hours old.
- On macOS, a Claude account added with a token stays signed in after arcterm restarts. Before, its token was lost on
  every restart and new agents quietly ran on your `/login` account; an account whose token is gone now says so in
  **Settings → Claude account**.
- On macOS, a right-click or double-click on a sidebar row, a file in Code's tree, the agent header or a worker on a
  lead card no longer selects a word of its text. The rename and new-file boxes still select as before.
- On macOS, folding into Sprout or floating from a maximized window no longer shows the window jumping to an old size
  and place before it shrinks.
- The float bar shows the arrow cursor over the agent's name, as a title bar does, instead of the text cursor.
- Sprout slides over when the floor it walks narrows under it (a tab or the usage growing in a float, the window
  shrinking) instead of jumping there.
- Restoring from Sprout waits for the window's new size before the window grows out of Sprout, so the growth is seen,
  and an agent picked in folded Sprout's list grows its float out of Sprout too.
- A Terminal opened from New with a command in its Command field runs that command when it opens, at the shell's
  first prompt, and stays a shell afterwards; the command was ignored before.
- Codex sessions show their runtime icon and use the first prompt as a title when the reporter omits it.
- The app bar's 5-hour meter shows again at 0% when Claude's usage reading says the window is unused, and its
  countdown to the reset is back beside it instead of only in the tooltip.
- An arcterm reinstalled from inside a Claude background job no longer names every new Claude session after that
  job.

## 0.15.8 — 2026-10-09

### Added

- `Alt`+`W` closes the focused agent when its header shows **Done — Close**, also from inside its terminal; the button's
  tooltip names the key.
- **Mark for later** in a session's menu, in the Agents tree or under Conversations, flags it with a bookmark until you
  pick **Done**; the mark stays when you close the agent, puts the conversation first in its project's list, and is back
  on the row when you resume it. <!-- big -->
- New agent: paste or drop images into the task, and resume a recent session of the picked agent and project. <!-- big -->
- A Low RAM card now pops up over whatever surface you are on, so a command held for memory no longer waits unseen
  behind Jarvis or the Cockpit; press its number to answer, **Open agent** to go to it, or **Later** (`Esc`) to leave
  it on the agent's own card.
- The Agent rail shows the project's instructions file under the project and branch, `CLAUDE.md` for a Claude agent
  (or `AGENTS.md` when there is none) and `AGENTS.md` for pi and the others; click it to read it in the rail.
- An **Outline** button lists a document's headings and jumps to the one you pick, with the section you are reading
  marked: in the Spec and Plan review, and over the Code surface's Markdown and LaTeX previews. <!-- big -->
- In a Spec or Plan review, resting the pointer on a finding scrolls the document to the task it names and dims
  the rest, so you read only the part it changes; click the finding to keep it shown while you read.
- Jarvis's pet keeps busy between walks: when it stops to rest it may read a book, listen to music on headphones,
  type at a laptop or dribble a ball, picked at random each time, as well as standing or sitting still.
- `Alt`+`C` switches an agent between Terminal, Canvas and Review from inside its terminal, where a bare `c` is
  typed into the agent.
- `Alt`+`1`…`9` jumps to an agent in the Agent surface's Active list, even from inside its terminal; hold `Alt` a
  moment and each agent row shows its number. Holding `Ctrl` (`Cmd` on a Mac) likewise numbers the rail's surfaces
  for `Ctrl`+`1`…`7`.
- On the Agent surface, clicking the unread count on the rail's Agent icon opens the agent that finished last; click
  again for the next one.
- In Float, a small Sprout in the bar shows when something waits on you (`?`, `!` or the review eye); click it, or
  press `g` `w`, to open the pet's popup below it.
- When the computer sleeps while agents are working, Jarvis's pet says so on waking: how long it slept, from when to
  when, and how many agents it held up, so a run that sat still reads as a sleep rather than a hung agent.
- Now and then, when nothing waits on you, Jarvis's pet says a well-known line about programming, with its author.
  Settings → Appearance → **Jarvis quotes** turns it off.
- The Agent panel's Files changed can list the whole branch: on a branch off the default one, a Session / Branch vs
  main switch shows everything the branch carries against where it left main, committed or not, and View diff opens
  that comparison. <!-- big -->
- The agent header has a **Redraw** button (also in its right-click menu) for a terminal whose text came out garbled
  or overlapping: it repaints the pane and has the agent draw its whole screen again at the pane's size, without
  restarting the session.

### Changed

- Diff is one panel beside a wide diff instead of four columns. At the panel's top a source dropdown (the project,
  worktree and agent tree) replaces the Worktrees column; under it, Commit and Log tabs. Log holds the history graph
  over the selected commit, split by a divider you can drag, and Compare… lives there; the range strip and the
  right-hand summary are gone, and the diff's header is one line with a `⋯` menu for the view options. Drag the
  panel's right edge to resize it. `Shift`+`B` hides the whole panel: the diff then takes the full width and its
  header carries the source, the tabs and a file stepper. `Shift`+`H` opens the Log tab and `Shift`+`C` the Commit
  tab.
- Diff: choosing a source, a commit, the session row or a comparison opens its first file at once, and `↑`/`↓` in a
  file list open the next or previous file without Enter.
- Rename opens on the session's current name, all of it selected, so you can type a new one or edit the old one.
- Hold `Ctrl` (`⌘` on a Mac) or `Alt` a moment and the bottom bar lists every shortcut on that key that works right
  now, so from inside an agent's terminal you can see each way out without leaving it.
- The Agent rail's top row shows only the counts you can click (lists with something in them, and Attach), so its
  icons no longer run past the rail's edge.
- New agent and New run: the Task and Goal boxes grow as you type, to about eleven lines before they scroll, instead
  of staying a fixed few lines tall.
- A run started from a session is no longer listed one level in under that session, in the sidebar or in
  Conversations: it sits on its own row in its project, so closing the session no longer moves the run.
- A Claude agent asks you before it starts a subagent, naming it and warning that one can cost millions of tokens
  (agents in an engine run are not asked); the 10-subagent cap per session, which had stopped holding, holds again.
- The app bar is slimmer: 38px instead of 46px, with a narrower search box and smaller buttons, and the 5-hour
  meter's countdown moved into its tooltip. The agent header's Redraw, Float, fullscreen and close buttons are bare
  icons that fill on hover rather than boxed buttons.
- Float has one bar instead of two: the agent's header is gone, and the float bar shows the agent's state, model and
  context next to its name, so the small window gives the terminal more room.
- The Agent panel's Files tab opens as wide as Overview instead of the File tab's width, and remembers its own width
  when you drag its edge.
- On Windows, the Consumers panel's RAM figures are each process's private memory, as Task Manager shows it, instead
  of a working set that also counted memory shared with other apps (the Interface row read about a third too high).
- A terminal hidden for more than 30 seconds gives its GPU drawing context back and takes a new one when it shows
  again, so the interface holds less memory with many agents open.
- The Low RAM card above an agent's terminal is tinted amber with an amber border, so it no longer blends into the
  terminal behind it.

### Fixed

- Diff: a commit whose files are still loading, or could not be read, no longer shows `0 files +0 −0` beside an
  empty diff. The list says it is reading, or that the read failed with a Retry, and a commit that really changes
  no files says so.
- A run in its final stage now reads **Verifying** in the run sheet, with the step it is on and for how long, instead
  of **Executing** over a full strip; a run's progress line in the Agents tree shows its full text on hover when cut
  off.
- An orchestrator lead no longer collects an unread count once its plan is running: the turns the engine wakes it
  for (a task done, a merge, a handoff) are not news for you, and what it needs from you still arrives as a question.
- A run held because its final stage failed names the step that failed in Needs you, and says
  `wsh runs land <run> --force` is the way to land it, instead of advising to clear a reason that Land again can never clear.
- A run held because the checkout has uncommitted edits to a file it changes now says so and names the files,
  instead of quoting git's whole merge command and error.
- The Cockpit's nav badge (and the Dock badge on a Mac) counts an agent at a permission prompt or a question asked in
  its terminal, so it no longer reads 0 while the Cockpit's "need you" tab says 3.
- A card waiting on you with no choices it can show (a permission prompt, or a question asked in the terminal) says
  so and offers **Open terminal**, instead of "Waiting on you" over nothing to answer.
- An agent that committed and then ran a few more commands with long output in the same turn now offers ✓ Close;
  before, a commit more than 64 KB back in its transcript went unseen.
- An agent whose last turn committed a plan and started an orchestrator run with it no longer offers ✓ Close while
  that run, nested under it, is still going; the offer comes back once the run ends.
- New run: Cancel or Esc while a run is starting now cancels that run and frees the dialog at once, instead of
  leaving it stuck on Starting… when reopened. Its key legend reads `Tab` for next.
- An agent's terminal on Windows garbles far less often, so Redraw is rarely needed: a pane that grows taller no
  longer draws Claude's screen on the wrong rows, and an agent opened after a restart repaints itself at the pane's
  size instead of showing its old output stacked out of line.
- Code's sidebar keeps one width across Files, Search and Changed, so switching between them no longer moves the
  editor's edge; dragging it in any mode sets it for all three.
- Changed-file lists (Code's Changed and the Diff surface) no longer show `+0 −0` for a change git cannot count in
  lines: a binary file reads `bin`, a nested git repository `repo`, and a submodule with changes inside it `dirty`. A
  file with a non-ASCII name (`tên.txt`) now shows its real counts.
- In Code, a markdown or TeX file's Preview keeps where you scrolled it: switching to another file or surface and
  coming back lands on the same spot instead of the top.
- In a narrow sidebar, an agent row with subagents no longer runs past the row's right edge: its subagents chip shows
  just the count, and a long model name is cut short.
- Jarvis's Runs list no longer jumps around while agents start and stop: rows keep their place instead of all
  re-sliding each time one agent's state changes.
- A blocked run's sheet offers **Resume lead** (or **Resume worker**) when the run can be picked up again, says how
  long it ran and when it stopped instead of an elapsed time that kept counting, and no longer tells you the lead is
  writing its plan when it stopped before submitting one.
- A new run no longer lists every older plan in the same project as an attributed record ("+14 more"): an old plan
  is linked to a new run only while its own run is still going.
- A subagent that has finished no longer stays listed as running under its agent in the sidebar.
- After opening a subagent from the sidebar, clicking its agent's row brings the agent's terminal back.

## 0.15.7 — 2026-10-09

### Added

- The Agent panel has a Files tab that lists the agent's worktree as a tree. Drag files or folders from it onto a
  terminal to type their paths at the prompt: `@` paths on an agent's terminal, plain paths in a shell.
- Float: the agent header's Float button (or `Shift+F`) shrinks the window to the focused agent's terminal, which a
  pin keeps on top of your other apps. Leaving it gives the window its size back, and the next float opens where
  the last one was.

### Changed

- The Diff surface lists every project with its worktrees in a sidebar on the left, each with its branch, its
  uncommitted files and how far it is ahead of or behind the main branch, and the agents working in it. Click one to
  see its changes; it replaces the source picker. In a narrow window the sidebar starts folded to a rail so the diff
  keeps room; `Shift+B` folds or unfolds it, and that choice is kept.
- In the New dialog, `→` moves from the Agent column to the Project column and `←` moves back; the key legend shows
  them in place of Tab while a column has focus.
- The plan-usage meters and the free-RAM chip are back in the app bar, where they are easier to read; clicking either
  opens Consumers below it. The Servers chip and the version stay in the footer.
- Consumers shows each agent's RAM and its tokens and spend on the same row, with free RAM and the 5-hour quota
  together in its header, instead of making you switch between a RAM and a Tokens view.
- Plan usage takes colour only as it nears a limit: the app bar meters and Usage's 5-hour and weekly cards stay
  grey while there is plenty left and turn amber past 60% and red past 85%, and a provider's tab in Usage colours
  its `5h` or `wk` figure the same way, so you see it without opening that tab.
- Jarvis's pet looks tired only when a plan quota runs low, the 5-hour or the weekly one, and says so once when a
  window passes 85% and once when it runs out. A full RAM no longer tires it; it stays a line in the pet's popup,
  which now says how much free RAM one more worker needs.
- The pet's lines read without dashes.
- A question or a decision waiting on you shows in Jarvis's pet bubble instead of a **Needs you** toast, naming the
  agent that asks. The bubble stays 15 seconds, and as long as the pointer is on it; click it to answer in the pet's
  popup. In Float, where the pet is hidden, the toast still says it. **Finished** toasts are unchanged.

### Fixed

- arcterm opens faster with many agents and terminals: an agent or terminal no longer loads its output until you first
  open it (in the grid or the panel under the agent), instead of all of them loading at once on start.
- Deleting, creating or renaming a file in Code no longer resets the whole view: the file you were reading, the open
  folders and the tree's scroll stay where they were.
- Claude sessions are saved again after arcterm is reinstalled or reopened from an agent's terminal (`task install`
  on a Mac): before, every session started or resumed in that arcterm kept no transcript or title, and vanished
  from the sidebar and Conversation History once it ended.
- A run you landed after its final check failed now reads **✓ landed** in the sidebar, on its lead card and in
  Conversation History, instead of "7/7 done" as if it were still waiting.
- A finished run no longer leaves idle tabs behind: its plan reviewer, its final verifier and its lead close a few
  minutes after their turn ends, and the run's folder under `.waveterm/worktrees` goes with them.

## 0.15.6 — 2026-10-08

### Added

- Usage shows Claude usage per tab (context size, cold resumes, subagent share) and an Analyze button that has Claude
  explain where your quota goes and what to change; providers are tabs across the top and the charts sit in one
  compact row.
- From any other surface, the **Agent** item in the left rail shows a pulsing green dot with the number of agents
  still working, so you can see a run is busy from Code or Diff. Hover it for the count in words.
- An agent whose last turn ended on a git commit, once you have read that turn, offers to close itself: a **✓ Close**
  chip on its sidebar row and a **Done · 30.7M tok — Close** button in its header, both asking first as Close agent
  does. Agents a run started are left to the run. Claude agents for now.
- A part named without a total, as a heading that opens a line (`## Phần 2`, `**Phần 1:**`, `Part 3:`), now shows its
  number on the agent's row, the way `Phần 2/4` shows `2/4`. A message whose headings walk through several parts
  shows none.
- Consumers' RAM view ends its arcterm section with **Total, with agents**: everything arcterm runs, its own
  processes and every agent, in one figure.
- A **+** on a project's folder in the sidebar's Terminals section opens a terminal in that project, and with a
  project picked in the app bar the **+** sits in the Terminals header, so a terminal no longer takes New → Terminal.
- A terminal in the sidebar's Terminals section shows a pulsing dot while a command runs in it (a dev server, a
  build) and none once it is back at its prompt, so you can tell which terminals are busy.
- The app bar's usage meter shows how long until the 5-hour window resets (`1h55`), and each bar carries a light
  tick for how much of its window has passed: a bar short of its tick will last until the reset.
- The footer has a **Servers** chip: how many servers run inside your repos, and how many nothing holds any more.
  Click it to see every listening process on the machine, grouped by repo, with what each belongs to (an agent, a
  terminal, an app, or no owner), and open, read the log of, copy or stop it.

### Changed

- Settings is six pages instead of eleven, laid out as cards: each setting is a title and one line of description, its
  config key appears when you hover it (click to copy), and Startup surface is a dropdown.
- A plan-usage bar's colour follows how much of it is used, amber past 60% and red past 85%, instead of how fast it
  is going: a fast start no longer turns 27% red. The tick still shows how much of the window has passed.
- An agent's row in the sidebar keeps its name alone on the first line: its canvas tag, state (asking, Low RAM,
  review), tokens and age moved to the second line beside its model, so a long name is no longer cut short. A lead's
  row ends its workers line with them, and a run's worker rows do the same with their canvas tag and asking label.
- The plan-usage meters and the free-RAM chip moved from the app bar to the footer, beside the version, on every
  surface, which leaves the app bar more room for search and **New**. Each provider's meters start with its logo,
  and clicking the meters or the chip opens Consumers upward from the footer.
- Go to… opens only with `Ctrl`+`G` (`Cmd`+`G` on a Mac), the same on every surface and inside the terminal: a bare
  `g` no longer opens it, and every go-to key is now `Ctrl`+`G` then a letter (`Ctrl`+`G` `a` for Agent).
- Consumers' **RAM** and **Tokens** are now two views, not two sort orders of one list: RAM shows each agent's RAM,
  free RAM and arcterm's own processes; Tokens shows each agent's tokens and spend of the last 10 minutes and the
  5-hour quota. Rows are ranked when the panel opens and keep their place while it is open, so switching views or a
  new reading no longer moves them.
- The app bar's usage meter turns amber when you are using quota faster than the window passes, not when it passes
  60%: 72% with 20 minutes left stays blue, 50% with 3 hours left turns amber. Its refresh button moved to Usage only;
  switching to the Default Claude account reads its quota at once.
- An agent whose build or test run is held for low RAM reads **Low RAM** instead of **asking**, and its card (Run now,
  Wait for RAM, Don't run) sits above its terminal, so you answer it there instead of hunting for it in Jarvis.
- The sidebar's conversations take one line each: the runtime, the title, its tokens and its age, with a second line
  only when it tells a row apart (a branch other than `main`, or when it started if another row has the same title).
  A finished orchestrator run shows the tokens of all its sessions, and its tasks as a bar across the row. **Show
  more** says how many are left, and **Show less** folds the list back to its first page.
- The app bar has one **New** button in place of New run and New agent: it opens the New dialog on whatever you
  picked last, and a number key switches between an agent and a run. `Cmd+N` still opens it on an agent and
  `Cmd+Shift+R` on a run (`Ctrl` on Windows).
- arcterm uses less disk and memory over time: a terminal idle for 30 days gives up its stored output (its tab and
  transcript stay), the database's write-ahead log is cut back after each checkpoint, and finding which run an agent
  belongs to no longer reads every run.
- A terminal you have not renamed is named for the command it last ran (`task dev`), or "Terminal 2" before it has
  run one, instead of every terminal in a repo sharing the repo's name. PowerShell, Windows PowerShell 5.1 included,
  now reports its commands to arcterm.
- Settings → Claude account is simpler: each account is one line with its 5-hour and weekly use (as bars, in the
  warning colour from 80%) and a ⋯ menu for Rename, Same account as… and Remove, and + Add account holds both signing
  in and pasting a token.
- The labels still in Vietnamese are now in English: the Claude account settings and its sign-in and restart
  dialogs, the Cockpit's **Needs you** strip, **Delete session**, and the usage refresh's retry time.
- Switching an agent between Terminal and Canvas (or Review) no longer reshapes the screen: the details rail stays,
  so the header's controls stay put, and the canvas and review toolbars match the header, with underlined board
  tabs and header-sized buttons.
- In the details rail's Servers section the Stop button is red before you click it, and a server's log opens in a
  tab named by its port and command (`:8100 uvicorn app.main:app`) instead of the output file's id; a background
  task's log is named by the task.

### Fixed

- A Markdown quote (`> …`) whose lines are a chat log or an email keeps each line on its own line in the preview,
  instead of running them together into one paragraph. Lines outside quotes still join as before.
- A part an agent only quotes as an example, in quotes or code (`kiểu "Phần 2/4"`), no longer shows on its row as
  the part it stopped on, and no longer keeps a finished agent from offering **Close**.
- An ended conversation no longer keeps the amber "waiting for you" dot after you answered its question; the dot
  stays only on a question still unanswered.
- Consumers opens right under (or over) the control you clicked, the usage meters or the free-RAM chip, instead of
  at the window's right edge.
- An agent's terminal you had not opened for a while no longer comes back as garbled characters: showing it again
  redraws its text.
- Choosing an agent that is asking a question in its terminal now moves typing into that terminal, so the arrow keys
  answer its picker instead of moving through the agent list.
- Background tasks a resumed Claude session had left unfinished no longer show **running** forever: the "didn't
  finish before the previous session ended" notice now marks them stopped, so a server's Log button opens the
  command that is actually running.
- The live agents in the sidebar's Active section keep their places when you switch to the Cockpit and back, instead
  of the ones that had gone idle dropping to the bottom.
- On Windows, Consumers no longer sits on "Reading…": listing the machine's processes took over ten seconds there,
  longer than the panel waits between readings, and now takes a fraction of one.
- Resuming agents after switching Claude account resumes them instead of closing them.
- Adding a Claude account with **+ Sign in to account** on Windows no longer stores a cut-off token: the dialog's
  terminal wraps the token, and arcterm kept only its first line, so every claude on that account failed with
  "401 OAuth access token is invalid". An account added this way before the fix needs to be added again. Adding an
  account, signed in or pasted, now asks Claude whether it accepts the token and refuses one it rejects. A pasted
  token copied across a line wrap, or with some text around it, is cleaned up before it is checked.
- A terminal whose text went missing after the machine slept or stalled, leaving only colored backgrounds and a few
  stray letters, redraws its text when the window comes back or you click into it.
- A Claude agent walking you through a design in parts shows its **1/4** badge while it asks "Part 1/4 look right?"
  with a question, not only when it stops on a plain message. It also reads "part 1 out of 3", "phần 1 trong 3",
  "round 1 of 2", "question 2/5" and "[1/4]", and no longer mistakes a date like "05/10" for a part.

## 0.15.5 — 2026-10-08

### Added

- Clicking the app bar's RAM chip opens **Consumers**: every running agent with its RAM, model and tokens of the last
  10 minutes, a run's workers under their run, and arcterm's own memory below. **Stop** ends an agent (a worker's task
  is not retried), and an agent on Opus has **→ Sonnet**. The plan-usage meters open it sorted by tokens; **Open
  Usage** at its foot goes to the Usage surface.
- Antigravity CLI (agy) is back as a harness: live status, questions on the card, launch and resume, consults,
  Conversation History, usage, and plan task workers.
- The Jarvis pet wears Vietnam's colours: a red flag shirt with the yellow star, or the flag in its hand. Settings →
  Appearance picks the shirt, the flag or neither; on 30/4, 1/5 and 2/9 it wears the shirt even when that is off.
- The Jarvis pet's popup answers a worker's question in place: a one-question ask (an escalation too) shows its
  options as buttons, and `1`…`9` sends one, the same answer as the Cockpit's answer bar.
- `g` `w` opens the Jarvis pet's popup (what's waiting on you) from any surface; `Cmd+G` `w` (`Ctrl+G` `w` on Windows)
  reaches it from inside the terminal.
- **New run** has a shortcut, `Cmd+Shift+R` on macOS and `Ctrl+Shift+R` on Windows, and the app bar's New run and
  New agent buttons show their shortcut beside the label.
- When RAM is short, a heavy command an agent runs (a build, the typecheck, a whole test suite, `npm install`) waits
  on a **Low RAM** card that says how much it needs and how much is free: **Run now**, **Wait for RAM** (it starts
  on its own once there is room) or **Don't run**.
- The terminal shows images: Sixel and iTerm inline images (`imgcat`, `chafa`, image previews in TUIs) draw in place.

### Changed

- **New agent** and **New run** are one dialog. Pick what to start with its number key, Tab to the project column
  (type to filter it, or press a project's number), then `Cmd+Enter` (`Ctrl+Enter` on Windows). A click outside now
  closes it, and opening it again brings back what you had typed.
- An agent's OS notification names its project first, `[arcterm] Finished: <agent>`, and a finished agent's
  notification shows the first sentence of its last answer underneath (up to 80 characters) instead of the project.
- The Jarvis pet falls back to the footer when you drop it, with a small bounce, instead of snapping there; and when
  the footer under it changes height (switching to the Cockpit) it hops up or drops down to the new edge rather than
  jumping.
- The RAM chip in the app bar shows the free RAM (`1.3 GB free`) instead of how many more workers fit; that
  number moved to its tooltip. The chip turns amber with a ⚠ only when free RAM drops below 512 MB, not whenever
  another worker would not fit.
- On macOS the app's shortcuts use `Cmd` instead of `Ctrl`: `Cmd+P` search, `Cmd+N` new agent, `Cmd+1`…`7`
  surfaces, `Cmd+Enter` to send or approve, `Cmd+S` save, `Cmd+G` go-to from the terminal. `Ctrl+P` and `Ctrl+N`
  now reach the shell in a terminal. `Ctrl+Tab` and the double `Ctrl+C` that closes an agent stay as they were.
- A background task's output opens in the panel following live and wrapped, finished or not, and drops the
  **Open in Code** button.
- arcterm reopens on the surface you left it on. Settings → Startup surface has **Last opened** as its new default,
  and a surface picked there now actually opens at launch.
- The agent rail's **Token usage** and **Details** become one block at its top: the context and spend, the session's
  total tokens before their bar, then project · branch · model on one line, with Compact and Clear beside a
  **Breakdown** toggle, the one part that opens and closes. The spend shows once, and the context tokens drop their
  "ctx" (the tooltip names the context window).
- A run's goal heading (the Jarvis run sheet and the Agent surface's run panel) no longer grows and shrinks on a click.
  A goal that is cut off or runs past one paragraph gets a **Show more** link that reveals the rest below the heading,
  at the same size; a goal that already shows in full has no toggle.
- The lead and reviewer route pickers list only the harnesses that can lead a run (Claude and Pi). A run no longer
  starts with a lead that cannot lead because your shared route preference names one, such as Antigravity.

### Fixed

- On macOS a click on an agent's notification opens that agent, as on Windows, instead of only bringing arcterm to the
  front on whichever agent was showing.
- A newly launched agent's prompt takes your typing at once, without a click into its terminal.
- On macOS the `Option` shortcuts work: `Option+Z` word wrap, `Option+T` file tree and `Option+E` editor on Code.
- On macOS `Cmd`+click peeks a link, and holding `Cmd` underlines what can be peeked. `Ctrl`+click, the Mac's right
  click, never peeked.
- The Jarvis pet no longer stays hidden under a **Needs you** toast: it no longer repeats the toast's question in its
  own bubble (it keeps the `?` mark), and while it speaks it walks out from under a toast or a terminal instead of
  standing still there.
- A subagent's **Model** in the agent rail names the model it runs on again, instead of always showing `—`.
- Most emoji in the terminal (🚀, ✅, ✨) take the two cells a TUI expects, so a line with one no longer pushes the
  rest of it, or the cursor, a column out of place.

## 0.15.4 — 2026-10-07

### Added

- Radar audits recent fix commits for the same bug elsewhere in the code: each finding names its root cause, the
  sibling sites and the fix it came from, and Settings picks the model the audit runs on. It replaces the old lens scan.
- Agents can message each other: `wsh agents list`, `wsh agents send` (which can wait for the answer) and
  `wsh agents read`.
- Jarvis's pet announces a landed run on every surface, and a held land's row in its popup has **Dismiss** beside
  **Land again**.
- A message sent to a busy Claude agent joins the turn it is running instead of being typed into its prompt.
- A Claude agent in arcterm is refused commands that kill arcterm by image name, or push or move branches in a run's
  worktree.
- The run sheet's header puts the run line under the project, and the run id is a chip that copies it.
- An ended Claude session can be deleted from Conversation History, the sidebar's right-click menu or the command
  palette (**Xoá session**): its transcript moves to `~/.arc/trash` and is removed for good after 7 days.
- The plan usage strip and the Usage tab have a **Refresh usage** button that reads Claude's windows now instead of
  waiting for the next check; if Anthropic is rate-limiting the read, it says when to try again.
- Submitting a plan whose parallel tasks list the same file is refused.
- The agent rail lists the servers listening in the agent's project — port, command, who started it and for how
  long — with open, log, copy and stop.

### Changed

- What needs you (run approvals, blocked tasks, runs to acknowledge or land, escalations) now shows at the top of the
  Cockpit with its action buttons, and its nav and Dock badge moved from Jarvis to Cockpit.
- **`g` `c`** opens the Cockpit (it was `g` `h`).
- Claude tool calls no longer wait on arcterm's status reports.
- Usage, attention and channel views load faster on long histories.
- An orchestrator run's last merge leaves its Verify to the final stage.

### Fixed

- A Claude session you send to the background from its own tab keeps reporting to that tab: its status, transcript
  and subagents stay current.
- After an update, a crash or a quit, the claude, pi and opencode agents that were running come back on their own,
  each in its own session, instead of staying gone until reopened from history.
- Claude plan usage now follows the real account (its email) across `/login` changes, and a token account can be tied
  to an email so it shows that account's last usage.
- A Claude agent started before a `/login` change no longer reports its old account's usage as the new one's.
- The installed app shows the Final check's screenshots.
- Deleting a channel deletes its runs and their DAGs.
- Orchestrator runs: a worker waiting on a question no longer stalls, a stuck engine tick is reported without stopping
  the other runs, a transient dispatch failure is retried, and a run's lead resumes after a restart.

## 0.15.3 — 2026-10-07

### Added

- `wsh runs route` shows which models a new run's lead and workers will use, and saves the workers default
  (`--global --worker-runtime claude --worker-model sonnet`) so runs started from an agent stop defaulting
  every worker to the harness's default model.
- LaTeX and BibTeX files are highlighted on Code and in the agent panel's File tab, and a **Wrap** toggle (`Alt+Z` on
  Code) wraps long lines; `.tex`, `.bib`, `.md` and `.txt` wrap by default. A `.pdf` now opens in a viewer instead of
  "Binary file".
- A `.tex` file opens on Code as a readable preview: its title and authors, numbered headings, and the prose with
  `\cite`/`\ref` keys and rendered math. Double-click a sentence to edit it in Source. When the paper has a built PDF
  (Doc review's build, or the one beside the main file), a **PDF** mode shows it with how old it is.
- Code has a read-only side column: drag a file from the tree onto the right half of the editor, choose **Open to the
  Side**, or press `Ctrl+\` to see a file beside the one you edit — a paper's PDF or preview next to its source
  follows your typing. A `.tex` file with nothing to preview, such as a generated macros file, opens on Source.
- In a Doc review you can suggest an edit: select text and press `e` (or the pencil beside a paragraph) to edit that
  paragraph's LaTeX or Markdown source. The file is not changed; Request changes sends the agent the exact
  `Edit: replace "…" with "…"`, shown on the card word by word.
- The Diff surface has a **Wrap** toggle (`Alt+Z`) too, shared per file with Code and the agent panel's File tab.
- A background task's output in the agent panel has a **Live** toggle: while the task runs the output follows along as
  it grows, staying at the end unless you scroll up.
- Switch the Claude account in Settings: sign in extra subscriptions once, pick one, and new agents and the plan usage
  follow it.
- A file in the agent panel's **Files changed** opens beside the agent as a diff against where the session started,
  with **Source** to see the whole file and a button to the Diff surface; **View diff** still opens Diff.

### Changed

- Added and removed lines in a diff are a softer green and red; a new file no longer reads as a solid block of green.
- Opening an idea in Jarvis no longer shows an empty initiative plan. It shows the whole title and when you jotted it,
  with **Plan it** (an agent breaks the idea into chunks) and **Add first chunk**, which turns it into an initiative card.
- An agent notification says what it is at a glance: an amber question tile and **Needs you**, a green check and
  **Finished**, with the project and the agent's harness on the right, instead of tacking "finished" onto the name.
  A toast stays while the pointer is on it, one that needs you stays 15 seconds instead of 6, and its × closes it
  without opening the agent. Jarvis's pet walks out from under a new toast at once instead of on its next stroll.

### Fixed

- Expanding a run's records in the Jarvis sheet no longer pushes the run's buttons (Open DAG, Cancel run…) off the
  bottom of the sheet: the records take at most half the sheet and scroll.
- An agent that has just finished its turn no longer shows as asking for about a minute, or sends a false
  **Needs you** notification.
- A notification toast in the corner is no longer covered by Jarvis's pet; the pet walks off the stretch below it.
- Code no longer fails with "Could not list files: exit status 1" the first time it opens a large project;
  a listing that really does run out of time now says so.
- Shortcuts work with a Vietnamese input method such as EVKey or Unikey left on Telex: outside a text field or the
  terminal, a letter it rewrites ("đ" for `dd`, "ư" for `w`, "á" for `a` `s`) acts as the key you pressed.

## 0.15.2 — 2026-10-07

### Added

- The New agent dialog warns when free RAM can't hold another agent, with how much is free, so you can close one
  before the machine starts to lag. It still lets you launch. The "No terminal running" screen shows the same
  warning, since resuming a recent session there launches at once.
- An agent that stops on one part of a walk-through, such as "Part 1/3", shows `1/3` at the end of its row in
  place of the unread count, and keeps it until you reply, so a half-reviewed design is not forgotten.
- **Claude Code updates.** arcterm checks for a newer Claude Code every 6 hours and Jarvis says once when one is out.
  Settings → About lists each installed harness with its version, and Update installs the new one; open sessions keep
  theirs until they restart. Turn the check off with "Check for harness updates".
- Notifications when an agent needs you or finishes its turn: a system notification while arcterm is in the
  background (click it to open the agent), a toast while it is in front. Settings → Notifications turns each off.
- The keyboard hints bar shows the running arcterm version at its right end; hover it for the backend version and
  build time.

### Changed

- A run a session starts with `wsh runs start` is listed under that session in the sidebar, one level in with a guide
  line, both while they run and in Conversations once they end, so you can tell which conversation launched it. Runs started before this update keep their old place.
- Unread counts (the Agent badge in the nav rail, the Dock badge on macOS, a bold row) come only from top-level
  agents: a run's workers report to their lead, so their finished turns no longer count as unread.
- An agent waiting on a permission prompt now shows amber, like one asking a question.
- `g` `j` now goes to Jarvis (it was `g` `c`).
- On Windows, shortcuts are spelled out in words, `ctrl+shift+p` and `shift+g`, instead of `^⇧P` and `⇧G`; macOS
  keeps its ⌘ ⌃ ⌥ ⇧ symbols.
- Jarvis shows each initiative as a card with a bar of its chunks and the one to do next, and lists ideas in
  their own column beside the cards; an initiative's menu is always shown, and Waiting on you is hidden while
  nothing waits.
- An Active agent's row shows its session's token total after the model, as a Conversations row does, updated each
  time a turn ends.
- In an agent's card and a conversation's transcript, your prompt pins to the top once its turn's reply scrolls it
  away, so you can see what the reply answers; click it to scroll back.
- A conversation's header is one compact row: title, status and project, branch, time and tokens on one line, with
  the way back to the terminal at its start.
- The agent pane's header is one row: the name, the harness's mark, its state, model and context, then the project,
  which truncates first; the harness's name is in the mark's tooltip.
- The Agent sidebar's Conversations lists only the projects you have added to arcterm; conversations from other
  folders stay in Conversation History, and a row under the list counts them and opens it.
- Conversation History has no page-wide header any more: the list column heads itself with the way back, the title,
  the live count and the status filter, beside the conversation's own header, so the transcript starts higher.
- Conversation History always lists every project, whichever one the app bar has chosen; the project choice narrows
  the sidebar's Conversations only.
- Clicking a pinned prompt scrolls the transcript smoothly back to it instead of jumping, unless reduced motion is
  on, and a conversation's header buttons share one height, so the row is shorter.
- Clicking a pinned prompt while the agent is still writing scrolls back to it and stays there, instead of being
  pulled back to the newest output on every streamed line.
- Choosing a terminal while an agent is on screen opens it in a panel under the agent instead of in its place. Drag
  the panel's top edge to resize it, between 120 px and 60% of the column; its maximize button (or a double-click on
  its bar) gives it the whole area and back, and its x hides it while the shell keeps running.
  The right panel no longer lists terminals: the sidebar's Terminals section is where you switch between them.
- A row under Background tasks shows the command it runs, and a click opens the command's output in the panel's File
  tab; clicking again reads it afresh while the command is still running.

### Fixed

- Picking an answer in Claude's own question dialog in the terminal no longer comes back to Claude as "The user
  dismissed the question."
- A file path too long for its line in the terminal, such as a report path an agent prints, now opens with Ctrl+click
  instead of being split in two at the line break.
- A turn an agent finishes while arcterm is in the background now stays unread, even when that agent is the one on
  screen.
- A finished conversation's "done" mark sits level with its title in the header instead of above it.
- A run in Jarvis no longer repeats an agent's name ("X · X") when the agent has no task of its own.
- A question's option previews keep the agent's mockups as drawn: each line and space in a monospace box, below the
  options in a narrow pane and beside them in a wide one, where they had wrapped into a paragraph.
- A pasted image is listed in the right panel's Uploads as `Image #N`, the number Claude Code shows in its
  prompt, as soon as you paste it, on any surface, instead of as Pasted image until the prompt is sent.
- A prompt sent with a pasted image shows the image, in an agent's card and in a conversation's transcript, instead
  of only its `[Image #N]` label; click it to see it full width.
- A Claude Code conversation's token total counted a reply once per block it wrote (text, each tool call), often
  two or three times too high; it now matches the Usage numbers.
- Terminal text a TUI draws on its own background, such as your past prompts in Claude Code, is lifted to
  a readable contrast instead of grey on grey.
- `Ctrl`+`Tab` pressed while typing in an agent's terminal keeps you typing in the next agent's terminal, instead of
  dropping the keyboard until you click it.
- `↑` / `↓` move between agents on the Agent surface, as the hints bar always said; `←` / `→` and `j` / `k` still work.
- `Ctrl`+`Tab` and the agent keys step through the Active list as it reads, top to bottom. They used to follow the
  Cockpit's order, which was stale until you opened the Cockpit, so an agent started since then was skipped.
- An image you paste into an agent's prompt and then delete before sending leaves Uploads once the prompt goes out
  with images, instead of staying listed.

## 0.15.1 — 2026-10-07

### Added

- **macOS on Apple silicon.** arcterm builds and runs as an ad-hoc signed `.app` and `.dmg` (macOS 13+),
  with the native traffic lights over the app bar.
- **Dock badge on macOS.** The app icon counts agents with a turn you haven't looked at plus what Jarvis is
  waiting on you for, and clears at zero.
- **Worker RAM capacity.** An app bar chip shows how many more workers free RAM holds. Each worker counts
  at its typical footprint, and one heavy job's extra (a `tsc` run, say) is held back once.
- The worker steppers in New run and on a run's lead card warn when the width you pick is more than
  fits in RAM; Jarvis says so too, and takes a "RAM full" state when there is no room left.
- **Comments on markdown in the Agent panel.** The File tab shows a `.md` file rendered, with a Preview /
  Source toggle. Select text and press `c`, click a block's `+` (Shift+click for a range), or hover an image
  and click Comment; the tray sends every comment to the agent as one message (`Ctrl`+`Enter`), or copies it.
- Code shows gitignored files in the tree, dimmed. A directory ignored as a whole is one entry that
  lists its contents on demand.
- In Jarvis's brief, an initiative with no chunks reads as an idea, under an "Ideas" label. Each row's
  `…` menu (or right-click) has rename, details, pause/resume, archive and delete without expanding
  the row.

### Changed

- **Usage is a compact dashboard.** The live limits and the historical totals share one row of tiles,
  Daily and Where it goes sit side by side, and the header no longer repeats the totals. With a single
  provider, the provider rail is dropped and the page takes the full width.
- In the Agent sidebar, double-click a run's lead row to fold or unfold its workers, or an agent's row to fold its
  subagents; a single click still selects it.
- The Agent panel's details rail counts its lists (subagents, files changed, artifacts, uploads, background
  tasks) in the tab strip, each count opening its section, and opens on one status line: context, tokens
  and the session's spend.
- Code blocks wrap long lines by default instead of scrolling sideways.
- Jarvis's peek approves a gate or retries a failed task in place, as the brief does, instead of only
  opening it.
- Hover tooltips fade in over 90 ms from the side facing their control.
- Code's header is one compact row, so the editor gets more height.
- The default terminal font size is 14.

### Fixed

- Typing with XKey and other macOS Vietnamese input methods no longer drops letters when a key replaces
  several at once ("mặc định" came out "mặ ị").
- Fast terminal input reaches the shell in the order it was typed.
- On macOS, Ctrl shortcuts show as ⌃, not ⌘.
- On macOS, Code, worktree diffs and skill files open the right paths instead of backslashed ones that
  don't exist; renaming a directory now carries its drafts with it.
- The app bar keeps room to drag the window beside the search at narrow widths.
- On macOS, a tooltip stays open through a screenshot shortcut (⌘⇧4, ⌘⇧5).
- Code's markdown preview shows a file's relative images instead of `[img:…]` text.

## 0.15.0 — 2026-10-06

- Renamed to arcterm. This changelog starts here; earlier history is in `git log`.

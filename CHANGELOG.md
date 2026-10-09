# Changelog

What changed in arcterm for the person using it, newest first. Internals (tests, specs, plans, build
scripts) stay in `git log`.

Add one line in the same commit as any change a user would notice, under `Added`, `Changed` or
`Fixed` in the top section. The top section stays `Unreleased` until its build: on a bump, replace
`Unreleased` with the build date. If the top section already has a date, open a new
`## Unreleased` above it, and give it a version number at the bump.

## Unreleased

### Added

- Codex agents show working, idle and "needs you" on the rail with their session's title and model, and come back in
  their own session after arcterm restarts. arcterm adds its hooks to `~/.codex/hooks.json`; trust them once with
  `/hooks` in Codex.
- Minimizing a float window folds it into Sprout, who floats over your other apps at a corner of the screen: click
  Sprout to answer what waits on you or ask Jarvis, drag it anywhere, and press **Terminal** or double-click it to
  get the float window back.
- Builds, typechecks and whole test suites from every agent and run now go through one queue that starts each as soon
  as the free RAM allows, so several runs no longer push the machine into swap; the new Jobs chip in the app bar shows
  what runs and what waits, with Run now and Skip.
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
  folder, Push never forces, and a refusal from git is shown instead of changing anything.
- A run an agent started with `wsh runs start` links back to that session: `↰ <session>` in the run's header on
  Agent and **started from** on its run sheet, which open the session's terminal, or its transcript once it has ended.
  The other way round, the session's header links its runs with `↳`: one opens its run sheet, several
  (`3 runs, 1 active`) a menu of them.

### Changed

- The Codex and Antigravity marks are a white mark on a dark tile, like pi's, so they read clearly on a dark theme
  instead of fading into it.
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

- Codex sessions show their runtime icon and use the first prompt as a title when the reporter omits it.
- The app bar's 5-hour meter shows again at 0% when Claude's usage reading says the window is unused, and its
  countdown to the reset is back beside it instead of only in the tooltip.

## 0.15.8 — 2026-10-09

### Added

- `Alt`+`W` closes the focused agent when its header shows **Done — Close**, also from inside its terminal; the button's
  tooltip names the key.
- **Mark for later** in a session's menu, in the Agents tree or under Conversations, flags it with a bookmark until you
  pick **Done**; the mark stays when you close the agent, puts the conversation first in its project's list, and is back
  on the row when you resume it.
- New agent: paste or drop images into the task, and resume a recent session of the picked agent and project.
- A Low RAM card now pops up over whatever surface you are on, so a command held for memory no longer waits unseen
  behind Jarvis or the Cockpit; press its number to answer, **Open agent** to go to it, or **Later** (`Esc`) to leave
  it on the agent's own card.
- The Agent rail shows the project's instructions file under the project and branch, `CLAUDE.md` for a Claude agent
  (or `AGENTS.md` when there is none) and `AGENTS.md` for pi and the others; click it to read it in the rail.
- An **Outline** button lists a document's headings and jumps to the one you pick, with the section you are reading
  marked: in the Spec and Plan review, and over the Code surface's Markdown and LaTeX previews.
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
  that comparison.
- The agent header has a **Redraw** button (also in its right-click menu) for a terminal whose text came out garbled
  or overlapping: it repaints the pane and has the agent draw its whole screen again at the pane's size, without
  restarting the session.
- An agent idle for 30 minutes goes to sleep: its process ends and its RAM is freed, but its row and conversation
  stay; **Wake**, or a message to it, picks it up where it was. When RAM runs low the longest-idle one sleeps early.
  Settings → Agents → **Sleep idle agents** sets the time or turns it off; **Sleep** is also in the RAM panel and the
  row's menu.

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
- A run held because its final stage failed names the step that failed in Needs you, and says `wsh runs land
  <run> --force` is the way to land it, instead of advising to clear a reason that Land again can never clear.
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

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

### Changed

- **Canvases is now the Canvas gallery**: the sidebar row, the gallery's title and the `Ctrl+G` `v` command use the new
  name. <!-- try: go:canvases -->
- **What's new** is livelier: a release's highlights show a picture of the feature, every note leads with a colored
  icon for what it is about, and your Jarvis pet tells the news in the corner.

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
  selected, the same keys open the Ideas box. <!-- try: idea-capture -->
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
  <!-- shot: 0.15.12-whats-new.webp -->
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
  diff header to mark the open file and step to the next unreviewed one, and an *n/m reviewed* bar over the list. <!-- try: go:files --> <!-- big -->
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

- Message another live agent from any Claude prompt: start it with `@` and the agent's tab id (`@3f2a91bc review
  this diff`) and it goes straight to that agent's session, not the one you typed in; a line under the prompt says it
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

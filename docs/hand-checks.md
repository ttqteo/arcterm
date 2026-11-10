# Waiting on a hand check

Changes that shipped tested only by unit tests or the typecheck, never tried in the running app (or a platform branch
no build here compiled). Split out of `docs/open-issues.md` on 2026-11-03; that file keeps the rest of the backlog.

Each line: what to do, what you should see, where, and the commit. Tick it when it holds, then remove it; when it
does not, say what you saw and it becomes a bug row under Actionable.

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
- [ ] (arcterm) **Filter box on the rail's Files tab.** Agent → an agent's side panel → Files → type `harn` in Filter
  files (or press `/` with the tree focused) → only files whose name has it stay, their folders open, the part that
  matches in bold, the count in the box, Pinned hidden; ↑/↓ move, Enter opens the file in the panel; Esc clears it and
  the whole tree shows with the cursor on that file. Vitest and the typecheck only (`railtreepane.tsx`, d88315e3b);
  no dev app was up.
- [ ] (arcterm) **Close brainstorm and run.** A brainstorm whose run merged with its final unverified (the Christmas
  tree one, run 983dcb44) → its Run step shows an amber line under the card and a "Close brainstorm and run" button →
  click → a confirm names the unverified final and what of the run it closes → Close → the brainstorm folder goes, its
  idle agent ends, the run leaves Needs you (accepted), its open sessions end, and its "Cleanup failed" line clears
  unless a tree is still held. Unit tests and typecheck only (`brainstormrun.tsx`); no dev app was up, and the
  `brainstorm-run-landed` CDP scenario was updated but not run.
- [ ] (arcterm) **Your prompts stand out in a transcript.** Agent → a project's Overview → History → a session → Open →
  Transcript (or an ended session's transcript in the centre) → each of your messages is a box tinted in the accent
  colour with an accent border, clearly apart from the agent's prose; the prompt pinned at the top while you scroll
  wears the same tint. Typecheck only (`compacttranscript.tsx`, `pinnedpromptbar.tsx`); no dev app was up.
- [ ] (arcterm) **Mark for later from History.** Agent → a project's Overview → History → right-click a session →
  Mark for later → an accent bookmark shows after its title (hover: since when), and the same session carries the mark
  in the Agent tree's Conversations; right-click again → Done (clear later) → the bookmark goes. Typecheck only
  (`projecthistory.tsx`); no dev app was up.
- [ ] (arcterm) **Stop on a background shell task stops what it ran (Windows).** In the installed app, have a Claude
  agent run `sleep 300` (or `npm run dev`) with `run_in_background`, then press Stop on that task in the agent's rail →
  the task leaves the rail and no `sleep.exe` (or the server's `node.exe`) is left in Task Manager. Before, the bash
  stopped and the command it ran kept going. Unit and Windows tests only (`KillShellTask`, b9b0a8444).
- [ ] (arcterm) **The pet runs while arcterm starts up.** Install a build, then open arcterm → while the agents and
  terminals load, the Agent screen (and the Cockpit, if you land there) shows your pet (Sprout, the Minion or Spider-Man,
  in its Santa hat under the Christmas decor) running left and right over a thin floor line, turning to face the way it
  runs, with "Setting up arcterm" under it, instead of grey skeleton boxes; once the roster is read the usual screen
  replaces it. With Windows' animation effects off the pet stands still in the middle. Unit tests (`startuprun.ts`) and
  the typecheck only; never seen in the app (`startuploader.tsx`).
- [ ] (arcterm) **A double right-click in a terminal opens the menu.** In the installed app, in an agent's or a shell
  terminal, with nothing selected: right-click once → the clipboard pastes once after a short beat; right-click twice
  at your usual double-click pace → the terminal menu opens and nothing pastes. With text selected, one right-click
  copies it and clears the highlight. The double-click window went from 300 ms to Windows' default 500 ms, after a hand
  check where a double right-click pasted twice; only the unit tests ran (`termrightclick.ts`).
- [ ] (arcterm) **No Resume while an agent watches a Monitor.** Have a Claude agent start a Monitor (or a
  `while …; sleep` loop) in the background and end its turn → the Overview panel's session line reads "waiting <1m ·
  cache …" with the header's waiting dot and no Resume button; give it a build in the background instead → "working",
  still no button and no Stop. Once nothing runs in the background → "idle" and Resume is back. Unit tests and the
  typecheck only (`railAction` in `agentrailmodel.ts`, `agentdetailsrail.tsx`).
- [ ] (arcterm) **The Christmas theme in WebView2.** In the packaged app pick Settings → Appearance → Theme →
  Christmas, with an agent's terminal open → snow falls over the whole window and reads clearly fainter over the
  terminal, whose text stays readable; the lights hang under the app bar without moving it. Have an agent ask → the
  string blinks in the asking colour, every other bulb half a beat behind, and goes back to lit and still once nothing
  asks. Look at the pet at taskbar size, folded into Sprout (and as Spider-Man on his rooftop) and in the Office → the
  Santa hat reads as a hat, red with a cream trim, not a smudge. Turn Christmas effects off → the snow, lights and hats
  go, the colours stay. Checked by the `christmas-theme` CDP scenario in the dev app; the look itself, in the packaged
  build and at real sizes, was not judged by eye (`christmassnowview.tsx`, `christmaslights.tsx`, `petsprite.ts`).
- [ ] (arcterm) **The Christmas Snow switch.** In the packaged app with the Christmas theme on → no snow falls, and
  Settings → Appearance shows a Snow switch, off, under Christmas effects. Turn it on with an agent printing in its
  terminal → the flakes glide on every frame instead of stepping 12 times a second, the snow still reads fainter over
  the terminal, and typing and scrolling stay quick. The snow paints on requestAnimationFrame (up to ~90 fps) and
  measures the terminals every 500 ms; measured in the dev app at 73 fps on a 75 Hz display, ~7–11% of the main thread
  while it falls (the old 12 fps snow ~0%). Checked by the `christmas-theme` scenario; smoothness not judged by eye in
  the packaged build (`christmassnowview.tsx`, `appearance.tsx`).
- [ ] (arcterm) **A landing run says what its land is doing.** In the installed app, with a run landing (after its
  final stage) → its line in the Agent tree reads "Landing · Verify running 2m 5s" (or Check), or "Landing · Check
  waiting for RAM · #1" in amber while its step waits in Jobs; hover it → the tooltip lists the run, the step, why it
  waits, the command, the job id and `wsh runs show <run>`; click it → a peek beside the tree with the same lines, Run
  now (only while waiting), Jobs, and Copy for an agent (paste it to an agent: the lines are there). Unit tests and the
  typecheck only (`landprogress.ts`, `landprogressview.tsx`); no dev app or CDP scenario ran.

- [ ] (arcterm) **Christmas: the empty cockpit's hat and a finished run's gift.** With the Christmas theme on, close
  every agent so the Cockpit shows "No agents running" → the terminal-window glyph wears the Santa hat on its top-left
  corner, clear of its glow. Let an orchestrator run land with its final check passed → its row in the Agent tree reads
  Complete beside a small gift instead of the check; a run that landed unverified keeps its check. No CDP scenario
  opens either state (`cockpitemptystate.tsx`, `agenttree.tsx` RunCompleteLabel, f4d4c99cb).
- [ ] (arcterm) **A brainstorm's Approve follows the Profile's Approvals.** With Jarvis → Profile → Approvals:
  Autonomous saved, approve a brainstorm's design (Approve and start an orchestrator run) → the New dialog opens on
  Orchestrate with the goal and Prototype filled and Approvals on Autonomous. (fix(launcher): `applyLauncherPrefill`
  in `launcherstore.ts` uses `pickRunShape`)
- [ ] (arcterm) **New → Orchestrate follows the Profile's Approvals.** Jarvis → Profile → Global → Approvals:
  Autonomous → Save. Open New, pick Orchestrate with arcterm picked → Approvals shows Autonomous. Pick another
  project, then back → still Orchestrate. Change Workers by hand, switch project → your pick stays. (fix(launcher):
  `pickRunShape` in `runconfigstore.ts`)
- [ ] (arcterm) **An agent asks before it edits another repo.** After the next build, in a Claude agent started in
  one project (mit-thesis) and in auto mode, ask it to change a file in arcterm → Claude's permission dialog comes up
  first, reading "arcterm: <file> is in another repo (D:/src/arcterm), not this session's project (…)"; say yes →
  first, reading "arcterm: <file> is in another repo (D:/src/arcterm), not this session's project (…)"; say yes →
  first, reading "arcterm: <file> is in another repo (D:/src/arcterm), not this session's project (…)"; say yes →
  its next edits in arcterm go through without asking; say no → the file is untouched. An engine run's worker editing
  its own worktree under `arc-wt` is never asked. Tried only headless (`claude -p`, where the ask is a refusal with
  that reason); the dialog itself is untried (`claude/arc-mod/hooks/foreignrepo-core.ts`, 4b5c0bc94).
- [ ] (arcterm) **Council "N agree": avatars and a list on hover.** Open a council with an idea two or more seats
  agreed with → the signal line under it shows their small avatars stacked before `✓ N agree`; hover it → a card under
  it reads "Agreed, nothing to add" and lists each seat, avatar and name, one per line (it flips above near the bottom
  of the window). One seat shows its avatar and `<Seat> agrees` with no hover. (main, 2026-11-05)
- [ ] (arcterm) **Council composer: tinted @seat, and Ctrl+Z.** In the packaged app open a council, type `@` in the
  message box and pick a seat with a long name (`Reviewer 1 (area expert)`) → it shows tinted in the seat's colour,
  the caret and a selection sit where the letters are, also once the text wraps and once it scrolls past the box's
  height. Press `Ctrl`+`Z` → the pick goes back to the `@…` you typed; click an Ask next question → `Ctrl`+`Z` empties
  the box. Checked only in headless Chrome by `council-discussion` (undo there by `execCommand`, not the keys); not in
  WebView2 (`councilchat.tsx` ComposerMarks / editBox, aaad0bc86).
- [ ] (arcterm) **Mark shows a ticked box when on.** Open a design canvas (Canvas pane, or a brainstorm board opened
  large) → Mark shows a dashed square; click it or press `m` → it turns accent and its icon becomes a ticked square;
  click again → back to the dashed square. (`canvaspane.tsx`, `brainstormrail.tsx`, main, 2026-11-05)

- [ ] (arcterm) **Float and the fold on a scaled Windows display.** On the Windows PC at 125% or 150% scaling, with
  arcterm maximized: Float → the window leaves maximized and shrinks to the float's place at the float's size (not
  1.25× or 1.5× off); Full again → it is maximized. Fold into Sprout, switch to another app and back → Sprout lands in
  its corner at its size, and coming back grows it to Full, maximized (`waveapp.log` has `back in arcterm: growing back
  to Full, maximized`). Click Sprout → the card's Restore window row ends `double-click · Ctrl+M`; drag an agent over
  another's cell → `hold Alt to mention`. A unit test (`floatstore.test.ts`) and the typecheck only, on a Mac, whose
  branches are unchanged; no app was run (`floatstore.ts`, 59935b14d; `sprout-mini.tsx`, `griddropoverlay.tsx`).
- [ ] (arcterm) **Ship chip in the agent header.** After the next launch (wsh carries the hook's new `edited`), have a
  Claude agent edit a file and end its turn → its header shows an accent **Ship** before ✓ Close, its tooltip names the
  file count and the upstream; an agent beside it in the same checkout that did no git work shows none. Click it (or
  `Alt`+`S` from inside the terminal) → the agent gets the Ship prompt as its own turn and the chip leaves at once; it
  commits only its files, pulls, pushes without asking "push?" again. The header's … menu lists Ship and Commit only.
  Then in Diff on that agent, a Pull refused as diverged → the notice shows `Ask <name> to merge` before Open a
  terminal here. Unit tests and the typecheck only; no dev app was run (`shipmodel.ts`, `agentheader.tsx`,
  `syncbar.tsx`, 3020b6b51).
- [ ] (arcterm) **A dragged path with a line break or a double quote is left out.** On a Mac or Linux make a file
  named `a"b.md` (and one with a newline in its name), drag it from the Agent rail's Files tab onto a terminal → nothing
  is typed for it and a warning toast names it; an ordinary file dropped beside it is still typed. Unit-tested only
  (`splitDroppable`, `pathdrop.ts`; toast in `focus-pane.tsx`); commit 605413407.
- [ ] (arcterm) **HTML previews keep working under the new CSP.** In a live arcterm open a design canvas, a brainstorm
  board and an HTML file in the File tab → each draws as before (fonts, React boards, images), the canvas reports its
  height and the File tab keeps its scroll; DevTools shows no `Refused to` line. Checked only in headless Chrome against
  the 145 boards in `.superpowers/design` with the same header (`pkg/htmlserve` `CSP`).
- [ ] (arcterm) **Council seats on opus by responsibility.** After the next launch (the arc mod carries the new skill),
  ask a Claude session in a live arcterm for a council on a thesis question ("does the method in chapter 3 hold?") →
  before the Token burn card it says in one line which seats go to opus and why, with the `wsh council estimate`
  number and that the estimate does not price opus higher, and its `start` carries `--model <seat>=opus`. Then ask for
  a council on a wording pass → no opus seat, no model line. Skill prose only, never run by an agent
  (`skills/council/SKILL.md` "Which seats run on opus", "Writing a role").
- [ ] (arcterm) **Round 1 idea cards draw Markdown.** Start a council whose experts answer with a table or a `==…==`
  sentence → while it is still in Round 1, the cards under Ideas so far in Discussion show a real table and a
  highlighted sentence, not raw `|` and `==` (`councildiscussion.tsx`, 634a18218).
- [ ] (arcterm) **Council title on two lines, short step chip.** Open a running council with a long title in
  Discussion → the title wraps to two lines (then an ellipsis), the row stays 52px, and the chip reads `Round 1/2`
  whole, never `Round 1 of…`; hovering it shows `Round 1 of 2`. Narrow the window to ~1000px: the chip still whole.
  Not run in the app (no dev app up); `council-discussion` CDP scenario not run either.
- [ ] (arcterm) **New agent's Task row icons.** New agent → a Claude row in a git project → the Task hint shows whole,
  and on its right sit three icons: a flag, a git branch and a terminal with ›. The branch icon lights clay when
  clicked on and the branch row opens under the box; a flag turned on in the flag menu puts a count on the flag icon
  and a chip under the text, and the chip's × takes it off; the terminal icon opens and folds the command strip. The
  CDP scenario `launcher` was updated but could not run: a fresh dev store's wavesrv exits on "error creating
  starter workspace … transaction has already been committed or rolled back" (`launcheragentfields.tsx`).
- [ ] (arcterm) **Round 2 keeps ideas whole and marks new replies.** Open a council in round 2 (or done, with replies)
  whose ideas are long → every idea shows whole, with no Show more; an idea with seat replies since you last left the
  council says `N new replies` on its reply chip and its Ideas rail row, the rail's `N with new replies` toggle lists
  only those, and opening the thread clears the mark. An old council you left after it finished lights up nothing. The
  `round 2 whole` phase of `council-discussion` was written but never run (no dev app up) (`councilchat.tsx`; the
  fold from fd4ca03b6 was removed).
- [ ] (arcterm) **New agent's Task row icons.** New agent → a Claude row in a git project → the branch icon lights clay
  when clicked on and the branch row opens under the box; the terminal icon opens the command strip and folds it
  again. The rest holds: the `launcher` scenario passed in the Tauri dev app on 2026-11-05 (steps 18b, 18c: the three
  icons on one line, the flag chip and its ✕) (`launcheragentfields.tsx`).
- [ ] (arcterm) **Round 2 marks no new replies on an old council.** Open a council you left after it finished → no idea
  says `N new replies`, and the rail has no `with new replies` toggle. The rest holds: the `round 2 fold` phase of
  `council-discussion` (fold, Show more / less, `1 new reply` on the chip and the rail row, the toggle, the thread
  clearing the mark) passed in the Tauri dev app on 2026-11-05, once the scenario set its last-opened time
  (`councilchat.tsx`, fd4ca03b6).
- [ ] (arcterm) **Open DAG opens at once.** Jarvis → a run's sheet → Open DAG → the window appears on the click with
  a skeleton where the graph goes, its entrance runs smoothly, and the graph fills in once it has arrived (the pet
  never freezes). Tried only in headless Chrome, never in WebView2, where the removed full-window `backdrop-blur`
  was the suspect (`dagmodal.tsx`).
- [ ] (arcterm) **A brainstorm handed to a quick run follows it.** Hand a brainstorm's spec to a quick run → its Agent
  tree line reads `working · run …`, then `done · run …` (never `planning`), and the Run step offers Close the
  brainstorm once the run is done (`brainstormrunmodel.ts` `quickStepView`).
- [ ] (arcterm) **Brainstorm offers a quick run for a small build.** Brainstorm a small change with no mockup to
  approve, with the agent writing `"runShape": "quick"` beside the spec → the approve bar reads "Approve and start a
  quick run" and `<project> · quick run · one worker, no plan`, and Approve opens the launcher on Quick run. A
  brainstorm with a board still offers the orchestrator run. Agent tab → brainstorm pane; commit 2f79224af.
- [ ] (arcterm) **Ideas rail click keeps the window still.** In a council's Discussion with the Ideas rail open, click
  an idea far down the rail → the app's frame (nav rail labels, title bar, footer) stays put with no black band at the
  bottom; j / k and a reply's quote jump do the same. The scroll itself holds: `council-discussion`'s rail step (P5's
  row scrolls its message to the top) passed in the Tauri dev app on 2026-11-05; no step reads the frame
  (`revealIn` in `councilchat.tsx`, `revealTop` in `councilscroll.ts`).
- [ ] (arcterm) **Council screenshot regions with real seats.** Run a Review council with a screenshot attached (and
  paste an image into a reply) → the seats cite `screenshot:<file>#<name>@x,y,w,h`, each crop under an idea or reply
  boxes the element the seat names, and a click opens the whole screenshot in Sources with the box on it. Done → the
  saved document has a `<doc name>-regions/` folder beside it and shows the crops. The CDP scenario `council-regions`
  covers a seeded council only; no model ran (`evidenceRule` in `pkg/council/prompts.go`, `regions.go`; commit
  8b3f34d58).

- [ ] (arcterm) Open a council idea's thread panel (380px) and look at a reply whose seat name and stance pill fill the
  byline ("Người lo trải nghiệm · has doubts") → no empty line between the byline and the bubble; hover it → its time
  and thumbs appear over the byline's right end on the panel background, and nothing below moves. Same on the idea at
  the top of the thread. No dev app was up; prettier only (`HoverEnd` in `councilchat.tsx`).

- [ ] (arcterm) With the machine short of memory (Windows: commit charge past the RAM) and two runs active, let one
  run have a ready task while the other has a worker live → the ready task starts within a tick, and `waveapp.log`
  stops repeating `ready tasks held back while the machine's memory is short` for it; set Jobs to Off and a run with a
  worker live starts its other ready tasks too (d561ef671).
- [ ] (arcterm) Click a task node, then the Final verification node, in a run's graph → the peek's Worker / Review /
  Tokens values, activity lines and Open in Agent read in Inter like the title; only a Verify output tail stays mono
  (22a9f852e).
- [ ] (arcterm) Open a brainstorm (question card, check clock, run sheet), a background task peek, Setup → Memory and
  the @ file picker in the New dialog → labels, counts, file names and times read in Inter; only commands, output,
  keycaps and hashes stay mono.
- [ ] (arcterm) Close a quick run's agent tab → the run goes blocked with the tab-closed reason, and Resume opens it in a
  new tab (run aebf7808 Task 4).
- [ ] (arcterm) Hold a lane tree's folder (a shell cd'd into it), then `wsh jarvis dag retry <task>` → the task runs at
  `<dir>.1`; let go of the folder and run retry-cleanup → `<dir>` is deleted (run aebf7808 Task 4).
- [ ] (arcterm) Fix a failed merge Verify in the run's tree, leave it uncommitted, run
  `wsh jarvis dag merge <task> --continue` → refused, naming the file (run aebf7808 Task 5).
- [ ] (arcterm) `wsh jarvis dag retry <task>` and `wsh jarvis dag escalate <task> --model opus` on a task in
  blocked-merge → each is refused naming `dag merge <task> --continue`, and the task and its worker tab stay as they
  were (run aebf7808 Task 6).
- [ ] (arcterm) **A council's memory with the real checks, in the installed app.** In a council past round 1, send a
  message that settles one point and drops another → after the seats answer, the Memory tab (`Memory · N`, its dot on
  while you are elsewhere) lists new `Agreed` / `Ruled out` / `Open` rows from the haiku round check, at most three, each
  badge's tooltip saying what it means. Hover a row (WKWebView, not the headless Chrome the Final used) → Set as direction (pin) ·
  Edit · ⓘ · ✕ show on one line with the badge unbroken, and ⓘ's popover reads `Auto · round N` / `rN · time` inside the
  rail. Set a row as direction → it becomes the Direction pinned on top and leaves the list; set one that clashes → the held card, and
  Discard keeps the row. Ask the seats again → none argues an Agreed row or proposes a Ruled out one. Remove an auto row
  → the next round does not add it back. Also see what Unpin leaves: the earlier directions then show nowhere until a
  new direction is set (spec 2026-11-05 hangs Earlier on the direction row only). The `council-memory` scenario drives
  every state with the commands stubbed; the haiku checks, the seats' prompts in a live council and WebKit hover are
  untried (`councilmemory.tsx`, `pkg/council/memorycheck.go`, `prompts.go`; 925805200, 04614993b).

- [ ] (arcterm) An asking agent's whole row in the Agent tree breathes: get an agent to ask (a permission prompt or a
  brainstorm question) → its row, selected or not, fades its amber wash and 1px amber edge up and down every ~2.4s
  (never out entirely), the row's text stays sharp over the wash, and no amber line or dots show outside its corners,
  even after the row moves or the tree scrolls; answer it → the row goes back to plain. No dev app was up
  (`.asking-tint` in `tailwindsetup.css`, `pulse.ts`, `agenttree.tsx`).
- [ ] (arcterm) Running background tasks fold in the Agent tree: get an agent to leave three or more commands running
  in the background → its row shows a `3 running` chip and no task rows under it; click it → the rows list, click
  again → they fold. With one or two running, the rows show and no chip appears (`tasksShown` in `agenttreemodel.ts`,
  `agenttree.tsx`, 701fef533). 2026-11-05: on the `monitor-tasks` fixture (three running) the chip shows, the rows are
  hidden until it is clicked, and clicking it lists them; left: a real agent, the second click, and one or two tasks.
- [ ] (arcterm) A council stopped after its summary reads Done: in the Agent tree, the HarnessX council in mit-thesis
  (stopped, has a summary) reads `Done`, not `Stopped`, and its Discussion header chip reads `Done`; ask it a follow-up →
  once answered it still reads `Done`. A council stopped mid-round (no summary) still reads `Stopped`. No dev app was
  up; unit tests and the typecheck only (`shownState` in `councilmodel.ts`).
- [ ] (arcterm, Mac) A zoomed-in app shows no scrollbars on a sleeping agent's message box: with the zoom at 1.1
  (⌘+ once from 1), put an agent to sleep and open it → the box under its conversation shows its placeholder on one
  line with no sideways or up-down scrollbar; type two or three lines with Shift+Enter → it grows with no scrollbar.
  Checked only in a standalone WKWebView harness with the built CSS (zoom 0.9 to 1.5, 9 widths and contents, no
  scrollbar after the fix; at 1.1 and 1.2 the old code reproduced the screenshot); WebKit-only, so headless Chrome
  cannot show it. Commit 7915e5d9b (`tailwindsetup.css` `textarea`, `agentcomposer.tsx`).

- [ ] (arcterm) New agent opened from a project's Overview starts on that project: focus an agent in project B, click
  project A's folder in the Agent tree (its Overview fills the centre), press ⌘N (and the app bar's New) → the dialog's
  Project column has A picked, not B. Back on B's terminal, ⌘N picks B again. Commit 70a182909.
- [ ] (arcterm) A council's Discussion is the chat again, with a quiet Ideas rail beside it: open a council that has
  ideas → the channel of messages fills the pane and the rail on its right lists each idea (number · author, title, a
  muted line of replies and stances); a row scrolls the channel to that idea. An idea's replies button opens its thread
  on the rail's second tab (`Idea N · M replies`), × closes it; » folds the rail and `Ideas · N` over the channel brings
  it back, still folded after a restart. The `council-discussion`, `council-routing` and `council-summary` scenarios
  pass in headless Chrome (`task dev:browser`) and in the Tauri dev app on Windows (2026-11-03, 138 + 21 + 28 steps,
  the rail steps included); left: the fold kept after a real restart, and WKWebView (`councilchat.tsx` `CouncilRail`).

- [ ] (arcterm) Pin on a council in Overview → History: in a project's Overview → History, unfold a council row → Pin
  sits beside Open council, and right-click offers Pin / Unpin. No scenario reaches it (`project-overview-history`
  opens the council but never pins). The tree half (Close on an ended council, no Pin in the tree) holds: `council-tree`
  passed 26/26 twice in the Tauri dev app on 2026-11-03, steps 11b, 11g and 11h included (`projecthistory.tsx`).

- [ ] (arcterm) The council router answers small talk itself, and a failed seat shows under your message: in a done
  council with two or more seats, send `hello` to the whole council in the Chat → within seconds a Router reply
  answers it, with Ask <seat> too chips under it, and no seat is called. Send a real question → the router picks a seat
  as before. With a seat whose call fails (a 5-hour limit), the line under your message reads `<seat> could not
  answer: <error>`. Go tests and vitest only (`pkg/council/router.go`, `settleRoute`, `councilmodel.ts` `replyLabel`).

- [ ] (arcterm) Kael sync: a real Claude Code Monitor in the Agent tree: in a live Claude session ask for a Monitor
  (a command that prints a line every few seconds, with a timeout) → a row appears under that agent with its label and
  an "N m left" chip; click it → the peek's Events tab gains an event each time the command prints, and the footer
  keeps counting. Click Stop (Windows, two clicks) → the Monitor's process ends, the row leaves the tree and the peek
  closes. Only fixture transcripts drive the `monitor-tasks` scenario, so no live Monitor was seen, a running
  Monitor's Output tab (it names no output file yet) was not either, and the Stop RPC's kill of a real process was
  not run (`monitortasks.ts`, `backgroundtaskpeek.tsx`, `agenttree.tsx`).

- [ ] (arcterm) Kael sync: ligatures in a font that has them: with the code font set to JetBrains Mono or Fira Code,
  open a file in Code, Diff or an agent's File tab with `->`, `!=`, `=>` and `>=` in it → each draws as one joined
  glyph; with Hack picked they stay plain pairs (Hack has none). The `code-diff` scenario reads the option and the
  computed `font-feature-settings`, not the glyphs (`diffoptions.ts`).

- [ ] (arcterm) A run in a monorepo folder starts and checks out only that folder: start an orchestrator run in the
  portal project (`D:\Workspace\SIEM\apps\portal`) → it starts without "creating landing tree" and is not cancelled;
  its tree under `%LOCALAPPDATA%\arc-wt\<run>` holds `apps\portal` and the repo's root files, not `src\` or
  `apps\website`, and `git -C <tree> sparse-checkout list` prints `apps/portal`. A tree slower than 45 s replies first
  and the run shows its lead once the tree is done (`waveapp.log`: "still checking out … finishes in the background").
  Unit tests only; needs the new wavesrv (`worktree.go` `addWorktree`, `wshserver_runs.go` `CreateRunCommand`).

- [ ] (arcterm) A council's status chip keeps its word beside a long title: open a council with a long question on
  Discussion and on Map in a narrow pane → the title ends in an ellipsis first and the chip still reads "Stopped" (or
  its step) in full; it truncates only once the title is down to its 72px floor. Not tried in the app
  (`councildiscussion.tsx`, `councilmap.tsx`: the title shrinks with weight 1000).

- [ ] (arcterm) Deleting a just-closed session says how long to wait: after the next build, close an agent, then at
  once delete its session in History → the toast reads "…it was written to 20s ago (a closed agent writes its last
  lines as it exits), try again in 1m40s", and a delete after that wait goes through. Unit tests only
  (`pkg/sessiontrash`, 85223554b).

- [ ] (arcterm) A run from a spec settles its last plan review itself: after the next build, start a run from a
  brainstorm (Build … as specified in …) → if round 2 of the plan review fails, the lead carries the findings in with
  `wsh jarvis dag amend` and runs `wsh jarvis dag planreview accept` on its own, with no Plan review ask, and
  `wsh runs show` reads "failed, then accepted by the lead"; only a finding that changes the spec's decisions still
  comes to you as a Plan review ask. Unit tests only (`pkg/orchestrate/planreview.go`, `pkg/jarvis/leadprompt.go`,
  3520d3a3f); no live run yet. Run 40deb36e already reads "failed, then accepted by the lead" with no answered ask, but
  it started (~15:00) before 3520d3a3f, so it does not count: the next run started from a spec on the c7523d59a build
  or later decides it. 2026-11-04: run 88032140 (from a spec, started after 3520d3a3f) reads "failed, then accepted by
  the lead", but `wsh runs show` prints that for any accepted review and the run lists 2 answered asks; left: its
  lead's transcript, to see whether either ask was a Plan review.

- [ ] (arcterm) A done run's closed dag reads done, not cancelled: `wsh runs show 40deb36e` and `c06ba9cb` print
  `status=closed (the run ended done)`; in Conversations, run 40deb36e's group head and a brainstorm whose Run step
  points at a landed run with a failed task do not read cancelled. The wsh half holds: a dev wsh built from 07a21f3fd
  prints `status=closed (the run ended done)` for both runs (2026-11-03). Left: the Conversations half, in the
  installed app after the next build (the dev app's store has neither run) (`sessionsruns.ts`, `brainstormrunmodel.ts`).

- [ ] (arcterm) A merge's Verify no longer typechecks: in the same run, `wsh runs show` → each merge's Verify output
  has no tsc step, and a merge that changed only TS files verifies in about a minute instead of 3 to 9; the final
  stage's Verify does run tsc. Unit tests and one scoped run by hand only (`scripts/verify.mjs`, 5eae7f42f). Not
  decidable from 40deb36e: its base (e190d40c4) predates 5eae7f42f, so its merges ran the old script; the Kael sync run
  a1c7dbff (started 17:37 on 2026-11-03) is the first on the new script.

- [ ] (arcterm) A force-landed run reads Landed: in the Agent tree and the Brief, find run c06ba9cb (Council UX pass,
  landed with Land anyway after Final round 2 failed) → its stage reads Landed with the Final check pip failed, not
  Cancelled. The wsh half holds (2026-11-03): the installed wsh adds "(closed when the run ended: the run is done, not
  cancelled)", and 093b00b93 has since replaced it with `status=closed (the run ended done)`. Left: the tree and the
  Brief in the installed app (`frontend/app/view/agents/runstage.ts`).

- [ ] (arcterm) Council thread replies stay in their thread, with a live seat: on a running council's Discussion, open
  an idea's reply chip and send a reply in the thread → it shows in the thread and the idea's chip counts it, no copy
  in the channel, and the seat's answer lands in the thread only. The fixtures passed in headless Chrome
  (`council-discussion`, `council-summary`, 2026-11-03); a real send and answer was not tried (`councilChannel`,
  `frontend/app/view/agents/councilchatmodel.ts`).

- [ ] (arcterm) Tidier app page header: open a running app (service) on the Agent surface → the header reads
  Page | Log, the state line, then ← → ⟳ ⌂ ↗ in one tight group, a thin divider, ⋯ and Stop; switch to Log → only ↗,
  ⋯ and Stop stay; click ⋯ → the tree row's menu (Stop, Restart, Stop and hide, Keep running, Pin…), and Restart there
  restarts it. `tools-app` (14/14) and `services-tree` (12/12) pass in the Tauri dev app (2026-11-03): Page | Log,
  back / forward / home, ↗, ⋯ and Stop, no close. Left: the buttons Log leaves, and ⋯ → Restart from the page header
  (`frontend/app/view/agents/terminalpaneheadview.tsx`).

- [ ] (arcterm) Zoom is kept: press Ctrl+= twice, quit arcterm and open it again, then install a new build over it →
  the app opens at 120% both times; Ctrl+0 → 100%, and it stays 100% after the next restart. The factor is saved in
  localStorage `cockpit.zoom` (`frontend/tauri/chrome.ts` `restoreZoom`, run from `installChromeListeners` at boot).

- [ ] (arcterm) Float keeps its size on a Mac: float a terminal, leave Float, float again a few times, then fold into
  Sprout from Float and restore → the Float window is the same size each time, and Full (not maximized) comes back at
  the size it left. The float's frames now read the window's inner size (`floatstore.ts` `shadowedFrameOf`), taken on
  macOS to equal its outer size for this borderless window; on Windows `float-mini` and `jarvis-modes` held the saved
  rect at one size over five runs (2026-11-03), where it grew 16×9 px a float. An installed app's saved rect
  (`arc.float.rect`) keeps the size it grew to until you resize the Float window. "fix(float): the float window keeps
  its size; Sprout re-measures its ledge on Float".
- [ ] (arcterm) Council report under a cover, in the real app (WebKit; the run checked only headless Chrome): open a
  Done council → a cover with the question, the answer and the glance box on the right, Report | Discussion tabs that
  stay at the top when you scroll, the ideas as cards with one open at a time and its detail under the row; click
  Discussion → one 52px header row with the tabs, title, seats as avatars with counts, cost and Close; click a seat →
  only its messages and a Show everyone line; narrow the pane → the title keeps a readable width. (d660217e5)
- [ ] (arcterm) Council seats and report panel, in the real app: on a council's Discussion, hover the seats' stack →
  a list of every seat (name, kind, doing, count) opens under it, leave → it closes; click a row → only its messages,
  the others' avatars dim; Close is an X. On the Report, hover a seat in The panel → the row does not grow, an arrow
  shows at the end of its line and the hint sits to the row's right, not over the next seat. (13008d427, a9cfb0639,
  77011c8ce)
- [ ] (arcterm) New project search reads paths from `~`: open Agent → New project, type your user name → both
  sections empty; type `cuscofi` → the folders named cuscofi first, then any that hold it only in their path; type
  `~/Workspaces/dev` → only the folders under it. (9d23c1862)
- [ ] (arcterm) Jump buttons are arrows only: scroll a council's Discussion off both ends → round ↑ / ↩ / ↓ buttons in
  its bottom right, no words, each with its tooltip on hover; scroll up in an agent's transcript (a card's or the
  rail's) → a round ↓ at the bottom centre, no "Latest". (d059f1b58, dfadeab66)
- [ ] (arcterm) A live chat joins a council that already exists: open a Done council, type `@` in its message box →
  the seats, then **Add a live chat** with each real claude or pi chat (short id, title, harness, project, context
  size; none of the seated ones). Pick one and send a question → the line under the box counts it ("… and 1 chat
  answer" with a figure that includes its context) before Send; after Send it shows on the seat bar, answers from its
  own context (it read the report and what came after it, not the whole discussion), and the council still holds no
  drafts if it held none before. Then pick a chat and close its tab before Send → the send is refused with the live
  tabs listed, and the message stays in the box. No scenario starts a real agent (`councilchat.tsx` `Composer`, spec
  `2026-11-02-council-add-chat-design.md`).
- [ ] (arcterm) Images and @file in a council's message box: open a Done council, paste a screenshot into the box → a
  thumbnail chip with a spinner, then ready, and Let them read files turns on and locks; type `@` and part of a project
  path → a Files group under Seats; pick a file and send → an expert's answer shows it read the image and the file
  (the sent bubble has the thumbnail and a file chip that opens Sources). Then leave the council and come back with a
  chip in the box → the chip and text are still there. No scenario runs a real `claude -p --add-dir` (`councilchat.tsx`
  `Composer`, spec `2026-11-02-council-attachments-design.md`, run e799103d).
- [ ] (arcterm) Compact council composer: open a done council's Discussion → Let them read files sits on the left and
  `4 experts answer · ≈ 4 calls · ~80k tokens` on the right of one row under the box; scroll up, press Top → Back and
  Latest show side by side in the channel's bottom right, Back's label one word. Open a thread → in the narrow panel the
  cost line wraps under the switch rather than clipping. The commit that adds this line.
- [ ] (arcterm) Pet stay pin in the folded Sprout window, with a real mouse: float a terminal (Shift+F out of the
  terminal), fold into Sprout, open the hover card's chat, click the pin → the Stay menu's rows take a real click (the
  folded window's click-through is the OS's, which a CDP click never goes through); pick Stay 1 hour → the menu closes
  and the pin is lit. A click outside the menu falls through to the desktop and leaves it open there (its backdrop has
  no `data-mini-hit`): the known gap, so close it with Escape or a pick. `float-mini` step 4 covers the rest on Windows
  (the pin before Terminal, the menu inside the window and a `data-mini-hit`, Escape keeps the peek; passed
  2026-11-03). `petpeek.tsx`, "feat(pet): the pin and its stay menu in the peek header".
- [ ] (arcterm) The council composer sits in the message column: open a council's Discussion on a wide window → the
  message box's left and right edges line up with the messages' 860px column (with and without a scrollbar), and
  sending a message (in the channel and in a thread) makes your bubble rise in from below; reopening the council or
  switching the seat filter animates nothing. `councilchat.tsx`, "feat(council): composer in the message column".
- [ ] (arcterm) The handed-over rows keep their text wide: open a brainstorm whose run has started, with parts that
  have a long "from" ("agent's call, from answers 2 and 6") → in What you handed over, each part's text fills the
  column and the from line sits under it in small mono, cut with an ellipsis (full text on hover), not a column of
  its own squeezing the text to a word a line. `HandedRow`, `brainstormrun.tsx`; commit "the handed-over list keeps its text wide".
- [ ] (arcterm) A brainstorm waiting on confirms asks for you: leave a brainstorm at Confirm the design with guesses
  and no question open, the agent idle → its tree row pulses like an asking agent and reads "confirm N decisions",
  the Brainstorm tab shows the amber dot, and the taskbar flashes once (`brainstormmodel.ts` `awaitsReview`).
- [ ] (arcterm) The Agent panel's counts scroll: open an agent's details panel on Overview (300px) with enough counts
  to overflow (Subagents, Files, Servers…) → the wheel over the counts slides them sideways, the hidden edge fades,
  and the last count is reachable (`agentrailpanel.tsx` `RailStats`).
- [ ] (arcterm) A brainstorm's agent sleeps once its run starts: with Sleep idle agents on, Approve a brainstorm in a
  claude chat and Start the run from the launcher → the agent records the run in `brainstorm.json`, its turn ends, and
  ~15s later its row shows the moon and a `Put <name> to sleep` notice. Type into it within those 15s instead → it
  stays awake. Approve stays off while the run is starting (the WIP handback, uncommitted). `aafac19`.
- [ ] (arcterm) History names a spec run by its feature: open a project's History that lists a run started from a
  brainstorm → its row reads "Build <feature>" with no path, and the line under it ends `· <spec file>.md`
  (`projectoverviewmodel.ts` `runHeadline`).
- [ ] (arcterm) Council seats the chats you name: from a claude chat, ask for a council on "this chat + <another tab
  id>" → `wsh council start` runs with `--agent self --agent <id>` and prints `… · 2 chats + Skeptic · …`; both tabs
  answer each round in their own transcript, nothing is held as a draft, and the starter's background `wsh council wait
  <id> --timeout 0` brings the report, which the chat sums up. Then name a wrong tab id → the start fails before the
  Token burn card and lists the live tabs. `skills/council/SKILL.md` "Seating chats", spec
  `2026-11-02-council-agent-seats-design.md`.
- [ ] (arcterm) A project folder carries its share of the Jarvis badge: with a run waiting to land or a gate open in
  a project, the Agent sidebar's folder icon for that project shows a count in the Jarvis badge's colour at its top
  right, the counts across folders add up to Jarvis's (less what names no run: due chunks, learn proposals), and it
  clears with the item. `agenttree.tsx` `FolderRow` `jarvis`, `jarvisCountsByProject`.
- [ ] (arcterm) A sleeping agent's rail has no Transcript tab: put an agent to sleep while its rail sits on Transcript
  → the strip drops the Transcript icon and shows Overview; Ctrl+Shift+F does nothing; Wake → the tab returns and is
  selected again. `agentdetailsrail.tsx` `hasTranscript`, "fix(agents): a sleeping agent's rail drops its Transcript
  tab".
- [ ] (arcterm) History run/council rows carry their badge on the meta line: Project Overview → History → a Run or
  Council row's title starts at the same left edge as a session's, and its second line reads "◆ Run · …" /
  "● Council · …"; unfold a council → the peek lines up under the title. `projecthistory.tsx` `KindLabel`,
  "fix(agents): History's run and council badge moves to the meta line".
- [ ] (arcterm) Council follow-up answers don't echo the first one: in a council that has a report, send a yes/no
  question to Everyone → the first seat answers it; the others open with their own new point (no "Đúng" / "Mình đồng
  ý" / "Agreed", no repeat of the first seat's caveat) or show as "X agrees". Seen failing in council 7096c31c (r64–r67)
  before the fix; `pkg/council/prompts.go` (`othersAnsweredRule`, `writeAnswered`), "fix(council): later answers
  to a question everyone was asked no longer echo the first one".
- [ ] (arcterm) Council seat chips flat, tables wrap: open a council's Discussion → the Everyone / seat chips are flat
  rows (6px corners, no coloured border or tint; the selected one grey); a seat at work shows only its dot, no
  "Replying to …" text, which its hover says; a reply with a Markdown table wraps its cells to the bubble's width, no
  horizontal scrollbar unless a cell holds one unbreakable long word. Also check a table in a note.
- [ ] (arcterm) Brainstorm checks fold: in Agent, a brainstorming agent whose Builder check and Judge both answered →
  no rows under it, a `› ✓ ✓` chip on its second line; click it → both rows show and the chevron turns; click again →
  they fold. Start a new builder check → its row shows while it reads. `agenttree.tsx` `ChecksChip`,
  "feat(agents): fold a brainstorm's check and judge rows into a chip".
- [ ] (arcterm) Council weak chip: open a council whose message has a long weak claim (`Weak · 'About 20 nodes…' is an
  estimate…`) → the amber chip grows to fit its 2–3 lines, nothing spills onto the "3 replies" row below.
  `councilsourcespanel.tsx` (uncommitted).
- [ ] (arcterm) Council in a subfolder project: after a build with ab80bf5ac installed, from an agent in `website`
  (registered at `D:\Workspace\SIEM\apps\website`) start a council → it shows under website's Councils in the Agent
  tree, and `wsh council list --project "" --json` gives its project as `...\apps\website`, not `D:\Workspace\SIEM`.
- [ ] (arcterm) Jarvis Councils region: open Jarvis with a council running and one done this week → a Councils
  region sits under Runs, the waiting/running ones first, each row `council` · title · project · N experts · age and
  its state word; clicking a row (or Open / Report) lands on that council in Agent; j/k walks into it; with none in
  seven days it says so and offers New council. `briefsurface.tsx`, `briefcouncils.ts`, "feat(jarvis): a Councils
  region…".
- [ ] (arcterm) Conversation History: Resume a claude conversation, then Resume it again before its terminal draws;
  the toast reads "<name> is still starting", not "already open", and no second tab opens. `cockpit-actions.ts` `goToHolder`.
- [ ] (arcterm) Cockpit → Cards with a card showing its pinned prompt bar: open the header's All projects menu; every
  project row draws on top, none hidden behind a card's pinned prompt. 7feaba75d
- [ ] (arcterm) Agent sidebar: right-click a project folder → New agent… is the first item; picking it opens the New
  dialog on the agent half with that project picked (Home's folder has no menu). 638834b86
- [ ] (arcterm) Run start with an empty harness catalog: after a launch failed "Selected route is unavailable", press
  ↻ on its toast (or Approve a brainstorm again) → the run starts on the project's route instead of failing again.
  `runactions.ts` `resolveChannelLaunchRoute`, commit "fix(runs): an empty harness catalog…"
- [ ] (arcterm) Brainstorm board keys: open a brainstorm board full size (one with 2+ boards), press `]`, `[`, → and ←
  → each steps the board tabs; the surface stays Agent and the selected agent stays put. Then press m (marking) and
  ← → → nothing moves; same on an agent's canvas while it says it is loading or its server is down.
  `bindings.ts` `onCanvas` / `boardStepReady` / `brainstormBoardOpen`, "fix(agent): [ ] and ← → stay the canvas's…".
- [ ] (arcterm) Brainstorm judging facts: while the judge weighs approaches, click a row's facts button and Show all
  facts → the facts fold open and shut (height + fade, not a snap), and every row's description keeps one width
  whether its button reads "N facts", "Hide facts" or the row has no facts. `brainstormui.tsx` `ApproachRow`,
  "fix(brainstorm): judging facts fold open…".
- [ ] (arcterm) Brainstorm thumbnail click: in a brainstorm question with mockups, click a board's thumbnail (not the
  link) → the board opens full size, same as Open full size; the thumbnail's border brightens on hover.
  `brainstormui.tsx` `Thumbnails`, uncommitted.
- [ ] (arcterm) Council Retry with…: in a council whose coordinator failed, Retry with… → Retry on sonnet reruns the
  summary on sonnet (the strip still reads Coordinator opus), and the saved document's run facts gain `- Retried:
  Coordinator in round 3 on sonnet (its seat is opus)`. Do the same on a failed expert from the Discussion's failure
  card and the chat's seat chip. CDP `council-summary` clicks the summary banner's menu with the RPC stubbed; no real
  call on another model and neither Discussion site was tried. The commit that adds this line.
- [ ] (arcterm) Council Retry all: needs a wavesrv + wsh build (the RPC gained `all`/`models`). In a council where
  two or more seats failed (the HarnessX brainstorm had New user, Designer and Builder), the seat strip shows a model
  pick ("Own model ▾") beside each failed seat instead of Retry / Retry with…, and one "Retry all 3" at its end; pick
  sonnet for one seat, Retry all → every failed seat reruns at once (no "council … is running" error), the picked one
  on sonnet, and while it runs every Retry button is disabled. A council with one failed seat keeps Retry / Retry
  with…. Also `wsh council start --model sonnet --model skeptic=opus` → `wsh council show` names those models, and
  `wsh council estimate` with the same flags quotes them. Runner and CLI parser unit-tested; untried in the app. The
  commit that adds this line.
- [ ] (arcterm) Council Retry with… after a safeguard flag: on a call that failed with "API Error: Opus 5.5's
  safeguards flagged this session", the menu's header reads "Safeguards flagged <seat> on opus" and its first item is
  Retry on Opus 4.8; picking it reruns the call on `claude-opus-4-8` and the call goes through. Untried in the app;
  unit-tested in `councilretry.test.ts`. The commit that adds this line.
- [ ] (arcterm) Council safeguard fallback + `wsh council retry`: in the installed build, `wsh council retry
  b421b5d4e7674e67` reruns that council's failed summary (Mentor); if Opus 5.5 flags it again, the seat's activity reads
  "Flagged by safeguards: answering on Opus 4.8" and the summary lands, with `- Retried: Mentor in round 3 on
  claude-opus-4-8 (its seat is opus; Claude's safeguards flagged it)` in the document. Unit-tested
  (`TestSafeguardFlagRunsTheCallAgainOnOpus48`, `TestCouncilRetryTarget`); no real flagged call tried. 13f4c1c6b.
- [ ] (arcterm) Summary failed panel closes: open a council whose summary failed. The panel's header ends with an ✕;
  clicking it hides the panel while the strip's Coordinator chip keeps its Retry. Retry, and when it fails again the
  panel is back. The commit that adds this line.
- [ ] (arcterm) History right-click menu and model: open a project's Overview. Each session row's second line reads
  `branch · Claude Code · Opus 4.8 · 2.2M tokens` (the model shown when known). Right-click a session: Open transcript,
  Resume, Copy title, Copy transcript path, then Delete session (Claude only) with a confirm, after which the row
  leaves the list. Right-click a run or council row: Open run / Open council and Copy title. The commit that adds this
  line.
- [ ] (arcterm) Council header on one line and gliding jumps: open a council with a long question. The header is one
  row (mode chip, the question cut with "…", the status chip, then the cost, Summarize and Stop on the right). In a
  long discussion, Top, Latest and Back glide there in under half a second; a wheel turn mid-glide stops it where it
  is, and Top then Latest at once still leaves Back pointing at where you were reading. The commit that adds this line.
- [ ] (arcterm) Council answers one at a time: in a finished council, send a message For everyone that only steers
  (e.g. "that's a given, not the point"). The first seat on the panel answers first; the others answer after it and
  add only what is new, and one with nothing to add shows as a green "<seat> agrees" chip under that first answer,
  not as an empty bubble. While the first answer waits as a draft (a council with an agent), the chip sits under your
  message. Unit tests cover the order, the prompt, the parse and the chip's place only (58f8fb245).
- [ ] (arcterm) Council messages as Markdown: start a new council (Brainstorm) whose question compares two or more
  options. In the Discussion, an idea or reply with a table draws a table inside the bubble: it wraps its cells instead
  of scrolling sideways, and its copy button shows on hover. A ```mermaid block draws a flowchart that fits the
  bubble's width, a numbered list draws as a list, and a ==…== sentence is still tinted. The same in a thread, the
  draft card and the report's positions; a matrix cell shows only the words. Unit tests cover the prompt rule, the
  parse and the matrix text only (2594e0e82).
- [ ] (arcterm) Council Ask next and Let them read files: start a new council, or Summarize a finished one again. The
  report ends with Ask next, two or three questions each with whom it is for; a click opens the Discussion with it in
  the box, `@` the expert first. The same questions sit as chips over the Discussion's empty box and leave once asked.
  Type a question naming a file (`rail-apps.json`): Let them read files turns on and says `it names rail-apps.json`;
  one naming none leaves it off, and the cost line reads about a fifth. In a new council's round 2, no reply calls a
  seat by its role ("Phương pháp ơi"). Unit tests and two CDP steps (discussion `done`, summary Ask next) cover it;
  both passed in the Tauri dev app on 2026-11-03. Left: a real council (the report's questions, round 2's wording).
- [ ] (arcterm) Council link → WebFetch: in a done council's Discussion type a message with `https://…`: Let them read
  files turns on, locks, and says `it names <host>`. Send it: the answering seats' timelines show a WebFetch step and
  their answers say which page they read, not "I can't open it". The next message with no link answers with no
  WebFetch. A new council whose question holds a link: round 1 opens it. Unit tests (Go and vitest) cover the lock, the
  tool list and the prompt line; not tried in the app.
- [ ] (arcterm) Council as a group chat: in a council past round 2 (or a new one), the round 1 ideas alternate between
  the experts, with no bold title in the bubbles; round 2 shows every reply in the chat, a `↳ <idea>` quote over the
  first of each idea's replies, those replies together and in the ideas' order. While a round runs, its messages stay
  in the order they came and jump into turns only when it ends: check the view keeps your place then. A new council
  should show a table or a numbered list in some ideas (a probe drew 3 of 7). Covered by unit tests only.
- [ ] (arcterm) Pinned app storage on a Mac, in the packaged app: in a pinned app that saves settings in the page (the
  portfolio dashboard's dark mode), change one, quit arcterm (⌘Q) and open it again: the setting is still there.
  `waveapp.log` has `pinned apps keep their storage (storage blocking policy 0, tracking prevention off)`, and the
  app's origin has a `LocalStorage/localstorage.sqlite3` under `~/Library/WebKit/dev.arc.app/WebsiteData/Default/`.
  Run in the dev app only (a probe app's key kept across a restart); no unit test can make a real WKWebView, which
  needs the main thread (`src-tauri/src/framestorage.rs`).
- [ ] (arcterm) Canvas toolbar at zoom: open a canvas with more than 4 boards (the picker shows `2/8 ▾`), then press
  Cmd + three or four times: nothing in the bar under the agent header draws over anything else. "updated … ago · N%"
  shortens and goes first, then the topic and the board tabs shorten with `…` (the selected tab last), and ‹, `2/8 ▾`,
  ›, Mark, Open in browser and Build this… keep their size. Also with ≤4 boards (plain tabs, no picker). Checked only
  as a static copy of the bar in headless Chrome at 560–1000 px, not in the app. (c39e68038)
- [ ] (arcterm) Canvas board as tall as its page: open an agent's canvas whose board page is longer than its `h` in
  `canvas.json` (one that showed a thin scrollbar inside the board, beside the pane's): the board now runs the page's
  whole length with only the pane's scrollbar, in the Canvas tab, the gallery's viewer and a brainstorm's widened
  board. Edit the page shorter: after the reload the board shrinks back, never below `h`. Under All a tall board's
  tile is still cut off. Covered by `canvasserve` and `canvasmodel` unit tests only; not tried in the app.
- [ ] (arcterm) Copy table: point at a table in a `.md` Preview (Code surface and the Agent File tab) and in an agent's
  reply: a copy icon shows on the table's top-right corner, not the column's; click it (✓), then paste into Google
  Sheets or Numbers: real cells with the header row, right-aligned columns kept; paste into Notes or a terminal:
  tab-separated rows, no `|`. A wide table scrolls under the icon, which stays put. On the Mac's WKWebView the HTML
  write may be refused: then the paste is the text alone, still split into cells by a spreadsheet. Not run in any
  app. (d97c67098)
- [ ] (arcterm) Finder drop on the Files tree: in the Agent panel's Files tab, drag a file from Finder over a folder
  row: that row rings and the strip under the tree reads "Drop to copy into <folder>/"; over a file row its folder is
  the target, over empty space "the project root". Drop: the file is copied (still in Finder), the tree reloads with
  the folder open and the copy selected. Drop it again: `name (1).ext`. Drop a folder with subfolders and a file over
  4 MB: the whole tree arrives, byte-identical (`cmp`), and the strip shows "Copying … · N%" meanwhile. Dragging a
  tree row onto a terminal still types its path. Not run in any app; on WKWebView the folder walk
  (`webkitGetAsEntry`) is unproven. (52f334394)
- [ ] (arcterm) New dialog, Task on top, the parts no scenario types: with Telex on, type a word in the Task box and
  press Enter → the word commits and nothing launches; on a Mac, Option+2 picks another Start row without leaving the
  box. The `launcher`, `launcher-resume` and `launcher-images` scenarios pass on main (2026-11-02). (commit
  "feat(launcher): the New dialog opens in its Task box, now at the top")
- [ ] (arcterm) New dialog `@` files: with a project picked, type `@` in the Task box: a dropdown of the project's files
  floats under the box, over the columns, which do not move ("Listing files…" first on a cold repo); typing after the
  `@` narrows it, ↑↓ move, Enter or Tab puts `@<path> ` in the task without launching, a click does the same, Esc
  closes only the dropdown (a second Esc closes the dialog); `me@x.com` opens nothing; Home picked shows none. Not run
  in any app. (52d5f4a5d, commit "fix(agents): the @ file list floats as a dropdown")
- [ ] (arcterm) Agent badge: run a brainstorm until its Judge (or Builder check) answers, while looking at another
  agent: the Agent nav badge does not go up for the Judge, and every number it shows matches a count on a tree row.
  (commit "fix(agents): a brainstorm's judge and builder check do not count as unread")
- [ ] (arcterm) Kael sync: motion pass, the parts `dag-motion` does not cover (it passes on main 2026-11-02: card
  settle, timeline rows fading in, a filter not cascading them): a code block's Copy cross-fades to Copied, the Jarvis
  peek's reply shows a flow bar while it streams and an × once done, and the brainstorm pane fades on a view swap.
- [ ] (arcterm) Kael sync: the next orchestrator run's plan review shows two round-1 reviewers (Full review, Second
  pass) in its DAG and timeline, and a Claude task worker that skips a test gets a goalpost finding its reviewer
  passes or fails by name (`task-goalpost` in the run's events). Needs wavesrv/wsh rebuilt (next dev start or install).
- [ ] (arcterm) A council with a live agent seated: pick an idle claude agent and a pi agent in the Agent tree
  (Ctrl+click), choose Discuss together, set Rounds to 2 and start. Setup's estimate should show the agents' share. In
  the council chat, each agent's ideas come back as amber drafts with Send to the others / Edit / Drop. The chip reads
  "Round 1 of 2 · N drafts wait for you", and settling the last draft starts round 2. The prompt appears in the agent's
  own transcript as a council message. A busy agent's seat waits ("Waiting for <agent> to finish its task"), and one
  with no answer after 20 min becomes a skipped line with Open its terminal. Only fake links and stubbed RPCs have
  been through it. (commits "feat(council): AgentCaller and the live AgentLink" and "feat(council): the chat view
  replaces the feed and the Reddit thread")
- [ ] (arcterm) The council chat's keys on a real keyboard, Telex on and off: in a council chat, j/k move over the
  ideas only while focus is in the channel or the thread, and `docs/keyboard-shortcuts.md` lists what the chat binds.
  (commit "feat(council): the chat view replaces the feed and the Reddit thread")
- [ ] (arcterm) Discuss together picks a range: in the Agent tree, Ctrl+click one agent, then Shift+click an agent two
  rows below. All three rows (the one between included) read selected and Discuss together seats all three; on a Mac
  the same with Cmd+click. The CDP scenario ranged over two adjacent rows on Windows only. (run f46b61f9, task 10)

- [ ] (arcterm) Replay at the drawn size: start an engine run and open its lead only after it has drawn a
  question or a few turns (the pane never shown before). The terminal should read cleanly, its text in the left
  80 columns, with no second frame of another width over it. `frontend/app/view/term/termwrap.ts`
  (`writeAtSize`).
- [ ] (arcterm) Option boards: in a fresh plain Claude session (after a launch re-seeds the skills), ask a UI question
  with two layouts. You should see it draw `A-…` and `B-…` boards, reveal the canvas beside its terminal and ask by
  label; after you pick, the other board sits in `.superpowers/design/<topic>/unchosen/`. Ask for a one-line status
  mockup: it should ask "draw a board, or keep it as text?" first. `skills/design`, `skills/brainstorm`, c6a622510.
- [ ] (arcterm) The Transcript tab reads a real compacted session back: wake a sleeping Claude agent whose transcript is
  55 MB or more (it was compacted before it slept), open the agent's panel on Transcript (Ctrl+Shift+F in its terminal),
  then press Compactions until it says No earlier compactions. You should see the conversation from its first prompt,
  each compaction marker with its summary, and the page you were reading stay put while earlier parts load. Note the
  renderer's RAM then (the compact RAM popup's Interface layer) in the RAM watch row for the Transcript tab. Only the
  generated fixture (`task verify:ui -- rail-transcript-tab`) has been through it. (commit "feat(agents): the Transcript
  tab reads the whole conversation back, with its scenario and docs")
- [ ] (arcterm) The agent panel's strip still fits at Overview's 300px: on an agent that has a worktree, a transcript,
  an open file and counts (subagents, files changed, uploads), stay on Overview and look at the strip. Overview, Files,
  Changes and Transcript show their icons, the open file folds into one tab (its icon, a count when several are open),
  and the counts keep their icons after the short rule, with nothing clipped, overlapping or scrolling. Narrow the window
  until the nav rail collapses and look again. Four icons were added to a strip that held three; only the CDP scenario
  `agent-rail-tabs` (steps 1, 5, 7, tab names and widths, not the pixels) has been through it. (commit "feat(agents): a
  Transcript tab on the agent rail strip, its width and Mod+Shift+F")
- [ ] (arcterm) The compact reader's draw-earlier step shows in the other places that use it: run
  `task verify:ui -- agy-harness` once memory allows (it opens a past session in `CompactTranscript` and its folds), then
  open Conversation History on a past session of more than 200 items and a sleeping agent with a long conversation, and
  scroll each to the top. More items draw each time the top is reached, and the item you were reading stays where it was.
  Its rendered check so far is the Transcript tab's scenario (`rail-transcript-tab`, steps 2, 3, 4 and 6); nothing has run
  `agy-harness` or the sleeping overlay on it. (commit "feat(agents): the compact reader draws earlier items on reaching
  the top, and scrolls to an entry")
- [ ] (arcterm) Quick translate, the parts no scenario reaches: the language select's popup in dark mode, and
  Cmd+Shift+D on a Mac. `rail-translate`, `float-note`, `agent-rail-tabs` and `surface-smoke` pass on main
  (2026-11-02). (commit "feat(translate): the Translate panel on the rail, and Ctrl+Shift+D")
- [ ] (arcterm) Translate's history and listen buttons: translate a few words, pausing on each, then empty the box. The
  list shows them newest first (a half-typed word you kept typing past is not there); a row puts its text back and
  translates it, ☆ fills and Starred lists it, × removes a row, and the list is still there after a restart. The
  speaker in the box reads the English word and the one beside copy reads the Vietnamese (on a Mac, the Linh voice;
  with none installed the button is off and its tooltip says so), and closing the panel stops it. Untried in WKWebView,
  which no CDP scenario reaches. (commit "feat(translate): a history with stars, and listen buttons")
- [ ] (arcterm) Translate's Apple Translation fallback, on a Mac with macOS 26+ after a build: `ls
  /Applications/arcterm.app/Contents/Resources/bin/apple-translate.arm64` is there. With the Wi-Fi off, type
  "Contrarian" (English → Vietnamese): a translation comes back after a second or two, with no phonetic or word class;
  with Detect language as the source, it names English. English → a language whose pack is not downloaded shows the error naming the pack and
  System Settings → Translation Languages, and no macOS download sheet opens over arcterm. Not seen in the app: Google's
  429 path and the helper were only run from Go tests and the shell. (commit "feat(translate): fall back to Apple
  Translation on the device when Google cannot answer")
- [ ] (arcterm) Translate's MyMemory fallback, on Windows after a build: while Google answers 429 (the error used to read
  "Google turned away too many requests…"), type "drift" (English → Vietnamese) → "trôi" comes back with no phonetic or
  word class, and Detect language names English for "good morning". Run live only from a Go test through the Engine
  with Google faked to 429, never in the app. (commit "fix(translate): fall back to MyMemory when Google cannot answer")
- [ ] (arcterm) A council's chat as a messenger, after a build: in a done council's thread, send a follow-up. The thread
  scrolls to it; your bubble has no name line, its time shows on hover beside it; under it Sent turns to Seen with the
  seat's small avatar about a second later, then the seat's bubble of three dots rising in turn shows (still with
  Reduce motion on: the dots rest). When the answer lands, Seen goes and two or three suggestion chips show over the
  box; a click puts one in the box, typing hides them. A seat's plain reply has no `replies` pill, a doubt keeps `has
  doubts`. The send button is round with a send icon. No CDP scenario covers these yet, and the dev app was not run.
  (commit "feat(council): the chat as a messenger: Sent then Seen, typing dots, fewer labels, suggested replies")
- [ ] (arcterm) The File tab's Back to the top button: open a long `.md` file in an agent's File tab (Preview), scroll
  down and press the arrow-to-line button in the header; the document glides back to its top. Do the same with a long
  `.html` file (needs a wavesrv built after this change). Source and Diff show no such button.
- [ ] (arcterm) A wake message survives switching agents: open a sleeping agent, type a line in the box under its
  conversation, press Enter, then pick another agent and come back before it is awake. The box still shows the line
  (read-only, Waking…), the agent receives it, and the box is empty once it is awake.
- [ ] (arcterm) Jarvis Runs rows no longer shade with an initiative open: with an agent row under Runs, click an
  initiative so its panel opens on the right. No agent row under Runs is shaded; clicking an orchestrator run still
  shades that one row. (commit "fix: council refusals say why; a sleeping brainstorm stays; clean compaction summary")
- [ ] (arcterm) Start run hands the run to a Starting row: New → Orchestrate → write a goal → Start run. The dialog
  closes at once, the Agent surface shows a spinning **Starting · <1m** row in the project's folder, and it goes when
  the lead's row appears. Start another and click its × while it starts: it reads Cancelling…, then goes, and the run
  shows cancelled (no lead left running). A start that fails (e.g. a route not installed) stays **Failed · …** with
  Try again and Dismiss on hover. Not tried live: the dev app was not running. (commit "feat(launcher): a run starts
  behind a Starting row")
- [ ] (arcterm) Vietnamese draws whole in Hack: with Settings → Appearance mono font (and the terminal font) set to
  Hack, a brainstorm part's `from` column and a terminal line holding "ảnh Google Dịch ở" show no gap after ả, ị or
  ở. Checked in headless Edge with the bundled font files, not yet in the app. (commit "fix(fonts): Vietnamese letters
  draw whole in Hack and Fira Code")
- [ ] (arcterm) A brainstorm question says whether you pick one or more: in a brainstorm, a question whose answers
  exclude each other reads "Pick one" over them and has no tick boxes; one marked `multi` (the agent's, or the judge's
  `multi` in judge.json) reads "Pick one or more", each row has a tick box, ticking B and D shows "Send B + D" and
  Clear, and Send hands the agent "<B label> + <D label>", which it records with `picked: [1, 3]` (the Decided rail
  ticks both). Clicking a row still sends it alone. In the judge's wait, every approach row has its letter (E, F …),
  with tick boxes when the question is `multi`. Not tried in the dev app; no CDP step drives the tick boxes yet.
  (commit "feat(brainstorm): a question says whether you pick one or more, and sends ticked answers together")
- [ ] (arcterm) Closing a brainstorming agent closes its judge: start a judge on a brainstorm question (or a builder
  check), then close the agent while it reads (Ctrl+Shift+W). Its "Judge · …" / "Builder check · …" row leaves the
  Agent tree with it and its claude process ends, instead of staying as a plain row that keeps reading. (uncommitted)
- [ ] (arcterm) A second judge leaves no stray session: in a brainstorm, let a judge finish on one question, then
  start a judge on the next. The first "Judge · <title>" tab closes as the second starts, so the Agent tree shows one
  Judge row under the agent and no "Judge · …" row of its own in the project folder; the same for a second builder
  check. Rows left over from before this fix stay until closed by hand. (commit "fix(brainstorm): a new judge or
  builder check closes the one before it")
- [ ] (arcterm) A sleeping brainstorm stays a brainstorm: put an agent in brainstorm mode to sleep (its row's menu →
  Sleep). The pane keeps the design with the "Sleeping since … · Wake" card above it, not "exited with code 1 ·
  Resume in a new agent"; Wake brings the same conversation back, and answering a question while it sleeps wakes it
  and delivers the answer. (commit "fix: council refusals say why; a sleeping brainstorm stays; clean compaction summary")
- [ ] (arcterm) A compaction summary reads clean: open a compacted Claude agent on the Agent surface and expand the
  Compacted divider. The card opens on "1. Primary Request and Intent" as a formatted list, with no
  `<system-reminder>` text and no "Continue the conversation…" lines at the end (`transcriptprojection.ts`
  `compactSummaryText`). (commit "fix: council refusals say why; a sleeping brainstorm stays; clean compaction summary")
- [ ] (arcterm) A council review holds five directions: start a Review council (or wait for the next one) and open
  its report. At most five direction cards, each with a "First step:" line, none of them resting only on a Guess or a
  Disproved claim, then a folded "Also raised" heading with its count; clicking it opens one row each for the rest
  (`from <expert>` under the title, no stances). Its saved doc has `## Also raised` between the directions and the
  Matrix, and those proposals' Outcome reads Also raised. `councilsummary.tsx` `KeptSection`, `pkg/council/fill.go`.
- [ ] (arcterm) A Review council reviews early: start a Review council of three or more seats on a project with files
  listed. While it runs, a seat that has finished round 1 starts reviewing (its avatar's activity says so, and the view
  switches to the cross-review round) before the slowest seat has posted; each seat's round-2 prompt holds the ideas
  routed to it in full and the rest as one line each. Then run `wsh council bench --variant council --runs 1` (about
  25M tokens) and compare wall time and top-5 hits with the last bench. `pkg/council/runner.go` `earlyRounds`.
- [ ] (arcterm) A council's row copies its id: right-click a running council in the Agent tree. The menu holds Copy id
  with the 16-character id beside it, and pasting gives that id (`wsh council show <id>` takes it). A queued or ended
  council's menu holds Copy id, a separator, then Remove. `agenttree.tsx` `CouncilRow`, 6eb54c303.
- [ ] (arcterm) Waking holds the controls: click Wake on a sleeping agent's card. Until it is back the card reads
  Waking…, the composer's Send reads Waking… and is off, the header's … and × are dimmed and do nothing (right-click on
  the header opens no menu), and the agent's row menu greys Wake and Close agent. `wakingstore.ts`.
- [ ] (arcterm) Needs you rows unfold on the Cockpit strip (the Overview's are covered by `project-overview-history`
  step 13): click the text of a "Run to confirm" row. It shows ▾, the run's full title, then one `·` line per thing
  not verified, with no `wsh runs ack` hint; a second click folds it. A learned rule keeps its Why toggle.
  `needsyoustrip.tsx`.
- [ ] (arcterm) The Overview's Now and History on real data (run a6c8cb9e, 7442e2821; Final saw fixtures only): open
  arcterm's Overview while a run works. Running has one row per run reading `N at work · done/total tasks`, and its
  count equals the arcterm folder's green badge in the tree. History's Sessions lists the last 7 days' ended sessions
  of arcterm (not stuck on grey rows; Final's shots 1 and 13 show the list still loading after a reload), Councils &
  runs lists the councils and the runs with their land, and `/` focuses the search. The header shows the branch pill
  and change count (they were missing once on 2026-10-27 with no error logged; `useProjectGit` swallows a failure).
- [ ] (arcterm) Open a deck from the File panel: after installing a build with `open_path`, in the SIEM `website`
  agent's "It's in docs/slide/ as Early_Warning_Services_v1.4_271026_Sales.pptx" the bare file name is underlined on
  hover (its folder is read off the line above, `nearbyFolders`); Ctrl+click it: the panel reads "Binary file" with
  Open and Show in Explorer; Open starts PowerPoint on it, Show in Explorer
  selects it. A `.exe` path offers neither. `src-tauri/src/commands.rs` `open_path`, `filetab.tsx`, commit
- [ ] (arcterm) Pin a council, not close it: in the Agent tree hover a Done council row and click its Pin: it moves to
  the top of its project, and the Report's tab bar reads Pinned. Councils at the sidebar's top (`Ctrl+G` `o`) shows a pin
  mark on its row; hover the row there and click Unpin (or right-click → Unpin): the mark goes, and a council that
  ended over a day ago leaves the tree at once. Pin a Running one: it works. Press Retry on a pinned one (or
  `wsh council retry`): it stays pinned. `wsh council pin <id>` / `pin --off` do the same. Right-click → Remove
  council… asks, then its file is in `~/.arc/trash/<ms>-council-<id>/`. `pkg/council/runner.go` `SetPinned`,
  `councilhistoryview.tsx`, commit
- [ ] (arcterm) A slow wake clears its sleep marks: after installing a build with this fix, the `arcterm` tab whose
  block `027015dd` runs while its meta still holds `agent:sleeping` (a 2026-10-22 20:26 wake whose 10s write clock had
  run out) shows asleep; click Wake (or send from its composer): the row and terminal read awake, no restart, and
  `wsh getmeta -b 027015dd-4da4-4a42-ae96-bda746661586` has no `agent:sleeping`. Then let a run land while its origin
  sleeps: the origin wakes, gets the `[arc] Run …` message and reads awake. `wshserver_agentsleep.go`, commit
  "fix(agents): a slow wake clears its sleep marks". 2026-11-04: block `027015dd` is gone (`wsh getmeta` finds no
  such block), so the first half can no longer be tried on it; only the run-lands-while-its-origin-sleeps half is left.
- [ ] (arcterm) A shorter council: on the next council you start with a question in Vietnamese, the bold answer is one
  plain sentence in Vietnamese with no `path:line`, the summary under it at most three sentences in Vietnamese that
  do not retell the directions, the directions' titles in English, each proposal a few sentences, and a "Revised"
  reply one line on what changed rather than the whole argument. `pkg/council/prompts.go` (harness `2026-10-23.1`),
  commit "feat(council): a shorter answer, summary and thread".
- [ ] (arcterm) Hide on a service row: in the Agent tree, select a sleeping service (e.g. `portfolio`), right-click →
  Hide; the row leaves the tree and the selection moves to the row beside it. On a running one the item reads Stop
  and hide and does both; on a crashed one it is greyed with a tooltip. `servicemenu.tsx`, commit "feat(agents): Hide on a service row's menu".
- [ ] (arcterm) Council v2 Phase 0, the agent-team probe's live half (only the headless half ran in run 0ea46b22): open a
  claude agent from arcterm in the data dir's `council-bench/work/teamprobe/`, send it the team prompt with
  `wsh agents send <tab> "…"`. Each teammate's exchange should appear in `<session>/subagents/agent-<id>.jsonl` beside
  the lead's transcript; a second `wsh agents send` ("tell Bob to argue the opposite of Alice") should change Bob's
  next message; asking the lead to stop Bob while he is still working should end his turn, and a later `SendMessage`
  should resume him with his earlier messages. Findings: `docs/council-phase0.md` ("Probe").

- [ ] (arcterm) Copy id: right-click an agent in the Agent sidebar tree, and a segment of a split row: the menu shows
  Copy id with the 8-character id beside it (a # icon, no @), and pasting gives the bare id. Alt-drag onto a Claude
  pane still types `@id `. Commit "feat(agents): the row menu copies an agent's bare id".
- [ ] (arcterm) Council, a real run: New → Council on a project, a UI feature with a few files, the
  "Review a UI feature" group, Start council. The Discussion at Step 1 of 3 shows each expert's card with
  the line it is reading (`Grep "…" in pkg/…`) and the ideas appear as the experts finish; Summarize stays off until the
  first ideas are in, and Step 2 fills the threads as replies arrive; the chip's step, the clock, the reply count
  and the token count move on their own. The scenarios (`council-tree`, `-setup`, `-ask`, `-discussion`, `-summary`)
  only draw fixtures and replace every call that would reach a model, so none of this has run live; they also have
  not run before Final. Also try Pause after the first ideas (Setup's Options; untick an idea, ask a question,
  Continue), Stop council during Step 1, and Retry on an expert that failed. Spec
  `docs/superpowers/specs/2026-10-21-council-design.md`, `frontend/app/view/agents/councildiscussion.tsx`,
  `pkg/council/runner.go`.
- [ ] (arcterm) Council, the readable report: run a real council with a question on the installed app. The finished
  council should open on a one-sentence answer above its directions; an expert who agrees without a comment should
  show as a reaction under the idea, never as a reply row (reply counts leave it out); and the done toast should arrive
  while another surface is showing, with an unread dot on the council's row that clears when you open it. Spec
  `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` (Phases, Ahead of Phase 0b).
- [ ] (arcterm) Council from an agent: in a claude session, let it start a council (the `arc:council` skill).
  `wsh council start` shows the Token burn gate card with the estimate; allow it and the council runs, and
  `wsh council wait` prints the Summary and Matrix back into the session.
  Run it again and refuse the card: the agent reports `Not run: …` without retrying, the project has a `Not run`
  council row, and its Discussion's Start council (with the estimate) runs it. `cmd/wsh/cmd/wshcmd-council.go`,
  `skills/council/SKILL.md`, `pkg/tokengate`.
- [ ] (arcterm) Council started by the agent itself: in a claude session, weigh two options with the agent until
  neither wins. It should start a council without asking and say so in one line (mode, group, estimate; `Queued after …`
  when another council runs). Then say "ask a council about this": a council starts at once, and when it ends the agent
  sums the report up in the chat and carries on. A refused Token burn card must come back as `Not run: …`, never
  retried. `skills/council/SKILL.md`, `cmd/wsh/cmd/wshcmd-council.go`; spec
  `docs/superpowers/specs/2026-10-22-council-agent-team-design.md` ("Starting a council").
- [ ] (arcterm) Council room, the live parts: run a real Brainstorm council (a problem, not a thing to judge). Its
  ideas, builds and report should come back in the wild / builds / first-step shapes; the prompts were only tried
  against a fake caller. Start a second council while it runs: it shows as `Queued · after <feature>` in the Agent
  tree. Hover that row: a Remove button fades in. Right-click it: Remove from queue. Either one stops it and the row
  goes; CDP only clicked the button, and cannot open the native menu. When the first council ends, the queued one
  starts by itself. The finished council's report reads `Saved to docs/council/….md with the whole discussion`, and
  that file exists. `pkg/council/prompts.go`, `runner.go`, `frontend/app/view/agents/agenttree.tsx`; spec
  `docs/superpowers/specs/2026-10-22-council-agent-team-design.md`.
- [ ] (arcterm) Council Setup, the parts a person has to try: "+ Add a file or folder" opens the OS pickers and the
  chosen paths show as file chips; a screenshot pasted into Setup shows its thumbnail and reaches round 1 (the experts
  open it with Read); Save as group names the current panel and the group is in the group menu the next time Setup
  opens (the note names what a group cannot keep: a suggested role and a per-row model); the coordinator's role
  suggestion, with a feature and a first file, comes back as dashed rows you can add or ignore, and Run again from a
  Summary does not call it. `frontend/app/view/agents/councilsetup.tsx`.
- [ ] (arcterm) Council Summary, the actions the scenario replaces: on a done council, Start an agent on it opens a claude
  agent in the project seeded with the direction and its thread (the scenario stubs the launch, so only the prompt was
  checked); Save as doc (in the ⋯ menu) writes `docs/council/YYYY-MM-DD-<feature>.md` and shows the path; Create initiative makes one
  chunk per direction; Ask the experts again opens that direction's thread; a reply after the summary marks the
  Summary `Outdated · N replies since` and Summarize again clears it. `frontend/app/view/agents/councilsummary.tsx`.
- [ ] (arcterm) Council bench, council against a Claude Code agent team: on the installed app run `wsh council bench`
  (no flags: the two `team-bench-2026-11` cases, council and team, twice each; the four 0b cases are retired) and
  allow the Token burn card. The plan line reads `8 runs (4 council, 4 team) over 2 cases` and the runs go one at a
  time, with no row, toast or dot in the app. A team cell runs `claude -p` on a temp copy of the case and leaves no
  folder behind; one that read the key or worked alone is a failed row. The estimate (~53.2M) is above the 50M cap,
  so the last cell may be cut. `wsh council bench results` then shows the rows and `verdict: go | no-go | not
  decided: <reason>`. `pkg/council/bench`, `cmd/wsh/cmd/wshcmd-council.go`; spec
  `docs/superpowers/specs/2026-11-03-council-bench-team-design.md`.
- [ ] (arcterm) Council "Was this useful?": on a real finished council's report, click Useful: the row turns into a
  thanks line with Change. Click Change and answer Not really. `wsh council bench results` then counts that council
  once, as not really, in the ratings table under its harness version and mode (the file keeps both answers; only the
  latest counts). The `council-summary` scenario stubs `CouncilRateCommand`, so nothing was rated on a live council,
  and the row was never drawn in a running app either: run ab534f5b's Final dev app did not start. Look at the row
  beside the report's other quiet rows too.
  `frontend/app/view/agents/councilsummary.tsx`, `pkg/council/bench`.
- [ ] (arcterm) Rail commit mode with a real agent and with amend: let a live Claude agent edit two files in a worktree;
  when its turn ends, the rail's Changes tab shows the Uncommitted row without a switch. Open Commit…, untick one file,
  commit: the box closes, the commit tops the Commits list, the unticked file stays uncommitted. Then turn Amend on in
  the Diff surface's Commit tab and come back: the rail's button reads "Amend with N files" and amends. The run's CDP
  scenarios (`rail-changes-commits`, `rail-commit-mode`, 31/31 in the Final of run fb9eca52) drove a staged agent, not
  hooks, and never amended. `frontend/app/view/agents/railcommitbox.tsx`.
- [ ] (arcterm) Servers file log and Restart in arcterm: open the footer's Servers popover with a "no owner" server
  whose output goes to a file (an `astro dev` writing `.astro\dev.log`, or a task from an ended Claude session). Its
  Log icon is lit, its tooltip names the file, and a click follows the file live in the focused agent's side panel.
  Hover the row: Restart (↻) asks "Restart here?", and a second click stops the server and opens a terminal in its
  folder, under its project, running the folder's script (`pnpm run dev`), with the port back up. Never run in the
  app; the stdout lookup was checked against three live processes and by `pkg/devservers` tests.
  `frontend/app/view/agents/machineserverspanel.tsx`, `pkg/devservers/stdout_windows.go`.
- [ ] (arcterm) Failed object loads retry: after the next install, restart arcterm with several agents running; every
  agent the restart brings back shows in the Agent tree, and resuming one from Conversation History lands on its
  terminal rather than toasting "already open" over nothing. The failure itself (a GetObject that fails at boot) was
  never reproduced, only read from the 2026-10-21 log and store. `frontend/app/store/wos.ts` `loadInto`.

- [ ] (arcterm) Split row cells: put an agent with an unread turn, a sleeping agent and a terminal running a command
  into splits; each cell shows the unread count, the moon glyph and the working dot as its row did; right-click a
  worker's cell inside a run and a lead's cell: each opens its own row's menu. The asking dot, Alt's digits and Rename
  are checked by the `tools-split` scenario. `agenttree.tsx` `SplitCell`.
- [ ] (arcterm) Skim 0.2.3: after the next install, ask Claude for a long reply with a numbered list whose items open
  on bold. Under skim the bold words stay bright while the rest of each item dims, and the reply marks 2-4 sentences
  (what changed, a caveat, a decision left to you), not only the caveat. `claude/skim-mod` `layout` `isLead`,
  a51a646de and 73e554929.
- [ ] (arcterm) Rail Changes tab: in Agent, open the panel on an agent that changed files; a third tab (the diff
  icon) after Overview and Files lists every changed file at Overview's width, with no resize grip, and a click opens
  that file's Diff on the File tab, which still resizes. `agentdetailsrail.tsx` `filesContent`.
- [ ] (arcterm) Files tab shows at once: after a restart (wavesrv rebuilt), open the panel's Files tab on a project
  listed before; the tree shows at once with no skeleton, and the Files tab is as wide as Overview with no resize grip.
  On a folder never opened, the top level shows within a moment and a folder opens one level at a time until git's
  listing lands. Kept listings live in `<data>/listcache/`; a listing over 2s logs `gitinfo: listing … took` in
  `waveapp.log`. `railtreestore.ts` `showEarly`, `gitinfo/listcache.go`.
- [ ] (arcterm) Split glyphs: in Agent, open a terminal running `claude` or `codex` in a split beside an agent, then
  click back and forth between the two panes a few times. Neither pane's text should turn into wrong characters
  (before, the pane not clicked garbled). `termwrap.ts` `rebuildGlyphAtlas`.
- [ ] (arcterm) Split per project: split two agents of project A, then choose an agent of project B in the sidebar.
  B shows alone (or B's own split), with nothing of A beside it; choose an agent of A again and A's split is back as
  it was. A row of B has Open in split greyed out while A is shown, and the header's Split menu lists only A's agents and
  terminals. `agentgrid.ts` `reconcileProjectGrids`, `gridstore.ts`.
- [ ] (arcterm) Mouse Back/Forward in an app's page (Windows): open a pinned app, follow a link or two in it, then
  press the mouse's Back and Forward buttons over the page and over the cockpit; nothing moves, no app shows an error
  page, and the header's Back still goes back a page.
- [ ] (arcterm) Shortcuts from inside an app's page (Windows, after a restart of `task dev` or the next install: the
  host changed): click into a pinned app's page, then Ctrl+K opens the palette, Ctrl+Tab switches as from anywhere and
  closes when Ctrl is let go, and Ctrl+1..9 change surface. Ctrl+C, Ctrl+V, Ctrl+A and Ctrl+Z still copy, paste,
  select and undo in the page, and arcterm does nothing with them. `pagekeys.rs` `CHORD_KEY_EVENT`, `appstore.ts`
  `setupPageChordKeys`.
- [ ] (arcterm) Account switch resumes mid-turn: with an agent working (or stopped at its usage limit), switch the
  Claude account in Settings, check it in "Resume agents on …?" and Resume selected; it comes back and carries on by
  itself with the "Claude account was switched" turn. An idle agent comes back at its prompt with no new turn.
- [ ] (arcterm) Docker Desktop outlives its agent: with Docker Desktop quit, have an agent start it (`docker desktop
  start`), then resume that agent on another account (or close its tab); Docker Desktop stays up and `docker ps`
  answers. Then, 10 s on, quit arcterm (tray → Quit) and, once more, let `task install` close it: Docker Desktop
  stays up both times, no stray claude.exe is left under it (`Get-Process claude`), and waveapp.log says "host job
  holds a kept app: true".
- [ ] (arcterm) App links open in the browser: after `task dev` (the host is rebuilt), in a pinned app's page click a
  link with `target="_blank"` and it opens in the default browser; navigate to another page of the app and press the
  header's ↗, and the browser opens that page, not the start page. The cockpit window still opens maximized and
  borderless, now that main.rs builds it in setup (`"create": false`).
- [ ] (arcterm) Starting app counts up: stop `portfolio`, open it again (after `task dev` or the next install), and
  the "Waiting for 127.0.0.1:8386 · N s" card counts 1 s, 2 s… until the page shows, instead of staying at 0 s.
  `startedMs` set at start in `pkg/services/supervisor.go`. Commit c34d80918.
- [ ] (arcterm) Lead asks are short: start a new orchestrator run (after `task dev` or the next install) and, when
  its lead asks you something, each question holds one decision in at most two lines, several decisions come as
  separate questions in one ask, and the options do not repeat the body. `AskShapeRule` in
  `pkg/jarvis/leadprompt.go`. Commit faac27eda.
- [ ] (arcterm) Service listed once: with the `portfolio` service running and its dashboard writing a report
  (`claude -p`), the Agent tree's portfolio-journal folder shows only the `portfolio :8386` service row, no
  `✳ portfolio` agent row above it. `rosterStatus` in `agentsleep.ts`, read by `liveagents.ts` and
  `sessionsidebarmodel.ts`. Commit 30f0cc485.
- [ ] (arcterm) `wsh detach`: after installing a build with it, run `wsh detach npm run dev` in a project terminal
  (or have an agent start its dev server): it prints a pid, a log and a stop command, and no console window opens.
  Quit and reopen arcterm: the server still answers. Then stop it with the printed `taskkill`. `wshcmd-detach.go`,
  `jobobject.StartDetached`, `BREAKAWAY_OK` in `src-tauri/src/main.rs` and `jobobject.Attach`.
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
  open a pinned app, click through two of its pages, then header ← steps back one page and → forward again. They run
  `navigation.back()` in the app's frame (`pagekeys.rs` `app_frame_action`) instead of the window's `history.back()`,
  which stepped whichever frame moved last. A second pinned app that changed page after the first's earlier page still
  goes back with it: the frames share the window's one history (seen in headless Edge, 2026-10-21).
- [ ] (arcterm) Found on this machine: after rebuilding wavesrv (`task build:backend:quickdev:windows`, then restart
  the dev app) or the next install, open Setup → Tools: **mole** sits under System reading installed (`mo` from
  `%LOCALAPPDATA%\Programs\mole-cli`), and any of the detected TUIs on PATH (htop, ncdu, tig, btm…) list first under
  Found on this machine, with "· N found" in the header. Add moves one into its category and into Open a tool; its
  detail's "Remove from the library" sends it back; the cross hides it for good. `task verify:ui -- tools-found`
  covers the list, detail and Hide with a fixture; Add and the real detection are unverified.
- [ ] (arcterm) Fresh PATH for new terminals (Windows): after the next install, with arcterm open, install a CLI
  that adds its folder to the user's PATH (mole's installer, or any `winget install` from Setup → Tools), then open a
  new terminal: the command runs there without restarting arcterm, and the tool's row in Setup → Tools reads
  installed. `pkg/util/envutil/refreshpath.go`.
- [ ] (arcterm) Image diff: after rebuilding wavesrv (`task build:backend:quickdev:windows`, then restart the dev app)
  or the next install, open Diff → Review on a repo with a changed PNG or JPG: in place of "Binary file — no text to
  show" its section shows Before | After side by side over a checkerboard, each captioned `W×H · size` (the After
  size in the accent when the pixel size changed); an added image reads "Added" on the left, a deleted one "Deleted"
  on the right. Before reads "Couldn't read" on an old wavesrv. (a39a50869)
- [ ] (arcterm) Kael sync: on the Brief, Runs and Initiatives show their filter as a line of chips with counts under
  the head; with more than six projects the Initiatives filter is one "project" menu in the head; right-click a row
  and the arrows move the menu's highlight, Escape closes it without leaving the Brief. (6a225bc59)
- [ ] (arcterm) Kael sync: after an agent launch, a new Claude session lists the skills as arc:runs, arc:cockpit,
  arc:design, arc:initiatives, arc:notes, arc:doc-review, arc:learn (none twice), ~/.claude/skills no longer
  holds cockpit-runs and the rest, and Setup → Skills shows them in sync; a rule approved through `wsh learn` for
  cockpit-runs now shows under runs. (1cd40ef02) 2026-11-04: the session half holds (each arc: skill listed once,
  none of the old names in `~/.claude/skills`); a stale `~/.claude/skills/effort-tracking` copy (2026-10-02, the
  initiatives skill's old name) went to `~/.arc/trash` on 2026-11-05. Left: Setup → Skills and the learned-rule half.
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
  Name, Command and Page. Add it: it is a held service that sleeps until opened, so it has no row in the Agent tree,
  and its page in Setup → Tools shows Status `sleeping · starts when opened`, Keep running and On the rail. Open it
  (Open, or its rail icon once On the rail is on): it starts, and the dashboard shows in the centre under Page | Log,
  the header reading `Running on 127.0.0.1:8386 · up …`, its row now in the tree with `:8386` and a green dot, and the
  footer's Servers listing it as `app · <name>`, a click opening it; Log shows the npm output. Stop (the row's menu,
  Setup → Tools, or the footer's Servers) frees 8386 (npm's `node` child too) and Status reads sleeping; show it again
  and it starts, since a Stop is not remembered. Leave it for a minute (another surface, or another tab in the
  centre): Status reads `sleeping`, its row leaves the tree once another row is selected, and 8386 is free; open it
  again and it starts. Turn Keep running on (the row's menu, or Setup → Tools): it starts at once, never sleeps, and
  starts again when you quit and reopen arcterm. With Hóng already running outside arcterm, its row reads
  `not started by arcterm` and Open shows it at once; its row in the footer's Servers has Pin as app, which opens the
  same form filled from it. Also in the Mac app, which the headless-Chrome Final cannot reach: the WKWebView frame,
  Back/Forward (the window's history there), the row's right-click menu, j/k onto a service row, and a start at boot
  finding npm from nvm or Homebrew on the login PATH.
- [ ] (arcterm) Apps run while used: with Keep running off for the portfolio app, open it, ask its chat something long
  (a `claude -p` that runs a few minutes), and switch to Agent: `:8386` still answers a minute later, and the app
  sleeps about a minute after the answer ends (its Status in Setup → Tools reads `sleeping`, 8386 is free). Then turn
  Keep running on for the portfolio entry (Setup → Tools; it is your `tools.json`, outside the repo; spec model 4) so
  its ~15:05 build-macro runs. `services.Busy`, `pkg/services/supervisor.go`; spec
  `docs/superpowers/specs/2026-10-20-apps-run-while-used-design.md`. 2026-10-20.
- [ ] (arcterm) In a terminal, `echo ~/.claude/settings.json` then hover the printed path: the whole path underlines
  (with `~/.claude`), and Ctrl+click opens it. Same for `.claude/settings.json` printed in a home-folder terminal.
  2026-10-19.
- [ ] (arcterm) Jarvis → Waiting on you, a "plan" row whose agent is closed (or the Needs you strip, the palette, the
  pet's peek): Open lands on the Brief with that initiative expanded on its Proposed group (Accept all, Drop all),
  even from another surface, past the 6-row cap, under a search or another project's filter. Its activity link and
  right-click Open activity still open the Activity sheet. 2026-10-19 (`openref.ts` selectEffort,
  `briefsurface.tsx` briefOpenInitiativeAtom).
- [ ] (arcterm) Fold to the pet with Bottom right picked (or never moved): the pet sits 24px in from the screen's
  bottom-right corner, not 96px up; Windows and Mac. 2026-10-19 (`floatwindow.ts`).
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

**2026-10-16 (skim split out of arc-view)**

- [ ] (arcterm) In a new `claude` session a long explanation draws dimmed around its highlighted sentences, `/skim`
  toggles it with "skim off" in the status area, and a lead's wake row still draws as its events. The install half
  holds (2026-11-04): `~/.arc/claude-skim-mod` exists, `~/.arc/claude-view-mod/hooks` holds `register.ts`,
  `wake-core.ts`, `wake-row.tsx` and its `hooks.json`, and `env.CLAUDE_CODE_PLUGIN_DIRS` lists all three mods.
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

**2026-10-16 (the Office's Needs you notice board, run 0e23de6a)**

- [ ] (arcterm) With real Needs you rows (a plan to review, a run to land, a learned rule): Cockpit → Office. The
  board below the lounge pins up to three slips with the `!n` count over it; ↑↓ / `j` `k` and `n` stop at it only
  while rows wait. ↵ there (or a click, or `m` → Notice board) opens the box: ← → page the rows, and Approve, Land,
  Accept, Dismiss act as the strip's buttons do, toasting on failure with the page kept; Open on an agent, initiative
  or channel row lands there. After work hours the slips dim with the office. The CDP scenario
  `office-needs-you-board` ran on a fixture only and pressed no act that calls the server.

**2026-10-16 (kael sync: memory hygiene, autonomous runs, wider plan review, radar kinds)**

- [ ] (arcterm) Setup → Memory: the tab sits between Learned and Project; a project row shows its index size and
  "Not checked yet" until a check runs; **Check now** proposes changes with their evidence, Accept applies one and
  Undo puts it back. `setupmemory.tsx`, `setupsurface.tsx`.
- [ ] (arcterm) New → Orchestrate: the Models block is a 2×2 grid (Lead, Workers, Reviewers, Light reviewers) and an
  **Approvals** row (Ask me | Autonomous) with its note sits under it; a run started on Autonomous shows the word on
  its run sheet's config line. `launcherrunfields.tsx`, `launchermodal.tsx`.
- [ ] (arcterm) A run's sheet → Adjust: the Approvals dial saves, turning it on with a lead question waiting hands that
  question back; the palette offers **Go autonomous** / **Ask me again** on the run. `briefrunsheet.tsx`.
- [ ] (arcterm) Agent sidebar → a project's Conversations: an ended orchestrator run whose lead landed in `arc-wt`
  shows as one run entry under that project, not missing (counted in "elsewhere") or under a key like `006c403f`.
  `agentsidebarmodel.ts` `projectKeyResolver`, `sessionruns.go` `fillEngineTreeRoots`.
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

**2026-10-15 (arcterm stays on its own Desktop on a Mac)**

- [ ] (arcterm) With **Fold when you leave** on and arcterm full on Desktop 1: switch to Desktop 2 (Ctrl+→) and wait
  past the fold delay: arcterm does not fold; `⌘Tab` back takes the screen to Desktop 1, full. Fold with `⌘M`, go to
  Desktop 2: no Sprout there; `⌘Tab` or the Dock icon takes you to Desktop 1, where it grows back. Make another app
  full screen (green button) over arcterm: it folds and Sprout shows over that app (the one case `CGSSpaceGetType`
  must answer 4, not checked by hand yet); click it: arcterm comes back on a Desktop (note which: AppKit picks it).
  `foreground.rs` desktop_on_screen, `macwindow.rs` folded_behavior.

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

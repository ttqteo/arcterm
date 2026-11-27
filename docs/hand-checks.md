# Waiting on a hand check

Changes that shipped tested only by unit tests or the typecheck, never tried in the running app (or a platform branch
no build here compiled). Split out of `docs/open-issues.md` on 2026-11-03; that file keeps the rest of the backlog.

Each line: what to do, what you should see, where, and the commit. Tick it when it holds, then remove it; when it
does not, say what you saw and it becomes a bug row under Actionable.

**Days.** Lines sit under a `## YYYY-MM-DD` heading, the day the change landed, newest day first, so "check what was
built today" is one section. A new line goes at the top of today's section; when the top heading is an older day, open
`## <today>` above it first. A day's heading goes once its last line is removed. The days before 2026-11-20 were sorted
from `git blame`: the day each entry's first line was last written.

**Parts.** This file is the open part: a new line always goes here, under today's heading. When an edit takes it past
400 lines, move its oldest lines (whole entries from the bottom, a date heading with its entries) to the top of the
highest-numbered `hand-checks-N.md` until this file is under 250 lines; when that part would pass 600 lines, start
`hand-checks-<N+1>.md` with the same header instead, and add it to the list below. The higher the number, the newer
its lines. Lines in an older part are ticked and removed where they are; a part left empty is deleted and taken off the
list (its number is not reused).

Older parts: [part 11](hand-checks-11.md) · [part 10](hand-checks-10.md) · [part 9](hand-checks-9.md) ·
[part 8](hand-checks-8.md) · [part 7](hand-checks-7.md) · [part 6](hand-checks-6.md) · [part 5](hand-checks-5.md) ·
[part 4](hand-checks-4.md) · [part 3](hand-checks-3.md) · [part 2](hand-checks-2.md) (oldest).

## 2026-11-28

- [ ] (arcterm) **Prototype: `m` flips Try | Mark.** Open an interactive board (one with `is_interactive`, e.g. a
  prototype an agent drew) in the Canvas pane, focus it and press `m`: the switch moves from Try to Mark and back, and
  in Mark a drag draws a box instead of clicking the board. The Final skipped this step (CDP key events do not reach
  the page) and read the binding instead. 27ff850c3.

- [ ] (arcterm) **Prototype chips and the Try | Mark switch: their motion.** On a board with a variant slot opened
  large (Canvas pane, the brainstorm rail's opened board, the gallery viewer): hover a chip → the slot gets its dashed
  outline without a jump; press B → only the slot region changes, the screen you clicked to stays. Flip Try | Mark
  and draw a mark, go to another screen and back → the mark tray stays, the marks show only on their own screen. No
  run agent watched these frames (`arc:ux-check`'s live pass was not done). 27ff850c3.

- [ ] (arcterm) **Prototype on a Mac.** In the WKWebView build, open a board with a variant slot: the A/B/C chip swaps
  the variant (the swap rules use `:has`, checked only in Chromium), and a mark drawn in Mark mode gets its picture on
  Send. 27ff850c3.

## 2026-11-27

- [ ] (arcterm) **Storage: the Build output row's spinner.** Settings → Storage, Build output: open a project whose
  size is over a day old (or `not sized`). Its row shows a small spinner left of the size while its folders are walked
  and the spinner goes when the walk lands, with nothing else on the row shifting: the size cell, the Remove button and
  the label stay where they were. Only the project being walked spins, not the ones queued behind it (press Size all
  and watch the spinner hop down the list). With reduced motion the spinner shows without turning. No scenario watches
  it (`settings-storage` steps 7c-7f read the end states from the DOM only).
- [ ] (arcterm) **Storage: `not sized` becoming a number.** On a project row that reads `not sized`, open it: when its
  walk lands the cell swaps to the size in place (same width, no jump), and a size over a day old adds `sized N days
  ago` after `used …` in the detail line. Open its folders: each shows its own size, or `not sized` for one never
  measured.
- [ ] (arcterm) **Storage: Size all and Stop sizing.** Press Size all on Build output: the button turns to `Stop sizing
  (1 of N)` and counts up as each project lands, the card's size and the head's total growing with it. Press Stop
  sizing: the project in hand finishes, the button goes back to `Size all` and the rest stay as they were. Leave
  Settings and come back mid-run: the button and the spinner are still there.
- [ ] (arcterm) **A sleeping agent's question and permission in Chat** (`sleepheldview.tsx`, `permissioncard.tsx`,
  `permissionrow.tsx`, the sleep-keeps-ask run). The run's Final passed `sleep-keeps-ask` on a fixture tab (end state
  only); no real agent was slept while asking, and no motion was watched. With the build
  installed, let a Claude agent ask you something (AskUserQuestion, arc mod on) and Sleep it from its row menu: Chat
  should keep the question beside "Asleep since …" and Wake. Pick an option: the question card goes and your answer
  grows in under the conversation with "Goes in when <name> wakes" (a spring open, no jump; at once under reduced
  motion), and the agent stays asleep. Press Wake: that block should fold away on the same spring and the agent
  carries on with your answer. Then let an agent wait on a permission prompt (a Bash command) and Sleep it: its Chat
  card and its sidebar row should show the command and Wake alone (no Allow, Deny or Answer in Terminal), the dot not
  pulsing; Wake pressed twice quickly should wake it once.
- [ ] (arcterm) **Pair: judge replies read in the working agent's Chat lower the ⚖ count.** In a paired agent with
  several judge replies unread, scroll its Chat down past them without opening the pair: the number on the ⚖ line (tree
  row and header button) drops as each judge card's head comes on screen, and the working agent's own turns never count.
  The judge cards and the "paired this agent with" line name the judge "Judge: …", not the project, old replies too.
  (b9659f45b, 861017c4a)
- [ ] (arcterm) **Priority badges and recent-project buttons on Jarvis initiatives.** In the dev app open Jarvis with
  an initiative whose open chunks have levels set (`wsh effort chunk priority …`): its card shows pills like
  "1 critical" (red) "4 high" right of the `n/m %` count, and its row in All initiatives shows them after the title; at
  a narrow window the row keeps a few words of the title and the pills clip, never the reverse. With more than seven
  projects, three project buttons sit left of the `project ▾` menu (the last launched-into, sorted by name); a press
  filters to it and shows it pressed, a second press goes back to all. Not seen in the running app: no dev app was up.

- [ ] (arcterm) **`wsh jobslot forget` drops a bad peak.** After a build with it installed, in the arcterm checkout run
  `wsh jobslot forget scripts/verify.mjs`: it should print `dropped 10.6 GB` (the 21:42 run of 2026-11-27), the four
  kept peaks, and `admitted on 4.8 GB`; the next queued verify.mjs row in the Jobs popover reads about 4.8 GB, and
  `jobpeaks.json` (data dir) no longer holds the 10.6 GB peak. `wshcmd-jobslotforget.go`, `jobpeaks.Forget`.
- [ ] (arcterm) **A paused run keeps its worker's open question.** After a build, start a run whose worker asks you
  something (AskUserQuestion, arc mod on), pause the run while the question is open: it should stay in Needs you and on
  the run. Answer it while paused, resume: the reopened worker should start with "the person answered your question:
  …" and carry on. Commit e2c1334ef.
- [ ] (arcterm) **Save for later: the What's new picture.** Take it with `node scripts/whatsnew-shot.mjs save-later
  --selector [data-jarvis-brief-region="later-chunks"]` (the Brief with a few later items on screen), then swap the
  CHANGELOG line's `<!-- shot: none -->` for the comment it prints, in one commit (spec "Builder's calls" 17). Until
  then `whatsnew.test.ts` is happy with `none`.
- [ ] (arcterm) **Later section: Ask agent on an agent that has exited.** On Jarvis, Ask agent on an item whose agent
  has exited, and whose conversation is in History, resumes the conversation in a new tab (asleep for a harness that can
  sleep) and its chat box holds the quote once it mounts. The button dims while the resume is in flight. It launches a
  real session, so no scenario covers it (`later-section` step 5 only checks an ended agent with nowhere to go;
  `askagentlater.test.ts` and `chatinsert.test.ts` cover the logic). On a live item (`later-section` step 4 checks the end state) watch the Agent
  surface come forward with the quote in the box and the caret under it.
- [ ] (arcterm) **Later section: the tick and Undo.** Tick a Later row on Jarvis: its check mark shows on hover, the row
  leaves on the spring, the group folds with its last row, and the Undo toast brings the row back where it was. Tick
  the last item of all: the section folds away and the Initiatives section under it does not jump 20px at the end (the
  fold's `marginTop` runs -20 → 0 against the column's `gap-5`). Save the first item again (Chat → Save for later): the
  section opens. (`laterchunksregion.tsx`; `later-section` step 3 checks the end state.)
- [ ] (arcterm) **The Later group on an initiative's page.** Open an initiative holding later items: the Later group
  opens when the first item is saved with the sheet open and folds when the last is moved back. "Not later" on a row: it
  folds out of the group while it opens in the plan, no height stays stuck, and Undo puts it back; pressed twice fast,
  or Undo mid-fold, it ends in one place. The "Not later" menu on a row low in the group does not clip at the sheet's
  bottom. `j`/`k` step into the group and scroll the row into view. With reduced motion on, the group and rows show and
  fold at once. (`inlinetrackerview.tsx` Later group; `later-sheet` checks the end state.)
- [ ] (arcterm) **Save for later: the picker opens at the pointer.** In the Chat of an agent linked to no initiative,
  select text, right-click → Save for later: the picker opens at the right-click point with Recent first (it flips up
  near the bottom of the window and shifts in from the right edge), "Recent" goes the moment you type a letter and the
  rows below jump up, and a pick, Escape or a press outside closes it. A quick double-click, or a double Enter, on a
  row saves one chunk, not two. (`initiativepicker.tsx` `point`, `chatquotemenu.tsx`; `save-later` steps 3 and 5 assert
  the placement.)
- [ ] (arcterm) **Save for later: the toast and its Move to….** After a save, the toast comes and goes on its spring
  with two actions; at a 320px window with a 60-character initiative title, the Open / Move to… row sits under the
  message and does not overflow. Move to…: the toast closes and the picker opens above the button's place (bottom
  right), picking another initiative moves the chunk (its note, due and mark with it) and a second toast says so.
  (`notificationtoasts.tsx`; `save-later` checks the end state.)
- [ ] (arcterm) **The agent's later card: ×, Add and the target.** When an agent offers a list to leave for later: the ×
  on a row folds it away on the spring and the rows below slide up; Add shows the spinner, then the card folds into its
  "Saved for later · … — N items" row with Open ↗; the target button opens the picker under it, Recent first, and the
  chip becomes the picked initiative; a list longer than about eight rows scrolls inside the card with the ×'s focus
  ring unclipped at the row's edge. Not exercised even by the scenario: Dismiss, a failed Add ("Try again"), an exited
  agent's static card, and a new initiative as the target. (`chatinitiativecard.tsx`; `later-card` checks the end
  state.)
- [ ] (arcterm) **The Priority menu on a chunk low in a long plan** (`inlinetrackerview.tsx`, run af2b7967 t-4). The
  Priority section adds about 230px to the status menu, and Final measured its bottom at 960px in an 864px window. On a
  Jarvis initiative card with a long plan, open the status word of the last chunk: the whole menu, Priority to Rename,
  can be reached (it scrolls into view inside the plan, or opens upward) and nothing is cut off under the window edge.

- [ ] (arcterm) **A background command's RAM** (`pkg/resmon/shelltaskmem.go`, `agentram.ts bgTaskRamBytes`,
  `agenttree.tsx BgTaskRam`, `agentdetailsrail.tsx`). Go and vitest only, no dev app run. With the sidebar's RAM field
  on, have an agent run a build in the background (`task tauri:build FAST=1`): its task row reads `running · 8m · 1.2
  GB` within a few seconds of cargo starting, the agent row's RAM grows by about as much (it read 283 MB with 1.2 GB of
  rustc running before), and the rail's Background tasks card shows the same figure. A `sleep 600` task shows a few MB.
- [ ] (arcterm) **A Chat note keeps its project and conversation** (`palette-notesview.tsx`, notestore frontmatter).
  In a real Claude agent's Chat select a sentence, right-click → Add note, then open the toast's Open: the note's row
  shows its project as a small badge before the day, and above the note a badge and `Open conversation ↗`; the body's
  first line reads `From agent "<name>", <day>` (no `agent:` address). Open conversation closes the palette and lands
  on that agent's tab ("is already open" toast); close the tab, do it again: the conversation opens in a new tab. Edit
  the note (`Ctrl`+`Enter`), save: badge and link stay. The vault file starts with `project:` / `session:` frontmatter.
  A note made before this change shows no header. Not run live: `task verify:ui -- chat-quote` step 11 covers the end
  state, never run here.

- [ ] (arcterm) **Links between a board's drawings, and Back** (`boardlinks.ts`, `boardcanvas.tsx` follow/onLinkOpen,
  `BoardBack`, `pkg/boarddrawer` `link`/`@new`). Go and vitest only, no real drawer run, no scenario step. On
  `mit-thesis` harnesspov-method-retrace, have the agent `wsh board draw --ask "in 'Timeline liền mạch', link the box
  '21/10 Thiết kế…' to the drawing 'Thiết kế 21/10'"`: the box gets Excalidraw's link mark. In view mode press the box
  (not only the mark): the view eases to 'Thiết kế 21/10', a Back fades in left of History; press Back (or Backspace on
  the canvas) → back to the timeline, Back fades out. A drag that starts on the box pans and does not follow. In Edit, a
  press selects the box; its link mark still follows. Then `--ask "draw the detail of '22/10 M2' and link that box to
  it"`: one turn adds the drawing and the link.
- [ ] (arcterm) **Allow and Deny on an agent's sidebar row** (`permissionrow.tsx`, branch of the sidebar-permission-row
  run). Vitest and typecheck only; the end state is `task verify:ui -- sidebar-permission-row`, never run here (a run
  agent runs no CDP). With a real Claude agent outside a run, have it run a Bash command that asks permission: its row's
  second line reads `$ <command>` in amber and a third line opens under it on the reveal (height and fade, no jump),
  Allow and Deny on the left, `waiting 4s` on the right. Press Allow: both buttons dim at once, the command runs, the
  third line closes on the same reveal and the row does not get selected or dragged. Have two agents ask at once and
  answer one so the rows re-sort: a click on a button while its row slides does nothing. Then swap the changelog's
  `<!-- shot: none -->` for the picture the scenario leaves (`public/whatsnew/<next minor>-sidebar-permission-row.webp`).
- [ ] (arcterm) **History in a board's header** (`boardhistory.tsx`, `historyRows`). Vitest and typecheck; no scenario
  step. Open a board with several turns: a clock and the count sit left of the chat picker. Press it: the list scales
  in from its top right, newest first, the drawing in view marked; press a drawn row → the list closes and the view
  eases to that drawing; a failed row shows its reason and does nothing on a press; Esc or a press outside closes it.
  Same in Library → Boards, left of Open in split. A board with no turns has no clock.
- [ ] (arcterm) **An ask's Submit button shows ↵ once every question is answered** (`answerbar.tsx` submitButton,
  d58a5abbe). Lint only. Have an agent ask two questions, answer both: the Submit tab's button reads "✓ Submit ↵" and
  Enter sends; before the last answer the grey button has no ↵. Check the ↵ sits on the button's baseline and the
  button does not grow taller than the ← → buttons beside it.
- [ ] (arcterm) **Session ideas: a scan cut off by a restart reads as stopped.** Go tests only. On a dev app, press Scan
  now and stop the dev app (by PID) while it reads, then start it again: the region shows "The scan stopped at session
  N of M: arcterm closed before it finished." with Retry, not a scan that runs forever with Scan now hidden; Retry goes
  on from session N. (`pkg/sessionideas/scan.go` EndUnfinishedScan, `wshserver_sessionideasloop.go`)
- [ ] (arcterm) **A board's drawing chip shows no focus ring on Shift** (`boardstrip.tsx` DrawingsRow, 6f0b0e5c9). Lint
  only, no dev app. Click drawing chip 1, scroll the canvas to drawing 2, hold Shift and scroll: no blue "[ ]" on
  chip 1. Then Tab onto a chip: its ring shows whole, inside the chip, not clipped top and bottom.
- [ ] (arcterm) **→ / ← between a board's drawings** (`boardcanvas.tsx` onKeyDownCapture, `stepDrawing`). Vitest and
  typecheck; no scenario step. Open a board with several short drawings, click the canvas, press → several times: the
  view eases drawing to drawing and the row's marker slides along; at the last drawing → does nothing, ← goes back. On a
  dense "Earlier drawings", → still reads its parts. With a shape selected in Edit, → nudges the shape as before.
- [ ] (arcterm) **An agent waiting on a background command carries on after a restart** (`pkg/blockcontroller`
  agentrestore.go `stoppedBackground`, `restoreNudgeText`). Go tests only, no real restart. Have a Claude agent start
  something long in the background and end its turn waiting on it (`sleep 600` with run_in_background), then restart
  arcterm: the agent comes back with a first turn naming that command, starts it again or says what stopped, and does
  not sit idle. If it only said what stopped and started nothing, a second restart does not nudge it again.
- [ ] (arcterm) **An agent fixes or deletes a drawing in place** (`pkg/boarddrawer` answer.go `drawing` key, prompt).
  Go and vitest only, no real drawer run. On a board with two drawings, have an agent run
  `wsh board draw --board <name> --ask "in <title>, drop the long arrows"`: that drawing changes, no new frame appears.
  Then `--ask "delete the drawing <title>"`: the frame and its shapes go, the other drawing stays, Undo brings it back.
- [ ] (arcterm) **Copy image on a diagram shows a camera** (`mermaidviewer.tsx` CopyImageButton, 820090bc2). Lint
  only. Hover a mermaid diagram in Chat: the toolbar's Copy image is a camera; it turns to a check after a press. Same
  in the enlarged viewer.
- [ ] (arcterm) **A board without turns or ask box; the status line** (`boardstatus.tsx`, `boardsplit.tsx`,
  `libraryboards.tsx`). Typecheck and unit tests; scenarios boards-split 2, 5a–5c and boards-library 5, 6 rewritten,
  not run. Open a board beside an agent: no turns column, no ask box, no Hide turns in the header; the canvas runs to the
  cell's foot. Have the agent `wsh board draw`: a line slides up under the canvas, "Answering · Ns" with the brief, and
  slides away when the drawing lands (the canvas grows back without a jump). A failed turn leaves "Couldn't draw", its
  reason and Retry until a later drawing lands. Library → Boards: the same line, and the running/ended footer under it.
- [ ] (arcterm) **The drawer's second go, its fresh session, and boxes that hold their label** (`pkg/boarddrawer`,
  `boardfit.ts`). Go and vitest only, no real drawer run. On a long board (`contexttokens` ≥ 100k in its
  `.talk.json`), one more `wsh board draw`: waveapp.log says "starting a new one" and the drawing still lands. Open
  `mit-thesis/4e0f9655`: the "Validation: ratchet…" and "23/10 M4…" boxes now hold their three lines.
- [ ] (arcterm) **Delete the part being read** (`boardsplit.tsx`, `boardheader.tsx`, `boardparts.ts` ids). Unit tests and
  typecheck; scenario boards-split 8c written, not run. On a dense board press ‹ 8 parts ›, then turn Edit on (the trash fades in beside the stepper, Whole drawing and the arrows hold still) and press it: the part's shapes go, the view eases back to the whole
  drawing and the count drops by one; the toast's Undo brings them back. An arrow tied to a deleted part's box goes
  with it.
- [ ] (arcterm) **Board strip: Copy view, Export, Delete; Tidy gone** (`boardstrip.tsx`, `boardcanvas.tsx`,
  `boardshot.ts`). Unit tests and typecheck; scenario boards-split 18h written, not run (no dev app was up). Open a
  board with several drawings: the strip shows a camera and a download before Edit, no trash and no Tidy. Zoom
  into a part and press the camera: paste in Paint or Slack shows exactly what the canvas showed, dark ground and light
  ink on the dark board, white on the light one. Download → PNG and → SVG: the Save dialog proposes the drawing's
  title, the files open cut to the drawing's frame in the board's theme; the menu fades and scales in from its top
  right. Turn Edit on: a trash fades in left of the camera, which holds still. Trash: the drawing's chip leaves the row, the view eases to the drawing before, a toast says Drawing deleted;
  its Undo brings the chip and the drawing back and the view eases to it. Reopen the board: the delete (or the undo)
  held.
- [ ] (arcterm) **Board header stepper holds still** (`boardheader.tsx`). Typecheck only. On a dense drawing, step
  with ‹ › through parts whose names differ in length: the arrows stay under the pointer; start reading from
  "‹ 8 parts ›" and leave with Whole drawing: the arrows do not move either.
- [ ] (arcterm) **Work on this under a long chunk title** (`railinitiativepane.tsx` rowView `under`). Lint only, no dev
  app was up. On an agent with an initiative, open the rail's Initiative tab and move the cursor (arrows) onto a
  chunk with a long title: the title wraps across the full row width and Work on this `w` sits on the next line,
  lined up with the title's start; other rows still show their tag on the right and Work on this on hover.
- [ ] (arcterm) **Rerun a done run's final-held land** (`land.go awaitsFinalRerun`, `mutation.go endedRunSettles`, 09044e387).
  Unit tests only. Make an orchestrator run's Final fail on something outside the code (stop a service its Check
  needs) and let it complete held: `wsh runs show <id>` reads `land held: the final stage failed` and the dag stays
  `blocked`, not `closed`, and its lead tab closes. Fix the service and run `wsh runs rerun-final <id>`: it is accepted,
  the stage passes, and within a watchdog tick the run lands on its own.
- [ ] (arcterm) **Context ring drops after /compact** (`chatfooter.tsx`, `agentrailmodel.ts contextPctNow`). Unit test
  and typecheck only. In an agent's Chat with a large context, type `/compact`: once the Compacted divider shows
  "N → M tokens", the ring under the input reads M's percent (hover: M tokens), not the old one; after the next reply
  it follows the statusLine again.
- [ ] (arcterm) **A question shows as its own card in Chat** (`chataskcard.tsx`). Typecheck and unit tests only, no
  live pass. Have an agent ask an AskUserQuestion between two tool calls: while it waits, the conversation shows no
  "asked a question" in a fold, only the dock's choices; answer with an option: a card lands in the conversation
  (springing open, no snap) with "Asked · <header>", the question in full, the picked option and its description in a
  raised row, "Not picked: …" under it. Answer another with Other and typed words: the row shows them with "Your words".
  An ask of several questions: "Asked · 2 questions", each with its header. Press Esc on one: "No answer" and
  "Offered: …". A very long question or typed answer wraps, nothing overflows at a narrow Chat. Also
  `task verify:ui -- chat-council` (step 10).
- [ ] (arcterm) **A fork reports in at once, named "Fork: …"** (`wshcmd-agenthook.go`, `chatfork.ts`). Unit tests
  only. On a build with this `wsh`, Fork a Claude agent from Chat (or a session from the palette) and send nothing:
  the new row reads "Fork: <title>", loses "resuming…" within a few seconds of the TUI loading, and shows in
  `wsh agents list`. Fork that fork: its name is still one "Fork: ".

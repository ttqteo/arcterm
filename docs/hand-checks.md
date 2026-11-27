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

Older parts: [part 10](hand-checks-10.md) · [part 9](hand-checks-9.md) · [part 8](hand-checks-8.md) ·
[part 7](hand-checks-7.md) · [part 6](hand-checks-6.md) · [part 5](hand-checks-5.md) · [part 4](hand-checks-4.md) ·
[part 3](hand-checks-3.md) · [part 2](hand-checks-2.md) (oldest).

## 2026-11-27

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
- [ ] (arcterm) **Focus board in the agent header** (`boardfocusstore.ts`, `agentheader.tsx`). Typecheck, unit tests and
  a new step 7b in `task verify:ui -- boards-chat`, not run live. Open a board beside an agent (the board card's Open):
  a ⛶ Focus board button shows in the header left of More; with no board split it is gone. Press it: the agent tree
  folds on its slide, the rail goes, the chat takes 3 parts of 10 and the board 7 (the split's line jumps, as a sash
  drag does), the button lights. Press again: tree, rail and split come back as they were. Drag the sash or press `d`
  while focused: the button goes unlit, and a press focuses again. Press twice fast mid-fold: the tree ends folded or
  open, never stuck half-way.

- [ ] (arcterm) **Long chunk titles show whole** (`railinitiativepane.tsx`, `planreviewsection.tsx`). Typecheck only.
  On an agent linked to an initiative with a long title and long chunk labels, open the Initiative tab (◇ or `i`): the
  title and the "On N · …" line wrap to at most three lines, Open in Jarvis and Mark done stay on the first line; arrow
  through Chunks: the cursor row wraps its whole label, Work on this sits beside its first line, the row before folds
  back to one line without jumping the list oddly; click a row: it stays whole while its status menu is open. A Plan to
  review card in Chat (and the panel's section) wraps each proposed chunk, its ✓ ✎ ✕ centered beside it. Click the
  open row again: the menu closes; open it and click the terminal: it closes too.
- [ ] (arcterm) **Quick note from the rail.** Click Note on the nav rail (above Translate), then press `Mod`+`Shift`+`N`
  from a focused agent terminal: each time Search opens on the Notes scope with the caret in an empty title; type a
  title, `Enter`, a body, `Ctrl`+`Enter` saves it and the Notes list selects it; `Esc` from an empty draft lands on the
  Notes list, twice with text typed. On a narrow window the rail shows the icon alone, its tooltip naming the chord.
- [ ] (arcterm) **Save as idea / Add note on selected Chat text.** In an agent's Chat select a sentence of a reply,
  right-click it: the menu reads Reply, Copy, a rule, Save as idea, Add note. Save as idea toasts "Saved as idea" with
  the passage's first sentence; Open lands on the new idea in Jarvis's Ideas, whose peek shows `From agent "<name>"
  (agent:…)` and the passage quoted. Add note toasts "Added to Notes"; its Open shows the palette's Notes with the new note first. A
  long Vietnamese passage gets a title cut with "…", not a save error. Not run live: the `chat-quote` scenario's steps
  10–11 cover it (the commit adding Save as idea).
- [ ] (arcterm) **Session ideas: scan one project first.** Run `task verify:ui -- sessionideas-brief` (step 10b) on a dev
  app with this change, then by hand on the Brief's offer card (Ideas column, before any scan): with two or more
  projects to read, a `project all ▾` chip sits left of Scan my sessions; its menu lists all, then each project with
  its count, most first. Pick one → the button reads `Scan <name>` and the estimate counts that project only; a long
  name ends in an ellipsis and the row does not wrap. Press it → the region appears with `<name> only` in its header,
  the card stays with `Scanned so far: <name>.`, and once its scan ends the button can be pressed again for the next
  project. When the scan leaves only one project, the chip folds out on the spring (watch it: no snap, the button
  slides left with it; with reduced motion it goes at once). Scan all → the card leaves and the header loses `only`.
  (`sessionideasregion.tsx`, `filtermenu.tsx`, `pkg/sessionideas/scope.go`)
- [ ] (arcterm) **Session ideas: Scan now presses again after a scan.** In the region press Scan now, let the scan end,
  then press Scan now again → it starts a scan; before, the button stayed greyed out until the Brief remounted.
  (`sessionideasregion.tsx` useStarting)

- [ ] (arcterm) **Account name always beside the model.** With every open Claude agent on one account: the chat box's
  footer reads the account (its label, or the /login email for Default) left of the model, and each Claude row in the
  sidebar names it before the model; a long name truncates, the row does not wrap. `d13f49b5e`
- [ ] (arcterm) **To review sheet: long rows stay whole.** Jarvis with more To review items than the sheet's height
  (18 on the person's store): open Review. Each label reads in full with its initiative in muted text under it, and the
  list scrolls; `j`/`k` past the bottom brings the row into view; Later on a row folds it on the spring with no jump of
  the rows below. Only a flex repro in headless Edge was checked (`feff567a7`). Then the calmer rows: Later and Drop
  fade in only on the row under the pointer, on the `j`/`k` cursor's row and on Tab into a row, and showing them does
  not reflow the label; each label's text before its first ": " or ". " is bold; a plan run's heading ends before "as
  specified in". Only a static mock was checked (the commit after `4f52092fb`).
- [ ] (arcterm) **Plan to review card in Chat: its motion.** An agent whose initiative has proposed chunks, in Chat mode:
  the card opens on the spring under the last reply (no jump of what is above it). Accept all: the footer folds away
  on the spring and the card keeps its rows, now `accepted · now pending`. Let the agent take a turn: the card folds
  away with its rows still drawn (not emptying first). Press Accept all and send a message at once: no card left half
  open. With reduced motion on, it opens and closes at once. The `chat-plan-review` scenario checks the end states;
  no frame trace was taken (`chatplanreview.tsx`, `planreviewsection.tsx`).
- [ ] (arcterm) **Brief toast beside the sheet.** Open an initiative in the Brief's sheet, delete a chunk: the "Deleted …"
  toast and its Undo sit in the part of the page left of the sheet, not over its footer; with the sheet closed it is
  centred again. Typecheck only (`brieftoast.tsx`, `--brief-sheet-w`).
- [ ] (arcterm) **Learned headers keep their case.** Settings → Learned with a memory from a folder like `MyApp`: the
  group header reads MyApp, not MYAPP. Settings → Terminal on a fresh config reads font 14, cursor Bar, blink on. The
  rail's Translate panel still slides out of the rail's edge (its motion moved to `motiontokens.ts` leftPanelIn).
  Typecheck only.
- [ ] (arcterm) **A Codex route reads codex.** A run whose workers route is Codex with no model: the plan review's
  stage line, New run's "all on …" and the model picks' running model read codex, not default. Unit test only.

- [ ] (arcterm) **Switching Claude account leaves sleeping agents asleep.** Put one Claude agent to sleep, then switch
  the active Claude account (Settings, or the Chat limit strip): the restart list should not offer the sleeping agent,
  and it should stay asleep. Wake it: it starts on the new account. waveapp.log should hold no "is already asleep" line
  for it afterwards. Unit tests only (`claudeaccount.test.ts`, `TestSleepGoesAheadOverAStaleSleepingMark`).
- [ ] (arcterm) **Overview names the tree's lead.** Only reachable with a run that has two lead tabs (a relaunched lead
  whose old tab stayed): the Overview's run row and the Agent tree name the same lead. Unit test only.
- [ ] (arcterm) **A pair takes the worker's finished reply, not its last mid-turn line.** In a pair, have the working
  agent end a turn with a short line, a tool call, then its real reply (ask it to "say 'Final check:' then run `ls`,
  then answer"). The judge should get the reply after the tool call, never "Final check:"; waveapp.log should hold no
  "pair: … did not reach its transcript" line. Unit tests only (`TestPairStopIdleWaitsForTheTurnEndInTheTranscript`);
  commit fbb202294.
- [ ] (arcterm) **Folded Sprout: a click outside the stay or hide menu closes it.** Fold into Sprout, open the peek,
  open the pin's stay menu (and then the Hide menu): click an empty spot of the float beside the menu. The menu should
  close and the click should not reach the app behind. CDP cannot drive the folded window; read from code only
  (`petpeek.tsx` PetStayPin, `pethidemenu.tsx`, backdrops now carry `data-mini-hit`).
- [ ] (arcterm) **Queue sheet spaces its dot.** On the Brief, open a queued run's sheet started from an agent: the last
  line reads "queued just now · from <session>" with a space each side of the dot. Typecheck only.

## 2026-11-26

- [ ] (arcterm) **Session ideas: a real scan.** No scenario reads a real transcript or calls a model, so this is the one
  pass over the real path. On the real store with the Brief open and nothing scanned yet, the Ideas column ends in the
  "Ideas you floated and left" card with its estimate; press Scan my sessions → the region replaces the card, shows
  `Reading session d of N` with Stop, and the header counts tokens as it goes; at the end a toast says
  `Session scan: K ideas to review, from N sessions` with Review, and the header reads `scanned <day> · <tokens> tokens
  · next by <day>`. Then read the numbers into open-issues "First session scan's tokens" (and set
  `SCAN_TOKENS_PER_SESSION`). Press Keep on one idea → its initiative has a `pending` chunk whose first note holds the
  quote and the session id. (`sessionideasregion.tsx`, `pkg/sessionideas/scan.go`, f1973dc2a, 0792a18fe)
- [ ] (arcterm) **Session ideas: What was said opens and folds.** In the region press What was said on a row → the quotes
  open under the row on a spring (the chevron turns 90°) and press it again → they fold, with no jump or flash and the
  rows below moving with it. (`sessionideasregion.tsx`, f1973dc2a)
- [ ] (arcterm) **Session ideas: a row leaves on Keep and Drop.** Press Keep on a row → it slides out on a spring and the
  rows under it close the gap, a toast says where it went (`Kept on “…”` or `Kept in Ideas`), and for an idea with no
  initiative the Ideas column gains a row; Drop does the same without a toast. A Keep the server refuses (a chunk with
  that label already exists) puts the buttons back and the row stays. (`sessionideasregion.tsx`, f1973dc2a)
- [ ] (arcterm) **Session ideas: the region's panels and fold.** Start a scan → the progress panel opens above the rows
  and its bar widens on a spring; Stop it → the progress panel gives way to the red stopped card with Retry; Retry goes
  on from that session. With a session leaving unscanned the yellow card opens, and Sessions scanned unfolds a coverage
  bar and its rows (scrolling past 320 px). Press Not now on the offer → it folds away. Nothing jumps.
  (`sessionideasregion.tsx`, f1973dc2a)
- [ ] (arcterm) **Session ideas: Sprout's ideas line.** With ideas waiting, open Sprout's popup → the line `N ideas
  from your sessions to review · Review in Jarvis` springs in under the updates and goes when the last idea is decided;
  Review lands on the region, and the nav rail's badge does not count the line. (`petideas.tsx`, 07192f191)
- [ ] (arcterm) **Session ideas: the chips' list and started line.** Press What's waiting? → the ideas open as a list in
  place on a spring, and a second press closes it (Which lose their transcript soon? the same, with only the leaving
  ones). Press Go through N with an agent or Discuss: … → a started line (`No folder · sonnet · started`) opens under
  the chips with Go to agent, and pressing the chip again opens no second agent. (`petideas.tsx`, 07192f191)
- [ ] (arcterm) **Session ideas: the popup's width.** With no ideas waiting the quiet card is 332 px wide; decide the last
  idea or scan a new one → it widens to 420 px while ideas wait and goes back after, and at 420 px the four chips wrap
  onto as many lines as they need without being cut at the panel's edge. (`petpeek.tsx`, 07192f191)
- [ ] (arcterm) **Session ideas: the project picker.** With 8 or more projects waiting for a scan, press the offer card's
  `project ▾` → a frosted picker springs open under it (not the context menu), the filter field focused; type `siem` →
  the list narrows to the SIEM projects, `website/apps/website` included (its path matches); ↑ ↓ move the highlight,
  Enter picks (the button reads `Scan SIEM/src`, the picker closes, focus is back on `project ▾`), Esc closes, a press
  outside closes, and a press on `project ▾` while open closes it. The menu lists no `arc-wt` run trees
  (`03d550fc-t-1`), temp folders or `verify-history-*` seeds, and `~` for the home folder. Seen on the dev app with
  fixtures (step 10c of `sessionideas-brief`, motion-traced: opens in 7 frames, closes in 8, turns upward near the
  window's bottom); not yet over your real sessions. (`filtermenu.tsx`)
- [ ] (arcterm) **Session ideas: a chip press is logged.** Press any chip, then read the end of `waveapp.log` (the
  installed app's `%LOCALAPPDATA%\dev.arc.app\data\waveapp.log`) → one line `sessionideas: pick chip=<kind> at=<n>
  text=…`. Not observed: the line's text is unit-tested, the call through `getApi().sendLog` was only read. (`petideas.tsx`,
  07192f191)
- [ ] (arcterm) **A pinned folder comes and goes like any folder.** In the Agent tree, right-click a project folder →
  Pin folder: a small pin appears at the row's far end. Close its last agent and terminal: the folder stays, its name
  turns faint (a soft colour change, not a jump). Start an agent there from its menu: the name eases back to the plain
  colour. Unpin folder on the empty one: the rows below slide up into its place as when any folder empties, nothing left
  at an in-between height. (`agenttree.tsx` FolderRow, `agentsidebarmodel.ts` projectTree `pinned`; the
  `agent-tree-pinned-folder` scenario checks the end states, not the motion.)
- [ ] (arcterm) make the judge mark's What's new shot with `node scripts/whatsnew-shot.mjs judge-mark` and put it on the
  CHANGELOG line: with a dev app showing a judge round's mark in an agent's Chat (a pair started from an older reply: the
  ⚖ line under that reply and the accent bar beside the turns after it), run the command and replace the
  `<!-- shot: none -->` of the "judge round's mark" line under Unreleased → Added with the comment it prints.
  `whatsnew.test.ts` then checks the file. (`CHANGELOG.md`)
- [ ] (arcterm) **The ⚖ menu grows from its button.** In an agent's Chat, hover a reply and press ⚖ (Judge this reply):
  the menu fades in and scales up from its top-left corner, the corner at the button (not from its middle and not from
  the header), and Escape takes it back the same way into the button's corner; two quick presses end closed, never a
  second copy. With reduced motion on it comes and goes at once. (`pairjudgemenu.tsx` JudgeReplyMenu; the `pair-header`
  scenario's menu-motion step samples the opacity over frames, not where the scale starts.)
- [ ] (arcterm) **A judge round's mark: the motions the Final does not sample.** Start a pair from ⚖ under a reply of a
  working agent's Chat: while the ⚖ line ("The judge is reading this reply · N s" with a spinner) opens under that
  reply, the rows above it do not shove. When the judge answers, the line's words cross-fade to "The judge round
  starts here" in about 140 ms and its height follows on the spring. Send the agent another message while the round
  lives: the bar reaches the new row once that row has opened (the clip of a row that is arriving hides it until then).
  The `chat-judge-reply` scenario's `motion` step samples the rest in the Final, on frames: the line's own height and
  opacity as it opens under a drawn reply, the bar's colour easing from the accent to grey, the ended line's words
  cross-fading, and the reduced-motion end states. It does not sample the rows above the line, and it goes from
  reading straight to ended, so the live state's cross-fade is not seen. (`chatpairmark.tsx`, `chatconversation.tsx`)
- [ ] (arcterm) **A slow-ending sleep still sleeps.** Next time waveapp.log shows `agent sleep: … is asleep, but pids …
  had not ended`, that agent's row reads asleep (not exited), and Wake or a Chat message brings it back on its
  conversation, the log showing `agent wake: block …: ending pids … left from its sleep` first when they still ran. A
  Chat message to an agent whose terminal has no process wakes it (`[chat-send] restart block=…`) instead of a toast
  saying to press Enter. (`wshserver_agentsleep.go` endLeftovers, `chatpending.ts` processGone)
- [ ] (arcterm) **Council Figures: each source is a chip.** Open a council Report whose Số liệu cites a file: under
  each chart and in the Nguồn column the source is a small bordered chip, the file's name in link blue (sans, not mono)
  and its lines muted after it; hovering shows the full `path:lines`; a very long name is cut short with `…` at a
  narrow pane, never pushing the chip past it. (`councilreporttablesview.tsx` Sources)
- [ ] (arcterm) **A Chat visual has no border.** In an agent's Chat, a reply with an `arc-visual` block: the page sits
  flush with the reply's text, no box around it and no line under the small Shapes icon; a tall one still shows its
  expand button at the right of that row. (`chatvisualview.tsx`)
- [ ] (arcterm) **"draft" on the open row.** After a build, type a few letters in the Chat box of the agent you have
  open → its row in the Agent tree reads *draft* on its second line at once (a split cell: after the name); clear the
  box → the word goes. (`agenttree.tsx` drafted, fix/draft-word-on-open-row)
- [ ] (arcterm) **Open in split from Library → Boards.** After a build, in Library → Boards hover a running agent's
  board → a split icon shows beside the trash; click it → the Agent surface opens with the board in a cell right of its
  agent, and a row for it in the Agent tree that stays after you switch away. Open an ended agent's board → the header's
  Open in split puts it beside the agent in focus, its header chat shows "(ended)", and picking a live chat there lets
  you ask. With no agent running the button is greyed with "Start an agent first". Branch `feat/library-board-split`.
- [ ] (arcterm) **A failed Final counts its failed steps.** After a build, open run 4287b55b's Final verification row
  (or any run whose Final failed on CDP steps) → the Agent tree row reads "Final: 1 of 51 steps failed · round 2", the
  Final step reads "1 of 51 failed · 3m 22s", the stage header and the DAG node read "round 2 · Final: paired-button
  failed", and each shows its whole text on hover when cut short. Narrow the window until the step cells are tight: the
  Final cell's text truncates inside its border. `task verify:ui -- final-stage` (B4, B5) checks the end state; neither
  was run. Branch `final-step-tally`.
- [ ] (arcterm) **Council Figures: sources once per file, labels not repeated.** Open a council report whose Số liệu has
  a comparison with labels sharing their opening words (e.g. the secbench audit one, "submit secbench đậu tier-1 trên
  ca …"): the shared words sit once above the bars and each row shows only `blocked_clean`, `crash_before_sink`, …
  whole, not cut with "…"; under each chart the source reads `obsidian_harness/…bilingual.html:713, 714, 715` once
  (the folder fainter), with no exact duplicate like `:795 · :795`. Narrow the pane: labels and paths wrap, nothing
  pushes the value column out. `councilreporttablesview.tsx`; `task verify:ui -- council-report-tables` for the end
  state.

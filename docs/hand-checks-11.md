# Waiting on a hand check, part 11

Older lines of `docs/hand-checks.md`, moved here when it grew past its size; the rules and the list of parts
are in that file. Tick a line here when it holds, then remove it; a part left empty is deleted.

## 2026-11-27

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

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
- [ ] (arcterm) **The ⚖ line grows in with a pair and folds away when its round ends.** In the Agent tree, pair two live
  agents (⚖ under a reply of the working agent's Chat): the line under the working agent's name ("judge reviewing · 1.2M", the new
  count at its end) grows in on the spring (height 0 → auto, the opacity on the micro ease) and the rows below it slide
  down with it, and the judge never has a row of its own. Let the pair stop, then type in the working agent's own Chat:
  the line folds away on the same spring, the judge's tab goes to sleep and does not show as a row, and Library lists
  the ended pair. Wake the judge (a message to its tab, or ⚖ under a reply → Wake): it is a plain row again, with no line.
  With reduced motion on, the line comes and goes at once. (`pairjudgelineview.tsx` PairJudgeLineSlot; the `pair-tree`
  scenario's line-live and round-ended steps read the end states, not the motion.)
- [ ] (arcterm) **A pair's relayed reply in Chat: the two disclosures, and the name that opens the sender.** In a live
  pair, open the working agent's Chat at its first relay: the brief is one muted line on the right ("arcterm paired
  this agent with … · Brief"). Press Brief: the brief opens under the line on the spring (no bounce, about the speed of
  the Pair list's Agreed fold) while the chevron turns a quarter in about 140 ms; press again and it folds the same
  way; press twice fast and it ends open or folded as a slow press would, never stuck half-open. Do the same with
  Text as relayed at the foot of the judge's card. With reduced motion on, both open and fold at once. Then press the
  judge's name in its card: the judge's conversation opens (ctrl-click peeks it), and in the judge's own Chat the same
  goes for the working agent's card. A reply whose sender is not in the live pair shows its name with no arrow.
  Seen only as end states by the `chat-pair-relay` scenario's Final (its step 6 samples the brief's fold); an agent in
  an Arc run does not watch it. (`chatpairrelay.tsx`)
- [ ] (arcterm) **A finished council's Discussion ends on a closing card.** Open a done council's Discussion and scroll
  to the end: the last thing is a card with "Council done", the Report's answer in bold, the settled counts (`N agreed ·
  N still open · N ruled out`) and Open Report, which opens the Report. Then watch one end while its Discussion is open:
  the card grows in under the last message (no snap) and the channel stays at the bottom; Summarize again on it folds
  the card away while the summary runs. Run `task verify:ui -- council-discussion` (its new "closing card" check).
- [ ] (arcterm) **A changed decision's added sentences read as one block.** On a brainstorm whose decision changed after
  you confirmed it (the Builder check card in Chat, and the Brainstorm tab's review), the sentences it gained after the
  edited `~` line show as one `+` block, not a box each, and "(/compact, ! lệnh, /btw)" stays whole inside its sentence.
- [ ] (arcterm) **The judge card's reading → done cross-fade.** On the last message's judge card (a choice question
  turn), press "Đọc code rồi chọn" and let the deep judge finish (or Stop and press it again): the reading text fades
  out while the done text fades in, in about 140 ms, and the card eases from its reading height to its done height on
  the spring, with no frame where it is taller than both (the leaving text no longer stacks above the new one) and no
  jump when it settles. With reduced motion on it swaps at once. The Final's `chat-judge` step 11 samples the
  children and their opacities, but not the card's height. (`chatjudgeline.tsx`: `JudgeRow` and `JudgeCard` hand their
  `ref` to AnimatePresence's popLayout.)
- [ ] (arcterm) **Resume and Judge again on a stopped pair's ⚖ line and Library page.** In a real pair stopped at the
  token cap, hover the working agent's row in the Agent tree: Resume (named after the judge's cap, "Resume · judge
  +3.0M") fades in over the right end of the ⚖ line (about 100 ms), and it fades in on a Tab to it too. A press leaves the
  conversation closed, and once the pair relays the button goes. When the server refuses a Resume (the pair already went
  on from another window), its words grow in as a line under the ⚖ line, and under the header on Library's pair page, on
  the spring the pair's messages use; they leave the same way when the next press works. After a no-new-points pause the
  line and the Library header show Judge again, and a press opens the conversation with `@judge ` in the focused
  composer. With reduced motion on, the error lines land at once. (`pairjudgelineview.tsx`, `pairreadpane.tsx`; the
  `pair-tree` and `library-pairs` scenarios read the end states, not the motion.)
- [ ] (arcterm) **A PowerShell command run twice reads as running.** In a plain PowerShell terminal (5.1 and 7), run
  `sleep 30`, stop it with `Ctrl`+`C`, then run `sleep 30` again: the second run shows as running in the sidebar and in
  the Overview's Running list until it ends. The prompt still colours by the last command's status, and Up arrow still
  recalls history. (`pwsh_wavepwsh.sh`; `project-overview` step 7 checks the end state.)
- [ ] (arcterm) **The pause card arrives like a message.** In a live pair with its conversation open, let the pair
  pause (the judge writes `no new points`, or the token cap is reached): the card grows in on the same spring as the
  messages around it, whole from its first frame (head, summary when the judge wrote one, then Waits on you, Still
  open and Agreed), with no flash of a bare "Paused: …" line before it. Close and reopen the conversation: the card is
  already in place, with no entrance. With reduced motion on, it lands at once. (`pairpausecard.tsx`; the `pair-conversation` scenario reads the end states, not the motion.)
- [ ] (arcterm) **A run queued from the command line shows on its brainstorm's card.** After installing a build with
  c3db2a0b5, `wsh runs dequeue q-a7fa`, then from the pair-judge-round brainstorm's tab queue it again with
  `wsh runs start "Build Vòng judge treo dưới worker as specified in …2026-11-26-pair-judge-round-design.md…" --after
  247706be`. `wsh runs start` prints that it linked the brainstorm. The card in Chat says "Queued after …" in place of
  Approve, and the header no longer says asking. When the entry starts, the agent receives `brainstorm: run <id>`.
- [ ] (arcterm) **All initiatives scrolls inside its box.** In Jarvis with more than 12 initiatives, press "+N more":
  the box grows to 12 rows and the rest scroll inside it (the wheel stops at its ends rather than moving the Brief),
  the opened row's accent ring is not cut at the edges, and moving the keyboard cursor past row 12 scrolls the box to
  keep it in view. "Show less" folds back to 6.
- [ ] (arcterm) **Rail stays put on a switch back.** Open two agents that each have changed files and a session with
  spend, view each once, then click back and forth between them in the Agent tree: on the Agent details rail's
  Overview, Files changed, the branch/worktree line, the Session line (spend, model label) and the cache countdown
  swap to the other agent's at once, with no skeleton and no line dropping out and coming back. A freshly opened agent
  still shows the skeleton on its first view. (`rail-switch-back` scenario reads it frame by frame.)
- [ ] (arcterm) **GitHub accounts: a real push under a root uses that account's token.** In Settings → Agents → GitHub
  accounts add an account with a real token and a folder holding a repo whose remote has no token in its URL, then run
  `git push` in that repo from a terminal outside arcterm. You should see the push go through as that account (the
  commit carries its name and email, and the Keychain on the Mac holds the token under its login). A repo outside every
  root still pushes as the Default account.
- [ ] (arcterm, Windows) **GitHub accounts: Git Credential Manager stores and serves the token, and gh still serves repos
  outside the roots.** Add an account, then `git credential fill` for `github.com` with that username from a repo under
  its root: you should get the token Credential Manager keeps (not a line of `~/.git-credentials`). In a repo outside
  every root `git push` still works through gh.
- [ ] (arcterm) **GitHub accounts: motion.** In Settings → Agents → GitHub accounts watch + Add account: the new row
  should spring open (`springReveal`) rather than jump in, and the add dialog and the fix list should open and close
  with the usual modal motion (no flash, no stuck backdrop).
- [ ] (arcterm) Compact paste chip in Chat: send a message with a multi-line paste → in your bubble the paste is a small
  chip as wide as "Pasted · N lines" (not a full-width card); click it → it widens to the bubble and shows the body
  with a copy button; click again → back to the chip. `chattagblock.tsx`, uncommitted on main.

## 2026-11-25

- [ ] (arcterm) **Open a tool in a split.** With one agent in view, press `Ctrl+Shift+O`, pick a tool and press
  `Ctrl+Enter`: the picker closes and the tool appears as a cell under the agent (agent top, tool bottom), focused,
  the cell growing in with the grid's own motion rather than snapping; the footer reads `Ctrl Enter Open in a split`
  and wraps instead of overflowing in a narrow window. With 4 cells already, the tool opens in the centre instead.
- [ ] (arcterm) Library pairs: take the What's new shot of a pair nested in Conversations and promote the Added line to
  big. In the dev app seed an ended pair under a session, open Library → Conversations, then
  `node scripts/whatsnew-shot.mjs library-pairs --selector "[data-agent-history]"` and move the Added line in
  `CHANGELOG.md` ("Judge pairs stay readable after they end…") to `<!-- big -->` with the `<!-- shot: … -->` it prints.
- [ ] (arcterm) **The Judge and Council chips swap Conversations' list.** In Library → Conversations press Judge, then
  Council, then both, then each off: the nested list and the flat one of pairs, councils or both trade places with one
  fade of the cards (no jump, no card drawn twice); the status filter and the All activity row leave and come back with
  the list under them staying put; the Council chip alone brings the folded benchmark box above the list, and opening
  it never pushes the list off screen. `conversationhistory.tsx`; `library-pairs` reads the end states, not the motion.
- [ ] (arcterm) **The detail pane changes between a session, a feed and a pair.** In Conversations click a session, then
  a pair's `└` line under a card, then the pair's transcript link in its foot, then All activity: the right side
  cross-fades once each time (never the feed flashing between), the pair reads edge to edge with its Decided column
  whole, and at a 1000 px wide window the thread stays readable and nothing clips. `conversationhistory.tsx`,
  `pairreadpane.tsx`; `library-pairs` shows the end states and the shots, not the motion or the narrow window.
- [ ] (arcterm) **Library's tab underline slides.** Open Library and click Conversations → Boards, then press `1`–`3`
- [ ] (arcterm) **Chat's pair cards move as they should.** In a live pair, open the working agent's Chat while it writes
  a reply that ends with its ```` ```arc-pair ```` list: no code box shows while the fence is open, and the Pair list card
  enters on the spring once it closes. Press Agreed and an older list's row: each opens and folds on the spring, its
  chevron turning. Press a chip: the chips crossfade to `You answered <chip>` with the box keeping its height. With
  reduced motion on, all of it lands at once. (`task verify:ui -- chat-pair-blocks` checks the end states.)
- [ ] (arcterm) Kael sync 11-25: **the What's new picture for drawings is committed.** The `boards-split` step 18b
  writes `public/whatsnew/<next minor>-board-drawings.webp` on a Final run (this run's agents ran no CDP, so the file
  is not in the tree yet). After the Final run: commit that picture, and in `CHANGELOG.md` replace the
  `<!-- shot: none -->` on the big "each drawer answer on a board is its own titled drawing" line with
  `<!-- shot: <that file name> -->`; `npx vitest run frontend/app/cockpit/whatsnew.test.ts` must pass. Plan:
  `docs/superpowers/plans/2026-11-25-kael-sync-boards-drawings.md`.
- [ ] (arcterm) Kael sync 11-25: **a new drawing eases into view in the narrow board cell, and reads smooth.** The
  `boards-split` step 18b samples the scroll once per frame and checks it moved over several frames and ended with the
  drawing's frame inside the canvas, but nobody has watched it. Open a board beside Chat (not expanded) and have its
  agent run `wsh board draw` (or ask the drawer for a drawing) → the view glides to the new drawing as it lands: no
  jump, no stutter, no blur left on the shapes once it stops, and the new chip in the row above enters as it does. With
  the view on an earlier drawing instead → the view stays still and the new chip reads "new". Pick a chip → the same
  glide. With reduced motion on in the OS → the view jumps to the drawing instead of gliding.
- [ ] (arcterm) Kael sync 11-25: **the other moves of the view between drawings.** None of these has been watched (the
  `boards-split` steps 18c and 18e check where the view ends, 8b checks the part's own moves). On a board whose view is
  on a drawing: an edit that grows that drawing (ask for a change to it, in Edit) → the view glides out to the grown
  drawing and does not jump. Open an "Earlier drawings" that reads by parts, read a part, then press Esc or the header's
  "Whole drawing" → the view glides to the whole drawing in view (not to the whole board). Click one chip and, before it
  finishes, another → the view turns toward the second from where it is, with no jump back to the first. Land a drawing
  while the view is easing to a pick → the same.
- [ ] (arcterm) Kael sync 11-25: **the drawings row's current marker slides, and a new chip enters.** Open a board
  with two or more drawings and click chips one after another → the grey marker under the current chip slides from one
  chip to the next (no jump, no second marker, none left behind); a drawing that lands while the row is visible → its
  chip fades in at the row's end rather than popping. Open the same board in Library and beside Chat at once → each
  strip's marker slides in its own strip only. Scroll sideways in a row with many chips → the current chip stays in view.
- [ ] (arcterm) Kael sync 11-25: **Show in view mode outlines the shapes without handles.** Open a board (view mode,
  no drawing toolbar) and press Show on a drawn turn → the turn's shapes get a selection outline, with no resize or
  rotate handles and no style panel beside the canvas, and the ask box still says "Press Edit to ask about shapes". Press
  Edit → the toolbar comes back, the outline gets its handles only when you select the shapes yourself, and Edit again
  clears the selection. (`boards-split` 17b checks the selection and that no panel is drawn, not how the outline looks.)
- [ ] (arcterm) Kael sync 11-25: a real agent's quick run nests under it in the Agent tree (the CDP scenario
  `run-nesting` draws a dev-mock roster with seeded runs, and this run's agent ran no CDP, so neither the live nesting
  nor the row's move has been watched). In an agent's tab have it run `wsh runs start --project <dir> "<goal>"` → once
  the run's tab appears, its row sits right under the agent's row (and its checks), one tree guide in, and the folder's
  count includes it; `j` from the agent goes to it next. Have that run's agent run `wsh runs start` too → its
  run sits under it, two guides in. Close the first agent's tab → its run moves back to a top-level row with no jump
  or flicker (the row keeps its key, so it slides), and the run under it is one guide in. A run started from the New
  dialog stays a top-level row. Spec: `docs/superpowers/specs/2026-11-25-kael-sync-agent-tree-nesting-design.md`.
- [ ] (arcterm) Kael sync 11-25: a real run of 4 tasks or fewer takes the fast track end to end (the Go tests own each
  engine claim; the CDP scenarios `kael1125-fast-track-label` and `kael1125-fast-track-views` draw seeded runs, so no
  real run's agents have been watched). Start a plan-file run of 2 to 4 tasks with a Verify line → the plan review has
  one **Light review** row (not Full review and Second pass) and the workers start on its pass; no task ever reads
  **Reviewing**, and the lead's next wake carries a `t-N merged` line per task (with a caveat line for each non-empty
  Differs from plan, Not verified or Found not fixed) instead of `passed review`; the final stage lists **End review**
  before the Verifier and the run's row reads `end review alongside` while Check or Verify runs, then
  `final: end review reviewing` if it is the only one left; the run sheet's settings line has the `fast track` chip,
  `wsh runs show <run-id>` ends its route line with `  fast track`, and Chat's run card head reads
  `Orchestrator run · fast track`. A 5-task plan shows none of that. Plan:
  `docs/superpowers/plans/2026-11-25-kael-sync-fast-track.md`.
- [ ] (arcterm) Kael sync 11-25: a light review that fails, and the lead's amended resubmit dispatches. Run a plan of 3
  or 4 tasks with a flaw the reviewer will catch (a task that edits a file its Files line leaves out, or a Depends with
  a reason that does not hold) → the Light review row fails and the lead wakes with its findings; it revises the plan
  and runs `wsh jarvis dag submit` again → the workers start with no second review, the review row and the Sessions row
  read `amended by the lead` (not `failed`), and `wsh jarvis dag status` says `the light review failed, then the lead
  amended the plan and it dispatched`. Also resubmit a plan grown past 4 tasks after a failed light review → it leaves
  the fast track and opens Full review and Second pass. A light reviewer you stop twice reads lost and is replaced by a
  new Light review row, up to three.

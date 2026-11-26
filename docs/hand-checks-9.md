# Waiting on a hand check, part 9

Older lines of `docs/hand-checks.md`, moved here when it grew past its size; the rules and the list of parts
are in that file. Tick a line here when it holds, then remove it; a part left empty is deleted.

## 2026-11-20

- [ ] (arcterm) Diagram zoom and Copy image in the installed app (WebView2): ask a Claude agent to explain a flow and
  check it answers with a mermaid diagram, not ASCII; hover the diagram, Copy image, paste into Paint or a chat: the
  whole diagram, sharp, on a dark ground. Click it: the viewer opens fitted, the wheel zooms toward the cursor, a drag
  pans, Escape closes it without leaving the surface. Tried only in headless Chrome. (`feat/chat-diagrams`)
- [ ] (arcterm) **Escape turns focus read off wherever the focus is** (`focusReadEscapeTarget`, agent:focus-read-off).
  On the Agent surface, turn Chat's focus read on for an agent (asleep, and awake), then click its row in the tree, the
  header, or the Wake box, and press Escape: focus read turns off and the surface stays; a second Escape leaves to the
  Cockpit (or stops a working turn). In the chat box Escape stays the box's own. Not tried in the app.
- [ ] (arcterm) **Usage opens an old session's transcript** (`fetchAndHandSession`, fix/usage-open-old-session). In
  Usage → By session, click an ended row from a few days back (one past the newest 100 sessions, such as
  `Paper_v1_benchmark_bilingual` in thesis): Library shows its transcript with Resume, not "This session is not in
  the archive yet". Not tried in the app.
- [ ] (arcterm) **A council card wraps a long path** (`councilsummary.tsx`, `councilsheet.tsx`). Open a council whose
  First step names a long path with no spaces (`obsidian_harness/20261113_paper_v1_be…`): it breaks inside the card
  in the report's direction cards and in Jarvis's council sheet, nothing runs past the edge. The Report's cards are
  checked in the dev app by `council-summary`'s long-path step; Jarvis's council sheet is not tried.
- [ ] (arcterm) **Typing below a one-question ask answers it** (`permissionHolds`, fix/box-answers-ask). In a Claude
  agent's Chat, have it ask one AskUserQuestion (a plan Handoff is one): the box shows no "Answer the permission prompt
  first" line, and words typed and sent go as the typed answer (the TUI's "Type something"), not "Queued · sends once
  you answer". A Bash permission prompt still holds the box. Not tried in the app: only the pure rule is tested.
- [ ] (arcterm) **The compaction summary opens in a rail tab** (`RailCompactionPane`, feat/rail-summary-tab). On an
  agent that compacted, click the Compacted line in the Agent details rail: a Summary tab (fold icon, x) opens
  selected, the panel widens to the File width, the summary scrolls, and the grip drags its width. x (or a middle click)
  closes it back to the tab it came from. The Council tab widens with the same grip. Checked in the dev app by the
  agent-chat step 80 and rail-council-tab step 2 scenarios.
- [ ] (arcterm) **A fork from History shows its conversation in Chat** (`forkLaunchOpts` forkOf/forkedAt,
  fix/history-fork-chat). On a project's Overview, right-click an ended Claude session in History → Fork (or Fork in
  Quick look): the new "<title> (fork)" agent's Chat shows that conversation at once, not "New conversation"; send it a
  message and the history stays with the message under it. Unit-tested only, not tried in the app.
- [ ] (arcterm) **A run under plan review reads "Plan review · 7 tasks"** (`dagProgressLabel`, `8ffa290f1`). Start an
  orchestrator run from a plan file; while its reviewers work, the run's row in the Agent tree reads "Plan review ·
  N tasks", and its lead's row, where the stage word gives way, still shows "N tasks", never "0/N". Once workers
  start it turns to "Working · 0/N".
- [ ] (arcterm) **A council started through PowerShell draws its card in Chat** (`transcriptprojection.ts` shell
  tools, `33c6f49d0`). After installing a build with it, open the mit-thesis agent `773ab9d0` in Chat: council
  `0f74c5be` ("Truc chi phi cross-model…") shows its council card where the report came back, and the reply that
  starts "Council xong." draws in the council panel. A PowerShell command's row in Chat also opens its output, like
  a Bash one.
- [ ] (arcterm) Resume reads resuming, not working (`pendingToVM` in `frontend/app/view/agents/agentsviewmodel.ts`;
  `fix/resume-working-flicker`). Library → Conversations → resume a long Claude conversation with no message. While it
  loads, its tree row ends in a muted "resuming…" with no working dot, the header pill reads "resuming" in muted ink
  with no Stop, and Chat shows the old conversation with a muted "Resuming…" line under it. Once Claude Code is at its
  prompt the row reads idle and the Agent badge does not count it as unread. A resume with a message (Wake with text)
  still reads working.
- [ ] (arcterm) Chat's Working line holds through a queued message (`nextWorkingHold` in
  `frontend/app/view/agents/chatlive.ts`; `fix/resume-working-flicker`). While a Claude agent runs a long tool, send it a
  message from Chat (it reads Queued). When the turn ends and Claude Code takes the message, the Working line stays up
  without blinking out, and the message lands in place without jumping down. Esc on a turn with a queued message: the
  Working line leaves within about 4 s.
- [ ] (arcterm) **A refused tool call's Tool failed line says why** (`transcriptprojection.ts` `errorLine`). Have a
  Claude agent call `Monitor` with only a `description`: its Tool failed line in Chat reads "InputValidationError:
  exactly one of command or ws", not "InputValidationError: [". Same on the phone page (`projectors.js`).
- [ ] (arcterm) **`wsh board draw --context-file`** (`wshcmd-board.go`). From a PowerShell agent, write a briefing of
  several lines with Vietnamese accents and a double quote to a file with the Write tool, run
  `wsh board draw --board t --context-file <path>`: the board is drawn, and its drawer's prompt keeps the lines and
  accents. `--context x --context-file y` refuses with "not both".
- [ ] (arcterm) Fork in Chat, three parts (`pkg/agentsessions/fork.go` forkCwd; `chatfork.ts` forkShowsSource,
  turnInFork; `chatpane.tsx`), fix/fork-chat. (1) In a conversation synced from the Mac (mit-thesis "Đồng bộ history
  với Windows", whose early turns name `/Users/ttqteo/...`), Fork from here on a reply among the Mac turns → the fork
  starts in `d:\work\mit\mit-thesis` with no folder trust prompt, and its transcript lands under
  `~/.claude/projects/d--work-mit-mit-thesis`, not `C--Users-me`. (2) The fork's Chat shows that history at
  once (no "New conversation"); send it a message → the history stays put and the message lands under it, and after
  that a `/clear` in the fork shows an empty conversation, not the old history. (3) While its first turn works, the
  Working line reads seconds, not hours. Separately, not fixed (could not reproduce): on 11-20 the safeguards'
  "Session paused" menu in that fork showed in its Terminal but no card in Chat, although `tuiDialog` reads a screen
  built from the screenshot; next time it happens, note the agent's state and whether a permission or ask card was up.
- [ ] (arcterm) Kael sync 11-19: two Claude agents on one checkout, each Diff lists only its own files
  (`pkg/agentedits`, `GitAgentEditsCommand`; `frontend/app/view/agents/agentchanges.ts`). The CDP scenario
  `diff-agent-edits` fakes the transcript, so no real Claude session has been replayed. Open two live Claude agents on
  the same project checkout (no worktree) and have each edit and write a different file, one of them with an Edit to a
  file the other has also touched. Focus the first agent → Diff opens on **Agent's edits** and lists only the files
  that agent edited or wrote, with the other agent's files absent (they show under **Since session start**); its card
  chip, the Agent details rail's Files changed and the Hub peek's Changed files all count those same files. Repeat for
  the second agent. A file one of them edited with no Claude Code backup (a session older than its file-history) carries
  the dashed-circle mark, and one whose Edit no longer applies because the other agent changed it carries the warning
  triangle; make one agent run a Bash `sed -i` on a file → the caption reads `· 1 Bash call may have changed files not
  shown`. A fresh Claude agent that has edited nothing lists no file and its card shows no changes chip.
- [ ] (arcterm) Kael sync 11-19: the Agent's edits / Since session start switch keeps its choice across surfaces
  (`diffrangechoice.ts`, `RangeSwitch` in `diffpanel.tsx`). On a Claude agent's Diff, click **Since session start** →
  the list grows to everything changed in the checkout since the session began; go to Cockpit (or Code) and back to
  Diff → it still opens on Since session start for that agent, and a second Claude agent still opens on **Agent's
  edits**. Click **Agent's edits** again and leave and come back → it stays. A pi agent's Diff shows no switch and opens
  on Since session start. The choice is kept in memory only, so it is gone after a restart. Scenario-tested only.
- [ ] (arcterm) Kael sync 11-19: a config file replaced while arcterm runs shows up without a restart
  (`pkg/wconfig` `readFullConfigSettled`, `rereadIfChanged`). With arcterm open, register a project from a script that
  rewrites `projects.json` by writing a temp file and renaming it over the original, and do it a few times in a row,
  quickly → the Agent tree and the project picker list the project each time with no restart, and none of the
  registrations is missing after a few seconds. Windows is where the rename can leave the file refusing its next open
  ("used by another process", a virus scanner or indexer holding it); the Go half is unit-tested with a fake refusing
  read only, never against a real held file.
- [ ] (arcterm) **Council seat role on the Map's cards** (`councilseatrole.tsx`, `councilmap.tsx` `Card`). The first
  step's cards were checked by CDP (`council-discussion` "seat role"); the Map's were not. Open a paper council (Reviewer
  A, Reviewer B, Humanizer) on the Map: each card reads its focus (`novelty`, `baselines`) and its brief under the name,
  Humanizer its brief alone, two lines at most, and the hover shows the whole brief.
- [ ] (arcterm) **chat-redesign 14c and agent-chat 1a2 failed beside the chip typeahead** (2026-11-20, branch
  `feat/chat-chip-typeahead`: 113/115). 1a2: the opened tool fold held 4 rows (Read, Edited, Checked the working tree,
  Created) where it wants 2. 14c: a click on a brainstorm card's option left its row reading "You replied", not "You
  picked". Neither card uses the suggest `Chip` or the box's ghost text, and the run on the base commit to compare was
  stopped for low memory. Run `chat-redesign agent-chat` on main at a quiet time: both failing there means they predate
  the typeahead; passing there means look at it.
- [ ] (arcterm) **Chat's `@` picker, top level only** (`refmention.ts` `runRefs`/`topLevelAgentIds`,
  `refmentionstore.ts`). In a chat of a project with an orchestrator run that had a plan review (arcterm's "Kael sync
  11-19"), type `@`: the run is one row (`run:733ad992 · … · orchestrator`) and none of its "You are the plan reviewer
  for run …" quick runs shows; while a run is live, its workers and reviewers are not agent rows either, only its lead
  (or the run) and the plain agents the Agent tree lists at its top level. Commit e2b0c6b45.
- [ ] (arcterm) **The Agent panel's Council tab** (`agentrailpanel.tsx` `RailCouncilTab`, `railcouncilpane.tsx`,
  `railcouncil.ts`, binding `agent:council-chat`). The CDP scenario `rail-council-tab` passes (tab, chat, Show more, Open,
  `c`, Send to the others, Read the report, on fixture councils); still by hand, on a real council: have a live agent run `wsh council start …` (through Bash, and once
  through PowerShell on Windows): the Council tab fades in after Transcript with a green dot, and Chat gets the council
  card. On the tab: the messages come in as the seats write, the list follows them while you are at the end and stays put
  when you scrolled up, a long message opens with Show more, Open shows the full Discussion, and a message sent from the
  box reaches the council. At the pause the amber row offers Review in full; with held drafts, Send to the others sends
  them; once done, Read the report opens the Report. On an agent with both a canvas and a council, `c` still opens the
  canvas.
- [ ] (arcterm) **A Vietnamese board reads in Shantell Sans** (`frontend/tauri/vite.config.ts` `fontOverrides`: Nunito's
  five files served as Shantell Sans). Open the `huong-luan-van` board (Library → Boards) in the dev app and in an
  installed build (the bundle copies the files at build time): every label is in the hand-drawn Shantell Sans, ơ ư đ ạ ế
  drawn in the same face, no line cut off and no label sitting high or low in its box. Checked only that the dev server
  serves the Shantell files at Nunito's paths; not seen on a board.
- [ ] (arcterm) **A board drawn from PowerShell gets its Chat card, and Vietnamese reads in Nunito**
  (`transcriptprojection.ts` `isShell`, `boardmodel.ts` `withReadableFont`, `boardconvert.ts` `refitNunitoText`). In a
  Claude agent on Windows, have it run `wsh board draw` through the PowerShell tool: its turn ends with the board card,
  and Open splits the board beside Chat. Open the `huong-luan-van` board (Library → Boards): every label is in Nunito,
  with no mixed glyphs and no line cut off ("tới nơi", "đang cượ…" whole), and the file saved that way. Unit-tested and
  typechecked only, not seen in the app.
- [ ] (arcterm) **A board draws bar and line charts** (`pkg/boarddrawer/chart.go`, the `chart` entry in
  `drawer-prompt.md`). On a board, Ask "add a bar chart: baseline 0.42, LLM 0.61, agent 0.70", then "and a line chart
  of the same": each lands as one group (frame, bars or a line with dots, zero line, values, labels), the bars to scale,
  and drags as one. Check that Excalidraw's skeleton conversion keeps the group, the fill and the text size. Go-tested
  only, not seen in the app.

## 2026-11-19

- [ ] (arcterm) **Boards, a real drawer turn** (`pkg/boarddrawer`, `wsh board draw`; the CDP scenarios stub every
  board RPC, so no drawer has run in them). From a live claude agent in a registered project, ask it to draw how
  something works, or run `wsh board draw --board demo --context "<a short briefing>"` yourself: the command prints
  `Drawn on board "demo": +N shapes, …`, the agent's turn in Chat carries a card (name, shape count, Open), and Open
  splits the board beside Chat with the drawing on it. A second one-line `--ask` changes the same board, and
  Ctrl+Z on the canvas removes that turn's shapes in one step. With another agent focused, a toast says the drawer
  drew on `demo`, with Open.
- [ ] (arcterm) **Boards, a forwarded question** (`pkg/wshrpc/wshserver/wshserver_boardforward.go`). On a real board,
  select a shape and ask something the drawer can't answer by drawing ("why does this call that?"): the turn reads
  forwarded, the agent's Chat shows it as your message under a chip `from demo · on <shape>`, and when the agent's
  turn ends the turn reads `forwarded · answered in Chat` (expand the board, or Library → Boards, to see its reply
  copied under the question). Also with the agent mid-turn (the forward queues behind it) and with a question or
  permission prompt open (the turn waits on it, then goes once it is answered).
- [ ] (arcterm) **Boards, a sleeping agent woken by a forward.** Put the agent that drew the board to sleep (Sleep in
  the Agent tree), then ask a question on its board (Library → Boards opens a sleeping agent's board beside its Chat
  too): the agent wakes, as a message you type in Chat would wake it, and the question arrives as above. Then close
  the agent's tab: Library → Boards keeps the board read-only, with `The agent ended, so you can't ask here`.
- [ ] (arcterm) Council figures on a real council (4e9f4589d6d9c6f8): the takeaways read right, and the argument map
  stays legible at 22 ideas
- [ ] (arcterm) After installing, run `wsh effort backfill-proposed` once: the backlog since 2026-11-13 moves to To
  review (about 56 chunks), and Needs you shows none of them. Then have a run's lead run
  `wsh effort create "<title>" --chunk "<issue>" --proposed` from its terminal through the real `wsh` and wavesrv (the
  cobra flag wiring is only compiled and vetted, the RPC handler and the prompt text are unit-tested): the chunk
  appears in To review under that run, not in Needs you.
- [ ] (arcterm) **Start a real run from ticked To review items** (`runreviewstore.ts` `startRunReview`,
  `wshserver_runchunks.go`). On the Brief tick two or three items of one project, press Start, pick the run type and
  start it: the chunks read `pending` on their initiatives with the run attached (the initiative sheet's chunk shows
  the run), and they leave To review. When the run ends (done or cancelled) the run is detached from each chunk, and
  a done run leaves its "Run finished" note on each. The CDP scenario `brief-run-review` covers the ticking, the
  launcher's goal and a deferred run's attach and release by RPC; nobody has started a real run from it.
- [ ] (arcterm) **Charts in a council's saved report, and the bench rejudged** (`pkg/council/charts.go`,
  `pkg/council/bench/chart.go`, `pkg/council/bench/rejudge.go`). Open the next finished Review council's document from
  Library: "At a glance" draws D1…Dn in the quadrant ahead of the directions, and under Run facts the token bars, the
  look-up bars (three nested layers) and the swimlane draw in arcterm's own markdown view, in a dark theme too. Every
  block was parsed and rendered with the repo's mermaid 11 in headless Edge on council 4e9f4589 and the real bench
  results; arcterm's viewer and themes were not tried. Then `wsh council bench rejudge --dry-run` lists 10 reports;
  `wsh council bench rejudge` judges them (about 0.1–0.2M tokens), and `wsh council bench results` shows recall@all on
  the council rows, `--chart` the two quadrants.
- [ ] (arcterm) **A council's price on the Token burn card is the measured one** (`pkg/council/calibrate.go`,
  `CouncilEstimateCommand`, `councilmodel.ts` estimateLabel, `skills/council/SKILL.md`; council self-review fixes). After
  two finished councils, ask a Claude agent for a third ("hỏi council"): it quotes `wsh council estimate`, and the Token
  burn card shows the same figure as Setup's cost line, which ends "from your last N councils" (N = 2 to 5). Without being
  asked, the agent only offers the council in one line and starts it on your yes. The `council-setup` and `launcher`
  scenarios check Setup's line and the launcher note on stubbed answers; the card itself and the agent's offer were not
  tried.
- [ ] (arcterm) **No headless suggest call for a mid-turn line; chip picks logged** (`pkg/chatsuggest/hook.go`
  AwaitWhy `headless`, `chatsuggest.ts` chipPickLogLine, `suggest-core.ts` SUGGEST_TIMEOUT_MS 5 s; branch
  `fix/chatsuggest-council`). After installing, use Claude agents in Chat for a while: where waveapp.log shows `mod not
  taken … another reply's`, the next line is `no headless call: the mod is on another reply` and no `via=headless`
  follows for that ask; `via=` lines end in `question=true|false`. Take a chip by click, Enter, Cmd+Enter and
  Shift+Enter: each leaves one `chatsuggest: … pick send|edit source=model|rule|fallback … question=yesno|open|none`
  line (an armed chip over typed text only on the press that sends). The 5 s cut of the mod's call was not seen live:
  every call measured took 0.9-1.5 s. Unit tests only.
- [ ] (arcterm) **Chat keeps your reading place across a switch while the agent works** (`railtranscript.tsx` trim
  keeps `keyOffset`, `chatconversation.tsx` place kept less it; branch `fix/chat-place`). In Chat on a long-running agent
  whose transcript is past 2,000 lines, scroll up to a message well above the end, switch to another agent (or to
  Terminal) for a while as it keeps writing, then back: Chat opens on the same message, not a later one and not the top
  of the conversation. Try it once more after "Show earlier" loaded earlier messages. Only the key arithmetic is unit
  tested.
- [ ] (arcterm) **A long path in a Chat reply wraps in full** (`markdownmessage.tsx` code → `PathLink wrap`,
  `tailwindsetup.css` `.agent-md code`). Ask an agent for a reply naming a long backticked Windows path mid-sentence:
  it continues on the same line as the words before it and wraps over several lines, with no "…", and the full stop
  after it stays on its last line. Hover underlines it, click opens it beside the agent, right-click shows Open /
  Reveal / Copy path, and drag-selecting through it still copies it. Only a test path's wrapping was measured in the
  dev app (3 lines in 300px); the link itself was not tried.
- [ ] (arcterm) **Focus read in a markdown Preview** (`mddoc.tsx`, `focusreadpill.tsx`, `chatfocusreadview.ts` kind
  `doc`). Open a long `.md` in the Agent panel's File tab (Preview): the pill sits at the top of the right edge, above
  the outline dashes, and no text runs under it. Turn it on: a few blocks lit, the rest dimmed, the accent tick in the
  left gutter; J/K/↓/↑/Space step, ×N cycles the size, there is no Q and `q` does nothing; Escape and Alt+R (with the
  document focused) turn it off. Another `.md` opens already on. Hover + and `c` still comment, and the comment cards
  are never lit. Chat's focus read is unchanged (its pill still has Q).
- [ ] (arcterm) **The Agent panel's tabs are pills** (`agentrailpanel.tsx` TAB, RailFileTab). Open an agent's panel
  and a file in it: the tab on show is a filled pill, the others bare until hovered, centred in the 44px band; on
  File the file pills shrink and scroll as before, and a file's × is a round button inside its pill. Not tried in the
  app (no dev app was running).
- [ ] (arcterm) **Focus read stays on at the bottom of a working agent; a narrow Chat keeps clear of its pill**
  (`chatfocusreadview.ts`, `chatpane.tsx` scroller padding, branch `fix/focus-read-bottom`). With focus read on, send a
  prompt and stay at the bottom while the agent works: the finished blocks stay dimmed, the reply being written is not,
  and when the turn ends its reply is lit from its start. Then narrow the Agent pane to about 700px: no line of text or
  your bubble runs under the ×N / K / J / Q pill or the highlighter; at 1000px wide or more the column sits centred as
  before, and the pinned prompt card spans the column.
- [ ] (arcterm) **A Chat file link that names only a path's end opens** (`pathlinkroute.ts` listedMatch,
  `pathlinks.ts` matchListedPath). In the SIEM-parser agent's "Bàn giao SIEM-1759" turn, click
  `handbook/parsers/development.md`: it opens `apps/portal/content/handbook/parsers/development.md` in the agent's panel
  instead of toasting "File not found". The first click in a repo with no kept listing waits on a git walk.
  Commit: fix/pathlink-listing.
- [ ] (arcterm) **Focus read's J/K glide** (`chatfocusreadview.ts` glide, `chatfocusread.ts` glideStep). In a long
  real conversation, turn on Focus read and tap J quickly, then hold it: the scroll moves on the first frame and keeps
  its pace through the presses, never easing to a stop at each block; a wheel scroll mid-glide takes over at once.
  Measured over CDP on the `chat-focus-read` fixture (no speed drop between held presses), not felt by hand.
- [ ] (arcterm) **An app that stops on its own keeps its tree row** (`servicesmodel.ts` treeServiceInput,
  `servicesstore.ts` hiddenServicesAtom). Open an app (a tool with a page) in the Agent tree, select another row and
  wait past the minute it takes to stop: its row stays, reading sleeping. Right-click it → Hide: the row goes, and stays
  gone after a reload; open it again from the palette or Setup → Tools: the row is back and stays after you leave it.
- [ ] (arcterm) **A one-call stretch is its box alone** (`chatstepsview.tsx` ChatSteps, `growing`). In a Claude
  agent's Chat, find a finished turn where the agent ran one described command between two paragraphs: it shows as a
  bordered box with one row ("Check shared registration files… ›") that opens to `$ command` and its output, with no
  "… · 15s ˅" line over it. While the agent works, its latest stretch stays a line even with one call, and does not
  flip to a box and back as a second call lands. Branch `fix/single-step-stretch`.
- [ ] (arcterm) **A picture's thumbnail opens it in one click** (`chatstepsview.tsx` PictureThumb). In Chat, after the
  agent read a screenshot, click the small thumbnail at the end of the folded steps line: the picture opens full size
  over Chat (wheel zooms, Esc closes) and the line stays folded; the thumbnail on an opened Read row does the same
  without opening the row. Branch `fix/single-step-stretch`.
- [ ] (arcterm) **A sent `!` command keeps its colours.** In a Claude agent's Chat, type `! taskkill //T //F //PID 1`:
  the box colours the command, the arguments green. Send it: the bubble's command line has the same colours, not
  plain white. `CommandCard` (chatconversation.tsx) draws a bash command with `ShellCommand`. Branch
  fix/bash-bubble-colour.
- [ ] (arcterm) **No folder's split is one row in the Agent tree.** Launch an agent in No folder, open a plain
  terminal there, put it in a split with the agent (Open in split): No folder in the tree shows one split row holding
  both, in the accent frame, not two separate rows. `projectTree` keys a grid by `treeFolder` (a No folder launch's
  grid is keyed "Home"); covered by a unit test, not tried in the app. Branch fix/tree-home-split.
- [ ] (arcterm) **The bug box's Khoanh vùng frames an area on the real capture.** Open the bug box (Ctrl+Alt+R), press
  Khoanh vùng: the window's picture covers it, a drag frames an area with its size under it, Enter brings the box back
  with that area in the thumb, Khoanh lại and Bỏ vùng. Send, then open the report's screen.png: the area has an accent
  frame, and report.json a `region`. The `bug-report-box` scenario's step 7 covers the flow on a drawn picture but was
  not run. Commit: feat/bug-region.
- [ ] (arcterm) **Sidecar's Resources fills in after a restart.** Open Sidecar with its Resources showing (the wall's
  band, or the small form's panel), quit arcterm and start it again so Sidecar comes back on its own: within a few
  seconds the arcterm rows and the three charts fill in, not "Measuring…" for good. Same after a dev full reload of the
  main window. `sidecar.tsx` (`useResourcesPanel`, `resourcesLost`); the race was read from the log, not reproduced.
  Branch fix/sidecar-measuring.
- [ ] (arcterm) **The × cancels a queued Chat message.** While an agent works, send it two messages from Chat: under
  them reads "2 queued · Send now Ctrl+Enter ×". Click ×: both bubbles go, Claude Code's own queue under its prompt is
  empty, the turn keeps running and never reads them; ↑ in the empty box brings the last one back. Commit:
  feat/queue-cancel.
- [ ] (arcterm) **A council's Jump pills draw arrow icons.** Scroll a long council discussion up: the Jump to the
  latest pill at its bottom right shows an arrow icon, not a ↓ character (and Jump to the top an up arrow). Commit
  052bc296c.
- [ ] (arcterm) **Chat's last line is no longer dimmed by the fade over the box.** In an agent's Chat at the end of the
  conversation, start a turn: the Working line above the box draws at full strength, as bright as the lines above it.
  Scroll up a little: the conversation fades out under the box again, the fade coming in over the first ~70px.
  `chatpane.tsx` (`useDockPadding`); not tried in the app.
- [ ] (arcterm) **Library's look: the tab strip and the panes at full width.** Open Library (rail, Ctrl+7): the strip
  reads Conversations, Canvases, Boards with a small 1 2 3 key on each, the selected tab filled, and it is not clipped
  or doubled when the window is narrow (rail labels hidden). Open a session from Usage: it fills the page, no list
  beside it, with Back at its top left. Switch tabs and the body fades in once, with nothing jumping. `librarysurface.tsx`;
  `library-tabs` shows the structure and its shots, not whether it looks right.
- [ ] (arcterm) **Resume from a council read in Library lands on Agent; Run again from its Summary lands on Agent's
  Setup.** Open a council that left the Agent tree (Library → Conversations, Council chip on → a council ended days ago), press Resume on its
  row or in its Report's menu: the surface becomes Agent, the council is back in the tree and its Discussion is open
  with the box focused. From the same Summary press Run again: Agent's council Setup opens with that council's draft.
  `councilresume.tsx`, `councilsetup.tsx`; no scenario.
- [ ] (arcterm) **A council that ends while open in Library gives no toast and no dot; removing it returns Library to its
  list.** With a running council open inside Library (Conversations with the Council chip on, open one with `wsh ui` or the list) let it
  end: no "Council done" toast and no unread dot on its row in the Agent tree. Remove a council (its menu → Remove) while
  Library shows it: Library goes back to Conversations' list. `councilnotifysync.tsx`, `councilremove.ts`; `library-tabs`
  step 13 covers the toast and the dot with fixtures, not removal.
- [ ] (arcterm) **Land anyway lands a run held by a failed final stage.** On a run whose card reads "Land held · The
  final stage failed at …", the button reads Land anyway (peek, Needs you, the Brief's Waiting list, the run sheet's
  dock); clicking it asks first, and confirming merges wave/<run> into the base and clears the card. A run held for
  another reason still reads Land again. Commit: feat/land-anyway.
- [ ] (arcterm) **Chat's `@` list: one row per run, spaceless match, highlighted letters.** In Chat type `@buil` with a
  run going: the run is listed once (no agent row for its lead), `@buildl` still finds "Build Library", and the matched
  letters of agent and run rows are in the accent. Commit: fix/chat-ref-picker.
- [ ] (arcterm) **Sidecar's Other apps shows VmmemWSL and each app's WebView2.** With WSL running and Teams open,
  open Sidecar → Resources: VmmemWSL is listed with about the RAM Task Manager shows, and Teams' panes read
  `WebView2: ms-teams.exe` on their own row (not endable). Commit: fix/resmon-vmmem.
- [ ] (arcterm) **An opened command in Chat is in colour.** Open a Bash step in Chat: the `$ command` line draws the
  program in the keyword colour and its arguments in the string colour; a `sed -n …p x.ts` or `grep -n … x.tsx` step's
  output reads as code (keywords, strings, comments) with its `12:` line numbers dim; a test run's failing line is red.
  Then Open full view on a long one (the modal) and look at the same step in the live feed: both coloured the same. A
  Grep step's matches in a `.ts` file are highlighted, in a `.md` plain; a DAG task's Verify tail shows a failing
  line red.
- [ ] (arcterm) **A `.jsonl` file opens in colour.** Open one (a Claude transcript, an audit `.jsonl`): keys, strings,
  numbers and `true`/`false`/`null` in JSON's colours, and no red squiggle on line 2 onwards.
- [ ] (arcterm) **Xử lý starts one real agent that handles the waiting bug reports.** With two reports saved and arcterm's
  repo known (Jarvis, Waiting on you: "2 báo lỗi arcterm chờ xử lý"), press Xử lý there (or in the Cockpit's Needs-you
  strip): a "Báo lỗi arcterm" Claude agent opens in arcterm's repo and starts on the prompt, the row turns "Đang xử lý 2
  báo lỗi" with Mở agent, and a second Xử lý is refused. Read what the agent does with them: a small fix is a run
  (`wsh runs list`), a large one an initiative with chunks (`wsh effort list`), an unclear one a question at the end of
  its turn with that report left `handling`; each finished report is `done` with its outcome
  (`wsh bugreport list --state done --json`). Close the agent while it holds one: the row goes back to Xử lý. The
  `bug-report-jarvis` scenario drives all of this through `window.__bugReportLaunchFake`, so no real agent has run.
  `bugreportprocess.ts`, `bugreportprompt.ts`.
- [ ] (arcterm) **A sentence changed in a few words reads as one line, old words struck before the new ones**
  (`brainstormmodel.ts` `changedSentences`, `brainstormui.tsx` `SentenceDiffLines`). In a brainstorm where the agent
  rewrites a confirmed decision, Chat's Confirm card (and the Brainstorm tab's review): a sentence that shares at least
  half its words with its old version is one `~` line, the dropped words struck in red right before the new ones in
  green, with spaces between them; a sentence with no close partner keeps its own − or + line. The
  `chat-brainstorm-review` scenario checks the lines' text, not how they look (feat(brainstorm): one-line word diff).
- [ ] (arcterm) **Sidecar's Runs box lists every active run.** With two or more orchestrator runs going, open Sidecar:
  a Runs box above Needs you shows one row per run (title, `done/total`, age, a segment per task), `RUNS 0N` in its
  head; with four or more, three rows and a `+N more · … working` line. A failed run sorts first with a red `Failed`.
  The box stays under the memory band when RAM is high. A click on a row opens that run in the main window; on the
  `+N more` line, Jarvis. The small form reads `Runs N` (`· 1 failed`). The `sidecar-orbit` scenario's new P-runs steps
  cover it but were not run (no dev app here). Commit: fix/sidecar-runs.
- [ ] (arcterm) **Sidecar's Resources rows name agents by their task, and the arcterm mark reads evenly.** Open
  Sidecar → Resources with several agents in one project: each agent row shows its title (as in the Agent tree), not
  "arcterm"; a tab with no title yet still shows the tab's name. The Sidecar / arcterm rows' "t>" mark has strokes of
  one weight. `wshserver_resmon.go` resolveResMonOwner (unit-tested), `arctermmark.tsx` smoothing below 25x19; not run
  in the app.
- [ ] (arcterm) **Run on a reply's command runs it in the agent.** In Chat, click ▷ on a `! git status` row of a reply:
  the agent's box sends `! git status` (Claude Code's bash mode) and its output shows in the conversation, no new
  terminal opens. With a draft in the box, ▷ toasts "The message box has a draft" and the draft stays. To a sleeping
  agent it runs without waking it, as a typed `!` does. `codeblock.tsx` run; `chat-code-box` step 1b checks the
  button's title only (not run, no dev app up).
- [ ] (arcterm) **Focus read follows the new reply, its tick rides the lit block, Escape leaves it.** With focus read
  on, send a prompt and stay at the bottom while the agent works: when the turn ends the reply's first block is lit on
  the line. Step J to the very end: J keeps going after the group reaches the last block (at ×3 the group shrinks to
  two, then the last block alone), and the accent tick sits beside the lit group, not left at a third of the view. Press
  Escape in the conversation: focus read turns off (a second Escape goes back, or stops a working turn).
  `chatfocusread.ts` tickTop / latestReplyStart, `chatfocusreadview.ts`, `bindings.ts` agent:focus-read-off; no
  scenario run.
- [ ] (arcterm) **A line under a quote stays out of it once sent.** In Chat's box type `>xx`, Shift+Enter, `sss` and
  send it: the bubble shows `xx` in the quote and `sss` under it, not both in the quote. `chatmarks.ts` endQuotes.
- [ ] (arcterm) **A click on a focus-read agent's row lets J/K step at once.** With focus read on for an agent, click
  another agent's row, then that agent's row in the tree: J/K step its blocks with no click in Chat (before, they
  moved to the next agent). j/k pressed in the tree still go from agent to agent; a run row picked to type into
  (`typingFollowsAtom`) still lands in the box. `agenttree.tsx` selectAgentRow, `chatfocusreadstore.ts`
  focusConversationSoon; scenario step 6d of `chat-focus-read` was not run (no dev app up).
- [ ] (arcterm) **Focus read starts at ×3 and goes to ×5.** With `chat.focusRead.size` cleared from localStorage, turn
  Focus read on (Alt+R): three blocks are lit and the size button reads ×3; clicks go ×4, ×5, ×1. J/K slide the group one
  block (the top block leaves, the next one joins), and J stops once the group ends on the last block. At ×5 the lit group
  still reads well on a short window (the group can run taller than the view). The `chat-focus-read` scenario's step 6c
  covers ×5 but was not run (no dev app up). `chatfocusread.ts` FOCUS_READ_SIZES.
- [ ] (arcterm) **A done agent's header has one Close.** On an agent whose last turn committed and was read, the header
  ends with More then the green ✓ Close · tokens, no × beside it; on a narrow split cell it is the ✓ alone, tokens in
  its title; an agent not done keeps the ×. Both were `confirmCloseSession`; tried only by the typecheck, not in the
  app (2026-11-19);
- [ ] (arcterm) **A resumed agent's Chat counts no ended turn.** Leave a Claude agent idle, quit arcterm (or put the
  agent to sleep), reopen it later and open its Chat while it starts: if it reads "Working", nothing follows it, no
  "(10h 24m · ↓ 841 tokens)" from the last turn before you left; once you send a prompt, the counter starts from it.
  `turnStats` stops at a `turn_duration` record (transcriptprojection.ts); tried by unit tests, the typecheck and on
  the real 2026-11-19 transcript cut at 09:11, not in the app. Why that agent read working before it reported in is
  still unknown (2026-11-19);
- [ ] (arcterm) **A yes-or-no question gets ok and không at once.** In a live Claude agent, end a turn on "Có muốn
  mình build luôn không?": the chips ok · không show as the turn ends, and haiku's fuller answers (if any) join after
  them a few seconds later without moving them; a question with "hay"/"or" still waits for the model's answers. With
  several answers the row stays one line. CDP checked it with a fake model only (chat-redesign 18b, 18c2; 10ef7f7a9,
  2026-11-19);
- [ ] (arcterm) **Sidecar's Needs you buttons.** With a learned rule, a due chunk and a run to check waiting, each row
  in the small form (and on the wall) starts with its kind ("Rule to approve", "Due", "Run to check") and its age ("1d
  20h ago", "9h 49m late"), and has buttons under its text: the rule's Accept takes it off the list, the run's Accept
  acknowledges it (`wsh runs attention` no longer lists it), Work on raises the main window with an agent on the
  initiative, Open raises the main window on the item. An agent's ask shows its options as buttons; pressing one
  answers it. A run to check no longer frames the window red. Tried only by unit tests and the typecheck (2687e7785,
  2026-11-19);
- [ ] (arcterm) **Sidecar's End task, the frame's reason and the 340 × 640 small form.** Press S: the window shrinks to
  340 × 640 and drags no smaller. Open Resources (the title bar's figures): the "Other apps" title is whole; hovering
  chrome.exe (or any app you can lose) shows an × beside its name, svchost.exe and msedgewebview2.exe show none; × asks
  "End N chrome.exe?", Escape or Cancel takes it back, End closes it and the row leaves within a second. With a failed
  run (or RAM critical) the frame is red and a red line at the top of Resources names why; pressing it goes back to the
  dashboard. The wall's Resources band has the same × on its other apps. Tried only by unit tests and the typecheck
  (bbbfd4007, 2026-11-19);
- [ ] (arcterm) **Chat's usage-limit strip, with real accounts.** The CDP scenario `chat-limit-strip` fakes the
  accounts and their windows (`__chatLimitFake`) and mocks the switch's writes, so none of this ran against the real
  thing. With a second Claude account added in Settings, an agent
  whose account is at 80% of the week (or 90% of the 5-hour window) has a strip above the box with the reset time, the
  account's name and Switch to <other>: Switch makes the other account active, restarts this agent on it (the session
  resumes) and lists the other agents on the old account in the restart dialog; Snooze for an hour hides the strip in
  every agent of that account, and an agent in a project tied to its own account has no Switch (2026-11-18);
- [ ] (arcterm) A question asked while background subagents work (`agentsviewmodel.ts` liveAsk): in a Claude agent,
  start two background subagents, then have the agent ask an AskUserQuestion; Chat keeps the question with its choices
  for as long as it waits (past 10 s, while the subagents run tools), never turning into the "Wants to use
  AskUserQuestion" card with only Answer in Terminal, and a pick in Chat or in the terminal both answer it.
- [ ] (arcterm) **The phone page reads Locked while the PC is locked (Windows).** With remote mode on, open the phone
  page: Computer reads Unlocked. Press Win+L at the desk → within 10 s the phone reads Locked and its Lock button is
  disabled; unlock at the desk → Unlocked again. Press Lock on the phone → the PC locks and the page reads Locked
  within about 2 s. `TestPCWindowsReadLocked` only read the unlocked case.
- [ ] (arcterm) **The installed phone page reloads itself after an update, on a real iPhone.** With this build's page
  open once (one reload by hand after installing it), install the next build while the PWA stays open on the list:
  within about 10 s of remote mode coming back the page reloads on its own. With a chat open or text typed into an
  answer it waits, and reloads once you are back on the list. Only headless Chrome on `cmd/remotepreview -build` has
  run it.
- [ ] (arcterm) **The rail says when the agent last compacted** (`railcompactionline.tsx`). In a Claude agent, run
  `/compact`; within a few seconds the Agent details rail's session block, under the tokens bar, reads
  `Compacted · <before> → <after> · manual · just now`. Click it: the summary opens in the rail's Summary tab (since
  2026-11-20; it was a sheet), whose x closes it. Chat shows only the thin Compacted line, which opens nothing. A
  pi agent's compaction shows the line too. Compact once more → the line leads with `×2`. An agent that never
  compacted shows no line, and a subagent's interior shows none.
- [ ] (arcterm) **Suggested replies stay with an attachment** (`chatcomposer.tsx`). Once a Claude agent's turn ends with
  chips above Chat's box, paste an image: the chips stay. Click one: the message sent carries the chip's text and the
  image, and the box empties of both.
- [ ] (arcterm) **A paste after a typed ``` closes the block** (`chatmarks.ts` afterOpenFence). In Chat's box type
  ``` and paste two lines of anything: they land on the lines under the fence, a closing ``` follows, and a word typed
  on the next line sits after the closing ```. One undo leaves the raw paste beside the fence.
- [ ] (arcterm) **A long run's lifecycle rail folds its repeated rows** (`timelinegroups.ts` fold rows,
  `timelinerail.tsx`). Open a finished orchestrator run with many tasks (one with a dozen cleanups at its end): the
  run's end shows one `Cleanup complete ×N · t-1 → t-N` row instead of N rows, and opening it lists each task. A row
  whose range spans minutes reads `Nov 14 01:19–20`, its title no longer cut to `Veri…`. Pause and resume a run → the
  rail reads it in words, with who paused it and the RAM it held, not `run-paused`. The `kael1113-timeline` CDP
  scenario covers the fold; nobody has looked at it in the app.
- [ ] (arcterm) **A `!` command's output in Chat is in colour** (`chatconversation.tsx` bubble, `commandtext.tsx`
  CommandOutput, `taskecho.ts`). In a Claude agent's Chat run `! task install --dry` or any `! task <name>` whose
  Taskfile command spans lines: the `task: [name]` prefix is muted and the command under it in the shell's colours up to
  the blank line, the output after it plain; `&&` reads `&&`, never `&amp;&amp;`. Run `! git -c color.ui=always status`
  → its colours show. Copy on the bubble pastes text with no escape codes. Unit-tested only, not tried in the app.
- [ ] (arcterm) **A committed file's Diff shows its commit** (`filetabdiff.tsx`, `gitinfo.LastChange`). Have a Claude
  agent edit a file and commit it, then click the file in the turn's Edited files card: the rail's Diff shows the
  commit's +/− with `Committed in <hash> <subject>` above it, not "No change since the last commit". Edit the file
  again without committing → Reread: the diff is against HEAD again and the line above it is gone. A file no commit
  ever changed and that matches HEAD still says "No change since the last commit". Unit-tested on the Go side only.
- [ ] (arcterm) **Open in Claude Desktop** (`desktoplink.ts`, `sessionsdetail.tsx` DesktopButton,
  `projecthistory.tsx` menu, `commands.rs` `is_claude_desktop_resume`). Open an ended Claude conversation in Library →
  Conversations: the external-link icon beside Fork opens Claude Desktop on that conversation in its Code tab (Desktop
  imports it if it does not hold it yet). A live session and a pi session show no icon. A project's History row menu
  has the same item. Unit-tested only, not tried in the app.
- [ ] (arcterm) **Council re-asks an unreadable answer** (`runner.go` `reread`, `prompts.go` `RereadPrompt`). When a
  seat answers in prose with no JSON block, waveapp.log shows `[council] <id>: <seat>'s reply could not be read …;
  asking it again`, the seat's avatar reads "Reply unreadable: asking again", and its answer then lands in the thread;
  one that fails twice shows `- Failed: …` in the report's Run facts. Unit-tested with a fake caller only, not seen
  with a real model slip.
- [ ] (arcterm) **Chat file pills show the file type's icon** (`chatfilepill.tsx`, `chateditorpill.tsx`). @-mention an
  `.html`, a `.ts` and a folder in Chat's message box: each pill shows its Material icon (as in the Code tree), selected
  or not, and the sent message's pills show the same; the 13 px icon sits centred on the 20 px pill. Typechecked only,
  not seen in the app.

## 2026-11-18

- [ ] (arcterm) **Live output in full view is in colour.** Run a coloured background task (`task tauri:build`, or
  `npx vite build`) from a Claude agent, open its peek → Open full view: the File tab shows vite's cyan/green and no
  `␛[36m` codes; with Live on it keeps to the end as lines arrive, scrolling up stops it, clicking Live jumps back;
  Wrap toggles wrapping; Mod+F opens the find bar over the output. A server log opened from Servers looks the same.
  The view is `liveoutput.tsx` in place of Monaco for a `live` ref; tried only by unit tests and the typecheck
  (821fb0ae9, 2026-11-18);
- [ ] (arcterm) **Settings → Agents still switches the Claude account.** With two Claude accounts and an idle agent
  running on the old one, pick the other account's row: it checks at once, the restart dialog lists the idle agent (an
  agent in a project tied to its own account is left out), and picking the account that is already active again does
  nothing. Settings now calls the shared `switchClaudeAccount` (`claudeaccountswitch.ts`, also the Chat usage strip's
  Switch) instead of its own copy; tried only by unit tests (`switchPlan`) and the typecheck, not in the app
  (2026-11-18);
- [ ] (arcterm) **A turn's file card opens the file's diff.** In Chat, at the end of a turn that edited files, click a
  row of "Edited N files": the rail tab opens on Diff (changed lines marked, the rest folded), not the whole file. A
  file in a `.worktrees/<x>/` tree shows its change in that tree; a file new since the last commit shows all added; a
  change already committed says "No change since the last commit". `chatsteps.ts` turnFileDiff, `filetabdiff.tsx`.
  Not tried in the dev app when written.
- [ ] (arcterm) **A builder check waiting on you makes the agent's row breathe.** In Agent, on a brainstorm whose
  builder check is back (a builder question open, or Review / Approve shown in Chat): its row in the tree breathes an
  amber wash and edge, as an asking agent's does, and Cockpit counts it; after Approve starts the run the row stops.
  `brainstormmodel.ts` checkWaits.
- [ ] (arcterm) **A brainstorm's rail opens as wide as the details rail.** In Agent, on an agent brainstorming, switch
  between Chat and the brainstorm (the lightbulb): Decided so far's left edge sits where the details rail's did, with
  nothing moving. Drag it narrower, switch to Chat and back: it opens at the details rail's width again. Not tried in
  the dev app when written.
- [ ] (arcterm) **Chat's box fences a real clipboard paste of a log.** The CDP step dispatches a made-up paste event.
  Copy a stack trace from the browser's DevTools console (several `at …` lines) and paste it into Chat's box after a
  word: it goes in on its own lines inside ```, the box grows to show it all, and one
  Ctrl+Z leaves the raw paste with no fence. Paste two lines of Vietnamese prose: they go in as typed, no fence.
  `feat/chat-input-marks` (956770e3c).
- [ ] (arcterm) **A self-detaching dev server reads as its own project's.** With SIEM-portal's `astro dev --port 4310`
  up (started in the foreground, so it detaches), open the footer's Servers: the :4310 row is not an arcterm agent's
  (no owner, or a SIEM-portal agent's); in Agent, the SIEM-portal folder row shows :4310 beside :8100's agent row.
  `fix/servers-owner`.
- [ ] (arcterm) **A close chip in Chat's box.** Have a Claude agent commit something and read its reply: the header's ✓
  Close shows, and the chips over the box end in "đóng agent" (or "close agent" when you write English) with a circled
  check, beside "push đi" and the model's step, even when the row is full. A click (or Tab to it, then Enter) asks to
  close it as the header's ✓ does; it is gone while a background task still runs or a run it started is still going,
  and on a turn that ends in a question. Branch `feat/chat-close-chip`.
- [ ] (arcterm) **A Claude agent's suggested replies come from its own claude.** After a build with this change, let
  a Claude agent finish a turn that ends in a question while you look at it in Chat: the reply chips show about 2 s
  after the turn ends (not 5-6 s), and no extra `claude.exe` starts for them (Task Manager); `waveapp.log` has no
  `wsh chatsuggest` errors. A pi agent's chips still come (the headless call), and a turn the mod could not answer
  (claude outside arcterm, the mod not loaded) still gets chips after ~2 s more. If chips never come faster, check
  whether `cc-plugin-sec-default` skips the arc mod's `turn.complete` (it skips its `prompt.compose` and
  `session.append` in some sessions). Unit tests only: `pkg/chatsuggest/hook.go`, `claude/arc-mod/hooks/suggest-core.ts`
  (2026-11-18);
- [ ] (arcterm) **Switching agents no longer crashes the header.** In Agent, pick a Claude agent, then a plain
  terminal, a run's worker and back (from the tree and from Sidecar's wall), including one falling asleep: no
  `WINDOW ERROR … is not iterable` in `waveapp.log` and the header redraws each time. Not tried in the app:
  `agentheader.tsx` `remoteStatus` (7778f1559, 2026-11-18);
- [ ] (arcterm) **Scrollbars show only under the pointer.** With the pointer away, the Agent tree, Chat, Jarvis and
  Setup lists show no scrollbar; point into one and a thin bar shows on that list alone (not on a list beside or
  inside it), thicker and brighter under the pointer and while dragged; nothing shifts sideways when it shows. Jarvis
  bands and the council composer still line up with the scrolling column above them (gutter 10px → 8px). Checked only
  in an Edge page with the same rules (`--scrollbar-thumb` in `tailwindsetup.css`, 2026-11-18), not in the app or on a
  Mac's WebKit.
- [ ] (arcterm) **Background tasks open in place.** Have an agent run two commands with `run_in_background` (one that
  ends at once, one `npx vitest run <a test file>` that runs a while), then open its details rail → Background tasks:
  Running 1 holds the vitest one with its time counting up, Finished 1 the other with its time. A click opens a row:
  `$ <command>`, then its last 12 output lines in vitest's own colours, growing while it runs, and Open full view, which
  opens the output in the File tab as before; a second click folds it. Stop still ends a running one; the Finished
  heading folds its rows. Branch `feat/codeblock-run`.
- [ ] (arcterm) **A shell command in colour.** In Chat type `!` then `git log --oneline -3 | head "$HOME"`: `git` and
  `head` in the keyword blue, `log` in the string green, `--oneline`, `-3` and `|` dimmed, `"$HOME"` green; the caret
  shows and moves where it should, a selection shows its band, the grey ghost text still sits after the last character,
  and a command long enough to wrap or scroll stays lined up with its colours. A reply's `bash` block draws the same
  colours. Branch `feat/codeblock-run`.
- [ ] (arcterm) **A shell block in Chat has Run.** Ask an agent for a command in a `bash` block written `! git status`:
  its head shows Run beside Wrap; Run opens a terminal in the panel under that agent, in the agent's folder (its
  worktree when it has one), and `git status` runs there without the `! `. A `ts` or `json` block has no Run; with no
  agent in focus the terminal takes the centre. Branch `feat/codeblock-run`.
- [ ] (arcterm) **A Chat selection keeps the text's colour.** Drag over a reply in Chat (prose, an inline code span, a
  code block, a table), and double-click one word: the words stay their own colour (white prose, coloured code) on a
  band in the system's selection colour (Windows' blue `Highlight`, not the theme's accent), under a few themes; the
  same band shows on a selection in Chat's bash box (`!` mode), its coloured command still readable under it (b67964193).
  The blend was checked only in a headless-Edge page with the same layer (`mix-blend-mode: screen` on
  `[data-md-selection-layer]`, `tailwindsetup.css`, 2026-11-18), not in the app or on a Mac's WebKit;
- [ ] (arcterm) **One arcterm at a time (Windows, packaged).** With arcterm closed to the tray, open it again from the
  Start menu or a desktop shortcut: its own window comes back to the front (no second window, no second Sidecar or tray
  icon, no BOOT ERROR), and `waveapp.log` has `[tauri] arcterm was opened again`. Also minimized, and folded into
  Sprout (it grows back). A dev app (`task dev`) still opens beside the installed one. `main.rs`
  `show_main_window_again`, `tauri-plugin-single-instance` (2026-11-18);
- [ ] (arcterm) **A backend that stops at launch says why at once.** Hard to stage by hand: with the single-instance
  guard in place the held-lock case needs a dev app pointed at a running app's data dir (`ARC_DEV_DATA_DIR`). The BOOT
  ERROR should show within a second as "backend unavailable: another arcterm is already running…" rather than after
  15 s. `main.rs` stderr reader, `init.rs` `startup_failure` (2026-11-18);
- [ ] (arcterm) **Brainstorm rail in the details rail's place.** With the details rail open (`d`), switch an agent
  with a brainstorm between Terminal, Chat and Brainstorm: the Chat · Terminal · Brainstorm switch stays put, and in
  Brainstorm the right column shows Boards · Decided so far (no Overview / Files / Changes); a question with boards
  shows its tiles there, a tile opens its board over the question only, the rail's handle drags its width. In the
  builder check the rail is 460px, so the switch moves there. Close the details rail: the brainstorm's rail goes back
  beside the question and stacks under it in a narrow pane. Also a board opened from Chat now covers the Focus read
  and Skim buttons. `brainstormrail.tsx` RailRow / `agentsurface.tsx` BrainstormRailSlot (2026-11-18);
  `task verify:ui -- brainstorm-mode` (step 0c) not run (no dev app up).
- [ ] (arcterm) **Agent header: project / initiative on the title's second line.** Open a Claude agent in Chat and in
  Terminal: the name, runtime mark and state sit on the first line with the status dot beside the name, `📁 project /
  ◇ initiative` (or `/ + initiative`) on a line under it, and the run link, model and context to the right; the header
  is no taller than before (the view switch sets its height). Narrow it to a 2x2 cell: the project truncates, nothing
  runs under the buttons. `agentheader.tsx`, "the project and initiative on the title's second line" (2026-11-18);
  `task verify:ui -- agent-header-redesign` not run (no dev app up).
- [ ] (arcterm) **Sidecar's Resources: band, charts, icons and panel.** Open Sidecar's full window at any size from
  1100 CSS px (1440 × 900 included): a Resources band runs across the bottom, where the last 2 hours' lanes were, with
  CPU, RAM and GPU charts filling in over 5 minutes (a hover shows a crosshair and "23% · 40s ago"; GPU matches Task
  Manager's figure, or says the machine has no GPU counters), then Sidecar's own row first (its CPU and RAM, not "—";
  "—" means WebView2 did not name its renderer), arcterm and each agent by RAM with a GPU column, and "Other apps over
  200 MB" (chrome.exe (12)…). Each row leads with its mark: the arcterm "t>" on Sidecar and arcterm, the Claude or pi
  logo on an agent, the app's own icon on an other app as Task Manager draws it (Chrome, Docker; a window glyph where
  the exe has none or is protected, VmmemWSL). The title bar's figures are plain text there. In the small form the
  figures get a border and a chevron, and a click drops the same charts and table under the bar; Escape or a click
  outside closes it. Windows only; on a Mac it says so. Branch `feat/sidecar-taskman`.
- [ ] (arcterm) **Sidecar's pin in the full window.** Maximize Sidecar or press F11: the title bar has a pin button
  beside S; pressed, Sidecar stays over the other apps on its screen, and a relaunch reopens it pinned. Same merge.
- [ ] (arcterm) **Sidecar's resource panel.** Click the RAM · CPU figures in Sidecar's title bar (wall and small
  layouts): a panel drops under the bar with Sidecar's own row first (its CPU and RAM, not "—"; "—" means WebView2
  did not name its renderer), then arcterm and each agent by RAM, then "Other apps over 200 MB" (chrome.exe (12)…),
  every row refreshing every 2 s; Escape or a click outside closes it. Windows only; on a Mac it says so. Commit
  4f28db4b9. Opening it crashed arcterm (an access violation in WebView2's `EmbeddedBrowserWebView.dll`, twice at
  11:11 on 2026-11-18); the fix keeps the frame list alive while `sidecar_pids` walks it: check arcterm stays up and
  Sidecar's row reads a figure, opening and closing the panel a few times.
- [ ] (arcterm) **Sidecar's S button reads as its own button.** In the wall layout the S button shows a screen with a
  small window in its corner (a screen with an arrow out while small), no longer the same inward arrows as the full
  screen button beside it. Commit 4f28db4b9.
- [ ] (arcterm) **Sidecar's alert frame follows the window's corners.** On Windows (10 and 11), with RAM strained, the
  red frame bends with an 8 px radius instead of being cut at the window's rounded corners, maximized or full screen
  too (the frame no longer reads the window's state; Windows 11 squares a maximized window's corners, so check that a
  full-screen frame still looks right). In the band, a narrow heavy-agent card keeps the agent's name and command readable, its Stop
  and Sleep buttons wrapping under them. Commits 7cdcfa181, f67c6b351 (the capability needs a rebuilt host).
- [ ] (arcterm) **Sidecar's band cards keep the agent's name.** In the wall's RAM band, a narrow heavy-agent card keeps
  the agent's name and command readable, its Stop and Sleep buttons wrapping under them; maximized or full screen, the
  alert frame is square (the rounded-corner case was seen holding on 2026-11-18). Commit 7cdcfa181.
- [ ] (arcterm) **A markdown doc's Comment button floats above the selection, at its start.** Select a phrase mid-line
  in a markdown file open in the Agent's doc view: the Comment button sits just above the first selected line, its left
  edge at the selection's start, covering no selected text; select the doc's very first line and it drops under the
  selection instead. `md-comments` scenario (`mddoc.tsx`).
- [ ] (arcterm) **Take an agent from the phone's Agents list, on a real iPhone.** Only `cmd/remotepreview`'s fixture in
  headless Chrome has drawn it (`remote-phone` steps 1a, 1c, 1d, 13, 14): no real roster, transcript or lock has run.
  Run `task verify:ui -- remote-phone` first. With remote on and the page installed, **Agents** lists live agents only
  (one that exited to its shell is gone), each with a dot coloured by state, and an idle one shows the first sentence
  of its last reply. Tap an idle claude: its chat opens and the desk's header reads **On phone · Take back**; Back
  without sending returns it to the list and clears the desk's pill within a poll. Take another, send a prompt, then
  Back: it stays handed over. In a long session scroll to the top of the chat: older messages load above and the one
  you were reading stays put; switch the phone to airplane mode and back and the chat carries on with no gap or
  repeat. A run with workers is one row under **Runs** that opens to its worker lines. **Computer**: Lock locks the PC
  (on a Mac it sleeps the display, which locks it only when the account asks for its password at once), Volume down
  and up move the sound one step, Mute toggles it, and a failure shows its text under the buttons. On a Mac, also
  note whether Volume up unmutes (the script sets a level and leaves the muted flag alone).

# Waiting on a hand check, part 4

Older lines of `docs/hand-checks.md`, moved here when it grew past its size; the rules and the list of parts
are in that file. Tick a line here when it holds, then remove it; a part left empty is deleted.

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
- [ ] (arcterm) **Jarvis's hologram shows while arcterm starts up.** Settings → Jarvis & Office → Form → Hologram,
  then relaunch arcterm (on the Agent screen, and once landing on the Cockpit) → while the agents load, the middle of
  the screen shows the blue HUD a size up from the corner's: the core lights first, the four rings fade and grow in
  from the inside out within about 1.5 s, then they turn with the core beating, over "Setting up arcterm"; no hologram
  sits in the bottom-right corner meanwhile, and it fades in there once the roster is read. No milky disc or square
  edge round it (WKWebView). With Form → Sprout the pet still runs; in Float the pet runs whatever the form. Unit tests
  (`hologrammodel.ts` assembleReveal) and the typecheck only; never seen in the app (`startuploader.tsx`,
  `hologramscene.ts`).
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

# Waiting on a hand check, part 3

Older lines of `docs/hand-checks.md`, moved here when it grew past its size; the rules and the list of parts
are in that file. Tick a line here when it holds, then remove it; a part left empty is deleted.

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

# Waiting on a hand check, part 10

Older lines of `docs/hand-checks.md`, moved here when it grew past its size; the rules and the list of parts
are in that file. Tick a line here when it holds, then remove it; a part left empty is deleted.

## 2026-11-25

- [ ] (arcterm) Kael sync 11-25: an end review that fails reaches the lead in one fix round. On a fast-track run let a
  task land a bug a test would not catch (or have the end reviewer's findings name a missing test) → the End review step
  fails, the stage's failure text holds an `[End review] …` block after any Check or Verify output, and the lead gets
  one wake with all of it and writes one fix round; the fix's tasks run with no Reviewing state and the next final stage
  runs an End review again over the whole merged diff. An end review that passes with `--unverified` leaves the run
  unverified with the reason `end review: …`.
- [ ] (arcterm) **A failed subagent's row folds away.** On `Plan oracle-tightening` (mit-thesis), the `You are
  implementing Ta… · failed` row is gone after installing: its agent redid Task 3 after it. On an agent whose subagent
  failed with nothing after it, hover the row: a ✕ fades in beside `failed`; press it and the row folds on the spring
  (no snap, no gap left behind), and stays gone after a restart.
- [ ] (arcterm) **A `! cmd` inside a sentence is highlighted in Chat.** In an agent's Chat, a reply with a sentence such
  as "…rồi gõ `! wsh runs land <id> --force`": the code span draws in the same yellow tint as a ==marked== sentence,
  in the prose's ink rather than the indigo of other code; `!= null` or `$ npm test` in a span stay plain code; a
  selection over it still shows the band alone. Not tried live: no dev app was up.
- [ ] (arcterm) **Your pins move into the workspace.** After installing, open an agent in `D:\work\mit\mit-thesis`
  (or Code on it): its Files tab still lists the 4 files you had pinned, in the same order, and
  `wsh getmeta -b workspace:<oid> code:pins` prints them. Pin or unpin one and run the command again: it follows. On the
  Mac the same holds once the sync script writes `code:pins` there.
- [ ] (arcterm) **Library's tab underline slides.** Open Library and click Conversations → Boards, then press `1`–`4`
  fast: the accent underline under the open tab slides to the next one (no jump, no second underline, none left
  between two tabs), the labels never shift, and hovering a tab shows its name with the key muted at the right. Tab
  into the strip: the focused tab shows a ring. With reduced motion on, the underline moves at once. Uncommitted.
- [ ] (arcterm) **The rail opens on the brainstorm or the initiative.** Select an agent you have not clicked a rail tab
  on: with a brainstorm attached the rail shows Brainstorm, with only a linked initiative Initiative, with neither
  Overview. An initiative agent that then starts a brainstorm moves to Brainstorm. Click Overview (or any tab, or open a
  file): that agent's rail stays there from then on, even when a brainstorm starts. `i` on an Initiative tab the rail
  picked goes back to Overview.
- [ ] (arcterm) **A pasted text chip goes to the new agent whole.** In New agent, type a line in Task and paste 20+ lines
  (a Pasted text chip shows under the box), then Launch on Claude Code → the agent's first bubble shows your line and a
  folded "Pasted" card holding all of it. Hold it instead (machine busy) → the held pane shows the paste written out
  as text. Checked in the browser build only, launch not tried (branch `launcher-paste-chips`).
- [ ] (arcterm) **Every port beside the server mark.** On an agent that left 3+ ports listening (e.g. `task dev`:
  vite, WebView2 CDP, wavesrv), its tree row shows every port after the green server glyph (`:5174 :9223 :58458
  :58459`), no `+N`; the agent's name truncates first, the ports stay whole. Also the project header row. With the
  sidebar narrow, the ports that no longer fit fold into `+N` (whole ports, none cut mid-number) and the RAM, tokens
  and age stay inside the row; widening it brings them back.
- [ ] (arcterm) **A live pair as a ⚖ line in the working agent's row, and the Pair toggle in the Tauri app**
  (`pairjudgelineview.tsx`, `pairjudgemenu.tsx`, `agentsurface.tsx`). Checked on seeded pairs in `task dev:browser`
  only (`pair-tree`, `pair-header`, `pair-conversation`): the Tauri dev app's Rust build stalled in `rustc` on the
  worktree. With two live agents paired: the working agent keeps its own row and gets one small line under its name
  (⚖, the judge's state in words, the judges' tokens, the new-message count), and the judge has no row. One asking
  shows the line in the warning tone ("judge is asking you"), and a click on it opens the judge's own view. A click on
  the line opens the conversation under the working agent's header, Pair lit and the rail on Decided; a click elsewhere
  on the row opens the working agent; Pair, Chat, Terminal or Esc go back. On the judge, Pair has no count and the
  link icon opens the working agent.
- [ ] (arcterm) **Quote from a file into the chat box.** On an agent showing Chat, open a markdown file in its panel's
  File tab and select part of a paragraph: a Quote button (key `q`) floats beside Comment. `q` (or the button) puts
  `path:N-M` (the paragraph's lines, the path relative to the agent's folder) and the passage as `> ` lines into the
  chat box, the caret on the blank line under it, after what was typed and before any folded paste. In Source,
  select lines and press `Alt`+`Q` (or right-click → Quote in chat): the same, with the selection's lines. Switch the
  agent to Terminal: no Quote button, `q` and `Alt`+`Q` do nothing, the right-click item is disabled. Scenario
  `file-quote` covers it with a stub chat box; never run against a dev app.
- [ ] (arcterm) **← opens a file pill in Chat's message box for editing.** In Chat, @-pick a file so it shows as a pill,
  then press ← until the caret is right after the pill and once more: the pill turns back into its text `@path`, the
  caret at its end. Backspace and type to change the path, then → past the space: it is a pill again, of the new path.
  Home then → opens it from the front. Not tried in the app; CDP step agent-chat 71b covers it. Commit: feat(chat) ←
  or → into a file pill opens it into its text
- [ ] (arcterm) **Show more / Show less on a long message of yours springs open and shut.** In Chat, send a message
  longer than six lines: its bubble shows six lines fading out. Show more grows the bubble onto the whole text (no jump);
  Show less shrinks it back to six lines and the fade comes back as it lands. Click Show less mid-open: it turns back
  from where it was. Under reduced motion both jump. `narrationtimeline.tsx` PromptText; no scenario.
- [ ] (arcterm) **Pair two live agents and watch a full exchange end on a stop** (`pkg/agentpair`, the menu of ⚖ under
  a reply in an agent's Chat, `docs/guide/agent-pair.md`). The pair scenarios run on seeded pairs, so no agent has ever
  run one. With a Claude agent that has a plan open, ⚖ under a reply → Open a new judge: a judge tab boots on Opus in
  the same folder, the working agent's header gets a Pair button beside Chat / Terminal, and it opens the conversation.
  Watch the judge
  answer, its reply (with a `> ` quote line) reach the working agent as a prompt, and the working agent end its reply
  with an `arc-pair` block that fills the rail's Decided tab. Let it run until a
  stop line reads "Paused: …" (no new points, both agree, or the token cap set low on the sheet); after it, nothing is
  relayed until you send a message. Repeat with a pi agent as the judge, and with a second judge added.
- [ ] (arcterm) **A heavy command held mid-turn, then Run now** (`JobSlotCommand` in `wshserver`, `pkg/agentpair`). With
  a pair whose judge has not answered, ask the working agent to run a heavy command (a full test suite) in the middle of
  a turn: the command is refused with the "Held: …" reason, the agent ends its turn naming the command, the message
  reaches the judge, and the conversation shows a dashed held line with Run now. Press Run now before the judge answers:
  the command runs once, the line reads let through, and a message of yours ("Run … now") shows in the timeline. Run the
  same again and let the judge answer instead: the working agent runs it in its next turn with no Run now.
- [ ] (arcterm) **Unpair with a held command** (`Unpair` in `pkg/agentpair`). With a command held and not let through,
  press Unpair: the pair leaves the header and the list, the working agent gets one line naming the command and saying
  it may run it now, and its next heavy command goes through the job queue as usual, with no hold.
- [ ] (arcterm) **A wavesrv restart in the middle of an exchange** (the Manager's boot step in `pkg/agentpair`). While
  the judge is answering (its row working), close and reopen arcterm: the pair is still listed, the judge's answer is
  taken once it lands (even if it landed while arcterm was down) and passes to the working agent, nothing is sent twice,
  and a heavy command from the working agent is still held while a judge owes an answer.
- [ ] (arcterm) Agent row fold chips from two on: in the Agents tree, an agent with one subagent or one background
  task shows it under the row with no chip; from two of either a chip folds them; with both chips on one line they keep
  their count only and the RAM/tokens/age columns stay inside the row (no overflow). `agenttree.tsx`.
- [ ] (arcterm) **Judge for a choice question, the light mark on real haiku** (the Final's `chat-judge` fakes both
  judges). Have a Claude agent end a turn on an A-or-B question written as prose ("… Mình nghiêng A. A hay B?"). Under
  its message (the last one) a card reads "Gợi ý · haiku, chỉ đọc reply" over the pick's name and a one-sentence
  reason, with a "Đọc code rồi chọn" button, no hover needed; once you answer, it folds to a line reading "· rê vào để
  xem lý do" and hovering its name shows the reason; that chip is first in the row with the magnifier icon. Do it on
  both paths: an agent whose arc mod makes the call at the turn's end (the mod path), and one whose mod is off
  (wavesrv's headless call), and check each answer's chips have a pick, a reason and a neutral description (spec
  "Light mark"; `pkg/chatsuggest`, `claude/arc-mod/hooks/register.ts`). A yes-or-no question or a turn with no question
  gets no line.
- [ ] (arcterm) **Judge for a choice question, the deep judge on a real project** (nothing in the Final starts sonnet).
  On the turn above press "Đọc code rồi chọn" (or Alt+J) with the agent's project open: the line reads "Judge đang đọc
  code, không thấy agent khuyên gì · N s" with the seconds ticking and Dừng; when it ends it reads "Đã đọc code: chọn
  <pick>" with `sonnet · N file · N s` at the end and the reason on hover, the judged chip moved first (an option the
  agent never named is a chip of its own and sends its description and facts). `waveapp.log` holds one `chatjudge: …
  role=chat-judge state=done model=sonnet …` line, and no arcterm hook fired for the judge session (no row in Active,
  no session in the project's History). Press Dừng mid-way: the line goes back to the light mark; answering with a chip
  while it reads stops it too. Quit and reopen arcterm: the line under the old message is still there.
- [ ] (arcterm) **What's new picture for Judge for a choice question.** Run
  `node scripts/cdp/final-verify.mjs chat-judge` on a dev app, which writes `public/whatsnew/<version>-chat-judge.webp`;
  commit that file and change the CHANGELOG line's `<!-- shot: none -->` to `<!-- shot: <version>-chat-judge.webp -->`
  (`whatsnew.test.ts` checks it).
- [ ] (arcterm) No console window for harness probes (Windows): launch a build with this fix and wait 30 s (the first
  harness update check) → no Windows Terminal window opens with `agy.exe --version`; pressing Update on a harness
  opens none either (`harness.HideWindow`, `pkg/harness/catalog.go` `versionCommand`, `pkg/harnessupdate/update.go`).
- [ ] (arcterm) Brainstorm run starting: approve a brainstorm's builder check and press Start in the launcher; until
  the run is created, the agent's sidebar row reads "starting run" (not "asking question") and Chat's builder check
  card reads Working with "The run is starting", not the amber Waiting on you (`withStartingRun`, `checkCard`).
- [ ] (arcterm) Overview with an agent asleep in its tab: open SIEM-parser's Overview (its one session `Bàn giao
  SIEM-1759` asleep) → Now lists it under Idle 1 with a moon and `asleep · …`, and the Activity footer reads
  `Last 7 days: 1 session · 152.7M tokens`, not 0 sessions. Seen in the `project-overview` CDP scenario with a fixture
  agent; the footer's count of a real live session only in `projectoverviewmodel.test.ts`.
- [ ] (arcterm) Sidecar Resources: open Sidecar on the wall (and the small form's Resources tab); within a few seconds
  the band lists Sidecar and arcterm rows and the CPU/RAM charts start drawing, instead of "Measuring…" for good (the
  `resources` act's `ask` was dropped by `validateAct`, so `resourcesFor` refused every reading).
- [ ] (arcterm) Sidecar Needs you: an agent whose last message ends `… kiểm lại file \`x.json\` giúp bạn?` shows the whole
  last sentence, not `json\` giúp bạn?`.
- [ ] (arcterm) Initiative pane Latest note: a note longer than six lines scrolls inside its box (wheel and scrollbar),
  the rest of the pane still scrolls.
- [ ] (arcterm) Chat bare `! cmd` line: an agent reply holding a line `! python -c "t.replace('**A**','**B**')"` outside
  code draws it as a compact command row with Run and Copy, its `**` kept, no bold word. `task verify:ui --
  chat-code-box` step 1b2 checks it; it did not run (the dev app was stopped for low memory). Unit-tested only
  (`bashlines.ts`; 991477356).
- [ ] (arcterm) Chat table Copy: hover a table in a Claude reply; the copy button sits right of the header row, over no
  cell. Click it, paste in Chat's input: a `| … |` Markdown table arrives; paste in Google Docs: real ruled cells.
  Layout measured in headless Edge only (`markdown.scss`, `markdown-table.ts`; d7ecb89a1).
- [ ] (arcterm) **On the Mac app: a 100k+ Claude agent is compacted before it sleeps and before its cache goes cold,
  and keeps a draft** (`pkg/agentsleep/compact.go`, `wshserver_agentsleeploop.go`; e044cc0cb, e2f38fb4f). Seen on the
  installed Windows app (waveapp.log 11-23..11-25: 17 compactions before sleep and 5 before the cache went cold, every
  wake writing 40-61k of cache instead of the 100-380k it had), never on the Mac, whose idle and CPU reads differ. On the
  Mac, with Settings → Agents → Sleep's Compact row on (100k): leave a 100k+ agent off screen until it sleeps; its row
  works through a `/compact` first, then sleeps, and the waking turn writes about 50k, not its whole context. Then type
  a draft into an on-screen 100k+ agent's composer and leave it idle ~55 minutes: it compacts, stays awake, and the
  draft is still there (this part needs `autoCompactEnabled` false in the Mac's `~/.claude.json`; with it on, Claude
  Code compacts the agent itself).

## 2026-11-24

- [ ] (arcterm) **An @id that is not a live agent stays in the session; a dropped prompt reads Not sent in Chat**
  (`notAnAgent` in `claude/arc-mod/hooks/mention-core.ts`, `@<id>` in `refs-core.ts`; `droppedReason` in
  `transcriptprojection.ts`, `droppedIds` in `chatpending.ts`, `takeBackDropped` in `chattakebackstore.ts`). After
  installing a build with it, in a Claude agent's Chat send `@<a council's id> có visualize ko`: a grey line says the
  id is not a live agent, and the agent answers after reading the council with `wsh read`. Then send
  `@<a live agent's tab id>` alone (the mod refuses a mention with no message): Chat draws a yellow "Not sent" line with
  the reason, the bubble goes, the text is back in Chat's box once, and the terminal's box is empty. Not tried in the dev
  app: the divider's look and the take-back were checked by unit tests and the typecheck only.
- [ ] (arcterm) **The agent asks before a merge while Verify is red or amber** (`verifyGateAsk` in
  `claude/arc-mod/hooks/register.ts`, `verifygate-core.ts`; the rail's Verify tile, `docs/agents/verify.md`). After
  installing a build with it, in a Claude agent on this repo's default branch (a checkout with `.arc/verify.json`), run a
  scenario that fails (or stop one mid-run, which reads No result) so the rail's Verify tile is red or amber, then have
  the agent run `git merge <branch>`: Claude Code's own prompt asks "Verify: <scenario> failed steps … Merge anyway?";
  approving runs the merge, refusing cancels it. Skip the row on the rail first and the same merge runs with no ask. A
  merge from another checkout (`cd ../main && git merge x`) is judged in that checkout, where the agent branch's own
  commits cannot make a row out of date (a failed or no-result row still asks). In an engine worker, where nobody can be
  asked, the ask comes back as a refusal whose reason tells the agent to ask you first.

## 2026-11-23

- [ ] (arcterm) **`wsh council redoc` rewrites a project's old reports** (`cmd/wsh/cmd/wshcmd-council-redoc.go`). After
  installing a build with the council report tables, run `wsh council redoc --project <mit-thesis> --dry-run` on
  Windows → 16 reports to rewrite and 6 left untouched ("no council record on this machine"; seen on the Windows store
  on 2026-11-23); then without `--dry-run` → each line says `rewrote`, and the exit code is 0. Open one regenerated
  report (the short main file: the to-do table, the figures table only when the council declared any, the memory) and
  the `.discussion.md` beside it (Matrix, Cite check, The discussion, Run facts); an old council has no figures table.
  Run it again on the Mac for the 6 the Windows store lacks. A council still running is skipped with its state. Only the
  pairing is unit tested; the writes go through wavesrv's `CouncilSaveDocCommand`, which no test here drives.
- [ ] (arcterm) **Vietnamese re-summary of five councils** (`wsh council summarize`; the synthesis language rule). With
  the same build, run `wsh council summarize <id>` for `5e31814143638517`, `27f5e22576cf98bf`, `0c4145c0d29de45b`,
  `51d083251b2dc133` and `5a8ffa6d661752a0`, one at a time (~0.5M tokens in all; each waits on a Token burn card) → each
  report's directions (title, reasoning, first step, task, why) come back in Vietnamese, with paths and ids as they
  are. `0f74c5be72277053` stays out: its question is English, so a re-summary would come back English.
- [ ] (arcterm) **A council's outside file is copied into the project** (`pkg/council/briefs.go`, `wsh council start`
  warnings). With the same build, start a council (a small panel) in a project with `--files` set to a file outside the
  project → `docs/council/briefs/` holds `<date>-<council id>-<file name>`, the experts cite the copy, and the report's
  side file has no "Files not copied". Give it a folder over 1 MB → `wsh council start` prints
  `warning: <folder> was not copied into docs/council/briefs: …` and the side file lists it under "Files not copied".
- [ ] (arcterm) **Footer version is just the number; What's new says when it was built** (`versiontag.tsx`,
  `whatsnewsheet.tsx`). In the installed build, the bottom right reads `v1.x.y` with no commit after it; click it →
  What's new's header reads `in arcterm 1.x.y · built YYYY-MM-DD HH:MM`, and Settings → About still has the Commit
  row. The `whats-new` scenario could not run (no dev app on CDP).
- [ ] (arcterm) **Chat: Esc takes back a sent message with pastes as chips** (`sentText` / `mergeTaken` in
  `chattakeback.ts`). In Chat, type a line, paste two long blocks (each folds to a chip), send, and press Esc at once
  while Claude works with no reply yet → the box holds the typed line and the two chips, no `<pasted_content id=…>`
  text. Press Enter → the message lands once, as it was sent; no bubble of it stays under the conversation after the
  reply.
- [ ] (arcterm) **Chat: a message from another agent as Markdown** (`SentMarkdown` in `chatconversation.tsx`,
  `messageText` in `chatmodel.ts`). Send an agent a long message with `wsh agents send` (a paragraph, a numbered list,
  some `code`) → in its Chat the `message · from <agent>` card shows no `tab <id>` line but a mono chip with the tab id's
  first 8 characters after the name (hover: `tab <full id>`; a click opens that tab, as the name does), the text in the 13px reading
  face with real list markers and code chips, cut at ~7 lines under a fade with Show more; Show more opens it on the
  spring, Show less folds it back, a second press mid-slide turns it around. A short message shows no fold.
- [ ] (arcterm) **Chat: the sender's side of a message to another agent** (`chatagentsend.ts`,
  `chatagentsendcard.tsx`). In a Claude agent, have it write a message to a file and `wsh agents send <tab> --file <it>`,
  then `wsh agents wait <tab> && wsh agents read <tab>` with `run_in_background`, and Read the output file → after the
  send's tool line a card `→ message to <agent badge> · started a turn` with the file's text as Markdown and
  `from <file>` under it; after the Read, a card set in a step, `← answer from <agent badge>`, with the answer. Also
  `wsh agents send <tab> "x" --wait` in the foreground: both cards after the one call. A send to a closed tab: the
  card's border red and `not sent: …`. The badge opens that agent; a closed one reads as its id.
- [ ] (arcterm) **A Chat visual's scrollbar** (`bridgeScript` in `pkg/htmlserve/htmlserve.go`). A visual taller than
  640 px that scrolls inside its frame: no scrollbar until the pointer is over it, then a thin thumb as the app's own.
  Needs the rebuilt wavesrv.
- [ ] (arcterm) **A code block's sticky head when the pinned prompt leaves** (`useIsPresent` in
  `pinnedpromptbar.tsx`). In Chat, scroll a long code block under a pinned prompt so its head sticks, then scroll so
  the pinned prompt goes (to the end, or back to its bubble) → the head moves to the top at once, no gap above it
  with lines showing, no line hidden under it.
- [ ] (arcterm) **Sidecar's Resources under load** (`pollResources` in `sidecarbridge.tsx`). With the machine near
  100% CPU, open Sidecar's wall: the arcterm column reads `Can't read: the Resource Manager did not answer in time.
  Retrying…` in amber while reads time out, and its rows and charts fill once one answers; the last reading stays
  drawn through a later timeout.
- [ ] (arcterm) **Brainstorm tab: board thumbnails and the rail's dots** (`BoardChip` in `railbrainstormpane.tsx`,
  `RailTabStrip` in `agentrailpanel.tsx`, `RailStripTab.dot` in `collapsiblerail.tsx`). On an agent with a brainstorm
  that lists boards, open the panel's Brainstorm tab → each board is a card with the board drawn small at the card's
  width (a tall one cut at 150px), its name and `new` under it; a click, or Tab then Enter, opens it large in the dialog,
  and Esc puts focus back on the card. Before wavesrv serves the folder a card is its name only. While the agent asks
  through the brainstorm the tab's dot is amber (as the header's Brainstorm switch); otherwise accent while a board is
  new. Fold the panel → the strip's Brainstorm, Initiative and Council icons wear the same dots. Watch RAM with several
  boards listed: each card is a live page while the tab shows.
- [ ] (arcterm) **Chat tool rows: tooltip, sticky header, Collapse** (`frontend/app/view/agents/chatstepsview.tsx`).
  In Chat, hover a stretch line or row whose command is a long script → the tooltip is its one-line description. Open a
  row with a tall command/output and scroll down → the row's header sticks under the pinned prompt (not behind it) with
  the page background; click it, or Collapse at the row's foot → the row folds and Chat lands on the row, not past it.
  Check the box's rounded corners still clip, and a stretch/fold row still opens and folds on its spring.
- [ ] (arcterm) **`wsh protect` against a live wavesrv** (`cmd/wsh/cmd/wshcmd-protect.go`, `pkg/jobqueue`). In an
  arcterm terminal of a build with this change, run `wsh protect -- bash -c "sleep 120"` while an agent runs
  `task check:ts` → stderr says `protect waits #1 …`, it starts once the typecheck ends, the Jobs chip reads
  `Protected`, and an agent's `npx vitest run` then waits with `protected: bash -c sleep 120 is running`. Kill the
  `wsh` process (not its child) → the slot stays until the sleep ends. Restart arcterm mid-sleep → stderr warns
  `lost arcterm's job queue` and asks again; note whether it ever prints `Protect is back on` (the new wavesrv mints a
  new auth key, and may refuse the old terminal's WAVETERM_JWT). Unit and CDP-fixture tested only (the scenario injects the queue). Run
  cf8677a6.
- [ ] (arcterm) **Claude account rows keep their own limits** (`claudeQuotaFor` in `wshserver_agents.go`,
  `captureInherited` in `claudeaccount.go`, `cached` in `claudequota.go`, `session.measure` in arc-mod
  `register.ts`). Go tests only. With a token account active, Settings → Agents: the /login row's age stays under 5
  min and its Week matches `/usage` in a /login session; in a token agent run `claude -p "hi"` from its shell → that
  token row does not take /login's numbers and the agent's context % does not jump. Fixes the 18200210 row showing
  the /login account's 0%/51%.
- [ ] (arcterm) **Files tab: big repo listing, filter during reload, Ctrl+Shift+F to Code's Search**
  (`capListing` in `pkg/gitinfo/gitinfo.go`, `railtreepane.tsx`, `searchInCode` in `code/codestore.ts`). Go, vitest
  and the typecheck only; not run in the app. In mit-thesis (24k files, 11.6k untracked under
  `deltapov/results/aamas2027_rebuttal`): the Files tab shows "Showing the first 20,000 files" and filtering `PREREG`
  finds the two `harnesspov/results/*/PREREG.md`; while an agent turn ends (a reload) the filtered list stays instead of
  the skeleton. With focus in the filter box or the tree, `Ctrl+Shift+F` lands on Code, on mit-thesis, Search mode, the
  filter's text in the box and its results listed; with focus in the terminal, `Ctrl+Shift+F` still opens Transcript.
- [ ] (arcterm) **A new agent's name goes from your first message straight to its title, the words fading in**
  (`frontend/app/element/textswap.tsx`, `frontend/app/view/agents/launchtitles.ts`, `firstPromptTitle` in
  `cmd/wsh/cmd/wshcmd-agenthook.go`). Vitest and Go tests only; not run in the app. After installing a build with it,
  start a Claude agent from New agent with a task: the header and its tree row read the task's first line, never the
  project name, until Claude's title arrives; then the header's name changes in place, its words fading in left to
  right in about half a second. Switching to another agent swaps the name at once, with no fade. Branch
  `feat/title-swap`.
- [ ] (arcterm) **The link to wavesrv survives the launch stall, and a dead one reconnects** (`pkg/web/ws.go`,
  `frontend/app/store/ws.ts`, `frontend/tauri/stallwatch.ts`). Go and vitest tests only; not run in the app. After
  installing, quit and reopen arcterm a few times: `waveapp.log` should show no `WritePump error ... i/o timeout` in the
  first minute, sleeping agents get their titles, and a pasted picture sends. If a link does drop, the log shows
  `[ws] link closed …` or `[ws] link silent …` then `[ws] link reopened`, and the cockpit recovers within ~a minute
  without a restart. Each launch should also log `[stall] frame at …` lines for the post-render freeze: they name what
  held the main thread, the input for fixing the freeze itself.
- [ ] (arcterm) **An update removes the old `wsh` copies** (`NSIS_HOOK_PREINSTALL` in `src-tauri/installer-hooks.nsh`).
  Only the installer was built, never run. Install a build from this commit over an arcterm whose
  `%LOCALAPPDATA%\arcterm\bin` holds several `wsh-*-windows.x64.exe`: afterwards `bin\` holds `wavesrv.x64.exe` and this
  version's `wsh` only, and arcterm starts, its terminals have `wsh`, and an agent's hooks still report to the cockpit.
- [ ] (arcterm) **The release build itself, after the size cut** (`frontend/tauri/vite.config.ts`, `[profile.release]`
  in `src-tauri/Cargo.toml`). The dev app passed `code-ts-plain`, `code-diff` and `chat-math`, but the dev server
  skips the build-only parts. In the installed app: open a `.ts` file in Code (colored, no error toast), write a formula
  in Chat (KaTeX draws), open a board with Vietnamese text (Shantell Sans) and with Chinese text (draws in a system font),
  pick Hack as the terminal font, and play the Office music.
- [ ] (arcterm) **New File / New Folder in the agent panel's Files tree** (`railtreepane.tsx`, `createRailEntry` in
  `railtreestore.ts`). Unit tests and the typecheck only. Right-click a folder → New File, type `x.md`, Enter: the file
  appears selected under that folder and opens in the File tab. New Folder makes an empty folder that stays after
  Refresh; right-click blank space below the rows makes one at the top; `n` / `Shift+N` with the tree focused does the
  same at the cursor's folder; Esc or a click away cancels; a name that exists shows "Something with that name is
  already here." The Code tree's New File and Rename still work (their name row moved to `code/nameinput.tsx`).
- [ ] (arcterm) **A folded paste sent while the agent works reads as a Pasted card** (`unwrapWholePaste`,
  `chattagblocks.ts`). Unit tests only. While a Claude agent is working, type a line in Chat, paste 10+ lines (it folds
  into a chip) and send: once the transcript holds it, your bubble shows the line and a "Pasted · N lines" card, with
  no `<\pasted_content from="chat">` text, and the Queued bubble under the conversation goes away (also after
  switching surface and back).
- [ ] (arcterm) **A running Monitor's Output tab shows its output** (`transcriptprojection.ts`
  `extractBackgroundTasks` tasksDir, `agentsessions.ClaudeTasksDir`). Unit tests, the typecheck and the folder lookup
  against a real session only. Have a Claude agent arm a Monitor that prints a line every few seconds (`while true; do
  date; sleep 3; done`), open its row in the Agent tree and pick Output: lines appear while it watches, not "No output
  yet" until it ends. (A `CLAUDE_CODE_TMPDIR` set for one claude launch but not for arcterm is not followed: wavesrv
  reads its own environment.)
- [ ] (arcterm) **Sidecar's Resources panel opened right after the column closes starts on Measuring, not the
  column's history** (`sidecar.tsx` `useResourcesPanel`, `resourcesFor`). Unit tests and the typecheck only. With
  Sidecar wide (P) and its Resources column filled for a minute, narrow it to Q and at once click the title bar's
  RAM · CPU figures: the panel shows Measuring…, then a fresh series, never the column's 5-minute charts for half a
  second. Widen back to P: the column measures, then fills, likewise.
- [ ] (arcterm) **The File tab's Diff of an agent's edits ignores another writer's later change** (`filetabdiff.tsx`,
  `agentdetailsrail.tsx` `openChangedFile`, ac468412f). Typecheck only. Under a Claude agent that edited `a.txt`, add
  a line to `a.txt` yourself (another terminal), then open `a.txt` from the rail's Files changed: its Diff shows the
  agent's change and not your line, as the Diff surface's Agent's edits does; Source still shows your line. A file the
  agent deleted reads all removed. A non-Claude agent's file (no edits range) still diffs against the working copy.

## 2026-11-22

- [ ] (arcterm) **A board is a tree row and a cell beside Chat, in the real app** (`boards/boardcell.ts`,
  `agentsurface.tsx`, `agenttree.tsx`, a413d3393). The run's `boards-split` passed in headless Chrome only, never in
  WKWebView or WebView2. In an installed build, under a Claude agent that has drawn boards: the tree shows one row under
  the agent with its latest board's name and `+N` for the rest. Click it: the grid becomes `[Chat | board]`, half each,
  the tree stays open, and the header, ask bar and rail stay the agent's (`j`/`k` skip the board row). The header's
  switcher swaps the board in the same cell; Expand fills the grid and back. The board cell's x leaves Chat alone;
  the agent cell's x takes the board with it. From a 2x2, opening a board replaces the last cell that is neither the
  agent nor the focused one. Restart arcterm: the split with its board comes back. Switch to another project: Activity
  Monitor shows the renderer's memory drop as the canvas unmounts.
- [ ] (arcterm) **A long paste folds into a Pasted text chip** (`chatpastes.ts`, `chatpastechips.tsx`, f38640543). In a
  Claude agent's Chat, type a question, then paste 20+ lines of a log: the box keeps only the question and a "Pasted
  text · N lines" chip sits over it. Click the chip: the paste opens over the box in the frosted panel (as wide as the
  box, scrolls, Esc closes it and does not stop the agent). Edit in box puts it back fenced under the question; × drops
  it. Send: the bubble and Claude Code get the question then the fenced log. Switch surfaces and back: the chip is
  still there. A paste of 9 lines, a paste inside a ``` block, and a paste after `!` go in as text as before.

## 2026-11-20

- [ ] (arcterm) **Board light theme, tree fold animation, attachment icons** (`boardcanvas.tsx`, `agenttreeslot.tsx`,
  `attachmenttray.tsx`). On any open board (beside Chat, or Library → Boards) the sun at the canvas's top-right turns
  it white with Excalidraw's light controls and dark strokes readable; the moon turns it back; the pick holds after a
  reload. Clicking the agent strip slides the tree shut over ~0.35 s and open again, the chevron
  turning; the agent's terminal under Chat is not redrawn mid-slide. A `.pdf` dropped in Chat's box shows the red PDF
  icon in its chip, a `.xlsx` the spreadsheet one.
- [ ] (arcterm) **Library → Boards Reload** (`libraryboards.tsx`). Copy a board file into
  `<data>/boards/<project>/` by hand while Library → Boards is open: the ↻ button right of the search spins once and
  the board appears; switching to another surface and back to Boards also shows it. The search box still fills the
  rest of the 360px column.
- [ ] (arcterm) **Context alarm at 150k / 200k in Chat** (`ContextRing` in `chatfooter.tsx`, `ContextBody` in
  `chatlocalcards.tsx`, feat/context-alarm). On a Claude agent with a 1M window past 150k tokens, Chat's footer ring
  turns amber and reads `16% · 160k`; past 200k it turns red, as do the details rail's gauge and the header chip; a
  bare `/context` in Chat shows the card in the same color with "Every turn re-reads …". Under 150k it stays grey with
  the percent only.
- [ ] (arcterm) **Chat asks once to Compact or Clear past 200k** (`chatcontextnudgeline.tsx`, feat/context-alarm). On
  an idle Claude agent past 200k tokens, a red-edged line over Chat's box reads "Every turn re-reads 2xxk. Compact or
  clear before the next task?" with Compact, Clear, Later. It hides during a turn and comes back when idle; Later hides
  it for good until the context drops under 150k; Compact types `/compact` into the terminal and the context ring
  falls. A second agent past 200k shows its own line.
- [ ] (arcterm) **The rail's Changes tab hunks for a Claude agent and the branch view** (`railchangespane.tsx`, ported
  from the kael fork). The `rail-changes-hunks` scenario covers a pi agent's session list (closed start, Expand all,
  the sticky bar, `Shift`+`N`, `Shift`+`W`, the wide width). Still by hand: a Claude agent with its own edits, rail →
  Changes: the hunks are only its edits (B..H), not others' uncommitted work; on a branch off main, Branch shows the
  whole branch's hunks and Session its own again; Commit… opens commit mode and Done comes back to the hunks.

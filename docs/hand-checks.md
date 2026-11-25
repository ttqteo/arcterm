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

Older parts: [part 7](hand-checks-7.md) · [part 6](hand-checks-6.md) · [part 5](hand-checks-5.md) ·
[part 4](hand-checks-4.md) · [part 3](hand-checks-3.md) · [part 2](hand-checks-2.md) (oldest).

## 2026-11-25

- [ ] (arcterm) **Every port beside the server mark.** On an agent that left 3+ ports listening (e.g. `task dev`:
  vite, WebView2 CDP, wavesrv), its tree row shows every port after the green server glyph (`:5174 :9223 :58458
  :58459`), no `+N`; the agent's name truncates first, the ports stay whole. Also the project header row.

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
- [ ] (arcterm) **Pair two live agents and watch a full exchange end on a stop** (`pkg/agentpair`, the Add judge menu in
  an agent's header, `docs/guide/agent-pair.md`). The pair scenarios run on seeded pairs, so no agent has ever run one.
  With a Claude agent that has a plan open, Add judge → Open a new judge: a judge tab boots on Opus in the same folder,
  the working agent's header turns to "Paired with judge <id>", and the button opens the conversation. Watch the judge
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
  its message (the last one) a line reads "Gợi ý <one chip>" with a one-sentence reason and "· haiku, chỉ đọc reply"
  written under it, no hover needed; once you answer, that older line reads "· rê vào để xem lý do" and hovering its
  name shows the reason; that chip is first in the row with the scale icon. Do it on both paths: an agent whose arc
  mod makes the call at the turn's end (the mod path), and one whose mod is off (wavesrv's headless call), and check
  each answer's chips have a pick, a reason and a neutral description (spec "Light mark"; `pkg/chatsuggest`,
  `claude/arc-mod/hooks/register.ts`). A yes-or-no question or a turn with no question gets no line.

- [ ] (arcterm) **Judge for a choice question, the deep judge on a real project** (nothing in the Final starts sonnet).
  On the turn above press Judge kỹ (or Alt+J) with the agent's project open: the line reads "Judge đang đọc code, không
  thấy agent khuyên gì · N s" with the seconds ticking and Dừng; when it ends it reads "Judge chọn <pick>" with
  `sonnet · N file · N s` at the end and the reason on hover, the judged chip moved first (an option the agent never
  named is a chip of its own and sends its description and facts). `waveapp.log` holds one `chatjudge: … role=chat-judge
  state=done model=sonnet …` line, and no arcterm hook fired for the judge session (no row in Active, no session in the
  project's History). Press Dừng mid-way: the line goes back to the light mark; answering with a chip while it reads
  stops it too. Quit and reopen arcterm: the line under the old message is still there.

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
  reads Conversations, Canvases, Councils with a small 1 2 3 key on each, the selected tab filled, and it is not clipped
  or doubled when the window is narrow (rail labels hidden). Open a session from Usage: it fills the page, no list
  beside it, with Back at its top left. Switch tabs and the body fades in once, with nothing jumping. `librarysurface.tsx`;
  `library-tabs` shows the structure and its shots, not whether it looks right.
- [ ] (arcterm) **Resume from a council read in Library lands on Agent; Run again from its Summary lands on Agent's
  Setup.** Open a council that left the Agent tree (Library → Councils → a council ended days ago), press Resume on its
  row or in its Report's menu: the surface becomes Agent, the council is back in the tree and its Discussion is open
  with the box focused. From the same Summary press Run again: Agent's council Setup opens with that council's draft.
  `councilresume.tsx`, `councilsetup.tsx`; no scenario.
- [ ] (arcterm) **A council that ends while open in Library gives no toast and no dot; removing it returns Library to its
  list.** With a running council open inside Library (Library → Councils, open one with `wsh ui` or the list) let it
  end: no "Council done" toast and no unread dot on its row in the Agent tree. Remove a council (its menu → Remove) while
  Library shows it: Library goes back to the Councils list. `councilnotifysync.tsx`, `councilremove.ts`; `library-tabs`
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
- [ ] (arcterm) **Remote mode through Tailscale on a real phone.** Only fakes have run `tailscale serve` (the
  `remotemode` tests). Step 10 of `remote-switch` (the Connection card with Tailscale picked) was written but its run was
  stopped for low memory: run `task verify:ui -- remote-switch` first. Turn HTTPS on for the tailnet (admin console →
  DNS), then Settings → Remote → Connection → Tailscale: the tailnet address and login fill in by themselves; turn
  Remote on → the footer reads Remote on and `tailscale serve status` lists `https://<pc>.ts.net` proxying to
  `127.0.0.1:47821`. With the phone's Tailscale app logged in as the same user, open that address in Safari, add it to
  the home screen, turn on notifications; an agent's question pushes and an answer reaches the agent. A device logged
  in as another tailnet user gets 403. Turn Remote off → `tailscale serve status` reads "No serve config" again (the
  foreground serve dies with its child; if a config stays behind, `tailscale serve reset` clears it and the kill path
  needs a fix). Commit: feat(remote) Tailscale as a second way in
- [ ] (arcterm) **Remote mode on a real phone (ported from the kael fork).** The `remote-switch`, `remote-hand` and
  `remote-phone` scenarios cover Settings → Remote, the footer chip, the More menu's Hand to phone and the phone page
  against fixtures; nothing has run against a real tunnel. With a Cloudflare named tunnel and an Access app set up as in
  `docs/remote-phone.md`: `wsh remote on` → the footer reads Remote on; install the page on an iPhone from Safari, log in
  from inside the installed app, turn on notifications; an agent's question pushes to the phone and an answer there
  reaches the agent; with Telegram paired too, the question goes to both and the first answer wins (the other side says
  it was answered). Hand a claude agent over (`p`): its transcript, a prompt, Stop and a permission Allow work from the
  phone; Take back returns it.
- [ ] (arcterm) **No white flash switching between HTML files.** Lint and the typecheck only. Open two dark HTML
  pages as tabs in the File pane (or Code), switch back and forth: the pane stays dark until the page draws, a page
  with no background still shows on white, and a kept scroll position still comes back.
- [ ] (arcterm) **A refused Stop says why: on a dev server's rail row, and in a toast from an app's menu.** The
  `rail-servers` scenario fails at its first step on main too, so the row's new error line was never drawn. Run a
  server as admin (an elevated shell: `npx http-server -p 8099`), let an agent in a normal arcterm list it in its rail,
  then Stop, Stop? → a red "Couldn't stop it: Access is denied." line under that server's row, which stays listed. An
  app (Setup → Tools service) whose Stop wavesrv refuses → a toast "Couldn't stop <name>". Commit: fix(servers) a
  refused Stop says why
- [ ] (arcterm) **Keep running, then Opens in at once, keeps Keep running; a built-in's Opens in writes no command.**
  Setup → Tools, a tool of yours with a page: click Keep running, then at once change Shows → reopen Setup → Keep
  running is still on, and `tools.json` has `"autostart": true`. Then lazygit: change Opens in → its `tools.json`
  entry has `opensin` and no `command`. An entry an older arcterm wrote keeps its command until Reset. Commit:
  fix(services,tools) one tab per service, built-in overrides without a command
- [ ] (arcterm) **An agent with no project sits in No folder, with the terminals that have none.** Start a Claude agent
  from a folder that is no project (New → No folder) and open a terminal with no project → one No folder folder at the
  bottom of the Agent tree holds both, agent first, a divider, then the terminal; there is no "ungrouped" folder. No
  folder has no right-click menu, so such agents have no Close project. Commit: fix(agent tree) one No folder
- [ ] (arcterm) **No folder in the New dialog's Tool row opens in home with a project named Home.** Add a project named
  `Home` (any folder), then New → Tool → No folder → lazygit (Opens in: root) → it opens in your home folder, under No
  folder in the tree, not in that project's folder. Commit: fix(agent tree) explicit Home pick
- [ ] (arcterm) **A remote terminal never reads as in a removed folder.** With an SSH connection, open a remote
  terminal in `/tmp/x` and a local Git Bash one in `/tmp/x` too, then delete the local folder → only the local
  terminal shows the folder-gone card. Commit: fix(servers) remote terminals never read as in a gone folder
- [ ] (arcterm) Focus read's step buttons and per-agent toggle (`chatpane.tsx` FocusReadSteps, `chatfocusreadstore.ts`):
  with focus read on, the K / J / Q column under the toggle sits clear of the pinned prompt card and reads well in a
  light and a dark theme; holding ↓ steps block after block with no judder; turning it on for one agent in a 2x2 split
  leaves the other cells undimmed, and it is still on for that agent after a restart.
- [ ] (arcterm) Focus read skips what is not text (`chatfocusreadview.ts` `data-fr-skip`): on a real agent's turn with
  tool steps and a command card between paragraphs, `J` / `K` and a stopped scroll pass over them to the next paragraph,
  they stay at 32% and are never lit, and the paragraphs either side of the lit one sit at 50%. The `chat-focus-read`
  fixture has no tool steps, so the scenario checks only the 50% neighbours; the one pill (toggle over K / J, a hairline,
  Q) also reads well in a light theme.
- [ ] (arcterm) A folded message of yours (`narrationtimeline.tsx` PromptText): in Chat, folded, a click anywhere on the
  bubble (its padding too) opens it, and its hover Copy / Fork row under it still works; open, a click on its text does
  nothing and the text selects, and only Show less folds it. A bubble with a pasted block card: the card still opens on
  its own while the text above it is folded. Same in Conversation History's transcript and a pending bubble. No scenario
  opens a folded bubble in History or a pending one (`chat-bubble-fold` covers Chat).
- [ ] (arcterm) Sending to an idle agent in Chat (`chatlive.ts` liveTurn, `chatpane.tsx`): when the last turn ended
  with an "Edited N files" card, the card stays where it is from the send until your message lands and the new turn
  starts (it used to fold away at the send and spring open again up to 3 s later). A message queued while the agent
  works leaves the working turn's card held back as before. Checked only by unit tests.
- [ ] (arcterm) Chat around a send (`chatpending.ts` sending, `chatpane.tsx` WorkingLine, `chatconversation.tsx`
  ownArrives): send to a Claude agent that is busy redrawing (just after a turn ends, or while it starts) and the
  bubble stays until your message lands, never blinking out at 5 s; as the turn starts the working line opens under
  the bubble and as it ends folds away, with the conversation gliding rather than jumping; a message typed straight in
  the terminal opens into Chat on the spring. Measured in headless Chrome with a fixture agent (a scripted send,
  live reply and transcript), not yet with a real Claude agent in the app.

## 2026-11-17

- [ ] (arcterm) **Session search on your real transcripts.** The three `session-search-*` scenarios answer the search
  from a mock; nothing has run `SearchSessions` over real transcripts in the app. Agent → Conversation History → type a
  word you remember from an old Claude conversation → "N results" (with "· indexing…" the first time, clearing on its
  own within seconds), each card with the word marked in its snippet; click one → it opens with the find bar at the
  hit, Enter / Shift+Enter step through the matches, Esc closes the bar. New agent → Claude → `/` or the Session
  column's magnifier → the same word lists title and "Matched by content" rows. Note how long the first search takes.
  `conversationhistory.tsx`, `launcherresumelist.tsx`, `sessionsdetail.tsx`; commits 4b9814411, c7fdf4883, 104a440a8.
- [ ] (arcterm) **Closing Sidecar frees its two window icons; a reopen still draws the badge.** Windows only; the code is
  unit-tested but was never run in an app. Open Task Manager → Details, add the "GDI objects" and "USER objects"
  columns, then open and close Sidecar (Ctrl+P → Open Sidecar) ten times → arcterm's counts come back to the same
  level after each close instead of growing by two per cycle, and after each reopen the title bar and the taskbar
  button still draw the screen-badge icon. Commit: fix(sidecar) free the window's icons when Sidecar closes
- [ ] (arcterm) **Sidecar P/Q across a real day: the question heuristic's misses, the ping from across the room.** The
  `sidecar-orbit` and `sidecar-compact` scenarios read fixtures: they cannot judge a real day. With real agents for a
  day: (1) a finished agent whose last message asks something gets a Needs you row (Enter: reply in the main window),
  and a rhetorical question at the end of a report does too, which is the miss to count (spec "Open": a miss only adds
  a row, and answering or opening it clears it); note the false rows and any question it did not catch. (2) From across
  the room (a second screen, 2 m away), a waiting node or row pings and you see it without reading; nothing else on the
  screen moves. (P's RAM after a day was read on 2026-11-24: the "Sidecar, part 3" row of `docs/open-issues.md`.)
  Commit: test(sidecar) CDP scenarios for the orbit dashboard, full and compact
- [ ] (arcterm) **Packaged build: Sidecar has its own taskbar button with the screen badge, not arcterm's icon;
  right-click shows no "Pin to taskbar"; closing arcterm closes it.** Windows only; the dev app shares the exe's icon
  either way and the `sidecar-orbit` scenario only reads the log line `[sidecar] app id dev.arc.app-dev.sidecar`. Install
  a `task tauri:build` build and open Sidecar → it is its own taskbar button, not grouped under arcterm's, drawn with
  arcterm's mark and a small screen badge in its corner; right-click its button → no Pin to taskbar (a pin would relaunch
  arcterm, not Sidecar); close the main window with the tray icon off (Settings → `app:tray`) → Sidecar closes with it.
  The spec's open question is answered here: which icon Windows draws for a window whose id has no shortcut, the
  window's own (`WM_SETICON`) or the exe's; if the exe's, say so and the host's icon call is the next thing to look at.
  Commit: feat(sidecar) its own taskbar button and icon on Windows
- [ ] (arcterm) **The one-line Chat box's menus and asleep line.** The `chat-redesign` scenario checks the row, the
  grown box and the line under it, not these. In Chat with a live Claude agent: click the model ("Opus 5.5 High")
  under the box → its menu opens upward, its right edge on the model's, and Effort / More models open their panels to
  the menu's left, all on screen in a narrow float window too; the permission mode opens its menu the same way. Put the
  agent to sleep → "Asleep · …" with the moon sits at the left of the line under the box, the model muted at its right,
  `+` gone from the box and Send reading Wake. `chatfooter.tsx`, `chatcomposer.tsx`.
- [ ] (arcterm) **The When row's choices are pill badges.** Prettier only. + Run → a project → the third column's
  When row shows Run now, After run… and Queue as separate rounded pills (wrapping on a narrow column, "After run…"
  never cut off), the picked one accent-tinted, and the one Jarvis suggests carries a small "Jarvis" badge inside it
  instead of a "Jarvis suggests" line under the label; `task verify:ui -- run-start-choice` still passes.
  `launcherwhenrow.tsx`.
- [ ] (arcterm) **A pencil marks an agent with an unsent message.** Vitest and the typecheck only. Type half a message
  (or attach a file) in one agent's Chat box, pick another agent → the first one's row in the Agent tree shows a small
  accent pencil after its name (also in a split row's cell); pick it again → the pencil is gone while you are on it;
  send or clear the box → it does not come back. Commit: feat/draft-mark.
- [ ] (arcterm) **Sleeping agents keep their titles across a restart.** Vitest and the typecheck only. With several
  agents asleep (some on transcripts of a few MB), restart arcterm a few times → every sleeping row in the Agent tree
  shows its conversation's title, none its project's name; if a row starts as the project's name it turns into the
  title within a minute (`sleepertitles.ts`, the read queue that retries).
- [ ] (arcterm) **A first review fail reopens the worker's session.** Go unit tests only, with the resume stubbed; no
  engine run (commit 01900d143). (1) Run a small plan with a claude worker whose task the reviewer will fail (a task
  that asks for a test it skips). → On the fail, the worker's own tab restarts with the findings as its first prompt
  (scrollback above it), no new worker row appears in the Agent tree, and the run timeline shows `t-N: review fix
  round in the same session`. (2) The worker fixes, runs `wsh jarvis complete`, and the second reviewer starts; the
  task does not stall in the first minute after the reopen. (3) Restart arcterm between the worker's complete and the
  fail (no context figure survives a restart) → the timeline shows `t-N: fresh worker: the worker reported no context
  size` and a new worker tab starts as before.
- [ ] (arcterm) **Sidecar keeps asks, answers the ask you saw, and fills a high-scale screen.** Vitest and the
  typecheck only; no dev app ran (branch `fix/sidecar-council`). (1) Set the Cockpit's project filter to one project,
  or send an agent to Background, and have that agent ask a 2-option question: it shows on Sidecar's orbit (P) and in
  the compact window (Q) as a Needs you row. (2) Answer the row with 1: it lands as before; `answer … refused` in
  `waveapp.log` only when the ask changed under you. (3) On a 1920 px screen at 175%, maximize or full-screen Sidecar: P
  shows, not Q; drag it narrow and Q comes back. (The wall and its tiles went with the orbit dashboard; the
  `sidecar-orbit` and `sidecar-compact` scenarios read the same rows.)
- [ ] (arcterm) **Close on the Agent tree's picked rows.** The `tree-multi-close` scenario reads the menu and the
  confirm on a fixture roster and cancels; nothing was ever closed. In the app, Ctrl+click two idle agents (no run) in
  the sidebar, right-click one → Close 2 agents closes both at once, a toast says "Closed 2 agents", the picks clear,
  and both sit under Conversations to resume. With one working, it asks first naming it; with a run's lead picked too,
  the item says "1 in a run stays" and the lead stays open. Commit 21e72f9cd.
- [ ] (arcterm) **No terminal card over a prompt that is up.** Vitest only (fixtures with their rules joined, as
  `readTermLines` gives them); never tried in the app. In a Claude agent in auto mode, let it stop and wait on you
  (a Notification, or a brainstorm question): Chat shows no "Waiting on you in the terminal" card quoting
  `⏵⏵ auto mode on`. Press Shift+Tab in the terminal a few times: the mode chip under the chat box follows each mode.
  Have it run a Bash command that needs permission: the dialog card's text holds no `╌╌╌` lines
  (`tuiscreen.ts` `splitRules`, `tuiPromptUp`).
- [ ] (arcterm) **Agents start without a PowerShell around them (Windows): a new agent and a run worker.** Resumed
  Claude agents are checked (build ee9ef3a4c: four `claude.exe` straight under wavesrv, hooks reporting, `wsh` found).
  Still untried: launch a new Claude agent and start a run worker; each works as before and has no `powershell.exe`
  above its `claude.exe`. A pi or codex agent (a `.cmd` shim) still has its PowerShell. If something only your
  PowerShell profile set is now missing for an agent, that is this change (`shellexec.directProgram`).
- [ ] (arcterm) **No `/compact` loop before a sleep.** Unit tests only; never tried in the app. Have a Claude agent
  with 100k+ of context go idle (sleep on, After idle for short), off screen, so the sleep loop compacts it: Chat
  shows one `/compact Keep: …` and the agent sleeps once it lands. Run `/compact` by hand right before so the loop's
  one answers "Not enough messages to compact": the agent still sleeps within a minute, with no second `/compact`
  10 minutes later. With a session moved to the background from that tab, `waveapp.log` shows no "dropped
  PreToolUse's working … reported after its turn ended" for its tools. Commit 0102ea983.
- [ ] (arcterm) **Closing a brainstorm.** Unit tests and the typecheck only; never tried in the app. In an agent with a
  brainstorm open: (1) ⋯ → Close brainstorm. The Brainstorm tab, the header strip and the Chat card go, the agent gets
  `brainstorm: close` (hidden in Chat) and answers in the terminal, and the earlier ✓ rows stay ✓ rows rather than raw
  `brainstorm: …` bubbles. (2) Open another one, type "off brainstorm, bàn tiếp" to the agent. It runs
  `wsh brainstorm close <path>`, prints "Closed the brainstorm …", the same three things go, and a toast names it.
  (3) Resume it from the palette (Brainstorms ›) and the pane comes back on its open question.
- [ ] (arcterm) **A council's Summary uses the Discussion's `canSummarize`.** Vitest and typecheck only. Open a council
  whose only idea is a held draft (Summary, no summary yet) → no Summarize button; one with a sent idea that is done,
  stopped or failed in round 1 → Summarize shows, and Summarize again is on once there is a summary. Commit: the
  `chore(council): Summary uses canSummarize …` one.
- [ ] (arcterm) **Prettier sweep reordered imports in the palette, the route picker and the run sheet.** Typecheck,
  eslint and the bindings/palette/route vitest only; no change meant, but import order sets module load order. In the
  dev app open the command palette (Ctrl+P), a launcher's model picker, and a run's sheet in Jarvis → each opens and
  draws as before. Commit: c378f3486.
- [ ] (arcterm) **The arc mod's gating hooks carry a `.catch`.** Vitest, the mod typecheck and `claude plugin validate`
  only (all 15 now listed "with .catch"). The handlers run only when a hook fails, so day to day nothing should change:
  after `wsh install-agent-hooks` (or a launch), in a Claude session in arcterm run a Bash command, edit a file in the
  session's repo, send `@<tab id> hi` to another agent and start a subagent → each behaves as before, with no `arc:`
  hook failure line in the transcript. Commit: the `chore(arc-mod): .catch …` one.
- [ ] (arcterm) **Claude Code's folder trust prompt shows in Chat as a card.** Unit tests on a screen written from a
  screenshot only, no dev app ran (commit "fix(chat): Claude Code's folder trust prompt shows as a card"). Resume a Claude
  agent in a folder Claude Code does not trust yet (another drive-letter case of a trusted one did it on 2026-11-17):
  Chat shows a yellow card titled `Accessing workspace:` with its text and two buttons, `No, exit` and `Yes, I trust
  this folder` (no numbers), the second one highlighted. Yes picks it (the terminal moves on past the prompt) and the
  card goes. If no card shows, the prompt has no solid rule over it on the real screen: capture its PTY output for
  `tuiscreen.fixtures.json`. With wavesrv from "fix(agents): an agent on Claude Code's folder trust prompt reads
  asking" (Go tests, and the scanner on that agent's real stored output, only), the agent also reads asking in the
  tree and counts in Needs you while the prompt waits, even unopened (`waveapp.log`: "shows Claude Code's folder trust
  prompt; reading it asking"); after Yes it reads idle, or working on the restore's nudge, and after No, exit idle.
- [ ] (arcterm) **Opening a run from an agent shows it in the Agent tree, not Jarvis.** Unit tests (`runTreeAgent`) and
  typecheck only, no dev app ran (commit "fix(agents): a run opened from an agent shows in the Agent tree"). With a
  brainstorm whose approved run is under way: click its run line in the tree (`working · …`, title Show the run in the
  tree), its pane's Open run, and Open run on Chat's run card → each stays on Agent, selects the run's lead (or, with no
  lead tab, the run's agent that asks or works) and unfolds the run's lanes under it. With the lead closed and no task
  at work, each opens the run in Jarvis as before.
- [ ] (arcterm) **A canvas board's screenshot button shows a camera.** Typecheck only, no dev app ran (commit
  "fix(canvas): the board's screenshot button shows a camera"). Open an agent's Canvas: the board's top-right button
  reads a camera icon then `Copy`; a click turns it into ✓ `Copied` and puts the board's picture on the clipboard.
- [ ] (arcterm) **An unclosed tag in a Markdown Preview shows as text; a highlight around a bare link closes.** Unit
  tests only, no dev app ran (commit "fix(markdown): an unclosed tag in a Preview shows as text; a mark closes on the
  == a bare URL swallowed"). Open `harnesspov/harnesspov/agent/prompts/system.md` (mit-thesis) in Preview: line 4
  reads `"script":"<a complete Node CommonJS script>"}` as written and nothing after it is blue. A `<details>` with
  its `</details>` in a README still folds. In Chat, an answer with `==… http://localhost:4321/.==` draws the sentence
  highlighted with no `==` showing, the link ending at `4321/`.
- [ ] (arcterm) Agent header buttons: open an agent → the header has More (⋯), Float and Close, no Split or Fullscreen
  button; ⋯ lists Split (its submenu) and Fullscreen terminal. Settings → Appearance → Agent header: turn Split and
  Fullscreen on → both buttons come back and Split leaves ⋯; turn Float off → its button goes and ⋯ lists Float window.
  The `agent-header-redesign` scenario's step 6c covers it (`headerbuttons.ts`).
- [ ] (arcterm) Canvas quick pick with a comma: have an agent draw A-/B-/C- option boards and end its reply with
  bullets like "**A, chip trầm** (…)" and a question → the quick pick card shows rows A, B, C instead of only the
  "A đi" chips. Unit-tested only (`chatcanvaspick.ts` `namedLetters`), not tried in the app.
- [ ] (arcterm) A brainstorm's cards after its run: Approve a brainstorm and let the run finish, then, without
  restarting arcterm, keep talking until the agent sets `run` back to null and asks again (a question or a builder
  check) → Chat shows that card. Before, Approve's in-memory start mark brought the finished run back and its folded
  card hid every later one. Unit-tested only (`brainstormpoller.ts` `settleBrainstorm`), not tried in the app.
- [ ] (arcterm) Heavy jobs popover from a tree tag: with a job queued, click an agent's `#1` (or a run's `×2`) in the
  Agent tree → the popover opens with that agent's (or run's) job rows drawn selected and scrolled into view; the app
  bar's Jobs chip opens it with none selected. Unit-tested only (`jobqueuestore.ts` `toggleJobQueue`), not tried in the app.
- [ ] (arcterm) No keycap beside the view switch: open an agent with a canvas → no Alt+C keycap in the header, Alt+C
  still walks the views. Typecheck only, not tried in the app.
- [ ] (arcterm) Chat's tool box in the real app: in a live Claude agent's Chat, open a finished stretch → one bordered
  box, a plain row per tool with past-tense verbs and no icons; open a Bash row → `$ command`, its output, Open full
  view; click an edited file's name → the File tab opens it; a stretch with a failed Edit → "Edit failed" in red on its
  row, the folded line stays muted; no file chips under a stretch. Checked only in the headless-Chrome build
  (`agent-chat` CDP), not in WebView2, and not in a light theme (`chatstepsview.tsx`).
- [ ] (arcterm) Checks after a brainstorm's run starts: brainstorm with a builder check (and a judge), Approve, and let
  the run start → the brainstorming agent's row loses its checks chip (`> ✓`) and the check rows under it; a check that
  still asks, or the one selected, stays. Unit-tested only (`agenttreemodel.ts` `checksSuperseded`), not tried in the app.
- [ ] (arcterm) A `wsh detach` server has an owner: in an agent, `wsh detach npm run dev` in a repo with a dev server →
  the footer's Servers names `claude · <agent>` on its row instead of "no owner", and Log opens the `arc-detach` log;
  the agent's tree row shows a green server mark with `:<port>`, and folding its project's folder shows the port on the
  folder. From a plain terminal, the row reads `terminal · <name>` and Log opens the file, not the pane. Close the agent
  → the row keeps its name. Unit-tested only (`pkg/devservers/detached.go`, `treeservers.ts`), not tried in the app.
- [ ] (arcterm) The Agent sidebar is 280px with RAM and Tokens on and Age off (`agentTreeWidth`, `rowfields.ts`): in
  Settings → Appearance → Agent sidebar turn Age off; the sidebar stays 280px and a lead's second line reads its words
  (`Working · 0/7`), not `W… · 0/7`. Turn Tokens off too and it narrows to 248px.
- [ ] (arcterm) The agent header drops its button words when short of room (`nextHeaderLabels`, `headermodel.ts`):
  with an agent that has Ship and Close, narrow the window or open a split until the header crowds; Chat, Terminal,
  Ship and Close become icons, the model and context (`opus 120k`) never draw under the Chat switch, and widening
  brings the words back without flicker. Hovering Close names the session's tokens.
- [ ] (arcterm) A relaunched lead stays on its run's row (`isCurrentLead`, `staleLead`, `runlineage.ts` /
  `agenttreemodel.ts`): with an orchestrator run executing, restart arcterm (or let its lead die so the engine
  relaunches it); the run's row in the Agent tree is the new lead's, working, and the old lead's sleeping tab has no
  row of its own. An agent whose brainstorm run was cancelled and queued again reads `plan queued #N` alone, with no
  `cancelled · run …` beside it.
- [ ] (arcterm) The Heavy jobs popover keeps its place after Run now (`usePanelPlacement`, `consumerspanel.tsx`): open
  it from a waiting agent's `≡#1` tag in the Agent tree and press Run now on that job; the tag goes, and the popover
  stays hanging where it opened, not in the bottom right corner. The same from the app bar's jobs chip.
- [ ] (arcterm) A server mark keeps two ports (`shortPortsLabel`, `devserversmodel.ts`): an agent or run row in the
  Agent tree whose background servers listen on four ports reads `:5175 :9230 +2` beside the green server glyph, and
  hovering it lists all four ports with their commands.
- [ ] (arcterm) Chat's Working dot crackles (`workingglyph.tsx`, `pulse.ts` noise pulses): with a live agent working,
  watch the dot for ten seconds: bolts strike at different angles and lengths, the core flickers, the dot and the
  `Working…` words jolt now and then but stay readable, and it does not feel frantic. The CPU in Task Manager stays
  where it was with the old dot (the driver is still 12fps).
- [ ] (arcterm) Chat ref badges with real data: in a live agent's Chat, pick an agent, a run and a council from `@` →
  each shows as a tinted badge with its name (the box keeps the text `agent:<8>`); send → the bubble's badges open the
  agent's terminal, the run in Jarvis, the council's discussion; Ctrl-click peeks; a working agent's badge pulses green
  and an asking one shows an amber ring. A token or an @path typed or pasted into the box becomes a badge or a file pill
  once a space or punctuation follows it; deleting one leaves one space.
  Checked only with seeded atoms in the `chat-ref-badges` CDP scenario, not against a real project's runs and councils.
- [ ] (arcterm) Chat ref badges: a session: of a recent conversation shows its title and age and a click reopens it as an agent; an effort: whose chunks are all done shows its done/total in green
- [ ] (arcterm) Chat box: a token finished through Telex (the IME's composition end) becomes a badge, and a real clipboard paste of `xem run:<id> agent:<id> ` gives two badges; the scenario types with key events only, so neither path ran in a live app
- [ ] (arcterm) A calmer turn in Chat with a live agent (`chatsteps.ts`, `chatstepsummary.ts`, `chatturnfiles.tsx`): while
  it works, a running stretch stays one folded line with its spinner and opens only on a click, and the Working line
  reads `Working` and its stats with no `· <activity>` tail; a stretch of one described command reads as its
  description; a finished stretch under 10 s shows no time. When a turn that edited files ends, a card lists them with
  their +/− lines; a row opens the Diff on that file and See all opens the agent's whole Diff. Checked only in the
  `agent-chat` CDP scenario with fixture turns.
- [ ] (arcterm) Focus read in Chat (`chatfocusreadview.ts`): with a real wheel and a trackpad, a stopped scroll settles the nearest block onto the line in one short glide and never fights an ongoing fling; `Space` / `Shift+Space` step like `j` / `k`; with reduced motion the step jumps and the dimming has no fade; while a live agent writes a reply and you sit at the bottom nothing is dimmed, and scrolling up brings the dimming back; `j` / `q` typed with Telex on act as keys in the conversation. The `chat-focus-read` scenario drives keys and `scrollTop` only

## 2026-11-16

- [ ] (arcterm) **The Token burn gate gathers parallel spawns on `$.clock.sleep`.** Vitest and the mod typecheck only.
  The gate's gather wait used `setTimeout`, which a mod's declared environment does not have; whether it was missing at
  run time was never seen. After `wsh install-agent-hooks` (or a launch), have a Claude session in arcterm start 3
  subagents in one message → one Token burn card naming 3 agents, and no `arc: tool.call hook` failure line in the
  transcript. Commit: the `chore(claude-mods): typecheck …` one.
- [ ] (arcterm) **A run's Setup no longer holds the dag lock.** Go tests and the `dag-preparing` CDP scenario only (a
  seeded dag in a worktree dev app); the run's Final ended unverified on one flaky wshserver test. On the installed
  build, run a plan of three or more tasks in this repo (its `.arc/setup` makes each tree): the task cards read
  "preparing its tree" for a moment before running, and `waveapp.log`'s `dag <id> lock:` lines no longer name
  `dispatch` as the slowest phase with holds of 10 s and more (`66bea964a`).
- [ ] (arcterm) **A lead's tell reaches the worker, not its `claude -p`.** Mod tests and `claude plugin validate`
  only. On the installed build, in a run whose worker runs `claude -p "sleep 60 with Bash, then say done"`, send
  `wsh jarvis dag tell <task> "<note>"` while it waits: the worker's own session takes the note (mid-turn), and after
  the nested run exits a second tell still reaches it over the stream, not typed into the composer (`bf4c55362`).
- [ ] (arcterm) **Diff n / p open a collapsed folder.** Unit tests and typecheck only, no dev app ran. On Diff in tree
  mode with changes in two folders, collapse the second, then press n until the next file is in it: the folder opens
  and the file's row is selected on screen (3bc4f85dc).
- [ ] (arcterm) **The Cockpit's Enter sends a typed answer.** Typecheck only, no dev app ran. With an agent asking one
  question on the Cockpit, type an answer in its box without picking an option, move focus back to the card and press
  Enter: the answer is sent, not the agent opened (3bc4f85dc).
- [ ] (arcterm) **The Chat being read keeps its place when a launch finishes starting.** The CDP scenario
  `chat-scroll-keep` (step 2b) checked it over a fixture roster, not a real launch. + New a Claude agent in another
  project, switch to an agent whose Chat you have scrolled halfway up before the new one's Claude answers, and wait for
  its title and first message: the Chat stays where you were reading.
- [ ] (arcterm) **A message sent mid-turn keeps the agent working.** Unit tests only; the installed mod needs an
  arcterm launch to pick it up. While a Claude agent runs a tool, type a message in Chat so it queues and interrupts the
  tool: Chat keeps "Working · …" under the reply and `wsh agents list` reads `working` through the rest of that turn,
  and wavesrv's log has no "dropped PreToolUse's working … reported after its turn ended" lines for it.
- [ ] (arcterm) **A Work on session keeps its initiative.** Go tests only, no dev app ran. In Jarvis, Work on an
  initiative whose notes point at another one, and ask the agent to `wsh effort show` that other initiative: the Agent
  header's ◇ chip and the rail's Initiative tab keep the one you picked (63184f53b).
- [ ] (arcterm) **The chat box answers a single question.** Unit tests and typecheck only, no dev app ran. Have a
  Claude agent ask one AskUserQuestion, then type a reply in the chat box (not the card) and press Send: it goes at
  once, the card closes, and the agent goes on with your words as the answer, with no "Queued · sends once you answer"
  line. An ask of two questions still shows that line and holds the message.
- [ ] (arcterm) **A send to a killed agent is refused.** Unit tests only; the shell reading (`shellHoldsNothing`) never
  ran against a real terminal. Start claude in an agent tab, then kill its process (Task Manager, or `taskkill /PID`,
  not `/exit`) so the tab is back at its shell prompt: `wsh agents send <tab> hi` from another agent answers "back at
  its shell prompt … nothing was sent", and nothing is typed into that shell. A send to a live agent still goes
  through. Try it in a Git Bash tab and a PowerShell tab (Git Bash hides MSYS children from Windows, native ones it
  shows), and on a Mac (the process list reads differently there).
- [ ] (arcterm) **The Jarvis hologram no longer drops to the pixel pet.** Unit tests and typecheck only, no dev app
  ran. Use arcterm a working day with many agents and terminals opened, closed and switched between: `waveapp.log`
  has no `[hologram] failed` line, the hologram never turns into Sprout/Minion for 5 s, and terminals still draw sharp
  (WebGL) after switching back to one hidden for over 30 s.
- [ ] (arcterm) **A finished run or council stays where it finished in Chat.** The CDP scenario `chat-council` checked
  the council cards on fixtures; the run ✓ row has no scenario (unit tests only). In a real agent that ran a run and a
  council, keep talking after both end: the Done council card stays just above the agent's summary of it and the run's
  ✓ row where its `[arc] Run … landed` message came (a quick run, which sends none: after the last tool call before it
  finished), both scrolling away with the conversation; only a run or council still going sits at the bottom.
- [ ] (arcterm) **Chat's selection has softly rounded corners.** CSS only, no dev app ran. In Chat, select a word and
  then a few wrapped lines: each highlighted line has 3px rounded ends, and the lines still meet without a gap that
  reads as broken.
- [ ] (arcterm) **`[` `]` on an open brainstorm board stay in the asked part.** Unit tests and typecheck only, no dev
  app ran. In a brainstorm whose open question's part has two or more boards (and another part has boards too), open
  one from the rail's Boards tab: `]`, `[`, `←` and `→` cycle only that part's boards, never the All view or another
  part's board, and the dialog's title follows. (a411573de)
- [ ] (arcterm) **A narrow brainstorm run step stacks.** Unit tests and typecheck only, no dev app ran. Narrow the Agent
  pane under ~820px on a brainstorm handed to a run: the run's rail sits under the summary at full width, not 460px
  beside it; under ~520px each "What you handed over" row puts its gist under its title. (66933b70e)
- [ ] (arcterm) **A brainstorm waiting on you does not take the keyboard.** Unit tests and typecheck only, no dev app
  ran. Pick, with `j`/`k`, an idle agent whose brainstorm asks a question: `j`/`k` keep moving the tree. An agent at
  a permission prompt still takes the keyboard when picked. (80d72e75a)
- [ ] (arcterm) **A pi that quits leaves the agents list.** Unit tests only, no live pi ran. After installing the
  build (its launch writes the new pi status extension), run pi in an agent tab and quit it back to the shell:
  `wsh agents list` no longer lists that tab, and `wsh agents send` to it is refused instead of typed into the shell.
  Start pi again in the tab: once it starts, the tab is listed again. `dd3f02acc`
- [ ] (arcterm) **A paragraph picked above a code block leaves its line number alone.** Unit tests and typecheck only,
  no dev app ran. In Chat, triple-click a paragraph that sits right above a code block: only the paragraph is
  highlighted, not the block's `1`, and a copy holds only the paragraph's text.
- [ ] (arcterm) **A landed run keeps no blank columns.** Unit tests and typecheck only, no dev app ran. In the Agent
  sidebar, a landed run (no RAM, tokens or age) reads `✓ Landed` whole on its second line, not `✓ La…` before three
  blank columns; a running run beside it still lines its RAM up with the other rows.
- [ ] (arcterm) **Approve on a brainstorm that queues.** CDP `run-start-choice-brainstorm` checked the Brainstorm tab's
  approve bar against queue entries made over RPC; the launcher's own Queue from Approve, the `brainstorm: queued`
  line, wavesrv's `brainstorm: run <id>` and Chat's card were not tried. Fill the run cap (`runs:maxactive`), approve a
  design in a brainstorm and press Approve → in the launcher pick Queue → Start: the dialog closes, the agent's
  terminal gets `brainstorm: queued q-…` and writes nothing, the tab's approve bar reads `Queued` (Approve off), and
  Chat's Builder check card reads the same in grey, not amber. Raise the cap → the agent gets `brainstorm: run <id>`,
  records the run, and Chat draws the run row for that line. Dequeue the entry instead → Approve is on again. Agent
  surface, Brainstorm tab and Chat. Task 6 of the run-start-choice plan.
- [ ] (arcterm) **A long council tag wraps in its card; suggestion chips share a line.** Not tried in the app: no dev
  app ran, typecheck only. Open a done council whose direction tag names two long seats (`Reviewer 3 (evaluation) and
  Phản biện have doubts`) → the tag wraps to two lines inside the card, its icon on the first. In that council's box
  with three long asks, and in a Claude agent's Chat with long suggestions in the full-width column → two chips share
  the first line (each up to 340px, cut with …), not one per line.
- [ ] (arcterm) **A message that lands joined to another clears its Queued bubble.** Unit tests and typecheck only, no
  dev app ran. In a build with 9504b430c, in a Claude agent's Chat: send `làm đi`, then in the agent's Terminal type
  `xyz` in Claude Code's box without Enter, back in Chat send `báo council đi` while it works (it lands as one prompt
  `xyzbáo council đi` once the turn ends) → its Queued bubble goes as that prompt lands, not 30 minutes later. Same
  with a short one: after `làm đi`, leave `làm đi` in Claude Code's box and send `ok` → `làm điok` lands and the `ok`
  bubble goes.
- [ ] (arcterm) **A Claude Code menu no hook reports shows in Chat as a card.** Not tried in the app: unit tests on the
  real pause screen (its PTY output replayed through xterm) only. The first try showed the foot-of-screen card instead,
  as the card read only the bottom 40 rows (commits "fix(chat): a terminal menu no hook reports shows as a card", "fix(chat):
  Edit prompt comes back to the box; a screen Chat cannot read shows as its foot" and "fix(chat): the screen card reads
  the whole screen, so a dialog at its top is found", 2026-11-16). When Claude
  Code stops on the safeguards' "Session paused" menu, Chat shows a yellow card titled `Session paused` with its text
  (paragraphs read naturally, not cut at the terminal's width), `1. Switch to Opus 4.8` / `2. Edit prompt and retry with
  Opus 5.5` and Answer in Terminal, and within ~10 s the agent reads asking in the tree and Needs you. Switch picks it
  and the card goes; Edit prompt empties Claude Code's box and puts the prompt in Chat's box, focused, and the prompt's
  bubble leaves the conversation. A plain permission prompt still shows only the permission card. With an MCP form or
  another unnumbered screen up while the agent reads waiting, Chat shows "Waiting on you in the terminal" with the foot
  of the screen in mono; it never shows while Claude Code's prompt and mode line are up.
- [ ] (arcterm) **A council an agent ran ends as a card at the end of Chat, its summary in a council panel.** The CDP
  scenario `chat-council` covers fixture transcripts only (commit "feat(chat): an ended council stays a card at the end,
  its summary in a council panel", 2026-11-16). Ask a Claude agent for a council (/arc:council) and let it wait in the
  background → once it ends, Chat ends with a `Council · review` card (✓ Done · N directions, the answer, Open report)
  after any run cards, and the agent's first reply after the council's notification sits in a tinted panel headed
  `Council · review · N directions` with Open report; the `wsh council start` call stays a plain tool line.
- [ ] (arcterm) **Sidecar's wall holds only the Cockpit's agents.** Unit tests and typecheck only; the rewritten
  `sidecar-wall` scenario (steps 4-6, 14-15 and the new 24) was not run, since it needs the Tauri host (branch
  `feat/sidecar-button`). Run `task verify:ui -- sidecar-wall` on a dev app. By hand: with agents idle for hours, Sidecar
  shows only the asking, working and just-finished ones, the title bar still counts the idle ones, an agent that
  finishes leaves the wall about 5 minutes later, and switching the Cockpit's project filter or Live only changes the
  wall too.
- [ ] (arcterm) **Sidecar opens from the Cockpit and from the Jarvis button.** Typecheck and the keybindings tests only,
  no dev app ran (branch `feat/sidecar-button`). On the Cockpit, the header's Sidecar button (after Live only, in Cards
  and in Office's bar) opens Sidecar, or brings it forward when it is open; a right-click on the Jarvis button at the
  app bar's right end shows Open Sidecar first, above the fold items, and it does the same.
- [ ] (arcterm) **The browser-drawn controls draw dark.** Not tried in the app: no dev app ran, and CDP cannot capture
  a native popup (commit "fix(ui): the browser-drawn controls draw dark", 2026-11-16, `color-scheme: dark` on `:root`).
  In Setup → Tools add a tool and click into its folder field → the project suggestions open dark, not white. An
  unchecked checkbox (New dialog, Tools) and radio (Setup skill sync) are dark boxes now, not white, and still read
  as controls; the Telegram card's time fields still open a dark picker.
- [ ] (arcterm) **The Jarvis peek's project list opens dark.** Not tried in the app: CDP cannot capture a native
  `<select>` popup (commit "fix(jarvis): the peek's project list opens on the theme's surface", 2026-11-16). Open the
  Jarvis peek and click "No folder" under the Ask box → the list is the dark surface with primary text, like Setup's
  selects, not white with grey names; switch theme and it follows (`peterrand.tsx`, `[&_option]` classes).
- [ ] (arcterm) **A council's discussion has no ↩ Back pill.** Unit tests and typecheck only, no dev app ran
  (commit "feat(council): drop the Back jump pill from the discussion", 2026-11-16). Open a council with a long discussion, scroll to the middle, click ↑ Top then ↓ Latest →
  only ↑ and ↓ ever show in the bottom-right corner, each still glides to its end, and j/k still move after a click.
- [ ] (arcterm) **The pinned bar skips a picture-only message.** Unit tests and typecheck only, no dev app ran. In a
  build with f67013e11, in a Claude agent's Chat send a message, then one that is only a pasted picture, then scroll
  up past both → the pinned bar shows the text message, never "(picture)"; its ↑ and its n/m count step over the
  picture-only one.
- [ ] (arcterm) **A tight run line keeps its count.** Unit tests and typecheck only, no dev app ran. In the Agent
  sidebar at 248px, a working run whose tasks wait in the job queue (`≡#3`) with its RAM shown: its second line reads
  `Work… · 2/6` (or `Working · 2/6` when it fits), never `Working · …`; hover the words for the full line. A run a session started
  (its ↰ after the words) keeps `· 0/5` whole beside the ↰, never under it.
- [ ] (arcterm) **A wait on a council or an agent shows no terminal row.** Unit tests and typecheck only, no dev app
  ran. Have a Claude agent seat itself on a council (`wsh council start --agent self`, which runs
  `wsh council wait <id> --timeout 0` in the background) → no "Wait for council to finish" row under the agent in the
  tree and no background line above Chat's box; the council card and its own tree row still show, and the report
  still comes back when the council ends. The same holds for `wsh agents wait <tab>` run in the background. A build or
  dev server run in the background still shows as before.
- [ ] (arcterm) **A landed run offers ✓ Close run.** No dev app ran. In the Chat of an agent that started a run, once
  the run lands its card folds to `✓ Run a9e0fd4f landed · merged into main …` → a green `✓ Close run · N open` sits at
  that row's right end; the rest of the row still opens the `[arc] Run …` message. Click it → the Close run confirm
  names the run and N sessions; confirm → the run's lead, workers and reviewers close, and the button goes. In the
  Agent sidebar the ✓ sits on the agent that started the run (its row reads `merged · run …`), not on the run's row:
  once you have read its last turn, click it → `Close agent and run` names N open sessions; Close all → it and the
  run's sessions close, Close agent only → only it. Close that agent by Alt+W or its header ✓ → the same confirm. A
  run started from + Run (no origin agent) keeps the small ✓ on its own row. A run still landing, or held, shows
  neither. (Origin ✓: unit tests and typecheck only.)
- [ ] (arcterm) **The run chip's × hides finished runs.** Unit tests and typecheck only, no dev app ran. On an agent
  whose started runs have all landed (`2 runs` on its tree row and beside its name in the header), hover the chip → a
  small × shows after it; click it → the chip is gone from both places, and stays gone after a reload. With one run
  still going, the × hides only the finished one and the chip reads that run's progress. A lead's own `run 1c…` link
  shows no ×.
- [ ] (arcterm) **An interrupt keeps Chat's conversation in place.** No dev app ran. In a build with 1b304b177 (it
  reinstalls the arc mod on launch), on Windows, send a Claude agent in Chat a long task and press Esc while it works →
  the conversation stays where it was: no skeleton, no blank, no redraw from the top. Before, it emptied and loaded
  again whole on every interrupt.
- [ ] (arcterm) **New project leaves out the council bench's folders.** No dev app ran. In a build with 28dcb26a5,
  open + → New project → no row's path is under the app's data dir (`…\dev.arc.app\data\council-bench-projects\…`:
  spec-live-agents, bugs-orchestrate, goalpost-guard…); typing still finds folders on disk.
- [ ] (arcterm) **A pending land's peek reads as a card.** No dev app ran. In the Agent sidebar, hover a run's
  `Landing · Verify r…` line → the tip is two lines (`Landing into main · Verify running 18s`, then that a click opens
  the details), not the run id and commands. Click the line → the peek shows a green pulsing dot and the line in full,
  `Run a9e0fd4f → main` under it, then rows labelled STEP / COMMAND / INSPECT (WHY and JOB while queued) with the
  commands and job id in code chips; the dot is yellow on a RAM wait. Copy for an agent still copies the old lines
  (`Run … · land pending into main`, `Step: …`, `Command: …`).
- [ ] (arcterm) **A long menu row is cut, not stretched.** No dev app ran. On an agent that started runs with long
  goals, click `N runs ▾` in its header → the menu is at most ~520px wide, each Started runs row is one line ending in
  `…` with its status (`done`, `running`) still at the right, and hovering a row shows the whole goal. Other menus
  (the header's ⋯, a tree row's right-click) look as before.
- [ ] (arcterm) DUM-E: with dume:enabled on, a dum-e chunk pending and under an hour to the 5h reset with 30%+ left, a
  sonnet quick run starts in a wave/dume-… worktree within 5 min; when it ends the chunk reads "ready to land" with a
  git merge line, and the Brief header line follows along.
- [ ] (arcterm) **The ↩ Reply button sits off the selection's top-right corner.** No dev app ran; CDP `chat-quote`
  step 1 was updated to the new place without a run (`task verify:ui -- chat-quote`). In Chat, select a few lines of a
  reply → the small ↩ sits just up and right of the widest line's end, touching the corner diagonally; a selection
  against the pane's right edge keeps it inside the pane; with no room above it goes off the bottom-right corner.
- [ ] (arcterm) **A run's second line lines up with an agent's.** No dev app ran. In the Agent sidebar, a run row
  (`› 7  Working · 7/7`, or a run with no plan yet reading `working`) → its second line starts under the title, at the
  same column as an agent's `planning · run 1c…`, not under the icon; its progress bar below is unchanged.
- [ ] (arcterm) **Chat's permission card answers an Artifact prompt.** Unit tests and typecheck only; the screen
  reader (`tuiSelectYes`) was tested on a list written from a screenshot, not a capture. Have an agent delete a
  throwaway artifact → the card reads `Wants to use an artifact`, `delete https://claude.ai/artifact/…`, with Allow and
  Deny; Allow deletes it (the terminal's cursor moves from No to Yes, then Enter), Deny cancels. Also check the
  publish consent, if it asks. Agent surface, Chat. dc372ecbd.
- [ ] (arcterm) **The brainstorm card holds its place from step to step.** CDP `chat-redesign` 14c checked the held
  state and that the end row is the same element; the motion itself was never watched. In a live brainstorm in Chat,
  click an option → the card stays, its rows dimmed, `Sent · <answer>` in its footer, no collapse; when the next
  question lands the card changes in place and eases once to its new height. Same for Confirm the design → Builder
  check. Agent surface, Chat. 541b374df.
- [ ] (arcterm) **A crowded agent header keeps its project and initiative readable.** Unit test and typecheck only
  (`headermodel.test.ts` `initiativeTitle`). Pick an agent linked to an initiative that offers Ship and ✓ Close ·
  N tok, in a pane ~1150px wide → the initiative reads `◇ <title>` with one ◇ (not `◇ ◇ C…`), the project is whole or
  cut past a few letters, and the long name is what truncates first. Then a 2x2 split (560px cell) → still `/ +`,
  the run's number, `opus`, nothing overlapping. Agent surface header. 2f3a86ffa.
- [ ] (arcterm) **A terminal launch does not wait on Task images.** Unit test only (`launcherimages.test.ts`
  `imagesHoldLaunch`). Ctrl+N → Claude Code → paste a large image into Task, and before its thumbnail stops spinning
  pick Terminal → Open terminal is enabled and opens one; back on Claude Code, Launch agent waits for the image as
  before. `launchermodal.tsx` `imagesWriting`.
- [ ] (arcterm) **The rail's session card has no Tools row.** The dev app was down when it was made, so
  `task verify:ui -- agent-subagents-background` never ran on it (its step 4 now checks there is no row). Open an
  agent that has run tools → the right rail's session card shows project, model, branch and the state line, with no
  `ran ×N` chips. `agentdetailsrail.tsx`.
- [ ] (arcterm) Ask Jarvis at No folder with a real consult (claude): a question is answered in the popover; a job
  naming a project reaches its open agent as your own prompt (no "Not typed by the user" header), a sleeping one wakes;
  a job for a project with no agent opens one with the launcher's harness.
- [ ] (arcterm) **`jarvis-peek` puts a saved harness preference back.** Only the no-preference case ran in the Final.
  With a harness picked in the launcher, `task verify:ui -- jarvis-peek` → afterwards the launcher still shows that
  harness and model. On a Mac, the launcher's harness menu with many harnesses scrolls inside its panel and is not
  clipped. `scenarios.mjs` `jarvis-peek` teardown, `harnesspicker.tsx`.
- [ ] (arcterm) **Jarvis's peek has no pin while Jarvis is the hologram.** Typechecked only. Settings → Jarvis & Office →
  Form: Hologram, open the peek → its header reads `Nothing waiting on you`, hide, Full view, × with no pin. Switch to
  Character (Sprout) → the pin is back; fold into Sprout → the folded peek keeps it. `petpeek.tsx` `hologramShown`.
- [ ] (arcterm) **Parent initiative is a searchable dropdown.** Unit test and typecheck only; no dev app was run. Brief →
  an initiative with a parent → Edit details → Parent initiative reads the parent's title, not an id. Click it → a
  frosted list under the box with a search field focused, "No parent" first, the same project's initiatives next, the
  current parent in accent; the initiative itself and its sub-initiatives are not listed. Type → it filters; ↑↓ and
  Enter pick; Escape closes only the list, not the dialog. Pick another, Save → the sheet shows the new parent. New
  initiative → the field reads None and the list works the same. Commit: fix(jarvis) pick an initiative's parent from
  a list
- [ ] (arcterm) **Settings → Jarvis & Office → Form shows only the picked form's rows.** Unit test and typecheck only;
  no dev app was running. Shows as reads Hologram | Character, Hologram first. On Hologram the card holds Shows as and
  Hologram size, and no Character or Vietnam's colours; switch to Character → Hologram size goes, Character and
  Vietnam's colours appear under it. On Hologram, search "flag" → the card shows Vietnam's colours (not an empty card).
  Hover the fold button (app bar −, and the float bar's on a Mac) → "Fold into Jarvis" on Hologram, "Fold into Minion"
  on Character with Minion. Commit: fix(settings) Jarvis's form is Hologram or Character
- [ ] (arcterm) **Full ↔ Float switch on a Mac and in a release build.** Measured only in the Windows dev app over CDP
  (540–710 ms per switch, was 1.1–1.3 s). On a Mac: `Shift+F` in and out a few times → no flicker of the shadow or the
  traffic lights mid-fade, the float lands in its place with its shadow, and the hologram powers on in the ledge slot
  just after the fade. Fold into Sprout and open it back out → the content grows straight away, no half-second pause.
  On Windows, installed: `Shift+F` in and out → no empty outline jumping before the fade in (the window is cloaked
  while it changes frame, checked over Win32 with the production bundle in a debug host), the taskbar button stays,
  and typing goes to the terminal straight after the switch (the cloak must not take the focus).
  Windows release: the switch feels well under a second. Commit: fix(float) Full ↔ Float switches in half the time
- [ ] (arcterm) **The S button shrinks and restores a real window, and the relaunch keeps it.** The scenario presses S
  and the pin on a real window (340×440 pinned, then back to the size it had, in the wall), but cannot relaunch the app,
  so the relaunch is a Rust test of the decision only. Open Sidecar on a screen of a different scale from the main
  window's and press S → it shrinks to 340×440 at that screen's top-right corner, pinned above other windows; drag it
  wider than 1100 px → the wall shows and S stays pressed; press S → it returns to its first frame. Press S, then quit
  arcterm (tray icon → Quit) and launch → Sidecar reopens small and pinned, and S still returns to the old frame. With
  Sidecar full screen or maximized, press S → it leaves that and shrinks; S again → full screen or maximized comes
  back. On a Mac, press S from macOS full screen and again. Commit: feat(sidecar) the host's small form — S shrinks and
  pins, S again restores, a relaunch reopens as it was
- [ ] (arcterm) **The strain band on a real strained machine.** The scenario drives the band with fixture readings. With
  Sidecar open and 10+ agents working, start something that fills the memory (or lets the OS report pressure `high`) →
  the amber band appears within seconds saying `RAM high for … (… free of …)` over the three agents that weigh most,
  heaviest first, each with its heaviest process, and Stop (asks in place; the process ends, the agent keeps running)
  and Sleep agent (its RAM is freed); let the CPU run over 90% for 2 minutes → the same band says `CPU over 90% for 2
  min` with rows by CPU. Free it → the band clears after 30 s without flicker. × hides it until the level changes. At
  `critical` it turns red and names your OS. Commit: feat(sidecar) the strain band and tile scrollback on the wall
- [ ] (arcterm) **The macOS per-agent CPU sampler (`pkg/agentcpu`) on a Mac.** It compiles on Windows but has only run
  against a fake process table. On a Mac with Sidecar open and an agent running a build, make the CPU run over 90% for 2
  minutes → the band's rows are the CPU's, the agent that runs the build first, its busiest process named and `Stop`
  ending it; with the CPU calm the band clears and wavesrv's own CPU stays near 0 (the sampler runs only while a CPU
  band shows). Commit: feat(sidecar) CPU per agent: resmon on Windows, a new sampler on macOS
- [ ] (arcterm) Tooltips show at once, long ones too: hover the RAM figure on a run row in the Agent tree (its title
  runs past 60 characters) → the chip shows with no wait, and moving the pointer off drops it at once. Vitest + eslint
  only, not tried in the app (`titletiphost.tsx`, `titletip.ts` `tipDelay` removed).
- [ ] (arcterm) A run worker's header stays on one clean line: open a worker whose lead's name is a long goal → the
  link back to the lead (↰ icon) is cut with an ellipsis at about 220px, the project name stays readable, and the model
  and context figure stop short of the Chat | Terminal switch; hovering the link shows the whole name. Vitest + eslint
  only, not tried in the app (`agentheader.tsx` `RunLinkItem`).

## 2026-11-15

- [ ] (arcterm) **Sidecar's first open on one screen, or on a screen of another scale.** Two screens of one scale
  held on 1.1.3 `38f41b95b` (2026-11-15): Open Sidecar came up maximized on the other screen as `arcterm Sidecar`, and
  un-maximizing left 1280×800 centred there. Still unseen: with one screen it opens centred (1280×800, never past 90% of
  the screen), not maximized; and on a screen of a different scale from the main window's the size is still right.
  Commit: feat(sidecar) the Sidecar window from the Tauri host
- [ ] (arcterm) **Sidecar closes when the main window is destroyed, and stays when it is only hidden.** Tray icon off
  (Settings → `app:tray`): open Sidecar, close the main window → Sidecar closes with it and arcterm quits. Tray icon
  on: close the main window → it hides to the icon and Sidecar stays open; Quit from the icon closes both. Commit: same.
- [ ] (arcterm) **Sidecar reopens as last time.** Unit tests of the state and the restore decision only: no scenario can
  relaunch the app. With two screens, open Sidecar, drag or resize it, press F11 (or its full-screen button), then quit
  arcterm (tray icon → Quit, and once by closing the main window with the tray icon off) → the next launch reopens
  Sidecar on the same screen, at the same frame, full screen, without taking the focus from the main window. Close
  Sidecar with its own close button, quit, launch → it stays shut. Quit with Sidecar maximized, unplug that screen,
  launch → Sidecar comes up maximized on the main window's screen. Commit: feat(sidecar) Sidecar reopens as last time
- [ ] (arcterm) **Sidecar will not drag below 340×440.** The `sidecar-wall` scenario cannot check it: on Windows the
  host's `min_inner_size` clamps a person dragging an edge, not a programmatic `set_size` (a live run set 200×200 and read
  200×207 back), so step 2 only checks the page's own window calls. Open Sidecar, drag its bottom-right corner toward the
  top-left → it stops at 340×440 and the wall still draws whole tiles (no tile under 300 px wide). Commit: test(sidecar)
  the sidecar-wall CDP scenario
- [ ] (arcterm) **The version's tooltip, About and a dirty dev build name the commit.** The footer of installed 1.1.3
  read `v1.1.3 · 38f41b95b`, the installer's commit, on 2026-11-15. Still unseen: its tooltip adds "commit <sha>",
  Settings → About shows the same under Commit, and `task dev` with an uncommitted edit reads `· <sha>-dirty`.
  Commit: feat(cockpit) "the version names the commit the build was made from".
- [ ] (arcterm) **An agent's run counts leave cancelled runs out.** Unit tests and the typecheck only; no dev app ran.
  From an agent, `wsh runs start` two runs, cancel one → that agent's row in the Agent sidebar shows the live run's
  chip (its progress such as `1/3`, or no words while it plans), not "2 runs", and its header reads "↳ <the live
  run's goal>", which opens it with no menu; cancel the other too → the chip reads "cancelled" and the header
  "↳ <newest goal> · cancelled", both opening the newest of them. Commits: fix(agents) "the run chip leaves cancelled
  runs out", fix(agents) "the header's started runs leave cancelled runs out".
- [ ] (arcterm) **An open chunk names the files that changed since it was written.** Unit tests, the typecheck and
  a scan over the real initiatives' JSON only; no dev app ran. Rebuild, wait two minutes after start (the first scan),
  then open "Repo hygiene: lint, prettier, stale comments, test gaps" in the initiative sheet → rows such as
  "councildiscussion.tsx fails prettier --check…" carry a grey "changed since" chip whose tooltip lists
  "councildiscussion.tsx changed N times"; open one → under its status reads "… changed N times since this was
  written (<day>): check it still holds" with Mark checked; Mark checked → the chip and the line go. "ReleaseHub
  parser image + GitHub follow-ups" chunk 4 (IMAGE.md) → an amber "file gone" chip, and "rewrite or skip it": the
  installed 1.1.3 lost it on 2026-11-16 (its backfill dated the chunk by a note added the day before, so it read
  "written at d694b95a2, the code has not moved since"); after the fix the first scan re-derives that base from the
  initiative's creation and the chip comes back. `wsh effort stale` lists the same chunks; `wsh effort show <effort>`
  prints "(written around <sha>, N commits ago; … changed N times)" on old chunks, and after the first scan
  "written at" (the backfilled base).
- [ ] (arcterm) **An open chunk counts the commits since it was written.** Unit tests and the typecheck only; no dev
  app ran. In an initiative whose project is registered, `wsh effort chunk add <effort> "probe"`, make a commit in that
  project, then open the chunk in the initiative sheet → under its status reads "Written 1 commit ago (<day>): check it
  still holds" with Mark checked; Mark checked → the line goes, and the trail gains "checked against <sha>".
  `wsh effort show <effort>` prints "(written at <sha>, 1 commit ago)" beside it before, "the code has not moved
  since" after. Work on this chunk → the agent's prompt asks it to check the chunk still holds first. Chunks made
  before this change show no line. Commit: feat(initiatives) a chunk keeps the commit it was written at
- [ ] (arcterm) **↑ in Chat's empty box falls through to history when the take-back finds nothing.** Only the typecheck
  covers it. While Claude works, send a message from Chat so it shows as Queued, wait until Claude takes it but its
  bubble still stands, then press ↑ in the empty box → after about 2 s the last message sent comes back into the box
  (it did nothing before). With a message still truly queued, ↑ still takes it back instead. Commit: fix(chat) ↑ falls
  through to history when the take-back finds nothing, and the bash ghost layer wraps at the editor's width
- [ ] (arcterm) **A long bash command's ghost stays after its last character.** In Chat type `!` and a command long
  enough to wrap past the box's max height so it scrolls, with a suggestion showing → the faint suggestion sits right
  after the last character, on the same wrapped lines as the text (the layer is now padded by the scrollbar's width).
  Same commit.
- [ ] (arcterm) **Sixel images draw in a terminal of the installed app.** The dev app applies no CSP, so only a
  packaged build shows it. In a terminal run
  `printf 'Pq#0;2;0;0;0#1;2;100;100;0#2;2;0;100;0#1~~@@vv@@~~@@~~$#2??}}GG}}??}}??-#1!14@\'` → a small
  yellow-and-green "HI" draws, and `waveapp.log` has no new `WebAssembly.instantiate` rejection after a terminal
  mounts (it had one per mount). Commit: fix(tauri) the CSP lets the terminal's sixel decoder compile its WASM
- [ ] (arcterm) **Jarvis and initiatives polish batch, in the app.** Unit tests and the typecheck only; no dev app
  ran. Check each: (1) the initiative link in an agent's header has the tooltip "… Ctrl+click to peek at it in
  Sprout"; (2) the rail's Initiative tab: Mark done and Add note show their m / n hints as key caps that sit level in the
  button; (3) a run whose lead process died (kill the lead's claude) reads "Failed · n/m" in red in the Agent tree,
  "failed" on the Brief and Failed in the run sheet; (4) on a fresh launch, open Sprout before Jarvis: the "N
  initiatives changed · M idle" line shows once the briefing loads; (5) a plan a run worker proposes
  (`wsh effort chunk add ... --proposed` from its terminal) opens that worker from Needs you; (6) in the Brief, delete a
  stage's last chunks, then within 5 s rename the next stage: the stage you clicked is renamed. Commits: branch
  fix/jarvis-initiatives-polish (c6fa4470b … ffacae754)
- [ ] (arcterm) **The spring's feel on the Cockpit, Jarvis, Diff and Setup, on a real roster.** The
  `surfaces-spring-*` scenarios time each motion on fixtures (`task verify:ui -- surfaces-spring-cockpit`
  …); no packaged build ran them on your own agents and projects. In the packaged app on a real roster: the Cockpit
  as an agent goes from working to needing you (its card moves to its new place, no card jumps or doubles), a Jarvis
  brief card and an initiative row open and fold, a Diff file folds in Review, a Setup section folds, and a filter
  switch or a big update (three or more rows at once) shows at once instead of running the spring on each row.
  Commit: feat(motion) the batch model, the scenario scaffold and the docs for the surfaces' spring (run d2a699db)
- [ ] (arcterm) **Council bench team cell cleans up after itself.** Only unit tests cover it; no bench ran a real team.
  Run `wsh council bench --variant team --case <one case> --runs 1` to the end, then again and end it with
  `wsh council bench stop` while the lead works → after each, `~/.claude/projects/` has no new folder for the cell, and
  after the stop no `claude` or `node` process from that cell is left in Task Manager (the stop takes the same kill as a
  timeout). Commit: fix(council-bench) a team cell removes
  its transcripts and kills its whole tree on timeout (run e6d14c4f)
- [ ] (arcterm) **A council change reloads only that council.** With two projects that each have councils, run a council
  in one → its tree row and the Councils list update as it goes, the other project's councils stay as they were, and a
  council deleted with `wsh council` leaves both lists. Commit: perf(council) a council change reloads that council,
  not every council in every list (run e6d14c4f)
- [ ] (arcterm) **Radar retired, on a store that had it.** The Final ran on a fresh dev store, so migration 000028 never
  dropped a real `db_radarreport` and no saved Startup surface read `radar`. Install the build over an arcterm that has
  Radar reports and Settings → General → Startup surface set to Radar → it boots on Cockpit, the rail has no Radar,
  `Ctrl+G` `r` does nothing, and `waveapp.log` shows no migration error. Commit: refactor: Retire Radar (run c2a6aebb)

## 2026-11-14

- [ ] (arcterm) **Frosted overlays on a Mac, and the folded Sprout window.** The Final's frost scenarios ran only in
  WebView2 (Windows). On a Mac build, open the command palette, a context menu with a submenu, a Chat footer menu and
  a toast over a working agent → each panel blurs what is behind it (the palette over its dimmed scrim, a submenu
  over the chat, not over its parent menu), and muted text stays readable. Then fold Sprout into its own window and
  open its bubble or peek → it draws a solid panel, not a see-through one. Commit: feat(ui) Overlays in the Chat
  look: the frosted fill (run 04bd30dc)
- [ ] (arcterm) **Work on this tells a real agent at once.** The CDP scenario `rail-initiative-tab` (its draft and
  empty-box steps) passes against fixture agents whose sends go to a mock; no real Claude Code session took one. In a
  real Claude agent linked to an initiative, with the message box empty, open the rail's Initiative tab (`i`) and press
  Work on this (`w`) on a free chunk → the agent answers on the new chunk at once, Chat shows the `Chunk N · name`
  divider and `Moved to chunk N · sent by arcterm` (no bubble reading `Go on with this chunk.`); while the agent works
  the send waits for its turn to end. With a draft in the box the framed line waits and rides with the draft. Commits:
  feat(chat) initiative band: Switch to this chunk tells the agent at once, a how-to; moved onto the rail tab by
  feat(rail) Brainstorm and Initiative rail tabs.
- [ ] (arcterm) **Agent composer image cap, 3.5 MB.** Unit-tested only (`composerattachments.test.ts`); no scenario
  attaches to the agent composer. Agent → paste a 4 MB image into the message box → it is refused at once with
  `over 3.5 MB`, not lost on send; a 3 MB image sends. Commit: fix(council) the Report's summary Retry needs a sent
  idea, and the composer's image cap is 3.5 MB (run a9774e84)
- [ ] (arcterm) **Council decisions, 11-14.** Go-tested and typechecked; no dev app ran. (1) Hover a seat's message
  in a council's chat → its byline shows Pin to Report as a pin and Chốt as a compass; an idea's Chốt and the Memory
  tab's hover Chốt are compasses too (`council-discussion`, `council-memory`). (2) Pin a chat seat's message, then
  open the saved report under `docs/council/` → its Final proposal reads `_From <project> · <key>_`, the key the
  Report's header shows. (3) Quit arcterm while a council runs, reopen → the council reads stopped and its report
  file is saved (Open report works). Commit: fix(council) Chốt draws a compass, a chat seat's key in the report,
  a stale council's report
- [ ] (arcterm) **`wsh agents list` and agents in no project.** Unit-tested; run live from this project (the count
  line showed), but no agent was open in a scratch folder then. Open a Claude agent in a folder that is no project →
  `wsh agents list` from an agent in arcterm lists it with `(no project)` after its folder's name. Commit:
  fix(wsh) agents list shows sessions in no project
- [ ] (arcterm) **Token burn card inside a run.** Go-tested only; no dev app ran. In an orchestrator run (autonomous
  too), have a worker start 3+ subagents, or run `wsh council start` → the Token burn card shows at once in Needs you
  and in the run's question card as yours, the lead gets no wake for it, and `wsh jarvis dag answer` from the lead
  is refused. Allow there → the spawn runs. Commit: fix(orchestrate) a held card raised in a run is the person's
- [ ] (arcterm) **Council fixes, 11-14 third batch.** Go- and unit-tested and typechecked; no dev app ran. (1) In a
  council paused after round 1, Continue with `Check it against @<a file>` → round 2's expert cards show them reading
  it. (2) In a 3-round council, attach an image to a reply in round 2 → in round 3 an expert shown that thread opens it
  (its activity names the file). (3) Kill wavesrv while a council runs a verify command, start arcterm again → the
  `council-<id>` folder under arc-wt is gone (`[council] … removed the verify tree` in waveapp.log). (4) `wsh council
  start` in a folder that is not a registered project → its row is in Home's folder (`council-tree`, step 11j). Commit:
  fix(council) Continue's @file, round 3 attachments, crash-left verify trees, councils in Home
- [ ] (arcterm) **Council fixes, 11-14 second batch.** Go-tested and typechecked; no dev app ran. (1) Paste a 4 MB
  image into a council's chat → its chip reads `Image too large (over 3.5 MB)` at once (`council-discussion`,
  attach-oversize). (2) In a done Review report with Also raised, press the header's `Also raised` jump link → the
  page scrolls there and the ideas are unfolded (`council-summary`). (3) `wsh council summarize <id>` on a council
  paused after round 1 → it prints `summarizing`, and `wsh council wait <id>` returns its report. Commit:
  fix(council) one image cap, kept jump unfolds, summarize command, withdrawal round, Draft lookup outside the lock
- [ ] (arcterm) **Council small fixes, 11-14 batch.** Unit-tested and typechecked only; no dev app ran. (1) Leave a
  council paused after round 1 in a registered project → the Cockpit's Needs you strip has a `Council` row; under
  another project's filter it is gone; Open lands on its Discussion (`task verify:ui -- council-needs-you`, step 4b).
  (2) Ctrl+K → Needs you → Enter on a learned rule → the Cockpit shows, with the rule's Accept and Dismiss. (3) In a
  council with a waiting suggestion, fold the Ideas rail → the `Ideas · N` button carries the dot (`council-memory`,
  step 1b). (4) A council whose coordinator failed with no sent idea → its Retry is greyed, and its hover says no idea
  was sent. (5) Copy a routed message's `Router failed` row → the pasted text reads `Router failed UX`, not
  `Router failedUX` (`council-routing`). Commit: fix(council) Needs you strip, palette learned rule, folded-rail dot,
  summary Retry hold
- [ ] (arcterm) Council and Doc review cards in Chat, with a real agent: in a Claude agent's Chat have it start a
  council (`/arc:council`, or ask for one) → while it runs a Council card sits at the end of the conversation (the
  question, a chip per expert, the step, the time, the estimate, Stop; Open council opens the room); a second council
  started while one runs shows the queued card naming the first; a council that pauses after round 1 reads Waiting on
  you with Continue and Stop. When one ends its card leaves on the spring and a ✓ row (Open report) stands at the
  `wsh council start` call, ■ when you Stop it; run a follow-up on a done council from its room → its row reads
  running again and the card never comes back to the end. Then have the agent ask a Doc review (`/arc:doc-review`) → a
  Doc review card in the dock above the box with Review and Approve; Approve folds it into "✓ Doc review · approved ·
  <file>", and Request changes from Review into "↺ … changes requested · N comments". An exited agent shows both cards
  without Stop, Continue, Review and Approve. The `chat-council` scenario covers these states from fixtures, not the output of a real agent's
  `wsh council start`. Commit: feat(chat) place the council cards and the Doc review rows in the conversation
- [ ] (arcterm) **The Brainstorm rail tab on a live agent.** Have a real Claude agent run a brainstorm that draws
  boards. While it works between two questions, its rail has a Brainstorm tab: the title, `Open` with `b`, the line
  `<state> · Decided N · M boards`, and the decisions as a numbered timeline with each board's chip under the decision
  it illustrates. Let it draw another board while the tab is not shown → within a few seconds the tab's icon and the
  header's Brainstorm switch carry the accent dot, and on the tab the chip reads `new` under its decision, whose number
  is filled. Click the chip → the board opens in the dialog over the agent's cell (Chat and Terminal), ← / → step through
  the boards, `b` opens the Brainstorm view, and both dots go. Checked only with fixture agents in the
  `rail-brainstorm-tab` scenario (`railbrainstormpane.tsx`, `brainstormbandview.tsx`). Commit: feat(rail) Brainstorm
  and Initiative rail tabs.
- [ ] (arcterm) Esc in Chat before the reply, on Windows: after a build, in a Claude agent's Chat send a long ask
  ("write 3000 words on …") and press Esc once its bubble shows as sent, before any reply → the text comes back into the
  box and the bubble leaves the conversation at the same moment, with no Queued bubble after; send it again → it shows
  once and gets its answer. Tried on a Mac in the browser dev app with a real Claude (haiku), not in WebView2. Commit:
  fix(chat) a message Esc takes back leaves the conversation

## 2026-11-13

- [ ] (arcterm) A pasted jobslot wrapper queues once: after a build with the new `wsh` and an arcterm restart, have a
  Claude agent run `'<home>/.arc/bin/wsh' jobslot --hold-parent -- 'task check:ts'; [ $? -ne 75 ] || exit 75` then a
  newline and `task check:ts`, in the foreground → the Jobs popover shows one `task check:ts`, running, not a second
  one waiting "CPU busy, 1 at a time" behind it, and the typecheck finishes on its own. Commit: fix(arc-mod) a pasted
  jobslot wrapper is not queued twice
- [ ] (arcterm) Triple-click in Chat on a Mac: after a build, triple-click a short list item, a short paragraph and a
  heading in an agent's reply → each highlights only its text, with no band on to the column's right edge, and Copy
  pastes the line with no trailing line break. A drag across several paragraphs still selects them all. Checked only in
  a WKWebView harness with the same module, not in the app. Commit: fix(chat) a triple-click selects the line's text
- [ ] (arcterm) Compacting in Chat: after a build with the new `wsh`, type `/compact` in a Claude agent's Chat → under
  the last message it reads Compacting… with no `(…)` timer, then the line goes away when the summary lands. A
  compaction Claude starts on its own mid-turn still reads Working…. Commit: fix(chat) a /compact reads Compacting…
- [ ] (arcterm) Kael sync 11-13: a land refused mid-merge is undone: in a scratch repo, start a run with two tasks, and
  once the first lane has merged put a `commit-msg` hook in the repo's `.git/hooks` that refuses the engine's own
  commits and no one else's (`#!/bin/sh`, then `grep -q '^Arc-Run:' "$1" && exit 1`; only the squash and land commits
  carry that trailer, so the workers' commits still go through). While the second lane merges → its squash is refused,
  the landing tree has nothing staged afterwards, and the next tick merges it once the hook is gone; before, the
  squash stayed staged and held every later merge. Put the hook back before the run completes → the land holds with the
  refusal as its reason, `git status` in the checkout shows no merge in progress (no `.git/MERGE_HEAD`) and nothing
  staged; remove the hook and run `wsh runs land <run-id>` → it lands. A run started with `--landing checkout` behaves
  as it did. Unit-tested on Windows only (`/bin/sh` hooks), never on a real run. Commit: f03b9ee67 (`merge.go`
  `finishMerge` / `undoMerge`, `land.go` `mergeRefusal`).
- [ ] (arcterm) Kael sync 11-13: a resume that fails in a new tab leaves no extra tab: close the tab of a Quick run's
  worker while it works → the run reads Blocked "worker's tab was closed…". Make the resume fail (move the worker's
  session `.jsonl` away) and Resume from the palette → it reports why, and the Agent tree gains no extra terminal for
  the run; put the file back and Resume again → one new tab opens and the worker continues. Unit-tested only. Commit:
  5019e90c8 (`interrupted.go` `resumeInNewTab`, `swapPhaseWorker`).
- [ ] (arcterm) A bug report's picture survives done: in the session that handled a bug report, after `wsh bugreport done`
  moves its folder to `reports/done/<id>/`, the screen.png thumb on the step row still shows and a click zooms it (not
  the crossed-out "no longer on disk" frame). Unit-tested only. Commit: 1b016b95d (`localimage.ts` `doneReportPath`).
- [ ] (arcterm) Council Figures drawn as charts, with real seats: after a build, start a Review council in mit-thesis on
  a question that leans on numbers (the patch replay, X.js) → the seats' figures carry `group` and some of `of`, `was`,
  `limit`, `unit`, `at`, and the Report's Số liệu draws groups as bars, a change, a limit, a line or a comparison;
  any relation Go dropped is listed with why under About the council. Then `wsh council redoc --project <mit-thesis>`
  → the 2026-11-24 SecBench report (council 5186f93c) lists 94, 947, 170 and 79,5% once each, each with both its
  places. Checked only in the browser cockpit with a fixture council (`council-report-tables`, 8/8) and a worktree
  wavesrv, not in WebView2 and not with a model writing the fields. Commit: feat(council) Figures drawn as charts
- [ ] (arcterm) `wsh council refigure` on an old council: after installing, `wsh council refigure 5186f93c` → it prints
  each verified figure with its relations and the tokens, and rewrites the SecBench report; the Report's Số liệu (app and
  `.md`) groups X.js 947 → 135 → 94 + 41 and the replay rates (70,6% of 170, from 79,5% of 151). Check the Liên hệ
  column for a link haiku guessed (a preview on a copy also said "151 of 170"). Tried on a copy of the record with haiku
  only, not through wavesrv. Commit: feat(council) wsh council refigure

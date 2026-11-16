# Waiting on a hand check, part 6

Older lines of `docs/hand-checks.md`, moved here when it grew past its size; the rules and the list of parts
are in that file. Tick a line here when it holds, then remove it; a part left empty is deleted.

- [ ] (arcterm) Kael sync 11-13: an RPC client dropped mid-call: from a terminal in arcterm run `wsh ask --wait "x"`
  and end that wsh process hard (Task Manager, by its PID) → the wait it held ends on the server (a second
  `wsh ask --wait` in another terminal is answered, not queued behind it) and `waveapp.log` shows at most one `went
  away before it answered` for the call. Then reload the cockpit window (Ctrl+R) while the Agent surface is loading →
  its lists load with no timeout toast. Unit-tested only; `-race` could not run on this machine's zig toolchain.
  Commit: 7d9e0bcf6 (`pkg/wshutil/wshrouter.go`, `wshrpc.go`, `pkg/web/ws.go`).
- [ ] (arcterm) Kael sync 11-13: a run's agents sit under its project, with the trimmed launch: start an orchestrator
  run with Claude workers → in the Agent tree its lead, task workers, reviewers and plan reviewers are under the run's
  project folder, not outside it. A worker's launch line carries `--strict-mcp-config`, a reviewer's and a judge's
  also `--disable-slash-commands` (`wsh agents` or the process list), and the task still passes review and lands. Only
  the CLI's flag list was confirmed, no real launch. Commit: 5019e90c8 (`engine.go` `channelProjectName`,
  `jarvis.RunWorkerSpecWithOptions`).
- [ ] (arcterm) Kael sync 11-13: a failed skill adopt in Setup shows the banner, no toast: in Setup → Skills make the
  vault's skills folder read-only and adopt a skill → the Setup banner names the failure, no "Moved N skills into the
  vault" toast shows, your keep choices stay and the matrix is read again. Vitest only. Commit: 7c1e0b7db
  (`setupstore.ts` `adoptSkills`).
- [ ] (arcterm) Kael sync 11-13: initiative chunks labelled by number: in the New initiative form add chunks labelled
  `1`, `2`, `3`, tick a stage and a done on the second → the created initiative has them on its own chunk 2. In an
  initiative with chunks `1`, `2`, `3` delete chunk 1, then chunk 2 inside the undo window → chunks 1 and 2 go and 3
  stays. Undo a move of a chunk → it returns to its place. Never tried in the app. Commit: 148cc8dbd
  (`effortstore.ts`, `effortcreateform.tsx`).
- [ ] (arcterm) Kael sync 11-13: the DAG window's owner and its small states: open a worker task's run sheet (Agent
  tree → the run's worker → its sheet) → the dock reads Open in the run's DAG, and it opens the DAG with that task
  selected; the subtitle reads `<project> · <first 8 characters of the run id>`. Run `wsh ui reveal dag:<id>#<task>` in
  a terminal → the DAG opens on that task's run, and Ctrl+click on a `dag:` address where the cockpit draws one peeks
  the owner run instead. With Jarvis as the walking pet (not the hologram), open the DAG window and the Final shots
  viewer → the sprite is gone behind them and comes back when they close. Only vitest covers these. Commit: dbd4023d6
  (`dagmodal.tsx`, `openref.ts`, `petview.tsx`).
- [ ] (arcterm) Kael sync 11-13: an ended run's timeline and a real held tip: open the DAG of a run that has ended →
  the timeline's strip reads `ended <date time>` with the date on its labels once events span days, no now marker or
  live pill, and no retry or skip on its cards. Then in a live run make one lane's Verify fail while another lane's
  tip is merge-ready → the Agent tree shows the failed task with a red dot and reason and the other tip stays a live
  row with "merge ready · waits on t-N's failed Verify" (wrapped inside the rail's lane), the same line shows in
  Jarvis's Runs row and the DAG peek, there is no Merge button on it, and `wsh jarvis dag status` prints `merge held:
  waits on t-N's failed Verify`. The scenarios patch the digest on the page, so no run has shown the engine's own
  `held`. Commit: 078afd010 (`digest.go`, `queue.go`) with dbd4023d6 (`runlineage.ts`, `agenttreemodel.ts`).
- [ ] (arcterm) Kael sync 11-13: skipping a task under review, and a take-over that answers the lead: in a live run
  `wsh jarvis dag skip t-N` while t-N is under review → its reviewer's tab stops, the lane goes back to the review
  base and the run goes on (the timeline reads "you skipped" for your click, "lead skipped" for the lead's). When a
  lead relays a worker's question with `AskUserQuestion` (header exactly `t-N`) and you press Take over → the lead's
  relay is answered at once and the lead carries on; a Plan review or land question of the lead is not touched. On a
  failed final stage press Rerun while the lead is asking → the lead's question is answered with the rerun line.
  Unit-tested only. Commit: 078afd010 (`scheduler.go` `SkipTask`, `queue.go` `TakeOverAsk`, `final.go`
  `RerunFinalStage`).
- [ ] (arcterm) Kael sync 11-13: the Verifier step of an ended stage: open the final stage's pane of a run whose
  verifier has ended and click the Verifier step → the verifier's read-only transcript opens (the scenario's seeded
  run has none, so only the "Session ended · read-only transcript" banner was checked). Commit: dbd4023d6
  (`finalstagepane.tsx`, `runlineage.ts` `verifierStepTarget`).
- [ ] (arcterm) Kael sync 11-13 step 2: a `settings.json` locked at launch is left alone. Back up
  `~/.claude/settings.json`, then in PowerShell hold it with no read sharing
  (`$f = [IO.File]::Open("$HOME\.claude\settings.json", 'Open', 'ReadWrite', 'None')`) and restart arcterm → the file is
  byte for byte what it was (model, permissions, env and your hooks still there), and `waveapp.log` has `[tauri]
  agent-hooks install failed (exit code: 1): … reading …`; `$f.Close()` and restart → no failure line and the hooks
  installed. Then put invalid JSON in `~/.claude/settings.json` and launch the dev app under its own home → the log
  line says `parsing …`, pi's settings and the agy and Codex hooks are still installed; restore the file and relaunch
  for no failure line. Unit-tested only (a directory stands in for the locked file). Commit: b56cb4efd
  (`wshcmd-installhooks.go` `readSettingsFile`, `src-tauri/src/main.rs`).
- [ ] (arcterm) Kael sync 11-13 step 2: links open without a shell. In a Chat message or a previewed markdown file click
  an https link, one with `&` in its query (`https://example.com/?a=1&b=2`) and a `mailto:` link → the default browser
  or mail app opens each, the `&` link with both parameters. A link whose address holds a raw `"` (`[x](https://x/"&calc.exe&")`)
  does nothing, no calculator opens, and `waveapp.log` has an `[open-external] rejected URL …` line. The unit tests
  cannot reach `ShellExecuteExW`. Commit: f3ba29fb9 (`src-tauri/src/commands.rs`).
- [ ] (arcterm) Kael sync 11-13 step 2: the vault does not stick. With a vault that has a remote, start a Sync and end
  its `git.exe` (or `git-remote-https.exe`) from Task Manager while it fetches or pushes → the vault releases within
  the timeout and the next Sync runs, with no `Unable to create index.lock: File exists` in the log or the Vault row.
  On two machines, remove a note from an initiative on one and add a note to the same initiative on the other, sync
  both → the removed note stays gone and the added one is kept. Save a note or an initiative while a sync runs → what the sync merged in is
  still there. Put the vault in a folder with a `[` in its name (`vault [work]`) → the initiatives list is not empty.
  Unit-tested only. Commit: 6a992172d (`pkg/wavevault/git.go`, `effortmerge.go`, `pkg/effortstore`, `pkg/notestore`).
- [ ] (arcterm) Kael sync 11-13 step 2: skills and steering keep the user's own. Setup → Skills: with a vault skill
  `Review` and your own `review` folder in a harness's skills directory (Windows), the matrix reads that harness
  "unmanaged" and a sync leaves the folder's files as they were. Put your own `design-local` skill folder in a harness
  and Adopt → it stays in the harness, not moved into the vault and not lost (arcterm retired that name). Delete the
  `<!-- ARC-STEERING:END … -->` line of the arcterm block in a harness's steering file (`CLAUDE.md`), write a line
  below the begin marker's text, sync → your lines are still there, with one fresh block appended and the orphan begin
  marker gone. Unit-tested only. Commit: 405ce9871
  (`pkg/agentsync/skills.go`, `adopt.go`, `steering.go`).
- [ ] (arcterm) Kael sync 11-13 step 2: the Claude mod's checks in a live Claude session, after the next launch has
  installed the mod (`~/.arc/claude-mod`). In a run's worktree, have the agent run a `git commit -m "tests how git push
  is refused"` → it commits instead of being refused for the words in the message, while a bare `git push` is still
  refused. On Windows have it edit `tsconfig.json` to set `"strict": false`, and run `rm tests\x.test.ts` in
  PowerShell → the goalpost finding shows for both. From the cockpit's box send an agent `/tmp/build.log has the failing test, read
  it` → the agent receives it as a message, and `/src needs a cleanup` reaches it as plain text. Unit-tested only.
  Commit: e669b62b0 (`claude/arc-mod/hooks/guard-core.ts`, `goalpost-core.ts`, `control-core.ts`).
- [ ] (arcterm) Kael sync 11-13 step 2: Usage and the temp folder. Run `/fork` in a pi session, let both sessions
  answer, and open Usage → the forked file's copied entries are not billed a second time. On Windows, after a council
  has run, `Get-ChildItem $env:TEMP -Filter wave-consult-stderr-*` lists nothing (or only a file of a call still
  going). Unit-tested only. Commit: d4df8a46e (`pkg/usagestats/pi.go`,
  `pkg/consult/exec.go`).
- [ ] (arcterm) Kael sync 11-13 step 2: a permission prompt reads as asking. With a Claude agent stopped at a
  permission prompt, `wsh agents list` shows it as asking (not idle), and `wsh agents send <tab> "x"` is refused with
  "a question or a permission prompt" open, so nothing is typed into the dialog; after you answer it the send goes
  through. `wsh agents send --wait <tab> "x"` to an agent that stays idle after the message (the message started no
  turn) fails after about 30 s instead of the 10-minute default, and a `--wait` that times out names the agent's state.
  Unit-tested only.
  Commit: 2388c6bb6 (`cmd/wsh/cmd/wshcmd-agents.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg.go`).
- [ ] (arcterm) Kael sync 11-13 step 2: a Claude agent that exits to its shell leaves `wsh agents list`. Launch the dev
  app (its next launch writes the `SessionEnd` hook), run claude in an agent tab and type `/exit` → `wsh agents list`
  no longer lists the tab, so a send is not typed into the shell; start claude again in it and, once it has its first
  prompt, the tab is listed again. A `/clear` or `/resume` in a running claude does not remove the tab. A prompt shipped
  (Ship to agent, a brainstorm or comment send) to a tab whose terminal is gone shows the error toast "…nothing was
  sent" instead of reporting sent. Unit-tested only. Commit: 00e9930f6 (`wshcmd-agenthook.go`, `wshserver_agentmsg.go`).

- [ ] (arcterm) Jarvis For later on real sessions: mark a session older than a week for later (History → its menu →
  Mark for later), and one of a running agent → open Jarvis: For later, beside Ideas under the initiatives list, names both
  with their project and the mark's age, newest mark first. Click the running one → Agent opens on that agent. Resume
  on the old one → it resumes in a new tab (no second tab if one already holds it). `jarvis-brief-later` covers the
  rows, Done/Undo and opening a transcript, on injected sessions only. Commit: feat(jarvis) For later region
  (`forlaterregion.tsx`, `briefforlater.ts`, `pkg/agentsessions/scanpage.go` Ids).
- [ ] (arcterm) A spinning idle Claude sleeps: with Sleep idle agents on, leave a Claude agent idle and off screen
  while its `claude.exe` burns CPU (Task Manager) → once it holds over 1.5 GB it sleeps about 5 minutes after its last
  turn (a smaller one at After idle for), with a "Put 1 agent to sleep" notice; Wake brings it back. An agent working
  with its status stuck at idle stays up while its transcript grows. Commit: fix(agentsleep) sleep agents that spin
  while idle (`pkg/agentsleep`, `wshserver_agentsleeploop.go`).
- [ ] (arcterm) Queued bubble dims: in an agent's Chat, send a message while Claude works → its bubble shows at ~55%
  under Queued · Send now; when Claude takes it, the transcript row replaces it at full strength. A message sent to an
  idle agent stays full strength. Commit: fix(chat) dim a queued bubble (`chatpane.tsx` PendingBubble).
- [ ] (arcterm) No folder in the New dialog: open New → Claude Code → the Project column's last row reads No folder
  (0), with `~/.arc/no-folder` in its tooltip. Pick it and launch → Claude Code starts in that folder with no trust
  prompt and no ask-only line, and the agent sits in the tree's No folder folder. Launch there again → the Session
  column lists the first session and resumes it. Terminal and a Tool on No folder open in the same folder. Then pick
  a project with sessions and click one → the dialog keeps its height going into the session step and back (←), and
  the two fade into each other. `task verify:ui -- launcher launcher-resume tools-launcher tools-tree` could not boot
  its dev app under memory pressure. Commit: feat(launcher) No folder replaces Home (`launchermodal.tsx`,
  `pkg/jarvis/nofolder.go`).

- [ ] (arcterm) Hologram fold button and the permission card's Enter key: Settings → Jarvis → Form → Hologram → the
  26px button left of the window controls shows blue rings around a light core, not Sprout; back to Sprout → the
  creature again. Then have a Claude agent ask a permission in Chat → the highlighted button (Allow at first) carries an
  Enter key chip; ↓ moves the ring and the chip together to the second choice and Deny. `app-bar.tsx` HologramGlyph,
  `permissioncard.tsx` enterKey.
- [ ] (arcterm) Copy button's check and the working hologram in the real app: in Chat click Copy under a reply → the
  outline copy icon turns into a green check, then back (headless Chrome's clipboard refused it, so the CDP step never
  saw the check); while a Claude agent works, its working line's dot turns its rings and flashes sparks, and with
  Windows' animation effects off it stands still. Branch feat/model-effort-chip.
- [ ] (arcterm) Hidden Jarvis in the Office and at launch: open Cockpit → Office, right-click the boss → Hide for 1
  hour → the boss and its ring go, its desk stays empty and no Sprout appears on the footer; Ctrl+P → Show Jarvis →
  the boss comes back with its entrance (the teleport, or Spider-Man's swing). Hide again, then quit and reopen
  arcterm → still hidden, and the startup screen shows only "Setting up arcterm", no Sprout or hologram. Fold the
  window while hidden → the folded Sprout shows and says nothing until Show Jarvis. Commit: the Jarvis snooze
  (`cockpitoffice.tsx` BossView, `startuploader.tsx`, `pethidestore.ts`).
- [ ] (arcterm) Chat keeps up with a reply before a big Write: after a build with this arc mod installed, ask a Claude
  agent to write a ~100-line file and watch Chat → the line it says before the Write ("Writing the …") shows whole
  within a moment, not cut mid-word until the Write lands. `claude/arc-mod/hooks/register.ts` turn.step trailing write.
- [ ] (arcterm) A queued run's card in Chat turns into its run in place: in a Claude agent, start a run with
  `wsh runs start … --after <a live run>` so it queues → its card reads `Queued · after <that run>`; once the run ahead
  ends and the entry starts, the same card shows the new run's stage and Open run, without a second card appearing and
  without a flash of nothing on the first render after a reload (`frontend/app/view/agents/chatruncard.tsx`,
  `chatruncards.ts` `placeRunCards`, `chatconversation.tsx`; the `chat-verdict-handoff` scenario covers only an entry
  still in the queue; 1be9dcb93).
- [ ] (arcterm) Brainstorm card motion: in Chat, on a builder check card hover Open in Brainstorm, Keep talking and
  Approve → the colours ease in (~140ms) instead of snapping; click Agent's calls N → the list slides open and folds
  shut with no jump in the gap above it; open a ✓ Run row's detail → same. The `chat-brainstorm-review` scenario passed
  (26/26) but its shots are stills. Commit b90fbb688, `chatbrainstormparts.tsx`.
- [ ] (arcterm) Confirm the design's button at the card's foot: have a brainstorm end with 5+ guesses → in Chat the
  card's top line has no button, and Confirm all N guesses sits right-aligned on the `N yours ›` row at its foot
  (alone there when nothing is yours yet); confirm them all → Check with a builder takes the same place. Commit:
  the Confirm card button fix in `chatbrainstormconfirm.tsx`.
- [ ] (arcterm) Two Add to initiative cards in one reply sit apart: have a Claude agent in Chat propose two
  `arc-initiative` blocks in one reply → the cards (and their folded rows once handled) have the same gap as a visual
  block, not touching borders. Then ask it "bỏ vào initiative đi" → it runs `wsh effort` itself and says what it
  added, with no card. `chatinitiativecard.tsx` InitiativeBlockView, `skills/initiatives/SKILL.md`.
- [ ] (arcterm) A brainstorm's ask says "asking" once: have an agent brainstorm until it asks a question → its Agent
  tree row's second line reads "asking question N" (amber), with no "asking" note before it; a held card (Token burn)
  on such an agent still shows its header note. Commit: the "asking asking" fix in `agenttree.tsx`.
- [ ] (arcterm) An engine step claims the measured peak when it is higher: with `scripts/cdp/final-verify.mjs` measured
  at 4.8 GB in `jobpeaks.json` (data dir), start a run on this repo → its Final row in the Jobs popover reads about
  5.7 GB "measured", not "3 GB est.", and its tooltip lists the agents' runs. Its Verify still reads 2.5 GB est. (the
  agents' 0.9 GB never lowers it). Then skip a `task check:ts` a Claude agent queued with `run_in_background` (its bash
  waits in `wsh jobslot --hold-parent`, so the meter sees it) from the popover → `jobpeaks.json` gets no new
  peak for it (`pkg/orchestrate/plancmd.go` engineStepSize, `jobpeaks.Ran`).
- [ ] (arcterm) Canvas Copy screenshot: open a canvas (an agent's canvas pane, and Agent → Canvas gallery → a canvas),
  press Copy above a board's right edge → "Copied" for a moment, and pasting into Paint or a chat gives the board as
  shown, without the Copy button or the pane around it; under All each tile has its own. Check it in the packaged app
  too (clipboard image writes need a secure origin), and on a Mac (Screen Recording permission). `canvaspane.tsx`.
- [ ] (arcterm) Chat box background line, the presses its scenario (`chat-bg-tasks`) leaves out: have a Claude agent
  start a background `sleep 600` and a background subagent, open the line's list → Stop on the shell row ends it and
  the row leaves at once (the line folds away when nothing is left); a press on the subagent row opens its
  conversation. Also check the line goes when the agent falls asleep. Agent surface, Chat (`chatbgline.tsx`).
- [ ] (arcterm) A lost Stop no longer leaves "Working…": make a Claude agent's Stop hook fail (point `Stop`'s command in
  `~/.claude/settings.json` at a `sleep 15` with `timeout: 10` for one turn), let a turn end → the Terminal shows the
  turn done, Chat still says Working…, and within ~30 s it goes idle and `waveapp.log` has `idled from its transcript`.
  A long tool call (a 2-minute build) must keep reading Working the whole time. Agent surface, Chat
  (`pkg/wshrpc/wshserver/wshserver_turnend.go`).
- [ ] (arcterm) A Chat message never goes twice: while Claude works, send a message from Chat, then within 5 s press
  Enter again (or type the same words and send) → the transcript has one `enqueue` of it and Chat one bubble, and
  `waveapp.log` has `[chat-send] repeat-dropped … after=…ms`. The same words sent after 5 s go as a new message. A send
  that failed and came back into the box sends again at once. Agent surface, Chat (`agentcomposer.tsx` useAgentSend,
  `chatpending.ts` repeatsSend). Unit-tested and typechecked only.

- [ ] (arcterm) Hologram amber only on a question: with Settings → Jarvis → Form on Hologram, leave a gate or a run to
  land in Jarvis's queue and no agent asking → the corner keeps its rings; have an agent ask (`wsh ask`, or a
  permission prompt) → it turns to the amber sphere, and back once answered (`frontend/app/view/jarvis/hologramview.tsx`,
  bb05a685b).
- [ ] (arcterm) Mac shortcut labels: on a Mac, hover Code's wrap button (⌥Z) and Send review (⌥⇧M), a Claude agent's
  Chat brainstorm card (Open in Brainstorm ⌥C), the Diff commit button (⌘⏎), the chat + menu (Add files ⌘U), the
  tool picker on a missing tool (⌘I), the brainstorm hint strip (⌃⇧B) and the Jarvis tour's Initiatives steps (⌥↑ /
  ⌥↓, ⇧N) → no "Alt" or "Ctrl" left; on Windows they still read Alt+Z, Ctrl+Enter… Unit-tested and typechecked
  only (`keysym.fillKeys`, branch `fix/mac-key-labels`).
- [ ] (arcterm) A run's queued engine steps show in the Agent tree: during a run on a busy machine (or with
  `jobs:mode` `slots` and `jobs:slots` 1 while another heavy command runs), let a task merge → the run's line shows
  "queued #N" (also folded; "N queued" with several), its tooltip names "Verify · <task>", and the task's row reads
  "t-N · verify queued #N" until the Verify starts, then "verifying" with its clock. The CDP scenario
  `jobqueue-run-tag` checks it on an injected queue only; the engine's `taskids` on a real job are not seen live
  (branch `fix/run-queued-jobs`).
- [ ] (arcterm) Topics leave Ideas: open Jarvis → the Ideas column no longer lists the topics (`wsh effort list
  --topics`: Chat, Misc, Kael sync…); each shows in All initiatives with "+N sub", no bar or count, its
  sub-initiatives indented under it, and "Link to…" lists it with "topic" in place of 0/0. Unit-tested only
  (`buildEffortCards`, branch `fix/brief-topics-not-ideas`).
- [ ] (arcterm) Initiative writes no longer queue behind a vault sync: with a vault remote set, run a burst of
  `wsh effort chunk add/note` (a few hundred, as a cleanup script does) → none comes back `EC-TIME: timeout waiting for
  response`; before, about 1 in 120 did, each time the sync fetched or pushed. Unit-tested only (`pkg/wavevault`
  `TestSyncLeavesTheVaultLockFreeDuringFetchAndPush`, 8acb6f0a4).
- [ ] (arcterm) A finished run files its open issues on standing initiatives: after the next orchestrator run with no
  initiative named lands, its leftover issues sit on the matching existing initiative (Flaky tests, Hand checks, the
  topic's "… bugs and polish") with no new "… follow-ups (run X)" initiative, and an issue already open gets a note,
  not a second chunk. Prompt change only (`pkg/jarvis/leadprompt.go`, 04d6ef103).
- [ ] (arcterm) A Chat send that never reaches Claude Code comes back: while a Claude agent works, send a message from
  Chat → it shows Queued and, once the turn ends, lands in the conversation (the normal path, unchanged). To see the
  failure path, make the PTY refuse input (stop the agent's process from Task Manager, then send) → a "Message to … not
  sent" toast, no Queued bubble, the text and its file chips back in the box, and a `[chat-send] fail` line in
  `waveapp.log`. Watch for a false failure: a message that does show in the Terminal's box but was toasted as not sent
  (`typedEcho` read the box as empty for 8 s). Agent surface, Chat. Unit-tested and typechecked only (`agentsubmit.ts`,
  `chatpending.ts` `echoStep`/`sendFailure`, `chattakeback.ts` `typedEcho`).
- [ ] (arcterm) The model menu in Chat: click the model chip under a Claude agent's chat box → four rows (Fable 5.2,
  Opus 5.5, Sonnet 5.5, Haiku 5.5), each with a tinted icon and a note, a check on the running one; pick Fable →
  Claude Code gets `/model claude-fable-5-2` and the chip turns to the sparkles icon. Agent surface, Chat.
- [ ] (arcterm) The Effort chip in Chat: beside the model chip, click Effort → Low…Max and Auto, each with a bar meter;
  pick High → Claude Code gets `/effort high`, the chip reads High with three of its five bars lit, and stays High after the
  `◐ … · /effort` line over Claude Code's box goes away. Agent surface, Chat.
- [ ] (arcterm) Esc stops a Claude agent's turn in Chat: while it works, press Esc in the chat box → the turn stops
  (as Esc in Claude Code); again with a message showing Queued → the turn stops and the message comes back into the
  box; again with the focus out of the box (click in the conversation) → the turn stops, no jump to the Cockpit; once
  idle, Esc out of the box goes back as before. Agent surface, Chat.
- [ ] (arcterm) A paused run's strip holds still: pause a run mid-task (+ Run menu → Pause) → the Agent tree's strip
  under it, the lead card's bar and the run sheet show its working task (or the Final check pip) in grey, not blinking;
  Resume → it pulses green again.
- [ ] (arcterm) A file path in Chat has its own right-click menu: in a live agent's Chat, right-click a path link (an
  inline `docs/…` the agent named) → Open beside the agent / Show in Explorer / Copy path, not the message's Copy text
  menu; Show in Explorer opens Explorer with the file selected, and a path that does not exist toasts "File not found".
  Written and typechecked, never run in the app (`pathlinkcontext.tsx` `PathLink`, `pathlinkroute.ts`
  `revealAgentPath`).
- [ ] (arcterm) The RAM popover groups a run's lead, workers and reviewers under one head row: with an orchestrator
  run going (its lead, a worker on a task and a `review t-N` reviewer live), open the RAM chip → your own agents come
  first, then one head row with the run's title (`Build …` cut before "as specified in"), its agent count and the sums
  of CPU, RAM and spend, and under it `Lead` first, then `Task t-N` / `t-N · …` and `review t-N`; none of the three
  sits loose at the top, and the chevron folds the run to its head row. Needs a rebuilt wavesrv: the run comes from
  the server (`runid` / `rungoal`, `wshserver_consumers.go` `consumerOwnerRun`). Scenarios `consumers-popover` and
  `consumers-close-picked` were updated but not run.

- [ ] (arcterm) The Agent sidebar's columns line up (spec 2026-11-13-sidebar-declutter-design): run
  `task verify:ui -- sidebar-columns agent-tree-rail sidebar-agent-ram` on the dev app → all pass, and
  `cdp-shots/sidebar-columns-1-rows.png` shows a 280px sidebar where every agent, lead and worker row ends its second
  line with RAM · tokens · age in faint ink, right edges level down the list, the `2 runs` agent's `1.6 GB` in amber, the
  unread count on the name line, and `asking` at the left of the asking row's second line with its columns kept. In the
  real app the same with live agents: an agent with no RAM read yet keeps an empty gap where its RAM goes. Written and
  typechecked, never run in the app (`agenttree.tsx` `RowCols`, `rowcols.ts`).
- [ ] (arcterm) No second line in the Agent tree pushes RAM · tokens · age past its end (`agenttree.tsx`: `OriginChip`,
  the ask note, `in council`, a worker's held ask now shrink): at 280px with all three columns on, a lead asking you
  with a long question and a `plan queued #1` run link, an agent in a council with a review waiting, and a worker
  holding a card each end their line with the three columns whole and level with the rows around them, the words cut
  with `…` and whole in their tooltip. Not run in the app.
- [ ] (arcterm) A run waiting in the job queue keeps its line (`runQueuedTag`, `jobqueue.ts`): its second line reads
  `› N  Working · 3/6  ≡#1  RAM tokens age`, the progress words still there and the columns whole; with two jobs `≡×2`;
  hovering the tag says `queued #1 · Verify · …` in full. `task verify:ui -- jobqueue-run-tag` was updated, not run. The Agent sidebar also stays 280px with Age off and only RAM + Tokens on (`agentTreeWidth`).
- [ ] (arcterm) The Agent sidebar is back to 248px once a number column is off (RAM or Tokens) (`agentTreeWidth`, `rowfields.ts`):
  `task verify:ui -- sidebar-columns` step 9 passes and `cdp-shots/sidebar-columns-2-narrow.png` shows a 248px sidebar
  with RAM · age lined up and nothing cut off. In the real app, turn Tokens off in Settings → Appearance → Agent sidebar:
  the sidebar narrows at once, turn it back on and it widens to 280px; a dragged File / Transcript panel still leaves the
  centre its room. Written and typechecked, never run in the app.
- [ ] (arcterm) A lead that queued its plan's next part reads `plan queued #1` on its run line, not `queued #1`: while a
  run's lead has queued a second plan (`wsh runs start --plan … --after <its run>`), its row in the Agent tree shows the
  chip `plan queued #1` (`plan blocked` if the entry is blocked), whole on a narrow sidebar, beside the run's progress
  (`frontend/app/view/agents/runorigin.ts` `originLinks`; unit-tested only).
- [ ] (arcterm) The rail's context breakdown reads a real /context: on a Claude agent with a context figure, open the
  Agent rail's session breakdown and press Read the breakdown → the button reads "Reading… about 30 s", then the groups
  show (Messages, System tools, Memory files, Skills…) with figures near `claude`'s own `/context`, and a memory file's
  ↗ opens it in the File tab; no new `.jsonl` appears in `~/.claude/projects/<project>` (`--no-session-persistence`);
  on Windows no console window flashes. The same on a Mac. And on an idle real agent with under 5 minutes of cache
  left, the state row's `cache Nm left` is amber and `now rewrites ~X, later Y` ends the Compact/Clear row (the
  scenario `rail-context-breakdown` seeds every state; `pkg/ctxbreakdown`, `sessionsection.tsx`,
  `agentdetailsrail.tsx`).
- [ ] (arcterm) A real Claude agent files a follow-up through a card and reads its outcome (Add to an initiative from
  Chat, spec 2026-11-12-chat-add-to-initiative-design): in a Claude agent's Chat that you started yourself (not one an
  Arc run started), after an app launch has synced the updated `arc:initiatives` skill, ask it to file a follow-up
  ("add a chunk to this initiative for the logging gap") → its reply holds an `arc-initiative` block that Chat draws as
  an Add to initiative card (Waiting on you), not as raw JSON, and the agent has not run `wsh effort chunk add` itself;
  press Add chunk, then send any plain message ("ok, go on") → the agent's next turn treats the `initiative: added chunk
  …` line that opens your message as the outcome (it does not answer it as a request, and does not propose the chunk
  again), and your bubble shows only what you typed. A live agent's behaviour, which no scenario can drive:
  `chat-initiative` covers the card, the rows and the line with fixture transcripts and a mock RPC (cards from
  `8c5873beb`; the skill rule is `skills/initiatives/SKILL.md`).

- [ ] (arcterm) A real Claude agent asks the plan Handoff and writes an `arc-review` block (`arc:handoff`, spec
  2026-11-12-chat-verdict-handoff-design): in a Claude agent you started yourself (not one an Arc run started), after an
  app launch has synced `skills/handoff/SKILL.md`, have it write a plan with superpowers:writing-plans → it asks one
  `AskUserQuestion` with header `Handoff`, the plan path backticked in the question and the four choices in the
  skill's order, one marked (Recommended); ask it for a review with a reviewer subagent → its reply ends with a fenced
  `arc-review` block (`kind`, `reviewer`, `pass`, `note`, `findings`, `subagent`) and it stops for your pick. A live
  agent's behaviour: the skill text is pinned by `TestShippedSkills` (`0089a1e7b`); the Chat cards that draw these come
  in the run queued after 911b6d3a.

- [ ] (arcterm) The Brainstorm tab's own-words field is a "You replied" in Chat: on an agent with a brainstorm
  question open, type an answer in that question's own-words field in the Brainstorm tab ("Answer in your own words…",
  or "Or type your own answer…" under options) and send it with OK or Enter → the ✓ row for that question in the
  agent's Chat reads "You replied", not "You picked"; an option clicked in the same tab still reads "You picked". No
  scenario step sends through `useAnswer.sendDraft`; Chat's own message box is covered by `chat-redesign` 14c (commit
  `b86ab9fa4`, run ebecc28f's branch `wave/ebecc28f-a804-4c1b-ab2d-88a4ffa8797a-t-9`; `brainstormui.tsx` `useAnswer`,
  `chatbrainstorm.ts` `SentAnswer.typed`; the tab's send is unit-tested only).
- [ ] (arcterm) The pinned prompt band sits right on the other `CompactTranscript` hosts: open a long session in
  History's session detail, a sleeping agent's transcript overlay, and an ended agent's transcript, and scroll each
  down past a few of your prompts → the band holding the prompt you are under sits flush at the top edge of the
  scroller, with no clipped line of the transcript above it, and a jump to a prompt lands it just under the band, not
  behind it. Only the rail transcript is covered, by `rail-transcript-tab` (commit `4671d8cea`, run ebecc28f's branch
  `wave/ebecc28f-a804-4c1b-ab2d-88a4ffa8797a-t-9`; `compacttranscript.tsx`, `pinnedpromptbar.tsx`, hosted by
  `sessionsdetail.tsx`, `sleepingtranscript.tsx`, `endedtranscript.tsx`).

- [ ] (arcterm) The agents/backend and code/diff follow-up fixes of 2026-11-13 render: run `task verify:ui --
  code-changed-walk setup-memory agent-history diff-comments diff-scope` on a dev app (or `node
  scripts/cdp/final-verify.mjs` with those names). New or changed steps, never run: code-changed-walk's last step (a
  palette pick of Code leaves focus on the file tree and ArrowDown moves its cursor), setup-memory step 9 (step 8's
  error alert clears on the next move), agent-history step 15 (a failed scan shows "Could not read past conversations"
  with Retry and retries on its own after 5 s), diff-comments step 6b (the Commit tab's rows badge the pending
  comments), diff-scope steps 3b (Review on a landed run lists only the run's files) and 6b (a corrupt `.git/index`
  reads as Couldn't refresh, not as not a repository). Only unit tests, the typecheck and `node --check` ran.

- [ ] (arcterm) The job queue plans on measured peaks (spec 2026-11-12-measured-job-peaks), on the Mac (Windows held
  on 1.1.2, 2026-11-14: check:ts peaks recorded; an unknown `memhog hog.js` at 1.54 GB was learned and its second run
  took slot j18): in a Claude agent run `task check:ts` twice → the second run's row in the Jobs popover reads "measured" and its
  tooltip names the first run's peak, the row's figure being that peak × 1.2 rather than the table's 3 GB "est.". Then
  have the agent run a `make`-style build that peaks over 1 GB (`make build`, `gradle build`) twice → after the first,
  `~/.arc/jobslot-learned.json` lists its pattern and the second takes a slot and queues like a table command; a
  `waveapp.log` line `[jobpeaks] cannot write …` means the file was held open at that instant (Windows) and the next run
  rewrites it. A worktree dev app leaves that file alone. Unit tests script the process table, the footprints, the
  roster and the store; the real Git Bash process tree on Windows (`ps -l` groups), the Mac's footprint and the live
  roster were never run together (`pkg/jobmeter`, `wshserver_jobpeaks.go`).
- [ ] (arcterm) The brainstorm review cards in Chat draw and act: run `task verify:ui -- chat-brainstorm-review
  chat-redesign agent-chat` on a dev app that boots. Both Final attempts of run f2306dc6 ended unverified on the
  machine (a locked `cmd/wsh/cmd/claude-view-mod` copy, then a cold Vite still pre-bundling after 600 s under memory
  pressure), so nothing below has been seen rendered. Check, against `.superpowers/design/chat-brainstorm-review/`:
  - The Confirm the design card: guesses with New, the yours fold, Edit, That's right and Put mine back, Confirm all
    or Check with a builder.
  - The builder check card: reading with its clock, one question with Decide for me and an own-answer Send, the
    failed state's Try again (still one ✓ Design confirmed row), and review with Approve opening the run launcher or
    its reason.
  - The run card with Open run, and the ✓ Run row once the run lands.
  - The question card's Decided fold and the ✓ rows: design, builder question with no `brainstorm: builder answer:`
    prefix, builder check.
  - Action lines draw no bubble, while a hand-typed message stays a bubble.
  - Every card turns static when the agent exits.

  (`chatbrainstorm.ts` brainstormCard, `chatbrainstormconfirm.tsx`, `chatbrainstormcheck.tsx`,
  `chatbrainstormrun.tsx`, `chatconversation.tsx`; unit-tested and typechecked only.)

- [ ] (arcterm) A dead lead is brought back (lead-dead recovery spec 2026-11-12): in a live Ask me run sitting in a
  failed plan review, `/exit` its lead → the run's Cockpit card shows "Lead down" with Relaunch lead at once, and
  `wsh runs relaunch-lead <run>` starts a lead whose first message says to revise and `wsh jarvis dag submit` again;
  on an autonomous run the replacement starts by itself. Then pause a run whose lead was launched less than a minute
  ago (before its first reply) and resume it → `waveapp.log` shows `had no transcript to resume; launched a fresh
  lead`, not a `claude --resume` that prints "No conversation found". Unit tests stub the spawn and the process exit
  (`pkg/orchestrate/leaddead_test.go`); the real exit hook, spawn and the Cockpit button with no failure row
  (`leadProcessLive`, which only knows exits this window saw) were never run.

- [ ] (arcterm) A run's hung lead is stopped and replaced (run a1d131bb t-2): in a live run, have its lead sit in one
  tool call that never returns (a command that only sleeps, so nothing under the lead uses CPU) while a worker
  finishes → after 30 min of held wakes `waveapp.log` shows `wake: run <id>'s lead held its wakes 30 min with an idle
  process tree; stopping block …`, the lead's process is stopped (its tab stays), and an autonomous run gets a
  replacement lead that carries the missed wakes; on an Ask me run the lead's questions reach you instead. Every test
  scripts `stopLeadFn`; the real `DestroyBlockController` against a real hung lead was never run
  (`pkg/orchestrate/wake.go` `checkHungLocked`, `LeadHungAfter`).
- [ ] (arcterm) A finished worker of a live run sleeps (run a1d131bb t-5): in a run whose first task has passed review
  and whose other tasks keep it open, that task's worker reads asleep in the Agent tree after the idle wait
  (`agents:sleepaftermin`, 30 min), and Wake reopens the same conversation; its lead, a reviewer and the workers of
  unfinished tasks stay awake (`wshserver_agentsleeploop.go` `runOwnedForSleep`; unit-tested only).
- [ ] (arcterm, Mac) A `/btw` in Chat is one card across Claude's column: send `/btw <a question>` from a Claude
  agent's Chat; the card shows a btw tag and your question as its header, "Asking on the side…" with two pulsing lines,
  and a footer "Not in the conversation"; when the answer lands only the body changes, with Copy in the header. Matches
  board B1 of `.superpowers/design/chat-btw`. `25db49d8c`.
- [ ] (arcterm, Mac) Inline code in Chat is lavender like the terminal's: open a Claude agent's Chat, find a reply
  with `code` in it (and one with a highlighted sentence holding code), and the code reads lavender on its faint pill,
  apart from the highlight's yellow ground, not gold. `0a83928dc`.
- [ ] (arcterm, Mac) Skim highlights in Chat survive other agents: with two Claude agents running, get a marked reply
  in one, let the other answer with a marked reply, then switch back: the first reply still shows its highlights.
  Needs a build with `bc13ac270` installed, and agents started after it.
- [ ] (arcterm, Mac) Chat's "Working…" line wears Jarvis's colours: while a Claude agent works, the dot is a small
  core (bright centre, blue rim) that breathes, and the text is blue with a bright band sweeping left to right about
  every 2 s, the "(24s)" after it still grey; with Reduce motion on, the text rests in plain blue. Checked only on a
  static page in headless Chromium, never in WKWebView or the running app (cf811a54d: `chatpane.tsx`,
  `tailwindsetup.css` .shimmer-jarvis, `pulse.ts`).
- [ ] (arcterm) Jarvis's arc reactor icon reads at rail size: the nav rail's Jarvis item (20px) shows the ring, six coils and the triangular core apart, not a grey blot, active (orange) and not, with the
  yellow badge clear of it; What's new's Jarvis lines carry the same mark. Typechecked only, never seen in the app
  (`element/jarvisicon.ts`, canvas `jarvis-nav-icon` option F).
- [ ] (arcterm) Chat's running step ring turns in place: at 125% or 150% Windows display scaling, while a Claude agent
  runs a command, the dashed green ring before "Ran" has its dashes run round a ring that stays put, with no wobble
  and no short dash where it closes; with Reduce motion on it holds still. Not run in the app: no dev app was up
  (`chatstepsview.tsx` StepSpinner, `tailwindsetup.css` dashRun).
- [ ] (arcterm, Mac) Text replacements fire in Chat's message box: type `sv ` (a Text Replacement in System Settings →
  Keyboard) and it turns into "sinh viên " and is sent as that; a Vietnamese word typed with Telex gets no red
  underline, and the terminal stays as before. Checked only in a WKWebView harness with real key events into a
  Lexical editor, never in the installed app or through a Vietnamese input method (7a0f6d0a3: `main.rs`
  `no_spelling_underlines`, `chateditor.tsx`).
- [ ] (arcterm) Opening a compaction's summary at the end of Chat brings it into view: after a `/compact`, click the
  COMPACTED chip near the bottom; as the summary opens the conversation rises until the chip sits just under the
  pinned prompt bar, the summary's first lines showing below it, in one smooth move with no jump back. A chip already
  near the top opens without moving. Only unit-tested and typechecked; `task verify:ui -- agent-chat` step 80 was
  updated for it but not run (`narrationtimeline.tsx` CompactionDivider).
- [ ] (arcterm) Settings → Jarvis & Office shows three short cards before Folding: Jarvis (Character, Vietnam's
  colours), Form (Shows as, Hologram size) and Behaviour (Roams, Quotes), each row's text on one or two lines; searching
  "quotes" or "hologram" still finds its row. Only unit-tested (89dc8e4ef: `settingsmodel.ts`, `settingspages/jarvis.tsx`).
- [ ] (arcterm) Jarvis's hologram form: Settings → Jarvis & Office → Form → Shows as → Hologram replaces Sprout with blue rings in
  the bottom-right corner, faint when calm and solid on hover; clicking it opens the peek and the bubble sits beside
  it. Start an agent and the core beats; once something waits on you it fades into the amber neural sphere, and back
  when it is answered. Float and the fold still show Sprout. No milky disc or square around it, and Hologram size S / M
  / L redraws it smaller with thinner lines, not a blown-out core. Placement, peek and the asking switch were checked
  in the browser cockpit, the look in a live WKWebView window; never yet in the installed app since a20195495 and
  975f3352d (`hologramview.tsx`, `hologramscene.ts`).
- [ ] (arcterm) Chat streams Claude's reply: in a Claude agent started after the install, ask for a long answer in
  Chat; its text grows word by word at the end of the conversation (`data-chat-live` on the part) and, a few seconds
  after each paragraph ends, the stored copy takes its place with no jump or duplicate. A code block mid-stream draws
  closed, a highlight shows once its mark closes, a reply between tool calls ("· summary" in the terminal) shows too,
  and `~/.arc/live/<session id>.json` is rewritten while it streams. Only unit-tested and the mod's `turn.step` probed
  under `claude -p` (05485e953: `live-core.ts`, `livereply.go`, `chatlive.ts`, `chatlivestore.ts`).

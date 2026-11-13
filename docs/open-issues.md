# Open issues — consolidated backlog

**This file is the single "what's left" list.** `docs/deferred.md` holds the why; this file holds the
what. New deferrals get their full entry appended to `docs/deferred.md`, then a one-line row here.

Pruned 2026-10-05: every row was re-checked against git and the closed ones removed (the shipped
orchestrator rows F11–F26, the closed scans, the Jarvis Brief B5 table, the recall-arm held items).
Recover the pre-prune list with `git show c99f2041:docs/open-issues.md`. The orchestrator flaw history
(F1–F26) stays in `docs/orchestrator-redesign-flaws.md`.

The rows of that prune were worked as chunks of `effort:c732b933-f976-4263-b191-fd95454c3d84`, archived
2026-10-06 with nothing actionable left (`wsh effort show c732b933-f976-4263-b191-fd95454c3d84`).

Status legend:

- **Waiting on a hand check** — shipped and unit-tested, never tried in the running app; tick it once tried, then
  delete the line (a finding becomes a row below).
- **Actionable** — can be picked up as-is.
- **Blocked** — cannot start until a prerequisite exists.
- **Held** — deliberately deferred pending a named trigger or evidence; do not build off the spec alone.
- **Declined** — decided against; do not resurface.

---

## 0 · Waiting on a hand check

Moved to its own file, [`hand-checks.md`](hand-checks.md): every shipped change not yet tried in the running app.

---

## 1 · Actionable

| Item | Kind | Effort | Source / notes |
|---|---|---|---|
| (arcterm) Re-measure the dag lock's slow phases on 2026-11-26: `runTick` held the dag lock 5–28 s per pass under memory pressure (run 1cad2fd0, 2026-11-12), and `wsh runs list/show` timed out on the first try. `scheduleLocked` now times its phases, and a hold of at least `slowDagLock` logs `dag <id> lock: waited …, held …, by <caller>, slowest: <phase> <s>s, <phase> <s>s, <phase> <s>s` to `waveapp.log` (phases `load`, `head`, `runs`, `liveness`, `review`, `plan review`, `base check`, `accounting`, `dispatch`, `final`, `status`, `commit`, `events`, `lead close`). On 2026-11-26 read the lines the installed build has logged since: the phase that tops them decides what moves out of the lock. The first suspect is `liveness`, which now holds the stall candidate's whole-transcript read (ask recovery and the background-shell check share it, once per candidate per tick); a worker whose turn ended on a live background shell with idle CPU pays it at each idle CPU sample (about every 20 s) until the shell ends or the 45 min bound passes, and skipping the read while `backgroundWatch` holds a recent entry is the fix if it shows. The due-dated chunk "Re-measure: dag lock phases" (due 2026-11-26) on the initiative "Run self-heal follow-ups" (topic Runs, workers & resource guards) carries this | perf | S | spec `docs/superpowers/specs/2026-11-12-run-self-heal-design.md` decision 7; `pkg/orchestrate/mutation.go` `logSlowDagLock`, `engine.go` `scheduleLocked`, `liveness.go` |
| (arcterm) The Agent rail's breakdown shows only the spend, not what fills the context: add a Context part (conversation vs. what loads every turn, read from a headless `claude -p --no-session-persistence /context` per folder, with links that open each memory file and skill), a cache line and an amber expiring-cache note. Design approved 2026-11-12; plan ready to run | feature | M | spec `docs/superpowers/specs/2026-11-12-rail-context-breakdown-design.md`, plan `docs/superpowers/plans/2026-11-12-rail-context-breakdown.md`, canvas `.superpowers/design/rail-context-breakdown/` |
| (arcterm) A Claude agent's Chat jumps up while it is being read when a new agent is opened with + New (reported 2026-11-11 in the installed app: "mở new agent, new agent xuất hiện, thì agent hiện tại bị tự cuộn lên"). Not reproduced in the dev app at `8db6ad46b`: the `chat-scroll-keep` scenario scrolls a Chat halfway up, then adds an agent to the roster, adds one still launching, moves the focus to it and back, and goes through the real path (Ctrl+N's New dialog opened and closed, `launchAgent` opening a live terminal, then back), also over a copy of a real transcript (`CSK_TRANSCRIPT=<.jsonl>`): every time the scroller keeps its place to the pixel, with no `scrollTop` write and no hidden ancestor. The installed build may predate `6934e3669` (13:05 that day), which changed the switch back to an agent. Next: try it on the newest build; if it still jumps, a screen recording, and whether the agent was working, whether the new one opened in a split, and how far it jumped | bug | S | `scripts/cdp/scenarios.mjs` `chatScrollKeep`; `frontend/app/view/agents/sticktobottom.tsx`, `chatconversation.tsx` (kept place restore), `agentsurface.tsx` (cells hidden on a focus change) |
| (arcterm) The Agent tree reads "No past conversations" until something refreshes it when the one sessions-archive load at boot fails (a scan past its 30 s backend deadline, likely on a big `~/.claude/projects` or a loaded machine): `loadSessionsArchive` marks the error and leaves the list empty, and nothing asks again. Retry with a backoff after a failed load. Found by run 009fc1e8's t-5, whose `launcher-resume` scenario now asks again itself | bug | S | `frontend/app/view/agents/sessionsarchivestore.ts` `loadSessionsArchive`; run 009fc1e8 t-5 report |
| (arcterm) A fresh wavesrv store's first usage scan reads every transcript on disk (7.6 GB here, 1 to 2 minutes), starting 2 minutes after boot, so it loads the machine while a Final's first scenarios run and on a new install's first minutes. Spread it out (a rate cap, or newest projects first) or skip it in a Final's dev app | perf | S | `pkg/projectactivity/tally.go`; run 009fc1e8 t-5 report |
| (arcterm) An asking agent's row in the Agent tree shows two stray amber dots, one pixel outside its top-left and bottom-left corners, where the rounded corner meets the straight edge (installed app, 2026-11-05, row not selected, "So sánh council và ag…" asking). Hovering the row clears them. Pixels in the screenshot: the edge column is `#8a6d17`, the dots `#d39919`, 1×2 px each, in the column outside the row. Seen again the same day as a line beside the box that came and went ("nó nhấp nháy"). Likely cause was `.pulse-tint` (`7c58bf227`): an `inset 0 0 0 1px` box-shadow repainted at 12fps (`--pulse`) over a row with no background colour, which WebView2 leaves residue from until a hover paints `bg-surface-hover` under it. Not reproduced: headless Edge at scale 1, 1.25 and 1.5, rows at fractional offsets, `--pulse` animating, never showed it. Fix in the working tree, untried in the app: the row no longer breathes (only its glyph pulses) and the edge is a `border` on `.asking-tint::after` (`inset: 0; border-radius: inherit`), so nothing repaints it per tick. Close once the installed build shows no line; if it comes back, give the unselected asking row `bg-surface` too | bug | S | `frontend/tailwindsetup.css` `.asking-tint`; `frontend/app/view/agents/agenttree.tsx` row class (`asking && "asking-tint"`) |
| (arcterm) A council's "Summarize again" banner never counts follow-up replies: `councilsummary.tsx` adds ideas + revised + stances from `outdatedChanges` and leaves its `replies` out, so a seat's answer to a follow-up (a proposal table, say) never offers a new summary, though `SynthesisPrompt` already reads those replies. Left out of the pinned Final proposal (2026-11-04), which covers the case by hand: Pin to Report on the follow-up's answer shows it as the Report's Final proposal under the old summary, with no new summary | bug | S | `frontend/app/view/agents/councilsummary.tsx:1052`, `councilmodel.ts` `outdatedChanges`; spec `docs/superpowers/specs/2026-11-04-council-final-proposal-design.md` |
| (arcterm) Open DAG still stutters in the installed app (1.0.1, 1271eafdb, 2026-11-04) when the graph replaces the skeleton. The window now opens at once on a skeleton (graph mounted after the panel's entrance, full-window `backdrop-blur` dropped), but headless Chrome never showed the rest: a 6-task cancelled DAG mounts in 10–20 ms of React (dev build), with no long task and no jump in the fit. Not tried there: a task in `running` (the user's had one), the real event count, WebView2's GPU path. Next: relaunch the installed app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` (closes every agent) and profile the open on real data, or seed a running task in the headless fixture | bug | S | `frontend/app/view/orchestrate/dagmodal.tsx`, `daggraph.tsx`; screenshot of run d81c57a6 |
| (arcterm) The council estimate and the Token burn card are model-blind: `wsh council estimate` counts tokens, not price, and the Token burn gate takes the same number, so a council with opus seats reads as cheap as an all-sonnet one, though opus costs more per token. Since 2026-11-04 the council skill puts the seats that judge a question's central claim on opus at each start, so this now happens on every heavy question; the agent says so in one line before the start, but the card itself does not | gap | S | `pkg/council/estimate.go:33`, `pkg/tokengate/tokengate.go:59`; spec `docs/superpowers/specs/2026-11-04-council-seat-models-design.md` |
| (arcterm) A council's "Summarize again" banner never counts follow-up replies: `councilsummary.tsx` adds ideas + revised + stances from `outdatedChanges` and leaves its `replies` out, so a seat's answer to a follow-up (a proposal table, say) never offers a new summary, though `SynthesisPrompt` already reads those replies. Left out of the pinned Final proposal design (2026-11-04), which covers the case by hand | bug | S | `frontend/app/view/agents/councilsummary.tsx:973`, `councilmodel.ts` `outdatedChanges`; spec `docs/superpowers/specs/2026-11-04-council-final-proposal-design.md` |
| (arcterm) Right-click on an Agent tree row opens the macOS page menu (Look Up, Translate, Search with Google, Copy…) instead of the row's own menu, on a Mac in the installed app (0.15.20, 2026-11-02 21:49): seen on the lead row of run f321b6cf ("Council report"), the menu quoting text selected in the `portfolio` service's page (:8386, "y Sổ Tích luỹ kỳ hạn 12 …"). The cockpit prevents the page menu everywhere outside inputs (`cockpit-root.tsx`), so the click reached a pinned app's cross-origin frame (`AppFrames`, `apppane.tsx`), not the row; nothing was logged. It comes and goes: minutes later the same row opened its own menu (Rename … Copy run id, Close agent). A new agent had started 5 s before the failing click (block 54e980b7, 21:49:54 in `waveapp.log`), a lead, not a cause. Not reproduced: a WKWebView harness on the same Mac sent the right-click to the row with the frame hidden over it (`visibility:hidden`, as an app out of sight is), with the frame shown under a row painted over it, and after a text selection in the frame then hiding it. Next: does it repeat, which way the page was opened (rail or tree row), and does stopping the service bring the row's menu back | bug | S | screenshot 2026-11-02 21:49:59; `frontend/app/view/agents/apppane.tsx` `AppFrame`, `frontend/app/cockpit/cockpit-root.tsx` contextmenu listener |
| (arcterm) `pkg/council` `TestRepliesPostedAsARunEndsAreNeverLost` is flaky: it failed, then passed on a rerun, in the Verify after a merge of run 74b368ce (its t-10), which left that run's Final unverified. The failure text was not kept, and it did not come back on Windows 2026-11-03: 30 runs alone, 90 in six processes at once with `-cpu=1`, and the whole package three times side by side all passed. Next time it fails, keep the `--- FAIL` lines: they say whether it was `h.wait`'s 30 s timeout (a loaded Verify) or a reply left open | bug | S | run 74b368ce report; `pkg/council/runner_test.go` |
| (arcterm) A dev app can fail to start on a build race: run ab534f5b's Final exited with code 201 on `go: github.com/wavetermdev/waveterm/cmd/wsh/cmd/claude-skim-mod/types: no matching versions for query "latest"`, a `go mod tidy` that ran while `sync:claudemod` was deleting and recopying `cmd/wsh/cmd/claude-skim-mod` (its `types/` holds no Go file); the run's change touches neither. The Final was left unverified | bug | S | run ab534f5b final report; `Taskfile.yml` `sync:claudemod` |
| (arcterm) A message meant for one worker reached another session: during run 0ea46b22 a lead's note for the codefix rerun was injected into the newcomer V3 lead's session (07:38:32Z), which the run put down to a lead launched from a tab inheriting that tab's block id. The run's diagnosis, not yet checked in the source (`wsh agents send` routing, `pkg/wshrpc` block targeting) | bug | M | `docs/council-phase0.md` ("Two flags on the data") |
| (arcterm) `wsh council estimate` is low: V0 reads a flat 0.3M on every case (real runs 0.54M), V1 is assumed half of V2 but cost as much (round 1 and the Summary are most of it), and codefix V1/V2 came to ~1.4M against 0.4–0.8M estimated. Phase 0b is far worse: on services-bugs `wsh council start` printed about 1M for V2 and 0.3M for V0, which spent 17.5M and 4.7M, and nothing limits a council's spend once the Token burn card is allowed | bug | S | `docs/council-phase0.md` (Results, Deviations, Phase 0b tokens); `pkg/council/estimate.go` |
| (arcterm) `wsh council bench` asks the Token burn card with Phase 0's per-case figures (solo 0.55M, council 1.4M), which Phase 0b measured 2 to 10 times low on its cases: solo 1.0–4.7M, council 4.4–17.5M. A full bench of today's four cases reads about 7.8M on the card and could spend 40M or more; `--case newcomer` reads 1.95M against about 5.5M. Price each case from its last results row, or at least its file size | bug | S | `pkg/council/bench/cases.go:41`; `docs/council-phase0.md` ("Phase 0b", Cost) |
| (arcterm) Scenario fixes never run live: the steps that failed in run d09b9dd1's Final on a Mac (browser app) and on the base too are fixed in code, the racy settings reads and the Telegram env in 5996d3fd9, `agy-harness` 2/5/6/7/9 and `jarvis-pet` 8 in 8aa3b90e9, `route-picker-flat` (now an in-page catalog that overflows) in 945c0ac8c, but no Final has run them since. One `task dev:browser`, then `task verify:ui -- settings-pages settings-storage settings-telegram settings-runs agy-harness route-picker-flat jarvis-pet`; effort `c721a0be` chunk 10 | verification gap | S | run d09b9dd1 Final, `data/final-shots/f983b4e3-ff58-410d-9457-f3007b0cb39e/1/shots.json`; `scripts/cdp/scenarios.mjs` |
| (arcterm) Engine worktrees moved to `%LOCALAPPDATA%\arc-wt\<8 of run id>` with the kaeltran16 sync (2026-10-13), but our own path readers still look only under `<project>/.waveterm/worktrees`: the sidebar's grouping of engine conversations under their project (`agentsidebarmodel.ts` `ENGINE_WORKTREES`), Claude project mapping (`pkg/agentsessions/claudeprojects.go`), Settings → Storage's engine-tree cleanup (`pkg/storage/worktrees.go`) and Usage's "engine run" project label (`pkg/usagestats/sessions.go` `projectOf`). `orchestrate.runOfWorktree` already reads both | bug | M | `pkg/orchestrate/worktreeroot.go`, `launchorigin.go` `runOfShortTree` |
| (arcterm) Not ported from the kaeltran16 sync (2026-10-13): Usage's **By work** lens (spend by project, run and session; `usageattribution.ts` and the backend's session directory are in, our tabbed Usage surface does not draw it), the New run goal's file-pick button (it lived in the fork's `newruncontrol.tsx`, which our New dialog replaced), and the fork's `docs/orchestrator-guide.md` changes (short worktree root, cleanup round, final stage row) into `docs/guide/orchestrator.md` | feature | M | merge of `kael/main` 713f11140; dropped scenarios `usage-work`, `new-run-attachments`, `run-sheet-carry` |
| (arcterm) Final on a Mac checks Chromium, not WKWebView: `task dev:browser` runs the scenarios in headless Chrome, so WebKit-only behaviour (the File tab Source view's Ctrl+Enter, IME, scrolling) and the scenarios marked `host: true` (notify-toast, float-mini, jarvis-modes) still need a hand check in the real app or a Windows run | verification gap | S | `scripts/cdp/browser-app.mjs`, `scripts/cdp/final-verify.mjs` (`hostOnlyScenarios`); AGENTS.md "Visual verification"; run 915dc28d (2026-10-12) |
| (arcterm) Token burn guard part (1) shipped (a Token burn card before a costly `Agent`/`Task`/`Workflow` spawn). Left: nothing warns while a session burns its 5h window through cache reads (a docs session went ~20M → ~220M tokens in an hour): a burn-rate toast, cache reads shown apart in Consumers, a whole-run cost estimate at plan submit, exempting engine runs | feature | M | `docs/deferred.md` "Token burn guard"; complements `docs/superpowers/specs/2026-10-07-quota-guard-design.md` |
| (arcterm) The Claude sign-in dialog's `TokenScanner` is tested only on synthetic output: the `settings-claude-account` scenario runs a node stand-in through the dev override `arc:dev:setuptoken-cmd`, never the real command. Record a real `claude setup-token` run's pty output (the token redacted to a fixture of the same shape, line breaks and escape sequences kept) and add it as a `setuptokenscan.test.ts` case | verification gap | S | `frontend/app/view/agents/setuptokenscan.ts`, `frontend/app/cockpit/claude-signin-modal.tsx`; plan review of `docs/superpowers/plans/2026-10-07-claude-account-switch.md` (2026-10-07) |
| (arcterm) A Claude Code background session whose terminal has exited (and no `claude attach` tab) shows nowhere: its reports are dropped (`statusTarget`) until a tab attaches. The terminal that sent it to the background is found by its command line (`--resume <id>`) or, when that names no session (a bare `claude`, `--continue`, a picked `--resume`), by the session its block last reported (`agentobserve.DisplayBlock`, 2026-10-10); that path is unit-tested only, never exercised on a live background session. Check: send a bare `claude` session to the background, and its tab keeps its status and subagents | verification gap | S | `waveapp.log` 2026-10-06 16:40:02–16:40:20; `claude agents --json` lists the session `kind: background`; Close already stops it by the `--resume` id (`ce797bee`) |
| The 2026-10-10 fixes were unit-tested on macOS only, where WKWebView answers no CDP: the palette pick that hides its cell (focus goes to the picked agent, `modalfocusfallback.ts`), every ModalShell dialog gating the surface keys (`anyDialogOpen`), the grid holding for its saved focused cell on reload (`gridHold`; `agent-grid` step 10b passed in headless Chrome on a Mac, run 915dc28d, 2026-10-12), and the File tab Source view sending on `Ctrl`+`Enter` in WKWebView. Run `agent-grid` and `md-comments` on Windows (`md-comments` also runs on a Mac in `task dev:browser`), and try the Source view send in a macOS build | verification gap | S | the 2026-10-10 bug fixes (branch `fix/open-bugs`, landed on main 2026-10-12) |
| (arcterm) Closing an agent attached to a background session was never exercised live: `ce797bee` runs `claude stop <id>` from `WorkspaceService.CloseTab` (dry run against the real `claude agents` picked only the background session), but no wavesrv with it has closed a real one. Check: Close it, then `claude agents` no longer lists it `working` | verification gap | S | `pkg/bgagents` `Stop`, `pkg/service/workspaceservice` `tabSessionIds` |
| A run whose lead is down is visible only on the Cockpit: its card shows "Lead down" and "Lead wake failed" with **Relaunch lead** (`leadcard.tsx`, `orchestrate/relaunchlead.ts`). The Agent surface's run row only reads "lead closed" (`runmodel.ts` `dagProgressLabel`), with no action, and `wsh runs show` does not mention it at all. A run whose lead died in an app restart (run 74f0fa77, 2026-10-06) then sat 15 min on a failed plan review with nobody to revise it, unnoticed by a user who works in Agent/Conversation History. Since `90f4b49e` (kaeltran16 fork, merged 2026-10-07) a lead killed by an app restart is resumed at boot (`ResumeInterruptedLeads`), so what is left is a lead that resume cannot bring back. Since the lead-dead recovery spec (2026-11-12) a dag lead's exit writes the lead-wake-failed row at once, an autonomous run relaunches its lead, and `wsh runs relaunch-lead <run>` exists. Still left: the lead-down state and Relaunch on the Agent surface's run row, and a `lead down` line in `wsh runs show` | feature | S | Session 2026-10-06; restart recovery itself is `docs/deferred.md` "Run recovery after a restart — dag runs" |
| Agent + Sessions merge, the 2x2 grid and Uploads were never run live: no `task check:ts`, of the four new CDP scenarios only `agent-grid` and `agent-uploads` have run, and every step passed (headless Chrome on a Mac, run 915dc28d, 2026-10-12); `agent-history` and `agent-rail-sections` have not, and a real WebView2 drag, an OS file drop and the native Attach dialog were never exercised. Clear `public/cockpit-fixtures/active.json` first (`npm run cockpit:fixtures -- --clear`): the new scenarios SKIP while it exists | verification gap | M | `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`; If WebView2 cancels a drag the instant it starts, the fix is a `setTimeout(0)` in `beginAgentDrag` (already deferred once) or moving the overlay mount later |
| `wsh ui state` cannot tell a worker that Conversation History is open (it reports `surface: agent`, `agent:<id>`): needs a `center` field in `UiState` (Go type + `task generate`) | feature | S | `frontend/app/cockpit/uiapi.ts`, `uiclient.ts`; Task 7 review |
| `useLocalImage` (shared by the Uploads lightbox, the Final check viewer and the run sheet) decodes the whole file with no size guard: a very large attached image costs hundreds of MB transiently. Check `content-length` before `resp.blob()` and add a `toolarge` status | limitation | S | `frontend/app/view/jarvis/localimage.ts`; Task 28 review |
| Duplicated rules from the merge: "choose an agent row" (`selectAgentRow` in `agenttree.tsx` and `select` in `terminalsrail.tsx`); the Open-in-split gate (seeded + `canOpenInSplit` + fallback to `openTerminal`) in `agenttree.tsx` and `cockpit/actions/agent.ts`; `blockId != null` checks beside `eligibleIds` | tech-debt | S | final integration review 2026-10-06 |
| OS-file drops on a plain terminal are recorded under its block, but `TerminalRail` has no Uploads section, so they are invisible and count toward `MAX_OWNERS` (40), which can evict an agent's older records | limitation | S | `frontend/app/view/agents/uploadsingest.ts` `ingestFiles`, `terminalsrail.tsx`; final review |
| A sidebar session scan requested inside its rate-limit gap (an exit within 1 s of the last scan, an arrival within 5 s) is dropped, not deferred: two agents closed within a second leave the second ended session missing until the next trigger | limitation | S | `frontend/app/view/agents/usesessionsscan.ts`; Task 5 review |
| Ctrl+Tab with more live agents than grid cells keeps changing which four agents show (it replaces the focused cell); Ctrl+Shift+Tab is "next asking agent, forward", not previous. Decide whether Ctrl+Tab should cycle only among agents already in the grid | held decision | S | `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`; plan `Decisions to confirm` 1 and 4 |
| Markdown comments in the File tab (Preview, cards, the three gestures, the tray) were never run live: the run's Final stage ran on macOS, where WKWebView answers no CDP, so none of the 17 steps of the `md-comments` scenario ran. Run `node scripts/cdp/final-verify.mjs md-comments` on Windows and compare the shots with the mockup boards (`.superpowers/design/md-comments/project/`, gitignored: keep it until then). Step 12 also checks that the Cockpit card of a roster agent with no `blockId` still shows its inline `docs/guide.md` link | verification gap | M | `docs/superpowers/specs/2026-10-06-md-comments-design.md`; run 74f0fa77 |
| (arcterm) A Claude account at its usage limit is not marked exhausted: a token account at its limit never finishes a turn, so arcterm never learns its quota from it (`/api/oauth/usage` refuses a setup-token with 403, so `claudequota` cannot ask either), and the picker shows its last snapshot, or "Not used yet", while it sits at 100%. Noting a 429 usage-limit answer from an agent on it as "exhausted until the window resets" is not done: it needs the agent's hook to report the refusal (and the reset time Claude prints with it) and a snapshot written at 100% with that reset | feature | M | `docs/superpowers/specs/2026-10-07-claude-account-switch-design.md` decision 8; `frontend/app/view/agents/ratelimitstore.ts`, `cmd/wsh/cmd/wshcmd-agenthook.go` |
| (arcterm) A dag child's question that a human owns is not in the Cockpit's "Cần bạn" strip: the strip lists the attention list's gates, blocked tasks, runs to accept or land and escalations, and `ChildAskCard` (answered through `DagAsksCommand`) is fed by the run sheet and the agent rail, not by `GetAttention`. It stays there, and the Cockpit and dock badges do not count it. Listing it in the strip needs the attention list to carry it, with an answer path through `DagAsksCommand` rather than the agent's block | feature | M | `docs/superpowers/specs/2026-10-07-cockpit-needs-you-design.md` decision 5; `frontend/app/view/agents/childaskcard.tsx`, `frontend/app/view/agents/needsyoustripmodel.ts` |
| (arcterm) Whether `/model` applies inside a running Claude turn was never checked (the Consumers plan's Task 1 spike could not drive a session: tmux is not installed on this Mac), so the panel's → Sonnet toast says "from its next turn". Check it as the spike describes; if the switch waits for the turn, add spec decision 9's fallback: a re-run of a worker's task on Sonnet through the existing `escalate` dag action (`wsh jarvis dag escalate <task> --model sonnet`) | verification gap | S | `docs/superpowers/specs/2026-10-08-consumers-panel-design.md` decision 9; Task 1 of the Consumers plan, `git show 75f82cd9:docs/superpowers/plans/2026-10-08-consumers-panel.md` |
| (arcterm) 11 user-guide shots are still `<!-- shot: … -->` placeholders: agent-history, cockpit-needs-you, code-side-column, jarvis-brief, plan-launcher-error, settings-agents, setup-skills, usage-claude-tab, usage-insights-sessions, usage-consumers-tokens, usage-low-ram-card. Each would show real data on a demo store (efforts, the Claude account email, usage from `~/.claude` transcripts, the real skills list) or its CDP scenario failed there; they need fixture data first. Take them at 1600x1000 into `docs/guide/images/` | docs | M | `docs/guide/README.md` |
| (arcterm) A lead the roster still reads as `working` after its turn ended never gets its wake: `flushLocked` sends only when the lead is at its prompt (`atPrompt(st.State)`), so the line sits queued and the run sits `dag-blocked` with nobody acting. Run aeae1cdf (2026-10-14): the lead's turn ended 15:12 (Stop hooks ran, `turn_duration` logged), `wsh agents list` still showed it `working` at 16:33, and the Final-failed wake from ~16:04 never reached it; resent by hand with `wsh agents send`. Find what leaves the state at `working` past a Stop, and give a queued wake a ceiling (say 10 min with the transcript quiet) after which it is typed anyway or the run reads "lead not answering" in Needs you | bug | M | `pkg/orchestrate/wake.go` `flushLocked`; lead transcript `~/.claude/projects/C--Users-u-AppData-Local-arc-wt-aeae1cdf/3cfe7ead-….jsonl` |
| (arcterm) An absolute local path reaches a committed file through a Final failure: Final's output folder is an absolute path under the data dir (`pkg/orchestrate/finalshots.go:37`, `<data dir>/final-shots/<dag>/<round>`), `wsh runs show` prints it as `out=C:/Users/<user>/…`, and a lead pasted it into its fix-round plan (`docs/superpowers/plans/…-fix-1.md`, run bf06d6fe, 2026-10-20). The plan was deleted at HEAD, but the commit kept the path, so the pre-push hook refused `main`; the 28 unpushed commits had to be rewritten with `git filter-branch`. Fix: hand the lead (and print) the folder as `<data dir>/final-shots/…` or relative to the data dir, and have plan submit refuse a line holding the user's home path, as the pre-push hook does | bug | S | run bf06d6fe; my own message to the lead also quoted the absolute path, so a session relaying a Final failure should quote it the same way |

- **`final-stage` CDP scenario, Part B flakes** (2026-10-12). B2–B6 failed in 2 of 3 runs after the lead's
  Final verification block was removed from the details rail, and passed in 2 runs without that change
  (one of which failed only B6). The failing shape: in B2 the DAG modal's final node still reads the B1
  state ("waits on every task") while the tree's row shows Tree running, and from B3 on the stage row has
  lost focus (no pane). That change touches neither the modal nor focus, so the cause is unproven either
  way. Repro: `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs final-stage`, a few runs.

Tracked in their own initiatives, not here:

- **arcterm Claude mod live verify** (usage strip, card answer, Esc, dag child ask, settings hooks; `CLAUDE_CODE_PLUGIN_DIRS` loading with no enable prompt; a card answered after more than ten minutes still answers the call) — effort `99832658`, chunk 9. Each needs an interactive Claude session in the dev app; the headless half is `node scripts/claude-mod-load-check.mjs`. Spec `docs/superpowers/specs/2026-10-02-claude-mod-design.md`.
- **Orchestrator wall-clock** — effort `b1fe5d7e`: live-verify the unit-tested fixes, the round-2 final tree lock, the Timing section live check.

### (arcterm) RAM watch

- **Cockpit office** (2026-10-15, `cockpit-office-bench`, 76 people: 48 desks, 27 seats and the boss; dev app in
  headless Chrome on the Mac, a loaded 8 GB machine): every budget held. Heap −4.13 MB and −664 DOM nodes (the office
  replaces the Cards grid, so both read below Cards); busy −4.7 % over Cards while the boss and three walkers walk (22 %
  raw, baseline 26.7 %), −6.4 % under reduced motion, −15.2 % in a quiet office; 143 to 150 sprites; 37 to 65 ms to
  draw. Budgets: 5 MB, 2,000, 2 %, 0.5 %, 0.3 %, 600, 1 MB, 150 ms. Busy is from React's dev build (a
  performance.measure per render) and sits inside the baseline's noise; the production-build reading is the effort chunk
  'Re-measure: cockpit office busy on a production build'. Row 7 holds what a second Office round trip adds back in
  Cards: +0.01, −1.99 and −2.81 MB in three runs, −2.8 MB in the run's Final. Read from the first Cards read, as the
  spec first had it, the same row read −0.6 to +2.39 MB over seven runs, and a control run that never opened the office
  read +1.56 MB on that step: the dev page's own growth. Both reads come after a forced GC (`metrics()`), yet the dev
  page's heap still swings by up to about 3 MB between reads; the cause is not established, and a swing that size can
  hide a leak under the 1 MB budget.
- **Cockpit office, walking off React** (2026-10-15, same bench and machine): a walk step moved the boss and the walkers
  through their atoms, so React rendered each of them on every animation frame (~400 renders a second while the boss
  and three walkers walk, `Mover` ~205 of them). A step now writes the transform on the DOM: ~176 renders a second
  (`Mover` 26), JS while walking 8.1 to 10.6 % of a core against 9.6 to 19 % before (two 10 s holds each, read with
  `Performance.getMetrics`). The bench: busy walking −9.5 % over Cards (14.2 % raw, baseline 23.7 %), −8.7 % reduced,
  −14.8 % quiet; heap −4.96 MB, −775 nodes, 91 sprites, 74 ms to draw, +0.04 MB on the second round trip. A probe of
  the same hold found paint and raster small: drawing the static scenery (floors, walls, desk parts, 259 of the
  office's 591 nodes) as one pixel canvas, or giving the movers their own layer alone, moved busy by less than the
  holds' own noise (±3 points), and cut only the off-main-thread raster (3.7–4.6 % to 0.7–1.6 %).
- **Cockpit office in pixel art** (2026-10-15, `cockpit-office-bench`, the same 76-person roster; dev app in headless
  Chrome on the Mac, before and after interleaved, two runs each, each on its own ports and store; a loaded 8 GB
  machine, the Cards baseline read 23.5 to 35.7 %): the office's own DOM nodes 498 → 218 (the floors, walls, windows,
  dark layers, screens, sign and desk parts are now two canvases at art resolution, 391 × 1070 × 4 = ~1.67 MB each);
  busy walking −9.4 / −8.8 → −7.1 / −20.5 % over Cards (raw 16.5 / 14.7 → 18.0 / 15.2 %), reduced motion −12.2 / −8.0
  → −9.7 / −18.3 %, quiet −17.0 / −15.5 → −16.6 / −25.3 %; heap −4.29 / −4.46 → −4.70 / −5.87 MB; sprites 91 / 92 →
  95 / 95; time to draw 84 / 78 → 133 / 201 ms; a second round trip +0.03 / +0.02 MB after (−1.13 / +0.02 before).
  One budget missed: the second after run drew in 201 ms (budget 150); the first held at 133 ms, and a third after
  run, read only for the canvas size, at 118 ms. The draw is the one number that rose (about 80 ms before to 130–200
  ms), and the cause is not established: the open now waits for both canvases to paint, and the miss came in the run
  whose Cards baseline read 35.7 %. Re-measure the open on a production build or a quiet machine. Busy did not move
  beyond the holds' noise of ±3 points: the raw readings are 14.7–16.5 % before and 15.2–18.0 % after, and every
  over-Cards figure sits below the baseline, so the budgets read as held from a baseline that swings by more than
  they allow.
- **Cockpit office with the pixel-game controls** (2026-10-16, `cockpit-office-bench` at fd9c41ac0, after run 25462413's
  HUD bar, dialog box and office menu; Tauri dev app on Windows through `final-verify.mjs`, its own ports and store,
  the Cards baseline read 36.6 %): every budget held. 76 people, the office's own DOM nodes 245 (218 before the
  controls), −1174 nodes and −4.68 MB heap against Cards; busy walking −16.2 % over Cards (20.4 % raw), reduced motion
  −16.9 %, quiet −26.8 % with no clock running; 145 sprites; 115 ms to draw; a second round trip −2 MB. The first
  bench run on Windows rather than the Mac, so the busy figures are not comparable with the rows above; the
  production-build re-measure is still open.
- **Cockpit office as floors** (2026-10-16, `cockpit-office-bench`, the same 48 agents over six projects and three
  fixture runs; two runs, in the Windows dev app (WebView2) on a loaded machine, so the absolute figures do not compare
  with the Mac's above): the office draws one floor of four rooms, so it holds 31 people (20 desks, 10 seats and the boss)
  where it held 76, on two floors (G and 1); its own DOM nodes 218 → 113, −1,345 / −1,347 over Cards; heap −5.67 / −5.16
  MB; busy walking −13.5 / −20.8 % over Cards (raw 14.9 / 22 %, baselines 28.4 / 42.8 %), reduced motion −15.2 / −28.5
  %, quiet −18.4 / −32.3 %; sprite cache 81; a second round trip −0.73 / −0.66 MB; time to draw 76 / 155 ms. One budget
  missed: the second run drew in 155 ms (budget 150), with its Cards baseline at 42.8 % against 28.4 % in the first,
  which drew in 76 ms: the same noise as the pixel-art entry's miss, so re-measure the open on a production build or a
  quiet machine. The bench's roster check (step 0) now asks for a full floor of about 30 people and a second floor,
  not 75 people.
- (arcterm) telebot (2026-10-16): one long-poll goroutine + 2 s ticker; measure wavesrv RSS on/off.
- **Cockpit office pet boss** (2026-10-16, `cockpit-office-bench`, one run through `final-verify.mjs` in the Windows dev
  app (WebView2), the same 31 people on two floors as the floors entry above, which is the before: it was measured on
  this run's base commit, where the boss was still the chibi `<img>`; the Cards baseline read 28 %, as in that entry's
  first run): every budget held. The boss is now an `<svg>` of the pet's cells (Sprout's 99 at rest, the Minion's 115)
  in a button, so the office's own DOM nodes 113 → 214 (+101) and nodes added over Cards −1,345 / −1,347 → −1,244; heap
  −5.67 / −5.16 → −5.12 MB (+0.55 / +0.04); sprite cache 81 → 74 (the boss no longer goes through it); a second round
  trip −0.73 / −0.66 → −0.73 MB; time to draw 76 / 155 → 104 ms. Busy: walking −13.5 / −20.8 → −6.5 % over Cards (raw
  14.9 / 22 → 21.5 %, baseline 28.4 / 42.8 → 28 %), reduced motion −15.2 / −28.5 → −7.5 %, quiet −18.4 / −32.3 → −22.5
  % with no clock running. Walking is the one figure that moved against the pet: with a baseline close to the first
  before run's, the raw reading is 6.6 points higher, though inside the 14.9–22 % spread the two before runs had. The
  likely cost is the boss redrawing its ~100 rects on each walk frame (8 a second); one run cannot tell that from noise,
  so it joins the production-build re-measure already open. Budgets: 5 MB, 2,000, 2 %, 0.5 %, 0.3 %, 600, 1 MB, 150 ms.
  The pet's entrance is a one-off 0.5 to 2.2 s as the office opens and is skipped in the bench (`entrance: "skip"`), so
  none of these include it.
- **Office music** (2026-10-16, not measured): to measure by hand: arcterm's WebView2 processes in Task Manager, Office
  open, music off then on for a minute (spec estimate 1–3 MB). Nothing exists with the Office closed or music off but
  the jingles' short-lived nodes. The `office-sound` scenario logs the cues and plays no sound, so it reads no memory.

---

## 2 · Blocked

### Remote/WSL worker host operations

Git surfaces break for SSH/WSL workers because they run on the local host. Not routable today: agent
launch has no connection parameter, `Run`/worktree/`AgentVM` carry no connection field, and the remote
impl doesn't register `GitChangesCommand`/`GitDiffCommand`. Prerequisite chain: (1) remote agent launch
threading connection through launch → run → worktree → `AgentVM`; (2) register host-bound commands on
`wshremote` (or expose `wshserver` handlers over the connection route); (3) then route keyed off the
agent's connection, local default. Effort realistically L counting step 1. Full reference design in git
history (pre-consolidation issue 5). The E8 connserver readiness handshake (patch saved, needs a live
SSH/WSL verify) rides on step 1.

### (arcterm) Codex sessions not shown on a Mac

Reported 2026-10-10: Codex sessions do not show on a Mac; it is not yet known whether that is Conversation History or
the rail. Not reproduced: no Mac at hand. The scanner reads `~/.codex/sessions/**/rollout-*.jsonl` on every OS
(`pkg/agentsessions/agentsessions.go` `allProviders`), with nothing Mac-specific. Suspects: a newer Codex there that no
longer writes rollout jsonl (Windows `codex-cli 0.162.0` already keeps `thread_history_1.sqlite` beside it), a
`CODEX_HOME` the scanner ignores, or, for the rail, an install older than the Codex hook support (`a5deee7d`) or hooks
not yet trusted with `/hooks`. On the Mac first run: `codex --version; echo $CODEX_HOME; ls ~/.codex/; find
~/.codex/sessions -name 'rollout-*' -mtime -3 | head -3; grep -c codex-hook ~/.codex/hooks.json`.

---

## 3 · Held — pick up only on the named trigger

Each names its revive condition in `docs/deferred.md` unless a source is given.

Harnesses:

- **(arcterm) agy kept but unverified: decide 2027-01-15** (2026-10-15) — unused, since the AI Pro plan does not
  reach argon, and installed nowhere, so its fixture-based tests can stay green while it breaks. Keep and check it
  live if the plan reaches argon by then, otherwise remove it; notes in `docs/deferred.md`.

Cockpit and surfaces:

- **(arcterm) A wake that meets Claude Code's cold-resume quota dialog** (2026-11-11) — on `--resume` of a conversation
  whose cache is cold, Claude Code 2.1.304+ may ask "Resume this conversation? … Resuming it will use about P% of
  your 5-hour usage limit" (Resume / Start a new conversation / Resume from summary) when P reaches `minPercent` of
  the `tengu_amber_tally` flag (5); arcterm's wake (`runWake`) would send its message into it. Held: it cannot show
  on this account. The flag prices only `default_claude_max_5x` and `default_claude_max_20x`, Claude Code learns the
  served tier from a `quota_check` request at start, and a Team seat (`default_raven`) is suppressed; even on Max 5x,
  Opus 5.5 at its 1M cap is 3.7%, so only Fable 5.1 or 5 over ~300k tokens reaches 5%. Checked 2026-11-11: a 3-hour-old
  416k-token Fable 5.1 session resumed with no dialog, and a typed wake (paste, pause, Enter) ran. The stale-resume
  dialog (`tengu_gleaming_fair_reuse`, 70 min / 100k) shows only with a precomputed summary. Revive when an agent runs
  on a Max account (`ARC_CLAUDE_ACCOUNT`) or the flag prices Team: reproduce by aging a throwaway session's transcript
  (timestamps back past an hour, the last usage inflated) and resuming it in a PTY with the `WAVETERM_*` env removed;
  source: Claude Code 2.1.322 bundle `_promptStaleResume`, `Q$o`, `Z$o`, `TQs`.
- **(arcterm) Council: session resume across rounds** (2026-11-03) — each expert turn is still a fresh `claude -p`
  with no session resume (`pkg/consult/consult.go`), so every round re-reads the context. Deferred because the verify
  step now sits between round 1 and round 2 and changes the time between an expert's turns, while the prompt cache
  lives 5 minutes (`consult.go:80`). Measure the gap between rounds once that has settled, then decide whether
  resuming the session pays; source `docs/superpowers/specs/2026-11-03-council-stronger-design.md` ("Not in this
  change").
- **(arcterm) Translate's starred words sent to Lingua** (2026-10-31) — starred words stay in arcterm's localStorage;
  sending them to Lingua (its course shelf, or a personal word list it can drill) waits on the person's ask. Notes in
  `docs/deferred.md`.
- **(arcterm) Image diff in File mode** (2026-10-19) — the image diff shipped in Diff → Review only; File mode
  still shows "Binary file", and no CDP scenario covers it. Revive when a changed image in File mode is wanted.
- **(arcterm) Per-tool shortcuts in the tool library** (2026-10-13) — Setup → Tools has no Shortcut field until the
  `Ctrl`+`G` leader-chord question (a tool as a leader chord beside the go-to letters) is settled. Revive when the
  picker's `Ctrl`+`Shift`+`T` is too slow for one or two tools; notes in `docs/deferred.md`.
- **(arcterm) Windows taskbar overlay badge when arcterm is backgrounded** — OS notifications ship
  (2026-10-07) and the Dock badge covers macOS. Measure first that it is missed (`dockbadgesync.ts`).
- **Conversation History's "All activity" rows peeking a run, agent or initiative** (2026-10-01; the old
  Sessions surface moved into the Agent surface 2026-10-06) — revive when a row carries a target; wire it
  through `openOrPeek`.
- **(arcterm) Saved actions: one-click commit, pull and other chores** (2026-10-09) — each action a `cmd` (no
  tokens) or a `prompt` to the selected agent (commit, which needs judgment). Revive when the same chore prompt is
  typed by hand often; design with the Diff surface's repository actions, notes in `docs/deferred.md`.
- **(arcterm) Preview pane for localhost dev servers and HTML files** (2026-10-08) — iframes, not a browser;
  HTML needs its own scoped `/preview/<token>/…` route, never `/wave/stream-file` (it leaks the authkey). Revive
  when opening a dev server or `.dc.html` canvas outside arcterm becomes routine; design in `docs/deferred.md`.
- **(arcterm) Line comments in the Spec/Plan review dialog** (2026-10-07) — reuse `MdDoc`, sent with
  Request changes. Revive when Spec review notes keep pointing at specific passages; settled design in
  `docs/deferred.md`.
- **(arcterm) Editable LaTeX visual mode, Overleaf style** (2026-10-07) — needs CodeMirror 6 beside Monaco;
  the read-only `.tex` Preview covers reading. Revive when switching Preview ↔ Source is the complaint.
- **(arcterm) Session scan cache on disk** (2026-10-06) — skip the first History load's 0.5 s cold parse
  after a launch. Revive when a cold `ScanSessions` measures over about 1 s.
- **(arcterm) In-app auto-update, Chrome style** (2026-10-06) — `tauri-plugin-updater` plus the NSIS
  installer's `/P /UPDATE /R`. Revive when releases are published somewhere the app can fetch without
  signing in.
- **Code and Diff in the nav rail: re-measure ~2026-10-20** (2026-10-06) — drop them from the rail if they
  are reached almost only through the Agent panel's "Open in…" buttons, the palette and `g b` / `g f`.
- **Markdown comments in the Agent panel: re-measure ~2026-10-20** (2026-10-06) — count the sends; near
  zero removes the comment gestures and the tray, keeping the Preview.
- **Terminal file drop → the original file's path** (2026-09-30; a drop pastes a temp copy's path since
  2026-10-06, `6eeab650`) — the original path needs Tauri's `dragDropEnabled`, which disables HTML5 drag
  app-wide.
- **Work on an initiative — "Save place and close"** (2026-09-29) — revive when losing a session's place
  recurs.
- **Run recovery after a restart — New Agent sessions** (2026-09-30) — revive when a session is seen
  re-running its launch prompt.
- **A lead's terminal pane rendering blank while the backend holds its output** (2026-10-05) — seen once,
  2026-09-21, on a lead launched into a freshly restarted dev app: `wavesrv` held 32 KB of scrollback
  (`filestore.db`, `db_file_data`, `name='term'`) and resizing did not repaint. Never reproduced. Revive
  when it is seen again: note the block id and keep `waveapp.log` before touching the pane. No repro
  loop exists, because nothing exposes the xterm buffer to CDP.
- **Cross-surface ideas from the cockpit-focus spec** (2026-09-22; focus itself was removed 2026-10-06) —
  relationship annotation, companion split, time correlation, drag courier.
- **Resource linking beyond navigation** (2026-09-17) — Related Work, the Work Trail strip, structured
  refs, file/diff/commit/session targets, a shared action builder, usage-to-work links.
- **Cross-surface Back history and its context strip** (2026-09-17) — the parked branch
  `feat/surface-integration` and its commit `09e86573` are gone (2026-10-09); reviving means rebuilding it.
- **Composer attachments** (2026-09-18) — revive when attaching a file to a goal or steer is wanted.
- **Diff surface repository actions (Spec B)** (2026-09-04) — checkout, cherry-pick, revert. Commit, fetch, pull
  and push shipped 2026-10-09 (`docs/superpowers/specs/2026-10-09-diff-commit-log-redesign-design.md`). Needs its
  own spec; revive when one of those three is wanted from the Diff surface. The orphaned revert path was deleted
  2026-10-05, recovery commands in `docs/deferred.md`.
- **Diff surface: hiding whitespace-only files from the change list** (2026-09-11).
- **Incremental stateful transcript projection** — only if the capped re-project profiles hot (CDP /
  React-DevTools pass against a populated cockpit first).

Orchestrator:

- **Cross-run Verify hold under `--landing checkout`** (2026-09-15) — one run's failed Verify does not
  hold another run's merges in the same checkout. Branch landing, the default, is unaffected.
- **Lead-authored task routing, Phase 4** (2026-09-17) — the cost/outcome measurement gate. Revive on
  evidence that cheap-first routing waste is common.
- **DAG liveness batching (M1)** — 42.7 ms per running task per 30 s tick on 191 session files; build
  the per-schedule snapshot only when the corpus nears ~3,000 files.
- **Automated board rendering** for the final verifier — revive when a verdict misses a layout defect a
  rendered board would have caught (spec `docs/superpowers/specs/2026-09-25-orchestrator-findings-fixes-design.md` §5).
- **A cheap-model route for judging sessions** — revive when the judging roles are a material share of
  a run's tokens (same spec).
- **An idle-lead watchdog after the dag is done** — revive on a run whose lead sat idle at `run
  finished` without completing (same spec).

Radar:

- **Metadata collectors and the clustering pipeline** (retired 2026-10-06) — revive when chunk 8 of
  `effort:1557171a-e61d-4b29-83fd-fc7f818e6131` measures the fix-sibling audit as not worth keeping.
- **Security review audits** (held 2026-10-13) — revive with a classifier flag for trust-boundary commits
  and a fresh probe; `docs/deferred.md` keeps the probe's prompt.
- **Missing test coverage audits** (held 2026-10-13) — revive if Radar is to report test gaps as their own
  finding type; `docs/deferred.md` keeps the probe's prompt.

Memory hygiene:

- **Pi and Codex memory, merges across batches, a retention score / LRU ordering** (2026-10-14) — each
  with its own revive condition in `docs/deferred.md`.

Jarvis (what survived the 2026-09-22/23 memory and recall-arm removals):

- **U2 Tasks:** in-Wave `## Notes` editing; decision supersede UI (backend `SupersedeDecision` exists);
  manual dossier creation; live push.
- **E Continuity:** a cheap model tier for boundary summaries; completed-task prose re-freshness; a
  per-task resume card beyond the pet's newest-narrative peek.
- **D attribution tuning:** `timeBoxMs` 30d, `weightLayer3` 0.3 (needs a human ground-truth pass),
  `weightLayer2` 0.8 (needs dispatch goals carrying ticket ids).
- **Jarvis Briefing:** generic cross-project progress needs a Wave-owned workstream/milestone contract —
  its own product/data-model session.
- **Pet:** courier gestures (build the store and the gestures together); higher acting tiers.
- **Pi Part B:** `wave_create_widget` pi tool + `wsh widget` vdom CLI — when a concrete consumer appears.

---

## 4 · Declined / permanent limitations (do not resurface)

- Cockpit light/Paper theme — declined; code removed 2026-08-24 (`docs/deferred.md`).
- Gatekeeper v1.1 (make-a-rule + countdown) — revive only on recurring-ask or misfire evidence. Measured
  2026-10-12 over 879 structured asks since 08-11: 737 distinct headers, and the ones that recur (spec
  review, scope, plan review, commit) are approval gates, not routine asks a rule could answer.
- arcterm Environment capability — restore via `git show 4e80bf4f:docs/environment-roadmap.md` if needed.
- Agents-tab fit-one-screen density engine — obsolete, un-executable against the card grid.
- Diff-surface row-density variants and the rest of the narrow-window cascade — the commit column fold
  shipped (`19d324e5`); the rest only on a narrow-window user.
- Rate-limit token *cap* and plan-tier badge — no honest Anthropic-side source.
- Codex/OpenAI 5h-window bars — Codex has no such window.
- (arcterm) A tray popover hidden window made at launch, for a sub-0.5 s first open — the slow opens are by design. Both
  cold opens in `waveapp.log` (1761 and 1783 ms, 2026-11-03) came seconds after the popover was dropped at critical
  memory pressure (`trayicon::keeps_popover`), which also stops the hover warm-up; otherwise the hover builds it and
  its page loads in 60–260 ms. A window kept from launch would hold its 50–100 MB through the very pressure the drop
  answers.
- Codex subagents + depth>1 subagent nesting — no per-subagent files exist; closed no-go.
- Usage pricing family-substring drift (historical Opus billed at current tier) — accepted estimate error.
- OpenCode as a run worker — declined 2026-09-17: this install only uses claude and pi. Codex came back as a task
  worker on 2026-10-10 (`docs/superpowers/specs/2026-10-10-codex-run-worker-design.md`). Recovery path for
  opencode: `docs/deferred.md` 2026-09-14 entry.
- Final stage: persisting a verifier's verdict held during Checking — declined 2026-09-30.
- (arcterm) Task Manager grouping arcterm's agents under one "arcterm (N)" entry (Windows) — not fixable by how arcterm
  spawns. Checked 2026-11-09 on Windows 11 build 26300: the tree is right (wave-tauri → wavesrv.x64 → shell →
  claude.exe), yet the arcterm entry held only wave-tauri, not even its direct child msedgewebview2; it stayed so with
  the window's app id cleared and Task Manager reopened, and a plain `conhost → powershell → ping` left ping out of its
  PowerShell group too, as Chrome's renderers stand apart. On that build Task Manager does not group an unpackaged
  app's children by process tree. Only a package identity (sparse MSIX) might, untried. 9522ccd26, which moved the app
  id from the process to the window on the opposite premise, did not change the grouping.
- The memory subsystem and the Jarvis recall arm (Ask, proactive cards, embeddings) — removed
  2026-09-22/23 on measured usage. Revive only on evidence that note bodies, not index lines, change an
  agent's behaviour (`docs/deferred.md`).

---

## 5 · (arcterm) RAM watch

Features that hold memory over time, measured when they landed. A heavy one is a candidate to drop or to put behind a
setting; that call is the person's. Layers are the compact RAM popup's.

| Feature | Commit | Layer | Measured | Date | Verdict |
|---|---|---|---|---|---|
| (arcterm) Job meter (`pkg/jobmeter`; wavesrv starts it in a later task of the same run): one poll every 2 s reads the process table once (`memusage.ReadTable`, a toolhelp snapshot on Windows), finds each Bash-tool shell under each agent, and adds up that shell's tree with `memusage.JobFootprint` (private bytes on Windows). On Windows, while a Git Bash command is being measured, the poll also runs `ps -l` once from the `ps.exe` beside the command's bash, for the MSYS group members' trees. Held between polls: one small record per measured command, and the argv of each process the meter looked at until it leaves the table | run f366bec5 t-5 | arcterm (wavesrv) and `ps.exe` | `ARC_MEASURE_JOBMETER=1 go test ./pkg/jobmeter -run TestMeasurePollCost -v -count=1`, four runs on this Windows 11 machine while other agents were running, 416–500 processes in the table, one Git Bash command (`sleep 120 & wait`) measured, its tree 2–5 processes (the shell, its bash, the forked sleep through the MSYS group). CPU is the figure to read, wall time swung with the machine's load. Table read: 9.7–17.7 ms CPU (9.5–160 ms wall). Footprints of the tree: under the CPU clock's resolution (0 s CPU, 0.005–0.02 ms wall). `ps -l`: 17.2–22.9 ms CPU in the `ps.exe` child (0.19–1.2 s wall). Whole poll: 14.8–24.7 ms CPU in wavesrv (the table read included) plus 17.2–21.9 ms in `ps.exe`, 36–44 ms per 2 s poll, 1.8–2.2 % of one core. A command's first poll (its tree's argv reads, until a bash with a `ps.exe` beside it) took 24–697 ms wall. With no command measured a poll is the table read alone, 0.5–0.9 % of a core. Not measured: macOS (no `ps -l` there, so the table read and the footprints only), wavesrv's RSS with the meter running, a tree of hundreds of processes (one footprint read each). | 2026-11-13 | light: about 2 % of one core while a Git Bash command is measured, about half of it the `ps -l`, the rest the table read; if it weighs, the `ps -l` is the part to drop, and a Git Bash command's peak then reads low |
| A run worker whose task passed review may sleep (`runOwnedForSleep`, `runOwnership` in `wshserver_agentsleeploop.go`): the sleep loop used to spare every run-owned agent, so a worker whose task was `done`, `verifying` or `verify-failed` stayed alive and idle until its run ended. It now sleeps after the usual idle wait (`agents:sleepaftermin`, 30 minutes unless set; sooner under the RAM trigger) and its session stays resumable, Wake reopens it. The lead, a task's reviewer, a stage session and the worker of an unfinished task stay exempt; a person's Sleep on a run agent is still refused. The loop reads each run's dag once per check (`loadSleepDag`), once a minute, and holds nothing between checks | run a1d131bb t-5 | Interface and the worker's `claude` process | Not measured live; frees memory, holds none. The evidence it answers: run 1cad2fd0's t-1 worker passed review at 13:30 and stayed alive, idle, holding 1.9 GB for 2 h 37 min while its merge waited (the run held ~5.6 GB in all). To read: with a run whose first task has passed review and whose later tasks keep it open, the finished worker's row in the Agent tree reads asleep after the idle wait, and the Resource Manager's run group drops by that worker's figure (hand-checks.md). | 2026-11-12 | frees memory: nothing held but a once-a-minute dag read |
| Terminal Code peek (`codepeekstore.ts`, `codepeekcard.tsx`, `codepeekhost.tsx`): a read-only card under a path in an agent's terminal, opened by Ctrl+Shift+click. Closed, nothing is resident but `codePeekAtom` (null), the focus flag, the load token and one handler closure per agent terminal; the card's code (Markdown, the editors) loads on the first open and stays cached after it. Open, it holds the file's text (at most the 2 MB text cap) and, in a repository, its HEAD copy | `7b29fb067` | Interface | The page's JS heap after a forced GC (`HeapProfiler.collectGarbage`, then `Runtime.getHeapUsage`), from `code-peek`'s last step in a Final dev app: 79.5 MB before the card opens, 79.9 MB with it open, 79.5 MB after it closes; the step fails when the heap after close exceeds the figure before by more than 5 MB. Every Final run reports the three numbers in that step's detail. Not measured: the WebView2 working set, a production build, a 2 MB file. | 2026-11-12 | light: nothing held while closed |
| Diff Log history and the Diff comment layer (`githistorystore.ts`, `diffcomments.ts`, `diffcommentlayer.ts`). Ours has no history overlay or rail (the Commit \| Log panel replaced them), so this is the Log tab's history: its module-level stores stay resident while the surface is off screen, as before; new are `agentCwds` (one string per agent), `hasRemoteByRepoAtom` (one boolean per repository), the settled scope key, and `diffPairFailureAtom` (one string while a read has failed). The comment layer keeps the persisted pending store (at most 50 batches, each comment quoting at most 40 lines) and Monaco view zones only while a pair is open; its one timer is the sent-note's once-a-minute age tick while the note shows | `c40d7d075` | Interface | The page's JS heap after a forced GC around opening and leaving the Log history, from `diff-scope` step 8 in a Final dev app: 75.9 MB before, 77.1 MB open, 76.8 MB after; the step fails past +5 MB after leaving, and every Final run reports the three numbers in its detail. Not measured: the WebView2 working set, a repository with 10,000 commits, a production build. | 2026-11-12 | light: per-agent and per-repo scalars |
| Chat inline visuals (`chatvisualview.tsx`): a live visual is an iframe document in a WebView2 renderer of its own (wavesrv's origin is cross-site to the cockpit), mounted only once it is within 600 px of the chat's view and kept mounted after that, so a long conversation of visuals holds one renderer per visual seen | `e9697139f` | Interface | Not measured. The dev app shares its WebView2 image names with the installed app, so no step of the run could tell its processes apart. To read: the WebView2 working set (`Get-Process msedgewebview2 \| Measure-Object WorkingSet64 -Sum`, installed app closed) before and after three visuals are mounted in one chat (hand-checks.md). | 2026-11-10 | pending |
| New agent → Quick look: `ClaudeTailMessages` (`pkg/agentsessions/tailmessages.go`) reads a Claude transcript backwards in 64 KB chunks for its last 5 messages, skips lines over 256 KB and stops 8 MB from the end; one read per pick still for ~150 ms, nothing held between reads | uncommitted | arcterm (wavesrv) | A stand-in for the spec's live reading (wavesrv's RAM while holding ↓ through a long session list), which an engine run cannot take: `BenchmarkClaudeTailMessages` (`go test ./pkg/agentsessions -run '^$' -bench BenchmarkClaudeTailMessages -benchtime 50x`) on a synthetic 52.2 MB, 5,876-line transcript of long tool results (1 KB to 300 KB lines), Windows, i5-12400: 0.73 MB allocated and ~4 ms (3.8 to 4.8) per read, ~945 allocations, over five runs. An earlier shape of the same 52.2 MB with fewer, longer tool results near its end (3,354 lines) read 2.55 MB and 6 to 8 ms: the allocation follows the length of the lines the last turns hold. This is the allocation of one read, garbage once it answers, not wavesrv's RSS; holding ↓ costs one or two reads. | 2026-11-06 | light: per-read garbage, nothing held |
| Christmas snow: one full-window canvas (`christmassnowview.tsx`) painting up to 120 flakes at 12 fps on its own `setInterval`, only while the Christmas preset shows its effects, motion is allowed, the window is visible and neither in Float nor folded into Sprout | `7e78d1d26` | Interface | From `christmas-theme` step 10, one run (Tauri dev app on Windows through `final-verify.mjs`, the Settings surface at 1600×950, one agent asking, so the lights blink too): the main thread busy 14.5 % of 10 s with the effects on and 5.9 % with them off, about 8.6 points for the snow and the lights' blink together on React's dev build; the JS heap after a GC 61.52 MB on and 61.57 MB off (−0.05 MB, within the page's noise). Not measured: the canvas's backing store (1600×950×4, ~5.8 MB at a scale of 1, raster memory outside the JS heap), a production build, and the snow apart from the blink. | 2026-11-05 | pending: the busy share is the one to watch |
| Brainstorm: `BrainstormPoller` (`brainstormpoller.ts`), always mounted in the cockpit root, reads every attached brainstorm's `brainstorm.json` every 3 s (`BRAINSTORM_POLL_MS`), one FileInfo and one small read per attached agent, and a pane's boards are live iframes while it is open | `ca4fce1c0` | Interface | Not measured. A timer that stays on for the life of the app and costs one file read per brainstorming agent per tick; the parsed file is held per agent in `brainstormsAtom`. To read: the page's JS heap after a GC and the renderer's CPU over a minute idle with 0, then 4 agents each brainstorming, and with a pane open on boards (the thumbnails are iframes). | 2026-10-27 | pending |
| Council: round 1 runs one `claude -p` per expert at once (four in the shipped groups), each read-only with `Read, Grep, Glob`; rounds 2 and 3 are text-only calls. A council holds no process between rounds | `7abb6f4ab` | arcterm (wavesrv) and the experts' `claude` processes | Not measured. The runner's own cost is a goroutine per call and one JSON file per council (rewritten on every reply). Each tool call claims 512 MiB from the job queue (`toolSlotBytes` in `pkg/council/caller.go`), a guess for a claude process reading a project. To read: the working set of the four `claude` processes (and wavesrv's) during round 1 of the first real council, and whether the queue held any of them. | 2026-10-21 | pending |
| Pinned apps: each open app's page kept loaded out of sight for 1 min (`APP_FRAME_IDLE_MS`, `AppFrames` in `apppane.tsx`), so it keeps its page and scroll | uncommitted | Interface | Not measured. One frame, a renderer of its own (127.0.0.1 is cross-site to the cockpit), per app seen in the last minute, where before only the app on screen held one; a guess of 50–150 MB each for a dev page. To read: the WebView2 working set with two apps open, one out of sight, then past the minute. | 2026-10-19 | pending |
| Held services: wavesrv holds every pinned app's server (`pkg/services`), each one `cmd` terminal block in a tab of its own; only a shown (or just left, or Keep-running) service runs, a sleeping one holds 0 MB | uncommitted | arcterm (wavesrv) and the apps' processes | Not measured. arcterm's own cost is one PTY and one goroutine per running service, a timer per service off screen, and once its minute is up one read of its process tree a minute (`services.Busy`) until it is idle, plus a readiness probe (an HTTP GET every 500 ms, up to 30 s) only while a service is starting; nothing polls while one runs or is shown. A sleeping service has no process. The running services' own RAM is the apps', not arcterm's. To read: wavesrv's working set with 0, 5 and 10 services running. | 2026-10-20 | pending |
| Pinned apps: the page's iframe in the centre, and the app's own dev server | uncommitted | Interface, and the app's process | Not measured. No frame until an app is opened; open, the frame (no second webview). The app's server is a held service (row above): it runs while the app is used and for a minute after (always, with Keep running), and its RAM is the app's, not arcterm's. | 2026-10-19 | pending |
| Agent → Transcript tab on the rail (`railtranscript.tsx`): the last 2,000 transcript lines of the focused agent projected and drawn, every earlier chunk the reader loads kept as lines and projected entries until the tab unmounts (closing the rail or leaving the tab drops them), and a live stream while the tab is shown | uncommitted | Interface | The page's JS heap after a GC, from `task verify:ui -- rail-transcript-tab` on a generated 8,404-line, ~50 MB Claude session (large tool results, 26 base64 images): 50 MB before the tab opens, 83 MB after its first read (the last 2,000 lines, 750 items, 200 drawn), 226 MB after Compactions loaded it back to the start (all 8,404 lines held as strings and entries; a tool result is kept whole in its entry). Not measured: the WebView2 working set, and a real 55 MB+ session (hand check in section 0). Loading back is the reader's act, so the cost is paid only on a long read; the first read alone is the cost of opening it. | 2026-10-29 | pending |
| Agent → Canvas gallery: the grid of lazy `<img>` previews, and the viewer's one board iframe | `75278d142` | Interface | The page's JS heap after a GC, from Final's `canvas-gallery` steps 1 (grid) and 3 (viewer) on a 3-canvas fixture: 41.6 MB and 41.8 MB (43.4 and 43.4 in an earlier run). Not measured: the WebView2 working set, and the 17-canvas case. The heap figure is the page's own JS and says nothing of the board iframe. Between visits only the list (a row per canvas) and the folder-URL cache stay. | 2026-10-14 | pending |

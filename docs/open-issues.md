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

- **Actionable** — can be picked up as-is.
- **Blocked** — cannot start until a prerequisite exists.
- **Held** — deliberately deferred pending a named trigger or evidence; do not build off the spec alone.
- **Declined** — decided against; do not resurface.

---

## 1 · Actionable

| Item | Kind | Effort | Source / notes |
|---|---|---|---|
| (arcterm) The Claude sign-in dialog's `TokenScanner` is tested only on synthetic output: the `settings-claude-account` scenario runs a node stand-in through the dev override `arc:dev:setuptoken-cmd`, never the real command. Record a real `claude setup-token` run's pty output (the token redacted to a fixture of the same shape, line breaks and escape sequences kept) and add it as a `setuptokenscan.test.ts` case | verification gap | S | `frontend/app/view/agents/setuptokenscan.ts`, `frontend/app/cockpit/claude-signin-modal.tsx`; plan review of `docs/superpowers/plans/2026-10-07-claude-account-switch.md` (2026-10-07) |
| (arcterm) A Claude Code background session reports its hooks to the block it was sent to the background from, not the tab that attached to it: the daemon inherits that tab's `WAVETERM_*` env, so after the tab closes its `SetMeta agent:transcriptpath` lands on a deleted block, and the Attach tab (`claude --resume <id>` turned `claude attach`) never gets the agent's status. Seen 2026-10-06: session `61c3c450` kept writing to block `0af9fb6e`, deleted 18 s earlier. Fix needs a way to bind a daemon-hosted session to the tab attached to it (e.g. route by session id, not by the hook's env block). Fixed since: a hosted session reports into the tab running `claude attach <key>` (`8a8006d9`), and a session sent to the background from its own terminal (no `claude attach`) is now matched by its fork source, the hosted command line's `--fork-session --resume <id>` against the terminal claude running that id (`agentobserve.DisplayBlock`). Still open: a session whose terminal command line names no session (a bare `claude`, `--continue`, or `--resume` picked from the list) or whose terminal has exited is matched to nothing, so its reports are dropped (`statusTarget`) and no tab shows its status or subagents | bug | M | `waveapp.log` 2026-10-06 16:40:02–16:40:20; `claude agents --json` lists the session `kind: background`; Close already stops it by the `--resume` id (`ce797bee`) |
| (arcterm) Closing an agent attached to a background session was never exercised live: `ce797bee` runs `claude stop <id>` from `WorkspaceService.CloseTab` (dry run against the real `claude agents` picked only the background session), but no wavesrv with it has closed a real one. Check: Close it, then `claude agents` no longer lists it `working` | verification gap | S | `pkg/bgagents` `Stop`, `pkg/service/workspaceservice` `tabSessionIds` |
| A run whose lead is down is visible only on the Cockpit: its card shows "Lead down" and "Lead wake failed" with **Relaunch lead** (`leadcard.tsx`, `orchestrate/relaunchlead.ts`). The Agent surface's run row only reads "lead closed" (`runmodel.ts` `dagProgressLabel`), with no action, and `wsh runs show` does not mention it at all. A run whose lead died in an app restart (run 74f0fa77, 2026-10-06) then sat 15 min on a failed plan review with nobody to revise it, unnoticed by a user who works in Agent/Conversation History. Since `90f4b49e` (kaeltran16 fork, merged 2026-10-07) a lead killed by an app restart is resumed at boot (`ResumeInterruptedLeads`), so what is left is a lead that resume cannot bring back. Show the lead-down state and Relaunch on the Agent surface's run row, and a `lead down` line (and a relaunch command) in `wsh runs` | feature | S | Session 2026-10-06; restart recovery itself is `docs/deferred.md` "Run recovery after a restart — dag runs" |
| Agent + Sessions merge, the 2x2 grid and Uploads were never run live: no `task check:ts`, none of the four new CDP scenarios (`agent-history`, `agent-rail-sections`, `agent-grid`, `agent-uploads`) have run, and a real WebView2 drag, an OS file drop and the native Attach dialog were never exercised. Clear `public/cockpit-fixtures/active.json` first (`npm run cockpit:fixtures -- --clear`): the new scenarios SKIP while it exists | verification gap | M | `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`; If WebView2 cancels a drag the instant it starts, the fix is a `setTimeout(0)` in `beginAgentDrag` (already deferred once) or moving the overlay mount later |
| `deriveKeyContext().modalOpen` ignores `ModalShell`'s registered-modal stack: a ModalShell dialog with no text field over the Agent, Diff or Code surface lets Escape and `j`/`k`/`d`/`f` act behind it unless it has its own atom in that hand-written list (the Uploads lightbox does, `uploadsLightboxOpenAtom`). General fix: add `anyModalOpen()` (`modals/modalstack.ts`) to `modalOpen` and sweep the binding tests | tech-debt | S | `frontend/app/store/keybindings/dispatcher.ts`; found in the Uploads review (2026-10-06) |
| Plain terminals are reachable only by mouse, from the Agent tree's Terminals section (back from the details rail 2026-10-06): not in the palette, Ctrl+Tab or `j`/`k`, and not while the centre is fullscreen (which hides the tree). Option: list terminals in the palette's Agents group | feature | S | `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`; Task 13 review (2026-10-06) |
| `wsh ui state` cannot tell a worker that Conversation History is open (it reports `surface: agent`, `agent:<id>`): needs a `center` field in `UiState` (Go type + `task generate`) | feature | S | `frontend/app/cockpit/uiapi.ts`, `uiclient.ts`; Task 7 review |
| A reload does not resume the grid on its saved focused cell: `focusIdAtom` is not persisted, so `resolveShownAgent` shows the first saved cell whose agent arrives (usually the first in roster order). Hold the shown agent until the saved focused cell arrives or the roster is seeded; `agent-grid` step 10b can only PASS or SKIP until then | bug | S | `frontend/app/view/agents/cockpitsurfacemodel.ts` `resolveShownAgent`; Task 22 review |
| Palette pick (or `agent:split` falling back to replace) of an agent that is not in a multi-cell grid leaves keyboard focus on `<body>` (the old cell is hidden at restore time). The cell `onFocus` hand-off also relies on the exit-animation window keeping the dialog in the DOM: a modal that unmounts synchronously and restores into a cell would revert the pick. Deterministic fix: a flag set around `previous.focus()` in `takeModalFocus` | bug | S | `frontend/app/view/agents/agentsurface.tsx` `focusCell`, `frontend/app/modals/modalfocus.ts`; Task 21 reviews |
| `useLocalImage` (shared by the Uploads lightbox, the Final check viewer and the run sheet) decodes the whole file with no size guard: a very large attached image costs hundreds of MB transiently. Check `content-length` before `resp.blob()` and add a `toolarge` status | limitation | S | `frontend/app/view/jarvis/localimage.ts`; Task 28 review |
| Duplicated rules from the merge: "choose an agent row" (`selectAgentRow` in `agenttree.tsx` and `select` in `terminalsrail.tsx`); the Open-in-split gate (seeded + `canOpenInSplit` + fallback to `openTerminal`) in `agenttree.tsx` and `cockpit/actions/agent.ts`; `blockId != null` checks beside `eligibleIds` | tech-debt | S | final integration review 2026-10-06 |
| OS-file drops on a plain terminal are recorded under its block, but `TerminalRail` has no Uploads section, so they are invisible and count toward `MAX_OWNERS` (40), which can evict an agent's older records | limitation | S | `frontend/app/view/agents/uploadsingest.ts` `ingestFiles`, `terminalsrail.tsx`; final review |
| A sidebar session scan requested inside its rate-limit gap (an exit within 1 s of the last scan, an arrival within 5 s) is dropped, not deferred: two agents closed within a second leave the second ended session missing until the next trigger | limitation | S | `frontend/app/view/agents/usesessionsscan.ts`; Task 5 review |
| Ctrl+Tab with more live agents than grid cells keeps changing which four agents show (it replaces the focused cell); Ctrl+Shift+Tab is "next asking agent, forward", not previous. Decide whether Ctrl+Tab should cycle only among agents already in the grid | held decision | S | `docs/superpowers/specs/2026-10-05-agent-sessions-merge-design.md`; plan `Decisions to confirm` 1 and 4 |
| Markdown comments in the File tab (Preview, cards, the three gestures, the tray) were never run live: the run's Final stage ran on macOS, where WKWebView answers no CDP, so none of the 17 steps of the `md-comments` scenario ran. Run `node scripts/cdp/final-verify.mjs md-comments` on Windows and compare the shots with the mockup boards (`.superpowers/design/md-comments/project/`, gitignored: keep it until then). Step 12 also checks that the Cockpit card of a roster agent with no `blockId` still shows its inline `docs/guide.md` link | verification gap | M | `docs/superpowers/specs/2026-10-06-md-comments-design.md`; run 74f0fa77 |
| Ctrl+Enter does not send the markdown comments from the File tab's Source view while Monaco has focus on macOS: `filetab.tsx`'s handler skips any `HTMLTextAreaElement` target so a comment box keeps its own Ctrl+Enter, and in WKWebView Monaco takes its input in a textarea (WebView2 is unaffected) | bug | S | Final verifier of run 74f0fa77; skip only a target inside `[data-md-box]` (`frontend/app/view/agents/filetab.tsx:86`) |
| Running `scripts/cdp/final-verify.test.mjs` inside a worktree removes that worktree's `src-tauri/target` and `dist/bin` links: its tests spawn `final-verify.mjs` with the repo as cwd, and the script calls `unlinkBuildJunctions(process.cwd())` (`scripts/cdp/final-verify.mjs:292`). What the links point at is left alone, but the worktree's next build starts cold | bug | S | run 74f0fa77 (t-7); give the spawned script a temp cwd, or have an env var name the tree to unlink |
| (arcterm) A Claude account at its usage limit is not marked exhausted: a token account at its limit never finishes a turn, so arcterm never learns its quota from it (`/api/oauth/usage` refuses a setup-token with 403, so `claudequota` cannot ask either), and the picker shows its last snapshot, or "chưa dùng", while it sits at 100%. Noting a 429 usage-limit answer from an agent on it as "exhausted until the window resets" is not done: it needs the agent's hook to report the refusal (and the reset time Claude prints with it) and a snapshot written at 100% with that reset | feature | M | `docs/superpowers/specs/2026-10-07-claude-account-switch-design.md` decision 8; `frontend/app/view/agents/ratelimitstore.ts`, `cmd/wsh/cmd/wshcmd-agenthook.go` |
| (arcterm) A dag child's question that a human owns is not in the Cockpit's "Cần bạn" strip: the strip lists the attention list's gates, blocked tasks, runs to acknowledge or land and escalations, and `ChildAskCard` (answered through `DagAsksCommand`) is fed by the run sheet and the agent rail, not by `GetAttention`. It stays there, and the Cockpit and dock badges do not count it. Listing it in the strip needs the attention list to carry it, with an answer path through `DagAsksCommand` rather than the agent's block | feature | M | `docs/superpowers/specs/2026-10-07-cockpit-needs-you-design.md` decision 5; `frontend/app/view/agents/childaskcard.tsx`, `frontend/app/view/agents/needsyoustripmodel.ts` |
| (arcterm) `docs/orchestrator-guide.md` screenshots `02-quick-modal.png` and `04-goal-modal.png` still show the old New run window. Retake them on Windows with CDP (the `launcher` scenario's shots are a start) | docs | S | `docs/superpowers/specs/2026-10-08-new-launcher-design.md` |

Tracked in their own initiatives, not here:

- **arcterm Claude mod live verify** (usage strip, card answer, Esc, dag child ask, settings hooks; `CLAUDE_CODE_PLUGIN_DIRS` loading with no enable prompt; a card answered after more than ten minutes still answers the call) — effort `99832658`, chunk 9. Each needs an interactive Claude session in the dev app; the headless half is `node scripts/claude-mod-load-check.mjs`. Spec `docs/superpowers/specs/2026-10-02-claude-mod-design.md`.
- **Orchestrator wall-clock** — effort `b1fe5d7e`: live-verify the unit-tested fixes, the round-2 final tree lock, the Timing section live check.

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

---

## 3 · Held — pick up only on the named trigger

Each names its revive condition in `docs/deferred.md` unless a source is given.

Cockpit and surfaces:

- **(arcterm) Windows taskbar overlay badge when arcterm is backgrounded** — OS notifications ship
  (2026-10-07) and the Dock badge covers macOS. Measure first that it is missed (`dockbadgesync.ts`).
- **Conversation History's "All activity" rows peeking a run, agent or initiative** (2026-10-01; the old
  Sessions surface moved into the Agent surface 2026-10-06) — revive when a row carries a target; wire it
  through `openOrPeek`.
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
- **Terminal file drop → pasted path** (2026-09-30) — needs Tauri's `dragDropEnabled`, which disables
  HTML5 drag app-wide.
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
- **Cross-surface Back history and its context strip** (2026-09-17) — parked as `09e86573` on
  `feat/surface-integration`; keep the branch while this is open.
- **Composer attachments** (2026-09-18) — revive when attaching a file to a goal or steer is wanted.
- **Diff surface repository actions (Spec B)** (2026-09-04) — checkout, cherry-pick, revert. Needs its
  own spec; revive when a write from the Diff surface is wanted. The orphaned revert path was deleted
  2026-10-05, recovery commands in `docs/deferred.md`.
- **Diff surface: hiding whitespace-only files from the change list** (2026-09-11).
- **Incremental stateful transcript projection** — only if the capped re-project profiles hot (CDP /
  React-DevTools pass against a populated cockpit first).

Orchestrator:

- **Route picker lists a route the account cannot run (F14)** (held 2026-10-06) — `pi --list-models`
  itself lists `openai-codex/gpt-5.3-codex-spark`, which the provider rejects, so a catalog check at
  spawn would pass it. Revive when dead routes are more than a stray row, as a denylist learned from
  spawn failures. Source: `docs/orchestrator-redesign-flaws.md` F14.
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

Jarvis (what survived the 2026-09-22/23 memory and recall-arm removals):

- **U2 Tasks:** in-Wave `## Notes` editing; decision supersede UI (backend `SupersedeDecision` exists);
  manual dossier creation; live push.
- **U3 Graph:** search/filter; read rail; cross-surface nav out of a node; whole-vault attribution; the
  visual constants (opacity/width/dash/`RUN_SQUARE_SCALE`) want a dense-vault legibility check.
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
- Gatekeeper v1.1 (make-a-rule + countdown) — revive only on recurring-ask or misfire evidence.
- arcterm Environment capability — restore via `git show 4e80bf4f:docs/environment-roadmap.md` if needed.
- Agents-tab fit-one-screen density engine — obsolete, un-executable against the card grid.
- Diff-surface row-density variants and the rest of the narrow-window cascade — the commit column fold
  shipped (`19d324e5`); the rest only on a narrow-window user.
- Rate-limit token *cap* and plan-tier badge — no honest Anthropic-side source.
- Codex/OpenAI 5h-window bars — Codex has no such window.
- Codex subagents + depth>1 subagent nesting — no per-subagent files exist; closed no-go.
- Usage pricing family-substring drift (historical Opus billed at current tier) — accepted estimate error.
- Codex and opencode as run workers — declined 2026-09-17: this install only uses claude and pi.
  Recovery path: `docs/deferred.md` 2026-09-14 entry.
- Final stage: persisting a verifier's verdict held during Checking — declined 2026-09-30.
- The memory subsystem and the Jarvis recall arm (Ask, proactive cards, embeddings) — removed
  2026-09-22/23 on measured usage. Revive only on evidence that note bodies, not index lines, change an
  agent's behaviour (`docs/deferred.md`).

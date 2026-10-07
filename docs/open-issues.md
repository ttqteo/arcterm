# Open issues — consolidated backlog

Consolidated 2026-08-24 from every scattered tracker: the pre-consolidation `docs/open-issues.md`,
`docs/deferred.md`, the two Jarvis sub-project trackers (deleted 2026-09-30; recover with
`git show a4b5bd4f:docs/jarvis-second-brain-open-issues.md` or `…/jarvis-consolidation-open-issues.md`),
the orchestrator roadmaps/plans, and the improvement-scan briefs. **This file is the single "what's left"
list.** `docs/deferred.md` and the briefs hold the why; this file holds the what. New deferrals still get their full entry appended to `docs/deferred.md`, then
mirror a one-line row here.

Every item below carries a source pointer; read that before planning any fix. Status legend:

- **Actionable** — can be picked up as-is.
- **Active** — approved workstream already in progress or designed.
- **Blocked** — cannot start until a prerequisite exists.
- **Held** — deliberately deferred pending a named trigger or evidence; do not build off the spec alone.
- **Declined** — decided against; do not resurface.

---

## 1 · Active workstreams

### Channel data-model scaling — Phases 0–2 shipped, Phase 3 parked (evidence gate 2026-08-25)

Phases 0–2 are in — read pool, indexed `db_run`/`db_channelmessage` rows, redirected hot-path lookups,
delta broadcast. **Phase 3 (Contract: drop the embedded arrays) is parked pending evidence**: the prod
reality check measured 4 channels / 680 KB total blob, so the large-channel target does not exist. See
Held §4 and the `docs/deferred.md` 2026-08-25 entry. Take the Phase 2 carry-ins (cross-channel rail
badges, visual-parity CDP check) before any contract work. Spec:
`docs/superpowers/specs/2026-07-21-channel-data-model-scaling-design.md`. Source: improvement-scan
brief Theme A.

### Diff surface JetBrains parity — Spec A shipped 2026-09-11, Spec B (repository actions) not written

Spec A (Monaco diff pane, merge-base/tip-to-tip toggle, remote refs + fetch, ref swap, file tree,
collapsible history column, plus five review findings from a read of the shipped surface — history
column refresh, capping the two diff readers, in-diff hunk navigation, ignore-whitespace toggle,
splitting `filessurface.tsx`'s five jobs) is **done**: `effort:5e862ff9-4082-492d-8e5d-d02dcae208e2`
reports 19/19 tasks complete, merged to `main` at `212f3d6d` (2026-09-11) — verified 2026-09-17
against `wsh effort show`. One sub-item was deliberately left out of that effort — filtering
whitespace-only *files* out of the change list — tracked separately in the `docs/deferred.md`
2026-09-11 entry.

**Outstanding: gap 6, repository actions** (checkout, cherry-pick, revert) — needs its own spec
before any code; `gitinfo.RevertFile`/`RevertHunk` already exist and are still orphaned (verified
2026-09-17, zero real callers outside generated API + tests). Status: Blocked on a brainstorm
(Spec B). Specs: `docs/superpowers/specs/2026-09-04-git-compare-viewer-parity-design.md`, plan
`git show edf0132b:docs/superpowers/plans/2026-09-04-git-compare-viewer-parity.md`, rationale in the `docs/deferred.md`
2026-09-04 entry. **Owner call 2026-09-17:** the orphaned revert three are kept as Spec B's starting
point, not deleted as part of this orchestrator-run's cleanup — only Spec B decides their fate.

### Lead-authored task routing — Phases 1–3 shipped, Phase 4 held on evidence

The roadmap header still reads "draft, awaiting review" (2026-08-19), but the route chain has shipped:
backend run-route capability authority, settings/channel persistence validation, enforcement at worker
launch + DAG children, capability-driven route controls, draft-first DAG creation (stage-local modal), and
structured fast approval (plans 2026-08-20/21), and Phase 2 (same-tier retry wiring + typed `blocked` +
`escalate` verb) shipped with the 2026-08-25 phase-2 engine — `RetryTask`, `TaskState_Blocked`, `dag
escalate` all present in `pkg/` (the 2026-08-24 scan's "Also noted" line is stale).

**Phase 3 is done (closed 2026-09-17):** the DAG-graph half was already done — `daggraph.tsx` renders
each node's stamped route (`data-dag-node-route`, "inherits run route" / "pinned") and a
`RoutePicker`-driven escalate control, landed with `551f76ee`'s structured DAG fast approval. The
run-evidence half landed in `96fa3254`: `RunEvidence` gains `Harness`/`Model` (`pkg/waveobj/wtype.go`),
sealed from the run's actual route plus the last worker transcript's reported model when one is readable
(`evidenceRoute`/`observedRunModel`, `pkg/jarvis/evidence.go`), falling back to the run's pinned model
otherwise. **Phase 4 (the cost/outcome measurement gate) is held on evidence** per the roadmap — see
`docs/deferred.md`.
Doc: `docs/superpowers/briefs/2026-08-19-lead-authored-task-routing-roadmap.md`.

### Orchestrator redesign — shipped (as of 2026-08-25)

`git show a4b5bd4f:docs/superpowers/plans/2026-08-16-orchestrator-redesign.md` (headless-child contract + child-ask
forwarding) is shipped: `HeadlessContract`, child-ask forwarding (`dag asks`/`dag answer`,
`AskAgentCommand`) are present in `pkg/`, and the design-flaws tracker F1–F10 are
all marked resolved. The plan doc's own checkboxes were never updated (still 27 unchecked) — a
doc-hygiene gap only, the code is in. No longer a sequencing dependency.

### 2026-08-24 orchestrator improvement scan — remaining Jarvis findings

The engine findings O1–O8 shipped in `b9aad7fd`; Jarvis J1 shipped in `67b628a3`, J2/J6 in `a7de0687`, and
J3 (meta-doc corrected, `Backfill`/`Harden` unexported), J4 (per-line timeline truncation), J5 (onexit
failure logging) landed in the same two commits — the scan is fully closed as of 2026-08-25. Historical
evidence remains in `git show a4b5bd4f:docs/superpowers/briefs/2026-08-24-jarvis-orchestrator-improvement-scan.md`.

### 2026-08-26 orchestrator gaps scan — closed

Read-only scan of the shipped phase-2 engine, child-ask lifecycle, lead CLI, and DAG graph FE
(`git show a4b5bd4f:docs/superpowers/briefs/2026-08-26-orchestrator-gaps-scan.md`). **G1, G2, G4, G5 and G7 shipped in
`6c474fa1`**, verified against the code 2026-09-04: `SendBackGate` returns a reopened gate to
`Pending` with the RunID cleared (`scheduler.go:115`); the failure streak clears only on a *fresh*
success (`engine.go` `freshSuccess`, the guard itself from `d692708d` — a blanket clear on any
success would have made the circuit-break untrippable once any task had ever succeeded, so G2's
policy question is answered and closed); `MergeContinue` is reachable as `DagMergeContinueCommand`
end to end; a landed merge stamps `Merged` (marker from `5a863daa`), which cleanup keys off; and
`dag status` prints per-task health/age through `dagStatusLines`.

~~**G6 remains** (low, deferred as design): lead control notifications are fire-and-forget with no
delivery ack.~~ **Closed 2026-09-17** — already fixed by `2ce4161b` (2026-09-14): the control-file
notify is gone; `PostWake` types the wake into the lead and waits for its `working` status
(`pkg/orchestrate/wake.go` `WakeConfirmTimeout`, 30s), retries once, then marks the lead dead, writes
`lead-wake-failed` and moves its questions to the human (`TestWakeConfirmedByWorkingIsNotRetried` /
`TestWakeRetriesOnceThenLeadIsDead`).

### Jarvis Brief B5 — the retired panes' orphaned mounts (deferred 2026-09-10, revised 2026-09-11)

B5 deleted the Subjects column, the Stage and the context rail. Five capabilities were re-homed into the
Brief's detail sheet — the run body, the launcher and its goal row, the record band, the initiative detail,
and B4's profile modal. Thirteen were not, and their implementations are still in the tree, orphaned but
**not deleted**: re-homing one is moving an existing control, not rebuilding it.

**The "mechanical rather than recalled" claim is walked back (2026-09-11).** The list came from sweeping `app/`
for exported functions with no production consumer left, and that sweep is a floor, not a proof. It missed
`agents/channelcomposers.tsx` outright, and it is structurally blind to a capability that dies *inside* a file
that has a successor — the exports keep a consumer (a test file counts as one to a grep), so nothing reads as
orphaned. It is also single-level: an export whose only consumer is itself unmounted reads as live, which is
how steering survived the sweep behind `channelcomposers.tsx`. All three gaps are folded into the table
below. Full rationale: `docs/deferred.md`, the 2026-09-10 entry and its 2026-09-11 update.

**Four are closed** by the Brief review-findings pass (`effort:732863fa-1374-4ab2-9753-1220fc885f34`, F1–F9),
each by re-homing the existing control; the status column says which chunk.

**Every remaining "open" row re-verified against current code 2026-09-17** — all still genuinely
orphaned, nothing silently re-homed since 2026-09-11, except the fleet-roster row below (`FleetRoster`
and `runRailSection` are now fully deleted, not orphaned).

| Capability | Orphaned implementation | Load-bearing? | Status |
|---|---|---|---|
| Channel lifecycle — rename / delete / archive / notes | `deleteChannel` only — `renameChannel`, `archiveChannel`, `setChannelNotes` and their RPCs deleted in `5827e43b` (one-channel-per-project collapse) | no — one channel per project leaves nothing to rename, archive or annotate | closed — `5827e43b`; what it left orphaned is listed in `docs/orchestrator-guide.md` (What the backlog run left open) |
| Initiative lifecycle and the effort card | `EffortCreateForm`, `EffortCard`, `expandEffort`, `toggleEffort`, `unarchiveEffort`, `deleteEffort` | **yes** — no initiative could be started | **creation re-homed (F7)** — `newinitiativecontrol.tsx` + `Shift+N`; **archive re-homed (B6d)** — the effort sheet, and `EffortCard` / `expandEffort` / `toggleEffort` deleted; unarchive / delete still orphaned |
| Autonomy ladder — tier and mode | `AutonomyLadder` (`jarvis/autonomyladderview.tsx`) | yes — this is the remote approval policy | **re-homed (F7)** — the header tier chip, faced by `briefautonomy.ts` |
| Profile drawer — playbook and global profile (*missed by the sweep: died inside `profilepanel.tsx` → `briefprofileview.tsx`*) | `ProfileOverride.playbook`; `getGlobalProfile` / `setGlobalProfile` / `reduceGlobalPrinciples` | yes — `resolveRunPlan` composes every pipeline run from the resolved playbook | **re-homed (F4)** — `BriefProfileModal`'s project/global scope toggle |
| Steering a running worker (*missed by the sweep: its only consumer was the unmounted `channelcomposers.tsx`*) | `steerWorker` (`agents/channelactions.ts`), via the Talk face | yes — unreachable cockpit-wide, not just from the Brief | **re-homed (F3)** — sheet composer → `briefcomposertarget.ts`; `TalkComposer` itself stays orphaned |
| Composer `@`-command vocabulary — `@quick` / `@run` / `@ask` (*missed by the sweep entirely*) | `LaunchComposer`, `TalkComposer` (`agents/channelcomposers.tsx`); `LAUNCH_COMMANDS`, `parseComposerCommand`, `resolveComposerDispatch` (`agents/composercommand.ts`, now reached only by that file and its test) | no — the launcher's controls set the mode; the one-shot `@ask` consult has no typed form | closed — deleted in `5eac07ed`; the launcher's controls set the mode |
| Subject browsing, grouping, filtering | `toggleSubjectGroup`; the grouping model went with `subjects.ts` | no — the Brief's regions cover running work | closed — superseded: the palette's Brief index (`briefpalette.ts` `buildBriefIndex`) browses and filters records, threads, initiatives and sessions, archived included; grouping remnant deleted in `64048f86` |
| Thread lifecycle — archive / delete | `archiveJarvisConversation`, `deleteJarvisConversation` | no | closed — deleted in `4c36093e`, deferred entry holds the revive condition |
| Per-answer cancel and retry | `cancelJarvisQuery`, `retryJarvisQuery` | no | closed — deleted in `4c36093e`; the Brief's failed ask stays retryable from its composer and the pet's converse RPC is capped at 130 s |
| Ask-mode consult results (§4a item 11) | `ConsultsSection`, deleted with the rail | deliberate drop | closed — Ask and proactive retired 2026-09-23 (docs/deferred.md, "The Jarvis recall arm"); ResumeCard stays orphaned |
| Resume / proactive cards (§4a item 12) | `ResumeCard`, `ProactiveCard` | deliberate drop | closed — Ask and proactive retired 2026-09-23 (docs/deferred.md, "The Jarvis recall arm"); ResumeCard stays orphaned |
| Rail fleet roster and per-worker dismiss | `dismissWorker` only — `FleetRoster` and `runRailSection` are fully deleted from the tree (verified 2026-09-17), not just unconsumed | no — the header keeps a derived fleet line | closed — `dismissWorker` deleted in `bf60b61f`; no roster exists and the header's fleet line ages idle workers out; the stored-dismiss reader stays |
| Stage turn renderers | `JarvisAnswer`, `JarvisWorkingSteps` (`jarvis/jarvisturn.tsx`) | largely superseded by `briefdrew.ts` | closed — `jarvisturn.tsx` deleted in `51cb08c1`; its two remainders (citation-aware turn prose, and a verdict badge for a `weak`/`notfound` terminal) re-homed into `briefturn.ts`, consumed by `briefsurface.tsx` |

---

## 2 · Actionable smalls

The reliability findings below are ranked and detailed in
`git show a4b5bd4f:docs/superpowers/briefs/2026-08-25-reliability-improvement-scan.md`; no implementation is approved yet.

| Item | Kind | Effort | Source / notes |
|---|---|---|---|
| (arcterm) A Claude Code background session reports its hooks to the block it was sent to the background from, not the tab that attached to it: the daemon inherits that tab's `WAVETERM_*` env, so after the tab closes its `SetMeta agent:transcriptpath` lands on a deleted block, and the Attach tab (`claude --resume <id>` turned `claude attach`) never gets the agent's status. Seen 2026-10-06: session `61c3c450` kept writing to block `0af9fb6e`, deleted 18 s earlier. Fix needs a way to bind a daemon-hosted session to the tab attached to it (e.g. route by session id, not by the hook's env block) | bug | M | `waveapp.log` 2026-10-06 16:40:02–16:40:20; `claude agents --json` lists the session `kind: background`; Close already stops it by the `--resume` id (`ce797bee`) |
| (arcterm) Closing an agent attached to a background session was never exercised live: `ce797bee` runs `claude stop <id>` from `WorkspaceService.CloseTab` (dry run against the real `claude agents` picked only the background session), but no wavesrv with it has closed a real one. Check: Close it, then `claude agents` no longer lists it `working` | verification gap | S | `pkg/bgagents` `Stop`, `pkg/service/workspaceservice` `tabSessionIds` |
| arcterm Claude mod live verify: usage strip fills with the statusLine unwrapped; an `AskUserQuestion` answered from the card reaches Claude with no keystrokes; Esc during the wait clears the card; a dag child's ask reaches its lead and `wsh jarvis dag answer` resolves the waiter; `CLAUDE_CODE_PLUGIN_DIRS` from settings env loads with no enable/hot-reload prompt in an interactive session; a card answered after more than ten minutes still answers the call (`$.process.spawn` has no hard timeout) | verification gap | S | Spec `docs/superpowers/specs/2026-10-02-claude-mod-design.md` ("To verify in implementation"). Each needs an interactive Claude session in the dev app; `AskUserQuestion` is not offered under `claude -p`, so no run checks them. The headless half (settings-env load and usage publish) is `node scripts/claude-mod-load-check.mjs`. Effort `99832658`, "Live verify" chunk |
| A run whose lead is down is visible only on the Cockpit: its card shows "Lead down" and "Lead wake failed" with **Relaunch lead** (`leadcard.tsx`, `orchestrate/relaunchlead.ts`). The Agent surface's run row only reads "lead closed" (`runmodel.ts` `dagProgressLabel`), with no action, and `wsh runs show` does not mention it at all. A run whose lead died in an app restart (run 74f0fa77, 2026-10-06) then sat 15 min on a failed plan review with nobody to revise it, unnoticed by a user who works in Agent/Conversation History. Show the lead-down state and Relaunch on the Agent surface's run row, and a `lead down` line (and a relaunch command) in `wsh runs` | feature | S | Session 2026-10-06; restart recovery itself is `docs/deferred.md` "Run recovery after a restart — dag runs" |
| Conversation History's "All activity" feed rows (the old Sessions surface moved into the Agent surface 2026-10-06) can't peek a run, agent or initiative (they link sessions, not runs) | feature | S | `docs/deferred.md` "Sessions All activity feed rows peeking"; deferred 2026-10-01 |
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
| Issue 8 deep-link fix was never reproduced live (unit-tested only) — verify with a focused agent + dirty worktree | verification gap | S | pre-consolidation issue 8 detail (in git history); fixed 2026-08-04 |
| (arcterm) Windows taskbar overlay badge when arcterm is backgrounded (OS notifications ship, 2026-10-07; the Dock badge covers macOS) — measure-first | feature | S | `dockbadgesync.ts` |
| Diff-surface orphans: `GitRevertCommand` / `gitinfo.RevertFile` / `gitinfo.RevertHunk` have no caller (`filesstore.reloadChanges` was the fourth until `aa9ba8e8` gave it the poller and `r`) | tech-debt | S | `docs/deferred.md` 2026-07-31 entry. **2026-09-04:** `reloadChanges` should be split from the revert three — the surface reads its change list on mount and never again, so a file edited while on screen keeps stale counts, and this is the refresh that gap wants. **2026-09-05:** the `reloadChanges` half is *implemented but not landed* — a live DAG run built it (selection-preserving refresh, `files:refresh` on `r`, a ~10 s visible-surface poller, 8 behavioural tests) and it sits in the throwaway worktree `.claude/worktrees/files-refresh`, verified there at 60 tests passing and `tsc` clean. **Landed on `main` 2026-09-05** (fast-forward to `aa9ba8e8`; re-reviewed before merge, 212 tests green, `tsc` exit 0, `surface-smoke` 10/10). The `reloadChanges` half of this row is closed; the revert three remain untouched and still belong to Spec B. **Owner call 2026-09-17:** kept as Spec B's starting point, not this orchestrator run's cleanup — no longer an S-effort item; only Spec B decides their fate |
| Files-surface CDP visual pass (plan Task 9, deferred while :9222 was occupied) | verification | S | `docs/deferred.md` Files-surface entry |
| ~~`MaxDagTasks` has no path for a plan larger than the cap~~ **closed 2026-09-16** | bug | M | flaws tracker F11. Orchestrator-redesign slice 5c deleted the cap outright (`jarvis.MaxDagTasks`, `orchestrate.MaxTasks`, `MAX_DAG_TASKS` and the `NewTaskGroup` check): a plan's size is the human's call. `MaxParallelism` still bounds concurrent cost, which is the limit that was doing the real work. A split path across runs is no longer needed to carry a large plan |
| ~~One run holds exactly one DAG, stated nowhere~~ **fixed 2026-09-04** | bug | S | flaws tracker F12. The rule is now stated in all three places a lead meets it: the prompt (`run.go:416`, since `eda08f24`), both submit paths' CLI help (`dagOneDagPerRunNote`), and both error texts (`dag.go` task ceiling, `wshserver_dag.go` dag conflict) |
| ~~No first-token deadline: a lead that dies on its first model call is indistinguishable from one that is thinking~~ **exit half fixed 2026-09-04; deadline half falsified live 2026-09-05, narrowed 2026-09-11** | bug | M | flaws tracker F13 + R10 addendum. The **exit** path is sound and stays: an agent that exits non-zero without stamping a transcript is reported at `onexit.go` in seconds instead of dropped, and a dead lead fails its running phase so the run derives `blocked` instead of reading `executing` forever. The **first-token deadline** half is harmful. `lastActivityForRun` returns `tracked=true` for any liveness-capable runtime even when no session file matched (`liveness.go:137`), so the `!tracked` guard at `engine.go:232` cannot protect a claude child: with no transcript yet it has `LastActivity == 0` and ages against `FirstTokenDeadline` *while working normally*. In the 2026-09-05 live run all four children wrote **no transcript at all** for their entire successful lifetime, and two of three timed tasks ran past the 5-minute deadline while committing correct work — t-1 304,765 ms, t-2 308,798 ms, t-3 274,921 ms. Only the 30 s `watchdogInterval` failing to land in the 5–9 s exposure window prevented a false `Stalled` and the retry that discards a finished worktree. The deadline sits at the median task duration for this workload, so it is a per-task coin flip, not an edge case. **Narrowed 2026-09-11** to the first option: `firstTokenRuntimes` (`liveness.go`) arms the deadline for `pi` alone — the one runtime verified to write its transcript per event — and `firstTokenArmed` gates the sweep at `engine.go`. A claude or codex child that has written nothing is now left `running`, so the exit hook is its only catch; `StallThreshold` is untouched, since it needs a transcript to exist before it can age one. The pty-output alternative (15–59 KB per 45 s while working, hard zero the moment work stops) stays unbuilt — it discriminates in both directions where the transcript never does, but the engine collects no pty freshness today |
| Route picker offers routes the account cannot run — the backend rejects at `runroute.go:79`, the picker still lists them as selectable | bug | M | flaws tracker F14. **2026-09-04, investigated and deliberately not fixed:** entitlement is not statically knowable — `ListHarnessesCommand` reports capability by construction, and a probe costs a process spawn per launch and goes stale anyway. The pi half (tier routes resolving to a bare `deepseek-v4-pro`) did **not** reproduce: on this install that id is unique to `opencode-go`, so it resolves. It is data-dependent, not deterministic — a static provider prefix would be exactly as fragile as the bare id. The durable fix is catalog-backed resolution at spawn, where ctx is available. Severity dropped by F13: a dead route now fails in seconds with the provider's own message instead of reading healthy for 15 minutes |
| ~~`import-tasks` hardcodes `parallelism: 2` with no flag~~ **fixed 2026-09-04** | tech-debt | S | flaws tracker F15; `--parallelism` added, defaulting to `orchestrate.DefaultParallelism` (the dag's ready width, capped at `MaxParallelism`) |
| ~~Merge gate has no liveness and no age~~ **fixed 2026-09-04** | bug | M | flaws tracker F16 + R10. A merge-ready task open past `MergeGateStaleAfter` (30 min) counts as attention, so health leaves `healthy` for `needs-you`. Aged from the retained task-done boundary; a gate whose event was pruned has no clock and is deliberately left alone. **Confirmed live 2026-09-05:** on a gate the lead never acted on, health flipped `healthy` → `needs-you` at exactly the 30-minute mark; the stranding it caught measured 1,848,673 ms and 1,843,493 ms of finished work sitting invisible while health read clean. **Age rendered 2026-09-27:** `wsh jarvis dag status` and the lead card show `merge waiting 34m`, from the digest's `MergeGateTs`; a gate with no clock shows no age |
| ~~A pending ask latches forever if the agent hangs or dies mid-tool~~ **fixed 2026-09-18** | bug | M | **F22, found live 2026-09-05.** Ask visibility is set by the `AskUserQuestion` PreToolUse hook (`wsh ask`, non-blocking) and cleared *only* by the PostToolUse hook (`wsh ask --clear`). An agent that never completes the tool never reaches PostToolUse, so the block stays `state=asking` with no timeout, no liveness gate, and nothing to distinguish it from a live question. Observed: hook published `asking` at 23:23:38, agent hung after its picker closed, card still demanding an answer 70 minutes later. `AgentAskClearCommand` is exactly what the PostToolUse hook calls, which is why clearing it by hand worked. Fix shape: age the ask and gate it on worker liveness, the same signal F13 needs. **Delivery half fixed 2026-09-14 for DAG children (orchestrator redesign slice 3):** an answer the child never clears, because it hung or died mid-tool, goes back to its owner noted `answer was sent but never confirmed`, and a second miss moves it to the human, so a hung child surfaces instead of reading answered. The ask itself still latches: nothing ages it against worker liveness, and a session ask outside a DAG is unchanged. **Fully fixed `2628c6a0`:** `livePendingAsks` (`pkg/jarvis/attention.go`) now also retires an ask when its block is a kept local (non-job-backed) shell whose process has ended — `controllerStatusFn` reads the live `BlockControllerRuntimeStatus`, and `Status_Done` counts as gone — closing the liveness gap for a session ask outside a DAG |
| ~~`answeragent` reports success for an answer nothing consumed~~ **fixed 2026-09-18** | bug | M | **F23, found live 2026-09-05.** `injectAnswer` (`pkg/agentask/deliver.go:68-76`) returns `true` as soon as the last keystroke is written to the pty; nothing confirms the agent accepted it or resumed. The RPC therefore returns success into a void — no error, no retry, no escalation — and the caller cannot distinguish "answer delivered and accepted" from "answer delivered and agent died". The waiter path (`ResolveWaiter`, pi bridge) does confirm; the Claude Code keystroke path does not. **Partly fixed 2026-09-14 for DAG children (orchestrator redesign slice 3):** a typed answer counts as delivered only when the agent clears the ask; one not cleared within `AnswerClearTimeout` (30s) goes back to its owner with the failure noted, and a second miss moves it to the human. The RPC still returns on the last keystroke, and a session answer outside a DAG is still unconfirmed. **Fully fixed `2628c6a0`:** `injectAnswer` (`pkg/agentask/deliver.go`) now awaits the agent's clear for every keystroke delivery, DAG child or plain session alike (the `pending.Owner != ""` special-case is gone); a session ask whose clear times out is republished to the human (`publishSessionAskFn`, `pkg/orchestrate/queue.go` `sweepAsks`) instead of expiring silently. **Live-checked 2026-09-21, passed:** see `docs/orchestrator-guide.md` (What the backlog run left open) |
| Ask banner age is hardcoded to "just now" by accident | bug | S | **F24, found live 2026-09-05.** `agentrow.tsx:439` renders `formatAge(agent.activeMs)`, but `withAsk` deliberately sets `activeMs: undefined` for an asking row and puts the real age in `blockedMs` (`agentsviewmodel.ts:783-784`, derived from the ask's own `ts`). `formatAge(undefined)` returns `"just now"` (`agentsviewmodel.ts:357`), so **every** ask banner reads "just now" regardless of age. Same mistake at `agentdetailsrail.tsx:91` (the ternary special-cases only `idle`) and `runworkercard.tsx:64`. Compounds F22: the one element that would expose a latched ask says it is fresh. Fix: a `displayAgeMs(vm)` helper picking `blockedMs` when asking, with a test, used at all three sites. Survived because the model layer is well covered while components are not — the repo has no jsdom render tests by design. **Fixed 2026-09-05:** `displayAgeMs(agent, now?)` in `agentsviewmodel.ts` returns the field that state actually populates (`blockedMs` asking / `activeMs` working / `now - idleSince` idle), with 5 tests; applied at all four sites (`runworkercard.tsx` had two, not one). The idle branch of `agentdetailsrail.tsx:91` had the same misread and was fixed with it. Note the render sites themselves stay unverified by unit tests — only the helper's contract is covered |
| ~~No agent state represents "hung"~~ **fixed in `1f116196`** | bug | S | **F25, found live 2026-09-05.** With its latched ask cleared, a process that was provably dead (frozen pty, ~1% CPU, no output for 70 min) immediately reclassified as `Working 1`. The roster has asking / working / idle and nothing else, so a hung agent must misreport as one of them. **Fixed in `1f116196` for claude:** a working agent with no terminal output for 3 min reads `hung · no output Nm`. Hook state stays authoritative — the overlay is derived client-side from a throttled `lastoutputts` stamp on `BlockControllerRuntimeStatus`, never published into `Event_AgentStatus`. **Live-checked 2026-09-21:** a claude agent frozen with `NtSuspendProcess` reached `hung · no output 3m` as specified. **pi stays out, measured not deferred:** pi renders nothing between a tool returning and the model replying, and a minimal turn sat silent for 142.8s against a threshold that fires at ~150s of real silence once the 30s publish throttle is counted — the gap is bounded by model latency, so covering pi needs a signal other than PTY bytes. Detail in `docs/orchestrator-guide.md` (What the backlog run left open) |
| ~~A force-killed agent leaves its run `executing` forever~~ **fixed 2026-09-18** | bug | M | **F26, found live 2026-09-05.** Run outcome is hook-driven; `Stop-Process -Force` fires no `SessionEnd`, and nothing reconciles a vanished worker process against run status. Verified: lead killed, run still reported `status=executing phases=running` minutes later. The blockcontroller knows the process is gone; the run state never asks it. **Still open 2026-09-05** — the stranded run was closed by hand (`advancerun action=complete phaseidx=0 commit=aa9ba8e8`, which sealed evidence matching git exactly: 6 files, +173/-13), confirming only that the transition works when something calls it. Nothing calls it automatically. **Fixed `646f032c`** for every non-dag run (quick, pipeline, orchestrator lead): `orchestrate.HandleRunWorkerExit` (renamed from the lead-only `HandleLeadExit`) fails the running phase on any tracked worker's exit, recorded as a new `worker-exited` run event; a `StopAllBlockControllersForShutdown` shutdown flag makes the exit hook a no-op during app quit, so quitting is never itself a failure. **Live-checked 2026-09-21, passed:** killing a Quick run's worker blocked the run with a `worker-exited` event within ~4s, and an app death mid-run did not fail the run. **Both caveats closed 2026-09-30** (`git show a4b5bd4f:docs/superpowers/plans/2026-09-30-run-restart-recovery.md`): at boot `orchestrate.MarkInterruptedRuns` fails every non-dag run's running phase with an `interrupted` event, so a run whose app died reads Blocked instead of a zombie; a blocked run's worker no longer relaunches when its tab remounts; and the blocked card offers **Resume**, which restarts the worker in its own session and tab. Not yet live-checked: the plan's Live check section is the procedure. Dag runs and New Agent sessions after a restart are deferred (`docs/deferred.md`). Detail in `docs/orchestrator-guide.md` (What the backlog run left open) |
| ~~The Gatekeeper escalates every multi-question or multi-select ask without judging it~~ **fixed `1dcf0a88`** | limitation | M | **Fixed `1dcf0a88`** (merged in 443c5f66): every ask reaches the judge, answered all or nothing and validated by `agentask.ValidateAnswers` before delivery. `docs/deferred.md` 2026-09-14 entry, which holds the fix shape. Delivery already types both shapes (`63ffc6e1`, `4a6efb84`); only `pkg/jarvis` assumes one question and one pick. **Skipped 2026-09-17 — held on evidence:** DAG child asks now go to the lead (`pkg/jarvis/watcher.go` `handleAsk` returns early for `isDagChildRun`), so the Gatekeeper judges only non-DAG and concierge workers; the redesign's urgency (the judge as the only automated child-ask answerer) no longer applies, and there is no evidence multi-question asks are common outside DAG children |
| A merge-point Verify timeout kills the shell but not its children, and one run's failed Verify does not hold another run's merges in the same checkout | limitation | M | `docs/deferred.md` 2026-09-15 entry, with where each fix plugs in. **Deferred 2026-09-15 by orchestrator redesign slice 4c**: one run per checkout needs neither. **Re-checked 2026-09-29:** the first half is fixed, since a plan command now runs in a Windows job object and a timeout kills its whole tree (`plancmd_windows.go`, `jobobject.KillTree`). The second half applies only to `--landing checkout`: a branch-landed run (the default) merges in its own landing tree, so another run's failed Verify cannot sit under it |
| ~~A skipped task's commits land with its lane, and a retried task's evidence leaves out its failed attempt's commits~~ **fixed `720ba0e1`** | limitation | S | **Fixed `720ba0e1`** (merged in 443c5f66): skip resets the lane to the task's first-dispatch `StartBase` after a recovery patch, and a retry starts from it. `docs/deferred.md` 2026-09-15 lanes entry, with where the fix plugs in. **Deferred 2026-09-15 by orchestrator redesign slice 4d**: workers commit only at the end, so a failed attempt rarely has commits |
| ~~The record peek's yield-while-stacked workaround is now unnecessary — unwind it as its own change~~ **closed 2026-09-18** | tech-debt | S | **2026-09-11, jarvis motion pass.** `briefpeekview.tsx:185` passes `open={recordId != null && pendingStatus == null}` so the peek *unmounts itself* whenever its confirm dialog is up. That was a workaround for every mounted `ModalShell` claiming Escape and focus at once, so one press dismissed the confirm and the peek behind it. `frontend/app/modals/modalstack.ts` plus the `isTopModal` guard in `modalshell.tsx` fixed the underlying bug, so the yield now only costs the peek its scroll position and any in-flight state on every stacked confirm. Deliberately **not** unwound in the motion pass: it is a behavior change to a surface no motion task otherwise touched, so it belongs in its own diff with its own check that Escape closes only the confirm. **Unwound in `293f55ca`:** `ModalShell` takes focus/Escape only when it owns the top of the stack (`ownsFocus(stack, id)`, `modalstack.ts`), so `BriefPeek` opens on `recordId != null` alone and no longer unmounts under a stacked confirm. **Live-checked 2026-09-21, passed:** see `docs/orchestrator-guide.md` (What the backlog run left open) |
| ~~Bounded orchestrator run never closes its lead tab~~ **fixed `89dd3705`** | bug | M | **Found live 2026-09-21** on dev run `0a472659`. A lead that judges its goal bounded does the work itself and never submits a plan, so its run has no dag — and `ShouldCloseOrchestratorLead` (`pkg/orchestrate/leadclose.go`) read that nil dag as "unknown" and refused to close. With no dag there is also no engine tick to re-check it, so every bounded run left its lead tab behind for good, its row reading `planning` forever. **Fixed `89dd3705`:** nil now means "no children to outlive"; `MaybeCloseOrchestratorLead` gained the `leadProcessAlive` guard it was missing (deleting a tab mid-turn is the run-`5d361309` bug); and a new `CloseOrchestratorLeadOnExit`, called from `HandleRunWorkerExit`, collects the tab on the lead's own exit, which is the only close site a bounded run ever reaches. The same nil-dag misread was fixed in `agenttree.tsx` and `runrailsections.tsx`, which both hardcoded `planning` for a dag-less run |
| ~~The + Run launcher's default route is rejected on a ChatGPT account, and picking a project resets the route back to it~~ **outdated 2026-09-28** | bug | S | **Re-checked against `7d7bf612`:** the launcher no longer defaults to a model: `runRouteAtom` starts `null`, which inherits the project's saved route, else the settings preference, and `gpt-5.3-codex-spark` appears only in a catalog test fixture. `ef11fd84` (2026-09-22) made picking a project keep a route chosen by hand (`resetRunConfigForChannel(pickedOid, true)`, `newruncontrol.tsx:104`; `setRunRoute` marks the draft touched). Not re-checked in the running app. A dead route on the account is F14's row above. **Found live 2026-09-21.** Starting a run on the default `openai-codex/gpt-5.3-codex-spark` fails at the worker with `Codex error: The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account`. The run then looks hung — the lead never reaches its first turn — because the error only ever appears in the lead's terminal. Separately, choosing a project in the modal **resets** the routing selection back to that default, silently undoing an explicit choice. Workaround: pick the project first, then the route. Related to but distinct from F14 (the picker lists routes the account cannot run): here the *default* is one of them |
| A lead's terminal pane can render blank while the backend holds its full output | bug | M | **Found live 2026-09-21, repro not reliable.** An orchestrator lead's pane rendered completely blank while `wavesrv` held 32 KB of scrollback for that block's zone (`filestore.db`, `db_file_data`, `name='term'`), which decoded fine out of band; resizing did not force a repaint. It converted a clear, actionable error (the rejected default route above) into minutes of apparent hang with no signal anywhere. Unknown whether this is xterm not being fed the backlog on attach, a controller-status/reattach ordering problem, or something specific to a block created while the app was mid-restart. Seen once, on a lead launched into a freshly restarted dev app |
| ~~The rule telling a lead to wrap up before `complete` has never been live-checked~~ **outdated 2026-09-28** | limitation | S | **Live-checked since:** run `b01cfdd6` (2026-09-25) completed with `--report` 70 s after its `run finished` wake without asking; run `33880f82` (2026-09-27) asked "Complete the run now?", which fix 41 (`TestOrchestrationRulesCompleteOnTheirOwn`) closed. Record: `docs/superpowers/briefs/2026-09-25-orchestrator-findings.md`, the re-validation tables (findings 17 and 41). **Deferred 2026-09-22** with effort `5d11f853` (its chunk 32, whose last open item this was). `OrchestrationRules` (`pkg/jarvis/leadprompt.go`) tells a lead to fix the run's leftovers, file open issues as chunks and ask the human before running `wsh jarvis complete`. Nothing has confirmed a lead obeys it. It cannot be checked cheaply: `writeLaunchPrompt` hands those rules only to a lead holding a dag, so bounded, quick and human-submitted-plan runs all miss the path by construction — a bounded lead's own launch prompt carries no such rule, and a human-submitted plan has no lead at all. Checking it needs a real architectural goal run that submits a plan with at least one task, executes it and then asks: real API spend and wall time. The 2026-09-21 attempt (run `c29069df`) was interrupted mid-turn and is not worth reviving. **2026-09-25:** the rule changed in `1c0781d1`: the lead now completes on its own with `wsh jarvis complete --report <file>` and asks only when a decision is needed. The live check still stands, against the new rule |
| A 5-task orchestrator run takes over an hour, which is not acceptable | perf | M | **Found live 2026-09-28**, run `6c7652be` (findings 48, 49: three parallel code tasks, one docs task, one fix-round task). 68 min at 10:26 and not yet landed. Timeline, from `db_runevent` and the lead's and workers' transcripts: brainstorm, spec and plan 13 min (2.5 of it waiting on the human); two plan-review rounds with a revision 8 min; workers 21 min, paced by t-3 (17 min of work, 1.4 min review, 75 s Verify); final stage 1 min, failed on a flaky test (`TestABatchOfOneFailsWithoutBisecting` got a wake from an earlier test's final stage; passes 6/6 in isolation on both the merged commit and base `4a4773d`); lead diagnosis and fix plan 5 min; fix round t-5 19+ min for a one-test fix. **Where the waste is:** (1) a one-test flake bought a whole fix round (lead diagnosis, plan, spawn, review, Verify, and a second full final stage); (2) t-5 ran `go test ./pkg/orchestrate/ -count=3` (about 200 s a run), which hit the Claude Code Bash tool's 600 s cap and returned nothing after 601 s, so the worker ran it again: a worker test command can outlive the tool cap and lose its result, and the brief does not tell workers to repeat only the failing tests; (3) a monitoring session ran the same package six times alongside t-5 (10:03 to 10:17), adding CPU contention. The pre-code phase (21 min to the first spawn) is the other large block. Waste points (1) and (2) have a proposed fix in the next row. Not yet decided: a target wall-clock for a run of this size, and which of these to cut first |
| ~~`pkg/orchestrate` tests flake because background engine stages outlive the test that started them~~ **fixed `67328bb4`** | bug | S | **Fixed `67328bb4`:** fix (1) shipped: the final, verify, base-check and final-tree goroutines run through `goStage` (`stages.go`), and every fixture that swaps a hook a stage reaches restores it with `restoreAfterStages`, which waits for running stages and fails the test naming any still running after 10 s. One full run of the package with the waits in place found 0 leaking tests. Fix (2) was done earlier; fix (3), the worker-brief line, belongs to another run. **Found live 2026-09-28**, run `6c7652be`: the final stage failed on `TestABatchOfOneFailsWithoutBisecting` (`verifybisect_test.go:128`, "today's wake"), which had received a wake from an earlier test's final stage. **Root cause, a class rather than one test:** the final stage (`final.go:154`), merge Verify (`verify.go:297`), the base check (`basecheck.go:68`) and final-tree removal (`verifier.go:187`) run in fire-and-forget goroutines. When they finish they call package-level hooks (`sendWakeFn`, `verifyFinished`, `appendRunEvent`), which each test swaps for its own fakes (`newFakeLead`, `wake_test.go:56`; `awaitVerify`, `verify_test.go:21`) and restores in `t.Cleanup`. Nothing waits for the goroutines, so a stage started by test A can land in test B's fakes. It passes in isolation and fails in the final stage because `verify.mjs` splits the package (602 tests) into 4 processes, which changes which tests are neighbours. The run's fix round t-5 ("The conflict test waits for the final stage it starts") fixes one test, not the class. **Proposed fixes, in order:** (1) *remove the leaks:* one package-level `sync.WaitGroup` that every stage goroutine joins with `Add`/`Done`; the shared fixtures wait on it in cleanup before the hooks are restored, with a timeout that fails the test and names the leak rather than hanging (`blockingVerify` deliberately leaves a stage blocked when a test fails early). No goroutine can then outlive its test. The cost is a few ms per test that starts a stage. Measure first: add the wait with its leak report and run the package once to count the leaking tests. (2) **Done 2026-09-28** (`rerunAlone` in `scripts/verify.mjs`; engine-side surfacing followed in `a1bc13c0`: a Verify that passed only on a rerun prints `ARC_VERIFY_FLAKY: <test>`, a merge Verify's joins the passed tip's unverified note and the lead's next wake, and the final stage's becomes an unverified reason) *rerun a failure once before it becomes a fix round:* in `scripts/verify.mjs` (repo policy, not the engine), rerun only the failing tests (`-run '^(TestX\|TestY)$'`, one process). If they pass, exit 0 and print `flaky: TestX` so the flake is recorded in the report, not hidden; if they fail again, fail as today. In this run that is about a second instead of about 25 min of fix round and second final stage. Risk: a real race that passes on rerun gets through, flagged; (1) makes that rare. (3) *worker rule, one line in the worker brief:* reproduce a flake with `-run` on the named test (`-count=N`, or the 6 parallel `-cpu 1` stress), never `-count=N` on the whole package: t-5's `go test ./pkg/orchestrate/ -count=3` hit the 600 s Bash cap and returned nothing. Do (1) and (2) as one change after the run lands, then (3). **Not a leak, a repeat artifact:** t-5 also found `TestSchedulePersistsSpawnedWorkerOwnership` (`engine_test.go`) failing on every repeat with `UNIQUE constraint failed: db_tab.oid`: it inserts a fixed-OID tab into the shared store, so it fails only under `-count>1` (t-5's report). It cannot flake a single run; fix it only if (3) keeps `-count=N` as a way to reproduce |
| ~~Workers run whole-package test suites that per-merge Verify and the final stage already run~~ **fixed `dbf91850`, `0c1e4523`** | perf | S | **Fixed:** fixes (1) and (2) in `dbf91850` (the PlanFormat rule and the widened worker brief), the final verifier half in `0c1e4523`. **Found live 2026-09-28**, run `6c7652be`. **Cause, a rule conflict:** the worker brief (`engine.go:722-731`) says "Run the tests your task names" and "Don't run the plan's full Verify (`<Verify command>`)", which names only the literal command. The lead's plans named whole-package runs as task steps, so workers ran them as "tests your task names". Main plan: "Step 9: Run the package", `go test ./pkg/orchestrate/ -count=1` (and similar at plan lines 234, 354, 758). Fix plan, Step 3: `go test ./pkg/orchestrate/ -count=3` piped into `grep` without `pipefail`, which the brief also forbids. The engine plan reviewer did not flag either. **Cost, from the worker transcripts** (the first two estimated from the gaps between commands): t-2 one full run of `pkg/jarvis` and `pkg/orchestrate`; t-3 two full runs of `pkg/orchestrate` and `pkg/wshserver`, about 5 min each; t-5 about 20 min of its 30 on a one-test fix (`-count=3`, which hit the 600 s cap, then a 25 min and a 30 min run). **Proposed fix (S), two lines of prompt text:** (1) `PlanFormat` / lead rules: a task step names only focused tests (`-run '<names>'`), never a whole package or the suite, because per-merge Verify and the final stage run those; (2) worker brief: widen the Verify rule to "don't run whole packages or the full suite even when the task says to; run the named tests with `-run`", so the brief wins when it conflicts with the plan. Pairs with the flake row above: without whole-package runs, a worker has no reason to reproduce a flake across the package. **The final verifier does the same, and it cost a respawn:** the verifier brief (`verifierPrompt`, `verifier.go:45`) does not say that the deterministic Check and Verify already passed before it started, and does not give its time budget. Round 2's first verifier (started 10:39:36) re-ran `go vet` and the full packages (about 7 min), then `go test ./pkg/orchestrate/ -count=3`, which hit the 600 s cap and went to the background, and it waited on that. `ReviewTimeout` (20 min, `review.go:32`) stopped it at 10:59:52 with no verdict, and a fresh verifier started from scratch. `MaxReviewRespawns` is 1, so a second timeout ends the stage without a verdict. Fix alongside (1) and (2): the brief says Verify passed on this commit and not to re-run suites (named tests only, with `-run`), and states the time budget. **Live-checked 2026-09-29, run `02d0840e`:** all three workers ran only `-run` tests; the one whole-package run was the timing Task 3 required, and its worker asked the lead first. Two workers still piped a test into `grep` without `pipefail` |
| ~~`planreview accept` spawns workers before the lead can carry the findings in with `dag amend` (fix 42's rule cannot be followed)~~ **fixed 2026-09-28** (`dbf91850`: tasks stay pending while the review holds, so the lead rule, the last-round wake and the resubmit refusal now say amend first, then accept; `TestPlanReviewAfterTheLastRoundGoesToTheHuman` amends before accept) | bug | S | **Found live 2026-09-28**, run `6c7652be`: the accept landed at 09:39:59 and t-1..t-3 spawned at 09:40:01, so the lead's `dag amend` failed with "task t-3 is running" and it fell back to `dag tell` (task-lead-told 09:40:29). The accept reason still says the findings were carried in with `dag amend`, which is false. Proposed fix: the rule in `leadprompt.go` has the lead amend while the dag is still in plan review, then accept; check first that `amend` is allowed in plan review, else allow it. Not a problem when no task spawns at accept. **Live-checked 2026-09-29, run `02d0840e`:** tasks stayed pending through the plan review and spawned 2 s after it passed |
| ~~A long `dag tell` is recorded as the human's tell~~ **fixed 2026-09-28** (`dbf91850`: the claude transcript parser, `claudeTypedText`, unwraps the `<pasted_content id="N">` tag, so the told scan, the task-told row and typed-answer matching all see the typed text) | bug | S | **Found live 2026-09-28**, run `6c7652be`: Claude Code wraps a long typed message in `<pasted_content …>`, so `takeLeadTold` (`engine.go:330`), which matches the lead's text against what the worker received, misses it, and the tell is recorded as a human `task-told` (t-3 at 09:40:52, beside the lead's own `task-lead-told` at 09:40:29). The worker also sees it as pasted content. t-3 still applied it. Proposed fix: strip the `<pasted_content>` wrapper before matching **`13625257`:** the pattern took decimal ids only, but most real ids are hex (`63b4`, `be41`), so it now takes any id. |
| ~~Finding 49 has a second route, and the findings doc names only the first~~ **fixed `f35c86ae`** | docs | S | **Fixed `f35c86ae`; the premise was wrong.** The lines were log noise, not a lost outcome: no channel dispatches an engine worker, so there is no channel outcome to post, and both tasks had merged. The "outcome not posted" log line was removed, a `GetChannels` failure is now logged instead of swallowed, `TestAReapedEngineWorkersExitPostsNothingAndLogsNothing` and `TestADispatchedWorkersOutcomeSurvivesTheReap` pin the behavior, and finding 49's row was corrected. **Found live 2026-09-28**, run `6c7652be`: at t-2's merge (09:46:46) and t-3's (09:58:48) the merge's reap deleted the worker's tab, and with it the owner meta, while `notifyChildOutcome` waited about 2 s, so `GetWorkerOwner` failed with no dispatch message to fall back on: "outcome not posted", with no deadline line (t-1 did not hit it). The shipped fix (resolve the dispatch channel before `notifyChildOutcome`, `onexit.go`) covers both routes, but finding 49's row, the spec and t-2's test (`TestOnWorkerExitPostsTheOutcomeWhenTheHookOutlivesTheDeadline`) name only the expired deadline. |
| The UI's websocket drops on a 10 s write timeout during orchestrator runs | perf | M | **Found live 2026-09-28**: `WritePump error … i/o timeout` on the UI tab's websocket (`wsWriteWaitTimeout` 10 s, `pkg/web/ws.go:28`), each reconnecting within about 25 ms: 09:40:13, 09:47:54, 09:48:36, 09:48:47, 09:49:08, 10:20:51, 10:33:52, 10:36:13, 10:44:44, all during run `6c7652be`. At the time the renderer was at about 42% CPU and wavesrv at 118%, with about 2 `wsh` hook connections a second and about 40 `agent:transcriptpath` SetMeta calls a minute, each broadcast even when nothing changed (`SetMetaCommand`, `wshserver.go:61-75`). **Cause not confirmed.** Measure first (broadcast rate against drops), then candidates: stamp the transcript path only when it changes, and skip the write and broadcast when SetMeta changes nothing. Not yet asked: whether the UI feels laggy during a drop. **Not reproduced 2026-09-29:** no `WritePump` timeout in `waveapp.log` after 2026-09-28 12:08, across runs `f9d2a919`, `0dd28414` and `02d0840e` (two of them concurrent); nothing was changed for it, so the cause stays unknown |
| ~~A human cannot end a stuck final stage~~ **fixed `f75d5a2b`, `73541dca`** | bug | S | **Fixed `f75d5a2b`, `73541dca`:** `wsh runs end-final <run-id> unverified\|failed "<reason>"` and the run sheet's End final stage end it with the reason recorded; a failed end takes the verifier-fail path. **Found 2026-09-28**, closing run `6c7652be` by hand: round 2's second verifier had its tools rejected, and the stage waits on a verdict only the verifier's own run can give (`RecordFinalVerdict` checks `VerifierRunID`, `verifier.go:130`). The only way through was `wsh jarvis dag final pass … --runid <verifier's run id>`, run from another session with `WAVETERM_TABID` cleared: the command then marks the caller's own tab complete (`reportRunPhase`, `wshcmd-jarvis.go:123`), which would have ended the caller's session. Proposed fix: a human action (from the run sheet or `wsh runs`) that ends the final stage as passed-unverified or failed, with the reason recorded |
| ~~State-changing `wsh` commands print nothing on success, so an agent cannot tell "recorded" from "did nothing"~~ **fixed 2026-09-28** (`dbf91850`: every command listed below prints one line; the dag ones come from one table, `dagDoneLines`, which also covers `dag merge` without `--continue` and `retry-cleanup`, both silent and missed by the static pass) | bug | S | **Found live 2026-09-28** in run `6c7652be`: its plan reviewer ran `wsh jarvis dag planreview fail …` and wrote "The command printed nothing, which I took as success." A caller that guesses the other way re-sends, and a resend of a verdict or an answer is not harmless (compare the `complete`/`dag answer` EC-TIME resends). The verdict commands also end the caller's session, so it gets no second look. Fix: one stdout line naming what was recorded and what happens next, as `dag merge --continue` already does (`wshcmd-jarvisdag.go:533`). **Silent on success** (found by a static pass over `cmd/wsh/cmd` that follows each `RunE` through package-local calls to a stdout write; a command that prints on some success paths and not others is not caught): `wsh jarvis dag review` (`wshcmd-jarvisdag.go:703`), `planreview` (`:734`), `final` (`:769`), which all end the session; `approve`, `retry`, `skip`, `cancel` (the `dagActionWithin` factory, `:458`); `amend`, `tell`, `sendback` (the `dagNoteCmd` factory, `:801`); `escalate` (`:495`), `answer` (`:629`), `forward` (`:672`); `wsh jarvis complete` (`wshcmd-jarvis.go:50`); `wsh runs answer` (`wshcmd-runs.go:83`); `wsh effort delete` (`wshcmd-effort.go:182`); `wsh view` / `edit` (`wshcmd-view.go:19`, which publishes an open-file event that nothing acknowledges). **Silent by design, leave as is:** `agent-hook` (Claude Code reads its stdout as hook output), `agent-observe-shadow` (hidden pilot, logs to a file), `shell` (execs a shell), and the `dag` and `runs` parent commands (help only). **Live-checked 2026-09-29, run `02d0840e`:** every `complete`, `review pass`, `dag answer` and `effort create` the lead, workers and reviewers ran printed its one line |
| ~~The final verifier re-runs the test suites the engine's final stage has just passed on the same commit~~ **fixed `0c1e4523`** | perf | S | **Fixed `0c1e4523`:** the verifier brief names the Check, Verify and Final commands that passed and on which commit, tells it not to re-run them or any whole package (a single `-run` test only to settle a specific doubt), and states its time budget. **Found 2026-09-28** in the transcripts of both runs that have a verifier session. The final stage runs Check, Verify and the Final command on the merged commit before it spawns the verifier (`final.go:24-26`), but `verifierPrompt` (`verifier.go:45-101`) never says they passed, so the verifier runs them again, serially and unsplit. Run `b01cfdd6`: `go build`, `go vet` and `go test ./pkg/jarvis/ ./pkg/orchestrate/ ./cmd/wsh/cmd` 6.1 min, plus a vitest run 6.3 min, in an 8 min session. Run `6c7652be` round 2: `go vet` plus `go test ./pkg/orchestrate/... ./pkg/jarvis/... ./pkg/wshrpc/...` 6.7 min (03:40:34 to 03:47:15 UTC), then a `-count=3` run of the package; the stage was still `verifying` 19 min in (03:58 UTC). **Fix (S), prompt text:** name the commands that passed and on which commit, and tell the verifier not to re-run Check, Verify or the Final command: read the diff, and run a single named test (`-run`) only to settle a specific doubt about behavior. Saves about 6 to 15 min per run, on the critical path. **Live-checked 2026-09-29, run `02d0840e`:** the verifier ran one `git diff` and no tests, said so in its verdict, and took 119 s |
| Where orchestrator wall-clock goes, measured across the last 8 runs | perf | M | **Re-measured 2026-09-30** over the 13 runs on post-fix builds: (1) to (3) below are fixed (merge and Verify tail after the last task 0.4 to 2.8 min; 3-task runs 19 to 40 min, 10 to 15 task runs 81 to 84). Worker time is 61% model turns and is not compile-bound. What was left: the lead's plan-writing (7 to 14 min, grows with plan size) and spawn order on wide deep runs, both addressed by effort `b1fe5d7e` (critical-path-first spawn; plans without pasted code; no spec when a mockup settles the design), awaiting a live run. **Measured 2026-09-28** over runs `f7dcd827`, `700db496`, `982c0d57`, `28caa81f`, `b2d7fab1`, `18d08579`, `b01cfdd6` and `6c7652be` (2026-09-23 to 28; 4 to 15 tasks, 40 to 212 min), from `db_runevent` and every worker, lead, plan-reviewer and verifier transcript (method: memory note `orchestrator-run-timing-forensics`). **Already fixed, do not re-file:** a worker's `wsh jarvis complete` lost to EC-TIME left `28caa81f` t-4 idle 25 min until the lead noticed (`b631b2f8`, 2026-09-24; no EC-TIME in any later run); stuck workers were caught late, `982c0d57` t-7 idle 86 min before its auto-retry and `700db496` t-5 47 min (the 2026-09-24 liveness rework: `TurnEndedGrace`, `IdleCPUShare`, `task-suspect`); merges queued one Verify at a time, `18d08579` waits up to 17 min and `b01cfdd6` 10.5 min (batch Verify, `1d5082c7`, 2026-09-27; about 0 in `6c7652be`); the lead's wrap-up after `dag-done` took 11 to 27 min (`1c0781d1`; 1.2 min in `b01cfdd6`). **Still open, largest first:** (1) whole-package test runs inside workers, 132 min over the 8 runs, the largest single category of worker time: about 38% of it in the Go-heavy runs (99 of 262 min in `18d08579`, 24 of 64 in `6c7652be`) and on the critical path (`6c7652be` t-3 spent 7.1 of its 18.5 min on them); fix in the "Workers run whole-package test suites" row above; (2) a one-test flake bought a full fix round, about 37 min in `6c7652be`; fix in the `pkg/orchestrate` flake row above; (3) the final verifier re-running the suites, 6 to 15+ min; row above; (4) plan review, 8 min in `6c7652be` (two reviewer sessions of about 2.8 min, a revision and two human gates) and 3 min in `b01cfdd6`: it caught real defects both rounds, leave it; (5) the lead's pre-submit phase (brainstorm, spec, plan), 12 to 23 min per run: in `6c7652be` 13 min, of which about 3 were human gates and the rest reading code and writing; no cheap cut; (6) plan shape: `18d08579` ran 212 min mostly because of a five-deep serial chain of 15 to 30 min tasks (t-7, t-9, t-10, t-11/12/13, t-15), which only a flatter plan fixes. Worker time outside tools (model turns) is about 45% overall and is not a target. (1) to (3) together would have cut an estimated 50 to 60 min of `6c7652be`'s 80+ |
| Markdown comments in the File tab (Preview, cards, the three gestures, the tray) were never run live: the run's Final stage ran on macOS, where WKWebView answers no CDP, so none of the 17 steps of the `md-comments` scenario ran. Run `node scripts/cdp/final-verify.mjs md-comments` on Windows and compare the shots with the mockup boards (`.superpowers/design/md-comments/project/`, gitignored: keep it until then). Step 12 also checks that the Cockpit card of a roster agent with no `blockId` still shows its inline `docs/guide.md` link | verification gap | M | `docs/superpowers/specs/2026-10-06-md-comments-design.md`; run 74f0fa77 |
| Ctrl+Enter does not send the markdown comments from the File tab's Source view while Monaco has focus on macOS: `filetab.tsx`'s handler skips any `HTMLTextAreaElement` target so a comment box keeps its own Ctrl+Enter, and in WKWebView Monaco takes its input in a textarea (WebView2 is unaffected) | bug | S | Final verifier of run 74f0fa77; skip only a target inside `[data-md-box]` (`frontend/app/view/agents/filetab.tsx:86`) |
| Running `scripts/cdp/final-verify.test.mjs` inside a worktree removes that worktree's `src-tauri/target` and `dist/bin` links: its tests spawn `final-verify.mjs` with the repo as cwd, and the script calls `unlinkBuildJunctions(process.cwd())` (`scripts/cdp/final-verify.mjs:292`). What the links point at is left alone, but the worktree's next build starts cold | bug | S | run 74f0fa77 (t-7); give the spawned script a temp cwd, or have an env var name the tree to unlink |

**F22–F26 come from one live orchestrator DAG run (2026-09-05)** — see the closing note under
*Shipped 2026-09-04* for what that run verified. They are ask-protocol and liveness defects, not
engine defects: the DAG itself completed 4/4 correctly while the lead was hung the entire time.

**F11–F17 were never mirrored here (noted 2026-09-04).** They were filed in
`docs/orchestrator-redesign-flaws.md` Capture 2 and stayed there, so this list — which calls itself
the single "what's left" list — showed orchestration as closed while seven flaws were open. The six
rows above are that omission corrected, each re-verified against the code rather than copied. Four of
them (F12, F13, F15, F16) were fixed the same day and are struck through above rather than deleted,
so the mirror stays legible against the flaws tracker. **F17**
(`runtime` silently forking between two orchestrators) is deliberately *not* among them: the fork is
now an explicit `orchestration` parameter documented at `run.go:377`, so only the runtime-based
*default* remains and the "silent" complaint is answered — it is a close-out review, not a fix.

### Shipped 2026-09-04 — do not re-file

Ten rows left this table in one batch. Recorded here with pointers because several were filed twice
before (a fixed bug with a vivid repro note reads like an open one). Each fix is unit-tested; the
"live" column says whether it was also confirmed in the running app over CDP.

| Was | Fix | Live |
|---|---|---|
| Flat DAG never opened the merge gate — `dag wait` returned `terminal:healthy` with children unmerged | `d966c27e`: `buildNext` reports `merge-ready` whenever `mergeReadyIDs` is non-empty, ranked below dispatch and parallelism-wait so a DAG that can still spawn is never reported as needing the lead | **yes** — 2026-09-05 run opened `merge-ready(resolve-merge)` with children unmerged, and ranked `parallelism-wait` above it while the DAG could still spawn |
| `buildNext` fell through to a bare `terminal` on a running DAG with cleanup pending (F19) | `d966c27e`: the fall-through is now a typed `cleanup-wait` step, never terminal — the lead's stop signal is the only terminal kind. Named in the FE by `75738bfb`; the `waitDecision` half is moot (deleted with `dag wait` in `2ce4161b4`), and the cockpit's `nextStepText` reports an empty terminal status as a contract error (2026-09-27) | **yes** — `parallelism-wait`, `merge-ready`, `dispatch` and `terminal:done` all observed as typed kinds across the 2026-09-05 run |
| Engine prompt said act "when the digest reports `merge`"; the digest says `merge-ready` / `resolve-merge` (F20) | `d966c27e`: prompt uses the digest's own words (`pkg/jarvis/run.go`); the shared-constant half closed as obsolete 2026-09-27, since the current lead prompt never uses the digest's words | no |
| `dagDigestChildRunLimit = 8` not raised with `MaxDagTasks = 16` (F21) | `d966c27e`: the constant now follows `jarvis.MaxDagTasks` | no |
| Every non-pi DAG child flagged **stalled** at 15 min regardless of progress; `retry` then killed healthy work (F18) | `3ca9cd6d`: liveness reads pi, claude and codex transcript roots via `agentsessions.SessionRoot`. A runtime with **no** readable activity source now reports freshness *unknown* rather than aging into a false stall — a missed stall costs a timeout, a false one kills a working child. `opencode` is deliberately untracked (cwd lives only in a sidecar file; rewrite behaviour unverified) | no |
| A `claude` worker in a never-opened directory blocked forever on the folder-trust dialog | `50cdc2d8`: `ensureClaudeDirTrusted` pre-registers the directory under Claude's own canonical-git-root key and lock protocol before spawn. Writes at most one entry per project, never per worktree | no — needs an untrusted dir |
| Engine `dag merge` not idempotent on a Windows worktree-lock failure | `851511a5`: worktree removal is the caller's step, so a cleanup failure cannot obscure a landed merge; an already-merged branch returns HEAD instead of re-merging | no |
| Pure rename rendered as the whole file added while the list beside it said `+0 −0` | `cd9cb5c8`: `pathDiff` asks the rename-source question **only** when a path-scoped read reports `new file mode`, then re-reads with both paths | **yes** — `R100` fixture renders *Renamed.* with `+0 −0` |
| Compare-mode summary printed the working tree's counts under the compare's ref names, refs reversed vs. the chip | `cd9cb5c8`: `summaryLine` picks the store the panes are showing; picker and chip print `base … head` | **yes** — `main … feat · 3 files · +30 −0` against a dirty tree |
| Hints footer never recomputed on compare/filter changes, advertising keys that did something else | `7807aa93` + `2ed1cc85`: `whenVersionAtom` counter over the 10 atoms the predicates read, plus a `store.test.ts` guard that fails when a predicate reads an unregistered atom | **yes** — 11 chips → 3 on toggle, no focus change |

**That gap was closed 2026-09-05 by a real orchestrator DAG run** (claude lead, `orchestration:
engine`, 4 tasks, parallelism 2, merge required, against the `reloadChanges` row in this table). The
run completed 4/4 done-and-merged to `terminal:done`, and the merged result verified independently of
the agents' own reports: 60 tests passing, `tsc --noEmit` exit 0.

What it settled:

- **Verified** — the merge gate opens on a flat DAG; `buildNext` reports typed kinds throughout; the
  30-minute stale-merge-gate escalation (F16) fires exactly on time.
- **Falsified** — F13's first-token deadline, which false-stalls working children; the F13 row above
  now carries the measurements.
- **Not exercised** — F12 (needs a live lead to attempt a second submit) and F13's exit-hook half (no
  child died before its first token).
- **Confirmed architecturally** — execution is genuinely engine-owned. The lead process hung before
  the first task spawned and never participated again; `ScheduleOnce` and the watchdog drove every
  dispatch, merge and advance from persisted state. `spawnBase` was re-read from project HEAD per
  spawn, so t-4 correctly based on the t-3 merge.
- **New defects** — F22–F26 above, all in the ask protocol and liveness reporting rather than the
  engine.

The DAG's own output was reviewed and fast-forwarded onto `main` on 2026-09-05 (`aa9ba8e8`), closing
the `reloadChanges` half of the Diff-surface orphans row above.

---

## 3 · Blocked

### Remote/WSL worker host operations

Git surfaces and composer attachments break for SSH/WSL workers because they run on the local host.
Not routable today: agent launch has no connection parameter, `Run`/worktree/`AgentVM` carry no
connection field, and the remote impl doesn't register `GitChangesCommand`/`GitDiffCommand`/
`WriteTempFileCommand`. Prerequisite chain: (1) remote agent launch threading connection through
launch → run → worktree → `AgentVM`; (2) register host-bound commands on `wshremote` (or expose
`wshserver` handlers over the connection route); (3) then route keyed off the agent's connection,
local default. Effort realistically L counting step 1. Full reference design in git history
(pre-consolidation issue 5).

---

## 4 · Held — pick up only on the named trigger

(arcterm) Session scan cache on disk (deferred 2026-10-06): keep the sessions scan's parsed transcripts across
wavesrv restarts, so the first History load after a launch skips its 0.5 s cold parse (2.9 s before the subagents skip
and parallel parse). Revive when a cold `ScanSessions` measures over about 1 s; full rationale in `docs/deferred.md`.

(arcterm) In-app auto-update, Chrome style (deferred 2026-10-06): check for a release, "Restart to update", install
over and reopen, via `tauri-plugin-updater` and the NSIS installer's `/P /UPDATE /R`. Revive when releases are
published somewhere the app can fetch without signing in; full rationale in `docs/deferred.md`.

Code and Diff in the nav rail: re-measure ~2026-10-20 (deferred 2026-10-06): the rail now groups them with Radar
as tools under Cockpit, Jarvis, Agent and Usage. Drop them from the rail if they are reached almost only through the
Agent panel's "Open in…" buttons, the palette and `g b` / `g f`; full rationale in `docs/deferred.md`.

Terminal file drop → pasted path (deferred 2026-09-30): the webview gives a dropped file no path, and Tauri's
native drag-drop needs `dragDropEnabled`, which disables HTML5 drag app-wide. Revive when file drops onto a
terminal are wanted; full rationale in `docs/deferred.md`.

Work on an initiative — "Save place and close" (held 2026-09-29): the close dialog asking a session linked to an
initiative to write a left-off note before it closes. Revive when losing a session's place recurs; full
rationale in `docs/deferred.md`.

Channel data-model scaling — Phase 3 (Contract) (parked 2026-08-25): revive when a real channel blob is
material (>5 MB or a measured per-event write/broadcast cost) — prod reality check: 4 channels, 680 KB
total. Full rationale + measurement in `docs/deferred.md`; Phases 0–2 shipped.

Orchestrator findings fixes, left out of scope (2026-09-25, spec
`docs/superpowers/specs/2026-09-25-orchestrator-findings-fixes-design.md` §5):

- **Automated board rendering:** the final verifier compares `**Final:**` screenshots to a `**Prototype:**`
  canvas by reading both, and nothing renders the canvas's boards or pairs each board with a `verify:ui`
  scenario. Revive when verifier verdicts miss a layout defect that a rendered board would have caught.
- **A cheap-model route for judging sessions:** the plan reviewer, task reviewers and the final verifier all run
  on the lead's route. Revive when the per-role token totals (`wsh jarvis dag status` `usage`, `wsh runs show`)
  show the judging roles are a material share of a run's tokens.
- **An idle-lead watchdog after the dag is done:** nothing wakes a lead that stops after `run finished` without
  completing. The wrap-up rule (complete on your own) and the `run-unverified` attention item are meant to
  cover it. Revive on a run whose lead sat idle at `run finished` without completing.

Reliability investigations (`git show a4b5bd4f:docs/superpowers/briefs/2026-08-25-reliability-improvement-scan.md`):

- **Consult cancellation cleanup (R5): resolved 2026-08-25** — reproduced on Windows (a descendant
  retaining stderr kept `cmd.Wait()` blocked 11s past ctx-kill; +2 goroutines leaked per cancelled
  consult until the descendant exited). Fixed by routing stderr to an owned capped temp file so
  `os/exec` spawns no copy goroutine; regression test `pkg/consult/reap_test.go`.
- **DAG liveness batching (M1):** measured 2026-08-25 — 42.7ms per running task per 30s watchdog tick
  on the real corpus (191 session files); scales linearly (201ms @ 3,060 files; 1.6s @ 30,600). Not
  material today (~0.14% tick duty per task). Build the per-schedule snapshot only when the corpus
  nears ~3,000 files (≈10× today; pi sessions accumulate unboundedly).

Jarvis second-brain smalls (J7 of the deleted second-brain tracker; rationale per entry in
`docs/deferred.md`):

- **U2 Tasks:** in-Wave `## Notes` editing (needs human-region write path + `SetDossierNotesCommand`);
  decision supersede UI (backend `SupersedeDecision` exists, no affordance); manual dossier creation;
  live push.
- **U3 Graph:** search/filter over the graph; read rail; cross-surface nav out of a node; whole-vault
  attribution (bloom is per-focused-task).
- **S2 Recall:** recency-aware semantic seed merge; loosening L4 gating to per-run silence.
- **S1 Embeddings:** warm-at-commit wiring (lazy from `Query` today); settings UI for embed config/key.
- **C Recall:** model-in-the-loop (agentic) traversal — lands with cheap-tier consumers; cache-tier
  learning store — only on repeat-question evidence.
- **E Continuity:** app idle/quit flush (A's quit commit covers it); completed-task prose re-freshness;
  per-task resume card beyond the pet's newest-narrative peek (v2 ambient).

J5 tuning constants (the measurements behind each are §J5 of
`git show a4b5bd4f:docs/jarvis-second-brain-open-issues.md`):

- `timeBoxMs` 30d — first layer-3 decay observable ~2026-08-19 onward; then re-probe.
- `weightLayer3` 0.3 — needs a human ground-truth labeling pass over 18 existing structural edges.
- `weightLayer2` 0.8 — needs dispatch goals carrying ticket ids (workflow change, not data collection).
- U3 graph visuals (opacity/width/dash/RUN_SQUARE_SCALE) — dense-vault legibility check; medium branch
  reachable since 2026-08-03 but unexercised.
- Traversal/proactive caps and E/S1 caps — only on a measured latency/relevance/truncation complaint.

Other held items (each names its own revive condition in `docs/deferred.md`):

- **S3 proactive extras:** rest-boundary/conversation-turn triggers; global proactive feed; ranked
  lists; "Ask Jarvis about this" card action.
- **Pet:** courier gestures (carry/drop-target — build store + gestures together); higher acting tiers
  on the creature.
- **Jarvis Briefing:** generic cross-project progress needs a Wave-owned workstream/milestone contract
  (identity, lifecycle, update authority, staleness) — its own product/data-model session.
- **Pi Part B:** `wave_create_widget` pi tool + `wsh widget` vdom CLI — when a concrete consumer appears.
- **Incremental stateful transcript projection** — only if the capped bounded re-project profiles hot
  (CDP/React-DevTools pass against a populated cockpit first).
- **Attribution engine D (v2)** real ambient edges to replace `fixtureAmbientProvider` behind the
  unchanged `AmbientProvider` interface.
- **Cross-surface navigation:** Back history and its context strip (revive when a real flow shows the
  need); reverse links; palette Open versus Execute. Parked as `09e86573` on `feat/surface-integration`
  (2026-09-17).
- **Cockpit focus, slice 2 and beyond:** the Focus control was removed on 2026-10-06; `SURFACE_CONTEXT`
  now names the project posture alone, which every surface honors. Jarvis's unwired `project: "subject"`
  is a recorded deferral with a revive trigger, not a placeholder; so is Usage's `unsupported` cell. Full
  list in `docs/deferred.md` (2026-09-22), design in
  `docs/superpowers/specs/2026-09-22-cockpit-focus-and-peek-design.md`.
- **Resource linking beyond navigation:** Related Work, the Work Trail strip, structured refs, file/diff/commit/
  session targets, a shared action builder, usage-to-work links, one oref namespace — revive each on the trigger
  the spec names. Rationale in `docs/deferred.md` (2026-09-17); the navigation core shipped.

---

## 5 · Declined / permanent limitations (do not resurface)

- Cockpit light/Paper theme — declined; code removed 2026-08-24 (`docs/deferred.md`).
- Gatekeeper v1.1 (make-a-rule + countdown) — revive only on recurring-ask or misfire evidence.
- arcterm Environment capability — restore via `git show 4e80bf4f:docs/environment-roadmap.md` if needed.
- Agents-tab fit-one-screen density engine — obsolete, un-executable against the card grid.
- Diff-surface narrow-window folding + row-density variants — revive only on a narrow-window user.
- Rate-limit token *cap* and plan-tier badge — no honest Anthropic-side source.
- Codex/OpenAI 5h-window bars — Codex has no such window.
- Codex subagents + depth>1 subagent nesting — no per-subagent files exist; closed no-go.
- Usage pricing family-substring drift (historical Opus billed at current tier) — accepted estimate error.
- v3 embedding boundary: multimodal/image embeddings, reranking models, bundled local model,
  cross-machine sync.
- Codex and opencode as run workers (leads/task workers) — declined 2026-09-17: this install only
  uses claude and pi, so there is no consumer to revive it for. Consults still run on both. Recovery
  path if that changes: `docs/deferred.md` 2026-09-14 entry, `git show adfcbebc:...` for the deleted
  adapter arms, route rows and liveness entry.

---

## Held redesigns needing live verify or a decision (scan brief 2026-07-21)

E8 connserver readiness handshake (patch saved, needs live SSH/WSL verify — also gated on the remote
launch prerequisite above); E15 favicon blockstore; E16 pty input loop; E2 `ink-*` token swap (not 1:1);
E4 list-reflow motion (was in progress). Source:
`git show a4b5bd4f:docs/superpowers/briefs/2026-07-21-open-ended-improvement-scan-brief.md` — treat that brief's tables as
a historical snapshot; its Status section records what already shipped.

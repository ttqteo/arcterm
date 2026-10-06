# Deferred work

Running log of intentionally-deferred features. Each entry records what was deferred, why,
where it would plug in, and how to pick it back up. Append new entries at the top.

> The consolidated "what's left" view lives in `docs/open-issues.md` (2026-08-24). This file stays the
> append-only rationale log — append the full deferral here, then mirror a one-line row there. Entries
> marked RESOLVED/DECLINED below are kept for the reasoning, not as pending work.

## Sessions "All activity" feed rows peeking a run, agent or initiative (deferred 2026-10-01)

- **Deferred:** the peek gesture on the Sessions "All activity" feed, where `Main.dc.html` in the cockpit-peek mockup
  shows each row peeking a run, agent or initiative.
- **Why:** those rows link sessions today, not runs, and giving them targets was scoped out of the cockpit-peek run.
  The gesture is demonstrated on the Brief's run rows instead (CDP scenario `peek-ctrl-click`). No feed-row-to-target
  mapping was built.
- **Revive when** the feed rows carry a target (a run oref, an agent tab id or an effort id). Wire each row through
  `openOrPeek` in `frontend/app/view/jarvis/openref.ts`, the way the Brief's `openLine` does, and mark it `data-peek`.
  Nothing was built for this, so there is nothing to recover from git.

## Terminal file drop pastes the file's path (deferred 2026-09-30)

- **Deferred:** dropping a file onto a terminal to paste its quoted path. The Electron build read the path with
  `webUtils.getPathForFile`; the Tauri port stubbed that to return `""`, so the drop handler never pasted anything.
  The stub and the handler are gone; `termwrap.ts` now only swallows the drop so the webview doesn't navigate to the file.
- **Why:** a webview `File` carries no path. Tauri's native drag-drop event does, but it needs `dragDropEnabled: true`
  on the window (`src-tauri/tauri.conf.json`), which takes HTML5 drag-and-drop away from every surface.
- **Revive when** file drops onto a terminal are wanted: listen to `getCurrentWebview().onDragDropEvent` and hit-test the
  drop position against the terminal, which needs that flag flipped and every HTML5 drag target re-checked. The old
  handler: `git show a4b5bd4f:frontend/app/view/term/termwrap.ts` (`dropHandler`).

## Final stage: a verifier's verdict held during Checking is not persisted (declined 2026-09-30)

- **Declined:** persisting the verdict of a final verifier that finishes before the stage's Check and Final
  commands. It lives in `finalRuns.verdicts` (`pkg/orchestrate/final.go`), so a wavesrv restart in that window
  loses it, and the next tick restarts the commands and replaces the verifier.
- **Why:** the commands restart anyway and take longer (the Final command is bounded at 30 min, and every final
  verifier since `0c1e4523` gave its verdict in 0.7 to 2.6 min), so the respawned verifier costs one session's
  tokens and no wall-clock. Persisting needs a `FinalStage` field and restart handling for a window no run has been
  seen to hit.
- **Revive when** a run's history shows a final verifier replaced after a restart, or restarts during Checking
  become routine (auto-update mid-run, for example).

## Run recovery after a restart — dag runs (deferred 2026-09-30)

The restart recovery in `git show a4b5bd4f:docs/superpowers/plans/2026-09-30-run-restart-recovery.md` covers non-dag runs only: quick, pipeline, and an
orchestrator lead before `dag submit`.

- **Deferred:** marking a dag run's children and a submitted lead interrupted at boot, and resuming them.
- **Why:** the watchdog already schedules every dag at boot, and it is unverified that a dead child goes
  unnoticed. claude children are exempt from the first-token deadline (`firstTokenRuntimes`,
  `pkg/orchestrate/liveness.go`), so one might, but nobody has seen it happen.
- **Revive when** a live repro shows a dead child or lead that the engine never notices after an app
  restart: start a plan run, kill the dev app mid-task, restart it, and watch whether the task is retried or
  stays running. The boot pass is `orchestrate.MarkInterruptedRuns` (`pkg/orchestrate/interrupted.go`),
  which skips any run with a `DagORef`.

## Run recovery after a restart — New Agent sessions (deferred 2026-09-30)

- **Deferred:** stopping a New Agent session (a block with no `agent:runid`) from replaying its launch prompt
  when its tab remounts after a restart. `shouldRelaunchWorker`
  (`frontend/app/view/agents/session-models/agentresumestore.ts`) still relaunches every such block.
- **Why:** a transcript scan on 2026-09-30 (798 claude and 353 pi sessions) found no session that re-ran its
  launch prompt after a restart: resume-on-reopen bakes `--resume`/`--session` into the block's `cmd:args`
  once the session reports its transcript.
- **Revive when** a session is seen re-running its prompt after a restart. The gate to change is
  `shouldRelaunchWorker`; nothing was built for this, so there is nothing to recover from git.

## Work on an initiative — "Save place and close" (deferred 2026-09-29)

Work on (the Brief's initiative row, `w`, and the palette's ctrl+enter) starts an agent with "where are
we" and points it at the initiative's newest note, and sends you to the agent already open on it instead
of starting a second one. What it does **not** do is capture where a session was when it closes.

- **Deferred:** the close dialog (header ✕, tree "Close agent", double ctrl+c — all `confirmCloseSession`)
  offering **Save place and close** for a session linked to an initiative. Arc would type a "record where
  we are as one left-off note" prompt into the agent, wait for a note from that session with a new
  `--left-off` flag on `wsh effort note`, then close the tab; ctrl+c in the dialog closes without saving.
- **Why:** agents already write where they are. Since note authorship shipped (2026-09-23), 23 sessions
  wrote 185 notes to initiatives, including explicit "END-OF-DAY STATE (resume here)" notes, so the newest
  note is usually the resume point. Losing mid-conversation state ("I was at question 10+") showed up once
  in 30 days of transcripts. Saving costs a turn on every close, and a full cache write when the session
  has sat idle past the cache TTL — the cost that ruled out resuming the last session instead.
- **Revive when** losing a session's place recurs. It plugs in on top of what shipped: the link is the
  tab's `session:effort`, and `confirmCloseSession` (`frontend/app/view/agents/agentactions.ts`) is the one
  place to add the option. The design was a local `.dc.html` canvas and was never committed, so there is
  nothing to recover from git; the steps above are the whole design.

## Cockpit focus — deferred until evidence (2026-09-22)

From `docs/superpowers/specs/2026-09-22-cockpit-focus-and-peek-design.md`. Slice 1 landed the posture
enforcement, the widened `(Kind, Id)` resolver, the seed/aligned/diverged decision and the divergence
banner. These were scoped out of it deliberately:

- **Relationship annotation.** Surfaces marking up each other's content in place — an editing-agent and
  open-finding marker in Code, a finding badge on a Files hunk, "cited by N runs" under a memory note, a
  session row naming the run it produced. All the source data exists (`finding.files`, roster cwd and
  changed files, `Run.RadarOrigin`/`EffortRef`/`DagORef`, `jarvisattrib` edges) and nothing derives
  markers from it. Cheapest of the three ideas and the most likely to degrade into noise, so it wants
  the surfaces to agree first and a mockup per `DESIGN.md`. **Revive after slice 1.**
- **Companion split** — pinning a second surface beside the current one. Needs a second mount slot,
  since only the Agent surface stays mounted. **Revive if peek proves insufficient** for sustained
  side-by-side work.
- **Time correlation** — every surface answering "what did this look like at T". **Revive on a real
  post-mortem** that peek and focus cannot serve.
- **Drag courier** — dragging a finding or file onto an agent in the roster. Shares machinery with the
  pet's deferred courier gestures; **build the store and the gestures together or not at all.**
- **Jarvis focus support.** `SURFACE_CONTEXT.jarvis.space` stays `unsupported` until there is a decision
  on what a focus should hide among the inline tracker's rows (see the Jarvis rows above).
- **Jarvis *project* subject wiring.** Declared `project: "subject"`, and left unwired in slice 1 — not
  an oversight. The plan named `briefScopeAtom` as "the Brief's own scope", but that atom is a *recall
  query* scope (`JarvisScope { mode, chips, attached }`, `jarviscontract.ts:66`), not a project name.
  The Brief is a whole-workspace digest with no local project target, so `subjectDecision(null, filter)`
  is always `seed` and a `DivergenceBanner` there could never render. **Revive when the Brief gains a
  real per-project target** (e.g. a project-scoped digest), and wire it the way Code and Vault are.
- **Usage focus and project support.** Held at `unsupported` because `UsageBucket` carries no attribution
  dimension at all; blocked on the usage scanner gaining per-session or per-run attribution, not on a
  design decision. **Revive together with that.**

## Composer attachments (2026-09-18)

Composer attachments (paste / attach / drag-drop onto a run goal or steer, `875967bf`) were mounted only
by the deleted `channelcomposers.tsx` and went with it in `5eac07ed`. Image paste into an agent's own
terminal still works. Revive when attaching a file to a goal or steer is wanted; recover with
`git show 5eac07ed^:frontend/app/view/agents/composerattachments.ts` and
`git show 5eac07ed^:frontend/app/view/agents/attachmenttray.tsx`. This also retires the attachment half of
the 2026-07-16 "Channel composer attachments" entry and of the Remote/WSL blocked row.

## Thread archive/delete (2026-09-17)

Thread lifecycle (`archiveJarvisConversation`, `deleteJarvisConversation`) was one of the Jarvis Brief B5
capabilities the retired Stage's column left orphaned (see the 2026-09-10 entry). The backlog cleanup pass
deleted it outright rather than re-home it, since nothing in the cockpit still mounts a thread menu.

- **What was deleted (`4c36093e`):** `DeleteJarvisConversationCommand`/`ArchiveJarvisConversationCommand`
  and their data types (`pkg/wshrpc/wshrpctypes_jarvis.go`), the two handlers
  (`pkg/wshrpc/wshserver/wshserver_jarvis.go`), their tests, and `wstore.DeleteJarvisConversation`
  (`pkg/wstore/wstore_jarvisconversation.go`; test callers switched to `DBDelete`).
- **What is available now:** a Jarvis thread can still be created (the `n` chord, `brief-restore`
  hydration) and read, but never archived or removed — threads accumulate with no cap and no cleanup path.
- **Why:** the capability had no mount left to re-home into, and no user-visible pressure was observed to
  justify rebuilding one speculatively.
- **To resume:** when thread clutter in the palette's Brief index becomes a real problem. Recover with
  `git show 4c36093e^:frontend/app/view/jarvis/jarvisstore.ts` and
  `git show 4c36093e^:pkg/wshrpc/wshserver/wshserver_jarvis.go`.

## Lead-authored task routing — Phase 4 measurement gate (2026-09-17)

Phases 1–3 of `docs/superpowers/briefs/2026-08-19-lead-authored-task-routing-roadmap.md` are now shipped: the DAG-graph route display
(`551f76ee`) and run-evidence recording of the effective `(harness, model)` per task (`96fa3254` —
`RunEvidence` gains `Harness`/`Model`, sealed from the run's actual route and its last worker transcript's
reported model). Phase 4, the cost/outcome measurement gate, stays held.

- **What is deferred:** instrumenting cost and outcome per task keyed by `(lead stamp, harness, model)`,
  and revisiting a difficulty classifier or deterministic sniff on that evidence.
- **Why:** the roadmap built Phase 4 evidence-gated on purpose — a classifier's calibration is worst exactly
  where it matters (easy-rated-but-hard tasks), and misrouting hard-as-easy is strictly worse than not
  routing at all (YAGNI unless evidence shows cheap-first waste actually biting). No such evidence exists
  yet.
- **Where it plugs in:** `docs/superpowers/briefs/2026-08-19-lead-authored-task-routing-roadmap.md` §"Phase 4 — Measurement gate" states
  the fix shape (cost/outcome per `(stampTier, runTier, cached%)` via `usagestats`) and stays valid; Phase 4
  may be skipped entirely.
- **To resume:** on evidence that cheap-first routing waste is common (a hard task run cheap, cost or outcome
  showing it).

## Resource linking beyond navigation: relationships, trail, structured refs, wider targets (2026-09-17)

The resource-linking slice shipped canonical addresses, one parser and one `openTarget`
(`docs/superpowers/specs/2026-09-15-cross-surface-resource-linking-design.md`). The spec was cut to that core at
review; everything else it designed waits for evidence, with each settled decision kept in the spec's
"Deferred until evidence" section so it is not re-derived.

- **What was deferred:**
  - Related Work: forward links and backlinks derived from authoritative Run/DAG/Radar/effort data and
    attribution edges, no persisted link table, inferred edges showing `jarvisattrib`'s own provenance. Needs a
    mockup per `DESIGN.md`.
  - The Work Trail strip: explicit lineage only (finding → Run → task → worker → files), stopping at a branch.
  - Structured resource refs on the wire (file revisions, nested parents) — nothing persists a file revision yet.
  - File, diff, commit and session targets in `openTarget`; `openInCode` and `openDiff` stay the landings.
  - A shared contextual-action builder across buttons, menus and the palette.
  - Usage-to-work links, which need per-session or per-run attribution in the usage scanner first.
  - Unifying the attachment oref namespace (`resolveAttached`'s `run:`/`memory:`/`radar:`) with addresses.
  - Cross-surface Back is the entry below.
- **Why:** no flow has yet shown the need; each item names its trigger in the spec.
- **Where to pick it up:** the spec's "Deferred until evidence" section; the router is
  `frontend/app/view/jarvis/openref.ts` and the parser `frontend/app/view/jarvis/address.ts`. A new target kind
  is a union member in `address.ts`, a landing in `openref.ts`, and a row in `openref.test.ts`.

## Cross-surface Back history, its context strip, and a Space filter on the Brief (2026-09-17)

The first cross-surface plan (`effort:2450d93e`) built typed surface navigation and a Space filter in
`.worktrees/surface-integration`, uncommitted. The approved resource-linking spec
(`docs/superpowers/specs/2026-09-15-cross-surface-resource-linking-design.md`) cut the effort to addressing
and landing. That work is parked as `09e86573` on branch `feat/surface-integration`; keep the branch while
this entry is open. Only the Sessions half of its project and Space scope moved to `main`.

- **What was deferred:**
  - Cross-surface Back: `navigateSurface` with direct and contextual kinds, a history bounded at 20,
    `navigateBack`, and the rail and keybinding routing onto them. Built and unit-tested, never merged.
  - The context strip ("Back to Radar"): a mockup only, never approved.
  - Deterministic reverse links and palette Open versus Execute, the plan's Tasks 5 and 6: not started. The
    palette's current handling of an ended session was not re-checked.
  - A Space filter on the Brief (`filterJarvisBySpace`) over channels, runs and workers, keeping attention
    global. It filtered the Brief's active-work region, which ea4cd452 replaced with the inline tracker, so
    it no longer applies. `SURFACE_CONTEXT` marks Jarvis's Space support `unsupported` until it returns.
- **Why:** the spec defers Back until a real flow shows the need. Its `openTarget` replaces the result type
  that work gave `openORef`. What a Space should hide among the inline tracker's rows is undecided.
- **Where to pick it up:**
  - Navigation: `git show 09e86573:frontend/app/cockpit/surfacenavigation.ts` and its `.test.ts`; the
    callers' wiring is `git diff eb5a3654 09e86573 -- frontend`.
  - Design and plan: `git show 09e86573:docs/superpowers/specs/2026-09-15-cross-surface-navigation-design.md`
    and `git show 09e86573:docs/superpowers/plans/2026-09-15-cross-surface-navigation-plan.md`.
  - Strip mockup: `git show 09e86573:docs/prototype/cross-surface-context-strip.html`.
  - Brief filter: `git show 09e86573:frontend/app/view/agents/spacescope.ts` (`filterJarvisBySpace`) and
    `git diff eb5a3654 09e86573 -- frontend/app/view/jarvis/briefsurface.tsx`.
  - Back needs its own chord: Code's Back/Forward owns `Alt+ArrowLeft/Right`.

## Lanes: a skipped task's commits land with its lane, and a retry's evidence starts at the branch head (2026-09-15) — ✅ RESOLVED 2026-09-29

**Resolved by `720ba0e1`** (run f9d2a919, merged in 443c5f66): a task's first dispatch stamps `StartBase`; skip writes
a recovery patch and resets the lane to it without cleaning the tree, and a retry's run starts from it, so its evidence
covers the failed attempt's commits. Tests: `pkg/orchestrate/laneskip_test.go`. The third bullet (a lane's first task
retried after a Setup failure keeps its original base) was not part of that change.

Slice 4d of the orchestrator redesign (`git show edf0132b:docs/superpowers/plans/2026-09-15-orchestrator-redesign-s4d-lanes.md`)
runs a chain of tasks as one lane: one worktree and branch, and one squash merge once the last task is done.

- **What was deferred:**
  - Skipping a task never rewinds its lane's branch. Anything a failed attempt committed before the task was
    skipped lands with the lane's squash merge.
  - A retried task continues from the lane branch, including any commits its failed attempt made. Its child
    run's `BaseCommit` is the branch head at the retry, so its evidence leaves those commits out.
  - A lane's first task retried after a Setup failure keeps the base its branch was created at, even when
    other lanes have merged since.
- **Why:** workers commit once, at the end, so a failed attempt rarely leaves commits behind. Rewinding needs
  a hard reset inside a tree that `task worktree:prepare` junctions into, the class of operation c375b9ff had
  to make safe for removal.
- **Where to pick it up:** in `applyActionLocked`'s `skip` case (`pkg/orchestrate/mutation.go`), reset the lane
  worktree to the last done task's reported commit (its child run's `EndCommit`) after `DumpRecoveryPatch`,
  unlinking junctions first as `removeWorktreeDir` does. For evidence, stamp the base on the task node at its
  first dispatch and reuse it on a retry.

## Merge-point Verify: a timeout kills the shell only, and a failed Verify holds only its own run's merges (2026-09-15)

Slice 4c of the orchestrator redesign (`git show edf0132b:docs/superpowers/plans/2026-09-15-orchestrator-redesign-s4c-setup-merge-verify.md`)
runs a plan's Setup and Verify commands through the platform shell and serializes merges per project checkout.

- **What was deferred:**
  - At `SetupTimeout` or `VerifyTimeout`, `execPlanCommand` (`pkg/orchestrate/plancmd.go`) kills the shell it
    started (`cmd.exe` or `sh`). A test runner the shell started keeps running until it exits on its own;
    `WaitDelay` only stops the engine waiting for it. `TestPlanCommandTimesOut` shows it on Windows: a 200ms
    timeout returns after about 5s, because the orphaned `ping` holds the output pipe until `WaitDelay`.
  - The landing claim (`pkg/orchestrate/verify.go`) serializes a merge and its Verify across every dag in one
    checkout, but a persisted `verify-failed` task holds only its own dag's later merges. A second orchestrator
    run in the same checkout would land on top of the failure.
- **Why:** both need machinery that one run per checkout does not: a process tree kill (a Windows job object,
  a Unix process group), and a store scan across dags by project path.
- **Where to pick it up:** `pkg/shellexec/jobobject_windows.go` already kills a process tree through a job
  object (`attachJobObject`, `killJobTree`); export it and attach it in `execPlanCommand` after `Start`. For the
  hold, have `AutoMergeReady` scan the non-terminal dags whose owner run has the same `ProjectPath`.

## Codex and opencode run workers (2026-09-14)

The orchestrator redesign (`docs/superpowers/specs/2026-09-14-orchestrator-redesign-design.md` §8) scopes
run workers, both leads and task workers, to Claude Code and pi, the two harnesses the owner uses. Consults
still run on codex and opencode; only the unattended run path lost them.

- **What was removed:**
  - `RunWorkerCapable` is false for codex and opencode (`pkg/harness/catalog.go`).
  - The codex and opencode arms of `RunWorkerSpecFor` (`pkg/jarvis/runexec.go`) are deleted.
  - The codex entry in `livenessRuntimes` (`pkg/orchestrate/liveness.go`) and its rollout test are deleted.
    The transcript scan still reads codex's date-nested layout and its `session_meta` cwd.
  - The codex and opencode rows of the route table, and `codexSafe` (`pkg/runroute/runroute.go`), are
    deleted.
- **Why:** each runtime multiplies the orchestration surface: wake adapters, compaction hooks, ask
  delivery, liveness and route validation. The redesign builds those for two harnesses, and neither of the
  other two was in use.
- **Recovery:**
  - `git show adfcbebc:pkg/jarvis/runexec.go`
  - `git show adfcbebc:pkg/jarvis/runexec_test.go`
  - `git show adfcbebc:pkg/orchestrate/liveness.go`
  - `git show adfcbebc:pkg/orchestrate/liveness_test.go`
  - `git show adfcbebc:pkg/runroute/runroute.go`
  - `git show adfcbebc:pkg/runroute/runroute_test.go`
  - `git show adfcbebc:pkg/harness/catalog.go`
- **Where to pick it up:** re-add the adapter arm, the route validation (a model namespace check, since
  tiers are gone) and the `RunWorkerCapable` flag together; a runtime needs all three to dispatch. A
  runtime also needs the redesign's per-harness pieces (wake, compaction rules, ask delivery) before it can
  lead. codex additionally needs its `livenessRuntimes` entry back.

## Jarvis Gatekeeper — every multi-question or multi-select ask escalates unjudged (2026-09-14) — ✅ RESOLVED 2026-09-29

**Resolved by `1dcf0a88`** (run f9d2a919, merged in 443c5f66), on the fix shape below: every ask reaches the judge,
which answers each question with picks or one line of text, all or nothing; `agentask.ValidateAnswers`, shared with
`EncodeAnswer` and the prose path, checks an answer before delivery; cards gain `Questions` and `Answers`.

Found while designing the orchestrator redesign
(`git show a4b5bd4f:docs/superpowers/briefs/2026-09-14-orchestrator-redesign-measurements.md`). Deferred by the user: the
redesign's high-level decisions come first. The fix shape below was reviewed in chat and is **not approved**.

- **What is limited:** `handleAsk` (`pkg/jarvis/watcher.go`) escalates every ask that `askAutoAnswerable`
  rejects — more than one question, or one multi-select question — with "needs a human (multiple or
  multi-select questions)". The judge never sees it. Under the redesign the ask judge is the only automated
  answerer of child asks, so each such ask costs a human round-trip, and human latency is the largest
  wall-clock lever the brief measured.
- **Why it is not a delivery limit:** `agentask.EncodeAnswer` already types single-question multi-select
  (`63ffc6e1`, 2026-07-03), multi-question batches (`4a6efb84`, 2026-07-09) and free-text answers
  (`dfa9200c`, 2026-07-10), each recorded as verified live against CC. The one-question, one-pick assumption
  lives only in the Gatekeeper: `askAutoAnswerable`, `Decision.OptionIndex` (one int), `BuildClassifyPrompt`
  (one question), `handleAsk`'s `[]int{idx}` delivery, and `postAnswered` / `postEscalation` reading
  `Questions[0]`.
- **Fix shape:**
  1. Drop the prefilter; every ask reaches the judge.
  2. `Decision` carries `Answers []baseds.AgentAnswerItem` — one per question, picks or text.
  3. The prompt renders every question with its pick-one / pick-any mode and indexed options, and allows a
     one-line text answer when no option fits.
  4. All or nothing: if any part needs the human, the whole ask escalates. CC's panel submits the batch at
     once, so a partial answer would leave the human finishing a half-typed panel.
  5. Validate before delivering, through one validator shared with `EncodeAnswer` (extract
     `agentask.ValidateAnswers`): one answer per question, picks xor text, exactly one pick for
     single-select and at least one unique pick for multi-select, indexes in range, single-line printable
     text, and the prose path's one-answer rule. An invalid answer escalates without calling `deliverFn`;
     `DeliverAnswer` claims the ask before it encodes, so a bad judge answer must never reach that claim.
  6. `JarvisCardData` gains `Questions` and `Answers`; `Question` / `Options` stay populated from question 0
     so persisted cards, `parseCardData` and the attention row keep working. No frontend change: nothing in
     the frontend reads `choice` or `humanPick` any more, and `SetChannelMessagePickCommand` has no caller
     (dead plumbing, out of scope here).
  7. Tests: a `ValidateAnswers` table; the prompt renders all questions and modes; `ParseDecision` reads
     answers; `handleAsk` delivers a multi-question shape; an invalid answer escalates with no delivery.
     `TestAskAutoAnswerable` / `TestOptionIndexInRange` go with their functions; encode tests must still pass
     after the extraction.
- **Where to pick it up:** with the redesign's child-ask section. That section changes the judge's context
  (spec, sibling tasks, prior question-and-answer pairs) and its escalation classes, not this answer format,
  so the two compose. Files: `pkg/jarvis/watcher.go`, `classify.go`, `cards.go`, `pkg/agentask/encode.go`.

**2026-09-17 update — held on evidence, not built.** The orchestrator redesign shipped, but it routed DAG
child asks to the lead instead of making the ask judge their only automated answerer: `handleAsk`
(`pkg/jarvis/watcher.go`) returns early for `isOrchestratorRun`, so a DAG child's question waits in its
lead's queue and never reaches the Gatekeeper at all (nor does the lead's own, which is always the human's).
That was this deferral's whole urgency — with it gone, the Gatekeeper now judges only quick-run and concierge
workers, and there is no evidence multi-question or multi-select asks are common there. Revive when gatekeeper-enabled channels show multi-question escalations
the human answers routinely; the fix shape above stays valid.

## Diff surface — hiding whitespace-only files from the change list (2026-09-11)

Deferred by finding F4 of the git-compare-viewer parity initiative
(`git show edf0132b:docs/superpowers/plans/2026-09-04-git-compare-viewer-parity.md`).

- **What the finding asked for, and why it was not built:** F4 prescribed threading `-w` through the
  `CommitDiff` / `CompareDiff` RPCs. That prescription went stale during the initiative — after Task 8 the
  production pane calls neither command: it reads two file texts through `GitFileAtRef` and lets Monaco
  compute the diff. A temp-repo probe also showed the two git reads disagree under `-w`: `git diff
  --numstat -w` drops a whitespace-only file entirely while `git diff --name-status -w` still lists it, so a
  server-side flag would leave the change list and its own counts contradicting each other.
- **What shipped instead** (`88523b90`): the real post-Task-8 defect was Monaco's `ignoreTrimWhitespace`
  defaulting to **true** — a whitespace-only change drew as no change at all while the header above it read
  `+2 -2`. `frontend/app/view/agents/diffoptions.ts` makes the switch explicit and **off** by default, so the
  pane and the list agree; Shift+W (`files:toggle-whitespace`) is the opt-in for reading through a reformat.
- **What is still deferred:** filtering whitespace-only *files* out of the change list while whitespace is
  ignored. It is not a flag on an existing command — it needs one read that decides both the list and the
  counts, i.e. `gitinfo.Changes` returning a per-file "whitespace-only" bit derived from a single
  `--numstat` / `--numstat -w` pair. Building it as a second read is what produces the contradiction above.
- **Where to pick it up:** `git show 88523b90:frontend/app/view/agents/diffoptions.ts` for the switch this
  would hang off, and `pkg/gitinfo/gitinfo.go` `Changes` for the read that would have to carry the bit.

## Jarvis Brief — what retiring the three-pane composition left without a mount (2026-09-10)

Deferred by B5 of the Jarvis Brief initiative (`docs/superpowers/specs/2026-09-09-jarvis-brief-meta-spec.md`),
which deleted the Subjects column, the Stage and the context rail. These are the capabilities those panes
were the **only** mount for, and that B5's approved scope did not re-home.

- **What was deferred:**
  - **Subject browsing.** The column was the only place to list, filter, group and collapse channels,
    records and threads — `toggleSubjectGroup`, plus the whole grouping model in the deleted `subjects.ts`.
    The Brief's regions cover the work that is *running*; the archive is not browsable there.
  - **Channel lifecycle.** `renameChannel`, `deleteChannel`, `archiveChannel`, `setChannelNotes` — all of
    them were the column's per-row menu. Creating a channel was re-homed (see below), managing one was not,
    so a channel can now be created and never renamed or removed.
  - **Thread lifecycle.** `archiveJarvisConversation`, `deleteJarvisConversation` — the same menu.
  - **The autonomy ladder.** `AutonomyLadder` (`autonomyladderview.tsx`) was mounted by the Stage header and
    edits the channel's tier and mode through `setChannelTier`. Remote approval policy is unreachable now.
  - **Initiative lifecycle and the effort card.** `EffortCreateForm`, `EffortCard`, `expandEffort`,
    `toggleEffort`, `unarchiveEffort`, `deleteEffort`. The Brief's Initiatives rows are read-only and its
    sheet shows an initiative's chunks — so an initiative can be inspected and never created, archived or
    deleted.
  - **Ask-mode consult results** (`ConsultsSection`) and **resume / proactive cards** (`ResumeCard`,
    `ProactiveCard`, `ambientSection`). These are §4a items 11 and 12, decided as drops rather than
    re-homes; naming the functions here is what makes the loss concrete.
  - **The rail's fleet roster and per-worker dismiss** (`FleetRoster`, `dismissWorker`, `runRailSection`).
    The Brief's header keeps a derived fleet *line*; the per-worker roster with its dismiss is gone.
  - **Per-answer cancel and retry** (`cancelJarvisQuery`, `retryJarvisQuery`). The Brief's composer holds
    while its own question is out and leaves a failed one retryable, but there is no control to abandon an
    ask already in flight.
  - **The Stage's turn renderers** (`JarvisAnswer`, `JarvisWorkingSteps`). The Brief's thread renders its
    own turns and citations through `briefdrew.ts`, so these are largely superseded — recorded because
    "largely" is not "entirely": the Stage's answer view carried grounding chips inline.
  - **The stage-rail shell as a container**, and with it the `d` chord.
  - **The composer's `@`-command vocabulary.** Missed by the sweep entirely (see the correction under *Why*).
    `LaunchComposer` and `TalkComposer` (`agents/channelcomposers.tsx`) lost their only importer when B5
    deleted `stagecomposer.tsx`, and with them the curated `@quick` / `@run` / `@ask` vocabulary in
    `agents/composercommand.ts` — `LAUNCH_COMMANDS`, `parseComposerCommand`, `resolveComposerDispatch` are
    now reachable only from that unmounted file and their own test, and the module's only surviving live
    imports are `import type { RunShape }` in `runconfig.ts` / `runconfigstore.ts`. The Brief did re-home the
    *launcher* — `RunLauncher` plus `briefsheet.tsx`'s own `ChannelLaunch` goal row — but the goal row is a
    plain textarea, so a run's mode is now picked only from the launcher's controls and the one-shot `@ask`
    consult has no typed form at all. `TalkComposer` is also the "merged surface composer Talk face" that
    `runbody.tsx:10` names as the reason inline steering was removed.
  - **The profile drawer's playbook and global-profile sections.** Not an orphaned module — a capability lost
    *inside* a replacement, which is the second thing the sweep cannot see. `profilepanel.tsx` was deleted and
    `briefprofileview.tsx` succeeded it carrying only the per-channel scalar defaults and a principles patch,
    so the playbook editor (`ProfileOverride.playbook`) and the global profile editor had no mount, while
    every export they used still looked consumed — by `profilemodel.test.ts`.
  - **Creating a persisted thread from an ask.** Found by CDP, not by the export sweep: the `n` chord still
    creates a thread (`startJarvisThread`), but the compose path that used to submit INTO it was the Stage's
    composer, and it is gone. The Brief's composer asks through `askAcrossWork`, which is stateless on
    purpose ("launch-local; never a JarvisConversation", `briefingstore.ts`), so `n` now opens a thread that
    nothing can fill and a Brief ask leaves nothing to reopen. Persisted conversations are still readable —
    `brief-restore` hydrates one into the Brief's thread — they can no longer be created with content. The
    fix is a decision, not a port: either the Brief's composer asks into its subject's conversation when it
    has one, or the `n` chord stops offering a thread the surface cannot use.
- **Why:** the retirement is a deletion, and a single deletion cannot re-home the mounts it does not know it
  owns. B5's approved scope named five re-homes (the run body, the launcher and its goal row, the record
  band, the initiative detail, and B4's profile modal) and these thirteen were not among them. Ten were found
  afterwards by sweeping `app/` for exported functions with no production consumer left once the panes were
  gone. **Corrected 2026-09-11: that sweep is not exhaustive and must not be cited as if it were.** Re-run at
  module level it confirms the orphans it did name (`autonomyladderview`, `effortcreateform`, `jarvisturn`,
  `proactiveviews`, `resumeviews`, `runrail` all had no importer; `radardevmock` and `sessionsmotion` were
  already test-only before B1) — but it misses losses of three kinds. (a) It missed
  `agents/channelcomposers.tsx` outright, which is a plain gap, not a structural one: the file is orphaned by
  exactly the criterion the sweep claims to apply. (b) It is structurally blind to a capability that dies
  *inside* a file that has a successor — the exports keep a consumer, so nothing reads as orphaned, and a
  test file counts as a consumer to a grep. (c) It is single-level: an export whose only consumer is itself
  unmounted still reads as live, which is how `steerWorker` survived — the sweep had already failed to notice
  that its one caller was `channelcomposers.tsx`. All three are now in the list above. The list is still worth
  trusting for what it names; it was never a proof that nothing else was lost.
- **What already exists:** every item is shipped and unit-tested; **nothing was deleted**, and the modules
  named above are all still in the tree — with one exception, the profile drawer's two sections, whose host
  `profilepanel.tsx` *was* deleted — recover it with
  `git show cd5f1560^:frontend/app/view/jarvis/profilepanel.tsx`. That deletion is what made them invisible
  to the sweep, and is why they cost a rebuild rather than a re-mount. The rest are *orphaned*, not removed,
  deliberately: a deferred capability's implementation is the expensive half of re-homing it, and the precedent is the
  2026-07-31 entry's `gitinfo.RevertFile` / `GitRevertCommand`, kept for exactly this reason. What B5 did
  remove is the dead code that was genuinely finished with: the column, the rail, the Stage, their exclusive
  views, the `jarvisComposition` toggle and the `jarvis.stagerail.open` / `jarvis.composition` keys.
- **Where it plugs in:** the Brief's header already hosts `+ Channel` (`newchannelcontrol.tsx`), so a channel
  menu belongs beside it; initiative creation and archive belong on the Initiatives region's row or in its
  sheet; the consult and resume/proactive feeds need a home or a stated non-home (they are the two items the
  meta spec left open); the autonomy ladder belonged to the Stage header and could sit in the sheet header,
  since the sheet is now what draws a channel.
- **How to pick it back up:** decide per capability whether it belongs in the Brief at all, then re-home the
  existing control rather than rebuilding it — the call sites to restore are the exported functions named
  above, and `git log` on any of them shows the mount that was removed. The two that are load-bearing rather
  than nice-to-have are **channel lifecycle** and **initiative creation**: without the first a channel cannot
  be renamed or removed at all, and without the second no initiative can be started. Do not start from this
  entry alone — read B5's chunk note in the effort tracker for the re-homes it *did* make, so a second pass
  does not undo one of them. One item above is also a **verification** gap rather than only a product one:
  the detach/restore round trip against a record (`recordbandview.tsx`'s `EdgeControls`, still mounted inside
  the run sheet) lost its scenario with the column, so re-authoring that round trip against the sheet is
  owed independently of what is decided about the thirteen above.

**2026-09-11 update — what the review-fix pass re-homed.** The Brief review findings tracker
(`effort:732863fa-1374-4ab2-9753-1220fc885f34`, F1–F9) closed four of the items above by moving the existing
control, not rebuilding it. Re-verified by a fresh module sweep on 2026-09-11:

- **The autonomy ladder — re-homed (F7).** `autonomyladderview.tsx` is imported again, by `briefsurface.tsx`:
  it renders the header's tier chip, whose face is derived across active projects by a new `briefautonomy.ts`
  (there is no global tier in the backend — `gatekeeper:enabled` / `delegator:*` are per-channel meta — so the
  chip states "Mixed · N of M <tier>" when projects disagree), and its popover edits one project's rungs.
- **Initiative creation — re-homed (F7).** `EffortCreateForm` is mounted by a new `newinitiativecontrol.tsx`
  beside `+ Channel`, with a `Shift+N` binding. Reading one got a way in when F6 made the Initiatives region's
  row a button that opens the effort sheet, and B6d moved the card's Archive into that sheet and deleted
  `EffortCard`, `expandEffort` and `toggleEffort`. **Still orphaned**: `unarchiveEffort` and `deleteEffort`
  have no consumer outside their own module, so an initiative can be archived but not unarchived or deleted.
- **The playbook and global-profile sections — re-homed (F4).** `BriefProfileModal` now opens on a
  project/global scope toggle: project scope gained the playbook section the deleted `profilepanel.tsx` owned,
  and global scope edits the `JarvisProfile` every project inherits. This matters beyond tidiness —
  `resolveRunPlan` (`wshserver_runs.go:254`) composes every pipeline run from the resolved profile's phases,
  so between B5 and F4 a custom playbook could only be set over the RPC.
- **Steering a running worker — re-homed (F3).** `steerWorker` had zero reachable callers (`runbody.tsx`
  hardcodes `hideSteer`, and its named replacement — the Talk face — was the orphaned `TalkComposer`). The
  sheet composer now resolves its target through a new `briefcomposertarget.ts` and routes to `steerWorker`
  when the drawn session's current phase has a live lead with a writable block. The *component*
  `TalkComposer` stays orphaned; only the capability came back.

**Still deferred and unchanged:** subject browsing, channel lifecycle, thread lifecycle, per-answer cancel and
retry, the consult and resume/proactive feeds, the rail's fleet roster and `dismissWorker`, the Stage's turn
renderers, the `@quick`/`@run`/`@ask` vocabulary, and the persisted-thread-from-an-ask decision. Of the two
items called load-bearing above, initiative creation is closed and **channel lifecycle is not** — a channel
still cannot be renamed, archived or removed anywhere in the cockpit. The record detach/restore verification
gap is also still owed.

**2026-09-17 update — the backlog cleanup pass closed most of what remained.** One item, channel lifecycle,
stopped being load-bearing along the way: the one-channel-per-project collapse (chunk 9's dependency) means a
channel is no longer created and abandoned by a human, so there is materially less left to manage. Per item:

- **Channel lifecycle** (`renameChannel`, `archiveChannel`, `setChannelNotes`) — **deleted in `5827e43b`**,
  no longer load-bearing per above. What it left orphaned is listed in `docs/orchestrator-guide.md` (What the
  backlog run left open).
- **Subject browsing, grouping, filtering** — **closed as superseded** in `64048f86`: the palette's Brief
  index (`briefpalette.ts` `buildBriefIndex`) now browses and filters records, threads, initiatives and
  sessions, archived included; the leftover grouping remnant (`toggleSubjectGroup`) was deleted with it.
- **Thread lifecycle** (`archiveJarvisConversation`, `deleteJarvisConversation`) — **deleted in `4c36093e`**;
  threads now accumulate with no removal path. Revive when thread clutter in the palette becomes a real
  problem — its own entry below holds the recovery command.
- **Per-answer cancel and retry** (`cancelJarvisQuery`, `retryJarvisQuery`) — **deleted in `4c36093e`**,
  closed as superseded: the Brief's composer already holds while its own question is out, a failed ask stays
  retryable from the composer, and the pet's `JarvisConverseCommand` is capped at `JARVIS_RPC_TIMEOUT_MS`
  (130 s), so an abandoned stream terminates on its own instead of latching.
- **Rail fleet roster and per-worker dismiss** — **`dismissWorker` deleted in `bf60b61f`**; `FleetRoster` and
  `runRailSection` were already gone (verified 2026-09-17), so nothing consumed it. The header's derived
  fleet line is the only survivor.
- **The composer's `@`-command vocabulary** — **deleted in `5eac07ed`** along with the unmounted composers
  themselves; see the "Composer attachments" entry above for the sibling capability that went with them.
- **The Stage's turn renderers** (`JarvisAnswer`, `JarvisWorkingSteps`) — `jarvis/jarvisturn.tsx` **deleted
  in `51cb08c1`**. Two remainders that were not actually superseded by `briefdrew.ts` — citation-aware turn
  prose, and a verdict badge for a `weak`/`notfound` terminal — were re-homed into a new `briefturn.ts`,
  consumed by `briefsurface.tsx`, rather than lost.
- **The record peek's yield-while-stacked workaround** — unwound in `293f55ca` now that `ModalShell` only
  takes focus/Escape when it owns the top of the modal stack; its live check is listed in
  `docs/orchestrator-guide.md` (What the backlog run left open).
- **Still open, untouched by this pass:** the consult and resume/proactive feeds (§4a items 11/12, deliberate
  drops with no home decided), and the persisted-thread-from-an-ask decision (the `n` chord still opens a
  thread nothing can fill).

## Diff surface — repository actions split out of the parity work (2026-09-04)

Deferred by the two-spec split agreed during brainstorming on 2026-09-04. The Diff surface's
JetBrains-parity work was scoped as six gaps; five are specced and planned
(`docs/superpowers/specs/2026-09-04-git-compare-viewer-parity-design.md`,
`git show edf0132b:docs/superpowers/plans/2026-09-04-git-compare-viewer-parity.md`). The sixth — **repository
actions** — is this entry.

- **What was deferred:** checkout, cherry-pick, revert (file and hunk), and any other operation that
  writes to the repository from the Diff surface. JetBrains offers these from its compare view's
  context menu; this surface offers none of them and stays read-only.
- **Why:** everything in the parity spec reads; these write. Different risk class, needs its own
  confirmation UX and its own conversation about what a cockpit should be allowed to do to a working
  tree. Designing a diff renderer and a destructive action in the same spec would have rushed the
  second.
- **What already exists:** `gitinfo.RevertFile` / `gitinfo.RevertHunk` and `GitRevertCommand` are
  shipped, tested (`TestRevertFileSubdir`, `TestRevertHunkSubdir`) and orphaned — see the 2026-07-31
  entry below, which this supersedes as the reason they are kept. `gitdiff.ts`'s `hunks` /
  `diffHeader` fields are retained by the parity spec's decision 4 specifically as the patch source a
  hunk revert needs; if this work is abandoned, delete them.
- **Where it plugs in:** the affordances belong in `diffpane.tsx`'s header and the changed-file rows
  in `changedfilelist.tsx` — both of which the parity plan rewrites, which is the argument for doing
  the parity work first and designing this against the result.
- **How to pick it back up:** brainstorm it as its own spec (Spec B). Open questions to settle there:
  which actions are in scope, what confirmation each needs, whether anything is allowed while a run
  or agent holds the same working tree, and how a failed write surfaces. Do not start from the parity
  spec alone — it deliberately says nothing about writes.

## Channel data-model scaling — Phase 3 (Contract) — parked on evidence gate (2026-08-25)

Deferred after the 2026-08-25 prod reality check. Phase 3 was the irrevocable step of the approved scaling
workstream (spec `docs/superpowers/specs/2026-07-21-channel-data-model-scaling-design.md`): stop embedding
`Messages`/`Runs` in the channel blob, make `Channel` metadata-only, drop the dead arrays, and land the
A1 write/broadcast payoff.

- **What is available now:** Phases 0–2 shipped — read-connection pool (A3), indexed `db_run` /
  `db_channelmessage` rows with `channeloid` expression indexes, hot-path lookups redirected, worker-oref→run
  stamped on tab meta, and per-object delta broadcast. The hard part (indexed model, migration risk absorbed)
  is done; only the collapse remains.
- **Why deferred:** the workstream is explicitly preventive ("no observed symptom"), and the reality check
  found the target does not exist yet. Measured in the packaged-app DB
  (`%LOCALAPPDATA%/dev.arc.app/data/db/waveterm.db`, read-only query, 2026-08-25): **4 channels, 680 KB total
  blob bytes** (largest 341 KB, dominated by ~28 KB sealed run evidence per done run, not message text),
  34 messages, 58 runs. Even 10× annualized usage ≈ 7 MB total — the O(history) write/broadcast cost is
  nanoseconds-scale and unmeasurable. Building Phase 3 now would spend the irreversible step to collapse
  ~680 KB.
- **Where it plugs in:** `db_channel` becomes metadata-only; drop-array migration; verification per spec
  Section 4 (constant-ish write time on a burst of posts to a large channel). Fold in the outstanding Phase 2
  carry-ins when cutting over: cross-channel aggregates (rail unread badge, cross-channel ask badges) still
  read the `GetChannels` snapshot, and the deferred visual-parity CDP check.
- **To resume:** a channel whose embedded blob is material (roughly >5 MB, or a measured per-event
  write/broadcast cost that shows up in real use), or any observed write/latency symptom on a large channel.
- **Separate observation, not this deferral:** the DB's bulk is `db_tevent` (753,006 terminal-event rows
  ≈ most of the 171 MB file), not channel data. If DB size matters, that is the target, not Phase 3.

## Jarvis Briefing — generic cross-project progress and durable milestones (2026-08-13)

Deferred during the Axis 2 landing-briefing design. The briefing can generically identify active work
across projects, but Wave does not yet own a trustworthy project- or workstream-progress denominator.

- **What is available now:** Wave-owned Run status/phases and runtime task plans from agent transcripts
  (Claude `TodoWrite`, Codex `update_plan`, Pi `TaskCreate`/`TaskUpdate`/`TaskList`), associated with a
  project through `Run.ProjectPath` / `agentsessions.SessionInfo.ProjectPath`. These describe one run's
  execution progress only. They may be absent, replaced, or cleared by the runtime.
- **What is deferred:** a generic progress model that persists across runs and can honestly answer how
  far a larger workstream has advanced. Dossiers have status and acceptance prose but no checked
  milestones; arbitrary repository trackers, Jira, and GitHub Projects have no common contract. Do not
  parse project-specific Markdown or relabel a current run's `done/total` as whole-project progress.
- **Why:** milestone identity, ownership, weighting, update authority, and stale-report behavior need a
  dedicated product/data-model session. Folding them into the landing briefing would overfit one project
  and invite fabricated percentages.
- **Where it plugs in:** a Wave-owned workstream/milestone contract (likely adjacent to dossiers), an
  agent reporting path, and then a source-identified progress projection in `pkg/jarvisstate` and the
  Briefing subject. Runtime task plans remain a possible run-level fallback, not the durable source.
- **To resume:** define workstream identity across runs; milestone lifecycle and who may update it;
  deterministic progress semantics (including unequal or unknown work); source health and staleness;
  runtime-normalized task-plan fallback; and UI wording that distinguishes run execution from durable
  workstream progress.

## Pi Part B — wave_create_widget tool + `wsh widget` vdom CLI deferred to v2 (2026-08-12)

Designing the bidirectional pi↔arc integration (meta Part B, spec
`docs/superpowers/specs/2026-08-12-pi-partb-bidirectional-design.md`), we kept four wave_* tools in
scope (wave_run_command, wave_open_file, wave_query_sessions, wave_notify) and deferred the fifth:

- **`wave_create_widget` (pi tool) and its `wsh widget` CLI wrapper** — the only tool needing new
  server surface: it would wrap `VDomCreateContextCommand` / `VDomRenderCommand`
  (`pkg/wshrpc/wshrpctypes_vdom.go`) behind a new wsh subcommand. Deferred because vdom
  async-initiation / render-stream semantics deserve their own care and there is no concrete
  consumer yet (YAGNI).
- **How to resume:** when a concrete consumer appears, add `wsh widget create <name> <json>` /
  `wsh widget update <oref> <json>` wrapping the two vdom commands, register `wave_create_widget`
  in `pi/extensions/waveterm-tools.ts` (Typebox params: name/data for create, oref/data for
  update), and extend the Part B plan's tool tests.

Also confirmed NOT deferred (deliberately included in v1 after review): control-channel
`new_session` / `switch_session` commands, despite the documented session-replacement footguns.

## Diff surface — Review mode's backend orphaned by its deletion (2026-07-31)

- **Git revert backend is orphaned.** Deleting Review mode from the Diff surface left `GitRevertCommand`
  (`pkg/wshrpc/wshrpctypes_projects.go`, handler in `pkg/wshrpc/wshserver/wshserver_projects.go`) and
  `gitinfo.RevertFile` / `gitinfo.RevertHunk` with no caller. Kept deliberately — tested Go code
  (`TestRevertFileSubdir`, `TestRevertHunkSubdir`), zero runtime cost, and a cleanup candidate rather than a
  defect. Same precedent as the orphaned standalone WaveAI chat block.
- ~~**`reloadChanges` is orphaned too** (`frontend/app/view/agents/filesstore.ts`). Its only caller was
  `reviewstore.ts`'s apply path, which refreshed the Browse file list after a revert mutated the tree. Nothing
  in the read-only surface mutates, so nothing needs to re-read. Kept for symmetry with the revert backend
  above; delete both together or neither.~~ No longer orphaned: `aa9ba8e8` (2026-09-05) calls it from
  `startChangesPoll` while the surface is on screen and from `files:refresh` (`r`), since agents change the
  tree under the surface. The revert backend above stays orphaned on its own.

## Jarvis S2 — semantic consumers L3 + L4 (2026-07-24)

Shipped L3 (semantic recall in `pkg/jarvisrecall`) and L4 (semantic attribution in `pkg/jarvisattrib`) over
S1's index, plus a keyed embedding cache in `pkg/jarvisembed` (`attrib_vectors` + `EmbedCached` + `Cosine` +
public `Embed`). Both degrade to the v1 result when embeddings are off.

Deferred:
- ~~Semantic seed recency-ranking: L3 appends semantic seeds after the deterministic top-k (ScoredChunk has no
  timestamp to interleave by). A reserved semantic sub-budget / recency-aware merge is deferred pending
  evidence that the append order matters.~~ **Evidence arrived 2026-07-27 (J5).** Order mattered, but not in
  the way this framed it: recency was the wrong axis. L3 still appends after the deterministic top-k, and
  within L3 seeds are now emitted round-robin across collections (best-first per collection) rather than by
  raw score, because a merged score ranking is a global ranking and memory wins it. Downstream,
  `orderCandidates` ranks seeds ahead of expansion-only nodes so the `maxCandidates` cut no longer discards a
  node the query matched. Still open: a *recency-aware* merge, which remains unevidenced.
- L4 gating loosening: semantic fires only when a dossier has zero deterministic (L1-3) edges. Per-run silence
  (propose for individual unattributed runs on an otherwise-attributed dossier) is deferred pending evidence.
- Reranking / hybrid score-fusion, proactive resurfacing (S3), auto-hardening a semantic edge — out of S2.

PLACEHOLDER tuning (calibrate against a populated, embedded vault):
- ~~`kSem = 6` (semantic seed candidates, `pkg/jarvisrecall/retrieve.go`).~~ **Fitted 2026-07-27 (J5)** against
  the real 424-node corpus: replaced by `kSemPerCollection = 6` (a per-collection KNN — measured requirement
  is ≥2, kept at 6 for headroom) plus `semSeedFloor = 0.325`, a floor L3 previously lacked entirely. Both are
  specific to `text-embedding-3-small`. Measurement and the floor sweep are in
  § J5 of `git show a4b5bd4f:docs/jarvis-second-brain-open-issues.md`; harness is `pkg/jarvisrecall/liveprobe_test.go`.
- `semCandidateN = 20` (window-overlapping runs considered per orphan dossier, `pkg/jarvisattrib/semantic.go`).
- `semThreshold = 0.75` (cosine floor to propose a semantic edge).
- `weightLayer4 = 0.2` (semantic edge confidence). It renders "weak" because layer 4 maps to "weak"
  directly — the `bucketWeakMax` cutoff this line used to cite was deleted 2026-08-03 (see § sub-project D).

## Jarvis U2 — Tasks surface (dossier editor) (2026-07-24)

U2 ships the read + two-write inside-Wave tier (append a decision, change status). Deferred this cycle (spec §9):
- **In-Wave `## Notes` editing:** the human Notes prose renders read-only in the Tasks detail (`frontend/app/view/jarvis/taskdetail.tsx`). Editing needs a human-owned write path (`Vault.Write` rejects human-region edits by design; a Notes edit would append via a `CreateHuman`-style prose write + commit) plus an editor affordance. To resume: add a "Edit notes" toggle in `taskdetail.tsx` and a `SetDossierNotesCommand` that writes the `## Notes` region as a user commit.
- **Editing non-reserved frontmatter** (arbitrary human keys) and **editing/superseding existing decisions from the UI:** backend supports `SupersedeDecision`, but no UI affordance. Decisions stay append-only in U2.
- **Manual dossier creation** from the surface: dossiers are created by `jarviscapture`/dispatch (machine `CreateDossier`) only; no "New task" button.
- **Semantic/probation edge rendering, the Graph surface, live push:** the detail refs render as flat id chips (`Refs` machine field); no graph view, no `wps` subscription — the surface reloads on its own writes and on nav-focus, not on external vault mutations.
- **Notes heading normalization is FE-side:** `LoadDossier`'s `Notes` projection keeps the scaffold's `## Notes` heading; `taskdetail.tsx` strips a leading `## Notes` before display (deviation from the plan's verbatim render, which would have shown a literal `## Notes` line + an empty Notes section on every dossier). If a backend-side fix is preferred later, strip the heading in `jarvisdossier.LoadDossier` instead and drop the FE regex.

## Jarvis S1 — embedding foundation (2026-07-24)

Deferred:
- Warm-at-commit wiring: `Reconcile` is exposed but only called lazily from `Query` in S1. Wire it into a commit boundary only if first-query latency after edits proves painful.
- Settings UI for embed config/key: S1 reads `jarvis:embed*` from config and the key from `secretstore`; a settings-surface control is deferred (S2 / a small settings add). Dev sets config via settings file + `secretstore.SetSecret`.
- Multimodal/image embeddings, query-side reranking, bundled local embedding model — v3.

Build wiring S2 must complete (discovered during the S1 spike; no consumer imports `pkg/jarvisembed` yet, so the Taskfile backend build does not link sqlite-vec today):
- Any build/test that compiles `pkg/jarvisembed` needs `CGO_CFLAGS="-O2 -g -I<repo>/pkg/jarvisembed/csrc"`. `csrc/sqlite3.h` is a vendored copy of mattn's `sqlite3-binding.h` (the asg017 sqlite-vec module `#include`s `sqlite3.h`, which mattn ships under a different name, and CGO CFLAGS from our package do not propagate to an imported cgo module — the include must come from the global `CGO_CFLAGS`). `-O2` must be preserved or zig's Debug default turns on UBSan for `sqlite-vec.c` and the link fails on `__ubsan_handle_*`. See `pkg/jarvisembed/csrc/README.md`. When S2 wires a consumer into `wavesrv`, thread this `CGO_CFLAGS` into `Taskfile.yml`'s `build:server:*` for every target (compute the path as `<root>/pkg/jarvisembed/csrc`).

PLACEHOLDER tuning (calibrate against a populated, embedded vault):
- Query `k` (caller-supplied; no default fixed here).
- Embed batch size (all sections of a node in one call today).
- Section-split rule (`##` only; deeper heading levels not split).
- HTTP timeout (60s).
- Snippet length (240 bytes; byte-sliced, may split a multibyte rune — cosmetic for a grounding preview).

## Jarvis sub-project E (Continuity) — model tier, resume affordance, quit flush, terminal re-freshness (2026-07-24)

Decided during the E brainstorming (spec `docs/superpowers/specs/2026-07-24-jarvis-e-continuity-design.md`). E ships the rest-boundary narrative writer (`pkg/jarviscontinuity`): on a Run entering a rest state (`awaiting-review | blocked | done`), it assembles deterministic facts, runs one capable-model summary, and writes the dossier's `state` block + status off-band from `AdvanceRunCommand`. Recall (C) serves that narrative during ordinary traversal. Four forks + PLACEHOLDER tuning are deferred.

- **What's deferred:**
  1. **Haiku model tier for boundary summaries** (fork 2) — E's one model call reuses the capable model via `consult.SpecFor("claude") → consult.Run`, with no `--model` selection. The cheap tier is a shared concern (C's synthesis + E's summary both want it) and lands as its own cross-cutting slice, not a one-off inside E. Boundary summaries are event-bounded (one per rest transition, never a poll), so the interim cost is bounded.
  2. ~~**Resume UI/RPC + ambient "pick up where you left off"** (fork 1) — `jarviscontinuity.Resume(r, taskID) → Narrative` is exposed and unit-tested but has **no wired v1 consumer** (recall reads the `state` block during traversal, so nothing calls it). A dedicated resume card / `resume` RPC is a *push* affordance adjacent to v2 proactive resurfacing — an ambient-presence follow-on, not E.~~ **RESOLVED 2026-08-06** — `GetLatestResumeCommand` (`pkg/wshrpc/wshserver/wshserver_jarvispet.go`, `017dd234`) serves the single newest narrative by its own `Updated` stamp, and the pet's ambient sources consume it (`petsources.tsx` → `eventFromResume` in `petjoin.ts`): a stable-id "Where we were — …" peek event that re-speaks only when a new narrative is written. Still the newest narrative only — a per-task resume card remains the v2 ambient follow-on.
  3. **App idle/quit continuity flush** — no separate E flush on app idle or quit. A (Wave Vault) already performs a quit-safety commit, so a speculative E-owned flush is unjustified.
  4. **Completed-task prose re-freshness** (§3 caveat) — a **completed** task's prose can drift if facts change after `done`, because there is no further transition to re-trigger a summary. Low-stakes: it is a historical record and C still resolves live run status at query time. Re-freshness of terminal dossiers is out of scope.
- **Why:** each is either blocked on a not-yet-built substrate (1 needs the tiering slice; 2 needs the v2 ambient-presence surface) or is speculative against an existing guarantee (3 duplicates A's quit commit; 4 is a low-stakes drift on a historical record that C already backstops with live leaf resolution). Building any now would be a single-use abstraction or premature.
- **Where it plugs in:** (1) the `summarize` var in `pkg/jarviscontinuity/continuity.go` (a `--model` per call, wired with C's traversal at the shared `consult.Run` site — arrives with ≥2 real cheap-tier users per the F tiering-defer entry). (2) a resume card / RPC consuming `Resume` (`continuity.go`), surfaced on the Jarvis/ambient surface. (3) an app-lifecycle hook alongside A's quit commit. (4) a re-summarize trigger on post-`done` fact changes (or accept the drift).
- **PLACEHOLDER tuning** (`pkg/jarviscontinuity`, calibrate against a populated vault): the summary length cap (`<= 4 sentences`, in `buildSummaryPrompt`); the rest-state set `{awaiting-review, blocked, done}` (`IsRestState` — drop `awaiting-review` if plan-gate-heavy runs prove noisy, keeping `blocked`/`done`); `continuityCaptureTimeout = 90s` (the detached boundary-summary model-call bound, `pkg/wshrpc/wshserver/wshserver_runs.go`).
- **To resume:** each is independently pickable — (1) with the tiering slice, (2) a per-task resume card beyond the pet's newest-narrative peek, (3) if a quit-time gap surfaces, (4) on evidence that terminal-dossier drift matters.

## Jarvis sub-project C (Recall engine) — traversal loop, learning store, backfill (2026-07-24)

Decided during the C brainstorming (spec `docs/superpowers/specs/2026-07-24-jarvis-c-recall-design.md`). C ships pure-vault recall (deterministic seed selection → layer-1/2 → bounded `Expand` → one synthesis), a thin `dispatch → dossier` capture writer, and the F swap. Three pieces the meta spec scopes to C are deferred, plus PLACEHOLDER tuning.

- **What's deferred:**
  1. **Model-in-the-loop (agentic) traversal** — the north-star loop where a cheap model picks seed nodes and may request one more named re-expansion. v1 uses **deterministic** seed selection (regex ticket ids + full-text keyword ranking → top-k) and a single synthesis over one `Expand`.
  2. **Cache-tier learning store** — materializing high-confidence, fully-cited answers to the rebuildable derived layer with content-hash invalidation. v1 re-walks each question (retrieval is deterministic and free; the only cost is one synthesis per question).
  3. ~~**Historical backfill** — seeding the vault from existing SQLite objects (Runs/decisions/memory). Left as an optional, decoupled one-shot; recall is fed by live capture, not backfill.~~ **RESOLVED 2026-07-27** — built as `pkg/jarvisbackfill` (`11d454c9`, backdate fix `dde89ff5`) to raise the J5 calibration corpus: a pure planner (`plan.go`) turns recorded wstore history into a real vault — Runs supply dossiers (goal/status/window), terminal Radar investigations with a worker-written summary supply decisions; strict fidelity, nothing inferred, gaps land in `Plan.Skipped`. It is a calibration/bootstrap one-shot, not the feeding mechanism — live capture still feeds recall.
- **Why:** (1) is against the cost model without model tiering (F deferred it — only a capable model exists; running the agentic loop on it over a sparse v1 vault is expensive) — it lands **with** the cheap tier. (2) pays off only with repeated identical questions over a populated vault — no evidence yet, and it adds a keyed store + hash-set invalidation (YAGNI now). (3) manufacturing canonical Markdown from transient objects brushes the "no copying Run evidence into Markdown" non-goal; backfill is a bootstrap nicety, not the feeding mechanism.
- **Where it plugs in:** (1) the seed-selection + `Expand` loop in `pkg/jarvisrecall/retrieve.go` (add a cheap-model seed-pick + a bounded re-expansion request; wire together with the tier selector at the `consult.Run` site, per the F tiering-defer entry — arrives with ≥2 real cheap-tier users: C traversal + E boundary summaries). (2) a new derived-layer cache keyed by query + cited-node hashes, invalidated at commit against A's `ContentHash` (mirrors A's index / C's learning-store posture). (3) a one-shot migration reading `wstore` → `jarvisdossier.CreateDossier`/`AppendDecision`.
- **PLACEHOLDER tuning** (`pkg/jarvisrecall`, calibrate against a populated vault): seed top-k = 6; `Expand` Depth = 2 / Fanout = 8; `maxCandidates` = 12; and the v1 **one-dossier-per-Run** capture grouping (the many-Runs-to-one-task dossier needs a task identity Wave lacks — D/E territory). *(2026-07-27, J5: `maxCandidates`'s **ordering** is fixed — `orderCandidates` replaced the pure recency sort after a measured case showed the cap discarding the #1 semantic hit. The cap **value** 12 is still an unfitted guess; with seeds now sorted first it binds on the seed list rather than on expansion neighbours.)*
- **To resume:** each is independently pickable — (1) with the tiering slice, (2) on repeat-question evidence, (3) a further backfill pass only if a new source appears (the J5 importer ships).

## Jarvis sub-project A (Wave Vault) — memory vault coexists, unify later (2026-07-23) — ✅ RESOLVED 2026-07-27

**Resolved by J6**, spec `docs/superpowers/specs/2026-07-27-jarvis-j6-memory-root-unification-design.md`. `pkg/memroots` is now the single registry of durable-knowledge roots; the agent-native memory dirs are federated into the vault's `memory/` collection as read-only mirrors; the legacy `~/.waveterm/memory` root is migrated under the vault on first open. The one item below deliberately **not** done is folding the Memory surface onto the vault read API — memvault's typed projection drives the review/prune/archive UI, and both APIs now read the same bytes from the same roots anyway. The deferral discovered one thing this entry got wrong: coexistence was **not** cheap, because the vault's `memory/` had no writer, so every vault-backed consumer was reading an empty collection. See J6 in `git show a4b5bd4f:docs/jarvis-second-brain-open-issues.md`.

Decided during the A brainstorming (spec in progress: `docs/superpowers/specs/2026-07-23-jarvis-a-wave-vault-*.md`). Sub-project A stands up a **new** git-backed Wave Vault at `~/.waveterm/vault/` (`tasks/`, `decisions/`, `attachments/`, and its own `memory/`). The pre-existing memory vault (`pkg/memvault`, `~/.waveterm/memory`, scanned alongside `~/.claude/projects` + `~/.codex/memories`) and the cockpit **Memory** surface are left **untouched** — two "durable knowledge" roots coexist for now.

- **What's deferred:** unifying the two into one collection. Long-term the vault's `memory/` should be the single durable-knowledge root; v1 does not migrate `~/.waveterm/memory` into the vault, does not repoint `memvault.VaultRoots()`, and does not rewire memvault's consumers (Memory surface, harvest/projection/recall).
- **Why:** subsuming memory pulls a data migration + all of memvault's consumers into A's scope — larger and riskier, and not needed to prove the vault substrate. Coexistence is cheap: `ScanVault` already unifies multiple roots into one wikilink graph, so A's read API can treat the legacy memory root as an extra scan root and cross-collection `[[links]]` still resolve. Markdown is canonical on both sides, so the two are reconcilable later without lock-in.
- **Where it plugs in:** `pkg/memvault` (`VaultRoots`, `DefaultVaultPath`, the `Root{Source:"vault"}` at `~/.waveterm/memory`) and the new `pkg/wavevault` vault-locate/roots. Unification = migrate the legacy memory dir under `~/.waveterm/vault/memory/`, point both packages at one root, and fold the Memory surface onto the vault read API.
- **To resume:** brainstorm/spec the memvault→Wave-Vault unification as its own slice once A/B/C are proven; migrate the memory notes, repoint the scanners, retire the duplicate root.

## Jarvis sub-project G (Plan 4) — ambient attribution ships PLACEHOLDER data (2026-07-23)

Plan 4 wires ambient attribution UI (task tags on Run/Radar/Memory rows + "relevant past decision" cards on their details) onto real objects, but the edges are **fabricated placeholder data**, not real attribution.

- **What's deferred:** the real ambient edges (which task an object belongs to; which past decisions are relevant to it). Plan 4 ships `fixtureAmbientProvider` (`frontend/app/view/agents/ambient.ts`), which derives tags/decisions **deterministically from an oref hash** — believable but fake. Task tags are non-interactive (no Tasks surface exists in v1); relevant-decision cards are marked "placeholder" via a title attribute and surface on ~half of objects.
- **Why:** the real edges come from **attribution engine D (v2)**, which does not exist yet. Shipping the provider seam + a deterministic fixture lets the UI land and be dev/CDP-verifiable now, without blocking on D.
- **Where it plugs in:** the `AmbientProvider` interface in `ambient.ts` (`tagsFor(oref)` / `decisionsFor(oref)`). `ambientviews.tsx` (`AmbientTags` / `RelevantDecisions`) reads it; the surfaces pass an oref (`run:<id>` / `radar:<id>` / `memory:<id>`).
- **To resume:** implement `AmbientProvider` backed by engine D and swap it in behind the interface — the render components and surface wiring stay unchanged.

## Jarvis sub-project F (conversation backend) — model tiering deferred (2026-07-23)

Decided during the F brainstorming (spec in progress: `docs/superpowers/specs/2026-07-23-jarvis-second-brain-meta-spec.md` §F). F ships the real multi-turn, WaveObj-persisted conversation backend, but **model tiering (meta-spec invariant 2) is deferred out of F** — this is the one F-cycle deferral not otherwise tracked, so it lives here.

- **What's deferred:** the two-tier model split (cheap Haiku-class for grunt work + capable Opus/Sonnet for synthesis). F uses a **single (capable) model** for final synthesis via the existing `consult.Run` (headless `claude` CLI) path.
- **Why:** F's only model call is final synthesis — retrieval is deterministic/free. The cheap-tier consumers invariant 2 names don't exist yet: **traversal navigation → sub-project C**, **boundary summaries → sub-project E**, **draft rationale → sub-project B**. Building a two-tier abstraction with only one tier used would be a single-use abstraction (YAGNI). This is deferral, not omission — invariant 2 remains the product mandate.
- **Where it plugs in:** the model-call site in `pkg/jarvisrecall` (today `consult.Run(ctx, spec, cwd, prompt, …)`). A tier selector = choosing the CLI `--model` per call.
- **To resume:** introduce the tier selector **together with the first real cheap-tier consumer** — whichever of C (recall traversal) / E (continuity boundary summaries) lands first. Wire that consumer to the cheap tier and synthesis to the capable tier at the same time, so the abstraction arrives with ≥2 real users.

Not deferred / tracked elsewhere (recorded so a reader isn't left guessing): **continuity (E)** and **attribution (D)** are their own sub-projects with rows in the meta-spec tracking table — F only defines the F⇄E `resume(task)` seam, it doesn't implement continuity. **Attached-scope retrieval** (the `attachedorefs`-passed-but-not-retrieved gap in the Plan 2 shim) **is fixed inside F**, not deferred.

## Net-new improvement scan — un-triaged candidate backlog (2026-07-17)

A four-lane read-only scan (product/UX friction · performance · reliability/correctness · tech-debt/test-gaps)
for improvements **not** already on any backlog. Excluded by construction: the coherence audit
(`git show a4b5bd4f:docs/agents/cockpit-coherence-audit.md` F1–F14), `channels-improvements.md`, `runs-pipeline-known-issues.md`,
every entry below in this file, and the named open threads (Jarvis fan-out v1.1, usage backend parts 2&3,
dual-answer ask, cursor-row composer, new-agent-tab integration). **Nothing here is chosen or built** — this is
a captured menu so the scan need not be re-run. Effort: S (localized FE) / M (FE+wiring or store) / L (backend+FE).

### Theme 1 — "Answer in place" triage flow dead-ends (flagship promise; all confirmed) — SHIPPED 2026-07-17

**Shipped:** T1, T2, T4, C1, C2 (T3 declined). Plan: `git show a4b5bd4f:docs/superpowers/plans/2026-07-17-theme1-triage-flow-hardening.md`.
The T1 stale-draft cleanup runs in the always-mounted `CockpitShell` (`useResetAnswerDraftsOnAskChange`), so
it fires on every surface that answers asks — the cockpit grid AND the Channels `AskRow` — not just the
cockpit.

- **T1. Second ask from the same agent can't be answered in place** — `sentIdsAtom` is only ever added to,
  never cleared anywhere in `frontend/` (`agents.tsx:83,164-166,175`; consumed as a hard lock
  `cockpitsurface.tsx:326`, `channelsprimitives.tsx:114`; `answerbar.tsx:232-247` renders the frozen
  "✓ Answered" instead of the new question). After answering once, that agent's panel is dead for the session
  and submit is silently blocked — forcing a drop into the terminal TUI. **Highest-impact dead-end found.**
  Fix: key `sent`/selections by ask identity, or clear on the agent's `asking → working` transition. Effort M.
- **T2. Answering doesn't advance to the next waiting ask** — the Enter submit branch does no cursor move
  (`usecockpitkeyboard.ts:91-98`; `agents.tsx:161-176`); reaching the next ask is a separate `n` press, and
  there's no mouse "jump to next ask" at all (header "N need you" is static, `cockpitsurface.tsx:370-377`).
  Fix: auto-jump to `nextAskId` on successful submit. Effort S.
- **T3. Mouse single-select fires instantly & irreversibly** — one click injects the answer into the live
  agent with no confirm/undo (`answerbar.tsx:257-271`), while the keyboard path is a guarded two-step
  (`1-9` select, Enter confirm). A stray click sends a wrong instruction to Claude. Fix: require an explicit
  confirm on click too, or a brief undo window. Effort S.
- **T4. Idle reply box silently swallows messages** when the agent's terminal block is gone — the composer
  mounts unconditionally (`idlesection.tsx:60`), `send()` no-ops on missing `blockId` (`agentcomposer.tsx:47-56`)
  and Enter calls it regardless (`:63-71`) while only the button is disabled. Fix: replace the composer with a
  "session ended — Resume to continue" affordance when `blockId == null`. Effort S.
- Two smaller cousins: **new-agent modal advertises ⌘Enter but nothing wires it** (launch is mouse-only;
  `newagentmodal.tsx:625-631`, `modalshell.tsx:34-41` wires only Escape; Task field not autofocused) — Effort S;
  and **cockpit rail "Recent activity" rows are dead `<div>`s** (`cockpitrail.tsx:167-190`) while the Sessions
  feed's equivalent rows are clickable `<button>`s (`sessionssurface.tsx:245-249`) — Effort S.

### Theme 2 — Live-transcript streaming core (one confirmed bug + perf; perf UNMEASURED)

- **S1. Streams never restart after a websocket reconnect (CONFIRMED correctness bug).** Each card opens a
  `StreamAgentTranscriptCommand` with a ~1-year timeout; on a socket drop the client generator neither errors
  nor rejects, so it hangs forever, and reconnect only runs `reannounceRoutes`/`wpsReconnectHandler` — nothing
  restarts streaming RPCs. All live narration/task-chip/git-refresh silently freezes until the surface is
  remounted. Server-side, the request ctx is also `WithTimeout(1 year)` with no per-connection cancel, so the
  `streamTranscript` goroutine + fsnotify watcher leak (one per active card per reconnect).
  Evidence: `wshrpcutil-base.ts:26-72`; `ws.ts:123-152`; `wshrpcutil.ts:26-29`; `livetranscript.ts:22,34-72`;
  `usecardstreams.ts:44-69` (`streamedRef` never reconciled); `transcript.go:139-203`; `wshserver.go:2124-2136`;
  `wshutil/wshrpc.go:334-338`. Fix: on WS reconnect, restart active transcript streams (reconcile `streamedRef`/
  the `streams` map); optionally shorten the timeout with a keepalive or cancel server-side on route disconnect.
  Effort M. (Server-leak half is med-confidence — contingent on no per-connection ctx cancel, none found.)
- **S2. Fleet-wide re-render storm + O(N²) reprojection + unvirtualized narration (perf, code-inferred not
  measured — profile first per measure-before-optimizing).** The stream writes a new whole-map object per chunk
  (`livetranscript.ts:60-61`) and every consumer subscribes to the whole map, not a per-id slice
  (`agentrow.tsx:253-254`, `cockpitsurface.tsx:166-167`, `agentdetailsrail.tsx:55`, `runworkercard.tsx:30-32`);
  `AgentRow` isn't memoized (`agentrow.tsx:159`), no `selectAtom` anywhere. So any chunk re-renders the whole
  surface + every card. The FE also keeps an ever-growing `lines[]` (never trimmed, `livetranscript.ts:48,58`)
  and re-runs full `project(lines)`/`extractTasks` over the entire history on each chunk
  (`transcriptprojection.ts:106-278`) → O(total lines) per chunk. `NarrationTimeline` is unvirtualized,
  `groupTimeline` runs in render with no `useMemo` (`narrationtimeline.tsx:449`), `MarkdownMessage` re-parses
  ReactMarkdown+remarkGfm per render unmemoized (`markdownmessage.tsx:48-77`). Related: a 1s `nowAtom` tick
  re-renders the whole surface and three components each run their own 1s interval writing the same atom
  (`cockpitsurface.tsx:90,99`, `agentdetailsrail.tsx:82`, `usagesurface.tsx:477`); `liveEntriesByIdAtom` is
  never cleared on stream stop (unbounded retention, `livetranscript.ts:75-82`). Fixes cluster: per-id
  subscription (`atomFamily`/`selectAtom`) + memoize `AgentRow`/`MarkdownMessage`; incremental (stateful)
  projection or capped `lines` window; window/cap + `useMemo` the timeline; consolidate/lower the tickers;
  drop stopped ids. Effort M (recommend a CDP/React-DevTools profiler pass on a populated cockpit via
  `scripts/inject-live-agents.mjs` before committing to the refactor).
- **S1/S2 residue (post-implementation, 2026-07-17).** The slice shipped: S1 client stream restart on WS
  reconnect + server-side `WshRpc.CancelRequestsForLink` (reaps the leaked goroutine + fsnotify watcher on
  connection teardown); S2 per-id `atomFamily`/`selectAtom` slices with drop-on-stop, memoized `AgentRow`/
  `MarkdownMessage`/`groupTimeline`, capped narration render (`TIMELINE_RENDER_CAP`) + bounded projection
  window (`MAX_RETAINED_LINES`), and a single always-mounted `NowTicker` replacing three per-surface 1s
  intervals. Two follow-ups remain:

  > **Follow-up 1 RESOLVED 2026-07-20 (`965cea8e`, open-issues backlog #3).** Server: `cancelRequest`
  > now cancels the request context, not just the bool, so a streaming handler's goroutine + fsnotify
  > watcher unwind while the link is still up. Client: the wire cancel is emitted synchronously from an
  > overridden `return()` in `sendRpcCommand` — a `finally`-based cancel would be missed because
  > `gen.return()` hangs and never runs `finally` when the generator is parked at the never-settling
  > await. Race-tested + client vitest (`wshrpcutil-base.test.ts`). Follow-up 2 (stateful projection) was
  > intentionally not built — measure-first, per this entry's own condition.
  - **Per-card-unmount-while-connected still leaks the server watcher.** The client's `gen.return()` on unmount
    sends no wire cancel, and `WshRpc.cancelRequest` only flips a bool (`wshrpc.go:266-277`) without cancelling
    the request ctx — so a card unmounted while the websocket stays up leaks its `streamTranscript` goroutine +
    fsnotify watcher until the connection drops (when `CancelRequestsForLink` reaps it) or the 1-year timeout
    fires. A durable fix needs `cancelRequest` to cancel the ctx AND the client to emit a wire cancel on
    `gen.return()`; that changes shared RPC-cancellation semantics (higher blast radius), so it was left out of
    this slice.
  - **Incremental stateful projection** remains a future option if the capped re-project (`MAX_RETAINED_LINES`
    window, re-run in full per chunk) still profiles hot on a populated cockpit. The cap already makes per-chunk
    cost O(window) not O(session); a stateful projector would make it O(chunk) — worth building only if the
    bounded re-project shows up in a profile.

### Theme 3 — Ask-channel correctness (backend)

> **Resolved 2026-07-17 (theme3-ask-channel-correctness).** Both fixes shipped, TDD'd under `-race`
> (spec via the brief; plan `git show a4b5bd4f:docs/superpowers/plans/2026-07-17-theme3-ask-channel-correctness.md`):
> - **A1** — `Registry.Claim(oref, askid)` (atomic look-up-and-delete) now gates `DeliverAnswer`, so
>   exactly one concurrent caller injects; the loser returns `delivered=false`. `DeliverAnswer(oref, askid,
>   answers)` restores the pending on an encode error (nothing sent) but not on a mid-inject error (partial
>   prefix already sent). The Gatekeeper passes `data.AskId` (double-inject + staleness guard);
>   `AnswerAgentCommand` passes `""` (double-inject guard only). No wire/FE change (A1-b declined).
> - **A2** — a reference-counted `keyedMutex` (`pkg/wshrpc/wshserver/keyedmutex.go`) serializes
>   `spawnRunWorkers` per `runId` across the whole read→spawn→attach, making the `len(WorkerOrefs) > 0`
>   guard effective; `SpawnClaudeWorker` became a `var` seam for the concurrent spawn-once test.

- **A1. `DeliverAnswer` is not atomic and never claims the pending ask** (real, med-high confidence). It does
  `Get` → encode → inject keystrokes but never `Drop`s/claims the entry, which stays "pending" until the
  external clear hook fires `AgentAskClearCommand` later. In that window two deliveries both see `ok=true` and
  both inject a full keystroke sequence into the same picker — concrete trigger: the human answers from the
  panel during the Gatekeeper's `Classify` latency, then `Classify` returns and delivers a second (possibly
  different) selection; simpler trigger: two cockpit sessions, or a double-click. Evidence: `deliver.go:23-41`;
  `agentask.go:41-52` (only Get/Set/Drop, no atomic claim); `wshserver.go:2339-2345,2347-2358`;
  `watcher.go:104,107-116`. Fix: add `Registry.Claim(oref)` (return pending + delete under one lock); deliver
  claims-once so only the first deliverer injects. Effort S.
- **A2. `spawnRunWorkers` read-back-then-attach spans multiple transactions → possible double-spawn of a phase
  worker** (real, low-med confidence — needs a concurrent trigger on one run). The double-spawn guard is
  `len(p.WorkerOrefs) > 0`, persisted only after all spawns complete; the DB serializes single transactions
  (`SetMaxOpenConns(1)`) but not this multi-step sequence, so two concurrent `AdvanceRun`/`CreateRun` calls for
  one run can both see empty `WorkerOrefs` and both spawn. Evidence: `wshserver.go:1523-1544` (called `:1641`,
  `:1743`); `runexec.go:110-125`; `wshutil/wshrpc.go:434-439` (per-RPC goroutine). Fix: spawn+attach inside one
  `UpdateRun` transaction, or a per-run spawn mutex. Effort S–M.

### Theme 4 — Maintainability & test gaps (lower urgency) — PARTIALLY SHIPPED 2026-07-17

**Shipped 2026-07-17 (test-gaps + dedup):** #1 `runactions.test.ts`, #3 `agentcwdresolve.test.ts`, and #6
(one pure `findSessionTermBlock` in `sessionviewmodel.ts`, all 4 sidebar sites routed through it) as the
first tranche; then #2 `pkg/jarvis/watcher_test.go` (extracted pure `askAutoAnswerable`/`optionIndexInRange`
predicates from `handleAsk` and tested them) + `onexit_test.go` (`outcomeSummary`), which Theme 3 A1
unblocked when it landed. All tests mutation-verified (each fails if its guarded behavior regresses).
Spec/plan: `docs/superpowers/{specs,plans}/2026-07-17-theme4-maintainability-testgaps-first-tranche*.md`.
> **RESOLVED 2026-07-20 (`965cea8e`, open-issues backlog #2).** Both splits landed, move-only, call sites
> unchanged: `runbody.tsx` 881→561 (card family → `runcards.tsx`, plan editor → `planpreview.tsx`);
> `agentsviewmodel.ts` 1030→895 (grid geometry → `cardgridlayout.ts` + tests, re-exported so importers are
> untouched).

**Still deferred — #4 (`runbody.tsx` split) and #5 (`agentsviewmodel.ts` grid extract):** the
`theme2-streaming-core` worktree is currently locked/active and edits those exact files; per the Theme 4
brief, these move-only diffs wait until Theme 2 lands to avoid merge conflicts. Also recorded in the spec and
plan (`docs/superpowers/{specs,plans}/2026-07-17-theme4-maintainability-testgaps-first-tranche*.md`).

- **Tech-debt.** `runbody.tsx` was an 846-line god-file bundling ~17 components across unrelated concerns
  (status chrome, review gate + markdown-preview, ask card, cancel flow, blocked/starting states, orchestrator
  fan-out, phase rail, and the live shell) — **RESOLVED 2026-07-20** (`965cea8e`): the card family is now `runcards.tsx`,
  `PlanPreview` is `planpreview.tsx`, and `RunBody` owns only live machinery. `agentsviewmodel.ts` was 933 lines /
  ~70 exports mixing ≥8 concerns (grid geometry, ask encoding, pricing math, formatting, cursor nav, filtering,
  projection) — it is well-tested, so low risk, but the pure grid-layout cluster (`:99-103,824-958`) was cleanly
  extractable into `cardgridlayout.ts` (move its tests) — **RESOLVED 2026-07-20** (grid → `cardgridlayout.ts`, tests moved). `sessionsidebarmodel.ts` copy-pastes the "first `term` block with `cmd:cwd`" session-identity rule 4× (`:55,115,206,235`) — extract one `findSessionTermBlock(tab)` helper.
- **Test gaps** (business-critical logic with no sibling test). `runactions.ts` (run lifecycle — `confirmCancelRun`
  live-worker branch/copy `:108-123`, in-flight `Set` tracking in `stopRunWorker`/`cancelRun`). `pkg/jarvis`:
  `watcher.go` (the Gatekeeper auto-answer-vs-escalate decision + index-bounds guard, `:80-118`) and `onexit.go`
  (`outcomeSummary` pure fn `:67-77`) are the only two untested files in the package. `agentcwdresolve.ts`
  (the block→tail→head cwd precedence + tail-miss-only head read, `:35-62`; the pure `agentCwd` parser is tested,
  the fallback orchestration is not).

**Design briefs (resolved decisions, per theme)** live under `docs/superpowers/briefs/`; a downstream agent
expands each into a formal spec + plan and executes. Status:
- Theme 1 — SHIPPED 2026-07-17 (T1, T2, T4, C1, C2; T3 declined). Brief:
  `git show a4b5bd4f:docs/superpowers/briefs/2026-07-17-theme1-triage-flow-hardening-brief.md`; plan:
  `git show a4b5bd4f:docs/superpowers/plans/2026-07-17-theme1-triage-flow-hardening.md`.
- Theme 2 — `git show a4b5bd4f:docs/superpowers/briefs/2026-07-17-theme2-streaming-core-brief.md` (S1 client+server; S2 full refactor).
- Theme 3 — `git show a4b5bd4f:docs/superpowers/briefs/2026-07-17-theme3-backend-correctness-brief.md` (A1 no-wire-change; A2 guarded). **SHIPPED 2026-07-17.**
- Theme 4 — PARTIALLY SHIPPED 2026-07-17 (#1,#2,#3,#6; #4,#5 deferred pending Theme 2). Brief:
  `git show a4b5bd4f:docs/superpowers/briefs/2026-07-17-theme4-maintainability-testgaps-brief.md`; spec/plan:
  `docs/superpowers/{specs,plans}/2026-07-17-theme4-maintainability-testgaps-first-tranche*.md`.

**To resume any of these:** read the theme's brief (or, for un-briefed themes, this entry) and run the
spec → plan → execute cycle. This entry holds the raw four-lane scan evidence; the briefs hold the resolved
design decisions.

## Arc Environment capability — declined (2026-07-16)

The Arc Environment roadmap (an agent-aware local dev-environment manager: discover services from
project manifests, launch/observe/diagnose them in dependency order, and let agents share the same
infrastructure instead of spawning duplicates) was captured 2026-07-15 as `docs/environment-roadmap.md`
and **decided against 2026-07-16, before any implementation**. Nothing was built — the roadmap was the
only artifact (doc-only commit `4e80bf4f`), now removed to keep the roadmap set honest.

**To revive:** `git show 4e80bf4f:docs/environment-roadmap.md` restores the full product + architecture
design (thesis, data contracts, deterministic detection contract, the 6-phase delivery plan, and the
Windows-local scope bound). Each phase defined its own exit evidence, so it can be picked back up as
written if the need reappears.

## Channel composer attachments — temp-file cleanup + remote-worker paths (2026-07-16)

> **Item 1 (temp-file cleanup) RESOLVED 2026-07-20 (`965cea8e`, open-issues backlog #4).** The periodic
> sweep the deferral named as the alternative is what shipped: `WriteTempFileCommand` now writes under a
> distinct `waveterm-attach-` prefix (a bare `waveterm-*` sweep could delete `/tmp/waveterm-<uid>` socket
> dirs on Linux/macOS), and `SweepTempAttachments` reaps `waveterm-attach-*` dirs older than 24h, wired
> into wavesrv startup + a 4h loop (`pkg/wshrpc/wshserver/wshserver_files.go`). Per-worker lifecycle
> tracking was not needed. Item 2 (remote/WSL paths) remains open.
>
> **Item 2 (remote/WSL paths) retired 2026-09-18.** The composer attachments feature itself was deleted
> — see the "Composer attachments" entry above.

Shipped paste/attach/drag-drop attachments in the Channels composer (spec/plan
`docs/superpowers/{specs,plans}/2026-07-16-channel-composer-attachments*.md`). Two edges deferred:

1. ~~**Temp-file cleanup.**~~ **RESOLVED — see banner above.** Each attachment is persisted via `WriteTempFileCommand`, which `os.MkdirTemp`s a
   fresh dir per file and never deletes it. v1 deliberately does not clean up (the worker may read the file
   any time after send, and lifecycle tracking is out of scope). Over time these accumulate under the OS
   temp dir. **To resume:** track written paths against the run/worker that consumed them and reap on
   worker exit (or a periodic sweep of `waveterm-*` temp dirs older than N days).

2. **Remote / WSL workers can't see local temp paths.** The temp file lands on the wavesrv (local) host;
   an SSH/WSL worktree worker resolves the injected path against *its* filesystem and won't find it. v1 is
   local-scope only (matches the "keep v1 local" principle used across Files/git). **To resume:** route the
   write to `wsh` on the worker's host (same `WriteTempFileCommand`, remote route) and inject the
   remote-side path.

No cross-reload persistence of pending attachments, no image annotation, and no Tauri native file-dialog
plugin were built (all out of scope per the spec's non-goals).

## Channel notes (merged surface) (2026-07-13)

> **Resolved 2026-07-16.** Both follow-ups shipped (design
> `docs/superpowers/specs/2026-07-14-channel-notes-quick-run-design.md`):
> - **Channel notes** — real persisted field at `Channel.Meta["channel:notes"]` via a new
>   `SetChannelNotesCommand` (clone of `SetChannelTierCommand`; empty notes delete the key). The
>   `OverviewStrip` (`channelchrome.tsx`) now renders a controlled, debounced textarea (600ms) seeded per
>   channel; the collapsed strip shows the notes text or "No notes yet". Store action `setChannelNotes`
>   (`channelsstore.ts`) re-fetches so the snapshot-fed rail updates.
> - **Quick Run** — a real one-phase Run object: `RunMode_Quick` + `QuickPlaybook()` (single fresh-ctx
>   execute phase, no gate, no skill) + `BuildQuickPrompt` (bare headless prompt, self-reports via
>   `wsh jarvis complete`). `resolveRunPlan` maps `mode == "quick"` to the quick playbook; FE `@quick`
>   now calls `launchRun(body, {mode:"quick"})` (mirrors `@run`) instead of the ad-hoc dispatch transport,
>   so it gets its own run-strip tab + `Q` badge + Done lifecycle. TDD'd in `pkg/jarvis/run_test.go`.

The merged Channels surface (`docs/superpowers/specs/2026-07-13-channels-runs-merged-surface-design.md`) shows a
"Channel notes" area in its collapsible overview strip, but `waveobj.Channel` has no notes field and no
set-notes RPC exists (backend out of scope for that plan). v1 renders it as a **disabled placeholder**
("Channel notes — coming soon") so the UI is honest.

- **To resume:** add `Channel.meta["channel:notes"]` (or a dedicated field) + a `SetChannelNotesCommand`,
  regenerate types (`task generate`), then wire the notes area in `channelssurface.tsx`'s overview strip
  to a controlled textarea persisting through that RPC.

Also deferred from the same plan: a true one-phase **Quick** backend Run mode. `CreateRunCommand` still
accepts only `pipeline|orchestrator`, so `@quick` maps to the existing dispatch path (`launchAgent` + a
dispatch record) — a bare worker-tab that surfaces in the **Fleet here** rail, not the run strip. A real
one-phase Run object (which would give Quick its own run-strip tab + `Q` badge) is a backend follow-up.

## Backend legacy cleanup — deferred removals (2026-07-13) — RESOLVED 2026-07-17

All three held-back targets were retired by the builder/tsunami retirement (`e568a2b3` +
`53acb8a5` on `main`; design `docs/superpowers/specs/2026-07-16-tsunami-builder-retirement-design.md`):

1. **Tsunami block controller** + `buildercontroller`/`waveapp`/`waveapputil`/`tsunamiutil`/
   `waveappstore` + the aiusechat builder mode + the builder wshrpc surface + `OType_Builder` +
   the `tsunami/` module — removed in full. The widget-app path was retired, not kept
   (`builderMode` was always false in the cockpit).
2. **`WAVETERM_ELECTRONEXECPATH`** / `GetWaveAppElectronExecPath` — removed alongside #1's consumers.
3. **The ten `window:*` / `app:*` config keys** (`window:{zoom,opacity,blur,dimensions,`
   `savelastwindow,fullscreenonlaunch,maxtabcachesize}`, `app:{globalhotkey,confirmquit,tabbar}`)
   — removed after grep-confirming zero readers.

NB (still valid, outlives this deferral): the original plan's "dead" list was **wrong** on
`autoupdate:{enabled,channel}` (read by Go telemetry → wcloud diagnostic ping) and on the
`NumWindows`/`NumTabs` telemetry fields (populated by `DBGetCount` in `main-server`) — those are
live. Grep-verify before removing any config key or telemetry field.

## Repo Radar — "Start investigation" handoff composer (2026-07-11)

> **Resolved / stale — verified shipped 2026-07-14.** The full handoff is wired end-to-end:
> `radarfindingdetail.tsx` `runPrimaryAction()` sets `pendingRunDraftAtom` (`runactions.ts`) →
> the Channels surface (`channelssurface.tsx`) lands it as a reviewable Run draft (editable goal,
> file chips, evidence count, "From Radar finding" badge) and `send()` calls `createRun` only on
> explicit Start. Spec/plan `docs/superpowers/{specs,plans}/2026-07-11-radar-start-investigation-composer*.md`.
>
> **Outcome loop closed (2026-07-16).** The reverse direction (Run → Radar) is now wired too, so
> `RunRadarOrigin` is no longer inert: a Run started from a finding writes a `RadarInvestigation` back onto it
> by fingerprint (create → executing, done, cancel → cancelled via `reporadar.RecordInvestigation`), `reconcile`
> carries it forward across scans, and the finding detail + list surface the outcome ("investigating" /
> "investigated" / "still detected") with a "Dismiss (addressed by run)" affordance — never auto-resolving.
> Spec/plan `docs/superpowers/{specs,plans}/2026-07-16-radar-outcome-loop*.md`.

Deferred while building the **Radar frontend surface** (spec `docs/superpowers/specs/2026-07-10-repo-radar-design.md`
§"Start investigation handoff" + §"Frontend integration"). The Radar surface itself ships complete
(all 8 scan states, findings list/detail, evidence rendering, dismiss/suppress/undo, scan/cancel/retry),
but the finding→Run handoff is **not** wired end-to-end.

- **What's deferred:** the **pending Run composer** in the *Channels* surface. Per spec §370-386,
  "Start investigation" must navigate to Channels and open a *prefilled, reviewable Run draft*
  (report ID, finding ID, fingerprint, suggested mission, affected files, evidence refs, Radar origin
  metadata) that the user edits and explicitly starts. This composer does not exist today: `createRun`
  starts a run **immediately** with no draft/review step. Building the draft-then-review affordance is
  new work in a *different* surface (Channels), so it's split out.
- **What ships in the meantime:** the "Start investigation" action is present in the finding detail but
  does not perform the full handoff. `radarmodel.ts` still builds the Run-draft payload (unit-tested per
  spec §468 — report/finding/fingerprint IDs kept distinct), so the data contract is ready; only the
  Channels consumer is missing. Exact interim behavior (disabled w/ tooltip vs. navigate-to-Channels
  without prefill) is fixed in the Radar frontend design doc.
- **Where it plugs in:** the Channels surface + `createRun` flow. Needs a "pending Run" concept
  (draft persisted or held in FE state) and a composer UI, then Radar's Run-draft payload feeds it.
- **To resume:** brainstorm/spec the pending-Run composer as its own slice, add it to the Channels
  surface, then wire Radar's existing draft payload into it and make "Start investigation" open it.

## Subagent interior view — v1 exclusions (2026-07-09)

Shipped the focused-view subagent interior (click a tree child → its live-tailing transcript swaps
into the center pane), disk-backed by `<parent>/<sessionId>/subagents/agent-*.jsonl`. Spec:
`docs/superpowers/specs/2026-07-09-subagent-interior-view-design.md` §11. Out of scope for v1:

1. **Cockpit-card fan-out badge** (`⑃ N` + peek on `agentrow.tsx`) — the deferred v1 half; brings
   fan-out to the at-a-glance grid. The focused view got the interior; the card grid did not.
2. **Codex subagents** — Codex has no confirmed per-subagent transcript files, so Codex parents show
   no children (graceful degradation). Revisit if/when Codex grows per-subagent files.
3. **Retire the vestigial hook path** — `agenthook.go` subagent deltas + `agentstatusstore`
   reducer/TTL + `baseds.AgentSubagentDelta` are no longer the tree's source (the tree now reads
   `subagentsByIdAtom`). Left dormant; `getSubagentsAtom` is now a dead export. Remove once the
   disk-source path is proven in the field (separate change, its own blast radius).
4. **Deep nesting (depth > 1)** — a subagent that itself fans out is rendered flat, not as a subtree.
5. **Workflow-orchestrated subagents degrade** (surfaced by the Phase 0 spike): 582/606 (96%) of real
   child files correlate by exact prompt-match. The other 24 are Workflow-tool / orchestration
   subagents whose parent transcript has no `Task` tool_use (16) or a substantively-different prompt
   (7). These still appear in the tree and open their interior, but with a **prompt-derived label**
   and a **perpetual "working" dot** (no parent `tool_result` to resolve ✓/✗). A future pass could
   read a terminal signal from the child file itself; a prefix-match was rejected (rescues only 1/24,
   adds collision risk). See `subagentcorrelate.ts` header.

**Update 2026-07-10 (subagent-tree-followups):** items 1, 3, and the state half of 5 shipped
(spec/plan `docs/superpowers/{specs,plans}/2026-07-10-subagent-tree-followups.md`).
- **#1 fan-out badge** — `⑃ N` + hover peek on `agentrow.tsx`, fed by `subagentsByIdAtom` via the
  extracted `useSubagentTracking` hook (also used by the cockpit grid and the Runs surface).
- **#5 done signal** — the backend tail-reads a child's last record (`lastRecordTerminal`) into
  `SubagentFileInfo.Done`; `correlateSubagents` resolves a terminated *orphan* (no parent Task
  `tool_result`) to a new neutral **`done`** state instead of a perpetual "working". Success/failure is
  still only knowable for matched children — `done` is deliberately outcome-neutral.
- **#3 hook path retired** — the rail and Runs orchestrator rows now read the disk store; the
  `AgentSubagentDelta` emission (`wshcmd-agenthook.go` **and** the `wsh agentstatus --subagent-*`
  emitter in `wshcmd-agentstatus.go`), the `agentstatusstore` reducer/TTL/idle-clear, `getSubagentsAtom`,
  and `baseds.AgentSubagentDelta` are deleted. Correction: `getSubagentsAtom` was **not** a dead export
  (it was live in the rail + Runs) — this migrated then removed it.
- **#4 deep nesting — CLOSED (no-go).** 0 nested `subagents/*/subagents` dirs across 619 real child
  files; CC writes a flat layout. Reopen only if a nested child file is observed.
- **#2 Codex subagents — remains no-go** (no per-subagent files).

## Feature-triage residue — prioritization + scoping corrections (2026-07-03)

Reconciled `docs/feature-triage.md` (2026-06-23) against the current tree. Most of that ~13-item
"Add" pile shipped (Channels, Jarvis @agent, Memory + graph, Command Palette, Activity, Sessions &
Resume, Usage, New-Agent launchers, Files accept/reject, **Git Worktrees** inside the New-Agent
launcher). The residual **not-built** items, ranked by leverage:

1. **Multi-answer ask** — **multi-SELECT SHIPPED 2026-07-03; multi-QUESTION SHIPPED 2026-07-09.** Chose the
   live-keystroke-spike path (option (a)). Drove a real CC v2.1.199 multi-select `AskUserQuestion`
   picker under a `node-pty` harness and verified the protocol *by outcome* (CC echoed back exactly the
   toggled labels), including at the real 60ms `KeystrokeDelay`. Protocol (now encoded + commented in
   `encode.go` `encodeMultiSelect`, and TDD'd in `encode_test.go`): unlike single-select (Enter
   confirms immediately), multi-select **Enter toggles** the highlighted checkbox; `ESC[B/[A` navigate;
   after the N options CC appends a "Type something" row (idx N) then a **"Submit"** row (idx N+1);
   Enter on Submit opens a "Ready to submit your answers?" review whose default confirms with **one
   more Enter**. `DeliverAnswer` (panel answers) and the Jarvis actuator are unaffected (the actuator
   only sends single indices). FE was already multi-capable (`toggleSelection`/`buildAskAnswers`/
   `canSubmitAsk`), so single-question multi-select now works end-to-end.
   **Multi-question (2026-07-09):** `EncodeAnswer`'s `len(questions) != 1` guard is gone; the new
   `encodeMultiQuestion` walks the tab bar (`←  ☐ Q1  …  ✔ Submit  →`). Protocol, verified live vs CC
   v2.1.205 with an in-repo PTY harness driving the real `EncodeAnswer` output: each tab starts at
   option 0; a **single-select** confirms *and* auto-advances to the next tab on Enter; a
   **multi-select** toggles on Enter and needs an explicit **Tab** to advance; whichever trailing type
   lands on the Submit tab, it shows a "Ready to submit your answers?" review defaulting to "Submit
   answers", so one final Enter confirms. Both labels echoed back exactly for `[single][multi]` and
   `[multi][single]` batches. FE + `DeliverAnswer` were already multi-question capable.
   **Remaining gap:** ~~free-text ("Type something") answering is still not delivered from the panel.~~
   **RESOLVED — verified shipped 2026-07-14.** Free-text is delivered end-to-end: `answerbar.tsx`
   text input → `buildAskAnswers` (emits `{text}`) → `encode.go` (`encodeSingleQuestion`/`encodeMultiQuestion`
   free-text keys + `validateFreeText`), TDD'd in `encode_test.go`. Only intentional limit: single-line
   printable text (control chars drive the picker).
2. **Sub-agent tree in the cockpit** (M→H) — the one residual item that advances the orchestration
   thesis and undoes a regression (old session sidebar had `SubagentStart`/`SubagentStop` lifecycle;
   the cockpit has zero subagent code). Best "real feature" investment.
3. **Cheap-polish bundle** — smaller and less "cheap" than the triage implied under Tauri:
   - **Open in External Editor:** ~~needs an open-semantics decision before it's buildable.~~
     **RESOLVED — verified shipped 2026-07-14.** Rides the `open_external` Tauri command via
     `getApi().openExternal` (OS default handler), wired in `filessurface.tsx:238` (row click) and
     `:444` ("Open in editor" context-menu item). No `$EDITOR`/`launch-editor` path (Node dead-end
     as noted); the OS-default-handler semantics is the shipped behavior.
   - **Jump-to-bottom pill:** ~~the most self-contained, TDD-able piece of the whole residue.~~
     **RESOLVED — verified shipped 2026-07-14.** `JumpToLatestPill` + `useStickToBottom`
     (`sticktobottom.tsx`) render the "↓ Latest" pill when scrolled up; wired into the narration card
     (`agentrow.tsx:560`) and reused in `subagentinterior.tsx` + `runworkercard.tsx`.
   - Remaining T-items (send-file, terminal path-insert, hover preview) are a later second pass.

**Deferred / skip now:** Light/System theme + editor (cosmetic M, off-thesis — Settings surface
shipped with no theme control), project-wide ripgrep search (generic IDE M), Menu-bar tray (needs a
Tauri-native rewrite).

## Backlog re-verification against the tree (2026-07-02)

A sweep of tracked-but-unverified items (memory notes + `docs/superpowers` plans) against git log
and the current tree. Several items believed "unbuilt/uncommitted" had in fact shipped; the list
below is what remains **genuinely unbuilt** after verification. The working tree was clean at the
time of the sweep, so nothing material is sitting uncommitted.

**Still unbuilt:**

- ~~**Jarvis Gatekeeper v1.1 — make-a-rule + auto-answer countdown.**~~ **DECLINED 2026-07-16 —
  reviewed, not building.** The Gatekeeper tier ships (`6c05ac3f`); v1 was intended as the whole
  trust model — the per-channel toggle is the gate, escalation is the safety valve. Both v1.1 items
  were evidence-gated in the spec and no lived-in evidence justifies either: the countdown is
  net-negative against the unattended thesis (it re-inserts the human into every routine answer), and
  make-a-rule needs proof that asks actually recur. Revive **only** on concrete usage evidence —
  recurring ask classes → make-a-rule (cheap now: the structured-principles profile-patch system is
  its natural store); classifier misfiring → tighten escalate criteria / an allow-deny list, not a
  countdown. Spec: `docs/superpowers/specs/2026-07-01-jarvis-gatekeeper-design.md`.
- ~~**Agents tab auto-fit engine (fit-one-screen).**~~ **OBSOLETE 2026-07-02 — spec superseded by
  the shipped layout.** The demotion/backgrounding half + asks-spotlight shipped
  (`partitionBackgrounded`, `backgroundedsection.tsx`, the `b` key). The remaining density engine
  (`expandedWorkingIds`/`MaxPanels`, the `MaxPanelsControl` control, the asks↔working region divider,
  the flex-share expanded-set) is **un-executable as written**: the 2026-06-23 spec assumes a
  single-column *asks-region → divider → working-region* layout, but the tab (`cockpitsurface.tsx`)
  is now a **2-column card grid** with per-card wide/height prefs and asks interleaved in-place. The
  region divider (§4) is meaningless in a unified grid; the per-row narration budget (§3) conflicts
  with the shipped per-card sizing; §9's "remove the per-row resize grip" never happened (cards still
  resize). The card grid already adapts to count (2-col) and supports demotion; a fresh density
  design against the current grid would be new work, not a re-base. Spec/plan:
  `docs/superpowers/{specs,plans}/2026-06-23-agents-tab-fit-one-screen*.md` (kept for history).
- ~~**Usage daily-series view.**~~ **RESOLVED 2026-07-02 (stale entry — already shipped).** A
  per-provider (claude/codex) daily bar chart with a tokens/spend toggle already renders in
  `usagesurface.tsx` (`DailyChart`, off `stats.daily` / `DailyUsage[]`), shipped in `fdaada6e`
  (2026-06-29) — *before* this sweep. The only per-day data still unsurfaced is a per-**model**
  daily breakdown (the payload folds per-model only into window totals, not per-day); the "daily
  sparkline/bar" this entry called for exists.
- ~~**Codex card task chip.**~~ **RESOLVED 2026-07-02.** Added `extractCodexTasks` to
  `codextranscriptprojection.ts` (latest `update_plan` → `CardTask[]`, `completed` → done) and
  registered it on the `codex` projector in `transcriptregistry.ts`. The card consumer
  (`livetranscript.ts`) already called `projector.extractTasks?.()` generically, so no consumer
  change was needed. Covered by 4 new unit tests in `codextranscriptprojection.test.ts`.
- **Multi-answer ask — server gate.** ~~single single-select only~~ **PARTIALLY RESOLVED 2026-07-03:**
  `encode.go` now supports single-question **multi-select** (verified live vs CC v2.1.199 — see the
  2026-07-03 entry at the top). The `q.MultiSelect` and `len(sel) != 1` guards are gone; the
  `len(questions) != 1` guard (multi-question batches) remains, pending a tab-navigation spike.
  **Stale (noted 2026-09-14):** multi-question batches shipped 2026-07-09 (`4a6efb84`). The one-question
  limit that remains is the Gatekeeper's, not `encode.go`'s — see the 2026-09-14 entry at the top.

**Shipped since the memory notes were written (corrections, not open work):** Jarvis Delegator
fan-out (`f43768d9`), the memory force-graph (`bb4da8a1`), the Agents cursor-row composer
(`agentrow.tsx` — in place, tree clean), rate-limit donut persistence (`ratelimitstore.ts`), and the
Usage token-type (cache-read) split (`usagesurface.tsx`).

**Obsolete (not deferred — un-executable as written):** the Agents-tab motion Phase 2 plan
(`git show edf0132b:docs/superpowers/plans/2026-06-19-agents-tab-motion.md`) targets `askcard.tsx`/`outputpanel.tsx`/
`sessionsidebar.tsx`/`sessionrow.tsx`/`frontend/app/tab/vtab.tsx`, all removed in the cockpit rebuild
+ Phase-5b teardown. The `motion` dep and animations landed via later work (`agentrow.tsx` uses
Reorder/AnimatePresence/layout springs); this specific plan cannot be applied.

## Agent rail "Tokens" — context occupancy, not cumulative (2026-06-26) — RESOLVED 2026-07-01

> **Resolved 2026-07-01 (deferred-token-truth-usage-polish):** the rail's "Tokens" row now shows a
> real whole-file cumulative total for the focused agent, not context occupancy. A thin
> `GetTranscriptTokensCommand` (wshserver) calls `usagestats.SumTranscript`, which reuses the Usage
> surface's Claude/Codex parser + dedupe so the accounting matches. The value loads via
> `tokenstore.ts` (`agentTokensAtom` + `loadTokensForAgent`, with a stale-load guard) from the rail
> effect in `agentdetailsrail.tsx`; a missing/unresolved transcript renders "—". The
> `contextpct × contextmax` occupancy calc and its `DefaultContextMax` fallback are deleted.

Original entry: the Agent details rail's "Tokens" row showed live *context-window occupancy*
(`round(contextpct% × contextmax)`), not cumulative tokens spent, because `AgentUsage` (the
statusLine reporter) carries no token-total field.

## New Agent → Agent tab: dev-mock handoff (2026-06-26)

When a cockpit fixture is loaded (`frontend/tauri/public/cockpit-fixtures/active.json`, dev only),
`agentsAtom`'s base is the static mock, so a launched agent's real roster row never appears there and
the pending "booting" overlay never supersedes to the live transcript. Without a fixture, dev falls
through to the live roster (`devRosterAtom` -> `liveAgentsAtom`) and the handoff works end-to-end.
Verify the launch → terminal → transcript handoff in dev with **no fixture active**, or in a packaged
build / via `scripts/inject-live-agents.mjs`.

Live-CDP finding (2026-06-26): even with no fixture, the boot→transcript auto-swap did not surface in
the dev app. The launch, new-tab roster citizenship, focused booting row, in-layout terminal, and a real
`claude` turn (with token usage) were all confirmed live — but the agent never registered as a roster
row, so the pending overlay never superseded. Cause: the external status reporter resolves `wsh` via
`shutil.which("wsh")` (`agent-status-spike/agent_status_reporter.py`), which is the **packaged Wave's**
`wsh` on PATH; its `wsh agentstatus` call lands in the packaged wavesrv, not the isolated `waveterm-dev`
instance the dev app reads. The supersede + prune logic itself is unit-tested (`agentsviewmodel.test.ts`,
`mergePendingLaunches`). To see the handoff live, run a packaged build (where dev/prod wavesrv coincide),
or point the dev terminal's `wsh` at the dev wavesrv.

## Cockpit card — fabricated data (2026-06-26) — RESOLVED 2026-07-01

> **Resolved 2026-07-01 (cockpit-card-real-data):** both card affordances now render real
> data; the `placeholderDiffStats` / `placeholderTasks` fabricators are deleted.
> - **Card diff stats** are loaded per card by `cardgitstore.ts` (`GitChangesCommand` +
>   `diffStatsFromChanges`), driven off the same rendered set as the transcript stream in
>   `cockpitsurface.tsx`: refreshed on enter, debounced 4s on transcript activity, dropped on
>   leave. A clean/non-repo/unresolvable-cwd worktree drops the id (button hides).
> - **Card task list** is the agent's latest TodoWrite, projected by
>   `transcriptprojection.extractTasks` and streamed into `livetranscript.tasksByIdAtom` from the
>   already-open transcript stream (no new RPC). Claude-only in v1.
> - **Follow-on (Codex tasks):** Codex has no TodoWrite; its `update_plan` tool could feed the same
>   chip via a `codextranscriptprojection` `extractTasks`. Not built — Codex cards stay task-less.

Original entry: the card rendered two affordances (diff stats button, `done/total` task chip +
popover) from deterministic placeholder data seeded off the agent id, because the live `AgentVM`
carried no source for them. See `docs/superpowers/specs/2026-07-01-cockpit-card-real-data-design.md`.

## Usage surface — deferred (2026-06-26)

**Permanent limitations (no honest source — not open TODOs):**
- **Rate-limit window token cap** (handoff "1.34M / 2.2M tok"): there is no faithful *limit* — the
  5h/weekly `%` is Anthropic's opaque server-side number, unrelated to any transcript token sum. The
  cockpit now shows a real *used*-token count with **no denominator** (see the resolved usage-bar
  entry); a "used / limit" ratio would require a cap Anthropic does not publish.
- **Plan-tier badge** (handoff "Max 20×" / "Tier 4"): not carried by the statusLine; the provider
  label is shown without a tier badge. No source to derive it from.

**Resolved 2026-07-01 (deferred-token-truth-usage-polish):**
- **Model-id prettifying** — DONE. `prettyModel` (`modellabel.ts`) turns raw ids into friendly labels
  (e.g. "claude-opus-4-8" → "Opus 4.8"); used in the Usage per-model bar and the rail Model row, with
  the raw id kept as a `title` tooltip. Unknown ids fall through unchanged.
- **Pricing table** — REFRESHED to current-generation rates (`usagepricing.ts`): Fable $10/$50, Opus
  $5/$25, Sonnet $3/$15, Haiku $1/$5, plus the new `fable` family. Caveat: family-substring matching
  loses the version, so a historical Opus-4.0 transcript (billed $15/$75) is priced at the current
  Opus tier — acceptable for an estimate; documented in the code.
- **Scan bound** — OBSOLETE. The `SESSION_READ_CAP`/`USAGE_READ_MAXLINES` text described the old
  frontend scan; the usage scan now runs in the Go backend (`GetUsageStatsCommand` → `usagestats`)
  which walks the transcript roots with no file/line cap.

**Still open:**
- **Codex/OpenAI token breakdown**: the parser handles Codex rollout token totals, but OpenAI has no
  5h/weekly window, so the window bars stay Claude-only and a Codex provider row appears only when
  real data exists for it.

## Files surface — deferred (v1)

- ~~**Codex cwd via tail read:**~~ **RESOLVED 2026-07-02.** `GetAgentTranscriptCommand` gained a
  `fromstart` flag (`readTranscriptHead` in `transcript.go`); `resolveCwd` (`agentcwdresolve.ts`)
  now falls back to a head read when the tail yields no cwd. Agent-agnostic — the head read only
  fires on a tail miss, so Claude keeps its `cd`-drift-correct tail resolution and long Codex
  sessions resolve their first-line `session_meta` cwd. Go test `TestReadTranscriptHead`.
- **Remote worktrees:** git runs on the wavesrv (local) host. SSH/WSL agent worktrees need the
  `GitChanges`/`GitDiff` commands routed to `wsh` on that host (same impl can live on `wsh`).
- ~~**Project picker:**~~ **RESOLVED 2026-07-02.** The Files header picker (`SourcePicker` in
  `filessurface.tsx`) now lists registered projects (from `projectsAtom`) alongside agents; picking a
  project scopes the surface to its registry `path` directly via `loadFilesForProject`
  (`filesstore.ts`) — no agent/transcript needed. The git-load core was extracted to
  `loadChangesForCwd` with a generalized `agent:`/`project:` guard token so switching source cancels
  the in-flight load. Agent picks still write the shared `focusIdAtom` (Agent-tab sync preserved); a
  project pick sets a local override. The empty state now yields only when there are no agents *and*
  no projects.
- **Agent-rail placeholders:** Branch + Files-touched in the Agent details rail (Phase 1b) can now
  be fed by `GitChangesCommand` + `gitstatus.ts`; wiring is a follow-on, not done here.
- **Live visual verification (CDP) deferred:** Task 9 of the plan (CDP screenshot vs the handoff)
  was deferred because a dev app was already bound to `:9222` and shares the `waveterm-dev` data
  home; do the visual pass when that port is free, focusing a real agent (mock roster resolves to
  "Not a git repository").

## Usage-bar token counts (fabricated) — RESOLVED 2026-07-01

> **Resolved 2026-07-01 (deferred-token-truth-usage-polish):** `FAKE_TOKEN_LIMIT` is deleted. The
> 5-hour / Weekly bars now show a **real Claude-only window-used token count** (no denominator — no
> honest ceiling exists) via `GetWindowTokensCommand` + `usagestats.WindowTokens`, summed over the
> Claude transcript root. Each window is anchored to its rate-limit reset: the frontend
> (`windowtokenstore.ts`) computes `windowStart = reset - duration` and falls back to `now - duration`
> when a reset is absent (API-key auth, or not yet reported). Codex bars carry no `used` line (rate
> limits are Claude.ai-specific). The `%` still comes from Anthropic's opaque server number.

Original entry: the usage bars rendered a `used / limit tok` line where `used = pct% × FAKE_TOKEN_LIMIT`
and the ceilings (2.2M / 44M) were hardcoded handoff values, not telemetry — `AgentUsage` carries no
token totals, only `fivehourpct`/`fivehourreset`/`weekpct`/`weekreset`.

## Agent (Focus) surface placeholders (Phase 1b)

> **Resolved 2026-06-26 (agent-rail-toggle):** git Branch + Files-touched (with per-file
> M/+/− status) are now real, sourced from `GitChangesCommand` via `railstore.ts`. cwd resolves
> from the agent's terminal-block `cmd:cwd` meta first (set by `buildLaunchMeta`, so a
> Wave-launched agent resolves its repo *before* its transcript or reporter enrichment exist),
> falling back to the transcript tail — see `agentcwdresolve.ts`; the same shared resolver fixes
> the Files surface for launched agents too. Stop/Resume are now real (ESC interrupt /
> `"continue\r"` nudge via `ControllerInputCommand`), disabled only when the agent has no live
> terminal block. The disabled **Pause** button and the placeholder **suggestion chips** were
> removed. The details rail is now toggleable (default off, `d` key / header button, persisted
> via `atomWithStorage("agent.rail.visible")`).
>
> Still data-gated: **Model** and **Cost** read the reporter-supplied `AgentVM.model` / `AgentUsage`.
> A freshly-launched agent has no `transcriptPath` and no reporter enrichment yet, so those rows show
> "—" until the external status reporter registers it (the dev wsh-routing gap — see the New-Agent
> dev-mock-handoff entry). cwd was recoverable from Wave-owned block meta; model/cost are not.
> **Tokens (total)** is now real regardless of the reporter — a whole-file transcript scan; see the
> resolved "Agent rail Tokens" entry above.

- **What:** the Agent 3-pane focus surface (`frontend/app/view/agents/agentsurface.tsx` +
  `agenttree.tsx` / `agenttranscript.tsx` / `agentdetailsrail.tsx`) renders to full handoff
  parity, but several fields/actions have no backing data and ship as marked placeholders /
  disabled affordances:
  - **git Branch** — left-tree parent subtitle + Details "Branch" row (static `main`).
  - **Files touched + per-file git status (M / + / −)** — static placeholder list in the rail.
  - **Tokens (total)** — RESOLVED 2026-07-01: the Details "Tokens" row now shows a real whole-file
    cumulative total (`GetTranscriptTokensCommand` / `tokenstore.ts`); see the resolved rail-Tokens
    entry above. (Was: derived input tokens from `contextpct × contextmax`.)
  - **Pause / Resume / Stop** — rendered disabled ("coming soon"); `Open terminal` is the only
    live lifecycle action.
  - **Suggestion chips** — footer chips above the composer are static/disabled (no generator).
- **Why deferred:** Phase 1 is "≈ no new backend" (meta-spec §8) — 1b is a pure
  view-composition pass. Git branch/status and an agent-lifecycle control RPC are backend work;
  a suggestion generator is its own feature. The user chose render-everything (placeholders +
  disabled) over omission, for handoff visual parity.
- **Where it plugs in:** git Branch + Files-touched arrive with the **P2 Files** surface (it
  needs git anyway); Pause/Resume/Stop need a lifecycle control RPC (P2/P3); Tokens-total needs
  a usage extension; suggestion chips need a generator. Each placeholder carries a
  `PLACEHOLDER`/`DISABLED` code comment pointing at spec §8.
- **To resume:** when building P2 Files, add a git-worktree info source (branch + per-file
  status) and feed the tree subtitle + Details "Branch" + the Files-touched list; for lifecycle,
  add a control RPC and enable the disabled buttons; replace the static suggestions with a
  real generator. Full detail:
  `docs/superpowers/specs/2026-06-25-cockpit-phase1b-agent-surface-design.md` §8.
- **Deferred:** 2026-06-25, during the cockpit Phase 1b Agent-surface build.

## Command palette (⌘K) — RESOLVED 2026-07-01

> **Resolved 2026-07-01 (command-palette):** shipped as a working `Ctrl+P` overlay
> (`frontend/app/cockpit/command-palette.tsx` + pure matcher `palette-match.ts`). Fuzzy-searches
> live agents (focus), resumable sessions (resume), and commands (surface nav + New agent/project);
> grouped results, arrow/Enter/Esc nav; opened by the app-bar box or global `Ctrl+P` (replaces the
> terminal's readline Ctrl+P, per user). **v1 exclusions:** read-only sessions (no `resumecommand`)
> are hidden so every row is actionable; results are grouped-by-kind, not one global score-sorted
> list. Both are reversible v2 tweaks. Original entry below.

- **What:** the centered search box in the cockpit top app bar — `Search agents, sessions,
  commands…` with a `⌘K` hint badge. Shipped as a **render-only stub**: the box is drawn to
  match the handoff, but clicking it / pressing `Ctrl+K` does nothing.
- **Why deferred:** no palette component exists anywhere in the codebase (grepped — it only
  appears in the handoff mockup). A real searchable command overlay (fuzzy match over
  agents/sessions/commands, keyboard nav, action dispatch) is its own feature, separate from
  the handoff-parity visual pass.
- **Where it plugs in:** the app-bar stub button in `frontend/app/cockpit/` (see the
  cockpit handoff-parity spec). The no-op `onClick` and a global `Ctrl+K` chord would open the
  overlay.
- **To resume:** build a palette overlay (cmdk-style), wire the stub button's `onClick` plus a
  `Ctrl+K` keybinding to open it, and feed it the roster (`model.agentsAtom`), sessions, and a
  command registry.
- **Deferred:** 2026-06-25, during the cockpit handoff-parity pass.

## Cockpit light mode (Paper theme) — 2026-07-03 — DECIDED AGAINST, removed 2026-08-24

The light mode was declined and the code deleted. The `paper` palette entry is gone from `THEMES`
(`frontend/app/view/agents/themes.ts`), along with the now-pointless `ThemeDef.dark` flag and the
`PICKER_THEMES` dark-only filter it existed to drive; the picker, palette commands, and Monaco sync
all read `THEMES` directly. A persisted `paper` preset id falls back to Midnight via
`activePalette`'s unknown-id fallback. The audit work the original entry scoped (hardcoded
light-assumed colors in overlays, scrollbar hexes, `buildThemeVars` greys) is therefore not needed.
The Monaco editor's separate `wave-theme-light` base definition (`monaco-env.ts`) was left alone —
it is editor theming, not cockpit light mode.

## Jarvis sub-project D — attribution tuning constants (2026-07-24)

`pkg/jarvisattrib/edges.go` ships PLACEHOLDER tuning values, to be calibrated against a populated vault before v2 proactive resurfacing trusts hardened edges:
- layer confidence weights: L1=1.0, L2=0.8, L3=0.3
- probation window: 24h (`probationMs`)
- layer-3 time-box (drift decay): 30d (`timeBoxMs`)
- ~~confidence display buckets: weak <0.4, strong ≥0.75~~ — **retired 2026-08-03, not calibrated.**
  `bucketWeakMax` and `bucketStrongMin` were deleted: the display bucket now derives from the edge's
  firing layer (`jarvisattrib.BucketFor`), so there is nothing left to calibrate. They were never
  calibratable — `confidenceFor` returns the max of four fixed layer weights and never blends them, so
  the reachable confidence set is `{0.2, 0.3, 0.8, 1.0}` and no edge could land in the `[0.4, 0.75)`
  "medium" band. See J10 in `git show a4b5bd4f:docs/jarvis-second-brain-open-issues.md`.

## Jarvis U3 — graph edge/node visual tunables (2026-07-27)

`frontend/app/view/jarvis/jarvisgraphderive.ts` (`attributionStyle`) and `jarvisgraph.tsx` ship
PLACEHOLDER visual constants, to be calibrated once a real populated vault is rendered (the current
values were picked to be legible in isolation, not against a dense graph):
- confidence bucket → edge opacity: strong 1.0, medium 0.6, weak 0.35
- confidence bucket → edge width: strong 1.4, medium 1.0, weak 0.7
- `informing` dash pattern: `[3, 3]` (`DASH_INFORMING`)
- run-node square half-extent vs a same-degree circle radius: `RUN_SQUARE_SCALE` = 1.6

Also deferred in U3: search/filter over the graph, a read rail, cross-surface nav out of a node,
live push (the base graph is a snapshot per surface open), and whole-vault attribution — the
attribution bloom is resolved per focused task, never for every dossier at once.

## Jarvis S3 — proactive resurfacing (2026-07-24)

PLACEHOLDER tunables (calibrate against a populated, embedded vault):
- `pkg/jarvisproactive/gate.go`: ~~`queryK = 8`~~ → **`queryKPerCollection = 8` as of 2026-08-03** — the
  window is now per collection, not global. A single global window of this size is filled by the memory
  collection alone on a real vault (406 memory / 14 tasks / 4 decisions), which starved dossiers and
  decisions out of the judge's shortlist entirely; `prefilter` also emits round-robin across
  collections so the crowding cannot reappear at the truncation step (J11). Still unfitted, but the
  score floor and the round-robin now bound what reaches the judge, so k is not what constrains
  admission. `cosThreshold` — **fitted 2026-07-27 to 0.40** (was 0.82, at which the gate admitted
  nothing at all). `shortlistMax = 5` and the `buildJudgePrompt` wording remain PLACEHOLDER.
- `pkg/wshrpc/wshserver/wshserver_runs.go`: `proactiveDispatchTimeout = 90s`.

Deferred out of the S3 first cycle:
- Triggers other than Run dispatch — rest-boundary/continuity resurfacing (would wire E's exposed-but-unwired `jarviscontinuity.Resume`), and conversation-turn resurfacing.
- Global proactive feed / cross-event inbox (card is run-anchored only).
- Ranked lists (single best match only).
- Click-to-open the cited vault node (`vault:<id>` deep-link) — the card is informational this cycle, matching the non-interactive `ambientviews.RelevantDecisions` precedent. U2 (Tasks) and U3 (Graph) have since landed, so the deep-link target now exists and this is the natural next increment.
- An "Ask Jarvis about this" card action.
- Model tiering (interim capable model, shared deferred lever).
- Auto-promotion of a surfaced insight into `memory/**` (v3; stays human-gated).

## Diff surface — narrow-window folding and row density (2026-08-03)

- **Diff surface narrow-window folding and row density declined** (2026-08-03). The Git-review mockup folds the commit pane to a chip below ~1100px, drops the author column, folds the graph to three lanes and turns history into a drawer below 900px, and exposes comfortable 34px / compact 28px rows. Both declined in `docs/superpowers/specs/2026-08-03-git-review-history-reads-design.md` decision 2: the cockpit runs at roughly 1600×950, so every breakpoint would be an untested path, and `historypane.tsx` keeps its single `ROW_H = 34`. Revive only on evidence of a narrow-window user.

**PARTLY RESOLVED 2026-09-11 (`19d324e5`)** — the evidence arrived: the app ships a 1000×700 window (`src-tauri/tauri.conf.json`), where a fixed 460px commit column plus the file list leaves the diff pane about 240px. The commit column now folds to a 44px rail below 1280px (`difflayout.ts`, `historyrail.tsx`), and the fold is manually overridable so a resize cannot undo the user's choice. The rest of the cascade stays declined: no author-column drop, no three-lane graph, no history drawer, and `ROW_H` is still a single 34.

## Jarvis pet — 2D creature (2026-08-04)

PLACEHOLDER tunable (calibrate against a real vault under normal use):
- `frontend/app/view/jarvis/petcondition.ts`: `DRIFT_QUEUE_BAND = 5` — the cleanup-queue depth at which
  the creature reports the vault as drifting (rank 3). Fabricated, not fitted. The reasoning is that a live
  vault always has a note or two flagged and that is tended rather than drifting, so the band is meant to sit
  where the queue stops being something the next Memory visit absorbs in passing. Observed on 2026-08-04: a
  real vault of 438 notes carried a queue of 4, i.e. one below the band — so the band is currently doing its
  job by a single note, which is not evidence that 5 is right. Refit once there is a record of queue depth
  over time.

Deferred out of this cycle:
- ~~**The 3D creature.**~~ **RESOLVED 2026-08-05 (`e3cdfed4`)** — the avatar is now a real WebGL renderer
  (`avatargl.ts`, raw WebGL per design §4 decision 2 — three.js rejected), with a canvas fallback
  (`avatarcanvas.ts`), a shared scene abstraction (`avatarscene.ts`), and a live `webgl | canvas` renderer
  switch in `petview.tsx`, built to JARVIS's documented form (four rounds of taste, four skins of one blob).
  The deferred entry's original reasoning held: the renderer swap changed no logic (all decisions stay in the
  pure `petcondition.ts` / `petvoice.ts` modules). **Replaced 2026-10-06:** the hologram (`avatarscene.ts`,
  `avatarthree.ts`, `avatarcanvas.ts`, `petmotion.ts`, and the `three` dependency) is gone; the creature is now
  Sprout, a pixel pet drawn as SVG cells that walks the footer ledge
  (`docs/superpowers/specs/2026-10-06-jarvis-sprout-pet-design.md`). The decisions still live in
  `petcondition.ts` / `petvoice.ts`; the hologram's design prototypes (`docs/prototype/jarvis-hud-*`) went with it.
- **Concierge-tier courier gestures** — carry/hold/escort, i.e. dragging an object onto the creature to
  pocket it and dragging it back out onto a target. Nothing of this remains in the code: the half-built state
  seam (a `petPocketAtom` with a reader and no writer, plus a Pocket section in `petpeek.tsx` that could never
  render) was removed on 2026-08-04, because unreachable UI cannot be tested, silently rots against the atom
  shape it reads, and reads as shipped. Build the store and the gestures together — the renderer's shape
  depends on the gesture it serves (what the drop target looks like, whether the creature changes shape while
  holding), so guessing at it first is wasted work. Design §6.
- **The higher acting tiers on the creature** (Gatekeeper, Delegator). Those flags are per-channel with no
  client-level equivalent (`pkg/jarvis/resolve.go`), so the creature can only express them while acting on a
  specific channel; design §6 records the resolution and nothing in this cycle acts on a channel.

Resolved rather than deferred, recorded because the fix removed something a reader might try to restore: the
two top corners were dropped on 2026-08-04 (the pet's corners became the bottom pair only). They sat on the
surface heading band — the page title on the left, the header's action buttons on the right. Do not re-add
them without a placement that clears a band whose height varies per surface. Design §9 carries the
measurements. Since 2026-10-06 the creature has no stored corner at all: Sprout walks the footer ledge, and
the bubble and peek open from the half of the window it stands in (`cornerFor` in `petledge.ts`).

## Orchestrator merge queue — one Verify per lane, serialized (2026-09-16)

**Batching the merge queue declined 2026-09-16.** The engine lands one lane at a time and holds the
project checkout from that lane's squash merge through the Verify after it
(`landings.byProject` in `pkg/orchestrate/verify.go`; `AutoMergeReady` returns on the first
`errProjectBusy`). So merges do not overlap Verifies, and on a wide plan the queue, not the work,
sets the wall clock.

Measured on live acceptance runs against a clone of this repo:

- **Acceptance 3** (3 independent tasks, 3 lanes): all three workers were done at 11:07:17, 173s
  after the run was created — and the run did not close until 11:12:46. 329s of the 502s run was
  the queue. The three Verifies ran back to back at 150s + 116s + 72s = 338s.
- **Acceptance 1** (6 tasks, 6 lanes): 762s of the 1199s dag elapsed was merge wait; task t-5 alone
  waited 4m35s to be landed.

Two ways out were considered and both declined:

- **Land every ready lane under one claim, then Verify once.** Would have cut acceptance 3 from
  ~502s to ~320s. Declined because one lane per Verify is what makes `task-verify-failed` and
  `verifyFailedWake` ("Verify failed after merging task X") *true*. Batching turns that into "one of
  these three lanes broke it" and pushes the bisect onto the lead. It also reaches into
  `recordVerifyLocked`, `resumeVerify`, the digest's per-task verify durations, the wake text and the
  frontend timeline — a wide change to buy wall clock on a path that is already correct.
- **Run Verify in its own worktree at the merged commit,** so landing never waits on verifying.
  Keeps per-lane attribution and removes nearly all the wait, but a Verify failure is then found
  after later lanes have already landed on top, which needs a rollback story the engine does not
  have. Revisit as its own chunk if the wait becomes the complaint.

The serialization is the price of per-lane attribution. Revive either option on evidence that a real
plan's wall clock, not its worker time, is what a user is waiting on.

## Dropped from the initiative sheet by the inline tracker (2026-09-16)

The Brief's initiative rows now expand in place (`inlinetracker.ts` / `inlinetrackerview.tsx`) and the
detail sheet's plan section was removed rather than kept in sync with a second copy of the same plan. The
sheet survives as the **initiative activity** escape hatch (every note on every chunk in one stream), which
the inline sidebar deliberately does not show — the sidebar is scoped to one chunk.

Carried over into the inline tracker: per-chunk notes, add note, set chunk status (which covers what
`reopen` did), add chunk, archive, the `wsh effort show` handle.

Deliberately dropped, with nothing left in the code that half-implements them:

- **Stage renaming and per-chunk stage moves** (`StageInput`, `StageHeader`, `StageTag` and the
  `setChunkStage` run-tail edit). A stage is a label on a consecutive run of chunks, so the editor had to
  express "this chunk down to the next boundary", which is a heavier interaction than a one-line inline row
  can hold. `wsh effort` remains the way to restage. `setChunkStage` is still exported from `effortstore.ts`
  and is now unused by the frontend — keep it or delete it with the next effortstore pass, but do not
  re-add a stage editor without deciding where a multi-chunk selection lives first.
- **Per-chunk `owner` and `workrefs`** (the agent/run links under a chunk row). These were two extra lines
  under an expanded chunk in the sheet; the inline row is one line by design and the sidebar is about prose.
  The data is still on `ChunkRowModel`, so restoring them is a render change, not a plumbing one.

Recovery: `git show 6061ff3d:frontend/app/view/jarvis/effortdetailview.tsx` has the full pre-slim file
(746 lines) with all of the above.

## The memory subsystem, removed (2026-09-22)

Measured before removal, across 416 Claude Code sessions and 458 Pi sessions: note **bodies** were opened
in 5.3% of sessions — the behaviour memory actually drove came from the one-line `MEMORY.md` index
entries, not the 867 note bodies behind them. Pi was write-only (Arc regenerated an 87 KB projection per
session start that nothing read: `pi-memory` was not in `~/.pi/agent/settings.json` packages, qmd was not
installed so `memory_search` could not run, and zero real `memory_search` calls appear in 458
transcripts). Recall telemetry had never worked — `slugify` renamed `_`→`-` on harvest so every stamp
missed, and `writeSourcedNote` never serialized `reference_count`.

Removed: `pkg/memvault` (29 files), `pkg/memdistill`, `pkg/memgarden`, `wshserver_memory.go` (17 RPCs),
`reporadar/collect_memory.go` + the `CollectorMemory` kind, `wsh memory`, `wsh agent-memory-hook`,
`wsh agent-memory-project`, the pi memory extension, the Vault surface and its 16 frontend files, the
pet's memory register (decay polling, the `drifting` condition, `actsForVault`, the `memory:activity`
event and its `baseds` payload types), and `CaptureStatus.DistillQueue`.

Kept, deliberately: `pkg/memroots` and `pkg/wavevault` (Jarvis's whole corpus reads through them, and
`memory:vaultpath` is still the vault root's source of truth), `pkg/jarvisrecall` (decoupled — `ask.go`,
`retrieve.go` and `judge.go` never touched memvault), `pkg/agentsync` (the steering projection Pi does
receive), and `agentsync.memoryRegion`, which now only *preserves* an `ARC-MEMORY` block an older Arc
left in a steering file rather than writing one. (2026-09-25: `memoryRegion` is gone too, with the
steering-sync cleanup; the leftover blocks in codex and opencode were deleted by hand.)

Two self-healing cleanups ship with it, because a removed subcommand that is still referenced on disk
keeps firing: the `agent-memory-*` forms stay in `isManagedCommand`'s allowlist (recognition is what lets
a stale hook be *pruned*, not what preserves it), `mergeAgentHooks`/`configIsHealthy` now scan every event
present in `settings.json` rather than only the ones Arc currently manages (`SessionEnd` left
`managedHooks` entirely with `agent-memory-hook`), and `install-agent-hooks` deletes a leftover
`~/.pi/agent/extensions/waveterm-memory.ts`.

Revive only on evidence that note bodies — not index lines — are what changes an agent's behaviour.

Recovery: `git show f5e2179a:pkg/memvault/memvault.go` (and any other path) has the full pre-removal
tree; `git show f5e2179a:frontend/app/view/agents/vaultsurface.tsx` for the surface.

Five agentsync RPCs left with no caller — deleted with the recall arm (2026-09-23); `pkg/agentsync` functions stay.

### The corpus deleted too (2026-09-22), after measuring what still read it

An earlier note here said the vault's `memory/` collection could be deleted because "`tasks/`,
`decisions/` and `attachments/` are Jarvis's corpus." That was wrong: `wavevault.AllScope()` is
`{memory, tasks, decisions}` and `WorkerScope()` is `{memory, decisions}` — `memory` was the only
collection in both, and `jarvisrecall.scopeToVault` returns `AllScope()` on every path.

So the deletion was measured first, against the packaged app's DB rather than the dev profile:

- **Ask Jarvis:** 6 conversations, **8 questions ever**, last on 2026-08-19. 77 grounding cards, 65 of
  them from `memory/`.
- **jarvisproactive** (the automatic consumer, run dispatch): 49 of 88 runs evaluated, **14 hits** —
  13 citing a memory note, 1 a dossier. 26 judge-declined, 6 no-candidates.
- The hits' `why` field was boilerplate in all 14: literally `Related to "<the run goal>"`. Three
  separate runs surfaced the same generic note. One (`project_wave_git_review_scope_decision` on the
  git-review plan) was the real thing the feature exists for.

Decision: usefulness did not match the maintenance cost; a different system gets designed later. All
870 notes deleted from `~/IdeaProjects/obsidian_vault/memory/`. `tasks/` (129), `decisions/` (4),
`steering/`, `skills/` and `attachments/` are untouched — Jarvis still grounds on them, and
`jarvis-vault-recall` still returns cards. `OpenVault` scaffolds the empty `memory/` dir back on open,
so nothing needed repointing.

Recovery is in the **vault** repo, not this one (local-only, no remote):
`git -C ~/IdeaProjects/obsidian_vault show 41047c4:memory/<name>.md`; the deletion is `454938f`.

Still orphaned by all this, not yet cleaned:

- `memroots.AllRoots()` and `memroots.Mirrors()` have no caller outside `memroots` itself;
  `MemoryRoot()` survives only via `migrate.go`.
- Four state files in `%LOCALAPPDATA%\dev.arc.app\data\` have no writer left in the tree:
  `memgarden-state.json`, `memory-distill-queue.json`, `memory-decay-restore-done.txt`,
  `memory-recall-epoch.txt`. They go inert once a build from `main` is installed.
- `jarvisproactive` and the Ask surface — retired 2026-09-23, see "The Jarvis recall arm" below.

### The Jarvis recall arm — retired 2026-09-23

Proactive "related prior work" cards, the Ask surface (the Brief's ask thread, the palette's Ask group,
the Ask Jarvis buttons, the pet's Ask act, `wsh jarvis ask`, pi's `wave_vault_ask`, persisted
conversations) and the embedding index (`pkg/jarvisembed`, attribution layer 4, the Settings Embeddings
section) are deleted. Spec: `docs/superpowers/specs/2026-09-23-retire-jarvis-recall-arm-design.md`.

Evidence, measured 2026-09-23: of 89 runs with a proactive evaluation, 14 hit and one hit was useful;
~14 of 22 agent `wave_vault_ask` calls returned not-found; attribution L4 produced 0 of 352 edges.

Kept: the resume narrative (`jarviscontinuity`), the ledger, attribution L1–3, OpenRouter as the headless
runtime. Its key still lives in the secret `jarvis_embedapikey`, now set from Settings → Headless AI.

Recovery: `git log --diff-filter=D --oneline -- pkg/jarvisrecall pkg/jarvisproactive pkg/jarvisembed`
names the deleting commit; then `git show <commit>^:pkg/jarvisrecall/ask.go` (any path). The table is
recreated by `db/migrations-wstore/000020_drop_jarvisconversation.down.sql`.

Manual cleanup on an existing profile (no code touches user data): delete `data\jarvis\index.db`, the
`jarvis:embedenabled` / `jarvis:embedbaseurl` / `jarvis:embedmodel` lines in `settings.json`, and the
inert `memgarden-state.json`, `memory-distill-queue.json`, `memory-decay-restore-done.txt`,
`memory-recall-epoch.txt` in `data\`.

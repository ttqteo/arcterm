# Kael sync (2026-11-03): small ports: monitors in the Agent tree, the Memory tab, Monaco ligatures

**Verify:** `node scripts/verify.mjs ./pkg/resmon/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs monitor-tasks setup-memory code-diff`

## Context for every task

Port of four small features from the kaeltran16 fork (`kael` remote, `kael/main` at `16b726ffd`). Read a commit
with `git show <hash>`, a file at the fork's tip with `git show kael/main:<path>`. Our tree has diverged, so port the
behaviour into our shape; `git cherry-pick -n` only where it applies cleanly (Tasks 1 to 3 below will not: see
Task 4). Keep the fork's tests (adapted) and its pure-model / thin-view split. The fork's Jarvis pet, avatar and
Brief-layout files are not ours: skip any part of a commit that touches them.

No task changes Go. Verify keeps two Go patterns only because `scripts/verify.mjs` requires at least one; its final
stage is what runs the frontend typecheck and vitest, and `pkg/resmon` owns the shell-task kill the monitor peek's
Stop drives (`ResMonKillShellTaskCommand`).

Rules: Go is the source of truth for wire types; never hand-edit `frontend/types/gotypes.d.ts`,
`frontend/app/store/wshclientapi.ts` or `pkg/wshrpc/wshclient/wshclient.go`. Colors only from `@theme` tokens, motion
only from `frontend/app/element/motiontokens.ts` (`viewFade`, `microFade`) and `frontend/app/element/meter.tsx`
(`widthTween`), UI follows `DESIGN.md`. A new keybinding goes in `frontend/app/store/keybindings/bindings.ts` and
`docs/keyboard-shortcuts.md`. Each task touches only the files on its Files line; where two tasks must edit one file
they are chained by Depends. `CHANGELOG.md` and `docs/hand-checks.md` are written once, by Task 8. Each task that
builds a view, visual state or interaction adds the scenario step that shows it (named in the task), so Final judges
it from a screenshot; a hand-check line is only for what no scenario can show.

### Task 1: The Memory tab works through a backlog
**Depends on:** none

**Files:** `frontend/app/view/agents/memorymodel.ts`, `memorymodel.test.ts`, `memorystore.ts`, `setupmemory.tsx`,
`setupsurface.tsx`, new `pathtail.tsx` (all under `frontend/app/view/agents/`), `frontend/app/store/keybindings/bindings.ts`,
`frontend/app/store/keybindings/store.test.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios.mjs` (the
`setup-memory` scenario only, ~line 55190).

Commit `9fd916309`: Apply and Keep move to the next change still to review; j/k/a/x/u drive the table from the
keyboard; each labelled split group gets a two-click Apply all that applies its open changes one at a time with
progress; the rail lists projects with changes to review first and draws checked projects with an empty index on
one line; kind chips tinted by what the change does (remove, bring in, edit in place); an empty size reads 0 KB;
long paths truncate their folder, not the file name (`pathtail.tsx`, shared with Setup). The fork's scenario edits
are in `scripts/cdp/scenarios-settings.mjs`; ours is `setup-memory` in `scripts/cdp/scenarios.mjs`. Our tree has no
Setup bindings builder: add the Memory table's keys as the fork does, and check that j/k/a/x/u clash with no binding
active on the Setup surface (`buildGlobalBindings`, `buildListNavBindings`); a clash is a test failure in
`store.test.ts`.

**Acceptance:** `npx vitest run frontend/app/view/agents/memorymodel.test.ts frontend/app/store/keybindings/store.test.ts`
passes with the fork's new cases adapted (next-to-review order, Apply-all sequencing and progress, rail order, kind
tint, 0 KB, the j/k/a/x/u bindings and no clash). `setup-memory` gains steps that shoot: the selection moved by `j`
and a change applied by `a`, landing on the next change to review; an Apply all mid-run with its progress; the rail
with a to-review project above a checked one drawn on one line; a long path truncated at its folder.

### Task 2: The Memory tab animates its state changes
**Depends on:** Task 1

**Files:** `frontend/app/view/agents/setupmemory.tsx`, `scripts/cdp/scenarios.mjs` (the `setup-memory` scenario only).

Commit `d71af8f76`: the project pane and change detail fade in with `viewFade` when they switch what they show, the
Check now result note and a row's status fade with `microFade`, and the meters ease their width with `widthTween`
(`frontend/app/element/meter.tsx`; `viewFade` and `microFade` are in `motiontokens.ts`). Respect reduced motion as
those helpers do.

**Acceptance:** with reduced motion on, nothing animates (the helpers return no transition). `setup-memory` gains
steps that switch the selected project and assert the project pane carries the `viewFade` animation, run Check now
and assert the result note carries `microFade`, and read a meter's computed `transition` naming `width`.

### Task 3: Monaco draws the code font's ligatures
**Depends on:** Task 2

**Files:** `frontend/app/view/agents/diffoptions.ts`, `diffoptions.test.ts`, `filetab.tsx`, `filetabdiff.tsx` (under
`frontend/app/view/agents/`), `frontend/app/view/code/codediffview.tsx`, `frontend/app/view/code/codesidepane.tsx`,
`frontend/app/view/codeeditor/codeeditor.tsx`, `scripts/cdp/scenarios.mjs` (the `code-diff` scenario only, ~line
11042). It depends on Task 2 only so the `scenarios.mjs` edits run one after another.

Commit `7bb41e97d`: turn on `fontLigatures` wherever we create a Monaco editor or diff editor with the code font.
Ours has more option sites than the fork's three: every site above that sets `fontFamily: "var(--font-mono)"`. Our
`paneOptions` takes `(split, ignoreWs, wrap)`; the fork's test passes two arguments, so adapt it. Check that the
bundled code font has ligatures; if it has none, say so in the commit and still enable it for a user font that does.

**Acceptance:** `npx vitest run frontend/app/view/agents/diffoptions.test.ts` passes with a case asserting
`fontLigatures: true`; a grep for `var(--font-mono)` under `frontend/app` finds no Monaco options object without
`fontLigatures`. `code-diff` gains a step that reads the mounted diff editor's `fontLigatures` option (Monaco's
`getOption`) and asserts it is on.

### Task 4: Monitor and background-task model
**Depends on:** none

**Files:** `frontend/app/view/agents/transcriptprojection.ts` and its test, new `frontend/app/view/agents/monitortasks.ts`
and `monitortasks.test.ts`, `frontend/app/view/agents/subagentsstore.ts`.

The fork's monitor commits (`a06397716`, `f9a615b6a`) are deltas on ~14 earlier shell-task commits
(`1909f225f..e6717e32d`) and will not cherry-pick: our tree has no `ShellTask`, `shelltasks.ts`, `shelltasksstore.ts`
or `shelltaskpeek.tsx`. Our model is `BackgroundTask` in `transcriptprojection.ts` (`monitor?: true` marks a Claude
Code Monitor; the projection already reads Monitor tool calls, ~line 527), stored per agent in
`backgroundTasksByIdAtom` with `stopBackgroundTask` in `subagentsstore.ts`; today its rows show only in
`agentdetailsrail.tsx` (~line 648). Extend `BackgroundTask`, don't add a second model. Port into it: what
`f9a615b6a` projects beyond what we read now (a monitor's events and status from the transcript), and into
`monitortasks.ts` the pure kind and label helpers of `a06397716` (monitor vs background shell, the row label, the
tail of a task's output). In `subagentsstore.ts` add the peek's state (`monitorPeekAtom`, `{ agentId, taskId } | null`,
cleared when its agent leaves, as the fork's `shellTaskPeekAtom` is) and the output read the peek uses (the fork's
`readShellTaskOutput`, over `RpcApi.GetAgentTranscriptCommand`, which we have).

**Acceptance:** `npx vitest run frontend/app/view/agents/monitortasks.test.ts frontend/app/view/agents/transcriptprojection.test.ts`
passes with the fork's `shelltasks.test.ts` cases for kinds, labels and transcript projection adapted to
`BackgroundTask`. No view changes in this task.

### Task 5: The Events and Output peek for a monitor
**Depends on:** Task 4

**Files:** new `frontend/app/view/agents/backgroundtaskpeek.tsx`.

Commit `b139c36e7` (the fork's `shelltaskpeek.tsx` at `kael/main`): a popover anchored to a task's tree row with an
Events tab (a monitor's events) and an Output tab (the output tail, sticking to the bottom with
`sticktobottom`'s `useStickToBottom`/`JumpToLatestPill`), and Stop through `stopBackgroundTask`. Export
`BackgroundTaskPeek({ model, agentId, task, anchor })`; Task 6 mounts it. It reads and clears `monitorPeekAtom`
(Escape and an outside click close it inside the component; no `bindings.ts` edit).

**Acceptance:** `task check:ts` passes; the views are shot by Task 7's scenario.

### Task 6: Monitor rows in the Agent tree
**Depends on:** Task 4, Task 5

**Files:** `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/agenttreemodel.ts` and
`agenttreemodel.test.ts` (only if the row list is derived there).

Commit `a019e532d`: a row per running monitor and background shell under its agent in the project tree (our tree is
`projectTree` in `agentsidebarmodel.ts`; the agent row reads `backgroundTasksByIdAtom` at `agenttree.tsx` ~line
1032), labelled with Task 4's helpers; clicking one sets `monitorPeekAtom` and mounts `BackgroundTaskPeek` anchored to
it. The rows must not touch the terminal stack: no pane re-parenting or remount, and a click does not change
`focusIdAtom` (AGENTS.md, Agent surface rules).

**Acceptance:** if the row list is derived in a pure model, its test covers order, running-only and the label. The
views are shot by Task 7's scenario.

### Task 7: The `monitor-tasks` scenario
**Depends on:** Task 3, Task 6

**Files:** new `scripts/cdp/scenarios-monitor-tasks.mjs`; `scripts/cdp/scenarios.mjs` only to import it and spread it
into the scenario list, as `scenarios-rail-transcript.mjs` is (~lines 50 and 59239). It depends on Task 3 so the
`scenarios.mjs` edits run one after another.

Commit `798335c28`: scenario `monitor-tasks` (keep the name), adapted to our tree and to a fixture agent whose
transcript holds a Monitor and a background shell. Steps that shoot and assert: the monitor row and the shell row
under their agent in the tree; the peek open on the Events tab, then on the Output tab; and the agent's terminal pane
not remounted by opening the peek (the pane's xterm element is the same node before and after, and `focusIdAtom` is
unchanged).

**Acceptance:** `task verify:ui -- monitor-tasks` passes against a dev app with Tasks 4 to 6 in.

### Task 8: What's new and the hand checks
**Depends on:** Task 1, Task 2, Task 3, Task 7

**Files:** `CHANGELOG.md`, `docs/hand-checks.md`.

One user-facing line per feature under `## Unreleased` in `CHANGELOG.md` (open the section if the top one is dated):
monitors and background shells in the Agent tree with their peek, the Memory tab's backlog flow, its animations, and
Monaco ligatures. In `docs/hand-checks.md`, a `- [ ] (arcterm) Kael sync: …` line only for what the scenarios cannot
show: a real Claude Code Monitor in a live session appearing in the tree and its peek updating as events arrive, and
ligatures visible in a font that has them.

**Acceptance:** the CHANGELOG lines read for a user, not as commit subjects; nothing else changes.

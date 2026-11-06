# Kael sync (2026-11-06): agents and backend fixes, terminal status, snapshot dev

**Verify:** `node scripts/verify.mjs ./pkg/wavevault/... ./pkg/jarvisdossier/... ./pkg/agentsessions/... ./pkg/blockcontroller/... ./pkg/resmon/... ./pkg/wshrpc/... ./pkg/wavebase/... ./cmd/server/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-start-failed agent-streams-offsurface agent-subagents-background modal-focus-home terminal-status-line`

## Context for every task

Port from the kaeltran16 fork (`kael` remote, `kael/main` at `f15fdc695`; the last sync, 2026-11-03, was cut at
`16b726ffd`). Read a commit with `git show <hash>`, a file at the fork's tip with `git show kael/main:<path>`. Our tree
has diverged a lot: almost every fork commit since the last sync conflicts if cherry-picked, so port the behaviour into
our shape; `git cherry-pick -n` only where it applies cleanly. Keep the fork's tests (adapted) and its pure-model /
thin-view split. Differences that matter here:

- The Agent sidebar is one tree per project (`projectTree` in `agentsidebarmodel.ts`); the fork has a separate
  Terminals section. Never port the fork's Terminals section or its placement.
- The fork's "standing by" state for an idle agent with a running shell task (its `shelltasks.ts`, `isStandingBy`) was
  never ported: ours says "standing by" only for a lead (`leadcardmodel.ts`). Don't port it as a side effect.
- We have no Sessions surface (past sessions are centre modes of Agent), no remote-mode phone page
  (`pkg/remotemode/web/static/projectors.js`) and no `pkg/jira`: skip every part of a commit that touches them.
- The fork split its CDP scenarios into `scripts/cdp/scenarios-<area>.mjs` files backed by a 1,078-line
  `scenarios-shared.mjs`; ours keeps most in `scripts/cdp/scenarios.mjs` and loads a few split ones
  (`scenarios-monitor-tasks.mjs` is the model to copy: a default export taking scenarios.mjs's `RT_KIT`, which holds
  `waveService`, `polishWaitFor`, `polishNap` and a few more). **Never port `scenarios-shared.mjs`**: a new scenario
  file takes what the fork imported from it out of `RT_KIT`, and never imports `scenarios.mjs` (it imports them: the
  cycle). A helper the scenario needs that `RT_KIT` lacks (for example `RAIL_VISIBLE_KEY`, which is
  `"agent.rail.visible"` at `scenarios.mjs:15368`) is a local constant in the scenario file, or, when it is a function
  of `scenarios.mjs`, named in the task's report for Task 11 to add to `RT_KIT`. A new scenario goes in its own new file
  named in its task; **only Task 11 edits `scripts/cdp/scenarios.mjs`**, to import and register them and to extend
  `RT_KIT`, so the tasks can run side by side.

Rules: Go is the source of truth for wire types; change the Go and run `task generate`, never hand-edit
`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts` or `pkg/wshrpc/wshclient/wshclient.go`. Colors
only from `@theme` tokens, motion only from `frontend/app/element/motiontokens.ts`, UI follows `DESIGN.md`. The Agent
surface's terminal stack rules in `AGENTS.md` hold: no pane re-parenting or remount. Each task touches only the files
on its Files line; where two tasks must edit one file they are chained by Depends. `CHANGELOG.md` and
`docs/hand-checks.md` are written once, by Task 11. Each task that builds a view, visual state or interaction adds the
scenario that shows it, so Final judges it from a screenshot; a hand-check line is only for what no scenario can show.
Before porting a fix, confirm the bug is in our tree (read our code path); if it is not, say so in the commit and port
only the tests that pin the behaviour. A sibling run (`2026-11-06-kael-sync-surfaces`) also edits `scenarios.mjs`,
`CHANGELOG.md` and `docs/hand-checks.md`; that is resolved when the runs land, not by any task here.

### Task 1: The agent page fixtures the new scenarios share
**Depends on:** none

**Files:** `scripts/cdp/agent-page-fixtures.mjs`, `scripts/cdp/agent-page-fixtures.test.mjs`

Both files are new. Port the fork's `scripts/cdp/agent-page-fixtures.mjs` (`git show kael/main:scripts/cdp/agent-page-fixtures.mjs`,
254 lines) and its test: the transcript line builders (`userText`, `assistantText`, `toolUse`, `toolResult`,
`taskNotification`, `interrupted`, `usage`), `writeTranscript` / `writeSubagent`, and the page helpers (`agentPage`,
`setRoster`, `restoreRoster`, `focusAgent`, `makeQuiet`, `quietUntil`, `makeTab`, `closeTabs`). It imports
`waveService` from the fork's `scenarios-shared.mjs`, which we do not port (Context): each helper that needs it takes
it as a parameter (or the module exports a factory taking `RT_KIT`), never an import of `scenarios.mjs`. Check each
page helper against our tree (the roster atom, the dev mock in `frontend/app/view/agents/`, tab creation) and adapt
what our names differ in; drop a helper that only the fork's Sessions or Jira scenarios use.

**Acceptance:** `npx vitest run scripts/cdp/agent-page-fixtures.test.mjs` passes with the fork's cases for the line
builders and `writeTranscript` / `writeSubagent`; `node -e "import('./scripts/cdp/agent-page-fixtures.mjs')"` loads it
without importing `scenarios.mjs`.

### Task 2: Records with CRLF or a BOM keep their front matter
**Depends on:** none

**Files:** `pkg/wavevault/parse.go`, `pkg/wavevault/parse_test.go`, `pkg/wavevault/region.go`, `pkg/wavevault/region_test.go`, `pkg/wavevault/read_test.go`, `pkg/wavevault/write_test.go`, `pkg/jarvisdossier/decision_test.go`, `pkg/jarvisdossier/dossier_test.go`

Commit `97b6b0cc5`: a CRLF record failed the `"---\n"` front matter match, so its status, objective and id never
loaded, and a status write prepended a second front matter and then tripped the human-region guard. Normalize once at
parse (strip a leading UTF-8 BOM, accept `\r\n` line ends in the front matter fences and keys) and write back in the
file's own line ending, so a CRLF file stays CRLF.

**Acceptance:** `go test ./pkg/wavevault/ ./pkg/jarvisdossier/` passes with the fork's new cases: a CRLF record and a
BOM record parse their front matter; a status write on a CRLF record replaces the front matter (one fence pair) and
keeps CRLF; the region guard accepts it.

### Task 3: The session index reads waiting, sidechains, titles and a recent finish right
**Depends on:** none

**Files:** `pkg/agentsessions/agentsessions.go`, `pkg/agentsessions/agentsessions_test.go`, `pkg/agentsessions/events_test.go`

Commit `19c10635f` (the Go index half of the fork's Sessions review; spec in
`git show kael/main:docs/superpowers/specs/2026-11-04-sessions-review-fixes-design.md`, items F1, F6, F9, F19 under
"Index"): a claude session is `waiting` only while its last `AskUserQuestion` tool_use has no result and no later
user turn; the claude walk skips `subagents` directories and a sidechain file is not a session; `sessionTitle` drops
`effort:<uuid>` tokens and the arcterm preamble lines and takes the first real sentence; the synthetic `finished`
event is dropped at read time. Our Conversation History reads this index, so these fix it. **Ours already skips the
`subagents` directory and drops a file with no task** (`agentsessions.go:198` and `:707`): for that item port only the
fork's tests that pin it; check each of the other three the same way before changing code, and name in the commit
which items changed code and which landed tests only. Skip the fork's `resumeblocker` and pinned sessions
(`f04066674`): they need the fork's `index.go` and Sessions surface.

**Acceptance:** `go test ./pkg/agentsessions/` passes with the fork's new cases for each of the four behaviours.

### Task 4: A refused controller start shows as failed to start
**Depends on:** none

**Files:** `frontend/app/cockpit/cockpit-actions.ts`, `frontend/app/cockpit/cockpit-actions.test.ts`, `frontend/app/view/agents/agentcontrollerstore.ts`, `frontend/app/view/agents/agentcontrollerstore.test.ts`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/agents.tsx`, `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/agentsviewmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/term/termwrap.ts`, `frontend/app/view/term/term-model.ts`, `pkg/blockcontroller/blockcontroller.go`, `scripts/cdp/scenarios-agent-start-failed.mjs`

`agentcontrollerstore.test.ts` and the scenario file are new. Commit `43835037e`: a controller start error from
`ControllerResyncCommand` only reached the console, so the pending launch stayed a booting working row forever,
labelled Unknown. One `resyncController` helper reports the error; the launch's row and the agent header show
"Failed to start" with the error, and the pending launch leaves the working set. Ours has the fork's shape: the
launch/resync path is `resyncController` in `frontend/app/view/term/termwrap.ts` (~line 848), which catches the
`ControllerResyncCommand` error into `console.log`: route it through the helper. `term-model.ts:526` is
`forceRestartController`; route it too only if its error is swallowed the same way (its `await` is not caught there
today, so check its callers). `toolsstore.ts` and `claudeaccount.ts` also call `ControllerResyncCommand`: leave them
alone unless they swallow the same error. `blockcontroller.go` changes only if the fork's commit changes the error
text the row shows.

**Acceptance:** vitest for `agentcontrollerstore.test.ts`, `cockpit-actions.test.ts` and `agentsviewmodel.test.ts`
covers: a rejected resync marks the launch failed with its message and drops it from working. Scenario
`agent-start-failed` (new file, the fork's `scenarios-agent-start-failed.mjs` adapted; `waveService` and
`polishWaitFor` from `RT_KIT`) makes the start refuse the way the fork's does, with a block whose `connection` meta
names a remote (`blockcontroller.go:312` refuses a shell or cmd controller on a non-local connection; a cwd that does
not exist does not refuse, since `shellexec.go` falls back to home), and shoots its tree row and header reading failed
to start, not booting.

### Task 5: The shell owns transcript streams and subagent tracking
**Depends on:** Task 1 (its scenario imports the transcript and page helpers from agent-page-fixtures.mjs), Task 4

**Files:** `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/agentsviewmodel.test.ts`, `frontend/app/view/agents/cockpitshell.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/subagenttracking.ts`, `frontend/app/view/agents/subagenttracking.test.ts`, `frontend/app/view/agents/usecardstreams.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/scenarios-agent-streams.mjs`

`subagenttracking.test.ts` and the scenario file are new. Commit `4ae707e98`: the transcript stream registry
(`livetranscript.ts`) is a per-id singleton, so the Cockpit's `useCardStreams` owned every stream and its unmount
ended them; off the Cockpit, the Agent surface lost Tools used and shell-task chips. Ours has the same shape:
`useCardStreams` and `useSubagentTracking` are called in `cockpitsurface.tsx:150,193`, and `useSubagentTracking` also
in `agenttree.tsx:3608`. Move stream ownership and tracking into the always-mounted shell (`cockpitshell.tsx`), keep a
single caller of each, refresh an agent on entering and when its transcript path changes (`enterRefreshes`), and have
the Cockpit re-read its cards' git on mount. The fork's commit also adjusts its `scenarios-cockpit-card.mjs`; ours keeps
the cockpit-card scenarios in `scenarios.mjs`, which this task may not edit: run `task verify:ui` on the existing
cockpit-card scenarios your change could touch, and name any it breaks, with the fix, in your report for Task 11.

**Acceptance:** `subagenttracking.test.ts` covers `enterRefreshes` (enter, path change, no change). Scenario
`agent-streams-offsurface` (the fork's `scenarios-agent-streams.mjs` adapted, transcript and page helpers from Task 1's
`agent-page-fixtures.mjs`) opens the Cockpit, switches to Agent, and shoots the agent rail's Tools used still filled
after the Cockpit unmounted.

### Task 6: A background subagent ends at its notification, and the handback row is gone
**Depends on:** Task 1 (its scenario imports the transcript builders from agent-page-fixtures.mjs)

**Files:** `frontend/app/view/agents/subagentcorrelate.ts`, `frontend/app/view/agents/subagentcorrelate.test.ts`, `frontend/app/view/agents/transcriptprojection.ts`, `frontend/app/view/agents/transcriptprojection.test.ts`, `pkg/wshrpc/wshserver/transcript.go`, `pkg/wshrpc/wshserver/transcript_test.go`, `scripts/cdp/scenarios-agent-subagents.mjs`

The scenario file is new. Commit `108c9d5fe`. **Ours already keeps a background spawn running past its launch ack:**
`extractSubagentSpawns` (`transcriptprojection.ts` ~line 445) marks a spawn `async` when its `tool_result` starts with
`ASYNC_LAUNCH_RECEIPT`, `resolveState` (`subagentcorrelate.ts` ~line 34) then reads it from its child file only, and
`transcriptprojection.test.ts` (~line 504) pins that. Don't re-port that half; the fork detects the ack by
`toolUseResult.isAsync` / `status: "async_launched"`, which ours never reads: also accept those (a record carrying
them is an ack even when its text differs), and keep the receipt-text check. The real delta: (1) a background spawn
ends at its `<task-notification>` (completed → success, failed → failure), not only at a finished child file, which
today reads the neutral "done"; (2) `projectTranscript` skips `SubagentHandback` tool calls and their results, so the
rail's Tools used, the subagent interior and the Cockpit card lose that plumbing row. Our Go side (`transcript.go`
~line 366, `handbackTool`, `lastRecordTerminal`) already treats a handback's result as the child's end: keep that, and
check its parent-side read does not take the launch ack as a finish either (tests only if it does not). Skip
`916da863d` (standing by takes subagents): see Context.

**Acceptance:** vitest cases: an ack carrying `toolUseResult.isAsync` (no receipt text) leaves the spawn running; a
later completed notification makes it success; a failed one failure; the existing receipt-text case still passes;
`projectTranscript` drops the handback call and its result. Scenario `agent-subagents-background` (fixtures from
Task 1) seeds a transcript with a background spawn, shoots its tree row working after the ack, then appends the
completed notification and shoots it done, and shows the interior without a handback row.

### Task 7: Closing a modal hands focus to the Cockpit's focus home
**Depends on:** Task 5

**Files:** `frontend/app/modals/modalfocus.ts`, `frontend/app/modals/modalfocus.test.ts`, `frontend/app/view/agents/cockpitsurface.tsx`, `scripts/cdp/scenarios-modal-focus-home.mjs`

The scenario file is new. Commit `172fc5360`: a palette pick from the Agent surface to the Cockpit left focus on
`<body>`, so j/k/Enter were dead until a click. **Ours differs:** `takeModalFocus` already falls through when the
previous element is detached or hidden, and `setModalFocusFallback` (`modalfocus.ts` ~line 75, set by
`agentsurface.tsx:431`) supplies a fallback; the fork's patch does not apply as is. Keep that and add the fork's last
step, so the close tries, in order: the previous element, the registered fallback, then the visible
`[data-focus-home]` element; the Cockpit container carries `data-focus-home`. Keep the existing `modalfocus.test.ts`
cases. Limit the attribute to the Cockpit: check whether a palette pick to Jarvis, Diff, Code or Radar leaves the same
dead keys, and name each one that does under Found not fixed in your report, without editing those surfaces.

**Acceptance:** `modalfocus.test.ts` covers the order (previous hidden → fallback; no fallback or it returns null →
`[data-focus-home]`; previous is `<body>`), with the existing cases still passing. Scenario `modal-focus-home` opens
the palette on the Agent surface, picks the Cockpit, presses `j` and shoots the selection moved.

### Task 8: resmon samples each terminal's foreground command and ports
**Depends on:** none

**Files:** `pkg/resmon/group.go`, `pkg/resmon/resmon.go`, `pkg/resmon/sample_other.go`, `pkg/resmon/sample_windows.go`, `pkg/resmon/sample_windows_test.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshrpctypes_resmon.go`, `frontend/types/gotypes.d.ts`, `frontend/app/cockpit/resmon.ts`, `frontend/app/view/agents/terminalstatus.ts`, `frontend/app/view/agents/terminalstatus.test.ts`

`terminalstatus.ts` and its test are new; `gotypes.d.ts` only through `task generate`. Commit `82bd4a83f`, the
sampling and the pure model only (Task 9 draws the row): resmon samples the foreground command and the listening TCP
ports per block. The fork adds `Ports` to `ProcessInfo`, which ours defines in `pkg/wshrpc/wshrpctypes.go` (~line 325),
not `wshrpctypes_resmon.go`. `terminalstatus.ts` derives a terminal row's status line from a sample: the foreground
command with its run time ("npm run dev  38m"), or "idle", and the ports for a chip. On macOS `sample_other.go` may only
reach part of it: the model then yields no status line, never a wrong one.

**Acceptance:** `go test ./pkg/resmon/` covers the command and port sampling on Windows; `terminalstatus.test.ts`
covers the command + age text, idle, the port list, and a partial sample yielding no line.

### Task 9: Each terminal row says what it runs
**Depends on:** Task 5, Task 8 (the row draws the status text terminalstatus.ts derives and the ports resmon samples)

**Files:** `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/scenarios-terminal-status-line.mjs`

The scenario file is new. Commit `82bd4a83f`'s row: each terminal row in the Agent tree gets a second line with a
status dot and Task 8's status text, plus a port chip when its processes listen on TCP. **Do not port** the commit's
second half, the fixed Terminals section pinned to the bottom of the tree: our terminals live in their project's folder
(Context). Tool rows (`tool:id`) and service rows keep their own second line if they have one; check `servicesmodel.ts`
before drawing a second status line on a service. No status line when Task 8's model yields none.

**Acceptance:** Scenario `terminal-status-line` opens a plain terminal running a long command that listens on a port
(a node one-liner) and shoots its row's second line with the command, age and port chip, then an idle terminal's
"idle".

### Task 10: Boot a dev app on a copy of the packaged store
**Depends on:** Task 4

**Files:** `scripts/cdp/snapshot-dev.mjs`, `docs/reference/surface-review.md`, `docs/README.md`, `cmd/server/main-server.go`, `cmd/server/main-server_test.go`, `pkg/wavebase/wavebase.go`, `pkg/blockcontroller/blockcontroller.go`, `pkg/blockcontroller/blockcontroller_test.go`, `pkg/wshrpc/wshserver/wshserver_agentsync.go`, `scripts/cdp/final-verify.mjs`, `Taskfile.yml`

`snapshot-dev.mjs` and `surface-review.md` are new. Commits `1957a7338` and `b988de7cf`: `snapshot-dev.mjs` copies
the packaged arcterm's databases (`VACUUM INTO`), jarvis and memory-hygiene state, config and the vault (without
`.git`) into a fresh `%LOCALAPPDATA%\arc-snap`, then runs `task dev` on it with `ARC_SNAPSHOT=1` on the main dev
ports, refusing while they are taken. The packaged store is `%LOCALAPPDATA%\dev.arc.app\` (data, config); the vault
path comes from its config. Add a `task dev:snapshot` entry.

Under `ARC_SNAPSHOT` (read in `wavebase.go`) wavesrv starts a block's process only when its cwd is inside
`arc-snap\scratch` (the guard in `blockcontroller.go`, which also stops `RestoreLiveAgents` from relaunching a real
one), and skips agent sync (`wshserver_agentsync.go`). Every boot-time gate goes **at its call site in
`cmd/server/main-server.go`**, behind one pure helper (for example `snapshotSkips(name string) bool` over a named list)
so no other file changes. The list, each a call in main-server.go that writes outside the copy, starts processes or
talks to a remote: `runTelebot`, `wavevault.StartSyncLoop`, `harnessupdate.StartLoop`, `reporadar.RecoverInterruptedScans`,
`sessiontrash.StartPurgeLoop`, `wshserver.StartStorage`, `orchestrate.SweepWorktreeRoot` (inside
`tempAttachmentCleanupLoop`), `orchestrate.ResumeInterruptedLeads`, `runpause.ResumeAtBoot`,
`wshserver.ResumeBrainstormSessions`, `orchestrate.StartWatchdog`, `runregulator.Start`, `services.Init`,
`wshserver.StartAgentSleepLoop`, `jarvisvolunteer.StartLooseEndSweep`, `memhygiene.StartSweep`,
`wshserver.StartCouncilRunner`, `wshserver.StartRunQueue`; plus the fork's cleanup-debt retry wherever ours starts it
(`pkg/orchestrate/cleanup.go`): gate it from main-server.go if it starts there, otherwise name it under Found not
fixed. A call left ungated is named in the commit with why it is safe; a gate outside these files is allowed only
when the commit lists it under "Differs from plan" with why. Skip the fork's remote mode and Jira gates, which we lack.

`surface-review.md` is the fork's review procedure (boot a snapshot, walk one surface on real data, write findings as
F1…Fn, then a spec): adapt its paths and surface names to ours and link it from `docs/README.md`. Only Windows needs to
work; on another OS the script says so and exits 3.

**Acceptance:** `go test ./pkg/blockcontroller/` covers the cwd guard (inside scratch starts, outside refuses with a
reason, guard off without `ARC_SNAPSHOT`). `go test ./cmd/server/ -run Snapshot` covers the helper: under snapshot it
skips each listed name, without it none. `node scripts/cdp/snapshot-dev.mjs --dry-run` prints what it would copy and
the ports it checks, without copying. A real boot on the packaged store is out of the run's reach (it needs the
person's install): Task 11 leaves it as a hand check.

### Task 11: Register the scenarios, CHANGELOG, hand checks
**Depends on:** Task 2 (its CHANGELOG line is written only if it changed behaviour), Task 3 (same, per item), Task 4 (registers its scenario file), Task 5 (registers its scenario file; fixes any cockpit-card scenario it reports broken), Task 6 (registers its scenario file), Task 7 (registers its scenario file), Task 9 (registers its scenario file)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

Import each new scenario file (`scenarios-agent-start-failed.mjs`, `scenarios-agent-streams.mjs`,
`scenarios-agent-subagents.mjs`, `scenarios-modal-focus-home.mjs`, `scenarios-terminal-status-line.mjs`) beside
`monitorTasksScenarios` (~line 62) and spread it into the list beside `...monitorTasksScenarios(RT_KIT)` (~line 61737).
Add to `RT_KIT` (~line 52534) any helper a scenario task's report says it needs. Fix each existing cockpit-card
scenario Task 5's report names as broken, as that report says. A node one-liner that imports
`scripts/cdp/scenarios.mjs` and prints the scenario names must list all five.

`CHANGELOG.md`, under the top `## Unreleased` (open one above a dated top section): one user-facing line for each fix
that changed behaviour — read each task's commit, and write none for one that landed tests only: the CRLF records
(Fixed), Conversation History waiting/titles (Fixed, naming only the items Task 3 changed in code), failed-to-start
agents (Fixed), Tools used kept off the Cockpit (Fixed), background subagents ending at their notification (Fixed),
focus after a palette pick (Fixed), the terminal status line (Added, with `<!-- try: … -->` if a global binding opens
the Agent tree) — each with "(from the kaeltran16 fork)" after its bold lead, as earlier syncs wrote it. Snapshot dev
is internal: no CHANGELOG line.

`docs/hand-checks.md`: two `- [ ] (arcterm) Kael sync 11-06: …` lines for what the run cannot reach and a person runs
afterwards: a real `snapshot-dev.mjs` boot on the packaged store (no run resumes, no vault push, a block with a real
cwd refuses to start), which needs the person's install; and the terminal status line on macOS, which needs a Mac.

**Acceptance:** the five scenarios are registered; the CHANGELOG lines match what landed; the two hand-check lines are
in place.

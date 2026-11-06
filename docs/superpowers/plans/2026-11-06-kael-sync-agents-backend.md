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
- The fork split its CDP scenarios into `scripts/cdp/scenarios-<area>.mjs` files; ours keeps most in
  `scripts/cdp/scenarios.mjs` and loads a few split ones (`scenarios-monitor-tasks.mjs` is the model to copy: a default
  export taking scenarios.mjs's `RT_KIT`). A new scenario here goes in its own new file named in its task; **only
  Task 9 edits `scripts/cdp/scenarios.mjs`**, to import and register them, so the tasks can run side by side.

Rules: Go is the source of truth for wire types; change the Go and run `task generate`, never hand-edit
`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts` or `pkg/wshrpc/wshclient/wshclient.go`. Colors
only from `@theme` tokens, motion only from `frontend/app/element/motiontokens.ts`, UI follows `DESIGN.md`. The Agent
surface's terminal stack rules in `AGENTS.md` hold: no pane re-parenting or remount. Each task touches only the files
on its Files line; where two tasks must edit one file they are chained by Depends. `CHANGELOG.md` and
`docs/hand-checks.md` are written once, by Task 9. Each task that builds a view, visual state or interaction adds the
scenario that shows it, so Final judges it from a screenshot; a hand-check line is only for what no scenario can show.
Before porting a fix, confirm the bug is in our tree (read our code path); if it is not, say so in the commit and port
only the tests that pin the behaviour.

### Task 1: Records with CRLF or a BOM keep their front matter
**Depends on:** none

**Files:** `pkg/wavevault/parse.go`, `pkg/wavevault/parse_test.go`, `pkg/wavevault/region.go`, `pkg/wavevault/region_test.go`, `pkg/wavevault/read_test.go`, `pkg/wavevault/write_test.go`, `pkg/jarvisdossier/decision_test.go`, `pkg/jarvisdossier/dossier_test.go`

Commit `97b6b0cc5`: a CRLF record failed the `"---\n"` front matter match, so its status, objective and id never
loaded, and a status write prepended a second front matter and then tripped the human-region guard. Normalize once at
parse (strip a leading UTF-8 BOM, accept `\r\n` line ends in the front matter fences and keys) and write back in the
file's own line ending, so a CRLF file stays CRLF.

**Acceptance:** `go test ./pkg/wavevault/ ./pkg/jarvisdossier/` passes with the fork's new cases: a CRLF record and a
BOM record parse their front matter; a status write on a CRLF record replaces the front matter (one fence pair) and
keeps CRLF; the region guard accepts it.

### Task 2: The session index reads waiting, sidechains, titles and a recent finish right
**Depends on:** none

**Files:** `pkg/agentsessions/agentsessions.go`, `pkg/agentsessions/agentsessions_test.go`, `pkg/agentsessions/events_test.go`

Commit `19c10635f` (the Go index half of the fork's Sessions review; spec in
`git show kael/main:docs/superpowers/specs/2026-11-04-sessions-review-fixes-design.md`, items F1, F6, F9, F19 under
"Index"): a claude session is `waiting` only while its last `AskUserQuestion` tool_use has no result and no later
user turn; the claude walk skips `subagents` directories and a sidechain file is not a session; `sessionTitle` drops
`effort:<uuid>` tokens and the arcterm preamble lines and takes the first real sentence; the synthetic `finished`
event is dropped at read time. Our Conversation History reads this index, so these fix it. Skip the fork's
`resumeblocker` and pinned sessions (`f04066674`): they need the fork's `index.go` and Sessions surface.

**Acceptance:** `go test ./pkg/agentsessions/` passes with the fork's new cases for each of the four behaviours.

### Task 3: A refused controller start shows as failed to start
**Depends on:** none

**Files:** `frontend/app/cockpit/cockpit-actions.ts`, `frontend/app/cockpit/cockpit-actions.test.ts`, `frontend/app/view/agents/agentcontrollerstore.ts`, `frontend/app/view/agents/agentcontrollerstore.test.ts`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/agents.tsx`, `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/agentsviewmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/term/termwrap.ts`, `frontend/app/view/term/term-model.ts`, `pkg/blockcontroller/blockcontroller.go`, `scripts/cdp/scenarios-agent-start-failed.mjs`

`agentcontrollerstore.test.ts` and the scenario file are new. Commit `43835037e`: a controller start error from
`ControllerResyncCommand` only reached the console, so the pending launch stayed a booting working row forever,
labelled Unknown. One `resyncController` helper reports the error; the launch's row and the agent header show
"Failed to start" with the error, and the pending launch leaves the working set. Ours calls `ControllerResyncCommand`
from `term-model.ts:526` (not `termwrap.ts` as in the fork), `toolsstore.ts` and `claudeaccount.ts`: route the
agent-launch path through the helper; leave the tools and account callers alone unless they swallow the same error.

**Acceptance:** vitest for `agentcontrollerstore.test.ts`, `cockpit-actions.test.ts` and `agentsviewmodel.test.ts`
covers: a rejected resync marks the launch failed with its message and drops it from working. Scenario
`agent-start-failed` (new file, the fork's `scenarios-agent-start-failed.mjs` adapted) launches an agent whose cwd does
not exist and shoots its tree row and header reading failed to start, not booting.

### Task 4: The shell owns transcript streams and subagent tracking
**Depends on:** Task 3

**Files:** `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/agentsviewmodel.test.ts`, `frontend/app/view/agents/cockpitshell.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/subagenttracking.ts`, `frontend/app/view/agents/subagenttracking.test.ts`, `frontend/app/view/agents/usecardstreams.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/scenarios-agent-streams.mjs`

`subagenttracking.test.ts` and the scenario file are new. Commit `4ae707e98`: the transcript stream registry
(`livetranscript.ts`) is a per-id singleton, so the Cockpit's `useCardStreams` owned every stream and its unmount
ended them; off the Cockpit, the Agent surface lost Tools used and shell-task chips. Ours has the same shape:
`useCardStreams` and `useSubagentTracking` are called in `cockpitsurface.tsx:150,193`, and `useSubagentTracking` also
in `agenttree.tsx:3608`. Move stream ownership and tracking into the always-mounted shell (`cockpitshell.tsx`), keep a
single caller of each, refresh an agent on entering and when its transcript path changes (`enterRefreshes`), and have
the Cockpit re-read its cards' git on mount.

**Acceptance:** `subagenttracking.test.ts` covers `enterRefreshes` (enter, path change, no change). Scenario
`agent-streams-offsurface` opens the Cockpit, switches to Agent, and shoots the agent rail's Tools used still filled
after the Cockpit unmounted.

### Task 5: A background subagent runs until its notification, and the handback row is gone
**Depends on:** none

**Files:** `frontend/app/view/agents/subagentcorrelate.ts`, `frontend/app/view/agents/subagentcorrelate.test.ts`, `frontend/app/view/agents/transcriptprojection.ts`, `frontend/app/view/agents/transcriptprojection.test.ts`, `pkg/wshrpc/wshserver/transcript.go`, `pkg/wshrpc/wshserver/transcript_test.go`, `scripts/cdp/scenarios-agent-subagents.mjs`

The scenario file is new. Commit `108c9d5fe`: a background spawn's `tool_result` is only the async launch ack
(`toolUseResult.isAsync` or `status: "async_launched"`), so `extractSubagentSpawns` marked it done at once and the tree
read it as a success while it still ran. A background spawn now stays running until its completed or failed
notification arrives. `projectTranscript` skips `SubagentHandback` tool calls and their results (the rail's Tools used,
the subagent interior and the Cockpit card lose that plumbing row). Our Go side (`transcript.go:366`, `handbackTool`,
`lastRecordTerminal`) already treats a handback's result as the child's end: keep that, and check its parent-side read
does not take the launch ack as a finish either. Skip `916da863d` (standing by takes subagents): see Context.

**Acceptance:** vitest cases: an async launch ack leaves the spawn running; a later completed notification finishes
it; a failed one fails it; `projectTranscript` drops the handback call and result. Scenario
`agent-subagents-background` seeds a transcript with a background spawn, shoots its tree row working after the ack,
then appends the completed notification and shoots it done, and shows the interior without a handback row.

### Task 6: Closing a modal hands focus to the surface's focus home
**Depends on:** Task 4

**Files:** `frontend/app/modals/modalfocus.ts`, `frontend/app/modals/modalfocus.test.ts`, `frontend/app/view/agents/cockpitsurface.tsx`, `scripts/cdp/scenarios-modal-focus-home.mjs`

The scenario file is new. Commit `172fc5360`: a palette pick from the Agent surface to the Cockpit left focus on
`<body>`, so j/k/Enter were dead until a click. `takeModalFocus` falls through when the previous element did not take
focus, blurs the panel as before, then focuses the visible `[data-focus-home]` element; the Cockpit container carries
`data-focus-home`. Check the other surfaces a palette pick can land on (Jarvis, Diff, Code, Radar): give each the
attribute on its list container if the same dead-key bug shows there, and say which in the commit.

**Acceptance:** `modalfocus.test.ts` covers the fall-through (previous element hidden, previous is `<body>`).
Scenario `modal-focus-home` opens the palette on the Agent surface, picks the Cockpit, presses `j` and shoots the
selection moved.

### Task 7: Each terminal row says what it runs
**Depends on:** Task 4

**Files:** `pkg/resmon/group.go`, `pkg/resmon/resmon.go`, `pkg/resmon/sample_other.go`, `pkg/resmon/sample_windows.go`, `pkg/resmon/sample_windows_test.go`, `pkg/wshrpc/wshrpctypes_resmon.go`, `frontend/types/gotypes.d.ts`, `frontend/app/cockpit/resmon.ts`, `frontend/app/view/agents/terminalstatus.ts`, `frontend/app/view/agents/terminalstatus.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/scenarios-terminal-status-line.mjs`

`terminalstatus.ts`, its test and the scenario file are new; `gotypes.d.ts` only through `task generate`. Commit
`82bd4a83f`, its first half only: each terminal row in the Agent tree gets a second line with a status dot and the
foreground command with its run time ("npm run dev  38m"), or "idle", plus a port chip when its processes listen on
TCP; resmon samples the foreground command and listening ports per block. **Do not port** the second half, the fixed
Terminals section pinned to the bottom of the tree: our terminals live in their project's folder (Context). Tool rows
(`tool:id`) and service rows keep their own second line if they have one; check `servicesmodel.ts` before drawing a
second status line on a service. On macOS `sample_other.go` may only reach part of it: degrade to no second line, not a
wrong one.

**Acceptance:** `go test ./pkg/resmon/` and `terminalstatus.test.ts` cover the command + age text, idle, and the port
chip. Scenario `terminal-status-line` opens a plain terminal running a long command that listens on a port (a node
one-liner) and shoots its row's second line with the command, age and port chip, then an idle terminal's "idle".

### Task 8: Boot a dev app on a copy of the packaged store
**Depends on:** Task 3

**Files:** `scripts/cdp/snapshot-dev.mjs`, `docs/reference/surface-review.md`, `docs/README.md`, `cmd/server/main-server.go`, `pkg/wavebase/wavebase.go`, `pkg/blockcontroller/blockcontroller.go`, `pkg/blockcontroller/blockcontroller_test.go`, `pkg/wshrpc/wshserver/wshserver_agentsync.go`, `scripts/cdp/final-verify.mjs`, `Taskfile.yml`

`snapshot-dev.mjs` and `surface-review.md` are new. Commits `1957a7338` and `b988de7cf`: `snapshot-dev.mjs` copies
the packaged arcterm's databases (`VACUUM INTO`), jarvis and memory-hygiene state, config and the vault (without
`.git`) into a fresh `%LOCALAPPDATA%\arc-snap`, then runs `task dev` on it with `ARC_SNAPSHOT=1` on the main dev
ports, refusing while they are taken. Under `ARC_SNAPSHOT` wavesrv skips every boot-time sweep and resume that could
act on the user's real checkouts or remotes (the fork's list: cleanup-debt retry, vault sync, run and brainstorm
resume, the watchdog, the loose-end and memory-hygiene sweeps, agent sync; skip its remote mode and Jira, which we
lack) and starts a block's process only when its cwd is inside `arc-snap\scratch`. **Ours has more boot-time work than
the fork:** enumerate `cmd/server/main-server.go`'s startup goroutines (councils, `pkg/services`, radar, the job
queue, workflow scan, effort reminders…) and gate each one that writes outside the snapshot or starts processes; a
gate in a file not on the Files line is allowed only when the commit lists it under "Differs from plan" with why. The
packaged store is `%LOCALAPPDATA%\dev.arc.app\` (data, config); the vault path comes from its config. Add a
`task dev:snapshot` entry. `surface-review.md` is the fork's review procedure (boot a snapshot, walk one surface on
real data, write findings as F1…Fn, then a spec): adapt its paths and surface names to ours and link it from
`docs/README.md`. Only Windows needs to work; on another OS the script says so and exits 3.

**Acceptance:** `go test ./pkg/blockcontroller/` covers the cwd guard (inside scratch starts, outside refuses with a
reason). `node scripts/cdp/snapshot-dev.mjs --dry-run` prints what it would copy and the ports it checks, without
copying. A hand check (Task 9) covers a real snapshot boot.

### Task 9: Register the scenarios, CHANGELOG, hand checks
**Depends on:** Task 1 (its CHANGELOG line describes the fix it lands), Task 2 (its CHANGELOG line describes the fix it lands), Task 5 (registers the scenario file it adds), Task 6 (registers the scenario file it adds), Task 7 (registers the scenario file it adds), Task 8 (its hand-check line covers the script it adds)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

Import each new scenario file (`scenarios-agent-start-failed.mjs`, `scenarios-agent-streams.mjs`,
`scenarios-agent-subagents.mjs`, `scenarios-modal-focus-home.mjs`, `scenarios-terminal-status-line.mjs`) beside
`monitorTasksScenarios` (~line 62) and spread it into the list beside `...monitorTasksScenarios(RT_KIT)` (~line 61737).
A node one-liner that imports `scripts/cdp/scenarios.mjs` and prints the scenario names must list all five.

`CHANGELOG.md`, under the top `## Unreleased` (open one above a dated top section): one user-facing line each for the
CRLF records (Fixed), Conversation History waiting/titles (Fixed), failed-to-start agents (Fixed), Tools used kept off
the Cockpit (Fixed), background subagents (Fixed), focus after a palette pick (Fixed), the terminal status line
(Added, with `<!-- try: … -->` if a global binding opens the Agent tree) — each with "(from the kaeltran16 fork)" after
its bold lead, as earlier syncs wrote it. Snapshot dev is internal: no CHANGELOG line. `docs/hand-checks.md`: `- [ ] (arcterm) Kael sync
11-06: …` lines for a real `snapshot-dev.mjs` boot on the packaged store (no run resumes, no vault push, a block with a
real cwd refuses to start) and the terminal status line on macOS.

**Acceptance:** the five scenarios are registered; the CHANGELOG and hand-check lines are in place.

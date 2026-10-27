# Port Kael's Brainstorm mode implementation plan

**Verify:** `node scripts/verify.mjs ./pkg/brainstormcheck ./pkg/orchestrate ./pkg/jarvis ./pkg/jarvisstate ./pkg/council ./pkg/wstore ./pkg/waveobj ./pkg/wps ./pkg/tsgen ./pkg/wshrpc/... ./cmd/wsh/cmd ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs brainstorm-mode brainstorm-main brainstorm-question-reasons brainstorm-review-skim brainstorm-rail-reasons brainstorm-new-findings brainstorm-check-review brainstorm-builder-ask brainstorm-builder-check brainstorm-builder-tree brainstorm-judge-wait brainstorm-judged-question brainstorm-judge-tree brainstorm-run-blocked brainstorm-run-landed brainstorm-run-missing brainstorm-approve-run brainstorm-hints agent-rail-no-ideas council-ask council-summary council-tree`

## Goal and scope

Port Brainstorm mode from Kael's fork (`kaeltran16/waveterm`, remote `kael`) onto main as it stands at Kael's commit
**`1aa149b10`**, and remove main's Ideas feature, which Brainstorm mode replaces (the person's call, 2026-10-27).

Brainstorm mode: when an agent runs `superpowers:brainstorming`, Arc draws the brainstorm on the Agent surface in place
of the terminal (one question at a time with an answer box, the design's parts as they form, mockups beside their
parts), a blind Opus **judge** weighs the approaches of an approach question, a fresh **builder check** reads the spec
and returns the questions only the user can answer, and Approve opens + New run prefilled. The whole behaviour is
specified by Kael's own docs, which are the spec for this port; read them first, at the pinned commit:

- `git show 1aa149b10:docs/agents/brainstorm.md` — how the pieces fit, every line each action sends, where the code is,
  how to test it. **This is the acceptance reference.**
- `git show 1aa149b10:docs/superpowers/specs/2026-10-18-brainstorm-mode-design.md`
- `git show 1aa149b10:docs/superpowers/specs/2026-10-22-brainstorm-builder-check-reviewer-design.md`
- `git show 1aa149b10:docs/superpowers/specs/2026-10-23-unbiased-approach-questions-design.md`
- `git show 1aa149b10:docs/superpowers/specs/2026-10-26-brainstorm-pane-interaction-design.md`
- `git show 1aa149b10:skills/brainstorm/SKILL.md` — the agent's half of the protocol.

Always read Kael's code at the pinned commit `1aa149b10`, never `kael/main` (a later fetch moves it).

### Out of scope

- Kael's **approved-design run flow** (`7407220b8`, `54622910e`, `56c23470b`, `fcfb6abda`, `designroute.ts`,
  `runlauncher.tsx`'s Kael changes, `newruncontrol.tsx`'s Approved design start). At `1aa149b10` `brainstormsend.ts`
  routes Approve through `designroute.ts`; port the **Approve behaviour of `7407220b8^`** instead: send
  `brainstorm: approved`, then open main's New launcher prefilled (orchestrator, the agent's project, a goal naming the
  spec's absolute path, the first mockup board as prototype) through main's `openLauncher(model, "run", prefill)`
  (`frontend/app/view/agents/launcherstore.ts`, which runs main's `prefillToLaunch` in
  `frontend/app/view/jarvis/newrun.ts`), and send `brainstorm: run <id>` when the run starts.
- Kael's **desktop popup** (`frontend/tauri/popup.tsx`, `attentionpopup.ts`, `attentionpopuptarget.ts`,
  `bubblecard.tsx`). Main has no popup window: `attentionpoller.tsx` flashes the taskbar button for a new attention
  item while Arc is not focused. Port the brainstorm part of `2e92db78b` / `6fd649cfd`'s `attentionpoller.tsx` hunks
  onto that: an asking brainstorm joins the outward attention list, so a new question flashes the taskbar.
- Kael's Radar retirement, Workflow scan, Sessions search, Diff comments and engine fixes: other ports, not this one.
- Kael's `agenttree.tsx` / `agenttreemodel.ts` rewrite. Main's Agent sidebar is one tree per project (`projectTree` in
  `frontend/app/view/agents/agentsidebarmodel.ts`, drawn by `agenttree.tsx`); add Kael's brainstorm rows, chip and
  nesting to main's tree, do not replace main's tree with Kael's.
- Two things named "Ideas" are **not** the Ideas feature and stay: the Brief's Ideas column (initiatives with no chunks
  yet: `briefsurface.tsx`, `briefrowviews.tsx`, `jarvistourcontent.ts`) and a council's "Ideas so far" / "Ideas"
  labels in `councildiscussion.tsx` and the council Brainstorm format's text (`councilsetupmodel.ts`,
  `councilsummary.tsx`'s header comment).

## How to port (every task)

- **New files** (Kael has them, main does not): take them as they are at `1aa149b10`
  (`git show 1aa149b10:<path> > <path>`), then fix imports and calls to match main. Keep Kael's tests and make them pass.
- **Host files** (both sides have them; they differ a lot): never copy Kael's whole file. Read the brainstorm hunks of
  the Kael commits the task lists (`git show <commit> -- <path>`) and re-apply those hunks to main's version of the
  file, in main's idiom. `git log --oneline 1aa149b10 -- <path>` lists every Kael commit for a path.
- **Generated files** (`wshclientapi.ts`, `gotypes.d.ts`, `waveevent.d.ts`, `wshclient.go`, `metaconsts.go`): never
  copy or hand-edit; change the Go source, then `task generate`. Only Tasks 1 and 8 change wire types, and Task 8
  waits on Task 1 (through Tasks 4 and 6), so no two tasks regenerate at the same time.
- `skills/brainstorm/SKILL.md` is the source; the mod copy under `cmd/wsh/cmd/claude-mod/skills/` is generated by the
  build. Never edit it.
- Keep main's behaviour everywhere this plan does not change it. Where a Kael hunk relies on something main lacks,
  port the smallest piece that hunk needs and say so in the commit message.
- Text the user sees stays as Kael wrote it (English, plain words).
- A task's live check is the scenario steps its **Acceptance** names. They are written in Task 9 (the scenario
  helpers arrive there, except Task 8's own scenario) and run by Final, which starts its own dev app. A task never
  checks itself with `task verify:ui` against the person's dev app on CDP `:9222`; a scenario a task runs itself goes
  through `node scripts/cdp/final-verify.mjs <names>`.

### Task 1: Wire foundations: the prompt delivery RPC, the brainstorm RPC declarations, the judging-session launcher, run-agent marker, tab meta keys

**Depends on:** none

Kael commits: `cc8243219` (`AgentPromptCommand`), `5a24ae0ea` (exported `LaunchJudgingSession` /
`JudgingSessionLost`), the `pkg/jarvis/runexec.go` part of `6fd649cfd` (`RunAgentEnv`, `ARC_RUN_AGENT=1` on every agent
a run launches), the `pkg/waveobj/wtypemeta.go` parts of `c8cc4f3dc`, `68f515252` and `f0fda796b` (`session:brainstorm`
and every `brainstorm:*` tab meta key: check and judge state, ts, run, channel, reason), the `pkg/jarvis/usage.go`
parts of `68f515252`, `37179fd5f` and `853e3b468` (the usage roles `builder-check` and `brainstorm-judge`, and
`IsBrainstormSession`), and the `pkg/wstore/wstore_channel.go` part of `f43f80e38`.

This task also **declares every brainstorm wire type**, so the frontend tasks typecheck before Task 4 fills the
server in: the four commands of `1aa149b10`'s `pkg/wshrpc/wshrpctypes_agents.go` (`BrainstormCheckCommand`,
`BrainstormJudgeCommand`, `BrainstormJudgeStopCommand`, `BrainstormCheckTimesCommand`) with their data types
(`CommandBrainstormCheckData`, `CommandBrainstormJudgeData`, `CommandBrainstormJudgeStopData`,
`BrainstormCheckTimes`), and a `pkg/wshrpc/wshserver/wshserver_brainstorm.go` holding one stub handler per command that
returns an error naming the command as not yet wired. Task 4 replaces the stubs; it changes no wire type.

**Files:**
- Modify: `pkg/wshrpc/wshrpctypes_agents.go` (`AgentPromptCommand` and the four brainstorm commands with their types),
  `pkg/wshrpc/wshserver/wshserver_agentmsg.go` (+ `wshserver_agentmsg_test.go`)
- Create: `pkg/wshrpc/wshserver/wshserver_brainstorm.go` (the four stubs)
- Modify: `pkg/orchestrate/stagesession.go` (+ `stagesession_test.go`): export the dag-free launcher and liveness
  check main's `spawnStageSession` / `stageSessionLost` already hold, without changing how a run's stages behave
- Modify: `pkg/jarvis/runexec.go` (+ `runexec_test.go`), `pkg/jarvis/usage.go` (+ `usage_test.go`)
- Modify: `pkg/waveobj/wtypemeta.go`, `pkg/wstore/wstore_channel.go` (+ test)
- Regenerate: `task generate`

**Steps:**
1. Port each commit's tests first; run them and see them fail
   (`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/orchestrate -run 'StageSession|JudgingSession'`,
   and the same prefix with `./pkg/jarvis -run 'RunAgentEnv|Usage|IsBrainstorm'`, `./pkg/wshrpc/wshserver -run AgentPrompt`,
   `./pkg/wstore -run Channel`).
2. Port the code and declare the brainstorm commands with their stubs; `task generate`; the tests pass;
   `go build ./...` passes; `frontend/app/store/wshclientapi.ts` has all four `Brainstorm*Command` functions.
3. Commit: `feat(brainstorm): prompt delivery RPC, brainstorm RPC declarations, judging-session launcher, run-agent marker and brainstorm tab keys`.

**Acceptance:** server and wire only; no UI. The Go tests above and `go build ./...` show it.

### Task 2: The skill and the skills list

**Depends on:** none

Kael commits: `e5032faab` and every later commit to `skills/brainstorm/SKILL.md` (take the file as it is at
`1aa149b10`).

**Files:**
- Create: `skills/brainstorm/SKILL.md` (from `1aa149b10`)
- Modify: `skills/skills.go`: the embed line adds `brainstorm` and drops `ideas`
  (`//go:embed brainstorm cockpit council design detach doc-review initiatives learn notes runs`)
- Delete: `skills/ideas/` (Task 8 removes the rest of Ideas)
- Modify: `AGENTS.md`: the skills list in the "arcterm's own skills live in `skills/`" gotcha names `brainstorm`
  and no longer names `ideas`
- Modify: `skills/council/SKILL.md`: drop the paragraph that says a council puts each direction into this session's
  Ideas list (line 82–83 today); a council's directions are only in its report

**Steps:**
1. `go build ./skills/...` and `go test ./skills/...` pass; `rg -n -i 'wsh idea|ideas list|arc:ideas' skills` finds
   nothing.
2. Commit: `feat(brainstorm): the arc:brainstorm skill; Ideas leaves the skills`.

**Acceptance:** no UI. The commands above show it.

### Task 3: Hooks: reveal a brainstorm on its file write, add the skill context, leave run agents out

**Depends on:** Task 1 (the hooks write `session:brainstorm` and read `ARC_RUN_AGENT`, both added there)

Kael commits: `c8cc4f3dc` (reveal on the state file write, the synchronous `Skill` PostToolUse hook
`wsh agent-hook --skill-context`, its `install-agent-hooks` entry, `wsh ui reveal brainstorm:<topic>`), the
`wshcmd-agenthook.go` parts of `6fd649cfd`, and `48f1758ad` (a tab no longer renames to each answer in a
slash-command session).

**Files:**
- Modify: `cmd/wsh/cmd/wshcmd-agenthook.go` (+ `_test.go`): `brainstormRevealFor`, the skill-context output, the
  `ARC_RUN_AGENT` exclusion
- Modify: `cmd/wsh/cmd/wshcmd-installhooks.go` (+ `_test.go`): the managed hook list gains the `Skill` matcher
- Modify: `cmd/wsh/cmd/wshcmd-ui.go`: `reveal` accepts a `brainstorm:` address

**Steps:**
1. Port the tests; they fail (`go test ./cmd/wsh/cmd -run 'BrainstormContext|BrainstormReveal|InstallHooks|AgentHook'`
   with the cgo prefix).
2. Port the code; the tests pass.
3. Commit: `feat(brainstorm): reveal a brainstorm on its state file write and add the brainstorm skill context`.

**Acceptance:** the Go tests above; the reveal's effect in the app is `brainstorm-mode` step 0b (Task 9).

### Task 4: The builder check and the judge on the server, and hiding their runs

**Depends on:** Task 1 (fills the brainstorm stubs it declares; uses the judging-session launcher, the prompt delivery,
`IsBrainstormSession` and the brainstorm meta keys it adds)

Kael commits: `1e6b9ed00`, `68f515252`, `8d086231f`, `853e3b468`, `5f1f43d91`, `1bc496af7`, `25d78cf94`,
`37179fd5f`, `f0fda796b`, `276ecc312`, `10cceb237`, `f43f80e38` (server parts, `BrainstormCheckTimesCommand`
included), and the brainstorm part of `a1eabfbc9`'s `pkg/wshrpc/wshserver/sessionruns.go` (only the
`IsBrainstormSession` branch of `linkSessionsToRuns`, which stamps a dag-less builder-check or judge session with its
run id and stage role; the rest of that commit is Kael's Sessions search, out of scope).

**Files:**
- Create (from `1aa149b10`): `pkg/brainstormcheck/` (all files: `brainstormcheck.go`, `judge.go`, `times.go`,
  `doc.go`, `builder-check-prompt.md`, `judge-prompt.md` and their tests)
- Modify: `pkg/wshrpc/wshserver/wshserver_brainstorm.go` (+ create `_test.go`): replace Task 1's four stubs with
  `BrainstormCheckCommand`, `BrainstormJudgeCommand`, `BrainstormJudgeStopCommand`, `BrainstormCheckTimesCommand`,
  the watchers, the routes, `ResumeBrainstormSessions`
- Create: `cmd/wsh/cmd/wshcmd-brainstorm.go` (+ `_test.go`): `wsh brainstorm check`, `wsh brainstorm judge`
- Modify: `cmd/server/main-server.go` (`ResumeBrainstormSessions` at startup)
- Modify: `pkg/wshrpc/wshserver/sessionruns.go` (+ `sessionruns_test.go`): the `IsBrainstormSession` branch
- Modify (hide `builder-check` and `brainstorm-judge` runs): `cmd/wsh/cmd/wshcmd-runs.go` (+ test),
  `pkg/jarvis/attention.go` (+ test), `pkg/jarvisstate/jarvisstate.go` (+ `jarvisstate_test.go`),
  `pkg/wshrpc/wshserver/wshserver_channels.go` (+ test), `pkg/wshrpc/wshserver/wshserver_runs.go` (+ test)
- No wire type changes and no `task generate`: Task 1 declared them. If a hunk needs a type Task 1 missed, add it and
  regenerate, and say so in the commit message.

**Steps:**
1. Port `pkg/brainstormcheck` with its tests: `go test ./pkg/brainstormcheck` passes (cgo prefix).
2. Port the handler tests; they fail
   (`go test ./pkg/wshrpc/wshserver -run 'BrainstormCheck|BuilderCheck|BrainstormJudge|CheckTimes|ResumeBrainstormSessions|LinkSessions'`).
3. Port the handlers, the watchers, the sweep, the `sessionruns.go` branch and `wsh brainstorm`; those tests and
   `go test ./cmd/wsh/cmd -run 'BrainstormCheckCmd|BrainstormJudgeCmd'` pass.
4. Port the run hiding with its tests (`go test ./pkg/jarvis -run 'Attention|Usage|IsBrainstorm'`,
   `go test ./pkg/jarvisstate`, `go test ./pkg/wshrpc/wshserver -run 'Channel|Runs'`,
   `go test ./cmd/wsh/cmd -run Runs`).
5. Commit: `feat(brainstorm): the builder check and the blind judge as Arc-launched sessions`.

**Acceptance:** the Go tests above. In the app: `brainstorm-builder-check`, `brainstorm-builder-ask`,
`brainstorm-judge-wait` and `brainstorm-judged-question` play the server's side and show the pane reading its
records; `brainstorm-builder-tree` / `brainstorm-judge-tree` show the hidden runs nesting (Task 9 writes them).

### Task 5: The pane's model, store, poller and sender

**Depends on:** Task 1 (calls the prompt delivery and brainstorm RPCs it declares and reads the brainstorm meta keys)

Kael commits: `318290e4c`, `c1e9193d3`, `2150b6281`, `e8b88d6e1`, `3b84510da`, `b831a2c92`, and every later commit to
the files below (take the new files as they are at `1aa149b10`, except `brainstormsend.ts`, see Scope).

**Files:**
- Create (from `1aa149b10`): `frontend/app/view/agents/brainstormmodel.ts`, `brainstormstore.ts`,
  `brainstormpoller.ts`, `brainstormsend.ts`, `brainstormrunmodel.ts`, each with its `.test.ts`. `brainstormsend.ts`
  takes its Approve path from `7407220b8^` (`openRunLauncher` / `approveAndOpenRun`), rewritten to call main's
  `openLauncher(model, "run", { ...prefill, onStarted })` from `launcherstore.ts` instead of Kael's
  `newRunPrefillAtom` / `newRunOpenAtom`; its tests check the prefill it passes and that `onStarted(id)` sends
  `brainstorm: run <id>`
- Modify: `frontend/app/view/jarvis/newrun.ts` (+ `newrun.test.ts`): only the type hunk, `NewRunPrefill` gains
  `onStarted?: (runId: string) => void` (Task 7 calls it)
- Modify (brainstorm hunks only): `frontend/app/cockpit/cockpit-root.tsx` (mount `BrainstormPoller`),
  `frontend/app/view/jarvis/address.ts` (+ test) and `frontend/app/view/jarvis/openref.ts` (+ test) (the
  `brainstorm:` address, read the file on reveal), the ui api files `c1e9193d3` touches (main's
  `frontend/app/cockpit/uiapi.ts`, `uiclient.ts`, + their tests),
  `frontend/app/view/agents/agentcontrollerstore.ts`, `agentsviewmodel.ts`, `liveagents.ts`,
  `session-models/sessionsidebarmodel.ts`, `session-models/sessionviewmodel.ts` (+ test), `sessionsruns.ts` (+ test),
  `runlineage.ts` (+ test), `runlineagestore.ts`, `frontend/app/view/agents/canvasmodel.ts`

**Steps:**
1. Bring in the five model files with their tests; `npx vitest run frontend/app/view/agents/brainstorm` fails only on
   missing host wiring, not on the files themselves.
2. Wire the host hunks; `npx vitest run frontend/app/view/agents/brainstorm frontend/app/view/jarvis/address
   frontend/app/view/jarvis/openref frontend/app/view/jarvis/newrun frontend/app/cockpit/uiapi
   frontend/app/cockpit/uiclient frontend/app/view/agents/session-models frontend/app/view/agents/sessionsruns
   frontend/app/view/agents/runlineage` passes; `task check:ts` is clean.
3. Commit: `feat(brainstorm): the brainstorm model, store, poller and sender`.

**Acceptance:** model and store only; the vitest suites above. The poller's effect in the app is every brainstorm-*
scenario's pane reading the file (Task 9).

### Task 6: The pane, its keys and the how-to-use hints

**Depends on:** Task 5 (the pane draws `brainstormmodel.ts` through `brainstormstore.ts`)

Kael commits: `bca0e323b`, `b584cddbf`, `8c78c9c86`, `41062bfdb`, `5260cda04`, `cf563c409`, `c4e88bb21`, `a25b8821a`,
`d5a036a00`, `01612aa14`, `29a76935d`, `1a15f6532`, `d632779ea`, `2fca43b3d`, `bd539e4aa`, `d5521eb18`, `f43f80e38`
(pane parts, `useCheckTimes` calling `BrainstormCheckTimesCommand`), `042a99068`, `1aa149b10`, and every later commit
to the files below.

This task also **removes the Ideas keybindings** (the capture binding and its imports of `ideasmodel` /
`ideasstore`) from `bindings.ts`, `bindings.test.ts` and `docs/keyboard-shortcuts.md`, so those three files are
edited by this task only; Task 8 deletes the Ideas modules after it.

**Files:**
- Create (from `1aa149b10`): `frontend/app/view/agents/brainstormpane.tsx`, `brainstormui.tsx`, `brainstormcheck.tsx`,
  `brainstormreview.tsx`, `brainstormrun.tsx`
- Modify (brainstorm hunks only): `frontend/app/view/agents/agentsurface.tsx` and `agentheader.tsx` (the
  **Terminal | Brainstorm** switch; the terminal stays mounted underneath, so keep AGENTS.md's terminal-stack rule:
  the pane overlays the cell, it never re-parents or conditionally renders the stack), `agents.tsx`,
  `canvaspane.tsx` (the mockup boards the question view shows)
- Modify: `frontend/app/store/keybindings/bindings.ts` (+ `bindings.test.ts`, `store.test.ts`), `whenstate.ts`
  (+ test), `frontend/app/cockpit/footerhints.ts` (+ `footerhints.test.ts`): `b` and **Ctrl+Shift+B** flip terminal
  and brainstorm, Esc steps back, double Ctrl+C closes the agent from the pane, the review keys. `b` already
  backgrounds an agent in Cockpit (`cockpit:background`): Kael's `b` is an Agent-surface binding with a brainstorm
  attached; check the two never fire in the same context, and add a test that says so. Drop the Ideas capture binding
  and its imports
- Modify: `docs/keyboard-shortcuts.md` (mirror the new bindings; drop the Ideas binding)
- **How-to-use hints (main's addition, the person asked for it; Kael has none).** A newcomer must learn the mode from
  the app itself, not from `docs/agents/brainstorm.md`:
  - **First open:** the first time a brainstorm pane opens on this machine, a one-time dismissable hint card at the top
    of the pane says, in four short lines: answer in the box or pick an option (Enter sends); "Guess for me" lets the
    agent guess and you confirm with That's right; `b` / Ctrl+Shift+B flips back to the terminal; when every part is
    yours, Check with a builder, then Approve starts the run. Dismissal is remembered in localStorage under the key
    `brainstorm.hintsSeen` (every read and write in try/catch; a failed read shows the card). The pure "should it
    show" logic is `frontend/app/view/agents/brainstormhints.ts` with `brainstormhints.test.ts`; the card is
    `brainstormhints.tsx`, drawn by `brainstormpane.tsx`.
  - **Where to start it:** the Agent surface's zero-agent empty state (`agentsurface.tsx`) and the New dialog's agent
    row (`launcheragentfields.tsx`, or `launcherrows.tsx` / `launchermodal.tsx` if that is where the agent row's
    details draw) each get one line: "Ask the agent to brainstorm a feature (superpowers:brainstorming) and Arc opens
    it here, one question at a time."
  - **In the footer hints:** while the pane is focused, the footer lists the pane's keys (`b` terminal, Esc back,
    Enter send) through `footerhints.ts`, as the other surfaces do.
  - Every hint uses DESIGN.md's tokens and type scale, no raw colors, and plain words with no code words.

**Steps:**
1. Port the binding tests and write `brainstormhints.test.ts` and the footer-hints test; they fail
   (`npx vitest run frontend/app/store/keybindings frontend/app/cockpit/footerhints frontend/app/view/agents/brainstormhints`).
2. Port the pane files and the host hunks, add the hints, drop the Ideas binding; those tests and
   `npx vitest run frontend/app/view/agents/brainstorm` pass; `task check:ts` is clean.
3. Commit: `feat(brainstorm): the brainstorm pane beside the agent's terminal, its keys and its hints`.

**Acceptance (live check in Task 9's scenarios, run by Final):** `brainstorm-mode` steps 0–2p (the switcher, the
question, the answer box, lettered options), 2b–2o and 3–5 (the design, part states, mockups, Edit, Shift+Enter),
6–6e (the Terminal | Brainstorm switch, `b`, Ctrl+Shift+B, the compaction banner, the terminal kept mounted underneath),
7c–7d, 10–12b (exit, broken file, gone file, Back to terminal); `brainstorm-main`, `brainstorm-question-reasons`,
`brainstorm-review-skim`, `brainstorm-rail-reasons`, `brainstorm-new-findings`, `brainstorm-check-review` (the review
keys and Esc); and `brainstorm-hints` (the first-open card, its dismissal across a reload, the empty-state line, the
New dialog agent-row line, the pane's footer keys). There is no hand check in this task.

### Task 7: The tree rows, the taskbar attention and the launcher handoff

**Depends on:** Task 6 (the chip toggles the pane Task 6 builds, and Task 6's agent-row hint edits the launcher
files beside the `launcherstore.ts` / `launcherrun.ts` this task changes, `launchermodal.tsx` possibly both)

Kael commits: `6fd649cfd` (tree line, `attentionpoller.tsx`, `newrun.ts`), the `attentionpoller.tsx` hunk of
`2e92db78b` (the asking brainstorm in the outward attention list; the popup itself is out of scope), `79028b2b6`,
`0e5961e5f`, `855af2871`, `4b35ff0a1`, `71181210f` (the brainstorm chip toggling the pane), `272647d80` (starting the
approved run no longer switches to the Brief).

**Files:**
- Modify: `frontend/app/view/agents/agentsidebarmodel.ts` (+ `agentsidebarmodel.test.ts`) and `agenttree.tsx`: the
  tree line ("Brainstorm · asking question N", "Brainstorm done · run <id>", the run's state first, truncated as
  text), the chip, and the "Builder check" and "Judge" rows nested under their brainstorming agent by the
  `brainstorm:*` tab meta keys (Task 1) and the check and judge records (Task 5) (a top-level row when that agent's
  tab is gone). Put the pure part in `agentsidebarmodel.ts` with tests, as main does
- Modify: `frontend/app/view/agents/attentionpoller.tsx` and `attentionstore.ts` (+ `attentionstore.test.ts`): an
  agent whose file holds a question and whose turn ended reads as asking, its brainstorm item joins the outward list
  `taskbarSignal` reads, so a new question flashes the taskbar while Arc is not focused. The pure part
  (which items join, from the roster and `brainstormsAtom`) goes in `attentionstore.ts` with a test
- Modify: `frontend/app/view/agents/launcherstore.ts` (+ `launcherstore.test.ts`) and `launcherrun.ts`
  (+ `launcherrun.test.ts`): when a run started from a prefill starts, call the prefill's `onStarted(runId)` (the
  `brainstorm: run <id>` handback `brainstormsend.ts` passes), and stay on the Agent surface (`272647d80`); test
  both in `launcherstore.test.ts` / `launcherrun.test.ts`
- `frontend/app/view/jarvis/newrun.ts` (+ test): only if `6fd649cfd`'s prefill hunk is still missing after Task 5

**Steps:**
1. Port the tests into `agentsidebarmodel.test.ts`, `attentionstore.test.ts`, `launcherstore.test.ts` and
   `launcherrun.test.ts`; they fail.
2. Port the code; `npx vitest run frontend/app/view/agents/agentsidebarmodel frontend/app/view/agents/attentionstore
   frontend/app/view/agents/launcherstore frontend/app/view/agents/launcherrun frontend/app/view/jarvis/newrun`
   passes; `task check:ts` is clean.
3. Commit: `feat(brainstorm): the brainstorm in the Agent tree, the taskbar attention and the New launcher handoff`.

**Acceptance (live check in Task 9's scenarios, run by Final):** `brainstorm-mode` step 7 (the row reads asking
question 5 with the asking dot) and 7b (adapted: an unfocused new question puts the agent's brainstorm item in the
outward attention list); `brainstorm-builder-tree` and `brainstorm-judge-tree` (the nested Builder check and Judge
rows, top-level when the agent's tab is gone); `brainstorm-run-blocked`, `brainstorm-run-landed`,
`brainstorm-run-missing` (the tree line and pane once a run exists); and `brainstorm-approve-run` (Approve opens the New
launcher prefilled and the surface stays Agent).

### Task 8: Remove Ideas

**Depends on:** Task 2 (takes `ideas` off the skills embed line), Task 4 (both rewrite generated wire files; Task 4 is
the last task before this one to touch the wshrpc and wshserver packages), Task 6 (removes the Ideas keybindings,
the last importers of `ideasmodel` / `ideasstore` in `bindings.ts`)

Ideas is main's own feature (Kael never had it): `wsh idea`, `pkg/ideastore`, the Ideas section and stat of the
details rail, the "Add as idea" selection chip, the arc mod's idea nudge and `/idea` command, the council's
write-back of its directions into Ideas. Before deleting a file, grep every import of it, `import type` and
re-exports included (AGENTS.md working rule). The Brief's Ideas column and a council's "Ideas so far" stay (see Scope).

**Files:**
- Delete: `cmd/wsh/cmd/wshcmd-idea.go` (+ test), `pkg/ideastore/`, `pkg/wshrpc/wshrpctypes_idea.go`,
  `pkg/wshrpc/wshserver/wshserver_idea.go` (+ test), `frontend/app/view/agents/ideacapture.ts` (+ test),
  `ideacapturechip.tsx`, `ideasmodel.ts` (+ test), `ideassection.tsx`, `ideasstore.ts`,
  `claude/arc-mod/hooks/ideas-core.ts` (+ test), `claude/arc-mod/commands/idea.md`
- Move before deleting: `sessionIdFromTranscript` / `validSessionId` from `ideasmodel.ts`. `launch.ts` already exports
  a `sessionIdFromTranscript`; point the callers that survive at it (and add `validSessionId` there with a test, if a
  survivor still needs it)
- Modify: `cmd/generatego/main-generatego.go`, `pkg/wshrpc/wshrpctypes.go` (the interface composition),
  `pkg/wps/wpstypes.go` (`Event_IdeasChanged`), `pkg/tsgen/tsgenevent.go` (`IdeasChangedData`); then `task generate`
- Modify: `claude/arc-mod/hooks/register.ts` (drop `promptNudge`), then `task sync:claudemod`, which rewrites
  `cmd/wsh/cmd/claude-mod/` from `claude/arc-mod/` (the stale `hooks/ideas-core.ts` and `commands/idea.md` copies go)
- Modify: `frontend/app/view/term/termwrap.ts` (drop `watchIdeaSelection`), `frontend/app/view/term/term.tsx` (drop
  `IdeaCaptureChip` and its `ideasmodel` import), `frontend/app/view/agents/agentdetailsrail.tsx`,
  `agentrailsections.ts` (+ `agentrailsections.test.ts`: the `ideas` stat and section), `agentrailpanel.tsx` (the
  `ideas` label), `railicons.tsx` (the Ideas icon, if only Ideas uses it), `sessionsdetail.tsx`
  (`EndedSessionIdeas`), `frontend/app/cockpit/notificationstore.ts` (+ test) (the "Added to Ideas" example comment)
- Modify: `pkg/council/runner.go` (+ `runner_test.go`), `pkg/council/markdown.go` (+ `markdown_test.go`),
  `pkg/council/types.go` (`IdeaId`), `cmd/wsh/cmd/wshcmd-council.go` (+ test) (`--session` help and comment: "whose
  Ideas get the directions"), and `frontend/app/view/agents/councildiscussionmodel.ts`, `councilfeedmodel.ts`,
  `councilsummarymodel.ts`, `councilmodel.ts`, `councilsummary.tsx` ("In Ideas as …") with their tests: a council no
  longer writes its directions into Ideas, and its report and summary no longer mention Ideas
- Modify: `scripts/cdp/scenarios.mjs`, `scripts/cdp/council/{discussion,setup,summary}.mjs`,
  `scripts/cdp/council/rail-apps-done.json` (the `ideaid` fields) and `scripts/cdp/council/fixtures.test.mjs`: drop
  the `ideas-rail` and `ideas agent` scenarios and every Ideas step or assertion in the council scenarios
- Add to `scripts/cdp/scenarios.mjs`: an `agent-rail-no-ideas` scenario: an agent with a transcript, its details rail
  open: no Ideas stat or section in the rail; text selected in its terminal raises no "Add as idea" chip; the capture
  shortcut does nothing
- Modify: `docs/open-issues.md` (drop Ideas entries), and mark
  `docs/superpowers/specs/2026-10-14-brainstorm-ideas-design.md` superseded by Brainstorm mode in its first line
- Leave the users' `<data dir>/ideas/*.json` files on disk; nothing reads them any more

**Steps:**
1. Delete and edit. Then grep (Grep tool) over `pkg cmd frontend claude scripts skills docs/keyboard-shortcuts.md`,
   case-insensitive, for `idea`, and review every hit: each one left is the Brief's Ideas column, a council's ideas
   text, a generic English "idea", or this plan. In particular nothing matches
   `ideastore|ideasmodel|ideasstore|ideassection|ideacapture|ideas-core|IdeasChanged|ideas:changed|ideaid|IdeaId|wsh idea|IdeaAdd|watchIdeaSelection|promptNudge`.
2. `go build ./...`; `task generate` leaves no diff after a second run; the cgo-prefixed
   `go test ./pkg/council ./pkg/wps ./cmd/wsh/cmd -run 'Council|Hook'` passes; `npx vitest run claude/arc-mod
   frontend/app/view/agents/council frontend/app/view/agents/agentrailsections frontend/app/cockpit/notificationstore
   scripts/cdp/council` passes; `task check:ts` is clean.
3. `node scripts/cdp/final-verify.mjs agent-rail-no-ideas council-summary` passes (it starts its own dev app).
4. Commit: `refactor: remove Ideas, which Brainstorm mode replaces`.

**Acceptance:** `agent-rail-no-ideas` (the rail without the Ideas section and stat, no capture chip) and the council
scenarios `council-ask`, `council-summary`, `council-tree` with no Ideas assertion left.

### Task 9: Scenarios, docs and changelog

**Depends on:** Task 3, Task 4, Task 6, Task 7, Task 8 (the scenarios drive what they build; Task 8 also edits
scenarios.mjs)

Kael commits: `729be3ea3`, `c7809cf5b`, `3b84510da`, `29a76935d`, `71181210f` and every commit to
`scripts/cdp/scenarios-brainstorm-*.mjs` and to the brainstorm scenarios of `scripts/cdp/scenarios.mjs`; `1aa149b10`.

**Files:**
- Create (from `1aa149b10`): `scripts/cdp/scenarios-brainstorm-builder.mjs`, `-findings.mjs`, `-judge.mjs`,
  `-review.mjs`, `-run.mjs`
- Modify: `scripts/cdp/scenarios.mjs`: import the five modules; add `brainstorm-mode`, `brainstorm-main`,
  `brainstorm-question-reasons`, `brainstorm-review-skim` and `brainstorm-rail-reasons` with their helpers
  (`bsBoardScenario`, `bsAgentTook`, `bsUntil` and the rest), adapted to main's tree and selectors. Adapt
  `brainstorm-mode` step 7b to main (no popup): an unfocused new question puts the agent's brainstorm item in the
  outward attention list. The shared brainstorm arrange sets localStorage `brainstorm.hintsSeen` so the first-open
  hint card does not shift the other scenarios' layout; only `brainstorm-hints` clears it
- Add to `scripts/cdp/scenarios.mjs`:
  - `brainstorm-approve-run`: a brainstorm file in its ready state (every part yours, the check clean) in a
    registered project with a mockup board; click Approve; assert the agent got `brainstorm: approved`, the New
    launcher is open on the run half with shape orchestrator, the agent's project, a goal naming the spec's absolute
    path and the first board as prototype, and the surface is still Agent. Do not start the run (it would launch a
    real lead agent); the `onStarted` → `brainstorm: run <id>` handback is covered by Task 5's and Task 7's unit tests
  - `brainstorm-hints`: with `brainstorm.hintsSeen` cleared, opening a pane shows the first-open hint card; dismissing
    it and reloading keeps it gone; the Agent surface's zero-agent empty state shows the start line; the New dialog's
    agent row shows the start line; with the pane focused, the footer lists its keys
- Create (from `1aa149b10`): `docs/agents/brainstorm.md`, `docs/images/brainstorm/*.png`, and the four specs listed
  in Goal and scope under `docs/superpowers/specs/`; in `docs/agents/brainstorm.md` replace Kael-only paths
  (`agenttreemodel.ts`, `designroute.ts`, `newruncontrol.tsx`, the popup files) with main's, and its
  `task verify:ui -- …` test lines with `node scripts/cdp/final-verify.mjs …`
- Modify: `docs/deferred.md`: add Kael's "Builder check end to end" and "Brainstorm judge end to end" entries, titled
  "(arcterm) …"
- Modify: `docs/open-issues.md` "0 · Waiting on a hand check": one `- [ ]` line for a real brainstorm with a Claude
  agent in the dev app driven only through the pane (one write per turn, the judge and the builder check running for
  real, Approve starting a real run and `run` set after it starts), and one for pi; and in "RAM watch", a line for
  the always-mounted 3 s `BrainstormPoller` (measure it with several agents brainstorming)
- Modify: `CHANGELOG.md` `Unreleased`: under `Added`, "Brainstorm mode: an agent's brainstorm opens beside its
  terminal, one question at a time, with a blind judge for approach questions and a builder check before you approve
  the run", ending `<!-- try: <binding id> -->` naming the global binding that opens the Agent surface (or the New
  dialog), so What's new's Try it lands where the hint says to start, then `<!-- big -->`; under `Changed` (or
  `Removed` if the file uses it), "Ideas is gone: Brainstorm mode keeps a brainstorm's decisions"
- Modify: `docs/README.md` if it maps `docs/agents/`

**Steps:**
1. Port the scenarios and add the two new ones; `node scripts/cdp/final-verify.mjs brainstorm-mode brainstorm-hints
   brainstorm-approve-run brainstorm-builder-check brainstorm-judged-question brainstorm-judge-tree
   brainstorm-run-landed` passes (it starts its own dev app; never `task verify:ui` against the person's app).
2. Run every scenario the Final line names the same way; fix what fails in this task when it is the scenario, and
   report it as Found not fixed when it is another task's code.
3. Commit: `test(cdp): the brainstorm scenarios; docs for Brainstorm mode`.

**Acceptance:** every scenario on the Final line passes.

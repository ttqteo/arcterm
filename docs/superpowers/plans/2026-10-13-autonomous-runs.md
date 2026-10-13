# Autonomous approvals for orchestrator runs

**Verify:** `node scripts/verify.mjs ./pkg/waveobj ./pkg/jarvis ./pkg/orchestrate ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `go vet ./pkg/waveobj ./pkg/jarvis ./pkg/orchestrate ./pkg/wshrpc/... ./cmd/wsh/... && node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
**Final:** `node scripts/cdp/final-verify.mjs autonomous-runs brief-profile new-run-window run-sheet-polish palette-actions surface-smoke`
**Prototype:** C:/Users/kael02/IdeaProjects/waveterm/.superpowers/design/autonomous-runs/project/Main.dc.html

An "Approvals" setting, Ask me or Autonomous, for orchestrator runs. In an autonomous run the lead answers
everything that would otherwise reach the human, takes the option it would recommend, and records each call
and why in its report. The Gatekeeper stays out of orchestrator runs (`isOrchestratorRun`,
`pkg/jarvis/watcher.go`) and the engine plan reviewer still runs: neither changes.

The canvas on the Prototype line settles the UI. Its folder holds four boards: `Main.dc.html` (Profile),
`NewRun.dc.html`, `RunSheet.dc.html`, `RunActions.dc.html`. It is gitignored scaffolding: read it at that
path, never copy or commit it. Copy text on a board is the copy to ship, word for word.

## Decisions (approved with the human; they bind every task)

1. One rules text, `jarvis.AutonomousRules`, is the single source: the autonomous launch prompt,
   `OrchestrationRules` for an autonomous group, and the mid-run ON message all use it.
2. Autonomous launch prompt: the lead still classifies the path itself. A bounded or spike goal proceeds without
   the human's yes. An architectural one records its decisions in the spec (or, with a canvas, in the plan's
   header) and submits with no `Spec review` ask. No brainstorm questions, no path question.
3. Plan review failed or reviewer lost in the last round, and the `ReplacePlanReviewProposal` refusal: the lead
   amends the findings into pending tasks with `dag amend`, then `wsh jarvis dag planreview accept "autonomous run"`;
   a finding no pending task can take is an open issue in the report. Spec changes during revision: make them and record them.
4. Final stage failed in the last round: plain `wsh jarvis complete` with the land held, never `--force-land`;
   the report says the land is held and why.
5. `ForwardTask` refuses on an autonomous group with a message telling the lead to decide (answer, retry,
   escalate, skip or send back) and record why. The cockpit's own take-over (`TakeOverAsk`) still works.
6. Ask deadline (`sweepAsks`) on an autonomous run: the deadline restarts and the lead is re-woken; the question
   never moves to the human.
7. Lead dies after submit on an autonomous run: the engine calls `RelaunchLead` itself, asynchronously, and
   lead-owned questions stay with the lead meanwhile. At most `MaxAutoRelaunches = 3` automatic relaunches per
   run, counted in memory on the run's wake state. A failed relaunch, or the cap reached, moves the questions to
   the human as today. A lead that dies before submitting, an engine stuck wake and a failed relaunch still reach the human.
8. `SetRunSettingsCommand` takes `Autonomous *bool`: nil leaves it alone, so the palette toggle and the
   parallelism action cannot overwrite each other. Side effects fire only on an actual off→on or on→off change.
   Before a dag exists it is pending on the Run; after, it is live on the TaskGroup (`pkg/jarvis/runsettings.go`).
9. Turning ON answers the lead's own pending question (Spec review, Plan review, the land question) with one
   short single-line free-text sentence, `jarvis.AutonomousOnAnswer`. The answer is checked with
   `agentask.ValidateAnswers` before the save returns and typed in the background (typing is 60ms per rune,
   past the 5s RPC budget). The rules always follow as a wake, `jarvis.AutonomousOnWake`. When the picker
   refuses free text (a batch preview picker), the question stays with the human, the wake waits until it
   closes, and the save returns an error saying the setting saved and the lead's question still needs an answer
   in its terminal. Worker questions the human holds for this run go back to the lead with a fresh deadline.
10. Turning OFF sends a wake: ask the human again from your next decision; calls already made stand.
11. `--autonomous` and the launcher field are orchestrator only. `CreateRun` refuses an explicit
    `autonomous: true` on a quick run and ignores the profile's value for one. Plan-file runs carry the flag too.
12. Run sheet: after an ON save that handed back a waiting lead question, the sheet shows the RunSheet board's
    "<header>: the lead decided" note from local component state; no new run event kind. Its first sentence
    depends on the header: Spec review "The lead approved its spec and is writing the plan."; Plan review "The
    lead is carrying the plan review's findings into the tasks and going on."; anything else "The lead is
    deciding it as it would recommend." Each is followed by "It answers everything from here on; each call it
    makes goes in its report." "Use for new runs" carries Approvals into the profile.
13. Palette: `ThingAction` gains optional per-thing title, Enter verb, status chip and echo; the status chip
    gains an `accent` tone (text `text-accent-soft`, dot `bg-accent-400`). The row's static `label`
    "Go autonomous" stays the search and Not-now text. The row shows whenever the run sheet is editable
    (`sheetFace(run).kind === "editable"`), before or after submit, not only when `runAdjustable`.
14. One new CDP scenario, `autonomous-runs`, with a step per board, written by Task 9 after the UI tasks land.

Repo rules: no new dependency. Never hand-edit generated files: run `task generate` after Go type changes.
Never run `task dev`, `task check:ts` or `npm install` in a worktree (run the tsc line from Check directly).
Never run prettier on `scripts/*.mjs`. Never stop `wave-tauri.exe` or `wavesrv.x64.exe` by image name. Colors
only from `@theme` tokens in `frontend/tailwindsetup.css`, no new tokens. No `Co-Authored-By`,
`Claude-Session` or other attribution trailer in a commit. Change nothing outside the files a task names.

### Task 1: The setting's data path, profile to run to group
**Depends on:** none
**Files:** `pkg/waveobj/wtype.go`, `pkg/jarvis/profile.go`, `pkg/jarvis/profile_test.go`, `pkg/jarvis/runsettings.go`, `pkg/jarvis/runsettings_test.go`, `pkg/wshrpc/wshrpctypes_runs.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshserver/wshserver_dag.go`, `pkg/wshrpc/wshserver/wshserver_runsettings.go`, `pkg/wshrpc/wshserver/wshserver_autonomous_test.go`, `cmd/wsh/cmd/wshcmd-runs.go`, `cmd/wsh/cmd/wshcmd-runs_test.go`, `frontend/types/gotypes.d.ts`

Mirror how `ReviewerPicks` and `Landing` travel today (grep both).

Produces (other tasks rely on these exact names):
- `waveobj.JarvisProfile.Autonomous bool` `json:"autonomous,omitempty"`; `waveobj.ProfileOverride.Autonomous *bool` `json:"autonomous,omitempty"`;
  `waveobj.Run.Autonomous bool` `json:"autonomous,omitempty"`; `waveobj.TaskGroup.Autonomous bool` `json:"autonomous,omitempty"`.
- `wshrpc.CommandCreateRunData.Autonomous *bool` (nil = the resolved profile's value); `wshrpc.CommandSetRunSettingsData.Autonomous *bool` (nil = unchanged).
- `jarvis.PendingEngineSettings.Autonomous *bool`; `ApplyPendingEngineSettings` / `ApplyLiveEngineSettings` write it only when non-nil.
- `jarvis.EffectiveAutonomous(r *waveobj.Run, g *waveobj.TaskGroup) bool`: the group's value when `g` is non-nil and `g.RunID == r.ID`, otherwise the run's.
- TS (generated): `JarvisProfile.autonomous?`, `ProfileOverride.autonomous?`, `Run.autonomous?`, `TaskGroup.autonomous?`, `CommandCreateRunData.autonomous?`, `CommandSetRunSettingsData.autonomous?`.

Work:
- `ResolveProfile`: a non-nil override `Autonomous` replaces the global value. `ProfileOverrideIsEmpty` counts it.
- `CreateRun` (`wshserver_runs.go`): orchestrator runs take `data.Autonomous`, or the resolved profile's value when nil, onto `run.Autonomous`. A quick run with explicit `autonomous: true` is refused with an error naming the field; a quick run never takes the profile's value.
- `DagSubmit` (`wshserver_dag.go`, beside `proposed.ReviewerPicks, proposed.ReviewerRoute = ...`): the group takes `run.Autonomous`. A plan-file run (`wsh runs start --plan`) reaches the group the same way.
- `SetRunSettingsCommand`: carries `data.Autonomous` into `PendingEngineSettings` (pending on the Run before a dag, live on the group after). This task adds no side effects; Task 4 does.
- `wsh runs start --autonomous` (orchestrator only: refuse it with a quick shape, as other orchestrator-only flags are refused) sets `Autonomous` to true; without the flag the field stays nil. The run list line that shows `reviewer picks` (`wshcmd-runs.go`, near `if r.ReviewerPicks`) also shows `autonomous` for an autonomous run.
- Run `task generate`; commit the regenerated `frontend/types/gotypes.d.ts`.

Acceptance, with focused tests:
- `go test ./pkg/jarvis -run 'TestResolveProfile.*Autonomous|TestProfileOverrideIsEmpty.*Autonomous|Test.*EngineSettings.*Autonomous|TestEffectiveAutonomous'`: override true/false over global false/true, nil inherits; empty-check; pending and live apply only a non-nil value and leave the other carrier untouched; `EffectiveAutonomous` prefers an owning group and ignores a group another run owns.
- `go test ./pkg/wshrpc/wshserver -run 'TestCreateRunAutonomous|TestDagSubmitCarriesAutonomous|TestSetRunSettingsAutonomousCarrier'`: CreateRun explicit true, explicit false over a profile true, nil inherits profile, quick run refuses explicit true and ignores profile true; DagSubmit copies the run's value onto the group; SetRunSettings writes the Run before a dag and the group after, and a nil value changes neither.
- `go test ./cmd/wsh/cmd -run 'TestRunsStart.*Autonomous'`: the flag sets the field for orchestrator, is refused for quick, and is absent (nil) without the flag.

### Task 2: Lead prompts and the autonomous rules text
**Depends on:** Task 1
**Files:** `pkg/jarvis/leadprompt.go`, `pkg/jarvis/leadprompt_test.go`, `pkg/jarvis/run.go`, `pkg/jarvis/run_test.go`, `pkg/jarvis/runexec.go`, `pkg/orchestrate/wake.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `cmd/wsh/cmd/wshcmd-jarvisdag.go`, `cmd/wsh/cmd/wshcmd-jarvisdag_test.go`

Produces:
- `jarvis.AutonomousRules` (const string): approvals are autonomous, nobody is at the cockpit; at every point the rules below say "put it to the human" or "ask the human", take the option you would recommend instead, and record the call and why in your report; never call `AskTool`; plan review failed or lost in the last round → amend findings with `dag amend`, then `wsh jarvis dag planreview accept "autonomous run"`; spec changes during revision: make them and record them; `dag forward` is refused, so decide yourself; final stage failed in the last round → plain `wsh jarvis complete --report <file>` with the land held, never `--force-land`, and say in the report that the land is held and why.
- `jarvis.AutonomousOnAnswer` (const string, one line, no control characters, kept short because it is typed at 60ms per rune): exactly "The human is away and this run is now autonomous: decide this as you would recommend, record the call in your report, and stop asking."
- `jarvis.AutonomousOnWake` (const string, one line, since a wake is typed as one): a `wake: ` line saying approvals are now autonomous and the human is away, followed by `AutonomousRules` (write `AutonomousRules` as one line so it can ride in a wake).
- `jarvis.AutonomousOffWake` (const string): a `wake: ` line saying approvals are back to Ask me: put the decisions the rules give the human to the human again from your next one; calls already made stand.
- Signatures (every caller updated): `BuildOrchestratePrompt(goal string, principles waveobj.PrincipleList, runtime string, autonomous bool) string`; `OrchestrationRules(runId, specPath, planPath, effortOID string, autonomous bool) string`; `PlanLeadPrompt(principles waveobj.PrincipleList, runId, specPath, planPath, effortOID string, autonomous bool, wake string) string`.

Work:
- `writeLaunchPrompt` takes `autonomous`. When true it says nobody is at the terminal, drops the brainstorm questions, the path question and the `Spec review` ask, and says: classify the path yourself; spike and bounded proceed without a yes; architectural writes its decisions into the spec (with a canvas that settles the design, into the plan's header) and submits. It keeps the plan format, the submit line, `NoAttributionRule`, and appends `AutonomousRules`. When false the text is byte-identical to today's.
- `OrchestrationRules` appends `AutonomousRules` when `autonomous` is true and is byte-identical to today's when false. It is re-sent after every compaction, so the flag must come from the group: `dagRulesText` (`wshcmd-jarvisdag.go`) passes `g.Autonomous`; `startLead` (`wake.go`) passes `g.Autonomous`; the plan-file lead in `wshserver_runs.go` passes `run.Autonomous`; `runexec.go` passes `run.Autonomous` to `BuildOrchestratePrompt`.

Acceptance:
- `go test ./pkg/jarvis -run 'TestLaunchPrompt.*Autonomous|TestOrchestrationRules.*Autonomous|TestPlanLeadPrompt.*Autonomous|TestAutonomousTexts'`: `AutonomousOnAnswer` passes `agentask.ValidateAnswers` as a free-text answer to a single-select question with options (prose false) and is under 160 runes; `AutonomousOnWake` has no newline; autonomous launch prompt has no `Spec review`, no `AskUserQuestion`/`ask_user_question`, contains `AutonomousRules`; off is unchanged (compare against the existing expected text); rules on contain `planreview accept "autonomous run"` and never `--force-land` as an instruction to run; rules off unchanged; `PlanLeadPrompt` carries the flag through.
- `go test ./cmd/wsh/cmd -run 'TestDagRulesText'`: an autonomous group's rules text equals `OrchestrationRules(..., true)`.

### Task 3: Engine gates that stop reaching the human
**Depends on:** Task 2
**Files:** `pkg/orchestrate/queue.go`, `pkg/orchestrate/queue_test.go`, `pkg/orchestrate/planreview.go`, `pkg/orchestrate/planreview_test.go`, `pkg/orchestrate/final.go`, `pkg/orchestrate/final_test.go`, `pkg/orchestrate/wake.go`, `pkg/orchestrate/wake_test.go`, `docs/orchestrator-guide.md`

Each gate reads `g.Autonomous` from the group it already has (or loads `p.DagOID` for an ask). Off, every text and behavior is unchanged.

- `planReviewFailedWake(round int, findings string, last, autonomous bool)` and `planReviewLostWake(round int, reason string, last, autonomous bool)`: last + autonomous says to amend the findings into pending tasks with `wsh jarvis dag amend <task> "<note>"`, then run `wsh jarvis dag planreview accept "autonomous run"`, and record it; never "Put it to the human". Callers in `planreview.go` pass `g.Autonomous`.
- `ReplacePlanReviewProposal`'s refusal after the last round: on an autonomous group, the same amend-then-accept instruction instead of `proceedPastPlanReview`.
- `finalFailedWake(round int, runID, detail string, last, autonomous bool)`: last + autonomous says to complete with the plain `wsh jarvis complete --report <file>` (never `--force-land`), the land stays held, and the report says so and why. Caller in `final.go` passes `g.Autonomous`.
- `ForwardTask`: on an autonomous group, return an error before forwarding anything: the run is autonomous and nobody is at the cockpit; decide it yourself (answer, retry, escalate, skip or send back) and record the call and why in your report. `TakeOverAsk` is unchanged.
- `sweepAsks`: a lead-owned ask past its deadline whose dag is autonomous gets a fresh deadline (`now + LeadAskDeadline`), `publishChildAsk`, and `PokeWake`, instead of `forwardAskToUser`. A dag that cannot be loaded keeps today's behavior.
- Dead lead (`leadDiedLocked`, and `PokeWake`'s `rw.dead` branch): when the run has a dag and the group is autonomous and the run's automatic relaunch count is below `MaxAutoRelaunches` (const, 3), increment the count, keep lead-owned asks with the lead, and start `RelaunchLead` in a goroutine through a test seam (`relaunchLeadFn`, a var), since `leadDiedLocked` holds `wakes.lock` and `RelaunchLead` takes it. While that relaunch is in flight, `PokeWake` does not move asks to the human. When the relaunch returns an error, move every lead-owned ask to the human with `leadLaunchFailedNote` and the error, as today. Past the cap, today's behavior. The count lives on `runWake`.
- `docs/orchestrator-guide.md`: a short section on autonomous runs listing what the lead decides, what still reaches the human (engine stuck, a failed relaunch or the relaunch cap, a lead that dies before submitting), and the mid-run switch.

Acceptance:
- `go test ./pkg/orchestrate -run 'TestPlanReview.*Autonomous|TestFinalFailedWake.*Autonomous|TestForwardTask.*Autonomous|TestSweepAsks.*Autonomous|TestLeadDied.*Autonomous'`:
  wake texts on and off (off equal to today's); the replace refusal on an autonomous group names `planreview accept "autonomous run"`; ForwardTask on an autonomous group returns the refusal, records no task-forwarded event and moves no ask, and still forwards off; an expired lead ask on an autonomous dag keeps `Owner == AskOwner_Lead` with a later deadline and a poked wake; a dead autonomous lead calls the seam once, keeps asks with the lead, and on a seam error moves them to the human; the 4th death in one run moves asks to the human without calling the seam; a non-autonomous death is unchanged.

### Task 4: Switching Approvals mid-run
**Depends on:** Task 2
**Files:** `pkg/orchestrate/autonomous.go`, `pkg/orchestrate/autonomous_test.go`, `pkg/wshrpc/wshserver/wshserver_runsettings.go`, `pkg/wshrpc/wshserver/wshserver_runsettings_test.go`

Produces: `orchestrate.ApplyAutonomousSwitch(ctx context.Context, channelId, runId string, on bool) error`.

- ON, in this order, all before returning:
  1. Every ask in the registry with `RunId == runId`, a `DagOID`, and `Owner == AskOwner_User` goes back to the lead: owner lead, note cleared, deadline `now + LeadAskDeadline`, `publishChildAsk`.
  2. `PostWake(jarvis.AutonomousOnWake)`. The waker already holds a wake while the lead's own question is open (`leadAsking`), so it is typed once that question closes.
  3. Find the run's lead block (`readLeadState`). If the registry holds a pending ask on that block's oref, build one `baseds.AgentAnswerItem{Text: jarvis.AutonomousOnAnswer}` per question and check them with `agentask.ValidateAnswers(questions, answers, pending.Prose)`. When it refuses, return an error saying the setting saved and the lead's question still needs an answer in its terminal, with the refusal's reason. When it passes, deliver with `agentask.DeliverAnswer` in a goroutine through a test seam (`deliverLeadAnswerFn`, a var): typing runs at `agentask.KeystrokeDelay` per rune, past the 5s RPC budget. A delivery error there is logged with the run id and recorded with `appendRunEvent` as `RunEventKindLeadWakeFailed` with the reason, never dropped.
- OFF: `PostWake(jarvis.AutonomousOffWake)`. Nothing else moves.
- `SetRunSettingsCommand`: when `data.Autonomous` is non-nil, read the effective value (`jarvis.EffectiveAutonomous`) inside the same write it updates, and after the write succeeded and the updates were published, call `ApplyAutonomousSwitch` only if the value changed. Its error is returned (the setting itself already saved; the message says so).

Acceptance:
- `go test ./pkg/orchestrate -run 'TestApplyAutonomousSwitch'`: ON with a pending single-select lead ask validates and hands `AutonomousOnAnswer` to the delivery seam and returns before the seam finishes (the seam blocks in the test); ON with a pending ask whose questions refuse free text (a multi-question batch with previews, per `ValidateAnswers`) returns the saved-but-unanswered error, calls no seam, and still posts the ON wake; ON with no pending lead ask posts the ON wake only; a user-owned worker ask of the run returns to the lead with a fresh deadline and an ask of another run is untouched; OFF posts `AutonomousOffWake` and moves no ask; a seam error is recorded on the run.
- `go test ./pkg/wshrpc/wshserver -run 'TestSetRunSettingsAutonomousSwitch'`: false→true and true→false call the switch once (test seam), true→true and nil do not; works before a dag (Run) and after (group).

### Task 5: Profile panel Approvals row
**Depends on:** Task 1
**Files:** `frontend/app/view/jarvis/profilemodel.ts`, `frontend/app/view/jarvis/profilemodel.test.ts`, `frontend/app/view/jarvis/briefprofileview.tsx`

Board: `Main.dc.html`. A row "Approvals" / "When the lead needs a decision from you" after "Runs land on", a two-segment control Ask me / Autonomous built like the Landing row's segments, the per-choice explanation line from the board, and the row's source (Project/Global) with Reset, as the other run-default rows do.

- `profilemodel.ts`: `autonomous` joins `OVERRIDE_FIELDS` and `GlobalDefaultKey`, the override-empty check, project-set detection and Reset (which deletes the field). Global mode edits `JarvisProfile.autonomous`.
- Acceptance: `npx vitest run frontend/app/view/jarvis/profilemodel.test.ts`: an override with only `autonomous` is not empty and reads as Project; Reset removes it and the row reads Global; a project `false` over a global `true` is a stated value, not inheritance. The rendered row is shown by `autonomous-runs` step "profile" (Task 9).

### Task 6: New-run launcher Approvals field
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/runconfig.ts`, `frontend/app/view/agents/runconfig.test.ts`, `frontend/app/view/agents/runconfigstore.ts`, `frontend/app/view/agents/runconfigstore.test.ts`, `frontend/app/view/agents/runactions.ts`, `frontend/app/view/agents/runactions.test.ts`, `frontend/app/view/jarvis/newrun.ts`, `frontend/app/view/jarvis/newrun.test.ts`, `frontend/app/view/jarvis/newruncontrol.tsx`, `frontend/app/view/jarvis/briefsheet.tsx`, `frontend/app/view/agents/runlauncher.tsx`

Board: `NewRun.dc.html`. Under Models, orchestrator shape only: "Approvals" label, Ask me / Autonomous segments, the note per choice from the board, and the footer gains ` · autonomous` when on.

- `runconfig.ts`: the run defaults gain `autonomous: boolean` from `profile?.autonomous ?? false`.
- `runconfigstore.ts`: an `autonomousAtom` seeded from the defaults and reset with the other atoms, as `reviewerPicksAtom` is.
- `runactions.ts`: the create-run options gain `autonomous?: boolean`, sent as `autonomous` only for an orchestrator run (quick never sends it).
- `newrun.ts`: `RunConfig` gains `autonomous: boolean`, and `launchOptsFromConfig` (the config-to-CreateRun translation `newruncontrol.tsx` and `briefsheet.tsx` use) passes it through for orchestrator only.
- Every launch site builds its config from the atoms with `autonomous`: `newruncontrol.tsx`, `briefsheet.tsx` (`ChannelLaunch`) and `runlauncher.tsx`. The two launchers that render a form (`newruncontrol.tsx`, `runlauncher.tsx`) show the field for orchestrator and hide it for quick.
- Acceptance: `npx vitest run frontend/app/view/agents/runconfig.test.ts frontend/app/view/agents/runconfigstore.test.ts frontend/app/view/agents/runactions.test.ts frontend/app/view/jarvis/newrun.test.ts`: defaults read the profile's value; the atom seeds and resets; `launchOptsFromConfig` and the create-run payload carry `autonomous` for orchestrator, both true and false, and omit it for quick. The rendered field is shown by `autonomous-runs` step "new-run" (Task 9).

### Task 7: Run sheet Approvals dial and config word
**Depends on:** Task 1
**Files:** `frontend/app/view/jarvis/runsettings.ts`, `frontend/app/view/jarvis/runsettings.test.ts`, `frontend/app/view/jarvis/runsheetmodel.ts`, `frontend/app/view/jarvis/runsheetmodel.test.ts`, `frontend/app/view/jarvis/briefrunsheet.tsx`

Board: `RunSheet.dc.html`.

Produces: `runAutonomous(run: Run | null, group: TaskGroup | null): boolean` in `runsettings.ts` (the group's value when the group is the run's, else the run's, as `runSettingsDraft` reads its other fields); `RunSettingsDraft.autonomous: boolean`.

- `runsettings.ts`: the draft gains `autonomous` (seeded via `runAutonomous`); `draftIsDirty`, `draftSeedKey`, `settingsPayload` (always sends `autonomous`), `effectiveRunConfig` and `engineDefaultsPatch` (so "Use for new runs" writes `autonomous`) carry it.
- `briefrunsheet.tsx`: the Adjust panel's intro adds "Approvals apply to the lead's next decision."; an Approvals dial (Ask me / Autonomous) below the existing dials; when the draft turns it on while the sheet's status reads a question waiting on you, the warning line "Saving hands the waiting <header> back to the lead, and it answers everything from then on." (header from the waiting lead ask, else "question"); when the draft turns it off, "The lead asks you again from its next decision. Calls it already made stand."; the saved line per the board ("Saved. The run is autonomous from now on." / "Saved. The lead asks you from its next decision."). After a successful ON save that handed back a waiting lead question, show the board's resolved note "<header>: the lead decided" with the sentence Decision 12 gives for that header, held in component state until the sheet closes or the run changes.
- `runsheetmodel.ts`: `configLine` (also used by `runsheet.tsx`) adds `asks you` or `autonomous` for an orchestrator run, from the draft; the sheet draws `autonomous` in the accent token. A pure `autonomousResolvedNote(header: string): { title: string; body: string }` returns the note's title and the Decision 12 text.
- Acceptance: `npx vitest run frontend/app/view/jarvis/runsettings.test.ts frontend/app/view/jarvis/runsheetmodel.test.ts`: draft seeds from the owning group over the run and from the run before a dag; dirty when only `autonomous` differs; payload carries it; `engineDefaultsPatch` writes it; `configLine` reads `asks you` off and `autonomous` on, and neither for a quick run; `autonomousResolvedNote` gives the Spec review, Plan review and other-question sentences. The rendered dial, warning, both saved lines, resolved note and config word are shown by `autonomous-runs` step "run-sheet" (Task 9).

### Task 8: Palette toggle "Go autonomous" / "Ask me again"
**Depends on:** Task 7
**Files:** `frontend/app/cockpit/actions/types.ts`, `frontend/app/cockpit/actions/run.ts`, `frontend/app/cockpit/actions/run.test.ts`, `frontend/app/cockpit/palette-actionrows.ts`, `frontend/app/cockpit/palette-actionrows.test.ts`, `frontend/app/cockpit/palette-rows.tsx`, `frontend/app/cockpit/command-palette.tsx`

Board: `RunActions.dc.html`.

- `palette-rows.tsx`: `StatusTone` gains `"accent"`, mapped to `text-accent-soft` in `TONE_TEXT` and `bg-accent-400` in `TONE_DOT`.
- `types.ts`: `ThingAction` gains optional `title?: (thing: T) => string`, `verb?: (thing: T) => string`, `status?: (thing: T) => { label: string; tone: StatusTone }` and `echo?: (thing: T) => string`. `label` stays the search and Not-now text.
- `command-palette.tsx` (and `palette-actionrows.ts` if the row shape is built there): an action-list row renders `title(thing)` when given, the Enter verb from `verb(thing)` instead of `actionVerb(label)` when given, the status chip when given, and the footer echo from `echo(thing)` when given. Actions without them render exactly as today.
- `run.ts`: `run:autonomous` in the Steer group right after `run:workers`, static label "Go autonomous"; `applies` when `sheetFace(t.run).kind === "editable"`; `title` "Go autonomous" / "Ask me again", `verb` "Go" / "Ask me", `status` `asks you` (tone `muted`) / `autonomous` (tone `accent`), `echo` per the board ("The lead answers everything from now on, starting with the <header> it is waiting on." when a lead question waits, else "The lead answers everything from now on."; "The lead asks you again from its next decision. Calls it already made stand." when on); `run` calls `RpcApi.SetRunSettingsCommand` with `{ channelid, runid, autonomous: !runAutonomous(t.run, t.info?.dag ?? null) }` only (no other field, so nothing else changes).
- Acceptance: `npx vitest run frontend/app/cockpit/actions/run.test.ts frontend/app/cockpit/palette-actionrows.test.ts`: applies before a dag and after; not for quick, done or cancelled runs; title, verb, status label and tone, and echo flip with the current value; an action with no `verb` keeps `actionVerb(label)`; the payload names only `autonomous` with the flipped value. The rendered row is shown by `autonomous-runs` step "palette" (Task 9).

### Task 9: CDP scenario `autonomous-runs`
**Depends on:** Task 4, Task 5, Task 6, Task 7, Task 8
**Files:** `scripts/cdp/scenarios.mjs`

One new scenario named `autonomous-runs`, following the existing scenario patterns (`brief-profile`, `new-run-window`, `run-sheet-polish`, `palette-actions`; scope DOM queries to a `data-*` container, pin the viewport 1600x950, clean up every channel, run and profile change in teardown). Each step shoots and asserts:

- step "profile" (Main board): open the project profile, pick Autonomous on Approvals, save; assert the row reads Project with Reset and the autonomous explanation; Reset; assert it reads Global.
- step "new-run" (NewRun board): with the project profile set to Autonomous, open the New run launcher on orchestrator; assert the Approvals field sits under Models with Autonomous selected and the footer ends ` · autonomous`; switch to quick; assert the field is gone.
- step "run-sheet" (RunSheet board): create an orchestrator run (`createrun`) with a lead tab, raise a `Spec review` ask on the lead's block with the `ask` RPC (as `attention-popup` does), open the run sheet's Adjust panel, pick Autonomous; assert the warning line naming Spec review; Save; assert "Saved. The run is autonomous from now on.", the resolved note "Spec review: the lead decided" with its Spec review sentence, and the config line reading `autonomous`; poll until the lead's ask is answered or gone (the answer is typed in the background); pick Ask me; assert the back-to-ask line; Save; assert "Saved. The lead asks you from its next decision." and the config line reading `asks you`.
- step "palette" (RunActions board): open the palette on that run's actions; assert the Steer group's toggle reads "Go autonomous", status `asks you`, Enter verb "Go", and the footer echo for the off state; Enter; reopen the run's actions and assert "Ask me again", status `autonomous`, verb "Ask me", and the on-state echo "The lead asks you again from its next decision. Calls it already made stand."

Acceptance: `CDP_PORT=<port> task verify:ui -- autonomous-runs` passes against a dev app built from the merged tree (Final runs it).

# Choosing when a run starts — implementation plan

**Spec:** `docs/superpowers/specs/2026-11-16-run-start-choice-design.md` (read "The builder's decisions" section: every
call below comes from it)
**Verify:** `node scripts/verify.mjs ./pkg/runqueue ./pkg/runstart ./pkg/jarvis ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs run-start-choice run-start-choice-live run-start-choice-brainstorm run-queue-recheck run-queue brief-run-queue chat-verdict-handoff`

Goal: when a run is about to start (Approve on a brainstorm, + Run with a goal or a plan), Jarvis suggests Run now,
After run… (the live runs that edit the same files) or Queue, preselected with a one-line reason; the queue can wait on
several runs, re-checks an entry when its turn comes, and a queued brainstorm hears its run id from wavesrv.

Shape: Task 1 lands the new wire (fields, the suggestion RPC as a stub, the scenario modules and their kit). Then Task 2
(the queue's After becomes a list, end to end), Task 3 (pure Go rules, no wire; needs nothing) and Task 5 (the launcher
row) run beside each other. Task 4 (server: the RPC, the re-check, the brainstorm notice) follows Tasks 2 and 3. Task 6
(the brainstorm card, the scenarios that need the real RPC, docs, changelog) comes last.

Conventions every task follows: pure logic in a `foo.ts` / Go function with tests beside it, a thin view over it
(AGENTS.md "Frontend conventions"); colors from `@theme` tokens and the patterns in `DESIGN.md`; never hand-edit
generated files (`task generate`); errors handled at the boundary and logged, never swallowed. Go tests on Windows run
with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`. Scenario helpers: `docs/reference/cdp-run-fixtures.md`.

Not shot by Final, on purpose: the launcher's "Checking…" line (it shows only for the moment the RPC is in flight, so a
shot races it) and the quota note (it needs a live Claude quota reading the dev app cannot be made to hold). Both are
proven by unit tests (Task 3's `QuotaNote`, Task 5's reason-line model, which renders the note as the reason line's
second line in the same element the scenarios shoot).

### Task 1: The new wire, the suggestion RPC stub, and the scenario modules
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_runqueue.go`, `pkg/wshrpc/wshrpctypes_runs.go`, `pkg/wshrpc/wshrpctypes_runstart.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/waveobj/wtype.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshserver/wshserver_runstart.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-run-start-choice.mjs`, `scripts/cdp/scenarios-run-queue-recheck.mjs`

Decisions (spec "Wire"); everything here is additive, `After` stays a string until Task 2:
- `CommandCreateRunData.SpecPath` and `Run.SpecPath` (`json:"specpath,omitempty"`); `CreateRun` copies it onto the run.
- `RunQueueBrainstorm { Tab string json:"tab"; Path string json:"path" }`; `RunQueueEntry.Brainstorm` and
  `CommandRunQueueAddData.Brainstorm` (`*RunQueueBrainstorm`, `json:"brainstorm,omitempty"`); `RunQueueAddCommand`
  stores it on the entry.
- `pkg/wshrpc/wshrpctypes_runstart.go`: a `RunStartCommands` interface (composed into the interface in `wshrpctypes.go`)
  with `RunStartSuggestCommand(ctx, CommandRunStartSuggestData) (*RunStartSuggestion, error)` and:
  - `CommandRunStartSuggestData { ChannelId string "channelid,omitempty"; ProjectPath string "projectpath"; Goal string "goal"; PlanPath string "planpath,omitempty"; SpecPath string "specpath,omitempty" }`
  - `RunStartSuggestion { Choice string "choice"; After []string "after,omitempty"; Reason string "reason"; QuotaNote string "quotanote,omitempty"; Live []RunStartLiveRun "live"; Active int "active"; MaxActive int "maxactive" }`
  - `RunStartLiveRun { RunId string "runid"; Title string "title"; Files []string "files,omitempty" (the files it shares with the new run); Held bool "held,omitempty"; HeldReason string "heldreason,omitempty" }`
  - constants `RunStartChoice_Now = "now"`, `RunStartChoice_After = "after"`, `RunStartChoice_Queue = "queue"`.
- `wshserver_runstart.go` holds only a stub returning the error "run start suggestions are not built yet"; Task 4
  replaces it. Run `task generate`.
- Scenario modules: create `scripts/cdp/scenarios-run-start-choice.mjs` and `scripts/cdp/scenarios-run-queue-recheck.mjs`,
  each `export default function (kit) { return []; }` with a header naming the tasks that fill it. In `scenarios.mjs`
  add one `RUN_START_KIT` next to `KAEL_KITS` = `{ ...BS_KIT, ...KAEL_KITS, run: RUN_KIT, openLauncherStart,
  OPEN_NEW_RUN, NEW_BUTTON, arrangeFixtureRun, arrangeSheetDagRun }` plus whatever Brief helper `brief-run-queue` uses to
  open a queued entry's sheet, and register both modules with it the way `scenarios-brainstorm-run.mjs` is registered.
  Later tasks add scenarios only in these modules; one that lacks a small helper copies it into its module rather than
  editing `scenarios.mjs`.

Acceptance:
- `go test ./pkg/wshrpc/wshserver -run 'TestRunQueueAdd|TestCreateRunSpecPath'`: an added entry keeps `Brainstorm`; a
  run created with `SpecPath` has it.
- `task check:ts` clean; `node -e "import('./scripts/cdp/scenarios.mjs').then(() => console.log('ok'))"` prints ok (both
  modules resolve and register).

### Task 2: A queue entry waits on several runs
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_runqueue.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/runqueue/runqueue.go`, `pkg/runqueue/rules.go`, `pkg/runqueue/runqueue_test.go`, `pkg/runqueue/rules_test.go`, `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`, `cmd/wsh/cmd/wshcmd-runs.go`, `cmd/wsh/cmd/wshcmd-runs_test.go`
**Files:** `frontend/app/view/agents/runqueuemodel.ts`, `frontend/app/view/agents/runqueuemodel.test.ts`, `frontend/app/view/agents/runqueuestore.ts`, `frontend/app/view/agents/runqueuestore.test.ts`, `frontend/app/view/agents/chatruncards.ts`, `frontend/app/view/agents/chatruncards.test.ts`, `frontend/app/view/agents/chatruncardmodel.ts`, `frontend/app/view/agents/chatruncardmodel.test.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/jarvis/briefqueue.ts`, `frontend/app/view/jarvis/briefqueue.test.ts`, `frontend/app/view/jarvis/briefqueuesheet.tsx`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-chat-verdict-handoff.mjs`, `docs/guide/orchestrator.md`

Decisions (spec "Overlap with several runs" and "Wire"):
- `RunQueueEntry.After` and `CommandRunQueueAddData.After` become `[]string` (`json:"after,omitempty"`); run
  `task generate`. `pkg/runqueue` `load` reads an old entry whose `after` is a JSON string as a one-element list (empty
  string → none); `save` always writes a list. The compatibility lives only there.
- `runqueue.Next`: an entry starts when every After id is a run that landed (and there is room); any After run that
  ended held (not Dirty) or cancelled blocks it as today, `On` that run; an After still going or naming a queued entry
  keeps it waiting; an id that is neither blocks it. `Retarget(from, to)` replaces `from` inside every list.
  `RunQueueRemoveCommand` blocks every entry whose list contains the removed id. `startQueuedEntry` sets
  `data.AfterRunId` to the first After id that is not a `q-` id. The loader loads every id of every list.
  `RunQueueAddCommand` resolves each id as `resolveQueueAfter` does today, dropping duplicates.
- `wsh runs start --after` repeats and takes comma lists; `wsh runs` queue output prints "after A, B" (and the other
  places `wshcmd-runs.go` reads `e.After`).
- Frontend: every reader of `entry.after` takes the list. A row's `afterMet` is true only when every id landed;
  `afterTitle` is the joined titles ("run A, run B"); Brief nests an entry under the first After run not landed yet;
  the queue sheet's waits line reads "After run A, run B", and the sheet shows a waiting entry's `reason` too (today only
  a blocked one's); the tree row and Chat card read "Queued · after run A, run B". The CDP scenarios that call
  `runqueueadd` with a string `after` send a list.
- `docs/guide/orchestrator.md` (Vietnamese, as the file is): `--after` takes several runs and waits for all.

Acceptance:
- `go test ./pkg/runqueue -run 'TestNext|TestLoad|TestRetarget'`: an entry after [r1, r2] waits while r2 runs, starts
  once both landed, is blocked (On r2) when r2 ends held; a queue file with `"after": "r1"` loads as `["r1"]` and is
  saved back as a list; Retarget swaps one id inside a list.
- `go test ./pkg/wshrpc/wshserver -run 'TestRunQueue'` (existing tests on lists), plus a Remove test where an entry
  waits on [removed, r1] and is blocked.
- `go test ./cmd/wsh/cmd -run 'TestRuns'`: `--after a,b --after c` sends three ids.
- `npx vitest run frontend/app/view/agents/runqueuemodel.test.ts frontend/app/view/jarvis/briefqueue.test.ts frontend/app/view/agents/chatruncards.test.ts`:
  two-run titles, `afterMet` only when both landed, a waiting entry's reason in the sheet lines.
- Scenarios: a new step in `brief-run-queue` (`scenarios.mjs`) queues an entry after two runs and shoots its queue sheet
  ("After" with both titles) and its Agent tree row ("after run A, run B"); `chat-verdict-handoff` step 8 queues after
  two runs and its card reads "Queued · after" both titles. `run-queue` keeps passing.

### Task 3: The rules — a run's files, overlap, the suggestion and the quota note (pure Go)
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/runstart/runstart.go`, `pkg/runstart/runstart_test.go`, `pkg/runstart/quota.go`, `pkg/runstart/quota_test.go`, `pkg/jarvis/chunkstale.go`

New package `pkg/runstart`: pure decisions, no store, no git, no wire types (it may import `pkg/jarvis` and
`pkg/tokengate`; nothing imports it but wshserver). In `pkg/jarvis/chunkstale.go` export `MentionMatches(p, m string) bool`
(rename `mentionMatches`; its only callers are in that file) and `HubFile(path string) bool` (the `hubFiles` check on
the base name), so diff paths drop the same hub files `FileMentions` drops.

Interface Task 4 builds on (names and shapes fixed; bodies are yours):
```go
const (ChoiceNow = "now"; ChoiceAfter = "after"; ChoiceQueue = "queue")
const (SourceSpec = "spec"; SourcePlan = "plan"; SourceGoal = "goal")
func NewRunFiles(goal, specText, planText string) []string // FileMentions(goal, spec) ∪ TaskFiles of every plan task ∪ FileMentions(plan); distinct, hub files out
func DiffFiles(paths []string) []string                    // repo paths from a git diff, hub files out
func SameFile(a, b string) bool                            // MentionMatches(a, b) || MentionMatches(b, a)
type LiveRun struct { Id, Title string; Files []string; Held bool; HeldReason string; CreatedTs int64 }
type Overlap struct { RunId, Title string; Files []string; Held bool; HeldReason string } // Files: the shared ones
func Overlaps(files []string, live []LiveRun) []Overlap  // one per live run, in live's order, Files empty when none shared
type SuggestInput struct { Files []string; Source string; Live []LiveRun; Active, MaxActive int } // MaxActive 0 = no cap
type Suggestion struct { Choice string; After []string; Reason string }
func Suggest(in SuggestInput) Suggestion
func RecheckAdds(files []string, live []LiveRun, queuedTs int64, after []string) (add []string, reason string)
type QuotaInput struct { FiveHourPct, WeekPct *float64; FiveHourReset, WeekReset *int64; WindowTokens int64; Samples []int64; Now time.Time; Loc *time.Location }
func QuotaNote(q QuotaInput) string
```
Rules (spec "How the suggestion is computed" and "The builder's decisions"):
- Suggest: no files → Run now if room else Queue, reason "The <source> names no files: only the run cap was checked".
  Overlap with non-held runs → After those runs, reason "Edits <file> like <title>" (several: "Edits <file> like
  <title> and 1 more run"). Held overlapping runs are never in After; their line "<title> is held and edits <file>:
  land it first, or this run will conflict" is appended ("; ") to the reason. No non-held overlap → Run now when
  `Active < MaxActive` (or no cap), reason "No live run edits the same files"; else Queue, reason "<n> runs are already
  active".
- RecheckAdds: live runs with `CreatedTs > queuedTs`, not held, not in `after`, that share a file; reason "Waiting for
  <title> too: both edit <file>" (first run, first file).
- QuotaNote: with `len(Samples) >= 3` (`MinQuotaSamples`), estimate = median, and `tokengate.WindowShare(estimate,
  WindowTokens, *FiveHourPct)`; when it answers ok, note when share > 100 − pct. With fewer samples, or WindowShare
  answering `false`, note when the 5-hour or the weekly pct > 85 (`NearlySpentPct`). Wording "Quota at <100−pct>%: the
  run will pause until <HH:MM>, then carry on", for the window that triggered, its reset in `Loc` (weekly adds the
  weekday, "Mon 16:40"). Missing pct or reset for that window → "".

Acceptance: `go test ./pkg/runstart` — each Suggest branch above (no files ×2, overlap one and two runs, held only, held
plus non-held, room, no room, no cap); SameFile with a bare name against a repo path both ways; NewRunFiles reading
`**Files:**` lines from a plan and mentions from a spec, hub files dropped; RecheckAdds ignoring older, held and already
listed runs; QuotaNote with 3 samples over and under the remaining share, WindowShare false falling back to 85%, 2
samples at 86% and 80%, weekly wording, nil reading. `go test ./pkg/jarvis -run 'Stale|Chunk'` still passes.

### Task 4: Server — the suggestion RPC, the re-check, and telling a queued brainstorm its run
**Depends on:** Task 2, Task 3 (uses pkg/runstart's NewRunFiles, DiffFiles, Overlaps, Suggest, RecheckAdds and QuotaNote)
**Model:** sonnet
**Files:** `pkg/wshrpc/wshserver/wshserver_runstart.go`, `pkg/wshrpc/wshserver/wshserver_runstart_test.go`, `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`, `pkg/runqueue/runqueue.go`, `pkg/runqueue/runqueue_test.go`, `scripts/cdp/scenarios-run-queue-recheck.mjs`

- `liveRunFiles(ctx, projectPath) ([]runstart.LiveRun, error)` — one gatherer for the RPC and the re-check (spec "Which
  live runs, and their files"): live = top-level (`runqueue.TopLevel`) runs not done or cancelled, plus done runs whose
  land is pending (`runqueue.Outcome` not final); held = `Land.State == held && !Dirty`. Only runs whose
  `Run.ProjectPath` equals `projectPath` (cleaned; case-insensitive on Windows). Files: mentions of the goal and spec
  (`Run.SpecPath`, else the dag's `SpecPath`), `jarvis.TaskFiles` of each dag task; a branch-landed dag's `PlanPath` and
  `SpecPath` are repo-relative and resolve in `LandPath`, else `Run.ProjectPath`. Changed files through
  `runstart.DiffFiles`: orchestrator `<BaseCommit>...wave/<id>` plus `<BaseCommit>...<Branch>` for each child run with a
  `Branch`, done or not; quick or checkout landing `git diff --name-only <BaseCommit>` in `LandPath`, else the project.
  Git calls run concurrently, each with a 2 s timeout; a failure is logged with the run id and adds no files. Git and
  the store sit behind package seams so tests script them.
- `RunStartSuggestCommand`: read the new run's spec and plan (a relative `PlanPath` resolves against `ProjectPath`),
  `runstart.Suggest` with `Active`/`MaxActive` as `RunQueueListCommand` computes them (global), `Live` from
  `runstart.Overlaps`, and `QuotaNote` from `claudequota.Get`, `usagestats.WindowTokens` at the 5-hour window's start
  (reset − 5 h) and the samples: summed sealed `Usage` tokens of the project's last 10 done top-level runs of the same
  kind (orchestrator when the new run has a plan, else by the run's mode). An unreadable spec or plan is an error to the
  caller.
- Re-check (spec "Re-check when an entry's turn comes"): in `readQueuedStart`, before returning the entry
  `runqueue.Next` named, call a seam `runQueueRecheck(ctx, entry) (add []string, reason string, err error)` built on
  `liveRunFiles` + `runstart.RecheckAdds` over the entry's files read now (`Data.Goal`, `Data.SpecPath`,
  `Data.PlanPath`). A non-empty `add` calls new `runqueue.WaitAlsoOn(id, add, reason)` (appends the ids not already
  there, sets `Reason`, keeps it waiting, one write), publishes, and reports the pass stale as an unblock does, so
  `nextQueuedStart` reads the queue again and the next ready entry starts in the same evaluation (bounded: a held entry
  now waits on a live run, so Next skips it). An error logs and lets the entry start: the check is advice, never a gate.
  `RunQueueStartNowCommand` skips it.
- Brainstorm notice: when `startQueuedEntry` succeeds and the entry has `Brainstorm`, arm the agent's sleep after run
  (the logic of `AgentsSleepAfterRunCommand`, called directly) and deliver `brainstorm: run <runId>` to `Brainstorm.Tab`
  through the path `AgentsAssignCommand` uses (`loadAgentRosterFacts` → `resolveAgentTab` → `deliverToAgent`), in a
  goroutine with a panic handler; a failure is logged and recorded as a run event on the new run, not retried.

Acceptance:
- `go test ./pkg/runqueue -run 'TestWaitAlsoOn'`.
- `go test ./pkg/wshrpc/wshserver -run 'TestRunStartSuggest|TestLiveRunFiles|TestRunQueueRecheck|TestRunQueueBrainstorm'`:
  a live run whose goal names `land.go` makes the suggestion After it; a held one is in `Live` with `Held` and never in
  `After`; another project's run is ignored for overlap but counted in `Active`; a repo-relative dag spec resolves in
  `LandPath`; a done child's unmerged branch counts; a git seam that times out still answers; an entry whose turn comes
  while a run created after it shares a file gains that run with the reason and is not started, and the entry behind it
  starts in the same evaluation; an older overlapping run is ignored; Start now starts it anyway; a started entry with
  `Brainstorm` delivers `brainstorm: run <id>` to its tab.
- Scenario `run-queue-recheck` in `scripts/cdp/scenarios-run-queue-recheck.mjs`: set `runs:maxactive` to the active
  count, queue an entry whose goal names a file, create a deferred fixture run whose goal names the same file, raise
  `runs:maxactive`, wait for the entry to gain the run in its After, then open its queue sheet in Brief and shoot it: the
  waits line names the run and the reason line reads "Waiting for … too: both edit …". Teardown restores the setting,
  dequeues and cancels.

### Task 5: The launcher's When row
**Depends on:** Task 1
**Model:** sonnet
**Files:** `frontend/app/view/agents/launcherwhen.ts`, `frontend/app/view/agents/launcherwhen.test.ts`, `frontend/app/view/agents/launcherwhenrow.tsx`, `frontend/app/view/agents/launcherstore.ts`, `frontend/app/view/agents/launcherstore.test.ts`, `frontend/app/view/agents/launchermodal.tsx`, `frontend/app/view/agents/launcherrun.ts`, `frontend/app/view/agents/launcherrun.test.ts`, `frontend/app/view/jarvis/newrun.ts`, `frontend/app/view/jarvis/newrun.test.ts`, `frontend/app/view/agents/runactions.ts`, `frontend/app/view/agents/runactions.test.ts`, `scripts/cdp/scenarios-run-start-choice.mjs`

Decisions (spec "The launcher row" and the builder's "The launcher row"):
- Pure model `launcherwhen.ts`: state `{ choice: "now"|"after"|"queue"; touched: boolean; ticked: string[];
  suggestion: RunStartSuggestion | null; checking: boolean; error: string | null }` and functions: apply a suggestion
  (ignored once `touched`, except that it fills the After list), pick a choice (sets `touched`), tick/untick a run (a
  held run cannot be ticked), the reason line ("Checking…", "Couldn't check: …", else `reason`, with `quotanote` as a
  second line), the Start label ("Start", "Queue after <title>", "Queue after <n> runs", "Queue"), and the Start
  blocker ("Pick a run to wait for" for After with nothing ticked).
- `newrun.ts`: `NewRunPrefill.specPath?: string` and `NewRunPrefill.brainstorm?: RunQueueBrainstorm`, both carried by
  `prefillToLaunch` into launcher atoms (`launcherSpecPathAtom`, `launcherBrainstormAtom` in `launcherstore.ts`,
  cleared with the draft); `RunHandback.queued?: (entryId: string) => void`. `runactions.ts`: `CreateRunOpts.specPath`
  → `CommandCreateRunData.specpath` in `createRunPayload`, the one builder of the start's data for both paths.
- `launcherrun.ts`: `queueLauncherRun(input & { after: string[]; brainstorm?: RunQueueBrainstorm })` sharing the channel
  and route steps of `startLauncherRun` (extract them once), calling `RunQueueAddCommand` with `createRunPayload`'s data
  and the brainstorm; it returns the entry.
- The row (`launcherwhenrow.tsx`), in the run fields above Start for both goal and plan starts: three adjoining buttons
  "Run now", "After run…", "Queue", the suggested one tagged "Jarvis suggests" (muted), the reason line under it, and for
  After an inline checklist of the project's live runs (title, shared files; held runs disabled with "held: land it
  first"). The launcher calls `RunStartSuggestCommand` on open and again 400 ms after the goal, plan, project or spec
  changes; Start never waits for it.
- `launchermodal.tsx`: Start with Run now is today's `startRunInBackground`; with After or Queue it calls
  `queueLauncherRun`, closes the dialog, and tells the handback `queued(entry.id)` (an error stays in the dialog).

Acceptance:
- `npx vitest run frontend/app/view/agents/launcherwhen.test.ts frontend/app/view/agents/launcherrun.test.ts frontend/app/view/jarvis/newrun.test.ts frontend/app/view/agents/runactions.test.ts`:
  a suggestion after a hand pick keeps the pick; "Checking…", "Couldn't check: …" and a quota note's second line; labels
  for each choice and one and two ticked runs; a held run cannot be ticked; the spec path and the brainstorm reach the
  queue call with the same create data.
- `task check:ts` clean.
- Scenario `run-start-choice` in `scripts/cdp/scenarios-run-start-choice.mjs` — the steps that hold whichever answer the
  RPC gives (in this task's tree it is Task 1's stub; at Final the real one), one shot each: (1) + Run with a goal: the
  When row and its reason line (the stub's "Couldn't check: run start suggestions are not built yet" in-tree); (2) After
  run… picked with nothing ticked: Start disabled, "Pick a run to wait for"; (3) Queue picked: Start reads "Queue";
  (4) Start pressed: the dialog closes and `runqueuelist` holds the entry. Teardown dequeues what it made. Steps that
  need the real suggestion are Task 6's `run-start-choice-live`.

### Task 6: The brainstorm card while queued, the live-suggestion scenarios, docs and changelog
**Depends on:** Task 4 (its scenarios need the real RunStartSuggestCommand and the brainstorm notice), Task 5
**Model:** sonnet
**Files:** `frontend/app/view/agents/brainstormmodel.ts`, `frontend/app/view/agents/brainstormmodel.test.ts`, `frontend/app/view/agents/brainstormsend.ts`, `frontend/app/view/agents/brainstormsend.test.ts`, `frontend/app/view/agents/brainstormstore.ts`, `frontend/app/view/agents/chatbrainstorm.ts`, `frontend/app/view/agents/chatbrainstorm.test.ts`, `frontend/app/view/agents/brainstormcheck.tsx`, `frontend/app/view/agents/chatbrainstormcheck.tsx`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/runqueuestore.ts`, `frontend/app/view/agents/runqueuestore.test.ts`, `skills/brainstorm/SKILL.md`, `scripts/cdp/scenarios-run-start-choice.mjs`, `docs/guide/orchestrator.md`, `CHANGELOG.md`

Decisions (spec "Every run launcher" and the builder's "Brainstorm Approve that queues"):
- `runPrefill` sets `specPath` (the absolute spec); `openRunLauncher` sets the prefill's `brainstorm: { tab: agent.id,
  path }` and a handback `queued(entryId)` that sends the agent `brainstorm: queued <q-id>` (a new `BrainstormAction`
  kind `queued`; any Chat parser of `brainstorm:` lines — grep `brainstorm: run` — draws it like the other lines) and
  sets the starting mark to `{ runId: null, entryId }`.
- Chat's run row for the server's line: when `runqueue:changed` names a started entry, `runqueuestore.ts` looks up that
  entry's `brainstorm` in the list it held before the event, and records a `run` answer for the agent on that tab (the
  record `sendBrainstorm` writes, `recordBrainstormAnswer`), so Chat pairs the server's `brainstorm: run <id>` line with
  it and draws the run row.
- Card: pure `queuedForBrainstorm(entries, started, path, mark)` in `brainstormmodel.ts` → `{ state: "waiting", after?:
  string } | { state: "blocked", reason: string } | { state: "started", runId } | null`. `approveBlocker` and the two
  Approve bars (`brainstormcheck.tsx`, `chatbrainstormcheck.tsx`) show "Queued" / "Queued after <titles>" / the block
  reason in place of Approve; a started entry counts as the run starting (Approve off); an entry gone without a start
  turns Approve on and clears the mark. Entries come from `runQueueAtom`, starts from `runQueueStartedAtom`
  (`chatpane.tsx` passes them where it passes `starting`).
- `skills/brainstorm/SKILL.md`: a row for `brainstorm: queued <id>` — "The run is queued: record nothing; `brainstorm:
  run <id>` follows when it starts" — and the Run paragraph says Approve may queue.
- `docs/guide/orchestrator.md` (Vietnamese): the launcher's When row, Jarvis's suggestion and its reason, the re-check
  when an entry's turn comes. `CHANGELOG.md`: one `Added` line under the top Unreleased section (open one if the top
  has a date), written for the user, marked `<!-- big -->`.

Acceptance:
- `npx vitest run frontend/app/view/agents/brainstormmodel.test.ts frontend/app/view/agents/brainstormsend.test.ts frontend/app/view/agents/chatbrainstorm.test.ts frontend/app/view/agents/runqueuestore.test.ts`:
  the queued line's text; each `queuedForBrainstorm` state; Approve off while waiting, the block reason when blocked, on
  again once the entry is removed; the handback's `queued` sends the line and sets the mark; a started entry with a
  brainstorm records a `run` answer for its agent.
- `task check:ts` clean.
- Scenario `run-start-choice-live` (in `scripts/cdp/scenarios-run-start-choice.mjs`), one shot per step: (1) a deferred
  fixture run in the project whose goal names `pkg/orchestrate/land.go`, then + Run with a goal naming the same file:
  After run… preselected, "Jarvis suggests" on it, the reason naming the file, Start reading "Queue after <title>";
  (2) the After checklist open with that run ticked; (3) a second fixture run naming the file, seeded with its land held:
  listed, not tickable, "held: land it first"; (4) a goal naming no file: "The goal names no files: only the run cap was
  checked". Teardown cancels what it made.
- Scenario `run-start-choice-brainstorm` (same module; the kit's brainstorm helpers, as `scenarios-brainstorm-run.mjs`
  uses them): a brainstorm agent with an approved design — (1) set `runs:maxactive` to the active count and queue an
  entry with `brainstorm: { tab, path }` and no After: the card reads "Queued"; (2) an entry after a deferred fixture
  run: "Queued after <title>"; (3) cancel that run: the card shows the block reason; (4) dequeue both: Approve is back.
  Teardown restores the setting.

# Workflow scan, core only: the engine reads its own run records and proposes fixes

**Verify:** `node scripts/verify.mjs ./pkg/workflowscan/... ./pkg/waveobj/... ./pkg/wshrpc/... ./pkg/wstore/... ./pkg/jarvis/... ./cmd/wsh/...`
**Check:** `task check:ts && go vet ./pkg/waveobj/... ./pkg/wshrpc/... ./pkg/wstore/... ./pkg/jarvis/... ./cmd/wsh/... && { [ ! -d pkg/workflowscan ] || go vet ./pkg/workflowscan/...; }`
**Final:** `node scripts/cdp/final-verify.mjs workflow-scan-entry`

## Context for every task

Port of the kaeltran16 fork's workflow scan (`kael` remote, `kael/main` at `16b726ffd`). Read the fork's spec first:
`git show kael/main:docs/superpowers/specs/2026-10-26-workflow-scan-design.md`. In short: a scan builds a corpus of
the last 14 days of engine run records (failure and correction signals, no transcripts, 640k-char cap), a Sonnet
pass names patterns seen in 3+ runs with one verbatim quote per run and a named fix target, code recounts the quotes
and drops what does not hold, and an Opus quick run checks the survivors against the code and `docs/deferred.md`,
proposes a small edit to the prompt or config behind each, takes the owner's picks, applies and commits only the
picked ones in its own repo, and files the dropped ones as declined.

**What differs from the fork (the cheap port):** no Workflow lens on Usage (`workflowlens*.ts`, `usagesurface.tsx`
changes, `workflowscanstart.ts`, the `workflow` usage lens value in `pkg/jarvis/usage.go` and `usagestore.ts`, the
fork's `workflow-scan` CDP scenario) and no new Needs you item kind (no `palette-needs`, `briefingmodel` or
`attentionpopuptarget` changes). The Opus agent presents its proposals and takes the picks itself with Claude Code's
`AskUserQuestion` (one question per proposal: Apply / Drop, a reason in Other), which arcterm already projects into
the cockpit as an agent waiting on you. A fix whose target is in another project is shown as text to copy, never
applied. Because the picks never leave the agent, **these fork parts are dropped**: `WorkflowScanPicksCommand`,
`GetWorkflowScanCommand`, `WorkflowScanPick` and `WorkflowScan.Picks`, the `applying` state, `workflowscan.PicksLine`,
`workflowscan.ValidatePicks`, `wsh workflow picks`, and commit `19c627337` (it resumed a closed agent to deliver lens
picks). The scan state stays `picking` while the agent asks; the run's own Done/Cancelled ends it.

Port, don't cherry-pick blindly: our tree has diverged (tabbed Usage, our attention model, our palette). Go is the
source of truth for wire types; change the Go and run `task generate`, never hand-edit `frontend/types/gotypes.d.ts`,
`frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go` or `pkg/{waveobj,wconfig}/metaconsts.go`.
Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash). `Run` is an existing
registered type, so its new fields need no migration; add one only if you register a new `waveobj` type.

### Task 1: Wire types and stub RPCs
**Depends on:** none

The interface every other task builds on, from `e3b028b62`'s Go half only. In `pkg/waveobj/wtype.go`:
`Run.WorkflowScan`, `Run.ConsultSessions`, `WorkflowScan` (without `Picks`), `WorkflowScanPattern`,
`WorkflowScanProject`, `WorkflowScanQuote`, `WorkflowScanVerdict`, and the state/stage/verdict constants (no
`applying`, no pick constants). `pkg/wshrpc/wshrpctypes_workflowscan.go` with three commands only:
`WorkflowScanStartCommand`, `WorkflowScanCommand`, `WorkflowScanResultCommand` and their data types, composed into
`wshrpctypes.go`. `pkg/wshrpc/wshserver/wshserver_workflowscan.go` with the three methods as stubs returning a
"not implemented" error. Run `task generate`.

Files: `pkg/waveobj/wtype.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshrpctypes_workflowscan.go`,
`pkg/wshrpc/wshserver/wshserver_workflowscan.go`, and the generated files.

Acceptance: `go build ./pkg/... ./cmd/...` passes; `task generate` run again leaves no diff; the three commands appear
in `frontend/app/store/wshclientapi.ts` and the types in `frontend/types/gotypes.d.ts`; `task check:ts` is clean.

### Task 2: The scan package: corpus, Sonnet prompt, recount, validation, the agent's instructions
**Depends on:** Task 1

Commit `f594b3b87` (`pkg/workflowscan`: `corpus.go`, `recount.go`, `sonnet.go`, `validate.go`, `goal.go` and their
tests; `liveprobe_test.go` only if it skips cleanly without a store snapshot), minus `PicksLine` and `ValidatePicks`
and their tests. `sonnet.go` builds the Sonnet prompt and parses its reply; the call itself is Task 3's. The corpus
reads our run records: check each signal the fork's corpus reads against the fields our `Run`/DAG records actually
carry, and drop or remap the ones we lack (list them in the commit message).

`goal.go` is the scan agent's built-in instructions. Set `arcProject` to `"arcterm"` (this repo's project name, not
the fork's `waveterm`). Rewrite the fork's step 5 (wait for the picks line, then `wsh workflow picks`): the agent asks
the owner with `AskUserQuestion`, one question per suggest verdict with options Apply and Drop (a reason in Other),
then applies an Apply in this repo, files a Drop as the fork's Declined entry in `docs/deferred.md`, and shows a
suggestion whose `fixproject` is another project as text to copy, never applying it. Steps 1–4 and 6 stay as the fork
has them (`wsh workflow scan`, `wsh workflow result`, the commit and `wsh jarvis complete`).

Copy the spec to `docs/superpowers/specs/2026-10-26-workflow-scan-design.md`, write the differences in the Context
above into its "where suggestions show", and mark its lens, Needs you, Picks, Lens states and CDP sections
"Superseded in arcterm: <one line why>" rather than deleting them.

Files: `pkg/workflowscan/*`, `docs/superpowers/specs/2026-10-26-workflow-scan-design.md`.

Acceptance: `corpus_test.go`, `recount_test.go`, `sonnet_test.go` and `validate_test.go` pass; a `goal_test.go`
checks `Goal` names `AskUserQuestion`, `"arcterm"`, `wsh workflow scan` and `wsh workflow result`, and never
`wsh workflow picks`.

### Task 3: The scan in wavesrv and `wsh workflow`
**Depends on:** Task 2

Fill the Task 1 stubs from `4a30d4f2a` (wavesrv steps, the Sonnet pass run as a consult session pinned to
claude/sonnet with its session recorded in `Run.ConsultSessions`, `pkg/wstore/wstore_workflowscan.go`,
`wsh workflow scan [--start] | result`, without `picks`), `962792522` (one scan at a time across projects; its
`wshserver_landing_test.go` isolation change too if our test needs it), and `530ef1733` (Usage attributes a run's
consult sessions to the run). Skip `19c627337` and every picks or `GetWorkflowScan` path. `WorkflowScanStartCommand`
creates the scan as a quick claude/opus run whose goal is `workflowscan.Goal(...)`.

Update `skills/runs` (never the claude-mod copy) with one line on `wsh workflow scan`. Add one `CHANGELOG.md` line
under `## Unreleased` → `Added` for the whole feature (a palette command starts a workflow scan that proposes fixes
from your recent runs and asks which to apply), and a
`- [ ] (arcterm) Kael sync: run a real workflow scan …` line in `docs/hand-checks.md` (a real scan: the Sonnet pass
returns, the agent asks one question per proposal, an Apply lands as a commit, a Drop lands in `docs/deferred.md`).

Files: `pkg/wshrpc/wshserver/wshserver_workflowscan.go` (+ `_test.go`), `pkg/wshrpc/wshserver/wshserver_runs.go`,
`pkg/wshrpc/wshserver/sessionruns.go`, `pkg/wshrpc/wshserver/usagesessions.go` (+ `_test.go`),
`pkg/wstore/wstore_workflowscan.go` (+ `_test.go`), `pkg/wstore/wstore_channel.go` (+ `_test.go`),
`cmd/wsh/cmd/wshcmd-workflow.go` (+ `_test.go`), `skills/runs/`, `CHANGELOG.md`, `docs/hand-checks.md`.

Acceptance: `wshserver_workflowscan_test.go` (start, scan, result, one scan at a time across projects),
`wstore_workflowscan_test.go`, `usagesessions_test.go`, `wstore_channel_test.go` and `wshcmd-workflow_test.go` pass;
`wsh workflow --help` lists `scan` and `result` and no `picks`.

### Task 4: The `workflowscan:` address and the palette's Scan workflow row
**Depends on:** Task 1

The address: `workflowscan:<runid>` parses in `frontend/app/view/jarvis/address.ts` to its own `workflowscan` kind,
and `openref.ts` lands it on the scan run's agent (its worker tab, through the existing agent selection, as the
`agent` kind does) when the run has a live agent, else on the run's own sheet as `run:` does. It is not peekable (it
always opens). No Usage lens, no `workflowScanRunAtom`.

The palette: a "Scan workflow" Start row in `frontend/app/cockpit/palette-commands.ts`, shown only when the palette
has a home project (`meta` `#<project>`, verb Start, echo "Starts a scan and opens its agent", no binding, so
`START_BINDINGS` skips rows without one), rendered by `command-palette.tsx`'s existing Start rows. Its start helper
lives in a new `frontend/app/cockpit/palette-scan.ts`: it calls `RpcApi.WorkflowScanStartCommand` (60 s timeout:
creating the run starts the agent's tab) with the home project's channel and the workspace, then
`openTarget(model, { kind: "workflowscan", runId })`; an error shows as the palette's usual action error, never
swallowed. Our tree has no `palette-items.ts`/`startRows`; adapt `ba040a2a1`'s palette part to where our Start rows
are built.

The scenario: add `workflow-scan-entry` to `scripts/cdp/scenarios.mjs`, rewritten from the fork's (`ba040a2a1`) with
only these steps, never firing the row (that starts a real Opus agent):
1. With a registered fixture project active, typing `scan` in the palette shows the Scan workflow row under Start with
   `#<fixture>`, verb Start and its echo.
2. A deferred quick run (`createrun` with `deferstart: true`) seeded with a `workflowscan` state in `picking` (via
   `fstWriteRun`), opened through the address `workflowscan:<runid>` the way other scenarios open an address, shows
   that run's sheet (it has no live agent).
Teardown deletes the run and the project as the fork's does.

Files: `frontend/app/view/jarvis/address.ts` (+ `.test.ts`), `frontend/app/view/jarvis/openref.ts`,
`frontend/app/cockpit/palette-commands.ts` (+ `.test.ts`), `frontend/app/cockpit/palette-scan.ts` (+ `.test.ts`),
`frontend/app/cockpit/command-palette.tsx`, `scripts/cdp/scenarios.mjs`.

Acceptance: `address.test.ts` parses `workflowscan:<id>` and refuses `workflowscan:` with no id;
`palette-commands.test.ts` shows the Scan workflow row only with a home project; `palette-scan.test.ts` (RpcApi and
`openTarget` mocked) opens the returned run and rethrows a start error; `task check:ts` is clean;
`task verify:ui -- workflow-scan-entry` passes steps 1 and 2.

# Rail Verify Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show each agent's CDP scenario results on its rail as a Verify tile (failed, no result, not run, out of
date, passed, skipped), with a header chip, a strip count, Ask the agent to rerun, Skip, and an ask before the agent
merges into the default branch while Verify is red or amber.

**Architecture:** The scenario harness reports each run to wavesrv through `wsh verify report`; `pkg/verifyruns`
keeps the newest run per scenario per block, derives the state (pid liveness, git changes against
`.arc/verify.json`'s watch globs, skips) and serves it over wshrpc with a `verify:changed` event. The cockpit draws the
tile from a pure model; the arc mod asks `wsh verify gate` before a merge.

**Tech Stack:** Go (wshrpc, wps, gopsutil), React 19 + jotai + Tailwind 4, Node ESM scripts (CDP harness), the
Claude Code arc mod (TypeScript).

**Spec:** `docs/superpowers/specs/2026-11-20-rail-verify-design.md` — read it first; it is the source of truth for
copy, states and colours.

**Prototype:** D:/work/arcterm/.superpowers/design/rail-verify/project

**Verify:** `node scripts/verify.mjs ./pkg/wshrpc/... ./cmd/wsh/...`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs rail-verify`

---

### Task 1: the wire contract — Verify RPC types, the verify:changed event, generated bindings

**Depends on:** none

**Files:** `pkg/wshrpc/wshrpctypes_verify.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `pkg/wshrpc/wshserver/wshserver_verify.go`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go`

Where each goes:
- Create: `pkg/wshrpc/wshrpctypes_verify.go` (follow `wshrpctypes_services.go`)
- Modify: `pkg/wshrpc/wshrpctypes.go` (embed `VerifyCommands` beside `ServicesCommands`, line ~44),
  `pkg/wps/wpstypes.go` (`Event_VerifyChanged = "verify:changed" // type: wshrpc.VerifyChangedData`, and add it to the
  list at ~95), `pkg/tsgen/tsgenevent.go` (map the event to its type, as `Event_ServicesChanged` at ~52)
- Create, only if `go build ./...` needs the server to satisfy the interface: `pkg/wshrpc/wshserver/wshserver_verify.go`
  with the four methods returning `errors.New("verify: not wired yet")`; Task 3 replaces their bodies.
- Generated: `task generate` writes `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`,
  `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go` (never hand-edit them).

**Step 1: types.**

```go
type VerifyCommands interface {
    VerifyReportCommand(ctx context.Context, data CommandVerifyReportData) error
    GetVerifyStateCommand(ctx context.Context, data CommandVerifyStateData) (*VerifyStateData, error)
    VerifySkipCommand(ctx context.Context, data CommandVerifySkipData) error
    VerifyGateCommand(ctx context.Context, data CommandVerifyGateData) (*VerifyGateData, error)
}
```

JSON tags all lowercase, as the spec's report shows: `CommandVerifyReportData{blockid, runid, phase, pid, cwd,
command, shotsdir, scenarios[{name, files, steps[{step, state, detail}], done}], reason}` (no `watch`: wavesrv reads
`.arc/verify.json`); `CommandVerifyStateData{blockid, cwd}`; `VerifyStateData{rows[{scenario, state, passed, total,
failed, done, of, command, shotsdir, reason, shots, started, ended, changedfile}], verdict, notrun, notrunskipped,
changed, rerun}` (`shots`: that scenario's screenshot count); `CommandVerifySkipData{blockid, scenario, undo}`;
`CommandVerifyGateData{blockid, cwd, command}`; `VerifyGateData{ask, reason}`; `VerifyChangedData{blockid}`.

**Step 2:** `task generate`; `go build ./...`; `go test ./pkg/wshrpc/... ./pkg/tsgen/...`. Commit the Go files and the
generated files by path.

### Task 2: pkg/verifyruns — store, state derivation, gate

**Depends on:** none

**Files:** `pkg/verifyruns/verifyruns.go`, `pkg/verifyruns/state.go`, `pkg/verifyruns/glob.go`, `pkg/verifyruns/gitchanges.go`, `pkg/verifyruns/gate.go`, `pkg/verifyruns/state_test.go`, `pkg/verifyruns/glob_test.go`, `pkg/verifyruns/gate_test.go`, `pkg/verifyruns/gitchanges_test.go`, `pkg/verifyruns/verifyruns_test.go`, `.arc/verify.json`

Where each goes:
- Create: `pkg/verifyruns/verifyruns.go`, `pkg/verifyruns/state.go`, `pkg/verifyruns/glob.go`,
  `pkg/verifyruns/gitchanges.go`, `pkg/verifyruns/gate.go`
- Test: `pkg/verifyruns/state_test.go`, `pkg/verifyruns/glob_test.go`, `pkg/verifyruns/gate_test.go`,
  `pkg/verifyruns/gitchanges_test.go`, `pkg/verifyruns/verifyruns_test.go`
- Create: `.arc/verify.json`

This package defines its own plain structs (no wshrpc import); Task 3 converts them to the wire types of Task 1. Keep
every function that decides something pure and test it table-driven. It must not import the store (`wstore`), so its
tests need no cgo.

**Step 1: config and globs.** `.arc/verify.json`:

```json
{ "watch": ["frontend/**/*.tsx", "frontend/**/*.css"], "rerun": "task verify:ui -- <name>" }
```

`glob.go`: `func Match(pattern, rel string) bool` — forward slashes, `**` matches any number of path segments
(including none), `*` matches within one segment. `func LoadConfig(repoRoot string) (*Config, error)` returns
`nil, nil` when the file is absent. Tests: `frontend/**/*.tsx` matches `frontend/a.tsx` and `frontend/x/y/b.tsx`, not
`frontend/a.ts` or `scripts/a.tsx`; backslash paths are normalised by the caller.

**Step 2: the run record.**

```go
type Step struct{ Step, State, Detail string }            // State: pass | fail | skip
type Scenario struct{ Name string; Files []string; Steps []Step; Done bool }
type Report struct {
    BlockId, RunId, Phase string // Phase: start | progress | end
    Pid int; Cwd, Command, ShotsDir, Reason string
    Scenarios []Scenario
}
type Run struct { // the newest report of one run, merged
    RunId string; Pid int; Cwd, Command, ShotsDir, Reason string
    Scenarios []Scenario; Started, Updated int64; Ended bool
}
type BlockFile struct {
    Runs  map[string]Run   // scenario name -> the newest run that named it
    Skips map[string]int64 // scenario name, or "" for the not-run warning -> when skipped (ms)
}
```

`Apply(bf BlockFile, r Report, now int64) BlockFile`: a `start` creates the run for each named scenario (replacing an
older run of that scenario); a repeat `start` of the same `RunId` (verify.mjs under Final) adds its scenarios to that
run and keeps its first `Pid`, `Command` and `Started`; `progress`/`end` update the scenarios of the same `RunId`
(their `Files` and `Steps`), keep the first `Pid`, set `Ended` on `end`. A report for a scenario whose newest run has
another RunId and an older Started is ignored. A new run of a scenario clears its skip. Tests cover: start then end;
a repeat start of one run id keeps Final's pid and command; an end from a child with a different pid keeps the first;
a stale report from an older run does not overwrite; skip cleared by a new run.

**Step 3: state derivation (`state.go`).**

```go
type Row struct {
    Scenario, State string // running | passed | failed | noresult | outofdate | skipped
    Passed, Total int; Failed []string
    Done, Of int          // scenarios finished in its run, of how many: for running
    Command, ShotsDir, Reason string; Shots int // Shots: len(that scenario's Files)
    Started, Ended int64; ChangedFile string // outofdate: the newest watched change
}
type State struct {
    Rows []Row; Verdict string // "" | running | passed | amber | red
    NotRun bool; NotRunSkipped bool; Changed []string; Rerun string
}
func Derive(bf BlockFile, alive func(pid int) bool, changed []Change, rerun string) State
type Change struct{ Path string; Mtime int64 }
```

Rules (spec, "States"): not ended + pid alive = running; not ended + pid gone = noresult; ended with `Reason` and no
steps = noresult; ended with a fail step = failed; else passed; a passed run whose `Ended` < newest changed mtime =
outofdate with `ChangedFile`; a skip newer than both the run's end and the newest change = skipped. NotRun = some
watched change and no run at all ended after the newest change; skipped by `Skips[""]` when that skip is newer than
the newest change. Rows sort failed, noresult, running, outofdate, passed, skipped, then newest first. Verdict: red if
any failed; else amber if any noresult/outofdate or NotRun (not skipped); else running if any running; else passed if
any rows; else "". Table tests for every row of the spec's state table, including the skip expiring on a newer change,
and out of date alone (verdict amber).

**Step 4: git changes (`gitchanges.go`).** `func WatchedChanges(ctx context.Context, cwd string, cfg *Config) (changes []Change, branch, defaultBranch string, err error)`:
repo root from `git rev-parse --show-toplevel`; the branch from `git rev-parse --abbrev-ref HEAD`; the default branch
and merge base from `gitinfo.BranchBase` (`pkg/gitinfo`; its default can come back as `origin/main`, so strip an `origin/`
prefix before comparing it with the branch); changed = `git status --porcelain` paths ∪ (when the branch is not the default)
`git diff --name-only <merge-base>..HEAD`; keep the ones `Match`ing a watch glob; `os.Stat` each for its mtime (a
deleted file uses now). Test against a temp repo made with `git init` (see `pkg/gitinfo`'s tests for the helper
pattern): an uncommitted watched edit; a committed one on a branch; on the default branch only uncommitted files count;
an unwatched edit is left out.

**Step 5: persistence (`verifyruns.go`).** A `Store` with a mutex: `dir` = `filepath.Join(wavebase.GetWaveDataDir(),
"verify")` (a constructor taking the dir, so tests pass a temp one); `Report(r Report) error` loads `<blockid>.json`,
`Apply`, writes atomically (temp + rename), then calls an `onChange(blockId)` hook the server sets (Task 3 publishes the
event there); `Skip(blockId, scenario string, undo bool)`; `Forget(blockId string)` removes the block's file;
`State(ctx, blockId, cwd string) (State, error)` — `LoadConfig(root)`, nil config → empty State; else `Derive` with
`process.PidExists` (gopsutil v4, as `wshserver_jobqueue.go` uses) and `WatchedChanges`. `Sweep()` deletes block files
not modified for 30 days (Task 3 calls it at startup). Test with a temp dir: report → file written → State reads it;
Skip and undo; Forget removes the file; Sweep removes only old files.

**Step 6: the gate (`gate.go`).** `func Gate(st State, branch, defaultBranch string, isMerge bool) (ask bool, reason string)`:
ask only when `isMerge`, `branch == defaultBranch`, and Verdict is red or amber (skips already left out by `Derive`).
Reason, e.g. `Verify: chat-council-card failed steps 7, 8, 9; rail-council-tab has no result. Merge anyway?` (failed →
`failed steps N, M`; noresult → `has no result`; outofdate → `passed before <file> changed`; NotRun → `UI files changed
and no scenario ran`). Step numbers are the leading `N.` of each failed step text. Tests for each part and their
joining, and that a non-default branch never asks.

**Step 7:** `go test ./pkg/verifyruns/...` passes. Commit:
`git commit -m "feat(verify): pkg/verifyruns keeps each agent's scenario runs and derives its Verify state" -- pkg/verifyruns .arc/verify.json`

### Task 3: wavesrv serves Verify, and `wsh verify`

**Depends on:** Task 1 (implements the VerifyCommands it declares), Task 2 (serves its Store, State and Gate)

**Files:** `pkg/wshrpc/wshserver/wshserver_verify.go`, `pkg/wshrpc/wshserver/wshserver_verify_test.go`, `cmd/wsh/cmd/wshcmd-verify.go`, `cmd/wsh/cmd/wshcmd-verify_test.go`, `cmd/server/main-server.go`

Where each goes:
- Create or fill: `pkg/wshrpc/wshserver/wshserver_verify.go` (Task 1 may have left stubs: replace their bodies)
- Create: `pkg/wshrpc/wshserver/wshserver_verify_test.go`, `cmd/wsh/cmd/wshcmd-verify.go`,
  `cmd/wsh/cmd/wshcmd-verify_test.go`
- Modify: `cmd/server/main-server.go` (where the other stores and `services` start: create the Store, `Sweep()` it,
  set `onChange` to publish `Event_VerifyChanged` with the block id as scope, and subscribe to `Event_BlockClose` to
  `Forget` the block, the way `pkg/services/real.go:417` does)

**Step 1: server.** Convert to and from `verifyruns` structs. `VerifyReportCommand` drops a report whose block id is
not in the store (`wstore.DBGet[*waveobj.Block]` returns nil) with a debug log and no error. `VerifyGateCommand`: the mod
decides it is a merge and only then calls the gate, so it passes `isMerge = true`; `State` gives the branch and default
branch from `WatchedChanges` (Task 2), and `Gate` decides. Server tests in `wshserver_verify_test.go` with a temp data
dir (on Windows with the `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` prefix from AGENTS.md, since the store
is opened): report → state; a report for an unknown block is dropped; the gate on a non-default branch never asks.

**Step 2: `wsh verify`.** Subcommands, block id from `WAVETERM_BLOCKID` (error `not in an arcterm agent's terminal`
when unset), JSON in/out:
- `wsh verify report` — reads one report JSON on stdin, fills `blockid`, sends it. Exits 0 silently.
- `wsh verify status [--cwd DIR]` — prints `VerifyStateData` as JSON (cwd defaults to the working directory).
- `wsh verify gate --cwd DIR --command CMD` — prints `{"ask":…,"reason":…}`.
Test the flag parsing and the missing-block error in `wshcmd-verify_test.go`, as `wshcmd-jobslot_test.go` does.

**Step 3:** `go build ./...`; `go test ./pkg/wshrpc/... ./cmd/wsh/...` (cgo prefix on Windows). Commit by path.

### Task 4: the harness reports its runs

**Depends on:** none

**Files:** `scripts/cdp/report.mjs`, `scripts/cdp/report.test.mjs`, `scripts/cdp/verify.mjs`, `scripts/cdp/final-verify.mjs`, `scripts/cdp/final-verify.test.mjs`

Where each goes:
- Modify: `scripts/cdp/report.mjs` (add `makeRunReporter`), `scripts/cdp/report.test.mjs`,
  `scripts/cdp/verify.mjs` (around the scenario loop, lines ~92–140), `scripts/cdp/final-verify.mjs`,
  `scripts/cdp/final-verify.test.mjs`
- Do not run prettier on `scripts/*.mjs` (AGENTS.md).

The report's shape is the spec's ("The harness reports its runs"); wsh's side lands in Task 3, so this task tests
against a stub `spawn` only.

**Step 1: the reporter, tested first.** In `report.mjs`:

```js
// reports one run to wavesrv through `wsh verify report`, only inside an agent's terminal; a failure is logged once
export function makeRunReporter({ env = process.env, spawn = spawnSync, now = Date.now, log = console.log } = {}) { … }
// returns { start(names, command), scenarioDone(result, files), end(results, shotsByScenario, shotsDir), unverified(reason) }
```

- Active only when `env.WAVETERM_BLOCKID` is set; `wsh` is `join(env.WAVETERM_WSHBINDIR, "wsh")` (plus `.exe` on
  Windows) when that dir is set, else `wsh` on PATH.
- `runid` = `env.ARC_VERIFY_RUNID` or a new `randomUUID()`; `command` = `env.ARC_VERIFY_COMMAND` or the one given;
  `pid` = `process.pid` (Final passes its run id, so the first pid wavesrv keeps is Final's).
- Each report is `spawn(wsh, ["verify", "report"], { input: JSON.stringify(doc) })`; a nonzero exit or a throw logs
  `verify report: <why>` the first time only and never throws. No `watch` field.
- `scenarioDone` sends `progress` with every scenario so far (`done: true` for finished ones, `files` and steps in
  `shotsManifest`'s shape); `end` sends the final `shotsManifest(results, shotsByScenario)` and `shotsdir` made
  absolute (`resolve`); `unverified(reason)` sends `end` with `reason` and no steps.
Tests with a stub `spawn` and env: inactive without the block id; start/progress/end documents (files per scenario,
absolute shotsdir); the env run id and command win; a failing spawn logs once and later reports still go.

**Step 2: verify.mjs.** Create the reporter before the loop; `start(chosen.map(s => s.name), "task verify:ui -- " +
names.join(" "))`; after each scenario's `finally` (once `shotsByScenario[scenario.name]` is set) `scenarioDone(...)`;
after `shots.json` is written, `end(...)`. A run with no names (every scenario) uses `task verify:ui`.

**Step 3: final-verify.mjs.** Before starting the app: a reporter with command `node scripts/cdp/final-verify.mjs
<names>` and `start(names)`; `verifyEnv` (line ~355) adds `ARC_VERIFY_RUNID` and `ARC_VERIFY_COMMAND` to the env of the
`verify.mjs` it spawns (take them as parameters); wherever it exits with `EXIT_UNVERIFIED` (3), call
`unverified(<the last line it prints>)` first. In `final-verify.test.mjs`: extend the `verifyEnv` test (~283) to assert
the two vars, and add a test that an unverified exit reports its reason (follow that file's existing stubs).

**Step 4:** `npx vitest run scripts/cdp/report.test.mjs scripts/cdp/final-verify.test.mjs` passes. Commit by path.

### Task 5: the cockpit's Verify model and store

**Depends on:** Task 1 (uses the generated Verify RPC types and the verify:changed event)

**Files:** `frontend/app/view/agents/verifymodel.ts`, `frontend/app/view/agents/verifymodel.test.ts`, `frontend/app/view/agents/verifystore.ts`

Where each goes:
- Create: `frontend/app/view/agents/verifymodel.ts`, `frontend/app/view/agents/verifymodel.test.ts`,
  `frontend/app/view/agents/verifystore.ts`

**Step 1: the pure model, tests first.** From a `VerifyStateData`:

```ts
export type VerifyTone = "red" | "amber" | "green" | "muted";
export interface VerifyTileVM {
    shown: boolean; folded: boolean;           // folded: everything passed or skipped
    head: { parts: { text: string; tone: VerifyTone }[]; count: string }; // "1 failed", "1 no result", "1 out of date"; "3 scenarios"
    warning: { text: string; skippable: boolean } | null; // the amber line (out of date or not run)
    rows: VerifyRowVM[];
    chip: { text: string; tone: "red" | "amber"; title: string } | null;
    strip: { tone: VerifyTone; label: string; struck: boolean; pulsing: boolean } | null; // "2", "!", "3"
}
export interface VerifyRowVM {
    key: string; name: string; tone: VerifyTone; result: string; age: string; startsOpen: boolean;
    note: string | null; failed: string[]; passedMore: number; command: string;
    shots: string | null; // "Open the 9 screenshots" from the row's shots count, null when 0
    shotsDir: string; canRerun: boolean; canSkip: boolean; skipped: boolean;
}
export function verifyTile(st: VerifyStateData | null, now: number): VerifyTileVM;
export function rerunLine(row: VerifyRowVM | "notrun", st: VerifyStateData): string;
```

Copy is the spec's, word for word (rows, notes, warning lines, chip texts, rerun lines). The head verdict follows the
spec's head-row rule: every red or amber kind present, in row order, joined by ` · ` (`1 failed · 1 no result · 1 out
of date`), plus `not run` for the not-run warning; with none, `running` or `N passed`. One `it` per row of the spec's
state table (each asserting dot/result, head, chip and strip), including out of date alone (chip `Verify: out of
date`, strip `!` amber) and no result alone (chip `Verify: no result`), plus: the not-run line naming `<file> and N
more UI files`; `age` formatting (`3m`, `2h`, `1d`, as the rail's other ages; reuse the helper the Background tasks
rows use for elapsed if it fits); folded only when every row is passed or skipped and there is no warning; `shown`
false for an empty state (config present, nothing changed or run).

**Step 2: the store.** `verifyStateAtom = atomFamily((blockId: string) => atom<VerifyStateData | null>(null))`;
`loadVerify(blockId, cwd)` calls `RpcApi.GetVerifyStateCommand(TabRpcClient, { blockid, cwd })`;
`useVerify(blockId, cwd)` loads on mount and when `cwd` changes, and subscribes once to `verify:changed`
(`waveEventSubscribeSingle`, as `servicesstore.ts` does) to reload the block named. `skipVerify(blockId, cwd,
scenario, undo)` calls `VerifySkipCommand` then reloads. Errors keep the last state and log once.

**Step 3:** `npx vitest run frontend/app/view/agents/verifymodel.test.ts` passes. Commit by path.

### Task 6: the tile, the strip count, the header chip, Rerun and Skip

**Depends on:** Task 5 (draws verifyTile and calls useVerify, skipVerify and rerunLine)

**Files:** `frontend/app/view/agents/railverify.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/agentrailsections.ts`, `frontend/app/view/agents/agentrailsections.test.ts`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/chatverdictsend.ts`

Where each goes:
- Create: `frontend/app/view/agents/railverify.tsx`
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx` (Overview body: after the session block and Needs you,
  before the counted sections; the count strip), `frontend/app/view/agents/agentrailsections.ts` (add `"verify"` to
  `AgentRailSectionId` so `revealSection("verify")` works; a new `AgentRailInput.verify` field — the tile's `strip`, or
  null — that `planRailStats` turns into a Verify stat after Background tasks and `planAgentRail` into the tile's place
  in the Overview plan), `frontend/app/view/agents/agentrailsections.test.ts` (the stat appears only with a non-null
  `verify`, after `bgtasks`; the section's place), `frontend/app/view/agents/agentheader.tsx` (chip after the state
  pill, `data-agent-state-pill` ~line 912), `frontend/app/view/agents/chatverdictsend.ts` (only if Step 2 extracts
  `sendAgentLine`)

Acceptance: Task 8's `rail-verify` steps 1–4 and 7–11 show what this task draws; build every data attribute they read.

**Step 1: the tile** (`railverify.tsx`), drawn as board `B-tile` of the Prototype: a `<section data-rail-section="verify"
data-verify-tile>` on `bg-surface-raised rounded-lg`; head row (`data-verify-head`); warning line
(`data-verify-warning`, `bg-askingbg text-warning-soft`, the triangle icon in `text-warning`); rows on `bg-surface
rounded-[8px]` with the dot, name, result, age, opening on click (`springReveal` from `element/motiontokens.ts`); a
row's body: the note (`data-verify-note`), failed steps (`✕` in `text-error`), `+ N passed`, the mono command line, the
screenshots link (`data-verify-shots`; opens the contact sheet `index.html` in `shotsDir` the way the rail opens a file
in the browser/preview; find how Artifacts opens an html file and reuse it), and the buttons **Ask the agent to rerun**
(secondary button) and **Skip** (text button); a skipped row shows `Skipped` and **Undo**. Data attributes for the
scenario: `data-verify-row=<scenario>`, `data-verify-state=<state>`, `data-verify-open`, `data-verify-rerun`,
`data-verify-skip`, `data-verify-undo`, `data-verify-error`, `data-verify-folded`. Tokens only (DESIGN.md):
`text-error`, `text-warning`, `bg-working pulse-dot-slow` for running (through `pulsedriver.tsx`), `text-muted`.
Folded: one line `Verify · 3 passed` that opens it (`springReveal`). No tile when `shown` is false.

**Step 2: Rerun.** Send `rerunLine(...)` with `sendCardLine` (`chatverdictsend.ts`) — its `record` argument keeps a
Chat answer record; pass a record function that returns the same shape `sendVerdict` builds, or, if that couples Verify
to Chat's verdict folding, extract the prompt/wake half of `sendCardLine` into `sendAgentLine(agent, line, io)` and
call that (keep `sendCardLine` using it). Either way the sent line must be readable by the scenario: through the
record (`chat.brainstorm.sent`, as `scenarios-chat-verdict-handoff.mjs` reads it), or, with `sendAgentLine`, through a
`PromptIO` the scenario can stub. A failed send shows its message under the row's buttons in `text-error`
(`data-verify-error`).

**Step 3: strip count and chip.** The strip draws the Verify stat from `planRailStats` (`data-rail-count="verify"`),
using a lucide monitor icon (`MonitorCheck`/`MonitorX` struck for failed/`Monitor` by tone); its click is
`openSection("verify")`. The header chip (`data-verify-chip`) shows `chip.text` with an `X` or triangle icon, `title`
= `chip.title`, fades in with opacity on the Fluid ease at `durMicro` (`motiontokens.ts`), and opens the rail on
Overview and reveals the tile (the rail's existing request path, `railsection.ts`, as the header's "N TO REVIEW" chip
does).

**Step 4:** `npx vitest run frontend/app/view/agents/agentrailsections.test.ts`; `task check:ts`; eslint and
prettier --check on the touched files. Commit by path.

### Task 7: the arc mod asks before a merge

**Depends on:** none

**Files:** `claude/arc-mod/hooks/verifygate-core.ts`, `claude/arc-mod/hooks/verifygate-core.test.ts`, `claude/arc-mod/hooks/register.ts`

Where each goes:
- Create: `claude/arc-mod/hooks/verifygate-core.ts`, `claude/arc-mod/hooks/verifygate-core.test.ts`
- Modify: `claude/arc-mod/hooks/register.ts`

The hook only shells out to `wsh verify gate` and reads `{ ask, reason }` (the contract in Task 3, Step 2); its tests
are pure, so it does not wait on the Go side.

**Step 1: the parser and the hook's decision, tests first.**
- `export function mergeTarget(command: string, cwd: string): { cwd: string } | null` — a `git merge` (not
  `--abort`, `--continue`, `--quit`, `--skip`) anywhere in a `&&`/`;`/`|`-joined command; honour a `git -C <dir>
  merge` and a preceding `cd <dir> &&` (relative dirs resolve against `cwd`); PowerShell's `;` too. Tests: `git merge
  --no-ff feat/x`, `cd /d/repo && git merge x`, `git -C ../main merge x`, `git merge --abort` (null), `git log --merges`
  (null), `echo git merge` inside quotes (null).
- `export function gateVerdict(gate: { ask: boolean; reason: string } | null, canAsk: boolean): { decision: "ask"; reason: string } | null`
  — null when the gate is null or does not ask; otherwise the gate's reason, and, when `canAsk` is false (nobody can
  be asked, `e.approver` set — mirror `foreignReason`'s `canAsk` in `foreignrepo-core.ts:76`), the reason adds that
  the model must ask the person before merging. Tests for both.
- `export function verifyGateArgs(target: { cwd: string }, command: string): string[]` — `["verify", "gate", "--cwd",
  target.cwd, "--command", command]`. A test pins it (the wiring test for the hand check below).

**Step 2: the hook.** In `register.ts`, a `tool.check` on `Bash` and on `PowerShell` (the mod already handles both in
`tool.call` at ~1043 and ~1064): `next(e)` first; on a deny return it; if `mergeTarget` finds a merge, run `[WSH,
...verifyGateArgs(target, command)]` through `$.process.run`, parse its JSON, and return `gateVerdict(gate,
e.approver === undefined) ?? verdict`. `.catch(passOn)` with a debug log, as the comment at ~344 asks for this kind of
hook. It sits beside `withUiCheck` (~525), the commit-time reminder; leave that as it is.

**Step 3:** `npx vitest run claude/arc-mod/hooks/verifygate-core.test.ts`; `claude plugin validate claude/arc-mod`;
`task check:ts` (it typechecks the mod). Commit by path.

### Task 8: the CDP scenario, CHANGELOG and docs

**Depends on:** Task 3 (seeds runs through the VerifyReportCommand it serves), Task 6 (checks the tile, chip, strip count and buttons it draws)

**Files:** `scripts/cdp/scenarios-rail-verify.mjs`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `public/whatsnew/<next minor>-rail-verify.webp`, `docs/agents/verify.md`, `docs/README.md`, `docs/hand-checks.md`

Where each goes:
- Create: `scripts/cdp/scenarios-rail-verify.mjs` (the `rail-verify` scenario, exported like
  `scenarios-agent-header.mjs`), `docs/agents/verify.md` (what `wsh verify report|status|gate` do, the report shape,
  `.arc/verify.json`, the merge ask), `public/whatsnew/<next minor>-rail-verify.webp` (written by `h.whatsnewShot`)
- Modify: `scripts/cdp/scenarios.mjs` (import it beside `agentHeaderScenarios`, line ~58, and list it the same way;
  touch nothing else in that file), `CHANGELOG.md`, `docs/README.md` (map the new docs/agents file),
  `docs/hand-checks.md` (the merge ask in a live Claude session: `- [ ] (arcterm) …`; its wiring is pinned by Task 7's
  tests)

**Step 1: the scenario.** Arrange a fixture agent with a block whose controller is a shell (so a line sent to it has
somewhere to go, as `scenarios-chat-verdict-handoff.mjs` arranges) in a temp git repo holding `.arc/verify.json` and a
`frontend/x.tsx`; seed runs from the page with `RpcApi.VerifyReportCommand` (the way other scenarios call RPCs from the
page), with `files` on each scenario. Steps, each with a shot:
1. failed + no result + out of date (board `B-tile`): the head reads `1 failed · 1 no result · 1 out of date`, the
   failed row is open with steps 7, 8, 9 and `Open the 9 screenshots`, the warning line names the file, the header chip
   reads `Verify: 1 failed`, the strip count is red. Take the What's new shot here.
2. a row opens and closes on click; the out-of-date row, opened, reads its note `Passed … before x.tsx changed.`
3. with the rail on another tab (or closed), a click on the header chip opens the rail on Overview with the tile in
   view; a click on the strip count scrolls to the tile.
4. Ask the agent to rerun sends the failed row's line: read the send (the record `chat.brainstorm.sent`, or the stubbed
   `PromptIO`, whichever Task 6 used); then a fixture agent whose send fails (its block gone) shows the error under the
   row's buttons (`data-verify-error`).
5. Skip on the no-result row: it reads `Skipped` with Undo, the head drops `1 no result`; Undo brings it back.
6. running (a report with `start` only and a live pid: use the scenario's own `process.pid`): `1 of 2`, pulsing dot,
   no chip.
7. a dead pid with no end: `No result`; chip `Verify: no result`, strip amber.
8. out of date alone (board `States`, "Ran before the last commit"): chip `Verify: out of date`, strip `!` amber.
9. all passed: the tile folds to `Verify · 2 passed`; a click opens it.
10. not run: only the warning line, chip `Verify: not run`; Skip on it clears the chip.
11. `.arc/verify.json` present with nothing changed or run: no tile, no chip, no strip count; then a repo without
    `.arc/verify.json`: the same.
Teardown removes the block files it made under the dev data dir's `verify/` and the temp repo.

**Step 2: CHANGELOG.** Under Unreleased → Added, one line for the person, ending with `<!-- big -->` and the shot from
step 1 (`await h.whatsnewShot("rail-verify", { selector: "[data-verify-tile]" })`, which prints the `<!-- shot: … -->`
comment), e.g.: `The agent rail shows your agent's UI checks in a Verify tile: a failed step in red, a run that never
finished or a UI change nobody checked in amber, with Ask the agent to rerun and Skip; the agent asks you before it
merges while Verify is red or amber.` `npx vitest run frontend/app/cockpit/whatsnew.test.ts`
passes.

**Step 3:** `node scripts/cdp/final-verify.mjs rail-verify` passes with `ARC_FINAL_OUT` set. Commit by path.

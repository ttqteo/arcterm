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

**Verify:** `node scripts/verify.mjs ./pkg/verifyruns/... ./pkg/wshrpc/... ./cmd/wsh/...`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs rail-verify`

---

### Task 1: pkg/verifyruns — store, state derivation, gate

**Depends on:** none

**Files:**
- Create: `pkg/verifyruns/verifyruns.go`, `pkg/verifyruns/state.go`, `pkg/verifyruns/glob.go`,
  `pkg/verifyruns/gitchanges.go`, `pkg/verifyruns/gate.go`
- Test: `pkg/verifyruns/state_test.go`, `pkg/verifyruns/glob_test.go`, `pkg/verifyruns/gate_test.go`,
  `pkg/verifyruns/verifyruns_test.go`
- Create: `.arc/verify.json`

The wire types live in `pkg/wshrpc` (Task 2 adds them there); this package defines its own plain structs with the same
JSON tags and Task 2 converts, so this task does not wait on Task 2. Keep every function that decides something pure
and test it table-driven.

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
type Scenario struct{ Name string; Steps []Step; Done bool }
type Report struct {
    BlockId, RunId, Phase string // Phase: start | progress | end
    Pid int; Cwd, Command, ShotsDir, Reason string
    Watch []string; Scenarios []Scenario
}
type Run struct { // the newest report of one run, merged
    RunId string; Pid int; Cwd, Command, ShotsDir, Reason string
    Scenarios []Scenario; Started, Updated int64; Ended bool; Shots int
}
type BlockFile struct {
    Runs  map[string]Run   // scenario name -> the newest run that named it
    Skips map[string]int64 // scenario name, or "" for the not-run warning -> when skipped (ms)
}
```

`Apply(bf BlockFile, r Report, now int64) BlockFile`: a `start` creates the run for each named scenario (replacing an
older run of that scenario); `progress`/`end` update the scenarios of the same `RunId`, keep the first `Pid`, set
`Ended` on `end`. A report for a scenario whose newest run has another RunId and an older Started is ignored. A new run
of a scenario clears its skip. Tests cover: start then end; an end from a child with a different pid keeps the first;
a stale report from an older run does not overwrite; skip cleared by a new run.

**Step 3: state derivation (`state.go`).**

```go
type Row struct {
    Scenario, State string // running | passed | failed | noresult | outofdate | skipped
    Passed, Total int; Failed []string
    Done, Of int          // scenarios finished in its run, of how many: for running
    Command, ShotsDir, Reason string; Shots int
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
any rows; else "". Table tests for every row of the spec's state table, including the skip expiring on a newer change.

**Step 4: git changes (`gitchanges.go`).** `func WatchedChanges(cwd string, cfg *Config) ([]Change, string /*branch*/, error)`:
repo root from `git rev-parse --show-toplevel`; default branch from `git symbolic-ref --short refs/remotes/origin/HEAD`
(strip `origin/`), falling back to `main`, then `master` if `main` does not exist; changed = `git status --porcelain`
paths ∪ (when the branch is not the default) `git diff --name-only $(git merge-base HEAD <default>)..HEAD`; keep the
ones `Match`ing a watch glob; `os.Stat` each for its mtime (a deleted file uses now). Test against a temp repo made with
`git init` (see other `pkg/` tests that build temp repos; on Windows run with the `CGO_ENABLED=1 CC="zig cc …"` prefix
from AGENTS.md if the package imports the store — it should not).

**Step 5: persistence (`verifyruns.go`).** A `Store` with a mutex: `dir` = `filepath.Join(wavebase.GetWaveDataDir(),
"verify")`; `Report(r Report) error` loads `<blockid>.json`, `Apply`, writes atomically (temp + rename), then calls an
`onChange(blockId)` hook the server sets (Task 2 publishes the event there); `Skip(blockId, scenario string, undo bool)`;
`State(blockId, cwd string) (State, error)` — `LoadConfig(root)`, nil config → empty State; else `Derive` with
`process.PidExists` (gopsutil v4, as `wshserver_jobqueue.go` uses) and `WatchedChanges`. On start, delete block files
not modified for 30 days. Test with a temp dir: report → file written → State reads it; Skip and undo.

**Step 6: the gate (`gate.go`).** `func Gate(st State, branch, defaultBranch string, isMerge bool) (ask bool, reason string)`:
ask only when `isMerge`, `branch == defaultBranch`, and Verdict is red or amber. Reason, e.g.
`Verify: chat-council-card failed steps 7, 8, 9; rail-council-tab has no result. Merge anyway?` (failed → `failed
steps N, M`; noresult → `has no result`; outofdate → `passed before <file> changed`; NotRun → `UI files changed and no
scenario ran`). Step numbers are the leading `N.` of each failed step text. Tests for each part and their joining.

**Step 7:** `go test ./pkg/verifyruns/...` passes (with the Windows cgo prefix only if needed). Commit:
`git commit -m "feat(verify): pkg/verifyruns keeps each agent's scenario runs and derives its Verify state" -- pkg/verifyruns .arc/verify.json`

### Task 2: wshrpc commands, the event, and `wsh verify`

**Depends on:** Task 1

**Files:**
- Create: `pkg/wshrpc/wshrpctypes_verify.go`, `pkg/wshrpc/wshserver/wshserver_verify.go`,
  `cmd/wsh/cmd/wshcmd-verify.go`, `cmd/wsh/cmd/wshcmd-verify_test.go`
- Modify: `pkg/wshrpc/wshrpctypes.go` (embed `VerifyCommands` beside `ServicesCommands`, line ~44),
  `pkg/wps/wpstypes.go` (`Event_VerifyChanged = "verify:changed" // type: wshrpc.VerifyChangedData`, and add it to the
  list at ~95), `pkg/tsgen/tsgenevent.go` (map the event to its type, as `Event_ServicesChanged` at ~52), wavesrv's
  startup where other stores start (find where `services` is started in `cmd/server/`) to create the Store and set
  `onChange` to publish the event.
- Generated: run `task generate` (never hand-edit `frontend/types/gotypes.d.ts`, `wshclientapi.ts`, `wshclient.go`).

**Step 1: types** (`wshrpctypes_verify.go`, follow `wshrpctypes_services.go`):

```go
type VerifyCommands interface {
    VerifyReportCommand(ctx context.Context, data CommandVerifyReportData) error
    GetVerifyStateCommand(ctx context.Context, data CommandVerifyStateData) (*VerifyStateData, error)
    VerifySkipCommand(ctx context.Context, data CommandVerifySkipData) error
    VerifyGateCommand(ctx context.Context, data CommandVerifyGateData) (*VerifyGateData, error)
}
```

JSON tags all lowercase, as the spec's report shows (`blockid`, `runid`, `phase`, `pid`, `cwd`, `command`, `watch`,
`shotsdir`, `scenarios[{name, steps[{step, state, detail}], done}]`, `reason`). `CommandVerifyStateData{blockid, cwd}`;
`VerifyStateData` mirrors `verifyruns.State` (`rows[{scenario, state, passed, total, failed, done, of, command,
shotsdir, reason, shots, started, ended, changedfile}]`, `verdict`, `notrun`, `notrunskipped`, `changed`, `rerun`);
`CommandVerifySkipData{blockid, scenario, undo}`; `CommandVerifyGateData{blockid, cwd, command}`;
`VerifyGateData{ask, reason}`; `VerifyChangedData{blockid}`.

**Step 2: server.** Convert to and from `verifyruns` structs. Gate: decide `isMerge` with a Go twin of the mod's
parser? No — the mod decides it's a merge and only then calls the gate; `VerifyGateCommand` takes it as a merge and
checks the branch (`git rev-parse --abbrev-ref HEAD` in `cwd`) against the default branch. Server tests in
`wshserver_verify_test.go` with a temp data dir: report → state; gate on a non-default branch never asks.

**Step 3: `wsh verify`.** Subcommands, block id from `WAVETERM_BLOCKID` (error `not in an arcterm agent's terminal`
when unset), JSON in/out:
- `wsh verify report` — reads one report JSON on stdin, fills `blockid`, sends it. Exits 0 silently.
- `wsh verify status [--cwd DIR]` — prints `VerifyStateData` as JSON (cwd defaults to the working directory).
- `wsh verify gate --cwd DIR --command CMD` — prints `{"ask":…,"reason":…}`.
Test the flag parsing and the missing-block error in `wshcmd-verify_test.go`, as `wshcmd-jobslot_test.go` does.

**Step 4:** `task generate`; `go build ./...`; `go test ./pkg/wshrpc/... ./cmd/wsh/...`. Commit the Go files and the
generated files by path.

### Task 3: the harness reports its runs

**Depends on:** none

**Files:**
- Modify: `scripts/cdp/report.mjs` (add `makeRunReporter`), `scripts/cdp/report.test.mjs`,
  `scripts/cdp/verify.mjs` (around the scenario loop, lines ~92–140), `scripts/cdp/final-verify.mjs`
- Do not run prettier on `scripts/*.mjs` (AGENTS.md).

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
- `watch` = `.arc/verify.json`'s `watch` read from the cwd, `[]` when absent.
- Each report is `spawn(wsh, ["verify", "report"], { input: JSON.stringify(doc) })`; a nonzero exit or a throw logs
  `verify report: <why>` the first time only and never throws.
- `scenarioDone` sends `progress` with every scenario so far (`done: true` for finished ones, steps from
  `shotsManifest`'s shape); `end` sends the final `shotsManifest(results, shotsByScenario)` and `shotsdir`;
  `unverified(reason)` sends `end` with `reason` and no steps.
Tests with a stub `spawn` and env: inactive without the block id; start/progress/end documents; the env run id and
command win; a failing spawn logs once and later reports still go.

**Step 2: verify.mjs.** Create the reporter before the loop; `start(chosen.map(s => s.name), "task verify:ui -- " +
names.join(" "))`; after each scenario's `finally` (once `shotsByScenario[scenario.name]` is set) `scenarioDone(...)`;
after `shots.json` is written, `end(...)`. A run with no names (every scenario) uses `task verify:ui`.

**Step 3: final-verify.mjs.** Before starting the app: a reporter with command `node scripts/cdp/final-verify.mjs
<names>` and `start(names)`; pass `ARC_VERIFY_RUNID` and `ARC_VERIFY_COMMAND` in the env of the `verify.mjs` it
spawns; wherever it exits with `EXIT_UNVERIFIED` (3), call `unverified(<the last line it prints>)` first. Add a test
in `final-verify.test.mjs` that an unverified exit reports its reason (follow that file's existing stubs).

**Step 4:** `node --test scripts/cdp/report.test.mjs scripts/cdp/final-verify.test.mjs` (or the runner those files
use) passes. Commit by path.

### Task 4: the cockpit's Verify model and store

**Depends on:** Task 2

**Files:**
- Create: `frontend/app/view/agents/verifymodel.ts`, `frontend/app/view/agents/verifymodel.test.ts`,
  `frontend/app/view/agents/verifystore.ts`

**Step 1: the pure model, tests first.** From a `VerifyStateData`:

```ts
export type VerifyTone = "red" | "amber" | "green" | "muted";
export interface VerifyTileVM {
    shown: boolean; folded: boolean;           // folded: everything passed or skipped
    head: { parts: { text: string; tone: VerifyTone }[]; count: string }; // "1 failed", "·", "1 no result"; "3 scenarios"
    warning: { text: string; skippable: boolean } | null; // the amber line (out of date or not run)
    rows: VerifyRowVM[];
    chip: { text: string; tone: "red" | "amber"; title: string } | null;
    strip: { tone: VerifyTone; label: string; pulsing: boolean } | null; // "2", "!", "3"
}
export interface VerifyRowVM {
    key: string; name: string; tone: VerifyTone; result: string; age: string; startsOpen: boolean;
    note: string | null; failed: string[]; passedMore: number; command: string;
    shots: string | null; // "Open the 9 screenshots", null when none
    canRerun: boolean; canSkip: boolean; skipped: boolean;
}
export function verifyTile(st: VerifyStateData | null, now: number): VerifyTileVM;
export function rerunLine(row: VerifyRowVM | "notrun", st: VerifyStateData): string;
```

Copy is the spec's, word for word (rows, notes, warning lines, chip texts, rerun lines). One `it` per state in the
spec's table, plus: the not-run line naming `<file> and N more UI files`; `age` formatting (`3m`, `2h`, `1d`, as the
rail's other ages; reuse the helper the Background tasks rows use for elapsed if it fits); folded only when every row
is passed or skipped and there is no warning.

**Step 2: the store.** `verifyStateAtom = atomFamily((blockId: string) => atom<VerifyStateData | null>(null))`;
`loadVerify(blockId, cwd)` calls `RpcApi.GetVerifyStateCommand(TabRpcClient, { blockid, cwd })`;
`useVerify(blockId, cwd)` loads on mount and when `cwd` changes, and subscribes once to `verify:changed`
(`waveEventSubscribeSingle`, as `servicesstore.ts` does) to reload the block named. `skipVerify(blockId, cwd,
scenario, undo)` calls `VerifySkipCommand` then reloads. Errors keep the last state and log once.

**Step 3:** `npx vitest run frontend/app/view/agents/verifymodel.test.ts` passes. Commit by path.

### Task 5: the tile, the strip count, the header chip, Rerun and Skip

**Depends on:** Task 4

**Files:**
- Create: `frontend/app/view/agents/railverify.tsx`
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx` (Overview body: after the session block and Needs you,
  before the counted sections; the count strip), `frontend/app/view/agents/agentrailsections.ts` (add `"verify"` to
  `AgentRailSectionId` so `revealSection("verify")` works), `frontend/app/view/agents/agentheader.tsx` (chip after the
  state pill, `data-agent-state-pill` ~line 912)

**Step 1: the tile** (`railverify.tsx`), drawn as board `B-tile` of the Prototype: a `<section data-rail-section="verify"
data-verify-tile>` on `bg-surface-raised rounded-lg`; head row; warning line (`bg-askingbg text-warning-soft`, the
triangle icon in `text-warning`); rows on `bg-surface rounded-[8px]` with the dot, name, result, age, opening on click
(`springReveal` from `element/motiontokens.ts`); a row's body: notes, failed steps (`✕` in `text-error`),
`+ N passed`, the mono command line, the screenshots link (opens the contact sheet `index.html` in `shotsdir` the way
the rail opens a file in the browser/preview; find how Artifacts opens an html file and reuse it), and the buttons
**Ask the agent to rerun** (secondary button) and **Skip** (text button); a skipped row shows `Skipped` and **Undo**.
Data attributes for the scenario: `data-verify-row=<scenario>`, `data-verify-state=<state>`, `data-verify-open`,
`data-verify-rerun`, `data-verify-skip`, `data-verify-undo`, `data-verify-warning`, `data-verify-folded`.
Tokens only (DESIGN.md): `text-error`, `text-warning`, `bg-working pulse-dot-slow` for running, `text-muted`.
Folded: one line `Verify · 3 passed` that opens it (`springReveal`). No tile when `shown` is false.

**Step 2: Rerun.** Send `rerunLine(...)` with `sendCardLine` (`chatverdictsend.ts`) — its `record` argument keeps a
Chat answer record; pass a record function that returns the same shape `sendVerdict` builds, or, if that couples Verify
to Chat's verdict folding, extract the prompt/wake half of `sendCardLine` into `sendAgentLine(agent, line, io)` and
call that (keep `sendCardLine` using it). A failed send shows its message under the row's buttons in `text-error`.

**Step 3: strip count and chip.** The strip gains a Verify item after Background tasks, only when `strip` is non-null
(`data-rail-count="verify"`), using a lucide monitor icon (`MonitorCheck`/`MonitorX`/`Monitor` by tone); its click is
`openSection("verify")`. The header chip (`data-verify-chip`) shows `chip.text` with an `X` or triangle icon, `title`
= `chip.title`, and opens the rail on the tile (the rail's existing request path, `railsection.ts`, as the header's
"N TO REVIEW" chip does).

**Step 4:** `task check:ts`; eslint and prettier --check on the touched files. Commit by path.

### Task 6: the arc mod asks before a merge

**Depends on:** Task 2

**Files:**
- Create: `claude/arc-mod/hooks/verifygate-core.ts`, `claude/arc-mod/hooks/verifygate-core.test.ts`
- Modify: `claude/arc-mod/hooks/register.ts`

**Step 1: the parser, tests first.** `export function mergeTarget(command: string, cwd: string): { cwd: string } | null`
— a `git merge` (not `--abort`, `--continue`, `--quit`, `--skip`) anywhere in a `&&`/`;`/`|`-joined command; honour a
`git -C <dir> merge` and a preceding `cd <dir> &&` (relative dirs resolve against `cwd`); PowerShell's `;` too. Tests:
`git merge --no-ff feat/x`, `cd /d/repo && git merge x`, `git -C ../main merge x`, `git merge --abort` (null),
`git log --merges` (null), `echo git merge` inside quotes (null).

**Step 2: the hook.** In `register.ts`, a `tool.check` on `Bash` (and the PowerShell tool if the mod checks it
elsewhere): `next(e)` first; on a deny return it; if `mergeTarget` finds a merge, run `[WSH, "verify", "gate",
"--cwd", target.cwd, "--command", command]` through `$.process.run`; on `{ ask: true }` return `{ decision: "ask",
reason }`; otherwise the verdict. `.catch(passOn)` with a debug log, as the comment at ~344 asks for this kind of hook.

**Step 3:** `npx vitest run claude/arc-mod/hooks/verifygate-core.test.ts`; `claude plugin validate claude/arc-mod`;
`task check:ts` (it typechecks the mod). Commit by path.

### Task 7: the CDP scenario, CHANGELOG and docs

**Depends on:** Task 5

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (new scenario `rail-verify`, exported and listed like the others),
  `CHANGELOG.md`, `docs/agents/` (a short note on `wsh verify` and `.arc/verify.json` where agent commands are listed),
  `docs/hand-checks.md` (the merge ask needs a live Claude session: add `- [ ] (arcterm) …`)

**Step 1: the scenario.** Arrange a fixture agent with a block (follow an existing rail scenario's arrange, e.g. one
that opens the Agent rail on Overview) in a temp git repo holding `.arc/verify.json` and a `frontend/x.tsx`; seed runs
from the page with `RpcApi.VerifyReportCommand` (the way other scenarios call RPCs from the page). Steps, each with a
shot, one per board state of the Prototype:
1. failed + no result + out of date (board `B-tile`): the head reads `1 failed · 1 no result`, the failed row is open
   with steps 7, 8, 9, the warning line names the file, the header chip reads `Verify: 1 failed`, the strip count is
   red.
2. a row opens and closes on click.
3. Ask the agent to rerun sends the failed row's line (read what the fixture's terminal or the prompt IO received).
4. Skip on the no-result row: it reads `Skipped` with Undo, the head drops `1 no result`; Undo brings it back.
5. running (a report with `start` only and a live pid: use the scenario's own `process.pid`): `1 of 2`, pulsing dot,
   no chip.
6. a dead pid with no end: `No result`.
7. all passed: the tile folds to `Verify · 2 passed`; a click opens it.
8. not run: only the warning line, chip `Verify: not run`; Skip on it clears the chip.
9. a repo without `.arc/verify.json`: no tile, no chip, no strip count.
Teardown removes the block files it made under the dev data dir's `verify/`.

**Step 2: CHANGELOG.** Under Unreleased → Added, one line for the person, ending with `<!-- big -->` and a shot made
in step 1 (`await h.whatsnewShot("rail-verify", { selector: "[data-verify-tile]" })`), e.g.: `The agent rail shows
your agent's UI checks in a Verify tile: a failed step in red, a run that never finished or a UI change nobody checked
in amber, with Ask the agent to rerun and Skip; the agent asks you before it merges while Verify is red or amber.`

**Step 3:** `node scripts/cdp/final-verify.mjs rail-verify` passes with `ARC_FINAL_OUT` set. Commit by path.

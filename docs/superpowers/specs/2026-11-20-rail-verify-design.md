# Rail Verify: an agent's CDP scenario results on its rail

Status: approved design (2026-11-20). Mockup: `.superpowers/design/rail-verify/` (board `B-tile`, board `States`).

## Problem

An agent that changes the UI runs CDP scenarios (`task verify:ui -- <name>`, `node scripts/cdp/final-verify.mjs`) and
then reports in prose. A run that failed, or one that never printed its table (the 2026-11-20 `rail-council-tab` run
was killed out of memory at step 9), reads as one bullet among many, and the rail's Background tasks shows the run
with the same dot as any other command. The person merges without noticing that part of the UI was never checked.

## What the person sees

### The Verify tile

A tile on the rail's Overview, after the session block and Needs you, before the counted sections. It is drawn like
the session block (`surface-raised`, `rounded-lg`), not like a folded section, so it cannot scroll out of sight under
the lists.

- **Head row:** a monitor icon, `Verify`, the verdict in words and colour (`1 failed · 1 no result`), and the number
  of scenarios at the right (`3 scenarios`).
- **Warning line** (amber, `askingbg`), when a watched UI file changed after the newest run, or when one changed and no
  run happened: `agentrailtabs.tsx and 2 more UI files changed after agent-rail-tabs last ran.` /
  `councilrail.tsx and 2 more UI files changed, and no scenario has run in this session.`
- **One row per scenario**, the newest run of each, worst first (failed, no result, running, out of date, passed):
  a status dot, the scenario name, its result (`6/9`, `No result`, `step 7`, `12/12`), its age (`25m`).
  A row opens (springReveal) on:
  - failed: each failed step (`✕ 7. a council started through PowerShell draws its card`), then `+ N passed`;
  - no result: `Stopped during rail-council-tab: the run ended without a result, so its steps were not checked.`,
    or the reason the run gave (`Could not start the dev app: the "beforeDevCommand" terminated with a non-zero
    status code.`);
  - out of date: `Passed 2h ago, before agentrailtabs.tsx changed.`;
  - every row: the command that ran (mono, `$ task verify:ui -- chat-council-card`), `Open the 9 screenshots` (the
    run's contact sheet; left out when the run took none), and, on a failed, no-result or out-of-date row,
    **Ask the agent to rerun** and **Skip**. The not-run warning line has both too.
- The tile is open while anything is red or amber; a failed row starts open. When every row passed and nothing is out
  of date it folds to one line, `Verify · 3 passed`, which opens it.
- No tile when the agent ran no scenario and changed no watched file.

States (board `States`):

| State | Dot / result | Head verdict | Header chip | Strip count |
|---|---|---|---|---|
| running | green, pulsing / `2 of 3` (scenarios) | `running` | none | icon, pulsing |
| skipped | grey / `Skipped` · Undo | counts as passed | none | as passed |
| passed | green / `14/14` muted | `3 passed`, folded | none | icon + count, muted |
| failed | red / `6/9` red | `1 failed` | `Verify: 1 failed` (red) | icon struck through + count, red |
| no result | amber / `No result` | `1 no result` | `Verify: no result` (amber) | icon + count, amber |
| not run | none (warning line only) | `not run` | `Verify: not run` (amber) | icon + `!`, amber |
| out of date | green / `12/12` muted, note | `1 out of date` | `Verify: out of date` (amber) | icon + `!`, amber |

Red is only for a failed step. A run with no result, no run, or a run older than the change is amber: not known, not
wrong.

### The header chip

In the agent's header, after its state word, only in a red or amber state. Its `title` names what is wrong; a click
opens the rail on Overview and scrolls the tile into view (`revealSection`).

### The strip count

The rail's count strip gains Verify after Background tasks, shown only for an agent with a tile. A click opens the
tile.

### Ask the agent to rerun

Sends one line to the agent as a prompt (a sleeping agent is woken with it), the way a verdict card's Fix does
(`sendCardLine`, `chatverdictsend.ts`):

- failed: ``Run `task verify:ui -- chat-council-card` again and fix the steps that fail: 7, 8, 9.``
- no result: ``Run `task verify:ui -- rail-council-tab` again: the last run stopped after step 8 without a result.``
- out of date: ``Run `task verify:ui -- agent-rail-tabs` again: agentrailtabs.tsx changed after it passed.``
- not run: ``You changed councilrail.tsx and 2 more UI files without running a scenario. Run the scenarios that cover
  them (`task verify:ui -- <name>`), and add a step where none does.``

The command is the one the run reported. A send that fails says so in the row, as Fix does.

### Skip

For a change no scenario can picture (a backend-only change, a state the harness cannot reach) or a run the person
judges not worth repeating. **Skip** on a row, or on the not-run warning, sets that row (or the warning) aside: the row
reads `Skipped` in grey with **Undo**, and it no longer counts toward the verdict, the chip, the strip count or the
merge ask. A skip holds until the scenario runs again or a watched file changes after it; then the row is judged
afresh. Skips are kept with the runs (below), so a restart keeps them.

### Asking before a merge

When the agent runs `git merge` (not `--abort`, `--continue`, `--quit`, `--skip`) in a checkout whose branch is the
project's default branch, and its Verify is red or amber, the arc mod's `tool.check` hook answers `ask` with the
reason: `Verify: chat-council-card failed steps 7, 8, 9; rail-council-tab has no result. Merge anyway?` The person
approves or refuses in Claude Code's own prompt. Where nobody can be asked (an engine worker), the engine turns the
ask into a deny and the reason tells the model to ask. Trouble reaching wsh passes the merge on (`passOn`) with a
debug log: Verify is advice, and arcterm's own trouble must not hold the person's work.

## How it works

### The harness reports its runs

`scripts/cdp/verify.mjs` and `scripts/cdp/final-verify.mjs` report each run through `wsh verify report`, from a shared
helper in `scripts/cdp/report.mjs`. Final reports `start` before it starts its app and passes its run id and command
to the `verify.mjs` it runs (`ARC_VERIFY_RUNID`, `ARC_VERIFY_COMMAND`), so both report one run; when Final ends
unverified (exit 3) it reports `end` with its last line as `reason`, so a dev app that never started reads as no
result instead of nothing. They report only when `WAVETERM_BLOCKID` is set (a run inside an agent's terminal)
and `wsh` is found (`WAVETERM_WSHBINDIR`, else `PATH`); a report that fails is logged once and never fails the run.

One JSON document on stdin per report:

```json
{
  "runid": "<uuid per run>",
  "phase": "start | progress | end",
  "pid": 12345,
  "cwd": "D:/work/arcterm/.worktrees/x",
  "command": "task verify:ui -- chat-council-card",
  "watch": ["frontend/**/*.tsx", "frontend/**/*.css"],
  "shotsdir": "D:/…/cdp-shots",
  "scenarios": [{ "name": "chat-council-card", "steps": [{ "step": "7. …", "state": "pass | fail | skip" }], "done": false }],
  "reason": "optional: why it ended without results (out of memory, timeout)"
}
```

- `start` names the scenarios; `progress` follows each scenario that finished, with its steps (a scenario's steps
  only come back when it ends, so progress is per scenario); `end` carries the final `shotsManifest` (`report.mjs`) and
  the contact sheet's path. `pid` is the outer process (Final's when Final runs it); a later report keeps the first.
- `command` is what the person would type to rerun: `task verify:ui -- <names>` for verify.mjs (the scenario names it
  was given), `node scripts/cdp/final-verify.mjs <names>` for Final.
- `watch` comes from the project's `.arc/verify.json` (below), so another project's harness can name its own.

### A project opts in with `.arc/verify.json`

```json
{ "watch": ["frontend/**/*.tsx", "frontend/**/*.css"], "rerun": "task verify:ui -- <name>" }
```

Checked in at the repo root. Without it a project has no Verify at all (no tile, no chip, no merge ask), whatever
its agents run. `watch` is the UI files whose change wants a scenario run (`**` and `*` globs, relative to the root);
`rerun` is the command the not-run line names. This repo adds the file.

### wavesrv keeps them per agent

A new `pkg/verifyruns`:

- Stores, per block id, the newest run of each scenario, in `verify/<blockid>.json` in the data dir, so a restart keeps
  them. A report for a block that no longer exists is dropped; the file goes when the block is deleted.
- Derives the state (a pure function with its tests): a run whose last phase is not `end` and whose `pid` is gone is
  **no result**; with its pid alive it is **running**; an `end` run with a failed step is **failed**, else **passed**.
- Watched changes, read in the agent's checkout (the `cwd` the cockpit or the gate passes) when the state is asked
  for, never polled: the files matching `.arc/verify.json`'s `watch` that `git status --porcelain` lists, or that
  the branch changed since it left the default branch (`git diff --name-only <merge-base>..HEAD`), and the newest
  mtime among them. A passed run that ended before that mtime is **out of date**; changed watched files with no run
  ending after them, and no run at all, is **not run**. On the default branch itself only uncommitted files count.
- Publishes `verify:changed` (block id) after every stored report.
- Commands: `VerifyReportCommand` (the report above), `GetVerifyStateCommand(blockid, cwd)` (the derived rows, the
  warning's files, the verdict; empty when `cwd`'s repo has no `.arc/verify.json`), `VerifySkipCommand(blockid, scenario, undo)` (`scenario` empty for the not-run
  warning), `VerifyGateCommand(blockid, cwd, command)` (`{ ask: bool, reason }`: a merge into the default branch while
  the state is red or amber, skips left out). `wsh verify report|status|gate` wrap the ones an agent's shell needs;
  `wsh` takes the block id from `WAVETERM_BLOCKID`.

### The cockpit draws it

- `view/agents/verifymodel.ts` (pure): the tile's rows in order, the head verdict, the warning line, the chip, the
  strip count and the rerun line. `verifymodel.test.ts` beside it.
- `view/agents/verifystore.ts`: an atom per agent, read on mount and on `verify:changed`.
- `view/agents/railverify.tsx`: the tile; the strip count and the header chip go where the other counts and the state
  word are drawn.

### The mod asks before a merge

`claude/arc-mod/hooks/verifygate-core.ts` (pure, tested): whether a Bash command is a merge, and the `-C <dir>` or `cd`
it runs in. `register.ts` adds a `tool.check` on Bash that calls `wsh verify gate` for a merge and answers `ask` with
its reason, with `.catch(passOn)`.

## Motion

- The tile appearing for the first time, and folding to one line or opening: `springReveal`.
- A row opening: `springReveal`.
- A run's result arriving: the dot and result change in place, no entrance; the running dot pulses through
  `pulsedriver.tsx`.
- The chip appearing in the header: opacity on the Fluid ease at `durMicro`.

## Out of scope

- Mapping a scenario to the files it covers: any watched change after a run makes it out of date.
- Engine runs: their Final already gates the merge.
- `gh pr merge` and pushes.
- Runs started outside an agent's terminal (no `WAVETERM_BLOCKID`): not reported.

## Known limits

- In a checkout shared by several agents (the main checkout), another agent's edit to a watched file makes this
  agent's runs out of date. Feature work belongs in a worktree, where this does not happen.
- A run killed together with its whole shell tree reports nothing after its last progress; it shows as no result
  once wavesrv sees its pid gone.

## Verification

- Go: `pkg/verifyruns` state derivation, persistence and the gate.
- vitest: `verifymodel.test.ts`, `verifygate-core.test.ts`.
- CDP scenario `rail-verify`: seeds reports through `VerifyReportCommand` for a fixture agent and checks each state's
  tile, row, chip and strip count, a row opening, Ask the agent to rerun sending its line, and Skip and Undo.

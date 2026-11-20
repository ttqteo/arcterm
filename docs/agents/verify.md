# Verify: an agent's scenario results on its rail

What an agent's CDP scenario runs look like to arcterm: how a run is reported, what wavesrv keeps and derives, what the
person sees (the rail's Verify tile, the header chip, the strip count), and the ask before a merge. The design and its
copy are in `docs/superpowers/specs/2026-11-20-rail-verify-design.md`; this file is how it is wired and how to check it.

## A project opts in with `.arc/verify.json`

```json
{ "watch": ["frontend/**/*.tsx", "frontend/**/*.css"], "rerun": "task verify:ui -- <name>" }
```

Checked in at the repo root. A repo without it has no Verify at all: no tile, no chip, no strip count, no merge ask,
whatever its agents run. `watch` lists the UI files whose change wants a scenario run (`**` matches any number of folders,
`*` stays inside one, paths relative to the root); `rerun` is the command the not-run line names. This repo has the file.

## The harness reports each run

`scripts/cdp/verify.mjs` and `scripts/cdp/final-verify.mjs` report through `makeRunReporter` (`scripts/cdp/report.mjs`),
which pipes one JSON document per report to `wsh verify report`. It reports only inside an agent's terminal
(`WAVETERM_BLOCKID` set) and finds `wsh` in `WAVETERM_WSHBINDIR`, else on `PATH`. A report that fails is logged once and
never fails the run. Final passes its run id and command to the `verify.mjs` it starts (`ARC_VERIFY_RUNID`,
`ARC_VERIFY_COMMAND`), so both report one run, and when it ends unverified (exit 3) it reports an `end` with the last
line as `reason`, so a dev app that never started reads as no result instead of nothing.

```json
{
  "runid": "<uuid per run>",
  "phase": "start | progress | end",
  "pid": 12345,
  "cwd": "D:/work/arcterm/.worktrees/x",
  "command": "task verify:ui -- chat-council-card",
  "shotsdir": "D:/…/cdp-shots",
  "scenarios": [
    { "name": "chat-council-card", "files": ["chat-council-card-01.png"], "steps": [{ "step": "7. …", "state": "pass | fail | skip" }], "done": true }
  ],
  "reason": "optional: why the run ended without results"
}
```

- `start` names every scenario of the run; `progress` follows each scenario that finished (its steps only exist once it
  ends); `end` carries the final steps and the screenshots directory, whose `index.html` is the contact sheet
  (`Open the N screenshots` opens it). Reports carry no timestamp: wavesrv stamps them on arrival, and a run's end is its
  last report.
- `pid` is the outer process (Final's, when Final runs `verify.mjs`); the first pid a run reports is kept. wavesrv reads
  liveness with `process.PidExists`, so a reused pid would keep a dead run reading as running.
- `command` is what the person would type to run it again. An `end` must always go out: a run without one reads as
  running while its pid lives and as no result once it is gone.
- A repeat `start` of one run id adds its scenarios to that run.

## `wsh verify`

All three read the block from `WAVETERM_BLOCKID`, so they work only in an agent's terminal, and exit nonzero with a
one-line message elsewhere or when wavesrv cannot be reached.

| Command | Does |
|---|---|
| `wsh verify report` | Reads one report document on stdin, sets its `blockid` from the environment (a document naming another block is overwritten) and sends it. Prints nothing on success. |
| `wsh verify status [--cwd DIR]` | Prints the agent's `VerifyStateData` as indented JSON: `rows` (`[]` when empty), `verdict`, `notrun`, `notrunskipped`, `changed`, `rerun`. `--cwd` defaults to the working directory. |
| `wsh verify gate --cwd DIR --command CMD` | Prints one line, `{"ask":true,"reason":"…"}` or `{"ask":false,"reason":""}`: whether a merge command wants an ask. Both flags are required. |

## What wavesrv keeps (`pkg/verifyruns`)

- Per block id, the newest run of each scenario, in `<data dir>/verify/<blockid>.json`, so a restart keeps them. A
  report or a skip for a block that no longer exists is dropped; the file goes when the block closes, and a file
  untouched for 30 days is removed at startup. A new run of a scenario clears its skip.
- A row's state is derived when asked for (`GetVerifyStateCommand`, with the agent's checkout as `cwd`), never stored:
  - a run whose last phase is not `end`: **running** while its pid lives, **no result** once it is gone;
  - an ended run with no checked step: **no result**; with a failed step: **failed**; else **passed**;
  - a passed run that ended before the newest watched change: **out of date**;
  - a skip newer than both the run and the newest change sets a failed, no-result or out-of-date row aside
    (**skipped**); a newer change or a new run brings it back.
- Watched changes are the files matching `watch` that `git status` lists (staged, unstaged, untracked), plus, off the
  default branch, the files the branch changed since it left it (`git diff --name-only <merge-base>..HEAD`); a change's
  time is its file's mtime. On the default branch itself only uncommitted files count.
- **Not run** is true only with no row at all (a watched file changed and the agent ran nothing). With rows, a change
  after a passed run is an out-of-date row, so the verdict and the gate never count not-run beside rows.
- `verify:changed` (the block id) is published after every stored report and every skip or undo that changed a file. It is
  not published for a file that changed on its own, and an agent edits during its turns: the cockpit reads the state when
  a view mounts, when the agent's cwd changes, on that event, and each time the agent's state changes (a turn starting
  or ending, `verifystore.ts` `useVerify`), so an edit after a passed run shows as out of date when that turn ends. An
  edit made by someone else (the person in their editor) shows at the next of those reads (switching the rail's tab
  or the agent, the next report, the agent's next turn). There is no timer on either side, and the merge gate always
  reads fresh.

## What the cockpit draws

`verifymodel.ts` (pure: rows, head verdict, warning line, chip, strip count, rerun line; `verifymodel.test.ts`),
`verifystore.ts` (one state atom per agent), `railverify.tsx` (the tile and the header's chip), the strip count in
`agentrailpanel.tsx`. Hooks for tests: `[data-verify-tile]`, `[data-verify-head]` (`data-verify-folded` while folded),
`[data-verify-warning]` (`data-verify-kind`), `[data-verify-row=<scenario>][data-verify-state]` with `[data-verify-open]`,
`[data-verify-result]`, `[data-verify-note]`, `[data-verify-step]`, `[data-verify-shots]`, `[data-verify-rerun]`,
`[data-verify-skip]`, `[data-verify-undo]` and `[data-verify-error]`; the header's `[data-verify-chip]`
(`data-verify-tone`); the strip's `[data-rail-stat="verify"]` (`data-count`, `data-verify-tone`, `data-verify-pulsing`).
Ask the agent to rerun sends one line as a prompt (a sleeping agent is woken with it) and keeps no Chat record.

## The ask before a merge

The arc mod's `tool.check` hook on `Bash` and `PowerShell` (`claude/arc-mod/hooks/register.ts`, `verifyGateAsk`; the
parsing is `verifygate-core.ts`, tested by `verifygate-core.test.ts`) runs `wsh verify gate` for a `git merge` (not
`--abort`, `--continue`, `--quit` or `--skip`), in the directory it runs in (`git -C <dir>`, a `cd <dir> &&` before it).
wavesrv answers `ask` only when that checkout's branch is the project's default branch (`gitinfo.BranchBase`) and the
agent's Verify is red or amber, skipped rows left out; the reason names each thing that is wrong:
`Verify: chat-council-card failed steps 7, 8, 9; rail-council-tab has no result. Merge anyway?`

- The person approves or refuses in Claude Code's own prompt. Where nobody can be asked (an engine worker, no
  `e.approver`) the engine turns the ask into a deny, and the reason tells the model to ask the person first.
- Verify is advice, not a guard: a gate that fails (wsh gone, wavesrv slow, no block) passes the merge on with a debug log.
- A merge run from another checkout (`cd ../main && git merge feat/x`) is judged where it runs: that checkout is on the
  default branch, where only uncommitted files count, so the agent branch's own commits cannot make a row out of date
  there. Failed and no-result rows still ask.
- `gh pr merge` and pushes are not asked about, and an engine run's own Final already gates its merge.

## Checking it

- Go: `pkg/verifyruns` (state derivation, persistence, the gate), `pkg/wshrpc/wshserver/wshserver_verify_test.go`,
  `cmd/wsh/cmd/wshcmd-verify_test.go`.
- vitest: `verifymodel.test.ts`, `agentrailsections.test.ts`, `claude/arc-mod/hooks/verifygate-core.test.ts`,
  `scripts/cdp/report.test.mjs`, `scripts/cdp/final-verify.test.mjs`.
- CDP scenario `rail-verify` (`scripts/cdp/scenarios-rail-verify.mjs`): a fixture agent in a temp git repo with
  `.arc/verify.json`; it reports runs through `verifyreport` (what `wsh verify report` calls), moves `frontend/x.tsx`'s
  mtime to make a run out of date, and between states removes the block's file under `<data dir>/verify/`. The line
  Ask the agent to rerun sends is recorded in the page and never forwarded (a terminal would run it).
  `task verify:ui -- rail-verify`.
- The ask in a live Claude session is a hand check (`docs/hand-checks.md`).

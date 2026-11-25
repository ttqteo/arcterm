# Kael sync (2026-11-25, 2 of 3): a run nests under the agent that started it

Port only the "nested under its parent" half of the fork's agent workers (`kael` remote, tip `45edf22ed`). Fork
reference: `git show 1af218ff3` (its tree half: `agenttreemodel.ts` `buildAgentTree` nesting, `agenttree.tsx` per-depth
guides, the roster's parent field, scenario `scripts/cdp/scenarios-agent-workers.mjs`) and the spec
`git show kael/main:docs/superpowers/specs/2026-11-20-agent-spawned-workers-design.md` ("Arc records the parent on the
worker's tab. The Agent tree nests workers under their parent, as it nests subagents").

As in the earlier syncs (`2026-11-19-kael-sync-agent-edits-and-fixes-design.md`), nothing merges: the behaviour is
ported into `main`'s shape.

## What changes

A quick run started from an agent's session (`wsh runs start` run in an agent tab: the run records the tab as
`Run.OriginTabId`, set at `pkg/wshrpc/wshserver/wshserver_runs.go:554` from `CommandCreateRunData.OriginTabId`) shows in
the Agent tree as a row under that agent's row, one tree guide in. The run's agent can start a run of its own, which
nests under it one level further, with no depth limit. A run started from the cockpit (no origin tab) is unchanged.

A run's agent stays a top-level row when its origin tab:

- is gone from the roster,
- has no plain row of its own: a run's lead, worker or stage session, a brainstorm's check or judge, or an agent in an
  active pair (the pair's row places it),
- or would close a loop (a chain of origins that comes back to itself: every agent on it stays top-level).

Group counts (`count`, `attn`, `running`) include nested rows, counted in the origin's folder. The keyboard focus order,
the Alt digits and the multi-selection already follow the rows as drawn (`treeNavIds`, `selectableRowIds`), so a nested
run's agent comes right after the agent that started it.

## Calls made for main's shape

- **No new meta key, no Go change.** The fork stamps `agent:parenttab` on a worker's tab and reads it into
  `AgentVM.parentTabId`. On `main` the run already records its origin, and `lineageOf` (`runlineage.ts`) already reads
  every roster agent's run object (`reads.run(a.runId)`) to place it. So `Lineage` gains `origins` (agent id → the
  origin tab id of the agent's run), filled for the agents the lineage leaves plain. `RunInfo.originId` stays as it is
  (it is the origin of an orchestrator run's lead).
- **Quick runs only.** An orchestrator run started from an agent keeps its run block (lead or run row, its workers,
  done and queued folds) at the top level, with its existing "from <agent>" line (`OriginFrom`, `agenttree.tsx`). Why:
  the run block is laid out by its own fold and guides; nesting it would make every run row take a depth, and the fork
  nests only plain agents too ("a worker whose parent is a run's row stays a top-level row").
- **Across folders.** A run nests under its origin even when it works in another project: the point is to see which
  session started it. It counts in the origin's folder. Waits (`agentwaits.ts`) still nest within one folder only.
- **Origin before waits.** A run's agent that also waits on another agent nests under its origin and names whom it
  waits on (`waitsFor`). A waiter that waits on a nested run's agent does not nest under it (waits nest under top-level
  rows only, one level, as before) and names it.
- **Order under an agent:** its row, its check rows, the runs it started (roster order), then the agents waiting on it
  (each followed by the runs it started).
- **Depth on the row.** The `parent` row gains `depth?: number`, set on a run nested by origin (1 under a top-level
  row). A row's level is `rowDepth(row)`: `depth`, else 1 for the existing `nested` rows (waits, a pair's sides), else
  0. The fork had `depth` alone; `main`'s `nested` (one level) is pinned by many tests and stays.
- **Per-depth guides and indents** (`agenttree.tsx`): `Guides` draws one line per level at `18 + 17·i` px and a row at
  level `n ≥ 1` is padded `11 + 17·n` px, which keeps today's 28 px and 45 px at levels 1 and 2. A row's subagent and
  background-task rows sit one level under the row, wherever it is.

## Not taken, by owner decision (2026-11-25)

`wsh agents start`, `pkg/agentworker`, worker meta, memory admission for workers, notify/stop/resume of workers,
settling workers across a restart, the fork's single backend launch primitive (`LaunchAgentTabCommand`) and moving the
UI's launches onto it; with them the fork's `stopped` row state and pill. Why: a quick run (`wsh runs start`) already
gives an agent a visible tab the person can watch and type into, and the run already tells its origin session when it
lands; a worker agents start on their own would add a full claude process each (RAM) and spawn agents with no Token burn
gate, and the launch/resume path touches every agent's start. Recorded in `docs/open-issues.md`.

## Fork file to main file

| Fork | Main |
|---|---|
| `agenttreemodel.ts` `buildAgentTree` (`parentOf`, `nestsUnder`, `workersOf`, `pushAgent`) | `agenttreemodel.ts` `buildAgentTree` (origin nesting beside the waits and pairs), `rowDepth` |
| `agenttreemodel.test.ts` "with agent-started workers" | same file, "buildAgentTree with runs started from an agent" |
| `agentsviewmodel.ts` / `liveagents.ts` `parentTabId` from `agent:parenttab` | `runlineage.ts` `Lineage.origins` from `Run.origintabid` (`lineageOf`), test in `runlineage.test.ts` |
| `agenttree.tsx` `levelPad`, `Guides({ depth })`, `ParentRow depth` | `agenttree.tsx` the same, over `rowDepth` |
| `agentsviewmodel.ts` `stopped`, the stopped pill | not taken (workers) |
| `scripts/cdp/scenarios-agent-workers.mjs` | `scripts/cdp/scenarios-run-nesting.mjs` (`run-nesting`): a dev-mock roster and run objects seeded in the page cache, no agent runs |

## Checks

- Unit: `npx vitest run frontend/app/view/agents/agenttreemodel.test.ts frontend/app/view/agents/runlineage.test.ts`.
- Live: `task verify:ui -- run-nesting` shows a quick run nested under the agent that started it and a run of that
  run's agent one level further, with their indents, and the group count.
- By hand (`docs/hand-checks.md`): a real agent runs `wsh runs start` and its run's tab nests under it.

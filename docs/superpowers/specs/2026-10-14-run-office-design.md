# Run office — design

**Date:** 2026-10-14
**Status:** design agreed, not built
**Canvas:** `.superpowers/design/run-office/project/` (gitignored; `Main`, `States`, `Empty`, `Desk`)

## What it is

An on-demand view of the Brief's Runs region that draws each orchestrator run as one floor of a side-view pixel
office: the lead in a glass corner office, and one desk per dag task, where a 2D person sits in a pose that names
the task's engine state. It shows at a glance what the run rows say in words: who is typing, who is stuck, who is
waiting on whom, and who needs you.

It is a second rendering of data the Brief already holds. It adds no wshrpc command, no store, no backend work.

## Where it lives

- The Runs region (`REGIONS.sessions`, `briefsurface.tsx`) gets an **Office** toggle in its `tools` slot, beside
  `RunKindToggle`. Off is the default (compact UI by default). The choice is a per-viewer atom persisted in
  `localStorage` (try/catch, falls back to off).
- On, every run row (`BriefRunRow`, a line with a `runOid`) gets its floor drawn right under it. The row stays as it
  is and is the floor's header: every piece of information it shows today stays, and a click on it opens the run
  sheet as before. The region's cap, its `only` mode, its `+N more` line and its empty sentence do not change. A
  line with no run (a direct agent) gets no floor.
- Off, nothing of the office is mounted. Leaving Jarvis unmounts it (every surface but Agent unmounts).

## A floor

- **Lead office** (140 px): the lead's desk with two monitors, a glass partition, and a small wall board with one
  square per task (done, working, asking, failed, waiting). The lead is always there, also for a run with no dag yet.
- **Desks** (88 px each): one per `dag.tasks` entry, in task order. A floor wider than the region scrolls
  horizontally inside itself (`overflow-x: auto`); desks never wrap to a second row.
- **Label** under every desk: `<n> · <state word>` (`3 · stalled`), and `Needs you` under an asking lead or
  worker. Status is never pose or colour alone.
- **Tooltip** (`title`): `Task 3 · <task title> · stalled` with the click's effect.
- **Click:** a desk with a live worker or reviewer opens that agent's terminal through `openTarget`
  (`view/jarvis/openref.ts`, `{ kind: "agent" }`); the lead desk opens the lead's; a desk with no agent (pending,
  done and closed) opens the run (`{ kind: "run" }`).
- The floor of the run selected in the Brief takes `bg-surface-selected`, as a selected row does.

## Poses

Pure mapping in `officemodel.ts`. A worker or lead agent whose state is `asking` overrides its desk's pose with the
raised hand and `!` (amber), whatever the task state.

| Task state (`pkg/orchestrate/dag.go`) | Pose | Screen | Bubble |
|---|---|---|---|
| `pending` | empty chair, sticky note on the monitor, desk dimmed | off | — |
| `ready` | standing by the chair | prompt | — |
| `running` | typing (2 frames) | green lines scrolling | — |
| `stalled` | head on the desk | `…` | `?` amber |
| `reviewing` | leaning back, reviewer with a clipboard behind | diff lines | — |
| `review-failed` | head in hands | `✗` | `!` red |
| `blocked-merge` | standing with a box | `⇄` | `⇄` red |
| `verifying` | standing with a box | progress bar (2 frames) | — |
| `verify-failed` | head in hands | `✗` | `×` red |
| `done` | leaning back | `✓` | — |
| `failed` | head in hands | `✗` | `×` red |
| `cancelled`, `skipped` | empty, dimmed | off | — |

| Run stage (`runstage.ts`) | Lead pose |
|---|---|
| `planning` | typing |
| `plan-review` | leaning back, the plan reviewer at the desk with a clipboard |
| `working` | leaning back, watching the wall board |
| `final-check`, `landing` | standing with a box, progress bar |
| `wrapping-up` | typing |
| `land-held` | head in hands, `!` red |
| `landed`, `complete`, `cancelled` | empty chair, the lead's desk dimmed (the task desks keep their own states) |

## Drawing

- **Sprites as data:** `officesprite.ts` (pure) holds every pose as a grid of cell codes, 14 columns, 18 rows sitting
  and 22 standing, the way `petsprite.ts` holds the pet. Codes name roles (hair, skin, shirt, pants, shoes, paper,
  box), never colours.
- **Rasterised once:** a pose in an outfit is drawn once to a 14-column canvas and kept as a PNG data URL in a
  module cache keyed by pose and outfit. A desk renders `<img>` at 3× with `image-rendering: pixelated`. A frame
  change swaps `src`; nothing is redrawn. The people's colours are identity tokens no theme overrides, so the cache
  never goes stale. It is bounded: 10 poses × 8 shirts (6 lanes, the lead, the reviewer) × 4 looks = 320 entries.
- **People are not DOM pixels.** No box-shadow or one-`<rect>`-per-cell sprites: the canvas mock uses box-shadow
  only because a canvas file cannot rasterise.
- **Colours:** shirts are the positional `graphlane-1..6` palette by task position, so task 1 always wears lane 1.
  A look (skin and hair, 1..4) is picked by a hash of the task id. The rest are new identity tokens in `@theme`
  (`--color-office-skin-1..4`, `--color-office-hair-1..4`, `--color-office-pants`, `--color-office-ink`,
  `--color-office-box`, `--color-office-paper`, `--color-office-lead`, `--color-office-visitor`), with a why comment. Like the avatar palette they stay at their defaults in every
  theme. Desks, monitors, walls and floors use the existing surface, edge and status tokens.
- **Motion:** one timer per Office, 450 ms, flips a frame atom. Only the animated poses (typing, raised hand,
  progress bar) subscribe to it; every other desk renders once. The timer does not run while
  `document.hidden` or under `prefers-reduced-motion` (frame 0 stays), and stops with the unmount. No CSS
  animation, no `motion/react` on the desks.

## Files

| File | Holds |
|---|---|
| `view/jarvis/officemodel.ts` (+ test) | `RunInfo` + lineage + agents → `Floor[]` (lead desk, task desks, labels, click targets) |
| `view/jarvis/officesprite.ts` (+ test) | pose grids, the palette roles, grid → `ImageData` |
| `view/jarvis/officesprites.ts` | the rasteriser and the data-URL cache |
| `view/jarvis/officeview.tsx` | the toggle, the floors, the desks, the frame clock |
| `view/jarvis/officedevhooks.ts` | DEV-only `__officeFixture` / `__officeProbe` for the CDP scenarios |
| `view/jarvis/briefsurface.tsx` | the toggle, and the Runs region rendering floors when it is on |
| `frontend/tailwindsetup.css` | the office identity tokens |
| `scripts/cdp/officescenarios.mjs` | `jarvis-office` (visual) and `jarvis-office-bench` (budgets), listed in `scenarios.mjs` |

## Benchmark

The office ships only if it stays inside these budgets on the dev app, measured by a CDP scenario so it can be rerun.

**Fixture:** 8 runs of 12 tasks, every task state and most lead stages present, 1 worker asking: 104 desks. The
fixture is handed to the model through a DEV-only hook (`__officeFixture`), not seeded as real runs: what the bench
measures is the drawing, and the data it reads is already in memory for the run list. Seeding 8 real dags would start
real workers.

**Scenario `jarvis-office-bench`:** goto Jarvis with the Office off, force GC (`HeapProfiler.collectGarbage`), read
`Performance.getMetrics`; turn the Office on, wait 2 s, GC, read; hold 30 s, read; turn it off, GC, read. Then repeat
the 30 s hold under `Emulation.setEmulatedMedia` with `prefers-reduced-motion: reduce`.

| Measure | Budget |
|---|---|
| JS heap, open minus closed (after GC) | ≤ 5 MB |
| DOM nodes added | ≤ 2,000 |
| Main thread busy over the 30 s hold (`TaskDuration` delta / 30 s) | ≤ 2 % |
| Same, reduced motion | ≤ 0.5 % |
| Sprite cache entries | ≤ 320 (the bound above) |
| Heap after turning it off (after GC), minus the closed baseline | ≤ 1 MB |
| First open, toggle click to floors drawn | ≤ 150 ms |

The scenario prints the numbers in its PASS/FAIL row and fails over budget. The measured numbers go into
`docs/open-issues.md` under a "RAM watch" heading (created if missing), dated. A miss is reported, not tuned away
by raising the budget.

## Out of scope

- People walking between desks, a meeting room, an elevator between floors.
- Quick runs and plain agents (no dag, no floor). An initiative's runs show as their own floors.
- Any office outside Jarvis (the Agent tree, the pet).
- Sound.

## Verify

- vitest: `officemodel.test.ts` (each task state and run stage maps to its pose, label and click target; asking
  overrides; a run with no dag has only a lead), `officesprite.test.ts` (every grid is its declared size and uses
  only known codes; a pose's two frames are the same size).
- CDP: `jarvis-office` shows every pose of the `States` canvas board on its own small fixture (floors of at most six desks, so one shot holds every pose), and drives a real run's floor; `jarvis-office-bench` holds
  the budgets.

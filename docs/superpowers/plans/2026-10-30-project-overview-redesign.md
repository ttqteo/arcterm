# Project Overview redesign

**Spec:** `docs\superpowers\specs\2026-10-30-project-overview-redesign-design.md`
**Verify:** `npx vitest run frontend/app/view/agents frontend/app/cockpit/whatsnew.test.ts`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs project-overview-history`
**Prototype:** .superpowers\design\overview-redesign\project\B-activity-top.dc.html

The Overview (`frontend/app/view/agents/projectoverview.tsx`) loses its 1120px cap and puts Now and the Branches card
in a left column beside History at about 2:3. The run's base has no Branches card: Task 1 carries it in, with History's
lazy paging, from a snapshot of the main checkout's uncommitted work. No new pure logic, so no new unit tests.

**Hand-off for whoever lands the run (the lead or the person; no worker can do it):** before the landing merge, the
main checkout must drop its uncommitted copies of the carried work, or the merge stops on them:
the edits to `frontend/app/view/agents/projecthistory.tsx`, `projectoverview.tsx`, `projectoverviewmodel.ts`,
`projectoverviewmodel.test.ts`, the untracked `frontend/app/view/agents/projectgraph.ts`, `projectgraph.test.ts`,
`projectgraphcard.tsx`, and the untracked spec `docs/superpowers/specs/2026-10-30-project-overview-redesign-design.md`
(the run commits its own copy).

**Interface the tasks share** (DOM hooks the scenario reads; Task 3 writes against these names and runs beside the
others, and Final checks them on the merged result):

- `[data-project-overview]`: the page's scroll container (`px-8 py-6`).
- `[data-overview-left]`: the left column's wrapper, new in Task 2.
- `[data-overview-history-col]`: the new wrapper around `HistoryColumn`, new in Task 2.
- `[data-overview-now]`, `[data-overview-history]`, `[data-activity-card]`: already set.
- From the carried code: `[data-graph-card]` (also on its loading section, which has `aria-busy="true"`),
  `[data-graph-error]`, `[data-graph-row="worktree"]` and `[data-graph-row="<hash>"]` for commit rows;
  `[data-history-row]`, `[data-history-more]` (History's foot while rows are left), `[data-history-older]`, and
  `HISTORY_PAGE` (15) in `projectoverviewmodel.ts`.

### Task 1: Carry in the Branches card and History's lazy paging
**Depends on:** none
**Files:** `frontend/app/view/agents/projectgraph.ts`, `frontend/app/view/agents/projectgraph.test.ts`, `frontend/app/view/agents/projectgraphcard.tsx`, `frontend/app/view/agents/projecthistory.tsx`, `frontend/app/view/agents/projectoverviewmodel.ts`, `frontend/app/view/agents/projectoverviewmodel.test.ts`, `frontend/app/view/agents/projectoverview.tsx`, `CHANGELOG.md`

- From the repo root, `git apply .superpowers/overview-redesign/carry.patch`. It is another
  session's finished work, snapshotted unchanged: apply it as is, do not restyle or refactor it. It creates the
  three `projectgraph*` files and edits the other four listed (the `GraphCard` slot in `projectoverview.tsx`, History's
  `useLazyLimit` paging, and its model helper and test).
- Add one `### Added` line under `## Unreleased` in `CHANGELOG.md`, written for the user: the Overview's Branches
  card shows the newest commits of every branch over the commit graph, with uncommitted changes on top. Not big.

Acceptance: `npx vitest run frontend/app/view/agents/projectgraph.test.ts frontend/app/view/agents/projectoverviewmodel.test.ts frontend/app/cockpit/whatsnew.test.ts`
passes; `npx prettier --check` and `npx eslint` pass on the seven frontend files. In the running app (Final),
`project-overview-history` step 14 (the Branches card's rows) and step 15 (History's scroll paging), added by Task 3,
pass.

### Task 2: The dense two-column layout
**Files:** `frontend/app/view/agents/projectoverview.tsx`, `frontend/app/view/agents/projectgraphcard.tsx`, `CHANGELOG.md`

In `projectoverview.tsx`, per the spec's Layout section:

- Drop `mx-auto max-w-[1120px]` from the inner column; the page keeps `px-8 py-6` and its `gap-[22px]`.
- Header and `ActivityCard` stay on top at full width, unchanged.
- Move `GraphCard` out of its full-width slot. The body is the existing `@min-[1000px]:flex-row
  @min-[1000px]:items-start` row with a 24px gap (`gap-6`): a left column (`data-overview-left`, `flex w-full min-w-0
  flex-col gap-[22px] @min-[1000px]:flex-[2]`) holding `NowColumn` then `GraphCard` (same render condition as
  today: `path && git != null`). Now's fixed `w-[420px] flex-none` goes.
- `HistoryColumn` gets a new wrapper div in `projectoverview.tsx` (`data-overview-history-col`, `w-full min-w-0
  @min-[1000px]:flex-[3]`), rendered only when `path` is set. Leave `projecthistory.tsx` alone: its section's own
  `flex-1` sits inside the wrapper. Without History the left column's `flex-[2]` fills the row on its own.
- Below 1000px the columns stack in the order Now, Branches, History.
- Rewrite the file's header comment to describe the new layout.
- Builder's call: if at about 2/5 width a Branches row truncates its subject too soon, hide the author-initials mark
  below a container width in `projectgraphcard.tsx` before shortening the subject further. Hash, ref chips (up to 3,
  then `+N`), subject and age stay.

Add one `### Changed` line under `## Unreleased` in `CHANGELOG.md`: the Overview fills the centre pane, with Now and
Branches beside History, and History loads more sessions as you scroll. Not big.

Acceptance: `npx vitest run frontend/app/cockpit/whatsnew.test.ts` passes; `npx prettier --check` and `npx eslint` pass
on the touched files. In the running app (Final), `project-overview-history` step 1 (Branches under Now in a left
column at about 2:3 beside History, no width cap) and step 9 (stacked Now, Branches, History at 760px), extended by
Task 3, pass, and step 15 shows History paging inside the new wrapper.

### Task 3: Extend the project-overview-history scenario
**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`

Extend the existing `project-overview-history` scenario (`projectOverviewHistory`, its mock `ovhInstallMock` /
`ovhSessions` in `scripts/cdp/scenarios.mjs`); do not add a new scenario, and do not run prettier on this file
(`.mjs`, hand-formatted). Write against the plan's shared DOM hooks; the carried components' source is readable in
`.superpowers/overview-redesign/carry.patch`. Project A's fixture repo has one commit (`seed`,
`ovSeedRepo`) and a dirty `a.txt`, so its Branches card has a worktree row and one commit row. Put every measured
number in each step's detail. Steps 1 to 13 keep their current checks; the new ones extend steps 1 and 9 or come after step 13 as steps 14 and 15.

- Step 1 (1600px viewport): wait until the Branches card is ready: `[data-graph-row="worktree"]` and one commit row
  are present, and the card has no `[data-graph-error]` and no `aria-busy`. Then, from bounding rects: Branches is
  inside `[data-overview-left]` and below Now (`graph.top >= now.bottom`); the left column ends before
  `[data-overview-history-col]` starts; `left.width / historyCol.width` is between 0.55 and 0.8; the cap is gone:
  `[data-activity-card]`'s width is at least `page.clientWidth - 64 - 2` (`page` = `[data-project-overview]`), and
  when `page.clientWidth >= 1185` it is also more than 1120. If the author-initials mark is hidden at narrow widths
  (Task 2's builder call), record whether it shows at the measured left width.
- Step 9 (the overview set to 760px wide): also assert the stacked order Now, Branches, History (`now.bottom <=
  graph.top` and `graph.bottom <= history.top`).
- Step 14 (A's Overview at full width, after step 13): A's Branches card lists the worktree row first, then the seed commit's row; assert
  that row's subject reads `seed` and that it shows the commit's short hash (read the full hash from the fixture
  repo with `git rev-parse HEAD` in arrange and compare its first 7 characters); no error, not busy.
- Step 15 (History paging, last): a mock mode switched on after the existing steps (like `holdCouncils`, so steps
  1-14 keep their rows) answers 31 or more top-level sessions for A in the 7-day window. Reopen A's Overview;
  assert 15 `[data-history-row]` at the top level and `[data-history-more]` present; scroll `[data-project-overview]`
  to the bottom and assert the count reaches 30; scroll again and assert all rows show, `[data-history-more]` is gone
  and `[data-history-older]` ends the list. Shot it.
- Update the step labels to say what each now checks.

Acceptance: `node --check scripts/cdp/scenarios.mjs` passes; in the running app (Final, on the merged result) steps 1,
9, 14 and 15 of `project-overview-history` pass.

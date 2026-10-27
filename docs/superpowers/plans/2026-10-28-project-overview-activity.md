# Project Overview: activity heatmap, History by session

**Verify:** `node scripts/verify.mjs ./pkg/wstore ./pkg/projectactivity ./pkg/wshrpc/... ./cmd/server`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs project-overview project-overview-history`
**Prototype:** .superpowers/design/project-overview/project

## Approved design and scope

The person approved the canvas above (boards Main, Themes, ActivityCard) on 2026-10-28. It is the spec. In short:

- A run and a council are never standalone in a project: an agent session starts them (`wsh runs start`,
  `wsh council start`). So the Overview header keeps only **New agent** and **Terminal**. The Run and Council
  buttons and the "Last 7 days: N sessions · N runs · N councils" counts line go.
- History is one list, with no tabs. Each ended session in the 7-day window is a row, and the runs and councils it
  started sit indented under it. A run belongs to the session whose `transcriptpath` equals the run's
  `origintranscript`, and a council to the session whose `id` equals the council's `sessionid`. A run or council with no
  such session in the window (started from the cockpit, or its session is older than 7 days) is its own top-level row,
  ordered by time. Engine child runs never list: a run with `taskid`, `stagerole` or `parentleadoref` set. Search
  keeps a session when its title or any of its children's titles matches, and keeps an unattached row when its own
  title matches. The "Older: Conversation History" row, the loading skeleton, the error and retry row and the
  empty and no-match notes stay as they are today.
- A new **Activity** card sits between the header and the Now/History columns. It is a GitHub-style calendar: 53
  week columns, Monday to Sunday rows, one 14px cell per local day up to today, and Mon/Wed/Fri row labels and
  month labels. A cell's level is that day's tokens, in five steps: 0 is `bg-edge-mid`; 1 to 4 are `bg-accent-700`,
  `-500`, `-300`, `-100`, cut at the quartiles of the window's non-zero days. Those tokens follow the theme's accent
  (`themes.ts` derives the whole ramp), so the graph takes each theme's main colour. Days before the first day the
  tally holds anything draw as "No record": no fill, with a `border-dashed border-edge-strong` outline. Today
  carries a ring. Hovering a cell shows a tooltip: `Mon 26 Oct` (plus ` · today`), then
  `2.1M tokens · 3 sessions · 3 runs, 1 council`, or `No session`, or `No record`. The header line reads
  `<N> sessions · <N> tokens since <first record day>`, with `Tokens per day` at its right. The footer reads
  `Last 7 days: <N> sessions · <N> tokens`, then a run mark (◆) with `<N> runs` and a council mark (●) with
  `<N> councils`, then the Less→More legend and the No record swatch.
- arcterm keeps its own **daily tally**, because Claude Code deletes transcripts after `cleanupPeriodDays` (90 here).
  Without the tally the graph could never hold more than the transcripts still on disk.

Out of scope: the Now column, Conversation History, and the global + Run launcher (`launcherstore`'s "run" door stays
for the app bar).

## Worker brief: applies to every task

Read `AGENTS.md`, `DESIGN.md`, and the canvas boards before you start. Colours come from `@theme` tokens only, so
never use raw hex in a component. Testable logic goes in a pure `.ts` file with a `.test.ts` beside it, and the
`.tsx` stays thin. Never hand-edit generated files: run `task generate`. Check only the files you touched with
prettier and eslint. Match the comment density and voice of the files you edit (lowercase "why" comments).

### Task 1: Daily tally in wavesrv and the activity RPC
**Depends on:** none
**Files:** `db/migrations-wstore/000025_sessionday.up.sql`, `db/migrations-wstore/000025_sessionday.down.sql`, `pkg/wstore/wstore_sessionday.go`, `pkg/wstore/wstore_sessionday_test.go`, `pkg/projectactivity/projectactivity.go`, `pkg/projectactivity/projectactivity_test.go`, `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `cmd/server/main-server.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

- **Table** `db_sessionday (day TEXT, harness TEXT, session TEXT, cwd TEXT, tokens INTEGER, PRIMARY KEY (day, harness, session))`
  plus an index on `(cwd, day)`. A row is one session's tokens on one local day (`YYYY-MM-DD`, server-local, as
  `usagestats.Bucket.Day`). Upserting replaces the tokens, so a rescan is idempotent. A row outlives its transcript,
  which is the point of the table. `pkg/wstore/wstore_sessionday.go` holds the SQL: `UpsertSessionDays(ctx, rows)`
  in one transaction, `QuerySessionDays(ctx, project, fromDay)` returning the rows whose normalized cwd equals the
  project path or sits under it (`<path>/…`, so in-repo worktrees count), and `FirstSessionDay(ctx)` returning the
  earliest day in the whole table, or "" when it is empty. Normalize paths as the frontend's `normProjectPath` does
  (forward slashes, no trailing slash, case-insensitive compare).
- **Tally loop** (`pkg/projectactivity`): `StartLoop(ctx)` waits 2 minutes after startup, then runs a backfill once
  when the table is empty (`usagestats.ScanUsage(0)`: every transcript still on disk). After that it scans every
  30 minutes with `usagestats.ScanUsage(2)`. Each bucket becomes a row keyed (day, harness, session), with the cwd
  from the matching `SessionMeta` and the tokens summed over the bucket's input, output, reasoning, cache-read and
  cache-create fields. Use the same total the usage panel shows; read `wshserver_agents.go:69` for how that panel
  sums them. Skip buckets whose session has no meta cwd. Log the backfill's duration and row count once. Recover
  panics with `panichandler` as the loops beside it in `main-server.go` do, and start the loop there, next to
  `sessiontrash.StartPurgeLoop`.
- **RPC** `GetProjectActivityCommand(data {path string, weeks int}) → {days []ProjectActivityDay, firstday string}`, where
  `ProjectActivityDay` is `{day, tokens, sessions, runs, councils}`. Only days with something in them are returned.
  `sessions` counts distinct (harness, session) rows for the day. `runs` counts the project's top-level runs (no
  `TaskId`, `StageRole` or `ParentLeadORef`) by their `CreatedTs` local day. `councils` counts `council.List(path)`
  without `Bench` councils, by `Created`. The window is `weeks` weeks back from the start of the current
  Monday-first week (default 53). `firstday` is `FirstSessionDay`.
- **Tests:** upsert idempotence (same key twice keeps the second tokens); project match (exact, under the path,
  a sibling prefix such as `/a/arc` vs `/a/arcterm` excluded, case and backslash variants); the window bound;
  run filtering of child runs; council Bench exclusion; `FirstSessionDay` on an empty table; the tally turning
  buckets plus metas into rows (unit-test the pure conversion, not the loop timing).
- Run `task generate` after adding the RPC types, and commit the generated files with the task.

### Task 2: History by session, and a header with only New agent and Terminal
**Depends on:** none
**Files:** `frontend/app/view/agents/projectoverviewmodel.ts`, `frontend/app/view/agents/projectoverviewmodel.test.ts`, `frontend/app/view/agents/projecthistory.tsx`, `frontend/app/view/agents/projecthistorystore.ts`, `frontend/app/view/agents/projectoverview.tsx`, `frontend/tailwindsetup.css`

- In `projectoverviewmodel.ts`, replace `HistoryTab`, `historyItems` and `historyCounts` with
  `historyRows(sessions, councils, runs, path, now, q)`. It returns the ordered rows the column draws: a session row
  (as `projectSessions` keeps them), each followed by its children (runs and councils, newest first, each flagged
  as nested), and unattached run and council rows placed among the sessions by time. Keep `councilItem` and `runItem`
  and their line, warn and age words. Drop the engine child runs. Apply the search rule from the design.
  `projectSessions` stays.
- `projecthistory.tsx`: remove the tablist and draw the one list. A child row is indented 28px with its divider
  inset to match, and carries the kind label with its mark (a rotated square for a run in `bg-mark-run`, a dot
  for a council in `bg-mark-council`) beside "Run"/"Council". Keep every existing `data-history-*` attribute on the
  rows that still exist, and add `data-history-parent="<session key>"` on a nested row. The heading reads
  `History` with the session count beside it, as the canvas shows. The empty text becomes
  `No sessions in <project> in the last 7 days.`
- `projecthistorystore.ts`: remove `historyTabAtom`. Keep the query atom.
- Add the two mark tokens to `frontend/tailwindsetup.css` `@theme`, with a why comment: `--color-mark-run: #5cc8d8;` and
  `--color-mark-council: #c58cff;`. They are identity colours and theme-agnostic, so leave them out of `themes.ts`.
  Task 3's card uses them too. **This task owns `frontend/tailwindsetup.css`.**
- `projectoverview.tsx`: remove the Run and Council buttons, the counts line, `historyCounts` and `setTab`, and the
  now-unused imports (`showCouncilSetup`, `Fragment`, the `LauncherKind` use if it goes unused). The header keeps the
  title, branch, changes, path, New agent and Terminal.
- **Tests:** a run attaches under its session by `origintranscript`; a council attaches by `sessionid`; an
  unattached run is a top-level row in time order; child runs are dropped; search keeps a parent whose child
  matches; a run whose session is live (not in the list) is unattached. Delete the `historyCounts` and tab tests.

### Task 3: The Activity card
**Depends on:** Task 1 (calls GetProjectActivityCommand through the generated client and types it adds), Task 2
**Files:** `frontend/app/view/agents/projectactivity.ts`, `frontend/app/view/agents/projectactivity.test.ts`, `frontend/app/view/agents/projectactivitystore.ts`, `frontend/app/view/agents/projectactivitycard.tsx`, `frontend/app/view/agents/projectoverview.tsx`

- `projectactivity.ts` is pure, with no React. `activityGrid(days, firstDay, today)` builds 53 Monday-first week
  columns ending with the week that holds `today`; the last column stops at today. Each cell carries its day, its
  record, `none` when the day is before `firstDay` (or when `firstDay` is ""), and its level 0–4 from the quartile
  cuts. It also returns the month labels (a week whose Monday starts a new month; skip the first column and any
  label closer than 3 columns to the previous one), the tooltip words, the header summary and the footer's
  last-7-days numbers. Format tokens with `formatTokens`.
- `projectactivitystore.ts`: an `atomFamily` by path that holds `{days, firstday} | null` and an error. Load once
  when the Overview mounts for a path, and again when a `refresh` is called. No polling.
- `projectactivitycard.tsx` draws the card as the canvas Main and ActivityCard boards do: a panel
  (`bg-surface-raised border-edge-mid rounded-[8px]`), 14px cells with a 4px gap, `rounded-[3px]`, and the level
  classes from the design. The tooltip is the app's popover look (`bg-surface-hover border-edge-strong`,
  `shadow-popover-sm`), opened on hover and on keyboard focus. Cells are not tab stops: the grid is one focusable
  region with `aria-label`, and arrow keys move the focused cell. Add `data-activity-card`, `data-activity-cell="<day>"`
  with `data-level`, and `data-activity-tip`. Loading shows the grid's frame with `Skeleton` cells. An error shows
  one line with Retry. A project with no record at all still draws the grid, all "No record", and the header line
  reads `No activity recorded yet`.
- Mount it in `projectoverview.tsx` between the header and the columns, only when the project has a path.
- **Tests:** a 53-column grid ending today on each weekday; the before-`firstDay` cells; quartile cuts with ties
  and a single non-zero day; month labels; tooltip words for a busy day, an empty day, a no-record day and today;
  the last-7-days sums; formatting such as `6.9M`.

### Task 4: Scenarios and changelog
**Depends on:** Task 3 (asserts the data-activity-card, data-activity-cell and data-activity-tip attributes it adds, and the data-history-parent rows of Task 2 before it)
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

- Update `project-overview`: the header's actions are exactly `agent` and `terminal`, and there is no counts line.
  Add a step that shows the Activity card: 53 columns with today's cell ringed, a hover tooltip, and the theme follow.
  For the theme follow, set another theme preset and check that a level-4 cell's computed background changes to
  that theme's derived `accent-100`, then restore the theme. The Mac Final runs headless Chrome, so this needs no
  host.
- Update `project-overview-history`: drop the tab and counts steps. Seed one session with a run attached by
  `origintranscript`, one council attached by `sessionid`, and one unattached run. Shoot the nested list, and
  assert the `data-history-parent` links and the order. Keep the search, empty, error and Older steps working.
- `CHANGELOG.md`, under the top `Unreleased` section (open one if the top section is dated): one `Changed` line saying
  the project Overview shows a year of activity as a calendar in your theme's colour, and lists each session with
  the runs and councils it started, without the Run and Council buttons.

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
  such session in the window (started from the cockpit, or its session is older than 7 days or still live) is its own
  top-level row, ordered by time. Engine child runs never list: a run with `taskid`, `stagerole` or `parentleadoref`
  set. Search keeps a session when its title or any of its children's titles matches, and keeps an unattached row when
  its own title matches. The "Older: Conversation History" row, the loading skeleton, the error and retry rows and the
  empty and no-match notes stay.
- A new **Activity** card sits between the header and the Now/History columns. It is a GitHub-style calendar: 53
  week columns, Monday to Sunday rows, one 14px cell per local day up to today, and Mon/Wed/Fri row labels and
  month labels. A cell's level is that day's tokens, in five steps: 0 is `bg-edge-mid`; 1 to 4 are `bg-accent-700`,
  `-500`, `-300`, `-100`, cut at the quartiles of the window's non-zero days. Those tokens follow the theme's accent
  (`themes.ts` derives the whole ramp), so the graph takes each theme's main colour. Days before the first day the
  tally holds anything draw as "No record": no fill, with a `border-dashed border-edge-strong` outline. Today
  carries a 1px ring in the muted colour; the hovered or focused cell a 1.5px ring in the text colour. Hovering a
  cell shows a tooltip: `Mon 26 Oct` (plus ` · today`), then `2.1M tokens · 3 sessions · 3 runs, 1 council`, or
  `No session`, or `No record`. The header line reads `<N> sessions · <N> tokens since <first record day>`, with
  `Tokens per day` at its right. The footer reads `Last 7 days: <N> sessions · <N> tokens`, then a run mark (◆) with
  `<N> runs` and a council mark (●) with `<N> councils`, then the Less→More legend and the No record swatch.
- arcterm keeps its own **daily tally**, because Claude Code deletes transcripts after `cleanupPeriodDays` (90 here).
  Without the tally the graph could never hold more than the transcripts still on disk.

### Points the canvas leaves open, settled here

- **An unattached row's line.** A run with no `origintranscript`, or a council with no `sessionid`, reads
  `Started from the cockpit, not a session · <its usual line>` (canvas Main, "Rebuild the release for 0.15.18"). An
  unattached row that does name a session (older than the window, or still live) keeps its usual line.
- **The footer's session count is History's.** The canvas has the last-7-days numbers match the History heading
  (13 and 13). So the footer's `<N> sessions` and the heading's count are one number: `projectSessions(sessions,
  path, now, "").length`, the ended sessions History lists, without the search. Until History's sessions load, the
  footer leaves its session count out. The footer's tokens, runs and councils are the tally's last 7 local days.
- **A day with no session.** A day whose `sessions` is 0 reads `No session` in its tooltip, even when a run or
  council falls on it (canvas ActivityCard), and its level comes from its tokens as every day's does.
- **The header's numbers.** `<N> sessions` is the distinct sessions in the window (the RPC's `sessions`; summing the
  days would count a session once per day it ran). The tokens are the sum of the window's days. `since` names the
  later of `firstday` and the grid's first day.
- **History's two loads.** The one list waits for both: it shows the loading skeleton until the sessions and the
  councils have loaded and the runs have loaded or failed (today's `itemsBusy` rule), so rows never jump as children
  arrive. A failed read draws its error row at the top of the list, the sessions' first, then the runs', each with
  its Retry, and the list under them draws what was read.

Out of scope: the Now column, Conversation History, and the global + Run launcher (`launcherstore`'s "run" door stays
for the app bar).

## Worker brief: applies to every task

Read `AGENTS.md`, `DESIGN.md`, and the canvas boards before you start. Colours come from `@theme` tokens only, so
never use raw hex in a component. Testable logic goes in a pure `.ts` file with a `.test.ts` beside it, and the
`.tsx` stays thin. Never hand-edit generated files: run `task generate`. Check only the files you touched with
prettier and eslint. Match the comment density and voice of the files you edit (lowercase "why" comments).

### Task 1: The activity RPC's interface
**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_projectactivity.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

- Add `GetProjectActivityCommand(ctx, CommandGetProjectActivityData) (*CommandGetProjectActivityRtnData, error)`
  beside the agents commands in `wshrpctypes_agents.go`. `CommandGetProjectActivityData` is
  `{path string "path"; weeks int "weeks"}`. `CommandGetProjectActivityRtnData` is
  `{days []ProjectActivityDay "days"; firstday string "firstday"; sessions int "sessions"}`. `ProjectActivityDay` is
  `{day string "day"; tokens int64 "tokens"; sessions int "sessions"; runs int "runs"; councils int "councils"}`.
  Comment each field with what Task 2 fills it with (below), so the frontend reads the meaning from the types.
- Add the handler in a new `pkg/wshrpc/wshserver/wshserver_projectactivity.go`. In this task it returns empty days,
  `firstday` "" and `sessions` 0, with a comment that Task 2's tally fills it. Task 2 replaces the body only; the
  types are final here, so Task 2 never regenerates.
- Run `task generate` and commit the generated files with the task.
- **Tests:** `go build ./...` and `task check:ts` pass; the generated `RpcApi.GetProjectActivityCommand` exists.

### Task 2: The daily tally and the activity query
**Depends on:** Task 1 (fills in the handler body it adds in wshserver_projectactivity.go)
**Files:** `db/migrations-wstore/000025_sessionday.up.sql`, `db/migrations-wstore/000025_sessionday.down.sql`, `pkg/wstore/wstore_sessionday.go`, `pkg/wstore/wstore_sessionday_test.go`, `pkg/projectactivity/projectactivity.go`, `pkg/projectactivity/projectactivity_test.go`, `pkg/projectactivity/tally.go`, `pkg/projectactivity/tally_test.go`, `pkg/wshrpc/wshserver/wshserver_projectactivity.go`, `cmd/server/main-server.go`

- **Table** `db_sessionday (day TEXT, harness TEXT, session TEXT, cwd TEXT, tokens INTEGER, PRIMARY KEY (day, harness, session))`
  plus an index on `(cwd, day)`. A row is one session's tokens on one local day (`YYYY-MM-DD`, server-local, as
  `usagestats.Bucket.Day`). Upserting replaces the tokens, so a rescan is idempotent. A row outlives its transcript,
  which is the point of the table. Store `cwd` normalized as the frontend's `normProjectPath` does, and lower-cased
  (forward slashes, no trailing slash), so the query compares plain strings.
- `pkg/wstore/wstore_sessionday.go` holds the SQL: `UpsertSessionDays(ctx, rows)` in one transaction;
  `QuerySessionDays(ctx, project, fromDay)` returning the rows whose cwd equals the normalized project path or sits
  under it (`cwd = p OR substr(cwd, 1, length(p) + 1) = p || '/'`; not `LIKE`, whose `_` and `%` are wildcards), so
  in-repo worktrees count; `FirstSessionDay(ctx)` and `LastSessionDay(ctx)`, the earliest and newest day in the whole
  table, or "" when it is empty.
- **Tally** (`pkg/projectactivity/tally.go`): a pure `TallyRows(buckets []usagestats.Bucket, metas []usagestats.SessionMeta) []wstore.SessionDay`.
  A `usagestats.Bucket` is per (harness, provider, model, day, session) (`pkg/usagestats/usagestats.go:54`), so a
  session that used two models has two buckets for a day: sum them into one row per (day, harness, session). A
  bucket's tokens are input + output + reasoning + cache-read + cache-create, the total the usage panel shows
  (`bucketTokens`, `frontend/app/view/agents/usagestats.ts:149`). The cwd is the matching `SessionMeta`'s; skip a
  session with no meta cwd.
- **Loop**: `StartLoop(ctx)` waits 2 minutes after startup, then scans, then scans again every 30 minutes. Each scan
  reads back to the newest tallied day: `usagestats.ScanUsage(0)` (every transcript still on disk) when
  `LastSessionDay` is "", else `ScanUsage(n)` with `n` the local days from that day to today, both included, so days
  arcterm was closed or the Mac slept are tallied once it runs again, and the newest day, whose tokens may have grown,
  is rescanned. Log the first scan's duration, day span and row count once. Return an error from a failed scan or
  upsert to the loop, which logs it and tries again at the next tick. Recover panics with `panichandler` as the loops
  beside it in `main-server.go` do, and start the loop there, next to `sessiontrash.StartPurgeLoop`. Put the
  span computation in a pure function so it is tested without the timer.
- **Query** (`pkg/projectactivity/projectactivity.go`): a pure
  `Aggregate(rows []wstore.SessionDay, runs []*waveobj.Run, councils []*council.Council, now time.Time, weeks int)`
  returning the RPC's days and `sessions`. Only days with something in them are returned. A day's `tokens` sums its
  rows; its `sessions` counts its distinct (harness, session) rows; `runs` counts the top-level runs (no `TaskId`,
  `StageRole` or `ParentLeadORef`) by their `CreatedTs` local day; `councils` counts the councils without `Bench` by
  `Created`. The return's `sessions` counts the distinct (harness, session) pairs across the whole window. The window
  is `weeks` weeks back from the start of the current Monday-first week (`weeks` ≤ 0 means 53).
- **Handler** (`wshserver_projectactivity.go`): fetch, then call `Aggregate`. The runs are the set History reads, so
  the counts agree: the channels bound to the path (`wstore.GetChannels`, `projectpath` compared normalized as
  above), each channel's `wstore.GetChannelRuns`, then `withoutBrainstormSessions` (`wshserver_channels.go:74`). The
  councils are `council.List(path)`. The rows are `QuerySessionDays(path, <window's first day>)`, and `firstday` is
  `FirstSessionDay`. Wrap each store error with what it was reading.
- **Tests:** upsert idempotence (same key twice keeps the second tokens); project match (exact, under the path, a
  sibling prefix such as `/a/arc` vs `/a/arcterm` excluded, case and backslash variants, a path holding `_`);
  `FirstSessionDay` and `LastSessionDay` on an empty table and a filled one; `TallyRows` summing two models of one
  session-day into one row and skipping a session with no cwd; the scan span (empty table → 0, newest day today → 1,
  newest day three days back → 4); `Aggregate`'s window bound, child-run filtering, Bench exclusion, per-day distinct
  sessions, and the window's distinct `sessions` counting a session that ran on two days once.

### Task 3: History by session, and a header with only New agent and Terminal
**Depends on:** none
**Files:** `frontend/app/view/agents/projectoverviewmodel.ts`, `frontend/app/view/agents/projectoverviewmodel.test.ts`, `frontend/app/view/agents/projecthistory.tsx`, `frontend/app/view/agents/projecthistorystore.ts`, `frontend/app/view/agents/projectoverview.tsx`, `frontend/tailwindsetup.css`

- In `projectoverviewmodel.ts`, replace `HistoryTab`, `historyItems` and `historyCounts` with
  `historyRows(sessions, councils, runs, path, now, q)`. It returns the ordered rows the column draws: a session row
  (as `projectSessions` keeps them), each followed by its children (runs and councils, newest first, each flagged
  as nested), and unattached run and council rows placed among the sessions by time. Keep `councilItem` and `runItem`
  and their line, warn and age words; an unattached row with no origin session gets the
  `Started from the cockpit, not a session · ` prefix on its line (see "Points the canvas leaves open"). Drop the
  engine child runs. Apply the search rule from the design. `projectSessions` stays.
- `projecthistory.tsx`: remove the tablist and draw the one list. A child row is indented 28px with its divider
  inset to match, and carries the kind label with its mark (a rotated square for a run in `bg-mark-run`, a dot
  for a council in `bg-mark-council`) beside "Run"/"Council", as canvas Main draws it. Keep every existing
  `data-history-*` attribute on the rows that still exist, and add `data-history-parent="<session key>"` on a nested
  row. The heading reads `History` with `<N> sessions` beside it (`data-history-count`), N being
  `projectSessions(sessions, path, now, "").length`, left out while the list loads. Loading and the two error rows
  follow "History's two loads" above. The empty text, when the window holds no session and no unattached row,
  becomes `No sessions in <project> in the last 7 days.`
- `projecthistorystore.ts`: remove `historyTabAtom` and the `HistoryTab` import. Keep the query atom.
- Add the two mark tokens to `frontend/tailwindsetup.css` `@theme`, with a why comment: `--color-mark-run: #5cc8d8;` and
  `--color-mark-council: #c58cff;`. They are identity colours and theme-agnostic, so leave them out of `themes.ts`.
  Task 4's card uses them too. **This task owns `frontend/tailwindsetup.css`.**
- `projectoverview.tsx`: remove the Run and Council buttons, the counts line, `historyCounts` and `setTab`, and the
  now-unused imports (`showCouncilSetup`, `Fragment`, the `LauncherKind` use if it goes unused). The header keeps the
  title, branch, changes, path, New agent and Terminal.
- **Tests:** a run attaches under its session by `origintranscript`; a council attaches by `sessionid`; an
  unattached run is a top-level row in time order; an unattached run with no `origintranscript` and a council with
  no `sessionid` carry the cockpit prefix, and one whose session is older than the window does not; child runs are
  dropped; search keeps a parent whose child matches, and keeps an unattached row by its own title; a run whose
  session is live (not in the list) is unattached. Delete the `historyCounts` and tab tests.
- **Shown by:** Task 5's `project-overview-history` steps for the nested rows and their parent links, the order, the
  cockpit prefix, the heading count, the new empty text, search keeping a parent by a child's title, and the header
  holding only `agent` and `terminal` (`project-overview` step 4).

### Task 4: The Activity card
**Depends on:** Task 1 (calls GetProjectActivityCommand through the generated client it adds), Task 3 (shares projectoverview.tsx, and uses the mark tokens it adds to tailwindsetup.css)
**Files:** `frontend/app/view/agents/projectactivity.ts`, `frontend/app/view/agents/projectactivity.test.ts`, `frontend/app/view/agents/projectactivitystore.ts`, `frontend/app/view/agents/projectactivitycard.tsx`, `frontend/app/view/agents/projectoverview.tsx`

- `projectactivity.ts` is pure, with no React. `activityGrid(rtn, today)` builds 53 Monday-first week columns ending
  with the week that holds `today`; the last column stops at today. Each cell carries its day, its record, `none`
  when the day is before `firstday` (or when `firstday` is ""), and its level 0–4 from the quartile cuts. It also
  returns the month labels (a week whose Monday starts a new month; skip the first and the last column, as canvas
  ActivityCard does, and any label closer than 3 columns to the previous one), the tooltip words (see "A day with no
  session"), the header summary (see "The header's numbers") and the footer's last-7-local-days tokens, runs and
  councils. `moveCell(index, key, cellCount)` gives the cell an arrow key moves to (Left/Right a week, Up/Down a day,
  clamped to the grid and to today). Format tokens with `formatTokens`.
- `projectactivitystore.ts`: an `atomFamily` by path that holds `{rtn | null, error | null, loading}`. It loads each
  time the Overview mounts for a path (opening it again reloads) and on Retry. No polling.
- `projectactivitycard.tsx` draws the card as the canvas Main and ActivityCard boards do: a panel
  (`bg-surface-raised border-edge-mid rounded-[8px]`), 14px cells with a 4px gap, `rounded-[3px]`, the level
  classes from the design, today's and the hovered/focused cell's rings, the run and council marks in the footer
  (`bg-mark-run`, `bg-mark-council`), the legend's five swatches and the No record swatch. The tooltip is the app's
  popover look (`bg-surface-hover border-edge-strong`, `shadow-popover-sm`), opened on hover and on keyboard focus.
  Cells are not tab stops: the grid is one focusable region with `aria-label`, and arrow keys move the focused cell
  (`moveCell`). The footer's session count is a prop: `projectoverview.tsx` passes
  `projectSessions(history.sessions, path, now, "").length`, or null while those load (then the footer leaves it
  out). Loading shows the grid's frame with `Skeleton` cells. An error shows one line with Retry. A project with no
  record at all still draws the grid, all "No record", and the header line reads `No activity recorded yet`.
- DOM hooks for Task 5: `data-activity-card`; `data-activity-cell="<day>"` with `data-level` (`none` or `0`–`4`);
  `data-today` on today's cell; `data-activity-focused` on the focused cell; `data-activity-tip`;
  `data-activity-summary` (the header line); `data-activity-footer`; `data-activity-legend`; `data-activity-month`
  on each month label; `data-activity-loading`; `data-activity-error`; `data-activity-retry`.
- Mount it in `projectoverview.tsx` between the header and the columns, only when the project has a path.
- **Tests:** a 53-column grid ending today on each weekday; the before-`firstday` cells; quartile cuts with ties
  and a single non-zero day; month labels, none on the first or the last column; tooltip words for a busy day, a
  day with runs but no session, a no-record day and today; the header summary's distinct sessions and `since` day,
  and `No activity recorded yet`; the last-7-days sums; `moveCell` at each edge and at today; formatting such as
  `6.9M`.
- **Shown by:** Task 5's `project-overview` Activity steps: the grid, today's ring, the tooltip variants, the
  header and footer, the legend and months, the keyboard, loading, error and Retry, the empty project, and the
  Claude, Midnight and Nocturne shots.

### Task 5: Scenarios and changelog
**Depends on:** Task 2 (its real handler answers the calls the mock passes on), Task 4 (asserts the data-activity-* hooks it adds, and the data-history-* rows of Task 3 before it)
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

- **Activity data.** Final starts with an empty store and no transcripts, so the tally has nothing. Answer
  `getprojectactivity` in the page's mock RPC client, the way `installAhMock` (`scripts/cdp/scenarios.mjs:14698`)
  answers `getsessionsactivity`, in both scenarios, with a mode the scenario switches from the page: `ok` (seeded),
  `hold` (a promise the scenario releases), `fail` (rejects), `empty` (`{days: [], firstday: "", sessions: 0}`). The
  seed holds days at all five levels, a day with a run and no session, a `firstday` about 120 days back so the
  earlier cells are No record, and today. The card loads on mount, so install the mock and set a mode before
  opening the Overview, and open it again after changing the mode.
- **`project-overview`:** step 4's actions are exactly `["agent", "terminal"]` and there is no counts line. Remove
  steps 6b and 6c (the Run and Council buttons, ~line 54178 and ~54193); 6a and 6d stay. Add Activity steps, each with
  an `h.shot`:
  - the card shows 53 columns, the last ending today, today's cell carries `data-today`, and a level-4 cell exists;
  - hovering a busy day, the no-session day, a No record day and today shows `data-activity-tip` with the design's
    words for each;
  - the summary reads `<N> sessions · <N> tokens since <day>` from the seed, the footer reads
    `Last 7 days: <N> sessions · <N> tokens` with the run and council counts of the seed's last 7 days, the legend
    has five swatches and the No record swatch, and month labels exist with none on the first or last column;
  - focusing the grid and pressing ArrowLeft and ArrowUp moves `data-activity-focused` and the tip follows it;
  - `hold`: the card shows `data-activity-loading`; release it and the grid draws;
  - `fail`: the card shows `data-activity-error`; set `ok`, click `data-activity-retry`, and the grid draws;
  - `empty`: every cell is `data-level="none"` and the summary reads `No activity recorded yet`;
  - themes: switch the preset to Midnight, then Nocturne, the way the terminal-theme scenario does (~line 10712),
    shoot the card under each, and assert a level-4 cell's computed background equals that of a probe element styled
    `background: var(--color-accent-100)`; restore the preset in teardown. The Mac Final runs headless Chrome, so this
    needs no host.
- **`project-overview-history`:** drop the tab and counts steps and rewrite the steps that read the old empty text.
  Seed one session with a run attached by `origintranscript`, a council attached by `sessionid`, and one unattached run
  with no `origintranscript`. Shoot the nested list and assert the `data-history-parent` links, the order, the
  unattached row's line starting `Started from the cockpit, not a session · `, the heading's
  `data-history-count` reading `<N> sessions`, search keeping the parent when only the child's title matches, and
  the empty text `No sessions in <project> in the last 7 days.` Keep the search, no-match, error and Retry, and Older
  steps working.
- `CHANGELOG.md`, under the top `Unreleased` section (open one if the top section is dated): one `Changed` line saying
  the project Overview shows a year of activity as a calendar in your theme's colour, and lists each session with
  the runs and councils it started, without the Run and Council buttons.

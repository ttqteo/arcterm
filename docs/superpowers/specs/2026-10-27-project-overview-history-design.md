# Project Overview: Now and History

The Overview (`2026-10-22-project-overview-design.md`) shows what waits on you and what runs in a project, and nothing
else, so a quiet project's page is one line and a dead end. The person opens it for a brief of the project and to look
back over what was done there, which is often where the next idea comes from. This redraws it in two columns: **Now**
on the left (what the page shows today, plus the agents that finished a turn you have not read) and **History** on the
right (the project's past sessions, councils and runs). It reverses that spec's "Out of scope" on Recent and a second
column, at the person's choice (2026-10-27).

Prototype: `.superpowers/design/project-overview-history/project/` (Main, CouncilsRuns, Search, Quiet, States, Narrow).

Ideas (`pkg/ideastore`) are left out on purpose: the feature is being removed.

## The page

`max-width` 1120px, centred in the centre pane. The header spans both columns; under it, Now is a fixed 420px column
and History takes the rest. Under ~1000px of pane width the columns stack, Now first.

**Header** — as today (name, branch pill, change count with `+N −N`, path, New agent / Terminal / Run / Council), plus
one line of counts: "Last 7 days: 14 sessions · 7 runs · 3 councils". Each count is a button that shows its tab in
History. A count of 0 is left out; with all three 0 the line is left out.

**Now** (left)
- **Needs you** — the asking agents and the Cockpit strip's items for the project, as today, in two-tier rows (name,
  then the question or item text) to fit the narrower column. Three or more items of one kind fold into one row,
  "Run to confirm · 5 runs ▸", which unfolds to the items; each item still unfolds its why (the strip's `whyLines`).
- **Running** — as today.
- **Finished, not read yet** — the project's agents in `unreadAgentsAtom` (`unreadagentsstore.ts`, the source of the
  Agent nav badge) that are not asking or working: a hollow dot, the name, their last activity line, the age. A click
  selects the agent (`selectAgentRow`), which marks it read.
- An empty block is not drawn; with all three empty one line says "Nothing needs you and nothing is running in
  <project>."

**History** (right)
- A search box (`/` focuses it while the Overview has focus) and two tabs with counts: **Sessions** (the default) and
  **Councils & runs**.
- **Sessions** — the project's ended sessions, newest first: the task as the title; branch · runtime · tokens under it;
  the age. A click opens the transcript (`showSession`, `agentcenter.ts`).
- **Councils & runs** — merged, newest first. A council: its question (or feature), "Answer: " + `summary.answer` when
  it has one, else its state, and its expert count. A run: its goal headline, its state ("Landed on <base branch>", "Land held", "Running", "Cancelled"…),
  and "M not verified" in the asking colour when its result was unverified and not acknowledged (M counts the
  reasons and land notes, as the Needs you item does). A click opens it through
  `openTarget` (`view/jarvis/openref.ts`).
- The window is 7 days. The list's last row reads "Older: Conversation History", which opens `showHistory`. That page
  has only a status filter (`sessionsStatusFilterAtom`), no project or text filter, so it opens unfiltered; giving it a
  project filter is a separate change.

## Data

All from commands and stores the frontend already has; no new backend command.

- Sessions: the scanned archive Conversation History and the sidebar already hold (`sessionsArchiveAtom`,
  `loadSessionsArchive`, `sessionsarchivestore.ts`), overlaid with the roster (`overlayLive`) so a live one is left out,
  kept to the project's path, the window, and sessions that are no run's worker (`runid` empty: the run stands for
  them). It covers every runtime, where `GetRecentSessionsCommand` reads Claude's only. Search filters the task on the
  client.
- Councils: `CouncilListCommand { project: path }`; they also update on the `council` event `councilstore.ts` already
  follows.
- Runs: `GetChannelRunsCommand` for each channel bound to the project's path (`Channel.projectpath`), kept to runs
  created in the window. A run opens as the Needs you rows open one: `{ kind: "channel", channelId, runId }`. Search
  filters councils and runs on the client, on their title.
- The header's counts come from the same lists.
- History is read when the Overview opens and when its project changes, not polled.

## States

- Loading: grey skeleton rows in the History list; Now is drawn at once from the roster.
- A project with no history: "No sessions, runs or councils in <project> in the last 7 days." plus the Older row.
- A search with no match: "Nothing in the last 7 days matches "<q>"." with **Clear search**.
- A source that fails to load: one line in its tab, "Could not read sessions." (`sessionsErrorAtom`) or "Could not
  read runs: <error>.", with **Retry**; in Councils & runs the councils still show. `councilstore.ts` logs a failed
  list and keeps no error, so councils have no error line.
- No project path: History is not drawn and Now takes the page width (as Terminal and Council are hidden today).

## Shape of the code

- `needsyoustripmodel.ts`: `foldNeedsYouRows(rows)` groups three or more rows of one `kindLabel` into a group row.
- `projectoverviewmodel.ts`: `finished` rows from the roster and the unread set; `projectSessions(...)` picks and sorts
  the sessions; `historyItems(councils, runs, q)` merges and sorts councils and runs; `historyCounts(...)` for the
  header line. Tests beside it.
- `projecthistorystore.ts`: loads a project's runs (sessions and councils have their stores), holds the runs' loading
  and error state, the query and the tab, per project in jotai atoms (the Agent surface's centre modes unmount).
- `projectoverview.tsx`: the two-column page; `projecthistory.tsx`: the History column.
- `CHANGELOG.md`: one `Changed` line.

## Verify

- vitest: the fold (2 stays, 3 folds, mixed kinds), `finished` (unread idle only, other projects never), the merge and
  its sort, the search filter, the counts.
- A CDP scenario `project-overview-history`: with fixture sessions, a council and a run in the project, shot the two
  columns, the Councils & runs tab, a search with no match, and the stacked layout at a narrow width.

## Out of scope

Commits (the Diff surface has the git history), ideas, a mini dashboard of 7-day tiles (drawn and set aside: the count
line does the brief), and searching inside transcripts.

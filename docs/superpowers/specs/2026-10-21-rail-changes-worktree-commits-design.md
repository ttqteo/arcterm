# Rail Changes: worktree, commits and commit — design

The right panel's Changes tab lists files and nothing else: it does not say which checkout the list is measured in,
which commits it spans, and committing means leaving the agent for the Diff surface. Three additions, all frontend
(no Go change, no `task generate`):

1. a line naming where the diff is measured: the branch and the worktree;
2. a **Commits** section with the commit graph's lanes, over the same range as the files;
3. a **commit mode** in the tab: tick files, write a message, commit, beside the agent's terminal.

Prototype: `.superpowers\design\rail-changes-commits\project\` (boards `Main`, `CommitMode`,
`MainCheckout`, `ManyCommits`, `States`).

## What shows

### Where line

- The tab's first line, above the Session / Branch switch: the branch (`GitBranch` 11px) · the worktree's short name
  (`FolderTree` 11px) in a linked worktree; in the main checkout the branch · the project name (`Folder`) · "main
  checkout". Its tooltip is the full `cwd`. Same type and colours as the Overview facts line (`FactsLine`, 11.5px
  medium, `text-secondary`, icons `text-muted`, `·` in `text-ink-faint`).
- Sources: `railState.branch`, `railState.worktree` through `worktreeName`, `railState.cwd`, the agent's project name.
  Left out while the rail has no `cwd` or the directory is not a repository, like the list under it. An ended session
  (`SealedFiles`) shows none: its worktree is gone.

### Commits

- A section between the switch and the files, headed like a rail section (`HeadedSection`'s look: icon 13px,
  "Commits", the count, a chevron that folds it; folded, a summary "newest 12m · since main" in `text-ink-faint`).
- The range is the files list's own, so the two always agree: Branch is `<branchDiff.ref>..HEAD` (the merge base), Session
  is `<railState.ref>..HEAD` (the session-start commit). Session with `ref` "" (no start recorded) has no range: no
  section.
- Read with `GitHistoryCommand({ cwd, ref: "<from>..HEAD", limit: 21 })`: 20 rows shown, the 21st only says there are
  more. No commits in range: the section is left out, not drawn empty (`MainCheckout`).
- Rows 26px: the lane gutter, the short sha (`font-mono` 10.5px `text-muted`), the subject (11.5px, truncated), the age
  (10.5px tabular `text-muted`). No author mark: the rail is narrow and the commits are mostly the agent's; the tooltip
  carries sha · subject · author · age.
- Lanes come from the existing `assignLanes` (`gitgraph.ts`) and `graphGeometry` (`gitgraphgeom.ts`), drawn by
  `GraphGutter`, `graphlane-*` tokens; a merge is a hollow node, an edge to a parent outside the range is dashed.
- The last row is the range's root, not a commit of it: a grey dashed hollow node (`graphlane-fold`), its short sha, and
  "branched off here" with a `main` ref chip (Branch) or "session started here" (Session).
- Past 20: the line runs on dashed under the last row and ends in "N more in Diff ↗", which opens the Diff surface
  (as row click does, below) (`ManyCommits`).
- Fold: open by default at 5 commits or fewer, folded above; a click keeps the choice per agent for the session (a
  jotai atom keyed by agent id, not localStorage).
- First read: three skeleton rows at row height. A failed read: an inline panel "Couldn't read the commits", the command
  and git's reason, Retry (`States`). The files list under it is unaffected either way.
- Click a row: the Diff surface opens on the branch compare (`openBranchDiff`, merge-base form) with that commit
  selected (`selectCompareRow(cwd, hash)`). In Session range the compare is still `base…HEAD` when the agent is on a
  branch; on the default branch, where there is no compare, the row opens the Diff surface's Log on that commit
  (`showInLog(cwd, hash)`, exported from `commitstore.ts`, where it is module-private today).

### Files header

- The files list gets a header of its own ("Files", the count) so it reads apart from Commits. The list, its rows,
  summary and View diff are unchanged.

### Commit mode

- **Commit…** in the files footer, beside View diff, in both ranges, shown while the uncommitted list has a file. It
  opens commit mode in place (`CommitMode`).
- In commit mode the list is the **uncommitted** one: working tree against HEAD, from `commitstore.ts`
  (`loadCommitList` / `startCommitPoll` while the mode is open), not the range's list: the Session range is measured
  from the session start, so it holds files already committed this session. The header reads "Uncommitted N" and its
  icon becomes the tick-all box (`groupTickState`: all, some, none); each row gets a `TickBox` before its status letter.
  Untracked (`?`) files are listed, unticked by default; a `committable() === false` row has a disabled box with its
  note in the tooltip — the rules are `commitselection.ts`'s.
- The Session / Branch switch rests (both options dimmed, the tooltip "Commit or cancel first") while the mode is open.
- The box pins to the tab's foot, drawn as the Commit tab's (`border-t`, `bg-surface`, 10px padding): the message
  textarea (3 lines growing to the same max), a row with "N agents running here" (`workingAgents`, muted, as the Commit
  tab says it — no block, no amber) and "More in Diff ↗" (amend, folders, unversioned files), then Cancel and
  **Commit N files · Ctrl+Enter** (`commitLabel`; primary only while `canCommit`). A failure shows the Commit tab's
  failure panel under the button.
- Ticks, draft, amend and run state are `commitstore`'s atoms keyed by `cwd`: the same as the Diff surface's Commit tab,
  so a message started in one is there in the other. If amend was turned on in Diff the button says "Amend with N
  files", honestly; the rail does not offer the toggle.
- Cancel leaves the mode and keeps ticks and draft. Ctrl+Enter in the box commits. No Space or ↑/↓ handling in the rail.
- Commit runs `commitNow(cwd)` unchanged (it already reloads the list, the Diff's changes and history, and toasts).
  On success the rail leaves the mode and reads its own state again (`loadRailForAgent`) and the commits, so the new
  commit sits at the top of Commits and the files list shortens.

## How it is built

- `railcommits.ts` (pure, `railcommits.test.ts`): the where line's parts from rail state; the commit range for a range
  choice (`{ from, label } | null`); rows and the root row from `HistoryCommit[]` with the 20 cap and the more count;
  the fold default.
- `railcommitsstore.ts`: per-agent commits atom (`{ key, commits, more, status, failure }`, keyed by `cwd` + range), a
  load guarded like `railstore`'s `current`, the fold atom, the commit-mode atom (per agent). Reads when the Changes tab
  shows, when rail state lands for the agent, after a rail commit, and on Retry: no new poll.
- `agentdetailsrail.tsx`: the where line, the Commits section and the files header in `filesContent`; commit mode swaps
  the list and adds the box. `CommitFailure` and the textarea sizing move out of `committab.tsx` to be shared
  (`commitbox.tsx` or exported), not copied.
- `TickBox` is reused as is.

## Not in this

- An "Uncommitted · N files" row at the top of the graph, as the Diff surface's Log has: the files list already says it.
- Amend, folder mode and unversioned grouping in the rail: they stay in the Diff surface's Commit tab.
- The Changes tab showing 4876 files all `D` in one agent's rail (screenshot of 2026-10-21): a separate bug to debug,
  likely a wrong `cwd` or base; the where line makes it visible but does not fix it.

## Checks

- vitest: `railcommits.test.ts` (range per choice and per missing ref, cap and more count, root row, fold default, where
  line in a linked worktree and the main checkout).
- CDP scenario `rail-changes-commits` in `scripts/cdp/scenarios.mjs`: a temp repo on a branch with three commits, one
  merge, and uncommitted edits; shows the where line, the Commits lanes, the fold, commit mode with a tick changed, and
  the list after a commit. Until it runs in the dev app, a hand-check line in `docs/open-issues.md`.
- `CHANGELOG.md` Unreleased: one Added line for the commits and commit mode on the rail.

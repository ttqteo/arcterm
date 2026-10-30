# Project Overview redesign

The Agent surface's project Overview (`project` centre mode, `frontend/app/view/agents/projectoverview.tsx`) leaves
too much of the page empty. This redesign makes it dense by changing the layout. No card gains or loses content.

Mockup: `.superpowers/design/overview-redesign/project/B-activity-top.dc.html` (gitignored).

## Today

`projectoverview.tsx` renders, inside a centred `max-w-[1120px]` column:

1. the header: project name, branch pill, uncommitted count with +/−, path; **New agent** (opens the New dialog
   preset to the project, `openLauncher`) and **Terminal** (`quickTerminal`, opens a shell at once);
2. `ActivityCard` (`projectactivitycard.tsx`), a look-only calendar of tokens per day over 53 weeks, with
   totals, a last-7-days line and a tooltip for each day;
3. `GraphCard` (`projectgraphcard.tsx`, the Branches card): the newest 20 commits of every branch over the
   commit graph's lanes, with the uncommitted row on top. When this spec was written it was uncommitted work in the main checkout
   (`projectgraph.ts`, `projectgraph.test.ts`, `projectgraphcard.tsx`, and the edits to `projectoverview.tsx`),
   alongside History's lazy paging (`projecthistory.tsx`, `projectoverviewmodel.ts`); run 229ef9cd shipped it;
4. at a container width of 1000px and up, two columns: `NowColumn` (`projectnow.tsx`) fixed at 420px and
   `HistoryColumn` (`projecthistory.tsx`, 7 days of sessions, shown 15 top-level rows at a time). Below
   1000px they stack.

The empty space comes from Now, a short list in a fixed 420px column that ends long before History beside it
does, and from the 1120px cap, which leaves wide margins on a wide centre.

## Design

**Intent.** Cut the empty space so the Overview is dense. All cards stay on screen at once, with no tabs.

**Layout.**

- Drop the `max-w-[1120px]` cap: the page fills the centre pane, keeping its `px-8 py-6` padding.
- The header and the Activity card stay on top at full width, unchanged. The calendar keeps its year view, and no
  activity strip goes in the header (the card already carries the totals).
- Under Activity, the body is two columns that share the width at about **2:3** (left ≈ 2/5, right ≈ 3/5,
  e.g. `flex-[2]` / `flex-[3]` with `min-w-0`), replacing Now's fixed 420px:
  - **left:** `NowColumn` at its content height, then the Branches `GraphCard` under it (moved out of its
    full-width slot above the columns);
  - **right:** `HistoryColumn`.
- Each column fills from the top (`items-start`), with the same 24px gap between the columns as today and the
  same gap between Now and Branches as between the page's cards (22px).
- Below the 1000px container breakpoint (`@min-[1000px]`), the columns stack as today, in the order Now,
  Branches, History.
- When History is missing (no project path), the left column takes the full width instead of leaving an empty
  3/5 slot. *Agent's call.*

**How it ships.** An Arc engine run builds it. The run's base (`602c7bc8a`) has no `GraphCard`, so the run carries
in the main checkout's uncommitted Branches card and History lazy paging first: a snapshot of that work,
`.superpowers\overview-redesign\carry.patch` (taken 2026-10-30 16:25; `git apply` from the repo
root), is the run's first task, unchanged, and the layout builds on it. All three ship together: CHANGELOG gets an
`Added` line for the Branches card and a `Changed` line for the denser layout and History loading as you scroll.
Before the run lands, the main checkout's uncommitted copies of those files (and this spec, untracked there) must be
discarded, or the landing merge stops on them.

**Left to the builder (confirmed).**

- At about 2/5 of the width the Branches rows are narrower. If the subject truncates too soon, a row may drop the
  author-initials mark (for example, hide it below a container width) before shortening the subject further.
  Hash, ref chips (up to 3, then `+N`), subject and age stay.
- The Activity card, History's lazy paging (15 rows at a time, `useLazyLimit` in `projecthistory.tsx`) and the
  header buttons stay as they are.

## Out of scope

- Trimming the Activity calendar to its recorded weeks, an activity strip in the header, and tabs: all considered
  in the brainstorm and rejected.
- Any change to New agent / Terminal behaviour.

## Files

- Carried in from `carry.patch`: `projectgraph.ts`, `projectgraph.test.ts`, `projectgraphcard.tsx` (new),
  `projecthistory.tsx`, `projectoverviewmodel.ts`, `projectoverviewmodel.test.ts`, and the `GraphCard` slot in
  `projectoverview.tsx`, all under `frontend/app/view/agents/`.
- `frontend/app/view/agents/projectoverview.tsx`: the layout change (cap, column widths, GraphCard placement) and
  its header comment.
- `frontend/app/view/agents/projectgraphcard.tsx`: only if the narrower rows need the author mark dropped.
- `scripts/cdp/scenarios.mjs`: the `project-overview-history` asserts.
- `CHANGELOG.md`: the two lines under How it ships.

## Verification

- No new pure logic, so no new unit tests. Existing `projectgraph.test.ts` and `projectoverviewmodel.test.ts`
  keep passing.
- `npx prettier --check` and `npx eslint` on the touched files; `task check:ts`.
- Extend the `project-overview-history` CDP scenario (`scripts/cdp/scenarios.mjs`). *Agent's call.* Step 1 also
  asserts that Branches (`[data-graph-card]`) sits under Now in the left column, that the left column is narrower than
  History (about 2:3), and that the page is wider than 1120px when the centre is. Step 9 (760px) asserts the stacked
  order Now, Branches, History. The fixture's project A already has a git repo with a commit (`ovSeedRepo`), so
  `GraphCard` renders there. The width check measures the Activity card against the page's inner width (no cap) and
  requires more than 1120px only when the centre leaves room for it.
- The carried work gets its own steps in the same scenario: A's Branches card lists the uncommitted row and the seed
  commit's row (its subject and short hash), with no loading or error state; and with more than 15 top-level sessions
  History shows 15 rows and its foot, then more rows after scrolling the page to the bottom, until the foot is gone
  and Older ends the list.
- Live check: the run's Final runs that scenario (`node scripts/cdp/final-verify.mjs project-overview-history`).

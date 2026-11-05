# The lobby Christmas tree

A follow-up to the Christmas theme (`docs/superpowers/specs/2026-11-05-christmas-theme-design.md`). A big Christmas
tree stands in the Office hall and grows through the season as your runs' tasks finish: each finished task hangs an
ornament on it, and the tree gains branches, then lights, then its star. It is a light reward: no score and no way to
lose. The tree shows how much work got done.

Brainstorm: `.superpowers/brainstorm/christmas-tree-game/brainstorm.json`. Board:
`.superpowers/design/christmas-tree-game/project/A-closeup.dc.html`.

## Background

- The Christmas theme gates its decor with `hasChristmasDecor` (`frontend/app/view/agents/christmas.ts`), read in
  views through `useChristmasDecor` (`christmasstore.ts`). Its colours are the `--color-xmas-*` tokens in
  `frontend/tailwindsetup.css` (crimson, bulb, pine, snow) plus the theme's gold accent.
- The Office (`cockpitoffice.tsx`) is pixel art seen from above. Its hall holds the lounge, the notice board and the
  lift (`officeplanmodel.ts`; the lounge is `LOUNGE_H` = 230px tall). The boss walks with the arrows; Space or Enter is
  A, Esc is B, and the layers over the office are walk, dialog, card and carry (`officecontrols.ts`). The Office has
  chip sounds (`officescores.ts`, `officesoundcues.ts`).
- The engine writes one run event of kind `task-done` (`RunEventKindTaskDone`, `pkg/waveobj/runevent.go`) with its
  `Ts` when a task finishes. A run's DAG is a `TaskGroup` (`pkg/waveobj/wtype.go`, oref `dag:<id>`).
- The app's small notifications are `pushToast` (`frontend/app/cockpit/notificationstore.ts`).
- The user runs about 5 orchestrator runs a day (from 1 to 13; 32 runs from 1 to 5 November), so a season can bring
  a few hundred to over a thousand finished tasks.

## Decisions

### Where it stands

One big shared tree stands in the Office hall, beside the lounge. It grows with the work of every project. It shows
only while the Christmas decor shows (`useChristmasDecor`).

### What earns an ornament

Every task of an orchestrator run that finishes (`done`) earns one ornament. An agent finishing a turn and a run
landing do not count on their own.

### The season

The season runs from 1 November to 1 January of the next year. Every task finished in that window counts, including
while the Christmas theme is off and the tasks finished from 1 November until this ships. So on first open, the tree
has already grown.

The tree only ever grows. wavesrv keeps its own season ledger of finished tasks (a new table, with a SQL migration),
written as each task finishes and backfilled once from the `task-done` run events since 1 November. Run events are not
a lasting record (each run keeps only its newest 1,000, `pkg/wstore/wstore_runevent.go`, and removing a project deletes
its runs' events, `pkg/wstore/wstore_channel.go`), so neither event pruning nor removing a project takes an ornament off
the tree, and a saved position always points at an ornament that exists. *(Builder question 1, the user's answer.)*

### How it grows

The season starts with a sapling. The tree grows through 7 milestones: 5 tiers of branches, one after another, then
the string of lights, then the star on top. The thresholds rise: the first milestones need few tasks, so the tree
visibly grows in the first week. The later ones need more, so at a normal pace (about 5 runs a day) the star goes up
in the last week of December.

### Ornaments

When a task finishes, its ornament hangs itself in a free spot on the tree. Ornaments come in tiers:

- a small ornament (red bulb) is 1 task;
- 10 small ornaments merge into one big gold bauble (10 tasks);
- 10 big baubles merge into one rare ornament (100 tasks);
- past that, 10 rare ornaments merge into a higher tier (1,000 tasks).

Ornaments merge only when the tree has no free spot left, never earlier: until then every finished task hangs as its
own small ornament (board A, at 214 tasks: 14 small, 10 big, 1 rare). When a new ornament finds no free spot, the 10
oldest ornaments of the lowest tier merge into one of the next tier, which takes the spot of the oldest of the ten;
the other nine spots are freed, and the new ornament takes one of them. If the new tier is now 10 of its own and there
is still no room, the same rule goes one tier up. *(Agent's call, builder question 1.)* Each growth stage has a fixed
number of spots, set as data in the pure model: the sapling has a few, and each tier of branches adds more, up to about
30 on the full tree.

Merging frees spots for new ornaments, so the tree never fills up. About 30 spots already hold 3,000 tasks, several
times a season, and each tier keeps a mark of every task.

### Moving ornaments

The boss walks to the tree and presses A to open a close-up card of the tree, as board A draws it:

- the tree, enlarged, on the left;
- on the right, the tasks finished this season, the milestone reached ("4 / 7") with the tasks left until the next
  one and a progress bar, the ornament being lifted (its kind, how many tasks it holds and the date range they
  finished in, "merged from 10 tasks, 8/11 to 12/11"; no list of the tasks themselves *(Agent's call, builder
  question 3.)*), and a key to the three tiers with how many of each hang on the tree.

The arrows pick an ornament, A lifts it and puts it down in another spot, and B closes the card and goes back to the
hall. The footer of the card lists these keys. The spots the user arranged stay where they are when the Office is
opened again; a new ornament takes a free spot.

### A milestone reached

When the tree reaches a milestone (a new tier of branches, the lights, the star), a small notification shows at once,
for example "The tree grew its 5th tier". Clicking it opens the Office at the tree.

Milestones crossed while no notification could show (before this ships, while the app was closed or the theme was
off) are not announced one by one: the next time the decor shows, one notification names only the highest milestone
not yet announced, and every milestone up to it counts as announced. *(Agent's call, builder question 4.)*

### The small tree on the Agent rail

The small pixel pine in the bottom-right corner of the Agent details rail's Overview tab
(`frontend/app/view/agents/christmasrailtree.ts`, the pure grid, and `christmasrailtreeview.tsx`, mounted through
`CollapsibleRail`'s footer) shows the same stage as the lobby tree: the sapling, the number of branch tiers, the lights
and the star, from the same season count wavesrv answers. Today it always draws the full tree. *(Answer 13.)*

### 1 January

All day on 1 January, pixel fireworks go off over the hall and a sign under the tree shows the season's total of
finished tasks. From 2 January the tree is put away, until it is planted again on 1 November.

## Left to the builder

- Fill the season ledger as tasks finish and backfill it once from the `task-done` run events (once per task, a
  retried task included), and answer the frontend through one wshrpc command; the frontend does not count. Run
  `task generate` after adding it.
- Keep the positions of the ornaments the user moved, per season, so the tree opens as it was left; a new ornament
  takes a free spot.
- Pick the 7 rising thresholds so that, at about 5 runs a day, the star goes up in the last week of December. Write
  them, and the 10-to-1 merge rule, as pure functions with unit tests.
- Draw the tree, its tiers, the lights, the star, the ornaments and the 1 January fireworks in pixel art matching the
  Office, in the `--color-xmas-*` tokens and the theme's accent, never raw hex.
- Send the milestone notification only while the Christmas decor shows, once per milestone per season.
- Add a CDP scenario that captures, from a fixture, the hall with the tree, the close-up card with an ornament lifted,
  and the 1 January scene.
- Add one `CHANGELOG.md` line.

## The builder's decisions

Made by the planning lead of the autonomous run that builds this (2026-11-05), each with why.

### The ledger and the wire

- **Table.** `db_xmastask (runid TEXT, taskid TEXT, ts INTEGER, PRIMARY KEY (runid, taskid))`, migration
  `000026_xmastask`. `runid` is the DAG's run id (the `runid` column of the `task-done` run event row, `g.RunID` in
  `pkg/orchestrate/engine.go`), `taskid` the event's `taskid`. The key is what makes a retried task count once.
- **Writer.** A new package `pkg/xmastree` owns the table: `RecordTaskDone(ctx, runID, taskID, ts)` inserts with
  `INSERT OR IGNORE` and publishes `xmastree:changed`. The engine calls it beside the `task-done` run event it already
  appends (`engine.go`, the `afterCommit` that appends `RunEventKindTaskDone`). A failed write is logged, never fails the
  run, like the run event beside it.
- **Backfill.** `INSERT OR IGNORE ... SELECT` from `db_runevent` where `kind = 'task-done'` inside the current season's
  window, run once per wavesrv process (a `sync.Once`) before the first read. It is idempotent, so "once per task"
  holds across restarts without a flag, and a task the live writer already recorded is not counted twice.
- **Season window, in Go only.** In server-local time: phase `season` from 1 November to 31 December (season = that
  year), `newyear` all of 1 January (season = the year before), `off` otherwise. A task counts when its `ts` is in
  [1 Nov 00:00, 2 Jan 00:00) of its season. The frontend never computes the season's dates: one source.
- **Wire.** `XmasTreeCommand(ctx) (*XmasTreeData, error)` answers
  `XmasTreeData{ Season int "season"; Phase string "phase"; Done []int64 "done" }`, `Done` being each counted task's
  finish time in ms, oldest first (ties by runid, taskid). The event `xmastree:changed` carries the same data. In
  `off`, `Done` is empty. A few thousand int64s at most: no paging.

### Growth

- **Thresholds** (tasks to reach milestone 1..7: tiers 1–5, lights, star): **5, 15, 50, 150, 250, 600, 1500**. Measured
  from the user's store: 173 tasks finished in the 32 runs of 1–5 November, 5.4 a run, so about 27 a day at 5 runs a
  day; 1,500 then falls on about 26 December. They match board A: at 214 tasks, milestone 4 / 7 with 36 tasks to the
  fifth tier.
- **Spots** by branch stage (sapling, 1 … 5 tiers): **4, 10, 19, 22, 25, 30**; the lights and the star add none. These are
  the smallest counts for which a full tree always has a tier of 10 to merge below about 4,000 tasks (simulated), and
  at 214 tasks they give exactly board A's tree: 14 small, 10 big, 1 rare.
- **Merge.** When a new ornament finds no free spot, the 10 oldest ornaments of the lowest tier that has at least 10
  merge (lowest tier with 10, not "the lowest tier": a full tree can hold fewer than 10 small ones). The merged
  ornament takes the oldest one's spot; the new ornament takes the lowest-numbered free spot. A new ornament with a free
  spot also takes the lowest-numbered one. Tiers: 0 small (1 task), 1 big (10), 2 rare (100), 3 heirloom (1,000);
  heirlooms never merge. A task that finds no spot and no tier of 10 still counts in the total but hangs nothing
  (unreachable below about 4,000 tasks; a test pins it).
- **Names and looks.** Small ornament: a red bulb (`--color-xmas-bulb`). Big bauble: gold (`--color-accent`). Rare
  ornament: a cream diamond (`--color-xmas-snow`). Heirloom: a crimson star edged in gold (`--color-xmas-crimson`,
  `--color-accent`). The card's key always lists the first three and adds the heirloom once one hangs.

### Positions and announcements (per viewer, in localStorage)

- **Arrangement.** Kept in localStorage under `xmas.tree.<season>` as `{ count, spots }`: the ledger count it reflects
  and each spot's ornament (tier, first and last task index) or nothing. On read it is advanced from its count to the
  ledger's with the pure step, so a new ornament takes a free spot and moved ones stay put. Missing, unreadable, or
  ahead of the ledger (a fixture, another store): rebuilt from nothing. Why not wavesrv: it is one person's arrangement on
  one desktop, the ledger stays the one source of the count, and losing it only undoes manual moves.
- **Announced milestone.** localStorage `xmas.tree.announced.<season>` holds the highest milestone announced. One pure
  rule covers both cases of the spec: while the decor shows and the phase is `season`, if the reached milestone is above
  the announced one, announce the reached one and store it. Crossed live, that is the one milestone just reached; after
  a gap, only the highest.
- **Toast.** `pushToast`, level info: "The tree grew its 1st tier" … "its 5th tier", "The tree's lights are on", "The
  star is on top of the tree"; message "N tasks finished this season". Clicking it opens the Cockpit's Office on the
  ground floor and walks the boss to the tree, as the notice board's own open does.

### The Office

- **Place.** Ground floor only (one shared tree), against the hall's right wall level with the notice board, its spot
  below it. The hall is 234 px wide and the board takes its left 8–104 px, so the tree is drawn small enough (about 3 px
  a grid cell) to leave a lane between the two at least as wide as the boss (`2 × BOSS_HALF_W`), and it covers no
  right-hand room's door. The boss's cursor key is `TREE_KEY = "xmas-tree"`, after the notice board in the `j` / `k` order. Nothing of
  it exists while the decor is off or the phase is `off`.
- **One pixel grid.** `xmastreegrid.ts` draws the tree for a stage (needles in two shades, trunk, lights, star) and
  places each spot on a needle cell; the hall tree, the close-up card and the Agent rail's pine all draw that grid at
  their own cell size. The rail's old fixed grid (`christmasrailtree.ts` and its test) is removed.
- **The rail's pine out of season.** The Christmas theme can be on in any month. In phase `off` the rail's pine draws
  the full tree (five tiers, lights, star) with no ornaments, the decor it was before; in `season` and `newyear` it
  draws the season's stage and ornaments. Before wavesrv's first answer it draws nothing.
- **The card's cursor** is a dashed ring on the spot with a "▶ put here" label beside it while an ornament is lifted,
  as board A draws it.
- **Close-up card keys.** A new office layer `tree`: the arrows move the cursor to the nearest spot in that direction
  (ornaments only while nothing is lifted; every spot while one is), A lifts the ornament under the cursor or puts the
  lifted one down (on a free spot it moves there, on an ornament the two swap), B closes the card and returns to walking,
  putting a lifted ornament back where it was. The card's text is English, like the rest of the app (board A's is
  Vietnamese).
- **1 January.** Pixel fireworks over the hall (bulb, gold, snow and pine cells), animated while the Christmas motion
  runs and drawn as one still frame under reduced motion; a sign under the tree: "This season: N tasks".

### Verification

- A DEV-only hook `window.__cockpitOfficeTree(data | null)` puts a fixture `XmasTreeData` in place of wavesrv's answer.
  The CDP scenario `office-xmas-tree` (`scripts/cdp/xmastreescenarios.mjs`) captures the hall with the tree, the card
  with an ornament lifted, the milestone toast, the Agent rail's pine at the same stage, and the 1 January scene.

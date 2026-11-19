# Run timeline rail: fold repeated rows, shorter times, readable pause titles

The lifecycle rail of an orchestrator run (`frontend/app/view/orchestrate/timelinerail.tsx`) on a long run that has
ended (ReleaseHub, 227 events, 2026-11-14) shows three problems:

1. **Repeated rows.** Each task's cleanup is its own group (`groupKey` is `taskId:phase`), so the run's end shows 14
   "Cleanup complete" rows, t-14 down to t-1, filling the first screen and pushing DAG blocked and Final
   verification failed below the fold.
2. **Truncated titles.** `groupTime` (`timelinerail.tsx:494`) writes the date on both ends of a range
   ("Nov 14 01:19–Nov 14 01:20"), so a row with a task chip has its title cut to "Veri…" / "Revi…".
3. **Raw kind names.** `run-paused` and `run-resumed` (`pkg/waveobj/runevent.go:186`) have no entry in `KIND_TITLE`
   (`frontend/app/view/agents/runtimeline.ts`), so `eventKindTitle` falls back to the kind itself.

A "new since you looked" marker was weighed and dropped: the rail is newest-first, so new events already sit on top.

Canvas: `.superpowers/design/run-timeline-new/project/` (`Before.dc.html` today, `B-consecutive.dc.html` the chosen
design).

## 1. Fold repeated rows that sit side by side

After `filterGroups`, rows that sit next to each other in the rail fold into one **fold row** when every one of them:

- is a task group (`taskId` set) that shows nothing but its title: at most one step chip and no snippet
  (`foldable`), so a fold hides only each task's time, which opening it shows;
- has the same title as the rest of the stretch, and a task not already in it;
- is not an attention group (a warning never hides inside a fold);
- has no gap row between it and its neighbour (a "N quiet" row breaks the stretch).

A stretch of two or more such groups becomes a fold; a lone one stays a plain row. Only neighbours fold: an
interleaved event (Land held, Evidence sealed) ends the stretch, so the rail keeps exact time order. The ReleaseHub
run's end becomes `×9`, Land held, `×2`, Evidence sealed, `×3`.

The model is pure and lives in `timelinegroups.ts`: `railRows` gains a third row kind,
`{ kind: "fold"; key; groups; first; last }`, built from the filtered groups. The Task filter shows one task's groups, so
it never folds; the Attention filter shows no foldable groups.

**Fold row, closed:** the shared title, a count chip `×N`, the task range chip, the time range, a chevron.

- Task range, by the tasks' numbers:
  - consecutive numbers: `t-6 → t-14` (an arrow, since the ids carry a hyphen already);
  - not consecutive, three tasks or fewer: `t-3, t-7, t-12`;
  - not consecutive, more than three: `9 tasks`.
  A task id that is not `t-<number>` counts as not consecutive.
- Time range: the fold's earliest `first` to its latest `last`, in the shortened form of section 2.

**Fold row, open:** one sub-row per group, newest first, indented under the fold: the task chip, then the time.
Clicking a sub-row selects its task, as that group's own row would; hovering it lights the task in the graph. Open
state shares the rail's one open row and is keyed by the fold's oldest group `key`, so a cleanup arriving live does not
close it.

## 2. Shorter time ranges

`groupTime`, and the fold's range, write a range as:

| Range | Without date | With date (`needsDate`) |
|---|---|---|
| one minute | `01:20` | `Nov 14 01:20` |
| same hour | `01:19–20` | `Nov 14 01:19–20` |
| same day | `01:55–02:03` | `Nov 14 01:55–02:03` |
| two days | `23:58–00:04` | `Nov 13 23:58–Nov 14 00:04` |

A time range keeps the en dash `–`; the arrow is for task ranges only. Single times are unchanged.

## 3. Titles for the run's pause and resume

- `KIND_TITLE` gains `"run-paused": "Run paused"` and `"run-resumed": "Run resumed"`.
- `glyphOf` gains a `pause` glyph (two bars) for `run-paused`; `run-resumed` keeps `play`.
- `snippetOf` gives both a snippet from the detail's `by`: `auto`, `manual` or `at startup` (for `boot`), and for
  `run-paused` the RAM the tree held when it paused (`heldbytes`), when present: `manual · held 3.2 GB`.

## Testing

- `timelinegroups.test.ts`: fold building (a stretch of 2+, an interleaved event splitting it, a gap row splitting it,
  attention groups never folding, mixed kinds never folding); the three task-range forms and a non-numeric id; every
  row of the time table; the pause snippets.
- CDP: the `kael1113-timeline` scenario (`scripts/cdp/scenarios-kael1113-timeline.mjs`) gains a step that seeds a run
  ending in several task cleanups and screenshots the rail with one fold closed and open.
- `CHANGELOG.md` gets a `Changed` line.

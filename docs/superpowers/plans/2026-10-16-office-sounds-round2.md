# Office sounds, fix round

Spec: `docs/superpowers/specs/2026-10-16-office-sounds-design.md` (Cues: "silent for things that only came into
view").

### Task 1: A project filter change does not chime the Needs you board

**Depends on:** none

The defect: the Needs you rows (`useNeedsYou`, `frontend/app/view/agents/needsyou.ts:53`) are filtered by
`model.projectFilterAtom`. In the Office, switching the project filter from one project back to All makes the other
projects' rows appear as new board keys, and `diffCues` (`frontend/app/view/agents/officesoundcues.ts:80`) plays
needsYou or setback for them, though nothing new needs the person. Rows that only came into view through a filter
change must be a baseline, like the list's first load.

Files: `frontend/app/view/agents/officesoundcues.ts`, `officesoundcues.test.ts`, `officesound.tsx`,
`cockpitoffice.tsx`.

- In `officesoundcues.ts`, add and export `withBoardBaseline(s: CueSnapshot | null): CueSnapshot | null`, which returns
  `s` with `board: null` (null stays null). `diffCues` already treats a null `prev.board` as a baseline.
- In `officesound.tsx`, `OfficeSound` takes a `scope: string` prop (the project filter). Keep the last scope in a ref;
  in the snapshot effect, when `scope` differs from it, diff against `withBoardBaseline(prev.current)` and update the
  ref. Add `scope` to that effect's deps. Agents and runs keep diffing as now (they already stay silent when they only
  came into view).
- In `cockpitoffice.tsx`, read `useAtomValue(props.model.projectFilterAtom)` and pass it as `scope` to the one
  `<OfficeSound>` (line ~1903).
- Tests in `officesoundcues.test.ts`: `withBoardBaseline(null)` is null; with a snapshot whose board has key `a`, a
  next snapshot whose board adds a needsYou key `b` gives `["needsYou"]` from `diffCues(prev, next)` and `[]` from
  `diffCues(withBoardBaseline(prev), next)`; agents' and tasks' cues are unaffected by the rebase (a task going to
  done still gives `taskDone` against the rebased prev).

Acceptance: `npx vitest run frontend/app/view/agents/officesoundcues.test.ts` passes with the new tests; the
`office-sound` scenario (Final) still passes, step 1 included.

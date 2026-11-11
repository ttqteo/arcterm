# Kael sync (2026-11-12): five small fixes from the fork

**Verify:** `npx vitest run frontend/app/view/agents frontend/app/view/orchestrate`
**Check:** `task check:ts`

## Context for every task

Port from the kaeltran16 fork (`kael` remote, `kael/main` at `d0be5ee41`). Read a commit with `git show <hash>`, a
file at the fork's tip with `git show kael/main:<path>`. Our tree has diverged: port the behaviour into our files;
`git cherry-pick -n` only where it applies cleanly.

**Our code wins (the owner's hard rule).** The port is additive. Never rewrite, rename, remove or restyle an existing
behaviour, binding or test of ours to match the fork; fit the fork's fix around ours, and when it cannot fit without
changing ours, skip that part and name it under the commit's "Differs from plan". A test of ours is never edited to
make a port pass; the fork's tests are added beside ours (adapted). Each task touches only the files on its Files
line. `CHANGELOG.md` and `docs/hand-checks.md` are written once, by Task 6. The fork's CDP scenario hunks
(`scripts/cdp/scenarios-agent-tree.mjs`, `scripts/cdp/scenarios-cockpit-asks.mjs`) are not ported: ours has no such
files; Task 6 writes hand-check lines instead.

### Task 1: A quoted startup command keeps its argument whole
**Depends on:** none

**Files:** `frontend/app/view/agents/launch.ts`, `frontend/app/view/agents/launch.test.ts`

Commit `21a784604`. Ours splits a startup command on `/\s+/` at `launch.ts` (three sites, near lines 64, 80, 188), so
`--model x --append-system-prompt "a b"` breaks the quoted argument in two. Add the fork's pure quote-aware splitter
and use it at those sites, keeping each site's existing behaviour for unquoted input.

**Acceptance:** `npx vitest run frontend/app/view/agents/launch.test.ts` passes, with new cases for a double-quoted
and a single-quoted argument containing spaces, and every existing case unchanged.

### Task 2: An opencode transcript survives a JSON null line or tool input
**Depends on:** none

**Files:** `frontend/app/view/agents/opencodetranscriptprojection.ts`, `frontend/app/view/agents/opencodetranscriptprojection.test.ts`

Commit `e7d66ae04`. Ours reads `rec.type` with no null guard (around `opencodetranscriptprojection.ts:70-78`), so a
line that parses to `null`, or a tool part whose input is `null`, throws and stops the projection. Add the two
guards.

**Acceptance:** `npx vitest run frontend/app/view/agents/opencodetranscriptprojection.test.ts` passes, with a new
case where a `null` line and a `null` tool input sit between valid records and the records after them still project.

### Task 3: Older Claude model ids read their version before their family
**Depends on:** none

**Files:** `frontend/app/view/agents/modellabel.ts`, `frontend/app/view/agents/modellabel.test.ts`

Commit `9c8660207`. Ours renders `claude-3-7-sonnet-20250219` as "Sonnet 20250219". Read an older id
(`claude-<major>-<minor>-<family>-<date>`) as family and version ("Sonnet 3.7"), and leave every id ours already
labels right unchanged.

**Acceptance:** `npx vitest run frontend/app/view/agents/modellabel.test.ts` passes, with new cases for
`claude-3-7-sonnet-20250219` and `claude-3-5-haiku-20241022`, and every existing case unchanged.

### Task 4: Leaving Jarvis closes the DAG modal
**Depends on:** none

**Files:** `frontend/app/view/orchestrate/dagmodal.tsx`, `frontend/app/view/orchestrate/dagmodalstate.ts`, `frontend/app/view/orchestrate/dagmodalstate.test.ts`

Commit `559f5eda4`. Our `DagModal` is hosted in `briefsurface.tsx`, which unmounts when the user leaves Jarvis while
the modal's open atom stays set, so the modal reappears on the next visit. Port the fork's dismiss on unmount in
`dagmodal.tsx` and its pure helper in `dagmodalstate.ts`. Do not edit `briefsurface.tsx`.

**Acceptance:** `npx vitest run frontend/app/view/orchestrate/dagmodalstate.test.ts` passes, with a new case showing
the dismiss clears the open state, and every existing case unchanged.

### Task 5: A digit or Enter walks a multi-question ask
**Depends on:** none

**Files:** `frontend/app/view/agents/askflow.ts`, `frontend/app/view/agents/askflow.test.ts`, `frontend/app/view/agents/answerbar.tsx`, `frontend/app/view/agents/usecockpitkeyboard.ts`

Commit `aa52e979b`. On the Cockpit, a digit or Enter on an agent asking several questions answers the first and
opens the Agent surface over a partial answer. Port the fork's pure `askflow.ts` (new) and its test, and wire it into
`answerbar.tsx` and `usecockpitkeyboard.ts` so the keys step through the questions and send once all are answered;
take the commit's pi-only dismiss part only if ours has the same dismiss path. A single-question ask behaves exactly
as it does now.

**Acceptance:** `npx vitest run frontend/app/view/agents/askflow.test.ts` passes, and every existing test under
`frontend/app/view/agents` that covers the cockpit keyboard or the answer bar passes unchanged.

### Task 6: CHANGELOG and hand checks
**Depends on:** Task 1 (its line says whether it ported), Task 2 (same), Task 3 (same), Task 4 (same), Task 5 (same)

**Files:** `CHANGELOG.md`, `docs/hand-checks.md`

Add one `Fixed` line per task under the top `Unreleased` section of `CHANGELOG.md` (open one above a dated top
section), each with "(from the kaeltran16 fork)" after its bold lead, written for the user. Skip a task that
skipped its port. Add `- [ ]` lines to `docs/hand-checks.md`, titled "(arcterm) …", for Task 1 (start an agent whose
startup command quotes an argument with spaces), Task 4 (open a DAG modal, switch surface, come back: it is closed)
and Task 5 (a multi-question ask on the Cockpit: digits and Enter walk it, then it sends).

**Acceptance:** `git diff` shows only those two files, with the lines above.

# Kael sync (2026-11-12): five small fixes from the fork

**Verify:** `npx vitest run frontend/app/view/agents frontend/app/view/orchestrate`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs dag-lifecycle kael-ask-keys`

## Context for every task

Port from the kaeltran16 fork (`kael` remote) **at `d0be5ee41`**. Read a commit with `git show <hash>`, a file at
that point with `git show d0be5ee41:<path>` (not `kael/main:<path>`: `kael/main` has moved past it to newer code).
Our tree has diverged: port the behaviour into our files; `git cherry-pick -n` only where it applies cleanly.

**Our code wins (the owner's hard rule).** The port is additive. Never rewrite, rename, remove or restyle an existing
behaviour, binding or test of ours to match the fork; fit the fork's fix around ours, and when it cannot fit without
changing ours, skip that part and name it under the commit's "Differs from plan". A test of ours is never edited to
make a port pass; the fork's tests are added beside ours (adapted). Each task touches only the files on its Files
line. `CHANGELOG.md` and `docs/hand-checks.md` are written once, by Task 6. The fork's CDP scenario files
(`scripts/cdp/scenarios-agent-tree.mjs`, `scripts/cdp/scenarios-cockpit-asks.mjs`) do not exist in ours: Tasks 4
and 5 each port the steps that prove them into our scenarios, and the Final runs them.

### Task 1: A quoted startup command keeps its argument whole
**Depends on:** none

**Files:** `frontend/app/view/agents/launch.ts`, `frontend/app/view/agents/launch.test.ts`

Commit `21a784604`. Ours splits a startup command on `/\s+/`, so `--model x --append-system-prompt "a b"` breaks the
quoted argument in two. Add the fork's pure quote-aware splitter and use it at the two sites the fork changed:
`composeStartupCommand` (near `launch.ts:64`) and `buildLaunchMeta` (near `launch.ts:188`), keeping each site's
behaviour for unquoted input. Leave `askStartupCommand` (near `launch.ts:80`) on `/\s+/`: it re-joins its tokens with
`' '` and feeds `buildLaunchMeta`, so a whitespace split round-trips a quoted argument, where the quote-aware splitter
would drop the quotes and the argument would re-split in two.

**Acceptance:** `npx vitest run frontend/app/view/agents/launch.test.ts` passes, with new cases for a double-quoted
and a single-quoted argument containing spaces, a case where a quoted argument passes through `askStartupCommand`
into `buildLaunchMeta` and stays one argument, and every existing case unchanged.

### Task 2: An opencode transcript survives a JSON null line or tool input
**Depends on:** none

**Files:** `frontend/app/view/agents/opencodetranscriptprojection.ts`, `frontend/app/view/agents/opencodetranscriptprojection.test.ts`

Commit `e7d66ae04`. Ours reads `rec.type` with no null guard (around `opencodetranscriptprojection.ts:70-78`), so a
line that parses to `null` throws and stops the projection; and `targetFor` reads `args[key]` from whatever the tool
input string parses to, so an input string that parses to a non-object (`"null"`, `"42"`) throws too. (A JSON `null`
input value does not throw in ours: a non-string input already becomes `''`.) Add the fork's two guards.

**Acceptance:** `npx vitest run frontend/app/view/agents/opencodetranscriptprojection.test.ts` passes, with a new
case where a `null` line and a tool part with `input: "null"` sit between valid records and the records after them
still project, and every existing case unchanged.

### Task 3: Older Claude model ids read their version before their family
**Depends on:** none

**Files:** `frontend/app/view/agents/modellabel.ts`, `frontend/app/view/agents/modellabel.test.ts`

Commit `9c8660207`. Ours renders `claude-3-7-sonnet-20250219` as "Sonnet 20250219". Read an older id
(`claude-<major>-<minor>-<family>-<date>`) as family and version ("Sonnet 3.7"), and leave every id ours already
labels right unchanged. Fix it inside our exported `versionAfter`, keeping its name, signature and export: the fork
renames it `versionOf` and unexports it, but `session-models/sessionviewmodel.ts:4` imports `versionAfter` (its
`modelLabel` reads a model as `prettyModel` does), and keeping it means that label gets the fix too. Do not port the
rename.

**Acceptance:** `npx vitest run frontend/app/view/agents/modellabel.test.ts frontend/app/view/agents/session-models`
passes, with new cases in `modellabel.test.ts` for `claude-3-7-sonnet-20250219` and `claude-3-5-haiku-20241022`, and
every existing case in both unchanged.

### Task 4: Leaving Jarvis closes the DAG modal
**Depends on:** none

**Files:** `frontend/app/view/orchestrate/dagmodal.tsx`, `frontend/app/view/orchestrate/dagmodalstate.ts`, `frontend/app/view/orchestrate/dagmodalstate.test.ts`, `scripts/cdp/scenarios.mjs`

Commit `559f5eda4`. Our `DagModal` is hosted in `briefsurface.tsx`, which unmounts when the user leaves Jarvis while
the modal's open atom stays set, so the modal reappears on the next visit. Port the fork's dismiss on unmount in
`dagmodal.tsx` and its pure helper in `dagmodalstate.ts`. Do not edit `briefsurface.tsx`.

Show it in the app: in the existing `dag-lifecycle` scenario (`scripts/cdp/scenarios.mjs` near line 13490), add one
step after a step that has the DAG modal open (`[data-dag-modal-kind]` present): switch to another surface, switch
back to Jarvis, and assert no `[data-dag-modal-kind]` is in the DOM. Keep every existing step and its order; if a
later step needs the modal open, reopen it the way the existing steps open it. Touch nothing else in `scenarios.mjs`.

**Acceptance:** `npx vitest run frontend/app/view/orchestrate/dagmodalstate.test.ts` passes, with a new case showing
the dismiss clears the open state, and every existing case unchanged; `node --check scripts/cdp/scenarios.mjs`
passes; `task verify:ui -- dag-lifecycle` passes against a dev app, or, when no dev app can run in the worker, the
report says so and the Final runs it.

### Task 5: A digit or Enter walks a multi-question ask
**Depends on:** Task 4 (both edit `scripts/cdp/scenarios.mjs`)

**Files:** `frontend/app/view/agents/askflow.ts`, `frontend/app/view/agents/askflow.test.ts`, `frontend/app/view/agents/usecockpitkeyboard.ts`, `scripts/cdp/scenarios-kael-ask-keys.mjs`, `scripts/cdp/scenarios.mjs`

Commit `aa52e979b` (its F6 part only). On the Cockpit, a digit or Enter on an agent asking several questions answers
the first and opens the Agent surface over a partial answer. Port the fork's pure `askflow.ts` (new) and its test,
and wire it into `usecockpitkeyboard.ts`, reading the answers fresh from `model.answerSelAtom` /
`model.answerTextAtom` as the fork does: a digit on a multi-question ask picks and moves to the next unanswered
question; Enter sends once every question is answered and otherwise moves to the first unanswered one. Ours reads
the key through `officeKeyName` (`key`), not `e.key`, so this is a hand port, not a cherry-pick.

Gate both new paths to asks with more than one question (`questions.length > 1`). A single-question ask behaves
exactly as now: a digit toggles as today, and Enter on an unanswered single question still opens focus (ours calls
`openFocus`, `docs/keyboard-shortcuts.md:224` "else open focus"), where the fork's `enterAsk` would make it a no-op.
Add a test for that gate (in `askflow.test.ts` if the gate lives in `askflow.ts`).

Skip the commit's F3 part (the AnswerBar dismiss x shown only for pi, `canDismissAsk`): ours has the same dismiss path
(`answerbar.tsx:368-375` "claude: closes the panel copy", `agentrow.tsx:561`, `channelsprimitives.tsx:55`), and
porting it would remove our dismiss x for Claude. Name it under "Differs from plan". `answerbar.tsx` is not touched.

Show it in the app: a new scenario `kael-ask-keys` in the new file `scripts/cdp/scenarios-kael-ask-keys.mjs` (default
export a function returning the scenario array, imported and spread into the list in `scenarios.mjs` like
`scenarios-kael-keys.mjs`; touch nothing else in `scenarios.mjs`). Port the F6 steps of the fork's `cockpit-ask-keys`
(`git show aa52e979b -- scripts/cdp/scenarios-cockpit-asks.mjs`) with a fixture roster holding one Claude agent
asking two single-select questions. Steps, each a real CDP key event on the Cockpit with the cursor on that agent: a
digit picks an option of question 1 and the ask moves to question 2; Enter with question 2 still unanswered keeps the
Cockpit (does not open the Agent surface) and shows question 2; a digit answers question 2; Enter sends (the answer
is recorded, never forwarded to a real agent). Ours has no `scenarios-shared.mjs`: inject the roster the way our
existing fixture-roster scenarios do (the cockpit fixtures in `scripts/cockpit-fixtures/`, or the roster pattern
`scenarios-kael-keys.mjs` uses), and restore it in teardown. Skip the fork's F3 (pi dismiss x) step.

**Acceptance:** `npx vitest run frontend/app/view/agents/askflow.test.ts` passes, and every existing test under
`frontend/app/view/agents` that covers the cockpit keyboard or the answer bar passes unchanged; `node --check` passes
on both scenario files; `task verify:ui -- kael-ask-keys` passes against a dev app, or, when no dev app can run in the
worker, the report says so and the Final runs it.

### Task 6: CHANGELOG and hand checks
**Depends on:** Task 1 (its line says whether it ported), Task 2 (same), Task 3 (same), Task 4 (same), Task 5 (same)

**Files:** `CHANGELOG.md`, `docs/hand-checks.md`

Add one `Fixed` line per task 1–5 under the top `Unreleased` section of `CHANGELOG.md` (open one above a dated top
section), each with "(from the kaeltran16 fork)" after its bold lead, written for the user. Skip a task that skipped
its port. Tasks 1, 2 and 3 are covered by unit tests and Tasks 4 and 5 by their scenarios, so add a
`- [ ]` line to `docs/hand-checks.md`, titled "(arcterm) …", only for a scenario step Task 4 or 5 reports it could
not write.

**Acceptance:** `git diff` shows only those two files, with the lines above.

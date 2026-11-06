# Kael sync (2026-11-06): prompt cards, plan-file reviewer, Code, Diff, Brainstorm, Brief

**Verify:** `node scripts/verify.mjs ./pkg/orchestrate/... ./pkg/jarvis/... ./pkg/jarvisstate/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs code-image-zoom code-blame-draft diff-file-keys brainstorm-board-pick palette-brainstorm-resume brief-act-blocked`

## Context for every task

Port from the kaeltran16 fork (`kael` remote, `kael/main` at `f15fdc695`; the last sync, 2026-11-03, was cut at
`16b726ffd`). Read a commit with `git show <hash>`, a file at the fork's tip with `git show kael/main:<path>`. Our tree
has diverged a lot: almost every fork commit since the last sync conflicts if cherry-picked, so port the behaviour into
our shape; `git cherry-pick -n` only where it applies cleanly. Keep the fork's tests (adapted) and its pure-model /
thin-view split. Differences that matter here:

- We have no Code review feature (the fork's `codereview.ts`, `codereviewstore.ts`, `codereviewbar.tsx`, Send review):
  skip every part of a commit that touches it.
- We have no New agent modal file (`newagentmodal.tsx`), no Sessions surface, and the fork's Brief layout
  (`briefwaiting.tsx`, `briefinitiatives.tsx`, `briefprimitives.tsx`, `briefqueueactions.ts`, `briefmutations.ts`)
  and Jarvis pet are not ours: port the behaviour onto our Brief (`briefsurface.tsx`, `briefrows.ts`,
  `briefrowviews.tsx`, `waitingstrip.tsx`) and skip the pet.
- **CDP scenarios.** The fork split its scenarios into `scripts/cdp/scenarios-<area>.mjs`; ours keeps most in
  `scripts/cdp/scenarios.mjs` and loads a few split ones: each is a default export taking one of scenarios.mjs's
  module-local kits (an object of the helpers it needs) and returning a scenario list, as
  `scenarios-monitor-tasks.mjs` does with `RT_KIT`. Task 1 creates the six scenario files of this run as stubs,
  registers them in `scenarios.mjs` and gives each the kit it needs; **only Task 1 edits `scripts/cdp/scenarios.mjs`**.
  A later task fills its own stub (replacing the stub's failing step) and runs it with `task verify:ui -- <name>`. A
  helper its kit lacks is duplicated in the scenario file, not added to `scenarios.mjs`.
- `claude/arc-view-mod/` is the source; `task sync:claudemod` copies it to `cmd/wsh/cmd/claude-view-mod/` (tracked).
  Edit `claude/`, then run the sync task to refresh the copy; never edit the copy by hand.

Rules: Go is the source of truth for wire types; change the Go and run `task generate`, never hand-edit
`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts` or `pkg/wshrpc/wshclient/wshclient.go`. Colors
only from `@theme` tokens, motion only from `frontend/app/element/motiontokens.ts`, UI follows `DESIGN.md`. A new
keybinding goes in `frontend/app/store/keybindings/bindings.ts` and `docs/keyboard-shortcuts.md`, and must not clash
with a binding active on the same surface (`store.test.ts` / `bindings.test.ts` fail on a clash). Each task touches
only the files on its Files line; where two tasks must edit one file they are chained by Depends. `CHANGELOG.md` and
`docs/hand-checks.md` are written once, by Task 10. Each task that builds a view, visual state or interaction fills
the scenario that shows it, so Final judges it from a screenshot; a hand-check line is only for what no scenario can
show.

### Task 1: Scenario stubs and their kits
**Depends on:** none

**Files:** `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-code-imagezoom.mjs`, `scripts/cdp/scenarios-code-blame-draft.mjs`, `scripts/cdp/scenarios-diff-file-keys.mjs`, `scripts/cdp/scenarios-brainstorm-board-pick.mjs`, `scripts/cdp/scenarios-palette-brainstorm-resume.mjs`, `scripts/cdp/scenarios-brief-act.mjs`

Create the six scenario files, each a default export `(kit) => [scenario]` in the shape of
`scenarios-monitor-tasks.mjs`, holding one scenario with its name (`code-image-zoom`, `code-blame-draft`,
`diff-file-keys`, `brainstorm-board-pick`, `palette-brainstorm-resume`, `brief-act-blocked`), its surface, a header
comment naming the task that fills it and the seed scenario to copy, and one step that fails with "not built yet
(Task N)". Import each beside `monitorTasksScenarios` (line 68) and spread it into the list beside
`...monitorTasksScenarios(RT_KIT)` (line 62783), with these kits:

- `code-image-zoom` (Task 4, seed `code-markdown`, ~line 12843) and `code-blame-draft` (Task 5, seed `code-blame`,
  ~line 11488) take a new `CODE_KIT`: every helper and constant those two seeds use (`git`, `openProjectPicker`,
  `chooseProjectNamed`, `chooseProjectRow`, `setFinderQuery`, `installProbe`, `pressKey`, `treeVisible`,
  `blameLines`, `BLAME_FILE`, the `BLAME_*` selectors, `waitForProjectInConfig`, `polishWaitFor`, `polishNap`,
  `waveService`, and any other they call).
- `diff-file-keys` (Task 6, seed `diff-review-marks`, ~line 6429) takes a new `FILES_KIT`: every helper and constant
  that seed uses (`git`, `pickFilesSource`, `reloadApp`, `showLogTab`, `REVIEW_STORAGE_KEY`, …).
- `brainstorm-board-pick` (Task 7, seed `brainstorm-mode`, ~line 32049, and the board scenarios in
  `scenarios-brainstorm-*.mjs`) takes `BS_KIT`; add to `BS_KIT` what `brainstorm-mode` uses that it lacks
  (`bsClosePeek`, `bsSeeHints`, `openCanvasTerminal`, `polishReload`, `waitForProjectInConfig`).
- `palette-brainstorm-resume` (Task 8) takes `BS_KIT`; add `openPalette` to it.
- `brief-act-blocked` (Task 9, seed `brief-surface`, ~line 470) takes `JARVIS_KIT` as it is.

Adding entries to existing kits must not change what other scenarios do.

**Acceptance:** a node one-liner that imports `scripts/cdp/scenarios.mjs` and prints the scenario names lists all six;
`node -e` importing each new file and calling it with its kit returns one scenario; existing scenarios' names are
unchanged.

### Task 2: The view mod draws Arc's run and cockpit prompts as cards
**Depends on:** none

**Files:** `claude/arc-view-mod/hooks/prompt-core.ts`, `claude/arc-view-mod/hooks/prompt-core.test.ts`, `claude/arc-view-mod/hooks/prompt-row.tsx`, `claude/arc-view-mod/hooks/register.ts`, `claude/arc-view-mod/hooks/wake-core.ts`, `cmd/wsh/cmd/claude-view-mod/hooks/prompt-core.ts`, `cmd/wsh/cmd/claude-view-mod/hooks/prompt-row.tsx`, `cmd/wsh/cmd/claude-view-mod/hooks/register.ts`, `cmd/wsh/cmd/claude-view-mod/hooks/wake-core.ts`, `pkg/orchestrate/review.go`, `pkg/orchestrate/viewmod_fixtures_test.go`, `Taskfile.yml`
**Files:** `claude/arc-view-mod/testdata/agent-message.txt`, `claude/arc-view-mod/testdata/autonomous-off.txt`, `claude/arc-view-mod/testdata/autonomous-on.txt`, `claude/arc-view-mod/testdata/builder-check.txt`, `claude/arc-view-mod/testdata/builder-questions.txt`, `claude/arc-view-mod/testdata/child-cancelled.txt`, `claude/arc-view-mod/testdata/child-done.txt`, `claude/arc-view-mod/testdata/design-brainstorm.txt`, `claude/arc-view-mod/testdata/design-canvas.txt`, `claude/arc-view-mod/testdata/for-later.txt`, `claude/arc-view-mod/testdata/judge-failed.txt`, `claude/arc-view-mod/testdata/judge.txt`, `claude/arc-view-mod/testdata/judged.txt`, `claude/arc-view-mod/testdata/lead-design-prototype.txt`, `claude/arc-view-mod/testdata/lead-design.txt`, `claude/arc-view-mod/testdata/lead-goal-autonomous.txt`, `claude/arc-view-mod/testdata/lead-goal.txt`, `claude/arc-view-mod/testdata/plan-lead-replacement.txt`, `claude/arc-view-mod/testdata/plan-lead.txt`, `claude/arc-view-mod/testdata/plan-reviewer-second.txt`, `claude/arc-view-mod/testdata/plan-reviewer.txt`, `claude/arc-view-mod/testdata/quick.txt`, `claude/arc-view-mod/testdata/review-note.txt`, `claude/arc-view-mod/testdata/reviewer.txt`, `claude/arc-view-mod/testdata/verifier.txt`, `claude/arc-view-mod/testdata/wake.txt`, `claude/arc-view-mod/testdata/worker-dag.txt`, `claude/arc-view-mod/testdata/worker.txt`, `claude/arc-view-mod/testdata/workflow-picks.txt`

`prompt-core.ts`, its test, `prompt-row.tsx`, the `testdata/*.txt` fixtures and `viewmod_fixtures_test.go` are new;
the four `cmd/wsh/cmd/claude-view-mod/hooks/` files change only through `task sync:claudemod`. The fixture list is the
fork's: a fixture for a prompt kind ours has no builder for is not created. Add no fixture that is not on the Files
line; a prompt kind only ours has (council seats) is left for a later sync and named under the commit's "Differs from
plan".
Commit `353d3dede`: a run's launch prompt and the cockpit's sends showed in the transcript as raw text; the arc-view
mod now draws each as a card (role, tags, and a label column for leads, workers, reviewers, plan reviewers, verifiers,
judges, brainstorm and design prompts, wakes and agent messages). A launch prompt is claude's command-line argument,
so its row carries no plugin origin: the mod knows it by its opening, inside an Arc block only, and reads a prompt that
went to a file. The fixtures are real prompt texts; `viewmod_fixtures_test.go` (`TestViewModFixtures`) regenerates
them from our engine's prompt builders so they cannot drift. **Our prompts differ from the fork's:** rebuild every
fixture from our `pkg/orchestrate` (and brainstorm, design) prompt builders and drop the fork's kinds we have no prompt
for. Skip the commit's Code review hunks (`codehandoff.ts`, `codepathbar.tsx`, `codereview*.ts`). The `Taskfile.yml`
hunk is required: `sync:claudemod` (Taskfile.yml ~line 347) strips only `.claude-plugin/types` and `hooks/*.test.ts`
today, so add the removal of `testdata/` from the copy. Keep what the card shows (role, tags, label column) in
`prompt-core.ts`, so `prompt-row.tsx` only lays out the props it is handed.

**Acceptance:** `npx vitest run claude/arc-view-mod/hooks/prompt-core.test.ts` passes: every fixture is recognised
with its role, tags and label column (the props the card draws), and a plain user prompt that happens to start like
one outside an Arc block is not. `go test ./pkg/orchestrate/ -run TestViewModFixtures` passes and runs (not "no tests
to run"). After `task sync:claudemod`, `cmd/wsh/cmd/claude-view-mod/` has no `testdata/`. `claude plugin validate
claude/arc-view-mod` passes. The drawn card itself is a hand check (Task 10): `ui.render` only runs in a live session.

### Task 3: The task reviewer flags files outside the task's Files line
**Depends on:** Task 2 (both edit `pkg/orchestrate/review.go`, and this one regenerates `reviewer.txt` through Task 2's fixture test)

**Files:** `pkg/orchestrate/review.go`, `pkg/orchestrate/review_test.go`, `pkg/jarvis/plan.go`, `pkg/jarvis/plan_test.go`, `claude/arc-view-mod/testdata/reviewer.txt`, `docs/guide/orchestrator.md`

Commit `1ba540366`: measured over 922 reviewed tasks, two runs landed files outside a task's `**Files:**` list that the
reviewer missed reading the diff, and one passed a worker's self-reported known blockers. The engine now diffs the
task's commits against its Files line and lists every unlisted path in the reviewer's brief, which fails the task
unless the task calls for it or the commit's "Differs from plan" names it; a worker that admits a gap ("known
blockers", "not done") fails review. A directory entry on the Files line (ending in `/`) covers the files under it.
Check how ours parses `**Files:**` today (`pkg/jarvis/plan.go`) before adding a parser. Regenerate
`testdata/reviewer.txt` through `TestViewModFixtures`. `docs/guide/orchestrator.md` (the fork's
`docs/orchestrator-guide.md`) says what the reviewer now checks; that page is in Vietnamese, so write the addition in
Vietnamese in the page's voice, not the fork's English hunk.

**Acceptance:** `go test ./pkg/orchestrate/ ./pkg/jarvis/` passes with the fork's cases: unlisted paths are listed in
the brief; a listed directory covers its files; a task with no Files line lists nothing; an admitted gap fails.

### Task 4: Images in Code's markdown Preview open in a zoom view
**Depends on:** Task 1

**Files:** `frontend/app/element/imagezoom.tsx`, `frontend/app/element/imagezoommodel.ts`, `frontend/app/element/imagezoommodel.test.ts`, `frontend/app/element/markdown.tsx`, `frontend/app/store/keybindings/dispatcher.ts`, `frontend/app/view/code/codeviewer.tsx`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios-code-imagezoom.mjs`

The three `imagezoom*` files are new. Commit `67899857e`: clicking a resolved image in Code's markdown Preview opens a
full-window zoom view: fitted on open (never upscaled), the wheel zooms around the pointer, `+`/`-` around the
centre, drag pans while zoomed, `0` fits again, a readout shows the percent; Esc, a backdrop click or the close button
closes it and hands focus back to the Preview. `imagezoommodel.ts` holds the fit/clamp/zoom-at-point math;
`imagezoom.tsx` is a thin overlay on `ModalShell`, portaled to body. `Markdown` gains an opt-in `onClickImage` prop;
other markdown callers keep plain images.

**Acceptance:** `imagezoommodel.test.ts` covers fit (no upscale), clamp, zoom at a point keeping it fixed, and fit
again. Scenario `code-image-zoom` (Task 1's stub, `CODE_KIT`) opens a markdown file with an image in Code's Preview,
clicks it and shoots the zoom view fitted, then after a wheel zoom with the percent readout changed, then Esc back to
the Preview; `task verify:ui -- code-image-zoom` passes.

### Task 5: Blame follows unsaved edits
**Depends on:** Task 1

**Files:** `frontend/app/view/code/codeblame.ts`, `frontend/app/view/code/codeblame.test.ts`, `frontend/app/view/code/codeblamecolumn.tsx`, `scripts/cdp/scenarios-code-blame-draft.mjs`

Commit `ff2540f33`: blame describes the saved file, so with a draft open (`codedraft.ts`) the column drew each entry at
its saved line numbers and drifted off the code after any insert or delete. `mapBlameLines` maps each buffer line to
its saved line through a line diff of the draft against the saved text; a new or changed line shows no blame (or an
"unsaved" mark).

**Acceptance:** `codeblame.test.ts` covers an insert above, a delete, a changed line and an unchanged file.
Scenario `code-blame-draft` (Task 1's stub, `CODE_KIT`) opens a file with blame on (as `code-blame` does), inserts two
lines at the top without saving and shoots the blame entries still beside their own lines, the two new lines marked
unsaved; `task verify:ui -- code-blame-draft` passes.

### Task 6: n / p step through the Diff file list
**Depends on:** Task 1, Task 4 (both edit `docs/keyboard-shortcuts.md`)

**Files:** `frontend/app/view/agents/filetree.ts`, `frontend/app/view/agents/filetree.test.ts`, `frontend/app/view/agents/reviewmarks.ts`, `frontend/app/view/agents/filessurface.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios-diff-file-keys.mjs`

Commits `d94ed8bb6` (file-list order helpers: `listOrder(files, tree)` in `filetree.ts`, the order the list is drawn
in) and `dc26b2004`, its n/p half: `n` / `p` (`files:next-file`, `files:prev-file`) open the next or previous file in
the list's drawn order through `activeReviewAtom`'s select, without marking it reviewed, and decline at either end and
with no list. Ours already has `files:refresh` on `r` and `files:next-change` / `files:prev-change` on `Shift+N` /
`Shift+P` (`bindings.ts` ~line 2334): keep those. Port `r` refreshing an open compare only if our `files:refresh` does
not already re-run the compare; port the narrow-width Shift+D decline only if our split toggle draws a split that does
not fit. The Files bindings builder is `buildFilesBindings` (line 2252).

**Acceptance:** `filetree.test.ts` covers `listOrder` for a flat and a folded tree; `bindings.test.ts` covers n/p
stepping, declining at the ends and with no list, and no clash on the Files surface. Scenario `diff-file-keys` (Task
1's stub, `FILES_KIT`) opens the Diff with three changed files, presses `n` twice and shoots the third selected and none
marked reviewed, then `p`; `task verify:ui -- diff-file-keys` passes.

### Task 7: Pick a brainstorm answer from its full-size board
**Depends on:** Task 1

**Files:** `frontend/app/view/agents/brainstormmodel.ts`, `frontend/app/view/agents/brainstormmodel.test.ts`, `frontend/app/view/agents/brainstormpane.tsx`, `frontend/app/view/agents/brainstormui.tsx`, `frontend/app/view/agents/canvaspane.tsx`, `scripts/cdp/scenarios-brainstorm-board-pick.mjs`

Commit `3c95e0645`: the full-size board's tabs already letter boards by answer, but choosing one meant going Back to
the question. A board that an open question's answer names (or an approach, during the judge's wait) now gets a pick
row under the board: "Pick A" sends that answer as the question's answer would. `CanvasPane` takes a `boardActions`
slot; `boardPicks` in the model decides which answers a board offers. Reuse the existing answer-send path; do not add
a second.

**Acceptance:** `brainstormmodel.test.ts` covers `boardPicks`: a board named by one answer, by two, by none, and an
approach board during the judge's wait. Scenario `brainstorm-board-pick` (Task 1's stub, `BS_KIT`, seeded like
`brainstorm-mode`) opens a board full-size, shoots the pick row, picks and shoots the question answered;
`task verify:ui -- brainstorm-board-pick` passes.

### Task 8: Resume an open brainstorm from the command palette
**Depends on:** Task 7

**Files:** `frontend/app/view/agents/brainstormmodel.ts`, `frontend/app/view/agents/brainstormmodel.test.ts`, `frontend/app/view/agents/brainstormpane.tsx`, `frontend/app/view/agents/brainstormpoller.ts`, `frontend/app/view/agents/brainstormpoller.test.ts`, `frontend/app/view/agents/brainstormstore.ts`, `frontend/app/view/agents/brainstormstore.test.ts`, `frontend/app/cockpit/cockpit-actions.ts`, `frontend/app/cockpit/command-palette.tsx`, `frontend/app/cockpit/palette-commands.ts`, `frontend/app/cockpit/palette-commands.test.ts`, `frontend/app/cockpit/palette-groups.ts`, `frontend/app/cockpit/palette-groups.test.ts`, `frontend/app/cockpit/palette-rows.tsx`, `frontend/app/cockpit/palette-scope.ts`, `frontend/app/cockpit/palette-scope.test.ts`, `frontend/app/cockpit/use-palette-brainstorms.ts`, `docs/agents/brainstorm.md`, `scripts/cdp/scenarios-palette-brainstorm-resume.mjs`

`use-palette-brainstorms.ts` is new. Commits `a52bbdb77` then `4e4cdfcab`, which moved the list out of the New agent
window into the palette: the palette lists the projects' brainstorms never approved (`done` false), newest first, with
the open question and age; Enter resumes one by starting the chosen runtime on its file, and writes
`session:brainstorm` on the new tab (the agent's hook reveals the pane only when its write creates the file, and a
resumed file already exists); the Exited view's Resume in `brainstormpane.tsx` passes the brainstorm file the same way
(`a52bbdb77`'s hunk there). Dismissing one is the brainstorm row's `alt` action, which the palette already runs on
Mod+Enter (`command-palette.tsx`, Ctrl on Windows, Cmd on a Mac) and labels in its footer: add no new key handler. A
dismiss writes an empty `dismissed` file beside `brainstorm.json`, which hides it while the marker is newer than the
brainstorm. Port only the palette path, not the New agent window list. Our palette has no `palette-items.ts` /
`palette-scopegroups.ts`: put that logic where ours builds rows and groups.

**Acceptance:** vitest covers the open-brainstorm list (done excluded, newest first, dismissed hidden until the file
changes) and the palette rows, groups and scope. Scenario `palette-brainstorm-resume` (Task 1's stub, `BS_KIT`) seeds
two open brainstorms and a done one, opens the palette, shoots the two rows with question and age, dismisses one with
the row's alt (Mod+Enter) and shoots it gone; `task verify:ui -- palette-brainstorm-resume` passes.

### Task 9: The Brief acts on what it shows
**Depends on:** Task 1

**Files:** `frontend/app/view/jarvis/briefingmodel.ts`, `frontend/app/view/jarvis/briefingmodel.test.ts`, `frontend/app/view/jarvis/briefingfixtures.ts`, `frontend/app/view/jarvis/briefrows.ts`, `frontend/app/view/jarvis/briefrows.test.ts`, `frontend/app/view/jarvis/briefrowviews.tsx`, `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/jarvis/waitingstrip.tsx`, `frontend/app/view/jarvis/effortmodel.ts`, `frontend/app/view/jarvis/effortmodel.test.ts`, `frontend/app/view/jarvis/effortstore.ts`, `pkg/jarvisstate/jarvisstate.go`, `pkg/jarvisstate/jarvisstate_test.go`, `pkg/jarvisstate/jarvisstate_effort_test.go`, `pkg/wshrpc/wshrpctypes_effort.go`, `pkg/wshrpc/wshrpctypes_jarvis.go`, `frontend/types/gotypes.d.ts`, `scripts/cdp/scenarios-brief-act.mjs`

`gotypes.d.ts` only through `task generate`. Commit `3a462a716` (its body lists ten fixes from reviewing the Brief on
real data). Port the ones our Brief has a place for, at least: a blocked chunk's waiting row shows what it needs (the
"marked blocked · needs" note), its age and any newer note; blockers sort oldest first and the summary counts kinds
and initiatives; the effort summary carries a blocked chunk's since / needs / latest (Go); a blocked chunk's row has
Unblock and Done (undoable), and opening one lands on the chunk in its initiative's plan with its notes open; the filter
reaches rows behind every fold; Initiatives counts quiet ones (no update in 7 days or more); Behind you drops record
events that shadow a run. List in the commit which of the ten you ported and why each other one does not apply to
ours. Skip the pet.

Keep `EffortCardModel.blockedChunks: string[]` as it is (`effortmodel.ts` line 35; `initiativework.ts`,
`reviewmodel.ts`, `briefcards.ts` and `initiativepickermodel.ts` read it) and add the blocked chunks' since / needs /
latest as a separate field beside it, rather than turning `blockedChunks` into objects as the fork does. The
shadowed-event drop is Go, as in the fork (`shadowsRun` in `jarvisstate`'s `Timeline`; dossier events carry no refs
on the wire).

**Acceptance:** `go test ./pkg/jarvisstate/` covers the blocked chunk's since / needs / latest in the effort summary
and the shadowed-event drop from Behind you (in `jarvisstate_test.go`). vitest covers the waiting-row text and order,
Unblock/Done with undo and the quiet count. Scenario `brief-act-blocked` (Task 1's stub, `JARVIS_KIT`, seeded like
`brief-surface`, with a blocked chunk) shoots the waiting row with its needs note and age, presses Unblock and shoots
the undo, then opens the row and shoots the chunk in its plan; `task verify:ui -- brief-act-blocked` passes.

### Task 10: CHANGELOG and hand checks
**Depends on:** Task 3 (writes the reviewer's and the prompt cards' lines only once they landed), Task 5 (writes the blame line only once it landed), Task 6 (writes the image zoom and n/p lines only once they landed), Task 8 (writes the board-pick and palette-resume lines only once they landed), Task 9 (writes the Brief line only once it landed)

**Files:** `CHANGELOG.md`, `docs/hand-checks.md`

`CHANGELOG.md`, under the top `## Unreleased` (open one above a dated top section): one user-facing line each for the
prompt cards in Claude transcripts (Added), the reviewer's Files check (Changed), image zoom (Added), blame with
unsaved edits (Fixed), n/p in Diff (Added), picking from a full-size board (Added), resuming a brainstorm from the
palette (Added, `<!-- try: … -->` with the palette's global binding id), the Brief's blocked rows (Added) — each with
"(from the kaeltran16 fork)" after its bold lead, as earlier syncs wrote it. A feature whose task was skipped gets no
line. `docs/hand-checks.md`: `- [ ] (arcterm) Kael sync 11-06: …` lines for the prompt cards drawn in a live Claude
session (a run's lead and a worker, a cockpit send), and the reviewer failing a real task that wrote outside its Files
line.

**Acceptance:** the CHANGELOG and hand-check lines are in place.

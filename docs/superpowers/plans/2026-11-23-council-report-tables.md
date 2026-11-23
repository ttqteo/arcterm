# Council report: tables of the project's facts — plan

**Spec:** `docs/superpowers/specs/2026-11-23-council-report-tables-design.md` (read its "Decisions made while planning" section first: every task below builds on it, and decision 6 there replaces the spec's decision 6 on where the copy sits)
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./cmd/wsh/... ./pkg/wshrpc/wshserver/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke council-summary council-figures council-final-proposal jarvis-council-sheet council-report-tables`

Principles for every worker: prefer the simple, direct solution; one source of truth; no abstraction for a single
use; handle errors at boundaries and never swallow one silently (a copy or a rewrite that fails is reported, not
dropped). Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (AGENTS.md). Never hand-edit
generated files: change Go, run `task generate`. No task bumps `HarnessVersion` except Task 2.

### Task 1: The new fields and the side file's name
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/council/types.go`, `pkg/council/reportfiles.go`, `pkg/council/reportfiles_test.go`, `frontend/types/gotypes.d.ts`

The interface every other task builds on. Add, with doc comments in the file's style:

- `CouncilFigure { Value string "value"; Measures string "measures"; Ref string "ref"; Quote string "quote,omitempty"; Cite string "cite,omitempty"; CiteNote string "citenote,omitempty"; From []string "from,omitempty" }`. `Cite` takes the existing `CiteOK` / `CiteWrong`; `From` is set only on `Council.Figures` (the proposal ids that declared it).
- `CouncilProposal.Figures []CouncilFigure "figures,omitempty"` (beside `Evidence`).
- `CouncilDirection`: `Task string "task,omitempty"`, `Why string "why,omitempty"`, `Kind string "kind,omitempty"`, `Files []string "files,omitempty"`, and constants `TaskNew = "new"`, `TaskEdit = "edit"`, `TaskDecision = "decision"`.
- `CouncilBrief { Source string "source"; Copy string "copy,omitempty"; Skipped string "skipped,omitempty" }` (Source absolute; Copy project-relative with forward slashes; Skipped is why it was not copied).
- `Council.Figures []CouncilFigure "figures,omitempty"` (derived by Go after each check pass, Review only) and `Council.Briefs []CouncilBrief "briefs,omitempty"`.
- `pkg/council/reportfiles.go`: `const DiscussionSuffix = ".discussion.md"`, `SidePath(mainPath string) string` (`x/2026-11-23-a.md` → `x/2026-11-23-a.discussion.md`; a path not ending in `.md` gets the suffix appended) and `IsSidePath(path string) bool`.

Run `task generate` and commit the regenerated `frontend/types/gotypes.d.ts`. Tests: `reportfiles_test.go` covers `SidePath` and `IsSidePath` (`go test ./pkg/council -run 'TestSidePath|TestIsSidePath'`); `task check:ts` passes.

### Task 2: Figures from the seats, checked by Go; the synthesis's new fields and language rule
**Depends on:** Task 1 (uses `CouncilFigure`, `CouncilProposal.Figures`, `Council.Figures` and the direction fields)
**Model:** sonnet
**Files:** `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/parse.go`, `pkg/council/parse_test.go`, `pkg/council/cites.go`, `pkg/council/cites_test.go`, `pkg/council/figures.go`, `pkg/council/figures_test.go`

Spec decisions 3 and 4, planning decisions 1–4 and 9.

- Round 1 (Review only, every variant derived from `round1Shape`, the agent seat's included): each proposal may carry `"figures": [{"value": …, "measures": …, "ref": "path:line", "quote": …}]` after `"evidence"`. Add a short `figuresRule` to `round1Task`'s Review branch: list each number the proposal relies on that a project file holds, `value` exactly as the quoted line writes it, `quote` the line's text, `measures` in the language of the person's question (say which: `c.Lang`/`councilLang`), and leave out a number nobody wrote down. The Brainstorm shapes ask for none.
- `ParseRound1` reads `figures` into `CouncilProposal.Figures`, trimming each field and dropping an entry with no value or no ref. `TestShapesParse` (keep shapes and parser in step) must still pass with the new keys.
- `figures.go`: `checkFigure(f CouncilFigure, roots []string) CouncilFigure` — reuse `checkCite(splitCiteRef(ref), quote, roots)` for the quote-near-line check, then the value-in-quote test (planning decision 3); no quote, no line or no value → `CiteWrong` with a note saying which. `collectFigures(c *Council) []CouncilFigure` dedups the sent proposals' checked figures (planning decision 2), fills `From`, keeps proposal order; nil in a Brainstorm.
- `ApplyChecks` (cites.go) checks each sent Review proposal's `Figures` with that author's roots, then sets `c.Figures = collectFigures(c)`. No change to `runner.go`: both call sites already run `ApplyChecks`.
- Both synthesis shapes (Review and Brainstorm, with and without a question) ask each direction for `"task"` (≤15 words: what to do), `"why"` (one sentence), `"kind"` (`new` | `edit` | `decision`) and `"files"` (project paths the task changes). Add the rule lines that say so. `ParseSynthesis` reads them; a `kind` outside the three reads as `""`; `files` trimmed, empties dropped.
- Language: replace "every other field stays in English" in `summaryRule` and `summaryRuleNoQuestion` with: every field the person reads (answer, text, asks, each direction's title, reasoning, firststep, task and why, each kept item's title and reasoning) is written in the language of the question (`summaryRuleNoQuestion`: of the feature); technical terms, ids, paths and JSON keys stay as they are.
- Bump `HarnessVersion` to `2026-11-23.1` with one line in its comment on what changed.
- Put new tests in `figures_test.go`, `cites_test.go`, `parse_test.go` and `prompts_test.go`, not `runner_test.go` (Task 3 owns that file). Update the `prompts_test.go` asserts on "stays in English".

Tests (focused): `go test ./pkg/council -run 'TestShapesParse|TestParseRound1|TestParseSynthesis|TestCheckFigure|TestCollectFigures|TestApplyChecks|TestSynthesisPrompt|TestRound1Prompt'` — new cases: figures parsed and blank ones dropped; a figure whose value is in its quote and the quote near the line is ok; value missing from quote, no quote, past-the-end line and missing file are wrong with their notes; dedup of two seats' copies of one figure (differing `measures`, one verified) keeps one verified figure with both ids in `From` and the verified copy's `measures`; a Brainstorm gets no `Figures`; the synthesis prompt of a Vietnamese council asks for the question's language and no longer says "stays in English"; `kind` normalisation.

### Task 3: The main file and the side file
**Depends on:** Task 1 (uses the new fields and `SidePath`)
**Model:** sonnet
**Files:** `pkg/council/markdown.go`, `pkg/council/markdown_test.go`, `pkg/council/reportwords.go`, `pkg/council/reportwords_test.go`, `pkg/council/docpath.go`, `pkg/council/docpath_test.go`, `pkg/council/reportcites.go`, `pkg/council/reportcites_test.go`, `pkg/council/testdata/report-review.md`, `pkg/council/testdata/report-review.discussion.md`, `pkg/council/testdata/report-brainstorm-vi.md`, `cmd/wsh/cmd/wshcmd-council-cites.go`, `cmd/wsh/cmd/wshcmd-council-cites_test.go`, `skills/council/SKILL.md`, `pkg/council/charts_test.go`, `pkg/council/regions_test.go`, `pkg/council/runner_test.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`

Tests that read a saved document for sections that move to the side file break and are this task's to fix:
`runner_test.go:4118`, `:4137` and `:4147` ("## The discussion", "## Run facts", "- Ended: stopped" read from the
written path: read the side file too), `docpath_test.go:151`, `wshserver_council_test.go:493` (the written file equals
`council.Document(c)`: it is now the main part only), `:496` and `:513` (`len(files) != 1`: two files now),
`regions_test.go:279` (the region embeds now sit in the side file). Check `charts_test.go:111-115` still passes
(`Document` stays main + side) and leave it alone if it does.

Spec decisions 1, 2 and 4, planning decisions 4 and 5. Reads `Council.Figures`, the direction fields and `Council.Briefs`; it does not depend on Task 2's code (build test councils by hand).

- `reportwords.go`: the main file's own words in English and Vietnamese, picked by the council's language (`c.Lang`, else `councilLang(c.Question, c.Feature)`): title prefix, "You asked", the to-do heading and its columns (`#`, Việc / Task, Vì sao / Why, File đụng tới / Files, Loại / Kind), the kind words (việc mới / sửa chữ / quyết định; new work / text edit / decision), the figures heading and columns (Giá trị / Value, Đo gì / Measures, Nguồn / Source), the memory headings (Đã chốt / Agreed, Đã loại / Ruled out, Còn mở / Open, and the direction headings), the Final proposal heading and the side-file link line. Narrow `labelWord`'s comment: English words are the side file's rule now.
- Main file: in the order of planning decision 5. The to-do table is one row per ranked direction with the fallbacks of planning decision 4 (cells through `tableCell`; `files` as `` `path` `` joined with ", "). The figures table holds only `Council.Figures` with `Cite == CiteOK`, `Ref` as `` `path:line` ``; no section when none. The link line names the side file by its base name, relative.
- Side file: planning decision 5's list, English headings, opening with a link back to the main file. The glance chart, the full directions (`writeDirection` as today), kept, ask next and the matrix move here; add "Figures that did not check out" (value, measures, ref, the note) and "Files not copied" (each `Briefs` entry with `Skipped`).
- `Markdown(c)` per planning decision 5 (what `wsh council wait`/`show` print). `Document(c)` keeps its signature: main, then side. `WriteDocument` writes both (side at `SidePath(main)`), copies the regions beside them as today, and runs the cite audit over main + side together into the side file's Cite check. `DocPath`'s `-2` suffix check stays on the main file.
- The cite audit must not read the side file's "Figures that did not check out" section as the report's own cites (its refs are the failed ones, listed with why): `splitReport` (reportcites.go) skips that section, as it skips the check's own notes; test it.
- `wsh council cites <report>`: given a main file it also reads its side file when there, given a side file it also reads the main one, and audits the two texts joined; update its help text. In `skills/council/SKILL.md`, say the Cite check is in the `.discussion.md` side file.

Tests (focused): `go test ./pkg/council -run 'TestMarkdown|TestDocument|TestWriteDocument|TestReportWords|TestDocPath|TestReportCites|TestRunner.*Document'`, `go test ./pkg/wshrpc/wshserver -run 'TestCouncilSaveDoc|TestCouncilEstimate'` and `go test ./cmd/wsh/cmd -run 'TestCouncilCites'`. Golden files: a Review council in Vietnamese with figures (one verified, one failed), two directions (one with every new field, one with none: its row falls back and shows "—"), a memory and a brief that was not copied → `testdata/report-review.md` and `testdata/report-review.discussion.md`; a Brainstorm in Vietnamese with no new fields → `testdata/report-brainstorm-vi.md` (Việc from the first step). Golden tests regenerate with a `-update` flag. Also: the main file has no "Matrix", "Run facts", "Cite check", "Ask next", "Stances" or "The discussion"; an English council's headings are English; `WriteDocument` writes both files and returns the main path; `cites` reads the sibling. Update the existing markdown tests the split moves.

### Task 4: Copy outside files into the project at Start
**Depends on:** Task 1 (uses `CouncilBrief` and `Council.Briefs`), Task 3
**Model:** sonnet
**Files:** `pkg/council/briefs.go`, `pkg/council/briefs_test.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/council/outside.go`, `pkg/council/outside_test.go`, `cmd/wsh/cmd/wshcmd-council.go`, `cmd/wsh/cmd/wshcmd-council_test.go`

It runs after Task 3 because both edit `runner_test.go`. `TestRunnerChecksCitesIntoAttachedFilesAndFolders`
(`runner_test.go:6567`) starts a council with an outside file and folder in `files` and expects ux's cite of the
original's absolute path to hold: once Start copies them, update it so the seat cites the copy under
`docs/council/briefs/` (ok), and assert that a cite of the original now reads outside the council's folders.

Spec decision 6 as changed by planning decision 6.

- `briefs.go`: `takeBriefs(c *Council, day time.Time)`. For each entry of `c.Files`: an absolute path inside the project becomes project-relative with forward slashes (`inside` in docpath.go); a path outside the project is copied to `docs/council/briefs/<YYYY-MM-DD>-<council id>-<base name>` (a folder copied whole, its tree kept), its `files` entry replaced by the copy's relative path and `{Source, Copy}` appended to `c.Briefs`. A file or folder over 1 MB in all (`briefCap`), one that cannot be read, or a project folder that is not there leaves the entry as it was and records `{Source, Skipped: why}`; a copy that fails midway removes what it wrote. Two outside files with one base name get `-2`, `-3`. A source that already has a brief with a Copy (a re-run of a saved council) is not copied again. Screenshots are not touched.
- Call it in `beginFresh` (runner.go) with `DocDay()`, so Start, StartSaved and the queue take the copies.
- `outside.go`: `changedFiles` also watches the `Source` of each brief with a Copy (the follow-up reads the source), in the order `files` lists their copies.
- `wsh council start`: after a council that starts at once, print one `warning: <source> was not copied into docs/council/briefs: <why>` line per skipped brief to stderr (a pure helper in wshcmd-council.go, tested).

Tests (focused): `go test ./pkg/council -run 'TestTakeBriefs|TestChangedFiles'` and `go test ./cmd/wsh/cmd -run 'TestCouncilBriefWarnings'` — an outside file is copied and `files` names the copy; an inside absolute path turns relative; an outside folder under 1 MB is copied whole and one over is skipped with why; an unreadable file is skipped; a re-run does not copy twice; the same base name twice gets `-2`; `changedFiles` lists a brief whose source changed. Use `t.TempDir()` for both the project and the outside folder.

### Task 5: `wsh council redoc` for old reports
**Depends on:** Task 1 (uses `IsSidePath`)
**Model:** sonnet
**Files:** `cmd/wsh/cmd/wshcmd-council-redoc.go`, `cmd/wsh/cmd/wshcmd-council-redoc_test.go`, `docs/hand-checks.md`

Spec decision 7, planning decision 7. `wsh council redoc [--project <dir>] [--dry-run]` (project defaults to the cwd's git root, else the cwd). It lists the project's councils over `CouncilListCommand`, and for each whose `docpath` resolves to a `.md` under `<project>/docs/council/` that exists on disk (compare by the file under this project, not the stored absolute path's drive or prefix: match the stored path's base name against the project's reports), re-saves it with `CouncilSaveDocCommand` at that path. It then lists the reports under `docs/council/` (top level, not `briefs/`, not side files) that no council names as "left untouched: no council record on this machine". `--dry-run` prints the plan only. A save that fails is printed with its error and the command goes on, exiting nonzero at the end. Keep the pairing logic a pure function (`redocPlan`) and test it.

Add to `docs/hand-checks.md` under today's heading (2026-11-23), per that file's rules: after installing this build, run `wsh council redoc --project <mit-thesis>` on Windows and on the Mac, and read one regenerated report and its `.discussion.md`; run `wsh council summarize` on `5e31814143638517`, `27f5e22576cf98bf`, `0c4145c0d29de45b`, `51d083251b2dc133` and `5a8ffa6d661752a0` (~0.5M tokens through the Token burn gate) and check the directions come back in Vietnamese; start a council with a file outside the project and check `docs/council/briefs/` holds its copy.

Tests (focused): `go test ./cmd/wsh/cmd -run 'TestRedocPlan'` — a report with a record is re-saved, one without is listed untouched, side files and `briefs/` are ignored, a record whose docpath lies in another project is skipped.

### Task 6: The cockpit Report shows the two tables first
**Depends on:** Task 1 (uses the generated `CouncilFigure`, direction fields and `Council.figures`)
**Model:** sonnet
**Files:** `frontend/app/view/agents/councilreporttables.ts`, `frontend/app/view/agents/councilreporttables.test.ts`, `frontend/app/view/agents/councilreporttables.tsx`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `scripts/cdp/council/reporttables.mjs`, `scripts/cdp/council/rail-apps-report-tables.json`, `scripts/cdp/councilscenarios.mjs`, `scripts/cdp/council/summary.mjs`, `scripts/cdp/council/figures.mjs`, `scripts/cdp/council/finalproposal.mjs`, `scripts/cdp/council/sheet.mjs`, `scripts/cdp/council/fixtures.mjs`, `scripts/cdp/council/fixtures.test.mjs`, `CHANGELOG.md`

The new fixture is one more council of the set: add it to `fixtures.mjs` (`COUNCIL_FIXTURES` and its `PLACE` entry)
and to `fixtures.test.mjs`, which pins the exact list (`:73`) and the tree order (`:494`).

Spec decision 5, planning decisions 4, 8 and 10. Follow DESIGN.md (tokens from `@theme`, no raw colours); the tables read as quiet data tables, not cards.

- `councilreporttables.ts` (pure, no React): `todoRows(c)` (rank, task, why, files, kind word) with planning decision 4's fallbacks (its comment names `markdown.go`'s twin), `figureRows(c)` (verified `c.figures`) and `failedFigureRows(c)`, and `reportWords(lang)` for the headings, columns and kind words, the same words as the `.md` (Việc cần làm / To do, Số liệu / Figures, …), using `councillang.ts` for the language.
- `councilreporttables.tsx`: `TodoTable` and `FiguresTable` (`data-council-section="todo"` / `"figures"`, `data-council-todo-row`, `data-council-figure-row`); a source ref shown as `path:line` in mono. Wrap long text; no horizontal page scroll at narrow width (the table may scroll inside itself).
- `councilsummary.tsx`: under the cover, To do, then Figures (when any), then the sections as planning decision 8 orders them; At a glance moves into a new folded "About the council" section (`data-council-section="about"`, its toggle `data-council-about-toggle`, folded by default, open state in a per-council atom as `spendOpenAtom` does), holding the glance figures and the failed figures. Its open/close has motion like the What it spent fold. `outlineOf` / `jumpLinks` (councilsummarymodel.ts): add `todo` and `figures`, drop `glance`; update their tests.
- Update the existing scenarios the move breaks (`summary.mjs:943`, which reads the saved document for `## Matrix`, `## The discussion` and `## Run facts`: those are now in the `.discussion.md` beside it, so read both files; `summary.mjs` jump-link and glance assertions, `figures.mjs` order and glance asserts, which must now open About the council first; `finalproposal.mjs` and `sheet.mjs` if they read the order) so they pass.
- New scenario `council-report-tables` (`scripts/cdp/council/reporttables.mjs`, registered in `councilscenarios.mjs`, fixture `rail-apps-report-tables.json`: a done Vietnamese Review council with every new direction field on one direction and none on another, two verified figures and one failed). Steps: (1) the Report opens with Việc cần làm first under the answer, a row per direction, the fallback row showing "—" in File and Loại; (2) Số liệu lists only the verified figures with their `path:line`; (3) At a glance is not on screen until About the council is opened, and opening it shows the glance figures and the failed figure with its note; (4) at a narrow pane width (~520 px) the tables fit without page scroll; (5) an English council (an existing fixture) shows English headings. Screenshot each.
- `CHANGELOG.md`, under Unreleased (none marked big): Changed — a council's saved report is now short: a to-do table and a table of the checked figures, in the question's language, with the discussion and everything about how the council worked in a `.discussion.md` beside it; Changed — the cockpit's council Report shows the same two tables first and folds At a glance under About the council; Added — files outside the project given to a council are copied into `docs/council/briefs/` when it starts, so its cites resolve on every machine; Added — `wsh council redoc` rewrites a project's old council reports in the new layout.

Tests (focused): `npx vitest run frontend/app/view/agents/councilreporttables.test.ts frontend/app/view/agents/councilsummarymodel.test.ts` — rows with and without the new fields, Brainstorm fallback to the first step, verified-only figures, Vietnamese and English words, jump links. Acceptance in the app: the `council-report-tables` steps above, and `council-summary`, `council-figures`, `council-final-proposal`, `jarvis-council-sheet` still pass (Final runs them).

# Council, stronger: checked claims, a Map tab, plain role names

**Spec:** `docs/superpowers/specs/2026-11-03-council-stronger-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/orchestrate/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts && go vet ./pkg/council/... ./pkg/orchestrate/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Final:** `node scripts/cdp/final-verify.mjs council-map council-discussion council-summary council-setup`
**Prototype:** .superpowers/design/council-stronger/project/Map-tab.dc.html

Read the spec first, its "Calls made while planning" section above all: it fixes the wire shapes, the snapshot, the
quote rule, which results count, the language rule, the worktree seam, the agent seats and the timeline's place in the
Seats popover. Go is the source of truth for the wire types: never hand-edit `frontend/types/gotypes.d.ts`; change the
Go and run `task generate`. Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash).
Colours come from `@theme` tokens, never raw hex; the board's hex values map to the existing tokens (green / amber /
red status tokens, the seat avatar tones). Status is never colour alone: every badge and pill carries an icon or a
word. Labels follow the council's language (`lang`): English words in an English council, the spec's Vietnamese words
(Đã chạy, Bị bác, Đã đọc code, Chỉ đoán, Trích sai, Bản đồ, …) in a Vietnamese one; keep each word pair in one pure
table beside the view that uses it.

### Task 1: The wire types
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/types_test.go`, `pkg/council/agentlink.go`, `frontend/types/gotypes.d.ts`
Add the fields and types the spec's "Storage" call lists, with doc comments: `CouncilEvidence.Quote`, `.Cite`,
`.CiteNote`; `CouncilRun` (`command, expect, why, state, exit, tail, matched, reason`) and `CouncilProposal.Runs`;
`Label` on `CouncilProposal` and `CouncilReply`; `CouncilStep` (`ts, kind, target, result`), `Council.Timeline
map[string][]CouncilStep`, `Council.Lang` and `Council.Snapshot`; and `NameVi` (`namevi,omitempty`) on `CouncilExpert`
and `CouncilGroup` so Setup can show the Vietnamese name. In `agentlink.go`, `AgentSeatState` gains `Cwd` and
`Activity` (the spec's agent-seats call). Add constants for every enumerated value (labels `ran`, `disproved`, `read`,
`guess`; cite `ok`, `wrong`; run states `pass`, `fail`, `not-run`; step kinds `read`, `search`, `run`, `propose`,
`reply`; langs `en`, `vi`) and `MaxTimelineSteps = 200`. No behaviour: nothing sets the fields yet. Run `task generate`.
Test: a council JSON with every new field round-trips through `Load` and save unchanged, and one without them loads
with them empty (`go test ./pkg/council -run 'TestCouncilStronger'`).

### Task 2: The citation check and the labels
**Depends on:** Task 1 (uses the new evidence, run and label fields)
**Files:** `pkg/council/cites.go`, `pkg/council/cites_test.go`
Pure Go (it reads files, never writes). `CheckEvidence(ev []CouncilEvidence, roots []string) []CouncilEvidence` sets
`Cite` and `CiteNote` on each `path:line` (or `path:a-b`) ref: the file exists under one of `roots` (the project
first, then the attached folders and files, or an agent seat's own working directory), the line is in range, and a
`Quote`, whitespace collapsed, is found in the cited line or range or within 3 lines either side, case counting. A
`screenshot:` ref and an empty ref are left unchecked. `LabelOf(ev []CouncilEvidence, runs []CouncilRun) string`
gives `disproved` when a run in state `pass` or `fail` did not match what the expert expected, else `ran` when a run
in state `pass` or `fail` matched, else `read` when at least one cite is `ok`, else `guess`; a `not-run` run never
counts. `ApplyChecks(c *Council, rootsFor func(expertId string) []string)` checks and labels every sent proposal and
every reply with a stance, and leaves a plain reply and every item of a Brainstorm council unlabelled (and its
evidence unchecked). Tests (`go test ./pkg/council -run 'TestCheckEvidence|TestLabelOf|TestApplyChecks'`): exists,
missing file, line past the end, a range, quote at the line, quote 3 lines off (ok) and 4 off (wrong), quote
mismatch, a path outside every root, a cite into an attached folder, screenshot unlabelled, mixed cites read as `read`
with the wrong one still `wrong`, each label from runs, a `not-run` run with `expect: fail` (timed out) leaving the
claim `read` or `guess`, a plain reply and a Brainstorm left alone.

### Task 3: Verify commands, the snapshot and the tree seam
**Depends on:** Task 1 (uses `CouncilRun`, `CouncilStep` and `Snapshot`)
**Files:** `pkg/council/verify.go`, `pkg/council/verify_test.go`, `pkg/council/runner.go`
All in `pkg/council`; the only edit to `runner.go` is the `Trees TreeMaker` field on `Runner`.
`ParseVerifyCommand(cmd string) ([]string, error)` splits the command into words with no shell and accepts only
`go test <one package> -run <pattern>` (other `go test` flags such as `-count=1` and `-v` allowed), `npx vitest run
<one file>` (a `-t <name>` allowed), and `cargo test [--manifest-path <path>] <one test name>`; it rejects a shell
operator (`|`, `&&`, `||`, `;`, `>`, `<`, `` ` ``, `$(`), a second package or file, a path that leaves the tree, and
every other program, each with the reason the timeline shows ("not on the list"). `Snapshot(ctx, project string)
(string, error)` takes the spec's Which-tree commit through a private `GIT_INDEX_FILE` (seeded from HEAD, `git add -A`,
`write-tree`, `commit-tree` with HEAD as parent) and leaves the person's index and files untouched; a project that is
not a git repo returns "" and no error. The `TreeMaker` interface: `Make(ctx, project, commit, key string) (dir
string, err error)` and `Remove(ctx, project, dir string) error`. `RunVerifies(ctx, trees TreeMaker, c *Council,
onStep func(expertId string, s CouncilStep))` takes every sent, uncut proposal's requests (in `Runs` with `state`
empty), keeps at most 2 per expert (the rest `not-run`, "over the 2-command cap"), makes one tree keyed
`council-<id>` at `c.Snapshot` only when at least one allowed command is left, runs each through a `jobqueue` slot
sized by `memgate.Classify`, or `toolSlotBytes` when it classes the command light, with a 3-minute limit, and records
state, exit code, the last 40 lines and `matched`. Per the spec, a timeout, a filter that matched no test (`go test`
"no tests to run" or "testing: warning: no tests to run", vitest "No test files found", cargo "running 0 tests") and a
build failure (Go `[build failed]` or `[setup failed]`, a cargo `error[E…]` before any test ran, a vitest transform
or syntax error) record `not-run` with that reason. It calls `onStep` with a `run` step before and after each
command, and removes the tree on return, on error and when ctx is cancelled (a Stop). A nil `trees`, an empty
`Snapshot` or a project that is not a git repo runs nothing and says why in each run's `reason`. Keep the process
launch behind a package seam so tests never run a real command. Tests: `go test ./pkg/council -run
'TestParseVerifyCommand|TestRunVerifies|TestSnapshot'`: the three forms accepted; pipes, `&&`, redirects, other
binaries, two packages rejected; the cap; a timeout, "no tests to run" and a build failure recorded `not-run`; the
light-command slot size; the tree made only when needed and removed on end, error and cancel; nil trees; the snapshot
holds an uncommitted edit and an untracked file while `git status` of the checkout is unchanged.

### Task 4: The tree in pkg/orchestrate, wired into wavesrv
**Depends on:** Task 3 (implements its `TreeMaker`)
**Files:** `pkg/orchestrate/counciltree.go`, `pkg/orchestrate/counciltree_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`
`counciltree.go` implements `council.TreeMaker`: `git worktree add --detach` at the given commit in the place run trees
live, then `linkDependencies`; `Remove` deletes the tree the way the engine removes its own (junctions first, never
following one). No branch is made. Wire it as `Trees` where `wshserver_council.go` builds the `council.Runner`. Test:
`go test ./pkg/orchestrate -run 'TestCouncilTree'` (a tree at a snapshot commit holds the snapshot's files; the
checkout is untouched; `node_modules` is linked when main has one; Remove leaves no tree and no branch).

### Task 5: Plain role names and the council's language
**Depends on:** Task 1 (uses `NameVi` and `Lang`)
**Files:** `pkg/council/roles.go`, `pkg/council/roles_test.go`, `pkg/council/lang.go`, `pkg/council/lang_test.go`, `pkg/council/runner_test.go`, `frontend/app/view/agents/councillang.ts`, `frontend/app/view/agents/councillang.test.ts`, `frontend/app/view/agents/councilsetupmodel.ts`, `frontend/app/view/agents/councilsetupmodel.test.ts`, `frontend/app/view/agents/councilsetup.tsx`, `scripts/cdp/council/setup.mjs`
Rename the stock roles and groups to the spec's English names and give each its `NameVi` (the spec's table; role ids
unchanged). `LangOf(text string) string` (`lang.go`) per the spec's language call. `NameFor(e CouncilExpert, lang
string) string` and `NameSeats(c *Council)`: a stock role's seat whose name is still a stock name (new English, old
English such as "Skeptic" or "Area chair", or Vietnamese) takes the name for `c.Lang`; a renamed seat, an agent seat
and a user role keep theirs. Task 8 calls `NameSeats` at Start. `councillang.ts` is the TypeScript copy of `LangOf`;
both test files hold the same table of cases (Vietnamese with and without tone marks, English, mixed, empty).
Setup's seat list, group names and experts line show `namevi` when the typed question (else the feature) reads `vi`.
Fix the tests the renames break, among them `runner_test.go`'s suggest-prompt assertion ("Review a UI feature (UX,
RAM, New user, Skeptic)"). Tests: `go test ./pkg/council -run
'TestLangOf|TestNameFor|TestNameSeats|TestBuiltInGroups|TestAgentsGroups|TestExpertsFor|TestSuggest'` and `npx
vitest run frontend/app/view/agents/councillang.test.ts frontend/app/view/agents/councilsetupmodel.test.ts`.
Acceptance: the `council-setup` scenario's experts-line steps read the new English names, and a new step types a
Vietnamese question and sees "Người soi lỗi" in the seat list.

### Task 6: Prompts, parsing and the document
**Depends on:** Task 1 (reads and writes the new fields)
**Files:** `pkg/council/parse.go`, `pkg/council/parse_test.go`, `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/markdown.go`, `pkg/council/markdown_test.go`
Parse: round 1 reads `quote` on evidence and the proposal's `verify` list into `Runs` (state empty); round 2 and the
answers read `quote` too. Prompts: the round 1 shape gains `quote` and `verify` (the three allowed forms, the cap of 2,
`expect` pass or fail), not in a Brainstorm; round 2, the reply passes and the synthesis prompt list every verify
result (command, state, matched, the tail's last lines, or the not-run reason) under its proposal for **every** seat,
leaving out a cut proposal's; the Setup suggestion prompt (`suggestPrompt` stays where it is; give it a language line
through a helper in `prompts.go` that Task 8 passes the language to) asks for role names in the question's language.
Bump `HarnessVersion`; `TestShapesParse` keeps covering every shape. The saved document shows each claim's label word
and each run's result. Tests: `go test ./pkg/council -run
'TestParseRound1Verify|TestParseQuote|TestShapesParse|TestRound2PromptVerifyResults|TestSynthesisPromptVerifyResults|TestMarkdownLabels'`.

### Task 7: Agent seats report their working directory and activity
**Depends on:** Task 1 (fills `AgentSeatState.Cwd` and `.Activity`)
**Files:** `pkg/wshrpc/wshserver/wshserver_councilagents.go`, `pkg/wshrpc/wshserver/wshserver_councilagents_test.go`, `pkg/council/agentcaller.go`, `pkg/council/agentcaller_test.go`
The wavesrv `AgentLink` fills `Cwd` (the agent's working directory from the roster or its block, empty when unknown)
and `Activity` (its current tool line from the roster) in `Seat`. While `AgentCaller.Call` waits on a seat's turn it
calls `OnTool` with each new `Activity` (not repeating an unchanged one), after its existing "Waiting for" line.
Tests: `go test ./pkg/wshrpc/wshserver -run 'TestCouncilAgentLinkSeat'` and `go test ./pkg/council -run
'TestAgentCallerActivity'`.

### Task 8: The runner checks claims, runs verifies and keeps a timeline
**Depends on:** Task 2 (calls `ApplyChecks`), Task 3, Task 5, Task 6 (uses the parsed verify requests and the suggest language helper)
**Files:** `pkg/council/runner.go`, `pkg/council/runner_test.go`, `CHANGELOG.md`, `docs/open-issues.md`, `docs/guide/council.md`
Start sets `Lang` (`LangOf` of the question, else the feature), calls `NameSeats`, and takes `Snapshot` for a Review
council. After round 1 and after each reply pass it calls `ApplyChecks` with roots of the project plus the council's
attached files and folders (an agent seat: its `AgentSeatState.Cwd` when known, else the project). Right after round
1, before the round 1 pause, it calls `RunVerifies` with `r.Trees` (Review councils only; agent seats send no
requests; a 1-round council still runs it) and relabels. The suggest call passes the question's language. Timeline:
every `OnTool` text, verify step, posted idea and reply appends a `CouncilStep` to `Timeline[expertId]` (kind from the
tool text's first word: `Read` → read, `Grep` and `Glob` → search, else kept as the text), dropping the oldest past
`MaxTimelineSteps`; agent seats get theirs from the same `OnTool`. `CHANGELOG.md`: Added lines for checked claims and
the Map tab, a Changed line for the plain role names. `docs/open-issues.md`: session resume across rounds, deferred,
as the spec says. `docs/guide/council.md`: the labels, verify requests and the Map tab, and the group table renamed
to the new role names. Tests: `go test ./pkg/council -run
'TestRunnerChecks|TestRunnerVerify|TestRunnerTimeline|TestStartLang|TestStartSnapshot'`: labels set after round 1 and
the reply pass, results in every seat's round 2 prompt, a cut idea's results left out, the verify step before the
pause, a 1-round council's results reach the synthesis, no labels, snapshot or verify in a Brainstorm, the timeline
cap, a Stop mid-verify removes the tree (fake `TreeMaker`), Start names the seats in Vietnamese for a Vietnamese
question, an agent seat's cites checked against its `Cwd`.

### Task 9: The Map's pure models
**Depends on:** Task 1 (reads the new wire fields)
**Files:** `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`, `frontend/app/view/agents/councilmapmodel.ts`, `frontend/app/view/agents/councilmapmodel.test.ts`, `frontend/app/view/agents/councilstore.ts`
Pure TypeScript, no React. Extend `matrixRows` (not a copy): it works before a summary exists (the outcome then from
cut and withdrawn alone) and keeps its order, since the Discussion list (`councillistmodel.ts`, which only calls it
once a summary exists) reads that order; the Map sorts the rows with a new `byAgreement(rows)`, highest first (agrees
minus against, then fewer doubts, then `matrixRows`' order). Each row carries its check badge (label, plus the first
run's command and result or the first `ok` cite), its agreement counts with the words ("2 agree · 1 doubt"), whether
it is withdrawn, and per cell "revised in round N" where the author revised it after a challenge; a Brainstorm row
carries a `builds` pill instead of badges. `councilmapmodel.ts`: `expertCards(c)` (per seat: name, tone, what it is
doing now and whether that is a running command, the evidence counts ran / disproved / read / guess with their words,
wrong cites, tokens, time, calls; no counts in a Brainstorm), `timelineRows(c, expertId)` (time, kind word, target,
result, mono for a command), and the label words in English and Vietnamese by `c.lang`. Add `"map"` to `CouncilView`.
In `councilstore.ts` add `councilTimelineAtom(councilId)`: the seat whose timeline the Seats popover shows, `null` for
none. Tests: `npx vitest run frontend/app/view/agents/councilmodel.test.ts
frontend/app/view/agents/councilmapmodel.test.ts` (sort, counts, revised note, before-summary rows, withdrawn,
Brainstorm pill, evidence counts in four parts, timeline rows, words by language), and `npx vitest run
frontend/app/view/agents/councillistmodel.test.ts` still passes unchanged.

### Task 10: The Map tab, and the Report's link to it
**Depends on:** Task 9 (renders its models and sets `councilTimelineAtom`)
**Files:** `frontend/app/view/agents/councilmap.tsx`, `frontend/app/view/agents/counciltabs.tsx`, `frontend/app/view/agents/counciltabsmodel.ts`, `frontend/app/view/agents/counciltabsmodel.test.ts`, `frontend/app/view/agents/councilpane.tsx`, `frontend/app/view/agents/agentcenter.ts`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `frontend/app/view/agents/councilstore.ts`, `scripts/cdp/council/map.mjs`, `scripts/cdp/councilscenarios.mjs`, `scripts/cdp/council/summary.mjs`
A third tab, Map (Bản đồ), after Report and Discussion, open while the council runs and after; `showCouncil` takes
`"map"` and `councilpane.tsx` renders it. `councilmap.tsx` draws the board: a header with the tabs and the existing
`CouncilSeats` popover mounted as in the Discussion's header (so the Seats popover exists on the Map too); the expert
cards in a row (avatar, name, now-doing with the working dot and a running command in mono, the evidence bar in four
segments with counts in words, tokens, time, calls; a card is a button that sets `councilTimelineAtom` to its seat);
the legend; then the stance matrix (pills with icon and word, the check badge under each title, agreement bar,
outcome, withdrawn rows dimmed; a click or Enter opens one row's reasons under each seat's column, a second click
closes it; more than 6 seats scroll sideways with the idea column sticky). Before any idea is sent the matrix shows an
empty line ("No ideas yet") under the cards. Remove the Report's "Every expert on every idea" table, its fold atom and
its outline entry; in its place one line, "See who agrees with which idea in Map", that opens the Map. New CDP
scenario `council-map` (registered in `councilscenarios.mjs`, its fixture councils built inside `map.mjs`: one with
Ran, Disproved, Read code and Guess, a wrong cite, a revised cell, a withdrawn idea, a running command, in Vietnamese;
a 7-seat one; a Brainstorm one; one still in round 1 with no ideas): steps open the Map tab, assert the cards with
their four counts and the running command, the matrix order, every badge and pill word, the revised note and the
dimmed withdrawn row, open and close a row's reasons, check the Vietnamese words, see the 7-seat matrix scroll sideways
with the idea column in place, see the Brainstorm's Builds on pill with no badges and no evidence bar, and see "No
ideas yet" on the round-1 council. `council-summary` gains a step: the table is gone and the Map line opens the Map
tab. Test: `npx vitest run frontend/app/view/agents/counciltabsmodel.test.ts
frontend/app/view/agents/councilsummarymodel.test.ts`.

### Task 11: The timeline in the Seats popover, and badges on the evidence chips
**Depends on:** Task 10 (uses the expert cards and the Seats mount in `councilmap.tsx`)
**Files:** `frontend/app/view/agents/councilseats.tsx`, `frontend/app/view/agents/counciltimeline.tsx`, `frontend/app/view/agents/councilsourcespanel.tsx`, `frontend/app/view/agents/councilsources.ts`, `frontend/app/view/agents/councilsources.test.ts`, `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councildiscussion.tsx`, `scripts/cdp/council/discussion.mjs`, `scripts/cdp/council/map.mjs`, `scripts/cdp/council/summary.mjs`
The Seats popover opens whenever `councilTimelineAtom` is set (and clears it when it closes). A seat row's click still
shows that seat's messages alone; each row gains a Timeline button that sets the atom, and the popover's body then
shows `counciltimeline.tsx` (the rows from `timelineRows`, commands in mono, newest at the bottom, Back to the list).
Evidence chips carry the claim's badge (Ran, Disproved, Read code, Guess, with icon and word) and a Wrong cite chip
shows its `citenote`: `EvidenceChips` (`councilsourcespanel.tsx`) takes the evidence items and the claim's label
instead of bare ref strings, its three call sites in `councilchat.tsx` pass them, and the Report's own `EvidenceChip`
(`councilsummary.tsx`) shows the same badge and Wrong cite; the chip model goes in `councilsources.ts`. Acceptance:
`council-discussion` gains steps that open a seat's timeline from the Seats popover (rows, a command in mono, Back)
and see a badge and a Wrong cite chip on a thread's evidence; `council-summary` gains a step that sees a badge and a
Wrong cite chip in the Report; `council-map` gains a step where a click on an expert card opens the Seats popover on
that seat's timeline. Test: `npx vitest run frontend/app/view/agents/councilsources.test.ts`.

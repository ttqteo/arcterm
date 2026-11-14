# Council bugs and UX: batch 2 (the rest)

**Effort:** effort:67d1c761-ccae-4498-8c85-50d0ab9a65dd
**Verify:** `node scripts/verify.mjs ./pkg/council/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs council-setup council-discussion council-summary council-tree`

The chunks of the initiative "Council: bugs and UX" still open on `main` at 4583fd9db that need code. Batch 1 (run
a9774e84) and the commits since closed 23. The lead closes these without a run, so no task here touches them:

- 15 (the job queue held every heavy job ~7 h at critical pressure): fixed by c03d3f5dc (11-04, critical starts the
  head once nothing runs, `pkg/jobqueue/jobqueue.go:360`) and by `runPlanCommand` taking its slot before Verify's
  20-minute timeout starts (`pkg/orchestrate/plancmd.go:348-353`).
- 6, 7, 11 and the rest of 12 belong to the agent-team council (`2026-10-22-council-agent-team-design.md`), which is not
  being built (Phase 0/0b no-go, v1 stays the council), and the bench's code-review cases are retired
  (`scripts/council-bench-cases.mjs:21`).

There is no spec: each task quotes the chunk it closes, and the chunk's label is the requirement. A worker ticks
nothing on the initiative; the lead does that after the run. After the run the lead also copies Final's
`council-report.png` into `docs/guide/images/` and rewrites its caption (Task 2 Step 2 only takes the shot).

Principles for every worker: the smallest change that fixes the chunk, one source of truth, no abstraction for one use.
Colors from `@theme` tokens only; UI follows `DESIGN.md`. Pure logic lives in a `.ts` beside its `.test.ts`; no render
tests. Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in front (AGENTS.md). Never
hand-edit generated files: change the Go type, then `task generate`.

## Review Focus

- Task 3: after a `council:changed`, every list atom and every open council's atom ends up exactly as a full reload
  would leave it (order, a council moving between projects, a delete, an event for a council no list holds yet).
- Task 1: a role with no focus phrase (a `councilroles.json` role, a suggested role) still reads by its name alone, and
  the coordinator never gets one in the line.

---

### Task 1: Setup's experts line says what each expert looks at
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/roles.go`, `pkg/council/roles_test.go`, `frontend/app/view/agents/councilsetupmodel.ts`, `frontend/app/view/agents/councilsetupmodel.test.ts`, `scripts/cdp/council/setup.mjs`, `CHANGELOG.md`, `frontend/types/gotypes.d.ts`

Plus whatever else `task generate` rewrites from the type change.

Closes: "Setup's experts line names experts, not what each looks at: roles need a short per-role phrase (Go) to show
it".

- [ ] **Step 1: A focus phrase per role (Go)**
  `CouncilExpert` (`pkg/council/types.go:55-72`) gets `Focus string \`json:"focus,omitempty"\`` and
  `FocusVi string \`json:"focusvi,omitempty"\``, commented as the 1-3 word phrase Setup shows after the name, set on
  stock roles only. In `builtInRoles` (`pkg/council/roles.go:27`) give every non-coordinator role both, drawn from its
  own `Brief`: e.g. `ux` "what's on screen" / "giao diện", `ram` "memory" / "bộ nhớ", `newuser` "a first visit" /
  "lần đầu dùng", `skeptic` "bugs" / "lỗi"; write the rest the same way, lower case, no full stop. Coordinators
  (`coordinator`, `areachair`, `facilitator`) get none. `roles_test.go`: a test that every built-in role that is not a
  coordinator has both phrases, each at most 3 words, and no coordinator has one. Run `task generate`.

- [ ] **Step 2: The line uses it**
  `expertsLine` (`councilsetupmodel.ts:782`): each non-coordinator expert reads `${name} (${focus})` with the phrase
  for the draft's language (`FocusVi` when `setupLang(draft)` is Vietnamese, as `seatName` picks the name), and the
  name alone when that phrase is empty. The rest of the sentence is unchanged. Tests in `councilsetupmodel.test.ts`:
  stock roles in English and in Vietnamese, a custom role with no focus, a single expert.

- [ ] **Step 3: Scenario**
  `setup.mjs`: update the experts-line regexes at ~:367, ~:386, ~:389 and ~:846 to the new text, and make one of them
  (the English one at ~:389) match the whole line exactly, so a dropped phrase fails.

- [ ] **Step 4: Changelog and commit**
  Under `## Unreleased` → `### Changed` in `CHANGELOG.md`: `A council's Setup says what each expert looks at, such as
  Memory watcher (memory).` Run `npx vitest run frontend/app/view/agents/councilsetupmodel.test.ts` and
  `go test ./pkg/council -run 'Role'`. Commit: `feat(council): Setup's experts line says what each expert looks at`.

### Task 2: Summarize with only drafts, a new Report shot, no overlapping tree rows
**Depends on:** none
**Files:** `scripts/cdp/council/discussion.mjs`, `scripts/cdp/council/summary.mjs`, `scripts/cdp/council/tree.mjs`, `frontend/app/view/agents/agenttree.tsx`

`agenttree.tsx` changes only if Step 3 finds a real overlap.

Closes three chunks:
- "Bug: Council Summarize greyed out in the app on a paused council (awaiting-you, proposals present) though
  canSummarize allows it (councilmodel.ts:445)". Since c5ca6fedd, `canSummarize` (`councilmodel.ts:1148`) needs a sent
  idea, and `summarizeHold` titles the off button "Send or drop the drafts first". The case with a sent idea among the
  drafts is already checked (`discussion.mjs:1695`); the drafts-only case is not.
- "Retake the Report image in docs/guide/council.md: caption and shot still show the old 'Outdated · 1 reply since'
  banner" (the image is `docs/guide/images/council-report.png`, caption at `docs/guide/council.md:286`; no scenario
  writes that file).
- "Tree draws two 'Rail apps · Done' rows overlapping right after a pinned council file is announced
  (council-report-pinned.png)". The tree's rows are `motion.div layout="position"` in an `AnimatePresence
  mode="popLayout"` (`agenttree.tsx:4111-4125`), so a pinned council sliding to the top crosses the rows above it; the
  shot at `tree.mjs:536` is taken right after `announceCouncil`, mid-slide.

No changelog line here (Task 1 owns `CHANGELOG.md`): if Step 3 changes the tree, say so in the commit body, and the
lead adds the `### Fixed` line after the run.

- [ ] **Step 1: Drafts only keep Summarize off**
  `discussion.mjs`, next to the step at ~:1695: with the room fixture edited so every proposal of the paused
  (awaiting-you) council is a held draft and none is sent, open the actions menu and assert
  `[data-council-summarize]` is disabled and its `title` is exactly `Send or drop the drafts first`. Label it
  `room waiting on drafts only: Summarize is off and says Send or drop the drafts first`.

- [ ] **Step 2: The guide's Report shot**
  `summary.mjs`: in the step that shoots `cdp-shots/council-summary.png` (~:651), or a step right after it on the same
  done council with the Report tab shown, its first card closed and the page scrolled to the top, also shoot
  `cdp-shots/council-report.png`. Assert, in that step, that no element's text contains `Outdated`.

- [ ] **Step 3: No two tree rows overlap once the tree settles**
  `tree.mjs`, step 11a: after `announceCouncil` (~:531), wait for the tree to settle (until two reads of every
  `[data-agent-row]`/`[data-council-row]` `getBoundingClientRect()` 100 ms apart are equal, at most 2 s), then assert
  no two visible rows' vertical ranges overlap by more than 1 px; record the pairs in the detail. Move the
  `council-report-pinned.png` shot after that wait. If the rows still overlap once settled, that is the bug: find why
  in `agenttree.tsx` (a row keyed differently in the pinned and unpinned lists is the first suspect; `pinnedRowsOf` /
  `councilRowsOf` in `agentsidebarmodel.ts:779-788`) and fix it there, with a model test if the cause is in a `.ts`.

- [ ] **Step 4: Commit**
  Commit: `test(council): drafts-only Summarize, the guide's Report shot, and settled tree rows never overlap` (or a
  `fix(agents): …` subject naming the overlap if Step 3 changed the tree).

### Task 3: A council change reloads that council, not every list
**Depends on:** none
**Files:** `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/councilstore.test.ts`, `frontend/app/view/agents/councillists.ts`, `frontend/app/view/agents/councillists.test.ts`

Closes: "Agent tree refetches every full council on each council:changed: add a summary-only list command for the
tree (RAM watch candidate)".

Decision: no summary command. `councilListAtom` feeds the tree, Conversation History (`councilhistory.ts`), the launcher,
the @ mentions (`refmentionstore.ts`) and `agentcenter.ts`, which read different fields, so a slimmer list would break
some of them. The waste is the reload itself: `subscribeCouncilChanged` (`councilstore.ts:52-77`) runs
`CouncilListCommand` for the event's project and for every council (`""`), each returning every full council, on every
event a running council sends (each reply). The event already names the one council that changed (`id`, `project`,
`deleted`).

- [ ] **Step 1: A pure splice**
  `councillists.ts`: `spliceCouncil(list: Council[], c: Council, project: string): Council[]` returns the list with
  `c` replaced in place, added if it belongs to `project` (`councilProjectKey` equal, or `project` is `""`) and is not
  there, and removed if it is there but no longer belongs. A new council goes where `CouncilListCommand` would put it:
  read the server's order in `pkg/wshrpc/wshserver/wshserver_council.go:184` (and the store's list function it calls)
  and use the same key. Tests for replace, add, move out of a project, and order.

- [ ] **Step 2: The store reloads one council**
  In the `council:changed` handler: `deleted` stays `forgetCouncil`. Otherwise `CouncilGetCommand` the one council
  (keep the per-id sequence guard `loadCouncil` has), set its `councilAtom` when it is known, and splice it into each
  known list (every `knownProjects` entry, not only the event's project and `""`: a council can move between projects)
  with `spliceCouncil`. A full `loadCouncils` happens only on a list's first read, as now. A failed get logs and falls
  back to `loadCouncils` for the lists that would hold it.

- [ ] **Step 3: Tests and commit**
  `councilstore.test.ts`: with `CouncilGetCommand` and `CouncilListCommand` mocked as the file already does, an event
  for a known council calls Get once and List not at all, and the lists match what a full reload would give; a delete
  still drops it everywhere. Run `npx vitest run frontend/app/view/agents/councilstore.test.ts
  frontend/app/view/agents/councillists.test.ts`. Commit:
  `perf(council): a council change reloads that council, not every council in every list`.

### Task 4: A bench team cell cleans its transcripts and kills its whole tree
**Depends on:** none
**Files:** `pkg/council/bench/team.go`, `pkg/council/bench/teamtokens.go`, `pkg/council/bench/team_test.go`, `pkg/council/verifyproc_windows.go`, `pkg/council/verifyproc_unix.go`

Closes two chunks:
- "Each team cell leaves its lead and teammate transcripts in ~/.claude/projects/; the runner removes only its temp
  copy"
- "A timed-out team lead is killed with exec.CommandContext, which does not reach grandchildren on Windows (low risk:
  Bash and MCP are off for the team)"

No user-facing change, so no changelog line.

- [ ] **Step 1: Remove the cell's transcripts once counted**
  The cell runs in its own `os.MkdirTemp` folder (`team.go:155`), so Claude Code keeps its sessions in one projects
  folder of its own under `claudeProjectsDir()` (`teamtokens.go:51`), named from that path the way `teamtokens.go`
  already finds it (~:59, :100-118). After the token count is done and before the function returns, remove that one
  folder; refuse (log, do nothing) if the folder resolved is `claudeProjectsDir()` itself or not directly under it.
  Log a failure as the temp folder's removal does (`team.go:159-163`). Test with a fake projects dir (the seam the
  token tests already use): the cell's folder is gone after the run, a sibling folder is untouched.

- [ ] **Step 2: Kill the lead's whole tree on timeout**
  `pkg/council/verifyproc_windows.go` already has `runTree`, which runs a command in a job object that kills its
  whole tree when the context ends, and `verifyproc_unix.go` its Unix twin. Export it (`RunTree`, both files, callers
  updated) and have `startLead` (`team.go:86-100`) run the lead through it instead of `cmd.Run()`, keeping
  `WaitDelay`. If `pkg/council/bench` cannot import `pkg/council` (an import cycle), move the two files into
  `pkg/util/proctree` instead and have both packages use it.

- [ ] **Step 3: Run and commit**
  `go test ./pkg/council/... -run 'Team|Verify'` passes. Commit:
  `fix(council-bench): a team cell removes its transcripts and kills its whole tree on timeout`.

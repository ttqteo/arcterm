# Kael sync (2026-11-12): Code review and peek, Diff comments, Usage Workflow lens, Setup sync

**Spec:** `docs/superpowers/specs/2026-11-12-kael-sync-code-diff-usage-setup-design.md` (read it whole before starting a task: its scope lists the fork commits, its "Out of scope" the hunks to drop, and its "Our code wins" section is the hard rule every task and reviewer applies)
**Verify:** `node scripts/verify.mjs ./pkg/wshrpc/... ./pkg/gitinfo/... ./pkg/agentsync/... ./pkg/usagestats/... ./pkg/wstore/... ./pkg/wcore/... ./pkg/jarvis/... ./pkg/orchestrate/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs code-outline code-review-send code-review-handoff code-peek code-fixes-markdown code-fixes-editor code-fixes-jumps code-fixes-toolbar code-fixes-session code-fixes-diff-states code-changed-walk diff-comments diff-scope diff-compare-refresh diff-file-states usage-workflow-lens usage-work setup-instructions-sync kael-keys`

This is a port of behaviour from the kaeltran16 fork (`kael/main`, `d0be5ee41`) into our shape, not a cherry-pick. Read
a commit with `git show <hash>`, a file at the fork's tip with `git show kael/main:<path>`, a fork spec with
`git show kael/main:docs/superpowers/specs/<file>`. Use `git cherry-pick -n` only where it applies cleanly.

## Rules every task follows

- **Our code wins** (spec section of that name). The port is additive: never rewrite, rename, remove or restyle an
  existing behaviour, component, binding, wire field or test of ours. Where the fork changes something of ours
  differently, ours stays and the fork's part is fitted around it or skipped. Adding new cases to an existing test file is
  fine; editing or deleting an existing case is not. A task reviewer treats any changed or removed existing behaviour of
  ours as a failure.
- Before porting a commit, check whether ours already does it (the 2026-11-03 and 2026-11-06 syncs and our own work ported
  some under other subjects). Every skipped commit or hunk, and why, goes into the task's commit message under a
  "Differs from plan:" paragraph.
- Drop every hunk the spec puts out of scope (Jira, session full-text search and the Sessions surface, remote mode, the
  Jarvis → Hub rename, the Brief layout, the Jarvis pet, the Radar removal, orchestrate engine changes).
- Prefer new files and small hook points over large edits to shared files of ours. Pure logic goes in a `foo.ts` with a
  `foo.test.ts` beside it (vitest), the view is a thin `foo.tsx`; keep the fork's tests, adapted to our names.
- Colours only from `@theme` tokens in `frontend/tailwindsetup.css`, motion from `frontend/app/element/motiontokens.ts`,
  UI per `DESIGN.md`. Never hand-edit a generated file. Only Task 1 changes wire types and runs `task generate`.
- **No task but Task 16 edits** `frontend/app/store/keybindings/bindings.ts`, `bindings.test.ts`, `store.test.ts`,
  `whenstate.ts`, `whenstate.test.ts`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md`, `docs/hand-checks.md` or
  `docs/open-issues.md`. A feature task instead **exports, under the fork's names, every function and atom that the
  fork's `bindings.ts` / `whenstate.ts` hunks of its commits import** (for example `startComment`, `codeReviewsAtom`, `codeReviewSendOpenAtom` from
  `codereviewstore.ts`; `usageLensAtom`, `usageWorkScopeAtom`, `usageWorkItemAtom` from `usagestore.ts`), and lists those
  names in its commit message; Task 16 wires the bindings.
- **No task but Task 1 edits** `scripts/cdp/scenarios.mjs` or `frontend/tailwindsetup.css`. Task 1 creates and registers
  one scenario module per task (below); a task fills only its own module. What a module needs that the kits lack it
  defines itself, as `scripts/cdp/scenarios-code-blame-draft.mjs` does; it never edits `scenarios.mjs` or an existing
  scenario. Each module must define exactly the scenario names its task names here, since the Final line runs them.
- A task's steps run only the focused tests that prove it (one vitest file, or `go test ./pkg/x -run '<names>'`); the
  merge's Verify and the final stage run the rest.

## Decisions this plan makes beyond the spec (and why)

1. **Wire fields first, in one small task (Task 1).** Groups 2, 3 and 4 each add Go wire fields (`wshrpctypes_git.go`,
   `wshrpctypes_projects.go`, `wshrpctypes_agents.go`, `wshrpctypes_agentsync.go`, `waveobj/wtype.go`), and each
   `task generate` rewrites `frontend/types/gotypes.d.ts`. One owner avoids generated-file collisions and lets the Go
   backends and the frontends run side by side. The fork adds only fields and types, no new RPC commands, so no stub
   handlers are needed.
2. **Keybindings and the user-facing docs land last, in one task (Task 16).** Every group's fork commits edit
   `bindings.ts` (3,100 lines) and its tests. Serialising those edits in one task keeps the lanes parallel. The fork's
   `when` stand-downs on existing Escape/Enter bindings for the Code peek are not ported: the peek card owns its keys
   the way our background-task peek does (`data-owns-keys`, `backgroundtaskpeek.tsx`), so no existing binding of ours
   changes for it (see decision 12).
3. **CSS rules and scenario module stubs land in Task 1.** Only new selectors are added to `tailwindsetup.css`
   (`.code-comment-marker`, `.diff-comment-plus` and its `> svg` / `:hover > svg`, `.diff-comment-range`,
   `[data-diff-new-file] …`), taken from the fork's tip; the fork's changes to existing rules (global scrollbar,
   `::-webkit-scrollbar-corner`, existing diff colours) restyle ours and are skipped.
4. **Lanes:** Code (Tasks 5 → 6 → 8 → 9, serial because they share `codesurface.tsx`, `codeviewer.tsx`, `codestore.ts`),
   Code peek (Task 7, beside them, joins at Task 8 which shares `codepeekcard.tsx`), Diff (Tasks 10 → 11 → 12, serial on
   `filessurface.tsx` / `diffpane.tsx`), Usage (Tasks 13 → 14), Setup (Task 15), and three Go backends (Tasks 2, 3, 4).
   Big fix sets are split into two tasks each so a task reviewer can judge one.
5. **The peek leaves `codestore.ts` alone.** The fork moved `NOT_TRACKED` and added `HEAD_BINARY` / `HEAD_TOOLARGE` to
   `codeclassify.ts`; Task 7 adds them there and Task 8 (which owns `codestore.ts`) points `codestore.ts`'s literal
   messages at them, keeping the strings identical.
6. **`MonacoInsertedText` (a93db601c) goes in a new `frontend/app/monaco/monaco-inserted.tsx`**, created by Task 7
   (the peek card draws a new file with it) and only used by Task 9 (Code's Diff view), built on the exported
   `MonacoCodeEditor`, so `monaco-react.tsx` keeps one owner chain (Tasks 10 → 12). It uses Monaco's own
   `line-insert` / `gutter-insert` classes.
7. **The fork's `000026_sessioneffort` migration becomes `000027_sessioneffort`**: ours already has `000026_xmastask`.
8. **Skipped infra hunks:** `eslint.config.js` (73e5e44b5) and `scripts/cdp/final-verify.mjs` (0d1404f44) change how our
   lint and Final behave; neither is a feature of the four groups.
9. **Usage surface layout commits** `b71bbd99c` (drops our Live limits section) and `e636caf9c` (moves our filters):
   take only their additive parts (a provider's quota also on its scope card); removing or moving our sections is
   skipped under "Our code wins".
10. **Setup:** ours has the Instructions tab inline in `setupsurface.tsx` (no `setupinstructions.tsx`). Task 15 puts the
    fork's Instructions additions in a new `setupinstructionsync.tsx` with a small hook point in `setupsurface.tsx`.
11. **The terminal path links:** ours already links paths in the terminal (`termwrap.ts` `pathHooks` →
    `term/termpathlinks.ts` `makePathLinkProvider` → `agents/pathlinkroute.ts` `openPathFromTerminal`, which opens the
    agent panel or Code, and resolves `~` through `homeDir`). The fork's peek hangs off its own `FileLinkHandler` /
    `termfilelinks.ts`, which ours lacks. The peek is ported onto our link provider: no `termfilelinks.ts`; the parts of
    `294cde415` / `a93db601c` ours lacks (…-shortened paths left unlinked, extensionless paths) go into
    `agents/pathlinks.ts` with tests in `pathlinks.test.ts`, and only where every existing `pathlinks.test.ts` case
    passes unchanged (a path ours links today stays linked); the `~` part is skipped where ours already resolves it.
12. **The peek gesture is Ctrl+Shift+click (Cmd+Shift+click on a Mac) on a linked path; Ctrl+click is unchanged.** Ours
    gives Ctrl+click to opening the path (agent panel or Code), and that stays. Today Ctrl+Shift+click only repeats
    Ctrl+click (`isOpenGesture` reads Ctrl/Cmd alone), so it is the one free gesture on a link: `makePathLinkProvider`'s
    `activate` calls a new optional `hooks.peek(ref, e)` when Shift is also held and a peek host is attached, and
    otherwise calls `hooks.activate(ref)` exactly as now. Alt+click is not used: xterm's default `altClickMovesCursor`
    sends arrow keys to the agent. The hover hint names both gestures. Inside the card, Escape closes it and Enter opens
    the file in Code, handled by the card itself under `data-owns-keys` (as `backgroundtaskpeek.tsx` does), so the Agent
    surface's Escape stands down while focus is in the card and Escape in the terminal still reaches the agent.
13. **Go behaviour changes in Task 2 are skipped:** `8d51edfdb`'s HistoryLog dropping `refs/stash`
    (`TestHistoryLogExcludesStash`) and `0d1404f44`'s keeping R/C letters plus a source path in `nameStatusToStatusZ`
    (instead of collapsing to `M`) change what existing callers of ours get. Both are skipped, with the frontend rename
    hunks of `0d1404f44` that depend on them; the run report lists them for the owner to decide.
14. **Wire names follow ours:** the fork's usage directory type `UsageSession` is our `UsageSessionMeta` (ours has a
    different `UsageSession`); the fork's agentsync `DryRun` goes on `CommandAgentSyncAdoptRtnData` (ours already has
    one on the apply data); `Linked` is tagged `json:"linked,omitempty"` so our existing `skillsmatrix.test.ts` data
    (which builds the reply without it) still typechecks, and readers treat a missing `linked` as empty.
15. **RAM of the two new long-lived views is measured by a scenario, not left to a hand check:** `code-peek` and
    `diff-scope` read the page's JS heap (CDP `HeapProfiler.collectGarbage`, then `Runtime.getHeapUsage`) before opening
    the view, while open, and after closing it, report the three numbers in the step's detail, and fail when the
    after-close heap exceeds the before figure by more than 5 MB. Task 16 records the views, what they keep resident and
    where the numbers are reported under "RAM watch".

## Scenario modules (created empty by Task 1, filled by their task)

Each is `export default function (kits) { return [ …scenarios ]; }`, called in `scenarios.mjs` with
`KAEL_KITS = { rt: RT_KIT, code: CODE_KIT, files: FILES_KIT, jarvis: JARVIS_KIT }`.

| Module | Task | Scenario names |
|---|---|---|
| `scripts/cdp/scenarios-code-outline.mjs` | 5 | `code-outline` |
| `scripts/cdp/scenarios-code-review.mjs` | 6 | `code-review-send`, `code-review-handoff` |
| `scripts/cdp/scenarios-codepeek.mjs` | 7 | `code-peek` |
| `scripts/cdp/scenarios-code-fixes-view.mjs` | 8 | `code-fixes-markdown`, `code-fixes-editor`, `code-fixes-jumps`, `code-fixes-toolbar` |
| `scripts/cdp/scenarios-code-fixes-session.mjs` | 9 | `code-fixes-session`, `code-fixes-diff-states`, `code-changed-walk` |
| `scripts/cdp/scenarios-diff-comments.mjs` | 10 | `diff-comments` |
| `scripts/cdp/scenarios-diff-scope.mjs` | 11 | `diff-scope`, `diff-compare-refresh` |
| `scripts/cdp/scenarios-diff-states.mjs` | 12 | `diff-file-states` |
| `scripts/cdp/scenarios-usage-lens.mjs` | 13 | `usage-workflow-lens` |
| `scripts/cdp/scenarios-usage-work.mjs` | 14 | `usage-work` |
| `scripts/cdp/scenarios-setup-instructions.mjs` | 15 | `setup-instructions-sync` |
| `scripts/cdp/scenarios-kael-keys.mjs` | 16 | `kael-keys` |

The fork's own scenario steps (in its `scenarios-code*.mjs`, `scenarios-codepeek.mjs`, `scenarios-files*.mjs`,
`scenarios-usage.mjs`, `scenarios-setup-instructions.mjs`, and the hunks it added to its `scenarios.mjs`) are the source
for each module's steps, adapted to our kits and seeds. Steps that press a key the task does not bind move to Task 16's
`kael-keys`.

### Task 1: Wire fields, CSS rules and scenario module stubs
**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_git.go`, `pkg/wshrpc/wshrpctypes_projects.go`, `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshrpctypes_agentsync.go`, `pkg/waveobj/wtype.go`, `frontend/types/gotypes.d.ts`, `frontend/tailwindsetup.css`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-code-outline.mjs`, `scripts/cdp/scenarios-code-review.mjs`, `scripts/cdp/scenarios-codepeek.mjs`, `scripts/cdp/scenarios-code-fixes-view.mjs`, `scripts/cdp/scenarios-code-fixes-session.mjs`, `scripts/cdp/scenarios-diff-comments.mjs`, `scripts/cdp/scenarios-diff-scope.mjs`, `scripts/cdp/scenarios-diff-states.mjs`, `scripts/cdp/scenarios-usage-lens.mjs`, `scripts/cdp/scenarios-usage-work.mjs`, `scripts/cdp/scenarios-setup-instructions.mjs`, `scripts/cdp/scenarios-kael-keys.mjs`

Wire fields (Go is the source of truth; then `task generate`):
- From `186f6e101`: `Worktree bool json:"worktree,omitempty"` on the git file-read request (reads the file on disk under
  Cwd; Ref ignored), `End string json:"end,omitempty"` on the git log/changes request (with Ref lists only Ref..End),
  `HasRemote bool json:"hasremote,omitempty"` on the project/git reply. Put each on the struct the fork put it on;
  find ours by the same command.
- From `44e2c54b1`: `NumstatError string json:"numstaterror,omitempty"` on `CommandGitChangesRtnData`.
- From `7bf83577a`: `BrainstormLead string json:"brainstormlead,omitempty"` where the fork put it in `wtype.go`; on our
  `UsageSessionMeta` (the fork's `UsageSession`; decision 14) `TaskTitle`, `RunChunk`, `Effort`, `LeadHarness`,
  `LeadSession`, `ProjectName` (json names as the fork's), and `Efforts []UsageEffort json:"efforts,omitempty"` with
  the new `UsageEffort{OID, Title}` type on the usage reply.
- From `feb98d599`: on agentsync types `NoteTone`, `Skip []string`, `Vault`, `DryRun` (on
  `CommandAgentSyncAdoptRtnData`), the `AgentSyncKeepVault` const, the `AgentSyncSkillLink` type and the
  `Linked []AgentSyncSkillLink json:"linked,omitempty"` field (omitempty, decision 14), and the `linked` state named in
  the `States` comment.
- Only additions: no existing field is renamed, retyped or re-tagged (re-aligning gofmt whitespace is fine). If `task
  generate` rewrites more generated files than `gotypes.d.ts`, commit them too and name them in the commit message.

CSS (decision 3): append the fork tip's rules for `.monaco-editor .code-comment-marker`, `.monaco-editor
.diff-comment-plus`, `.diff-comment-plus > svg`, `.diff-comment-plus:hover > svg`, `.monaco-editor .diff-comment-range`,
`[data-diff-new-file] .monaco-diff-editor`, `[data-diff-new-file] .monaco-editor` and `[data-diff-new-file]
.original-in-monaco-diff-editor .line-numbers` (`git show kael/main:frontend/tailwindsetup.css`, lines ~300–345),
using tokens only (the fork's `color-mix` of two tokens is fine). Change no existing rule.

Scenario stubs: create the twelve modules in the table above, each returning `[]` with a header comment naming its task
and fork sources, define `KAEL_KITS` beside the other kits in `scenarios.mjs`, import each module and spread
`...module(KAEL_KITS)` into the scenario list before `agentComposer`, which must stay last.

Acceptance: `go build ./...` passes; `go test ./pkg/wshrpc/... -run 'XXX_none'` compiles the package;
`task check:ts` passes; `node -e "import('./scripts/cdp/scenarios.mjs')"` (or how `scripts/cdp/verify.mjs` loads it)
loads without error and the scenario count is unchanged; `git diff main -- frontend/tailwindsetup.css` shows only added
lines.

### Task 2: Git backend for Diff: worktree reads, bounded changes, hasremote, numstat errors, renames
**Depends on:** Task 1 (serves the wire fields it adds)
**Files:** `pkg/gitinfo/gitinfo.go`, `pkg/gitinfo/gitinfo_test.go`, `pkg/wshrpc/wshserver/wshserver_git.go`, `pkg/wshrpc/wshserver/wshserver_projects.go`

Port the Go parts of `8d51edfdb` (worktree file read, capped; changes bounded by End; HasRemote; an unborn HEAD's
history) and `44e2c54b1` (a failed `diff --numstat` keeps the file list and reports NumstatError). Serve the Task 1
fields. Skip the stash exclusion of `8d51edfdb` and all of `0d1404f44`'s rename hunks in `gitinfo.go` and
`jarvis/evidence.go` (decision 13). Existing gitinfo behaviour for requests that leave the new fields unset is
unchanged.

Acceptance: `go test ./pkg/gitinfo -run '^(TestFileInWorktree|TestGetChangesTo|TestHasRemote|TestHistoryLogUnbornHead|TestGetChangesLiveModeNumstatFailureKeepsList)$'`
passes (on Windows with the cgo env from AGENTS.md), ported from the fork; our existing tests in these files are
untouched and pass.

### Task 3: Usage attribution backend: roles, task/chunk/effort/lead/project, initiative kept after a tab closes
**Depends on:** Task 1 (serves the wire fields it adds)
**Files:** `pkg/wshrpc/wshserver/usagesessions.go`, `pkg/wshrpc/wshserver/usagesessions_test.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `pkg/wshrpc/wshserver/wshserver_brainstorm.go`, `pkg/wshrpc/wshserver/wshserver_brainstorm_test.go`, `pkg/orchestrate/stagesession.go`, `pkg/orchestrate/stagesession_test.go`, `pkg/usagestats/pi.go`, `pkg/usagestats/usagestats.go`, `pkg/usagestats/usagestats_test.go`, `db/migrations-wstore/000027_sessioneffort.up.sql`, `db/migrations-wstore/000027_sessioneffort.down.sql`, `pkg/wstore/wstore_sessioneffort.go`, `pkg/wstore/wstore_sessioneffort_test.go`, `pkg/wcore/workspace.go`

Port `17759a7cd` (a brainstorm judge's session carries its role), `75c5a9c0b` (the session directory fills TaskTitle,
RunChunk, Effort, LeadHarness/LeadSession, ProjectName and the reply's Efforts) and `9444377ac` (a session keeps its
initiative after its tab closes: a small sessioneffort table, migration numbered 000027 per decision 7). Skip
`530ef1733` (ported). In `pkg/orchestrate` only the attribution that `stagesession.go` records changes; no engine
behaviour. Check our existing attribution first: the 2026-11-06 sync ported some.

Acceptance (tests ported from the fork, adapted to `UsageSessionMeta`):
`go test ./pkg/wshrpc/wshserver -run '^(TestUsageSessionsBrainstormSession|TestLaunchJudgingSessionRecordsTheLead|TestUsageSessionsRunEffort|TestUsageSessionsTabEffort|TestUsageSessionsEffortTitles|TestUsageSessionsProjectName|TestBrainstormLaunchRecordsTheLead|TestUsageCountsClosedTabSessionInEffort)$'`,
`go test ./pkg/orchestrate -run '^TestSessionIdOf$'`, `go test ./pkg/usagestats -run '^TestRepoRootFoldsALinkedWorktree$'`
and `go test ./pkg/wstore ./pkg/wcore -run '^(TestDeleteTabPersistsSessionEffort|TestRecordTabSessionEffortUpserts|TestRecordTabSessionEffortSkipsNoTranscript)$'`
pass (each test in the package the fork put it in); the migration applies on a fresh store (the wstore test opens one).

### Task 4: Agentsync: links, stray vault copies, skip, blank doc, note tone, dry run
**Depends on:** Task 1 (serves the wire fields it adds)
**Files:** `pkg/agentsync/adopt.go`, `pkg/agentsync/adopt_test.go`, `pkg/agentsync/agentsync.go`, `pkg/agentsync/skills.go`, `pkg/agentsync/skills_test.go`, `pkg/agentsync/status.go`, `pkg/agentsync/status_test.go`, `pkg/agentsync/steering.go`, `pkg/agentsync/steering_test.go`, `pkg/wshrpc/wshserver/wshserver_agentsync.go`, `pkg/wshrpc/wshserver/wshserver_agentsync_test.go`

Port `27d06199b` onto our agentsync, serving the Task 1 fields: dangling links reported as Linked (never null on the
wire), stray vault copies (Vault, keep "vault"), Skip names left alone, a blank shared doc reads `blank`, NoteTone set
by the backend, DryRun snapshots. A sync request that sets none of the new fields behaves as today. `e4fe34382` is
skipped: it only edits the initiatives skill's "Made from <KEY>" (Jira key) line, which ours does not have.

Acceptance (tests ported from the fork): `go test ./pkg/agentsync -run '^(TestPlanAdoptSkipsLinks|TestPlanAdoptMarksVaultCopy|TestAdoptLeavesVaultCopyByDefault|TestAdoptKeepVaultSetsCopyAside|TestClaimKeptVaultOnlyForVaultSkills|TestAdoptSkipList|TestObserveSkillsLinkedEntry|TestObserveSkillsDanglingLink|TestReconcileNeverWritesThroughLink|TestSkillRowsLinkedState|TestSkillLinksListsNonVaultLinks|TestPiNoteTone|TestSteeringStateBlank)$'`
and `go test ./pkg/wshrpc/wshserver -run '^(TestAgentSyncAdoptPassesSkip|TestAgentSyncAdoptDryRunUnderSnapshot|TestAgentSyncSkillsLinkedNeverNull|TestAgentSyncStatusMapsNoteTone|TestKeepVaultMatchesWire)$'`
pass (each test in the package the fork put it in).

### Task 5: Code: symbols outline, @ in the finder, go to definition and find references
**Depends on:** Task 1
**Files:** `frontend/app/view/code/codelang.ts`, `frontend/app/view/code/codelang.test.ts`, `frontend/app/view/code/codeoutline.ts`, `frontend/app/view/code/codeoutline.test.ts`, `frontend/app/view/code/codesymbolquery.ts`, `frontend/app/view/code/codesymbolquery.test.ts`, `frontend/app/view/code/codesymbolspane.tsx`, `frontend/app/view/code/codefinder.ts`, `frontend/app/view/code/codefinder.test.ts`, `frontend/app/view/code/codesearchpane.tsx`, `frontend/app/view/code/codesearchstore.ts`, `frontend/app/view/code/codesidebar.ts`, `frontend/app/view/code/codesidebar.test.ts`, `frontend/app/view/code/codeside.ts`, `frontend/app/view/code/codeside.test.ts`, `frontend/app/view/code/codesidepane.tsx`, `frontend/app/view/code/codeeditorarea.tsx`, `frontend/app/view/code/codestore.ts`, `frontend/app/view/code/codesurface.tsx`, `frontend/app/view/code/codeviewer.tsx`, `frontend/app/cockpit/command-palette.tsx`, `frontend/app/cockpit/palette-groups.ts`, `frontend/app/cockpit/palette-rows.tsx`, `frontend/app/view/agents/agents.tsx`, `scripts/cdp/scenarios-code-outline.mjs`

Port `1349eedb2` minus its bindings and keyboard-doc hunks (Task 16): the outline of the open file's symbols in the Code
side column (ours mounts the side column through `codeside.ts` / `codesidepane.tsx` and the path bar, stale bar and
viewer from `codeeditorarea.tsx`, not `codesurface.tsx`: hook in there), `@` in the finder searching symbols, go to definition and find references from the editor, and the palette
seed (`paletteSeedAtom`) the `@` binding uses. Export the functions and atoms its `bindings.ts` hunk imports.
Fork spec: `2026-10-28-code-surface-improvements-design.md`.

Acceptance: `npx vitest run frontend/app/view/code/codeoutline.test.ts frontend/app/view/code/codesymbolquery.test.ts frontend/app/view/code/codelang.test.ts frontend/app/view/code/codefinder.test.ts frontend/app/view/code/codesidebar.test.ts`
passes. Scenario `code-outline` opens a seeded file in Code, shows the outline pane listing its symbols (shot), clicks a
symbol and asserts the editor's line moved to it, types `@` plus a symbol name in the finder and asserts the symbol row,
and runs go to definition from the editor's context menu and asserts the jump.

### Task 6: Code: review comments sent to an agent, review list, persisted reviews, honest handoffs
**Files:** `frontend/app/view/code/codereview.ts`, `frontend/app/view/code/codereview.test.ts`, `frontend/app/view/code/codereviewstore.ts`, `frontend/app/view/code/codereviewstore.test.ts`, `frontend/app/view/code/codereviewbar.tsx`, `frontend/app/view/code/codeagentpicker.tsx`, `frontend/app/view/code/codepathbar.tsx`, `frontend/app/view/code/codesurface.tsx`, `frontend/app/view/code/codeeditorarea.tsx`, `frontend/app/view/code/codeviewer.tsx`, `frontend/app/view/code/codeblamestore.ts`, `frontend/app/view/code/codehandoff.test.ts`, `frontend/app/view/code/codeviewmode.ts`, `frontend/app/view/code/codeviewmode.test.ts`, `scripts/cdp/scenarios-code-review.mjs`

Port `f8f185178` and `3016f8235` minus bindings and keyboard-doc hunks: comment on lines in the Code editor (the
`.code-comment-marker` bar from Task 1's CSS), the review bar, pick an agent and Send review as one message, the
review list, reviews persisted per file, and the honest handoff wording. Our existing `codehandoff.ts` behaviour stays;
add the fork's cases to `codehandoff.test.ts` only where they test new behaviour. Export what its bindings hunks import
(`startComment`, `codeReviewsAtom`, `codeReviewSendOpenAtom`, …). Fork specs: `2026-10-28-code-surface-improvements-design.md`,
`2026-11-05-code-review-fixes-design.md`.

Acceptance: `npx vitest run frontend/app/view/code/codereview.test.ts frontend/app/view/code/codereviewstore.test.ts frontend/app/view/code/codeviewmode.test.ts frontend/app/view/code/codehandoff.test.ts`
passes. Scenario `code-review-send`: add a comment on a line range through the editor's context menu (shot of the
marker and the bar), open the agent picker, send to a fixture agent and assert the message the agent received holds the
file, the lines and the comment. Scenario `code-review-handoff`: a saved review survives closing and reopening Code
(shot of the review list), and sending to an agent that cannot take it shows the handoff's failure text.

### Task 7: Terminal Code peek
**Depends on:** Task 1
**Files:** `frontend/app/view/code/codeclassify.ts`, `frontend/app/view/code/codeclassify.test.ts`, `frontend/app/view/code/codepeekmodel.ts`, `frontend/app/view/code/codepeekmodel.test.ts`, `frontend/app/view/code/codepeekstore.ts`, `frontend/app/view/code/codepeekstore.test.ts`, `frontend/app/view/code/codepeekcard.tsx`, `frontend/app/view/code/codepeekhost.tsx`, `frontend/app/monaco/monaco-inserted.tsx`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/pathlinks.ts`, `frontend/app/view/agents/pathlinks.test.ts`, `frontend/app/view/term/termpathlinks.ts`, `frontend/app/view/term/term.tsx`, `frontend/app/view/term/termwrap.ts`, `frontend/app/view/term/term-tooltip.tsx`, `scripts/cdp/scenarios-codepeek.mjs`

Port `8216f5927`, `e7cae9a2c`, `6c717bf51`, `9f979e412` and `8962d9efb` (as card-owned keys, decision 12),
`294cde415` (…-shortened paths left unlinked; `~` only where ours lacks it), `19e16133d` (binary MIME wins over size;
images hinted) and the peek and link parts of `a93db601c` (extensionless paths; a new file drawn through the
`MonacoInsertedText` this task creates in `monaco-inserted.tsx`, decision 6). Decision 5: `NOT_TRACKED`, `HEAD_BINARY`,
`HEAD_TOOLARGE` go in `codeclassify.ts`; `codestore.ts` is not edited here. Decisions 11 and 12 for the links and the
gesture: no `termfilelinks.ts`, our link provider gains an optional `peek` hook, and Ctrl+click keeps opening the path.
The host mounts under each agent's `CockpitFocusPane` through a context provider without re-parenting or conditionally
rendering the pane (AGENTS.md's terminal-stack rule): the pane's xterm must not remount. `TermTooltip`'s new
`placement` prop defaults to today's `top-start`. The card's Escape and Enter are handled in the card under
`data-owns-keys`; no binding is added for them. Note in the commit message what the peek keeps resident while closed.

Acceptance: `npx vitest run frontend/app/view/code/codepeekmodel.test.ts frontend/app/view/code/codepeekstore.test.ts frontend/app/view/code/codeclassify.test.ts frontend/app/view/agents/pathlinks.test.ts`
passes, every existing `pathlinks.test.ts` case unchanged. Scenario `code-peek`, in order: a fixture agent's terminal
prints file paths; Ctrl+click on one still opens it as today (agent panel or Code, as `openPathFromTerminal` routes it;
assert that and that no card opened); Ctrl+Shift+click on a path opens the card beside the terminal (shot) showing the
file's text; a binary file shows the binary hint and an image the image hint; a new (uncommitted) file draws with no
removed line; with focus in the card Enter opens the file in Code; reopen it, and Escape closes it; with the card open
and focus in the terminal, Escape leaves the card open; the terminal's xterm element is the same node throughout; and
the heap step of decision 15 (before open, open, after close; fails past +5 MB).

### Task 8: Code fixes, view: markdown preview, editor menu, view-mode toggle, jumps
**Depends on:** Task 6, Task 7
**Files:** `frontend/app/view/code/codeviewer.tsx`, `frontend/app/view/code/codestore.ts`, `frontend/app/view/code/codestore.test.ts`, `frontend/app/view/code/codesurface.tsx`, `frontend/app/view/code/codeeditorarea.tsx`, `frontend/app/view/code/codeoutline.ts`, `frontend/app/view/code/codeoutline.test.ts`, `frontend/app/view/code/codepathbar.tsx`, `frontend/app/view/code/codepeekcard.tsx`, `frontend/app/view/code/codeviewmode.ts`, `frontend/app/view/code/codeviewmode.test.ts`, `frontend/app/view/code/codelink.ts`, `frontend/app/view/code/codelink.test.ts`, `frontend/app/view/code/codependingjump.ts`, `frontend/app/view/code/codependingjump.test.ts`, `frontend/app/element/markdown-util.ts`, `frontend/app/element/markdown-util.test.ts`, `frontend/app/element/markdown.tsx`, `frontend/app/element/markdown.scss`, `frontend/app/cockpit/palette-files.ts`, `frontend/app/cockpit/palette-files.test.ts`, `scripts/cdp/scenarios-code-fixes-view.mjs`

Port `10dd2d3ca` (minus its open-issues hunk), `c24d4be5a`, `660560fd6`, `4de5b24f8`, `be83424f2`, `c50a510c0`,
`f2b39e1a7` and the matching steps of `783bd000c`. Point `codestore.ts`'s committed-copy messages at Task 7's
`HEAD_BINARY` / `HEAD_TOOLARGE` with the same text (decision 5). Markdown changes are additive to the shared markdown
renderer: every other markdown view of ours renders as before. Fork spec: `2026-11-05-code-review-fixes-design.md`.

Acceptance: `npx vitest run frontend/app/view/code/codestore.test.ts frontend/app/view/code/codeoutline.test.ts frontend/app/view/code/codeviewmode.test.ts frontend/app/view/code/codelink.test.ts frontend/app/view/code/codependingjump.test.ts frontend/app/element/markdown-util.test.ts frontend/app/cockpit/palette-files.test.ts`
passes. Scenarios: `code-fixes-markdown` (a markdown doc's relative image renders in the preview, front matter shows,
a large file opens without the Opening… flash, a heading row in the outline scrolls the preview to it; shot each);
`code-fixes-editor` (the editor's context menu offers Comment and Copy path; an image file renders); `code-fixes-jumps`
(a palette jump to `file:line` lands on that line; a folder link and an anchor link in the preview work);
`code-fixes-toolbar` (the view-mode toggle switches source and preview; long markdown does not overflow).

### Task 9: Code fixes, session: keep the session, tree, diff states, deleted files, Changed pane walk
**Files:** `frontend/app/view/code/codestore.ts`, `frontend/app/view/code/codestore.test.ts`, `frontend/app/view/code/codesurface.tsx`, `frontend/app/view/code/codeeditorarea.tsx`, `frontend/app/view/code/codeviewer.tsx`, `frontend/app/view/code/codestalebar.tsx`, `frontend/app/view/code/codetree.ts`, `frontend/app/view/code/codetree.test.ts`, `frontend/app/view/code/codeworktrees.ts`, `frontend/app/view/code/codeworktrees.test.ts`, `frontend/app/view/code/codetreepane.tsx`, `frontend/app/view/code/codemutate.ts`, `frontend/app/view/code/codemutate.test.ts`, `frontend/app/view/code/codedraft.ts`, `frontend/app/view/code/codedraft.test.ts`, `frontend/app/view/code/codefollow.ts`, `frontend/app/view/code/codefollow.test.ts`, `frontend/app/view/code/codedifftarget.ts`, `frontend/app/view/code/codedifftarget.test.ts`, `frontend/app/view/code/codediffview.tsx`, `frontend/app/view/code/codechangedpane.tsx`, `frontend/app/view/agents/surfacecontext.ts`, `frontend/app/view/agents/surfacecontext.test.ts`, `scripts/cdp/scenarios-code-fixes-session.mjs`

Port `3ac8d932b`, `5f16e421b`, `c3d985bb6`, `a857dd852`, `7f95de490` (the Changed pane's keyboard walk: export what
a binding needs; the pane's own focused-element key handling, if the fork keeps it in the pane, stays here) and the
Diff part of `a93db601c` per decision 6 (a new file in Code's Diff view draws with no removed line, using Task 7's
`monaco-inserted.tsx` without editing it). Skip `4c026402d`'s binding hunks (Task 16 binds `d` in a plain folder and
Alt+arrows from the editor). Skip `ff2540f33` (ported).

Acceptance: `npx vitest run frontend/app/view/code/codestore.test.ts frontend/app/view/code/codetree.test.ts frontend/app/view/code/codeworktrees.test.ts frontend/app/view/code/codemutate.test.ts frontend/app/view/code/codedraft.test.ts frontend/app/view/code/codefollow.test.ts frontend/app/view/code/codedifftarget.test.ts frontend/app/view/agents/surfacecontext.test.ts`
passes. Scenarios: `code-fixes-session` (the picked project and open file survive a refresh and a re-pick; the picker
closes on an outside click; an unsaved draft shows its mark; Code follows a project picked in the app bar (codefollow);
a duplicate name in a session folder is refused);
`code-fixes-diff-states` (a deleted file, the diff header's picks, compare with disk, and a new file's Diff with no
removed line; shot each); `code-changed-walk` (focus the Changed pane, ArrowDown/ArrowUp move the row cursor and Enter
opens the row, if the pane handles its own keys; otherwise this scenario clicks rows and the key steps go to `kael-keys`).

### Task 10: Diff comments: comment on the diff's lines and send them to an agent
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/diffcomments.ts`, `frontend/app/view/agents/diffcomments.test.ts`, `frontend/app/view/agents/diffcommentmodel.ts`, `frontend/app/view/agents/diffcommentmodel.test.ts`, `frontend/app/view/agents/diffcommentlayer.ts`, `frontend/app/view/agents/diffcommentcard.tsx`, `frontend/app/view/agents/commentprompt.ts`, `frontend/app/view/agents/commentprompt.test.ts`, `frontend/app/view/agents/commentsend.ts`, `frontend/app/view/agents/commentsend.test.ts`, `frontend/app/view/agents/commentsendbar.tsx`, `frontend/app/view/agents/diffcontentstore.ts`, `frontend/app/view/agents/diffcontentstore.test.ts`, `frontend/app/view/agents/diffcontent.ts`, `frontend/app/view/agents/diffcontent.test.ts`, `frontend/app/view/agents/diffoptions.ts`, `frontend/app/view/agents/diffoptions.test.ts`, `frontend/app/view/agents/diffpane.tsx`, `frontend/app/view/agents/filessurface.tsx`, `frontend/app/view/agents/changedfilelist.tsx`, `frontend/app/view/agents/reviewmarks.test.ts`, `frontend/app/view/agents/githistorystore.ts`, `frontend/app/view/agents/githistorystore.test.ts`, `frontend/app/view/agents/gitstatus.ts`, `frontend/app/view/agents/gitstatus.test.ts`, `frontend/app/monaco/monaco-react.tsx`, `docs/diff-tab.md`, `scripts/cdp/scenarios-diff-comments.mjs`

Port `1f397273f`, `07b1ff962`, `d6dbf519f`, `3baf6632f` (minus bindings and keyboard-doc hunks), `22ff2cb3f`,
`73e5e44b5` (minus `eslint.config.js`, decision 8), the frontend part of `0d1404f44` (its Go rename part is skipped by
decision 13, and so are its frontend hunks that rely on R/C statuses and source paths; its `final-verify.mjs` hunk is
skipped, decision 8), and `a08c22835` (wait to send while the agent is asking). `monaco-react.tsx`'s diff
`onMount` gains the `monaco` argument as an optional second parameter, so every existing caller is unchanged. Comments
are pending until sent, anchored to the HEAD sha for working-tree diffs, and a comment added during a send is kept.
`docs/diff-tab.md` is new: describe the Diff surface's comments for a user. Fork spec: `2026-10-26-diff-comments-design.md`.

Acceptance: `npx vitest run frontend/app/view/agents/diffcomments.test.ts frontend/app/view/agents/diffcommentmodel.test.ts frontend/app/view/agents/commentprompt.test.ts frontend/app/view/agents/commentsend.test.ts frontend/app/view/agents/diffcontentstore.test.ts frontend/app/view/agents/diffcontent.test.ts frontend/app/view/agents/diffoptions.test.ts frontend/app/view/agents/reviewmarks.test.ts frontend/app/view/agents/githistorystore.test.ts frontend/app/view/agents/gitstatus.test.ts`
passes. Scenario `diff-comments`: in Diff on a seeded repo, hover a line and click the glyph-margin `+` (shot of the
`+`), write a comment on a line range (shot of the card and the range bar), the file row shows a comment badge, the send
bar names the recipient agent, sending delivers one message holding each file, line range and comment to a fixture
agent and clears the pending comments, and with the agent asking a question the send waits and says so.

### Task 11: Diff review fixes: range, history overlay and rail, source states, landed runs, compare refresh
**Files:** `frontend/app/view/agents/diffcontent.ts`, `frontend/app/view/agents/diffcontent.test.ts`, `frontend/app/view/agents/difflayout.ts`, `frontend/app/view/agents/difflayout.test.ts`, `frontend/app/view/agents/diffscope.ts`, `frontend/app/view/agents/diffscope.test.ts`, `frontend/app/view/agents/gitgraphgeom.ts`, `frontend/app/view/agents/gitgraphgeom.test.ts`, `frontend/app/view/agents/historypane.tsx`, `frontend/app/view/agents/historyquery.ts`, `frontend/app/view/agents/historyquery.test.ts`, `frontend/app/view/agents/historyrows.ts`, `frontend/app/view/agents/historyrows.test.ts`, `frontend/app/view/agents/historyrail.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/diffsource.ts`, `frontend/app/view/agents/diffsource.test.ts`, `frontend/app/view/agents/sourcepicker.tsx`, `frontend/app/view/agents/changedfilelist.tsx`, `frontend/app/view/agents/commitpane.tsx`, `frontend/app/view/agents/diffpane.tsx`, `frontend/app/view/agents/filessurface.tsx`, `frontend/app/view/agents/agentdiffnav.ts`, `frontend/app/view/agents/agentdiffnav.test.ts`, `frontend/app/view/agents/filesstore.ts`, `frontend/app/view/agents/filesstore.test.ts`, `frontend/app/view/agents/githistorystore.ts`, `frontend/app/view/agents/githistorystore.test.ts`, `frontend/app/view/agents/comparestore.ts`, `frontend/app/view/agents/comparestore.test.ts`, `frontend/app/view/agents/refpicker.tsx`, `frontend/app/view/agents/gitstatepanels.tsx`, `frontend/app/cockpit/actions/run.ts`, `frontend/app/view/agents/runmodel.ts`, `frontend/app/view/agents/runmodel.test.ts`, `frontend/app/view/jarvis/runreportview.tsx`, `frontend/app/view/jarvis/runsheet.tsx`, `scripts/cdp/scenarios-diff-scope.mjs`

Port `239572820`, `5d94a7493`, `7607e68b8` (minus bindings hunks), `a760de47e`, `fba263531`, `b5710027a` and `47f904422`
onto ours, using Task 1's End / HasRemote / Worktree fields (served by Task 2). Skip `d94ed8bb6` (ported) and
`dc26b2004` except its narrow Shift+D part, which Task 16 binds if ours lacks it. The history overlay is a new
long-lived view: note in the commit message what it keeps resident while closed (Task 16 records it under RAM watch),
and `diff-scope` measures it (decision 15).
Fork spec: `2026-11-05-diff-surface-review-fixes-design.md`.

Acceptance: `npx vitest run frontend/app/view/agents/difflayout.test.ts frontend/app/view/agents/diffscope.test.ts frontend/app/view/agents/gitgraphgeom.test.ts frontend/app/view/agents/historyquery.test.ts frontend/app/view/agents/historyrows.test.ts frontend/app/view/agents/diffsource.test.ts frontend/app/view/agents/agentdiffnav.test.ts frontend/app/view/agents/filesstore.test.ts frontend/app/view/agents/githistorystore.test.ts frontend/app/view/agents/comparestore.test.ts frontend/app/view/agents/runmodel.test.ts frontend/app/view/agents/diffcontent.test.ts`
passes. Scenario `diff-scope`: the source picker's states (an agent, a landed run read from the checkout's repo root, a
failed source), a card's Diff chip scoping to its agent, the history overlay and rail opening over the Diff (shot), a
history failure keeping the working tree shown, and the heap step of decision 15 around opening and closing the history
overlay. Scenario `diff-compare-refresh`: the compare view opens on the default
pair, the refresh control re-reads it after a new commit, and a repo with no remote shows no fetch.

### Task 12: Diff review fixes: capped reads, empty and failure states, diff bands, fit, counts
**Files:** `frontend/app/view/agents/diffcommentcard.tsx`, `frontend/app/view/agents/diffcommentlayer.ts`, `frontend/app/view/agents/diffcontentstore.ts`, `frontend/app/view/agents/diffcontentstore.test.ts`, `frontend/app/view/agents/diffempty.ts`, `frontend/app/view/agents/diffempty.test.ts`, `frontend/app/view/agents/diffoptions.ts`, `frontend/app/view/agents/diffoptions.test.ts`, `frontend/app/view/agents/diffpane.tsx`, `frontend/app/view/agents/diffscope.ts`, `frontend/app/view/agents/diffscope.test.ts`, `frontend/app/view/agents/filessurface.tsx`, `frontend/app/view/agents/changedfilelist.tsx`, `frontend/app/view/agents/commitpane.tsx`, `frontend/app/view/agents/filesstore.ts`, `frontend/app/view/agents/filesstore.test.ts`, `frontend/app/view/agents/cardgitstore.ts`, `frontend/app/view/agents/cardgitstore.test.ts`, `frontend/app/view/agents/gitfailure.ts`, `frontend/app/view/agents/gitfailure.test.ts`, `frontend/app/view/agents/gitstatepanels.tsx`, `frontend/app/view/agents/surfacescaffold.tsx`, `frontend/app/monaco/monacotheme.ts`, `frontend/app/monaco/monacotheme.test.ts`, `frontend/app/monaco/monaco-react.tsx`, `DESIGN.md`, `scripts/cdp/scenarios-diff-states.mjs`

Port `ed9065e38`, `17f5e4976`, `44e2c54b1` (frontend; its Go part is Task 2), `cda904c6f`, `461e72729` and the colour
commits `bf04c90ff`, `31ab859d1`, `4d4254507` under the spec's colour rule: colours only from tokens, and where the fork's
diff palette replaces ours, ours stays (record it under "Differs from plan"); the new-file bands come from Task 1's CSS.
`monaco-react.tsx`'s diff editor fit (layout with the observed box) must keep every existing caller's sizing working;
`DESIGN.md` only gains lines. `surfacescaffold.tsx`'s shared empty state is an addition, not a change to existing
empty states.

Acceptance: `npx vitest run frontend/app/view/agents/diffempty.test.ts frontend/app/view/agents/gitfailure.test.ts frontend/app/view/agents/cardgitstore.test.ts frontend/app/view/agents/diffcontentstore.test.ts frontend/app/view/agents/diffoptions.test.ts frontend/app/view/agents/diffscope.test.ts frontend/app/view/agents/filesstore.test.ts frontend/app/monaco/monacotheme.test.ts`
passes. Scenario `diff-file-states`: a file past the read cap shows the capped state, an empty file and a read failure
their states, a git failure leads with git's error line, the change list stays when line counts fail (counts hidden
while unknown), a new file reads without a removed line, and a long file name truncates (shot each).

### Task 13: Usage: the Workflow lens
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/workflowlens.ts`, `frontend/app/view/agents/workflowlens.test.ts`, `frontend/app/view/agents/workflowlensview.tsx`, `frontend/app/view/agents/workflowscanstart.ts`, `frontend/app/view/agents/usagestore.ts`, `frontend/app/view/agents/usagesurface.tsx`, `scripts/cdp/scenarios-usage-lens.mjs`

Port `81731000e`, `a78430d79`, `212e92228`, `cc7b84f3d` and `f5d09f0f2` onto our existing workflow-scan backend
(`pkg/workflowscan`) and palette (`frontend/app/cockpit/palette-scan.ts`): a Workflow lens beside the Usage surface's
existing lenses, opening a scan in Diff (a button of the lens, through `frontend/app/view/jarvis/openref.ts`, never a
hand-rolled surface switch) and picking its scan project. `UsageLens` in `usagestore.ts` gains `"workflow"` (the
existing `provider` and `work` and the default are unchanged). `workflowscanstart.ts` (with `workflowScanRunAtom`,
which the lens view imports) is created from `git show kael/main:frontend/app/view/agents/workflowscanstart.ts`, fitted
to our RPCs; where ours already has the same start logic (the palette's), reuse it instead of duplicating it. Our
`workflowscan:` address keeps landing on the scan's agent: the lens does not change the address route. The lens hooks
into `usagesurface.tsx` at one point; every existing lens renders as before.

Acceptance: `npx vitest run frontend/app/view/agents/workflowlens.test.ts` passes. Scenario `usage-workflow-lens`: pick
the Workflow lens on Usage (shot), with a seeded scan its findings list, its empty and failed states show (shot each),
the project picker changes the scan project, and Open in Diff lands on the Diff surface with that scan's project.

### Task 14: Usage: finer attribution, paging, initiatives, pricing, window, forecast and keyboard-ready nav
**Depends on:** Task 13, Task 5
**Files:** `frontend/app/view/agents/usageattribution.ts`, `frontend/app/view/agents/usageattribution.test.ts`, `frontend/app/view/agents/usagesurface.tsx`, `frontend/app/view/agents/usagerail.ts`, `frontend/app/view/agents/usagerail.test.ts`, `frontend/app/view/agents/agents.tsx`, `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/dailychart.tsx`, `frontend/app/view/agents/usagedaily.ts`, `frontend/app/view/agents/usagedaily.test.ts`, `frontend/app/view/agents/usagemeters.tsx`, `frontend/app/view/agents/usagepricing.ts`, `frontend/app/view/agents/usagepricing.test.ts`, `frontend/app/view/agents/usagestats.ts`, `frontend/app/view/agents/usagestats.test.ts`, `frontend/app/view/agents/usagestore.ts`, `frontend/app/view/agents/usagestore.test.ts`, `frontend/app/view/agents/usagenav.ts`, `frontend/app/view/agents/usagenav.test.ts`, `scripts/cdp/scenarios-usage-work.mjs`

Port `4e2c45b83`, `8904b6f4d`, `dce4a7900` (minus bindings, whenstate and keyboard-doc hunks; its `usagenav.ts` pure
functions and the atoms the binding reads stay here and are exported), `bd5863c89`, `8846762ec`, and the additive parts
of `b71bbd99c` and `e636caf9c` per decision 9. Reads Task 1's session fields (served by Task 3). The By-work list pages
(8, then +25), initiative cards follow projects, unpriced rows show estimates and coverage, a failed scope switch drops
held figures and offers Retry. `aggregateBuckets` gains an optional window argument; called without it, it returns what
it returns today. `usagedaily.ts` and `usagedaily.test.ts` are new to ours: create them from `kael/main`. The
`USAGE_LEVEL_FILL` / `USAGE_LEVEL_TEXT` maps go beside `usageLevel` and the app bar's meter keeps its colours.

Acceptance: `npx vitest run frontend/app/view/agents/usageattribution.test.ts frontend/app/view/agents/usagerail.test.ts frontend/app/view/agents/usagedaily.test.ts frontend/app/view/agents/usagepricing.test.ts frontend/app/view/agents/usagestats.test.ts frontend/app/view/agents/usagestore.test.ts frontend/app/view/agents/usagenav.test.ts`
passes. Scenario `usage-work`: on fixture usage, By work shows sessions attributed to their task, chunk, initiative and
brainstorm lead (shot), Show more pages the list, an initiative card opens its scope, a provider's quota shows on its
scope card, an unpriced row shows its estimate and coverage, the daily chart of a narrow scope spans the held window,
the Claude projection (forecast) shows, a failed scope switch shows the switch-failed panel with Retry (shot), and the
existing usage sections (Live limits and the filters) are still where they were.

### Task 15: Setup: Instructions tab Sync now, honest counts, safer edits; skills links and stray copies
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/setupsurface.tsx`, `frontend/app/view/agents/setupinstructionsync.tsx`, `frontend/app/view/agents/setupmodel.ts`, `frontend/app/view/agents/setupmodel.test.ts`, `frontend/app/view/agents/setupstore.ts`, `frontend/app/view/agents/setupstore.test.ts`, `frontend/app/view/agents/skillsmatrix.ts`, `frontend/app/view/agents/skillsmatrix.test.ts`, `frontend/app/cockpit/cockpit-actions.ts`, `frontend/app/cockpit/cockpit-actions.test.ts`, `scripts/cdp/scenarios-setup-instructions.mjs`

Port `ce7a5fecd` (minus its keyboard-doc hunk) and the frontend side of `feb98d599` (the skills matrix reads the
`linked` state, Vault stray copies, Skip) per decision 10, reading Task 1's fields (served by Task 4). Sync now runs a
dry run first and shows honest counts; the note tone comes from the backend's NoteTone, never from matching text. Our
Instructions tab's existing editor and save stay as they are. Fork spec: `2026-11-06-setup-review-fixes-design.md`.

Acceptance: `npx vitest run frontend/app/view/agents/setupmodel.test.ts frontend/app/view/agents/setupstore.test.ts frontend/app/view/agents/skillsmatrix.test.ts frontend/app/cockpit/cockpit-actions.test.ts`
passes. Scenario `setup-instructions-sync`: Setup → Instructions shows each harness file's state including blank and a
warn-tone note (shot), Sync now shows the dry run's counts then syncs, and Setup → Skills shows a dangling link and a
stray vault copy with their actions (shot).

### Task 16: Keybindings for the sync, keyboard doc, CHANGELOG, hand-checks and RAM watch
**Depends on:** Task 2 (writes its CHANGELOG line), Task 3 (writes its CHANGELOG line), Task 4 (writes its CHANGELOG line), Task 9 (binds the Code actions Tasks 5–9 export), Task 12 (binds the Diff actions Tasks 10–12 export), Task 14 (binds the Usage atoms and nav Tasks 13–14 export), Task 15 (documents the Setup keys)
**Files:** `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/store/keybindings/store.test.ts`, `frontend/app/store/keybindings/whenstate.ts`, `frontend/app/store/keybindings/whenstate.test.ts`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md`, `scripts/cdp/scenarios-kael-keys.mjs`

Port the bindings, whenstate and keyboard-doc hunks of `1349eedb2`, `f8f185178`, `4c026402d`, `3baf6632f`,
`7607e68b8`, `dce4a7900`, `ce7a5fecd`, and `dc26b2004`'s narrow Shift+D only if ours lacks it, onto the names Tasks 5–15
exported (each task's commit message lists them). `9f979e412` is not ported here: the peek's keys are the card's own
(decision 12), so no existing Agent binding gains a guard. Every new binding goes in its surface's builder, must not
clash with an existing binding on that surface (the binding tests' clash checks pass unchanged), and must not use `[`
or `]` as its only key (Telex). The new `usage:back` takes Escape only while By work is drilled; prefer placing it so
the dispatcher picks it first, leaving `surface:back-home` as it is; if a stand-down on `surface:back-home` is needed,
it is the only change to an existing binding and the existing case at `bindings.test.ts` (Escape on Usage claims
`surface:back-home` when not drilled) passes unchanged. Add the new atoms to `PREDICATE_ATOMS`. Document every new
binding in `docs/keyboard-shortcuts.md`, and the Code peek's gesture (Ctrl+Shift+click) and card keys (Enter, Escape)
in its Agent section.

Then the docs, once, for the whole sync: `CHANGELOG.md` gains lines under the top section's Added / Changed / Fixed (open
`## Unreleased` above a dated top section), each bold lead ending "(from the kaeltran16 fork)" as earlier syncs wrote
it, with a `<!-- try: <binding id> -->` on lines about something openable; `docs/hand-checks.md` gains a `- [ ]` line per
user-facing change a scenario cannot judge (titled "(arcterm) …", for the owner's own later pass; none of them is a
check this run depends on); `docs/open-issues.md` "RAM watch" notes the terminal Code peek and the Diff history
overlay: what each keeps resident while idle (from Tasks 7 and 11's commit messages) and that the `code-peek` and
`diff-scope` scenarios measure their heap before, while and after (decision 15), with the numbers in each run's Final
step details.

Acceptance: `npx vitest run frontend/app/store/keybindings/bindings.test.ts frontend/app/store/keybindings/store.test.ts frontend/app/store/keybindings/whenstate.test.ts`
passes with every existing case unchanged. Scenario `kael-keys`, in order: Code's symbol binding opens the palette
seeded with `@`; the Code review key starts a comment and its send key opens the send bar; in a plain (non-git) folder
`d` passes through and Alt+arrows work from the editor (`4c026402d`); the Diff comment keys start a comment and open the
send bar; Diff's history keys open the overlay; Shift+D in a narrow Diff declines as `dc26b2004` describes (if ported);
on Usage, Escape in a drilled By work goes back a level, Escape when not drilled still goes home, and j/k move the list
cursor; each step asserts the result.

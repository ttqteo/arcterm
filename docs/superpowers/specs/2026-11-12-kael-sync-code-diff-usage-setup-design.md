# Kael sync (2026-11-12): Code review and peek, Diff comments, Usage Workflow lens, Setup sync

Port the easy groups still missing from the kaeltran16 fork (`kael` remote, `kael/main` at `d0be5ee41`; the last
sync, 2026-11-06, was cut at `f15fdc695`). The fork has no commits after 2026-11-06. A trial `git merge-tree`
cherry-pick of each group onto `main` conflicted on 70 to 100% of commits, so this is a port of behaviour into our
shape, not a cherry-pick: read a commit with `git show <hash>`, a file at the fork's tip with
`git show kael/main:<path>`, a fork spec with `git show kael/main:docs/superpowers/specs/<file>`. Use
`git cherry-pick -n` only where it applies cleanly.

## Scope

Commits are listed oldest first. Before porting a commit, check whether ours already does it (the 2026-11-03 and
2026-11-06 syncs, and our own work, ported some under other subjects); a part ours already has is skipped and named
in the commit's "Differs from plan".

### 1. Code: review comments to an agent, outline and go to definition, terminal Code peek

Fork specs: `2026-10-28-code-surface-improvements-design.md`, `2026-11-05-code-review-fixes-design.md`.

- `1349eedb2` symbols outline, `@` in the finder, go to definition and find references
- `f8f185178` review comments sent to an agent as one message (the Code review feature: `codereview.ts`,
  `codereviewstore.ts`, `codereviewbar.tsx`, Send review; the 2026-11-06 sync skipped it, this sync takes it)
- `3016f8235` review list, persisted reviews and honest handoffs
- Terminal Code peek: `8216f5927` pure model, `e7cae9a2c` store and loader, `6c717bf51` card, host and scenario,
  `9f979e412` Enter and Esc bindings, `8962d9efb` scenario steps, `294cde415` `~` paths, `19e16133d` binary MIME
- The peek's gesture (decided 2026-11-12 at plan review): ours already gives Ctrl+click on a terminal path to opening
  it (agent panel or Code), and that stays. The peek opens on Ctrl+Shift+click (Cmd+Shift+click on a Mac), which today
  only repeats Ctrl+click; it hangs off our path link provider (`termpathlinks.ts`, `pathlinks.ts`), not the fork's
  `termfilelinks.ts`. Inside the card, Enter opens the file in Code and Escape closes it, owned by the card
  (`data-owns-keys`, as our background-task peek does), so no existing Agent binding changes.
- `7f95de490` keyboard walk for the Changed pane
- Fixes: `10dd2d3ca`, `c24d4be5a`, `660560fd6`, `4de5b24f8` (markdown preview), `a93db601c`, `3ac8d932b`, `4c026402d`,
  `5f16e421b`, `be83424f2`, `c3d985bb6`, `c50a510c0`, `f2b39e1a7`, `a857dd852`, `783bd000c` (scenario scaffold)
- Already ported, skip: `ff2540f33` (blame follows unsaved edits), the image zoom.

### 2. Diff: comment on the diff's lines and send them to an agent; review fixes

Fork specs: `2026-10-26-diff-comments-design.md`, `2026-11-05-diff-surface-review-fixes-design.md`.

- Diff comments: `1f397273f` pending comment store, `07b1ff962` comment on lines, `d6dbf519f` prompt, recipient and
  send, `3baf6632f` send bar, badges and keys, `22ff2cb3f`, `73e5e44b5`, `0d1404f44`, `a08c22835` (wait while the
  agent is asking)
- Review fixes: `186f6e101` and `8d51edfdb` (gitinfo worktree read, bounded changes, hasremote wire fields),
  `239572820` range, history and layout models, `5d94a7493`, `7607e68b8` history overlay and rail, `a760de47e`,
  `ed9065e38` capped worktree reads, `fba263531` compare refresh and default pair
- Fixes: `b5710027a`, `bf04c90ff`, `31ab859d1`, `461e72729`, `4d4254507`, `17f5e4976`, `44e2c54b1`, `47f904422`,
  `cda904c6f`
- Already ported, skip: `d94ed8bb6` file-list order, `dc26b2004` n / p and r (take only its narrow Shift+D part if
  ours lacks it).
- Skipped under "Our code wins" (decided 2026-11-12 at plan review): `8d51edfdb`'s HistoryLog dropping `refs/stash`,
  and `0d1404f44`'s keeping rename/copy letters and source paths in gitinfo and `jarvis/evidence.go` (with the frontend
  hunks that rely on them): both change what existing callers of ours get. Left to the owner.
- `31ab859d1` and `bf04c90ff` change diff colours: colours only from `@theme` tokens, and keep ours if the fork's
  palette clashes with our themes.

### 3. Usage: the Workflow lens and finer attribution

Fork specs: `2026-10-08-usage-attribution-design.md`, `2026-11-05-usage-review-fixes-design.md`.

- Workflow lens: `81731000e` the lens on Usage (ours has the workflow-scan backend and palette, not the lens),
  `a78430d79` / `212e92228` polish, `cc7b84f3d` opens scans in Diff and picks its project, `f5d09f0f2` scenario steps
- Attribution: `17759a7cd` a brainstorm judge's session carries its role, `7bf83577a` wire fields for session task,
  chunk, effort, lead, project, `75c5a9c0b` directory fills them, `4e2c45b83` brainstorm leads, paging, initiatives,
  `9444377ac` a session keeps its initiative after its tab closes
- Surface: `b71bbd99c`, `e636caf9c`, `8904b6f4d` pricing, window, forecast and colour models, `dce4a7900` rendering
  and keyboard, `bd5863c89`, `8846762ec`
- Already ported, skip: `530ef1733` (consult sessions attributed to the run).

### 4. Setup: Skills and Instructions sync

Fork spec: `2026-11-06-setup-review-fixes-design.md`.

- `feb98d599` agentsync wire fields for links, stray copies, skip, dry run; `27d06199b` agentsync links, stray vault
  copies, skip, blank doc, note tone; `ce7a5fecd` Instructions tab Sync now, honest counts, safer edits
- `e4fe34382` the initiatives skill notes a chunk with `wsh effort chunk note`, only if ours has that command
- Skip `a5c139296` (a revert of a docs change ours never took).

## Out of scope

Do not port, and skip every hunk of a listed commit that touches them:

- Jira (`pkg/jira`, Settings › Jira, `wsh jira`, a ticket on an initiative).
- Session full-text search (`agentsessions` `digest.go`, `index.go`, `search.go`, `SearchSessions`, the palette
  Sessions scope) and the fork's Sessions surface: past sessions are centre modes of Agent here.
- Remote mode and the phone page (`pkg/remotemode`, `wsh remote`, Hand to phone).
- The Jarvis → Hub rename, the fork's Brief layout and Jarvis pet, and the Radar removal: ours keeps Jarvis and Radar.
- Orchestrate engine changes: judged separately.

## Our code wins (the owner's hard rule)

The port must not conflict with, overwrite or undo our own code. It is additive:

- Never rewrite, rename, remove or restyle an existing behaviour, component, binding, wire field or test of ours to
  match the fork. Where the fork's change and ours touch the same thing differently, ours stays as it is and the
  fork's addition is fitted around it; when it cannot fit without changing ours, skip that part and name it under
  the commit's "Differs from plan" (and in the run report), never "harmonise" ours toward the fork.
- Prefer new files and small hook points in ours over editing large shared files; an edit to an existing file of
  ours keeps every existing line's behaviour, and its existing tests pass unchanged (a test of ours is never edited
  to make a port pass).
- A plan reviewer or task reviewer treats any changed or removed existing behaviour of ours as a failure.

## Our differences that matter

- Ours has no New agent modal file (`newagentmodal.tsx`) and no Sessions surface; port onto our equivalents.
- The fork split its CDP scenarios into `scripts/cdp/scenarios-<area>.mjs`. Ours keeps most in
  `scripts/cdp/scenarios.mjs` and loads split files (`scenarios-monitor-tasks.mjs` is the model: a default export
  taking `RT_KIT`). A new scenario goes in its own new file; one task alone edits `scenarios.mjs` to register them,
  so tasks can run side by side.
- Go is the source of truth for wire types: change the Go and run `task generate`; never hand-edit generated files.
- Colours from `@theme` tokens, motion from `frontend/app/element/motiontokens.ts`, UI per `DESIGN.md`. A new
  keybinding goes in `bindings.ts` and `docs/keyboard-shortcuts.md` and must not clash on its surface. Mind Telex:
  `[` and `]` are not usable as a sole binding.
- Keep the fork's tests (adapted) and its pure-model / thin-view split.

## Verification

- Verify: `node scripts/verify.mjs` on the Go packages touched (at least `./pkg/wshrpc/... ./pkg/gitinfo/...
  ./pkg/agentsync/... ./pkg/usagestats/...` where they exist). Check: `task check:ts`.
- Each task that builds a view, state or interaction adds the scenario that shows it; Final runs
  `node scripts/cdp/final-verify.mjs` with every scenario this sync adds.
- `CHANGELOG.md` and `docs/hand-checks.md` are written once, by the last task: each user-facing line ends its bold
  lead with "(from the kaeltran16 fork)", as earlier syncs wrote it.
- RAM: the terminal Code peek and the Diff history overlay are new long-lived views; note their idle RAM in
  `docs/open-issues.md` "RAM watch" if they keep anything resident.

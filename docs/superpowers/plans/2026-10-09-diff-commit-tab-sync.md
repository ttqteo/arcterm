# Diff surface: the Commit tab, the sync bar and docs (follow-up): implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the Diff surface redesign: the Commit tab (tick files, message, commit with `--only`), the sync bar
(fetch, pull, push) and the docs. These are Tasks 8–10 of
`docs/superpowers/plans/2026-10-09-diff-commit-log-redesign.md`. Its Tasks 1–7 landed in `22b34e25`.

**What is already on main, so do not rebuild it:**
- Go and RPC: `GitCommitCommand`, `GitCommitMessageCommand` (`ref: ""` reads HEAD's message), `GitPullCommand`, `GitPushCommand`, and the upstream
  fields on `GitChangesCommand`.
- Pure models: `commitselection.ts`, `syncstate.ts`.
- The panel: `diffpanel.tsx`, `sourcepicker.tsx`, `changesstatus.ts`, `filestep.ts`.
- The scenario `diff-log-tab`.

Read `diffpanel.tsx` first.

**Architecture, tech stack and conventions:** as in the earlier plan's header ("Conventions for every task"), which
every worker should read.

**Spec:** `docs/superpowers/specs/2026-10-09-diff-commit-log-redesign-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/gitinfo ./pkg/wshrpc/...`
**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: diff-commit-tab, diff-sync need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs diff-commit-tab diff-sync diff-log-tab diff-compare`
**Prototype:** D:/arc-proto/diff-commit-log/project

Board → scenario step: `Main` → `diff-commit-tab` steps 1–3 (step 3 toggles Amend) and `diff-sync` step 5. `States` →
`diff-commit-tab` steps 5–7 and `diff-sync` steps 2–4. `Log`, `Loading`, `Rail` and `Compare` → `diff-log-tab`, already on main.

---

### Task 1: The Commit tab
**Depends on:** none
**Files:** `frontend/app/view/agents/commitstore.ts`, `frontend/app/view/agents/committab.tsx`, `frontend/app/view/agents/syncstate.ts`, `frontend/app/view/agents/diffpanel.tsx`, `frontend/app/view/agents/filessurface.tsx`, `scripts/cdp/scenarios.mjs`

Build `Main.dc.html` and the commit half of `States.dc.html`.

**What changes where:**
- Create: `frontend/app/view/agents/commitstore.ts`. All its state is keyed by cwd, so it survives the surface
  unmounting.
  - Atoms:
    - `commitListAtom: Record<cwd, { changes: GitChanges | null; head: string; upstream: string; upstreamAhead: number } | undefined>`,
      read with a live `GitChangesCommand({ cwd })` (no ref), because an agent scope's `filesStateAtom` is anchored
      at the session start;
    - `commitTicksAtom: Record<cwd, CommitTicks>`;
    - `commitDraftAtom: Record<cwd, string>`;
    - `commitAmendAtom: Record<cwd, boolean>`;
    - `commitSelectedAtom: Record<cwd, string | null>`;
    - `commitRunAtom: Record<cwd, { running: boolean; failure: GitFailure | null }>`;
    - `unversionedOpenAtom` (default false).
  - Functions:
    - `loadCommitList(cwd)`: prunes ticks against the new list, and selects the first file when nothing is selected;
    - `startCommitPoll(cwd)`, at `FILES_POLL_MS`;
    - `toggleTick`, `setAllTicked`, `setDraft`, `selectCommitTabFile`;
    - `setAmend(cwd, on)`: on → fetch `GitCommitMessageCommand({ cwd, ref: "" })` (`wshrpctypes_git.go:237`) and put
      its message in the draft; off → clear the draft
      only if it still equals HEAD's message;
    - `commitNow(cwd)`: calls `GitCommitCommand` with `tickedPaths`, `{ timeout: 65000 }`. On failure it stores the
      failure and keeps the draft and ticks. On success it clears the draft, amend and ticks, then reloads the list,
      calls `reloadChanges(cwd)` and `refreshHistory()`, and `pushToast({ title: \`Committed ${hash}\`, message:
      \`${n} ${n === 1 ? "file" : "files"}\`, level: "info", onOpen })`. `onOpen` switches to the Log tab and calls
      `selectCommit(cwd, hash)`, so the new commit's row is selected and its first file open.
- Create: `frontend/app/view/agents/committab.tsx`, as drawn in `Main.dc.html`:
  - The header row: a tri-state checkbox (`data-commit-tick-all`, `role="checkbox"`, `aria-checked="mixed"` for some;
    a click ticks every committable row, or unticks all when all are ticked; disabled rows are never ticked), `Changes n`,
    `TreeModeToggle`, and a refresh icon button (`data-commit-refresh`, `aria-label="Refresh"`, `RefreshCw`) that calls
    `loadCommitList(cwd)` and spins while it runs.
  - The **Changes** group, then **Unversioned files** (folded by default), each built with `buildFileTree` /
    `treeModeAtom` as `ChangedFileList` does.
  - A row (`data-commit-row={path}`) holds a checkbox (`data-commit-tick={path}`, `aria-checked`, `disabled` with a
    `title` from `CHANGE_NOTE_TITLE` when `!committable`), the status letter, the name, and the counts or the note.
  - Clicking a row selects it and shows its diff. The list container (`data-commit-list`) is focusable: `↑`/`↓` move
    the selection and show that file's diff at once (`stepFile` from `filestep.ts`), and `Space` toggles its tick.
  - The box (`data-commit-box`) holds:
    - the textarea `data-commit-message` (3–10 lines, `aria-label="Commit message"`). `Ctrl+Enter` in it calls
      `commitNow`;
    - the Amend checkbox `data-commit-amend`, disabled with the title "Already pushed: amending would need a force
      push" when `!amendAllowed`;
    - the muted note `data-commit-agents-note`: "n agents running here", shown only when n > 0, from `agentsWorkingIn`
      with `agentCwdsAtom` and `model.agentsAtom`. `agentCwdsAtom` is `Record<string, string | null>` and
      `agentsWorkingIn` takes `Record<string, string>`: widen `agentsWorkingIn`'s parameter to
      `Record<string, string | null>` in `syncstate.ts` (it already skips a falsy dir). In DEV only,
      `window.__syncWorkingAgents` (a string array) replaces the computed list; Task 1 declares it in a
      `declare global` block in `commitstore.ts`, and Task 2's Pull confirm reuses it;
    - the button `data-commit-button`: `commitLabel`, disabled unless `canCommit`, with the hint `Ctrl+Enter`.
  - A failure renders under the button as `data-commit-failure`: git's command, exit code and stderr in mono, then
    "Your message and ticks are kept."
  - A clean tree renders `data-commit-empty`: "No uncommitted changes", "The working tree matches HEAD." and a link
    "Open the Log (Shift+H)".
- Modify: `diffpanel.tsx`: the Commit body renders `CommitTab` in place of the read-only `CommitList` placeholder (~line 129); delete `CommitList`.
  Remove the tab strip's own `TreeModeToggle` on the Commit tab (~line 393, `tab === "commit" ? <TreeModeToggle />`):
  the Commit tab's header row carries the one toggle.
- Modify: `syncstate.ts`: widen `agentsWorkingIn`'s `agentCwds` to `Record<string, string | null>` (above). Modify `filessurface.tsx`: when `panelTabAtom` is
  `"commit"`, the diff shows `commitSelectedAtom[cwd]` with `{ kind: "worktree", anchorRef: "" }`, `editorCwd = cwd`,
  and the header measured "vs HEAD" (or "new file" for `?`).
- Modify: `scripts/cdp/scenarios.mjs`. Add `diff-commit-tab`, registered right after `diff-worktrees`. Its arrange
  seeds a repo (configured `user.name`/`email`) holding:
  - a committed `a.txt`, then modified;
  - `b.txt`, committed, modified and `git add`ed, as "another session" would;
  - an untracked `new.txt`;
  - `logo.png` with a NUL byte;
  - `vendor/tool/` with its own `git init`.

  Steps:
  1. Click `[data-source-picker-trigger]`: `[data-source-picker="open"]` shows the project row and the filter has
     focus. Shot `cdp-shots/diff-source-picker.png`. Pick the project with the dropdown (it closes): the Commit tab is
     selected (a dirty tree, decided once its list loaded), a.txt and b.txt are ticked, new.txt is unticked,
     `vendor/tool/` is disabled with "repo", and `logo.png` reads "bin". The diff shows a.txt. Shot
     `cdp-shots/diff-commit-tab.png`.
  2. Focus `[data-commit-list]` and press `↓`: b.txt is selected and the diff header names it, without Enter. Press
     `Space`: b.txt's `[data-commit-tick]` reads `aria-checked="false"`. Unfold Unversioned, tick new.txt, type a
     message into `[data-commit-message]` and press `Ctrl+Enter` there. A toast shows "Committed <hash>"; `git show
     --name-only HEAD` lists a.txt and new.txt, and `git diff --cached --name-only` is still b.txt. Click the toast's
     `[data-notification-open]`: the Log tab is selected and the `[data-history-row="<hash>"]` row is selected.
  3. Header checkbox: click `[data-commit-tick-all]` until it reads `aria-checked="true"` (at most twice): every
     enabled `[data-commit-tick]` reads `"true"` and `vendor/tool/`'s disabled tick stays `"false"`. Click it once
     more: every tick reads `"false"`. Set `window.__syncWorkingAgents = ["fixture agent"]` and click
     `[data-commit-refresh]` (`loadCommitList` always stores a new entry, so the box rerenders and re-reads the
     override): `[data-commit-agents-note]` reads "1 agent running here"; delete the override and refresh again. Amend (no upstream yet, so it is allowed): tick
     `[data-commit-amend]`: `[data-commit-message]` holds HEAD's message (step 2's commit) and `[data-commit-button]`
     reads "Amend with n files". Shot `cdp-shots/diff-commit-amend.png`. Untick it: the textarea is empty again.
  4. Switch to the Log tab, then press `Shift+C`: the Commit tab is selected and `document.activeElement` is
     `[data-commit-message]`. Write `x.txt` in node and click `[data-commit-refresh]`: an x.txt row appears in
     Unversioned.
  5. Write a failing `pre-commit` hook, modify a.txt and commit: `[data-commit-failure]` holds the hook's text and the
     message is still in the box. Shot `cdp-shots/diff-commit-failed.png`. Remove the hook.
  6. Add a bare remote and `git push -u`: Amend is disabled with its title. Shot `cdp-shots/diff-commit-amend-locked.png`.
  7. Commit everything left (`git add -A && git commit` in node, unticking the nested repo first by ignoring it in
     `.git/info/exclude`): `[data-commit-empty]` shows. Shot `cdp-shots/diff-commit-empty.png`.

  Teardown removes the project and the temp dirs.

**Steps:**
1. Write `commitstore`'s pure parts as tests first where there is logic beyond atoms (none expected: the logic sits in
   `commitselection.ts`).
2. Build the store and the view.
3. Run `task check:ts`, then eslint and prettier on the touched files.
4. Run `task verify:ui -- diff-commit-tab diff-log-tab surface-smoke`; every step must pass.
5. Commit by pathspec: `feat(diff): commit ticked files from the Commit tab`.

---

### Task 2: The sync bar
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/syncstore.ts`, `frontend/app/view/agents/syncbar.tsx`, `frontend/app/view/agents/gitstatepanels.tsx`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/diffpanel.tsx`, `frontend/app/view/agents/diffpane.tsx`, `scripts/cdp/scenarios.mjs`

Build the sync cluster of `Main.dc.html` and the sync half of `States.dc.html`.

**What changes where:**
- Create: `frontend/app/view/agents/syncstore.ts`:
  - `syncRunAtom: Record<cwd, { running: "pull" | "push" | null; failure: { kind: "pull" | "push"; failure: GitFailure } | null }>`;
  - `runPull(cwd)` calls `GitPullCommand` with `{ timeout: 60000 }`, and `runPush(cwd)` calls `GitPushCommand` with
    `{ timeout: 125000 }`;
  - on success, toast "Pulled n commits", "Pushed n commits", or "Published <branch>" when the push set an upstream;
    then run `runFetch(cwd)` (from `comparestore`), `reloadChanges(cwd)`, `refreshHistory()` and `loadCommitList(cwd)`;
  - an RPC throw becomes a failure with exit code -1 and "the pull did not complete" / "the push did not complete";
  - Fetch stays `comparestore.runFetch`, with its `fetchStatesAtom`.
- Create: `frontend/app/view/agents/syncbar.tsx`:
  - Where the numbers come from: `syncView` takes `branch`, `upstream`, `upstreamAhead` and `upstreamBehind` from
    `filesStateAtom`, as `diffpane.tsx:103` already does (`commitListAtom` has no `upstreamBehind`; don't add one);
    `running` from `syncRunAtom[cwd]`, and Fetch's state from `comparestore.fetchStatesAtom`.
  - `syncView` drives the counts span (`data-sync-counts`, `title`) and three icon buttons, each `data-sync=fetch|pull|push`
    with an `aria-label`, `RefreshCw` / `ArrowDownToLine` / `ArrowUpFromLine`, and an `animate-spin` spinner while it
    runs. Publish is a text button.
  - **Pull confirm:** when `agentsWorkingIn(cwd, …)` is non-empty, Pull opens a popover (`data-pull-confirm`,
    `role="dialog"`) titled "Pull n commits into <branch>?". It names the agents and offers Cancel / "Pull n commits".
    For the scenario, in DEV only, `window.__syncWorkingAgents` (declared by Task 1 in `commitstore.ts`) replaces the
    computed list.
  - **Failure:** do not reuse `GitFailureNotice` (`gitstatepanels.tsx:94`): it hardcodes "Fetch failed · showing refs
    as of the last fetch" and a Retry action. Add `SyncFailureNotice` beside it in `gitstatepanels.tsx`, on the same
    `SurfaceBanner` (`data-sync-failure`, `data-sync-failure-kind="pull|push"`): titled "Pull failed" or "Push failed"
    by kind, then `explainSyncFailure`'s sentence when it is not empty, then git's stderr (truncated, full text in
    `title`). Its action is "Open a terminal here" (`data-sync-open-terminal`), which opens a plain terminal in the
    worktree: export `quickTerminal` from `agenttree.tsx:1506` and call it with the cwd and its project name, rather
    than copying it. Its Dismiss clears `syncRunAtom[cwd].failure`. Rendered under the top bar.
- Modify: `diffpanel.tsx`. The top bar renders `SyncBar` in place of `FetchButton` (~line 103); delete `FetchButton`. Modify `diffpane.tsx` so
  the folded header shows the counts span (`data-sync-counts`, the same text and `title` as the bar's) and no sync
  buttons.
- Modify: `scripts/cdp/scenarios.mjs`. Add `diff-sync`, registered right after `diff-compare`. Its arrange is a bare
  remote, clone A (registered as the project) and clone B, both with an identity. Steps:
  1. A commits once: `[data-sync-counts]` reads "↑1 ↓0". Click Push: a toast shows and the counts read "↑0 ↓0".
  2. B commits and pushes, and A commits: click Fetch, then Pull. `[data-sync-failure]` says main and origin/main have
     diverged, its title reads "Pull failed" (not "Fetch failed"), and `[data-sync-open-terminal]` is present. Shot
     `cdp-shots/diff-sync-diverged.png`. Click the banner's Dismiss: `[data-sync-failure]` is gone. Reset A to
     origin/main.
  3. B pushes again, and set `window.__syncWorkingAgents = ["fixture agent"]`: click Pull. `[data-pull-confirm]` names
     the agent. Shot `cdp-shots/diff-sync-confirm.png`. Confirm: a toast shows "Pulled 1 commit".
  4. A checks out a new branch `feature` with a commit: the counts read "no upstream" and the push button reads
     Publish. Shot `cdp-shots/diff-sync-publish.png`. Click it: the counts become "↑0 ↓0".
  5. Press `Shift+B` to fold the panel: the folded header's `[data-sync-counts]` reads "↑0 ↓0" and no `[data-sync]`
     button shows. Shot `cdp-shots/diff-sync-folded.png`. Press `Shift+B` again to unfold.

  Teardown removes the project and the temp dirs.

**Steps:**
1. Build the store and the bar.
2. Run `task check:ts`, then eslint and prettier on the touched files.
3. Run `task verify:ui -- diff-sync diff-commit-tab diff-log-tab diff-compare surface-smoke`; every step must pass.
4. Commit by pathspec: `feat(diff): fetch, pull and push from the Diff panel`.

---

### Task 3: Docs
**Depends on:** Task 2
**Files:** `CHANGELOG.md`, `docs/keyboard-shortcuts.md`, `docs/deferred.md`, `docs/open-issues.md`, `docs/reference/architecture.md`, `docs/superpowers/plans/2026-10-09-diff-commit-log-redesign.md`

**What changes where:**
- `CHANGELOG.md`: under the top section (open `## Unreleased` above `## 0.15.8 — 2026-10-09` if none is there), add
  one `Added` line for commit and sync from the Diff surface, and one `Changed` line for the Commit | Log panel beside
  a wide diff, which landed in 22b34e25 without one. Add one `Fixed` line: a commit's files no longer read "0 files"
  while they load or after a failed read.
- `docs/keyboard-shortcuts.md`: in the Diff section, add `Shift+C` and change the descriptions of `Shift+H` and
  `Shift+B` to match `bindings.ts`.
- `docs/deferred.md` ("Diff surface — repository actions…") and `docs/open-issues.md` (Spec B): narrow both to
  checkout, cherry-pick and revert. Say that commit, fetch, pull and push shipped on 2026-10-09 under the spec above.
- `docs/reference/architecture.md`: fix any sentence that describes the Diff surface's columns.
- Delete the shipped plan `docs/superpowers/plans/2026-10-09-diff-commit-log-redesign.md` (`AGENTS.md`: a plan is
  deleted once it ships). Leave this plan alone; whoever lands the run deletes it.

Commit by pathspec: `docs(diff): Commit | Log panel, commit and sync`.

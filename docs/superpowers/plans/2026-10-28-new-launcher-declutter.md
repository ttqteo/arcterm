# New dialog, decluttered — plan

**Spec:** `docs\superpowers\specs\2026-10-28-new-launcher-declutter-design.md` (decisions D1–D8
and the Agent's calls under them and under "Left to the builder")
**Verify:** `node scripts/verify.mjs ./pkg/agentsessions`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs launcher launcher-resume launcher-resume-older launcher-images launcher-empty tools-launcher tools-app new-run-window brainstorm-hints brainstorm-mode brainstorm-approve-run codex-worker-route capacity-warn agy-harness council-tree council-setup`
**Prototype:** .superpowers\design\new-launcher-declutter\project\Main.dc.html

The work is frontend only: no Go, wshrpc or generated file changes. The boards in the Prototype folder are
`Main.dc.html` (a session picked, Start folded), `NewSession.dc.html` (New session picked, Worktree on, branch row under
the Task row), `ProjectFocus.dc.html` (Project focused, Start folded) and `Columns.dc.html` (the chip opened: three
columns as today). The rejected option B sits outside that folder and is not built.

Every scenario edit lives in Task 5, the one owner of the scenario files. Tasks 2–4 name in their acceptance the
scenario steps Task 5 adds for what they draw: those steps are proved by Final on the merged result, not at each
task's own merge, where `task check:ts` and the named vitest files are the proof.

### Task 1: Key and footer model for the folded Start column
**Depends on:** none
**Files:** `frontend/app/view/agents/launcher.ts`, `frontend/app/view/agents/launcher.test.ts`, `frontend/app/view/agents/launchermodal.tsx`

The pure model the dialog reads (D7, D8, D6 footer). Interface other tasks rely on:

- `LauncherKeyCtx` gains a required `startOpen: boolean` (the Start column is unfolded and shown).
- `LauncherInner` gains `"start"`. Escape's order becomes flags → branches → filter → `{ kind: "dismiss-inner", what:
  "start" }` when `startOpen` → close.
- A new action `{ kind: "fold" }`: Enter and Shift+Enter in zone `"start"` return it (Enter there keeps the row under
  the cursor, which ↑↓ already picked, and folds; it never launches).
- A digit in zone `"start"` still returns `pick-start` (the dialog folds after any Start pick, by click, digit or Enter).
  ↑↓ in `"start"` still return `move` and do not fold. ← from `"project"` still returns `{ kind: "column", to: "start"
  }` (the dialog unfolds, then focuses it). Every other key keeps today's meaning.
- `FooterInput` drops `resume`. For `kind: "agent"` with a project and no blocker, `footerLine` returns the account
  alone: `{ lead: "Claude: <account>", strong: "", tail: "", blocked: false }`, or an empty lead with no account.
  "Starts in", "Resumes", the path and `branchNote` no longer reach an agent footer. Tool, run and council footers and
  every blocker are unchanged; `branchNote` stays for a tool.
- In `launchermodal.tsx`, only the minimal call-site edits that keep the tree typechecking: pass `startOpen: false` in
  the `launcherKey` ctx (today ~line 771), drop `resume:` from the `footerLine` call (~line 306) and anything that
  leaves unused, and treat a `fold` action as a no-op. Task 4 does the real dialog work.

Tests to rewrite in `launcher.test.ts`, not leave red: the agent and resume footer tests (~lines 147–176: "Starts in",
" · on main", resume), "Enter in the start zone launches" (~411), "Shift+Enter in start gives resume-secondary"
(~434–436), and the `at()` helper (~322), which now takes `startOpen`.

Acceptance (`npx vitest run frontend/app/view/agents/launcher.test.ts`, `task check:ts`): Enter and Shift+Enter in an
open Start column return `fold`, never `launch` or `resume-secondary`; Escape folds an open Start column after closing a
flag menu, branch list or filter and before closing the dialog; a digit in Start picks; ↑↓ in Start move; ← from
Project goes to start; the agent footer is `Claude: <account>` or empty, for a new and a resumed session alike; the
tool, run, council and blocker footer tests pass unchanged.

### Task 2: Session rows on one line, no keycaps
**Depends on:** none
**Files:** `frontend/app/view/agents/launcherresumelist.tsx`

D4, D5 and D8 for the Session column (`ResumeList`).

- A session row is `sessionTitle(s)` on the left, truncated with "…", and `formatAge(now - s.lastactivets)` on the right
  ("2m", "1d"), tabular and never cut (`shrink-0`). The token count leaves the row (`formatTokens` goes if unused). The
  row's `title` tooltip keeps the full title (and branch, as today).
- "New session" stays pinned first. No `Keycap` on any row; drop the `Keycap` and `digitOf` imports.
- The column label's hint is always `"<n>[+] · newest first"`; the focused "type to filter · 1–9" hint is not drawn.
  Every key the list takes today (digits, letters to filter, ↑↓, ←, Enter) keeps working.
- No transcript read when the list opens or a row is picked (D5): nothing new is fetched.

Acceptance: `task check:ts` passes. Proved by Final: `launcher-resume` "a session row is one line: title and age, no
token count, no keycap", "picking a session row reads no transcript", and `launcher-resume-older` "a long title ends in
… and its age is not cut".

### Task 3: Task row, flag chips and the folded Command
**Depends on:** none
**Files:** `frontend/app/view/agents/launcheragentfields.tsx`

D6 for `AgentFields`. Keep `AgentFieldsProps` as it is today, so the dialog needs no change to call it.

- One row: the Task field (`#launcher-task`, its label kept), one line high when empty and growing with
  `field-sizing-content` up to today's `max-h-[240px]`, then scrolling; paste, drop and the image strip as today. The
  Task hint (sent as the first prompt, or the next message for a resumed session) moves into the field's placeholder.
- After the field on the same row: `+ Flag` (the flag menu as today, also on a resumed session), the enabled flags as
  chips beside it (`data-launcher-flag-chip`), the Worktree switch (a new session, a runtime that supports it, not Home,
  as today), then a `Command ›` toggle button (`data-launcher-command-toggle`, `aria-expanded`).
- The command line (today's editable input with its flag chips, `launcherCommandAtom` per runtime, unchanged; a resumed
  session's `resumeLaunchSpec` command as today) shows only while the toggle is open, in a code strip under the row.
  The toggle is component state, folded on every opening; a Terminal pick, which has no Task field, shows the command
  open and no toggle.
- Worktree on opens the branch row under the Task row; its hint is `worktreeOutcome`'s text verbatim, unchanged.
- The RAM warning, Home's ask-only note and the Terminal note stay as lines under the Task row. The brainstorm start
  hint (`START_LINE`, `data-brainstorm-start-hint`) leaves this component; `agentlaunchhero.tsx` keeps it.

Acceptance: `task check:ts` passes. Proved by Final: `launcher` "the Task row holds the field, + Flag, Worktree and
Command ›", "Command › opens the command strip", "an enabled flag shows as a chip on the Task row", "a Terminal pick
shows the command open and no toggle"; `launcher-resume` "the Task hint is the field's placeholder" and "New session
with Worktree on shows the branch row under the Task row" (screenshot matching `NewSession.dc.html`);
`launcher-images` "the empty Task field is one line, and grows with multi-line text and an attached image", with its
paste and drop steps passing as today; `brainstorm-hints` "the New dialog carries no brainstorm start hint".

### Task 4: The dialog: Start chip, two-column band, focus on Project
**Depends on:** Task 1 (uses `startOpen`, the `fold` action, `dismiss-inner: "start"` and the new `footerLine`), Task 2 (it removes the Session list's last use of `Keycap`, so this task can delete `Keycap` and `digitOf`)
**Files:** `frontend/app/view/agents/launchermodal.tsx`, `frontend/app/view/agents/launcherrows.tsx`, `frontend/app/view/agents/launchertoolfields.tsx`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md`

D1, D2, D3, D7, D8 and the agent footer in `LauncherModal`.

- Fold state is component state, `startOpen`, false on every opening (every door: `Mod+N`, `Mod+Shift+R`, the New
  button, `__openLauncher`, a brainstorm's Approve). Focus at open goes to the Project column (replacing the `startRef`
  focus at ~line 358).
- Folded: a chip line under the header holds one button (`data-launcher-chip`, in the Tab order) with the pick's
  `StartMark`, its name and a chevron (`Claude Code ▾`, `Quick run ▾`, `Tool ▾`, `Council ▾`). The Start rows are not
  rendered (spec D1). The band is `grid-cols-[172px_minmax(0,1fr)]`: Project, then the pick's own column
  (`data-launcher-column="third"`) taking the rest, for every pick (Session list, `RunColumn`, `ToolList`, the council
  note, the session note).
- Open (chip pressed, or ← from Project): the band is today's three columns (`236px` Start, Project, third) and focus
  goes to the Start column. A click, a digit (`pick-start`) or Enter (`fold`) picks and folds, and focus returns to
  Project; ↑↓ move and pick without folding; Escape (`dismiss-inner: "start"`) folds and focuses Project; focus leaving
  the Start column (Tab, →, a click elsewhere) folds it, with or without a pick. No fold motion.
- The band is 360px tall folded or open; Project and the third column scroll inside it.
- Project rows are names only: `projectWhere` is no longer drawn; the row's `title` keeps the path, and Home's keeps
  today's tooltip. Home stays pinned under the list.
- No `Keycap` on Start, Project or Home rows, and no key hints in `ColumnLabel` ("↑↓ · 1–N" in Start, the Tool list's
  "a–z · ↑↓"); labels that are not key hints stay ("last used first"). Delete `Keycap` and `digitOf` from
  `launcherrows.tsx` once nothing imports them (grep first). Every key keeps working through `launcherKey`.
- Footer: pass the real `startOpen` to `launcherKey` and handle `fold`; an agent footer reads `Claude: <account>`
  (`data-launcher-footer="line"`). Cancel, Open asleep / Transcript and the primary button stay.
- `docs/keyboard-shortcuts.md` "The New dialog": opens with Start folded into a chip and focus on Project; the chip or
  ← from Project opens the Start column; a pick, Enter or Escape there folds it, as does focus leaving it.
- `CHANGELOG.md`: one `Changed` line under the top `Unreleased` section (open one if the top section has a date), for
  the user: the New dialog folds the agent pick into a chip, gives the session list the room, and opens on Project.

Acceptance: `task check:ts` and `npx vitest run frontend/app/view/agents/launcher.test.ts` pass. Proved by Final:
- `launcher-resume`: "opens folded: the chip shows Claude Code and focus is on Project" (screenshot matching
  `ProjectFocus.dc.html`); "a session picked: Project 172px, the third column takes the rest, band 360px" (screenshot
  matching `Main.dc.html`); "the agent footer reads Claude: <account> only".
- `launcher`: "the chip opens the three columns with focus on Start, band 360px" (screenshot matching
  `Columns.dc.html`); "↑↓ in the open Start column move without folding"; "a click on a Start row picks and folds, focus
  back on Project"; "a digit in Start picks and folds"; "Enter in Start folds and does not launch"; "Tab, → and a click
  on another column each fold the open Start column with no pick"; "Escape folds the Start column, a second Escape
  closes the dialog"; "← from Project opens the Start column"; "the chip names Quick run and Council for those picks,
  and the third column takes the rest for each"; "Project rows are names only, the path in their title"; "no keycap is
  drawn in any column"; "the New button and Mod+N open folded on Project".
- `tools-launcher`: "the chip names Tool and the Tool list takes the rest of the width".
- `new-run-window`: "Mod+Shift+R and __openLauncher open folded on Project with the run's chip".
- `brainstorm-approve-run`: "Approve opens the dialog folded, the chip naming Orchestrate".

### Task 5: CDP scenarios for the decluttered dialog
**Depends on:** Task 3 (asserts the Task row, flag chips and Command toggle it draws), Task 4 (drives the chip, the folded band, Project focus and the footer it draws)
**Files:** `scripts/cdp/scenarios.mjs`, `scripts/cdp/council/fixtures.mjs`, `scripts/cdp/council/tree.mjs`

Bring every scenario that drives the New dialog in line with D1–D8, and add the steps Tasks 2–4 name.

- One shared helper in `scenarios.mjs` (exported for the council scripts) opens the Start column when it is folded
  (clicks `[data-launcher-chip]`) and waits for `[data-start-row]`; every place that clicks or reads a Start row, or
  presses a Start digit, goes through it: `launcher`, `launcher-empty`, `launcher-resume`, `launcher-resume-older`,
  `launcher-images`, `tools-launcher`, `tools-app` (~45679), `new-run-window`, `brainstorm-mode`,
  `brainstorm-approve-run` (`BAR_LAUNCHER` reads the checked Start row, ~29704: read the chip's pick instead),
  `codex-worker-route` (~26283), `capacity-warn` (~38057–38082), `agy-harness` (~41795, ~41915), and in the council
  scripts `openSetupFromNew` (`council/fixtures.mjs` ~250) and `council/tree.mjs` (~216). `launcherState` reports the
  chip's pick and whether the Start column is open.
- Footer expectations of "Starts in" / "Resumes" become `Claude: <account>` (or empty); session-row text no longer
  carries "tok"; the Command line is read after opening `[data-launcher-command-toggle]`; `launcher-resume` step 2's
  `taskHint` reads the field's placeholder.
- Add every step named in Tasks 2, 3 and 4's acceptance, with a screenshot where it names a board
  (`cdp-shots/launcher-*.png`, `launcher-resume-*.png`), driven through the rendered controls (clicks and
  `launcherPress`), not fixture setters. Width steps read `getBoundingClientRect()` of the Project and third columns
  and the band. `launcher-resume-older` seeds one session with a title too long for the row. The "no transcript read"
  step counts the RPC calls that read a transcript (wrap the frontend RPC send in the page) between opening the dialog
  and picking a session row, and expects none.
- `brainstorm-hints`: the New dialog has no `[data-brainstorm-start-hint]`; the Agent surface hero's assertion stays.
- Teardown stays as today.

Acceptance: `node --check` passes on the three files; `node scripts/cdp/final-verify.mjs launcher launcher-resume
launcher-resume-older launcher-images launcher-empty tools-launcher tools-app new-run-window brainstorm-hints
brainstorm-mode brainstorm-approve-run codex-worker-route capacity-warn agy-harness council-tree council-setup` passes
on the merged result.

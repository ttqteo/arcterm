# New launcher: one dialog for agents and runs — design

Date: 2026-10-08. Status: approved design, not yet planned.
Mockup: `.superpowers/design/new-launcher/project/Main.dc.html` (gitignored; interactive) plus seven state boards
beside it (QuickRun, Orchestrate, OrchestratePlan, ProjectFilter, AgentOptions, Terminal, NoProjects).

Supersedes, for this dialog only: decision D3 of `2026-06-26-launcher-polish-design.md` (no outside-click dismissal),
the New Agent row of the `dismissOnBackdrop` table in `2026-07-03-shared-modals-motion-design.md`, and the New run
window layout of `2026-09-29-worker-reviewer-models-design.md` §9 (the 380px column and the `ProjectPicker` field).
New Project and the Claude sign-in modal keep `dismissOnBackdrop={false}`.

## Goal

Today New agent (`Mod+N`, `newagentmodal.tsx`) and New run (`Mod+Shift+R`, `NewRunModal` in `newruncontrol.tsx`) are
two dialogs that both start with "pick a project", look different, and answer the keyboard differently. New agent
does not close on an outside click; New run does. Neither has keys for picking.

One dialog replaces both. You pick what to start from one list, pick a project, fill in the details for that pick,
and launch, all from the keyboard: `Mod+N 3 Tab 2 Tab "fix…" Mod+Enter` starts a Quick run in the second project.
An outside click closes it without losing what you typed.

## Decisions

- **D1. One Start list.** The left column lists what can be started: the installed agent runtimes, Terminal, then
  Quick run and Orchestrate under a "Run" label. The details under the columns change with the pick. There is no
  mode tab above the columns; this keeps one level of choosing and one numbering.
- **D2. Numbers follow the visible rows.** A runtime whose CLI is not installed stays hidden, as today
  (`isRuntimeOffered`), and the rows are numbered 1..n in display order. With Claude Code alone installed that is
  1 Claude Code, 2 Terminal, 3 Quick run, 4 Orchestrate. Showing uninstalled runtimes dimmed so the numbers never move
  was rejected: three dead rows for a number that only shifts when a CLI is installed.
- **D3. Digits pick in the focused column.** One rule for both lists: `1`–`9` pick the nth row of the column that
  has focus. Tab moves between columns and fields. Digits never act while a text field has focus.
- **D4. Outside click closes, and the draft survives.** The dialog uses ModalShell's default
  `dismissOnBackdrop`. D3 of the launcher-polish spec forbade it because a close wiped what you had typed; here
  every way of closing keeps the draft, and reopening restores it, so the reason is gone.
- **D5. The title follows the pick**: "New agent" for an agent runtime or Terminal, "New run" for a run row. The
  primary button says what happens: Launch agent, Open terminal, Start run.
- **D6. Two doors, one dialog.** `Mod+N` and every "New agent" control open it on an agent row; `Mod+Shift+R`,
  "+ New run", the Brief's `r` and every run prefill open it on a run row. The app bar keeps both buttons.
- **D7. Width 720px** (`w-[min(720px,93vw)]`, `max-h-[86vh]`). The details region scrolls; the columns, header and
  footer do not. The plan preview table fits at this width with its title column truncating.
- **D8. Runs take no worktree switch and no flags.** The engine creates a run's worktrees and launches its workers;
  those controls belong to agent rows only.

## Layout

```
┌ New agent  · draft restored  Clear          [1–9] pick  [⇥] next   × ┐
├────────────────────────┬──────────────────────────────────────────────┤
│ AGENT        ↑↓ · 1–4  │ PROJECT                     last used first  │
│ [1] ✳ Claude Code   ✓  │ [1] arcterm                    ~/code/arcterm│
│ [2] ▢ Terminal         │ [2] thesis                      ~/code/thesis│
│ RUN                    │                                              │
│ [3] ⚡ Quick run        │                                              │
│     one worker, one goal                                              │
│ [4] ⑂ Orchestrate      │                                              │
│     lead plans, workers fan out                                       │
├────────────────────────┴──────────────────────────────────────────────┤
│ details for the pick (below)                                          │
├───────────────────────────────────────────────────────────────────────┤
│ Starts in /Users/…/arcterm · on main      Cancel esc   Launch agent ⌘⏎│
└───────────────────────────────────────────────────────────────────────┘
```

**Header.** The title (D5); "· draft restored" and a Clear button when the dialog opened on a kept draft (see Open,
close and draft); a key legend (`1–9` pick, `⇥` next) in mono keycaps; the close button.

**Start column** (236px, `role="radiogroup"`, one tab stop). Rows: a mono keycap with the row's number, the
runtime mark (`RuntimeMark`, `SquareTerminal`, lucide `Zap` for Quick run, `Network` for Orchestrate), the name, and
for run rows the shape description from `SHAPE_CARDS` on a second line. The selected row is `bg-surface-selected`
with an accent check. The "Agent" label carries "↑↓ · 1–n" while the column has focus.

**Project column** (`role="radiogroup"`, one tab stop). Projects in recent-first order
(`recentFirst(projectListAtom, recentProjectsAtom)`), each row a keycap (first nine rows), the name, and the folder
it sits in (`projectWhere`: `code`, or `~` for one directly in home), muted and right-aligned. The header reads "last used first" when
unfocused and "type to filter · 1–n" when focused. Typing shows a filter line (search icon, the query, "N of M") and
narrows the rows by a case-insensitive substring of the name; the selection moves to the first match when the
selected project is filtered out. The filter clears when focus leaves the column, so a list is never narrowed by a
query you cannot see. No match: "No project matches “q”. Esc clears the filter." No projects
registered: "No projects yet. Agents and runs start in a project folder." and a Register a project button that
opens New project (the launcher closes, keeping its draft).

**Focus is visible** by three cues on the focused column: its label brightens (`text-secondary`), its keycaps
brighten (`border-edge-strong`, `text-ink-hi`), and its selected row gains an inset `accent-700` ring. The unfocused
column's selected row keeps only the grey fill.

**Details, per pick:**

- *Agent runtime other than Terminal* (from today's New agent):
  - **Task**, always shown, "optional · sent as the first prompt", a 64px textarea. The "+ Start with a task" button
    goes: the field must be there for Tab to land in.
  - **Command**: the `›` input with flag chips and "+ Flag" as today. "Remember flags" moves out of the label row
    into the flag menu's footer as "Remember these flags for the next agent".
  - **Isolated git worktree** switch; when on, the branch field and its ▾ list sit on the same line ("on branch"),
    and the `worktreeOutcome` line sits under it.
  - The RAM warning, one line: "1.4 GB free of 8 GB. Another agent (~1 GB) may make the machine lag."
    (`newAgentRamWarning`, shortened; it still never blocks).
- *Terminal*: Command only (placeholder "default shell") and the line "A plain shell in the project folder. No
  agent, no task."
- *Quick run*: **Goal** (required, 112px, note "one fresh worker; it stops and asks if the goal turns out bigger"),
  **Model** (the lead `RoutePicker`), and the RAM warning worded "Another worker".
- *Orchestrate*: a row with **Start from** (A goal / A plan file, `pickTone`) and **Workers at once**
  (`WorkerStepper`, with `CapacityWarn` on the line under it); then the goal textarea (96px) or the plan path input
  with the plan preview (today's `PlanPane` / `PlanTable`), each followed by its `startNote`; then **Lead / Workers /
  Reviewers** route pickers as three equal columns; then the Prototype chip when a prefill brought one.

**Footer.** Left, one truncating line: for an agent row "Starts in <path> · on <branch>" (or "· worktree on
<branch>"); for a run row the blocker when there is one (`launchBlocker`: "Write the goal", "Give the plan's absolute
path", "Reading the plan…", a parser error, or "Pick a project"), else "Quick run in <project>" / "Orchestrator × N in
<project>". A launch error replaces the line in `text-error`, as today. Right: Cancel (`esc` hint) and the primary
`DialogButton` with the `⌘⏎` hint, disabled while a run has a blocker, reading "Starting…" while a run starts.

## Keyboard

Keys are local to the dialog (as the New run picker's were), handled by one keydown handler on the panel; nothing
is added to `bindings.ts`. Global bindings already stand down while the dialog is open (`modalOpen`).

| Key | Where | Does |
|---|---|---|
| (open) | | focus lands on the Start column |
| `1`–`9` | Start or Project column | pick the nth row of that column |
| `↑` `↓` | Start or Project column | move the selection, wrapping |
| letters, `-` `_` `.` space | Project column | extend the filter |
| `Backspace` | Project column | shorten the filter |
| `Tab` / `Shift+Tab` | anywhere | through the controls in order (Clear when shown, Start, Project, each field, Cancel, primary) and wrapping; focus never leaves the dialog |
| `Enter` | a column, or a one-line input (command, branch, plan path) | launch; a run with a blocker moves focus to the field that blocks it instead |
| `Enter` | a textarea (task, goal) | new line |
| `Mod+Enter` | anywhere | launch (ModalShell `onSubmit`) |
| `Esc` | anywhere | close the innermost open thing: flag menu, branch list, project filter, then the dialog |

Digits that name no row do nothing. A digit picks rather than filters in the Project column, so a name with digits
is reached by its letters. `Mod+N` then `Enter` still launches the defaults, because Enter in the focused Start
column launches (today the focused Launch button does it). The route picker keeps its own keys and its own Escape.

The Tab trap reuses `focusTrapTarget` from `modalfocus.ts`, as `dagmodal.tsx` does. The close button takes
`tabIndex={-1}` and stays out of the cycle, since Esc does the same. A handled Escape stops
propagation so ModalShell's window listener does not also close the dialog.

## Open, close and draft

**Open state.** `AgentsViewModel.newAgentOpenAtom` and `newRunOpenAtom` become one `launcherAtom` holding the door
that opened it, `"agent" | "run" | null`. Every opener calls `openLauncher(door, prefill?)`; `dispatcher.ts` reads the
one atom for `modalOpen`. `newRunPrefillAtom` moves into the launcher store as `launcherPrefillAtom`, same
`NewRunPrefill` shape.

**What a door selects.**
- `"agent"`: if the current pick is a run row, the last-used agent runtime is picked, or, the first time, the
  harness preference (`resolveDefaultRuntime`). An agent row already picked stays.
- `"run"`: if the current pick is an agent row, the run row for `runShapeAtom` is picked (the channel profile's
  shape, or the last one used; `quick` by default). A run row already picked stays.
- A prefill (palette Quick and Orchestrate, a project's "New run in it", a canvas's "Build this…") picks the run row
  for its shape, its project when registered, and its goal and prototype, as `prefillToLaunch` does now; it
  replaces a kept goal.

The two run rows read and write `runShapeAtom` through `setRunShape`, so the profile hydration in `runconfigstore.ts`
keeps deciding the shape until the user touches it, exactly as it does for the shape cards today.

**Closing.** Esc, the close button, Cancel and a mousedown on the backdrop all close and keep the draft.

**The draft** is the pick, the project, the task, the goal, the command text per runtime, the worktree switch and
branch, the plan path (already `planPathAtom`) and the prototype. It lives in jotai atoms in `launcherstore.ts`, in
memory only, so it survives a close and a surface switch but not an app restart (today's New agent state is the same).
The filter is not part of it; it clears on close and whenever focus leaves the Project column.

**After a launch** the task, goal, plan path, prototype, command override and worktree switch clear; the pick, the
project and the flags (subject to Remember) stay. A run launch still calls `endRunConfigDraft`.

**"Draft restored"** shows in the header when the dialog opens with a non-empty task, goal, plan path or prototype
left by a close. Clear empties those and turns the worktree switch off.

## Code shape

New, under `frontend/app/view/agents/`:
- `launcher.ts` + `launcher.test.ts` — pure: the Start rows from the harness list and their numbers; the door's pick;
  title, primary label and footer line for a pick; the project filter; `launcherKey(ctx, key)`, which maps a key in
  a given focus position to an action (`pick-start`, `pick-project`, `move`, `filter`, `launch`, `dismiss-inner`,
  `close`, `none`); whether "draft restored" shows.
- `launcherstore.ts` + `launcherstore.test.ts` — the atoms above; `openLauncher`, `closeLauncher`,
  `clearLauncherDraft`, `endLauncherDraft`.
- `launchermodal.tsx` — the ModalShell, header, the two columns and the footer, `data-launcher` on the dialog's root.
- `launcheragentfields.tsx` — the agent details, moved out of `newagentmodal.tsx`, and the branch reading as a hook.
- `launcherrunfields.tsx` — the run details: `StartToggle`, `PlanPane` and `PlanTable` moved out of
  `newruncontrol.tsx`, and the route pickers laid out as the Models row.
- `launcherrun.ts` + `launcherrun.test.ts` — starting a run (below).

Submit paths do not change: an agent row calls `launchAgent` (`cockpit-actions.ts`); a run row runs the body of
today's `NewRunModal.start` (channel, route, `createRun`, `noteRecentProject`, `endRunConfigDraft`), moved into
`launcherrun.ts` as `startLauncherRun` so the view stays thin; the dialog then closes and calls `openTarget`.

Changed openers: `agents.tsx`, `dispatcher.ts`, `bindings.ts` (`new-agent`, `new-run`), `app-bar.tsx`,
`command-palette.tsx`, `actions/project.ts`, `canvaspane.tsx`, `agentheader.tsx`, `agentlaunchhero.tsx`,
`filessurface.tsx`, `cockpitsurface.tsx`, `conversationhistory.tsx`, `cockpit-actions.ts` (the `launch:pi`
fallback), and the mount in `cockpit-root.tsx`.

Removed: `newagentmodal.tsx`; `NewRunModal` and `NewRunModalHost` (`newruncontrol.tsx` goes once its sections have
moved); `projectpickerview.tsx`. `projectpicker.ts` keeps what the project column uses (`homeFromInfo`,
`projectWhere`) and drops the rest with its tests.

## Testing

- **Unit (vitest):** `launcher.test.ts` covers numbering with Claude-only and all-five harness lists, every row of
  the key table including digits past the end and filter edits, door picks from each kind of current pick, footer
  lines and blockers per pick, and the filter's selection rule. `launcherstore.test.ts` covers opening with each door
  and with a prefill, that every close keeps the draft, that a launch clears it, and Clear.
- **CDP:** a new `launcher` scenario in `scripts/cdp/scenarios.mjs`: open with the app bar's New agent button (the
  `Mod+N` binding itself is unit-tested in `bindings.test.ts`); assert focus is on the Start column; press a digit and assert the pick and title; Tab, type a filter and assert the rows; Tab into Task and type;
  Esc, reopen, assert "draft restored" and the text; mousedown on the backdrop and assert it closed. Screenshots of
  the agent, Terminal, Quick run, Orchestrate goal, Orchestrate plan, filter and agent-options states. `new-run-window`,
  `capacity-warn` and `palette-goal` move to the new selectors (`[data-launcher]`, a `data-start-row` attribute on each Start row).
- `task check:ts`, and `npx eslint` / `npx prettier --check` on the touched files.

## Docs

- `CHANGELOG.md` (Unreleased, Changed): New agent and New run are one dialog; pick with number keys, Tab between
  columns, type to filter projects; a click outside closes it and keeps what you typed.
- `docs/keyboard-shortcuts.md`: the `Mod+N` / `Mod+Shift+R` rows say they open the one dialog, plus a short "In the
  New dialog" table mirroring the Keyboard section.
- `docs/orchestrator-guide.md`: Flow 1's and Flow 2's text describe the new dialog. Its screenshots 02 and 04 go stale
  and are listed in `docs/open-issues.md` for the next Windows capture pass.

## Out of scope

The Brief sheet's `RunLauncher` (`briefsheet.tsx`, from `runlauncher.tsx`) and the Profile view keep their controls. No new
runtime, no change to what a launch does, no persistence of the draft across app restarts, and no "Sharpen" action
(`2026-07-14-new-agent-task-sharpening-design.md` stays unimplemented).

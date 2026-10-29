# New dialog, decluttered — design

Date: 2026-10-28. Status: shipped (run d0dcd0fb, 2026-10-28).
Mockup: `.superpowers/design/new-launcher-declutter/project/Main.dc.html` (gitignored; interactive) plus three state
boards beside it (NewSession, ProjectFocus, Columns). BottomB, a rejected option kept only for reference, is in the
sibling `rejected/` folder.
Brainstorm: `.superpowers/brainstorm/new-launcher-declutter/brainstorm.json`.

Amends `2026-10-08-new-launcher-design.md` (the New dialog, `launchermodal.tsx`) and
`2026-10-09-launcher-resume-and-images-design.md` (the Session column). What it does not mention stays as those specs
say: the draft that survives a close, outside-click dismissal, the Start rows and their order, the run and tool fields,
Open asleep, image paste.

## Goal

The dialog should show enough about past sessions to resume one quickly, without the clutter it has today. Agent and
Project only need enough room to be picked.

What is cluttered today (screenshot of 0.15.x, `launchermodal.tsx`, `launcherresumelist.tsx`):

1. Three columns of equal weight (Agent 236px, then Project and Session sharing the rest), each with its own 1–9
   keycaps: three runs of digits side by side.
2. The Session column is the one with the most to say and the narrowest: titles are cut ("Head-to-head RQ1 M4te…"),
   and so is the "5d · 22.9…" meta.
3. The Project column spends about half its width on the parent folder (`D:\code\work`, repeated row after row).
4. The Command row prints `claude --resume <uuid>`: a full-height row few people read.
5. The footer repeats the session's title, branch and account, and is cut ("Claude: q…").

## Decisions

- **D1. Agent folds into a chip.** The Start column (Agent, Run, Tool, Council rows) folds into one chip on a line
  under the header: the pick's mark, its name and a chevron (`✳ Claude Code ▾`, `Quick run ▾`, `Tool ▾`). Pressing the
  chip opens the Start column again, the three columns as today; picking a row there folds it back and focus returns
  to Project. The chip is an ordinary button in the Tab order.
  - *Agent's call:* folded, the Start column's rows are not rendered at all: the chip replaces the column in the DOM,
    so a test or script that picks a Start row opens the chip first.
- **D2. Project stays one step away.** Beside it, Project is a narrow column (~172px) of names only, with no parent
  folder; Home stays pinned under the list. Changing project is one click (or, as today, one key while Project has
  focus). A layout that slid Project away to make room was tried and rejected: it made changing project a two-step
  action.
- **D3. The pick's own column takes the rest.** The column after Project takes all of the remaining width, ~650px at
  the 840px dialog. This holds for every pick, not only agents: the Session list for an agent runtime, `RunColumn` for
  Quick run and Orchestrate, the tool list for Tool, the note for Council and Terminal. One layout for every pick, so
  the dialog does not change shape when the pick changes.
- **D4. A session row is one line: title and last active.** `sessionTitle(s)` on the left, `formatAge(now -
  lastactivets)` on the right ("2m", "1d"). The token count leaves the row. A title too long for the width ends in "…"
  with the full title in the row's `title` tooltip, as today. "New session" stays pinned first.
- **D5. No preview panel, no transcript read.** A preview of the picked session (first prompt, last message, branch,
  model, cost) was drawn and rejected: not needed for now. The dialog reads no transcript when it opens or when a row
  is picked.
- **D6. Task on one row; Command folded; footer short.** The details region under the columns becomes one row for an
  agent pick: the Task field (one line, growing as text wraps or an image is attached; paste and drop images as
  today), then `+ Flag` and the Worktree switch (a new session only, as today), then a `Command ›` toggle. The command
  line shows only when that toggle is open, in a code strip under the row. Worktree on opens the branch field on a row
  under the Task row. The footer keeps only the account (`Claude: <account>`) and the buttons (Cancel, Open asleep,
  the primary action): the session title, branch and starting folder leave it.
  - *Agent's call:* opening `Command ›` shows today's editable command input, flag chips inside it
    (`launcherCommandAtom` per runtime, unchanged). A Terminal pick, which has no Task, shows it open.
  - *Agent's call:* `+ Flag` stays on a resumed session, as today (`resumeLaunchSpec` applies the flags). The enabled
    flags also show as chips on the Task row beside `+ Flag`, so they are visible while Command is folded.
  - *Agent's call:* the footer's blocker messages stay (Pick a project, a tool not on PATH, a run that cannot start).
    The run, tool and council footers stay as today. Only the agent footer drops "Starts in" / "Resumes" / the branch,
    keeping the account when the runtime has one. A worktree's new branch shows in the branch row's hint, which is
    `worktreeOutcome`'s text verbatim, unchanged ("Creates new branch X off Y", "Checks out existing branch X in a
    worktree", "Enter a branch name").
  - *Agent's call:* the RAM warning, Home's ask-only explanation and the Terminal note stay, each a line under the Task
    row as today. The Task hint (sent as the first prompt or the next message) moves into the field's placeholder.
  - The brainstorm start hint (`START_LINE`, `data-brainstorm-start-hint`) leaves the dialog; it stays on the Agent
    surface's empty state (`agentlaunchhero.tsx`). The plan removes the dialog's CDP assertion for it.
- **D7. Opens folded, focus on Project.** `Mod+N` (and every door into the dialog) opens it with the Start column
  folded into the chip and focus on the Project column, replacing today's focus on the Start column
  (`launchermodal.tsx:358`).
  - *Agent's call:* this is intended. After `Mod+N`, letters filter the projects and a digit picks a project; the
    2026-10-08 flow "`Mod+N`, type the task, `Mod+Enter`" goes away (the person does not use the dialog's keys).
- **D8. No keycaps, no key hints.** The 1–9 keycaps at the start of rows (`Keycap`, `launcherrows.tsx`) and the key
  hints in column labels ("type to filter · 1–9", "↑↓ · 1–8") are not drawn. Every key that works today keeps working
  (`launcherKey`, `resumeListKey`; digits, letters to filter, ←/→ between columns, Enter); no new key is added. Labels
  that are not key hints stay ("last used first", "10+ · newest first").
  - *Agent's call:* with the Start column open, a click, a digit or Enter picks a row and folds the column; ↑↓ only
    move (still picking the row on each step, as today) and do not fold. While folded, ← from Project unfolds the chip
    and focuses the Start column: the same meaning ("go to the Start column") it has today.
  - *Agent's call:* the open Start column also folds when focus leaves it (Tab, →, a click on another column), with
    or without a pick.
  - *Agent's call:* Escape with the Start column open folds it; it joins the 2026-10-08 Escape order before "close the
    dialog".
  - *Agent's call:* Enter in the open Start column picks and folds, and never launches: launching takes a second Enter.
    `launcherKey` and its tests may change for this and for Escape.

## Layout

```
┌ New agent                                                          × ┐
├──────────────────────────────────────────────────────────────────────┤
│ [✳ Claude Code ▾]                                                    │
├──────────────┬───────────────────────────────────────────────────────┤
│ PROJECT      │ SESSION                            10+ · newest first │
│ mit-thesis   │ + New session                                         │
│ portfolio-j… │ Head-to-head RQ1 M4te…                           now  │
│ arcterm      │ Prompt làm tiếp trên Mac                          2m  │
│ …            │ Độ khó phát triển harness                         1d  │
│ ──────────   │ …                                                     │
│ Home         │                                                       │
├──────────────┴───────────────────────────────────────────────────────┤
│ TASK [optional…                        ] +Flag  ◯ Worktree  Command ›│
├──────────────────────────────────────────────────────────────────────┤
│ Claude: <account>              Cancel esc  Open asleep  Resume agent │
└──────────────────────────────────────────────────────────────────────┘
```

The dialog keeps its width (`w-[min(840px,93vw)]`) and `max-h-[86vh]`. With the chip opened, the band below the chip
line is today's three-column grid.

## Left to the builder

- The fold/unfold motion of the Start column. *Agent's call:* none: the chip and the open column swap in place, and
  the band keeps its 360px height either way, so nothing on screen moves.
- Exact widths (Project ~172px) and truncation of titles with the full title in the tooltip.
- Where the picked project's folder shows, now that the Project column drops it. *Agent's call:* the row's `title`
  tooltip only (Home's too, as today); nothing beside the Agent chip.
- The one-line Task field growing with wrapped text or an attached image. *Agent's call:* `field-sizing-content`
  from one line up to today's `max-h-[240px]`, then it scrolls.
- Whether `Command ›` remembers being open between openings of the dialog. *Agent's call:* it does not: every
  opening starts folded (a Terminal pick shows it open), in component state, no new atom.
- Update `footerLine` (`launcher.ts`) and its tests; update the CDP scenario of the New dialog in
  `scripts/cdp/scenarios.mjs`.
- Hide `Keycap` and the key hints of `ColumnLabel` in this dialog. Key handling stays as today except where D7 and D8
  change it; `launcherKey` and its tests change for those.
- The column band is 360px tall whether the Start column is folded or open (mockup).

## Context

- `SessionInfo` on the wire (`frontend/types/gotypes.d.ts`) carries task (the title), branch, model, tokenstotal,
  lastactivets. The Go struct (`pkg/agentsessions/agentsessions.go:91`) also has CostUsd, Status, StartedTs and
  DurationMs, not sent to the frontend. Nothing here needs a backend change.

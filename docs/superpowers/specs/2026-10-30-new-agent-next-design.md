# New dialog, Task on top — design

Date: 2026-10-30. Status: built, not yet tried in the app (hand check in `docs/open-issues.md`).
Mockup: `.superpowers/design/new-agent-next/project/A-task-top.dc.html` (gitignored). The two options not chosen (a New
page in the middle of the Agent surface, and agent and tool tiles) are in the sibling `unchosen/` folder.
Brainstorm: `.superpowers/brainstorm/new-agent-next/brainstorm.json`.

Amends `2026-10-08-new-launcher-design.md` (the New dialog, `launchermodal.tsx`) and the partly reverted
`2026-10-28-new-launcher-declutter-design.md`. What it does not mention stays as those say: the three columns and
their keys, the Session column, the run, tool and agent fields, the draft that survives a close.

## Goal

Not a fix: the three-column dialog has no bug. This tries a new layout to compare against it, keeping what the person
asked of the dialog: everything laid out at once (no ChatGPT-style single box with chips), and the most common New, a
new agent in the project you are in, as short as it can be. That New was Mod+N, then finding the Task box, then
Mod+Enter; it becomes Mod+N, type, Enter.

## Decisions

- **D1. The pick's fields come first.** The region that held the Task row, flags, Worktree and Command (or a run's
  Goal and its settings, or a tool's fields) moves above the three columns, under the header. The columns keep their
  layout, widths and keys. A field region too tall for the dialog scrolls; the columns never do.
- **D2. The Task box is three lines tall when empty** (69px), and grows with its text as before, up to about eleven
  lines, then scrolls.
- **D3. Focus opens in the box.** An agent opens in its Task box, a run in its Goal (a run from a plan file in its plan
  path box). A terminal, a tool or a council has no box and opens on the Start column, as before.
- **D4. Enter launches from the box; Shift+Enter is its newline.** Mod+Enter still launches from anywhere. An Enter or
  Escape an IME is composing with is the IME's (`isComposing`, or key code 229), here and in every zone.
- **D5. Alt+1–9 picks a Start row from the box**, read from the key's code so Option+digit on a Mac works. Project and
  Session are a Tab away: Tab and Shift+Tab walk the box and its fields, Start, Project, the third column, Cancel and
  the launch button. When the new pick has no box, focus goes to the Start column. The Start column's label shows
  `alt 1–n` while the box has focus.
- **D6. A pick with no task keeps the box's place.** Terminal, Tool and Council draw a dashed line where the box is,
  saying why it is empty ("A terminal takes no task: it opens a shell."), so the dialog keeps one shape whatever is
  picked.
- **D7. What stays.** A resumed session's Task is still the next message; Enter in a column still launches, and
  Shift+Enter there still opens a picked session asleep; a letter typed in the Start column still lands in the box;
  paste and drop images, the draft kept on close, Escape, and the footer are as before.

## Code

- `launcher.ts`: `FocusZone` gains `"task"` (the Task or Goal box; any other textarea stays `"textarea"`).
  `LauncherKeyIn` gains `altDigit` and `composing`. `launcherKey` returns nothing while composing; in `"task"` it maps
  Enter to launch and Alt+digit to `pick-start`. Tests in `launcher.test.ts`.
- `launchermodal.tsx`: the fields region above the band, the opening focus, the `"task"` zone, the Alt+digit fallback
  focus, the Start label's hint. `NoTaskBox` in `launcherrows.tsx`.
- `launcheragentfields.tsx`: the Task box's height and its hint, which names Shift+Enter.

## Verify

`task verify:ui -- launcher launcher-resume launcher-images new-run-window`: the opening focus (launcher 1, 21, 28;
launcher-resume 1; new-run-window 2, 8b), Tab wrapping to the box (launcher 2, 17), Alt+digit onto Terminal (launcher
2b), and the box's height (launcher-images 1b).

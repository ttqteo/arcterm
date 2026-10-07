# Jarvis: initiatives as cards beside an ideas column

Status: approved 2026-10-07 (option 3 of the `jarvis-initiatives` canvas). Prototype:
`.superpowers/design/jarvis-initiatives/project/TwoColumn.dc.html` (card states in `States.dc.html`).

## Problem

The Initiatives region of the Jarvis brief is hard to scan:

- Each row puts the whole active chunk label after the title ("Line review follow-ups — ReviewPatch: read git
  diff's stdout alone (runErr's CombinedOutput…"). `initiativeLine` only cuts at `" - "`, which most labels lack.
- Progress is a 92 px bar that reads empty at `0/7` and says nothing about which step is next.
- Every row repeats a green "active" and a second line such as "no notes yet".
- Ideas share the full-width row, so a short idea runs the whole page width with its project at the far edge.
- The row menu (rename, edit, pause, archive, delete) only shows on hover, so it is easy to miss.

Two smaller problems sit around it: an empty Waiting-on-you region still draws a dashed box, and a direct agent's
run title repeats itself ("Màu mờ khó đọc · Màu mờ khó đọc").

## Design

The Initiatives region becomes two columns: trackers as cards on the left (about two thirds), ideas as a narrow
list on the right (about one third). Runs and Behind you stay full width below.

### Tracker card

One card per initiative that has chunks, two per row (`grid-cols-2`), `bg-surface-raised border-edge-mid`,
radius 10 px. Top to bottom:

1. **Title** (14 px semibold, one line, truncated) with **meta** under it: `ticket · project`, or `no project`.
   Right of the title: a **state chip** only when the state is not plain active (`N blocked` amber, `paused`
   grey, `deferred` grey, `archived` faint, `agent working` green when an agent is open on it), then the `⋯`
   button, always visible.
2. **Segmented bar**: one segment per chunk in plan order, coloured by chunk tone: done `success`, the active
   chunk `accent`, blocked `asking`, deferred `ink-faint`, pending `edge-strong`. Skipped chunks are left out,
   matching the count's denominator. The `done/total` count sits at its right. Past 24 chunks the segments
   lose their gaps and read as one bar.
3. **Next**: the active chunk's full label on one line, truncated, the full text in its `title`. A blocked
   initiative says **Blocked on** with the first blocked chunk; a finished one says **Done** · all N chunks done.
4. **Footer** above a hairline: the existing resume line (status, when, last note) and the existing Work on /
   Go to it button. A paused card dims and offers Resume; a finished one offers Archive.

Clicking a card opens it as today, but the opened card spans both columns (`col-span-full`) and shows
`InitiativeDetail` inside it, so the chunk editor keeps its width. The rename input replaces the title in place.

### Ideas column

Header `Ideas · N` with "not planned yet". One quiet panel (`bg-surface`, `border-border`) holds one row per idea:
lightbulb, title wrapped to at most two lines (full text in `title`), project under it, and an always-visible `⋯`.
Its last row is **+ Jot down an idea**, which opens the existing New initiative form. Clicking an idea opens its
detail inside the column, where chunks are added; once it has a chunk it moves to the cards.

### Layout and caps

- The two columns are a wrapping flex row: cards `flex-[2_1_520px]`, ideas `flex-[1_1_300px]`. Below about
  850 px of surface width the ideas column drops under the cards.
- Trackers and ideas are capped separately (`EFFORT_CAP` 6 cards, a new `IDEA_CAP` 6 ideas), each with its own
  `+N more`, so ideas never push a live tracker behind "Show more" and the reverse.
- The region keeps its id, filter, `only` mode and j/k order: cards first, then ideas.
- Archived initiatives ("Show N archived") render as dimmed cards in the left grid.

### Around it

- **Waiting on you** is not drawn when its queue is empty and no filter or `only` mode is on; the header's
  all-clear chip already says it.
- **Run titles**: a direct agent's name is `name · task` only when the task is set and differs from the name.

## Out of scope

Runs and Behind you anatomy, the inline tracker's own design, new initiative actions (the menu keeps today's
items), and any backend change: `EffortSummary.chunks` already carries every chunk's status.

## Testing

- Pure logic, unit-tested beside it: chunk segments from an effort's chunks (tones, skipped dropped, the 24-chunk
  rule); the card's state chip and Next line per state; the tracker/idea split with separate caps; the agent
  run name rule.
- Visual: extend the `brief-initiatives-polish` CDP scenario (or add `brief-initiatives-columns`) to shoot the
  two columns with fixture efforts covering in progress, blocked, paused, done and a long idea title, plus an
  opened card spanning both columns and a narrow window where ideas drop under the cards.

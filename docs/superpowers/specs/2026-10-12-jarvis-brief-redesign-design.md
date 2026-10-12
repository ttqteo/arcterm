# Jarvis Brief redesign: what needs you first, everything on one screen

Status: approved 2026-10-12. Mockup: `.superpowers/design/jarvis-overview/project/` (gitignored canvas; boards
Main, Current, Proposed-Brief, Proposed-ChunkPanel, Proposed-ChunkPanel-States, Proposed-RunSheet,
Proposed-AllClear).

## Problem

The person called the Jarvis surface hard to use. A review of the code and of screenshots of the dev app (1600×1000
and 1280×800, the `attention` fixture and live data) found three kinds of trouble.

**Bugs.**

1. `i` (focus the composer) and its `Esc` never fire. `bindings.ts` queries `[data-jarvis-composer]`, but the
   composer (`briefcomposer.tsx`) carries `data-jarvis-brief-band="composer"`. The Brief tour teaches `i`.
2. A run row with no `Run` object (a direct agent, or a run not loaded yet) always takes tone `ok`
   (`briefrows.ts` `runRowFace`, the `run == null` branch). `blocked` reads green, with a pulsing green dot.
3. The first-visit tour offer (`TourOffer`, `absolute right-4 top-[60px]`) covers the right end of the first region.
   That is where the Waiting summary's **Review N** button sits, the only control that opens the queue.
4. A chunk note whose run can no longer be read shows a skeleton forever (`chunksidebar.tsx` `NoteRun`: `run ==
   null` means skeleton, and a run that is gone never settles). Seen on run `97212838` for over a minute.
5. Docs describe keys and parts that are gone or never existed: `d` (context rail) and `c` (new channel),
   both removed with B5; a composer at the top of the Brief that starts runs; an **Ask Jarvis** dock button. `r`
   (New run) and `Shift+N` (New initiative) are bound but missing from `docs/keyboard-shortcuts.md`. Comments in
   `bindings.ts` (the Jarvis block) and `newinitiativecontrol.tsx` still mention `+ Channel` and the context rail.

**Layout.**

- Waiting on you opens folded into one summary line on every launch (`briefExpandedAtom` defaults to `{}`), and its
  rows are not on the `j`/`k` list until **Review N** is clicked.
- Initiatives sit above Runs. With live data (18 initiatives) six ~180px cards, "+12 more" and "Show 2 archived"
  fill the first screen; Runs starts at y≈816 and the rest of the page is below the fold.
- The Ideas column keeps a third of the width with zero ideas.
- Opening an initiative moves its card out of its grid cell into a full-width row at the end of the grid, which leaves
  a hole beside the card before it.
- The header has no New run. The autonomy chip is the longest item in it.
- The footer shows no Jarvis keys.

**The chunk sidebar.**

- The chunk label is the panel title at 16px, often four lines.
- A raw `wsh effort note <uuid> "<label>"` sits right under the title.
- Every chunk row in the opened initiative repeats a `pending ▾` dropdown.
- The note box uses the whole chunk label as its placeholder.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Waiting shows its 3 most urgent items as rows under the summary line; the rest fold behind **Show all N**. All shown rows are on `j`/`k` | Reverses half of `4d0be72c8` (2026-09-15, "waiting work reads at a glance"): the summary line stays, but the work is visible without a click |
| 2 | Region order in the main column: Waiting, Runs, Initiatives | What needs you, then what is moving, then the backlog |
| 3 | A 340px side column holds **Since you looked**, **Shipped** and **Ideas** | Puts the record of the past beside the work, not below it; ends the empty Ideas column |
| 4 | "Behind you" splits into **Since you looked** (events after the visit cursor) and **Shipped** (7-day window) | The two have different time bases; the docs and the tour already say "Since you looked" |
| 5 | Initiatives are dense one-line rows, not cards; blocked ones first, then ones with an agent open, then by last activity; paused last | 18 initiatives fit; the order says where the next hour goes |
| 6 | An opened initiative expands in place under its row | No jump, no hole |
| 7 | The chunk panel docks in the side column's place on a wide Brief | The main column keeps its width |
| 8 | **Work on this chunk** in the chunk panel | Today only the whole initiative can be worked on |
| 9 | Copy: **Accept** replaces Acknowledge everywhere; **Go to agent** replaces Go to it; the autonomy chip names the consequence (**Routine asks: auto** / **All asks: to you**); dates in the Brief read `Oct 9` | DESIGN.md Copy: a button says what happens, names follow what the user manages; `10-09` is ambiguous |
| 10 | UI copy stays English | Settled with the person |
| 11 | A region heading is no longer a button. A small **Show only** icon button at its end (`aria-pressed`) does what a click on the heading did | A misclick on a full-width heading hid every other region |

## Design

### Header

Left to right: `◈ Jarvis`, `all work · N projects`, the waiting chip (`N waiting` / `all clear`), the fleet line, a
flexible gap, the filter (200px, `/`), a settings group of three quiet controls (the autonomy chip, Profile, Tours
`?`), a divider, **New initiative** `⇧N` (secondary), **New run** `r` (the one accent button on the surface).

The autonomy chip label comes from the consequence, not the tier name: concierge → **All asks: to you**, gatekeeper →
**Routine asks: auto**, mixed → **Mixed · K of N auto**. The popover keeps the rung names and blurbs, which explain
them. `title` holds the long form.

### Body

A two-column grid: main `minmax(0, 1fr)`, side `340px`, gap 28px. Below a Brief container width of 1100px the side
column drops under the main column (a container query, as the chunk sidebar already uses).

**Waiting on you** (main, only when the queue is non-empty, or while filtering or in Show only):

- The head: dot, label, count, rule, `gates first · oldest 1d`, and the tools: **Accept K unverified** when K > 1.
- The summary line (`summarizeAttentionQueue`) stays as the first line of the region's box.
- Under it, the first 3 queue rows in queue order, each with its in-place action (Approve, Answer, Open, Accept).
- More than 3 rows: a **Show all N** / **Show fewer** control. The expansion is the existing `briefExpandedAtom.waiting`.
- Filtering shows every match, as today.

**Runs** (main): unchanged rows, moved above Initiatives. The `run == null` face takes its tone from the line's own
state (bug 2): `blocked` and `asking` are amber, `running` green, anything else muted, and the dot follows.

**Initiatives** (main): one row per live initiative in a bordered box:

- The row: title and project; a segment bar (150px) with `done/total`; the `Next` / `Blocked on` note; a status cell
  (`● blocked`, `● agent open`, or the last-activity date); **Work on** `w` or **Go to agent**; the `⋯` menu (the
  same items as today).
- Order: a pure `orderInitiatives(cards, agents)`: any blocked chunk or blocker first, then an open agent
  (`openAgentFor`), then by `updatedts` descending; paused after the rest.
- Cap 8, then `+N more`. **Show K archived** stays.
- Enter or a click expands the row in place (decision 6). The expansion shows the existing chunk editor
  (`InitiativeDetail`), restyled: each chunk is one row of status glyph, label (two lines at most), note count and
  status word. The per-row status dropdown goes. Status changes in the chunk panel, or on hover a status menu opens
  from the status word. `+ Add chunk`, `+ New stage` and the `Alt ↑↓ reorder · ⏎ open chunk` hint close the box.

**Side column:**

- **Since you looked**: the head shows `sinceLabel(...)` on the right and **Mark seen** (undoable) when there are rows.
  The rows are the delta groups (Run started, Run completed, Decision recorded, record updates), compact: the kind
  and age on one line, the title under it. Empty: "Nothing new since you last looked."; on a first visit, where there
  is no last look: "Runs that land show up here."
- **Shipped · 7 days**: today's Shipped rows, capped at 3 with `+N more`. Empty: "Nothing shipped in the last seven
  days."
- **Ideas**: the idea rows, then an inline input **Jot down an idea — Enter saves**. It creates an effort with a title
  only (`EffortCreateCommand` with no chunks) and needs no form. Esc clears it.

**Empty states** (Proposed-AllClear): no Waiting region (the header chip says all clear); Runs and Initiatives each
show a dashed box with one sentence and the button that starts one (**New run** `r`, **New initiative** `⇧N`).

**Loading, load failed, stale snapshot, no filter match** keep today's behaviour, laid out in the new grid. The
skeleton draws the main regions only.

### Chunk panel

It opens as today (Enter on a chunk, or a click). On a Brief container ≥ 1281px it takes the side column's place: the
grid becomes `minmax(0, 1fr) 460px`. Below 1281px it floats over the Brief as today.

- **Header (42px):** `Chunk`, `n / total`, ↑ ↓ (`k` / `j`), a gap, **Work on this chunk** (decision 8), **Copy wsh
  command** (the full `wsh effort note …` in the `title`), ✕ (Esc).
- **Body:** the initiative (and stage, for a staged plan) as a 10.5px crumb; the label at 14.5px; a meta line
  `N notes · last Oct 9 · Activity ↗`; the six-status radio group as one 26px row; then the notes, as today.
- **A note whose run cannot be read** shows "The run's report is no longer available." in place of the skeleton,
  once the read has failed or the run is known gone (bug 4). The skeleton stays only while the read is in flight.
- **Composer:** placeholder "Add a note…"; hint `Ctrl+Enter adds · Esc clears`.

**Work on this chunk** starts an agent through `workOnInitiative` with a new `{ chunk }` ask. Its prompt names the
chunk and says: read its notes, do it, add the result as a chunk note, mark it done. With an agent already open on the
initiative the button reads **Go to agent** and goes to that agent, as Work on does.

### Run sheet

- Order inside the scroller: the question cards (`AskCard`, `ChildAskCard`), then Tasks (or the report / evidence),
  then Timing, then Final check. Today Timing and Final check come first and push the question down.
- **Dock:** at most one accent button, the first that applies of Land again, Resume, Open DAG for a held merge. Open
  lead ↗ and Open in Agent ↗ sit together as one segmented group; Cancel run stays at the right.
- **Composer:** a label row "Message the lead" (or "the worker") with an `i` keycap and "goes straight to its
  terminal"; `i` and `Esc` work (bug 1).
- Chips: "attention" reads **N needs you**.

### Keyboard and footer

- Fix `i` / `Esc` to query the composer's real attribute (bug 1).
- `SURFACE_HINTS.jarvis` in `footerhints.ts`: `j k` move, `⏎` open, `space` peek, `r` new run, `w` work on, `/`
  filter, `⇧G` graph. `?` help comes from the global hints.
- `docs/keyboard-shortcuts.md` (Jarvis): drop `d`, `c`; add `r`, `Shift+N`; `i` now works on a live run sheet only.

### Tour

Steps follow the new layout and words: Since you looked, Show only (the icon button), Initiatives rows, the chunk
panel. The offer moves to the bottom right, above the footer, so it covers no control (bug 3). Step targets keep the
same data attributes where the element survives: `data-jarvis-brief-row="initiative"`, `data-jarvis-work-on`,
`data-jarvis-ideas`, `data-jarvis-initiative-detail`.

## Testing

- **Pure, with vitest:**
  - `orderInitiatives`.
  - The Waiting window (first 3, then Show all).
  - `runRowFace` tone with no run.
  - The autonomy chip label.
  - The chunk prompt.
  - The first-visit empty line.
  - The `i` binding's selector against the composer's attribute (a test that reads both constants).
- **CDP (`scripts/cdp/scenarios.mjs`):**
  - **`brief-surface`**: step 3 changes to "Waiting shows its first 3 rows under the summary".
  - **New `brief-layout`**: the header New run, the side column's three sections, Runs above Initiatives, the footer
    hints, no tour offer over a control.
  - **New `brief-chunk-panel`**: an initiative expands in place, the panel docks in the side column, and the
    run-gone note line.
  - **New `brief-run-sheet-order`**: a question card above Tasks.

## Out of scope

- The graph peek opening empty with no record named, and the graph's missing search: `docs/open-issues.md`, U3.
- The Profile modal and the New initiative form, except Jot down an idea, which no longer opens the form.
- Loading the visit cursor from the server; it stays in localStorage.
- Messaging an already-open agent about the chunk: **Work on this chunk** only goes to it.

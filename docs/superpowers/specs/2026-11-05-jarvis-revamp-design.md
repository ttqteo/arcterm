# Revamp Jarvis

Jarvis's Brief reads as four equal lists stacked in one column (Waiting on you, Runs, Councils, Initiatives) beside a
side column. Whatever sits lowest sinks: since Councils landed (`db396dd87`), Initiatives starts at the bottom edge of a
1170px window and shows about four dense five-column rows. The person opens Jarvis to pick the next piece of work and to
see overall progress, and the page does neither at a glance.

This spec gives each screen a form that fits what it holds, with a clear order: what matters is large and on top. It
covers every Jarvis screen the person chose to redo; the rest keep their behaviour.

Mockup (gitignored): `D:\src\arcterm\.superpowers\design\jarvis-page-redesign\project\` — `Main` (the Brief),
`Sheet` (an initiative in the sheet), `Council` (a council report in the sheet), `Chunk` (a chunk in the sheet, with the
status menu open). The canvas replaces `jarvis-overview`. It revises decisions 5 and 6 of
`2026-10-12-jarvis-brief-redesign-design.md` (initiatives as dense rows that open in place).

## What is redone, what is kept

| Screen | Here |
|---|---|
| Brief page (`briefsurface.tsx`) | Redone: decisions 1–6 |
| Initiative detail | Redone: opens in the sheet (decision 7) |
| Council report | New in the sheet (decision 8) |
| Chunk panel (`chunksidebar.tsx`) | Redone inside the initiative sheet (decision 9) |
| Waiting → Show all (`briefqueuesheet.tsx`), peek (`briefpeekview.tsx`), review pass | Behaviour kept; restyled to the cards and the sheet where they touch them |
| Run sheet (`runsheet.tsx`), New run launcher (`briefsheet.tsx` `ChannelLaunch`, `runlauncher.tsx`) | Kept as they are: the person finds the run sheet complete |
| Profile and principles, decision log, New initiative form, Link picker, tour content | Kept; the tour's copy and stops follow the new layout |

## Decisions

### 1. Page order

The main column holds, top to bottom: the Waiting strip, Initiatives (pinned cards, then every other initiative as a
list). Runs and Councils leave the main column and become one **Activity** region at the top of the side column. The
side column is then Activity, Since you looked, Shipped, Ideas. The header row is unchanged.

### 2. Waiting on you is a strip

One 44px strip at the top of the main column, edged in a faint `asking` amber: `● Waiting on you N`, the most urgent
item's kind chip (due, blocked, gate…), its title on one line, its own action button (the action the Waiting row has
today), and **Show all N ▾**, which opens the full queue in place (today's rows and behaviour). With nothing waiting the
strip is not drawn. The order is `briefqueue.ts`'s, unchanged.

### 3. Pinned initiatives are cards

- The person pins up to six initiatives; they show as cards in a 3 × 2 grid. With none pinned, the first six of
  `orderInitiatives` (blocked → agent open → most recent → paused) show instead, so the region is never empty on day one.
  The heading reads `Initiatives · Pinned N of M`, with **Review · N** at its right end (moved from today's head).
- A card: title (14px semibold, two lines at most) and a pin glyph; `project · updated <age>`; a large `done/total` with
  its percent and a status cell at the right (`● agent open` green, `● blocked` amber, `idle 2w` faint, else the date);
  the segment bar, one segment per chunk (done `success/45`, the active one full `success`, the rest `edge-strong`);
  `Next` (accent) or `Blocked on` (amber) with that chunk in two lines; **Work on** (or **Go to agent**, key `w`) and a
  `⋯` menu (today's row menu, plus Pin/Unpin).
- A pinned initiative that is archived or deleted drops out of the pins.
- Which initiatives are cards (Agent's call): once any initiative is pinned, the cards are the pins only, in pin order
  (1–5 pins leave the other slots empty, with a quiet "Pin an initiative" slot at the end); with none pinned, the first
  six of `orderInitiatives`. Whatever is a card is left out of the list under it, fallback cards included, so no
  initiative shows twice. The project tabs narrow the list only; the cards always show. `M` in `Pinned N of M` counts
  the live (not archived) initiatives, ideas excluded.
- Cards are `bg-surface-raised border-edge-mid`, radius 10px, with the grid one of DESIGN.md's card grids.

### 4. Every other initiative is one compact list

Under the cards: `All initiatives` with today's project tabs (all, arcterm, …, no project), then 36px rows: title ·
project, a small bar with `done/total`, `Next` and its chunk on one line, the date, and a pin button shown on hover or
cursor. Six rows, then `+N more`. Sub-initiatives keep their indent under their parent. Initiatives shown as cards are
not repeated in the list.

### 5. Activity merges Runs and Councils

At the top of the side column (360px): `Activity` with `N live`. Live runs and running councils are small cards (kind,
stage word in its status colour, title in two lines, `runtime · project · age`). Under them, `Earlier · 7 days`: one
30px line per finished council and per run that ended without shipping (failed, cancelled), with kind chip, title, age;
five, then `+N more`. Today's run filter (all, orchestrator, quick) moves into the Activity head as the same tabs, plus
`councils` (Agent's call). A run line opens the run sheet as today; a council line opens the council sheet (decision 8).

What else today's Runs region holds goes here too (Agent's calls):

- **Shipped stays its own region** and keeps the runs that shipped; Earlier never repeats them. The Activity tabs filter
  Shipped as today's run filter does. The run sheet's Previous/Next steps through live runs then Earlier (from
  Activity) or through Shipped (from Shipped), as today it steps `sessionLines` or `shippedLines`.
- **Queued runs** (`queuedRowsAtom`) are a `Queued N` line under the live cards that opens `briefqueuesheet.tsx` as today.
- **Accept N unverified** (`ackableRuns`) sits in the Activity head, as it sits in the Runs head today.
- **Older than 7 days** keeps its toggle at the end of Earlier (`+N runs older than 7 days`).
- A council that is `awaiting-you` or `queued` is a live card (its stage word says which); `awaiting-you` also reaches the
  Waiting strip, as it reaches Waiting today.
- The region-only button stays on every region head that has it today; Activity takes the Runs one.
- The office clock and floors the Runs region's `after` slot once drew have no caller today (`briefsurface.tsx:476` is a
  stale comment): nothing to move; drop the slot.

### 6. Pins are stored on the effort

A pin is a field on the effort (so it survives reinstalls and other machines), set and cleared by a wshrpc command and
`wsh effort pin|unpin`. Pinning a seventh says the cap and offers to unpin the oldest pin. Agent's calls: the cap is a
constant (6), not a setting; the field is the time it was pinned (0 = not pinned), which orders the cards and defines
"the oldest pin".

### 7. An initiative opens in the sheet

Enter or a click on a card or a list row opens the initiative in the right sheet (today's `SheetShell`, 640px,
`ModalShell`, Esc and a backdrop click close it). The opened card keeps an accent outline under the dimmed page. The
initiative no longer expands in place.

- Head: title (17px), `project · status · updated <age>`, **Pinned** (unpin) or **Pin**, ×. Then the large
  `done/total`, percent and the segment bar; **Work on** / **Go to agent** (`w`), the agent state, **Activity ↗**, `⋯`.
- Body: the chunk list, one row per chunk: status glyph, label (two lines), note count, status word; the next chunk
  marked with an accent `→` and a raised row. Proposed chunks keep today's accept/drop. Then sub-initiatives and linked
  ideas when there are any (today's `LinkedInitiatives`).
- **Plan editing stays, inside the sheet** (the person's answer to builder question 1). Today's `InitiativeDetail` and
  `trackeredit.ts` move into the sheet body: chunks grouped under stage headers that fold, rename and delete, Move to
  stage, `+ Add chunk` at the end of each stage, rename a chunk by double-click, move chunks up and down, remove a chunk.
  The rows take the look above (glyph, two-line label, note count, status word). The `10 rows, then +N more` cap applies
  per stage only to a folded stage's preview; an unfolded stage shows all its chunks, and the sheet body scrolls.
- `j`/`k` in the sheet step chunks; the head's Previous/Next buttons (today's run stepping, `SheetShell`) step through
  the initiatives in page order. Agent's call.
- Every route that opens an initiative today (`openref.ts` `selectEffort`, a run row's ↳) opens this sheet. The review
  pass does not: it keeps its region takeover (decision 10). Agent's call.

### 8. A council report opens in the sheet

A council line in Activity opens its report in the same 640px sheet; the Agent tree's council still opens the Agent
surface as today (`showCouncil`). The content comes from the existing summary model (`councilsummarymodel.ts`, the data
`wsh council show` prints).

- Head: `council · <mode>` chip, the question (two lines), `project · N experts · <age>`, ×.
- **Verdict** block (`surface-raised`): the bold one-line verdict, then the summary paragraph clamped to three lines.
- **Directions**, ranked: number, title, the outcome (`✓ Agreed`, or the challenged wording), **First step** (accent
  label) in two lines, the proposals it came from (`P5, P21`), and two actions: **Work on** and **Add to initiative…**
  (the existing `InitiativePicker`, then the first step becomes a chunk).
- **Work on opens the New agent dialog prefilled, it never spawns** (the person's answer to builder question 5): the
  council's project selected, the prompt set to the direction's title and its first step; the person picks harness and
  model and starts it there. When the council's project has no path, the dialog opens with the project left unset.
- **Ask next**: who is asked, the question on one line, **Ask in chat** (opens the council chat with the question
  drafted).
- `Also raised N` and `Matrix · N proposals` folded into one line that opens them in place.
- Foot: **Open chat** (the council's Discussion on the Agent surface, as today) and **Full report ↗** (the saved
  `docs/council/…` file), its path in `muted` at the right.
- A council still running shows its round and the live discussion link instead of the verdict; a failed or stopped one
  says so in the verdict block with what finished.

### 9. A chunk opens inside the initiative sheet

Picking a chunk swaps the sheet's body to that chunk; there is no separate 460px aside any more.

- Head (42px): `← <initiative title>` back to the initiative, `chunk n / total`, ↑/↓ (`k`/`j`), copy the `wsh` command,
  ×.
- The chunk label (15px semibold).
- **Status is one control**: a button with the glyph and status word and `▾` (key `s`) opens a menu of the six statuses
  with keys `1`–`6`; choosing `blocked` asks for a one-line reason, written as the change's note. Beside it, one button
  for the move the status most often needs: pending → **Start**, active → **Done**, done → **Reopen**, blocked →
  **Unblock**, deferred or skipped → **Reopen**. Agent's call on their targets: Start and Unblock set `active`, Done
  is `wsh effort advance`'s move when the chunk is the active one (else `done`), Reopen on a done chunk is today's reopen
  (`active`), and on a deferred or skipped one sets `pending`. **Work on** / **Go to agent** stays in the head when an agent can take
  it.
- **The trail, newest first.** A note (by the person or an agent, including a status change that carries text) is a
  block: who (you in `accent-soft`, agent in `success`), time, a `→ <status>` tag when it changed the status, the text
  clamped to four lines with **Show all**, and **Open agent session ↗** / **Open run ↗** as today; Edit and Delete on the
  person's own notes as today. A bare status change (no text) is a thin 30px line: glyph, `→ <status>`, time. A
  **Notes only** toggle hides the thin lines (per-viewer, kept in the sheet's atom).
- Foot: today's **Add a note…** box (Ctrl+Enter adds, Esc clears).
- Agent's call: which trail entries count as bare is decided in a pure `chunktrail.ts` with tests (an entry from a
  status change whose note is empty).

### 10. Waiting, peek and review pass

Behaviour unchanged. Show all opens under the strip (decision 2). Peek on a card or list row peeks the initiative as
today. The review pass takes the Initiatives region over as today, its cursor keeping `j`/`k`/Enter; its open
initiative reuses the sheet's head and chunk list as components drawn in place, not the sheet itself (Agent's call).
The tour's stops are rewritten by the builder to point at the strip, the cards, the list and Activity.

## Keyboard

- Page: `j`/`k` walk the Waiting strip's item, the cards row by row, the list rows, then Activity, Since you looked,
  Shipped, Ideas. Enter opens; `w` works on; `p` pins or unpins the initiative under the cursor (new binding, in
  `bindings.ts` and `docs/keyboard-shortcuts.md`; Agent's call).
- Sheet: Esc closes (a chunk view goes back to its initiative first); `j`/`k` step chunks; `s` and `1`–`6` set a chunk's
  status.

## Narrow windows

Below ~1280px the cards are two columns and the side column drops under the main column, as the side column does today.
The sheet stays `max-w-[92vw]`.

## Build waves

One spec, built in three runs, tracked by the initiative **Revamp Jarvis** (effort `0731d962`):

1. The Brief page and the initiative sheet: decisions 1–7, 10, pins (6), keyboard, narrow windows.
2. The council report in the sheet: decision 8.
3. The chunk inside the sheet: decision 9; the old `ChunkSidebar` aside is removed.

## Verification

CDP scenarios (`scripts/cdp/scenarios.mjs`): update `brief-surface`, `brief-layout`, `brief-inline-tracker`,
`brief-chunk-panel`, `jarvis-tour`; add one per board: pinned cards and the list (Main), an initiative open in the sheet
(Sheet), a council report in the sheet (Council), a chunk in the sheet with the status menu open (Chunk). Pure models get
tests beside them: card selection (pins, else the top six), the Activity merge and order, the chunk trail split.

## Out of scope

The run sheet and the New run launcher, Jarvis settings screens, the Sprout pet, the Agent surface's own council and
initiative views.

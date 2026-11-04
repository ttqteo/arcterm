# Council: Ideas ranked by stance, and a Memory tab

Date: 2026-11-04
Mockups: `.superpowers/design/council-ideas-memory/project/` (`Ideas-by-stance.dc.html`, `Memory-tab.dc.html`,
`Memory-held.dc.html`; gitignored)

## Intent

Two changes to the council's rail (`CouncilRail`, `frontend/app/view/agents/councilchat.tsx`):

1. The Ideas tab ranks ideas by color, where the color says where the seats stand on each idea.
2. A **Memory** tab sits beside Ideas and holds the council's chosen direction. When the chat settles on direction B
   after A was saved, the memory moves to B instead of going out of date.

## What is there today

- The Ideas rail lists ideas in arrival order, or in the Report's order once there is one, and never re-sorts on a
  stance (`listOrder`, `councillistmodel.ts:94-111`). The only filter is choosing a seat (`councilList`'s `only`).
- The Report is marked Outdated only by a new idea, a revision or a changed stance; plain chat replies do not count
  (`outdatedCount`, `councilmodel.ts:1069-1074`). A chat that settles on B therefore leaves a Report saying A looking
  current.
- Once a council has a Report, a seat that joins is briefed from the Report plus the messages sent after it
  (`briefedByReport`, `writeReport`, `sinceReport` in `pkg/council/prompts.go`). Seats answering the person also get the
  Report's directions by number. So the Report already works as the seats' memory, and a stale Report briefs them
  wrong. The Memory tab is that memory, kept current.
- The person can already like or dislike a seat's idea or reply (`Thumb`, `pkg/council/types.go:221,263`): a
  per-message action exists to sit beside. A no-tools haiku router already reads each message the person sends to the
  whole council (`pkg/council/router.go`). Stances per idea are already folded (`latestStances`).

## 1. Ideas ranked by where the seats stand

Each idea falls in one group, from the latest stance of each seat on it:

| Group | Rule | Color |
|---|---|---|
| Agreed | at least one accept, no doubt, no one against | `success` green |
| Has doubts | at least one challenge, no one against | `warning` amber |
| Someone against it | at least one oppose | `error` red |
| No stance yet | no stance at all | `ink-faint` grey |
| Withdrawn | withdrawn by its author | `edge-strong` grey, title struck through |

Precedence: withdrawn first, then against, then doubts, then agreed, then no stance.

Agent's calls (builder check):

- An idea the person cut at the pause (`proposal.cut`) joins **Withdrawn**, its meta line saying `cut by you`.
- Held drafts (ideas waiting on the person: Send / Edit / Drop) are not grouped by stance: they sit in a **Waiting on you** group above Agreed, in muted text with no color bar, so their pending action stays in sight.

- The groups show in that order, each under a header with a dot in its color and a count. Empty groups are left out.
- Inside a group, ideas keep arrival order. An idea keeps its number (`Idea 13`) in every group, as today.
- Each row keeps its number, seat, title and meta line (`railMeta`), with a thin bar in its group's color.
- The caption over the list reads `by where the seats stand` (replacing `railOrderLabel`'s text).
- The color moves live as stances change: the grouping is derived on every render from `latestStances`, never stored.
- The seat filter (`only`) still applies: it narrows the ideas, then they are grouped.
- Status is never color alone (DESIGN.md): the group header names it in words.

The grouping is a pure function beside `listOrder` in `councillistmodel.ts`, with its tests in
`councillistmodel.test.ts`.

## 2. The Memory tab

### What it holds

Only the chosen direction: what the council settled on, and the directions it replaced. Ruled-out options, agreed
facts and open questions stay out.

### Layout (board `Memory-tab`)

Top to bottom:

1. Caption: `the seats read this before the Report`.
2. A **Set the direction…** input with a **Set** button: the person writes a direction in their own words.
3. A card when something waits (at most one at a time): either a **suggestion** (below) with **Make it the direction**,
   **Dismiss** and **Show the messages**, or a **held** direction (board `Memory-held`) with its reason and **Edit**,
   **Set anyway**, **Discard**.
4. **Chosen direction**: its text, who set it (`Pinned by you`, `Written by you`, `Accepted from the check after round
   N`), when, and the idea or message it came from as a link; **Edit** and **Unpin**.
5. **Replaced**: earlier directions, newest first, struck through, each with how it was set and when it was replaced.

The tab label is `Memory`. A small `accent-soft` dot on the tab marks a waiting suggestion or held direction.
With no direction and nothing waiting, the tab shows the input and one muted line: `Pin a message with Chốt, or write
the direction here.`

### How a direction gets in

- **Chốt** — an item in a message's or idea's action row in the channel (beside like / dislike), and a keyboard binding
  beside the existing council keys (`bindings.ts`, mirrored in `docs/keyboard-shortcuts.md`). The direction's text is
  the idea's title, or the message's text cut to one line; the person can Edit it after.
- **Write it yourself** — the Set the direction… input.
- **Suggestion** — two sources, no person action needed to raise one:
  - **The round check:** after each reply pass (`replyPass`, `round2`) and after each batch of seat answers to a message of the person's (`answerAll`), one no-tools haiku call (Agent's call: the post-Report chat is the main case, so it must run there) reads that round's sent messages and the
    current direction, and answers either "no change" or a suggested direction with a one-line reason and the ids of
    the messages it rests on (`Show the messages` scrolls the channel to them).
  - **All green:** an idea every seat other than its author has accepted (each one's latest stance is accept; the
    author's own stance on its idea is `proposed`, never accept) is suggested with no model call.

  One suggestion waits at a time; a newer one replaces a waiting one. A held direction and a suggestion are separate slots (Agent's call): the held card, the person's own text, is never dropped by a suggestion and shows first; a suggestion that arrives meanwhile waits behind it and shows once the held card is settled. Pinning or typing while a suggestion waits leaves the suggestion in place. A suggestion pushed out by a newer one is not counted as dismissed. A dismissed suggestion is not suggested again for
  the same idea (all green) or the same text (round check). Accepting a suggestion sets it with no further check.

### The check before a direction is set (board `Memory-held`)

A direction the person pins or types is checked before it is set: one no-tools haiku call reads it against the current
direction and the council's recent messages and stances.

- **Fits:** it is set at once.
- **Clashes** with what the seats agreed, or is unclear: it is **held**. The tab shows it with the check's one-line
  reason, and **Edit** (back into the input), **Set anyway**, **Discard**. Nothing is set until the person picks.
- **The check fails** (no answer, an error): the direction is held with the reason `The check did not answer:
  <error>`, and Set anyway still works. A failed check never sets a direction silently.

### When a direction changes

- The new direction becomes the chosen one; the old one moves to Replaced, with `replaced <time>`.
- **Report:** a change of chosen direction after the Report counts in `outdatedCount`, so the Report shows Outdated.
  Nothing reruns on its own; the person reruns Summarize when they want.
- **Seats:** every seat turn's prompt opens with the chosen direction, above `writeReport`, saying it outranks the
  Report where the two differ. A council with no chosen direction prompts as today.
- **Edit** on the chosen direction (Agent's call) makes a new direction from the edited text: it goes through the pre-set check, the old text moves to Replaced marked `edited`, and it counts in `outdatedCount` like any change.
- **Synthesis:** the chosen direction is binding on a rerun (builder question 1). `SynthesisPrompt` (and the Brainstorm synthesis) gets the chosen direction as settled: the Report ranks it as direction 1 and writes the rest around it. A rerun after the change clears that Outdated cause, since the new Report now carries the direction.
- **Unpin** clears the chosen direction (it moves to Replaced as `unpinned`); the seats prompt as today.

## The saved document and agents

Agent's call (builder check): the council's saved document (`Markdown`, `pkg/council/markdown.go`) and what `wsh council` gives the agent that started a council carry the chosen direction above the Report, with Replaced under it, so an agent never reads A after the person settled on B.

## Data and wire

- On the council (Go, `pkg/council/types.go`, beside `Summary`): the chosen direction, its replaced history, and the one
  waiting card (suggestion or held). Each direction records its text, how it was set (`pin`, `written`, `suggested`),
  when, the idea or message id it came from, and for a replaced one when it was replaced. Dismissed suggestion keys are
  kept so they are not raised again.
- Set, pin, accept, dismiss, set anyway, discard, edit and unpin are wshrpc commands on the council runner (like
  `SetPinned`). Run `task generate` after the Go types change; never hand-edit the generated files.
- The round check and the pre-set check are model calls on the council's caller, on haiku, no tools, like the router
  (`ModelRouter`). Their tokens count in the council's totals.
- The council's cost estimate (`pkg/council/estimate*`) counts one round check per reply pass, and the composer's per-message estimate counts one per message sent. (Agent's call)

## Testing

- Pure frontend logic (grouping, Memory tab state, which card shows) in `.ts` files with `.test.ts` beside them; no
  render tests.
- Go: tests for the direction commands (set, replace, unpin, held, set anyway, dismiss not raised again), the round
  check's parse of "no change" and of a suggestion, the all-green suggestion, the seat prompt's direction block, and
  `outdatedCount`'s new cause.
- A CDP scenario in `scripts/cdp/scenarios.mjs` for the Ideas tab grouped by stance and for each Memory state drawn
  (direction with Replaced and a suggestion; a held direction), with a fixture council.
- `CHANGELOG.md`: one line under Added for each user-visible change.

## Left to the builder

The rows above marked as rules (precedence, storage location, command names, keybinding placement) were the agent's
calls during the brainstorm, confirmed by the person; the builder may refine names and file placement.

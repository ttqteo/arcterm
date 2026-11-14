# Council memory: what the council has reached

Date: 2026-11-05
Mockups: `.superpowers/design/council-memory/project/` (`C-merged.dc.html`, `C-add.dc.html`, `C-empty.dc.html`;
gitignored)

Replaces the Memory tab's layout and what it holds from `2026-11-04-council-ideas-memory-design.md` section 2. The
direction's moves, the pre-set check, the suggestion and held cards, all green and the Report's Outdated cause stay as
that spec has them, except where this one says otherwise.

## Intent

The Memory tab held one line, the chosen direction, under a "Set the direction…" input, with the directions it replaced
struck through: it read as a note or a task list. It becomes the council's memory: what the discussion has reached,
which every seat reads before every turn, so a long chat does not argue a settled point again or bring back an option it
dropped.

## What it holds

One list. Each entry is one kind, shown as a badge whose tooltip says what it means (the same words are the empty
state's legend):

| Badge | Tooltip | How many |
|---|---|---|
| **Direction** | What the council will do. The seats follow it over the Report. | at most one: today's chosen direction |
| **Agreed** | Settled as true. The seats do not argue it again. | any |
| **Ruled out** | Dropped. The seats do not bring it back without something new. | any; each may carry a why |
| **Open** | Still to settle. The seats work on it next. | any |

Badges: Direction `surface-selected` fill and `primary` text, semibold; Agreed `success-soft`, Ruled out `secondary`,
Open `warning-soft`, each on the `pill` fill. The kind is always a word, never color alone.

## Layout (board `C-merged`)

Content first: an entry's own words are the loudest thing on the tab, and who added it, when and from what wait behind
a details button.

- **Tab:** `Memory · N`, N the entries plus the direction. Its dot is on while a card waits or an entry came in since
  the person last had the tab open.
- **+ Add** sits in the rail's tab strip, left of the fold button, shown only while Memory is the tab.
- **The card** (a suggested or a held direction) stays at the top, at most one, as today. The suggestion card is slimmer:
  kicker `Suggested direction`, the text, the reason with the messages it rests on as links after it (in place of a
  Show the messages button), then **Make it the direction** and **Dismiss**.
- **Direction** first in the list: 15px, medium weight, its badge under it. On hover its badge line gains
  **Earlier · N**, **Edit**, **Unpin** and the details button, each an icon with its word as `aria-label` and
  tooltip (a history icon with the count, a pencil, a crossed-out pin).
- **Earlier · N** unfolds the directions it replaced under it (board `C-add`): muted text, a thin left rule,
  `replaced 22:25`, no strikethrough.
- **The entries**, newest first: the text (13.5px, `primary`), for Ruled out its why on a muted line with no label, then
  the badge line: the badge, and a small `accent-soft` dot on an entry that came in since the tab was last open.
- **Hover an entry:** its badge line gains **Chốt** (a compass icon), **Edit** (a pencil), the details button (an info icon) and **Remove** (an ✕
  with `aria-label`). Nothing else joins that line, so the badge never wraps.
- **Details** opens on hover or focus as a small popover holding two short lines: who and from what, e.g.
  `Auto · round 3` then `r19 · 22:31` (message ids as links that open their thread), or `You · 22:40`. The direction's
  says how it was set (`Accepted: every seat agreed · 22:25 · from Idea 2`).
- **Add** (board `C-add`) opens a form under the tab strip: a kind picker (Direction / Agreed / Ruled out / Open), the
  text, a `Why (optional)` field for Ruled out, **Add** and **Cancel**. Direction is today's set: it goes through the
  pre-set check and may come back held.
- **Empty** (board `C-empty`): `Nothing yet. What the seats agree on, rule out or leave open shows up here after each
  round.` and the four badges with their tooltip words as a legend.

The UI never says "the check": an entry or direction the round check made is `Auto` (`Auto · round 3`), and a
direction accepted from its suggestion reads `Accepted · auto after round 2` where it read `Accepted from the check
after round 2`.

## How entries get in

- **The round check** (the call that already runs after each reply pass and each batch of seat answers) answers, beside
  its direction suggestion, up to three entry changes: **add** an entry (kind, text, why for Ruled out, the message ids it
  rests on), or **drop** an entry by id. They apply at once, with no card and no approval; the person removes what is
  wrong. It may drop only an entry it added that nobody edited, or an Open the round answered (and may add the answer as
  Agreed).
- **By hand:** + Add. An entry the person adds or edits is theirs: the check never drops or rewrites it, except an Open
  of theirs the round answered, which it may drop (an Open is a question put to the seats).
- **Chốt on an entry** makes its text the direction through the pre-set check; once set (it fits, or Set anyway), the
  entry leaves the list. Chốt in the channel works as today.
- **Edit** rewrites an entry's text (and why) in place; it becomes the person's.
- **Remove** takes an entry off. A removed auto entry is remembered by kind and folded text, so the check does not add
  it again.
- The check adds nothing whose folded text an entry of the same kind already has. Past 40 entries it adds nothing; the
  person removes some first.

## What the seats read

- Every prompt that opens with the chosen direction today (`writeChosenDirection`'s call sites) opens with
  `## The council's memory` instead: the direction (saying it outranks the Report, as now), then Agreed, Ruled out with
  its why, and Open, one line each, with one rule line per kind saying how to treat it (the tooltip's meaning, said to a
  seat). A council with an empty memory prompts as today.
- The synthesis (`writeSettledDirection`) keeps the direction binding as direction 1, takes Agreed as settled, and does
  not rank a Ruled out option as a direction.
- The round check and the pre-set check read the memory too, so the check does not suggest what is ruled out or add what
  is already there.

## What does not change

- The Report goes Outdated only when the direction changes, as today; entries do not count.
- No new model call: the round check's prompt and answer grow. Its estimate (`pkg/council/estimate*`) grows to match.

## The saved document and agents

`Markdown` (`pkg/council/markdown.go`), what `wsh council wait` and `show` print, carries `## Memory` above the Report:
the direction and its earlier ones, then Agreed, Ruled out (with why) and Open as lists. A council with an empty memory
writes nothing.

## Data and wire

- `CouncilMemory` gains `Entries []CouncilMemoryEntry` and `Removed []string` (the keys of removed auto entries). An
  entry has an id (`m1`, `m2`… from a counter on the memory), kind (`agreed`, `ruledout`, `open`), text, why, by (`auto`
  or `you`), the round it came after, the message ids it rests on, and when it was added.
- A new wshrpc command, `CouncilMemoryCommand`, takes the entry moves (add, edit, remove) by council id, entry id, kind,
  text and why. `CommandCouncilDirectionData` gains `Entry`: a pin from an entry, which leaves the list once the direction
  is set; a held card keeps it until then.
- "New since the tab was last open" is per viewer: the frontend keeps, per council, when the Memory tab was last shown
  (localStorage), and an entry added after that is new.
- Run `task generate` after the Go types change.

## Testing

- Go: the entry moves (add, edit, remove, the removed key, the cap, dedup); the round check's parse of entry changes
  (ids it was shown only, three at most, drop refused for a person's entry other than an Open); a pin from an entry leaving the list once
  set and staying while held; the seat prompt's memory block and the synthesis rules; the document's Memory section.
- Frontend: pure model tests for the list order, the badge words and tooltips, the details lines, the new dot and the
  tab count, beside `councilmemorymodel.ts`.
- CDP: the `council-memory` scenario redrawn for the boards: a list with each kind, a hovered entry with its details
  open, the Add form, and the empty legend, on a fixture council with neutral content.
- `CHANGELOG.md`: one line under Changed.

# Brainstorm in Chat: what it is missing next to the Brainstorm tab

Date: 2026-11-14 · Brainstorm: `.superpowers/brainstorm/chat-brainstorm-status/brainstorm.json` · Initiative: GUI
redesign after the AI-chat references (`7655bf18`), chunk "Chat: brainstorm status always visible"

**Prototype:** D:\work\arcterm\.superpowers\design\chat-brainstorm-status\project

The canvas has one board, `A-shared-band.dc.html`: a Chat whose agent has both an initiative and a brainstorm, the
shared band under the header with its brainstorm part expanded (its button toggles it), while the agent works between
two questions. The board's conversation copy is Vietnamese; UI strings stay English, as in the rest of Chat.

## Problem

In Chat, a brainstorm shows only through one card at the end of the conversation (`chatconversation.tsx:1610`). The
person, in their words: when there is a design board you can't tell it exists, and Decided so far goes missing.

What the code does today:

- The question card (`chatbrainstormcard.tsx`) is the only place with the `Decided N` fold and the `Compare N boards`
  link. The card hides once the question is answered and the file has not changed, and while the agent works
  (`f.working` set): `chatbrainstorm.ts:618-624`. Between two questions Chat shows nothing of the brainstorm.
- `Compare N boards` counts only the asked part's boards (`chatbrainstorm.ts:457`).
- While a brainstorm is attached the Canvas tab is hidden (`agentheader.tsx:394`), and with it the Canvas tab's
  "updated since you last looked" dot. The Brainstorm tab only has the amber dot while the agent asks.
- The builder check card has no fold of what is decided.
- In the Confirm and builder check cards, a decision the agent changed draws `Was: <the whole old body>` and
  `Why: <cause>` (`chatbrainstormparts.tsx:287-292`, `DecisionRow`), so what changed is hard to see. The Brainstorm
  tab's review (`brainstormreview.tsx`, `ReviewRowView`) draws the cause under the gist, a `SaidLine`
  (`answer 2: "…"`), and, opened, a `ChangeDiff` (`brainstormui.tsx:1184`): removed sentences in red with −, added in
  green with +, from `sentenceDiff(was, body)`.

## Scope (answer 1)

While a brainstorm is attached, Chat always shows, with or without a question open:

- **Boards:** how many boards the brainstorm has (every part's, not only the asked part's) and a dot when a board is
  new since you last looked.
- **Decided so far:** the decisions that are yours.

The working line, part progress, spikes, recon notes and the judge's record stay in the Brainstorm tab only.

## Design

### 1. Where it lives: one shared band under the header (answer 2, judge's pick; board A)

Boards and Decided live in the one-line band under the Chat header that
`docs/superpowers/specs/2026-11-14-chat-initiative-link-design.md` puts there for the initiative. The band becomes a
shared band with two parts: initiative and brainstorm. An agent with only one of them shows only that part; an agent
with neither has no band (as that spec says).

The brainstorm part is built on the band that run `175af141` (building the initiative-link spec) lands: it is an
addition to that band, not a rewrite of its spec. Agent's call (builder question 3): the plan for this spec is
written only after that run lands, against its real files, stores and DOM (the run so far has committed only its spec
and plan, `ef17d33cc` on `wave/175af141-…`), not against its plan's names.

### 2. The band with both parts (agent's call, confirmed; board A)

- **Initiative part, left:** ◇, the title, the segment bar, `done/total`, `On N` and the chunk's label (ellipsized),
  as the initiative-link spec's collapsed band. With a brainstorm part beside it, the `Mark done` button leaves the
  band for room: the `m` key still works, and the button is still in the initiative part's expanded view. An agent
  with only an initiative keeps the button as that spec has it.
- A vertical divider.
- **Brainstorm part, right:** a lightbulb icon, `Brainstorm`, the board icon and `N boards`, an accent dot and
  `N new` when boards are new, a divider, `Decided N`, a chevron.
- A click on the brainstorm part expands it under the band, pushing the conversation down (never over it), in two
  columns:
  - **Decided N:** one row per decision that is yours, in the design's order: title, then its gist (`yoursGists`).
  - **Boards N:** one row per board: the board icon, the file name with `new` when it is new, the part it
    illustrates, and an `Open in Brainstorm (b)` link at the end. No thumbnail (builder question 1): the band loads no
    board page, so it costs no RAM in any number of Chat cells; the board A draws the icon too.
  - **A click on a board opens it over Chat** (added 2026-11-14 after use: going to the Brainstorm tab and opening the
    board there took two steps to look at one board). It opens large in the Brainstorm tab's board dialog
    (`BoardDialog`), drawn over the Chat pane rather than the app: a head with the board's name, its part, `Open in
    Brainstorm` and Close, over the board at the dialog's width. The board's page loads when the dialog opens and goes
    when it closes, so the no-RAM rule above still holds for a band nobody clicks. Esc, the scrim or a click on the board
    closes it and leaves the part open; `b` or `Open in Brainstorm` opens the tab. It has no marking (the tab's open
    board keeps that). Before wavesrv serves the design folder (`base` unset) the click opens the Brainstorm tab as
    before.
- A click on the initiative part expands the initiative's view. One part is expanded at a time.
- An agent with only a brainstorm: the band holds only the brainstorm part, which also shows the brainstorm's title.
- **Keys (agent's call, builder question 2):** `i` stays the initiative's: it toggles the initiative part (opening it
  over an open brainstorm part, since one part is open at a time); for an agent with only a brainstorm, `i` opens the
  link picker, as the initiative-link spec §6 says, so the band rule "a band is on screen" means "a band with an
  initiative part". The brainstorm part has no key of its own (`b` already opens the Brainstorm tab); `Esc` closes
  whichever part is open. The expanded brainstorm part has no arrow-key cursor: its board rows are buttons, reached
  with Tab. `docs/keyboard-shortcuts.md` says so.
- The per-agent open state the initiative band keeps (planned as a boolean set, `chat.initiative.band`) becomes which
  part is open: none, initiative or brainstorm.

### 3. States of the brainstorm part (agent's call, confirmed)

- No boards yet: the `N boards` item is not drawn; `Decided 0` still is.
- The part stays for as long as a brainstorm is attached to the agent (talking, done, builder check, run started),
  as the Brainstorm tab does.
- A narrow cell: the brainstorm part keeps its icon, the board count with its dot, and `Decided N`; the initiative
  part drops its chunk label first, as the initiative-link spec's narrow band does.

### 4. The question card stays as it is (answer 3)

The question card keeps its footer unchanged: the `Decided N` fold and `Compare N boards in Brainstorm`, even though
the band also shows Decided and the board count.

### 5. The new-board dot (answers 4 and 6)

A board is new when its name is in `brainstorm.json` (any part's `boards`) and was not there when you last looked at
the Brainstorm tab (answer 6). No board file is read for it:

- **Seen board names, per brainstorm:** Arc keeps the board names you have seen per `brainstorm.json` path, in
  localStorage (`chat.brainstorm.seenBoards`, pruned as `chat.brainstorm.sent` is, `chatbrainstormstore.ts`), so they
  survive a reload and a restart; the in-memory `BrainstormState` is rebuilt with `lastViewedMs: now` and could not
  hold them. A brainstorm attached for the first time has no entry, so its first boards are new (Agent's call,
  builder check 2, question 1). The brainstorm poller
  already re-reads `brainstorm.json` whenever it changes, for every agent with a brainstorm, focused or not
  (`brainstormpoller.ts`), so the comparison costs no request and a split's unfocused cell stays current. The canvas
  state is not used: for an agent with a brainstorm it is usually null (`brainstormrail.tsx:358`, `openref.ts:608`),
  and `useCanvasPoller` polls only the focused agent (`canvaspoller.ts:153`).
- **What it misses:** a board redrawn under the same name is not reported as new.
- **The seen names stay fresh while the tab is shown** (agent's call, builder question 1): they are taken when the
  Brainstorm tab opens (where `setBrainstormMode` stamps `lastViewedMs` today, `brainstormstore.ts:167`) and again on
  every poll while the agent's Brainstorm tab is shown, so a board added while you look at the tab is not new once you
  leave.

When a board is new:

- the Brainstorm tab in the header carries an accent dot, as the Canvas tab does today (`agentheader.tsx:875`);
- the band's brainstorm part shows the accent dot and `N new`, and each new board's row is tagged `new`.

Both clear when you open the Brainstorm tab. A board opened from the band over Chat is taken as seen on its own
(`withBoardSeen`: added to the stored names, the other boards stay new). Expanding the band does not.

Agent's call: when the agent is asking (the amber dot), the tab shows the amber dot only; the accent dot shows when it
is not asking.

### 6. Changed decisions in Chat's cards show what changed (confirmed; asked for by the person through another agent)

The Confirm the design card and the builder check card draw a changed decision as the Brainstorm tab's review does:

- `DecisionRowModel` (`chatbrainstorm.ts:331`) also carries `body` and `said?: PartAnswer`. `checkCard` takes them
  from the `ReviewRow` (`r.body`, `r.said`); `confirmCard` from `p.body` and `partAnswer(f, p)`. The model also
  carries the diff, `sentenceDiff(was, body)` without the `same` sentences, so it is unit-tested.
- `DecisionRow` (`chatbrainstormparts.tsx`) replaces `Was: …` with the diff lines (− removed, + added), keeps the
  `Why` line, and adds the `SaidLine`. The drawing of the diff is pulled out of `ChangeDiff` into one component that
  takes `was` and `body`, used by both the Brainstorm tab and Chat.

## Left to the builder (confirmed)

- Board count: every part's `boards` in `brainstorm.json`, without duplicates.
- The expand animation and remembering the open state per agent: reuse the initiative band's.
- Spacing and type: follow the initiative band and `DESIGN.md`.

## Testing

- Unit (vitest): the seen board names (taken when the tab opens, refreshed while it is shown, compared on a file change for an unfocused agent)
  (`brainstormpoller.test.ts`, `brainstormstore.test.ts`); the band's brainstorm-part model (board count across parts, new
  boards from the seen names,
  `Decided` list, the no-boards state); `DecisionRowModel` with `body`, `said` and the diff, in `chatbrainstorm.test.ts`
  (update the case at ~978 that checks `was`/`why`).
- CDP: a scenario (or steps in `chat-brainstorm-review`) that opens a Chat with an attached brainstorm and an
  initiative and shows the shared band collapsed and with its brainstorm part expanded; a new board's dot on the tab
  and in the band, then gone after opening the Brainstorm tab; a brainstorm-only agent's band; and a changed decision in
  the builder check card drawing the − / + lines and the answer line.

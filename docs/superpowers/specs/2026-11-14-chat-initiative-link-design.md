# Initiative in Chat: one band under the header

Date: 2026-11-14 · Brainstorm: `.superpowers/brainstorm/chat-initiative-link/brainstorm.json`

**Prototype:** D:\work\arcterm\.superpowers\design\chat-initiative-link\project

The canvas has two boards:

- `A-band-under-header.dc.html`: the band, collapsed and expanded (its button toggles it), in a Chat of a linked
  agent that holds a chunk.
- `States.dc.html`: an agent with no initiative (no band, `+ Link to initiative` in the header), a linked agent with
  no chunk, the band in a narrow cell, and the line that waits for your next message after a chunk switch.

The boards' copy is Vietnamese where the conversation is. UI strings are English, as in the rest of Chat.

## Goal

Answer 1 named three problems with initiatives in a linked agent's Chat:

1. The initiative popover (`initiativepopover.tsx`) floats over the conversation, and the initiative shows only when
   you open it.
2. Chat touches an initiative in four places that read as four different things: the header chip and its popover, the
   `done:` / `go on with:` chips over the message box (`chatsuggest.ts initiativeChips`), the `arc-initiative` card
   (`chatinitiativecard.tsx`), and `Add to initiative…` on a message.
3. Some actions can't be done in place and need a trip to Jarvis.

## What exists today

- The Chat header is "lean" (`agentheader.tsx` ~459, `lean = chatShown && shownView === "chat"`). When the agent is
  linked it still draws `InitiativeLink` (~750, the ◇ chip that opens `InitiativePopover`). When the agent is not
  linked it hides `LinkToInitiative` and offers it only in the `…` menu (`linkFromMenu`, ~461, ~934).
- The Terminal view's header is not lean. It keeps the chip and its popover.
- The `i` binding (`bindings.ts` ~1815) opens the link picker for an unlinked agent and `initiativePopoverAtom` for a
  linked one.
- `popoverRows`, `popoverStatus`, `popoverProgress`, `latestNoteEntry` and `chunkMenuItems`
  (`initiativepopovermodel.ts`) build the popover's content. `markChunkDone` (`chatsuggeststore.ts`) is the Mark done
  shared with the `done:` chip.
- `attachAgent` (`effortstore.ts`) attaches the agent's workref to a chunk, which is what Link to initiative does.
- `queueResultLine`, `takeResultLines` and `putBackResultLines` (`chatinitiativestore.ts`) queue the lines that go in
  front of the person's next plain message (spec `2026-11-12-chat-add-to-initiative-design.md` §7).

## Design

### 1. Where it lives (answer 2, judge's pick; board A)

In a linked agent's Chat, a one-line band sits right under the header and above the scrolling conversation. It
replaces the ◇ chip and its popover in the Chat header. Collapsed, it shows:

- a ◇ icon and the initiative's title;
- the segment bar and `done/total`;
- a dot and `On`, then the number and label of the chunk this agent is on;
- `Mark done (m)` and a chevron.

A click on the band or `i` expands it in place. The expanded band pushes the conversation down, never over it, and
keeps the reading position. `Esc` or `i` collapses it. Whether a band is open is remembered per agent, and a band
starts collapsed.

The band appears only in Chat. The Terminal view keeps its header chip and popover. The popover reads the agent's
chunk by the one definition in section 7.

### 2. The band expanded (agent's call, confirmed; board A)

The expanded band has two columns.

- **Left column:**
  - `↳ Part of <parent>` (opens it through `openref`), the project and the status (`at work`…, from
    `popoverStatus`).
  - The chunks: the one just done, struck through and faint; the agent's own chunk on the selected background,
    tagged `this agent`; the next two; a chunk another agent holds, tagged with that agent's name.
  - `N proposed · Review on the rail`, kept as the popover has it.
- **Right column:** the latest note on the agent's chunk with its age, then `Add note (n)` and `Open in Jarvis ↗`.

A click on a chunk row still opens its status / rename menu, as in the popover. The arrows move a cursor over the rows
and `Enter` opens the menu.

Agent's call (builder question 4): the rows the left column lists:

- **The fixed window:**
  - the chunk this agent finished last, if any (the last done chunk it holds);
  - its own chunk;
  - the next two, by `nextChunks` as the popover has them;
  - the chunks other agents hold.
- **`All chunks (N)`:** a row after the window that opens the whole list in plan order, scrolling within about 240px.

`Work on this` is offered on every chunk that is not done and that no one holds, in both lists. Board A's chunk `1`
listed as "next" is wrong. `nextChunks` decides what "next" is.

### 3. Switch the agent's chunk (answer 3)

This is the one action the band adds. Each chunk no one holds that is not done shows `Work on this` on hover and on
the keyboard cursor. It moves this agent's workref from its current chunk to the chosen one (`attachAgent`, after
detaching the old one), and the band, the `done:` chip and the `go on with:` chip follow at once.

The switch changes statuses too (builder question 1, the person's answer):

- The chosen chunk becomes `active`.
- The old chunk goes back to `pending` when it was `active`, is not done, and no other agent holds it.

So Mark done and Jarvis are right straight after a switch.

Agent's call (builder question 1):

- **The rule changes.** `attachWork` (`pkg/jarvis/effortops.go` ~260) refuses an agent that already holds any chunk. It
  changes so that an agent may hold one live chunk plus any number of settled ones, and gets a Go test.
- **The switch takes two writes.** The batch validates against the state before any op, so the switch is two
  `mutateEffort` calls. The first detaches the agent from its live chunk only, and its done chunks keep their
  workrefs. The second attaches it to the chosen chunk.
- **A failed second write** re-attaches the old chunk, and the band shows the reason.

The band gains no Add chunk, no review of proposed chunks in place, no notes for every chunk, and no change or
removal of the link (answer 3 left them out).

### 4. How the agent learns of a switch (answer 4)

Nothing is sent when the chunk changes. Arc queues one line, `initiative: switched you to chunk <n> <label>
(effort:<oid>)`, through `queueResultLine`, and it goes in front of the next plain message the person sends, with
the card results. Chat's stripper (`^initiative: (added|created|dismissed) `) learns `switched` too, so the line never
shows in the person's bubble. `skills/initiatives/SKILL.md` says how to read it: work on that chunk from now on.

Several switches before a message send only the last one.

### 5. The waiting line (agent's call, confirmed; States board, frame 4)

While a switch line waits, a small line shows over the message box: `Goes with your next message: switched to chunk
<n> <label>`, with ✕. ✕ drops the line and leaves the switch in place. Sending the message takes the line with it.

### 6. An agent with no initiative (answer 5; States board, frame 1)

There is no band. The Chat header shows a small `+ Link to initiative` button with the `i` key, which is
`LinkToInitiative` brought back into the lean header. The `…` menu row it replaces goes. Once the agent is linked,
the band appears.

### 7. Linked, no chunk (agent's call, confirmed; States board, frame 2)

The chunk part of the band reads `No chunk for this agent`, followed by `Pick a chunk…`. That button expands the band
with the cursor on the first chunk that has `Work on this`. Picking one is the switch of section 3, with its line. The
text "No chunk yet: it takes the active one." goes.

Builder question 2, the person's answer: the fallback goes, so "the chunk this agent is on" has one definition.

- **The definition:** the chunk is the one live (not settled) chunk the agent holds, and nothing else. The initiative's
  active chunk no longer stands in.
- **Who shares it:** `agentChunk` and `initiativeChips` both move to it. So do the band, `m`, the `done:` and
  `go on with:` chips, and the Terminal popover.
- **Mark done carries the agent forward.** Mark done (`markChunkDone`, `advanceChunk`) also attaches the agent to the
  chunk it makes active, unless someone else holds that chunk. That way the agent keeps a chunk after Mark done, and
  its workref on the done chunk stays.

### 8. A narrow cell (agent's call, confirmed; States board, frame 3)

Below a width the builder measures (around 640px of cell), the band:

- drops the segment bar and keeps `done/total`;
- clips the title to about 150px;
- clips the chunk label;
- shortens `Mark done` to `Done`.

### 9. The other three places (agent's call, confirmed)

- **The `done:` / `go on with:` chips** stay over the message box and call the band's own actions (`markChunkDone`,
  and the switch for `go on with:`), so the band changes at once. Builder question 3, the person's answer: a click on
  `go on with: <label>` switches the chunk, then sends the chip's text as today. The `switched` line goes in front of
  that message, so the waiting line of section 5 never shows on this path.
- **The `arc-initiative` card and `Add to initiative…`** stay in the conversation. A write to the agent's initiative
  makes the band read the initiative again (progress, new chunks).
- **The Chat header** loses the ◇ chip and the popover. `i` toggles the band.

## Left to the builder (confirmed)

- Measure the narrow-cell threshold. Keep the reading position when the band opens and closes, and animate it on
  `springReveal`.
- Remove `InitiativeLink` from the lean header only; the Terminal view keeps it.
- In Chat, `i` toggles the band, and `m`, `n`, the arrows and `Enter` work while it is open. The band owns the keys
  the way the popover does (`data-owns-keys`, the yield in `bindings.ts`). Update `docs/keyboard-shortcuts.md`.
- Pure logic in a `.ts` with tests beside it:
  - the band's rows;
  - which chunks offer `Work on this`;
  - the narrow labels;
  - the switch line and its stripping.

  Reuse `initiativepopovermodel.ts` where it fits.
- CDP scenarios: band collapsed, expanded, no chunk, narrow cell, unlinked header.
- `CHANGELOG.md` line under Unreleased.

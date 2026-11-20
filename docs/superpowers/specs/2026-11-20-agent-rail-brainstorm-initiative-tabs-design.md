# Brainstorm and Initiative move from the Chat band into the Agent rail

Status: design agreed 2026-11-20. Canvas: `.superpowers/design/agent-rail-brainstorm-initiative/` (boards
`D-timeline`, `B-initiative-tab`, `C-split-cells`).

## Why

The Chat band (`chatband.tsx`) opens in place under the agent's header and pushes the conversation down. With a real
brainstorm (11 decisions, 2 boards) the open band fills almost the whole Chat pane. The Agent rail on the right has the
height for those lists, already holds part of the initiative (Overview's Plan to review), and already has a tab that
appears only while the agent has the thing it shows (Council, `railcouncil.ts`).

## What changes

1. **The Chat band goes.** Chat starts right under the agent's header. Nothing of the band's line or body stays in Chat.
2. **Two new rail tabs**, each shown only while the agent has the thing:
   - **Brainstorm** (lucide `Lightbulb`), while a brainstorm is attached to the agent (`brainstormAtom(agent.id) != null`).
   - **Initiative** (the ◇ diamond the header chip already uses), while the agent is linked (`agent.effortId != null`).
   They are two tabs, not one tab with two parts: the band only ever had one part open at a time.
3. **Strip order:** Overview, Files, Changes, Transcript, Council, Brainstorm, Initiative, Summary, then file tabs.
   Neither new tab is ever a panel's default (`panelFor`); a stored Brainstorm or Initiative tab whose thing is gone falls
   back to Overview while the stored tab stays (`shownTab`), as Council does.
4. **Plan to review moves to the Initiative tab.** Overview loses its `plan` section (`agentrailsections.ts`). The
   popover's and the band's "Review on the rail" links open the Initiative tab with Plan to review unfolded.

## The Brainstorm tab (board `D-timeline`)

- **Head:** the brainstorm's title, `Open` with the `b` key cap (opens the Brainstorm view, as the band's link did),
  and one meta line: the agent's state · `Decided N` · `M boards`.
- **Body: one timeline.** The decisions (`BrainstormBandModel.decided`) in the design's order, numbered from 1, joined by
  a vertical line. Each row: the title (bold), its gist clamped to two lines, and under it a chip for every board whose
  part is that decision's part (`listedBoards` maps a board to `part.title`). A board chip opens the board dialog
  (`openChatBoard` / `BoardPreview`), with ← / → stepping through the boards in timeline order, Esc closing and `b`
  opening the Brainstorm view.
- **New:** a board the person has not seen carries a `new` tag (`BandBoard.isNew`, seen names from
  `brainstormSeenBoardsAtom`), and a decision with a new board under it has its number filled with the accent. There is
  no seen record per decision, and this design adds none. The tab icon carries an accent dot while `newCount > 0`. Opening the tab does not mark boards seen; opening a board or the Brainstorm
  view does, as today.
- **Boards with no decided part** (their part is still open) list after the timeline under `Open parts`, same chip.
- **States:** file not read yet → one muted line `Reading brainstorm.json…`; read error → the band's error text; no
  decisions yet → `Nothing decided yet` above any boards.

## The Initiative tab (board `B-initiative-tab`)

- **Head:** the initiative's title, `Open in Jarvis ↗`, the `↳ Part of <parent>` link when it has one, project and
  status, the segment bar with `done/total`, `On N · <chunk>` and `Mark done` (`m`). With the agent on no chunk the
  last row reads `Pick a chunk…` instead (the band's behaviour).
- **Sections, each folding on its header** (`RailSectionHeader`, as Overview's):
  - **Chunks:** the band's window (done by this agent, this agent's chunk, the next two, ones others hold), each row's
    status / rename menu, `Work on this` (`w`) on rows that offer it, and `All chunks (N)` unfolding the full list.
  - **Plan to review:** `planreviewsection.tsx` moved here unchanged; shown only while there are proposed rows, hidden
    while a subagent's interior is open (today's `inSubagent` rule). Its count shows in the asking colour, and the tab
    icon carries an asking dot while there are proposed rows.
  - **Latest note on N:** the note and `Add note` (`n`); `No note on N yet` when there is none.
- **States:** loading → `Loading the initiative…`; load error → the band's error line with Retry.
- The tab's root is `data-owns-keys` and answers the band's keys: `m`, `n`, `w`, arrows and Enter on the rows, the
  status menu's keys, Esc back to the message box.

## The header and the split (board `C-split-cells`)

- The ◇ chip under the agent's name (`<initiative> · done/total`) returns in Chat's header, where the band had replaced
  it. Clicking it focuses the cell, shows the rail if hidden, and selects the Initiative tab.
- The header's `Brainstorm` view switch gets the accent dot while the brainstorm has something new, so an unfocused cell
  of a split still says so.
- `i` (`agent:initiative`): with a linked agent, selects the Initiative tab (showing the rail), or, when it is already
  shown, goes back to the tab before it; with none, the Link to initiative picker as today. In Terminal view the chip and
  `i` do the same: the ◇ popover (`initiativepopover.tsx`'s linked-agent view) goes, decided 2026-11-20. The Link to
  initiative picker stays.

## What is deleted

`chatband.tsx`, the band parts of `brainstormbandview.tsx` (`BrainstormLine`, `BrainstormBody`; `BoardPreview` and
`openChatBoard` stay, the dialog now hosted by the Chat pane), the line and body of `initiativebandview.tsx` (its rows,
menu and key logic move into the Initiative tab), `initiativebandstore.ts`'s band-part state, and Overview's `plan`
section. Grep every import, `import type` included, before deleting a file.

## Tests and verification

- Pure models with tests beside them: `agentrailtabs.ts` (`visibleTabs`, `shownTab`, `panelFor` with the two new tabs),
  `agentrailsections.ts` (no `plan`), and a new `railbrainstorm.ts` (timeline rows: numbering, boards under their
  decision, `Open parts`, the newest and new flags).
- The tab strip at the rail's 300px with every tab present must not clip its last icon (check in the dev app).
- CDP: a scenario showing each tab on a fixture agent with a brainstorm and an initiative, and one showing a split of
  four with the chip and the dot.
- `CHANGELOG.md`: one `Changed` line, `<!-- big -->` with its shot (the Brainstorm tab).

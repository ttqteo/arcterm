# Office floors — design

**Date:** 2026-10-16
**Status:** design agreed, not built
**Canvas:** `.superpowers/design/office-floors/project/` (gitignored; `Main`, `LiftPanel`, `Ride`, `Drag`, `Capacity`,
`Room`, `NoticeBoard`)
**Replaces:** "The plan" in `2026-10-15-cockpit-office-design.md` (the band per project, the meeting room per run, the
Home booth). Poses, the boss, the popup, day and night, drawing and the RAM line there still hold.
**Keeps:** the notice board of `2026-10-16-office-needs-you-board-design.md`, at the place that spec gives it.

## Problem

The Cockpit office grows down without end. Each project is a band stacked under the last, and each run is a meeting
room 132 px tall (150 with its wall) on the right of its band, so a band is as tall as its runs: four projects with two
runs each make about 1,200 px of plan before the facade, while the width stays half empty. A project with no run still
keeps an empty "Meeting room · no run" (`officeplanmodel.ts:532`), so three such projects fill the right half with dark
rooms.

## Decision

The office becomes a building of **floors**. A floor is one screen: four project rooms around the hall, never
scrolled. A **lift** at the foot of the hall takes the boss between floors. Each project is one room that holds its
agents' desks and its runs' meeting tables, so a run is a table, not a room. The person arranges the rooms by dragging
them, between slots and between floors.

## Keyboard first

Everything in the office is done from the keyboard; the mouse is a second way, never the only one. The walk keys
(← ↑ ↓ →), ↵, Esc, `m`, `j` `k`, `n` and `f` keep their meaning. This spec adds:

| Key | Where | Does |
|---|---|---|
| PageUp / PageDown | anywhere on a floor | ride one floor up / down |
| ↵ | at the lift doors | open the lift panel |
| ↑ ↓, ↵, Esc | in the lift panel | choose a floor, ride, close |
| ↵ | at a room's `+N` chip | the dialog box of what has no desk or table |
| `g` | in a room (the boss inside it, or at one of its desks) | pick the room up to move it |
| ← ↑ ↓ →, PageUp / PageDown, ↵, Esc | carrying a room | target slot, target floor, put it down, cancel |
| `n` | anywhere | next Needs you, riding the lift when it is on another floor |

The Office menu (`m`) lists each of these with its key, plus `Arrange automatically`.

## A floor

- **Four slots, 2 × 2, around the hall.** The hall keeps its 234 px down the middle: the lounge at its top (as today),
  the notice board on its left wall under the lounge, the lift at its foot. The two columns share the rest of the width;
  the two rows share the height. A floor fills the Office's box.
- **The number of slots never changes with the window.** A resize changes the rooms' size, never which floor or slot a
  room is in, so an arrangement survives a smaller window.
- **An empty slot is a dark room** titled `Empty room` with `Drag a room here` under it, so the floor stays a closed
  building.
- **Doors:** every room's door is high on its hall-side wall (60 px down), as the `Main` board draws it.
- **The foot of the building:** on G, the facade (brick, the glass doors, the **ARCTERM** sign); above G, a plain
  outer wall with windows.
- **Minimum size:** a floor is drawn no smaller than the office's 900 px minimum width (rooms 317 px wide) and rooms
  300 px tall. A shorter view scrolls the floor rather than shrinking its rooms further: below a 676 px tall Office
  (e.g. 1,050 × 650) the floor scrolls by the shortfall, since two 300 px rooms, the walls and the foot strip need
  676 px. A taller view gives its extra height to the rooms: a room is half of the view's height less 94 px (the top
  wall, the wall between the rows, the 40 px foot strip and 18 px of margin). The foot strip takes the 18 px and the
  odd pixel the halving leaves, so the floor fills the view exactly.

## A room

One kind of room for every project, drawn by the `Room` board.

- **On the floor at its top:** the project name (bold) and its counts (`7 agents · 3 runs`), as today; the lights rule
  is unchanged (off when no agent works or asks and no task runs).
- **Desks** in rows from the top, ordered by agent name, then id: one every 116 px across, a row every 110 px down. The
  desk, the poses, the labels (`Needs you`, `done`, a dimmed name for someone in the lounge) are today's.
- **Meeting tables** in a strip 124 px tall at the room's foot, always kept, one table every 190 px across. A table
  seats the lead at its head and the first four tasks (two on the far side facing you, two on the near side with their
  backs), with `+N` on the table past four. A small screen over the table holds the run's DAG, a square per task (up
  to 12) in its state's colour. Under the table: `<run title> · <done> of <total>`. Runs at work take tables before
  runs that are done, then by start.
- **A project with no run** has no table: the strip is carpet with a plant. There is no empty meeting room.
- **Capacity comes from the room's size:** desks per row `⌊(w − 24) / 116⌋`, desk rows `max(1, ⌊(h − 124 − 60) / 110⌋)`,
  tables `max(1, ⌊(w − 10) / 190⌋)`. At a 1,050 × 650 Office a room is about 390 × 300: 3 desks and 2 tables. At
  1,600 × 1,000 it is about 667 × 453: 10 desks and 3 tables.
- **What does not fit goes in one chip** at the right of the title row: `+3 agents · +1 run`. While someone in it asks,
  the chip is amber and starts with `!`. The chip is a stop in the office order: ↵ at it opens the dialog box with one
  row per hidden agent or run (name and state word); ↵ on a row opens that card beside the chip.
- **Stable places:** a state change never moves anyone between a desk and the chip. Only a new or removed agent or
  run, a resize, or a run finishing (done runs yield their table) changes who sits where.
- **Home** is a room like the others: the agents with no project and the runs with no project. The `Other runs`
  band and the Home booth go.

## The lounge and the notice board

- **Every floor has its lounge**, holding the idle people of that floor's rooms. Its fixed spots, its fill order and
  `+N in the lounge` are today's.
- **Every floor has the notice board**, at the same place (the hall's left wall under the lounge), and every board
  lists the Needs you rows of all floors: an ask is answered without riding the lift. Its reach (`deskAt`) and its stop
  in `order()` are per floor.

## The lift

Drawn by the `Main` and `LiftPanel` boards.

- **At the hall's foot:** two steel doors, a call button beside them, and a dial over them whose needle points at the
  floor shown, with `Floor <n>` over the dial.
- **Asks on other floors** show beside the doors: `▲ 1 on 2`, `▼ 2 on G` (amber, with the arrow), one line per floor
  with asks.
- **The panel:** the boss at the doors presses ↵ (or a click on the doors walks there and opens it). A steel plate
  opens beside the doors: `LIFT` and the current floor, then a round button per floor from the top floor down, the
  shown floor's lit, each with `Floor <n>` (or `Ground`), an amber `! N` when that floor has asks, and its projects'
  names. ↑ ↓ move between buttons, ↵ rides, Esc closes. The panel is the office's dialog box style, not a new
  component.
- **Anywhere on a floor**, PageUp and PageDown ride one floor up or down (`cockpit:office-floor`). Brackets are not
  used: Telex turns them into ơ ư.
- **Next Needs you (`n`)** rides to the ask's floor when it is on another one, then walks to it.
- **Floors:** G, 1, 2… as many as hold a room. A floor whose rooms are all hidden (by the project filter, or because
  their projects have no card) leaves the panel; the others keep their numbers.

## Riding

Drawn by the `Ride` board: the boss walks into the lift; two steel doors close over the whole floor (280 ms, the exit
duration); the dial ticks floor by floor (360 ms a floor); the doors open on the new floor (360 ms) and the boss steps
out by the lift. With reduced motion, or the Office animation off, there are no doors: the floor swaps at once and the
dial points at it.

## Arranging rooms

Drawn by the `Drag` board.

**By keyboard (the main way):**

- **`g`** picks up the room the boss is in. The room's slot shows dashed and dims, and a card in the target slot says
  `Moving <room>`, `Swap with <room>` (or `Put it here` over an empty slot), and the keys.
- **← ↑ ↓ →** move the target among the floor's four slots; it lights grey with a dashed edge (selection in grey,
  never the accent).
- **PageUp / PageDown** ride the lift with the room, the lift panel open as a map of the floors. A full floor shows
  `Floor full` and the target stays on the slots to swap with; PageUp past the top floor targets `+ New floor`.
- **↵** puts the room down: it swaps with the target slot's room (an empty slot simply takes it), or builds the new
  floor with the room in its first slot. **Esc** (or `g` again) puts it back where it was.

**By mouse (the second way):**

- **Drag a room by its title** (a 4 px threshold, so a click still selects). The room's slot shows dashed and dims;
  the slot under the pointer lights grey with a dashed edge (selection in grey, never the accent); a card follows the
  pointer: the room's name, its counts, and `Drop to swap with <room>` (or `Drop here` over an empty slot).
- **Drop on a slot** swaps the two rooms (an empty slot simply takes it).
- **To another floor:** while dragging, the lift panel opens by itself; drop on a floor's button to move the room
  there, into that floor's first empty slot. A full floor's button takes no drop and says `Floor full`. `+ New floor`
  at the top of the panel builds the next floor with the room in its first slot.
- **Esc** cancels a drag.
- **`Arrange automatically`** in the Office menu (`m`) clears the saved arrangement.

## The arrangement

- **Saved per viewer in localStorage** under `cockpit.office.layout`: `{ v: 1, rooms: { [project]: { floor, slot } } }`,
  read and written in try/catch like the Office's other choices. Anything unreadable falls back to arranging
  automatically.
- **Arranging automatically:** Home first, then projects by name, each into the first empty slot from G up.
- **A project with no entry** (new, or after `Arrange automatically`) takes the first empty slot from G up, and is
  saved there.
- **A project that leaves** (no card) frees its slot on screen but keeps its entry. When it comes back it returns to
  its slot if that slot is empty, and otherwise takes the first empty slot and is saved there. So no slot is held
  empty for an absent project.

## Files

| File | Change |
|---|---|
| `view/agents/officelayout.ts` (+ test, new) | the arrangement: parse and serialise, arrange automatically, place a newcomer, swap, move to a floor, new floor, the floors that show |
| `view/agents/officeplanmodel.ts` (+ test) | `buildPlan` builds one floor: four slots, one room kind, capacity by size, the chip, tables in place of meeting rooms; bands, meeting rooms, the empty meeting room, the Home booth and `OTHER_RUNS` go; `popupBox` opens right of a left-column room, left of a right-column one |
| `view/agents/officecontrols.ts` (+ test) | the lift panel and carrying a room as layers: their keys, and the menu items with their keys |
| `view/agents/officeboss.ts` (+ test) | walls and doors of the 2 × 2 floor; the lift doors as a place to stand; the chip as a stop |
| `view/agents/officestore.ts` | `officeLayoutAtom`, `officeFloorAtom` |
| `view/agents/cockpitoffice.tsx` | the lift (doors, dial, `▲ n on X`), its panel, the ride, dragging rooms, the chip's dialog |
| `view/office/scenery.ts` (+ test) | the floor's materials: the room's meeting strip, the lift, the facade only on G |
| `view/agents/usecockpitkeyboard.ts` | PageUp / PageDown, next Needs you across floors |
| `store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md` | `cockpit:office-floor` (PageUp / PageDown), `cockpit:office-move` (`g`) |
| `scripts/cockpit-fixtures/scenarios.mjs` | `office-floors`: 9 projects over three floors, a full room, asks on two floors |
| `scripts/cdp/cockpitofficescenarios.mjs` | `cockpit-office` redrawn; `cockpit-office-floors` (below) |
| `docs/guide/cockpit.md`, `CHANGELOG.md` | the floors and the lift; one Changed line |
| `docs/open-issues.md` | RAM watch: the bench before and after |

## Verify

- **vitest:** `officelayout.test.ts` (arrange automatically; a newcomer's slot; swap; move to a full floor refused; new
  floor; a leaving project frees its slot and returns to it; a taken slot sends it to the first empty one; junk in
  storage falls back). `officeplanmodel.test.ts` (capacity at 900, 1,050 and 1,600 px wide; the chip and its `!`; a
  state change moves no one; done runs yield their table; no room with no run has a table; nothing overlaps; doors on
  the hall side).
- **vitest `officecontrols.test.ts`:** the lift panel's and the carry layer's keys; `g` outside a room does nothing;
  Esc puts the room back.
- **CDP `cockpit-office-floors`** on the `office-floors` fixture, driven by keys (`Input.dispatchKeyEvent`): shots of
  floor 1, the lift panel open (↵ at the doors), floor 2 after PageUp, a room carried with `g` → ↓ → ↵ onto another
  slot, the same swap once more by pointer drag, and floor 1 at 1,050 × 650 and 1,600 × 1,000
  (`Emulation.setDeviceMetricsOverride`), checked against the canvas's boards.
- **Bench:** `cockpit-office-bench` again. One floor draws fewer people than today's whole plan, so nodes and heap
  should fall; the numbers go into RAM watch, dated.

## Out of scope

- Sharing an arrangement across devices or viewers.
- Resizing a room, or more than four slots on a floor.
- Coins, the shop and decor (part 2 of the office): a bought room would be a slot, which this layout leaves room for.
- The Run office in Jarvis, which stays a side view.

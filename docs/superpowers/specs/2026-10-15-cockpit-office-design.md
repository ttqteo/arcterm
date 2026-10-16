# Cockpit office — design

**Date:** 2026-10-15
**Status:** built; the pixel-art revision below landed 2026-10-15. Part 1 of 4.
**Canvas:** `.superpowers/design/cockpit-office/project/` (gitignored; `Main`, `States`, `Night`, `Tired`,
`NextAsk`, `RamPanel`). The look follows the person's reference, Game Office (Steam): a floor plan seen from above, drawn here in
2D pixel art.
**Revised 2026-10-15 (pixel art):** **Drawing**, **Files** and **Verify** redrawn for a GBA-style look on two canvases;
canvas `.superpowers/design/cockpit-office-pixel/project/` (`Main`, `Night`, `Cast`).
**Revised 2026-10-16 (floors):** **The plan** is replaced by `2026-10-16-office-floors-design.md` (floors of four
project rooms, a run as a table, a lift); the side view's elevator listed under **Out of scope** comes back there, seen
from above.

## What it is

A second way to look at the Cockpit: **Cards | Office**. Office draws the same agents and runs the card grid holds as
the floor plan of an office seen from above: each project is a band with its agents' room on the left and a meeting
room per run on the right, the hall between them holds the lounge, and the entrance is at the foot. Each agent is a
person at a desk, facing you; each run's lead and workers sit around its meeting table. You are the boss, a person
you walk around the plan; the desk you stand at is the selected card, and its card opens beside the desk, so every
Cockpit action (answer, reply, open terminal, background, review) works from the office with the code it uses today.

It is for fun, and it is a working view: the person asked for an office that feels like a game while it stays the
Cockpit, and calm enough to look at all day (a denser, scenic draft read as clutter). Only what needs the person
stands out. RAM and CPU come first: the office ships only inside the budgets under **Benchmark**, and it shows its
own cost in the RAM panel.

## The parts

The office is built in four parts, each with its own spec, plan and run. A part starts only after the one before has
landed and the person has used it and still wants the next.

1. **This spec:** the floor plan, the boss, personalities, day and night, energy from the 5-hour quota, and the
   office's line in the RAM panel.
2. **Coins, shop, work-life** (own spec): coins for a task done, a run landed (more with no review-failed), a Needs
   you answered within minutes; never taken away on a failure. Coins buy decor (plants, rugs, a better coffee
   machine) and more rooms. The boss's own work-life: a day with no prompt after the end of work hours earns a bonus
   and grows the office plant (off by default). Coins are counted in wavesrv, once per task, run or ask id, so they
   accrue while the Cockpit shows Cards.
3. **The pet as photographer** (own spec): whichever pet is picked (Sprout, Minion, Spider-Man) takes photos in its
   own way (Spider-Man swings in on a web and flashes; Minion shoots crooked; Sprout holds the camera on its leaf):
   a run's Final shots, a keepsake when a task is done or a run lands (stored as scene data, redrawn when viewed, no
   PNG), and each new canvas. Photos hang on a wall; a click opens the Final shots viewer, the keepsake, or Agent →
   Canvases. Changing the pet or the theme loses nothing.
4. **System staff** (own spec): arcterm's background systems as office staff, each shown only while it has work.
   The cleaner is AutoClean (`pkg/storage/autoclean.go`): she pushes her cart through the rooms when it has cleaned
   something, with a line saying what (`3 worktrees, 120 MB`). The guard at the entrance is the Token burn guard
   (`pkg/tokengate`): while a costly spawn waits, he stands at the doors with the would-be subagents queued outside,
   and the boss walking up opens that Token burn card. The queue at the machine room is the job queue
   (`pkg/jobqueue`): each heavy command waiting for RAM is a person holding a box; a click opens the Jobs popover.

No part calls a model. Every rule reads data arcterm already holds: agent and task states, the quota, the clock.

## Where it lives

- The Cockpit's heading row gets a **Cards | Office** segmented toggle beside **Live only**, and `o` toggles it
  (Cockpit binding `cockpit:office`, documented in `docs/keyboard-shortcuts.md`). The choice is `cockpitViewAtom`
  (`atomWithStorage("cockpit.view")`, `"cards"` by default; storage read in try/catch, falls back to cards).
- Office replaces **only the card grid**. The status tabs, the project switcher, Live only, the Needs you strip (in Office
  the hall's notice board since 2026-10-16), the folded sections under the grid (Backgrounded, Idle, Background), the
  Events rail and the HintsBar stay as they are.
- The office draws exactly the cards the grid would draw after the tab, project and Live only filters, and the
  agents of the Idle section (an agent idle past the Finished window, which the grid parks there), so a filter
  narrows the office as it narrows the grid. In Office the Idle section is not drawn under it: its agents are in the
  lounge. Background agents and plain terminals stay in their folded sections.
- Off (Cards), nothing of the office is mounted. Leaving the Cockpit unmounts it, as every surface but Agent does.

## The plan

Seen from above at a steep angle: a horizontal wall shows its top and its face, a vertical wall its top only, and a
person at a desk faces you. Pure layout in `officeplanmodel.ts`; every size below is at the office's 1,050 px width,
and the two columns share whatever width the hall leaves.

- **A band per project** that has a card, ordered by project name. A band is the **agents' room** on the left and a
  column of **meeting rooms**, one per run with a card, on the right. The band is as tall as the taller column; the
  last room of the shorter column stretches to fill it.
- **The agents' room:** the project's name and counts (`3 agents · 2 runs`) on the floor at its top left, then desks
  in rows of three (120 px apart, rows 130 px apart), ordered by agent name, then id; a plant in a free corner.
- **A meeting room:** the run's title and `run · <done> of <total> done` on the floor, and on the wall a screen with
  the run's DAG: a square per task in its state's colour (as the Run office's wall board) and a done bar. Around the
  table, the lead sits at the head (the first seat), then the workers in task order, alternating the far side
  (facing you) and the near side (their backs). A room is 132 px tall; a run with more than 11 tasks shows 11 seats
  and a `+N` on the table. Rooms are ordered by the run's start. A band with no run keeps one empty meeting room,
  dark, titled `Meeting room` with `no run` under it, so the band stays a closed building.
- **The hall** runs between the columns, top to bottom (234 px wide). At its top, **the lounge**: a rug, a TV on the
  wall, the sofa facing it, the coffee machine and a plant, where idle people go. At its foot, by the entrance,
  **Home**: a booth holding the cards with no project, one desk per row; it grows up the hall, under the lounge.
  Between the lounge and Home hangs the Needs you notice board (`2026-10-16-office-needs-you-board-design.md`).
- **The lounge holds a fixed set of spots:** the sofa's seats, and standing places by the coffee machine and the
  plant, as many as fit with their labels: every label sits whole inside the lounge, over no other label or person
  (a name too long for its room is cut with an ellipsis, the full text in the person's title). Spots fill by
  `idleSince`, longest first, so a newcomer never moves someone already there. Whoever does not fit is not drawn: a
  muted `+N in the lounge` line in the lounge counts them, and their desk stays empty and dimmed, its title saying
  where they are. The lounge never grows, so a crowd moves no room. The standing spots stay where the canvas's `Main`
  board has them (feet 88 px down the lounge, their labels at 90, clear of the coffee machine's screen); the chibi's
  standing sprite reaches 19 px from the lounge's top, so `+N in the lounge` sits in the free row between the
  standing labels and the people on the sofa (x 8–158, y 106–120 in the lounge), clear of the machine.
- **Doors:** every room has one door onto the hall, in the upper part of its hall-side wall (an agents' room's level
  with its first row of desks, as the `Main` board draws it), so a stretched room keeps its door where it was; the
  Home booth's is in its top wall. The plan grows so the booth sits below every door of the left column: no door opens
  into it.
- **The facade** closes the plan at the bottom: brick with windows, glass doors at the foot of the hall, and the
  **ARCTERM** sign over them. The outer walls carry small windows on their faces.
- **Lights:** a room with no one at work (no agent working or asking, no task running) has its lights off: a dark
  layer (`--color-office-dark`) over its floor, furniture and people, under the walls and labels, so the eye goes to
  the rooms where something happens. Home's booth follows the same rule; the hall and the lounge stay lit.
- **Stable places:** a state change never moves a desk, a seat or a room. Adding or removing a card or a run shifts
  only what comes after it. A plan taller than the office scrolls vertically, and follows the boss.
- **Labels:** under each desk the agent's name. A state word shows only where it matters: **Needs you** (amber, bold)
  and **done** (green, the Finished window). A desk whose person is away shows the name dimmed; a person in the
  lounge carries `<name> · idle <age>`. Every desk and seat has the full state in its `title` and `aria-label`
  (`loom · working (Enter opens the card)`), so status is never pose or colour alone.

## Poses (seen from above)

Pure mapping in `officeplanmodel.ts`. An asking agent, or a run worker whose agent is asking, always raises a hand.

| Agent | Pose | At the desk |
|---|---|---|
| `working` | sitting, a nod over the keys (2 frames) | monitor light green |
| `asking` | raised hand (2 frames), `!` bubble | light amber, label **Needs you** |
| `idle`, in the Cockpit's Finished window (5 min, `IDLE_GRACE_MS`) | cheers once (2 frames, ~1.5 s), then dozing | label **done** |
| `idle` past it (in the Idle section), waiting for a free walker slot | dozing, eyes closed | light off |
| `idle` past it | walks to the lounge, stands at the coffee machine with a cup | desk empty, dimmed |
| `idle` 10 min or more | walks to the sofa, sits with the back to you, watching the TV | desk empty, dimmed |

| Run seat (task state, `pkg/orchestrate/dag.go`) | Pose |
|---|---|
| lead | sitting at the head; dozing once the run has landed or stopped |
| `pending`, `cancelled`, `skipped` | empty chair |
| `ready`, `running`, `reviewing`, `verifying`, `blocked-merge` | sitting, the nod while running |
| `stalled` | dozing, `?` bubble amber |
| `review-failed`, `verify-failed`, `failed` | sitting, `×` bubble red |
| `done` | dozing |

A person away from the desk walks back when the agent is working or asking again.

## The boss

- A standing person in the boss outfit (`--color-office-boss`), drawn walking down, up or sideways (← is the
  sideways sprite mirrored in CSS). At a desk it stands on the floor just in front of it, its back to you, looking at
  the desk, with a ring in the focus colour under its feet. It starts at the desk of the Cockpit's cursor card, else
  the first Needs you desk, else the first desk.
- **Keys in Office** (only while the Cockpit owns the keyboard), a Game Boy's: the arrows, `↵` as A, `Esc` as B, `m`
  as START (2026-10-15, canvas `office-controls`; rules in `officecontrols.ts`).
  - Walking: `←` `↑` `↓` `→` walk (held, the boss keeps walking; walls stop it, doors let it through); `↵` at a desk
    opens its dialog box; `f` its full card, big.
  - Dialog box: `↑` `↓` move the ▶ (over a dim item), `↵` does it, `←` `→` and `h` `l` switch the question of a
    several-part ask, `f` the full card, `Esc` back to walking.
  - Full card: the arrows walk away (shutting it), `↵` works as on a card, `f` grows or shrinks it, `Esc` back to the
    dialog box.
  - Everywhere: `j` `k` the next or previous desk in office order, `n` the next Needs you (its dotted path first),
    `m` the office menu (`↑` `↓` `↵`, `Esc` or `m` shut it); `1`–`9`, `r`, `t`, `b`, Space act on the desk at the boss.
    A key with Cmd, Ctrl or Alt is never the office's.
- **The desk at the boss** is the desk or seat whose spot is nearest, in the room the boss stands in. It is the
  Cockpit's cursor card (a seat's card is its run's `LeadCard` with that task's row as cursor), so the keyboard's card
  order in Office is the office order. In the hall or the lounge the cursor stays on the last desk.
- **Mouse:** a click on a desk, a seat or a meeting room walks the boss there and opens its dialog box; a click on the
  floor walks the boss there.
- **Reduced motion or animation off:** the boss is at once where it would have walked.

## The popup

- **The dialog box** (↵ or a click on a desk) sits at the foot of the office's view, or at its head when a box at the
  foot would cover the boss, so it never covers the desk. A plate on its top edge names who talks (an agent's status
  line, ending "Needs you · <age>" while the agent asks; a run's mark, title, project and lead); the left holds what
  they say (an agent's question under its last words and its last steps, a diff line reading "+N −M in K files", its
  model, tokens, context and age; a run's lead's last line, the task bar, the counts and a column of tasks; a seat's
  task row and its worker), the right a ▶ menu: the answers then Send (dim until every question has one; a question in
  several parts under ◀ its header ▶ and "1 of 2"), or the row's own actions (Tell stays on the full card, whose input
  takes the words), then Open, Reply, Terminal, Background (Open lead and Adjust at a run), and Full card. Only the item
  under the ▶ shows its key. A several-question box keeps Terminal under its answers (the States tile leaves it out for
  room). A run's ▶ menu is 220 px wide, 268 px elsewhere.
- **The full card** (Full card or `f`) is the grid's own `AgentRow` or `LeadCard` beside the desk, as before; Adjust
  opens a run's card with its Adjust panel. No card is rewritten for the office.
- **The office menu** (`m`, or the footer's `m menu`, whose chip lights while it is open) lists Next Needs you, Next
  desk, Previous desk, Events, Cards view and All keys, each with its key.
- **The office fills the Cockpit**: no title; the counts that filter, Cards | Office, the project switcher and Live only
  sit in a HUD bar inside the view, after the clock and energy. The footer holds `m menu` and the newest event; the
  Events rail is hidden in Office until the menu's Events shows it (Esc while walking hides it). The Needs-you strip,
  the Backgrounded section and the background-agents strip stay under the office as in Cards (no board draws them).
- **Open terminal** leaves for the Agent surface through `openTarget`, as the card does today.
- **Card streams:** Office keeps the grid's streams, one per live agent. Stopping a stream drops that agent's live
  entries, and the Cockpit hides an agent with nothing to show, so streaming only the full card would take agents out
  of the office and the tab counts; trimming streams needs a fix of its own.

## Personality, day and night, energy

- **Looks:** skin and hair (1..4) by a hash of the agent id; shirt by harness (claude, codex, pi, agy, other), as new
  identity tokens. Run workers wear the lane colours by task position; the lead wears `--color-office-lead`.
- **Walkers:** at most 3 people (the boss not counted) walk at once; the rest wait at their desk in order of
  `idleSince`. They walk the boss's way, through the doors. Who goes where is a pure function of state, `idleSince`,
  the id hash and the time (`officebehavior.ts`); the Cockpit's coarse clock (`structuralNowAtom`, ~15 s) advances
  it, and the office runs no timer of its own for this. No per-person timers, no randomness.
- **Day and night** from the local clock and the work hours (`officeHoursAtom`, `atomWithStorage("cockpit.office.hours")`,
  9 to 18 by default; Saturday and Sunday count as outside hours). Day: the windows are light. Evening (the 3 h after
  the end) and night: the windows go dark, the floors take the night tint (`--color-office-night`), an idle person's
  desk is empty (gone home, label `gone home`), a person at work gets a desk lamp and its pool of light, a meeting
  room with a running task lights its table, and the sign glows brighter. The same coarse clock re-reads the phase.
- **Energy** from the 5-hour window of the active Claude account, the one the app bar meter draws
  (`ratelimitstore.ts`, `fivehour`):

  | 5-hour use | Office |
  |---|---|
  | under 70 % | as above |
  | 70–90 % | a working person yawns one frame in eight, offset by the id hash |
  | 90 % and over | a coffee cup on every working desk, and a yawn one frame in four |
  | drops from 70 % or more to under 20 % (a reset) | everyone at a desk stretches once |
  | unknown (no reading) | as under 70 % |

  The office's heading shows `⚡ <percent>` beside the clock as energy, what is left of the window (100 % less the use:
  4 % used reads `⚡ 96 %`), `⚡ —` when unknown; at 10 % left and under it is amber.

## Drawing

Pixel art seen from above, in the manner of a GBA game (the person's reference is Pokémon FireRed's interiors; every
person and object here is drawn for arcterm, nothing is copied). **Canvas:**
`.superpowers/design/cockpit-office-pixel/project/` (`Main` in work hours, `Night` after hours, `Cast` every pose);
the options not taken sit beside it in `options/`, and the script that drew it in `prototype/` (its `README.md` says
what to port from where).

- **One grid.** 1 art px = 3 CSS px (`PLAN_CELL`), tiles of 16 art px. Every place snaps to it
  (`art(v) = Math.round(v / 3)`): the plan's layout does not change (desks 120 px apart, rooms where they are), and a
  row 130 px down lands within 1 px of it.
- **The look.** A dark outline of 1 art px around every person and object; a drop shadow of 1 art px on the floor at
  the right and bottom edges of furniture; furniture shows its top and its front. A horizontal wall shows its cap and
  a face of 6 rows (wallpaper, a wood trim, its shadow), 3 of them inside the room below; a vertical wall shows its cap
  only; the outer top wall has windows in its face, and the lounge's TV hangs on it. Floors: planks with seams and
  knots (agents' rooms, Home), 16 px tiles (the hall), a dithered carpet (meeting rooms), a rug in the lounge. Few
  tones and little decor: the person looks at this for hours, and only Needs you and done stand out.
- **Two palettes.** Work hours draw the bright one (`Main`); after hours (the evening, the night and the weekend, the
  phase the office already reads from `officeHoursAtom`) draw the muted one (`Night`). Each is the full set of the
  scenery's base roles, `--color-office-day-*` and `--color-office-after-*`; the switch is one redraw. Dark rooms, the
  night tint and the lamps' pools work the same over both.
- **People: a chibi set** in `view/office/plansprite.ts`, 14 columns: standing 23 rows (the boss, walkers, a cup),
  seated 17 (its last two rows under the desk's top), raised arms 20 columns, placed 3 to the left. Poses: sit and its
  nod, hand (2), cheer (2, the second a hop), doze, yawn, stretch, back (on the sofa), back at a table (its chair's
  back in its last rows), cup, walking down, up and sideways (2 each), the boss at a desk. Role codes only: `O`
  outline, `H`/`h` hair and its light, `S`/`s` skin and its shade, `E` eyes, `T`/`t` shirt and its shade, `P`/`p`
  pants, `K` shoes, `C` cup, `B` the boss's cap, `W` badge and tie, `R`/`r` chair, `_` ground shadow; a shade or a
  light is its role's colour times a fixed factor. Looks 1–4 differ by hair style (short, bob, a tuft, a bun) and
  colour; the boss alone wears a cap. Outline, shadow and chair follow the phase, so a sprite's cache key carries the
  phase, and a near-side seat's its shade (below). Rasterised once to a software canvas and kept as a data URL, as
  today; the cache stays ≤ 600 entries. The Run office keeps its side-view set and its tokens unchanged.
- **Bubbles** (`!`, `?`, `×`) and the boss's ring are pixel sprites from the same cache, still one `<img>` each.
- **A desk** carries a laptop, its lid toward you; the logo on the lid glows working green or asking amber, or is
  off (a monitor hid the person's face; the tower goes). When energy is tired, a cup stands on every working desk.
- **The building is two canvases.** Floors, walls, furniture, the facade and every light are drawn at art resolution
  (`ceil(width / 3) × ceil(height / 3)`, a 2D context with smoothing off) and scaled 3× by CSS with
  `image-rendering: pixelated`. A canvas costs 4 × W × H bytes: 0.35 MB at the canvas's fixture, about 1.5 MB at the
  bench (screen resolution would cost 9× that on a retina display). The DOM keeps what is read, clicked or moves; the
  259 nodes of today's floors, walls, windows, dark layers, screens, sign and desk parts become the two canvases.

  | z | Layer | Holds |
  |---|---|---|
  | 0 | under canvas | floors, wall faces and their windows, the TV, the chairs behind people (at a desk, on a table's far side), the sofa's seat and arms, the coffee machine, plants, each run's screen, the facade, every shadow |
  | 1 | people (`<img>`) | at a desk, on a table's far side, in the lounge |
  | 2 | over canvas | desk tops and laptops, the tables, the sofa's back, the near side's chairs; then each dark room and the night tint; then the lamps and their pools; last the wall caps and the sign, which no tint covers |
  | 3 | near side (`<img>`) | a seat with its back to you, over the table. Its sprite ends with the chair back the over canvas draws in the same place, so the chair covers the person's back and an empty chair still shows. A near-side worker who asks turns to face you with its hand up, at the same z and shaded the same way: under the over canvas the table would cover the face that needs you. Being over the tints, its sprite is rasterised shaded (the dark layer, the night tint, or both) when its room is dark or it is after hours |
  | 3 | buttons | one transparent button per desk, seat and meeting room: the click, `title`, `aria-label` and the focus ring, with no children |
  | 6 | labels | room titles, names, the lounge's labels, `+N`, bubbles |
  | 7 | movers | walkers, the boss and its ring, the path's dots |
  | 8 | the card | the popup and the ↵ |

- **Redraw only when `sceneryKey` changes:** the plan's geometry (rooms, walls, doors, desks, seats, tables), each
  room's light, each desk's light, each run's screen, tired or not, the phase, and the theme (a run's screen and the
  laptops' lights are status tokens). Never on the frame clock, a walk step or a pose: a pose, a walker or a label
  changes no key. A theme change also clears the colours `tokenRgb` keeps and the plan's sprites. An away desk is no
  longer faded: its empty chair and its dimmed name say it.
- **Labels** cut at 116 px with an ellipsis, the full text in the title (desks are 120 px apart; 140 px labels
  overlapped). In work hours the floor is light, so names, room titles and the lounge's labels sit on a plate
  (`--color-office-plate`); after hours they don't. Room titles stay 10 px under the room's top, under the wall's face.
- **Tokens** in `@theme`, held at their defaults by every theme, with a why comment: the two phase sets (`ink`,
  `shadow`, `wood`, `seam`, `face`, `cap`, `trim`, `glass`, `tile`, `grout`, `carpet`, `rug`, `desk`, `desk-face`,
  `chair`, `metal`, `laptop`, `screen`, `sofa`, `sofa-face`, `leaf`, `leaf-dark`, `pot`, `brick`, `mortar`), the plan's
  hair (`--color-office-plan-hair-1..4`, lighter than the Run office's so an outline shows around it) and
  `--color-office-plate`. They replace the plan's flat ones (`wall-top`, `wall-face`, `wood-1`, `wood-2`, `tile-1`,
  `tile-2`, `carpet`, `hall`, `desk-top`, `desk-face`, `sofa`, `brick`, `mortar`, `window-day`, `window-night`,
  `plant`, and the shadows `--shadow-office-sign`, `-sign-night`, `-lamp`). `--color-office-dark`, `-night`, `-lamp`,
  `-cup`, the shirts and the boss stay. Values are the canvas's (`prototype/palette.mjs`); derived roles (a plank's
  second tone, a knot, highlights) are fixed factors in `officepalette.ts`. The sign's frame is the accent: it is the
  brand.
- Desks and seats outside the view stay `content-visibility: auto` on their buttons.

## Motion

- **Frame clock** (450 ms) flips the 2-frame poses. It runs only while some drawn person has an animated pose
  (the nod, a raised hand, cheer, yawn, stretch); only those people subscribe to it.
- **Walk clock** (`requestAnimationFrame`) runs only while the boss or a walker is moving, and moves them by
  `transform: translate(x, y)` in whole cells (3 px). The boss walks at ~160 px/s, ~400 px/s on `j` `k` `n` or a
  click; a walker at ~60 px/s. It stops when everyone has arrived. A step writes that transform on the DOM, not
  through React: React draws a mover again only when it turns, sets off, stops or flips its walking frame (180 ms),
  and a mover has its own layer (`will-change: transform`) while it walks, so a step repaints nothing under it.
- Both clocks stop while `document.hidden`, under `prefers-reduced-motion`, and with **animation off**
  (`officeAnimationAtom`, `atomWithStorage("cockpit.office.animation")`, on by default): then every pose holds frame 0,
  and people and the boss stand where they are going. No CSS animation and no `motion/react` on people.
- With no animated pose and no one walking, no clock runs: a quiet office costs nothing per frame.

## Its cost in the RAM panel

The Consumers panel (from the RAM chip) already lists **Interface**, the webview that draws the cockpit, in its
**arcterm** block (Agents, Interface, Server, Host, Terminals: RAM only on a Mac; CPU per process is read only where
the Resource Manager runs, on Windows). While the office is mounted the block gets an **Office** line under those
figures, in both the full and the compact panel:

```
arcterm                                              Total, with agents 2.1 GB
Agents 1.4 GB   Interface 312 MB   Server 96 MB   Host 41 MB   Terminals 210 MB
Office  ● animating · 2 walking · 6 typing
        Office JS 0.3 %   72 people   140 images · 180 KB   1,350 nodes   [Turn animation off]
```

- **Measured:** the office's own JS time (`performance.now()` around each frame-clock and walk-clock step, summed
  over the last 10 s, shown as a share of one core), the people drawn (people at a desk or a seat, in a lounge
  spot, walking, and the boss; never the `+N`), walking and animated, the sprite cache's
  entries and bytes (the data URLs' lengths), and the office root's DOM nodes. The counters are read only while the
  panel is open.
- **Not shown:** a heap figure for the office alone. WKWebView has no `performance.memory`, so a number there would be
  made up; Interface above is the whole webview's RAM, office included. The tooltip says the JS figure leaves out
  the browser's own layout and paint; the whole webview's CPU is Interface's CPU where the panel reads it (Windows),
  and on a Mac arcterm's WebKit web-content process in Activity Monitor, read with the animation on and then off.
- The button sets `officeAnimationAtom`; Settings → Appearance → Office holds the same switch and the work hours.

## Files

| File | Holds |
|---|---|
| `view/office/plansprite.ts` (+ test) | the plan's chibi grids and roles, the bubbles and the ring; a sprite in an outfit, a phase and a shade |
| `view/office/officepalette.ts` (+ test) | the scenery's roles per phase, their token names spelled in full, the derived roles' factors |
| `view/office/officegrids.ts` | grids the scenery and the people share pixel for pixel: the near side's chair, drawn by the over canvas and ending a near-side person's sprite |
| `view/office/scenery.ts` (+ test) | plan, phase, tired → what each canvas draws, in order; the floors' materials; `sceneryKey` |
| `view/office/spritecache.ts` (moved from `view/jarvis/officesprites.ts`) | rasteriser and data-URL cache for any grid set; entries and bytes for the meter; colours with alpha, cleared on a theme change |
| `view/office/officeclock.ts` (+ test) | the frame and walk clocks, their run/stop rules, the meter counters (`officeMeterAtom`) |
| `view/jarvis/office*.ts(x)` | import the cache from `view/office/`; nothing else changes in the Run office |
| `view/agents/officeinputs.ts` (+ test) | the grid's cards and the Idle section's agents → the plan's input |
| `view/agents/officeplanmodel.ts` (+ test) | cards and runs → bands, rooms, desks, seats, doors, labels, office order, poses, popup side; the lounge's person sizes follow the chibi set |
| `view/agents/officebehavior.ts` (+ test) | idle → coffee and sofa, the 3-walker queue, energy, day and night |
| `view/agents/officeboss.ts` (+ test) | keys and clicks → boss position; walls and doors; paths through doors; desk at the boss |
| `view/agents/officestore.ts` | `cockpitViewAtom`, `officeHoursAtom`, `officeAnimationAtom` |
| `view/agents/cockpitoffice.tsx` | the two canvases (drawn from `scenery.ts` when `sceneryKey` changes), people, buttons, labels, boss and popup |
| `view/agents/cockpitofficedevhooks.ts` | DEV-only `__cockpitOffice` / `__cockpitOfficeProbe` for the CDP scenarios |
| `view/agents/cockpitsurface.tsx` | the toggle; Office in place of the grid |
| `view/agents/usecockpitkeyboard.ts` | Office keys, office order for `j` `k` `n` |
| `view/agents/consumers.ts`, `consumerspanel.tsx` | the Office line |
| `store/keybindings/bindings.ts` | `cockpit:office` and the walk keys (documentation bindings, as the Cockpit's are) |
| `settingspages/appearance.tsx`, `settingsmodel.ts`, `settingssurface.tsx` | Settings → Appearance → Office: animation, work hours |
| `frontend/tailwindsetup.css` | the tokens above |
| `scripts/cockpit-fixtures/scenarios.mjs` | `office-bench`: 48 agents over 6 projects, every agent state |
| `scripts/cdp/cockpitofficescenarios.mjs` | `cockpit-office` (visual) and `cockpit-office-bench` (budgets), listed in `scenarios.mjs` |
| `docs/guide/cockpit.md`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md` | the Office section, the keys, one `<!-- big -->` line |
| `docs/open-issues.md` | RAM watch: nodes and busy before and after the canvases |

## Benchmark

The office ships only inside these budgets, measured by `cockpit-office-bench` on the dev app (headless Chrome on a
Mac, `task dev:browser`).

**Fixture:** the `office-bench` roster (48 agents over 6 projects, every agent state, 2 asking) through the cockpit
fixtures, plus 3 runs of 8 tasks through a DEV-only hook (`__cockpitOfficeRuns`), about 75 people. The runs exist only
in Office, so the comparison overstates the office's cost, never understates it.

**Scenario:** Cockpit in Cards, GC, read `Performance.getMetrics`; hold 30 s (the baseline); switch to Office, wait
2 s, GC, read; hold 30 s with 3 walkers and the boss walking; hold 30 s quiet (every agent idle inside the Finished
window, the hold starting once everyone has settled at a desk and no clock runs); then repeat the walking hold under
`prefers-reduced-motion: reduce`; switch back to Cards, GC, read; open Office and switch back to Cards again, GC,
read. The second round trip is what row 7 holds: a leak grows on every trip, while the dev page's own growth over
the bench's minutes (+1.6 MB with the office never opened, run a81096a1) drowns a 1 MB budget measured from the
first Cards read. The first trip's figure is printed for information.

| Measure | Budget |
|---|---|
| JS heap, Office minus Cards (after GC) | ≤ 5 MB |
| DOM nodes added | ≤ 2,000 |
| Main thread busy over the 30 s hold, minus the Cards baseline | ≤ 2 % |
| Same, reduced motion | ≤ 0.5 % |
| Same, quiet office | ≤ 0.3 % |
| Sprite cache entries | ≤ 600 |
| Heap a second Office round trip adds, back in Cards (after GC), minus the first return's read | ≤ 1 MB |
| Toggle click to the office drawn | ≤ 150 ms |

Estimated from the Run office's measured numbers (104 desks: +1.6 MB, ~1,500 nodes): about 900–1,200 nodes and
+1–2 MB at this fixture. The scenario prints the numbers in its PASS/FAIL row and fails over budget. They go into
`docs/open-issues.md` under **RAM watch**, dated. A miss is reported, not tuned away by raising the budget. React's dev
build adds work per render (the Run office's busy miss), so the busy figures are read again on a production build with
the Office line in the RAM panel once the run has landed. That reading is not the run's: it is the effort chunk
`Re-measure: cockpit office busy on a production build`, and it goes into RAM watch too.

## Cost to build

About 2.5 times the Run office (one spec, a five-task run and two fix rounds): a new sprite set seen from above, the
plan's layout, and walking in two dimensions through doors.

## Out of scope

- Everything in parts 2 to 4: coins, shop, decor, work-life bonus, the photographer, the photo wall, the system
  staff.
- The pet in the office: it keeps walking the footer.
- The first draft's side view (a floor per project, an elevator), people talking to each other, sound, a city
  outside the building.
- An office anywhere but the Cockpit; the Run office in Jarvis stays as it is, side view.

## Verify

- vitest: `officeplanmodel.test.ts` (bands by project name; desks in rows of three by name; one meeting room per run,
  seats alternating sides, `+N` past 11 tasks; band height and the stretched room; Home's booth; doors; lights off in
  a room with no one at work and on again when someone starts; places stay put across state changes; each agent state and each task state maps to its pose and label; filters narrow the plan
  as the grid; office order), `officebehavior.test.ts` (idle thresholds, the 3-walker queue order, every energy band
  and the reset, day, evening, night and the weekend), `officeboss.test.ts` (walls stop, doors pass, `j` `k` `n`
  targets and their paths through doors, the dotted path's points, the desk at the boss, the cursor kept in the hall), `officeclock.test.ts`
  (each clock runs only when it should and stops when hidden, reduced or off), `plansprite.test.ts` (every grid is its
  declared size: 14 × 23 standing, 14 × 17 seated, 20 wide with raised arms; only known codes; a pose's frames are the
  same size; the near-side seat's last rows are the chair the over canvas draws; the cache key carries the phase and
  the shade), `officepalette.test.ts` (every role has a token in both phases, spelled in full; a derived role is its
  base times its factor), `scenery.test.ts` (each object on its canvas: floors, faces, chairs behind people and
  shadows under, desk tops, tables, the sofa's back and near chairs over; within the over canvas the tints after the
  furniture and the caps after the tints; a dark room's tint covers its wall face; every position on the 3 px grid;
  `sceneryKey` changes with a room's light, a desk's light, a run's screen, tired, the phase and the theme, and
  not with a pose, a walker or a label), `spritecache.test.ts` (a colour's alpha is read; a theme change clears the
  colours).
- CDP `cockpit-office`: the `Main` board (day, the boss at quill with its card open, `1` answering from it), a click on
  a meeting room opening its `LeadCard`, the boss walking by arrow keys through a door, `n` showing its dotted path
  and crossing to the next Needs you (`NextAsk`), Home's booth with its lights off, the `Night` and `Tired` boards, every pose of the `States` board on its own small fixture, animation off,
  and the Office line in the RAM panel (`RamPanel`). `cockpit-office-bench` holds the budgets.
- The pixel canvas (`cockpit-office-pixel`): `cockpit-office` shows its `Main` board in work hours (the building on two
  `<canvas>` and no floor, wall or shade node; names on plates), its `Night` board after hours (the after-hours
  palette, no plates, lamps), and its `Cast` on the pose sheet (every sprite, no unresolved token); a walk of the boss
  and a frame-clock beat leave the scenery's draw count where it was, and a desk turning from working to idle redraws
  it once.
- Measured on `cockpit-office-bench` in a worktree of its own (its own `ARC_BROWSER_CDP_PORT`,
  `ARC_BROWSER_VITE_PORT` and `ARC_DEV_DATA_DIR`, since the bench writes `public/cockpit-fixtures/active.json`, which
  other sessions share): the office's DOM nodes and the three busy figures before (2026-10-15: 591 nodes) and after,
  written under **RAM watch** in `docs/open-issues.md`. The aim: about 250 fewer nodes, busy no higher.

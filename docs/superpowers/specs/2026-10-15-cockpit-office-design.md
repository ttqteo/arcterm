# Cockpit office — design

**Date:** 2026-10-15
**Status:** design agreed in chat, not built. Part 1 of 4.
**Canvas:** `.superpowers/design/cockpit-office/project/` (gitignored; `Main`, `States`, `Night`, `Tired`,
`RamPanel`). The look follows the person's reference, Game Office (Steam): a floor plan seen from above, drawn here in
2D pixel art.

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
- Office replaces **only the card grid**. The status tabs, the project switcher, Live only, the Needs you strip, the
  folded sections under the grid (Backgrounded, Idle, Background), the Events rail and the HintsBar stay as they are.
- The office draws exactly the cards the grid would draw after the tab, project and Live only filters, so a filter
  narrows the office as it narrows the grid. Background agents and plain terminals stay in their folded sections.
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
  and a `+N` on the table. Rooms are ordered by the run's start.
- **The hall** runs between the columns, top to bottom (234 px wide). At its top, **the lounge**: a rug, a TV on the
  wall, the sofa facing it, the coffee machine and a plant, where idle people go. At its foot, by the entrance,
  **Home**: a booth holding the cards with no project, one desk per row; it grows up the hall, under the lounge.
- **Doors:** every room has one door onto the hall, in the middle of its hall-side wall; the Home booth's is in its
  top wall.
- **The facade** closes the plan at the bottom: brick with windows, glass doors at the foot of the hall, and the
  **ARCTERM** sign over them. The outer walls carry small windows on their faces.
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
| `idle`, in the Cockpit's Finished window | cheers once (2 frames, ~1.5 s), then dozing | label **done** |
| `idle`, under 3 min | dozing, eyes closed | light off |
| `idle` 3 min or more | walks to the lounge, stands at the coffee machine with a cup | desk empty, dimmed |
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
- **Keys in Office** (only while the Cockpit owns the keyboard, as `usecockpitkeyboard.ts` decides today):
  - `←` `↑` `↓` `→` walk; held, the boss keeps walking. Walls stop it; doors let it through. (In Cards the arrows
    move the card cursor; in Office they walk, and `j` `k` move the cursor.)
  - `j` `k` go to the next or previous desk or seat in office order (band by band: the agents' room by rows, then its
    meeting rooms' seats; Home last); `n` goes to the next Needs you. The boss walks there through the doors: out of
    its room, along the hall, into the target room, to the spot in front of the desk.
  - `h` `l` switch question on a multi-question ask in the popup, as they do on a card.
  - Every other Cockpit key acts on the desk at the boss: `1`–`9`, `Enter`, `Space`, `r`, `t`, `b`.
- **The desk at the boss** is the desk or seat whose spot is nearest, in the room the boss stands in. It is the
  Cockpit's cursor card (a seat's card is its run's `LeadCard` with that task's row as cursor), so the keyboard's card
  order in Office is the office order. In the hall or the lounge the cursor stays on the last desk.
- **Mouse:** a click on a desk, a seat or a meeting room walks the boss there and opens its card; a click on the
  floor walks the boss there.
- **Reduced motion or animation off:** the boss is at once where it would have walked.

## The popup

- While the boss stands still at a desk, the desk's card shows beside it: the **same `AgentRow`** the grid draws,
  with the props `CockpitSurface` already passes the cursor card (selections, typed answers, composer), or for a seat
  or a meeting room the run's **`LeadCard`**. No card is rewritten for the office.
- It sits beside the desk on the hall's side (to the right of the agents' room, to the left of a meeting room), over
  the hall, with a pointer to the desk, kept inside the office's box. It hides while the boss walks and when `Esc` is
  pressed, until the boss moves again.
- **Open terminal** leaves for the Agent surface through `openTarget`, as the card does today.
- **Card streams:** in Office, `useCardStreams` is given only the popup's card, not one per agent.

## Personality, day and night, energy

- **Looks:** skin and hair (1..4) by a hash of the agent id; shirt by harness (claude, codex, pi, agy, other), as new
  identity tokens. Run workers wear the lane colours by task position; the lead wears `--color-office-lead`.
- **Walkers:** at most 3 people (the boss not counted) walk at once; the rest wait at their desk in order of
  `idleSince`. They walk the boss's way, through the doors. Who goes where is a pure function of state, `idleSince`,
  the id hash and the minute (`officebehavior.ts`); one shared 60 s timer advances the minute. No per-person timers,
  no randomness.
- **Day and night** from the local clock and the work hours (`officeHoursAtom`, `atomWithStorage("cockpit.office.hours")`,
  9 to 18 by default; Saturday and Sunday count as outside hours). Day: the windows are light. Evening (the 3 h after
  the end) and night: the windows go dark, the floors take the night tint (`--color-office-night`), an idle person's
  desk is empty (gone home, label `gone home`), a person at work gets a desk lamp and its pool of light, a meeting
  room with a running task lights its table, and the sign glows brighter. The 60 s timer re-reads the phase.
- **Energy** from the 5-hour window of the active Claude account, the one the app bar meter draws
  (`ratelimitstore.ts`, `fivehour`):

  | 5-hour use | Office |
  |---|---|
  | under 70 % | as above |
  | 70–90 % | a working person yawns one frame in eight, offset by the id hash |
  | 90 % and over | a coffee cup on every working desk, and a yawn one frame in four |
  | drops from 70 % or more to under 20 % (a reset) | everyone at a desk stretches once |
  | unknown (no reading) | as under 70 % |

  The office's heading shows `⚡ <percent>` beside the clock, `⚡ —` when unknown; at 90 % and over it is amber.

## Drawing

- **A new sprite set** for the plan, `view/office/plansprite.ts`: 12 columns, role codes, never colours. Seated
  (12–14 rows): sit and its nod, raised hand (2 frames), cheer (2), doze, yawn, stretch, and the back. Standing
  (19 rows): with a cup, walking down (2), walking up (2), the boss looking at a desk (its back); walking sideways (2)
  is 14 columns. The Run office keeps its side-view set (`view/jarvis/officesprite.ts`) unchanged.
- **Rasterised once, shared:** the Run office's rasteriser (`officesprites.ts`) moves to `view/office/spritecache.ts`
  and takes any grid set. A pose in an outfit is drawn once to a software canvas (`willReadFrequently`, as the Run
  office fix found: a GPU canvas made `toDataURL` cost 80–95 ms) and kept as a PNG data URL. A person is one `<img>`
  at 3× with `image-rendering: pixelated`; a frame change swaps `src`. The cache is bounded: ≤ 600 entries.
- **The building is DOM with tokens:** one node per floor area, its material a CSS pattern (planks, tiles, carpet,
  the hall's concrete); a wall is its top and its face; a desk's top and face are pseudo-elements (as the Run office
  keeps its node count down), the monitor and the tower one node each. A theme change restyles nothing in the plan:
  the building is scenery, like the people.
- **New tokens** in `@theme`, held at their defaults by every theme, with a why comment: people
  (`--color-office-boss`, `--color-office-shirt-claude`, `-codex`, `-pi`, `-agy`, `-other`), scenery
  (`--color-office-wall-top`, `-wall-face`, `-wood-1`, `-wood-2`, `-tile-1`, `-tile-2`, `-carpet`, `-hall`,
  `-desk-top`, `-desk-face`, `-sofa`, `-brick`, `-mortar`, `-window-day`, `-window-night`, `-plant`, `-pot`), light
  (`--color-office-night`, `-lamp`, `-cup`), and the sign's glow as a shadow token (`--shadow-office-sign`). The sign's
  frame is the accent: it is the brand.
- Bands outside the view are `content-visibility: auto`.

## Motion

- **Frame clock** (450 ms) flips the 2-frame poses. It runs only while some drawn person has an animated pose
  (the nod, a raised hand, cheer, yawn, stretch); only those people subscribe to it.
- **Walk clock** (`requestAnimationFrame`) runs only while the boss or a walker is moving, and moves them by
  `transform: translate(x, y)` in whole cells (3 px). The boss walks at ~160 px/s, ~400 px/s on `j` `k` `n` or a
  click; a walker at ~60 px/s. It stops when everyone has arrived.
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
  over the last 10 s, shown as a share of one core), the people drawn, walking and animated, the sprite cache's
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
| `view/office/plansprite.ts` (+ test) | the plan's pose grids and roles |
| `view/office/spritecache.ts` (moved from `view/jarvis/officesprites.ts`) | rasteriser and data-URL cache for any grid set; entries and bytes for the meter |
| `view/office/officeclock.ts` (+ test) | the frame and walk clocks, their run/stop rules, the meter counters (`officeMeterAtom`) |
| `view/jarvis/office*.ts(x)` | import the cache from `view/office/`; nothing else changes in the Run office |
| `view/agents/officeplanmodel.ts` (+ test) | cards and runs → bands, rooms, desks, seats, doors, labels, office order, poses, popup side |
| `view/agents/officebehavior.ts` (+ test) | idle → coffee and sofa, the 3-walker queue, energy, day and night |
| `view/agents/officeboss.ts` (+ test) | keys and clicks → boss position; walls and doors; paths through doors; desk at the boss |
| `view/agents/officestore.ts` | `cockpitViewAtom`, `officeHoursAtom`, `officeAnimationAtom` |
| `view/agents/cockpitoffice.tsx` | the plan, people, boss and popup |
| `view/agents/cockpitsurface.tsx` | the toggle; Office in place of the grid; card streams for the popup only |
| `view/agents/usecockpitkeyboard.ts` | Office keys, office order for `j` `k` `n` |
| `view/agents/consumers.ts`, `consumerspanel.tsx` | the Office line |
| `store/keybindings/bindings.ts` | `cockpit:office` and the walk keys (documentation bindings, as the Cockpit's are) |
| Settings → Appearance | an Office group: animation, work hours |
| `frontend/tailwindsetup.css` | the tokens above |
| `scripts/cockpit-fixtures/scenarios.mjs` | `office-bench`: 48 agents over 6 projects, every agent state |
| `scripts/cdp/officescenarios.mjs` | `cockpit-office` (visual) and `cockpit-office-bench` (budgets) |
| `docs/guide/cockpit.md`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md` | the Office section, the keys, one `<!-- big -->` line |

## Benchmark

The office ships only inside these budgets, measured by `cockpit-office-bench` on the dev app (headless Chrome on a
Mac, `task dev:browser`).

**Fixture:** the `office-bench` roster (48 agents over 6 projects, every agent state, 2 asking) through the cockpit
fixtures, plus 3 runs of 8 tasks through a DEV-only hook (`__cockpitOfficeRuns`), about 75 people. The runs exist only
in Office, so the comparison overstates the office's cost, never understates it.

**Scenario:** Cockpit in Cards, GC, read `Performance.getMetrics`; hold 30 s (the baseline); switch to Office, wait
2 s, GC, read; hold 30 s with 3 walkers and the boss walking; hold 30 s quiet (every agent idle under 3 min, no
walker); switch back to Cards, GC, read. Then repeat the walking hold under `prefers-reduced-motion: reduce`.

| Measure | Budget |
|---|---|
| JS heap, Office minus Cards (after GC) | ≤ 5 MB |
| DOM nodes added | ≤ 2,000 |
| Main thread busy over the 30 s hold, minus the Cards baseline | ≤ 2 % |
| Same, reduced motion | ≤ 0.5 % |
| Same, quiet office | ≤ 0.3 % |
| Sprite cache entries | ≤ 600 |
| Heap after switching back to Cards (after GC), minus the Cards read before | ≤ 1 MB |
| Toggle click to the office drawn | ≤ 150 ms |

Estimated from the Run office's measured numbers (104 desks: +1.6 MB, ~1,500 nodes): about 900–1,200 nodes and
+1–2 MB at this fixture. The scenario prints the numbers in its PASS/FAIL row and fails over budget. They go into
`docs/open-issues.md` under **RAM watch**, dated. A miss is reported, not tuned away by raising the budget. React's dev
build adds work per render (the Run office's busy miss), so the busy figures are read again by hand on a production
build with the Office line in the RAM panel, and that reading goes into RAM watch too.

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
  seats alternating sides, `+N` past 11 tasks; band height and the stretched room; Home's booth; doors; places stay
  put across state changes; each agent state and each task state maps to its pose and label; filters narrow the plan
  as the grid; office order), `officebehavior.test.ts` (idle thresholds, the 3-walker queue order, every energy band
  and the reset, day, evening, night and the weekend), `officeboss.test.ts` (walls stop, doors pass, `j` `k` `n`
  targets and their paths through doors, the desk at the boss, the cursor kept in the hall), `officeclock.test.ts`
  (each clock runs only when it should and stops when hidden, reduced or off), `plansprite.test.ts` (every grid is its
  declared size and uses only known codes; a pose's frames are the same size).
- CDP `cockpit-office`: the `Main` board (day, the boss at quill with its card open, `1` answering from it), a click on
  a meeting room opening its `LeadCard`, the boss walking by arrow keys through a door, `n` crossing to the next
  Needs you, the `Night` and `Tired` boards, every pose of the `States` board on its own small fixture, animation off,
  and the Office line in the RAM panel (`RamPanel`). `cockpit-office-bench` holds the budgets.

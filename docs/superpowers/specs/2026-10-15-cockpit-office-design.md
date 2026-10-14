# Cockpit office — design

**Date:** 2026-10-15
**Status:** design agreed in chat, not built. Part 1 of 4.
**Canvas:** `.superpowers/design/cockpit-office/project/` (gitignored; `Main`, `States`, `Night`, `Tired`,
`RamPanel`). The people reuse the Run office sprites (`2026-10-14-run-office-design.md`).

## What it is

A second way to look at the Cockpit: **Cards | Office**. Office draws the same agents and runs the card grid holds as
a side-view pixel office: each project is a floor, each agent a person at a desk, each run a team with its lead in a
glass office. You are the boss, a person you walk around the floors; the desk you stand at is the selected card, and
its card opens beside the desk, so every Cockpit action (answer, reply, open terminal, background, review) works from
the office with the code it uses today.

It is for fun, and it is a working view: the person asked for an office that feels like a game while it stays the
Cockpit. RAM and CPU come first: the office ships only inside the budgets under **Benchmark**, and it shows its own
cost in the RAM panel.

## The parts

The office is built in four parts, each with its own spec, plan and run. A part starts only after the one before has
landed and the person has used it and still wants the next.

1. **This spec:** the office view, the boss, personalities, day and night, energy from the 5-hour quota, and the
   office's line in the RAM panel.
2. **Coins, shop, work-life** (own spec): coins for a task done, a run landed (more with no review-failed), a Needs
   you answered within minutes; never taken away on a failure. Coins buy decor (plants, coffee machine, sofa, rugs)
   and more room. The boss's own work-life: a day with no prompt after the end of work hours earns a bonus and grows
   the office plant (off by default). Coins are counted in wavesrv, once per task, run or ask id, so they accrue
   while the Cockpit shows Cards.
3. **The pet as photographer** (own spec): whichever pet is picked (Sprout, Minion, Spider-Man) takes photos in its
   own way (Spider-Man swings in on a web and flashes; Minion shoots crooked; Sprout holds the camera on its leaf):
   a run's Final shots, a keepsake when a task is done or a run lands (stored as scene data, redrawn when viewed, no
   PNG), and each new canvas. Photos hang on a wall; a click opens the Final shots viewer, the keepsake, or Agent →
   Canvases. Changing the pet or the theme loses nothing.
4. **System staff** (own spec): arcterm's background systems as office staff, each shown only while it has work.
   The cleaner is AutoClean (`pkg/storage/autoclean.go`): she pushes her cart across the floors when it has cleaned
   something, with a line saying what (`3 worktrees, 120 MB`). The guard at the door is the Token burn guard
   (`pkg/tokengate`): while a costly spawn waits, he stands before the elevator with the would-be subagents in a
   queue, and the boss walking up opens that Token burn card. The queue at the machine room is the job queue
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

## Floors and desks

- **A floor per project** that has a card, ordered by project name; cards with no project share a floor called
  `Home`, last. Floor order and desk order are **stable**: a desk belongs to an agent while its card exists, and a
  state change never moves anyone to another desk.
- **Desks** (88 px, with a 24 px aisle after each, where the boss stands) in order of agent name, then id. A floor's left end is the coffee corner (machine and sofa); its
  right end is the elevator. A floor wider than the office scrolls horizontally inside itself and follows the boss.
- **A run** with a card is a team at the end of its project's floor, after a glass partition: the lead's glass office
  and one desk per dag task, built by the existing `officeFloor` (`view/jarvis/officemodel.ts`) with its poses,
  screens and lane shirts unchanged.
- **Label** under every desk: `<name> · <state word>` (`loom · working`, `loom · Needs you`, `loom · idle 12m`);
  a run's desks keep the Run office labels. Status is never pose or colour alone.
- The elevator panel lists the floors, with `!` beside a floor that holds a Needs you desk.

## Poses (agents)

Pure mapping in `officefloormodel.ts`. A run's desks use the Run office tables as they are.

| Agent | Pose | Screen | Bubble |
|---|---|---|---|
| `working` | typing (2 frames) | green lines | — |
| `asking` | raised hand (2 frames) | `?` | `!` amber |
| `idle`, in the Cockpit's Finished window | cheers once (2 frames, ~1.5 s), then leaning back | `✓` | — |
| `idle`, later | leaning back | `✓` | — |
| `idle` ≥ 3 min | walks to the coffee machine, stands with a cup | off | — |
| `idle` ≥ 10 min | walks to the sofa, sits | off | — |

A person away from the desk walks back when the agent is working or asking again. The label stays under the desk.

## The boss

- A standing person in the boss outfit (`--color-office-boss`), facing the way it walks (a CSS mirror, no extra
  sprites). It starts at the desk of the Cockpit's cursor card, else the first Needs you desk, else the first desk.
- **Keys in Office** (only while the Cockpit owns the keyboard, as `usecockpitkeyboard.ts` decides today):
  - `←` `→` walk; held, the boss keeps walking.
  - `↑` `↓` go to the floor above or below: the boss walks to the elevator, rides, and walks out to the desk nearest
    the same spot.
  - `j` `k` go to the next or previous desk in office order (floor by floor, left to right, run desks included);
    `n` goes to the next Needs you desk. The boss walks there fast.
  - `h` `l` switch question on a multi-question ask in the popup, as `h` `l` do on a card; the arrows walk.
  - Every other Cockpit key acts on the desk at the boss: `1`–`9`, `Enter`, `Space`, `r`, `t`, `b`.
- **The desk at the boss** is the nearest desk on the boss's floor. It is the Cockpit's cursor card, so the
  keyboard's card order in Office is the office order.
- **Mouse:** a click on a desk walks the boss there and opens its card; a click on the floor walks the boss there.
- **Reduced motion or animation off:** the boss moves at once to where it would have walked.

## The popup

- While the boss stands still at a desk, the desk's card shows beside it: the **same `AgentRow`** the grid draws,
  with the props `CockpitSurface` already passes the cursor card (selections, typed answers, composer), or for a run
  desk the run's **`LeadCard`** with that task's row as its cursor. No card is rewritten for the office.
- It hides while the boss walks and when `Esc` is pressed, until the boss moves again. It sits under the desk, over
  the floor below, with a pointer to the desk, and flips above it only when the office has no room below.
- **Open terminal** leaves for the Agent surface through `openTarget`, as the card does today.
- **Card streams:** in Office, `useCardStreams` is given only the popup's card, not one per agent.

## Personality, day and night, energy

- **Looks:** skin and hair (1..4) by a hash of the agent id; shirt by harness (claude, codex, pi, agy, other), as new
  identity tokens. Run desks keep their lane shirts.
- **Walkers:** at most 3 people (the boss not counted) walk at once; the rest wait at their desk in order of
  `idleSince`. Who walks where is a pure function of state, `idleSince`, the id hash and the minute (`officebehavior.ts`);
  one shared 60 s timer advances the minute. No per-person timers, no randomness.
- **Day and night** from the local clock and the work hours (`officeHoursAtom`, `atomWithStorage("cockpit.office.hours")`,
  9 to 18 by default; Saturday and Sunday count as outside hours). Day: lit windows. Evening (the 3 h after the end)
  and night: the office takes the night tint (`--color-office-night`), the windows go dark, an idle person's desk
  is empty (gone home) and a working person gets a desk lamp. The 60 s timer re-reads the phase.
- **Energy** from the 5-hour window of the active Claude account, the one the app bar meter draws
  (`ratelimitstore.ts`, `fivehour`):

  | 5-hour use | Office |
  |---|---|
  | under 70 % | as above |
  | 70–90 % | a working person yawns one frame in eight, offset by the id hash |
  | 90 % and over | a coffee cup on every working desk, and a yawn one frame in four |
  | drops from 70 % or more to under 20 % (a reset) | everyone stretches once |
  | unknown (no reading) | as under 70 % |

  The heading shows `⚡ <percent>` beside the clock, `⚡ —` when unknown.

## Drawing

- **One sprite module for both offices.** `officesprite.ts` and `officesprites.ts` move from `view/jarvis/` to
  `view/office/`; the Run office imports them from there. New pose grids: walk (2 frames), cup, sofa, cheer (2 frames),
  yawn, stretch, and the boss. Grids stay 14 columns, 18 rows sitting and 22 standing, with role codes, never colours.
- **Rasterised once:** a pose in an outfit is drawn once to a software canvas (`willReadFrequently`, as the Run office
  fix found: a GPU canvas made `toDataURL` cost 80–95 ms) and kept as a PNG data URL. A person is one `<img>` at 3×
  with `image-rendering: pixelated`; a frame change swaps `src`. The cache is bounded: ≤ 600 entries.
- **Furniture** (desks, monitors, walls, floors, elevator, coffee machine, sofa, lamp, windows) is DOM with theme
  tokens, so a theme change restyles it with no redraw. New identity tokens in `@theme` (with a why comment, held at
  their defaults by every theme): `--color-office-boss`, `--color-office-shirt-claude`, `-codex`, `-pi`, `-agy`,
  `-other`, `--color-office-night`, `--color-office-lamp`, `--color-office-cup`.
- Floors outside the view are `content-visibility: auto`.

## Motion

- **Frame clock** (450 ms) flips the 2-frame poses. It runs only while some drawn person has an animated pose
  (typing, raised hand, cheer, yawn, stretch); only those people subscribe to it.
- **Walk clock** (`requestAnimationFrame`) runs only while the boss or a walker is moving, and moves them by
  `transform: translateX` in whole cells (3 px). The boss walks at ~160 px/s, ~400 px/s on `j` `k` `n`, a click or a
  floor change; a walker at ~60 px/s. It stops when everyone has arrived.
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
| `view/office/officesprite.ts` (+ test, moved) | pose grids including the new ones, roles, grid → pixels |
| `view/office/officesprites.ts` (moved) | rasteriser and the data-URL cache, entries and bytes for the meter |
| `view/office/officeclock.ts` (+ test) | the frame and walk clocks, their run/stop rules, the meter counters (`officeMeterAtom`) |
| `view/jarvis/office*.ts(x)` | imports from `view/office/`; nothing else changes in the Run office |
| `view/agents/officefloormodel.ts` (+ test) | cards → floors, desks, labels, office order, popup target; agent poses |
| `view/agents/officebehavior.ts` (+ test) | idle → coffee and sofa, the 3-walker queue, energy, day and night |
| `view/agents/officeboss.ts` (+ test) | keys and clicks → boss position and target, elevator, desk at the boss |
| `view/agents/officestore.ts` | `cockpitViewAtom`, `officeHoursAtom`, `officeAnimationAtom` |
| `view/agents/cockpitoffice.tsx` | the floors, desks, people, boss and popup |
| `view/agents/cockpitsurface.tsx` | the toggle; Office in place of the grid; card streams for the popup only |
| `view/agents/usecockpitkeyboard.ts` | Office keys, office order for `j` `k` `n` |
| `view/agents/consumers.ts`, `consumerspanel.tsx` | the Office line |
| `store/keybindings/bindings.ts` | `cockpit:office` and the walk keys (documentation bindings, as the Cockpit's are) |
| Settings → Appearance | an Office group: animation, work hours |
| `frontend/tailwindsetup.css` | the identity tokens above |
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

The scenario prints the numbers in its PASS/FAIL row and fails over budget. They go into `docs/open-issues.md` under
**RAM watch**, dated. A miss is reported, not tuned away by raising the budget. React's dev build adds work per render
(the Run office's busy miss), so the busy figures are read again by hand on a production build with the Office line
in the RAM panel, and that reading goes into RAM watch too.

## Out of scope

- Everything in parts 2 to 4: coins, shop, decor, work-life bonus, the photographer, the photo wall, the system
  staff.
- The pet in the office: it keeps walking the footer.
- A top-down office, free walking in two dimensions, people talking to each other, meeting rooms, sound.
- An office anywhere but the Cockpit; the Run office in Jarvis stays as it is.

## Verify

- vitest: `officefloormodel.test.ts` (each agent state maps to its pose, label and screen; floors and desks keep
  their order across state changes; filters narrow the office as the grid; office order runs floor by floor),
  `officebehavior.test.ts` (idle thresholds, the 3-walker queue order, every energy band and the reset, day, evening,
  night and the weekend), `officeboss.test.ts` (walking, the elevator, `j` `k` `n` targets, the desk at the boss),
  `officeclock.test.ts` (each clock runs only when it should and stops when hidden, reduced or off),
  `officesprite.test.ts` (every grid is its declared size and uses only known codes).
- CDP `cockpit-office`: every agent pose, a run team, the boss walking to a desk with its popup open, `1` answering
  an ask from the popup, night with a lamp, energy at 95 % with cups, animation off, and the Office line in the RAM
  panel. `cockpit-office-bench` holds the budgets.

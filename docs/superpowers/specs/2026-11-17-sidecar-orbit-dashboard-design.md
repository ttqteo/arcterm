# Sidecar as an orbit dashboard

Date: 2026-11-17. Replaces the wall of tiles (section 3 of `2026-11-13-sidecar-design.md`, board D) and the small
form's list (section 1a, board F) with two layouts of one dashboard: **P**, the full window, and **Q**, the compact
one. The window, the bridge, the snapshot event, the strain model and the keys stay as that spec built them.

**Prototype:** `D:\projects\arcterm\.superpowers\design\cockpit-window\project\` (boards `P-live`, `Q-compact-live`,
and the five states `P-calm`, `P-orbit-dashboard`, `P-high`, `P-critical`, `P-failed`). Boards D, E and F, the shipped
design this replaces, moved to `cockpit-window/replaced/`. The taskbar icon's board is
`D:\projects\arcterm\.superpowers\design\sidecar-icon\project\F-badge-screen.dc.html`.

## Why

Council `0a40209110ce9b44` and the person agreed the wall reads like a second Cockpit and is hard to catch up from.
Six equal tiles each tell a running story, so knowing what to do next means reading all of them, and a finished agent
whose last line asks you something (`Bạn chọn (a) hay (b)?`) looks the same as one that is simply done. The person
asked for a mini dashboard, with a cinematic look, that reacts as things change.

## What the person sees

### P, the full window (wall layout today: `layoutFor` returns `"wall"`)

- **Orbit, top left.** A core holds the count of what waits on you (92 px, `warning`; `muted` at 0, `error` when a run
  failed) inside three rings, outside in: the 5-hour window, the week, RAM used. A key for the rings sits top left,
  the working / for review / idle counts bottom left. Each agent is a node on the orbit with its name and one line of
  state (`asks: merge into main? · 3m`, `working · 11m`, `finished · +4005 −755`, `run · 7 of 9 · 1h 34m`), joined to
  the core by a spoke. A node that waits on you or failed pings; its spoke is dashed in its colour.
- **Needs you, top right.** One row per thing that waits on you, oldest first: who, how long, the question in its own
  words (two lines at most), and how to answer it (`1 Merge · 2 Keep the branch`, or `Enter: reply in the main
  window`). A failed run's row leads with **Failed**.
- **Run, under it.** The active run's name, its task strip (done segments `success/45`, the current one full), and
  `7 of 9 tasks · due today: …`.
- **Last 2 hours, bottom.** One lane per agent in the orbit's order: working (green bar), waiting on you (amber bar),
  failed (red bar), finished (thin grey line). Hover gives `working 13:55–14:36`.
- **Strain band.** When the machine strains (`sidecarstrainmodel.ts`, unchanged), the band sits on top of the right
  column with the heavy jobs and their **Stop the build** / **Sleep agent**; the run box steps aside while it shows.
  The RAM ring takes the band's colour, the core adds `⚠ RAM high` / `⚠ RAM critical`, and a heavy agent's node gets a
  ring in that colour and a line `4.2 GB · npm run build`.
- **Alert frame.** RAM critical or a failed run frames the whole window: a 4 px `error` edge and a faint red glow from
  the edges. RAM high: a 3 px `warning` edge. Calm and normal: none.

### Q, the compact window (small layout today)

The same story at 380 px wide, pinned beside your work: the core shrunk to 112 px with the figures beside it, the
strain as one line with the heaviest job's Stop and Sleep, the Needs you rows, and at the bottom one dot per agent in
the orbit's order (its colour, its name and state on hover) beside `Run 7 of 9 · 1h 34m`. No timeline. With nothing
waiting: `All clear` and `Nothing waits on you.` The frame follows the same rule at 2 px.

### States

`calm` (nothing waits; nothing moves), `normal`, `RAM high`, `RAM critical`, `a run failed`. Both layouts draw all
five; `P-live` and `Q-compact-live` play them in turn.

## What waits on you

The core's number and the Needs you rows are one list, built in the bridge:

1. **Asks** the snapshot already carries (tiles in state `asking`), answerable with 1–9 as today, keyed by the ask
   (commit `38d789b52`).
2. **A finished agent whose last message ends in a question.** State `review` (or idle within the 5-minute grace),
   the last assistant message's last sentence ends in `?` or `？`, and the person has not sent it anything since. It is
   answered in the main window (Enter). This is a heuristic: it is pure and tested in `sidecarneeds.ts`, and it never
   adds a 1–9 answer.
3. **What waits on you in Jarvis**: `attentionAtom` (`view/agents/attentionstore.ts:18`, computed by
   `pkg/jarvis/attention.go` and polled) minus the asks (`splitAttention`'s `jarvis` half: gates, blocked tasks, runs
   to confirm or land, escalations, due chunks). Each row says its kind and opens through `openTarget` on Enter. A run
   held at Final or with a failed task is a row with **Failed**: kind `run-unverified`, or `dag-blocked` with `retry`
   (what `kindWord` already words "failed").

The bridge does not read `attentionAtom` today; it subscribes to it like the other stores it watches.

## The timeline's data

Nothing keeps a plain agent's past states. The Cockpit's Events rail observes transitions only while the Cockpit
surface is mounted and loses them on reload (`view/agents/cockpitevents.ts:1-6`, `useRailTracking` in
`cockpitsurface.tsx:297`); an agent carries only `stateSince` (`agentsviewmodel.ts:145`). Runs have persisted engine
events (`runRailEvents`, `cockpitevents.ts:109`).

So the bridge, which is always mounted in the shell, keeps the history itself: a pure `sidecarhistory`-style model,
`sidecartimeline.ts`, records each agent's state changes (`working`, `asking`, `review`/idle, `failed`) with their
time, drops anything older than 2 hours and keeps at most 64 per agent; an agent gone from the roster is dropped. On
the first sighting it records one span from `stateSince` (or now), so the timeline starts short after a launch and
fills. A run's lane reads its engine events instead. The snapshot carries each tile's spans inside the window; the
page draws them.

## The orbit's capacity

The orbit holds 8 nodes. Past that it shows, in the snapshot's order, every agent that waits on you or failed, then
working, then finished within the grace, up to 8; the rest count in `+N` on the core's bottom line and in idle. The
timeline shows the same agents as the orbit.

## Motion

From `element/motiontokens.ts`, each tied to a change of state:

- A node or a Needs you row that waits on you or failed pings (a 1.8 s ring, infinite while it waits). This is the only
  thing that moves on a calm or normal screen with nothing waiting.
- A row entering Needs you: `springReveal`. A row leaving: none.
- The alert frame, the RAM ring's colour and length, and the core's colour: a 500 ms ease.
- Reduced motion: no ping, no reveal; the colours change at once.

**DESIGN.md exception.** The ping repeats while something waits, where DESIGN.md allows motion only for a change. Add
a Sidecar line to DESIGN.md: Sidecar is read from across the room, so a waiting item pings until it is answered; no
other repeating motion. No radar sweep (board N's sweep was dropped: it kept the GPU busy on an unchanged screen).

## Colours

Tokens only: `warning` (waits on you), `success` (working), `error` (failed, RAM critical), `secondary` (finished),
`muted` (idle, figures), `askingbg` (a waiting row), `surface-raised` / `surface-hover` (rows, the selected row),
`diff-added` / `diff-removed` (`+N −N`). A failed row's tint needs a token: add `--color-errorbg` beside `askingbg`
(`rgba(224,114,108,0.14)`), mirrored in `themes.ts`. Selection is a grey **inset** ring (`ring-inset`), never the
accent: an outer ring is clipped by the list's overflow (seen on board Q). Review is never the accent either (today's
wall draws its dot `bg-accent`).

## Keys

Unchanged: arrows move through the Needs you rows (and the orbit's nodes on P with left/right), Enter opens, 1–9
answers an answerable ask, F11 full screen.

## RAM

Smaller than the wall: no message rows per tile and no scrollback (the wall's `older` act and `sidecarhistory.ts`
paging go). Adds the timeline (≤ 64 spans × agents, a few KB) and one SVG. The ping and the frame are composited
`transform`/`opacity`/`box-shadow`. Budget stays the 100 MB of the 2026-11-13 spec; measure P with 12 agents after a
day on screen and log it in `docs/open-issues.md` RAM watch.

## What goes

The wall (`sidecarwall.tsx`, `sidecarwallmodel.ts` tiling and scrollback), the small form's list
(`sidecarsmall.tsx`), the `older` act and `SIDECAR_OLDER_EVENT`, and `sidecarhistory.ts`. Grep every import before
deleting. The title bar keeps its buttons; its counts move into the core.

## Taskbar (Windows)

Sidecar is its own taskbar button, not a second window under arcterm's. The host gives the Sidecar window its own
AppUserModelID (`<identifier>.sidecar`: `dev.arc.app.sidecar` packaged, `dev.arc.app-dev.sidecar` in dev), the way
`set_window_app_user_model_id` in `main.rs` gives the main window the identifier, and sets
`PKEY_AppUserModel_PreventPinning`: a pin of it would relaunch arcterm, not Sidecar. Its icon is arcterm's mark with a
small screen badge (board `F-badge-screen`): the mark unchanged, a rounded `accent-500` square of 44% of the icon's
width flush with the bottom-right corner, cut out of the tile by a transparent gap of `max(1, round(size/24))` px, a
white pixel screen inside it (a 5×5 grid: a frame of four rows and a one-cell stand). `scripts/gen-app-icon.mjs` draws
it pixel-exact at the same sizes as `icon.ico` into `src-tauri/icons/icon-sidecar.ico`; the host loads the frame each
size needs from the bytes embedded in the exe, and Sidecar's window takes it in place of the exe's own icon. macOS has
one Dock icon per app: nothing changes there.

## Verification

A CDP scenario per state for each layout (the five states × P and Q), injected through the Sidecar fixture path the
existing `scenarios-sidecar.mjs` uses, each asserting the core's number, the Needs you rows, the frame and, on P, the
lanes. Unit tests: `sidecarneeds.ts` (the three sources, the question heuristic, oldest first), `sidecartimeline.ts`
(record, cap, 2-hour drop, first sighting), the orbit's capacity rule.

## Open

- The question heuristic will misfire on a rhetorical question at the end of a report. Measure on a week of real
  transcripts before trusting it; a miss only puts a row in Needs you, and answering or opening it clears it.
- Whether a Jarvis row's Enter should also act in place (a gate's Approve). The first build opens it in the main window
  through `openTarget`, nothing more.
- Which icon Windows draws for a window whose AppUserModelID has no shortcut: the window's own (`WM_SETICON`) or the
  exe's. Only a packaged build shows it (the dev app shares the exe's icon either way); a hand check.

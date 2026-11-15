# Sidecar, part 1 of 2: the window, reopen, the slim page and the wall

**Effort:** effort:3aa2811d-7c3b-4014-89cf-e431a43bd3dc
**Spec:** `docs/superpowers/specs/2026-11-13-sidecar-design.md` (sections 1, 1a's window side, 2 and 3 minus scrollback)
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs sidecar-wall`
**Prototype:** D:/work/arcterm/.superpowers/design/cockpit-window/part-1/D-fit-by-count.dc.html

Part 1 builds initiative chunks 1-4. **Part 2 (a later run) builds** lazy scrollback and the transcript-tail read for
agents the main window does not stream, the strain band (board `E-strain-band.dc.html`), CPU per agent and the macOS
sampler, the small form and the S button's behaviour (board `F-small-asks.dc.html`), and the release-build RAM
measurement. The Prototype folder `part-1/` holds board D only (a copy of `project/D-fit-by-count.dc.html`); boards E
and F stay in `project/` for part 2. Board D's "scroll for earlier" hint is part 2's scrollback: this run does not
draw it.

## Decisions made beyond the spec and the board (with why)

1. **Snapshot only while a page is live, and only when it changed.** The bridge emits `sidecar:snapshot` (`emitTo`
   the `sidecar` window) only after a `hello` act and until the host's `sidecar:closed` event, throttled to at most one
   emit per 500 ms (trailing, so the last change goes out), and skips a snapshot equal to the last one sent ignoring
   `now`. It reads `now` with `globalStore.get` at build time, never subscribing to the 1 s `nowAtom` tick, which would
   re-emit forever. The page re-sends `hello` every 2 s until its first snapshot arrives. Why: no work while Sidecar is
   shut or idle, and either launch order works.
2. **A message row is what the agent said plus the tool it ran.** From the agent's entries (`entriesToShow(live,
   previousInfo)`, `agentrowmodel.ts`, so a fixture's `previousInfo` and a streamed agent's `liveEntriesByIdAtom` both
   feed it): each `message` entry starts a row and takes the last `action` before the next message as its tool;
   actions before the first message form one tool-only row (the latest of them). Other entry kinds are skipped. At most
   8 rows per agent, newest last, each text cut to 240 chars. Why: the board pairs a sentence with one tool line; 8
   covers the tallest tile and bounds the event payload.
3. **Rows never vanish when a stream stops (spec 3, part 1's share).** The bridge keeps the last non-empty rows each
   tile had (`keptMessages`, rows only, pruned to agents still on the roster) and the snapshot falls back to them when
   an agent's entries are empty (`dropLiveId` cleared them). An agent not streamed since launch and with no
   `previousInfo` shows "No recent messages" until part 2's tail read. Spec 3 is amended to say so.
4. **Wall shape rule.** For `n` tiles in a `W×H` wall area, try every column count `c` (rows `r = ceil(n/c)`), tile
   `w = W/c`, `h = H/r`, keep the `c` with the largest `min(w, 1.5·h)`. Messages per tile follow the tile height (what
   is left after the header and the ask or context strip, over the row height), clamped to 1..8. Smallest readable
   tile: 300×170 px; past it, tiles stay that size and the wall scrolls. At 1920×1080: 4 → 2×2 (~6 rows), 12 → 4×3
   (2), 20 → 5×4 (1). Why: one pure rule gives the board's three cases and degrades for any window size.
5. **Order and counts.** Tiles: asking (longest blocked first), working (longest running first), review (idle with
   `edited` or `committed`), idle, asleep (`sleeping` set). Plain terminals and tools (`kind: "terminal"`) are left out;
   background agents stay. Title-bar counts: need you = asking, working, idle = review + idle + asleep.
6. **Answerable from a tile:** one question, not multi-select, 1 to 9 options. Any other ask shows its first question
   and "Enter answers it in the main window". `1`-`9` sends option index 0-8.
7. **Open goes through the router:** `openTarget(model, { kind: "agent", tabId })` (`openref.ts`), then the main window
   is raised with the tray's `showMain`, exported from `traybridge.tsx`, not copied.
8. **Answer reuses `answerAgentAsk`** (`askanswer.ts`) with `{ 0: new Set([option]) }`; a `false` return (nothing sent)
   is logged with the reason the act was refused, never dropped silently. The tile then shows Sent from the snapshot's
   `sent` flag (`askSentKey` in `sentIdsAtom`).
9. **Reopen state** lives in the app config dir as `sidecar-frame.json` (`sidecar-frame-dev.json` in a dev build, as
   `winframe.rs` does): `{ open, frame, fullscreen }`, reusing `winframe.rs`'s `Frame`, `next_frame` and `on_screen`.
   `open` turns false only on the person's own close (the Sidecar window's `CloseRequested`); the main window's destroy
   closing it, and quitting, leave it true. A reopen in the same session uses the frame kept in memory. Part 2 adds the
   small form's and pin's fields with serde defaults.
10. **First open:** with another screen, the largest screen not holding the main window's centre (position in physical
    px after the build, then maximize); with one screen, 1280×800 logical clamped to 90% of the screen, centred. A
    remembered screen that is gone: maximized on the main window's screen.
11. **Names:** window label `sidecar`, title `arcterm Sidecar` (`arcterm Sidecar (dev)` in a dev build), palette row
    `Open Sidecar` (binding id `open-sidecar`, no chord, group Global), host command `open_sidecar`, host event
    `sidecar:closed`.
12. **Capability adds `core:window:allow-inner-size`** (spec 1 amended): the scenario reads the window's real size, and
    part 2's S button reads the size it returns to.
13. **Test seams, dev build only:** the bridge appends every act it receives to `window.__sidecarActs` on the main
    page, and ignores `hello` while `window.__sidecarHold` is true (so the scenario can show the waiting state).
    `scripts/cdp/attach.mjs` picks the main page over a `sidecar.html` or `tray.html` target. The scenario pins
    Sidecar's page to 1920×1080 (`Emulation.setDeviceMetricsOverride`) so the shape asserts hold on any screen.
14. **Nothing on Sidecar animates:** no transition, pulse, spinner or reveal; ages redraw every 30 s from the
    snapshot's `now` plus the time since it arrived.
15. **The S button's slot:** an empty element (`data-sidecar-slot="small"`, no width) in the title bar's button group;
    part 2 puts the button there. No dead button is shown.

## Interfaces the tasks share (landed by Task 3)

`frontend/app/cockpit/sidecartypes.ts`, plain data only (it crosses a Tauri event):

```ts
export const SIDECAR_SNAPSHOT_EVENT = "sidecar:snapshot"; // main → sidecar window
export const SIDECAR_ACT_EVENT = "sidecar:act";           // sidecar page → main
export const SIDECAR_CLOSED_EVENT = "sidecar:closed";     // host → main, when the Sidecar window is destroyed
export type SidecarTileState = "asking" | "working" | "review" | "idle" | "asleep";
export interface SidecarMessage { say?: string; tool?: { verb: string; target: string; outcome?: "ok" | "fail" | "blocked" } }
export interface SidecarAsk { question: string; options: string[]; answerable: boolean }
export interface SidecarTile {
    id: string; name: string; project?: string; runtime: string; // "Claude · opus", "Pi", "Codex"
    state: SidecarTileState; since?: number; // UnixMilli the state began, for the age
    ctxPct?: number; messages: SidecarMessage[]; ask?: SidecarAsk; sent?: boolean;
}
export interface SidecarSnapshot { now: number; counts: { asking: number; working: number; idle: number }; tiles: SidecarTile[] }
export type SidecarAct = { kind: "hello" } | { kind: "open"; id: string } | { kind: "answer"; id: string; option: number };
```

`frontend/app/cockpit/sidecarsnapshot.ts` signatures (Task 3 stubs, Task 4 implements):

```ts
export function messageRows(entries: AgentEntry[], max: number): SidecarMessage[];
export function sidecarSnapshot(agents: AgentVM[], entriesById: Record<string, AgentEntry[]>, sentIds: ReadonlySet<string>,
    kept: Record<string, SidecarMessage[]>, now: number): SidecarSnapshot;
export function keptMessages(snap: SidecarSnapshot): Record<string, SidecarMessage[]>; // tiles with rows, by id
```

`frontend/app/cockpit/sidecarwall.tsx` (Task 3 stub, Task 7 implements):
`export function SidecarWall(props: { snap: SidecarSnapshot; receivedAt: number; clock: number; send: (act: SidecarAct) => void })`.

DOM hooks the page and wall render and the scenario reads: `[data-sidecar-waiting]` before the first snapshot;
`[data-sidecar-wall]` with `data-cols`, `data-rows`, `data-msgs`, `data-scroll="true|false"`; `[data-sidecar-empty]`
with no agents; `[data-sidecar-tile="<id>"]` with `data-state` and `data-selected="true"` on the selected one;
`[data-sidecar-msg]` per message row; `[data-sidecar-nomsgs]` on a tile with none; `[data-sidecar-option="<1-9>"]` per
answer button; `[data-sidecar-sent]` on a sent ask; `[data-sidecar-elsewhere]` on an ask answered in the main window;
title bar `[data-sidecar-titlebar]` with `[data-sidecar-count="asking|working|idle"]` and
`[data-sidecar-btn="minimize|maximize|fullscreen|close"]`; `[data-sidecar-footer]`.

### Task 1: The Sidecar window from the Tauri host, and its Ctrl+P row
**Depends on:** none
**Model:** sonnet
**Chunk:** Sidecar window: host window and capability, opens maximized on the other screen, min 340x440, F11 full screen, closes with the main window
**Files:** `src-tauri/src/sidecar.rs`, `src-tauri/src/main.rs`, `src-tauri/capabilities/sidecar.json`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `docs/keyboard-shortcuts.md`, `docs/reference/architecture.md`, `AGENTS.md`, `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md`

Spec section 1 and 1a's window side; decisions 10, 11, 12.

- `src-tauri/src/sidecar.rs`: the `open_sidecar` Tauri command (register it in `main.rs`'s `generate_handler!`): builds
  the window if absent, else unminimizes, shows and focuses it. `WebviewWindowBuilder::new(app, "sidecar",
  WebviewUrl::App("sidecar.html".into()))`, `decorations(false)`, resizable, `min_inner_size(340.0, 440.0)`, title per
  decision 11, built hidden, placed (decision 10), then shown. The screen choice is a pure function over (main window
  centre, screens as (x, y, w, h)) with Rust unit tests (another screen chosen, the largest of several, none → centred
  size clamped).
- Closes with the main window: in `main.rs`'s `on_window_event`, the main window's `Destroyed` destroys the Sidecar
  window (`destroy()`, not `close()`, so it does not read as the person's close). A main window hidden to the tray
  leaves Sidecar open. On the Sidecar window's `Destroyed`, emit `sidecar:closed` to the main window.
- `src-tauri/capabilities/sidecar.json`, windows `["sidecar"]`: `core:event:default`, and `core:window:`
  `allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close`, `allow-set-fullscreen`,
  `allow-is-fullscreen`, `allow-inner-size`, `allow-set-size`, `allow-set-position`, `allow-set-always-on-top`. Nothing
  else.
- The palette row: a Global binding in `bindings.ts` (id `open-sidecar`, `keys: ""`, label `Open Sidecar`, when no
  modal is open) whose run invokes `open_sidecar`, a failure shown as a toast, never swallowed. A test in
  `bindings.test.ts` that the binding exists, has no chord and is listed in the palette. Mirror it in
  `docs/keyboard-shortcuts.md` as a "_(no chord)_" row.
- Docs: add `open_sidecar` (`sidecar.rs`) to the command list in `docs/reference/architecture.md` and update the count
  there and in `AGENTS.md` ("Seventeen" → "Eighteen"), with one sentence on the Sidecar window. `CHANGELOG.md`: one
  Added line under the top Unreleased section, for the user, ending `<!-- try: open-sidecar -->`.
  `docs/hand-checks.md`: `- [ ]` lines for first open maximized on the other screen with two screens, and Sidecar
  closing when the main window is destroyed (tray icon off). `docs/open-issues.md` "(arcterm) RAM watch": the main
  Cockpit's renderer growth measured in the spec ("What was measured": 430 → 720 MB in ~15 min on screen, back to 425
  MB hidden; suspects the 12 fps PulseDriver and animations), as a separate open defect.
- Acceptance: `cargo test --manifest-path src-tauri/Cargo.toml sidecar` passes; `cargo build --manifest-path
  src-tauri/Cargo.toml` succeeds; `npx vitest run frontend/app/store/keybindings frontend/app/cockpit/whatsnew.test.ts
  frontend/app/cockpit/palette-commands.test.ts` passes. Scenario `sidecar-wall` (Task 8) steps 1 (Ctrl+P → Open
  Sidecar), 2 (no smaller than 340×440) and 13 (F11) show it.

### Task 2: Sidecar reopens as last time
**Depends on:** Task 1
**Model:** sonnet
**Chunk:** Reopen as last time: same screen, position, size and full screen on the next launch
**Files:** `src-tauri/src/sidecar.rs`, `src-tauri/src/winframe.rs`, `src-tauri/src/main.rs`, `docs/reference/architecture.md`, `docs/hand-checks.md`

Spec section 1 "Reopens as last time"; decisions 9, 10.

- Keep Sidecar's frame as it moves and resizes, the way `winframe.rs` keeps the main window's: reuse `Frame`,
  `next_frame` and `on_screen` (make `pub` what Sidecar needs, e.g. a helper that reads a window into a `Seen`; no copy
  of that logic), and track full screen separately (`next_frame` deliberately ignores a full-screen frame).
- Persist `{ open, frame, fullscreen }` to `sidecar-frame.json` / `sidecar-frame-dev.json` in the app config dir at
  exit (`RunEvent::Exit`, beside `winframe::save`). `open` goes false only on the Sidecar window's own
  `CloseRequested`; check that quitting does not route through `CloseRequested` (if it does, set a flag at
  `ExitRequested` so a quit leaves `open` true). Missing fields read with serde defaults, so part 2 can add its own.
- At launch, after the main window is set up: if the file says `open`, open Sidecar at the saved frame when it is still
  on a screen (maximized if it was, then full screen if it was); a frame on no screen opens maximized on the main
  window's screen. `open_sidecar` in the same session reuses the in-memory frame.
- Rust tests: the state's serde round trip and defaults; the restore decision (frame on a screen, gone screen → main
  screen, not open → nothing); `open` after a destroy versus after the person's close.
- `docs/reference/architecture.md`: one sentence that `sidecar.rs` reopens Sidecar as last time. `docs/hand-checks.md`:
  `- [ ]` for quitting with Sidecar open (and full screen) and checking the next launch reopens it there.
- Acceptance: `cargo test --manifest-path src-tauri/Cargo.toml sidecar` and `cargo test --manifest-path
  src-tauri/Cargo.toml winframe` pass; `cargo build --manifest-path src-tauri/Cargo.toml` succeeds. No scenario can
  relaunch the app: the relaunch is the hand check above. Scenario `sidecar-wall`'s teardown closes Sidecar with its
  title-bar close, so it does not reopen in later dev launches.

### Task 3: The contract: types, signatures and stubs
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/cockpit/sidecartypes.ts`, `frontend/app/cockpit/sidecarsnapshot.ts`, `frontend/app/cockpit/sidecarwall.tsx`

Land the shared interfaces above exactly, so Tasks 4-7 build side by side.

- `sidecartypes.ts`: the types and event names above, complete.
- `sidecarsnapshot.ts`: the three exported signatures; stub bodies (`messageRows` → `[]`, `sidecarSnapshot` → `{ now,
  counts: { asking: 0, working: 0, idle: 0 }, tiles: [] }`, `keptMessages` → `{}`) marked as Task 4's to fill.
- `sidecarwall.tsx`: `SidecarWall` with the props above, a stub that renders `<div data-sidecar-wall />` with the tile
  count, marked as Task 7's to fill.
- Acceptance: `task check:ts` passes.

### Task 4: Roster → snapshot
**Depends on:** Task 3
**Model:** sonnet
**Files:** `frontend/app/cockpit/sidecarsnapshot.ts`, `frontend/app/cockpit/sidecarsnapshot.test.ts`

Spec section 2 (snapshot) and section 3 (order, a tile's content); decisions 2, 3, 5, 6.

- Implement the three functions, keeping their signatures. Reuse existing helpers: `entriesToShow` for an agent's
  entries, `askSentKey` for `sent`, the label the Agent tree or Cockpit card already shows for `runtime` (find it),
  `usage`'s context percent for `ctxPct`. `since`: `stateSince`, else `now - blockedMs` / `now - activeMs`,
  `idleSince`, or `sleeping.since`. An agent with no rows from its entries takes `kept[id]`.
- Tests: order across the five states (and within asking and working), review from `edited` / `committed`, asleep,
  terminals left out, counts, answerable rules (one question with options; several questions, multi-select, no options
  or more than 9 → not answerable), `sent`, runtime label, message rows (pairing, tool-only lead row, skipped kinds, cap
  8 newest last, 240-char cut), live entries preferred over `previousInfo`, `kept` used only when entries give no rows,
  `keptMessages` leaves out tiles with none.
- Acceptance: `npx vitest run frontend/app/cockpit/sidecarsnapshot.test.ts` passes.

### Task 5: The slim Sidecar page: title bar, waiting state, F11, and the tailwind @source fix
**Depends on:** Task 3 (mounts its SidecarWall stub and uses its types and event names)
**Model:** sonnet
**Files:** `frontend/tauri/sidecar.html`, `frontend/tauri/sidecar.tsx`, `frontend/tauri/vite.config.ts`, `frontend/tauri/tailwind.css`, `frontend/app/cockpit/sidecartitlebar.tsx`

Spec section 2; decisions 1, 14, 15. Follow `frontend/tauri/tray.html` / `tray.tsx`: no cockpit, wsh client, WOS or
store is booted.

- `sidecar.html` + `sidecar.tsx`: a third Vite input (`sidecar: resolve(__dirname, "sidecar.html")`) beside `main` and
  `tray`. The page applies the cockpit theme (`useApplyCockpitTheme`), loads fonts, listens for `sidecar:snapshot`,
  sends `hello` on load and every 2 s until the first snapshot, keeps a 30 s clock for the ages, shows "Waiting for
  arcterm…" (`data-sidecar-waiting`) before the first snapshot, then the title bar, `<SidecarWall …/>` and nothing
  else. Acts go out with `emit(SIDECAR_ACT_EVENT, act)`. F11 toggles full screen
  (`getCurrentWindow().setFullscreen(!(await isFullscreen()))`).
- `sidecartitlebar.tsx`: the board's title bar, `data-tauri-drag-region`: "arcterm / Sidecar", the three counts in the
  wall's words (`N need you`, `N working`, `N idle`), the empty S slot (decision 15), and minimize, maximize toggle,
  full screen and close buttons (close is `getCurrentWindow().close()`, the person's close). The DOM hooks above.
  Colors from `@theme` tokens only (DESIGN.md); nothing animates.
- `frontend/tauri/tailwind.css`: add `@source "./*.tsx";` so classes used only in `frontend/tauri/*.tsx` are generated.
- Acceptance: `task check:ts` passes; scenario `sidecar-wall` steps 3 (waiting), 4 (title bar counts) and 13 (F11) show
  it.

### Task 6: The bridge in the main window
**Depends on:** Task 3 (calls the sidecarSnapshot and keptMessages signatures and uses the act types)
**Model:** sonnet
**Files:** `frontend/app/cockpit/sidecarbridge.tsx`, `frontend/app/cockpit/sidecarbridgemodel.ts`, `frontend/app/cockpit/sidecarbridgemodel.test.ts`, `frontend/app/view/agents/cockpitshell.tsx`, `frontend/app/cockpit/traybridge.tsx`

Spec section 2 "Acts" and section 3's data source; decisions 1, 3, 7, 8, 13.

- `sidecarbridge.tsx`, mounted once in `cockpitshell.tsx` beside `TrayBridge`: subscribes to `model.agentsAtom`,
  `liveEntriesByIdAtom` and `model.sentIdsAtom` (not `nowAtom`); while a page is live builds
  `sidecarSnapshot(agents, entries, sentIds, kept, globalStore.get(model.nowAtom))`, keeps `keptMessages` of it, and
  emits to the `sidecar` window per decision 1. Never makes the main window stream more agents.
- Acts: `hello` → live, and a snapshot at once (unless `window.__sidecarHold` in a dev build); `open` →
  `openTarget(model, { kind: "agent", tabId: id })` then `showMain(model)` (export `showMain` from `traybridge.tsx`);
  `answer` → `answerAgentAsk(model, id, { 0: new Set([option]) }, {})`, logging a `false` return. `sidecar:closed` →
  not live. In a dev build, append every act received to `window.__sidecarActs` (declare both globals on `Window`).
- `sidecarbridgemodel.ts`, pure, with tests: validate an incoming act against the last snapshot (unknown kind, unknown
  id, an answer to a tile with no answerable ask or an option out of range → refused with a reason the bridge logs);
  `sameSnapshot(a, b)` ignoring `now`; the throttle's decision (emit now / schedule the trailing emit / coalesce) from
  the last emit time, a pending timer and now.
- Acceptance: `npx vitest run frontend/app/cockpit/sidecarbridgemodel.test.ts` passes; `task check:ts` passes; scenario
  `sidecar-wall` steps 3 (hello resend after the hold), 11 (Enter opens in the main window) and 12 (2 answers) show it.

### Task 7: The wall: tiles fit the agent count, arrows, Enter, 1-9
**Depends on:** Task 3
**Model:** sonnet
**Files:** `frontend/app/cockpit/sidecarwall.ts`, `frontend/app/cockpit/sidecarwall.test.ts`, `frontend/app/cockpit/sidecarwall.tsx`

Spec section 3 minus scrollback; the Prototype board (match its tile anatomy, type sizes per count, the amber WAITING
ON YOU band, option buttons, context bar and footer; leave out its "scroll for earlier" hint, part 2's); decisions 4,
6, 14.

- `sidecarwall.ts`, pure, with tests: `wallShape(width, height, count) → { cols, rows, msgs, tileW, tileH, scroll }`
  (decision 4; tests pin 1920×1080's wall area for 4 → 2×2 / ~6, 12 → 4×3 / 2, 20 → 5×4 / 1, plus 0, 1, and 40 agents
  scrolling at the 300×170 floor, and a narrow window); `moveSelection(index, key, cols, count)` (left / right ±1, up /
  down ±cols, clamped; a move off the grid stays); the selection kept by id across snapshots (an agent that leaves
  moves it to the same index, clamped); the age text from `since`, the snapshot's `now` and the time since it arrived.
- `sidecarwall.tsx` (replace the stub, keep its props): the grid from `wallShape` (wall area measured with a
  ResizeObserver; the page itself never scrolls, only the wall when `scroll`), tiles in snapshot order with the DOM
  hooks above; idle and asleep tiles dimmed; each tile's last `msgs` rows newest at the bottom (✓ / ✕, verb, target in
  mono), or "No recent messages" (`data-sidecar-nomsgs`); an answerable ask's question and options as buttons 1-9, an
  unanswerable one with "Enter answers it in the main window" (`data-sidecar-elsewhere`); a sent ask shows Sent
  (`data-sidecar-sent`); otherwise the context bar (`ctx 61%`). No agents: one line, "No agents running"
  (`data-sidecar-empty`). Footer: `←↑↓→ move`, `Enter open in the main window`, `1–9 answer`, `F11 full screen`. Keys:
  arrows, Enter (`open`), 1-9 (`answer`, only on the selected tile's answerable ask), double-click opens, a click
  selects. Nothing animates.
- Acceptance: `npx vitest run frontend/app/cockpit/sidecarwall.test.ts` passes; `task check:ts` passes; scenario
  `sidecar-wall` steps 5-12 show it.

### Task 8: The `sidecar-wall` CDP scenario (host: true)
**Depends on:** Task 1 (the Open Sidecar row and the window), Task 4 (the real snapshot it shows), Task 5 (the page and title bar), Task 6 (the bridge and its dev seams), Task 7 (the wall's DOM hooks)
**Model:** sonnet
**Chunk:** Slim page and snapshot bridge (sidecar.html, sidecartypes, sidecarsnapshot, sidecarbridge), plus the tailwind.css @source fix for frontend/tauri pages
**Chunk:** Wall: tiles fit the agent count (4 → 2x2, 12 → 4x3, 20 → 5x4), arrows, Enter opens in the main window, 1-9 answers
**Files:** `scripts/cdp/scenarios-sidecar.mjs`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/attach.mjs`, `scripts/cdp/attach.test.mjs`

Spec "Testing" (the 4 / 12 / 20 part); decision 13.

- `scripts/cdp/attach.mjs`: the target pick prefers the main page and skips `sidecar.html` and `tray.html` targets;
  export a way to attach to a target by url match on the harness's port (`CDP_PORT`, default 9222). Unit-test the pick
  in `attach.test.mjs` (main + sidecar + tray → main; sidecar listed first → still main).
- `scripts/cdp/scenarios-sidecar.mjs`, registered in `scenarios.mjs`'s `SCENARIOS` (import + spread, as the other
  split files are): one scenario `sidecar-wall`, `host: true`, `gotoShot: false` (the goto shot would be the main
  cockpit). Shots taken on the Sidecar target are pushed into `h.shots` as `cockpitofficescenarios.mjs` does, so the
  contact sheet and `shots.json` carry them. Arrange: keep what `public/cockpit-fixtures/active.json` held, and write
  generated AgentVM-shaped rosters (`scripts/cockpit-fixtures/scenarios.mjs` is the model) of n agents in mixed states:
  asking with a 2-3 option ask (each ask with an `askId` and an `oref`, or `answerAgentAsk` refuses it), an asking
  agent with a two-question ask, working, review, idle, asleep with no entries, and one plain terminal that must not
  show; the others with 6-8 `previousInfo` entries and a context percent. Load each with
  `window.__reloadDevMockRoster()`. Steps:
  1. Ctrl+P → Open Sidecar: a `sidecar.html` page target exists afterwards (one already open, from a shared
     `sidecar-frame-dev.json`, is accepted: the row brings it forward); attach to it.
  2. The window will not size below 340×440: with no device override, leave full screen and maximize, read
     `innerSize()` / `scaleFactor()`, `setSize` to 200×200 logical, read again (≥ 340×440), then set the first size
     back. Only after this, pin the page to 1920×1080 with `Emulation.setDeviceMetricsOverride`.
  3. Waiting state: set `window.__sidecarHold = true` on the main page, reload the Sidecar target, shot of
     `[data-sidecar-waiting]`; clear the hold and the wall appears within 5 s (the page's hello resend).
  4. The title bar shows the counts matching the roster, and no tile for the terminal.
  5. 0 agents → `[data-sidecar-empty]`; shot.
  6. 4 agents → `data-cols=2 data-rows=2`, `data-msgs` ≥ 5, no page scroll; the asleep tile shows
     `[data-sidecar-nomsgs]`; shot.
  7. 12 agents → 4×3, `data-msgs` = 2; shot.
  8. 20 agents → 5×4, `data-msgs` = 1, no page scroll; shot.
  9. 40 agents → `data-scroll="true"`, tiles at least 300×170, the page itself not scrolled; shot.
  10. Arrows move the selection (real `Input.dispatchKeyEvent` on the Sidecar target: right moves one, down moves
      `data-cols`).
  11. Enter opens the selected agent in the main window (`__sidecarActs` on the main page holds `{ kind: "open", id }`
      and the main page's active surface is Agent).
  12. 2 answers the asking tile (select it, press 2: `__sidecarActs` holds `{ kind: "answer", id, option: 1 }`, then
      the tile shows `[data-sidecar-sent]`); the two-question ask shows `[data-sidecar-elsewhere]` and no option
      buttons; shot.
  13. F11 toggles full screen (the page's `isFullscreen()` true, then false after a second F11).
  Teardown: put `active.json` back as it was (or remove it) and reload the roster, clear the hold, close Sidecar with
  its title-bar close button (so it does not reopen next launch), leave the main window on the Cockpit surface.
- Acceptance: `npx vitest run scripts/cdp/attach.test.mjs` passes; `node -e "import('./scripts/cdp/scenarios.mjs')"`
  loads with `sidecar-wall` in `SCENARIOS` and no duplicate name; `task verify:ui -- sidecar-wall` against a dev app
  started from this tree passes all thirteen steps (the Final runs the same).

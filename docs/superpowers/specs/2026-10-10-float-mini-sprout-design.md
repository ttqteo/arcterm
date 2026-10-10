# Float minimized to Sprout

In float mode, minimizing no longer sends the window to the Dock or the taskbar: the window folds into Sprout, who
floats over every app at a corner of the screen. A click on Sprout opens the Jarvis chat from it, to answer what waits
on you or ask Jarvis, without bringing the terminal back. The person asked for a float they can fold into the creature
and still reach quickly.

Mockup: `.superpowers/design/jarvis-float-chat/project/` (gitignored), boards `Main` (interactive), `Mini-Hover`,
`Mini-Replied`, `Mini-Open`, `Mini-Float`, `Mini-Tile`, `A-States`. The boards below `InFloat` are an earlier round
and are not part of this change.

## Decisions

- **Mini is a state of float mode, in the same window.** `floatMiniAtom` sits beside `floatModeAtom`; the one window
  shrinks to Sprout's size. No second window: a second webview would need its own copy of the attention queue, the
  errand and the peek, which all live in this one's jotai store, and float mode is one window for the same reason
  (`floatwindow.ts` header).
- **The terminal never refits.** In mini the cockpit shell stays mounted under a `display: none` wrapper, so the
  Agent surface's xterm is not torn down, and `termwrap.ts`'s `isHidden()` guard skips the fit (no PTY resize, no
  TUI reflow at a few columns). On restore the window gets its float frame back *before* the shell shows, so the
  ResizeObserver's fit lands on the same rows and columns and the PTY sees nothing.
- **Sprout floats free, with no frame.** The main window is created transparent (`"transparent": true`; on macOS
  `app.macOSPrivateApi: true` and the `macos-private-api` feature of the `tauri` crate). Every other mode paints its own
  background, so it looks as it does today; mini clears the `html` and `body` backgrounds (`index.html` sets
  `#1a1a1a` inline on `body`). If a platform cannot do this (spike, below), that platform draws Sprout in an 84px
  rounded tile instead (board `Mini-Tile`) and the window stays opaque.
- **Always on top while mini**, whatever the float's pin. Restoring gives the pin back as it was.
- **What minimizes to Sprout, while floating:**
  - a new **Minimize** button in the float bar (a 16px sitting Sprout and the word; title "Minimize to Sprout");
  - on Windows, the window controls' minimize button (`WindowControls` in `cockpit/app-bar.tsx`);
  - on macOS, the yellow traffic light: its target and action are redirected natively while floating and given back
    when float ends. `⌘M` follows if the Window menu's Minimize goes through the button (`performMiniaturize:`
    "simulates a click" on it); if it does not, `⌘M` stays native.

  Outside float mode, minimize is unchanged.
- **Back to the float window:** the **Terminal** button in the chat's header, the **Terminal** button in the hover
  chip, or a double-click on Sprout. The float comes back at the frame it had when it was minimized.
- **Where Sprout floats:** the first time, at the bottom-right of the float's monitor work area, 24px in (as
  `floatRect` places a first float); after that, where you last dropped it (`localStorage` `arc.float.mini`), pulled
  back on screen and onto a monitor that still exists (as `screenFor` does for the float).
- **Drag:** press on Sprout and move past 4px to start `startDragging()`; a press that does not move is a click.
  `data-tauri-drag-region` is not used, because it would swallow the click.
- **The transparent margin never eats a click.** The rest window is a little larger than Sprout (room on Sprout's
  side for the hover chip and the reply bubble). While mini, a 15 Hz poll of `cursorPosition()` sets
  `setIgnoreCursorEvents(false)` only while the cursor is over a drawn element (Sprout, chip, bubble, chat) and `true`
  otherwise, so the app behind gets every other click. The same poll is what tells Sprout it is hovered, since a
  window ignoring the cursor gets no `mouseenter`.
- **Sizes:** rest 340×112 logical px; chat open 380×620. The window grows and shrinks around Sprout's own position so
  Sprout does not move; the content is hidden for the frame of the resize so a half-applied size never shows. The
  chip, the bubble and the chat open toward the middle of the screen: Sprout in the left half puts them on its right,
  Sprout in the top half opens the chat below it.
- **The chat is the pet peek.** `PetPeek` (`view/jarvis/petpeek.tsx`) mounted with a new corner `"mini"`: the same
  queue, actions, keys (`1`–`9`, `Space`, `Enter`, `Esc`), errand composer and item peek. In mini only:
  - the header's **Full view** becomes **Terminal** (restore), and its `×` becomes a chevron, "Collapse into Sprout
    (Esc)";
  - the composer shows the question you asked (`petErrandAtom.prompt`, already stored) as a bubble above the reply.
- **Sprout's look** (board `A-States`), drawn by the existing sprite code at 4px a cell (64px):
  - nothing to say: `stand`;
  - an errand reply streaming: `work1`/`work2` alternating (typing at the laptop);
  - a reply landed and not yet read: `speak` with the `unread` mark;
  - something waits on you: the posture's mark from `POSTURE_MARK` (review gate eye, escalation `!`, blocked `?`) and
    an amber count chip with the number of waiting rows. A plain question has no mark today and gets only the chip.
  - Always: a 2-frame 4px bob every 700 ms with a ground shadow that narrows as Sprout rises; still under reduced
    motion. A 700 ms interval in the component flips the frame (the work pose's two frames ride the same tick), not
    an infinite CSS animation (DESIGN.md: an infinite CSS animation holds the page at display rate).
- **The reply bubble.** An errand reply that finishes while the chat is collapsed shows beside Sprout: `claude ·
  replied` and the first three lines. Clicking it opens the chat; its `×` hides it and the reply stays in the chat. It
  stays until one of those, rather than timing out like the walking pet's bubble: a folded window is where a reply is
  easiest to miss.
- **The hover chip:** the float's agent (status dot, name, state) and **Terminal**. Shown while the cursor rests on
  Sprout and no bubble or chat is open.
- **Notifications are unchanged.** Sprout's mark and chip are the signal in mini; OS notifications route as they do
  for an unfocused float today. The in-app toasts are inside the hidden shell and do not show.
- **macOS traffic lights are hidden in mini** (native `setHidden:` on the three standard buttons) and shown again on
  restore.
- **A reload while mini** lost the atoms but not the small window: `setupFloatMode`'s stranded-frame recovery extends
  to it and gives the float frame back (session storage, as for the float itself).

## Components

| File | Change |
|---|---|
| `frontend/app/view/agents/floatwindow.ts` | Pure: the rest and chat rects around Sprout's anchor, which side they open on, `parseMini` for the stored position. |
| `frontend/app/view/agents/floatstore.ts` | `floatMiniAtom`, `enterMini()`, `exitMini()`, `setMiniChatOpen()`, stranded-mini recovery, the pin given back. |
| `frontend/app/view/agents/miniclickthrough.ts` *new* | The cursor poll and `setIgnoreCursorEvents`; the hit test is pure in `minihit.ts` *new*. |
| `frontend/app/view/jarvis/petmini.ts` *new* | Pure: Sprout's pose, mark, chip count and bubble from the pet signals and `petErrandAtom`. |
| `frontend/app/cockpit/sprout-mini.tsx` *new* | Sprout, chip, hover chip, bubble, drag-or-click, `PetPeek corner="mini"`. |
| `frontend/app/cockpit/cockpit-root.tsx` | Mini: the shell wrapper `hidden`, `SproutMini` drawn, page background cleared. |
| `frontend/app/cockpit/float-bar.tsx` | The **Minimize** button. |
| `frontend/app/cockpit/app-bar.tsx` | `WindowControls` minimize enters mini while floating. |
| `frontend/app/view/jarvis/petpeek.tsx` | Corner `"mini"`; its header variant; the asked-question bubble. |
| `src-tauri/tauri.conf.json`, `tauri.macos.conf.json`, `Cargo.toml` | `transparent`; `macOSPrivateApi` and the crate feature. |
| `src-tauri/src/macwindow.rs` *new*, `main.rs` | macOS only: commands `set_traffic_lights_hidden(hidden)` and `redirect_minimize(on)`, which emits the `float-minimize` event the frontend listens for. Registered in `generate_handler!`. |

## Spike first

Task 1 proves the platform pieces before any UI is built, on macOS and on Windows:

1. A transparent main window looks as it does today in the full layout and in float, and the terminal's WebGL
   renderer still runs.
2. In mini, only Sprout shows, and clicks on the transparent margin reach the app behind (cursor poll plus
   `setIgnoreCursorEvents`).
3. macOS: hiding the traffic lights and redirecting the yellow button work, and whether `⌘M` follows.
4. Growing the window for the chat around a fixed point does not make Sprout jump.
5. Minimize then restore leaves no `[termwrap] resize` line in the log: the PTY was never resized.
6. Memory and CPU in mini are no higher than in float (Activity Monitor / Task Manager, the app's processes summed),
   and the cursor poll plus the bob stay under 1% CPU at rest. One window is the reason mini should cost nothing:
   a second webview would be a whole renderer process.

A failure in 1 or 2 on a platform switches that platform to the tile; a failure in 3 leaves the yellow button
native, with the float bar's **Minimize** as the trigger. The spike's findings go into the plan before Task 2.

## Testing

- vitest beside each pure file: `floatwindow.test.ts` (rects, sides, clamping, parse), `petmini.test.ts` (each look
  in `A-States`), `minihit.test.ts` (hit or pass-through).
- CDP scenario `float-mini` in `scripts/cdp/scenarios.mjs` (Windows; WKWebView answers no CDP): enter float, minimize,
  assert `[data-sprout-mini]` and the window size, open the chat and shoot it, restore, assert the focused terminal's
  rows and columns are what they were before minimizing.
- macOS by hand, from a checklist in the plan: free-floating Sprout, click-through, yellow button, drag, restore.

## Docs

- `docs/guide/agent.md`: the Float row says how to minimize to Sprout and come back.
- `docs/guide/cockpit.md`, "Con vật Jarvis": Sprout floating while the float is minimized.
- `CHANGELOG.md` `Added`: one line for the person.
- `docs/reference/architecture.md` and `AGENTS.md`: the Tauri host's command list grows by the two macOS commands.

## Not in this change

- A global hotkey to summon Sprout from another app (needs the global-shortcut plugin).
- A chat head inside the float window (the earlier `InFloat` boards); the float bar keeps today's Sprout mark.
- Minimizing the full window (not floating) to Sprout.
- One Sprout per agent.

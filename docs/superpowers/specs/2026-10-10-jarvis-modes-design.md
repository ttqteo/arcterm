# Jarvis across the window's three sizes

arcterm's one window has three sizes: **Full** (the cockpit), **Float** (one agent's terminal) and **Sprout** (folded:
only Sprout, floating over every app). Today each size has its own Jarvis (a walking Sprout on the footer, a still mark
in the float bar that shows only when something waits, a floating Sprout), reaching Sprout takes two steps (float, then
minimize), coming back always lands in Float, and the "chat" is the waiting-items popup with a one-shot reply. The
person found it clumsy. This spec makes it one Sprout, one click to fold, one chat, and a key that reaches Jarvis from
any app.

It revises `2026-10-10-float-mini-sprout-design.md`, which shipped the folded window itself (see "What changes from the
first fold" below). Mockup: `.superpowers/design/jarvis-modes/project/` (gitignored): `Main` (interactive), `Fold`,
`Chat-Detail`, and one board per state.

## Decisions

### 1. Sizes and how to move between them

| From → to | How |
|---|---|
| Full → Sprout | The **Sprout** button in the app bar, the yellow traffic light, `⌘M`, or Windows' minimize button. One click |
| Float → Sprout | The **Sprout** button in the float bar, or the same minimize |
| Full ↔ Float | `Shift+F` and the Float button, as today |
| Sprout → back | Double-click Sprout, **Restore** in the chat or in the hover list. Back to the size it was folded from, at the same frame |

- **Sprout folds where it stands.** The folded Sprout appears at the screen spot the walking Sprout stood on in the
  window (the footer in Full, the ledge in Float). The window's content scales and fades into that spot (300 ms, the
  motion tokens' easing), then the window shrinks; restoring grows the window first, then scales the content out of
  Sprout. Reduced motion skips both animations. While folded, Sprout can still be dragged anywhere; the next fold starts
  again from where it stands in the window, so no separate "last dropped" spot is kept.
- **Minimize goes to Sprout in every size**, by default. A new setting, **Settings → General → Minimize: Sprout / Dock**
  (`window:minimize`, `"sprout"` default), puts the Dock or taskbar back. On macOS the yellow button is redirected
  whenever the setting is `"sprout"`, not only while floating.
- No new key for the ladder: `⌘M` (and the Windows minimize button) folds, `Shift+F` toggles Float.

### 2. Sprout in each size

One Sprout, 48 px (3 px a cell) in every size, the same marks and the same chat.

| | Full | Float | Sprout (folded) |
|---|---|---|---|
| Where | Walks the footer, as today | Walks a **52 px ledge** at the bottom of the float window | Alone on the desktop, bobbing; dragging moves the window |
| What waits | Posture mark over its head; the count is the nav rail badge | Mark, and an amber **count chip** beside it | Mark and count chip |
| One click | Opens the chat | Opens the chat, risen from the ledge | Opens the chat |
| In-app notices | Bubbles and toasts, as today | **Sprout's bubbles** instead of toasts | Sprout's bubbles |

- **Float shows one terminal** (the focused agent's) and gains an **agent switcher** in the float bar: one status dot
  per agent; a click sets `focusIdAtom`, so the float shows that agent. The float bar's still Sprout mark is removed:
  the ledge Sprout replaces it. The bar keeps the agent's name and state, the switcher, the **Sprout** button, the pin and
  the way out of Float.
- **The ledge holds the whole sprite**, so Sprout never covers the terminal's prompt; terminal avoidance
  (`petledge.ts` `avoidSpans`) does not apply on it.
- **Folded, hovering Sprout** shows every agent (up to 4, then "+N") with its state; a click on one restores to Float
  on that agent. The list ends with **Restore** (to the size it was folded from).
- **Folded Sprout has no ground shadow**, and nothing in the folded window draws a drop shadow or a tooltip: over a
  light app behind the see-through window they read as smears (as shipped in `a8f49627`).
- In Float and folded, the notices that are toasts today (needs you, decision, message, finished) are Sprout's bubbles
  instead: `notifyevents.ts` `routeNotify` sends them to the avatar in those sizes.

### 3. One Jarvis chat

Every click on Sprout, in any size, opens the same panel (`JarvisChat`), which replaces the peek's hub layout.

- **Header:** "Jarvis · <project>", a **⋯** menu (harness, project, open the Jarvis surface), then **Restore** when
  folded or **Full view** otherwise, and a chevron that collapses it (`Esc`).
- **Needs you · N:** the waiting items as cards with their actions (Approve, Open, `1`–`9` answers), folding away; the
  section is absent when nothing waits (no "Nothing waiting on you" line).
- **The conversation:** the last 20 exchanges from the destination channel's `consult` (your question) and
  `consult-reply` (Jarvis's answer) messages, newest at the bottom; a streaming errand shows as the last reply with a
  cursor. A resolved card adds a one-line note ("Approved the plan for run 4e8f.").
- **A standing condition** (RAM tight, quota spent) is one thin line above the field, only while it stands.
- **The field:** "Ask Jarvis…", `Enter` sends through `sendErrand` as today.
- The item peek (`Space` on a card, `Ctrl`+click a link) still opens inside the panel, as `PeekItemView` does today.
- Size: 380×520. Folded, the window grows to hold it (as today); in Full and Float it is a popover from Sprout.

### 4. Quick access

- **A global key**, default `⌥⌘J` on macOS and `Ctrl+Alt+J` on Windows, set or turned off in **Settings → Keyboard**
  (`jarvis:hotkey`, empty for off). From any app it opens the chat with the field focused: folded, from Sprout; in
  Full or Float, it brings arcterm forward and opens the chat from Sprout. Pressed again with the chat open, it closes
  the chat. Built on `tauri-plugin-global-shortcut`.
- **Right-click on Sprout**, in every size: **Open chat**, **Fold into Sprout** or **Restore**, **Agents ▸** (one row an
  agent; Float on it), **Settings…**. Folded, the window grows for the menu as it does for the chat.

### What changes from the first fold

- The fold can start from Full, and Restore returns to the size it came from (it always returned to Float).
- Sprout is 48 px folded (it was 64), and its folded spot is where it stood in the window (it was a remembered spot,
  `arc.float.mini.v2`, which is dropped).
- The hover chip of one agent becomes the list of agents; the chat is `JarvisChat`, not `PetPeek` with a mini corner.
- Kept: one window, the shell hidden under `display:none` while folded so the terminal never refits, the transparent
  window, the cursor poll for click-through, the serialized window operations, points on macOS.

## Phases

Each phase ships on its own; the first plan covers phases 1 and 2.

1. **Moves:** the Sprout button in both bars, minimize from Full, Restore to the origin size, Sprout folding where it
   stands, the fold animation, the `window:minimize` setting.
2. **Sprout everywhere:** the float ledge and the walking Sprout in Float, the agent switcher, the folded agent list,
   bubbles instead of toasts in Float and folded, no ground shadow folded.
3. **The chat:** `JarvisChat` in all three sizes.
4. **Quick access:** the global key and the right-click menu.

## Components

| Area | Files |
|---|---|
| Size model (pure) | `frontend/app/view/agents/windowsize.ts` *new*: which size a move lands in, the origin a restore returns to, the spot a fold starts from (window inner position + the sprite's rect, in the fold's space), with tests |
| Window calls | `frontend/app/view/agents/floatstore.ts`: `enterMini(origin)` from Full or Float, restore to the origin (Full: `giveFrameBack`-style frame and maximize), the fold and unfold animation hooks |
| Bars | `frontend/app/cockpit/app-bar.tsx` (Sprout button), `frontend/app/cockpit/float-bar.tsx` (switcher, Sprout button, mark removed) |
| Sprout | `frontend/app/view/jarvis/petview.tsx` mounted in Float on the new ledge (`frontend/app/cockpit/float-ledge.tsx` *new*, `data-pet-ledge`), `petledge.ts` (a ledge that holds the sprite skips avoidance), `frontend/app/cockpit/sprout-mini.tsx` (48 px, agent list, no ground shadow) |
| Notices | `frontend/app/view/agents/notifyevents.ts` `routeNotify` (avatar in Float and folded), Sprout's bubble in `sprout-mini.tsx` |
| Chat | `frontend/app/view/jarvis/jarvischat.tsx` *new*, `jarvischatmodel.ts` *new* (thread from channel messages, cards), used by `petview.tsx` and `sprout-mini.tsx` |
| Settings | `pkg/wconfig/settingsconfig.go` (`window:minimize`, `jarvis:hotkey`), `schema/settings.json`, then `task generate`; the Settings UI rows |
| Global key | `src-tauri/Cargo.toml` and `main.rs` (the plugin), `src-tauri/capabilities/default.json`, `package.json` (`@tauri-apps/plugin-global-shortcut`), `frontend/app/view/agents/jarvishotkey.ts` *new* |
| Right-click | `frontend/app/view/jarvis/sproutmenu.ts` *new* (the items, pure) through the themed `ContextMenuModel` |

## Testing

- vitest beside each pure file: `windowsize.test.ts` (every row of the moves table, origin kept across a fold,
  the fold spot from Full and from Float, a spot on another monitor), `jarvischatmodel.test.ts` (thread order and cap,
  a streaming reply, a resolved card's note, no section when nothing waits), `notifyevents.test.ts` (avatar in Float
  and folded), `sproutmenu.test.ts`, the agent list's "+N".
- CDP scenario `jarvis-modes` (Windows): Full → Sprout in one click, Restore lands in Full, Float → Sprout → Restore
  lands in Float, the chat opens in all three, the PTY size never moves (as `float-mini` checks).
- macOS by hand, from the plan's checklist (WKWebView answers no CDP).

## Docs

`docs/guide/agent.md` (Float row), `docs/guide/cockpit.md` ("Con vật Jarvis"), `docs/guide/settings.md` (the two
settings), `docs/keyboard-shortcuts.md` (`⌘M`, the global key), `CHANGELOG.md`.

## Not in this change

- A menu-bar (tray) Jarvis.
- More than one terminal in Float (a grid or a split).
- More than one Sprout.

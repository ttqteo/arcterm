# Pinned apps on the nav rail

A held service (`docs/superpowers/specs/2026-10-20-held-services-design.md`, with
`2026-10-20-services-sleep-design.md`) opens today in the Agent centre, beside the tree. An app the person opens
many times a day (the portfolio dashboard, claudecodeui) takes a trip through Agent or the Services chip each time.
This puts up to three of them on the nav rail, under Radar, each opening as a surface of its own with the page
filling it, like a pinned tab in a browser.

The person's calls (2026-10-20): worth doing once held services land; a rail icon opens the app as its **own
surface**, full width, not the Agent surface with the service selected.

The canvas is `.superpowers/design/rail-apps/` (boards `RailAppSurface`, `RailAppCrashed`; gitignored).

## Decisions

- **Where:** after Radar, behind a second divider like the one between Usage and Code, before the spacer that holds
  Setup and Settings. Each pin is a rail item in the tool items' size: the app-window icon (16 px) and the service's
  name as its label, cut with an ellipsis to the 78 px rail's width; the 56 px rail hides the label, as it hides every
  item's. Selected, it takes the accent bar and fill every surface takes.
- **How many:** at most 3. Pinning a fourth is refused: the menu item is disabled with the title
  `The rail holds 3 apps: unpin one first`.
- **Pin and unpin:** the service row's menu in the Agent tree gets `Pin to the rail` / `Unpin from the rail`; the app
  surface's header has an Unpin button; the rail item's own right-click menu has `Unpin from the rail`,
  `Move up` and `Move down`. The order is the person's. A pin whose service is gone from `tools.json` disappears, and
  holds no place among the three.
- **Leaving:** unpinning the app the surface shows (its header's Unpin, or its rail item's menu) opens Agent with that
  service selected, so the same page stays on screen; a shown service gone from `tools.json` leaves for Agent as it
  was (decided 2026-10-20).
- **Kept where:** in the browser's localStorage, key `apps.rail` (a list of service ids), like Open a tool's pins
  (`pinnedToolsAtom`, `toolsstore.ts`): it is the person's view of the rail, not the service's config.
- **State on the rail:** a small dot on the icon only when the app needs the person: red when it is `retrying` or
  `crashed`, amber when `porttaken` or `nopage`. Running, starting, sleeping and stopped draw no dot (a calm rail);
  the tooltip carries the name and the row words (`docs: sleeping`).
- **The surface:** one new surface key, `app`, with the shown service's id in its own atom. The header follows board
  `RailAppSurface`: icon, name, project, the state line (`serviceHeaderLine`), Back, Forward, Reload (Windows), Home,
  Open in the browser, `Log`, Restart (when `canRestart`), Stop or Start, and Unpin. Below it the page fills the
  surface. The buttons follow the Agent header's one rule in every state (Home off without a page), so a crashed pin
  shows Restart and Start; board `RailAppCrashed` draws the header short (decided 2026-10-20).
- **The same page, no reload:** the page frames already live in the shell (`AppFrames`, `apppane.tsx`), positioned
  over a slot (`appSlotAtom`). The app surface publishes its body as the slot, so switching between the app surface
  and the Agent centre moves the one frame, keeping its page and scroll. It stays inside the ten-minute keep-alive and
  the sleep rule unchanged.
- **Log** opens the Agent surface with the service selected and its Log view: the terminal stays a pane of the Agent
  surface, never a second view of the same block.
- **Not running:** running or `elsewhere`, the page. Starting or sleeping, today's waiting card (`appWaitLine`): a
  sleeping pin wakes because it is on screen, so it only waits (decided 2026-10-20). Crashed, retrying, stopped, port
  taken or no page shows a card over the body, as on board `RailAppCrashed`: a sentence in the row words' meaning,
  the main action (Restart, or Start) as the primary button, and `Open its log`.
- **Sleep:** the app surface showing a service counts as on screen (`shownServices`, `serviceseen.ts`), so opening a
  sleeping pin wakes it and leaving the surface starts its ten minutes.

## Not in scope

- A keyboard shortcut per pin (Ctrl+1..7 stay the seven surfaces) and palette commands for pins.
- The app's own favicon as the rail icon.
- Pinning from the Services popover or Setup → Tools.

## RAM

Nothing new: a pin costs nothing until opened, and an open one is the frame that already exists (50–150 MB, the
held-services RAM row).

## Verification

- vitest: the pin list (pin, unpin, move, the cap of 3, a removed service dropped), the rail dot from a state,
  `shownServices` counting the app surface.
- CDP `services-rail`: pin a running service from its row menu → its rail item after Radar; click → the app surface
  with the page and the header; the frame element is the same one Agent showed (no new load); a crashed pin shows the
  red dot and the crash card; a fourth pin is refused; Move up and Move down reorder the pins; Unpin removes the item;
  a pinned service removed from `tools.json` leaves the rail and the surface. Scenarios that count `nav button` keep
  counting only surfaces (the pins carry `data-nav-app`).
- Hand check in the Tauri app: the frame moving between Agent and the app surface without a reload in WKWebView. It
  is a chunk on the effort `Held services: follow-ups`, done by the person after the run lands.

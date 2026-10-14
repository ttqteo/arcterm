# Canvas gallery

**Date:** 2026-10-14
**Canvas (reference):** `D:\work\arcterm\.superpowers\design\canvas-gallery\project\` — boards `Main`, `Cleanup`,
`Viewer`, `Empty`, `Storage`.

## Why

Design canvases (`.superpowers/design/<topic>/`, made with the `design-local` skill) used to be deleted when their
feature shipped. They are worth keeping to look back at, so the rule changed: agents keep every canvas
(`skills/design-local/SKILL.md` "Cleaning up", `DESIGN.md` "Mockups"). Kept canvases need a place to be seen together
and a place to be cleaned up, and the old delete-on-ship behaviour becomes a setting, off by default.

Today a canvas reopens only from the palette, only for the selected agent's project, and only attached to an agent.

## What ships

1. **Agent → Canvases**, a fifth centre mode of the Agent surface beside History: a gallery of every registered
   project's canvases, newest first, each card with a cached preview.
2. **A viewer** inside that mode: one canvas, one board at a time, no agent needed.
3. **Clean up**, a selection mode of the gallery: the canvases unchanged for 30+ days come pre-ticked; Move to trash.
4. **Settings → Storage → Design canvases**, a summary card (size, count, Open the gallery). No per-row list.
5. **`storage:canvasonship`**, a setting in the Auto-clean card, off by default, read by agents through
   **`wsh canvas policy`**.

## The gallery (board `Main`)

- Opened from a **Canvases** row under Conversation History at the top of the tree (no count: the row reads nothing
  from disk), and from a global palette command **Canvases**. `showCanvases(model)` in `agentcenter.ts` sets
  `centerModeAtom` to `"canvases"`; `CenterMode` gains that value.
- Header: title, a pill `N · size`, **Clean up**, and a search box (`/` focuses it) matching topic, board and project
  names. No project picker: the project is on every card and the search matches it.
- Body: groups **Today / Yesterday / Earlier** by the newest board's mtime, a card grid (`repeat(auto-fill,
  minmax(240px, 1fr))`, the one sanctioned "card grid" in DESIGN.md's layout rule). A card: the preview (16:10), a
  board-count badge, the topic, `project · time`.
- A card with no preview yet shows its board names and "No preview yet: it is taken the first time you open it".
- Keys: arrows move the card cursor, Enter opens, `/` searches. Up/down/left/right only take this meaning while the
  centre mode is `canvases` and no viewer is open; the agent-nav arrow bindings stand down there, as they already do on
  a canvas board (`bindings.ts` `boardReady`).
- Empty states (board `Empty`): no canvas anywhere; the search matches nothing ("The search reads topic, board and
  project names.").

## The viewer (board `Viewer`)

- A card opens the viewer in the same centre mode. Header: back (Esc), topic, `project · changed <time>`, the boards as a
  segmented control between **‹ ›** buttons. **← →** step the boards; `[` `]` also do, as on the canvas pane, but the
  hints show only the arrows (a Vietnamese Telex IME turns `[` `]` into `ơ` `ư`).
- The board renders in one iframe, reusing the canvas pane's board rendering (`canvaspane.tsx`) without marks or Send:
  there is no agent to send to. Its paneState handling (probing, server-down, removed) is the pane's.
- Leaving the viewer unmounts the iframe; leaving the centre mode unmounts everything, like History. The open topic and
  board live in one jotai atom (`canvasGalleryAtom`: `{ view: "grid" | "viewer" | "cleanup", dir, board, query,
  cursor }`, `dir` the topic folder) so a surface switch comes back to the same place.
- To keep editing a canvas with an agent, the palette's existing per-agent **Canvases** group does it. The viewer has no
  Open on agent menu.

## Previews

- When a board has been on screen and settled for ~1 s — in the viewer, or in an agent's canvas pane — and the topic's
  `thumb.png` is older than its newest `.dc.html`, the app captures it once: `capture_webview` (the host command canvas
  Send already uses), cropped to the board rect, scaled to 480 px wide, written over `<topic>/thumb.png` with
  `FileWriteCommand`. 30–60 KB.
- One file per topic, inside the topic folder: deleting the topic removes it, nothing orphans, no cache directory.
  Never captured in the background, never one per board.
- On a Mac `capture_webview` is Windows-only, so a card keeps the board-names placeholder there.
- The grid shows previews as `<img loading="lazy">` from the URL `CanvasServeCommand` already serves for the project's
  design folder, with `?v=<thumb mtime>` to bust the cache.

## Listing

- New wshrpc command `ListCanvasesCommand() ([]StorageCanvas, error)` (the Storage prefix because the generated TypeScript
  names a type by its bare Go name), one call per gallery open: for every registered
  project, each topic under `.superpowers/design` that `isCanvasSegment` accepts, with `project`, `dir`, `boards`
  (`project/*.dc.html` names, `canvas.json` order when present), `modts` (newest board), `thumbts` (0 when none),
  `bytes`. No watcher; the gallery re-reads when it opens and after a clean.
- The scan is a function in `pkg/storage` (`canvases.go`) that the Storage provider below also uses, so the two never
  disagree about what a canvas is.
- `listCanvasTopics` (palette) is left as it is.

## Clean up (board `Cleanup`)

- **Clean up** turns the grid into checkboxes. The canvases whose newest board is 30+ days old come ticked, under an
  "Unchanged 30+ days · suggested" group; the rest sit under "Newer", unticked. 30 days is a constant, not a setting.
- A sticky bar: `N selected · size`, "They stay in ~/.arc/trash for 7 days.", **Untick all**, **Move to trash**
  (the screen's primary action). Space toggles the card under the cursor; Esc leaves.
- Move to trash calls the existing `CleanStorageCommand` with category `canvases` and the topic dirs as ids; the result's
  skipped rows show on their cards. There is no other delete path in the gallery.
- "Has this feature shipped?" stays an agent's judgement: ask an agent to suggest a clean-up, and it lists the topics
  whose feature shipped (the SKILL.md rule). The app does not guess it.

## Storage (board `Storage`)

- A `canvases` category in `pkg/storage` (`canvases.go`): `measure` reports every topic as an item (`Guarded: true`,
  `Kind: "canvas"`), so the head's "arcterm uses …" counts them; `clean` re-checks each id is a topic dir under a
  registered project's `.superpowers/design`, then renames it into the trash as `<unix-ms>-canvas-<project>-<topic>`, the
  shape `sessiontrash.Purge` already removes after 7 days.
- `autoclean.go` never picks the category. `cleanableTotal` leaves it out (guarded items already are).
- Settings → Storage draws it as a summary card, not a row list: size, `N canvases`, a blurb, **Open the gallery**
  (`showCanvases(model)`; `StoragePage` takes the model from `SectionBody`, as `AgentsPage` does). `CARD_ORDER` gains `canvases` after `buildoutput`.

## Setting and agents

- `storage:canvasonship` (`*bool`, nil = off) in `SettingsType`, `schema/settings.json`, then `task generate`. A row in
  the Auto-clean card: "Agents delete a canvas when its feature ships"; off: "agents keep every canvas, and list the
  shipped ones when you ask them to tidy up". The "Clean the safe parts daily" description names canvases among what
  waits for you.
- `wsh canvas policy` prints `delete-on-ship` when the setting is on, else `keep`, from `GetFullConfigCommand`.
- `skills/design-local/SKILL.md` "Cleaning up": when a feature ships, run `wsh canvas policy`; delete the topic folder
  only on `delete-on-ship`; on `keep`, an error, or no `wsh`, keep it. Asked to tidy up, list the shipped topics and
  delete only those picked. `DESIGN.md` "Mockups" says the same in one line.

## Not doing

Kept out on purpose, so the gallery stays a viewer plus one clean-up mode:

- an Open on agent menu (the palette does it), a project picker, a sidebar count;
- deleting from anywhere but Clean up; a per-row list in Storage; a restore UI (the trash folder is there by hand);
- tags, favourites, notes or comments on a canvas; comparing boards; export or sharing;
- a watcher or live refresh; a preview per board; previews captured in the background;
- guessing in the app whether a canvas's feature has shipped;
- remapping `ơ` to `[` for Telex: the arrows are the keys.

## Testing

- **Go:** `pkg/storage` — the scan (topics, boards in `canvas.json` order, mtimes, thumb, bytes, a non-canvas name
  skipped, a project with no design dir), clean (into the trash under the purge's name shape, an id outside a design
  dir refused, a vanished dir skipped), auto-clean ignoring the category. `wsh canvas policy` for on, off and unset.
- **vitest:** `canvasgallery.ts` (pure): grouping by day, search over topic/board/project, the 30-day suggestion,
  selection totals, preview staleness (`thumbts < modts`); `storagemodel` and `settingsmodel` tests for the new card
  and row.
- **CDP:** scenario `canvas-gallery` on a seeded temp project with three topics (one without `thumb.png`): open the
  mode from the tree row (shot: grid, the placeholder card), `/` search with no match (shot), Enter into the viewer and
  → to the next board (shot), Esc, Clean up with one topic backdated 40 days (shot: it is ticked, the bar's total),
  Move to trash (the card leaves), then Settings → Storage (shot: the summary card and the Auto-clean row).
- **RAM:** measure the dev app with the gallery open on 17 canvases and in the viewer; add the figures to
  `docs/open-issues.md` "RAM watch".

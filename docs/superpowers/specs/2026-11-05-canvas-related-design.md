# Canvas versions: a newer canvas outdates the one it replaces

Date: 2026-11-05. Brainstorm: `.superpowers/brainstorm/canvas-related/brainstorm.json`.

**Prototype:** `D:/src/arcterm/.superpowers/design/canvas-versions/project/`

## Goal

When a new canvas redraws a screen that an older canvas already designed, Agent → Canvas gallery links the two as
versions. The new card says which canvas it replaces. The old card is dimmed, says **Outdated**, and links to the newer
version. Today the gallery shows 58 unrelated cards, and pairs like `mxc-home` / `mxc-home-fresh` read as two
unrelated designs.

## What is there today

- A canvas is a folder `.superpowers/design/<topic>/` in a project. `pkg/storage/canvases.go` `ListCanvases` reads
  each one into `StorageCanvas`: topic, project, projectname, designdir, dir, boards (ordered by `canvas.json`'s
  `order`, read in `canvasOrder`), modts, thumbts, bytes. `ListCanvasesCommand` (`pkg/wshrpc/wshrpctypes_storage.go`)
  returns them, and Settings → Storage (`canvases.measure`) uses the same list.
- `canvas.json` (`<topic>/project/canvas.json`, written by the `arc:design` skill in `skills/design/SKILL.md`) has a
  `title` and a title for each board. Nothing points from one canvas to another.
- The frontend's pure model is `frontend/app/view/agents/canvasgallery.ts` (`GalleryCanvas` mirrors `StorageCanvas`).
  The store is `canvasgallerystore.ts`. The view is `canvasgalleryview.tsx`: `CanvasGrid`, `CanvasCard` (a single
  `<button>`), `CanvasCleanup`, and `CanvasViewer`, whose header holds Back, the topic, the changed line and the board
  tabs.
- Clean up suggests the canvases unchanged for 30 days (`SUGGEST_AFTER_DAYS`). This design leaves that alone.

## The link

- A canvas that replaces another writes `"replaces": "<old topic>"` in its own `canvas.json`. The old topic is in
  the same project. A canvas replaces at most one canvas.
- **No forks** (Agent's call). At most one canvas replaces a given canvas, so versions form a line. The link command
  refuses to link onto a canvas that another canvas already replaces. The picker and the scan only offer older canvases
  that nothing replaces yet, which are the heads of their chains. So when `mxc-home-fresh` already replaces `mxc-home`,
  a forgotten `mxc-home-fresh-v3` is suggested onto `mxc-home-fresh`, not onto `mxc-home`.
- **Older and newer** (Agent's call) go by creation time: `canvas.json`'s `createdOnFiles.at`, or the canvas's
  `modts` when that is missing. `StorageCanvas` gains `createdts`. `modts` moves whenever a board is rewritten, so it
  could flip a pair's direction. Two canvases with the same creation time order by topic: the one that sorts first is the older.
- A pair you have said is not a version is written in the newer canvas's `canvas.json` as
  `"notreplaces": ["<topic>", …]`, so it is never suggested again.
- Three writers set these fields. The `arc:design` skill writes `replaces` while it draws. The viewer header links and
  unlinks by hand. The scan's Link / No writes from a suggestion or the review list. Every gallery-side write goes
  through one new wshrpc command (for example `SetCanvasLinkCommand(dir, replaces, notReplaces)`). It rewrites
  `canvas.json` and keeps every other key. A canvas with no valid `canvas.json` gets a minimal one (the skill's index
  shape: `v`, `title`, `boards`, `order` from the boards on disk), so the link has somewhere to live.
- `StorageCanvas` gains `title`, `createdts`, `replaces` and `notreplaces`, read beside `order` in `canvasOrder` (one parse). Then
  run `task generate`. `ListCanvases` stays read-only: nothing writes on a list, and Settings → Storage still only reads.

## How the gallery reads the links (pure model, `canvasgallery.ts`)

- **Outdated.** A canvas is outdated when another canvas in its project names it in `replaces` and that canvas
  exists. A `replaces` naming a topic that no longer exists (trashed or renamed) is ignored, and nothing is dimmed.
- **Chains.** For v1 → v2 → v3, every outdated card's **Newer** link goes to the newest canvas in the chain (v3). A
  cycle (only possible from hand-edited files) is broken at the canvas created last. That canvas is never outdated.
- **Suggestions (the scan rule).** Take a pair of canvases in the same project. Neither replaces anything yet, and the
  newer one's `notreplaces` doesn't name the older one. They match when the older topic is a prefix of the newer
  topic at a `-` boundary (`mxc-home` / `mxc-home-fresh`), or when the words in their `canvas.json` titles overlap
  enough. The builder sets the threshold, with tests for the real pairs (`project-overview` /
  `project-overview-history`) and the near-miss `council-ux` / `council-stronger`, which must not match on the
  `council-` prefix alone. The older canvas must be one nothing replaces yet (a chain head). The newer canvas (by creation time) is suggested as
  replacing the older one. Each newer canvas gets
  at most one suggestion: the best match.
- Grouping by day, search and Clean up are unchanged. An outdated card stays in its day group.

## UI (board `A-viewer-header`, `A-scan-suggest`, `C-scan-review`)

The boards' rows are illustrative: `council-stronger replaces council-ux` on `A-scan-suggest` and `C-scan-review`
shows the layout, but by the scan rule below that pair never matches. The rule wins.

- **New card:** a chip `Replaces <old topic>` under the meta line.
- **Old card:** its preview and topic are dimmed (about 45%), with an `Outdated` chip and a `Newer: <topic> →` link
  under the meta line. The link opens the newer canvas in the viewer. The card itself still opens the old canvas.
  `CanvasCard` is a `<button>`, so the link must not sit inside it as a nested interactive element. Make the card a
  focusable element with a role, or put the link beside the button. The builder picks one and keeps the keyboard
  cursor working.
- **Viewer header (linking by hand):** after the changed line, a chip `Replaces <topic> ×` (× removes the link), and
  a button `Link an older version…` that opens a picker. The picker has a search field and lists the canvases in the
  same project that are older than this one (by creation time) and that nothing replaces yet, each with a thumbnail,
  topic, board count and date. Picking one sets `replaces`, and removes that topic from `notreplaces` if it was there.
  When the canvas already replaces one, the current one is marked in the list. With no candidate, the picker says `No older canvas in <project>`.
- **× counts as "not a version"** (Agent's call). It clears `replaces` and adds the old topic to `notreplaces`, so the
  same pair is not suggested again on the next open.
- **Scan for versions (once, for the existing canvases):** a `Scan for versions` button beside `Clean up` in the
  gallery header. It opens a review list of every suggested pair (`<new> replaces <old>`, project on the right), all
  ticked. You untick the wrong ones, and `Link N pairs` writes `replaces` for the ticked pairs and `notreplaces` for the
  unticked ones. Cancel writes nothing. The button is hidden when there is nothing to suggest.
- **Button first, then card rows.** Until the scan has been done, the gallery shows only the `Scan for versions`
  button and no suggestion rows. Once the review closes (Link or Cancel), the button is gone for good, and from then on
  suggestions show on the cards. Whether the scan has been done is kept in the gallery's localStorage, under a key read
  through a try/catch. On another machine, or after the dev data is cleared, the button shows once more.
- **Suggestion on open (after that):** each time the gallery opens, a newer canvas with a suggestion shows a dashed row
  on its card: `Looks like it replaces <topic> · Link · No`. Link writes `replaces`. No writes `notreplaces`. Nothing
  is dimmed until Link.

## The agent (`skills/design/SKILL.md`)

- Before naming a new topic, the skill lists the existing topics in `.superpowers/design/` (and their `canvas.json`
  titles). When the new canvas redraws a screen one of them designed, it writes `"replaces": "<that topic>"` at once,
  and says one line in its reply ("this canvas replaces mxc-home"). You undo a wrong link with × in the viewer header.
- When it rewrites `canvas.json` (each change rewrites the whole file), it keeps `replaces` and `notreplaces`.

## Testing

- Vitest for the pure model: outdated set, chain resolution (the newest wins, cycles, a missing target), the
  suggestion rule (real pairs match, `council-ux` / `council-stronger` doesn't, `notreplaces` suppresses, at most one
  suggestion per canvas), and the scan review's resulting writes.
- Go tests in `pkg/storage`: `title` / `replaces` / `notreplaces` are read, and the link command keeps the other keys,
  creates a minimal `canvas.json`, and refuses a dir that is not a registered canvas.
- CDP: extend the `canvas-gallery` scenario (`scripts/cdp/scenarios.mjs`) or add `canvas-versions`, with a temp
  project holding a linked pair, a suggested pair and the `council-ux` / `council-stronger` near miss. Shots: the
  gallery with the Replaces / Outdated cards and a suggestion row, the viewer header with the picker open, and the
  Scan for versions review list.

## Left to the builder

- Chains point at the newest. A canvas replaces at most one canvas and is replaced by at most one (no forks).
- `replaces` only names a topic in the same project. A missing target is ignored.
- The link command keeps every other `canvas.json` key, and creates a minimal file when there is none.
- SKILL.md: look at the existing topics before naming one, and keep `replaces` / `notreplaces` on every rewrite.
- `StorageCanvas` gains `title`, `createdts`, `replaces`, `notreplaces`, then `task generate`.
- Clean up keeps its 30-day rule. Search and the day groups are unchanged.
- The scan rule is a pure model in `canvasgallery.ts`. Card Link / No, the scan list's Link, and the header's × and
  picker all go through one wshrpc command.
- `Scan for versions` is hidden when no pair is left to suggest.
- A `CHANGELOG.md` line under Added.

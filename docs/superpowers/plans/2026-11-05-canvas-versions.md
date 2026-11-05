# Canvas versions: a newer canvas outdates the one it replaces

**Spec:** `docs/superpowers/specs/2026-11-05-canvas-related-design.md` (read it whole before starting: it is the source of truth for every rule below)
**Verify:** `node scripts/verify.mjs ./pkg/storage/... ./pkg/wshrpc/... ./skills/...`
**Check:** `task check:ts && go vet ./pkg/storage/... ./pkg/wshrpc/... ./skills/...`
**Final:** `node scripts/cdp/final-verify.mjs canvas-versions canvas-gallery canvas-gallery-maker`
**Prototype:** D:/src/arcterm/.superpowers/design/canvas-versions/project/

Decisions made beyond the spec (the lead's calls, each with why):

- **Wire shape.** One command, `SetCanvasLinkCommand(ctx, data CommandSetCanvasLinkData) error`, with
  `CommandSetCanvasLinkData{ Dir string \`json:"dir"\`; Replaces string \`json:"replaces"\`; NotReplaces []string \`json:"notreplaces"\` }`.
  It sets both fields whole (the caller computes the new values with the pure model), so there is one write path and
  the model, not the server, owns "link removes the topic from notreplaces" / "× adds it". Why: one source of truth
  for the rules, and the Go side stays a plain, guarded writer.
- **`StorageCanvas` fields:** `Title string \`json:"title,omitempty"\``, `CreatedTs int64 \`json:"createdts"\``,
  `Replaces string \`json:"replaces,omitempty"\``, `NotReplaces []string \`json:"notreplaces,omitempty"\``. The TS
  `GalleryCanvas` mirrors them as `title?: string; createdts: number; replaces?: string; notreplaces?: string[]`.
- **Server-side guards** (in `pkg/storage`, not the handler): `dir` must be a registered canvas (`canvasOf`) and a
  plain folder; a non-empty `replaces` must be a `canvasSegment`, not the canvas's own topic, an existing topic folder
  in the same design dir, and not already named in `replaces` by another canvas of that project (no forks); every
  `notreplaces` entry must be a `canvasSegment` (deduped, sorted). Empty `replaces` / `notreplaces` remove the key.
  The write is atomic (temp file in the same folder + rename) and keeps every other key as its JSON value
  (`map[string]json.RawMessage`).
- **The card stays a `<button>`.** `CanvasCard`'s `<button>` keeps `data-canvas-card` and `data-cursor`, so the
  keyboard cursor and every existing scenario (`canvas-gallery`, `canvas-gallery-maker`'s `.click()` on
  `[data-canvas-card=…]`) keep working. A new wrapper `<div data-canvas-card-wrap="<topic>">` holds that button and,
  as siblings under it, the chips, the `Newer: <topic> →` link and the suggestion row; the wrapper carries
  `data-canvas-outdated`. Why: no nested interactive elements and no selector churn. `CleanupCard` is untouched.
- **Hand-edited conflicts.** Two canvases naming the same `replaces`: the one created last keeps the link, the other's
  `replaces` is ignored (not dimmed, no chip). A cycle: the edge pointing at the canvas created last is dropped, so that
  canvas is never outdated. Equal `createdts`: the topic that sorts first is the older (now in the spec).
- **Scan state.** `localStorage` key `canvasgallery.versionsScanned` = `"1"`, read and written inside try/catch; a
  failed read counts as not scanned. The review list is a gallery view `"scan"` beside `"grid" | "viewer" | "cleanup"`.
- **The picker** is a popover anchored under `Link an older version…` in the viewer header, in its own file
  `canvaslinkpicker.tsx`. Its search placeholder is `Search <projectname>'s canvases`, its footnote
  `Only canvases in <projectname>, older than this one`, and with no candidate it says
  `No older canvas in <projectname>` (now in the spec).
- **The boards' council rows are illustrative.** `A-scan-suggest` and `C-scan-review` draw
  `council-stronger replaces council-ux`; the spec's rule says that pair never matches, and the rule wins (now noted
  in the spec).

DOM contract (Task 5 renders these, Task 6's scenario reads them):

| Attribute | On |
|---|---|
| `data-canvas-card-wrap="<topic>"` | the grid card's wrapper; `data-canvas-outdated` on it when outdated |
| `data-canvas-replaces="<old topic>"` | the card's `Replaces <topic>` chip |
| `data-canvas-newer="<newest topic>"` | the card's `Newer: <topic> →` link (a `<button>`) |
| `data-canvas-suggest="<older topic>"` | the card's dashed suggestion row; its buttons `data-canvas-suggest-link`, `data-canvas-suggest-no` |
| `data-canvas-scan-open` | the gallery header's `Scan for versions` button |
| `data-canvas-scan` | the scan review view; each row `data-canvas-scan-row="<newer topic>"` (with `data-checked` when ticked); `data-canvas-scan-link` (the `Link N pair(s)` button), `data-canvas-scan-cancel` |
| `data-canvas-viewer-replaces="<topic>"` | the viewer header chip; its × is `data-canvas-viewer-unlink` |
| `data-canvas-link-open` | the viewer header's `Link an older version…` button |
| `data-canvas-link-picker` | the picker; its search input `data-canvas-link-search`; each row `data-canvas-link-row="<topic>"` (with `data-current` on the one this canvas replaces now); the empty line `data-canvas-link-empty` |

### Task 1: The wire interface
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/storage/canvases.go`, `pkg/storage/canvaslink.go`, `pkg/wshrpc/wshrpctypes_storage.go`, `pkg/wshrpc/wshserver/wshserver_storage.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

Small and fast, so Tasks 2 and 5 can build on it. Add the four `StorageCanvas` fields (header) without reading them
yet; `CommandSetCanvasLinkData` and `SetCanvasLinkCommand` in `wshrpctypes_storage.go`; in new `canvaslink.go` the
signature `func SetCanvasLink(projects []string, dir, replaces string, notReplaces []string) error` returning
`errors.New("not implemented")`; the handler in `wshserver_storage.go` calling it with `configProjectPaths()`. Run
`task generate` and commit what it writes (never hand-edit generated files). Acceptance: `go build ./...` and
`go vet ./pkg/storage/... ./pkg/wshrpc/...` pass; `RpcApi.SetCanvasLinkCommand` and the new `StorageCanvas` fields
exist in the generated TS.

### Task 2: Read and write the link in Go
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/storage/canvases.go`, `pkg/storage/canvases_test.go`, `pkg/storage/canvaslink.go`, `pkg/storage/canvaslink_test.go`

- In `canvases.go`, turn `canvasOrder` into one parse of `canvas.json` that returns order, `title`, `createdOnFiles.at`
  (RFC 3339 → unix ms; missing or unparsable → 0), `replaces` and `notreplaces`. `ListCanvases` fills the four new
  fields; `CreatedTs` falls back to `ModTs`. `ListCanvases` stays read-only.
- Implement `SetCanvasLink` with the guards in the header. A canvas with no `canvas.json`, or one that does not parse
  as a JSON object, gets the minimal index the `arc:design` skill writes (`skills/design/SKILL.md` "The files": `v` 3,
  `createdOnFiles` at now, `title` = topic, a laid-out `boards` entry per `.dc.html` on disk, `order`), then the link.
  Errors say what was refused, in plain words.
- Tests (`go test ./pkg/storage -run 'TestListCanvases|TestSetCanvasLink'`, on Windows prefixed per AGENTS.md):
  title / createdts (from `createdOnFiles.at`, and the modts fallback) / replaces / notreplaces are read; the write
  keeps every other key (`launch`, `notes`, `boards`, an unknown key); an empty value removes its key; a missing and a
  malformed `canvas.json` get the minimal file; it refuses a dir that is not a registered canvas, a `replaces` naming
  itself, a missing topic, a bad segment, and a topic another canvas already replaces.

### Task 3: The version model (pure)
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/canvasgallery.ts`, `frontend/app/view/agents/canvasgallery.test.ts`, `frontend/app/view/agents/canvascursor.test.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/view/agents/canvasgallerystore.test.ts`

Add the four fields to `GalleryCanvas` (header); `createdts` is required, so add it to the `GalleryCanvas` literals in
`canvascursor.test.ts`, `bindings.test.ts` and `canvasgallerystore.test.ts` (nothing else in those files). Add these
exports, which Task 5 relies on by name:

- `type VersionInfo = { replaces: GalleryCanvas | null; newest: GalleryCanvas | null }` and
  `versionInfo(items: GalleryCanvas[]): Map<string, VersionInfo>` keyed by `dir`. `replaces` is the canvas this one
  validly replaces (same project, exists, conflicts resolved as in the header); `newest` is set only for an outdated
  canvas and is the head of its chain (v1 and v2 both point at v3).
- `type VersionSuggestion = { newer: GalleryCanvas; older: GalleryCanvas }` and
  `suggestVersions(items: GalleryCanvas[]): VersionSuggestion[]`: the scan rule in the spec. Older/newer by
  `createdts`, ties by topic. Prefix at a `-` boundary, or title-word overlap above a threshold you choose and
  document in a comment (lowercase words, stopwords and words under 3 letters dropped; a shared first topic word alone
  never matches). The older one must be a chain head nothing validly replaces; the newer one replaces nothing;
  `notreplaces` suppresses; at most one suggestion per newer canvas (best score) and per older canvas (no forks).
  Stable order, newest first.
- `linkCandidates(items: GalleryCanvas[], c: GalleryCanvas, query: string): { canvas: GalleryCanvas; current: boolean }[]`:
  the picker list: same project, older than `c`, not replaced by any other canvas; `c`'s current target included and
  marked `current`; filtered by `query` over topic and title; newest first.
- `type CanvasLinkWrite = { dir: string; replaces: string; notreplaces: string[] }`, and
  `linkWrite(c, oldTopic)` (sets replaces, removes `oldTopic` from notreplaces), `unlinkWrite(c)` (clears replaces,
  adds the old topic to notreplaces), `declineWrite(c, oldTopic)` (adds to notreplaces, keeps replaces),
  `scanWrites(suggestions, ticked: Set<string>)` (`ticked` holds newer dirs: a link write for each ticked, a decline
  write for each unticked), and `scanLinkLabel(n)` (`Link 1 pair` / `Link N pairs`).

Tests (`npx vitest run frontend/app/view/agents/canvasgallery.test.ts`): the outdated set; chain → newest; a cycle
broken at the last-created canvas; a missing target ignored; a fork resolved to the last-created replacer; a
`createdts` tie; `mxc-home` / `mxc-home-fresh` and `project-overview` / `project-overview-history` match;
`council-ux` / `council-stronger` (titles "Council UX" / "Council, stronger") does not; `notreplaces` suppresses; one
suggestion per canvas; a forgotten `x-v3` is suggested onto the chain head, not the old tail; the picker list
(current marked, query filter, empty); each write helper, `scanWrites` and `scanLinkLabel`. Acceptance also:
`task check:ts` clean.

### Task 4: The design skill looks before it names, and keeps the link
**Depends on:** none
**Model:** sonnet
**Files:** `skills/design/SKILL.md`, `skills/skills_test.go`

Per the spec's "The agent" section: before naming a new topic, list `.superpowers/design/*/project/canvas.json`
titles; when the new canvas redraws a screen one of them designed (and nothing else replaces that one), write
`"replaces": "<topic>"` in the new `canvas.json` at once and say one line in the reply ("this canvas replaces
<topic>"; undo with × in the gallery viewer's header). Every rewrite of `canvas.json` keeps `replaces` and
`notreplaces`. Add both keys to the documented index shape, and correct the "Arc reads only the frame, `title` and
`order`" sentence in "The files" (Arc now also reads `createdOnFiles.at`, `replaces` and `notreplaces`). Keep the
skill's voice and length discipline. Test (`go test ./skills -run TestDesignSkillVersions`): the embedded
`design/SKILL.md` mentions `replaces` and `notreplaces`, and the index example in it parses as JSON.

### Task 5: Gallery UI: chips, Outdated, suggestions, viewer link and picker, scan review
**Depends on:** Task 1 (calls `RpcApi.SetCanvasLinkCommand`), Task 3
**Model:** sonnet
**Files:** `frontend/app/view/agents/canvasgallerystore.ts`, `frontend/app/view/agents/canvasgallerystore.test.ts`, `frontend/app/view/agents/canvasgalleryview.tsx`, `frontend/app/view/agents/canvaslinkpicker.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md`

Match the three boards in the Prototype folder (their council rows are illustrative, see the header) and `DESIGN.md`
(tokens only, no raw colors). Emit the DOM contract in the header exactly.

- Store: `setCanvasLink(w: CanvasLinkWrite)` → `RpcApi.SetCanvasLinkCommand`, then `loadCanvases()`; an error shows
  an error toast with the server's message (the gallery's existing toast pattern), never swallowed.
  `versionsScanned()` / `markVersionsScanned()` over the localStorage key (try/catch). Scan view state: `startScan()`
  (all suggestions ticked), `toggleScanRow(dir)`, `cancelScan()` (writes nothing, marks scanned, back to grid),
  `linkScan()` (writes `scanWrites` one by one, marks scanned, back to grid; a failed write is reported and the rest
  still written). Picker state: open / query / close. Unit-test the scan transitions and the scanned flag (including a
  throwing localStorage) in `canvasgallerystore.test.ts`.
- Grid: the card wrapper (header). New card: `Replaces <topic>` chip under the meta line. Outdated card: preview and
  topic at ~45% opacity, an `Outdated` chip and the `Newer: <topic> →` link, which opens the newest canvas in the viewer
  (the card's button still opens the old one). Search, day groups and Clean up unchanged.
- Header: `Scan for versions` beside `Clean up`, shown only while not scanned and `suggestVersions` is non-empty.
  After the scan, a card with a suggestion shows the dashed row `Looks like it replaces <topic> · Link · No`
  (Link → `linkWrite`, No → `declineWrite`); nothing is dimmed before Link.
- Scan review (`"scan"` view): `Found N pairs. Untick the wrong ones, then Link.`, rows `<new> replaces <old>` with the
  project on the right, all ticked; Cancel and `scanLinkLabel(ticked)` (disabled at 0). Esc cancels it.
- Viewer header, after the changed line: the `Replaces <topic> ×` chip (× → `unlinkWrite`) and the
  `Link an older version…` button opening the picker (`canvaslinkpicker.tsx`, header for its texts): search field,
  rows with thumbnail, topic, board count and date from `linkCandidates`, the current one marked `linked`; picking →
  `linkWrite`, closes. Esc closes the picker first, a second Esc leaves the viewer.
- Bindings: the two Esc behaviours in `bindings.ts`, with tests in `bindings.test.ts`
  (`npx vitest run frontend/app/store/keybindings/bindings.test.ts -t canvas`); mirror any new binding in
  `docs/keyboard-shortcuts.md`.
- `CHANGELOG.md`: one line under `Added` in the top `Unreleased` section, written for the user, ending
  `<!-- try: go:canvases -->`.
- Acceptance: `task check:ts` clean; `npx vitest run frontend/app/view/agents/canvasgallery` and the bindings test
  pass; every view, state and interaction above has a `canvas-versions` step in Task 6 (listed there), and
  `canvas-gallery` and `canvas-gallery-maker` still pass.

### Task 6: The canvas-versions CDP scenario
**Depends on:** Task 5 (drives its DOM contract)
**Model:** sonnet
**Files:** `scripts/cdp/scenarios.mjs`

Add a `canvas-versions` scenario beside `canvas-gallery`, reusing its helpers (a sibling of `cgWriteTopic` that also
writes `title`, `createdOnFiles.at`, `replaces`; `cgPress`, `cgTeardown`, the project registration). Like
`canvas-gallery`, skip when the store holds other canvases; clear `canvasgallery.versionsScanned` in arrange and in
teardown. Seed, oldest first by `createdOnFiles.at`: `vs-home`, `vs-home-fresh` (replaces `vs-home`), `vs-overview`,
`vs-overview-history`, `vs-board`, `vs-board-v2`, `council-ux` ("Council UX"), `council-stronger`
("Council, stronger"). Steps, each a shot plus an assert on the DOM contract and, for writes, on the `canvas.json` on
disk:

1. Gallery (board A-viewer-header, cards): `vs-home-fresh` has `data-canvas-replaces="vs-home"`; `vs-home`'s wrap is
   `data-canvas-outdated` with `data-canvas-newer="vs-home-fresh"`; the Scan button shows; no suggestion rows.
2. Scan review open, then Esc: two rows (`vs-overview-history`, `vs-board-v2`), both ticked, no council row; Esc
   returns to the grid, writes nothing, and hides the Scan button. Clear the localStorage key and reopen the gallery:
   the button is back.
3. Scan review (board C-scan-review): untick `vs-board-v2`; the button reads `Link 1 pair` (shot). Link: on disk
   `vs-overview-history` replaces `vs-overview` and `vs-board-v2`'s notreplaces holds `vs-board`; the Scan button is
   gone; `vs-overview` is outdated; no council suggestion anywhere.
4. Suggestion rows (board A-scan-suggest; its council row is illustrative): write `vs-tour` / `vs-tour-v2`,
   `vs-list` / `vs-list-new` and `vs-gone` / `vs-gone-v2` to disk, reopen the gallery; each newer one shows
   `data-canvas-suggest` (shot). Link on `vs-tour-v2` → `replaces` on disk, chip shown. No on `vs-list-new` →
   `notreplaces` on disk, row gone, nothing dimmed. Remove the `vs-gone` folder, then Link on `vs-gone-v2` → an error
   toast, `vs-gone-v2`'s canvas.json unchanged.
5. `Newer` on `vs-home` opens `vs-home-fresh` in the viewer with `data-canvas-viewer-replaces="vs-home"`. Open the
   picker (board A-viewer-header, viewer half; shot): `vs-home` is `data-current`; type `board` in the search and only
   `vs-board*` rows remain. Esc closes the picker and the viewer stays.
6. × unlinks: `replaces` cleared and `vs-home` in `notreplaces` on disk; the chip is gone; `vs-home` no longer
   outdated.
7. Picker again: pick `vs-home` → relinked on disk and `vs-home` gone from `notreplaces`; the chip is back.

Acceptance: `node scripts/cdp/final-verify.mjs canvas-versions canvas-gallery canvas-gallery-maker` passes (or, by hand
against a dev app, `task verify:ui -- canvas-versions canvas-gallery canvas-gallery-maker`).

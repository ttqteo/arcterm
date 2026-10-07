# Code surface side column — a read-only second column beside the editor — design

Status: design settled 2026-10-07.

## Problem

The Code surface shows one file at a time (decision 5 of `2026-08-03-code-browser-surface-design.md`). Writing a
paper or a doc wants two things on screen at once: the `.tex` source beside its PDF or reading preview, or a file
beside the reference it follows. Earlier specs rejected tabs and a side-by-side split because "nothing states the
need" (`2026-08-15-code-theme-sync-and-markdown-preview-design.md`); the need is now stated, at most two columns
(1×2), opened by drag and drop.

The store is built around one open file: `codeFileAtom`, `codeViewModeAtom`, `codeHistoryAtom`, `codeSaveAtom`,
`codeHeadAtom`, `codeStaleAtom`, `codePendingLineAtom`, `codeTexPdfAtom`, the load tokens in `current`, and the
module-level caret reader in `codeviewer.tsx` all hold "the one file". Making both columns full editors would move
all of them to per-column state and touch every `code:*` binding and about fifteen open sites.

Out of scope: two editable columns, more than two columns, tabs, a vertical (2×1) split, Diff in the side column,
dragging a file between columns, and drag from places other than the Code tree.

## Decisions

1. **The main column is unchanged; the side column is read-only.** The left column keeps editing, saving,
   history, diff and every single-file atom as they are. The right column is a companion with its own small state.
   It shows another file, or the same file in another mode (`main.tex` Source left, PDF or Preview right). Editing
   happens in the main column; "Open in main" moves the side file there.
2. **Side state is one atom.** `codeSideAtom: { rel: string; mode: SideMode } | null` in a new
   `frontend/app/view/code/codeside.ts`, with `SideMode = "preview" | "source" | "pdf"`. Reset to null on project
   switch (`selectProject`). The split ratio is a localStorage pref like the sidebar width (`codesidebar.ts`),
   clamped so each column keeps at least 320 px.
3. **Modes come from the same rules as the main column.** The side toggle lists
   `viewModesFor(path, hasPdf)` without `diff`, resolved with `resolveViewMode`. A `.pdf` shows the viewer and no
   toggle. The default mode on open: `pdf` for a `.tex` with a built PDF, else `preview` for `.tex`/`.md`, else
   `source`. The side column does its own `DocPdfFindCommand` lookup.
4. **It reuses the File tab's read-only viewer, not the Code store.** Text is read with `readPanelFile`
   (`filetabload.ts`). Source is a read-only `MonacoCodeEditor` on the model path `side/<abs>` (distinct from the main
   editor's `<blockId>/<abs>` and the diff's `code/<rel>`, so the same file in both columns never shares or collides on
   a model), with `languageForPath` and the shared wrap (`useWrap`). Preview is `TexPreview` for `.tex` and the
   `Markdown` document view for `.md`. PDF is `PdfFrame`.
5. **It follows the file.** When the side shows the main column's file, it renders the main column's draft text
   (`codeDraftsAtom`) when there is one, so Preview and Source follow typing. Otherwise it re-reads the file once a
   second while visible, using `readPanelFile`'s size-and-modtime stamp so an unchanged file is not re-read. The PDF
   mode re-runs the lookup on the same tick and reloads the frame when `modtime` changes.
6. **Opening.**
   - **Drag from the tree.** Tree rows for files are `draggable` with the MIME `application/x-arc-code-path` (the
     project-relative path). From the row's dragstart to its dragend an overlay splits the editor area into two
     halves, left "Open", right "Open to the side" — shown at dragstart, not on dragover, because a PDF frame under
     the pointer swallows dragover. Folders are not draggable. The drag carries no `Files` type, so the OS-file drop
     handling (`isFileDrag`) never sees it.
   - **Tree context menu:** "Open to the side".
   - **`Ctrl+\`** (`code:side`, live while typing, like `code:save`): with no side column, opens the main column's
     file to the side in its default mode; with one, closes it.
   - Opening a file to the side while one is shown replaces it: at most two columns.
7. **Layout.** The editor area becomes a row: the main column (`CodePathBar`, `CodeStaleBar`, `CodeViewer`), a
   hand-rolled `col-resize` handle (the sidebar handle's pattern), and the side column (its own bar: path, mode toggle,
   "Open in main", ×). Under 900 px of editor width the side column hides and a chip in the path bar ("Side: main.pdf")
   opens its file in the main column instead; widening the window shows the column again.
8. **A .tex file with nothing to preview opens on Source.** A generated macros file (`numbers.tex`) has no title,
   heading or prose, so Preview would be blank: `viewModesFor`/`resolveViewMode` take a `previewable` flag
   (`codepreviewable.ts`, from `texHasProse`), and such a file offers no Preview in either column.
9. **Bindings stay on the main column.** `code:save`, `code:diff`, back/forward and `code:wrap` act on the main
   column as today. `code:wrap` toggles the per-path wrap, which the side column also reads, so it applies to both
   views of one file.

## Changes

- `frontend/app/view/code/codeside.ts` (new) — `codeSideAtom`, `SideMode`, `openSide(rel, mode?)`, `closeSide()`,
  `toggleSide()`, `defaultSideMode(path, hasPdf)`, ratio pref helpers; tests in `codeside.test.ts` for the pure
  parts (default mode, mode resolution without diff, ratio clamping).
- `frontend/app/view/code/codesidepane.tsx` (new) — the side column: bar, read loop, Source/Preview/PDF bodies.
- `frontend/app/view/code/codesurface.tsx` — the editor-area row, the resize handle, the narrow-width fallback, the
  drop overlay.
- `frontend/app/view/code/codetreepane.tsx` — draggable file rows, "Open to the side" in the context menu.
- `frontend/app/view/code/codepathbar.tsx` — the hidden-side chip.
- `frontend/app/view/code/codestore.ts` — `selectProject` resets `codeSideAtom`.
- `frontend/app/view/code/codeeditorarea.tsx` (new) — the editor-area row, the resize handle, the drop overlay.
- `frontend/app/view/code/codepreviewable.ts` (new), `frontend/app/view/agents/docprose.ts` `texHasProse`.
- `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md` — `Ctrl+\`.
- `CHANGELOG.md` — one `Added` line.

## Verification

- vitest: `defaultSideMode`, side modes for `.tex` with and without a PDF, `.md`, `.go`, a macros-only `.tex`; ratio
  clamping; `texHasProse`.
- CDP scenario `code-side-column`: open `main.tex`, `Ctrl+\` opens the side column in PDF mode; switch the side to
  Preview and type in the main column — the side preview follows the draft; drag `paper.pdf` from the tree onto the
  right half (synthetic `DragEvent`s with a `DataTransfer`) — the side shows the PDF; ×closes it; the ratio survives a
  surface switch.

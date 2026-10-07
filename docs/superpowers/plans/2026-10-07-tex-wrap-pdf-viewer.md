# LaTeX highlighting, reading preview, word wrap and PDF viewing — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `.tex`/`.bib` highlight, a Wrap toggle, `.pdf` files open in a viewer, and `.tex` gets a read-only
Preview and a PDF mode (built PDF only, no compile) on the Code surface; the rail File tab gets the same
highlighting, wrap and PDF viewing.

**Spec:** `docs/superpowers/specs/2026-10-07-tex-wrap-pdf-viewer-design.md`.

**Architecture:** pure decisions in `frontend/app/view/code/codeclassify.ts` (file class, language, wrap
default, view modes) with vitest beside them; a Monarch grammar module registered in `loadMonaco`; one
shared `PdfFrame` over `/wave/stream-file`; one Go lookup `doccompile.FindPdf` behind a new
`DocPdfFindCommand`; the `.tex` Preview reuses Doc review's `toProse` + `ProseTokens`.

**Tech stack:** React 19, jotai, Monaco 0.55 (Monarch), KaTeX, Go (wshrpc), vitest, CDP scenarios.

**Rules for this repo:** work on `main`; commit locally, never push, no Co-Authored-By trailer; no app
builds (`task dev` HMR + targeted checks only); never hand-edit generated files — run `task generate`;
`task check:ts` needs a >2 min timeout; prettier/eslint only on touched paths.

---

### Task 1: Pure decisions in `codeclassify.ts`

**Files:** modify `frontend/app/view/code/codeclassify.ts`, `frontend/app/view/code/codeclassify.test.ts`.

Add, test-first:

- `FileClass` gains `"pdf"`. `classifyFile(size, mime)` returns `"pdf"` for `application/pdf` **before** the
  size gate. `application/x-latex` and `application/x-tex` join `TEXTISH_MIME`.
- `languageForPath(path): string | undefined` — `latex` for `.tex .sty .cls .ltx .latex`, `bibtex` for
  `.bib`, else `undefined` (Monaco infers from the extension).
- `isTexPath(path)` — `.tex` only (the files that get Preview and PDF modes).
- `defaultWrap(path, setting: boolean | undefined): boolean` — true for `.tex .bib .md .markdown .txt`,
  else `setting ?? false`.
- `type ViewMode = "preview" | "source" | "diff" | "pdf"`; `viewModesFor(path, hasPdf)` →
  markdown `[preview, source, diff]`; `.tex` `[preview, source, diff]` plus `pdf` when `hasPdf`; any other
  text `[source, diff]`.
- `resolveViewMode(path, mode, hasPdf)` — `mode` if offered, else `preview` if offered, else `source`.
  (The mode atom is global across files: a `pdf` chosen on a `.tex` must read as `source` on a `.go`.)
- `lineAtOffset(text, offset)` — 1-based line of a character offset (for double-click → source).

Run `npx vitest run frontend/app/view/code/codeclassify.test.ts` → fail, implement, → pass. Commit.

### Task 2: LaTeX and BibTeX grammars

**Files:** create `frontend/app/monaco/latexlang.ts`; modify `frontend/app/monaco/monaco-env.ts`.

- `latexLanguage: languages.IMonarchLanguage` with states `root`, `math` (`$`, `$$`, `\(`, `\[` until the
  matching close), and an `envname` rule for `\begin{…}`/`\end{…}`. Tokens: `comment` (`%…`), `keyword`
  (`\name`, `\@name`, `\\`, `\,`), `type` (env name and `\section`-family titles' macro), `variable` (the
  `{key}` after `\cite* \ref \eqref \autoref \cref \label \input \include \usepackage \documentclass`),
  `string` (math body), `delimiter.bracket` (`{}[]`), `operator` (`& ~ ^ _ #`).
- `bibtexLanguage`: `@type` → `keyword`, `{key,` → `variable`, `field =` → `type`, braced/quoted values →
  `string`, digits → `number`, `%` → `comment`.
- `registerLatexLanguages(monaco)` registers `latex` with extensions `.tex .sty .ltx .latex` and `bibtex` with
  `.bib`, sets the Monarch providers and a language configuration (comments `%`, brackets, auto-closing
  `{}`/`[]`/`$`). Idempotent. Called from `loadMonaco()`.
- Verified in the CDP scenario (Task 8): Monaco emits distinct `mtk*` classes for a `\section` line.

Commit.

### Task 3: Language and wrap through every Monaco view

**Files:** `frontend/app/view/code/codestore.ts`, `frontend/app/view/codeeditor/codeeditor.tsx`,
`frontend/app/view/code/codeviewer.tsx`, `frontend/app/view/code/codediffview.tsx`,
`frontend/app/view/code/codepathbar.tsx`, `frontend/app/view/agents/filetab.tsx`,
`frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`.

- `codestore.ts`: `codeWrapAtom: PrimitiveAtom<Map<string, boolean>>` (abs path → user choice) and
  `toggleWrap(abs, effective)`; reset on project switch is not needed (keyed by absolute path).
- A small hook `useWrap(abs, blockId)` (in `codepathbar.tsx`'s neighbour or a new `codewrap.ts`) →
  `codeWrapAtom.get(abs) ?? defaultWrap(abs, useOverrideConfigAtom(blockId, "editor:wordwrap"))`.
- `CodeEditor` gains an optional `wordWrap?: boolean` prop that overrides the setting when defined.
- `codeviewer.tsx` passes `language={languageForPath(file.path)}` and `wordWrap`; `CodeDiffView` passes
  `language` and `wordWrap: "on" | "off"` into its diff options.
- `codepathbar.tsx`: a **Wrap** toggle (`data-code-wrap`, `aria-pressed`) for text files.
- `bindings.ts`: `code:wrap` on `Alt:z`, `when: ctx.surface === "code" && !ctx.modalOpen` (live while typing
  in Monaco, like `code:save`). `docs/keyboard-shortcuts.md` gets the row.
- `filetab.tsx`: `language={languageForPath(ref.abs)}` and `wordWrap` from the same atom + default; a Wrap
  button (`data-file-wrap`) in the header for text files.

`task check:ts` (timeout 300 s). Commit.

### Task 4: `doccompile.FindPdf` and `DocPdfFindCommand`

**Files:** `pkg/doccompile/doccompile.go`, `pkg/doccompile/doccompile_test.go`,
`pkg/wshrpc/wshrpctypes_doc.go`, `pkg/wshrpc/wshserver/wshserver_doc.go`; then `task generate`.

- `type PdfFound struct { RootPath, PdfPath, Source string; ModTime int64 }` (`Source`: `"compiled"` |
  `"sibling"` | `""`).
- `FindPdf(path string) (*PdfFound, error)`: `FindTexRoot`; no root → empty; `OutDir(root)/<base>.pdf` if it
  is a file → compiled; else `<root dir>/<base>.pdf` → sibling; else empty with `RootPath` set. `ModTime` in
  ms.
- Tests (sandbox + `dataDir` override as the existing tests do): compiled wins over sibling; sibling only;
  neither; a chapter with `% !TEX root` resolves to the root's PDF; a non-`.tex` path errors.
- RPC: `DocPdfFindCommand(ctx, CommandDocPdfFindData{Path}) (*CommandDocPdfFindRtnData, error)` with
  `rootpath`, `pdfpath`, `source`, `modtime`.
- `go test ./pkg/doccompile/`, `task generate`, `go build ./pkg/... ./cmd/...`. Commit.

### Task 5: Shared `PdfFrame`; PDFs open on Code and in the File tab

**Files:** create `frontend/app/view/agents/pdfframe.tsx`; modify `docpdfpane.tsx`,
`frontend/app/view/code/codestore.ts`, `codeviewer.tsx`, `codepathbar.tsx`,
`frontend/app/view/agents/filetabload.ts`, `filetab.tsx`.

- `PdfFrame({ path, version, title, dataAttr? })` — the iframe on `streamFileUrl(path, version)` with
  `min-h-0 w-full flex-1 border-0`; `docpdfpane.tsx` uses it (keeps `data-doc-review-pdf-frame`).
- `CodeFile` gains `{ kind: "pdf"; path; size; modtime }`; `openPath` sets it from `classifyFile` without
  reading bytes. `CodeViewer` renders `<PdfFrame>` (`data-code-pdf`); the path bar shows no modes and no
  Wrap for it.
- `PanelFile` gains `{ kind: "pdf"; size; stamp }`; the File tab renders `PdfFrame` (`data-file-pdf`).

`task check:ts`. Commit.

### Task 6: `.tex` PDF mode

**Files:** `codestore.ts`, `codepathbar.tsx`, `codeviewer.tsx`, `bindings.ts` (the `d` toggle), 
`frontend/app/cockpit/openfilestore.ts` (type only).

- `codeViewModeAtom` becomes `PrimitiveAtom<ViewMode>`.
- `codeTexPdfAtom: PrimitiveAtom<{ path: string; found: CommandDocPdfFindRtnData | null } | null>`;
  `openPath` for a `.tex` (after the text lands) and choosing the PDF mode call `refreshTexPdf(abs, rel)`
  (`DocPdfFindCommand`; errors → null). Token-guarded like the file read.
- `ViewModeToggle` takes its list from `viewModesFor(path, hasPdf)` and highlights
  `resolveViewMode(...)`; the viewer switches on the resolved mode.
- PDF mode: `PdfFrame` on `found.pdfpath` with `version = modtime`, and a footer line
  `main.pdf · built 2h ago · from main.tex` (`· Doc review build` when `source === "compiled"`), relative
  time from the existing helper the cockpit uses (search `timeAgo`/`relativeTime` in `frontend/util`).

`task check:ts`. Commit.

### Task 7: `.tex` Preview

**Files:** create `frontend/app/view/code/texpreview.tsx`; modify `frontend/app/view/agents/docprose.ts`,
`docprose.test.ts`, `prosetokens.tsx`, `docreviewpane.tsx`, `codeviewer.tsx`.

- `texAuthors(src): string[]` in `docprose.ts` (test-first): every `\author{…}` (ACM: one per person) split
  on `\and`; `\thanks{…}`, `\affiliation{…}`, `\email{…}`, `\orcid{…}`, `\inst{…}` and `\\` dropped; plain
  text via `texPlain`; empty names removed.
- Move `import "katex/dist/katex.min.css"` from `docreviewpane.tsx` into `prosetokens.tsx`.
- `TexPreview({ path, text, onSource(line) })`: `toProse("latex", text)` memoised; a centred title block
  (section 0's title when it is not "Front matter", authors joined by ` · `); each section an `h2`/`h3` with
  its `§` label; paragraphs in the Doc review prose style (`text-[15px] leading-[1.75] text-secondary`,
  reading column `max-w-[760px] mx-auto`); sentences as `<span data-tex-s>` rendering `ProseTokens` with
  `op: "same"`; double-click → `onSource(lineAtOffset(text, sentence.source.start))`. Root:
  `data-tex-preview`.
- `codeviewer.tsx`: for `.tex` in resolved `preview`, render `TexPreview` with the draft text;
  `onSource(line)` sets `codePendingLineAtom` then `codeViewModeAtom = "source"`. The pending-line effect
  consumes a line for a `.tex` preview too, as it does for markdown.

`npx vitest run frontend/app/view/agents/docprose.test.ts`, `task check:ts`. Commit.

### Task 8: CDP scenario, CHANGELOG

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`.

- Scenario `code-tex-pdf` (surface `code`): arrange writes a temp dir with `main.tex` (title, two authors,
  a `\section`, a `\cite`, inline math, a long line) and a minimal valid `main.pdf`, plus `paper.pdf`;
  `eventpublish` `openfile` for `main.tex`. Steps: Preview default (`[data-tex-preview]`, title, a cite, a
  `.katex`); double-click a sentence → `.monaco-editor` and mode `source`; distinct `mtk` classes on the
  `\section` line; Wrap pressed by default, `Alt+Z` unpresses it; PDF mode present → `[data-code-pdf]`
  iframe and the footer; open `paper.pdf` → `[data-code-pdf]`, no "Binary file". Screens to
  `cdp-shots/code-tex-*.png`. Teardown removes the dir and returns to the cockpit.
- `CHANGELOG.md` `Added`: LaTeX highlighting, a `.tex` reading preview, a Wrap toggle and PDF viewing on Code
  and in the File tab.
- Run against the running dev app only if one is up (`task verify:ui -- code-tex-pdf`); no build otherwise.
  Commit.

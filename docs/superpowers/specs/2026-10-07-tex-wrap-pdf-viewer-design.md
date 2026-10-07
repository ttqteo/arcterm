# LaTeX highlighting, reading preview, word wrap and PDF viewing on the Code surface — design

Status: design settled 2026-10-07.

## Problem

A paper repo (`paper/<venue>/main.tex`, `base.bib`, a compiled `main.pdf`) reads badly on the Code
surface and the agent rail's File tab:

- `.tex`, `.sty`, `.cls` and `.bib` show as plain text. Monaco ships no LaTeX or BibTeX language and the
  frontend registers none.
- Prose lines run off the right edge. `editor:wordwrap` exists, but only as a setting with no toggle, and
  only the Code surface editor reads it: the File tab has fixed options and the diff viewer ignores it.
- A `.pdf` opens to a dead-end "Binary file" panel, although Doc review already shows compiled PDFs
  through WebView2's own viewer.
- A paper can only be read as source. Markdown opens as a rendered document (the `preview` mode), but
  `.tex` has no reading view on the Code surface, although Doc review already turns `.tex` into prose
  (`docprose.ts`) and draws it with chips and KaTeX math (`prosetokens.tsx`).

Out of scope: compiling from the Code surface (a later round; `pkg/doccompile` already compiles for Doc
review with latexmk, else tectonic), bundling a TeX engine, an in-app or WASM LaTeX, pdf.js, SyncTeX,
side-by-side source and PDF, auto-refresh while the source is edited, and an editable visual mode like
Overleaf's Visual Editor (deferred, see decision 10).

## Decisions

1. **No bundled or self-written compiler.** The user's TeX install is the engine. Shipping tectonic still
   pulls hundreds of MB of packages on first run, TeX Live/MiKTeX are GBs, and WASM LaTeX is slow and
   breaks on classes such as `acmart`. Doc review's `noengine` state already tells the user what to install.
2. **Highlighting is a Monarch tokenizer, not a plugin.** `frontend/app/monaco/latexlang.ts` defines and
   registers two languages once at Monaco init:
   - `latex` for `.tex .sty .ltx .latex`. Tokens: commands `\foo`, `%` comments, math `$…$` `$$…$$`
     `\(…\)` `\[…\]`, `\begin{env}` / `\end{env}` with the environment name, the key argument of
     `\cite \ref \eqref \label \input \include \usepackage`, braces/brackets, and the special characters
     `& ~ ^ _ #`.
   - `bibtex` for `.bib`. Tokens: `@type{key,`, `field =`, braced and quoted values, numbers, `%` comments.
   Token names are the standard ones (`keyword`, `comment`, `string`, `number`, `variable`, `type`,
   `delimiter`) so every arcterm theme colors them without new tokens.
3. **`.cls` is set explicitly.** The backend maps `.cls` to `text/x-apex` and Monaco's Apex language claims
   the `.cls` extension, so extension inference is ambiguous. A pure `languageForPath(path)` returns
   `latex` / `bibtex` for the LaTeX family (including `.cls`) and `undefined` otherwise; the Code surface
   editor, the File tab and the diff viewer pass it as `language` and keep inferring for everything else.
4. **`.latex` stops being binary.** `application/x-latex` joins `TEXTISH_MIME` in `codeclassify.ts`.
5. **Wrap defaults by kind and toggles per file.** A pure `defaultWrap(path, setting)` in
   `codeclassify.ts` returns on for prose (`.tex .bib .md .markdown .txt`) and `setting` (the
   `editor:wordwrap` value) otherwise. A user toggle is kept per absolute path in a jotai atom so it
   survives surface switches; the effective value is the toggle if set, else the default.
6. **One toggle, three viewers.** A **Wrap** button in the Code surface path bar and `Alt+Z` (as in VS
   Code), defined in `bindings.ts` with the Code surface bindings and listed in
   `docs/keyboard-shortcuts.md`. The Code surface editor, the File tab and the diff viewer (`wordWrap` on
   the diff editor options) all read the effective value. The File tab gets the same button in its header.
7. **PDF is its own file class.** `classifyFile` returns `"pdf"` for `application/pdf`, before the 2 MB
   gate: the file is streamed with Range support by `/wave/stream-file`, never read as base64, so size does
   not matter. The store skips `FileReadCommand` for it.
8. **One shared `PdfFrame`.** The iframe in `docpdfpane.tsx` moves to a shared `PdfFrame({ path, version,
   title })` built on `streamFileUrl`. Doc review, the Code surface (in place of the binary panel) and the
   File tab use it. The viewer stays WebView2's built-in one (scroll, zoom, find). A PDF shows no Wrap
   button and no view modes, only Copy path.
9. **`.tex` gets a `PDF` view mode only when a built PDF exists, and never compiles.** A new RPC
   `DocPdfFindCommand({ path })` in `wshrpctypes_doc.go` returns `{ rootpath, pdfpath, source, mtime }`:
   - `FindTexRoot(path)`; no root → empty result.
   - `OutDir(root)/<root base>.pdf` if it exists → `source: "compiled"` (a Doc review build).
   - else `<root dir>/<root base>.pdf` → `source: "sibling"`.
   - else empty.
   `codeViewModeAtom` gains `"pdf"`. A pure `viewModesFor(path, hasPdf)` decides the toggle: `preview`
   for markdown and `.tex`, `source` and `diff` for any text file, `pdf` for `.tex` with a found PDF. A
   `.tex` file's modes are therefore Preview · Source · Diff · PDF. The PDF view
   has a one-line footer — `main.pdf · built 2h ago · from main.tex` (plus `· Doc review build` for
   `compiled`) — because it may be older than the source. `mtime` is the cache-busting `version`. The
   lookup runs when a `.tex` opens and again when the PDF mode is chosen.
10. **`.tex` gets a read-only Preview, the default mode as for markdown.** It reuses Doc review's reader
    rather than a new one: `toProse("latex", text)` gives sections → paragraphs → sentences of tokens, and
    `ProseTokens` draws `em`/`strong`, `ref`/`cite` chips, links and math through KaTeX (`MathToken`). The
    view is a new `TexPreview` beside the markdown preview in `codeviewer.tsx`:
    - **Title block.** `\title{…}` (already extracted by `texSections`) and `\author{…}`, split on `\and`
      with `\thanks`, `\affiliation` and `\email` dropped, render centred above the body. The author
      extraction is a pure helper in `docprose.ts` with tests. No title → no block.
    - **Headings** use the section level and the `§3.2` numbering `texSections` already computes.
    - **Double-click a sentence → Source at its line.** Each sentence carries `source.start`, its offset in
      the file; the view converts it to a line and switches to `source` with the editor revealing that line
      (the same reveal path `openInCode` uses for `line`).
    - The preview reads the draft text when there are unsaved edits, as the markdown preview does.
    - Out of scope for it: following `\input`/`\include` (a chapter file previews on its own), figures and
      tables beyond the placeholder token Doc review already draws, the bibliography, and editing.

    An editable Overleaf-style visual mode is deferred (`docs/deferred.md`, 2026-10-07): Monaco can tint
    and inject text but cannot replace a range with a widget, so it would need CodeMirror 6 beside Monaco
    and Overleaf-scale work on cursor movement through widgets, undo and paste.

## Changes

- `frontend/app/monaco/latexlang.ts` (new) — Monarch definitions and `registerLatexLanguages(monaco)`;
  called once where Monaco is initialised (`monaco-react.tsx` / `monaco-env.ts`).
- `frontend/app/view/code/codeclassify.ts` — `"pdf"` class, `application/x-latex`, `languageForPath`,
  `defaultWrap`, `viewModesFor`; tests in `codeclassify.test.ts`.
- `frontend/app/view/code/codestore.ts` — `"pdf"` in `codeViewModeAtom`, per-path wrap atom, no byte read
  for PDFs, PDF lookup for `.tex`.
- `frontend/app/view/code/codepathbar.tsx` — Wrap button, mode list from `viewModesFor`.
- `frontend/app/view/code/codeviewer.tsx`, `frontend/app/view/codeeditor/codeeditor.tsx` — pass
  `language` and the effective wrap; render `PdfFrame` for PDFs and the PDF mode, `TexPreview` for the
  `.tex` preview mode.
- `frontend/app/view/code/texpreview.tsx` (new) — title block, headings, paragraphs through
  `ProseTokens`, double-click to source.
- `frontend/app/view/agents/docprose.ts` — `texAuthors(text)`; tests in `docprose.test.ts`.
- `frontend/app/view/agents/prosetokens.tsx` — import `katex/dist/katex.min.css` here (today only
  `docreviewpane.tsx` does) so any view that renders math gets the styles.
- `frontend/app/view/agents/filetab.tsx`, `filetabload.ts` — same for the File tab.
- `frontend/app/monaco/monaco-react.tsx` — `wordWrap` and `language` on the diff viewer.
- `frontend/app/view/agents/pdfframe.tsx` (new), `docpdfpane.tsx` — the shared frame.
- `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md` — `Alt+Z`.
- `pkg/doccompile/doccompile.go` — `FindPdf(path)`; tests for compiled, sibling, none.
- `pkg/wshrpc/wshrpctypes_doc.go`, `pkg/wshrpc/wshserver/wshserver_doc.go` — `DocPdfFindCommand`; then
  `task generate`.
- `CHANGELOG.md` — one `Added` line under Unreleased.

## Verification

- vitest: `classifyFile` (pdf before the size gate, `.latex`), `languageForPath` (`.cls`), `defaultWrap`,
  `viewModesFor` (`.tex` with and without a PDF), `texAuthors` (`\and`, `\thanks`, ACM's one `\author`
  per person), and the sentence offset → line conversion.
- Go: `FindPdf` with a compiled PDF, with only a sibling PDF, with neither, and for a non-root chapter
  file that resolves to its root.
- CDP scenario `code-tex-pdf`: open a fixture `.tex` (Preview by default, with the title block, a cite chip
  and KaTeX math), double-click a sentence (Source at that line), check highlighted tokens and wrap on,
  toggle `Alt+Z`, open a fixture `.pdf` (iframe present, no binary panel), and the `.tex` PDF mode with its
  footer.

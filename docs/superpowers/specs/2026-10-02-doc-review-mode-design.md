# Doc review mode — reviewing an agent's prose edits on the Agent surface — design

Status: design settled 2026-10-02.

## Problem

Arc reviews code well and prose badly. A researcher whose main repo is a thesis (LaTeX papers under
`paper/<venue>/main.tex`, a thesis under `paper/thesis/`, seminar notes as linked `.md` files) has
agents rewrite sections and notes, and then has to leave Arc to judge the result:

- The Code surface classifies PDF and images as binary and shows `.tex` as raw source, so there is no
  way to see the compiled paper, its page count, or a figure.
- The Diff surface diffs by line. A rewritten paragraph is one changed line, so the change in an
  argument is unreadable.
- Feedback is one free-text note (the `Spec review` dialog). Pointing at "the second sentence of §3.2"
  means describing it in words.

The existing pieces are close: the `Spec review` / `Plan review` asks open a review dialog
(`docreview.ts`, `docreviewdialog.tsx`) with Approve / Request changes, and canvas mode swaps the
terminal for a review view and sends marks back to the agent. This spec extends that model to `.tex`
and `.md` documents.

Out of scope: a review the user starts on their own (no ask), choosing which agent receives it, a review
spanning several files, following `\input`/`\include`, moving `Spec review` / `Plan review` onto the new
view, Obsidian-specific syntax (wikilinks, `![[…]]` embeds, callouts — the notes are read as plain
linked markdown), SyncTeX, comments placed on the PDF, and keeping review state across an Arc restart.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The agent starts the review. It asks with the header `Doc review`; Arc renders the review. | Chosen by the user: the agent knows when a unit is done; the user approves or refines. |
| 2 | One header for every document; the kind comes from the extension (`.tex` or `.md`). | The agent shouldn't have to pick between "Paper review" and "Note review". |
| 3 | The review replaces the terminal on the Agent surface (canvas-mode swap), not a modal dialog and not a new surface. | A paper needs reading room; the review belongs to the agent that wrote it; a ninth surface would duplicate the "waiting on you" lists the tree and Cockpit already have. |
| 4 | Two tabs: **Changes** (default) and **PDF** (`.tex` only). | Chosen by the user. The decision in a review is whether the prose is right, so Changes leads; PDF is for layout and page count. |
| 5 | Changes is a sentence-level prose diff of a reading view, not a line diff of source. | A rewritten paragraph diffs as one line. |
| 6 | Feedback is comments anchored to a selection (Google Docs style), sent as one structured answer. | Chosen by the user over one free note and over per-hunk accept/reject. |
| 7 | Baseline: the first review of a file diffs against the file at the agent session's start ref; each later review diffs against the content shown in the previous review. | After Request changes, the next round should show only what the agent did with the comments. The thesis repo commits "sync history" constantly, so HEAD is a poor baseline. |
| 8 | Comments quote **source** text, not rendered text. | The agent searches the file for the quote; `\emph{XYZ}` is in the file, "*XYZ*" is not. |
| 9 | PDF compiles into Arc's data dir, never into the repo. | Leaves the repo's own `compile/` folder alone and doesn't fight an agent's build over `.aux` files. |
| 10 | When to ask is a convention in a new Arc skill, `doc-review`, which a repo's `AGENTS.md`/`CLAUDE.md` may override. | Chosen by the user over "only when told" and over a Stop hook that would open a review for every trivial edit. |
| 11 | Review state is session-only, per agent, in memory. | Same as canvas mode. |

## The ask

```
header:   Doc review
question: D:\projects\my-project\paper\venue2027\main.tex
          Rewrote §3.2 around XYZ determinism.
          Pages: 8
          - §3.2 Method overview: rewritten
          - §5.1: numbers aligned with number_audit.md
options:  Approve | Request changes
```

- Line 1 is the absolute path of one `.tex` or `.md` file.
- An optional `Pages: N` line sets the page limit the PDF tab warns past.
- The other non-`- ` lines are the intro; each `- ` line is a focus item.
- Options follow the existing rule: the one starting `Request changes` is the request; the other is
  approve.

`parseDocReview` gains the `doc` header (`DOC_REVIEW_HEADERS.doc = "Doc review"`), `.tex` →
`"latex"` in `DOC_PATH`, and `pageLimit?: number`. `Spec review` and `Plan review` parsing does not
change, and they keep the dialog. A `Doc review` ask never opens the dialog.

### The answer

Approve sends the approve option as today. Request changes sends free text (the path
`setAnswerText` + `submitAnswer` already takes), built by `proseanchor.formatRequest`:

```
Request changes
1. [§3.2 ¶2] "XYZ replaces the payload initialization…"
   → Say why this de-confounds success rate.
2. [§5.1 ¶1] "17/29 benchmarks…"
   → This disagrees with Table 3.
General: §3 still reads like a tutorial.
```

A quote is the source text of the sentences the selection covers, cut to 160 characters with `…`.
`General:` appears only when the general note is non-empty. A request with no anchored comment and no
general note can't be sent.

## The `doc-review` skill

`skills/doc-review/SKILL.md`, embedded by `skills/skills.go` and projected into every harness like the
existing skills. It tells the agent:

1. Ask for a review after finishing a meaningful unit: by default one paper section or one note. A
   repo's agent instructions may redefine the unit ("one review per chapter", "only when the whole
   paper is done").
2. The ask format above, with the harness's ask tool (`AskUserQuestion` for Claude). One file per ask;
   several files are several asks in turn.
3. After asking, stop. Don't edit that file while the ask is open.
4. On Request changes: handle each numbered comment (find the quote in the file), then ask a new
   `Doc review` of the same file whose `- ` lines say what was done for each comment, by number.
5. On Approve: carry on.

## The review view

### Opening

Uses the `shouldAutoOpen` rule the spec dialog uses: if the user is on the Agent surface focused on
that agent, the view switches to review on its own. Otherwise Arc doesn't pull the user anywhere. The
agent shows as asking in the tree and in Cockpit, and opening it shows the review.

### State (`docreviewstore.ts`)

`docReviewStateAtom(agentId)` (jotai `atomFamily`) holds `DocReviewState | null`:

```ts
type DocReviewState = {
    askId: string;
    mode: "terminal" | "review";
    tab: "changes" | "pdf";
    wholeFile: boolean;          // Changes shows every section, not only changed ones
    comments: ProseComment[];
    generalNote: string;
};
```

A new `askId` resets `comments`, `generalNote`, `tab` and `wholeFile`. Shown content is kept apart in
`shownContentAtom(agentId)`: `Map<absPath, string>`, the content the last review of that file
displayed (decision 7).

### Layout

The agent tree and the agent header stay. The area the xterm occupies becomes:

- **Toolbar:** the file name and its folder; the `Changes | PDF` segmented control (`element/segmented.tsx`);
  the comment count; `Terminal`, `Approve`, `Request changes (n)`.
- **Head:** the intro and the focus items as chips; a chip scrolls to the section whose heading it
  names (matched by the `§` label or heading text; no match → the chip is inert).
- **Body:** the prose view. Changed sections only, or the whole file with `wholeFile`.
- **Comment column** to the right, each comment level with the paragraph it anchors to. Below
  `COMMENT_COLUMN_MIN_PANE` (720 px) the comments render under their paragraph instead.

The xterm stays mounted and hidden (the canvas-mode rule: it must never remount). Focus moves into the
review on entering it, and back to the terminal on leaving, as `agentsurface.tsx` does for canvas mode.

Colours are `@theme` tokens only: insertions and deletions use the existing diff tokens; comment
anchors use accent. A `design-local` mockup comes before the UI is built (DESIGN.md), and where it
disagrees with this section on a look, the mockup wins.

### Keys

In `buildAgentBindings`, active only while a `Doc review` ask is open, each with exclusive `when()`s
so footer chips keep static labels (canvas-mode decision 12): `v` review ↔ terminal, `[` / `]`
previous / next tab, `Ctrl+Enter` send Request changes. `docs/keyboard-shortcuts.md` mirrors them.

## Prose model (pure, each with a `.test.ts`)

### `docprose.ts` — source → reading view

`toProse(kind, text)` → `ProseDoc = { sections: ProseSection[] }`; a section is
`{ level, title, label, paragraphs: ProseParagraph[] }`; a paragraph is `{ sentences: ProseSentence[] }`;
a sentence is `{ html, source: { start, end } }` (offsets into the source text).

**`.tex`** (a reading view, not a LaTeX renderer):
- Sections from `\section`, `\subsection`, `\subsubsection`, `\paragraph` (starred too). Text before
  the first heading is a section titled by `\title` or "Front matter". `label` is `§3.2`-style, counted.
- Paragraphs split on blank lines. Sentences split on `.`, `?`, `!` followed by whitespace and an
  uppercase letter or `\`, not after a common abbreviation (`e.g.`, `i.e.`, `et al.`, `Fig.`, `Eq.`,
  `Sec.`, `vs.`) and not inside math.
- `%` comments are dropped (not `\%`). `\emph`/`\textit` → italic, `\textbf` → bold, `\texttt` →
  code. `\cite{a,b}` → `[a, b]`, `\ref{x}`/`\autoref{x}` → `[x]`, `\label` removed. `$…$`, `\(…\)`,
  `\[…\]`, `equation`/`align` render with KaTeX. `figure`/`table` become one placeholder sentence
  `[Figure: <caption>]`. Any other macro keeps its last braced argument's text.

**`.md`:** headings are sections; paragraphs and list items are paragraphs; sentences split as above
outside code spans and blocks. Each sentence renders through the app's markdown pipeline. Relative
links to `.md` files open through `openref` (Code surface); `#anchors` scroll in place; images resolve
relative to the file through the existing `resolveOpts` → `/wave/stream-file` path.

### `prosediff.ts` — sentence-level diff

`diffProse(before, after)` → sections with `status: same | changed | added | removed`, and per
paragraph a list of `{ op: same | insert | delete | modify, before?, after?, words? }`.

- Sections pair by normalized title, then by order. Paragraphs pair by order within a paired section,
  then by best sentence overlap.
- Sentences diff by LCS on normalized text (whitespace collapsed).
- A delete and insert at the same place whose word-level similarity is ≥ 0.6 become one `modify` with
  a word diff, instead of a struck sentence beside a new one.

### `proseanchor.ts` — comments

`anchorSelection(doc, range)` → `{ section, paragraph, sentences: [i, j], selectedText }` from a DOM
selection mapped to sentences (each rendered sentence carries a `data-s` index). A selection that
crosses a paragraph boundary is clipped to its first paragraph. `ProseComment` is that anchor plus
`note` and the quote (decision 8). `formatRequest(comments, generalNote)` builds the answer above,
ordered by position in the document.

### Baseline (`docbaseline.ts`)

`pickBaseline({ shown, sessionRef, headRef })`: content shown in the previous review if any, else the
file at `sessionRef` (the start ref the Diff surface computes from the transcript), else at `HEAD`,
else empty (a new file: everything is an insertion). The git read is the existing
`GitFileAtRefCommand` the Diff surface uses (`diffcontentstore.ts`); no new RPC.

## PDF tab (`.tex` only)

### Root

`findTexRoot(path)` in Go, first match wins:
1. A `% !TEX root = <rel>` line in the first 20 lines → that file, resolved against the file's dir.
2. The file contains `\documentclass` → the file.
3. Up to two parent dirs: a `.tex` containing `\documentclass`, `main.tex` first, then by name.
4. None → the tab says "No root file found. Add `% !TEX root = …` at the top of the file." The
   Changes tab is unaffected.

### Compile

New wshrpc command `DocCompileCommand(CommandDocCompileData{ Path }) → DocCompileResult{ RootPath,
PdfPath, Ok, Pages, LogTail, FirstError }` in a new `pkg/wshrpc/wshrpctypes_doc.go`, served by
`pkg/doccompile`:

- `latexmk -pdf -interaction=nonstopmode -halt-on-error -outdir=<out>` in the root's dir; if
  `latexmk` isn't on PATH, `tectonic --outdir <out>`. Neither → `Ok: false`, `FirstError: "No LaTeX
  engine found (latexmk or tectonic)"`.
- `<out>` is `<data dir>/doccompile/<sha1 of the root path, 12 hex>/`.
- 90 s timeout. One compile per root at a time; a request while one runs waits for it and returns its
  result.
- `Pages` from the PDF's page tree (`/Type /Pages … /Count`); 0 if unreadable.
- `FirstError`: the first `! ` line of the log and the `l.<n>` line after it.

Run `task generate` after adding the types.

### When and how it shows

The compile starts in the background when the review opens, and again on a **Recompile** button; not
on file change (the agent doesn't edit the file while its ask is open). The PDF shows in an iframe on
`/wave/stream-file?path=<PdfPath>`, WebView2's built-in viewer. The toolbar shows "N pages", with a
warning when `pageLimit` is set and exceeded. A failed compile shows `FirstError` and a **Send to
agent** button that appends it to `generalNote`.

## Testing

**Vitest** (beside each module):
- `docreview.test.ts`: `Doc review` for `.tex` and `.md`; `Pages: N`; a malformed ask stays an ordinary
  question; `Spec review` and `Plan review` unchanged.
- `docprose.test.ts`: tex sections, paragraphs, sentences, abbreviations, math, `%` vs `\%`, figure
  placeholder, unknown macros; md headings, lists, code; every sentence's `source` slices back to its text.
- `prosediff.test.ts`: insert, delete, modify at the 0.6 threshold, renamed and moved sections.
- `proseanchor.test.ts`: multi-sentence selection, cross-paragraph clip, source quote, truncation,
  `formatRequest` order and the `General:` line.
- `docbaseline.test.ts`: each fallback in order.
- `docreviewstore.test.ts`: a new `askId` resets the state.

**Go:** `findTexRoot` (all four branches); the per-root compile lock; the output dir sits outside the
repo; a real compile, skipped when neither engine is on PATH.

**CDP:** fixture `doc-review` in `scripts/cockpit-fixtures/` (an agent asking `Doc review` on a sample
`.tex`, and one on a sample `.md` with a relative link and image), and scenario `doc-review` in
`scripts/cdp/scenarios.mjs` with one shot per state:
1. Changes tab of the `.tex`: struck and inserted sentences, a word-level modify.
2. An anchored comment in the comment column.
3. A narrow pane: the comment under its paragraph.
4. PDF tab compiled, page count shown, over-limit warning.
5. PDF tab with a compile error and Send to agent.
6. The `.md` note with its link and image.
7. Back to the terminal with `v`.

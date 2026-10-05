# Doc review mode — reviewing an agent's prose edits on the Agent surface — design

Status: design settled 2026-10-02; mockup approved 2026-10-05.

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
linked markdown), SyncTeX, comments placed on the PDF, showing the previous round's comments beside a
later round, and keeping review state across an Arc restart.

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
   `Doc review` of the same file with one `- ` line per comment, starting with its number
   (`- 1: §5.2 ¶1 now opens with the null result`).
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

**The approved mockup is the spec for everything visual:**
`D:\projects\arcterm\.superpowers\design\doc-review-mode\project\` — `Main.dc.html` (interactive:
Terminal/Review, Changes/PDF, Whole file, click a sentence to comment), `Narrow.dc.html` (pane under
720 px), `Note.dc.html` (a `.md` note), `Round2.dc.html` (a second round) and `States.dc.html` (edge
states). The folder is gitignored, so a worktree reads it by that absolute path. Where this section
and the mockup disagree on a look, the mockup wins; this spec owns behaviour and wiring.

The agent tree and the agent header stay; the details rail hides, as in canvas mode. The header gains
a `Terminal | Review` segmented control (`element/segmented.tsx`, `role="group"`) while a `Doc review`
ask is open; the Review option carries an amber dot while the terminal is showing. It replaces the
header's amber review button for this kind of ask. The area the xterm occupies becomes:

- **Toolbar:** the file name and its folder; `Changes | PDF` (`role="tablist"`, `.tex` only — a `.md`
  file has no tab control); the `Whole file` toggle (Changes only, styled like canvas mode's pressed
  Mark button); the meta on the right: `+N −N · N edited · against <ref>, session start` (round 2:
  `against what you reviewed at <time>`). On the PDF tab the right side is the page count, the
  over-limit chip, `compiled <time> · <engine> · <secs>` and `Recompile`.
- **Head:** the `Doc review · waiting on you · <agent>` eyebrow (round 2: `Doc review · round 2`), the
  intro, and the focus items. A focus item scrolls to the section whose heading it names (matched by
  the `§` label or heading text; no match → inert). A focus item that starts `<n>:` renders as a
  numbered line tied to comment `n` of the previous round; the others render as chips. The right
  column of the head reads `Your comments · <n>`.
- **Body:** the prose view. Changed sections only, with one `<label> <title> · unchanged` row and a
  `Show whole file` link per run of unchanged sections, or every section with `wholeFile`.
- **Comments:** each paragraph is one grid row, `minmax(0, 1fr) 300px` with a 40 px gap, so a
  paragraph's comments sit level with it without measuring. A comment card has its number chip, its
  `§ ¶` location, the quote and the note; a draft card has the accent border, a textarea and
  `Add comment` / `Cancel`. The commented sentence is underlined in accent (dashed while the comment is
  a draft) and followed by its number chip. Below `COMMENT_COLUMN_MIN_PANE` (720 px) the grid becomes
  one column and the cards follow their paragraph.
- **Selection:** selecting text inside a paragraph shows a floating `Comment` button above it (key
  `c`). A selection that crosses a paragraph is clipped to its first paragraph.
- **Tray** (bottom, like canvas mode's mark tray): a `General note` input on the left; on the right
  `Approve` and `Request changes <n>`, and a hint line that says what will be sent (`Sends 2 comments
  to paper-writer as one answer.`, plus `1 comment is not added yet.` while a draft is open). With no
  saved comment and no note, `Approve` is the accent button and `Request changes` is disabled; the first
  saved comment or a note swaps them. Below 720 px the note takes its own row. After sending, the tray
  shows `Sent: <answer>` in success colour until the ask clears; then the state goes to `null` and the
  view returns to the terminal.

The xterm stays mounted and hidden (the canvas-mode rule: it must never remount). Focus moves into the
review on entering it, and back to the terminal on leaving, as `agentsurface.tsx` does for canvas mode.

The tree row's amber `review` chip, for a `Doc review` ask, focuses the agent, switches to the Agent
surface and sets the mode to `review`, instead of opening the dialog.

If the file can't be read (deleted or moved while the ask is open), the body shows `Couldn't read
<file>` and its path, as the spec dialog's document pane does; the tray still works, so the user can
answer.

Colours are `@theme` tokens only: insertions are `bg-diff-added/15`, deletions `bg-diff-removed/10`
with a `diff-removed` line-through and `ink-mid` text (the Tailwind opacity modifiers, no new tokens);
comment anchors and chips use accent. Images in a `.md` note sit on a light matte, because a diagram
exported with a transparent background and dark ink (Mermaid's default) is unreadable on the cockpit's
dark ground; the matte is a new `--color-imagematte` token in `tailwindsetup.css` with that reason in
its comment, kept at its default across themes.

### Keys

In `buildAgentBindings`, active only while a `Doc review` ask is open, each with exclusive `when()`s
so footer chips keep static labels (canvas-mode decision 12):

- `r` review ↔ terminal. The header already uses `r` to show the spec dialog, so it keeps one meaning:
  show the review.
- `[` / `]` previous / next tab (`.tex` only).
- `c` comment on the current selection.
- `Ctrl+Enter` sends whichever answer is the accent button: Request changes when there is something to
  send, else Approve.

`docs/keyboard-shortcuts.md` mirrors them.

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
4. None → `RootPath: ""`, and the tab says "No root file for <file>", why, and the line to add
   (`% !TEX root = ../main.tex`), as `States.dc.html` draws it. The Changes tab is unaffected.

### Compile

New wshrpc command `DocCompileCommand(CommandDocCompileData{ Path }) → DocCompileResult{ RootPath,
PdfPath, Ok, Engine, DurationMs, Pages, LogTail, FirstError }` in a new
`pkg/wshrpc/wshrpctypes_doc.go`, served by `pkg/doccompile`:

- `latexmk -pdf -interaction=nonstopmode -halt-on-error -outdir=<out>` in the root's dir; if
  `latexmk` isn't on PATH, `tectonic --outdir <out>`. `Engine` names the one used; neither →
  `Ok: false`, `Engine: ""`, and the tab shows "No LaTeX engine found" with how to install one.
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
warning chip (icon + "1 page over the 8-page limit") when `pageLimit` is set and exceeded. While a
compile runs, the tab shows a page skeleton and the elapsed time, and Recompile is disabled. A failed
compile shows `FirstError` and an **Add to my answer** button that appends it to `generalNote` (it
sends nothing by itself), beside Recompile.

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
`scripts/cdp/scenarios.mjs` with one shot per board of the mockup:
1. `Main`: Changes tab of the `.tex`, struck and inserted sentences, a word-level modify, a saved and a
   draft comment in the comment column, the tray with Request changes as the accent button.
2. `Main`: PDF tab compiled, page count and the over-limit chip.
3. `Narrow`: a pane under 720 px, the comment under its paragraph, the tray wrapped.
4. `Note`: the `.md` note with its relative link and its image on the matte.
5. `Round2`: a second `Doc review` of the same file, diffed against the first round's content, the
   numbered focus items.
6. `States`: a selection with the Comment button; terminal mode with the amber dot on Review; PDF
   compiling, compile failed, no root file, no engine; the tray with no comments; the tray after
   sending.
7. Back to the terminal with `r`.

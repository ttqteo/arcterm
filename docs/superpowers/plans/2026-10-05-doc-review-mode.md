# Doc review mode — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-02-doc-review-mode-design.md` — read it in full before your task.
**Verify:** `node scripts/verify.mjs ./pkg/doccompile/... ./pkg/wshrpc/... ./pkg/agentsync ./skills/...`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit && go vet ./pkg/doccompile/... ./pkg/wshrpc/... ./skills/...`
**Final:** `node scripts/cdp/final-verify.mjs doc-review-mode doc-review doc-review-canvas canvas-swap surface-smoke`
**Prototype:** D:/projects/arcterm/.superpowers/design/doc-review-mode/project/Main.dc.html

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement your task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Do not spawn subagents or forks.

**Goal:** An agent that finishes a section of a paper (`.tex`) or a markdown note asks a `Doc review`; Arc swaps the
agent's terminal for a review view with a sentence-level prose diff, comments anchored to passages, a compiled-PDF
tab, and Approve / Request changes, and sends the comments back as one structured answer.

**Architecture:** Pure models in `frontend/app/view/agents/`: `docprose.ts` (source → reading-view tokens),
`prosediff.ts` (sentence and word diff), `proseanchor.ts` (comments, selection clip, answer text), `docbaseline.ts`
(which "before" to diff against), `docreviewview.ts` (rows and tray state for the view). State lives in
`docreviewstore.ts` (per-agent atom family, like `canvasstore.ts`); every "open the review" call goes through one
`openReview`. The view is `docreviewpane.tsx`, swapped in for the terminal the way `CanvasPane` is. The PDF tab calls
a new `DocCompileCommand` served by a new Go package, `pkg/doccompile`. A new shipped skill, `skills/doc-review`,
tells agents when and how to ask.

**Tech Stack:** React 19, jotai, TypeScript, vitest, Tailwind 4, KaTeX (already in the tree via mermaid; becomes a
direct dependency), Go (wshrpc + `task generate`), CDP scenarios (`scripts/cdp/scenarios.mjs`).

## Approved design

The mockup folder `D:/projects/arcterm/.superpowers/design/doc-review-mode/project/` is gitignored scaffolding:
read it at that absolute path. `Main.dc.html` is interactive (Terminal/Review, Changes/PDF, Whole file, click a
sentence to comment); `Narrow.dc.html`, `Note.dc.html`, `Round2.dc.html` and `States.dc.html` draw the other states.
The mockup wins on looks, the spec on behaviour. Its sample text, agent names, counts and times are not production
constants. Copy sizes and classes from the existing components the mockup copies (`canvaspane.tsx` toolbar and
tray, `agentheader.tsx`, `element/segmented.tsx`, `docreviewdialog.tsx` eyebrow), never its raw colours: in code
every colour is an `@theme` token (`diff-added`, `diff-removed`, `accent`, `success`, `warning`, `ink-mid`, `muted`).

## Decisions this plan adds to the spec

1. **Tokens, not HTML.** A prose sentence is a list of word-sized tokens (`ProseToken`), not an HTML string. The
   view renders tokens with React (no `dangerouslySetInnerHTML`), and the word-level diff runs over the same tokens,
   so formatting such as `code` survives inside an edited sentence.
2. **Page count from the log.** pdfTeX compresses the page tree into object streams by default, so `/Count` is not
   readable with a regex. `Pages` comes from the engine log line `Output written on <file> (<n> pages`, which
   pdfTeX, XeTeX (tectonic with `--keep-logs`) and LuaTeX all print; 0 when absent.
3. **Note images are data URLs.** The app CSP is `img-src 'self' data:`, so an `<img>` pointing at wavesrv is blocked.
   The view reads an image with `FileReadCommand` and renders a `data:` URL (cap 5 MB; over the cap, the alt text and
   path). The PDF iframe is allowed (`frame-src http://127.0.0.1:*`) and uses `/wave/stream-file?path=…&authkey=…`,
   the key from `getApi().getAuthKey()` as `frontend/util/wsutil.ts` does.
4. **The session baseline needs no new RPC:** `ensureSessionStart(transcriptPath)` → `GitChangesCommand({ cwd: <file
   dir>, sessionstartts })` → its `ref` → `GitFileAtRefCommand({ cwd: <file dir>, ref, path: <basename> })`
   (`gitinfo.FileAtRef` resolves `ref:./path` against `cwd`). With no transcript the session read is `null` and the
   baseline falls to `HEAD`.
5. **Shown content is recorded on load, as `{ text, at }`.** The first time the view loads a review's file it
   computes the baseline from the *previous* record, then records the file text it is about to show, with the time,
   as that path's record in `shownContentAtom`. The load result (current text, baseline text, `from`, `ref`,
   `reviewedAt`) is kept per agent, keyed by `askId`, so a remount or re-render never reloads (a second load would
   diff the file against itself). Recording at load, not at send, means an answer given from the Cockpit bar, the
   palette or the terminal still leaves the next round's baseline right. A review the user never opened records
   nothing.
6. **Canvas and review are exclusive views.** One `setAgentView(agentId, "terminal" | "canvas" | "review")` sets both
   stores. With both a canvas and an open `Doc review`, the header shows one segmented control
   `Terminal | Canvas | Review`. In review mode the canvas keys stand down, and in canvas mode the review keys do.
7. **Ctrl+Enter inside a draft comment adds that comment;** anywhere else in review mode it sends the accent answer.
8. **Markdown tables and code blocks are placeholders**, like LaTeX figures: a table is one sentence
   `[Table: <header cells>]`, a fenced block one `code` token, neither sentence-split.
9. **Markdown section labels:** a `.md` section's `label` is its heading's leading enumerator (`5.`, `5.2`, matched by
   `^\d+(?:\.\d+)*\.?(?=\s)`) when it has one, else the heading text cut to 40 characters with `…`. A comment's
   location reads `[5. ¶2]`, as the Note board draws it, and the quote disambiguates. LaTeX sections keep `§3.2`.
10. **DEV-only test hooks**, following `window.__waveDagModalFixture`, all gated on `import.meta.env.DEV`:
    `window.__reloadDevMockRoster()` (re-runs `loadDevMockRoster`); `window.__docCompileFixture(value)` where `value`
    is a partial `CommandDocCompileRtnData` (merged over `{ rootpath: <the file>, ok: true, engine: "latexmk",
    durationms: 6200 }`), `"pending"` (the pane stays compiling) or `null` (the real RPC), replacing the RPC for
    every compile the PDF pane starts; `window.__docCompileCalls` (a counter of compiles the pane started, real or
    fixture).
11. **"Sent" is derived, not claimed.** `submitAnswer` returns `void` and may send nothing, so the view never sets a
    "sent" flag itself. The ask is sent when `sentIdsAtom` holds `askSentKey(agent)` (set by `answerAgentAsk`, cleared
    when the agent clears the ask or the server puts it back), whichever surface answered. The tray records what it
    tried to send as `lastSend: { kind, comments } | null`; the sent line is `Sent: Request changes, 3 comments` /
    `Sent: Approve` when `lastSend` is set, plain `Sent` when the answer came from elsewhere, each followed by
    `· back to the terminal when <agent> picks it up` (the States board). While sent, comments are read-only and the
    tray's buttons are disabled.
12. **Narrow means the pane's own width.** `isNarrow(paneWidth)` is `paneWidth < COMMENT_COLUMN_MIN_PANE` (720), the
    review pane root's `clientWidth` observed with a `ResizeObserver`, not the window's width.
13. **Numbered focus lines** (`- 1: §5.2 ¶1 now opens with the null result`) render as the Round2 board draws them: a
    number chip and the text, and a click scrolls to the `§ ¶` the text names (a bare `§` names the section; no match
    is inert), like the chips. Comments reset on every new `askId`, so the number is a label for the agent's own
    mapping, not a link to a stored comment.
14. **Comments anchor to the after-document only.** A section carries a numeric `index` (0-based position in its
    document), a comment's anchor stores `sectionIndex`, and ordering uses `(sectionIndex, paragraph, first
    sentence)`, never the label (`§10` sorts before `§2` as text, and `.md` labels are headings). A struck
    (deleted) sentence has no `data-s` and cannot be selected into a comment; `data-s` is the sentence's index among
    the paragraph's *after* sentences.
15. **Added and removed images** in a `.md` note: a sentence insert whose only token is an `image` draws a `+ image ·
    <src>` caption in `text-diff-added` over a `border-diff-added/55` matte frame; a delete draws `− image · <src>` in
    `text-diff-removed` with no pixels; an unchanged image has neither.
16. **Unchanged runs** read `<label> <title> · unchanged` for one section and `<first label> – <last label> ·
    unchanged` for two or more (`1. – 4. · unchanged`, `§2 – §4 · unchanged`), each with a `Show whole file` link.
    A section that holds a comment is never collapsed.

## Where this plan departs from the spec

Forwarded to the human, who decides whether the spec text changes; the plan's decisions above stand until then.
(a) Sentences are token lists, not `{ html, source }` (decision 1). (b) The page count comes from the engine log, not
the PDF page tree (2). (c) Images are `data:` URLs, not `/wave/stream-file` `<img>`, which the CSP blocks (3). (d)
Shown content is recorded on load as `{ text, at }`, and `pickBaseline` takes the already-read texts (4, 5). (e) The
CDP scenario and fixture are named `doc-review-mode`, because `doc-review` already tests the Spec/Plan dialog. (f)
"Numbered focus item tied to comment `n` of the previous round" has nothing to tie to, since comments reset per
`askId` (13). (g) The 720 px measure is the pane's width (12). (h) `.md` section labels (9). (i) Anchors carry
`sectionIndex` (14).

## Global constraints

- Colours only from `@theme` tokens; no raw hex/rgba in `className`/`style`. Diff tints are `bg-diff-added/15` and
  `bg-diff-removed/10` (Tailwind opacity modifiers). The one new token is `--color-imagematte` (Task 8).
- Testable logic in a pure `foo.ts` with `foo.test.ts` beside it; `.tsx` stays thin. No jsdom or render tests.
- Never hand-edit generated files (`wshclientapi.ts`, `gotypes.d.ts`, `wshclient.go`, …): edit Go, run
  `task generate` (Task 5 only).
- Spec review and Plan review keep the dialog, unchanged. `scripts/cdp/scenarios.mjs` `doc-review` and
  `doc-review-canvas` must keep passing; both are in the Final line and in Task 8's verify step, because Tasks 7 and 8
  change the canvas keys, the Agent surface swap and the header.
- Every rendered view, visual state or interaction is performed by a numbered step of the one CDP scenario
  `doc-review-mode` (steps 1–17 added by Task 8, 18–24 by Task 9). A task's acceptance names its steps. Task 7's
  steps are listed under it but written in Task 8, because the view they drive arrives there; the Final line runs
  them all on the merged result.
- Typecheck with the Check command, never `npx tsc`. Prettier-check only files you touched
  (`npx prettier --check <files>`); never `--write` the tree; never run prettier on `scripts/*.mjs`.
- Copy follows DESIGN.md "Copy": sentence case, buttons say what happens.

---

### Task 1: Parse the `Doc review` ask

**Depends on:** none

**Files:**
- Modify: `frontend/app/view/agents/docreview.ts`
- Modify: `frontend/app/view/agents/answerbar.tsx` (`REVIEW_ITEM_NOUN` gains `doc`)
- Modify: `frontend/app/view/agents/docreviewdialog.tsx` (`COPY` gains a `doc` entry, or narrow its key type to
  `"spec" | "plan"`; a `Doc review` never opens the dialog)
- Test: `frontend/app/view/agents/docreview.test.ts`

**Interface (other tasks rely on it):**

```ts
export const DOC_REVIEW_HEADERS = { spec: "Spec review", plan: "Plan review", doc: "Doc review" } as const;
export type DocReviewDoc = "markdown" | "canvas" | "latex";
export interface DocReview { /* existing fields */ pageLimit?: number }
export interface FocusItem { n: number | null; text: string }
export function focusItem(item: string): FocusItem; // "1: done X" → { n: 1, text: "done X" }; else { n: null, text }
```

**Scenario step:** the Cockpit card's `DocReviewSummary` for a `Doc review` ask (header `Doc review`, `N points`) is
shown by step 11.

- [ ] **Step 1: Failing tests** in `docreview.test.ts`:
  - `Doc review` on `.tex` parses with `kind: "doc"`, `doc: "latex"`; on `.md` with `doc: "markdown"`.
  - A `Pages: 8` line sets `pageLimit: 8` and is removed from `intro`; `Pages: x` is ordinary intro text.
  - `Doc review` naming a `.dc.html` or any other extension → `null`; `Spec review` naming a `.tex` → `null`.
  - `focusItem("2: §5.2 ¶2 accounts for the other 6")` → `{ n: 2, … }`; `focusItem("§5.2: rewritten")` → `n: null`.
  - Every existing Spec review and Plan review case still passes unchanged.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/docreview.test.ts` → the new cases fail.
- [ ] **Step 3:** Implement. `doc` accepts only `markdown` and `latex`; `spec` and `plan` keep `markdown` and `canvas`.
  `REVIEW_ITEM_NOUN.doc` is `["point", "points"]`.
- [ ] **Step 4:** Tests pass; Check passes.
- [ ] **Step 5:** Commit: `feat(review): parse the Doc review ask`.

### Task 2: Reading view for `.tex` and `.md` (`docprose.ts`)

**Depends on:** none

**Files:**
- Create: `frontend/app/view/agents/docprose.ts`, `frontend/app/view/agents/docprose.test.ts`

**Interface (Tasks 3, 4 and 8 rely on it):**

```ts
export type ProseKind = "latex" | "markdown";
export type TokenKind = "text" | "em" | "strong" | "code" | "ref" | "cite" | "math" | "link" | "image" | "placeholder";
// one word of text-like kinds, with its trailing whitespace in `text`; math, image and placeholder are one token each.
// link: href = target. image: text = alt, href = src.
export interface ProseToken { kind: TokenKind; text: string; href?: string; display?: boolean }
export interface ProseSentence { tokens: ProseToken[]; text: string; source: { start: number; end: number } }
export interface ProseParagraph { sentences: ProseSentence[]; list?: boolean }
export interface ProseSection { level: number; title: string; label: string; paragraphs: ProseParagraph[] }
export interface ProseDoc { kind: ProseKind; sections: ProseSection[] }
export function toProse(kind: ProseKind, text: string): ProseDoc;
export function proseKindOf(path: string): ProseKind | null; // .tex → latex, .md/.markdown → markdown
```

`ProseSentence.text` is the sentence's shown text with whitespace collapsed (what the diff compares).
`source` slices the original file text, so `text.slice(start, end)` is the sentence's source.

Rules are the spec's "docprose.ts" section, plus decisions 1, 8 and 9 above. For `.tex`: `\emph`/`\textit` → `em`,
`\textbf` → `strong`, `\texttt` → `code`, `\cite{a,b}` → one `cite` token `[a, b]`, `\ref`/`\autoref` → `ref`
`[x]`, `\label` dropped, math → one `math` token holding the TeX (display for `\[…\]`, `equation`, `align`),
`figure`/`table` → one `placeholder` sentence `[Figure: <caption>]` / `[Table: <caption>]`, `\paragraph{X}` is a
level-4 section, any other macro keeps its last braced argument as text, `%` comments dropped (not `\%`), `~` is a
space. For `.md`: `#` headings, paragraphs, list items (`list: true`, one paragraph each), `**strong**`, `*em*`/`_em_`,
`` `code` ``, `[text](href)` → `link` tokens carrying `href`, `![alt](src)` → `image` (its own paragraph when alone
on the line), `$…$` → `math`.

- [ ] **Step 1: Failing tests** — the spec's `docprose.test.ts` list: tex sections and `§` labels counted per level;
  front matter titled by `\title`; paragraphs on blank lines; sentence split on `.?!` + space + uppercase or `\`, not
  after `e.g.`, `i.e.`, `et al.`, `Fig.`, `Eq.`, `Sec.`, `vs.`, not inside math; `%` vs `\%`; the figure placeholder;
  an unknown macro; md headings (labels `5.` / `5.2` for numbered headings, the heading text cut to 40 characters with
  `…` for the others), list items, inline code, links, an image paragraph (alt and src), a table placeholder, a fenced
  block; and for every sentence of every fixture, `text.slice(source.start, source.end)` contains the sentence's
  words in order. Use a short excerpt of a real paper section (the spec's §5.2 example) as one fixture.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/docprose.test.ts` → fails.
- [ ] **Step 3:** Implement as a hand-written scanner (no new parser dependency).
- [ ] **Step 4:** Tests pass; Check passes.
- [ ] **Step 5:** Commit: `feat(review): reading view for LaTeX and markdown`.

### Task 3: Sentence and word diff (`prosediff.ts`)

**Depends on:** Task 2

**Files:**
- Create: `frontend/app/view/agents/prosediff.ts`, `frontend/app/view/agents/prosediff.test.ts`

**Interface (Task 8 relies on it):**

```ts
export type ChangeStatus = "same" | "changed" | "added" | "removed";
export interface WordChange { op: "same" | "insert" | "delete"; token: ProseToken }
export interface SentenceChange {
    op: "same" | "insert" | "delete" | "modify";
    before?: ProseSentence; after?: ProseSentence;
    afterIndex?: number;  // the sentence's index among the paragraph's after sentences (not for delete)
    words?: WordChange[]; // modify only
}
export interface ParagraphChange { status: ChangeStatus; index: number; list?: boolean; sentences: SentenceChange[] }
export interface SectionChange {
    status: ChangeStatus; level: number; label: string; title: string;
    index: number;        // 0-based position in the after-document (a removed section: in the before-document)
    paragraphs: ParagraphChange[];
    counts: { insert: number; delete: number; modify: number };
}
export const MODIFY_SIMILARITY = 0.6;
export function diffProse(before: ProseDoc, after: ProseDoc): SectionChange[];
```

`ParagraphChange.index` is the 1-based `¶` number in the after-document (a removed paragraph keeps its
before-document number). Algorithm per the spec: sections pair by normalized title, then order; paragraphs pair by
order, then best sentence overlap; sentences by LCS on `text`; an adjacent delete + insert whose word similarity is
≥ `MODIFY_SIMILARITY` becomes one `modify` with an LCS word diff over tokens (compared by kind + trimmed text).

- [ ] **Step 1: Failing tests:** identical docs → all `same`, zero counts; one inserted, one deleted, one modified
  sentence with the right `words`; similarity 0.59 stays delete + insert, 0.6 becomes modify; a renamed section
  pairs by order; a section moved within the document pairs by title; an added and a removed section; a `code`
  token inside a modified sentence keeps its kind in `words`; `index` follows the after-document order after an
  inserted section, and `afterIndex` skips deleted sentences.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/prosediff.test.ts` → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass; Check passes.
- [ ] **Step 5:** Commit: `feat(review): sentence-level prose diff`.

### Task 4: Comments, selection clip and baseline (`proseanchor.ts`, `docbaseline.ts`)

**Depends on:** Task 2

**Files:**
- Create: `frontend/app/view/agents/proseanchor.ts`, `frontend/app/view/agents/proseanchor.test.ts`
- Create: `frontend/app/view/agents/docbaseline.ts`, `frontend/app/view/agents/docbaseline.test.ts`

**Interface (Tasks 7 and 8 rely on it):**

```ts
// proseanchor.ts
export interface ProseAnchor {
    sectionIndex: number;                         // SectionChange.index: orders comments (decision 14)
    sectionLabel: string; paragraph: number;      // ¶, 1-based, in the after-document
    sentences: [number, number];                  // first and last after-sentence index in that paragraph
    quote: string;                                // source text of those sentences, whitespace collapsed, ≤160 chars + "…"
    selectedText: string;
}
export interface ProseComment extends ProseAnchor { id: string; note: string; draft: boolean }
export const QUOTE_MAX = 160;
export function anchorFor(source: string,
    para: { sectionIndex: number; label: string; index: number; sentences: ProseSentence[] },
    first: number, last: number, selectedText: string): ProseAnchor;
export function orderComments(comments: ProseComment[]): ProseComment[]; // (sectionIndex, paragraph, first sentence), drafts included
export function formatRequest(comments: ProseComment[], generalNote: string): string; // the spec's answer text; drafts skipped
export function canRequest(comments: ProseComment[], generalNote: string): boolean;
// A DOM selection reduced to two points (the pane reads them from `data-section`, `data-p`, `data-s` ancestors).
export interface SelPoint { section: number; paragraph: number; sentence: number }
export function clipSelection(a: SelPoint, b: SelPoint, lastSentence: (section: number, paragraph: number) => number):
    { section: number; paragraph: number; first: number; last: number; clipped: boolean };

// docbaseline.ts
export type BaselineFrom = "previous" | "session" | "head" | "new";
export function pickBaseline(input: { shown?: { text: string; at: number }; atSession?: string | null; atHead?: string | null }):
    { text: string; from: BaselineFrom; reviewedAt?: number };
```

`clipSelection` orders the two points (a backward selection works), and a selection that crosses a paragraph or a
section is clipped to the first paragraph: `first` is its first sentence, `last` that paragraph's last sentence,
`clipped: true`. The pane's `selectedText` is the browser selection's text, or, when `clipped`, the shown text of the
covered sentences. `anchorFor` only ever sees one paragraph.

- [ ] **Step 1: Failing tests** — the spec's `proseanchor.test.ts` and `docbaseline.test.ts` lists: a multi-sentence
  anchor quotes the source of every covered sentence (LaTeX macros intact, e.g. `\emph{XYZ}`); a 300-character quote
  is cut to 160 + `…`; `formatRequest` matches the spec's sample exactly (numbering, `[§5.2 ¶2] "…"`, `   → note`,
  `General:` only when non-empty, drafts left out; a `.md` location reads `[5. ¶2]`); `orderComments` puts `§10` after
  `§2` (by `sectionIndex`), then paragraph, then first sentence, and keeps drafts in place; `canRequest` false with
  only drafts and no note; `clipSelection`: inside one sentence, across two sentences, across two paragraphs (clipped
  to the first paragraph's last sentence), across two sections, and a backward selection; `pickBaseline` returns each
  fallback in order (`shown`, even `{ text: "" }`, wins with `from: "previous"` and its `at` as `reviewedAt`; then
  `atSession`; `atSession` null → `atHead`; both null → `new` with empty text).
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/proseanchor.test.ts frontend/app/view/agents/docbaseline.test.ts`
  → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass; Check passes.
- [ ] **Step 5:** Commit: `feat(review): anchored comments, selection clip and the diff baseline`.

### Task 5: `DocCompileCommand` and `pkg/doccompile`

**Depends on:** none

**Files:**
- Create: `pkg/doccompile/doccompile.go`, `pkg/doccompile/doccompile_test.go`
- Create: `pkg/wshrpc/wshrpctypes_doc.go`
- Modify: `pkg/wshrpc/wshrpctypes.go` (add `DocCommands` to `WshRpcInterface`)
- Create: `pkg/wshrpc/wshserver/wshserver_doc.go`
- Regenerate (never hand-edit): `task generate` → `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`,
  `pkg/wshrpc/wshclient/wshclient.go`

**Interface (Task 9 relies on the generated `RpcApi.DocCompileCommand`):**

```go
// pkg/wshrpc/wshrpctypes_doc.go
type DocCommands interface {
    DocCompileCommand(ctx context.Context, data CommandDocCompileData) (*CommandDocCompileRtnData, error)
}
type CommandDocCompileData struct { Path string `json:"path"` }
type CommandDocCompileRtnData struct {
    RootPath   string `json:"rootpath"`   // "" = no root found
    PdfPath    string `json:"pdfpath,omitempty"`
    Ok         bool   `json:"ok"`
    Engine     string `json:"engine"`     // "latexmk" | "tectonic" | "" (none on PATH, or no root)
    DurationMs int64  `json:"durationms"`
    Pages      int    `json:"pages"`
    LogTail    string `json:"logtail,omitempty"`
    FirstError string `json:"firsterror,omitempty"`
}

// pkg/doccompile
func FindTexRoot(path string) (string, error)            // spec "Root" rules; "" when none
func Compile(ctx context.Context, path string) (*Result, error)
func PagesFromLog(log string) int                         // decision 2
func FirstErrorFromLog(log string) string                 // first "! " line + the following "l.<n>" line
```

Behaviour per the spec's "PDF tab" section: engine `latexmk -pdf -interaction=nonstopmode -halt-on-error
-outdir=<out>` in the root's dir, else `tectonic --keep-logs --outdir <out>`; `<out>` =
`<wavebase.GetWaveDataDir()>/doccompile/<sha1(root)[:12]>`; 90 s timeout; one compile per root at a time, and a
request that arrives while one runs waits for it and gets its result; `LogTail` = the log's last 40 lines. With no
root, `Compile` returns at once with `RootPath: ""`, `Ok: false`, `Engine: ""` and never looks for an engine (the
frontend tells "no root" from "no engine" by `RootPath` first). Spawn the engine the way other wavesrv subprocesses
are spawned on Windows (find the existing helper; no console window). Keep the engine runner and the data dir behind
package-level variables so tests can substitute them.

**Scenario steps:** none of its own — the RPC's states are shown by Task 9's steps 19–24.

- [ ] **Step 1: Failing tests** in `doccompile_test.go`: `FindTexRoot` — magic comment (relative path resolved
  against the file's dir), the file itself with `\documentclass`, `main.tex` two levels up preferred over another
  root `.tex`, none → `""`; `PagesFromLog` on a pdfTeX line, a XeTeX `.xdv` line, a `1 page` line, and no line;
  `FirstErrorFromLog` on a real `Undefined control sequence` log excerpt; the output dir is under the substituted data
  dir and outside the root's dir; two concurrent `Compile` calls on one root run the substituted engine once and
  both get its result; no root → `RootPath ""` and the substituted engine never runs; with no engine on the
  substituted PATH lookup, `Ok: false`, `Engine: ""`; a real compile of a minimal document, `t.Skip` when neither
  `latexmk` nor `tectonic` is on PATH.
- [ ] **Step 2:** `go test ./pkg/doccompile -run 'TestFindTexRoot|TestPagesFromLog|TestFirstErrorFromLog|TestOutDir|TestCompile'`
  → fails.
- [ ] **Step 3:** Implement the package, the RPC types and `WshServer.DocCompileCommand` (a thin call into
  `doccompile.Compile`, mapping `Result` to the return type). Run `task generate`.
- [ ] **Step 4:** The tests pass; `go vet ./pkg/doccompile/... ./pkg/wshrpc/...` is clean; Check passes;
  `git diff --stat` shows the generated files changed only by `task generate`.
- [ ] **Step 5:** Commit: `feat(doccompile): compile a LaTeX root for the review's PDF tab`.

### Task 6: The `doc-review` skill

**Depends on:** none

**Files:**
- Create: `skills/doc-review/SKILL.md`
- Modify: `skills/skills.go` (add `doc-review` to the `//go:embed` line, alphabetical)
- Create: `skills/skills_test.go` (if absent)

`SKILL.md` frontmatter: `name: doc-review`; `description:` "Use when you finish a meaningful edit to a paper
(.tex) or a markdown note in an Arc session and need the user to review it — ask a Doc review and stop." The body
is the spec's "The `doc-review` skill" section turned into instructions to the agent: when to ask (a unit, default
one section or one note; the repo's `AGENTS.md`/`CLAUDE.md` may redefine it), the exact ask shape with the
harness's ask tool (`AskUserQuestion` for Claude), header `Doc review`, line 1 the absolute path, optional
`Pages: N`, `- ` focus lines, options `Approve` and `Request changes`; one file per ask; stop after asking and do not
edit that file meanwhile; on Request changes, find each numbered comment by its quote, handle it, then ask again
with one `- <n>: <what you did>` line per comment; on Approve, carry on. Include the spec's answer sample so the
agent knows what it will receive. Keep it under 60 lines; no Arc internals.

**Scenario steps:** none — a text file with no rendered view.

- [ ] **Step 1: Failing test** `skills/skills_test.go`: `FS` contains `doc-review/SKILL.md`, whose frontmatter `name`
  is `doc-review`; every top-level dir of `FS` has a `SKILL.md`.
- [ ] **Step 2:** `go test ./skills -run TestShippedSkills` → fails.
- [ ] **Step 3:** Write the skill and the embed line.
- [ ] **Step 4:** `go test ./skills -run TestShippedSkills` and `go test ./pkg/agentsync -run Skill` pass.
- [ ] **Step 5:** Commit: `feat(skills): doc-review tells agents how to ask for a Doc review`.

### Task 7: Review state, one router, keys

**Depends on:** Task 1, Task 4

**Files:**
- Create: `frontend/app/view/agents/docreviewstore.ts`, `frontend/app/view/agents/docreviewstore.test.ts`
- Create: `frontend/app/view/agents/agentview.ts` (+ `agentview.test.ts`): `setAgentView` (decision 6)
- Modify: `frontend/app/view/agents/canvasstore.ts` (nothing imports `docreviewstore` from here; the header and keys
  call `setAgentView`)
- Modify (route through `openReview`, never `globalStore.set(docReviewAtom, …)` directly):
  `agentheader.tsx` (the amber review button), `agenttree.tsx` (row chip), `answerbar.tsx` (`DocReviewSummary` gains
  a `model` prop; update its callers `agentrow.tsx`, `leadcard.tsx`, `answerbar.tsx`), `command-palette.tsx`
  (Needs-you review), `agentsurface.tsx` (the auto-open effect: a `Doc review` sets the mode to `review` once per
  `askId`, through `autoOpenedAskIdsAtom`, instead of opening the dialog)
- Modify: `frontend/app/view/agents/cockpitshell.tsx` (mount `useDocReviewSync(model)`: always-mounted shell)
- Modify: `frontend/app/store/keybindings/bindings.ts`, `whenstate.ts`, `store.test.ts` (completeness)
- Modify: `docs/keyboard-shortcuts.md` (new "Agent: review mode" subsection beside "Agent: canvas mode")

**Interface (Task 8 relies on it):**

```ts
export type DocReviewMode = "terminal" | "review";
export type DocReviewTab = "changes" | "pdf";
export interface LastSend { kind: "approve" | "request"; comments: number }   // decision 11
export interface DocReviewState {
    askId: string; path: string; doc: "latex" | "markdown";
    mode: DocReviewMode; tab: DocReviewTab; wholeFile: boolean;
    comments: ProseComment[]; generalNote: string;
    lastSend: LastSend | null;
}
export const docReviewStateAtom: (agentId: string) => PrimitiveAtom<DocReviewState | null>; // atomFamily
export const shownContentAtom: (agentId: string) => PrimitiveAtom<Record<string, { text: string; at: number }>>; // abs path →
export function syncDocReview(agentId: string, ask: AgentAsk | undefined): void; // new askId resets; none → null
export function useDocReviewSync(model: AgentsViewModel): void;                  // roster → syncDocReview
export function openReview(model: AgentsViewModel, agentId: string): void;      // doc → focus + "agent" + review; else dialog
export function focusedDocReview(model: AgentsViewModel): DocReviewState | null;
export function setDocReviewTab(agentId: string, tab: DocReviewTab): void;
export function stepDocReviewTab(agentId: string, delta: number): void;          // latex only
export function toggleWholeFile(agentId: string): void;
export function addComment(agentId: string, c: ProseComment): void;
export function updateComment(agentId: string, id: string, patch: Partial<ProseComment>): void;
export function removeComment(agentId: string, id: string): void;
export function setGeneralNote(agentId: string, note: string): void;
export function setLastSend(agentId: string, send: LastSend | null): void;
export function recordShown(agentId: string, path: string, text: string, at: number): void; // decision 5
// agentview.ts
export function setAgentView(agentId: string, view: "terminal" | "canvas" | "review", now: number): void;
```

Keys (spec "Keys", with exclusive `when()`s so footer chips keep static labels): `agent:review` keeps `r` and its
label for Spec/Plan review and for opening a `Doc review` (`openReview`); a new `agent:review-close` (`r`, "Back to
the terminal") is active only in review mode, and `agent:review` stands down there; `agent:review-prev` /
`agent:review-next` (`[` / `]`, latex only); `agent:review-comment` (`c`, clicks `[data-doc-review-comment]`, returns
`false` when it is absent so the key passes); `agent:review-send` (`Ctrl:Enter`, clicks `[data-doc-review-send]`,
live inside the general-note input; a draft textarea handles its own Ctrl+Enter, decision 7). The canvas bindings
(`c`, `[`, `]`, `m`, Ctrl+Enter) and `agent:back`/`d`/`f` stand down in review mode, as they do in canvas mode.
`watchFocusedCanvas` also follows the focused agent's `docReviewStateAtom` (rename it if you like); update the
completeness test's registered set.

**Scenario steps** (written in Task 8 and Task 9; each proves this task): the card's Review button → `openReview`
(step 11); the palette's Needs-you review row (step 12); the tree-row `review` chip and `r` both ways (step 13); `c`
(step 5); Ctrl+Enter sending the accent answer (steps 15 and 17); `[` / `]` (step 18).

- [ ] **Step 1: Failing tests** `docreviewstore.test.ts`: a first `Doc review` ask creates state in `terminal` mode;
  the same `askId` again keeps comments; a new `askId` resets comments, note, tab, `wholeFile` and `lastSend` but
  keeps `shownContentAtom`; an agent whose ask clears goes to `null`; a Spec review ask creates no state;
  `openReview` on a `Doc review` focuses the agent, sets surface `agent` and mode `review`, and on a Spec review sets
  `docReviewAtom`; `recordShown` stores `{ text, at }` under the path and keeps the other paths. `agentview.test.ts`:
  `review` puts the canvas in `terminal` mode, `canvas` puts the review in `terminal` mode.
  `bindings.test.ts`/`store.test.ts`: `r` resolves to exactly one binding in each mode; completeness passes.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/docreviewstore.test.ts frontend/app/view/agents/agentview.test.ts frontend/app/store/keybindings`
  → fails.
- [ ] **Step 3:** Implement, then route every call site listed above through `openReview`.
- [ ] **Step 4:** Tests pass; Check passes; `docs/keyboard-shortcuts.md` lists every new binding.
- [ ] **Step 5:** Commit: `feat(review): review state, one router to open a review, and its keys`.

### Task 8: The review view — Changes tab, comments, tray

**Depends on:** Task 3, Task 7

**Files:**
- Create: `frontend/app/view/agents/docreviewview.ts` (+ `docreviewview.test.ts`): pure rows and tray state
- Create: `frontend/app/view/agents/docreviewload.ts` (+ `docreviewload.test.ts`, RPC mocked as
  `agentaskstore.test.ts` does): async loads (current file, baseline per decision 4, image data URLs per decision 3),
  keyed by `askId` so a stale load never lands on a newer review, the result kept per agent (decision 5)
- Create: `frontend/app/view/agents/docreviewpane.tsx`, `frontend/app/view/agents/prosetokens.tsx` (token renderer;
  KaTeX for `math`)
- Modify: `frontend/app/view/agents/agentsurface.tsx` (review mode hides the terminal like canvas mode — xterm stays
  mounted — and hides the details rail; focus moves into the pane and back)
- Modify: `frontend/app/view/agents/agentheader.tsx` (the `Terminal | Review` segmented control with the amber dot,
  three options when a canvas also exists; the amber button stays for Spec/Plan review only)
- Modify: `frontend/tailwindsetup.css` (`--color-imagematte`, value from `Note.dc.html`'s matte, with a why-comment;
  not mirrored in `themes.ts`), `DESIGN.md` (list the token), `package.json` (`katex` as a direct dependency at the
  installed `0.16.x`; import its CSS once in the pane)
- Modify: `frontend/app/view/agents/devmock.ts` (`window.__reloadDevMockRoster`, decision 10)
- Modify: `scripts/cockpit-fixtures/scenarios.mjs` (a `doc-review-mode` roster: one agent asking `Doc review` on an
  absolute path to a repo file, for manual `npm run cockpit:fixtures`)
- Modify: `scripts/cdp/scenarios.mjs` (new scenario `doc-review-mode`, steps 1–17; Task 9 adds 18–24)

**`docreviewview.ts` interface:**

```ts
export const COMMENT_COLUMN_MIN_PANE = 720;                 // decision 12: the pane's own width
export function isNarrow(paneWidth: number): boolean;
export interface ReviewRow { /* a section heading, an "unchanged" run with its label, or a paragraph with its
    sentence changes and its comments (attached by sectionIndex + paragraph) */ }
export function reviewRows(changes: SectionChange[], comments: ProseComment[], wholeFile: boolean): ReviewRow[];
export function runLabel(sections: { label: string; title: string }[]): string;   // decision 16
export function trayState(comments: ProseComment[], generalNote: string, agentName: string):
    { accent: "approve" | "request"; requestEnabled: boolean; saved: number; drafts: number; hint: string };
export function sentLine(lastSend: LastSend | null, sent: boolean, agentName: string): string | null; // decision 11
export function metaLine(changes: SectionChange[], from: BaselineFrom, ref: string, reviewedAt?: number): string;
export function focusTarget(text: string): { label: string; paragraph?: number } | null;  // decision 13
export function headingId(title: string): string;           // GitHub-style slug, the `#anchor` target
```

`metaLine`: the count groups `+N −N` (inserted, deleted sentences, each only when non-zero) and `N edited`
(modified), joined with ` · `, then the baseline: `session` → `against <ref>, session start` (`ref` is the short ref
the loader passes); `head` → `against HEAD`; `previous` → `against what you reviewed at HH:MM` (local 24-hour from
`reviewedAt`); `new` → `new file`. No counts at all → `no prose changes` first. Examples:
`+2 · 1 edited · against 5eb0de24, session start`, `+2 −1 · 1 edited · against what you reviewed at 14:06`.

What the pane draws is `Main.dc.html` (Changes tab), `Narrow.dc.html`, `Note.dc.html`, `Round2.dc.html` and the
non-PDF panels of `States.dc.html`, with the spec's "Layout" section for behaviour: the toolbar (no tab control for
`.md`; for `.tex` the `Changes | PDF` tablist, whose PDF panel is Task 9's — until then an empty slot), the head
with eyebrow, intro and focus items (numbered items from `focusItem` render as numbered lines, others as chips, both
scrolling per decision 13), the paragraph grid `minmax(0,1fr) 300px` with comment cards level with their paragraph
(one column when `isNarrow`), the unchanged rows (decision 16) and `Show whole file`, the selection's floating
`Comment` button (`data-doc-review-comment`; a selection is mapped to sentences through `data-section`, `data-p` and
`data-s` and clipped with `clipSelection`), draft and saved cards (each saved card has a remove button and a draft a
`Cancel`), the tray (`data-doc-review-send` on the accent answer; Approve and Request changes answer through the
model's existing `toggleAnswer` / `setAnswerText` + `submitAnswer`, with `formatRequest` as the text, using the
`approveIndex` / `requestIndex` `parseDocReview` returns; the tray calls `setLastSend` first and shows the sent line
only once `sentIdsAtom` holds the ask, decision 11), the sent line, added and removed images (decision 15), and
`Couldn't read <file>` with its path when the file is gone. `.md` links to `.md` files open through `openref`;
`#anchors` scroll in place to the heading whose `headingId` matches.

- [ ] **Step 1: Failing tests** `docreviewview.test.ts`: rows for changed-only vs `wholeFile`; a run of unchanged
  sections collapses to one row, labelled `1. – 4.` for a run and `<label> <title>` for one; a section holding a
  comment stays visible with `wholeFile` off; comments attach to their paragraph row in document order; `trayState`
  — no comments: accent `approve`, request disabled; one saved: accent `request`, hint "Sends 1 comment to <agent> as
  one answer."; a note only: request enabled, "and your note"; a draft adds "1 comment is not added yet."; `sentLine`
  — own request, own approve, answered elsewhere, not sent → `null`; `metaLine` for session, head, new and previous
  baselines with the sample strings above, and with no changes; `isNarrow(719)` true, `isNarrow(720)` false;
  `focusTarget("§5.2 ¶1 now opens…")` → `{ label: "§5.2", paragraph: 1 }`, `"§3 still reads…"` → `{ label: "§3" }`,
  `"tidied wording"` → `null`; `headingId("5. Kế hoạch — 3 bước")`.
  `docreviewload.test.ts`: the baseline is picked from the previous record *before* the current text is recorded; a
  second load for the same `askId` neither re-reads nor re-records and returns the first result; a load that resolves
  after the `askId` changed is dropped; a missing file yields `current: null` and records nothing.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/docreviewview.test.ts frontend/app/view/agents/docreviewload.test.ts` → fails.
- [ ] **Step 3:** Implement the model, the loads, the pane, the header control and the surface swap.
- [ ] **Step 4: CDP scenario `doc-review-mode`, steps 1–17.** Arrange (shared helper, torn down as the existing
  doc-review scenario does): a temp git repo with `paper/main.tex` (several sections, some unchanged), `notes/next_step.md`
  (headings `## 1.` … `## 5.`), `notes/misses_audit.md` and `notes/diagrams/pipeline.png` (a small PNG from a base64
  literal), committed; then edited — the `.tex` with inserted, deleted and modified sentences, one modified sentence
  holding `\texttt{…}`; the `.md` with a modified paragraph in section 5, a new list item with a relative link to
  `misses_audit.md` and a `#`-anchor link, and a new `![pipeline](diagrams/pipeline.png)` line. The fixture roster
  (`arrangeFixtureRun`'s pattern, no transcript, so the baseline is HEAD) holds `paper-writer` (a `Doc review` on the
  `.tex`, `Pages: 8`, focus lines `- §2.1 …`), `notes-writer` (on the `.md`) and `gone-writer` (on `notes/gone.md`,
  which never existed). Each step takes a shot after its actions:
  1. **Main.** Focusing `paper-writer` auto-switches to review; struck, inserted and word-modified sentences render,
     the `\texttt` token keeps its code styling inside the modified sentence; the tray shows Approve as the accent
     button and Request changes disabled (no comments); the xterm node is the same node as before the swap (tag it
     first, as `canvas-swap` does).
  2. **Main, whole file.** The collapsed run row (`<label> … · unchanged`) shows; clicking its `Show whole file`
     link renders every section; the toolbar `Whole file` toggle is pressed; clicking the toggle returns to changed
     sections only.
  3. **Main, focus chip.** Clicking a focus chip scrolls the pane so the section it names is in view (assert the
     heading's top is inside the scroller and `scrollTop` moved).
  4. **States, selection.** Selecting text in a changed sentence shows the floating `Comment` button
     (`[data-doc-review-comment]`) above the selection; a selection that runs into the next paragraph is clipped to the
     first (assert after step 5 that the card's anchor is the first paragraph's).
  5. **Main, comment.** Pressing `c` opens the draft card (accent border, textarea focused); typing a note and
     pressing Ctrl+Enter inside the textarea adds the comment: the saved card sits level with its paragraph
     (its top within 2 px of the paragraph's), the sentence is underlined with its number chip, Request changes is the
     accent button showing 1.
  6. **Main, draft and remove.** A second selection and a click on the Comment button open a second draft: the hint
     reads "1 comment is not added yet."; `Cancel` removes the draft and the hint; add that second comment, remove it
     with its remove button, and the count is back to 1.
  7. **Narrow.** Shrinking the viewport (`Emulation.setDeviceMetricsOverride`) until the pane is under 720 px puts
     the card below its paragraph (one column) and wraps the tray (the general note on its own row); restore the
     viewport.
  8. **Note.** Focusing `notes-writer`: no `Changes | PDF` tablist; the link renders as `<a>`; the added image
     renders as a `data:` `<img>` on the `--color-imagematte` matte with the `+ image · diagrams/pipeline.png` caption
     and the `diff-added` border; the unchanged run reads `1. – 4. · unchanged`.
  9. **Note, links.** Clicking the relative link opens `misses_audit.md` on the Code surface through `openref`
     (assert the active surface and the open file); returning to the Agent surface shows the review still open;
     clicking the `#`-anchor link scrolls the pane in place (surface unchanged, `scrollTop` moved).
  10. **Note, Approve.** With no comments, clicking Approve shows the sent line `Sent: Approve` and disables the
     tray's buttons.
  11. **Cockpit card.** On the Cockpit surface `paper-writer`'s card shows the `Doc review · N points` summary and its
     Review button; clicking the button switches to the Agent surface focused on that agent in review mode, with no
     dialog open.
  12. **Palette.** The command palette's Needs-you review row for `gone-writer` (opened as `brief-peek` opens it)
     focuses that agent in review mode.
  13. **States, terminal mode.** Pressing `r` shows the terminal and hides the review; the header's Review option
     carries the amber dot while the terminal shows; `r` again returns to review. Focusing another agent and clicking
     `paper-writer`'s tree-row `review` chip focuses `paper-writer` on the Agent surface in review mode, no dialog.
  14. **States, gone.** Focusing `gone-writer` shows `Couldn't read gone.md` and its path; the tray still renders and
     Approve is enabled.
  15. **States, sent.** On `paper-writer` (one saved comment), focusing the general note input and pressing Ctrl+Enter
     sends the accent answer: the tray shows `Sent: Request changes, 1 comment` in success colour, the card has no
     remove button and no textarea (read-only).
  16. **Round2.** Rewrite the `.tex` (two sentences modified, one inserted), write the roster with a new `askId`
     and focus lines `- 1: §2.1 ¶1 now opens with the null result`, call `window.__reloadDevMockRoster()`: the eyebrow
     reads `Doc review · round 2`, only the round-2 changes are marked, the meta reads `against what you reviewed at
     <HH:MM>`, comments are 0, the numbered focus line renders with its chip, and clicking it scrolls to the paragraph
     it names.
  17. **Round2, Approve.** With no comments, focusing the general note and pressing Ctrl+Enter sends Approve:
     `Sent: Approve`.
- [ ] **Step 5:** `task verify:ui -- doc-review-mode doc-review doc-review-canvas canvas-swap` passes on a running dev
  app (or run the Final line); Check passes.
- [ ] **Step 6:** Commit: `feat(review): the Doc review view on the Agent surface`.

### Task 9: The PDF tab

**Depends on:** Task 5, Task 8

**Files:**
- Create: `frontend/app/view/agents/docpdf.ts` (+ `docpdf.test.ts`): pure states and copy
- Create: `frontend/app/view/agents/docpdfpane.tsx`
- Modify: `frontend/app/view/agents/docreviewpane.tsx` (the PDF panel in Task 8's tab slot; the toolbar's PDF-side
  meta, chip and Recompile)
- Modify: `frontend/util/endpoints.ts` or a new `frontend/util/streamurl.ts`: `streamFileUrl(path)` with `authkey`
  (decision 3)
- Modify: `scripts/cdp/scenarios.mjs` (`doc-review-mode` gains steps 18–24)

**`docpdf.ts` interface:**

```ts
export type PdfPaneState = "compiling" | "ok" | "failed" | "noroot" | "noengine";
export function pdfPaneState(r: CommandDocCompileRtnData | null, pending: boolean): PdfPaneState;
export function overLimit(pages: number, limit?: number): number;      // pages over the limit, 0 if none
export function compiledMeta(r: CommandDocCompileRtnData, at: number): string; // "compiled 14:06 · latexmk · 6.2 s"
export function errorForAnswer(r: CommandDocCompileRtnData, file: string): string; // what "Add to my answer" appends
```

`pdfPaneState` precedence: `pending` → `compiling`; `RootPath ""` → `noroot`; `Engine ""` → `noengine`; `Ok false`
→ `failed`; else `ok`.

Behaviour per the spec's "When and how it shows" and `States.dc.html`: compile on opening the review (background),
again on Recompile, never on file change; one in-flight compile per review (a second Recompile while compiling is
disabled); the result is kept per `askId` so switching tabs does not recompile. "Add to my answer" appends
`errorForAnswer` to the general note (it sends nothing). The DEV-only `window.__docCompileFixture` and
`window.__docCompileCalls` (decision 10) replace and count the RPC for the scenario.

- [ ] **Step 1: Failing tests** `docpdf.test.ts`: each state from its result, including the precedence above (`RootPath
  ""` with `Engine ""` → `noroot`, `Engine ""` → `noengine`, `Ok false` with a `FirstError` → `failed`, pending →
  `compiling`); `overLimit(9, 8)` = 1, `overLimit(9)` = 0; `compiledMeta` formatting; `errorForAnswer` includes the
  file name and both log lines.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/docpdf.test.ts` → fails.
- [ ] **Step 3:** Implement the model, the pane (iframe on `streamFileUrl(PdfPath)`; WebView2's own viewer), the
  toolbar's PDF side (page count, the over-limit chip with its icon, the meta, Recompile), and the four non-ok
  panels from `States.dc.html`.
- [ ] **Step 4: Scenario steps 18–24** added to `doc-review-mode`, each with a shot. The arrange gains a minimal valid
  one-page PDF written from a string literal into the temp repo (`paper/sample.pdf`, no binary committed) and a
  fourth agent, `chapter-writer`, asking on `loose/chapter3.tex` (no `\documentclass`, no `.tex` root within two
  folders above):
  18. **Main, keys.** On `paper-writer`, `]` selects the `PDF` tab and `[` returns to `Changes` (assert
      `aria-selected`); on `notes-writer` `]` does nothing and there is no tablist.
  19. **Main, PDF.** With `window.__docCompileFixture({ pages: 9, pdfpath: <paper/sample.pdf> })` and the ask's `Pages:
      8`, the PDF tab loads the iframe (its `src` holds `/wave/stream-file` and `authkey=`), the toolbar shows
      `9 pages`, the chip `1 page over the 8-page limit` with its icon, and `compiled <HH:MM> · latexmk · 6.2 s`.
  20. **Main, real compile.** With the fixture cleared (`null`), Recompile is clicked: the button is disabled while
      compiling, then the real result lands (an `ok` pane with its page count, or, when `DocCompileCommand` reports
      `Engine ""` on this machine, the step records `skip` with that reason); `window.__docCompileCalls` went up by
      one.
  21. **States, failed.** `__docCompileFixture({ ok: false, firsterror: "! Undefined control sequence.\nl.212 …" })`:
      the failed panel shows the `!` line; `Add to my answer` puts the error and the file name in the general note
      (assert the input's value) and sends nothing; Recompile raises `__docCompileCalls`.
  22. **States, no root.** Focusing `chapter-writer` (the real RPC; it needs no engine) shows the no-root panel with
      the `% !TEX root` line.
  23. **States, compiling.** `__docCompileFixture("pending")`: the page skeleton, the elapsed time, and Recompile
      disabled.
  24. **States, no engine.** `__docCompileFixture({ ok: false, engine: "" })`: the no-engine panel.
- [ ] **Step 5:** `task verify:ui -- doc-review-mode doc-review doc-review-canvas` passes; Check passes.
- [ ] **Step 6:** Commit: `feat(review): the PDF tab compiles the paper and shows its page count`.

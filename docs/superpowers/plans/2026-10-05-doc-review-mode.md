# Doc review mode — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-02-doc-review-mode-design.md` — read it in full before your task.
**Verify:** `node scripts/verify.mjs ./pkg/doccompile/... ./pkg/wshrpc/... ./pkg/agentsync ./skills/...`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit && go vet ./pkg/doccompile/... ./pkg/wshrpc/... ./skills/...`
**Final:** `node scripts/cdp/final-verify.mjs doc-review-mode doc-review canvas-swap surface-smoke`
**Prototype:** D:/projects/arcterm/.superpowers/design/doc-review-mode/project/Main.dc.html

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement your task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Do not spawn subagents or forks.

**Goal:** An agent that finishes a section of a paper (`.tex`) or a markdown note asks a `Doc review`; Arc swaps the
agent's terminal for a review view with a sentence-level prose diff, comments anchored to passages, a compiled-PDF
tab, and Approve / Request changes, and sends the comments back as one structured answer.

**Architecture:** Pure models in `frontend/app/view/agents/`: `docprose.ts` (source → reading-view tokens),
`prosediff.ts` (sentence and word diff), `proseanchor.ts` (comments → answer text), `docbaseline.ts` (which "before"
to diff against), `docreviewview.ts` (rows and tray state for the view). State lives in `docreviewstore.ts`
(per-agent atom family, like `canvasstore.ts`); every "open the review" call goes through one `openReview`. The view
is `docreviewpane.tsx`, swapped in for the terminal the way `CanvasPane` is. The PDF tab calls a new
`DocCompileCommand` served by a new Go package, `pkg/doccompile`. A new shipped skill, `skills/doc-review`, tells
agents when and how to ask.

**Tech Stack:** React 19, jotai, TypeScript, vitest, Tailwind 4, KaTeX (already in the tree via mermaid; becomes a
direct dependency), Go (wshrpc + `task generate`), CDP scenarios (`scripts/cdp/scenarios.mjs`).

## Approved design

The mockup folder `D:/projects/arcterm/.superpowers/design/doc-review-mode/project/` is gitignored scaffolding:
read it at that absolute path. `Main.dc.html` is interactive (Terminal/Review, Changes/PDF, Whole file, click a
sentence to comment); `Narrow.dc.html`, `Note.dc.html`, `Round2.dc.html` and `States.dc.html` draw the other states.
The mockup wins on looks, the spec on behaviour. Its sample text, agent names, counts and times are not production
constants. Copy sizes and classes from the existing components the mockup copies (`canvaspane.tsx` toolbar and
tray, `agentheader.tsx`, `element/segmented.tsx`, `docreviewdialog.tsx` eyebrow), never its raw colours: in code
every colour is an `@theme` token.

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
   (`gitinfo.FileAtRef` resolves `ref:./path` against `cwd`).
5. **Shown content is recorded at send time.** When the user sends Approve or Request changes, the content the view
   showed becomes that file's baseline for the agent's next `Doc review` (decision 7 of the spec).
6. **Canvas and review are exclusive views.** One `setAgentView(agentId, "terminal" | "canvas" | "review")` sets both
   stores. With both a canvas and an open `Doc review`, the header shows one segmented control
   `Terminal | Canvas | Review`. In review mode the canvas keys stand down, and in canvas mode the review keys do.
7. **Ctrl+Enter inside a draft comment adds that comment;** anywhere else in review mode it sends the accent answer.
8. **Markdown tables and code blocks are placeholders**, like LaTeX figures: a table is one sentence
   `[Table: <header cells>]`, a fenced block one `code` token, neither sentence-split.
9. **Markdown section labels:** a `.md` section's `label` is its heading text, cut to 40 characters with `…`, so a
   comment's location reads `[5. Kế hoạch — 3 bước, nhưng tuần này… ¶2]`. LaTeX sections keep `§3.2`.
10. **DEV-only test hooks**, following `window.__waveDagModalFixture`: `window.__reloadDevMockRoster()` (re-runs
    `loadDevMockRoster`) and `window.__docCompileFixture(result | "pending" | null)` (the PDF pane shows the given
    result, or stays compiling, instead of calling the RPC). Both are gated on `import.meta.env.DEV`.

## Global constraints

- Colours only from `@theme` tokens; no raw hex/rgba in `className`/`style`. Diff tints are `bg-diff-added/15` and
  `bg-diff-removed/10` (Tailwind opacity modifiers). The one new token is `--color-imagematte` (Task 8).
- Testable logic in a pure `foo.ts` with `foo.test.ts` beside it; `.tsx` stays thin. No jsdom or render tests.
- Never hand-edit generated files (`wshclientapi.ts`, `gotypes.d.ts`, `wshclient.go`, …): edit Go, run
  `task generate` (Task 5 only).
- Spec review and Plan review keep the dialog, unchanged. `scripts/cdp/scenarios.mjs` `doc-review` and
  `doc-review-canvas` must keep passing.
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
// one word of text-like kinds, with its trailing whitespace in `text`; math, image and placeholder are one token each
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
  an unknown macro; md headings, list items, inline code, links, an image paragraph, a table placeholder, a fenced
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
    words?: WordChange[]; // modify only
}
export interface ParagraphChange { status: ChangeStatus; index: number; list?: boolean; sentences: SentenceChange[] }
export interface SectionChange {
    status: ChangeStatus; level: number; label: string; title: string;
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
  token inside a modified sentence keeps its kind in `words`.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/prosediff.test.ts` → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass; Check passes.
- [ ] **Step 5:** Commit: `feat(review): sentence-level prose diff`.

### Task 4: Comments and baseline (`proseanchor.ts`, `docbaseline.ts`)

**Depends on:** Task 2

**Files:**
- Create: `frontend/app/view/agents/proseanchor.ts`, `frontend/app/view/agents/proseanchor.test.ts`
- Create: `frontend/app/view/agents/docbaseline.ts`, `frontend/app/view/agents/docbaseline.test.ts`

**Interface (Tasks 7 and 8 rely on it):**

```ts
// proseanchor.ts
export interface ProseAnchor {
    sectionLabel: string; paragraph: number;      // ¶, 1-based, in the after-document
    sentences: [number, number];                  // first and last sentence index in that paragraph
    quote: string;                                // source text of those sentences, whitespace collapsed, ≤160 chars + "…"
    selectedText: string;
}
export interface ProseComment extends ProseAnchor { id: string; note: string; draft: boolean }
export const QUOTE_MAX = 160;
export function anchorFor(source: string, para: { label: string; index: number; sentences: ProseSentence[] },
    first: number, last: number, selectedText: string): ProseAnchor;
export function orderComments(comments: ProseComment[]): ProseComment[]; // document order, drafts included
export function formatRequest(comments: ProseComment[], generalNote: string): string; // the spec's answer text; drafts skipped
export function canRequest(comments: ProseComment[], generalNote: string): boolean;

// docbaseline.ts
export type BaselineFrom = "previous" | "session" | "head" | "new";
export function pickBaseline(input: { shown?: string; atSession?: string | null; atHead?: string | null }):
    { text: string; from: BaselineFrom };
```

Order for comments is section order, then paragraph, then first sentence (sections compared by their position in
the document, so pass the after-doc's section label order in, or store a numeric section index on the anchor —
your choice, documented in the file). A selection across paragraphs is clipped by the caller to its first paragraph;
`anchorFor` only ever sees one paragraph.

- [ ] **Step 1: Failing tests** — the spec's `proseanchor.test.ts` and `docbaseline.test.ts` lists: a multi-sentence
  anchor quotes the source of every covered sentence (LaTeX macros intact, e.g. `\emph{XYZ}`); a 300-character quote
  is cut to 160 + `…`; `formatRequest` matches the spec's sample exactly (numbering, `[§5.2 ¶2] "…"`, `   → note`,
  `General:` only when non-empty, drafts left out); `canRequest` false with only drafts and no note; `pickBaseline`
  returns each fallback in order (`shown`, even `""`, wins; then `atSession`; `atSession` null → `atHead`; both
  null → `new` with empty text).
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/proseanchor.test.ts frontend/app/view/agents/docbaseline.test.ts`
  → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests pass; Check passes.
- [ ] **Step 5:** Commit: `feat(review): anchored comments and the diff baseline`.

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
    Engine     string `json:"engine"`     // "latexmk" | "tectonic" | "" (none on PATH)
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
request that arrives while one runs waits for it and gets its result; `LogTail` = the log's last 40 lines. Spawn the
engine the way other wavesrv subprocesses are spawned on Windows (find the existing helper; no console window).
Keep the engine runner and the data dir behind package-level variables so tests can substitute them.

- [ ] **Step 1: Failing tests** in `doccompile_test.go`: `FindTexRoot` — magic comment (relative path resolved
  against the file's dir), the file itself with `\documentclass`, `main.tex` two levels up preferred over another
  root `.tex`, none → `""`; `PagesFromLog` on a pdfTeX line, a XeTeX `.xdv` line, a `1 page` line, and no line;
  `FirstErrorFromLog` on a real `Undefined control sequence` log excerpt; the output dir is under the substituted data
  dir and outside the root's dir; two concurrent `Compile` calls on one root run the substituted engine once and
  both get its result; with no engine on the substituted PATH lookup, `Ok: false`, `Engine: ""`; a real compile of a
  minimal document, `t.Skip` when neither `latexmk` nor `tectonic` is on PATH.
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
  (Needs-you review), `agentsurface.tsx` (the auto-open effect: a `Doc review` sets the mode to `review` instead)
- Modify: `frontend/app/view/agents/cockpitshell.tsx` (mount `useDocReviewSync(model)`: always-mounted shell)
- Modify: `frontend/app/store/keybindings/bindings.ts`, `whenstate.ts`, `store.test.ts` (completeness)
- Modify: `docs/keyboard-shortcuts.md` (new "Agent: review mode" subsection beside "Agent: canvas mode")

**Interface (Task 8 relies on it):**

```ts
export type DocReviewMode = "terminal" | "review";
export type DocReviewTab = "changes" | "pdf";
export interface DocReviewState {
    askId: string; path: string; doc: "latex" | "markdown";
    mode: DocReviewMode; tab: DocReviewTab; wholeFile: boolean;
    comments: ProseComment[]; generalNote: string;
    sent: "approve" | "request" | null;
}
export const docReviewStateAtom: (agentId: string) => PrimitiveAtom<DocReviewState | null>; // atomFamily
export const shownContentAtom: (agentId: string) => PrimitiveAtom<Record<string, string>>;   // abs path → text
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
export function markSent(agentId: string, which: "approve" | "request", shownText: string): void; // records shown content (decision 5)
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

- [ ] **Step 1: Failing tests** `docreviewstore.test.ts`: a first `Doc review` ask creates state in `terminal` mode;
  the same `askId` again keeps comments; a new `askId` resets comments, note, tab, `wholeFile` and `sent` but keeps
  `shownContentAtom`; an agent whose ask clears goes to `null`; a Spec review ask creates no state; `openReview` on a
  `Doc review` focuses the agent, sets surface `agent` and mode `review`, and on a Spec review sets `docReviewAtom`;
  `markSent` stores the shown text under the path. `agentview.test.ts`: `review` puts the canvas in `terminal` mode,
  `canvas` puts the review in `terminal` mode. `bindings.test.ts`/`store.test.ts`: `r` resolves to exactly one
  binding in each mode; completeness passes.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/docreviewstore.test.ts frontend/app/view/agents/agentview.test.ts frontend/app/store/keybindings`
  → fails.
- [ ] **Step 3:** Implement, then route every call site listed above through `openReview`.
- [ ] **Step 4:** Tests pass; Check passes; `docs/keyboard-shortcuts.md` lists every new binding.
- [ ] **Step 5:** Commit: `feat(review): review state, one router to open a review, and its keys`.

### Task 8: The review view — Changes tab, comments, tray

**Depends on:** Task 3, Task 7

**Files:**
- Create: `frontend/app/view/agents/docreviewview.ts` (+ `docreviewview.test.ts`): pure rows and tray state
- Create: `frontend/app/view/agents/docreviewload.ts`: async loads (current file, baseline per decision 4, image data
  URLs per decision 3), keyed by `askId` so a stale load never lands on a newer review
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
- Modify: `scripts/cdp/scenarios.mjs` (new scenario `doc-review-mode`; Task 9 adds PDF steps to it)

**`docreviewview.ts` interface:**

```ts
export const COMMENT_COLUMN_MIN_PANE = 720;
export interface ReviewRow { /* a section heading, an "unchanged" run with its labels, or a paragraph with its
    sentence changes and its comments */ }
export function reviewRows(changes: SectionChange[], comments: ProseComment[], wholeFile: boolean): ReviewRow[];
export function trayState(comments: ProseComment[], generalNote: string, agentName: string):
    { accent: "approve" | "request"; requestEnabled: boolean; saved: number; drafts: number; hint: string };
export function metaLine(changes: SectionChange[], from: BaselineFrom, ref: string, reviewedAt?: number): string;
```

What the pane draws is `Main.dc.html` (Changes tab), `Narrow.dc.html`, `Note.dc.html`, `Round2.dc.html` and the
non-PDF panels of `States.dc.html`, with the spec's "Layout" section for behaviour: the toolbar (no tab control for
`.md`), the head with eyebrow, intro and focus items (numbered items from `focusItem` render as numbered lines,
others as chips that scroll to their section), the paragraph grid `minmax(0,1fr) 300px` with comment cards level
with their paragraph (one column under `COMMENT_COLUMN_MIN_PANE`), the "unchanged" rows and `Show whole file`, the
selection's floating `Comment` button (`data-doc-review-comment`; a selection is mapped to sentences through a
`data-s` index on each rendered sentence and clipped to its first paragraph), draft and saved cards, the tray
(`data-doc-review-send` on the accent answer; Approve and Request changes answer through the model's existing
`toggleAnswer` / `setAnswerText` + `submitAnswer`, with `formatRequest` as the text, then `markSent`), the sent line,
and `Couldn't read <file>` when the file is gone. `.md` links to `.md` files open through `openref`; `#anchors`
scroll in place.

- [ ] **Step 1: Failing tests** `docreviewview.test.ts`: rows for changed-only vs `wholeFile`; a run of unchanged
  sections collapses to one row naming them; comments attach to their paragraph row in document order; `trayState`
  — no comments: accent `approve`, request disabled; one saved: accent `request`, hint "Sends 1 comment to <agent> as
  one answer."; a note only: request enabled, "and your note"; a draft adds "1 comment is not added yet."; `metaLine`
  for session, head, new and previous baselines.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/docreviewview.test.ts` → fails.
- [ ] **Step 3:** Implement the model, the loads, the pane, the header control and the surface swap.
- [ ] **Step 4: CDP scenario `doc-review-mode`.** Arrange: a temp git repo with `paper/main.tex` and
  `notes/next_step.md` committed, then edited (sentences inserted, deleted and modified, one with `\texttt`), a
  relative link and a small PNG in the note; the fixture roster from `arrangeFixtureRun`'s pattern with one agent
  asking `Doc review` on the `.tex` (no transcript, so the baseline is HEAD) and one on the `.md`. Steps, each with a
  shot:
  1. `Main`: focusing the agent auto-switches to review; struck, inserted and word-modified sentences render; the
     xterm node is the same node as before the swap (tag it first, as `canvas-swap` does).
  2. `Main`: select text in a changed sentence → Comment → type → Add comment; the card sits level with its
     paragraph; Request changes becomes the accent button showing 1; a second draft shows the "not added yet" hint.
  3. `Narrow`: shrink the pane below 720 px (window resize over CDP); the card follows its paragraph; the tray wraps.
  4. `Note`: the `.md` agent: no tab control, the link renders as a link, the image renders on the matte.
  5. `States`: terminal mode with the Review option's amber dot; `r` toggles review ↔ terminal; with no comments
     Approve is the accent button and Request changes is disabled.
  6. `States` + `Round2`: send Request changes → the sent line shows; the comments become read-only; then rewrite
     the `.tex`, write the roster with a new `askId` and `- 1: …` focus lines, `window.__reloadDevMockRoster()`;
     the view shows only the round-2 changes, the meta says "against what you reviewed at …", and the numbered
     focus lines render.
  Teardown removes the temp repo and the fixture as the existing doc-review scenario does.
- [ ] **Step 5:** `task verify:ui -- doc-review-mode doc-review canvas-swap` passes on a running dev app (or run the
  Final line); Check passes.
- [ ] **Step 6:** Commit: `feat(review): the Doc review view on the Agent surface`.

### Task 9: The PDF tab

**Depends on:** Task 5, Task 8

**Files:**
- Create: `frontend/app/view/agents/docpdf.ts` (+ `docpdf.test.ts`): pure states and copy
- Create: `frontend/app/view/agents/docpdfpane.tsx`
- Modify: `frontend/app/view/agents/docreviewpane.tsx` (tab wiring; the toolbar's PDF-side meta, chip and
  Recompile)
- Modify: `frontend/util/endpoints.ts` or a new `frontend/util/streamurl.ts`: `streamFileUrl(path)` with `authkey`
  (decision 3)
- Modify: `scripts/cdp/scenarios.mjs` (`doc-review-mode` gains the PDF steps)

**`docpdf.ts` interface:**

```ts
export type PdfPaneState = "compiling" | "ok" | "failed" | "noroot" | "noengine";
export function pdfPaneState(r: CommandDocCompileRtnData | null, pending: boolean): PdfPaneState;
export function overLimit(pages: number, limit?: number): number;      // pages over the limit, 0 if none
export function compiledMeta(r: CommandDocCompileRtnData, at: number): string; // "compiled 14:06 · latexmk · 6.2 s"
export function errorForAnswer(r: CommandDocCompileRtnData, file: string): string; // what "Add to my answer" appends
```

Behaviour per the spec's "When and how it shows" and `States.dc.html`: compile on opening the review (background),
again on Recompile, never on file change; one in-flight compile per review (a second Recompile while compiling is
disabled); the result is kept per `askId` so switching tabs does not recompile. "Add to my answer" appends
`errorForAnswer` to the general note (it sends nothing). The DEV-only `window.__docCompileFixture` (decision 10)
replaces the RPC result for the scenario.

- [ ] **Step 1: Failing tests** `docpdf.test.ts`: each state from its result (`RootPath ""` → `noroot`, `Engine ""` →
  `noengine`, `Ok false` with a `FirstError` → `failed`, pending → `compiling`); `overLimit(9, 8)` = 1,
  `overLimit(9)` = 0; `compiledMeta` formatting; `errorForAnswer` includes the file name and both log lines.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/docpdf.test.ts` → fails.
- [ ] **Step 3:** Implement the model, the pane (iframe on `streamFileUrl(PdfPath)`; WebView2's own viewer), the
  toolbar's PDF side (page count, the over-limit chip with its icon, the meta, Recompile), and the four non-ok
  panels from `States.dc.html`.
- [ ] **Step 4: Scenario steps** added to `doc-review-mode`, each with a shot:
  7. `Main`: the PDF tab of the arranged `.tex` with `Pages: 1` in the ask: the iframe loads, "N pages" and the
     over-limit chip show — `skip` with the reason when `DocCompileCommand` reports `Engine ""` on this machine.
  8. `States`: a `.tex` with an undefined macro → the failed panel with the `!` line; Add to my answer puts it in the
     general note.
  9. `States`: a `.tex` with no `\documentclass` and no root above → the no-root panel with the `% !TEX root` line.
  10. `States`: `__docCompileFixture("pending")` → the compiling panel, Recompile disabled;
      `__docCompileFixture({ … engine: "" })` → the no-engine panel.
- [ ] **Step 5:** `task verify:ui -- doc-review-mode` passes; Check passes.
- [ ] **Step 6:** Commit: `feat(review): the PDF tab compiles the paper and shows its page count`.

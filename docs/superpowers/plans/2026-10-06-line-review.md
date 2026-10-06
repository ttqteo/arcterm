# Line review — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-06-line-review-design.md` — read it in full before your task.
**Verify:** `node scripts/verify.mjs ./pkg/gitinfo/... ./pkg/wshrpc/...`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit && go vet ./pkg/gitinfo/... ./pkg/wshrpc/...`
**Final:** `node scripts/cdp/final-verify.mjs line-review git-history diff-compare code-diff surface-smoke`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement your task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Do not spawn subagents or forks.

**Goal:** In the Diff surface, a **Review** mode stacks every changed file of the selected commit or of the
uncommitted work in one scroll; the user hovers a line, presses **+**, comments on a line or a range, and sends every
comment to the agent as one message pasted into its terminal.

**Architecture:** The patch comes from a new `GitReviewPatchCommand` (`pkg/gitinfo.ReviewPatch`, one `git diff` split
per file). Pure models in `frontend/app/view/agents/`: `linecomments.ts` (comment type, order, the message),
`reviewlist.ts` (patch files → sections, rows and folds, through the existing `diffFileView`/`parseUnifiedDiff` in
`gitdiff.ts`). State lives in `linecommentstore.ts` (an atom family per repository, like `docreviewstore.ts`), sending
in `linereviewsend.ts` (`pasteIntoTerm` + Enter). The view is `reviewlist.tsx`, rendered by `diffpane.tsx` in Review
mode; `linereviewtray.tsx` is pinned to the pane's bottom. The Code surface's one-line `SendToAgent` goes away.

**Tech Stack:** React 19, jotai, TypeScript, vitest, Tailwind 4, Go (wshrpc + `task generate`), CDP scenarios
(`scripts/cdp/scenarios.mjs`).

## Look

There is no mockup. The reference is Antigravity's Review panel as the spec describes it, built from Arc's own
pieces and DESIGN.md: the file header like `changedfilelist.tsx`'s rows, line numbers and code in `font-mono`,
`bg-diff-added/15` and `bg-diff-removed/10` rows as in `docreviewpane.tsx`, the comment box and cards like Doc
review's draft comment and `CommentCard`, the tray like Doc review's tray. Every colour is an `@theme` token.

## Decisions this plan adds to the spec

1. **The size cap is the caller's.** `GitReviewPatchCommand` takes `maxbytes` per file, as `GitFileAtRefCommand`
   does; the frontend passes `MAX_DIFF_BYTES` (`diffcontentstore.ts`).
2. **Binary files need no flag.** The RPC passes git's own patch text for a binary file; `parseUnifiedDiff` already
   reads it as binary.
3. **A row's identity is `side:line`.** `new:42` is line 42 of the new file (an added or context row); `old:12` is
   line 12 of the old file (a removed row). A context row is commented on its new side. Ranges never mix sides or
   files.
4. **The quote is taken from the review's own rows** when the comment is added, so it is the text the user saw.
5. **Comments carry their source** (`"worktree"` or a commit hash). The tray counts them all; the message header
   names the source of the comments being sent, and a send from mixed sources names each source on its comments.
6. **The DEV sink.** In DEV builds `window.__lineReviewSink`, when it is a function, receives the message instead of
   a terminal. Production code never reads it otherwise.

### Task 1: `GitReviewPatchCommand` and `gitinfo.ReviewPatch`

**Depends on:** none

**Files:**
- Modify: `pkg/gitinfo/gitinfo.go` (add `ReviewPatch`), `pkg/gitinfo/gitinfo_test.go`
- Modify: `pkg/wshrpc/wshrpctypes_git.go` (add to `GitCommands`, data and return types)
- Modify: `pkg/wshrpc/wshserver/wshserver_git.go` (a thin handler, as `GitFileAtRefCommand` is)
- Regenerate (never hand-edit): `task generate` → `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`,
  `pkg/wshrpc/wshclient/wshclient.go`

**Interface (Task 5 relies on the generated `RpcApi.GitReviewPatchCommand`):**

```go
// pkg/wshrpc/wshrpctypes_git.go
GitReviewPatchCommand(ctx context.Context, data CommandGitReviewPatchData) (*CommandGitReviewPatchRtnData, error)

type CommandGitReviewPatchData struct {
    Cwd      string `json:"cwd"`
    Hash     string `json:"hash,omitempty"` // "" = the working tree against HEAD, untracked files included
    MaxBytes int64  `json:"maxbytes"`       // per file
}
type CommandGitReviewPatchRtnData struct {
    IsRepo bool              `json:"isrepo"`
    Files  []ReviewPatchFile `json:"files"`
}
type ReviewPatchFile struct {
    Path      string `json:"path"`
    OldPath   string `json:"oldpath,omitempty"`
    Diff      string `json:"diff,omitempty"`      // this file's unified patch
    Untracked bool   `json:"untracked,omitempty"`
    Content   string `json:"content,omitempty"`   // an untracked file's text
    TooLarge  bool   `json:"toolarge,omitempty"`
    Size      int64  `json:"size,omitempty"`
}

// pkg/gitinfo
func ReviewPatch(ctx context.Context, cwd, hash string, maxBytes int64) (*ReviewPatchResult, error)
```

Behaviour per the spec's "Data" section: one `git diff` (working tree: `git diff HEAD`; commit: `git show
--format= <hash>`, the root commit against the empty tree), split on `diff --git` headers, renames detected
(`-M`), paths relative to the repository root, in git's order; each untracked file (`git ls-files --others
--exclude-standard`) read once. A file whose patch or content is over `maxBytes` gets `TooLarge` and `Size` and no
text. A cwd that is not a repository returns `IsRepo: false` and no error. Run git the way the other `gitinfo`
functions do.

- [ ] **Step 1: Failing tests** in `gitinfo_test.go`, on a temp repo: a modified file (its patch has its hunk), an
  added file, a removed file, a renamed file (`OldPath` set), an untracked file (`Untracked`, `Content`), a binary
  file (its patch says so), a commit's patch by hash, the root commit, a file over `maxBytes` (`TooLarge`, `Size`, no
  text), a non-repo (`IsRepo: false`).
- [ ] **Step 2:** `go test ./pkg/gitinfo -run 'TestReviewPatch'` → fails.
- [ ] **Step 3:** Implement `ReviewPatch`, the RPC types and the handler. Run `task generate`.
- [ ] **Step 4:** The tests pass; Check passes; `git diff --stat` shows the generated files changed only by
  `task generate`.
- [ ] **Step 5:** Commit: `feat(git): GitReviewPatchCommand, a selection's patch split per file`.

### Task 2: `linecomments.ts` — the comment and the message

**Depends on:** none

**Files:**
- Create: `frontend/app/view/agents/linecomments.ts`, `frontend/app/view/agents/linecomments.test.ts`

**Interface (Tasks 4, 5 and 6 rely on it):**

```ts
export type CommentSide = "new" | "old";
export interface LineComment {
    id: string;
    source: string; // "worktree" or a commit hash
    file: string; // repository-relative path
    side: CommentSide;
    startLine: number;
    endLine: number; // >= startLine
    quote: string[]; // the range's lines as shown, taken when the comment is added
    note: string;
}
export interface CommentSource {
    id: string; // "worktree" or a hash
    label: string; // "your changes", or "commit abc1234 (subject)"
}
export const QUOTE_LINES = 3;
export const QUOTE_WIDTH = 120;
export function orderComments(comments: LineComment[], fileOrder: string[]): LineComment[];
export function formatLineComments(comments: LineComment[], fileOrder: string[], sources: CommentSource[]): string;
export function commentRef(c: LineComment): string; // "path:42", "path:88-94", "path:12 (removed line)"
```

The message is exactly the spec's "The message" section: `Review comments on <label> (<n>):`, a blank line, then
numbered comments in `orderComments` order (file order, then `new` before `old`, then start line); each is
`<n>. <commentRef>`, up to `QUOTE_LINES` quoted lines as `   > <line>` cut at `QUOTE_WIDTH` characters with `…`,
`   > … (<k> more lines)` when the range is longer, then the note with each of its lines indented 3 spaces. A range
on the old side reads `(removed lines)`. With comments from more than one source, the header reads `Review
comments (<n>):` and each comment's ref ends with ` in <label>`.

- [ ] **Step 1: Failing tests:** one line; a range of 3 lines; a range of 8 lines (3 quoted, `… (5 more lines)`); a
  quoted line over 120 characters; a removed line and removed lines; a commit source's header; mixed sources; a
  note with two lines; ordering across two files and both sides; `commentRef` for each shape.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/linecomments.test.ts` → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass; Check passes.
- [ ] **Step 5:** Commit: `feat(review): line comments and the message they send`.

### Task 3: `reviewlist.ts` — patch files to sections, rows and folds

**Depends on:** none

**Files:**
- Create: `frontend/app/view/agents/reviewlist.ts`, `frontend/app/view/agents/reviewlist.test.ts`

**Interface (Task 5 relies on it):**

```ts
// structurally the generated ReviewPatchFile (Task 1), and the side is linecomments.ts's CommentSide (Task 2):
// both are declared here so this task waits on neither
export interface ReviewPatchFileLike {
    path: string; oldpath?: string; diff?: string; untracked?: boolean; content?: string; toolarge?: boolean; size?: number;
}
export type ReviewRow =
    | { kind: "line"; key: string /* "new:42" | "old:12" */; side: "new" | "old"; line: number;
        oldNo: string; newNo: string; sign: string; text: string; change: "add" | "del" | "ctx" }
    | { kind: "fold"; id: string; hidden: number };
export interface ReviewSection {
    path: string; name: string; dir: string; oldPath?: string;
    adds: number; dels: number;
    rows: ReviewRow[]; // folds already applied
    empty?: "binary" | "toolarge" | "renamed" | "nochange"; // why there are no rows
    size?: number; // for "toolarge"
}
export const FOLD_CONTEXT = 3;
export function reviewSections(files: ReviewPatchFileLike[], expandedFolds: ReadonlySet<string>): ReviewSection[];
export function rowsInRange(section: ReviewSection, from: string, to: string): ReviewRow[] | null; // null across sides
```

Each file goes through `diffFileView` (`gitdiff.ts`); its `DiffLine`s become rows. A row's side and line follow
decision 3. Hunk header rows are not rendered: the gaps between hunks become fold rows. A run of more than
`2 * FOLD_CONTEXT + 1` unchanged rows inside a hunk keeps `FOLD_CONTEXT` on each side and folds the rest, unless its
fold id is in `expandedFolds`. `empty` comes from the `FileView` (binary, too large, a rename with no changes).

- [ ] **Step 1: Failing tests:** a modified file's rows, sides, line numbers and counts; an added and an untracked
  file (all `new`); a removed file (all `old`); a long unchanged run folds with 3 rows on each side and expands when
  its id is passed; the gap between two hunks is a fold; binary, too large and a pure rename give `empty` and no
  rows; `name`/`dir` split; `rowsInRange` within a side and `null` across sides.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/reviewlist.test.ts` → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass; Check passes.
- [ ] **Step 5:** Commit: `feat(review): the review list model over a selection's patch`.

### Task 4: `linecommentstore.ts` and `linereviewsend.ts`

**Depends on:** Task 2

**Files:**
- Create: `frontend/app/view/agents/linecommentstore.ts`, `frontend/app/view/agents/linecommentstore.test.ts`
- Create: `frontend/app/view/agents/linereviewsend.ts`, `frontend/app/view/agents/linereviewsend.test.ts`

**Interface (Tasks 5 and 6 rely on it):**

```ts
// linecommentstore.ts — keyed by the Diff scope's cwd
export interface CommentBox {
    file: string; side: CommentSide; startLine: number; endLine: number; source: string;
    text: string; editingId?: string;
}
export interface LineReviewState { comments: LineComment[]; box?: CommentBox; lastSend?: { ok: boolean; text: string } }
export const lineReviewAtom: (repoKey: string) => PrimitiveAtom<LineReviewState>;
export const reviewModeAtom: PrimitiveAtom<"file" | "review">;
export function openBox(repoKey: string, box: Omit<CommentBox, "text">): void; // keeps an open box's text (spec)
export function setBoxText(repoKey: string, text: string): void;
export function addComment(repoKey: string, quote: string[]): LineComment | null; // from the box; null when blank
export function editComment(repoKey: string, id: string): void; // opens the box on it
export function deleteComment(repoKey: string, id: string): void;
export function cancelBox(repoKey: string): void;
export type SendBlock = { kind: "asking"; agent: string } | { kind: "draft" } | null;
export function sendBlock(state: LineReviewState, target: AgentVM | null): SendBlock;
export function recordSend(repoKey: string, result: { ok: true; agent: string } | { ok: false; error: string }): void;

// linereviewsend.ts
export async function sendLineComments(agent: AgentVM, text: string): Promise<{ ok: true } | { ok: false; error: string }>;
```

`recordSend` clears the comments on success and keeps them on failure, writing the tray line of the spec's "The
tray". `sendLineComments` follows the spec's "Sending": the DEV sink first (decision 6), else `pasteIntoTerm`, then
`ControllerInputCommand` with `\r`; a `false` paste or a thrown RPC becomes `{ ok: false, error }` naming the agent.

- [ ] **Step 1: Failing tests:** open, type, add, edit (the box opens on the comment's text, saving replaces it),
  delete, cancel; opening a second box keeps the first box's text as a draft; a blank box adds nothing; `sendBlock`
  for an asking agent, an unsaved box, and neither; `recordSend` clears on success and keeps on failure; in
  `linereviewsend.test.ts`, with `pasteIntoTerm` and `RpcApi` mocked: the paste then `\r`; a `false` paste fails
  without sending `\r`; a thrown RPC fails with its message; the sink receives the text and nothing else is called.
- [ ] **Step 2:** `npx vitest run frontend/app/view/agents/linecommentstore.test.ts frontend/app/view/agents/linereviewsend.test.ts` → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass; Check passes.
- [ ] **Step 5:** Commit: `feat(review): line comment drafts and sending them to an agent`.

### Task 5: The Review mode — stacked files and commenting

**Depends on:** Task 1, Task 3, Task 4

**Files:**
- Create: `frontend/app/view/agents/reviewlist.tsx`
- Modify: `frontend/app/view/agents/diffpane.tsx` (the File | Review control in its header; Review renders
  `ReviewList` in place of the Monaco viewer), `frontend/app/view/agents/filessurface.tsx` (pass the selection and
  the scroll-to-file request), `frontend/app/view/agents/commitpane.tsx` only if the file click needs to reach Review
- Modify: `scripts/cdp/scenarios.mjs` (new scenario `line-review`)

Behaviour per the spec's "The Review view": the control shows for the Uncommitted row and for a commit, not in
compare mode, and its choice is `reviewModeAtom`. Review loads `RpcApi.GitReviewPatchCommand({ cwd, hash, maxbytes:
MAX_DIFF_BYTES })` for the selection (no hash for Uncommitted), shows the pane's existing skeleton while loading and
an error line with a Retry button if the RPC fails, and renders `reviewSections`: sticky collapsible headers, rows
with `highlightLine`, wrapped text, fold rows that expand in place. Hover shows **+**; click opens the box below the
row (`openBox`); drag from a **+** or shift-click a second **+** selects a range on one side (`rowsInRange`), tinted
`bg-accent/10`; the box adds with Ctrl+Enter or **Add Comment** and cancels with Esc or **Cancel**; saved comments
render as cards below their range (number from `orderComments`, `commentRef`, note, × deletes, clicking the note
edits). Clicking a file in the commit pane's file list while in Review scrolls to its header. Add `data-` hooks for
the scenario: `data-review-list`, `data-review-file="<path>"`, `data-review-row="<side:line>"`, `data-review-add`,
`data-review-box`, `data-review-card`, `data-review-fold`, `data-diff-mode="file|review"`.

The scenario `line-review` arranges a temp repo the way `git-history` does (`git` helper, `createproject`), commits
two files, then leaves uncommitted changes: one file with an edited line, a long unchanged run between two edits, and
3 removed lines; a second file with added lines. It injects a fixture agent whose project is the scenario's project
(the fixture-roster mechanism `doc-review-mode` uses) and opens the Diff surface on that project.

- [ ] **Step 1:** Write the scenario's arrange and these steps, each with a shot, so they fail first:
  1. selecting Uncommitted and Review shows `data-review-list` with both files' headers and their `+N −M`;
  2. collapsing a file hides its rows and expanding brings them back; the long unchanged run is a fold that expands;
  3. **+** on an added row opens the box; typing and Ctrl+Enter makes a card with `path:<line>` and the note;
  4. a 3-row range by shift-click is tinted, and its card reads `path:<a>-<b>`;
  5. **+** on a removed row makes a card reading `(removed line)`; clicking a file in the commit pane scrolls Review to
     its header.
- [ ] **Step 2:** Implement `reviewlist.tsx` and the wiring.
- [ ] **Step 3:** `npx vitest run frontend/app/view/agents/reviewlist.test.ts frontend/app/view/agents/linecommentstore.test.ts`
  still passes; Check passes.
- [ ] **Step 4:** Commit: `feat(review): a Review mode in the Diff surface with line comments`.

### Task 6: The tray, the send key and the scenario's send steps

**Depends on:** Task 5

**Files:**
- Create: `frontend/app/view/agents/linereviewtray.tsx`
- Modify: `frontend/app/view/agents/diffpane.tsx` (mount the tray at the pane's bottom in both modes)
- Modify: `frontend/app/store/keybindings/bindings.ts` (`buildFilesBindings`: `files:review-send`, Ctrl+Enter),
  `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/cockpit/footerhints.ts`,
  `docs/keyboard-shortcuts.md`
- Modify: `scripts/cdp/scenarios.mjs` (`line-review` steps 6 and 7)

Behaviour per the spec's "The tray" and "Keys": the count line, **Send N comments** to the Diff scope's agent or,
with none, the project's live agents (`liveAgentsForProject`: one direct, several a menu, none **Copy**), the blocked
lines from `sendBlock`, `Sent to <agent>` in `text-success` and the failure line in `text-error` from `lastSend`. The
message is `formatLineComments` over the review's file order and the comments' sources. `files:review-send` is
active only when the tray can send and focus is not in a comment box (the box keeps its own Ctrl+Enter); its
`when()` reads `lineReviewAtom` through the PREDICATE_ATOMS rule in `whenstate.ts`, keeping the completeness test in
`store.test.ts` green. Add `data-review-tray`, `data-review-send`, `data-review-tray-line`.

- [ ] **Step 1:** Add the scenario steps, each with a shot, so they fail first:
  6. with `window.__lineReviewSink` set, **Send** delivers exactly the `formatLineComments` text for the three
     comments (compare it to the expected string), the tray reads `Sent to <agent>`, and the cards are gone;
  7. with the fixture agent's ask open (write the roster with an ask and reload it, as `doc-review-mode` does) and
     one new comment, the send button is disabled and the tray line reads `<agent> is waiting on a question — answer
     it first`.
- [ ] **Step 2:** Failing binding tests in `bindings.test.ts`: Ctrl+Enter resolves to `files:review-send` only with
  comments and no open box, and to nothing while typing in a box or with a blocked send.
- [ ] **Step 3:** Implement the tray, the binding, the footer hint and the docs row.
- [ ] **Step 4:** `npx vitest run frontend/app/store/keybindings` passes; Check passes.
- [ ] **Step 5:** Commit: `feat(review): send line comments to the agent from a tray`.

### Task 7: Remove the Code surface's one-line "Send to agent"

**Depends on:** none

**Files:**
- Modify: `frontend/app/view/code/codepathbar.tsx` (remove `SendToAgent` and its mount)
- Modify: `scripts/cdp/scenarios.mjs` (`code-diff`)

Remove the component and every import only it used. `codehandoff.ts` stays whole: `handoffLine` sends canvas marks
(`canvasmarks.ts`) and Task 6's tray uses `liveAgentsForProject`.

- [ ] **Step 1:** Add a step to `code-diff`, after it opens a file: the path bar has no button reading `Send to agent`
  or `Copy reference`. It fails first.
- [ ] **Step 2:** Remove `SendToAgent`.
- [ ] **Step 3:** `npx vitest run frontend/app/view/code` passes; Check passes.
- [ ] **Step 4:** Commit: `refactor(code): drop the one-line Send to agent; line review replaces it`.

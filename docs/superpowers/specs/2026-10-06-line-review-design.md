# Line review — commenting on an agent's diff line by line — design

## Problem

The Diff surface shows what an agent changed, one file at a time, in a read-only Monaco diff editor. To
send feedback on a line, the user goes back to the agent's terminal and types the file, the line and the
point by hand. The Code surface's "Send to agent" sends one line (`look at file:L1-L2 — note`), because it
types into the terminal and a newline would submit early.

The user wants what Antigravity's Review panel does: read every changed file in one scroll, hover a line,
press **+**, leave a comment, comment on a range of lines, and send all comments to the agent at once.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | A **Review** mode in the Diff surface's diff pane, beside today's single-file view (**File \| Review**). | Chosen by the user. Reviewing an agent's work is what the Diff surface is for, and its scope already names the agent. |
| 2 | Review stacks every changed file of the selection in one scroll: a collapsible header per file (`name  dir  +N −M`), a unified diff, wrapped lines, unchanged runs folded to 3 lines of context. | Chosen by the user from Antigravity's Review panel. |
| 3 | Review renders its own rows (`gitdiff.ts` + `highlight.ts`), not Monaco. | A comment card is then a React row between two code rows. Monaco would need view zones and portals for every card, and one editor per file. |
| 4 | Review works for the Uncommitted row and for any single commit. Compare mode is out of scope. | Feedback can be about work the agent already committed. |
| 5 | Comments are drafted and kept, then sent together as **one** message. | Chosen by the user over sending each comment as it is added, which interrupts the agent once per line. |
| 6 | The message is pasted into the agent's terminal (bracketed paste) and submitted with Enter. | Chosen by the user. Multi-line text survives a paste; typed input submits at its first newline. A busy agent queues it. |
| 7 | Each comment carries its path, its line range and up to 3 quoted lines. | The agent may have edited the file since; the quote finds the place when the numbers have moved. |
| 8 | Either side of a diff can be commented: an added or context line (new side) or a removed line (old side). | "Why did you delete this?" is a review comment too. |
| 9 | Sending is blocked while the agent has an open ask. | Pasted text would land in the ask's answer field. |
| 10 | Drafts live in a jotai atom per repository, in memory only. | They survive switching surfaces (the Diff surface unmounts), not a restart; they are drafts until sent. |
| 11 | The Code surface's one-line "Send to agent" (`codepathbar.tsx` `SendToAgent`, `codehandoff.ts` `handoffLine`) is removed. | One way to send feedback on code. The Code surface gets line comments in a later stage, reusing this design's store, tray and format. |

## Data: `GitReviewPatchCommand`

A new wshrpc command in `pkg/wshrpc` (`wshrpctypes_*.go`), then `task generate`.

- Data: `{ cwd: string; hash?: string }`. No hash: the working tree against `HEAD`, untracked files
  included. A hash: that commit against its first parent (the root commit against the empty tree).
- Returns `{ isrepo: boolean; files: ReviewPatchFile[] }`, in `git diff`'s path order, where
  `ReviewPatchFile` is `{ path; oldpath?; diff?; untracked?; content?; binary?; toolarge?; size? }`.
  `diff` is that file's unified patch; an untracked file sends `content` instead.
- The fields match `diffFileView` in `gitdiff.ts`, which turns each file into a `FileView` and has no
  caller today. It becomes the review's adapter.
- A file over the existing per-file size cap sends `toolarge` and `size`, and renders as "too large to
  show", never as an empty diff. A binary file sends `binary`.
- The handler runs `git` once for the diff and splits it on `diff --git` headers, plus one read per
  untracked file. Errors return as errors; a non-repo cwd returns `isrepo: false`.

## The Review view

### Opening

The diff pane's header gets a two-option control, **File | Review**, shown when the selection is the
Uncommitted row or a commit (not in compare mode). The choice is a jotai atom, so it survives surface
switches. Clicking a file in the commit pane's file list scrolls Review to that file's header.

### Layout (`reviewlist.tsx`, model in `reviewlist.ts`)

- One section per file:
  - **Header** (sticky while its file scrolls): chevron, file name, dimmed directory, `+N` in
    `text-diff-added`, `−M` in `text-diff-removed`. It collapses and expands its file.
  - **Rows:** old line number, new line number, a sign column, then the line's text highlighted with
    `highlightLine`, wrapped (`whitespace-pre-wrap`, `break-words`). Added rows are on `bg-diff-added/15`,
    removed rows on `bg-diff-removed/10`, as in Doc review.
  - **Folds:** a run of unchanged lines longer than 7 shows 3 lines on each side and a fold row
    (`⋯ 24 unchanged lines`) that expands in place.
- A file with no text diff says why (binary, too large, renamed without changes), from its `FileView`.
- Colours come from `@theme` tokens only; mono is for code, paths and line numbers (DESIGN.md).

### Commenting

- Hovering a row shows a **+** at the row's right edge (accent).
- **One line:** click **+**. A comment box opens below the row: a textarea with the placeholder
  "Leave a comment", **Cancel** and **Add Comment** (accent). Ctrl+Enter adds; Esc cancels.
- **A range:** drag from a row's **+** across rows, or click one row's **+** and shift-click another's.
  The range is tinted with `bg-accent/10` and the box opens below its last row. A range stays on one
  file and one side.
- A saved comment is a card below its range's last row: its number, `path:start-end`, the note and an
  × to delete. Clicking the note edits it in place. The numbers follow the order the message uses
  (file order, then side, then line), so a card's number is the number the agent reads.
- Only one box is open at a time. Opening another while one has text keeps that text as the box's
  draft rather than discarding it.

### The tray

Pinned to the bottom of the diff pane while there is at least one comment, in File or Review mode:

- Left: `3 comments on 2 files`.
- Right: **Send 3 comments** (accent). It sends to the Diff scope's agent. With no agent in scope it
  offers the project's live agents (`liveAgentsForProject`): one is sent to directly, several open a
  menu. With none, the button reads **Copy** and copies the message to the clipboard.
- Blocked states, each with the button disabled and the reason in one line:
  - the agent has an open ask: `paper-writer is waiting on a question — answer it first`;
  - a comment box still holds unsaved text: `1 comment is not added yet`.
- After a send: `Sent to paper-writer` in `text-success`, and the comments clear. A failed send shows
  `Couldn't reach paper-writer — comments kept` in `text-error` and keeps every comment.

### Keys

In `buildFilesBindings`, with exclusive `when()`s:

- `Ctrl+Enter` outside a comment box: send, when the tray can send.
- Inside a box, Ctrl+Enter adds and Esc cancels; the box handles these itself, the way Doc review's
  draft comment does, so the surface binding stands down while focus is in a box.
- No `c` binding: the Diff surface already uses `c` to enter compare.

`docs/keyboard-shortcuts.md` and the footer hints (`footerhints.ts`) list the send key.

## The message (`linecomments.ts`, pure)

```
Review comments on your changes (3):

1. frontend/app/view/agents/diffpane.tsx:42
   > const x = foo();
   Why call foo twice?

2. pkg/orchestrate/merge.go:88-94
   > func finishMerge(ctx context.Context, ...
   > … (6 more lines)
   Split this function.

3. src/old.ts:12 (removed line)
   > return cache.get(key)
   Keep the cache.
```

- The header names the selection: `your changes` for Uncommitted, `commit abc1234 (subject)` for a commit.
- Paths are relative to the repository root.
- A range quotes its first 3 lines, each cut at 120 characters, then `… (N more lines)`.
- A removed-line comment uses the old file's line numbers and says `(removed line)` or `(removed lines)`.
- A note keeps its own line breaks, indented under its comment.
- `orderComments` sorts by file (in the review's file order), then side (new before old), then start line.

## Sending (`linereviewsend.ts`)

`sendLineComments(agent, text)`:

1. `pasteIntoTerm(agent.blockId, text)` (`view/term/termpaste.ts`); if it returns false (the terminal is
   not mounted), fail with the agent's name.
2. Otherwise `ControllerInputCommand` with `\r` to submit.
3. Returns `{ ok: true }` or `{ ok: false, error }`; the tray shows either. Nothing is swallowed.

In DEV builds, `window.__lineReviewSink`, when set, receives the text instead of a terminal, so the CDP
scenario can read exactly what would be sent.

## State (`linecommentstore.ts`)

`lineReviewAtom(repoKey)`, an atomFamily keyed by the Diff scope's cwd:
`{ comments: LineComment[]; box?: { file; side; start; end; text; editingId? }; lastSend?: { ok; text } }`.

`LineComment` is `{ id; source: "worktree" | <commit hash>; file; side: "new" | "old"; startLine;
endLine; quote: string[]; note }`. The quote is taken when the comment is added.

`reviewModeAtom: "file" | "review"` holds the pane's mode.

## Removed

- `SendToAgent` in `frontend/app/view/code/codepathbar.tsx` and `handoffLine` in `codehandoff.ts`, with
  their tests. `liveAgentsForProject` stays: the tray uses it.

## Later (not in this design)

- The Code surface: line comments on a whole file in its Monaco viewer, reusing `linecomments.ts`, the
  store and the tray.
- Compare mode.

## Testing

- `linecomments.test.ts`: the message for one line, a range over 3 lines, a removed line, a commit
  header, a multi-line note, ordering across files and sides, quote cutting.
- `linecommentstore.test.ts`: add, edit, delete, the kept box text, clear on a good send, keep on a
  failed one, the blocked reasons.
- `reviewlist.test.ts`: folding unchanged runs, row numbering per side, the header counts, the
  no-diff reasons.
- `pkg/wshrpc/wshserver` test for `GitReviewPatchCommand` on a temp repo: a modified file, an added
  file, an untracked file, a removed file, a commit's patch, the root commit, the size cap, a non-repo.
- A CDP scenario `line-review` in `scripts/cdp/scenarios.mjs`. It arranges a temp repo with uncommitted
  changes in two files and a fixture agent scoped to it, then:
  1. selects Uncommitted, switches to Review, and checks both files' headers and counts;
  2. collapses and expands one file;
  3. comments on one added line, and checks the card and the tray;
  4. comments on a range of 3 lines by shift-click, and checks the tint and the card;
  5. comments on a removed line;
  6. sends with `__lineReviewSink` set, and checks the exact message and that the comments cleared;
  7. sets the agent's ask open and checks the blocked tray line.

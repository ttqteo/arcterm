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
| 11 | The Code surface's one-line "Send to agent" (`codepathbar.tsx` `SendToAgent`) is removed. `handoffLine` stays: canvas marks send through it. | One way to send feedback on code. The Code surface gets line comments in a later stage, reusing this design's store, tray and format. |

## Data: `GitReviewPatchCommand`

A new wshrpc command in `pkg/wshrpc` (`wshrpctypes_*.go`), then `task generate`.

- Data: `{ cwd: string; hash?: string; base?: string; maxbytes: number }`, `maxbytes` per file as
  `GitFileAtRefCommand` takes it (the frontend passes `MAX_DIFF_BYTES`).
  - No hash: the working tree against `base`, untracked files included. `base` is the ref the Diff surface's
    file list diffs against (`FilesState.ref`: a run's base commit, an agent session's start commit, or `""` for
    `HEAD`), so Review shows what the Uncommitted row's file list shows, including work the agent already
    committed.
  - A hash: that commit against its first parent (the root commit against the empty tree); `base` is ignored.
- Every patch is taken with **full context** (`--unified=<large>`), so a file is one hunk holding the whole file
  and a fold can expand in place from text the client already has.
- Returns `{ isrepo: boolean; files: ReviewPatchFile[] }`, sorted by path (byte order, untracked files merged into
  the same order), where `ReviewPatchFile` is `{ path; oldpath?; diff?; untracked?; content?; toolarge?; size? }`.
  `diff` is that file's unified patch; an untracked file sends `content` instead. The types live in `pkg/gitinfo`
  (`gitinfo.ReviewPatchFile`), and the RPC's return type uses them, as `CommandGitHistoryRtnData` uses
  `gitinfo.HistoryCommit`.
- The fields match `diffFileView` in `gitdiff.ts`, which turns each file into a `FileView` and has no
  caller today. It becomes the review's adapter.
- A file whose patch is over `maxbytes` sends `toolarge` and `size`, and renders as "too large to show",
  never as an empty diff. A binary file sends git's own patch text, which `parseUnifiedDiff` already reads as
  binary.
- The handler runs `git` once for the diff and splits it on `diff --git` headers, plus one read per
  untracked file. Errors return as errors; a non-repo cwd returns `isrepo: false`.
- A file over `maxbytes` is "too large" even when its change is one line, because the patch carries the whole
  file. The Diff surface's File view loads whole files under the same cap, so both modes agree.

## The Review view

### Opening

The diff pane's header gets a two-option control, **File | Review**, shown when the selection is the
Uncommitted row or a commit (not in compare mode). The choice is a jotai atom, so it survives surface
switches. Clicking a file in the commit pane's file list scrolls Review to that file's header.

While the patch loads, Review shows the pane's existing skeleton. A failed load shows one line in `text-error` with
the error and a **Retry** button.

### Layout (`reviewlistview.tsx`, model in `reviewlist.ts`)

- One section per file:
  - **Header** (sticky while its file scrolls): chevron, file name, dimmed directory, `+N` in
    `text-diff-added`, `−M` in `text-diff-removed`. It collapses and expands its file.
  - **Rows:** old line number, new line number, a sign column, then the line's text highlighted with
    `highlightLine`, wrapped (`whitespace-pre-wrap`, `break-words`). Added rows are on `bg-diff-added/15`,
    removed rows on `bg-diff-removed/10`, as in Doc review.
  - **Folds:** a run of unchanged lines longer than 7 shows 3 lines on each side and a fold row
    (`⋯ 24 unchanged lines`) that expands in place. The patch has full context, so the hidden lines are already
    in the client; a run at the file's start or end keeps 3 lines on its inner side only.
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
  × to delete. Clicking the note edits it in place (the box opens on the card's text; adding replaces it). The
  numbers follow the order the message uses (see "The message"), so a card's number is the number the agent reads.
  Review shows the cards of the selection it shows (Uncommitted or that commit); the tray counts them all.
- Only one box is open at a time. Clicking **+** elsewhere while the open box has text does not move it: the box
  stays where it is and takes focus, so a typed note is never lost or hidden. An empty box moves.

### The tray

Pinned to the bottom of the diff pane while there is at least one comment or a result line from the last send or
copy, in File or Review mode. Adding a comment clears the result line.

- Left: `3 comments on 2 files`, or the result line once the comments are gone.
- Right: **Send 3 comments** (accent). It sends to the Diff scope's agent. With no agent in scope it
  offers the project's live agents (`liveAgentsForProject`): one is sent to directly, several open a
  menu of their names. With none, the button reads **Copy** and copies the message to the clipboard; the
  comments stay, and the line reads `Copied — paste it to an agent` in `text-success`.
- Blocked states, each with the button disabled and the reason in one line:
  - the agent has an open ask: `paper-writer is waiting on a question — answer it first`;
  - the comment box holds text not yet added: `A comment is not added yet`.
- After a send: `Sent to paper-writer` in `text-success`, and the comments clear. A failed send shows
  `Couldn't reach paper-writer — comments kept` in `text-error` and keeps every comment; the error itself goes to
  the console and the line's tooltip.

### Keys

In `buildFilesBindings`, with exclusive `when()`s:

- `Ctrl+Enter` outside a comment box: send, when the tray can send. The binding presses the tray's send button,
  so a blocked or absent button lets the key pass.
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
   > func finishMerge(ctx context.Context, run *Run) error {
   >     if run.Landed {
   >         return nil
   > … (4 more lines)
   Split this function.

3. src/old.ts:12 (removed line)
   > return cache.get(key)
   Keep the cache.
```

- The header names the selection: `your changes` for Uncommitted, `commit abc1234 (subject)` for a commit.
- Paths are relative to the scope's working directory, as in the Diff file list (`git diff --relative`); for an agent at the repository root that is the repository root.
- A range quotes its first 3 lines, each cut at 120 characters, then `… (N more lines)`.
- A removed-line comment uses the old file's line numbers and says `(removed line)` or `(removed lines)`.
- A note keeps its own line breaks, indented under its comment.
- `orderComments` sorts by source (Uncommitted first, then commits in the order they were first commented on), then
  path (byte order, the order the RPC returns files in, so File mode needs no review list to number comments),
  then side (new before old), then start line.
- With comments from more than one source, the header reads `Review comments (N):` and each comment's line ends
  with ` in your changes` or ` in commit abc1234 (subject)`.

## Sending (`linereviewsend.ts`)

`sendLineComments(agent, text)`:

1. `pasteIntoTerm(agent.blockId, text)` (`view/term/termpaste.ts`); if it returns false (the terminal is
   not mounted), fail with the agent's name.
2. Otherwise `ControllerInputCommand` with `\r` to submit.
3. Returns `{ ok: true }` or `{ ok: false, error }`; the tray shows either. Nothing is swallowed.

In DEV builds, `window.__lineReviewSink`, when it is a function, receives the text instead of a terminal, so the
CDP scenario can read exactly what would be sent; a sink that throws is a failed send. `window.__lineReviewFault`
(`"slow"` holds the next patch load for 3 s, `"error"` fails it) lets the scenario show the loading and error
states. Production code never reads either.

## State (`linecommentstore.ts`)

One static atom, `lineReviewsAtom: Record<repoKey, LineReviewState>`, keyed by the Diff scope's cwd, with
`lineReviewAtom(repoKey)` a derived read/write view of one entry:
`{ comments: LineComment[]; box?: { source; file; side; start; end; text; editingId? }; lastSend?: { ok; kind:
"sent" | "copied"; agent?; error? } }`. `activeReviewKeyAtom` holds the repoKey the Diff pane shows. The Ctrl+Enter
binding's `when()` reads only these two static atoms, so both join `PREDICATE_ATOMS` (`whenstate.ts`).

`LineComment` is `{ id; source: "worktree" | <commit hash>; file; side: "new" | "old"; startLine;
endLine; quote: string[]; note }`. The quote is taken when the comment is added.

`reviewModeAtom: "file" | "review"` holds the pane's mode.

## Removed

- `SendToAgent` in `frontend/app/view/code/codepathbar.tsx`. `codehandoff.ts` stays whole: `handoffLine` sends
  canvas marks (`canvasmarks.ts`) and the tray uses `liveAgentsForProject`.

## Later (not in this design)

- The Code surface: line comments on a whole file in its Monaco viewer, reusing `linecomments.ts`, the
  store and the tray.
- Compare mode.

## Testing

- `linecomments.test.ts`: the message for one line, a range over 3 lines, a removed line, a commit
  header, a multi-line note, ordering across files and sides, quote cutting.
- `linecommentstore.test.ts`: add, edit, delete, a box with text that stays put, clear on a good send, keep on a
  failed one, copy keeps, the result line clearing on the next add, the blocked reasons.
- `reviewlist.test.ts`: folding unchanged runs, row numbering per side, the header counts, the
  no-diff reasons.
- `pkg/gitinfo` test for `ReviewPatch` on a temp repo: a modified file, an added file, an untracked file, a removed
  file, a commit's patch, the root commit, a `base` older than `HEAD`, full context, path order, the size cap, a
  non-repo.
- A CDP scenario `line-review` in `scripts/cdp/scenarios.mjs`. It arranges a temp repo with a commit holding a
  binary file, a pure rename and a file over the cap, then uncommitted changes in two files, and a fixture agent
  scoped to it. Its steps, each with a shot, are listed in the plan; together they show every view and state above:
  Review on Uncommitted and on a commit, the control hidden in compare, loading, error and Retry, the no-diff
  reasons, collapse and folds, the box (Add Comment, Cancel, Esc, Ctrl+Enter), a range by shift-click and by drag,
  a removed line, a box with text that stays put, cards (edit, ×), the tray in Review and in File mode, a send, a
  failed send, Ctrl+Enter from the surface, the ask and draft blocks, the agent menu and Copy.

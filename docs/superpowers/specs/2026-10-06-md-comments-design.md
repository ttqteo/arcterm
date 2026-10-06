# Comments on rendered markdown in the Agent panel — design

Status: approved design 2026-10-06; implemented 2026-10-07 (run 74f0fa77). The UI has not run live: see the markdown
comments row in `docs/open-issues.md`. Mockup (gitignored, deleted once the `md-comments` scenario has run on Windows):
`.superpowers/design/md-comments/`. This amends decision 5 of `docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md` for markdown files: the File
tab renders them instead of showing Monaco.

## Problem

The Agent panel's File tab shows any file, a `.md` included, as read-only Monaco text. A walkthrough's screenshots are
`![…](images/…png)` lines, and a table is a run of pipes.

The user reads a lot of the markdown agents write: specs, plans, guides, findings and walkthroughs with screenshots. They
answer it by copying a passage, switching to the terminal, pasting it and typing their point (the 2026-10-01 brief,
`docs/superpowers/briefs/2026-10-01-antigravity-adk-feature-scan.md`, candidate 1). Line review
(`2026-10-06-line-review-design.md`) does this for a diff. Nothing does it for a document, or for a file the agent did
not change.

Others have this:
- Antigravity renders an artifact as a document and takes comments on its text and its images.
- Claude Code's VS Code extension does the same for plan files only.
- Cursor users ask for it on its forum.

The user wants the File tab to render markdown and take comments the Antigravity way: select a passage or pick blocks,
comment, and send every comment to the agent at once.

Out of scope:
- Comments on a file that is not markdown.
- A region drawn on an image. An image takes one comment on the whole image.
- Comments anywhere else markdown renders: the Code surface's preview, the DAG detail rail, run reports. Doc review keeps
  its own.
- Editing the document.
- Keeping drafts across a restart.
- Showing comments in Source view.
- A key for the Preview / Source toggle.
- One tray shared with line review. The panel's future Review tab keeps line review's tray.
- Wave's `@@@start` content blocks in the panel.
- Commenting on a block from the keyboard alone: the gutter `+` is a pointer gesture.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | A markdown file (`isMarkdownPath`) opens in the File tab as **Preview**, with a `Preview \| Source` toggle in the header. Source is today's Monaco view. The choice is one value for every agent, persisted as `agent.rail.mdMode`. Other files are unchanged. | Chosen by the user. The Code surface reads markdown the same way. |
| 2 | Preview renders through the shared renderer, `frontend/app/element/markdown.tsx`, at the Code preview's document styles (`markdown-doc`). It does not use Doc review's prose scanner. | Chosen by the user. The scanner (`docprose.ts`) keeps prose and drops tables, code blocks and Mermaid, and agent-written guides are full of tables. The Code preview and the panel then render a file the same way. |
| 3 | Every comment is anchored to a range of **source lines**. A remark plugin stamps each block with the lines it came from. | The agent edits by line, and line review's message already speaks in `path:lines`. |
| 4 | Two gestures on text, both ending in a line range. **Select text** for a phrase (`c` or the floating Comment button). **`+` in the gutter** for whole blocks, with Shift+click for a range. An image has a Comment button on hover. | Chosen by the user. `+` with Shift+click is line review's gesture, so commenting feels the same on a diff and on a document. In rendered markdown a block is the nearest thing to a line. |
| 5 | Comments are drafts **per agent**, across files: Back and Forward keep them, and one Send carries all of them. They are kept in memory only. | The panel belongs to one agent and only sends to it. Line review keys by repository because its Diff scope may have no agent. |
| 6 | The comments go as **one message** in line review's shape, pasted into the agent's terminal and submitted (`sendLineComments`). | Chosen by the user over a send per comment. The agent reads one format for a diff and for a document. A busy agent queues the message. |
| 7 | Relative images resolve against the file's directory. The Code preview gets the same fix (`resolveOpts`). | The Code preview passes no `resolveOpts` today, so every screenshot there renders as the text `[img:images/…png]`. |
| 8 | The use of this feature is re-measured around **2026-10-20**. If Sends stay near zero, it goes. Recorded in `docs/deferred.md`. | The brief counted earlier send-to-agent features: 2 uses of Code's "Send to agent" since August, 0 of canvas send-marks. This one sits where the reading happens, but that is a bet. |

## The view

1. **Header.** Today's File tab header: Back, Forward, the path (directory muted, name, `:line`) and "Open in Code ↗".
   A markdown file adds the `Preview | Source` toggle before "Open in Code", styled like the Code surface's view-mode
   toggle (`codepathbar.tsx` `ViewModeToggle`).
2. **Body.** `Markdown` with `markdown-doc` styles at 14px. The text column is the panel's width, inset 36px on the
   left (room for the gutter `+`) and 22px on the right, on `bg-background`.
   - A frontmatter block renders as the Code preview's card (`splitFrontmatter`, `FrontmatterCard`).
   - Images resolve with `resolveOpts` `{ connName: "local", baseDir: <the file's directory> }` (`""` would build
     `wsh:///…`).
   - A link to a relative `.md` file opens that file in the panel and pushes the current one onto Back (`openFile`).
     A `#anchor` link scrolls within the document. Any other link opens as it does in the Code preview.
3. **At a line.** A file opened at a line (`ref.line`) scrolls the block that holds that line to the centre and marks it
   with the File tab's existing treatment: a `surface-hover` fill and a 2px `accent` bar on its left edge. The block is
   the innermost stamped block whose lines contain it. If the line falls between blocks, the next block is marked. The
   mark stays until another file or line opens.
4. **Source** shows today's Monaco view at the same line. Comment cards do not show there, but the tray does.

## Anchoring

5. **Stamps.** A rehype plugin (`rehype-srclines.ts`) sets `data-src-start` and `data-src-end` (1-based file lines)
   from each element's source position, on `p`, `h1`–`h6`, `li`, `pre`, `hr`, `table`, `tr` and `img`. The sanitize
   schema lets the two attributes through on every element.
   - It runs first, before `rehype-raw`, so raw HTML (parsed later) has no stamp and cannot be commented on.
   - It works on the HTML tree because a fenced code block's position lands on `pre` there. A remark plugin's
     `hProperties` would land on the inner `code`.
   - A tight list renders no `p` inside its items; the `li` stamp covers them.
   - Every component that `markdown.tsx` overrides (`p`, the headings, `img`, `pre`) passes the two attributes through.
6. **Lines match the file exactly.** The plugin adds an offset: the number of lines `splitFrontmatter` took off the
   top. The panel also turns off Wave content blocks (a new `contentBlocks` prop, default on): `transformBlocks` folds a
   `@@@start` block's lines and would shift every line after it.
7. **Selection.** Each end of the selection resolves to its innermost stamped ancestor. The range runs from the earlier
   start to the later end. A selection that leaves the document body is clipped to it. A selection that touches no
   stamped block offers no Comment button.
   - The quote is the selected text, whitespace collapsed, cut to 160 characters plus "…" (`QUOTE_MAX` in
     `proseanchor.ts`).
8. **`+` and Shift+click.** Hovering a stamped block shows a `+` in the gutter, at the block's first line, as in line
   review (an 18px `accent` button).
   - A click comments on that block's lines.
   - Shift+click on another block's `+` extends the range from the first block to that one, in document order.
   - The quote is the range's source lines: up to 3, each cut to 120 characters, then `… (N more lines)`
     (`QUOTE_LINES` and `QUOTE_WIDTH` in `linecomments.ts`).
9. **Image.** Hovering an image shows a Comment button in its top-right corner, the same accent button as the floating
   one. The anchor is the image's line and its `src` exactly as written in the file. There is no quote.
10. **Where a card sits.** A comment's card and its open box render after the innermost stamped block that holds the
    comment's last line, with two exceptions: a comment ending in a table renders after the table, and one ending in an
    image renders after the image. The block keeps a 2px `edge-strong` bar in the gutter while it has a comment.
    - Cards read the agent's drafts through a context, so adding or editing one re-renders only the cards. The
      document, and with it the scroll position, does not re-render.

## Comments

11. **The box.** An open box takes the place of the selection: a bordered `accent` card holding the reference
    (`docs/x.md:10-14`, Inter, `muted`), the quote, a textarea, and Cancel / "Add comment ⌃↵". The block it targets
    takes the fill and bar from item 3 while it is open. One box at a time: a new comment replaces an open box that is
    empty. While the open box holds text, a new comment does not open; the open box takes focus instead, so no note is
    lost.
    - The box belongs to its file and stays open when the panel opens another file. A new comment begun in another
      file while the box holds text opens the box's file at the box (pushing the current file onto Back), in Preview,
      with the caret in the box.
12. **A card** shows its number, its reference, the quote and the note, with Edit (it reopens as the box) and Delete.
    - The number is the comment's position in the message (item 15), so a card's number and the agent's numbered item
      agree.
    - An image's reference reads `docs/x.md:41 · image 01-new-project.png`.
13. **Paths** are relative to the panel file's root (`FileRef.root`, the agent's working directory) when the file is
    under it, and absolute otherwise, always with `/`.

## The tray and the message

14. **The tray** sits at the bottom of the File tab, under both Preview and Source, styled like line review's tray.
    - With comments: `N comments on F files`, Copy, and "Send N comments ⌃↵". The button's tooltip names the agent.
    - Without comments: "Select text and press c, or hover a block and click +, to comment."
    - Without comments while a box holds text (the first comment, being written): "No comments yet", Copy and "Send
      ⌃↵" both disabled, and the reason line below.
    - Send is disabled, with the reason on a second line, while:
      - the agent is asking: "<agent> is waiting on a question — answer it first", after an `asking` dot (pasted text
        would land in the answer field);
      - a box holds text: "Add or cancel the open comment first". The line is a button that shows the box: it opens the
        box's file when another file is shown, switches to Preview, and puts the caret in the box (item 11);
      - the agent has no terminal (an ended worker): Copy only.
    - The tray stays under a file that is not markdown while the agent has comments, a send result or an open box.
    - After a send the comments clear and the tray reads "✓ Sent N comments to <agent>". A copy keeps them: "✓ Copied.
      The comments stay until you send or delete them." A failed send keeps them and shows line review's failure
      line.
15. **The message:**
    ```
    Comments on 2 files (3):

    1. docs/orchestrator-guide.md:10-14
       > A reviewer checks the plan before any worker starts
       Say who the reviewer is: a fresh session or the lead?

    2. docs/orchestrator-guide.md:41 (image images/orchestrator-guide/01-new-project.png)
       The New project modal has a Template field now; retake this.

    3. docs/README.md:5-7
       > | Doc | What it is |
       > |---|---|
       > | `orchestrator-guide.md` | … |
       Add a row for the new spec.
    ```
    - With one file the header is `Comments on docs/orchestrator-guide.md (3):`.
    - Files go in the order they were first commented on. Within a file, comments go by start line, then by when they
      were added.
    - A note's lines are indented 3 spaces, and its blank lines stay blank (line review's `formatOne`).

## Keyboard

16. The document body is focusable (`tabIndex=-1`), takes focus on mousedown and is marked `data-owns-keys`. Selecting
    text does not move focus by itself, so without this `c` would go to the agent's xterm. The body shows the focus
    ring while it has focus.
17. Keys in the File tab, with focus in it:
    - `c`: comment on the selection.
    - Ctrl+Enter: add the comment inside a box; send when outside a box and Send is enabled.
    - Esc: cancel the open box when this file shows it; otherwise close the file (today's key). A box in another file
      stays.
    - The gutter `+` follows the pointer, so it is a mouse gesture. The image's Comment button and each card's buttons
      are buttons Tab reaches.

## States

| Area | State | What shows | Mockup board |
|---|---|---|---|
| Body | Preview, opened at a line | the block marked, centred | Main |
| Body | text selected | floating "Comment c" under the selection's end | Select |
| Body | box open | accent box after the block; block marked | Compose, Range |
| Body | comments saved | cards after their blocks; gutter bar | Cards, Image |
| Body | block hovered | `+` in the gutter | Cards |
| Body | image hovered | Comment in its top-right corner | Image |
| Body | Source | Monaco at the line; no cards | Source |
| Body | reading, binary, too large, deleted | today's File tab states | — |
| Tray | no comments | the hint line | Main, Select |
| Tray | comments | count, Copy, Send | Cards, Image, Source |
| Tray | blocked: asking, open box | Send disabled, reason line | TrayStates, Range |
| Tray | first comment being written | "No comments yet", Copy and Send disabled, reason line | Compose |
| Tray | no terminal | Copy only | — |
| Tray | sent, copied, failed | status line | TrayStates (sent, copied) |

## Code shape

| File | Change |
|---|---|
| `frontend/app/element/rehype-srclines.ts` (new, tested) | The stamping plugin, with its line offset, and the sanitize schema helper. |
| `frontend/app/element/markdown.tsx` | Props: `srcLineOffset` (turns stamping on), `contentBlocks` (default true) and `blockAfter(tag)`, which every stamped block component renders after itself (inside an `li`). The sanitize schema allows the two attributes. |
| `frontend/app/view/code/frontmattercard.tsx` (new) | `FrontmatterCard`, moved out of `codeviewer.tsx` so the panel shares it. |
| `frontend/app/view/agents/mdcomments.ts` (new, tested) | Pure: the anchor from a selection's two ends, from `+` and Shift+click, and from an image; the quotes; which block hosts a card; the block for a line; relative paths; `formatMdComments`; numbering. |
| `frontend/app/view/agents/mdcommentstore.ts` (new, tested) | Drafts per agent id: comments, the box, the last send; add, edit and delete; `sendBlock`; `recordSend`. |
| `frontend/app/view/agents/mddoc.tsx` (new) | The Preview body: it measures the stamped blocks and draws the marks, the selection's floating button, the gutter `+` and the image's button; focus and keys. |
| `frontend/app/view/agents/mdcommentcards.tsx` (new) | The card, the box and the slot each stamped block renders after itself, which shows the cards whose host is that block. |
| `frontend/app/view/agents/mdcommenttray.tsx` (new) | The tray. It always targets the panel's agent: no agent menu. The presentational part may be shared with `linereviewtray.tsx` if that falls out cleanly. |
| `frontend/app/view/agents/filetab.tsx` | The toggle, the Preview body and the tray. |
| `frontend/app/view/agents/agentrailstore.ts` | `railMdModeAtom` (`agent.rail.mdMode`). |
| `frontend/app/view/code/codeviewer.tsx` | Pass `resolveOpts` to the preview. |
| `docs/keyboard-shortcuts.md`, `docs/deferred.md` | The File tab's keys; the 2026-10-20 re-measure. |

`sendLineComments` (`linereviewsend.ts`) is reused as is, including its DEV sink, `window.__lineReviewSink`.

## Verification

Unit tests (vitest):
- Stamping, on real shapes: frontmatter (with the offset), headings, a tight list and a loose list, nested lists, a
  table, a fenced code block, an image inside a paragraph, raw HTML (no stamp), CRLF line endings.
- Anchors: a selection within one block, a selection across blocks, and a selection reaching outside the body; `+`
  alone and with Shift+click in both directions; an image.
- Quotes: the 160-character cut, 3 lines and "… (N more lines)", whitespace collapsing.
- The message: one file, several files, an image, a note with blank lines, a path outside the root; the order and the
  numbering.
- The store: add, edit, delete, the box rules, each `sendBlock` reason, and a send clearing what a copy keeps.

A CDP scenario, `md-comments`. Its fixture: a temp repo holding `docs/guide.md` (frontmatter, a heading, paragraphs,
a three-row table, an image beside it under `images/`, and a link to `docs/other.md`) and an agent rooted there. It
checks:
- opening `docs/guide.md:<line of the second paragraph>`: Preview, that block marked, the image rendered (not
  `[img:…]`);
- a selection, `c`, a note: the tray reads "No comments yet" with Send disabled and the reason; Ctrl+Enter: a card
  under the block;
- `+` on the first table row and Shift+click on the third: the box after the table, the reference `:a-b`;
- the image's Comment button: a card after the image;
- the link to `other.md`: it opens in the panel; a selection comment there; Back returns to `guide.md` with its
  cards still in place;
- the tray reading `4 comments on 2 files`;
- Send through `window.__lineReviewSink`: the message equals the expected text exactly, and the tray reads "Sent";
- with the agent asking, Send is disabled with its reason;
- Source: Monaco at the line, the tray still there;
- the Code surface's preview of `docs/guide.md` rendering the image;
- a card's Edit reopening it as the box with its note, Ctrl+Enter keeping its number, and Delete renumbering the rest;
- a new comment while the box holds text: the box stays and takes the caret;
- the box held in `guide.md` while `other.md` shows: the reason line, and a new comment, each bring the panel back to
  the box with the caret in it;
- a send that fails (a throwing `__lineReviewSink`): the comments stay and the tray shows the failure line.

A screenshot of each step goes to the contact sheet.

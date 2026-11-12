# The Diff surface — comments to the agent

Mark lines of the open diff with a note while you review, then send the batch to the agent that made the changes as
one prompt. This page is about those comments, from the Diff surface's File view. Review (the File | Review control in
the pane's header) has its own comment tray and its own `Ctrl`+`Enter`; the two do not share comments.

Code: `frontend/app/view/agents/diffcomments.ts` (the pending store), `diffcommentlayer.ts` and `diffcommentcard.tsx`
(the layer over Monaco), `commentprompt.ts` and `commentsend.ts` (the prompt and who gets it), `commentsendbar.tsx`
(the bar under the diff). The pure rules each have a `.test.ts` beside them.

## Adding a comment

Hover a line and click the **+** in its gutter, or select lines and press `m` (with no selection, the cursor's line).
A draft card opens under the range's last line, titled *Comment on lines 7–9*. `Ctrl`+`Enter` adds it and `Esc`
cancels. The range you are commenting on carries an accent bar down its left edge while the draft is open.

- Changed and context lines on the right take comments in both views.
- Removed lines take them only in the side-by-side view, on the left side. In the unified view a hunk of only removed
  lines carries a hint to switch (`Shift`+`D`).

## Pending comments

Each comment stays as a card under its lines, marked *pending*, with edit and delete. The card shows only on the pair
of refs it was made on: the working tree against the HEAD sha it was read against, one commit against its parent, or
a comparison. The changed-file list counts a file's comments across every pair in a badge on its row.

When the agent keeps working and the lines move, a comment follows its quoted text. If the text is gone the card is
not drawn, but the comment stays counted and is sent with its original lines and quote. A comment made on a working-tree
diff names the HEAD sha, so it still reads the same after the agent commits.

Comments are held per source, one batch per agent, run or project, in the browser storage the app keeps
(`diff.comments.pending`). They survive a restart; the 50 most recently touched batches are kept. A comment added while
a send is in flight stays for the next send.

## The send bar

The bar under the diff counts the batch and names who gets it. With no comments it is a one-line hint.

| Source | Send goes to |
|---|---|
| A live agent in an Arc terminal | That agent, as its next prompt: "working, joins its turn" mid-turn, "at its prompt" when idle |
| A live agent that is asking a question | Nobody yet: the prompt would answer the question, so Send waits and says so |
| A project | A new Claude Code agent in the project's folder, the batch as its first prompt |
| A run that has landed | A new agent in the run's project folder |
| A run that has not landed, or is held | Nobody yet: Send is disabled with the reason, and the batch is kept |
| An agent a run started | Its run's rule |
| An agent that has ended (or runs outside Arc) | A new agent in its last folder, else its project's folder; with neither, Send is disabled |

`Shift`+`Enter` (or **Send**) sends. To a live agent the cards leave and *Sent 3 comments to loom* stays until the next
comment. A new agent opens on the Agent surface. A failure keeps the batch and shows the error with **Send again**.
**Discard** drops the whole batch.

## What the agent receives

```
Review comments on your changes (worktree against 3f9a21c), 2 comments:

  src/retry/policy.go:4
  >     return 8
  Why 8? Put the reason in a comment above the return.

  src/retry/legacy.go: removed lines 1-3 of 3f9a21c
  > package retry
  Legacy() may still have callers outside this package.

  Line numbers are the file as shown in the diff. Address each comment, then say which you changed.
```

Each comment names its file and lines and quotes the first non-blank line of its range, so the agent can find the spot
again after its own line numbers move. When the batch spans several pairs of refs, each comment says which pair it was
made on.

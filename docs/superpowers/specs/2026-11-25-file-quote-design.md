# Quote from a file into the chat box

Date: 2026-11-25. Status: design, from the brainstorm `.superpowers/brainstorm/file-quote/`.

## Intent

Select a passage in the Agent panel's File tab and send it straight into that agent's chat box as a quote, with the
file and lines it came from, the caret under it for the question. Today the only way is copy and paste, which loses
where the passage is; the File tab's Preview offers only Comment, which batches a review note and never reaches the chat
box.

## What exists

- **Reply in Chat** (`frontend/app/view/agents/chatquote.ts`, `chatquotemenu.tsx`): text selected in the conversation
  goes into the chat box as `> ` lines (`quoteLines`), placed after the typed text and before the folded pastes
  (`withChatQuote`), the caret on a blank line under it. Only conversation text.
- **Markdown Preview** (`frontend/app/view/agents/mddoc.tsx`): a selection shows the floating Comment button (key `c`);
  `selectionTarget` in `mdcomments.ts` turns the touched rendered blocks into `startLine`/`endLine` of the file, using
  the `data-src-start`/`data-src-end` stamps.
- **Source** (`frontend/app/view/agents/filetab.tsx`): a read-only Monaco editor (`MonacoCodeEditor`, `editorRef`) for
  any file.
- **Putting text into the chat box from outside** (`frontend/app/view/agents/chatinsert.ts`): `hasChatBox`,
  `chatBoxText`, `replaceChatBox`.
- Key `q` is Focus read's "quote the lit block into the chat box" (`agent:focus-read-quote` in
  `frontend/app/store/keybindings/bindings.ts`), and passes on in a document; `Alt+Q` is unbound.

## Design

### What lands in the chat box

One location line, then the selected text as `> ` lines, then a blank line where the caret sits:

```
harnesspov/results/study/PREREG.md:42-44
> Giả thuyết dương (câu hỏi 2). Tuyên "model rẻ + harness đuổi kịp …
> …

```

- The path is the one the agent can open, resolved as Pin does (`filePinTarget`, `agentrailtabs.ts:441`): relative to
  the agent's folder (`cwd`) when the file is under it, else relative to the file's root (`FileRef.root`), else
  absolute; `/` separators. (Agent's call, builder question 2.)
- `:N` for one line, `:N-M` for a range.
- The quote lines are `quoteLines` of the selected text, as Reply makes them.
- It goes in like Reply's quote: after what is typed, before the folded pastes (`withChatQuote`), a blank line before
  it when the box already holds text. A second quote lands under the first.

### Where it works

- **Preview of markdown** (`mddoc.tsx`). A web page's Preview (`HtmlFrame`, an iframe the app cannot read a selection
  in) has no Quote: a web page is quoted from Source (builder question 1). Lines are the span of the rendered blocks the selection touches
  (`selectionTarget`), so half a paragraph names the paragraph's lines; the quoted text is exactly what was selected.
- **Source** (Monaco, any file). Lines are the selection's first and last line in the editor; the text is the
  editor's selected text (`model.getValueInRange`).
- **Not in Diff.**

### How you trigger it

- **Preview:** a Quote button floats beside the Comment button over a selection (same `FLOAT_BTN` style, a `q` key
  hint), and key `q` while the selection is live (in `onKeyDown`, beside `c`; ignored in a textarea).
- **Source:** a Monaco action "Quote in chat" in the right-click menu, with `Alt+Q`, enabled only when the selection is
  not empty.
- After a quote: the selection is cleared and the caret goes into the agent's chat box on the blank line under the
  quote.

### When the agent has no chat box

When the agent's cell shows Terminal (`hasChatBox(agentId)` is false), the Quote button does not show, `q` and `Alt+Q`
do nothing, and the Source menu has no Quote item (or it is disabled). Comment is unchanged.

## Left to the builder

- A pure function that builds the block (location line + `quoteLines`), in `chatquote.ts` or a new file, with tests
  beside it; the `.tsx` files stay thin.
- Wiring: `mddoc.tsx` (button beside Comment, `q` in `onKeyDown`), `filetab.tsx` (Monaco `addAction` with
  `contextMenuGroupId` and `Alt+Q`). How the caret is placed in the chat box: reuse what Reply uses.
- `docs/keyboard-shortcuts.md` gets `q` (Preview) and `Alt+Q` (Source).
- `CHANGELOG.md`: one line under `Added`.
- Verify on the dev app over CDP: select in Preview and in Source, quote, see the block in the chat box with the caret
  under it; an agent showing Terminal shows no Quote.

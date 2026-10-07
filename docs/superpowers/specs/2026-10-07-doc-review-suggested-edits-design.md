# Doc review suggested edits — editing a paragraph's source as a suggestion to the agent — design

Status: design settled 2026-10-07.

## Problem

Doc review (`2026-10-02-doc-review-mode-design.md`) answers an agent's `.tex`/`.md` edits with comments anchored to
sentences. When the fix is a few words, describing it in a comment ("say 'manifest' instead of 'show up'") is
slower and vaguer than writing it.

Writing the file from the review was weighed and not chosen. The review diffs the agent's changes against a
baseline, comments anchor to sentence indices of a snapshot read once per ask, the next round's baseline is the text
shown at load, and the agent holds the file in its context: a direct write would need user edits marked apart from
the agent's, re-anchored comments, a corrected next-round baseline, and an instruction to re-read. A suggestion
keeps the file the agent's and touches none of that. Editing the rendered text (WYSIWYG) is out for the same reason
the Overleaf-style visual mode is deferred (`docs/deferred.md`, 2026-10-07): rendering drops markup, sentences of one
macro share a source span, and tables and code blocks are one block.

Out of scope: writing the file, an "Apply now" button, editing several paragraphs in one suggestion, suggestions on
paragraphs the agent deleted, and the File tab's markdown comments (a separate system, which keeps "editing the
document" out of scope).

## Decisions

1. **A suggestion is a comment with a replacement.** `ProseComment` gains `suggestion?: { from: string; to: string }`
   — `from` the paragraph's exact source as loaded, `to` the edited source. It anchors like any comment: the whole
   paragraph (`sentences: [0, last]`), so it sorts, numbers and underlines with the rest. It can carry a note.
2. **Edit the raw source of one paragraph, in place.** A paragraph of the after-document shows an **Edit** control on
   hover (a pencil beside the comment controls); `e` does the same for the paragraph holding the selection. A
   textarea replaces the paragraph's text, filled with `current.slice(start, end)` where `start`/`end` are the
   earliest start and latest end of its sentences' `source` spans. **Save suggestion** (`Ctrl+Enter`) stores it;
   **Cancel** (`Esc`) drops it; saving unchanged text adds nothing. A table or code-block placeholder paragraph is
   editable the same way, since its span is the whole block. A paragraph the agent deleted has no control.
3. **The card shows the change word by word.** The comment card for a suggestion shows `from` → `to` as a word diff
   of the source text, struck words in `DELETED` and new words in `INSERTED` (`prosetokens.tsx`), then the note.
   Edit reopens the textarea on `to`; delete removes the suggestion.
4. **The agent gets the smallest unique replacement.** A pure `replacementFor(fileText, from, to)` trims the common
   word-aligned prefix and suffix of `from` and `to`, then widens the kept context a word at a time on both sides until
   the old text occurs exactly once in the file (falling back to the whole paragraph). `formatRequest` writes:
   ```
   2. [§1 ¶1] Edit: replace
      "to show up in a running program"
      with
      "to manifest in a running program"
      → note lines, if any
   ```
   Quotes are not cut at `QUOTE_MAX` — the agent needs the exact text to find it. The `doc-review` skill
   (`skills/doc-review/SKILL.md`) gains one line: an `Edit: replace … with …` item is to be applied as written unless
   it breaks the document, and said so if it does.
5. **Both kinds of document.** `.tex` and `.md` reviews go through `docprose.ts`, so the source spans and the editor
   are the same; a markdown paragraph's slice includes its list marker or quote arrow, which the user edits as source.
6. **Session-only, like every comment.** Suggestions live in `DocReviewState.comments` and reset with a new ask
   (Doc review decision 11).

## Changes

- `frontend/app/view/agents/proseanchor.ts` — `suggestion` on `ProseComment`, `paragraphSpan(sentences)`,
  `replacementFor`, the `Edit:` lines in `formatRequest`; tests in `proseanchor.test.ts`.
- `frontend/app/view/agents/docreviewpane.tsx` — the Edit control, the in-place textarea, the suggestion card.
- `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md` — `e` in review mode.
- `skills/doc-review/SKILL.md` — how to treat an `Edit:` item.
- `CHANGELOG.md` — one `Added` line.

## Verification

- vitest: `paragraphSpan` with shared macro spans; `replacementFor` — one changed word, a change at the paragraph's
  start and end, an old text that repeats elsewhere in the file (context widens until unique), identical text (no
  suggestion); `formatRequest` ordering a suggestion among comments, with and without a note.
- CDP scenario: extend `doc-review` — open the fixture review, Edit a paragraph, change a word, Save suggestion; the
  card shows the word diff; Request changes sends an answer containing `Edit: replace`.

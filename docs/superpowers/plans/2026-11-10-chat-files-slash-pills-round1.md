# Chat files, slash menu and pills: fix round 1

Round work for run 3df0f2d3: defects the tasks' reports named in the feature the run built (the `@` picker, the
Lexical box's pills, the file pill in your bubble). The run's own Verify, Check and Final apply. The run branch already
holds main's Chat inline visuals and the `@` list's recent files (merge `7627d3a68`): `useFileMention` takes `recent`,
the list opens above the box (`side="above"`), and its path rows mark what the query matched (`MatchRuns`). Keep all of
that.

### Task 1: A picked name with whitespace is quoted, and the walk goes on inside the quote

**Depends on:** none

**Files:** `frontend/app/view/agents/launchermention.ts`, `frontend/app/view/agents/launchermention.test.ts`, `frontend/app/view/agents/filemention.tsx`

`filemention.tsx` only if the picker needs it.

Today a pick of `my file.txt` writes `@../my file.txt `, which the box and your bubble read as the mention `@../my` and
the text `file.txt` (t-10 and t-12 found it). The quoted form `@"…"` is already what the box writes for a pill whose
path holds whitespace (`mentionText` in `chateditormodel.ts`), and what `mentionTokens` (`filementiontokens.ts`) reads.

- `insertFileMention` writes the mention with `mentionText(path)` (import it; do not copy the rule), so a path with
  whitespace comes out `@"src/my file.txt" `, and the caret lands after the space as now. A path without whitespace
  is written exactly as today.
- A folder pick whose `dir + name` holds whitespace writes an open quote and no closing one, `@"../my dir/`, caret at
  its end, so the walk goes on. `fileMentionAt` reads an `@"` mention up to the caret, whitespace included (it ends at
  a closing `"`, a newline, or 200 characters), and its `query` drops the leading quote, so `browseQuery` sees
  `../my dir/` and the folder is listed. A file picked inside it closes the quote: `@"../my dir/a.ts" `. A folder
  with no whitespace inside an open quote stays quoted (`@"../my dir/sub/`).
- An `@"` typed by hand with a project query (`@"my fi`) ranks as `my fi` does.

**Step 1: Write the failing tests** in `launchermention.test.ts`: a file pick with and without whitespace; a folder pick
with whitespace (open quote, caret at end); a folder pick inside an open quote; a file pick inside an open quote
(closed, trailing space); `fileMentionAt` on `see @"../my dir/fo` with the caret at the end gives `query`
`../my dir/fo`; an `@"` closed before the caret (`@"a b" x`) is not a mention at the caret; the quote form of an email
or a word with a quote inside it (`a@"b`) is not a mention.

**Step 2:** make them pass; run `npx vitest run frontend/app/view/agents/launchermention.test.ts
frontend/app/view/agents/chateditormodel.test.ts frontend/app/view/agents/filementiontokens.test.ts` (the last two
must still pass unchanged) and `task check:ts`.

### Task 2: The `@` list stays shut on a pill, and its first ↓ moves

**Depends on:** Task 1

**Files:** `frontend/app/view/agents/filemention.tsx`, `frontend/app/view/agents/chateditor.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `scripts/cdp/scenarios.mjs`

`chateditor.tsx` and `chatcomposer.tsx`: either or both, wherever the fix belongs.

Two defects the reports name:

- **The list reopens on a pill.** With the caret right after a pill (a pick, then the space after it deleted, or ←
  from after the space), the box's plain text ends in the pill's `@path` at the caret, so `fileMentionAt` reads it as a
  mention being typed and the `@` list opens for it; it stays open while the pill is selected (a selection that only
  changes kind raises no `onChange`), and Enter would pick the same file again (t-12; the final verifier saw it in shot
  `agent-chat-71`). A mention that is already a pill is never one being typed: the list stays shut when the caret is
  at a pill's end or a pill is selected, and opens as before for text the caret is typing. Decide where the editor
  tells the picker (for example, the handle reports whether the caret sits right after a pill, or the composer closes
  the pickers while one is selected); keep `EditorLike` working for the launcher's textarea, which has no pills.
- **The first ↓ jumps back.** `useFileMention`'s `onCaret` resets the highlight on every select event, the bug Task 4
  fixed in the slash menu (`slashmenu.tsx` `onCaret`: reset only when `selectionStart` moved). Apply the same guard.

**Step 1:** add agent-chat step 75 after step 74 in `scripts/cdp/scenarios.mjs`, with a shot
`cdp-shots/agent-chat-75-at-pill-shut.png`: in the main agent's box, `@` and a query that lists two or more files;
assert the first ↓ highlights the second row (`aria-selected`) and stays there; Enter picks it (a pill); then
Backspace removes the space after the pill and the caret is right after it: assert no `[data-chat-mentions]` within
1 s; ← selects the pill: still none; clear the box. Use the helpers steps 70-74 use (`acType`, `acClear`,
`acMentionState`). Run it before the fix to see it fail.

**Step 2:** fix both; run the vitest files beside the files you touched, `task check:ts`, then
`node scripts/cdp/final-verify.mjs agent-chat` and report each step's result (steps 40-44, the inline visuals merged
from main, included: they now drive the editor box).

### Task 3: The file pill sits on the line of the text around it

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/chatfilepill.tsx`, `frontend/app/view/agents/chateditorpill.tsx`, `scripts/cdp/scenarios.mjs`

`chateditorpill.tsx` only if the box's pill is off too.

Step 60 measures the bubble's pill's vertical centre 1.97 px below the centre of the text beside it, against a 2 px
limit, and the shot reads low (t-14). Centre the pill on the text's line in your bubble (and in the box, step 70, if
it measures off the same way), with the plan's look kept (`h-5`, the icon, the label truncated). Then tighten steps 60
and 70's limit to 1 px. Run `node scripts/cdp/final-verify.mjs agent-chat` and report both measurements.

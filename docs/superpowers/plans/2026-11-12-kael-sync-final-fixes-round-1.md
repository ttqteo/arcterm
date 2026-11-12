# Kael sync (2026-11-12): Final round 1 fixes

Fixes for the five steps the Final stage failed on the merged result (commit e5110d3, 178/183 steps passed). The
spec is `docs/superpowers/specs/2026-11-12-kael-sync-code-diff-usage-setup-design.md`; its "Our code wins" section
still holds: fix the defect, never weaken a step's assertion to pass, never edit an existing test of ours. Final's
output is under `C:/Users/me/AppData/Local/dev.arc.app/data/final-shots/3525f4a0-80dc-449f-86ec-88b54977ae70/1`
(`shots.json` holds each step's detail; `cdp-shots/` the screenshots). Run a scenario with
`node scripts/cdp/final-verify.mjs <scenario>` (it starts and stops its own dev app). Do not edit or format files
under `frontend/` while a scenario runs in the same tree: Vite reloads the page and ends the scenario.

### Task 1: Code review: a comment on a dragged range keeps the range

**Depends on:** none

**Files:** `frontend/app/view/code/codeviewer.tsx`, `frontend/app/view/code/codereviewstore.ts`, `frontend/app/view/code/codereview.ts`, `frontend/app/view/code/codereviewstore.test.ts`, `frontend/app/view/code/codereview.test.ts`, `scripts/cdp/scenarios-code-review.mjs`

Final failed three steps of `code-review-send`, all one cause: a selection dragged over lines 2 to 4 (ending at
column 1), then the editor context menu's Add review comment, opens the input as "Comment on line 3" instead of
"Comment on line 2-3". The scenario's own read of the selection before the menu was `{from: 2, to: 3}`, so the range
is lost between the menu opening and `startComment` reading the selection (`readSelection` in `codeviewer.tsx`,
`selectionLines` in `codereview.ts`). The gutter then shows one marker and the sent message lacks `review.ts:L2-L3`
and `> const value_2 = 2;`.

The step passed in Task 6's own run (b53e46f17), so a later commit broke it. The likely one is Task 8's bd3d2e06f,
which moved the comment input into a view-zone gap and added Copy path to the same context menu; Task 16's
e5110d34a (Alt+M for the comment) is the other candidate. Find the commit that broke it, fix the cause so the menu
action reads the selection as it was when the menu opened, and keep every existing behaviour of ours (Alt+M on the
caret's line still comments that line). Add a unit case for the cause where it is pure logic.

Acceptance: `code-review-send` passes every step, including "a range dragged over lines 2 to 4 … opens the input on
lines 2-3", "the comment shows as a gutter bar on each of lines 2 and 3" and "picking the agent sends one message
holding the file, the lines, the quoted line and the comment"; `code-review-handoff` and `kael-keys` still pass;
`npx vitest run frontend/app/view/code` passes.

### Task 2: Terminal Code peek: the hover hint shows

**Depends on:** none

**Files:** `frontend/app/view/term/termpathlinks.ts`, `frontend/app/view/term/termwrap.ts`, `frontend/app/view/code/codepeekhost.tsx`, `scripts/cdp/scenarios-codepeek.mjs`

Final failed `code-peek` step 1, "hovering a path names Ctrl+click to open it and Ctrl+Shift+click to peek": no
`[data-tooltip]` appeared within 3 s of the mouse moving onto the linked path (`{"hint":""}`). Every later step of
`code-peek` passed, so the links and the peek work. Find out whether the hint is broken on the merged result (a
regression from a later task: Task 8's bd3d2e06f, Task 9, or Task 16's e5110d34a, or a clash with ours'
`TermLinkTooltip`) or whether the step races the first hover in a fresh app (the link provider's hover arrives only
after xterm sees a mouse move inside the link's cell). Fix a regression in the code. If it is the step's timing, make
the step drive the hover the way a person does (for example a second move inside the link, or waiting for xterm to
report the link before reading the hint), keeping the assertion: the hint names "click to open committed.ts" and
"Shift-click to peek". Name which one it was in your report.

Acceptance: `code-peek` passes every step on two runs in a row.

### Task 3: Code: a large markdown file opens without the Opening… flash

**Depends on:** none

**Files:** `frontend/app/view/code/codestore.ts`, `frontend/app/view/code/codesurface.tsx`, `scripts/cdp/scenarios-code-fixes-view.mjs`

Final failed `code-fixes-markdown`'s "a large markdown file opens without the Opening… flash or an empty pane":
`{"frames":145,"placeholder":2,"blank":0}`, so "Opening…" painted for 2 frames when the 200 KB file was reopened.
Task 8 (bd3d2e06f) shows Opening… only for a read slower than 150 ms; under the Final's load the read itself crossed
150 ms. Decided by the lead: keep the 150 ms rule (a read that is really slow should say so), and do not count a
placeholder that a genuinely slow read earns. Measure in the step how long the read took (or expose the read's
start and end through the store's existing dev hooks), and fail the step when Opening… shows on a read under the
threshold, or when it shows during the synchronous markdown render after the read returned, or when a frame is blank.
If you find the placeholder is shown for another reason (for example the 150 ms timer starting before the read
does, or not cleared when the read returns), fix that in the code instead. Keep `codePendingLineAtom`, `openPath`'s
signature and every existing test of ours unchanged.

Acceptance: `code-fixes-markdown` passes every step; `code-fixes-editor`, `code-fixes-jumps` and
`code-fixes-toolbar` still pass; `npx vitest run frontend/app/view/code` passes.

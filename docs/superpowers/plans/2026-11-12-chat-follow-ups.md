# Chat follow-ups: brainstorm cards, bash mode, inline visuals, sleep, Transcript tab

**Effort:** effort:dc0dbfa4-9f2f-4e18-b037-9637441389ad
**Spec:** `docs/superpowers/specs/2026-11-12-chat-follow-ups-design.md` (the decisions for each chunk, with why)
**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat chat-redesign agent-sleep rail-transcript-tab`

The spec holds each decision; a task here names its decisions, the files it owns, and how its acceptance is shown.
Implementation is the worker's. Every fix with pure logic gets a vitest next to its model. Every change to what is drawn
gets a numbered step in the scenario named below. The step drives the change itself (opening the surface is not
enough), takes a shot, and asserts.

Plan-wide rules:
- `scripts/cdp/scenarios.mjs` is one file shared by Tasks 2, 3 and 4. They run in that order (Depends lines), so each
  adds its steps after the previous task's. This is deliberate: their steps belong inside the `agent-chat` and
  `agent-sleep` scenarios, whose arrange and helpers (`acLayer`, `acSetShell`, the sleep fixtures) live in that file.
  A separate module would rebuild those fixtures, and a trailing steps task would split each fix from its proof. The
  three tasks are small.
- `CHANGELOG.md` is written only by Task 7.
- Run focused tests only: `npx vitest run <file>`.
- Never prettier `scripts/*.mjs`.

### Task 1: Brainstorm question card: a typed message does not hide the card; "You replied"
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbrainstorm.ts`, `frontend/app/view/agents/chatbrainstorm.test.ts`, `frontend/app/view/agents/chatbrainstormwire.ts`, `frontend/app/view/agents/chatbrainstormwire.test.ts`, `frontend/app/view/agents/chatbrainstormcard.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/brainstormmodel.ts`, `frontend/app/view/agents/brainstormui.tsx`, `scripts/cdp/scenarios-chat-redesign.mjs`

This task covers fefe19ba chunks 1 and 2 (spec, "Brainstorm card"). Chunk 3 is already done.

Chunk 1:
- `CardInput` gains `modifiedMs: number | null`, which is `BrainstormState.modifiedMs`; `chatpane.tsx` passes it into
  `brainstormCard`.
- An `answer` record hides question n only while `modifiedMs` is null or not later than the record's `sentAt`. A file
  written after the record, still asking n, shows the card again.

Chunk 2:
- `SentAnswer` gains `typed?: true`. `readRecord` keeps it only when it is the literal `true`. `PairedAnswer` and
  `pairedOf` carry it.
- `boxAnswerRecord` sets it.
- `BrainstormAction`'s `answer` gains `typed?: true`, and `sendRecord` copies it onto the record. The Brainstorm
  tab's words field, `useAnswer.sendDraft` in `brainstormui.tsx`, sends it when its kind is `answer`. Option clicks
  and ticked options (Chat's `QuestionBox`, the tab's option rows) leave it unset. Chat's question card has no words
  field; its hint points to the message box.
- `ChatBrainstormAnswered` takes `typed` and says "You replied" when it is set, "You picked" otherwise.
  `chatconversation.tsx` passes it.

Acceptance:
- vitest in `chatbrainstorm.test.ts`:
  - The card stays hidden while the file is older than the record.
  - The card shows when the file is newer and still asks n.
  - A null `modifiedMs` keeps today's hiding.
  - `typed` survives `parseSentStore` and reaches `pairAnswers`' result.
  - A non-`true` `typed` is dropped.
  - `sendRecord` copies `typed` from an `answer` action and leaves it off when the action has none.
- vitest in `chatbrainstormwire.test.ts`: `boxAnswerRecord` sets `typed`.
- A new step in the `chat-redesign` scenario (`scripts/cdp/scenarios-chat-redesign.mjs`) does this:
  1. With a question card waiting, type a question back in the box and send it.
  2. Rewrite the brainstorm file still asking the same n, with a later mtime.
  3. Assert the question card (`[data-chat-bscard-kind="question"]`) is drawn again.
  4. Assert the typed message's ✓ row (`[data-chat-bscard-answered]`) reads "You replied".
  5. Click an option on a card and assert its ✓ row reads "You picked".

### Task 2: Bash mode: escaped Tab picks, the list closes on blur, the ghost scrolls, no pills
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbash.ts`, `frontend/app/view/agents/chatbash.test.ts`, `frontend/app/view/agents/bashcomplete.tsx`, `frontend/app/view/agents/chateditor.tsx`, `frontend/app/view/agents/chateditormodel.ts`, `frontend/app/view/agents/chateditormodel.test.ts`, `frontend/app/view/agents/chatcomposer.tsx`, `scripts/cdp/scenarios.mjs`

This task covers 3e7f6ec0 chunks 2 to 5 (spec, "Bash mode").

Chunk 2:
- `applyCompletion` backslash-escapes a `file` pick's spaces and shell metacharacters. A folder's trailing `/` stays
  bare.
- `bashWordAt` keeps `\ ` inside a word and returns `word` unescaped. `start` and `end` span the escaped text.

Chunk 3:
- `ChatEditor` gains `onBlur?(e: FocusEvent)`.
- `useBashComplete` returns `onBlur`, which closes the list unless `relatedTarget` is inside `[data-chat-bash-list]`.
  `chatcomposer.tsx` wires it up.

Chunk 4:
- The ghost layer's `scrollTop` follows the contenteditable's: when the ghost shows, and on the editor's `scroll`.

Chunk 5:
- In bash mode the editor never makes pills. A pure option on `segmentsOf` (spec: `{ pills: false }`) returns the
  shown text as one plain segment.
- Every `$rebuild` in `chateditor.tsx` uses it while `bash` is on: the initial state and the Bridge's outside-value
  redraw.

Acceptance:
- vitest in `chatbash.test.ts`:
  - `my file.txt` becomes `my\ file.txt `.
  - A folder `a b/` becomes `a\ b/` with no space after it.
  - `$` `&` `;` `'` `(` are escaped.
  - Command and variable picks are unescaped.
  - `bashWordAt` on `!cat my\ fi` returns word `my fi`, and its span covers `my\ fi`.
- vitest in `chateditormodel.test.ts`: `segmentsOf("ls @src/a.ts now", 3, { pills: false })` is one text segment.
- New `agent-chat` steps in `scripts/cdp/scenarios.mjs`, numbered after the last existing step and using the mocked
  `ShellCompleteCommand` of steps 77-78 (`acSetShell`):
  1. A single answer `my file.txt` inserts `my\ file.txt `.
  2. With a several-answer list open, a click outside the box closes `[data-chat-bash-list]`.
  3. An 8+ line `!` command scrolled to its end draws `[data-chat-ghost]` within 2 px of the text's last line.
  4. Take a ghost that leaves a mid-command `@src/a.ts`; assert there is no pill element in the box, the box's value
     is unchanged, and the ghost lines up with the text's end.

### Task 3: Inline visuals: the skill forbids 100% / 100vh heights; the theme is re-posted on change
**Depends on:** Task 2
**Model:** sonnet
**Files:** `skills/visual/SKILL.md`, `frontend/app/view/agents/chatvisualview.tsx`, `frontend/app/view/agents/chatvisual.ts`, `frontend/app/view/agents/chatvisual.test.ts`, `scripts/cdp/scenarios.mjs`

This task covers 06d95fb4 chunks 4 and 5 (spec, "Inline visuals"). It waits on Task 2 only because both edit
`scripts/cdp/scenarios.mjs`.

Chunk 4:
- In `skills/visual/SKILL.md`, section Look, add one short paragraph by "Size to content". It tells the agent never to
  set `html` or `body` to `height: 100%`, `100vh` or a `min-height` of either, since the frame then never shrinks below
  the height it loaded at, and to let the content set the height.

Chunk 5:
- `ChatVisual` watches `document.documentElement`'s `style` and `class` attributes with a `MutationObserver`. Once the
  frame has said `arc-html-ready`, it re-posts `arc-visual-theme` when `themeVars(...)` differs from the vars last
  posted to that frame.
- The comparison is a pure helper in `chatvisual.ts`. The observer is disconnected on unmount.

Acceptance:
- vitest in `chatvisual.test.ts`: the helper says identical vars are no change, and one changed var is a change.
- A new `agent-chat` step in `scripts/cdp/scenarios.mjs`, after Task 2's:
  1. With `chart.html` (steps 40-44) drawn, switch the cockpit theme preset.
  2. Assert that the frame received the new `--arc-background`. The page is at wavesrv's origin, so read it through a
     fixture visual that echoes the theme it got back to the parent with `postMessage`, or attach to the frame target
     over CDP; the worker picks one and says which.
  3. Restore the preset.

### Task 4: Sleep: no terminal-typing actions on a sleeping agent; one canSleep rule
**Depends on:** Task 3
**Model:** sonnet
**Files:** `frontend/app/view/agents/consumers.ts`, `frontend/app/view/agents/consumers.test.ts`, `frontend/app/view/agents/agentsleep.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/cockpit/actions/agent.ts`, `frontend/app/cockpit/actions/agent.test.ts`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/agentrow.tsx`, `frontend/app/view/agents/planreviewsection.tsx`, `scripts/cdp/scenarios.mjs`

This task covers 552f8212 chunks 6 and 7 (spec, "Sleep"). It waits on Task 3 only because both edit
`scripts/cdp/scenarios.mjs`.

Chunk 6:
- Add `canDrive(vm)` to `consumers.ts`: `vm.blockId != null && vm.sleeping == null`.
- Gate only the uses that type into the terminal; leave the shared helpers as they are. `cockpit/actions/agent.ts`'s
  `live` also gates `agent:split`, and `agentdetailsrail.tsx`'s `live` also feeds the background-task rows. Gate:
  - `agent:nudge` with `canDrive(a) && live(a)`.
  - `agent:interrupt`'s `applies` and `offersReset` with `canDrive(a) && !isEndedWorkerId(a.id)`.
  - `agentheader.tsx`'s Interrupt and Redraw: off while asleep, as they are while waking.
  - `agentdetailsrail.tsx`: only the `railAction` input and its `drive` buttons.
  - `agentrow.tsx`'s Nudge.
  - `planreviewsection.tsx`'s continue.
- Look for any other `driveAgent`/`interruptAgent` caller with `grep`, and gate it the same way.

Chunk 7:
- `SLEEPABLE_AGENTS` moves into `consumers.ts`, which stays pure, and `agentsleep.ts` re-exports it. Its importers
  (`agenttree.tsx`, `cockpit-actions.ts`, `sessionsdetail.tsx`) are unchanged. Importing from `agentsleep.ts` instead
  would make a cycle (it imports `ramLabel` from `consumers.ts`) and pull RpcApi and the store into `consumers.ts`.
- `canSleep` uses `SLEEPABLE_AGENTS`. The `SLEEP_HARNESSES` constant goes.
- `canSleep` accepts `kind == null || kind === "agent"`.
- `agenttree.tsx`'s `sleepMenuItems` calls `canSleep(agent)` instead of repeating its conditions.

Acceptance:
- vitest in `consumers.test.ts`: `canDrive` is false asleep, false with no block, and true otherwise. `canSleep`
  accepts kind "agent" and refuses codex, a run's agent and a busy agent.
- vitest in `cockpit/actions/agent.test.ts`: a sleeping agent is offered none of `agent:nudge`, `agent:interrupt`,
  `agent:compact` or `agent:clear`. The same agent awake (at a context level that offers a reset) is offered them, and
  asleep it is still offered `agent:split`.
- A new step in the `agent-sleep` scenario (`scripts/cdp/scenarios.mjs`):
  1. With the fixture agent awake, open the command palette's agent actions on it. Assert Interrupt is offered, and
     Compact and Clear when its context level qualifies; set the fixture's context level so they do.
  2. Put it to sleep, open the same palette and its header More menu.
  3. Assert Interrupt, Compact, Clear and Nudge are gone, and Open in split is still offered.
  4. Assert its sidebar row menu offers Wake.

### Task 5: Transcript: the pinned band covers scroller padding, scrollTo clears the band, the drawn window is capped
**Depends on:** none
**Model:** sonnet
**Chunk:** PinnedPromptBar sticks at a scroller's padding edge, so a clipped line shows above it; sleepingtranscript.tsx's py-[12px] scroller likely shows it
**Chunk:** CompactTranscript scrollTo puts the item under the pinned prompt band; move the band-clearing offset from railtranscript.tsx into CompactTranscript
**Chunk:** CompactTranscript keeps every item appended while mounted drawn, so a long live session's DOM grows without a cap
**Files:** `frontend/app/view/agents/pinnedpromptbar.tsx`, `frontend/app/view/agents/compacttranscript.tsx`, `frontend/app/view/agents/compactwindow.ts`, `frontend/app/view/agents/compactwindow.test.ts`, `frontend/app/view/agents/railtranscript.tsx`, `scripts/cdp/scenarios-rail-transcript.mjs`

This task covers dc0dbfa4 chunks 5, 6 and 7 (spec, "Transcript tab").

Chunk 5:
- `PinnedPromptBar` reads its scroller's computed `padding-top`, sets the sticky row's `top` to minus that padding,
  and adds the same amount to the band's top padding.
- Update the "no top padding" rule comments in `pinnedpromptbar.tsx` and `railtranscript.tsx`.

Chunk 6:
- CompactTranscript's `scrollTo` scrolls the wanted item to just below the band: the band's bottom, from its own
  `[data-pinned-prompt] > div`, plus a gap. It re-checks while the band draws late.
- `railtranscript.tsx` drops its own band-clearing code (`MARKER_GAP_PX`, the band watch).

Chunk 7:
- The window is a key anchor (`windowStart(spans, anchor)`), not a count. A pure function in `compactwindow.ts` takes
  the spans, the current anchor and whether the reader follows the end, and gives the next anchor. Following the end
  with more than `RENDER_CAP` items drawn, it gives `spans[firstDrawn(spans.length, RENDER_CAP)].start`. Scrolled up,
  it gives the anchor unchanged.
- `compacttranscript.tsx` applies it as items are appended.

Acceptance:
- vitest in `compactwindow.test.ts`:
  - Following the end with 600 of 650 items drawn gives the anchor of the item `RENDER_CAP` from the end.
  - Scrolled up keeps the anchor.
  - With `RENDER_CAP` or fewer items drawn, the anchor is unchanged.
- New steps in the `rail-transcript-tab` scenario (`scripts/cdp/scenarios-rail-transcript.mjs`):
  1. Give the transcript's scroller a top padding (inline style), then scroll mid-transcript. Assert that
     `document.elementFromPoint` 1 px below the scroller's top is inside `[data-pinned-prompt]`.
  2. Jump to a compaction marker. Assert the marker's top is at or below the band's bottom.
  3. Append more than `RENDER_CAP` items to the fixture transcript while at the bottom. Assert that once the appends
     have drawn, the number of drawn compact items is at most `RENDER_CAP`, and that the newest item is drawn.

### Task 6: useTranscriptRead appends from its first read instead of re-reading a sliding tail
**Depends on:** Task 5
**Model:** sonnet
**Chunk:** useTranscriptRead re-reads a sliding 2,000-line tail, so past 2,000 lines History and the sleeping overlay shift the drawn window (on the base)
**Files:** `frontend/app/view/agents/transcriptread.ts`, `frontend/app/view/agents/transcriptread.test.ts`, `scripts/cdp/scenarios-rail-transcript.mjs`

This task covers dc0dbfa4 chunk 8 (spec, "dc0dbfa4 chunk 8"). It waits on Task 5 only because both edit
`scripts/cdp/scenarios-rail-transcript.mjs`.

- The first read takes the tail (`maxlines` 2000; Pi reads the whole file as today) and is kept as a `LoadedWindow`.
- Each change reads `frombyte: window.end` and grows the window with `appendLines` (`railtranscriptmodel.ts`, used as
  is). A `"reread"` reads the tail again.
- The entries are the projection of the window's lines.
- Put the pure step (the window and an answer give the next window, or a reread) in `transcriptread.ts`, or a sibling
  pure module, and test it.

Acceptance:
- vitest in `transcriptread.test.ts`:
  - An append keeps the window's first line and adds the new ones.
  - A reset answer asks for a reread.
- A new step in `rail-transcript-tab` (`scripts/cdp/scenarios-rail-transcript.mjs`), after Task 5's:
  1. Open Conversation History's detail for the fixture agent's live session, with a transcript past 2,000 lines.
  2. Note the first drawn item's text, append 50 lines, and wait for them to draw.
  3. Assert the first drawn item is unchanged and the new last line is drawn.
- If History cannot list the fixture session, use the surface that `useTranscriptRead` serves with `live` on, and say
  which in the step's label.

### Task 7: CHANGELOG lines and the other efforts' chunks
**Depends on:** Task 1 (writes its line), Task 4 (writes Tasks 2-4's lines), Task 6 (writes Tasks 5-6's lines)
**Model:** sonnet
**Files:** `CHANGELOG.md`

Under `## Unreleased` at the top of `CHANGELOG.md` (open one above a dated top section if needed), add these user-facing
lines. Keep each line one sentence, worded for the user:

- Fixed:
  - Chat's brainstorm card comes back when you ask the agent a question back instead of answering.
  - A typed answer's row says "You replied".
  - Bash-mode Tab escapes names with spaces or symbols.
  - Bash-mode Tab's list closes when you click away.
  - Bash-mode ghost text stays on a long command's last line.
  - Bash-mode `@path` stays plain text.
  - Inline visuals take on a new theme at once.
  - Interrupt, Compact, Clear and Nudge are no longer offered on a sleeping agent (they did nothing).
  - The pinned prompt no longer lets a line show above it.
  - Jumping to an item lands below the pinned prompt.
  - Conversation History of a long live session no longer shifts while it grows.
- Changed: a long live transcript keeps only its last screens drawn while you follow it.

Then mark the chunks the plan's Effort line cannot name as done, each with a note naming the run's branch:

```
wsh effort chunk status fefe19ba-9973-41fb-a762-c20923479f82 1 done --note "..."
wsh effort chunk status fefe19ba-9973-41fb-a762-c20923479f82 2 done --note "..."
wsh effort chunk status 3e7f6ec0-3a31-4fc8-8189-7eb640809056 2 done --note "..."   (and 3, 4, 5)
wsh effort chunk status 06d95fb4-0d52-4ea5-bec1-30f0c6cc4f16 4 done --note "..."   (and 5)
wsh effort chunk status 552f8212-1a41-402a-b55b-961c0f9e2932 6 done --note "..."   (and 7)
```

Acceptance:
- `git diff` shows only `CHANGELOG.md`.
- `wsh effort show <oid>` lists each of those chunks as done.

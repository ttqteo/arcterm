# Chat follow-ups: brainstorm cards, bash mode, inline visuals, sleep, Transcript tab

Date: 2026-11-12. An autonomous lead wrote this spec. Nobody was at the cockpit, so every call below is the lead's, with
the reason next to it.

This spec covers the open chunks of five initiatives:

| Effort | Chunks | Area |
|---|---|---|
| Chat brainstorm card follow-ups `fefe19ba` | 1, 2 (3 was already fixed on main, see below) | Chat's brainstorm question card |
| Chat bash mode follow-ups `3e7f6ec0` | 2, 3, 4, 5 | Chat's `!` bash mode |
| Chat inline visuals follow-ups `06d95fb4` | 4, 5 | `arc-visual` frames |
| Agent sleep follow-ups `552f8212` | 6, 7 | sleeping agents |
| Transcript tab follow-ups `dc0dbfa4` | 5, 6, 7, 8 | CompactTranscript, the pinned prompt, the transcript read |

Fixes with pure logic get a vitest. Fixes that change what is drawn get a CDP scenario step. Fixes a user would notice
get a CHANGELOG line.

## Brainstorm card

### fefe19ba chunk 3: already fixed, no work

The Brainstorm review / builder check / run in Chat run (merged as `b3ea93483`) removed `POINTER_LINE`. The run is now a
card (`ChatBrainstormRunRow`, `chatbrainstormrun.tsx`) that draws nothing once the run is landed, complete or cancelled,
and turns into the `✓ Run · … · Landed` row. Step 16 of `chat-brainstorm-review` asserts this. The lead marked the
chunk done.

### fefe19ba chunk 1: a message typed while a question waits hides the card for good

Cause: `boxAnswerRecord` (`chatbrainstormwire.ts`) records any words typed while a question card waits as the answer to
question n. `brainstormCard` → `answeredBy` (`chatbrainstorm.ts`) then hides question n for as long as the file asks it.
A question typed back to the agent ("keep it as 2.2?") is not an answer. The agent rewrites the file still asking n,
but Chat shows no card.

Decision: an `answer` record hides question n only while the brainstorm file has not been written since the record was
sent. If the file's `modifiedMs` is later than the record's `sentAt` and the file still asks n, the agent asked n again,
and the card shows.
- `CardInput` gains `modifiedMs: number | null`, which is `BrainstormState.modifiedMs`, and `chatpane.tsx` passes it.
- When `modifiedMs` is null, a record hides the card as it does today. With no file time to compare, keeping today's
  behaviour is the safe default.
- The rule applies to every `answer` record, clicked or typed. An agent that took a clicked answer moves on to n+1 or
  writes `working`, and `working` already hides the card. An agent that rewrites the file still asking n is asking
  again, however the answer came.

Why: the chunk's note prescribes this rule. It needs no new state beyond a time the brainstorm store already holds.

### fefe19ba chunk 2: a typed message's ✓ row says "You picked"

Decision: `SentAnswer` gains an optional `typed?: true`.
- `boxAnswerRecord` sets it for words sent from Chat's message box.
- The Brainstorm tab's own-words field sets it too: `useAnswer.sendDraft` (`brainstormui.tsx`) sends
  `{ kind: "answer", text, typed: true }` when its kind is `answer`, and `BrainstormAction`'s `answer` gains
  `typed?: true`, which `sendRecord` copies onto the record. Option clicks and ticked options (Chat's `QuestionBox`,
  the tab's option rows) leave it unset. Chat's question card has no words field of its own; its hint points to the
  message box.
- `readRecord` keeps it when it is the literal `true`. `PairedAnswer` carries it.
- `ChatBrainstormAnswered` (`chatbrainstormcard.tsx`) shows "You replied" when it is set and "You picked" otherwise.

Why the flag marks "typed" and not "picked": records stored before this change have no flag, and they all came from
clicks or from the box. Reading a missing flag as "You picked" keeps each old row's label unchanged.

## Bash mode

### 3e7f6ec0 chunk 2: Tab inserts a name with spaces or metacharacters unescaped

Decision: escape with backslashes, as bash's readline does when it completes.
- `applyCompletion` (`chatbash.ts`) escapes a `file` pick: each space, tab and shell metacharacter
  (`` ' " \ $ ` ! & ; | < > ( ) [ ] { } * ? # ~ `` and `=`) gets a `\` in front. A `/` that ends a folder stays bare, so
  the next Tab goes on into the folder.
- Command and variable picks are left as they are. compgen -c and -v names hold none of these characters.
- `bashWordAt` treats a backslash-escaped space as part of the word, so `my\ fi` is one word. It returns the word
  unescaped in `word`, which is what compgen gets. `start`/`end` still span the escaped text in the box.

Why backslashes and not quotes: a quote must be closed, which breaks the next Tab into a folder. Backslashes are also
what the shell itself prints.

### 3e7f6ec0 chunk 3: the Tab list stays open when the box loses focus to a click

Decision: `ChatEditor` gains an `onBlur?(e: FocusEvent)` prop, called when its contenteditable loses focus.
`useBashComplete` returns an `onBlur` that closes the list, unless the focus moved into the list itself (the event's
`relatedTarget` is inside `[data-chat-bash-list]`). `chatcomposer.tsx` wires it up.

### 3e7f6ec0 chunk 4: the ghost overlay does not scroll with the editor past its max height

Decision: the ghost layer copies the editor's `scrollTop`. When the ghost shows and whenever the contenteditable
scrolls, the layer's `scrollTop` is set to the editor's. The layer keeps `overflow-hidden`; setting `scrollTop` from
code still moves it.

### 3e7f6ec0 chunk 5: after taking a ghost, a mid-command `@path` can redraw as a file pill

Decision: a bash command never draws pills. The shell does not know `@` mentions, and the `@` picker is already shut in
bash mode.
- The editor builds its segments with a bash flag. Bash text is one plain text segment, so the ghost overlay, which
  mirrors the plain text, stays aligned.
- `segmentsOf(text, caret, { pills: false })` in `chateditormodel.ts` (or an equivalent pure entry) returns the text
  as one segment. `chateditor.tsx` uses it in its `$rebuild` calls (the initial state and the Bridge's outside-value
  redraw) whenever `bash` is on.
- Typing never turns text into a pill in bash mode.

## Inline visuals

### 06d95fb4 chunk 4: the skill must forbid `height: 100%` / `100vh`

Decision: `skills/visual/SKILL.md`, section Look, under "Size to content", tells the agent:
- Never set `html` or `body` to `height: 100%`, `100vh` or `min-height` of either, because the frame then never shrinks
  below the height it loaded at.
- Let the content set the height.

This is a doc change only. The skill is embedded in wavesrv, so the Verify line includes `./skills/...`.

### 06d95fb4 chunk 5: a drawn visual keeps the old colours after a theme switch

Decision: `ChatVisual` (`chatvisualview.tsx`) re-posts `arc-visual-theme` whenever the app's colours change, once the
frame has said `arc-html-ready`.
- What counts as a change: a `MutationObserver` on `document.documentElement`'s `style` and `class` attributes. That is
  where `useApplyCockpitTheme` writes the `--color-*` overrides, so the observer catches every way the theme changes:
  a preset, an override, a light/dark switch.
- The post happens only when `themeVars(...)` differs from the vars last posted to that frame. A pure helper in
  `chatvisual.ts` compares the two (vitest).
- The observer is disconnected on unmount.

Why observe the DOM rather than subscribe to the theme atoms: the atoms change before the shell's effect writes the
CSS variables, so reading computed styles on the atom change would read the old theme.

## Sleep

### 552f8212 chunk 6: Interrupt, /compact, /clear and Resume nudge write to a sleeping agent's dead PTY

Decision: actions that type into an agent's terminal are not offered while the agent sleeps. Wake, and the composer
that wakes it with a message, are the way in.
- A pure predicate `canDrive(vm)` in `consumers.ts`, beside `canSleep`: `vm.blockId != null && vm.sleeping == null`.
  `consumers.test.ts` tests it.
- Only the uses that type into the terminal are gated. Shared helpers are left alone, because they gate other things
  too: `cockpit/actions/agent.ts`'s `live` also gates `agent:split` (Open in split stays offered on a sleeper), and
  `agentdetailsrail.tsx`'s `live` also feeds the background-task rows. These are gated:
  - `cockpit/actions/agent.ts`: `agent:nudge` (`canDrive(a) && live(a)`), `agent:interrupt`'s `applies`, and
    `offersReset` for Compact and Clear, each with `canDrive(a) && !isEndedWorkerId(a.id)` where `live` held that.
  - `agentheader.tsx`'s Interrupt, along with the Redraw it keeps beside it: off while asleep, as they already are
    while waking.
  - `agentdetailsrail.tsx`: only the `railAction` input (with its `drive` buttons), not the other uses of `live`.
  - `agentrow.tsx`'s Nudge.
  - `planreviewsection.tsx`'s continue.
- `cockpit/actions/agent.test.ts` covers that a sleeping agent is offered none of the four, and is still offered Open
  in split.

Why not wake first and then type: Interrupt has nothing to interrupt on a sleeper. /clear on a sleeper is better served
by a fresh wake. Wake-then-type would also race the resuming TUI, which the header already guards against while
waking. Hiding the actions is the simple, correct cut.

### 552f8212 chunk 7: SLEEPABLE_AGENTS in agenttree.tsx duplicates canSleep

Decision: one rule and one harness list.
- `SLEEPABLE_AGENTS` moves into `consumers.ts`, which stays pure. `agentsleep.ts` re-exports it, so its importers
  (`agenttree.tsx`, `cockpit-actions.ts`, `sessionsdetail.tsx`) keep working. Importing it the other way would make a
  cycle (`agentsleep.ts` imports `ramLabel` from `consumers.ts`) and pull RpcApi, the global store and the modal model
  into `consumers.ts`. The duplicate `SLEEP_HARNESSES` goes.
- `canSleep` accepts `kind == null || kind === "agent"`, which is the menu's rule; an agent of kind "agent" is an
  agent.
- `agenttree.tsx`'s `sleepMenuItems` calls `canSleep(agent)` instead of repeating the conditions.
- `consumers.test.ts` covers the merged rule.

## Transcript tab

### dc0dbfa4 chunk 5: the pinned prompt band sticks at the scroller's padding edge

Cause: `top: 0` sticky sticks at the scroll container's padding edge, so a scroller with top padding shows a clipped
line above the band. Today every scroller that holds the band is told to have no top padding, and the rule is repeated
in comments.

Decision: `PinnedPromptBar` covers the scroller's top padding itself.
- It reads its scroller's computed `padding-top` (`scrollParent` is already in the file) and sets the sticky row's
  `top` to minus that padding.
- It adds the same amount to the band's top padding, so the band paints the gap.
- A scroller may then have top padding. The rule comments in `pinnedpromptbar.tsx` and `railtranscript.tsx` say so.

### dc0dbfa4 chunk 6: CompactTranscript's scrollTo puts the item under the pinned prompt band

Decision: CompactTranscript clears the band itself. `railtranscript.tsx` (around lines 418-450, `MARKER_GAP_PX`, the
band watch) scrolls the marker back below the band after CompactTranscript scrolled it to the top. That band-clearing
offset moves into `compacttranscript.tsx`'s `scrollTo` handling:
- After placing the wanted item at the top, CompactTranscript scrolls back by the band's bottom, measured from its own
  `[data-pinned-prompt] > div`, plus a gap.
- It re-checks while the band draws late, as the rail's watch does now.
- `railtranscript.tsx` drops its own copy.

Every CompactTranscript user gets the fix: History, the sleeping overlay and the ended transcript.

### dc0dbfa4 chunk 7: CompactTranscript keeps every appended item drawn

Decision: while the reader follows the end (at the bottom), the drawn window is trimmed back to `RENDER_CAP` items
from the end as items are appended. While the reader is scrolled up, nothing is trimmed: the place they are reading
stays put.
- CompactTranscript's window is a key anchor (`windowStart(spans, anchor)` in `compactwindow.ts`), not a count. The
  trim moves the anchor: following the end with more than `RENDER_CAP` items drawn, the new anchor is
  `spans[firstDrawn(spans.length, RENDER_CAP)].start`.
- The decision is a pure function in `compactwindow.ts` (spans, current anchor, whether the reader follows the end →
  the next anchor), tested in `compactwindow.test.ts`.
- `compacttranscript.tsx` applies it as items are appended.
- Reaching the top still grows the window by `RENDER_CAP` as it does now.

### dc0dbfa4 chunk 8: useTranscriptRead re-reads a sliding 2,000-line tail

Cause: each live re-read takes the file's last 2,000 lines, so past 2,000 lines the first entry changes on every
re-read. Entry indexes are CompactTranscript's keys, so Conversation History's drawn window and open folds shift.

Decision: `useTranscriptRead` (`transcriptread.ts`) reads the tail once, then appends.
- It keeps that first read as a `LoadedWindow`.
- Each change re-reads only the lines written since the window's end (`frombyte: end`). The window is grown with
  `appendLines` from `railtranscriptmodel.ts`, the same model the Transcript tab uses; that file is reused, not edited.
- A `"reread"` answer (the file was truncated or replaced) reads the tail again.
- The entries are the projection of the window's lines.
- Pi still reads the whole file. Its active branch needs every line, and a whole file never slides.
- The pure step (window plus answer gives the next window, or a reread) is tested in a new
  `transcriptread.test.ts`, or through `appendLines`' existing tests if the hook only composes it.

## Out of scope

Live checks the chunks name stay open: 06d95fb4 chunks 1, 2, 3 and 6; 552f8212 chunks 1 to 5; dc0dbfa4 chunks 1 to 4;
3e7f6ec0 chunks 6 and 7.

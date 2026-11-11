# Chat redesign: floating box, step lines, spring motion

Date: 2026-11-11 · Brainstorm: `.superpowers/brainstorm/chat-redesign/brainstorm.json` ·
Initiative: "GUI redesign after the AI-chat references" (`effort 7655bf18-619e-40cf-8805-5f4a6e5ac85e`, chunk
"Chat redesign: conversation + composer, motion and smoothness")

**Prototype:** D:\work\arcterm\.superpowers\design\chat-redesign\project

The canvas holds two boards: `A-floating.dc.html` (the new Chat, with a state switcher for the box) and
`bscard-A-inline.dc.html` (the brainstorm question card, drawn over today's Chat for layout only). The live motion
spike is `.superpowers/design/chat-redesign/spike/motion.html`. It shows every motion in this spec at the chosen speed,
and its "Hiện tại" button shows today's instant jump for comparison.

## Goal

Redesign the Chat view of a Claude agent on the Agent surface, after three AI-chat reference shots: a floating pill
message box, compact step lines, a frosted suggestion panel, and motion that never jumps. Smoothness matters as much
as the look.

## Scope

- In scope: Chat's conversation (messages, tool steps, replies) and its message box. Code lives in
  `frontend/app/view/agents/chat*.tsx` and their models.
- Out of scope: other surfaces and the shared popovers, palette, menus and toasts. Whether those follow later is a
  blocked `Decide:` chunk in the initiative. Also out: voice recording and select-text-to-reply from the references.
- Kept as they are: every feature Chat has today, restyled where it is drawn. That covers bash mode, file pills and
  cards, the slash and plus menus, the panel command cards (`/usage`, `/context`…), the skim toggle, folding long
  replies, the pinned prompt bar, Show earlier, the kept reading place (`transcriptplace.ts`), the permission card,
  AskUserQuestion choices and sleeping-agent wake.

## Design

### 1. The floating box (board `A-floating.dc.html`)

- The message box floats over the conversation, 24px in from the pane's edges and 20px from the bottom. It is at most
  720px wide, centred, with radius 22px, `bg-surface-raised`, an `edge-mid` border (`edge-strong` while focused) and
  `shadow-popover-soft`.
- Inside the box: the text on top, then one row. The row holds a round `+` button, a pill chip for the model and its
  dot, an effort/mode pill, the context percentage, and a round 34px Send button in the accent colour with
  `shadow-inset-highlight`. The chips are pill-shaped (`rounded-full`).
- The conversation scrolls under the box. A functional fade sits under the box and over the conversation's last lines,
  about 190px tall, from transparent to the background. Build it from tokens
  (`color-mix(in srgb, var(--color-background) …)`), never a hex.
- The conversation's bottom padding follows the box's measured height plus a margin (a ResizeObserver on the box).
  This keeps the last line scrollable above the box whatever its height.
- A round 32px jump-to-latest button (↓) sits centred just above the box while the reader is scrolled up. It replaces
  today's `JumpToLatestPill` placement in Chat only, and enters and leaves on opacity and scale.

### 2. The box changes shape by state

The box is one object whose height springs between states while the contents cross-fade on the micro ease (140ms):

- **Idle:** the placeholder (`Reply to <agent>, @ to mention, / for commands`), then the row above.
- **Agent running:** the placeholder says the reply waits for the turn to end (keep today's queued-send wording). The
  row holds suggested action chips (e.g. Show the diff, Open the terminal: actions Chat already offers, no new
  commands) and a round Stop button (Esc) in place of Send.
- **Dragging files over:** the box becomes a dashed drop zone ("Drop files to attach", "Images, text files, folders ·
  they go in as @ mentions") on a faint accent tint. Dropping keeps today's behaviour.
- **Typing `/` (suggestions open):** see 4.
- Bash mode and other existing box states keep their content and take the same shape and motion.

### 3. Step lines while running, folded when done

- While the agent works, each step is one compact line: an icon, a verb (Thought, Read, Edit, Ran, Search…), then a
  chip per thing it touched. A file chip carries its `FileIcon`, a command chip is in mono on `bg-surface-code`, and
  more than a few chips end in `+N`. A running step shows a dashed spinner and its elapsed time. Clicking a line opens
  its detail (output, diff) below it on the spring.
- When the agent moves on from a stretch of tools to writing (or the turn ends), that stretch's lines fold on the
  spring into today's one line, `Worked for 38s · 5 tools` (`workedFor` in `compacttimeline.ts`), which opens again
  on click. Only the stretch running now shows its steps, as today's `autoOpen` rule (`chatconversation.tsx` ~705)
  already decides (builder question 4, the person's answer).
- Each step's verb, icon and chips come from the existing `WorkItem` data in `compacttimeline.ts`. No new transcript
  parsing.
- **Agent's call (builder question 2):** one line per tool call, as `WorkItem.actions` holds them today (one
  `AgentActionEntry` per call, drawn by `ToolLine`); no merging of consecutive same-verb calls. `+N` applies only to a
  tool that touches several things in one call (a multi-edit, a search hit list). A click opens that one call's output.
- **Agent's call (builder question 3):** no Thought lines. `transcriptprojection.ts` skips thinking blocks on purpose,
  and this spec adds no transcript parsing; the verb list above is illustrative. The live working line keeps saying
  the agent is working while it thinks.

### 4. Frosted suggestion panel

- Slash commands and @ suggestions open in a panel floating just above the box, as wide as the conversation column.
  It has radius 16px, `--color-panel` fill with a static `backdrop-filter: blur(18px)`, an `edge-mid` border and
  `shadow-popover-soft`.
- A key line heads the panel: `↑↓ to navigate · ⏎ to select · esc to close`, with key caps. The selected row is
  `bg-hover`.
- The panel enters and leaves on scale (0.97 → 1, from its bottom edge) on the spring, with opacity on the ease. The
  blur itself never animates.

### 5. Type rhythm

Keep Inter: the references use Inter too. Prose stays at 14px with line-height ~1.6–1.65, headings in replies at
15px weight 600, and the Chat column takes tracking -0.01em. User bubbles get radius 16px. No new font.

### 6. Brainstorm question card in Chat (board `bscard-A-inline.dc.html`)

Decided by the person:

- Brainstorm stays its own tab (Chat | Terminal | Brainstorm).
- While the agent has a brainstorm open, its question turn draws in the conversation as a card. The card has:
  - a header: icon, `Question N · <part>`, an amber `Waiting on you` dot, and an `Open in Brainstorm` button (Alt+C);
  - the question and its why;
  - the options as compact rows, as in `brainstormui.tsx`'s compact Options: the letter, label and detail, with
    `Agent's pick` on the pick;
  - a `Read · …` line;
  - a footer with a `Compare N boards in Brainstorm` link.

  It shows no pros, cons or boards.
- Clicking an option sends exactly the line `brainstormsend.ts` sends. Typing in the box answers in words. While a
  question waits, the placeholder reads `Answer question N in your own words, or pick A–C above`.
- Once answered, the card folds into one ✓ row, `Question N · <part> — <answer> · You picked`. That row replaces the
  user's message bubble, so the answer is never shown twice.
- `skills/brainstorm/SKILL.md`: while the pane is open, the agent's terminal reply is one line and never repeats the
  question.

Filled in by the agent, and confirmed:

- The card uses the new Chat's look. The board only fixes its layout.
- It enters by opening its height and fading in, and folds into the ✓ row on the spring without pushing content.
- While the judge weighs a question (no options yet), the card shows the question, its why and a line saying the judge
  is weighing N approaches, with no option rows.
- An open-text question has no option rows. Its placeholder reads `Answer question N in your own words`.
- A multi-answer question has tick boxes and a Send button in the card, and sends the labels joined by ` + `.
- The builder check and starting a run stay in the Brainstorm tab. Chat shows one line pointing there.
- When the agent has exited, a waiting card turns static (no amber dot) and still opens in Brainstorm.
- **Agent's call:** Chat does not switch to the Brainstorm tab on its own when a brainstorm attaches. The card already
  signals it, and switching mid-read loses the reader's place.

- **Matching answers to the transcript (builder question 1, the person's answer):** Arc keeps a record of what it
  sends. Whenever an answer goes to the agent (a click in the Chat card, the Brainstorm pane, or the box while a
  question waits), Arc stores `{ n, text sent, sent at }` for that agent, persisted so it survives a reload and a
  sleeping agent. The first user message after `sent at` whose text equals `text sent` draws as that question's ✓ row
  in place of its bubble. That holds for every answered question in the conversation, not only the latest one, and a
  message that matches an option label by chance is never taken because the time must match too. The waiting card
  sits at the end of the conversation, after the last agent message. `brainstorm.json` and the skill's format do not
  change. Where the record lives (block meta, a small wstore object, or a file beside `brainstorm.json`) is the
  builder's choice; it must not need a new waveobj type without its migration.

Pure model: a new `chatbrainstorm.ts` (+ `chatbrainstorm.test.ts`) pairs the send record with the transcript's user messages and the open question in
`brainstorm.json`. Drawn in `chatconversation.tsx` as a new row kind; placeholder in `chatcomposer.tsx`.

## Motion

### Feel

- Everything that changes shape uses a no-bounce spring: the box, the suggestion panel, the buttons, row heights,
  open/fold. A spring keeps its velocity when its target moves mid-way, so fast changes never stall or jump.
- Opacity keeps the Fluid ease from `motiontokens.ts`.
- One token: `MOTION.spring = { type: "spring", visualDuration: 0.35, bounce: 0 }` in `element/motiontokens.ts`, with
  a test. Its ~0.35s settle matches `durMacro` (360ms), which the person chose over 0.25s and 0.45s in the spike.
- Chat's `composerReveal` and `paneReveal` uses move to it.
- Reduced motion: springs jump. The existing `MotionConfig reducedMotion="user"` covers motion components. Hand-rolled
  height or scroll code checks `prefers-reduced-motion`.

### Smoothness: how new content arrives

Transcript content arrives a whole block at a time, and `useStickToBottom` pins with `scrollTop = scrollHeight`, so
today each block is an instant jump. The chosen approach (judge's pick, question 5) works like this:

- Each new row, or each new part inside the last row, opens its height 0 → auto on the spring and fades in. Wrap
  `visible.map` in `chatconversation.tsx` in `AnimatePresence initial={false}`, and wrap the parts `drawPart` adds as
  well, because a new part of the agent's reply usually lands inside the existing last item. Note that today's
  `AnimatePresence` at line ~452 wraps only FileChips' diff.
- `useStickToBottom` keeps its behaviour. Its ResizeObserver already re-pins whenever a child's height changes, so the
  tail rides each frame of the opening row with no new scroll logic. Its other users (subagent interior, runs worker
  cards) are untouched.
- Fix: the ResizeObserver also observes the scroller itself. The box sits outside the scroller (`chatpane.tsx`), so a
  taller box could otherwise cover the tail.
- These never animate: items Show earlier draws in front, and a restored reading place (`transcriptplace.ts`). Both
  compensate `scrollTop` themselves.
- A very long block animates only its last ~320px of height (the rest is there at once), so the view never races.
- Tool detail open/fold and the steps folding into `Worked for…` use the same spring.
- Switching agents needs nothing new: each agent's Chat lives in its own grid cell that stays mounted, and keeps its
  scroll.

The person wants all five of these smooth after the redesign:

1. Following the tail while the agent replies, with no snap back while reading up.
2. New rows arriving without shoving content.
3. Tool detail open and fold.
4. The box changing height.
5. Switching agents without a flash, a skeleton or a lost scroll position.

## DESIGN.md

Record the new spring token, and three deliberate Chat exceptions:

- the floating box's 22px radius with `shadow-popover-soft`, where depth is otherwise tonal;
- the functional fade under the box, which is a gradient but not a wash;
- the frosted panel's static `backdrop-filter` on `--color-panel`.

Colours stay on tokens.

## Verification

- Unit tests: the new token (`motiontokens.test.ts`), `chatbrainstorm.ts`, and any extracted pure model, such as the
  box state reducer or the step-line model built from `WorkItem`.
- A new CDP scenario in `scripts/cdp/scenarios.mjs` that shows:
  - the floating box idle, running, with files dragged over, and with the `/` panel open;
  - step lines while running, and folded once the turn is done;
  - the brainstorm card open and folded;
  - the jump button while scrolled up.
- Frame timing measured over CDP while blocks stream in: the worst frame should stay at or under ~20ms. Compare it
  with a measurement on `main` before the change.
- `task check:ts`. Add a `- [ ]` line in `docs/hand-checks.md` for anything not verified in the running app.
- One CHANGELOG line under Changed: Chat's new look and smoother motion.

## Builder decisions (orchestrator lead, 2026-11-11)

Calls the spec left to the builder, made by the run's lead with nobody at the cockpit:

- **Where the brainstorm send record lives: `localStorage`**, key `chat.brainstorm.sent`, a map from agent id to its
  records `{ topic, n, part, text, sentAt, seen }`, at most 50 per agent (oldest dropped). Why: it survives a reload and a
  sleeping agent (the agent id is kept across sleep: the box is keyed by it today), needs no Go, wire or migration
  change, and stays out of the agent's project folder. A read that throws (private storage) degrades to no ✓ rows,
  logged once, never an error in the pane. Records match by agent id and topic, so a later brainstorm in the same
  agent never takes an older one's answer.
- **Spec change: answers pair by count, not by time.** The transcript projection keeps no timestamp on a user entry
  (`transcriptprojection.ts` drops `rec.timestamp`), so "the first user message after `sent at`" cannot be read.
  Each record instead holds `seen`, how many of the agent's user entries already had exactly that text when it was
  sent (the rule `chatpending.ts` uses for pending bubbles), and the (`seen` + 1)-th such message is the answer. It
  keeps the spec's guarantee: a message that matched an option label before the send is never taken.
- **The spring is a token plus two variants.** `MOTION.spring` as the spec says, and in `motiontokens.ts`:
  `springReveal` (height 0 → auto on the spring, opacity on the Fluid ease at `durMicro`, exit back to 0 on the
  spring) and `springPop` (scale 0.97 → 1 on the spring from the element's bottom edge, opacity on the ease). Chat's
  uses of `composerReveal` and `paneReveal` move to `springReveal`; other surfaces keep theirs. Why: one source of feel;
  every Chat site needs one of the two shapes.
- **The box state is a pure reducer**, `chatboxstate.ts`: `boxState({ asleep, running, dragging, suggesting, bash })
  → "idle" | "running" | "drop" | "suggest" | "bash" | "asleep"`, with a fixed precedence (drop > suggest > bash >
  asleep > running > idle), and `boxPlaceholder(state, name, override)`; a waiting brainstorm question is only the
  placeholder's override. The running placeholder is the board's `Reply to <agent>; it waits for the turn to end`
  (no queued-send placeholder exists today). Why: the shape and the placeholder come from one place and are
  unit-tested; the components only draw it.
- **Open in Brainstorm** sets the agent's view to Brainstorm (`setBrainstormMode`) and shows `Alt+C`, the existing
  `agent:view-cycle` chord, as its hint; no new binding.
- **Suggested action chips while running are the two actions Chat already has:** "Show the diff" (the existing
  `openDiff` route `onLocal` takes) and "Open the terminal" (`setChatMode(agent.id, "terminal")`). No new command.
- **The suggestion panel is opt-in on the shared pickers.** `useSlashMenu` and `useFileMention` are shared with the
  launcher (`launcheragentfields.tsx`); they take a `look?: "frosted"` option, and only Chat's box passes it. The
  launcher keeps today's list.
- **Step lines are Chat's own component**, `chatsteps.tsx` over a pure `chatsteps.ts` (`stepOf(action) → { verb,
  icon, chips, more, running }`), not a restyle of the shared `ToolLine` (`narrationtimeline.tsx`), which the live feed
  and the rail transcript also draw. A step's open detail reuses `ToolLine`'s detail body.
- **The jump button is Chat's own** (`data-chat-jump`), drawn by `chatpane.tsx`; `JumpToLatestPill` stays for its
  other users.
- **The brainstorm card's pieces and their integration are separate.** `chatbrainstorm.ts` (pure),
  `chatbrainstormstore.ts` (the send record), `chatbrainstormcard.tsx` (the card and the ✓ row) come first; one later
  step draws them in the conversation, sets the placeholder and records answers sent from the box.
- **The 320px cap** on a long block's opening: a new row taller than 320px opens from `height: scrollHeight - 320` to
  auto (the rest is there at once). Implemented as an `initial` height computed at mount; reduced motion skips it.
- **Frame timing:** the new `chat-redesign` scenario streams 30 blocks into a fixture transcript and reads frame
  intervals with `requestAnimationFrame` over CDP. It passes at p95 ≤ 20ms and reports the worst frame; the `main`
  baseline (the same step run before the redesign merges) is written into the scenario file's header.
- **DOM contract** the scenario and the components share (existing `data-chat-*` attributes stay as they are, so the
  `agent-chat` and `chat-scroll-keep` scenarios keep passing): `[data-chat-box]` with `data-chat-box-state`,
  `[data-chat-fade]`, `[data-chat-jump]`, `[data-chat-action-chip]`, `[data-chat-stop]`, `[data-chat-send]`,
  `[data-chat-suggest-panel]` (holding the existing `[data-chat-slash]` / mention list), `[data-chat-step]` (with
  `data-chat-step-running` while running), `[data-chat-step-chip]`, `[data-chat-step-more]`, `[data-chat-bscard]` with
  `data-chat-bscard-state` = `waiting | weighing | static`, `[data-chat-bscard-option]`, `[data-chat-bscard-send]`,
  `[data-chat-bscard-open]`, `[data-chat-bscard-pointer]`, `[data-chat-bscard-answered]`. Step lines also keep
  `ToolLine`'s `data-tool-running` / `data-tool-settled` and sit inside `[data-chat-tools]`, under the
  `[data-chat-work] [data-fold]` header, which `agent-chat` asserts.

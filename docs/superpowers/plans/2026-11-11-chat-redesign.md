# Chat redesign: floating box, step lines, spring motion — plan

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-11-chat-redesign-design.md` (read its "Builder decisions" section: the calls and the DOM contract every task shares)
**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat chat-scroll-keep chat-redesign`
**Prototype:** D:\work\arcterm\.superpowers\design\chat-redesign\project\A-floating.dc.html

Goal: redesign Chat (conversation + message box of a Claude agent on the Agent surface) after the spec: a floating
pill box that changes shape by state, compact step lines that fold into `Worked for…`, a frosted suggestion panel, the
brainstorm question card, and spring motion so nothing jumps. Frontend only, plus one line in the brainstorm skill.

Rules for every task:

- Read `DESIGN.md` and the prototype boards (`A-floating.dc.html`, `bscard-A-inline.dc.html` in the Prototype's
  folder; open the `.dc.html` source, it is HTML) before styling. Colours only from `@theme` tokens; no hex/rgba.
- Pure logic goes in a `foo.ts` with `foo.test.ts` beside it; the `.tsx` stays thin. No jsdom render tests.
- Keep every existing `data-chat-*` attribute, the scroller element (`[data-agent-chat] .overflow-y-auto`) and
  every feature the spec's "Kept as they are" lists: the `agent-chat` and `chat-scroll-keep` scenarios run in Final.
  `agent-chat` also asserts, in Chat: tool rows carrying `data-tool-running` / `data-tool-settled`
  (`scripts/cdp/scenarios.mjs` ~43388, ~43676–43694), a live `[data-chat-work] [data-fold]` header reading
  `Working for…` (~43675), and `[data-chat-tools]` text naming the tools (Read, Edit) after a click (~42942). Read
  those asserts before changing what they touch, and keep them true.
- Use the DOM contract in the spec's "Builder decisions" exactly: the `chat-redesign` scenario (Task 7) is written
  against it in parallel with the UI.
- Reduced motion: motion components follow `MotionConfig reducedMotion="user"`; hand-rolled height or scroll code
  checks `prefers-reduced-motion`.
- Do not run `task dev`, a build, `node scripts/verify.mjs`, or the whole vitest suite (Task 7's one baseline run is
  the only exception); run your focused tests and `task check:ts` (give it a
  timeout over 2 minutes). Never run `task install`. Never `prettier --write` the tree; check only files you touched.

### Task 1: Spring motion token, spring variants, scroller re-pin, DESIGN.md
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/element/motiontokens.ts`, `frontend/app/element/motiontokens.test.ts`, `frontend/app/view/agents/sticktobottom.tsx`, `DESIGN.md`

Decisions: `MOTION.spring = { type: "spring", visualDuration: 0.35, bounce: 0 }` (typed as a motion `Transition`).
Two variants beside it: `springReveal` (initial `{opacity:0,height:0}`; animate height `"auto"` on `MOTION.spring`
and opacity on `{duration: MOTION.durMicro, ease: MOTION.easeFluid}`; exit height 0 on the spring, opacity on the
ease) and `springPop` (initial `{opacity:0, scale:0.97}`, animate scale 1 on the spring, opacity on the ease, exit
back; callers set `transform-origin: bottom`). Existing tokens and variants are unchanged.

`useStickToBottom` (`sticktobottom.tsx`): the ResizeObserver also observes the scroller element itself, so a change of the scroller's own height
(the floating box growing) re-pins a stuck tail. No other behaviour change; its other users are untouched.

DESIGN.md: record the spring token (shape changes on the spring, opacity on the Fluid ease) and the three deliberate
Chat exceptions the spec's "DESIGN.md" section lists (floating box radius 22px + `shadow-popover-soft`; the functional
fade under the box; the frosted panel's static `backdrop-filter` on `--color-panel`).

Acceptance: `npx vitest run frontend/app/element/motiontokens.test.ts` passes with new cases asserting
`MOTION.spring` equals the spec's value, that `springReveal.animate` uses height `"auto"` with the spring transition on
height and the Fluid ease on opacity, and that `springPop` scales from 0.97. `task check:ts` clean.

### Task 2: The floating box and its states
**Depends on:** Task 1 (uses `MOTION.spring`, `springReveal`, `springPop` and the scroller re-pin)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/chatfooter.tsx`, `frontend/app/view/agents/chatboxstate.ts`, `frontend/app/view/agents/chatboxstate.test.ts`

Spec sections 1, 2 and the "Motion" items 4 (box height) and the jump button. Decisions:

- `chatboxstate.ts` (pure): `boxState(input: { asleep: boolean; running: boolean; dragging: boolean; suggesting:
  boolean; bash: boolean }) → "idle" | "running" | "drop" | "suggest" | "bash" | "asleep"` with precedence drop >
  suggest > bash > asleep > running > idle (no brainstorm input: a waiting question changes only the placeholder);
  and `boxPlaceholder(state, agentName, override?: string | null) → string` (idle: `Reply to <agent>, @ to mention,
  / for commands`; running: `Reply to <agent>; it waits for the turn to end` (the board's wording: no queued-send
  placeholder exists today); asleep: today's `message <agent> to wake it… (Enter)`; `override` wins when given).
- The box state is computed inside `ChatComposer` (it owns drag, slash, mention and bash state), which sets
  `data-chat-box-state` and reports it up through an optional `onBoxState?: (s: BoxState) => void` prop.
  `chatpane.tsx` calls `boxPlaceholder` and keeps passing the result as `ChatComposer`'s existing required
  `placeholder` prop; Task 6 adds the brainstorm override at that one call in `chatpane.tsx`.
- `ChatComposer`'s `onSent` becomes `onSent?: (text: string) => void`, called with the text that went to the agent
  (today's call site, `jumpToBottom`, keeps working). Task 6 relies on it.
- Layout (`chatpane.tsx`): the box moves out of the flex footer and floats absolutely over the conversation, 24px
  from the pane's sides, 20px from the bottom, max 720px, centred; radius 22px, `bg-surface-raised`, `edge-mid` border
  (`edge-strong` focused), `shadow-popover-soft`. Inside: text on top, one row: round `+`, model pill with its dot,
  effort/mode pill, context %, round 34px accent Send with `shadow-inset-highlight` (`[data-chat-send]`); chips
  `rounded-full`. Restyle `chatfooter.tsx`'s chips to pills; keep their behaviour. The goal strip stays with the box.
- Running: suggested action chips `[data-chat-action-chip]` "Show the diff" (the existing `openDiff` route) and
  "Open the terminal" (`setChatMode(agent.id, "terminal")`), and a round Stop (Esc) `[data-chat-stop]` in place of
  Send. Drop: dashed drop zone on a faint accent tint, "Drop files to attach" / "Images, text files, folders · they go
  in as @ mentions"; dropping keeps today's behaviour. Bash and asleep keep their content in the same shell.
- The box root carries `[data-chat-box]` and `data-chat-box-state={boxState(...)}`. Its height springs between
  states (a `motion.div` with `layout="size"`-free approach: animate an explicit measured height on `MOTION.spring`
  via a ResizeObserver on the inner content); contents cross-fade on the micro ease.
- The fade `[data-chat-fade]` (~190px, transparent → background via `color-mix(in srgb, var(--color-background) …)`)
  sits over the conversation's last lines under the box, `pointer-events-none`.
- The scroller's bottom padding = measured box height + 16px margin (ResizeObserver on the box), so the last line
  scrolls above the box.
- Jump-to-latest: Chat draws its own round 32px ↓ `[data-chat-jump]`, centred just above the box while scrolled up,
  entering and leaving with `springPop`; `JumpToLatestPill` is no longer drawn in `ChatPane` (its other users keep it).

Acceptance: `npx vitest run frontend/app/view/agents/chatboxstate.test.ts` covers every state, the precedence
(dragging while running → drop; suggesting while bash → suggest) and the placeholder override. Scenario steps (Task 7
writes them): `chat-redesign` "box idle", "box running", "box drop", "jump button". `task check:ts` clean.

### Task 3: Frosted suggestion panel
**Depends on:** Task 2
**Model:** sonnet
**Files:** `frontend/app/view/agents/slashmenu.tsx`, `frontend/app/view/agents/filemention.tsx`, `frontend/app/view/agents/pickerlist.tsx`, `frontend/app/view/agents/chatcomposer.tsx`

Spec section 4. Decisions: `useSlashMenu` and `useFileMention` take `look?: "frosted"`; only `chatcomposer.tsx`
passes it, so `launcheragentfields.tsx` keeps today's list unchanged. Frosted: a panel `[data-chat-suggest-panel]`
floating just above the box, as wide as the conversation column, radius 16px, `--color-panel` fill with a static
`backdrop-filter: blur(18px)`, `edge-mid` border, `shadow-popover-soft`; a key-line header `↑↓ to navigate · ⏎ to
select · esc to close` with key caps; the selected row `bg-hover`. It enters/leaves with `springPop` from its bottom
edge (exit plays: keep it under an `AnimatePresence`); the blur never animates. Keep `[data-chat-slash]`,
`[data-chat-slash-item]`, the mention list attributes and all key handling. While the panel is open the box state is
`suggest` (Task 2's reducer input `suggesting` = `slash.shown || mention.shown`).

Acceptance: the launcher's slash list is unchanged (no `look` passed: same DOM as before). Scenario steps
`chat-redesign` "slash panel open" (asserts `[data-chat-suggest-panel]` holds `[data-chat-slash]`, its computed
`backdrop-filter` contains `blur(18px)`, and the box state is `suggest`) and "mention panel open" (the same for the
`@` list). `task check:ts` clean.

### Task 4: Step lines and smooth arrival in the conversation
**Depends on:** Task 1 (uses `springReveal` and `MOTION.spring`)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatsteps.ts`, `frontend/app/view/agents/chatsteps.test.ts`, `frontend/app/view/agents/chatsteps.tsx`

Spec section 3 and "Smoothness: how new content arrives". Decisions:

- `chatsteps.ts` (pure): `stepOf(action: AgentActionEntry, live: boolean) → { verb: string; icon: <icon key>; chips:
  StepChip[]; more: number; running: boolean }`, with `StepChip = { kind: "file"; path: string } | { kind: "command";
  text: string } | { kind: "text"; text: string }`, at most 3 chips then `more` = the rest. Built only from the
  existing `AgentActionEntry` / `WorkItem` data (`compacttimeline.ts`); one step per tool call, no merging, no Thought
  lines.
- `chatsteps.tsx`: `ChatSteps({ work, open, closed, autoOpen, live, onToggle })`, the same props `WorkPill` takes
  today; it replaces `WorkPill` in `drawPart`. Open (the `autoOpen` stretch running now, or opened by click): one
  line `[data-chat-step]` per call: icon, verb, chips (`[data-chat-step-chip]`: file chips with `FileIcon`, command
  chips mono on `bg-surface-code`, `[data-chat-step-more]` `+N`); a running step `data-chat-step-running` shows a
  dashed spinner and its elapsed time. Clicking a line opens that call's detail (reuse `ToolLine`'s detail from
  `narrationtimeline.tsx` without editing that file, e.g. render `ToolLine` for the open one) on `springReveal`. When
  the stretch is no longer `autoOpen`, the lines fold on the spring into today's `Worked for 38s · 5 tools` line,
  which opens again on click.
- What `agent-chat` asserts stays true: the `[data-chat-work] [data-fold]` header is drawn in both states (it reads
  `Working for…` while running, `Worked for…` once done), the step lines sit inside `[data-chat-tools]`, each step
  carries `data-tool-running` while running and `data-tool-settled` when a stopped session left it without a result
  (the same rules `ToolLine` uses: `inFlight` and its `neutral`), and a step's text names its tool (Read, Edit…).
- Type rhythm (spec section 5) for the Chat column: prose 14px, line-height 1.6–1.65; reply headings 15px weight 600;
  the conversation root `tracking-[-0.01em]`; user bubbles radius 16px. Inter stays; no new font.
- Arrival: wrap `visible.map` in `AnimatePresence initial={false}` and each item in a `motion.div` with
  `springReveal`'s initial/animate (no exit), and likewise the parts `drawPart` adds inside an existing item, so a new
  part landing in the last item opens too. Items drawn by Show earlier and a restored reading place never animate
  (they arrive with `initial={false}` behaviour: track which keys were present at the last render and the "earlier"
  path, and skip the animation for those). A new row taller than 320px opens only its last 320px (initial height =
  measured height − 320). FileChips' diff moves to `springReveal`. Do not change `useStickToBottom`; its observer
  re-pins on each frame of the opening row.

Acceptance: `npx vitest run frontend/app/view/agents/chatsteps.test.ts` covers the verb/chip mapping for Read, Edit
(multi-file → chips + `more`), Bash (command chip), Grep/Glob, an unknown tool, and `running` true only for an
in-flight call of a live session. Scenario steps: `chat-redesign` "steps running", "step detail" (click a step: its
output opens under it; a multi-edit step shows file chips and `[data-chat-step-more]`), "steps folded", "type rhythm"
and "frame timing". `task check:ts` clean.

### Task 5: Brainstorm card pieces and the send record
**Depends on:** Task 1 (uses `springReveal` for the fold)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbrainstorm.ts`, `frontend/app/view/agents/chatbrainstorm.test.ts`, `frontend/app/view/agents/chatbrainstormstore.ts`, `frontend/app/view/agents/chatbrainstormcard.tsx`, `frontend/app/view/agents/brainstormsend.ts`, `frontend/app/view/agents/brainstormsend.test.ts`, `skills/brainstorm/SKILL.md`

Spec section 6. Decisions and interfaces Task 6 relies on:

- `chatbrainstormstore.ts`: the send record in `localStorage` key `chat.brainstorm.sent`: `recordBrainstormAnswer(
  agentId, { topic, n, text, sentAt, seen })` (at most 50 per agent, oldest dropped) and `brainstormAnswers(agentId) →
  SentAnswer[]`, plus a jotai atom so a new record redraws. `seen` is how many of the agent's user entries already
  held exactly that text when it was sent — the rule `chatpending.ts`'s `PendingMessage.seen` uses — because the
  transcript projection carries no timestamp on a user entry (`agentsviewmodel.ts` `AgentEntry` "user";
  `transcriptprojection.ts` drops `rec.timestamp`). Callers count with `userTextCount` (`chatpending.ts`) on the
  entries they hold. Reads and writes in try/catch; a failure logs once and degrades to no records.
- `chatbrainstorm.ts` (pure): `pairAnswers(records, userMessages: { key: string; text: string }[] (in transcript
  order), topic) → Map<messageKey, { n, part, text }>`: for each record of that topic, the (`seen` + 1)-th user message
  whose text equals the record's text, never an earlier one, so a message that matches an option label by chance
  before the send is never taken; and `openQuestion(file: BrainstormFile | null, records, exited: boolean) →
  { n, part, question, why, options, pick, read, multi, openText, weighing, boards, state: "waiting" | "weighing" |
  "static" } | null` (null when the open question is already answered or no brainstorm is attached); and
  `questionPlaceholder(q) → string` (`Answer question N in your own words, or pick A–C above`; open text: `Answer
  question N in your own words`). Read `brainstormmodel.ts` for the file's shape.
- `chatbrainstormcard.tsx`: `ChatBrainstormCard({ agent, question, onPick })` drawing the card the spec describes
  (`[data-chat-bscard]`, `data-chat-bscard-state`, rows `[data-chat-bscard-option]` with `Agent's pick`, multi-answer
  tick boxes + Send `[data-chat-bscard-send]` joining labels with ` + `, the weighing line, the `Read · …` line,
  `Compare N boards in Brainstorm`, no pros/cons/boards), entering on `springReveal`; and `ChatBrainstormAnswered({
  n, part, text })`, the ✓ row `[data-chat-bscard-answered]`. `Open in Brainstorm` `[data-chat-bscard-open]` calls
  `setBrainstormMode(agent.id, "brainstorm", Date.now())` (`brainstormstore.ts`, the setter the Brainstorm tab reads)
  and shows `Alt+C` as its key hint: that chord is `agent:view-cycle` (`bindings.ts`), which walks the agent's views
  to Brainstorm; no new binding. When the open question has reached the builder check or a run start, the card is one
  line pointing to the Brainstorm tab (`[data-chat-bscard-pointer]`), since both stay there (spec section 6). A
  click on an option sends exactly the line `brainstormsend.ts` sends (call `sendBrainstorm`).
- `brainstormsend.ts`: `sendBrainstorm` records the answer (`recordBrainstormAnswer`, with `seen` counted on the
  agent's loaded entries; take them as an optional argument, absent → 0) whenever it sends a question's answer, so
  the Chat card and the Brainstorm pane both record. Export the function that turns an action into its sent text if
  Task 6 needs it.
- `skills/brainstorm/SKILL.md`: while the pane is open, the agent's terminal reply is one line and never repeats the
  question.

Acceptance: `npx vitest run frontend/app/view/agents/chatbrainstorm.test.ts frontend/app/view/agents/brainstormsend.test.ts`
covers: the message after the `seen` ones paired; a same-text message that was already there at send (`seen` = 1)
never taken; two answered questions both paired; a record of another topic ignored; open question states waiting /
weighing (no options) / static (agent exited); open text and multi placeholders; and that `sendBrainstorm` records
`{ n, text, seen }` with the exact sent line. `go test ./skills/` passes (the skill is embedded). `task check:ts`
clean.

### Task 6: Draw the brainstorm card in Chat, record box answers, changelog
**Depends on:** Task 2, Task 4, Task 5 (uses the card, the store and the pure pairing)
**Chunk:** Chat redesign: conversation + composer, motion and smoothness
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`, `CHANGELOG.md`, `docs/hand-checks.md`

- `chatconversation.tsx`: user messages paired by `pairAnswers` draw as `ChatBrainstormAnswered` in place of their
  bubble (every answered question, not only the latest); the waiting card draws at the end of the conversation, after
  the last agent message, as its own row kind (animated like other rows; folds into the ✓ row on the spring without
  pushing content). Pass what it needs from `chatpane.tsx` (the agent, its brainstorm state via `brainstormAtom`).
  Chat never switches to the Brainstorm tab on its own.
- `chatpane.tsx`: while a question waits, pass `questionPlaceholder(q)` as the `override` of its `boxPlaceholder`
  call (Task 2). Through `ChatComposer`'s `onSent(text)` (Task 2), a message sent from the box while a question waits
  is recorded with `recordBrainstormAnswer` (that question's `n`, the text sent, now, and `seen` =
  `userTextCount(entries, text)`). `chatcomposer.tsx` is Task 3's; this task does not edit it.
- `CHANGELOG.md`: one line under `Changed` in the top `Unreleased` section (open one if the top has a date): Chat's
  new look (a floating message box, compact step lines, the brainstorm question card in the conversation) and
  smoother motion.
- `docs/hand-checks.md`: a `- [ ] (arcterm) …` line for what Final cannot see: the motion's feel at 60fps in the
  packaged app, drag-and-drop of real files from Explorer onto the box, and a real brainstorm answered from Chat.

Acceptance: scenario steps `chat-redesign` "brainstorm card open" (with the question placeholder in the box),
"brainstorm card weighing", "brainstorm card multi", "brainstorm card static" and "brainstorm card folded" (the
answered message draws as `[data-chat-bscard-answered]` and no bubble with the same text remains). `task check:ts`
clean.
`npx vitest run frontend/app/cockpit/whatsnew.test.ts` passes (the CHANGELOG line parses).

### Task 7: The `chat-redesign` CDP scenario
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-chat-redesign.mjs`, `scripts/cdp/scenarios.mjs`

A new scenario file registered in `SCENARIOS` the way `scenarios-rail-transcript.mjs` is (import + spread; pass it
the helpers it needs as that one does). Model the arrange/teardown on `chat-scroll-keep` in `scenarios.mjs`
(a fixture Claude transcript in a temp dir, a fixture roster via the existing helpers, `agent.chatmode` and the grid
saved and restored). It is written against the spec's DOM contract while the UI tasks run, so it must not depend on
their code beyond those attributes. Steps, each with a screenshot:

1. "box idle": `[data-chat-box][data-chat-box-state="idle"]`, its radius 22px, `[data-chat-fade]` present,
   `[data-chat-send]` present.
2. "box running": roster state `working` → state `running`, at least one `[data-chat-action-chip]`, `[data-chat-stop]`.
3. "box drop": dispatch `dragenter`/`dragover` with a `Files` DataTransfer on the box → state `drop`; then
   `dragleave` → back.
4. "slash panel open": type `/` in `[data-chat-input]` → `[data-chat-suggest-panel] [data-chat-slash]` visible, its
   computed `backdrop-filter` has `blur(18px)`, state `suggest`; Escape closes it.
5. "mention panel open": type `@` → `[data-chat-suggest-panel]` holding the mention list, the same blur, state
   `suggest`; Escape closes it.
6. "steps running": a live working agent whose transcript's last stretch has an in-flight tool → `[data-chat-step]`
   lines inside `[data-chat-tools]`, one `[data-chat-step-running]` that also carries `data-tool-running`, and the
   `[data-chat-work] [data-fold]` header reading `Working for`.
7. "step detail": the stretch holds a multi-file edit (more than 3 files): its step shows `[data-chat-step-chip]`s and
   `[data-chat-step-more]`; click a finished step → its output opens under it.
8. "steps folded": append the tool results and a prose reply to the transcript → the stretch shows the
   `[data-chat-work] [data-fold]` `Worked for…` line and no `[data-chat-step]` under it.
9. "type rhythm": a prose paragraph in `[data-chat-prose]` computes 14px with line-height 22.4–23.1px; a reply
   heading 15px weight 600; `[data-chat-conversation]` letter-spacing -0.14px (±0.02); a user bubble radius 16px.
10. "brainstorm card open": write a `.superpowers/brainstorm/<topic>/brainstorm.json` fixture with an open question
    (three options, an agent pick) in the fixture project and attach it the way `scenarios-brainstorm-judge.mjs` does
    → `[data-chat-bscard][data-chat-bscard-state="waiting"]` with three `[data-chat-bscard-option]`, and the box's
    placeholder reading `Answer question 1 in your own words, or pick A–C above`.
11. "brainstorm card weighing": rewrite the file so the question has no options yet → state `weighing`, no option
    rows.
12. "brainstorm card multi": a multi-answer question → tick boxes and `[data-chat-bscard-send]`.
13. "brainstorm card static": roster marks the agent exited → state `static`, no amber dot, `[data-chat-bscard-open]`
    still there.
14. "brainstorm card folded": write a send record `{ topic, n: 1, text, sentAt, seen: 0 }` into
    `localStorage["chat.brainstorm.sent"]` (reload so the store reads it), append the matching user message to the
    transcript, and mark the question answered in the file → `[data-chat-bscard-answered]`, and no user bubble with
    that text. (User entries carry no timestamp; pairing is by `seen`, see Task 5.)
15. "jump button": scroll the conversation up → `[data-chat-jump]` visible; click → back at the end and it leaves.
16. "frame timing": append 30 assistant blocks to the transcript, ~150ms apart, while recording
    `requestAnimationFrame` intervals in the page; pass at p95 ≤ 20ms; the step's detail reports p95 and worst frame.

Baseline (an explicit exception to the no-dev-app rule above, for this task only, once): before finishing, run only
this scenario in your tree (`node scripts/cdp/final-verify.mjs chat-redesign`, which starts and stops its own dev app;
steps 1–15 fail there since your tree has today's Chat) and write step 16's p95 and worst frame into the file's
header comment as the `main` baseline. If the dev app cannot start in your tree, say so in your report and leave the
baseline line as "not measured" with the reason.

Acceptance: `node -e "import('./scripts/cdp/scenarios.mjs').then(m => { if (!m.SCENARIOS.some(s => s.name === 'chat-redesign')) process.exit(1) })"`
exits 0; `node --check scripts/cdp/scenarios-chat-redesign.mjs` passes; the baseline line is in the header.

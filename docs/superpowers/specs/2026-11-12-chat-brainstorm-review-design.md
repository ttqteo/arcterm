# Brainstorm review, builder check and run in Chat

Date: 2026-11-12 · Brainstorm: `.superpowers/brainstorm/chat-brainstorm-review/brainstorm.json` ·
Initiative: "GUI redesign after the AI-chat references" (`effort 7655bf18-619e-40cf-8805-5f4a6e5ac85e`, chunk
"Chat: Confirm the design and Decided so far, compact (brainstorm chat-brainstorm-review)")

**Prototype:** D:\work\arcterm\.superpowers\design\chat-brainstorm-review\project

The canvas holds one board, `A-fold-in-card.dc.html`: the open question card with "Decided" folded into its footer
(section 2). Its copy is Vietnamese because the example brainstorm is; the UI strings follow section 7.

## Goal

Chat draws a brainstorm's open question as a card (spec `2026-11-11-chat-redesign-design.md`, section 6), but nothing
after it. Once the agent stops asking, the design waits on the user's review (Confirm the design), and Chat shows
nothing; the decisions made so far live only in the Brainstorm tab's rail; the builder check and the run are one line
pointing to the tab. The person asked for Confirm the design and Decided so far in Chat, shown compactly, and then for
the builder check and the run's start too (answer 1).

## Scope

- In scope: four things in Chat's conversation, all for an agent with a brainstorm attached: the Confirm the design
  card, Decided so far folded into the question card, the builder check card, and the run card.
- This replaces one call of the chat-redesign spec (section 6, "The builder check and starting a run stay in the
  Brainstorm tab. Chat shows one line pointing there"): both now have cards in Chat. The Brainstorm tab keeps
  everything it has (boards, pros and cons, the full review) and stays one click away on every card.
- Out of scope: run cards for runs that did not start from a brainstorm, and any change to the Brainstorm tab.

## What exists today

- `openQuestion` (`frontend/app/view/agents/chatbrainstorm.ts`) returns null when no question is open and the
  brainstorm is still in its talk phase, so while the design awaits review (`awaitsReview`, `brainstormmodel.ts`)
  Chat draws nothing. The check and run phases are one `PointerCard` line.
- An answered question folds into a ✓ row (`ChatBrainstormAnswered`, `chatbrainstormcard.tsx`) in place of the
  user's message bubble.
- The Brainstorm tab's review uses `reviewHead` (summary line and Confirm all, from two guesses up),
  `confirmableGuesses` and `partView` (`guess` / `changed` / `yours`), all in `brainstormmodel.ts`. Its Decided so far
  rail is in `brainstormpane.tsx`. The builder check's view is `BuilderCheckView` (`brainstormmodel.ts`) and its
  review layout is `brainstormreview.tsx` (what is new or changed listed, "yours, unchanged" folded).
- Every action the cards need is already a `BrainstormAction` (`brainstormmodel.ts`) that `sendBrainstorm`
  (`brainstormsend.ts`) sends: `confirm`, `confirm-all`, `edit`, `keep`, `restore`, `keep-all`, `check`,
  `builder-answer`, `builder-decide`, `approved` (through `approveAndOpenRun`), `keep-talking`.
- A run's stage, read one way everywhere, is `runStage` (`frontend/app/view/agents/runstage.ts`).
- What the user has seen of a brainstorm is `brainstormSeenAtom` (`brainstormstore.ts`) and `unseenSince`
  (`brainstormmodel.ts`).

## Design

### 1. Confirm the design card (answer 2, the judge's pick)

Once the agent has stopped asking and the design awaits review, the conversation ends with a Confirm the design
card:

- A header like the question card's: `Confirm the design`, the amber `Waiting on you` dot, `Open in Brainstorm`.
- `reviewHead`'s line and its one action: `Confirm all N guesses` from two guesses up, or `Check with a builder` once
  every decision is yours.
- One row per decision that needs the user, and only those: a guess (gist, `That's right`, `Edit`) or a decision the
  agent changed since the user confirmed it (gist, what changed and why, `Keep the change`, `Put mine back`).
- The user's own unchanged decisions fold into one row, `N yours ›`, which opens in place, one gist per line.
- A guess that is new since the user last looked carries a `New` label (`unseenSince`). Agent's call (builder
  question 4): Chat writes `brainstormSeenAtom` too, not only the Brainstorm tab. It sets the baseline the first time
  it draws the Confirm card and marks the brainstorm seen when the user leaves Chat or the card folds. Without this a
  Chat-only user never gets a baseline, so `New` would never show. The mark is shared, so seeing the design in Chat
  also clears the tab's own `New` marks.
- Agent's call (builder question 3): the card stays until the builder check is sent. Once every decision is yours,
  all rows are folded into `N yours ›` and its one action is `Check with a builder`. It folds into its ✓ row
  (section 5) when `check` is sent, not when the last guess is confirmed. While the agent still has questions
  (`done` false) there is no Confirm card: the question card is open.

### 2. Decided so far in the question card (answer 3, the judge's pick; board `A-fold-in-card.dc.html`)

While a question is open, the question card's footer gains one more control before the `Compare N boards` link:
`Decided N ›`, which opens in place into one line per decision the user has made (title, gist), the same fold as the
Confirm card's `N yours ›`. Closed by default; nothing else in the card moves.

### 3. Builder check card (answer 4: all of it in Chat)

- While the builder reads: the card says so, with its clock, as the tab does. A failed check shows its reason and
  `Try again`.
- Each question the builder leaves for the user (`check.yours`) is asked as a question card,
  `Builder question N · <part>`, with its options and pick; a pick sends `builder-answer`, and `Decide for me` sends
  `builder-decide`.
- The decisions the agent made itself (`check.calls`) fold into `Agent's calls N ›`; what the spec already answered
  folds the same way.
- Once nothing is open: `Approve` opens the run launcher with the spec attached (`approveAndOpenRun`), and
  `Keep talking` sends `keep-talking`.

### 4. Run card (answer 5)

When a run starts from the brainstorm (`brainstorm.run` set), a run card shows the run's name, its kind (orchestrator
or quick) and its `runStage` stage (Planning, Working, Final check, Landed, Held…), updated in place. No task bar, no
in-card actions beyond opening the run (through `openref.ts`).

### 5. How the cards sit in the conversation (answer 6)

Each step is its own card at the end of the conversation. When a step is done its card folds into one ✓ row and stays
in the timeline: `✓ Design confirmed · 9 decisions`, `✓ Builder check · 2 questions, 3 calls`. The run card stays
live until the run lands, then folds the same way.

Agent's call (builder question 1): a folded ✓ row is anchored to the transcript message that ended its step, as a
question's ✓ row is. `✓ Design confirmed` takes the place of the `brainstorm: check` message, and `✓ Builder check`
takes the place of `brainstorm: approved` or `brainstorm: keep talking`. `brainstorm.json` keeps no history of these
steps (keep talking sets `check` back to null). So Arc keeps a send record for these actions, as `SentAnswer` does for
answers (`chatbrainstorm.ts`, `chatbrainstormstore.ts`), with the row's counts captured at send time, and pairs it
with the message by the same `seen` rule. Rows then survive reloads and a second talk → confirm → check cycle. The
stored record grows a `kind`, and a record without one reads as an answer.

The `brainstorm: …` lines the cards send (builder question 2, the person's answer: "hide them, except the builder
answers"): an action line (`confirm`, `confirm every guess`, `edit`, `keep`, `restore`, `keep every change`, `check`,
`builder decide`, `approved`, `keep talking`) draws no bubble. Its effect shows on the card and in the step's ✓ row.
A builder answer folds into a ✓ row, `Builder question N · <part> — <answer>`, as a question's answer does, in place
of its bubble. Chat recognizes these lines by the same send record. It hides only lines Arc sent and paired, never a
`brainstorm:` line the user typed.

### 6. Left to the builder (confirmed)

- Model: extend `openQuestion` into card kinds (question, confirm, check, run), each a pure function with vitest
  beside it; the cards draw in `chatbrainstormcard.tsx` and reuse `reviewHead`, `confirmableGuesses`, `partView`,
  `runStage` and `sendBrainstorm`.
- `Edit` on the Confirm card opens an inline editor on that row, as the tab does, and sends `edit`; `Keep the change`
  and `Put mine back` send `keep` and `restore`.
- `New` comes from `brainstormSeenAtom` / `unseenSince`.
- An agent that has exited turns every card static (no amber dot), still opening in Brainstorm, as the question card
  does today.
- Motion: cards enter and fold on the spring the question card uses (chat-redesign section 6).
- The wording of the ✓ rows' counts and of the buttons.
- An `agent-chat` CDP scenario step for each card and its folded row, and one `CHANGELOG.md` line.

### 7. Strings

Chat's UI strings stay English, as the rest of Chat (`Waiting on you`, `You picked`): `Decided N`, `N yours`,
`Agent's calls N`. The user's content (titles, gists) shows as written.

## Testing

- vitest for every pure card model: which card shows in each phase (asking, judging, awaiting review, check reading,
  check questions, check failed, approved, run started, run landed, exited agent), which rows the Confirm card lists,
  the fold counts, and the `New` mark.
- CDP: `agent-chat` steps that open each card and its folded ✓ row, and the `Decided` fold open and closed (the board
  `A-fold-in-card.dc.html` is the reference for the question card's footer).

## Builder decisions

Calls the run's lead made beyond the sections above (2026-11-12, autonomous run), each with why. Every task of the plan
works from these and the DOM contract below.

1. **One card model, `brainstormCard`.** `chatbrainstorm.ts` gains `brainstormCard(input): ChatCard | null` with
   `ChatCard = QuestionCard | ConfirmCard | CheckCard | RunCard` (each with a `kind`), beside today's `openQuestion`,
   which the wiring task then deletes with `PointerCard` and its pointer line. Why: one pure function decides which
   card shows in each phase, so the phase table in Testing is one vitest file. Its input is the shown file
   (`shownBrainstormFile`), the agent's send records, `exited`, the topic, the builder check view
   (`builderCheckView`, computed as `brainstormpane.tsx` computes it) and the seen mark. Order of precedence: a run
   (`file.run`) → a talk question (as `openQuestion` decides today) → a pending or failed builder check, or
   `file.check` set, or a `check` line pending → the Confirm card (`done`, no question, no check, no run, and
   something to do: `reviewHead`'s action set or at least one guess/changed row; `working` while the agent writes up a
   review action, decision 2) → nothing. With parts still asked or open and nothing to confirm there is no card.
2. **The Confirm card folds the moment `check` is sent.** The shown file then says the agent is writing
   (`PENDING_CHECK`), and from then the check card shows in its reading stage, so nothing blank sits between the two.
   The model reads that from the pending sent line's kind (`BrainstormState.sent.kind === "check"`). Any other line
   the agent is writing up (a confirm, an edit, a keep) leaves the Confirm card in place in a `working` state (its
   buttons off, the shown file's `working` text as its line) instead of removing it until the agent writes again, so a
   click never makes the card vanish and come back. Between the send and Arc's builder check record (`brainstorm:check*`
   on the tab) the check view is still `none`; the check card then reads as a reading check with the pending-check line
   (`A builder is reading the design.`), and its clock shows only once `checkClock` has an elapsed time (a record
   exists), as the tab's does.
3. **The send record grows a `kind`** (`answer`, `builder-answer`, `design`, `builder`, `run`, `action`), recorded by
   `sendBrainstorm` for every line it sends, from Chat or from the Brainstorm tab alike: both are lines Arc sent.
   `design` is a `check` (counts: decisions); `builder` is `approved` or `keep-talking` (counts: questions, calls; and
   which of the two); `run` is `brainstorm: run <id>` (its run id); `builder-answer` keeps the builder question's
   number and part; every other action line is `action`. That includes `guess` and `skip` (`brainstorm: guess`,
   `brainstorm: skip questions`), which section 5's list leaves out: they are action lines Arc sent, and the person's
   answer was to hide those. An `answer` sent with no question open (pushback or a question back, typed in the tab's
   line box) gets no record at all and stays a bubble: it is the user's own words, not an action. Records other than
   `answer` and `builder-answer` store `n: 0` and `part: ""` (the stored shape still requires both). A `check` sent
   while the agent's newest `design`/`builder` record of this topic is `design` (a Try again after a failed check) is
   `action`, so a retry draws no second `✓ Design confirmed`. A stored record without `kind` reads as `answer`. Only
   `answer` records count as answering a talk question (a `builder-answer` with `n` 1 must not hide talk question 1
   after keep talking). The cap per agent rises from 50 to 200, since every action now leaves one. The type keeps its
   name `SentAnswer` (renaming it touches every importer for no behaviour).
4. **What each paired message draws:** `answer` → today's question ✓ row; `builder-answer` → `✓ Builder question N ·
   <part> — <answer>`; `design` → `✓ Design confirmed · N decisions`; `builder` → `✓ Builder check · Q questions, C
   calls` (`· kept talking` added for keep talking); `run` → nothing while the run is live (its card is at the end),
   then `✓ Run · <name> · <stage>` once the run is landed, complete or cancelled; `action` → nothing at all (no
   bubble, no row). A `brainstorm:` line the user typed has no record and stays a bubble.
5. **One builder question at a time**, the first unanswered (`check.yours`), as the tab asks them; the ones answered
   before it are ✓ rows in the timeline (decision 4). A builder question's card has its options (a pick sends
   `builder-answer` with the option's label), `Decide for me`, and an inline field to answer in words (sends
   `builder-answer`), since the message box sends plain text the agent would read as pushback. The box's placeholder
   is left as it is while a builder question is open.
6. **After the builder's questions, the check card lists what still needs the user**: the rows of `checkReview` whose
   action is keep/restore or confirm, drawn with the same decision row as the Confirm card. `Approve` stays off with
   `approveBlocker`'s reason beside it until none is left. Why: approving is refused by the same rule in the tab, and
   showing the reason is better than a dead button.
7. **`New` marks:** the poller already baselines every attached brainstorm on its first read
   (`baselineBrainstormSeen`, `brainstormpoller.ts`), Chat or not. The Confirm card still calls the idempotent
   `baselineBrainstormSeen` when it mounts, and calls `markBrainstormSeen` with the file it last drew when it unmounts
   (the user leaves Chat or the card folds), as `brainstormpane.tsx` does.
8. **Run card:** reads the run through `useRunInfo` (`runlineagestore.ts`) and `runStage`: name (`title`), kind
   (`Quick run` when `mode` is `quick`, else `Orchestrator run`), the stage's label and tone. `Open run` opens it
   through `openTarget`/`openAddress` (`frontend/app/view/jarvis/openref.ts`). Landed, complete or cancelled folds it
   (decision 4).
9. **Exited agent:** every card turns static: no amber dot (`Agent exited` in its place), every send button disabled,
   `Open in Brainstorm` kept.
10. **The check card's clock** reuses the tab's: `useCheckTimes` moves out of `brainstormpane.tsx` into
    `brainstormchecktimes.ts` so both import it; `checkClock`/`checkSpan` are already pure; the ticking time is
    `model.nowAtom`.
11. **Scenario:** a new `chat-brainstorm-review` scenario (`scripts/cdp/scenarios-chat-brainstorm-review.mjs`), built
    like `chat-redesign`'s brainstorm steps (one fixture Claude agent, its transcript, its `brainstorm.json` written and
    revealed), in place of new steps in `agent-chat`. Why: the question card's steps already live in `chat-redesign`,
    `agent-chat` sits in the 67k-line `scenarios.mjs` other plans edit, and a scenario of its own can be run alone.
    `chat-redesign`'s step that asserted the pointer line at the builder check now asserts the check card. This
    replaces the `agent-chat` steps named in section 6 and in Testing; `agent-chat` still runs in the Final, unchanged.
12. **A run card that is done draws no end row at all** (no empty wrapper holding the column's gap): the end row for a
    run card is a component that reads the run and returns nothing once it is landed, complete or cancelled.

### DOM contract

Every task uses these attributes exactly; the scenario is written against them.

- Every card: the section carries `data-chat-bscard-kind` (`question`, `confirm`, `check`, `run`) and
  `data-chat-bscard-state` (`waiting`, `weighing`, `working` or `static`); `[data-chat-bscard-open]` (Open in
  Brainstorm) as today. The question card keeps `data-chat-bscard`, `data-chat-bscard-n` and its option attributes.
- Folds: the toggle `[data-chat-bscard-fold="<name>"]` with `aria-expanded`, its list
  `[data-chat-bscard-fold-list="<name>"]` drawn only when open; names `decided` (question card footer), `yours`
  (Confirm card), `calls` and `spec` (check card).
- Confirm card: `[data-chat-bscard-review-line]`; `[data-chat-bscard-confirm-all]` or `[data-chat-bscard-check]`;
  decision rows `[data-chat-bscard-decision="<part id>"][data-view="guess|changed"]`, a `New` label
  `[data-chat-bscard-new]`; buttons `[data-chat-bscard-right]`, `[data-chat-bscard-edit]`, `[data-chat-bscard-keep]`,
  `[data-chat-bscard-restore]`; the inline editor `[data-chat-bscard-editor]` (a textarea and its Send).
- Check card: `data-chat-bscard-stage` (`reading`, `taking-in`, `failed`, `asking`, `review`); `[data-chat-bscard-clock]`;
  `[data-chat-bscard-check-reason]` and `[data-chat-bscard-retry]` when failed; the builder question
  `[data-chat-bscard-builder="<n>"]` with `[data-chat-bscard-option]` rows, `[data-chat-bscard-decide]` and
  `[data-chat-bscard-own]` (the words field and its Send); the review's decision rows as on the Confirm card;
  `[data-chat-bscard-approve]`, `[data-chat-bscard-approve-reason]`, `[data-chat-bscard-keep-talking]`.
- Run card: `data-chat-bscard-run-stage="<RunStageKey>"`, `[data-chat-bscard-run-open]`.
- ✓ rows: questions keep `[data-chat-bscard-answered]`; a builder answer is `[data-chat-bscard-answered]
  [data-kind="builder"]`; steps are `[data-chat-bscard-done="design|builder|run"]`.

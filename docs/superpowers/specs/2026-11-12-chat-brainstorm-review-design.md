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

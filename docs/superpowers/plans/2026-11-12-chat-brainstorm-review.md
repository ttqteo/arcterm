# Brainstorm review, builder check and run in Chat — plan

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-12-chat-brainstorm-review-design.md` (read its "Builder decisions" section and its DOM contract: every task works from them)
**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-brainstorm-review chat-redesign agent-chat`
**Prototype:** D:\work\arcterm\.superpowers\design\chat-brainstorm-review\project\A-fold-in-card.dc.html

Goal: Chat draws the whole brainstorm after its questions: a Confirm the design card, Decided so far folded into the
question card's footer, the builder check as a card, and the run as a card, each folding into a ✓ row anchored to the
message that ended its step, with the `brainstorm: …` action lines Arc sent hidden. Frontend only.

Rules for every task:

- Read `DESIGN.md`, the spec (all of it, "Builder decisions" and "DOM contract" above all) and, for any view, the
  prototype board (open the `.dc.html` source; its copy is Vietnamese, the UI strings are the spec's English ones).
  Colours only from `@theme` tokens; no hex/rgba.
- Pure logic goes in a `.ts` with a `.test.ts` beside it; the `.tsx` stays thin. No jsdom render tests.
- Use the spec's DOM contract exactly: the scenario (Task 8) is written against it in parallel with the UI.
- Keep every existing `data-chat-bscard*` attribute the `chat-redesign` scenario reads
  (`scripts/cdp/scenarios-chat-redesign.mjs`), except the pointer line, which this plan removes.
- Reuse what exists rather than re-deriving it: `reviewHead`, `confirmableGuesses`, `partView`, `partGist`,
  `decisionParts`, `checkReview`, `approveBlocker`, `unseenSince`, `builderCheckView`, `checkClock`, `checkSpan`
  (`brainstormmodel.ts`), `runStage` (`runstage.ts`), `useRunInfo` (`runlineagestore.ts`), `sendBrainstorm` and
  `approveAndOpenRun` (`brainstormsend.ts`), `useAction` / `ERROR_LINE` (`brainstormui.tsx`), `springReveal`
  (`@/app/element/motiontokens`).
- Errors: a failed send shows on the card that sent it (`useAction`'s error line); never swallow one.
- Do not run `task dev`, a build, `node scripts/verify.mjs` or the whole vitest suite: run the focused tests your task
  names and `task check:ts` once at the end (give it a 5-minute timeout).
- Commits carry no attribution trailer.

### Task 1: Card types, record fields and the line helpers
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbrainstorm.ts`, `frontend/app/view/agents/chatbrainstorm.test.ts`

The interface every other task builds on (spec Builder decisions 1, 3, 4, 8). Types and small pure helpers only; the
card selection and the send record are Task 2. Today's `openQuestion` keeps its behaviour; since `QuestionCard`
gains required fields, extract one `questionCard(file, q, exited)` builder that `openQuestion` uses now (it sets
`kind: "question"` and `decided`) and Task 2's `brainstormCard` reuses.

Add to `chatbrainstorm.ts` (names and shapes exact; Task 2 may add fields only if a test needs one):

```ts
export type RecordKind = "answer" | "builder-answer" | "design" | "builder" | "run" | "action";
// SentAnswer gains optional: kind?: RecordKind; decisions?: number; questions?: number; calls?: number;
//   outcome?: "approved" | "keep-talking"; runId?: string
// (n and part stay required: records other than answer / builder-answer store n 0 and part "")
export function recordKind(r: Pick<SentAnswer, "kind">): RecordKind; // kind ?? "answer"
// PairedAnswer gains: kind: RecordKind, and the same optional fields
export type Gist = { id: string; title: string; gist: string };
// QuestionCard gains: kind: "question"; decided: Gist[] (the decisions whose state is yours, design order, partGist)
export type DecisionRowModel = { id: string; title: string; gist: string; view: "guess" | "changed";
    was?: string; why?: string; isNew: boolean };
export type ConfirmCard = { kind: "confirm"; state: "waiting" | "working" | "static"; line: string;
    action: "confirm-all" | "check" | null; guesses: number; rows: DecisionRowModel[]; yours: Gist[] };
export type BuilderQuestionCard = { n: number; total: number; part: string; question: string; why: string | null;
    options: AnswerOption[]; pick: number | null };
export type CheckCard = { kind: "check"; state: "waiting" | "working" | "static";
    stage: "reading" | "taking-in" | "failed" | "asking" | "review";
    pending: Extract<BuilderCheckView, { kind: "pending" }> | null; reason: string | null;
    question: BuilderQuestionCard | null; calls: string[]; spec: string[]; rows: DecisionRowModel[];
    approveBlocker: string | null };
export type RunCard = { kind: "run"; state: "waiting" | "static"; runId: string };
export type ChatCard = QuestionCard | ConfirmCard | CheckCard | RunCard;
export type RunCardView = { name: string; kind: "Orchestrator run" | "Quick run"; stage: RunStageView | null;
    done: boolean }; // done: stage key landed, complete or cancelled
export function runCardView(info: RunInfo | undefined): RunCardView; // missing run: name "", stage null, done false
export function designDoneLine(decisions: number): string;          // "Design confirmed · 9 decisions"
export function builderDoneLine(questions: number, calls: number, outcome?: "approved" | "keep-talking"): string;
                                                                     // "Builder check · 2 questions, 3 calls[ · kept talking]"
export function builderQuestionHead(n: number, part: string): string; // "Builder question 2 · Motion" ("Builder question 2" with no part)
export function runDoneLine(v: RunCardView): string;                 // "Run · <name> · <stage label>"
```

Acceptance (`npx vitest run frontend/app/view/agents/chatbrainstorm.test.ts`): `recordKind` of a record without
`kind`; `openQuestion` returns `kind: "question"` and `decided` (one per yours decision, notes left out); `runCardView`
for an orchestrator run working, a quick run, a landed run (`done`), a cancelled run (`done`) and a missing run; each
line helper's singular and plural wording. Existing tests stay green.

### Task 2: Card selection and the send record
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbrainstorm.ts`, `frontend/app/view/agents/chatbrainstorm.test.ts`, `frontend/app/view/agents/chatbrainstormstore.ts`, `frontend/app/view/agents/brainstormsend.ts`, `frontend/app/view/agents/brainstormsend.test.ts`

(No Depends line: runs after Task 1, whose file it shares.) Spec Builder decisions 1–3 and 6.

```ts
export type CardInput = { file: BrainstormFile | null; records: readonly SentAnswer[]; exited: boolean;
    topic: string; check: BuilderCheckView; sent: SentKind | null; seen: SeenMark | null;
    starting: StartingRunMark | null };
export function brainstormCard(input: CardInput): ChatCard | null;
export function sendRecord(action: BrainstormAction, file: BrainstormFile | null, records: readonly SentAnswer[],
    topic: string, line: string, seen: number, now: number): SentAnswer | null;
```

- `brainstormCard` follows decision 1's precedence and decision 2. Question card: through Task 1's `questionCard`;
  a talk question counts as answered only by a record whose `recordKind` is `answer` (decision 3). Confirm card:
  `reviewHead` (pass the check view) for `line`/`action`/`guesses`, `rows` = decisions whose `partView` is `guess` or
  `changed` (with `was`/`why`, `isNew` from `unseenSince(file, seen).parts`), `yours` = decisions in state yours as
  gists; shown only when `action != null || rows.length > 0`; `working` while the shown file has `working` set by a
  non-check line. Check card: `stage` = the check view's stage when pending; `failed` (with `reason`) when the view
  failed and `file.check` is null; `reading` when only the sent `check` line is pending (`sent === "check"`, view
  `none`), with `pending` then set to a reading view carrying the pending-check text (`A builder is reading the
  design.`, the text `shownFile` writes), so `pending` is non-null in both pending stages; else `asking` while a
  builder question is unanswered, else `review`. `question` = the first unanswered of `check.yours` (n = index + 1,
  `total`, part = `partTitle`, options and pick as the question card reads them); `calls` = `check.calls` texts;
  `spec` = `check.answered`; `rows` = `checkReview` rows whose action is `keep-restore` or `confirm`;
  `approveBlocker(file, starting)`. `state`: `working` in the reading / taking-in stages or while the file is being
  written, else `waiting`. Run card: `file.run` after `withStartingRun`. Every kind is `static` for an exited agent.
- `sendRecord` (decision 3): `answer` only with a question open (today's `answerRecord` rule; with none open it
  returns null, and the line stays a bubble); `builder-answer` with the open builder question's n and part title;
  `check` → `design` with `decisions` (the decision count), or `action` when the newest `design`/`builder` record of
  the topic is `design`; `approved`/`keep-talking` → `builder` with `questions`/`calls` from `file.check` and the
  `outcome`; `run` → `run` with `runId`; `guess`, `skip`, `confirm`, `confirm-all`, `edit`, `keep`, `restore`,
  `keep-all`, `builder-decide` → `action`. Non-answer records store `n: 0`, `part: ""`.
- `brainstormsend.ts`: replace `answerRecord` with `sendRecord` (the `seen` count computed as today, before the send)
  and record whatever it returns after the line went. Cap per agent 200 (`MAX_ANSWERS_PER_AGENT`); `parseSentStore`
  keeps `kind`, `decisions`, `questions`, `calls`, `outcome` and `runId` when well-typed and drops each one that is
  not; `pairAnswers` copies `kind` and those fields into `PairedAnswer`.

Acceptance (`npx vitest run frontend/app/view/agents/chatbrainstorm.test.ts frontend/app/view/agents/brainstormsend.test.ts`):
`brainstormCard` in each phase the spec's Testing lists — asking, judging, awaiting review (guesses, a changed
decision), every decision yours (action `check`), done with parts still open and nothing to confirm (null), a review
action pending (`working`), check sent before any record (reading, `pending` non-null), check reading / taking-in /
failed, builder question open, review with a row left (Approve blocked) and with none, run started (including a
starting mark), exited agent (each kind `static`), no file; a `builder-answer` record with n 1 not hiding talk
question 1; the Confirm card's rows and `yours`; `isNew` against a seen mark. `sendRecord` for each action kind,
including an answer with no question open (null) and a retried `check` (`action`). `parseSentStore` reading an old
record without `kind`, and dropping a non-numeric `decisions` and an unknown `kind`. `pairAnswers` carrying `kind`
and the fields through. Existing tests stay green.

### Task 3: Shared card parts, Decided fold and the ✓ rows
**Depends on:** Task 1 (uses QuestionCard.decided, DecisionRowModel, PairedAnswer.kind and the line helpers)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbrainstormparts.tsx`, `frontend/app/view/agents/chatbrainstormcard.tsx`

- New `chatbrainstormparts.tsx` holds what the four cards share, moved out of `chatbrainstormcard.tsx` (which then
  imports them): the button/row class constants, `OpenButton`, `StateTag` (extended to the `working` state: a
  working-colour dot and a word, no amber), plus new:
  - `CardShell({ kind, state, head, icon?, agent, children })`: the motion wrapper (`springReveal`) and the section
    with `data-chat-bscard-kind` / `data-chat-bscard-state`, the header row (icon, head text, `StateTag`,
    `OpenButton`). The question card keeps its own `data-chat-bscard` / `data-chat-bscard-n` on the section.
  - `Fold({ name, label, items })`: the `›` toggle (`[data-chat-bscard-fold]`, `aria-expanded`, chevron turning 90°)
    that opens in place into one line per item, a ✓ icon, the title in a fixed-width column and the gist after it
    (the board's list), drawn only when open (`[data-chat-bscard-fold-list]`). Closed by default; open state is local
    `useState` (a fold is a glance; losing it on a surface switch is fine).
  - `DecisionRow({ agent, row, disabled })`: one row of the Confirm card and the check review (spec section 1): the
    title, gist, a `New` label when `isNew`; a guess has `That's right` (`confirm`) and `Edit` (an inline editor on
    the row, prefilled with the gist, whose Send sends `edit` with the text; Escape or Cancel closes it); a changed
    one shows what changed and why (`was`, `why`) with `Keep the change` (`keep`) and `Put mine back` (`restore`).
    Sends through `sendBrainstorm` inside `useAction`; the error shows on the row.
  - `OptionRows({ options, pick, pickLabel, disabled, onSend })`: the question card's lettered option rows, moved
    here so the builder question (Task 5) draws the same rows (`[data-chat-bscard-option]`).
  - `DoneRow({ kind, head, text?, trailing? })`: the ✓ row, styled as `ChatBrainstormAnswered` is today, with
    `data-chat-bscard-done` (step rows) or `data-chat-bscard-answered` + `data-kind="builder"` (builder answers).
- The question card's footer gains `Fold name="decided" label="Decided N"` before the `Compare N boards` link, as
  the board draws it; nothing else in the card moves. Hidden when `decided` is empty.
- `ChatBrainstormAnswered` stays (question answers) and gains siblings built on `DoneRow`:
  `ChatBrainstormBuilderAnswered`, `ChatBrainstormStepDone` (design / builder rows from a `PairedAnswer`). The run's
  ✓ row is Task 6's.

Acceptance: `task check:ts` clean; the strings come from Task 1's tested helpers. Shown by Task 8's steps 1 (Decided
fold closed and open), 7 (✓ Design confirmed), 10 (✓ Builder question), 13 (✓ Builder check).

### Task 4: Confirm the design card
**Depends on:** Task 3 (uses CardShell, DecisionRow and Fold from chatbrainstormparts.tsx)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbrainstormconfirm.tsx`

`ChatBrainstormConfirm({ agent, card, path, file })` per spec section 1 and Builder decisions 2 and 7, built from
`CardShell` (head `Confirm the design`), `DecisionRow` and `Fold name="yours" label="N yours"`:
`[data-chat-bscard-review-line]` with the card's `line`; its one action, `Confirm all N guesses`
(`[data-chat-bscard-confirm-all]`, sends `confirm-all`) or `Check with a builder` (`[data-chat-bscard-check]`, sends
`check`); the rows; the yours fold. `working` / `static` disable every button. On mount it calls
`baselineBrainstormSeen(path, file)`; on unmount `markBrainstormSeen(path, <the file it last drew>)` (a ref, as
`brainstormpane.tsx` line ~334 does).

Acceptance: `task check:ts` clean. Shown by Task 8's steps 2–6 (guesses with `New`, the yours fold, Edit, Keep while
working, Confirm all, Check with a builder).

### Task 5: Builder check card
**Depends on:** Task 3 (uses CardShell, DecisionRow, Fold and OptionRows from chatbrainstormparts.tsx)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbrainstormcheck.tsx`, `frontend/app/view/agents/brainstormchecktimes.ts`, `frontend/app/view/agents/brainstormpane.tsx`

`ChatBrainstormCheck({ agent, card, model, state })` per spec section 3 and Builder decisions 2, 5, 6, 10, from
`CardShell` (head `Builder check`) with `data-chat-bscard-stage`:

- reading / taking-in: `card.pending.text`, and `checkClock(card.pending, checkSpan(agent.builderCheck, run), times,
  now)` with the record's run through `WOS.getWaveObjectAtom<Run>` (as `brainstormpane.tsx`'s `CheckWait`), `now`
  from `model.nowAtom`, `times` from `useCheckTimes`, which moves from `brainstormpane.tsx` into the new
  `brainstormchecktimes.ts` (the pane imports it from there; no other pane change). `[data-chat-bscard-clock]` (the
  elapsed time and, when known, the bar and note) renders only when the clock's `elapsed` is non-null, as the tab's
  does: before Arc's record exists there is none.
- failed: `[data-chat-bscard-check-reason]` and `Try again` (`[data-chat-bscard-retry]`, sends `check`).
- asking: `[data-chat-bscard-builder="<n>"]` headed `builderQuestionHead`, the question and its why, `OptionRows`
  (the pick labelled `Agent's pick`); a pick sends `builder-answer` with the label; `Decide for me`
  (`[data-chat-bscard-decide]`, `builder-decide`); `[data-chat-bscard-own]`, a one-line field and Send
  (`builder-answer` with the text).
- every stage once `file.check` is set: `Fold name="calls" label="Agent's calls N"` and `Fold name="spec"
  label="Answered by the spec N"` (each hidden at 0).
- review: the `DecisionRow`s, then `Approve` (`[data-chat-bscard-approve]`, `approveAndOpenRun(model, agent,
  state)`; off with `[data-chat-bscard-approve-reason]` reading `card.approveBlocker`) and `Keep talking`
  (`[data-chat-bscard-keep-talking]`, `keep-talking`).

Acceptance: `task check:ts` clean; `npx vitest run frontend/app/view/agents/brainstormmodel.test.ts` still green.
Shown by Task 8's steps 7–13 (reading with and without the clock, taking-in, failed with Try again, builder question,
calls and spec folds, review then Approve, Keep talking).

### Task 6: Run card
**Depends on:** Task 3 (uses CardShell and DoneRow from chatbrainstormparts.tsx)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbrainstormrun.tsx`

Spec section 4 and Builder decisions 8 and 12. `ChatBrainstormRunRow({ agent, card, model, rowProps })`: the whole
end row of a run card, wrapper included: it reads the run with `useRunInfo(card.runId)` and returns null (no wrapper,
no gap) once `runCardView(read.run).done`; otherwise it draws the row wrapper Task 7 hands it (`rowProps`: the
motion wrapper's props the conversation uses for its end row) around the card: the name, the kind (`Orchestrator
run` / `Quick run`) and the stage label with a dot in the stage's tone (`data-chat-bscard-run-stage=<key>`), updated
in place; a loading line while `loaded` is false; `Open run` (`[data-chat-bscard-run-open]`) through
`openTarget`/`openAddress` (`frontend/app/view/jarvis/openref.ts`; read how other callers open a run). No task bar.
Also `ChatBrainstormRunDone({ runId })`: the ✓ row (`data-chat-bscard-done="run"`, `runDoneLine`), drawn only once the
run is `done`, nothing before.

Acceptance: `task check:ts` clean. Shown by Task 8's steps 14 (orchestrator), 15 (quick) and 16 (landed → ✓ Run).

### Task 7: Wire the cards into Chat
**Depends on:** Task 2 (uses brainstormCard and the record kinds), Task 4 (draws ChatBrainstormConfirm), Task 5 (draws ChatBrainstormCheck), Task 6 (draws ChatBrainstormRunRow and ChatBrainstormRunDone)
**Model:** sonnet
**Chunk:** Chat: Confirm the design and Decided so far, compact (brainstorm chat-brainstorm-review)
**Chunk:** Chat: a card when a run starts (route, tasks, link to the run, live state)
**Files:** `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatbrainstormcard.tsx`, `frontend/app/view/agents/chatbrainstorm.ts`, `frontend/app/view/agents/chatbrainstorm.test.ts`, `frontend/app/view/agents/chatbrainstormwire.ts`, `frontend/app/view/agents/chatbrainstormwire.test.ts`, `CHANGELOG.md`

- `chatpane.tsx`: read the seen marks with `useAtomValue(brainstormSeenAtom)` and compute the card with
  `brainstormCard({ file: shownBrainstormFile(state), records, exited, topic, check: builderCheckView(
  agent.builderCheck, state.sentCheckAt, state.file, state.modifiedMs, agent), sent: state.sent?.kind ?? null, seen:
  seenMarks[state.path] ?? null, starting: state.starting })` in place of `openQuestion`, and pass it on.
- `chatbrainstormwire.ts`: `boxAnswerRecord` / `boxPlaceholderOverride` take `ChatCard | null`; anything but a
  question card answers nothing and keeps the box's own placeholder. Update its tests.
- `chatbrainstormcard.tsx`: `ChatBrainstormCard` dispatches on `card.kind` to the question, confirm and check views
  (needs `model` and the brainstorm state); delete `PointerLine`. `chatbrainstorm.ts`: delete `openQuestion`,
  `PointerCard`, `OpenQuestion`, `POINTER_LINE` and their tests; `questionPlaceholder` takes a `QuestionCard`.
- `chatconversation.tsx`: `ChatBrainstorm` carries `card: ChatCard | null` and the state/model the views need. The
  end row: a run card goes through `ChatBrainstormRunRow` (which draws its own wrapper and nothing once done); every
  other kind keeps today's motion wrapper, keyed on `kind` (+ `n` for a question) so a swap animates. A paired
  message draws by `kind` (Builder decision 4): `answer` → `ChatBrainstormAnswered`; `builder-answer` →
  `ChatBrainstormBuilderAnswered`; `design` / `builder` → `ChatBrainstormStepDone`; `run` → `ChatBrainstormRunDone`;
  `action` → nothing. A hidden line leaves no empty gap in the column, and keeps the kept/restored scroll place and
  the pinned-prompt list right (it is already excluded there by `answers.has`); the drawn-item reuse key
  (`answerKey`) includes `kind`.
- `CHANGELOG.md`: one `Added` line under the top section, for the user: Chat now shows the design's review, the
  builder check and the run as cards, with the decisions so far folded into the question card.

Acceptance: `npx vitest run frontend/app/view/agents/chatbrainstorm.test.ts frontend/app/view/agents/chatbrainstormwire.test.ts`
green; `task check:ts` clean; `grep -rn "openQuestion\|PointerCard\|bscard-pointer" frontend` finds nothing. Shown by
every Task 8 step (the cards only reach the page through this wiring), and step 18 (an action line Arc sent draws no
bubble; one typed by hand stays a bubble).

### Task 8: The chat-brainstorm-review scenario
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-chat-brainstorm-review.mjs`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-chat-redesign.mjs`

Builder decision 11. A new scenario `chat-brainstorm-review`, registered in `scenarios.mjs` beside
`chatRedesignScenarios` (one import, one spread; the kit it needs). Written against the spec's DOM contract only.
Each step: a screenshot `cdp-shots/chat-brainstorm-review-<n>-<name>.png` and one assert; a step that throws fails
alone (chat-redesign's `run(name, fn)`).

Fixtures:
- The agent: a fixture Claude agent whose tab can receive a prompt. `chat-redesign`'s `makeTab` tab has no
  controller, so nothing receives a line: give the tab a shell controller the way `bsArrangeAgent` /
  `openCanvasTerminal` in `scenarios.mjs` do, with a roster row and transcript as `chat-redesign` makes them. Read a
  sent line from the page's send record (`brainstormAnswers(A)` from `chatbrainstormstore.ts`, the record's `text`,
  as chat-redesign's step 14 reads it), then append it to the transcript as the user message, so it pairs and its ✓
  row draws (or it is hidden).
- The brainstorm: `brainstorm.json` written and revealed with `uireveal` (chat-redesign's `writeBrainstorm`). For
  step 1 the file names a `canvas` and its asked part lists `boards`, so the footer draws `Decided N` before
  `Compare N boards`, as the board does; at least two parts are yours.
- The builder check record: the agent's tab meta `brainstorm:check*` keys (`session-models/sessionviewmodel.ts`,
  `scenarios-brainstorm-builder.mjs`). The run: a fixture run (`scenarios-brainstorm-run.mjs`), one orchestrator and
  one quick.

Steps, in order:
1. Question card's footer: `Decided N` fold closed (no list), then open with one line per decided part.
2. Confirm card with two guesses and one changed decision; the unseen guess carries `New`; the `N yours` fold opens.
3. `Edit` opens the inline editor; Send records `brainstorm: edit <id>: …`; appended, it draws no bubble.
4. A changed decision's `Keep the change` records `brainstorm: keep <id>`; the Confirm card stays, in state working.
5. `Confirm all N guesses` records `brainstorm: confirm every guess`.
6. Every decision yours: rows all folded into `N yours`, `Check with a builder` shown; a click records
   `brainstorm: check`.
7. Right after: no Confirm card; the check card in stage reading with the pending line and no clock;
   `✓ Design confirmed · N decisions` in place of the appended check message.
8. The `brainstorm:check` record set to reading with a ts after the send: `[data-chat-bscard-clock]` shows.
9. Record answered, the agent not yet done: stage taking-in. Then a failed record with no `file.check`: stage failed,
   its reason and `Try again`.
10. `file.check` with two builder questions: `Builder question 1` with options, `Decide for me` and the own-answer
    field; a pick records `brainstorm: builder answer: …`; appended and the file moved on to question 2,
    `✓ Builder question 1 · <part> — <answer>` in its place.
11. `Agent's calls N` and `Answered by the spec N` folds open.
12. Review with a changed row: `Approve` off with its reason; with the file settled, `Approve` on.
13. `Keep talking` records `brainstorm: keep talking`; appended, `✓ Builder check · Q questions, C calls · kept talking`.
14. `file.run` set to the orchestrator fixture run: run card with `Orchestrator run` and its stage; `Open run`.
15. The same with the quick fixture run: `Quick run`.
16. The run landed: no run card at the end and no empty end row; `✓ Run · <name> · Landed` in place of the appended
    `brainstorm: run <id>` message.
17. The file rewritten to a Confirm state (guesses again) and the agent exited: `[data-chat-bscard-kind="confirm"]` in
    state static, no amber dot, every send button disabled, `Open in Brainstorm` there.
18. A `brainstorm: check` line appended with no record (typed by hand) stays a bubble.

Also update `chat-redesign`'s step that asserts `[data-chat-bscard-pointer]` at the builder check: it now asserts
`[data-chat-bscard-kind="check"]` and no `[data-chat-bscard-pointer]`. Do not run the scenario (no dev app per worker);
check the three files with `node --check <file>`. Final runs it.

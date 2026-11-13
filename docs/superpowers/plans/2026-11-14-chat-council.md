# Council and Doc review cards in Chat

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-14-chat-council-design.md` (read its "Builder decisions" section: every task follows it)
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-council chat-verdict-handoff`
**Prototype:** D:/work/arcterm/.superpowers/design/chat-council/project

Two moments in a Claude agent's Chat become cards in the look of the run, verdict and handoff cards: a council the agent
started with `wsh council start` (a card at the end of the conversation while it runs, waits on you or is queued; a
one-line row at its start call once it ended), and a Doc review ask (a card in the dock while it waits; a one-line row in
place once answered). The run cards are the pattern to copy throughout: `chatruncards.ts` (anchor parsing, placement),
`chatruncard.tsx`, the `runstart` part in `chatmodel.ts`, and their wiring in `chatconversation.tsx`. The handoff card
is the pattern for the Doc review: `chathandoff.ts`, `chathandoffcard.tsx`, `ChatAsk` in `chatpane.tsx`, the `handoff`
part.

Principles for every worker: simple and direct, one source of truth (reuse `councilmodel.ts`, `councilstore.ts`,
`docreview.ts`, `askanswer.ts`, `openref.ts`; never a second reading of council states or a second fetch path), no
abstraction for one use, errors handled at the boundary and never swallowed silently (a failed Stop / Continue shows
its error on the card, the way `councilactions.ts` `useActions` keeps it). Colors from `@theme` tokens only; UI follows
`DESIGN.md`. Pure logic lives in a `.ts` beside its `.test.ts`; no render tests.

DOM contract (the scenario in Task 5 is written against it; Tasks 2 to 4 put these attributes on what they draw):

- council card: `[data-chat-bscard-kind="council"][data-chat-council="<id>"][data-chat-council-state="running|awaiting|queued"]`
  (and the shell's `data-chat-bscard-state`: `working` running or queued, `waiting` awaiting, `static` for an exited
  agent; the header's `[data-chat-bscard-tag]` holds the council's word); `[data-chat-council-open]` (Open council), `[data-chat-council-stop]`,
  `[data-chat-council-continue]`, `[data-chat-council-seat="<expert id>"][data-seat-state="done|working|waiting"]`,
  `[data-chat-council-round]`, `[data-chat-council-elapsed]`, `[data-chat-council-estimate]`,
  `[data-chat-council-queued]` (the queued line), `[data-chat-council-error]` (a failed Stop / Continue).
  The live cards sit in `[data-chat-council-tail]` wrappers at the end of the conversation, before the brainstorm card.
- council row: `[data-chat-bscard-done="council"][data-chat-council-row="<id>"][data-chat-council-end="done|stopped|failed|not-run|running"]`,
  `[data-chat-council-report]` (Open report) or `[data-chat-council-open]`; drawn inside the `[data-chat-item]` that
  holds the `wsh council start` call.
- Doc review card: `[data-chat-bscard-kind="docreview"][data-chat-bscard-state="waiting|static"]` inside the dock's
  `[data-chat-ask]`; `[data-chat-drcard-path]`, `[data-chat-drcard-pages]`, `[data-chat-drcard-intro]`,
  `[data-chat-drcard-item]`, `[data-chat-drcard-review]`, `[data-chat-drcard-approve]`, `[data-chat-drcard-note]`.
- Doc review row: `[data-chat-bscard-done="docreview"][data-chat-drcard-outcome="approved|changes"]`.

### Task 1: Chat parts for the two moments, and the shared row
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatcouncil.ts`, `frontend/app/view/agents/chatcouncil.test.ts`, `frontend/app/view/agents/chatdocreview.ts`, `frontend/app/view/agents/chatdocreview.test.ts`, `frontend/app/view/agents/chatmodel.ts`, `frontend/app/view/agents/chatmodel.test.ts`, `frontend/app/view/agents/chatitemeq.ts`, `frontend/app/view/agents/chatitemeq.test.ts`, `frontend/app/view/agents/chatbrainstormparts.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/docreview.ts`

The interface Tasks 2 to 4 build on (spec Builder decisions 1, 9 and 11). Signatures other tasks rely on, exactly:

```ts
// chatcouncil.ts (new; Task 2 adds the rest of the council model to this file)
export type CouncilAnchor =
    | { kind: "started"; councilId: string; estimate?: string } // estimate: "≈ 14 calls · ~0.9M tokens"
    | { kind: "queued"; councilId: string }
    | { kind: "notrun"; councilId: string; reason: string }; // reason: the "Not run: …" line, prefix included
export function councilStartAnchor(command: string, output: string): CouncilAnchor | null;

// chatdocreview.ts (new; Task 3 adds the rest of the Doc review model to this file). Structural, as isHandoffAsk is:
// the dock passes the live ask's AgentAskQuestion[], the transcript an AskQuestionDetail[] (assignable to it)
export function isDocReviewAsk(questions: readonly AgentAskQuestion[] | undefined): boolean;

// chatmodel.ts, two new AgentPart members
| { kind: "councilstart"; key: string; anchor: CouncilAnchor } // key `councilstart:<entry index>`
| { kind: "docreview"; key: string; question: AskQuestionDetail } // key `docreview:<entry index>`

// chatbrainstormparts.tsx
export type CardKind = ... | "council" | "docreview";
// CardShell: new optional prop
//   tag?: ReactNode    // drawn in place of <StateTag> when given (the council's own state word), in a
//                      // span carrying data-chat-bscard-tag; data-chat-bscard-state still comes from `state`
// DoneRow: kind gains "council" | "docreview"; new optional props
//   mark?: ReactNode   // drawn in place of the ✓ icon
//   action?: ReactNode // a button at the row's right end; only allowed when `detail` is not given
//   extra?: Record<`data-${string}`, string | number | boolean | undefined> // spread on the row element itself,
//                      // beside data-chat-bscard-done, as CardShell's `extra` is
```

- `councilStartAnchor`: the command must be `wsh council start` as a command (through a path, `wsh.exe`, quotes,
  after `cd x &&`, inside `$(…)`; not `wsh council start-…` or another program's words), copying the shape of
  `RUNS_START_COMMAND` in `chatruncards.ts`. The output lines are the three `cmd/wsh/cmd/wshcmd-council.go` prints
  (`councilStartedLine`, `councilQueuedLine`, `councilNotRunText`); read them there. The first such line wins.
- `isDocReviewAsk`: true when `parseDocReview` reads the one question as `kind: "doc"`. Widen `parseDocReview`'s
  parameter to `{ questions: readonly AgentAskQuestion[] } | undefined` (readonly, so both the live ask and the
  transcript's details pass) instead of casting; its existing callers and tests must still pass.
- `chatmodel.ts` `momentOf`: a Bash call with a council anchor becomes a `councilstart` part placed after its tool line
  (cut `k + 1`, as `runstart`); an AskUserQuestion that `isDocReviewAsk` becomes a `docreview` part replacing its tool
  line (cut `k`, `from = k + 1`, as `handoff`). Update the comment listing the moments.
- `chatitemeq.ts`: compare the two new parts the way `runstart` and `handoff` are compared.
- `chatconversation.tsx`: only what keeps it compiling and correct until Task 4: the two new kinds in the `autoOpen`
  list beside `runstart`, and `case "councilstart"` / `case "docreview"` in the part switch returning `null` with a
  `// Task 4 draws …` note. Nothing else.
- `DoneRow`: `mark`, `action` and `extra` as above; `CardShell`: `tag` as above. The existing cards and rows draw
  exactly as before.

Acceptance (focused tests): `npx vitest run frontend/app/view/agents/chatcouncil.test.ts frontend/app/view/agents/chatdocreview.test.ts frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/chatitemeq.test.ts frontend/app/view/agents/docreview.test.ts`
covering: each of the three lines read (the estimate and the reason kept), a command that is not `wsh council start`
or an output with no such line gives null, a quoted path and `cd x &&` prefix still match; `isDocReviewAsk` true for a
`.tex` and a `.md` Doc review, false for a Spec review, a Handoff, a bad path; `chatItems` turns the Bash call into a work part then a `councilstart` part, and the Doc review ask into a `docreview`
part with no tool line for it. `task check:ts` passes. No rendered change yet, so no scenario step.

### Task 2: The council card and its ended row
**Depends on:** Task 1
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatcouncil.ts`, `frontend/app/view/agents/chatcouncil.test.ts`, `frontend/app/view/agents/chatcouncilstore.ts`, `frontend/app/view/agents/chatcouncilcard.tsx`, `frontend/app/view/jarvis/address.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`, `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`

Spec sections 1, 3 and 6; Builder decisions 2, 3, 6, 7, 8 and 11. Board `Council.dc.html` states 1 to 5.

Pure model, added to `chatcouncil.ts` (signatures Task 4 relies on):

```ts
/** Whether the council has ended once in this conversation (Builder decision 3). */
export function councilEndedOnce(c: Council | null, anchor: CouncilAnchor, seenEnded: boolean): boolean;
/** Where each council of the conversation draws: `atCall` maps a `councilstart` part key to the council id whose row
 *  draws there (a council that ended once); `trailing` is the live councils' ids, oldest call first, for the end of
 *  the conversation. A council is drawn once: the first call (by order) that names it keeps it. A council the store
 *  does not know (null) draws nothing, except a not-run anchor, whose row needs no council. */
export function placeCouncilCards(i: {
    anchors: readonly { key: string; anchor: CouncilAnchor; order: number }[];
    councils: ReadonlyMap<string, Council | null>;
    endedOnce: ReadonlySet<string>;
}): { atCall: Map<string, string>; trailing: string[] };
```

plus the card's view (running / awaiting / queued: title, question in at most two lines, seat chips with their state,
the step word, elapsed, estimate, the queued holder's feature) and the row's text and mark, whatever shapes you choose.
Reuse `councilmodel.ts` (`headerChip`'s step word: `Round N of 3`, `Writing the summary`, `Follow-up`; `duration`;
`panel`; the stopped-with-a-summary-reads-as-done rule); do not re-derive states. There is no round name: the board's
` · reactions` is dropped (spec Builder decision 6), so do not invent one. Export `elapsedMs` from `councilmodel.ts`
(private today) and time the card and the done row with `duration(elapsedMs(c, now))`, which reads `2 min 14 s`, not
the board's `2m 14s`; add a `councilmodel.test.ts` case for the export. A seat's dot: `working` while `c.activity` has
the seat, `done` once the seat sent in the current round, else `waiting` (a pure function in `chatcouncil.ts`). The
header's state slot is `CardShell`'s `tag` (Task 1): the step while running, `Waiting on you` when awaiting, `Queued
after "<feature>" · starts by itself` when queued; `CardState` is `working` for running and queued, `waiting` for
awaiting, `static` when `live` is false (the tag still shows the council's word). The queued card reads its holder with
`useCouncil(c.queuedafter)` from `councilstore.ts`, as `councildiscussion.tsx` does (`useChatCouncils` loads only the
anchored ids); with no holder known it reads `Queued · starts by itself`. Row texts: `Council · <mode> · N ideas|directions ·
<elapsed>` with the feature dimmed and Open report (done); `Council · stopped in round N` / `failed in round N` /
`not run` with the reason in one line (the council's `error`, or the anchor's refusal) and Open council (■, !, –); a
council running again after it ended once reads as a row with a working mark, `running again` and its header chip, and
keeps Open council.

`chatcouncilstore.ts`: `useChatCouncils(ids: readonly string[]): ReadonlyMap<string, Council | null>` loads each id
once through `loadCouncil` and reads `councilAtom` (reloaded on `council:changed` already; no new fetch, no polling);
the in-memory ended-once set (a jotai atom of council ids, added to whenever a council is seen in an ended state) and
`useCouncilsEndedOnce(): ReadonlySet<string>` for Task 4.

`chatcouncilcard.tsx`: `ChatCouncilCard({ councilId, anchor, model, live })` (the live card, `CardShell` kind
`council`) and `ChatCouncilRow({ councilId, anchor, model })` (the `DoneRow` kind `council` with `mark`, `action`, and the row's
`data-chat-council-row` / `data-chat-council-end` through `extra`, so they sit on the same element as
`data-chat-bscard-done`), with the DOM contract's attributes. Stop and Continue call `stopCouncil` / `continueCouncil({ id })` from
`councilstore.ts` through `useActions` (`councilactions.ts`); a pressed button is dead until `council:changed` brings
a new state; a failure shows in `[data-chat-council-error]`. `live={false}` (an exited agent) draws the card static with
no Stop / Continue. Open council is `openTarget(model, { kind: "council", councilId })`; Open report adds
`view: "summary"`: add the optional `view?: "summary"` to the council member of `OpenTarget` in `address.ts` and pass
it to `showCouncil` in `openref.ts`'s `selectCouncil` (an address string never carries it).

Acceptance: `npx vitest run frontend/app/view/agents/chatcouncil.test.ts frontend/app/view/jarvis/openref.test.ts`
covering: a council target with `view: "summary"` opens the council on its report and one without on its default view
(`openref.test.ts`); ended-once for each of the
four causes and false for a running council with no summary; placement (a live council trails, an ended one sits at its
call, a re-run after done stays at the call, a second call naming the same id draws nothing, an unknown council draws
nothing but a not-run anchor still draws its row, trailing ordered by call); the card view for running (step word,
estimate from the anchor, seat states), awaiting (`N experts sent M ideas`), queued (with and without a known holder);
each row text and mark, the count word by mode; `elapsedMs` exported. `task check:ts` passes. The cards are shown by
`chat-council` steps 1 to 6 (Task 5), once Task 4 places them; the static card (exited agent) by step 1b and a failed
Stop by step 1c.

### Task 3: The Doc review card and its folded row
**Depends on:** Task 1
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatdocreview.ts`, `frontend/app/view/agents/chatdocreview.test.ts`, `frontend/app/view/agents/chatdocreviewcard.tsx`, `frontend/app/view/agents/chatpane.tsx`

Spec sections 4, 5 and 6; Builder decisions 9, 10 and 11. Board `DocReview.dc.html` states 1 and 2.

Pure model in `chatdocreview.ts`: the card's fields from `parseDocReview` (path shown relative to the agent's project
folder via `relativeToProject` from `councilsetupmodel.ts` when it sits under it, intro, `Pages: N`, the "worth a look"
items, the approve option's index), and the folded row from an answered `AskQuestionDetail`:
`{ outcome: "approved" | "changes"; comments: number; file: string }` with its line, `✓ Doc review · approved · <file>`
or `↺ Doc review · changes requested · N comments · <file>` (the count left out at zero; counted from the numbered
`N. [` lines `formatRequest` in `proseanchor.ts` writes).

`chatdocreviewcard.tsx`: `ChatDocReviewCard({ question, agent, model, state })`, its `question` typed structurally as
`{ question: string; header?: string; options?: AgentAskOption[] }` like `ChatHandoffCard`'s (the dock passes the live
`AgentAskQuestion`, the conversation an `AskQuestionDetail`) (`CardShell` kind `docreview`, `Doc
review` header with `Waiting on you` and `Pages: N`, the path in monospace, the intro, the items as a list, `Review`
primary and `Approve`, the note `Request changes from Review: each comment sits on a passage`) and
`ChatDocReviewDone({ question, agent })` (`DoneRow` kind `docreview`, `mark` ↺ for changes, and
`data-chat-drcard-outcome` through `extra` on the row element itself), with the DOM contract's attributes. Review calls `docreviewstore.openReview(model, agent.id)` as the answer bar's Review does; Approve answers
`answerAgentAsk(model, agent.id, { 0: new Set([approveIndex]) }, {})`, dead once `sentIdsAtom` holds the ask's key,
the handoff card's lock. `state="static"` (exited agent) draws no buttons.

`chatpane.tsx` `ChatAsk`: an ask `isDocReviewAsk` draws `ChatDocReviewCard` the way a Handoff draws
`ChatHandoffCard`; every other ask is unchanged. Update `ChatAsk`'s comment.

Acceptance: `npx vitest run frontend/app/view/agents/chatdocreview.test.ts` covering the card fields (relative and
outside-project paths, pages present and absent, items), the folded row for Approve, for a `formatRequest` answer with
three comments, and for a free typed answer (no count). `task check:ts` passes. The card is shown by `chat-council`
step 7 (waiting card in the dock, Approve sends the approve option, Review opens the review view), the static card by
step 7b, and the row by steps 8 and 9 (Task 5), once Task 4 draws the row.

### Task 4: Place the council cards and the two rows in the conversation
**Depends on:** Task 2 (uses `placeCouncilCards`, `useChatCouncils`, `useCouncilsEndedOnce` and the council card and row), Task 3 (uses `ChatDocReviewCard` and `ChatDocReviewDone`)
**Model:** opus
**Files:** `frontend/app/view/agents/chatconversation.tsx`, `CHANGELOG.md`

Spec section 2; Builder decisions 4 and 5. In `chatconversation.tsx`, beside the run cards' wiring:

- Collect the `councilstart` anchors from `stored` (order: the entry index, as `runAnchors`), read their councils with
  `useChatCouncils`, and place them with `placeCouncilCards` and `useCouncilsEndedOnce`.
- `case "councilstart"`: the council's `ChatCouncilRow` when `atCall` names it here, else `null` (no empty slot in the
  item's gap, the run card's rule). Add the slot to `cardsOf` so an item redraws when its row changes.
- `case "docreview"`: `ChatDocReviewDone` once answered (picked or typed); the static `ChatDocReviewCard` for an exited
  agent; `null` while the live card is in the dock (the `handoff` case's shape).
- At the end, after `placed.trailing`'s run cards and before the brainstorm card, inside the same `AnimatePresence`:
  one `ChatCouncilCard` per `trailing` council, each in a `motion.div` `data-chat-council-tail` with `endRow`, keyed
  `council:<id>`, so a card that ends leaves on the spring as its row appears at the call.
- Update the file's header comment (the cards Chat draws) and the comment over the end rows.
- `CHANGELOG.md`, top `## Unreleased` section, `### Added`: one line for the council card in Chat and one for the Doc
  review card in Chat, written for the user (see the file's header for the `try`/`big` markers; neither card needs
  one).

Acceptance: `npx vitest run frontend/app/view/agents/chatcouncil.test.ts frontend/app/view/agents/chatdocreview.test.ts frontend/app/view/agents/chatmodel.test.ts`
still pass; `task check:ts` passes; try it in your dev app if you can start one, else say so in your report. Shown by
`chat-council` steps 1 to 9 (Task 5): the running, paused and queued cards at the end, the done, stopped, failed,
not-run and running-again rows at their call, the Doc review rows in place; step 1b the council card static for an
exited agent, step 7b the static Doc review card this task draws in the conversation for an exited agent.

### Task 5: The chat-council CDP scenario
**Depends on:** Task 4 (the scenario drives the cards and rows Task 4 places)
**Model:** sonnet
**Chunk:** Chat: a council card (started, waiting on you, report summary; opens the council room)
**Files:** `scripts/cdp/scenarios-chat-council.mjs`, `scripts/cdp/scenarios.mjs`

A scenario named `chat-council`, written against the DOM contract above, in the shape of
`scripts/cdp/scenarios-chat-verdict-handoff.mjs` (one fixture Claude agent over a real shell tab, a mock roster row, a
throwaway project, a fixture transcript the steps append to the way Claude Code writes it; `agent-page-fixtures.mjs`)
with fixture councils written as JSON into the data dir the way `scripts/cdp/council/fixtures.mjs` does
(`seedCouncil` / `writeCouncil`, each under its own `opts.id`, with `opts.edit` setting `byagent: true`, `mode` and the
state each step needs: `COUNCIL_FIXTURES` has round1, round2, awaiting, done, failed and notrun, so the queued, stopped
and running-again councils are a fixture edited by `opts.edit` (`state: "queued"` with `queuedafter`, `state:
"stopped"` with `error` and `round`, `state: "running"` keeping the done fixture's `summary`)). `CouncilStopCommand`,
`CouncilContinueCommand` and `AnswerAgentCommand` are stubbed in the page (`stubRpc` / `rejectStub`, and the verdict
scenario's answer record): no real council, model or agent is touched. An exited agent is drawn the way
`scenarios-chat-verdict-handoff.mjs` step 3b does it (`ctx.exited`). Register it in
`scripts/cdp/scenarios.mjs` with one import and one spread beside `chatVerdictHandoffScenarios`. Each sub-step writes
the state it needs, so one failed step does not take the next with it; each has its own shot and assert:

1. Running council: the transcript has the agent's `wsh council start` Bash call whose output is the started line; the
   card sits at the end (`[data-chat-council-tail]`) with the feature, seat chips with states, the round, elapsed and
   estimate, Stop; clicking Stop records one `CouncilStopCommand` and the button goes dead.
1b. The same running council with the agent exited: the card is `[data-chat-bscard-state="static"]`, still shows the
   step in its header and Open council, and has no Stop.
1c. A failed Stop: `CouncilStopCommand` rejected (`rejectStub`); `[data-chat-council-error]` shows the error and the
   card stays as it was.
2. Paused after round 1 (`awaiting-you`, `pauseafterround1`): `Waiting on you`, the experts/ideas line, Continue and
   Stop; clicking Continue records one `CouncilContinueCommand` with the council's id.
3. Queued: the step also writes the holder council (a running council no call in this conversation names, so it draws
   no card here, which the step asserts too); the queued card's header names the holder's feature and `starts by
   itself`; Open council present.
4. Done: no card at the end; the ✓ row at the start call's item with the mode, count, elapsed and Open report; clicking
   Open report shows the council's report view.
5. Stopped, failed and not run (three calls, three councils): each row with its mark, what happened and the reason.
6. Running again after done (state `running` with a `summary`): the row stays at its call reading running again; no
   card at the end.
7. Doc review waiting: the AskUserQuestion with header `Doc review` (a `.tex` path, an intro, `Pages: 12`, two `- `
   items) shows as the card in `[data-chat-ask]` with path, pages, items, Review, Approve and the note; clicking
   Approve records one answer with the Approve option; clicking Review (on a fresh ask) opens the review view.
7b. The unanswered Doc review with the agent exited: the card draws in the conversation, `[data-chat-bscard-state="static"]`,
   with the path, the items and no Review or Approve.
8. Doc review approved: the answered ask (tool result picking Approve) folds to `[data-chat-drcard-outcome="approved"]`.
9. Doc review changes requested: an answer in `formatRequest`'s shape with two comments folds to
   `[data-chat-drcard-outcome="changes"]` reading `2 comments`, and no message bubble carries the answer's text.

Acceptance: `task verify:ui -- chat-council` passes against a dev app (`task dev`, or the headless browser app on a
Mac); the teardown removes the project, the councils, the agent and the transcript. Every board state of
`Council.dc.html` (steps 1 to 6) and `DocReview.dc.html` (steps 7 to 9) has a step, and so do the static cards (1b,
7b) and a failed Stop (1c).
